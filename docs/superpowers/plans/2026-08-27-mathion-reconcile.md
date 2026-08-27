# `mathion reconcile` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mathion reconcile` — a first-class command that applies this CLI's embedded Docker Compose to a running deployment — plus a `status`/`self-update` drift notice that tells operators when to run it.

**Architecture:** A new lock-serialized, root-gated cobra command re-materializes the embedded compose to `/etc/mathion/docker-compose.yml` and runs a whole-project `compose up -d --wait --pull never` (with a targeted digest-pinned proxy pre-pull under TLS) so Compose reconciles running containers to the new definition. An apply-pending marker in `varlib` keeps `status` honest across a failed apply; a small `maybeWarnComposeDrift` helper surfaces drift on `mathion status` (authoritative, new binary) and an unconditional nudge at the end of a successful `self-update`.

**Tech Stack:** Go 1.24, cobra; existing `cli/internal/{compose,config,varlib,dockerx,selfupdate}` packages; hermetic tests via `compose.FakeRunner`.

**Spec:** `docs/superpowers/specs/2026-08-26-mathion-reconcile-design.md` (revision 6, dual-gate READY-TO-PLAN). Executors read both this plan and the spec; the spec is the binding authority and its §-numbers are cited throughout.

## Global Constraints

- **Module / package:** `github.com/svkucheryavski/mathion/cli`; new command code lives in package `cmd`, marker helpers in package `varlib`. Go 1.24.
- **Fail-closed TLS invariant is load-bearing (spec §4.2, §6):** reconcile re-derives `a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)` **under the lock** (never the pre-lock startup snapshot), and `tlsEnabledFromEnv` FAILS CLOSED (unreadable/incomplete/interpolation-poisoned `.env` or empty domain → disabled → `--profile tls` never added → no DB secret expanded into the proxy env). Never weaken this.
- **Reconcile never pulls a mutable tag (spec §4.3):** the whole-project bring-up is `up -d --wait --pull never`; only the digest-pinned `proxy`/`proxy-init` may be pre-pulled (`pull --policy missing proxy proxy-init`), and only when TLS is enabled.
- **No `--remove-orphans`** on any reconcile compose call (spec §3, §4.2).
- **Marker is presence-only:** an empty file written via `config.AtomicWrite`; its bytes carry no schema (spec §4.1 step 6a).
- **Marker removal on `uninstall --purge` happens only AFTER `dockerx.Purge` succeeds** (alongside `RemoveJournal`); a failed purge retains the marker (spec §9, §8 test 14).
- **Do not modify the embedded compose** (`cli/internal/compose/docker-compose.yml`) or `docker-compose.prod.yml`; `TestEmbeddedComposeMatchesRepoRoot` must stay green.
- **Conventions:** `git add` exact named paths only (never `-A`/`.`). Commit trailer, EXACT: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Run `gofmt -l` (must be empty), `go vet ./...`, and `go test ./...` from `cli/` — all green before each commit. Feature branch `feat/mathion-reconcile` (already checked out); do not commit to `main`.

---

## File Structure

- **New** `cli/internal/varlib/marker.go` — apply-pending marker helpers (`MarkerPath`/`WriteMarker`/`MarkerPresent`/`RemoveMarker`), mirroring `journal.go`. One responsibility: the reconcile marker's durable lifecycle.
- **New** `cli/internal/varlib/marker_test.go` — round-trip / present-absent / idempotent-remove / empty-content.
- **New** `cli/cmd/reconcile.go` — `newReconcileCmd`, `(*App).reconcile`, `(*App).appRunning`, `removeMarkerFn` seam.
- **New** `cli/cmd/reconcile_test.go` — the 10 reconcile behaviors + local fixtures.
- **New** `cli/cmd/drift_test.go` — `maybeWarnComposeDrift`/`composeDrifted` precedence.
- **New** `cli/cmd/status_test.go` — drift notice emitted on both `status` return-nil branches.
- **Modify** `cli/cmd/version.go` — add `composeDrifted` + `maybeWarnComposeDrift` beside `maybeWarnDualInstall`.
- **Modify** `cli/cmd/status.go` — add `healthProbe` seam; emit the drift notice after `compose ps` succeeds, before the health probe.
- **Modify** `cli/cmd/root.go` — register `newReconcileCmd(app)` in `root.AddCommand`.
- **Modify** `cli/cmd/guard.go` — add `"reconcile"` to `classify`'s REFUSE set.
- **Modify** `cli/cmd/uninstall.go` — remove the apply-pending marker on `--purge`, after `dockerx.Purge` succeeds, alongside `RemoveJournal`.
- **Modify** `cli/cmd/uninstall_test.go` — purge clears the marker; failed purge retains it.
- **Modify** `cli/internal/selfupdate/run_linux.go` — unconditional reconcile nudge after the success line.
- **Modify** `cli/internal/selfupdate/run_linux_test.go` — nudge present on swap, absent on `--check`.
- **Modify** `README.md` — a short "Upgrading" note about `mathion reconcile` + `mathion status`.

---

## Task 1: `varlib` apply-pending marker helpers

**Files:**
- Create: `cli/internal/varlib/marker.go`
- Test: `cli/internal/varlib/marker_test.go`

**Interfaces:**
- Consumes: `varlib.Root()` (`varlib.go:24`); `config.AtomicWrite(path, data, mode)` (`config/state.go:13`); `config.RemoveSync(path)` (`config/state.go:63`); `varlib.EnsureBackupsDir()` (creates `Root()` at 0700).
- Produces: `varlib.MarkerPath() string`, `varlib.WriteMarker() error`, `varlib.MarkerPresent() (bool, error)`, `varlib.RemoveMarker() error`.

