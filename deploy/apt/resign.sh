#!/bin/sh
# resign.sh <repo-root> <signing-S_apt-fpr> <trusted-apt-keyring.asc> [<verify-allowlist-fprs>]
# Dates-only Release refresh. Verifies the existing InRelease with the FULL S_apt policy
# (GOODSIG + reject expired/revoked + VALIDSIG in the allowlist — via verify-inrelease.sh,
# in a clean keyring from the trusted committed keyring, because gpg's exit code alone
# would accept an EXPKEYSIG/REVKEYSIG signature), extracts its authenticated payload,
# replaces ONLY Date/Valid-Until, and re-signs. SIGNS with the single <signing-S_apt-fpr>;
# ACCEPTS any fpr in <verify-allowlist-fprs> (defaults to the signing fpr; during a
# rotation overlap the caller passes "outgoing incoming" so the still-outgoing-signed
# InRelease is accepted before being re-signed — §6.1). NEVER re-reads/re-indexes the
# pool, so an unattended run cannot launder pool/Packages state. Cold start (no InRelease)
# is a no-op. (§7.2)
set -eu
ROOT="$1"; FPR="$2"; KEYRING="$3"; VERIFY_FPRS="${4:-$2}"
VALID_DAYS="${MATHION_APT_VALID_DAYS:-30}"
PASS="${GPG_PASSPHRASE:-}"
D="$ROOT/deb/dists/stable"
[ -f "$D/InRelease" ] || { echo "no signed repo yet ($D/InRelease absent); nothing to resign"; exit 0; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
sh "$(dirname "$0")/verify-inrelease.sh" "$D/InRelease" "$KEYRING" "$VERIFY_FPRS" "$tmp/body" \
  || { echo "existing InRelease failed S_apt policy verification — refusing to resign" >&2; exit 1; }
# refresh ONLY Date/Valid-Until; every hash block (the pool commitment) is preserved verbatim
sed '/^Date:/d;/^Valid-Until:/d' "$tmp/body" > "$tmp/new"
{ echo "Date: $(date -u -R)"; echo "Valid-Until: $(date -u -R -d "+${VALID_DAYS} days")"; } >> "$tmp/new"
gpg_sign() {   # mirrors build.sh: feed the passphrase on fd 0 when set (prod), skip when empty (throwaway)
  if [ -n "$PASS" ]; then
    printf '%s' "$PASS" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 --local-user "${FPR}!" --digest-algo SHA256 "$@"
  else
    gpg --batch --pinentry-mode loopback --local-user "${FPR}!" --digest-algo SHA256 "$@"
  fi
}
# sign the NEW dated body into temp files first; nothing in the live repo dir is
# mutated until BOTH signatures exist, then publish via atomic same-dir rename
# (InRelease LAST) so a transient signing failure leaves the previous valid
# InRelease/Release intact.
gpg_sign --clearsign -o "$tmp/InRelease"   "$tmp/new"
gpg_sign -abs        -o "$tmp/Release.gpg" "$tmp/new"
cp "$tmp/new"         "$D/Release.tmp"      && mv -f "$D/Release.tmp"      "$D/Release"
cp "$tmp/Release.gpg" "$D/Release.gpg.tmp"  && mv -f "$D/Release.gpg.tmp"  "$D/Release.gpg"
cp "$tmp/InRelease"   "$D/InRelease.tmp"    && mv -f "$D/InRelease.tmp"    "$D/InRelease"
echo "apt Release re-signed (fresh Date/Valid-Until, pool commitments preserved) by $FPR"
