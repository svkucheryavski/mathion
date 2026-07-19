#!/usr/bin/env bash
# Dev runner: ensures the local Postgres is up, runs Alembic migrations, seeds
# the teacher dashboards smoke fixture (which auto-invokes Slice A first), then
# starts the Mathion backend in developer mode (MATHION_DEBUG=1 — login PINs are
# printed to stdout instead of emailed).
#
# Assumes a clean database. To reset, drop the compose volume first:
#   docker compose down -v && docker compose up -d --wait db
#
# Frontend dev server (npm run dev from frontend/) runs separately in
# another terminal.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure the local Postgres (docker-compose service `db`) is up before migrating.
# --wait blocks until the healthcheck passes.
docker compose up -d --wait db

# shellcheck disable=SC1091
source backend/.venv/bin/activate

export MATHION_DEBUG=1
export MATHION_ASSET_PATH="$HOME/mathion-assets"

cd backend

echo "[run-dashboards-smoke] Running migrations..."
alembic upgrade head

echo "[run-dashboards-smoke] Seeding teacher dashboards smoke fixture..."
python -m scripts.seed_teaching_dashboards_smoke

echo "[run-dashboards-smoke] Starting uvicorn (admin: admin@mathion.test, teacher: teacher@mathion.test; PIN printed to stdout on /login)..."
exec uvicorn mathion.main:app --reload
