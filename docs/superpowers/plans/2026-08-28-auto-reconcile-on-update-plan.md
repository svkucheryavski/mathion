# Auto-reconcile on `mathion update` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold compose-reconcile into `mathion update` so one upgrade applies both the app image and this release's embedded stack definition, safely.

**Architecture:** Extract reconcile's under-lock apply body into a lock-free `applyStack` (marker lifecycle moved to callers). Add a shared `applyAndGate` mini-transaction (marker → apply → re-assert strict gate → clear-on-success / best-effort restore-on-failure) used by both `update` branches: real-upgrade applies **post-commit** (exit-2 `committedPendingError`, never rolls back the DB); same-tag applies restore-bounded (plain exit 1). `reconcile` keeps its existing behavior (uses `applyStack`+`clearApplyMarker` directly, not `applyAndGate`).

**Tech Stack:** Go 1.24, cobra; module `github.com/svkucheryavski/mathion/cli`. Hermetic tests via `compose.FakeRunner` + `gateFn`/`removeMarkerFn`/`writeJournalFn`/`writeMarkerFn` seams.

**Spec:** `docs/superpowers/specs/2026-08-28-auto-reconcile-on-update-design.md` (rev 3, dual-gate clean). Executors read both; the spec is the binding authority and carries the full rationale + reference line numbers.

## Global Constraints

- **Go 1.24**; `cli/cmd` + `cli/internal/config` carry **no build tags** (darwin-testable); only `cli/internal/selfupdate` is `//go:build linux`. Every file this plan touches is darwin-testable.
- **`git add` exact named paths only** — never `-A`/`.`.
- **Commit trailer, EXACT:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Fail-closed on `.env`** everywhere; production is **HTTPS-only**; the fail-closed TLS re-derive (`tlsEnabledFromEnv` under the lock, inside `applyStack`) is load-bearing — the proxy has no `env_file`.
- **Standing release rule (Decision A, spec §3.2):** every release's app migration must run under the *previous* on-disk compose, and its new app/db definition must come up healthy against the migrated schema — a maintainer/review rule; the restore net is its runtime bound.
- **Never** route a post-commit apply failure through `updateFailure`/`restoreEngine`/any DB rollback (spec §4.4). Exit codes: 0 ok / 1 fail / 2 `committedPendingError` (commit done, post-commit work/verification remains) / 3 rollback-also-failed.
- **Preserve exact error strings** when extracting `requirePrivateEnv` (reconcile/tls tests assert them).
- Tests hermetic. **`a.compose(...)` records the FULL argv** — `["compose","-p","mathion_prod","-f",…,"--env-file",…,"up",…]` — so FakeRunner predicates MUST match on the joined string (`joinHas`) or whole tokens (`containsArg`), **never `args[0]`/`args[1]`**. The three distinct `up` calls a run can emit, and how to tell them apart:
  - whole-project apply `up -d --wait --pull never` — no trailing `app` token, no `--wait-timeout`
  - app-only recreate `up -d --wait --pull never app` — trailing `app` token
  - restore `up -d --wait --wait-timeout 120 --pull never` — carries `--wait-timeout`
  Apply-vs-restore (which share args) is resolved by asserting **on-disk compose == prev** after a failed apply (apply writes the embed first; restore rewrites prev).

## Confirmed test infrastructure (verify once, then reuse)

All defined in `cli/cmd/*_test.go`; do not redefine:
- `engineApp(cfg, f, in) (*App,*bytes.Buffer,*bytes.Buffer)` (restore_test.go:184) — App with Project `mathion_prod`.
- `setupRestoreEnv(t) string` (restore_test.go:246) — full `.env` at 0o600, `MATHION_VARLIB_DIR` set, backups dir ensured, active tag `v0.1.1`, TLS disabled. **Writes NO docker-compose.yml.**
- `update21Fake(t) *compose.FakeRunner` (update_test.go:175) — the canonical full-run fixture (OutputFunc: `ps -q db`→cid, `alembic current`→rev, else `recordedIDLocalOutput`; StreamFunc: pg_dump + valid assets tar). Real-upgrade tests build on this and set `f.RunFunc`/`f.StreamFunc` on top.
- `captureGate(t, ret)` (update_test.go:342) / `stubGate(t, ret)` (restore_test.go:314) / `strictDiscriminatingGate(t)` (update_test.go:469) — the `gateFn` seam.
- `joinHas(sub) func([]string)bool` (restore_test.go:211); `containsArg(call, tok) bool` (restore_test.go:727); `argAfter(call, flag) string` (restore_test.go:737); `idxOfCall`/`hasCall` (restore_test.go:189/198); `head`/`isPull`/`isTag` (restore_test.go:200/207/208); `recordedIDLocalOutput` (restore_test.go:228); `validAssetsTar` (restore_test.go:709); `asRoot(t)` (backup_test.go:97 — stubs the `geteuid` seam to 0; does NOT skip); `useGateServer(t, h) *int32` (gate_test.go:55).
- Restore-engine call markers (their ABSENCE proves no rollback): `mathion_restore_db_`, `mathion_restore_assets_`, `rm -f mathion_migrate_`.
- `varlib.MarkerPresent() (bool,error)` (marker.go:29); `WriteMarker`/`RemoveMarker`/`MarkerPath` (marker.go:22/42/13); `ReadJournal`/`JournalPath` (used by existing update tests).
- `update.go` already imports `bufio context errors fmt os os/signal path/filepath strings syscall time` + `archive compose config dockerx varlib`. It does **NOT** import `bytes` — add that only in Task 6, at first use.

---

## File Structure

- `cli/cmd/reconcile.go` — home of `applyStack(ctx)` (core, no marker), `clearApplyMarker()`, `composePath(a)`; `App.reconcile` refactored to call them (and to use the new `composePath(a)` package func, retiring its local `composePath` var). Same package as `update.go`.
- `cli/cmd/tls.go` — `requirePrivateEnv()` extracted from `requireInstalledDeployment` (exact strings preserved).
- `cli/cmd/update.go` — `committedPendingError` + `exitCode` arm; `applyAndGate`, `restorePrevCompose`, `runningAppImageID`, `restoreWaitTimeout` consts, `writeMarkerFn` seam; `updateOpts.NoReconcile` + `--no-reconcile`; drift-signal computation; both apply branches; confirm-plan line; `--no-reconcile` reminder; `--help` exit-code note; `import "bytes"`.
- `cli/cmd/*_test.go` — new tests + `setupUpdateEnv(t)` helper; migration of existing update tests; `failsApplyUp` predicate helper.
- `cli/cmd/root_test.go` — `TestUpdateCmdFlags` extended to require `--no-reconcile`.
- `README.md` — "Upgrading" note incl. exit-2 semantics.

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
Expected: PASS.

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

