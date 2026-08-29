# Auto-reconcile-on-upgrade Slice A — Precise Drift Nudges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Mathion CLI's compose-drift signal precise and route it to every upgrade channel (self-update, apt, install.sh re-run) — detect + report only, no Docker/container/lock/proxy/file-write.

**Architecture:** Harden the shared `composeDrifted` read (non-blocking open + fstat-on-fd + bounded read via a testable `driftFromReader` seam), which makes `maybeWarnComposeDrift` reusable on every surface. Route it through a new root `PersistentPreRunE` (stderr, on the next non-excluded management command), a hidden `_drift-probe` `main.go` fast-path invoked by the `.deb` postinstall (bounded by `timeout --kill-after`), and an honest neutral `self-update` line — removing the false "always says run reconcile" nudge.

**Tech Stack:** Go 1.24, cobra 1.8.1, module `github.com/svkucheryavski/mathion/cli`; POSIX `sh` maintainer script; GNU coreutils `timeout`.

**Spec:** `docs/superpowers/specs/2026-08-29-auto-reconcile-upgrade-slice-a-precise-nudges.md` (converged over 7 review rounds; read it — the plan argues from it).

## Global Constraints

- **No Docker, no container mutation, no lock, no compose write, no marker write anywhere in Slice A.** Every surface is a pure read that prints or stays silent.
- **The apt postinstall must not wedge dpkg** (bounded except a documented D-state residual): `timeout --kill-after=1s 5s` + `|| true` + the existing `exit 0` floor. Shell must be **SC2015-safe** — never the `A && B || C` shape (use `if [ … ] && [ … ]; then …; fi`, and `timeout … || true` which is `A || C`).
- **Root-context detection** is intentional; `/etc/mathion` + `/var/lib/mathion` are `0o700`, so non-root reads fail-quiet to silence. All operator-facing hints say **`sudo mathion …`**.
- **Precedence (spec §5), never a false claim:** compose absent (`ENOENT`) → silent FIRST; else warn iff on-disk bytes differ OR the apply-pending marker is present; any open/stat/read error or a non-regular file → fail-quiet on the bytes but the marker is still consulted → `(false, true)`.
- **`deploy/**` shell is shellcheck-gated** by the CI `apt-scripts` job (non-root, globs `deploy/deb/*.sh`); the root apt harness is the CI `apt-e2e` job.
- **Formatting/build gate:** `test -z "$(cd cli && gofmt -l .)"` (assert empty — `gofmt -l` exits 0 even when files need formatting; `gofmt -l ./...` is invalid), then `cd cli && go vet ./... && go build ./... && go test ./... -count=1` green.
- **Commit trailer, EXACT:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `git add` **exact named paths only** (never `-A`/`.`).

---

## File Structure

- `cli/cmd/version.go` (modify) — harden `composeDrifted`; add the `driftFromReader` seam. `maybeWarnComposeDrift` logic unchanged.
- `cli/cmd/drift_test.go` (modify) — add `driftFromReader` unit tests (equal/shorter/longer/prefix + injected-`EIO` exact-tuple) and a non-regular (FIFO) `composeDrifted` case.
- `cli/cmd/drift_probe.go` (create) — `RunDriftProbe(w io.Writer)` = `resolveCfgDir()` + `maybeWarnComposeDrift`.
- `cli/cmd/drift_probe_test.go` (create) — drift/absent/cfgDir-honored probe cases.
- `cli/main.go` (modify) — `_drift-probe` fast-path before `Execute()`.
- `cli/cmd/root.go` (modify) — root `PersistentPreRunE` + `driftHookExcluded` predicate.
- `cli/cmd/root_test.go` (create) — pre-run per-stream + exclusion predicate + recursive-hook guard + mutation-safety.
- `cli/cmd/status.go` (modify) — remove the redundant `maybeWarnComposeDrift` call; update the comment. Keep `maybeWarnInstallIncomplete`.
- `cli/cmd/status_test.go` (modify) — migrate the two `TestStatusEmitsDrift*` to the root-`Execute` harness with split `Out`/`Err`.
- `cli/internal/selfupdate/run_linux.go` (modify) — neutral post-swap line + comment.
- `cli/internal/selfupdate/run_linux_test.go` (modify) — assert the new neutral line + absence of the old phrase.
- `deploy/deb/postinst.sh` (modify) — `timeout --kill-after`-bounded probe call with shadow-risk precedence.
- `deploy/apt/e2e_test.sh` (modify) — direct-postinst logic tests (shadow / timeout-path / missing-binary) + a real-install drifted-path assertion.

---

## Task 1: Harden `composeDrifted` + add the `driftFromReader` seam

**Files:**
- Modify: `cli/cmd/version.go:66-80` (the `composeDrifted` function) + imports.
- Test: `cli/cmd/drift_test.go` (add tests).

**Interfaces:**
- Consumes: `compose.ComposeYAML []byte` (embed), `varlib.MarkerPresent() (bool, error)`.
- Produces: `composeDrifted(cfgDir string) (drifted, present bool)` (contract preserved: `ENOENT`→`(false,false)`; other error / non-regular →`(false,true)`; regular → byte-compare). New unexported `driftFromReader(r io.Reader, embed []byte) (drifted, present bool)`.

- [ ] **Step 1: Write the failing tests** (append to `cli/cmd/drift_test.go`). Add a `syscall` import to the test file.

