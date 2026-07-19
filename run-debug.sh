#!/usr/bin/env bash
# Dev runner: starts the Mathion backend in developer mode (MATHION_DEBUG=1 —
# login PINs are printed to stdout instead of emailed) with a writable asset
# path. Override MATHION_ASSET_PATH below if you prefer a different storage
# location.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure the local Postgres (docker-compose service `db`) is up before the app
# boots. --wait blocks until the healthcheck passes.
docker compose up -d --wait db

# shellcheck disable=SC1091
source backend/.venv/bin/activate

export MATHION_DEBUG=1
export MATHION_ASSET_PATH="$HOME/mathion-assets"

cd backend
exec uvicorn mathion.main:app --reload
