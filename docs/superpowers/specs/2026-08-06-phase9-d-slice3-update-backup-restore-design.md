# Phase 9-D Slice 3 — `update` + `backup`/`restore` + `/version` — Design

**Status:** design (brainstormed 2026-08-06; all four decision points user-approved)
**Epic:** Phase 9-D (self-hostable + distributable). Slice 1 (deployment foundation) and
Slice 2 (`mathion` CLI) are shipped; the CLI is released as `cli-v0.1.1`.
**Prereqs in place:** `install`/`start`/`stop`/`status`/`logs`/`pin`/`superuser`/`version`/`uninstall`
commands; `/etc/mathion` config (`.env` + `docker-compose.yml` + `install-state`); prod compose
`mathion_prod` with services `app` (loopback `127.0.0.1:8000`) + `db` (postgres:17); volumes
`mathion_prod_mathion_pgdata` + `mathion_prod_mathion_assets`.

## Goal

Give operators a safe lifecycle for a running deployment: **upgrade** the app version with an
automatic pre-upgrade backup and **auto-rollback** on failure; take and restore **backups** on
demand; and expose the **running version** over HTTP so upgrades can be verified and ops can see
what's live.

## Scope (this slice)

1. `mathion backup [--out <path>]` — online, zero-downtime snapshot (DB + assets + manifest) to a
   managed directory.
2. `mathion restore <archive> | --latest [--yes]` — full-state rewind (DB + assets + image tag),
   typed confirmation, atomic DB load.
3. `mathion update [--version <tag>] [--no-rollback] [--yes]` — pull → backup → migrate →
   health/version-gate, with **auto-rollback** on any failure (opt out with `--no-rollback`).
4. `GET /version` (backend) — `{"version":"<MATHION_VERSION>"}`, mirroring `/health`.
5. `mathion version` (CLI) — fix the smoke Finding #2 mislabel and surface the live running version.

## Non-goals (deliberate YAGNI — future adds, not needed for correctness now)

- Backup **retention / pruning** (`--keep N`, a `prune` command). Backups accumulate; operator prunes by hand.
- **Remote / off-box** backup destinations (only a local `--out` copy).
- **Scheduled / cron** backups.
- Backup **encryption**.
- A live "latest release" **channel/manifest** query for `update` (target is the baked default or explicit `--version`; a channel is Slice-4-adjacent).

## Global Constraints

- **Language / deps:** Go stdlib + cobra only in the CLI; no new third-party deps. Backend change is a
  single FastAPI route in `backend/mathion/main.py` (no new deps). go 1.24 (already the floor).
- **Root:** all three commands manage Docker + `/etc/mathion` + `/var/lib/mathion` → require root (run via `sudo`), same as `install`/`uninstall`.
- **Secrets:** never place a credential in a host-side argv. The DB password lives in the `db`
  container env; reference it **inside** the container (`sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" …'`),
  never as a host-side `-e PGPASSWORD=<value>` (which would show in `ps`). No secret to stdout/stderr/logs.
- **Atomic writes:** the final archive and any `.env` rewrite use the temp-file → fsync → rename
  pattern (reuse `config.AtomicWrite`; temp prefix already `.mathion-tmp-*`).
- **Compose invocation:** reuse `App.composeArgs`/`App.compose` — every docker call is
  `docker compose -p mathion_prod -f /etc/mathion/docker-compose.yml --env-file /etc/mathion/.env …`.
- **Image reference:** the app image repo is `ghcr.io/svkucheryavski/mathion`; the tag is
  `MATHION_VERSION` in `.env`. A CLI constant `imageRepo` holds the repo (must match the compose file).

## Architecture / file structure

- `cli/cmd/backup.go`, `cli/cmd/restore.go`, `cli/cmd/update.go` — thin cobra wiring, mirroring existing
  command style; registered in `root.go`.
- `cli/internal/backup/` — **new package**, the reusable engine:
  - archive **create/extract** (tar.gz), **manifest** read/write + validation,
  - `pg_dump`/`pg_restore` and assets `tar` orchestration through the `compose.Runner`,
  - the shared `restore(archive, opts)` used by both `mathion restore` and `update`'s auto-rollback.
- `cli/internal/compose` — **extend `Runner`** with a streaming method so a large dump/tar is written
  straight to a file instead of buffered in a Go string:
  `Stream(ctx, stdout io.Writer, args ...string) error` (and `StreamIn(ctx, stdin io.Reader, args ...string) error`
  for feeding a tar/dump on stdin during restore). `FakeRunner` records these calls like `Run`/`Output`.
- `cli/internal/config` — reuse `.env` read + `MATHION_VERSION` re-pin (atomic).
- `backend/mathion/main.py` — add `@app.get("/version")` next to `/health` (line ~151).

## The backup archive (linchpin — `restore` and auto-rollback both depend on it)

