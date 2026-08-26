# `mathion reconcile` — apply an upgraded CLI's stack definition to a running deployment

**Status:** design (for review)
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
  it defers to apt entirely (`internal/selfupdate/run_linux.go:54-56`); on a
  curl|sh binary it swaps `/usr/local/bin/mathion` in place. It never touches
  `/etc/mathion/docker-compose.yml` and never recreates a container.
- **`apt upgrade mathion`** replaces the binary via dpkg; the `.deb` carries a
  `postinstall`-only maintainer script (no `prerm`/`postrm`) and touches nothing
  under `/etc/mathion`.
- **`mathion update`** is image-tag-driven: it refuses a same-version run
  (`cmd/update.go:199-210`), writes no compose file, and recreates **only** the
  `app` service (`cmd/update.go:328`, `up -d --wait --pull never app`) — the
  proxy is deliberately left untouched (Slice-5 decoupling).

**Consequence (observed 2026-08-26 with the HSTS change in cli-v0.4.1):** an
operator upgraded the CLI to a release whose embedded compose added an HSTS
header to the bundled TLS proxy, but the running proxy kept serving the previous
definition. The change only took effect after re-running `tls enable` (which, as
a side effect, re-materializes the compose and recreates the proxy). There is no
first-class "apply the new stack definition" action, and no signal telling the
operator one is needed. For a non-expert self-hosting audience this is a silent
papercut: the upgrade appears to do nothing.

## 2. Goal

Add a first-class, safe, idempotent way to apply the current CLI's embedded
compose to the running deployment — `mathion reconcile` — and surface a **drift
notice** that tells operators when to run it.

## 3. Non-goals

- **Not** auto-running reconcile from `self-update`/`update`/`apt`. A routine
  tool upgrade must never silently restart the internet-facing proxy without
  consent, and it could not cover the apt path anyway. Reconcile is operator-
  invoked; the notice is the nudge.
- **Not** a merge of operator hand-edits. The embedded compose is authoritative
  and overwrites the on-disk file — identical to what `tls enable` already does.
- **Not** an image-tag change. `MATHION_VERSION` (the app image tag) is `update`'s
  responsibility; reconcile applies compose *structure* against the current
  `.env` pins and never rewrites `MATHION_VERSION`.
- **Not** a schema migration or data operation. Reconcile performs no Alembic
  step, takes no backup, and writes no recovery breadcrumb (see §7).

## 4. `mathion reconcile`

### 4.1 Behavior

Re-materialize the on-disk compose from the embedded revision, then bring the
project up so Compose reconciles the running containers to it.

1. **`requireRoot()`** — reconcile writes a root-owned file under `/etc/mathion`
   and mutates containers (`cmd/guard.go:21`).
2. **`lockAndGuard(ctx, app, "reconcile")`** — take the singleton `varlib` lock
   (mutual exclusion with `update`/`backup`/`restore`/`tls enable`) and run the
   breadcrumb entry-check. `"reconcile"` is added to `classify`'s REFUSE set
   (`cmd/guard.go:72-79`), so a leftover recovery breadcrumb from an interrupted
   `update` makes reconcile **refuse** rather than mutate a half-migrated stack.
3. **`requireInstalledDeployment()`** (`cmd/tls.go:232`) — a present, regular,
   `0600` `.env`; a valid install-state; and **`config.ValidateEnvComplete`
   passing**. A poisoned/incomplete `.env` aborts here, before any write or
   container mutation. This is the primary fail-closed gate.
4. **Drift read (advisory):** byte-compare `compose.ComposeYAML` against the
   on-disk `/etc/mathion/docker-compose.yml`. The result only shapes the
   confirmation copy (step 5); reconcile does the same work either way (step 6-7).
5. **Confirm** (unless `--yes`): print what will happen and prompt `[y/N]`.
   - if the bytes differ: *"the running stack predates this mathion version's
     stack definition; reconcile will re-materialize it and recreate any changed
     services (brief HTTPS interruption if the proxy changes). Continue? [y/N]"*
   - if the bytes are equal: *"compose already current; reconcile will ensure the
     running containers match it. Continue? [y/N]"*
   A `n`/EOF answer returns `errors.New("reconcile cancelled")`.
6. **Re-materialize:** `config.EnsureConfigDir(CfgDir)` then
   `config.AtomicWrite(CfgDir+"/docker-compose.yml", composeBytes(), 0o644)`
   — the exact write `install`/`tls enable` use.
7. **Apply:** `a.compose(ctx, "up", "-d", "--wait", "--pull", "missing")`
   (whole project, no service arg). Compose recreates **only** services whose
   resolved config changed (the proxy today; `app`/`db` stay running), waits on
   healthchecks, and pulls an image **only if absent** (see §4.3).
