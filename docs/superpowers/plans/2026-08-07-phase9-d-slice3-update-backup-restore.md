# Phase 9-D Slice 3 — `update` + `backup`/`restore` + `/version` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a safe deployment lifecycle — `mathion update` (auto-rollback), on-demand `mathion backup`/`restore`, and a `GET /version` surface — built on a refuse-on-crash breadcrumb model that never boots a half-migrated schema or a tag/DB-mismatched restore.

**Architecture:** A new managed state dir `/var/lib/mathion` holds backups, an advisory flock, per-invocation staging dirs, and a durable recovery breadcrumb. Lock-free `backup`/`restore` engine functions do the work; `update` composes them in-process while holding the lock. Every lock-taking command takes the flock, sweeps orphan workers by label, and runs a three-outcome breadcrumb entry-check before its own work. All Docker orchestration goes through the existing `compose.Runner`, extended with streaming + env-aware + sanitized-env variants. The backend gains one FastAPI route and one settings field.

**Tech Stack:** Go stdlib + cobra (CLI, module `github.com/svkucheryavski/mathion/cli`, go 1.24 for `os.Root`); FastAPI + pydantic-settings (backend, `backend/mathion/`); `docker compose` orchestrating `app` (FastAPI/SQLAlchemy/alembic, uid 10001) + `db` (postgres:17). Tests: Go `testing` with `compose.FakeRunner`; pytest via `backend/.venv`; a real-Docker `cli/integration_test.sh`.

## Global Constraints