Then edit `App.reconcile`:
1. **Delete** the standalone step-3 TLS re-derive line `a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)` (reconcile.go:59) — it moves into `applyStack`. Safe: step-4 `appRunning` uses `ps -q app`, and `tlsProfileWanted("ps")` returns true unconditionally, so its args don't depend on `tlsEnabled`; `applyStack` re-derives under the lock before the `up`.
2. In step 5, **replace** the local `composePath := filepath.Join(a.CfgDir, "docker-compose.yml")` + `onDisk, _ := os.ReadFile(composePath)` (reconcile.go:66-67) with a single `onDisk, _ := os.ReadFile(composePath(a))` — retiring the local var so it can no longer shadow the new package func.
3. **Replace** the step 6b→7 body (from `config.EnsureConfigDir(...)` through the final report `Fprintf`) — keeping the step-6a `varlib.WriteMarker()` block — with:

```go
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
Expected: PASS — every reconcile test (marker written-before / cleared-after-success / left-after-failed-up, TLS re-derive under lock, pre-pull, prompt, `could not clear the apply-pending marker` warning) unchanged.

- [ ] **Step 4: Commit**

```bash
git add cli/cmd/reconcile.go
git commit -m "$(cat <<'EOF'
refactor(cli): extract applyStack/clearApplyMarker/composePath from reconcile

Behavior-preserving: marker CLEAR moves out of the apply body into the caller, the
TLS re-derive moves into applyStack (still under the lock, before the up), and the
step-5 drift read uses the new composePath(a) package func (retiring the local var).
reconcile suite unchanged.

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
- Produces: `func (a *App) requirePrivateEnv() error` — `.env` present + regular + owner-only (`perm&0o077 == 0`), **verbatim** the first three checks/messages of `requireInstalledDeployment` (tls.go:237-247).
- `requireInstalledDeployment` calls it first, then continues with state/env validation unchanged.

- [ ] **Step 1: Write direct unit tests for `requirePrivateEnv` — EXACT strings, both bad cases**

In `cli/cmd/tls_test.go`:

```go
func TestRequirePrivateEnvRejectsLoosePerm(t *testing.T) {
	cfg := t.TempDir()
	envPath := cfg + "/.env"
	if err := os.WriteFile(envPath, []byte("X=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(envPath, 0o644); err != nil { // umask-independent -rw-r--r-- (the reconcile test's pattern)
		t.Fatal(err)
	}
	err := (&App{CfgDir: cfg}).requirePrivateEnv()
	want := fmt.Sprintf(".env at %s is group/world-accessible (%v); it holds secrets — fix with `chmod 600 %s`",
		envPath, os.FileMode(0o644), envPath)
	if err == nil || err.Error() != want {
		t.Fatalf("loose-perm error mismatch:\n got: %v\nwant: %s", err, want)
	}
}

func TestRequirePrivateEnvRejectsNonRegular(t *testing.T) {
	cfg := t.TempDir()
	if err := os.Mkdir(cfg+"/.env", 0o700); err != nil { // a DIR named .env → not regular
		t.Fatal(err)
	}
	err := (&App{CfgDir: cfg}).requirePrivateEnv()
	want := fmt.Sprintf(".env at %s is not a regular file; repair it or run `mathion install`", cfg+"/.env")
	if err == nil || err.Error() != want {
		t.Fatalf("non-regular error mismatch:\n got: %v\nwant: %s", err, want)
	}
}

func TestRequirePrivateEnvAcceptsOwnerOnly(t *testing.T) {
	cfg := t.TempDir()
	if err := os.WriteFile(cfg+"/.env", []byte("X=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := (&App{CfgDir: cfg}).requirePrivateEnv(); err != nil {
		t.Fatalf("owner-only .env must pass; got %v", err)
	}
}
```

(`fmt` and `os` are already imported in tls_test.go; if not, add them.)

- [ ] **Step 2: Run to verify they fail (undefined)**

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

Replace the first three checks inside `requireInstalledDeployment` (tls.go:237-247) with `if err := a.requirePrivateEnv(); err != nil { return err }`, leaving the `ReadState`/`ReadEnvFile`/`ValidateEnvComplete` tail (tls.go:248-258) unchanged.

- [ ] **Step 4: Run new units + reconcile loose-perm regression + vet/build**

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
- Modify: `cli/cmd/update.go`, `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `type committedPendingError struct{ err error }` (`Error`/`Unwrap`); `exitCode` returns 2 for it; the post-commit `RemoveJournal`-after-success failure now returns `committedPendingError` (was plain → exit 1).

- [ ] **Step 1: Write the exit-mapping test + extend the existing post-remove test to assert exit 2**

In `cli/cmd/update_test.go` add:

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

Then in the existing `TestUpdateGatePostRemoveWarns` (update_test.go:435), after the `could not remove the recovery breadcrumb` assertion, add (spec §7 test 8):

```go
	if exitCode(err) != 2 {
		t.Fatalf("a failed post-commit breadcrumb clear is exit 2 (commit done, cleanup pending); got %d", exitCode(err))
	}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cli && go test ./cmd/ -run 'TestExitCodeCommittedPending|TestUpdateGatePostRemoveWarns' -count=1`
Expected: FAIL (`committedPendingError` undefined / exit code still 1).

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

In `exitCode`, insert the arm **after** the `rollbackFailedError` check (3 keeps precedence) and **before** the plain-error fallthrough:

```go
	var cpe committedPendingError
	if errors.As(err, &cpe) {
		return 2
	}
