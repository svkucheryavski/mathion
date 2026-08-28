# Auto-reconcile on `mathion update` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold compose-reconcile into `mathion update` so one upgrade applies both the app image and this release's embedded stack definition, safely.

**Architecture:** Extract reconcile's under-lock apply body into a lock-free `applyStack` (marker lifecycle moved to callers). Add a shared `applyAndGate` mini-transaction (marker → apply → re-assert strict gate → clear-on-success / best-effort restore-on-failure) used by both `update` branches: real-upgrade applies **post-commit** (exit-2 `committedPendingError`, never rolls back the DB); same-tag applies restore-bounded (plain exit 1). `reconcile` keeps its existing behavior (uses `applyStack`+`clearApplyMarker` directly, not `applyAndGate`).

**Tech Stack:** Go 1.24, cobra; module `github.com/svkucheryavski/mathion/cli`. Hermetic tests via `compose.FakeRunner` + `gateFn`/`removeMarkerFn`/`writeJournalFn` seams.

**Spec:** `docs/superpowers/specs/2026-08-28-auto-reconcile-on-update-design.md` (rev 3, dual-gate clean). Executors read both; the spec is the binding authority and carries the full rationale + reference line numbers (verified at `8151389`).

## Global Constraints

- **Go 1.24**; `cli/cmd` + `cli/internal/config` carry **no build tags** (darwin-testable); only `cli/internal/selfupdate` is `//go:build linux`. All files this plan touches are darwin-testable.
- **`git add` exact named paths only** — never `-A`/`.`.
- **Commit trailer, EXACT:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Fail-closed on `.env`** everywhere; production is **HTTPS-only**; the fail-closed TLS re-derive (`tlsEnabledFromEnv` under the lock) is load-bearing — the proxy has no `env_file`.
- **Standing release rule (Decision A, spec §3.2):** every release's app migration must run under the *previous* on-disk compose, and its new app/db definition must come up healthy against the migrated schema — a maintainer/review rule; the restore net is its runtime bound.
- **Never** route a post-commit apply failure through `updateFailure`/`restoreEngine`/any DB rollback (spec §4.4). Exit codes: 0 ok / 1 fail / 2 `committedPendingError` (commit done, post-commit work pending) / 3 rollback-also-failed.
- **Preserve exact error strings** when extracting `requirePrivateEnv` (reconcile/tls tests assert them).
- Tests hermetic; discriminate restore-vs-apply on **on-disk compose == `prev`** (both emit identical `up` args), not arg-matching.

---

## File Structure

- `cli/cmd/reconcile.go` — home of `applyStack(ctx)` (core, no marker), `clearApplyMarker()`, `composePath(a)`; `App.reconcile` refactored to call them. Same package as `update.go`.
- `cli/cmd/tls.go` — `requirePrivateEnv()` extracted from `requireInstalledDeployment` (exact strings preserved).
- `cli/cmd/update.go` — `committedPendingError` + `exitCode` arm; `applyAndGate`, `restorePrevCompose`, `runningAppImageID`, `restoreWaitTimeout` consts; `updateOpts.NoReconcile` + `--no-reconcile`; drift-signal computation; both apply branches; confirm-plan line; `--no-reconcile` reminder; `import "bytes"`.
- `cli/cmd/reconcile_test.go`, `cli/cmd/update_test.go`, `cli/cmd/tls_test.go` — tests. `setupUpdateEnv(t)` helper.
- `README.md` — "Upgrading" note.

---

### Task 1: Extract `applyStack` / `clearApplyMarker` / `composePath` (behavior-preserving reconcile refactor)

**Files:**
- Modify: `cli/cmd/reconcile.go`
- Test: `cli/cmd/reconcile_test.go` (existing suite is the regression tripwire)

**Interfaces:**
- Produces: `func (a *App) applyStack(ctx context.Context) error` (re-derive TLS → materialize compose → TLS-only pinned pre-pull → whole-project `up --pull never` → readiness; **no** marker write/clear); `func (a *App) clearApplyMarker()` (warn-only, message contains `could not clear the apply-pending marker`); `func composePath(a *App) string`.
- Consumes: existing `composeBytes()`, `tlsProxyPullTimeout`, `reportHTTPSReadiness`, `removeMarkerFn`, `varlib.MarkerPath`, `tlsEnabledFromEnv`.

- [ ] **Step 1: Run the existing reconcile suite to confirm the green baseline**

Run: `cd cli && go test ./cmd/ -run TestReconcile -count=1`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Add `composePath`, `applyStack`, `clearApplyMarker`; refactor `App.reconcile`**

In `cli/cmd/reconcile.go` add:

