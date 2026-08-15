#!/bin/sh
# Hermetic apt e2e: build+sign a repo with a THROWAWAY key, serve it, apt install.
set -eu
command -v apt-ftparchive >/dev/null 2>&1 || { echo "SKIP: apt-utils not installed"; exit 0; }
[ "$(id -u)" = 0 ] || { echo "SKIP: needs root for apt"; exit 0; }
WORK="$(mktemp -d)"
cleanup() {
  if [ -f "$WORK/pid" ]; then kill "$(cat "$WORK/pid")" 2>/dev/null || true; fi
  apt-get remove -y mathion >/dev/null 2>&1 || true
  rm -f /etc/apt/sources.list.d/mathion-test.list /usr/share/keyrings/mathion-test.gpg
  rm -rf "$WORK"
}
trap cleanup EXIT
export GNUPGHOME="$WORK/gnupg"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
cat > "$GNUPGHOME/kp" <<'P'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign,cert
Name-Real: Mathion Apt Test
Name-Email: apt@example.invalid
Expire-Date: 0
%commit
P
gpg --batch --gen-key "$GNUPGHOME/kp" >/dev/null 2>&1
FPR="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
gpg --batch --export --armor "$FPR" | gpg --batch --yes --dearmor -o "$WORK/keyring.gpg"

# build the .deb (snapshot) into the pool input
( cd "$(dirname "$0")/../../cli"
  gzip -9nkf ../deploy/man/mathion.1; gzip -9nkf ../deploy/deb/changelog.Debian; gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES
  cp "$WORK/keyring.gpg" ../deploy/keys/mathion-archive-keyring.gpg
  CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
    goreleaser release --clean --skip=publish,sign --snapshot >/dev/null )
DEBS="$(cd "$(dirname "$0")/../../cli/dist" && pwd)"
sh "$(dirname "$0")/build.sh" "$DEBS" "$WORK/site" "$FPR"

# structural assertions: per-arch by-hash index + freshness stamp present
test -d "$WORK/site/deb/dists/stable/main/binary-amd64/by-hash/SHA256" || { echo "FAIL: no by-hash index"; exit 1; }
grep -q '^Valid-Until:' "$WORK/site/deb/dists/stable/InRelease" || { echo "FAIL: no Valid-Until in InRelease"; exit 1; }

# serve + configure apt
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
( cd "$WORK/site" && python3 -m http.server "$PORT" >/dev/null 2>&1 & echo $! > "$WORK/pid" )
python3 - "$PORT" <<'PY'
import socket,sys,time
p=int(sys.argv[1])
for _ in range(50):
    try:
        socket.create_connection(("127.0.0.1",p),0.1).close(); sys.exit(0)
    except OSError: time.sleep(0.1)
sys.exit(1)
PY
install -m0644 "$WORK/keyring.gpg" /usr/share/keyrings/mathion-test.gpg
echo "deb [signed-by=/usr/share/keyrings/mathion-test.gpg] http://127.0.0.1:$PORT/deb stable main" \
  > /etc/apt/sources.list.d/mathion-test.list
apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/mathion-test.list \
  -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
apt-get install -y -o APT::Get::AllowUnauthenticated=false mathion
test -x /usr/bin/mathion && /usr/bin/mathion version >/dev/null

# tamper-negative: a corrupted Release must be REJECTED by apt. Modify a byte INSIDE
# the signed body (the Suite field), NOT a trailing append — gpg/gpgv process only the
# first OpenPGP message and ignore bytes past the signature block, so
# `printf 'x' >> InRelease` can slip through. A body edit breaks the clearsigned digest
# -> gpgv reports BADSIG. Point this update at a FRESH empty lists dir: apt detects the
# bad signature either way, but with the earlier good `apt-get update` still CACHED it
# only WARNS, reuses the old index, and exits 0 ("old ones used instead") — so the
# rejection would be invisible to a `$?` check. With no cache to fall back to it hard-
# fails ("repository is not signed", exit 100); the fresh dir is what makes the rejection
# observable as a nonzero exit.
rm -f "$WORK/site/deb/dists/stable/Release" "$WORK/site/deb/dists/stable/Release.gpg"
sed 's/^Suite: stable/Suite: tampered/' "$WORK/site/deb/dists/stable/InRelease" > "$WORK/ir.tampered" \
  && mv "$WORK/ir.tampered" "$WORK/site/deb/dists/stable/InRelease"
mkdir -p "$WORK/freshlists/partial"
if apt-get update -o Dir::State::Lists="$WORK/freshlists" \
     -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/mathion-test.list \
     -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 >/dev/null 2>&1; then
  echo "FAIL: apt accepted a tampered InRelease"; exit 1
fi

echo "apt e2e PASSED"
