#!/usr/bin/env bash
#
# gen-signing-keys.sh — one-time, OFFLINE generation of Mathion's signing keys.
#
# Creates the offline certification-only PRIMARY key plus two signing subkeys —
# S_rel (binary-release / self-update channel) and S_apt (apt channel) — then
# exports, in one sitting, every artifact the go-live procedure needs:
#
#   PUBLIC   -> repo:            mathion-pubkey.asc  (primary + S_rel only)
#                               mathion-apt-keyring.asc (primary + S_apt only)
#   SECRET   -> GitHub secrets:  s_rel.private.asc   (GPG_S_REL_PRIVATE)
#                               s_apt.private.asc   (GPG_S_APT_PRIVATE)
#   OFFLINE  -> encrypted media: primary-secret.asc.gpg (root of trust; symmetric-
#                               wrapped with an INDEPENDENT backup passphrase)
#                               primary.rev         (revocation certificate)
#   REFERENCE:                  FINGERPRINTS.txt    (public — safe to share)
#
# Two DISTINCT passphrases are used (channel-separation for secrets):
#   * KEY passphrase    — protects the signing key + the CI subkey exports; becomes
#                         the GitHub GPG_PASSPHRASE secret. Lives (encrypted) in CI.
#   * BACKUP passphrase — a SECOND, independent layer around the offline primary
#                         backup only. Never goes to CI, so a CI-secret leak alone
#                         can never open the offline root of trust.
#
# This implements deploy/keys/README.md sections 1-4. Read that document first;
# this script is its executable form, with the same safety checks inline.
#
# ── SAFETY CONTRACT ──────────────────────────────────────────────────────────
#   * Run on an OFFLINE machine. The primary secret must never touch a network.
#     Do ALL of Phase 1 (below) offline; only Phase 2 happens on a networked host.
#   * The primary secret is the ROOT OF TRUST: if you lose it you can never rotate
#     or revoke again. Its backup is decrypt+import+usability-verified before the
#     script finishes; you then copy it to encrypted media and wipe this host.
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
    • Have at least TWO independently-encrypted backup media ready.
    • Choose TWO different passphrases (key vs. backup — see prompts).
────────────────────────────────────────────────────────────────────────────

BANNER
printf 'Type the word "offline" to confirm this machine is disconnected: '
read -r _confirm
[ "$_confirm" = "offline" ] || die "not confirmed offline — aborting."

# ── Isolated generation keyring + passphrase files ───────────────────────────
# A disposable $GNUPGHOME keeps this entirely separate from your personal keyring.
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
THROWAWAY_HOMES=()   # verification keyrings, cleaned up on exit

