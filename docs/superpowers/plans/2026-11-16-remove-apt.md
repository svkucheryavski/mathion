# Remove the apt channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `curl | sh` + `mathion self-update` the only install channel by removing every apt and `.deb` piece, without weakening the release channel.

**Architecture:** Five tasks. T1 changes `self-update`'s dpkg ownership check from an apt hand-off into a refusal. T2 adds `mathion licenses` with the notices embedded. T3 removes the CLI and `install.sh` leftovers. T4 removes the build, CI and packaging pieces. T5 rewrites the docs and runs the leftover sweep. A sixth step prepares the gh-pages commit for the user to push.

**Tech Stack:** Go 1.24 (cobra), POSIX sh, GitHub Actions YAML, goreleaser v2, GnuPG.

**Spec:** `docs/superpowers/specs/2026-11-16-remove-apt-design.md` (rev 4, approved `9b93747`).

## Global Constraints

- No new Go modules, npm or pip packages. Code must build with Go 1.24 (CI `go-version: "1.24"`; local Go is 1.27, so avoid newer stdlib APIs).
- Go tests also run on Linux (`golang:1.24` container on a tree copy): `*_linux_test.go` files never compile on macOS.
- Code comments: one short plain line.
- Copy fixed by the spec is used verbatim (refusal messages, `licenses` first line, README paragraphs, `self-update` Short).
- Nothing in the release channel weakens: the spec's anti-goal list stays, with its tests.
- Stay inside the repo: absolute `cd` only, scratch in `.superpowers/sdd/2026-11-16-remove-apt/tmp/`, Docker probes copy the tree there.
- Per task: TDD where code changes; Opus + Fable lanes on the uncommitted diff; commit only on the user's OK; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never stage `logo.png` or `favicon.svg`.
- No push. The user pushes `main` and gh-pages.

## Review Focus

1. dpkg output with a diversion line, two owners or a `:arch` suffix: the refusal names the real package(s), never "diversion by …". Pinned in T1 Step 1.
2. `mathion licenses` on a host with no install (no `.env`, no config dir): prints the text, exit 0, no drift notice. Pinned in T2 Step 1.
3. A release after the removal still signs `checksums.txt` and uploads the tarballs + `.asc`: the moved `sign_test.sh` passes and `release-cli.yml`'s `gh release create` keeps those files. Checked in T4 Steps 4-5.
4. `install.sh` still verifies and installs after its warning and comments go: `deploy/install_sh_test.sh` passes, including the sibling-subkey rejection. Checked in T3 Step 4.
5. A curl|sh install still self-updates: `TestRun_HappyPath_Swaps` and integration leg 1 pass. Checked in T1 Steps 4 and 6.

---

### Task 1: `self-update` refuses a package-owned binary

**Files:**
- Modify: `cli/internal/selfupdate/channel.go` (replace the channel enum with an owner lookup)
- Modify: `cli/internal/selfupdate/run_linux.go:51-57` (step 2)
- Modify: `cli/cmd/self_update.go:12` (Short)
- Modify: `cli/internal/selfupdate/verify.go:56`, `httpget.go:1` (comments only)
- Test: `cli/internal/selfupdate/channel_test.go`, `run_linux_test.go:159-179`, `verify_test.go`, `artifact_test.go` (`aptEntity` → `siblingEntity`), `cli/selfupdate_integration_test.sh` (header, leg 2 name, leg 3, summary)

**Interfaces:**
- Produces: `func packageOwners(ctx context.Context, path string) ([]string, error)`: nil, nil when dpkg is absent or reports "no path found"; the owner names (deduped, `:arch` stripped, input order) on exit 0; an error on output it cannot parse or any other exit.
- Produces: `func refusePackageOwned(path string, owners []string) error`: nil for no owners; otherwise an error with the spec's message.
- `channelResult`, `channelApt`, `channelCurl`, `detectChannel` and `parseDpkgPkg` are removed; `dpkgSearch` and `dpkgResult` stay.

- [ ] **Step 1: Write the failing tests**

`channel_test.go`: replace `TestDetectChannel` with `TestPackageOwners` (table over `dpkgSearch` stubs, path `/usr/bin/mathion` unless stated):