- [ ] **Step 1: Write the failing test**

Create `cli/internal/varlib/marker_test.go`:

```go
package varlib

import (
	"os"
	"path/filepath"
	"testing"
)

// markerReady sets a fresh 0700 MATHION_VARLIB_DIR and creates the managed tree,
// mirroring journal_test.go's setup.
func markerReady(t *testing.T) {
	t.Helper()
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	if err := EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
}

func TestMarkerRoundTrip(t *testing.T) {
	markerReady(t)
	if present, err := MarkerPresent(); err != nil || present {
		t.Fatalf("marker should be absent initially (present=%v err=%v)", present, err)
	}
	if err := WriteMarker(); err != nil {
		t.Fatalf("WriteMarker: %v", err)
	}
	if present, err := MarkerPresent(); err != nil || !present {
		t.Fatalf("marker should be present after write (present=%v err=%v)", present, err)
	}
	if _, err := os.Stat(MarkerPath()); err != nil {
		t.Fatalf("marker file must exist at %s: %v", MarkerPath(), err)
	}
	if err := RemoveMarker(); err != nil {
		t.Fatalf("RemoveMarker: %v", err)
	}
	if present, err := MarkerPresent(); err != nil || present {
		t.Fatalf("marker should be absent after remove (present=%v err=%v)", present, err)
	}
}

func TestRemoveMarkerIdempotent(t *testing.T) {
	markerReady(t)
	if err := RemoveMarker(); err != nil {
		t.Fatalf("removing an absent marker must be a no-op, got %v", err)
	}
}

func TestMarkerIsPresenceOnly(t *testing.T) {
	markerReady(t)
	if err := WriteMarker(); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(MarkerPath())
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 0 {
		t.Fatalf("marker must be empty (presence-only); got %d bytes", len(b))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && go test ./internal/varlib/ -run TestMarker`
Expected: FAIL — `undefined: MarkerPath/WriteMarker/MarkerPresent/RemoveMarker`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/internal/varlib/marker.go`:

```go
package varlib

import (
	"os"
	"path/filepath"

	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// MarkerPath returns the on-disk path of the reconcile apply-pending marker. It
// lives directly under Root() (the 0700 root-owned managed dir), alongside the
// lock — NOT under backups/.
func MarkerPath() string {
	return filepath.Join(Root(), "reconcile-pending")
}

// WriteMarker writes the apply-pending marker durably (atomic temp+rename+dir-fsync
// via config.AtomicWrite). It is an EMPTY, presence-only file: its bytes carry no
// schema, and its mere presence is the entire signal (spec §4.1 step 6a). Root()
// must already exist — reconcile takes the lock (which EnsureBackupsDir's Root())
// before calling this.
func WriteMarker() error {
	return config.AtomicWrite(MarkerPath(), []byte{}, 0o600)
}

// MarkerPresent reports whether the apply-pending marker exists. A not-exist result
// is (false, nil); any other stat error (e.g. a non-root caller that cannot traverse
// the 0700 dir) is returned so callers can fail-quiet per their own policy (spec §5).
func MarkerPresent() (bool, error) {
	_, err := os.Stat(MarkerPath())
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// RemoveMarker clears the apply-pending marker (idempotent unlink + parent-dir
// fsync via config.RemoveSync). A missing marker is not an error.
func RemoveMarker() error {
	return config.RemoveSync(MarkerPath())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && go test ./internal/varlib/ -run TestMarker -v`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add cli/internal/varlib/marker.go cli/internal/varlib/marker_test.go
git commit -m "$(cat <<'EOF'
feat(cli): varlib apply-pending marker helpers for reconcile

MarkerPath/WriteMarker/MarkerPresent/RemoveMarker, mirroring journal.go —
an empty presence-only file under varlib.Root(), atomic write + durable
remove. Foundation for `mathion reconcile` and its status drift notice.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `mathion reconcile` command

**Files:**
- Create: `cli/cmd/reconcile.go`
- Test: `cli/cmd/reconcile_test.go`
- Modify: `cli/cmd/guard.go:74` (add `"reconcile"` to the REFUSE set)
- Modify: `cli/cmd/root.go:113-118` (register `newReconcileCmd(app)`)

**Interfaces:**
- Consumes: `lockAndGuard(ctx, app, "reconcile")` (`guard.go:34`); `(*App).requireInstalledDeployment()` (`tls.go:232`); `tlsEnabledFromEnv(cfgDir)` (`root.go:77`); `(*App).compose`/`composeArgs` (`root.go:35,88`); `composeBytes()` (`install.go:225`); `compose.ComposeYAML` (`compose/embed.go`); `config.EnsureConfigDir`/`config.AtomicWrite`; `(*App).reportHTTPSReadiness()` (`tls.go:266`); `tlsProxyPullTimeout` (`restore.go:413`); `varlib.WriteMarker`/`RemoveMarker`/`MarkerPath` (Task 1); `buildVersion` (`root.go:26`). Test helpers `rootedVarlib`/`asRoot`/`seedBreadcrumb` (`start_test.go`/`backup_test.go`), `idxOfCall`/`joinHas`/`containsArg` (`restore_test.go`), fixtures `writePoisonedTLSEnv` (`tls_test.go`).
- Produces: `newReconcileCmd(app *App) *cobra.Command`, `(*App).reconcile(ctx context.Context, yes bool) error`, `(*App).appRunning(ctx context.Context) bool`, `removeMarkerFn` seam.

- [ ] **Step 1: Write the failing test**

Create `cli/cmd/reconcile_test.go`:

```go
package cmd

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// installedDeployment writes a valid, installed deployment into a temp cfgdir: a
// complete .env (0600), an install-state marker, a STALE docker-compose.yml (so a
// reconcile must re-materialize it), and — when tls is true — TLS state.
func installedDeployment(t *testing.T, tls bool) string {
	t.Helper()
	dir := t.TempDir()
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "SECRET==", "abc123hex")
	if err := config.AtomicWrite(dir+"/.env", []byte(config.RenderEnv(env)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err)
	}
	if err := config.AtomicWrite(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if tls {
		if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// varlibReady sets a fresh 0700 MATHION_VARLIB_DIR and creates the managed tree, for
// tests that call (*App).reconcile directly (bypassing lockAndGuard's EnsureBackupsDir).
func varlibReady(t *testing.T) {
	t.Helper()
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileRequiresRoot(t *testing.T) {
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	orig := geteuid
	geteuid = func() int { return 1000 }
	defer func() { geteuid = orig }()
	fr := &compose.FakeRunner{}
	app := &App{CfgDir: t.TempDir(), Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: bytes.NewReader(nil)}
	cmd := newReconcileCmd(app)
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Fatal("reconcile must require root")
	}
	if len(fr.Calls) != 0 {
		t.Errorf("no docker calls when non-root: %v", fr.Calls)
	}
}

func TestReconcileRefusesOnBreadcrumb(t *testing.T) {
	rootedVarlib(t)
	seedBreadcrumb(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: bytes.NewReader(nil)}
	cmd := newReconcileCmd(app)
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Fatal("reconcile must refuse on a leftover recovery breadcrumb")
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("no up on breadcrumb refuse")
	}
}

func TestReconcileRequiresInstalledDeployment(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir() // no .env, no state
	fr := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("reconcile must require an installed deployment")
	}
	if len(fr.Calls) != 0 {
		t.Errorf("no docker calls before the install gate: %v", fr.Calls)
	}
}

func TestReconcileRefusesWhenAppNotRunning(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "\n", nil }} // ps -q app => empty
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("reconcile must refuse when the app container is not running")
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("no up should be issued when the app is not running")
	}
	got, _ := os.ReadFile(dir + "/docker-compose.yml")
	if bytes.Equal(got, compose.ComposeYAML) {
		t.Error("no compose re-materialize before the running-app gate passes")
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("no marker should be written when the app-running gate refuses")
	}
}

