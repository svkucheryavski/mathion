# Phase 9-D Slice 4 — apt packaging, release signing, CLI self-update

**Status:** design (brainstorm complete; three open items flagged in §3)
**Date:** 2026-08-13
**Predecessors:** Slice 1 (deployment foundation), Slice 2 (the `mathion` Go CLI),
Slice 3 (backup/restore/update + backend `/version`). All merged to `main`;
`cli-v0.2.0` + app `v0.2.0` shipped.

---

## 1. Goal

Give Mathion a first-class, cryptographically-authenticated distribution path:

- `apt install mathion` from a signed apt repository hosted on GitHub Pages.
- A signed `.deb` built in the existing goreleaser release.
- One GPG key that authenticates **both** install channels (apt repo `Release`
  **and** the curl|sh release archives), closing the "integrity only, not
  authenticity" gap that `deploy/install.sh` itself flags today.
- `mathion self-update` — a channel-aware, signature-verified in-place upgrade of
  the CLI binary, distinct from the existing `mathion update` (which updates the
  **app**, not the CLI).
- Non-destructive detection of the dual-install / PATH-precedence footgun.

This slice touches distribution and the CLI only. No backend or frontend changes.

---

## 2. Locked decisions

These four were chosen during brainstorming and are settled:

| # | Decision | Choice |
|---|----------|--------|
| D1 | apt repo hosting | **GitHub Pages** (`gh-pages` branch, path `/deb`); repo state = the `.deb` files tracked in git |
| D2 | signing scope | **Both channels, one GPG key**: sign the apt repo `Release`, and sign `checksums.txt` for the curl|sh + self-update channel |
| D3 | CLI self-update | **Dedicated `mathion self-update`**, channel-aware (apt-managed → defer to apt; curl-managed → verify + swap) |
| D4 | dual-install conflict | **Detect + warn, never auto-delete** (postinst, install.sh, and `mathion version` all surface it) |

## 3. Open decisions (need resolution before/at implementation)

- **M1 — copyright file.** The repo has **no `LICENSE` file anywhere**. A Debian
  package must ship `/usr/share/doc/mathion/copyright`. Either (a) adopt a real
  OSS license now (a separate product decision — which one?), or (b) ship a
  minimal `copyright` stating "© Sergey Kucheryavskiy; see <repo>" and defer
  licensing. **Default assumed for this spec: (b)**, replaceable by (a) later.
- **M2 — new Go dependency.** GPG detached-signature verification inside the CLI
  needs an OpenPGP library — recommended `github.com/ProtonMail/go-crypto`
  (maintained fork; stdlib `golang.org/x/crypto/openpgp` is frozen/deprecated).
  The alternative is shelling out to a system `gpg`, which minimal servers often
  lack. **Recommendation: add the library.** The CLI currently has one direct
  dependency (`spf13/cobra`); this is the second.
- **M3 — scope confirmation.** The "explicitly out" list in §11 (no systemd unit,
  no man pages, no `unattended-upgrades` config shipped, no `.deb` auto-removal).
  Confirm nothing there should be pulled in.

---

## 4. Architecture overview

Two authenticated channels, one trust anchor (a single GPG key):

```
                         ┌── release (goreleaser) ──────────────┐
  git tag cli-vX.Y.Z ───►│  build mathion (amd64,arm64)          │
                         │  archives  -> mathion_linux_*.tar.gz  │
                         │  nfpm      -> mathion_*.deb           │
                         │  signs     -> checksums.txt(.asc)     │
                         └──────────────┬───────────────────────┘
                                        │ gh release upload (.tar.gz, .deb, checksums, .asc)
                          ┌─────────────┴───────────────┐
        curl|sh channel   │                             │  apt channel
        install.sh + ─────┤                             ├──► apt-publish job:
        self-update       │                             │     gh-pages /deb: pool/ + dists/,
        verify checksums  │                             │     apt-ftparchive -> Release,
        .asc vs embedded  │                             │     gpg --clearsign -> InRelease,
        pubkey            │                             │     gpg -abs -> Release.gpg
                          └─────────────────────────────┘
```

The **same GPG key** signs `checksums.txt` (curl|sh + self-update) and the apt
`Release`. The **same public key** is the verification anchor everywhere:
committed at `deploy/mathion-pubkey.asc`, embedded into the CLI via `go:embed`
for `self-update`, bundled into `install.sh`, and served on Pages for apt users
to install into `/usr/share/keyrings/mathion.gpg`.

### 4.1 Component / file map