```go
// --- driftFromReader: the read+compare+mapping seam (spec §4.3a) ---

// errInjectedRead is a non-EOF read error used to drive the post-open read-error branch
// hermetically (a real FIFO/EACCES fixture exercises open, not Read).
var errInjectedRead = errors.New("injected read error")

// eioReader yields some bytes then a non-EOF error on the SAME Read, mimicking a partial
// read that then fails (io.ReadAll surfaces the error). It records that it was read.
type eioReader struct{ read bool }

func (r *eioReader) Read(p []byte) (int, error) {
	r.read = true
	n := copy(p, []byte("partial"))
	return n, errInjectedRead
}

func TestDriftFromReaderMapping(t *testing.T) {
	embed := []byte("aaaa")
	cases := []struct {
		name        string
		in          []byte
		wantDrifted bool
	}{
		{"equal", []byte("aaaa"), false},
		{"shorter", []byte("aaa"), true},
		{"longer", []byte("aaaaa"), true},
		{"prefix-equal-then-extra", []byte("aaaaX"), true},
		{"same-len-diff", []byte("aaab"), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			drifted, present := driftFromReader(bytes.NewReader(c.in), embed)
			if drifted != c.wantDrifted || !present {
				t.Fatalf("driftFromReader(%q) = (%v,%v), want (%v,true)", c.in, drifted, present, c.wantDrifted)
			}
		})
	}
}

func TestDriftFromReaderReadErrorMapsToUnreadable(t *testing.T) {
	r := &eioReader{}
	drifted, present := driftFromReader(r, []byte("aaaa"))
	if drifted != false || present != true {
		t.Fatalf("read error must map to (false,true); got (%v,%v)", drifted, present)
	}
	if !r.read {
		t.Fatal("the reader must have been read (seam not invoked)")
	}
}

// A non-regular (FIFO) compose is present-but-unreadable: composeDrifted returns
// (false,true) WITHOUT hanging on the open, and maybeWarnComposeDrift then warns iff a
// marker is present.
func TestComposeDriftedFifoIsPresentUnreadable(t *testing.T) {
	dir := t.TempDir()
	fifo := filepath.Join(dir, "docker-compose.yml")
	if err := syscall.Mkfifo(fifo, 0o644); err != nil {
		t.Skipf("mkfifo unsupported here: %v", err)
	}
	drifted, present := composeDrifted(dir)
	if drifted != false || present != true {
		t.Fatalf("a FIFO compose must be (false,true); got (%v,%v)", drifted, present)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cli && go test ./cmd/ -run 'DriftFromReader|Fifo' -v`
Expected: FAIL — `driftFromReader` undefined (build error).

- [ ] **Step 3: Implement the hardened `composeDrifted` + seam** (replace `cli/cmd/version.go:66-80`). Add `"syscall"` to the import block.

```go
// driftFromReader reads the compose bytes from r (the opened+fstat'd regular file, or an
// injected reader in tests) and reports drift vs embed, plus present=true. It bounds the
// read to len(embed)+1 bytes (the +1 distinguishes embed from embed+extra) and maps ANY
// read error to (false, true) — present-but-unreadable: fail-quiet on the drift signal,
// never a false claim (spec §4.3a / §5 rule 3). Factored out so the error→(false,true)
// mapping is unit-testable with an injected failing reader.
func driftFromReader(r io.Reader, embed []byte) (drifted, present bool) {
	buf, err := io.ReadAll(io.LimitReader(r, int64(len(embed))+1))
	if err != nil {
		return false, true
	}
	return !(len(buf) == len(embed) && bytes.Equal(buf, embed)), true
}

// composeDrifted reports whether the on-disk compose at cfgDir differs from this binary's
// embedded revision, and whether a compose file is present at all. Hardened (spec §4.3a)
// to be FIFO-safe + byte-bounded: a non-blocking open + an fstat on the OPENED fd (no
// Stat->Open TOCTOU) rejects a non-regular file before any read, and the read is bounded
// via driftFromReader. absent (ENOENT) -> (false, false); any other open/stat/read error,
// or a non-regular file -> (false, true) (present but unreadable). NOT wall-clock-bounded
// against a broken filesystem mount (Linux ignores O_NONBLOCK for regular files); the dpkg
// path is separately timeout-bounded (spec §4.3b).
func composeDrifted(cfgDir string) (drifted, present bool) {
	f, err := os.OpenFile(filepath.Join(cfgDir, "docker-compose.yml"), os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, false
		}
		return false, true
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return false, true
	}
	return driftFromReader(f, compose.ComposeYAML)
}
```

- [ ] **Step 4: Run the new tests + the existing drift suite to verify all pass**

Run: `cd cli && go test ./cmd/ -run 'Drift|Fifo' -v`
Expected: PASS — the 5 pre-existing `TestComposeDrift*` tests (regular temp files: differ→warn, marker+match→warn, absent+marker→silent, match-no-marker→silent, cfgDir-honored→warn) stay green, plus the 3 new tests pass.

- [ ] **Step 5: Verify the whole package + formatting**

Run: `cd cli && test -z "$(gofmt -l .)" && go vet ./... && go build ./... && go test ./cmd/ -count=1`
Expected: PASS, no output from gofmt.

- [ ] **Step 6: Commit**

