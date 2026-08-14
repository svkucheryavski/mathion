# Phase 9-D Slice 4 — apt packaging, release signing, CLI self-update

**Status:** design v4 (brainstorm + codex ×2 + 4-reviewer round folded; open items in §3)
**Date:** 2026-08-13
**Predecessors:** Slice 1 (deployment foundation), Slice 2 (the `mathion` Go CLI),
Slice 3 (backup/restore/update + backend `/version`). All merged to `main`;
`cli-v0.2.0` + app `v0.2.0` shipped.

---

## 1. Goal

Give Mathion a first-class, cryptographically-authenticated distribution path:

- `apt install mathion` from a signed apt repository hosted on GitHub Pages.
- A signed `.deb` built in the existing goreleaser release.
- One long-lived offline **primary** key with **two CI-held channel-specific signing
  subkeys** — **S_rel** authenticates the curl|sh release archives (+ self-update),
  **S_apt** authenticates the apt repo `Release`; separation is enforced on the verify
  side (no verifier holds both subkeys — §4). This closes the "integrity only, not
  authenticity" gap `deploy/install.sh` flags.
- `mathion self-update` — a channel-aware, signature-verified, **forward-only**
  in-place upgrade of the CLI binary, distinct from `mathion update` (app).
- Non-destructive detection of the dual-install / PATH-precedence footgun.

This slice touches distribution and the CLI only. No backend or frontend changes.

## 1.1 Threat model (what signing buys, and its limits)

- **Single-maintainer repo.** Only the maintainer pushes `cli-v*` tags / merges.
  Signing defends against: a compromised download/CDN origin (Pages/Releases), a
  compromised CI token or maintainer account (limit blast radius, not grant it),
  and network-position attackers.
- **Bootstrap is TOFU.** A one-line `curl … | sh` or the apt key-add cannot
  self-authenticate — the script/key arrive over the same HTTPS origin. First
  trust = TLS + GitHub origin + a fingerprint published on a **genuinely
  independent channel** (not only the same-origin README — a signed email, a
  conference talk, a third-party/DNS record). The pinned anchor is real only
  *after* bootstrap: `self-update` verifies against a **compile-time-embedded**
  key inside a binary the user already trusts, and apt verifies against a keyring
  already on the box.
- **Freshness asymmetry (accepted).** apt gets `Valid-Until` (§7.2). The curl|sh
  + self-update channel has **no signed freshness bound**: an origin/MITM attacker
  can suppress newer releases so the forward-gate reports "already up to date",
  silently freezing a host on an old version. Documented limitation; a signed
  "latest" manifest is deferred (§15).

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | apt repo hosting | **GitHub Pages** (`gh-pages` branch, path `/deb`); repo state = the `.deb` files tracked in git |
| D2 | signing scope | **Both channels, two channel-specific subkeys under one offline primary** (`S_apt` signs the apt repo `Release`; `S_rel` signs `checksums.txt` for the curl\|sh + self-update channel). Each verifier trusts **only its channel's subkey** — no verifier holds both (§6.1) |
| D3 | CLI self-update | **Dedicated `mathion self-update`**, channel-aware (apt-managed → defer to apt; curl-managed → verify + forward-only swap) |
| D4 | dual-install conflict | **Detect + warn, never auto-delete** |

## 2.1 Slice split (4a / 4b)

This design is implemented as two independently shippable slices sharing one offline primary (two channel-specific signing subkeys):

- **Slice 4a — distribution + signing** (delivers `apt install mathion` and closes
  the curl|sh authenticity gap): the `.deb`/nfpm (§5); the full key material +
  lifecycle including **both** subkeys `S_rel`/`S_apt` (§6); the apt repo (§7);
  `install.sh` authenticity (§8); dual-install detection incl. the `mathion
  version` warning (§10, minus the `--short` flag); CI release signing +
  `apt-publish` + `apt-resign` + the two environments (§11); packaging + hermetic
  apt e2e + install.sh tests (§12); docs + manual prerequisites (§13, §14).
  4a signs `checksums.txt` with `S_rel`, so its releases are already self-update-
  verifiable.
