#!/bin/sh
set -eu
cd "$(dirname "$0")"
go build -o /tmp/mathion .

export MATHION_CONFIG_DIR="$(mktemp -d)"
export MATHION_PROJECT_OVERRIDE="mathion_it_$$"
cleanup() {
  printf '%s\n' "$MATHION_PROJECT_OVERRIDE" | /tmp/mathion uninstall --purge || true
  rm -rf "$MATHION_CONFIG_DIR" || true
}
trap cleanup EXIT

/tmp/mathion install --yes --domain localhost:8000 --admin-email you@example.edu --version "${APP_IMAGE:-v0.1.1}"
# NOTE: install builds MATHION_BASE_URL=https://localhost:8000; the /health probe
# still hits http://127.0.0.1:8000 (loopback), which is fine for the check.

curl -fsS http://127.0.0.1:8000/health | grep -q '"status":"ok"' || { echo "FAIL /health"; exit 1; }

CMP="docker compose -p ${MATHION_PROJECT_OVERRIDE} -f ${MATHION_CONFIG_DIR}/docker-compose.yml --env-file ${MATHION_CONFIG_DIR}/.env"
n="$($CMP exec -T db psql -U mathion -d mathion -tAc "select count(*) from users where is_superuser and email='you@example.edu'" | tr -d '[:space:]')"
[ "$n" = "1" ] || { echo "FAIL superuser row ($n)"; exit 1; }

# purge (typed confirmation piped)
printf '%s\n' "$MATHION_PROJECT_OVERRIDE" | /tmp/mathion uninstall --purge
docker volume inspect "${MATHION_PROJECT_OVERRIDE}_mathion_pgdata" >/dev/null 2>&1 && { echo "FAIL volume survived purge"; exit 1; }
echo "integration_test PASSED"