```

Wrap the post-commit `RemoveJournal`-failure return (the existing `return fmt.Errorf("updated %s → %s successfully, but could not remove the recovery breadcrumb …")`) in `committedPendingError{err: fmt.Errorf(...same message...)}` — message text unchanged (Unwrap preserves the substring `could not remove the recovery breadcrumb`).

- [ ] **Step 4: Run the exit tests + full update suite + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run 'TestExitCode|TestUpdate' -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/update_test.go
git commit -m "$(cat <<'EOF'
feat(cli): committedPendingError → exit 2; fold post-commit RemoveJournal failure

Exit-2 taxonomy = "image/DB commit completed; post-commit work/verification remains".
The existing post-commit breadcrumb-clear failure (previously exit 1) now maps to 2
for a consistent post-commit meaning; its message is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `applyAndGate` + `restorePrevCompose` + `runningAppImageID` (+ `failsApplyUp` test helper)

**Files:**
- Modify: `cli/cmd/update.go`, `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `func (a *App) applyAndGate(ctx, prev []byte, gateID, target string) (restored bool, err error)`; `func restorePrevCompose(ctx, a *App, prev []byte) bool`; `func runningAppImageID(ctx, a *App) (string, error)`; consts `restoreWaitTimeout`/`restoreWaitTimeoutSecs`; the `writeMarkerFn` seam. Test helper `failsApplyUp([]string) bool`.
- Consumes: `applyStack`, `clearApplyMarker`, `composePath` (Task 1); `gateFn` seam; `varlib.WriteMarker`, `tlsEnabledFromEnv`, `config.AtomicWrite`.
- **No new import in this task.** `applyAndGate`/`restorePrevCompose`/`runningAppImageID` are unused by `runUpdate` until Tasks 7–8; Go tolerates unused package-level funcs/methods/consts, so the tree compiles and T4's own tests exercise them. **Do NOT add `import "bytes"` here** — it is unused until Task 6.

- [ ] **Step 1: Write the unit tests + the `failsApplyUp` predicate**

In `cli/cmd/update_test.go`:

```go
// failsApplyUp matches ONLY the whole-project apply `up` (up -d --wait --pull never,
// no trailing `app`, no --wait-timeout) — NOT the app-only recreate (`… app`) nor the
// restore (`… --wait-timeout 120 …`). a.compose records the FULL argv, so match the join.
func failsApplyUp(args []string) bool {
	return joinHas("up -d --wait --pull never")(args) &&
		!containsArg(args, "app") &&
		!containsArg(args, "--wait-timeout")
}

func TestApplyAndGateSuccessClearsMarkerAfterGate(t *testing.T) {
	cfg := setupRestoreEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	stubGate(t, nil)
	restored, err := app.applyAndGate(context.Background(), []byte("old\n"), "sha256:R", "v9.9.9")
	if err != nil || restored {
		t.Fatalf("success → (false, nil); got (%v, %v)", restored, err)
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Fatal("marker must be cleared after a passing gate")
	}
}

func TestApplyAndGateApplyFailRestoresAndRetainsMarker(t *testing.T) {
	cfg := setupRestoreEnv(t)
	prev := []byte("PREVIOUS-COMPOSE-BYTES\n")
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), prev, 0o644); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{RunFunc: func(args []string) error {
		if failsApplyUp(args) {
			return errors.New("apply up failed")
		}
		return nil
	}}
	app, _, _ := engineApp(cfg, f, "")
	stubGate(t, nil) // gate would pass; the apply `up` fails first
	restored, err := app.applyAndGate(context.Background(), prev, "sha256:R", "v9.9.9")
	if err == nil || !restored {
		t.Fatalf("apply-fail + restore-ok → (true, err); got (%v, %v)", restored, err)
	}
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("restore must rewrite prev bytes (applyStack first wrote the embed); got %q", got)
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Fatal("marker must be RETAINED on failure")
	}
}

func TestApplyAndGateGateFailRestoresBounded(t *testing.T) {
	cfg := setupRestoreEnv(t)
	prev := []byte("PREV\n")
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), prev, 0o644); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{} // every up succeeds
	app, _, _ := engineApp(cfg, f, "")
	stubGate(t, errors.New("gate: moved tag"))
	restored, err := app.applyAndGate(context.Background(), prev, "sha256:R", "v9.9.9")
	if err == nil || !restored {
		t.Fatalf("gate-fail + restore-ok → (true, err); got (%v, %v)", restored, err)
	}
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("restore must rewrite prev bytes; got %q", got)
	}
	// spec §7 test 4: the restore `up` is time-bounded (--wait-timeout 120).
	if !hasCall(f.Calls, joinHas("up -d --wait --wait-timeout 120 --pull never")) {
		t.Fatalf("restore up must carry --wait-timeout 120; calls=%v", f.Calls)
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Fatal("marker retained on failure")
	}
}

func TestApplyAndGateRestoreAlsoFails(t *testing.T) {
	cfg := setupRestoreEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("PREV\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{RunFunc: func(args []string) error {
		if joinHas("up")(args) {
			return errors.New("every up fails") // both apply and restore up fail
		}
		return nil
	}}
	app, _, _ := engineApp(cfg, f, "")
	stubGate(t, nil)
	restored, err := app.applyAndGate(context.Background(), []byte("PREV\n"), "sha256:R", "v9.9.9")
	if err == nil || restored {
		t.Fatalf("apply-fail + restore-fail → (false, err); got (%v, %v)", restored, err)
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Fatal("marker retained")
	}
}

func TestApplyAndGateWriteMarkerFailIsIntact(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	prev := writeMarkerFn
	writeMarkerFn = func() error { return errors.New("marker fsync failed") }
	t.Cleanup(func() { writeMarkerFn = prev })
	restored, err := app.applyAndGate(context.Background(), []byte("PREV\n"), "sha256:R", "v9.9.9")
	if err == nil || !restored { // nothing was applied → prior state intact
		t.Fatalf("marker-write fail → (true, err); got (%v, %v)", restored, err)
	}
	if hasCall(f.Calls, joinHas("up")) {
		t.Fatalf("a marker-write failure must touch no container; calls=%v", f.Calls)
	}
}

func TestRunningAppImageIDResolvesContainer(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if joinHas("ps -q app")(args) {
			return "cid123\n", nil
		}
		if len(args) >= 2 && args[0] == "inspect" && args[1] == "cid123" {
			return "sha256:RUN\n", nil
		}
		return "", nil
	}}
	app, _, _ := engineApp(cfg, f, "")
	id, err := runningAppImageID(context.Background(), app)
	if err != nil || id != "sha256:RUN" {
		t.Fatalf("want sha256:RUN, nil; got %q, %v", id, err)
	}
}

func TestRunningAppImageIDErrorsNoContainer(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "", nil }} // ps -q app → ""
	app, _, _ := engineApp(cfg, f, "")
	if _, err := runningAppImageID(context.Background(), app); err == nil {
		t.Fatal("an empty `ps -q app` must error, not fall back to the tag")
	}
}

func TestRestorePrevComposeEmptyPrevGuard(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	if restorePrevCompose(context.Background(), app, nil) {
		t.Fatal("empty prev must not claim a restore")
	}
	if hasCall(f.Calls, joinHas("up")) {
		t.Fatalf("empty prev must issue no up; calls=%v", f.Calls)
	}
}
```

