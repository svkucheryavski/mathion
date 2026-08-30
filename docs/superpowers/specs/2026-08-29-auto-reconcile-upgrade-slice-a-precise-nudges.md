# Auto-reconcile-on-upgrade — Slice A: precise, everywhere-reaching drift nudges

**Status:** design (converged after three review rounds — 3 Opus + codex each; round-3 codex Critical `timeout --kill-after` folded)
**Date:** 2026-08-29
**Epic:** auto-reconcile-on-upgrade (the still-open follow-up from `mathion reconcile` / auto-reconcile-on-*update*). Target end-state = codex's "Option 1R": consent-gated auto-apply on the interactive `self-update` path + a precise, persistent drift warning everywhere; `--yes` stays binary-only, a new `--apply-stack` flag is the automation opt-in; apt never auto-applies. Delivered in **two slices**:
- **Slice A (this doc):** make the drift signal *precise* (fires only on a real stack change) and route it to the upgrade channels — **no container is ever touched, no Docker is ever run, no lock is ever taken**.
- **Slice B (future, separate spec):** consent-gated auto-apply on `self-update` via a re-exec continuation (`--apply-stack`, exit-2 "committed/pending", best-effort compose rollback, bounded `up`). Byte-precise nudging **at the self-update moment itself** is also Slice B (it needs the new binary to run).

## Goal & delivered outcome (precise)

After a CLI release that changes the embedded compose, the operator must currently *remember* to run `sudo mathion reconcile`. Two things go wrong today:

1. **`self-update` cries wolf.** Its post-swap line (`run_linux.go:162`) is **unconditional** — it always says "apply it with: sudo mathion reconcile" even when the new release's compose is byte-identical (observed live on 0.6.0→0.7.0). Root cause: the still-running *old* binary can't byte-compare its now-stale embedded compose.
2. **apt is silent.** The `.deb` postinstall (`deploy/deb/postinst.sh`) says nothing about stack drift.

