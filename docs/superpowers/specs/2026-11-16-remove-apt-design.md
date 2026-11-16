# Remove the apt channel — design

Status: APPROVED rev 4, 2026-11-16 (rev 1 + Opus/Fable spec review + user answers
L1-L4; rev 3: the curl|sh fingerprint check, `licenses` test rules, fixed
copy; rev 4: the check reads the embedded key, not a pin line). Size: a small change.

## Why

The apt channel (Phase 9-D Slice 4a, a signed apt repository on gh-pages) costs
more than it gives. It needs its own signing subkey (`S_apt`), a personal
access token that expires (`PAGES_DEPLOY_TOKEN`), a re-sign every 10 days or
the repository expires after 30, two CI jobs, a publish job in every CLI
release and about 1,300 lines of scripts. It also fails silently: the token
expired, the re-sign stopped on 2026-10-01 and the live repository has been
expired since 2026-10-21 without anyone noticing.

`curl … | sh` already installs the same signed binary, and `mathion
self-update` keeps it current. There are no Mathion installs anywhere yet
(user, 2026-11-16), so the channel can go now with no migration path.

## Goals

- One install channel: `deploy/install.sh` (`curl | sh`), updated by `mathion
  self-update`.
- Nothing in the repository builds, signs, tests, publishes or documents a
  `.deb` or an apt repository.
- No token, scheduled job or signing subkey exists only to keep apt alive.
- The third-party licence notices travel with every copy of the binary (L2).

## Non-goals

- Past releases (`cli-v0.3.0` … `cli-v0.8.0`) and their `.deb` assets stay as
  published.
- Old specs and plans under `docs/superpowers/` stay as written (history).
- No key rotation and no revocation: the offline primary and `S_rel` are
  unchanged, and `S_apt` is not revoked (L3).

## Anti-goals

- Weakening the release channel. These stay, with their tests: the `signs:`
  and `checksum:` blocks in `cli/.goreleaser.yaml`; `deploy/keys/mathion-pubkey.asc`
  and its embedded copy in `cli/internal/selfupdate/`;
  `cli/scripts/release-embedded-key-guard.sh`; guards 1-3 in
  `cli/scripts/selfupdate-ci-guards.sh`; `deploy/install_sh_test.sh`; the
  `S_rel`-only and stub-primary assertion in `release-cli.yml` (today lines
  68-80); the single-subkey signer check in `cli/internal/selfupdate/verify.go`.
- `self-update` overwriting a binary that a system package owns.
- Taking down the project site on GitHub Pages: it publishes the install
  steps and the release-key fingerprint, the independent place to check it
  (L1). After the change the README still points there, with a check a curl|sh
  user can run (see "The fingerprint check").

## Approaches

1. **Remove the channel completely** (chosen). Every apt and `.deb` piece goes;
   the release-channel pieces that only lived next to them stay or move.
2. *Keep `.deb` files on GitHub releases, drop only the apt repository.* No
   token or re-sign, but it keeps nfpm packaging, lintian, the deb tests and a
   second install path. Rejected: half the cost for a channel nobody uses.
3. *Stop publishing but keep the code.* Rejected: dead code that still runs in
   CI and rots.

## Design

### Removed

- **Workflows**
  - `.github/workflows/apt-resign.yml`.
  - `release-cli.yml`: "Prepare .deb assets", the deb Version check and its
    comment, `dist/*.deb` in `gh release create` (the tarballs and
    `checksums.txt` + `.asc` stay), the `upload-artifact` step (only
    `apt-publish` used it), and the `apt-publish` job.
  - `ci.yml`: the `apt-e2e` job; from `apt-scripts`, `deb_test.sh`,
    `resign_test.sh` and the shellcheck of `deploy/apt` and `deploy/deb`.
  - `amd64-smoke.yml`: the "Local .deb install + dual-install warning" step and
    the `setup-go` and `goreleaser-action` steps that exist only for it.
- **Files:** `deploy/apt/` (all); `deploy/deb/` (all, after the moves below);
  `deploy/keys/mathion-apt-keyring.asc`; `deploy/man/` (L4: the man page
  shipped only in the `.deb`; `mathion --help` covers it).
- **Build config:** the `nfpms` section of `cli/.goreleaser.yaml` and the
  snapshot comment that cites `deb_test.sh` (keep `version_template`); the deb
  inputs in `cli/scripts/selfupdate-ci-guards.sh` (the three gzips, the
  placeholder keyring and their comment; guards 1-3 unchanged); `.gitignore`
  lines for deb inputs (the comment, `mathion-archive-keyring.gpg`,
  `changelog.Debian.gz`, `THIRD_PARTY_NOTICES.gz`, `mathion.1.gz`). The
  ignored local copies of those files are deleted.