- [ ] **Step 2: Run to verify they fail (undefined)**

Run: `cd cli && go test ./cmd/ -run 'TestApplyAndGate|TestRunningAppImageID|TestRestorePrevCompose' -count=1`
Expected: FAIL to compile.

- [ ] **Step 3: Implement the three functions + consts + the `writeMarkerFn` seam**

In `cli/cmd/update.go`:

```go
const (
	restoreWaitTimeout     = 120 * time.Second
	restoreWaitTimeoutSecs = "120"
)

// writeMarkerFn is the apply-pending marker writer; a package seam (like writeJournalFn)
// so a test can drive the marker-write-failure branch of applyAndGate.
var writeMarkerFn = varlib.WriteMarker

// applyAndGate writes the marker, materializes+brings up the NEW compose, re-asserts the
// strict gate against gateID, and clears the marker ONLY after the gate passes. On ANY
// failure it best-effort restores prev and RETAINS the marker. Lock-free. Returns
// (restored, err): restored says whether the pre-apply state is back in place. NEVER
// calls updateFailure/restoreEngine — no DB rollback is reachable here.
func (a *App) applyAndGate(ctx context.Context, prev []byte, gateID, target string) (bool, error) {
	if e := writeMarkerFn(); e != nil {
		// Compose untouched, app unchanged → prior state intact, nothing to restore.
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
Expected: PASS. The apply-fail test's on-disk `== prev` assertion proves the restore ran; the gate-fail test's `--wait-timeout 120` assertion proves the restore is bounded.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/update_test.go
git commit -m "$(cat <<'EOF'
feat(cli): applyAndGate mini-transaction + bounded restore + running-image anchor

Shared marker-guarded apply: write marker -> applyStack -> re-assert strict gate ->
clear-on-success / best-effort time-bounded restore-on-failure. runningAppImageID
anchors on the running container's .Image (gate.go pattern), not the tag. writeMarkerFn
seam added for the marker-write-fail branch. Not yet wired into runUpdate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `setupUpdateEnv` fixture + migrate existing update tests (non-drift precondition, spec I7)

**Files:**
- Modify: `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `func setupUpdateEnv(t *testing.T) string` = `setupRestoreEnv(t)` + writing `compose.ComposeYAML` to `<cfg>/docker-compose.yml` (so the fixture is **non-drifted** once `runUpdate` reads compose in Task 6).

**Why exhaustive:** `setupRestoreEnv` writes no compose, so once Task 6 computes `composeDiffers = readErr != nil || !bytes.Equal(...)`, every un-migrated fixture reads as drifted. That would (a) route the same-tag guard tests into the same-tag *apply* branch (which then errors on `appRunning`==false against an empty FakeRunner), and (b) make `TestUpdateGatePassCommits` — which asserts the exact success line `updated v0.1.1 → v2.0.0 (backup: ` — fail once Task 8 appends the "…and applied this release's stack definition…" clause on the drift path. Migrate **every** `setupRestoreEnv(t)` in update_test.go that drives `runUpdate`/`newUpdateCmd` to `setupUpdateEnv(t)`.

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

(`path/filepath` must be imported in update_test.go; add it if the sweep in Step 2 is the first user.)

- [ ] **Step 2: Migrate every `runUpdate`/`newUpdateCmd` test using `setupRestoreEnv(t)` to `setupUpdateEnv(t)`**

Sweep `cli/cmd/update_test.go`: replace `setupRestoreEnv(t)` with `setupUpdateEnv(t)` in every test that drives `runUpdate`/`newUpdateCmd`. **Leave on `setupRestoreEnv`:** the `setupBackupEnv`-based `TestUpdateGuardPreconditionValidatesEnv`, the `t.TempDir()`-based `TestUpdateFailureShellQuotesRecoveryHint`, and the Task-4 helper tests (`TestApplyAndGate*`, `TestRunningAppImageID*`, `TestRestorePrevComposeEmptyPrevGuard`) — those call `applyAndGate`/`runningAppImageID` directly (not `runUpdate`) and want the markerless env.

- [ ] **Step 3: Run the full update suite (must be green BEFORE any drift wiring)**

Run: `cd cli && go test ./cmd/ -run TestUpdate -count=1`
Expected: PASS — behavior identical (`runUpdate` does not read compose yet; the migration is a no-op until Task 6).

- [ ] **Step 4: Commit**

