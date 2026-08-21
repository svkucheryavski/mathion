#!/bin/sh
# self-update integration: throwaway OpenPGP keys + REAL shell-launched binaries.
# Covers the §9.2 scenarios: happy path, rotation crossing, apt defer, S_apt reject,
# and the staged-exec bound + fd-hygiene legs (past-deadline abort + fork-orphan i/ii).
set -eu
[ "${MATHION_SELFUPDATE_E2E:-}" = 1 ] || { echo "SKIP: set MATHION_SELFUPDATE_E2E=1 (mutates /usr/local/bin/mathion + /usr/bin/mathion)"; exit 0; }
[ "$(id -u)" = 0 ] || { echo "SKIP: needs root (swap + ancestry guard)"; exit 0; }
for t in gpg python3 dpkg go timeout flock; do command -v "$t" >/dev/null 2>&1 || { echo "SKIP: $t required"; exit 0; }; done
for p in /usr/local/bin/mathion /usr/bin/mathion; do
  [ -e "$p" ] && { echo "SKIP: $p already exists — refusing to overwrite a real install (run in a disposable container)"; exit 0; }
done

CLI_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
# cleanup reaps the release server + any long-lived forky orphan/parent (leg 5) and
# restores the dpkg DB mutated by LEG 3 (on any abort) BEFORE removing WORK, so a
# bare-host run leaves nothing behind (docker --rm handles the rest).
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -f "$WORK/forky_pids" ] && { xargs -r kill -9 <"$WORK/forky_pids" 2>/dev/null || true; }
  # LEG 3 mutates the real dpkg DB; restore it here on ANY abort (a mid-LEG-3
  # failure skips the inline restore). The success path removes status.bak to
  # disarm this. Idempotent: restoring the same backup twice is harmless.
  if [ -f "$WORK/status.bak" ]; then
    cp "$WORK/status.bak" /var/lib/dpkg/status 2>/dev/null || true
    rm -f /var/lib/dpkg/info/mathion.list /usr/bin/mathion 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM
export GNUPGHOME="$WORK/gnupg"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
SITE="$WORK/site"; mkdir -p "$SITE"
ASSET="mathion_linux_$(go env GOARCH).tar.gz"

# --- helpers ---------------------------------------------------------------
gen_key() { # <email> -> prints the PRIMARY fingerprint (cert primary + sign subkey)
  cat > "$WORK/kp" <<EOF
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Test $1
Name-Email: $1
Expire-Date: 0
%commit
EOF
  gpg --batch --gen-key "$WORK/kp" >/dev/null 2>&1
  gpg --batch --with-colons --list-keys "$1" | awk -F: '/^fpr:/{print $10; exit}'
}

build_bin() { # <baked-tag> <embed-pubkey.asc> <out-path>
  tree="$WORK/tree-$(basename "$3")"
  cp -a "$CLI_DIR" "$tree"
  cp "$2" "$tree/internal/selfupdate/mathion-pubkey.asc"   # overwrite the EMBED, not the tracked asset
  ( cd "$tree" && CGO_ENABLED=0 go build -tags mathion_selfupdate_test \
      -ldflags "-X main.version=$1" -o "$3" . )
  rm -rf "$tree"
}

publish() { # <tag> <binary> <signer-primary-fpr>
  d="$SITE/$1"; mkdir -p "$d"
  root="$WORK/pkgroot"; rm -rf "$root"; mkdir -p "$root"
  install -m0755 "$2" "$root/mathion"
  tar -C "$root" -czf "$d/$ASSET" mathion              # single regular member "mathion"
  sha="$(sha256sum "$d/$ASSET" | awk '{print $1}')"
  printf '%s  %s\n' "$sha" "$ASSET" > "$d/checksums.txt"
  gpg --batch --yes --armor --digest-algo SHA256 --local-user "$3" \
    --detach-sign -o "$d/checksums.txt.asc" "$d/checksums.txt"   # signs with the SIGN subkey
}

# --- keys + binaries -------------------------------------------------------
K1="$(gen_key k1@example.invalid)"; gpg --batch --armor --export "$K1" > "$WORK/k1.asc"
K2="$(gen_key k2@example.invalid)"; gpg --batch --armor --export "$K2" > "$WORK/k2.asc"

