# Phase 9-D Slice 4a — apt packaging + release signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apt install mathion` from a GPG-signed apt repository on GitHub Pages, produce a signed `.deb`, sign the release `checksums.txt`, upgrade `install.sh` to verify authenticity, and warn on dual-install — closing the "integrity only, not authenticity" gap for the curl|sh channel.

**Architecture:** goreleaser gains `nfpms:` (build a `.deb`) and `signs:` (sign `checksums.txt` with subkey `S_rel`). A new `deploy/apt/build.sh` turns the built `.deb`s into a signed apt repo (`apt-ftparchive generate`, signed by subkey `S_apt`) published to the `gh-pages` branch by an `apt-publish` CI job; a scheduled `apt-resign.yml` refreshes `Valid-Until`. `install.sh` verifies `checksums.txt.asc` against an embedded public key. Everything is developed and tested against **throwaway keys**; the real key + GitHub setup are manual maintainer prerequisites.

**Tech Stack:** Go 1.24 CLI (module `github.com/svkucheryavski/mathion/cli`, cobra) · goreleaser v2 + nfpm · GnuPG (subkeys) · apt-utils (`apt-ftparchive`) · GitHub Actions + GitHub Pages · POSIX `sh`.

**Source spec:** `docs/superpowers/specs/2026-08-13-phase9-d-slice4-apt-signing-selfupdate-design.md` (§2.1 scopes 4a; 4b — `mathion self-update` — is a separate later plan and is OUT of this plan).

## Global Constraints

- **Commit trailer (exact):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`git add` exact named paths only** — never `-A`, never `.`.
- **Go tooling is module-scoped:** run `go`/`goreleaser` from `cli/`.
- **`.deb`:** package `mathion`; binary → `/usr/bin/mathion` (never `/usr/local`); arch `amd64`+`arm64`; version = `0.2.0`-style (strip the `cli-v` prefix — via `GORELEASER_CURRENT_TAG`, asserted with `dpkg-deb -f`); `Section: admin`, `Priority: optional`; **`Suggests: docker.io`** or none (NEVER `Recommends` — apt installs it by default); ships the keyring as **ordinary data, never a conffile**; NOT individually debsig-signed.
- **Keyring path:** `/usr/share/keyrings/mathion-archive-keyring.gpg` (package-managed); `sources.list` uses `signed-by=` that path; `.nojekyll` at the **branch root**, apt content under `deb/`.
- **apt repo:** single suite `stable`, component `main`, arches `amd64 arm64`; built with `apt-ftparchive generate` (`Tree{}` per-arch, `APT::FTPArchive::DoByHash "true"`); `Release` carries `Origin/Label/Suite/Codename/Components/Architectures/Date`, **`Acquire-By-Hash: yes`**, and a computed **`Valid-Until`**; both `InRelease` (clearsigned) and `Release.gpg` (detached).
- **Two signing subkeys under one offline primary:** `S_rel` signs `checksums.txt` (curl|sh); `S_apt` signs the apt `Release`. Signing is non-interactive: `--batch --pinentry-mode loopback --local-user <fpr>!`, passphrase via stdin; goreleaser `signs:` MUST set `artifacts: checksum`, `${artifact}.asc`, `--armor`.
- **Verification (install.sh):** `--status-fd 1`; accept only `GOODSIG` + a `VALIDSIG` whose **primary fingerprint** is the expected one, with **no** `EXPKEYSIG`/`REVKEYSIG`/`EXPSIG`/`ERRSIG`/`BADSIG`; require **exactly one** matching checksum line; fail closed if `gnupg` absent.
- **Canonical public key:** `deploy/keys/mathion-pubkey.asc` (full public key incl. both subkeys). install.sh embeds it verbatim.
- **CI:** signing secrets only in protected environments — `release` (holds `S_rel`+`S_apt`, deploy restricted to `cli-v*` tags) and `pages-resign` (holds only `S_apt`, deploy restricted to `main`, unattended). SHA-pin all actions in signing/publish jobs. Cross-job artifacts via `upload/download-artifact` (never re-download from Releases). gh-pages publication is concurrency-guarded and must trigger a Pages rebuild (a `GITHUB_TOKEN` push does NOT).
- **Tests use throwaway keys only** — never the production key.

---

## Manual prerequisites (maintainer — NOT agent tasks)

These cannot be done by an implementer subagent; document them in `deploy/keys/README.md` (Task 3) and the README (Task 10), and treat their absence as "the real-key release path is validated later by a tagged release."

1. **Key generation (offline):** create an offline **primary** key (Ed25519 or RSA ≥ 3072) and two signing **subkeys** `S_rel` and `S_apt` (set an expiry, e.g. 2 years), and a revocation certificate stored offline. Export the **full public key** (primary + both subkeys) to `deploy/keys/mathion-pubkey.asc`, its dearmored form to the Pages `deb/mathion-archive-keyring.gpg`, and paste the ASCII-armored public key into `install.sh`'s embedded block. Record `EXPECTED_PRIMARY_FPR` (the 40-hex primary fingerprint) and each subkey fingerprint.
2. **GitHub environments + secrets:** create environment **`release`** (deployment branches/tags restricted to `cli-v*`) with secrets `GPG_S_REL_PRIVATE`, `GPG_S_APT_PRIVATE`, `GPG_PASSPHRASE`; create environment **`pages-resign`** (deployment branch = `main`, no required reviewers, wait-timer 0) with secrets `GPG_S_APT_PRIVATE`, `GPG_PASSPHRASE`.
3. **Pages deploy token:** create a fine-grained PAT or GitHub App installation token with `contents:write` (and `pages:write` if using the build API) on this repo; store as `PAGES_DEPLOY_TOKEN` in both environments. (A default `GITHUB_TOKEN` push to `gh-pages` does not trigger a Pages build.)
4. **Pages + branch:** create an empty `gh-pages` branch; enable **GitHub Pages** with source = `gh-pages` branch, root.
5. **Tag protection:** protect `cli-v*` tags.

Until (1)–(5) exist, the tag-triggered signing/publish jobs will not run to green — that is expected. All agent tasks below are validated with throwaway keys.

---

## Task 1: `mathion version` dual-install warning

**Files:**
- Modify: `cli/cmd/version.go`
- Test: `cli/cmd/version_test.go`

**Interfaces:**
- Produces: package-level seams `binExists func(string) bool`, `lookPath func(string) (string, error)`, and `maybeWarnDualInstall(w io.Writer)`; constants `aptBinPath = "/usr/bin/mathion"`, `curlBinPath = "/usr/local/bin/mathion"`.

- [ ] **Step 1: Write the failing test**

Add to `cli/cmd/version_test.go`:

```go
func TestMaybeWarnDualInstall(t *testing.T) {
	origExists, origLook := binExists, lookPath
	t.Cleanup(func() { binExists, lookPath = origExists, origLook })

	// both channels present -> warn, naming the PATH-resolved binary
	binExists = func(p string) bool { return p == aptBinPath || p == curlBinPath }
	lookPath = func(string) (string, error) { return curlBinPath, nil }
	var buf bytes.Buffer
	maybeWarnDualInstall(&buf)
	out := buf.String()
	if !strings.Contains(out, aptBinPath) || !strings.Contains(out, curlBinPath) {
		t.Fatalf("warning should name both paths; got %q", out)
	}
	if !strings.Contains(out, "your shell runs: "+curlBinPath) {
		t.Fatalf("warning should name the PATH-resolved binary; got %q", out)
	}

	// only one channel -> silent
	binExists = func(p string) bool { return p == curlBinPath }
	buf.Reset()
	maybeWarnDualInstall(&buf)
	if buf.Len() != 0 {
		t.Fatalf("no warning expected for a single install; got %q", buf.String())
	}
}
```

Add imports `bytes`, `strings` to the test file if missing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && go test ./cmd/ -run TestMaybeWarnDualInstall -v`
Expected: FAIL — `undefined: binExists` / `maybeWarnDualInstall`.

- [ ] **Step 3: Implement the seams + warning**

In `cli/cmd/version.go`, add imports `os/exec` (keep existing imports) and after the `versionProbeTimeout` const add:

```go
const (
	aptBinPath  = "/usr/bin/mathion"
	curlBinPath = "/usr/local/bin/mathion"
)

// Seams so version_test.go stays hermetic (no dependence on the test host's
// installed binaries or PATH).
var (
	binExists = func(p string) bool { _, err := os.Stat(p); return err == nil }
	lookPath  = exec.LookPath
)

// maybeWarnDualInstall emits a non-fatal warning when mathion is installed via
// BOTH channels (apt -> /usr/bin, curl|sh -> /usr/local/bin). /usr/local/bin
// precedes /usr/bin on the default PATH, so `apt upgrade` can update a binary
// the shell never runs. Never deletes anything.
func maybeWarnDualInstall(w io.Writer) {
	if !(binExists(aptBinPath) && binExists(curlBinPath)) {
		return
	}
	active := curlBinPath + " (PATH precedence)"
	if p, err := lookPath("mathion"); err == nil {
		active = p
	}
	fmt.Fprintf(w, "warning: mathion is installed via BOTH apt (%s) and curl|sh (%s).\n", aptBinPath, curlBinPath)
	fmt.Fprintf(w, "         your shell runs: %s\n", active)
	fmt.Fprintln(w, "         use one channel only — remove the other (see README).")
}
```

Add `"os"` to imports if not present (it is used elsewhere? version.go currently imports `io`, `io/fs`, `net/http` — add `"os"` and `"os/exec"`).

In `newVersionCmd`'s `RunE`, immediately after `fmt.Fprintf(app.Out, "mathion %s\n", buildVersion)` and BEFORE the `versionEnvReader` call, insert:

```go
	maybeWarnDualInstall(app.Err)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cli && go test ./cmd/ -run TestMaybeWarnDualInstall -v && go vet ./...`
Expected: PASS, vet clean.

- [ ] **Step 5: Run the full cmd suite (no regressions)**

Run: `cd cli && go test ./...`
Expected: PASS (the warning is silent unless both real paths exist, which they won't in CI/unit).

- [ ] **Step 6: Commit**

```bash
git add cli/cmd/version.go cli/cmd/version_test.go
git commit -m "$(printf 'feat(cli): warn when mathion is installed via both apt and curl|sh\n\nEmitted by `mathion version` before its early returns, behind stat/LookPath\nseams so version_test.go stays hermetic. Non-destructive (Slice 4a dual-install).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: `install.sh` authenticity + dual-install warning + greatest-stable resolver

**Files:**
- Modify: `deploy/install.sh`
- Modify: `deploy/install_sh_test.sh`

**Interfaces:**
- Produces (in `install.sh`): a `verify_signature` step gated on the embedded key; `EXPECTED_PRIMARY_FPR` constant; a greatest-stable `cli-vX.Y.Z` tag resolver.

- [ ] **Step 1: Write the failing test (signature verify + resolver, throwaway key)**

Append to `deploy/install_sh_test.sh` (before the final `echo "install_sh_test PASSED"`). It builds a throwaway keypair, signs a `checksums.txt`, and exercises the exact status-fd acceptance rule + the resolver:

```sh
# ---- authenticity verification (throwaway key; mirrors install.sh's rule) ----
command -v gpg >/dev/null 2>&1 || { echo "SKIP: gpg not present"; exit 0; }
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
cat > "$GNUPGHOME/keyparams" <<'PARAMS'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign,cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Test
Name-Email: test@example.invalid
Expire-Date: 0
%commit
PARAMS
gpg --batch --gen-key "$GNUPGHOME/keyparams" >/dev/null 2>&1
FPR="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
echo "hello" > "$GNUPGHOME/checksums.txt"
gpg --batch --yes --armor --detach-sign -o "$GNUPGHOME/checksums.txt.asc" "$GNUPGHOME/checksums.txt"

# the acceptance rule install.sh uses, extracted for test:
sig_ok() { # $1=sig $2=signed $3=expected primary fpr
  s="$(gpg --batch --no-tty --status-fd 1 --verify "$1" "$2" 2>/dev/null)" || return 1
  echo "$s" | grep -q '^\[GNUPG:\] GOODSIG' || return 1
  echo "$s" | grep -Eq '^\[GNUPG:\] (EXPKEYSIG|REVKEYSIG|EXPSIG|ERRSIG|BADSIG)' && return 1
  echo "$s" | grep -q "^\[GNUPG:\] VALIDSIG .* ${3}\$"
}
sig_ok "$GNUPGHOME/checksums.txt.asc" "$GNUPGHOME/checksums.txt" "$FPR" \
  || { echo "FAIL: good signature did not verify"; exit 1; }
# tamper the signed file -> must fail
echo "tampered" >> "$GNUPGHOME/checksums.txt"
if sig_ok "$GNUPGHOME/checksums.txt.asc" "$GNUPGHOME/checksums.txt" "$FPR"; then
  echo "FAIL: tampered file verified"; exit 1
fi
# wrong expected fingerprint -> must fail (restore the good signed content first)
printf 'hello\n' > "$GNUPGHOME/checksums.txt"
if sig_ok "$GNUPGHOME/checksums.txt.asc" "$GNUPGHOME/checksums.txt" "0000000000000000000000000000000000000000"; then
  echo "FAIL: wrong-fingerprint signature accepted"; exit 1
fi

# ---- greatest-stable resolver (mirrors install.sh) ----
resolve_latest() { printf '%s\n' "$1" | grep -E '^cli-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1; }
TAGS="$(printf '%s\n' cli-v0.2.0 cli-v0.10.0 cli-v0.2.0-rc1 cli-v0.9.0 v0.2.0)"
got="$(resolve_latest "$TAGS")"
[ "$got" = "cli-v0.10.0" ] || { echo "FAIL: resolver picked '$got', want cli-v0.10.0"; exit 1; }
echo "install_sh authenticity+resolver PASSED"
```

