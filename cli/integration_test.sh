#!/usr/bin/env bash
#
# mathion real-Docker integration test (MANUAL / OPT-IN lane — NOT part of `go test`).
#
# This script drives the SHIPPED CLI commands end to end against a REAL Docker
# daemon: install -> backup -> restore -> update -> rollback -> crash-resume ->
# start/stop/uninstall. It is the maintainer's on-host verification lane and is
# deliberately excluded from CI: `go test ./...` never runs it. Run it as ROOT on a
# throwaway Docker host (OrbStack/Linux):
#
#     sudo MATHION_BIN=/path/to/mathion ./integration_test.sh
#
# WARNING — this MUTATES real Docker + host state for the resolved project
# (default `mathion_prod`): it creates/destroys containers, volumes, networks and
# images, and it MANAGES the config dir (default /etc/mathion) and the varlib dir
# (default /var/lib/mathion) — tearing down deployment state between legs and on
# exit. Point MATHION_CONFIG_DIR / MATHION_VARLIB_DIR / MATHION_PROJECT_OVERRIDE at
# throwaway locations if you do not want the real ones touched.
#
# ---------------------------------------------------------------------------------
# HARD CONSTRAINT — the pull source is HARDCODED to ghcr.io
# ---------------------------------------------------------------------------------
# `compose.ImageRepo` is the constant "ghcr.io/svkucheryavski/mathion", and the
# embedded compose file's app image is `ghcr.io/svkucheryavski/mathion:${MATHION_VERSION}`.
# `mathion update` step 4 runs a REAL `docker pull ghcr.io/svkucheryavski/mathion:<tag>`
# BEFORE it takes any backup. Consequences the sabotage legs are built around:
#   * A tag that does NOT resolve on the pull source fails at step 4, BEFORE the
#     backup — so it can NOT exercise rollback. To exercise rollback the target MUST
#     pull, then fail at migrate (step 7) or the STRICT gate (step 10).
#   * `/version` returns {"version": settings.version} where settings.version == the
#     MATHION_VERSION env, and the CLI RE-PINS .env MATHION_VERSION to the target on
#     every update. A STOCK target therefore always reports {"version":<target>} and
#     PASSES the strict gate. A version-mismatch sabotage MUST decouple /version from
#     the env: serve a FIXED wrong version, OR serve the legacy 200 text/html SPA.
#     Real v0.1.1 (whose /version IS a 200 text/html SPA) is itself a natural
#     strict-gate-failing sabotage when re-tagged under a slice-3-looking tag.
#   * A local `registry:2` at localhost:5000 can NOT satisfy `docker pull ghcr.io/...`
#     on its own. The forced-failure/legacy legs therefore need ONE maintainer-side
#     prerequisite (this script capability-checks it and SKIPS LOUDLY when absent —
#     it NEVER silently skips):
#       (i)  ITEST_SABOTAGE_MODE=redirect — a daemon-level redirect of
#            ghcr.io/svkucheryavski/mathion -> ITEST_REGISTRY (containerd
#            certs.d/ghcr.io/hosts.toml, or a registry mirror). This script pushes the
#            sabotage image to ITEST_REGISTRY and relies on your redirect.
#       (ii) ITEST_SABOTAGE_MODE=push  (needs ITEST_ALLOW_GHCR_PUSH=1 and a prior
#            `docker login ghcr.io`) — pushes THROWAWAY sabotage tags to the REAL
#            ghcr.io/svkucheryavski/mathion repo; cleanup removes the local refs and
#            warns that the pushed package versions may need manual deletion (`gh api`).
#     Real v0.1.1 is a real published ghcr.io tag and needs NEITHER.
#
# ---------------------------------------------------------------------------------
# ENVIRONMENT (all optional; documented defaults)
# ---------------------------------------------------------------------------------
#   MATHION_BIN            mathion binary to exercise           (default: mathion, from PATH)
#   ITEST_BASE_TAG         base deploy tag for legs 1/2/3/6     (default: v0.1.1)
#   ITEST_OTHER_TAG        a SECOND real ghcr tag for legs 2/5  (default: <unset> -> legs 2/5 SKIP)
#   ITEST_SABOTAGE_TAG     forward-failing tag for legs 3/4     (default: <unset> -> legs 3/4 SKIP)
#   ITEST_SABOTAGE_MODE    redirect | push (how sabotage reaches the ghcr pull source)
#   ITEST_ALLOW_GHCR_PUSH  set to 1 to permit push-mode (pushes to the REAL ghcr repo)
#   ITEST_REGISTRY         throwaway registry for redirect-mode (default: localhost:5000)
#   ITEST_SLOW_MIGRATION   set to 1 to assert a slow/2nd migration exists (enables leg 5)
#   ITEST_DOMAIN           install --domain value               (default: localhost:8000)
#   ITEST_ADMIN_EMAIL      install --admin-email value          (default: itest@example.edu)
#   MATHION_CONFIG_DIR     honored (CLI default: /etc/mathion)
#   MATHION_VARLIB_DIR     honored (CLI default: /var/lib/mathion)
#   MATHION_PROJECT_OVERRIDE honored (CLI default project: mathion_prod)
#
# ---------------------------------------------------------------------------------
# LEGS (each prints exactly one PASS/FAIL/SKIP; a FAIL exits non-zero with a diagnostic)
# ---------------------------------------------------------------------------------
#   1. backup -> mutate DB row + add/delete assets -> restore -> assert full revert.  [runs w/ base tag]
#   2. happy update to a 2nd real tag -> /version JSON == target.                     [SKIP w/o ITEST_OTHER_TAG]
#   3. post-backup forced-failure update -> auto-rollback to old, breadcrumb cleared. [SKIP w/o sabotage supply]
#   4. legacy real-v0.1.1 rollback: forward strict-gate fails -> rollback TO v0.1.1
#      SUCCEEDS via the NON-STRICT gate (tolerates the SPA, gates on image ID).       [SKIP w/o sabotage supply]
#   5. crash-resume: SIGKILL mid-migrate -> labeled orphan + breadcrumb survive ->
#      `start` flock-sweeps the orphan and REFUSES with the restore hint ->
#      `restore --latest` recovers and clears the breadcrumb.                         [SKIP w/o slow migration]
#   6. tar/find/mktemp present; app runs as the assets-volume owner uid.              [runs w/ base tag]
#   7. explicit NOT-RUNNABLE notes (see below).                                       [note/SKIP only]
#
# ---------------------------------------------------------------------------------
# EXPLICIT NOTES (required — leg 7 also prints these at runtime)
# ---------------------------------------------------------------------------------
#   * The "restore an OLDER-schema backup over a MIGRATED DB" leg is NOT runnable
#     until a SECOND Alembic migration exists: only one migration ships today, so
#     there is no older schema to restore over a newer one. It is deferred, not
#     tested here.
#   * Legs 2-5 are NOT CI-runnable: they need real ghcr.io images, a Docker host, and
#     root, and are excluded from `go test`. Legs 1 and 6 also need a Docker host +
#     root (hence the whole script is the manual/opt-in lane).

