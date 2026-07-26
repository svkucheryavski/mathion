# Phase 9-D Slice 1 — Deployment Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mathion self-hostable and CI-releasable — a production Docker image, a prod compose stack, a `.env` contract, an end-to-end stack smoke, GitHub Actions (test + release-to-GHCR), and documented manual bring-up.

**Architecture:** A single multi-stage Docker image (Node builds the Svelte SPA → `python:3.13-slim` runtime installs the backend wheel and serves API+SPA via one uvicorn process, non-root). `docker-compose.prod.yml` runs `app` + `postgres:17` from a generated `.env`. `deploy/smoke.sh` builds + boots the stack and asserts end-to-end behaviour, and is a CI release gate. Reverse-proxy TLS is documented (external), not in the stack.

**Tech Stack:** Docker multi-stage build (BuildKit/buildx), docker compose v2, GitHub Actions, GHCR, uvicorn, Alembic, pytest, Vite/Svelte 5.

**Spec:** `docs/superpowers/specs/2026-07-26-phase9-d-slice1-deployment-foundation-design.md` (converged: Opus 5/5 + codex APPROVE). Read it for rationale; this plan is the executable form.

## Global Constraints

Every task's requirements implicitly include these (exact values from the spec):
- **Base images:** frontend build stage `node:22-alpine` (with `--platform=$BUILDPLATFORM`); runtime `python:3.13-slim`. Do **not** use 3.14.
- **New runtime dependency:** `python-multipart>=0.0.18` in `backend/pyproject.toml` `[project].dependencies`.
- **Non-root runtime:** user `app`, **fixed uid 10001**. Migration/SPA `COPY`s use **numeric** `--chown=10001:10001`.
- **Image name:** `ghcr.io/svkucheryavski/mathion`. Release tags keep the **`v`** prefix (`v0.1.0`); `latest` only on non-prereleases.
- **Compose project name:** `docker-compose.prod.yml` declares top-level **`name: mathion_prod`**. The smoke uses **`-p mathion_smoke`** and always passes **`-f docker-compose.prod.yml`** (Compose does not auto-discover the `.prod.` filename).
- **Secret guard:** fail-closed guard lives **only in `backend/mathion/main.py`'s lifespan**, gated on **`settings.cookie_secure is True`** (never `debug`, never at import). It is inert across the existing suite; **do not modify `conftest.py`** for it.
- **Env prefix:** all app settings use the `MATHION_` prefix. `MATHION_FRONTEND_DIST=/app/static` is baked into the image and absent from the `.env` contract.
- **CI gating:** `release.yml` gates the build-push job on the reusable CI call via **`needs: [ci]`** (never `needs: [test, smoke]`).
- **CI test job:** runner-hosted (NOT `container:`), `postgres:17` service, `MATHION_TEST_DATABASE_URL=postgresql+psycopg://mathion:mathion@localhost:5432/mathion_test`, `MATHION_DATABASE_URL` left unset, none of `PGHOST/PGHOSTADDR/PGPORT/PGDATABASE/PGSERVICE/PGSERVICEFILE` set, `pip install './backend[dev]'` (quote for zsh). Frontend job on Node 22, `npm test` (do not run bare `vitest` — it needs `TZ=Europe/Copenhagen`).
- **`.dockerignore`:** any-depth patterns — `**/.venv/`, `**/node_modules/`, `**/.env`, `**/.env.*`, `**/outbox/`, `**/.coverage`, `**/htmlcov/`, `**/*.db`, plus `.git/`, `backend/tests/`, `docs/`, `.superpowers/`.
- **Deliberately NOT modified:** `backend/tests/conftest.py`, root `.env.example`, root `.gitignore`.
- **Maintainer hand-offs (agent CANNOT do):** `git push`, `git tag`, making the GHCR package public. These are the only unverifiable-locally steps; everything else is verified in this environment (OrbStack docker is reachable: `docker`, `docker compose`, `buildx` all work; builds are native **arm64** — the amd64 leg only builds in CI).

