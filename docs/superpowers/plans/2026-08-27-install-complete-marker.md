# Install-complete Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `mathion install` a durable install-complete signal (written only after migrate + superuser succeed) and make every command that brings the stack up on an existing deployment refuse when the signal says the install never finished.

**Architecture:** Add a `Complete bool` field to the existing `install-state` marker (schema bump 1→2; Schema 1 grandfathered complete, no DB probe). `install` stamps `complete:true` only after its real work; a new `(*App).requireInstallComplete()` guard is wired into `reconcile`, `start`, `tls enable`, `update`, and standalone `restore`. `update`/`restore` refuse but never stamp; `restore`'s gate sits on the command (not the shared `restoreEngine`, preserving update's auto-rollback). A `status` notice mirrors the existing compose-drift pattern.

**Tech Stack:** Go 1.24, cobra CLI (`cli/`), hermetic tests via `compose.FakeRunner`.

**Spec:** `docs/superpowers/specs/2026-08-27-install-complete-marker-design.md` (revision 6).

## Global Constraints

Copied verbatim from spec §3 + project rules. Every task's requirements include this section.

- **`install` is the only completeness-stamping path.** `update`/`restore` are gated (they bring the stack up) but MUST NOT write `complete:true` — a restored/updated host's superuser provenance is unknown. Only `mathion install` (resume) completes a half-installed host.
- **`restore`'s gate sits on `newRestoreCmd`, NOT inside `restoreEngine`.** `restoreEngine` (`restore.go:197`) is reused by `update`'s in-process auto-rollback (`update.go:113`); gating the engine would break rollback.
- **Passive grandfathering.** A pre-slice `Schema 1` marker reads complete forever — no DB probe, no backfill command, no migration of the file.
- **No new marker file / no `varlib` artifact.** The signal is one field on the existing `install-state` (already `config.AtomicWrite`, 0600).
- **Atomic writes only** — all marker writes go through `config.WriteState` → `config.AtomicWrite`.
- **Embedded compose untouched.**
- `gofmt` clean; `go vet ./...` **and** `GOOS=linux go vet ./...` clean; `go test ./...` green (darwin; `cmd/` and `internal/config` carry no build tags, so they run on darwin directly).
- Each commit adds **only its named paths** (`git add <explicit path> ...`, never `-A`/`.`).
- Commit trailer, EXACT, on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run Go tooling from `cli/` (`cd cli && go test ./...`). Go is invoked bare (only the Python backend needs `.venv`).

## File Structure

- **`cli/internal/config/state.go`** — owns the `State` marker: gains the `Complete` field, an `InstallComplete()` method, and a widened `ParseState`. (Task 1)
- **`cli/internal/config/state_test.go`** — marker unit tests. (Task 1)
- **`cli/cmd/install.go`** — the only stamping path: fresh + resume write points. (Task 2)
- **`cli/cmd/install_fresh_test.go`, `cli/cmd/install_resume_test.go`** — stamping tests. (Task 2)
- **`cli/cmd/tls.go`** — new `(*App).requireInstallComplete()` guard (beside `requireInstalledDeployment`); wired into `tls enable`. (Task 3)
- **`cli/cmd/reconcile.go`** — wired. (Task 3)
- **`cli/cmd/start.go`, `cli/cmd/start_test.go`** — wired + `TestStartArgv` fixture migration. (Task 4)
- **`cli/cmd/update.go`, `cli/cmd/update_test.go`** — wired + new command-level refusal test. (Task 5)
- **`cli/cmd/restore.go`, `cli/cmd/restore_test.go`** — wired + `setupRestoreCmdEnv` helper + command-test migration + refusal test. (Task 6)
- **`cli/cmd/version.go`, `cli/cmd/status.go`, `cli/cmd/status_test.go`** — `maybeWarnInstallIncomplete` + emit + test. (Task 7)

---

### Task 1: Marker field, `InstallComplete()`, and `ParseState` accepts schema 1 or 2

**Files:**
- Modify: `cli/internal/config/state.go:92-135`
- Test: `cli/internal/config/state_test.go`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: `config.State{Schema int, AdminEmail string, Complete bool}`; method `func (s State) InstallComplete() bool`; `ParseState` now accepts `Schema ∈ {1,2}` with `AdminEmail != ""`. Consumed by Tasks 2-7.

- [ ] **Step 1: Write the failing tests**

Append to `cli/internal/config/state_test.go` (ensure imports include `os`, `path/filepath`, `strings`, `testing`):