set -euo pipefail
IFS=$' \t\n'

# --------------------------------------------------------------------------------
# Parameters (documented defaults; `set -u`-safe via ${VAR:-} everywhere below).
# --------------------------------------------------------------------------------
MATHION_BIN="${MATHION_BIN:-mathion}"
ITEST_BASE_TAG="${ITEST_BASE_TAG:-v0.1.1}"
ITEST_OTHER_TAG="${ITEST_OTHER_TAG:-}"
ITEST_SABOTAGE_TAG="${ITEST_SABOTAGE_TAG:-}"
ITEST_SABOTAGE_MODE="${ITEST_SABOTAGE_MODE:-}"
ITEST_ALLOW_GHCR_PUSH="${ITEST_ALLOW_GHCR_PUSH:-}"
ITEST_REGISTRY="${ITEST_REGISTRY:-localhost:5000}"
ITEST_SLOW_MIGRATION="${ITEST_SLOW_MIGRATION:-}"
ITEST_DOMAIN="${ITEST_DOMAIN:-localhost:8000}"
ITEST_ADMIN_EMAIL="${ITEST_ADMIN_EMAIL:-itest@example.edu}"

# Derived surfaces — MUST mirror the CLI's own resolution (root.go / varlib.go) so
# our direct docker/compose calls target exactly the containers the CLI manages.
CFG_DIR="${MATHION_CONFIG_DIR:-/etc/mathion}"
VARLIB_DIR="${MATHION_VARLIB_DIR:-/var/lib/mathion}"
BACKUPS_DIR="$VARLIB_DIR/backups"
JOURNAL="$BACKUPS_DIR/.update-journal.json"            # varlib.JournalPath()
PROJECT="${MATHION_PROJECT_OVERRIDE:-mathion_prod}"    # resolveProject()
COMPOSE_FILE="$CFG_DIR/docker-compose.yml"
ENV_FILE="$CFG_DIR/.env"
IMAGE_REPO="ghcr.io/svkucheryavski/mathion"            # compose.ImageRepo (HARDCODED)
ASSETS_VOL="${PROJECT}_mathion_assets"
PGDATA_VOL="${PROJECT}_mathion_pgdata"
REGISTRY_NAME="mathion_itest_registry"
VERSION_URL="http://127.0.0.1:8000/version"
HEALTH_URL="http://127.0.0.1:8000/health"
LEGACY_TAG="v0.1.1"                                    # leg 4 requires the REAL published SPA image

