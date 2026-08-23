# Mathion signing keys

This directory holds the **public** keyring placeholders that ship with the
project. The real key material is generated once, offline, by the maintainer
and never committed. This document is the authoritative procedure for
generating, exporting, recording, rotating, and revoking those keys
(spec §6.1 key model, §11.1 CI secrets, §14 rotation/revocation).

The two `.asc` files in this directory are **placeholders** until the manual
key prereq replaces them:

| File | Contents | Consumed by |
| --- | --- | --- |
| `mathion-pubkey.asc` | primary **+ `S_rel` only** | embedded in `deploy/install.sh` and compiled into the 4b self-update binary; verifies `checksums.txt` |
| `mathion-apt-keyring.asc` | primary **+ `S_apt` only** | CI dearmors it to the published `mathion-archive-keyring.gpg`; the apt setup / `.deb` installs that keyring to `/usr/share/keyrings/` on the client, where `signed-by=` enforces `S_apt` on the apt repo |

**Channel separation is the whole point:** the binary-download channel
(`S_rel`) and the apt channel (`S_apt`) are signed by *different* subkeys of
the *same* offline primary. A compromise of one channel's signing subkey
never grants signing power over the other, and neither subkey can certify a
new key — only the offline primary can.

---

## 1. Generate the offline primary + two signing subkeys

Do this on an air-gapped (or at minimum offline, freshly-booted) machine. The
primary key is **certification-only** (`SC` is avoided — use cert-only `C`);
it signs nothing but the subkeys and stays offline forever.

> **Fastest path:** `bash deploy/keys/gen-signing-keys.sh` runs every step in
> §§1–4 with these safety checks inline, prompting for the two passphrases
> introduced below. The manual commands here document what it does (for auditing
> and rotation).

The procedure uses **two DISTINCT passphrases** (never reuse one for the other):

- **KEY** — protects the key material and the CI subkey exports (becomes the
  `GPG_PASSPHRASE` CI secret).
- **BACKUP** — an independent outer layer on the offline primary backup only, so a
  leak of the CI KEY passphrase alone can never open the offline root of trust.

```bash
export GNUPGHOME="$(mktemp -d)"        # generation keyring — disposable ONLY after
                                       # primary-secret.asc.gpg + primary.rev are
                                       # backed up offline (see the backup step below)
chmod 700 "$GNUPGHOME"

# Keep the KEY passphrase in a mode-600 file so it never lands on the command line.
kp="$GNUPGHOME/kp"; (umask 077; printf '%s' 'CHOOSE-A-KEY-PASSPHRASE' > "$kp")

# Primary: certification-only, no expiry on the primary itself.
gpg --batch --pinentry-mode loopback --passphrase-file "$kp" --quick-generate-key \
    "Mathion Release Signing <svkucheryavski@gmail.com>" \
    ed25519 cert never

PRIMARY_FPR="$(gpg --list-keys --with-colons | awk -F: '/^fpr:/{print $10; exit}')"

# S_rel — signs binary release artifacts (checksums.txt). Set an expiry.
gpg --batch --pinentry-mode loopback --passphrase-file "$kp" --quick-add-key "$PRIMARY_FPR" ed25519 sign 2y
# S_apt — signs the apt Release file. Set an expiry.
gpg --batch --pinentry-mode loopback --passphrase-file "$kp" --quick-add-key "$PRIMARY_FPR" ed25519 sign 2y
```

Record the two subkey fingerprints (the second and third `fpr` lines under the
primary). Throughout this document:

- `<primary-fpr>` = `PRIMARY_FPR`
- `<S_rel-fpr>` = fingerprint of the release-signing subkey
- `<S_apt-fpr>` = fingerprint of the apt-signing subkey

Generate and **store offline** a revocation certificate for the primary:

```bash
gpg --output primary.rev --gen-revoke "$PRIMARY_FPR"   # keep offline, never commit
```

Now back up the primary secret to encrypted, air-gapped media **before** the
generation homedir is discarded. This is the root of trust: without the primary
secret you can never rotate a subkey or revoke anything again, so losing it is
unrecoverable. Export it (KEY-passphrase protected), then add an **independent
outer layer** with the BACKUP passphrase; keep only the wrapped `.gpg`, and verify
it decrypts + re-imports into a fresh `--homedir` before wiping `$GNUPGHOME`:

