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
- One GPG key (long-lived offline **primary** + a CI-held signing **subkey**)
  authenticating **both** channels — the apt repo `Release` **and** the curl|sh
  release archives — closing the "integrity only, not authenticity" gap
  `deploy/install.sh` flags.
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
| D2 | signing scope | **Both channels, one key**: sign the apt repo `Release`, and sign `checksums.txt` for the curl|sh + self-update channel |
| D3 | CLI self-update | **Dedicated `mathion self-update`**, channel-aware (apt-managed → defer to apt; curl-managed → verify + forward-only swap) |
| D4 | dual-install conflict | **Detect + warn, never auto-delete** |

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
checksums/self-update, S_apt for apt metadata — §6.1). Everywhere a key is "the
key", it is the **full transferable public key including both signing subkeys** —
apt/gpgv and go-crypto verify a *subkey's* signature and need that subkey's public
packet + its primary binding signature in the keyring; a primary-only export fails.

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
| `cli/.goreleaser.yaml` | modify | `nfpms:` (`.deb` incl. keyring/man/copyright/changelog; explicit version stripping `cli-v`; `maintainer`/`description`/`homepage`); `signs:` with **`artifacts: checksum`**, exact subkey, `${artifact}.asc`, `--armor`, batch/loopback, `stdin` passphrase |
| `deploy/keys/mathion-pubkey.asc` | create | **canonical** full public key (primary + signing subkey) — source of truth |
| `deploy/keys/README.md` | create | key generation, subkey rotation (overlap-signing), revocation/compromise procedure, fingerprint |
| `cli/internal/selfupdate/mathion-pubkey.asc` | create | in-package copy for `go:embed`; a unit test `os.ReadFile("../../../deploy/keys/mathion-pubkey.asc")` asserts byte-identity, plus a CI `cmp` guard |
| `cli/internal/selfupdate/` | create | release LIST+filter, download, `armor.Decode` + OpenPGP verify (`CheckDetachedSignatureAndHash`, SHA-256+, signer pinned to S_rel), semver forward-gate, `dpkg -S` channel detect, `x/sys/unix` `openat`/`renameat` TOCTOU-safe staged swap. Seams: HTTP base URL, download URL, dpkg exec func-var, swap **target path as a parameter** |
| `cli/cmd/self_update.go` (+ `_test.go`) | create | command wiring; `requireRoot()` only before the curl-channel mutation |
| `cli/cmd/version.go` | modify | dual-install warning **before** the not-installed/unreadable early returns; stat + `exec.LookPath` behind func-var seams for hermetic tests |
| `cli/cmd/root.go` | modify | register `newSelfUpdateCmd` |
| `deploy/install.sh` | modify | verify `checksums.txt.asc` against the **literally-embedded** pubkey via `--status-fd` (GOODSIG + expected fpr, reject EXP/REVKEYSIG), exactly-one checksum line, before sha256; align latest-tag resolution with self-update |
| `deploy/man/mathion.1` | create | man page; packaged pre-gzipped (`gzip -9n`) as `mathion.1.gz` |
| `deploy/apt/` | create | `apt-ftparchive` config (`Tree{}`, `DoByHash`) + repo build/publish + `Valid-Until` computation; shared by publish + resign |
| `.github/workflows/release-cli.yml` | modify | `release` env for secrets; `upload-artifact` debs; `apt-publish` job (download-artifact, **verify**, generate, two-checkout push, `contents: write`, concurrency) |
| `.github/workflows/apt-resign.yml` | create | scheduled **regenerate**-then-re-sign in a **separate unattended** env |
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

## 6. Signing — one key (offline primary + CI subkey), both channels

### 6.1 Key material & lifecycle
- **Offline primary** (Ed25519, or RSA ≥ 3072), never in CI; users' keyrings and
  the CLI/install.sh embed the **full public key including both signing subkeys**.
