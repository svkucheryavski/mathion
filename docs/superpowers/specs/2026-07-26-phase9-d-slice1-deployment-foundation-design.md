# Phase 9-D Slice 1 — Deployment Foundation (Design)

**Status:** Draft rev 3 (revised after review rounds 1 & 2 — 5 independent Opus reviewers each)
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

### Two small in-scope code/packaging changes (justified by review; the only app-code edits)
- **`backend/pyproject.toml`**: add `python-multipart>=0.0.18` to `dependencies`. Without it,
  `import mathion.main` raises **at import time** — FastAPI's multipart check fires when the upload
  routes' `Form`/`File`/`UploadFile` params are registered (`params.File` subclasses `Form`;
  `ensure_multipart_is_installed()` runs inside `APIRoute.__init__` at decoration = import; §1.1).
  This is load-bearing for **both** the image **and** the CI `test` job (conftest imports
  `mathion.main`), so it is not image-only. A distributability fix, not a logic change.
- **`backend/mathion/main.py` lifespan startup** (NOT `config.py`, NOT module-import level): a
  **fail-closed guard** that raises if `secret_key` is empty or equals the dev default **AND
  `settings.cookie_secure is True`**. `cookie_secure` is the affirmative production signal — the prod
  `.env` sets `MATHION_COOKIE_SECURE=1`; dev/test leave it `False`. (Gating on `cookie_secure` rather
  than `debug` is deliberate: `debug=False` is the dev/test **default**, so a `debug`-gated guard
  would fire during the suite — and CI is the release gate.) The dev-default secret is a world-known
  hashing salt; documentation alone is the wrong control for a data-adjacent secret. **Verified
  test-safe:** no existing test sets `cookie_secure`, and the four lifespan-entering tests
  (`test_startup_db_log.py`, `test_notifications_lock.py` ×2, `test_notifications_lifespan.py`) all
  run with `cookie_secure=False`, so the guard is inert across the whole suite → **no `conftest.py`,
  CI, or existing-test change is required.** The guard ships with its own new unit test (positive:
  real secret + `cookie_secure=1` boots; negative: default/empty secret + `cookie_secure=1` refuses).
  ~5 lines, additive.

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
`frontend/` and `backend/`). A root **`.dockerignore`** excludes `**/.venv/`, `**/node_modules/`,
`.git/`, `backend/tests/`, `docs/`, `.superpowers/`, scratch, **and secrets/artifacts: `.env`,
`.env.*`, `outbox/`, `.coverage`, `htmlcov/`, `*.db`**. Two precision points that a plain pattern
list gets wrong:
- Docker `.dockerignore` matches **full context-relative paths** with **no** gitignore-style
  any-depth fallback, so a bare `.venv/` / `node_modules/` matches only a **root** occurrence. In
  this repo the venv is at `backend/.venv/` and node modules at `frontend/node_modules/` (there is
  also a root `node_modules/`) — the patterns MUST therefore be `**/.venv/` / `**/node_modules/` (or
  explicit `backend/.venv/`, `frontend/node_modules/`); bare names would miss the real venv and
  balloon the build context. (Image *correctness* survives regardless — `pip install ./backend` builds
  from `pyproject.toml` and `include=["mathion*"]` keeps the wheel clean — but this slice's whole
  point is a lean image.)