```bash
git add cli/cmd/version.go cli/cmd/drift_test.go
git commit -m "$(cat <<'EOF'
feat(cli): harden composeDrifted (FIFO-safe, byte-bounded) + driftFromReader seam

Non-blocking open + fstat-on-fd rejects a non-regular compose before any read;
the read is bounded to len(embed)+1 via the driftFromReader seam, whose error->
(false,true) mapping is now unit-testable with an injected failing reader. Slice A
spec §4.3a. Preserves composeDrifted's (drifted,present) contract; existing drift
tests stay green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `RunDriftProbe` + the `_drift-probe` `main.go` fast-path

**Files:**
- Create: `cli/cmd/drift_probe.go`
- Modify: `cli/main.go:12-15` (the `main` function) + imports.
- Test: `cli/cmd/drift_probe_test.go` (create)

**Interfaces:**
- Consumes: `resolveCfgDir() string` (root.go:92), `maybeWarnComposeDrift(w, cfgDir)` (hardened via Task 1).
- Produces: `RunDriftProbe(w io.Writer)` (exported for `main.go`).

- [ ] **Step 1: Write the failing test** (`cli/cmd/drift_probe_test.go`). Reuses the `driftNote` const and `varlibReady` helper already in the package.

```go
package cmd

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestRunDriftProbeWarnsOnDrift(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	t.Setenv("MATHION_CONFIG_DIR", dir) // RunDriftProbe resolves via resolveCfgDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	RunDriftProbe(&out)
	if !strings.Contains(out.String(), driftNote) {
		t.Fatalf("probe must warn on drift; got %q", out.String())
	}
}

func TestRunDriftProbeSilentWhenAbsent(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir() // no docker-compose.yml
	t.Setenv("MATHION_CONFIG_DIR", dir)
	var out bytes.Buffer
	RunDriftProbe(&out)
	if out.Len() != 0 {
		t.Fatalf("probe must be silent when compose is absent; got %q", out.String())
	}
}

func TestRunDriftProbeSilentWhenMatchNoMarker(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	t.Setenv("MATHION_CONFIG_DIR", dir)
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	RunDriftProbe(&out)
	if out.Len() != 0 {
		t.Fatalf("probe must be silent when compose matches and no marker; got %q", out.String())
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && go test ./cmd/ -run RunDriftProbe -v`
Expected: FAIL — `RunDriftProbe` undefined.

- [ ] **Step 3: Create `cli/cmd/drift_probe.go`**

```go
package cmd

import "io"

// RunDriftProbe writes the precise compose-drift notice (spec §4.3a / §5) to w and
// returns. It is the body of the hidden `_drift-probe` fast-path invoked by the .deb
// postinstall: it reuses resolveCfgDir + the hardened maybeWarnComposeDrift, deliberately
// BYPASSING cobra's Execute() (no unbounded .env/TLS read, no App, no lock, no Runner) so
// it can never take a Docker/compose action and can never hang dpkg on the .env read.
// Advisory only — the caller always returns exit 0.
func RunDriftProbe(w io.Writer) {
	maybeWarnComposeDrift(w, resolveCfgDir())
}
```

- [ ] **Step 4: Wire the fast-path in `cli/main.go`** (replace the `main` function; add `"os"` to imports).

```go
package main

import (
	"os"

	"github.com/svkucheryavski/mathion/cli/cmd"
)

// Overridden by goreleaser ldflags at release; non-empty defaults so plain
// `go build` (tests/CI) works.
var (
	version      = "dev"
	defaultImage = "v0.1.1"
)

func main() {
	// Hidden, bounded, file-only drift probe for the .deb postinstall (spec §4.3).
	// A main.go fast-path (NOT a cobra command) so it never enters Execute()'s
	// unconditional .env/TLS read and never appears in help/completion/the pre-run.
	if len(os.Args) >= 2 && os.Args[1] == "_drift-probe" {
		cmd.RunDriftProbe(os.Stdout)
		return
	}
	cmd.SetBuildInfo(version, defaultImage)
	cmd.Execute()
}
```

- [ ] **Step 5: Run the probe tests + build the binary + smoke the fast-path**

Run: `cd cli && go test ./cmd/ -run RunDriftProbe -count=1 && go build -o /tmp/mathion-probe . && MATHION_CONFIG_DIR=/nonexistent /tmp/mathion-probe _drift-probe; echo "exit=$?"`
Expected: tests PASS; the built binary prints nothing (absent compose → silent) and `exit=0`.

- [ ] **Step 6: Verify formatting + whole package**

Run: `cd cli && test -z "$(gofmt -l .)" && go vet ./... && go test ./cmd/ -count=1`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/cmd/drift_probe.go cli/cmd/drift_probe_test.go cli/main.go
git commit -m "$(cat <<'EOF'
feat(cli): _drift-probe main.go fast-path + RunDriftProbe (apt-time drift notice)

RunDriftProbe reuses resolveCfgDir + the hardened maybeWarnComposeDrift and is
dispatched from a main.go fast-path (os.Args[1]=="_drift-probe") that bypasses
cobra Execute() entirely — no unbounded .env/TLS read, no App/Runner/lock — so the
.deb postinstall can print the precise drift line without any risk of a Docker
action or a dpkg-wedging read. Slice A spec §4.3a. Postinstall wiring is Task 5.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Root `PersistentPreRunE` + exclusion predicate + relocate the drift note off `status`

This is one coupled change: the pre-run takes OWNERSHIP of the drift note (on stderr, globally) and `status` RELEASES it. They land together — otherwise a `status`-through-`Execute` test would see the note on BOTH streams, or `status` would lose it entirely.

**Files:**
- Modify: `cli/cmd/root.go:106-120` (`newRootCmd`) — add `PersistentPreRunE` + the `driftHookExcluded` predicate.
- Modify: `cli/cmd/status.go:25-30` — remove the `maybeWarnComposeDrift(app.Out, …)` call (line 30) + update the comment.
- Test: `cli/cmd/root_test.go` (create); `cli/cmd/status_test.go` (migrate).

**Interfaces:**
- Consumes: `maybeWarnComposeDrift(w, cfgDir)`, `App.Err`, `App.CfgDir`, cobra `*cobra.Command` (`Name()`, `Parent()`, `Flags().GetBool`).
- Produces: `driftHookExcluded(c *cobra.Command) bool`; the root command now carries `PersistentPreRunE`.

- [ ] **Step 1: Write the failing predicate + hook-guard tests** (`cli/cmd/root_test.go`).

```go
package cmd

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

func findCmd(root *cobra.Command, args ...string) *cobra.Command {
	c, _, err := root.Find(args)
	if err != nil {
		return nil
	}
	return c
}

// The principled exclusion set (spec §4.1): commands that re-materialize the compose and
// report their own next-step, teardown, self-update, and machine/first-contact surfaces.
func TestDriftHookExcludedPredicate(t *testing.T) {
	root := newRootCmd(&App{})
	for _, name := range []string{"reconcile", "update", "install", "uninstall", "self-update"} {
		if c := findCmd(root, name); c == nil || !driftHookExcluded(c) {
			t.Errorf("%q must be excluded", name)
		}
	}
	// version: excluded ONLY with --short.
	v := findCmd(root, "version")
	if v == nil || driftHookExcluded(v) {
		t.Error("bare `version` must NOT be excluded")
	}
	if err := v.Flags().Set("short", "true"); err != nil {
		t.Fatal(err)
	}
	if !driftHookExcluded(v) {
		t.Error("`version --short` must be excluded")
	}
	// a representative non-excluded management command fires.
	if s := findCmd(root, "status"); s == nil || driftHookExcluded(s) {
		t.Error("`status` must NOT be excluded")
	}
	// completion is excluded by ANCESTRY, so `completion bash` (leaf named "bash") is caught.
	parent := &cobra.Command{Use: "completion"}
	child := &cobra.Command{Use: "bash"}
	parent.AddCommand(child)
	if !driftHookExcluded(child) {
		t.Error("`completion bash` (leaf `bash`, parent `completion`) must be excluded by ancestry")
	}
	if driftHookExcluded(&cobra.Command{Use: "somethingelse"}) {
		t.Error("an unrelated leaf must NOT be excluded")
	}
}

// No DESCENDANT may define its own PersistentPreRun* — cobra runs only the most-specific
// one, so a descendant hook would silently suppress the root's drift pre-run (spec §7).
func TestNoDescendantDefinesPersistentPreRun(t *testing.T) {
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			if sub.PersistentPreRun != nil || sub.PersistentPreRunE != nil {
				t.Errorf("%q defines a PersistentPreRun* that would suppress the root drift hook", sub.Name())
			}
			walk(sub)
		}
	}
	walk(newRootCmd(&App{}))
}

