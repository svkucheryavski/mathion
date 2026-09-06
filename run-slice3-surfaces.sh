#!/usr/bin/env bash
# Dev runner: ensures the local Postgres is up, runs Alembic migrations, seeds
# the demo course plus the three Slice-3 student surfaces `seed_demo` cannot
# reach, then starts the Mathion backend in developer mode (MATHION_DEBUG=1 —
# login PINs are printed to stdout instead of emailed).
#
# For the Slice-3 visual pass. seed_demo builds only page/video/quiz items and
# no Run, so three student components never render from it:
#   - InteractiveAppItem (needs an interactive_app item + an uploaded .js asset)
#   - UnsupportedItem    (needs an item of type 'mini_project')
#   - MiniProjectLink + StatusPill (need a published Run the student is on)
#
# The `--remove` below is NOT optional and NOT belt-and-braces. Run.version_id
# is ON DELETE RESTRICT, so once the extras seed has created a Run, seed_demo
# can no longer delete the demo course and aborts with a ForeignKeyViolation.
# Removing first is what makes this script re-runnable.
#
# Log in as dev@mathion.test; the PIN is printed to this terminal.
#   Course view                  -> six mini-project rows, one per pill state
#   Getting Started > More item types -> Sine explorer, then Course project
#
# Pass --ungrouped to see the seventh pill state ('Pending group'). It is
# mutually exclusive with the other six — it means the student has no group at
# all, so it replaces every pill rather than adding one:
#   ./run-slice3-surfaces.sh --ungrouped
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

echo "[run-slice3-surfaces] Running migrations..."
alembic upgrade head

echo "[run-slice3-surfaces] Clearing any previous Slice-3 extras..."
python -m scripts.seed_slice3_surfaces --remove

echo "[run-slice3-surfaces] Seeding demo course..."
python -m scripts.seed_demo

echo "[run-slice3-surfaces] Seeding Slice-3 surfaces..."
python -m scripts.seed_slice3_surfaces "$@"

echo "[run-slice3-surfaces] Starting uvicorn (student: dev@mathion.test; PIN printed to stdout on /login)..."
exec uvicorn mathion.main:app --reload