| Path | Change | Responsibility |
|------|--------|----------------|
| `cli/.goreleaser.yaml` | modify | add `nfpms:` (build `.deb`) and `signs:` (detached `.asc` over `checksums.txt`) |
| `deploy/mathion-pubkey.asc` | create | ASCII-armored public signing key — the committed source of truth |
| `cli/internal/selfupdate/` | create | release resolution, download, GPG verify (embedded pubkey), sha256, atomic swap, channel detection |
| `cli/cmd/self_update.go` (+ `_test.go`) | create | `mathion self-update` command wiring |
| `cli/cmd/version.go` | modify | surface a dual-install warning |
| `cli/cmd/root.go` | modify | register `newSelfUpdateCmd` |
| `deploy/install.sh` | modify | verify `checksums.txt.asc` against a bundled pubkey before the existing sha256 check |
| `deploy/apt/` | create | `apt-ftparchive` config + repo-build/publish script used by CI |
| `.github/workflows/release-cli.yml` | modify | import signing secrets; upload `.deb` + `.asc`; add `apt-publish` job |
| `.github/workflows/amd64-smoke.yml` | modify | add an opt-in local-`.deb` install leg |
| `README.md` | modify | apt install steps, key fingerprint, self-update usage, PATH-precedence note |

---

## 5. The `.deb` package (nfpm inside goreleaser)

Add an `nfpms:` block to `cli/.goreleaser.yaml`, packaging the already-built
`mathion` binary. Key attributes:

- **Package:** `mathion`; **binary path:** `/usr/bin/mathion` (Debian policy
  forbids a package writing under `/usr/local`).
- **Architectures:** amd64 + arm64 (`.deb` per arch), from goreleaser's existing
  two-arch build.
- **Version:** the sanitized semver goreleaser already computes
  (`cli-v0.2.0` → `0.2.0`), so `.deb` version = `0.2.0`.
- **Section** `admin`, **priority** `optional`, **maintainer**/**homepage**/
  **description** populated.
- **No hard `Depends: docker`.** The CLI probes Docker at runtime (`install`
  already does), and a hard dependency on `docker.io` would fail or conflict for
  the many users who installed Docker via Docker's own `docker-ce` packages. Use
  at most `Recommends: docker.io`.
- **`postinst`:** if `/usr/local/bin/mathion` exists, print a warning that it will
  shadow this apt copy on the default `PATH` and how to remove it. Never deletes
  (Debian policy: a package must not remove a file it does not own). See §9.
- **Ships** `/usr/share/doc/mathion/copyright` (content per M1).

The `.deb` is **not** individually debsig-signed: apt's trust comes from the
GPG-signed repo `Release` (§7), and a local `apt-get install ./file.deb` performs
no signature check regardless. One signature system, no redundancy.

---

## 6. Signing — one GPG key, both channels

### 6.1 Key material
- One dedicated GPG signing key (RSA-4096 or Ed25519). Generated once by the
  maintainer (§10).
- **Private** key, ASCII-armored, + its passphrase → GitHub Actions secrets
  `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`.
- **Public** key committed at `deploy/mathion-pubkey.asc`, published on Pages at
  `/deb/mathion-pubkey.asc`, fingerprint documented in the README.

### 6.2 curl|sh + self-update
goreleaser `signs:` produces a **detached, armored** signature over
`checksums.txt` → `checksums.txt.asc`. Because `checksums.txt` already pins the
sha256 of every archive, one signature authenticates all release artifacts.
`install.sh` and `self-update` verify `checksums.txt.asc` against the pinned
public key, then verify the archive's sha256 against `checksums.txt`.

### 6.3 apt
The `apt-publish` job (§7) signs the generated `Release` file with the same key:
`gpg --clearsign` → `InRelease` and `gpg --detach-sign --armor` → `Release.gpg`.
apt clients verify these against the key installed at
`/usr/share/keyrings/mathion.gpg`.

### 6.4 Verification anchor is pinned, not fetched
`self-update` and `install.sh` verify against a **bundled/embedded** copy of the
public key — never one downloaded in the same transaction — so a compromised
download host cannot supply both the artifact and the key that "verifies" it.

---

## 7. apt repo on GitHub Pages

### 7.1 Layout (`gh-pages` branch, served at `https://svkucheryavski.github.io/mathion`)
```
/deb/
  mathion-pubkey.asc
  pool/main/m/mathion/mathion_0.2.0_amd64.deb
                      mathion_0.2.0_arm64.deb   (all released versions accumulate here)
  dists/stable/
    Release  InRelease  Release.gpg
    main/binary-amd64/Packages  Packages.gz
    main/binary-arm64/Packages  Packages.gz
```