8. **Report:** on success, a single line (e.g. *"reconciled to <MATHION_VERSION>;
   run `mathion status` to confirm"*). Compose's own `Recreating …`/`Running …`
   lines on the child's stderr already show which services changed; reconcile does
   not attempt to parse or re-summarize them.

### 4.2 TLS-profile gating (fail-closed, reused verbatim)

The `up` in step 7 goes through `a.compose` → `a.composeArgs` →
`a.tlsProfileWanted` (`cmd/root.go:35-69`). For sub-command `up`, that returns
`a.tlsEnabled`, which `Execute` sets once at startup from `tlsEnabledFromEnv`
(`cmd/root.go:129,77-86`). `tlsEnabledFromEnv` FAILS CLOSED: an unreadable,
incomplete, or interpolation-poisoned `.env`, or an empty `MATHION_TLS_DOMAIN`,
reads as **disabled**, so `--profile tls` is never added and the proxy is never
brought up over a `.env` from which Compose could expand a secret. Reconcile adds
no new gating logic — it inherits this. (Belt-and-suspenders: step 3 already
aborts on a `.env` that fails `ValidateEnvComplete`, so reconcile cannot even
reach step 7 with a poisoned `.env`. The two agree: TLS enabled ⟺ domain set and
`.env` complete; TLS disabled ⟺ domain empty and `.env` complete; `.env`
incomplete ⟹ abort.)

Whole-project `up` therefore brings up `app`+`db` on a non-TLS deployment, and
`app`+`db`+`proxy`+`proxy-init` when TLS is enabled (the profile-gated services
join). `proxy-init` is an idempotent one-shot chown gated by
`service_completed_successfully`; re-running it is safe.

### 4.3 `--pull missing` (not `never`, not `always`)

A future embedded compose may bump a digest-pinned image (e.g. a reproxy or
busybox security update). `--pull never` would fail such a reconcile with an
"image not found" if the new digest is not local; `--pull always` would
re-pull present images and break air-gapped hosts on every run. `--pull
missing` fetches an absent pinned image and is a no-op for present ones — the
correct middle. An air-gapped host that legitimately needs a not-yet-present
image will get a clear pull error (inherent: it must obtain the image), while
the common case (compose structure changed, images unchanged — e.g. the HSTS
command arg) pulls nothing.

### 4.4 Idempotency / re-run safety

Reconcile is forward-only and idempotent. If nothing changed, step 7 is a fast
no-op. If the previous run failed mid-`up` (e.g. a transient healthcheck
timeout), the on-disk compose is already the new revision and re-running
reconcile simply retries the `up`. No data is mutated, no schema migrated, no
image tag moved — so there is nothing to roll back, and reconcile intentionally
does **not** take a backup or write a breadcrumb (unlike `update`). The prior
compose revision is always recoverable deterministically from an
older/newer CLI binary; reconcile does not preserve it.

### 4.5 Stack-not-running case

`up -d --wait` starts stopped services. Reconcile therefore also ensures the
stack is running, consistent with `tls enable`'s step-8 `up`. An operator who
deliberately stopped the stack and runs reconcile will bring it back up; this is
the documented "apply and ensure running" semantics. (It is acceptable because
reconcile already requires a valid installed deployment and prompts first.)

### 4.6 Flags

- `--yes` — skip the confirmation prompt (for automation).

No `--version`/`--no-rollback` (those are `update` concepts; reconcile changes no
tags and has no rollback).

## 5. Drift notice — `maybeWarnComposeDrift`

A small helper, placed beside `maybeWarnDualInstall` (`cmd/version.go:45-73`),
that byte-compares `compose.ComposeYAML` against the on-disk
`/etc/mathion/docker-compose.yml` and, when they differ (and a deployment is
installed — the file exists and is readable), prints one line to the given
writer:

> `note: the running stack predates this mathion version's stack definition; apply it with: sudo mathion reconcile`

It is **silent** when the bytes match, when the file is absent (no deployment),
or on any read error (fail-quiet — a notice must never break a command).

### 5.1 Wiring

- **`mathion status`** (`cmd/status.go`): call `maybeWarnComposeDrift(app.Out)`
  at the end of a successful status render. This is the **authoritative**
  detector — `status` runs as the *new* binary, so its embedded bytes are the
  current ones and the byte-compare is meaningful.
- **end of a successful `self-update`** (`internal/selfupdate/run_linux.go:155`,
  right after the `%s → %s` success line): print an **unconditional** one-line
  nudge —
  > `if this release updated the stack definition, apply it with: sudo mathion reconcile`

  This is deliberately *not* a byte-compare: the process printing it is still the
  **old** binary (the swap replaces the on-disk file, but the running image is the
  pre-swap one), so its embedded compose is stale and a byte-compare here could
  miss the very drift the new binary introduces. The reliable detector is
  `status`; this line is only a breadcrumb pointing the operator at it.

*(A pure `apt upgrade` of the CLI runs no interactive mathion code, so it cannot
print a nudge. `mathion status` is the reliable catch-all for that path.)*

## 6. Security considerations

- **No new trust surface.** Reconcile writes the same embedded, digest-pinned
  compose that `install`/`tls enable` already write, and brings the project up
  through the same `composeArgs` path every other command uses. It introduces no
  new image, registry, network, or privilege.
- **Fail-closed against `.env` poisoning is preserved** in two independent
  layers: `requireInstalledDeployment` → `ValidateEnvComplete` aborts before any
  write; and `tlsProfileWanted`→`tlsEnabledFromEnv` refuses `--profile tls` over
  an incomplete/interpolation-bearing `.env`. Reconcile can never expand a DB
  secret into the proxy env.
- **HTTPS-only is never downgraded.** Reconcile does not touch `.env`
  (`MATHION_BASE_URL`, `MATHION_COOKIE_SECURE`, the TLS vars), so it cannot flip
  a production deployment off HTTPS. It only recreates containers to match the
  compose.
- **Concurrency.** The `varlib` lock serializes reconcile against
  update/backup/restore/tls; the breadcrumb REFUSE gate prevents reconciling over
  an interrupted update.

## 7. Error handling & exit codes

Reconcile uses the standard exit mapping (`exitCode`: 0 success, else 1). It has
no `rollbackFailedError`/exit-3 path — there is no rollback. A failed
`AtomicWrite` (disk full / permission) or a failed `up --wait` (healthcheck
timeout, missing air-gapped image) returns a plain error; the operator fixes the
condition and re-runs (idempotent, §4.4). The lock is released on every path via
`defer`.

## 8. Testing (hermetic, `compose.FakeRunner`)

**`reconcile` (`cmd/reconcile_test.go`):**
1. requires root (non-root → error, no runner calls).
2. requires an installed deployment: missing/loose-perm `.env` or failing
   `ValidateEnvComplete` → abort before any write or `up`.
3. refuses when a recovery breadcrumb is present (guardEntry/REFUSE).
4. re-materializes the compose: after a run, the on-disk
   `docker-compose.yml` bytes equal `compose.ComposeYAML`.
5. issues `up -d --wait --pull missing` for the whole project.
6. **fail-closed profile gating:** with a TLS-complete `.env` the `up` carries
   `--profile tls`; with TLS disabled (empty domain) or a poisoned `.env` it does
   **not** — asserted on the `FakeRunner`'s recorded args. (The poisoned-`.env`
   leg also asserts the run aborts at step 3, i.e. `up` is never issued.)