| stub | want |
|---|---|
| `mathion: /usr/bin/mathion\n`, exit 0 | `["mathion"]` |
| `mathion:amd64: /usr/bin/mathion\n`, exit 0 | `["mathion"]` |
| `a, b:arm64: /usr/bin/mathion\n`, exit 0 | `["a","b"]` |
| `diversion by x from: /usr/bin/mathion\ndiversion by x to: /usr/bin/mathion.real\nmathion: /usr/bin/mathion\n`, exit 0 | `["mathion"]` |
| `other: /usr/bin/mathion.d\nmathion: /usr/bin/mathion\n`, exit 0 | `["mathion"]` (exact-path lines only) |
| `diversion by x from: /usr/bin/mathion\n`, exit 0 | error (no owner line) |
| stderr `dpkg-query: no path found matching pattern …`, exit 1 | `nil`, no error |
| `absent: true` | `nil`, no error |
| exit 1 with other stderr; exit 2 | error |
| `local diversion from: …` + `local diversion to: …` + `mathion: /usr/bin/mathion` | `["mathion"]` |
| only `local diversion from: /usr/bin/mathion` | error |
| `mathion: …` and `mathion:amd64: …` for the same path | `["mathion"]` (deduped) |

`TestPackageOwners_PathWithColonSpace`: path `/opt/a: b/mathion`, line `mathion: /opt/a: b/mathion` → `["mathion"]`.

`TestRefusePackageOwned`: `nil` owners → nil; `["mathion"]` → error text exactly `/usr/bin/mathion belongs to the system package mathion. Remove it (sudo apt remove mathion) and install Mathion with curl | sh.`; `["a","b"]` → exactly `/usr/bin/mathion belongs to the system package a, b; refusing to replace it.`; `["mathion","a"]` → the second form with `mathion, a`.

`run_linux_test.go`: replace `TestRun_AptManaged_Defers` with a helper `runRefused(t, check, dpkg)` that stubs `dpkgSearch` (lines built from the queried path; the harness binary lives in a temp dir), points the release server at an unreachable address so a refusal after any network step fails, and asserts `*rootCalled == false`, `*archiveHits == 0` and `p.Out` empty. Tests: `TestRun_PackageOwned_Refuses` (owner `mathion`, with and without `--check`; error contains `belongs to the system package mathion. Remove it`), `TestRun_ForeignPackage_Refuses` (owner `coreutils`; the generic message), `TestRun_DpkgError_FailsClosed` (dpkg exit 2; error contains `dpkg -S`).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go test ./internal/selfupdate/ -run 'PackageOwners|RefusePackageOwned|Run_PackageOwned|Run_ForeignPackage|Run_DpkgError' 2>&1 | tail -5`, and the `Run` tests in the `golang:1.24` container (they are Linux-only)
Expected: build failure, `undefined: packageOwners` / `refusePackageOwned`.

- [ ] **Step 3: Implement `packageOwners` and `refusePackageOwned` in `channel.go`; call them in `Run` step 2**

Keep each stdout line that ends with `": " + path` and does not start with `diversion by ` or `local diversion `; the part before that suffix is `<pkgs>`; split `<pkgs>` on `, `; cut each name at its first `:`. In `Run`, `owners, err := packageOwners(ctx, resolved)`, return `err`, then return `refusePackageOwned(resolved, owners)` if non-nil, before step 3 (so `--check` refuses too). `self_update.go` Short: `Update a mathion CLI installed with curl | sh`. Rename `aptEntity` → `siblingEntity` in the Go tests; reword the `S_apt` comment in `verify.go` and "channel-aware" in `httpget.go`.

- [ ] **Step 4: Run the package and CLI tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go vet ./... && go test ./... 2>&1 | tail -15`, then the same in the `golang:1.24` container on a tree copy
Expected: all `ok` on both, including `TestRun_HappyPath_Swaps`.

- [ ] **Step 5: Rewrite the integration test's apt legs**

`cli/selfupdate_integration_test.sh`: header line names "package-owned refusal" and "sibling-subkey reject" instead of "apt defer, S_apt reject"; leg 2's comments and messages say sibling subkey; leg 3 keeps its fake dpkg-owned `/usr/bin/mathion` and asserts, with `set -e` kept safe (`if out=$(…); then fail; fi`): non-zero exit and output containing `belongs to the system package mathion`, for both `self-update --yes` and `self-update --check`, and `/usr/bin/mathion version --short` still prints the old version; the final summary line names the new legs.

- [ ] **Step 6: Run the integration test in a disposable container**

