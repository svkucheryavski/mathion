#!/usr/bin/env bash
# Dev runner: starts the Mathion backend with debug logging and a writable
# asset path. Override MATHION_ASSET_PATH below if you prefer a different
# storage location.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
source backend/.venv/bin/activate

export MATHION_DEBUG=1
export MATHION_ASSET_PATH="$HOME/mathion-assets"

cd backend
exec uvicorn mathion.main:app --reload
