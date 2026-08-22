#!/bin/sh
# self-update release guards:
#  (1) the release config must NOT carry the mathion_selfupdate_test build tag
#      (it would let an env var redirect a root-executed updater's origin);
#  (2) each built archive must contain EXACTLY the single member "mathion"
#      (the strict single-binary extractor in extractSingleBinary depends on it);
#  (3) the committed keyring's single signing subkey fingerprint must equal the
#      expected S_rel fpr (§6.1 build-time pin) — catches a WRONG single subkey that
#      runtime membership + the load-time single-subkey assertion cannot. Gated on the
#      fpr env being set, so it skips the pre-keygen placeholder (like 4a's fpr pins).
set -eu
cd "$(dirname "$0")/.."   # -> cli/

# (1) no test tag anywhere in the release/build config
if grep -rn 'mathion_selfupdate_test' .goreleaser.yaml ../.github/workflows/release-cli.yml; then
  echo "FAIL: mathion_selfupdate_test tag must never be in the release build" >&2
  exit 1
fi

# (2) build a REAL snapshot and assert single-member archives.
# `goreleaser build` only compiles binaries (it produces NO archives), so the
# archive assertion requires `goreleaser release --snapshot` — which also runs
# nfpm, whose `contents:` inputs (the .gz variants + a placeholder keyring) are
# not in git. Materialize them first, exactly as deploy/deb/deb_test.sh does.
gzip -9nkf ../deploy/man/mathion.1
gzip -9nkf ../deploy/deb/changelog.Debian
gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES
[ -f ../deploy/keys/mathion-archive-keyring.gpg ] || printf 'placeholder' > ../deploy/keys/mathion-archive-keyring.gpg

CLI_TAG=cli-v0.0.0 APP_IMAGE=v0.0.0 GORELEASER_CURRENT_TAG=v0.0.0 \
  goreleaser release --clean --skip=publish,sign --snapshot >/dev/null

# Expected linux archs: mirror cli/.goreleaser.yaml builds[].goarch for goos linux.
# Kept as an explicit list here (not derived) so a DROPPED or ADDED arch in the
# config is caught by the arch-set assertion after the loop.
expected_archs="amd64 arm64"

n=0
seen_archs=""
for a in dist/mathion_linux_*.tar.gz; do
  [ -e "$a" ] || { echo "FAIL: no linux archive produced (glob did not match)" >&2; exit 1; }
  n=$((n + 1))

  # arch from the archive name: mathion_linux_<arch>.tar.gz
  arch="${a##*/mathion_linux_}"; arch="${arch%.tar.gz}"
  seen_archs="$seen_archs $arch"

  # Enforce extractSingleBinary's ACTUAL contract: the archive must hold EXACTLY ONE
  # member, and that member must be a REGULAR file named "mathion". The extractor
  # rejects directories, symlinks, and hardlinks, so a name-only check (which a
  # symlink or a dir+mathion pair would pass) is too weak. `tar -tvzf` prints a
  # verbose long-listing whose first column carries the type char: '-' regular,
  # 'd' dir, 'l' symlink, 'h' hardlink.
  listing="$(tar -tvzf "$a")"
  count="$(printf '%s\n' "$listing" | grep -c .)"
  if [ "$count" != 1 ]; then
    echo "FAIL: $a must contain exactly one member, found $count:" >&2
    printf '%s\n' "$listing" >&2
    exit 1
  fi
  type_char="$(printf '%s\n' "$listing" | cut -c1)"      # column 1: file type
  member="$(printf '%s\n' "$listing" | awk '{print $NF}')" # last field: member name
  if [ "$type_char" != "-" ] || [ "$member" != "mathion" ]; then
    echo "FAIL: $a member must be a regular file named 'mathion' (got type '$type_char', name '$member'):" >&2
    printf '%s\n' "$listing" >&2
    exit 1
  fi
done

# Assert the produced linux archive set is EXACTLY the expected archs — catches a
# dropped arch (missing archive) or an unexpected one (config drift).
norm_seen="$(printf '%s' "$seen_archs" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
norm_expected="$(printf '%s' "$expected_archs" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
if [ "$norm_seen" != "$norm_expected" ]; then
  echo "FAIL: linux archive archs [$norm_seen] != expected [$norm_expected] (see cli/.goreleaser.yaml)" >&2
  exit 1
fi

# (3) fingerprint pin (§6.1). Only enforced once maintainer keys exist: when S_REL_FPR
# (steady) or S_REL_EMBEDDED_FPR (transition — the INCOMING key the asset embeds, which
# during a rotation differs from the outgoing signing key) is set. Pre-keygen the asset
# is a placeholder that cannot be parsed as a keyring, so skip — the go-live caveat.
EXPECT="${S_REL_EMBEDDED_FPR:-${S_REL_FPR:-}}"
if [ -n "$EXPECT" ]; then
  command -v gpg >/dev/null 2>&1 || { echo "FAIL: gpg required for the fingerprint pin" >&2; exit 1; }
  ringdir="$(mktemp -d)"; ring="$ringdir/ring.gpg"
  trap 'rm -rf "$ringdir"' EXIT
  gpg --no-default-keyring --keyring "$ring" --quiet --import ../deploy/keys/mathion-pubkey.asc 2>/dev/null \
    || { echo "FAIL: deploy/keys/mathion-pubkey.asc is not a parseable OpenPGP keyring" >&2; exit 1; }
  prim="$(gpg --no-default-keyring --keyring "$ring" --with-colons --list-keys | awk -F: '$1=="pub"{n++} END{print n+0}')"
  [ "$prim" = 1 ] || { echo "FAIL: keyring must hold exactly one primary key, found $prim" >&2; exit 1; }
  # Pair each signing-capable subkey (colon field 12 contains lowercase 's') with the
  # fpr line that follows it; assert exactly one, equal to EXPECT (uppercase, no spaces).
  # --with-subkey-fingerprint is REQUIRED for subkey fpr records in colon mode on GnuPG
  # < 2.6 (a single --with-fingerprint emits only the PRIMARY's fpr → the pairing would
  # see zero subkey fprs). The awk resets `want` on EVERY sub line so a following
  # non-signing subkey clears it.
  sigfprs="$(gpg --no-default-keyring --keyring "$ring" --with-colons --with-fingerprint --with-subkey-fingerprint --list-keys \
    | awk -F: '$1=="sub"{want=($12 ~ /s/); next} $1=="fpr" && want {print $10; want=0}')"
  cnt="$(printf '%s\n' "$sigfprs" | grep -c . || true)"
  [ "$cnt" = 1 ] || { echo "FAIL: keyring must hold exactly one signing subkey, found $cnt" >&2; exit 1; }
  want="$(printf '%s' "$EXPECT" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"   # normalize: strip spaces, uppercase
  if [ "$sigfprs" != "$want" ]; then
    echo "FAIL: embedded signing-subkey fpr $sigfprs != expected S_rel $want" >&2
    exit 1
  fi
  echo "fingerprint pin OK ($sigfprs)"
else
  echo "SKIP fingerprint pin: neither S_REL_FPR nor S_REL_EMBEDDED_FPR set (pre-keygen placeholder)"
fi

echo "self-update CI guards PASSED ($n binary-only archive(s))"
