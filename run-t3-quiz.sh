#!/usr/bin/env bash
# Dev runner: ensures the local Postgres is up, runs Alembic migrations, seeds
# the demo course plus the Slice-3 T3 reflow questions, then starts the Mathion
# backend in developer mode (MATHION_DEBUG=1 — login PINs are printed to stdout
# instead of emailed).
#
# For the T3 (numeric + text quiz question) visual pass. The demo course's
# "Mixed quiz" carries one numeric_answer and one text_answer question; the
# reflow seed appends two more whose prompts exercise `.text{overflow-wrap}`
# and `.text :global(pre)`, which the plain demo prompts do not.
#
# Log in as dev@mathion.test; the PIN is printed to this terminal.
# Course > "Check your understanding" > "Mixed quiz".
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

echo "[run-t3-quiz] Running migrations..."
alembic upgrade head

echo "[run-t3-quiz] Seeding demo course..."
python -m scripts.seed_demo

echo "[run-t3-quiz] Seeding T3 reflow questions..."
python -m scripts.seed_t3_reflow

echo "[run-t3-quiz] Starting uvicorn (student: dev@mathion.test; PIN printed to stdout on /login)..."
exec uvicorn mathion.main:app --reload