```bash
git add cli/cmd/update_test.go
git commit -m "$(cat <<'EOF'
test(cli): setupUpdateEnv (non-drifted compose fixture); migrate update tests

Precondition for wiring drift into update: seed docker-compose.yml == embed so existing
fixtures do not become spuriously drifted (which would break the exact-success-line and
same-tag guard tests). No behavior change yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update preamble — `--no-reconcile`, `requirePrivateEnv` gate, drift signal, deferred reminder

**Files:**
- Modify: `cli/cmd/update.go`, `cli/cmd/update_test.go`

**Interfaces:**
- Produces: `updateOpts.NoReconcile bool` + `--no-reconcile` flag; `requirePrivateEnv` enforced in `runUpdate` before mutation; package-local `composeDiffers`/`markerPresent`/`drift`/`wantApply` + `onDisk` computed after step 1; a `--no-reconcile`+drift reminder on the non-apply success paths. Adds `import "bytes"`.
- The apply branches act on `wantApply` in Tasks 7–8; here the branches keep today's behavior except the reminder.

- [ ] **Step 1: Write the preamble tests (perm gate; deferred reminder incl. compose-absent)**

```go
func TestUpdateRejectsLoosePermEnv(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.Chmod(cfg+"/.env", 0o644); err != nil {
		t.Fatal(err)
	}
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
	// spec §7 test 7: assert the EXACT reminder line (with newline), not just a substring.
	wantLine := "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile\n"
	if !strings.Contains(out.String(), wantLine) {
		t.Fatalf("want the exact deferred-apply reminder line; got %q", out.String())
	}
	if hasCall(f.Calls, joinHas("up")) {
		t.Fatalf("--no-reconcile must NOT apply; got %v", f.Calls)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cli && go test ./cmd/ -run 'TestUpdateRejectsLoosePermEnv|TestUpdateNoReconcile' -count=1`
Expected: FAIL (`NoReconcile` field / behavior absent).

- [ ] **Step 3: Add the flag, the gate, the signal, the reminder; import bytes**

Add `"bytes"` to update.go's import block (first use is below).

In `newUpdateCmd`: add `var noReconcile bool`, register `c.Flags().BoolVar(&noReconcile, "no-reconcile", false, "apply only the image upgrade; defer this release's stack-definition change")`, and pass `NoReconcile: noReconcile` into `updateOpts`. Add `NoReconcile bool` to `updateOpts`.

In `runUpdate`, at the very top (before `ReadEnvFile`): `if err := a.requirePrivateEnv(); err != nil { return err }`. After the step-1 `oldTag := env["MATHION_VERSION"]` line add:

```go
	onDisk, readErr := os.ReadFile(composePath(a))
	composeDiffers := readErr != nil || !bytes.Equal(onDisk, compose.ComposeYAML)
	markerPresent, _ := varlib.MarkerPresent()
	drift := composeDiffers || markerPresent
	wantApply := drift && !opts.NoReconcile
	_ = wantApply // consumed by the apply branches in Tasks 7–8
```

Add the reminder on the same-tag non-apply path and the real-upgrade success path (both existing `return nil` success points), using this exact line:

```go
	if opts.NoReconcile && drift {
		fmt.Fprintln(a.Out, "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile")
	}
```

- [ ] **Step 4: Run preamble tests + full update suite + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run TestUpdate -count=1`
Expected: PASS (existing tests unaffected — `wantApply` computed but unused; reminder only under `--no-reconcile`).

- [ ] **Step 5: Commit** (`git add cli/cmd/update.go cli/cmd/update_test.go`; message subject: `feat(cli): update preamble — --no-reconcile, private-env gate, drift signal, deferred reminder`).

---

### Task 7: Same-tag apply branch

**Files:**
- Modify: `cli/cmd/update.go`, `cli/cmd/update_test.go`

**Interfaces:**
- Consumes: `applyAndGate`, `runningAppImageID` (Task 4); `wantApply`/`composeDiffers`/`onDisk`/`drift` (Task 6); `appRunning`, `probeVersionOnce`.
- Same-tag apply failure returns a **plain error** (exit 1) — never `committedPendingError`.

- [ ] **Step 1: Write same-tag tests (apply-success; gate-fail→restore exit 1; app-not-running refuse; no-drift unchanged; stale-marker wording)**

Add `"bytes"` to `cli/cmd/update_test.go`'s import block — this is the first test-file use of `bytes.Equal` (in `TestUpdateSameTagDriftAppliesAndGates` below and again in Task 8); `go build` at Step 4 would otherwise fail "undefined: bytes".

```go
// sameTagApplyFake: same-tag runs skip backup/migrate/recreate, so the only Output
// probes are runningAppImageID's (ps -q app → cid, inspect <cid> → running id) and
// appRunning's (ps -q app → non-empty). One OutputFunc serves both.
func sameTagApplyFake(runFn func([]string) error) *compose.FakeRunner {
	return &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			if joinHas("ps -q app")(args) {
				return "cid123\n", nil
			}
			if len(args) >= 2 && args[0] == "inspect" && args[1] == "cid123" {
				return "sha256:R\n", nil
			}
			return "", nil
		},
		RunFunc: runFn,
	}
}

func TestUpdateSameTagDriftAppliesAndGates(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := sameTagApplyFake(nil)
	app, out, _ := engineApp(cfg, f, "")
	prev := gateFn
	gateFn = func(_ context.Context, _ *App, id, _ string, strict bool) error {
		if id != "sha256:R" || !strict {
			t.Fatalf("gate must use the captured running id, strict; got id=%s strict=%v", id, strict)
		}
		return nil
	}
	t.Cleanup(func() { gateFn = prev })
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true}); err != nil {
		t.Fatalf("same-tag apply success → nil; got %v", err)
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("same-tag must not pull the target image; got %v", f.Calls)
	}
	if !hasCall(f.Calls, failsApplyUp) { // the whole-project apply up ran
		t.Fatalf("expected the whole-project apply up; got %v", f.Calls)
	}
	if !strings.Contains(out.String(), "applied this CLI's stack definition") {
		t.Fatalf("got %q", out.String())
	}
	if got, _ := os.ReadFile(composePath(app)); !bytes.Equal(got, compose.ComposeYAML) {
		t.Fatalf("on-disk compose must now equal the embed; differs")
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Fatal("marker must be cleared on success")
	}
}

func TestUpdateSameTagGateFailRestoresExit1(t *testing.T) {
	cfg := setupUpdateEnv(t)
	// Drift FIRST, then capture prev == the drifted on-disk bytes runUpdate will read.
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	prev, _ := os.ReadFile(composePath(&App{CfgDir: cfg}))
	f := sameTagApplyFake(nil) // apply up succeeds; the GATE fails
	app, _, _ := engineApp(cfg, f, "")
	prevGate := gateFn
	gateFn = func(context.Context, *App, string, string, bool) error { return errors.New("gate: moved tag") }
	t.Cleanup(func() { gateFn = prevGate })
	err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true})
	if err == nil {
		t.Fatal("gate failure must error")
	}
	if exitCode(err) != 1 {
		t.Fatalf("same-tag failure is exit 1 (nothing committed); got %d", exitCode(err))
	}
	var cpe committedPendingError
	if errors.As(err, &cpe) {
		t.Fatal("same-tag failure must NOT be a committedPendingError")
	}
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("previous compose must be restored; got %q want %q", got, prev)
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Fatal("marker retained on failure")
	}
}

func TestUpdateSameTagDriftAppNotRunningRefuses(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{} // ps -q app → "" → not running
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true})
	if err == nil || !strings.Contains(err.Error(), "not running") {
		t.Fatalf("a drifted same-tag with the stack down must refuse; got %v", err)
	}
	if hasCall(f.Calls, joinHas("up")) {
		t.Fatalf("a refusal must apply nothing; got %v", f.Calls)
	}
}

func TestUpdateSameTagNoDriftUnchanged(t *testing.T) {
	cfg := setupUpdateEnv(t) // compose == embed → no drift
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"v0.1.1"}`))
	})
	f := &compose.FakeRunner{}
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true}); err != nil {
		t.Fatalf("no-drift same-tag → nil; got %v", err)
	}
	if !strings.Contains(out.String(), "already at v0.1.1") {
		t.Fatalf("want the unchanged same-tag message; got %q", out.String())
	}
	if hasCall(f.Calls, joinHas("up")) {
		t.Fatalf("no-drift same-tag must apply nothing; got %v", f.Calls)
	}
}