**What Slice A delivers (stated precisely, not overclaimed):**
- **Precise detection at apt-upgrade time** — the `.deb` postinstall runs a bounded, file-only drift probe (the just-unpacked new binary) and prints the drift line when the on-disk compose (its bytes readable) differs from the new binary's embed, **or** an apply-pending marker exists — the existing `maybeWarnComposeDrift` precedence: a pending marker warns even when the bytes match, and an absent/unreadable/non-regular compose is fail-quiet on the bytes (§5 governs; not an unconditional "iff").
- **Precise detection on the next non-excluded `sudo mathion` management command after ANY upgrade** (self-update, apt, or re-running `install.sh`) — a root pre-run hook prints the precise drift line before the command runs, and stays silent when nothing changed. This kills the false positive. ("Non-excluded" matters: `version --short`, `help`, `completion`, `install`, `update`, `uninstall`, `reconcile`, and `self-update` itself are excluded — §4.1 — so the note appears on the operator's next ordinary management command, e.g. `sudo mathion status`.)
- **`self-update` stops crying wolf** — its own immediate line becomes honest/neutral (it does **not** byte-compare — the running old binary can't; §4.2). It does not itself become byte-precise; that is Slice B.

Slice A does **not** run Docker, mutate a container, take a lock, or restart the proxy anywhere.

## Non-goals (this slice)

- **No auto-apply.** Slice A only detects + reports.
- **No re-exec / new-binary invocation from `self-update` or `install.sh`.** Slice A never runs the newly installed binary to gain immediate precision; that (and the apply) is Slice B. (The apt probe runs the new binary, but only because dpkg has already unpacked it, and that path is a bounded, file-only, non-cobra fast-path — §4.3.)
- **No `--apply-stack`, no exit-2, no compose rollback, no bounded `up`** — all Slice B.
- **No systemd/apt-hook background apply (Option 3)** — rejected; relocating an unconsented proxy restart still violates the invariant.
- **Not in scope:** hardening the pre-existing unbounded `.env` read in `Execute()` (`root.go:129`). It affects only interactive commands (Ctrl-C-able) and is bypassed entirely by the dpkg probe path; Slice A neither relies on nor worsens it (see §4.3a).

## Global constraints (carried + corrected)

- **Never restart the internet-facing proxy without operator consent; never run Docker from apt's non-interactive postinstall.** Slice A honors this trivially — it runs no Docker.
- **The apt postinstall must not wedge dpkg** (bounded except for the documented D-state residual below) — no size-unbounded read, no explicit unbounded wait. The probe call is wall-clock-bounded by `timeout --kill-after=1s 5s` (plain `timeout` only sends `SIGTERM` and would wait forever on a child that ignores it — the round-3 Critical; `--kill-after` escalates to `SIGKILL`) and floored by `|| true` + the existing `exit 0` (§4.3b). The one residual — a process stuck in an uninterruptible `D` state on a broken *local-root* filesystem, which even `SIGKILL` cannot reap — is an accepted, out-of-scope failure (under it dpkg and the whole host are already non-functional); we deliberately do **not** detach the probe, because the notice must appear inline in `apt` output to be seen (§4.3b note).
- **Drift detection is effective in a root context.** On a **default managed install**, `config.EnsureConfigDir` creates `/etc/mathion` `0o700` (`state.go:71`) and `varlib.Root()` (`/var/lib/mathion`) is `0o700`, so a non-root process cannot traverse them; non-root drift reads fail → the surface stays **silent (fail-quiet, never a false claim)**. This is acceptable: deployment-management commands run under `sudo`. Caveats (do not over-state root-only): `EnsureConfigDir` *accepts* a pre-existing dir at another mode (e.g. `0755`), not every command hard-enforces root, and `sudo` does not necessarily preserve `MATHION_CONFIG_DIR`. All operator-facing hints therefore say **`sudo mathion …`**, and the custom-`MATHION_CONFIG_DIR` case is treated as best-effort (§4.3b note).
- Go 1.24; cobra 1.8.1; module `github.com/svkucheryavski/mathion/cli`. On-disk compose `/etc/mathion/docker-compose.yml` (honors `MATHION_CONFIG_DIR`), written `0644` by `applyStack` inside the `0700` dir.
- `deploy/**` shell is shellcheck-gated in CI (`ci.yml` `apt-scripts` job, unpinned `ubuntu-latest` shellcheck); avoid the `A && B || C` SC2015 shape (prior `2cea74c` regression).
- Commit trailer, EXACT: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Background — what already exists (verified against the tree)

- **`composeDrifted(cfgDir) (drifted, present bool)`** — `cmd/version.go:71`. Byte-compares on-disk `docker-compose.yml` vs `compose.ComposeYAML` via **unbounded** `os.ReadFile`. Slice A **hardens this one function** (§4.3a): non-blocking open + `fstat` on the opened fd + bounded read. Its `(drifted, present)` contract is preserved.
- **`maybeWarnComposeDrift(w, cfgDir)`** — `cmd/version.go:106`. The precise notice; precedence: (1) compose absent → silent; (2) else warn if marker present OR bytes differ; (3) any read error / non-regular file → fail-quiet on the *bytes*, but the **marker is still consulted** (a `present`-but-unreadable compose + a pending marker still warns — matching the existing branch at `version.go:110-118`). Wired into **`status` only** today (`status.go:30`, `app.Out`); no other non-test caller (verified). Because Slice A hardens `composeDrifted`, this function becomes **FIFO-safe and byte-bounded** (no unbounded read on any surface) and is **reused by every surface** (pre-run, `status`, probe) — no duplicated string. (It is not *wall-clock*-bounded against a broken filesystem mount, where path lookup / `open` / `fstat` / a regular-file read can still stall — Linux ignores `O_NONBLOCK` for regular files; that residual is bounded only where it matters for dpkg, by the postinstall `timeout` — §4.3b. The interactive surface's residual matches the pre-existing `.env` read below and is out of scope.)
- **`drift_test.go`** already defines a test const `driftNote` mirroring the message and calls `maybeWarnComposeDrift` directly (5 tests) — unaffected by removing `status.go:30`.
- **`Execute()`** (`root.go:122`) runs `app.tlsEnabled = tlsEnabledFromEnv(app.CfgDir)` unconditionally (`root.go:129`) — an unbounded `.env` read on every *cobra* invocation. The probe path avoids this by not going through `Execute()` (§4.3a).
- **No `PersistentPreRun*`/`PreRun*` exists anywhere in `cli/` source** (verified; the only grep hits are `dist/` binaries). Cobra 1.8.1 runs only the *most-specific* `PersistentPreRun*` then `break`s (the hook loop at `command.go:~954`; `EnableTraverseRunHooks` defaults false), and returns `flag.ErrHelp` for `--help`/non-runnable parents (`command.go:906,926`) *before* that loop. So a root `PersistentPreRunE` fires for every runnable subcommand today, and a future descendant hook would silently suppress it (→ §7 recursive guard).
- `varlib.MarkerPresent()` is a single `os.Stat` (`marker.go:29-37`) — **byte-bounded (no read)**; like all path I/O it can still stall on a broken mount, but performs no unbounded read/wait. Returns `(false, err)` on a non-root stat.
- `main.go` is minimal (`SetBuildInfo` + `Execute`) — the natural home for a probe fast-path. `resolveCfgDir()` (`root.go:92`) is the single config-dir resolver.
- `.goreleaser.yaml` wires `scripts: postinstall: ../deploy/deb/postinst.sh`, `bindir: /usr/bin`. `deploy/apt/e2e_test.sh` is the existing apt real-run harness, run as **root** with `apt-utils` by the `ci.yml` **`apt-e2e`** job (`ci.yml:112`, `sudo -E … sh deploy/apt/e2e_test.sh`). The separate **`apt-scripts`** job (`ci.yml:74`) is the *non-root, shellcheck/bash-n* gate — no `apt-utils`, no root.

## Design

### §4.1 Route the precise notice to every non-excluded management command (root pre-run)

Add a `PersistentPreRunE` on the **root** command that calls `maybeWarnComposeDrift(app.Err, app.CfgDir)` (stderr) before the subcommand runs. Reuses the (now FIFO-safe, byte-bounded) helper unchanged. The hook **never returns a non-nil error and does no size-unbounded read or explicit wait** (path I/O may still stall on a broken mount — §4.3a) — it prints or stays silent, then returns nil. (It is *not* wall-clock-bounded against a broken filesystem mount — see the §4.3a residual note; on the interactive surface that residual is pre-existing and matches `Execute()`'s `.env` read. The dpkg surface — the only one that must not wedge — is separately `timeout`-bounded, §4.3b.)

**Exclusion set — defined by principle:** exclude a command iff it is any of:
1. **A command that itself re-materializes the embedded compose and reports its own drift/next-step in its flow** → `reconcile` (reconcile.go:68-74,92), `update` (update.go confirm + `--no-reconcile` reminder, :318-322/:348-350/:362-364/:504-506), and `install` (it does **not** call `applyStack`; both its branches — `resume` and `runInstallFresh` — independently `AtomicWrite …docker-compose.yml` (install.go:124 / :190) before bringing the stack up; a "run reconcile" nag right before it rewrites the compose is misleading — a fresh install is silent anyway since the compose is absent).
2. **`self-update`** — it emits its own honest post-swap drift guidance (§4.2); a second, adjacent pre-run nag about pre-existing drift mid-swap is redundant/contradictory.
3. **A teardown command** → `uninstall`.
4. **Machine / first-contact surfaces** → `version --short`, the completion machinery, and `help`.

**Detection predicate (so two implementers converge)** — given the executing leaf command `c`:
- Skip if `c` **or any ancestor** has canonical `Name()=="completion"` (an ancestor walk — `completion bash`/`zsh` execute a leaf named `bash`/`zsh`, so leaf-name matching misses them).
- Skip if `c.Name()` ∈ `{"__complete","help","reconcile","update","install","uninstall","self-update"}`. (`__completeNoDesc` is an alias of `__complete` and reports `Name()=="__complete"`.)
- Skip if `c.Name()=="version"` **and** the parsed `--short` is true — check the name first, then `c.Flags().GetBool("short")` (the name guard prevents `GetBool` on a command lacking the flag).
- `--help` on any command and bare `mathion`/non-runnable parents short-circuit to `flag.ErrHelp` *before* the hook — no explicit exclusion needed. `mathion help x` (the `help` *command*) does fire → excluded by name.

**De-dup with `status`:** remove `status`'s `maybeWarnComposeDrift(app.Out,…)` call (`status.go:30`); the global pre-run owns the drift note. `status` keeps `maybeWarnInstallIncomplete` — a distinct, already-shipped signal deliberately **not** globalized here (one code comment states why: separate severity/lifecycle, out of scope). Behavioral deltas to document + test: for `status` the drift note now (a) goes to **stderr**, and (b) prints **before** `compose ps` and **regardless of** the later health result (the pre-run precedes `RunE`).

### §4.2 self-update: replace the unconditional nudge with an honest line (no new-binary invocation)

`cli/internal/selfupdate/run_linux.go`, confirmed-swap tail (currently `:155-162`):
- Keep the `old → new` success line.
- **Replace** the unconditional `"if this release updated the stack definition, apply it with: sudo mathion reconcile"` with a neutral line making no drift claim, e.g.:
  `self-update complete — your next `+"`sudo mathion`"+` management command will report whether this release changed the stack (apply changes with `+"`sudo mathion reconcile`"+`).`
- Update the `:156-161` comment.
- **No re-exec, no subprocess, no new-binary invocation.** The old running binary can't byte-compare; the §4.1 pre-run on the operator's next *non-excluded* `sudo mathion` command delivers precision (same mechanism that covers an `install.sh` re-run, whose own `version 2>/dev/null` at `install.sh:151` swallows stderr and is intentionally not relied upon). Byte-precise nudging at the self-update moment is Slice B.
- Note: the new line legitimately still contains `sudo mathion reconcile`, so the existing positive `run_linux_test.go` assertions (`:119` contains, `:122` ordering) and the five negative-path assertions (`:148/170/190/210/244`) stay green.

### §4.3 apt: a hidden, bounded, file-only drift probe that cannot wedge dpkg (outside the §4.3b D-state residual)

**(a) `_drift-probe` as a `main.go` fast-path (NOT a cobra command).** In `main.go`, before `cmd.Execute()`, if `len(os.Args) >= 2 && os.Args[1] == "_drift-probe"`, call `cmd.RunDriftProbe(os.Stdout)` and return. This **bypasses `Execute()`** — no `tlsEnabledFromEnv` `.env` read, no cobra, no `App`/runner, no lock — so it is automatically absent from the pre-run, `--help`, and completion. (`SetBuildInfo` is unnecessary — the probe uses no version.)

`RunDriftProbe(w io.Writer)`:
- Resolves the config dir by **calling `resolveCfgDir()`** (identical `MATHION_CONFIG_DIR` handling — no divergence).
- Emits drift via the **same hardened `maybeWarnComposeDrift(w, cfgDir)`** used everywhere (single source of the string + precedence; the probe passes `w=os.Stdout` so the notice shows inline in `apt` output). No re-implementation, no second copy of the message.
- **Returns (absent an uninterruptible-I/O stall); the caller returns exit 0** (advisory). No panic path. (Wall-clock bounding for the dpkg path is provided by the postinstall `timeout`, §4.3b.)

**Hardened `composeDrifted` (the one change that makes every surface FIFO-safe + byte-bounded), replacing the unbounded `os.ReadFile` at `version.go:72`:**
- Open the compose `O_RDONLY|O_NONBLOCK` (a FIFO opens immediately for read; a regular file is unaffected). `ENOENT` → `(false, false)` (absent).
- `f.Stat()` on the **opened fd** (no `Stat`→`Open` TOCTOU) and reject non-regular (`!IsRegular()` → FIFO/device/dir/socket, incl. a symlink whose target is one) → `(false, true)` (present-but-unreadable; the marker is still consulted by `maybeWarnComposeDrift`), without reading it. A **post-open read error** (e.g. `EIO`) likewise returns `(false, true)` — quiet on bytes, marker still consulted (§5 rule 3).
- Read at most `len(compose.ComposeYAML)+1` bytes via `io.LimitReader`, and **check the read error** — a post-open read error (e.g. `EIO`, or a partial read that then fails) must NOT be compared as bytes (that would emit a *false* drift claim, violating "never a false claim"). **Factor the read+compare AND the error→`(drifted,present)` mapping behind one `io.Reader` seam** so the mapping itself (not merely "the reader errored") is unit-testable with an injected failing reader — a real fixture can't reliably produce a post-`open` `Read` error hermetically (a `0o000` file fails at `open` with `EACCES`, not at `Read`), and a seam returning only `(drifted, err)` would leave the caller's `err→(false,true)` mapping untested (a mutant `err→(true,true)` would still pass). The seam therefore returns the final `(drifted, present)` tuple:
  ```go
  // testable seam — drive directly with a failing reader in the unit test.
  // r is the opened+fstat'd regular file (or an injected reader in tests).
  func driftFromReader(r io.Reader, embed []byte) (drifted, present bool) {
      buf, err := io.ReadAll(io.LimitReader(r, int64(len(embed))+1))
      if err != nil {
          return false, true // present-but-unreadable: quiet on bytes, marker still consulted (§5 rule 3)
      }
      return !(len(buf) == len(embed) && bytes.Equal(buf, embed)), true
  }
  ```
  `composeDrifted` opens `O_RDONLY|O_NONBLOCK` (ENOENT → `(false,false)`; other open error → `(false,true)`), `f.Stat()`s the fd (error or non-regular → `(false,true)`), then `return driftFromReader(f, compose.ComposeYAML)`. Compare the **length-`n` read slice `buf`**, never a fixed-size pre-allocated buffer (that would false-positive on an equal file). The `+1` distinguishes `embed` from `embed+extra`; correct for equal/shorter/longer/prefix-equal. Regular-file behavior is byte-identical to today's compare for all existing tests. (§7 drives `driftFromReader` with a partial-bytes-then-`EIO` reader and asserts the exact `(false,true)` result, so the mapping is not shipped untested.)
- This makes the **pre-run, `status`, and the probe** all **FIFO-safe + byte-bounded** on the compose read (no unbounded read). It is **not** wall-clock-bounded on a broken filesystem mount — Linux ignores `O_NONBLOCK` for regular files, so a stalled-mount `open`/`fstat`/read can still block. That residual is bounded where it must be (the dpkg path) by the postinstall `timeout` (§4.3b); the interactive pre-run's residual matches the pre-existing `Execute()` `.env` exposure and is out of scope (§Non-goals).

**(b) postinstall wiring** — `deploy/deb/postinst.sh` (`configure`), after the existing dual-install shadow check:
- **Dual-install shadow-risk precedence:** if `/usr/local/bin/mathion` exists, a curl|sh copy *may* shadow the apt binary (a conservative shadow-*risk* policy — a non-executable file or unusual PATH need not actually shadow, but the existing postinst uses the same `[ -e … ]` test); keep the shadow warning and **skip** the drift claim.
- Else invoke the probe by absolute path, **wall-clock-bounded by `timeout --kill-after`** (to ≤~6s, except the documented D-state residual; SC2015-safe):
  ```sh
  if [ ! -e /usr/local/bin/mathion ] && [ -x /usr/bin/mathion ]; then
    timeout --kill-after=1s 5s /usr/bin/mathion _drift-probe 2>/dev/null || true
  fi
  ```
- **`--kill-after` is load-bearing (round-3 Critical).** Plain `timeout 5s` only sends `SIGTERM` at the deadline; a child that ignores or blocks `SIGTERM` would keep `timeout` waiting **indefinitely**, so `|| true` might never run and dpkg could still wedge. `--kill-after=1s` escalates to `SIGKILL` 1s past the deadline → the call returns within ~6s (empirically 6.0s on GNU coreutils 9.4 against a `trap '' TERM; sleep` child, rc=137; vs ~30s+ with plain `timeout`), **absent an uninterruptible `D`-state stall** where even `SIGKILL` cannot reap the child (the accepted residual below). (Our Go probe would exit on `SIGTERM` anyway, but the postinst must be robust regardless of the child.)
- `timeout` is GNU coreutils (Essential on Debian/Ubuntu → guaranteed present; verified in the bookworm/jammy package sets). Layers keeping dpkg safe: the `[ ] && [ ]` is an `if`-condition (SC2015-exempt); `timeout --kill-after=1s 5s … || true` bounds wall-clock (≤~6s), `SIGKILL`s a `SIGTERM`-ignorer, AND forces exit 0 on any timeout/signal/non-zero; the pre-existing `exit 0` (`postinst.sh:9`) is the floor.
- **Accepted residual (out of scope, documented):** a probe stuck in an uninterruptible `D` state on a *broken local-root filesystem* cannot be reaped even by `SIGKILL`, so `timeout` (and thus dpkg) would wait for the kernel to give up. This is not fixable by a synchronous call; the only cure — detaching the probe (backgrounding it with all inherited dpkg pipes closed) so the postinst returns immediately — is **rejected** because it would move the drift notice out of the inline `apt` output, defeating the feature's whole purpose. Under a broken local-root FS, dpkg and the entire host are already non-functional; we accept this residual rather than hide the notice.
- Note (best-effort, fail-quiet, not a defect): a host installed with a custom `MATHION_CONFIG_DIR` gets no apt-time nudge (the postinst runs with no such env → probes `/etc/mathion`); the operator's own `sudo mathion` commands (carrying their env) still nag via §4.1.

### §5 Precedence & fail-quiet (restated)

1. Compose file **absent** (`ENOENT`) → silent on every surface. Guards a purged host.
2. Else warn iff **on-disk bytes differ OR the apply-pending marker is present**.
3. A read error (open error other than `ENOENT`, `fstat` error, a **post-open read error** like `EIO`) **or a non-regular compose** is fail-quiet on the *bytes* (drift-bit = false, `present` = true) but **the marker is still consulted** (a single `os.Stat`) — consistent with `maybeWarnComposeDrift`'s present-but-unreadable branch.
4. **Root context:** a non-root process that cannot traverse the `0700` dirs reads nothing → silent (never a false claim).

### §6 Side effects & exit codes

- **No Docker, no container mutation, no lock, no compose write, no marker write anywhere in Slice A.** §7 regression-tests this.
- Root pre-run: prints or silent, returns nil; never changes a command's exit code.
- `_drift-probe`: FIFO-safe + byte-bounded reads, always exit 0.
- postinstall: `timeout --kill-after=1s 5s`-bounded (≤~6s, `SIGKILL`s a `SIGTERM`-ignorer) + `|| true` + `exit 0` floor — cannot fail dpkg and cannot wedge it except under a broken-local-root-FS `D`-state (accepted residual, §4.3b).

## §7 Testing (all required for sign-off)

- **Pre-run (§4.1), per-stream + counting the shared drift string (not global emptiness):**
  - drifted → exactly one drift line on `app.Err`, zero on `app.Out`; identical → zero; absent → zero; marker present + identical/non-regular compose → one on `app.Err`.
  - each excluded command emits **zero** drift lines: `reconcile`, `update`, `install`, `uninstall`, `self-update`, `version --short`, `help`, and **`completion bash`** specifically (drive the runnable leaf; bare `completion` short-circuits and would false-pass). `completion bash` may emit cobra's own stderr — assert absence of the **drift string**, not empty output.
  - a representative non-excluded command (`status`) → the drift line fires (proves the root hook reaches subcommands).
- **Most-specific-hook guard:** recursively walk `newRootCmd(app).Commands()` and assert **no descendant** command defines `PersistentPreRun` or `PersistentPreRunE` (the root legitimately defines `PersistentPreRunE`; assert on descendants only). Exported fields, so directly checkable. (Scope note: `Commands()` covers only *project-owned* subcommands — cobra injects `completion`/`help`/`__complete` lazily during `Execute`, so they are absent from this walk. That is fine: those define no persistent pre-run and are name/ancestry-excluded anyway; the guard's job is to catch a *future mathion-authored* descendant hook.)
- **`status` migration:** `TestStatusEmitsDriftOn{Healthy,Unhealthy}Branch` (`status_test.go`) call `newStatusCmd(app).RunE` directly and go RED once `status.go:30` is removed → **migrate** them to drive `status` through **`newRootCmd(app).ExecuteContext(ctx)` + `SetArgs([]string{"status"})`** — NOT the exported `Execute()`, which builds its own `App` from `resolveCfgDir()` (root.go:122-124) and ignores a passed app, so the pre-run would never see the test's `app`. Use **separate `Out`/`Err` buffers** (today `statusWithHealth` wires `Out=Err=one buffer` at status_test.go:31; the split is required to *prove* the drift note moved to stderr while `stack not healthy`/`healthy` stay on stdout). `TestStatusEmitsIncompleteNotice` (unique fragment) still passes. `drift_test.go` (direct `maybeWarnComposeDrift`) stays green.
- **self-update (§4.2):** assert the confirmed-swap path prints the new neutral line and does **NOT** contain the old distinctive phrase `"if this release updated the stack definition"` (not an absence check on `"sudo mathion reconcile"`, which the new line keeps). Existing `run_linux_test.go` assertions stay green.
- **`RunDriftProbe` / hardened `composeDrifted` (§4.3a):** drift → one shared line + return; no-drift/absent → silent; **non-regular (FIFO)** compose → rejected promptly (no hang, no read), and with a pending marker → still warns; **oversized** regular compose → drifted via the `N+1` bound.
- **Post-open read-error mapping (§4.3a `driftFromReader`):** drive `driftFromReader` **directly** with an **injected `io.Reader` that returns partial bytes then `EIO`** (NOT a `0o000` file — that fails at `open` with `EACCES`, exercising the open-error path, not the `Read` path, and as root would just read successfully → the branches are observationally identical and the test could false-pass). Assert (a) the returned tuple is **exactly `(false, true)`** — this pins the error→`(drifted=false, present=true)` *mapping*, so a mutant `err→(true,true)` fails here (the round-6 gap: testing only "the reader errored" left this mapping uncovered), and (b) the injected reader records it was actually read (the seam was invoked, not short-circuited). Then, at the `maybeWarnComposeDrift` level, cover downstream precedence with a present-but-unreadable input (a FIFO/open-failure source giving `(false,true)`): **no** drift line without a marker, **one** warning with a pending marker. Together these guard both the mapping and the precedence — proving the "never a false claim" invariant on read errors.
- **Mutation-safety (§6):** assert **zero `Runner` calls, no `.lock`, no marker write, no compose write** — via a named vehicle to avoid divergence: invoke `root.PersistentPreRunE(leafCmd, nil)` directly (and `RunDriftProbe(buf)`), OR drive a Runner-free command (`version` non-`--short`, which the hook fires for). Not a command whose own `RunE` calls the Runner.
- **apt end-to-end (§4.3b):** extend `deploy/apt/e2e_test.sh` (real install→upgrade, root, `apt-utils`): (i) **seed** `/etc/mathion/docker-compose.yml` with content ≠ `compose.ComposeYAML` (drifted branch) and, for the shadow case, seed `/usr/local/bin/mathion`; extend the harness `cleanup()` trap to remove seeded files and **guard against clobbering a pre-existing real `/etc/mathion`** (skip/backup if present). Assert: drifted → the advisory line in `apt` output + configure exit 0; dual-install present → shadow warning only, no drift claim. (ii) **Timeout-path** test (proves `--kill-after` fires): execute the extracted `postinst.sh` directly against a `/usr/bin/mathion` fixture that **touches a sentinel file, then traps/ignores `SIGTERM` and blocks** (e.g. `#!/bin/sh` + `: > "$SENTINEL"` + `trap '' TERM` + `sleep 30`) — a plain `sleep` exits on `SIGTERM` and would NOT exercise the escalation, and a stable FIFO is *rejected* before opening, so a `SIGTERM`-ignoring blocker is required. Assert **(a)** the sentinel exists afterward (proves the probe branch actually ran — otherwise exit-0-under-20s could false-pass on a *skipped* probe, e.g. a shadow-guard or path bug), **(b)** the postinst returns within the combined ceiling (~6s, comfortably < a 20s bound), and **(c)** configure exit 0 — together demonstrating `--kill-after`'s `SIGKILL` reaped the ignorer. (iii) missing-`/usr/bin/mathion` guard via direct postinst execution (can't occur in a normal `configure`). `bash -n` + `shellcheck` clean on `postinst.sh`.
- **Formatting/build gate (fixed idiom):** `test -z "$(cd cli && gofmt -l .)"` (gofmt recurses a dir; `gofmt -l ./...` is invalid and `gofmt -l` exits 0 even when files need formatting — assert empty explicitly), plus `cd cli && go vet ./... && go build ./... && go test ./... -count=1` green.

## §8 Files touched (anticipated)

- `cli/main.go` — `_drift-probe` fast-path dispatch.
- `cli/cmd/root.go` — root `PersistentPreRunE` + the principled exclusion predicate.
- `cli/cmd/version.go` — harden `composeDrifted` (non-blocking open + fstat-on-fd + `N+1` bounded read); `maybeWarnComposeDrift` logic unchanged.
- `cli/cmd/drift_probe.go` (new) — `RunDriftProbe(w)` = `resolveCfgDir()` + `maybeWarnComposeDrift`.
- `cli/cmd/status.go` — remove the redundant `maybeWarnComposeDrift` call (keep install-incomplete).
- `cli/internal/selfupdate/run_linux.go` — neutral post-swap line + comment.
- `deploy/deb/postinst.sh` — `timeout`-bounded, SC-safe probe call with shadow-risk precedence.
- Tests: `cli/cmd/root_test.go` (pre-run per-stream + exclusions + recursive-hook guard + mutation-safety), `cli/cmd/status_test.go` (migration, split buffers), `cli/cmd/drift_probe_test.go` (new, incl. FIFO/oversized), `cli/cmd/version_test.go`/`drift_test.go` (hardened-read cases if needed), `cli/internal/selfupdate/run_linux_test.go` (neutral line), `deploy/apt/e2e_test.sh` (apt e2e + seeding/trap + timeout/missing-binary guards).

## §9 Resolved decisions / notes

1. **Exclusion set** (principled): `reconcile`, `update`, `install`, `uninstall`, `self-update`, completion-family (by ancestry), `__complete`, `help`, `version --short`.
2. **Single drift string, single reader.** Hardening `composeDrifted` makes `maybeWarnComposeDrift` **FIFO-safe + byte-bounded** (not wall-clock-bounded on a broken mount — that residual is bounded for dpkg by the postinstall `timeout`), so pre-run, `status`, and the probe all call it — one message, one precedence, one bounded reader. No duplicated literal, no separate probe reader.
3. **`_drift-probe`** is a `main.go` fast-path (not a cobra command): never triggers `Execute()`'s unbounded `.env`/TLS read, never enters cobra, needs no pre-run exclusion. Uses `resolveCfgDir()`.
4. **Root-context detection** is intentional but scoped to default managed installs (§Global Constraints caveats); non-root → fail-quiet silence; all hints say `sudo`.
5. **`self-update`'s immediate line stays neutral**; byte-precise self-update-moment nudging is Slice B (needs the new binary). The Slice-A/B boundary holds — nothing Slice A promises requires the deferred re-exec.
6. **`timeout --kill-after=1s 5s` is load-bearing** (round-3 Critical): it bounds the dpkg probe call to ≤~6s and `SIGKILL`s a `SIGTERM`-ignoring child (plain `timeout` would wait forever on one) — **except** under a `D`-state uninterruptible wait on a broken *local-root* FS, which even `SIGKILL` cannot reap. That residual is an accepted, documented out-of-scope failure; the probe is **not** detached because the notice must appear inline in `apt` output (§4.3b).