7. prompts unless `--yes`; a `n` answer aborts with no `up` and no compose write.
8. `--yes` skips the prompt and proceeds.

**drift notice (`cmd/version_test.go` or a new `drift_test.go`):**
9. `maybeWarnComposeDrift` prints the reconcile hint when on-disk ≠ embedded;
   silent when equal, when the file is absent, and on read error.
10. `status` calls it (drifted fixture → hint appears in `app.Out`).

**self-update nudge (`internal/selfupdate/*_test.go`):**
11. a successful self-update prints the unconditional reconcile nudge after the
    `%s → %s` success line; the apt-defer and "already up to date" paths do not.

## 9. Files

- **New:** `cli/cmd/reconcile.go`, `cli/cmd/reconcile_test.go`.
- **New helper:** `maybeWarnComposeDrift` + `composeDrifted()` beside
  `maybeWarnDualInstall` in `cli/cmd/version.go` (+ tests).
- **Modify:** `cli/cmd/root.go` (register `newReconcileCmd(app)` in
  `root.AddCommand`); `cli/cmd/guard.go` (add `"reconcile"` to `classify`'s
  REFUSE set); `cli/cmd/status.go` (call the drift notice);
  `cli/internal/selfupdate/run_linux.go` (unconditional post-success nudge) + its
  test.
- **Docs:** README "Self-hosting / Upgrading" note that a CLI upgrade which
  changes the stack definition is applied with `mathion reconcile` (and that
  `mathion status` reports when it is needed).

## 10. References (verified against the tree at `5e2e5c1`)

- `cli/cmd/install.go:124,187,225` — the two existing embedded-compose writes + `composeBytes`.
- `cli/cmd/tls.go:189-217,232-255` — `tls enable` step-4 re-materialize + step-8 `up`; `requireInstalledDeployment`.
- `cli/cmd/update.go:199-210,328` — same-version refusal; app-only recreate.
- `cli/cmd/root.go:35-90,129` — `composeArgs`/`tlsProfileWanted`/`tlsEnabledFromEnv`/`compose`; startup `tlsEnabled`.
- `cli/cmd/guard.go:21,72-109` — `requireRoot`, `classify` REFUSE set, `guardEntry`.
- `cli/cmd/version.go:45-73` — `maybeWarnDualInstall` (pattern to mirror).
- `cli/cmd/status.go` — top-level `status`.
- `cli/internal/selfupdate/run_linux.go:54-56,155` — apt-defer; success line.
- `cli/internal/compose/embed.go` — `//go:embed docker-compose.yml` → `ComposeYAML`.
