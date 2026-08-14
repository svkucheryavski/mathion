#!/bin/sh
set -eu
DIR="$(dirname "$0")"
extract_sha256() { awk '/^SHA256:/{p=1;print;next} p&&/^[ \t]/{print;next} p{exit}' "$1"; }
# mkkey <faketime|""> [expire-days] -> sets MK_HOME MK_PRIMARY MK_SUB (throwaway apt key in its own homedir)
mkkey() {
  _ft="$1"; _exp="${2:-0}"; _kh="$(mktemp -d)"; chmod 700 "$_kh"
  cat > "$_kh/kp" <<P
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Name-Real: Apt Test
Name-Email: apt@example.invalid
Expire-Date: 0
%commit
P
  GNUPGHOME="$_kh" gpg ${_ft:+--faked-system-time "$_ft"} --batch --gen-key "$_kh/kp" >/dev/null 2>&1
  MK_PRIMARY="$(GNUPGHOME="$_kh" gpg --with-colons --fingerprint | awk -F: '/^fpr:/{print $10;exit}')"
  GNUPGHOME="$_kh" gpg ${_ft:+--faked-system-time "$_ft"} --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$MK_PRIMARY" ed25519 sign "${_exp}d" >/dev/null 2>&1
  MK_SUB="$(GNUPGHOME="$_kh" gpg --with-colons --fingerprint "$MK_PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10;exit}')"
  MK_HOME="$_kh"
}
# mkrepo <kh> <sub> <faketime|""> -> sets MK_ROOT (a repo whose InRelease is clearsigned by <sub>)
mkrepo() {
  _kh="$1"; _sub="$2"; _ft="$3"; MK_ROOT="$(mktemp -d)"; _d="$MK_ROOT/deb/dists/stable"; mkdir -p "$_d"
  cat > "$_d/Release" <<'R'
Origin: Mathion
Suite: stable
Codename: stable
Components: main
Architectures: amd64 arm64
Date: Mon, 01 Jan 2024 00:00:00 +0000
Valid-Until: Mon, 15 Jan 2024 00:00:00 +0000
SHA256:
 0000000000000000000000000000000000000000000000000000000000000000    42 main/binary-amd64/Packages
R
  GNUPGHOME="$_kh" gpg ${_ft:+--faked-system-time "$_ft"} --batch --pinentry-mode loopback --local-user "${_sub}!" --digest-algo SHA256 --clearsign -o "$_d/InRelease" "$_d/Release" 2>/dev/null
}
# goodsig_under <keyring.asc> <InRelease> -> 0 iff the file yields a GOODSIG in a CLEAN home
# built from <keyring.asc> (proves the sig is good under THAT keyring, not a foreign home)
goodsig_under() {
  _kr="$1"; _f="$2"; _h="$(mktemp -d)"; chmod 700 "$_h"
  GNUPGHOME="$_h" gpg --batch --import "$_kr" >/dev/null 2>&1
  GNUPGHOME="$_h" gpg --batch --status-fd 1 --verify "$_f" 2>/dev/null | grep -q '^\[GNUPG:\] GOODSIG'
}