func TestReconcileNonTLSReMaterializesAndUps(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "appcontainer\n", nil }}
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(dir + "/docker-compose.yml")
	if !bytes.Equal(got, compose.ComposeYAML) {
		t.Fatal("on-disk compose not re-materialized to the embed")
	}
	i := idxOfCall(fr.Calls, joinHas("up -d --wait --pull never"))
	if i < 0 {
		t.Fatalf("no up call; calls=%v", fr.Calls)
	}
	if containsArg(fr.Calls[i], "--profile") {
		t.Errorf("non-TLS up must not carry --profile tls: %v", fr.Calls[i])
	}
	for _, c := range fr.Calls {
		if containsArg(c, "--remove-orphans") {
			t.Errorf("reconcile must never pass --remove-orphans: %v", c)
		}
		if containsArg(c, "--pull") && (containsArg(c, "missing") || containsArg(c, "always")) {
			t.Errorf("reconcile up must be --pull never only: %v", c)
		}
		if containsArg(c, "pull") && containsArg(c, "--policy") {
			t.Errorf("non-TLS reconcile must not pre-pull the proxy: %v", c)
		}
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("marker should be cleared after a successful reconcile")
	}
	if !strings.Contains(out.String(), "reconciled to this CLI's stack definition") {
		t.Errorf("missing success line: %q", out.String())
	}
}

func TestReconcileTLSPrePullsAndUpsWithProfile(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, true)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "appcontainer\n", nil }}
	defer swapProbe(func() bool { return true })()
	// Startup snapshot deliberately FALSE; the .env is TLS-enabled, so the re-derive
	// under the lock must turn it ON.
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n"), tlsEnabled: false}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	pi := idxOfCall(fr.Calls, joinHas("pull --policy missing proxy proxy-init"))
	if pi < 0 {
		t.Fatalf("TLS reconcile must pre-pull the pinned proxy: %v", fr.Calls)
	}
	ui := idxOfCall(fr.Calls, joinHas("up -d --wait --pull never"))
	if ui < 0 || !containsArg(fr.Calls[ui], "--profile") {
		t.Fatalf("TLS up must carry --profile tls: %v", fr.Calls)
	}
	if pi > ui {
		t.Errorf("pre-pull must precede up (pi=%d ui=%d)", pi, ui)
	}
}

func TestReconcileReDerivesTLSFromEnvNotStartupSnapshot(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false) // .env is NON-TLS
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	// Startup snapshot lies (TRUE); the re-derive must drop --profile tls.
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n"), tlsEnabled: true}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	ui := idxOfCall(fr.Calls, joinHas("up -d --wait --pull never"))
	if ui < 0 || containsArg(fr.Calls[ui], "--profile") {
		t.Fatalf("startup TLS=true but .env non-TLS: up must drop --profile tls after re-derive: %v", fr.Calls)
	}
	if idxOfCall(fr.Calls, joinHas("pull --policy missing proxy")) >= 0 {
		t.Error("re-derived non-TLS must not pre-pull the proxy")
	}
}