```bash
# Keep the BACKUP passphrase (distinct from KEY) in its own mode-600 file.
bp="$GNUPGHOME/bp"; (umask 077; printf '%s' 'CHOOSE-A-DIFFERENT-BACKUP-PASSPHRASE' > "$bp")

# Export the FULL primary secret (KEY-passphrase protected) ...
gpg --batch --pinentry-mode loopback --passphrase-file "$kp" \
    --armor --export-secret-keys "$PRIMARY_FPR" > primary-secret.asc
# ... then wrap it in an INDEPENDENT symmetric (BACKUP-passphrase) layer and keep
# ONLY the wrapped file. NEVER commit either file.
gpg --batch --pinentry-mode loopback --passphrase-file "$bp" \
    --cipher-algo AES256 --symmetric --output primary-secret.asc.gpg primary-secret.asc
rm -f primary-secret.asc

# Confirm it decrypts (BACKUP) and re-imports + is usable (KEY) before wiping:
h="$(mktemp -d)"
gpg --batch --pinentry-mode loopback --passphrase-file "$bp" --decrypt primary-secret.asc.gpg \
  | gpg --homedir "$h" --batch --pinentry-mode loopback --passphrase-file "$kp" --import
gpg --homedir "$h" --list-secret-keys "$PRIMARY_FPR" >/dev/null && echo "primary backup OK"
rm -rf "$h"
```

Store `primary-secret.asc.gpg` and `primary.rev` on encrypted, air-gapped media
(keep at least two independent copies) — never in the repository. Store the KEY and
BACKUP passphrases **separately** — from the media and from each other. The
generation homedir may be wiped only once both files exist and the
decrypt + re-import check above has passed.

---

## 2. Export the two trimmed PUBLIC keyrings (channel separation)

In the **steady state**, each shipped public keyring must contain the primary
**and exactly one** signing subkey. "Exactly one" is the steady-state
invariant; the single documented exception is a transient two-`S_apt`-subkey
`mathion-apt-keyring.asc` during an apt rotation grace window (see "During an
S_apt rotation grace window" below and §5). Use per-subkey export syntax
(`<fpr>!`) so only the named subkey is included.

```bash
# mathion-pubkey.asc  = primary + S_rel  (install.sh + 4b binary)
gpg --armor --export "<primary-fpr>!" "<S_rel-fpr>!" > mathion-pubkey.asc

# mathion-apt-keyring.asc = primary + S_apt  (CI -> apt keyring)
gpg --armor --export "<primary-fpr>!" "<S_apt-fpr>!" > mathion-apt-keyring.asc
```

Verify each keyring imports to the primary + **exactly one** signing subkey
**and that the one subkey is the CORRECT channel's fingerprint** before
committing it — a count-only check would pass even if a maintainer fpr typo
shipped the wrong channel's subkey (a stray `sub` from the wrong channel breaks
separation):

```bash
check_one_sub() {  # $1 = keyring file, $2 = expected signing-subkey fpr
  h="$(mktemp -d)"; gpg --homedir "$h" --import "$1" >/dev/null 2>&1
  subs="$(gpg --homedir "$h" --with-colons --list-keys \
          | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; s=0}')"
  rm -rf "$h"
  [ "$(printf '%s\n' "$subs" | grep -c .)" = 1 ] || { echo "FAIL $1: not exactly one subkey"; return 1; }
  [ "$subs" = "$2" ] || { echo "FAIL $1: subkey $subs != expected $2"; return 1; }
  echo "OK $1: primary + $2 only"
}
check_one_sub mathion-pubkey.asc      "<S_rel-fpr>"
check_one_sub mathion-apt-keyring.asc "<S_apt-fpr>"
```

`mathion-pubkey.asc` (the `S_rel` channel) is **never** in overlap — `install.sh`
is fetched fresh, so it is always primary + exactly one subkey and is always
validated by `check_one_sub`. The two-subkey exception below applies to the apt
keyring **only**, transiently, during a documented §5 grace window.

### During an S_apt rotation grace window (see §5)

For the keyring-first `S_apt` rotation in §5, `mathion-apt-keyring.asc` must
**temporarily** carry the primary + **both** the outgoing and incoming `S_apt`
subkeys. Export and validate it against exactly that two-subkey set (not
`check_one_sub`, which would correctly FAIL a two-subkey keyring):

