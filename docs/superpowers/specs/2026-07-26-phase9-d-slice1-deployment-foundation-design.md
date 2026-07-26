# Phase 9-D Slice 1 — Deployment Foundation (Design)

**Status:** Draft (pre-convergence)
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
| **1** | **Deployment Foundation** *(this spec)* | Production image + `docker-compose.prod.yml` + `.env` contract + CI (test + release-to-GHCR) + documented manual bring-up. |
| 2 | `mathion` Go CLI | Interactive `install` + `start`/`stop`/`status`, distributed via GitHub Releases + `curl\|sh`. Wraps Slice 1's manual flow. |
| 3 | update + backup | `mathion update` (pull → backup → up → migrate → health → rollback), `mathion backup`/`restore`. |
| 4 | apt distribution | Signed `.deb` + apt repo so `apt install mathion` works; CLI self-update. |

Slice 1 is the foundation: the CLI (Slice 2) is pointless until versioned images exist in a
registry and the containerized stack is proven. **This spec covers Slice 1 only.**

### 1.1 Established facts this design relies on (verified in the codebase)

- `backend/mathion/main.py` **already serves the built SPA** from `settings.frontend_dist` with an
  SPA fallback (serves a real file if it exists under `dist/`, else `index.html`) plus a
  path-traversal guard, and it **skips the mount entirely when the dist directory is absent**
  (so a pure-backend image/CI still boots). → One container can serve both API and SPA.
- `backend/mathion/main.py` **already exposes `GET /health`** → healthcheck target exists.
- `backend/mathion/superuser/__main__.py` is an **in-app CLI** with `create-superuser <email>`,
  `pin <email>` (prints a bootstrap PIN — SMTP-less first login), and `activate` (prints the
  `/superuser/{token}` panel URL). The `mathion.superuser` module lives **inside the `mathion`
  package**, so `python -m mathion.superuser …` works from the installed package.
- Migrations use **Alembic**; `alembic/env.py` builds its engine from `settings.database_url`.
- `backend/pyproject.toml`: `requires-python >=3.12`; runtime deps include `fastapi`, `uvicorn`,
  `alembic`, `psycopg[binary]`. The dev venv runs **Python 3.14**. The pyproject deliberately makes
  **only the `mathion` package distributable** (alembic/ migrations, scripts/, tests excluded from
  the wheel).
- `frontend/`: Vite 5, `npm run build` → `frontend/dist/`.
- `backend/mathion/config.py` `Settings` (env prefix `MATHION_`), fields relevant here:
  `database_url`, `asset_path` (default `/data/mathion/assets`), `max_file_size`, `max_course_size`,
  `secret_key` (default `"dev-secret-key-change-in-production"` — **salts PIN/token hashing** in
  `auth.hash_token`), `cookie_secure` (default `False`), `debug` (default `False`), `frontend_dist`,
  `email_mode` (default `"disabled"`), `base_url` (validated: must have a host, **must not include a
  path**, rejects control/whitespace chars).
- The repo now has a GitHub remote `origin = git@github.com:svkucheryavski/mathion.git`
  (created by the maintainer). It has **not been pushed yet**; the agent shell **cannot
  authenticate to GitHub** (SSH publickey unavailable), so push/tag/registry-publish are
  maintainer-run steps.

---

## 2. Goals / non-goals

### Goals
1. A **production container image** (multi-stage: build SPA → Python runtime that serves API+SPA),
   published to GHCR by CI on version tags.
2. A committed **`docker-compose.prod.yml`** (app + postgres) that runs the stack from a generated
   `.env`, plus a committed, documented **`.env.example`** contract.
3. **CI**: a test workflow (`ci.yml`) running the backend suite against Postgres + the frontend
   build/tests; a release workflow (`release.yml`) building + pushing multi-arch images to GHCR,
   **gated on the test workflow**.
4. A **documented manual bring-up** (README) that a maintainer can follow on a fresh Linux host to
   get a working HTTPS deployment; this is also the exact flow the Slice 2 Go CLI will automate.
