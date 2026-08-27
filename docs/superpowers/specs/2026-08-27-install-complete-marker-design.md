# Install-complete marker — refuse operating on a never-finished install

**Status:** design (revision 1)
**Date:** 2026-08-27
**Author:** Sergey Kucheryavskiy (with Claude)
**Area:** Mathion deployment CLI (`cli/`, Go 1.24, cobra)
**Follow-up to:** `docs/superpowers/specs/2026-08-26-mathion-reconcile-design.md` §4.6
(the agreed install-completeness follow-up slice)

## 1. Problem

A fresh `mathion install` writes its on-disk `install-state` marker **before** it
migrates the database and creates the superuser:

- `cmd/install.go:190` — `config.WriteState(CfgDir, State{Schema: 1, AdminEmail: email})`
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
running-app gate confirms the `app` container is up — but **none of these proves
the install finished migrating.** As a result:

- **`mathion reconcile`** passes its gates and runs `up` on a broken host,
  reporting “reconciled” — it neither completes nor repairs the missing schema.
- **`mathion tls enable`** (`cmd/tls.go:186` calls `requireInstalledDeployment`,
  but has no running-app or completeness gate) proceeds likewise.
- **`mathion start`** (`cmd/start.go`) does only `lockAndGuard` + `up` — no
  install-state check at all — and will (re)start the half-installed stack.

The reconcile spec §4.6 documented this as an **honest bound shared by
`reconcile`, `tls enable`, and `start`** and deferred closing it to “its own small
hardening slice, so it lands uniformly rather than only inside reconcile.” This is
that slice.

## 2. Goal

Give `mathion install` a durable **install-complete** signal, written only after
migrate **and** superuser succeed, and have `reconcile`, `start`, and `tls enable`
**refuse** to operate when the signal says the install never finished — directing
the operator to `sudo mathion install` (which already resumes idempotently). Every
deployment installed **before** this slice must keep working untouched.

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
- **`install` is exempt** from the new gate — it is the command that *completes*
  an install and must run on an incomplete host (that is the resume path).
- **No auto-repair beyond the existing resume.** This slice does not add new
  migration or repair logic; it relies on `mathion install`’s existing idempotent
  resume (`up` → `alembic upgrade head` → `create-superuser`) to finish a
  half-installed host.
- **`update` is untouched.** It upgrades an already-complete install; it neither
  reads nor rewrites the completeness field.
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

`complete,omitempty` keeps a `Schema 1` file byte-shape unchanged and lets a
`Schema 2, complete:false` file omit the key too; only `complete:true` serializes
it. Backward-compatible in both directions.

### 4.2 `install` stamps completion after the real work

Two write points, both writing `Schema 2`:

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
  true for it.

A crash anywhere between the `:190` “started” write and the post-superuser
“complete” write leaves `complete:false`. Every recovery converges on
`complete:true`:

- crash after `.env` exists → re-run `install` takes the **resume** branch
  (`envExists`, `install.go:59`) → completes + stamps.
- crash before `.env` exists → re-run takes the **fresh** branch; the fresh volume
  guard (`install.go:89-97`) is unaffected (no `up` ran yet, so no volumes), and
  `WriteState` overwrites the stale `Schema 2, complete:false` marker.

`install` reads no completeness gate itself.

### 4.3 The gate: `requireInstallComplete`, wired into three commands

A single focused helper (new, in `cmd/` beside the other guards):

```go
// requireInstallComplete refuses when install-state says the install never
// finished migrating/creating the superuser (Schema 2, complete:false), or when
// there is no valid install-state at all. Schema 1 is grandfathered complete.
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

Enforcement (uniform — the §4.6 “lands uniformly” intent):

- **`reconcile`** — call `a.requireInstallComplete()` immediately after the
  existing `a.requireInstalledDeployment()` (`reconcile.go:50`), i.e. under the
  `varlib` lock, before the marker write / compose write / any container mutation.
- **`tls enable`** — call it immediately after `a.requireInstalledDeployment()`
  (`tls.go:186`).
- **`start`** — call it after `lockAndGuard` and before the `up`
  (`start.go:18`). This is `start`’s only new behavior: a never-installed host now
  gets a clear “run `mathion install`” instead of a raw compose error, and a
  half-installed host is refused instead of (re)started. `start` gains **only**
  this check — no `.env`/permission validation (that stays reconcile/tls’s
  `requireInstalledDeployment`), keeping the change surgical.

`requireInstalledDeployment` itself is **unchanged** — it remains
“`.env` valid + `install-state` parses + `ValidateEnvComplete`”. Completeness is a
separate predicate so `start` (which does not call `requireInstalledDeployment`)
can adopt exactly the one new check and reconcile/tls keep their existing gate.
The double `ReadState` on reconcile/tls (once in each helper) is harmless.

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
- **Existing tests**: every fixture seeds `State{Schema: 1, …}` (install_resume_test,
  install_test, reconcile_test, tls_test, uninstall_test, state_test). Schema 1 is
  grandfathered complete, so **all existing gate/recognition tests pass unchanged**;
  new tests seed `Schema 2, complete:false` to exercise refusals.

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
  state; a `Schema 2, complete:false` file omits/serializes the key as specified.
- **install stamping** (`cmd/install_test.go` / `install_resume_test.go`) — a fresh
  install whose `create-superuser` step fails leaves `Schema 2, complete:false`
  (fake runner errors at the superuser exec; assert the on-disk state); a fully
  successful fresh install leaves `Schema 2, complete:true`; a successful resume of
  a seeded `Schema 2, complete:false` (and of a legacy `Schema 1`) leaves
  `complete:true`.
- **gate** — `requireInstallComplete` returns nil for `Schema 1` and
  `Schema 2, complete:true`; errors (distinct messages) for `Schema 2,
  complete:false` and for missing install-state.
- **command enforcement** — `reconcile`, `start`, `tls enable` each REFUSE on a
  seeded `Schema 2, complete:false` host (no `up`, no compose write, no marker
  write) and PROCEED on `Schema 2, complete:true` and on legacy `Schema 1`
  (existing tests already cover the Schema-1 “proceed” case).
- **`status` notice** — emitted for `Schema 2, complete:false`, absent for
  `Schema 1`/`complete:true`; fail-quiet on unreadable install-state.
- Full `go test ./...` green on darwin and in a linux container; gofmt/vet
  (incl. `GOOS=linux`) clean.

## 6. Out of scope / follow-ups

- **Auto-reconcile-on-upgrade** (make `update`/`self-update` apply compose
  changes automatically) — a deliberate reconcile non-goal, tracked separately.
- **`alembic`-truth backfill** of legacy half-installs (§4.6 residual) — only if a
  real need appears; YAGNI until then.
- **Interactive `install` prompting** for omitted `--domain`/`--admin-email`
  (`install.go:104-105` already notes it as a planned later slice) — unrelated.
