#!/bin/sh
# release-embedded-key-guard.sh — go-live authenticity guard for the release channel.
#
# Fails the release if deploy/install.sh's EMBEDDED signing key or its pins are not
# self-consistent with the shipped public keyring, so a misconfigured go-live can
# never sign a release whose installer would then trust a key it did not ship.
#
# Checks:
#   (1) install.sh's mathion_embedded_key() output BYTE-equals
#       deploy/keys/mathion-pubkey.asc, and cli/internal/selfupdate/mathion-pubkey.asc
#       (the copy the self-update binary embeds) is byte-identical to it;
#   (2) that keyring imports to EXACTLY the pinned primary (EXPECTED_PRIMARY_FPR)
#       plus EXACTLY one signing subkey == EXPECTED_SIGNING_FPR (the S_rel pin).
#
# The import runs in an ISOLATED temp GNUPGHOME (never the runner's default keyring;
# robust against a local use-keyboxd config that ignores --no-default-keyring).
#
# Pre-keygen the pins are still the REPLACE_WITH placeholder and the keyring is a
# non-parseable stub, so the guard SKIPS — mirroring selfupdate-ci-guards.sh's
# fpr-pin gate, so this stays green until the maintainer completes go-live.
set -eu
cd "$(dirname "$0")/../.."   # cli/scripts -> repo root

INSTALL_SH="deploy/install.sh"
KEYRING="deploy/keys/mathion-pubkey.asc"
CLI_COPY="cli/internal/selfupdate/mathion-pubkey.asc"

# Load install.sh in library mode: defines the pins + mathion_embedded_key and, via
# its sourcing guard, does NOT run main. Same contract deploy/install_sh_test.sh uses.
# shellcheck disable=SC1090  # sourced path is resolved at runtime (post-cd), not statically
MATHION_INSTALL_LIB=1 . "./$INSTALL_SH"

# Pre-keygen SKIP — ONLY when BOTH pins are still the REPLACE_WITH_* placeholders. A
# HALF-filled go-live (one real/garbage pin + one placeholder) instead falls through
# and is ENFORCED, so it FAILS on the placeholder-vs-keyring mismatch, never skips.
is_placeholder() { case "$1" in REPLACE_WITH*) return 0 ;; *) return 1 ;; esac; }
if is_placeholder "${EXPECTED_PRIMARY_FPR:-}" && is_placeholder "${EXPECTED_SIGNING_FPR:-}"; then
  echo "SKIP embedded-key guard: both pins are pre-keygen placeholders (no real fingerprint set)"
  exit 0
fi

command -v gpg >/dev/null 2>&1 || { echo "FAIL: gpg is required for the embedded-key guard" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

# (1) install.sh embedded key == shipped keyring == cli/internal/selfupdate copy.
mathion_embedded_key > "$work/embedded.asc"
cmp -s "$work/embedded.asc" "$KEYRING" \
  || { echo "FAIL: install.sh embedded key != $KEYRING" >&2; fail=1; }
cmp -s "$KEYRING" "$CLI_COPY" \
  || { echo "FAIL: $CLI_COPY != $KEYRING (self-update embedded copy drifted)" >&2; fail=1; }

# (2) Import into an ISOLATED temp GNUPGHOME, assert exactly the pinned primary +
#     one signing subkey == EXPECTED_SIGNING_FPR.
GNUPGHOME="$work/gnupg"; export GNUPGHOME
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
gpg --batch --quiet --import "$KEYRING" 2>/dev/null \
  || { echo "FAIL: $KEYRING is not a parseable OpenPGP keyring" >&2; exit 1; }

nprim="$(gpg --with-colons --list-keys | awk -F: '$1=="pub"{n++} END{print n+0}')"
[ "$nprim" = 1 ] || { echo "FAIL: keyring must hold exactly one primary key, found $nprim" >&2; fail=1; }

prim="$(gpg --with-colons --list-keys | awk -F: '$1=="fpr"{print $10; exit}')"
[ "$prim" = "$EXPECTED_PRIMARY_FPR" ] \
  || { echo "FAIL: keyring primary $prim != EXPECTED_PRIMARY_FPR $EXPECTED_PRIMARY_FPR" >&2; fail=1; }

# Exactly one SIGNING subkey (colon field 12 contains 's'), equal to the S_rel pin.
# --with-subkey-fingerprint is required for subkey fpr records in colon mode on
# GnuPG < 2.6; the awk clears `want` on every sub line so a following non-signing
# subkey cannot inherit it.
sigfprs="$(gpg --with-colons --with-fingerprint --with-subkey-fingerprint --list-keys \
  | awk -F: '$1=="sub"{want=($12 ~ /s/); next} $1=="fpr" && want {print $10; want=0}')"
cnt="$(printf '%s\n' "$sigfprs" | grep -c . || true)"
[ "$cnt" = 1 ] || { echo "FAIL: keyring must hold exactly one signing subkey, found $cnt" >&2; fail=1; }
[ "$sigfprs" = "$EXPECTED_SIGNING_FPR" ] \
  || { echo "FAIL: embedded signing subkey $sigfprs != EXPECTED_SIGNING_FPR $EXPECTED_SIGNING_FPR" >&2; fail=1; }

# (3) Cross-check: the key the INSTALLER trusts must equal the key the release is
# SIGNED with. install.sh's verify_sig requires a VALIDSIG from EXPECTED_SIGNING_FPR,
# while goreleaser signs with GPG_FINGERPRINT=vars.S_REL_FPR (passed here as
# $S_REL_FPR); per deploy/keys/README.md §5 those two "move as a unit". Without this a
# release could be signed by a key the shipped installer rejects — a broken PUBLIC
# release. Enforced whenever the signer fpr is provided (CI/release always set it); a
# bare local run without it notes the skip.
if [ -n "${S_REL_FPR:-}" ]; then
  want_sign="$(printf '%s' "$S_REL_FPR" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
  have_sign="$(printf '%s' "$EXPECTED_SIGNING_FPR" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
  [ "$have_sign" = "$want_sign" ] \
    || { echo "FAIL: EXPECTED_SIGNING_FPR $have_sign != release signer S_REL_FPR $want_sign (installer would reject its own release)" >&2; fail=1; }
else
  echo "NOTE: S_REL_FPR not provided — skipping installer-vs-signer cross-check (CI sets it)"
fi

[ "$fail" = 0 ] || { echo "embedded-key guard FAILED" >&2; exit 1; }
echo "embedded-key guard OK: primary $prim, S_rel $sigfprs (install.sh == keyring == cli copy)"