Run (copy the tree to `$SDD/tmp/probe` first):
`docker run --rm -v "$PWD/.superpowers/sdd/2026-11-16-remove-apt/tmp/probe:/w" -w /w golang:1.24 sh -c 'apt-get update -qq && apt-get install -y -qq gnupg python3 >/dev/null && MATHION_SELFUPDATE_E2E=1 sh cli/selfupdate_integration_test.sh' 2>&1 | tail -5`
Expected: `self-update integration PASSED (…)`. `shellcheck cli/selfupdate_integration_test.sh` clean.

- [ ] **Step 7: Review lanes, then commit on the user's OK**

`fix(self-update): refuse a package-owned binary instead of deferring to apt`

---

### Task 2: `mathion licenses`

**Files:**
- Create: `cli/internal/notices/notices.go`, `cli/internal/notices/THIRD_PARTY_NOTICES` (moved from `deploy/deb/` with `git mv`, plus the Go standard library section)
- Create: `cli/cmd/licenses.go`
- Modify: `cli/cmd/root.go` (`AddCommand`, `driftHookExcluded`)
- Test: `cli/internal/notices/notices_test.go`, `cli/cmd/licenses_test.go`, `cli/cmd/root_test.go` (exclusion cases)

**Interfaces:**
- Produces: `package notices` with `//go:embed THIRD_PARTY_NOTICES` into `var Text string`.
- Produces: `func newLicensesCmd(app *App) *cobra.Command`, `Use: "licenses"`, `Short: "Print the licences of Mathion and the code built into it"`.

- [ ] **Step 1: Write the failing tests**

`notices_test.go`:
- `TestNoticesCoverCompiledModules`: for `GOOS=linux GOARCH=amd64` and `arm64`, run `go list -deps -f '{{with .Module}}{{.Path}}{{end}}' github.com/svkucheryavski/mathion/cli`, drop empty lines and the main module, dedupe, fail if none are left, and assert each module has a whole line `===== <module> =====` in `notices.Text` (match with `(?m)^===== (.+) =====$`). Skip only when `go` is not on PATH.
- `TestNoticesHaveGoStandardLibrary`: `notices.Text` has the line `===== Go standard library =====`, and the text under it (up to the next header) contains `Copyright 2009 The Go Authors`, `Redistribution and use in source and binary forms` and `Additional IP Rights Grant (Patents)` (the first also appears in other sections, so the check is per section).
- `TestNoticesStartWithAHeader`: `notices.Text` starts with `===== ` (so `licenses` prints one blank line, not two).

`licenses_test.go`, `TestLicensesPrintsNotices`: run the root command with args `licenses`, an empty temp `CfgDir` (no `.env`) and a recording `Runner`; assert exit nil, stdout starts with `Mathion CLI is licensed under the Apache License 2.0 (see LICENSE in the source repository).\n\n`, then equals that line + blank line + `notices.Text`; stderr empty (no drift notice); the runner was never called. `TestLicensesListedInHelp`: root `--help` output contains `\n  licenses `.

`root_test.go`: add `licenses` to the `TestDriftHookExcludedPredicate` names and to the exec (seeded-drift) cases of `TestPreRunExcludedCommandsSilent`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go test ./internal/notices/ ./cmd/ -run 'Notices|Licenses|DriftHook|PreRunExcluded' 2>&1 | tail -5`
Expected: build failure (`package notices` / `newLicensesCmd` undefined).

- [ ] **Step 3: Implement**

`git mv deploy/deb/THIRD_PARTY_NOTICES cli/internal/notices/THIRD_PARTY_NOTICES`; drop the file's leading blank line; append the `===== Go standard library =====` section: the upstream Go `LICENSE` and `PATENTS`, verbatim, from the `go1.24` tag of github.com/golang/go (fetch with `curl -fsSL https://raw.githubusercontent.com/golang/go/go1.24.0/LICENSE` and `/PATENTS`). Add `notices.go`, `licenses.go` (`Args: cobra.NoArgs`; writes the line, a blank line, `notices.Text` to `app.Out`), register it in `newRootCmd`, and add `"licenses"` to the `driftHookExcluded` switch.