# 1) VALID: resign succeeds; the pool hash commitment is byte-identical (no pool re-read)
mkkey ""; KH="$MK_HOME"; PR="$MK_PRIMARY"; SUB="$MK_SUB"
KR="$(mktemp).asc"; GNUPGHOME="$KH" gpg --batch --export --armor "$PR" > "$KR"   # trusted keyring
mkrepo "$KH" "$SUB" ""; ROOT="$MK_ROOT"; D="$ROOT/deb/dists/stable"
before="$(extract_sha256 "$D/Release")"
GNUPGHOME="$KH" sh "$DIR/resign.sh" "$ROOT" "$SUB" "$KR"
GNUPGHOME="$KH" gpg --batch --verify "$D/InRelease" >/dev/null 2>&1 || { echo "FAIL: re-signed InRelease does not verify"; exit 1; }
case "$(grep '^Valid-Until:' "$D/Release")" in *2024*|"") echo "FAIL: Valid-Until not refreshed"; exit 1;; esac
[ "$before" = "$(extract_sha256 "$D/Release")" ] || { echo "FAIL: pool hash commitment changed — resign re-read the pool"; exit 1; }
# 2) content-tamper the SIGNED body -> refuse (gpg non-zero exit; rc gate fails closed)
sed 's/Origin: Mathion/Origin: Evil/' "$D/InRelease" > "$D/x" && mv "$D/x" "$D/InRelease"
if GNUPGHOME="$KH" sh "$DIR/resign.sh" "$ROOT" "$SUB" "$KR" 2>/dev/null; then echo "FAIL: resigned a tampered InRelease"; exit 1; fi
# 3) EXPIRED S_apt sig -> refuse (gpg exit 0 but EXPKEYSIG). Past-dated key, short expiry.
mkkey 20200101T000000 2; EKH="$MK_HOME"; EPR="$MK_PRIMARY"; ESUB="$MK_SUB"
EKR="$(mktemp).asc"; GNUPGHOME="$EKH" gpg --batch --export --armor "$EPR" > "$EKR"
mkrepo "$EKH" "$ESUB" 20200101T000000; EROOT="$MK_ROOT"
if GNUPGHOME="$EKH" sh "$DIR/resign.sh" "$EROOT" "$ESUB" "$EKR" 2>/dev/null; then echo "FAIL: resigned an EXPIRED-key InRelease"; exit 1; fi
# 4) REVOKED S_apt sig -> refuse (gpg exit 0 but REVKEYSIG)
mkkey ""; RKH="$MK_HOME"; RPR="$MK_PRIMARY"; RSUB="$MK_SUB"
mkrepo "$RKH" "$RSUB" ""; RROOT="$MK_ROOT"
sed 's/^://' "$RKH/openpgp-revocs.d/$RPR.rev" | GNUPGHOME="$RKH" gpg --batch --yes --import >/dev/null 2>&1
RKR="$(mktemp).asc"; GNUPGHOME="$RKH" gpg --batch --export --armor "$RPR" > "$RKR"
if GNUPGHOME="$RKH" sh "$DIR/resign.sh" "$RROOT" "$RSUB" "$RKR" 2>/dev/null; then echo "FAIL: resigned a REVOKED-key InRelease"; exit 1; fi
# 5) WRONG signer, exercising the FPR PIN: keyring holds BOTH signers, InRelease signed by
#    the NON-allowlisted one, allowlist pins to the OTHER -> reject at the VALIDSIG pin.
#    (A sanity check first proves the InRelease DOES carry a GOODSIG under the combined
#    keyring, so the rejection is the pin, not a missing-pubkey "no GOODSIG".)
mkkey ""; AKH="$MK_HOME"; APR="$MK_PRIMARY"; ASUB="$MK_SUB"     # allowed signer
mkkey ""; OKH="$MK_HOME"; OPR="$MK_PRIMARY"; OSUB="$MK_SUB"     # other (non-allowed) signer
BKR="$(mktemp).asc"; { GNUPGHOME="$AKH" gpg --batch --export --armor "$APR"; GNUPGHOME="$OKH" gpg --batch --export --armor "$OPR"; } > "$BKR"
mkrepo "$OKH" "$OSUB" ""; WROOT="$MK_ROOT"                      # signed by the OTHER key
goodsig_under "$BKR" "$WROOT/deb/dists/stable/InRelease" || { echo "FAIL: setup — other-signed InRelease should GOODSIG under the combined keyring"; exit 1; }
if GNUPGHOME="$OKH" sh "$DIR/resign.sh" "$WROOT" "$OSUB" "$BKR" "$ASUB" 2>/dev/null; then echo "FAIL: resigned an InRelease signed by a NON-allowlisted key"; exit 1; fi
# 6) cold start (no InRelease) -> graceful no-op
COLD="$(mktemp -d)"; mkdir -p "$COLD/deb/dists/stable"
GNUPGHOME="$KH" sh "$DIR/resign.sh" "$COLD" "$SUB" "$KR" || { echo "FAIL: cold start did not no-op"; exit 1; }
# 7) ROTATION CUTOVER: ONE primary with TWO sign subkeys (outgoing+incoming). InRelease
#    signed by OUTGOING; resign SIGNS with INCOMING while the allowlist accepts BOTH ->
#    the re-signed InRelease must be INCOMING-signed. Proves the actual §6.1 cutover
#    (accept outgoing, re-sign incoming), not merely overlap acceptance; models the
#    outgoing+incoming subkeys under one primary as production does.
mkkey ""; CKH="$MK_HOME"; CPR="$MK_PRIMARY"; OGSUB="$MK_SUB"    # primary + outgoing subkey
GNUPGHOME="$CKH" gpg --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$CPR" ed25519 sign 0d >/dev/null 2>&1
NGSUB="$(GNUPGHOME="$CKH" gpg --with-colons --fingerprint "$CPR" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{f=$10;s=0} END{print f}')"   # incoming = LAST sub
[ "$NGSUB" != "$OGSUB" ] || { echo "FAIL: setup — incoming subkey fpr equals outgoing"; exit 1; }
CKR="$(mktemp).asc"; GNUPGHOME="$CKH" gpg --batch --export --armor "$CPR" > "$CKR"   # keyring = primary + both subs
mkrepo "$CKH" "$OGSUB" ""; CROOT="$MK_ROOT"                     # InRelease signed by OUTGOING
GNUPGHOME="$CKH" sh "$DIR/resign.sh" "$CROOT" "$NGSUB" "$CKR" "$OGSUB $NGSUB" || { echo "FAIL: cutover resign refused"; exit 1; }
cutst="$(GNUPGHOME="$CKH" gpg --batch --status-fd 1 --verify "$CROOT/deb/dists/stable/InRelease" 2>/dev/null)"
printf '%s\n' "$cutst" | grep -q "^\[GNUPG:\] VALIDSIG $NGSUB " || { echo "FAIL: cutover did not re-sign with the INCOMING subkey"; exit 1; }
echo "resign_test PASSED"