```go
func TestInstallCompleteTruthTable(t *testing.T) {
	cases := []struct {
		name string
		s    State
		want bool
	}{
		{"schema1 grandfathered", State{Schema: 1, AdminEmail: "a@b.c"}, true},
		{"schema2 incomplete", State{Schema: 2, AdminEmail: "a@b.c", Complete: false}, false},
		{"schema2 complete", State{Schema: 2, AdminEmail: "a@b.c", Complete: true}, true},
	}
	for _, c := range cases {
		if got := c.s.InstallComplete(); got != c.want {
			t.Errorf("%s: InstallComplete()=%v want %v", c.name, got, c.want)
		}
	}
}

func TestParseStateAcceptsSchema1And2(t *testing.T) {
	for _, raw := range []string{
		`{"schema":1,"admin_email":"a@b.c"}`,
		`{"schema":2,"admin_email":"a@b.c"}`,
		`{"schema":2,"admin_email":"a@b.c","complete":true}`,
	} {
		if _, err := ParseState([]byte(raw)); err != nil {
			t.Errorf("ParseState(%s) unexpected error: %v", raw, err)
		}
	}
	for _, raw := range []string{
		`{"schema":0,"admin_email":"a@b.c"}`,
		`{"schema":3,"admin_email":"a@b.c"}`,
		`{"schema":2,"admin_email":""}`,
	} {
		if _, err := ParseState([]byte(raw)); err == nil {
			t.Errorf("ParseState(%s) expected error, got nil", raw)
		}
	}
}

func TestSchema2IncompleteOmitsCompleteKey(t *testing.T) {
	dir := t.TempDir()
	if err := WriteState(dir, State{Schema: 2, AdminEmail: "a@b.c", Complete: false}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "install-state"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "complete") {
		t.Fatalf("complete:false must omit the key; got %s", b)
	}
	got, err := ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.InstallComplete() {
		t.Fatal("schema2 without complete key must read back incomplete")
	}
}

func TestSchema2CompleteRoundTrip(t *testing.T) {
	dir := t.TempDir()
	want := State{Schema: 2, AdminEmail: "a@b.c", Complete: true}
	if err := WriteState(dir, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("round-trip = %+v want %+v", got, want)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && go test ./internal/config/ -run 'InstallComplete|ParseStateAcceptsSchema1And2|Schema2' -v`
Expected: FAIL — `State` has no `Complete` field / `InstallComplete` undefined / `ParseState` rejects schema 2.

- [ ] **Step 3: Add the field + method**

In `cli/internal/config/state.go`, replace the `State` struct (lines 92-95):

```go
type State struct {
	Schema     int    `json:"schema"`
	AdminEmail string `json:"admin_email"`
	Complete   bool   `json:"complete,omitempty"` // meaningful only for Schema >= 2
}

// InstallComplete reports whether install finished (migrate + superuser).
// Schema 1 (written by the pre-marker CLI) is grandfathered complete; Schema 2
// carries the explicit flag. Assumes the receiver already passed ParseState
// (Schema is 1 or 2).
func (s State) InstallComplete() bool { return s.Schema == 1 || s.Complete }
```

- [ ] **Step 4: Widen `ParseState`**

In `cli/internal/config/state.go`, change the guard in `ParseState` (line 122):

```go
	if (s.Schema != 1 && s.Schema != 2) || s.AdminEmail == "" {
		return State{}, fmt.Errorf("install-state is incomplete or unknown schema (%d)", s.Schema)
	}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cli && go test ./internal/config/ -v`
