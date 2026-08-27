# Install-complete marker — refuse operating on a never-finished install

**Status:** design (revision 2 — post dual-gate round 1: gate widened to all five
stack-up commands; test-fixture, compatibility, and completeness corrections folded)
**Date:** 2026-08-27
**Author:** Sergey Kucheryavskiy (with Claude)
**Area:** Mathion deployment CLI (`cli/`, Go 1.24, cobra)
**Follow-up to:** `docs/superpowers/specs/2026-08-26-mathion-reconcile-design.md` §4.6
(the agreed install-completeness follow-up slice)

## 1. Problem

A fresh `mathion install` writes its on-disk `install-state` marker **before** it
migrates the database and creates the superuser:

- `cmd/install.go:190` — `config.WriteState(a.CfgDir, State{Schema: 1, AdminEmail: email})`
- `cmd/install.go:210` — `up -d --wait` (app health-gated)
- `cmd/install.go:213` — `alembic upgrade head`
- `cmd/install.go:216` — `create-superuser`

So an install that crashes **after `up` but before migrate/superuser** leaves a
*valid, complete-looking* `install-state` on a host whose app is running and
health-passing (`/health` is unconditional and never touches the database —
`backend/mathion/main.py:151-153`) but whose **schema is not migrated and whose
superuser does not exist**.

`requireInstalledDeployment` (`cmd/tls.go:232`) validates `.env`
presence/permissions/consistency + a valid `install-state`, and reconcile’s
running-app gate (`reconcile.go:57`) confirms the `app` container is up — but
**none of these proves the install finished migrating.** As a result, every
command that brings the stack up on an existing deployment proceeds on a broken
host:

- **`reconcile`** passes its gates and runs `up`, reporting “reconciled”.
- **`tls enable`** (`tls.go:186` calls `requireInstalledDeployment`, no
  running-app/completeness gate) re-materializes compose and brings up the public
  proxy.
- **`start`** (`start.go`) does only `lockAndGuard` + `up` — no install-state check.
- **`update`** (`update.go`) validates only `.env`, then migrates (`:312-317`) and
  recreates the app (`:328`); it never reads install-state.
- **standalone `restore`** (`restore.go`) starts the db, destructively reloads it,
  recreates the app (`:389`), and may start the public TLS proxy (`:429-465`); it
  never reads install-state.

The reconcile spec §4.6 documented this as an **honest bound shared by
`reconcile`, `tls enable`, and `start`** and deferred closing it to “its own small
hardening slice, so it lands uniformly.” Dual-gate review of revision 1 confirmed
`update` and `restore` are two further stack-up paths on the same gap. This slice
closes all five uniformly.

## 2. Goal

Give `mathion install` a durable **install-complete** signal, written only after
migrate **and** superuser succeed, and have every command that brings the stack up
on an existing deployment — **`reconcile`, `start`, `tls enable`, `update`, and
standalone `restore`** — **refuse** when the signal says the install never finished,
directing the operator to `sudo mathion install` (which already resumes
idempotently). Every deployment installed **before** this slice must keep working
untouched.

## 3. Non-goals & constraints

- **No new marker file, no `varlib` artifact.** The signal is a field on the
  existing `install-state`, the single source of install-truth already
  atomic-written (`config.AtomicWrite`, 0600) and already the thing
  `recognizedCfgDir`/`uninstall --purge` key on. One file, one schema.
- **No database probe on the gate path.** Completeness is read from
  `install-state` alone — no `alembic current` / compose-exec in the hot path.
  (An `alembic`-truth backfill was considered and rejected: it needs the stack
  running and adds a compose round-trip to every gate. Passive grandfathering,
  below, is chosen instead.)
- **Grandfather every existing deployment.** A pre-slice `install-state` is
  `Schema 1`; it is treated as **complete** with no migration, no probe, and no
  operator action. Only installs performed by the marker-aware CLI carry the
  explicit flag.
- **`install` is the only stamping path, and is exempt from the gate.** It is the
  command that *completes* an install and must run on an incomplete host (that is
  the resume path). No other command reads-then-writes completeness.
- **`update` and `restore` refuse but never stamp.** They are gated (they bring the
  stack up), but neither may write `complete:true`: `update` never runs the install
  superuser step, and a restored archive’s provenance is unknown (a backup can
  itself come from a half-installed host with no superuser). A half-installed host
  is completed only by `mathion install` (resume), which the refusal message names.