- **Two channel-specific signing subkeys** under the one primary (each with a set
  expiry, e.g. 2 years): **S_rel** signs `checksums.txt` (curl|sh + self-update)
  and **S_apt** signs the apt `Release`. Rationale (§11.1): the always-on
  *unattended* re-sign job holds **only S_apt**, so a compromise of that weak
  automation can forge apt metadata but **cannot** forge the root-executed
  self-update binary — self-update pins S_rel's fingerprint and rejects an
  S_apt-signed `checksums.txt`. Only the relevant subkey secret enters each
  environment. Pin digest algos (`--digest-algo SHA256`+, `--cert-digest-algo
  SHA256`+) so nothing falls back to SHA-1 on an old gpg.
- **Rotation is NOT free — the "no re-add" benefit is bounded.** A `signed-by`
  keyring is a one-time snapshot; verifiers holding only the *old* subkey cannot
  verify a *new* subkey's signatures. Mechanics that make rotation safe:
  - **apt:** the keyring is **package-managed** (shipped by the `.deb` to
    `/usr/share/keyrings/mathion-archive-keyring.gpg`; `sources.list` `signed-by`
    points there). A rotation ships in the next `.deb` release, so `apt upgrade`
    refreshes the keyring with the new subkey — no manual re-add. (Steady-state
    only; cold-start bootstrap still installs the key manually — §7.3.)
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
  `--batch --pinentry-mode loopback`, passphrase via `signs.stdin`. Signs
  `checksums.txt` (which pins every artifact incl. the `.deb`) → one signature.
- apt `Release` signing (§7) uses **S_apt** identically (`--local-user
  <S_apt-fpr>!`).
- Runner GPG setup (each of the 3 signing jobs — release, apt-publish, apt-resign
  — is a fresh runner): private `GNUPGHOME` (0700), import the armored subkey,
  `allow-loopback-pinentry` in `gpg-agent.conf` + reload, then sign. A vetted
  SHA-pinned import action is acceptable in lieu of hand-rolling.

### 6.3 Verification (anchors pinned only post-bootstrap — §1.1)
- `self-update`: **`armor.Decode`** the `.asc` first (require a `PGP SIGNATURE`
  block — goreleaser emits ASCII armor, which `CheckDetachedSignatureAndHash` will
  **not** accept raw), then `CheckDetachedSignatureAndHash(keyring, checksums,
  body, [SHA256,SHA384,SHA512])` against the **compile-time-embedded** pubkey; use
  the returned signer to require it is **S_rel** (reject an S_apt-signed
  `checksums.txt`); then require **exactly one** matching sha256 line for the
  archive.
- `install.sh`: verify against the **literally-embedded** pubkey (here-doc, never a
  downloaded key) in a private `GNUPGHOME` (0700), `--batch --no-tty --status-fd 1`.
  Accept only a `GOODSIG`/`VALIDSIG` for the **expected fingerprint** with the
  **absence** of `EXPKEYSIG`/`REVKEYSIG`/`EXPSIG`/`ERRSIG`/`BADSIG` — a bare
  `VALIDSIG` is emitted *alongside* `EXPKEYSIG`/`REVKEYSIG`, so it does not by
  itself reject an expired or revoked key (nor does the exit code, which can be 0).
  Explicit one-line count (`[ "$(grep -c …)" = 1 ]`). Fail closed if `gnupg` is
  absent.
- apt: verifies against `/usr/share/keyrings/mathion-archive-keyring.gpg`.
- Equivalence: signing `checksums.txt` ≡ signing each artifact **iff** consumers
  require exactly one matching sha256 line — now enforced explicitly on both paths.

---

## 7. apt repo on GitHub Pages

### 7.1 Layout (`gh-pages` branch, served at `https://svkucheryavski.github.io/mathion`)
```
.nojekyll                                     (at the PUBLISHING-SOURCE / branch ROOT — NOT under deb/ — disables Jekyll)
deb/
  mathion-archive-keyring.gpg                 (dearmored, for the cold-start bootstrap)
  pool/main/m/mathion/mathion_<ver>_<arch>.deb   (accumulate)
  dists/stable/
    Release  InRelease  Release.gpg
    main/binary-amd64/Packages{,.gz}   binary-arm64/Packages{,.gz}
    main/binary-*/by-hash/SHA256/<hash>        (current + previous retained)
```

