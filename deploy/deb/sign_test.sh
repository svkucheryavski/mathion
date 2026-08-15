#!/bin/sh
set -eu
GH="$(mktemp -d)"; export GNUPGHOME="$GH"; chmod 700 "$GH"   # split form: `export X="$(cmd)"` trips shellcheck SC2155
# clean up the throwaway homedir + its scoped agent on success AND on any set -e
# failure. single-quoted so $GH expands at trap time; kills are idempotent.
trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$GH"' EXIT
# primary (cert-only) + signing subkey, mirroring the prod S_rel layout. PROTECTED
# with a real passphrase so the sign exercises the prod fd-0 passphrase path — an
# unprotected key would sign regardless of --passphrase-fd and mask a broken config.
PASS="s3cr3t-test-pass"
cat > "$GH/kp" <<P
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Rel Test
Name-Email: rel@example.invalid
Expire-Date: 0
Passphrase: ${PASS}
%commit
P
gpg --batch --gen-key "$GH/kp" >/dev/null 2>&1
PRIMARY="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
SUBKEY="$(gpg --batch --with-colons --fingerprint "$PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; exit}')"
cd "$(dirname "$0")/../../cli"
# flush the passphrase gpg-agent cached during --gen-key, so the sign below is
# FORCED to take the passphrase via signs.stdin -> --passphrase-fd 0 (cold agent,
# matching the prod path). Scoped: GNUPGHOME is exported to $GH, so this only
# kills the throwaway agent, never the user's real one.
gpgconf --kill gpg-agent
# mirror prod exactly: --local-user <subkey>! + the passphrase fed via signs.stdin ->
# gpg's --passphrase-fd 0 (both configured in .goreleaser.yaml, Step 3). skip nfpm
# (this test only needs checksums signing; nfpm inputs are prod-only).
GPG_FINGERPRINT="${SUBKEY}!" GPG_PASSPHRASE="$PASS" \
  CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
  goreleaser release --clean --skip=publish,nfpm --snapshot
test -f dist/checksums.txt.asc || { echo "FAIL: checksums.txt.asc not produced"; exit 1; }
GNUPGHOME="$GNUPGHOME" gpg --batch --verify dist/checksums.txt.asc dist/checksums.txt \
  || { echo "FAIL: .asc does not verify"; exit 1; }
# assert the SUBKEY (not the primary) made the signature — exercises `!` selection
GNUPGHOME="$GNUPGHOME" gpg --batch --status-fd 1 --verify dist/checksums.txt.asc dist/checksums.txt 2>/dev/null \
  | grep -q "^\[GNUPG:\] VALIDSIG ${SUBKEY} " || { echo "FAIL: not signed by the subkey"; exit 1; }
# assert ASCII armor (guards --armor) — spec §6.1
head -1 dist/checksums.txt.asc | grep -q '^-----BEGIN PGP SIGNATURE-----$' \
  || { echo "FAIL: signature is not ASCII-armored"; exit 1; }
# assert SHA-256 digest (guards --digest-algo SHA256; OpenPGP hash algo id 8) — spec §6.1
GNUPGHOME="$GNUPGHOME" gpg --list-packets dist/checksums.txt.asc 2>/dev/null \
  | grep -q 'digest algo 8,' || { echo "FAIL: signature digest is not SHA-256"; exit 1; }
echo "sign_test PASSED"
