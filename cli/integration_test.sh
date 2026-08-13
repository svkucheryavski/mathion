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
#       ITEST_SABOTAGE_MODE=redirect — a daemon-level redirect of
#       ghcr.io/svkucheryavski/mathion -> ITEST_REGISTRY (containerd
#       certs.d/ghcr.io/hosts.toml, or a registry mirror). This script pushes the
#       sabotage image to the THROWAWAY ITEST_REGISTRY and relies on your redirect so
#       the CLI's `docker pull ghcr.io/...:<tag>` resolves locally.
#     Pushing throwaway tags to the REAL public ghcr repo is deliberately NOT
#     supported: auto-deleting remote package versions from an EXIT trap is hazardous
#     and leaving them would pollute the public repo.
#     Real v0.1.1 is a real published ghcr.io tag and needs NEITHER.
#
# ---------------------------------------------------------------------------------
# ENVIRONMENT (all optional; documented defaults)
# ---------------------------------------------------------------------------------
#   MATHION_BIN            mathion binary to exercise           (default: mathion, from PATH)
#   ITEST_BASE_TAG         base deploy tag for legs 1/2/3/6     (default: v0.1.1)
#   ITEST_OTHER_TAG        a SECOND real ghcr tag for legs 2/5  (default: <unset> -> legs 2/5 SKIP)
#   ITEST_SABOTAGE_TAG     forward-failing tag for legs 3/4     (default: <unset> -> legs 3/4 SKIP)
#   ITEST_SABOTAGE_MODE    redirect (the ONLY supported sabotage-supply path; see above)
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
#   L. lifecycle: version / stop / start / uninstall (retain vs purge).               [runs w/ base tag]
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
#     root, and are excluded from `go test`. Leg 1, the lifecycle leg, and leg 6 also
#     need a Docker host + root (hence the whole script is the manual/opt-in lane).

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
REGISTRY_STARTED=0
_CLEANED=0
CAP_OUT=""
CAP_RC=0
# Image refs THIS run created (registry-path + ghcr sabotage tag); cleanup removes ONLY
# these, and only after a collision refusal proved they did not pre-exist.
OWNED_IMAGE_REFS=()

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

# json_version — reads a /version body on stdin and prints its .version field, or
# NOTHING when the body is not EXACTLY ONE top-level JSON object. jq is MANDATORY
# (asserted in preflight). `-s` slurps the whole stream into an array so trailing bytes
# after a JSON object (`{"version":"v2"}<html>…`, `{...}\n<html>`, two objects) make the
# slurp either error or have length!=1 -> empty; a streaming `.version` would instead
# print "v2" for the leading object and only then error, which `|| true` would keep.
json_version() { jq -esr 'if (length==1 and (.[0]|type)=="object") then (.[0].version // empty) else empty end'; }

# version_field — the running app's /version value, or EMPTY when /version is not a
# JSON object (transport error, non-JSON SPA, or a 404). Never fails the caller.
version_field() {
	local body
	body=$(curl -sS --max-time 5 "$VERSION_URL" 2>/dev/null || true)
	printf '%s' "$body" | json_version 2>/dev/null || true
}
# app_healthy_once — single-shot /health check (no retry); 0 iff the app serves ok.
app_healthy_once() { curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; }

# volume_exists NAME — 0 iff a docker volume named exactly NAME exists.
volume_exists() { docker volume ls --format '{{.Name}}' 2>/dev/null | grep -qx "$1"; }

# image_presence REF — prints present|absent|error. `error` (the docker query itself
# failed) is distinct from `absent` so callers can FAIL CLOSED rather than treat a
# transient query failure as "not there" (which would risk clobbering a pre-existing ref).
image_presence() {
	local out
	# Assignment as the `if` condition is errexit-immune on every Bash (a bare
	# `out=$(...); rc=$?` aborts the subshell before `rc=$?` under Bash 4.4+ errexit).
	if out=$(docker image inspect "$1" 2>&1); then
		printf 'present'
		return
	fi
	case "$out" in
	*"No such image"*) printf 'absent' ;;
	*) printf 'error' ;;
	esac
}

# ref_is_owned REF — 0 iff REF was recorded in OWNED_IMAGE_REFS (created by THIS run).
ref_is_owned() {
	local r
	for r in "${OWNED_IMAGE_REFS[@]:-}"; do
		if [ "$r" = "$1" ]; then return 0; fi
	done
	return 1
}