- **`restore`’s gate sits on the command, not the shared engine.** `restoreEngine`
  (`restore.go:197`) is reused by `update`’s in-process auto-rollback
  (`update.go:113`). The gate is placed in `newRestoreCmd` after its `guardEntry`
  (`restore.go:63`), **not** inside `restoreEngine`, so `update`’s rollback and
  `restore`’s breadcrumb exemption are unaffected.
- **`backup` is intentionally left ungated.** It does not bring the stack up (a
  one-off `alembic current` + `pg_dump` against the running app); a backup of an
  unmigrated DB is harmless and never masks completeness.
- **No auto-repair beyond the existing resume.** This slice adds no new migration
  or repair logic; it relies on `mathion install`’s existing idempotent resume
  (`up` → `alembic upgrade head` → `create-superuser`) to finish a half-installed
  host.
- Standard project rules: gofmt clean, `go vet ./...` (incl. `GOOS=linux`) clean,
  `go test ./...` green, embedded compose untouched, atomic writes only, each
  commit adds only its named paths, commit trailer exact.

## 4. Design

### 4.1 The marker: a completion field on `install-state`

`config.State` (`internal/config/state.go:92`) gains one field:

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

`ParseState` (`internal/config/state.go:117`) accepts schema **1 or 2** (was:
exactly 1); `AdminEmail != ""` is still required:

```go
if (s.Schema != 1 && s.Schema != 2) || s.AdminEmail == "" {
	return State{}, fmt.Errorf("install-state is incomplete or unknown schema (%d)", s.Schema)
}
```

Semantics of a `ParseState`-valid state:

| install-state | `InstallComplete()` | meaning |
| --- | --- | --- |
| `Schema 1` (no `complete` key) | **true** | legacy host — grandfathered |
| `Schema 2, complete:false` | **false** | install started, never finished (the gap) |
| `Schema 2, complete:true` | **true** | install finished |
| Schema 0/3+ or empty `admin_email` | — (`ParseState` error) | not a valid install |

`complete,omitempty` keeps a `Schema 1` file byte-shape unchanged and lets the
`Schema 2` *started* write omit the key too (it serializes
`{"schema":2,"admin_email":…}` and reads back `Complete:false`); only `complete:true`
serializes the key. This is forward-compatible for the marker-aware CLI reading its
own and legacy state. **It is not a two-way downgrade contract:** an *older* CLI’s
`ParseState` accepts only Schema 1 and would reject a Schema-2 file, and older
`start`/`update`/`restore` never read install-state at all. Running an older binary
against a Schema-2 host is an unsupported downgrade; on the paths that would read
state it fails closed (older CLI rejects the marker) rather than silently
mis-gating. Downgrade is out of scope.

### 4.2 `install` stamps completion after the real work

Two write points, both writing `Schema 2` (`install` is the only `WriteState`
caller — verified: `update`/`restore`/`backup` never write install-state):

- **Fresh path** (`runInstallFresh`): the existing `install-state` write at
  `install.go:190` becomes `State{Schema: 2, AdminEmail: email, Complete: false}`
  (install *started*). After the superuser step succeeds (`install.go:216`) and
  before the next-steps banner, add
  `config.WriteState(a.CfgDir, State{Schema: 2, AdminEmail: email, Complete: true})`.
- **Resume path** (`resume`, `install.go:120-163`): after the `create-superuser`
  step at `:163` succeeds, write
  `config.WriteState(a.CfgDir, State{Schema: 2, AdminEmail: st.AdminEmail, Complete: true})`
  and return nil (the current `return a.compose(… create-superuser …)` becomes a
  run-then-stamp sequence). Resuming a legacy `Schema 1` host thus **normalizes it
  to `Schema 2, complete:true`** — harmless, and `InstallComplete()` was already
  true for it. `create-superuser` is idempotent
  (`backend/…/superuser/service.py` select-then-create-or-promote), so re-running it
  on resume is safe.

A crash anywhere between the `:190` “started” write and the post-superuser
“complete” write leaves `complete:false`. Every recovery converges on
`complete:true`:

- crash after `.env` exists → re-run `install` takes the **resume** branch
  (`envExists`, `install.go:59`) → completes + stamps.
- crash before `.env` exists → re-run takes the **fresh** branch; the fresh volume
  guard (`install.go:89-97`) is unaffected (no `up` ran yet, so no volumes), and
  `WriteState` overwrites the stale `Schema 2, complete:false` marker.

`install` reads no completeness gate itself.

### 4.3 The gate: `requireInstallComplete`, wired into five commands

A single focused helper (new, in `cmd/` beside the other guards):

