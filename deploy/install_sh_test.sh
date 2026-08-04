#!/bin/sh
set -eu
# Build local artifacts (mirrors release-cli.yml).
cd "$(dirname "$0")/../cli"
CLI_TAG=cli-v0.0.0-test APP_IMAGE=v0.1.1 GORELEASER_CURRENT_TAG=v0.0.0-test \
  goreleaser release --clean --skip=publish --snapshot
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
echo "install_sh_test PASSED"