build_bin cli-v0.2.0 "$WORK/k1.asc" "$WORK/client_k1"      # curl client, trusts K1
build_bin cli-v0.9.0 "$WORK/k1.asc" "$WORK/rel090_k1"      # happy-path release payload
build_bin cli-v0.5.0 "$WORK/k2.asc" "$WORK/trans050_k2"    # transition payload: embeds K2
build_bin cli-v0.9.0 "$WORK/k2.asc" "$WORK/latest090_k2"   # rotation latest payload

# --- release server --------------------------------------------------------
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
( cd "$SITE" && exec python3 -m http.server "$PORT" >/dev/null 2>&1 ) & SERVER_PID=$!
sleep 1
BASE="http://127.0.0.1:$PORT"
export MATHION_SELFUPDATE_API_BASE="$BASE" MATHION_SELFUPDATE_DL_BASE="$BASE"
# plain HTTP is fine: the https-only policy binds redirect hops, not the injected endpoint.

verset() { printf '%s' "$1" > "$SITE/releases"; }   # <releases-json>

# === LEG 1: HAPPY PATH (curl-managed, K1-signed) ===========================
verset '[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.2.0"}]'
publish cli-v0.9.0 "$WORK/rel090_k1" "$K1"
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
/usr/local/bin/mathion self-update --yes
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.9.0" ] || { echo "FAIL(happy): want cli-v0.9.0, got $v"; exit 1; }
m="$(stat -c %a /usr/local/bin/mathion)"
[ "$m" = 755 ] || { echo "FAIL(happy): installed mode $m != 755"; exit 1; }

# === LEG 2: S_apt REJECTION (re-sign with K2, which the K1 client does not trust) ==
publish cli-v0.9.0 "$WORK/rel090_k1" "$K2"    # foreign signature
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
if /usr/local/bin/mathion self-update --yes; then echo "FAIL(reject): foreign-key sig accepted"; exit 1; fi
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(reject): binary changed to $v"; exit 1; }

# === LEG 3: APT DEFER (a real dpkg-owned path) =============================
# Make `dpkg -S /usr/bin/mathion` report the file as mathion-owned. A `.list`
# file ALONE is not enough — dpkg's search only reports files for packages that
# have a stanza in the status DB, so we must ALSO append a minimal
# `Status: install ok installed` stanza to /var/lib/dpkg/status (this is what a
# real apt install leaves behind: both the .list file and the status stanza).
# Back up the status DB first; the success path restores it inline (and removes
# status.bak to disarm the trap), while cleanup() restores it on any mid-leg abort
# — we are mutating the container's real dpkg database.
mkdir -p /var/lib/dpkg/info
cp /var/lib/dpkg/status "$WORK/status.bak"
printf '/usr/bin/mathion\n' > /var/lib/dpkg/info/mathion.list
printf '\nPackage: mathion\nStatus: install ok installed\nPriority: optional\nSection: admin\nMaintainer: Mathion Test <t@example.invalid>\nArchitecture: %s\nVersion: 0.2.0\nDescription: apt-defer test stub\n' "$(dpkg --print-architecture)" >> /var/lib/dpkg/status
install -m0755 "$WORK/client_k1" /usr/bin/mathion
publish cli-v0.9.0 "$WORK/rel090_k1" "$K1"    # a valid update EXISTS; defer must still win
out="$(/usr/bin/mathion self-update --yes)"
printf '%s' "$out" | grep -q 'apt install --only-upgrade mathion' || { echo "FAIL(apt): no defer message: $out"; exit 1; }
v="$(/usr/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(apt): dpkg-owned binary was swapped to $v"; exit 1; }
cp "$WORK/status.bak" /var/lib/dpkg/status
rm -f /var/lib/dpkg/info/mathion.list /usr/bin/mathion "$WORK/status.bak"

# === LEG 4: ROTATION CROSSING (two invocations) ============================
# cli-v0.5.0: signed by OUTGOING K1, payload embeds INCOMING K2 (the transition).
# cli-v0.9.0: signed by INCOMING K2 only (the K1 client cannot verify it yet).
verset '[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.5.0"},{"tag_name":"cli-v0.2.0"}]'
publish cli-v0.5.0 "$WORK/trans050_k2" "$K1"
publish cli-v0.9.0 "$WORK/latest090_k2" "$K2"
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
# Run 1: K1 client skips the K2-signed 0.9.0 (unverifiable) and installs the K1-signed transition.
/usr/local/bin/mathion self-update --yes
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.5.0" ] || { echo "FAIL(rotate run1): want cli-v0.5.0, got $v"; exit 1; }
# Run 2: the now-installed transition binary embeds K2 and reaches the K2-signed latest.
/usr/local/bin/mathion self-update --yes
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.9.0" ] || { echo "FAIL(rotate run2): want cli-v0.9.0, got $v"; exit 1; }
rm -f /usr/local/bin/mathion