### 7.2 Index generation (exact tooling)
Build with **`apt-ftparchive generate <config>`** (NOT standalone `packages`,
which mixes arches and emits no by-hash) over the git-tracked `pool/`:

1. Copy new release `.deb`s into `pool/main/m/mathion/`.
2. `generate` config with a `Tree { … Architectures "amd64 arm64"; Sections
   "main"; }` block (filters each `binary-<arch>/Packages` to that arch) and
   `APT::FTPArchive::DoByHash "true"` (creates the `by-hash/SHA256/` files;
   retain current + previous). `Filename:` paths are relative to `/deb`.
3. `apt-ftparchive release dists/stable` (auto-emits the `MD5Sum`/`SHA256`
   per-index sections apt requires) with explicit `Origin`, `Label`, `Suite`
   (`stable`), `Codename` (`stable`), `Components` (`main`), `Architectures`
   (`amd64 arm64`), `Date`, `Acquire-By-Hash: yes`, and a bounded **`Valid-Until`**
   computed by the script (`date -R -u -d '+N days'` — apt-ftparchive won't emit it
   reliably on its own).
4. Sign with **S_apt** non-interactively: `gpg … --clearsign -o InRelease Release`
   and `gpg … -abs -o Release.gpg Release`.
5. Publish to `gh-pages` (§11.3).

**Freshness:** `Valid-Until` bounds replay/freeze. Because it expires, a scheduled
job (§11.4) **regenerates** `Release` (fresh `Date`/`Valid-Until` over the
unchanged committed `pool/`) then re-signs — re-clearsigning the *existing* bytes
would preserve the stale dates and refresh nothing.

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

Before the existing sha256 step: download `checksums.txt` + `checksums.txt.asc`;
in a private `GNUPGHOME` (0700) import the **literally-embedded** pubkey (here-doc,
never downloaded), `gpg --batch --no-tty --import`, then verify with
`--status-fd 1`. Accept only a `GOODSIG`/`VALIDSIG` for the **expected
fingerprint** with **no** `EXPKEYSIG`/`REVKEYSIG`/`EXPSIG`/`ERRSIG`/`BADSIG` (a
bare `VALIDSIG` accompanies expired/revoked keys, and the exit code can be 0 for
them). Require exactly one checksum line for the asset (`grep -c`). Abort if
`gnupg` is absent. Additionally, **align install.sh's tag resolution with
self-update's rule** — select the greatest **stable** `cli-vX.Y.Z` (skip
prereleases), not the first API-ordered match. The "Integrity only … signing is
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
  - **`release`** — new-release signing; holds **S_rel + S_apt**; deployment
    restricted to `cli-v*` tags. (A stolen Actions token can't use the secrets off
    a release tag. Required reviewers optional — they add a manual approval per
    release; the tag restriction alone already blocks off-tag use.)
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
- Import **S_rel** (goreleaser signs `checksums.txt` with it — §6.2 runner setup).
- goreleaser emits `.deb` + `checksums.txt.asc`; `gh release create` uploads
  `dist/*.tar.gz dist/*.deb dist/checksums.txt dist/checksums.txt.asc`.
- **`upload-artifact`** the `dist/*.deb` + `checksums.txt`/`.asc` for `apt-publish`.

