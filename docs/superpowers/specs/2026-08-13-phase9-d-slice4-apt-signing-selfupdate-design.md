# Phase 9-D Slice 4 — apt packaging, release signing, CLI self-update

**Status:** design v2 (brainstorm + codex design-review folded; open items in §3)
**Date:** 2026-08-13
**Predecessors:** Slice 1 (deployment foundation), Slice 2 (the `mathion` Go CLI),
Slice 3 (backup/restore/update + backend `/version`). All merged to `main`;
`cli-v0.2.0` + app `v0.2.0` shipped.

---

## 1. Goal

Give Mathion a first-class, cryptographically-authenticated distribution path:

- `apt install mathion` from a signed apt repository hosted on GitHub Pages.
- A signed `.deb` built in the existing goreleaser release.
- One GPG key (long-lived primary + rotating signing subkey) authenticating
  **both** channels — the apt repo `Release` **and** the curl|sh release archives
  — closing the "integrity only, not authenticity" gap `deploy/install.sh` flags.
- `mathion self-update` — a channel-aware, signature-verified, **forward-only**
  in-place upgrade of the CLI binary, distinct from `mathion update` (which
  updates the **app**, not the CLI).
- Non-destructive detection of the dual-install / PATH-precedence footgun.

This slice touches distribution and the CLI only. No backend or frontend changes.

## 1.1 Threat model (scope of what signing buys)

- **Single-maintainer repo.** The only principal who can push `cli-v*` tags or
  merge is the maintainer; there are no third-party committers. The signing work
  therefore defends primarily against: a compromised download/CDN host (GitHub
  Pages / Releases origin), a compromised CI token or maintainer account (limit
  blast radius, not grant it), and network-position attackers.
- **Bootstrap trust is TOFU.** A one-line `curl … | sh` or the apt key-add step
  cannot cryptographically self-authenticate: the script/key arrive over the same
  HTTPS origin as everything else. First-install trust = TLS + GitHub origin +
  an **out-of-band-publishable fingerprint**. The pinned anchor is real only
  *after* bootstrap: `self-update` verifies against a **compile-time-embedded**
  key inside a binary the user already trusts, and apt verifies against the
  keyring already installed on the box.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | apt repo hosting | **GitHub Pages** (`gh-pages` branch, path `/deb`); repo state = the `.deb` files tracked in git |
| D2 | signing scope | **Both channels, one key**: sign the apt repo `Release`, and sign `checksums.txt` for the curl|sh + self-update channel |
| D3 | CLI self-update | **Dedicated `mathion self-update`**, channel-aware (apt-managed → defer to apt; curl-managed → verify + forward-only swap) |
| D4 | dual-install conflict | **Detect + warn, never auto-delete** (postinst, install.sh, `mathion version`) |

## 3. Open decisions

- **M1 — distribution license: RESOLVED → Apache-2.0.** Add a repo-root `LICENSE`
  (Apache-2.0; SPDX `Apache-2.0`) covering the whole repository. The `.deb`'s
  `/usr/share/doc/mathion/copyright` (Debian machine-readable `copyright` format)
  states Apache-2.0 and bundles third-party notices for the statically-linked Go
  deps (cobra + mousetrap Apache-2.0; pflag BSD-3; go-crypto BSD-style),
  generated via `go-licenses`. This unblocks package publishing. (Chosen for the
  explicit patent grant + trademark carve-out + contribution terms over MIT.)
- **M2 — new Go dependency (recommended: yes).** Add
  `github.com/ProtonMail/go-crypto/openpgp` for in-CLI detached-signature verify.
  Pin the version; constrain accepted digests to SHA-256-or-stronger; negative-test
  expired/revoked/mismatched keys. Avoids a runtime `gpg` dependency on minimal
  servers. The CLI's second direct dependency (after `spf13/cobra`).
- **M3 — man page (now IN scope).** Debian Policy §12.1 treats a binary without a
  man page as a defect (lintian `binary-without-manpage`). Ship a `mathion.1`
  (generated from Cobra or hand-written). The rest of §15's exclusions stand.

---

## 4. Architecture overview