// The pre-run prints the drift note to Err (not Out) for a non-excluded command, and is
// silent for an excluded one — asserted by COUNTING the drift string per stream.
func TestPreRunRoutesDriftToStderr(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// version --short is EXCLUDED → no drift note anywhere; bare version is non-excluded.
	run := func(args ...string) (out, errb string) {
		var o, e bytes.Buffer
		app := &App{CfgDir: dir, Project: "mathion_prod", Out: &o, Err: &e, In: bytes.NewReader(nil)}
		root := newRootCmd(app)
		root.SetArgs(args)
		root.SetOut(&o)
		root.SetErr(&e)
		_ = root.ExecuteContext(context.Background())
		return o.String(), e.String()
	}
	// bare `version` (non-excluded, no Docker) → drift on Err, none on Out.
	out, errb := run("version")
	if !strings.Contains(errb, driftNote) {
		t.Errorf("non-excluded command must print drift on stderr; got err=%q", errb)
	}
	if strings.Contains(out, driftNote) {
		t.Errorf("drift must be on stderr, not stdout; got out=%q", out)
	}
	// `version --short` (excluded) → no drift string on either stream.
	out, errb = run("version", "--short")
	if strings.Contains(out, driftNote) || strings.Contains(errb, driftNote) {
		t.Errorf("excluded command must emit no drift; got out=%q err=%q", out, errb)
	}
}

// Mutation-safety (spec §6): the hook only READS — invoking it directly performs no
// Runner call, no marker write, no compose write.
func TestPreRunIsReadOnly(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var e bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &bytes.Buffer{}, Err: &e}
	root := newRootCmd(app)
	if err := root.PersistentPreRunE(findCmd(root, "status"), nil); err != nil {
		t.Fatalf("pre-run must never error; got %v", err)
	}
	if fr := app.Runner.(*compose.FakeRunner); len(fr.Calls) != 0 {
		t.Errorf("pre-run must not invoke the Runner; got %v", fr.Calls)
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("pre-run must not write the apply-pending marker")
	}
	if b, _ := os.ReadFile(dir + "/docker-compose.yml"); string(b) != "stale: true\n" {
		t.Error("pre-run must not rewrite the on-disk compose")
	}
	if !strings.Contains(e.String(), driftNote) {
		t.Errorf("pre-run should still have printed the drift note (proving it ran); got %q", e.String())
	}
}
```

> **Note on `compose.FakeRunner`:** its recorded-calls field is `Calls [][]string` (`cli/internal/compose/runner.go:203`) — the assertion `len(fr.Calls) != 0` in `TestPreRunIsReadOnly` is correct as written.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cli && go test ./cmd/ -run 'DriftHook|Descendant|PreRun' -v`
Expected: FAIL — `driftHookExcluded` undefined and `root.PersistentPreRunE` is nil.