5. An **executable stack smoke test** (`deploy/smoke.sh`) proving the packaged artifact runs
   end-to-end, runnable locally (no registry needed) and in CI on the release path.

### Non-goals (explicitly deferred)
- The `mathion` Go CLI (Slice 2), `update`/`backup`/`restore` (Slice 3), apt packaging (Slice 4).
- **In-stack TLS.** The reverse proxy is **external and documented**, not shipped in the compose
  stack. (Bundled auto-HTTPS is a later slice.)
- SMTP configuration at install time (email stays `disabled`; superuser first-login uses the
  console PIN; SMTP is configured later via the superuser panel).
- Multi-node / horizontal scaling; multiple app workers (see §3.4).
- Any change to application behavior/business logic. Slice 1 adds **packaging + ops artifacts
  only**; the sole app-code touch permitted is trivial and additive if a reviewer proves a
  concrete need (none is currently anticipated — `/health` and SPA serving already exist).

---

## 3. The production image

**Single multi-stage `Dockerfile` at the repo root** (build context = repo root, because it needs
both `frontend/` and `backend/`). A root **`.dockerignore`** excludes `.venv/`, `node_modules/`,
`.git/`, `backend/tests/`, `docs/`, `.superpowers/`, and scratch, to keep the build context small.

### 3.1 Stage 1 — frontend build
- Base: `node:22-alpine`.
- `npm ci` + `npm run build` in `frontend/` → produces `frontend/dist/`.

### 3.2 Stage 2 — runtime
- Base: `python:3.14-slim` (matches the dev venv; satisfies `requires-python>=3.12`).
- Install the `mathion` package **and its runtime dependencies** from `backend/` (so
  `uvicorn mathion.main:app` and `python -m mathion.superuser …` both work from site-packages).
- **Copy migration assets** that are excluded from the wheel: `backend/alembic.ini` and
  `backend/alembic/` into the image `WORKDIR` (`/app`), so `alembic upgrade head` works via `exec`.
  (`scripts/` seed files are **not** needed in the production image.)
- **Copy the built SPA** from Stage 1 into a fixed path and pin it explicitly with
  `ENV MATHION_FRONTEND_DIST=/app/static` (deterministic, independent of the settings default's
  base-path resolution). Copy `frontend/dist/` → `/app/static`.
- **Non-root:** create an unprivileged user (e.g. `app`), `WORKDIR /app`, run as that user.
- **Asset dir ownership:** `mkdir -p /data/mathion/assets && chown -R app /data/mathion` in the
  image **before** the named volume is attached. Because a **named** Docker volume (not a bind
  mount) inherits the mountpoint's ownership/contents on first initialization, the fresh
  `mathion_assets` volume comes up writable by `app`. (This is why §4 uses a named volume, not a
  bind mount, for assets.)
- **Launch:** `uvicorn mathion.main:app --host 0.0.0.0 --port 8000 --proxy-headers
  --forwarded-allow-ips="*"`. `--proxy-headers`/`--forwarded-allow-ips` make the app honor
  `X-Forwarded-Proto/For` from the external reverse proxy (correct client IP for PIN
  rate-limiting; correct Secure-cookie behavior behind TLS). Safe because only the proxy can reach
  the container (§4 loopback bind).
- **No auto-migration on boot.** The image never runs Alembic at startup. Migrations are always an
  explicit, controlled `exec` step driven by install/update — this is what lets Slice 3's `update`
  do backup-before-migrate safely.

### 3.3 Image name / tags
`ghcr.io/svkucheryavski/mathion` (workflows use `${{ github.repository_owner }}` so they stay
account-agnostic). Tags: the semver git tag (e.g. `v0.1.0`) **and** `latest` (§6).

### 3.4 Single worker (v1)
The app runs as a **single uvicorn process** (no `--workers`). Rationale: the email dispatcher uses
a single-owner file lock (`dispatcher_lock_path`); multi-worker fan-out is a deliberate future
scaling concern, out of scope here. Documented as a known v1 limitation, not a defect.