- **Slice 4b — CLI self-update** (consumes 4a's signed releases): the
  `cli/internal/selfupdate` package + `mathion self-update` (§9); its deps
  `go-crypto`/`x/mod/semver`/`x/sys/unix` (§9.2, M2); the `version --short` flag
  (§10); the self-update Go unit tests + integration legs (§12); self-update docs.

Each slice gets its own implementation plan. 4a is planned and executed first.

## 3. Open decisions

- **M1 — distribution license: RESOLVED → Apache-2.0.** Repo-root `LICENSE`
  (SPDX `Apache-2.0`). The `.deb` `/usr/share/doc/mathion/copyright` (DEP-5
  machine-readable) references `/usr/share/common-licenses/Apache-2.0` and bundles
  the **verbatim** third-party BSD-style notices for the linked Go deps
  (pflag BSD-3, go-crypto + circl BSD-style; cobra + mousetrap Apache-2.0),
  generated via `go-licenses`.
- **M2 — new Go dependencies (recommended: yes).** For in-CLI verify + forward-gate:
  `github.com/ProtonMail/go-crypto/openpgp` (pulls `cloudflare/circl`,
  `golang.org/x/crypto`, `golang.org/x/sys`) **and** `golang.org/x/mod/semver`
  (the forward-gate comparator — stdlib has none). Pin all versions. This grows
  the CLI's module graph well beyond today's cobra-only closure; accepted as the
  correct maintained choice (`x/crypto/openpgp` is frozen/deprecated). Constrain
  accepted digests to SHA-256-or-stronger; negative-test expired/revoked/wrong-key.
- **M3 — man page (IN scope).** Ship `mathion.1` (Debian Policy §12.1 —
  `binary-without-manpage` is a defect). Rest of §15's exclusions stand.

---

## 4. Architecture overview

Two authenticated channels, one trust anchor: a long-lived **offline primary**
key with two CI-held **channel-specific signing subkeys** (S_rel for
checksums/self-update, S_apt for apt metadata — §6.1). **Channel separation is
enforced on the verify side: two trimmed public keyrings, and no verifier holds
both subkeys.** `mathion-pubkey.asc` (primary + **S_rel only**) is embedded in
install.sh and the 4b binary to verify `checksums.txt`; `mathion-apt-keyring.asc`
(primary + **S_apt only**) is dearmored to the apt keyring so `signed-by` enforces
S_apt. Each keyring still carries its own subkey's public packet + primary binding
signature (apt/gpgv and go-crypto verify a *subkey's* signature and need that
binding; a primary-only export fails) — but neither carries the other channel's
subkey, so a compromise of the unattended S_apt cannot forge the curl|sh channel,
and a leaked S_rel cannot forge apt metadata.

```
                         ┌── release (goreleaser, tag cli-vX.Y.Z) ─┐
                         │  build mathion (amd64,arm64)             │
                         │  archives -> mathion_linux_*.tar.gz      │
                         │  nfpm     -> mathion_*.deb (ships keyring,│
                         │              man page, copyright, changelog)│
                         │  signs    -> checksums.txt + .asc         │
                         │   (artifacts: checksum; exact subkey!;    │
                         │    --armor; batch/loopback; stdin pass)   │
                         └───────────────┬─────────────────────────┘
        upload-artifact ────────────────┤ gh release create (.tar.gz,.deb,checksums,.asc)
                          ┌──────────────┴───────────────┐
        curl|sh channel   │                              │  apt channel (apt-publish job)
        install.sh (TOFU) │                              │  download SAME-RUN debs (artifact),
        + self-update     │                              │  VERIFY vs signed checksums,
        verify .asc via   │                              │  apt-ftparchive generate (Tree{},
        status-fd, pinned │                              │  DoByHash), Release(Date,Valid-Until),
        embedded pubkey,  │                              │  regen -> InRelease + Release.gpg,
        forward-only      │                              │  two-checkout push to gh-pages /deb
                          └──────────────────────────────┘
```

### 4.1 Component / file map

| Path | Change | Responsibility |
|------|--------|----------------|
| `LICENSE` | create | repo-root Apache-2.0 (M1) |
| `cli/.goreleaser.yaml` | modify | `nfpms:` (`.deb` incl. keyring/man/copyright/changelog; explicit version stripping `cli-v`; `maintainer`/`description`/`homepage`); `signs:` with **`artifacts: checksum`**, exact S_rel subkey, `${artifact}.asc`, `--armor`, batch/loopback, **`stdin` + `--passphrase-fd 0`** (both required to feed a protected key) |
| `deploy/keys/mathion-pubkey.asc` | create | trimmed **primary + S_rel only** keyring — curl|sh/self-update trust anchor (embedded in install.sh + 4b binary) |
| `deploy/keys/mathion-apt-keyring.asc` | create | trimmed **primary + S_apt only** keyring — CI dearmors it to `/usr/share/keyrings/mathion-archive-keyring.gpg` (in the `.deb` + on Pages); apt `signed-by` enforces S_apt |
| `deploy/keys/README.md` | create | key generation, **`!`-scoped private secret-subkey export** for the CI secrets (channel isolation), per-channel subkey rotation (overlap-signing; install.sh pins one current S_rel scalar, dual-accept overlap is a 4b concern), revocation/compromise procedure, fingerprints |
| `cli/internal/selfupdate/mathion-pubkey.asc` | create | in-package copy for `go:embed`; a unit test `os.ReadFile("../../../deploy/keys/mathion-pubkey.asc")` asserts byte-identity, plus a CI `cmp` guard |
| `cli/internal/selfupdate/` | create | release LIST+filter, download, `armor.Decode` + OpenPGP verify (**`VerifyDetachedSignatureAndHash`** so the issuer fingerprint is pinned to the S_rel **subkey**, not the parent entity — §6.3/§9.3; SHA-256+), semver forward-gate, `dpkg -S` channel detect, `x/sys/unix` `openat`/`renameat` TOCTOU-safe staged swap. Seams: HTTP base URL, download URL, dpkg exec func-var, swap **target path as a parameter** |
| `cli/cmd/self_update.go` (+ `_test.go`) | create | command wiring; `requireRoot()` only before the curl-channel mutation |
| `cli/cmd/version.go` | modify | dual-install warning **before** the not-installed/unreadable early returns; stat + `exec.LookPath` behind func-var seams for hermetic tests |
| `cli/cmd/root.go` | modify | register `newSelfUpdateCmd` |
| `deploy/install.sh` | modify | verify `checksums.txt.asc` against the **literally-embedded** primary+S_rel pubkey via `--status-fd` (GOODSIG + `VALIDSIG` **first** field == S_rel subkey `EXPECTED_SIGNING_FPR` + last field == primary; reject EXP/REVKEYSIG + wrong-channel S_apt), exactly-one checksum line, before sha256; align latest-tag resolution with self-update |
| `deploy/man/mathion.1` | create | man page; packaged pre-gzipped (`gzip -9n`) as `mathion.1.gz` |
| `deploy/apt/` | create | `apt-ftparchive` config (`Tree{}`, `DoByHash`); `build.sh` (publish: copy new debs, index, sign) + `Valid-Until` computation; **`verify-inrelease.sh`** (shared status-fd S_apt policy gate — require gpg exit 0 AND GOODSIG AND VALIDSIG fpr in a space-separated **allowlist** (outgoing+incoming during a rotation overlap) AND reject EXP/REV, in a clean keyring; gpg exit code alone is 0 on expired/revoked; stages the body until accepted); **`resign.sh`** (dates-only Release refresh — `verify-inrelease.sh` extracts the signed `InRelease` payload, bump `Date`/`Valid-Until`, re-sign; never re-reads the pool → laundering-proof) + `resign_test.sh` |
| `.github/workflows/release-cli.yml` | modify | `release` env for secrets; `upload-artifact` debs; `apt-publish` job (download-artifact, **verify**, `build.sh` generate, two-checkout push, **`contents: read`** — gh-pages push uses `PAGES_DEPLOY_TOKEN`, concurrency, rebase/retry) |
| `.github/workflows/apt-resign.yml` | create | scheduled **dates-only** re-sign (`resign.sh`, no pool re-index, no apt-utils) in a **separate unattended** env |
| `README.md` | modify | apt install (package-managed keyring), fingerprint, self-update usage, PATH-precedence note |

---

## 5. The `.deb` package (nfpm inside goreleaser)

- **Package** `mathion`; **binary** → `/usr/bin/mathion`; **arch** amd64 + arm64;
  **section** `admin`; **priority** `optional`. Set **`maintainer`**,
  **`description`** (synopsis + extended), **`homepage`** (else lintian
  `no-maintainer`/`description-synopsis-is-empty`).
- **Version:** goreleaser does **not** turn `cli-v0.2.0` into `0.2.0` (it strips
  only a leading `v`), and goreleaser's `nfpms:` has **no independent `version:`
  field** — nfpm receives goreleaser's computed `.Version`. So keep the workflow's
  `GORELEASER_CURRENT_TAG=v${tag#cli-v}` (→ `.Version=0.2.0`, a Policy-valid,
  correctly-ordered version), add **strict source-tag validation** (must match
  `cli-vMAJOR.MINOR.PATCH`), and **assert `dpkg-deb -f mathion_*.deb Version` ==
  `0.2.0`** after the build. The `--skip=validate` comment's "no template uses
  .Version" rationale is now stale (nfpm uses it) — update it, keep the env set.
- **No hard Docker dep.** `Recommends` is apt-installed **by default**, so
  `Recommends: docker.io` would pull the very conflict we avoid → use `Suggests`
  or none; the CLI probes Docker at runtime.
- **Ships:** `/usr/share/keyrings/mathion-archive-keyring.gpg` (the package-managed
  keyring — see §6.1/§7.3 — shipped as **ordinary package data, never an nfpm
  conffile**, so `apt upgrade` refreshes it with no dpkg prompt and it cleanly
  overwrites the admin-placed bootstrap copy), `/usr/share/doc/mathion/copyright`,
  `/usr/share/doc/mathion/changelog.Debian.gz`, `/usr/share/man/man1/mathion.1.gz`.
  Add a lintian override for the expected `statically-linked-binary` (Go).
- **`postinst`** (nfpm injects verbatim — no debhelper tokens): guard the body
  with `if [ "$1" = configure ]; then … fi`; warn if `/usr/local/bin/mathion`
  exists using an `if … then … fi` (never `[ -e … ] && echo` as the last statement
  — under `set -e` its exit 1 on the absent-file case aborts the script and fails
  the install); end with explicit `exit 0`. Never deletes.
- **Not** individually debsig-signed: apt trust is the signed repo `Release`
  (§7); a local `apt-get install ./file.deb` checks no signature regardless.

---

## 6. Signing — one offline primary + two channel-specific subkeys (separation enforced)

### 6.1 Key material & lifecycle
- **Offline primary** (Ed25519, or RSA ≥ 3072), never in CI. **Channel separation
  is enforced on the verify side — no verifier holds both subkeys.** Export **two
  trimmed public keyrings** from the one primary: `deploy/keys/mathion-pubkey.asc`
  = **primary + S_rel** (embedded verbatim in install.sh + the self-update binary —
  the only keys that verify `checksums.txt`), and
  `deploy/keys/mathion-apt-keyring.asc` = **primary + S_apt** (dearmored to
  `/usr/share/keyrings/mathion-archive-keyring.gpg`, so apt's `signed-by=<keyring>`
  accepts **only** S_apt). Each keyring carries only its own channel's outgoing +
  incoming subkey during a rotation overlap.
- **Private signing-subkey export (channel isolation, verify-enforced).** The CI
  secrets `GPG_S_REL_PRIVATE` / `GPG_S_APT_PRIVATE` each carry **exactly one**
  signing subkey's secret, exported with the trailing `!` selector:
  `gpg --armor --export-secret-subkeys "<S_rel-fpr>!"` and
  `… "<S_apt-fpr>!"`. The `!` is load-bearing — a bare
  `--export-secret-subkeys <primary>` exports **every** subkey secret, collapsing
  the channel split into one secret. Each export must import to **exactly one**
  `ssb` in a throwaway `--homedir` before it is stored. Every signing job
  re-asserts this at runtime (import → list secret subkeys → require count == 1 and
  fpr == the pinned channel fpr), so a leaky export fails the job closed rather than
  silently arming both channels (§11.1). `s_*.private.asc` + the revocation cert are
  stored offline and never committed.
- **Two channel-specific signing subkeys** under the one primary (each with a set
  expiry, e.g. 2 years): **S_rel** signs `checksums.txt` (curl|sh + self-update)
  and **S_apt** signs the apt `Release`. Rationale (§11.1): the always-on
  *unattended* re-sign job holds **only S_apt**, so a compromise of that weak
  automation can forge apt metadata but **cannot** forge the curl|sh/self-update
  channel — self-update **and install.sh** both pin **S_rel's subkey** fingerprint
  (VALIDSIG's first field) and reject an S_apt-signed `checksums.txt`; conversely
  the apt keyring holds only S_apt, so apt rejects an S_rel-signed `Release`. Only
  the relevant subkey secret enters each environment. Pin digest algos
  (`--digest-algo SHA256`+, `--cert-digest-algo SHA256`+) so nothing falls back to
  SHA-1 on an old gpg.
- **Rotation is NOT free — the "no re-add" benefit is bounded.** A `signed-by`
  keyring is a one-time snapshot; verifiers holding only the *old* subkey cannot
  verify a *new* subkey's signatures. Mechanics that make rotation safe:
  - **apt:** the keyring is **package-managed** (shipped by the `.deb` to
    `/usr/share/keyrings/mathion-archive-keyring.gpg`; `sources.list` `signed-by`
    points there). A rotation ships in the next `.deb` release, so `apt upgrade`
    refreshes the keyring with the new subkey — no manual re-add. (Steady-state
    only; cold-start bootstrap still installs the key manually — §7.3.) **Publish/resign
    verification is a bounded fingerprint allowlist, NOT a single pin:** during the
    overlap the maintainer sets the repo variable `S_APT_VERIFY_FPRS` = "outgoing
    incoming" so `verify-inrelease.sh` accepts the still-outgoing-signed `InRelease`
    while `S_APT_FPR` keeps *signing* with the outgoing subkey; cutover then flips
    `S_APT_FPR`/secret to the incoming subkey (the next publish re-signs with it), and
    once every `Release` is incoming-signed the allowlist drops back to the single fpr.
    A single-fingerprint pin would make the outgoing→incoming transition impossible
    (it rejects the outgoing-signed `InRelease` before it can be re-signed).
  - **self-update:** rotation runs during an **overlap grace window** in which
    releases and repo metadata stay signed by the **outgoing** subkey (whose
    published keyring already carries the incoming subkey), so a binary embedding
    the old key can still verify the transition and re-embed the new key.
    self-update selects the **greatest release it can actually verify** (stepping
    to the transition), not merely the greatest tag. A client offline for the
    entire grace window — repo already switched to the new subkey — cannot
    auto-cross and needs the documented manual re-install/recovery. apt is the
    same: keep signing `Release` with the outgoing subkey through the window so
    `apt upgrade` refreshes the keyring package first.
  - The constant users verified out-of-band is the **primary fingerprint**; that is
    what the subkey model preserves, not zero-effort rotation.
- **Revocation:** a primary revocation certificate is generated at creation and
  stored offline. Compromise procedure (revoke → publish revoked key via the
  keyring-refresh channel + out-of-band → issue a new primary verified by
  out-of-band fingerprint) documented in `deploy/keys/README.md`.

### 6.2 Signing execution (explicit & non-interactive)
- goreleaser `signs:` MUST set **`artifacts: checksum`** (default is `none` → a
  silent no-op producing no `.asc`), plus **S_rel**'s exact fingerprint with a
  trailing `!` (`--local-user <S_rel-fpr>!`), `${artifact}.asc`, `--armor`,
  `--batch --pinentry-mode loopback`, and the passphrase fed on **fd 0**: under the
  `signs:` entry, `stdin: "{{ .Env.GPG_PASSPHRASE }}"` supplies the bytes **and**
  `--passphrase-fd 0` MUST appear in `args` to consume them — `stdin`
  without the flag (or `loopback` alone) reads nothing, so a **protected** key
  fails cold (verified against gpg 2.5: signing fails without `--passphrase-fd 0`,
  succeeds with it). Signs `checksums.txt` (which pins every artifact incl. the
  `.deb`) → one signature.
- apt `Release` signing (§7) uses **S_apt** identically (`--local-user
  <S_apt-fpr>!`), with `build.sh`/`resign.sh` piping `GPG_PASSPHRASE` to
  `--passphrase-fd 0` (skipped when empty, so throwaway-key tests still run).
- Runner GPG setup (each of the 3 signing jobs — release, apt-publish, apt-resign
  — is a fresh runner): private `GNUPGHOME` (0700), import the armored subkey,
  `allow-loopback-pinentry` in `gpg-agent.conf` + reload, then sign. A vetted
  SHA-pinned import action is acceptable in lieu of hand-rolling.

### 6.3 Verification (anchors pinned only post-bootstrap — §1.1)
- `self-update` (4b): **`armor.Decode`** the `.asc` first (require a `PGP SIGNATURE`
  block — goreleaser emits ASCII armor, which the go-crypto verify will **not**
  accept raw), then verify against the **compile-time-embedded** pubkey (primary +
  S_rel only) over `[SHA256,SHA384,SHA512]`. **Enforcing S_rel requires the exact
  signing subkey, not the parent entity:** `CheckDetachedSignatureAndHash` returns
  the primary `*Entity` (both subkeys resolve to the same parent, so an entity-
  fingerprint compare cannot reject an S_apt signature). Use
  **`VerifyDetachedSignatureAndHash`** and require the returned signature packet's
  **issuer fingerprint == S_rel**, or build the verifying keyring from primary +
  S_rel only. Then require **exactly one** matching sha256 line for the archive.
  (Since the embedded keyring is already primary + S_rel only, the keyring itself is
  the primary enforcement; the issuer check is defense in depth.)
- `install.sh`: verify against the **literally-embedded** pubkey (here-doc, primary +
  S_rel, never a downloaded key) in a private `GNUPGHOME` (0700), `--batch --no-tty
  --status-fd 1`, via a **sourceable `verify_sig` function** (the test drives the
  real function, it is not re-implemented). Accept only a `GOODSIG` whose `VALIDSIG`
  **first field == `EXPECTED_SIGNING_FPR`** (the S_rel subkey) **and** last field ==
  `EXPECTED_PRIMARY_FPR`, with the **absence** of
  `EXPKEYSIG`/`REVKEYSIG`/`EXPSIG`/`ERRSIG`/`BADSIG` — a bare `VALIDSIG` is emitted
  *alongside* `EXPKEYSIG`/`REVKEYSIG`, so it does not by itself reject an expired or
  revoked key (nor does the exit code, which can be 0). Explicit one-line count
  (`[ "$(grep -c …)" = 1 ]`). Fail closed if `gnupg` is absent.
- apt: verifies `Release` against `/usr/share/keyrings/mathion-archive-keyring.gpg`
  (primary + S_apt only — `signed-by` thus enforces S_apt).
- Equivalence: signing `checksums.txt` ≡ signing each artifact **iff** consumers
  require exactly one matching sha256 line — now enforced explicitly on both paths.

---

## 7. apt repo on GitHub Pages

### 7.1 Layout (`gh-pages` branch, served at `https://svkucheryavski.github.io/mathion`)
```
.nojekyll                                     (at the PUBLISHING-SOURCE / branch ROOT — NOT under deb/ — disables Jekyll)
deb/
  mathion-archive-keyring.gpg                 (dearmored primary + S_apt; for the cold-start bootstrap)
  pool/main/m/mathion/mathion_<ver>_<arch>.deb   (accumulate)
  dists/stable/
    Release  InRelease  Release.gpg
    main/binary-amd64/Packages{,.gz}   binary-arm64/Packages{,.gz}
    main/binary-*/by-hash/SHA256/<hash>        (current + previous retained)
```

### 7.2 Index generation (exact tooling)
Build with **`apt-ftparchive generate <config>`** (NOT standalone `packages`,
which mixes arches and emits no by-hash) over the git-tracked `pool/`:

1. `build.sh` (publish path) copies new release `.deb`s into `pool/main/m/mathion/`.
   The input dir (the download-artifact dir) is always distinct from the pool, so no
   self-copy case arises. (The scheduled refresh does **not** use `build.sh` — see
   Freshness below — so it never re-reads the pool.)
2. `generate` config with a `Tree { … Architectures "amd64 arm64"; Sections
   "main"; }` block (filters each `binary-<arch>/Packages` to that arch) and
   `APT::FTPArchive::DoByHash "true"` (creates the `by-hash/SHA256/` files;
   retain current + previous). `Filename:` paths are relative to `/deb`.
3. `apt-ftparchive release dists/stable` (auto-emits the `MD5Sum`/`SHA256`
   per-index sections apt requires **and a fresh `Date`**) with explicit `Origin`,
   `Label`, `Suite` (`stable`), `Codename` (`stable`), `Components` (`main`),
   `Architectures` (`amd64 arm64`), `Acquire-By-Hash: yes`. Then **append only** a
   bounded **`Valid-Until`** (`date -R -u -d '+N days'`); do NOT append a second
   `Date` (apt-ftparchive already emits one — a duplicate `Date` is malformed
   deb822). deb822 is field-order-independent, so appending after the hash blocks is
   safe.
4. Sign with **S_apt** non-interactively (passphrase fed on fd 0): `gpg …
   --clearsign -o InRelease Release` and `gpg … -abs -o Release.gpg Release`.
5. Publish to `gh-pages` (§11.3).

**Freshness (dates-only resign):** `Valid-Until` bounds replay/freeze. Because it
expires, a scheduled job (§11.4) runs `resign.sh <repo-root> <S_apt-fpr>
<trusted-apt-keyring.asc>`, which **verifies the existing S_apt-signed `InRelease`
and extracts its authenticated payload** via the shared `verify-inrelease.sh` gate,
replaces **only** `Date`/`Valid-Until`, and re-signs. The gate does **not** trust
gpg's exit code: `gpg --decrypt`/`--verify` **return 0 on an expired (`EXPKEYSIG`) or
revoked (`REVKEYSIG`) key** — VALIDSIG is emitted but not GOODSIG. So the gate parses
`--status-fd` in a **clean `GNUPGHOME` populated only from the trusted committed apt
keyring** and requires gpg **exit 0** (a non-zero exit — tampered/no-pubkey/operational —
fails closed even with a stray `GOODSIG`) AND `GOODSIG` AND a `VALIDSIG` fpr **in the
allowed S_apt set** (a space-separated allowlist — one fpr steady-state, the
outgoing+incoming pair during a rotation overlap so cutover is possible — §6.1) AND the
**absence** of `EXPKEYSIG`/`REVKEYSIG`/`EXPSIG`/`ERRSIG`/`BADSIG`; the extracted body is
**staged** and published only after acceptance. Every hash block
(the `pool/` commitment) is preserved verbatim. `resign.sh` does **not** run
`apt-ftparchive` or re-read `pool/` at all — so it needs no `apt-utils`, and it
structurally cannot introduce new content. (Re-clearsigning the raw file unchanged
would preserve stale dates and refresh nothing; regenerating over the pool would
re-read possibly-tampered bytes — dates-only avoids both.)

**Anti-laundering:**
- **Scheduled resign (§11.4) — laundering-proof by construction.** Because `resign.sh`
  re-signs only the *already-authenticated* Release payload with fresh dates and never
  re-reads/re-indexes `pool/`, the genuinely-unattended job cannot launder tampered
  pool/Packages state into a signed `Release`. The `verify-inrelease.sh` status-fd
  policy gate (GOODSIG + pinned S_apt fpr + reject EXP/REV) fails closed on a
  broken/expired/revoked/wrong-signer `InRelease`, and no-ops on cold start — so the
  job can only extend the validity window of a genuinely S_apt-authenticated Release.
- **Publish (§11.3) — verify-before-index + scoped residual.** The tag-triggered job
  verifies each **new** `.deb` against the S_rel-signed `checksums.txt` before indexing
  and refuses to publish over an existing `InRelease` that fails the same
  `verify-inrelease.sh` S_apt status-fd policy. It does **not**
  re-verify every *accumulated* pool `.deb` against the signed `Packages` before
  `apt-ftparchive` re-indexes, so a pool `.deb` tampered in place (old valid `InRelease`
  left over the old `Packages`) could be re-indexed and signed. Scoped residual:
  tampering the `gh-pages` pool requires the `PAGES_DEPLOY_TOKEN`, a per-repo PAT that
  also grants `main` write — i.e. the attacker could subvert the pipeline directly.
- Neither defends against a malicious `main`-branch workflow change, which scheduled
  jobs execute as latest-default-branch code — that residual needs a dedicated repo or
  an external/HSM signer, out of scope for this slice (§1.1).

### 7.3 User-facing install (package-managed keyring)
Cold-start bootstrap (TOFU) installs the key to the package-managed path so later
rotations flow via `apt upgrade`:
```sh
sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://svkucheryavski.github.io/mathion/deb/mathion-archive-keyring.gpg \
  | sudo tee /usr/share/keyrings/mathion-archive-keyring.gpg >/dev/null
sudo chmod 0644 /usr/share/keyrings/mathion-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/mathion-archive-keyring.gpg] \
  https://svkucheryavski.github.io/mathion/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/mathion.list
sudo apt update && sudo apt install mathion
```
`signed-by` scopes the key to this repo; `/usr/share/keyrings` is the correct
location for a **package-managed** key (the `.deb` refreshes it on upgrade —
shipped as ordinary package data, not a conffile, so the refresh is silent and
cleanly overwrites this admin-placed bootstrap copy). Verify the fingerprint
out-of-band (§1.1).

### 7.4 Repository growth
Small static binaries per version + git history accumulate against Pages' ~1 GB
soft limits. Define a retention threshold from the first release (prune `pool/` to
the last N minor versions, or monitor). Documented, not automated this slice.

---

## 8. `install.sh` authenticity upgrade

**Fetch + verify the signed checksums before downloading the archive** (never pull
an unauthenticated blob from an untrusted origin first): download `checksums.txt` +
`checksums.txt.asc`; in a private `GNUPGHOME` (0700) import the **literally-embedded**
pubkey (here-doc = **primary + S_rel**, never downloaded), `gpg --batch --no-tty
--import`, verify with `--status-fd 1`. Accept only a `GOODSIG` whose `VALIDSIG`
**first field == the S_rel subkey** (`EXPECTED_SIGNING_FPR`) **and** last field ==
`EXPECTED_PRIMARY_FPR`, with **no** `EXPKEYSIG`/`REVKEYSIG`/`EXPSIG`/`ERRSIG`/`BADSIG`
(a bare `VALIDSIG` accompanies expired/revoked keys, and the exit code can be 0 for
them). The verify lives in a **sourceable `verify_sig` function** (with a test-
overridable `mathion_embedded_key`) so the test drives the real code — good /
tampered / wrong-channel (S_apt) / **expired** (a `--faked-system-time` past-dated
subkey, no `sleep`) / revoked / gpg-absent — not a re-implementation.
Then download the archive and require exactly one checksum line for the asset
(`grep -c`). Abort if `gnupg` is absent. Additionally, **align install.sh's tag
resolution with self-update's rule** — select the greatest **stable** `cli-vX.Y.Z`
(skip prereleases), not the first API-ordered match. The "Integrity only … signing is
Slice 4" comment is removed.

---

## 9. `mathion self-update`

New command; new `cli/internal/selfupdate` package.

### 9.1 Flow
1. **Resolve self:** `os.Executable()` → `filepath.EvalSymlinks` → absolute path.
   The **resolved** path is the swap target (renaming the unresolved symlink would
   orphan the real binary).
2. **Detect channel (fail-closed):** `LC_ALL=C dpkg -S <resolved path>` via an
   injectable exec seam.
   - exit 0 **and** the leading `pkg:` field is `mathion` → **apt-managed**: print
     `sudo apt update && sudo apt install --only-upgrade mathion`, exit 0. **No
     root required.**
   - exit 1 with stderr `"no path found matching pattern"`, **or** `dpkg` absent →
     **curl-managed**, continue.
   - any other nonzero / unparseable stderr → **abort** (never fall through to a
     swap).
3. **Resolve latest & forward-gate:** GET the `/releases` **list** (paginated),
   filter to `cli-v*`, skip drafts/prereleases (the `/releases/latest` endpoint can
   return an *app* `v*` release — the repo publishes both). Strip `cli-` and compare
   with `golang.org/x/mod/semver`, requiring `semver.IsValid`, canonical
   3-component form, and no semantic prerelease (invalid/prerelease tags are
   ineligible — `Compare` sorts invalid *below* valid, so an unchecked bad tag
   could masquerade). Pick the greatest stable. If `latest <= current`
   (`buildVersion`, baked as the full tag `cli-vX.Y.Z`; `dev` always proceeds),
   print "already up to date", exit 0. Never downgrade.
4. **Guard the mutation:** now `requireRoot()`. Open the resolved target's parent
   **directory** component-by-component from `/` with
   `openat(O_DIRECTORY|O_NOFOLLOW)` and perform all subsequent ops (`openat`,
   `fchmod`, `renameat`) fd-relative via `golang.org/x/sys/unix` — Go 1.24's
   `os.Root` has **no `Rename`** and `os.Rename` re-resolves paths, so the Slice-2
   `os.Root` pattern cannot express this swap; raw `*at` syscalls (the build is
   Linux-only) are the mechanism. Do not re-resolve pathnames (an attacker-writable
   *ancestor* defeats an immediate-parent stat).
5. **Download** `mathion_linux_<GOARCH>.tar.gz`, `checksums.txt`,
   `checksums.txt.asc` to a temp dir (seamed URLs).
6. **Verify:** `armor.Decode` the `.asc`, OpenPGP-verify the signature and require
   the signer is **S_rel** (§6.3, SHA-256+), then require exactly one matching
   sha256 line; any mismatch → abort, touch nothing.
7. **Pre-swap assertion (before any mutation):** extract accepting **exactly one
   regular file** named `mathion`; write it to an `O_EXCL` temp file **in the
   target's own directory** (same-fs → no `EXDEV`); `chmod 0755`; check every
   write/close/chmod; run the staged binary's **`version --short`** (a new flag
   that prints ONLY the baked tag — the full `version` reads `/etc`, probes HTTP,
   and emits dual-install warnings) and require it equals the **selected tag**
   (defeats a relabeled older-but-signed bundle before the swap — the honest baked
   version is itself signed). Abort on mismatch.
8. **Swap (durable order):** `fsync(temp)` → `renameat(temp → target)` →
   `fsync(parent dir)` — fsync-ing the directory *before* the rename does not
   persist the rename. Linux atomically replaces the running executable; no
   `ETXTBSY` — we never open the busy inode for write. Print old → new.

### 9.2 Dependencies
`ProtonMail/go-crypto/openpgp` (+ `openpgp/armor`), `golang.org/x/mod/semver`, and
direct `golang.org/x/sys/unix` for the `*at` swap (M2), pinned.

### 9.3 Plan-review corrections (2026-08-13) — MUST fold into the 4b plan
Found in the 4a plan review (codex, high effort) against §9; they are 4b-scope so
they were routed here rather than into the 4a plan:
1. **Enforce S_rel via the signature packet, not the entity (step 6).**
   `CheckDetachedSignatureAndHash` returns the primary `*Entity`; both subkeys share
   it, so an entity-fingerprint compare cannot reject an S_apt signature. Use
   **`VerifyDetachedSignatureAndHash`** and require the issuer fingerprint == S_rel,
   or build the verifying keyring from primary + S_rel only (the embedded keyring is
   already trimmed to that — §6.1 — so it is the primary enforcement). Add an
   explicit "S_apt-signed checksums rejected" test.
2. **Verify-until-verifiable, not greatest-tag-once (steps 3+6).** The §6.1 overlap
   rotation requires self-update to pick the **greatest release it can actually
   verify**: order eligible `cli-vX.Y.Z > current` descending and attempt
   verification until one passes (so a K1 client crosses via the K1-signed
   transition even when `latest` is K2-only). Document that crossing may take two
   invocations; add K1→transition(K1, embeds K2)→latest(K2) integration coverage.
3. **fd-relative execution + writable-ancestry refusal (steps 4+7).** Running the
   staged binary's `version --short` by pathname re-resolves ancestors (reintroduces
   the race step 4 closes), and a user-writable target parent lets the staged file be
   swapped between assertion and `renameat`. Execute through an inherited fd
   (`/proc/self/fd/…` or `execveat`), and refuse targets whose parent/ancestry is not
   root-owned and non-group/world-writable — or restrict standalone self-update to
   `/usr/local/bin/mathion`.