*(Every task's requirements implicitly include this section. Values are copied verbatim from the spec; the spec `docs/superpowers/specs/2026-08-06-phase9-d-slice3-update-backup-restore-design.md` is authoritative for any ambiguity.)*

- **Deps:** Go stdlib + cobra only in the CLI — no new third-party deps (`syscall.Flock`, `archive/tar`, `compress/gzip`, `os.Root` are all stdlib). Backend change is one FastAPI route + one `Settings` field, no new deps. go 1.24 is the floor.
- **Root:** the mutating commands (`install`/`uninstall`/`backup`/`restore`/`update`/`start`/`stop`) require root; non-root → clear "requires root; re-run with sudo". **`version` is exempt** and must run read-only as non-root (its EACCES branch depends on this).
- **Secrets & DB error output:** never place a credential in host-side argv — reference the DB password **inside** the container (`sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" …'`). `pg_dump`/`pg_restore`/`psql` **stderr is never surfaced** to stdout/CLI/logs: run `psql` with `VERBOSITY=verbose`, write the **full** captured stderr only to a `0600` root-only file under `/var/lib/mathion`, and for display **regex-extract only the 5-char SQLSTATE** plus a generic message. The `pg_*` caller intercepts the `Stream`/`StreamIn` error, spools stderr to that file, and returns a **new scrubbed error** — a raw `Stream` error reaching `Execute`'s `error: <err>` printer (`root.go:77`) would leak PII.
- **Atomic + durable writes:** small files (`manifest.json`, `.env` re-pin, the breadcrumb) use `config.AtomicWrite`, which this slice **extends to fsync the parent directory after the rename**, plus a companion **`RemoveSync(path)`** (unlink + parent-dir fsync). The **archive is stream-assembled** (temp file in the target dir → gzip/tar → `Sync` → `Rename` → fsync `backups/`), never `AtomicWrite` (its `[]byte` signature would OOM on a multi-GB archive).
- **`.env` re-pin:** a line-oriented helper that replaces the `MATHION_VERSION=` value in place, **collapsing all occurrences to one line** (first match keeps the value, drops the rest), appends if absent, leaves every other line/order/comment verbatim, matches on the **parsed, `=`-split, trimmed key with EXACT equality** (not `strings.HasPrefix`), then `config.AtomicWrite` mode **0600**. `config.ValidateOCITag` the new tag **before** writing; **after** writing, re-parse and **assert `MATHION_VERSION` equals the intended target** and re-run `config.ValidateEnvComplete`. Never rebuild via `GenerateEnv`/`RenderEnv`.
- **Compose invocation:** reuse `App.composeArgs`/`App.compose` — every docker call carries `-p <app.Project> -f <cfgdir>/docker-compose.yml --env-file <cfgdir>/.env`. Project name + prompts use `app.Project` (never a hardcoded `mathion_prod`). Exception: `update`'s migrate (step 7) and `restore`'s asset one-off (step 8) need a per-subprocess `MATHION_VERSION` and use the env-aware `RunEnv`/`StreamInEnv` with the full `composeArgs` prefix.
- **Subprocess env sanitization:** every `docker`/`compose` subprocess runs with `cmd.Env = os.Environ()` **with `MATHION_VERSION`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` stripped**, so `--env-file` is the sole authority for those four keys. The only deliberate re-addition is `RunEnv`/`StreamInEnv` appending one `MATHION_VERSION=<validated target>` (last, so it wins) for the migrate/asset one-offs. All `Runner` methods set this sanitized `cmd.Env`.
- **Strengthened `ValidateEnvComplete` (precondition before any Docker mutation):** requires non-empty `POSTGRES_USER`/`POSTGRES_DB` (both `^[A-Za-z_][A-Za-z0-9_]*$`); validates the complete effective DB target of `MATHION_DATABASE_URL` — scheme `postgresql+psycopg`, host `db`, port `5432`, **decoded** username/password == `POSTGRES_USER`/`POSTGRES_PASSWORD`, the **raw escaped** path (`u.EscapedPath()`) == `"/" + POSTGRES_DB`, **no query/fragment, no `%`** anywhere in userinfo or path; and requires `MATHION_VERSION` to pass `ValidateOCITag` (so the CLI's parsed tag == Compose's effective tag).
- **Image reference:** a CLI constant `imageRepo = "ghcr.io/svkucheryavski/mathion"`; a test asserts it is the prefix of the image line in `compose.ComposeYAML`.
- **No implicit image pulls — `--pull never` on every ordinary compose `up`/`run`.** Pulls are allowed at **exactly three obtaining points**: a fresh `install`, `update` step 4 (`docker pull`), and `restore` step 6c (`docker pull`). `install`'s resume must **not** `compose pull` an already-initialized deployment; its data-volume check (`dockerx.VolumeExists`, fail-closed on error → present) gates **only the pull**, never the idempotent `alembic upgrade head`, which runs on every resume.
- **Concurrency (advisory lock):** every mutating command acquires an advisory `flock(LOCK_EX|LOCK_NB)` on `/var/lib/mathion/.lock` **at the top of its `RunE`** (not `PersistentPreRunE`), held for the whole run via `defer`. The `backup`/`restore` **engine functions are lock-free** (caller holds the lock) so `update` can call them in-process. `EnsureBackupsDir` runs **before** the lock in every lock-taking command. Held lock → *"another mathion operation is in progress"*, exit non-zero. `pin`/`superuser`/`version`/`status`/`logs` do not take the lock.
- **Breadcrumb (`backups/.update-journal.json`, 0600):** written before the destructive step, carrying a `kind` discriminator (`"update"`|`"restore"`); **no command auto-restores** — the next non-exempt command **refuses** (or, for `stop`, **contains**) and prints the exact `mathion restore -- <shell-quoted absolute backup_path>`. Missing/unknown `kind` **fails closed** (still refuses).

---

## File Structure

**Backend:**
- Modify `backend/mathion/config.py` — add `version: str = "unknown"` to `Settings`.
- Modify `backend/mathion/main.py` — add `GET /version` before the `/api` guard and SPA catch-all.
- Create/modify `backend/tests/test_version.py` — route test.

**CLI — foundation packages (pure/isolated, heavily unit-tested):**
- Modify `cli/internal/config/state.go` — `AtomicWrite` fsyncs the parent dir; add `RemoveSync`.
- Modify `cli/internal/config/env.go` — strengthen `ValidateEnvComplete`; add `RepinVersion`.
- Modify `cli/internal/compose/runner.go` — `Stream`/`StreamIn`/`RunEnv`/`StreamInEnv`, sanitized `cmd.Env`, `FakeRunner` extensions.
- Create `cli/internal/compose/image.go` — `ImageRepo` constant + drift test.
- Create `cli/internal/dockerx/sweep.go` — `SweepWorkers` (label-based orphan reaper).
- Create `cli/internal/varlib/varlib.go` — `EnsureBackupsDir`, `StagingDir`, `Lock`.
- Create `cli/internal/varlib/journal.go` — `Journal` breadcrumb (read/write/RemoveSync, `kind`, recovery-command formatting).
- Create `cli/internal/archive/{manifest.go,assemble.go,extract.go,latest.go}` — manifest, stream-assembly, allowlist extractor + inner pre-scan + cap trust-split, `--latest` selection.

**CLI — command layer:**
- Create `cli/cmd/guard.go` — `guardEntry` three-outcome breadcrumb routing + `requireRoot`.
- Create `cli/cmd/backup.go` — lock-free `backupEngine` + `mathion backup`.
- Create `cli/cmd/restore.go` — lock-free `restoreEngine` + `mathion restore`.
- Create `cli/cmd/update.go` — `mathion update` + failure matrix + `rollbackFailedError`.
- Modify `cli/cmd/version.go` — Finding #2 fix + live running version.
- Modify `cli/cmd/{start,stop,install,uninstall}.go` — lock + sweep + entry-check + `--pull never` + install-resume hardening.
- Modify `cli/cmd/root.go` — map `rollbackFailedError` → `os.Exit(3)`; register `backup`/`restore`/`update`.
- Create `cli/integration_test.sh` — real-Docker end-to-end.

---

## Task 1: Backend `GET /version` + `Settings.version`

**Files:**
- Modify: `backend/mathion/config.py` (add `version` field to `Settings`)
- Modify: `backend/mathion/main.py:~151` (route next to `/health`, before `/api/{rest:path}` and the SPA catch-all)
- Test: `backend/tests/test_version.py`

**Interfaces:**
- Produces: `GET /version` → `{"version": "<MATHION_VERSION>"}`; `settings.version` (reads `MATHION_VERSION` via the existing `env_prefix="MATHION_"`, default `"unknown"`).

- [ ] **Step 1: Write the failing test** (`backend/tests/test_version.py`) — mirror an existing `test_health`-style client test:

```python
from fastapi.testclient import TestClient
from mathion.main import app

def test_version_returns_settings_version(monkeypatch):
    from mathion import config
    monkeypatch.setattr(config.settings, "version", "v9.9.9")
    r = TestClient(app).get("/version")
    assert r.status_code == 200
    assert r.json() == {"version": "v9.9.9"}

def test_version_defaults_unknown_when_unset():
    # Settings default when MATHION_VERSION is not in the environment.
    from mathion.config import Settings
    assert Settings().version == "unknown"
```

- [ ] **Step 2: Run it, verify it fails** — `cd backend && .venv/bin/pytest tests/test_version.py -q` → FAIL (no `/version` route / no `version` field).

- [ ] **Step 3: Add the settings field** — in `backend/mathion/config.py`, on the `Settings` class:

```python
version: str = "unknown"          # reads MATHION_VERSION via env_prefix="MATHION_"
```

- [ ] **Step 4: Add the route** — in `backend/mathion/main.py`, next to `/health` (before the `/api/{rest:path}` guard and the SPA catch-all `/{full_path:path}`), using the `settings` object (no `import os`):

```python
@app.get("/version")
def version_endpoint() -> dict:
    return {"version": settings.version}
```

- [ ] **Step 5: Run tests, verify pass** — `cd backend && .venv/bin/pytest tests/test_version.py -q` → PASS. Then the full suite: `.venv/bin/pytest -q`.

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/config.py backend/mathion/main.py backend/tests/test_version.py
git commit -m "feat(backend): add GET /version surfacing MATHION_VERSION"
```

---

## Task 2: `config.AtomicWrite` parent-dir fsync + `RemoveSync`

**Files:**
- Modify: `cli/internal/config/state.go:12-39` (fsync parent after rename)
- Add: `RemoveSync` in the same file
- Test: `cli/internal/config/state_test.go`

**Interfaces:**
- Produces: `config.AtomicWrite(path string, data []byte, mode os.FileMode) error` (unchanged signature; now also fsyncs the containing dir after the rename); `config.RemoveSync(path string) error` (unlink + parent-dir fsync; `os.IsNotExist` on the unlink is not an error — idempotent).

- [ ] **Step 1: Write the failing test** — a `RemoveSync` test (durability fsyncs are hard to assert directly; assert observable behavior + idempotency):

```go
func TestRemoveSyncIdempotent(t *testing.T) {
    dir := t.TempDir()
    p := filepath.Join(dir, "j.json")
    if err := config.AtomicWrite(p, []byte("{}"), 0o600); err != nil {
        t.Fatal(err)
    }
    if err := config.RemoveSync(p); err != nil {
        t.Fatalf("first RemoveSync: %v", err)
    }
    if _, err := os.Stat(p); !os.IsNotExist(err) {
        t.Fatalf("file still present: %v", err)
    }
    if err := config.RemoveSync(p); err != nil {
        t.Fatalf("RemoveSync on absent file must be a no-op, got %v", err)
    }
}
```

- [ ] **Step 2: Run it, verify it fails** — `go -C cli test ./internal/config/ -run TestRemoveSync` → FAIL (`RemoveSync` undefined).

- [ ] **Step 3: Add the parent-dir fsync to `AtomicWrite`** — after the successful `os.Rename(tmp, path)`, open the parent `O_RDONLY`, `Sync`, close; return its error:

```go
    if err := os.Rename(tmp, path); err != nil {
        return err
    }
    return fsyncDir(dir)
}

// fsyncDir fsyncs a directory so a rename/unlink of an entry within it is
// durable across a power loss (a file-only fsync does not persist the dirent).
func fsyncDir(dir string) error {
    d, err := os.Open(dir)
    if err != nil {
        return err
    }
    if err := d.Sync(); err != nil {
        d.Close()
        return err
    }
    return d.Close()
}

// RemoveSync unlinks path and fsyncs its parent directory so the removal is
// durable. A missing file is not an error (idempotent — used to clear the
// recovery breadcrumb, which a re-run may find already gone).
func RemoveSync(path string) error {
    if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
        return err
    }
    return fsyncDir(filepath.Dir(path))
}
```

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/config/` → PASS (existing `AtomicWrite` callers still pass; the parent fsync is additive).

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config/state.go cli/internal/config/state_test.go
git commit -m "feat(cli): AtomicWrite fsyncs parent dir; add RemoveSync for durable unlink"
```

---

## Task 3: Runner streaming + env-aware + sanitized-env + `FakeRunner` extensions

**Files:**
- Modify: `cli/internal/compose/runner.go`
- Test: `cli/internal/compose/runner_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces (added to the `Runner` interface and both implementations):
  - `Stream(ctx, stdout io.Writer, args ...string) error` — child stdout → `stdout`; child **stderr captured into the returned error**; non-zero exit always non-nil error. The error exposes **both** exit code and raw stderr (via a typed error, see below).
  - `StreamIn(ctx, stdin io.Reader, args ...string) error` — feeds `stdin` to EOF; **prioritizes the command's non-zero exit + stderr over a stdin-copy `EPIPE`/`io.ErrClosedPipe`**.
  - `RunEnv(ctx, env []string, args ...string) error` — like `Run`, but `cmd.Env = append(sanitizedEnviron(), env...)`.
  - `StreamInEnv(ctx, env []string, stdin io.Reader, args ...string) error` — `StreamIn` + the `RunEnv` env override.
  - A typed `type ExitError struct { Code int; Stderr []byte }` (implements `error`) returned by `Stream`/`StreamIn` on non-zero exit, so callers can branch on exit code (tar exit 1 vs ≥2) and spool stderr.
  - `sanitizedEnviron() []string` — `os.Environ()` with `MATHION_VERSION`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` stripped. **All** `Runner` methods (`Run`/`Output`/`Stream`/`StreamIn`/`RunEnv`/`StreamInEnv`) set `cmd.Env` to this sanitized baseline (plus any appended override).
  - `FakeRunner` gains `Calls [][]string` (exists), `EnvCalls [][]string`, a **call-time context snapshot** (`CtxSnaps []struct{ Err error; Deadline time.Time; HasDeadline bool }` recorded when each method receives the call — never a raw `context.Context` read later), `StreamFunc func(w io.Writer, args []string) error`, `StreamInFunc func(r io.Reader, args []string) error`, and `RunFunc`/`OutputFunc` (exist).

- [ ] **Step 1: Write the failing tests** — sanitized env + env-append-wins + call-time snapshot + streaming:

```go
func TestSanitizedEnvironStripsFourKeys(t *testing.T) {
    t.Setenv("MATHION_VERSION", "vBOGUS")
    t.Setenv("POSTGRES_PASSWORD", "leak")
    t.Setenv("OTHER_KEY", "keep")
    env := compose.SanitizedEnvironForTest() // small exported test hook, or assert via RunEnv below
    joined := strings.Join(env, "\n")
    if strings.Contains(joined, "MATHION_VERSION=") || strings.Contains(joined, "POSTGRES_PASSWORD=") {
        t.Fatalf("stripped keys leaked into sanitized env")
    }
    if !strings.Contains(joined, "OTHER_KEY=keep") {
        t.Fatalf("non-target key was stripped")
    }
}

func TestFakeRunnerRecordsEnvAndCtxSnapshot(t *testing.T) {
    f := &compose.FakeRunner{}
    ctx, cancel := context.WithCancel(context.Background())
    cancel() // record a cancelled snapshot
    _ = f.RunEnv(ctx, []string{"MATHION_VERSION=v2"}, "compose", "up")
    if len(f.EnvCalls) != 1 || f.EnvCalls[0][0] != "MATHION_VERSION=v2" {
        t.Fatalf("EnvCalls not captured: %v", f.EnvCalls)
    }
    if len(f.CtxSnaps) != 1 || f.CtxSnaps[0].Err == nil {
        t.Fatalf("expected a cancelled ctx snapshot at call time")
    }
}
```

For the real `ExecRunner`, an integration-style test that runs `/bin/sh -c 'printf out; printf err 1>&2; exit 2'` via `Stream` (bin overridden to `/bin/sh`) asserting stdout captured, stderr in the returned `*ExitError` with `Code==2`.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/compose/ -run 'Sanitized|FakeRunner'` → FAIL.

- [ ] **Step 3: Implement** — extend the `Runner` interface with the four methods; add `sanitizedEnviron()` and set `cmd.Env` in every `ExecRunner` method; implement `Stream`/`StreamIn` with `cmd.StdoutPipe`/an `io.Writer`, a captured `bytes.Buffer` stderr, and the `*ExitError` typed return; `StreamIn`/`StreamInEnv` copy `stdin` in a goroutine and prefer the command error over an `EPIPE`. Extend `FakeRunner` with `EnvCalls`/`CtxSnaps`/`StreamFunc`/`StreamInFunc`, recording the ctx snapshot at the top of every method:

```go
func snapshot(ctx context.Context) ctxSnap {
    dl, ok := ctx.Deadline()
    return ctxSnap{Err: ctx.Err(), Deadline: dl, HasDeadline: ok}
}
```

Keep the existing `Run`/`Output` behavior; `RunEnv` with `env==nil` behaves like `Run` (sanitized baseline only).

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/compose/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/compose/runner.go cli/internal/compose/runner_test.go
git commit -m "feat(cli): Runner streaming/env-aware variants, sanitized env, FakeRunner ctx+env capture"
```

---

## Task 4: `compose.ImageRepo` constant + drift test

**Files:**
- Create: `cli/internal/compose/image.go`
- Test: `cli/internal/compose/image_test.go`

**Interfaces:**
- Produces: `const ImageRepo = "ghcr.io/svkucheryavski/mathion"`.

- [ ] **Step 1: Write the failing test** — assert `ImageRepo` is the exact prefix of the app image line in the embedded compose file, so the two cannot drift:

```go
func TestImageRepoIsComposePrefix(t *testing.T) {
    want := compose.ImageRepo + ":${MATHION_VERSION}"
    if !bytes.Contains(compose.ComposeYAML, []byte(want)) {
        t.Fatalf("compose image line does not contain %q", want)
    }
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/compose/ -run ImageRepo` → FAIL (undefined).

- [ ] **Step 3: Implement** — `cli/internal/compose/image.go`:

```go
package compose

// ImageRepo is the app image repository. The tag is MATHION_VERSION in .env.
// image_test.go asserts this is the prefix of the image line in ComposeYAML so
// the constant and the embedded compose file cannot silently drift.
const ImageRepo = "ghcr.io/svkucheryavski/mathion"
```

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/compose/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/compose/image.go cli/internal/compose/image_test.go
git commit -m "feat(cli): add ImageRepo constant with compose-drift guard"
```

---

## Task 5: Strengthen `config.ValidateEnvComplete`

**Files:**
- Modify: `cli/internal/config/env.go:75-104`
- Test: `cli/internal/config/env_test.go`

**Interfaces:**
- Consumes: `config.ValidateOCITag` (`validate.go:82`).
- Produces: `ValidateEnvComplete(m map[string]string) error` (same signature; now enforces the strengthened checks in Global Constraints).

- [ ] **Step 1: Write the failing tests** — the `GenerateEnv` URL passes; each hostile case is rejected:

```go
func TestValidateEnvCompleteStrengthened(t *testing.T) {
    good := config.ParseEnv(config.RenderEnv(config.GenerateEnv("https://x", "v0.1.1", "sk", "pw")))
    if err := config.ValidateEnvComplete(good); err != nil {
        t.Fatalf("GenerateEnv output must pass: %v", err)
    }
    base := func() map[string]string { m := map[string]string{}; for k, v := range good { m[k] = v }; return m }
    reject := map[string]string{
        "divergent host":  "postgresql+psycopg://mathion:pw@remote:5432/mathion",
        "wrong port":      "postgresql+psycopg://mathion:pw@db:5433/mathion",
        "query dbname":    "postgresql+psycopg://mathion:pw@db:5432/mathion?dbname=other",
        "query host":      "postgresql+psycopg://mathion:pw@db:5432/mathion?host=evil",
        "raw pct db":      "postgresql+psycopg://mathion:pw@db:5432/m%61thion",
        "raw pct db2":     "postgresql+psycopg://mathion:pw@db:5432/%6Dathion",
        "trailing pct":    "postgresql+psycopg://mathion:pw@db:5432/mathion%2F",
        "pct userinfo":    "postgresql+psycopg://m%61thion:pw@db:5432/mathion",
        "wrong scheme":    "postgresql://mathion:pw@db:5432/mathion",
    }
    for name, url := range reject {
        m := base(); m["MATHION_DATABASE_URL"] = url
        if err := config.ValidateEnvComplete(m); err == nil {
            t.Errorf("%s: expected rejection, got nil", name)
        }
    }
    // round-10 #2: MATHION_VERSION must pass ValidateOCITag.
    for _, bad := range []string{`"v0.1.1"`, "${X:-v0.1.1}", "v 0.1.1"} {
        m := base(); m["MATHION_VERSION"] = bad
        if err := config.ValidateEnvComplete(m); err == nil {
            t.Errorf("MATHION_VERSION=%q must be rejected", bad)
        }
    }
    // missing POSTGRES_USER / POSTGRES_DB, and non-identifier values.
    for _, k := range []string{"POSTGRES_USER", "POSTGRES_DB"} {
        m := base(); delete(m, k)
        if err := config.ValidateEnvComplete(m); err == nil {
            t.Errorf("missing %s must be rejected", k)
        }
        m2 := base(); m2[k] = "bad-name!"
        if err := config.ValidateEnvComplete(m2); err == nil {
            t.Errorf("non-identifier %s must be rejected", k)
        }
    }
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/config/ -run ValidateEnvComplete` → FAIL.

- [ ] **Step 3: Implement** — extend `ValidateEnvComplete`: require non-empty `POSTGRES_USER`/`POSTGRES_DB` matching `^[A-Za-z_][A-Za-z0-9_]*$`; `ValidateOCITag(m["MATHION_VERSION"])`; parse `MATHION_DATABASE_URL` and assert `u.Scheme=="postgresql+psycopg"`, `u.Hostname()=="db"`, `u.Port()=="5432"`, decoded `u.User.Username()==POSTGRES_USER` + password==`POSTGRES_PASSWORD`, `u.EscapedPath()=="/"+POSTGRES_DB`, `u.RawQuery=="" && u.Fragment==""`, and no `%` in `u.EscapedPath()` or in the raw userinfo (`u.User.String()`). Keep the static "not a valid URL" message on parse error (never echo the raw URL — it carries the password).

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/config/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config/env.go cli/internal/config/env_test.go
git commit -m "feat(cli): pin effective DB target + OCI tag in ValidateEnvComplete"
```

---

## Task 6: `.env` line-oriented re-pin helper

**Files:**
- Add: `RepinVersion` in `cli/internal/config/env.go` (or a new `env_repin.go`)
- Test: `cli/internal/config/env_test.go`

**Interfaces:**
- Consumes: `ValidateOCITag`, `AtomicWrite`, `ParseEnv`, `ValidateEnvComplete`.
- Produces: `RepinVersion(cfgdir, newTag string) error` — reads `<cfgdir>/.env`, `ValidateOCITag(newTag)` first, rewrites `MATHION_VERSION` collapsing duplicates to one line (first match wins, drop the rest), append if absent, every other line verbatim, `AtomicWrite` mode 0600, then re-parse and assert `MATHION_VERSION==newTag` and `ValidateEnvComplete`.

- [ ] **Step 1: Write the failing tests**:

```go
func TestRepinVersion(t *testing.T) {
    dir := t.TempDir()
    raw := "# comment\nMATHION_SECRET_KEY=sk\nPOSTGRES_USER=mathion\nPOSTGRES_DB=mathion\n" +
        "POSTGRES_PASSWORD=pw\nMATHION_DATABASE_URL=postgresql+psycopg://mathion:pw@db:5432/mathion\n" +
        "MATHION_BASE_URL=https://x\nMATHION_VERSION_EXTRA=keepme\nMATHION_VERSION=v0.1.0\n" +
        "MATHION_VERSION=v0.1.0\nSMTP_HOST=mail\n"
    os.WriteFile(dir+"/.env", []byte(raw), 0o600)
    if err := config.RepinVersion(dir, "v0.2.0"); err != nil {
        t.Fatal(err)
    }
    out, _ := os.ReadFile(dir + "/.env")
    s := string(out)
    if strings.Count(s, "\nMATHION_VERSION=") != 1 { // duplicates collapsed to one
        t.Fatalf("expected one MATHION_VERSION line:\n%s", s)
    }
    if !strings.Contains(s, "MATHION_VERSION=v0.2.0") {
        t.Fatalf("new tag missing:\n%s", s)
    }
    for _, keep := range []string{"# comment", "MATHION_VERSION_EXTRA=keepme", "SMTP_HOST=mail"} {
        if !strings.Contains(s, keep) {
            t.Fatalf("clobbered %q:\n%s", keep, s)
        }
    }
    fi, _ := os.Stat(dir + "/.env")
    if fi.Mode().Perm() != 0o600 {
        t.Fatalf("mode = %v", fi.Mode())
    }
    if err := config.RepinVersion(dir, `"bad"`); err == nil {
        t.Fatalf("ValidateOCITag must reject a hostile tag before writing")
    }
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/config/ -run RepinVersion` → FAIL.

- [ ] **Step 3: Implement** `RepinVersion` — split on `\n`; for each line, compute the parsed key the way `ParseEnv` does (`TrimSpace`, skip `#`, `Cut` on `=`, `TrimSpace` key) and compare **exactly** to `MATHION_VERSION`; on the first match emit `MATHION_VERSION=<newTag>` and set a "seen" flag, drop later matches; if never seen, append; join; `AtomicWrite(0600)`; re-read via `ReadEnvFile`+assert target + `ValidateEnvComplete`.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/config/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config/env.go cli/internal/config/env_test.go
git commit -m "feat(cli): line-oriented .env MATHION_VERSION re-pin (collapse dups, assert-after-write)"
```

---

## Task 7: `varlib` managed state dir — `EnsureBackupsDir`, `StagingDir`

**Files:**
- Create: `cli/internal/varlib/varlib.go`
- Test: `cli/internal/varlib/varlib_test.go`

**Interfaces:**
- Consumes: `config` fsync helpers.
- Produces:
  - `const Root = "/var/lib/mathion"`, `BackupsDir = Root + "/backups"`, `LockPath = Root + "/.lock"` (all overridable in tests via a `RootOverride` env var `MATHION_VARLIB_DIR`, mirroring `MATHION_CONFIG_DIR`).
  - `EnsureBackupsDir() error` — `MkdirAll` root-owned dir mode 0700; **fsync each newly-created dir's parent** (`/var/lib` after creating `/var/lib/mathion`, `/var/lib/mathion` after `backups/`), skipped once the tree exists; `Lstat`-reject a symlink or group/world-writable dir on both levels.
  - `StagingDir() (string, error)` — `os.MkdirTemp(Root, "staging-<pid>-*")` (unique per call), mode 0700.
  - `SweepStaleStaging() error` — remove leftover `staging-*/` dirs (called strictly after the lock).

- [ ] **Step 1: Write the failing tests**:

```go
func TestEnsureBackupsDir(t *testing.T) {
    root := t.TempDir()
    t.Setenv("MATHION_VARLIB_DIR", root+"/var/lib/mathion")
    if err := varlib.EnsureBackupsDir(); err != nil {
        t.Fatal(err)
    }
    fi, _ := os.Stat(varlib.BackupsDir())
    if !fi.IsDir() || fi.Mode().Perm() != 0o700 {
        t.Fatalf("backups dir mode = %v", fi.Mode())
    }
    if err := varlib.EnsureBackupsDir(); err != nil { // idempotent
        t.Fatalf("second call: %v", err)
    }
    // reject a symlinked managed dir
    os.RemoveAll(varlib.Root())
    os.MkdirAll(root+"/decoy", 0o700)
    os.Symlink(root+"/decoy", varlib.Root())
    if err := varlib.EnsureBackupsDir(); err == nil {
        t.Fatalf("symlinked managed dir must be rejected")
    }
}

func TestStagingDirUnique(t *testing.T) {
    root := t.TempDir()
    t.Setenv("MATHION_VARLIB_DIR", root)
    varlib.EnsureBackupsDir()
    a, _ := varlib.StagingDir()
    b, _ := varlib.StagingDir()
    if a == b {
        t.Fatalf("staging dirs must be unique: %s", a)
    }
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/varlib/` → FAIL.

- [ ] **Step 3: Implement** `varlib.go` — `Root()`/`BackupsDir()`/`LockPath()` reading `MATHION_VARLIB_DIR` (default `/var/lib/mathion`); `EnsureBackupsDir` creating each level, `Lstat`-guarding symlink + `mode&0o077 != 0` on both levels, fsyncing the parent of each **newly-created** level (track which levels `MkdirAll` created by `Stat`-before); `StagingDir`/`SweepStaleStaging` as above.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/varlib/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/varlib/varlib.go cli/internal/varlib/varlib_test.go
git commit -m "feat(cli): varlib managed state dir (EnsureBackupsDir, staging, symlink/perm guards)"
```

---

## Task 8: Advisory flock + label-based orphan-worker sweep

**Files:**
- Add: `Lock` in `cli/internal/varlib/varlib.go`
- Create: `cli/internal/dockerx/sweep.go`
- Test: `cli/internal/varlib/varlib_test.go`, `cli/internal/dockerx/sweep_test.go`

**Interfaces:**
- Produces:
  - `varlib.Lock() (release func() error, err error)` — `open(LockPath, O_CREATE|O_RDWR, 0600)` then `syscall.Flock(fd, LOCK_EX|LOCK_NB)`; on `EWOULDBLOCK` return a sentinel `ErrLocked`; `release` flocks `LOCK_UN` and closes.
  - `dockerx.SweepWorkers(ctx, r compose.Runner, project string) error` — `docker ps -aq --filter label=io.mathion.worker=1 --filter label=com.docker.compose.project=<project>` → `docker rm -f <ids...>`. Label-scoped (never a `name=` substring). No error if none match.

- [ ] **Step 1: Write the failing tests**:

```go
func TestLockExclusive(t *testing.T) {
    root := t.TempDir(); t.Setenv("MATHION_VARLIB_DIR", root); varlib.EnsureBackupsDir()
    rel, err := varlib.Lock()
    if err != nil { t.Fatal(err) }
    if _, err := varlib.Lock(); !errors.Is(err, varlib.ErrLocked) {
        t.Fatalf("second Lock should be ErrLocked, got %v", err)
    }
    if err := rel(); err != nil { t.Fatal(err) }
    rel2, err := varlib.Lock() // released -> reacquirable
    if err != nil { t.Fatalf("reacquire after release: %v", err) }
    rel2()
}

func TestSweepWorkersByLabel(t *testing.T) {
    f := &compose.FakeRunner{OutputFunc: func(a []string) (string, error) {
        if a[0] == "ps" { return "abc123\n", nil }
        return "", nil
    }}
    if err := dockerx.SweepWorkers(context.Background(), f, "mathion_prod"); err != nil {
        t.Fatal(err)
    }
    // assert a ps with BOTH label filters, then rm -f abc123
    assertCall(t, f.Calls, []string{"ps", "-aq", "--filter", "label=io.mathion.worker=1", "--filter", "label=com.docker.compose.project=mathion_prod"})
    assertCall(t, f.Calls, []string{"rm", "-f", "abc123"})
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/varlib/ ./internal/dockerx/ -run 'Lock|Sweep'` → FAIL.

- [ ] **Step 3: Implement** `varlib.Lock` (syscall.Flock) and `dockerx.SweepWorkers` (parse `Output` ps ids, split on whitespace, `rm -f` if any). Note `varlib.Lock` needs a real fd — tests use a temp `MATHION_VARLIB_DIR`; the second `Lock` in-process opens a **second fd**, and flock is per-open-file-description, so `LOCK_EX|LOCK_NB` returns `EWOULDBLOCK` — the exact self-deny the design relies on the single held lock to avoid.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/varlib/ ./internal/dockerx/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/varlib/varlib.go cli/internal/varlib/varlib_test.go cli/internal/dockerx/sweep.go cli/internal/dockerx/sweep_test.go
git commit -m "feat(cli): advisory flock + label-scoped orphan-worker sweep"
```

---

## Task 9: Recovery breadcrumb (`varlib.Journal`)

**Files:**
- Create: `cli/internal/varlib/journal.go`
- Test: `cli/internal/varlib/journal_test.go`

**Interfaces:**
- Consumes: `config.AtomicWrite`, `config.RemoveSync`.
- Produces:
  - `type Journal struct { Schema int; CreatedAt string; Kind string; OldTag, TargetTag, TargetImageID, BackupPath string }` (`json` tags; `omitempty` on `OldTag`/`TargetImageID`).
  - `JournalPath() string` = `BackupsDir() + "/.update-journal.json"`.
  - `WriteJournal(j Journal) error` — `AtomicWrite(JournalPath(), json, 0600)` (dir-fsync durable via Task 2).
  - `ReadJournal() (*Journal, bool, error)` — `(nil,false,nil)` if absent; decode; a decode failure or **missing/unknown `kind`** returns a `*Journal` with a `DecodeErr` marker so the entry-check still **fails closed** (refuses) rather than fail-open.
  - `RemoveJournal() error` = `config.RemoveSync(JournalPath())`.
  - `RecoveryCommand(backupPath string) string` — `"mathion restore -- " + shellQuote(backupPath)` (single-quote-escaped so spaces / leading `-` are one argument).

- [ ] **Step 1: Write the failing tests**:

```go
func TestJournalRoundTrip(t *testing.T) {
    root := t.TempDir(); t.Setenv("MATHION_VARLIB_DIR", root); varlib.EnsureBackupsDir()
    j := varlib.Journal{Schema: 1, CreatedAt: "2026-08-06T00:00:00Z", Kind: "update",
        OldTag: "v0.1.0", TargetTag: "v0.2.0", TargetImageID: "sha256:aa", BackupPath: "/var/lib/mathion/backups/b.tar.gz"}
    if err := varlib.WriteJournal(j); err != nil { t.Fatal(err) }
    got, present, err := varlib.ReadJournal()
    if err != nil || !present || got.Kind != "update" || got.OldTag != "v0.1.0" {
        t.Fatalf("roundtrip: %+v present=%v err=%v", got, present, err)
    }
    if err := varlib.RemoveJournal(); err != nil { t.Fatal(err) }
    _, present, _ = varlib.ReadJournal()
    if present { t.Fatalf("journal should be absent after RemoveJournal") }
}

func TestJournalUnknownKindFailsClosed(t *testing.T) {
    root := t.TempDir(); t.Setenv("MATHION_VARLIB_DIR", root); varlib.EnsureBackupsDir()
    os.WriteFile(varlib.JournalPath(), []byte(`{"schema":1,"kind":"bogus","backup_path":"/b"}`), 0o600)
    got, present, _ := varlib.ReadJournal()
    if !present || got.Fatal() == false { // Fatal() true => entry-check must refuse
        t.Fatalf("unknown kind must fail closed: %+v", got)
    }
}

func TestRecoveryCommandShellQuotes(t *testing.T) {
    got := varlib.RecoveryCommand("/var/lib/mathion/backups/my backup.tar.gz")
    if got != `mathion restore -- '/var/lib/mathion/backups/my backup.tar.gz'` {
        t.Fatalf("got %q", got)
    }
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/varlib/ -run Journal` → FAIL.

- [ ] **Step 3: Implement** the `Journal` type, `WriteJournal`/`ReadJournal`/`RemoveJournal`/`JournalPath`, a `Fatal()` predicate (true when the file was present but did not decode into a known `kind` of `"update"`/`"restore"` with a `BackupPath`), and `RecoveryCommand`'s POSIX single-quote escaping (`' → '\''`).

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/varlib/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/varlib/journal.go cli/internal/varlib/journal_test.go
git commit -m "feat(cli): durable recovery breadcrumb (kind discriminator, fail-closed decode, shell-quoted recovery cmd)"
```

---

## Task 10: `guardEntry` three-outcome entry-check + `requireRoot`

**Files:**
- Create: `cli/cmd/guard.go`
- Test: `cli/cmd/guard_test.go`

**Interfaces:**
- Consumes: `varlib.ReadJournal`/`RemoveJournal`/`RecoveryCommand`, `App`.
- Produces:
  - `requireRoot() error` — `os.Geteuid() != 0` → error "requires root; re-run with sudo" (test hook to override euid, or gate behind a `MATHION_SKIP_ROOT_CHECK` in tests).
  - `type entryOutcome int` (`outcomeProceed`, `outcomeRefuse`) and `guardEntry(a *App, cmd string) (proceed bool, err error)`:
    - **Exempt/proceed:** `restore`, `uninstall` (breadcrumb retained; caller handles late clear).
    - **Containment/proceed:** `stop` (retains the breadcrumb; caller stops the stack + prints hint).
    - **Refuse:** `update`, `start`, `install`, `backup` → print the `kind`-worded message with `RecoveryCommand(j.BackupPath)` and the identity-verified manual-clear escape, return a non-nil error.
    - Fail-closed: a `Journal.Fatal()` breadcrumb refuses for the refuse set (printing `BackupPath` when it decodes safely).
  - The refuse/containment message text is exactly the two `kind`-worded blocks from the spec (`kind:"update"` and `kind:"restore"`).

- [ ] **Step 1: Write the failing tests** — table over commands × (no breadcrumb, update-kind, restore-kind, fatal):

```go
func TestGuardEntryRouting(t *testing.T) {
    root := t.TempDir(); t.Setenv("MATHION_VARLIB_DIR", root); varlib.EnsureBackupsDir()
    varlib.WriteJournal(varlib.Journal{Schema: 1, Kind: "update", OldTag: "v0.1.0",
        TargetTag: "v0.2.0", TargetImageID: "sha256:aa", BackupPath: "/b/x.tar.gz"})
    cases := map[string]bool{ // command -> expected proceed
        "restore": true, "uninstall": true, "stop": true,
        "update": false, "start": false, "install": false, "backup": false,
    }
    for cmd, wantProceed := range cases {
        var out bytes.Buffer
        app := &App{Out: &out, Err: &out}
        proceed, err := guardEntry(app, cmd)
        if proceed != wantProceed {
            t.Errorf("%s: proceed=%v want %v", cmd, proceed, wantProceed)
        }
        if !wantProceed {
            if err == nil { t.Errorf("%s: expected refuse error", cmd) }
            if !strings.Contains(out.String(), "mathion restore -- '/b/x.tar.gz'") {
                t.Errorf("%s: refuse must print recovery cmd, got %q", cmd, out.String())
            }
            if !strings.Contains(out.String(), "image ID equals the recorded target") {
                t.Errorf("%s: refuse must print identity-verified escape", cmd)
            }
        }
    }
}

func TestGuardEntryNoBreadcrumbProceeds(t *testing.T) {
    root := t.TempDir(); t.Setenv("MATHION_VARLIB_DIR", root); varlib.EnsureBackupsDir()
    for _, cmd := range []string{"update", "start", "install", "backup", "restore", "stop", "uninstall"} {
        app := &App{Out: io.Discard, Err: io.Discard}
        if proceed, err := guardEntry(app, cmd); !proceed || err != nil {
            t.Errorf("%s with no breadcrumb: proceed=%v err=%v", cmd, proceed, err)
        }
    }
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run GuardEntry` → FAIL.

- [ ] **Step 3: Implement** `guardEntry` + `requireRoot` + the two message templates. `guardEntry` does NOT clear the breadcrumb (exempt commands proceed with it retained; `restore`/`uninstall --purge` clear it later in their own flow). For the refuse set, a `Fatal()` breadcrumb still refuses.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/guard.go cli/cmd/guard_test.go
git commit -m "feat(cli): three-outcome breadcrumb entry-check + requireRoot"
```

---

## Task 11: `--latest` backup selection

**Files:**
- Create: `cli/internal/archive/latest.go`
- Test: `cli/internal/archive/latest_test.go`

**Interfaces:**
- Produces: `SelectLatest(dir string) (string, error)` — among **regular files** matching `mathion-backup-*.tar.gz` in `dir`, parse the fixed **16-char `YYYYMMDDTHHMMSSZ`** token immediately after `mathion-backup-`; newest wins; break a same-second tie by **file mtime** (newest); equal timestamp+mtime → stable filename order; zero matches → clear error. **Never** parses a collision counter out of the (`-`/`.`-bearing) version.

- [ ] **Step 1: Write the failing test** — the Round-2 inversion regression (a same-second `-2` cluster must pick newest by mtime, not lexicographically-first):

```go
func TestSelectLatest(t *testing.T) {
    dir := t.TempDir()
    write := func(name string, mtime time.Time) {
        p := filepath.Join(dir, name)
        os.WriteFile(p, []byte("x"), 0o600)
        os.Chtimes(p, mtime, mtime)
    }
    base := time.Date(2026, 8, 6, 14, 15, 30, 0, time.UTC)
    write("mathion-backup-20260806T141500Z-v0.1.1.tar.gz", base.Add(-time.Minute))
    // same-second cluster: the -2 collision suffix sorts lexicographically FIRST
    // but is the NEWER file — mtime tie-break must pick it.
    write("mathion-backup-20260806T141530Z-v0.1.1.tar.gz", base)
    write("mathion-backup-20260806T141530Z-v0.1.1-2.tar.gz", base.Add(time.Second))
    write("notes.txt", base) // ignored (no prefix)
    got, err := archive.SelectLatest(dir)
    if err != nil { t.Fatal(err) }
    if filepath.Base(got) != "mathion-backup-20260806T141530Z-v0.1.1-2.tar.gz" {
        t.Fatalf("got %s", filepath.Base(got))
    }
    if _, err := archive.SelectLatest(t.TempDir()); err == nil {
        t.Fatalf("empty dir must error")
    }
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/archive/ -run SelectLatest` → FAIL.

- [ ] **Step 3: Implement** `SelectLatest` — glob/readdir regular files, regex `^mathion-backup-(\d{8}T\d{6}Z)-.*\.tar\.gz$`, parse the token to `time.Time` (UTC layout `20060102T150405Z`), sort by (timestamp, mtime, name) descending, return the first; error on zero matches.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/archive/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/archive/latest.go cli/internal/archive/latest_test.go
git commit -m "feat(cli): --latest backup selection (timestamp token + mtime tie-break)"
```

---

## Task 12: Backup engine (manifest, stream-assembly, `backupEngine`)

**Files:**
- Create: `cli/internal/archive/manifest.go` (manifest type + per-member sha256)
- Create: `cli/internal/archive/assemble.go` (streaming `.tar.gz` writer)
- Create: `cli/cmd/backup.go` (lock-free `backupEngine`)
- Test: `cli/internal/archive/manifest_test.go`, `cli/internal/archive/assemble_test.go`, `cli/cmd/backup_test.go`

**Interfaces:**
- Consumes: `Runner.Stream`/`Output`, `varlib.StagingDir`/`BackupsDir`, `compose.ImageRepo`.
- Produces:
  - `archive.Manifest struct { Schema int; CreatedAt, MathionVersion, ImageID, AlembicRevision, CLIVersion, DBName string; SHA256 map[string]string }`.
  - `archive.Assemble(dstDir string, members map[string]string /* name→staging path */, manifest Manifest) (finalPath string, err error)` — writes a temp `mathion-backup-<ts>-<ver>.tar.gz` in `dstDir` (gzip→tar of the three members + manifest bytes), `Sync`, `Rename` (collision → `-2`,`-3`…), fsync `dstDir`.
  - `backupEngine(ctx context.Context, a *App, out string) (string, error)` — lock-free; the numbered backup steps. Returns the managed archive path.

- [ ] **Step 1: Write the failing tests**:
  - `manifest_test.go`: `SHA256Of(reader)` matches `crypto/sha256`; JSON marshals with the exact field names from the spec.
  - `assemble_test.go`: given three staging files, `Assemble` produces a gzip-tar whose members are exactly `manifest.json`/`db.dump`/`assets.tar`, re-openable, and a second call in the same second yields a `-2` suffix (no overwrite).
  - `backup_test.go` (with `FakeRunner`): correct argv for the dump / assets one-off / `alembic current` / `docker inspect .Image`; `image_id` recorded from `.Image`; fallbacks (no container → `image inspect <ImageRepo:tag> .Id`; neither → empty); `--out` writes `O_EXCL|O_NOFOLLOW` 0600 and a symlinked/existing `--out` is refused; a failed `--out` still reports the managed path and returns non-nil; `db`-down precondition error; tar exit-1 tolerated (via `*ExitError{Code:1}` → warning), exit-2 fails. Assert `--pull never` on the assets + alembic one-offs.

```go
func TestBackupEngineArgvAndManifest(t *testing.T) {
    // FakeRunner.StreamFunc emits deterministic db.dump/assets.tar bytes;
    // OutputFunc returns "67e8294b4267 (head)" for `alembic current` and a
    // sha256 image id for `docker inspect --format {{.Image}}`.
    // Assert Calls contain, in order:
    //   compose exec -T db sh -c '...pg_dump...'
    //   compose run --rm --no-deps --pull never -T app sh -c 'tar -C /data/mathion/assets -cf - .'
    //   compose run --rm --no-deps --pull never -T app alembic current
    //   docker inspect <app container> --format {{.Image}}
    // Assert manifest.SHA256 has both member hashes and ImageID is set.
}
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/archive/ ./cmd/ -run 'Manifest|Assemble|Backup'` → FAIL.

- [ ] **Step 3: Implement** the three files. `backupEngine` argv (verbatim from spec):
  - dump: `a.Runner.Stream(ctx, dbDumpFile, a.composeArgs("exec","-T","db","sh","-c",`PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"`)...)`
  - assets: `a.Runner.Stream(ctx, assetsFile, a.composeArgs("run","--rm","--no-deps","--pull","never","-T","app","sh","-c",`tar -C /data/mathion/assets -cf - .`)...)` (tar `*ExitError{Code:1}` → warn; `Code>=2` → fail).
  - alembic: `a.Runner.Output(ctx, a.composeArgs("run","--rm","--no-deps","--pull","never","-T","app","alembic","current")...)`, parse defensively.
  - image_id: `docker inspect <app container> --format {{.Image}}`; fallbacks per spec.
  - manifest → `Assemble` → `--out` copy (`O_CREATE|O_EXCL|O_WRONLY|O_NOFOLLOW`, 0600).

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/archive/ ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/archive/manifest.go cli/internal/archive/assemble.go cli/internal/archive/manifest_test.go cli/internal/archive/assemble_test.go cli/cmd/backup.go cli/cmd/backup_test.go
git commit -m "feat(cli): backup engine (pg_dump/assets/manifest, streaming .tar.gz assembly, --out copy)"
```

---

## Task 13: `mathion backup` command

**Files:**
- Modify: `cli/cmd/backup.go` (add `newBackupCmd`)
- Modify: `cli/cmd/root.go` (register `newBackupCmd`)
- Test: `cli/cmd/backup_test.go`

**Interfaces:**
- Consumes: `requireRoot`, `varlib.EnsureBackupsDir`/`Lock`/`SweepStaleStaging`, `dockerx.SweepWorkers`, `guardEntry`, `backupEngine`.
- Produces: `newBackupCmd(app *App) *cobra.Command` (`--out` flag). RunE order: `requireRoot` → `EnsureBackupsDir` → `Lock` (defer release) → `SweepStaleStaging` + `dockerx.SweepWorkers` → `guardEntry(app,"backup")` (refuse if breadcrumb) → `backupEngine`.

- [ ] **Step 1: Write the failing test** — lock-held returns the in-progress error; a present breadcrumb makes `backup` **refuse** (no dump call); the happy path calls `backupEngine` once; `--out` is threaded.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run BackupCmd` → FAIL.

- [ ] **Step 3: Implement** `newBackupCmd` with the RunE order above; register it in `root.go`'s `AddCommand`.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/backup.go cli/cmd/backup_test.go cli/cmd/root.go
git commit -m "feat(cli): mathion backup command (lock + sweep + entry-check + engine)"
```

---

## Task 14: Restore extractor + inner pre-scan + cap trust-split

**Files:**
- Create: `cli/internal/archive/extract.go`
- Test: `cli/internal/archive/extract_test.go`

**Interfaces:**
- Consumes: `os.Root` (Go 1.24), `archive/tar`, `compress/gzip`.
- Produces:
  - `type Caps struct { MaxMember, MaxTotal int64 }`; `ManagedCaps(env func(string) string) (Caps, error)` (defaults 50 GiB / 120 GiB; `MATHION_RESTORE_MAX_MEMBER_BYTES`/`_TOTAL_BYTES` with `G`/`M` suffix, validated `[1 GiB, 1 TiB]`, out-of-range/unparseable = hard error) and `UntrustedCaps() Caps` (fixed 2 GiB / 5 GiB).
  - `TierFor(archivePath, backupsDir string) Caps` — path **under** `backupsDir` → managed; else untrusted.
  - `Extract(stagingDir, archivePath string, caps Caps) (Manifest, error)` — allowlist extractor: wrap gzip in `io.LimitReader(gzr, caps.MaxTotal+1)`; abort on the **first** entry not one of `manifest.json`/`db.dump`/`assets.tar` by exact basename, or with a path separator/`..`/absolute path/duplicate name/`Size` over `caps.MaxMember`/non-regular type (accept only `tar.TypeReg`/`TypeRegA`); iteration cap `N≥3`; write via an `os.Root` bound to `stagingDir`; then `manifest.schema==1`, `ValidateOCITag(manifest.MathionVersion)`, per-member sha256 keyed on the fixed names (a missing hash → hard fail). All failures **before any mutation**.
  - `PrescanAssets(assetsTarPath string) error` — walk `assets.tar` members in Go; reject any non-regular type other than a plain **directory**, any `..`, any absolute path.

- [ ] **Step 1: Write the failing tests** — build small in-memory `.tar.gz` archives for each rejection and the happy path:

```go
func TestExtractRejectsHostileMembers(t *testing.T) {
    caps := archive.Caps{MaxMember: 1 << 20, MaxTotal: 4 << 20}
    for _, tc := range []struct{ name string; build func() []byte }{
        {"traversal", archiveWith("../evil", tar.TypeReg)},
        {"absolute", archiveWith("/etc/passwd", tar.TypeReg)},
        {"symlink", archiveWith("db.dump", tar.TypeSymlink)},
        {"hardlink", archiveWith("db.dump", tar.TypeLink)},
        {"dir-named-member", archiveWith("db.dump", tar.TypeDir)},
        {"extra-member", archiveWithExtra("surprise.sh")},
        {"duplicate", archiveDuplicate("db.dump")},
    } {
        dir := t.TempDir()
        os.WriteFile(dir+"/a.tar.gz", tc.build(), 0o600)
        if _, err := archive.Extract(t.TempDir(), dir+"/a.tar.gz", caps); err == nil {
            t.Errorf("%s: expected rejection", tc.name)
        }
    }
}

func TestExtractGzipBombHardAborts(t *testing.T) { /* over-cap member Size + LimitReader hard-abort */ }
func TestExtractMissingShaHardFails(t *testing.T) { /* manifest missing a member hash */ }
func TestPrescanAssetsRejectsSymlink(t *testing.T) { /* inner assets.tar with a symlink member */ }
func TestCapTierSplit(t *testing.T) {
    if archive.TierFor("/var/lib/mathion/backups/x.tar.gz", "/var/lib/mathion/backups").MaxTotal != archive.ManagedDefaultTotal { t.Fatal("under backups should be managed") }
    if archive.TierFor("/tmp/x.tar.gz", "/var/lib/mathion/backups") != archive.UntrustedCaps() { t.Fatal("outside should be untrusted") }
}
func TestManagedCapsOverride(t *testing.T) { /* G/M suffix parse; [1GiB,1TiB]; out-of-range hard error */ }
```

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./internal/archive/ -run 'Extract|Prescan|Cap|ManagedCaps'` → FAIL.

- [ ] **Step 3: Implement** `extract.go` per spec. A code comment on `Extract` forbids ever loosening the allowlist to a blocklist.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./internal/archive/`.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/archive/extract.go cli/internal/archive/extract_test.go
git commit -m "feat(cli): DoS-safe restore extractor (allowlist, gzip-bomb cap, inner pre-scan, tier split)"
```

---

## Task 15: Restore image preflight (step 4a, read-only)

**Files:**
- Create: `cli/cmd/restore.go` (start the file with the 4a helper)
- Test: `cli/cmd/restore_test.go`

**Interfaces:**
- Consumes: `Runner.Output`, `compose.ImageRepo`.
- Produces: `type imageResolve struct { RID string; PullFlagged bool }`; `preflightImage(ctx, a *App, m archive.Manifest) (imageResolve, error)` — **read-only** (no `docker pull`, no `docker tag`): consult `manifest.image_id` first (`docker image inspect <id>` succeeds → `RID=image_id`), else `docker image inspect <ImageRepo:version> --format {{.Id}}` (→ `RID=` local tag id; warn if `manifest.image_id` non-empty and differs), else `PullFlagged=true` (RID unresolved).

- [ ] **Step 1: Write the failing tests** — recorded-id present+local → `RID==image_id`, **no pull/tag** issued; only tag local → `RID==tag id`; both absent → `PullFlagged`, **no pull/tag** in 4a (assert `Calls` has no `pull`/`tag`).

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run Preflight` → FAIL.

- [ ] **Step 3: Implement** `preflightImage` (only `docker image inspect` reads).

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/restore.go cli/cmd/restore_test.go
git commit -m "feat(cli): read-only restore image preflight (4a: recorded-id-first, pull-flag)"
```

---

## Task 16: Restore engine core (steps 5, 6, 6b, 6c)

**Files:**
- Modify: `cli/cmd/restore.go`
- Test: `cli/cmd/restore_test.go`

**Interfaces:**
- Consumes: `preflightImage`, `varlib.WriteJournal`/`ReadJournal`, `Runner`, `archive`.
- Produces: `type restoreOpts struct { Yes, WriteBreadcrumb bool; Caps archive.Caps }`; the engine skeleton `restoreEngine(ctx, a *App, archivePath string, opts restoreOpts) error` implementing steps **2→4a→5→6→6b→6c** (load/assets/re-pin/gate land in Tasks 17–18). This task delivers: confirmation (typed `app.Project`, `--yes`/internal bypass, untrusted-path warning), capture pre-restore state (`app` container ID + running+health-passing + breadcrumb-present-at-entry), `compose up -d --pull never db` then `compose stop app`, the standalone breadcrumb write (`kind:"restore"`, absolute `backup_path`, `target_image_id` = `RID` or absent when pull-flagged; skipped when `opts.WriteBreadcrumb==false`), and 6c obtain+retag with the **`context.WithTimeout(context.WithoutCancel(ctx), restartTimeout)`** pull-error restart gated to a clean restore. `const restartTimeout = 30 * time.Second`.

- [ ] **Step 1: Write the failing tests**:
  - confirmation uses `app.Project`; a wrong input aborts before any `up`/`stop`.
  - ordering `4a → confirm → up db → stop app → breadcrumb(6b) → pull/retag(6c)`; a **declined confirmation** performs **no** `docker pull` and **no** `docker tag` and writes **no** breadcrumb.
  - pull-flagged: breadcrumb written with `target_image_id` **absent**; 6c performs the `docker pull` and **finalizes** `target_image_id`; local-`RID` case: **no pull**, a `docker tag <RID> ImageRepo:<version>` when the tag doesn't already resolve to `RID`.
  - **round-10 #3 lost-ack:** a 6c pull that assigns the tag then returns a transport error **RETAINS** the breadcrumb and aborts.
  - **round-11/12/13 restart:** clean restore (no pre-existing breadcrumb + app running+healthy at step 6) → on a 6c pull error, a `docker start <captured-id>`; assert (using `FakeRunner.CtxSnaps`) the `docker start` call's snapshot is **live (`Err()==nil`) with a deadline ≈ `restartTimeout`**, while the *pull* call's snapshot was **cancelled** (the Ctrl-C-after-cancel case); a recovery restore or not-healthy pre-state issues **no** `docker start`. Breadcrumb **remains** whether the restart succeeds or fails.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'RestoreCore|Restore6'` → FAIL.

- [ ] **Step 3: Implement** steps 5/6/6b/6c per spec, including the exact restart-context construction (order-critical) and the `defer cancel()`.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/restore.go cli/cmd/restore_test.go
git commit -m "feat(cli): restore engine core (confirm, up-db/stop-app, breadcrumb, obtain/retag, WithoutCancel restart)"
```

---

## Task 17: Restore DB load + assets + cancellation cleanup (steps 7, 8)

**Files:**
- Modify: `cli/cmd/restore.go`
- Test: `cli/cmd/restore_test.go`

**Interfaces:**
- Consumes: `Runner.StreamIn`/`StreamInEnv`, `dockerx` force-remove.
- Produces: steps 7–8 in `restoreEngine` + the cancellation cleanup that force-removes **both** named workers before the lock releases.

- [ ] **Step 1: Write the failing tests**:
  - DB load runs as `compose run --rm --no-deps --pull never --name mathion_restore_db_<pid> --label io.mathion.worker=1 -T db sh -c '<the decode-gated one-liner>'` (**not** `exec`), `psql -h db`, fed via `StreamIn`; `StreamIn` surfaces the **real** pg error (not `EPIPE`); pg stderr is **not** echoed (generic message + the `0600` file path).
  - assets run via **`StreamInEnv` with `MATHION_VERSION=<manifest.version>`** (assert `EnvCalls`) on `--name mathion_restore_assets_<pid> --label io.mathion.worker=1`, argv `sh -c 'find /data/mathion/assets -mindepth 1 -delete && tar --no-same-owner -C /data/mathion/assets -xf -'`.
  - **cancellation:** on context-cancel — and also on a **transport/daemon error** and a **clean non-zero exit** with `ctx` live (round-5 #3) — the engine force-removes **both** `mathion_restore_db_<pid>` and `mathion_restore_assets_<pid>` with the launch-resolved/stably-absent loop, **before releasing the lock**, under a fresh `context.WithoutCancel`; a delayed-first-connect case (cancel while `pg_restore` still decoding) still kills via container-remove. The step-6b breadcrumb is **retained** on every such path.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'RestoreLoad|RestoreCancel'` → FAIL.

- [ ] **Step 3: Implement** steps 7–8 with the exact one-liner from spec §restore step 7, and the force-remove loop shared with the migrate cleanup (factor a `forceRemoveWorker(ctx, r, name)` helper used here and by `update`).

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/restore.go cli/cmd/restore_test.go
git commit -m "feat(cli): restore DB load (decode-gated, killable one-off) + assets on target image + worker cleanup"
```

---

## Task 18: Restore re-pin + recreate + gate (steps 9, 10)

**Files:**
- Modify: `cli/cmd/restore.go`
- Create: `cli/cmd/gate.go` (shared image-ID + `/version` gate, used by restore + update)
- Test: `cli/cmd/restore_test.go`, `cli/cmd/gate_test.go`

**Interfaces:**
- Consumes: `config.RepinVersion`, `dockerx.HealthProbe`, `Runner`.
- Produces:
  - `gateImageAndVersion(ctx, a *App, targetID, targetVersion string, strictVersion bool) error` — `docker inspect {{.Image}}` == `targetID`; poll `/version` within `gateTimeout=120s`/`pollInterval=2s`; exact JSON `{"version":target}` passes; when `!strictVersion`, a `404` or a `200 text/html` SPA shell also passes; **anything else fails** (different version, `401`/`403`/`5xx`, malformed, connection-refused after a passing healthcheck).
  - restore steps 9–10: `RepinVersion` → `compose up -d --wait --pull never app` → `gateImageAndVersion(..., strictVersion=false)` → on pass, a **standalone** restore `RemoveJournal`s (a failed remove = **non-fatal warning**). Print *"restored to `<version>` from `<archive>`"*.

- [ ] **Step 1: Write the failing tests** — gate passes on exact JSON and (non-strict) on 404 / 200-HTML when the image ID matches; fails on a different version, 5xx, or an ID mismatch (moved tag); restore step-9 re-pins then `up --wait --pull never app`; the breadcrumb is `RemoveJournal`'d only after the gate; a failed post-gate remove warns (restore still reported success).

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'Gate|RestoreGate'` → FAIL.

- [ ] **Step 3: Implement** `gate.go` + steps 9–10. Reuse `dockerx.HealthProbe` shape for the HTTP GET (127.0.0.1:8000). Note: `up -d --wait` owns the health-wait; the gate's own work is the ID check + `/version` poll, not a second health-wait.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/restore.go cli/cmd/gate.go cli/cmd/restore_test.go cli/cmd/gate_test.go
git commit -m "feat(cli): restore re-pin/recreate + image-ID+/version gate (legacy-tolerant); clear breadcrumb on pass"
```

---

## Task 19: `mathion restore` command

**Files:**
- Modify: `cli/cmd/restore.go` (add `newRestoreCmd`)
- Modify: `cli/cmd/root.go` (register)
- Test: `cli/cmd/restore_test.go`

**Interfaces:**
- Consumes: `requireRoot`, `varlib.EnsureBackupsDir`/`Lock`/`SweepStaleStaging`, `dockerx.SweepWorkers`, `guardEntry`, `archive.SelectLatest`/`TierFor`, `restoreEngine`.
- Produces: `newRestoreCmd(app *App) *cobra.Command` — args `<archive>` or `--latest`, `--yes`. RunE order: `requireRoot` → `EnsureBackupsDir` → `Lock` (defer) → `SweepStaleStaging` + `dockerx.SweepWorkers` → `guardEntry(app,"restore")` (**exempt — proceeds**) → resolve target (`--latest` via `SelectLatest`) → `TierFor` caps → `restoreEngine(ctx, app, path, restoreOpts{Yes, WriteBreadcrumb:true, Caps})`.

- [ ] **Step 1: Write the failing tests** — `--latest` resolves via `SelectLatest`; an explicit outside-`backups/` path prints the untrusted-SQL warning and uses untrusted caps; `restore` **proceeds** past a present breadcrumb (exempt) and **replaces** it with its own `kind:"restore"` one; lock-held error; `--yes` bypasses confirm.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run RestoreCmd` → FAIL.

- [ ] **Step 3: Implement** `newRestoreCmd`; register in `root.go`. Neither `--latest` nor a path → error; both → error.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/restore.go cli/cmd/restore_test.go cli/cmd/root.go
git commit -m "feat(cli): mathion restore command (exempt entry-check, --latest, tier caps, engine)"
```

---

## Task 20: `update` steps 1–4 (preconditions, same-tag guard, confirm, pull + capture `A`)

**Files:**
- Create: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Consumes: `config.ValidateEnvComplete`/`ValidateOCITag`, `Runner`, `compose.ImageRepo`, `buildDefaultImage`, `dockerx.HealthProbe`.
- Produces: the `update` skeleton `runUpdate(ctx, a *App, opts updateOpts) error` implementing steps 1–4 (5–10 + matrix in Tasks 21–23). `type updateOpts struct { Version string; NoRollback, Yes bool }`.

- [ ] **Step 1: Write the failing tests**:
  - precondition runs `ValidateEnvComplete` before any docker mutation.
  - **same-tag guard (round-9 #2):** `--version` == `.env` tag → **no `docker pull`**; JSON `/version` match → exit 0 "already at `<v>`"; a legacy `200 text/html` / mismatch / unreachable → exit 0 "already pinned … not supported". Assert **no `docker pull`** in either branch.
  - a **distinct** target → confirm (plan text + failure clause branched on `--no-rollback`; `--yes` skips) → `docker pull ImageRepo:<target>` → **capture `A`** via `docker image inspect ImageRepo:<target> --format {{.Id}}`. Bad tag / network fail → clean abort, no backup taken.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'UpdateGuard|UpdatePull'` → FAIL.

- [ ] **Step 3: Implement** steps 1–4 per spec §update. `docker pull` is a plain (non-compose) `Runner.Run(ctx, "pull", ImageRepo+":"+target)`.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/update_test.go
git commit -m "feat(cli): update steps 1-4 (env precondition, same-tag guard, confirm, pull + capture target ID)"
```

---

## Task 21: `update` steps 5, 6, 6a, 6b (stop, offline backup, validate, breadcrumb)

**Files:**
- Modify: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Consumes: `backupEngine`, the restore **non-mutating prefix** (Extract + sha256 + manifest + `PrescanAssets` + `preflightImage` — **4a only, no 6c**), `archive.ManagedCaps`, `varlib.WriteJournal`.
- Produces: steps 5–6b in `runUpdate`.

- [ ] **Step 1: Write the failing tests**:
  - ordering `stop app → offline backupEngine → validate(6a) → breadcrumb(6b)`.
  - **6a** runs the restore prefix (assert **no `docker tag`**) against the fresh auto-backup, using the **same managed ceilings** the later rollback will use (resolve `ManagedCaps` once, thread into 6a and the rollback). On 6a failure → `compose start app` (uncancelled ctx) + abort, **nothing migrated** (no breadcrumb/migrate/re-pin follows).
  - **6b** writes exactly `{schema,created_at,kind:"update",old_tag,target_tag,target_image_id,backup_path}` with `target_image_id == A`; **no** `rollback_allowed`/`migrate_container_name` fields; dir-fsync durable; a **6b write failure** is pre-mutation (`RemoveSync` partial + `start app` + abort).
  - backup failure (step 6) → `compose start app` (uncancelled ctx) + abort.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'UpdateBackup|Update6'` → FAIL.

- [ ] **Step 3: Implement** steps 5/6/6a/6b. Factor the restore non-mutating prefix as `validateBackup(ctx, a, path, caps) error` reused by 6a and callable standalone.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/update_test.go
git commit -m "feat(cli): update steps 5-6b (stop, offline backup, pre-mutation validate, durable breadcrumb)"
```

---

## Task 22: `update` steps 7–10 (migrate, re-pin, recreate, gate, commit)

**Files:**
- Modify: `cli/cmd/update.go`
- Test: `cli/cmd/update_test.go`

**Interfaces:**
- Consumes: `Runner.RunEnv`, `config.RepinVersion`, `gateImageAndVersion`, `varlib.RemoveJournal`.
- Produces: steps 7–10 (the happy path + the gate-pass commit point + the post-commit `RemoveSync`-failure warning).

- [ ] **Step 1: Write the failing tests**:
  - migrate via `RunEnv(ctx, ["MATHION_VERSION=<target>"], composeArgs("run","--rm","--no-deps","--pull","never","--name","mathion_migrate_<pid>","--label","io.mathion.worker=1","-T","app","alembic","upgrade","head")...)` — assert `EnvCalls` sets `MATHION_VERSION=<target>` **and nowhere else**; assert the migrate carries `--name`/`--label`.
  - re-pin (step 8) only after migrate; `compose up -d --wait --pull never app` (step 9).
  - gate (step 10) requires the running app's image ID == **`A`** plus **strict** JSON `/version=={"version":target}` (`strictVersion=true`); on pass → `RemoveJournal` + success "updated `<old>` → `<new>`".
  - **post-gate RemoveSync failure** → a **non-rollback warning** (no `restore` call, **not** exit 3, breadcrumb-cleanup message).

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'UpdateMigrate|UpdateGate'` → FAIL.

- [ ] **Step 3: Implement** steps 7–10 per spec. A code comment near the migrate call warns that a plain `run` (not `RunEnv`) would interpolate the **old** `${MATHION_VERSION}` and roll back every time.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/update_test.go
git commit -m "feat(cli): update steps 7-10 (RunEnv migrate, re-pin, recreate, strict gate = commit point)"
```

---

## Task 23: `update` failure matrix + interrupt + auto-rollback + exit-3

**Files:**
- Modify: `cli/cmd/update.go` (failure handler, signal handler, `rollbackFailedError`)
- Modify: `cli/cmd/root.go:76-79` (map `rollbackFailedError` → `os.Exit(3)` via `errors.As`)
- Modify: `cli/cmd/update.go` (add `newUpdateCmd`) + `cli/cmd/root.go` (register)
- Test: `cli/cmd/update_test.go`, `cli/cmd/root_test.go`

**Interfaces:**
- Consumes: `restoreEngine` (in-process, `restoreOpts{Yes:true, WriteBreadcrumb:false, Caps:<managed>}`), `dockerx` force-remove, `varlib`.
- Produces: `type rollbackFailedError struct{ err error }` (implements `error`); `newUpdateCmd(app *App) *cobra.Command` (`--version`, `--no-rollback`, `--yes`); the signal handler (cancel on first signal, `os.Exit(130)` on second) installed for the command's duration; the failure handler keyed on `ctx.Err()`.

- [ ] **Step 1: Write the failing tests**:
  - **clean** step-7/8/9/10 failure (`ctx` live, post-backup) → in-process `restore` on the just-taken backup under a **fresh uncancelled context**, then `RemoveJournal`. Before rolling back, the handler force-removes `mathion_migrate_<pid>` (assert `docker rm -f` + wait-absent, tolerating the create/observe race), and this force-remove **also** fires on a **clean non-zero migrate exit** and a **transport error** (round-4 #2), not only on cancel.
  - **`--no-rollback`** → leave the failed state, **leave the breadcrumb**, print the `mathion restore -- <backup>` hint, exit 1.
  - **rollback also fails** → returns `rollbackFailedError`; `root_test.go` asserts `Execute` maps it to `os.Exit(3)` (test via an injectable exit hook); breadcrumb **left in place**.
  - **SIGINT → `ctx` cancelled** → force-remove migrate, then (because `ctx.Err()!=nil`) **refuse** (leave breadcrumb, print hint), **no** auto-rollback.
  - the migrate one-off runs with the **sanitized env** (a host-exported `MATHION_VERSION`/`POSTGRES_PASSWORD` does not reach compose; only the deliberate `MATHION_VERSION=<target>` does).
  - a completed rollback whose breadcrumb `RemoveSync` fails **warns** rather than re-escalating.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'UpdateRollback|UpdateSignal|Exit3'` → FAIL.

- [ ] **Step 3: Implement** the failure matrix, `rollbackFailedError`, the two-signal handler, and the `root.go` `errors.As` mapping:

```go
// root.go Execute:
if err := newRootCmd(app).ExecuteContext(ctx); err != nil {
    app.Err.Write([]byte("error: " + err.Error() + "\n"))
    var rbf rollbackFailedError
    if errors.As(err, &rbf) {
        os.Exit(3)
    }
    os.Exit(1)
}
```

Register `newUpdateCmd` in `root.go`.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./...`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/update.go cli/cmd/root.go cli/cmd/update_test.go cli/cmd/root_test.go
git commit -m "feat(cli): update failure matrix (auto-rollback, refuse-on-interrupt, exit-3 rollback-failed)"
```

---

## Task 24: `mathion version` Finding #2 fix + live running version

**Files:**
- Modify: `cli/cmd/version.go`
- Test: `cli/cmd/version_test.go`

**Interfaces:**
- Consumes: `config.ReadEnvFile`, `dockerx.HealthProbe`-style HTTP GET.
- Produces: the errno-branched `version` output (spec §`mathion version`).

- [ ] **Step 1: Write the failing tests**:
  - `errors.Is(err, fs.ErrNotExist)` (no `.env`) → *"not installed"*.
  - `errors.Is(err, fs.ErrPermission)` (EACCES under `0700`) → *"installed (run with sudo to read the pinned version)"*.
  - otherwise → show pinned `MATHION_VERSION`; when `127.0.0.1:8000/version` is reachable, also show the running line; unreachable → omit it.

```go
func TestVersionEaccesBranch(t *testing.T) {
    dir := t.TempDir()
    os.WriteFile(dir+"/.env", []byte("MATHION_VERSION=v0.1.1\n"), 0o000) // unreadable
    // On CI running as root, EACCES won't trigger; gate this case behind a non-root guard
    // or inject a fake reader returning a *PathError with fs.ErrPermission.
}
```

Use an injectable env-reader seam so the ENOENT/EACCES branches are unit-testable without relying on the test uid.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run Version` → FAIL.

- [ ] **Step 3: Implement** the branch on `ReadEnvFile`'s error via `errors.Is`, the pinned line, and the optional running line (HTTP GET `/version`, parse `{"version":...}`; omit on any error). Output shape:

```
mathion cli-v0.1.1
image (pinned)  v0.1.1
image (running) v0.1.1
```

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/version.go cli/cmd/version_test.go
git commit -m "fix(cli): version distinguishes not-installed vs installed-unreadable; show running version"
```

---

## Task 25: Wire lock + sweep + entry-check into `start`/`stop`/`uninstall`; `--pull never` on `start`

**Files:**
- Modify: `cli/cmd/start.go`, `cli/cmd/stop.go`, `cli/cmd/uninstall.go`
- Test: `cli/cmd/start_test.go`, `cli/cmd/stop_test.go`, `cli/cmd/uninstall_test.go`

**Interfaces:**
- Consumes: `requireRoot`, `varlib.EnsureBackupsDir`/`Lock`/`SweepStaleStaging`, `dockerx.SweepWorkers`, `guardEntry`, `varlib.RemoveJournal`.
- Produces: the shared preamble (`requireRoot → EnsureBackupsDir → Lock(defer) → SweepStaleStaging + SweepWorkers → guardEntry`) added to each command, with the command-specific outcome:
  - `start` → `guardEntry` **refuse** on a breadcrumb; `up -d --wait --pull never` (add `--pull never`).
  - `stop` → **containment**: `guardEntry(app,"stop")` returns proceed=true and retains the breadcrumb; `stop` stops the stack and, when a breadcrumb was present, prints the recovery hint; it **never** clears the breadcrumb.
  - `uninstall` → **exempt** (`guardEntry` proceeds, breadcrumb retained); a **`--purge`** `RemoveJournal`s **only after** the typed confirmation + successful `dockerx.Purge` (at `uninstall.go:~49`, after teardown); a non-purge `uninstall` retains it.

- [ ] **Step 1: Write the failing tests**:
  - `start` with a breadcrumb **refuses** (no `up`); without, `up` carries `--pull never`; lock-held error.
  - `stop` with a breadcrumb **stops the stack, retains the breadcrumb, prints the hint**, does **not** `up`/`restore`/clear.
  - `uninstall --purge` `RemoveJournal`s **only after** confirmation + teardown; a **mistyped confirmation** or a **`dockerx.Purge` failure** **retains** the breadcrumb (assert the journal file still present); a fresh `install` afterward is not deadlocked; a non-purge `uninstall` retains it.

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'Start|Stop|Uninstall'` → FAIL.

- [ ] **Step 3: Implement** the preamble + per-command outcomes. Factor the preamble into a `lockAndGuard(app, cmd string) (release func() error, proceed bool, err error)` helper in `guard.go` to avoid duplication (each RunE calls it, defers `release`). `stop`/`uninstall` pass their command name so `guardEntry` routes to containment/exempt.

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./cmd/`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/start.go cli/cmd/stop.go cli/cmd/uninstall.go cli/cmd/start_test.go cli/cmd/stop_test.go cli/cmd/uninstall_test.go cli/cmd/guard.go
git commit -m "feat(cli): wire lock+sweep+entry-check into start/stop/uninstall; --pull never on start"
```

---

## Task 26: `install` guard wiring + resume hardening

**Files:**
- Modify: `cli/cmd/install.go` (fresh path guard; resume `--pull never` + volume-gated pull + always-migrate)
- Test: `cli/cmd/install_fresh_test.go`, `cli/cmd/install_resume_test.go`

**Interfaces:**
- Consumes: `requireRoot`, `varlib` lock/sweep, `guardEntry`, `dockerx.VolumeExists`.
- Produces: the guard preamble on `install`'s RunE (refuse on breadcrumb — including that `resume` never reaches `up -d --wait`), and the hardened `resume`:
  - `dockerx.VolumeExists("<project>_mathion_pgdata")` — **present ⇒ skip `compose pull`, still run the idempotent migrate**; positively absent ⇒ `compose pull` allowed; **detection error ⇒ fail closed** (treat as present → no pull, migrate still runs).
  - resume's `compose up` takes `--pull never`.

- [ ] **Step 1: Write the failing tests** (`install_resume_test.go`):
  - `mathion_pgdata` **present** → resume issues **no `compose pull`**, `up` carries `--pull never`, **still runs `alembic upgrade head`**.
  - simulate a **fresh install crashed after `compose up` (volume created) but before migrate** → retry does **no pull**, **does migrate**, completes.
  - `pgdata` **positively absent** → a `compose pull` **is** allowed.
  - `VolumeExists` **detection error** → fail closed (no pull, migrate still runs).
  - a present breadcrumb makes `install` **refuse** and **never reaches `up -d --wait`** (assert no `up` call).

- [ ] **Step 2: Run, verify fail** — `go -C cli test ./cmd/ -run 'InstallResume|InstallFresh'` → FAIL.

- [ ] **Step 3: Implement** the guard preamble on `newInstallCmd`'s RunE and the resume changes at `install.go:115-132`. Fresh install remains the first obtaining point (its `compose pull` is allowed).

- [ ] **Step 4: Run tests, verify pass** — `go -C cli test ./...`.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/install.go cli/cmd/install_fresh_test.go cli/cmd/install_resume_test.go
git commit -m "feat(cli): install guard + resume hardening (volume-gated pull, always-migrate, --pull never)"
```

---

## Task 27: Integration test (`cli/integration_test.sh`, real Docker)

**Files:**
- Create: `cli/integration_test.sh`

**Interfaces:** shell script exercising real Docker (not run in the unit CI lane; documented as manual/opt-in).

- [ ] **Step 1: Write the script** covering the spec §Integration list:
  - install → `backup` → mutate a row + add/delete an asset → `restore` → assert DB reverted, assets reverted, `/version` correct.
  - install → `update --version <other-tag>` → assert `/version` == target.
  - a **post-backup** forced-failure update (a tag that pulls but whose migrate or `/version` gate is made to fail) → assert auto-rollback restored the old version and the stack is healthy.
  - **Legacy-image rollback (real `v0.1.1`, not a mock):** update *from* `v0.1.1` to a slice-3 tag, force the gate to fail, assert the auto-rollback to `v0.1.1` **succeeds** (proving the gate tolerates the `200 text/html` SPA `/version` and gates on the resolved image **ID**).
  - **Crash-resume with a live orphan:** `SIGKILL` the CLI mid-migrate so `mathion_migrate_<pid>` (labeled) + the breadcrumb survive; run `mathion start`/`update` and assert it (a) label-sweeps the orphan after the flock and (b) **refuses** with the `mathion restore <backup>` hint; then `mathion restore <backup>` recovers and clears the breadcrumb.
  - `tar`/`find`/`mktemp` exist and run as the uid owning the assets volume.
  - **Note explicitly** in the script that the "restore an older-schema backup over a migrated DB" leg is **not runnable until a second migration exists**, and mark any other leg that cannot run in CI.

- [ ] **Step 2: Run it** on a box with Docker (OrbStack) → all assertions pass. (This lane is manual/opt-in, not part of `go test`.)

- [ ] **Step 3: Commit**

```bash
git add cli/integration_test.sh
git commit -m "test(cli): real-Docker integration (backup/restore/update/rollback/crash-resume)"
```

---

## Self-Review

*(Run by the plan author with fresh eyes against the spec — a checklist, not a subagent dispatch.)*

**1. Spec coverage** — every spec section maps to a task:
- `GET /version` + Settings → T1. `mathion version` fix → T24.
- `AtomicWrite` dir-fsync + `RemoveSync` → T2. Runner streaming/env/sanitized + FakeRunner → T3. `ImageRepo` drift → T4. `ValidateEnvComplete` strengthening → T5. `.env` re-pin → T6. `EnsureBackupsDir`/staging → T7. flock + label sweep → T8. breadcrumb → T9. entry-check → T10.
- backup archive/manifest/`--latest` → T11–T12; `mathion backup` → T13.
- restore extractor/pre-scan/caps → T14; 4a → T15; 5/6/6b/6c → T16; 7/8 + cancellation → T17; 9/10 + gate → T18; `mathion restore` → T19.
- update 1–4 → T20; 5–6b → T21; 7–10 → T22; failure matrix/interrupt/exit-3 → T23.
- `--pull never` sweep + install-resume hardening → T25/T26. Global concurrency/durability constraints → threaded through T2/T7/T8/T9/T10 and every command task. Integration → T27.

**2. Placeholder scan** — no "TBD"/"add error handling"/"similar to Task N"; each code step carries real code or a verbatim spec command; each test step carries concrete assertions. (Long argv one-liners are quoted verbatim from the spec.)

**3. Type consistency** — `Runner` method names (`Stream`/`StreamIn`/`RunEnv`/`StreamInEnv`), `compose.ImageRepo`, `config.RepinVersion`/`RemoveSync`, `varlib.{EnsureBackupsDir,StagingDir,Lock,WriteJournal,ReadJournal,RemoveJournal,RecoveryCommand}`, `archive.{Manifest,Assemble,Extract,PrescanAssets,SelectLatest,Caps,TierFor,ManagedCaps,UntrustedCaps}`, `dockerx.{SweepWorkers,VolumeExists}`, `cmd.{guardEntry,lockAndGuard,requireRoot,backupEngine,restoreEngine,preflightImage,gateImageAndVersion,runUpdate,rollbackFailedError,restartTimeout}` are used consistently across producing and consuming tasks.

**Dependency order (must implement in this order):** T2/T3/T4/T5 (foundation) → T6/T7/T8/T9 → T10 → T11/T12/T13 → T14/T15/T16/T17/T18/T19 → T20/T21/T22/T23 → T24/T25/T26 → T27. T1 (backend) is independent and may run any time.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-phase9-d-slice3-update-backup-restore.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, a spec-compliance + quality review after each, a broad whole-branch review at the end.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?