---

## 4. The runtime stack — `docker-compose.prod.yml`

A **separate** compose file; the existing dev `docker-compose.yml` (db-only) is **left untouched**.

### 4.1 `app` service
- `image: ghcr.io/svkucheryavski/mathion:${MATHION_VERSION}` — version is a `.env` variable so
  Slice 3's `update` is a one-line bump + re-pull.
- `env_file: .env`.
- `depends_on: { db: { condition: service_healthy } }`.
- `volumes: [ mathion_assets:/data/mathion/assets ]` — uploads persist across updates.
- `ports: ["127.0.0.1:8000:8000"]` — **loopback-only bind**: reachable solely by the host's reverse
  proxy, never directly from the internet.
- `healthcheck`: hits `http://localhost:8000/health` using **Python stdlib** (no `curl`/`wget` in
  the slim image), e.g.
  `["CMD","python","-c","import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"]`.
- `restart: unless-stopped`.

### 4.2 `db` service
- `image: postgres:17` (matches dev/test/prod).
- `environment: POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB` from `.env`.
- `volumes: [ mathion_pgdata:/var/lib/postgresql/data ]`.
- `healthcheck`: `pg_isready` (as in the dev compose).
- `restart: unless-stopped`.
- **No published host port** (unlike dev, which exposes 5432): the DB is reachable only over the
  internal compose network, by `app`, at host `db`.

### 4.3 Volumes / network / exposure model
- Named volumes `mathion_assets`, `mathion_pgdata` survive updates/restarts.
- Default compose network; `app` → `db` by service name.
- **Exposure model:** only the reverse proxy is public; `app` is loopback-bound, `db` is internal.

---

## 5. Configuration — the `.env` contract

Two files, distinct roles:
- **`.env.example`** — committed, fully commented, with placeholders and the exact `openssl`
  commands to generate secrets. The documented source-of-truth contract.
- **`.env`** — gitignored; real values, written by the maintainer (manual) or the Slice 2 installer.

Contract (grouped):

```bash
# --- Generated secrets (NEVER use the defaults in production) ---
MATHION_SECRET_KEY=        # `openssl rand -base64 48` — salts PIN/token hashing (auth.hash_token)
POSTGRES_PASSWORD=         # `openssl rand -hex 24` — hex → URL-safe, no escaping in the URL below

# --- Database (the password below MUST equal POSTGRES_PASSWORD) ---
POSTGRES_USER=mathion
POSTGRES_DB=mathion
MATHION_DATABASE_URL=postgresql+psycopg://mathion:<same-hex-password>@db:5432/mathion

# --- Deployment identity ---
MATHION_BASE_URL=https://learn.example.edu   # your domain; validated (has host, no path)

# --- Production hardening ---
MATHION_COOKIE_SECURE=1
MATHION_DEBUG=0
MATHION_EMAIL_MODE=disabled                  # SMTP configured later via the superuser panel

# --- Storage & limits (defaults shown; override if needed) ---
MATHION_ASSET_PATH=/data/mathion/assets      # matches the app volume mount
MATHION_MAX_FILE_SIZE=20971520               # 20 MB
MATHION_MAX_COURSE_SIZE=524288000            # 500 MB

# --- Image version pin (Slice 3 `update` bumps this) ---
MATHION_VERSION=v0.1.0                        # tag docker-compose.prod.yml pulls from GHCR
```

**Design decisions:**
- **DB password uses `hex`** (0-9a-f) specifically so it needs no URL-encoding inside
  `MATHION_DATABASE_URL`. `SECRET_KEY` uses base64 (not embedded in a URL).
- **The one foot-gun — the DB password appears twice** (`POSTGRES_PASSWORD` and inside
  `MATHION_DATABASE_URL`). The manual doc calls this out with a bold warning; the Slice 2 installer
  generates it once and writes both, eliminating the hazard.
