# Phase 9-D Slice 1 — Deployment Foundation (Design)

**Status:** Draft rev 2 (revised after review round 1 — 5 independent Opus reviewers)
**Date:** 2026-07-26
**Author:** brainstormed with the maintainer
**Depends on:** Phase 9-C complete (merged `9175c72` + doc sweep `f160acc`)

---

## 1. Purpose & context

Mathion has a complete LMS backend + Svelte frontend but **cannot be deployed today**: there is
no production image, no production compose stack, and no release pipeline. The only container
artifact is a dev-only `docker-compose.yml` that runs a single Postgres service. The application
is only ever run from a local `.venv`.

Phase 9-D is the "make Mathion self-hostable and distributable" epic. The north-star (the
maintainer's stated vision): anyone can install Mathion cheaply — download an installer or
`apt install mathion` — then run `mathion install` (interactive) to stand up all services, and
`mathion update` to upgrade (pull new version → backup → migrate → health-check). That whole
vision is too large for one spec, so it is decomposed into four dependency-ordered slices:

| # | Slice | Delivers |
|---|-------|----------|
| **1** | **Deployment Foundation** *(this spec)* | Production image + `docker-compose.prod.yml` + `.env` contract + CI (test + smoke + release-to-GHCR gated on both) + documented manual bring-up. |
| 2 | `mathion` Go CLI | Interactive `install` + `start`/`stop`/`status`, distributed via GitHub Releases + `curl\|sh`. Wraps Slice 1's manual flow. |
| 3 | update + backup | `mathion update` (pull → backup → up → migrate → health → rollback), `mathion backup`/`restore`, a `/version` surface. |
| 4 | apt distribution | Signed `.deb` + apt repo so `apt install mathion` works; CLI self-update. |

Slice 1 is the foundation: the CLI (Slice 2) is pointless until versioned images exist in a
registry and the containerized stack is proven. **This spec covers Slice 1 only.**

### 1.1 Established facts this design relies on (verified in the codebase)

- `backend/mathion/main.py` **already serves the built SPA** from `settings.frontend_dist` with an
  SPA fallback (real file under `dist/` if present, else `index.html`) plus a path-traversal guard,
  and it **skips the mount entirely when the dist directory is absent** (so a pure-backend image/CI
  still boots). The `/api/{rest:path}` catch-all returns **JSON 404** and is registered **before**
  the SPA fallback, so the API/SPA boundary holds. → One container serves API+SPA.
- `backend/mathion/main.py` **exposes `GET /health`** (returns `{"status":"ok"}`, **no DB access**);
  the app boots healthy **before** migrations run — which is why the ordered §8 steps
  (up → migrate) are safe, and why "healthy ≠ migrated/ready".
- `backend/mathion/superuser/__main__.py` is an **in-app CLI** with `create-superuser <email>`,
  `pin <email>` (prints a bootstrap PIN — SMTP-less first login), and `activate` (prints the
  `/superuser/{token}` panel URL). The module lives **inside the `mathion` package**, so
  `python -m mathion.superuser …` works from the installed wheel; `docker compose exec` inherits
  `env_file`, so the CLI reaches `db`. **Email-disabled first login works end-to-end** (verified):
  `GET /api/auth/config` returns `send_pin_enabled=false`, `Login.svelte` renders a combined
  email+PIN form posting to `/api/auth/verify-pin`; no mailer is touched.
- Migrations use **Alembic**; `alembic.ini` uses `script_location = %(here)s/alembic` (relocatable)
  and `alembic/env.py` builds its engine from `settings.database_url`.
- `backend/pyproject.toml`: `requires-python >=3.12`; runtime deps `fastapi>=0.115` (**bare, NOT
  `fastapi[standard]`**), `uvicorn`, `sqlalchemy`, `alembic`, `pydantic`, `pydantic-settings`,
  `psycopg[binary]`, `markdown-it-py`, `mdit-py-plugins`, `nh3`. Only the `mathion` package is
  distributable (`include=["mathion*"]`); alembic/, scripts/, tests are **excluded from the wheel**
  (so migration files must be copied into the image separately). **`python-multipart` is NOT
  declared** (see §2/Critical): upload routes (`api/assets.py`, `run_assets.py`, `submissions.py`,
  `evaluations.py`) use `UploadFile`, and FastAPI's multipart check fires at **import/router-
  registration time** → without the dependency, `import mathion.main` raises. The dev venv has it
  only incidentally.
- `backend/mathion/config.py` `Settings` (env prefix `MATHION_`) fields relevant here:
  `database_url`, `asset_path` (default `/data/mathion/assets`), `max_file_size`, `max_course_size`,
  `secret_key` (default `"dev-secret-key-change-in-production"` — **salts PIN/token hashing** in
  `auth.hash_token`; pydantic reads an empty env value as `""`, which overrides the default),
  `cookie_secure` (default `False`; the session cookie's `secure=` comes **solely** from this, not
  from request scheme — `api/auth.py`), `debug` (default `False`), `frontend_dist`
  (`MATHION_FRONTEND_DIST` maps to it via the prefix), `email_mode` (default `"disabled"`),
  `base_url` (validated: requires a host; **rejects any path, plus userinfo/query/fragment and
  control/whitespace**). PIN limits: `pin_expiry_minutes=10`, `max_pin_requests_per_hour=3`,
  `max_pin_failures_per_hour=5`. No code consumes `request.client`, `X-Forwarded-*`, or the request
  scheme anywhere (grep-verified) — nothing security-relevant depends on the client IP/proto.
- `backend/tests/conftest.py` reads **`MATHION_TEST_DATABASE_URL`** (default
  `postgresql+psycopg://mathion:mathion@localhost:5432/mathion_test`) and enforces a
  destructive-target guard: explicit host + explicit port, **loopback** host (else
  `MATHION_TEST_ALLOW_NONLOCAL=1`), db name matching `mathion_test*`, and it **hard-fails if any of
  `PGHOST/PGHOSTADDR/PGPORT/PGDATABASE/PGSERVICE/PGSERVICEFILE`** is set, or if
  `MATHION_DATABASE_URL` points at the same physical DB. It creates the test DB via a maintenance
  connection (`CREATE DATABASE`) — the role needs CREATEDB.
- The dev `docker-compose.yml` (repo root) is **db-only** `postgres:17`, publishes `5432:5432`,
  `pg_isready` healthcheck. The root **`.env.example` already exists and is git-tracked** — a
  **dev/test** reference documenting `MATHION_DATABASE_URL` + `MATHION_TEST_DATABASE_URL`, with a
  header saying "nothing auto-loads this file". Root **`.gitignore` already ignores `.env`**.
  `frontend/package-lock.json` exists (so `npm ci` works); `frontend/package.json` `test` script
  sets `TZ=Europe/Copenhagen`.
- The dispatcher's `SHUTDOWN_TIMEOUT_SECONDS=30` (only active when email is enabled).
- The repo has a GitHub remote `origin = git@github.com:svkucheryavski/mathion.git` (created by the
  maintainer). It has **not been pushed**; the agent shell **cannot authenticate to GitHub** (SSH
  publickey unavailable), so push/tag/registry-publish are maintainer-run steps.

---

## 2. Goals / non-goals

### Goals
1. A **production container image** (multi-stage: build SPA → Python runtime serving API+SPA),
   published to GHCR by CI on version tags.
2. A committed **`docker-compose.prod.yml`** (app + postgres) running from a generated `.env`, plus
   a committed, documented **`deploy/.env.prod.example`** contract (a *new* file — the existing root
   `.env.example` is dev/test and is left intact; §5).
3. **CI**: a reusable test workflow (`ci.yml`) running the backend suite against Postgres + the
   frontend build/tests **and** building/booting the image (so image regressions are caught on
   PRs); a release workflow (`release.yml`) building + pushing multi-arch images to GHCR, **gated on
   both the tests and the stack smoke**.
4. A **documented manual bring-up** (README) a maintainer can follow on a fresh Linux host to get a
   working HTTPS deployment; also the exact flow the Slice 2 Go CLI will automate.
5. An **executable stack smoke test** (`deploy/smoke.sh`) proving the packaged artifact runs
   end-to-end (including a non-root asset-volume write and DB persistence), runnable locally
   (no registry) and wired as a CI gate.

### Two small in-scope code/packaging changes (justified by review; the ONLY app-side edits)
- **`backend/pyproject.toml`**: add `python-multipart>=0.0.18` to `dependencies` (without it the
  image cannot import `mathion.main` — §1.1). A distributability fix, not a logic change.
- **`backend/mathion/config.py`** (or `main.py` startup): a **fail-closed guard** that refuses to
  start when `secret_key` is empty or equals the dev default **and** the app is in a production
  posture (`debug=False`). The default is a world-known hashing salt; documentation alone is the
  wrong control for a data-adjacent secret. ~5 lines, additive.

### Non-goals (explicitly deferred)
- The `mathion` Go CLI (Slice 2), `update`/`backup`/`restore` and a `/version` endpoint (Slice 3),
  apt packaging (Slice 4).
- **In-stack TLS.** The reverse proxy is **external and documented**, not shipped in the compose
  stack (bundled auto-HTTPS is a later slice).
- SMTP at install time (email stays `disabled`; first login uses the console PIN; SMTP configured
  later via the superuser panel).
- Multi-node / horizontal scaling; multiple app workers (§3.4).
- Pinning backend dependency versions for byte-reproducible images (deps are `>=` ranges today; a
  lock/constraints file is a worthwhile future hardening, out of scope here).

---

## 3. The production image

**Single multi-stage `Dockerfile` at the repo root** (build context = repo root — it needs both
`frontend/` and `backend/`). A root **`.dockerignore`** excludes `.venv/`, `node_modules/`, `.git/`,
`backend/tests/`, `docs/`, `.superpowers/`, scratch, **and secrets/artifacts: `.env`, `.env.*`
(the tracked `.env.example`/`deploy/.env.prod.example` are contracts, but exclude anything matching
`.env`/`.env.*` from the build context to prevent baking a real `.env` into a public layer),
`outbox/`, `.coverage`, `htmlcov/`, `*.db`**.

### 3.1 Stage 1 — frontend build
- `FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend` — the SPA output is
  architecture-independent, so it is built **once on the native runner**, not re-run under QEMU per
  target arch.
- `npm ci` + `npm run build` in `frontend/` → `frontend/dist/`.

### 3.2 Stage 2 — runtime
- Base: **`python:3.13-slim`**. (`requires-python>=3.12` is satisfied; the dev venv runs 3.14, but
  the app is version-agnostic and 3.13 has **guaranteed manylinux amd64+aarch64 cp313 wheels** for
  `psycopg[binary]`/`nh3` — 3.14 risks a missing linux/arm64 wheel → source build with no
  compiler/`libpq-dev` in `-slim` → broken arm64 leg + CI. The small dev/prod minor drift is the
  safe trade.) **No apt packages are needed**: `psycopg-binary` bundles libpq, `nh3` ships abi3
  wheels, the `mathion` wheel is pure-Python.
- Install the app + deps: **`pip install ./backend`** (non-editable; deps resolved from
  `pyproject.toml`, now including `python-multipart`). This makes `uvicorn mathion.main:app` and
  `python -m mathion.superuser …` work from site-packages.
- **Copy migration assets** excluded from the wheel, owned by the runtime user so a non-root process
  can read them: **`COPY --chown=app:app backend/alembic.ini backend/alembic/ /app/…`**. This is
  load-bearing: `backend/alembic.ini` is mode `0600` on disk; a plain root-owned `COPY` leaves it
  unreadable by the non-root `app` user and `alembic upgrade head` fails with PermissionError. (Also
  `chmod 0644 alembic.ini` for clarity.) `scripts/` seed files are not needed in the image.
- **Copy the built SPA** and pin its path: `ENV MATHION_FRONTEND_DIST=/app/static`; copy
  `frontend/dist/` (from Stage 1) → `/app/static`. The pin is necessary — the settings default
  resolves relative to the installed package (`site-packages/.../frontend/dist`, which won't exist).
- **Non-root, pinned uid:** `useradd -u 10001 -r app`; `WORKDIR /app`; run as `app`. The **fixed
  uid** matters: a named volume persists across image versions (Slice 3 updates); an arbitrary uid
  that drifts on rebuild would make the pre-existing `mathion_assets` volume unwritable.
- **Asset dir ownership:** `mkdir -p /data/mathion/assets && chown -R 10001:10001 /data/mathion`
  **before** the volume attaches. A fresh **named** volume (not a bind mount) inherits the
  mountpoint's uid/gid on first init → writable by `app`. (Bind-mount users must
  `chown -R 10001:10001` the host dir themselves — documented in §8.)
- **Launch:** `uvicorn mathion.main:app --host 0.0.0.0 --port 8000`. **No `--proxy-headers` /
  `--forwarded-allow-ips`** — verified: nothing in the app consumes the client IP or forwarded
  proto (rate-limiting is email-keyed; Secure cookies come from `MATHION_COOKIE_SECURE`). The flags
  would be inert, and `="*"` is needless trust surface. If future code consumes forwarded headers,
  add `--proxy-headers` then with `--forwarded-allow-ips` pinned to the proxy source.
- **Single worker** (v1): the email dispatcher holds a single-owner file lock; multi-worker is a
  deliberate future scaling concern. Documented limitation, not a defect.
- **No auto-migration on boot.** The image never runs Alembic at startup — migrations are an
  explicit `exec` step, which is what lets Slice 3's `update` do backup-before-migrate.

### 3.3 Image name / tags
`ghcr.io/svkucheryavski/mathion` (workflows use `${{ github.repository_owner }}`, lowercased by
`docker/metadata-action`). Tags: the **`v`-prefixed** semver git tag (e.g. `v0.1.0`) **and**
`latest` — see §6 for the exact derivation (the `v` must survive; `latest` only on non-prereleases).

### 3.4 Single worker (v1) — see §3.2.

---

## 4. The runtime stack — `docker-compose.prod.yml`

A **separate** compose file; the dev `docker-compose.yml` (db-only) is **left untouched**.

### 4.1 `app` service
- `image: ghcr.io/svkucheryavski/mathion:${MATHION_VERSION}` — version is a `.env` variable (Slice 3
  `update` is then a one-line bump + re-pull). Interpolation reads `.env` from the **current
  directory**, so §8 instructs running compose from the stack dir (or `--env-file .env`).
- `env_file: .env`; `depends_on: { db: { condition: service_healthy } }`.
- `volumes: [ mathion_assets:/data/mathion/assets ]`.
- `ports: ["127.0.0.1:8000:8000"]` — **loopback-only bind** (reachable only by a **host-run** reverse
  proxy; a containerized proxy uses `app:8000` on the compose network instead — §9).
- `healthcheck`: Python stdlib (no curl in slim), **with a timeout**, e.g.
  `["CMD","python","-c","import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health',timeout=3).status==200 else 1)"]`,
  plus explicit `interval`/`timeout`/`retries`/`start_period` (mirror the dev db's tight interval so
  `up --wait` isn't sluggish). Note: **healthy ≠ migrated** (see §1.1).
- `restart: unless-stopped`; `stop_grace_period: 35s` (the dispatcher's 30s shutdown exceeds
  Docker's default 10s — harmless while email is disabled, cheap to set now).

### 4.2 `db` service
- `image: postgres:17`; `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB` from `.env`;
  `volumes: [ mathion_pgdata:/var/lib/postgresql/data ]`; `pg_isready` healthcheck;
  `restart: unless-stopped`; **no published host port** (internal-only, reached by `app` at host
  `db`). Note: `POSTGRES_PASSWORD` is honored only on **first** init of an empty `pgdata`;
  regenerating secrets against an existing volume causes auth failures (documented §8).

### 4.3 Volumes / network / exposure
- Named volumes `mathion_assets`, `mathion_pgdata` survive updates/restarts. **`docker compose down
  -v` destroys them** (data loss) — §8 warns explicitly (the dev README teaches `down -v` as a
  reset, so the muscle-memory is dangerous here).
- Default compose network; `app` → `db` by service name.
- Exposure: only the reverse proxy is public; `app` loopback-bound (or on the compose net for a
  container proxy), `db` internal.

---

## 5. Configuration — the `.env` contract

**A new file `deploy/.env.prod.example`** (the existing root `.env.example` is a dev/test reference
documenting `MATHION_TEST_DATABASE_URL` and is left intact — overwriting it would break dev/test and
CI). `deploy/.env.prod.example` is committed + fully commented; `.env` (gitignored) holds real
values, written by the maintainer or the Slice 2 installer.

```bash
# --- Generated secrets (NEVER use defaults in production) ---
MATHION_SECRET_KEY=        # `openssl rand -base64 48` — salts PIN/token hashing (enforced at boot)
POSTGRES_PASSWORD=         # `openssl rand -hex 24` — hex → URL-safe, no escaping in the URL below

# --- Database: the URL's user/host/db/password MUST all match the POSTGRES_* values ---
POSTGRES_USER=mathion
POSTGRES_DB=mathion
MATHION_DATABASE_URL=postgresql+psycopg://mathion:<same-hex-password>@db:5432/mathion

# --- Deployment identity ---
MATHION_BASE_URL=https://learn.example.edu   # your domain; validated (host, no path)

# --- Production hardening ---
MATHION_COOKIE_SECURE=1
MATHION_DEBUG=0
MATHION_EMAIL_MODE=disabled

# --- Storage & limits (defaults shown) ---
MATHION_ASSET_PATH=/data/mathion/assets
MATHION_MAX_FILE_SIZE=20971520
MATHION_MAX_COURSE_SIZE=524288000

# --- Image version pin (Slice 3 `update` bumps this) ---
MATHION_VERSION=v0.1.0
```

**Decisions / foot-guns documented:**
- DB password uses **hex** (no URL-encoding needed inside `MATHION_DATABASE_URL`); `SECRET_KEY` uses
  base64 (not in a URL).
- The `MATHION_DATABASE_URL` duplicates **user, host, db, AND password** from the `POSTGRES_*`
  values — all four must track together. The Slice 2 installer generates once and writes both,
  eliminating the hazard.
- `MATHION_SECRET_KEY` is **enforced** (§2 fail-closed guard), not merely advised.
- `MATHION_FRONTEND_DIST` is baked into the image (§3.2) and intentionally **absent** here.
- `MATHION_BASE_URL` must be `https://<domain>` with no path.

---

## 6. CI — release pipeline (`.github/workflows/release.yml`)

- **Trigger:** push of a semver tag `v*`.
- **Permissions:** `contents: read`, `packages: write` (GHCR via built-in `GITHUB_TOKEN` — no extra
  secret; first publish auto-creates the package on a user-owned repo).
- **Gated on tests AND smoke:** `release.yml` first invokes `ci.yml` (reusable, `on:
  workflow_call`) as prerequisite jobs, and the build-push job declares `needs: [test, smoke]`. A
  red suite **or** a failed stack smoke ⇒ no image. (This is the net that catches import/boot
  regressions like the multipart/alembic Criticals, which unit tests alone miss.)
- **Steps:** checkout → QEMU + Buildx → GHCR login → `docker/metadata-action` → `docker/build-push-
  action` (root `Dockerfile`, `platforms: linux/amd64,linux/arm64`, GHA build cache with a
  **per-platform scope** to avoid cross-arch thrash).
- **Tag derivation (exact):** the produced image tag must keep the **`v`** (so it matches
  `MATHION_VERSION=v0.1.0` and the `${MATHION_VERSION}` pull) — use `type=ref,event=tag` (or
  `type=semver,pattern=v{{version}}`), **not** `pattern={{version}}` (which strips the `v`).
  `latest` only on **non-prereleases** — `flavor: latest=auto` with `type=semver`, or
  `enable=${{ !contains(github.ref, '-') }}` (so `v0.1.0-rc1` is not tagged `latest`).
- **Multi-arch:** amd64 + arm64 (arm64 via QEMU; slower, runs rarely). The SPA stage builds once
  natively (§3.1); only the thin Python runtime is emulated. Honest scope: the arm64 image is
  exercised only at **release time** (or on the maintainer's arm64 Mac smoke), not on an amd64 CI
  runner.
- **One-time GHCR visibility:** the first package is **private** by default; the maintainer flips it
  **public** once (needs their GitHub account) so end-user `docker compose pull` needs no auth.

## 7. CI — test + image pipeline (`.github/workflows/ci.yml`)

- **Trigger:** `push: { branches: [main] }`, `pull_request`, **and** `workflow_call` (so
  `release.yml` reuses it). Reusable call needs only `permissions: contents: read`; the test DB
  creds are literals (no `secrets: inherit`).
- **`test` job (runner-hosted — NOT a `container:` job, so the service is reachable at loopback):**
  a `postgres:17` **service** with `POSTGRES_USER=mathion`/`POSTGRES_PASSWORD=mathion` (superuser →
  CREATEDB, needed for `_ensure_test_database_exists`), `ports: 5432:5432`, and a `pg_isready`
  healthcheck. Set **`MATHION_TEST_DATABASE_URL=postgresql+psycopg://mathion:mathion@localhost:5432/mathion_test`**;
  **leave `MATHION_DATABASE_URL` unset**; set **none** of `PGHOST/PGHOSTADDR/PGPORT/PGDATABASE/
  PGSERVICE/PGSERVICEFILE` (the conftest guard hard-fails on them). Run the full backend suite
  (currently **1160 passed / 1 skipped**).
- **`frontend` job:** `npm ci` + `npm test` (the script sets `TZ=Europe/Copenhagen` — required for
  TZ-sensitive tests; do not run bare `vitest`) + `npm run build`.
- **`smoke` job:** runs `deploy/smoke.sh` (single-arch amd64 `docker build` + stack bring-up +
  assertions, §10). Runs on PRs too, so a Dockerfile/image regression is caught **before merge**,
  not only on a release tag.
- Green on all three is the release gate.

---

## 8. Documented manual bring-up (README "Self-hosting Mathion")

The exact sequence the Slice 2 `install` automates. **Availability:** these steps require a
**published** image — valid only **after** the maintainer has pushed, tagged a release, and made the
GHCR package public (§12). Until then `docker compose pull` returns `manifest unknown`.

**Prerequisites:** a Linux host with Docker + Compose v2; a domain (A/AAAA) pointing at it;
**inbound TCP 80 and 443 open** on the host firewall / cloud security group (required for ACME cert
issuance); a reverse proxy for TLS (reproxy primary, Caddy alternative — §9).

1. Obtain `docker-compose.prod.yml` + `deploy/.env.prod.example` (clone the repo, or download the
   two files). Work from the directory containing the compose file.
2. Copy `deploy/.env.prod.example` → `.env`; set `MATHION_BASE_URL`; generate `MATHION_SECRET_KEY`
   (`openssl rand -base64 48`) and `POSTGRES_PASSWORD` (`openssl rand -hex 24`, pasting the **same**
   value into `MATHION_DATABASE_URL`); set `MATHION_VERSION` to the current release tag (find it on
   the repo's **GitHub Releases / Packages** page, e.g. `v0.1.0`).
3. `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d --wait`
4. `docker compose -f docker-compose.prod.yml exec app alembic upgrade head`
5. `docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser create-superuser you@school.edu`
6. **Start the reverse proxy → `127.0.0.1:8000` (§9) and confirm `https://<domain>` loads (valid
   cert) FIRST.** ACME + DNS propagation can take minutes; the login PIN expires in **10 minutes**,
   so issue it only once HTTPS works.
7. `docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser pin you@school.edu`
   → prints the first-login PIN. Browse to `https://<domain>` (**test via HTTPS, not
   `http://127.0.0.1:8000` — the Secure cookie won't persist over plain HTTP**), log in with email +
   PIN.
8. *(optional)* `… exec app python -m mathion.superuser activate` → prints the `/superuser/{token}`
   panel URL.

**Operational notes (documented in the README):**
- **Rate limits:** PIN issuance is capped at **3/hour**, verification failures at **5/hour** (both
  per email). If locked out during setup, wait an hour, raise the limits, or clear the
  `rate_limit_entries` table.
- **Data safety:** `mathion_pgdata` + `mathion_assets` hold all state. **`docker compose down -v`
  permanently deletes them** — use plain `down` to stop. Until Slice 3 adds `mathion backup`,
  back up manually: `docker compose exec db pg_dump -U mathion mathion > backup.sql` + a snapshot of
  the assets volume.
- **Secrets are first-init-only for the DB:** don't change `POSTGRES_PASSWORD` after the first `up`
  against an existing `mathion_pgdata` (it won't take, and the app will fail auth).
- **Upgrades (interim, until Slice 3's `mathion update`):** back up → bump `MATHION_VERSION` →
  `pull` → `up -d --wait` → `exec app alembic upgrade head`. Skipping the migrate step causes schema
  drift → 500s; there is no automated backup/rollback yet.
- **Bind-mount users:** if `mathion_assets` is switched to a host bind mount, `chown -R 10001:10001`
  the host directory (named volumes inherit ownership automatically; bind mounts do not).

## 9. TLS / reverse proxy (documented external)

Primary: **reproxy** (`github.com/umputun/reproxy`) — a single static Go binary with automatic
Let's Encrypt. **Caddy** is the ubiquitous alternative. The proxy is the deployer's responsibility,
**not** in the compose stack this slice. Both auto-redirect HTTP→HTTPS by default.

**Reachability — the doc must be explicit about two topologies:**
- **Host-run proxy (clean, supported path):** reproxy binary/systemd or host-run Caddy targeting
  `http://127.0.0.1:8000` — works because the app publishes on host loopback. Example reproxy:
  `--ssl.type=auto --ssl.acme-fqdn=<domain> --static.rule='*,/,http://127.0.0.1:8000'`; Caddy:
  `<domain> { reverse_proxy 127.0.0.1:8000 }`.
- **Containerized proxy:** `127.0.0.1:8000` is the *proxy container's* own loopback and will 502.
  A container proxy must instead join the app's compose network and target **`http://app:8000`** (the
  app listens on `0.0.0.0:8000` inside the container regardless of the host publish), or use
  `network_mode: host` (Linux), or `extra_hosts: ["host.docker.internal:host-gateway"]`.

---

## 10. Verification / testing

Packaging + ops, so the net differs from unit tests:

1. **`ci.yml`** (§7) — backend suite + frontend build/tests + the `smoke` job; the release gate.
2. **`deploy/smoke.sh`** — the key artifact, and a **CI-enforced release gate** (not just a local
   convenience). It:
   - builds the production image **locally** (`docker build`, amd64 — no registry, runnable before
     the repo is pushed and on PRs);
   - brings up the prod stack against a **throwaway `.env`** (test secrets, ephemeral volumes);
   - runs `alembic upgrade head`; creates a superuser + issues a PIN via `python -m
     mathion.superuser` (also proves the alembic.ini-readable and multipart-import fixes);
   - **asserts:** `GET /health`→200; SPA served at `/`; unknown deep link → `index.html`; bogus
     `/api/<nonexistent>` → **JSON 404** (API/SPA boundary); **a non-root write to the
     `mathion_assets` volume succeeds** (e.g. `exec app python -c "open('/data/mathion/assets/.probe','w').write('x')"`
     — catches the mis-owned-volume 500-on-upload class that /health would pass); and **DB data
     persists across a container restart**;
   - tears down (removing the ephemeral volumes), exiting non-zero on any failed assertion.
3. **Manual acceptance** — the §8 steps double as a one-time fresh-VM checklist.

**Local vs maintainer-hand-off (honest scope):** the Dockerfile, compose, `deploy/.env.prod.example`,
`smoke.sh`, and workflow YAML are authored and **validated locally** (`smoke.sh` builds + boots the
real amd64 image; workflows validated by inspection). The **live GHCR publish + end-to-end `docker
compose pull`**, and the **emulated arm64 build**, are exercised only **after** the maintainer
pushes, tags, and flips the package public (§12) — a one-time outward-facing hand-off needing their
GitHub auth (the agent shell cannot push).

---

## 11. File manifest

**Created:**
- `Dockerfile` (repo root, multi-stage) + `.dockerignore` (repo root)
- `docker-compose.prod.yml` (repo root)
- `deploy/.env.prod.example`
- `deploy/smoke.sh` (executable stack smoke)
- `.github/workflows/ci.yml` (test + frontend + smoke; reusable via `workflow_call`)
- `.github/workflows/release.yml` (build + push to GHCR, gated on `ci.yml`)

**Modified:**
- `README.md` (new "Self-hosting Mathion" section + TLS/reverse-proxy guidance + operational notes)
- `backend/pyproject.toml` (add `python-multipart>=0.0.18` to `dependencies`)
- `backend/mathion/config.py` **or** `backend/mathion/main.py` (fail-closed `secret_key` guard)

**Not modified:** root `.env.example` (dev/test — deliberately untouched); root `.gitignore`
(already ignores `.env`; the bare `.env` pattern does **not** match `.env.example`, so do **not**
change it to `.env*`, which would swallow the tracked contract files).

**Forward note (NOT this slice):** `main.py` hard-codes `FastAPI(version="0.1.0")` and there is no
`/version` endpoint; Slice 3's `update` health-check will want a real deployed-version surface.

---

## 12. Prerequisites & maintainer hand-offs (outward-facing; agent cannot do these)

1. **Push `main`** to `git@github.com:svkucheryavski/mathion.git` (`git push -u origin main`).
2. **Tag a release** (`git tag v0.1.0 && git push --tags`) → triggers `release.yml`.
3. **Flip the GHCR package public** (one-time) so end-user pulls need no auth.

Documented in the plan as explicit hand-offs; everything else is agent-authored + locally verified.

---

## 13. Open questions

None. All design decisions are settled, including the base-image pin (**python:3.13-slim**), reverse
proxy (reproxy primary), registry (GHCR), multi-arch (amd64+arm64), the two in-scope code changes
(python-multipart dep + secret_key guard), and the `smoke`-as-release-gate design. Remaining
exactness (final workflow YAML, exact Dockerfile layering) is implementation detail for the plan.

---

## 14. Review round 1 — resolutions (5 independent Opus reviewers)

**Criticals fixed:** (a) base image `3.14-slim`→**`3.13-slim`** (psycopg arm64 wheel risk);
(b) **`python-multipart`** added to deps (image couldn't import `mathion.main`) — verified absent;
(c) **`alembic.ini` is 0600** → `COPY --chown=app:app` (+chmod) so non-root `app` can migrate —
verified.

**Importants fixed:** `.env.example` collision → new **`deploy/.env.prod.example`**; dropped the
factually-unfounded `--proxy-headers`/`--forwarded-allow-ips="*"`; pinned the exact **CI test-DB
contract** (`MATHION_TEST_DATABASE_URL`, runner-hosted job, no PG* env); **containerized-proxy
reachability** (`app:8000`); `.dockerignore` excludes **secrets**; **fail-closed `secret_key`
guard**; **`smoke.sh` wired as a CI/release gate** (+ image build on PRs); **tag derivation** keeps
`v` + `latest` only on non-prereleases; **pinned uid 10001**; smoke now probes **asset write + DB
persistence**; ACME **80/443** prereq; **PIN issued last** (10-min expiry) + rate-cap docs; image
**availability ordering** + version discovery; **`down -v`** data-loss + interim backup/upgrade
notes.

**Minors fixed:** frontend stage `--platform=$BUILDPLATFORM`; healthcheck `timeout=` +
interval/retries/start_period + "healthy≠migrated"; `stop_grace_period: 35s`; DB URL couples
user/host/db too; `ci.yml` `push: branches:[main]` + `npm test` (TZ); explicit `pip install
./backend`; `${MATHION_VERSION}` CWD note; per-platform cache; arm64-only-on-release honesty;
`.gitignore` no-op dropped; POSTGRES_PASSWORD first-init-only; HTTPS-only cookie-test note;
`/version` forward note.

**Confirmed correct by reviewers (unchanged):** GHCR `GITHUB_TOKEN` publish model; `workflow_call`
+ `needs` gating; loopback+internal-db exposure; hex-password URL-safety; relocatable
`alembic.ini`/separate-copy necessity; `/health` + SPA/JSON-404 boundary matching the smoke;
`MATHION_FRONTEND_DIST` mapping + pin necessity; email-disabled first-login path; one-slice scope +
honest local-vs-hand-off boundary.
