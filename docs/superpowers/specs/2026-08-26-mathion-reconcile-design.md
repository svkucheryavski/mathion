# `mathion reconcile` — apply an upgraded CLI's stack definition to a running deployment

**Status:** design (revision 2, post dual-gate)
**Date:** 2026-08-26
**Author:** Sergey Kucheryavskiy (with Claude)
**Area:** Mathion deployment CLI (`cli/`, Go 1.24, cobra)

## 1. Problem

The production Docker Compose file is **embedded** in the `mathion` binary
(`cli/internal/compose/docker-compose.yml`, `go:embed` → `compose.ComposeYAML`)
and is the source of truth for the stack's shape. It reaches a deployment's
on-disk copy at `/etc/mathion/docker-compose.yml` in exactly **two** places
today:

- `install` (`cmd/install.go:124,187` — `config.AtomicWrite(CfgDir+"/docker-compose.yml", composeBytes(), 0o644)`), and
- `tls enable` (`cmd/tls.go:194` — same write, step 4: *"Re-materialize the on-disk compose to the embedded revision so `up … proxy` finds the service after a CLI upgrade"*).

Neither update path re-materializes it:

- **`mathion self-update`** swaps only the CLI binary. On an apt-managed binary
  it defers to apt (`internal/selfupdate/run_linux.go:54-56`); on a curl|sh
  binary it swaps `/usr/local/bin/mathion` in place. It never touches
  `/etc/mathion/docker-compose.yml` and never recreates a container.
- **`apt upgrade mathion`** replaces the binary via dpkg; the `.deb` carries a
  `postinstall`-only maintainer script (no `prerm`/`postrm`, verified
  `cli/.goreleaser.yaml:52`, `deploy/deb/postinst.sh`) and touches nothing under
  `/etc/mathion`.