```bash
# OVERLAP export — S_apt rotation grace window ONLY: primary + BOTH S_apt subkeys.
gpg --armor --export "<primary-fpr>!" "<outgoing-S_apt-fpr>!" "<incoming-S_apt-fpr>!" \
    > mathion-apt-keyring.asc

# OVERLAP validation: must be primary + EXACTLY the outgoing and incoming S_apt subkeys.
h="$(mktemp -d)"; gpg --homedir "$h" --import mathion-apt-keyring.asc >/dev/null 2>&1
got="$(gpg --homedir "$h" --with-colons --list-keys \
        | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; s=0}' | sort | tr '\n' ' ')"
rm -rf "$h"
want="$(printf '%s\n' "<outgoing-S_apt-fpr>" "<incoming-S_apt-fpr>" | sort | tr '\n' ' ')"
[ "$got" = "$want" ] || { echo "FAIL: overlap keyring subs [$got] != [$want]"; exit 1; }
echo "OK: apt overlap keyring = primary + {outgoing, incoming} S_apt"
```

Once the grace window closes and a later `.deb` prunes the outgoing subkey, the
keyring returns to primary + exactly one `S_apt` and is validated again by
`check_one_sub`.

Commit the two replaced `.asc` files. These are the only key files that ever
enter the repository.

---

## 3. Export the PRIVATE signing subkeys for CI secrets

CI needs the **secret** half of each signing subkey — and *only* that subkey.
The trailing `!` after the fingerprint exports **only that subkey's secret**;
a bare `gpg --armor --export-secret-subkeys <primary>` (no `!`) would export
**every** subkey's secret and leak BOTH channels' signing power into one
secret. Always pin the subkey with `!`.

```bash
# Release channel secret -> GitHub secret GPG_S_REL_PRIVATE
gpg --armor --export-secret-subkeys "<S_rel-fpr>!" > s_rel.private.asc

# apt channel secret -> GitHub secret GPG_S_APT_PRIVATE
gpg --armor --export-secret-subkeys "<S_apt-fpr>!" > s_apt.private.asc
```

**Assert one subkey per export before use.** Import each file into a throwaway
`--homedir` and confirm it yields **exactly one** `ssb` (secret subkey) and no
other signing secret:

```bash
for f in s_rel.private.asc s_apt.private.asc; do
  h="$(mktemp -d)"; gpg --homedir "$h" --import "$f" >/dev/null 2>&1
  echo "== $f =="; gpg --homedir "$h" --list-secret-keys --with-colons | grep -c '^ssb:'  # must print 1
  rm -rf "$h"
done
```

Only after this check passes, paste the file contents into the corresponding
GitHub Actions secret:

- `s_rel.private.asc` -> `GPG_S_REL_PRIVATE`
- `s_apt.private.asc` -> `GPG_S_APT_PRIVATE`

**Every signing job re-asserts this at runtime**: after importing its secret,
the job counts `ssb` lines and aborts if it is not exactly 1, so a mis-scoped
secret can never sign with both channels.

Delete the local `s_*.private.asc` from disk once they are in the secret store,
or keep them **offline only** (encrypted, air-gapped) alongside the revocation
certificate. **Never commit them.**

---

## 4. Record the fingerprints (pins)

The install path and CI pin these fingerprints; record them out of band and in
the repo where they are consumed:

- `EXPECTED_PRIMARY_FPR` = `<primary-fpr>` — the offline primary.
- `EXPECTED_SIGNING_FPR` = `<S_rel-fpr>` — the **`S_rel` subkey** that
  `deploy/install.sh` pins when it verifies `checksums.txt`.
- `<S_apt-fpr>` — the apt-signing subkey; recorded so the apt channel and any
  audit can confirm `signed-by=` resolves to `S_apt`.

`deploy/install.sh` is always fetched fresh at install time, so it pins the
**current** `S_rel` scalar in `EXPECTED_SIGNING_FPR`.

Publish the primary fingerprint **out of band** (project website, README, a
signed announcement) so users can independently verify the keyring they
received. Never rely solely on the copy shipped in the repo.

---

## 5. Per-channel rotation (before subkey expiry)

Subkeys expire; rotate each channel independently, from the offline primary:

1. Boot the offline machine and restore the primary keyring: decrypt the offline
   `primary-secret.asc.gpg` backup with the **BACKUP** passphrase and import the
   result under the **KEY** passphrase into a fresh `--homedir` (Section 1).
2. Issue a **new** subkey for the affected channel
   (`gpg --quick-add-key "<primary-fpr>" ed25519 sign 2y`) during an **overlap
   grace window** in which the outgoing subkey is still valid and still signs.
3. Re-export the **channel-specific** public keyring for that channel only
   (`mathion-pubkey.asc` for `S_rel`, `mathion-apt-keyring.asc` for `S_apt`)
   and ship it in the **next release / `.deb`**.
4. For the release channel: because `install.sh` is fetched fresh, update
   `EXPECTED_SIGNING_FPR` to the new `S_rel` scalar **and re-sign the latest
   `checksums.txt` with the new subkey together, in the same change** — the two
   must move as a unit so a freshly fetched installer always matches the
   artifact it verifies.

   **Note — the compiled-in 4b binary changes this for `S_rel`.** Because the
   self-update binary embeds `S_rel` and cannot re-fetch it, the single-step flip
   above is replaced by the two-phase **transition choreography** below: the
   release that first ships the new keyring stays signed by the **outgoing**
   subkey (so pre-rotation self-update clients can still cross), and `install.sh`'s
   literal key + `EXPECTED_SIGNING_FPR` — and the first K2-signed `checksums.txt` —
   move only with a later K2-signed **successor** release. For an `S_rel`
   rotation, follow "Transition choreography for the 4b binary" rather than this
   step's single-change flip.
5. Rotate the CI secret (`GPG_S_REL_PRIVATE` / `GPG_S_APT_PRIVATE`) to the new
   subkey's private export (Section 3), re-running the one-`ssb` assertion.

### `S_apt` rotation is keyring-first, signer-second

The apt public keyring is **cached on installed clients** — the apt setup /
`.deb` installs it as `/usr/share/keyrings/mathion-archive-keyring.gpg` (CI
produced it by dearmoring `mathion-apt-keyring.asc`) and it is **not** re-fetched
on every `apt update`. A hard `S_apt` cutover therefore strands every client
still holding the outgoing keyring: their `apt update` fails signature
verification. Rotate `S_apt` **keyring-first, signer-second**:

1. Ship a `.deb` whose `mathion-apt-keyring.asc` carries **both** the outgoing
   **and** incoming `S_apt` public subkeys (produced + validated by the overlap
   export in §2, "During an S_apt rotation grace window"), while the repo
   `Release`/`InRelease` is **still signed by the OUTGOING `S_apt`**. Installed
   clients upgrade and cache both.
2. After a grace window long enough for clients to have upgraded, cut the CI
   signer over to the **incoming** `S_apt` (`resign.sh` signs with the incoming
   subkey). During the overlap the apt-Release verify allowlist
   `S_APT_VERIFY_FPRS` (`verify-inrelease.sh`, Tasks 6–8) carries
   `"<outgoing-S_apt-fpr> <incoming-S_apt-fpr>"`; after the grace window it
   narrows back to the single incoming fpr.
3. A later `.deb` prunes the outgoing subkey from the shipped keyring.

### Which channels need a dual-accept overlap

- **`S_apt` (apt channel): YES** — its keyring **caches on clients** and is
  **re-signed in place** (the same cached keyring must verify a repo `Release`
  signed by either subkey), so it needs the keyring-first overlap above; both
  subkeys must verify during the grace window.
- **4b self-update binary: NO (transition-release crossing)** — its verifying key
  is **compiled in** and cannot be re-fetched, but it is deliberately **not** made
  to dual-accept two subkeys. Every shipped `mathion-pubkey.asc` stays primary +
  **exactly one** `S_rel` subkey (§2, line 122), so a compiled binary embeds
  whichever single `S_rel` subkey was current at its build time. A rotation is
  crossed with a **transition release** — signed by the still-valid outgoing
  subkey but bundling a binary that embeds the incoming subkey — **not** a
  two-subkey keyring (see "Transition choreography for the 4b binary" below). This
  is what resolves the apparent contradiction with line 122: because the binary
  never dual-accepts, `mathion-pubkey.asc` (the `S_rel` channel) is **never** in
  overlap, exactly as §2 states.