4. **Bound downloads; fetch+verify checksums before the archive (steps 5–6).** Fetch
   the (small) `checksums.txt` + `.asc` first, verify, then download the archive with
   explicit size + time limits. Bound the API JSON, signature, archive, and extracted
   binary sizes so a hostile origin cannot exhaust `/tmp`/root before verification.
   (install.sh's 4a analogue — verify checksums before the archive — is already
   folded into §8/Task 2.)

---

## 10. Dual-install detection & PATH precedence

`/usr/local/bin` precedes `/usr/bin`, so a curl|sh binary shadows an apt one and
`apt upgrade` can update a binary the shell never runs. Non-destructive detection:

- **`.deb` `postinst`:** warn if `/usr/local/bin/mathion` exists (§5 pitfalls).
- **`install.sh`:** warn if a dpkg-managed `mathion` exists (`dpkg -S`) before
  installing to `/usr/local/bin`.
- **`mathion version`:** if both paths exist, print which one `PATH` resolves
  (`exec.LookPath`) and how to remove the other — emitted **before** the
  not-installed/`.env`-unreadable early returns (version.go:37-47). Stat +
  `LookPath` behind func-var seams so `version_test.go` stays hermetic.
- **README:** "use apt **or** curl|sh, not both" + the precedence rule.
- **`--short` flag:** `mathion version --short` prints ONLY the baked CLI tag (no
  `.env` read, no HTTP probe, no dual-install warning) — used by self-update's
  pre-swap assertion (§9.1 step 7).

