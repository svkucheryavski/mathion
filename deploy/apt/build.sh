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

# Materialize by-hash indexes. The Release above advertises Acquire-By-Hash: yes, so apt
# clients fetch <dir>/by-hash/SHA256/<hash> FIRST — but apt-ftparchive (2.8.x) does NOT
# create those dirs from DoByHash. Create them ourselves for EVERY index the Release
# lists (Packages* for `apt install`; Contents-* for `apt-file`), driven off Release's
# own SHA256 block so the set can never drift from what clients ask for: each entry is
# "<sha256> <size> <relpath>" (relative to dists/stable), so drop a byte-identical copy
# at dists/stable/<dir relpath>/by-hash/SHA256/<sha256>. A client fetching by hash then
# gets a consistent index even mid-update (the guarantee Acquire-By-Hash exists for).
# Done AFTER `release` so the hashes match what it emitted and `release` can't recurse
# into by-hash/; the indexes are unchanged since `generate`. The appended Valid-Until:
# line ends the SHA256 block for the parser (any header line flips it off). Restrict to
# sub-paths ($3 has a '/'): apt fetches the top-level Release/InRelease DIRECTLY, never by
# hash, and the shell truncates dists/stable/Release before `release` scans it, so the
# block carries a stale self-entry for `Release` whose listed hash no longer matches its
# final bytes — materializing that would be a by-hash file whose name lies about content.
awk '/^[A-Za-z0-9-]+:/{s=($0=="SHA256:")?1:0; next} s && NF>=3 && $3 ~ "/" {print $1, $3}' dists/stable/Release |
  while read -r _h _rel; do
    _f="dists/stable/$_rel"
    [ -f "$_f" ] || continue
    _bhd="dists/stable/$(dirname "$_rel")/by-hash/SHA256"
    mkdir -p "$_bhd"
    cp -f "$_f" "$_bhd/$_h"
  done

# sign with S_apt; feed the passphrase on fd 0 when set (prod), skip when empty (throwaway).
gpg_sign() {
  if [ -n "$PASS" ]; then
    printf '%s' "$PASS" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 --local-user "${FPR}!" --digest-algo SHA256 "$@"
  else
    gpg --batch --pinentry-mode loopback --local-user "${FPR}!" --digest-algo SHA256 "$@"
  fi
}
# clear any stale temp sigs left by a previously-interrupted run so batch gpg
# won't refuse to overwrite them; then sign into temp files and publish
# atomically (InRelease LAST) so a signing failure can't leave the repo unsigned.
rm -f dists/stable/InRelease.tmp dists/stable/Release.gpg.tmp
gpg_sign --clearsign -o dists/stable/InRelease.tmp   dists/stable/Release
gpg_sign -abs        -o dists/stable/Release.gpg.tmp dists/stable/Release
mv -f dists/stable/Release.gpg.tmp dists/stable/Release.gpg
mv -f dists/stable/InRelease.tmp   dists/stable/InRelease
echo "apt repo built at $ROOT/deb (signed by $FPR)"