# Mutable run state (initialized before the EXIT trap so cleanup never dereferences
# an unset var under `set -u`).
PASS_COUNT=0
SKIP_COUNT=0
HAVE_JQ=0
REGISTRY_STARTED=0
_CLEANED=0
CAP_OUT=""
CAP_RC=0
PUSHED_TAGS=()

# --------------------------------------------------------------------------------
# Logging + assertion helpers.
# --------------------------------------------------------------------------------
hr()   { printf '%s\n' "----------------------------------------------------------------------"; }
info() { printf '[itest] %s\n' "$*"; }
note() { printf '[itest][NOTE] %s\n' "$*" >&2; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS: %s\n' "$*"; }
skip() { SKIP_COUNT=$((SKIP_COUNT + 1)); printf 'SKIP: %s\n' "$*" >&2; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# assert_eq EXPECTED ACTUAL CONTEXT — FAILs (with both values) on mismatch.
assert_eq() {
	if [ "$1" = "$2" ]; then return 0; fi
	fail "$3 (expected [$1], got [$2])"
}

# assert_contains HAYSTACK NEEDLE CONTEXT — FAILs when NEEDLE is not a substring.
assert_contains() {
	case "$1" in
	*"$2"*) return 0 ;;
	esac
	fail "$3 (output did not contain [$2])"
}

# assert_true CONTEXT CMD... — runs CMD; FAILs (with CONTEXT) when it exits non-zero.
assert_true() {
	local ctx="$1"
	shift
	if "$@"; then return 0; fi
	fail "$ctx"
}

assert_file_present() {
	if [ ! -e "$1" ]; then fail "$2 (missing: $1)"; fi
}
assert_file_absent() {
	if [ -e "$1" ]; then fail "$2 (still present: $1)"; fi
}

# capture CMD... — runs CMD WITHOUT tripping `set -e`, recording merged
# stdout+stderr in CAP_OUT and the exit code in CAP_RC (for expected-failure paths).
capture() {
	set +e
	CAP_OUT=$("$@" 2>&1)
	CAP_RC=$?
	set -e
}

# --------------------------------------------------------------------------------
# Docker / compose / SQL / HTTP helpers.
# --------------------------------------------------------------------------------
# dc — a compose invocation identical to App.composeArgs (same -p / -f / --env-file).
dc() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# run_sql SQL — executes SQL in the db container (credentials come from the
# container env, exactly as the CLI's own psql/pg one-offs do); output discarded.
run_sql() {
	# shellcheck disable=SC2016  # $POSTGRES_* MUST expand inside the db container, not the host shell
	printf '%s\n' "$1" | dc exec -T db sh -c \
		'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' >/dev/null
}

# query_sql SQL — executes SQL (tuples-only, unaligned) and prints the whitespace-
# stripped scalar result.
query_sql() {
	# shellcheck disable=SC2016  # $POSTGRES_* MUST expand inside the db container, not the host shell
	printf '%s\n' "$1" | dc exec -T db sh -c \
		'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tA' |
		sed 's/[[:space:]]//g'
}

# json_version — reads a body on stdin, prints its .version field (empty if the body
# is not a JSON object, e.g. the legacy text/html SPA). jq if present, else sed.
json_version() {
	if [ "${HAVE_JQ:-0}" = "1" ]; then
		jq -r '.version // empty'
	else
		sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
	fi
}

version_field() {
	local body
	body=$(curl -sS --max-time 5 "$VERSION_URL" 2>/dev/null || true)
	printf '%s' "$body" | json_version 2>/dev/null || true
}
http_code()  { curl -sS -o /dev/null -w '%{http_code}'   --max-time 5 "$1" 2>/dev/null || echo "000"; }
http_ctype() { curl -sS -o /dev/null -w '%{content_type}' --max-time 5 "$1" 2>/dev/null || echo ""; }

# wait_healthy — poll the loopback /health until it reports ok (the CLI already
# --wait's on the container healthcheck; this covers the port-forward settle).
wait_healthy() {
	local i=0
	while [ "$i" -lt 30 ]; do
		if curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
			return 0
		fi
		i=$((i + 1))
		sleep 1
	done
	return 1
}

# assert_version_or_spa TAG CONTEXT — a slice-3+ image serves {"version":TAG} (assert
# exact JSON); a legacy image (v0.1.1) serves a 200 text/html SPA (assert that shape).
# Mirrors the gate's own strict-JSON vs non-strict-SPA tolerance.
assert_version_or_spa() {
	local tag="$1" ctx="$2" ver code ctype
	ver=$(version_field)
	if [ -n "$ver" ]; then
		assert_eq "$tag" "$ver" "$ctx (/version JSON)"
	else
		code=$(http_code "$VERSION_URL")
		ctype=$(http_ctype "$VERSION_URL")
		assert_eq "200" "$code" "$ctx (legacy SPA /version status)"
		assert_contains "$ctype" "text/html" "$ctx (legacy SPA /version content-type)"
	fi
}

# do_backup — runs `mathion backup`, echoing the managed archive path parsed from the
# `backup written to <path> (<n> bytes)` stdout line (falling back to the newest
# managed archive by sortable-timestamp name).
do_backup() {
	local out path
	out=$("$MATHION_BIN" backup) || {
		printf '%s\n' "$out" >&2
		return 1
	}
	path=$(printf '%s\n' "$out" | sed -n 's/^backup written to \(.*\) ([0-9][0-9]* bytes)$/\1/p' | tail -n1)
	if [ -z "$path" ]; then
		path=$(find "$BACKUPS_DIR" -maxdepth 1 -type f -name 'mathion-backup-*.tar.gz' 2>/dev/null | sort | tail -n1 || true)
	fi
	[ -n "$path" ] || return 1
	printf '%s\n' "$path"
}

# --------------------------------------------------------------------------------
# Deployment lifecycle helpers.
# --------------------------------------------------------------------------------
# teardown_deployment — config-independent removal of the resolved project's docker
# resources BY LABEL/NAME (containers, worker orphans, network, volumes). Safe to run
# when nothing (or only part) was created.
teardown_deployment() {
	local ids wids
	ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
	if [ -n "$ids" ]; then printf '%s\n' "$ids" | xargs docker rm -f >/dev/null 2>&1 || true; fi
	wids=$(docker ps -aq --filter "label=io.mathion.worker=1" --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
	if [ -n "$wids" ]; then printf '%s\n' "$wids" | xargs docker rm -f >/dev/null 2>&1 || true; fi
	docker network rm "${PROJECT}_default" >/dev/null 2>&1 || true
	docker volume rm -f "$PGDATA_VOL" "$ASSETS_VOL" >/dev/null 2>&1 || true
}

# reset_config — remove the config artifacts + any recovery breadcrumb so the next
# install takes the FRESH path (install refuses to regenerate secrets if a volume
# survives without .env, which teardown_deployment already removed).
reset_config() {
	rm -f "$ENV_FILE" "$COMPOSE_FILE" "$CFG_DIR/install-state" "$JOURNAL" 2>/dev/null || true
}

# fresh_deploy TAG — full reset then a fresh install at TAG, waited healthy.
fresh_deploy() {
	local tag="$1"
	teardown_deployment
	reset_config
	info "installing fresh deployment at $tag"
	"$MATHION_BIN" install --yes --domain "$ITEST_DOMAIN" --admin-email "$ITEST_ADMIN_EMAIL" --version "$tag" ||
		fail "fresh_deploy: install at $tag failed"
	wait_healthy || fail "fresh_deploy: app not healthy after install at $tag"
}

# --------------------------------------------------------------------------------
# Sabotage supply (legs 3/4) — see the ghcr.io HARD CONSTRAINT header block.
# --------------------------------------------------------------------------------
# sabotage_available — 0 when a sabotage image can be supplied to the ghcr pull
# source, else 1 (the caller then SKIPs loudly with the exact missing prerequisite).
sabotage_available() {
	[ -n "${ITEST_SABOTAGE_TAG:-}" ] || return 1
	case "${ITEST_SABOTAGE_MODE:-}" in
	push) [ "${ITEST_ALLOW_GHCR_PUSH:-}" = "1" ] || return 1 ;;
	redirect) : ;;
	*) return 1 ;;
	esac
	return 0
}