Two authenticated channels, one trust anchor (a long-lived GPG primary key, with
a CI-held signing **subkey**):

```
                         ┌── release (goreleaser, tag cli-vX.Y.Z) ─┐
                         │  build mathion (amd64,arm64)             │
                         │  archives -> mathion_linux_*.tar.gz      │
                         │  nfpm     -> mathion_*.deb               │
                         │  signs    -> checksums.txt + .asc        │
                         │            (exact subkey, --armor, batch)│
                         └───────────────┬─────────────────────────┘
                                         │ gh release upload (.tar.gz, .deb, checksums, .asc)
                          ┌──────────────┴───────────────┐
        curl|sh channel   │                              │  apt channel (apt-publish job)
        install.sh (TOFU  │                              │  download released .debs,
        bootstrap) +      │                              │  apt-ftparchive per-arch,
        self-update       │                              │  Release(Date,Valid-Until,
        verify .asc vs    │                              │  Acquire-By-Hash) ->
        pinned pubkey     │                              │  InRelease + Release.gpg,
                          │                              │  publish to gh-pages /deb
                          └──────────────────────────────┘
```

**Same key** signs `checksums.txt` and the apt `Release`. The **primary public
key** is the verification anchor: committed as the canonical source of truth,
embedded into the CLI for `self-update`, embedded into `install.sh`, and served on
Pages for apt users to install into `/etc/apt/keyrings/mathion.gpg`. CI holds only
the **signing subkey**, so routine rotation never forces users to re-add the key.

### 4.1 Component / file map