- [ ] **Step 3: Add the pre-run + predicate to `cli/cmd/root.go`** (add `"github.com/spf13/cobra"` is already imported). Insert `driftHookExcluded` above `newRootCmd`, and set `root.PersistentPreRunE` inside `newRootCmd`.

```go
// driftHookExcluded reports whether the compose-drift pre-run notice must be SUPPRESSED
// for the executing command c (spec §4.1): commands that re-materialize the embedded
// compose and report their own next-step (reconcile/update/install), teardown (uninstall),
// self-update (owns its post-swap line), and machine/first-contact surfaces (version
// --short, the completion machinery by ancestry, help, __complete). --help and
// non-runnable parents short-circuit to flag.ErrHelp BEFORE the pre-run, so they need no
// entry here.
func driftHookExcluded(c *cobra.Command) bool {
	for p := c; p != nil; p = p.Parent() {
		if p.Name() == "completion" {
			return true
		}
	}
	switch c.Name() {
	case "__complete", "help", "reconcile", "update", "install", "uninstall", "self-update":
		return true
	case "version":
		short, _ := c.Flags().GetBool("short") // flags are parsed before the pre-run runs
		return short
	}
	return false
}
```

Inside `newRootCmd`, after building `root := &cobra.Command{…}` and BEFORE `root.AddCommand(…)`:

```go
	// Route the precise compose-drift notice to stderr before every non-excluded
	// management command (spec §4.1). Read-only: it prints or stays silent, then returns
	// nil — never a non-nil error, never a Docker/compose action. maybeWarnComposeDrift is
	// FIFO-safe + byte-bounded (Task 1), so this does no unbounded read.
	root.PersistentPreRunE = func(c *cobra.Command, _ []string) error {
		if !driftHookExcluded(c) {
			maybeWarnComposeDrift(app.Err, app.CfgDir)
		}
		return nil
	}
```

- [ ] **Step 4: Remove the redundant drift call from `cli/cmd/status.go`** — delete line 30 (`maybeWarnComposeDrift(app.Out, app.CfgDir)`) and update the comment block at lines 25-28 to:

```go
				// Passive pre-health notice: install-incomplete is orthogonal to /health,
				// so it is emitted on BOTH return-nil branches below. The compose-drift
				// notice is NOT emitted here — the root pre-run (spec §4.1) owns it now and
				// routes it to stderr on every non-excluded command, so status inherits it
				// without a second, stdout copy.
				maybeWarnInstallIncomplete(app.Out, app.CfgDir)
```

- [ ] **Step 5: Migrate the status drift tests** — in `cli/cmd/status_test.go`, replace `statusWithHealth` and the two `TestStatusEmitsDrift*` tests so they drive `status` through the root (so the pre-run fires) with SEPARATE `Out`/`Err` buffers.

```go
// statusWithHealth runs `mathion status` (through the root, so the drift pre-run fires)
// against a drifted on-disk compose with the health probe forced to healthErr; it returns
// captured stdout and stderr separately so the test can prove the drift note is on stderr.
func statusWithHealth(t *testing.T, healthErr error) (stdout, stderr string) {
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
	var out, errb bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out, Err: &errb, In: bytes.NewReader(nil)}
	root := newRootCmd(app)
	root.SetArgs([]string{"status"})
	root.SetOut(&out)
	root.SetErr(&errb)
	if err := root.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("status via root: %v", err)
	}
	return out.String(), errb.String()
}

func TestStatusEmitsDriftOnHealthyBranch(t *testing.T) {
	stdout, stderr := statusWithHealth(t, nil)
	if !strings.Contains(stderr, "apply it with: sudo mathion reconcile") {
		t.Errorf("healthy status must emit the drift notice on stderr; got stderr=%q", stderr)
	}
	if strings.Contains(stdout, "apply it with: sudo mathion reconcile") {
		t.Errorf("the drift notice must be on stderr, not stdout; got stdout=%q", stdout)
	}
	if !strings.Contains(stdout, "healthy") {
		t.Errorf("the healthy line must be on stdout; got stdout=%q", stdout)
	}
}

func TestStatusEmitsDriftOnUnhealthyBranch(t *testing.T) {
	stdout, stderr := statusWithHealth(t, errors.New("connection refused"))
	if !strings.Contains(stderr, "apply it with: sudo mathion reconcile") {
		t.Errorf("unhealthy status must still emit the drift notice on stderr; got stderr=%q", stderr)
	}
	if !strings.Contains(stdout, "stack not healthy") {
		t.Errorf("expected the unhealthy line on stdout; got stdout=%q", stdout)
	}
}
```

- [ ] **Step 6: Run the new + migrated tests**