# ensure_registry — start a throwaway registry:2 only when redirect-mode targets a
# local registry we own (an external ITEST_REGISTRY is the maintainer's to run).
ensure_registry() {
	case "$ITEST_REGISTRY" in
	localhost:5000 | 127.0.0.1:5000) : ;;
	*) return 0 ;;
	esac
	if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$REGISTRY_NAME"; then return 0; fi
	info "starting throwaway registry $REGISTRY_NAME on $ITEST_REGISTRY"
	docker run -d --name "$REGISTRY_NAME" -p 5000:5000 registry:2 >/dev/null
	REGISTRY_STARTED=1
}

# supply_sabotage — materialize ITEST_SABOTAGE_TAG so update step 4's
# `docker pull ghcr.io/...:<tag>` SUCCEEDS while its FORWARD strict gate FAILS.
# Default content = real v0.1.1 (its /version is a 200 text/html SPA -> strict
# reject). push mode pushes throwaway tags to the REAL ghcr repo; redirect mode
# pushes to ITEST_REGISTRY and relies on the maintainer's ghcr->registry redirect.
supply_sabotage() {
	docker pull "$IMAGE_REPO:$LEGACY_TAG" >/dev/null
	case "$ITEST_SABOTAGE_MODE" in
	push)
		docker tag "$IMAGE_REPO:$LEGACY_TAG" "$IMAGE_REPO:$ITEST_SABOTAGE_TAG"
		docker push "$IMAGE_REPO:$ITEST_SABOTAGE_TAG" >/dev/null
		PUSHED_TAGS+=("$ITEST_SABOTAGE_TAG")
		;;
	redirect)
		ensure_registry
		docker tag "$IMAGE_REPO:$LEGACY_TAG" "$ITEST_REGISTRY/svkucheryavski/mathion:$ITEST_SABOTAGE_TAG"
		docker push "$ITEST_REGISTRY/svkucheryavski/mathion:$ITEST_SABOTAGE_TAG" >/dev/null
		;;
	esac
}