func TestUpdateSameTagStaleMarkerConfirmWording(t *testing.T) {
	cfg := setupUpdateEnv(t)                      // compose == embed
	if err := varlib.WriteMarker(); err != nil { // marker-only drift
		t.Fatal(err)
	}
	f := sameTagApplyFake(nil)
	app, out, _ := engineApp(cfg, f, "n\n") // decline the confirm to inspect its wording
	err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1"})
	if err == nil {
		t.Fatal("declined confirm must abort")
	}
	// marker-only (compose matches): the prompt must NOT claim the stack definition changed.
	if strings.Contains(out.String(), "this release updates the stack definition") {
		t.Fatalf("marker-only drift must use the re-apply wording; got %q", out.String())
	}
	if !strings.Contains(out.String(), "did not finish") {
		t.Fatalf("want the stale-marker re-apply prompt; got %q", out.String())
	}
}
```

- [ ] **Step 2: Run to verify failure** — `cd cli && go test ./cmd/ -run TestUpdateSameTag -count=1` → FAIL.

- [ ] **Step 3: Replace the same-tag block** (`update.go` current `if target == oldTag { … }`) with:

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

> `appRunning` uses `ps -q app`; `sameTagApplyFake` returns a cid for it → running. `TestUpdateSameTagStaleMarkerConfirmWording` reaches the confirm because `wantApply` is true (marker present) yet `composeDiffers` is false → the "did not finish" re-apply wording, not the "updates the stack definition" wording.

- [ ] **Step 4: Run same-tag tests + full update suite + vet/build** — `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -run TestUpdate -count=1` → PASS.

- [ ] **Step 5: Commit** (`git add cli/cmd/update.go cli/cmd/update_test.go`; subject: `feat(cli): same-tag update applies drifted compose (restore-bounded, post-apply gate, exit 1)`).

---

### Task 8: Real-upgrade post-commit apply + confirm-plan line

**Files:**
- Modify: `cli/cmd/update.go`, `cli/cmd/update_test.go`

**Interfaces:**
- Consumes: `applyAndGate` (Task 4), `committedPendingError` (Task 3), `wantApply`/`onDisk`/the captured target image id `A` (Tasks 4/6). Real-upgrade apply failure → `committedPendingError` (exit 2), **never** rollback.

- [ ] **Step 1: Write real-upgrade tests**

All build on `update21Fake(t)` so the backup/migrate/recreate spine actually runs and the update reaches the commit point. `failsApplyUp` matches ONLY the whole-project apply `up`; the step-9 recreate (`… app`) and the restore (`… --wait-timeout`) are not matched.

```go
func TestUpdateRealUpgradeDriftAppliesWholeProjectAfterGate(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := update21Fake(t)
	captureGate(t, nil) // both the step-10 commit gate and the re-assert gate pass
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err != nil {
		t.Fatalf("real-upgrade + drift apply → nil; got %v", err)
	}
	if !strings.Contains(out.String(), "updated v0.1.1 → v2.0.0") || !strings.Contains(out.String(), "applied this release's stack definition") {
		t.Fatalf("want the committed-and-applied line; got %q", out.String())
	}
	// the whole-project apply up ran AFTER the app-only recreate.
	ri := idxOfCall(f.Calls, joinHas("up -d --wait --pull never app")) // step-9 recreate
	ai := idxOfCall(f.Calls, failsApplyUp)                              // whole-project apply
	if ri < 0 || ai < 0 || !(ri < ai) {
		t.Fatalf("recreate (idx %d) must precede the whole-project apply (idx %d); calls=%v", ri, ai, f.Calls)
	}
	if got, _ := os.ReadFile(composePath(app)); !bytes.Equal(got, compose.ComposeYAML) {
		t.Fatalf("on-disk compose must equal the embed after a successful apply")
	}
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("the journal must be cleared (commit happened before the apply)")
	}
}

func TestUpdateRealUpgradeNoDriftNoSecondUp(t *testing.T) {
	cfg := setupUpdateEnv(t) // compose == embed
	f := update21Fake(t)
	captureGate(t, nil)
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err != nil {
		t.Fatalf("no-drift real-upgrade → nil; got %v", err)
	}
	if hasCall(f.Calls, failsApplyUp) { // only the step-9 recreate up; NO whole-project apply
		t.Fatalf("no-drift must not run the whole-project apply up; calls=%v", f.Calls)
	}
	if strings.Contains(out.String(), "applied this release's stack definition") {
		t.Fatalf("no-drift must not claim an apply; got %q", out.String())
	}
	if !strings.Contains(out.String(), "updated v0.1.1 → v2.0.0 (backup: ") {
		t.Fatalf("want the plain commit line; got %q", out.String())
	}
}

func TestUpdateRealUpgradeApplyUpFailIsolatedExit2(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	prev, _ := os.ReadFile(composePath(&App{CfgDir: cfg})) // prev == the drifted on-disk bytes
	f := update21Fake(t)
	f.RunFunc = func(args []string) error {
		if failsApplyUp(args) { // fail ONLY the post-commit whole-project apply up
			return errors.New("apply up failed")
		}
		return nil
	}
	captureGate(t, nil) // step-10 commit gate passes → the DB commit happens
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true})
	if exitCode(err) != 2 {
		t.Fatalf("post-commit apply failure → exit 2; got %d (%v)", exitCode(err), err)
	}
	// ISOLATION: no rollback / restore-engine call — the DB commit stands.
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) || hasCall(f.Calls, joinHas("mathion_restore_assets_")) {
		t.Fatalf("a post-commit apply failure must NOT roll back the DB; calls=%v", f.Calls)
	}
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("previous compose must be restored; got %q want %q", got, prev)
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Fatal("marker retained")
	}
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("journal must be absent (cleared pre-apply at commit)")
	}
}

