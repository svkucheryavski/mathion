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
- **Two signing subkeys under one offline primary, channel separation ENFORCED on the verify side:** `S_rel` signs `checksums.txt` (curl|sh + 4b self-update); `S_apt` signs the apt `Release`. Each verifier trusts **only its channel's subkey** — no verifier carries both. Signing is non-interactive: `--batch --pinentry-mode loopback --local-user <fpr>! --digest-algo SHA256 --cert-digest-algo SHA256`, passphrase fed explicitly on **fd 0** — goreleaser `signs.stdin` supplies the bytes but gpg only consumes them with `--passphrase-fd 0` in `signs.args` (loopback alone reads nothing → a protected key fails cold); `build.sh`/`resign.sh` pipe it to `--passphrase-fd 0` too. goreleaser `signs:` MUST set `artifacts: checksum`, `${artifact}.asc`, `--armor`.
- **Verification (install.sh):** `--status-fd 1`; accept only `GOODSIG` + a `VALIDSIG` whose **signing (first) fingerprint** is `EXPECTED_SIGNING_FPR` (the `S_rel` subkey — so a compromise of the unattended `S_apt` cannot forge the curl|sh channel), with **no** `EXPKEYSIG`/`REVKEYSIG`/`EXPSIG`/`ERRSIG`/`BADSIG`; require **exactly one** matching checksum line; fail closed if `gnupg` absent. The install.sh verify logic lives in a sourceable `verify_sig` function driven directly by the test (not re-implemented).
- **Two trimmed public keyrings (never one full key everywhere):** `deploy/keys/mathion-pubkey.asc` = **primary + `S_rel`** (embedded verbatim in install.sh + the 4b binary; verifies `checksums.txt`). `deploy/keys/mathion-apt-keyring.asc` → dearmored to `/usr/share/keyrings/mathion-archive-keyring.gpg` = **primary + `S_apt`** (packaged in the `.deb` + published to Pages; `apt`'s `signed-by=<keyring>` then enforces `S_apt`). On rotation, each keyring carries the outgoing **and** incoming subkey of its own channel during the overlap window.
- **CI:** signing secrets only in protected environments — `release` (holds `S_rel`+`S_apt`, deploy restricted to `cli-v*` tags) and `pages-resign` (holds only `S_apt`, deploy restricted to `main`, unattended). SHA-pin all actions in signing/publish jobs. Cross-job artifacts via `upload/download-artifact` (never re-download from Releases). gh-pages publication is concurrency-guarded and must trigger a Pages rebuild (a `GITHUB_TOKEN` push does NOT).
- **Tests use throwaway keys only** — never the production key.

---

## Manual prerequisites (maintainer — NOT agent tasks)

These cannot be done by an implementer subagent; document them in `deploy/keys/README.md` (Task 3) and the README (Task 10), and treat their absence as "the real-key release path is validated later by a tagged release."

1. **Key generation (offline):** create an offline **primary** key (Ed25519 or RSA ≥ 3072) and two signing **subkeys** `S_rel` and `S_apt` (set an expiry, e.g. 2 years), and a revocation certificate stored offline. Export **two trimmed public keyrings** (channel separation — never one full key with both subkeys):
   - `deploy/keys/mathion-pubkey.asc` = **primary + `S_rel` only** (`gpg --export --armor <primary>! <S_rel>!` minus S_apt, or export then strip the S_apt subkey). Paste this ASCII-armored block into `install.sh`'s embedded `mathion_embedded_key` here-doc and into the 4b binary embed.
   - `deploy/keys/mathion-apt-keyring.asc` = **primary + `S_apt` only**. Its dearmored form (`gpg --dearmor`) becomes `/usr/share/keyrings/mathion-archive-keyring.gpg` — CI derives it deterministically from this committed file (Task 7), so it is identical in the `.deb` and on Pages.

   Record `EXPECTED_PRIMARY_FPR` (40-hex primary fingerprint), `EXPECTED_SIGNING_FPR` (the `S_rel` **subkey** fingerprint — install.sh pins this as a **single scalar**), and the `S_apt` subkey fingerprint. On rotation, add the incoming subkey to its own channel's keyring while the outgoing one still signs (overlap). `install.sh` is fetched fresh on every install, so it pins **one** current `S_rel` fingerprint: to rotate, update `EXPECTED_SIGNING_FPR` to the new subkey and re-sign the latest `checksums.txt` with it **in the same release** — the freshly-fetched `install.sh` and the freshly-signed `checksums.txt` are always the same repo state (a brief CDN-cache skew fails closed → the user retries). The dual-accept **overlap** applies only to **4b's compile-time-embedded** binary key (an old binary can't refetch install.sh), not to install.sh — so `EXPECTED_SIGNING_FPR` stays a scalar here.
2. **GitHub environments + secrets + variables:** create environment **`release`** (deployment rule = **branches AND tags**, tag pattern `cli-v*`) with secrets `GPG_S_REL_PRIVATE`, `GPG_S_APT_PRIVATE`, `GPG_PASSPHRASE`; create environment **`pages-resign`** (deployment branch = `main`, no required reviewers, wait-timer 0) with secrets `GPG_S_APT_PRIVATE`, `GPG_PASSPHRASE`. Also create environment/repo **variables** `S_REL_FPR` (the `S_rel` subkey fingerprint) and `S_APT_FPR` (the `S_apt` subkey fingerprint) — the signing/publish jobs read these via `${{ vars.* }}`.
3. **Pages deploy token:** create a fine-grained PAT or GitHub App installation token with `contents:write` (and `pages:write` if using the build API) on this repo; store as `PAGES_DEPLOY_TOKEN` in both environments. (A default `GITHUB_TOKEN` push to `gh-pages` does not trigger a Pages build.)
4. **Pages + branch:** create an empty `gh-pages` branch; enable **GitHub Pages** with source = `gh-pages` branch, root.
5. **Tag protection:** protect `cli-v*` tags.
6. **Operational (scheduled resign):** GitHub auto-disables `schedule:` workflows after **60 days of repo inactivity**. During a long quiet stretch the resign stops and the apt `Valid-Until` (30 d) lapses. Either keep the repo active, add a freshness monitor/alert, or periodically re-enable the workflow. Note this alongside setup.

Until (1)–(6) exist, the tag-triggered signing/publish jobs will not run to green — that is expected. All agent tasks below are validated with throwaway keys.

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
- Produces (in `install.sh`): a sourceable `verify_sig <sig> <signed>` function and a `mathion_embedded_key` here-doc function (both test-overridable); `EXPECTED_PRIMARY_FPR` + `EXPECTED_SIGNING_FPR` (the S_rel subkey) constants; a `main()` wrapper + `MATHION_INSTALL_LIB` sourcing guard; a greatest-stable `cli-vX.Y.Z` tag resolver.

- [ ] **Step 1: Write the failing test (signature verify + resolver, throwaway key)**

Append to `deploy/install_sh_test.sh` (before the final `echo "install_sh_test PASSED"`). This is a **behavioral** test: it generates a throwaway primary + two signing subkeys, **sources install.sh as a library**, points its `mathion_embedded_key`/`EXPECTED_*` at the throwaway key, and drives install.sh's **real** `verify_sig` through good / tampered / wrong-channel / **expired** / **revoked** / gpg-absent — plus the resolver. (Assumes the file's `set -eu`; the negative cases are guarded by `if`. The expired case uses a separate `--faked-system-time` key so it needs no `sleep`.)

```sh
# ---- authenticity: drive install.sh's REAL verify_sig with a throwaway key ----
command -v gpg >/dev/null 2>&1 || { echo "SKIP: gpg not present"; exit 0; }
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TKH="$(mktemp -d)"; export GNUPGHOME="$TKH"; chmod 700 "$TKH"
# throwaway: primary (cert-only) + sub_rel (the pinned channel); sub_apt added below.
cat > "$TKH/kp" <<'PARAMS'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Test Primary
Name-Email: test@example.invalid
Expire-Date: 0
%commit
PARAMS
gpg --batch --gen-key "$TKH/kp" >/dev/null 2>&1
PRIMARY="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
# sub_apt (wrong channel) — quick-add-key needs loopback+empty-passphrase to run non-interactively
gpg --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$PRIMARY" ed25519 sign 0 >/dev/null 2>&1
SUBS="$(gpg --batch --with-colons --fingerprint "$PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; s=0}')"
SUB_REL="$(printf '%s\n' "$SUBS" | sed -n 1p)"
SUB_APT="$(printf '%s\n' "$SUBS" | sed -n 2p)"
printf 'checksum-content\n' > "$TKH/checksums.txt"
sign_with() { gpg --batch --yes --armor --local-user "${1}!" --detach-sign -o "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; }

# Source install.sh (guard stops main), then aim its embedded key + pins at the throwaway.
MATHION_INSTALL_LIB=1 . "$ROOT_DIR/deploy/install.sh"
mathion_embedded_key() { gpg --batch --export --armor "$PRIMARY"; }
EXPECTED_SIGNING_FPR="$SUB_REL"; EXPECTED_PRIMARY_FPR="$PRIMARY"

# 1) good signature from the pinned subkey -> accepted
sign_with "$SUB_REL"
verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt" || { echo "FAIL: good S_rel signature rejected"; exit 1; }
# 2) tampered signed file -> rejected
printf 'tampered\n' >> "$TKH/checksums.txt"
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: tampered file accepted"; exit 1; fi
printf 'checksum-content\n' > "$TKH/checksums.txt"
# 3) signed by the OTHER subkey (simulates an S_apt-signed forge) -> rejected (channel separation)
sign_with "$SUB_APT"
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: wrong-channel (S_apt) signature accepted"; exit 1; fi
# 4) EXPIRED pinned key -> rejected (EXPKEYSIG, no GOODSIG). A single pinned subkey can't
#    be both valid (cases 1-3) and expired, so build a SEPARATE throwaway whose primary +
#    sub_rel were created in the PAST with a short expiry, sign while it was valid (faked
#    past time), then verify NOW (expired). Re-point the embedded key + pins at it, then restore.
EXH="$(mktemp -d)"; PAST=20200101T000000
cat > "$EXH/kp" <<'EP'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Name-Real: Mathion Expired Test
Name-Email: exp@example.invalid
Expire-Date: 0
%commit
EP
GNUPGHOME="$EXH" gpg --faked-system-time "$PAST" --batch --gen-key "$EXH/kp" >/dev/null 2>&1
EXP_PRIMARY="$(GNUPGHOME="$EXH" gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
GNUPGHOME="$EXH" gpg --faked-system-time "$PAST" --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$EXP_PRIMARY" ed25519 sign 2d >/dev/null 2>&1
EXP_SUB="$(GNUPGHOME="$EXH" gpg --batch --with-colons --fingerprint "$EXP_PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; exit}')"
GNUPGHOME="$EXH" gpg --faked-system-time "$PAST" --batch --yes --armor --local-user "${EXP_SUB}!" --detach-sign -o "$TKH/checksums.txt.asc" "$TKH/checksums.txt" >/dev/null 2>&1
mathion_embedded_key() { GNUPGHOME="$EXH" gpg --batch --export --armor "$EXP_PRIMARY"; }
EXPECTED_SIGNING_FPR="$EXP_SUB"; EXPECTED_PRIMARY_FPR="$EXP_PRIMARY"
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: expired-key signature accepted"; exit 1; fi
# restore the main throwaway key + pins for the remaining cases
mathion_embedded_key() { gpg --batch --export --armor "$PRIMARY"; }
EXPECTED_SIGNING_FPR="$SUB_REL"; EXPECTED_PRIMARY_FPR="$PRIMARY"
# 5) revoked key -> rejected. gpg auto-writes a revocation cert at key gen, but
#    colon-guards its armor ("Remove this colon before importing") — strip it.
sign_with "$SUB_REL"
sed 's/^://' "$TKH/openpgp-revocs.d/${PRIMARY}.rev" | gpg --batch --yes --import >/dev/null 2>&1
if verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt"; then echo "FAIL: revoked-key signature accepted"; exit 1; fi
# 6) gpg absent -> fail closed. SC2123: emptying PATH is the deliberate mechanism to
#    simulate "no gpg on PATH" inside the subshell — not an accidental clobber.
# shellcheck disable=SC2123
if ( PATH=""; verify_sig "$TKH/checksums.txt.asc" "$TKH/checksums.txt" ) 2>/dev/null; then
  echo "FAIL: verify_sig did not fail closed without gpg"; exit 1; fi

# ---- greatest-stable resolver (mirrors install.sh) ----
resolve_latest() { printf '%s\n' "$1" | grep -E '^cli-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1; }
TAGS="$(printf '%s\n' cli-v0.2.0 cli-v0.10.0 cli-v0.2.0-rc1 cli-v0.9.0 v0.2.0)"
got="$(resolve_latest "$TAGS")"
[ "$got" = "cli-v0.10.0" ] || { echo "FAIL: resolver picked '$got', want cli-v0.10.0"; exit 1; }
echo "install_sh authenticity+resolver PASSED"
```

- [ ] **Step 2: Run to verify it fails**

Run: `sh deploy/install_sh_test.sh`
Expected: FAIL — install.sh has no `verify_sig` and no `MATHION_INSTALL_LIB` guard yet, so sourcing it either runs `main` (hits the network / errors) or the `verify_sig` call reports `not found`. This is a real red state; it goes green once Step 3 lands. (SKIPs only if `gpg` is entirely absent.)

- [ ] **Step 3: Rewrite `install.sh` (sourceable `verify_sig` + `main()` + guard)**

Replace `deploy/install.sh` in full. The verify logic + embedded key move into functions so the test drives the real code; `main()` reorders to **fetch + verify the signed checksums before downloading the archive**; the resolver picks the greatest stable tag; the pin is the **S_rel subkey** (`EXPECTED_SIGNING_FPR`, VALIDSIG's first field) plus a belt-and-suspenders primary check; the sourcing guard lets tests load without running.

```sh
#!/bin/sh
# Mathion CLI installer. Resolves the greatest stable cli-v* release (or an
# explicit version arg), verifies the release SIGNATURE (checksums.txt.asc)
# against the embedded Mathion release key (S_rel), then the checksum, and
# installs to /usr/local/bin/mathion.
set -eu

REPO="svkucheryavski/mathion"
API="https://api.github.com/repos/${REPO}/releases"
DL="https://github.com/${REPO}/releases/download"
DEST="/usr/local/bin/mathion"

# Authenticity (Slice 4a). EXPECTED_SIGNING_FPR pins the S_rel SUBKEY (VALIDSIG's
# first field), so a compromise of the apt-only S_apt cannot forge this channel.
EXPECTED_PRIMARY_FPR="REPLACE_WITH_40_HEX_PRIMARY_FINGERPRINT"
EXPECTED_SIGNING_FPR="REPLACE_WITH_40_HEX_S_REL_SUBKEY_FINGERPRINT"

# HTTPS-only, even across redirects — a redirect can never downgrade to http.
dl() { curl -fsSL --proto '=https' --proto-redir '=https' "$@"; }

# Embedded public key = primary + S_rel ONLY (channel separation). Filled by the
# manual key prereq from deploy/keys/mathion-pubkey.asc. Tests override this.
mathion_embedded_key() {
  cat <<'MATHION_PUBKEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----
REPLACE_WITH_deploy/keys/mathion-pubkey.asc_CONTENTS
-----END PGP PUBLIC KEY BLOCK-----
MATHION_PUBKEY
}

# verify_sig <detached-sig> <signed-file>: 0 iff a GOODSIG made by
# EXPECTED_SIGNING_FPR (primary = EXPECTED_PRIMARY_FPR), no expired/revoked/bad
# status. Fails closed if gpg is absent. Fresh throwaway GNUPGHOME per call.
verify_sig() {
  command -v gpg >/dev/null 2>&1 || { echo "gnupg is required to verify the release signature; install it and retry" >&2; return 1; }
  _vh="$(mktemp -d)"; chmod 700 "$_vh"
  mathion_embedded_key > "${_vh}/key.asc"
  if ! GNUPGHOME="$_vh" gpg --batch --no-tty --import "${_vh}/key.asc" >/dev/null 2>&1; then
    rm -rf "$_vh"; echo "failed to import the embedded signing key" >&2; return 1
  fi
  _st="$(GNUPGHOME="$_vh" gpg --batch --no-tty --status-fd 1 --verify "$1" "$2" 2>/dev/null)"
  rm -rf "$_vh"
  printf '%s\n' "$_st" | grep -q '^\[GNUPG:\] GOODSIG' || { echo "signature verification FAILED (no GOODSIG)" >&2; return 1; }
  if printf '%s\n' "$_st" | grep -Eq '^\[GNUPG:\] (EXPKEYSIG|REVKEYSIG|EXPSIG|ERRSIG|BADSIG)'; then
    echo "signature verification FAILED (expired/revoked/bad key)" >&2; return 1
  fi
  printf '%s\n' "$_st" | grep -q "^\[GNUPG:\] VALIDSIG ${EXPECTED_SIGNING_FPR} " || { echo "signature is not from the expected Mathion release key" >&2; return 1; }
  printf '%s\n' "$_st" | grep -q "^\[GNUPG:\] VALIDSIG .* ${EXPECTED_PRIMARY_FPR}\$" || { echo "signature primary key mismatch" >&2; return 1; }
  return 0
}

main() {
  arch="$(uname -m)"
  case "$arch" in
    x86_64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
  esac
  ASSET="mathion_linux_${ARCH}.tar.gz"

  # dual-install warning: an apt-managed copy at /usr/bin is shadowed by this
  # curl|sh install to /usr/local/bin (PATH precedence). Warn, never delete.
  if command -v dpkg >/dev/null 2>&1 && LC_ALL=C dpkg -S /usr/bin/mathion >/dev/null 2>&1; then
    echo "warning: an apt-managed mathion exists at /usr/bin/mathion; this curl|sh install to" >&2
    echo "         ${DEST} will shadow it on PATH. Use one channel only (see README)." >&2
  fi

  TAG="${1:-}"
  if [ -z "$TAG" ]; then
    all=""
    page=1
    while [ "$page" -le 10 ]; do
      body="$(dl "${API}?per_page=100&page=${page}")" || break
      { [ -z "$body" ] || [ "$body" = "[]" ]; } && break
      all="${all}
$(printf '%s' "$body" | grep -oE '"tag_name": *"cli-v[^"]*"' | sed -E 's/.*"(cli-v[^"]*)".*/\1/')"
      page=$((page + 1))
    done
    # greatest STABLE cli-vX.Y.Z (skip prereleases); sort -V exists on Debian/Ubuntu
    TAG="$(printf '%s\n' "$all" | grep -E '^cli-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
  fi
  [ -n "$TAG" ] || { echo "no stable cli-v* release found" >&2; exit 1; }

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  # Fetch + verify the SIGNED checksums BEFORE the (large) archive, so an
  # untrusted origin can't make us download an unauthenticated blob first.
  echo "==> Fetching release checksums for ${TAG}"
  dl "${DL}/${TAG}/checksums.txt"     -o "${TMP}/checksums.txt"
  dl "${DL}/${TAG}/checksums.txt.asc" -o "${TMP}/checksums.txt.asc"
  echo "==> Verifying signature"
  verify_sig "${TMP}/checksums.txt.asc" "${TMP}/checksums.txt" || exit 1
  echo "==> Signature OK"

  # exactly one checksum line for our asset, from the now-trusted checksums.txt
  matches="$(grep -c " ${ASSET}\$" "${TMP}/checksums.txt" || true)"
  [ "$matches" = "1" ] || { echo "expected exactly one checksum line for ${ASSET} (got ${matches})" >&2; exit 1; }
  want="$(grep " ${ASSET}\$" "${TMP}/checksums.txt" | awk '{print $1}')"

  echo "==> Downloading ${ASSET}"
  dl "${DL}/${TAG}/${ASSET}" -o "${TMP}/${ASSET}"
  echo "==> Verifying checksum"
  got="$(cd "$TMP" && sha256sum "$ASSET" | awk '{print $1}')"
  [ "$want" = "$got" ] || { echo "checksum verification FAILED for ${ASSET}" >&2; exit 1; }

  echo "==> Installing to ${DEST}"
  tar -xzf "${TMP}/${ASSET}" -C "$TMP" mathion
  install -m 0755 "${TMP}/mathion" "$DEST"
  echo "==> Installed: $(${DEST} version 2>/dev/null | head -1 || echo mathion)"
}

# Sourcing guard: tests set MATHION_INSTALL_LIB=1 to load functions without running.
[ "${MATHION_INSTALL_LIB:-0}" = 1 ] || main "$@"
```

Then future-proof `install_sh_test.sh`'s own build step: change its goreleaser line from `--skip=publish --snapshot` to `--skip=publish,sign,nfpm --snapshot`. Once Task 4 adds `nfpms:` and Task 5 adds `signs:`, an un-skipped snapshot build would try to package the (prod-only) keyring/gz inputs and sign with no key. Skipping not-yet-configured phases now is a harmless no-op that keeps this test green across Tasks 4–5.

- [ ] **Step 4: Run the shell test + shellcheck**

Run: `sh deploy/install_sh_test.sh && shellcheck deploy/install.sh deploy/install_sh_test.sh`
Expected: PASS; shellcheck clean (add `# shellcheck disable=` only with a written reason).

- [ ] **Step 5: Secondary contract guards (the behavioral test in Step 1 is the primary gate)**

Run:
```bash
grep -q 'GOODSIG' deploy/install.sh && grep -q 'EXPKEYSIG|REVKEYSIG' deploy/install.sh \
  && grep -q 'EXPECTED_SIGNING_FPR' deploy/install.sh && grep -q 'verify_sig' deploy/install.sh \
  && grep -q 'MATHION_INSTALL_LIB' deploy/install.sh && grep -q 'sort -V' deploy/install.sh \
  && echo OK
```
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add deploy/install.sh deploy/install_sh_test.sh
git commit -m "$(printf 'feat(cli): install.sh verifies the release signature (S_rel) + greatest-stable resolver\n\nSourceable verify_sig pins the S_rel SUBKEY (VALIDSIG first field) so an S_apt\ncompromise cannot forge the curl|sh channel; reject EXP/REVKEYSIG, exactly-one\nchecksum line, verify BEFORE downloading the archive, dual-install warning, and\npick the greatest STABLE cli-vX.Y.Z. A behavioral test sources install.sh and\ndrives the real verify_sig (good/tampered/wrong-channel/revoked/gpg-absent).\nEmbedded key (primary+S_rel) filled by the manual key prereq. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
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
- Create: `deploy/keys/mathion-pubkey.asc` (placeholder; primary + S_rel — for install.sh/4b binary)
- Create: `deploy/keys/mathion-apt-keyring.asc` (placeholder; primary + S_apt — dearmored to the apt keyring)

**Interfaces:**
- Produces: the on-disk paths nfpm packages in Task 4; `deploy/keys/mathion-pubkey.asc` (primary+S_rel) embedded by install.sh (Task 2) + the 4b binary; `deploy/keys/mathion-apt-keyring.asc` (primary+S_apt) dearmored by CI (Task 7) into the packaged/Pages keyring.

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

- [ ] **Step 4: Generate third-party notices (verbatim license texts from the module cache)**

Concatenate each direct dependency's verbatim license text — deterministic and offline (no network, no phantom template):
```bash
cd cli
: > ../deploy/deb/THIRD_PARTY_NOTICES
for m in github.com/spf13/cobra github.com/inconshreveable/mousetrap github.com/spf13/pflag; do
  d="$(go list -m -f '{{.Dir}}' "$m")" || { echo "FAIL: $m not a known module"; exit 1; }
  printf '\n===== %s =====\n\n' "$m" >> ../deploy/deb/THIRD_PARTY_NOTICES
  cat "$d"/LICENSE* >> ../deploy/deb/THIRD_PARTY_NOTICES
done
test -s ../deploy/deb/THIRD_PARTY_NOTICES
```
(cobra + mousetrap: Apache-2.0; pflag: BSD-3-Clause — matching `deploy/deb/copyright`. `go list -m` resolves them from `go.mod`'s transitive set.)

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

- [ ] **Step 6: two trimmed keyring placeholders + `deploy/keys/README.md`**

`deploy/keys/mathion-pubkey.asc` (primary + S_rel — install.sh / 4b binary):
```
-----BEGIN PGP PUBLIC KEY BLOCK-----
PLACEHOLDER — replaced by the manual key prereq with the primary + S_rel subkey
public key ONLY (no S_apt — channel separation). See deploy/keys/README.md.
-----END PGP PUBLIC KEY BLOCK-----
```

`deploy/keys/mathion-apt-keyring.asc` (primary + S_apt — dearmored to the apt keyring):
```
-----BEGIN PGP PUBLIC KEY BLOCK-----
PLACEHOLDER — replaced by the manual key prereq with the primary + S_apt subkey
public key ONLY. CI dearmors this to /usr/share/keyrings/mathion-archive-keyring.gpg.
-----END PGP PUBLIC KEY BLOCK-----
```

`deploy/keys/README.md`: document (per spec §6.1, §14) — generating the offline primary (cert-only) + `S_rel`/`S_apt` signing subkeys with expiry; **channel separation** — export **two trimmed keyrings**: `mathion-pubkey.asc` = primary+`S_rel` (embedded in install.sh + the 4b binary; verifies `checksums.txt`), and `mathion-apt-keyring.asc` = primary+`S_apt` (dearmored by CI to the apt keyring so `signed-by` enforces `S_apt`); recording `EXPECTED_PRIMARY_FPR` + `EXPECTED_SIGNING_FPR` (the S_rel subkey install.sh pins) + the S_apt fpr; storing the revocation cert offline; the **per-channel rotation** procedure (issue a new subkey from the offline primary during an overlap grace window in which the outgoing subkey still signs; ship the refreshed **channel-specific** keyring in the next release/`.deb`; `install.sh` is always fetched fresh so it pins the **current** `S_rel` scalar — update `EXPECTED_SIGNING_FPR` and re-sign the latest `checksums.txt` together; the dual-accept overlap is a **4b** compile-time-embedded-key concern, not install.sh); the compromise/revocation procedure; and the out-of-band fingerprint publication.

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
git add LICENSE deploy/man/mathion.1 deploy/deb/copyright deploy/deb/changelog.Debian deploy/deb/lintian-overrides/mathion deploy/deb/THIRD_PARTY_NOTICES deploy/keys/README.md deploy/keys/mathion-pubkey.asc deploy/keys/mathion-apt-keyring.asc
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

Note: `.Version` is `0.2.0` because the workflow/tests set `GORELEASER_CURRENT_TAG=v0.2.0`. nfpm has no independent `version:` field; the `dpkg-deb -f Version` assertion in Step 1 guards it. The packaged `mathion-archive-keyring.gpg` is the **apt-channel** keyring (primary + `S_apt` only) — in prod CI dearmors it from the committed `deploy/keys/mathion-apt-keyring.asc` (Task 7); tests use a placeholder (Step 5).

- [ ] **Step 5: Pre-build gzip step + dearmored keyring stub for tests**

`deb_test.sh` needs the gzipped inputs and a (throwaway) keyring present. Prepend to `deb_test.sh` (after `cd cli`):
```sh
gzip -9nkf ../deploy/man/mathion.1
gzip -9nkf ../deploy/deb/changelog.Debian
gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES
# a placeholder dearmored keyring so nfpm has a file to package (real one is prod)
[ -f ../deploy/keys/mathion-archive-keyring.gpg ] || printf 'placeholder' > ../deploy/keys/mathion-archive-keyring.gpg
```
(`gzip -9n` — `-n` drops the timestamp for reproducibility; `-k` keeps the source; `-f` overwrites.) Add these **named** generated paths to `.gitignore` (never a bare `*.gz`, which would swallow unrelated files):
```
deploy/keys/mathion-archive-keyring.gpg
deploy/man/mathion.1.gz
deploy/deb/changelog.Debian.gz
deploy/deb/THIRD_PARTY_NOTICES.gz
```
Real prod keyring/gz are produced in CI (Task 7).

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
GH="$(mktemp -d)"; export GNUPGHOME="$GH"; chmod 700 "$GH"   # split form: `export X="$(cmd)"` trips shellcheck SC2155
# primary (cert-only) + signing subkey, mirroring the prod S_rel layout. PROTECTED
# with a real passphrase so the sign exercises the prod fd-0 passphrase path — an
# unprotected key would sign regardless of --passphrase-fd and mask a broken config.
PASS="s3cr3t-test-pass"
cat > "$GH/kp" <<P
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Rel Test
Name-Email: rel@example.invalid
Expire-Date: 0
Passphrase: ${PASS}
%commit
P
gpg --batch --gen-key "$GH/kp" >/dev/null 2>&1
PRIMARY="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
SUBKEY="$(gpg --batch --with-colons --fingerprint "$PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; exit}')"
cd "$(dirname "$0")/../../cli"
# mirror prod exactly: --local-user <subkey>! + the passphrase fed via signs.stdin ->
# gpg's --passphrase-fd 0 (both configured in .goreleaser.yaml, Step 3). skip nfpm
# (this test only needs checksums signing; nfpm inputs are prod-only).
GPG_FINGERPRINT="${SUBKEY}!" GPG_PASSPHRASE="$PASS" \
  CLI_TAG=cli-v0.2.0 APP_IMAGE=v0.2.0 GORELEASER_CURRENT_TAG=v0.2.0 \
  goreleaser release --clean --skip=publish,nfpm --snapshot
test -f dist/checksums.txt.asc || { echo "FAIL: checksums.txt.asc not produced"; exit 1; }
GNUPGHOME="$GNUPGHOME" gpg --batch --verify dist/checksums.txt.asc dist/checksums.txt \
  || { echo "FAIL: .asc does not verify"; exit 1; }
# assert the SUBKEY (not the primary) made the signature — exercises `!` selection
GNUPGHOME="$GNUPGHOME" gpg --batch --status-fd 1 --verify dist/checksums.txt.asc dist/checksums.txt 2>/dev/null \
  | grep -q "^\[GNUPG:\] VALIDSIG ${SUBKEY} " || { echo "FAIL: not signed by the subkey"; exit 1; }
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
    stdin: "{{ .Env.GPG_PASSPHRASE }}"
    args:
      - "--batch"
      - "--pinentry-mode"
      - "loopback"
      - "--passphrase-fd"
      - "0"
      - "--armor"
      - "--digest-algo"
      - "SHA256"
      - "--local-user"
      - "{{ .Env.GPG_FINGERPRINT }}"
      - "--output"
      - "${signature}"
      - "--detach-sign"
      - "${artifact}"
```

(`--digest-algo SHA256` pins the hash so nothing falls back to SHA-1 on an old gpg — spec §6.1. **`stdin` + `--passphrase-fd 0` together are load-bearing:** goreleaser's `stdin` writes `GPG_PASSPHRASE` to gpg's standard input, but `--pinentry-mode loopback` alone reads nothing — gpg only consumes the passphrase when `--passphrase-fd 0` points it at fd 0. Verified against a real protected key with a cold gpg-agent: without `--passphrase-fd 0` the sign fails; with it, it succeeds. In production CI `GPG_FINGERPRINT` = `S_rel`'s subkey fingerprint with a trailing `!` and `GPG_PASSPHRASE` = the real secret (Task 7); the throwaway test protects its key with `PASS` and sets `GPG_PASSPHRASE="$PASS"`, so the fd-0 path is genuinely exercised — an unprotected key would sign regardless and hide a broken config.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `sh deploy/deb/sign_test.sh`
Expected: `sign_test PASSED`.

- [ ] **Step 5: shellcheck + goreleaser check**

Run: `shellcheck deploy/deb/sign_test.sh && cd cli && goreleaser check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add cli/.goreleaser.yaml deploy/deb/sign_test.sh
git commit -m "$(printf 'feat(cli): sign checksums.txt with the release subkey (S_rel)\n\ngoreleaser signs: artifacts: checksum, armored \${artifact}.asc, batch/loopback,\nstdin + --passphrase-fd 0 (both needed to feed a protected key), --local-user\nGPG_FINGERPRINT. sign_test.sh builds+verifies with a PROTECTED throwaway key so\nthe fd-0 passphrase path is exercised. curl|sh + self-update anchor. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: apt repo build script + `apt-ftparchive generate` config + hermetic apt e2e + dates-only resign

**Files:**
- Create: `deploy/apt/apt-ftparchive.conf`
- Create: `deploy/apt/build.sh`
- Create: `deploy/apt/e2e_test.sh`
- Create: `deploy/apt/resign.sh`
- Create: `deploy/apt/resign_test.sh`

**Interfaces:**
- Consumes: built `.deb`s (Task 4) + a signing key (throwaway in test, `S_apt` in CI).
- Produces:
  - `build.sh <pool-input-dir> <repo-root> <s_apt_fpr>` — publish builder (copy new debs, index, sign).
  - `resign.sh <repo-root> <s_apt_fpr>` — **dates-only** Release refresh: verify + extract the S_apt-signed `InRelease` payload, replace only `Date`/`Valid-Until`, re-sign. Never re-reads/re-indexes the pool (laundering-proof); cold-start (no `InRelease`) is a graceful no-op. Used by the scheduled resign (Task 8).

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
# build.sh <pool-input-dir with new *.deb> <repo-root> <S_apt-fingerprint>
# PUBLISH builder: copies new release .debs into the pool, (re)generates per-arch
# indexes + a fresh Date/Valid-Until over the whole pool, and signs Release with S_apt.
# The scheduled Valid-Until refresh does NOT use this script — it uses resign.sh
# (dates-only, no pool re-index) so an unattended run cannot launder pool state (§7.2).
# <pool-input-dir> is always distinct from the repo's own pool here (apt-publish passes
# the downloaded-artifact dir), so no self-copy case arises.
set -eu
IN="$1"; ROOT="$2"; FPR="$3"
VALID_DAYS="${MATHION_APT_VALID_DAYS:-30}"
PASS="${GPG_PASSPHRASE:-}"
CONF="$(cd "$(dirname "$0")" && pwd)/apt-ftparchive.conf"
DEST="$ROOT/deb/pool/main/m/mathion"

mkdir -p "$DEST" "$ROOT/deb/dists/stable/main/binary-amd64" \
         "$ROOT/deb/dists/stable/main/binary-arm64"
cp "$IN"/mathion_*.deb "$DEST/"

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
# apt-ftparchive already emits a fresh Date:; append ONLY Valid-Until (a second
# Date: would be malformed deb822). deb822 is field-order-independent, so appending
# after the hash blocks is safe.
echo "Valid-Until: $(date -u -R -d "+${VALID_DAYS} days")" >> dists/stable/Release

# sign with S_apt; feed the passphrase on fd 0 when set (prod), skip when empty (throwaway).
gpg_sign() {
  if [ -n "$PASS" ]; then
    printf '%s' "$PASS" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 --local-user "${FPR}!" --digest-algo SHA256 "$@"
  else
    gpg --batch --pinentry-mode loopback --local-user "${FPR}!" --digest-algo SHA256 "$@"
  fi
}
rm -f dists/stable/InRelease dists/stable/Release.gpg
gpg_sign --clearsign -o dists/stable/InRelease dists/stable/Release
gpg_sign -abs        -o dists/stable/Release.gpg dists/stable/Release
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

# structural assertions: per-arch by-hash index + freshness stamp present
test -d "$WORK/site/deb/dists/stable/main/binary-amd64/by-hash/SHA256" || { echo "FAIL: no by-hash index"; exit 1; }
grep -q '^Valid-Until:' "$WORK/site/deb/dists/stable/InRelease" || { echo "FAIL: no Valid-Until in InRelease"; exit 1; }

# serve + configure apt
( cd "$WORK/site" && python3 -m http.server 8778 >/dev/null 2>&1 & echo $! > "$WORK/pid" )
sleep 1
install -m0644 "$WORK/keyring.gpg" /usr/share/keyrings/mathion-test.gpg
echo "deb [signed-by=/usr/share/keyrings/mathion-test.gpg] http://127.0.0.1:8778/deb stable main" \
  > /etc/apt/sources.list.d/mathion-test.list
apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/mathion-test.list \
  -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
apt-get install -y -o APT::Get::AllowUnauthenticated=false mathion
test -x /usr/bin/mathion && /usr/bin/mathion version >/dev/null

# tamper-negative: a corrupted, non-fallbackable Release must be REJECTED by apt.
# Modify a byte INSIDE the signed body (the Suite field), NOT a trailing append —
# gpg/gpgv process only the first OpenPGP message and ignore bytes past the signature
# block, so `printf 'x' >> InRelease` can slip through. A body edit breaks the
# clearsigned digest -> gpgv rejects -> apt refuses the repo.
rm -f "$WORK/site/deb/dists/stable/Release" "$WORK/site/deb/dists/stable/Release.gpg"
sed 's/^Suite: stable/Suite: tampered/' "$WORK/site/deb/dists/stable/InRelease" > "$WORK/ir.tampered" \
  && mv "$WORK/ir.tampered" "$WORK/site/deb/dists/stable/InRelease"
if apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/mathion-test.list \
     -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 >/dev/null 2>&1; then
  echo "FAIL: apt accepted a tampered InRelease"; exit 1
fi

# cleanup
kill "$(cat "$WORK/pid")" 2>/dev/null || true
apt-get remove -y mathion || true
rm -f /etc/apt/sources.list.d/mathion-test.list /usr/share/keyrings/mathion-test.gpg
echo "apt e2e PASSED"
```

- [ ] **Step 4: Run the e2e**

Run: `sudo sh deploy/apt/e2e_test.sh`
Expected: `apt e2e PASSED` (or `SKIP` if not root / no apt-utils). This proves `Release` signatures, per-arch indexes, by-hash, and `signed-by` all work end-to-end.

- [ ] **Step 5: Write the failing dates-only resign test (`deploy/apt/resign_test.sh`)**

This proves resign is laundering-proof WITHOUT apt-utils or root (gpg only): the pool
hash commitment is byte-identical before/after, so resign provably never re-reads/
re-indexes the pool; a content-tampered `InRelease` is refused; cold start no-ops.

```sh
#!/bin/sh
set -eu
GH="$(mktemp -d)"; export GNUPGHOME="$GH"; chmod 700 "$GH"   # split form (shellcheck SC2155)
cat > "$GH/kp" <<'P'
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Apt Test
Name-Email: apt@example.invalid
Expire-Date: 0
%commit
P
gpg --batch --gen-key "$GH/kp" >/dev/null 2>&1
PRIMARY="$(gpg --batch --with-colons --fingerprint | awk -F: '/^fpr:/{print $10; exit}')"
SUB="$(gpg --batch --with-colons --fingerprint "$PRIMARY" | awk -F: '$1=="sub"{s=1;next} s&&$1=="fpr"{print $10; exit}')"
ROOT="$(mktemp -d)"; D="$ROOT/deb/dists/stable"; mkdir -p "$D"
# minimal but realistic Release: stale Date/Valid-Until + a SHA256 pool-commitment block
cat > "$D/Release" <<'R'
Origin: Mathion
Suite: stable
Codename: stable
Components: main
Architectures: amd64 arm64
Date: Mon, 01 Jan 2024 00:00:00 +0000
Valid-Until: Mon, 15 Jan 2024 00:00:00 +0000
SHA256:
 0000000000000000000000000000000000000000000000000000000000000000    42 main/binary-amd64/Packages
R
gpg --batch --pinentry-mode loopback --local-user "${SUB}!" --digest-algo SHA256 --clearsign -o "$D/InRelease" "$D/Release"
extract_sha256() { awk '/^SHA256:/{p=1;print;next} p&&/^[ \t]/{print;next} p{exit}' "$1"; }
before="$(extract_sha256 "$D/Release")"
sh "$(dirname "$0")/resign.sh" "$ROOT" "$SUB"
gpg --batch --verify "$D/InRelease" >/dev/null 2>&1 || { echo "FAIL: re-signed InRelease does not verify"; exit 1; }
case "$(grep '^Valid-Until:' "$D/Release")" in *2024*|"") echo "FAIL: Valid-Until not refreshed"; exit 1;; esac
after="$(extract_sha256 "$D/Release")"
[ "$before" = "$after" ] || { echo "FAIL: pool hash commitment changed — resign re-read the pool"; exit 1; }
# content-tamper the SIGNED body -> resign must refuse (fail closed)
sed 's/Origin: Mathion/Origin: Evil/' "$D/InRelease" > "$D/InRelease.t" && mv "$D/InRelease.t" "$D/InRelease"
if sh "$(dirname "$0")/resign.sh" "$ROOT" "$SUB" 2>/dev/null; then echo "FAIL: resigned over a tampered InRelease"; exit 1; fi
# cold start (no InRelease) -> graceful no-op
COLD="$(mktemp -d)"; mkdir -p "$COLD/deb/dists/stable"
sh "$(dirname "$0")/resign.sh" "$COLD" "$SUB" || { echo "FAIL: cold start did not no-op"; exit 1; }
echo "resign_test PASSED"
```

- [ ] **Step 6: Run to verify it fails**

Run: `sh deploy/apt/resign_test.sh`
Expected: FAIL — `resign.sh` does not exist yet (`sh: .../resign.sh: No such file`).

- [ ] **Step 7: Write `deploy/apt/resign.sh` (dates-only, laundering-proof)**

```sh
#!/bin/sh
# resign.sh <repo-root> <S_apt-fingerprint>
# Dates-only Release refresh: verify the existing S_apt-signed InRelease, extract its
# authenticated payload, replace ONLY Date/Valid-Until, re-sign. It NEVER re-reads or
# re-indexes the pool, so an unattended run cannot launder tampered pool/Packages state
# into a freshly-signed Release — it only extends the validity window of an already
# S_apt-authenticated Release. Cold start (no InRelease) is a graceful no-op. (§7.2)
set -eu
ROOT="$1"; FPR="$2"
VALID_DAYS="${MATHION_APT_VALID_DAYS:-30}"
PASS="${GPG_PASSPHRASE:-}"
D="$ROOT/deb/dists/stable"
[ -f "$D/InRelease" ] || { echo "no signed repo yet ($D/InRelease absent); nothing to resign"; exit 0; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# gpg --decrypt on a clearsigned file VERIFIES the S_apt signature and emits ONLY the
# signed bytes; a bad signature makes it exit non-zero -> fail closed. Because it emits
# only the verified payload, any bytes appended past the signature block are dropped.
gpg --batch --output "$tmp/body" --decrypt "$D/InRelease" \
  || { echo "existing InRelease fails S_apt verification — refusing to resign tampered state" >&2; exit 1; }
# refresh ONLY Date/Valid-Until; every hash block (the pool commitment) is preserved verbatim
sed '/^Date:/d;/^Valid-Until:/d' "$tmp/body" > "$tmp/new"
{ echo "Date: $(date -u -R)"; echo "Valid-Until: $(date -u -R -d "+${VALID_DAYS} days")"; } >> "$tmp/new"
gpg_sign() {   # mirrors build.sh: feed the passphrase on fd 0 when set (prod), skip when empty (throwaway)
  if [ -n "$PASS" ]; then
    printf '%s' "$PASS" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 --local-user "${FPR}!" --digest-algo SHA256 "$@"
  else
    gpg --batch --pinentry-mode loopback --local-user "${FPR}!" --digest-algo SHA256 "$@"
  fi
}
cp "$tmp/new" "$D/Release"
rm -f "$D/InRelease" "$D/Release.gpg"
gpg_sign --clearsign -o "$D/InRelease" "$D/Release"
gpg_sign -abs        -o "$D/Release.gpg" "$D/Release"
echo "apt Release re-signed (fresh Date/Valid-Until, pool commitments preserved) by $FPR"
```

- [ ] **Step 8: Run the resign test to verify it passes**

Run: `sh deploy/apt/resign_test.sh`
Expected: `resign_test PASSED`.

- [ ] **Step 9: shellcheck**

Run: `shellcheck deploy/apt/build.sh deploy/apt/e2e_test.sh deploy/apt/resign.sh deploy/apt/resign_test.sh`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add deploy/apt/apt-ftparchive.conf deploy/apt/build.sh deploy/apt/e2e_test.sh deploy/apt/resign.sh deploy/apt/resign_test.sh
git commit -m "$(printf 'feat(cli): signed apt repo builder + hermetic apt e2e + dates-only resign\n\napt-ftparchive generate (Tree{} per-arch, DoByHash) + a computed Valid-Until,\nsigned InRelease + Release.gpg by S_apt. e2e_test.sh builds+signs with a\nthrowaway key, serves over localhost, apt installs mathion, and rejects a\ncontent-tampered InRelease. resign.sh does a dates-only Release refresh\n(verify+extract the signed payload, bump Date/Valid-Until, re-sign) that never\nre-reads the pool, so the unattended scheduled job cannot launder pool state;\nresign_test.sh proves the pool hash commitment is byte-identical across a\nrefresh. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: `release-cli.yml` — `release` env, upload-artifact, `apt-publish` job

**Files:**
- Modify: `.github/workflows/release-cli.yml`

**Interfaces:**
- Consumes: `deploy/apt/build.sh` (Task 6), the nfpm/signs config (Tasks 4–5), the `release`/`pages-resign` env secrets + `PAGES_DEPLOY_TOKEN` (manual prereq).

- [ ] **Step 1: Sign in the `release` job — env, S_rel import, deb assets, version guards, publish**

(a) Add `environment: release` to the `release` job. Import ONLY `S_rel` (the apt-publish job re-imports `S_apt` in its own homedir — the release job never signs the apt Release), before the build step:
```yaml
      - name: Import S_rel + enable loopback
        env:
          S_REL: ${{ secrets.GPG_S_REL_PRIVATE }}
        run: |
          export GNUPGHOME="$(mktemp -d)"; echo "GNUPGHOME=$GNUPGHOME" >> "$GITHUB_ENV"
          chmod 700 "$GNUPGHOME"
          echo "allow-loopback-pinentry" > "$GNUPGHOME/gpg-agent.conf"
          gpgconf --kill gpg-agent || true
          printf '%s' "$S_REL" | gpg --batch --import
```

(b) Prepare the nfpm content inputs — they are gitignored/generated, so the **production** build must create them exactly as the tests do (without this the tagged `goreleaser release` aborts on missing `contents.src`):
```yaml
      - name: Prepare .deb assets
        run: |
          gzip -9nkf deploy/man/mathion.1
          gzip -9nkf deploy/deb/changelog.Debian
          gzip -9nkf deploy/deb/THIRD_PARTY_NOTICES
          # apt keyring = primary + S_apt, dearmored deterministically from the committed file
          gpg --dearmor < deploy/keys/mathion-apt-keyring.asc > deploy/keys/mathion-archive-keyring.gpg
```

(c) No `.goreleaser.yaml` change here: the signing config (`stdin: "{{ .Env.GPG_PASSPHRASE }}"` + `--passphrase-fd 0`) already landed in Task 5. The release job's only job is to supply the **real** `GPG_PASSPHRASE` secret (env in the Build step, (d)) so the fd-0 passphrase reaches the protected `S_rel` key. (This task therefore no longer touches `cli/.goreleaser.yaml` — it is not in the Step 6 `git add`.)

(d) Replace the Build step so it signs, strictly validates the tag, and asserts the stripped version (refreshing the now-stale `--skip=validate` comment — nfpm's `file_name_template` DOES use `.Version`, so the assertion is what guards the strip):
```yaml
      - name: Build + sign (goreleaser)
        working-directory: cli
        env:
          CLI_TAG: ${{ github.ref_name }}
          APP_IMAGE: v0.2.0
          GPG_FINGERPRINT: ${{ vars.S_REL_FPR }}!
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        run: |
          echo "$CLI_TAG" | grep -Eq '^cli-v[0-9]+\.[0-9]+\.[0-9]+$' \
            || { echo "refusing to release a non cli-vX.Y.Z tag: $CLI_TAG" >&2; exit 1; }
          SEMVER="v${CLI_TAG#cli-v}"                 # cli-v0.2.0 -> v0.2.0
          # skip=validate: goreleaser's git-state check looks up a tag literally named
          # "$SEMVER" on HEAD, which collides with the app's own v* tag. We pass
          # GORELEASER_CURRENT_TAG explicitly and assert the stripped .Version below.
          GORELEASER_CURRENT_TAG="$SEMVER" goreleaser release --clean --skip=publish,validate
          deb="$(ls dist/mathion_*_amd64.deb | head -1)"
          v="$(dpkg-deb -f "$deb" Version)"
          [ "$v" = "${CLI_TAG#cli-v}" ] || { echo "deb Version $v != ${CLI_TAG#cli-v}" >&2; exit 1; }
```

(e) Extend the Publish step to attach the `.deb`s AND the signature (install.sh downloads `checksums.txt.asc` from the Release — without this every curl|sh install 404s):
```yaml
      - name: Publish release
        working-directory: cli
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "${{ github.ref_name }}" dist/*.tar.gz dist/*.deb dist/checksums.txt dist/checksums.txt.asc --title "${{ github.ref_name }}" --notes "Mathion CLI ${{ github.ref_name }}"
```

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
      contents: read          # gh-pages push uses PAGES_DEPLOY_TOKEN, not GITHUB_TOKEN
    concurrency:
      group: mathion-gh-pages
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@<SHA> # v7  (tag tree — provides deploy/apt + committed keyrings)
      - uses: actions/checkout@<SHA> # v7
        with:
          ref: gh-pages
          path: pages
          token: ${{ secrets.PAGES_DEPLOY_TOKEN }}
      - uses: actions/download-artifact@<SHA> # v4
        with: { name: deb-dist, path: dist }
      - name: Install apt-utils
        run: sudo apt-get update && sudo apt-get install -y apt-utils
      - name: Verify debs against the signed checksums (verify-before-index)
        run: |
          export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
          gpg --batch --import deploy/keys/mathion-pubkey.asc      # primary + S_rel
          st="$(gpg --batch --status-fd 1 --verify dist/checksums.txt.asc dist/checksums.txt 2>/dev/null)"
          printf '%s\n' "$st" | grep -q '^\[GNUPG:\] GOODSIG' || { echo "no GOODSIG on checksums"; exit 1; }
          if printf '%s\n' "$st" | grep -Eq '^\[GNUPG:\] (EXPKEYSIG|REVKEYSIG|EXPSIG|ERRSIG|BADSIG)'; then
            echo "checksums signed by an expired/revoked/bad key"; exit 1; fi
          printf '%s\n' "$st" | grep -q "^\[GNUPG:\] VALIDSIG ${{ vars.S_REL_FPR }} " || { echo "checksums not signed by S_rel"; exit 1; }
          cd dist && for d in mathion_*.deb; do
            n="$(grep -c " $d\$" checksums.txt || true)"; [ "$n" = 1 ] || { echo "expected one checksum line for $d (got $n)"; exit 1; }
            grep " $d\$" checksums.txt | sha256sum -c - || { echo "FAIL: $d checksum"; exit 1; }
          done
      - name: Import S_apt, verify existing repo, build + sign
        env:
          S_APT: ${{ secrets.GPG_S_APT_PRIVATE }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        run: |
          export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
          echo "allow-loopback-pinentry" > "$GNUPGHOME/gpg-agent.conf"; gpgconf --kill gpg-agent || true
          printf '%s' "$S_APT" | gpg --batch --import
          mkdir -p pages/deb
          # anti-laundering (partial): refuse to publish over an existing InRelease we
          # can't verify with S_apt. This catches a replaced/broken InRelease. It does
          # NOT re-verify each accumulated pool .deb against the signed Packages before
          # apt-ftparchive re-indexes them — so a pool .deb tampered in place (old
          # InRelease left valid over the old Packages) would be re-indexed and signed.
          # Scoped residual: tampering the gh-pages pool requires the PAGES_DEPLOY_TOKEN,
          # a per-repo PAT that also grants `main` write — i.e. the attacker could
          # subvert the pipeline directly (out of scope, §1.1). The genuinely-unattended
          # weak link is the scheduled resign, which Task 8 makes dates-only so it can
          # NEVER re-read/re-index the pool (laundering-proof by construction).
          if [ -f pages/deb/dists/stable/InRelease ]; then
            gpg --batch --verify pages/deb/dists/stable/InRelease >/dev/null 2>&1 \
              || { echo "existing InRelease fails S_apt verification — refusing to publish over tampered state"; exit 1; }
          fi
          # published keyring = primary + S_apt, dearmored from the committed file (matches the .deb's)
          gpg --dearmor < deploy/keys/mathion-apt-keyring.asc > pages/deb/mathion-archive-keyring.gpg
          touch pages/.nojekyll
          sh deploy/apt/build.sh "$PWD/dist" "$PWD/pages" "${{ vars.S_APT_FPR }}"
      - name: Publish to gh-pages (triggers a Pages build)
        run: |
          cd pages
          git config user.name "mathion-ci"; git config user.email "ci@example.invalid"
          git add -A && git commit -m "apt: publish ${{ github.ref_name }}" || echo "no changes"
          # concurrency serializes publish/resign, so the only racer is an external
          # gh-pages push; bounded rebase/retry (spec §11.3) rather than a hard fail.
          git push || { git fetch origin gh-pages && git rebase origin/gh-pages && git push; }
```
Cold start: the first run has an empty `gh-pages`; `mkdir -p pages/deb` + `build.sh`'s own `mkdir -p` handle it, and the InRelease pre-check is skipped (file absent). `.nojekyll` sits at `pages/` root (branch root).

- [ ] **Step 4: SHA-pin every action in this workflow**

Replace every `@v7`/`@v6`/`@v4` in `release-cli.yml` with the 40-char commit SHA + `# vN` comment — **including the secret-bearing `release` job's own `actions/checkout`, `actions/setup-go`, and `goreleaser/goreleaser-action`** (they run with `S_rel` in scope, so a compromised floating tag could exfiltrate the private key), not just the `apt-publish` job. Look up current SHAs via the GitHub API for each action tag.

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
git commit -m "$(printf 'ci(cli): sign the release + publish the apt repo (release-cli.yml)\n\nrelease job: protected `release` env, import S_rel only, prepare .deb assets\n(gzip + dearmor apt keyring), goreleaser signs checksums with S_rel (real\nGPG_PASSPHRASE secret -> fd 0), strict cli-vX.Y.Z tag + dpkg-deb Version\nassertion, attach .deb + checksums.txt.asc to the Release, upload debs as an\nartifact. New apt-publish job (contents: read): download-artifact +\nstrengthened verify-before-index (reject EXP/REV, pin S_rel, exactly-one-line),\napt-utils, anti-laundering InRelease pre-check, deterministic S_apt keyring,\nbuild+sign with S_apt, push via PAGES_DEPLOY_TOKEN (rebase/retry),\nconcurrency-guarded. SHA-pin all actions incl. the release job. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
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
      contents: read          # gh-pages push uses PAGES_DEPLOY_TOKEN, not GITHUB_TOKEN
    concurrency:
      group: mathion-gh-pages
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@<SHA> # v7  (default branch — deploy/apt script)
      - uses: actions/checkout@<SHA> # v7
        with: { ref: gh-pages, path: pages, token: ${{ secrets.PAGES_DEPLOY_TOKEN }} }
      - name: Re-sign Release (dates-only, S_apt)
        env:
          S_APT: ${{ secrets.GPG_S_APT_PRIVATE }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
        run: |
          GH="$(mktemp -d)"; export GNUPGHOME="$GH"; chmod 700 "$GH"
          echo "allow-loopback-pinentry" > "$GH/gpg-agent.conf"; gpgconf --kill gpg-agent || true
          printf '%s' "$S_APT" | gpg --batch --import
          # resign.sh is DATES-ONLY: it verifies + extracts the S_apt-signed InRelease
          # payload, bumps Date/Valid-Until, and re-signs — it NEVER re-reads or
          # re-indexes the pool. So this unattended job cannot launder tampered pool
          # state into a freshly-signed Release (it can only extend the validity window
          # of an already-authenticated Release), and needs no apt-utils. resign.sh's
          # decrypt-verify IS the anti-laundering gate (fail-closed) and it no-ops
          # gracefully when there is no InRelease yet (cold start).
          sh deploy/apt/resign.sh "$PWD/pages" "${{ vars.S_APT_FPR }}"
      - name: Publish
        run: |
          cd pages
          git config user.name "mathion-ci"; git config user.email "ci@example.invalid"
          git add -A && git commit -m "apt: scheduled resign" || echo "no changes"
          git push || { git fetch origin gh-pages && git rebase origin/gh-pages && git push; }
```
Note: the scheduled job uses `resign.sh` (Task 6), **not** `build.sh` — a dates-only
refresh that never touches the pool, closing the laundering vector for the genuinely
unattended path (spec §7.2/§11.4). No `apt-utils` needed (no `apt-ftparchive`). SHA-pin the actions.

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
git commit -m "$(printf 'ci(cli): scheduled dates-only apt Release re-sign (apt-resign.yml)\n\nUnattended pages-resign env (S_apt only, main-scoped); two-checkout like\napt-publish; calls resign.sh (dates-only: verify+extract the signed InRelease\npayload, bump Date/Valid-Until, re-sign) so Valid-Until never lapses WITHOUT\nre-reading the pool — the unattended job cannot launder pool state. No\napt-utils. Same concurrency group; push rebase/retry. Slice 4a.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
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

The current `amd64-smoke.yml` job has **only `checkout`** — no Go or goreleaser — so the
`.deb` leg must first install the toolchain (SHA-pinned, install-only, matching the
`apt-e2e` job in Step 1) *before* it can run `goreleaser`. The prior CLI-install step
already placed `/usr/local/bin/mathion`, so the postinst dual-install warning will fire.

Add these steps to the `install-smoke` job, after the CLI-install step:
```yaml
      - uses: actions/setup-go@<SHA> # v7
        with: { go-version: "1.24" }
      - uses: goreleaser/goreleaser-action@<SHA> # v6
        with: { version: "~> v2", install-only: true }
      - name: Local .deb install + dual-install warning
        run: |
          set -euo pipefail
          # goreleaser needs the same gitignored nfpm inputs the prod build creates
          # (gz man/changelog/notices + a keyring file — a placeholder is fine here,
          # since --skip=sign and this leg only exercises install/postinst).
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

**Spec coverage (§2.1 4a scope):** §5 .deb → T3/T4; §6 signing/key lifecycle + channel separation → T5 (S_rel + digest-algo + `stdin`/`--passphrase-fd 0`), T7 (import + prepare-assets), T3 (two keyrings doc), manual prereqs; §7 apt repo (publish `build.sh` + dates-only laundering-proof `resign.sh`) → T6; §8 install.sh authenticity → T2; §10 dual-install → T1 (version), T2 (install.sh), T4 (postinst); §11 CI (verify-before-index, dates-only resign, split envs) → T7/T8/T9; §12 tests (incl. expired- & revoked-key rejection, resign hash-preservation) → T2/T4/T5/T6/T9; §13 docs → T3/T10; §14 prereqs → Manual section. `version --short` correctly deferred to 4b. Covered.

**Channel separation (enforced on the verify side):** install.sh embeds primary+`S_rel` and pins `EXPECTED_SIGNING_FPR` (VALIDSIG first field) → an `S_apt` compromise can't forge curl|sh; the apt keyring is primary+`S_apt` (dearmored from `mathion-apt-keyring.asc`) → `signed-by` enforces `S_apt`. No verifier carries both subkeys.

**Placeholder scan:** the only intentional placeholders are the **real GPG key material** (`deploy/keys/mathion-pubkey.asc` = primary+S_rel, `deploy/keys/mathion-apt-keyring.asc` = primary+S_apt, install.sh embedded block, `EXPECTED_PRIMARY_FPR`, `EXPECTED_SIGNING_FPR`, `${{ vars.S_REL_FPR }}`/`S_APT_FPR`) and the **action SHAs** — all explicitly maintainer/lookup-filled and marked. Tests use throwaway keys. No logic placeholders.

**Type/name consistency:** `binExists`/`lookPath`/`maybeWarnDualInstall`/`aptBinPath`/`curlBinPath` (T1) consistent. `verify_sig`/`mathion_embedded_key`/`EXPECTED_SIGNING_FPR`/`MATHION_INSTALL_LIB` (T2) referenced identically by the behavioral test. `build.sh <in> <root> <fpr>` (publish, T6→T7) and `resign.sh <root> <fpr>` (dates-only, T6→T8) signatures consistent; both read `GPG_PASSPHRASE` and feed it on `--passphrase-fd 0`. `GPG_FINGERPRINT` env (T5) ↔ `${{ vars.S_REL_FPR }}!` (T7); goreleaser `signs` supplies the passphrase via `stdin` + `--passphrase-fd 0` (T5). Keyring path `/usr/share/keyrings/mathion-archive-keyring.gpg` consistent (T4/T6/T7/T10); source-of-truth `mathion-apt-keyring.asc` (T3) dearmored in T4-tests (placeholder) + T7 (prod). Concurrency group `mathion-gh-pages` identical in T7/T8; both push with rebase/retry. `--skip=` phases: install_sh_test `publish,sign,nfpm`; sign_test `publish,nfpm`; deb_test/e2e/amd64 `publish,sign`.

**Known execution notes for the implementer:** tasks needing `apt-utils`/root (T6 e2e, T9 amd64 leg) SKIP gracefully off-CI; the tag-triggered signing/publish (T7) and scheduled resign (T8) are static-validated here and only run for real once the manual prereqs exist — that real run is the deferred maintainer smoke, not a task gate.

---

## Plan review history

**Review round 1 (pre-execution, 2026-08-13):** 4 independent reviewers (Opus 4.8 xhigh) + codex (high). Folded findings, all verified against the plan/spec before applying:
- **CRITICAL (folded):** production release job never created nfpm inputs (T7b prepare-assets); `checksums.txt.asc`/`.deb` not attached to the Release (T7e); `build.sh` never fed the S_apt passphrase (T6 `gpg_sign`); apt-resign `cp` self-copy crash (round-1 added a `build.sh` self-copy guard — **superseded in round 2**: resign no longer uses `build.sh`, it is dates-only via `resign.sh`, and the guard was removed); install.sh verify test was vacuous (T2 now sources the real `verify_sig`, adds expired/revoked/wrong-channel/gpg-absent).
- **IMPORTANT (folded):** `stdin` passphrase broke sign_test (T5 `GPG_PASSPHRASE=""`); missing `S_REL_FPR`/`S_APT_FPR` vars (prereq 2); missing §5 tag/version guards (T7d); duplicate `Date:` in Release (T6, append only Valid-Until); apt-utils not installed in prod jobs (T7/T8); verify-before-index strengthened (T7); keyring completeness — apt keyring dearmored from committed file, never a per-job export (T7); SHA-pin the secret-bearing release job (T7 Step 4); digest-algo SHA256 (T5/T6).
- **Design decision (user-approved):** enforce channel separation on the verify side — two trimmed keyrings, install.sh pins the S_rel subkey; revises spec §6.3/§16.
- **Minor (folded):** `--allow-unauthenticated=false` → `-o APT::Get::AllowUnauthenticated=false`; `.gitignore` named files not `*.gz`; dropped phantom `go-licenses --template`; `contents: read` on the gh-pages jobs; dropped unused S_apt import from the release job; scheduled-workflow 60-day auto-disable note (prereq 6); e2e by-hash/Valid-Until/tamper assertions; sign_test subkey selection.
- **Routed to 4b (recorded in spec §9):** Go `VerifyDetachedSignatureAndHash` + exact S_rel issuer; self-update must try releases descending until one verifies; fd-relative execution / root-owned-ancestry swap; bounded self-update downloads.

**Review round 2 (post-fold re-review, 2026-08-14):** codex (high) re-reviewed the folded plan+spec; each finding verified against real gpg (dry-runs) before folding:
- **CRITICAL (folded):** goreleaser `stdin` alone can't feed a protected key — added `--passphrase-fd 0` to `signs.args` + moved `stdin` into T5, and sign_test now uses a PROTECTED key so the fd-0 path is genuinely exercised (cold-agent dry-run confirmed: fails without the flag, signs with it). Anti-laundering didn't authenticate the state it re-signs — the unattended scheduled job now runs **dates-only** `resign.sh` (verify+extract the signed `InRelease` payload, bump only `Date`/`Valid-Until`, re-sign; never re-reads/re-indexes the pool), proven laundering-proof by `resign_test.sh` (pool hash commitment byte-identical); apt-publish's accumulated-pool residual is scoped to §1.1 (gh-pages write == repo write). amd64-smoke's `.deb` leg invoked `goreleaser` with no toolchain — added SHA-pinned `setup-go` + `goreleaser-action` (T9).
- **IMPORTANT (folded):** finished the spec sweep (§4/§4.1/§12/§14 — two-keyring wording, `VerifyDetachedSignatureAndHash`, `contents: read`, `PAGES_DEPLOY_TOKEN`); reconciled the scalar `EXPECTED_SIGNING_FPR` with the rotation text (install.sh pins one current `S_rel`; dual-accept overlap is a 4b embedded-key concern); added a real **expired-key** case to the T2 test (separate `--faked-system-time` key, no `sleep`).
- **MINOR (folded):** gh-pages push now `git push || fetch+rebase+push` (T7/T8); spec §11.3 matched.
- **Surfaced by round-2 dry-runs (folded):** T6 e2e tamper switched from a trailing append (gpg/gpgv ignore bytes past the signature block) to a signed-body edit so apt reliably rejects; `sign_test`/`resign_test` use the split-form `export` and the T2 gpg-absent case carries a documented `# shellcheck disable=SC2123` (bare `export X="$(…)"` / `PATH=""` trip shellcheck → non-zero exit).