func TestReconcileFailsClosedOnPoisonedEnv(t *testing.T) {
	varlibReady(t)
	dir := writePoisonedTLSEnv(t)
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err) // so ValidateEnvComplete (not a missing state marker) is the operative gate
	}
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("reconcile must fail closed on a poisoned .env")
	}
	if idxOfCall(fr.Calls, joinHas("up")) >= 0 {
		t.Error("no up over a poisoned .env")
	}
}

func TestReconcileFatalPrePullAbortsBeforeUp(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, true)
	fr := &compose.FakeRunner{
		OutputFunc: func([]string) (string, error) { return "c\n", nil },
		RunFunc: func(args []string) error {
			if containsArg(args, "pull") {
				return errors.New("network down")
			}
			return nil
		},
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("a failed pinned-proxy pre-pull must be fatal")
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("up must not run after a fatal pre-pull")
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Error("marker must remain after a failed apply (written before the pre-pull)")
	}
}

func TestReconcileMarkerLeftAfterFailedUp(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{
		OutputFunc: func([]string) (string, error) { return "c\n", nil },
		RunFunc: func(args []string) error {
			if containsArg(args, "up") {
				return errors.New("healthcheck timeout")
			}
			return nil
		},
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("a failed up must return an error")
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Error("marker must remain after a failed up")
	}
}

func TestReconcileMarkerRemovalFailureStillSucceeds(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	orig := removeMarkerFn
	removeMarkerFn = func() error { return errors.New("boom") }
	defer func() { removeMarkerFn = orig }()
	var out, errb bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &errb, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatalf("marker-removal failure after a successful apply must NOT fail reconcile: %v", err)
	}
	if !strings.Contains(errb.String(), "could not clear the apply-pending marker") {
		t.Errorf("expected a warning about the marker; got %q", errb.String())
	}
	if !strings.Contains(out.String(), "reconciled to this CLI's stack definition") {
		t.Errorf("success line still expected: %q", out.String())
	}
}

func TestReconcilePromptDeclineAborts(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("n\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("a 'n' answer must abort")
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("no up after a declined prompt")
	}
	got, _ := os.ReadFile(dir + "/docker-compose.yml")
	if bytes.Equal(got, compose.ComposeYAML) {
		t.Error("no re-materialize after a declined prompt")
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("no marker after a declined prompt")
	}
}

