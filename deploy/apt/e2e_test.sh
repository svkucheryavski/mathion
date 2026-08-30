#!/bin/sh
# Hermetic apt e2e: build+sign a repo with a THROWAWAY key, serve it, apt install.
set -eu
command -v apt-ftparchive >/dev/null 2>&1 || { echo "SKIP: apt-utils not installed"; exit 0; }
[ "$(id -u)" = 0 ] || { echo "SKIP: needs root for apt"; exit 0; }

# Direct-postinst logic tests (spec §7 (ii)/(iii)): rewrite the two absolute paths to
# fixtures and run the maintainer script's configure branch. Covers the shadow, timeout,
# and missing-binary paths without a full apt cycle and without touching real binaries.
test_postinst_direct() {
  pdir="$(mktemp -d)"
  src="$(dirname "$0")/../deb/postinst.sh"

  # (a) shadow present -> shadow warning, NO drift line.
  : > "$pdir/shadow"          # stands in for /usr/local/bin/mathion
  : > "$pdir/bin"; chmod +x "$pdir/bin"
  sed "s#/usr/local/bin/mathion#$pdir/shadow#g; s#/usr/bin/mathion#$pdir/bin#g" "$src" > "$pdir/postinst"
  out="$(sh "$pdir/postinst" configure 2>&1)"; rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: postinst shadow-case rc=$rc"; exit 1; }
  echo "$out" | grep -q "will shadow this apt package" || { echo "FAIL: no shadow warning"; exit 1; }
  echo "$out" | grep -q "differs from this mathion version" && { echo "FAIL: drift claim in shadow case"; exit 1; }

  # (b) timeout-path: a SIGTERM-ignoring blocker must be SIGKILLed by --kill-after. The
  #     fixture touches a sentinel first, so we can prove the probe branch actually ran
  #     (exit-0-under-20s could otherwise false-pass on a skipped probe).
  rm -f "$pdir/shadow"
  sent="$pdir/sentinel"
  cat > "$pdir/bin" <<EOF
#!/bin/sh
: > "$sent"
trap '' TERM
sleep 30
EOF
  chmod +x "$pdir/bin"
  sed "s#/usr/local/bin/mathion#$pdir/shadow#g; s#/usr/bin/mathion#$pdir/bin#g" "$src" > "$pdir/postinst"
  start="$(date +%s)"
  sh "$pdir/postinst" configure >/dev/null 2>&1; rc=$?
  elapsed=$(( $(date +%s) - start ))
  [ "$rc" = 0 ] || { echo "FAIL: postinst timeout-path rc=$rc"; exit 1; }
  [ -f "$sent" ] || { echo "FAIL: probe branch did not run (no sentinel)"; exit 1; }
  [ "$elapsed" -lt 20 ] || { echo "FAIL: postinst did not bound the SIGTERM-ignorer (${elapsed}s)"; exit 1; }

  # (c) missing /usr/bin/mathion -> configure still exits 0, no probe.
  rm -f "$pdir/bin"
  sed "s#/usr/local/bin/mathion#$pdir/shadow#g; s#/usr/bin/mathion#$pdir/bin#g" "$src" > "$pdir/postinst"
  sh "$pdir/postinst" configure >/dev/null 2>&1 || { echo "FAIL: postinst missing-binary rc nonzero"; exit 1; }

  rm -rf "$pdir"
  echo "postinst direct-logic tests PASSED"
}
test_postinst_direct