Run: `cd cli && go test ./cmd/ -run 'DriftHook|Descendant|PreRun|StatusEmitsDrift|StatusEmitsIncomplete' -v`
Expected: PASS — including `TestStatusEmitsIncompleteNotice` (unique fragment, unaffected) and the `drift_test.go` direct-`maybeWarnComposeDrift` tests.

- [ ] **Step 7: Run the WHOLE cli suite — the pre-run now fires for every command driven through `Execute()`**

Run: `cd cli && test -z "$(gofmt -l .)" && go vet ./... && go build ./... && go test ./... -count=1`
Expected: PASS. **If a pre-existing test that drives a command through `newRootCmd(app).Execute*` now sees an unexpected stderr drift line:** its `app.CfgDir` contains a drifted compose. The pre-run behavior is correct; the fix is per-test — either the test's cfgDir legitimately has no compose (absent → silent, no change) or, if it seeds a drifted compose and asserts exact stderr, widen that assertion to tolerate/expect the note (the note is on `Err`; most command tests assert on `Out` or use `Contains`, so fallout should be minimal). Do not weaken the pre-run to paper over a real assertion.

- [ ] **Step 8: Commit**

```bash
git add cli/cmd/root.go cli/cmd/root_test.go cli/cmd/status.go cli/cmd/status_test.go
git commit -m "$(cat <<'EOF'
feat(cli): root drift pre-run (stderr, non-excluded commands) + de-dup status

Add a root PersistentPreRunE that prints the precise compose-drift notice to stderr
on the next non-excluded management command (principled exclusion set: reconcile/
update/install/uninstall/self-update, version --short, completion by ancestry, help,
__complete). Remove status's now-redundant stdout drift call — the pre-run owns it.
Read-only: no Runner call, no marker/compose write. Slice A spec §4.1.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: self-update — replace the unconditional nudge with an honest neutral line

**Files:**
- Modify: `cli/internal/selfupdate/run_linux.go:156-162` (the confirmed-swap tail comment + line).
- Test: `cli/internal/selfupdate/run_linux_test.go` (add assertions to the success-path test).

**Interfaces:**
- No signature changes. The confirmed-swap tail still prints the `old → new` line then one guidance line to `p.Out`.

- [ ] **Step 1: Add the failing assertions** to `TestRun_HappyPath_Swaps` (`run_linux_test.go:103`, the confirmed-swap success test asserting the swap + the `cli-v0.9.0` old→new line + the reconcile-follows-success ordering, ~lines 112-123). Append inside that test, after the existing ordering assertion:

```go
	if !strings.Contains(out.String(), "will report whether this release changed the stack") {
		t.Fatalf("self-update must print the neutral next-command line; got %q", out.String())
	}
	if strings.Contains(out.String(), "if this release updated the stack definition") {
		t.Fatalf("the old unconditional nudge phrase must be gone; got %q", out.String())
	}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cli && go test ./internal/selfupdate/ -run TestRun_HappyPath_Swaps -v`
Expected: FAIL — the new neutral phrase is not yet printed; the old phrase is still present.

- [ ] **Step 3: Replace the tail in `cli/internal/selfupdate/run_linux.go`** (lines 156-162). Keep the `old → new` line at :155 unchanged; replace the comment + nudge:

```go
	// Neutral, honest guidance (NOT a byte-compare): this process is still the OLD binary
	// (commitSwap renamed the staged temp over the target; the running process stays on
	// its pre-swap inode), so it cannot know whether the new release changed the stack.
	// The root pre-run (spec §4.1), running as the NEW binary on the operator's next
	// non-excluded `sudo mathion` command, is the authoritative drift detector; this line
	// only points there — it makes NO drift claim, killing the old always-fires false
	// positive. Fires ONLY here (the confirmed-swap path) — not apt-defer, up-to-date,
	// --check/cancelled/durability-uncertain (all return earlier).
	fmt.Fprintln(p.Out, "self-update complete — your next `sudo mathion` management command will report whether this release changed the stack (apply changes with `sudo mathion reconcile`).")
```

(The backticks are literal characters inside the double-quoted Go string — no escaping needed.)

- [ ] **Step 4: Run the selfupdate suite to verify all pass**

Run: `cd cli && go test ./internal/selfupdate/ -count=1 -v`
Expected: PASS — the new assertions pass; the pre-existing `Contains "sudo mathion reconcile"` (the new line keeps that phrase) and the `reconcile`-FOLLOWS-`old→new` ordering assertion stay green; all five negative-path assertions (apt-defer / --check / cancelled / up-to-date / durability-uncertain) stay green because the tail still prints only on the confirmed-swap path.

- [ ] **Step 5: Verify formatting + build**

Run: `cd cli && test -z "$(gofmt -l .)" && go vet ./... && go build ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/selfupdate/run_linux.go cli/internal/selfupdate/run_linux_test.go
git commit -m "$(cat <<'EOF'
fix(cli): self-update prints an honest neutral line, not an always-fires nudge

The old binary can't byte-compare its stale embed, so the unconditional "apply it
with reconcile" line cried wolf on byte-identical releases (seen on 0.6.0->0.7.0).
Replace it with a neutral line that makes no drift claim and points at the next
`sudo mathion` command, where the root pre-run (running as the NEW binary) reports
precisely. Slice A spec §4.2.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: apt postinstall `timeout`-bounded probe + e2e coverage

**Files:**
- Modify: `deploy/deb/postinst.sh`
- Modify: `deploy/apt/e2e_test.sh`