```go
// requireInstallComplete refuses when install-state says the install never
// finished migrating/creating the superuser (Schema 2, complete:false), OR when
// there is no valid install-state at all (missing/corrupt). Schema 1 is
// grandfathered complete.
func (a *App) requireInstallComplete() error {
	st, err := config.ReadState(a.CfgDir)
	if err != nil {
		return fmt.Errorf("no valid mathion install found at %s (%w); run `sudo mathion install` first", a.CfgDir, err)
	}
	if !st.InstallComplete() {
		return errors.New("this deployment's install did not finish (database not migrated / superuser not created); resume it with `sudo mathion install` before continuing")
	}
	return nil
}
```

The helper refuses on **two** conditions: a missing/corrupt `install-state`
(`ReadState` error) and a valid-but-incomplete one. The first branch means `start`,
`update`, and `restore` now also refuse a deployment whose marker was externally
lost/corrupted — matching the pre-existing `reconcile`/`tls enable` posture (both
already `ReadState`-refuse that case via `requireInstalledDeployment`). Recovery for
a genuinely lost marker is repair or `uninstall --purge`, exactly as the message and
the existing recognition errors already direct.

Enforcement — all five stack-up commands, each **after** the command’s existing
entry gate and **before** any mutation:

- **`reconcile`** — immediately after `a.requireInstalledDeployment()`
  (`reconcile.go:50`), i.e. under the `varlib` lock, before the marker write /
  compose write / any container change.
- **`tls enable`** — immediately after `a.requireInstalledDeployment()`
  (`tls.go:186`), before compose re-materialize / `up`.
- **`start`** — after `lockAndGuard` and before the `up` (`start.go:14-18`). This is
  `start`’s only new behavior; it gains **only** this check (no `.env`/permission
  validation — that stays reconcile/tls’s `requireInstalledDeployment`).
- **`update`** — in `newUpdateCmd` after `guardEntry(app, "update")` succeeds and
  while the lock is held (`update.go:157`), before `runUpdate` / any pull. `update`
  does **not** stamp.
- **standalone `restore`** — in `newRestoreCmd` after `guardEntry(app, "restore")`
  succeeds (`restore.go:63`), before archive resolution / `restoreEngine`. Placed on
  the command, **not** in `restoreEngine`, so `update`’s auto-rollback
  (`update.go:113`, which calls `restoreEngine` directly) is unaffected. `restore`
  does **not** stamp.

`requireInstalledDeployment` itself is **unchanged** — it remains
“`.env` valid + `install-state` parses + `ValidateEnvComplete`”. Completeness is a
separate predicate so `start`/`update`/`restore` (which do not call
`requireInstalledDeployment`) adopt exactly the one new check, and reconcile/tls
keep their existing gate. The double `ReadState` on reconcile/tls (once in each
helper) is harmless.

### 4.4 Grandfathering & compatibility (no active backfill)

Grandfathering is **passive**: a `Schema 1` file reads complete forever; nothing
migrates it, no backfill command exists, no DB is probed. Impact of the schema
bump on the existing `install-state` consumers:

- **`uninstall --purge` recognition** (`recognizedCfgDir` → `config.ReadState`
  `uninstall.go:129`; fd-bound `config.ParseState` `uninstall.go:219`): now accepts
  `Schema 2`, so a `Schema 2, complete:false` **half-installed host is still
  recognized and still purgeable** (essential — you must be able to clean up a
  broken install). Recognition depends on `ParseState` (schema + admin email),
  **never** on `Complete`.
- **`requireInstalledDeployment`** (`tls.go:244` `config.ReadState`): accepts
  `Schema 2`; its contract is unchanged.
- **Resume** (`install.go:71` `config.ReadState`): accepts `Schema 2`; a resume of
  a `Schema 2, complete:false` host works exactly like a resume of a legacy host.
- **The half-install-then-restore case self-heals.** Restoring a good backup onto a
  `Schema 2, complete:false` host is now refused up front (§4.3) rather than
  succeeding and leaving a stale-incomplete marker that later trips `start`; the
  operator runs `mathion install` (resume) first — idempotent `up`/migrate/superuser
  — then restores onto the completed host.
- **Existing tests**: fixtures that seed `State{Schema: 1, …}` into a **temp** dir
  (`reconcile_test.go:28,240`, `tls_test.go:115,231,271`, `uninstall_test.go:21`,
  `install_resume_test.go:*`, `state_test.go:49`) are Schema-1 → grandfathered
  complete → their gate/recognition assertions stay green. **Exception —
  `start_test.go`:** `TestStartArgv` (`start_test.go:45-61`) hardcodes
  `CfgDir: "/etc/mathion"` and seeds **no** install-state, because `start` reads
  none today. Once `start` gains the gate this test will `ReadState("/etc/mathion")`
  and refuse (or read the maintainer’s real host file). The plan **must** migrate
  `TestStartArgv` to a per-test `t.TempDir()` CfgDir seeded with a valid
  install-state, and confirm `TestStartRefusesOnBreadcrumb` still refuses at the
  breadcrumb first (`lockAndGuard` returns `proceed=false` before the new read).
  New tests seed `Schema 2, complete:false` to exercise refusals.

