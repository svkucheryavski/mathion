#!/bin/sh
# Mathion CLI installer. Resolves the latest cli-v* release (or an explicit
# version arg), verifies the checksum, and installs to /usr/local/bin/mathion.
# Integrity only (checksums.txt), NOT authenticity — signing is Slice 4.
set -eu

REPO="svkucheryavski/mathion"
API="https://api.github.com/repos/${REPO}/releases"
DL="https://github.com/${REPO}/releases/download"
DEST="/usr/local/bin/mathion"

# HTTPS-only, even across redirects — a redirect can never downgrade to http.
dl() { curl -fsSL --proto '=https' --proto-redir '=https' "$@"; }

arch="$(uname -m)"
case "$arch" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac
ASSET="mathion_linux_${ARCH}.tar.gz"

TAG="${1:-}"
if [ -z "$TAG" ]; then
  page=1
  while [ -z "$TAG" ] && [ "$page" -le 10 ]; do
    body="$(dl "${API}?per_page=100&page=${page}")" || break
    TAG="$(printf '%s' "$body" | grep -oE '"tag_name": *"cli-v[^"]*"' | head -1 | sed -E 's/.*"(cli-v[^"]*)".*/\1/')"
    [ -z "$body" ] || [ "$body" = "[]" ] && break
    page=$((page + 1))
  done
fi
[ -n "$TAG" ] || { echo "no cli-v* release found" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> Downloading ${ASSET} from ${TAG}"
dl "${DL}/${TAG}/${ASSET}"        -o "${TMP}/${ASSET}"
dl "${DL}/${TAG}/checksums.txt"   -o "${TMP}/checksums.txt"

# Verify integrity by extracting the exact digest for our asset and comparing it
# to the archive's computed digest. Fail-closed on every shell: a missing asset
# line makes ${want} empty and aborts, without relying on `sha256sum -c` erroring
# on empty/malformed input (which some non-GNU implementations do not do).
echo "==> Verifying checksum"
want="$(grep " ${ASSET}\$" "${TMP}/checksums.txt" | awk '{print $1}')"
[ -n "$want" ] || { echo "no checksum found for ${ASSET}" >&2; exit 1; }
got="$(cd "$TMP" && sha256sum "$ASSET" | awk '{print $1}')"
[ "$want" = "$got" ] || { echo "checksum verification FAILED for ${ASSET}" >&2; exit 1; }

echo "==> Installing to ${DEST}"
tar -xzf "${TMP}/${ASSET}" -C "$TMP" mathion
install -m 0755 "${TMP}/mathion" "$DEST"
echo "==> Installed: $(${DEST} version 2>/dev/null | head -1 || echo mathion)"
