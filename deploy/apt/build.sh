#!/bin/sh
# build.sh <pool-input-dir with new *.deb> <repo-root> <S_apt-fingerprint>
# PUBLISH builder: copies new release .debs into the pool, (re)generates per-arch
# indexes + a fresh Date/Valid-Until over the whole pool, and signs Release with S_apt.
# The scheduled Valid-Until refresh does NOT use this script — it uses resign.sh
# (dates-only, no pool re-index) so an unattended run cannot launder pool state (§7.2).
# <pool-input-dir> is always distinct from the repo's own pool here (apt-publish passes
# the downloaded-artifact dir), so no self-copy case arises.
set -eu
IN="$1"; ROOT="$2"; FPR="$3"
VALID_DAYS="${MATHION_APT_VALID_DAYS:-30}"
PASS="${GPG_PASSPHRASE:-}"
CONF="$(cd "$(dirname "$0")" && pwd)/apt-ftparchive.conf"
DEST="$ROOT/deb/pool/main/m/mathion"

mkdir -p "$DEST" "$ROOT/deb/dists/stable/main/binary-amd64" \
         "$ROOT/deb/dists/stable/main/binary-arm64"
cp "$IN"/mathion_*.deb "$DEST/"

cd "$ROOT/deb"
apt-ftparchive generate "$CONF"
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Mathion \
  -o APT::FTPArchive::Release::Label=Mathion \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Components=main \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Acquire-By-Hash=true \
  release dists/stable > dists/stable/Release
# apt-ftparchive already emits a fresh Date:; append ONLY Valid-Until (a second
# Date: would be malformed deb822). deb822 is field-order-independent, so appending
# after the hash blocks is safe.
echo "Valid-Until: $(date -u -R -d "+${VALID_DAYS} days")" >> dists/stable/Release

# sign with S_apt; feed the passphrase on fd 0 when set (prod), skip when empty (throwaway).
gpg_sign() {
  if [ -n "$PASS" ]; then
    printf '%s' "$PASS" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 --local-user "${FPR}!" --digest-algo SHA256 "$@"
  else
    gpg --batch --pinentry-mode loopback --local-user "${FPR}!" --digest-algo SHA256 "$@"
  fi
}
# sign into temp files, then publish atomically (InRelease LAST) so a signing
# failure cannot delete the last valid InRelease and leave the repo unsigned.
gpg_sign --clearsign -o dists/stable/InRelease.tmp   dists/stable/Release
gpg_sign -abs        -o dists/stable/Release.gpg.tmp dists/stable/Release
mv -f dists/stable/Release.gpg.tmp dists/stable/Release.gpg
mv -f dists/stable/InRelease.tmp   dists/stable/InRelease
echo "apt repo built at $ROOT/deb (signed by $FPR)"