- [ ] **Step 2: Run to verify it fails against the CURRENT install.sh contract**

Run: `sh deploy/install_sh_test.sh`
Expected: it PASSES the new self-contained block (it tests extracted logic), but the block encodes the contract `install.sh` must now satisfy. Confirm the block runs green; if `gpg` is absent it SKIPs. (This block is the executable spec for Step 3.)

- [ ] **Step 3: Implement in `install.sh`**

In `deploy/install.sh`: (a) replace the first-match tag resolver, (b) add signature verification before the sha256 check, (c) add the dual-install warning, (d) drop the stale comment.

(a) Replace the `TAG` resolution block (the `while` loop that greps the first `cli-v*`) with a collect-all-then-greatest-stable resolver:

```sh
TAG="${1:-}"
if [ -z "$TAG" ]; then
  all=""
  page=1
  while [ "$page" -le 10 ]; do
    body="$(dl "${API}?per_page=100&page=${page}")" || break
    [ -z "$body" ] || [ "$body" = "[]" ] && break
    all="${all}
$(printf '%s' "$body" | grep -oE '"tag_name": *"cli-v[^"]*"' | sed -E 's/.*"(cli-v[^"]*)".*/\1/')"
    page=$((page + 1))
  done
  # greatest STABLE cli-vX.Y.Z (skip prereleases); sort -V exists on the Debian/Ubuntu target
  TAG="$(printf '%s\n' "$all" | grep -E '^cli-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
fi
[ -n "$TAG" ] || { echo "no stable cli-v* release found" >&2; exit 1; }
```

(b) Immediately after the two `dl` downloads of `${ASSET}` and `checksums.txt`, and BEFORE `echo "==> Verifying checksum"`, insert:

```sh
echo "==> Verifying signature"
command -v gpg >/dev/null 2>&1 || { echo "gnupg is required to verify the release signature; install it and retry" >&2; exit 1; }
dl "${DL}/${TAG}/checksums.txt.asc" -o "${TMP}/checksums.txt.asc"
VGPGHOME="$(mktemp -d)"; chmod 700 "$VGPGHOME"
trap 'rm -rf "$TMP" "$VGPGHOME"' EXIT
# >>> BEGIN EMBEDDED MATHION SIGNING KEY (filled by manual prereq: paste deploy/keys/mathion-pubkey.asc) <<<
cat > "${VGPGHOME}/key.asc" <<'MATHION_PUBKEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----
REPLACE_WITH_deploy/keys/mathion-pubkey.asc_CONTENTS
-----END PGP PUBLIC KEY BLOCK-----
MATHION_PUBKEY
# <<< END EMBEDDED MATHION SIGNING KEY >>>
EXPECTED_PRIMARY_FPR="REPLACE_WITH_40_HEX_PRIMARY_FINGERPRINT"
GNUPGHOME="$VGPGHOME" gpg --batch --no-tty --import "${VGPGHOME}/key.asc" >/dev/null 2>&1 \
  || { echo "failed to import the embedded signing key" >&2; exit 1; }
st="$(GNUPGHOME="$VGPGHOME" gpg --batch --no-tty --status-fd 1 \
       --verify "${TMP}/checksums.txt.asc" "${TMP}/checksums.txt" 2>/dev/null)"
printf '%s\n' "$st" | grep -q '^\[GNUPG:\] GOODSIG' \
  || { echo "signature verification FAILED (no GOODSIG)" >&2; exit 1; }
printf '%s\n' "$st" | grep -Eq '^\[GNUPG:\] (EXPKEYSIG|REVKEYSIG|EXPSIG|ERRSIG|BADSIG)' \
  && { echo "signature verification FAILED (expired/revoked/bad key)" >&2; exit 1; }
printf '%s\n' "$st" | grep -q "^\[GNUPG:\] VALIDSIG .* ${EXPECTED_PRIMARY_FPR}\$" \
  || { echo "signature is not from the expected Mathion key" >&2; exit 1; }
echo "==> Signature OK"
```

(c) After computing `ARCH`/before download, add a dual-install warning:

```sh
if command -v dpkg >/dev/null 2>&1 && dpkg -S /usr/local/bin/mathion >/dev/null 2>&1; then :; fi
if command -v dpkg >/dev/null 2>&1 && LC_ALL=C dpkg -S /usr/bin/mathion >/dev/null 2>&1; then
  echo "warning: an apt-managed mathion exists at /usr/bin/mathion; this curl|sh install to" >&2
  echo "         ${DEST} will shadow it on PATH. Use one channel only (see README)." >&2
fi
```

(d) Update the header comment: replace `# Integrity only (checksums.txt), NOT authenticity — signing is Slice 4.` with `# Verifies the release signature (checksums.txt.asc) against the embedded Mathion key, then the checksum.`

(e) Future-proof `install_sh_test.sh`'s own build step for Task 5: change its goreleaser line from `--skip=publish --snapshot` to `--skip=publish,sign --snapshot` (once Task 5 adds `signs:`, a snapshot build would otherwise try to sign with no key and fail). Skipping a not-yet-configured `sign` phase now is a harmless no-op.

Also make the exactly-one-line rule explicit — change the `want=` line to reject multiple matches:

```sh
matches="$(grep -c " ${ASSET}\$" "${TMP}/checksums.txt" || true)"
[ "$matches" = "1" ] || { echo "expected exactly one checksum line for ${ASSET} (got ${matches})" >&2; exit 1; }
want="$(grep " ${ASSET}\$" "${TMP}/checksums.txt" | awk '{print $1}')"
```

- [ ] **Step 4: Run the shell test + shellcheck**

Run: `sh deploy/install_sh_test.sh && shellcheck deploy/install.sh deploy/install_sh_test.sh`
Expected: PASS; shellcheck clean (add `# shellcheck disable=` only with a written reason).

- [ ] **Step 5: Assert install.sh encodes the contract (grep guards)**

Run:
```bash
grep -q 'GOODSIG' deploy/install.sh && grep -q 'EXPKEYSIG|REVKEYSIG' deploy/install.sh \
  && grep -q 'EXPECTED_PRIMARY_FPR' deploy/install.sh && grep -q 'sort -V' deploy/install.sh \
  && echo OK
```
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add deploy/install.sh deploy/install_sh_test.sh
git commit -m "$(printf 'feat(cli): install.sh verifies the release signature + greatest-stable resolver\n\nVerify checksums.txt.asc against the embedded Mathion key via --status-fd\n(GOODSIG + expected primary fingerprint, reject EXP/REVKEYSIG), exactly-one\nchecksum line, dual-install warning, and pick the greatest STABLE cli-vX.Y.Z\ninstead of the first API-ordered match. Embedded key filled by the manual\nkey prereq. Slice 4a authenticity.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Packaging assets (LICENSE, man page, copyright, changelog, key docs)