**Interfaces:**
- Consumes: the `_drift-probe` fast-path binary at `/usr/bin/mathion` (Task 2).
- Produces: the postinstall drift line during `apt install/upgrade` (when drifted).

- [ ] **Step 1: Rewrite `deploy/deb/postinst.sh`** to add the bounded probe after the shadow check.

```sh
#!/bin/sh
set -e
if [ "$1" = configure ]; then
  if [ -e /usr/local/bin/mathion ]; then
    echo "mathion: a curl|sh copy at /usr/local/bin/mathion will shadow this apt package" >&2
    echo "mathion: on the default PATH; remove it (sudo rm /usr/local/bin/mathion) to use apt." >&2
  fi
  # Precise, file-only drift notice (spec §4.3). SKIPPED when a curl|sh copy may shadow
  # the apt binary. timeout --kill-after is load-bearing: plain `timeout` only sends
  # SIGTERM and would wait forever on a child that ignores it; --kill-after escalates to
  # SIGKILL so this can never wedge dpkg. `|| true` + the `exit 0` floor keep configure
  # green regardless. (The [ ] && [ ] is an if-condition and `timeout … || true` is A||C,
  # both SC2015-exempt.)
  if [ ! -e /usr/local/bin/mathion ] && [ -x /usr/bin/mathion ]; then
    timeout --kill-after=1s 5s /usr/bin/mathion _drift-probe 2>/dev/null || true
  fi
fi
exit 0
```

- [ ] **Step 2: `bash -n` + shellcheck the postinstall**