### 4.5 `status` notice (drift-notice pattern)

A helper beside `maybeWarnComposeDrift`/`maybeWarnDualInstall`
(`cmd/version.go`):

```go
// maybeWarnInstallIncomplete prints a one-line notice when install-state says the
// install never finished, so `mathion status` surfaces it before the operator
// hits a hard refusal. Fail-quiet: an unreadable/absent install-state (e.g.
// non-root `mathion version`, mode-0600 file) prints nothing.
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

Emitted from `status.go` where `maybeWarnComposeDrift` is already emitted, and
**before** it (a never-finished install is the more fundamental problem than a
drifted compose). Root runs status, so `install-state` is readable there; non-root
`version` fails quiet, matching the compose-drift marker read. This is the one
trim-able item: dropping it leaves the gate fully functional.

### 4.6 Residual (honest bound)

A **legacy `Schema 1` host that was itself half-installed** before this slice is
grandfathered “complete” and stays undetected — the passive-grandfather trade
(§3). This is unobservable from `install-state` alone and pre-exists the fix;
closing it would require the rejected DB-probe. New installs get the full
guarantee. This residual is intentionally accepted.

## 5. Testing

- **`internal/config/state_test.go`** — `ParseState` accepts `Schema 1` and
  `Schema 2` (with/without `complete`), rejects `Schema 0/3` and empty
  `admin_email`; `InstallComplete()` truth table (S1→true, S2/false→false,
  S2/true→true); round-trip `WriteState`/`ReadState` of a `Schema 2, complete:true`
  state; a `Schema 2, complete:false` file omits the `complete` key and reads back
  incomplete.
- **install stamping** (`cmd/install_test.go` / `install_resume_test.go`):
  - fresh install whose `create-superuser` step (`:216`) fails leaves
    `Schema 2, complete:false` (fake runner errors at the superuser exec; assert the
    on-disk state) — no complete stamp on a partial;
  - a fully successful fresh install leaves `Schema 2, complete:true`;
  - a **resume** whose `create-superuser` (`:163`) fails leaves the seeded
    `Schema 2, complete:false` unchanged (guards against a resume that stamps before
    its superuser call);
  - a successful resume of a seeded `Schema 2, complete:false` **and** of a legacy
    `Schema 1` leaves `complete:true`.
- **gate** — `requireInstallComplete` returns nil for `Schema 1` and
  `Schema 2, complete:true`; errors (distinct messages) for `Schema 2,
  complete:false` and for missing/corrupt install-state.
- **command enforcement** — `reconcile`, `start`, `tls enable`, `update`, and
  standalone `restore` each REFUSE on a seeded `Schema 2, complete:false` host
  (assert no `up`/no compose write/no marker write/no `restoreEngine` mutation — for
  `update`/`restore`, no pull and no stack-up call on the fake runner) and PROCEED on
  `Schema 2, complete:true` and legacy `Schema 1`. `start`’s proceed case needs a
  **new** fixture (§4.4); `TestStartRefusesOnBreadcrumb` must still refuse at the
  breadcrumb before reaching the new read. Confirm `update`’s auto-rollback path
  (`restoreEngine` via `update.go:113`) is **not** gated (the gate is on
  `newRestoreCmd`, not the engine).
- **`status` notice** — exercised through `newStatusCmd` (not only the helper):
  emitted for `Schema 2, complete:false`, absent for `Schema 1`/`complete:true`;
  fail-quiet on unreadable install-state.
- Full `go test ./...` green on darwin and in a linux container; gofmt/vet
  (incl. `GOOS=linux`) clean.

## 6. Out of scope / follow-ups

- **Auto-reconcile-on-upgrade** (make `update`/`self-update` apply compose
  changes automatically) — a deliberate reconcile non-goal, tracked separately.
- **`alembic`-truth backfill** of legacy half-installs (§4.6 residual) — only if a
  real need appears; YAGNI until then.
- **Older-CLI downgrade** against a Schema-2 host — unsupported; the marker-aware
  paths fail closed rather than mis-gate (§4.1).
- **Interactive `install` prompting** for omitted `--domain`/`--admin-email`
  (`install.go:104-105` already notes it as a planned later slice) — unrelated.