No path is ever deleted automatically.

---

## 11. CI / release integration

### 11.1 Environments & pinning
- **Two** protected environments (a single one cannot serve both — §11.4), holding
  **channel-specific subkeys** (§6.1) so the weak unattended one cannot forge the
  root-executed self-update channel:
  - **`release`** — new-release signing; holds **both** secrets (`S_rel` for the
    release job's `checksums.txt`, `S_apt` for the `apt-publish` job's `Release`) but
    each job imports and **runtime-asserts only its own** channel's subkey in its own
    `GNUPGHOME` (§6.1 isolation), so neither job silently arms the other channel;
    deployment restricted to `cli-v*` tags. (A stolen Actions token can't use the
    secrets off a release tag. Required reviewers optional — they add a manual approval
    per release; the tag restriction alone already blocks off-tag use.)
  - **`pages-resign`** — the scheduled re-sign; holds **only S_apt**; deployment
    restricted to `main`, **no required reviewers, wait-timer 0** (a `schedule:`
    run must be unattended). Because any push to `main` can rewrite this workflow
    and read its secret, S_apt is the only signer here — a compromise forges apt
    metadata but not `checksums.txt` (self-update pins S_rel). Env branch rules
    restrict eligible refs, not what trusted workflow code does with a released
    secret — hence the subkey split, not the env split alone.