- `MATHION_FRONTEND_DIST` is **not** in `.env` — it is baked into the image (§3.2) and must not be
  overridden by deployers.
- `MATHION_BASE_URL` must be `https://<domain>` with **no path** (the validator rejects paths).

---

## 6. CI — release pipeline (`.github/workflows/release.yml`)

- **Trigger:** push of a semver tag `v*` (e.g. `v0.1.0`).
- **Permissions:** `contents: read`, `packages: write` (GHCR via the built-in `GITHUB_TOKEN` — no
  extra secret to manage).
- **Steps:** checkout → set up QEMU + Buildx → log in to `ghcr.io` with `GITHUB_TOKEN` →
  `docker/metadata-action` derives tags/labels from the git tag (`:v0.1.0` **and** `:latest`) →
  `docker/build-push-action` builds the root `Dockerfile` and pushes, `platforms:
  linux/amd64,linux/arm64`, with GitHub Actions build cache (`cache-from/to: type=gha`).
- **Gated on tests:** the publish job **must not run unless the test suite passes**. Mechanism:
  `ci.yml` (§7) is authored as a **reusable workflow** (`on: workflow_call`); `release.yml` calls it
  as a prerequisite job and the build-push job declares `needs:` that job. A red suite ⇒ no image.
- **Multi-arch:** amd64 + arm64. The arm64 leg builds under QEMU emulation (slower, but the
  tag-triggered release runs rarely; `psycopg[binary]` and node/vite provide arm64 wheels/builds).
- **One-time GHCR visibility:** the first pushed package is **private** by default; the maintainer
  flips the GHCR package to **public** once, so end-user `docker compose pull` needs no auth. This
  is a documented maintainer hand-off (needs their GitHub account).

## 7. CI — test pipeline (`.github/workflows/ci.yml`)

- **Trigger:** push / pull_request (to `main`), **and** `workflow_call` (so `release.yml` can reuse
  it as its gate).
- **Backend job:** a `postgres:17` **service container**; install backend + dev deps; configure the
  test database URL to satisfy `conftest.py`'s destructive-target guard (explicit **loopback**
  host+port, database name matching `mathion_test*`, no libpq env indirection); run the full
  backend suite (currently **1160 passed / 1 skipped**).
- **Frontend job:** `npm ci` + `npm run build` (ensures the SPA builds — a build failure would
  otherwise only surface during the image build) + the frontend unit tests.
- Green on both is the release gate.

---

## 8. Documented manual bring-up (README section)

A new **"Self-hosting Mathion"** README section — the exact sequence the Slice 2 `install`
automates.

**Prerequisites:** a Linux host with Docker + Compose v2; a domain (A/AAAA record) pointing at it;
a reverse proxy for TLS (reproxy primary, Caddy alternative — §9).

1. Obtain `docker-compose.prod.yml` + `.env.example` (clone the repo, or download the two files).
2. Copy `.env.example` → `.env`; set `MATHION_BASE_URL`; generate `MATHION_SECRET_KEY`
   (`openssl rand -base64 48`) and `POSTGRES_PASSWORD` (`openssl rand -hex 24`, pasting the **same**
   value into `MATHION_DATABASE_URL`); set `MATHION_VERSION` to the latest release tag.
3. `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d --wait`
4. `docker compose -f docker-compose.prod.yml exec app alembic upgrade head`
5. `docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser create-superuser you@school.edu`
6. `docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser pin you@school.edu` → prints the first-login PIN
7. Start the reverse proxy → `127.0.0.1:8000` (§9); browse to `https://<domain>`, log in with email + PIN.
8. *(optional)* `docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser activate` → prints the `/superuser/{token}` panel URL.

## 9. TLS / reverse proxy (documented external)

