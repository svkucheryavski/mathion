# Auto-reconcile on `mathion update` — apply the stack definition inside the upgrade window

**Status:** design (revision 3 — after the second re-gate: codex@high found a
same-tag apply path with no restore boundary + no post-apply gate + an unbounded
restore; both apply paths are now unified through one `applyAndGate`
mini-transaction, the restore is time-bounded, and the §3.2 outage claim is
corrected. Rev 2 folded the rev-1 DO-NOT-SHIP set C1/C2/C3 + I1–I7.)
**Date:** 2026-08-28
**Author:** Sergey Kucheryavskiy (with Claude)
**Area:** Mathion deployment CLI (`cli/`, Go 1.24, cobra)
**Spec builds on:** `2026-08-26-mathion-reconcile-design.md` (the `reconcile`
command, the apply-pending marker, the drift notice) and
`2026-08-27-install-complete-marker-design.md` (the completeness gate).

## 1. Problem

`mathion reconcile` (shipped cli-v0.5.0) gives operators a first-class,
confirmation-gated way to apply this CLI's **embedded** compose
(`compose.ComposeYAML`) to a running deployment, and `status`/`self-update`
surface a **drift notice** when a CLI upgrade changed the stack definition. But
applying that change is still a **manual second step** the operator must
remember. Observed friction (2026-08-26): a `self-update` / `apt upgrade` lands a
new binary whose embedded compose differs (e.g. the HSTS proxy change), and the
running proxy keeps serving the old definition until the operator *separately*
runs `sudo mathion reconcile`. For a non-expert self-hosting audience the upgrade
appears to do nothing.

Reconcile deliberately does **not** auto-run from `self-update`/`apt` (`2026-08-26`
spec §3): a routine tool upgrade must never silently restart the internet-facing
proxy, and `self-update`'s running process is still the **old** binary (it swaps
`/usr/local/bin/mathion` over its own inode — `swap.go:53,251`), so it cannot even
*see* the new embedded compose. That non-goal stands.

What is missing is applying the stack change at the **one** moment an operator has
*already* accepted downtime, a confirmation prompt, and the operation lock:
`mathion update`. Today `update` is image-tag-driven — it recreates only the `app`
service (`update.go:331`, `up -d --wait --pull never app`), never re-materializes
the compose, and on a same-version target **short-circuits with no mutation**
(`update.go:202-213`). So even the operator who *does* run `update` after a CLI
upgrade does not get the new stack definition applied.

## 2. Goal

Make `mathion update` **also apply this CLI's embedded stack definition** when the
on-disk compose has drifted (or a previous reconcile left an apply-pending marker)
— folding the reconcile into the maintenance window `update` already owns — while
preserving update's crash-safety (backup + recovery journal + auto-rollback)
completely intact, and **bounding** the one genuinely new failure surface (a
post-commit apply that does not come up healthy) with a best-effort restore to the
proven pre-apply stack definition. `self-update`/`apt`/standalone `reconcile` and
the drift notice remain the backstop for operators who never run `update`.

## 3. Non-goals & constraints

- **Not** auto-reconcile from `self-update`, `apt`, or an ordinary `start` (the
  old-binary problem, the dpkg-`postinst`-runs-on-fresh-install hazard, and the
  least-surprise argument all stand — reconcile spec §3). Only `update` — an
  explicitly-accepted maintenance command running the new binary's authoritative
  embed — folds the apply in.
- **`guardEntry` marker-gating is out of scope.** The apply-pending marker stays
  advisory (it does not make `start`/`update` refuse); it self-heals because the
  next `update`/`reconcile` re-applies on drift. Making the marker a
  refuse/auto-resume gate is a separate hardening idea, deferred to keep this slice
  focused.
- **Not** a merge of operator hand-edits, **not** an image-tag change beyond what
  `update` already does, **not** an orphan reaper — all inherited from the
  reconcile spec §3.

### 3.1 What is genuinely new vs. pre-existing (reframes the C2 concern)

`mathion update` **already** runs the migration one-off (step 7,
`update.go:306-321`) and the first `app` recreate + strict gate (steps 9–10,
`update.go:331,340`) against **whatever compose is on disk** — i.e. the *old*
compose, when the CLI was upgraded without a subsequent reconcile. **This slice
does not change that.** The migration-under-old-compose and first-app-boot-under-
old-compose behavior is pre-existing and is not a regression introduced here.

The **only** new pre-`success` behavior this slice adds is: after the update has
**committed** (strict gate passed, recovery journal cleared), re-materialize the
**new** compose and run a **whole-project** `up --pull never`, then re-assert the
gate. Everything the review flagged about "the app runs under two composes" that
is *not* new is therefore out of this slice's scope to fix; what *is* new is
bounded by §4.4's restore net.

### 3.2 Standing release rule (Decision A, tightened)

Because the post-commit apply recreates services under the **new** compose against
an **already-migrated** database, a release whose embedded compose is delivered by
auto-reconcile MUST satisfy, for **every** on-disk compose revision a deployment
could be upgrading *from* (deployments may skip releases — adjacency is not
transitive):

