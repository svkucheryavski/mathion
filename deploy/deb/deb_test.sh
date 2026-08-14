#!/bin/sh
set -eu
cd "$(dirname "$0")/../../cli"
gzip -9nkf ../deploy/man/mathion.1
gzip -9nkf ../deploy/deb/changelog.Debian
gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES
# a placeholder dearmored keyring so nfpm has a file to package (real one is prod)
[ -f ../deploy/keys/mathion-archive-keyring.gpg ] || printf 'placeholder' > ../deploy/keys/mathion-archive-keyring.gpg
CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
  goreleaser release --clean --skip=publish,sign --snapshot
cd dist
# goreleaser writes plain mathion_<ver>_<arch>.deb names (no spaces/newlines), so ls|head is safe here.
# shellcheck disable=SC2012
deb="$(ls mathion_*_amd64.deb 2>/dev/null | head -1)"
[ -n "$deb" ] || { echo "FAIL: no amd64 .deb built"; exit 1; }
# version must be 0.2.0 (cli-v stripped)
v="$(dpkg-deb -f "$deb" Version)"; [ "$v" = "0.2.0" ] || { echo "FAIL: deb Version=$v want 0.2.0"; exit 1; }
# capture the file listing once so grep -q doesn't SIGPIPE dpkg-deb's tar on each check
listing="$(dpkg-deb -c "$deb")"
printf '%s\n' "$listing" | grep -q ' ./usr/bin/mathion$' || { echo "FAIL: /usr/bin/mathion missing"; exit 1; }
printf '%s\n' "$listing" | grep -q ' ./usr/share/keyrings/mathion-archive-keyring.gpg$' || { echo "FAIL: keyring missing"; exit 1; }
printf '%s\n' "$listing" | grep -q ' ./usr/share/man/man1/mathion.1.gz$' || { echo "FAIL: man page missing"; exit 1; }
printf '%s\n' "$listing" | grep -q ' ./usr/share/doc/mathion/copyright$' || { echo "FAIL: copyright missing"; exit 1; }
# keyring must NOT be a conffile. Extraction is a REQUIRED step: under set -e a
# dpkg-deb -e failure aborts (fail-closed) instead of skipping the check.
dpkg-deb -e "$deb" ctrl
if [ -f ctrl/conffiles ] && grep -q mathion-archive-keyring ctrl/conffiles; then
  echo "FAIL: keyring is a conffile"; exit 1; fi
rm -rf ctrl
# Recommends must NOT pull docker (Suggests or none only)
dpkg-deb -f "$deb" Recommends | grep -qi docker && { echo "FAIL: docker in Recommends"; exit 1; } || true
echo "deb_test PASSED"