- [ ] **Step 4: Run the CLI tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go vet ./... && go test ./... 2>&1 | tail -15`, then the same in the `golang:1.24` container on a tree copy
Expected: all `ok` on both. Then `go build -o "$SDD/tmp/m" . && "$SDD/tmp/m" licenses | head -3` shows the first line, a blank line and `===== github.com/spf13/cobra =====`.

- [ ] **Step 5: Review lanes, then commit on the user's OK**

`feat(cli): mathion licenses prints the built-in licence notices`

---

### Task 3: Remove the apt leftovers in the CLI and `install.sh`

**Files:**
- Delete: `cli/cmd/drift_probe.go`, `cli/cmd/drift_probe_test.go`
- Modify: `cli/main.go:17-22` (the `_drift-probe` fast path)
- Modify: `cli/cmd/version.go` (dual-install warning, `aptBinPath`/`curlBinPath`/`binExists` if unused afterwards, the dpkg comment at :87-88)
- Modify: `cli/cmd/version_test.go:170-185` (warning test removed)
- Modify: `deploy/install.sh:14` (comment), `:90-97` (warning block)
- Modify: `deploy/install_sh_test.sh` (`SUB_APT` → `SUB_SIBLING`, its comments)

**Interfaces:**
- Consumes: nothing from T1/T2.
- Removes: `cmd.RunDriftProbe`; nothing else references it after `main.go`.

- [ ] **Step 1: Confirm the leftover set before deleting**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion && git grep -n -E 'RunDriftProbe|_drift-probe|aptBinPath|curlBinPath|binExists|apt-managed' -- cli deploy/install.sh`
Expected: hits only in the files listed above. Any other hit is ledgered and added to this task.

- [ ] **Step 2: Remove them**

Delete the probe files and the `main.go` fast path; drop the warning function, its call, its vars and its test from `version.go`/`version_test.go`; drop the `install.sh` warning block and reword line 14 to name a sibling subkey; rename `SUB_APT` in `install_sh_test.sh`.

- [ ] **Step 3: Run the CLI tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go vet ./... && go test ./... 2>&1 | tail -15`, then the same in the `golang:1.24` container on a tree copy
Expected: all `ok` on both.

- [ ] **Step 4: Run the installer test**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion && shellcheck deploy/install.sh deploy/install_sh_test.sh && sh deploy/install_sh_test.sh 2>&1 | tail -5`
Expected: shellcheck clean; the test's PASS line, including case 3 (sibling subkey rejected).

- [ ] **Step 5: Review lanes, then commit on the user's OK**

`refactor(cli): drop the drift probe and the dual-install warnings`

---

### Task 4: Remove the build, CI and packaging pieces

