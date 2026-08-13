# Phase 9-D Slice 3 — `update` + `backup`/`restore` + `/version` — Design

**Status:** design (brainstormed 2026-08-06; four decision points user-approved; revised through four
multi-reviewer Opus convergence rounds **and** fourteen independent codex gate rounds (converged) — see "Review resolutions"
at the end. Codex round 4's findings prompted a deliberate **simplification of the crash-recovery model to
"refuse-on-crash"**: the recovery journal is now a pure **breadcrumb** — a crash or operator interrupt leaves it
behind and the **next non-exempt command refuses** with the exact `mathion restore <backup>` recovery command;
**no command ever auto-restores from the journal**. This dissolved the auto-recover / `rollback_allowed` /
phase / cap-in-journal machinery that had generated every recovery-machinery finding across the codex rounds.
**In-process auto-rollback on a *clean* update failure is retained** — only crashes and interrupts refuse.
Codex round 7 extended the same breadcrumb to **standalone `restore`** (round-7 #2): a `restore` interrupted
after its DB load but before its `.env` re-pin would otherwise leave `.env` on the old tag over a rewound
schema with nothing blocking `start`/`backup`; the breadcrumb (`kind:"restore"`) makes the next non-exempt
command refuse there too, and it also hardened the `.env` DB-target check to compare the **raw, un-decoded**
database path — psycopg does not URL-decode the dbname, so a `%`-escaped path spoof must be rejected (round-7 #1).)
**Epic:** Phase 9-D (self-hostable + distributable). Slice 1 (deployment foundation) and
Slice 2 (`mathion` CLI) are shipped; the CLI is released as `cli-v0.1.1`.
**Prereqs in place:** `install`/`start`/`stop`/`status`/`logs`/`pin`/`superuser`/`version`/`uninstall`
commands; `/etc/mathion` config (`.env` + `docker-compose.yml` + `install-state`); prod compose
`mathion_prod` with services `app` (loopback `127.0.0.1:8000`) + `db` (postgres:17); volumes
`mathion_prod_mathion_pgdata` + `mathion_prod_mathion_assets`.
**Verified against the running image** (`ghcr.io/svkucheryavski/mathion:v0.1.1`) and a live `postgres:17`:
app runs as uid 10001 (`app`); image has `sh` (dash), GNU `tar` 1.35, GNU `findutils` 4.10 (with `-delete`),
`rm`, `mktemp`; `Dockerfile` has **no ENTRYPOINT** (CMD only) so `compose run app <cmd>` overrides cleanly;
backend uses **no** Postgres extensions and **no** large objects; single migration `67e8294b4267_initial_schema`;
`mathion` is the sole DB role and owns every object; `MATHION_VERSION` reaches the app via `env_file: .env`.

## Goal

Give operators a safe lifecycle for a running deployment: **upgrade** the app version with an
automatic pre-upgrade backup and **auto-rollback** on failure; take and restore **backups** on
demand; and expose the **running version** over HTTP so upgrades can be verified and ops can see
what's live.

## Scope (this slice)

1. `mathion backup [--out <path>]` — online, near-zero-downtime snapshot (DB + assets + manifest) to a
   managed directory.
2. `mathion restore <archive> | --latest [--yes]` — full-state rewind (DB + assets + image tag),
   typed confirmation, atomic schema-reset DB load.
3. `mathion update [--version <tag>] [--no-rollback] [--yes]` — pull → stop → consistent backup →
   migrate → health/version-gate, with **auto-rollback** on any failure (opt out with `--no-rollback`).
4. `GET /version` (backend) — `{"version":"<MATHION_VERSION>"}`, mirroring `/health`.
5. `mathion version` (CLI) — fix the smoke Finding #2 mislabel and surface the live running version.

## Non-goals (deliberate YAGNI — future adds, not needed for correctness now)

- Backup **retention / pruning** (`--keep N`, a `prune` command). Backups accumulate; operator prunes by hand.
- **Remote / off-box** backup destinations (only a local `--out` copy).
- **Scheduled / cron** backups.
- Backup **encryption** (the archive holds full DB + assets — unencrypted PII; documented).
- A live "latest release" **channel/manifest** query for `update` (target is the baked default or explicit `--version`; a channel is Slice-4-adjacent).
- **Schema downgrade** via `update` (forward-only `alembic upgrade head`; use `restore` to rewind). A
  dedicated downgrade guard is deferred — with a single migration today no downgrade scenario exists, and a
  materially-older target makes `alembic upgrade head` error → the normal rollback lands the operator safely.

## Global Constraints

- **Language / deps:** Go stdlib + cobra only in the CLI; no new third-party deps (the advisory lock uses
  `syscall.Flock`; the hardened extractors use `archive/tar`, `compress/gzip`, `os.Root` — all stdlib).
  Backend change is a single FastAPI route + one `Settings` field in `backend/mathion/` (no new deps).
  go 1.24 (already the floor; needed for `os.Root`).
- **Root:** the commands that manage Docker + `/etc/mathion` + `/var/lib/mathion` — `install`/`uninstall`/
  `backup`/`restore`/`update`/`start`/`stop` — require root (run via `sudo`); non-root → clear "requires root;
  re-run with sudo" (new small helper). **`version` is exempt** (read-only): it must run as non-root to produce
  the mandated EACCES branch below, so `requireRoot` is scoped to the mutating commands and never gates `version`.
- **Secrets & DB error output:** never place a credential in a host-side argv. The DB password lives in the
  `db` container env; reference it **inside** the container (`sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" …'`),
  never as a host-side `-e PGPASSWORD=<value>` (which would show in `ps`). **`pg_dump`/`pg_restore`/`psql`
  stderr is never surfaced** to stdout/CLI/logs (Postgres errors routinely embed row-level PII, e.g.
  `Key (email)=(…) already exists`, and are not reliably scrubbable). Wiring: run `psql` with
  `VERBOSITY=verbose` (SQLSTATE is only emitted under verbose — the verbose `ERROR`/`DETAIL` lines still carry
  PII), write the **full** captured stderr only to a `0600` root-only file under `/var/lib/mathion` (this file
  persists, un-pruned, like the backups themselves), and for display **regex-extract only the 5-char SQLSTATE**
  plus a generic message. The `pg_*` caller **must** intercept the `Stream`/`StreamIn` error (which captures
  full stderr), spool it to that file, and **return a new scrubbed error** — if the raw `Stream` error reaches
  `Execute`'s generic `error: <err>` printer (`root.go:77`), the captured PII leaks.
- **Atomic + durable writes:**
  - Small files (`manifest.json`, the `.env` re-pin, the **update journal**) use `config.AtomicWrite`. **Today
    `AtomicWrite` (`state.go:12`) fsyncs the temp *file* then renames — but never fsyncs the containing
    *directory*, so across a power loss a rename (or the journal's later unlink) can fail to persist while a
    logically-earlier one does.** This slice **extends `AtomicWrite` to fsync the parent directory after the
    rename** (open dir `O_RDONLY`, `Sync`, close — cheap, purely additive durability for every existing caller
    too), and adds a companion **`RemoveSync(path)`** (unlink + parent-dir `fsync`) for the journal's deletion.
    This directory-level durability is what makes the crash-resume journal below sound; a plain file-fsync is
    **not** sufficient (verified against `state.go`).
  - The **final archive is assembled by streaming** (temp file in the *target* dir → `gzip`/`tar` writers
    → `Sync` → `Rename`) — **not** `config.AtomicWrite`, whose `[]byte` signature would buffer a multi-GB
    archive in memory (host OOM). The streaming writer replicates AtomicWrite's temp→fsync→rename guarantee
    **and** fsyncs `backups/` after the rename (same directory-durability rule).
- **`.env` re-pin (preserve every other key, deterministic):** a **line-oriented** helper — read the raw
  `.env` bytes, replace the `MATHION_VERSION=` value in place — **collapsing all occurrences to a single line**
  (write the correct value on the first match, drop the rest; never "reject on pre-existing duplicates", so the
  standardized behavior is uniform across `restore`/`update`) — because both docker-compose `--env-file` and
  `config.ParseEnv` resolve duplicate keys **last-wins**, so rewriting only the first would leave a stale
  winner; append if absent, leave every other line/order/comment **verbatim**; match the line on the
  **parsed, `=`-split, trimmed key with EXACT equality** the same way `ParseEnv` does (trim surrounding
  whitespace, skip `#`-comment lines, tolerate `KEY = VALUE`) — **not** `strings.HasPrefix(line,
  "MATHION_VERSION")`, which would also match `#MATHION_VERSION=` and `MATHION_VERSION_EXTRA=` (the one
  corruption class the assert-after-write below would *not* catch: it could mangle a `MATHION_VERSION_EXTRA`
  line while leaving `MATHION_VERSION` correct). Then `config.AtomicWrite` at mode
  **0600**. Do **not** rebuild via `GenerateEnv`/`RenderEnv` (fixed key set; drops comments/order; omits
  `SMTP_*`/email keys → would silently revert operator hand-edits and risk decoupling
  `POSTGRES_PASSWORD`↔`MATHION_DATABASE_URL`). **Before** writing, `config.ValidateOCITag` the new tag
  (defends against a hostile `manifest.mathion_version`). **After** writing, re-parse and **assert
  `MATHION_VERSION` equals the intended target** (not merely non-empty) and re-run `config.ValidateEnvComplete`
  — a defeated re-pin fails loudly at write time, not later at the gate.
- **Compose invocation:** reuse `App.composeArgs`/`App.compose` — every docker call is
  `docker compose -p <app.Project> -f /etc/mathion/docker-compose.yml --env-file /etc/mathion/.env …`.
  Project name and any confirmation prompt use `app.Project` (overridable via `MATHION_PROJECT_OVERRIDE`),
  never a hardcoded `mathion_prod` literal. **One exception:** `update`'s migrate step (step 7) must set
  `MATHION_VERSION=<target>` for *that one subprocess only* — `ExecRunner.Run` never sets `cmd.Env` and the
  `Runner` interface has no env hook, so plain `App.compose` **cannot** do this. It requires the env-aware
  `Runner.RunEnv` below, called with the full compose-arg prefix (`a.Runner.RunEnv(ctx, env,
  a.composeArgs(sub...)...)` — the env-aware analog of `App.compose`, so `-p`/`-f`/`--env-file` are retained);
  a literal `App.compose` reuse would silently run the migrate against the *old* image (see step 7).
- **Subprocess environment sanitization (host-env poisoning defense):** Compose resolves the interpolation
  variables `${MATHION_VERSION}` (the `app` image tag, via `env_file: .env`) **and**
  `${POSTGRES_USER}`/`${POSTGRES_PASSWORD}`/`${POSTGRES_DB}` (the `db` service — which has **no `env_file`**;
  its `environment:` block is interpolated) from the **process environment**, and a **shell-exported var wins
  over `--env-file`** during interpolation. `ExecRunner` today inherits the host env unchanged
  (`runner.go:25-33` never sets `cmd.Env`), so a root shell that has `export MATHION_VERSION=v9` or
  `export POSTGRES_PASSWORD=other` would make **every** compose call boot the wrong image or pass the wrong
  credentials — e.g. `mathion start` silently comes up on `v9`, bypassing all of `update`'s protection, and the
  restore DB one-off would auth with the wrong password. Fix: the CLI runs **every** `docker`/`compose`
  subprocess with a **sanitized environment** — `cmd.Env = os.Environ()` **with `MATHION_VERSION` /
  `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` stripped** — so `--env-file /etc/mathion/.env` is the
  **sole** authority for those four keys. The **only** deliberate re-addition is the env-aware
  `RunEnv`/`StreamInEnv` (below), which append exactly one `MATHION_VERSION=<validated target>` for the
  migrate/asset one-offs (a later, higher-precedence entry, so it overrides the stripped baseline for that
  one-off only). **All** `Runner` methods (`Run`/`Output`/`Stream`/`StreamIn`/`RunEnv`/`StreamInEnv`) set this
  sanitized `cmd.Env`. A unit test exports a bogus `MATHION_VERSION` and `POSTGRES_PASSWORD` and asserts a
  compose call still resolves those from `.env`, and that a `RunEnv` migrate carries the intended
  `MATHION_VERSION` and nothing else poisoned. **Because sanitization makes `.env` the *sole* source for these
  four keys, a mutating command (`update`/`restore`) must precondition on a *strengthened*
  `config.ValidateEnvComplete` before any Docker mutation** (round-5 #4 + round-6 #1): it now requires
  **non-empty `POSTGRES_USER` and `POSTGRES_DB`** and validates the **complete effective self-hosted DB target**
  of `MATHION_DATABASE_URL` — **scheme `postgresql+psycopg`, host `db`, port `5432`**; the **decoded**
  `username`/`password` matching `POSTGRES_USER`/`POSTGRES_PASSWORD` (psycopg URL-decodes userinfo); the **raw,
  un-decoded** database path exactly `"/" + POSTGRES_DB`; `POSTGRES_USER`/`POSTGRES_DB` constrained to a **safe
  identifier alphabet** (`^[A-Za-z_][A-Za-z0-9_]*$`); and **no query/fragment component and no percent-escape**
  (`%`) anywhere in the userinfo or path. The **raw**-path compare is essential (round-7 #1): **psycopg does
  *not* URL-decode the dbname** — verified against the installed dialect, `create_connect_args` for
  `…@db:5432/m%61thion` yields `dbname: "m%61thion"`, the *literal* escaped string — so comparing Go
  `net/url`'s **decoded** `u.Path` (`/mathion`) would wrongly pass while alembic connects to a **different**
  database `m%61thion`. Requiring the escaped path (`u.EscapedPath()`) == `"/" + POSTGRES_DB` with a
  safe-identifier `POSTGRES_DB` (so a legitimate value never needs escaping) rejects `m%61thion`, `%6Dathion`,
  and `%2F…` path spoofs; forbidding `%` in the userinfo rejects the same class in the decode-consistent
  username/password before it can matter. This is load-bearing because `alembic upgrade head` migrates
  through `settings.database_url` == `MATHION_DATABASE_URL` (`backend/alembic/env.py:45,57`) while
  `backup`/`restore` operate on the **`db` container's `$POSTGRES_DB`**: if the URL's *effective* target diverges,
  the two act on **different databases**, so a rollback restores the wrong one and the migrated DB has **no**
  rewind point. A bare username/path compare is **insufficient** — psycopg/SQLAlchemy honor URL **query
  parameters** (`?dbname=other`, `?user=…`, `?host=…`, `?port=…`) that **override** the URL's own components
  (verified against the installed dialect), and the host could be `@remote:5432/mathion` while `pg_dump` still
  hits service `db` — so the check must pin scheme+host+port+creds+db **and** refuse a query/fragment that could
  redirect them. `env.go:75` today requires neither `POSTGRES_*` key, hardcodes the username `mathion`, and
  checks no host/port/query. The precondition runs **before any Docker mutation**, so a divergent or incomplete
  `.env` fails **pre-mutation**, not after the migration already mutated an unbacked-up database.
  **`ValidateEnvComplete` also requires the parsed `MATHION_VERSION` to pass `config.ValidateOCITag` (round-10
  #2)** so the CLI's parsed value equals **Compose's *effective* tag**. `config.ParseEnv` (`env.go:55`) only
  `TrimSpace`s the value — it does **not** unquote or interpolate — while Compose's env-file rules **do** (`KEY="v1"`
  → `v1`; `${X:-v1}` → `v1`). Without this, a quoted/interpolated `.env` (`MATHION_VERSION="v0.1.1"`) makes the
  CLI see the tag as `"v0.1.1"` while Compose boots `v0.1.1`, so the same-tag guard (update step 2) mis-compares
  and pulls the **actually-active** tag. `ValidateOCITag` rejects `"`/`$`/comments/whitespace — none of which are
  legal in an OCI tag — forcing the canonical unquoted form `GenerateEnv` already writes, so parsed == effective.
- **Image reference:** the app image repo is `ghcr.io/svkucheryavski/mathion`; the tag is `MATHION_VERSION`
  in `.env`. A new CLI constant `imageRepo` holds the repo; a unit test asserts it is the prefix of the image
  line in the embedded `compose.ComposeYAML` so the two can't silently drift.
- **No implicit image pulls — `--pull never` on every *ordinary* compose `up`/`run` (round-10 #1):** the compose
  file sets **no `pull_policy`** (`docker-compose.yml`), so Compose's default is **`missing`** — `compose up` and
  `compose run` will **silently `docker pull` a locally-absent image**, which for the app service **assigns the
  active `MATHION_VERSION` tag** to whatever upstream now serves. That is the exact deployment-tag mutation
  rounds 8–9 forbid before confirmation + a breadcrumb, and it happens **inside** a plain `compose up`/`run` with
  no explicit `docker pull`. Therefore **every ordinary compose `up`/`run` passes `--pull never`** so a missing
  image **fails** (surfacing "image not present") instead of silently pulling. A pull is allowed at **exactly
  three designated obtaining points**: a **fresh `install`**, **`update` step 4** (`docker pull` of a
  same-tag-guarded, proven-**distinct** tag), and **`restore` step 6c** (post-confirmation, post-breadcrumb).
  `--pull never` is added to: **`start`** (`start.go:10`); the **backup** revision/image-id probes (any
  `compose run app …`); **restore** step 6 (`up -d db`) and step 9 (`up -d --wait app`); the **migrate** one-off
  (`compose run … app alembic …`); and the **asset** one-off. **`install`'s resume path (`install.go:122,125`)
  is hardened too:** its unconditional `compose pull` must **not** run for an **already-initialized** deployment
  (it would move the active tag against live data with no backup/breadcrumb), and its `compose up` takes
  `--pull never`. **The data-volume check gates ONLY the pull — never the migration (round-11 #2):** the resume's
  `alembic upgrade head` (a `compose exec app` against the already-local pinned image, `install.go:128`) is
  **idempotent** and must run on **every** resume, because a fresh install can crash **after** `compose up`
  creates `mathion_pgdata` but **before** the migrate (`install.go:174` orders `up` before migrate) — treating the
  volume's presence as "migration done" would skip it forever and leave a table-less DB that the superuser step
  then fails on. So: **`dockerx.VolumeExists("<project>_mathion_pgdata")`** (fail-closed — a detection **error**
  counts as *present*, never absence) → **present ⇒ skip the `compose pull`** (data exists; don't move the tag)
  **but still run the idempotent migrate**; **positively absent ⇒ a fresh/early-resume `compose pull` is
  allowed**. `docker pull` (the standalone binary, used at the three obtaining points) is unaffected — this
  constraint is about **compose-implicit** pulls.
- **Concurrency (advisory lock, acquired once, engines lock-free):** every command that mutates Docker/state
  or brings the app up/down — `install`/`uninstall`/`backup`/`restore`/`update`/`start`/`stop` — acquires an
  advisory `flock` (LOCK_EX|LOCK_NB) on `/var/lib/mathion/.lock` (root, 0600) **at the top of its `RunE`**
  (not `PersistentPreRunE`, whose `defer` would release before `RunE` runs), held for the whole run via a
  `defer` that therefore spans the in-process auto-rollback; if held → *"another mathion operation is in
  progress"*, exit non-zero. The shared `backup`/`restore` **engine functions are lock-free** and assume the
  caller already holds the lock — because `update` calls the backup engine and the `restore` engine
  (auto-rollback) **in-process** while holding the lock, and `flock` is per-open-file-description: a second
  `open`+`flock` of the same file in the same process returns `EWOULDBLOCK`, which would otherwise make the
  flagship auto-rollback deny itself. `EnsureBackupsDir` (below) runs **before** the lock is acquired in every
  command, so `/var/lib/mathion/.lock` always exists (the dir is not created lazily by `backup` alone).
  `start`/`stop`/`install`/`uninstall` all take the lock, so nothing brings `app` up or deletes volumes
  mid-`update` — completing the "no writers during the rollback window" guarantee (`install`'s resume path
  and `uninstall --purge` would otherwise reintroduce a writer / delete pgdata mid-rollback). `pin`/`superuser`
  are exempt — they `compose exec app`, which fails cleanly while `app` is stopped. Trade-off (documented): an
  operator's `mathion stop` during a long `backup`/`update`/`restore` is refused with the same message; the way
  to abort a long operation is Ctrl-C.

## Managed state directory `/var/lib/mathion`

Brand new (nothing in `install` creates it today). Lifecycle:

- Created by a new `EnsureBackupsDir`, mirroring `config.EnsureConfigDir`'s guards, run **before acquiring the
  flock in every lock-taking command** (`install`/`uninstall`/`backup`/`restore`/`update`/`start`/`stop` — all
  need `/var/lib/mathion/.lock`, and on a fresh box `install` is the first command so the dir may not exist
  yet): `MkdirAll` the tree **root-owned**, dir mode **0700**, then **durably link each newly-created directory
  into its parent** — after creating `/var/lib/mathion` fsync `/var/lib`, and after creating
  `/var/lib/mathion/backups` fsync `/var/lib/mathion` (round-5 #1: fsyncing a **child** dir does **not** persist
  its dirent in the parent; without this, a **first-ever** `update` on a fresh box could commit the migration and
  then lose the **entire** newly-created `backups/` — breadcrumb *and* rewind backup both — across a power loss,
  breaking the "mutated schema never without a breadcrumb" invariant that every later per-file dir-fsync assumes
  already holds; a directory only needs this on the run that creates it, so it is skipped once the tree exists);
  `Lstat` and **reject** a symlink or a group/world-writable dir on **both** `/var/lib/mathion` and
  `/var/lib/mathion/backups` (symlink-preplant defense). `backups/` holds archives (0600 each); `.lock` is the
  flock file; a `0700` **per-engine-invocation**
  staging subdir (`os.MkdirTemp(varlib, "staging-<pid>-*")`, a unique name per backup/restore call — **not** a
  single per-pid dir, so `update`'s in-process backup and rollback never collide on the same three member
  names) is where members are built/extracted — **inside** `/var/lib/mathion` so the final `Rename` into
  `backups/` stays on one filesystem (no `EXDEV`) and no PII transits a world-traversable `/tmp`.
- Each staging dir is removed on all **graceful** exits by a `defer` at its own engine-function return
  (covering normal return, panic, and the SIGINT→cancel→error path); a `SIGKILL`/power-loss can leave one
  behind, so each command also **sweeps stale `staging-*/` dirs** in `/var/lib/mathion` — **strictly after
  acquiring the flock** (so exclusivity guarantees no live peer's staging dir is deleted mid-flight; a sweep
  before the lock could delete a running command's live staging).
- **Startup orphan-worker sweep (the SIGKILL/second-signal backstop):** graceful cancellation force-removes a
  command's own named workers, but a `SIGKILL` or the "second signal forces exit" path cannot. So **strictly
  after acquiring the flock and before any command work**, every lock-taking command also **force-removes any
  leftover mathion worker containers by label** — the migrate / restore-db / restore-assets one-offs each carry
  `--label io.mathion.worker=1`, and the sweep is `docker ps -aq --filter label=io.mathion.worker=1 --filter
  label=com.docker.compose.project=<app.Project>` → `docker rm -f`. **Filtering on the label (scoped to this
  project), not a `--filter name=mathion_*` substring** — a name-substring sweep would also catch an operator's
  unrelated `mathion_restore_db_debug` container and is not project-scoped. **Under the exclusive lock the
  matches can only be dead orphans of a killed prior run**, never a live peer's worker, so removing them is safe
  and closes the "an orphaned destructive worker overlaps the next command" window for **standalone `restore`,
  `SIGKILL`, and the second-signal exit** alike (the sweep reaps a killed restore's *worker containers* by
  label — a separate concern from the restore *breadcrumb*, which the entry-check consults to refuse a
  DB-mutated-but-unfinished restore). The sweep runs even when no recovery breadcrumb is present.
- `uninstall --purge` **leaves `/var/lib/mathion` in place** (backups are the operator's data; purge today
  removes only volumes + `/etc/mathion`). Documented in the purge output. **But it *does* `RemoveSync` the
  recovery breadcrumb** (`backups/.update-journal.json`, either `kind`) — otherwise a stranded breadcrumb would
  make the **next fresh `install` refuse** (`install` is non-exempt) on a box that no longer has the
  `.env`/volumes the breadcrumb references. **That `RemoveSync` is a *late* step — after the typed confirmation *and* after
  `dockerx.Purge`'s volume/container teardown succeeds (`uninstall.go:49`), never in the entry-check** (round-6
  #2): a mistyped confirmation or a failed teardown must leave the breadcrumb **intact**, so a deployment that
  can **still be started** stays blocked. A **non-purge** `uninstall` **retains** the breadcrumb (the deployment
  can still be recovered via `restore`).

## The backup archive (linchpin — `restore` and auto-rollback both depend on it)

A single file `mathion-backup-<UTC-timestamp>-<version>.tar.gz` (e.g.
`mathion-backup-20260806T141530Z-v0.1.1.tar.gz`) containing exactly three members:

- `db.dump` — `pg_dump -Fc` (custom format) of the database.
- `assets.tar` — tar of the assets volume contents (`/data/mathion/assets`).
- `manifest.json`:
  ```json
  {
    "schema": 1,
    "created_at": "2026-08-06T14:15:30Z",
    "mathion_version": "v0.1.1",
    "image_id": "sha256:9f2c…",
    "alembic_revision": "67e8294b4267",
    "cli_version": "cli-v0.1.1",
    "db_name": "mathion",
    "sha256": { "db.dump": "…", "assets.tar": "…" }
  }
  ```

`mathion_version` + `image_id` are what make a rewind restore **code + schema + data together**: `restore`
re-pins the `.env` tag to `mathion_version` (after `ValidateOCITag`) *and* records the **immutable image ID**
(`docker image inspect`'s `.Id`) the backup was taken from. **A tag string is not identity** — GHCR tags are
mutable, so `ghcr.io/…:v1.2.0` can later point at different content; the gate therefore compares resolved
**image IDs**, not the tag string (see the restore/update gate). Restore's image preflight (step 4a resolve +
step 6c retag) makes
the rewind boot the **exact** recorded image: it consults `image_id` **first** — if still **locally available**
(it always is on an auto-rollback — the pre-update image was just running), it **retags `image_id` back onto
the tag** so `compose` boots identical code (no tag pull needed); only if `image_id` is **gone** does it pull
the tag, **warn loudly**, and fall back to the tag's current content (DB/assets still rewind; the "same code"
half of the claim can't be met).
`image_id` is probed at backup time from the **running/stopped** container's `.Image`. `sha256` per member is verified on extract for
**integrity, not authenticity**, and provides **no defense at load time** — see the trust boundary in
`restore`. `alembic_revision`/`cli_version`/`db_name` are **informational provenance** (not load-bearing):
restore reloads the dump's own `alembic_version` table and uses the container's `$POSTGRES_DB`, not `db_name`
(it only **warns** if `db_name` ≠ the container's `POSTGRES_DB`). Timestamps are UTC. On a filename collision
(two backups in the same second), append `-2`, `-3`, … rather than overwrite.

**`--latest` selection:** parse each candidate's **UTC-timestamp** — the fixed 16-char `YYYYMMDDTHHMMSSZ` token
immediately after the `mathion-backup-` prefix, unambiguous regardless of the hyphens/dots in the version that
follows it — newest wins; break a same-second tie by **file mtime** (newest wins). This deliberately **does
not** parse the collision counter out of the filename: a `mathion_version` tag can itself contain `-`/`.`
(e.g. `v0.1.1-rc2`), so a version ending `-2` is indistinguishable by string-parsing from a `-2` **collision
suffix** — the mtime tie-break sidesteps that entirely. It is likewise **not** a raw lexicographic filename
sort (which would pick the *oldest* of a same-second cluster, since the `-2` suffix's `-` (0x2D) sorts before
the base name's `.` (0x2E)). `--latest` considers only **regular files** matching `mathion-backup-*.tar.gz` in
the validated `backups/` dir; zero matches → clear error.

### Streaming `Runner` extension (`cli/internal/compose`)

`Runner` gains two streaming methods so a large dump/tar/restore never buffers in a Go string:

- `Stream(ctx, stdout io.Writer, args ...string) error` — child **stdout → `stdout`** only; child **stderr
  captured into the returned error** (never merged into `stdout`, which would corrupt a `-Fc` dump or a tar),
  and never echoed for `pg_*` (see Secrets constraint). A non-zero exit **always** yields a non-nil error;
  callers discard the partial output file (skip sha256/assembly) on any error. The returned error exposes
  **both** the exit code (so the assets-tar caller can treat GNU tar's exit **1** — "file changed as we read
  it" — as a non-fatal warning while still failing on **≥2**) **and** the raw captured stderr (so the `pg_*`
  caller can spool it to the `0600` file and substitute a scrubbed error).
- `StreamIn(ctx, stdin io.Reader, args ...string) error` — feeds `stdin` (drained to EOF); **prioritizes the
  command's non-zero exit + captured stderr over a stdin-copy `EPIPE`/`io.ErrClosedPipe`** (a
  `pg_restore`/`psql` early abort stops reading stdin → the Go copy sees a broken pipe; the real error is the
  command's). The restore command (below) is wrapped so the container `sh -c` exits with the **real** failing
  status, making this contract meaningful.
- **Env-aware variants for the target-image one-offs** — because plain `App.compose` cannot set a per-subprocess
  env var (see Compose-invocation constraint), add `RunEnv(ctx, env []string, args ...string) error` (setting
  `cmd.Env = append(sanitizedEnviron(), env...)` — the **sanitized** baseline of the env-poisoning constraint,
  with the caller's `env` appended **last** so it wins); `update` step 7 uses it with
  `env=["MATHION_VERSION=<target>"]` so *only that one-off migrate* runs the target image. Add the streaming
  analog **`StreamInEnv(ctx, env
  []string, stdin io.Reader, args ...string) error`** — same env override, same stdin/exit contract as
  `StreamIn` — because **`restore`'s asset extractor must run the *manifest target* image, not the current
  `.env` tag** (the `.env` is not re-pinned until the last step, so a plain `compose run app` would interpolate
  the **old/failed** tag — see restore step 8 / the auto-rollback tool-availability hazard). `FakeRunner`
  **captures the passed `env`** on both (e.g. `EnvCalls [][]string` alongside `Calls`) so the unit test can
  assert `MATHION_VERSION=<target>` was set for the migrate/asset one-off and nowhere else — a plain `Run`
  recorder is blind to env and could not catch a mis-wire that silently runs the wrong image.
- `FakeRunner` **also captures each call's context *state* at call time** (round-13) — the current double takes
  `ctx` as `_` and discards it (`runner.go:42`), so a test asserting only that a call was *recorded* is **blind to
  context state** and cannot tell the round-12 `WithoutCancel` fix from the buggy cancelled-`ctx` reuse (both
  record the call). The capture must be a **call-time snapshot** — record each call's `ctx.Err()` and
  `ctx.Deadline()` **when the fake receives the call** (parallel to `Calls`/`EnvCalls`). Do **not** stash the raw
  `context.Context` and inspect `Err()` only *after* `restore` returns (round-14 caution): the restart's mandatory
  `defer cancel()` will have fired by then, so even the correctly-built live context reads `Err()!=nil` and the
  test cannot distinguish fix from bug. (Asserting inside a `RunFunc` callback, while the call is live, is the
  equivalent alternative.) The snapshot lets a test assert the restart ran under a **live, bounded** context rather
  than the cancelled one `exec.CommandContext` would refuse.
- `FakeRunner` gains `StreamFunc(w io.Writer, args []string) error` and `StreamInFunc(r io.Reader, args []string) error`
  (mirroring `RunFunc`/`OutputFunc`; growth is safe — every test double embeds `FakeRunner`) so unit tests can
  **produce** deterministic `db.dump`/`assets.tar` bytes (real sha256/assembly) and **drain/capture** fed stdin.

## `mathion backup [--out <path>]`

Online, near-zero-downtime (the routine operator snapshot). The engine is **lock-free** (caller holds the lock).

1. **Preconditions:** recognized install (root; `install-state` + `.env` present) and **`db` running**
   (needed for the dump). Assets are read via a one-off container (below), so `app` need not be up. Clear
   error if `db` is down (*"start the stack first: `mathion start`"*).
2. **DB dump** → `Stream` to `staging/db.dump`:
   `compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"'`.
3. **Assets** → `Stream` to `staging/assets.tar`, via a **one-off** container (works whether `app` is up or
   down — reused unchanged by the offline auto-backup in `update`):
   `compose run --rm --no-deps --pull never -T app sh -c 'tar -C /data/mathion/assets -cf - .'` (`--pull never`
   so a locally-absent active image **fails the backup** — cleanly, pre-mutation — rather than silently pulling
   and moving the active tag; round-10 #1).
   For this **online** command, tar exit **1** (a concurrent upload changed a file mid-read) is a best-effort
   warning, not a failure. **Ordering: DB dump first, then assets.** This app is upload-dominant, so the
   DB-before-assets skew biases any in-window change toward a *harmless orphan file* (file present, no row)
   rather than a *dangling reference*; the residual skew is documented as inherent to an online snapshot.
   (`update`'s auto-backup avoids the skew entirely by stopping `app` first.)
4. **Alembic revision (informational):** `compose run --rm --no-deps --pull never -T app alembic current` — a **one-off**
   (works whether `app` is up or down, so `update`'s offline auto-backup still records the revision) → parse
   **defensively** (first revision-shaped token of the last non-empty line; strip a trailing `(head)`;
   tolerate empty/multi-head). Never load-bearing.
5. **Probe `image_id`** (the immutable identity for the manifest): `docker inspect <app container> --format
   '{{.Image}}'` — the resolved image ID the deployment is on. This works for the **offline** auto-backup too:
   `update` step 5 does `compose stop app` (**not** `down`), so the app container still exists and is
   inspectable. Fallbacks if no app container exists (a fully-`down` stack): `docker image inspect
   imageRepo:<.env MATHION_VERSION> --format '{{.Id}}'`; if even that is absent, record `image_id` empty —
   restore then takes the **tag-pull path (deferred to step 6c, post-confirmation)** and **warns** it cannot
   guarantee the exact code (it still gates on the resolved **ID** of whatever the tag yields, never a tag string). Then compute per-member sha256,
   write `manifest.json` (including `image_id`), **stream-assemble** the `.tar.gz` (temp in `backups/`).
6. **Atomic `Rename`** into `/var/lib/mathion/backups/` (archive mode 0600). If `--out <path>` is given, also
   write a copy: `--out` is an **exact file path** (its parent must already exist and should be a trusted,
   non-attacker-writable directory), opened `O_CREATE|O_EXCL|O_WRONLY|O_NOFOLLOW` mode **0600** (refuse to
   follow a symlink or clobber an existing file). The copy is **unencrypted PII** — documented. A failed
   `--out` copy exits non-zero but explicitly reports that the **managed archive succeeded at `<backups path>`**.
7. Print archive path + size. Any failure → `staging/` removed; nothing partial in `backups/`.

## `mathion restore <archive> | --latest [--yes]`

Full-state rewind; brief downtime. This is the recovery tool — it must not leave the operator worse off.
The same **lock-free** `restore(archive, opts)` engine is used by `update`'s auto-rollback.

**Trust boundary (load-time):** the outer allowlist extractor (step 2) makes an untrusted archive safe to
**unpack on the host**, but `restore` then **executes the archive's `db.dump` SQL as a Postgres superuser**
(and unpacks `assets.tar` into the app's volume). A fully malicious archive can therefore run arbitrary SQL
in the `db` container (e.g. `COPY … FROM PROGRAM`) — inherent to any DB-restore tool. So `restore` is safe
against **corruption**, not against a **crafted** archive: only restore archives you trust (mathion-produced).
`--latest`/`backups/` (0700 root) is the trusted default; when given an explicit path **outside** `backups/`,
`restore` prints a warning that it will execute the archive's SQL as a database superuser.

**Recovery-archive durability (round-8 #3, honestly bounded).** The step-6b breadcrumb stores `backup_path` as an
**absolute** path so the printed `mathion restore -- <backup_path>` works from any cwd. For an archive **inside
`backups/`** (the managed, `--latest`/auto-backup default) that path is stable and root-owned, so the recovery is
fully durable. For an **external** archive the operator supplied, availability is **the operator's own** (the same
trust posture as the superuser-SQL warning): if they delete/unmount it between an interrupted restore and its
re-run, recovery of *that* archive is lost — but note the DB load is `--single-transaction`, so a crash either
**rolled back** (DB unchanged) or **committed the whole** backup DB; only assets/`.env` remain, and a re-run needs
the archive only to finish those. Crucially, a standalone `restore` **replaces** an `update` breadcrumb's pointer
but **never deletes the managed pre-update auto-backup archive** itself — that `mathion-backup-*.tar.gz` remains in
`backups/`, so `update`'s rewind point survives even a pointer replacement; the operator can always
`mathion restore -- <that managed archive>`. (We deliberately do **not** copy external archives into `backups/` —
YAGNI for a root operator who chose a transient source, and a large-archive copy is costly.)

1. **Preconditions + target:** recognized install (`.env` present, needed for `--env-file` and re-pin). Target
   is an explicit archive path, or `--latest` (see selection rule above).
2. **Extract + validate (hardened, DoS-safe):** unpack into the staging dir with an **allowlist extractor**:
   wrap the gzip stream in `io.LimitReader(gzr, maxTotalBytes+1)` so headers, bodies, padding **and skips**
   are all bounded (hitting the limit = hard abort — this defeats the "51 KB → 50 MiB skip-amplification"
   gzip-bomb where a *rejected* member's declared size is still decompressed by `tar.Next()`); **abort on the
   first entry** that is not one of the three members `manifest.json`/`db.dump`/`assets.tar` **by exact
   basename** or that has a path separator, `..`, an absolute path, a duplicate name, a header `Size` over the
   per-member cap, or a **non-regular type** (accept **only** `tar.TypeReg`/`TypeRegA`; reject symlink,
   hardlink, dir, device, FIFO — an allowlist, not a blocklist); cap the entry-iteration count; write each of
   the three via an `os.Root` bound to the staging dir (Go 1.24, as in `uninstall.go`). Then verify
   `manifest.schema==1`, `config.ValidateOCITag(manifest.mathion_version)`, and per-member **sha256 keyed on
   the fixed member names** (a manifest missing a member's hash → **hard fail**, never skip). Any failure
   aborts **before any mutation**.
   **Cap sizing — concrete defaults + override (a size cap cannot distinguish a huge *legit* backup from a huge
   *bomb*, so the two trust tiers get different ceilings):**
   - **Untrusted** (an explicit path **outside** `backups/`): **fixed, not operator-raisable** —
     `maxMemberBytesUntrusted = 2 GiB`, `maxTotalBytesUntrusted = 5 GiB`. These bound the decompression DoS of a
     crafted external archive; an external archive larger than this is refused (the operator can always *move it
     into* `backups/` if they trust it, which opts into the managed tier).
   - **Managed** (`--latest`, an explicit path **under** `backups/`, or an internal auto-rollback):
     `maxMemberBytesManaged` **default 50 GiB**, `maxTotalBytesManaged` **default 120 GiB** — sized above the
     largest plausible `db.dump`/`assets.tar` for a course deployment, and **operator-raisable** via env vars
     `MATHION_RESTORE_MAX_MEMBER_BYTES` / `MATHION_RESTORE_MAX_TOTAL_BYTES` (accept plain bytes or a `G`/`M`
     suffix; validated to a sane range `[1 GiB, 1 TiB]`; an out-of-range or unparseable value is a hard error,
     never a silent fallback). Because these are *trusted* archives, a generous ceiling is not a DoS surface.
   - `update` resolves the managed ceilings **once** and passes the *same* resolved values into step 6a
     validation **and** the later auto-rollback, so a fresh auto-backup that validates at 6a is guaranteed
     restorable by the rollback (no self-rejecting rollback), and a too-small override fails at 6a **before** any
     mutation, not mid-outage.
   - The iteration cap only needs any small `N ≥ 3` (abort-on-first-bad-entry already bounds it). **Document**
     that a legitimate archive exceeding its tier's ceiling fails `restore` and how to raise the managed tier.
3. **Pre-scan `assets.tar` (inner) for symlink/traversal:** the outer extractor only proved `assets.tar` is a
   *regular file*, not that its contents are safe. Before extracting it, walk its members in Go and **reject**
   any non-regular type other than a plain **directory** (assets legitimately nest dirs + regular files),
   any `..`, and any absolute path — otherwise a crafted `assets.tar` could plant a symlink **inside** the
   assets volume (e.g. `report.pdf → /etc/passwd`) that the backend might later serve. Abort on violation.
   (Defense in depth: the backend asset route must never follow symlinks — noted as a cross-component
   dependency. Residual, acknowledged: the pre-scan uses Go `archive/tar` while the extraction uses the
   container's GNU tar 1.35 — a PAX/GNU-extension parser differential could in theory let a member Go reads as
   regular be materialized as a symlink; no concrete differential is known for this pair, so the backend
   no-follow-symlink rule is the backstop.)
4a. **Image preflight — resolve the boot image from LOCAL images only (fully read-only: no `docker pull`, no
   `docker tag`; the prefix `update` step 6a reuses):** establish the **exact image the rewind will boot** —
   always an **image ID** (`R_id`), never a tag string — consulting **only locally-present images** via read-only
   `docker image inspect`. **No `docker pull` and no `docker tag` run in 4a** (round-9 #1): a `docker pull
   imageRepo:<v>` **assigns the local `<v>` tag** to the pulled digest — that is a **deployment-tag mutation**,
   not merely "obtaining an image" — so, like the retag, it must not happen before the operator confirms; both
   the pull (if needed) and the retag are deferred to **step 6c** (after confirmation + the durable breadcrumb).
   **Consult `manifest.image_id` first**, then the local tag:
   - `manifest.image_id` **present and locally available** (`docker image inspect <manifest.image_id>`
     succeeds — **always** true on an auto-rollback, since the pre-update image was just running): `R_id =
     manifest.image_id`, **no pull needed**. (Checking the recorded ID **first** avoids an unnecessary,
     tag-moving pull — round-5 #5.)
   - else `docker image inspect imageRepo:<manifest.version>` resolves **locally**: `R_id =` that tag's
     currently-resolved local ID; warn loudly if `manifest.image_id` is non-empty and **differs** (the exact
     backed-up code is pruned locally; DB/assets still rewind, the "same code" half cannot be met).
   - else **`R_id` is left UNRESOLVED and a pull is flagged for step 6c** — the recorded id is not local and the
     tag is not local. `update`'s 6a validation ends here: an auto-rollback's pre-update image is **guaranteed
     local**, so 6a always resolves `R_id` locally and never flags a pull; a fresh-backup image that is somehow
     **not** local fails 6a **before any update mutation**. A **standalone `restore`** carries the pull flag into
     6c (the pull happens post-confirmation, still **before** step 7's DROP, so a pull failure aborts with data
     intact).
   When `R_id` is resolved here, record it as the **gate target `T_id`** for step 10 (the gate **always** compares
   resolved **IDs**, never a tag string); when it is pull-flagged, `T_id` is finalized at 6c after the pull. **6a
   runs the 4a prefix only** and never reaches 6c, so it cannot clobber the target image `update` pulled at step 4;
   the actual `restore` and the auto-rollback run 4a here **then** the pull/retag at 6c.
5. **Confirmation (destructive):** print *"This REPLACES the current database and assets with backup `<name>`
   (version `<v>`, created `<ts>`). Current data is lost. Type the project name (`<app.Project>`) to
   confirm:"* (plus the untrusted-path warning if applicable). `--yes` bypasses (and the internal
   auto-rollback caller always bypasses).
6. **Bring `db` up, stop `app`:** first **capture the pre-restore state** (round-11 #1) — the current `app`
   container **ID** and whether it is **running + health-passing** (`docker inspect`), plus whether a **breadcrumb
   was already present at entry** (known from the entry-check, which lets an exempt `restore` proceed *with* the
   breadcrumb) — so step 6c can decide whether restarting the captured container on a pull failure is safe. Then
   `compose up -d --pull never db` (idempotent — enables restore even after a full-stack crash; `--pull never` so
   a missing `postgres:17` **fails** instead of silently pulling — round-10 #1) then `compose stop app` (no
   writers during the load).
6b. **(standalone `restore` only) Write the durable restore breadcrumb — before the pull/retag and the destructive
   load (round-7 #2):** before step 6c's pull/retag and step 7's `DROP SCHEMA`, write `backups/.update-journal.json`
   (0600) = `{schema:1, created_at, kind:"restore", target_tag:<manifest.mathion_version>,
   target_image_id:<R_id or absent>, backup_path:<absolute path of the archive being restored>}` with the same
   **directory-level durability** (`AtomicWrite` + parent-dir fsync) the update breadcrumb uses. When 4a resolved
   `R_id` locally, `target_image_id` is written now; when 4a **pull-flagged** it (round-9 #1), `target_image_id`
   is **absent** here and **finalized at 6c** after the pull — an **absent `target_image_id` disables the
   manual-clear escape and stays fail-closed** (the operator cannot verify identity, so re-running `restore` is
   the only recovery, which is correct). `backup_path` is
   resolved to an **absolute** path (round-8 #3) so the printed recovery command works from any cwd. This closes
   the window where a `restore` interrupted **after** the step-7 DB load commits but **before** the step-9 `.env`
   re-pin would leave `.env` pinned to the *old* tag over a *rewound* schema with **no** guard — `start` would
   then boot the wrong image against the restored DB, and `backup` would archive an inconsistent (`.env`-vs-DB)
   state. On a crash the breadcrumb makes the next non-exempt command **refuse** and points at re-running
   `mathion restore -- <backup_path>` (idempotent → completes the restore). Recovery = the **same** archive, so
   `backup_path` is the archive being restored. **This step is skipped when the restore engine is invoked
   in-process by `update`** (its 6a validation, which never reaches step 7, and its auto-rollback, which is
   already covered by the *update* breadcrumb — the rollback **reuses/retains** that breadcrumb rather than
   writing a second `kind:"restore"` one, per round-7 #2); a `writeBreadcrumb` flag the standalone command sets
   and `update` clears distinguishes them. Because the retag is now step 6c (**after** this write and after
   confirmation), a **declined confirmation or a pure step-6 failure leaves neither breadcrumb nor retag —
   nothing deployment-affecting was mutated, so `start` is free** (round-8 #2).
6c. **Obtain + identity retag (mutating — pull if flagged, then retag onto the boot tag; runs for `restore` +
   auto-rollback, NOT `update`'s 6a):** now that the operator has confirmed (step 5) and the breadcrumb is durable
   (6b, for a standalone restore), perform the deferred image mutations — this is the **only** place a `restore`
   moves a tag (round-8 #2 + round-9 #1):
   - **If 4a pull-flagged** `R_id` (recorded id + tag both absent locally): `docker pull imageRepo:<manifest.version>`
     **now** (this assigns the local `<v>` tag to the pulled digest); set `R_id` = the pulled tag's resolved ID;
     warn loudly if `manifest.image_id` is non-empty and **differs** (backed-up code gone locally and upstream).
     A **pull error is STATE-UNCERTAIN and RETAINS the breadcrumb (round-10 #3):** a CLI-level pull error does
     **not** prove the daemon did not already assign the tag — the daemon can finish the pull (moving
     `<v>` → the new ID) and the client then lose the response (lost-acknowledgement), exactly the create/observe
     race the worker-cleanup loop already guards elsewhere. So on **any** post-breadcrumb pull error the engine
     **leaves the breadcrumb in place** and aborts; the retained breadcrumb makes the next `up`-based command
     **refuse** until the operator re-runs `restore` (a genuinely-pulled image is then local, so the re-run's 4a
     resolves it and completes; a genuinely unavailable image fails again — either way, no unguarded boot).
     **Whether to bring `app` back up is gated on the *pre-restore* state (round-11 #1):** only a **clean
     standalone restore** — one that entered with **no pre-existing breadcrumb** *and* whose `app` was **running
     and health-passing at entry** (both captured at step 6 before `stop app`) — may best-effort restart its
     captured container with **`docker start <pre-restore-app-container-id>`** (the **existing** container by ID —
     **not** `compose start app --pull never`, which is invalid: `compose start` has **no** `--pull` flag; and
     `docker start` by ID neither pulls nor recreates, so it re-boots exactly the *pre-restore* image, immune to
     any tag move). **This restart MUST run under `context.WithoutCancel(ctx)` (round-12):** the pull error that
     triggers it is frequently a Ctrl-C — the interrupt handler cancels `ctx`, `docker pull` returns, and the
     restart runs on the *same* cancelled `ctx`; because `ExecRunner.Run` uses `exec.CommandContext`
     (`runner.go:25`), a cancelled context makes it **refuse to even start** the `docker start`, leaving the
     previously-healthy `app` **stopped** behind a retained breadcrumb whose `target_image_id` is still absent
     (manual-clear disabled) — the operator is stranded. Detaching the restart from the cancelled `ctx` lets the
     pre-restore container come back up — construct the restart context **exactly** as
     **`restartCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), restartTimeout)` (`defer cancel()`)**,
     order-critical (round-13): **`WithoutCancel` must wrap `ctx` first, *then* `WithTimeout`** — the reverse,
     `context.WithoutCancel(context.WithTimeout(ctx, d))`, strips the deadline it just added (`WithoutCancel` drops
     the parent's cancellation *and* its deadline), leaving the restart effectively unbounded. `restartTimeout` is a
     **named constant (`30 * time.Second`)** — long enough that a legitimate `docker start` of an already-built
     container completes, short enough that a wedged daemon cannot hang the recovery indefinitely. This
     mirrors the worker-cleanup / auto-rollback commands, which already run under `context.WithoutCancel` for
     exactly this reason. **The breadcrumb is retained regardless of whether the restart succeeds** — the restart
     is pure best-effort; failing it never clears state. **In every other case the engine leaves `app` stopped** — most importantly when restore was
     entered **as recovery** (a breadcrumb was already present) or the pre-restore app was not confirmed healthy:
     restarting there could boot an *inconsistent* pre-restore container (e.g. an interrupted `update`'s old `v1`
     app against a forward-migrated `v2` DB — the exact half-migrated boot refuse-on-crash forbids, and one the
     CLI-level breadcrumb does **not** stop from serving traffic). The breadcrumb is cleared **only** on the
     step-10 gate (positive proof the correct image is serving), never on a mere pull error. On pull **success**,
     **finalize the breadcrumb**: atomically re-write it with `target_image_id = R_id` (re-enabling the
     manual-clear escape).
   - **Retag if needed:** if `imageRepo:<manifest.version>` does **not** already resolve to `R_id` (the mutable
     tag moved off the backed-up image, or `R_id` is a still-local `manifest.image_id` the current tag no longer
     points at), `docker tag <R_id> imageRepo:<manifest.version>` — so step 9's `compose up` boots **exactly**
     `R_id`. (After a pull the tag already resolves to `R_id`, so no retag runs; the retag is for the local-`R_id`
     case.)
   Record `R_id` as the **gate target `T_id`** for step 10. Both operations touch only a local tag **label** (no
   data) and are idempotent, and — being **after** 6b — any interrupt between them and the gate is covered by the
   breadcrumb (the auto-rollback's retag is likewise covered by the retained *update* breadcrumb). **`update`'s 6a
   validation runs the 4a prefix only** and never reaches 6c, so it cannot clobber the target image `update`
   pulled at step 4.
7. **Restore DB (atomic, schema-reset, decode-gated — no silent wipe; killable one-off):** `pg_restore` must
   fully decode the `-Fc` archive **before** the destructive `DROP SCHEMA` runs, otherwise a mid-stream
   `pg_restore` failure leaves `psql` with a truncated-but-valid `DROP/CREATE SCHEMA` script that it **commits**
   (empty DB) and the dash pipeline reports success (no `pipefail`). Stage the decoded SQL to a container-side
   temp file, gate the `psql` load on `pg_restore`'s exit, and have the whole `sh -c` exit with the **real**
   status (validated on `postgres:17`), feeding `db.dump` on stdin via `StreamIn`. Run it as a **named one-off**
   (`compose run … db`, **not** `compose exec`) so cancellation can force-remove the **entire** decode+load
   lifecycle atomically (see Cancellation — a `compose exec`'d `psql` cannot be reliably killed, and worse, the
   backend does not even exist yet while `pg_restore` is still decoding, defeating any "terminate the backend"
   approach). The one-off is a `postgres:17` client (the `db` service image) connecting to the running `db`
   over the compose network via `-h db`; it does **not** start a postmaster (its command is `sh -c`, which the
   postgres entrypoint execs directly — no initdb, so the inherited `pgdata` mount is inert). The `db` service
   has **no `env_file`**; its `$POSTGRES_*` come from its **`environment:` block**, which compose interpolates
   from `${POSTGRES_*}` in `--env-file /etc/mathion/.env` — now the **sole** authority (a host-exported
   `POSTGRES_PASSWORD` cannot override it, per the sanitized-env constraint). No host-side credential appears in
   argv, and the `--label io.mathion.worker=1` lets the startup orphan sweep reap this container by label:
   ```
   compose run --rm --no-deps --pull never --name mathion_restore_db_<pid> --label io.mathion.worker=1 -T db sh -c 't=$(mktemp) || exit 1; r=$(mktemp) || { rm -f "$t"; exit 1; }; pg_restore -f "$t"; rc=$?; if [ "$rc" -ne 0 ]; then rm -f "$t" "$r"; exit "$rc"; fi; printf "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION \"%s\";\n" "$POSTGRES_USER" > "$r" || { rm -f "$t" "$r"; exit 1; }; PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction -f "$r" -f "$t" -U "$POSTGRES_USER" -d "$POSTGRES_DB"; rc=$?; rm -f "$t" "$r"; exit "$rc"'
   ```
   (A `compose run` one-off does **not** claim the `db` service's network alias — that is opt-in via
   `--use-aliases`, which we do **not** pass — so `psql -h db` resolves to the real running `db` service, never
   round-robins to this postmaster-less client. `-Fc` is still read from the non-seekable stdin pipe.)
   (The explicit `rc=$?; rm -f "$t" "$r"; exit "$rc"` on every branch is kept — **not** a `trap … EXIT` — for
   guaranteed exit-status propagation in dash; `$t`/`$r` are cleaned on every path psql can reach, and the
   `--rm` one-off removes them wholesale on force-remove. Because this is a **named one-off container** (not an
   `exec` into the long-lived `db`), cancellation force-removes the whole container — killing `pg_restore`/`psql`
   at *any* lifecycle stage, including while `pg_restore` is still decoding and no backend exists yet — see
   Cancellation.)
   The schema reset (written to a second temp file `$r`) and the decoded dump (`$t`) are given to psql as
   **two `-f` files in one `--single-transaction`** — deliberately **no producer pipeline** (`{ printf; cat
   "$t"; } | psql` is rejected: dash has no `pipefail`, so if `cat "$t"` failed after emitting the `DROP/CREATE`
   prefix, psql would commit a valid truncated transaction and the pipeline would report psql's `0` — the exact
   silent-wipe class the decode-gate was meant to kill, merely moved from `pg_restore` to `cat`). With `-f "$r"
   -f "$t"`, psql itself opens both files under one `BEGIN … COMMIT` (verified `BEGIN … ROLLBACK` on PG17;
   `-f` is the documented `--single-transaction` form); a mid-read failure of *either* file makes psql error
   under `ON_ERROR_STOP` → the whole transaction (including the `DROP`) rolls back → **DB unchanged**, and the
   command's exit status is psql's (authoritative). The decode-gate (`pg_restore -f "$t"` checked before the
   reset is even written) ensures the `DROP` never runs on a partial dump. Schema-reset (vs `pg_restore --clean`, rejected)
   makes the load idempotent and immune to FK-bearing schema drift (the auto-rollback case after a forward
   migration). The temp file holds the **fully-decoded dump SQL** — schema **plus all row data** (COPY blocks),
   so it can be **large** (often bigger than the `-Fc` input); size the `db` container's writable/temp layer
   accordingly — and it **fails safe** (mktemp/`pg_restore` ENOSPC → abort **before** `DROP`, DB intact);
   `pg_restore -f "$t"` still reads the `-Fc` archive from the non-seekable stdin pipe (verified). A code
   comment forbids ever adding `-j`/`-l`/`-L` (need a seekable input). No `--no-owner` needed (sole role owns
   everything). The `printf "…AUTHORIZATION \"%s\"…" "$POSTGRES_USER"` is injection-safe because `%s` does not
   re-interpret its argument and `POSTGRES_USER` is operator-set in `.env` (`GenerateEnv` hardcodes `mathion`),
   never archive-derived — identifier safety rests on `POSTGRES_USER` carrying no `"` (a documented assumption).
   `db_name` cross-check: warn if `manifest.db_name` ≠ the container `POSTGRES_DB`; the load always uses the container's.
8. **Restore assets (on the *manifest target* image):** a **named** one-off, `app` still stopped, over the
   **pre-scanned** `assets.tar`, run via **`StreamInEnv` with `env=["MATHION_VERSION=<manifest.version>"]`** so
   it uses the **validated** target image — **not** the current `.env` tag, which is not re-pinned until step 9
   and could be a missing/failed image (a plain `compose run app` would interpolate it and fail, or, on an
   auto-rollback, run the *failed candidate* image which may lack `tar`/`find` and defeat the rollback):
   `StreamInEnv(ctx, ["MATHION_VERSION=<manifest.version>"], assetsTar, a.composeArgs("run","--rm","--no-deps","--pull","never","--name","mathion_restore_assets_<pid>","--label","io.mathion.worker=1","-T","app","sh","-c",'find /data/mathion/assets -mindepth 1 -delete && tar --no-same-owner -C /data/mathion/assets -xf -')...)` (`--pull never` — the target image is already local via 6c)
   (`find -mindepth 1 -delete` clears contents incl. dotfiles without removing the mountpoint; `--no-same-owner`
   since the container runs as uid 10001; `&&` prevents extract after a failed clear). DB first because it's
   transactional; if assets fail after the DB is in, report it explicitly — re-running the same restore is
   idempotent. The **`--name`** lets cancellation force-remove a still-running clear/extract (see Cancellation).

**Cancellation (restore's destructive workers must not survive the CLI or outlive the lock).** `exec.Command`
cancellation kills only the **local** docker client, not the work it started server-side: a killed one-off
leaves its container (step-7 decode+`psql`, step-8 clear/extract) running and mutating — which could overlap a
*subsequent* command once the flock releases. Because **both** destructive workers are now **named one-off
containers**, on **any error return from either destructive `compose run`** — a context cancellation, a
transport/daemon error, **or** a clean non-zero exit (round-5 #3: a daemon-transport loss with `ctx` still live
must **not** leave the worker running past lock release) — the restore engine, **before returning (i.e. before
the lock is released)** and under a fresh **`context.WithoutCancel`**, force-removes **both**
`mathion_restore_db_<pid>` and `mathion_restore_assets_<pid>` with the **same launch-resolved / stably-absent
loop** the migrate cleanup uses (repeat `docker rm -f` + `inspect` until the `compose run` call has returned
**and** the name is stably
absent — closing the create/observe race where a signal lands between compose *submitting* the create and the
daemon *registering* it). Force-removing the **container** (not terminating a backend) kills the worker at
**any** lifecycle stage — including while `pg_restore` is still decoding and **no** `psql` backend exists yet
(the exact TOCTOU that a "terminate the tagged backend" approach cannot cover); a `--single-transaction` load
killed mid-flight rolls back (DB unchanged), a killed decode has committed nothing. A **second** signal (or a
`SIGKILL`) skips this graceful cleanup — the **startup orphan sweep** (Global Constraints) is the backstop:
the *next* lock-taking command, holding the lock, force-removes any leftover `mathion_restore_*`/`mathion_migrate_*`
container before doing its own work, since under the lock they can only be dead orphans. **Worker cleanup never
touches the step-6b restore breadcrumb:** on *every* error/cancel/crash path the standalone restore **retains**
it (it is cleared *only* after the step-10 gate), so a restore interrupted after the DB committed keeps the
breadcrumb that makes the next non-exempt command refuse (round-7 #2) — force-removing the worker container and
retaining the breadcrumb are independent.
9. **Re-pin + recreate:** line-oriented `.env` re-pin `MATHION_VERSION=<manifest.mathion_version>` (already
   validated; assert-after-write) → `compose up -d --wait --pull never app` (image guaranteed available and
   retagged to `R_id` per step 6c, so `--pull never` never fails here; `--wait` blocks on the compose
   healthcheck, whose own budget governs "healthy in time").
10. **Gate (image-identity by resolved ID; `/version` legacy-tolerant):** `up -d --wait` (step 9) already
    confirmed the compose healthcheck — which probes `/health`, present in **every** image including
    pre-slice-3 ones — so the app is serving. The authoritative check is then **image-identity by resolved
    ID, not tag string**: `docker inspect <running app container> --format '{{.Image}}'` must equal **`T_id`**
    (the exact image ID resolved in the step-4a preflight — after 6c's retag-to-recorded-`image_id`). Comparing
    IDs (not `.Config.Image`, a mutable tag string) is what makes this prove the *correct code* is deployed, and
    it works for **every** image. `/version` is only a **secondary** confirmation, polled within
    `gateTimeout`/`pollInterval`: a response whose body is **exactly** the JSON `{"version": "<target>"}` shape
    passes; the **only** tolerated legacy responses are the **two verified pre-slice-3 shapes — a `404`, or a
    `200 text/html` `index.html` SPA shell** (the shipped `v0.1.1` has no `/version` route but **does** serve the
    SPA catch-all, so `GET /version` returns `200` HTML, **not** 404 — verified against `main.py`'s
    `_spa_fallback`) — which are treated as "route unavailable, image-ID already proved the deploy". **Anything
    else fails the gate**: a well-formed version JSON with a *different* version, a `401`/`403`, a `5xx`, a
    malformed/non-SPA body, or connection-refused *after* a passing healthcheck (these signal a genuinely broken
    app, not a legacy one). (Without the two-shape tolerance, restoring — or auto-rolling-back — to `v0.1.1`
    would read the SPA shell as a bad version and be mis-reported as a failed restore / trip auto-rollback's
    exit 3.) **Only after the gate passes**, a **standalone** `restore` `RemoveSync`s its step-6b breadcrumb
    (unlink + parent-dir fsync); as with `update`'s post-gate cleanup, a *failed* `RemoveSync` here is a
    **non-fatal warning** ("restored successfully; remove `<journal_path>` manually"), never a failure of the
    committed restore (the restore is done the moment the gate passes). Print *"restored to `<version>` from
    `<archive>`"*. The engine's `defer` removes its staging dir.

## `mathion update [--version <tag>] [--no-rollback] [--yes]`

Strict ordering so validation + a **consistent, offline** backup happen **before** any mutation, and the `.env`
re-pin happens **last** (so an interrupt cannot strand a `.env`=new / schema=old state that the no-op guard
then masks). `app` is stopped for the backup + migration (steps 5–8). **Honest scope of the "no data loss"
claim:** step 9 (`up -d --wait app`) *publishes* `127.0.0.1:8000` and, once compose reports healthy, the app
is reachable while the step-10 gate confirms `/version`; a write committed in that brief bring-up-and-gate
window (and, more relevantly, while a *health-passing-but-gate-failing* candidate is up) would be discarded by
an auto-rollback. This slice does **not** own ingress (the operator's reverse proxy does; a bundled
maintenance-mode toggle is Slice 5), so `update` **requires the operator to block external traffic first**
(maintenance window) and the window is minimized (see the gate below). The **unconditional** guarantee is only
that the pre-update backup is a **consistent, intact rewind point** — not that zero writes are lost if the
operator leaves ingress open.

1. **Preconditions:** recognized install, docker ok, stack **running**, **and `config.ValidateEnvComplete`**
   (Global Constraints) — which now also `ValidateOCITag`s `MATHION_VERSION` (round-10 #2), so the guard below
   compares the target against a **canonical `.env` tag equal to Compose's effective tag** (a quoted/interpolated
   `MATHION_VERSION` has already failed the precondition). (`EnsureBackupsDir` + advisory lock are already taken
   at the command layer, per Global Constraints.)
2. **Resolve target + same-tag guard (round-9 #2 — `update` NEVER pulls the active tag):** `--version` or the
   baked recommended default (`buildDefaultImage`); validate with `config.ValidateOCITag`. **If the target equals
   the (validated) `.env` `MATHION_VERSION` (the *active* tag), `update` does not proceed to step 4's pull** — pulling
   `imageRepo:<target>` would **move the active deployment tag** (mutable tags drift upstream) **before** any
   backup or breadcrumb exists, so a crash before step 6b would leave an **unverified** image that `start`'s
   `compose up` boots against the un-migrated schema with **no** refusal. Two same-tag sub-cases, **both without a
   pull**: (a) the **running** `/version` parses as JSON `{"version": <target>}` → clean no-op, *"already at
   `<v>`; nothing to do"*, exit 0; (b) otherwise — a legacy image's `200 text/html` SPA shell, a `/version`
   mismatch, or an unreachable app → *"already pinned to `<v>`; a same-version refresh is not supported. To
   redeploy or repair a broken deployment, use `mathion restore` or reinstall."*, exit 0. Only a **distinct**
   target proceeds. (Version tags are immutable by convention, so refusing a same-version re-pull costs no
   legitimate capability, and it removes the sole path by which `update` could move the *active* tag pre-backup;
   a different target's pull at step 4 moves only that **non-active** tag, which a crash leaves harmless — `.env`
   still pins the old tag, so `start` boots the old image.) Because re-pin is last, a *completed* prior update
   leaves `.env`=target; an *interrupted* prior update never reaches this guard at all — its breadcrumb makes the
   command-layer entry-check **refuse** first, so the guard only ever runs against a clean, non-interrupted state.
3. **Confirm:** print the plan (*"Update `<old>` → `<new>`: pull-verified → stop → back up → migrate →
   health-check"*), then the failure clause **branched on the flag**: default → *"**auto-rollback on failure**"*;
   `--no-rollback` → *"**on failure the stack is left as-is; recover with `mathion restore -- <backup>`**"*. Then
   *"Brief downtime during the update; block external traffic first. Continue? [y/N]"*. `--yes` skips. Simple
   y/N (recoverable by design; not a typed name).
4. **Pull** `imageRepo:<target>` explicitly — a plain `docker pull <repo>:<target>` via the `Runner` (a
   non-compose call, like `dockerx`'s existing `docker ps`/`rm`), validating the tag **without** re-pinning
   `.env`. By step 2's same-tag guard the **target is distinct from the active `.env` tag** (round-9 #2), so this
   pull moves only a **non-active** tag — a crash between here and step 6b leaves `.env` still pinning the old
   tag, so `start` boots the old image, not this unverified pull. **Immediately capture the pulled target image ID
   `A`** (`docker image inspect imageRepo:<target> --format '{{.Id}}'`): the step-10 gate compares the running
   app's resolved ID against **this captured `A`**,
   **not** a tag re-resolved at gate time — an auto-rollback's 6c retag, or any concurrent tag move, could shift
   what `imageRepo:<target>` resolves to between pull and gate, so pinning `A` at pull time closes that window.
   Bad tag / network fail → **clean abort, nothing changed, no backup taken.**
5. **Stop `app`** (`compose stop app`; `db` stays up) — quiesces writes; `start`/`stop` also hold the lock, so
   nothing brings `app` back up during the window.
6. **Auto-backup** (the lock-free backup engine, now **offline** → DB + assets are a consistent snapshot;
   retained in `backups/`) — the rollback point. **If the backup fails, `compose start app` (uncancelled
   context) and abort.**
6a. **Validate the rollback point before mutating:** run the **non-mutating prefix** of the restore engine
   (steps 2–4a: allowlist-extract + per-member sha256 + manifest checks + inner `assets.tar` pre-scan + image
   preflight **through 4a only — no 6c retag**, so it cannot clobber the target image pulled at step 4) against
   the just-created auto-backup — so `update` never mutates without a *proven-restorable* backup. Because this
   uses **exactly** the ceiling the later auto-rollback will use, an archive backup produced but restore would
   reject (the cap note in restore step 2) is caught **here**, before migration, as a clean pre-mutation abort —
   not as a self-rejecting auto-rollback mid-outage. Failure → abort (`compose start app`, uncancelled context),
   nothing mutated.
6b. **Write the durable update journal *breadcrumb* — before *any* mutation:** the crash-resume record (see
   "Crash-resume" below) is written **now**, after the backup is validated (6a) but **before** the migrate (7)
   touches the schema, recording `{schema:1, created_at, kind:"update", old_tag, target_tag, target_image_id,
   backup_path}` — the **`kind:"update"` discriminator is required** (round-8 #1): the entry-check routes solely
   by `kind`, and a **missing or unknown `kind` fails closed** (the command still **refuses**, printing
   `backup_path` when it decodes safely, rather than fail-open) — with **directory-level durability**
   (`AtomicWrite` + parent-dir fsync). This is a **breadcrumb, not a recovery
   state machine**: if a crash / `SIGKILL` / power-loss / interrupt leaves it behind, the **next non-exempt
   command refuses** and points the operator at `mathion restore <backup_path>` — **no command ever
   auto-restores from it** (refuse-on-crash; see the Crash-resume matrix). Deliberately **absent**: no
   `rollback_allowed` (the `--no-rollback` policy is an in-process decision, moot once the process is gone — a
   crashed update of *either* kind refuses identically, so the flag needs no durable state), and no
   `migrate_container_name` (an orphaned migrate worker is reaped by the **label-based startup sweep**, not by a
   name read back from the journal). `target_image_id` is the **captured target ID `A`** from step 4, present so
   the refuse path's **manual-clear escape is verifiable** (round-5 #5): `/version` is env-derived and would
   report `<target>` even if a moved tag booted a *different* image, so the escape requires the operator to
   confirm `docker inspect --format '{{.Image}}' <app-container>` == `target_image_id` — **not** `/version` alone — before removing
   the breadcrumb. Every field is *read* on refuse (`backup_path` → the printed restore command;
   `old_tag`/`target_tag` → the "interrupted from `<old>` toward `<target>`" diagnostic; `target_image_id` → the
   escape's identity check) — no dead state. Because the breadcrumb is fsync'd before the migrate, no power-loss can leave a mutated schema
   with no breadcrumb pointing at the rewind backup. **6b is pre-mutation:** if the write itself fails (e.g. the
   parent-dir `fsync` returns `EIO` after the rename), attempt `RemoveSync` **idempotently** to clear any
   partial breadcrumb, `compose start app` (uncancelled context), and abort — reporting both errors if the
   cleanup is not durable; nothing was migrated.
7. **Migrate without serving and without re-pinning:** via the env-aware `RunEnv` (a plain `App.compose`
   **cannot** set the env — see the Runner extension), run
   `RunEnv(ctx, ["MATHION_VERSION=<target>"], a.composeArgs("run","--rm","--no-deps","--pull","never","--name","mathion_migrate_<pid>","--label","io.mathion.worker=1","-T","app","alembic","upgrade","head")...)` (`--pull never` — the target was already `docker pull`ed at step 4).
   The appended `MATHION_VERSION=<target>` overrides the **sanitized** baseline (from which `.env`'s
   `MATHION_VERSION` was stripped) for compose's image interpolation, so the **one-off** runs the *target* image
   (not bound to `:8000`) while `.env` still pins the old tag. `alembic upgrade head` applies every intervening
   revision (multi-version jumps handled). A **clean** failure → in-process auto-rollback (default). The
   deterministic `--name mathion_migrate_<pid>` + `--label io.mathion.worker=1` are what let the failure/signal
   handler force-remove a still-running migrate container (see Interrupt handling — `exec.CommandContext` kills
   only the *local* client, not the daemon-side container), and let the startup sweep reap it after a `SIGKILL`.
   (If instead an implementer used a plain `run` here, `${MATHION_VERSION}` would interpolate the **old** tag →
   the migrate runs the old image, applies nothing new → the target app boots on an unmigrated schema and the
   gate fails → `update` rolls back every time. The `RunEnv`/`FakeRunner.EnvCalls` test guards this.)
8. **Re-pin** `MATHION_VERSION=<target>` (line-oriented, atomic, validated, assert-after-write) — only now,
   after migrate succeeded.
9. **Recreate:** `compose up -d --wait --pull never app` (new app on the migrated schema; `--pull never` since the
   target was already `docker pull`ed at step 4 — no implicit pull here; `--wait` blocks on the healthcheck).
10. **Gate (same image-identity-by-ID + `/version` confirmation as restore step 10):** require the running
    `app` container's resolved image **ID** (`docker inspect {{.Image}}`) == the **captured `A`** from step 4
    (**not** a re-resolution of `imageRepo:<target>` — that tag could have moved), plus a **strict** `/version`
    returning the JSON `{"version": "<target>"}` (a forward update always targets a slice-3+ image, so
    `/version` is present and must be exact here; the legacy SPA/404 tolerance applies only on the auto-rollback
    path, which reuses the restore gate and its own `T_id`). **A passing gate is the commit point — the update
    has succeeded and is *never* auto-rolled-back thereafter (round-5 #2).** Then **`RemoveSync` the breadcrumb**
    and report **success:** *"updated `<old>` → `<new>` (backup: `<path>`; prune old backups manually)"*, keep the
    backup, exit 0. **If that post-commit `RemoveSync` fails** (unlink or its parent-dir fsync errors), the
    update is already committed and healthy — do **not** enter the failure matrix / auto-rollback; instead return
    a **distinct non-rollback warning**: *"updated `<old>` → `<new>` successfully, but could not remove the
    recovery breadcrumb `<journal_path>`; the deployment is healthy — verify the app serves `<target>` (running
    image ID == `A`), then remove `<journal_path>` manually"* (exit non-zero but **not** the exit-3
    rollback-failed code; a leftover breadcrumb would otherwise make the next command refuse).

**Failure in steps 7–10, *before the step-10 gate passes* (after the backup exists) — matrix.** This covers a
**clean** failure — a step returns an error while the command context is **still live** (`ctx.Err() == nil`) —
occurring **before** the gate commits. **Once the gate passes (step 10) the update has committed** and the only
remaining action is breadcrumb cleanup, whose failure is a **non-rollback warning** (step 10), never a matrix
row (round-5 #2). A failure caused by an **interrupt**
(a `SIGINT`/`SIGTERM` that cancelled `ctx`, or a crash) does **not** auto-rollback — see Interrupt handling: the
handler force-removes the migrate worker, **leaves the breadcrumb**, and exits with the `mathion restore
<backup>` hint (refuse-on-crash). In every row below, the failure handler **first** force-removes the migrate
one-off (`mathion_migrate_<pid>`, launch-resolved/stably-absent loop, under `context.WithoutCancel`) before
rolling back or exiting — a migrate container that outlives the CLI must never race the rollback's `DROP
SCHEMA`.

| Mode | Behavior | Exit |
|---|---|---|
| default | **in-process auto-rollback:** internal `restore(pre-update backup, {yes:true})`, run under a **fresh uncancelled context** (`context.WithoutCancel(ctx)`) so it can still start docker even if a signal later cancels the original `ctx` (a cancelled context makes `exec.CommandContext` refuse to start). The rollback context is **effectively unbounded** — like the forward `pg_restore`, it inherits no deadline (a large-DB restore must not be cut off and mis-escalated to exit 3); the **second signal** (`os.Exit`) is the operator's escape. On a completed rollback, **`RemoveSync` the breadcrumb** — and if *that* unlink fails, the rollback has already finished, so it is a non-fatal warning ("rolled back; remove `<journal_path>` manually"), not a re-escalation. *"update failed at `<step>`: `<err>`; rolled back to `<old>` (healthy)"* | 1 |
| `--no-rollback` | stop; leave the failed state; **leave the breadcrumb in place** so any later refusing command (`update`/`start`/`install`/`backup`) **refuses** and points at `mathion restore -- <backup>` (and `stop` contains) — the operator's opt-out is honored and the deployment is not silently mutated; print the exact `mathion restore -- <backup>` + what failed | 1 |
| rollback **also** fails | **loud critical**, **distinct exit code 3** — the update code returns a typed `rollbackFailedError` that `Execute` maps via `errors.As` to `os.Exit(3)` (today `root.go:76-79` funnels every error to `os.Exit(1)`; a literal `os.Exit(3)` inside `RunE` would skip the lock/staging `defer`s and is not unit-testable, so the **typed-error** path is chosen and the test asserts the returned error type); the breadcrumb is **left in place** so the next non-exempt command **refuses** and points at `mathion restore -- <path>`: *"update failed AND rollback failed — the Docker daemon may be unreachable; restore it, then recover: `mathion restore -- <path>`"* (the **pre-update backup remains intact**; live state may be partial — if ingress was left open a step-9→10 write can be lost, and a rollback failing after the DB committed but before assets finished leaves partially-restored assets — the intact backup is the recovery) | 3 |

(A **step-5/6/6a/6b** failure — before *or* during the backup, the pre-migration validation, or the journal
write — is **not** in the rollback matrix: step 5 has no backup yet, and steps 6, 6a, and 6b are each handled
by `start app` (uncancelled context) + abort with **nothing migrated** (6b additionally `RemoveSync`s any
partial journal).)

Because `app` is stopped from step 5 through step 9's recreate (and `start`/`stop` honor the lock, so nothing
brings it back up mid-window), the **only** writes an auto-rollback could discard are those a client commits in
the brief step-9→10 bring-up-and-gate window — which the maintenance-window requirement (block external
traffic first) is there to close. The pre-update backup is, **unconditionally**, a consistent intact rewind
point. The cost is **downtime for the duration of backup + migration + restart** — run `update` in a
maintenance window; documented.

**Interrupt handling (signal → daemon-side cleanup → *refuse*, no auto-rollback).** `exec.CommandContext`
cancellation kills only the **local** docker client, **not** the container it launched: a cancelled
`compose run … alembic upgrade` can leave the named migrate one-off (`mathion_migrate_<pid>`) running
server-side, mutating the schema. So a `SIGINT`/`SIGTERM` is handled deliberately, **without** auto-rollback
(refuse-on-crash — an interrupt hands control to the operator, exactly like a crash):
- A small signal handler installed for the command's duration **cancels the command context on the first
  signal** and **`os.Exit(130)` on the second** (the standard two-signal pattern; the second signal is the
  escape from any long uncancellable step).
- The forward path's failure handler observes the resulting error and inspects **`ctx.Err()`**. When `ctx` was
  cancelled (an interrupt, not a clean failure), it — **all under a fresh `context.WithoutCancel(ctx)`** (a
  cancelled context makes `exec.CommandContext` refuse to *start* any docker process, so cleanup could not
  otherwise run) — force-removes the migrate container: `docker rm -f mathion_migrate_<pid>` in a **loop that
  tolerates the create/observe race** (a signal landing between compose *submitting* the create and the daemon
  *registering* it means an early `docker inspect` could report "absent" while the container then appears, so
  cleanup **repeats remove+inspect until the migrate `RunEnv` call has returned *and* the name is stably
  absent**), then **leaves the breadcrumb in place** and returns a non-zero error printing the exact `mathion
  restore <backup>` hint. It does **not** auto-rollback: the next non-exempt command will refuse and re-print
  the same hint, so the operator — not a signal handler racing a destructive `DROP SCHEMA` — decides when to
  rewind.

Because the **only** auto-rollback trigger is a **clean** failure (`ctx.Err() == nil`), handled synchronously
in the one forward-path goroutine, there is **no** second concurrent `restore` to guard against — the round-2
`sync.Once` single-owner machinery is no longer needed. (Symmetrically, a step-5/6/6a/6b abort's `compose start
app` also runs under an uncancelled context.) A `SIGKILL` or the second-signal `os.Exit` skips this graceful
cleanup — the **label-based startup orphan sweep** (Global Constraints) reaps the leftover migrate container on
the next command, and the breadcrumb makes that next command refuse.

**Cleanup on *any* uncertain migrate-launch return (round-4 #2):** the force-remove above is triggered not only
by `ctx.Done()` but by **every** path on which the migrate `RunEnv` may have created a container — a clean
non-zero exit, a transport/daemon error, or a cancellation — before the handler rolls back **or** exits **or**
releases the lock. A migrate one-off must never outlive the CLI regardless of *why* the launch call returned.

**Crash-resume via a durable recovery breadcrumb (refuse-on-crash; never boots the half-migrated schema or a
tag/DB-mismatched restore).** A `SIGKILL`/power-loss leaves no handler, so the mutating command records its
intent durably **before its destructive step** in `backups/.update-journal.json` (0600): `update` at step 6b =
`{schema:1, created_at, kind:"update", old_tag, target_tag, target_image_id, backup_path}`, and a **standalone
`restore`** at its step 6b = `{schema:1, created_at, kind:"restore", target_tag, target_image_id, backup_path}`
(round-7 #2 — `old_tag` is `update`-only). The **`kind` discriminator is mandatory** (round-8 #1): the two
kinds carry different fields and different refuse wording, and a breadcrumb with a **missing or unknown `kind`
fails closed** — the next non-exempt command still **refuses** (printing `backup_path` when it decodes safely),
never fail-open. The two never coexist: the exclusive flock serializes `update` and `restore`, and `update`'s
in-process rollback **reuses** the existing `kind:"update"` breadcrumb rather than writing a `kind:"restore"`
one. The breadcrumb is a **pointer to the recovery archive**, not a state machine: **no command ever
auto-restores from it** — the next non-exempt command simply **refuses** and prints the exact
`mathion restore -- <backup_path>` recovery command (for both kinds, re-running that restore is idempotent and
completes recovery).

- **Durability protocol (a plain file-fsync is not enough — verified against `state.go`):** the breadcrumb is
  created at the mutating command's **step 6b** (before the migrate for `update`, before the destructive load
  for standalone `restore`) via the dir-fsyncing `AtomicWrite`; the auto-backup's own `Rename` and the `.env`
  re-pin are likewise dir-fsync'd; it is cleared with **`RemoveSync`** (unlink + parent-dir fsync) **only after**
  the gate passes (step 10), after a completed in-process rollback, on a successful `restore`, or on a `--purge`.
  Ordering is thus: *breadcrumb durable → mutate (migrate / DB load) → re-pin durable → recreate → gate →
  RemoveSync*. No reordering across a power loss can leave a mutated schema/`.env` with the breadcrumb already
  gone, nor the breadcrumb gone while the recovery archive is unreferenced.
- **Entry-check — every lock-taking command**, after taking the lock and the **label-based orphan-worker
  sweep** (Global Constraints, which already force-removed any leftover migrate/restore containers) and
  **before its own work** (in particular **before `install`'s `resume` reaches its `up -d --wait`**, which
  would otherwise boot the *old* pinned image on the *forward-migrated* schema — the install-resume path is
  **not** breadcrumb-aware today, `install.go:115`), routes by command into **three outcomes**:
  - **Exempt — proceed** (they *are* recovery/teardown; exempting them avoids the deadlock where the breadcrumb
    could only be cleared by a command it blocks): **`restore`** (the operator taking over — proceeds with
    whatever archive it was given; at its own step 6b it **atomically replaces** whatever breadcrumb was present
    with its own `kind:"restore"` one pointing at that archive — so if it recovers from an `update` crash, the
    operator's chosen archive **becomes** the recovery target, and a re-interrupted recovery still refuses at the
    right archive — and **on success** `RemoveSync`s it) and **`uninstall`** (the
    entry-check only **authorizes** it to proceed — the breadcrumb is **retained through the entry-check**; a
    **`--purge`** `RemoveSync`s it **only after** the typed confirmation + successful teardown, so a
    mistyped/aborted purge cannot strand a still-startable deployment — round-6 #2; a non-purge `uninstall`
    retains it).
  - **Containment — `stop` proceeds but *retains* the breadcrumb** (round-5 #6): a failed post-step-9 candidate
    may still be running, so `stop` must let the operator **halt it immediately** — it stops the stack, prints
    the recovery hint, and **retains** the breadcrumb (so the next `update`/`start` still refuses). It **never**
    auto-recovers (which would `up` the app again) and **never** clears the breadcrumb. This gives a clean
    two-step "`mathion stop` now, `mathion restore <backup>` when ready" flow and avoids leaving a broken
    candidate reachable during a recovery `restore`'s pre-stop validation. This is the **only** rule beyond
    refuse — *not* the deleted round-3 auto-recover / `rollback_allowed` policy matrix.
  - **Refuse — `update`, `start`, `install`, `backup`** with the exact recovery command (worded by `kind`; the
    printed `<backup_path>` is the **absolute** path from the breadcrumb, **shell-quoted after `--`** so a path
    with spaces or a leading `-` is a single argument — round-8 #3):
    > `kind:"update"` — *"A previous `update` was interrupted (from `<old_tag>` toward `<target_tag>`; the
    > database may be mid-migration). Recover with:  `mathion restore -- <backup_path>`  — or, only if you have
    > confirmed the update completed (the running app's image ID equals the recorded target `<target_image_id>`),
    > remove `<journal_path>` to clear this."*
    >
    > `kind:"restore"` — *"A previous `restore` was interrupted (toward `<target_tag>` from `<backup_path>`; the
    > database may be mid-load or the `.env` tag not yet re-pinned). Recover by re-running:  `mathion restore --
    > <backup_path>`  — or, only if you have confirmed the restore completed (the running app's image ID equals
    > `<target_image_id>`), remove `<journal_path>` to clear this."*

    and exits non-zero. **No command auto-restores and none auto-recovers.** `install` must not resume-boot the
    old image on the forward schema; `backup` must not snapshot a half-migrated state; `start` must not boot the
    stack on an inconsistent DB. The secondary manual-clear escape covers the rare case where the update **or
    restore** actually **completed** but the final `RemoveSync` did not persist; it is **identity-verified** — the
    operator must confirm `docker inspect --format '{{.Image}}' <app-container>` equals the breadcrumb's
    `target_image_id` (`/version` is env-derived and would report `<target>` even on a *moved-tag* wrong image),
    which is exactly the moved-tag protection captured `A` was introduced for (round-5 #5; the `kind:"restore"`
    breadcrumb records `R_id` in the same field for the identical check). The **image-ID equality is the
    authoritative predicate** — deliberately **not** an exact-`/version`-JSON check (round-8 MINOR): a completed
    restore of a **legacy** image (e.g. `v0.1.1`, which serves a `200 text/html` SPA shell at `/version`, not
    JSON) must still be clearable, so any `/version` confirmation here uses the **same legacy tolerance as the
    gate** (exact JSON *or* a `404`/`200`-HTML shell — never a *different* well-formed version). A documented,
    root-only file.
This **replaces** both the earlier fragile "run `mathion start` to bring the old app up on the migrated schema,
then re-run `update`" dance **and** the round-3 `rollback_allowed` / auto-recover policy matrix — refuse-on-crash
makes all of that unnecessary; only `stop`'s minimal stop-and-retain **containment** survives (round-5 #6). The
breadcrumb lives in `backups/` (already `EnsureBackupsDir`-guarded, root-owned `0700`), so its integrity matches
the rewind point it references.

**Gate/timeout constants (named, not magic):** `gateTimeout` = **120s** (≥ the compose healthcheck budget:
`start_period` 10s + 20×`interval` 5s ≈ 110s) so a healthy-but-slow container is not spuriously rolled back;
`pollInterval` = 2s. `docker pull`, `alembic upgrade head`, `pg_dump`, and `pg_restore` are **intentionally
unbounded** (inherit the command context; duration is data-dependent) and covered by the SIGINT→cancel path.
Because step 9 uses `up -d --wait`, compose owns the health-wait (its budget); the gate's own work is the
**image-identity-by-resolved-ID** `docker inspect` check plus the legacy-tolerant `/version` confirmation
(step 10) — **not** a second health-wait.

## `GET /version` (backend)

Add a `version` field to the app's centralized settings (auto-reads `MATHION_VERSION` via the existing
`env_prefix="MATHION_"`), and a route next to `/health`, **before** the `/api/{rest:path}` guard and the SPA
catch-all `/{full_path:path}`:

```python
# backend/mathion/config.py — Settings (BaseSettings, model_config = {"env_prefix": "MATHION_"})
version: str = "unknown"          # reads MATHION_VERSION

# backend/mathion/main.py — next to /health (~line 151), before the catch-alls
@app.get("/version")
def version_endpoint() -> dict:
    return {"version": settings.version}
```

Use the `Settings` object (the app's convention; `main.py` does not `import os`). This is the **deploy tag**
(`MATHION_VERSION`), deliberately distinct from the static `FastAPI(title="Mathion", version="0.1.0")`. Public,
unauthenticated (mirrors `/health`), but compose binds `127.0.0.1:8000:8000`, so it is **not** exposed by
default; the shipped reverse-proxy example (Slice 5) should block `/version` (and `/health`) from the public,
so public exposure is opt-in.

## `mathion version` (CLI) — Finding #2 fix + live version

Current behavior mislabels an installed-but-unreadable deployment (non-root; `/etc/mathion` is `0700`) as
`(not installed)`. New behavior branches on the **errno of the `.env` read** (the pinned tag lives in
`.env`'s `MATHION_VERSION`, read via `ReadEnvFile`; `os.ReadFile` yields a `*PathError` so `errors.Is` works):

- `errors.Is(err, fs.ErrNotExist)` (no `.env`/`install-state`) → *"not installed"*.
- `errors.Is(err, fs.ErrPermission)` (EACCES under the `0700` dir — a non-root user cannot even observe the
  file's presence) → *"installed (run with sudo to read the pinned version)"*.
- otherwise → show the pinned `MATHION_VERSION`.
- When the stack is reachable, also GET `http://127.0.0.1:8000/version` and show the **running** version
  alongside the **pinned** one (they can differ mid-update). Endpoint unreachable → omit the running line.
- Output shape:
  ```
  mathion cli-v0.1.1
  image (pinned)  v0.1.1
  image (running) v0.1.1
  ```

## Error handling / edge cases

- **Non-root:** clear "requires root; re-run with sudo" for the **mutating** commands (new small helper);
  `version` is exempt and runs read-only as non-root (its EACCES branch depends on this).
- **Stack down:** `backup` needs `db`; `update` needs the full stack; `restore` brings `db` up itself.
- **Disk space:** best-effort — surface the underlying write error; the gzip-layer size cap bounds a
  malicious archive; the streaming atomic assembly means a failed write leaves no partial archive; backups
  accumulate (no pruning) so the `update` success line points at the path with a "prune manually" note.
- **Archive integrity vs authenticity:** per-member sha256 (fixed names) catches corruption, not tampering;
  the hardened extractors make an untrusted archive safe **to unpack**, but the DB load executes its SQL as a
  superuser (trust boundary above).
- **`.env` re-pin:** line-oriented, duplicate-collapsing, 0600, `ValidateOCITag` before + assert-target-after.
- **Gate depth (documented limitation):** `/health` is a static liveness check and `/version` env-derived, so
  the gate proves "right image (by resolved ID), process serving," not deep DB readiness. For `update`, DB
  connectivity is exercised by `alembic upgrade head` (fails → rollback); for `restore`, the DB was just loaded
  and the image previously ran clean. A deeper readiness endpoint is a possible future add.
- **Crash / power-loss during `update`:** the durable, dir-fsync'd `backups/.update-journal.json` breadcrumb
  (written at 6b before any mutation, `RemoveSync`'d only after the gate) makes recovery deterministic. After
  the flock + label-based orphan-sweep, the **next** lock-taking command routes by command: `restore` proceeds
  and clears the breadcrumb (`uninstall --purge` clears it, non-purge retains); `stop` proceeds but **retains**
  the breadcrumb (containment — halt a broken candidate without recovering); **`update`/`start`/`install`/`backup`
  refuse** and print the exact `mathion restore <backup>` recovery command (refuse-on-crash — no command
  auto-restores). It never boots the old image on a forward-migrated schema.
- **Interrupt during `restore`/rollback:** both destructive workers are **named one-off containers**
  force-removed (with the launch-resolved/stably-absent loop) before the lock releases — killing the whole
  decode+load / clear+extract lifecycle at any stage (a `--single-transaction` DB load rolls back mid-flight);
  a `SIGKILL`/second-signal is caught by the next command's **startup orphan sweep**. A second signal may leave
  assets half-restored, which a re-run fixes idempotently. **A standalone `restore` interrupted *after* its DB
  load commits but *before* its step-9 `.env` re-pin leaves its `kind:"restore"` step-6b breadcrumb in place**
  (round-7 #2), so the next non-exempt command **refuses** and points at re-running `mathion restore <backup>`
  — `start` cannot boot the old `.env` tag over the rewound schema, and `backup` cannot archive the
  `.env`-vs-DB mismatch. `update`'s in-process rollback does **not** write this breadcrumb — its `kind:"update"`
  breadcrumb already governs and is retained until the rollback completes.

## Testing

- **Unit (`FakeRunner` + new `StreamFunc`/`StreamInFunc`, `Calls` assertions):**
  - `.env` re-pin helper (**dedicated**): `SMTP_*`/comments/order survive; only `MATHION_VERSION` changes;
    duplicate `MATHION_VERSION` lines collapse to one correct value; append-if-absent; 0600; `ValidateOCITag`
    rejects a hostile tag; assert-after-write catches a defeated re-pin; `ValidateEnvComplete` re-run.
  - **`ValidateEnvComplete` strengthened (round-5 #4 + round-6 #1 + round-7 #1):** requires **non-empty
    `POSTGRES_USER` and `POSTGRES_DB`** (constrained to `^[A-Za-z_][A-Za-z0-9_]*$`) and validates the **complete
    effective DB target** of `MATHION_DATABASE_URL` — scheme `postgresql+psycopg`, host `db`, port `5432`, the
    **decoded** username/password matching `POSTGRES_USER`/`POSTGRES_PASSWORD`, and the **raw escaped** database
    path (`u.EscapedPath()`) exactly `"/" + POSTGRES_DB`. Assert the `GenerateEnv` URL passes, and that these are
    **rejected**: a divergent host (`@remote:5432/mathion`), a wrong port, **any query/fragment** (`?dbname=other`,
    `?user=other`, `?host=evil`, `?port=…`) that could override the migration target, and — the round-7 regression
    cases — **any percent-escape in the db path** that Go decodes but psycopg does not: `…@db:5432/m%61thion`,
    `…/%6Dathion`, `…/mathion%2F` (each decodes to a value that would spuriously match yet connects to a literal
    escaped dbname), plus `%`-escaped userinfo (`m%61thion:pw@…`). **round-10 #2: also assert `ValidateEnvComplete`
    requires `MATHION_VERSION` to pass `ValidateOCITag`** — a **quoted** value (`MATHION_VERSION="v0.1.1"`, which
    `ParseEnv` returns *with* quotes while Compose unquotes to `v0.1.1`) and an **interpolated** value
    (`${X:-v0.1.1}`) are **rejected**, so the CLI's parsed tag always equals Compose's effective tag (closing the
    same-tag-guard mis-compare). `update`/`restore` invoke it as a **precondition
    before any Docker mutation** (a divergent/incomplete `.env` fails **pre-mutation**, not at the recreate after
    the schema was already migrated).
  - `EnsureBackupsDir` (**dedicated**): rejects a symlinked dir and a group/world-writable dir on both levels;
    creates 0700; idempotent; **fsyncs each newly-created directory's parent** (`/var/lib` after creating
    `/var/lib/mathion`, `/var/lib/mathion` after `backups/`) so first-run creation is crash-durable (round-5 #1),
    and **skips** those parent fsyncs when the tree already exists.
  - `backup`: correct `pg_dump`/one-off `tar`/one-off `alembic current` argv; **`image_id` probed** from the
    app container's `.Image` (and the fallbacks: no-container → `image inspect` the `.env` tag; neither →
    empty); **manifest sha256 over injected member bytes** + `image_id` recorded; streaming atomic `Rename`
    (with parent-dir fsync); `--out` `O_EXCL|O_NOFOLLOW` (symlink/clobber refused) + failed `--out` reports the
    managed archive path and exits non-zero; tar exit-1 tolerated / exit-2 fails; `db`-down precondition;
    lock-held error; **`--latest` selection** parses the fixed 16-char UTC-timestamp token and picks the newest,
    breaking a same-second tie by **file mtime** (a same-second `…-2` cluster picks the newest, **not** the
    lexicographically-first — the Round-2 inversion regression test; **does not** parse a collision counter out
    of a `-`/`.`-bearing version; equal timestamp **and** mtime falls back to a stable filename order); zero-backups error.
  - `restore` extractor: rejects `../`, absolute, symlink, hardlink, dir-named-`db.dump`, extra, duplicate,
    over-cap `Size`, and a gzip-bomb (LimitReader hard-abort); missing sha256 entry hard-fails; **inner
    `assets.tar` pre-scan** rejects a symlink/`..` member; all **pre-mutation**.
  - `restore` flow: `ValidateOCITag` on manifest version; typed-confirm uses `app.Project` + untrusted-path
    warning; **image preflight (4a local resolve) + obtain/retag (6c)** — assert 4a consults `manifest.image_id`
    **first** (present-and-local → `T_id == manifest.image_id`, **no `docker pull`**); when only the local tag
    resolves, `T_id ==` its local ID; **round-9 #1: 4a is fully read-only — assert it runs NO `docker pull` and
    NO `docker tag`** (given a recorded-id-absent + tag-not-local backup, assert 4a **pull-flags** rather than
    pulls, and the **pull happens at 6c** — *after* confirmation and the step-6b breadcrumb; a **declined
    confirmation performs NO `docker pull` and NO `docker tag`**). Assert the **pull-flagged breadcrumb has an
    absent `target_image_id`** (manual-clear disabled) until **6c finalizes** it with the resolved `R_id`; assert
    6c's `docker tag <R_id> imageRepo:<version>` runs in the local-`R_id` case and **not** after a pull (the tag
    already resolves). **round-8 #2: assert every 6c mutation (pull or tag) runs only *after* the typed
    confirmation *and* (standalone) after the breadcrumb**; ordering
    `4a`→confirm→`up db`→`stop app`→breadcrumb(6b)→pull/retag(6c)→decode-gated schema-reset restore→assets→re-pin→`up
    --wait`→gate; the DB load
    runs as `compose run --name mathion_restore_db_<pid> --label io.mathion.worker=1 db …` (**not** `exec`) and
    `psql -h db`; the asset one-off runs via **`StreamInEnv` with `MATHION_VERSION=<manifest.version>`** on
    `--name mathion_restore_assets_<pid> --label io.mathion.worker=1` (assert `EnvCalls` sets the target version
    — **not** the current `.env` tag — so a missing/failed current image or a tool-less candidate cannot defeat
    asset restore/rollback); `StreamIn` surfaces the real pg error, not `EPIPE`; pg stderr not echoed (generic
    message + file path).
  - `restore` **cancellation**: on context-cancel the engine, **before releasing the lock** and under a fresh
    uncancelled context, force-removes **both** `mathion_restore_db_<pid>` and `mathion_restore_assets_<pid>`
    with the launch-resolved/stably-absent loop (assert both `docker rm -f` + wait-absent precede lock release);
    a **delayed-first-connect** case (cancel while `pg_restore` still decoding, no psql backend yet) still kills
    the worker via container-remove (the TOCTOU a terminate-backend approach would miss); assert the same
    force-remove **also** fires on a **transport/daemon error** and a **clean non-zero exit** with `ctx` still
    live (round-5 #3), not only on cancel; assert no second command can start until both are absent.
  - `update`: no-op guard keys on **running** `/version`; **round-9 #2 same-tag guard: when `--version` equals the
    `.env` tag, assert `update` performs NO `docker pull`** — a JSON-`/version` match exits 0 "already at `<v>`",
    and a **legacy `200 text/html`** (or mismatch/unreachable) exits 0 "already pinned … a same-version refresh is
    not supported" (assert **no `docker pull`** in *either* same-tag branch, so the active tag never moves
    pre-backup); only a **distinct** target reaches step 4's pull. **Step 4 captures the pulled target ID `A`**
    (`docker image inspect imageRepo:<target>`) and the **gate compares against `A`**, not a re-resolved tag;
    ordering pull→stop→**offline** backup→**validate (6a)**→**breadcrumb (6b)**→migrate (via `RunEnv` — assert
    `FakeRunner.EnvCalls` sets `MATHION_VERSION=<target>` for the migrate call **and nowhere else**, and the
    migrate call carries `--name mathion_migrate_<pid> --label io.mathion.worker=1`)→re-pin→`up --wait`→gate;
    **6a validation** runs the non-mutating restore prefix (**4a, no 6c retag** — assert no `docker tag`) on the
    fresh auto-backup and, on failure, `start app` + abort with **nothing migrated** (assert no
    breadcrumb/migrate/re-pin calls follow); **breadcrumb (6b)** records exactly
    `{schema,created_at,kind:"update",old_tag,target_tag,target_image_id,backup_path}` (`kind:"update"` present —
    round-8 #1; `target_image_id` == the captured `A`; assert **no** `rollback_allowed` / `migrate_container_name`
    fields; assert a **missing/unknown `kind`** makes the entry-check still **refuse** — fail closed, not
    fail-open) and is dir-fsync durable; a **6b write
    failure** is pre-mutation (`RemoveSync` partial + `start app` + abort, nothing migrated); **inject a *clean*
    step-7/8/9/10 failure (post-backup, `ctx` live) and assert in-process auto-rollback calls `restore` on the
    just-taken backup under a fresh (uncancelled) context, then `RemoveSync`s the breadcrumb**; **gate-pass is
    the commit point** — inject a **post-gate `RemoveSync` failure** and assert it returns a **non-rollback
    warning** (**no** `restore` call, **not** exit 3, breadcrumb-cleanup message), and a completed rollback whose
    breadcrumb `RemoveSync` fails likewise warns rather than re-escalating (round-5 #2); `--no-rollback` leaves
    the failed state,
    **leaves the breadcrumb**, prints the restore hint; rollback-also-fails returns the typed
    `rollbackFailedError` (asserted at the returned-error level; `Execute` maps it to exit **3**) and **leaves
    the breadcrumb**; backup-fails → `start app` + abort; **SIGINT → `ctx` cancelled → the failure handler
    force-removes `mathion_migrate_<pid>` (assert `docker rm -f` + wait-absent, tolerating the create/observe
    race), then — because `ctx.Err() != nil` — *refuses* (leaves the breadcrumb, prints the restore hint) and
    does **not** auto-rollback**; assert the worker force-remove **also** fires on a **clean non-zero migrate
    exit** and a **transport error** (round-4 #2), not only on cancel; the migrate one-off runs with the
    **sanitized env** (a host-exported `MATHION_VERSION`/`POSTGRES_PASSWORD` does not reach compose
    interpolation — only the deliberate `MATHION_VERSION=<target>` does); lock-held error;
    `install`/`uninstall`/`start`/`stop` refuse while the lock is held.
  - `update`/breadcrumb **crash-resume + durability + three-outcome entry check**: the breadcrumb is written at 6b
    **before** migrate and `RemoveSync`'d only after the gate; assert the write/re-pin/streaming-`Rename` each
    fsync the **parent directory** (crash-point assertions at each ordering boundary, **not** merely "AtomicWrite
    was called"). With a present breadcrumb, assert the entry-check routes by command into three outcomes:
    **exempt/clear** — `restore` **proceeds** and `RemoveSync`s; `uninstall --purge` `RemoveSync`s it (assert a
    subsequent fresh `install` is **not** deadlocked) **only after confirmation + successful teardown** — assert
    a **mistyped-confirmation** or a **`dockerx.Purge` teardown-failure** purge **retains** the breadcrumb
    (round-6 #2), and the entry-check itself never clears it; **containment** — `stop` **stops the stack, retains
    the breadcrumb, prints the restore hint**, and does **not** `up`/`restore`/clear (round-5 #6); **refuse** —
    `update`, `start`, `install` (**including `resume` — assert it never reaches `up -d --wait`**), and `backup`
    each **refuse** with the `mathion restore <backup_path>` hint and **do not** mutate (assert **no**
    `restore`/`up`/`docker tag` calls follow — i.e. no auto-recover); non-purge `uninstall` retains. Assert the
    refuse message names `old_tag`→`target_tag` and the backup path, and the manual-clear escape instruction
    requires the **image-ID** check (`docker inspect {{.Image}}` == `target_image_id`), not `/version` alone.
  - **standalone-`restore` breadcrumb (round-7 #2 + round-8 #2/#3):** a standalone `restore` writes a
    `kind:"restore"` breadcrumb at **step 6b** — *after* confirmation + `up db`/`stop app`, *before* the step-6c
    retag and the destructive load — recording `{kind:"restore", target_tag:<manifest.version>,
    target_image_id:<R_id>, backup_path:<**absolute** archive path>}` (assert the write is dir-fsync'd, precedes
    the step-6c `docker tag` and the step-7 `compose run … db` call, and that `backup_path` is **absolutized**;
    given a **relative** input path from a different cwd and a path **with spaces / a leading `-`**, assert the
    stored path resolves and the printed recovery command is `mathion restore -- <shell-quoted-path>` — a single
    argument). Assert a **declined confirmation** and a **pure step-6 failure** each leave **no** breadcrumb
    **and no `docker tag` and no `docker pull`** (round-8 #2 + round-9 #1). **round-9 #1 pull-flag case:** given a
    backup whose recorded id is absent and whose tag is not local, assert 4a **pull-flags** (no pull in 4a), the
    **6b breadcrumb is written with `target_image_id` absent** (manual-clear disabled → the refuse path does not
    offer the identity escape), and **6c performs the `docker pull` and finalizes** the breadcrumb's
    `target_image_id` — all **after** confirmation. **round-10 #3 + round-11 #1: assert a 6c *pull error* RETAINS
    the breadcrumb** (lost-ack — the daemon may have assigned the tag before the client errored; add a fake-daemon
    case where the pull **assigns the tag then returns a transport error** — the breadcrumb must **remain**), and
    the app-restart is **gated on the captured pre-restore state**: a **clean** restore (entered with **no**
    pre-existing breadcrumb *and* app running+healthy at step 6) best-effort **`docker start <captured-id>`** (assert
    it is `docker start` by ID — **never** `compose start … --pull` (an invalid flag) and **never** `compose up`);
    a **recovery** restore (a breadcrumb was present at entry) or a not-confirmed-healthy pre-state leaves `app`
    **stopped** (assert **no** `docker start`/`compose start`/`up`). **round-12/13: assert the clean-restore restart
    runs under a LIVE, BOUNDED context — not the cancelled `ctx`.** Add a case where the pull returns an error
    **after** `ctx` is already cancelled (the Ctrl-C path: interrupt cancels `ctx`, then `docker pull` errors).
    Merely asserting `docker start <captured-id>` was recorded is **vacuous** (round-13): `FakeRunner.Run` takes
    `ctx` as `_` and records the call regardless, so the *buggy* `Run(cancelledCtx, "start", id)` passes it too.
    Instead, using `FakeRunner`'s per-call **call-time context snapshot** (`Err()` + `Deadline()` recorded when
    the fake receives each call — **not** a raw `context.Context` read after `restore` returns, which the restart's
    `defer cancel()` would have already cancelled, round-14), assert the `docker start` call's snapshot is
    **live (`Err()==nil`) and carries a deadline ≈ `restartTimeout`** (`30s`), while the *pull* call's snapshot
    was **cancelled (`Err()!=nil`)** — positively proving the restart uses
    `context.WithTimeout(context.WithoutCancel(ctx), restartTimeout)` and would **fail** against the cancelled-`ctx`
    reuse or against the deadline-stripping `WithoutCancel(WithTimeout(...))` mis-order. Assert the breadcrumb
    **remains** whether that restart succeeds **or** itself fails (best-effort — restart failure never clears state). The breadcrumb is
    `RemoveSync`'d **only after** the step-10 gate, and **retained on every error** — a pull error, a DB-load
    failure, an assets failure, a cancellation, or a simulated crash between the step-7 commit and the step-9
    re-pin all leave it in place. With that breadcrumb
    present, the three-outcome entry-check behaves as for `update` (assert `start`/`backup`/`install`/`update`
    **refuse** with the `kind:"restore"` wording; `stop` contains; `restore` proceeds and clears on success), and
    the restore-kind **manual-clear escape tolerates a legacy `/version`** (404 / 200-HTML) as long as the
    **image-ID** matches (round-8 MINOR). Assert the **in-process rollback path does NOT write a `kind:"restore"`
    breadcrumb** — `update`'s rollback reuses the retained `kind:"update"` breadcrumb (assert the journal still
    reads `kind:"update"` after a rollback, and only one breadcrumb file ever exists); and assert a **standalone
    restore recovering from an update crash atomically replaces** the `kind:"update"` breadcrumb with its own
    `kind:"restore"` one pointing at the operator's archive, while the managed pre-update `*.tar.gz` **remains on
    disk** (round-8 #3).
  - **Startup orphan-worker sweep (by label):** with leftover containers carrying `io.mathion.worker=1` + the
    project label present (simulating a `SIGKILL`), assert the next lock-taking command force-removes them via
    `--filter label=io.mathion.worker=1 --filter label=com.docker.compose.project=<project>` after the flock and
    before its own work, even with **no** breadcrumb present (the standalone-`restore` orphan case); assert a
    look-alike `mathion_restore_db_debug` container **without** the label is **not** swept.
  - `update`/`restore` **gate (image-identity by resolved ID, `/version` legacy-tolerant)**: gate passes when
    the running container's resolved image **ID** == the target ID (**`A`** captured at update step 4; **`T_id`**
    resolved at restore step 4a) and `/version` is the exact JSON `{"version":target}`; **passes when `/version`
    is a `404` *or a `200 text/html` SPA shell*** (legacy image, e.g. `v0.1.1`) as long as image-**ID** matches
    (restore/rollback path only; a forward update requires the strict JSON); **fails** on a `/version` with a
    well-formed *different* version, a **`401`/`403`/`5xx`/malformed body**, a `.Config.Image` tag-string match
    whose resolved **ID** differs (moved tag), or connection-refused after a passing healthcheck.
  - `restore` **cap trust-split + override**: an **external** archive is bounded by the fixed untrusted ceilings
    (`2 GiB`/`5 GiB`); a `backups/` archive uses the managed ceilings (defaults `50 GiB`/`120 GiB`); assert an
    archive between the tiers is **rejected as external** but **accepted from `backups/`**; assert
    `MATHION_RESTORE_MAX_MEMBER_BYTES`/`_TOTAL_BYTES` parse (`G`/`M` suffix), enforce the `[1 GiB, 1 TiB]` range
    (out-of-range = hard error), and that `update` passes the **same** resolved managed ceilings into 6a and the
    rollback.
  - `version`: EACCES → "installed (sudo…)"; ENOENT → "not installed"; running line present/omitted.
  - **env sanitization (round-4 #1):** a `Runner` call made with a host-exported `MATHION_VERSION` /
    `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` in the process env produces a `cmd.Env` with those
    four keys **stripped** (assert compose then resolves them from `--env-file`); a `RunEnv` migrate re-adds
    **only** `MATHION_VERSION=<target>` (assert it is present and appended **last** so it wins, and no other
    stripped key returns).
  - `compose`: `imageRepo` is the prefix of the image line in `compose.ComposeYAML` (drift guard).
  - **`--pull never` on ordinary compose (round-10 #1):** assert (via `FakeRunner.Calls`) that **every** ordinary
    compose `up`/`run` carries `--pull never` — `start`; the backup assets one-off (`compose run app …`) and the
    alembic-revision probe; `restore` step 6 (`up -d db`), step 9 (`up app`), the DB one-off, the asset one-off;
    the migrate one-off — while the **three designated obtaining points** (fresh `install`, `update` step 4's
    `docker pull`, `restore` step 6c's `docker pull`) are the **only** commands that may pull. Assert an
    **untagged/missing-image** case makes those `--pull never` commands **fail** rather than pull (no `docker
    pull` and no tag move issued). **`install` resume (`install.go`, round-10 #1 + round-11 #2):** with
    `mathion_pgdata` **present**, assert resume issues **no `compose pull`** and its `compose up` carries
    `--pull never` — **but still runs the idempotent `alembic upgrade head`**; simulate a **fresh install crashed
    after `compose up` (volume created) but before migrate** and assert the retry does **no pull**, **does
    migrate**, and completes; with `pgdata` **positively absent**, assert a pull **is** allowed; and a
    `VolumeExists` **detection error fails closed** (treated as present → no pull, migrate still runs).
- **Backend:** `GET /version` returns `settings.version`; unset env → `"unknown"`; route ordered before the catch-alls.
- **Integration (`cli/integration_test.sh`, real Docker):** install → `backup` → mutate a row + add/delete an
  asset → `restore` → assert DB reverted, assets reverted, `/version` correct; install → `update --version
  <other-tag>` → assert `/version`==target; a **post-backup** forced-failure update (a tag that pulls but whose
  migrate or `/version` gate is made to fail — a garbage tag fails at *pull*, before the backup, so it can
  **not** exercise rollback) → assert auto-rollback restored the old version and the stack is healthy; exercise
  that `tar`/`find`/`mktemp` exist and run as the uid owning the assets volume. **Legacy-image rollback (must
  use the real `v0.1.1` image, not a mock):** update *from* `v0.1.1` to a slice-3 tag, force the gate to fail,
  and assert the auto-rollback to `v0.1.1` **succeeds** — proving the gate tolerates `v0.1.1`'s `200 text/html`
  SPA response at `/version` (a mocked 404 does **not** reproduce the shipped behavior) and gates on the
  resolved image **ID**. **Crash-resume with a live orphan:** kill the CLI (`SIGKILL`) mid-migrate so
  `mathion_migrate_<pid>` (labeled `io.mathion.worker=1`) and the breadcrumb both survive, then run `mathion
  start`/`update` and assert it (a) **label-sweeps** the orphaned migrate container after the flock, and (b)
  **refuses** with the `mathion restore <backup>` hint (never boots the old image on the forward schema, never
  auto-restores); then run `mathion restore <backup>` and assert it recovers and clears the breadcrumb. **Note
  explicitly** that the "restore an older-schema backup over a migrated DB" leg (which
  the schema-reset design targets) is not runnable until a **second** migration exists, and any other leg that
  can't run in CI.

## Open decisions — all resolved (brainstorm 2026-08-06)

1. Update target → **baked default + `--version` override**.
2. Update failure → **auto-rollback by default, `--no-rollback` to opt out**.
3. Backup location → **managed `/var/lib/mathion/backups` + `--out` copy**.
4. `/version` shape → **separate public `GET /version`** (via a `Settings` field).

## Review resolutions (four Opus rounds + fourteen codex gate rounds — converged, 2026-08-06)

Round 1 (5 reviewers) folded in: hardened allowlist extractor (zip-slip → root-RCE); `ValidateOCITag` on the
manifest version; `EnsureBackupsDir` symlink/perm hardening; `--out` `O_NOFOLLOW|O_EXCL 0600`; staging inside
`/var/lib/mathion`; line-oriented `.env` re-pin (not `GenerateEnv`); streaming archive assembly (not
`AtomicWrite([]byte)` → OOM); `Stream`/`StreamIn` stderr/exit contract + `FakeRunner` hooks; `/version` via a
`Settings` field; `app.Project` in the prompt; `imageRepo` drift test; **offline** update auto-backup
(consistent snapshot, no in-backup skew — the residual publish-before-gate window was scoped honestly by the
codex gate below); **atomic schema-reset** DB restore (not `pg_restore --clean`); SIGINT→rollback; no-op guard
on running `/version`; `up -d --wait` + `gateTimeout` ≥ healthcheck budget; restore image-availability
preflight; restore brings `db` up; archive-collision + `--latest`; advisory `flock`; forward-only semantics.
Kept deliberately: `/health` liveness-only (documented); online `backup` DB-first ordering (upload-dominant →
skew biases to harmless orphans); dumps run as DB superuser (inherent).

Round 2 (4 reviewers, two findings reproduced on live `postgres:17`) folded in — the sharp ones:
- **CRITICAL** flock **self-denial**: `update` held the lock then re-acquired it in the in-process backup/rollback
  (per-fd `EWOULDBLOCK`) → the flagship rollback denied itself. Fixed: lock **once** at the command layer; the
  engines are lock-free.
- **CRITICAL** restore **silent DB wipe**: `pg_restore -f - | psql --single-transaction` let a mid-stream
  `pg_restore` failure commit an empty `DROP/CREATE SCHEMA` and report success (dash, no `pipefail`). Fixed:
  decode `pg_restore` to a temp file and **gate** the `psql` load on its exit; the `sh -c` returns the real status.
- **IMPORTANT**: rollback on an already-cancelled context can't spawn docker → run rollback under
  `context.WithoutCancel`; re-pin **before** migrate could strand an unmigrated schema the no-op guard masks →
  migrate first (env-override), re-pin **last**; `start`/`stop` bypassed the lock → they take it too; gzip-bomb
  **skip-amplification** → `LimitReader` on the gzip layer + abort-on-first-bad-entry; inner `assets.tar`
  symlink-plant → inner pre-scan; `.env` duplicate-key last-wins → collapse + assert-target; pg stderr PII →
  never surfaced (generic + SQLSTATE + 0600 file); `EnsureBackupsDir` **before** the lock (else first
  `update`/`restore` had no lock dir); backup `alembic current` via one-off (else offline manifests lost the
  revision); "distinct exit code" was unreachable (`os.Exit(1)` for all) → exit **3**; `--latest` lexicographic
  sort was **inverted** → parse `(timestamp, counter)`. Downgrade guard **demoted to documentation** (mechanism
  needed the pulled image, and it is inert with a single migration; migrate-fails→rollback covers the real case).

Round 3 (3 reviewers, DB-wipe fix re-verified on live `postgres:17`; **no new CRITICAL** — the three prior
CRITICALs confirmed fixed) folded in: the migrate env-override had **no `Runner` plumbing** (and was untestable)
→ added `RunEnv` + `FakeRunner.EnvCalls`; the "no writers" lock set **omitted `install`/`uninstall`** (resume
path / `--purge`) → added them; the rollback's "own timeout" **contradicted** "pg_restore unbounded" and could
mis-escalate a slow large-DB rollback to exit 3 → made the rollback context effectively **unbounded** (the
second signal is the escape); the size caps were **named but never valued** → stated the sizing principle
(configurable, ≥ largest legit dump/assets; a too-large legit archive fails restore — documented); committed to
the **typed-error** exit-3 (defer-safe + unit-testable, not `os.Exit(3)`); made staging
**per-engine-invocation** (so in-process backup + rollback don't collide) and the stale-`staging` sweep run
**after** the lock; `.env` matcher uses **exact parsed-key equality** (not `HasPrefix`); pg-stderr wiring
pinned (`VERBOSITY=verbose`, full stderr → `0600` file, display only SQLSTATE, caller returns a scrubbed error
— never bubble the raw `Stream` error to `Execute`); reworded the restore temp file as the **fully-decoded
(possibly large)** dump SQL, not "small metadata"; documented the mid-update-crash resume path and the
operator-`stop`-refused trade-off. The panel converged here: remaining items were MINOR polish, and one
reviewer's lens returned no new CRITICAL/IMPORTANT at all.

Codex gate (independent, after the Opus panel converged) found **new** real defects the panel missed — folded
in:
- **CRITICAL** the decode-gate fix had merely **moved** the silent-wipe risk into the pipeline: `{ printf
  DROP/CREATE; cat "$t"; } | psql` — if `cat "$t"` died after emitting the `DROP/CREATE` prefix, `psql` would
  commit an empty schema and the pipeline would report psql's `0`. Fixed: **eliminate the producer pipeline** —
  give `psql` the reset and the decoded dump as **two `-f` files in one `--single-transaction`**, so a mid-read
  failure of either rolls the `DROP` back.
- **CRITICAL** step 9 (`up -d --wait app`) **publishes `127.0.0.1:8000` before** the step-10 gate → a write in
  the bring-up-and-gate window would be lost on auto-rollback, so the blanket "no data loss" claim was false.
  Fixed: **honest window scoping** (the guarantee is only that the pre-update backup is a consistent rewind
  point; `update` **requires the operator to block external traffic first**; window minimized; a bundled
  maintenance-mode toggle is Slice 5).
- **CRITICAL** `exec.CommandContext` cancellation kills only the **local** docker client, not the daemon-side
  container → a cancelled migrate one-off keeps mutating, racing the rollback's `DROP SCHEMA`. Fixed: the
  migrate runs as a **named** one-off (`--name mathion_migrate_<pid>`); the interrupt handler **force-removes it
  and waits it absent** before rolling back, all under `context.WithoutCancel`.
- **IMPORTANT** rolling back to the shipped `v0.1.1` image (which has **no `/version` route**) would time the
  gate poll out and be mis-reported as a failed restore / trip exit 3. Fixed: the gate is **image-identity
  primary** (`docker inspect` running image == target, works for every image) with `/version` a **404-tolerant**
  secondary confirmation.
- **IMPORTANT** `backup` could produce an archive that `restore`'s cap later **rejects**, so auto-rollback would
  reject its own backup mid-outage. Fixed: `update` **step 6a** validates the fresh auto-backup through the
  non-mutating restore prefix (using the auto-rollback's ceiling) **before** migrating — a clean pre-mutation
  abort, never a self-rejecting rollback — plus a **trust-split** cap (untrusted external archives keep the
  strict DoS ceiling; trusted `backups/` archives get a higher managed ceiling).
- **IMPORTANT** crash-resume assumed a `SIGKILL` between migrate and re-pin could be recovered by booting the
  **old** app on a **forward-migrated** schema — fragile and not guaranteed backward-compatible. Fixed: an
  **fsync'd update journal** (`backups/.update-journal.json`, phase-tracked) drives deterministic
  `restore(backup_path)` recovery on the next run, never booting the half-migrated schema.
- **IMPORTANT** the "root required" rule contradicted the non-root `version` behavior. Fixed: `version` is
  **exempted** (read-only) in both the Global Constraints and Error-handling sections.
- **MINOR** folded: `-v VERBOSITY=verbose` on the restore `psql` (into the step-7 command); standardized the
  `.env` re-pin on **collapse** (dropped the "or reject" alternative); reordered the confirm text to match steps
  4–6 (**pull-verified → stop → back up → migrate → health-check**); and made `--latest` break same-second ties
  by **file mtime** (never parsing a collision counter out of a version tag that can itself end in `-N`).
Codex explicitly confirmed **sound**: the Compose `shell env > --env-file` interpolation precedence; **no**
flock self-deadlock in the revised once-at-the-command-layer model; **no** extractor confinement bypass beyond
the (now-closed) cap mismatch.

Codex round 2 (re-gate after the first codex fold) confirmed the two-`-f` psql fix, step 6a, the no-loop
journal argument, and the `version` root exemption as sound, but found **six more real defects** in the newly
added lifecycle/durability machinery — all folded, all empirically re-verified against the code first:
- **CRITICAL** the update journal was **not power-loss durable**: `AtomicWrite` (`state.go:12`) fsyncs the file
  but **never the parent directory**, so a journal unlink could persist while the `.env` rename did not (or vice
  versa), recreating the very crash state it prevents. Fixed: **extend `AtomicWrite` to fsync the parent dir**
  after rename + a `RemoveSync` for the unlink, and a defined ordering (journal `in_progress` durable → migrate
  → re-pin durable → gate → `RemoveSync`).
- **CRITICAL** crash recovery **couldn't stop the orphaned migrate container**: the journal recorded no
  container name, so after `SIGKILL` the next command ran the restore while `mathion_migrate_<pid>` might still
  be mutating the schema. Fixed: the journal now records **`migrate_container_name`** (written at step 6b before
  the migrate); recovery **force-removes it and waits absent** before restoring; the create/observe race is
  handled by looping remove+inspect until the launch resolved; and both rollback paths funnel through **one
  `sync.Once` owner** so a signal can't start a second concurrent restore.
- **CRITICAL (new)** restore's destructive `compose exec` **could survive CLI cancellation**: a killed
  `docker exec` client leaves `psql` (reading container-side `-f` files, not stdin) running to **commit after**
  the CLI released the flock, and the unnamed asset one-off likewise. Fixed (round 2): tag the load's backend
  with `PGAPPNAME` and, on cancel, `pg_terminate_backend` it + poll to zero. **(Superseded in round 3** — a
  poll-to-zero races a backend that does not exist *yet* while `pg_restore` is still decoding; round 3 makes the
  DB load a **named `compose run db` one-off** and force-removes the *container*, killing the whole lifecycle
  atomically.**)** The asset one-off was named + force-removed here, retained.
- **IMPORTANT** the legacy `/version` fix **didn't match the shipped image**: `v0.1.1` has no `/version` route
  but **does** serve the SPA catch-all (`main.py:_spa_fallback`), so `GET /version` returns **`200 text/html`,
  not 404**, and the 404-only tolerance failed the gate. Fixed: treat **any non-version response — 404 *or* a
  `200` SPA shell — as "route unavailable"**; forward updates keep a **strict JSON** check; integration test
  uses the **real `v0.1.1` image**.
- **IMPORTANT** a **tag string is not identity**: `.Config.Image` equals the mutable tag even after the tag is
  moved to different content. Fixed: gate on the **resolved image ID** (`docker inspect {{.Image}}` vs
  `docker image inspect {{.Id}}`), record **`image_id`** in the manifest (probed at backup time), and have
  restore's preflight **warn** when the tag has moved off the recorded ID.
- **IMPORTANT** journal recovery **omitted `install`** (a documented resume path that would boot the old image
  on the forward schema) and **conflicted with `--no-rollback`** (the journal, removed only on success/rollback,
  would make a later `start` silently perform the rollback the operator opted out of). Fixed: **every**
  lock-taking command checks the journal before its work (`install` must not reach its `resume`'s `up -d
  --wait`); the dead `phase` field becomes a live state enum. **(Round 3 replaced the enum with a durable
  `rollback_allowed` bool written at 6b** — the enum could be `in_progress` at crash time even under
  `--no-rollback`; the bool encodes the policy from the outset.**)**
- **MINOR** folded: the failure-matrix "no committed data lost, only availability" line was narrowed to the true
  claim (backup intact; live state may be partial / post-backup writes may be lost); the `--latest` **test** was
  corrected from `(timestamp, counter)` to `(timestamp, mtime)` with a stable filename fallback.
Codex round 2 flagged **no** residual defect in the two-`-f` psql load, step 6a's non-mutation, or the no-loop
journal argument — those remain sound.

Codex round 3 (re-gate after the round-2 fold) confirmed the two-`-f` psql load, `.Image`-vs-`.Config.Image`,
the `compose stop`-keeps-container probe, and the `_spa_fallback` 200-HTML behavior as sound, but found **one
CRITICAL + seven IMPORTANT** real edges in the *newly added* lifecycle/durability machinery — all folded, all
re-verified against the code (and one was a factual correction to a prior decision):
- **CRITICAL** restore cleanup could observe **zero backends before the destructive backend existed** (cancel
  while `pg_restore` is still decoding, `psql` not yet started → terminate-by-`application_name` + poll-zero
  sees nothing, releases the lock, the orphan then starts `psql` and commits). Also standalone `restore` kept
  **no durable worker record** for the `SIGKILL`/second-signal case. Fixed: the DB load is now a **named
  `compose run db` one-off** (force-removing the *container* kills the whole decode+load lifecycle at any
  stage — no backend-existence TOCTOU); **both** workers use the migrate-style launch-resolved/stably-absent
  removal loop; and a **startup orphan-worker sweep** (every command, after the flock, force-removes leftover
  `mathion_migrate_*`/`mathion_restore_*` containers) reaps `SIGKILL`/standalone orphans. **Corrected my own
  prior reasoning:** a `compose run` one-off does **not** claim the `db` service alias (that is `--use-aliases`,
  opt-in), so `psql -h db` reaches the real service — my earlier rejection of the client one-off was wrong.
- **IMPORTANT** `--no-rollback` was **not durable across a crash**: 6b always wrote `in_progress`, so a crash
  before the handled-failure transition let the next command auto-restore. Fixed: 6b records **`rollback_allowed
  = !(--no-rollback)`** from the outset; the signal handler and crash-recovery both branch on it and **never**
  auto-restore a `--no-rollback` update. **(Superseded in round 4 — refuse-on-crash moots `--no-rollback`
  durability: a crashed update of *either* kind refuses identically, so `rollback_allowed` was dropped from the
  journal entirely.)**
- **IMPORTANT** the image-ID gate still **permitted non-identical rollback code** (moved tag → step-4 warned and
  accepted the *new* id even though the recorded pre-update image was still local; empty `image_id` degraded to
  a tag-string gate). Fixed: step 4 **retags the recorded `image_id` back onto the tag** when it is locally
  available (so auto-rollback boots the **exact** pre-update code), and the gate **always** compares resolved
  IDs (`T_id`) — never a tag string.
- **IMPORTANT** the caps were **still undefined**. Fixed: concrete defaults — untrusted `2 GiB`/`5 GiB` (fixed),
  managed `50 GiB`/`120 GiB` (overridable via `MATHION_RESTORE_MAX_MEMBER_BYTES`/`_TOTAL_BYTES`, range
  `[1 GiB, 1 TiB]`), with `update` passing the same resolved managed ceilings into 6a and the rollback.
- **IMPORTANT (new)** restore's **asset** step used the **current `.env` image, not the validated target**
  (`.env` re-pins last), so a missing current image — or, on auto-rollback, a tool-less failed candidate — could
  defeat asset restore. Fixed: add **`StreamInEnv`** and run the asset one-off with
  `MATHION_VERSION=<manifest.version>` (the validated image).
- **IMPORTANT** `stop` was blocked/reversed by the journal checker (couldn't contain a failed candidate; or
  auto-recovered then refused, leaving the stack **running**). Fixed: **`stop` is a containment action** —
  stop + retain journal + hint, never recover or refuse. **(Deleted in round 4's refuse-on-crash pass, then
  RE-ADDED in round 5 (#6): `stop` again proceeds — stops the stack and retains the breadcrumb — so this round-3
  containment behavior stands, minus the surrounding auto-recover / `rollback_allowed` policy matrix.)**
- **IMPORTANT** `uninstall --purge` **stranded the journal** (purge deletes `.env` but not `/var/lib/mathion`),
  deadlocking the next fresh `install`. Fixed: **purge `RemoveSync`s the journal**; non-purge retains it.
- **IMPORTANT** step **6b failure had no defined recovery path**. Fixed: 6b is **pre-mutation** — on failure,
  `RemoveSync` any partial journal, `start app`, abort.
- **MINOR** folded: the legacy `/version` tolerance was **narrowed** to only the two verified shapes (404 or a
  `200 text/html` SPA shell — `401`/`403`/`5xx`/malformed now fail); the non-exempt list now includes `install`;
  the confirm prompt branches on `--no-rollback`; the ledger heading was corrected.
Also self-caught while folding: the round-2 journal introduced a `manual_required`↔`restore` **deadlock** (the
only command that could clear the journal was itself blocked by it) — resolved by exempting `restore`/`uninstall`
from the refusal; and a would-be **dead `target_image_id`** journal field was dropped.

Codex round 4 (re-gate after the round-3 fold) confirmed the round-3 fixes to the two-`-f` psql load, the size
caps, the pg-stderr fail-closed wiring, and the `_spa_fallback` behavior as sound, but found **2 CRITICAL + 5
IMPORTANT** (+2 MINOR) — **again entirely in the crash / journal / worker / image / cap recovery machinery**,
confirming a pattern seen across rounds 2–4. Two responses were folded.

**(A) Design-independent fixes — folded as-is (they hold under any recovery model):**
- **CRITICAL #1 (host-env poisoning):** the `db` service has **no `env_file`** — its `POSTGRES_*` are an
  interpolated `environment:` block — and `ExecRunner` inherits the host env unchanged, so a shell-exported
  `MATHION_VERSION`/`POSTGRES_*` overrides `--env-file` (shell wins), booting the wrong image or wrong
  credentials (`mathion start` on an unintended tag; the restore DB one-off authing with the wrong password).
  The spec had also **falsely** claimed the DB one-off "inherits `$POSTGRES_*` from the db service's
  `env_file`". Fixed: a **sanitized subprocess env** (strip the four interpolation keys from **every**
  `docker`/`compose` call so `.env` is the sole authority; `RunEnv`/`StreamInEnv` re-add only the deliberate
  `MATHION_VERSION=<target>`), and the false `env_file` claim corrected to the interpolated-`environment:` truth.
- **IMPORTANT #2 (worker cleanup on any uncertain return):** the migrate force-remove fired only on `ctx.Done()`,
  not on a clean non-zero exit or a transport error — either could leave a migrate container mutating past lock
  release. Fixed: cleanup fires on **every** path the launch may have created a container.
- **IMPORTANT #5 (preflight ordering):** restore checked the tag before `manifest.image_id`, forcing an
  unnecessary (tag-moving) `docker pull`. Fixed: **consult `image_id` first**; pull only if it is gone (step 4a).
- **IMPORTANT #6 (validation must not mutate; gate on the pulled ID):** restore step 4 conflated validation with
  the identity retag, so `update`'s pre-migration 6a validation could **retag over the target image it just
  pulled**; and the update gate re-resolved the tag (which a retag could move). Fixed: **split step 4 into 4a
  (non-mutating validate/resolve) + 4b (retag)** — 6a runs 4a only — and `update` **captures the pulled target
  ID `A`** at step 4, gating on `A` rather than a re-resolved tag.
- **IMPORTANT #7 (orphan sweep by label):** the startup sweep matched `--filter name=mathion_*`, which would also
  reap an operator's unrelated `mathion_restore_db_debug`. Fixed: workers carry `--label io.mathion.worker=1` and
  the sweep filters on that label + the compose project.
- **MINORs:** removed a stale "restore gate degrades to a tag-string compare" line (the gate always resolves an
  ID); showed `a.composeArgs(...)` in the `RunEnv`/`StreamInEnv` examples.

**(B) Recovery model simplified to "refuse-on-crash" (user-approved) — dissolving the auto-recover-specific
findings rather than patching them.** Because round 4 (like rounds 2–3) put its criticals in the *automatic*
journal-driven recovery — round-4 #3 was a **silent-data-loss CRITICAL** that existed *because* the next command
auto-restored from the journal, and #4 required durably recording the resolved caps in the journal — the journal
was demoted to a pure **breadcrumb**: on any crash/interrupt the next non-exempt command **refuses** with the
exact `mathion restore <backup>` command; **no command auto-restores**. This **dissolves** round-4 #3 (no
auto-restore → no false rollback → no data loss) and #4 (the operator's explicit `restore` resolves its own
caps), and **moots** round-2/round-3 #2 (`--no-rollback` durability — a crashed update of either kind refuses
identically). It **deletes** the `rollback_allowed` field, the phase enum, and the auto-recover branch, collapsing
the round-3 policy matrix (at round 4 to two buckets — exempt `restore`/`uninstall` vs. refuse everything else;
round 5 then re-added a minimal `stop` **containment** as a third outcome, see round-5 #6). **In-process
auto-rollback on a
*clean* update failure is retained** (the feature's core value): the failure handler branches on `ctx.Err()` —
a live-context failure auto-rolls-back (default), an interrupt/crash refuses — which also removes the round-2
`sync.Once` single-owner machinery (only a clean failure triggers a rollback now, synchronously). Verified sound
(round 4, security/completeness lens): the size-cap principle, the pg-stderr fail-closed wiring, the `.env`
exact-key matcher, the two-`-f` psql load, the inner-tar pre-scan, and `--out` `O_EXCL|O_NOFOLLOW`.

Codex round 5 (re-gate after the refuse-on-crash simplification) confirmed the **core model coherent** — the
captured-`A` gate, 4a-before-4b ordering, the label sweep + `compose run --label`, two-bucket coverage of all
seven lock-taking commands, the `ctx.Err()` clean-vs-interrupt discriminator (no unsafe *reverse*
misclassification — a signal racing a clean failure only ever downgrades auto-rollback to a safe refusal), and
removing `sync.Once` all check out — but found **1 CRITICAL + 5 IMPORTANT + 1 MINOR**, all folded after
empirical verification:
- **CRITICAL #1** the durability fix was **incomplete for first-run directory creation**: `EnsureBackupsDir`
  `MkdirAll`s `/var/lib/mathion` + `backups/`, but fsyncing the archive/breadcrumb and `backups/` does **not**
  persist the *creation* of `backups/` (or `/var/lib/mathion`) into its parent — a first-ever `update` could
  commit the migration then lose the whole `backups/` (breadcrumb **and** backup) on power loss. Fixed:
  `EnsureBackupsDir` **fsyncs each new directory's parent** on the creating run.
- **IMPORTANT #2 (new)** a **post-gate `RemoveSync` failure would auto-rollback a *successful* update**: the
  breadcrumb unlink sat in "steps 7–10" with `ctx.Err()==nil`, so its failure fell into the default matrix row
  and rewound a committed, gate-passed deploy. Fixed: **a passing gate is the commit point** — the matrix covers
  only failures *before* the gate; a post-commit `RemoveSync` failure (forward path **or** completed rollback) is
  a **non-rollback warning**, never exit 3.
- **IMPORTANT #3** the round-4 worker-cleanup fix was applied to the **migrate** worker but not symmetrically to
  the **restore** workers, whose force-remove was still cancellation-only — a transport error with `ctx` live
  could leave `mathion_restore_db/assets_<pid>` mutating past lock release. Fixed: restore workers force-remove
  on **any** error return (cancel, transport, non-zero exit).
- **IMPORTANT #4** sanitizing the subprocess env (round-4 #1) made `.env` the **sole** source for
  `POSTGRES_USER`/`POSTGRES_DB`, but `ValidateEnvComplete` (`env.go:75`) required neither and hardcoded the URL
  username `mathion`, so a `.env` missing `POSTGRES_DB` passed validation and 6a's "proven-restorable" claim, then
  interpolated **empty** into the DB one-off/recreate *after* migrating. Fixed: strengthen `ValidateEnvComplete`
  (require non-empty `POSTGRES_USER`/`POSTGRES_DB`, cross-check the URL username/db-path) and run it as an
  **update/restore precondition** before any mutation.
- **IMPORTANT #5 (new)** the breadcrumb's **manual-clear escape was not identity-verifiable**: `/version` is
  env-derived, so on a moved-tag boot (`A`→`B`) it still reports `<target>`, and the breadcrumb held no `A`, so
  the operator could clear it while running the **wrong** image — defeating the moved-tag protection captured `A`
  added. Fixed: record **`target_image_id: A`** in the breadcrumb and require the escape to confirm the running
  image ID == `target_image_id` (not `/version` alone).
- **MINOR #7** restore 4a is not *literally* non-mutating (a gone-image `docker pull` creates a local image) —
  reworded to "non-destructive, non-retagging" (the pull still never clobbers `update`'s `A`, since 6a's fresh
  backup always has a local `image_id`). (Superseded round-9 #1: the gone-image pull was **moved out of 4a to
  step 6c**, so 4a is now **fully read-only** and this residual is closed.)

- **IMPORTANT #6 (user-decided)** refusing `stop` under refuse-on-crash left a broken post-step-9 candidate
  reachable during a recovery `restore`'s (minutes-long, up-to-120-GiB) pre-stop validation. Because deleting
  stop-containment was an **explicit** user choice in the refuse-on-crash simplification, this was surfaced to
  the user, who chose to **re-add a minimal `stop` containment**: `stop` now proceeds but **retains** the
  breadcrumb (stops the stack, prints the restore hint, never auto-recovers or clears) — a third entry-check
  outcome giving a clean "`stop` now, `restore` later" flow, **not** the deleted auto-recover / `rollback_allowed`
  matrix.

Codex round 6 (re-gate after the round-5 fold) confirmed the round-5 fixes **sound** — the first-run fsync chain
reaches the already-durable `/var/lib`, gate-pass is an unambiguous commit boundary, restore workers clean on
every error return, `target_image_id` has a live refusal-path use, all seven lock-taking commands are covered,
and restore 4a's ordering is safe — and found **1 CRITICAL + 1 IMPORTANT + 2 MINOR**, all folded after empirical
verification:
- **CRITICAL** the round-5 `.env` check was **still insufficient to prove the migration and backup target the
  same database**: `alembic upgrade head` migrates through `settings.database_url` == `MATHION_DATABASE_URL`
  (`backend/alembic/env.py:45,57`), while `backup`/`restore` operate on the `db` container's `$POSTGRES_DB`. A
  URL like `…@db:5432/mathion?dbname=other` (SQLAlchemy/psycopg query params **override** URL components —
  verified against the dialect) or `…@remote:5432/mathion` passes a username/path compare yet migrates a
  **different** database than the backup captured, so a rollback restores the wrong DB and the migrated one has
  **no** rewind point. Fixed: `ValidateEnvComplete` now validates the **complete effective target** — scheme,
  host `db`, port, decoded user/password/db all matching `POSTGRES_*`, **and rejects any query/fragment** — as an
  update/restore precondition before any mutation.
- **IMPORTANT (new)** the `--purge` breadcrumb `RemoveSync` was **not ordered after confirmation/teardown**: if
  the entry-check cleared it up front, a mistyped confirmation or a failed `dockerx.Purge` teardown would leave a
  half-migrated, **still-startable** deployment with **no** breadcrumb to block the next `start`. Fixed: the
  entry-check only **authorizes** `uninstall`; the `--purge` `RemoveSync` runs **late**, after the typed
  confirmation and successful teardown (`uninstall.go:49`).
- **MINOR** the manual identity-check command dropped `--format` (`docker inspect <app> {{.Image}}` treats
  `{{.Image}}` as a second object) → corrected to `docker inspect --format '{{.Image}}' <app-container>`; and a
  lingering Testing heading "two-bucket refuse" → "three-outcome entry check" (its body already tested three).

Codex round 7 (re-gate after the round-6 fold) confirmed the round-6 fixes otherwise **sound** — host/port
pinning, query/fragment rejection, and the late `--purge` breadcrumb ordering are all correct — and found **1
CRITICAL (round-6 fix incomplete) + 1 IMPORTANT (new, pre-existing gap)**, both folded after empirical
verification against the installed dialect and the restore step ordering:
- **CRITICAL — the round-6 `.env` fix was incomplete: it compared the *decoded* database path.** Go `net/url`
  decodes `u.Path`, so `MATHION_DATABASE_URL=…@db:5432/m%61thion` yields `u.Path == "/mathion"` and passes a
  decoded compare — but **psycopg does *not* URL-decode the dbname** (verified: `create_connect_args` for that
  URL yields `dbname: "m%61thion"`), so `alembic upgrade head` connects to the literal `m%61thion` while
  `backup`/`restore` target `$POSTGRES_DB` = `mathion` — the exact divergent-target class round 6 set out to
  close, re-opened through percent-encoding. Fixed: `ValidateEnvComplete` now compares the **raw escaped** path
  (`u.EscapedPath()` == `"/" + POSTGRES_DB`), constrains `POSTGRES_USER`/`POSTGRES_DB` to a safe identifier
  alphabet (`^[A-Za-z_][A-Za-z0-9_]*$`, so a legitimate value never needs escaping), and rejects **any**
  percent-escape in the userinfo or path — with `m%61thion`/`%6Dathion`/`%2F` regression cases. The decoded
  compare is kept for username/password (SQLAlchemy *does* decode userinfo), but a `%` there is also rejected for
  uniformity.
- **IMPORTANT (new) — standalone `restore` kept no breadcrumb, so a DB-committed-but-interrupted restore had no
  durable guard.** Restore loads the DB at step 7 and re-pins `.env` at step 9; a crash/`SIGKILL`/asset-failure
  between them leaves `.env` on the **old** tag over the **rewound** schema, and — unlike `update` — nothing
  blocked the next command: `start` would boot the wrong image against the restored DB, and `backup` would
  archive an `.env`-vs-DB-inconsistent state. Fixed: a **standalone** `restore` now writes a `kind:"restore"`
  breadcrumb at its **step 6b** (after `up db`/`stop app`, before the destructive load), retains it on every
  post-mutation error/crash, and `RemoveSync`s it **only after** the step-10 gate — routed through the **same**
  three-outcome entry-check (exempt: `restore`/`uninstall --purge`; contain: `stop`; refuse:
  `start`/`backup`/`update`/`install`). The recovery command is re-running `mathion restore <backup_path>`
  (idempotent). `update`'s in-process rollback **reuses** its retained `kind:"update"` breadcrumb rather than
  writing a second one, so the two never coexist (the flock also serializes them).

Codex round 8 (re-gate after the round-7 fold) confirmed **NO CRITICAL** and the round-7 raw-escaped-path `.env`
fix **sound** (`GenerateEnv` yields `EscapedPath()=="/mathion"`; safe-identifier + scheme/host/port + query/
fragment + percent rejection close the tested divergences; `R_id` is the correct restore breadcrumb identity;
atomic replacement prevents the two kinds coexisting) — and found **3 IMPORTANT + 1 MINOR** in the round-7
breadcrumb fold, all folded after empirical verification:
- **IMPORTANT #1 — the update breadcrumb omitted the `kind:"update"` discriminator.** The round-7 fold added
  `kind` to the crash-resume schema but **not** to update step 6b's record nor its "records exactly" test, while
  the entry-check now routes by `kind` — a self-contradiction that would ship a `kind`-less update breadcrumb the
  kind-routed entry-check cannot classify. Fixed: `kind:"update"` added to the step-6b record and the exact test
  shape; **missing/unknown `kind` fails closed** (still refuses), never fail-open.
- **IMPORTANT #2 — restore retagged (old step 4b) *before* confirmation and before its breadcrumb.** With the
  order `4a → 4b(retag) → 5(confirm) → 6 → 6b`, a `docker tag <R_id> imageRepo:<v>` moved the local tag **before**
  the operator confirmed and before any breadcrumb existed; a declined confirmation or a step-6 failure then left
  `imageRepo:<v>` pointing at the backup's image with **no** breadcrumb, so a later `start` could boot it against
  the untouched DB — falsifying the fold's "a pre-6b failure mutated nothing" claim. Fixed: the retag is now
  **step 6c**, ordered `4a validate → 5 confirm → 6 up-db/stop-app → 6b breadcrumb → 6c retag → 7 load`, so no
  tag moves before commitment and every retag is breadcrumb-covered; `update`'s 6a still runs the 4a prefix only.
- **IMPORTANT #3 — the restore breadcrumb did not guarantee a replayable archive path.** `backup_path` was stored
  as given, so a `mathion restore './old backup.tar.gz'` from `/mnt/recovery` printed a **relative, unquoted**
  recovery command that fails from another cwd and splits on the space. Fixed: `backup_path` is **absolutized**
  before the breadcrumb write, and every printed recovery command is `mathion restore -- <shell-quoted-path>`.
  The residual external-archive-availability concern is **honestly bounded** (external archives are operator-owned,
  the `--single-transaction` load leaves the DB all-or-nothing, and breadcrumb replacement supersedes only the
  *pointer* — the managed pre-update `*.tar.gz` is never deleted), and copying external archives into `backups/`
  is deliberately declined (YAGNI + costly).
- **MINOR — the restore-kind manual-clear escape required exact `/version` JSON,** impossible for a completed
  restore of a legacy image (`v0.1.1` serves a `200 text/html` SPA shell). Fixed: the escape is **image-ID
  authoritative** and any `/version` confirmation uses the **gate's legacy tolerance** (JSON *or* 404/200-HTML).

Codex round 9 (re-gate after the round-8 fold) confirmed **NO CRITICAL** and the round-8 changes otherwise
**sound** (`kind:"update"` consistent across schema/step-6b/tests/fail-closed routing; 6c is correctly after
confirmation + the standalone breadcrumb; 6a stops at 4a and cannot clobber captured `A`; absolute-path + `--` +
shell-quoting fixes the recovery command; `RemoveSync` removes only the journal, never a managed archive; the
manual-clear escape is image-ID authoritative with legacy tolerance) — and found **2 IMPORTANT**, both folded
after empirical verification (`start.go` confirmed to run `compose up -d --wait`, which recreates on an image
change, so a moved tag is bootable):
- **IMPORTANT #1 — round-8 fixed the retag but *not* the fallback `docker pull`, which also moves the tag before
  confirmation.** Restore step 4a's gone-image branch ran `docker pull imageRepo:<v>`, and **pulling a tagged
  reference assigns that local tag** — a deployment-tag mutation, before step 5 confirmation and before any
  breadcrumb. Declining confirmation (or a step-6 failure) then left `imageRepo:<v>` pointing at a freshly-pulled
  (possibly upstream-drifted) image with **no** breadcrumb, so `start`'s `compose up` could boot it against the
  untouched DB — the same unguarded tag/DB mismatch class round 8 set out to close. Fixed: **4a is now fully
  read-only** (LOCAL `docker image inspect` only — no `docker pull`, no `docker tag`); when neither the recorded
  id nor the tag is local, 4a **pull-flags** and the pull is **deferred to step 6c** (after confirmation + the
  breadcrumb, still before step 7's DROP so a pull failure aborts with data intact). The 6b breadcrumb is written
  with `target_image_id` **absent** in the pull-flagged case (manual-clear disabled, fail-closed) and **finalized
  at 6c** once the pull resolves `R_id`. `update`'s 6a validation (auto-rollback's image is guaranteed local) is
  unaffected and is now genuinely non-mutating.
- **IMPORTANT #2 (new) — a same-tag `update` could move the *active* deployment tag before any backup/breadcrumb.**
  `mathion update --version <same-as-.env>` on a legacy image falls through the no-op guard (legacy `/version` is
  HTML, not JSON), reaching step 4's `docker pull imageRepo:<active-tag>`, which moves the **active** tag to the
  upstream-drifted image **before** step 5's backup and step 6b's breadcrumb. A crash there left an **unverified**
  image with no breadcrumb that `start`'s `compose up` boots against the un-migrated schema. Fixed: step 2 now
  **refuses to pull whenever the target equals the active `.env` tag** — a JSON match is the clean no-op ("already
  at `<v>`"), any other same-tag case exits 0 "already pinned … a same-version refresh is not supported (use
  `mathion restore`/reinstall to repair)". Only a **distinct** target reaches the pull, which then moves a
  **non-active** tag whose interruption is harmless (`.env` still pins the old tag). Version tags are immutable by
  convention, so refusing a same-version re-pull costs no legitimate capability.

Codex round 10 (re-gate after the round-9 fold) confirmed **NO CRITICAL** and the round-9 restore ordering
otherwise **sound** (4a read-only, 6c after confirmation + breadcrumb, absent `target_image_id` fail-closed) —
and found **3 IMPORTANT**, all folded after empirical verification against Docker's default **`missing`** pull
policy (`docker-compose.yml` sets none), `config.ParseEnv` (`env.go:55`, `TrimSpace`-only), `install.go:122`,
and `start.go:10`:
- **IMPORTANT #1 (new) — Compose's implicit `missing` pull moved active tags with no `docker pull` in sight.**
  The rounds-8/9 audit tracked explicit `docker pull`/`docker tag` but missed that a plain `compose up`/`compose
  run` **pulls a locally-absent image** (Compose default `pull_policy: missing`), silently assigning the active
  `MATHION_VERSION` tag — so `start`, the backup one-offs, restore's `up db`, the migrate/asset one-offs, and
  especially **`install`'s resume `compose pull` + `up` + `alembic upgrade head`** on an established deployment
  could move the active tag / migrate a drifted image with **no** backup, confirmation, or breadcrumb. Fixed: a
  new Global Constraint — **`--pull never` on every ordinary compose `up`/`run`**, with pulls allowed at exactly
  three designated points (fresh `install`, `update` step 4, `restore` step 6c); `install`'s resume must not pull
  an already-initialized deployment. (Refined in round-11 #2: the volume check gates **only** the pull, never the
  idempotent migrate.)
- **IMPORTANT #2 (round-9 fix incomplete) — the same-tag guard compared the CLI's *raw* `.env` value, not
  Compose's *effective* one.** `config.ParseEnv` only `TrimSpace`s, so `MATHION_VERSION="v0.1.1"` is seen by the
  CLI as `"v0.1.1"` (quotes kept) while Compose unquotes to `v0.1.1`; the guard then judged `--version v0.1.1`
  **distinct** and pulled the actually-active tag (interpolated `${X:-v0.1.1}` fails identically). Fixed:
  **`ValidateEnvComplete` now `ValidateOCITag`s `MATHION_VERSION`**, rejecting quotes/interpolation/whitespace so
  the CLI's parsed tag always equals Compose's effective tag; run as an update/restore precondition before the
  guard.
- **IMPORTANT #3 (round-9 fix unsafe) — a 6c pull *error* did not prove the tag was not assigned.** Round 9 had a
  pull failure **clear** the breadcrumb ("no tag moved"), but a lost-acknowledgement (daemon assigns `<v>`→new,
  client then errors) would clear the guard while the tag *had* moved, so a later `start`'s `compose up` boots the
  drifted image. Fixed: **every post-breadcrumb pull error is state-uncertain and RETAINS the breadcrumb**; the
  breadcrumb clears **only** at the step-10 gate. (Round-11 #1 corrected the app-restart part of this fix: the
  invalid `compose start app --pull never` → `docker start <captured-id>`, gated to a clean restore only.)

Codex round 11 (re-gate after the round-10 fold) confirmed **NO CRITICAL** and the round-10 changes otherwise
**sound** (all compose `up`/`run` covered by `--pull never`; `exec`/`start`/`stop`/`down`/`ps`/`logs` don't
implicitly pull; fresh install still viable; `ValidateOCITag` closes the raw-vs-effective-tag gap; retaining the
breadcrumb on every 6c pull error is correct) — and found **2 IMPORTANT**, both **incomplete round-10 fixes**,
folded after empirical verification against Docker Compose's `start` flags and `install.go`'s `up`-before-migrate
ordering:
- **IMPORTANT #1 — the round-10 6c pull-error app-restart was both an invalid command and unsafe in recovery.**
  `compose start app --pull never` is invalid — `docker compose start` has **no** `--pull` flag (only
  `--wait`/`--wait-timeout`), so the restart would error and leave `app` needlessly down; and even a *valid*
  restart is unsafe when restore is a **recovery** — restarting the pre-restore container can boot an interrupted
  `update`'s old `v1` app against a forward-migrated `v2` DB (the half-migrated boot refuse-on-crash forbids, and
  one the CLI breadcrumb doesn't stop from serving traffic). Fixed: the breadcrumb is still always retained, but
  the restart uses **`docker start <captured pre-restore container-id>`** (by ID — no pull, no recreate) and is
  **gated**: only a **clean** restore (entered with **no** pre-existing breadcrumb *and* app running+healthy at
  step 6, both captured before `stop app`) restarts; a recovery or not-known-healthy pre-state leaves `app`
  **stopped**.
- **IMPORTANT #2 — the round-10 pgdata-volume heuristic skipped *migration* too, bricking an interrupted first
  install.** A fresh install crashing **after** `compose up` creates `mathion_pgdata` but **before**
  `alembic upgrade head` (`install.go:174` orders `up` before migrate) would, on retry, see the volume, be judged
  "established", and skip **both** pull **and** migrate — leaving a table-less DB the superuser step fails on,
  unrecoverably (every retry re-skips). Fixed: the volume check gates **only the pull**; the **idempotent
  `alembic upgrade head` runs on every resume**. `dockerx.VolumeExists` present ⇒ skip pull + still migrate;
  positively absent ⇒ pull allowed; **detection error ⇒ fail closed** (treat as present).

Codex round 12 (re-gate after the round-11 fold) confirmed **NO CRITICAL**, the round-11 6c restart primitive
otherwise **sound** (`docker start <captured-id>` by ID is the right primitive; the captured container survives
steps 6/7/8 un-removed; the clean-vs-recovery gate is correct), and the install-resume always-migrate fix
**sound** — and found **1 IMPORTANT**, an **incomplete round-11 fix**, folded after empirical verification against
`compose/runner.go`'s `exec.CommandContext` usage:
- **IMPORTANT #1 — the round-11 6c app-restart ran on the cancelled context and so never started.** The pull error
  that triggers the restart is most often a **Ctrl-C**: the interrupt handler cancels `ctx`, `docker pull` returns
  the error, and the round-11 fix then issued `docker start <captured-id>` on that **same cancelled `ctx`**.
  `ExecRunner.Run` builds the process with `exec.CommandContext` (`runner.go:25`), which **refuses to start** a
  command once its context is cancelled — so the previously-healthy `app` stayed **stopped** behind a retained
  breadcrumb whose `target_image_id` is still absent (manual-clear disabled), stranding the operator. The spec
  already runs its worker-cleanup and auto-rollback commands under `context.WithoutCancel` for exactly this reason,
  but the round-11 restart clause omitted it. Fixed: **the clean-restore `docker start <captured-id>` runs under a
  bounded `context.WithoutCancel(ctx)`** so a cancelled `ctx` no longer blocks the pre-restore-app restart; the
  restart stays pure best-effort — **the breadcrumb is retained whether it succeeds or fails** — and a round-12
  test asserts the restart still issues when the pull errors *after* `ctx` cancellation. (Round-13 pinned the exact
  construction and corrected that test — a bare `FakeRunner` records the call regardless of `ctx` state, so the
  original assertion was vacuous; see below.)

Codex round 13 (re-gate after the round-12 fold) confirmed **NO CRITICAL**, no brand-new lifecycle defects, that
the breadcrumb is retained on **both** restart branches, that the restart stays best-effort, and — importantly —
that **no other cleanup/abort/restart path reuses a possibly-cancelled `ctx`** without an explicit uncancelled
context (the round-12 bug class exists nowhere else). It found **1 IMPORTANT**, an **incompletely-specified
round-12 fix**, folded after empirical verification against `FakeRunner` (`runner.go:42`, `ctx` is `_`):
- **IMPORTANT #1 — the round-12 fix was neither pinned nor verifiably testable.** Two gaps: (a) the runtime remedy
  was described only as "a bounded `context.WithoutCancel(ctx)` with its own short timeout" — no construction order,
  no named duration — so an implementer could write `context.WithoutCancel(context.WithTimeout(ctx, d))`, which
  **strips the deadline** (`WithoutCancel` drops the parent's cancellation *and* its deadline), or pick an
  arbitrarily tiny timeout that re-reproduces the outage; and (b) the round-12 regression test only asserted the
  `docker start` call was **recorded**, but `FakeRunner.Run` takes `ctx` as `_` and records the call regardless of
  its context — so the buggy `Run(cancelledCtx, …)` would pass the test identically, making it **vacuous**. Fixed:
  the 6c clause now pins the exact construction
  **`restartCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), restartTimeout)`** (order-critical:
  `WithoutCancel` first, then `WithTimeout`) with a **named `restartTimeout = 30 * time.Second`** constant; and
  `FakeRunner` gains a **per-call `CallCtxs` capture** (parallel to `Calls`/`EnvCalls`) so the test asserts the
  restart's context is **live (`Err()==nil`) with a deadline ≈ `restartTimeout`** while the pull's context was
  **cancelled** — an assertion that fails against both the cancelled-`ctx` reuse and the deadline-stripping
  mis-order. (Round-14 refined the capture from a raw `CallCtxs []context.Context` to a **call-time `Err()`/`Deadline()`
  snapshot**, since inspecting a stored raw context only *after* `restore` returns is defeated by the restart's
  `defer cancel()` — see below.)

Codex round 14 (re-gate after the round-13 fold) returned **NO CRITICAL/IMPORTANT ISSUES** — codex **converged**.
It confirmed the pinned construction `context.WithTimeout(context.WithoutCancel(ctx), restartTimeout)` is
order-correct (the reverse strips the new deadline), that `restartTimeout = 30 * time.Second` is well-chosen for a
`docker start` of an already-built container (bounded against a wedged daemon, and it deliberately does **not** wait
on application health), and that the other `WithoutCancel` uses are intentionally-unbounded cleanup/rollback ops
with the second-signal escape — none carries another order-sensitive `WithTimeout`. One **MINOR** implementation
caution, folded inline: a raw `CallCtxs []context.Context` inspected **after** `restore` returns is defeated by the
restart's `defer cancel()` (by then even the correctly-built live context reads `Err()!=nil`), so the test-double
capture is specified as a **call-time `Err()`/`Deadline()` snapshot** (or an assertion inside a live `RunFunc`
callback). No design change; the core design and all thirteen prior folds stand.