func TestReconcileYesSkipsPrompt(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	// In is EMPTY: with --yes, reconcile must not read a prompt and must proceed.
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: bytes.NewReader(nil)}
	if err := app.reconcile(context.Background(), true); err != nil {
		t.Fatalf("--yes must proceed without a prompt: %v", err)
	}
	if idxOfCall(fr.Calls, joinHas("up -d --wait --pull never")) < 0 {
		t.Errorf("--yes must proceed to up: %v", fr.Calls)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && go test ./cmd/ -run TestReconcile`
Expected: FAIL — `undefined: newReconcileCmd`, `undefined: removeMarkerFn`, `app.reconcile undefined`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/cmd/reconcile.go`:

```go
package cmd

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// removeMarkerFn is the step-6f marker-clear seam so a test can exercise the
// "removal failed after a successful apply → warn, exit 0" path (spec §4.1 step 6f).
var removeMarkerFn = varlib.RemoveMarker

func newReconcileCmd(app *App) *cobra.Command {
	var yes bool
	c := &cobra.Command{
		Use:   "reconcile",
		Short: "Apply this CLI's bundled stack definition to the running deployment",
		Long: "Re-materialize the embedded Docker Compose to /etc/mathion and bring the " +
			"project up so Compose reconciles the running containers to it. Use after a CLI " +
			"upgrade that changed the stack definition (see `mathion status`).",
		RunE: func(c *cobra.Command, _ []string) error {
			release, proceed, err := lockAndGuard(c.Context(), app, "reconcile")
			defer release()
			if err != nil || !proceed {
				return err
			}
			return app.reconcile(c.Context(), yes)
		},
	}
	c.Flags().BoolVar(&yes, "yes", false, "skip the confirmation prompt (for automation)")
	return c
}

// reconcile applies the embedded compose to a running deployment (spec §4.1). The
// caller (newReconcileCmd) has already taken the operation lock and run the
// breadcrumb entry-check via lockAndGuard.
func (a *App) reconcile(ctx context.Context, yes bool) error {
	// Step 2: installed-deployment gate — fail closed on a poisoned/incomplete .env
	// BEFORE any write or container mutation (spec §4.1 step 2).
	if err := a.requireInstalledDeployment(); err != nil {
		return err
	}
	// Step 3: re-derive TLS state UNDER THE LOCK — not the pre-lock startup snapshot
	// (spec §4.1 step 3). tlsEnabledFromEnv fails closed.
	a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)
	// Step 4: require a running app container (spec §4.1 step 4).
	if !a.appRunning(ctx) {
		return fmt.Errorf("no running app container for project %q; start the stack with `mathion start` "+
			"(or finish a fresh install with `mathion install`) before reconciling", a.Project)
	}
	// Step 5: drift read + confirm (spec §4.1 step 5).
	composePath := a.CfgDir + "/docker-compose.yml"
	onDisk, _ := os.ReadFile(composePath) // a read error → treat as "differs" and re-materialize anyway
	differs := !bytes.Equal(onDisk, compose.ComposeYAML)
	if !yes {
		if differs {
			fmt.Fprint(a.Out, "the on-disk stack definition differs from this mathion binary's embedded "+
				"definition; reconcile will re-materialize it and recreate any service whose configuration "+
				"changed. Any changed service is briefly recreated (an HTTPS interruption if the proxy changes; "+
				"app downtime if the app definition changed). Continue? [y/N] ")
		} else {
			fmt.Fprint(a.Out, "the on-disk stack definition already matches this binary; reconcile will ensure "+
				"the running containers match it. Continue? [y/N] ")
		}
		line, _ := bufio.NewReader(a.In).ReadString('\n')
		if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
			return errors.New("reconcile cancelled")
		}
	}
	// Step 6a: apply-pending marker BEFORE any container change (spec §4.1 step 6a).
	if err := varlib.WriteMarker(); err != nil {
		return fmt.Errorf("writing the apply-pending marker: %w", err)
	}
	// Step 6b: re-materialize the on-disk compose from the embed (the exact write
	// install/tls enable use).
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(composePath, composeBytes(), 0o644); err != nil {
		return err
	}
	// Step 6c: targeted pinned-proxy pre-pull, TLS only, FATAL on failure (spec §4.1 step 6c).
	if a.tlsEnabled {
		pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
		err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init")
		pcancel()
		if err != nil {
			return fmt.Errorf("could not fetch the pinned bundled-proxy image reconcile needs "+
				"(check connectivity): %w", err)
		}
	}
	// Step 6d: whole-project bring-up; never pulls a mutable tag; never reaps orphans.
	if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never"); err != nil {
		return err
	}
	// Step 6e: bounded HTTPS readiness (TLS only; the proxy has no healthcheck).
	if a.tlsEnabled {
		a.reportHTTPSReadiness()
	}
	// Step 6f: clear the marker; a removal failure does NOT fail a successful apply
	// (spec §4.1 step 6f) — warn and exit 0.
	if err := removeMarkerFn(); err != nil {
		fmt.Fprintf(a.Err, "note: reconcile succeeded but could not clear the apply-pending marker at %s (%v); "+
			"`mathion status` may show a spurious drift notice until the next reconcile\n", varlib.MarkerPath(), err)
	}
	// Step 7: report this CLI's stack revision (buildVersion, not the app image tag).
	fmt.Fprintf(a.Out, "reconciled to this CLI's stack definition (%s); run `mathion status` to confirm.\n", buildVersion)
	return nil
}

// appRunning reports whether the project's app container is up (best-effort),
// mirroring proxyRunning (tls.go:258): `compose ps -q app` lists only running
// containers by default, so a non-empty result means the app is up.
func (a *App) appRunning(ctx context.Context) bool {
	out, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
	return err == nil && strings.TrimSpace(out) != ""
}
```

- [ ] **Step 4: Wire the command in and add it to the REFUSE set**

Edit `cli/cmd/guard.go:74` — add `"reconcile"` to the refuse case:

```go
	case "update", "start", "install", "backup", "tls-enable", "reconcile":
		return outcomeRefuse
```

Edit `cli/cmd/root.go:113-118` — add `newReconcileCmd(app)` to the `root.AddCommand(...)` list (append after `newTLSCmd(app)`):

```go
	root.AddCommand(
		newInstallCmd(app), newStartCmd(app), newStopCmd(app), newStatusCmd(app),
		newLogsCmd(app), newPinCmd(app), newSuperuserCmd(app), newVersionCmd(app),
		newUninstallCmd(app), newBackupCmd(app), newRestoreCmd(app), newUpdateCmd(app),
		newSelfUpdateCmd(app), newTLSCmd(app), newReconcileCmd(app),
	)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run TestReconcile -v`
Expected: PASS (all 13 reconcile tests). Also confirm `go test ./cmd/ -run TestGuardEntryRouting` still passes (the routing test enumerates the refuse set but does not assert "reconcile" specifically — it remains green).

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add cli/cmd/reconcile.go cli/cmd/reconcile_test.go cli/cmd/guard.go cli/cmd/root.go
git commit -m "$(cat <<'EOF'
feat(cli): add `mathion reconcile` to apply the embedded stack to a running deployment

Root-gated, lock-serialized command: requireInstalledDeployment (fail-closed
.env) -> re-derive TLS under the lock -> require a running app -> drift prompt
(--yes skips) -> write apply-pending marker -> AtomicWrite embedded compose ->
targeted pinned-proxy pre-pull (TLS only, fatal) -> up -d --wait --pull never
(no --remove-orphans) -> HTTPS readiness (TLS) -> clear marker (removal failure
warns, exit 0). Registered in root; "reconcile" added to the breadcrumb REFUSE
set. Spec §4.1-§4.3.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: compose-drift notice + `status` wiring

**Files:**
- Modify: `cli/cmd/version.go` (add `composeDrifted` + `maybeWarnComposeDrift`)
- Modify: `cli/cmd/status.go` (add `healthProbe` seam; emit the notice)
- Create: `cli/cmd/drift_test.go`
- Create: `cli/cmd/status_test.go`

**Interfaces:**
- Consumes: `compose.ComposeYAML`; `varlib.MarkerPresent` (Task 1); `dockerx.HealthProbe(ctx, url)` (`dockerx/health.go:12`).
- Produces: `composeDrifted(cfgDir string) (drifted, present bool)`, `maybeWarnComposeDrift(w io.Writer, cfgDir string)`, `healthProbe` seam in `status.go`.

- [ ] **Step 1: Write the failing tests**

Create `cli/cmd/drift_test.go`:

```go
package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

const driftNote = "apply it with: sudo mathion reconcile"

func TestComposeDriftPrintsWhenBytesDiffer(t *testing.T) {
	varlibReady(t) // fresh varlib so no stale marker
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("expected drift note when bytes differ; got %q", out.String())
	}
}

func TestComposeDriftPrintsWhenMarkerPresentBytesMatch(t *testing.T) {
	varlibReady(t)
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("expected drift note when the apply-pending marker is present; got %q", out.String())
	}
}

func TestComposeDriftSilentWhenComposeAbsentEvenWithMarker(t *testing.T) {
	varlibReady(t)
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir() // no docker-compose.yml (post-purge shape)
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if out.Len() != 0 {
		t.Errorf("compose-absent must be silent even with a stale marker (precedence); got %q", out.String())
	}
}

func TestComposeDriftSilentWhenMatchNoMarker(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if out.Len() != 0 {
		t.Errorf("no drift + no marker must be silent; got %q", out.String())
	}
}

func TestComposeDriftHonorsCfgDir(t *testing.T) {
	varlibReady(t)
	dir := filepath.Join(t.TempDir(), "custom")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir) // reads dir, not a hardcoded /etc/mathion
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("maybeWarnComposeDrift must honor the passed cfgDir; got %q", out.String())
	}
}
```

Create `cli/cmd/status_test.go`:

```go
package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// statusWithHealth runs `mathion status` against a drifted on-disk compose with the
// health probe forced to healthErr, and returns captured stdout.
func statusWithHealth(t *testing.T, healthErr error) string {
	t.Helper()
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir+"/.env", []byte("MATHION_VERSION=v0.1.1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	orig := healthProbe
	healthProbe = func(context.Context, string) error { return healthErr }
	t.Cleanup(func() { healthProbe = orig })
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out, Err: &out, In: bytes.NewReader(nil)}
	cmd := newStatusCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatalf("status RunE: %v", err)
	}
	return out.String()
}

func TestStatusEmitsDriftOnHealthyBranch(t *testing.T) {
	s := statusWithHealth(t, nil)
	if !strings.Contains(s, "apply it with: sudo mathion reconcile") {
		t.Errorf("healthy status must emit the drift notice; got %q", s)
	}
}

func TestStatusEmitsDriftOnUnhealthyBranch(t *testing.T) {
	s := statusWithHealth(t, errors.New("connection refused"))
	if !strings.Contains(s, "apply it with: sudo mathion reconcile") {
		t.Errorf("unhealthy status must still emit the drift notice; got %q", s)
	}
	if !strings.Contains(s, "stack not healthy") {
		t.Errorf("expected the unhealthy line; got %q", s)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && go test ./cmd/ -run 'TestComposeDrift|TestStatusEmitsDrift'`
Expected: FAIL — `undefined: maybeWarnComposeDrift`, `undefined: healthProbe`.

- [ ] **Step 3: Add the drift helper to `version.go`**

Edit `cli/cmd/version.go` — add imports `"bytes"`, `"path/filepath"`, and the packages `compose` and `varlib`; then add below `maybeWarnDualInstall` (after line 60):

```go
// composeDrifted reports whether the on-disk compose at cfgDir differs from this
// binary's embedded revision, and whether a compose file is present at all. An
// ErrNotExist file reports (false, false) — the caller treats "absent" as silent
// (spec §5 precedence rule 1). Any OTHER read error reports (false, true): present
// but unreadable → fail-quiet on the drift signal, but not "absent".
func composeDrifted(cfgDir string) (drifted, present bool) {
	b, err := os.ReadFile(filepath.Join(cfgDir, "docker-compose.yml"))
	if errors.Is(err, fs.ErrNotExist) {
		return false, false
	}
	if err != nil {
		return false, true
	}
	return !bytes.Equal(b, compose.ComposeYAML), true
}

// maybeWarnComposeDrift prints a one-line notice to w when this deployment's stack
// definition differs from this mathion version's embedded definition, OR a previous
// reconcile did not finish (an apply-pending marker is present). Precedence (spec §5):
//  1. compose file absent → silent (checked FIRST, so a stale marker after
//     `uninstall --purge` cannot nag a host with no deployment);
//  2. else warn if the marker is present OR the on-disk bytes differ;
//  3. any read error is fail-quiet for that input only.
func maybeWarnComposeDrift(w io.Writer, cfgDir string) {
	if w == nil {
		return
	}
	drifted, present := composeDrifted(cfgDir)
	if !present {
		return
	}
	markerPresent, merr := varlib.MarkerPresent()
	if drifted || (merr == nil && markerPresent) {
		fmt.Fprintln(w, "note: this deployment's stack definition differs from this mathion version's "+
			"embedded definition (or a previous reconcile did not finish); apply it with: sudo mathion reconcile")
	}
}
```

The `version.go` import block becomes:

```go
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)
```

- [ ] **Step 4: Wire the notice into `status.go`**

Edit `cli/cmd/status.go` — add a `healthProbe` seam and emit the notice after `compose ps` succeeds, before the probe. The file becomes:

```go
package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
)

// healthProbe is the /health seam so status_test can force the healthy/unhealthy
// branches without a live app.
var healthProbe = dockerx.HealthProbe

func newStatusCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show stack status + /health",
		RunE: func(c *cobra.Command, _ []string) error {
			if err := app.compose(c.Context(), "ps"); err != nil {
				return err
			}
			// Drift notice: orthogonal to /health, so emit it on BOTH return-nil
			// branches below (spec §5.1). status runs as the NEW binary, so its
			// embedded bytes are authoritative.
			maybeWarnComposeDrift(app.Out, app.CfgDir)
			img := ""
			if m, err := config.ReadEnvFile(app.CfgDir); err == nil {
				img = m["MATHION_VERSION"]
			}
			if err := healthProbe(c.Context(), "http://127.0.0.1:8000/health"); err != nil {
				fmt.Fprintf(app.Out, "stack not healthy: %v (is it running? `mathion start`)\n", err)
				return nil
			}
			fmt.Fprintf(app.Out, "healthy — image %s\n", img)
			return nil
		},
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run 'TestComposeDrift|TestStatusEmitsDrift' -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add cli/cmd/version.go cli/cmd/status.go cli/cmd/drift_test.go cli/cmd/status_test.go
git commit -m "$(cat <<'EOF'
feat(cli): compose-drift notice on `mathion status`

maybeWarnComposeDrift/composeDrifted beside maybeWarnDualInstall: warn when the
on-disk compose differs from the embedded revision OR an apply-pending marker is
present; compose-absent is checked first and stays silent (post-purge), read
errors fail-quiet per input. Wired into status after `compose ps` succeeds and
before the /health probe (via a healthProbe seam) so it shows on both the healthy
and unhealthy branches. Spec §5.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: self-update reconcile nudge

**Files:**
- Modify: `cli/internal/selfupdate/run_linux.go:155-156`
- Modify: `cli/internal/selfupdate/run_linux_test.go`

**Interfaces:**
- Consumes: the existing `Run` success path (`run_linux.go:155`).
- Produces: an unconditional one-line nudge printed to `p.Out` after the `%s → %s` success line, on the confirmed-swap path only.

- [ ] **Step 1: Extend the existing happy-path test + add a `--check` absence assertion**

Edit `cli/internal/selfupdate/run_linux_test.go` — in `TestRun_HappyPath_Swaps` (after the existing `old→new line` assertion around line 116), add:

```go
	if !strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("a successful self-update must nudge toward reconcile; got %q", out.String())
	}