- The tracked `.env.example` / `deploy/.env.prod.example` are git **contracts** with no real secrets.
  The load-bearing exclude is the root-anchored **`.env`** pattern, which drops any real `.env` written
  at the context root (the smoke's throwaway `.env` lives there too) → no real secret is baked into a
  public layer. Note the root-anchored `.env.*` matches only the root-level `.env.example`, **not** the
  nested `deploy/.env.prod.example`; that placeholder harmlessly stays in the build context, and
  nothing `COPY`s either example into the image.

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
  can read them — using **two separate COPYs** so the directory tree is preserved. (A multi-source
  `COPY a b/ dest/` copies the *contents* of `b/` into `dest/`, which would flatten `alembic/`'s
  `env.py`/`versions/`/`script.py.mako` directly into `/app/` and break
  `script_location = %(here)s/alembic` → `alembic upgrade head` fails with "Path doesn't exist:
  /app/alembic".)

  ```dockerfile
  COPY --chown=app:app backend/alembic.ini /app/alembic.ini
  COPY --chown=app:app backend/alembic/    /app/alembic/
  ```

  The `--chown` is load-bearing: `backend/alembic.ini` is mode `0600` on disk; a plain root-owned
  `COPY` leaves it unreadable by the non-root `app` user and `alembic upgrade head` fails with
  PermissionError. `--chown=app:app` **alone** fixes it — Docker preserves the source mode, and 0600
  owned by `app` is readable by `app`; an extra `chmod 0644` is cosmetic. `scripts/` seed files are
  not needed in the image.
- **Copy the built SPA** and pin its path: `ENV MATHION_FRONTEND_DIST=/app/static`; copy
  `frontend/dist/` (from Stage 1) → `/app/static`. The pin is necessary — the settings default
  resolves relative to the installed package location (from `site-packages/mathion/config.py` up
  three parents → `.../lib/pythonX.Y/frontend/dist`, which won't exist).
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
- `MATHION_SECRET_KEY` is **enforced** at server startup (§2 fail-closed guard). Because the guard is
  `cookie_secure`-gated, a prod bring-up (this file sets `MATHION_COOKIE_SECURE=1`) with an
  empty/default secret **refuses to start**; a dev run with `cookie_secure=0` is unaffected.
- `MATHION_FRONTEND_DIST` is baked into the image (§3.2) and intentionally **absent** here.
- `MATHION_BASE_URL` must be `https://<domain>` with no path.

---

## 6. CI — release pipeline (`.github/workflows/release.yml`)

- **Trigger:** push of a semver tag `v*`.
- **Permissions:** `contents: read`, `packages: write` (GHCR via built-in `GITHUB_TOKEN` — no extra
  secret; first publish auto-creates the package on a user-owned repo).
- **Gated on the full CI workflow:** `release.yml` calls `ci.yml` (reusable, `on: workflow_call`) as
  a **single caller job named `ci`** (`jobs.ci: { uses: ./.github/workflows/ci.yml }`), and the
  build-push job declares **`needs: [ci]`**. A reusable-workflow call surfaces in the caller as ONE
  job; `ci.yml`'s internal `test`/`frontend`/`smoke` IDs are **not** addressable from `release.yml`,
  so `needs: [test, smoke]` would be rejected ("depends on unknown job 'test'") and nothing would
  publish. `needs: [ci]` transitively gates on all three (the `ci` job fails if any internal job
  fails). A red suite, a broken SPA build, **or** a failed stack smoke ⇒ no image. (This is the net
  that catches import/boot regressions like the multipart/alembic Criticals, which unit tests alone
  miss.)
- **Steps:** checkout → QEMU + Buildx → GHCR login → `docker/metadata-action` → `docker/build-push-
  action` (root `Dockerfile`, `platforms: linux/amd64,linux/arm64`, `type=gha` build cache). (A
  single multi-platform build-push invocation shares one BuildKit build + cache across both arches;
  true per-platform cache scoping would need a platform matrix + a manifest-merge job — heavier than
  this slice warrants, and there is no cross-arch cache "thrash" to avoid in the single-invocation
  model.)
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
  healthcheck. Install with **`pip install './backend[dev]'`** (quote the extra — `zsh`/glob-safe) — this pulls both pytest **and** the
  runtime deps, including the newly-added `python-multipart`, which is required here too because
  `conftest.py` imports `mathion.main` (without it, collection raises `RuntimeError`). Set
  **`MATHION_TEST_DATABASE_URL=postgresql+psycopg://mathion:mathion@localhost:5432/mathion_test`**;
  **leave `MATHION_DATABASE_URL` unset**; set **none** of `PGHOST/PGHOSTADDR/PGPORT/PGDATABASE/
  PGSERVICE/PGSERVICEFILE` (the conftest guard hard-fails on them). `MATHION_SECRET_KEY` need **not**
  be set — the §2 startup guard is `cookie_secure`-gated and no test enables secure cookies. Run the
  full backend suite (currently **~1160 passed / 1 skipped**).
- **`frontend` job (Node 22, matching the image's `node:22-alpine` build stage):** `npm ci` +
  `npm test` (the script sets `TZ=Europe/Copenhagen` — required for TZ-sensitive tests; do not run
  bare `vitest`) + `npm run build`.
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
  `network_mode: host` (Linux). A `host.docker.internal:host-gateway` mapping does **not** help with
  the loopback-only publish — it resolves to the bridge-gateway IP, which `127.0.0.1:8000` refuses;
  it would work only if the app were re-published on `0.0.0.0:8000`.

---

## 10. Verification / testing

Packaging + ops, so the net differs from unit tests:

1. **`ci.yml`** (§7) — backend suite + frontend build/tests + the `smoke` job; the release gate.
2. **`deploy/smoke.sh`** — the key artifact, and a **CI-enforced release gate** (not just a local
   convenience). It:
   - builds the production image **locally and tags it to the exact compose ref**
     (`docker build -t ghcr.io/svkucheryavski/mathion:$VER .`, amd64 — no registry, runnable before
     the repo is pushed and on PRs), writes `MATHION_VERSION=$VER` into the throwaway `.env`, and runs
     `docker compose -p mathion_smoke -f docker-compose.prod.yml up -d --wait` **without `pull`** — the
     prod compose has `image:` and **no** `build:`, so a `pull` would try to fetch the not-yet-published
     GHCR image and fail. **Every smoke compose command runs under the isolated project `-p
     mathion_smoke`**: the prod stack reuses the volume name `mathion_pgdata`, so under the default
     project (the repo-dir basename `mathion`, shared with the dev `docker-compose.yml`) the terminal
     `down -v` would destroy a developer's dev DB — an isolated project namespaces the volumes to
     `mathion_smoke_*`;
   - uses a **throwaway `.env`** with ephemeral volumes that **must set a non-empty
     `MATHION_SECRET_KEY`, `MATHION_COOKIE_SECURE=1`, and `MATHION_DEBUG=0`** — the prod posture. With
     the §2 guard in place a default/empty secret would make `up --wait` time out; setting a real
     secret both unblocks boot **and positively exercises the guard** (it must PASS on a correct
     config);
   - runs `alembic upgrade head` (proves the alembic.ini-readable fix); creates a superuser + issues a
     PIN via `python -m mathion.superuser`;
   - **asserts:** `GET /health`→200 — this successful **app boot** is what proves the **multipart
     import fix** (uvicorn imports `mathion.main`; the superuser CLI imports only `mathion.database`,
     so it does not exercise that path); SPA served at `/`; unknown deep link → `index.html`; bogus
     `/api/<nonexistent>` → **JSON 404** (API/SPA boundary); **a non-root write to the
     `mathion_assets` volume succeeds** (e.g. `exec app python -c
     "open('/data/mathion/assets/.probe','w').write('x')"` — catches the mis-owned-volume
     500-on-upload class that /health would pass); a **first-login round-trip** (issue a PIN via the
     CLI, then `POST /api/auth/verify-pin` → 200 with `Set-Cookie: …; Secure` — the curl must send
     `-H 'X-Requested-With: mathion'` (the CSRF header the app requires) and a JSON body
     `{"email":…, "pin":…, "duration_days":N}` with `duration_days` in 1–30 (required, no default),
     guarding the auth/cookie path the walkthrough depends on); and **DB data persists across a full
     `down` (NO `-v`) + `up`
     recreation** — a plain `docker restart` keeps the container filesystem and would not prove the
     *named* `mathion_pgdata` volume is what persists;
   - tears down with `down -v` (removing the ephemeral volumes), exiting non-zero on any failed
     assertion.
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
- `.github/workflows/release.yml` (build + push to GHCR, gated on `ci.yml` via `needs: [ci]`)
- `backend/tests/test_startup_secret_guard.py` (unit test for the §2 guard — positive: real secret +
  `cookie_secure=1` boots; negative: default/empty secret + `cookie_secure=1` refuses)

**Modified:**
- `README.md` (new "Self-hosting Mathion" section + TLS/reverse-proxy guidance + operational notes)
- `backend/pyproject.toml` (add `python-multipart>=0.0.18` to `dependencies`)
- `backend/mathion/main.py` (fail-closed `secret_key` guard in the **lifespan startup** path — NOT
  `config.py`, NOT module import; `cookie_secure`-gated)

**Deliberately NOT modified:**
- `backend/tests/conftest.py` and the existing suite — the `cookie_secure`-gated guard is inert under
  tests (verified: no test enables secure cookies), so no existing-test accommodation is needed. This
  keeps the app-code edits to exactly the two above.
- root `.env.example` (dev/test — untouched); root `.gitignore` (already ignores `.env`; the bare
  `.env` pattern does **not** match `.env.example`, so do **not** change it to `.env*`, which would
  swallow the tracked contract files).

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
proxy (reproxy primary), registry (GHCR), multi-arch (amd64+arm64), the two in-scope app-code changes
(python-multipart dep + a `cookie_secure`-gated `secret_key` guard in the lifespan), the
`needs: [ci]` release gate, and the `smoke`-as-release-gate design. Remaining exactness (final
workflow YAML, exact Dockerfile layering) is implementation detail for the plan.

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

---

## 15. Review round 2 — resolutions (5 independent Opus reviewers)

Round-2 convergence was strong with no contradictions across reviewers.

**Critical fixed:** (a) **`secret_key` guard broke the release-gating test suite** (all 5 reviewers).
`debug=False` is the dev/test default, so a `debug`-gated guard fires during the whole suite; both
import-level placements break collection (+ in-process Alembic + the superuser CLI), and even a
lifespan placement trips the four lifespan-entering tests. **Resolved** by gating the guard on
**`cookie_secure is True`** (the prod signal) **in the lifespan only** — verified inert across the
suite (no test enables secure cookies), so **no `conftest.py`/CI/existing-test change is needed**; the
guard ships with its own new unit test. (b) **`release.yml`'s `needs: [test, smoke]` is invalid**
against a `workflow_call` reuse (2 reviewers) — a reusable call is one caller job; internal IDs aren't
addressable → the workflow is rejected and nothing publishes. **Resolved** to `needs: [ci]` on the
single `ci` caller job (transitively gates test+frontend+smoke).

**Important fixed:** the illustrative **Alembic `COPY` flattened the migrations dir** (3 reviewers) →
two separate dir-preserving `COPY`s (and `--chown` alone suffices; `chmod` cosmetic); the **smoke
`.env` must set a real `MATHION_SECRET_KEY`** (+ `cookie_secure=1`, `debug=0`) or the guard blocks
`up --wait` (3 reviewers); **`.dockerignore` `.venv/`/`node_modules/` patterns miss the real dirs**
(`backend/.venv/`, `frontend/node_modules/`) since Docker matches full context-relative paths → use
`**/.venv/`, `**/node_modules/`; **§7 must `pip install ./backend[dev]`** and pin **Node 22**, and
python-multipart is load-bearing for the **CI test job** too (conftest imports `mathion.main`), not
image-only.

**Minor fixed:** smoke tags the local build to the exact compose ref and runs **without `pull`**;
DB-persistence asserted via **`down` (no `-v`) + `up`** recreation, not `restart`; the **multipart fix
is proven by the app boot / `/health`**, not the superuser CLI (attribution corrected); a **verify-pin
first-login round-trip** added to the smoke; dropped the inaccurate "per-platform cache scope" claim
(single multi-platform build shares one cache); documented that a `cookie_secure=1` local run needs a
real secret; tightened the site-packages-path wording; softened the hard-coded test count.

**Confirmed correct by round-2 reviewers (unchanged):** python-multipart genuinely absent + raises at
import (File⊂Form; `ensure_multipart_is_installed` at `APIRoute.__init__`); `alembic.ini` 0600 +
`--chown` fix; `secret_key` salts hashing + empty-env-overrides-default; `/health` no-DB + boots
healthy pre-migration in email-disabled mode; API/SPA/JSON-404 boundary; conftest test-DB contract
(env var, PG* rejection, CREATEDB, loopback rails) + `MATHION_DATABASE_URL`-unset safety; runner-hosted
(not `container:`) required for `localhost:5432`; frontend TZ requirement; base-image `3.13-slim`
no-apt/no-compiler chain (all deps ship cp313/abi3 amd64+aarch64 wheels; bare uvicorn avoids
uvloop/httptools C-ext); `stop_grace_period: 35s`; superuser CLI is multipart-independent; loopback vs
container-proxy reachability; tag-derivation keeps `v` + `latest` on non-prereleases; GHCR publish
model; no `/version` endpoint yet (forward note holds); dev artifacts + `.gitignore` no-op reasoning;
scope discipline clean; no residual TBDs.

---

## 16. Review round 3 — convergence

All **5 independent Opus reviewers APPROVED** rev 3 (image/build, CI/CD, runtime/config, operator
flow, whole-spec coherence): **zero Critical, zero Important**, each round-2 resolution independently
re-verified against the code (guard test-safety re-confirmed by fresh greps; `needs: [ci]` validity;
two-COPY Alembic; `**/.venv/` globs; `pip install ./backend[dev]`; smoke build-tag/no-pull; verify-pin
flow; multipart attribution). Only five trivial documentation minors were raised and applied here:
- quote `'./backend[dev]'` in §7 for `zsh`/glob portability;
- §10 verify-pin curl must send `-H 'X-Requested-With: mathion'` (CSRF) + a JSON body with the required
  `duration_days` (1–30);
- §9 dropped the broken `host.docker.internal:host-gateway` container-proxy option (it can't reach a
  loopback-only publish);
- §3 corrected the `.dockerignore` wording — root-anchored `.env.*` matches only root `.env.example`,
  not the nested `deploy/.env.prod.example` (which harmlessly stays in context; the load-bearing
  exclude is the root `.env` pattern);
- §10 smoke runs every compose command under an isolated project (`-p mathion_smoke`) so its `down -v`
  can't destroy a developer's dev-DB volume (both stacks use the name `mathion_pgdata`).

The Opus panel has converged. Next gate: codex review, then the User Review Gate → implementation plan.
