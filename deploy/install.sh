#!/bin/sh
# Mathion CLI installer. Resolves the greatest stable cli-v* release (or an
# explicit version arg), verifies the release SIGNATURE (checksums.txt.asc)
# against the embedded Mathion release key (S_rel), then the checksum, and
# installs to /usr/local/bin/mathion.
set -eu

REPO="svkucheryavski/mathion"
API="https://api.github.com/repos/${REPO}/releases"
DL="https://github.com/${REPO}/releases/download"
DEST="/usr/local/bin/mathion"

# Authenticity (Slice 4a). EXPECTED_SIGNING_FPR pins the S_rel SUBKEY (VALIDSIG's
# first field), so a compromise of the apt-only S_apt cannot forge this channel.
EXPECTED_PRIMARY_FPR="REPLACE_WITH_40_HEX_PRIMARY_FINGERPRINT"
EXPECTED_SIGNING_FPR="REPLACE_WITH_40_HEX_S_REL_SUBKEY_FINGERPRINT"

# HTTPS-only, even across redirects — a redirect can never downgrade to http.
dl() { curl -fsSL --proto '=https' --proto-redir '=https' "$@"; }

# Embedded public key = primary + S_rel ONLY (channel separation). Filled by the
# manual key prereq from deploy/keys/mathion-pubkey.asc. Tests override this.
mathion_embedded_key() {
  cat <<'MATHION_PUBKEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----
REPLACE_WITH_deploy/keys/mathion-pubkey.asc_CONTENTS
-----END PGP PUBLIC KEY BLOCK-----
MATHION_PUBKEY
}

# verify_sig <detached-sig> <signed-file>: 0 iff a GOODSIG made by
# EXPECTED_SIGNING_FPR (primary = EXPECTED_PRIMARY_FPR), no expired/revoked/bad
# status. Fails closed if gpg is absent. Fresh throwaway GNUPGHOME per call.
verify_sig() {
  command -v gpg >/dev/null 2>&1 || { echo "gnupg is required to verify the release signature; install it and retry" >&2; return 1; }
  _vh="$(mktemp -d)"; chmod 700 "$_vh"
  mathion_embedded_key > "${_vh}/key.asc"
  if ! GNUPGHOME="$_vh" gpg --batch --no-tty --import "${_vh}/key.asc" >/dev/null 2>&1; then
    rm -rf "$_vh"; echo "failed to import the embedded signing key" >&2; return 1
  fi
  # Capture gpg's exit code WITHOUT letting set -e abort before cleanup: the
  # assignment's status IS the command substitution's status, so `|| _rc=$?`
  # records gpg's exit while keeping the statement's own status 0. rc==0 is now a
  # REQUIRED gate ALONGSIDE the status policy below (mirrors verify-inrelease.sh):
  # gpg exits 0 for EXPKEYSIG/REVKEYSIG (caught by the status greps), but a
  # NONZERO exit from a malformed/operational failure must fail closed even if a
  # stray GOODSIG is present. Cleanup always runs; the policy greps run only
  # after the rc gate passes (a nonzero rc returns before them).
  _rc=0
  _st="$(GNUPGHOME="$_vh" gpg --batch --no-tty --status-fd 1 --verify "$1" "$2" 2>/dev/null)" || _rc=$?
  rm -rf "$_vh"
  [ "$_rc" = 0 ] || { echo "signature verification FAILED (gpg exit $_rc)" >&2; return 1; }
  printf '%s\n' "$_st" | grep -q '^\[GNUPG:\] GOODSIG' || { echo "signature verification FAILED (no GOODSIG)" >&2; return 1; }
  if printf '%s\n' "$_st" | grep -Eq '^\[GNUPG:\] (EXPKEYSIG|REVKEYSIG|EXPSIG|ERRSIG|BADSIG)'; then
    echo "signature verification FAILED (expired/revoked/bad key)" >&2; return 1
  fi
  printf '%s\n' "$_st" | grep -q "^\[GNUPG:\] VALIDSIG ${EXPECTED_SIGNING_FPR} " || { echo "signature is not from the expected Mathion release key" >&2; return 1; }
  printf '%s\n' "$_st" | grep -q "^\[GNUPG:\] VALIDSIG .* ${EXPECTED_PRIMARY_FPR}\$" || { echo "signature primary key mismatch" >&2; return 1; }
  return 0
}