```

And in `TestRun_Check_NoRootNoArchiveNoSwap` (which already captures `p.Out` into `out`), add after the existing assertions:

```go
	if strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("--check must NOT print the reconcile nudge; got %q", out.String())
	}
```

- [ ] **Step 2: Run tests to verify the happy-path assertion fails**

Run: `cd cli && go test ./internal/selfupdate/ -run 'TestRun_HappyPath_Swaps|TestRun_Check_NoRootNoArchiveNoSwap'`
Expected: FAIL — `TestRun_HappyPath_Swaps` missing the nudge string (the `--check` test still passes, since nothing prints it yet).

- [ ] **Step 3: Add the nudge**

Edit `cli/internal/selfupdate/run_linux.go` — after the success line at :155 and before `return nil`:

```go
	fmt.Fprintf(p.Out, "%s → %s\n", p.CurrentVersion, tag)
	// Unconditional nudge (NOT a byte-compare): this process is still the OLD binary
	// (commitSwap renamed the staged temp over the target; the running process stays
	// on its pre-swap inode), so its embedded compose is stale. `mathion status`,
	// running as the NEW binary, is the authoritative drift detector; this only points
	// the operator at it. Fires ONLY here — the confirmed-swap path — not apt-defer,
	// not up-to-date, not --check/cancelled/durability-uncertain (all return earlier).
	fmt.Fprintln(p.Out, "if this release updated the stack definition, apply it with: sudo mathion reconcile")
	return nil
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && go test ./internal/selfupdate/ -run 'TestRun_HappyPath_Swaps|TestRun_Check_NoRootNoArchiveNoSwap' -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add cli/internal/selfupdate/run_linux.go cli/internal/selfupdate/run_linux_test.go
git commit -m "$(cat <<'EOF'
feat(cli): nudge toward `mathion reconcile` after a successful self-update