# === LEG 5: STAGED-EXEC BOUND + fd HYGIENE under the flock (§9.2 correction 6) =======
# A "forky" staged payload whose `version --short` double-forks a setsid orphan that
# INHERITS stdout and outlives the exec deadline. Behavior switches on FORKY_MODE:
#   sleep -> no fork; just sleep past a SHORT injected deadline (basic past-deadline abort)
#   exit  -> spawn orphan, then the DIRECT child EXITS  (leg i: WaitDelay must unblock Wait)
#   block -> spawn orphan, signal alive, then BLOCK     (leg ii: parked updater, killed pre-LOCK_UN)
# The client is the K1 curl client; the selected release's archive IS forky, K1-signed,
# so verification passes and the client reaches step 7 (stage + inherited-fd exec).
cat > "$WORK/forky.go" <<'EOF'
package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) < 3 || os.Args[1] != "version" || os.Args[2] != "--short" {
		os.Exit(2)
	}
	// Record our PID so cleanup() can reap the long-lived orphan/parent on bare-host
	// runs (the documented `docker run --rm` reaps them at container exit regardless).
	if pf := os.Getenv("FORKY_PIDS"); pf != "" {
		if f, err := os.OpenFile(pf, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			fmt.Fprintf(f, "%d\n", os.Getpid())
			f.Close()
		}
	}
	mode := os.Getenv("FORKY_MODE")
	alive := os.Getenv("FORKY_ALIVE")
	// Sleeps MUST exceed the harness `timeout 30` wrappers AND leg 5b's 60s injected
	// deadline, so the orphan genuinely "stays alive past the exec deadline" (§9.2) and
	// the rc=124 hang-detectors actually fire on a buggy (no-WaitDelay / no-deadline)
	// impl instead of the payload self-clearing early and masking the bug.
	const hold = 120 * time.Second
	if os.Getenv("FORKY_CHILD") == "1" {
		// We are the double-forked orphan: a NEW SESSION (escaped the updater's
		// kill(-pgid)) still holding the inherited stdout. Signal alive, then outlive
		// the exec window.
		if alive != "" {
			_ = os.WriteFile(alive, []byte("1"), 0o644)
		}
		time.Sleep(hold)
		os.Exit(0)
	}
	if mode == "sleep" {
		time.Sleep(hold) // no fork; the updater's deadline+group-kill must reach this
		os.Exit(0)
	}
	// Spawn the orphan in a new session that inherits our stdout pipe.
	child := exec.Command("/proc/self/exe", "version", "--short")
	child.Env = append(os.Environ(), "FORKY_CHILD=1")
	child.Stdout = os.Stdout // inherit the exec'd stdout -> keeps the updater's io.Copy blocked
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := child.Start(); err != nil {
		os.Exit(3)
	}
	if mode == "block" {
		time.Sleep(hold) // leg ii: park (the harness kills the updater within ~1s of the alive signal)
		os.Exit(0)
	}
	// leg i: print a bogus tag and EXIT; the orphan lives on holding stdout, so the
	// updater's Wait must rely on WaitDelay (a direct-child-only reap would hang).
	fmt.Println("cli-v0.0.0-forky")
	os.Exit(0)
}
EOF
( cd "$WORK" && go mod init forkyhelper >/dev/null 2>&1 && go build -o "$WORK/forky_bin" forky.go )

publish_forky() { # <tag> -- archive member "mathion" IS forky, K1-signed
  d="$SITE/$1"; mkdir -p "$d"
  root="$WORK/forkyroot"; rm -rf "$root"; mkdir -p "$root"
  install -m0755 "$WORK/forky_bin" "$root/mathion"
  tar -C "$root" -czf "$d/$ASSET" mathion
  sha="$(sha256sum "$d/$ASSET" | awk '{print $1}')"
  printf '%s  %s\n' "$sha" "$ASSET" > "$d/checksums.txt"
  gpg --batch --yes --armor --digest-algo SHA256 --local-user "$K1" \
    --detach-sign -o "$d/checksums.txt.asc" "$d/checksums.txt"
}
# A fresh open-file description must be able to LOCK_EX|LOCK_NB the locked parent dir.
lock_free() { flock -n /usr/local/bin -c true; }   # exit 0 = free, 1 = still held
# §9.2: an abort must leave NO staged temp behind (live binary untouched, temp cleaned).
assert_no_temp() { for t in /usr/local/bin/.mathion-selfupdate-*.tmp; do if [ -e "$t" ]; then echo "FAIL($1): staged temp not cleaned up: $t"; exit 1; fi; done; }
export FORKY_PIDS="$WORK/forky_pids"   # forky appends its PID here; cleanup() reaps stragglers