# read_journal_backup_path — prints the recovery breadcrumb's backup_path
# (varlib.Journal JSON field `backup_path`). jq is MANDATORY (asserted in preflight).
read_journal_backup_path() { jq -r '.backup_path // empty' "$JOURNAL" 2>/dev/null; }

# wait_healthy — poll the loopback /health until it reports ok (the CLI already
# --wait's on the container healthcheck; this covers the port-forward settle).
wait_healthy() {
	local i=0
	while [ "$i" -lt 30 ]; do
		if app_healthy_once; then return 0; fi
		i=$((i + 1))
		sleep 1
	done
	return 1
}

# wait_unhealthy — poll until /health is NOT ok (bounded), so a "stopped" assertion
# tolerates the brief teardown settle.
wait_unhealthy() {
	local i=0
	while [ "$i" -lt 15 ]; do
		if ! app_healthy_once; then return 0; fi
		i=$((i + 1))
		sleep 1
	done
	return 1
}

# assert_version_or_spa TAG CONTEXT — the /version contract depends on the tag:
#   * LEGACY_TAG (v0.1.1): /version MUST be the 200 text/html SPA shell and MUST NOT
#     parse as JSON (a JSON body would be wrong for the legacy image).
#   * any other (slice-3+) tag: /version MUST be exact JSON {"version":TAG}. An empty
#     or non-JSON (SPA) result is a FAIL — it means the /version route is broken and is
#     accidentally serving the SPA shell (the very false-pass this guards against).
assert_version_or_spa() {
	local tag="$1" ctx="$2" raw body meta code ctype ver
	# Capture body + status + content-type from ONE request so all three describe the SAME
	# response (three separate curls could race a changing app). The sentinel is appended
	# after the body; /version bodies (JSON or SPA HTML) never contain it.
	# FAIL CLOSED on a curl error (nonzero exit): a truncated transfer (exit 18) or timeout
	# (exit 28) can still leave code=200/ctype=text/html in the -w tail, which would
	# false-pass a broken response if the exit were swallowed.
	if ! raw=$(curl -sS --max-time 5 -w '\n__META__%{http_code} %{content_type}' "$VERSION_URL" 2>/dev/null); then
		fail "$ctx (/version request failed — curl nonzero)"
	fi
	body=${raw%$'\n'__META__*}
	meta=${raw##*__META__}
	code=${meta%% *}
	ctype=${meta#* }
	ver=$(printf '%s' "$body" | json_version 2>/dev/null || true)
	if [ "$tag" = "$LEGACY_TAG" ]; then
		if [ -n "$ver" ]; then
			fail "$ctx (legacy $LEGACY_TAG unexpectedly served JSON /version=[$ver]; expected the text/html SPA shell)"
		fi
		# The body must NOT be valid JSON at all — a `{}` / `{"foo":"bar"}` (empty .version)
		# or a literal `false`/`null` is still JSON, not the legacy SPA shape this certifies.
		# `jq -e 'true'` exits 0 iff the body is ANY valid JSON (independent of its value).
		if printf '%s' "$body" | jq -e 'true' >/dev/null 2>&1; then
			fail "$ctx (legacy /version parsed as valid JSON; expected a non-JSON text/html SPA body)"
		fi
		# POSITIVE SPA proof: an empty (or non-HTML) 200 text/html body is a broken
		# deployment, not the SPA. v0.1.1's /version catch-all serves the built Svelte
		# index.html, which always carries an `<html ...>` tag — a non-brittle marker.
		if ! printf '%s' "$body" | grep -qi '<html'; then
			fail "$ctx (legacy /version body is not an HTML SPA shell — empty or non-HTML 200)"
		fi
		assert_eq "200" "$code" "$ctx (legacy SPA /version status)"
		assert_contains "$ctype" "text/html" "$ctx (legacy SPA /version content-type)"
	else
		if [ -z "$ver" ]; then
			fail "$ctx (expected JSON /version for non-legacy tag $tag, got empty/non-JSON — a broken /version route serving the SPA)"
		fi
		assert_eq "$tag" "$ver" "$ctx (/version JSON)"
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
# Only the redirect supply path is supported (push-to-real-ghcr is intentionally out).
sabotage_available() {
	[ -n "${ITEST_SABOTAGE_TAG:-}" ] || return 1
	[ "${ITEST_SABOTAGE_MODE:-}" = "redirect" ] || return 1
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

# supply_sabotage — materialize ITEST_SABOTAGE_TAG (redirect mode) so update step 4's
# `docker pull ghcr.io/...:<tag>` SUCCEEDS while its FORWARD strict gate FAILS. Content
# = real v0.1.1 (its /version is a 200 text/html SPA -> strict reject); pushed to the
# throwaway ITEST_REGISTRY, resolved by the maintainer's ghcr->registry redirect.
#
# Data-safety: REFUSE up front if either sabotage ref already exists, so cleanup can
# never delete a pre-existing image the operator cares about; then record each ref as
# owned IMMEDIATELY after it is created (before push), so a mid-way failure still lets
# cleanup remove exactly what this run made.
supply_sabotage() {
	local reg_ref="$ITEST_REGISTRY/svkucheryavski/mathion:$ITEST_SABOTAGE_TAG"
	local ghcr_ref="$IMAGE_REPO:$ITEST_SABOTAGE_TAG"
	# IDEMPOTENT: legs 3 and 4 both call this in one run, and the refs live until the EXIT
	# cleanup. If a prior leg already supplied them (recorded as run-owned), reuse and return
	# — do NOT re-run the collision check (which would see this run's own reg_ref and abort).
	if ref_is_owned "$reg_ref"; then return 0; fi
	# First supply of this run: FAIL CLOSED on collision or on a docker query error, so
	# cleanup can never delete a ref this run did not create.
	local r
	for r in "$reg_ref" "$ghcr_ref"; do
		case "$(image_presence "$r")" in
		present) fail "supply_sabotage: sabotage ref $r already exists and was NOT created by this run; choose a fresh ITEST_SABOTAGE_TAG so cleanup never deletes a pre-existing image" ;;
		error) fail "supply_sabotage: docker could not be queried for $r (failing closed rather than risk clobbering a pre-existing ref)" ;;
		absent) : ;;
		esac
	done
	docker pull "$IMAGE_REPO:$LEGACY_TAG" >/dev/null
	ensure_registry
	docker tag "$IMAGE_REPO:$LEGACY_TAG" "$reg_ref"
	OWNED_IMAGE_REFS+=("$reg_ref") # owned the instant it is created, before push
	docker push "$reg_ref" >/dev/null
	# The leg's redirected `update` pull materializes ghcr_ref locally; the collision
	# refusal above proved it did not pre-exist, so this run unambiguously owns it too.
	OWNED_IMAGE_REFS+=("$ghcr_ref")
}

# --------------------------------------------------------------------------------
# Idempotent cleanup — tears down the deployment + the throwaway registry, removes
# ONLY the sabotage image refs THIS run created, and VERIFIES teardown (warning loudly
# on any residue). Safe when setup half-failed. Installed as the single EXIT trap.
# --------------------------------------------------------------------------------
cleanup() {
	if [ "$_CLEANED" = "1" ]; then return 0; fi
	_CLEANED=1
	set +e
	info "cleanup: tearing down deployment, registry, and run-created sabotage refs"
	teardown_deployment
	reset_config
	# Remove ONLY the refs THIS run recorded as created (never a pre-existing ref).
	local ref
	if [ "${#OWNED_IMAGE_REFS[@]}" -gt 0 ]; then
		for ref in "${OWNED_IMAGE_REFS[@]}"; do
			docker rmi -f "$ref" >/dev/null 2>&1
		done
	fi
	if [ "${REGISTRY_STARTED:-0}" = "1" ]; then docker rm -f "$REGISTRY_NAME" >/dev/null 2>&1; fi

	# VERIFY every resource we claim to have removed is actually gone; WARN LOUDLY (stderr)
	# on residue OR on a verify query that itself fails, instead of silently swallowing.
	if [ "${#OWNED_IMAGE_REFS[@]}" -gt 0 ]; then
		for ref in "${OWNED_IMAGE_REFS[@]}"; do
			case "$(image_presence "$ref")" in
			present) note "cleanup: run-created image ref still present (manual removal needed): $ref" ;;
			error) note "cleanup: could not verify removal of image ref (verify manually): $ref" ;;
			esac
		done
	fi
	if [ "${REGISTRY_STARTED:-0}" = "1" ]; then
		local reg_names
		if ! reg_names=$(docker ps -a --format '{{.Names}}' 2>/dev/null); then
			note "cleanup: could not verify removal of the throwaway registry container (verify manually): $REGISTRY_NAME"
		elif printf '%s\n' "$reg_names" | grep -qx "$REGISTRY_NAME"; then
			note "cleanup: throwaway registry container still present (manual removal needed): $REGISTRY_NAME"
		fi
	fi
	local resid_c resid_v
	if ! resid_c=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null); then
		note "cleanup: could not query residual $PROJECT containers (verify + remove manually)"
	elif [ -n "$resid_c" ]; then
		note "cleanup: residual $PROJECT containers remain (manual removal needed): $resid_c"
	fi
	if ! resid_v=$(docker volume ls --format '{{.Name}}' 2>/dev/null); then
		note "cleanup: could not query residual $PROJECT volumes (verify + remove manually)"
	else
		resid_v=$(printf '%s\n' "$resid_v" | grep -E "^${PROJECT}_(mathion_pgdata|mathion_assets)$")
		if [ -n "$resid_v" ]; then note "cleanup: residual $PROJECT volumes remain (manual removal needed): $resid_v"; fi
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
	# jq is REQUIRED: the /version JSON-vs-SPA oracle and the journal parse must be strict
	# (a sed/substring heuristic false-passes a broken route), so there is no fallback.
	have jq || fail "preflight: jq not found (required for strict JSON /version + journal parsing)"
	info "jq: present"
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
	info "LEG 1 (round-trip) + LIFECYCLE (version/stop/start/uninstall) + LEG 6 (tools/uid): WILL RUN (need only $ITEST_BASE_TAG)"
}