| Path | Change | Responsibility |
|------|--------|----------------|
| `LICENSE` | create | repo-root Apache-2.0 license text (M1) |
| `cli/.goreleaser.yaml` | modify | add `nfpms:` (`.deb`, ships man page + copyright) and `signs:` (explicit subkey, `${artifact}.asc`, `--armor`, batch/loopback) |
| `deploy/keys/mathion-pubkey.asc` | create | **canonical** ASCII-armored primary public key (source of truth) |
| `cli/internal/selfupdate/mathion-pubkey.asc` | create | in-package copy for `go:embed` (embed cannot traverse `..`/leave the module); CI/test asserts byte-identity with the canonical copy |
| `cli/internal/selfupdate/` | create | release resolution, download, OpenPGP verify (embedded pubkey), sha256, semver forward-gate, atomic staged swap, channel detection |
| `cli/cmd/self_update.go` (+ `_test.go`) | create | `mathion self-update` wiring (root required only before the curl-channel mutation) |
| `cli/cmd/version.go` | modify | dual-install warning emitted **before** the not-installed/unreadable early returns |
| `cli/cmd/root.go` | modify | register `newSelfUpdateCmd` |
| `deploy/install.sh` | modify | verify `checksums.txt.asc` against the **literally-embedded** pubkey before the existing sha256 check |
| `deploy/man/mathion.1` | create | man page shipped in the `.deb` |
| `deploy/apt/` | create | `apt-ftparchive` config + repo build/publish script (also used by a scheduled re-sign) |
| `.github/workflows/release-cli.yml` | modify | protected `release` environment for secrets; upload `.deb`+`.asc`; add `apt-publish` job (downloads released debs, checks out tag's `deploy/apt`, concurrency-guarded gh-pages push) |
| `.github/workflows/apt-resign.yml` | create | scheduled re-sign to refresh `Date`/`Valid-Until` (same protected environment) |
| `README.md` | modify | apt install (keyring in `/etc/apt/keyrings`), key fingerprint, self-update usage, PATH-precedence note |

---

## 5. The `.deb` package (nfpm inside goreleaser)

- **Package** `mathion`; **binary** → `/usr/bin/mathion` (Debian policy forbids
  `/usr/local`); **arch** amd64 + arm64; **version** = goreleaser's sanitized
  semver (`cli-v0.2.0` → `0.2.0`); **section** `admin`, **priority** `optional`.
- **No Docker dependency relation.** `Recommends` is installed by apt **by
  default**, so `Recommends: docker.io` would pull it and can conflict with users
  on Docker's own `docker-ce`. Use `Suggests: docker.io` at most, or no relation;
  the CLI already probes Docker at runtime.
- **`postinst`:** warn (never delete) if `/usr/local/bin/mathion` exists — it
  shadows this apt copy on the default `PATH` (see §10).
- **Ships** `/usr/share/doc/mathion/copyright` (Apache-2.0 per M1 + bundled
  third-party notices) and `/usr/share/man/man1/mathion.1.gz` (M3).
- **Not** individually debsig-signed: apt trust comes from the signed repo
  `Release` (§7); a local `apt-get install ./file.deb` performs no signature check
  regardless. One signature system, no redundancy.

---

## 6. Signing — one key (primary + CI subkey), both channels

### 6.1 Key material & lifecycle
- **Long-lived primary key**, kept **offline** on the maintainer's machine — never
  in CI. Users' keyrings and the CLI/install.sh embed the **primary public key**.
- A **signing subkey** (with expiry, e.g. 2 years) does all CI signing. Only the
  **subkey's** secret material + passphrase go into secrets
  (`GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`).
- **Rotation:** before subkey expiry, the offline primary issues a new signing
  subkey and an updated public export (same primary, new subkey). Because the
  keyring anchor is the *primary*, apt clients and self-update keep working with
  no re-add; only CI secrets change. A transition is shipped as a normal release
  carrying the refreshed `deploy/keys/mathion-pubkey.asc`.
- **Revocation:** a revocation certificate for the primary is generated at key
  creation and stored offline; the compromise procedure (revoke → publish revoked
  key → new primary via out-of-band-verified fingerprint) is documented in
  `deploy/keys/README.md`.

### 6.2 Signing execution (must be explicit & non-interactive)
- goreleaser `signs:` configured with the **exact subkey fingerprint**, output
  `${artifact}.asc`, `--armor`, `--batch --pinentry-mode loopback`, passphrase via
  stdin/`--passphrase-fd`. goreleaser's default sign is **not** guaranteed armored
  or `.asc`-named, so all of this is pinned, not defaulted. Signs `checksums.txt`
  (which already pins every artifact's sha256 → one signature authenticates all).
- apt `Release` signing (§7) uses the same subkey with the same non-interactive
  discipline: `gpg --batch --pinentry-mode loopback --local-user <fpr>`.

### 6.3 Verification anchors (pinned only post-bootstrap — see §1.1)
- `self-update`: verifies `checksums.txt.asc` against the **compile-time-embedded**
  primary pubkey.
- `install.sh`: verifies against the **literally-embedded** pubkey (here-doc in the
  script), in a private `GNUPGHOME` (mode 0700), `gpg --batch --no-tty`, checking
  import and `--verify` independently and failing closed if `gnupg` is absent.
- apt: verifies against `/etc/apt/keyrings/mathion.gpg` already installed on the
  box.
- Equivalence: signing `checksums.txt` == signing each artifact **iff** consumers
  require **exactly one** matching sha256 entry for the fetched file — install.sh
  and self-update both enforce that.

---

## 7. apt repo on GitHub Pages

### 7.1 Layout (`gh-pages` branch, served at `https://svkucheryavski.github.io/mathion`)
```
/deb/
  mathion-pubkey.asc
  pool/main/m/mathion/mathion_<ver>_amd64.deb , mathion_<ver>_arm64.deb   (accumulate)
  dists/stable/
    Release  InRelease  Release.gpg
    main/binary-amd64/Packages  Packages.gz
    main/binary-arm64/Packages  Packages.gz
    main/binary-*/by-hash/SHA256/<hash>        (current + previous retained)
```

### 7.2 Index generation (exact rules)
Build with **`apt-ftparchive`** over the git-tracked `pool/` (state = the `.deb`
files in git; no binary Berkeley-DB to commit — the `reprepro` alternative would
require committing its `db/`):

1. Copy new release `.deb`s into `pool/main/m/mathion/`.
2. Generate **per-arch** `Packages`: each `binary-<arch>/Packages` must list
   **only** that architecture's `.deb`s, with `Filename:` paths relative to
   `/deb` (`pool/main/m/mathion/…`). (A mixed `Packages` would make an amd64
   client try to install arm64.)
3. Generate `dists/stable/Release` with explicit `Origin`, `Label`, `Suite`
   (`stable`), `Codename` (`stable`), `Components` (`main`), `Architectures`
   (`amd64 arm64`), `Date`, a bounded **`Valid-Until`**, and **`Acquire-By-Hash:
   yes`**; emit `by-hash/SHA256/` indexes and retain current + previous to avoid
   CDN/publication races.
4. Sign: `gpg … --clearsign -o InRelease Release` and `gpg … -abs -o Release.gpg
   Release` (subkey, non-interactive).
5. Commit + push `gh-pages` (concurrency-guarded — §11).

**Freshness:** `Valid-Until` bounds replay/freeze of signed metadata. Because it
expires, a **scheduled `apt-resign.yml`** (§11) periodically re-signs the current
`Release` (no package change) to refresh `Date`/`Valid-Until`. Trade-off: the
scheduled job needs the signing subkey (same protected environment).

### 7.3 User-facing install (keyring in `/etc/apt/keyrings`)
```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://svkucheryavski.github.io/mathion/deb/mathion-pubkey.asc \
  | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/mathion.gpg
sudo chmod 0644 /etc/apt/keyrings/mathion.gpg            # readable by _apt
echo "deb [signed-by=/etc/apt/keyrings/mathion.gpg] \
  https://svkucheryavski.github.io/mathion/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/mathion.list
sudo apt update && sudo apt install mathion
```
`/etc/apt/keyrings` is the convention for admin-added keys (`/usr/share/keyrings`
is for package-shipped keys); `signed-by` scopes the key to this repo only. The
key add is TOFU (§1.1) — publish the fingerprint out-of-band for verification.

### 7.4 Repository growth
Two small static binaries per version, plus git history, accumulate against GitHub
Pages' ~1 GB soft limits. Define a retention threshold from the first release
(e.g. prune `pool/` to the last N minor versions, or monitor and revisit). Noted,
not automated in this slice.

---

## 8. `install.sh` authenticity upgrade

Before the existing sha256 step:

1. Download `checksums.txt` **and** `checksums.txt.asc`.
2. `GNUPGHOME="$(mktemp -d)"` (mode 0700); import the **literally-embedded**
   pubkey (here-doc — never a downloaded key); `gpg --batch --no-tty --import`
   and `gpg --batch --no-tty --verify checksums.txt.asc checksums.txt` checked
   **independently**; fail closed on either.
3. If `gpg` is absent: print "install gnupg to verify the download" and abort
   (never silently skip). Then the existing digest-extract-and-compare (unchanged).

The file's "Integrity only … signing is Slice 4" comment is removed.

---

## 9. `mathion self-update`

New command; new `cli/internal/selfupdate` package.

### 9.1 Flow
1. **Resolve self:** `os.Executable()` → `filepath.EvalSymlinks` → absolute path.
   Keep both the resolved and unresolved paths for detection.
2. **Detect channel (fail-closed):** run `dpkg -S <path>`.
   - Ownership by package **`mathion`** confirmed → **apt-managed**: print
     `sudo apt update && sudo apt install --only-upgrade mathion`, exit 0. **No
     root required for this branch.**
   - `dpkg` absent **or** a definitive "path not owned by any package" → treat as
     **curl-managed**, continue.
   - Any **other** dpkg error (DB error, ambiguous) → **abort** (do not fall
     through to a swap).
3. **Guard the mutation:** only now `requireRoot()`. Refuse if the target's parent
   directory is writable by non-root or not root-owned (avoid a root-time pathname
   race in an attacker-controlled dir).
4. **Resolve latest & forward-gate:** query `cli-v*` releases via the GitHub API;
   pick the **greatest** stable semver. If `latest <= current`, print
   "already up to date" and exit 0 (except a `dev` build, which always proceeds).
   **Never downgrade** (defends against a replayed older-but-signed release).
5. **Download** `mathion_linux_<GOARCH>.tar.gz`, `checksums.txt`,
   `checksums.txt.asc` to a temp dir.
6. **Verify:** OpenPGP-verify `checksums.txt.asc` against the embedded pubkey;
   require **exactly one** matching sha256 line for the archive; any mismatch →
   abort, touch nothing.
7. **Stage & swap atomically:** extract accepting **exactly one regular file**
   named `mathion`; write it to an **exclusive temp file in the target's own
   directory**; check every `write`/`close`/`chmod 0755`; `fsync` the file **and**
   the directory; run the staged binary's `version` as a sanity check; then
   `os.Rename` over the target (Linux atomically replaces the running executable —
   the live process keeps its old inode).
8. **Post-swap assertion:** confirm the now-installed binary reports the selected
   tag; print old → new.

### 9.2 Dependency
`github.com/ProtonMail/go-crypto/openpgp` (M2), pinned; SHA-256-or-stronger only.
No runtime `gpg` needed for `self-update`.

---

## 10. Dual-install detection & PATH precedence

`/usr/local/bin` precedes `/usr/bin` on the default `PATH`, so a curl|sh binary
shadows an apt one and `apt upgrade` can update a binary the shell never runs.
Non-destructive detection everywhere:

- **`.deb` `postinst`:** warn if `/usr/local/bin/mathion` exists.
- **`install.sh`:** warn if a dpkg-managed `mathion` exists (`dpkg -S`) before
  installing to `/usr/local/bin`.
- **`mathion version`:** if both paths exist, print which one `PATH` resolves and
  how to remove the other — emitted **before** the not-installed/`.env`-unreadable
  early returns so it is never suppressed.
- **README:** "use apt **or** curl|sh, not both" + the precedence rule.

No path is ever deleted automatically.

---

## 11. CI / release integration

### 11.1 Secret protection
- Signing secrets live in a protected GitHub **`release` environment** (required
  reviewer / restricted to release tags), **not** repository-wide secrets, and are
  referenced only by the signing/publish jobs — never by `test`/build jobs.
- Protect `cli-v*` **tags** (tag protection rule).
- **Pin third-party actions by commit SHA** (goreleaser-action, checkout, etc.) in
  the signing/publish jobs. (Threat model §1.1: this limits blast radius of a
  compromised token/account, the realistic risk in a solo repo.)

### 11.2 `release-cli.yml` — release job
- Uses the `release` environment; imports the signing **subkey**.
- goreleaser now emits `.deb` + `checksums.txt.asc`; `gh release create` uploads
  `dist/*.tar.gz dist/*.deb dist/checksums.txt dist/checksums.txt.asc`.

### 11.3 `release-cli.yml` — new `apt-publish` job (`needs: [release]`, tags only)
- Jobs do **not** share a filesystem, and `needs` gives ordering only: this job
  **downloads the just-published `.deb`s** from the release (via `gh`/API) rather
  than reading the release job's `dist/`.
- After `git checkout gh-pages`, the tag's `deploy/apt` script is absent from that
  branch — obtain it from the **tag ref** (separate worktree / sparse checkout of
  the tag), then run it.
- Serialize gh-pages publication with a `concurrency:` group and push with
  rebase/retry so a re-run or the scheduled re-sign can't race it.

### 11.4 `apt-resign.yml` (scheduled)
Periodic (well inside `Valid-Until`) re-sign of the current `Release` with no
package change, in the same protected environment + concurrency group, to refresh
`Date`/`Valid-Until` (§7.2).

### 11.5 PRs
Unchanged: unit + static validation only — **no** secrets, **no** publish, **no**
gh-pages write. Signing/publish happen exclusively on `cli-v*` tag pushes and the
schedule.

---

## 12. Testing strategy

- **Go unit (`cli/internal/selfupdate`, `cli/cmd/self_update_test.go`):**
  channel detection (dpkg-owned-by-mathion vs not vs dpkg-error-aborts, symlinked
  path), **forward-gate** (skip on `latest <= current`, refuse downgrade, `dev`
  proceeds), verify **fail-closed** on tampered archive / tampered signature /
  wrong-key / **expired** / **revoked** key, exactly-one-checksum-line, staged
  swap asserts resulting mode is **`0755`** and rejects a tar with ≠1 regular
  `mathion` member. Signing paths use a **throwaway** test key, never the
  production key. Byte-identity test: in-package pubkey == `deploy/keys/…`.
- **`deploy/install_sh_test.sh`:** extend for the `.asc` path — happy path,
  tampered-signature abort, and `gpg`-absent abort.
- **Hermetic apt e2e (CI, the highest-risk path):** build + sign a repo with a
  **throwaway** key, serve `/deb` over localhost HTTP, add the `signed-by` source,
  `apt update` + `apt install mathion`, assert `/usr/bin/mathion` runs. This
  exercises `Release` signatures, per-arch index paths, and `signed-by` — which a
  bare local `.deb` install does **not**.
- **`amd64-smoke.yml`:** add an opt-in leg — local `apt-get install ./mathion_*.deb`
  + assert the `postinst` dual-install warning fires when a `/usr/local/bin` copy
  exists.
- **Static validation** (`bash -n` + `shellcheck`) on all new shell.
- A full `apt update` against the **live** Pages repo remains a documented manual
  on-host smoke (like backup/restore).

---

## 13. Docs (README + `deploy/keys/README.md`)

- "Install via apt" (keyring → `signed-by` source → `apt install mathion`).
- The key **fingerprint** for out-of-band verification (bootstrap is TOFU).
- `mathion self-update` usage and its apt-managed deferral.
- PATH-precedence + "one channel only" guidance.
- `deploy/keys/README.md`: key generation, subkey rotation, revocation/compromise
  procedure.

---

## 14. Manual prerequisites (one-time, maintainer)

1. Generate the offline **primary** key + a **signing subkey** (with expiry) + a
   revocation certificate (stored offline). Export the **subkey** secret +
   passphrase into the `release` environment's `GPG_PRIVATE_KEY`/`GPG_PASSPHRASE`;
   commit the **primary public** key to `deploy/keys/mathion-pubkey.asc` (and its
   in-package copy).
2. Create an empty `gh-pages` branch; enable **GitHub Pages** (source = `gh-pages`).
3. Configure the protected **`release` environment**, `cli-v*` **tag protection**,
   and SHA-pin the release/publish actions.

---

## 15. Scope boundaries (YAGNI — explicitly out)

- No systemd unit in the `.deb` (the CLI manages a compose stack, not a service).
- No shell-completion packaging in this slice (man page **is** in — M3).
- No shipped `unattended-upgrades` config (documented, not installed).
- No `.rpm`, AUR, or Homebrew formula.
- No multi-suite / backports / component split — single `stable main`.
- No `.deb` auto-removal or install-abort on dual-install conflict (warn only).
- No `self-update` version-pin argument (forward-only to latest).
- No automated `pool/` pruning (retention documented — §7.4).

**Not YAGNI (required scope, per review):** rollback/forward-gate (§9), key
lifecycle (§6.1), `Valid-Until` + `Acquire-By-Hash` + scheduled re-sign (§7.2,
§11.4), gh-pages publication serialization + cross-job artifact passing (§11.3),
hermetic apt e2e test (§12).

---

## 16. Trust model summary

| Channel | Integrity | Authenticity (this slice) |
|---------|-----------|---------------------------|
| apt (steady state) | apt `Packages` sha256 | GPG-signed `Release`/`InRelease` w/ `Valid-Until`, verified via `/etc/apt/keyrings/mathion.gpg` |
| apt (bootstrap) | — | **TOFU** — key added over HTTPS from Pages; verify fingerprint out-of-band |
| curl\|sh install.sh (bootstrap) | sha256 vs `checksums.txt` | signature verified vs **embedded** pubkey, but key ships **with** the script → TOFU / origin trust |
| `mathion self-update` (steady state) | sha256 vs `checksums.txt` | `checksums.txt.asc` verified vs **compile-time-embedded** pubkey — genuinely pinned; forward-only |

One key (primary + rotating subkey). One canonical committed public source of
truth. Post-bootstrap anchors are pinned; the design does **not** claim the
first-install bootstrap is cryptographically self-authenticating.
