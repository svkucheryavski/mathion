#!/bin/sh
set -eu
# Build local artifacts (mirrors release-cli.yml).
cd "$(dirname "$0")/../cli"
CLI_TAG=cli-v0.0.0-test APP_IMAGE=v0.1.1 GORELEASER_CURRENT_TAG=v0.0.0-test \
  goreleaser release --clean --skip=publish --snapshot
test -f dist/mathion_linux_amd64.tar.gz || { echo "FAIL: amd64 archive missing"; exit 1; }
test -f dist/mathion_linux_arm64.tar.gz || { echo "FAIL: arm64 archive missing"; exit 1; }
test -f dist/checksums.txt || { echo "FAIL: checksums.txt missing (name_template not pinned)"; exit 1; }
# checksum verifies for the host arch
case "$(uname -m)" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) echo "SKIP unknown arch"; exit 0;; esac
( cd dist && grep " mathion_linux_${A}.tar.gz\$" checksums.txt | sha256sum -c - ) || { echo "FAIL: checksum"; exit 1; }
echo "install_sh_test PASSED"