### 11.3 `release-cli.yml` — new `apt-publish` job (`needs: [release]`, tags only, `environment: release`)
- `permissions: contents: write` (top-level is `read`; needed to push `gh-pages`).
- **`download-artifact`** the same-run debs + checksums (do **not** re-download from
  Releases — that re-opens the origin-tamper window). Then **verify**
  `checksums.txt.asc` against the pinned pubkey and each `.deb`'s sha256 against its
  single checksum line **before** indexing/signing (never sign what wasn't
  verified).
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
Periodic (well inside `Valid-Until`), unattended. Uses the **same two-checkout
layout as §11.3** (the `deploy/apt` script lives on `main`, not on `gh-pages`):
default-branch script tree + `gh-pages` state into `./pages`. **Regenerates**
`Release` (fresh `Date`/`Valid-Until` over the committed `pool/`), re-signs
`InRelease`+`Release.gpg` with **S_apt**, and triggers a Pages rebuild (§11.3) —
same concurrency group as `apt-publish`. No-ops gracefully if
`dists/stable/Release` doesn't exist yet.

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
  **revoked** key (via `CheckDetachedSignatureAndHash`), exactly-one-line, and the
  staged swap asserting resulting mode **`0755`** and rejecting a tar with ≠1
  regular `mathion` member. Throwaway test key only. Byte-identity test:
  in-package pubkey == `deploy/keys/mathion-pubkey.asc`
  (`os.ReadFile("../../../deploy/keys/…")`), plus a CI `cmp`. The pre-swap "run
  staged `version --short`" and the live post-swap check are **integration-only**.
- **`deploy/install_sh_test.sh`:** `.asc` happy path, tampered-signature abort,
  `gpg`-absent abort, **expired**- and **revoked**-key rejection (status-fd), and
  the greatest-stable resolver skipping a prerelease/lower tag.
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
guidance; and in `deploy/keys/README.md` the key generation, subkey rotation
(overlap-signing), and revocation/compromise procedure.

---

## 14. Manual prerequisites (one-time, maintainer)

1. Generate the offline **primary** (Ed25519 / RSA ≥ 3072) + **two signing subkeys
   S_rel and S_apt** (with expiry) + a revocation certificate (offline). Export
   **S_rel + S_apt** into the `release` environment and **only S_apt** into
   `pages-resign`; commit the **full public key** (primary + both subkeys) to
   `deploy/keys/mathion-pubkey.asc` (+ the in-package copy), and place the dearmored
   keyring at the Pages `deb/` root for cold-start.
2. Create an empty `gh-pages` branch; enable **GitHub Pages** (source = `gh-pages`).
3. Configure the two protected environments (`release` tag-scoped;
   `pages-resign` main-scoped, unattended), `cli-v*` tag protection, and SHA-pin the
   release/publish/resign actions.

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
(§9), key lifecycle + overlap-signing + package-managed keyring (§6.1), `Valid-Until`
+ `Acquire-By-Hash` + regenerate-then-resign schedule (§7.2, §11.4), verify-before-
index in `apt-publish` (§11.3), split CI environments (§11.1), hermetic apt e2e
(§12), TOCTOU-safe swap (§9.1).

---

## 16. Trust model summary

| Channel | Integrity | Authenticity (this slice) |
|---------|-----------|---------------------------|
| apt (steady state) | `Packages` sha256 | `Release`/`InRelease` signed by **S_apt** w/ `Valid-Until`, verified via package-managed `/usr/share/keyrings/mathion-archive-keyring.gpg` (subkey rotation refreshed by `apt upgrade`) |
| apt (bootstrap) | — | **TOFU** — key added over HTTPS from Pages; verify fingerprint out-of-band (independent channel) |
| curl\|sh install.sh (bootstrap) | sha256 vs `checksums.txt` | `GOODSIG`+fingerprint, no `EXP/REVKEYSIG` (status-fd), vs **embedded** pubkey — but the key ships **with** the script → TOFU / origin trust |
| `mathion self-update` (steady state) | sha256 vs `checksums.txt` | `checksums.txt.asc` (armor-decoded, signer pinned to **S_rel**, non-expired/revoked) vs **compile-time-embedded** pubkey — genuinely pinned; forward-only + pre-swap version assertion. **No signed freshness bound** → an origin attacker can freeze (documented) |

One offline primary + two rotating CI signing subkeys (**S_rel** for
checksums/self-update, **S_apt** for apt metadata). One canonical committed public
source of truth. Post-bootstrap anchors are pinned; the design does **not** claim
the first-install bootstrap is cryptographically self-authenticating.