**Files:**
- Create: `LICENSE`
- Create: `deploy/man/mathion.1`
- Create: `deploy/deb/copyright` (DEP-5 machine-readable)
- Create: `deploy/deb/changelog.Debian` (source; gzipped at package time)
- Create: `deploy/deb/lintian-overrides/mathion` (statically-linked Go binary)
- Create: `deploy/keys/README.md`
- Create: `deploy/keys/mathion-pubkey.asc` (placeholder; filled by manual prereq)

**Interfaces:**
- Produces: the on-disk paths nfpm packages in Task 4, and the canonical pubkey path referenced by install.sh (Task 2) and 4b.

- [ ] **Step 1: LICENSE (Apache-2.0)**

Write the verbatim Apache License 2.0 text (from `https://www.apache.org/licenses/LICENSE-2.0.txt`) to `LICENSE`, with the standard copyright line `Copyright 2026 Sergey Kucheryavskiy` in the appendix.

- [ ] **Step 2: Man page `deploy/man/mathion.1`**

```troff
.TH MATHION 1 "2026-08-13" "mathion" "Mathion CLI Manual"
.SH NAME
mathion \- self-host and manage a Mathion deployment
.SH SYNOPSIS
.B mathion
[\fIcommand\fR] [\fIflags\fR]
.SH DESCRIPTION
.B mathion
installs, updates, backs up, and operates a self-hosted Mathion stack
(FastAPI + PostgreSQL + Svelte) via Docker Compose.
.SH COMMANDS
.TP
.B install
Install and start a Mathion deployment.
.TP
.B start\fR, \fBstop\fR, \fBstatus\fR, \fBlogs
Operate the running stack.
.TP
.B backup\fR, \fBrestore\fR, \fBupdate
Back up, restore, and update the deployment.
.TP
.B superuser\fR, \fBpin\fR, \fBversion\fR, \fBuninstall
Manage the superuser, pin the image, print versions, remove the deployment.
.SH SEE ALSO
Project documentation: https://github.com/svkucheryavski/mathion
.SH AUTHOR
Sergey Kucheryavskiy
```

- [ ] **Step 3: `deploy/deb/copyright` (DEP-5)**

```
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: mathion
Source: https://github.com/svkucheryavski/mathion

Files: *
Copyright: 2026 Sergey Kucheryavskiy
License: Apache-2.0
 On Debian systems the full text of the Apache License 2.0 can be found in
 /usr/share/common-licenses/Apache-2.0.

Files: vendored Go dependencies (statically linked)
Copyright: see THIRD_PARTY_NOTICES generated by go-licenses
License: Apache-2.0 and BSD-3-Clause
 github.com/spf13/cobra, github.com/inconshreveable/mousetrap: Apache-2.0.
 github.com/spf13/pflag: BSD-3-Clause.
 The verbatim texts are shipped in /usr/share/doc/mathion/THIRD_PARTY_NOTICES.gz.
```

- [ ] **Step 4: Generate third-party notices**

Run:
```bash
cd cli && go run github.com/google/go-licenses@latest report ./... \
  --template ../deploy/deb/notices.tpl > ../deploy/deb/THIRD_PARTY_NOTICES 2>/dev/null || \
  go-licenses save ./... --save_path=../deploy/deb/licenses 2>/dev/null || true
```
If `go-licenses` is unavailable offline, hand-assemble `deploy/deb/THIRD_PARTY_NOTICES` by concatenating the `LICENSE` files of cobra (Apache-2.0), mousetrap (Apache-2.0), and pflag (BSD-3) from the module cache (`go list -m -f '{{.Dir}}' <mod>`). The file MUST contain each dependency's verbatim license text.

- [ ] **Step 5: changelog + lintian override**

`deploy/deb/changelog.Debian`:
```
mathion (0.2.0) stable; urgency=medium

  * Initial apt release: signed .deb + apt repository (Phase 9-D Slice 4a).

 -- Sergey Kucheryavskiy <svkucheryavski@gmail.com>  Thu, 13 Aug 2026 00:00:00 +0000
```

`deploy/deb/lintian-overrides/mathion`:
```
# mathion is a statically-linked Go binary by design (CGO_ENABLED=0).
mathion: statically-linked-binary [usr/bin/mathion]
```

- [ ] **Step 6: `deploy/keys/mathion-pubkey.asc` placeholder + `deploy/keys/README.md`**

`deploy/keys/mathion-pubkey.asc`:
```
-----BEGIN PGP PUBLIC KEY BLOCK-----
PLACEHOLDER — replaced by the manual key prereq with the full public key
(offline primary + signing subkeys S_rel and S_apt). See deploy/keys/README.md.
-----END PGP PUBLIC KEY BLOCK-----
```

`deploy/keys/README.md`: document (per spec §6.1, §14) — generating the offline primary + `S_rel`/`S_apt` subkeys with expiry; exporting the full public key here + the dearmored keyring to Pages + into `install.sh`; the `EXPECTED_PRIMARY_FPR`; storing the revocation cert offline; the rotation procedure (issue a new subkey from the offline primary during an overlap grace window in which the outgoing subkey still signs; ship the refreshed pubkey in the next release/`.deb`); the compromise/revocation procedure; and the out-of-band fingerprint publication.

- [ ] **Step 7: Validate the man page + presence checks**

Run:
```bash
mandoc -Tlint deploy/man/mathion.1 || man --warnings=all -l deploy/man/mathion.1 >/dev/null
test -f LICENSE && grep -q "Apache License" LICENSE
test -s deploy/deb/THIRD_PARTY_NOTICES
grep -q "Apache-2.0" deploy/deb/copyright && echo OK
```
Expected: no man lint errors; `OK`.

- [ ] **Step 8: Commit**