- **CLI**
  - The apt hand-off in `self-update` (replaced, see below) and its help text
    ("apt installs are deferred to apt").
  - The dual-install warning in `mathion version` and its test.
  - The hidden `_drift-probe` command (`cli/main.go`, `cli/cmd/drift_probe.go`,
    its tests, the comment in `cli/cmd/version.go`): only the `.deb`
    postinstall called it.
- **`deploy/install.sh`:** the dual-install warning; the `S_apt` wording in its
  comments.
- **`deploy/keys/gen-signing-keys.sh`:** creating and exporting `S_apt` (the
  subkey, the apt keyring, `s_apt.private.asc`, the `S_APT_FPR` lines). It
  creates the primary and `S_rel` only.
- **Docs**
  - README: the apt install section (its fingerprint check is replaced, see
    "The fingerprint check"), the "use one channel" note, the apt-managed case
    in the `self-update` section (replaced, see "Fixed copy"), and "or apt".
  - `docs/release-notes/branding-release-order.md` and
    `settings-release-order.md`: they are the steps for the next release, so
    their "curl|sh and apt" lines change to curl|sh only, and each "or, for a
    CLI installed from the apt repository" line goes together with the apt
    command under it. (My call.)
  - `PROJECT.md`: the install line that names `apt`, `apt-get` and `brew`
    becomes the curl|sh install. (My call.)

### Kept, moved or renamed

- `deploy/deb/sign_test.sh` tests the release signature on `checksums.txt`. It
  moves to `cli/scripts/sign_test.sh` and keeps running in CI. Its `cd
  "$(dirname "$0")/../../cli"` already resolves to `cli/` from there; its nfpm
  comment is reworded.
- The CI job `apt-scripts` keeps its release checks (shellcheck of
  `deploy/keys` and the CLI scripts, the signing test, the self-update release
  guards, the embedded-key guard) and is renamed `release-scripts`; its step
  names and comments lose "apt".
- Sibling-subkey rejection tests stay; only names and comments change:
  `deploy/install_sh_test.sh` case 3 (`SUB_APT`), the Go tests' `aptEntity`
  (`verify_test.go`, `artifact_test.go`), the integration test's leg 2
  ("S_apt reject"), and the `S_apt` comment in `verify.go`. They prove the
  release channel refuses another subkey of the same primary.
- `deploy/keys/README.md` describes one signing subkey, `S_rel` (generation,
  export, CI secrets, rotation, revocation). It keeps the per-subkey export
  form (`"<fpr>!"`): `S_apt` still exists on the primary, so a plain export
  would pull it into `mathion-pubkey.asc`. A short note records that `S_apt`
  was retired on 2026-11-16, is trusted by nothing, was not revoked, and that
  its offline backup is destroyed. Its "publish the primary fingerprint out of
  band" paragraph says users check it against the fingerprint pinned in
  `install.sh`, not against a keyring.

### `mathion licenses` (L2)

- `deploy/deb/THIRD_PARTY_NOTICES` moves into the CLI (for example
  `cli/internal/notices/THIRD_PARTY_NOTICES`) and is embedded at build time.
- `mathion licenses` prints one line, `Mathion CLI is licensed under the
  Apache License 2.0 (see LICENSE in the source repository).`, a blank line,
  then the notices verbatim. Exit 0, no network, no root. It is listed in
  `mathion --help`, and it is added to the commands that skip the compose-drift
  notice (`driftHookExcluded` in `cli/cmd/root.go`, with its `root_test.go`
  case), like `version --short`.
- The notices gain a `===== Go standard library =====` section: the upstream
  Go `LICENSE` (BSD-3-Clause, The Go Authors) and `PATENTS` texts, verbatim,
  for the Go version that builds the release (a Homebrew GOROOT has `PATENTS`
  but no `LICENSE`; take both from the Go source). Every binary contains the
  standard library and the `.deb` lacked it. (My call.) A test asserts the
  section is present.
- A test fails when a module compiled into the binary for linux (amd64 or
  arm64; for example `GOOS=linux go list -deps`) has no header in the
  embedded text the command prints. Rules: skip the main module
  (`github.com/svkucheryavski/mathion/cli`); match headers only as whole lines
  `===== <module> =====` (the circl text holds a bare `=====…` rule); extra
  headers are allowed (`mousetrap` is compiled only for windows). Today the
  linux binary pulls in seven modules, all covered; `gopkg.in/yaml.v3` is
  test-only.
- `deploy/deb/copyright` goes; its summary is the first line above plus the
  notices.
- README: one line under the CLI section names `mathion licenses`.