Run: `sh -n deploy/deb/postinst.sh && shellcheck deploy/deb/postinst.sh`
Expected: no output (clean). (If `shellcheck` is absent locally, note it — CI's `apt-scripts` job runs it.)

- [ ] **Step 3: Add direct-postinst logic tests to `deploy/apt/e2e_test.sh`.** Insert a function near the top (after the root/apt-utils guards but usable independently) that sed-rewrites the two hard-coded paths to fixtures so the branches are exercised WITHOUT touching the real binaries. Call it early in the script (before the apt cycle).

```sh
# Direct-postinst logic tests (spec §7 (ii)/(iii)): rewrite the two absolute paths to
# fixtures and run the maintainer script's configure branch. Covers the shadow, timeout,
# and missing-binary paths without a full apt cycle and without touching real binaries.
test_postinst_direct() {
  pdir="$(mktemp -d)"
  src="$(dirname "$0")/../deb/postinst.sh"

  # (a) shadow present -> shadow warning, NO drift line.
  : > "$pdir/shadow"          # stands in for /usr/local/bin/mathion
  : > "$pdir/bin"; chmod +x "$pdir/bin"
  sed "s#/usr/local/bin/mathion#$pdir/shadow#g; s#/usr/bin/mathion#$pdir/bin#g" "$src" > "$pdir/postinst"
  out="$(sh "$pdir/postinst" configure 2>&1)"; rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: postinst shadow-case rc=$rc"; exit 1; }
  echo "$out" | grep -q "will shadow this apt package" || { echo "FAIL: no shadow warning"; exit 1; }
  echo "$out" | grep -q "differs from this mathion version" && { echo "FAIL: drift claim in shadow case"; exit 1; }

  # (b) timeout-path: a SIGTERM-ignoring blocker must be SIGKILLed by --kill-after. The
  #     fixture touches a sentinel first, so we can prove the probe branch actually ran
  #     (exit-0-under-20s could otherwise false-pass on a skipped probe).
  rm -f "$pdir/shadow"
  sent="$pdir/sentinel"
  cat > "$pdir/bin" <<EOF
#!/bin/sh
: > "$sent"
trap '' TERM
sleep 30
EOF
  chmod +x "$pdir/bin"
  sed "s#/usr/local/bin/mathion#$pdir/shadow#g; s#/usr/bin/mathion#$pdir/bin#g" "$src" > "$pdir/postinst"
  start="$(date +%s)"
  sh "$pdir/postinst" configure >/dev/null 2>&1; rc=$?
  elapsed=$(( $(date +%s) - start ))
  [ "$rc" = 0 ] || { echo "FAIL: postinst timeout-path rc=$rc"; exit 1; }
  [ -f "$sent" ] || { echo "FAIL: probe branch did not run (no sentinel)"; exit 1; }
  [ "$elapsed" -lt 20 ] || { echo "FAIL: postinst did not bound the SIGTERM-ignorer (${elapsed}s)"; exit 1; }

  # (c) missing /usr/bin/mathion -> configure still exits 0, no probe.
  rm -f "$pdir/bin"
  sed "s#/usr/local/bin/mathion#$pdir/shadow#g; s#/usr/bin/mathion#$pdir/bin#g" "$src" > "$pdir/postinst"
  sh "$pdir/postinst" configure >/dev/null 2>&1 || { echo "FAIL: postinst missing-binary rc nonzero"; exit 1; }

  rm -rf "$pdir"
  echo "postinst direct-logic tests PASSED"
}
test_postinst_direct
```

- [ ] **Step 4: Add the real-install drifted-path assertion.** In `deploy/apt/e2e_test.sh`, BEFORE the existing `apt-get install -y … mathion` (line 59), seed a drifted compose at the default config dir, guarding a pre-existing real one; capture the install output and assert the drift line; extend `cleanup()` to remove the seeded compose.

Add to `cleanup()` (after the existing `rm -f …` line):

```sh
  if [ -f "$WORK/etc_mathion_preexisted" ]; then
    :  # a real /etc/mathion was here before us — leave it untouched
  else
    rm -f /etc/mathion/docker-compose.yml
    rmdir /etc/mathion 2>/dev/null || true
  fi
```

Before the `apt-get install` line, seed + capture:

```sh
# Seed a DRIFTED compose so the postinstall probe emits the precise drift line during
# configure. Guard a pre-existing real /etc/mathion (never clobber an operator's dir).
if [ -e /etc/mathion ]; then : > "$WORK/etc_mathion_preexisted"; else mkdir -p /etc/mathion; fi
printf 'drifted: yes\n' > /etc/mathion/docker-compose.yml
apt-get install -y -o APT::Get::AllowUnauthenticated=false mathion 2>&1 | tee "$WORK/install.log"
grep -q "differs from this mathion version" "$WORK/install.log" || { echo "FAIL: no drift line during apt install of a drifted host"; exit 1; }
```

Then REPLACE the original `apt-get install -y … mathion` line (59) with the captured form above (do not run it twice), and keep the `test -x /usr/bin/mathion && /usr/bin/mathion version >/dev/null` line after it.

> **Note:** the seeded `drifted: yes` differs from `compose.ComposeYAML`, so `driftFromReader` reports drift; `varlib` has no marker on a fresh host, so this exercises the bytes-differ branch. The probe runs under the postinst's env (no `MATHION_CONFIG_DIR`), reading `/etc/mathion` — which is exactly what we seeded.

- [ ] **Step 5: `bash -n` + shellcheck the harness, and run it if on a root Linux box with apt-utils**

Run: `sh -n deploy/apt/e2e_test.sh && shellcheck deploy/apt/e2e_test.sh`
Expected: clean. (Full execution is CI-only — the `apt-e2e` job runs as root with `apt-utils`; locally on macOS the script self-SKIPs at its root/apt-utils guards, but `test_postinst_direct` runs anywhere with `sh`/`timeout` — run it standalone if `timeout` is present: `sh -c '. deploy/apt/e2e_test.sh' ` is NOT how it's structured, so to smoke just the direct tests, temporarily copy `test_postinst_direct` out, or rely on CI.)

- [ ] **Step 6: Commit**

```bash
git add deploy/deb/postinst.sh deploy/apt/e2e_test.sh
git commit -m "$(cat <<'EOF'
feat(deploy): apt postinstall runs the timeout-bounded _drift-probe

The .deb postinstall invokes `timeout --kill-after=1s 5s /usr/bin/mathion
_drift-probe` (skipped when a curl|sh copy may shadow it), so `apt install/upgrade`
prints the precise drift line iff the stack changed — and can never wedge dpkg
(--kill-after SIGKILLs a SIGTERM-ignorer; `|| true` + `exit 0` floor). e2e_test.sh
gains direct-postinst logic tests (shadow / timeout-with-sentinel / missing-binary)
and a real-install drifted-path assertion. Slice A spec §4.3b.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- §4.1 root pre-run + principled exclusion → Task 3. ✔
- §4.2 self-update neutral line → Task 4. ✔
- §4.3a hardened `composeDrifted` + `driftFromReader` seam → Task 1; `RunDriftProbe` + `main.go` fast-path → Task 2. ✔
- §4.3b postinstall `timeout --kill-after` + shadow precedence → Task 5. ✔
- §5 precedence / fail-quiet → exercised by Task 1 tests (absent/differ/marker/non-regular/read-error) + Task 3 (stderr routing) + Task 2 (probe). ✔
- §6 no-mutation → `TestPreRunIsReadOnly` (Task 3). ✔
- §7 tests: per-stream drift-string counting (T3), recursive descendant-hook guard (T3), status migration with split buffers (T3), `driftFromReader` exact-tuple + FIFO (T1), mutation-safety (T3), self-update phrase swap (T4), apt direct-postinst shadow/timeout-sentinel/missing + real-install drift (T5), gofmt/vet/build/test gate (every task). ✔
- §8 files ↔ tasks: all listed files are touched. ✔

**2. Placeholder scan:** every code step has real code; no TBD/TODO. The one judgment note (FakeRunner field name in T3 Step 1) is flagged with a concrete fallback, not left vague.

**3. Type consistency:** `composeDrifted(cfgDir) (drifted, present bool)` and `driftFromReader(r io.Reader, embed []byte) (drifted, present bool)` used consistently across T1/T2/T3; `RunDriftProbe(w io.Writer)` in T2 matches `main.go`'s `cmd.RunDriftProbe(os.Stdout)`; `driftHookExcluded(c *cobra.Command) bool` defined in T3 and used only there; the drift string is asserted via the shared `driftNote` const (`drift_test.go:14`) everywhere.

**Cross-task ordering:** T1 (shared reader) → T2 (probe, reuses it) → T3 (pre-run, reuses it; owns the note before T-later status removal is within T3 itself) → T4 (independent) → T5 (needs T2's fast-path). Coupling of the pre-run and the `status` de-dup is deliberately kept inside one task (T3) to avoid a double-emission intermediate state.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-29-auto-reconcile-upgrade-slice-a-precise-nudges.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, per-task dual-gate review (Opus reviewer + codex@high) after each, fix all Critical/Important, re-review until clean, then a whole-branch dual-gate review.

**2. Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