**Workflow constraints (execution, per maintainer standing rules):** invoke pytest/alembic/python via `backend/.venv`; `git add` exact named paths (never `-A`/`.`); commit trailer exactly `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: App-code prep — `python-multipart` dependency + fail-closed `secret_key` guard

**Files:**
- Modify: `backend/pyproject.toml` (add one dependency line)
- Modify: `backend/mathion/main.py` (guard at the top of `lifespan`; extend one import)
- Create: `backend/tests/test_startup_secret_guard.py`

**Interfaces:**
- Consumes: `mathion.config.settings` (singleton) and `mathion.config.Settings` (class; `Settings.model_fields["secret_key"].default` is the dev-default string, no magic-string duplication). The lifespan reads `settings.cookie_secure` and `settings.secret_key` at boot.
- Produces: a `RuntimeError` raised from `lifespan` startup when `cookie_secure and (not secret_key or secret_key == <dev default>)`. Nothing else depends on this.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_startup_secret_guard.py`:

```python
"""The production secret-key guard must fail closed.

main.py's lifespan refuses to boot when MATHION_SECRET_KEY is empty or still the
dev default WHILE cookie_secure is True (the production posture). It is inert
otherwise (no secure cookies) — which is why the rest of the suite, running with
cookie_secure=False, is unaffected. Entering TestClient(app) as a context manager
runs the lifespan startup (same pattern as test_startup_db_log.py).
"""
import pytest
from fastapi.testclient import TestClient

from mathion.config import settings, Settings
from mathion.main import app

_DEV_DEFAULT = Settings.model_fields["secret_key"].default


def test_guard_refuses_dev_default_secret_with_secure_cookies(monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "secret_key", _DEV_DEFAULT)
    with pytest.raises(RuntimeError, match="MATHION_SECRET_KEY"):
        with TestClient(app):
            pass


def test_guard_refuses_empty_secret_with_secure_cookies(monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "secret_key", "")
    with pytest.raises(RuntimeError, match="MATHION_SECRET_KEY"):
        with TestClient(app):
            pass


def test_guard_allows_real_secret_with_secure_cookies(monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "secret_key", "a-strong-production-secret")
    with TestClient(app):  # must NOT raise
        pass


def test_guard_inert_with_default_secret_when_cookies_insecure(monkeypatch):
    # Dev/test posture: default secret is fine when cookie_secure is False.
    monkeypatch.setattr(settings, "cookie_secure", False)
    monkeypatch.setattr(settings, "secret_key", _DEV_DEFAULT)
    with TestClient(app):  # must NOT raise
        pass
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_startup_secret_guard.py -v`
Expected: the two `refuses_*` tests FAIL (no `RuntimeError` raised — guard not implemented yet); the two allow/inert tests may pass. (Confirms the guard is genuinely absent.)

- [ ] **Step 3: Add the `python-multipart` dependency**

In `backend/pyproject.toml`, add the line to the `dependencies` array (after `nh3`):

```toml
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn>=0.30.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.13.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "psycopg[binary]>=3.2",
    "markdown-it-py>=3.0",
    "mdit-py-plugins>=0.4",
    "nh3>=0.2",
    "python-multipart>=0.0.18",
]
```

- [ ] **Step 4: Implement the guard in the lifespan**

In `backend/mathion/main.py`: change the config import (line 34) from `from mathion.config import settings` to:

```python
from mathion.config import settings, Settings
```

Then insert the guard as the **first** statements inside `lifespan` (immediately after `async def lifespan(app):`, before `app.state.settings = settings`):

```python
    # Fail closed: refuse to boot with the world-known dev secret (or an empty
    # one) when we're in a production posture (secure cookies enabled). The
    # secret salts PIN/token hashing (auth.hash_token), so a default in prod is
    # a real vulnerability, not a nag. Gated on cookie_secure — the prod .env
    # sets MATHION_COOKIE_SECURE=1; dev/tests leave it False, so this is inert
    # there. Lives here (lifespan), never at import, so pytest / alembic /
    # `python -m mathion.superuser` are unaffected.
    if settings.cookie_secure and (
        not settings.secret_key
        or settings.secret_key == Settings.model_fields["secret_key"].default
    ):
        raise RuntimeError(
            "Refusing to start: MATHION_SECRET_KEY is unset or still the dev "
            "default while MATHION_COOKIE_SECURE=1 (production). Set a strong "
            "secret, e.g. `openssl rand -base64 48`."
        )
```