Print an unconditional one-line reconcile nudge after the confirmed-swap success
line. Not a byte-compare — the running process is still the pre-swap binary with a
stale embedded compose; `mathion status` (new binary) is the authoritative
detector. Fires only on the swap path, never apt-defer/up-to-date/--check. Spec §5.1.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `uninstall --purge` clears the apply-pending marker

**Files:**
- Modify: `cli/cmd/uninstall.go:63-65` (after `RemoveJournal`, after `dockerx.Purge` succeeds)
- Modify: `cli/cmd/uninstall_test.go`

**Interfaces:**
- Consumes: `varlib.RemoveMarker`/`MarkerPath` (Task 1); the existing purge flow (`uninstall.go:56` Purge, `:63` RemoveJournal).
- Produces: marker removal on `--purge`, gated behind a successful `dockerx.Purge`, non-fatal on failure.

- [ ] **Step 1: Write the failing tests**

Add to `cli/cmd/uninstall_test.go` (a new fixture + two tests; reuse the package's existing `rootedVarlib`/`installedDeployment` helpers):

```go
func TestUninstallPurgeClearsMarker(t *testing.T) {
	rootedVarlib(t)
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := installedDeployment(t, false) // has a valid install-state marker
	fr := &compose.FakeRunner{} // default: all docker calls succeed → Purge succeeds
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("uninstall --purge: %v", err)
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("a successful --purge must clear the apply-pending marker")
	}
}

func TestUninstallPurgeFailedRetainsMarker(t *testing.T) {
	rootedVarlib(t)
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := installedDeployment(t, false)
	// Fail dockerx.Purge's container-list (ps -aq --filter ...) so teardown returns
	// early — BEFORE RemoveJournal/RemoveMarker. SweepWorkers (a different ps filter)
	// still succeeds so the failure is specifically the purge.
	fr := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if containsArg(args, "-aq") {
			return "", errors.New("docker daemon down")
		}
		return "", nil
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.ExecuteContext(context.Background()); err == nil {
		t.Fatal("a failed purge must return an error")
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Error("a failed purge must RETAIN the marker (deployment config survives, so the signal must too)")
	}
}
```

> **Note for the implementer:** confirm `uninstall_test.go` imports `context`, `errors`, `io`, `strings`, `compose`, and `varlib`; add any missing. `installedDeployment`, `containsArg`, and `rootedVarlib` already exist in the package (`reconcile_test.go` / `restore_test.go` / `start_test.go`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && go test ./cmd/ -run TestUninstallPurge`
Expected: `TestUninstallPurgeClearsMarker` FAILS (marker still present — nothing removes it yet); `TestUninstallPurgeFailedRetainsMarker` PASSES already (nothing touches the marker). This confirms the missing removal.

- [ ] **Step 3: Add the marker removal**

Edit `cli/cmd/uninstall.go` — immediately after the `RemoveJournal` block (after line 65), add:

```go
		// Purge succeeded, so the deployment is gone — clear the apply-pending marker
		// too (spec §9). Only safe post-teardown: a failed Purge returned above, keeping
		// the marker while the deployment's config survives. A failed remove is a
		// non-fatal note (purge stays re-runnable).
		if err := varlib.RemoveMarker(); err != nil {
			fmt.Fprintf(app.Err, "note: could not remove the apply-pending marker at %s (%v)\n", varlib.MarkerPath(), err)
		}
```

(`varlib` and `fmt` are already imported in `uninstall.go`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run TestUninstallPurge -v`
Expected: PASS (both). Also run `go test ./cmd/ -run TestUninstall` to confirm no existing uninstall test regressed.

- [ ] **Step 5: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add cli/cmd/uninstall.go cli/cmd/uninstall_test.go
git commit -m "$(cat <<'EOF'
feat(cli): clear the apply-pending marker on `uninstall --purge`

Remove the reconcile apply-pending marker after dockerx.Purge succeeds, alongside
RemoveJournal — a failed purge returns earlier and retains the marker while the
deployment config survives, so the drift signal survives with it. Removal failure
is a non-fatal note. Spec §9.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: README upgrading note

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Locate the self-hosting / upgrading section**

Run: `grep -n "self-update\|Upgrading\|## Self-host\|mathion update" README.md` to find the upgrade/self-host section. If a distinct "Upgrading" subsection exists, add to it; otherwise add a short subsection next to the `self-update`/`update` documentation.

- [ ] **Step 2: Add the note**

Add this paragraph (adjust surrounding heading level to match the section it lands in):

```markdown
### Applying a stack-definition change after a CLI upgrade

`mathion self-update` and `apt upgrade mathion` update only the CLI binary. If a
release changes the bundled stack definition (for example a reverse-proxy or
security-header change), apply it to your running deployment with:

```
sudo mathion reconcile
```

`mathion reconcile` re-materializes the bundled Docker Compose and recreates only
the services whose configuration changed (a brief interruption of those services).
`mathion status` tells you when a reconcile is needed.
```

- [ ] **Step 3: Verify rendering**

Run: `grep -n "mathion reconcile" README.md` to confirm the note is present and the fenced code block is well-formed (no stray backticks).

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add README.md
git commit -m "$(cat <<'EOF'
docs: document `mathion reconcile` in the upgrading section

Note that self-update/apt upgrade update only the CLI binary; a stack-definition
change reaches a running deployment via `sudo mathion reconcile`, and `mathion
status` reports when it is needed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)

- [ ] `cd cli && gofmt -l .` → empty output (no unformatted files).
- [ ] `cd cli && go vet ./...` → clean.
- [ ] `cd cli && go test ./...` → all green (new + existing, including `TestEmbeddedComposeMatchesRepoRoot` and `TestGuardEntryRouting`).
- [ ] `git log --oneline` shows six focused commits with the exact trailer.

## Self-Review (plan author)

- **Spec coverage:** §4.1 steps 1-7 → Task 2 `reconcile`; §4.2/§4.3 profile-gating + pull policy → Task 2 (`--profile tls` via existing `composeArgs`, `--pull never` + targeted pre-pull); §4.6 residual → honestly bounded in the spec, no code (correctly out of scope); §5 drift notice + precedence → Task 3; §5.1 status + self-update wiring → Task 3 + Task 4; §7 exit/marker semantics → Task 2 (marker left on later failure, removal-failure warns exit 0); §8 tests 1-14 → Tasks 1-5; §9 files → all tasks; install-complete marker → explicitly deferred (not in this plan).
- **Type consistency:** `maybeWarnComposeDrift(w io.Writer, cfgDir string)` and `composeDrifted(cfgDir string) (drifted, present bool)` used identically in `version.go`, `status.go`, and `drift_test.go`; `(*App).reconcile(ctx, yes)`, `(*App).appRunning(ctx)`, `removeMarkerFn`, and the four `varlib` marker functions match between definition and every call site.
- **Placeholder scan:** no TBD/TODO/"implement later"; every code step carries complete code. The only judgement step is Task 6 Step 1 (locate the README section by `grep`), which is inherent to editing prose in an unseen doc, not a code placeholder.