# --------------------------------------------------------------------------------
# Idempotent cleanup — tears down the deployment, the throwaway registry, and any
# sabotage image refs; safe when setup half-failed. Installed as the single EXIT trap.
# --------------------------------------------------------------------------------
cleanup() {
	if [ "$_CLEANED" = "1" ]; then return 0; fi
	_CLEANED=1
	set +e
	info "cleanup: tearing down deployment, registry, and sabotage tags"
	teardown_deployment
	reset_config
	if [ "${REGISTRY_STARTED:-0}" = "1" ]; then docker rm -f "$REGISTRY_NAME" >/dev/null 2>&1; fi
	if [ -n "${ITEST_SABOTAGE_TAG:-}" ]; then
		docker rmi -f "$IMAGE_REPO:$ITEST_SABOTAGE_TAG" >/dev/null 2>&1
		docker rmi -f "$ITEST_REGISTRY/svkucheryavski/mathion:$ITEST_SABOTAGE_TAG" >/dev/null 2>&1
	fi
	if [ "${#PUSHED_TAGS[@]}" -gt 0 ]; then
		note "throwaway sabotage tags were pushed to the REAL ghcr repo and may need manual deletion (gh api): ${PUSHED_TAGS[*]}"
	fi
	return 0
}
trap cleanup EXIT

# --------------------------------------------------------------------------------
# Capability preflight — REQUIRED tools abort the whole run; per-leg optional
# prerequisites are announced (run vs skip), never silently dropped.
# --------------------------------------------------------------------------------
preflight() {
	hr
	info "capability preflight"
	if [ "$(id -u)" != "0" ]; then
		fail "preflight: must run as root (state-changing mathion commands take the flock and require root)"
	fi
	have docker || fail "preflight: docker not found"
	docker info >/dev/null 2>&1 || fail "preflight: docker daemon not reachable"
	docker compose version >/dev/null 2>&1 || fail "preflight: 'docker compose' (v2) not available"
	have "$MATHION_BIN" || fail "preflight: mathion binary not found (set MATHION_BIN=/path/to/mathion)"
	have curl || fail "preflight: curl not found"
	have tar || fail "preflight: tar not found"
	have find || fail "preflight: find not found"
	have mktemp || fail "preflight: mktemp not found"
	if have jq; then
		HAVE_JQ=1
		info "jq: present"
	else
		HAVE_JQ=0
		note "jq: absent — using a sed JSON fallback"
	fi
	info "mathion binary: $(command -v "$MATHION_BIN")"
	info "project=$PROJECT  config=$CFG_DIR  varlib=$VARLIB_DIR  base=$ITEST_BASE_TAG"

	info "--- optional leg availability ---"
	if [ -n "${ITEST_OTHER_TAG:-}" ] && [ "${ITEST_OTHER_TAG:-}" != "$ITEST_BASE_TAG" ]; then
		info "LEG 2 (happy update):            WILL RUN  (ITEST_OTHER_TAG=$ITEST_OTHER_TAG)"
	else
		info "LEG 2 (happy update):            WILL SKIP (no distinct ITEST_OTHER_TAG)"
	fi
	if sabotage_available; then
		info "LEG 3/4 (forced-fail + legacy):  WILL RUN  (sabotage mode=$ITEST_SABOTAGE_MODE tag=$ITEST_SABOTAGE_TAG)"
	else
		info "LEG 3/4 (forced-fail + legacy):  WILL SKIP (no sabotage supply — see header)"
	fi
	if [ "${ITEST_SLOW_MIGRATION:-}" = "1" ] && [ -n "${ITEST_OTHER_TAG:-}" ]; then
		info "LEG 5 (crash-resume):            WILL RUN  (ITEST_SLOW_MIGRATION=1)"
	else
		info "LEG 5 (crash-resume):            WILL SKIP (needs ITEST_SLOW_MIGRATION=1 + ITEST_OTHER_TAG)"
	fi
	info "LEG 1 (round-trip) + LEG 6 (tools/uid): WILL RUN (need only $ITEST_BASE_TAG)"
}