```go
// composePath is the on-disk compose location (honors MATHION_CONFIG_DIR via CfgDir).
func composePath(a *App) string { return filepath.Join(a.CfgDir, "docker-compose.yml") }

// applyStack re-materializes the embedded compose and reconciles the running project
// to it. LOCK-FREE: the caller holds varlib.Lock, has run the install/complete/running
// gates + confirmation, has ALREADY written the apply-pending marker, and clears it
// itself only after its own final validation. Mirrors the old reconcile steps 3 + 6b–6e.
func (a *App) applyStack(ctx context.Context) error {
	a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir) // re-derive UNDER the lock, fail-closed
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(composePath(a), composeBytes(), 0o644); err != nil {
		return err
	}
	if a.tlsEnabled {
		pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
		err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init")
		pcancel()
		if err != nil {
			return fmt.Errorf("could not fetch the pinned bundled-proxy image reconcile needs "+
				"(check connectivity): %w", err)
		}
	}
	if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never"); err != nil {
		return err
	}
	if a.tlsEnabled {
		a.reportHTTPSReadiness()
	}
	return nil
}

// clearApplyMarker removes the apply-pending marker; a removal failure is warn-only.
// The message PRESERVES the substring "could not clear the apply-pending marker" that
// reconcile_test.go asserts.
func (a *App) clearApplyMarker() {
	if err := removeMarkerFn(); err != nil {
		fmt.Fprintf(a.Err, "warning: the stack was applied but could not clear the apply-pending marker at %s (%v); "+
			"`mathion status` may show a spurious drift notice until the next reconcile\n", varlib.MarkerPath(), err)
	}
}
```