1. the target app image's migration runs correctly under the **previous** compose
   (already true today — §3.1); **and**
2. the **new** `app`/`db`/proxy service definitions come up **healthy** against the
   migrated schema and the current `.env`, and the app still resolves to the same
   image the update captured (id `A`) and passes the strict `/version` +
   `127.0.0.1:8000` gate.

In practice both hold for the only changes auto-reconcile is meant to carry —
proxy/header/hardening/network-shape edits that are app-version-independent (the
reconcile spec §3 compatibility rule). A change that alters the app/db service's
*runtime* contract (a new required env, a relocated/stricter healthcheck, a
changed port, image expression, volume, or `depends_on`) must **not** be shipped
as an auto-reconcile deliverable; it rides a dedicated `update`-driven release with
its own migration note. **This is a maintainer/review rule, not a runtime
guarantee** — its enforcement is the same discipline the reconcile spec already
established (and, going forward, is a candidate for a CI compose-lint /
integration test, tracked as a follow-up, not built here).

**The safety net that bounds a rule violation (attempted recovery, not a
guarantee):** if a maintainer violates 3.2 and the post-commit apply does not come
up healthy, §4.4's **best-effort** restore *attempts* to return the deployment to
the **proven-healthy** pre-apply state (old compose + target image, which steps
9–10 already gated), and the DB is never rolled back. The **common** failure (a
broken *new* compose whose services won't come up) is bounded this way: the old,
gate-proven definition comes back and the operator gets exit 2 + a nag to re-apply.
The **residual** — where the restore's own bounded `up` *also* fails — is NOT
masked: it is an honestly-surfaced degraded/partial-outage state, still exit 2 with
a "runtime may be degraded — run `status`, then `reconcile`" message (§4.4, §6). So
restore *bounds*, it does not *eliminate*, the outage risk of a rule violation; the
maintainer/review rule is the primary guard and the restore is the net beneath it.

### 3.3 Recovery-state precedence (corrects the rev-1 "never overlap" claim)

The rev-1 claim that the update **journal** and the apply-pending **marker** can
never coexist was **false**: a marker left by an earlier failed/uncleared
reconcile persists while a fresh `update` writes its journal, so a crash mid-update
leaves *both*. That is safe, but by **precedence**, not by non-overlap:

1. A **journal** is authoritative: `guardEntry` REFUSEs the next stack command
   until restore/manual recovery (`guard.go:92-109`), regardless of any marker.
2. A pre-existing **marker** is advisory *during* the transaction (it does not gate
   anything until the journal is gone).
3. **After** the journal is cleared, the marker (and/or byte drift) again drives
   reconcile/apply on the next `update`/`reconcile`.

The spec asserts this precedence; it does not assert non-overlap.

## 4. Design

### 4.1 Extract a lock-free `applyStack`, and move the marker *clear* to callers

Today the stack-apply steps live inside `App.reconcile` (`reconcile.go:47`), with
the lock taken *around* it by `newReconcileCmd`. `update` already holds
`varlib.Lock` (`update.go:142`); a call into the public `reconcile` would take the
singleton lock a **second** time → `ErrLocked`. Extract the under-lock apply body
into a lock-free method — **and split the marker's lifecycle out of it (C1)** so
the marker survives until the *caller's* final validation:

```go
// applyStack re-materializes the embedded compose and reconciles the running
// project to it. LOCK-FREE: the CALLER holds varlib.Lock, has run the
// install/complete/running/.env gates and the confirmation, has ALREADY WRITTEN
// the apply-pending marker, and CLEARS it itself only after its own final
// validation. Prints readiness itself; the final success line + marker-clear are
// the caller's. Mirrors reconcile.go steps 3 + 6b–6e (NOT 6a/6f).
func (a *App) applyStack(ctx context.Context) error {
    a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)          // step 3: re-derive UNDER the lock, fail-closed
    if err := config.EnsureConfigDir(a.CfgDir); err != nil { return err }
    if err := config.AtomicWrite(composePath(a), composeBytes(), 0o644); err != nil { return err } // 6b
    if a.tlsEnabled {                                    // 6c: TLS-only pinned pre-pull, FATAL on failure
        pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
        err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init")
        pcancel()
        if err != nil { return fmt.Errorf("could not fetch the pinned bundled-proxy image (check connectivity): %w", err) }
    }
    if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never"); err != nil { return err } // 6d whole project
    if a.tlsEnabled { a.reportHTTPSReadiness() }         // 6e
    return nil
}

// clearApplyMarker removes the apply-pending marker; a removal failure is warn-only
// (a healthy apply is not failed by it — reconcile spec §4.1 step 6f). The message
// PRESERVES the substring "could not clear the apply-pending marker" that
// reconcile_test.go:338 asserts (the message is now shared with update, so the
// verbatim reconcile.go:117 sentence can't be kept, but the asserted substring is).
func (a *App) clearApplyMarker() {
    if err := removeMarkerFn(); err != nil {
        fmt.Fprintf(a.Err, "warning: the stack was applied but could not clear the apply-pending marker at %s (%v); `mathion status` may show a spurious drift notice until the next reconcile\n", varlib.MarkerPath(), err)
    }
}
```

`App.reconcile` is refactored to: gates → running-app → drift-read + confirm →
`varlib.WriteMarker()` → `applyStack(ctx)` → (on success) `clearApplyMarker()` →
its own `"reconciled to this CLI's stack definition (<buildVersion>)…"` line. **No
observable behavior change to `reconcile`** — the marker is still written before
mutation and cleared only after a successful `up`; its existing test suite
(including `reconcile_test.go:202-203`, "marker cleared after success") is the
regression tripwire. `composePath(a)` is a tiny helper =
`filepath.Join(a.CfgDir, "docker-compose.yml")`.

### 4.2 `--no-reconcile` flag; separate drift signals

```go
type updateOpts struct { Version string; NoRollback bool; Yes bool; NoReconcile bool }
```

`--no-reconcile` performs **only** the image upgrade and skips the stack apply, for
an operator deferring the stack change to a separate window.

Compute the drift signal from **three separate values** (I4 — do not collapse
"absent" and "differs"):

```go
onDisk, readErr := os.ReadFile(composePath(a))
composeDiffers := readErr != nil || !bytes.Equal(onDisk, compose.ComposeYAML) // a read error ⇒ treat as differs (re-materialize)
markerPresent, _ := varlib.MarkerPresent()                                    // read error ⇒ absent (fail-quiet)
drift := composeDiffers || markerPresent
wantApply := drift && !opts.NoReconcile
```

When `--no-reconcile` suppresses an apply, `update` prints a **dedicated** pending
reminder computed from these already-known values — **not** `maybeWarnComposeDrift`,
whose "absent compose ⇒ silent" policy (`version.go:106-119`) is wrong for a
command that has proven the deployment is installed:

```go
if opts.NoReconcile && drift {
    fmt.Fprintln(a.Out, "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile")
}
```

### 4.3 `runUpdate` integration

After step 1 (`ValidateEnvComplete` the `.env` → `oldTag`) **and the new `.env`
file-type/permission gate (§4.6)**, compute `composeDiffers`/`markerPresent`/
`drift`/`wantApply` (§4.2), then resolve `target`.

Both apply paths — same-tag and real-upgrade — funnel through the **single**
`applyAndGate` mini-transaction (§4.4), so neither can leave a broken new compose
installed without an attempted restore (NEW-CRITICAL, rev 3), and both re-assert a
strict gate after the apply (NEW-IMPORTANT, rev 3). They differ only in the gate
image id (real-upgrade: the pulled target id `A`; same-tag: the currently-running
app image id) and in the exit code of a post-apply failure (real-upgrade committed
⇒ `committedPendingError`/exit 2; same-tag nothing committed ⇒ plain exit 1).

**Same-tag branch** (`target == oldTag`, replacing `update.go:202-213`) — a
CLI-only / compose-only release. `probeVersionOnce` is used **only** in the
non-apply path (for today's messages); in the apply path the **post-apply strict
gate** — not a stale pre-apply probe (NEW-IMPORTANT, rev 3) — decides success. The
confirm/notice wording keys on **`composeDiffers`, not `wantApply`** (M1/M2):

```go
if target == oldTag {
    if wantApply {
        if !a.appRunning(ctx) {
            return errors.New("this release's stack definition needs applying, but the stack is not running; start it with `sudo mathion start`, then `sudo mathion reconcile` (or re-run update)")
        }
        if !opts.Yes {
            msg := "a previous stack apply did not finish; re-apply this CLI's stack definition now?"
            if composeDiffers { msg = "this release updates the stack definition; apply it now?" }
            fmt.Fprintf(a.Out, "%s any changed service is briefly recreated (an HTTPS interruption if the bundled proxy changed). Continue? [y/N] ", msg)
            line, _ := bufio.NewReader(a.In).ReadString('\n')
            if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
                return errors.New("update cancelled")
            }
        }
        // Capture the RUNNING app image id BEFORE apply (target==active pin, image
        // already present locally). A moved local tag would make this id disagree
        // with what the post-apply gate resolves → gate fails → restore (NEW-IMPORTANT).
        stID, err := runningAppImageID(ctx, a)   // image inspect ImageRepo:target --format {{.Id}}
        if err != nil { return err }             // app running but id unresolvable → abort, nothing mutated
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
    // wantApply false: the EXISTING messages, unchanged (probe drives them)…
    pass, _, _ := probeVersionOnce(ctx, target, true)
    if pass { fmt.Fprintf(a.Out, "already at %s; nothing to do\n", target) } else { /* existing broken-deployment message */ }
    if opts.NoReconcile && drift { /* dedicated pending reminder (§4.2) */ }
    return nil
}
```

Note the same-tag apply failure returns a **plain error (exit 1)**, not
`committedPendingError` — nothing was committed (no pull/migrate/repin happened on
a same-tag run), so exit 2's "commit completed" meaning would be wrong. The restore
net still applies.

**Real-upgrade branch** (`target != oldTag`) — the existing transaction runs
**unchanged** through the commit point. Two edits: (1) the confirm plan
(`update.go:216-228`) gains a line **only when `composeDiffers`**: *"This release
also updates the stack definition; it is applied after the update completes (brief
HTTPS interruption if the bundled proxy changed)."* (2) the post-commit apply,
inserted **after** `RemoveJournal()` succeeds (see §4.4 for the failure-of-
`RemoveJournal` fold) and before the final success print:

```go
// …strict gate passed (commit) → RemoveJournal() succeeded (journal cleared)…
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
if opts.NoReconcile && drift { /* dedicated pending reminder (§4.2) */ }
fmt.Fprintf(a.Out, "updated %s → %s (backup: %s; prune old backups manually)\n", oldTag, target, backupPath)
return nil
```

**Ordering rationale (unchanged from rev 1, and why post-commit).** The apply is
strictly *after* the migration is proven and the recovery journal cleared, so the
two recovery mechanisms never compete (§3.3 precedence) and a stack-apply failure
can never rewind a migrated database. The cost — a *second* app recreate if (and
only if) the new compose changed the `app` service — is bounded by §3.2 (that
change shouldn't ride auto-reconcile) and by §4.4 (restore net).

### 4.4 `applyAndGate`: the shared, marker-guarded, restore-bounded mini-transaction

Both apply sites call ONE helper. It is the only new failure surface, NEVER rolls
back the database, and NEVER calls `updateFailure`/`restoreEngine`. It returns
`(restored bool, err error)`: on success `err==nil`; on failure `err` is the apply
or gate error and `restored` says whether the best-effort restore's own `up`
succeeded, so each caller can word its outcome and pick its exit code (§4.3).

```go
// applyAndGate writes the marker, materializes+brings up the NEW compose, re-asserts
// the strict gate against gateID, and clears the marker ONLY after the gate passes.
// On ANY failure it best-effort restores prev and RETAINS the marker. Lock-free
// (caller holds varlib.Lock). gateID = the pulled target id A (real upgrade) or the
// running app image id (same-tag).
func (a *App) applyAndGate(ctx context.Context, prev []byte, gateID, target string) (restored bool, err error) {
    if e := varlib.WriteMarker(); e != nil {
        // Compose untouched, app unchanged. restored=true means "prior state intact,
        // nothing to restore" — callers word this as "the previous definition is in
        // place", accurate for BOTH this branch and a successful restore below.
        return true, fmt.Errorf("could not record the pending stack apply: %w", e)
    }
    e := a.applyStack(ctx)                 // materialize NEW compose + pinned pre-pull + whole-project up --wait
    if e == nil {
        e = gateFn(ctx, a, gateID, target, true) // re-assert: running app image == gateID AND /version == target
    }
    if e != nil {
        return restorePrevCompose(ctx, a, prev), e // marker RETAINED (prev≠embed AND marker drive self-heal)
    }
    a.clearApplyMarker()                   // success: marker cleared ONLY now, AFTER the gate
    return false, nil
}

// restorePrevCompose best-effort returns the deployment to its pre-apply, already-
// gate-proven stack definition (prev bytes + the committed image). Bounded by a
// dedicated deadline AND `--wait-timeout` (NEW-IMPORTANT, rev 3) so a wedged restore
// cannot hang forever holding the operation lock; WithoutCancel so a late operator
// signal cannot abort the recovery, but the deadline still bounds it. Guards an empty
// prev (a §4.2 read error) — writing 0 bytes would be strictly worse than leaving
// what's there (Opus minor 4).
func restorePrevCompose(ctx context.Context, a *App, prev []byte) bool {
    if len(prev) == 0 { return false }
    if err := config.AtomicWrite(composePath(a), prev, 0o644); err != nil { return false }
    a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)
    rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), restoreWaitTimeout)
    defer cancel()
    return a.compose(rctx, "up", "-d", "--wait", "--wait-timeout", restoreWaitTimeoutSecs, "--pull", "never") == nil
}

// runningAppImageID resolves the image id of the RUNNING app CONTAINER — not a
// re-inspection of the ImageRepo:<pin> tag, which would already reflect an
// out-of-band tag move and defeat the whole point of a pre-apply anchor
// (NEW-IMPORTANT, rev-3 re-gate). Uses the exact `compose ps -q app` →
// `docker inspect <cid> --format {{.Image}}` mechanism the gate already uses
// (gate.go:44-53) and probeImageID's container branch (backup.go:257-258); errors
// out (does NOT fall back to the tag) so a same-tag run without a resolvable running
// image aborts before mutating anything.
func runningAppImageID(ctx context.Context, a *App) (string, error) {
    cout, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
    if err != nil { return "", fmt.Errorf("resolving the running app container: %w", err) }
    cid := strings.TrimSpace(cout)
    if cid == "" { return "", errors.New("no running app container") }
    raw, err := a.Runner.Output(ctx, "inspect", cid, "--format", "{{.Image}}")
    if err != nil { return "", fmt.Errorf("inspecting the running app image: %w", err) }
    id := strings.TrimSpace(raw)
    if id == "" { return "", errors.New("running app container has no image id") }
    return id, nil
}
```

`restoreWaitTimeout` is a small package const (e.g. 120s) and `restoreWaitTimeoutSecs`
its integer-seconds string for `--wait-timeout`. Capturing the container's `.Image`
before the apply and re-asserting it after means a compose change that leaves `app`
untouched keeps the same id (gate passes), while a moved local tag that recreates
`app` to a different image is caught by the post-apply gate → restore.

**Why restore is safe and sufficient (C3).** Real upgrade: steps 9–10 already
proved *(old compose + target image)* healthy and serving `target` before the apply,
and `prev` == the exact on-disk bytes read at §4.2 (nothing rewrites the compose
between that read and the apply), so restoring `prev` + `up` returns to that
**gate-proven** state (`MATHION_VERSION` stays `target`, committed at step 8). The
real-upgrade restored-message may therefore say "serving the previous stack
definition". Same-tag: there was no pre-apply strict gate, so its restored-message
claims only that the stack is **running** (`up --wait` = `/health`), not a `/version`
guarantee. In BOTH cases the "restore also failed" branch says "runtime may be
degraded". Residual (documented, out of scope, identical to reconcile spec §4.3): if
the operator **independently** moved the local `app`/`db` tag, restore cannot un-move
it — that predates and is orthogonal to this slice.

**`committedPendingError` and the exit-code fold (I6).** Rename the outcome type so
it covers *every* post-commit "the DB/image commit completed but required
post-commit work/verification remains" case — including the **existing**
`RemoveJournal`-after-success failure (`update.go:347-350`), which today
misleadingly maps to exit 1:

```go
// committedPendingError: the image/DB update COMMITTED and the DB must NOT be rolled
// back, but required post-commit work (clear the recovery journal, or apply/verify
// the stack definition) did not finish. Exit 2 — distinct from 0 (fully done),
// 1 (failed; may have rolled back), 3 (rollback ALSO failed).
type committedPendingError struct{ err error }
func (e committedPendingError) Error() string { return e.err.Error() }
func (e committedPendingError) Unwrap() error  { return e.err }

func exitCode(err error) int {
    if err == nil { return 0 }
    var rbf rollbackFailedError
    if errors.As(err, &rbf) { return 3 }
    var cpe committedPendingError
    if errors.As(err, &cpe) { return 2 }
    return 1
}
```

The post-commit `RemoveJournal`-failure return (`update.go:348-350`) is wrapped in
`committedPendingError` so it becomes exit 2 with a consistent meaning. Exit 2 is
**never** defined as "the app is currently serving" — only as "commit completed;
post-commit work/verification remains." Documented in README + `--help`.

### 4.5 Marker / drift self-heal (corrected)

- The marker is written by `applyAndGate` before the apply and cleared **only after
  its strict gate passes** (§4.4). A failed apply or failed gate — on **either** the
  same-tag or the real-upgrade path — therefore **retains** it, and
  `restorePrevCompose` also leaves the on-disk compose (`prev`) ≠ embed, so **both**
  `markerPresent` and `composeDiffers` make the next `update`/`reconcile` re-apply —
  self-healing, and no longer dependent on a single signal.
- Self-heal is not "any later update": it happens on the next `update` **that
  targets the same or a drift-bearing state** or on `reconcile`. The exit-2 message
  therefore says *"re-apply with `sudo mathion reconcile`"* (deterministic) rather
  than "the next update will fix it" (I3 — a later `--version`-pinned update could
  do a different image transaction).
- `--no-reconcile` + drift emits the dedicated pending reminder (§4.2), which fires
  even when the compose file is unreadable/absent (I4).

### 4.6 `.env` file-type + permission parity gate (I2/M3)

Before the same-tag apply and before the real-upgrade transaction, `update` must
run the same **regular-file + owner-only** `.env` check `reconcile` gets via
`requireInstalledDeployment` (`tls.go:242-246`: reject a non-regular `.env`, reject
`perm&0o077 != 0`). Today `update` does only `ReadEnvFile` + `ValidateEnvComplete`
(value validation), so `update`+`applyStack` would bring the stack up (now
including the profile-gated proxy) over a group/world-accessible `.env` that
`reconcile` refuses. Add the check to the update preamble (a small shared helper,
e.g. `requirePrivateEnv(cfgDir)`, extracted from `requireInstalledDeployment` and
called by both). **Honest bound:** this closes the static case; a root-level
out-of-band `.env` rewrite *after* validation but *before* Compose re-reads
`--env-file` is a TOCTOU inherent to every compose command (reconcile spec §4.2)
and is documented, not claimed prevented.

### 4.7 Gates satisfied at each apply site

- **reconcile command:** unchanged — `lockAndGuard` → `requireInstalledDeployment`
  → `requireInstallComplete` → running-app → confirm → marker → `applyStack` →
  `clearApplyMarker`.
- **update (both branches):** `newUpdateCmd` preamble did root + lock + sweeps +
  `guardEntry` + `requireInstallComplete` (`update.go:136-158`); `runUpdate` step 1
  did `ValidateEnvComplete` **plus the new `requirePrivateEnv` check (§4.6)**;
  same-tag adds an explicit `appRunning` check; real-upgrade reaches the apply only
  post-commit with the app freshly gated. No double-lock (`applyStack` is
  lock-free; the single `varlib.Lock` from `newUpdateCmd` is held across the whole
  run incl. the post-commit apply and is released by the existing `defer`).

## 5. Security considerations

- **No new trust surface.** The apply writes the same reviewed embedded compose
  `install`/`tls enable`/`reconcile` already write, via the same `composeArgs`
  path. No new unpinned image (the TLS-only pinned-proxy pre-pull is the reviewed
  digest); no new privilege.
- **Fail-closed against `.env` poisoning, now in three layers:** `runUpdate` step 1
  `ValidateEnvComplete` (value poisoning) aborts before any mutation; the new
  `requirePrivateEnv` (§4.6) rejects a group/world-accessible `.env` before the
  apply, matching reconcile; and `applyStack` re-derives `a.tlsEnabled =
  tlsEnabledFromEnv(a.CfgDir)` **under the lock**, so `--profile tls` is never added
  over an incomplete/interpolation-bearing `.env`. The proxy declares no `env_file`
  (`docker-compose.yml:60`) and ambient `COMPOSE_PROFILES`/`MATHION_TLS_*` are
  stripped from the child env, so no DB secret can reach the proxy env. The residual
  root-level out-of-band TOCTOU (§4.6) is documented, not claimed prevented.
- **HTTPS-only is never downgraded.** Neither `applyStack` nor `restorePrevCompose`
  touches `.env`; they only recreate containers to match a compose.
- **Concurrency.** `update` holds `varlib.Lock` across the whole run including the
  post-commit apply and the restore, serializing them against
  reconcile/backup/restore/tls; the re-derive-under-lock closes the pre-lock
  stale-read window.

## 6. Error handling & exit codes (summary)

| Situation | Outcome | Exit |
|---|---|---|
| Real upgrade + apply both succeed (post-apply gate passes) | success line | 0 |
| Same-tag apply succeeds (post-apply gate passes) | "applied this CLI's stack definition" | 0 |
| Pre-commit update failure (pull/stop/backup/journal/migrate/gate) | existing matrix (auto-rollback / refuse / `--no-rollback`) — **unchanged** | 1 (or 3 if rollback also failed) |
| **Real-upgrade** apply or post-apply gate fails, previous compose **restored** | `committedPendingError`: serving previous definition, DB intact, marker left, "re-apply with reconcile" | **2** |
| Real-upgrade apply fails AND restore also fails | `committedPendingError`: DB committed, runtime may be degraded, "status → reconcile" | **2** |
| Post-commit `RemoveJournal` fails (existing case, re-folded) | `committedPendingError`: healthy, clear the breadcrumb | **2** |
| **Same-tag** apply or post-apply gate fails, previous compose **restored** | plain error: stack running on previous definition, "retry with reconcile" (nothing committed) | 1 |
| Same-tag apply fails AND restore also fails | plain error: runtime may be degraded, "status → reconcile" | 1 |
| Same-tag, drift, stack not running | refuse with `start` guidance, no apply | 1 |

The lock is released on every path via the existing `defer` in `newUpdateCmd`.

## 7. Testing (hermetic, `compose.FakeRunner`)

**Fixture migration (I7 — do this FIRST, it is a precondition for every other
test).** Existing `cmd/update_test.go` cases drive `runUpdate` via
`setupRestoreEnv`, which seeds `.env` + varlib state but **no `docker-compose.yml`**
— so under the new `composeDiffers` signal every existing fixture is "drifted" and
would silently change branch. Add an update-specific helper (e.g.
`setupUpdateEnv(t)` = `setupRestoreEnv` + `config.AtomicWrite(composePath,
compose.ComposeYAML, 0o644)`) and migrate every existing update test to it so they
are **non-drifted** by default; drift tests overwrite the compose (or write the
marker) **explicitly**. Restore-engine fixtures keep `setupRestoreEnv` unchanged.

**`applyStack` extraction — regression (`cmd/reconcile_test.go`):**
1. The **entire existing `reconcile` suite passes unchanged** (marker written
   before mutation, cleared after a successful `up`, left after a failed `up`) —
   the proof the marker-lifecycle split is behavior-preserving for reconcile.

**`update` real-upgrade (`cmd/update_test.go`):**
2. **drift → post-commit apply:** compose drifted → full transaction, then a
   **whole-project** `up -d --wait --pull never` appears in `Calls` **after** the
   app-only recreate and the first gate; on-disk compose == embed afterward;
   `gateFn` invoked a **second** time; marker cleared (absent) on success.
   TLS-enabled fixture also shows `pull --policy missing proxy proxy-init` first.
3. **no drift → no apply:** compose == embed, no marker → **no** second whole-
   project `up`, `gateFn` once, output identical to today.
4. **post-commit apply failure → restore + isolation (load-bearing):** a
   `FakeRunner` that fails the **apply** whole-project `up` (by invocation count —
   the apply `up` and the restore `up` share identical args, so discriminate on
   *which* call, Opus minor 3) → `applyAndGate` returns `(restored=true, err)`;
   `runUpdate` returns a `committedPendingError` (`exitCode`==2); the **on-disk
   compose == `prev`** afterward (the clean proof restore ran — not arg-matching);
   the restoring `up` carries `--wait-timeout`; **no** `updateFailure`/
   `restoreEngine`/backup-restore call is in `Calls`; the recovery **journal is
   absent** (cleared pre-apply); the apply-pending **marker is present**.
5. **re-assert gate failure → same as (4):** apply `up` succeeds but the post-apply
   `gateFn` errors → `committedPendingError` (exit 2), on-disk compose == `prev`
   (restored), no rollback, marker present.
6. **restore also fails:** apply `up` fails AND the restoring `up` fails →
   `applyAndGate` returns `(restored=false, err)` → `committedPendingError` (exit 2)
   with the "runtime may be degraded" message; marker present.
7. **`--no-reconcile` + drift:** no `applyAndGate` (no second whole-project `up`);
   run succeeds (exit 0); the **dedicated** pending reminder is printed (assert the
   exact line, and that it fires even with a fixture whose compose file is
   **absent/unreadable**); on-disk compose unchanged.
8. **`RemoveJournal`-failure re-fold:** the existing post-commit `RemoveJournal`
   failure now returns `committedPendingError` → `exitCode`==2 (was 1).

**`update` same-tag (`cmd/update_test.go`):**
9. **same-tag + drift + running + gate passes:** `runningAppImageID` is resolved,
   then `applyAndGate` runs (compose re-materialized, whole-project `up`, post-apply
   `gateFn` against the captured id) with **no** `pull <target>`/`stop app`/backup/
   migrate in `Calls`; success line printed; marker cleared; **exit 0**.
10. **same-tag + drift + post-apply gate fails → restore, plain exit 1:** the
    same-tag `gateFn` errors (e.g. moved local tag / `/version` mismatch) →
    `applyAndGate` returns `(restored=true, err)`; `runUpdate` returns a **plain
    error** (`exitCode`==**1**, NOT 2 — nothing committed) with the "previous
    definition restored; retry with reconcile" message; on-disk compose == `prev`;
    marker present. (This replaces rev-2's stale-probe NOTE — the post-apply gate,
    not a pre-apply probe, now decides, NEW-IMPORTANT.)
11. **same-tag + drift + app not running:** refuses with `start` guidance; no
    `runningAppImageID`, no compose write, no `up`, no marker.
12. **same-tag + no drift:** unchanged existing `probeVersionOnce`-driven messages;
    no apply.
13. **stale-marker-only wording:** marker present but compose bytes == embed → the
    confirm does **not** claim "this release updates the stack definition" (keyed on
    `composeDiffers`, M1/M2).

**`.env` parity + exit mapping:**
14. `requirePrivateEnv`: `update` refuses (no `up`, no apply) on a non-regular or
    `perm&0o077 != 0` `.env`, matching `reconcile`; assert the **exact** loose-perm
    message is unchanged from `requireInstalledDeployment` (Opus minor 2 — the
    extraction must not reword it) (I2/M3).
15. `exitCode`: `committedPendingError`→2, nil→0, `rollbackFailedError`→3, else 1.

**Discrimination.** The isolation tests (4/5/6) key on the concrete
`committedPendingError` type **and** the absence of any rollback/restore-engine call
**and** on-disk compose == `prev` (bare `err != nil`, or arg-matching an `up` that
both apply and restore emit identically, would false-pass); (3) keys on the
**absence** of the second whole-project `up`; (9) keys on the absence of
`pull <target>`/`stop app`; (10) keys on `exitCode`==1 (not 2) to prove the
same-tag path never mints a false "committed" signal.

**Coverage bound (honest, I7).** `compose.FakeRunner` records args; it cannot prove
real image-selection or service-recreation semantics (e.g. that `--pull never`
recreates app from the same image id `A`). One on-host smoke — a real cli-vX→Y
`update` where the release drifted the proxy compose, asserting the proxy is
recreated and HTTPS re-verifies — is the integration check and is listed in the
plan's on-host verification step (not automated in CI).

## 8. Files

- **Modify `cli/cmd/reconcile.go`:** extract `applyStack(ctx)` (core, no marker)
  and `clearApplyMarker()`; refactor `App.reconcile` to write the marker, call
  `applyStack`, then `clearApplyMarker` on success; add `composePath(a)`.
- **Modify `cli/cmd/update.go`:** add `NoReconcile` to `updateOpts` +
  `--no-reconcile`; add `committedPendingError` + the exit-2 arm and fold the
  post-commit `RemoveJournal`-failure into it; compute the separate compose signals
  after step 1; add `applyAndGate`, `restorePrevCompose` (bounded by
  `restoreWaitTimeout`/`--wait-timeout`, empty-`prev` guard) and `runningAppImageID`;
  wire the same-tag apply branch (capture id → `applyAndGate` → plain exit 1 on
  failure) and the real-upgrade post-commit apply (exit 2); augment the confirm plan
  (keyed on `composeDiffers`); add the `--no-reconcile` reminder; add
  `import "bytes"` (M5). `applyStack`/`clearApplyMarker`/`composePath` live in
  `reconcile.go` (same package).
- **Modify `cli/cmd/tls.go` (or a new small file):** extract `requirePrivateEnv`
  from `requireInstalledDeployment` **preserving the exact error strings/order**
  (Opus minor 2 — reconcile/tls tests assert them) so `update` (§4.6) and
  `reconcile` share it and no reconcile/tls behavior shifts.
- **Modify tests:** `cli/cmd/update_test.go` (fixture migration + cases 2–15);
  `cli/cmd/reconcile_test.go` (regression). No `varlib` changes — the marker
  helpers, `removeMarkerFn`, `gateFn`, and `probeVersionOnce` all exist.
- **Docs:** README "Upgrading" — a `mathion update` also applies this release's
  stack definition; `--no-reconcile` defers it; **same-tag `update --yes` now
  applies a drifted compose (a formerly no-op call can recreate the proxy → brief
  HTTPS blip)** (Opus I2); exit code 2 = "committed; post-commit work/verification
  pending — re-run `sudo mathion reconcile`" (a real-upgrade apply that couldn't be
  applied but whose image/DB update committed); exit 1 covers a same-tag apply that
  failed after restore (nothing committed).

## 9. References (verified against the tree at `8151389`)

- `cli/cmd/reconcile.go:47-123` — `App.reconcile` (extraction source); `:59` TLS
  re-derive; `:85` marker write; `:93` compose write; `:97-105` pinned pre-pull;
  `:107` whole-project `up`; `:112` readiness; `:116-119` warn-only marker clear;
  `:121` report; `:128-131` `appRunning`; `:21` `removeMarkerFn` seam.
- `cli/cmd/update.go:44-55` — `exitCode` (0/3/1) to extend; `:86-89`
  `updateFailMeta`; `:102-120` `updateFailure` (must NOT be reached post-commit);
  `:128-168` `newUpdateCmd` preamble; `:177-353` `runUpdate`; `:182-189` step 1 env
  validate → `oldTag`; `:195-213` same-tag short-circuit + `probeVersionOnce`
  (`:206`); `:216-228` confirm plan; `:306-321` migrate under on-disk compose (§3.1);
  `:331` app-only recreate; `:340` strict gate (`gateFn`); `:347-352` `RemoveJournal`
  + success print.
- `cli/cmd/gate.go:42` — `gateImageAndVersion(ctx, a, targetID, targetVersion,
  strictVersion)`; `cli/cmd/restore.go:109` — `var gateFn = gateImageAndVersion`.
- `cli/cmd/gate.go:44-53` + `cli/cmd/backup.go:257-258` (`probeImageID` container
  branch) — the `compose ps -q app` → `inspect <cid> --format {{.Image}}` mechanism
  `runningAppImageID` reuses to anchor on the RUNNING container's image (NOT the tag).
  `docker compose up --wait-timeout` bounds the restore (Compose flag; new to the tree).
- `cli/cmd/version.go:66-80` — `composeDrifted`; `:99-119` — `maybeWarnComposeDrift`
  (`:106-119`; marker read `:114`) — the status helper, deliberately **not** reused
  on the update path (I4).
- `cli/cmd/status.go:29-30` — passive notices (unchanged backstop).
- `cli/cmd/root.go:26,33` `buildVersion`/`SetBuildInfo`; `:113-118` command
  registration; `:122-134` `Execute` → `osExit(exitCode(err))`.
- `cli/cmd/guard.go:34` `lockAndGuard`; `:72-79` `classify` REFUSE set (already lists
  `"update"`, `"reconcile"`); `:92-109` `guardEntry`.
- `cli/cmd/tls.go:234-246` — `requireInstalledDeployment` incl. the regular-file
  (`:242-243`) + owner-only (`:245-246`) `.env` gate to share via `requirePrivateEnv`.
- `cli/internal/varlib` — `WriteMarker`/`RemoveMarker`/`MarkerPresent`/`MarkerPath`
  (apply-pending marker); `Lock`/`RemoveJournal` (update recovery).
- `cli/internal/compose/docker-compose.yml:4-5,25,60` — mutable `app`/`db` tags vs
  digest-pinned proxy; proxy has no `env_file` (fail-closed TLS invariant).
- `cli/cmd/restore_test.go:241` — `setupRestoreEnv` (fixture to fork for
  `setupUpdateEnv`, I7); `cli/cmd/update_test.go:35` — existing same-tag test.
- `cli/internal/selfupdate/run_linux.go:155-163`; `swap.go:53,251` — self-update
  nudge + old-inode rationale (why self-update is NOT an apply site).
- Prior specs: `docs/superpowers/specs/2026-08-26-mathion-reconcile-design.md`
  (§4.1 apply steps, §4.2 fail-closed TLS, §4.3 image residual, §5 drift notice, §3
  compatibility rule); `docs/superpowers/specs/2026-08-27-install-complete-marker-design.md`
  (`requireInstallComplete`).