# resolve_latest_stable <newline-separated tag names> -> greatest STABLE cli-vX.Y.Z.
# Skips prereleases by NAME convention (-rc/-beta suffixes fail the strict pattern);
# release-cli.yml guarantees clean cli-vX.Y.Z tags are never published --prerelease.
resolve_latest_stable() {
  printf '%s\n' "$1" | grep -E '^cli-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}

main() {
  arch="$(uname -m)"
  case "$arch" in
    x86_64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
  esac
  ASSET="mathion_linux_${ARCH}.tar.gz"

  # dual-install warning: an apt-managed copy at /usr/bin is shadowed by this
  # curl|sh install to /usr/local/bin (PATH precedence). Warn, never delete.
  if command -v dpkg >/dev/null 2>&1 && LC_ALL=C dpkg -S /usr/bin/mathion >/dev/null 2>&1; then
    echo "warning: an apt-managed mathion exists at /usr/bin/mathion; this curl|sh install to" >&2
    echo "         ${DEST} will shadow it on PATH. Use one channel only (see README)." >&2
  fi

  TAG="${1:-}"
  if [ -z "$TAG" ]; then
    all=""
    page=1
    while [ "$page" -le 10 ]; do
      body="$(dl "${API}?per_page=100&page=${page}")" || break
      { [ -z "$body" ] || [ "$body" = "[]" ]; } && break
      all="${all}
$(printf '%s' "$body" | grep -oE '"tag_name": *"cli-v[^"]*"' | sed -E 's/.*"(cli-v[^"]*)".*/\1/')"
      # short page (<100 release objects) => no more pages; a full page 10 means
      # the greatest release may lie beyond the cap — fail rather than mislead.
      count="$(printf '%s' "$body" | grep -c '"tag_name":' || true)"
      [ "$count" -lt 100 ] && break
      if [ "$page" -eq 10 ]; then
        echo "release list exceeds the 1000-release pagination cap; pass an explicit cli-vX.Y.Z version" >&2
        exit 1
      fi
      page=$((page + 1))
    done
    # greatest STABLE cli-vX.Y.Z; prereleases are skipped by name convention
    # (-rc/-beta fail the strict pattern) + the release-cli.yml no-prerelease
    # guarantee, NOT by GitHub's prerelease flag (Task 8 workflow guard).
    TAG="$(resolve_latest_stable "$all")"
  fi
  [ -n "$TAG" ] || { echo "no stable cli-v* release found" >&2; exit 1; }

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  # Fetch + verify the SIGNED checksums BEFORE the (large) archive, so an
  # untrusted origin can't make us download an unauthenticated blob first.
  echo "==> Fetching release checksums for ${TAG}"
  dl "${DL}/${TAG}/checksums.txt"     -o "${TMP}/checksums.txt"
  dl "${DL}/${TAG}/checksums.txt.asc" -o "${TMP}/checksums.txt.asc"
  echo "==> Verifying signature"
  verify_sig "${TMP}/checksums.txt.asc" "${TMP}/checksums.txt" || exit 1
  echo "==> Signature OK"

  # exactly one checksum line for our asset, from the now-trusted checksums.txt
  matches="$(grep -c " ${ASSET}\$" "${TMP}/checksums.txt" || true)"
  [ "$matches" = "1" ] || { echo "expected exactly one checksum line for ${ASSET} (got ${matches})" >&2; exit 1; }
  want="$(grep " ${ASSET}\$" "${TMP}/checksums.txt" | awk '{print $1}')"

  echo "==> Downloading ${ASSET}"
  dl "${DL}/${TAG}/${ASSET}" -o "${TMP}/${ASSET}"
  echo "==> Verifying checksum"
  got="$(cd "$TMP" && sha256sum "$ASSET" | awk '{print $1}')"
  [ "$want" = "$got" ] || { echo "checksum verification FAILED for ${ASSET}" >&2; exit 1; }

  echo "==> Installing to ${DEST}"
  tar -xzf "${TMP}/${ASSET}" -C "$TMP" mathion
  install -m 0755 "${TMP}/mathion" "$DEST"
  echo "==> Installed: $(${DEST} version 2>/dev/null | head -1 || echo mathion)"
}

# Sourcing guard: tests set MATHION_INSTALL_LIB=1 to load functions without running.
[ "${MATHION_INSTALL_LIB:-0}" = 1 ] || main "$@"