Then in `App.reconcile`: **remove** the standalone `a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)` step-3 line (now inside `applyStack`; `appRunning` uses `ps` whose args don't depend on `tlsEnabled`), and replace the step 6a→7 body (marker write through the final report line) with:

```go
	// Step 6a: apply-pending marker BEFORE any container change.
	if err := varlib.WriteMarker(); err != nil {
		return fmt.Errorf("writing the apply-pending marker: %w", err)
	}
	// Steps 6b–6e (shared with update): re-materialize + pre-pull + up + readiness.
	if err := a.applyStack(ctx); err != nil {
		return err // marker retained → status nags until a clean apply
	}
	// Step 6f: clear the marker (warn-only).
	a.clearApplyMarker()
	// Step 7: report.
	fmt.Fprintf(a.Out, "reconciled to this CLI's stack definition (%s); run `mathion status` to confirm.\n", buildVersion)
	return nil
```

- [ ] **Step 3: Run the full reconcile suite (regression) + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run TestReconcile -count=1`
Expected: PASS — every reconcile test (marker written-before / cleared-after-success / left-after-failed-up, TLS re-derive, pre-pull, prompt, `could not clear the apply-pending marker` warning) unchanged.

- [ ] **Step 4: Commit**

```bash
git add cli/cmd/reconcile.go
git commit -m "$(cat <<'EOF'
refactor(cli): extract applyStack/clearApplyMarker/composePath from reconcile

Behavior-preserving: marker CLEAR moves out of the apply body into the caller so
both reconcile and (next) update can bracket the apply with their own final
validation. reconcile suite unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Extract `requirePrivateEnv` (exact strings preserved)

**Files:**
- Modify: `cli/cmd/tls.go`
- Test: `cli/cmd/tls_test.go` (+ reconcile loose-perm regression)

**Interfaces:**
- Produces: `func (a *App) requirePrivateEnv() error` — `.env` present + regular + owner-only (`perm&0o077 == 0`), **verbatim** the first three checks/messages of `requireInstalledDeployment`.
- `requireInstalledDeployment` calls it first, then continues with state/env validation unchanged.

- [ ] **Step 1: Write a direct unit test for `requirePrivateEnv`**

In `cli/cmd/tls_test.go`:

```go
func TestRequirePrivateEnvRejectsLoosePerm(t *testing.T) {
	cfg := t.TempDir()
	if err := os.WriteFile(cfg+"/.env", []byte("X=1\n"), 0o644); err != nil { // group/world-readable
		t.Fatal(err)
	}
	app := &App{CfgDir: cfg}
	err := app.requirePrivateEnv()
	if err == nil || !strings.Contains(err.Error(), "group/world-accessible") {
		t.Fatalf("want group/world-accessible rejection; got %v", err)
	}
}

func TestRequirePrivateEnvAcceptsOwnerOnly(t *testing.T) {
	cfg := t.TempDir()
	if err := os.WriteFile(cfg+"/.env", []byte("X=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	app := &App{CfgDir: cfg}
	if err := app.requirePrivateEnv(); err != nil {
		t.Fatalf("owner-only .env must pass; got %v", err)
	}
}
```

- [ ] **Step 2: Run to verify it fails (undefined)**

Run: `cd cli && go test ./cmd/ -run TestRequirePrivateEnv -count=1`
Expected: FAIL to compile (`requirePrivateEnv` undefined).

- [ ] **Step 3: Extract the helper, keep `requireInstalledDeployment`'s strings verbatim**

In `cli/cmd/tls.go`:

```go
// requirePrivateEnv verifies .env exists, is a regular file, and is owner-only
// (perm&0o077 == 0). Shared verbatim by requireInstalledDeployment (reconcile/tls)
// and update's pre-apply gate — the error strings MUST NOT change (tests assert them).
func (a *App) requirePrivateEnv() error {
	envPath := a.CfgDir + "/.env"
	fi, err := os.Lstat(envPath)
	if err != nil {
		return fmt.Errorf("no installed deployment at %s (%v); run `mathion install` first", a.CfgDir, err)
	}
	if !fi.Mode().IsRegular() {
		return fmt.Errorf(".env at %s is not a regular file; repair it or run `mathion install`", envPath)
	}
	if perm := fi.Mode().Perm(); perm&0o077 != 0 {
		return fmt.Errorf(".env at %s is group/world-accessible (%v); it holds secrets — fix with `chmod 600 %s`", envPath, perm, envPath)
	}
	return nil
}
```

Replace the first three checks inside `requireInstalledDeployment` with `if err := a.requirePrivateEnv(); err != nil { return err }`, leaving the `ReadState`/`ReadEnvFile`/`ValidateEnvComplete` tail unchanged.

- [ ] **Step 4: Run new unit + reconcile loose-perm regression + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run 'TestRequirePrivateEnv|TestReconcileRejectsLoosePermEnv|TestReconcileRequiresInstalledDeployment' -count=1`
Expected: PASS (message strings unchanged).

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/tls.go cli/cmd/tls_test.go
git commit -m "$(cat <<'EOF'
refactor(cli): extract requirePrivateEnv from requireInstalledDeployment

Shared .env regular-file + owner-only gate, strings verbatim, so update can enforce
the same fail-closed check reconcile already has. requireInstalledDeployment behavior
unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `committedPendingError` + exit-2 mapping + `RemoveJournal`-failure fold

**Files:**
- Modify: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `type committedPendingError struct{ err error }` (`Error`/`Unwrap`); `exitCode` returns 2 for it; the post-commit `RemoveJournal`-after-success failure now returns `committedPendingError` (was plain → exit 1).

- [ ] **Step 1: Write the exit-mapping test**

In `cli/cmd/update_test.go`:

```go
func TestExitCodeCommittedPending(t *testing.T) {
	if got := exitCode(committedPendingError{err: errors.New("x")}); got != 2 {
		t.Fatalf("committedPendingError → 2; got %d", got)
	}
	if got := exitCode(nil); got != 0 {
		t.Fatalf("nil → 0; got %d", got)
	}
	if got := exitCode(rollbackFailedError{err: errors.New("x")}); got != 3 {
		t.Fatalf("rollbackFailedError → 3; got %d", got)
	}
	if got := exitCode(errors.New("plain")); got != 1 {
		t.Fatalf("plain → 1; got %d", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails (undefined)**

Run: `cd cli && go test ./cmd/ -run TestExitCodeCommittedPending -count=1`
Expected: FAIL to compile (`committedPendingError` undefined).

- [ ] **Step 3: Add the type + exitCode arm; fold the RemoveJournal-failure**

In `cli/cmd/update.go` add beside `rollbackFailedError`:

```go
// committedPendingError: the image/DB update COMMITTED and the DB must NOT be rolled
// back, but required post-commit work (clear the recovery journal, or apply/verify the
// stack definition) did not finish. Exit 2 — distinct from 0/1/3.
type committedPendingError struct{ err error }

func (e committedPendingError) Error() string { return e.err.Error() }
func (e committedPendingError) Unwrap() error  { return e.err }
```

In `exitCode`, insert the arm **after** the `rollbackFailedError` check (so 3 keeps precedence):

```go
	var cpe committedPendingError
	if errors.As(err, &cpe) {
		return 2
	}
```

Wrap the post-commit `RemoveJournal`-failure return (currently `return fmt.Errorf("updated %s → %s successfully, but could not remove the recovery breadcrumb …")`) in `committedPendingError{err: fmt.Errorf(...same message...)}`.

- [ ] **Step 4: Run the exit test + full update suite + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run 'TestExitCode|TestUpdate' -count=1`
Expected: PASS. (A pre-existing test asserting the RemoveJournal-failure exit code, if any, is updated to `2` in this step.)

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/update_test.go
git commit -m "$(cat <<'EOF'
feat(cli): committedPendingError → exit 2; fold post-commit RemoveJournal failure

Exit-2 taxonomy = "image/DB commit completed; post-commit work/verification remains",
never "app currently serving". The existing post-commit breadcrumb-clear failure
(previously exit 1) now maps to 2 for a consistent post-commit meaning.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `applyAndGate` + `restorePrevCompose` + `runningAppImageID`

**Files:**
- Modify: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `func (a *App) applyAndGate(ctx, prev []byte, gateID, target string) (restored bool, err error)`; `func restorePrevCompose(ctx, a *App, prev []byte) bool`; `func runningAppImageID(ctx, a *App) (string, error)`; consts `restoreWaitTimeout`/`restoreWaitTimeoutSecs`.
- Consumes: `applyStack`, `clearApplyMarker`, `composePath` (Task 1); `gateFn` seam; `varlib.WriteMarker`, `tlsEnabledFromEnv`, `config.AtomicWrite`.
- These are not yet wired into `runUpdate` (Tasks 7–8); unit-tested directly here.

- [ ] **Step 1: Write the unit tests (success / apply-fail-restore / gate-fail-restore / restore-also-fails / runningAppImageID / len(prev) guard)**

In `cli/cmd/update_test.go` (uses `setupRestoreEnv`, `engineApp`, `asRoot`, `gateFn`, `hasCall`, `joinHas`):

```go
func TestApplyAndGateSuccessClearsMarkerAfterGate(t *testing.T) {
	asRoot(t)
	cfg := setupRestoreEnv(t)
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	orig := gateFn
	gateFn = func(ctx context.Context, a *App, id, tgt string, strict bool) error { return nil }
	t.Cleanup(func() { gateFn = orig })
	if err := varlib.WriteMarker(); err != nil { t.Fatal(err) } // caller writes marker before applyAndGate? No: applyAndGate writes it.
	// applyAndGate writes its own marker:
	_ = varlib.RemoveMarker()
	restored, err := app.applyAndGate(context.Background(), []byte("old-compose"), "sha256:R", "v9.9.9")
	if err != nil || restored {
		t.Fatalf("success → (false,nil); got (%v,%v)", restored, err)
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Fatal("marker must be cleared after a passing gate")
	}
}

func TestApplyAndGateApplyFailRestoresAndRetainsMarker(t *testing.T) {
	asRoot(t)
	cfg := setupRestoreEnv(t)
	prev := []byte("PREVIOUS-COMPOSE-BYTES\n")
	upCalls := 0
	f := &compose.FakeRunner{RunFunc: func(args []string) error {
		if len(args) > 0 && args[0] == "up" || (len(args) > 1 && args[1] == "up") {
			upCalls++
			if upCalls == 1 { return errors.New("apply up failed") } // fail the APPLY up, let the RESTORE up pass
		}
		return nil
	}}
	app, _, _ := engineApp(cfg, f, "")
	orig := gateFn
	gateFn = func(ctx context.Context, a *App, id, tgt string, strict bool) error { return nil }
	t.Cleanup(func() { gateFn = orig })
	restored, err := app.applyAndGate(context.Background(), prev, "sha256:R", "v9.9.9")
	if err == nil || !restored {
		t.Fatalf("apply-fail+restore-ok → (true, err); got (%v,%v)", restored, err)
	}
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("restore must rewrite prev bytes; got %q", got) // the clean discriminator
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Fatal("marker must be RETAINED on failure")
	}
}
```

Add analogous `TestApplyAndGateGateFailRestores` (gateFn returns error, apply `up` ok), `TestApplyAndGateRestoreAlsoFails` (both `up`s fail → `restored=false`), `TestRunningAppImageIDResolvesContainer` (OutputFunc returns a cid for `ps -q app`, then an image id for `inspect`), `TestRunningAppImageIDErrorsNoContainer` (empty `ps` → error), and `TestRestorePrevComposeEmptyPrevGuard` (`restorePrevCompose(ctx, app, nil) == false`, no `up` in Calls).

- [ ] **Step 2: Run to verify they fail (undefined)**

Run: `cd cli && go test ./cmd/ -run 'TestApplyAndGate|TestRunningAppImageID|TestRestorePrevCompose' -count=1`
Expected: FAIL to compile.

- [ ] **Step 3: Implement the three helpers + consts**

In `cli/cmd/update.go` (needs `import "bytes"` — added in Task 6, or add here if not present):

```go
const (
	restoreWaitTimeout     = 120 * time.Second
	restoreWaitTimeoutSecs = "120"
)

// applyAndGate writes the marker, materializes+brings up the NEW compose, re-asserts
// the strict gate against gateID, and clears the marker ONLY after the gate passes.
// On ANY failure it best-effort restores prev and RETAINS the marker. Lock-free.
// Returns (restored, err): restored says whether the pre-apply state is back in place.
// NEVER calls updateFailure/restoreEngine — no DB rollback is reachable here.
func (a *App) applyAndGate(ctx context.Context, prev []byte, gateID, target string) (bool, error) {
	if e := varlib.WriteMarker(); e != nil {
		// Compose untouched, app unchanged → "prior state intact, nothing to restore".
		return true, fmt.Errorf("could not record the pending stack apply: %w", e)
	}
	e := a.applyStack(ctx)
	if e == nil {
		e = gateFn(ctx, a, gateID, target, true)
	}
	if e != nil {
		return restorePrevCompose(ctx, a, prev), e // marker RETAINED → status/next-update self-heal
	}
	a.clearApplyMarker()
	return false, nil
}

// restorePrevCompose best-effort returns the deployment to its pre-apply, gate-proven
// stack definition. Bounded by a deadline AND --wait-timeout so a wedged restore cannot
// hold varlib.Lock forever; WithoutCancel so a late signal cannot abort the recovery.
// Guards an empty prev (writing 0 bytes would be worse than leaving what's there).
func restorePrevCompose(ctx context.Context, a *App, prev []byte) bool {
	if len(prev) == 0 {
		return false
	}
	if err := config.AtomicWrite(composePath(a), prev, 0o644); err != nil {
		return false
	}
	a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), restoreWaitTimeout)
	defer cancel()
	return a.compose(rctx, "up", "-d", "--wait", "--wait-timeout", restoreWaitTimeoutSecs, "--pull", "never") == nil
}

// runningAppImageID resolves the RUNNING app CONTAINER's image id (compose ps -q app →
// inspect <cid> --format {{.Image}}), the same anchor gateFn uses (gate.go:44-53). NOT a
// re-inspection of the tag, which would already reflect an out-of-band tag move. Errors
// out (no tag fallback) so a run without a resolvable running image aborts before mutating.
func runningAppImageID(ctx context.Context, a *App) (string, error) {
	cout, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
	if err != nil {
		return "", fmt.Errorf("resolving the running app container: %w", err)
	}
	cid := strings.TrimSpace(cout)
	if cid == "" {
		return "", errors.New("no running app container")
	}
	raw, err := a.Runner.Output(ctx, "inspect", cid, "--format", "{{.Image}}")
	if err != nil {
		return "", fmt.Errorf("inspecting the running app image: %w", err)
	}
	id := strings.TrimSpace(raw)
	if id == "" {
		return "", errors.New("running app container has no image id")
	}
	return id, nil
}
```

- [ ] **Step 4: Run the helper tests + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run 'TestApplyAndGate|TestRunningAppImageID|TestRestorePrevCompose' -count=1`
Expected: PASS. The apply-fail test's on-disk `== prev` assertion is the discriminator that proves the restore ran (both `up`s share args).

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/update_test.go
git commit -m "$(cat <<'EOF'
feat(cli): applyAndGate mini-transaction + bounded restore + running-image anchor

Shared marker-guarded apply: write marker -> applyStack -> re-assert strict gate ->
clear-on-success / best-effort time-bounded restore-on-failure. runningAppImageID
anchors on the running container's .Image (gate.go pattern), not the tag. Not yet
wired into runUpdate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `setupUpdateEnv` fixture + migrate existing update tests (I7 precondition)

**Files:**
- Modify: `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `func setupUpdateEnv(t *testing.T) string` = `setupRestoreEnv(t)` + writing `compose.ComposeYAML` to `<cfg>/docker-compose.yml` (so the fixture is **non-drifted** once `runUpdate` reads compose in Task 6).

- [ ] **Step 1: Add the helper**

```go
// setupUpdateEnv is setupRestoreEnv plus a NON-drifted on-disk compose (== the embed),
// so update tests are not spuriously "drifted" once runUpdate computes composeDiffers.
// Drift tests overwrite docker-compose.yml (or write the marker) explicitly.
func setupUpdateEnv(t *testing.T) string {
	t.Helper()
	cfg := setupRestoreEnv(t)
	if err := os.WriteFile(filepath.Join(cfg, "docker-compose.yml"), compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	return cfg
}
```

- [ ] **Step 2: Migrate every existing `runUpdate`/`newUpdateCmd` test that uses `setupRestoreEnv` to `setupUpdateEnv`**

Sweep `cli/cmd/update_test.go`: each test that drives `runUpdate`/`newUpdateCmd` with `setupRestoreEnv(t)` and expects today's behavior → switch to `setupUpdateEnv(t)`. Leave `setupBackupEnv` (incomplete-`.env`) tests and any engine-level test as-is. (`filepath` may need importing in `update_test.go`.)

- [ ] **Step 3: Run the full update suite (must be green BEFORE any drift wiring)**

Run: `cd cli && go test ./cmd/ -run TestUpdate -count=1`
Expected: PASS — behavior identical (compose is not read by `runUpdate` yet; the migration is a no-op until Task 6).

- [ ] **Step 4: Commit**

```bash
git add cli/cmd/update_test.go
git commit -m "$(cat <<'EOF'
test(cli): setupUpdateEnv (non-drifted compose fixture); migrate update tests

Precondition for wiring drift into update: seed docker-compose.yml == embed so
existing fixtures do not become spuriously drifted. No behavior change yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update preamble — `--no-reconcile`, `requirePrivateEnv` gate, drift signal, deferred reminder

**Files:**
- Modify: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `updateOpts.NoReconcile bool` + `--no-reconcile` flag; `requirePrivateEnv` enforced in `runUpdate` before mutation; package-local `composeDiffers`/`markerPresent`/`drift`/`wantApply` computed after step 1; `--no-reconcile`+drift reminder on the non-apply success paths. Adds `import "bytes"`.
- The apply branches themselves are wired in Tasks 7–8; here the branches keep today's behavior except the reminder.

- [ ] **Step 1: Write the preamble tests (perm gate; deferred reminder incl. compose-absent)**

```go
func TestUpdateRejectsLoosePermEnv(t *testing.T) {
	asRoot(t)
	cfg := setupUpdateEnv(t)
	if err := os.Chmod(cfg+"/.env", 0o644); err != nil { t.Fatal(err) }
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v9.9.9", Yes: true})
	if err == nil || !strings.Contains(err.Error(), "group/world-accessible") {
		t.Fatalf("want loose-perm rejection; got %v", err)
	}
	if len(f.Calls) != 0 {
		t.Fatalf("perm gate must precede any docker call; got %v", f.Calls)
	}
}

func TestUpdateNoReconcileDriftPrintsReminderEvenWhenComposeAbsent(t *testing.T) {
	cfg := setupRestoreEnv(t) // NOTE: no compose file → composeDiffers via read error
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"v0.1.1"}`))
	})
	f := &compose.FakeRunner{}
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true, NoReconcile: true}); err != nil {
		t.Fatalf("same-tag --no-reconcile → nil; got %v", err)
	}
	if !strings.Contains(out.String(), "was NOT applied (--no-reconcile)") {
		t.Fatalf("want deferred-apply reminder; got %q", out.String())
	}
	if hasCall(f.Calls, joinHas("up")) {
		t.Fatalf("--no-reconcile must NOT apply; got %v", f.Calls)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cli && go test ./cmd/ -run 'TestUpdateRejectsLoosePermEnv|TestUpdateNoReconcile' -count=1`
Expected: FAIL (`NoReconcile` field / behavior absent).

- [ ] **Step 3: Add the flag, the gate, the signal, the reminder**

In `newUpdateCmd`: add `var noReconcile bool`, `c.Flags().BoolVar(&noReconcile, "no-reconcile", false, "apply only the image upgrade; defer this release's stack-definition change")`, and pass `NoReconcile: noReconcile` into `updateOpts`. Add `NoReconcile bool` to `updateOpts`.

In `runUpdate`, at the very top (before `ReadEnvFile`): `if err := a.requirePrivateEnv(); err != nil { return err }`. After `oldTag := env["MATHION_VERSION"]` add (with `import "bytes"`):

```go
	onDisk, readErr := os.ReadFile(composePath(a))
	composeDiffers := readErr != nil || !bytes.Equal(onDisk, compose.ComposeYAML)
	markerPresent, _ := varlib.MarkerPresent()
	drift := composeDiffers || markerPresent
	wantApply := drift && !opts.NoReconcile
	_ = wantApply // consumed by the apply branches in Tasks 7–8
```

Add a small reminder helper and call it on the same-tag non-apply path and the real-upgrade success path:

```go
	if opts.NoReconcile && drift {
		fmt.Fprintln(a.Out, "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile")
	}
```

(Place these calls on the existing `return nil` success paths; do not yet touch the apply logic.)

- [ ] **Step 4: Run preamble tests + full update suite + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run TestUpdate -count=1`
Expected: PASS (existing tests unaffected — `wantApply` computed but unused; reminder only on `--no-reconcile`).

- [ ] **Step 5: Commit** (`git add cli/cmd/update.go cli/cmd/update_test.go`; message: `feat(cli): update preamble — --no-reconcile, private-env gate, drift signal, deferred reminder`).

---

### Task 7: Same-tag apply branch

**Files:**
- Modify: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Consumes: `applyAndGate`, `runningAppImageID` (Task 4); `wantApply`/`composeDiffers`/`onDisk` (Task 6); `appRunning`, `probeVersionOnce`.
- Same-tag apply failure returns a **plain error** (exit 1) — never `committedPendingError`.

- [ ] **Step 1: Write same-tag tests (apply-success; gate-fail→restore exit 1; app-not-running refuse; no-drift unchanged; stale-marker wording)**

Representative (add the full set — spec §7 tests 9–13):

```go
func TestUpdateSameTagDriftAppliesAndGates(t *testing.T) {
	asRoot(t)
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil { t.Fatal(err) }
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if joinHas("ps")(args) { return "cid123\n", nil }
		if len(args) >= 2 && args[0] == "inspect" { return "sha256:R\n", nil }
		return "", nil
	}}
	app, out, _ := engineApp(cfg, f, "")
	orig := gateFn
	gateFn = func(ctx context.Context, a *App, id, tgt string, strict bool) error {
		if id != "sha256:R" { t.Fatalf("gate must use captured running id; got %s", id) }
		return nil
	}
	t.Cleanup(func() { gateFn = orig })
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true}); err != nil {
		t.Fatalf("same-tag apply success → nil; got %v", err)
	}
	if hasCall(f.Calls, isPull) { t.Fatalf("same-tag must not pull the target image; got %v", f.Calls) }
	if !strings.Contains(out.String(), "applied this CLI's stack definition") { t.Fatalf("got %q", out.String()) }
	if present, _ := varlib.MarkerPresent(); present { t.Fatal("marker must be cleared on success") }
}

func TestUpdateSameTagGateFailRestoresExit1(t *testing.T) {
	asRoot(t)
	cfg := setupUpdateEnv(t)
	prev, _ := os.ReadFile(composePath(&App{CfgDir: cfg}))
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if joinHas("ps")(args) { return "cid123\n", nil }
		if len(args) >= 2 && args[0] == "inspect" { return "sha256:R\n", nil }
		return "", nil
	}}
	// drift the on-disk compose so wantApply=true
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil { t.Fatal(err) }
	app, _, _ := engineApp(cfg, f, "")
	orig := gateFn
	gateFn = func(ctx context.Context, a *App, id, tgt string, strict bool) error { return errors.New("gate: moved tag") }
	t.Cleanup(func() { gateFn = orig })
	err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true})
	if err == nil { t.Fatal("gate failure must error") }
	if exitCode(err) != 1 { t.Fatalf("same-tag failure is exit 1 (nothing committed); got %d", exitCode(err)) }
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("previous compose must be restored; got %q", got)
	}
	if present, _ := varlib.MarkerPresent(); !present { t.Fatal("marker retained on failure") }
}
```

Add `TestUpdateSameTagDriftAppNotRunningRefuses`, `TestUpdateSameTagNoDriftUnchanged`, `TestUpdateSameTagStaleMarkerWording` (marker present, compose==embed → confirm text does not claim "this release updates the stack definition").

- [ ] **Step 2: Run to verify failure** — `cd cli && go test ./cmd/ -run TestUpdateSameTag -count=1` → FAIL.

- [ ] **Step 3: Replace the same-tag block** (`update.go` current `if target == oldTag { … }`) with spec §4.3's same-tag branch:

```go
	if target == oldTag {
		if wantApply {
			if !a.appRunning(ctx) {
				return errors.New("this release's stack definition needs applying, but the stack is not running; start it with `sudo mathion start`, then `sudo mathion reconcile` (or re-run update)")
			}
			if !opts.Yes {
				msg := "a previous stack apply did not finish; re-apply this CLI's stack definition now?"
				if composeDiffers {
					msg = "this release updates the stack definition; apply it now?"
				}
				fmt.Fprintf(a.Out, "%s any changed service is briefly recreated (an HTTPS interruption if the bundled proxy changed). Continue? [y/N] ", msg)
				line, _ := bufio.NewReader(a.In).ReadString('\n')
				if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
					return errors.New("update cancelled")
				}
			}
			stID, err := runningAppImageID(ctx, a)
			if err != nil {
				return err
			}
			restored, applyErr := a.applyAndGate(ctx, onDisk, stID, target)
			if applyErr != nil {
				if restored {
					return fmt.Errorf("applying this CLI's stack definition failed (%w); the previous definition is in place and the stack is running — retry with `sudo mathion reconcile`", applyErr)
				}
				return fmt.Errorf("applying this CLI's stack definition failed (%w) AND restoring the previous definition also failed; the runtime may be degraded — run `mathion status`, then `sudo mathion reconcile`", applyErr)
			}
			fmt.Fprintf(a.Out, "applied this CLI's stack definition (%s); run `mathion status` to confirm.\n", buildVersion)
			return nil
		}
		pass, _, _ := probeVersionOnce(ctx, target, true)
		if pass {
			fmt.Fprintf(a.Out, "already at %s; nothing to do\n", target)
		} else {
			fmt.Fprintf(a.Out, "already pinned to %s; a same-version refresh is not supported. To redeploy or repair a broken deployment, use mathion restore or reinstall.\n", target)
		}
		if opts.NoReconcile && drift {
			fmt.Fprintln(a.Out, "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile")
		}
		return nil
	}
```

- [ ] **Step 4: Run same-tag tests + full update suite + vet/build** — `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run TestUpdate -count=1` → PASS.

- [ ] **Step 5: Commit** (`git add cli/cmd/update.go cli/cmd/update_test.go`; `feat(cli): same-tag update applies drifted compose (restore-bounded, post-apply gate, exit 1)`).

---

### Task 8: Real-upgrade post-commit apply + confirm-plan line

**Files:**
- Modify: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Consumes: `applyAndGate` (Task 4), `committedPendingError` (Task 3), `wantApply`/`onDisk`/`A` (Tasks 4/6). Real-upgrade apply failure → `committedPendingError` (exit 2), **never** rollback.

- [ ] **Step 1: Write real-upgrade tests (drift→post-commit apply; no-drift→no second up; apply-fail→restore+isolation exit 2; restore-also-fails; --no-reconcile+drift)**

Representative isolation test (spec §7 test 4 — load-bearing):

```go
func TestUpdateRealUpgradePostCommitApplyFailureIsolatedExit2(t *testing.T) {
	asRoot(t)
	cfg := setupUpdateEnv(t)
	prev, _ := os.ReadFile(composePath(&App{CfgDir: cfg}))
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil { t.Fatal(err) }
	prev, _ = os.ReadFile(composePath(&App{CfgDir: cfg})) // prev == the drifted on-disk bytes read at runUpdate step 1
	upCount := 0
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			if len(args) >= 2 && args[0] == "image" && args[1] == "inspect" { return "sha256:A\n", nil }
			if joinHas("ps")(args) { return "cidA\n", nil }
			if len(args) >= 2 && args[0] == "inspect" { return "sha256:A\n", nil }
			return "", nil
		},
		RunFunc: func(args []string) error {
			if head(args) == "up" || (len(args) > 1 && args[1] == "up") {
				upCount++
				// let the app recreate (step 9) + restore up pass; fail ONLY the post-commit whole-project apply up
				if joinHas("--wait")(args) && !hasApp(args) && upCount >= 1 && upCount == 2 { return errors.New("apply up failed") }
			}
			return nil
		},
	}
	app, _, _ := engineApp(cfg, f, "")
	// gate passes (commit) then re-assert passes only for the recreate; make applyStack's up fail via RunFunc above.
	orig := gateFn
	gateFn = func(ctx context.Context, a *App, id, tgt string, strict bool) error { return nil }
	t.Cleanup(func() { gateFn = orig })
	err := runUpdate(context.Background(), app, updateOpts{Version: "v9.9.9", Yes: true})
	if exitCode(err) != 2 { t.Fatalf("post-commit apply failure → exit 2; got %d (%v)", exitCode(err), err) }
	if hasCall(f.Calls, joinHas("run")) && hasCall(f.Calls, isRestoreEngineMarker) { /* n/a */ }
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("previous compose must be restored; got %q", got)
	}
	if present, _ := varlib.MarkerPresent(); !present { t.Fatal("marker retained") }
	// journal cleared pre-apply:
	if _, err := os.Stat(varlib.JournalPath()); !os.IsNotExist(err) { t.Fatal("journal must be absent (cleared pre-apply)") }
}
```

*(The exact `RunFunc` invocation-count predicate is the implementer's to finalize against the real step-9/step-apply/step-restore `up` sequence; the assertion set — exit 2, on-disk == prev, marker present, journal absent, **no** restore-engine/backup-restore call in `Calls` — is fixed.)* Add `TestUpdateRealUpgradeDriftAppliesWholeProjectAfterGate` (second whole-project `up` after the app-only recreate + first gate; on-disk == embed; `gateFn` called twice), `TestUpdateRealUpgradeNoDriftNoSecondUp`, `TestUpdateRealUpgradeRestoreAlsoFails`, `TestUpdateRealUpgradeNoReconcileDrift`.

- [ ] **Step 2: Run to verify failure** — `cd cli && go test ./cmd/ -run TestUpdateRealUpgrade -count=1` → FAIL.

- [ ] **Step 3: Wire the post-commit apply + confirm line**

In `runUpdate`'s confirm block, when `composeDiffers`, append a line before "Continue?": *"This release also updates the stack definition; it is applied after the update completes (brief HTTPS interruption if the bundled proxy changed)."*

After the `RemoveJournal()`-success point (the block that returns the committedPendingError from Task 3 stays as the *failure* branch; on success fall through), insert before the final `updated %s → %s (backup …)` print:

```go
	if wantApply {
		restored, applyErr := a.applyAndGate(ctx, onDisk, A, target)
		if applyErr != nil {
			if restored {
				return committedPendingError{err: fmt.Errorf("updated to %s and it is serving; applying this release's stack definition failed (%w) and the previous definition is in place — the database is intact, re-apply with: sudo mathion reconcile", target, applyErr)}
			}
			return committedPendingError{err: fmt.Errorf("updated to %s (database committed and NOT rolled back), but applying this release's stack definition failed (%w) AND restoring the previous definition also failed; the runtime may be degraded — run `mathion status`, then `sudo mathion reconcile`", target, applyErr)}
		}
		fmt.Fprintf(a.Out, "updated %s → %s and applied this release's stack definition (%s) (backup: %s; prune old backups manually)\n", oldTag, target, buildVersion, backupPath)
		return nil
	}
	if opts.NoReconcile && drift {
		fmt.Fprintln(a.Out, "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile")
	}
	fmt.Fprintf(a.Out, "updated %s → %s (backup: %s; prune old backups manually)\n", oldTag, target, backupPath)
	return nil
```

- [ ] **Step 4: Run real-upgrade tests + FULL cmd suite + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -count=1`
Expected: PASS (entire `cmd` package).

- [ ] **Step 5: Commit** (`git add cli/cmd/update.go cli/cmd/update_test.go`; `feat(cli): real-upgrade update applies stack post-commit (exit-2 committedPending, restore net)`).

---

### Task 9: README "Upgrading" documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the note** under the self-hosting/upgrading section:
  - `mathion update` now also applies this release's embedded **stack definition** (not just the app image); one `update` brings the deployment fully up to the CLI release.
  - `--no-reconcile` applies only the image upgrade and defers the stack change (a drift notice reminds you).
  - **Behavior change:** a same-tag `update --yes` on a host whose compose drifted now applies it (a formerly no-op call can briefly recreate the bundled TLS proxy → short HTTPS blip).
  - **Exit code 2** = "the image/database update committed, but applying/verifying the stack definition is still pending — re-run `sudo mathion reconcile`" (the app is up; the DB is never rolled back). Same-tag apply failures are exit 1 (nothing committed).

- [ ] **Step 2: Verify no build impact** — `cd cli && go build ./...` (docs-only; sanity).

- [ ] **Step 3: Commit** (`git add README.md`; `docs: mathion update applies the stack definition; --no-reconcile; exit-2 semantics`).

---

## Self-Review (completed)

- **Spec coverage:** §4.1 applyStack/clearApplyMarker/composePath → T1; §4.6 requirePrivateEnv → T2; §4.4 committedPendingError/exit-2/RemoveJournal-fold → T3; §4.4 applyAndGate/restorePrevCompose/runningAppImageID → T4; §7 fixture migration → T5; §4.2 flag/signal/reminder → T6; §4.3 same-tag → T7; §4.3 real-upgrade → T8; §8 docs → T9. All spec sections covered.
- **Placeholder scan:** all code steps carry real code; the one deliberately-flagged implementer freedom (T8 step-1 `RunFunc` invocation-count predicate) has a fixed assertion set and rationale, not a TBD.
- **Type consistency:** `applyStack`/`clearApplyMarker`/`composePath` (T1) consumed by T4/T7/T8; `committedPendingError` (T3) by T8; `applyAndGate`/`runningAppImageID`/`restorePrevCompose` (T4) by T7/T8; `setupUpdateEnv` (T5) by T6/T7/T8; `NoReconcile`/`wantApply`/`onDisk`/`composeDiffers` (T6) by T7/T8. `gateFn`(ctx,*App,string,string,bool) signature matches every call site. Ordering respects all dependencies (T1→T4; T2→T6; T3,T4,T6→T7/T8; T5 before T6).

---

## Execution Handoff

Recommended: **Subagent-Driven** (per project convention) — fresh implementer per task, **Opus 4.8 at xhigh** for every implementer + reviewer, **codex@high** as the second independent gate, per-task dual gate (fix all Critical/Important, re-review after every fix), then a whole-branch dual-gate review, then `superpowers:finishing-a-development-branch`.