**Files:**
- Delete: `.github/workflows/apt-resign.yml`, `deploy/apt/`, `deploy/deb/` (after `sign_test.sh` moves; `THIRD_PARTY_NOTICES` moved in T2), `deploy/man/`, `deploy/keys/mathion-apt-keyring.asc`
- Move: `deploy/deb/sign_test.sh` → `cli/scripts/sign_test.sh` (`git mv`; reword its nfpm comment at :34-35)
- Modify: `cli/.goreleaser.yaml` (`nfpms` section; the snapshot comment at :58-61, keep `version_template`)
- Modify: `cli/scripts/selfupdate-ci-guards.sh:20-28` (deb inputs; guards 1-3 unchanged)
- Modify: `.github/workflows/ci.yml` (delete `apt-e2e`; rename `apt-scripts` → `release-scripts`; its shellcheck line becomes `shellcheck deploy/keys/*.sh cli/scripts/*.sh cli/*.sh` (today's line minus `deploy/apt` and `deploy/deb`); its test step runs `sh cli/scripts/sign_test.sh` only; step names and comments lose "apt")
- Modify: `.github/workflows/release-cli.yml` (delete "Prepare .deb assets", the deb Version check + comment, `dist/*.deb` in `gh release create`, the `upload-artifact` step, the `apt-publish` job; keep the S_rel-only/stub-primary assertion, rewording only its `S_apt` comment)
- Modify: `.github/workflows/amd64-smoke.yml` (delete the `.deb` step and its `setup-go` + `goreleaser-action` steps)
- Modify: `.gitignore:21-25`
- Modify: `deploy/keys/gen-signing-keys.sh` (S_apt creation, export, checks, printed lines)

**Interfaces:**
- Consumes: T2 moved `THIRD_PARTY_NOTICES` out of `deploy/deb/`.

- [ ] **Step 1: Delete and move**

`git rm -r` the deletions; `git mv` `sign_test.sh`; then delete the ignored local leftovers `deploy/man/mathion.1.gz`, `deploy/deb/*.gz`, `deploy/keys/mathion-archive-keyring.gpg` (list them first with `ls`).

- [ ] **Step 2: Edit the build config, guards script, workflows, `.gitignore` and `gen-signing-keys.sh`** as listed above.

- [ ] **Step 3: Lint**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion && shellcheck deploy/keys/*.sh cli/scripts/*.sh cli/*.sh deploy/install.sh deploy/install_sh_test.sh && for f in .github/workflows/*.yml; do ruby -ryaml -e 'YAML.load_file(ARGV[0])' "$f" || echo "BAD $f"; done`
Expected: no output from shellcheck, no `BAD` line.

- [ ] **Step 4: Run the release-scripts job's checks locally**

Run: `sh cli/scripts/sign_test.sh && (cd cli && goreleaser check) && S_REL_FPR=06AAFF0CB03A5678149093D42243DC4FF7FDFF35 S_REL_EMBEDDED_FPR=06AAFF0CB03A5678149093D42243DC4FF7FDFF35 sh cli/scripts/selfupdate-ci-guards.sh && S_REL_FPR=06AAFF0CB03A5678149093D42243DC4FF7FDFF35 sh cli/scripts/release-embedded-key-guard.sh`
Expected: each script's PASS line; `sign_test.sh` reports `checksums.txt.asc` produced; `goreleaser check` reports the config valid.

- [ ] **Step 5: Check the release job keeps its signed assets**

Run: `grep -n "gh release create" .github/workflows/release-cli.yml`
Expected: one line uploading `dist/*.tar.gz dist/checksums.txt dist/checksums.txt.asc` and no `.deb`. And `grep -c "apt-publish\|upload-artifact" .github/workflows/release-cli.yml` → `0`.

- [ ] **Step 6: Review lanes, then commit on the user's OK**

`build: remove the apt repository, .deb packaging and their CI`

---

### Task 5: Docs and the leftover sweep

**Files:**
- Modify: `README.md` (apt section :106-151 out; the *Check the release key (out of band)* paragraph in after the "Prefer to read before you run?" block; "Updating the CLI" :333-350; "or apt" :267; the stack-definition sentence :405; one line naming `mathion licenses` in the CLI section)
- Modify: `deploy/keys/README.md` (one subkey, `S_rel`; keep the `"<fpr>!"` export form; the S_apt retirement note; the out-of-band paragraph at :251-253)
- Modify: `docs/release-notes/branding-release-order.md`, `docs/release-notes/settings-release-order.md` (apt lines and line pairs)
- Modify: `PROJECT.md:249` (install line)

**Interfaces:** none.

- [ ] **Step 1: Write the docs** with the spec's fixed copy ("The fingerprint check", "Fixed copy", the README licences line).

- [ ] **Step 2: Run the README check command against the real script**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion && sed -n '/BEGIN PGP PUBLIC KEY BLOCK/,/END PGP PUBLIC KEY BLOCK/p' deploy/install.sh | gpg --show-keys | sed -n 2p | tr -d ' '`
Expected: `F00602DFE1BF8CD2B321FC72AD21D4AD294C31A0`.

- [ ] **Step 3: Sweep for leftovers**

Run: `git grep -n -i -E '\bapt\b|apt-get|\.deb\b|dpkg|s_apt|nfpm|mathion\.1|drift-probe|archive-keyring|gh-pages|PAGES_DEPLOY' -- ':!docs/superpowers' ':!docs/backlog'`
Expected: only the dpkg ownership check and its tests (T1), the refusal message (`sudo apt remove mathion`), `deploy/keys/README.md`'s retirement note, and `PROJECT.md` lines that are not about installing. Every other hit is fixed or ledgered with a reason.

- [ ] **Step 4: Full checks**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go vet ./... && go test ./... 2>&1 | tail -3`, then the same in the `golang:1.24` container on a tree copy; `cd /Users/svkucheryavski/Documents/Developing/mathion && sh deploy/install_sh_test.sh | tail -1`
Expected: all `ok` on both; installer test PASS.

- [ ] **Step 5: Review lanes, then commit on the user's OK**

`docs: one install channel; check the release key in install.sh`

---

### Step 6 (after T5): the gh-pages commit

Not on this branch. Fetch the live branch over HTTPS (public, no credentials): `git fetch https://github.com/svkucheryavski/mathion gh-pages:gh-pages-live`. On a local branch from it: remove the apt block from `index.html`, rewrite its "Verify the release key" section with the spec's command and wording, `git rm -r deb/`. Check the page in agent-browser (open the file locally, no apt text, verify section shows the `sed … | gpg --show-keys` command). Review lanes, commit on the user's OK. The user pushes it (`git push origin gh-pages-live:gh-pages`) after pushing `main`, then does the spec's manual steps 2-5.