# --------------------------------------------------------------------------------
# LEG 1 — backup -> mutate DB row + add/delete assets -> restore -> assert revert.
# --------------------------------------------------------------------------------
leg1_backup_restore_roundtrip() {
	hr
	info "LEG 1: backup -> mutate -> restore round-trip (base $ITEST_BASE_TAG)"
	fresh_deploy "$ITEST_BASE_TAG"

	# Seed a deterministic DB probe row + one asset file BEFORE the backup, so the
	# backup captures the pre-mutation world. Each SETUP command is `|| fail`-guarded so
	# a failure yields an attributable FAIL line, not a bare set -e abort.
	run_sql "CREATE TABLE IF NOT EXISTS itest_probe(id int PRIMARY KEY, v text); INSERT INTO itest_probe(id,v) VALUES (1,'orig') ON CONFLICT (id) DO UPDATE SET v=EXCLUDED.v;" ||
		fail "leg1: seeding itest_probe row failed"
	dc exec -T app sh -c 'printf orig > /data/mathion/assets/itest_keep.txt' ||
		fail "leg1: seeding itest_keep.txt asset failed"

	local bkp
	bkp=$(do_backup) || fail "leg1: backup failed / archive path not parsed"
	info "backup archive: $bkp"

	# Mutate: DB row + add one asset + delete the seeded asset.
	run_sql "UPDATE itest_probe SET v='mutated' WHERE id=1;" || fail "leg1: mutating itest_probe row failed"
	dc exec -T app sh -c 'printf added > /data/mathion/assets/itest_added.txt' || fail "leg1: adding itest_added.txt failed"
	dc exec -T app sh -c 'rm -f /data/mathion/assets/itest_keep.txt' || fail "leg1: deleting itest_keep.txt failed"

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
	keep=$(dc exec -T app sh -c 'cat /data/mathion/assets/itest_keep.txt 2>/dev/null' | sed 's/[[:space:]]//g') ||
		fail "leg1: could not read restored asset itest_keep.txt (restore did not bring it back?)"
	assert_eq "orig" "$keep" "leg1 deleted asset restored by restore"
	assert_version_or_spa "$ITEST_BASE_TAG" "leg1 /version == base after restore"
	assert_file_absent "$JOURNAL" "leg1 breadcrumb cleared after restore"
	pass "LEG 1: backup / mutate / restore round-trip reverted DB + assets + /version"
}