### 7.2 Build mechanism (recommendation)
Use **`apt-ftparchive`** (from `apt-utils`) over the git-tracked `pool/`:

1. Copy the new release `.deb`s into `pool/main/m/mathion/`.
2. `apt-ftparchive packages` per `binary-<arch>` → `Packages` (+ gzip).
3. `apt-ftparchive -c release.conf release dists/stable` → `Release`
   (Suite `stable`, Components `main`, Architectures `amd64 arm64`).
4. Sign: `gpg --clearsign -o InRelease Release` and
   `gpg -abs -o Release.gpg Release`.
5. Commit + push `gh-pages`.

This keeps **repo state = the `.deb` files in git**, with no binary Berkeley-DB
to commit. **Alternative:** `reprepro` (more foolproof pool management, but
requires committing its `db/`). The exact tool is finalized in the plan; both
satisfy this design.

### 7.3 User-facing install
```sh
curl -fsSL https://svkucheryavski.github.io/mathion/deb/mathion-pubkey.asc \
  | sudo gpg --dearmor -o /usr/share/keyrings/mathion.gpg
echo "deb [signed-by=/usr/share/keyrings/mathion.gpg] \
  https://svkucheryavski.github.io/mathion/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/mathion.list
sudo apt update && sudo apt install mathion
```
(Modern `signed-by` keyring, not the deprecated `apt-key`.)

---

## 8. `install.sh` authenticity upgrade

`deploy/install.sh` gains a signature check before its existing sha256 step:

1. Download `checksums.txt` **and** `checksums.txt.asc`.
2. Verify the detached signature against a **bundled** public key. Implementation:
   import the pinned key into an ephemeral, script-owned GNUPGHOME
   (`GNUPGHOME=$(mktemp -d)`), `gpg --verify checksums.txt.asc checksums.txt`,
   fail-closed on non-zero.
3. Then the existing digest-extract-and-compare over the archive (unchanged).

The pinned key is embedded in the script (here-doc) or shipped beside it; the
comment "Integrity only … signing is Slice 4" is removed. `gpg` is already
present on the developer/admin boxes that run a curl|sh install; if absent the
script prints a clear "install gnupg to verify the signature" error and aborts
(fail-closed, never silently skipping verification).

---

## 9. `mathion self-update`

New command; new `cli/internal/selfupdate` package. Requires root (reuses
`requireRoot()` — it replaces a system binary).

### 9.1 Flow
1. **Resolve self:** `os.Executable()` → `filepath.EvalSymlinks` → absolute path.
2. **Detect channel:** run `dpkg -S <path>`.
   - exit 0 and the path maps to a package → **apt-managed** → print
     `sudo apt update && sudo apt install --only-upgrade mathion` and exit 0
     (never clobber a dpkg-owned file).
   - `dpkg` absent, or path not owned by any package → **curl-managed**, continue.
3. **Resolve latest** `cli-v*` release via the GitHub API (same endpoint
   `install.sh` uses). If it equals the baked `buildVersion`, print
   "already up to date" and exit 0. (`dev` builds always proceed.)
4. **Download** `mathion_linux_<arch>.tar.gz`, `checksums.txt`,
   `checksums.txt.asc` to a temp dir. Arch from `runtime.GOARCH`.
5. **Verify:** OpenPGP-verify `checksums.txt.asc` against the **embedded** pubkey
   (`go:embed deploy/mathion-pubkey.asc`), then sha256 the archive against its
   `checksums.txt` line. Any mismatch → abort, touch nothing.