- [ ] **Step 5: Run the guard test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_startup_secret_guard.py -v`
Expected: all four tests PASS.

- [ ] **Step 6: Run the full suite to confirm the guard is inert and nothing regressed**

Run: `cd backend && .venv/bin/pytest -q`
Expected: the full suite passes (≈1160 passed / 1 skipped + the 4 new tests). Any failure here means the guard is not correctly `cookie_secure`-gated — investigate before committing.

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/mathion/main.py backend/tests/test_startup_secret_guard.py
git commit -m "feat(deploy): add python-multipart dep + fail-closed secret_key guard"
```

---

### Task 2: Production `Dockerfile` + `.dockerignore`

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore` (repo root)

**Interfaces:**
- Consumes: Task 1's `pyproject.toml` (image `pip install`s the backend incl. `python-multipart`) and the guard.
- Produces: an image runnable as `docker run … ghcr.io/svkucheryavski/mathion:<tag>` that serves `/health`, runs as uid 10001, has `/app/alembic.ini` + `/app/alembic/` readable, and `MATHION_FRONTEND_DIST=/app/static`. Consumed by Tasks 3, 4, 6.

- [ ] **Step 1: Create `.dockerignore`**

Create `.dockerignore` (repo root):

```
# VCS / tooling
.git/
.superpowers/
docs/

