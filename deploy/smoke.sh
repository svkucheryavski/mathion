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
BODY="${WORK}/api-404.body"
# Per-run-unique project: a fresh project has no pre-existing volumes, so stale
# pgdata can never be reused (guaranteed-fresh deployment) AND two concurrent
# runs can't collide on the same containers/volumes — no lock needed, fully
# portable (no flock dependency). $$ matches the image tag's PID.
PROJECT="mathion_smoke_$$"
CMP=(docker compose -f docker-compose.prod.yml -p "${PROJECT}")

cleanup() {
  ( cd "${WORK}" 2>/dev/null && "${CMP[@]}" down -v ) >/dev/null 2>&1 \
    || echo "WARN: smoke stack teardown failed — check 'docker compose -p ${PROJECT} ps' for leaks" >&2
  rm -rf "${WORK}" || echo "WARN: temp dir ${WORK} not removed" >&2
  docker image rm -f "${IMAGE}" >/dev/null 2>&1 \
    || echo "WARN: image ${IMAGE} not removed" >&2
}
trap cleanup EXIT

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

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

echo "==> Preflight: ensure a clean slate for ${PROJECT}"
"${CMP[@]}" down -v >/dev/null || fail "preflight 'down -v' could not establish a clean slate for project ${PROJECT} (see error above)"

echo "==> Bringing up the stack (no pull; local image)"
"${CMP[@]}" up -d --wait     # guard PASSES here (real secret + cookie_secure=1)

echo "==> Migrating + creating a superuser"
"${CMP[@]}" exec -T app alembic upgrade head
"${CMP[@]}" exec -T app python -m mathion.superuser create-superuser you@example.edu

BASE="http://127.0.0.1:8000"

echo "==> /health"
[ "$(curl -fsS "${BASE}/health")" = '{"status":"ok"}' ] || fail "/health"

echo "==> SPA served at / and deep links → packaged index.html"
"${CMP[@]}" exec -T app cat /app/static/index.html > "${WORK}/index.expected"
curl -fsS "${BASE}/"                -o "${WORK}/index.root"
curl -fsS "${BASE}/some/deep/route" -o "${WORK}/index.deep"
diff -q "${WORK}/index.expected" "${WORK}/index.root" >/dev/null || fail "/ is not the packaged index.html"
diff -q "${WORK}/index.expected" "${WORK}/index.deep" >/dev/null || fail "SPA fallback is not index.html"

echo "==> Unknown /api/* → JSON 404 (API/SPA boundary)"
code=$(curl -s -D "${WORK}/api-404.hdr" -o "${BODY}" -w '%{http_code}' "${BASE}/api/does-not-exist")
[ "${code}" = "404" ] || fail "/api 404 status (${code})"
grep -qiE '^content-type:[[:space:]]*application/json([[:space:]]*;|[[:space:]]*$)' "${WORK}/api-404.hdr" || fail "/api 404 not application/json"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(d, dict) and 'detail' in d else 1)" "${BODY}" || fail "/api 404 body not a JSON object with 'detail'"

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