- Signing secrets live only in these environments (never repo-wide, never in
  `test`/PR jobs).
- **SHA-pin** all actions in the signing/publish jobs (currently mutable @v7/@v6:
  `actions/checkout`, `actions/setup-go`, `goreleaser/goreleaser-action`, plus any
  new `upload/download-artifact` and gpg-import action) — full 40-char SHA +
  version comment.

### 11.2 `release-cli.yml` — release job (`environment: release`)
- Import **S_rel only** (goreleaser signs `checksums.txt` with it — §6.2 runner
  setup; `apt-publish` re-imports S_apt in its own homedir).
- **Prepare nfpm inputs** (gitignored/generated): gzip the man/changelog/notices and
  `gpg --dearmor` `mathion-apt-keyring.asc` → the packaged keyring, **before**
  goreleaser (else the tagged build aborts on missing `contents.src`).
- **Strictly validate** the `cli-vX.Y.Z` tag and **assert** `dpkg-deb -f … Version`
  == the stripped version after the build (nfpm's `file_name_template` uses
  `.Version`, so the stale "no template uses .Version" comment is replaced by this
  assertion).
- goreleaser emits `.deb` + `checksums.txt.asc`; `gh release create` uploads
  `dist/*.tar.gz dist/*.deb dist/checksums.txt dist/checksums.txt.asc`.
