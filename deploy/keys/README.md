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
| `mathion-apt-keyring.asc` | primary **+ `S_apt` only** | CI dearmors it to `/usr/share/keyrings/mathion-archive-keyring.gpg`; `signed-by=` enforces `S_apt` on the apt repo |

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

```bash
export GNUPGHOME="$(mktemp -d)"        # generation keyring — disposable ONLY after
                                       # primary-secret.asc + primary.rev are backed
                                       # up offline (see the backup step below)
chmod 700 "$GNUPGHOME"

# Primary: certification-only, no expiry on the primary itself.
gpg --batch --quick-generate-key \
    "Mathion Release Signing <svkucheryavski@gmail.com>" \
    ed25519 cert never

PRIMARY_FPR="$(gpg --list-keys --with-colons | awk -F: '/^fpr:/{print $10; exit}')"

# S_rel — signs binary release artifacts (checksums.txt). Set an expiry.
gpg --batch --quick-add-key "$PRIMARY_FPR" ed25519 sign 2y
# S_apt — signs the apt Release file. Set an expiry.
gpg --batch --quick-add-key "$PRIMARY_FPR" ed25519 sign 2y
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

Now back up the **full primary secret key** to encrypted, air-gapped media
**before** the generation homedir is discarded. This is the root of trust:
without the primary secret you can never rotate a subkey or revoke anything
again, so losing it is unrecoverable. Verify you can re-import the backup into a
fresh `--homedir`, and only THEN wipe `$GNUPGHOME`:

```bash
# Back up the FULL primary secret key to ENCRYPTED, air-gapped offline media
# BEFORE discarding the generation homedir. NEVER commit it.
gpg --armor --export-secret-keys "$PRIMARY_FPR" > primary-secret.asc   # OFFLINE + ENCRYPTED
# Confirm the backup re-imports cleanly, then the homedir is safe to wipe:
h="$(mktemp -d)"; gpg --homedir "$h" --import primary-secret.asc && \
  gpg --homedir "$h" --list-secret-keys "$PRIMARY_FPR" >/dev/null && echo "primary backup OK"
rm -rf "$h"
```

Store `primary-secret.asc` and `primary.rev` together on encrypted, air-gapped
media — never in the repository. The generation homedir may be wiped only once
both exist and the re-import check above has passed.

---

## 2. Export the two trimmed PUBLIC keyrings (channel separation)

Each shipped public keyring must contain the primary **and exactly one**
signing subkey — never both. Use per-subkey export syntax (`<fpr>!`) so only
the named subkey is included.

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

1. Boot the offline machine and restore the primary keyring by importing the
   offline `primary-secret.asc` backup (Section 1) into a fresh `--homedir`.
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
5. Rotate the CI secret (`GPG_S_REL_PRIVATE` / `GPG_S_APT_PRIVATE`) to the new
   subkey's private export (Section 3), re-running the one-`ssb` assertion.

### `S_apt` rotation is keyring-first, signer-second

The apt public keyring is **cached on installed clients** — the `.deb` dearmors
it to `/usr/share/keyrings/mathion-archive-keyring.gpg` and it is **not**
re-fetched on every `apt update`. A hard `S_apt` cutover therefore strands every
client still holding the outgoing keyring: their `apt update` fails signature
verification. Rotate `S_apt` **keyring-first, signer-second**:

1. Ship a `.deb` whose keyring carries **both** the outgoing **and** incoming
   `S_apt` public subkeys, while the repo `Release`/`InRelease` is **still
   signed by the OUTGOING `S_apt`**. Installed clients upgrade and cache both.
2. After a grace window long enough for clients to have upgraded, cut the CI
   signer over to the **incoming** `S_apt` (`resign.sh` signs with the incoming
   subkey). During the overlap the apt-Release verify allowlist
   `S_APT_VERIFY_FPRS` (`verify-inrelease.sh`, Tasks 6–8) carries
   `"<outgoing-S_apt-fpr> <incoming-S_apt-fpr>"`; after the grace window it
   narrows back to the single incoming fpr.
3. A later `.deb` prunes the outgoing subkey from the shipped keyring.

### Which channels need a dual-accept overlap

- **`S_apt` (apt channel): YES** — its keyring **caches on clients** (much like
  the 4b compiled-in key), so it needs the keyring-first overlap above; both
  subkeys must verify during the grace window.
- **4b self-update binary: YES** — its verification key is **compiled in** and
  cannot be re-fetched, so it must accept both the outgoing and incoming subkey
  during the overlap.
- **`S_rel` via `install.sh`: NO** — `install.sh` is always **fetched fresh** and
  only ever pins the single **current** `S_rel` scalar, so it needs no
  dual-accept. This is the only overlap-free channel.

---

## 6. Compromise / revocation

If a **signing subkey** is compromised: from the offline primary, revoke that
subkey, generate a fresh replacement subkey for the affected channel, and ship
the updated channel-specific keyring plus re-signed artifacts exactly as in the
rotation procedure. Only that channel is affected; the other subkey and the
primary are untouched.

If the **primary** is compromised: publish the offline revocation certificate
(`primary.rev`), stand up a new primary + both subkeys, and re-issue both
keyrings and all artifacts. Announce the new primary fingerprint out of band.

Store the revocation certificate and the `s_*.private.asc` exports **offline
and encrypted**. None of that material is ever committed to this repository.