A single file `mathion-backup-<UTC-timestamp>-<version>.tar.gz` (e.g.
`mathion-backup-20260806T141530Z-v0.1.1.tar.gz`) containing:

- `db.dump` — `pg_dump -Fc` (custom format) of the database.
- `assets.tar` — tar of the assets volume contents (`/data/mathion/assets`).
- `manifest.json`:
  ```json
  {
    "schema": 1,
    "created_at": "2026-08-06T14:15:30Z",
    "mathion_version": "v0.1.1",
    "alembic_revision": "67e8294b4267",
    "cli_version": "cli-v0.1.1",
    "db_name": "mathion",
    "sha256": { "db.dump": "…", "assets.tar": "…" }
  }
  ```

`mathion_version` is what makes a rewind restore **code + schema + data together**: `restore` re-pins
the image to exactly this tag. `sha256` per member is verified on extract (integrity, not authenticity).
Timestamps are UTC.

## `mathion backup [--out <path>]`

Online, no downtime.

1. **Preconditions:** recognized install (root; `install-state` + `.env` present) and the stack
   **running** — `db` is needed for the dump, `app` for the assets tar. Clear error if down
   (*"start the stack first: `mathion start`"*).
2. **DB dump** → stream to `db.dump`:
   `compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"'`
   (password read from the container's own env, never host argv).
3. **Assets** → stream to `assets.tar`: `compose exec -T app tar -C /data/mathion/assets -cf - .`.
4. **Alembic revision:** `compose exec -T app alembic current` → parse the revision id.
5. Compute per-member sha256, write `manifest.json`, `tar.gz` the three members.
6. **Atomic move** into `/var/lib/mathion/backups/` (create `0700`; archive `0600`). If `--out` given,
   also copy the finished archive there.
7. Print archive path + size. Any failure → temp cleaned up; nothing partial in the managed dir.

## `mathion restore <archive> | --latest [--yes]`

Full-state rewind; brief downtime.

1. **Target:** an explicit archive path, or `--latest` (newest `mathion-backup-*.tar.gz` in the managed
   dir). No no-arg form.
2. **Extract + validate:** unpack to a temp dir; verify `manifest.schema==1` and per-member sha256.
3. **Confirmation (destructive):** print *"This REPLACES the current database and assets with backup
   `<name>` (version `<v>`, created `<ts>`). Current data is lost. Type the project name
   (`mathion_prod`) to confirm:"*. `--yes` bypasses (and the internal auto-rollback caller always bypasses).
4. **Stop writes:** `compose stop app` (keep `db` up for the load).
5. **Restore DB (atomic):**
   `compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`
   fed `db.dump` on stdin. `--single-transaction` makes the load all-or-nothing — a mid-load failure
   rolls Postgres back to the exact pre-restore state (no half-restore).
6. **Restore assets:** one-off container with the assets volume, `app` still stopped:
   `compose run --rm --no-deps -T app sh -c 'find /data/mathion/assets -mindepth 1 -delete && tar -C /data/mathion/assets -xf -'`
   fed `assets.tar` on stdin (`find -mindepth 1 -delete` clears contents including dotfiles without
   removing the mountpoint). DB first because it's transactional; if assets fail after the DB is in,
   report it explicitly.
7. **Re-pin + recreate:** write `MATHION_VERSION=<manifest.mathion_version>` into `.env` (atomic),
   `compose up -d` (uses the local image; pulls only if absent).
8. **Gate:** poll `http://127.0.0.1:8000/health`==200 `{"status":"ok"}` **and** `/version`==manifest
   version, with a timeout (~60s). Print *"restored to `<version>` from `<archive>`"*.

## `mathion update [--version <tag>] [--no-rollback] [--yes]`

Strict ordering so validation/backup happen **before** any mutation.

1. **Preconditions:** recognized install, docker ok, stack **running**.
2. **Resolve target:** `--version` or the baked recommended default (`buildDefaultImage`); validate with
   `config.ValidateOCITag`. If it equals the current `.env` `MATHION_VERSION` → *"already at `<v>`;
   nothing to do"*, exit 0.
3. **Confirm:** print the plan (*"Update `<old>` → `<new>`: back up → pull → migrate → health-check;
   auto-rollback on failure. Continue? [y/N]"*). `--yes` skips. Simple y/N (recoverable by design; not a typed name).
4. **Pull** `imageRepo:<target>` explicitly — a plain `docker pull <repo>:<target>` via the `Runner`
   (a non-compose call, like `dockerx`'s existing `docker ps`/`rm`), so it validates the tag without
   first re-pinning `.env`. Bad tag / network fail here → **clean abort, nothing changed, no backup taken yet.**
5. **Auto-backup** (full `backup`, retained in the managed dir) — the rollback point. **If the backup
   fails, abort here** — never mutate without a safety net.
6. **Apply:** re-pin `MATHION_VERSION=<target>` (atomic) → `compose up -d` (recreate `app`; `db`
   untouched) → migrate (`compose exec -T app alembic upgrade head`) → **gate** (poll `/health`==ok
   **and** `/version`==target, with timeout).
7. **Success:** *"updated `<old>` → `<new>` (backup: `<path>`)"*, keep the backup, exit 0.

**Failure in step 6 — matrix:**

| Mode | Behavior | Exit |
|---|---|---|
| default | **auto-rollback**: internal `restore(pre-update backup, yes)` → old image + DB + assets, health-gated. *"update failed at `<step>`: `<err>`; rolled back to `<old>` (healthy)"* | non-zero |
| `--no-rollback` | stop; leave the failed state; print the exact `mathion restore <backup>` + what failed | non-zero |
| rollback **also** fails | **loud critical**: *"update failed AND rollback failed; stack may be down. Recover manually: `mathion restore <path>`"* (backup still exists — data never lost, only availability) | non-zero |

Brief serving gap during recreate/migrate (and again on rollback) is accepted for a single-box
self-host and documented.

## `GET /version` (backend)

`backend/mathion/main.py`, next to `/health`:

```python
@app.get("/version")
def version() -> dict:
    return {"version": os.getenv("MATHION_VERSION", "unknown")}
```

Public, unauthenticated (mirrors `/health`). Reads the tag from the container env (`MATHION_VERSION`
flows in via `.env`). The operator can withhold `/version` at their reverse proxy if they don't want
to advertise it. Source the env read the same way the app reads its other settings (adjust to the
app's settings pattern if it centralizes env access).

## `mathion version` (CLI) — Finding #2 fix + live version

Current behavior mislabels an installed-but-unreadable deployment (non-root, `/etc/mathion` is `0700`)
as `(not installed)`. New behavior:

- **Distinguish** the cases: no `install-state` → *"not installed"*; read fails with EACCES →
  *"installed (run with sudo to read the pinned version)"*; otherwise show the pinned `MATHION_VERSION`.
- When the stack is reachable, also GET `http://127.0.0.1:8000/version` and show the **running** version
  alongside the **pinned** one (they can differ mid-update). Endpoint unreachable → omit the running line.
- Output shape:
  ```
  mathion cli-v0.1.1
  image (pinned)  v0.1.1
  image (running) v0.1.1
  ```

## Error handling / edge cases

- **Non-root:** clear "requires root; re-run with sudo" for all three (they touch `/etc/mathion`,
  `/var/lib/mathion`, and Docker).
- **Stack down:** `backup`/`update` require it running (dump/migrate need live containers); clear message.
- **Disk space:** best-effort — surface the underlying write error from the dump/archive step rather
  than pre-flighting free space (YAGNI); the atomic move means a failed write leaves no partial archive.
- **Archive integrity:** per-member sha256 in the manifest, verified on extract; a mismatch aborts restore
  before any mutation.
- **`.env` re-pin:** atomic; only `MATHION_VERSION` changes; all other keys preserved (parse → set → render → atomic write).
- **Interrupted restore:** `--single-transaction` protects the DB; assets are restored after, so a crash
  between DB-in and assets-done leaves DB new + assets old → re-running the same restore is idempotent.

## Testing

- **Unit (`FakeRunner`, `Calls` assertions):**
  - `backup`: correct `pg_dump`/`tar`/`alembic current` argv; manifest contents; atomic move; `--out` copy;
    stack-down precondition error.
  - `restore`: typed-confirmation gate (mismatch aborts, no docker calls); ordering
    stop→`pg_restore --single-transaction`→assets→re-pin→up→gate; sha256-mismatch aborts pre-mutation.
  - `update`: no-op guard; ordering pull→backup→re-pin→up→migrate→gate; **inject a step-6 failure and
    assert auto-rollback calls `restore` on the just-taken backup**; `--no-rollback` leaves failed state
    + prints restore hint; rollback-also-fails loud path; backup-fails-before-mutation abort.
  - `version`: EACCES → "installed (sudo…)"; no marker → "not installed"; running line present/omitted.
- **Backend:** `GET /version` returns the env tag; unset → `"unknown"`.
- **Integration (`cli/integration_test.sh`, real Docker):** install → `backup` → mutate a row → `restore`
  → assert reverted + `/version`; install → `update --version <other-tag>` → assert `/version`==target;
  a forced-failure update (e.g., an unreachable/garbage tag injected at the migrate step) → assert
  auto-rollback restored the old version and the stack is healthy. Note in the test any leg that can't run
  in CI so coverage isn't silently narrowed.

## Open decisions — all resolved (brainstorm 2026-08-06)

1. Update target → **baked default + `--version` override**.
2. Update failure → **auto-rollback by default, `--no-rollback` to opt out**.
3. Backup location → **managed `/var/lib/mathion/backups` + `--out` copy**.
4. `/version` shape → **separate public `GET /version`**.