# --------------------------------------------------------------------------------
# LIFECYCLE — version / stop / start / uninstall (retain vs purge). Self-contained
# (own fresh_deploy + own teardown) so it does not disturb other legs; runs by default
# since ITEST_BASE_TAG defaults to the real published v0.1.1.
# --------------------------------------------------------------------------------
leg_lifecycle_commands() {
	hr
	info "LIFECYCLE: version / stop / start / uninstall (retain vs purge)"
	fresh_deploy "$ITEST_BASE_TAG"

	# version: output names the PINNED image version on the EXACT shipped line
	# (version.go prints "image (pinned)  <MATHION_VERSION>" with TWO spaces). Matching the
	# bare tag would also match the "mathion <buildVersion>" CLI line and false-pass a
	# broken/missing image(pinned) read.
	local vout
	vout=$("$MATHION_BIN" version 2>&1) || fail "lifecycle: mathion version failed"
	# EXACT line match (grep -Fxq): a substring match on "image (pinned)  v0.1.1" would also
	# match "image (pinned)  v0.1.10"; a whole-line match cannot.
	printf '%s\n' "$vout" | grep -Fxq "image (pinned)  $ITEST_BASE_TAG" ||
		fail "lifecycle: version output lacks the exact pinned line 'image (pinned)  $ITEST_BASE_TAG'"

	# stop: the app goes DOWN while the named volumes are RETAINED (stop != purge).
	"$MATHION_BIN" stop || fail "lifecycle: mathion stop failed"
	wait_unhealthy || fail "lifecycle: app still healthy after stop"
	assert_true "lifecycle pgdata volume retained after stop" volume_exists "$PGDATA_VOL"
	assert_true "lifecycle assets volume retained after stop" volume_exists "$ASSETS_VOL"

	# start: the app comes back HEALTHY.
	"$MATHION_BIN" start || fail "lifecycle: mathion start failed"
	wait_healthy || fail "lifecycle: app not healthy after start"

	# uninstall (non-purge): containers/network removed, BOTH named volumes RETAINED.
	"$MATHION_BIN" uninstall || fail "lifecycle: mathion uninstall (non-purge) failed"
	local remain
	remain=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null) ||
		fail "lifecycle: docker ps (post-uninstall containers) query failed"
	assert_eq "" "$remain" "lifecycle non-purge uninstall removed all project containers"
	assert_true "lifecycle pgdata volume retained after non-purge uninstall" volume_exists "$PGDATA_VOL"
	assert_true "lifecycle assets volume retained after non-purge uninstall" volume_exists "$ASSETS_VOL"

	# uninstall --purge (typed project name piped to confirm): BOTH named volumes REMOVED.
	printf '%s\n' "$PROJECT" | "$MATHION_BIN" uninstall --purge || fail "lifecycle: mathion uninstall --purge failed"
	if volume_exists "$PGDATA_VOL"; then fail "lifecycle: purge did not remove $PGDATA_VOL"; fi
	if volume_exists "$ASSETS_VOL"; then fail "lifecycle: purge did not remove $ASSETS_VOL"; fi

	# Self-contained teardown so later legs start from a clean slate.
	teardown_deployment
	reset_config
	pass "LIFECYCLE: version/stop/start ok; non-purge RETAINED volumes; purge REMOVED them"
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
		skip "LEG 3: needs a sabotage image at ITEST_SABOTAGE_TAG reachable via the HARDCODED ghcr.io pull source (set ITEST_SABOTAGE_TAG + ITEST_SABOTAGE_MODE=redirect, plus a daemon-level ghcr.io->ITEST_REGISTRY redirect). The sabotage tag must differ from both the deployed tag and v0.1.1."
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
	# Proves a POST-backup failure that actually auto-rolled-back — NOT a pre-backup
	# step-4 pull abort (e.g. a misconfigured redirect) that also exits 1 with no journal.
	assert_contains "$CAP_OUT" "rolling back" "leg4 update announces the auto-rollback (post-backup failure, not a pre-backup pull abort)"
	wait_healthy || fail "leg4: app not healthy after rollback to $LEGACY_TAG"
	# The ROLLBACK's NON-STRICT gate must ACCEPT v0.1.1's 200 text/html SPA /version
	# (image-ID is the authoritative check; /version is legacy-tolerant on a rollback).
	# Reuse the strengthened legacy oracle: guarded curl + ver-empty + not-JSON + nonempty
	# `<html` body + 200 + text/html — a blank/broken 200 rollback can no longer pass.
	assert_version_or_spa "$LEGACY_TAG" "leg4 rollback /version"
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
	# The --rm migrate child can self-remove between detection and start, which would
	# make the post-start "no workers remain" check vacuously credit the sweep. Prove the
	# LABELED orphan is STILL PRESENT here, BEFORE start, so the sweep has real work to do.
	local survived
	survived=$(docker ps -aq --filter "label=io.mathion.worker=1" --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
	[ -n "$survived" ] || fail "leg5: the labeled migrate orphan did not survive the SIGKILL (need a slower migration so it is still present at start)"

	# Read the recorded recovery path from the breadcrumb BEFORE recovery, so we recover
	# the EXACT backup the hint names (not whatever --latest would pick from the dir).
	local bp
	bp=$(read_journal_backup_path) || fail "leg5: cannot read backup_path from journal $JOURNAL"
	[ -n "$bp" ] || fail "leg5: journal $JOURNAL has no backup_path"

	# `mathion start` preamble: flock -> SweepWorkers -> entry-check. It sweeps the
	# labeled orphan AFTER taking the flock, then REFUSES on the breadcrumb (never
	# boots the old image on the forward schema, never auto-restores).
	capture "$MATHION_BIN" start
	assert_true "leg5 start refuses on the leftover breadcrumb" test "$CAP_RC" -ne 0
	assert_contains "$CAP_OUT" "mathion restore --" "leg5 start prints the restore recovery hint"
	assert_contains "$CAP_OUT" "$bp" "leg5 refuse hint names the recorded backup ($bp)"
	# start must REFUSE, not boot the app on the forward schema. Fail-closed: assert NO
	# RUNNING app service container exists (the app container exists but is STOPPED from
	# update step 5, so a running one means start booted it). This is stronger than a mere
	# health check — a regression that boots the app but leaves it "starting"/unhealthy
	# would slip an app_healthy_once check yet is caught here.
	local running_app
	running_app=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=app" 2>/dev/null) ||
		fail "leg5: docker ps (running app) query failed"
	[ -z "$running_app" ] || fail "leg5: start booted the app (a running app container is present) instead of refusing on the breadcrumb"
	# The labeled orphan must be gone (swept after the flock). Fail-closed on a query error
	# so a transient docker failure cannot masquerade as an empty (swept) result.
	local remaining
	remaining=$(docker ps -aq --filter "label=io.mathion.worker=1" --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null) ||
		fail "leg5: docker ps (worker sweep check) query failed"
	assert_eq "" "$remaining" "leg5 start label-swept the orphan worker after taking the flock"

	# Recovery: restore the EXACT recorded backup, which recovers the deployment and
	# clears the breadcrumb.
	"$MATHION_BIN" restore --yes -- "$bp" || fail "leg5: recovery restore of $bp failed"
	wait_healthy || fail "leg5: app not healthy after recovery restore"
	assert_file_absent "$JOURNAL" "leg5 breadcrumb cleared by the recovery restore"
	pass "LEG 5: orphan survived the crash, start swept it + refused with the recorded-path hint, restore recovered"
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
	run_uid=$(dc exec -T app sh -c 'id -u' | sed 's/[[:space:]]//g') || fail "leg6: could not read app container uid"
	owner_uid=$(dc exec -T app sh -c 'stat -c %u /data/mathion/assets' | sed 's/[[:space:]]//g') ||
		fail "leg6: could not stat the assets-volume owner uid"
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
	note "NOT CI-RUNNABLE (manual/opt-in only): legs 2-5 need real ghcr.io images, a Docker host, and root; the default legs (1, lifecycle, 6) need a Docker host + root; none of this script is part of \`go test\`."
	skip "LEG 7: documentation-only (older-schema-over-migrated-DB deferred until a 2nd migration; legs 2-5 excluded from CI)"
}

# --------------------------------------------------------------------------------
# Main.
# --------------------------------------------------------------------------------
main() {
	preflight
	leg1_backup_restore_roundtrip
	leg_lifecycle_commands
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