# Python caches / test-only
backend/tests/
**/__pycache__/
**/*.pyc

# Never ship deps, secrets, or generated artifacts (any depth — Docker has no
# gitignore any-depth fallback, so bare names would miss backend/.venv etc.)
**/.venv/
**/node_modules/
**/.env
**/.env.*
**/outbox/
**/.coverage
**/htmlcov/
**/*.db
```

- [ ] **Step 2: Create the `Dockerfile`**

Create `Dockerfile` (repo root):

```dockerfile
# syntax=docker/dockerfile:1

# ---- Stage 1: build the Svelte SPA (arch-independent → build once, natively) ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # → /build/dist

# ---- Stage 2: Python runtime serving API + SPA ----
FROM python:3.13-slim AS runtime

# Non-root user, fixed uid so a persisted named volume stays writable across
# image rebuilds.
RUN useradd -u 10001 -r -s /usr/sbin/nologin app

WORKDIR /app

# Install the app + runtime deps from pyproject (include=["mathion*"] ships only
# the package). Non-editable → lands in site-packages so `uvicorn mathion.main:app`
# and `python -m mathion.superuser` work.
COPY backend/pyproject.toml /tmp/backend/pyproject.toml
COPY backend/mathion /tmp/backend/mathion
RUN pip install --no-cache-dir /tmp/backend && rm -rf /tmp/backend

# Migration assets are excluded from the wheel — copy them separately, tree
# preserved, owned numerically (no build-order dependency on the `app` name).
# Two separate COPYs: a multi-source COPY would flatten alembic/ into /app/ and
# break script_location = %(here)s/alembic.
COPY --chown=10001:10001 backend/alembic.ini /app/alembic.ini
COPY --chown=10001:10001 backend/alembic/    /app/alembic/

# Built SPA + pin its path (the settings default resolves into site-packages).
COPY --from=frontend --chown=10001:10001 /build/dist /app/static
ENV MATHION_FRONTEND_DIST=/app/static

# Asset dir owned by app BEFORE any named volume attaches (a fresh named volume
# inherits the mountpoint's uid/gid on first init → writable by non-root app).
RUN mkdir -p /data/mathion/assets && chown -R 10001:10001 /data/mathion

USER app
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --retries=20 --start-period=10s \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status==200 else 1)"]
CMD ["uvicorn", "mathion.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Build the image (verify build succeeds)**

Run (from repo root; ensure `/usr/local/bin` is on PATH so `docker` resolves — OrbStack links it):
```bash
docker build -t mathion:t2 .
```
Expected: build completes; the frontend stage runs `npm ci` + `npm run build`, the runtime stage `pip install`s the backend (pulling `python-multipart`), copies alembic + static, ends non-root. No errors.

- [ ] **Step 4: Run the image and assert it boots healthy, non-root, alembic readable**

`/health` performs no DB access and email is disabled (no dispatcher/DB at startup), so the container serves `/health` with no database. `cookie_secure` defaults False, so the guard is inert here.

```bash
docker run -d --name mathion_t2 -p 18000:8000 mathion:t2
sleep 4
curl -fsS http://localhost:18000/health           # expect: {"status":"ok"}
docker exec mathion_t2 id -u                       # expect: 10001
docker exec mathion_t2 sh -c 'head -1 /app/alembic.ini && ls /app/alembic/versions >/dev/null && echo OK'  # expect: prints [alembic] header + OK
docker exec mathion_t2 python -c "import mathion.main"   # expect: no output, exit 0 (proves python-multipart present)
docker rm -f mathion_t2
```
Expected: `{"status":"ok"}`, `10001`, `OK`, and the `import mathion.main` exits 0. Any failure (esp. a multipart `RuntimeError` on import) blocks the task.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(deploy): production multi-stage Dockerfile + .dockerignore"
```

---

### Task 3: `docker-compose.prod.yml` + `deploy/.env.prod.example`

**Files:**
- Create: `docker-compose.prod.yml` (repo root)
- Create: `deploy/.env.prod.example`

**Interfaces:**
- Consumes: the Task 2 image (`ghcr.io/svkucheryavski/mathion:${MATHION_VERSION}`).
- Produces: a stack whose `app` reads `.env` (`env_file`), depends on a healthy `db`, binds `127.0.0.1:8000`, persists `mathion_assets`/`mathion_pgdata`; project `mathion_prod`. Consumed by Task 4 (smoke) and Task 6 docs.

- [ ] **Step 1: Create `docker-compose.prod.yml`**

```yaml
name: mathion_prod

services:
  app:
    image: ghcr.io/svkucheryavski/mathion:${MATHION_VERSION}
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - mathion_assets:/data/mathion/assets
    ports:
      - "127.0.0.1:8000:8000"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status==200 else 1)"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 10s
    restart: unless-stopped
    stop_grace_period: 35s

  db:
    image: postgres:17
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - mathion_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 2s
      timeout: 3s
      retries: 30
    restart: unless-stopped

volumes:
  mathion_assets:
  mathion_pgdata:
```

- [ ] **Step 2: Create `deploy/.env.prod.example`**

```bash
# Mathion production configuration. Copy to `.env` (same directory as
# docker-compose.prod.yml) and fill in. This file is a committed contract with
# NO real secrets. `.env` is git-ignored.

# --- Generated secrets (NEVER ship the defaults) ---
MATHION_SECRET_KEY=          # `openssl rand -base64 48` — salts PIN/token hashing; ENFORCED at boot
POSTGRES_PASSWORD=           # `openssl rand -hex 24` — hex → URL-safe (no escaping in the URL below)

# --- Database: user/host/db/password below MUST match the POSTGRES_* values ---
POSTGRES_USER=mathion
POSTGRES_DB=mathion
MATHION_DATABASE_URL=postgresql+psycopg://mathion:<same-hex-password>@db:5432/mathion

# --- Deployment identity ---
MATHION_BASE_URL=https://learn.example.edu   # your domain; validated (authority, no path)

# --- Production hardening ---
MATHION_COOKIE_SECURE=1
MATHION_DEBUG=0
MATHION_EMAIL_MODE=disabled

# --- Storage & limits (defaults shown, for documentation) ---
MATHION_ASSET_PATH=/data/mathion/assets
MATHION_MAX_FILE_SIZE=20971520
MATHION_MAX_COURSE_SIZE=524288000

# --- Image version pin (Slice 3 `update` bumps this) ---
MATHION_VERSION=v0.1.0
```

- [ ] **Step 3: Validate the compose file parses + interpolates**

```bash
cd "$(mktemp -d)" && WORK="$PWD"
cp /Users/svkucheryavski/Documents/Developing/mathion/docker-compose.prod.yml "$WORK/"
printf 'MATHION_VERSION=t3\nPOSTGRES_USER=mathion\nPOSTGRES_PASSWORD=devhex\nPOSTGRES_DB=mathion\nMATHION_SECRET_KEY=x\n' > "$WORK/.env"
docker compose -f docker-compose.prod.yml -p mathion_ptest config >/dev/null && echo "compose config OK"
```
Expected: `compose config OK` (no interpolation/parse errors).

- [ ] **Step 4: Live bring-up — prove the image + compose integrate, migrate, and the CLI reaches the DB**

From the same temp `$WORK` dir (never the repo root, so the repo `.env` is untouched). First tag the Task-2 image to the compose ref:

```bash
docker build -t ghcr.io/svkucheryavski/mathion:t3 /Users/svkucheryavski/Documents/Developing/mathion
# rewrite the throwaway .env with a real prod-posture secret + matching DB creds:
cat > "$WORK/.env" <<'EOF'
MATHION_VERSION=t3
MATHION_SECRET_KEY=smoke-secret-not-default
POSTGRES_USER=mathion
POSTGRES_PASSWORD=abc123hex
POSTGRES_DB=mathion
MATHION_DATABASE_URL=postgresql+psycopg://mathion:abc123hex@db:5432/mathion
MATHION_BASE_URL=http://localhost:8000
MATHION_COOKIE_SECURE=1
MATHION_DEBUG=0
MATHION_EMAIL_MODE=disabled
EOF
CMP="docker compose -f docker-compose.prod.yml -p mathion_ptest"
$CMP up -d --wait
$CMP exec -T app alembic upgrade head
$CMP exec -T app python -m mathion.superuser create-superuser you@example.edu
$CMP down -v
```
Expected: `up -d --wait` reports both services healthy; `alembic upgrade head` applies the initial migration cleanly; `create-superuser` prints a confirmation; `down -v` tears down. (This proves the guard PASSES with a real secret + `cookie_secure=1`, the alembic.ini is readable, and the CLI reaches `db`.) Clean up: `rm -rf "$WORK"`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml deploy/.env.prod.example
git commit -m "feat(deploy): prod compose stack (name: mathion_prod) + .env contract"
```

---

### Task 4: `deploy/smoke.sh` — end-to-end stack smoke (the release gate)

**Files:**
- Create: `deploy/smoke.sh` (executable)

**Interfaces:**
- Consumes: Tasks 2+3 (builds the image, runs the compose stack).
- Produces: `bash deploy/smoke.sh` exits 0 iff the packaged stack works end-to-end. Consumed by Task 5's `smoke` CI job.

- [ ] **Step 1: Create `deploy/smoke.sh`**

```bash
#!/usr/bin/env bash
# End-to-end stack smoke: build the prod image, run the prod compose stack in an
# isolated project + temp dir (never touching the repo-root .env), and assert
# real behaviour. Exits non-zero on any failure. Runs locally (no registry) and
# as a CI release gate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="smoke-$$"
IMAGE="ghcr.io/svkucheryavski/mathion:${VER}"
WORK="$(mktemp -d)"
PROJECT="mathion_smoke"
CMP=(docker compose -f docker-compose.prod.yml -p "${PROJECT}")

cleanup() {
  ( cd "${WORK}" 2>/dev/null && "${CMP[@]}" down -v ) >/dev/null 2>&1 || true
  rm -rf "${WORK}"
  docker image rm -f "${IMAGE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building image ${IMAGE}"
docker build -t "${IMAGE}" "${REPO_ROOT}"

echo "==> Preparing isolated stack in ${WORK}"
cp "${REPO_ROOT}/docker-compose.prod.yml" "${WORK}/"
cat > "${WORK}/.env" <<EOF
MATHION_VERSION=${VER}
MATHION_SECRET_KEY=smoke-secret-not-default
POSTGRES_USER=mathion
POSTGRES_PASSWORD=smokehex24
POSTGRES_DB=mathion
MATHION_DATABASE_URL=postgresql+psycopg://mathion:smokehex24@db:5432/mathion
MATHION_BASE_URL=http://localhost:8000
MATHION_COOKIE_SECURE=1
MATHION_DEBUG=0
MATHION_EMAIL_MODE=disabled
EOF
cd "${WORK}"

echo "==> Bringing up the stack (no pull; local image)"
"${CMP[@]}" up -d --wait     # guard PASSES here (real secret + cookie_secure=1)

echo "==> Migrating + creating a superuser"
"${CMP[@]}" exec -T app alembic upgrade head
"${CMP[@]}" exec -T app python -m mathion.superuser create-superuser you@example.edu

BASE="http://127.0.0.1:8000"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

echo "==> /health"
[ "$(curl -fsS "${BASE}/health")" = '{"status":"ok"}' ] || fail "/health"

echo "==> SPA served at /"
curl -fsS "${BASE}/" | grep -qi '<!doctype html' || fail "SPA index at /"

echo "==> Unknown deep link → index.html (SPA fallback)"
curl -fsS "${BASE}/some/deep/route" | grep -qi '<!doctype html' || fail "SPA fallback"

echo "==> Unknown /api/* → JSON 404 (API/SPA boundary)"
code=$(curl -s -o /tmp/smk.body -w '%{http_code}' "${BASE}/api/does-not-exist")
[ "${code}" = "404" ] || fail "/api 404 status (${code})"
grep -q '"detail"' /tmp/smk.body || fail "/api 404 not JSON"

echo "==> Non-root asset-volume write"
"${CMP[@]}" exec -T app python -c "open('/data/mathion/assets/.probe','w').write('x')" || fail "asset write"
[ "$("${CMP[@]}" exec -T app id -u | tr -d '\r')" = "10001" ] || fail "not uid 10001"

echo "==> First-login round-trip (verify-pin → 200 + Secure cookie)"
PIN=$("${CMP[@]}" exec -T app python -m mathion.superuser pin you@example.edu | grep -oE '[0-9]{6}' | head -1)
[ -n "${PIN}" ] || fail "no PIN issued"
hdrs=$(curl -s -D - -o /dev/null \
  -H 'Content-Type: application/json' -H 'X-Requested-With: mathion' \
  -X POST "${BASE}/api/auth/verify-pin" \
  -d "{\"email\":\"you@example.edu\",\"pin\":\"${PIN}\",\"duration_days\":7}")
echo "${hdrs}" | grep -qE '^HTTP/[0-9.]+ 200' || fail "verify-pin not 200"
echo "${hdrs}" | grep -qi 'set-cookie:.*Secure' || fail "session cookie not Secure"

echo "==> DB persists across down (no -v) + up recreation"
REV_BEFORE=$("${CMP[@]}" exec -T db psql -U mathion -d mathion -tAc "select version_num from alembic_version")
"${CMP[@]}" down          # NO -v — keep volumes
"${CMP[@]}" up -d --wait
REV_AFTER=$("${CMP[@]}" exec -T db psql -U mathion -d mathion -tAc "select version_num from alembic_version")
[ -n "${REV_BEFORE}" ] && [ "${REV_BEFORE}" = "${REV_AFTER}" ] || fail "pgdata did not persist (${REV_BEFORE} != ${REV_AFTER})"

echo "==> SMOKE PASSED"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x deploy/smoke.sh
```

- [ ] **Step 3: Run the smoke — the live integration gate**

```bash
bash deploy/smoke.sh; echo "exit=$?"
```
Expected: prints each `==>` step, ends `SMOKE PASSED`, `exit=0`. If any assertion fails it prints `SMOKE FAIL: …` and exits non-zero — fix before committing. (Static-check first with `bash -n deploy/smoke.sh`, and `shellcheck deploy/smoke.sh` if available.)

- [ ] **Step 4: Commit**

```bash
git add deploy/smoke.sh
git commit -m "feat(deploy): end-to-end stack smoke (deploy/smoke.sh)"
```

---

### Task 5: `.github/workflows/ci.yml` — test + frontend + smoke (reusable)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1's `[dev]` extra + `MATHION_TEST_DATABASE_URL` contract; Task 4's `deploy/smoke.sh`.
- Produces: a workflow reusable via `workflow_call` with jobs `test`, `frontend`, `smoke`. Consumed by Task 6's `release.yml` (`needs: [ci]`).

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_call:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgres:17
        env:
          POSTGRES_USER: mathion
          POSTGRES_PASSWORD: mathion
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U mathion"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 30
    env:
      MATHION_TEST_DATABASE_URL: postgresql+psycopg://mathion:mathion@localhost:5432/mathion_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - name: Install backend + dev deps
        run: pip install './backend[dev]'
      - name: Run backend suite
        run: cd backend && pytest -q

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Install
        run: cd frontend && npm ci
      - name: Test (TZ pinned by the npm script)
        run: cd frontend && npm test
      - name: Build
        run: cd frontend && npm run build

  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Stack smoke (builds the prod image, boots the stack, asserts)
        run: bash deploy/smoke.sh
```

- [ ] **Step 2: Validate the workflow YAML**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml valid YAML')"
# if actionlint is available: actionlint .github/workflows/ci.yml
```
Expected: `ci.yml valid YAML` (and actionlint clean if present).

- [ ] **Step 3: Locally validate the job *commands* work (GitHub orchestration can't run here, but the steps can)**

Backend `test` job equivalent (mirrors the runner-hosted postgres service):
```bash
docker run -d --name pg_ci -e POSTGRES_USER=mathion -e POSTGRES_PASSWORD=mathion -p 5432:5432 postgres:17
until docker exec pg_ci pg_isready -U mathion >/dev/null 2>&1; do sleep 1; done
cd backend && MATHION_TEST_DATABASE_URL=postgresql+psycopg://mathion:mathion@localhost:5432/mathion_test .venv/bin/pytest -q; cd ..
docker rm -f pg_ci
```
Expected: suite passes (this is exactly what the `test` job runs; `MATHION_DATABASE_URL` unset, no PG* env — matches the conftest guard). **Note:** if the dev `docker-compose.yml` db is already publishing 5432, stop it first (`docker compose -p mathion down` / different project) to avoid a port clash.

Frontend `frontend` job equivalent:
```bash
cd frontend && npm ci && npm test && npm run build; cd ..
```
Expected: vitest passes (TZ pinned by the npm script) and the build produces `frontend/dist`.

(The `smoke` job runs `deploy/smoke.sh`, already proven green in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(deploy): reusable CI — backend + frontend + stack smoke"
```

---

### Task 6: `.github/workflows/release.yml` — build + push to GHCR (gated on CI)

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Task 5's `ci.yml` (via `uses:` → `needs: [ci]`).
- Produces: on a `v*` tag, a multi-arch image pushed to `ghcr.io/svkucheryavski/mathion` (tag keeps `v`; `latest` only on non-prereleases). Runs only after the maintainer pushes + tags (hand-off).

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  packages: write

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  build-push:
    needs: [ci]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Image metadata (keep the v prefix; latest only on non-prereleases)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/mathion
          tags: |
            type=ref,event=tag
          flavor: |
            latest=${{ !contains(github.ref, '-') }}
      - name: Build and push (amd64 + arm64)
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Validate the workflow YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('release.yml valid YAML')"
# if actionlint is available: actionlint .github/workflows/release.yml
```
Expected: `release.yml valid YAML`. Confirm by inspection: `needs: [ci]` references the reusable-call job `ci` (not `test`/`smoke`); `type=ref,event=tag` keeps the `v`; `latest=` disables on prerelease tags (containing `-`).

- [ ] **Step 3: Note the maintainer hand-off (cannot run locally)**

The actual publish requires `git push` + `git tag v0.1.0 && git push --tags` (triggers this workflow) and a one-time flip of the GHCR package to public — all maintainer steps (the agent shell cannot authenticate to GitHub/GHCR). Record this; do not attempt to push.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(deploy): release workflow — multi-arch build+push to GHCR, gated on CI"
```

---

### Task 7: README — "Self-hosting Mathion (production)" section

**Files:**
- Modify: `README.md` (append a new top-level section after the existing content)

**Interfaces:**
- Consumes: the proven flows from Tasks 3, 4, 6 (compose bring-up, smoke, release).
- Produces: operator docs. No code interface.

- [ ] **Step 1: Append the self-hosting section to `README.md`**

Add after the existing `## Tests` section:

````markdown
## Self-hosting Mathion (production)

Requires: a Linux host with Docker + Compose v2; a domain (A/AAAA) pointing at it;
inbound TCP **80 and 443** open (for ACME/Let's Encrypt); a reverse proxy for TLS
(reproxy primary, Caddy alternative — see below). These steps require a
**published** image — valid only after the maintainer has pushed a release and
made the GHCR package public.

Work from a directory containing `docker-compose.prod.yml`.

```bash
# 1. Configure
cp deploy/.env.prod.example .env
#    Edit .env: set MATHION_BASE_URL; generate MATHION_SECRET_KEY (`openssl rand -base64 48`)
#    and POSTGRES_PASSWORD (`openssl rand -hex 24`, pasting the SAME value into
#    MATHION_DATABASE_URL); set MATHION_VERSION to the current release tag (see the
#    repo's Releases/Packages page, e.g. v0.1.0).

# 2. Pull + start
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --wait

# 3. Migrate the database
docker compose -f docker-compose.prod.yml exec app alembic upgrade head

# 4. Create the first superuser
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser create-superuser you@school.edu

# 5. Start your reverse proxy → 127.0.0.1:8000 (below) and confirm https://<domain>
#    loads with a valid cert FIRST (ACME + DNS can take minutes).

# 6. Issue the first-login PIN LAST (it expires in 10 minutes)
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser pin you@school.edu
#    Then browse to https://<domain> (test via HTTPS, not http://127.0.0.1:8000 —
#    the Secure session cookie won't persist over plain HTTP) and log in with
#    email + PIN.

# 7. (optional) Superuser panel URL:
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser activate
```

### TLS / reverse proxy (external)

Primary — **reproxy** (host-run; pin a specific release and verify the flags):

```bash
reproxy --listen=:443 --ssl.type=auto --ssl.fqdn=<domain> --ssl.http-port=80 \
        --max=25M --static.enabled --static.rule='*,/,http://127.0.0.1:8000'
```

Host mode defaults to `127.0.0.1:443`, so `--listen=:443` is required; ACME http-01
needs port 80; `--static.enabled` is required alongside `--static.rule`; and
reproxy's default `--max` is **64K** — raise it above `MATHION_MAX_FILE_SIZE`
(20 MiB) or uploads are rejected at the proxy. Binding 80/443 needs root or
`CAP_NET_BIND_SERVICE`.

Alternative — **Caddy** (no low default body limit; auto-manages 80/443 + ACME):

```
<domain> { reverse_proxy 127.0.0.1:8000 }
```

A **containerized** proxy cannot reach the loopback-only `127.0.0.1:8000` publish —
join the compose network and target `http://app:8000`, or use host networking.

### Operations

- **Rate limits:** PIN issuance 3/hour, verify failures 5/hour (both per email). If
  locked out during setup, wait an hour or clear the `rate_limit_entries` table.
- **Data safety:** `mathion_pgdata` + `mathion_assets` hold all state.
  **`docker compose down -v` permanently deletes them** — use plain `down` to stop.
  Interim backup (until Slice 3 adds `mathion backup`):
  `docker compose -f docker-compose.prod.yml exec db pg_dump -U mathion mathion > backup.sql`
  plus a snapshot of the assets volume.
- **DB password is first-init-only:** don't change `POSTGRES_PASSWORD` after the
  first `up` against an existing `mathion_pgdata`.
- **Interim upgrade (brief downtime; until Slice 3's `mathion update`):** back up →
  stop the proxy → `docker compose -f docker-compose.prod.yml stop app` → bump
  `MATHION_VERSION` → `pull` → migrate on the new image
  (`docker compose -f docker-compose.prod.yml run --rm app alembic upgrade head`) →
  `up -d --wait` → restart the proxy. (`/health` does no DB check, so migrating
  before serving avoids running new code on the old schema.)
````

- [ ] **Step 2: Verify the docs render + commands are internally consistent**

```bash
python3 -c "print(open('README.md').read().count('```') % 2 == 0 and 'fences balanced')"
grep -n "docker-compose.prod.yml" README.md   # every prod command carries -f
```
Expected: `fences balanced`; every production `docker compose` command in the new section uses `-f docker-compose.prod.yml`. Cross-check the reproxy flags + the bring-up ordering match §8/§9 of the spec.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(deploy): self-hosting Mathion (production) README section"
```

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** §3 image → Task 2; §4 compose → Task 3; §5 `.env` → Task 3; §6 release → Task 6; §7 CI → Task 5; §8 bring-up → Task 7; §9 TLS → Task 7; §10 verify/smoke → Task 4; §11 manifest → all tasks (Dockerfile, .dockerignore, compose, deploy/.env.prod.example, deploy/smoke.sh, ci.yml, release.yml, test_startup_secret_guard.py, README, pyproject, main.py); §2 two app-code changes → Task 1. All covered.

**2. Placeholder scan:** every file's full content is inline; no TBD/TODO; verification commands have expected output.

**3. Type/name consistency:** image ref `ghcr.io/svkucheryavski/mathion:${MATHION_VERSION}` identical in compose (Task 3), smoke (Task 4), release meta (Task 6); project names `mathion_prod` (file) / `mathion_smoke` (smoke) / `mathion_ptest` (Task 3 check) consistent; guard reads `settings.cookie_secure` + `Settings.model_fields["secret_key"].default` consistently in main.py (Task 1) and the test; uid `10001` consistent across Dockerfile COPYs, `useradd`, and the smoke assertion; `-f docker-compose.prod.yml` present on every prod/smoke compose command.

**Known local/CI boundary:** Tasks 1–4 are fully verified in this environment (pytest + OrbStack docker). Task 5's GitHub *orchestration* can't run locally, but its job *commands* are validated locally (postgres-container pytest; npm test/build; smoke). Task 6's publish is a maintainer hand-off (push/tag/GHCR-public); only its YAML is validated here.