func TestUpdateRealUpgradePostApplyGateFailExit2(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	prev, _ := os.ReadFile(composePath(&App{CfgDir: cfg}))
	f := update21Fake(t) // all ups (incl. the whole-project apply) succeed
	// gate: PASS the step-10 commit (1st call), FAIL the post-apply re-assert (2nd call).
	var n int32
	prevGate := gateFn
	gateFn = func(context.Context, *App, string, string, bool) error {
		if atomic.AddInt32(&n, 1) == 1 {
			return nil
		}
		return errors.New("post-apply gate: moved tag")
	}
	t.Cleanup(func() { gateFn = prevGate })
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true})
	if exitCode(err) != 2 {
		t.Fatalf("post-apply gate failure → exit 2; got %d (%v)", exitCode(err), err)
	}
	if got, _ := os.ReadFile(composePath(app)); string(got) != string(prev) {
		t.Fatalf("previous compose must be restored on a gate failure; got %q", got)
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("no DB rollback on a post-commit gate failure; calls=%v", f.Calls)
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Fatal("marker retained")
	}
}

func TestUpdateRealUpgradeApplyAndRestoreBothFailExit2(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := update21Fake(t)
	f.RunFunc = func(args []string) error {
		// Fail the whole-project apply up AND the bounded restore up (both post-commit),
		// but NOT the step-9 recreate. All three carry "up -d --wait"; the recreate is the
		// only one with a trailing `app` token, so exclude it. The restore's --wait-timeout
		// 120 breaks the contiguous "up -d --wait --pull never", so match the shorter prefix.
		if joinHas("up -d --wait")(args) && !containsArg(args, "app") {
			return errors.New("up boom")
		}
		return nil
	}
	captureGate(t, nil)
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true})
	if exitCode(err) != 2 {
		t.Fatalf("commit done, apply+restore both failed → still exit 2; got %d (%v)", exitCode(err), err)
	}
	if !strings.Contains(err.Error(), "runtime may be degraded") {
		t.Fatalf("want the degraded-runtime message; got %v", err)
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("no DB rollback; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("journal cleared at commit")
	}
}

func TestUpdateRealUpgradeNoReconcileDefersWithReminder(t *testing.T) {
	cfg := setupUpdateEnv(t)
	if err := os.WriteFile(composePath(&App{CfgDir: cfg}), []byte("DRIFTED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := update21Fake(t)
	captureGate(t, nil)
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true, NoReconcile: true}); err != nil {
		t.Fatalf("--no-reconcile real-upgrade → nil; got %v", err)
	}
	if hasCall(f.Calls, failsApplyUp) {
		t.Fatalf("--no-reconcile must NOT run the whole-project apply up; calls=%v", f.Calls)
	}
	if !strings.Contains(out.String(), "was NOT applied (--no-reconcile)") {
		t.Fatalf("want the deferred-apply reminder; got %q", out.String())
	}
}
```

- [ ] **Step 2: Run to verify failure** — `cd cli && go test ./cmd/ -run TestUpdateRealUpgrade -count=1` → FAIL.

- [ ] **Step 3: Wire the confirm-plan line + the post-commit apply**

In `runUpdate`'s confirm block, when `composeDiffers`, append this line before the "Continue?" prompt: *"This release also updates the stack definition; it is applied after the update completes (brief HTTPS interruption if the bundled proxy changed)."*

After the `RemoveJournal()`-success point (the committedPendingError failure branch from Task 3 stays as the *failure* branch; on success fall through), insert — before the final `updated %s → %s (backup …)` print:

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

> `A` is the captured target image id (the same value `TestUpdateGatePassCommits` asserts as `sha256:rec`). `applyAndGate` re-asserts the gate against `A` (the intended target), not a re-inspected tag. Replace `A`/`backupPath`/`oldTag` with the exact identifiers `runUpdate` already uses at that point (the captured-image id and success-line vars) — do not introduce new names.

- [ ] **Step 4: Run real-upgrade tests + FULL cmd suite + vet/build**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -count=1`
Expected: PASS (entire `cmd` package).

- [ ] **Step 5: Commit** (`git add cli/cmd/update.go cli/cmd/update_test.go`; subject: `feat(cli): real-upgrade update applies stack post-commit (exit-2 committedPending, restore net)`).

---

### Task 9: `--no-reconcile` flag coverage + README/`--help` docs

**Files:**
- Modify: `cli/cmd/root_test.go`, `cli/cmd/update.go` (help text), `README.md`

- [ ] **Step 1: Extend `TestUpdateCmdFlags` to require `--no-reconcile`**

In `cli/cmd/root_test.go`, add `"no-reconcile"` to the flag list `TestUpdateCmdFlags` (root_test.go:78) checks:

```go
	for _, fl := range []string{"version", "no-rollback", "yes", "no-reconcile"} {
```

- [ ] **Step 2: Run — confirm the flag is registered (this is the Cobra-wiring tripwire)**

Run: `cd cli && go test ./cmd/ -run TestUpdateCmdFlags -count=1`
Expected: PASS (Task 6 registered `--no-reconcile`). If it FAILS with "missing --no-reconcile", the flag registration in Task 6 is incomplete — fix there.

- [ ] **Step 3: Document exit 2 in the command help**

In `newUpdateCmd`, extend the command's `Long` (help) text with an exit-code note, worded to the taxonomy (NOT "the app is up", which is false in the restore-also-failed case):

> Exit codes: 0 success; 1 the update failed and was rolled back (or nothing changed); 2 the image/database update committed but applying/verifying this release's stack definition is still pending — re-run `sudo mathion reconcile`; 3 the update failed AND its rollback also failed (deployment state unknown).

- [ ] **Step 4: Add the README "Upgrading" note**