verset '[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.2.0"}]'
publish_forky cli-v0.9.0

# --- LEG 5a: basic bound -- a staged binary that sleeps past a SHORT deadline aborts, no swap.
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
rc=0
FORKY_MODE=sleep MATHION_SELFUPDATE_EXEC_TIMEOUT=1s \
  timeout 30 /usr/local/bin/mathion self-update --yes >/dev/null 2>&1 || rc=$?
[ "$rc" = 124 ] && { echo "FAIL(bound): updater hung past the deadline (group-kill/WaitDelay broken)"; exit 1; }
[ "$rc" = 0 ]   && { echo "FAIL(bound): a past-deadline staged exec must abort self-update"; exit 1; }
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(bound): live binary was swapped to $v"; exit 1; }
lock_free || { echo "FAIL(bound): mutation lock not released after a deadline abort"; exit 1; }
assert_no_temp bound

# --- LEG 5b: fork-orphan (i) -- direct child exits; WaitDelay must unblock Wait + orderly release.
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
rm -f "$WORK/alive_i"
rc=0
FORKY_MODE=exit FORKY_ALIVE="$WORK/alive_i" MATHION_SELFUPDATE_EXEC_TIMEOUT=60s \
  timeout 30 /usr/local/bin/mathion self-update --yes >/dev/null 2>&1 || rc=$?
[ "$rc" = 124 ] && { echo "FAIL(fork-i): Wait hung on the inherited pipe -> WaitDelay did not force-close it"; exit 1; }
[ "$rc" = 0 ]   && { echo "FAIL(fork-i): must abort (forky reports a bogus tag), not swap"; exit 1; }
[ -f "$WORK/alive_i" ] || { echo "FAIL(fork-i): orphan never spawned (WaitDelay path not exercised)"; exit 1; }
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(fork-i): live binary swapped to $v"; exit 1; }
lock_free || { echo "FAIL(fork-i): orderly LOCK_UN did not release the lock"; exit 1; }
assert_no_temp fork-i

# --- LEG 5c: fork-orphan (ii) -- kill the PARKED updater BEFORE its LOCK_UN; O_CLOEXEC must free the lock.
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
rm -f "$WORK/alive_ii"
FORKY_MODE=block FORKY_ALIVE="$WORK/alive_ii" MATHION_SELFUPDATE_EXEC_TIMEOUT=300s \
  /usr/local/bin/mathion self-update --yes >/dev/null 2>&1 &
UPD=$!
# Wait until the orphan signals alive: the updater is now PARKED inside step-7 exec,
# holding the lock, before any swap / LOCK_UN / abort-cleanup.
i=0
while [ ! -f "$WORK/alive_ii" ] && [ "$i" -lt 200 ]; do sleep 0.1; i=$((i + 1)); done
[ -f "$WORK/alive_ii" ] || { echo "FAIL(fork-ii): orphan never signaled alive"; kill -9 "$UPD" 2>/dev/null || true; exit 1; }
kill -9 "$UPD" 2>/dev/null || true; wait "$UPD" 2>/dev/null || true   # SIGKILL before LOCK_UN; wait -> updater fds fully closed (|| true: it may already be gone)
# The lock frees on the updater's death IFF the setsid orphan never inherited the flock
# fd (i.e. it was O_CLOEXEC). A leaked fd keeps the shared-OFD lock held through the
# still-alive orphan, so a fresh-OFD LOCK_EX|LOCK_NB would FAIL.
lock_free || { echo "FAIL(fork-ii): lock still held after killing the updater -> flock fd leaked into the setsid orphan (missing O_CLOEXEC)"; exit 1; }
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(fork-ii): live binary changed to $v"; exit 1; }
rm -f /usr/local/bin/mathion /usr/local/bin/.mathion-selfupdate-*.tmp

echo "self-update integration PASSED (happy + reject + apt-defer + rotation-crossing + staged-exec-bound + fd-hygiene i/ii)"
