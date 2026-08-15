#!/bin/sh
set -eu
# Build local artifacts (mirrors release-cli.yml). Resolve the repo root ONCE,
# up front, as an absolute path — BEFORE any cd — so a relative $0 (the form
# release-cli.yml uses: `sh deploy/install_sh_test.sh`) still resolves after we
# cd into cli/ (and later dist/) below.
# shellcheck disable=SC1007  # CDPATH= is a deliberate one-command env prefix (empty CDPATH), not a typo
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR/cli"
CLI_TAG=cli-v0.0.0-test APP_IMAGE=v0.1.1 GORELEASER_CURRENT_TAG=v0.0.0-test \
  goreleaser release --clean --skip=publish,sign,nfpm --snapshot
test -f dist/mathion_linux_amd64.tar.gz || { echo "FAIL: amd64 archive missing"; exit 1; }
test -f dist/mathion_linux_arm64.tar.gz || { echo "FAIL: arm64 archive missing"; exit 1; }
test -f dist/checksums.txt || { echo "FAIL: checksums.txt missing (name_template not pinned)"; exit 1; }

# The installer's exact checksum verification, mirrored here so we can assert BOTH
# that a valid checksums.txt verifies AND that a host-line-missing one fail-closes
# — independent of any `sha256sum -c` empty/malformed-input leniency.
verify() { # $1 = checksums file (relative to cwd), $2 = asset present in cwd
  w="$(grep " ${2}\$" "$1" | awk '{print $1}')"
  [ -n "$w" ] || return 1
  g="$(sha256sum "$2" | awk '{print $1}')"
  [ "$w" = "$g" ]
}

case "$(uname -m)" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) echo "SKIP unknown arch"; exit 0;; esac
ASSET="mathion_linux_${A}.tar.gz"
cd dist
# positive: the real checksums.txt verifies for the host arch
verify checksums.txt "$ASSET" || { echo "FAIL: valid checksum did not verify"; exit 1; }
# negative: strip the host asset line -> verification MUST fail-close (non-zero)
grep -v " ${ASSET}\$" checksums.txt > checksums.nohost.txt || true
if verify checksums.nohost.txt "$ASSET"; then
  rm -f checksums.nohost.txt
  echo "FAIL: missing checksum line did NOT fail-close"; exit 1
fi
rm -f checksums.nohost.txt
cd ..