Under the self-hosting/upgrading section of `README.md`:
- `mathion update` now also applies this release's embedded **stack definition** (not just the app image); one `update` brings the deployment fully up to the CLI release.
- `--no-reconcile` applies only the image upgrade and defers the stack change (a drift notice reminds you; apply later with `sudo mathion reconcile`).
- **Behavior change:** a same-tag `update --yes` on a host whose compose drifted now applies it (a formerly no-op call can briefly recreate the bundled TLS proxy → short HTTPS blip).
- **Exit code 2** = "the image/database update committed, but applying/verifying the stack definition is still pending — re-run `sudo mathion reconcile`" (the database is never rolled back; in the rare case the restore also failed the runtime may be degraded — check `mathion status`). Same-tag apply failures are exit 1 (nothing committed).

- [ ] **Step 5: Build + full suite + commit**

Run: `cd cli && go build ./... && go vet ./cmd/ && go test ./cmd/ -count=1`
Expected: PASS.

```bash
git add cli/cmd/root_test.go cli/cmd/update.go README.md
git commit -m "$(cat <<'EOF'
docs(cli): --no-reconcile flag coverage + update stack-apply/exit-2 docs

TestUpdateCmdFlags now asserts --no-reconcile is registered; `mathion update --help`
and README document the stack-definition apply, --no-reconcile, and exit-2 semantics
("commit completed; post-commit work/verification remains").

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Post-merge on-host verification checklist (deferred, operator-run)

**Files:**
- Modify: `docs/superpowers/plans/2026-08-28-auto-reconcile-on-update-plan.md` (this section is the deliverable) — no code.

Spec §7 names the CLI-release→apply integration bound: only a real host proves the bundled TLS proxy actually recreates on a compose change while HTTPS keeps serving (hermetic tests stub the runner and cannot exercise a live proxy). This is a **deferred manual smoke**, run by the operator against `test.mathion.org` **after** the signed CLI release ships (matching how prior Phase-9-D slices treated on-host verification). It is NOT an automated test and does not block merge.

- [ ] **Step 1: Record the on-host smoke procedure in the SDD ledger / runbook**

Procedure to run on the Ubuntu host after the release that carries a compose change:
1. Reach the new CLI both ways in turn — `sudo mathion self-update` (curl|sh channel) and `sudo apt update && sudo apt upgrade mathion` (apt channel) — each on a host whose stack is the prior release.
2. `mathion status` shows the compose-drift notice (the CLI's embed differs from the on-disk compose).
3. `sudo mathion update` (same-tag drift path if the app image is unchanged, else the real-upgrade path): confirm it applies the stack, the bundled proxy is recreated, and HTTPS keeps serving (`curl -I https://test.mathion.org` → 200/307 over TLSv1.3, real LE cert), with `mathion status` reporting no drift afterward.
4. `sudo mathion update --no-reconcile` on a re-drifted host: the app updates, the drift notice persists, and the proxy is NOT recreated until a later `sudo mathion reconcile`.
5. Negative: a poisoned `.env` (loose perms) makes `mathion update` refuse before any container change.

- [ ] **Step 2: Mark the item deferred**

Note in the SDD ledger: "Task 10 = deferred on-host smoke on test.mathion.org, run post-release by the operator; not a merge gate." No commit.

---

## Self-Review (completed)

- **Spec coverage:** §4.1→T1; §4.6→T2; §4.4 exit-2/committedPendingError/RemoveJournal-fold→T3; §4.4 applyAndGate/restorePrevCompose/runningAppImageID→T4; §7 fixture migration→T5; §4.2 flag/signal/reminder→T6; §4.3 same-tag→T7; §4.3 real-upgrade + confirm line→T8; §4.5 self-heal is emergent (marker retained by T4/T7/T8; consumed by existing status/reconcile); §6 exit table→T3+T7+T8+T9(help); §8 files→all tasks; §7 tests: 1-3 pull/guard (existing, preserved via T5), 4 restore `--wait-timeout` (T4 `TestApplyAndGateGateFailRestoresBounded`), 5 real-upgrade post-apply-gate-fail exit 2 (T8 `TestUpdateRealUpgradePostApplyGateFailExit2`), 6 real-upgrade apply-up-fail isolation exit 2 (T8 `TestUpdateRealUpgradeApplyUpFailIsolatedExit2`), 7 reminder exact line + no-op (T6 + T8 `NoReconcile` test), 8 RemoveJournal-fail exit 2 (T3), 9-13 same-tag matrix (T7), 14 `.env` non-regular + loose-perm exact strings (T2), 15/integration on-host (T10). No task does anything the spec does not sanction.
- **Placeholder scan:** every test now has a concrete body and concrete FakeRunner wiring; no "add analogous/full set" delegations remain; the T8 isolation test asserts the fixed set (exit 2, on-disk == prev, journal absent, marker present, **no** `mathion_restore_db_`/`mathion_restore_assets_`). No TBDs.
- **Type/predicate consistency:** `failsApplyUp` (T4) reused by T7/T8; `sameTagApplyFake` (T7) local to same-tag tests; `update21Fake` (existing) is the real-upgrade base (StreamFunc + valid assets tar), so backup validation passes and the run reaches commit; `writeMarkerFn` seam (T4) mirrors `writeJournalFn`/`removeMarkerFn`; `gateFn(ctx,*App,string,string,bool)` matches every stub. FakeRunner predicates match the **full argv** (`joinHas`/`containsArg`), never `args[0]`. `import "bytes"` added only in T6 (first use). reconcile's local `composePath` var retired (T1) so it cannot shadow the package func.
- **Compile-at-each-commit:** T4's `applyAndGate`/`restorePrevCompose`/`runningAppImageID`/consts are unused by `runUpdate` until T7/T8 but exercised by T4's own tests — Go tolerates unused package funcs/methods/consts, and T4 adds no unused import. Every task's stated test command is green at its own boundary.
- **Dependency order:** T1→T4/T6/T7/T8 (`composePath`/`applyStack`/`clearApplyMarker`; **T6 uses `composePath`**); T2→T6 (`requirePrivateEnv`); T3→T8 (`committedPendingError`); T5 before T6/T7/T8 (non-drift fixture); T9 after T6 (`--no-reconcile` registered). T10 is standalone/deferred.

---

## Execution Handoff

Recommended: **Subagent-Driven** — fresh implementer per task, **Opus 4.8 at xhigh** for every implementer + reviewer, **codex@high** as the second independent gate, per-task dual gate (fix all Critical/Important, re-review after every fix), then a whole-branch dual-gate review, then `superpowers:finishing-a-development-branch`. Task 10 is a deferred operator smoke, not a merge gate.