- **`upload-artifact`** the `dist/*.deb` + `checksums.txt`/`.asc` for `apt-publish`.

### 11.3 `release-cli.yml` — new `apt-publish` job (`needs: [release]`, tags only, `environment: release`)
- `permissions: contents: read` (the `gh-pages` push authenticates with the deploy
  PAT/App token, not `GITHUB_TOKEN`).
- Install `apt-utils` (`apt-ftparchive` is not preinstalled).
- **`download-artifact`** the same-run debs + checksums (do **not** re-download from
  Releases — that re-opens the origin-tamper window). Then **verify**
  `checksums.txt.asc` with the full acceptance rule (GOODSIG, `VALIDSIG` first field
  == S_rel, reject EXP/REV, exactly-one-line) and each `.deb`'s sha256 against its
  single checksum line **before** indexing/signing (never sign what wasn't verified).
- After importing S_apt, **assert channel isolation** (exactly one secret subkey, fpr
  == the pinned `S_APT_FPR` — §6.1) so a leaky export can't arm the S_rel channel here.
- **Anti-laundering (partial, scoped — §7.2):** if an `InRelease` already exists on
  `gh-pages`, verify it with the shared **`verify-inrelease.sh`** S_apt status-fd
  policy (gpg exit 0 + GOODSIG + `VALIDSIG` fpr in the `S_APT_VERIFY_FPRS` allowlist +
  reject EXP/REV — a bare `gpg --verify` exit code is 0 on an expired/revoked signature)
  and **refuse** if it fails, before mutating. The allowlist accepts the outgoing-signed
  prior `InRelease` at a rotation cutover; `build.sh` still signs the new `Release` with
  the single `S_APT_FPR`.
  This does **not** re-verify each accumulated pool `.deb` against the signed
  `Packages` before re-indexing; that residual is scoped to `PAGES_DEPLOY_TOKEN` ==
  repo write (out of scope, §1.1). Dearmor the published keyring deterministically from
  `mathion-apt-keyring.asc` (never a per-job export).
- Sign the `Release` with **S_apt**.
- **Two checkouts** (avoids the "tag's `deploy/apt` script is absent on gh-pages"
  problem): tag tree into the default path, `gh-pages` into `./pages`; run the
  tag's `deploy/apt` script writing into `./pages/deb`; commit + push inside
  `./pages`.
- **Trigger a Pages rebuild.** A push made with the default `GITHUB_TOKEN` does
  **not** trigger a Pages build, so `/deb` would go stale. Publish so a build
  actually fires: request one via the Pages API (`POST /repos/…/pages/builds`,
  `permissions: pages: write`), push with a scoped deploy PAT / GitHub-App token,
  or switch to an Actions-source `deploy-pages` job. Finalize the mechanism in the
  plan; `.nojekyll` lives at the branch root (§7.1), not under `deb/`.
- **Cold start:** `mkdir -p` pool/dists; tolerate no prior by-hash; if the
  `gh-pages` branch doesn't exist, create it (or fail with a clear "run the §14
  prereq" message).
- **Serialize** with a `concurrency:` group whose string is **identical** in
  `apt-publish` and `apt-resign` (a literal, not `${{ github.workflow }}-…`) and
  `cancel-in-progress: false`; push with rebase/retry.

### 11.4 `apt-resign.yml` (scheduled, `environment: pages-resign`)
Periodic (well inside `Valid-Until`), unattended, `permissions: contents: read`.
Uses the **same two-checkout layout as §11.3** (the `deploy/apt` script lives on
`main`, not on `gh-pages`): default-branch script tree + `gh-pages` state into
`./pages`. After importing S_apt it **asserts channel isolation** (exactly one secret
subkey, fpr == the pinned `S_APT_FPR` — §6.1), then runs **`resign.sh <repo-root>
<signing-S_apt-fpr> <trusted-apt-keyring.asc> <verify-allowlist-fprs>` (dates-only)** —
`verify-inrelease.sh` extracts the S_apt-authenticated `InRelease` payload, bump only
`Date`/`Valid-Until`, re-sign `InRelease`+`Release.gpg` with the single **S_apt** signing
fpr — so it **never re-reads or re-indexes `pool/`** and needs **no
`apt-utils`/`apt-ftparchive`**. This makes the genuinely-unattended job
**laundering-proof by construction** (§7.2): the `verify-inrelease.sh` status-fd policy
gate (gpg exit 0 + GOODSIG + `VALIDSIG` fpr in the `S_APT_VERIFY_FPRS` allowlist +
reject EXP/REV — **not** a bare gpg exit code, which is 0 on an expired/revoked
signature) *is* the anti-laundering gate (fail-closed on a bad/expired/revoked/
wrong-signer `InRelease`), and it no-ops gracefully on cold start (no `InRelease` yet).
The allowlist accepts the outgoing-signed `InRelease` during a rotation overlap while
the job keeps signing with the outgoing fpr (§6.1). Triggers a
Pages rebuild (§11.3) via `PAGES_DEPLOY_TOKEN`; same concurrency group as
`apt-publish`; push with rebase/retry.

### 11.5 PRs & the hermetic e2e
PRs run unit + static validation **plus** the secretless hermetic apt e2e (§12) —
it uses a **throwaway** key and no production secrets, so it is safe to gate PRs;
its home is `ci.yml` (or the path-filtered `release-cli.yml` `test` leg). Signing
with the production subkey happens only on `cli-v*` tags + the schedule.

---

## 12. Testing strategy

- **Go unit (`cli/internal/selfupdate`, `cli/cmd/self_update_test.go`)** — via the
  seams above (HTTP base URL, download URL, dpkg exec, swap target path):
  channel detection (owned-by-`mathion` vs `no path found` vs dpkg-error-aborts,
  resolved-path query), forward-gate (skip on `latest <= current`, refuse
  downgrade, `cli-*` filter over a mixed release list, `dev` proceeds), verify
  **fail-closed** on tampered archive / tampered signature / wrong / **expired** /
  **revoked** key (via `VerifyDetachedSignatureAndHash` with the issuer pinned to the
  S_rel subkey — §6.3/§9.3), exactly-one-line, and the
  staged swap asserting resulting mode **`0755`** and rejecting a tar with ≠1
  regular `mathion` member. Throwaway test key only. Byte-identity test:
  in-package pubkey == `deploy/keys/mathion-pubkey.asc`
  (`os.ReadFile("../../../deploy/keys/…")`), plus a CI `cmp`. The pre-swap "run
  staged `version --short`" and the live post-swap check are **integration-only**.
- **`deploy/install_sh_test.sh`:** `.asc` happy path, tampered-signature abort,
  **wrong-channel** (S_apt-signed `checksums.txt`) rejection, `gpg`-absent abort,
  **expired**- and **revoked**-key rejection (status-fd), and the greatest-stable
  resolver skipping a prerelease/lower tag.
- **`deploy/apt/resign_test.sh`:** the dates-only resign over a throwaway-key repo,
  seven cases — valid refresh (Valid-Until advances, pool hash block byte-identical);
  `verify-inrelease.sh` fail-closed on tampered (non-zero gpg exit) / **expired** /
  **revoked**; **wrong-signer exercising the fpr pin** (keyring holds both signers, the
  `InRelease` carries a real `GOODSIG` by the non-allowlisted one → rejected at the
  `VALIDSIG` allowlist, not at "no GOODSIG"); cold-start no-op; and **rotation overlap**
  (outgoing-signed `InRelease` + allowlist "outgoing incoming" → accepted and re-signed,
  proving the §6.1 cutover). Focused probes also assert a rejected verify leaves
  `<out-body>` unwritten (staged output).
- **Package structure:** assert the keyring ships as ordinary data and is **absent
  from `DEBIAN/conffiles`**; `dpkg-deb -f mathion_*.deb Version` == `0.2.0`; a first
  install cleanly overwrites an admin-placed
  `/usr/share/keyrings/mathion-archive-keyring.gpg` with no dpkg prompt.
- **Hermetic apt e2e (CI PR gate):** build + sign a repo with a throwaway key via
  the real `apt-ftparchive generate` config, serve `/deb` over localhost HTTP, add
  the `signed-by` source, `apt update` + `apt install mathion`, assert
  `/usr/bin/mathion` runs — exercises `Release` signatures, per-arch index paths,
  by-hash, and `signed-by` (a bare local `.deb` install does not).
- **`amd64-smoke.yml`:** opt-in leg — local `apt-get install ./mathion_*.deb`,
  assert the dual-install `postinst` warning fires with a `/usr/local/bin` copy
  present; cleanup `apt-get remove mathion`.
- **Static validation** (`bash -n` + `shellcheck`) on all new shell.
- A full `apt update` against the **live** Pages repo remains a documented manual
  on-host smoke (like backup/restore).

---

## 13. Docs (README + `deploy/keys/README.md`)

apt install (package-managed keyring → source → `apt install mathion`); the key
**fingerprint** for out-of-band verification (bootstrap is TOFU);
`mathion self-update` usage + apt-managed deferral; PATH-precedence + one-channel
guidance; and in `deploy/keys/README.md` the key generation, `!`-scoped private
secret-subkey export (channel isolation), subkey rotation (overlap-signing), and
revocation/compromise procedure.

---

## 14. Manual prerequisites (one-time, maintainer)

1. Generate the offline **primary** (Ed25519 / RSA ≥ 3072, cert-only) + **two
   signing subkeys S_rel and S_apt** (with expiry) + a revocation certificate
   (offline). Export each signing subkey's **private** material **alone** with the
   trailing `!` selector — `gpg --armor --export-secret-subkeys "<S_rel-fpr>!"` and
   `… "<S_apt-fpr>!"` (a bare `--export-secret-subkeys <primary>` leaks BOTH channels'
   secrets into one blob; verify each imports to exactly one `ssb` in a throwaway
   `--homedir` — §6.1) — then set them as secrets: **`GPG_S_REL_PRIVATE` +
   `GPG_S_APT_PRIVATE`** in `release`, **only `GPG_S_APT_PRIVATE`** in `pages-resign`
   (each signing job runtime-asserts it holds exactly its own channel's subkey).
   Commit **two trimmed public keyrings** (channel separation — never one full key):
   `mathion-pubkey.asc` =
   primary + S_rel (embedded in install.sh + the 4b binary), and
   `mathion-apt-keyring.asc` = primary + S_apt (CI dearmors it to the apt keyring in
   the `.deb` + on Pages). Record `EXPECTED_PRIMARY_FPR`, `EXPECTED_SIGNING_FPR`
   (S_rel subkey — install.sh pins it), and create env/repo **variables** `S_REL_FPR`
   + `S_APT_FPR`. Leave `S_APT_VERIFY_FPRS` **unset** in steady state (publish/resign
   fall back to `S_APT_FPR`); during an S_apt rotation overlap set it to
   `"<outgoing-fpr> <incoming-fpr>"` so the outgoing-signed `InRelease` verifies at
   cutover (§6.1).
2. Create an empty `gh-pages` branch; enable **GitHub Pages** (source = `gh-pages`).
   Create a fine-grained PAT / GitHub-App token with `contents:write` on this repo and
   store it as **`PAGES_DEPLOY_TOKEN`** in **both** environments — the gh-pages push
   uses it, not `GITHUB_TOKEN` (a `GITHUB_TOKEN` push to `gh-pages` does not trigger a
   Pages build), which is why both gh-pages jobs run `permissions: contents: read`.
3. Configure the two protected environments (`release` tag-scoped, rule = branches
   AND tags with `cli-v*`; `pages-resign` main-scoped, unattended), `cli-v*` tag
   protection, and SHA-pin the release/publish/resign actions. Note: scheduled
   workflows auto-disable after 60 days of repo inactivity — monitor apt freshness.

---

## 15. Scope boundaries (YAGNI — explicitly out)

- No systemd unit / shell-completion packaging (man page **is** in — M3).
- No shipped `unattended-upgrades` config (documented, not installed).
- No `.rpm`, AUR, or Homebrew formula.
- No multi-suite / backports / component split — single `stable main`.
- No `.deb` auto-removal / install-abort on dual-install (warn only).
- No `self-update` version-pin argument (forward-only to latest).
- No automated `pool/` pruning (retention documented — §7.4).
- No signed "latest" freshness manifest for the self-update channel — the freeze
  limitation (§1.1) is documented and deferred.
- Versioned archive filenames as extra cryptographic version-binding: **optional**;
  the pre-swap version assertion (§9.1 step 7) already defeats relabel/downgrade,
  so we keep the current unversioned archive names to avoid `install.sh` churn.

**Required scope (per review — not YAGNI):** forward-gate + pre-swap version assert
(§9), key lifecycle + overlap-signing + package-managed keyring + `!`-scoped
secret-subkey export/isolation (§6.1), `Valid-Until` + `Acquire-By-Hash` +
**policy-verified dates-only resign** schedule (`verify-inrelease.sh` status-fd gate,
no pool re-index — §7.2, §11.4), verify-before-index in `apt-publish` (§11.3), split
CI environments (§11.1), hermetic apt e2e (§12), TOCTOU-safe swap (§9.1).

---

## 16. Trust model summary

| Channel | Integrity | Authenticity (this slice) |
|---------|-----------|---------------------------|
| apt (steady state) | `Packages` sha256 | `Release`/`InRelease` signed by **S_apt** w/ `Valid-Until`, verified via package-managed `/usr/share/keyrings/mathion-archive-keyring.gpg` (subkey rotation refreshed by `apt upgrade`) |
| apt (bootstrap) | — | **TOFU** — key added over HTTPS from Pages; verify fingerprint out-of-band (independent channel) |
| curl\|sh install.sh (bootstrap) | sha256 vs `checksums.txt` | `GOODSIG` + **S_rel subkey** fpr (VALIDSIG first field) + primary fpr, no `EXP/REVKEYSIG` (status-fd), vs **embedded primary+S_rel** pubkey — channel-enforced (an S_apt compromise can't forge it), but the key ships **with** the script → first-install TOFU / origin trust |
| `mathion self-update` (steady state) | sha256 vs `checksums.txt` | `checksums.txt.asc` (armor-decoded, issuer pinned to **S_rel** via `VerifyDetachedSignatureAndHash`, non-expired/revoked) vs **compile-time-embedded primary+S_rel** pubkey — genuinely pinned; forward-only + pre-swap version assertion. **No signed freshness bound** → an origin attacker can freeze (documented) |

One offline primary + two rotating CI signing subkeys (**S_rel** for
checksums/self-update, **S_apt** for apt metadata), **channel separation enforced on
the verify side** — each verifier embeds only its channel's subkey (install.sh/4b →
primary+S_rel; apt → primary+S_apt). Two trimmed committed public keyrings. Post-
bootstrap anchors are pinned; the design does **not** claim the first-install
bootstrap is cryptographically self-authenticating.