# ---- authenticity: drive install.sh's REAL verify_sig with a throwaway key ----
command -v gpg >/dev/null 2>&1 || { echo "SKIP: gpg not present"; exit 0; }
TKH="$(mktemp -d)"; export GNUPGHOME="$TKH"; chmod 700 "$TKH"
# throwaway: primary (cert-only) + sub_rel (the pinned channel); sub_apt added below.
cat > "$TKH/kp" <<'PARAMS'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Test Primary
Name-Email: test@example.invalid
Expire-Date: 0
%commit
PARAMS
gpg --batch --gen-key "$TKH/kp" >/dev/null 2>&1
PRIMARY="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
# sub_apt (wrong channel) — quick-add-key needs loopback+empty-passphrase to run non-interactively
gpg --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$PRIMARY" ed25519 sign 0 >/dev/null 2>&1
SUBS="$(gpg --batch --with-colons --fingerprint "$PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; s=0}')"
SUB_REL="$(printf '%s\n' "$SUBS" | sed -n 1p)"
SUB_APT="$(printf '%s\n' "$SUBS" | sed -n 2p)"
printf 'checksum-content\n' > "$TKH/checksums.txt"
sign_with() { gpg --batch --yes --armor --local-user "${1}!" --detach-sign -o "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; }

# Source install.sh (guard stops main), then aim its embedded key + pins at the throwaway.
MATHION_INSTALL_LIB=1 . "$ROOT_DIR/deploy/install.sh"
mathion_embedded_key() { gpg --batch --export --armor "$PRIMARY"; }
EXPECTED_SIGNING_FPR="$SUB_REL"; EXPECTED_PRIMARY_FPR="$PRIMARY"

# 1) good signature from the pinned subkey -> accepted
sign_with "$SUB_REL"
verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt" || { echo "FAIL: good S_rel signature rejected"; exit 1; }
# 2) tampered signed file -> rejected
printf 'tampered\n' >> "$TKH/checksums.txt"
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: tampered file accepted"; exit 1; fi
printf 'checksum-content\n' > "$TKH/checksums.txt"
# 3) signed by the OTHER subkey (simulates an S_apt-signed forge) -> rejected (channel separation)
sign_with "$SUB_APT"
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: wrong-channel (S_apt) signature accepted"; exit 1; fi
# 4) EXPIRED pinned key -> rejected (EXPKEYSIG, no GOODSIG). A single pinned subkey can't
#    be both valid (cases 1-3) and expired, so build a SEPARATE throwaway whose primary +
#    sub_rel were created in the PAST with a short expiry, sign while it was valid (faked
#    past time), then verify NOW (expired). Re-point the embedded key + pins at it, then restore.
EXH="$(mktemp -d)"; PAST=20200101T000000
cat > "$EXH/kp" <<'EP'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Name-Real: Mathion Expired Test
Name-Email: exp@example.invalid
Expire-Date: 0
%commit
EP
GNUPGHOME="$EXH" gpg --faked-system-time "$PAST" --batch --gen-key "$EXH/kp" >/dev/null 2>&1
EXP_PRIMARY="$(GNUPGHOME="$EXH" gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
GNUPGHOME="$EXH" gpg --faked-system-time "$PAST" --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$EXP_PRIMARY" ed25519 sign 2d >/dev/null 2>&1
EXP_SUB="$(GNUPGHOME="$EXH" gpg --batch --with-colons --fingerprint "$EXP_PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; exit}')"
GNUPGHOME="$EXH" gpg --faked-system-time "$PAST" --batch --yes --armor --local-user "${EXP_SUB}!" --detach-sign -o "$TKH/checksums.txt.asc" "$TKH/checksums.txt" >/dev/null 2>&1
mathion_embedded_key() { GNUPGHOME="$EXH" gpg --batch --export --armor "$EXP_PRIMARY"; }
EXPECTED_SIGNING_FPR="$EXP_SUB"; EXPECTED_PRIMARY_FPR="$EXP_PRIMARY"
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: expired-key signature accepted"; exit 1; fi
# restore the main throwaway key + pins for the remaining cases
mathion_embedded_key() { gpg --batch --export --armor "$PRIMARY"; }
EXPECTED_SIGNING_FPR="$SUB_REL"; EXPECTED_PRIMARY_FPR="$PRIMARY"
# 5) revoked key -> rejected. gpg auto-writes a revocation cert at key gen, but
#    colon-guards its armor ("Remove this colon before importing") — strip it.
sign_with "$SUB_REL"
sed 's/^://' "$TKH/openpgp-revocs.d/${PRIMARY}.rev" | gpg --batch --yes --import >/dev/null 2>&1
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: revoked-key signature accepted"; exit 1; fi
# 6) gpg absent -> fail closed. SC2123: emptying PATH is the deliberate mechanism to
#    simulate "no gpg on PATH" inside the subshell — not an accidental clobber.
# shellcheck disable=SC2123
if ( PATH=""; verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt" ) 2>/dev/null; then
  echo "FAIL: verify_sig did not fail closed without gpg"; exit 1; fi

# ---- greatest-stable resolver (drives install.sh's sourced resolve_latest_stable) ----
TAGS="$(printf '%s\n' cli-v0.2.0 cli-v0.10.0 cli-v0.2.0-rc1 cli-v0.9.0 v0.2.0)"
got="$(resolve_latest_stable "$TAGS")"
[ "$got" = "cli-v0.10.0" ] || { echo "FAIL: resolver picked '$got', want cli-v0.10.0"; exit 1; }
echo "install_sh authenticity+resolver PASSED"

echo "install_sh_test PASSED"