cleanup() {
  # Remove the passphrase files and every throwaway keyring. (Unlink only —
  # reliable shredding is not available on modern SSD/copy-on-write storage.)
  # The generation $GNUPGHOME and $OUTDIR are intentionally LEFT for the user to
  # copy to media and then wipe (Phase 1, step D).
  if [ -n "${PPFILE:-}" ]; then rm -f "$PPFILE" 2>/dev/null || true; fi
  if [ -n "${BPFILE:-}" ]; then rm -f "$BPFILE" 2>/dev/null || true; fi
  for h in "${THROWAWAY_HOMES[@]:-}"; do
    if [ -n "$h" ]; then rm -rf "$h" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT

# Read TWO distinct passphrases (never echoed) into mode-600 files, so each is
# passed to gpg via --passphrase-file (never on the argv, where 'ps' sees it).
printf 'Choose the KEY passphrase (protects the signing key; becomes the CI GPG_PASSPHRASE secret): '
read -rs KP1; echo
printf 'Confirm KEY passphrase: '
read -rs KP2; echo
[ -n "$KP1" ] || die "empty key passphrase — choose a strong one."
[ "$KP1" = "$KP2" ] || die "key passphrases did not match."

printf 'Choose a DIFFERENT BACKUP passphrase (offline root-of-trust only; never goes to CI): '
read -rs BK1; echo
printf 'Confirm BACKUP passphrase: '
read -rs BK2; echo
[ -n "$BK1" ] || die "empty backup passphrase — choose a strong one."
[ "$BK1" = "$BK2" ] || die "backup passphrases did not match."
[ "$KP1" != "$BK1" ] || die "the backup passphrase must DIFFER from the key passphrase (that separation is the point)."

PPFILE="$GNUPGHOME/kp"; ( umask 077; printf '%s' "$KP1" > "$PPFILE" )
BPFILE="$GNUPGHOME/bp"; ( umask 077; printf '%s' "$BK1" > "$BPFILE" )
unset KP1 KP2 BK1 BK2

# All KEY-passphrase secret operations run through this base invocation.
GPG_SECRET=(gpg --batch --pinentry-mode loopback --passphrase-file "$PPFILE")

# ── 1. Primary (certification-only, no expiry) + two signing subkeys ──────────
echo
echo "==> Generating certification-only primary key ..."
"${GPG_SECRET[@]}" --quick-generate-key "$KEY_UID" ed25519 cert never

PRIMARY_FPR="$(gpg --list-keys --with-colons | awk -F: '/^fpr:/{print $10; exit}')"
[ -n "$PRIMARY_FPR" ] || die "could not read primary fingerprint after generation."
echo "    primary fpr: $PRIMARY_FPR"

# Bind each subkey to its channel by the KEY_CREATED status of ITS OWN add, not by
# list position (colon-record order is not a documented GnuPG contract).
echo "==> Adding S_rel signing subkey (release / self-update, expiry $SUBKEY_EXPIRY) ..."
S_REL_FPR="$("${GPG_SECRET[@]}" --status-fd 1 --quick-add-key "$PRIMARY_FPR" ed25519 sign "$SUBKEY_EXPIRY" 2>/dev/null \
             | awk '$2=="KEY_CREATED"{print $4; exit}')"
[ -n "$S_REL_FPR" ] || die "could not capture S_rel subkey fpr from KEY_CREATED status."
echo "==> Adding S_apt signing subkey (apt, expiry $SUBKEY_EXPIRY) ..."
S_APT_FPR="$("${GPG_SECRET[@]}" --status-fd 1 --quick-add-key "$PRIMARY_FPR" ed25519 sign "$SUBKEY_EXPIRY" 2>/dev/null \
             | awk '$2=="KEY_CREATED"{print $4; exit}')"
[ -n "$S_APT_FPR" ] || die "could not capture S_apt subkey fpr from KEY_CREATED status."
[ "$S_REL_FPR" != "$S_APT_FPR" ] || die "S_rel and S_apt fingerprints are identical — aborting."
echo "    S_rel fpr:   $S_REL_FPR  (release / self-update)"
echo "    S_apt fpr:   $S_APT_FPR  (apt)"

# ── 2. Revocation certificate for the primary ────────────────────────────────
echo "==> Recording the primary revocation certificate ..."
# GnuPG 2.1+ auto-generates a revocation certificate at key-creation time under
# $GNUPGHOME/openpgp-revocs.d/<FPR>.rev (robust + scripting-safe, unlike driving the
# interactive --gen-revoke prompt). That file carries explanatory prose and a ':'
# guard before the armor; strip both so primary.rev is a CLEAN, directly-importable
# certificate (equivalent to an explicit `gpg --gen-revoke --output`).
AUTO_REV="$GNUPGHOME/openpgp-revocs.d/${PRIMARY_FPR}.rev"
if [ -s "$AUTO_REV" ]; then
  awk '/-----BEGIN PGP/{p=1} p' "$AUTO_REV" | sed '1s/^://' > "$OUTDIR/primary.rev"
else
  die "no auto-generated revocation cert at $AUTO_REV (GnuPG < 2.1?) — generate one manually with: gpg --output primary.rev --gen-revoke $PRIMARY_FPR"
fi
[ -s "$OUTDIR/primary.rev" ] || die "primary.rev is empty."
head -n1 "$OUTDIR/primary.rev" | grep -q '^-----BEGIN PGP' || die "primary.rev is not a clean armored certificate."

# ── 3. Back up the primary secret under an INDEPENDENT backup passphrase ──────
echo "==> Exporting + wrapping + verifying the offline primary-secret backup ..."
# Export the full primary secret (protected by the KEY passphrase), then add a
# SECOND symmetric layer with the BACKUP passphrase and keep ONLY the wrapped file.
"${GPG_SECRET[@]}" --armor --export-secret-keys "$PRIMARY_FPR" > "$OUTDIR/primary-secret.asc"
[ -s "$OUTDIR/primary-secret.asc" ] || die "primary-secret.asc is empty."
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BPFILE" \
    --cipher-algo AES256 --symmetric --output "$OUTDIR/primary-secret.asc.gpg" "$OUTDIR/primary-secret.asc"
[ -s "$OUTDIR/primary-secret.asc.gpg" ] || die "wrapped primary backup is empty."
rm -f "$OUTDIR/primary-secret.asc"   # keep ONLY the backup-passphrase-wrapped copy

# Prove the wrapped backup decrypts (BACKUP passphrase), re-imports (KEY passphrase),
# and yields a USABLE primary (sec field 15 '+', not a stub) with both subkeys.
VH="$(mktemp -d)"; THROWAWAY_HOMES+=("$VH")
if ! { gpg --batch --pinentry-mode loopback --passphrase-file "$BPFILE" --decrypt "$OUTDIR/primary-secret.asc.gpg" 2>/dev/null \
       | "${GPG_SECRET[@]}" --homedir "$VH" --import >/dev/null 2>&1; }; then
  die "wrapped primary backup did NOT decrypt+import — do not trust it; investigate before wiping anything."
fi
secline="$(gpg --homedir "$VH" --with-colons --list-secret-keys "$PRIMARY_FPR" 2>/dev/null || true)"
secavail="$(printf '%s\n' "$secline" | awk -F: '$1=="sec"{print $15; exit}')"
[ "$secavail" = "+" ] || die "restored primary secret is not usable (sec field 15 = '$secavail', expected '+')."
nssb="$(printf '%s\n' "$secline" | grep -c '^ssb:' || true)"
[ "$nssb" = 2 ] || die "restored key has $nssb secret subkeys, expected 2."
echo "    primary-secret backup: decrypt + import + usable OK (primary present, 2 subkeys)"

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
chmod 600 "$OUTDIR"/*   # owner-only for every artifact

# ── Done: print the exact next steps (OFFLINE phase, then ONLINE phase) ───────
cat <<EOF

════════════════════════════════════════════════════════════════════════════
  KEY GENERATION COMPLETE — all checks passed.
  Output directory: $OUTDIR

  Fingerprints (PUBLIC):
    EXPECTED_PRIMARY_FPR = $PRIMARY_FPR
    S_REL_FPR            = $S_REL_FPR
    S_APT_FPR            = $S_APT_FPR

  ══ PHASE 1 — do ALL of this while STILL OFFLINE ══════════════════════════

  A) ROOT-OF-TRUST BACKUP — copy to at least TWO independently-encrypted media
     (ideally kept in separate locations); this never goes online or to CI:
       $OUTDIR/primary-secret.asc.gpg   (wrapped with the BACKUP passphrase)
       $OUTDIR/primary.rev              (revocation cert — clean, imports as-is)
     Store the KEY and BACKUP passphrases SEPARATELY (a password manager), and
     record which is which. Losing the primary backup is unrecoverable.

  B) TRANSFER MEDIA — copy these onto SEPARATE encrypted media to carry to a
     networked machine in Phase 2 (no primary secret among them):
       $OUTDIR/s_rel.private.asc  $OUTDIR/s_apt.private.asc
       $OUTDIR/mathion-pubkey.asc  $OUTDIR/mathion-apt-keyring.asc
       $OUTDIR/FINGERPRINTS.txt

  C) VERIFY the copies from the ACTUAL media (not from this disk).

  D) WIPE this host, THEN reconnect / power off — the primary is still live here
     until you do:
       gpgconf --homedir "$GNUPGHOME" --kill gpg-agent 2>/dev/null || true
       rm -rf "$OUTDIR" "$GNUPGHOME"

  ══ PHASE 2 — on a DIFFERENT, networked machine (no primary secret here) ═══

  E) GITHUB SECRETS — repo Settings > Secrets and variables > Actions > Secrets:
       GPG_S_REL_PRIVATE  <- contents of s_rel.private.asc
       GPG_S_APT_PRIVATE  <- contents of s_apt.private.asc
       GPG_PASSPHRASE     <- the KEY passphrase (NOT the backup passphrase)

  F) GITHUB VARIABLES — same page, Variables tab (item 2):
       S_REL_FPR = $S_REL_FPR
       S_APT_FPR = $S_APT_FPR

  G) REPO PUBLIC FILES (item 1) — copy in and commit:
       cp mathion-pubkey.asc       deploy/keys/mathion-pubkey.asc
       cp mathion-apt-keyring.asc  deploy/keys/mathion-apt-keyring.asc
       cp deploy/keys/mathion-pubkey.asc  cli/internal/selfupdate/mathion-pubkey.asc
     Then edit deploy/install.sh:
       EXPECTED_PRIMARY_FPR="$PRIMARY_FPR"
       EXPECTED_SIGNING_FPR="$S_REL_FPR"
       mathion_embedded_key()  <- paste the SAME block as deploy/keys/mathion-pubkey.asc

  H) Publish EXPECTED_PRIMARY_FPR out of band (website / signed announcement) so
     users can independently verify the keyring they received.

  I) Before the FIRST signed release: confirm the apt-publish prerequisites exist
     (a gh-pages branch + the PAGES_DEPLOY_TOKEN secret), and add the guard to
     release-cli.yml (item 3). Delete the transfer-media private exports once
     they are in GitHub secrets.

════════════════════════════════════════════════════════════════════════════
EOF