- **`mathion update`** is image-tag-driven: on a same-version target it
  **short-circuits without mutation** (prints "nothing to do" / "same-version
  refresh is not supported" and returns success — `cmd/update.go:199-210`),
  writes no compose file, and recreates **only** the `app` service
  (`cmd/update.go:328`, `up -d --wait --pull never app`) — the proxy is
  deliberately left untouched (Slice-5 decoupling).

**Consequence (observed 2026-08-26 with the HSTS change in cli-v0.4.1):** an
operator upgraded the CLI to a release whose embedded compose added an HSTS
header to the bundled TLS proxy, but the running proxy kept serving the previous
definition. The change only took effect after re-running `tls enable` (which, as
a side effect, re-materializes the compose and recreates the proxy). There is no
first-class "apply the new stack definition" action, and no signal telling the
operator one is needed. For a non-expert self-hosting audience this is a silent
papercut: the upgrade appears to do nothing.

## 2. Goal

Add a first-class, safe way to apply the current CLI's embedded compose to an
**already-running** deployment — `mathion reconcile` — and surface a **drift
notice** that tells operators when to run it.

## 3. Non-goals & constraints

- **Not** auto-running reconcile from `self-update`/`update`/`apt`. A routine
  tool upgrade must never silently restart the internet-facing proxy without
  consent, and it could not cover the apt path anyway. Reconcile is operator-
  invoked; the notice is the nudge.
- **Not** a merge of operator hand-edits. The embedded compose is authoritative
  and overwrites the on-disk file — identical to what `tls enable` already does.
- **Not** an image-tag change. `MATHION_VERSION` (the app image tag) is
  `update`'s responsibility; reconcile applies compose *structure* against the
  current `.env` pins and never rewrites `MATHION_VERSION` (see §4.3 for how it
  avoids pulling mutable tags).
- **Not** a schema migration or data operation, and — as a **compatibility
  constraint on future compose edits** — reconcile must never be the delivery
  vehicle for a compose change that requires an Alembic migration or alters
  app/db data semantics. Such changes ride `mathion update` (which migrates,
  backs up, and auto-rolls-back). Reconcile changes only the *shape* of services
  whose behavior does not depend on a schema/data change (proxy/hardening/
  networking/headers). It performs no Alembic step, takes no data backup, and
  writes no recovery breadcrumb of its own (see §7).
- **Not** an orphan reaper. Reconcile does not pass `--remove-orphans`; a future
  service *rename or removal* is delivered with its own migration note, not
  silently by reconcile (§4.2).

## 4. `mathion reconcile`

### 4.1 Behavior

Re-materialize the on-disk compose from the embedded revision, then bring the
running project up so Compose reconciles the running containers to it.

1. **`lockAndGuard(ctx, app, "reconcile")`** — this already performs
   `requireRoot()` (`cmd/guard.go:34`), takes the singleton `varlib` lock
   (mutual exclusion with `update`/`backup`/`restore`/`tls enable`), and runs the
   breadcrumb entry-check. `"reconcile"` is added to `classify`'s REFUSE set
   (`cmd/guard.go:72-79`), so a leftover recovery breadcrumb from an interrupted
   `update` makes reconcile **refuse** rather than mutate a half-migrated stack.
   (No separate `requireRoot()` call — that would duplicate what `lockAndGuard`
   does, unlike the established `install`/`start`/`tls` pattern.)
2. **`requireInstalledDeployment()`** (`cmd/tls.go:232`) — a present, regular,
   **private** `.env` (owner-only, `perm&0o077 == 0`); a valid install-state; and
   **`config.ValidateEnvComplete` passing**. A poisoned/incomplete `.env` aborts
   here, before any write or container mutation. This is the primary fail-closed
   gate.
3. **Re-derive TLS state under the lock.** Set
   `a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)` (or derive it from the validated
   `.env` map returned by step 2) **now**, while holding the lock — do **not**
   rely on the value `Execute` cached at startup (`cmd/root.go:129`), which is
   read before the lock and could be stale if a concurrent `tls disable`/`enable`
   completed in the window between process start and lock acquisition. This makes
   the profile decision in step 6 authoritative for the current `.env`.
4. **Require the stack to be running.** Reconcile applies to a *running*
   deployment. If the `app` service container is not currently running (checked
   via `compose ps` for `app`, analogous to `proxyRunning` at `cmd/tls.go:258`),
   reconcile **refuses** with guidance: a deliberately-stopped stack → run
   `mathion start` first; a never-completed install → run `mathion install`
   (resume). This keeps reconcile from silently "succeeding" on a partial install
   that never migrated (see §4.6 residual) and from starting a stack the operator
   stopped on purpose.
5. **Drift read + confirm.** Byte-compare `compose.ComposeYAML` against the
   on-disk `/etc/mathion/docker-compose.yml` to shape the message, then prompt
   `[y/N]` on `app.In` (`bufio.NewReader(a.In).ReadString('\n')`, mirroring
   `cmd/update.go:221`), unless `--yes`:
   - bytes differ: *"the on-disk stack definition differs from this mathion
     binary's embedded definition; reconcile will re-materialize it and recreate
     any service whose configuration changed. Any changed service is briefly
     recreated (an HTTPS interruption if the proxy changes; app downtime if the
     app definition changed). Continue? [y/N]"*
   - bytes equal: *"the on-disk stack definition already matches this binary;
     reconcile will ensure the running containers match it. Continue? [y/N]"*
   A `n`/EOF answer returns `errors.New("reconcile cancelled")`.
6. **Apply** (the mutation):
   a. **Write the reconcile-pending marker** (durable, e.g.
      `varlib`-owned `/var/lib/mathion/reconcile-pending`) BEFORE any container
      change, so a failed/partial `up` is still detectable afterward (§5, §7).
   b. `config.EnsureConfigDir(CfgDir)` then
      `config.AtomicWrite(CfgDir+"/docker-compose.yml", composeBytes(), 0o644)`
      — the exact write `install`/`tls enable` use.
   c. **Pre-pull only the digest-pinned proxy images when TLS is enabled:**
      `compose pull --policy missing proxy proxy-init` (the `install.go:150` /
      `restore.go:440` pattern). These are the only images that can legitimately
      change under a pinned-digest bump; `--policy missing` fetches an absent one
      and is a no-op otherwise.
   d. `a.compose(ctx, "up", "-d", "--wait", "--pull", "never")` (whole project,
      no service arg, **no `--remove-orphans`**). `--pull never` guarantees
      reconcile never pulls the **mutable** `app`/`db` tags (avoiding the
      unverified-image hazard `update` guards against); the digest-pinned proxy
      images it might need were pre-pulled in (c). Compose recreates **only**
      services whose resolved config changed and waits on healthchecks.
   e. When TLS is enabled, call `reportHTTPSReadiness()` (the bounded best-effort
      probe `tls enable` uses — `cmd/tls.go:221`) since the proxy has no
      healthcheck and `--wait` cannot gate on it.
   f. **Remove the reconcile-pending marker** only after (d) (and (e)) succeed.
7. **Report:** on success, a single line naming this CLI's stack revision
   (`buildVersion`, not `MATHION_VERSION`, which identifies the app image) — e.g.
   *"reconciled to this CLI's stack definition (<buildVersion>); run `mathion
   status` to confirm"*. Compose's own `Recreating …`/`Running …` lines on the
   child's stderr already show which services changed; reconcile does not parse
   or re-summarize them.

### 4.2 TLS-profile gating (fail-closed, reused verbatim)

The `up` in step 6d goes through `a.compose` → `a.composeArgs` →
`a.tlsProfileWanted` (`cmd/root.go:35-69`). For sub-command `up`, that returns
`a.tlsEnabled` — the value **re-derived under the lock in step 3**, not the
startup snapshot. `tlsEnabledFromEnv` FAILS CLOSED (`cmd/root.go:77-86`): an
unreadable, incomplete, or interpolation-poisoned `.env`, or an empty
`MATHION_TLS_DOMAIN`, reads as **disabled**, so `--profile tls` is never added
and the proxy is never brought up over a `.env` from which Compose could expand a
secret. Reconcile adds no new gating logic — it inherits this, and step 2 has
already aborted on a `.env` that fails `ValidateEnvComplete`. Two agreeing
layers: TLS enabled ⟺ domain set and `.env` complete; TLS disabled ⟺ domain empty
and `.env` complete; `.env` incomplete ⟹ abort at step 2. (The only residual is
an out-of-band `.env` mutation *after* validation — a TOCTOU inherent to every
compose command, not specific to reconcile.)

Whole-project `up` therefore creates/updates `app`+`db` on a non-TLS deployment,
and `app`+`db`+`proxy`+`proxy-init` when TLS is enabled (the profile-gated
services join). `proxy-init` is an idempotent one-shot chown
(non-recursive, CHOWN-only, networkless — `docker-compose.yml:39-54`) gated by
`service_completed_successfully`; re-running it is safe. **No `--remove-orphans`:**
a future removed/renamed service is not silently reaped (it would also interact
badly with profile-gated services appearing as "orphans" when TLS is disabled);
such a change ships with its own migration note (§3).

### 4.3 Image pulls — `--pull never` + targeted pinned pre-pull

`app` and `db` use **mutable** tags (`ghcr.io/…/mathion:${MATHION_VERSION}`,
`postgres:17`); `proxy`/`proxy-init` use **digest-pinned** images. A blanket
`up --pull missing` could fetch or recreate a moved/absent mutable app/db tag —
booting an image reconcile never verified, the very thing `update` avoids
(`cmd/update.go:188,326`). Reconcile therefore:

- pre-pulls **only** the digest-pinned `proxy`/`proxy-init` with
  `pull --policy missing` (when TLS is enabled), then
- runs `up --pull never`, so no mutable tag is ever pulled by reconcile.

Residual (documented, out of scope): if an operator has **independently** moved
*and* pulled the local app tag, a subsequent whole-project `up` would recreate
`app` from that already-present local image — identical to the behavior of
`start`/`tls enable`'s `up`, and orthogonal to reconcile, which never itself
moves an image. App-image changes are `update`'s job.

### 4.4 Idempotency, re-run, and no rollback

Reconcile is forward-only and idempotent within a given CLI binary: it applies
*this binary's* embedded definition. If nothing changed, step 6d is a fast no-op.
Because reconcile performs **no** schema migration, image-tag move, or data
mutation (§3), there is no data state to roll back; a failed `up` (healthcheck
timeout, a not-yet-present pinned image on an air-gapped host) is simply retried
by re-running reconcile, and the **reconcile-pending marker** left behind (§4.1
step 6a, not removed on failure) keeps `status` warning until a clean apply
completes (§5). To *change* the stack definition you change the binary; reconcile
does not preserve prior compose revisions (they are recoverable deterministically
from the corresponding CLI version). Reconcile takes no backup and writes no
crash breadcrumb — unlike `update`, it has nothing to auto-rollback.

### 4.5 Flags

- `--yes` — skip the confirmation prompt (for automation).

No `--version`/`--no-rollback` (those are `update` concepts; reconcile changes no
tags and has no rollback).

### 4.6 Residual: install completeness

`requireInstalledDeployment` (step 2) validates the presence/permissions/
consistency of `.env` + install-state but does not by itself prove that a fresh
install ran its Alembic migration and superuser creation (`install` writes those
files before `up`/migrate — `cmd/install.go:183,206`). The step-4 running-app
gate plus the guardEntry breadcrumb refuse close the common cases (a failed fresh
install is typically not running, or left a breadcrumb). The narrow residual — an
install that reached `up app` but failed before migrate, leaving `app` running
without a schema and no breadcrumb — is shared with `tls enable`/`start` and is
best closed by a future **install-complete marker** written after
migrate/superuser setup (a small shared-hardening follow-up, explicitly out of
scope here). Reconcile does not run migrations, so it neither creates nor repairs
that state; it just should not be the tool an operator reaches for on a
half-installed host — the running-app gate nudges them to `mathion install`.

## 5. Drift notice — `maybeWarnComposeDrift`

A small helper, placed beside `maybeWarnDualInstall` (`cmd/version.go:49-60`),
with signature **`maybeWarnComposeDrift(w io.Writer, cfgDir string)`** (it must
honor `MATHION_CONFIG_DIR` via the caller's `app.CfgDir`, not a hardcoded
`/etc/mathion`, so tests that build `App{CfgDir: tmp}` exercise it correctly). It
reports drift when **either**:

- a **reconcile-pending marker** exists (a reconcile started but did not finish —
  §4.1 step 6a), **or**
- `compose.ComposeYAML` ≠ the bytes at `cfgDir+"/docker-compose.yml"`,

printing one line to `w`:

> `note: this deployment's stack definition differs from this mathion version's embedded definition (or a previous reconcile did not finish); apply it with: sudo mathion reconcile`

It is **silent** when neither condition holds, when the compose file is absent
(no deployment), or on any read error (fail-quiet — a notice must never break a
command). The message says the definitions **differ** — it does not assert the
on-disk copy "predates" the binary (a downgrade or hand-edit is also a
difference), nor that the running containers do or don't match (only a successful
reconcile establishes that).

### 5.1 Wiring

- **`mathion status`** (`cmd/status.go`): compute and emit
  `maybeWarnComposeDrift(app.Out, app.CfgDir)` **after the `compose ps` render
  succeeds but before the `/health` probe's early returns**, so the notice
  appears on both the healthy path *and* the "stack not healthy" path
  (`status.go:23-26` returns `nil` early — the drift signal is orthogonal to
  `/health` and must not be suppressed exactly when an operator is debugging).
  `status` is the **authoritative** detector: it runs as the *new* binary, so its
  embedded bytes are current.
- **end of a successful `self-update`** (`internal/selfupdate/run_linux.go:155`,
  right after the `%s → %s` success line): print an **unconditional** one-line
  nudge —
  > `if this release updated the stack definition, apply it with: sudo mathion reconcile`

  Deliberately *not* a byte-compare: the process printing it is still the **old**
  binary (`commitSwap` renames the staged temp over the target path
  (`swap.go:251`) while the running process stays mapped to its pre-swap inode
  (`swap.go:53`)), so its embedded compose is stale and a byte-compare here could
  miss the very drift the new binary introduces. The reliable detector is
  `status`; this line only points the operator at it. It fires only on the
  confirmed-swap path — not apt-defer (`:54-56`), not "already up to date"
  (`:66`), not `--check`/cancelled/durability-uncertain.

*(A pure `apt upgrade` of the CLI runs no interactive mathion code and cannot
print a nudge — `mathion status` is the reliable catch-all for that path.
**Rollout caveat:** the first upgrade *into* the release that contains this
feature is performed by a still-older binary that lacks the self-update nudge
entirely; `status` catches that case on its next invocation.)*

## 6. Security considerations

- **No new trust surface.** Reconcile writes the same embedded, digest-pinned
  compose that `install`/`tls enable` already write, and brings the project up
  through the same `composeArgs` path every other command uses. It introduces no
  new image, network topology, or privilege. (It may contact a registry to
  fetch an **absent** pinned proxy image via the targeted `pull --policy missing`
  — a missing pinned image can require network access — but it pulls no new
  *source* and no mutable tag.)
- **Fail-closed against `.env` poisoning is preserved** in two independent
  layers: `requireInstalledDeployment` → `ValidateEnvComplete` aborts before any
  write; and `tlsProfileWanted`→`tlsEnabledFromEnv` (re-derived under the lock,
  §4.1 step 3) refuses `--profile tls` over an incomplete/interpolation-bearing
  `.env`. Ambient `COMPOSE_PROFILES`/`MATHION_TLS_*` are stripped from the child
  env (`internal/compose/runner.go:55`), and the proxy service declares no
  `env_file` (`docker-compose.yml:56`), so no DB secret can reach the proxy env.
- **HTTPS-only is never downgraded.** Reconcile does not touch `.env`
  (`MATHION_BASE_URL`, `MATHION_COOKIE_SECURE`, the TLS vars), so it cannot flip
  a production deployment off HTTPS. It only recreates containers to match the
  compose.
- **Concurrency.** The `varlib` lock serializes reconcile against
  update/backup/restore/tls **after acquisition**; re-deriving `a.tlsEnabled`
  under the lock (§4.1 step 3) closes the pre-lock stale-read window a concurrent
  `tls disable`/`enable` would otherwise open. The breadcrumb REFUSE gate
  prevents reconciling over an interrupted update.

## 7. Error handling & exit codes

Reconcile uses the standard exit mapping (`exitCode`: 0 success, else 1). It has
no `rollbackFailedError`/exit-3 path — there is no rollback. A failed
`AtomicWrite` (disk full / permission) or a failed `pull`/`up --wait`
(healthcheck timeout, missing air-gapped pinned image) returns a plain error;
the **reconcile-pending marker is left in place** so `status` keeps warning, and
the operator fixes the condition and re-runs (idempotent, §4.4). The lock is
released on every path via `defer`.

## 8. Testing (hermetic, `compose.FakeRunner`)

**`reconcile` (`cmd/reconcile_test.go`):**
1. requires root (non-root → error, no runner calls) — via `lockAndGuard`.
2. requires an installed deployment: missing/loose-perm `.env` or failing
   `ValidateEnvComplete` → abort before any write or `up`.
3. refuses when a recovery breadcrumb is present (guardEntry/REFUSE).
4. **refuses when the app container is not running** (`compose ps` for `app`
   empty) → no compose write, no `up`; message points to `start`/`install`.
5. **re-derives TLS state under the lock:** with the startup `a.tlsEnabled`
   deliberately set to disagree with the current valid `.env`, the run uses the
   `.env`-derived value — a startup-`true`/`.env`-disabled fixture issues an `up`
   **without** `--profile tls`; a startup-`false`/`.env`-enabled fixture issues
   one **with** it.
6. re-materializes the compose: after a run, the on-disk `docker-compose.yml`
   bytes equal `compose.ComposeYAML`.
7. issues `pull --policy missing proxy proxy-init` (TLS-enabled only) then
   `up -d --wait --pull never` for the whole project; **never** `--pull missing`/
   `always`, **never** `--remove-orphans`.
8. **fail-closed profile gating:** with a TLS-complete `.env` the `up` carries
   `--profile tls`; with TLS disabled (empty domain) or a poisoned `.env` it does
   **not** — asserted on the `FakeRunner`'s recorded args. (The poisoned-`.env`
   leg also asserts the run aborts at step 2, i.e. `up` is never issued.)
9. **reconcile-pending marker:** present after a `FakeRunner` that fails the
   `up`; absent after a successful run; a fixture with the marker pre-existing
   makes `status` warn even when on-disk bytes equal the embedded ones.
10. prompts unless `--yes`; a `n` answer aborts with no marker, no compose write,
    no `up`. `--yes` skips the prompt and proceeds.

**drift notice (`cmd/version_test.go` or a new `drift_test.go`):**
11. `maybeWarnComposeDrift(w, cfgDir)` prints when on-disk ≠ embedded, prints when
    the pending marker exists (even if bytes match), and is silent when bytes
    match with no marker / file absent / read error. Honors a non-default
    `cfgDir`.
12. `status` emits it on **both** the healthy and the "stack not healthy"
    branches (two fixtures), and before the `/health` early return.

**self-update nudge (`internal/selfupdate/*_test.go`):**
13. a successful self-update prints the unconditional reconcile nudge after the
    `%s → %s` success line; the apt-defer, "already up to date", `--check`,
    cancelled, and durability-uncertain paths do not.

## 9. Files

- **New:** `cli/cmd/reconcile.go`, `cli/cmd/reconcile_test.go`.
- **New helper:** `maybeWarnComposeDrift(w, cfgDir)` + `composeDrifted(cfgDir)`
  beside `maybeWarnDualInstall` in `cli/cmd/version.go` (+ tests).
- **New marker helpers:** a small reconcile-pending read/write/remove in
  `cli/internal/varlib` (alongside the journal/lock), path e.g.
  `/var/lib/mathion/reconcile-pending`.
- **Modify:** `cli/cmd/root.go` (register `newReconcileCmd(app)` in
  `root.AddCommand`); `cli/cmd/guard.go` (add `"reconcile"` to `classify`'s
  REFUSE set); `cli/cmd/status.go` (emit the drift notice on both return-nil
  branches); `cli/internal/selfupdate/run_linux.go` (unconditional post-success
  nudge) + its test.
- **Docs:** README "Self-hosting / Upgrading" note that a CLI upgrade which
  changes the stack definition is applied to a *running* deployment with
  `mathion reconcile`, and that `mathion status` reports when it is needed.

## 10. References (verified against the tree at `5e2e5c1`)

- `cli/cmd/install.go:124,187,225` — the two existing embedded-compose writes + `composeBytes`; `:150` targeted proxy pre-pull; `:183,206` install order (files before up/migrate).
- `cli/cmd/tls.go:194,217,221,232-255,258` — `tls enable` re-materialize + `up` + `reportHTTPSReadiness`; `requireInstalledDeployment`; `proxyRunning`.
- `cli/cmd/update.go:188,199-210,221,326,328` — same-version short-circuit; unverified-image guard; prompt idiom; app-only recreate.
- `cli/cmd/root.go:35-90,122,129` — `composeArgs`/`tlsProfileWanted`/`tlsEnabledFromEnv`/`compose`; startup `tlsEnabled` snapshot (pre-lock).
- `cli/cmd/guard.go:34,72-79,92-109` — `lockAndGuard`→`requireRoot`, `classify` REFUSE set, `guardEntry`.
- `cli/cmd/version.go:49-60` — `maybeWarnDualInstall` (pattern to mirror).
- `cli/cmd/status.go:16-28` — top-level `status`, early `return nil` on ps-error/unhealthy.
- `cli/cmd/restore.go:440` — targeted `pull --policy missing proxy proxy-init` precedent.
- `cli/internal/selfupdate/run_linux.go:54-56,155`; `swap.go:53,251` — apt-defer; success line; rename-over-path swap with running process on the pre-swap inode.
- `cli/internal/compose/runner.go:55` — ambient `COMPOSE_PROFILES`/`MATHION_TLS_*` stripped from the child env.
- `cli/internal/compose/docker-compose.yml:4,24,39-56,60` — mutable app/db tags; digest-pinned proxy; proxy-init hardening; proxy has no healthcheck + no env_file.
- `cli/internal/compose/embed.go` — `//go:embed docker-compose.yml` → `ComposeYAML`.