Expected: PASS (all, including pre-existing state tests — a Schema-1 file's byte shape is unchanged by the `omitempty` field).

- [ ] **Step 6: Commit**

```bash
cd cli
git add internal/config/state.go internal/config/state_test.go
git commit -m "$(printf 'feat(cli): add install-complete marker field to install-state\n\nSchema bump 1->2 with Complete bool (complete,omitempty keeps Schema-1\nbyte shape). InstallComplete() grandfathers Schema 1 as complete; ParseState\naccepts schema 1 or 2 (AdminEmail still required). Spec 4.1.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: `install` stamps completion after migrate + superuser

**Files:**
- Modify: `cli/cmd/install.go` — fresh write (`:190`), fresh post-superuser stamp (after `:216`), resume post-superuser stamp (`:163`)
- Test: `cli/cmd/install_fresh_test.go`, `cli/cmd/install_resume_test.go`

**Interfaces:**
- Consumes: `config.State{...Complete}`, `config.State.InstallComplete()` (Task 1).
- Produces: on-disk `install-state` = `Schema 2, complete:true` after any successful install (fresh or resume); `Schema 2, complete:false` after a partial. No new exported symbols.

**Note:** `runInstallFresh` is called directly in tests (it bypasses the dispatcher's volume-guard/PortFree). The completeness stamp is a `WriteState` (file write) — it is **not** a `Runner` call, so it does not appear in `FakeRunner.Calls` and does not perturb existing argv-order assertions (e.g. `TestFreshInstallWritesConfigAndRuns`).

- [ ] **Step 1: Write the failing tests**

Append to `cli/cmd/install_fresh_test.go` (add `"errors"` to imports; `joinHas` is already defined in the package via `restore_test.go`):

```go
func TestFreshInstallStampsComplete(t *testing.T) {
	dir := t.TempDir()
	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstallFresh(context.Background(), installOpts{
		Domain: "learn.example.edu", AdminEmail: "you@example.edu", Version: "v0.1.1",
	}); err != nil {
		t.Fatal(err)
	}
	st, err := config.ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Schema != 2 || !st.Complete || !st.InstallComplete() {
		t.Fatalf("successful fresh install must stamp Schema 2 complete:true; got %+v", st)
	}
}

func TestFreshInstallSuperuserFailLeavesIncomplete(t *testing.T) {
	dir := t.TempDir()
	f := &compose.FakeRunner{RunFunc: func(args []string) error {
		if joinHas("create-superuser")(args) {
			return errors.New("boom")
		}
		return nil
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstallFresh(context.Background(), installOpts{
		Domain: "learn.example.edu", AdminEmail: "you@example.edu", Version: "v0.1.1",
	}); err == nil {
		t.Fatal("expected the superuser failure to abort the fresh install")
	}
	st, err := config.ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Schema != 2 || st.Complete || st.InstallComplete() {
		t.Fatalf("a partial fresh install must leave Schema 2 complete:false; got %+v", st)
	}
}
```

Append to `cli/cmd/install_resume_test.go` (imports `context`, `os`, `path/filepath`, `strings`, `errors`, `compose`, `config` are present or add `errors`):

```go
func TestResumeStampsComplete(t *testing.T) {
	dir := t.TempDir()
	config.WriteState(dir, config.State{Schema: 2, AdminEmail: "you@example.edu", Complete: false})
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "S==", "hex")
	os.WriteFile(filepath.Join(dir, ".env"), []byte(config.RenderEnv(env)), 0o600)

	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstall(context.Background(), installOpts{Domain: "ignored", AdminEmail: "ignored@x.edu", Version: "v9"}); err != nil {
		t.Fatal(err)
	}
	st, _ := config.ReadState(dir)
	if st.Schema != 2 || !st.Complete {
		t.Fatalf("a successful resume must stamp Schema 2 complete:true; got %+v", st)
	}
	if st.AdminEmail != "you@example.edu" {
		t.Fatalf("resume must keep the seeded admin email; got %q", st.AdminEmail)
	}
}

func TestResumeSuperuserFailLeavesIncomplete(t *testing.T) {
	dir := t.TempDir()
	config.WriteState(dir, config.State{Schema: 2, AdminEmail: "you@example.edu", Complete: false})
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "S==", "hex")
	os.WriteFile(filepath.Join(dir, ".env"), []byte(config.RenderEnv(env)), 0o600)

	f := &compose.FakeRunner{RunFunc: func(args []string) error {
		if joinHas("create-superuser")(args) {
			return errors.New("boom")
		}
		return nil
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstall(context.Background(), installOpts{Domain: "ignored", AdminEmail: "ignored@x.edu", Version: "v9"}); err == nil {
		t.Fatal("expected the resume superuser failure to abort")
	}
	st, _ := config.ReadState(dir)
	if st.Schema != 2 || st.Complete {
		t.Fatalf("a failed resume must leave the seeded incomplete marker; got %+v", st)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && go test ./cmd/ -run 'FreshInstallStampsComplete|FreshInstallSuperuserFail|ResumeStampsComplete|ResumeSuperuserFail' -v`
Expected: FAIL — fresh install still writes `Schema 1`; resume returns the raw `compose` result and never stamps.

- [ ] **Step 3: Fresh path — started write becomes Schema 2**

In `cli/cmd/install.go`, change the write at line 190:

```go
	if err := config.WriteState(a.CfgDir, config.State{Schema: 2, AdminEmail: email, Complete: false}); err != nil {
		return err
	}
```

- [ ] **Step 4: Fresh path — stamp complete after superuser**

In `cli/cmd/install.go`, immediately after the `create-superuser` block (ends line 218) and **before** the `// 8. Next steps` comment (line 220), insert:

```go
	if err := config.WriteState(a.CfgDir, config.State{Schema: 2, AdminEmail: email, Complete: true}); err != nil {
		return err
	}
```

- [ ] **Step 5: Resume path — run-then-stamp**

In `cli/cmd/install.go`, replace the resume tail (line 163):

```go
	if err := a.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", "--", st.AdminEmail); err != nil {
		return err
	}
	return config.WriteState(a.CfgDir, config.State{Schema: 2, AdminEmail: st.AdminEmail, Complete: true})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run 'Install|Resume|Fresh' -v`
Expected: PASS — including the pre-existing `TestFreshInstallWritesConfigAndRuns` (its 4-call argv assertion is unaffected; it only asserts `AdminEmail`, which is unchanged).

- [ ] **Step 7: Commit**

```bash
cd cli
git add cmd/install.go cmd/install_fresh_test.go cmd/install_resume_test.go
git commit -m "$(printf 'feat(cli): install stamps complete only after migrate + superuser\n\nFresh: started write becomes Schema 2 complete:false; a post-superuser\nWriteState stamps complete:true before the next-steps banner. Resume: run\ncreate-superuser then stamp complete:true. A crash in between leaves\ncomplete:false. install is the only stamping path. Spec 4.2.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `requireInstallComplete` guard, wired into `reconcile` and `tls enable`

**Files:**
- Modify: `cli/cmd/tls.go` — add `(*App).requireInstallComplete()` after `requireInstalledDeployment` (after `:255`); wire into `tls enable` (after `:188`)
- Modify: `cli/cmd/reconcile.go` — wire after `:52`
- Test: `cli/cmd/tls_test.go`, `cli/cmd/reconcile_test.go`

**Interfaces:**
- Consumes: `config.ReadState`, `config.State.InstallComplete()` (Task 1).
- Produces: `func (a *App) requireInstallComplete() error` — returns nil for `Schema 1` / `Schema 2 complete:true`; a distinct error for `Schema 2 complete:false` and for a missing/corrupt marker. Consumed by Tasks 4-6. `tls.go` already imports `errors`, `fmt`, `os`, `config` — no new imports.

- [ ] **Step 1: Write the failing tests**

Append to `cli/cmd/tls_test.go` (mirror the existing `installedDeployment`/gate idiom; check imports for `config`, `testing`, `strings`):

```go
func TestRequireInstallComplete(t *testing.T) {
	// missing marker
	empty := t.TempDir()
	if err := (&App{CfgDir: empty}).requireInstallComplete(); err == nil {
		t.Fatal("missing install-state must refuse")
	}
	// incomplete
	inc := t.TempDir()
	if err := config.WriteState(inc, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: false}); err != nil {
		t.Fatal(err)
	}
	err := (&App{CfgDir: inc}).requireInstallComplete()
	if err == nil || !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("incomplete install must refuse with a resume hint; got %v", err)
	}
	// complete + grandfathered
	for _, s := range []config.State{
		{Schema: 2, AdminEmail: "a@b.c", Complete: true},
		{Schema: 1, AdminEmail: "a@b.c"},
	} {
		d := t.TempDir()
		if err := config.WriteState(d, s); err != nil {
			t.Fatal(err)
		}
		if err := (&App{CfgDir: d}).requireInstallComplete(); err != nil {
			t.Fatalf("%+v must pass; got %v", s, err)
		}
	}
}

func TestTLSEnableRefusesOnIncompleteInstall(t *testing.T) {
	dir := installedDeployment(t, false) // seeds Schema 1 + .env + compose
	if err := config.WriteState(dir, config.State{Schema: 2, AdminEmail: "admin@example.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: io.Discard, Err: io.Discard}
	if err := app.tlsEnable(context.Background(), tlsEnableOpts{Domain: "learn.example.edu", Email: "admin@example.edu"}); err == nil {
		t.Fatal("tls enable must refuse on an incomplete install")
	}
	if hasCall(f.Calls, joinHas("up -d")) {
		t.Fatalf("tls enable must not bring the stack up on refusal; calls=%v", f.Calls)
	}
}
```

> **Interface note for the implementer:** `tls enable`'s entrypoint method and options type must match the real names in `tls.go` (the method that runs at `tls.go:186` and its `opts` struct). Read `tls.go` around the `newTLSCmd`/enable path and use the exact method + option-field names; the assertion (refuse + no `up`) is what matters. If `tlsEnable`/`tlsEnableOpts` differ, adjust the call, not the assertion.

Append to `cli/cmd/reconcile_test.go`:

```go
func TestReconcileRefusesOnIncompleteInstall(t *testing.T) {
	dir := installedDeployment(t, false)
	varlibReady(t)
	if err := config.WriteState(dir, config.State{Schema: 2, AdminEmail: "admin@example.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: io.Discard, Err: io.Discard}
	if err := app.reconcile(context.Background()); err == nil {
		t.Fatal("reconcile must refuse on an incomplete install")
	}
	if hasCall(f.Calls, joinHas("up -d")) {
		t.Fatalf("reconcile must not bring the stack up on refusal; calls=%v", f.Calls)
	}
}
```

> **Interface note:** `reconcile`'s entrypoint at `reconcile.go` runs `a.requireInstalledDeployment()` at `:50`; call the same method these tests' siblings call (e.g. `(*App).reconcile`) with `varlibReady(t)` already set up (existing reconcile tests use it to bypass `lockAndGuard`). Match the real method name.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && go test ./cmd/ -run 'RequireInstallComplete|TLSEnableRefuses|ReconcileRefuses' -v`
Expected: FAIL — `requireInstallComplete` undefined; reconcile/tls proceed on the incomplete host.

- [ ] **Step 3: Add the guard method**

In `cli/cmd/tls.go`, immediately after `requireInstalledDeployment` (its closing brace at line 255), add:

```go
// requireInstallComplete refuses when install-state says the install never
// finished migrating/creating the superuser (Schema 2, complete:false), OR when
// there is no valid install-state at all (missing/corrupt). Schema 1 is
// grandfathered complete. It is a separate predicate from requireInstalledDeployment
// so start/update/restore adopt exactly this one check.
func (a *App) requireInstallComplete() error {
	st, err := config.ReadState(a.CfgDir)
	if err != nil {
		return fmt.Errorf("no valid mathion install found at %s (%w); run `sudo mathion install` to set one up. If a previous install left a broken marker here, repair its install-state so install can resume, or run `sudo mathion uninstall --purge` (removes containers and volumes) then remove the config dir by hand before reinstalling", a.CfgDir, err)
	}
	if !st.InstallComplete() {
		return errors.New("this deployment's install did not finish (database not migrated / superuser not created); resume it with `sudo mathion install` before continuing")
	}
	return nil
}
```

- [ ] **Step 4: Wire into `reconcile`**

In `cli/cmd/reconcile.go`, immediately after the `requireInstalledDeployment` block (closing brace at line 52) and before the `// Step 3` comment (line 53), insert:

```go
	// Completeness gate: refuse a never-finished install BEFORE any mutation (spec §4.3).
	if err := a.requireInstallComplete(); err != nil {
		return err
	}
```

- [ ] **Step 5: Wire into `tls enable`**

In `cli/cmd/tls.go`, immediately after the `requireInstalledDeployment` block in the enable path (closing brace at line 188) and before the `// 4. Re-materialize` comment (line 189), insert:

```go
	// Completeness gate: refuse a never-finished install before compose re-materialize / up (spec §4.3).
	if err := a.requireInstallComplete(); err != nil {
		return err
	}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run 'RequireInstallComplete|TLSEnable|Reconcile' -v`
Expected: PASS — existing reconcile/tls tests seed `Schema 1` (grandfathered) and stay green; the new refusal tests pass.

- [ ] **Step 7: Commit**

```bash
cd cli
git add cmd/tls.go cmd/reconcile.go cmd/tls_test.go cmd/reconcile_test.go
git commit -m "$(printf 'feat(cli): add requireInstallComplete guard; gate reconcile + tls enable\n\nNew (*App).requireInstallComplete refuses a Schema 2 complete:false or\nmissing/corrupt install-state; Schema 1 grandfathered. Wired after the\nexisting requireInstalledDeployment in reconcile and tls enable, before any\ncompose write / up. Spec 4.3.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Wire `start`; migrate `TestStartArgv` fixture; add refusal test

**Files:**
- Modify: `cli/cmd/start.go` — gate after `lockAndGuard`, before `up` (between `:14` and `:15`)
- Modify: `cli/cmd/start_test.go` — migrate `TestStartArgv` (`:45-61`) to a seeded `t.TempDir()`; add refusal test

**Interfaces:**
- Consumes: `(*App).requireInstallComplete()` (Task 3).
- Produces: `start` refuses on an incomplete/missing marker; its only new behavior. No new exported symbols.

- [ ] **Step 1: Migrate `TestStartArgv` and add the refusal test (failing)**

In `cli/cmd/start_test.go`, replace `TestStartArgv` (lines 45-61) with a temp-dir, marker-seeded version, and add a refusal test. Ensure `config` is imported.

```go
func TestStartArgv(t *testing.T) {
	rootedVarlib(t)
	cfg := t.TempDir()
	if err := config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "you@example.edu", Complete: true}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	var out, errb bytes.Buffer
	app := &App{CfgDir: cfg, Project: "mathion_prod", Runner: f, Out: &out, Err: &errb}
	cmd := newStartCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", cfg + "/docker-compose.yml", "--env-file", cfg + "/.env", "up", "-d", "--wait", "--pull", "never"}
	i := idxOfCall(f.Calls, joinHas("up -d --wait --pull never"))
	if i < 0 || !reflect.DeepEqual(f.Calls[i], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
}

func TestStartRefusesOnIncompleteInstall(t *testing.T) {
	rootedVarlib(t)
	cfg := t.TempDir()
	if err := config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "you@example.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app := &App{CfgDir: cfg, Project: "mathion_prod", Runner: f, Out: io.Discard, Err: io.Discard}
	cmd := newStartCmd(app)
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Fatal("start must refuse on an incomplete install")
	}
	if hasCall(f.Calls, joinHas("up -d")) {
		t.Fatalf("start must not bring the stack up on refusal; calls=%v", f.Calls)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && go test ./cmd/ -run 'TestStartArgv|TestStartRefusesOnIncomplete' -v`
Expected: FAIL — `TestStartArgv` now `ReadState`s a seeded temp dir but `start` has no gate wired yet (so the refusal test's `up` still fires; and until Step 3, `newStartCmd` ignores the marker so the refusal test fails to get an error).

- [ ] **Step 3: Wire the gate into `start`**

In `cli/cmd/start.go`, insert the gate between the `lockAndGuard` proceed-check (closing brace at line 14) and the `// --pull never` comment (line 15):

```go
			if err := app.requireInstallComplete(); err != nil {
				return err
			}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run 'Start' -v`
Expected: PASS — `TestStartArgv` (complete marker → up runs), `TestStartRefusesOnIncompleteInstall` (refuse, no up), and `TestStartRefusesOnBreadcrumb` (still refuses at the breadcrumb via `lockAndGuard` `proceed=false`, before the new read).

- [ ] **Step 5: Commit**

```bash
cd cli
git add cmd/start.go cmd/start_test.go
git commit -m "$(printf 'feat(cli): gate start on install completeness\n\nstart now runs requireInstallComplete after lockAndGuard, before up. Migrated\nTestStartArgv off the hardcoded /etc/mathion CfgDir to a seeded t.TempDir\n(start now reads install-state); added an incomplete-install refusal test.\nSpec 4.3/4.4.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Wire `update`; add command-level refusal test

**Files:**
- Modify: `cli/cmd/update.go` — gate in `newUpdateCmd` after `guardEntry` (`:153-155`), before `runUpdate` (`:158`)
- Modify: `cli/cmd/update_test.go` — new `newUpdateCmd`-level refusal test

**Interfaces:**
- Consumes: `(*App).requireInstallComplete()` (Task 3); test harness `setupRestoreEnv`, `asRoot`, `engineApp`, `hasCall`, `isPull`, `joinHas`.
- Produces: `update` refuses on an incomplete/missing marker; **never stamps**. No new exported symbols.

**Note:** Every existing `update_test.go` test calls `runUpdate(...)` **directly**, below the `newUpdateCmd` gate — so none is affected and the gate needs its own new command-level test.

- [ ] **Step 1: Write the failing test**

Append to `cli/cmd/update_test.go`:

```go
func TestUpdateCmdRefusesOnIncompleteInstall(t *testing.T) {
	cfg := setupRestoreEnv(t) // full .env + a fresh MATHION_VARLIB_DIR
	asRoot(t)
	if err := config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "a@b.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	c := newUpdateCmd(app)
	c.SetContext(context.Background())
	if err := c.RunE(c, nil); err == nil {
		t.Fatal("update must refuse on an incomplete install")
	}
	if hasCall(f.Calls, isPull) || hasCall(f.Calls, joinHas("up -d")) {
		t.Fatalf("update must not pull/up on refusal; calls=%v", f.Calls)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && go test ./cmd/ -run 'TestUpdateCmdRefusesOnIncomplete' -v`
Expected: FAIL — no gate yet; `update` proceeds past `guardEntry` toward `runUpdate` (which errors later, but not from the completeness gate, and may pull).

- [ ] **Step 3: Wire the gate into `newUpdateCmd`**

In `cli/cmd/update.go`, insert the gate immediately after the `guardEntry("update")` block (closing brace at line 155) and before `ctx, stop := withSignalCancel(...)` (line 156):

```go
			if err := app.requireInstallComplete(); err != nil {
				return err
			}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run 'Update' -v`
Expected: PASS — the new refusal test passes; all existing `runUpdate`-driven tests are unaffected (they never enter `newUpdateCmd`).

- [ ] **Step 5: Commit**

```bash
cd cli
git add cmd/update.go cmd/update_test.go
git commit -m "$(printf 'feat(cli): gate update on install completeness (refuse, never stamp)\n\nrequireInstallComplete runs in newUpdateCmd after guardEntry, under the lock,\nbefore runUpdate/pull. update never writes complete:true. New command-level\nrefusal test (existing update tests drive runUpdate directly, below the gate).\nSpec 4.3.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Wire standalone `restore`; add `setupRestoreCmdEnv`; migrate command tests; refusal test

**Files:**
- Modify: `cli/cmd/restore.go` — gate in `newRestoreCmd` after `guardEntry` (`:57-59`), before archive resolution (`:60`)
- Modify: `cli/cmd/restore_test.go` — add `setupRestoreCmdEnv`; migrate the eight `newRestoreCmd` tests; add refusal test; keep `setupRestoreEnv` markerless

**Interfaces:**
- Consumes: `(*App).requireInstallComplete()` (Task 3); `setupRestoreEnv`, `asRoot`, `engineApp`, `newRestoreCmd`, `hasCall`, `isPull`, `joinHas`.
- Produces: `restore` **command** refuses on an incomplete/missing marker; **never stamps**; `restoreEngine` stays **ungated** (update's auto-rollback path). New test helper `setupRestoreCmdEnv`.

**Critical:** the gate goes on `newRestoreCmd`, **not** `restoreEngine`. The ~20 engine-level `TestRestoreEngine*` tests keep using markerless `setupRestoreEnv` — they must stay green, proving the engine is ungated.

- [ ] **Step 1: Add the command fixture + refusal test; migrate command tests (failing)**

In `cli/cmd/restore_test.go`, add the helper (place beside `setupRestoreEnv` at `:246`):

```go
// setupRestoreCmdEnv is setupRestoreEnv plus a COMPLETE install-state, for the
// command-level restore tests that drive newRestoreCmd through the new
// requireInstallComplete gate. Engine-level tests keep using setupRestoreEnv
// (markerless) so an accidental gate inside restoreEngine fails them loudly.
func setupRestoreCmdEnv(t *testing.T) string {
	t.Helper()
	cfg := setupRestoreEnv(t)
	if err := config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "admin@example.edu", Complete: true}); err != nil {
		t.Fatal(err)
	}
	return cfg
}
```

Add the refusal test:

```go
func TestRestoreCmdRefusesOnIncompleteInstall(t *testing.T) {
	cfg := setupRestoreEnv(t) // markerless; seed incomplete explicitly
	asRoot(t)
	if err := config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "a@b.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.Flags().Set("yes", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.RunE(c, nil); err == nil {
		t.Fatal("restore must refuse on an incomplete install")
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) || hasCall(f.Calls, isPull) {
		t.Fatalf("restore must not touch the engine on refusal; calls=%v", f.Calls)
	}
}
```

Migrate the eight command-level tests to the complete-state fixture: in each of `TestRestoreCmdLatestResolves` (`:977`), `TestRestoreCmdLatestNoBackups` (`:1014`), `TestRestoreCmdUntrustedPathWarns` (`:1036`), `TestRestoreCmdInvalidManagedCapHardFails` (`:1128`), `TestRestoreCmdExemptProceedsReplacesBreadcrumb` (`:1157`), `TestRestoreCmdLockHeld` (`:1191`), `TestRestoreCmdYesBypassesConfirm` (`:1215`), and `TestRestoreCmdFlagValidation` (`:1238`), replace the `cfg := setupRestoreEnv(t)` line with `cfg := setupRestoreCmdEnv(t)`.

> If any of the eight builds its CfgDir differently (not via `setupRestoreEnv`), instead seed a complete marker into that test's CfgDir with `config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "admin@example.edu", Complete: true})`. `LockHeld`/`FlagValidation` abort before the gate — seeding them is a harmless superset.

- [ ] **Step 2: Run tests to verify the state**

Run: `cd cli && go test ./cmd/ -run 'TestRestoreCmd|TestRestoreEngine' -v`
Expected: `TestRestoreCmdRefusesOnIncompleteInstall` FAILS (no gate yet → engine runs). The migrated command tests and all `TestRestoreEngine*` tests still PASS at this point (a complete/absent marker doesn't gate anything yet).

- [ ] **Step 3: Wire the gate into `newRestoreCmd`**

In `cli/cmd/restore.go`, insert the gate immediately after the `guardEntry("restore")` block (closing brace at line 59) and before the `// Resolve the target archive` comment (line 60):

```go
			if err := app.requireInstallComplete(); err != nil {
				return err
			}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run 'Restore' -v`
Expected: PASS — the refusal test now refuses (no engine call); the eight migrated command tests proceed (complete marker); every `TestRestoreEngine*` test stays green (markerless `setupRestoreEnv`, engine ungated). This green engine suite is the proof the gate is on the command, not the engine.

- [ ] **Step 5: Commit**

```bash
cd cli
git add cmd/restore.go cmd/restore_test.go
git commit -m "$(printf 'feat(cli): gate standalone restore on install completeness (command, not engine)\n\nrequireInstallComplete runs in newRestoreCmd after guardEntry, before archive\nresolution. restore never stamps; restoreEngine stays ungated so update auto-\nrollback is unaffected. Added setupRestoreCmdEnv (complete marker) for the eight\ncommand-level tests; setupRestoreEnv stays markerless for TestRestoreEngine* as\na tripwire. New refusal test. Spec 4.3/4.4.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: `status` incomplete-install notice

**Files:**
- Modify: `cli/cmd/version.go` — add `maybeWarnInstallIncomplete` (beside `maybeWarnComposeDrift`, before `:82`)
- Modify: `cli/cmd/status.go` — emit before `maybeWarnComposeDrift` (`:28`)
- Test: `cli/cmd/status_test.go`

**Interfaces:**
- Consumes: `config.ReadState`, `config.State.InstallComplete()` (Task 1).
- Produces: `func maybeWarnInstallIncomplete(w io.Writer, cfgDir string)` — prints a one-line notice when the marker is incomplete; fail-quiet otherwise. `version.go` already imports `io`, `fmt`, `config` — no new imports.

- [ ] **Step 1: Write the failing test**

Append to `cli/cmd/status_test.go` (create it if absent, `package cmd`, import `bytes`, `strings`, `testing`, `config`). Emit is exercised through the helper AND `newStatusCmd`:

```go
func TestMaybeWarnInstallIncomplete(t *testing.T) {
	// incomplete → notice
	inc := t.TempDir()
	config.WriteState(inc, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: false})
	var b bytes.Buffer
	maybeWarnInstallIncomplete(&b, inc)
	if !strings.Contains(b.String(), "did not finish") {
		t.Fatalf("incomplete install must warn; got %q", b.String())
	}
	// complete + grandfathered + missing → silent
	for _, seed := range []func(string){
		func(d string) { config.WriteState(d, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: true}) },
		func(d string) { config.WriteState(d, config.State{Schema: 1, AdminEmail: "a@b.c"}) },
		func(string) {}, // no marker at all
	} {
		d := t.TempDir()
		seed(d)
		var q bytes.Buffer
		maybeWarnInstallIncomplete(&q, d)
		if q.Len() != 0 {
			t.Fatalf("must be silent; got %q", q.String())
		}
	}
}

func TestStatusEmitsIncompleteNotice(t *testing.T) {
	cfg := t.TempDir()
	config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: false})
	f := &compose.FakeRunner{}
	var out bytes.Buffer
	app := &App{CfgDir: cfg, Project: "mathion_prod", Runner: f, Out: &out, Err: &out}
	// Force the health probe to fail so status returns nil without a live app.
	prev := healthProbe
	healthProbe = func(context.Context, string) error { return errors.New("stub") }
	t.Cleanup(func() { healthProbe = prev })
	c := newStatusCmd(app)
	c.SetContext(context.Background())
	if err := c.RunE(c, nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "did not finish") {
		t.Fatalf("status must surface the incomplete-install notice; got %q", out.String())
	}
}
```

> **Interface note:** `healthProbe` is the seam at `status.go:15` (`var healthProbe = dockerx.HealthProbe`); overriding it to return a non-nil error makes `status` print then return nil without a live app. Test imports: `bytes`, `context`, `errors`, `strings`, `testing`, plus `compose` and `config`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && go test ./cmd/ -run 'MaybeWarnInstallIncomplete|StatusEmitsIncomplete' -v`
Expected: FAIL — `maybeWarnInstallIncomplete` undefined; status prints no notice.

- [ ] **Step 3: Add the helper**

In `cli/cmd/version.go`, immediately before the `maybeWarnComposeDrift` doc-comment (line 82), add:

```go
// maybeWarnInstallIncomplete prints a one-line notice when install-state says the
// install never finished, so `mathion status` surfaces it before the operator
// hits a hard refusal. Fail-quiet: an unreadable/absent install-state (e.g.
// non-root `mathion status`, mode-0600 file) prints nothing.
func maybeWarnInstallIncomplete(w io.Writer, cfgDir string) {
	if w == nil {
		return
	}
	st, err := config.ReadState(cfgDir)
	if err != nil {
		return
	}
	if !st.InstallComplete() {
		fmt.Fprintln(w, "note: this deployment's install did not finish — run `sudo mathion install` to complete it")
	}
}
```

- [ ] **Step 4: Emit from `status`**

In `cli/cmd/status.go`, immediately before the `maybeWarnComposeDrift(app.Out, app.CfgDir)` call (line 28), insert:

```go
			maybeWarnInstallIncomplete(app.Out, app.CfgDir)
```

(A never-finished install is more fundamental than a drifted compose, so it prints first. The call sits before the health-branch split, so it covers both nil-return branches.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run 'Status|MaybeWarnInstall' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd cli
git add cmd/version.go cmd/status.go cmd/status_test.go
git commit -m "$(printf 'feat(cli): status surfaces an incomplete-install notice\n\nmaybeWarnInstallIncomplete (beside maybeWarnComposeDrift) prints a one-line\nnotice when install-state says the install never finished; fail-quiet on an\nunreadable/absent marker. Emitted from status before the drift notice. Spec 4.5.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (after all tasks)

- [ ] `cd cli && gofmt -l . ` → no output.
- [ ] `cd cli && go vet ./...` and `cd cli && GOOS=linux go vet ./...` → clean.
- [ ] `cd cli && go test ./...` → all green (darwin).
- [ ] Optional linux-container run: `go test ./...` inside `golang:1.24` (OrbStack, host GOMODCACHE mounted) → green.
- [ ] `git log --oneline` shows seven focused commits, each adding only its named paths, each with the exact trailer.

## Self-Review

**Spec coverage:**
- §4.1 marker (Complete field, InstallComplete, ParseState {1,2}) → Task 1.
- §4.2 install stamping (fresh started+complete, resume complete, convergence) → Task 2.
- §4.3 `requireInstallComplete` + all five gate placements → Task 3 (helper + reconcile + tls), Task 4 (start), Task 5 (update), Task 6 (restore).
- §4.4 grandfathering + fixture exceptions (start_test migration; restore command-test split; update needs none) → Task 4, Task 6.
- §4.5 status notice → Task 7.
- §4.6 residual — no code (documented acceptance).
- §5 testing — every listed case mapped: ParseState/InstallComplete + omitempty round-trip (T1); fresh/resume stamping incl. failed-superuser-leaves-incomplete (T2); gate distinct messages (T3); per-command refuse/proceed (T3-T6); auto-rollback engine ungated (T6, via green `TestRestoreEngine*`); status notice via `newStatusCmd` (T7).

**Placeholder scan:** All code blocks are literal. Two "Interface notes" (tls-enable entrypoint in T3; error idiom in T7) flag names the implementer must read from the real file — these are deliberate verify-then-use anchors with exact assertions, not missing content.

**Type consistency:** `config.State{Schema, AdminEmail, Complete}` and `InstallComplete()` used identically across T1-T7. The gate is `(*App).requireInstallComplete() error` everywhere; receiver is `a` in reconcile/tls (methods), `app` in start/update/restore (closures) — matches each call site's variable. Marker seeds use `config.WriteState`/`config.State` uniformly.
