#!/usr/bin/env bash
#
# gen-signing-keys.sh — one-time, OFFLINE generation of Mathion's signing keys.
#
# Creates the offline certification-only PRIMARY key plus two signing subkeys —
# S_rel (binary-release / self-update channel) and S_apt (apt channel) — then
# exports, in one sitting, every artifact the go-live procedure needs:
#
#   PUBLIC  -> repo:            mathion-pubkey.asc  (primary + S_rel only)
#                              mathion-apt-keyring.asc (primary + S_apt only)
#   SECRET  -> GitHub secrets:  s_rel.private.asc   (GPG_S_REL_PRIVATE)
#                              s_apt.private.asc   (GPG_S_APT_PRIVATE)
#   OFFLINE -> encrypted media: primary-secret.asc  (root of trust — never commit)
#                              primary.rev         (revocation certificate)
#   REFERENCE:                 FINGERPRINTS.txt    (public — safe to share)
#
# This implements deploy/keys/README.md sections 1-4. Read that document first;
# this script is its executable form, with the same safety checks inline.
#
# ── SAFETY CONTRACT ──────────────────────────────────────────────────────────
#   * Run on an OFFLINE machine. The primary secret must never touch a network.
#   * The primary secret is the ROOT OF TRUST: if you lose it you can never
#     rotate or revoke again. It is backed up and the backup is re-import-verified
#     BEFORE this script finishes, but the script never deletes it for you.
#   * Nothing here is committed and no secret is ever printed to the terminal.
#   * The generation keyring is an isolated temp $GNUPGHOME, never your own.
#
# Usage:   bash deploy/keys/gen-signing-keys.sh [OUTPUT_DIR]
#          (OUTPUT_DIR defaults to ./mathion-signing-out; must be empty/new)
# Env:     KEY_UID        (default "Mathion Release Signing <svkucheryavski@gmail.com>")
#          SUBKEY_EXPIRY  (default 2y)
#
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
KEY_UID="${KEY_UID:-Mathion Release Signing <svkucheryavski@gmail.com>}"
SUBKEY_EXPIRY="${SUBKEY_EXPIRY:-2y}"
OUTDIR="${1:-./mathion-signing-out}"

die() { echo "ERROR: $*" >&2; exit 1; }

command -v gpg >/dev/null 2>&1 || die "gpg not found — install GnuPG (e.g. 'brew install gnupg')."
GPG_VERSION="$(gpg --version | awk 'NR==1{print $NF}')"
echo "Using $(command -v gpg) (version $GPG_VERSION)"

# ── Refuse to clobber an existing output directory ───────────────────────────
if [ -e "$OUTDIR" ] && [ -n "$(ls -A "$OUTDIR" 2>/dev/null || true)" ]; then
  die "output dir '$OUTDIR' exists and is not empty — choose a fresh path so nothing is overwritten."
fi
mkdir -p "$OUTDIR"
# Sensitive material is written here; keep it owner-only from the start.
chmod 700 "$OUTDIR"
OUTDIR="$(cd "$OUTDIR" && pwd -P)"    # absolute, so 'cd' later can't confuse paths

# ── Offline confirmation (soft heads-up + hard gate) ─────────────────────────
cat <<'BANNER'

────────────────────────────────────────────────────────────────────────────
  You are about to generate Mathion's OFFLINE root-of-trust signing key.
  Before continuing:
    • Disconnect this machine from all networks (Wi-Fi and Ethernet OFF).
    • Make sure the disk is encrypted.
    • Have an encrypted USB stick ready for the offline backup.
────────────────────────────────────────────────────────────────────────────

BANNER
printf 'Type the word "offline" to confirm this machine is disconnected: '
read -r _confirm
[ "$_confirm" = "offline" ] || die "not confirmed offline — aborting."

# ── Isolated generation keyring + passphrase file ────────────────────────────
# A disposable $GNUPGHOME keeps this entirely separate from your personal keyring.
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
THROWAWAY_HOMES=()   # verification keyrings, cleaned up on exit