Primary example: **reproxy** (`github.com/umputun/reproxy`) — a single static Go binary with
automatic Let's Encrypt, e.g. a host binary/systemd unit invoked with
`--ssl.type=auto --ssl.acme-fqdn=<domain> --static.rule='*,/,http://127.0.0.1:8000'`, or a labelled
container (its Docker provider is the natural fit for the future bundled-TLS slice). **Caddy** is
documented as the ubiquitous alternative (2-line Caddyfile: `<domain> { reverse_proxy
127.0.0.1:8000 }`). The proxy is the deployer's responsibility; it is **not** part of the compose
stack in this slice.

---

## 10. Verification / testing

This slice is packaging + ops, so the verification net differs from unit tests:

1. **`ci.yml`** (§7) — the behavior regression net (backend suite + frontend build/tests); the
   release gate.
2. **`deploy/smoke.sh`** — the key new artifact. It:
   - builds the production image **locally** (`docker build` — no registry needed, so it runs
     before the repo is even pushed, and in CI on the release path);
   - brings up the prod compose stack against a **throwaway `.env`** (test secrets, ephemeral
     volumes);
   - runs `alembic upgrade head`;
   - creates a superuser and issues a PIN via `python -m mathion.superuser`;
   - **asserts:** `GET /health` → 200; the SPA is served at `/` (returns the app-shell HTML);
     an unknown deep link (e.g. `/runs/123`) returns `index.html` (SPA fallback); a bogus
     `/api/<nonexistent>` returns **JSON 404**, not `index.html` (the API-vs-SPA boundary holds);
   - tears the stack down (and removes the ephemeral volumes).
   It is the executable proof that the packaged artifact runs end-to-end — the real risk in this
   slice. It exits non-zero on any failed assertion.
3. **Manual acceptance** — the §8 bring-up steps double as a one-time fresh-VM checklist.

**What can and cannot be verified locally (honest scoping):** the Dockerfile, compose,
`.env.example`, `smoke.sh`, and workflow YAML are authored and **fully validated locally**
(`smoke.sh` builds + runs the real image; workflows validated by inspection + local `act`-style
reasoning). The **live GHCR publish + end-to-end `docker compose pull`** can only be exercised
**after** the maintainer pushes `main`, tags a release, and flips the package public — a one-time
outward-facing hand-off requiring their GitHub auth (the agent shell cannot push). Slice 1 delivers
everything verified-locally, with the live-registry publish documented as that hand-off.

---

## 11. File manifest

**Created:**
- `Dockerfile` (repo root, multi-stage)
- `.dockerignore` (repo root)
- `docker-compose.prod.yml` (repo root)
- `.env.example` (repo root)
- `.github/workflows/ci.yml` (test; reusable via `workflow_call`)
- `.github/workflows/release.yml` (build + push to GHCR, gated on `ci.yml`)
- `deploy/smoke.sh` (executable stack smoke)

**Modified:**
- `README.md` (new "Self-hosting Mathion" section + TLS/reverse-proxy guidance)
- `.gitignore` (ignore `.env`)

**Application code:** none expected. `/health` and SPA serving already exist; the superuser CLI
already exists. If a reviewer proves a concrete, minimal, additive need (e.g. a missing bit the
image genuinely requires), it is called out and adjudicated — but the working assumption is
zero app-code change.

---

## 12. Prerequisites & maintainer hand-offs (outward-facing, agent cannot do these)

1. **Push `main`** to `git@github.com:svkucheryavski/mathion.git` (agent shell lacks GitHub SSH
   auth; the maintainer runs `git push -u origin main`).
2. **Tag a release** (`git tag v0.1.0 && git push --tags`) to trigger `release.yml`.
3. **Flip the GHCR package to public** (one-time) so end-user pulls need no auth.

These are documented in the plan as explicit hand-off steps; everything else is agent-authored and
locally verified.

---

## 13. Open questions

None outstanding. All design decisions (image strategy, reverse proxy = reproxy, registry = GHCR,
multi-arch = amd64+arm64, test-CI gate = yes, single worker = yes) are settled. Remaining exactness
(precise workflow YAML, exact conftest test-DB env var, precise Dockerfile layering) is
implementation detail for the plan.
```