- **`S_rel` via `install.sh`: NO** — `install.sh` is always **fetched fresh** and
  only ever pins the single **current** `S_rel` scalar, so it needs no
  dual-accept.

Only the `S_apt` apt channel takes a dual-accept overlap; both `S_rel` consumers
(`install.sh` and the compiled-in 4b keyring) are overlap-free.

### Transition choreography for the 4b binary (`S_rel` rotation)

Because the 4b binary embeds a single `S_rel` subkey and cannot re-fetch it, an
`S_rel` rotation (K1 → K2) is crossed with a **transition release**, not a
two-subkey keyring. Get the sign-vs-embed direction right: the transition release
is **signed by the outgoing K1** (so pre-rotation clients can still verify it) but
its bundled binary **embeds the incoming K2**. Getting it backwards strands every
pre-rotation client into manual reinstall. Self-update orders eligible releases
descending and installs the first it can verify, so a K1 client crosses in **two
invocations**: run 1 installs the transition release (verifiable with K1, embeds
K2); the replaced binary now trusts K2 and run 2 reaches the K2-only `latest`. The
transition release must stay within the top-N eligible window until stragglers
cross (a **§6.2** crossing-invariant CI guard is meant to enforce this, but it is a
**deferred** rotation-time task — until it exists, manually verify the transition
release stays within the top-N eligible window).

At the **transition build** there is a deliberate **three-way key state** that a
naïve "regenerate everything from `mathion-pubkey.asc`" would break:

- **(a) `deploy/keys/mathion-pubkey.asc` + the binary `go:embed` = incoming K2**
  (primary + K2, still a single subkey — the drift guard keeps the two copies
  byte-identical). The binary therefore embeds K2.
- **(b) the transition release's `checksums.txt` = signed by the outgoing K1**,
  verified out-of-band against the outgoing primary + K1 public key (not the
  committed K2 keyring), so pre-rotation clients can still verify it.
- **(c) `install.sh`'s `mathion_embedded_key()` literal key AND its
  `EXPECTED_SIGNING_FPR` scalar = outgoing K1** (with `EXPECTED_PRIMARY_FPR`
  invariant — only the `S_rel` *subkey* rotates, never the primary). A fresh
  installer resolves the *greatest* stable release, which during the window is the
  K1-signed transition release, so it must still pin K1.