# --------------------------------------------------------------------------------
# LEG 1 — backup -> mutate DB row + add/delete assets -> restore -> assert revert.
# --------------------------------------------------------------------------------
leg1_backup_restore_roundtrip() {
	hr
	info "LEG 1: backup -> mutate -> restore round-trip (base $ITEST_BASE_TAG)"
	fresh_deploy "$ITEST_BASE_TAG"

	# Seed a deterministic DB probe row + one asset file BEFORE the backup, so the
	# backup captures the pre-mutation world.
	run_sql "CREATE TABLE IF NOT EXISTS itest_probe(id int PRIMARY KEY, v text); INSERT INTO itest_probe(id,v) VALUES (1,'orig') ON CONFLICT (id) DO UPDATE SET v=EXCLUDED.v;"
	dc exec -T app sh -c 'printf orig > /data/mathion/assets/itest_keep.txt'

	local bkp
	bkp=$(do_backup) || fail "leg1: backup failed / archive path not parsed"
	info "backup archive: $bkp"

	# Mutate: DB row + add one asset + delete the seeded asset.
	run_sql "UPDATE itest_probe SET v='mutated' WHERE id=1;"
	dc exec -T app sh -c 'printf added > /data/mathion/assets/itest_added.txt'
	dc exec -T app sh -c 'rm -f /data/mathion/assets/itest_keep.txt'

	# Prove the mutation actually took (guards against a no-op restore false pass).
	local got
	got=$(query_sql "SELECT v FROM itest_probe WHERE id=1;") || fail "leg1: pre-restore query failed"
	assert_eq "mutated" "$got" "leg1 pre-restore DB mutation is visible"
	assert_true "leg1 pre-restore added asset is visible" dc exec -T app sh -c 'test -f /data/mathion/assets/itest_added.txt'
	assert_true "leg1 pre-restore seeded asset is deleted" dc exec -T app sh -c 'test ! -f /data/mathion/assets/itest_keep.txt'

	# Restore from the captured archive (--yes before --, then the positional path).
	"$MATHION_BIN" restore --yes -- "$bkp" || fail "leg1: restore failed"
	wait_healthy || fail "leg1: app not healthy after restore"

	# Assert the whole world reverted to the backup.
	got=$(query_sql "SELECT v FROM itest_probe WHERE id=1;") || fail "leg1: post-restore query failed"
	assert_eq "orig" "$got" "leg1 DB row reverted by restore"
	assert_true "leg1 added asset gone after restore" dc exec -T app sh -c 'test ! -f /data/mathion/assets/itest_added.txt'
	local keep
	keep=$(dc exec -T app sh -c 'cat /data/mathion/assets/itest_keep.txt 2>/dev/null' | sed 's/[[:space:]]//g')
	assert_eq "orig" "$keep" "leg1 deleted asset restored by restore"
	assert_version_or_spa "$ITEST_BASE_TAG" "leg1 /version == base after restore"
	assert_file_absent "$JOURNAL" "leg1 breadcrumb cleared after restore"
	pass "LEG 1: backup / mutate / restore round-trip reverted DB + assets + /version"
}

# --------------------------------------------------------------------------------
# LEG 2 — happy update to a second real tag.
# --------------------------------------------------------------------------------
leg2_happy_update() {
	hr
	info "LEG 2: happy update to a second real tag"
	if [ -z "${ITEST_OTHER_TAG:-}" ] || [ "${ITEST_OTHER_TAG:-}" = "$ITEST_BASE_TAG" ]; then
		skip "LEG 2: needs a SECOND real ghcr.io tag whose /version serves {\"version\":<tag>} JSON so the STRICT gate passes (set ITEST_OTHER_TAG to a distinct slice-3+ published tag). None is published yet (this IS slice 3)."
		return 0
	fi
	fresh_deploy "$ITEST_BASE_TAG"
	info "updating $ITEST_BASE_TAG -> $ITEST_OTHER_TAG"
	"$MATHION_BIN" update --version "$ITEST_OTHER_TAG" --yes || fail "leg2: happy update failed"
	wait_healthy || fail "leg2: app not healthy after update"
	local ver
	ver=$(version_field)
	assert_eq "$ITEST_OTHER_TAG" "$ver" "leg2 /version JSON == target after update"
	assert_file_absent "$JOURNAL" "leg2 breadcrumb cleared after clean update"
	pass "LEG 2: happy update to $ITEST_OTHER_TAG (/version == target)"
}