```bash
git add LICENSE deploy/man/mathion.1 deploy/deb/copyright deploy/deb/changelog.Debian deploy/deb/lintian-overrides/mathion deploy/deb/THIRD_PARTY_NOTICES deploy/keys/README.md deploy/keys/mathion-pubkey.asc
git commit -m "$(printf 'chore(cli): Slice 4a packaging assets (LICENSE, man, copyright, keys doc)\n\nApache-2.0 LICENSE; mathion.1 man page; DEP-5 copyright + third-party notices;\nDebian changelog; lintian override for the static Go binary; deploy/keys/README\n(key generation/rotation/revocation) + pubkey placeholder for the manual prereq.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: nfpm `.deb` in goreleaser + postinst + version assertion

**Files:**
- Modify: `cli/.goreleaser.yaml`
- Create: `deploy/deb/postinst.sh`
- Create: `deploy/deb/deb_test.sh`

**Interfaces:**
- Consumes: `deploy/deb/*` assets (Task 3), the `mathion` build (existing).
- Produces: `dist/mathion_*.deb` with binary `/usr/bin/mathion`, version `0.2.0`, the keyring as ordinary data.

- [ ] **Step 1: Write the failing test (`deploy/deb/deb_test.sh`)**

```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")/../../cli"
CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
  goreleaser release --clean --skip=publish,sign --snapshot
cd dist
deb="$(ls mathion_*_amd64.deb 2>/dev/null | head -1)"
[ -n "$deb" ] || { echo "FAIL: no amd64 .deb built"; exit 1; }
# version must be 0.2.0 (cli-v stripped)
v="$(dpkg-deb -f "$deb" Version)"; [ "$v" = "0.2.0" ] || { echo "FAIL: deb Version=$v want 0.2.0"; exit 1; }
# binary at /usr/bin, keyring shipped, man+copyright present
dpkg-deb -c "$deb" | grep -q ' ./usr/bin/mathion$' || { echo "FAIL: /usr/bin/mathion missing"; exit 1; }
dpkg-deb -c "$deb" | grep -q ' ./usr/share/keyrings/mathion-archive-keyring.gpg$' || { echo "FAIL: keyring missing"; exit 1; }
dpkg-deb -c "$deb" | grep -q ' ./usr/share/man/man1/mathion.1.gz$' || { echo "FAIL: man page missing"; exit 1; }
dpkg-deb -c "$deb" | grep -q ' ./usr/share/doc/mathion/copyright$' || { echo "FAIL: copyright missing"; exit 1; }
# keyring must NOT be a conffile
if dpkg-deb -e "$deb" ctrl 2>/dev/null && [ -f ctrl/conffiles ] && grep -q mathion-archive-keyring ctrl/conffiles; then
  echo "FAIL: keyring is a conffile"; exit 1; fi
# Recommends must NOT pull docker (Suggests or none only)
dpkg-deb -f "$deb" Recommends | grep -qi docker && { echo "FAIL: docker in Recommends"; exit 1; } || true
rm -rf ctrl
echo "deb_test PASSED"
```

- [ ] **Step 2: Run to verify it fails**

Run: `sh deploy/deb/deb_test.sh`
Expected: FAIL — `no amd64 .deb built` (goreleaser has no `nfpms:` yet).

- [ ] **Step 3: postinst script**

`deploy/deb/postinst.sh`:
```sh
#!/bin/sh
set -e
if [ "$1" = configure ]; then
  if [ -e /usr/local/bin/mathion ]; then
    echo "mathion: a curl|sh copy at /usr/local/bin/mathion will shadow this apt package" >&2
    echo "mathion: on the default PATH; remove it (sudo rm /usr/local/bin/mathion) to use apt." >&2
  fi
fi
exit 0
```

- [ ] **Step 4: Add `nfpms:` to `cli/.goreleaser.yaml`**

Append after the `archives:` block:

```yaml
nfpms:
  - id: mathion
    package_name: mathion
    file_name_template: "mathion_{{ .Version }}_{{ .Arch }}"
    vendor: Mathion
    homepage: https://github.com/svkucheryavski/mathion
    maintainer: Sergey Kucheryavskiy <svkucheryavski@gmail.com>
    description: |
      Self-host and manage a Mathion deployment.
      CLI to install, update, back up, and operate a Mathion stack via Docker Compose.
    section: admin
    priority: optional
    formats: [deb]
    bindir: /usr/bin
    suggests:
      - docker.io
    contents:
      - src: ../deploy/keys/mathion-archive-keyring.gpg
        dst: /usr/share/keyrings/mathion-archive-keyring.gpg
        file_info: { mode: 0644 }
      - src: ../deploy/man/mathion.1.gz
        dst: /usr/share/man/man1/mathion.1.gz
      - src: ../deploy/deb/copyright
        dst: /usr/share/doc/mathion/copyright
      - src: ../deploy/deb/changelog.Debian.gz
        dst: /usr/share/doc/mathion/changelog.Debian.gz
      - src: ../deploy/deb/THIRD_PARTY_NOTICES.gz
        dst: /usr/share/doc/mathion/THIRD_PARTY_NOTICES.gz
      - src: ../deploy/deb/lintian-overrides/mathion
        dst: /usr/share/lintian/overrides/mathion
    scripts:
      postinstall: ../deploy/deb/postinst.sh
    deb:
      fields:
        Bugs: https://github.com/svkucheryavski/mathion/issues
```

Note: `.Version` is `0.2.0` because the workflow/tests set `GORELEASER_CURRENT_TAG=v0.2.0`. nfpm has no independent `version:` field; the `dpkg-deb -f Version` assertion in Step 1 guards it.

- [ ] **Step 5: Pre-build gzip step + dearmored keyring stub for tests**

`deb_test.sh` needs the gzipped inputs and a (throwaway) keyring present. Prepend to `deb_test.sh` (after `cd cli`):
```sh
gzip -9nkf ../deploy/man/mathion.1
gzip -9nkf ../deploy/deb/changelog.Debian
gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES
# a placeholder dearmored keyring so nfpm has a file to package (real one is prod)
[ -f ../deploy/keys/mathion-archive-keyring.gpg ] || printf 'placeholder' > ../deploy/keys/mathion-archive-keyring.gpg
```
(`gzip -9n` — `-n` drops the timestamp for reproducibility; `-k` keeps the source; `-f` overwrites.) Add `deploy/keys/mathion-archive-keyring.gpg` and the `*.gz` byproducts to `.gitignore` (they are generated). Real prod keyring/gz are produced in CI (Task 7).

- [ ] **Step 6: Run the test to verify it passes**

Run: `sh deploy/deb/deb_test.sh`
Expected: `deb_test PASSED`.

- [ ] **Step 7: shellcheck + goreleaser check**

Run: `shellcheck deploy/deb/postinst.sh deploy/deb/deb_test.sh && cd cli && goreleaser check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add cli/.goreleaser.yaml deploy/deb/postinst.sh deploy/deb/deb_test.sh .gitignore
git commit -m "$(printf 'feat(cli): build a signed-repo .deb via goreleaser nfpm\n\nnfpms: binary -> /usr/bin/mathion, version 0.2.0 (cli-v stripped, dpkg-deb\nasserted), ships keyring (ordinary data, not a conffile) + man + copyright +\nchangelog + notices + lintian override; Suggests (not Recommends) docker.io;\npostinst warns on a /usr/local/bin dual-install. deb_test.sh guards it all.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: goreleaser `signs` — sign `checksums.txt` with `S_rel`

**Files:**
- Modify: `cli/.goreleaser.yaml`
- Create: `deploy/deb/sign_test.sh`

**Interfaces:**
- Produces: `dist/checksums.txt.asc` (armored, S_rel).

- [ ] **Step 1: Write the failing test (`deploy/deb/sign_test.sh`, throwaway key)**

```sh
#!/bin/sh
set -eu
export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
cat > "$GNUPGHOME/kp" <<'P'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign,cert
Name-Real: Mathion Rel Test
Name-Email: rel@example.invalid
Expire-Date: 0
%commit
P
gpg --batch --gen-key "$GNUPGHOME/kp" >/dev/null 2>&1
FPR="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
cd "$(dirname "$0")/../../cli"
GPG_FINGERPRINT="$FPR" CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
  goreleaser release --clean --skip=publish --snapshot
test -f dist/checksums.txt.asc || { echo "FAIL: checksums.txt.asc not produced"; exit 1; }
GNUPGHOME="$GNUPGHOME" gpg --batch --verify dist/checksums.txt.asc dist/checksums.txt \
  || { echo "FAIL: .asc does not verify"; exit 1; }
echo "sign_test PASSED"
```

- [ ] **Step 2: Run to verify it fails**

Run: `sh deploy/deb/sign_test.sh`
Expected: FAIL — `checksums.txt.asc not produced` (no `signs:` yet).

- [ ] **Step 3: Add `signs:` to `cli/.goreleaser.yaml`**

Append:
```yaml
signs:
  - id: checksums
    artifacts: checksum
    signature: "${artifact}.asc"
    args:
      - "--batch"
      - "--pinentry-mode"
      - "loopback"
      - "--armor"
      - "--local-user"
      - "{{ .Env.GPG_FINGERPRINT }}"
      - "--output"
      - "${signature}"
      - "--detach-sign"
      - "${artifact}"
```

(In production CI, `GPG_FINGERPRINT` = `S_rel`'s fingerprint with a trailing `!`, and the passphrase is provided via `stdin:` — added in Task 7. For the snapshot test the throwaway key has no passphrase.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `sh deploy/deb/sign_test.sh`
Expected: `sign_test PASSED`.

- [ ] **Step 5: shellcheck + goreleaser check**

Run: `shellcheck deploy/deb/sign_test.sh && cd cli && goreleaser check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add cli/.goreleaser.yaml deploy/deb/sign_test.sh
git commit -m "$(printf 'feat(cli): sign checksums.txt with the release subkey (S_rel)\n\ngoreleaser signs: artifacts: checksum, armored \${artifact}.asc, batch/loopback,\n--local-user GPG_FINGERPRINT. sign_test.sh builds+verifies with a throwaway key.\nThis is the curl|sh + self-update authenticity anchor. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: apt repo build script + `apt-ftparchive generate` config + hermetic apt e2e

**Files:**
- Create: `deploy/apt/apt-ftparchive.conf`
- Create: `deploy/apt/build.sh`
- Create: `deploy/apt/e2e_test.sh`

**Interfaces:**
- Consumes: built `.deb`s (Task 4) + a signing key (throwaway in test, `S_apt` in CI).
- Produces: a signed apt repo tree under a given output dir; `build.sh <pool-input-dir> <repo-root> <s_apt_fpr>`.

- [ ] **Step 1: `apt-ftparchive.conf`**

```
APT::FTPArchive::DoByHash "true";

Dir { ArchiveDir "."; };
Default { Packages::Compress ". gzip"; };

TreeDefault {
  Directory "pool/$(SECTION)/";
};

Tree "dists/stable" {
  Sections "main";
  Architectures "amd64 arm64";
};
```

- [ ] **Step 2: `build.sh`**

```sh
#!/bin/sh
# build.sh <pool-input-dir with *.deb> <repo-root> <S_apt-fingerprint>
set -eu
IN="$1"; ROOT="$2"; FPR="$3"
VALID_DAYS="${MATHION_APT_VALID_DAYS:-30}"
CONF="$(cd "$(dirname "$0")" && pwd)/apt-ftparchive.conf"

mkdir -p "$ROOT/deb/pool/main/m/mathion" "$ROOT/deb/dists/stable/main/binary-amd64" \
         "$ROOT/deb/dists/stable/main/binary-arm64"
cp "$IN"/mathion_*.deb "$ROOT/deb/pool/main/m/mathion/"

cd "$ROOT/deb"
apt-ftparchive generate "$CONF"
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Mathion \
  -o APT::FTPArchive::Release::Label=Mathion \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Components=main \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Acquire-By-Hash=true \
  release dists/stable > dists/stable/Release
# freshness: stamp Valid-Until (apt-ftparchive won't reliably emit it)
{
  echo "Date: $(date -u -R)"
  echo "Valid-Until: $(date -u -R -d "+${VALID_DAYS} days")"
} >> dists/stable/Release

rm -f dists/stable/InRelease dists/stable/Release.gpg
gpg --batch --pinentry-mode loopback --local-user "${FPR}!" \
  --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --pinentry-mode loopback --local-user "${FPR}!" \
  -abs -o dists/stable/Release.gpg dists/stable/Release
echo "apt repo built at $ROOT/deb (signed by $FPR)"
```

- [ ] **Step 3: Write the failing hermetic e2e (`deploy/apt/e2e_test.sh`)**

```sh
#!/bin/sh
# Hermetic apt e2e: build+sign a repo with a THROWAWAY key, serve it, apt install.
set -eu
command -v apt-ftparchive >/dev/null 2>&1 || { echo "SKIP: apt-utils not installed"; exit 0; }
[ "$(id -u)" = 0 ] || { echo "SKIP: needs root for apt"; exit 0; }
WORK="$(mktemp -d)"; export GNUPGHOME="$WORK/gnupg"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
cat > "$GNUPGHOME/kp" <<'P'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign,cert
Name-Real: Mathion Apt Test
Name-Email: apt@example.invalid
Expire-Date: 0
%commit
P
gpg --batch --gen-key "$GNUPGHOME/kp" >/dev/null 2>&1
FPR="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
gpg --batch --export --armor "$FPR" | gpg --batch --yes --dearmor -o "$WORK/keyring.gpg"

# build the .deb (snapshot) into the pool input
( cd "$(dirname "$0")/../../cli"
  gzip -9nkf ../deploy/man/mathion.1; gzip -9nkf ../deploy/deb/changelog.Debian; gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES
  cp "$WORK/keyring.gpg" ../deploy/keys/mathion-archive-keyring.gpg
  CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
    goreleaser release --clean --skip=publish,sign --snapshot >/dev/null )
DEBS="$(cd "$(dirname "$0")/../../cli/dist" && pwd)"
sh "$(dirname "$0")/build.sh" "$DEBS" "$WORK/site" "$FPR"

# serve + configure apt
( cd "$WORK/site" && python3 -m http.server 8778 >/dev/null 2>&1 & echo $! > "$WORK/pid" )
sleep 1
install -m0644 "$WORK/keyring.gpg" /usr/share/keyrings/mathion-test.gpg
echo "deb [signed-by=/usr/share/keyrings/mathion-test.gpg] http://127.0.0.1:8778/deb stable main" \
  > /etc/apt/sources.list.d/mathion-test.list
apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/mathion-test.list \
  -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
apt-get install -y --allow-unauthenticated=false mathion
test -x /usr/bin/mathion && /usr/bin/mathion version >/dev/null

# cleanup
kill "$(cat "$WORK/pid")" 2>/dev/null || true
apt-get remove -y mathion || true
rm -f /etc/apt/sources.list.d/mathion-test.list /usr/share/keyrings/mathion-test.gpg
echo "apt e2e PASSED"
```

- [ ] **Step 4: Run the e2e**

Run: `sudo sh deploy/apt/e2e_test.sh`
Expected: `apt e2e PASSED` (or `SKIP` if not root / no apt-utils). This proves `Release` signatures, per-arch indexes, by-hash, and `signed-by` all work end-to-end.

- [ ] **Step 5: shellcheck**

Run: `shellcheck deploy/apt/build.sh deploy/apt/e2e_test.sh`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add deploy/apt/apt-ftparchive.conf deploy/apt/build.sh deploy/apt/e2e_test.sh
git commit -m "$(printf 'feat(cli): signed apt repo builder + hermetic apt e2e\n\napt-ftparchive generate (Tree{} per-arch, DoByHash) + a computed Valid-Until,\nsigned InRelease + Release.gpg by S_apt. e2e_test.sh builds+signs with a\nthrowaway key, serves over localhost, and apt installs mathion — exercising\nRelease signatures, per-arch indexes, by-hash and signed-by. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: `release-cli.yml` — `release` env, upload-artifact, `apt-publish` job

**Files:**
- Modify: `.github/workflows/release-cli.yml`

**Interfaces:**
- Consumes: `deploy/apt/build.sh` (Task 6), the nfpm/signs config (Tasks 4–5), the `release`/`pages-resign` env secrets + `PAGES_DEPLOY_TOKEN` (manual prereq).

- [ ] **Step 1: Wire GPG import + signing into the `release` job**

In the `release` job, add `environment: release`, and before the goreleaser build step, import the subkeys and enable loopback:
```yaml
      - name: Import signing subkeys
        env:
          S_REL: ${{ secrets.GPG_S_REL_PRIVATE }}
          S_APT: ${{ secrets.GPG_S_APT_PRIVATE }}
        run: |
          export GNUPGHOME="$(mktemp -d)"; echo "GNUPGHOME=$GNUPGHOME" >> "$GITHUB_ENV"
          chmod 700 "$GNUPGHOME"
          echo "allow-loopback-pinentry" > "$GNUPGHOME/gpg-agent.conf"
          gpgconf --kill gpg-agent || true
          printf '%s' "$S_REL" | gpg --batch --import
          printf '%s' "$S_APT" | gpg --batch --import
```
Set the goreleaser build step's env to pass `GPG_FINGERPRINT: ${{ vars.S_REL_FPR }}!` and add `signs.stdin`/passphrase. Since goreleaser reads the passphrase from stdin, add to the `signs` entry in `.goreleaser.yaml` (Task 5) `stdin: "{{ .Env.GPG_PASSPHRASE }}"` and pass `GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}` in the build step env.

- [ ] **Step 2: Upload the built debs + checksums as an artifact**

After `gh release create`, add:
```yaml
      - uses: actions/upload-artifact@<SHA> # v4
        with:
          name: deb-dist
          path: |
            cli/dist/mathion_*.deb
            cli/dist/checksums.txt
            cli/dist/checksums.txt.asc
          retention-days: 1
```

- [ ] **Step 3: Add the `apt-publish` job**

```yaml
  apt-publish:
    needs: [release]
    if: startsWith(github.ref, 'refs/tags/cli-v')
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
    concurrency:
      group: mathion-gh-pages
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@<SHA> # v7  (tag tree — provides deploy/apt)
      - uses: actions/checkout@<SHA> # v7
        with:
          ref: gh-pages
          path: pages
          token: ${{ secrets.PAGES_DEPLOY_TOKEN }}
      - uses: actions/download-artifact@<SHA> # v4
        with: { name: deb-dist, path: dist }
      - name: Verify debs against the signed checksums
        run: |
          export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
          gpg --batch --import deploy/keys/mathion-pubkey.asc
          gpg --batch --status-fd 1 --verify dist/checksums.txt.asc dist/checksums.txt | grep -q GOODSIG
          cd dist && for d in mathion_*.deb; do
            grep " $d\$" checksums.txt | sha256sum -c - || { echo "FAIL: $d checksum"; exit 1; }
          done
      - name: Import S_apt + build the repo
        env:
          S_APT: ${{ secrets.GPG_S_APT_PRIVATE }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        run: |
          export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
          echo "allow-loopback-pinentry" > "$GNUPGHOME/gpg-agent.conf"; gpgconf --kill gpg-agent || true
          printf '%s' "$S_APT" | gpg --batch --import
          cp deploy/keys/mathion-archive-keyring.gpg pages/deb/ 2>/dev/null || \
            gpg --batch --export | gpg --batch --yes --dearmor > pages/deb/mathion-archive-keyring.gpg
          touch pages/.nojekyll
          sh deploy/apt/build.sh "$PWD/dist" "$PWD/pages" "${{ vars.S_APT_FPR }}"
      - name: Publish to gh-pages (triggers a Pages build)
        run: |
          cd pages
          git config user.name "mathion-ci"; git config user.email "ci@example.invalid"
          git add -A && git commit -m "apt: publish ${{ github.ref_name }}" || echo "no changes"
          git push
```
Cold start: if the `gh-pages` checkout is empty, `mkdir -p pages/deb` before building; `build.sh` already `mkdir -p`s its tree. `.nojekyll` sits at `pages/` root (branch root).

- [ ] **Step 4: SHA-pin the actions in this workflow**

Replace every `@v7`/`@v6`/`@v4` in `release-cli.yml`'s signing/publish jobs with the 40-char commit SHA + `# vN` comment (look up current SHAs via the GitHub API for each action tag).

- [ ] **Step 5: Static validation**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release-cli.yml'))"
actionlint .github/workflows/release-cli.yml || true
```
Expected: valid YAML; actionlint issues addressed (or explained). (Real execution is validated by a tagged release — a deferred maintainer smoke.)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release-cli.yml
git commit -m "$(printf 'ci(cli): sign the release + publish the apt repo (release-cli.yml)\n\nrelease job: protected `release` env, import S_rel+S_apt, goreleaser signs\nchecksums with S_rel, upload debs as an artifact. New apt-publish job:\ndownload-artifact + verify debs vs signed checksums BEFORE indexing, two-checkout\n(tag script + gh-pages state), build+sign with S_apt, push via PAGES_DEPLOY_TOKEN\n(so Pages rebuilds), concurrency-guarded. SHA-pinned actions. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: `apt-resign.yml` — scheduled Valid-Until refresh

**Files:**
- Create: `.github/workflows/apt-resign.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: apt resign
on:
  schedule:
    - cron: "0 3 */10 * *"   # every ~10 days, well inside Valid-Until (30d)
  workflow_dispatch:
permissions:
  contents: read
jobs:
  resign:
    runs-on: ubuntu-latest
    environment: pages-resign
    permissions:
      contents: write
    concurrency:
      group: mathion-gh-pages
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@<SHA> # v7  (default branch — deploy/apt script)
      - uses: actions/checkout@<SHA> # v7
        with: { ref: gh-pages, path: pages, token: ${{ secrets.PAGES_DEPLOY_TOKEN }} }
      - name: Regenerate + re-sign Release (S_apt)
        env:
          S_APT: ${{ secrets.GPG_S_APT_PRIVATE }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        run: |
          if [ ! -f pages/deb/dists/stable/Release ]; then echo "no repo yet; nothing to resign"; exit 0; fi
          export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
          echo "allow-loopback-pinentry" > "$GNUPGHOME/gpg-agent.conf"; gpgconf --kill gpg-agent || true
          printf '%s' "$S_APT" | gpg --batch --import
          # build.sh regenerates Release (fresh Date/Valid-Until) over the committed pool + re-signs
          sh deploy/apt/build.sh "pages/deb/pool/main/m/mathion" "$PWD/pages" "${{ vars.S_APT_FPR }}"
      - name: Publish
        run: |
          cd pages
          git config user.name "mathion-ci"; git config user.email "ci@example.invalid"
          git add -A && git commit -m "apt: scheduled resign" || echo "no changes"
          git push
```
Note: `build.sh`'s first arg is a pool dir with `*.deb`; pointing it at the existing `pool/main/m/mathion` re-copies the debs onto themselves (idempotent) and regenerates indexes + fresh `Date`/`Valid-Until`, then re-signs — exactly the refresh semantics required. SHA-pin the actions.

- [ ] **Step 2: Static validation**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/apt-resign.yml'))"
actionlint .github/workflows/apt-resign.yml || true
```
Expected: valid; actionlint addressed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/apt-resign.yml
git commit -m "$(printf 'ci(cli): scheduled apt Release re-sign (apt-resign.yml)\n\nUnattended pages-resign env (S_apt only, main-scoped); two-checkout like\napt-publish; regenerates Release (fresh Date/Valid-Until over the committed\npool) and re-signs so Valid-Until never lapses. Same concurrency group. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 9: Wire hermetic e2e into `ci.yml` (PR gate) + `amd64-smoke` `.deb` leg + SHA-pin

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/amd64-smoke.yml`

- [ ] **Step 1: Add the hermetic apt e2e as a CI job**

Add to `ci.yml` (secretless — throwaway key):
```yaml
  apt-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<SHA> # v7
      - uses: actions/setup-go@<SHA> # v7
        with: { go-version: "1.24" }
      - uses: goreleaser/goreleaser-action@<SHA> # v6
        with: { version: "~> v2", install-only: true }
      - name: Install apt-utils
        run: sudo apt-get update && sudo apt-get install -y apt-utils
      - name: Hermetic apt e2e (throwaway key)
        run: sudo -E $(command -v sh) deploy/apt/e2e_test.sh
```

- [ ] **Step 2: Add a local-`.deb` leg + dual-install assertion to `amd64-smoke.yml`**

Add a step (after CLI install) that builds+installs the `.deb` locally and asserts the postinst dual-install warning fires when `/usr/local/bin/mathion` exists:
```yaml
      - name: Local .deb install + dual-install warning
        run: |
          set -euo pipefail
          ( cd cli && gzip -9nkf ../deploy/man/mathion.1 && gzip -9nkf ../deploy/deb/changelog.Debian \
            && gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES \
            && printf placeholder > ../deploy/keys/mathion-archive-keyring.gpg \
            && CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
               goreleaser release --clean --skip=publish,sign --snapshot )
          out="$(sudo apt-get install -y ./cli/dist/mathion_0.2.0_amd64.deb 2>&1)"
          echo "$out" | grep -q "will shadow this apt package" \
            || { echo "FAIL: postinst dual-install warning missing"; exit 1; }
          test -x /usr/bin/mathion
          sudo apt-get remove -y mathion
```

- [ ] **Step 3: SHA-pin remaining actions**

Ensure every action reference in `ci.yml` and `amd64-smoke.yml` touched here is SHA-pinned with a `# vN` comment.

- [ ] **Step 4: Static validation**

Run:
```bash
for f in .github/workflows/ci.yml .github/workflows/amd64-smoke.yml; do
  python3 -c "import yaml,sys; yaml.safe_load(open('$f'))"; done
actionlint .github/workflows/ci.yml .github/workflows/amd64-smoke.yml || true
```
Expected: valid; actionlint addressed. (The `apt-e2e` job actually runs on PR — it must go green.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/amd64-smoke.yml
git commit -m "$(printf 'ci: hermetic apt e2e PR gate + amd64-smoke .deb leg\n\nci.yml gains a secretless apt-e2e job (throwaway key, real apt install). amd64\nsmoke gains a local .deb install leg asserting the postinst dual-install\nwarning. SHA-pin the touched actions. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 10: README apt documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an "Install via apt" section**

Document the cold-start bootstrap (per spec §7.3): install the keyring to `/usr/share/keyrings/mathion-archive-keyring.gpg`, add the `signed-by` source, `apt update && apt install mathion`; publish the key **fingerprint** for out-of-band verification (note the bootstrap is trust-on-first-use); and the **PATH precedence / one-channel-only** guidance (apt `/usr/bin` vs curl|sh `/usr/local/bin`, `/usr/local/bin` wins). Cross-reference `deploy/keys/README.md`.

- [ ] **Step 2: Verify the doc block**

Run: `grep -q "signed-by=/usr/share/keyrings/mathion-archive-keyring.gpg" README.md && grep -qi "one channel" README.md && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(printf 'docs: apt install instructions + PATH-precedence guidance\n\nkeyring -> signed-by source -> apt install mathion; fingerprint for out-of-band\nverification (bootstrap is TOFU); use apt OR curl|sh, not both. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-review (author checklist)

**Spec coverage (§2.1 4a scope):** §5 .deb → T3/T4; §6 signing/key lifecycle → T5 (S_rel), T7 (import), T3 (keys doc), manual prereqs; §7 apt repo → T6; §8 install.sh authenticity → T2; §10 dual-install → T1 (version), T2 (install.sh), T4 (postinst); §11 CI → T7/T8/T9; §12 tests → T2/T4/T5/T6/T9; §13 docs → T3/T10; §14 prereqs → Manual section. `version --short` correctly deferred to 4b. Covered.

**Placeholder scan:** the only intentional placeholders are the **real GPG key material** (`deploy/keys/mathion-pubkey.asc`, install.sh embedded block, `EXPECTED_PRIMARY_FPR`, `${{ vars.S_REL_FPR }}`/`S_APT_FPR`) and the **action SHAs** — all explicitly maintainer/lookup-filled and marked. Tests use throwaway keys. No logic placeholders.

**Type/name consistency:** `binExists`/`lookPath`/`maybeWarnDualInstall`/`aptBinPath`/`curlBinPath` (T1) consistent. `build.sh <in> <root> <fpr>` signature consistent across T6/T7/T8. `GPG_FINGERPRINT` env (T5) ↔ `S_REL_FPR` (T7). Keyring path `/usr/share/keyrings/mathion-archive-keyring.gpg` consistent (T4/T6/T7/T10). Concurrency group `mathion-gh-pages` identical in T7/T8.

**Known execution notes for the implementer:** tasks needing `apt-utils`/root (T6 e2e, T9 amd64 leg) SKIP gracefully off-CI; the tag-triggered signing/publish (T7) and scheduled resign (T8) are static-validated here and only run for real once the manual prereqs exist — that real run is the deferred maintainer smoke, not a task gate.