**Do not regenerate `install.sh`'s literal key from the K2 `mathion-pubkey.asc` at
the transition build** — that strands every fresh install until a successor ships.
Flip `install.sh`'s literal **and** its scalar to K2 **together with publishing**
the first K2-signed successor release (the §5 step 4 "together, in the same
change" idiom), and do not leave `install.sh` pinned to the outgoing key long
after that successor ships (the gap only grows).

**This flip is NOT delivery-atomic.** `install.sh` is served from raw `main`
(CDN-cached) while release assets publish through a **separate workflow/endpoint**,
so — whichever becomes visible first — there is a brief window where a fresh
`curl | sh` install sees one but not the other and **fail-closed-rejects**. That
is a **safe, retryable** outcome (the user re-runs and succeeds once both are
visible), never a forgery or downgrade. GitHub provides no cross-resource
atomicity between raw `main` and Release assets, so do **not** call this flip
"atomic": keep the two publications as close in time as possible, and **smoke a
fresh `curl | sh` install once both are visible** before treating the rotation as
live.

**Workflow limitation (rotation-time task).** `release-cli.yml` today drives a
single `S_REL_FPR` for both the goreleaser signing key and the apt-publish verify
against the committed `mathion-pubkey.asc`, so it **cannot** express "sign with the
outgoing K1 while committing the incoming K2 keyring". A real rotation must add
**separate signing-vs-embedded `S_rel` inputs** plus an out-of-band outgoing
verifier — a rotation-time workflow change, not something the steady-state
workflow can do today. Correspondingly, the §6.1 CI fingerprint pin (Task 11)
consumes **`S_REL_EMBEDDED_FPR`** (= the **incoming K2**, distinct from the
outgoing signing `S_REL_FPR` = K1) during a crossing; `S_REL_EMBEDDED_FPR` is
unset in steady state and defaults to `S_REL_FPR` via the Actions `||` idiom.

**Go-live task — gate publication with the self-update guard.**
`cli/scripts/selfupdate-ci-guards.sh` runs in main CI (`ci.yml`) but does **not**
yet gate the release publish job. At go-live — when the first signed release
ships — add a step running `sh cli/scripts/selfupdate-ci-guards.sh` (with
`S_REL_FPR` / `S_REL_EMBEDDED_FPR` in its env, exactly as `ci.yml` passes them)
to `.github/workflows/release-cli.yml`'s `release` job **before** the
Build+sign step, and verify it with that first signed release — so the guard
gates publication, not only main CI. Until keygen the fingerprint pin skips (the
go-live caveat), so there is no signed release to exercise the gate against
before then.

---

## 6. Compromise / revocation

A compromised **signing subkey** is an emergency, **not** a planned rotation: the
graceful §5 overlap deliberately keeps the outgoing key signing during the
grace window, which you can no longer trust once it is compromised. Handle it by
channel, and **never sign anything with the compromised key**:

- **`S_rel` compromise:** from the offline primary, revoke `S_rel`, issue a new
  `S_rel`, then update **both** `install.sh`'s `mathion_embedded_key()` literal
  **and** its `EXPECTED_SIGNING_FPR` scalar to the new key, and re-sign the latest
  `checksums.txt` with the new subkey — all together — and ship a fresh
  `mathion-pubkey.asc`. (Unlike a graceful §5 rotation there is no transition
  release here, so the installer's literal moves immediately with the scalar.)
  Because `install.sh` is fetched fresh, clients get the
  new pin + key on their next install — **no overlap is needed**, and the
  compromised key is simply revoked, never used to sign the transition. The 4b
  self-update binary cannot re-fetch its compiled-in keyring **and does not consult
  revocation**, so a deployed pre-rotation binary keeps trusting the stolen `S_rel`.
  It will **reject the legitimate new-key-only `latest`** (fail-closed against the
  good release), but it is **not** protected against the compromised key itself: an
  attacker able to place an `S_rel`-signed asset at the release origin would still
  be trusted by pre-rotation binaries. Treat every deployed pre-rotation self-update
  binary as **requiring manual reinstall** over the freshly-fetched,
  new-`S_rel`-verified `curl | sh` channel, and understand it **remains exposed to
  the compromised embedded key until that reinstall**. Incident response must
  therefore **also secure the release origin and remove any malicious assets** —
  publishing a revocation elsewhere does not update the embedded keyrings.

- **`S_apt` compromise (EMERGENCY — do NOT use the graceful §5 overlap):** the
  keyring-first/signer-second overlap relies on the outgoing key still signing,
  which is exactly what you cannot trust here. Instead: revoke the compromised
  `S_apt` immediately; issue a new `S_apt`; sign the repo `Release`/`InRelease`
  with the **new `S_apt` ONLY**; and narrow `S_APT_VERIFY_FPRS` to the new fpr —
  the compromised fpr **must NOT** be in the allowlist. Clients still holding
  only the compromised keyring will **FAIL `apt update`** — that is the **safe**
  failure. They must obtain the new keyring **out of band**: re-run the apt
  setup / reinstall over the `S_rel`-verified release channel (`curl | sh`
  install), or apply a signed out-of-band keyring announcement. Accept that
  un-upgraded apt clients are broken until they re-key out of band; never sign
  the transition with the compromised key.

If the **primary** is compromised: publish the offline revocation certificate
(`primary.rev`), stand up a new primary + both subkeys, and re-issue both
keyrings and all artifacts. Announce the new primary fingerprint out of band.

**Activating `primary.rev`.** `primary.rev` — whether produced by
`gen-signing-keys.sh` or by §1's `gpg --output primary.rev --gen-revoke` — is a
clean, directly-importable armored revocation certificate. In an emergency, import
it into a keyring that already holds the public key (`gpg --import primary.rev`),
confirm the primary now shows as revoked, then export and publish that revoked
public key/keyring alongside the out-of-band announcement. (GnuPG's *raw*
auto-generated file under `openpgp-revocs.d/<fpr>.rev` is **not** import-ready — it
carries explanatory prose and a `:` guard before the `-----BEGIN` armor line — but
`gen-signing-keys.sh` strips both before writing `primary.rev`, so the shipped cert
imports as-is.)

Store the revocation certificate and the `s_*.private.asc` exports **offline
and encrypted**. None of that material is ever committed to this repository.