# --------------------------------------------------------------------------------
# LEG 3 — post-backup forced-failure update -> auto-rollback.
# --------------------------------------------------------------------------------
leg3_forced_failure_rollback() {
	hr
	info "LEG 3: post-backup forced-failure update -> auto-rollback"
	if ! sabotage_available; then
		skip "LEG 3: needs a sabotage image at ITEST_SABOTAGE_TAG reachable via the HARDCODED ghcr.io pull source (set ITEST_SABOTAGE_TAG + ITEST_SABOTAGE_MODE=redirect|push; push also needs ITEST_ALLOW_GHCR_PUSH=1 and a prior docker login ghcr.io)."
		return 0
	fi
	fresh_deploy "$ITEST_BASE_TAG"
	supply_sabotage
	info "forcing failed update $ITEST_BASE_TAG -> $ITEST_SABOTAGE_TAG (expect auto-rollback)"
	# WITHOUT --no-rollback: the STRICT gate rejects the sabotage /version post-backup,
	# so the failure handler auto-rolls-back and the command exits 1 (failed-but-recovered),
	# distinct from exit 3 (rollback ALSO failed).
	capture "$MATHION_BIN" update --version "$ITEST_SABOTAGE_TAG" --yes
	assert_eq "1" "$CAP_RC" "leg3 update exits 1 (failed-but-rolled-back, not 3=rollback-also-failed)"
	assert_contains "$CAP_OUT" "rolling back" "leg3 update announces the auto-rollback"
	wait_healthy || fail "leg3: app not healthy after rollback"
	assert_version_or_spa "$ITEST_BASE_TAG" "leg3 /version reverted to old after rollback"
	assert_file_absent "$JOURNAL" "leg3 breadcrumb cleared after successful rollback"
	pass "LEG 3: forced-failure update auto-rolled-back to $ITEST_BASE_TAG; stack healthy; breadcrumb cleared"
}

# --------------------------------------------------------------------------------
# LEG 4 — legacy real-v0.1.1 rollback (non-strict SPA tolerance + image-ID gate).
# --------------------------------------------------------------------------------
leg4_legacy_rollback() {
	hr
	info "LEG 4: legacy real-$LEGACY_TAG rollback (non-strict SPA tolerance + image-ID gate)"
	if ! sabotage_available; then
		skip "LEG 4: needs a slice-3 sabotage tag (ITEST_SABOTAGE_TAG) reachable via the ghcr.io pull source to force the FORWARD strict gate to fail (same supply as LEG 3)."
		return 0
	fi
	# MUST deploy the REAL published v0.1.1 (a mocked 404 does not reproduce its
	# 200 text/html SPA /version).
	fresh_deploy "$LEGACY_TAG"
	supply_sabotage
	info "forcing failed update $LEGACY_TAG -> $ITEST_SABOTAGE_TAG (expect auto-rollback TO $LEGACY_TAG)"
	capture "$MATHION_BIN" update --version "$ITEST_SABOTAGE_TAG" --yes
	assert_eq "1" "$CAP_RC" "leg4 update exits 1 (rolled back to $LEGACY_TAG)"
	wait_healthy || fail "leg4: app not healthy after rollback to $LEGACY_TAG"
	# The ROLLBACK's NON-STRICT gate must ACCEPT v0.1.1's 200 text/html SPA /version
	# (image-ID is the authoritative check; /version is legacy-tolerant on a rollback).
	local code ctype
	code=$(http_code "$VERSION_URL")
	ctype=$(http_ctype "$VERSION_URL")
	assert_eq "200" "$code" "leg4 rollback /version serves 200 (legacy SPA)"
	assert_contains "$ctype" "text/html" "leg4 rollback /version is a text/html SPA"
	assert_file_absent "$JOURNAL" "leg4 breadcrumb cleared after legacy rollback"
	pass "LEG 4: legacy rollback to real $LEGACY_TAG succeeded via the non-strict gate"
}