6. **Swap atomically:** extract `mathion` into the **same directory** as the
   target, `chmod 0755`, `os.Rename` over the target (same-filesystem atomic
   replace; preserves the inode swap semantics install.sh's `install` lacks).
7. Print old → new version.

### 9.2 Dependency
GPG verification uses `github.com/ProtonMail/go-crypto/openpgp`
(`ReadArmoredKeyRing` + `CheckArmoredDetachedSignature`) — see M2. No runtime
`gpg` binary required for `self-update` (unlike `install.sh`, which is shell).

### 9.3 Downgrade / safety
Latest-only: the command fetches the newest `cli-v*` and updates only if it
differs from the running build. No explicit version argument in this slice
(YAGNI); revisit if pinning is requested.

---

## 10. Dual-install detection & PATH precedence

On the default Debian/Ubuntu `PATH`, `/usr/local/bin` precedes `/usr/bin`, so a
curl|sh binary shadows an apt one, and `apt upgrade` can update a binary the
shell never runs. Non-destructive detection at every touchpoint:

- **`.deb` `postinst`:** warn if `/usr/local/bin/mathion` exists.
- **`install.sh`:** warn if a dpkg-managed `mathion` exists (`dpkg -S`), before
  installing to `/usr/local/bin`.
- **`mathion version`:** if both `/usr/bin/mathion` and `/usr/local/bin/mathion`
  exist, print which one `PATH` resolves and how to remove the other.
- **README:** documents "use apt **or** curl|sh, not both" and the precedence
  rule.

No path is ever deleted automatically.

---

## 11. CI / release integration

### 11.1 `release-cli.yml` — release job (already `permissions: contents: write`)
- Import the GPG key from secrets into the job (e.g. via `gpg --batch --import`).
- goreleaser now emits `.deb` + `checksums.txt.asc` alongside the tarballs.
- `gh release create` uploads `dist/*.tar.gz dist/*.deb dist/checksums.txt
  dist/checksums.txt.asc`.

### 11.2 `release-cli.yml` — new `apt-publish` job (`needs: [release]`, tags only)
- `if: startsWith(github.ref, 'refs/tags/cli-v')`; `permissions: contents: write`.
- `apt-get install -y apt-utils`; import the GPG key.
- Checkout the `gh-pages` branch; run `deploy/apt/build.sh` (§7.2) to drop the new
  `.deb`s into `pool/`, regenerate `Packages`/`Release`, sign `InRelease` +
  `Release.gpg`; commit and push `gh-pages`.

### 11.3 PRs
Unchanged model: PRs run unit + static validation only — **no** secrets, **no**
publish, **no** gh-pages write. Signing/publish happen exclusively on `cli-v*`
tag pushes.

---

## 12. Testing strategy

- **Go unit (`cli/internal/selfupdate`, `cli/cmd/self_update_test.go`):**
  channel detection (dpkg-owned vs not), latest-equals-current skip, verify
  **fail-closed** on a tampered archive and on a tampered/mismatched signature,
  atomic-swap preserves mode. Signature paths tested against a throwaway test
  key fixture (not the production key).
- **`deploy/install_sh_test.sh`:** extend for the `.asc` path — happy path and a
  tampered-signature abort.
- **`amd64-smoke.yml`:** add an opt-in leg that `apt-get install ./mathion_*.deb`,
  asserts the binary at `/usr/bin/mathion` runs and reports the release version,
  and that the dual-install `postinst` warning fires when a `/usr/local/bin`
  copy is present. A full `apt update` end-to-end from the live Pages repo stays
  a **manual on-host smoke** (like backup/restore), documented in the plan.
- **Static validation** unchanged for shell (`bash -n` + `shellcheck`) on any new
  scripts.

---

## 13. Docs (README)

- "Install via apt": add key → add `signed-by` source → `apt install mathion`.
- Publish the key **fingerprint** for out-of-band verification.
- `mathion self-update` usage and its apt-managed behavior.
- The PATH-precedence note and "one channel only" guidance.

---

## 14. Manual prerequisites (one-time, maintainer)

1. Generate the GPG signing key; export the armored **private** key + passphrase
   into `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` secrets; commit the **public** key to
   `deploy/mathion-pubkey.asc`.
2. Create an empty `gh-pages` branch and enable **GitHub Pages** for the repo
   (source = `gh-pages` branch).

---

## 15. Scope boundaries (YAGNI — explicitly out)

- No systemd unit in the `.deb` (the CLI manages a compose stack, not a service).
- No man pages / shell-completion packaging in this slice.
- No shipped `unattended-upgrades` config (documented, not installed).
- No `.rpm`, AUR, or Homebrew formula.
- No multi-suite / backports / component split — single `stable main`.
- No `.deb` auto-removal or install-abort on dual-install conflict (warn only).
- No `self-update` version-pin argument (latest-only).

---

## 16. Trust model summary

| Channel | Integrity | Authenticity (this slice) |
|---------|-----------|---------------------------|
| apt | apt `Packages` sha256 | GPG-signed `Release`/`InRelease` verified via `/usr/share/keyrings/mathion.gpg` |
| curl\|sh install.sh | sha256 vs `checksums.txt` | `checksums.txt.asc` verified vs **bundled** pubkey |
| `mathion self-update` | sha256 vs `checksums.txt` | `checksums.txt.asc` verified vs **embedded** pubkey |

One key. One committed public source of truth (`deploy/mathion-pubkey.asc`).
Every verification anchor is pinned, never fetched in the same transaction.