cleanup() {
  # Shred the passphrase file and every throwaway keyring. The generation
  # $GNUPGHOME and $OUTDIR are intentionally LEFT for the user to move + wipe.
  if [ -n "${PPFILE:-}" ]; then rm -f "$PPFILE" 2>/dev/null || true; fi
  for h in "${THROWAWAY_HOMES[@]:-}"; do
    if [ -n "$h" ]; then rm -rf "$h" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT

# Read the passphrase twice (never echoed) and store it in a mode-600 file so it
# is passed to gpg via --passphrase-file (never on the argv, where 'ps' sees it).
printf 'New signing-key passphrase (used for the offline backup AND the CI GPG_PASSPHRASE secret): '
read -rs PP1; echo
printf 'Confirm passphrase: '
read -rs PP2; echo
[ -n "$PP1" ] || die "empty passphrase — choose a strong one."
[ "$PP1" = "$PP2" ] || die "passphrases did not match."
PPFILE="$GNUPGHOME/passphrase"; ( umask 077; printf '%s' "$PP1" > "$PPFILE" )
unset PP1 PP2

# All secret-key operations run through this base invocation.
GPG_SECRET=(gpg --batch --pinentry-mode loopback --passphrase-file "$PPFILE")

# ── 1. Primary (certification-only, no expiry) + two signing subkeys ──────────
echo
echo "==> Generating certification-only primary key ..."
"${GPG_SECRET[@]}" --quick-generate-key "$KEY_UID" ed25519 cert never

PRIMARY_FPR="$(gpg --list-keys --with-colons | awk -F: '/^fpr:/{print $10; exit}')"
[ -n "$PRIMARY_FPR" ] || die "could not read primary fingerprint after generation."
echo "    primary fpr: $PRIMARY_FPR"

echo "==> Adding S_rel signing subkey (release / self-update, expiry $SUBKEY_EXPIRY) ..."
"${GPG_SECRET[@]}" --quick-add-key "$PRIMARY_FPR" ed25519 sign "$SUBKEY_EXPIRY"
echo "==> Adding S_apt signing subkey (apt, expiry $SUBKEY_EXPIRY) ..."
"${GPG_SECRET[@]}" --quick-add-key "$PRIMARY_FPR" ed25519 sign "$SUBKEY_EXPIRY"

# Subkey fingerprints, in creation order: first added = S_rel, second = S_apt.
SUBS="$(gpg --with-colons --with-subkey-fingerprint --list-keys "$PRIMARY_FPR" \
        | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; s=0}')"
S_REL_FPR="$(printf '%s\n' "$SUBS" | sed -n '1p')"
S_APT_FPR="$(printf '%s\n' "$SUBS" | sed -n '2p')"
[ "$(printf '%s\n' "$SUBS" | grep -c .)" = 2 ] || die "expected exactly two signing subkeys, got: [$SUBS]"
{ [ -n "$S_REL_FPR" ] && [ -n "$S_APT_FPR" ]; } || die "could not read both subkey fingerprints."
echo "    S_rel fpr:   $S_REL_FPR  (first subkey added — release / self-update)"
echo "    S_apt fpr:   $S_APT_FPR  (second subkey added — apt)"

# ── 2. Revocation certificate for the primary ────────────────────────────────
echo "==> Recording the primary revocation certificate ..."
# GnuPG 2.1+ auto-generates a revocation certificate at key-creation time under
# $GNUPGHOME/openpgp-revocs.d/<FPR>.rev. Use it directly — that is robust and
# scripting-safe, unlike driving the interactive --gen-revoke prompt.
AUTO_REV="$GNUPGHOME/openpgp-revocs.d/${PRIMARY_FPR}.rev"
if [ -s "$AUTO_REV" ]; then
  cp "$AUTO_REV" "$OUTDIR/primary.rev"
else
  die "no auto-generated revocation cert at $AUTO_REV (GnuPG < 2.1?) — generate one manually with: gpg --output primary.rev --gen-revoke $PRIMARY_FPR"
fi
[ -s "$OUTDIR/primary.rev" ] || die "primary.rev is empty."

# ── 3. Back up the FULL primary secret, then VERIFY it re-imports ─────────────
echo "==> Exporting + verifying the offline primary-secret backup ..."
"${GPG_SECRET[@]}" --armor --export-secret-keys "$PRIMARY_FPR" > "$OUTDIR/primary-secret.asc"
[ -s "$OUTDIR/primary-secret.asc" ] || die "primary-secret.asc is empty."
VH="$(mktemp -d)"; THROWAWAY_HOMES+=("$VH")
# Importing a SECRET key contacts the agent, so it needs loopback + the passphrase
# (a bare 'gpg --import' fails headless with "Inappropriate ioctl for device").
if ! { "${GPG_SECRET[@]}" --homedir "$VH" --import "$OUTDIR/primary-secret.asc" >/dev/null 2>&1 \
       && gpg --homedir "$VH" --list-secret-keys "$PRIMARY_FPR" >/dev/null 2>&1; }; then
  die "primary-secret backup did NOT re-import — do not trust it; investigate before wiping anything."
fi
echo "    primary-secret backup re-import: OK"

# ── 4. Export the two TRIMMED public keyrings (channel separation) ────────────
echo "==> Exporting trimmed public keyrings ..."
gpg --armor --export "${PRIMARY_FPR}!" "${S_REL_FPR}!" > "$OUTDIR/mathion-pubkey.asc"
gpg --armor --export "${PRIMARY_FPR}!" "${S_APT_FPR}!" > "$OUTDIR/mathion-apt-keyring.asc"

# Assert: primary + EXACTLY ONE signing subkey, and it is the CORRECT channel's
# fingerprint (a count-only check would miss a fpr typo shipping the wrong subkey).
check_one_sub() {  # $1 = keyring file, $2 = expected signing-subkey fpr, $3 = label
  local h subs
  h="$(mktemp -d)"; THROWAWAY_HOMES+=("$h")
  gpg --homedir "$h" --import "$1" >/dev/null 2>&1 || die "$3: $1 is not a parseable keyring."
  subs="$(gpg --homedir "$h" --with-colons --with-subkey-fingerprint --list-keys \
          | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; s=0}')"
  [ "$(printf '%s\n' "$subs" | grep -c .)" = 1 ] || die "$3: $1 must hold exactly one subkey, got [$subs]"
  [ "$subs" = "$2" ] || die "$3: $1 subkey $subs != expected $2 (wrong channel — fpr typo?)"
  echo "    OK $3: primary + $2 only"
}
check_one_sub "$OUTDIR/mathion-pubkey.asc"      "$S_REL_FPR" "S_rel public keyring"
check_one_sub "$OUTDIR/mathion-apt-keyring.asc" "$S_APT_FPR" "S_apt public keyring"

# ── 5. Export the two PRIVATE signing subkeys (for CI), asserting one ssb each ─
echo "==> Exporting per-channel private signing subkeys (for GitHub secrets) ..."
# The trailing '!' exports ONLY that subkey's secret; without it gpg exports
# EVERY subkey secret and leaks both channels' signing power into one file.
"${GPG_SECRET[@]}" --armor --export-secret-subkeys "${S_REL_FPR}!" > "$OUTDIR/s_rel.private.asc"
"${GPG_SECRET[@]}" --armor --export-secret-subkeys "${S_APT_FPR}!" > "$OUTDIR/s_apt.private.asc"

assert_one_ssb() {  # $1 = private export file, $2 = expected subkey fpr, $3 = label
  local h n ssbfpr
  h="$(mktemp -d)"; THROWAWAY_HOMES+=("$h")
  # Secret-subkey import needs loopback + passphrase (see the primary re-import note).
  "${GPG_SECRET[@]}" --homedir "$h" --import "$1" >/dev/null 2>&1 || die "$3: $1 did not import."
  n="$(gpg --homedir "$h" --with-colons --list-secret-keys | grep -c '^ssb:' || true)"
  [ "$n" = 1 ] || die "$3: $1 must contain exactly one secret subkey (ssb), found $n."
  # Confirm the one ssb is the expected fingerprint (not the wrong channel).
  ssbfpr="$(gpg --homedir "$h" --with-colons --with-subkey-fingerprint --list-secret-keys \
            | awk -F: '$1=="ssb"{s=1;next} s&&$1=="fpr"{print $10; s=0}')"
  [ "$ssbfpr" = "$2" ] || die "$3: $1 ssb $ssbfpr != expected $2."
  echo "    OK $3: exactly one ssb = $2"
}
assert_one_ssb "$OUTDIR/s_rel.private.asc" "$S_REL_FPR" "S_rel private subkey"
assert_one_ssb "$OUTDIR/s_apt.private.asc" "$S_APT_FPR" "S_apt private subkey"

# ── 6. Record the fingerprints (public — safe to share) ──────────────────────
cat > "$OUTDIR/FINGERPRINTS.txt" <<EOF
Mathion signing key fingerprints (PUBLIC — safe to publish out of band)
Generated for UID: $KEY_UID

EXPECTED_PRIMARY_FPR = $PRIMARY_FPR
S_REL_FPR            = $S_REL_FPR   # release / self-update subkey
S_APT_FPR            = $S_APT_FPR   # apt subkey
EOF
chmod 600 "$OUTDIR"/*.asc "$OUTDIR"/*.rev "$OUTDIR"/FINGERPRINTS.txt

# ── Done: print the exact next steps ─────────────────────────────────────────
cat <<EOF

════════════════════════════════════════════════════════════════════════════
  KEY GENERATION COMPLETE — all checks passed.
  Output directory: $OUTDIR

  Fingerprints (PUBLIC):
    EXPECTED_PRIMARY_FPR = $PRIMARY_FPR
    S_REL_FPR            = $S_REL_FPR
    S_APT_FPR            = $S_APT_FPR

  NEXT STEPS (do these deliberately):

  A) OFFLINE BACKUP — move to an ENCRYPTED USB stick, then delete from this disk:
       $OUTDIR/primary-secret.asc     (root of trust — NEVER commit)
       $OUTDIR/primary.rev            (revocation certificate)
     Store the passphrase SEPARATELY (a password manager). Losing the primary
     secret is unrecoverable.

  B) GITHUB SECRETS — repo Settings > Secrets and variables > Actions > Secrets:
       GPG_S_REL_PRIVATE  <- contents of $OUTDIR/s_rel.private.asc
       GPG_S_APT_PRIVATE  <- contents of $OUTDIR/s_apt.private.asc
       GPG_PASSPHRASE     <- the passphrase you just chose
     Then delete s_rel.private.asc and s_apt.private.asc from this disk.

  C) GITHUB VARIABLES (item 2) — same page, Variables tab:
       S_REL_FPR = $S_REL_FPR
       S_APT_FPR = $S_APT_FPR

  D) REPO PUBLIC FILES (item 1, on your normal machine) — copy in and commit:
       cp $OUTDIR/mathion-pubkey.asc      deploy/keys/mathion-pubkey.asc
       cp $OUTDIR/mathion-apt-keyring.asc deploy/keys/mathion-apt-keyring.asc
       cp deploy/keys/mathion-pubkey.asc  cli/internal/selfupdate/mathion-pubkey.asc
     Then edit deploy/install.sh:
       EXPECTED_PRIMARY_FPR="$PRIMARY_FPR"
       EXPECTED_SIGNING_FPR="$S_REL_FPR"
       mathion_embedded_key()  <- paste the SAME block as deploy/keys/mathion-pubkey.asc

  E) CLEAN UP this offline session once A + B are safely stored:
       rm -rf "$OUTDIR" "$GNUPGHOME"

════════════════════════════════════════════════════════════════════════════
EOF