# --------------------------------------------------------------------------------
# LEG 5 — crash-resume with a live labeled orphan.
# --------------------------------------------------------------------------------
leg5_crash_resume() {
	hr
	info "LEG 5: crash-resume (SIGKILL mid-migrate -> flock-sweep + refuse-with-hint -> restore recovery)"
	if [ "${ITEST_SLOW_MIGRATION:-}" != "1" ] || [ -z "${ITEST_OTHER_TAG:-}" ]; then
		skip "LEG 5: needs a SLOW/second Alembic migration to deterministically SIGKILL mid-migrate (set ITEST_SLOW_MIGRATION=1 and ITEST_OTHER_TAG to an image whose migrate step blocks long enough to interrupt). No slow/second migration exists yet — see the older-schema note in LEG 7."
		return 0
	fi
	fresh_deploy "$ITEST_BASE_TAG"

	# Background an update and SIGKILL the CLI as soon as the LABELED migrate one-off
	# (mathion_migrate_<pid>, io.mathion.worker=1) appears — the crash breadcrumb was
	# written at step 6b, BEFORE migrate, so it survives the kill.
	info "background update $ITEST_BASE_TAG -> $ITEST_OTHER_TAG; will SIGKILL mid-migrate"
	"$MATHION_BIN" update --version "$ITEST_OTHER_TAG" --yes >/dev/null 2>&1 &
	local cli_pid=$!
	local i=0 worker=""
	while [ "$i" -lt 60 ]; do
		worker=$(docker ps -q --filter "label=io.mathion.worker=1" --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
		if [ -n "$worker" ]; then break; fi
		if ! kill -0 "$cli_pid" 2>/dev/null; then break; fi
		i=$((i + 1))
		sleep 0.5
	done
	[ -n "$worker" ] || fail "leg5: migrate worker never appeared before the update finished (need a slower migration)"
	kill -9 "$cli_pid" 2>/dev/null || true
	wait "$cli_pid" 2>/dev/null || true

	assert_file_present "$JOURNAL" "leg5 recovery breadcrumb survived the SIGKILL"

	# `mathion start` preamble: flock -> SweepWorkers -> entry-check. It sweeps the
	# labeled orphan AFTER taking the flock, then REFUSES on the breadcrumb (never
	# boots the old image on the forward schema, never auto-restores).
	capture "$MATHION_BIN" start
	assert_true "leg5 start refuses on the leftover breadcrumb" test "$CAP_RC" -ne 0
	assert_contains "$CAP_OUT" "mathion restore --" "leg5 start prints the restore recovery hint"
	local remaining
	remaining=$(docker ps -aq --filter "label=io.mathion.worker=1" --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
	assert_eq "" "$remaining" "leg5 start label-swept the orphan worker after taking the flock"

	# Recovery: restore --latest recovers the just-taken backup and clears the breadcrumb.
	"$MATHION_BIN" restore --latest --yes || fail "leg5: recovery restore failed"
	wait_healthy || fail "leg5: app not healthy after recovery restore"
	assert_file_absent "$JOURNAL" "leg5 breadcrumb cleared by the recovery restore"
	pass "LEG 5: crash-resume swept the orphan, refused with the hint, and restore recovered"
}

# --------------------------------------------------------------------------------
# LEG 6 — tar/find/mktemp present; app runs as the assets-volume owner uid.
# --------------------------------------------------------------------------------
leg6_tool_presence_uid() {
	hr
	info "LEG 6: tar/find/mktemp presence + app runs as the assets-volume owner uid"
	# Host tools (also required in preflight; re-affirmed here as this leg's assertion).
	assert_true "leg6 host has tar" have tar
	assert_true "leg6 host has find" have find
	assert_true "leg6 host has mktemp" have mktemp

	fresh_deploy "$ITEST_BASE_TAG"
	# In-container tools: backup streams `tar` in the app container; restore uses
	# `mktemp` + pg_restore in the db container and tar/find in the app container.
	assert_true "leg6 app container has tar" dc exec -T app sh -c 'command -v tar >/dev/null'
	assert_true "leg6 app container has find" dc exec -T app sh -c 'command -v find >/dev/null'
	assert_true "leg6 app container has mktemp" dc exec -T app sh -c 'command -v mktemp >/dev/null'
	assert_true "leg6 db container has mktemp" dc exec -T db sh -c 'command -v mktemp >/dev/null'

	# The app process runs as the uid that OWNS the assets volume mount — so the
	# backup/restore streams (which run as that uid) can read/write the tree.
	local run_uid owner_uid
	run_uid=$(dc exec -T app sh -c 'id -u' | sed 's/[[:space:]]//g')
	owner_uid=$(dc exec -T app sh -c 'stat -c %u /data/mathion/assets' | sed 's/[[:space:]]//g')
	assert_eq "$owner_uid" "$run_uid" "leg6 app runs as the assets-volume owner uid"
	pass "LEG 6: tools present in host + containers; app runs as the assets-volume owner uid ($run_uid)"
}

# --------------------------------------------------------------------------------
# LEG 7 — explicit NOT-RUNNABLE notes (documentation-only; also in the header).
# --------------------------------------------------------------------------------
leg7_notes() {
	hr
	info "LEG 7: explicit non-runnable notes"
	note "NOT RUNNABLE: 'restore an OLDER-schema backup over a MIGRATED DB' needs a SECOND Alembic migration to exist (only one migration ships today), so there is no older schema to restore over a newer one. Deferred until a 2nd migration lands."
	note "NOT CI-RUNNABLE (manual/opt-in only): legs 2-5 need real ghcr.io images, a Docker host, and root; none of this script is part of \`go test\`."
	skip "LEG 7: documentation-only (older-schema-over-migrated-DB deferred until a 2nd migration; legs 2-5 excluded from CI)"
}

# --------------------------------------------------------------------------------
# Main.
# --------------------------------------------------------------------------------
main() {
	preflight
	leg1_backup_restore_roundtrip
	leg2_happy_update
	leg3_forced_failure_rollback
	leg4_legacy_rollback
	leg5_crash_resume
	leg6_tool_presence_uid
	leg7_notes
	hr
	# Reaching here means no assertion FAILed (a FAIL exits 1 immediately).
	printf '\nINTEGRATION SUMMARY: %d passed, %d skipped, 0 failed\n' "$PASS_COUNT" "$SKIP_COUNT"
	info "all executed legs passed; every skipped leg printed its exact missing prerequisite above."
}

main "$@"