WORK="$(mktemp -d)"
cleanup() {
  if [ -f "$WORK/pid" ]; then kill "$(cat "$WORK/pid")" 2>/dev/null || true; fi
  apt-get remove -y mathion >/dev/null 2>&1 || true
  rm -f /etc/apt/sources.list.d/mathion-test.list /usr/share/keyrings/mathion-test.gpg
  if [ -f "$WORK/compose.bak" ]; then
    cp -p "$WORK/compose.bak" /etc/mathion/docker-compose.yml  # restore the operator's real file byte-for-byte
  elif [ -f "$WORK/compose_seeded" ]; then
    rm -f /etc/mathion/docker-compose.yml                      # only OUR seeded file (no real one existed) -> remove
  fi
  if [ -f "$WORK/etc_mathion_created" ]; then
    rmdir /etc/mathion 2>/dev/null || true                    # remove the dir only if WE created it (rmdir needs it empty)
  fi
  if [ -f "$WORK/shadow_created" ]; then
    rm -f /usr/local/bin/mathion                              # remove ONLY the stand-in WE created (never a real curl|sh copy)
  fi
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
# --- REAL install -> upgrade sequence (spec §7 (i)). First install a BASELINE package with
#     NO drift present (we have not seeded /etc/mathion yet, so the postinst probe stays
#     silent); then publish a STRICTLY NEWER package and run an actual apt UPGRADE with drift
#     seeded, asserting the precise advisory fires during dpkg configure and the upgrade lands.
apt-get install -y -o APT::Get::AllowUnauthenticated=false mathion > "$WORK/install-base.log" 2>&1
# A clean host (no compose) must NOT cry drift on a first install. Guard the assertion on
# "no compose present" so a dev host with a REAL /etc/mathion/docker-compose.yml (which may
# legitimately differ) does not false-fail here.
if [ ! -e /etc/mathion/docker-compose.yml ]; then
  grep -q "differs from this mathion version" "$WORK/install-base.log" \
    && { echo "FAIL: drift line on a clean baseline install (no compose seeded)"; cat "$WORK/install-base.log"; exit 1; }
fi
test -x /usr/bin/mathion && /usr/bin/mathion version >/dev/null

# Publish a STRICTLY NEWER package by re-stamping the built .deb(s) to 9999.0.0 with dpkg-deb
# (no second goreleaser run): -R extracts control+data, we bump ONLY Version, --build repacks.
# build.sh copies it into the SAME pool and re-indexes the whole pool, so the repo now offers
# both the baseline version and 9999.0.0.
NEWDEBS="$WORK/newdebs"; mkdir -p "$NEWDEBS"
for _deb in "$DEBS"/mathion_*.deb; do
  _ex="$WORK/ex_$(basename "$_deb" .deb)"
  dpkg-deb -R "$_deb" "$_ex"
  sed 's/^Version: .*/Version: 9999.0.0/' "$_ex/DEBIAN/control" > "$_ex/DEBIAN/control.new"
  mv "$_ex/DEBIAN/control.new" "$_ex/DEBIAN/control"
  _arch="$(awk -F': ' '/^Architecture:/{print $2; exit}' "$_ex/DEBIAN/control")"
  dpkg-deb --build "$_ex" "$NEWDEBS/mathion_9999.0.0_${_arch}.deb" >/dev/null
done
# Force the rebuilt InRelease to a strictly-later whole-second mtime than the baseline one apt
# already cached. apt sends If-Modified-Since on the second update and Python's http.server
# truncates mtimes to the second (returns 304 when file-mtime <= IMS); a same-second rebuild
# would then 304, leave the baseline index cached, and hide 9999.0.0 from the upgrade. A >=1s
# real gap always advances the truncated mtime by a full second, so apt refetches (200).
sleep 1
sh "$(dirname "$0")/build.sh" "$NEWDEBS" "$WORK/site" "$FPR"
apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/mathion-test.list \
  -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0

# Seed a DRIFTED compose so the UPGRADE's postinstall probe emits the precise drift line during
# configure. NEVER clobber a real operator deployment: ATOMICALLY back up an existing compose
# (cp to .partial then mv, so a partial copy can never satisfy the restore guard) and restore it
# byte-for-byte in cleanup. The `compose_seeded` marker is written ONLY AFTER we overwrite, and it
# is what authorizes cleanup to delete the file — so an abort BEFORE seeding can never remove an
# operator's compose. Only remove /etc/mathion if WE created the dir.
if [ -e /etc/mathion/docker-compose.yml ]; then
  cp -p /etc/mathion/docker-compose.yml "$WORK/compose.bak.partial"
  mv "$WORK/compose.bak.partial" "$WORK/compose.bak"
elif [ ! -d /etc/mathion ]; then
  : > "$WORK/etc_mathion_created"
fi
mkdir -p /etc/mathion
printf 'drifted: yes\n' > /etc/mathion/docker-compose.yml
: > "$WORK/compose_seeded"

# The REAL upgrade: apt moves mathion baseline -> 9999.0.0, dpkg runs postinst configure on a
# drifted host, and the precise advisory must appear with a clean exit. No pipe: `... | tee` masks
# apt's exit status under `set -e` (sh has no pipefail), so a hard failure would slip through to the
# drift grep. Redirect instead.
apt-get install -y --only-upgrade -o APT::Get::AllowUnauthenticated=false mathion > "$WORK/upgrade.log" 2>&1
grep -q "differs from this mathion version" "$WORK/upgrade.log" || { echo "FAIL: no drift line during a real apt UPGRADE of a drifted host"; cat "$WORK/upgrade.log"; exit 1; }
_upver="$(dpkg-query -W -f='${Version}' mathion)"
[ "$_upver" = 9999.0.0 ] || { echo "FAIL: upgrade did not land 9999.0.0 (got '$_upver')"; exit 1; }
test -x /usr/bin/mathion && /usr/bin/mathion version >/dev/null

# Shadow-through-REAL-apt (spec §7 (i) dual-install): with a curl|sh copy at /usr/local/bin/mathion,
# a dpkg reconfigure must warn about the shadow and must NOT run the probe (no drift line) even
# though the host is still drifted. Guard against clobbering a REAL curl|sh install: only stand one
# in when none exists, mark that WE created it (so cleanup removes it if we abort mid-reinstall), and
# remove only our own stand-in.
if [ -e /usr/local/bin/mathion ]; then
  echo "SKIP shadow-through-apt: a real /usr/local/bin/mathion is present (won't clobber it)"
else
  : > /usr/local/bin/mathion
  : > "$WORK/shadow_created"
  apt-get install -y --reinstall -o APT::Get::AllowUnauthenticated=false mathion > "$WORK/shadow.log" 2>&1
  rm -f /usr/local/bin/mathion
  rm -f "$WORK/shadow_created"
  grep -q "will shadow this apt package" "$WORK/shadow.log" || { echo "FAIL: no shadow warning during apt reinstall with a curl|sh copy present"; cat "$WORK/shadow.log"; exit 1; }
  grep -q "differs from this mathion version" "$WORK/shadow.log" \
    && { echo "FAIL: drift claimed during apt reinstall despite a shadowing curl|sh copy"; cat "$WORK/shadow.log"; exit 1; }
fi

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