### `self-update` and a package-owned binary

`self-update` still asks `dpkg -S` who owns the running binary (resolved
through symlinks), as today, before any network or root step and before
`guardTarget`.

- dpkg absent, or "no path found": proceed as today.
- Owners found: take each output line of the form `<pkgs>: <exact resolved
  path>`, skip `diversion by …` lines, split `<pkgs>` on `, ` and strip any
  `:arch`. Then refuse, exit non-zero, and print:
  - owner `mathion`: `<path> belongs to the system package mathion. Remove it (sudo apt remove mathion) and install Mathion with curl | sh.`
  - any other owner(s): `<path> belongs to the system package <a, b>; refusing to replace it.`
- Output it cannot parse: fail closed, as today.
- `--check` refuses the same way, non-zero (today it exits 0 with the apt
  command).
- Tests: the unit tests that expect the apt hand-off (`run_linux_test.go`
  `TestRun_AptManaged_Defers`, `channel_test.go`) become refusal tests,
  including a diversion line and two owners. The integration test's leg 3
  (fake dpkg-owned `/usr/bin/mathion`) asserts the refusal message, a non-zero
  exit and an unchanged binary; its header and summary line follow.

### The fingerprint check

A curl|sh user's trust root is `install.sh`: it embeds the release key and pins
its fingerprints. An out-of-band check can confirm *which key* the installer
accepts; it cannot prove the rest of the script is honest, so the copy says
so. The check computes the fingerprint from the embedded key itself, not from
a pin line a changed script could keep while ignoring it. (My call, after the
spec review.)

README, right after the "Prefer to read before you run?" block, a paragraph
headed *Check the release key (out of band)*:

> The installer carries Mathion's release key. To see which key it accepts,
> run this on the script you downloaded:
>
> ```bash
> sed -n '/BEGIN PGP PUBLIC KEY BLOCK/,/END PGP PUBLIC KEY BLOCK/p' install.sh | gpg --show-keys
> ```
>
> The first fingerprint it prints must be
> `F00602DFE1BF8CD2B321FC72AD21D4AD294C31A0`, the one published on the project
> site (https://svkucheryavski.github.io/mathion/) as
> `F006 02DF E1BF 8CD2 B321  FC72 AD21 D4AD 294C 31A0`. This shows the key
> the installer trusts, not that the rest of the script is honest: read it
> before you run it. The copy in `deploy/keys/README.md` lives in this
> repository, so it is not an independent check.

The site's "Verify the release key" section gets the same command and wording
(it currently checks the apt keyring), and any sentence that sends apt users
to it is reworded or removed with the apt block.

### Fixed copy

- `self-update` help (`Short`): `Update a mathion CLI installed with curl | sh`.
- README "Updating the CLI": the "depends on how the binary was installed"
  sentence and the apt bullet go; the curl|sh bullet becomes plain paragraphs,
  followed by: `If a system package owns the binary (for example an old .deb),
  self-update refuses and names the package; nothing is changed.`
- README "Applying a stack-definition change after a CLI upgrade", first
  sentence (keep the code span on `mathion self-update`): "`mathion
  self-update` updates the CLI binary, not the running deployment: it does not
  apply the bundled stack definition to the containers you already have
  running."

### Manual steps for the user, after the merge is pushed

1. **gh-pages.** Pages stays on. Fetch the live `gh-pages` branch (the local
   copy is stale: the live site has a `deb/` folder the local ref lacks). I
   prepare one local commit that removes the apt block from `index.html`,
   rewrites its "Verify the release key" section as in "The fingerprint
   check", and removes the `deb/` folder; you push it.
2. **Secrets.** Delete `PAGES_DEPLOY_TOKEN` and the access token itself,
   `GPG_S_APT_PRIVATE`, and the `S_APT_FPR` / `S_APT_VERIFY_FPRS` variables
   from wherever they live (repository, the `release` environment, the
   `pages-resign` environment). Then delete the `pages-resign` environment.
3. **Key backup.** Destroy the offline `s_apt.private.asc` backup. No
   revocation (L3).
4. **Branch protection.** If required status checks name `apt-scripts` or
   `apt-e2e`, replace them with `release-scripts`.
5. **Releases.** Never tag a commit from before the removal: its
   `release-cli.yml` would still try the apt publish and fail.

### Left to the builder

- Exact test names, function names and the order of the removals.
- Comment and package-doc wording outside the copy fixed above (for example
  "channel-aware" in `cli/internal/selfupdate/httpget.go`).
- Whether `goreleaser` skip flags that name `nfpm` are dropped or left.
- How the notices test lists the compiled modules (for example `go list
  -deps` with `GOOS=linux`).
