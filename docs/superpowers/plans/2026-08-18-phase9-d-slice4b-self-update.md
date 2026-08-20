# Phase 9-D Slice 4b — `mathion self-update` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a channel-aware, S_rel-signature-verified, forward-only `mathion self-update` command that swaps the running `mathion` CLI binary in place (plus the small `version --short` flag it needs as its pre-swap oracle).

**Architecture:** A new `cli/internal/selfupdate` package holds all logic (HTTP with size/time caps, GitHub release resolution + forward-gate, OpenPGP checksum verification against a `go:embed`ed trimmed keyring, `dpkg` channel detection, and a TOCTOU-safe fd-relative staged swap using raw `*at` syscalls), orchestrated as steps 1–8. A thin `cli/cmd/self_update.go` cobra command wires it to `*App`. apt-managed installs are deferred to apt; curl|sh installs are verified and swapped. Every seam is injected so unit tests need no network, root, dpkg, real `/usr/local/bin`, or real exec.

**Tech Stack:** Go 1.24 (floor), cobra; new deps `github.com/ProtonMail/go-crypto/openpgp` (+`/armor`), `golang.org/x/mod/semver`, `golang.org/x/sys/unix`.

**Source spec (authoritative — read the cited §§ per task):** `docs/superpowers/specs/2026-08-15-phase9-d-slice4b-self-update-design.md`.

## Global Constraints

- **Linux-only.** The swap uses raw `*at` syscalls via `golang.org/x/sys/unix` (Go 1.24's `os.Root` has no `Rename`; `os.Rename` re-resolves paths — §5.2). No Windows/macOS path.
- **Cross-platform dev build (macOS host) MUST stay green.** goreleaser ships `goos: [linux]` only, but the dev host is macOS and `cmd` imports `selfupdate` from Task 10 on. So the syscall-bearing files carry `//go:build linux` and a `//go:build !linux` stub provides `func Run(...) error` returning `"self-update is supported only on Linux"`. The cross-platform API surface (`Params`, `config`, `DefaultConfig`, endpoint helpers, and the PURE helpers `redirectAllowed`/`normalizeForCompare`/`forwardEligible`/`verifyChecksums`/`checksumFor`/`detectChannel`/`ancestrySafe`/`guardTarget`/`extractSingleBinary`) stays untagged so `go build ./...` and `go test ./cmd/` keep compiling on macOS. **Syscall tests are `*_linux_test.go`** — on macOS they compile out (a native `go test ./internal/selfupdate/` silently omits them), so the authoritative verification runs in a Linux container:
  `docker run --rm -v "$(git rev-parse --show-toplevel)":/w -w /w/cli golang:1.24 go test ./internal/selfupdate/...` (run from `cli/`; mounts the repo root at `/w` so the keyring drift-guard test can read `../../../deploy/keys/mathion-pubkey.asc` = `/w/deploy/keys/...`). Add `-v "$HOME/go/pkg/mod":/go/pkg/mod` to reuse the host module cache. OrbStack's `docker` is agent-reachable (same as the apt e2e). Cross-check without a container: `goreleaser build --clean --snapshot` (GOOS=linux) compiles every `//go:build linux` file from the macOS host.
- **Go 1.24 floor** (`cli/go.mod` says `go 1.24`) — do not bump it. Note: `go get`-ing a dep whose own floor is `go 1.24.0` (x/mod v0.33.0, x/sys v0.41.0) rewrites the directive `go 1.24` → `go 1.24.0`; this is EXPECTED and still on-floor — the acceptance grep `^go 1\.24(\.[0-9]+)?$` accepts the patch suffix. What must never happen is a bump to `go 1.25`+ (which x/mod v0.34.0+/x/sys v0.42.0+ would force). Where a step says "the `go 1.24` directive is unchanged," read it as "still `go 1.24` or `go 1.24.0`, never `1.25`+."
- **New deps only these three:** `github.com/ProtonMail/go-crypto/openpgp` (+`openpgp/armor`), `golang.org/x/mod/semver`, `golang.org/x/sys/unix` (transitively `cloudflare/circl`, `golang.org/x/crypto`). The module otherwise depends only on cobra/pflag/mousetrap.
- **Exit codes 0/1 only.** Reuse `cmd`'s `exitCode` (update.go:46). self-update adds NO new exit code (no rollback). A user-declined confirm returns `nil` → exit 0 (deviates from `update.go`'s error-returning cancel).
- **S_rel enforcement is keyring membership.** Verify `checksums.txt` with `VerifyDetachedSignatureAndHash` against a keyring trimmed to primary + the single current S_rel subkey; a signature verifies iff made by a key in that keyring. NEVER a separately-hardcoded issuer scalar. NEVER accept S_apt. Allowed digest set is EXACTLY `{crypto.SHA256, crypto.SHA384, crypto.SHA512}`. Require the armor block `Type == openpgp.SignatureType`, and the `IssuerFingerprint` subpacket present + equal to a member of the dynamically-built S_rel-subkey set. (§6.1)
- **Forward-only, no downgrade, no arbitrary pinning.** Select the greatest release that *verifies*; a rotation is crossed with a transition release, never a dual-accept keyring (§6.2).
- **Swap target is exactly `/usr/local/bin/mathion`** (a seam defaulting to it) AND every ancestor from `/` must be root-owned (uid 0) and not group- or world-writable, else refuse (§4.2 step 4a, §6.3).
- **Anti-downgrade anchor is the RUNNING IMAGE**, captured via `open("/proc/self/exe", O_PATH|O_CLOEXEC)`+`fstat` — NOT a re-stat of the resolved pathname (§4.2 step 1). Re-checked under a non-blocking `flock(LOCK_EX|LOCK_NB)` on the retained parent-dir fd at step 4b.
- **Parent-dir fd opened `O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC`, never `O_PATH`** (flock EBADFs on O_PATH). The `O_CLOEXEC` is load-bearing (correction 6): the flock lives on the open file description, so an fd copy inherited across `execve` shares the lock and holds it until that copy also closes — every self-update fd is `O_CLOEXEC` so none leaks into the staged exec. All swap-phase fs ops are fd-relative off this fd (§4.2 step 4a/4b).
- **Explicit lock release on the normal path:** `flock(LOCK_UN)` before the parent-dir fd is closed (`releaseMutationLock`); the `O_CLOEXEC` close is the crash/abnormal-exit backstop (correction 6, §4.2 step 4b).
- **Durable ordering:** `fsync(temp)` → close writable fd → open RO exec fd → exec `version --short` via the inherited fd (never by pathname), **bounded + fork-safe** (own process group + `kill(-pgid)` on deadline/output-overrun + nonzero `Cmd.WaitDelay`, so a hung/flooding/fork-and-orphan staged binary cannot pin the flock — §4.2 step 7, correction 6) → `renameat` → `fsync(dir)` (§5.3). Post-rename: `renameat` fail → target unchanged; `renameat` OK + `fsync(dir)` fail → dedicated "installed-but-durability-uncertain" error, no rollback, no "nothing changed".
- **Bound every download** (size + time — §6.4 caps table). Archive download runs under the flock, so it carries its own idle/stall + overall-deadline bound, separate from the verify-loop budget.
- **All HTTP https-only across redirects**, size cap on the final body, redirect policy a pure predicate.
- **goreleaser archive is binary-only** via a non-matching glob `files: ["none*"]` (empty `[]` re-applies default README*/LICENSE* globs).
- **Tooling:** run all `go` commands from `cli/`. Commit with `git add <exact named paths>` (never `-A`/`.`). Commit trailer EXACTLY:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**New package `cli/internal/selfupdate/` (split by responsibility; ✱ = `//go:build linux`, tests for ✱ files are `*_linux_test.go`):**
- `httpget.go` — the size/time-capped HTTP client, the pure redirect predicate, `getLimited` (size-bounded GET). (Task 2)
- `releases.go` — the `config` struct (all fields, single definition), GitHub `/releases` pagination, `cli-v*` filter, semver forward-gate, descending sort. (Task 3)
- `verify.go` — `go:embed`ed keyring load/trim, `armor.Decode`, `VerifyDetachedSignatureAndHash`, S_rel-subkey membership, checksum-line selection. (Task 4)
- `channel.go` — `dpkg -S` classification (exec seam; compiles cross-platform). (Task 5)
- `ancestry.go` — the PURE ancestry decision (`ancestrySafe`, `guardTarget`, `component`); untagged. (Task 6)
- `ancestry_linux.go` ✱ — the real fd-relative `openat`/`fstat` walk (`walkAncestry`, `closeFD`). (Task 6)
- `swap.go` ✱ — running-image identity capture, parent-dir open, non-blocking flock (+ explicit `LOCK_UN` release), staged `O_EXCL` temp write, `fchmod`, bounded fork-safe inherited-fd exec (`cappedBuffer`, Setpgid + `kill(-pgid)` + `WaitDelay`), `renameat`, `fsync(dir)`, post-rename branches. (Task 7)
- `artifact.go` — verify-until-verifiable selection + bounded archive download + single-binary extraction (untagged; pure + HTTP). (Task 8)
- `selfupdate.go` — untagged orchestrator API only: `Params`, `DefaultConfig` (nothing OS-specific, so `cmd` compiles on macOS). (Task 9)
- `run_linux.go` ✱ — the real `Run` (steps 1–8), `ensureRoot`, and ALL orchestrator seams (`osExecutable`, `evalSymlinks`, `geteuid`, `loadKeyringFn`, `captureRunningImageFn`, `walkAncestryFn`) — `geteuid` lives here (Linux-tagged), NOT in untagged `selfupdate.go`. (Task 9)
- `run_other.go` (`//go:build !linux`) — stub `Run` returning "self-update is supported only on Linux" so macOS/Windows dev builds compile. (Task 9)
- `endpoints_default.go` (`//go:build !mathion_selfupdate_test`) + `endpoints_testtag.go` (`//go:build mathion_selfupdate_test`) — endpoint base URL override seam (both untagged w.r.t. OS). (Tasks 9/13)
- `execbounds_testtag.go` (`//go:build linux && mathion_selfupdate_test`) — `init()` that injects the staged-exec deadline/output-cap from env for the §9.2 integration legs (no paired default file: it only MUTATES swap.go's package vars). (Task 13)
- `mathion-pubkey.asc` — `go:embed`ed keyring, byte-identical copy of `deploy/keys/mathion-pubkey.asc`. (Task 4)
- `*_test.go` per file; syscall tests (`swap`, `ancestry_linux`, orchestrator `run_linux`) are `*_linux_test.go`.

**New command:** `cli/cmd/self_update.go` + `cli/cmd/self_update_test.go`. (Task 10)

**Modified:** `cli/cmd/version.go`+`version_test.go` (Task 1); `cli/cmd/root.go` (Task 10); `cli/go.mod`/`go.sum` (deps added in Tasks 3/4/6 — all PINNED to keep the `go 1.24` floor); `cli/.goreleaser.yaml` + `cli/scripts/selfupdate-ci-guards.sh` + `.github/workflows/ci.yml` (Task 11); `README.md`, `deploy/man/mathion.1`, `deploy/keys/README.md`, `deploy/deb/copyright`+`THIRD_PARTY_NOTICES` (Task 12). **New standalone integration harness** `cli/selfupdate_integration_test.sh` + `endpoints_testtag.go`/`execbounds_testtag.go` (Task 13; a sibling of `deploy/apt/e2e_test.sh`, NOT wired into `cli/integration_test.sh`).

---

### Task 1: `version --short` flag

Spec: §7. The side-effect-free oracle self-update's step 7 compares against the selected tag. `mathion version --short` prints **only** `buildVersion` and returns — no `.env` read, no `/version` probe, no dual-install warning.

**Files:**
- Modify: `cli/cmd/version.go:62-91` (`newVersionCmd`)
- Test: `cli/cmd/version_test.go`

**Interfaces:**
- Consumes: `buildVersion` (root.go:23), `*App.Out` (root.go:12).
- Produces: `mathion version --short` → stdout `buildVersion + "\n"`, exit 0, nothing else.

- [ ] **Step 1: Write the failing test** — append to `cli/cmd/version_test.go`:

```go
func TestVersionShort_PrintsOnlyBuildVersion(t *testing.T) {
	// Fail the side-effect seams so the test proves --short never touches them.
	oldEnv, oldProbe, oldBin := versionEnvReader, versionRunningProbe, binExists
	t.Cleanup(func() { versionEnvReader, versionRunningProbe, binExists = oldEnv, oldProbe, oldBin })
	versionEnvReader = func(string) (map[string]string, error) { t.Fatal(".env must NOT be read under --short"); return nil, nil }
	versionRunningProbe = func(context.Context) string { t.Fatal("/version must NOT be probed under --short"); return "" }
	binExists = func(string) bool { t.Fatal("dual-install check must NOT run under --short"); return false }

	var out, errb bytes.Buffer
	app := &App{Out: &out, Err: &errb}
	cmd := newVersionCmd(app)
	cmd.SetArgs([]string{"--short"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if got, want := out.String(), buildVersion+"\n"; got != want {
		t.Fatalf("stdout = %q, want %q", got, want)
	}
	if errb.Len() != 0 {
		t.Fatalf("stderr = %q, want empty", errb.String())
	}
}
```

- [ ] **Step 2: Run it — expect FAIL** (`--short` is an unknown flag)

Run: `cd cli && go test ./cmd/ -run TestVersionShort -v`
Expected: FAIL (`unknown flag: --short`).

- [ ] **Step 3: Implement** — in `newVersionCmd`, declare the flag and short-circuit at the top of `RunE`:

```go
func newVersionCmd(app *App) *cobra.Command {
	var short bool
	c := &cobra.Command{
		Use:   "version",
		Short: "Print the CLI version and the pinned/running image version",
		RunE: func(c *cobra.Command, _ []string) error {
			if short {
				fmt.Fprintln(app.Out, buildVersion)
				return nil
			}
			fmt.Fprintf(app.Out, "mathion %s\n", buildVersion)
			maybeWarnDualInstall(app.Err)
			// ... unchanged existing body ...
		},
	}
	c.Flags().BoolVar(&short, "short", false, "print only the CLI version and exit")
	return c
}
```

- [ ] **Step 4: Run it — expect PASS**, and the whole cmd suite still green.

Run: `cd cli && go test ./cmd/ -run TestVersion -v && go test ./cmd/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/version.go cli/cmd/version_test.go
git commit -m "feat(cli): version --short (self-update pre-swap oracle)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: capped HTTP client + pure redirect predicate

Spec: §3.2 (HTTP seam), §6.4 (caps). The size/time-bounded fetch primitive every later network task uses, plus the https-only redirect policy exposed as a pure predicate.

**Files:**
- Create: `cli/internal/selfupdate/httpget.go`, `cli/internal/selfupdate/httpget_test.go`

**Interfaces:**
- Produces:
  - `func redirectAllowed(nextScheme string, depth, maxDepth int) error`
  - `func newHTTPClient(transport http.RoundTripper, maxDepth int) *http.Client`
  - `func getLimited(ctx context.Context, c *http.Client, url string, capBytes int64, perReq time.Duration) (body []byte, hdr http.Header, err error)`

- [ ] **Step 1: Write the failing tests** — `cli/internal/selfupdate/httpget_test.go`:

```go
package selfupdate

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRedirectAllowed(t *testing.T) {
	if err := redirectAllowed("https", 1, 5); err != nil {
		t.Fatalf("https within depth allowed: %v", err)
	}
	if err := redirectAllowed("http", 1, 5); err == nil {
		t.Fatal("http hop must be rejected")
	}
	if err := redirectAllowed("https", 6, 5); err == nil {
		t.Fatal("over-depth must be rejected")
	}
}

func TestGetLimited_CapStatus(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Write([]byte("hello"))
		case "/big":
			w.Write(bytes.Repeat([]byte("x"), 100))
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer srv.Close()
	c := newHTTPClient(srv.Client().Transport, 5)
	ctx := context.Background()

	body, _, err := getLimited(ctx, c, srv.URL+"/ok", 10, time.Second)
	if err != nil || string(body) != "hello" {
		t.Fatalf("ok: body=%q err=%v", body, err)
	}
	if _, _, err := getLimited(ctx, c, srv.URL+"/big", 10, time.Second); err == nil {
		t.Fatal("over-cap body must error")
	}
	if _, _, err := getLimited(ctx, c, srv.URL+"/err", 10, time.Second); err == nil {
		t.Fatal("non-200 must error")
	}
}

func TestGetLimited_FollowsHTTPSRedirect_CapsPostRedirectBody(t *testing.T) {
	final := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(bytes.Repeat([]byte("y"), 50)) // 50 bytes AFTER the redirect
	}))
	defer final.Close()
	front := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, final.URL+"/asset", http.StatusFound)
	}))
	defer front.Close()

	pool := x509.NewCertPool()
	pool.AddCert(front.Certificate())
	pool.AddCert(final.Certificate())
	c := newHTTPClient(&http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}, 5)

	// cap 10 < 50: the post-redirect body must be the one that trips the cap.
	if _, _, err := getLimited(context.Background(), c, front.URL+"/dl", 10, time.Second); err == nil {
		t.Fatal("post-redirect body over cap must error (proves cap binds the FINAL body)")
	}
}
```

- [ ] **Step 2: Run — expect FAIL** (undefined symbols)

Run: `cd cli && go test ./internal/selfupdate/ -run 'TestRedirect|TestGetLimited' -v`
Expected: FAIL (build: undefined `redirectAllowed`, `newHTTPClient`, `getLimited`).

- [ ] **Step 3: Implement** — `cli/internal/selfupdate/httpget.go`:

```go
// Package selfupdate implements `mathion self-update`: channel-aware,
// S_rel-signature-verified, forward-only in-place upgrade of the mathion CLI.
package selfupdate

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"
)

// redirectAllowed is the PURE redirect policy (unit-tested directly, not only via
// an injected client): follow redirects but reject any non-https hop and cap depth.
// GitHub asset URLs 302 to objects.githubusercontent.com (§3.2).
func redirectAllowed(nextScheme string, depth, maxDepth int) error {
	if nextScheme != "https" {
		return fmt.Errorf("refusing non-https redirect (scheme %q)", nextScheme)
	}
	if depth > maxDepth {
		return fmt.Errorf("too many redirects (>%d)", maxDepth)
	}
	return nil
}

// newHTTPClient builds the release-fetch client over an injected transport (a test
// supplies an httptest TLS server's trust). CheckRedirect enforces redirectAllowed;
// len(via) is the redirect depth so far.
func newHTTPClient(transport http.RoundTripper, maxDepth int) *http.Client {
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return redirectAllowed(req.URL.Scheme, len(via), maxDepth)
		},
	}
}

// getLimited GETs url under a per-request timeout, requires HTTP 200, and reads at
// most capBytes (erroring if the body would exceed it — the cap binds the FINAL,
// post-redirect body). Returns body + response headers (Link pagination needs them).
func getLimited(ctx context.Context, c *http.Client, url string, capBytes int64, perReq time.Duration) ([]byte, http.Header, error) {
	rctx, cancel := context.WithTimeout(ctx, perReq)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, nil, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, capBytes+1))
	if err != nil {
		return nil, nil, err
	}
	if int64(len(body)) > capBytes {
		return nil, nil, fmt.Errorf("GET %s: body exceeds %d bytes", url, capBytes)
	}
	return body, resp.Header, nil
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd cli && go test ./internal/selfupdate/ -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/internal/selfupdate/httpget.go cli/internal/selfupdate/httpget_test.go
git commit -m "feat(cli): selfupdate size/time-capped HTTP client + pure redirect predicate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: release resolution + pagination + forward-gate

Spec: §4.1 (normalization), §4.2 step 3, §6.4 (pagination cap). Fetch the `/releases` list across pages, keep canonical `cli-vX.Y.Z` tags strictly greater than the current build, descending; abort fail-closed if pagination exceeds the cap (never truncate). Adds the `golang.org/x/mod/semver` dep.

**Files:**
- Create: `cli/internal/selfupdate/releases.go`, `cli/internal/selfupdate/releases_test.go`
- Modify: `cli/go.mod`, `cli/go.sum`

**Interfaces:**
- Consumes: `getLimited` (Task 2), `config` fields `apiBase`, `client`, `capReleasesPage`, `perReqTO`, `pageCap`.
- Produces:
  - `func normalizeForCompare(tag string) string` — `"cli-vX.Y.Z"` → `"vX.Y.Z"`; `dev`/non-canonical/prerelease → `""` (sorts below every release).
  - `type release struct { Tag string; Draft, Prerelease bool }` (JSON `tag_name`/`draft`/`prerelease`).
  - `func forwardEligible(all []release, current string) []string` — canonical `cli-v*` tags `> current`, descending.
  - `func fetchReleases(ctx context.Context, cfg config) ([]release, error)`.
  - `type config struct { ... }` (first defined here; later tasks add fields — see the running definition in Task 8).

- [ ] **Step 1: Add the dep — PINNED, and do NOT `go mod tidy` yet.** `x/mod@latest` (≥ v0.34.0) declares `go 1.25.0`, which bare `go get` would write into `go.mod`, bumping the module off the **1.24 floor** and breaking the container gate + CI (`setup-go go-version: "1.24"`). `v0.33.0` is the last `go 1.24.0`-floor release. Crucially, **`go mod tidy` here would PRUNE the require** (nothing imports `x/mod` until Step 4), and the failure's suggested recovery re-resolves to `@latest` → `go 1.25.0`, recreating the bug. Plain pinned `go get` persists the require + `go.sum`:

```bash
cd cli && go get golang.org/x/mod@v0.33.0
```
Expected: `go.mod` gains `require golang.org/x/mod v0.33.0`; the `go 1.24` directive is unchanged (tidy + floor-check run in Step 5, after `releases.go` imports it).

- [ ] **Step 2: Write the failing tests** — `cli/internal/selfupdate/releases_test.go`:

```go
package selfupdate

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestNormalizeForCompare(t *testing.T) {
	cases := map[string]string{
		"cli-v1.2.3":     "v1.2.3",
		"dev":            "",
		"cli-v1.2":       "", // not 3-component canonical
		"cli-v1.2.3-rc1": "", // prerelease
		"cli-vX":         "",
	}
	for in, want := range cases {
		if got := normalizeForCompare(in); got != want {
			t.Errorf("normalizeForCompare(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestForwardEligible(t *testing.T) {
	all := []release{
		{Tag: "cli-v0.2.0"}, {Tag: "cli-v0.3.0"}, {Tag: "cli-v0.10.0"},
		{Tag: "v0.9.0"},                       // app release — excluded
		{Tag: "cli-v0.4.0", Draft: true},      // draft — excluded
		{Tag: "cli-v0.5.0", Prerelease: true}, // prerelease — excluded
		{Tag: "cli-v0.2.0-rc1"},               // non-canonical — excluded
	}
	got := forwardEligible(all, "cli-v0.2.0")
	if want := []string{"cli-v0.10.0", "cli-v0.3.0"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("current=0.2.0: got %v want %v", got, want)
	}
	// dev build: every canonical cli-v* is forward, descending.
	got = forwardEligible(all, "dev")
	if want := []string{"cli-v0.10.0", "cli-v0.3.0", "cli-v0.2.0"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("current=dev: got %v want %v", got, want)
	}
}

func TestFetchReleases_PaginatesAndCaps(t *testing.T) {
	// Two-page server: page 1 links to a next page; page 2 does not.
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("page") {
		case "1":
			w.Header().Set("Link", `<https://x/releases?page=2>; rel="next"`)
			fmt.Fprint(w, `[{"tag_name":"cli-v0.2.0","draft":false,"prerelease":false}]`)
		case "2":
			fmt.Fprint(w, `[{"tag_name":"cli-v0.3.0","draft":false,"prerelease":false}]`)
		default:
			fmt.Fprint(w, `[]`)
		}
	}))
	defer srv.Close()
	cfg := config{apiBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5),
		capReleasesPage: 1 << 20, perReqTO: time.Second, pageCap: 10}

	rels, err := fetchReleases(context.Background(), cfg)
	if err != nil || len(rels) != 2 {
		t.Fatalf("paginated fetch: rels=%v err=%v", rels, err)
	}

	// pageCap=1 but page 1 still advertises a next page -> fail-closed, never truncate.
	cfg.pageCap = 1
	if _, err := fetchReleases(context.Background(), cfg); err == nil {
		t.Fatal("exceeding the pagination cap must abort, not truncate")
	}
}
```

- [ ] **Step 3: Run — expect FAIL** (undefined symbols)

Run: `cd cli && go test ./internal/selfupdate/ -run 'Normalize|Forward|FetchReleases' -v`
Expected: FAIL (undefined `normalizeForCompare`, `forwardEligible`, `fetchReleases`, `release`, `config`).

- [ ] **Step 4: Implement** — `cli/internal/selfupdate/releases.go`:

```go
package selfupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

// config carries every injected endpoint / cap / timeout so unit tests need no
// network or root. Defined in full here (Go structs are single-definition); each
// field notes the task that consumes it. The OpenPGP keyring is deliberately NOT a
// field (it would force a go-crypto import before Task 4) — it is passed separately.
type config struct {
	apiBase          string        // Task 3 — https://api.github.com/repos/<owner>/<repo>
	dlBase           string        // Task 8 — https://github.com/<owner>/<repo>/releases/download
	client           *http.Client  // Task 3
	perReqTO         time.Duration // Task 3 — per-request timeout
	pageCap          int           // Task 3
	capReleasesPage  int64         // Task 3
	capChecksums     int64         // Task 8
	capAsc           int64         // Task 8
	capArchive       int64         // Task 8
	capExtracted     int64         // Task 8
	verifyBudget     time.Duration // Task 8 — overall verify-loop wall-clock
	topN             int           // Task 8 — max candidates tried
	archiveIdleTO    time.Duration // Task 8 — archive idle/stall timeout
	archiveOverallTO time.Duration // Task 8 — archive overall deadline
	swapTarget       string        // Task 9 — configured swap-target (default /usr/local/bin/mathion)
}

type release struct {
	Tag        string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// normalizeForCompare maps a CLI tag / buildVersion to a semver string for
// semver.Compare, or "" if it is not a canonical 3-component cli-vX.Y.Z with no
// prerelease. "" sorts below every release (so a `dev` build always proceeds). §4.1.
func normalizeForCompare(tag string) string {
	v := strings.TrimPrefix(tag, "cli-") // cli-v1.2.3 -> v1.2.3 ; dev -> dev
	if !semver.IsValid(v) || semver.Canonical(v) != v || semver.Prerelease(v) != "" {
		return ""
	}
	return v
}

// forwardEligible keeps non-draft, non-prerelease, canonical cli-vX.Y.Z tags
// strictly greater than current (normalized), sorted DESCENDING. §4.2 step 3.
func forwardEligible(all []release, current string) []string {
	cur := normalizeForCompare(current) // "" for dev -> everything is forward
	var out []string
	for _, r := range all {
		if r.Draft || r.Prerelease || !strings.HasPrefix(r.Tag, "cli-v") {
			continue
		}
		nv := normalizeForCompare(r.Tag)
		if nv == "" {
			continue
		}
		if cur == "" || semver.Compare(nv, cur) > 0 {
			out = append(out, r.Tag)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return semver.Compare(normalizeForCompare(out[i]), normalizeForCompare(out[j])) > 0
	})
	return out
}

// hasNextLink reports whether a GitHub Link header advertises another page.
func hasNextLink(link string) bool { return strings.Contains(link, `rel="next"`) }

// fetchReleases GETs every page of /releases (per_page=100) up to pageCap,
// accumulating ALL entries. If a (pageCap+1)-th page is advertised it aborts
// fail-closed rather than truncating. §4.2 step 3, §6.4.
func fetchReleases(ctx context.Context, cfg config) ([]release, error) {
	var out []release
	for page := 1; page <= cfg.pageCap; page++ {
		url := fmt.Sprintf("%s/releases?per_page=100&page=%d", cfg.apiBase, page)
		body, hdr, err := getLimited(ctx, cfg.client, url, cfg.capReleasesPage, cfg.perReqTO)
		if err != nil {
			return nil, err
		}
		var pageRels []release
		if err := json.Unmarshal(body, &pageRels); err != nil {
			return nil, fmt.Errorf("parse releases page %d: %w", page, err)
		}
		out = append(out, pageRels...)
		if !hasNextLink(hdr.Get("Link")) {
			return out, nil
		}
		if page == cfg.pageCap {
			return nil, fmt.Errorf("release list exceeds the pagination cap (%d pages)", cfg.pageCap)
		}
	}
	return out, nil
}
```

- [ ] **Step 5: Tidy (now that `releases.go` imports `x/mod`), assert the floor, then run — expect PASS**, plus `go vet`. `go mod tidy` is safe here — the import exists, so tidy keeps the require instead of pruning it — and the grep guards against any transitive `go 1.25.0` floor-bump:

```bash
cd cli && go mod tidy
grep -qE '^go 1\.24(\.[0-9]+)?$' go.mod || { echo "FAIL: go directive bumped off the 1.24 floor"; exit 1; }
go test ./internal/selfupdate/ -v && go vet ./internal/selfupdate/
```
Expected: `go.mod` still pins `golang.org/x/mod v0.33.0`, the `go 1.24` directive is unchanged, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/selfupdate/releases.go cli/internal/selfupdate/releases_test.go cli/go.mod cli/go.sum
git commit -m "feat(cli): selfupdate release resolution + pagination + forward-gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: S_rel signature + checksum verification + embedded keyring

Spec: §6.1. Verify `checksums.txt` against a `go:embed`ed keyring trimmed to primary + S_rel; enforcement is keyring membership + the explicit contract (armor block type, exact digest set, issuer-fpr present & member of the S_rel-subkey set). Adds the `github.com/ProtonMail/go-crypto` dep and the embedded keyring asset. **Note:** `deploy/keys/mathion-pubkey.asc` is a placeholder until the maintainer keygen (§12), so `loadKeyring()` returns an error at runtime today; that is the documented placeholder-until-keygen state. Unit tests inject throwaway keyrings and never call `loadKeyring`; the byte-identity drift guard still holds (both files are the same placeholder).

**Files:**
- Create: `cli/internal/selfupdate/verify.go`, `cli/internal/selfupdate/verify_test.go`, `cli/internal/selfupdate/mathion-pubkey.asc`
- Modify: `cli/go.mod`, `cli/go.sum`

**Interfaces:**
- Produces:
  - `func loadKeyring() (openpgp.EntityList, error)` — parse the embedded asset (errors on the placeholder until keygen).
  - `func srelSubkeyFingerprints(kr openpgp.EntityList) [][]byte` — signing-capable subkey fingerprints.
  - `func verifyChecksums(kr openpgp.EntityList, checksums, sigASC []byte) error` — nil iff a valid detached sig by an S_rel subkey.
  - `func checksumFor(checksums []byte, asset string) (string, error)` — the single hex sha256 for `asset`.

- [ ] **Step 1: Add the dep (PINNED, no `go mod tidy` yet) + copy the keyring asset.** As in Task 3, defer `go mod tidy` to Step 5 — nothing imports go-crypto until `verify.go` exists, so tidying now would prune the require and the recovery could re-resolve a floor-bumping version. `go-crypto@v1.4.1`'s floor is go 1.23 (verified), so the pin itself does not bump the module:

```bash
cd cli && go get github.com/ProtonMail/go-crypto@v1.4.1
cp ../deploy/keys/mathion-pubkey.asc internal/selfupdate/mathion-pubkey.asc
```
Expected: `go.mod` gains `require github.com/ProtonMail/go-crypto v1.4.1` (+ transitive `cloudflare/circl`, `golang.org/x/crypto` — all `go 1.24`-floor-compatible); the `go 1.24` directive is unchanged (tidy + floor-check run in Step 5); the asset is a byte-identical copy of the canonical placeholder.

- [ ] **Step 2: Write the failing tests** — `cli/internal/selfupdate/verify_test.go`:

```go
package selfupdate

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ProtonMail/go-crypto/openpgp"
	"github.com/ProtonMail/go-crypto/openpgp/packet"
)

// newSigner returns a throwaway entity with a signing subkey and its public keyring.
func newSigner(t *testing.T) (*openpgp.Entity, openpgp.EntityList) {
	t.Helper()
	e, err := openpgp.NewEntity("Test", "", "t@example.invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	return e, entityKeyring(t, e)
}

// entityKeyring serializes e's PUBLIC half and reads it back as a keyring (what
// self-update verifies against). Shared by the expired/revoked cases below.
func entityKeyring(t *testing.T, e *openpgp.Entity) openpgp.EntityList {
	t.Helper()
	var pub bytes.Buffer
	if err := e.Serialize(&pub); err != nil { // public entity only
		t.Fatal(err)
	}
	kr, err := openpgp.ReadKeyRing(&pub)
	if err != nil {
		t.Fatal(err)
	}
	return kr
}

func armoredSig(t *testing.T, signer *openpgp.Entity, msg []byte) []byte {
	return armoredSigConfig(t, signer, msg, nil)
}

// armoredSigConfig signs with an explicit config — needed to sign AS-OF a past
// time for the expired-key case, when the key was still valid.
func armoredSigConfig(t *testing.T, signer *openpgp.Entity, msg []byte, cfg *packet.Config) []byte {
	t.Helper()
	var asc bytes.Buffer
	if err := openpgp.ArmoredDetachSign(&asc, signer, bytes.NewReader(msg), cfg); err != nil {
		t.Fatal(err)
	}
	return asc.Bytes()
}

// signingSubkey returns the index of e's signing-capable subkey. NewEntity adds
// an ENCRYPTION subkey at index 0, so the signer is not necessarily Subkeys[0] —
// revoking the wrong subkey silently passes verification (learned empirically).
func signingSubkey(t *testing.T, e *openpgp.Entity) int {
	t.Helper()
	for i := range e.Subkeys {
		if s := e.Subkeys[i].Sig; s != nil && s.FlagsValid && s.FlagSign {
			return i
		}
	}
	t.Fatal("no signing subkey")
	return -1
}

func TestVerifyChecksums(t *testing.T) {
	relEntity, relKR := newSigner(t)   // "S_rel" — its subkey IS in the verifying keyring
	aptEntity, _ := newSigner(t)        // foreign key (S_apt analog) — NOT in relKR
	sums := []byte("abc123  mathion_linux_amd64.tar.gz\n")

	if err := verifyChecksums(relKR, sums, armoredSig(t, relEntity, sums)); err != nil {
		t.Fatalf("valid S_rel signature must verify: %v", err)
	}
	if err := verifyChecksums(relKR, sums, armoredSig(t, aptEntity, sums)); err == nil {
		t.Fatal("a signature from a key outside the trimmed keyring must be rejected")
	}
	if err := verifyChecksums(relKR, []byte("tampered  x\n"), armoredSig(t, relEntity, sums)); err == nil {
		t.Fatal("a signature over different bytes must be rejected")
	}
	bad := armoredSig(t, relEntity, sums)
	bad[len(bad)/2] ^= 0xFF // corrupt the armored signature
	if err := verifyChecksums(relKR, sums, bad); err == nil {
		t.Fatal("a corrupted .asc must be rejected")
	}
}

// §9.1 signature negatives beyond wrong-key/tampered. go-crypto's
// VerifyDetachedSignatureAndHash rejects BOTH expired and revoked signing subkeys
// NATIVELY ("key expired" / "signature made by revoked key") — verifyChecksums
// needs NO membership-loop change; the tests just have to target the SIGNING subkey.
func TestVerifyChecksums_ExpiredKey(t *testing.T) {
	sums := []byte("abc123  mathion_linux_amd64.tar.gz\n")
	past := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	cfg := &packet.Config{Time: func() time.Time { return past }, KeyLifetimeSecs: 3600}
	e, err := openpgp.NewEntity("Expired", "", "e@example.invalid", cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(cfg); err != nil {
		t.Fatal(err)
	}
	kr := entityKeyring(t, e)
	sig := armoredSigConfig(t, e, sums, cfg) // signed when the key was still valid
	if err := verifyChecksums(kr, sums, sig); err == nil {
		t.Fatal("a signature by an expired signing subkey must be rejected")
	}
}

func TestVerifyChecksums_RevokedKey(t *testing.T) {
	sums := []byte("abc123  mathion_linux_amd64.tar.gz\n")
	e, err := openpgp.NewEntity("Revoked", "", "r@example.invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	i := signingSubkey(t, e)
	sig := armoredSig(t, e, sums) // sign BEFORE revoking
	if err := e.RevokeSubkey(&e.Subkeys[i], packet.NoReason, "rotated out", nil); err != nil {
		t.Fatal(err)
	}
	kr := entityKeyring(t, e)
	if err := verifyChecksums(kr, sums, sig); err == nil {
		t.Fatal("a signature by a revoked signing subkey must be rejected")
	}
}

// §6.1 correction 5: an untrimmed keyring carrying TWO signing subkeys (e.g. a full
// export that swept in S_apt) must be refused before any signature check — the
// assertSingleSigningSubkey guard fires first, so even a bogus .asc never reaches
// armor.Decode. NewEntity adds an ENCRYPTION subkey at index 0; two AddSigningSubkey
// calls give exactly two SIGNING subkeys.
func TestVerifyChecksums_RejectsMultipleSigningSubkeys(t *testing.T) {
	e, err := openpgp.NewEntity("Untrimmed", "", "u@example.invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	if err := e.AddSigningSubkey(nil); err != nil {
		t.Fatal(err)
	}
	kr := entityKeyring(t, e)
	err = verifyChecksums(kr, []byte("abc  mathion_linux_amd64.tar.gz\n"), []byte("not-a-real-signature"))
	if err == nil || !strings.Contains(err.Error(), "exactly one signing subkey") {
		t.Fatalf("want single-subkey rejection before signature check, got %v", err)
	}
}

func TestChecksumFor(t *testing.T) {
	body := []byte("deadbeef  mathion_linux_amd64.tar.gz\nfeedface  other\n")
	got, err := checksumFor(body, "mathion_linux_amd64.tar.gz")
	if err != nil || got != "deadbeef" {
		t.Fatalf("exactly-one: got %q err %v", got, err)
	}
	if _, err := checksumFor(body, "absent.tar.gz"); err == nil {
		t.Fatal("zero matches must error")
	}
	dup := []byte("a  m.tgz\nb  m.tgz\n")
	if _, err := checksumFor(dup, "m.tgz"); err == nil {
		t.Fatal("duplicate matches must error")
	}
}

func TestEmbeddedKeyringMatchesCanonical(t *testing.T) {
	canonical, err := os.ReadFile("../../../deploy/keys/mathion-pubkey.asc")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(canonical, embeddedKeyring) {
		t.Fatal("embedded mathion-pubkey.asc has drifted from deploy/keys/mathion-pubkey.asc")
	}
}
```

- [ ] **Step 3: Run — expect FAIL** (undefined symbols)

Run: `cd cli && go test ./internal/selfupdate/ -run 'Verify|Checksum|EmbeddedKeyring' -v`
Expected: FAIL (undefined `verifyChecksums`, `checksumFor`, `embeddedKeyring`).

- [ ] **Step 4: Implement** — `cli/internal/selfupdate/verify.go`:

```go
package selfupdate

import (
	"bufio"
	"bytes"
	"crypto"
	_ "embed"
	"errors"
	"fmt"
	"strings"

	"github.com/ProtonMail/go-crypto/openpgp"
	"github.com/ProtonMail/go-crypto/openpgp/armor"
)

//go:embed mathion-pubkey.asc
var embeddedKeyring []byte

// allowedHashes is the EXACT digest set self-update accepts — reject SHA-1/MD5. §6.1.
var allowedHashes = []crypto.Hash{crypto.SHA256, crypto.SHA384, crypto.SHA512}

// loadKeyring parses the embedded primary + S_rel keyring. Returns an error while
// mathion-pubkey.asc is the placeholder (keygen is a 4a go-live prereq, §12); the
// injectable keyring seam (Task 8) is what tests and integration use. The
// single-signing-subkey assertion (§6.1 correction 5) rejects an untrimmed asset
// at load time — before any signature is ever checked against it.
func loadKeyring() (openpgp.EntityList, error) {
	kr, err := openpgp.ReadArmoredKeyRing(bytes.NewReader(embeddedKeyring))
	if err != nil {
		return nil, err
	}
	if err := assertSingleSigningSubkey(kr); err != nil {
		return nil, err
	}
	return kr, nil
}

// srelSubkeyFingerprints collects the fingerprints of signing-capable subkeys in
// the trimmed keyring — the ONLY fingerprints a release signature may carry. The
// primary is deliberately excluded (§6.1: never the primary, never a scalar).
func srelSubkeyFingerprints(kr openpgp.EntityList) [][]byte {
	var fps [][]byte
	for _, e := range kr {
		for _, sub := range e.Subkeys {
			if sub.Sig != nil && sub.Sig.FlagsValid && sub.Sig.FlagSign {
				fps = append(fps, sub.PublicKey.Fingerprint)
			}
		}
	}
	return fps
}

// assertSingleSigningSubkey enforces §6.1 correction 5: the verifying keyring must
// carry EXACTLY ONE signing-capable non-primary subkey. Zero means an unusable
// keyring; two or more means an untrimmed asset (e.g. a full `gpg --export` that
// swept in S_apt) that would silently widen the accepted-signer set. Called both at
// load (embedded asset) AND at the top of verifyChecksums, so an injected keyring
// (Task 8 seam) is guarded on the same path a signature is checked.
func assertSingleSigningSubkey(kr openpgp.EntityList) error {
	if n := len(srelSubkeyFingerprints(kr)); n != 1 {
		return fmt.Errorf("verifying keyring must have exactly one signing subkey, found %d", n)
	}
	return nil
}

// verifyChecksums returns nil iff sigASC is a valid detached signature over
// checksums, made by a signing subkey present in kr. Fails closed on any deviation
// (untrimmed keyring, wrong armor block, disallowed digest, bad/absent signature,
// non-member issuer).
func verifyChecksums(kr openpgp.EntityList, checksums, sigASC []byte) error {
	if err := assertSingleSigningSubkey(kr); err != nil {
		return err
	}
	block, err := armor.Decode(bytes.NewReader(sigASC))
	if err != nil {
		return fmt.Errorf("armor decode: %w", err)
	}
	if block.Type != openpgp.SignatureType {
		return fmt.Errorf("unexpected armor block %q (want %q)", block.Type, openpgp.SignatureType)
	}
	sig, _, err := openpgp.VerifyDetachedSignatureAndHash(kr, bytes.NewReader(checksums), block.Body, allowedHashes, nil)
	if err != nil {
		return fmt.Errorf("signature verify: %w", err)
	}
	if len(sig.IssuerFingerprint) == 0 {
		return errors.New("signature carries no issuer fingerprint")
	}
	for _, fp := range srelSubkeyFingerprints(kr) {
		if bytes.Equal(fp, sig.IssuerFingerprint) {
			return nil
		}
	}
	return errors.New("signature not made by an S_rel signing subkey")
}

// checksumFor returns the hex sha256 for asset, requiring EXACTLY ONE
// whitespace-delimited "<hex>  <asset>" line (zero or duplicate -> error). §4.2 step 5.
func checksumFor(checksums []byte, asset string) (string, error) {
	var hexsum string
	n := 0
	sc := bufio.NewScanner(bytes.NewReader(checksums))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && f[1] == asset {
			hexsum, n = f[0], n+1
		}
	}
	if err := sc.Err(); err != nil {
		return "", err
	}
	if n != 1 {
		return "", fmt.Errorf("expected exactly one checksum line for %s, found %d", asset, n)
	}
	return hexsum, nil
}
```

> Note on the "missing issuer subpacket" negative (§9.1): go-crypto always emits the issuer-fingerprint subpacket for v4+ keys, so it cannot be produced from `ArmoredDetachSign`; the `len(sig.IssuerFingerprint)==0` guard is defense-in-depth and is not forced by a unit test.

- [ ] **Step 5: Tidy (now that `verify.go` imports go-crypto), assert the floor, then run — expect PASS.** The import exists, so `go mod tidy` keeps the require; the grep guards the floor:

```bash
cd cli && go mod tidy
grep -qE '^go 1\.24(\.[0-9]+)?$' go.mod || { echo "FAIL: go directive bumped off the 1.24 floor"; exit 1; }
go test ./internal/selfupdate/ -v
```
Expected: `go.mod` still pins `github.com/ProtonMail/go-crypto v1.4.1`, the `go 1.24` directive is unchanged, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/selfupdate/verify.go cli/internal/selfupdate/verify_test.go cli/internal/selfupdate/mathion-pubkey.asc cli/go.mod cli/go.sum
git commit -m "feat(cli): selfupdate S_rel checksum verification + embedded keyring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: channel detection (`dpkg -S`)

Spec: §4.2 step 2, §5.1. `dpkg -S <resolved path>` is the single source of truth: `mathion`-owned → apt-managed (defer); not-found or dpkg-absent → curl-managed (continue); anything else (foreign package, other error) → abort fail-closed.

**Files:**
- Create: `cli/internal/selfupdate/channel.go`, `cli/internal/selfupdate/channel_test.go`

**Interfaces:**
- Produces:
  - `type channelResult int` with `channelApt`, `channelCurl`.
  - `type dpkgResult struct { stdout, stderr []byte; exitCode int; absent bool }`
  - `var dpkgSearch func(ctx context.Context, path string) dpkgResult` (exec seam).
  - `func detectChannel(ctx context.Context, path string) (channelResult, error)`

- [ ] **Step 1: Write the failing tests** — `cli/internal/selfupdate/channel_test.go`:

```go
package selfupdate

import (
	"context"
	"testing"
)

func TestDetectChannel(t *testing.T) {
	orig := dpkgSearch
	t.Cleanup(func() { dpkgSearch = orig })
	ctx := context.Background()

	set := func(r dpkgResult) { dpkgSearch = func(context.Context, string) dpkgResult { return r } }

	set(dpkgResult{stdout: []byte("mathion: /usr/bin/mathion\n"), exitCode: 0})
	if c, err := detectChannel(ctx, "/usr/bin/mathion"); err != nil || c != channelApt {
		t.Fatalf("apt plain: c=%d err=%v", c, err)
	}
	set(dpkgResult{stdout: []byte("mathion:amd64: /usr/bin/mathion\n"), exitCode: 0})
	if c, err := detectChannel(ctx, "/usr/bin/mathion"); err != nil || c != channelApt {
		t.Fatalf("apt multiarch: c=%d err=%v", c, err)
	}
	set(dpkgResult{stderr: []byte("dpkg-query: no path found matching pattern /usr/local/bin/mathion"), exitCode: 1})
	if c, err := detectChannel(ctx, "/usr/local/bin/mathion"); err != nil || c != channelCurl {
		t.Fatalf("curl not-found: c=%d err=%v", c, err)
	}
	set(dpkgResult{absent: true})
	if c, err := detectChannel(ctx, "/usr/local/bin/mathion"); err != nil || c != channelCurl {
		t.Fatalf("curl dpkg-absent: c=%d err=%v", c, err)
	}
	set(dpkgResult{stdout: []byte("otherpkg: /usr/local/bin/mathion\n"), exitCode: 0})
	if _, err := detectChannel(ctx, "/usr/local/bin/mathion"); err == nil {
		t.Fatal("foreign package (exit 0, pkg != mathion) must abort")
	}
	set(dpkgResult{stderr: []byte("dpkg: some other error"), exitCode: 2})
	if _, err := detectChannel(ctx, "/usr/local/bin/mathion"); err == nil {
		t.Fatal("other dpkg error must abort")
	}
}
```

- [ ] **Step 2: Run — expect FAIL** (undefined symbols)

Run: `cd cli && go test ./internal/selfupdate/ -run TestDetectChannel -v`
Expected: FAIL.

- [ ] **Step 3: Implement** — `cli/internal/selfupdate/channel.go`:

```go
package selfupdate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
)

type channelResult int

const (
	channelApt channelResult = iota
	channelCurl
)

type dpkgResult struct {
	stdout, stderr []byte
	exitCode       int
	absent         bool // dpkg binary not on PATH
}

// dpkgSearch runs `LC_ALL=C dpkg -S <path>` (seam for hermetic tests).
var dpkgSearch = func(ctx context.Context, path string) dpkgResult {
	cmd := exec.CommandContext(ctx, "dpkg", "-S", path)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	var so, se bytes.Buffer
	cmd.Stdout, cmd.Stderr = &so, &se
	err := cmd.Run()
	r := dpkgResult{stdout: so.Bytes(), stderr: se.Bytes()}
	switch {
	case err == nil:
		r.exitCode = 0
	case errors.Is(err, exec.ErrNotFound):
		r.absent = true
	default:
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			r.exitCode = ee.ExitCode()
		} else {
			r.exitCode = -1
		}
	}
	return r
}

// parseDpkgPkg extracts the package name from "pkg[:arch]: /path" (first line),
// tolerating the multiarch :arch qualifier (dpkg renders `mathion:amd64: ...`).
func parseDpkgPkg(out []byte) string {
	line := out
	if i := bytes.IndexByte(out, '\n'); i >= 0 {
		line = out[:i]
	}
	if colon := bytes.IndexByte(line, ':'); colon >= 0 {
		return string(line[:colon]) // package name is up to the FIRST colon
	}
	return ""
}

// detectChannel classifies the install channel, failing closed on anything
// ambiguous or foreign. §4.2 step 2.
func detectChannel(ctx context.Context, path string) (channelResult, error) {
	r := dpkgSearch(ctx, path)
	if r.absent {
		return channelCurl, nil
	}
	switch r.exitCode {
	case 0:
		if pkg := parseDpkgPkg(r.stdout); pkg == "mathion" {
			return channelApt, nil
		} else {
			return 0, fmt.Errorf("%s is owned by package %q, not mathion; refusing", path, pkg)
		}
	case 1:
		if bytes.Contains(r.stderr, []byte("no path found matching pattern")) {
			return channelCurl, nil
		}
		return 0, fmt.Errorf("dpkg -S %s: unexpected exit-1 output: %s", path, bytes.TrimSpace(r.stderr))
	default:
		return 0, fmt.Errorf("dpkg -S %s failed (exit %d): %s", path, r.exitCode, bytes.TrimSpace(r.stderr))
	}
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd cli && go test ./internal/selfupdate/ -run TestDetectChannel -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/selfupdate/channel.go cli/internal/selfupdate/channel_test.go
git commit -m "feat(cli): selfupdate fail-closed dpkg channel detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ancestry guard (pure decision fn + fd-relative walk)

Spec: §4.2 step 4a, §6.3. Refuse unless the resolved self path equals the configured target AND every ancestor from `/` is root-owned and not group/world-writable. The decision is a pure function over per-component `(uid, mode)`; the real `openat`/`fstat` walk feeds it (integration-tested). Adds the `golang.org/x/sys/unix` dep.

**Files:**
- Create: `cli/internal/selfupdate/ancestry.go` (untagged — pure), `cli/internal/selfupdate/ancestry_test.go` (untagged), `cli/internal/selfupdate/ancestry_linux.go` (`//go:build linux`), `cli/internal/selfupdate/ancestry_linux_test.go` (`//go:build linux`)
- Modify: `cli/go.mod`, `cli/go.sum`

**Interfaces:**
- Produces (untagged, `ancestry.go`):
  - `type component struct { name string; uid uint32; mode os.FileMode }`
  - `func ancestrySafe(comps []component) error`
  - `func guardTarget(resolved, configured string) error`
- Produces (`//go:build linux`, `ancestry_linux.go`):
  - `var closeFD = unix.Close`
  - `func walkAncestry(targetPath string) (comps []component, parentFD int, err error)` — parentFD opened `O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC` (the `O_CLOEXEC` is load-bearing: this fd carries Task 7's mutation flock, and correction 6 requires it not leak into the staged exec), caller closes.

- [ ] **Step 1: Add the dep — PINNED, and do NOT `go mod tidy` yet.** `x/sys@latest` (≥ v0.42.0) declares `go 1.25.0`; `v0.41.0` is the last `go 1.24.0`-floor release. As in Tasks 3/4, defer tidy to Step 5 — `x/sys/unix` isn't imported until `ancestry_linux.go` exists, so tidying now would prune the require and the recovery could re-resolve `@latest` → `go 1.25.0`:

```bash
cd cli && go get golang.org/x/sys@v0.41.0
```
Expected: `go.mod` gains `require golang.org/x/sys v0.41.0`; the `go 1.24` directive is unchanged (tidy + floor-check run in Step 5).

- [ ] **Step 2: Write the failing tests.** Pure decisions → `cli/internal/selfupdate/ancestry_test.go` (untagged, runs on macOS):

```go
package selfupdate

import (
	"strings"
	"testing"
)

func TestAncestrySafe(t *testing.T) {
	ok := []component{{"/", 0, 0o755}, {"/usr", 0, 0o755}, {"/usr/local/bin", 0, 0o755}}
	if err := ancestrySafe(ok); err != nil {
		t.Fatalf("all root:0755 must pass: %v", err)
	}
	nonRoot := []component{{"/", 0, 0o755}, {"/usr/local/bin", 1000, 0o755}}
	if err := ancestrySafe(nonRoot); err == nil || !strings.Contains(err.Error(), "/usr/local/bin") {
		t.Fatalf("non-root component must be named: %v", err)
	}
	groupW := []component{{"/", 0, 0o755}, {"/usr/local/bin", 0, 0o775}}
	err := ancestrySafe(groupW)
	if err == nil || !strings.Contains(err.Error(), "/usr/local/bin") {
		t.Fatalf("group-writable component must be named: %v", err)
	}
	// §6.3 MINOR-1: the refusal carries the both-components remediation, since a
	// staff-group host makes /usr/local group-writable too and fixing only the leaf
	// leaves the parent refused.
	if !strings.Contains(err.Error(), "chmod 0755 /usr/local /usr/local/bin") {
		t.Fatalf("refusal must give the both-components remediation: %v", err)
	}
	worldW := []component{{"/usr/local/bin", 0, 0o757}}
	if err := ancestrySafe(worldW); err == nil {
		t.Fatal("world-writable component must be refused")
	}
}

func TestGuardTarget(t *testing.T) {
	if err := guardTarget("/usr/local/bin/mathion", "/usr/local/bin/mathion"); err != nil {
		t.Fatalf("matching target must pass: %v", err)
	}
	if err := guardTarget("/home/x/mathion", "/usr/local/bin/mathion"); err == nil {
		t.Fatal("a relocated binary must be refused")
	}
}
```

And the fd-walk smoke → `cli/internal/selfupdate/ancestry_linux_test.go` (`//go:build linux`):

```go
//go:build linux

package selfupdate

import "testing"

// walkAncestry is exercised for real on a root-owned tree in integration (Task 13);
// here just prove it walks a real tree and returns a usable parent fd + components.
// It asserts STRUCTURE, not ownership, so it runs fine as root (the golang:1.24
// container runs as root) — do NOT skip under root, or the walk is never exercised.
func TestWalkAncestry_Smoke(t *testing.T) {
	comps, fd, err := walkAncestry("/usr/bin/mathion") // real dirs, read-only stats
	if err != nil {
		t.Skipf("environment lacks /usr/bin: %v", err)
	}
	defer func() { _ = closeFD(fd) }()
	if len(comps) == 0 {
		t.Fatal("expected at least the root component")
	}
}
```

- [ ] **Step 3: Run — expect FAIL** (undefined symbols)

Run (pure, macOS): `cd cli && go test ./internal/selfupdate/ -run 'Ancestry|GuardTarget' -v`
Expected: FAIL (undefined `ancestrySafe`, `guardTarget`, `component`).

- [ ] **Step 4a: Implement the pure decisions** — `cli/internal/selfupdate/ancestry.go` (untagged, no `unix` import):

```go
package selfupdate

import (
	"fmt"
	"os"
)

type component struct {
	name string
	uid  uint32
	mode os.FileMode // permission bits only
}

// ancestryRemediation is the fix appended to every ancestry refusal (§6.3). The walk
// aborts on the FIRST offending component, but a Debian staff-group host
// (/etc/staff-group-for-usr-local → base-files sets /usr/local{,/bin} to root:staff
// 2775) makes BOTH group-writable; fixing only the leaf leaves /usr/local refused, so
// the hint names every standard-install component to repair, not just the one flagged.
const ancestryRemediation = "repair every offending component (on a Debian staff-group host both /usr/local and /usr/local/bin): chgrp root /usr/local /usr/local/bin && chmod 0755 /usr/local /usr/local/bin"

// ancestrySafe returns nil iff EVERY component is root-owned (uid 0) and not
// group- or world-writable; else an error naming the first offender AND the §6.3
// remediation covering both standard-install components. §4.2 step 4a.
func ancestrySafe(comps []component) error {
	for _, c := range comps {
		if c.uid != 0 {
			return fmt.Errorf("%s is not root-owned (uid %d); %s", c.name, c.uid, ancestryRemediation)
		}
		if c.mode&0o022 != 0 {
			return fmt.Errorf("%s is group- or world-writable (mode %04o); %s", c.name, c.mode, ancestryRemediation)
		}
	}
	return nil
}

// guardTarget enforces the resolved self path equals the configured swap-target. §4.2 step 4a.
func guardTarget(resolved, configured string) error {
	if resolved != configured {
		return fmt.Errorf("self-update manages only the standard %s install; reinstall via the curl|sh installer (resolved self: %s)", configured, resolved)
	}
	return nil
}
```

- [ ] **Step 4b: Implement the fd-relative walk** — `cli/internal/selfupdate/ancestry_linux.go` (`//go:build linux`):

```go
//go:build linux

package selfupdate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

// closeFD is a seam so tests/callers close a raw fd uniformly.
var closeFD = unix.Close

// walkAncestry opens the target's parent directory and every ancestor from "/" with
// openat(O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC), fstat-ing each fd, and returns
// the per-component metadata + the RETAINED parent-dir fd (NOT O_PATH — step 4b's
// flock needs a normal fd). The caller must closeFD(parentFD). §4.2 step 4a, §5.2.
func walkAncestry(targetPath string) ([]component, int, error) {
	const flags = unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
	parent := filepath.Dir(targetPath) // /usr/local/bin/mathion -> /usr/local/bin

	fd, err := unix.Openat(unix.AT_FDCWD, "/", flags, 0)
	if err != nil {
		return nil, -1, fmt.Errorf("open /: %w", err)
	}
	comps, err := appendStat(nil, fd, "/")
	if err != nil {
		_ = unix.Close(fd)
		return nil, -1, err
	}

	cur := ""
	for _, p := range splitAbs(parent) {
		cur += "/" + p
		next, err := unix.Openat(fd, p, flags, 0)
		_ = unix.Close(fd) // keep only the deepest fd open
		if err != nil {
			return nil, -1, fmt.Errorf("open %s: %w", cur, err)
		}
		fd = next
		if comps, err = appendStat(comps, fd, cur); err != nil {
			_ = unix.Close(fd)
			return nil, -1, err
		}
	}
	return comps, fd, nil // fd == parent dir, retained for the caller
}

func appendStat(comps []component, fd int, name string) ([]component, error) {
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return nil, fmt.Errorf("fstat %s: %w", name, err)
	}
	return append(comps, component{name: name, uid: st.Uid, mode: os.FileMode(st.Mode).Perm()}), nil
}

func splitAbs(p string) []string {
	var parts []string
	for _, s := range strings.Split(p, "/") {
		if s != "" {
			parts = append(parts, s)
		}
	}
	return parts
}
```

- [ ] **Step 5: Tidy + assert the floor, then run — expect PASS.** `ancestry_linux.go` now imports `x/sys/unix`; `go mod tidy` walks all build-tag/platform combos (so it sees the `//go:build linux` import even from the macOS host) and keeps the require. Pure tests on macOS, then the full package (incl. the `//go:build linux` walk test) in a container:

```bash
cd cli && go mod tidy
grep -qE '^go 1\.24(\.[0-9]+)?$' go.mod || { echo "FAIL: go directive bumped off the 1.24 floor"; exit 1; }
go test ./internal/selfupdate/ -run 'Ancestry|GuardTarget' -v && go vet ./internal/selfupdate/
```
Then (Linux, exercises `TestWalkAncestry_Smoke`): `docker run --rm -v "$(git rev-parse --show-toplevel)":/w -w /w/cli golang:1.24 go test ./internal/selfupdate/...`
Expected: `go.mod` still pins `golang.org/x/sys v0.41.0`, the `go 1.24` directive is unchanged, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/selfupdate/ancestry.go cli/internal/selfupdate/ancestry_test.go cli/internal/selfupdate/ancestry_linux.go cli/internal/selfupdate/ancestry_linux_test.go cli/go.mod cli/go.sum
git commit -m "feat(cli): selfupdate ancestry guard (pure decision fn + fd-relative walk)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: TOCTOU-safe staged swap (identity, flock, stage, exec-assert, durable rename)

Spec: §4.2 steps 1/4b/7/8, §5.2, §5.3, §6.3. Capture the running-image identity from `/proc/self/exe`; take a non-blocking flock on the parent-dir fd; re-check the target under the lock; stage the new binary in an `O_EXCL` temp; exec its `version --short` via an inherited fd; `renameat` + `fsync(dir)` in durable order with the two post-rename branches. Mutation ops and the staged-version exec are seamed so every branch except the real running-binary swap is hermetically unit-testable (the real exec + swap is integration — Task 13).

**Files:**
- Create: `cli/internal/selfupdate/swap.go` (`//go:build linux`), `cli/internal/selfupdate/swap_linux_test.go` (`//go:build linux`)

**Interfaces:** (all `//go:build linux`)
- Produces:
  - `func captureRunningImage() (dev, ino uint64, err error)`
  - `func acquireMutationLock(parentFD int) error` (→ `errLockContended`)
  - `func releaseMutationLock(parentFD int)` — explicit `flock(LOCK_UN)` on the normal path (correction 6); the parent-dir fd's `O_CLOEXEC` is the crash backstop.
  - `func recheckRunningIdentity(parentFD int, targetName string, wantDev, wantIno uint64) error` (→ `errBinaryChanged`)
  - `func stageBinary(parentFD int, data []byte) (tempName string, err error)`
  - `var stagedVersion func(parentFD int, tempName string) (string, error)` (exec seam)
  - `func commitSwap(parentFD int, tempName, targetName string) error` (→ `*durabilityUncertainError`)
  - `func cleanupTemp(parentFD int, tempName string) error`
  - `var errLockContended, errBinaryChanged error`

- [ ] **Step 1: Write the failing tests** — `cli/internal/selfupdate/swap_linux_test.go`:

```go
//go:build linux

package selfupdate

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func openDir(t *testing.T, dir string) int {
	t.Helper()
	fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = unix.Close(fd) })
	return fd
}

func TestCaptureRunningImage(t *testing.T) {
	dev, ino, err := captureRunningImage()
	if err != nil || ino == 0 {
		t.Fatalf("dev=%d ino=%d err=%v", dev, ino, err)
	}
}

func TestAcquireMutationLock_Contended(t *testing.T) {
	dir := t.TempDir()
	if err := acquireMutationLock(openDir(t, dir)); err != nil {
		t.Fatalf("first lock: %v", err)
	}
	if err := acquireMutationLock(openDir(t, dir)); !errors.Is(err, errLockContended) {
		t.Fatalf("second (separate OFD) lock must be contended: %v", err)
	}
}

func TestReleaseMutationLock_FreesForNextOFD(t *testing.T) {
	dir := t.TempDir()
	fd1 := openDir(t, dir)
	if err := acquireMutationLock(fd1); err != nil {
		t.Fatalf("first lock: %v", err)
	}
	releaseMutationLock(fd1) // explicit LOCK_UN (correction 6) — not the fd close
	// A separate open-file description must now be able to take the lock.
	if err := acquireMutationLock(openDir(t, dir)); err != nil {
		t.Fatalf("after explicit release, a fresh-OFD lock must succeed: %v", err)
	}
}

func TestCappedBuffer(t *testing.T) {
	under := &cappedBuffer{cap: 8}
	if n, _ := under.Write([]byte("abc")); n != 3 || under.overflow || under.String() != "abc" {
		t.Fatalf("under-cap: n=%d overflow=%v s=%q", n, under.overflow, under.String())
	}
	over := &cappedBuffer{cap: 4}
	if n, _ := over.Write([]byte("abcdefgh")); n != 8 || !over.overflow || over.String() != "abcd" {
		t.Fatalf("over-cap must report full write, flag overflow, keep only cap bytes: n=%d overflow=%v s=%q", n, over.overflow, over.String())
	}
}

func TestRecheckRunningIdentity(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mathion")
	if err := os.WriteFile(path, []byte("v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	dfd := openDir(t, dir)
	var st unix.Stat_t
	if err := unix.Fstatat(dfd, "mathion", &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		t.Fatal(err)
	}
	dev, ino := uint64(st.Dev), uint64(st.Ino)

	if err := recheckRunningIdentity(dfd, "mathion", dev, ino); err != nil {
		t.Fatalf("unchanged target must pass: %v", err)
	}
	// replace with a NEW inode (rename-over) -> must be detected.
	np := filepath.Join(dir, "new")
	if err := os.WriteFile(np, []byte("v2"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(np, path); err != nil {
		t.Fatal(err)
	}
	if err := recheckRunningIdentity(dfd, "mathion", dev, ino); !errors.Is(err, errBinaryChanged) {
		t.Fatalf("replaced target must be detected: %v", err)
	}
}

func TestStageAndCommit_HappyPath(t *testing.T) {
	dir := t.TempDir()
	dfd := openDir(t, dir)
	payload := []byte("#!/bin/true\n")
	name, err := stageBinary(dfd, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := commitSwap(dfd, name, "mathion"); err != nil {
		t.Fatalf("commit: %v", err)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "mathion"))
	if !bytes.Equal(got, payload) {
		t.Fatalf("content = %q", got)
	}
	if fi, _ := os.Stat(filepath.Join(dir, "mathion")); fi.Mode().Perm() != 0o755 {
		t.Fatalf("mode = %o", fi.Mode().Perm())
	}
}

func TestCommitSwap_PostRenameBranches(t *testing.T) {
	origR, origF := fsRenameat, fsFsync
	t.Cleanup(func() { fsRenameat, fsFsync = origR, origF })
	var due *durabilityUncertainError

	// renameat fails -> plain error, target unchanged (NOT durability-uncertain).
	fsRenameat = func(int, string, int, string) error { return errors.New("rename boom") }
	if err := commitSwap(-1, "tmp", "mathion"); err == nil || errors.As(err, &due) {
		t.Fatalf("renameat failure must be a plain error: %v", err)
	}
	// renameat OK, fsync(dir) fails -> dedicated durability-uncertain error.
	fsRenameat = func(int, string, int, string) error { return nil }
	fsFsync = func(int) error { return errors.New("fsync boom") }
	if err := commitSwap(-1, "tmp", "mathion"); !errors.As(err, &due) {
		t.Fatalf("post-rename fsync failure must be durabilityUncertainError: %v", err)
	}
}
```

- [ ] **Step 2: Run — expect FAIL** (undefined symbols). These are `//go:build linux` tests, so run them in a Linux container (natively on macOS they compile out and report "no tests to run", which is NOT the failing state you want to see):

Run: `docker run --rm -v "$(git rev-parse --show-toplevel)":/w -w /w/cli golang:1.24 go test ./internal/selfupdate/ -run 'Capture|Acquire|Release|Recheck|StageAndCommit|CommitSwap|CappedBuffer' -v`
Expected: FAIL (build: undefined `captureRunningImage`, `acquireMutationLock`, …).

- [ ] **Step 3: Implement** — `cli/internal/selfupdate/swap.go`:

```go
//go:build linux

package selfupdate

import (
	"bytes"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// Mutation-op seams so unit tests can drive the post-rename failure branches (§3.2).
var (
	fsRenameat = unix.Renameat
	fsFsync    = unix.Fsync
	fsUnlinkat = unix.Unlinkat
)

// Staged-exec bounds (§4.2 step 7, §6.4). Package VARS, not consts, so the integration
// build (Task 13, mathion_selfupdate_test tag only) can inject a longer deadline from
// env to park the updater for §9.2 leg (ii); the shipped release lacks that tag and
// uses these defaults. An honest `version --short` prints ~one short line in
// milliseconds, so these are orders of magnitude over the honest case yet finite —
// a hung, output-flooding, or fork-and-orphan staged binary cannot pin the flock.
var (
	stagedExecTimeout   = 30 * time.Second
	stagedExecOutputCap = int64(64 << 10) // 64 KiB
	stagedExecWaitDelay = 2 * time.Second // force-close inherited pipes so Wait can't hang on a forked pipe-holder
)

var (
	errLockContended = errors.New("another self-update is in progress; retry shortly")
	errBinaryChanged = errors.New("the binary was updated by another process; rerun to update from the new version")
)

// durabilityUncertainError is the ONE post-mutation failure: the rename committed
// but the directory fsync failed, so the new binary IS installed but its
// crash-durability is uncertain. No rollback; never claim "nothing changed". §5.3.
type durabilityUncertainError struct{ err error }

func (e *durabilityUncertainError) Error() string {
	return fmt.Sprintf("the new binary is INSTALLED but its crash-durability is uncertain (directory fsync failed: %v); do NOT assume nothing changed and do NOT roll back", e.err)
}
func (e *durabilityUncertainError) Unwrap() error { return e.err }

// captureRunningImage returns the device+inode of the EXECUTING image via
// /proc/self/exe (O_PATH), which resolves to the running inode even after the path
// is renamed over — the correct anti-downgrade anchor (NOT a pathname re-stat). §4.2 step1.
func captureRunningImage() (dev, ino uint64, err error) {
	fd, err := unix.Open("/proc/self/exe", unix.O_PATH|unix.O_CLOEXEC, 0)
	if err != nil {
		return 0, 0, fmt.Errorf("open /proc/self/exe: %w", err)
	}
	defer unix.Close(fd)
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return 0, 0, fmt.Errorf("fstat /proc/self/exe: %w", err)
	}
	return uint64(st.Dev), uint64(st.Ino), nil
}

// acquireMutationLock takes a non-blocking exclusive flock on the retained
// parent-dir fd (must be a normal fd, not O_PATH). §4.2 step4b.
func acquireMutationLock(parentFD int) error {
	if err := unix.Flock(parentFD, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		if errors.Is(err, unix.EWOULDBLOCK) {
			return errLockContended
		}
		return fmt.Errorf("flock parent dir: %w", err)
	}
	return nil
}

// releaseMutationLock explicitly drops the flock on the normal path (§4.2 step 4b,
// correction 6). Closing the O_CLOEXEC parent-dir fd would also release it — that is
// the crash/abnormal-exit backstop — but an EXPLICIT LOCK_UN at a known point is what
// §9.2 leg (i) asserts (orderly release), and it frees the lock before the fd's other
// teardown. Never called before commitSwap's fsync completes (the lock is held through
// step 8). Best-effort: a failed unlock still releases on the subsequent close.
func releaseMutationLock(parentFD int) {
	_ = unix.Flock(parentFD, unix.LOCK_UN)
}

// recheckRunningIdentity re-opens the target fd-relative and requires its dev+inode
// still equals the running-image identity captured in step 1; a mismatch means a
// concurrent self-update swapped it. §4.2 step4b.
func recheckRunningIdentity(parentFD int, targetName string, wantDev, wantIno uint64) error {
	fd, err := unix.Openat(parentFD, targetName, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return fmt.Errorf("reopen target under lock: %w", err)
	}
	defer unix.Close(fd)
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return fmt.Errorf("fstat target under lock: %w", err)
	}
	if uint64(st.Dev) != wantDev || uint64(st.Ino) != wantIno {
		return errBinaryChanged
	}
	return nil
}

// stageBinary writes data to a randomly-named O_EXCL temp fd-relative off parentFD,
// fchmods 0755, fsyncs, and CLOSES the writable fd (so a later self-exec can't hit
// ETXTBSY). On any error it attempts to unlink the temp. §4.2 step7, §5.3.
func stageBinary(parentFD int, data []byte) (string, error) {
	name, err := randTempName()
	if err != nil {
		return "", err
	}
	fd, err := unix.Openat(parentFD, name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_CLOEXEC, 0o755)
	if err != nil {
		return "", fmt.Errorf("create staged temp: %w", err)
	}
	f := os.NewFile(uintptr(fd), name)
	fail := func(op string, e error) (string, error) {
		_ = f.Close()
		_ = fsUnlinkat(parentFD, name, 0)
		return "", fmt.Errorf("%s staged temp: %w", op, e)
	}
	if _, err := f.Write(data); err != nil {
		return fail("write", err)
	}
	if err := f.Chmod(0o755); err != nil { // O_CREAT mode is umask'd; force 0755
		return fail("chmod", err)
	}
	if err := f.Sync(); err != nil { // fsync BEFORE close -> bytes durable
		return fail("fsync", err)
	}
	if err := f.Close(); err != nil { // close writable fd -> no ETXTBSY on exec
		_ = fsUnlinkat(parentFD, name, 0)
		return "", fmt.Errorf("close staged temp: %w", err)
	}
	return name, nil
}

// cappedBuffer accumulates up to cap bytes and flags overflow; bytes past the cap are
// discarded, and Write NEVER errors (so os/exec's copy goroutine keeps draining the
// pipe and the child cannot block on a full pipe). This bounds MEMORY; the deadline,
// not the cap, bounds LIVENESS. Read only after Cmd.Wait returns (which synchronizes
// the copy goroutines), so the fields need no locking.
type cappedBuffer struct {
	cap      int64
	buf      bytes.Buffer
	overflow bool
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if room := c.cap - int64(c.buf.Len()); room > 0 {
		if int64(len(p)) > room {
			c.buf.Write(p[:room])
			c.overflow = true
		} else {
			c.buf.Write(p)
		}
	} else if len(p) > 0 {
		c.overflow = true
	}
	return len(p), nil // report full acceptance so io.Copy keeps draining
}

func (c *cappedBuffer) String() string { return c.buf.String() }

// stagedVersion runs the staged binary's `version --short` through an INHERITED fd
// (never by pathname, which would re-resolve ancestors). This runs while the mutation
// flock is held (§6.4), so the exec is BOUNDED and FORK-SAFE:
//   - the exec fd is handed over ONLY via Cmd.ExtraFiles (fd 3 in the child →
//     /proc/self/fd/3, an fexecve-equivalent); every other fd — the flock-bearing
//     parent-dir fd included — stays O_CLOEXEC and is NOT inherited, so no forked
//     descendant can retain the mutation lock (correction 6);
//   - the staged binary runs in its OWN process group (Setpgid); on deadline or output
//     overrun the WHOLE group is SIGKILLed (kill(-pgid)), so a child the binary forked
//     cannot survive;
//   - a nonzero Cmd.WaitDelay force-closes the inherited stdout/stderr pipe ends so Wait
//     returns even if a grandchild double-forked (setsid) out of the group still holding
//     a write end — a plain Cmd.Wait reaps only the direct child and would block forever.
//
// Seam: a unit test substitutes the whole var to cover only the compare/abort branch
// (§3.2); the real bounded/fork-safe exec is exercised in integration (§9.2). §4.2 step7.
var stagedVersion = func(parentFD int, tempName string) (string, error) {
	rofd, err := unix.Openat(parentFD, tempName, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return "", fmt.Errorf("open staged binary: %w", err)
	}
	f := os.NewFile(uintptr(rofd), tempName)
	defer f.Close()

	cmd := exec.Command("/proc/self/fd/3", "version", "--short")
	cmd.ExtraFiles = []*os.File{f}                          // → fd 3 in the child
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}  // own process group (pgid == pid)
	cmd.WaitDelay = stagedExecWaitDelay                    // force-close inherited pipes if a grandchild holds them
	out := &cappedBuffer{cap: stagedExecOutputCap}
	errOut := &cappedBuffer{cap: stagedExecOutputCap}
	cmd.Stdout, cmd.Stderr = out, errOut

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start staged version --short: %w", err)
	}
	pgid := cmd.Process.Pid // Setpgid makes the child a group leader: pgid == pid
	killGroup := func() { _ = unix.Kill(-pgid, unix.SIGKILL) }
	defer killGroup() // final sweep of any non-setsid group straggler on every return path

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	timer := time.NewTimer(stagedExecTimeout)
	defer timer.Stop()

	select {
	case werr := <-done:
		if werr != nil {
			return "", fmt.Errorf("exec staged version --short: %w (stderr: %s)", werr, strings.TrimSpace(errOut.String()))
		}
	case <-timer.C:
		killGroup()
		<-done // Wait returns after WaitDelay force-closes the inherited pipes
		return "", fmt.Errorf("staged version --short exceeded the %s exec deadline", stagedExecTimeout)
	}
	if out.overflow || errOut.overflow {
		return "", fmt.Errorf("staged version --short exceeded the %d-byte output cap", stagedExecOutputCap)
	}
	return strings.TrimSpace(out.String()), nil
}

// commitSwap atomically renames the staged temp over the target then fsyncs the
// directory. renameat fail -> target unchanged (plain error). renameat OK +
// fsync(dir) fail -> durabilityUncertainError (no rollback). §4.2 step8, §5.3.
func commitSwap(parentFD int, tempName, targetName string) error {
	if err := fsRenameat(parentFD, tempName, parentFD, targetName); err != nil {
		return fmt.Errorf("rename staged binary into place: %w", err)
	}
	if err := fsFsync(parentFD); err != nil {
		return &durabilityUncertainError{err: err}
	}
	return nil
}

// cleanupTemp attempts to unlink a staged temp, returning any failure to report.
func cleanupTemp(parentFD int, tempName string) error {
	if err := fsUnlinkat(parentFD, tempName, 0); err != nil && !errors.Is(err, unix.ENOENT) {
		return fmt.Errorf("cleanup staged temp %s: %w", tempName, err)
	}
	return nil
}

func randTempName() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("random temp name: %w", err)
	}
	return fmt.Sprintf(".mathion-selfupdate-%x.tmp", b), nil
}
```

- [ ] **Step 4: Run — expect PASS** (Linux container — these are `//go:build linux` tests)

Run: `docker run --rm -v "$(git rev-parse --show-toplevel)":/w -w /w/cli golang:1.24 sh -c 'go test ./internal/selfupdate/ -v && go vet ./internal/selfupdate/'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/selfupdate/swap.go cli/internal/selfupdate/swap_linux_test.go
git commit -m "feat(cli): selfupdate TOCTOU-safe staged swap (identity, flock, durable rename)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: verify-until-verifiable selection + bounded archive download + extraction

Spec: §4.2 step 5 & step 7, §6.2 (top-N bound), §6.4 (caps). Iterate eligible tags descending (bounded by `topN` + `verifyBudget`), selecting the first whose checksums verify (checksums only — no archive yet). Then download the archive under size + idle/overall time bounds, sha256-match, and extract exactly one regular file named `mathion`.

**Files:**
- Create: `cli/internal/selfupdate/artifact.go`, `cli/internal/selfupdate/artifact_test.go`

**Interfaces:**
- Consumes: `getLimited` (T2), `config` (T3), `verifyChecksums`/`checksumFor` (T4).
- Produces:
  - `func archiveName() string` (`mathion_linux_<GOARCH>.tar.gz`)
  - `func selectRelease(ctx context.Context, cfg config, keyring openpgp.EntityList, tags []string) (tag, expectedSHA string, err error)`
  - `func downloadArchive(ctx context.Context, cfg config, tag, expectedSHA string) ([]byte, error)`
  - `func extractSingleBinary(targz []byte, capExtracted int64) ([]byte, error)`

- [ ] **Step 1: Write the failing tests** — `cli/internal/selfupdate/artifact_test.go` (reuses `newSigner`/`armoredSig` from `verify_test.go`):

```go
package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func tgz(t *testing.T, members map[string]tarMember) []byte {
	t.Helper()
	var raw bytes.Buffer
	gz := gzip.NewWriter(&raw)
	tw := tar.NewWriter(gz)
	for name, m := range members {
		hdr := &tar.Header{Name: name, Typeflag: m.typ, Mode: 0o755, Size: int64(len(m.body))}
		if m.typ == tar.TypeSymlink {
			hdr.Linkname = "x"
		}
		tw.WriteHeader(hdr)
		if m.typ == tar.TypeReg {
			tw.Write(m.body)
		}
	}
	tw.Close()
	gz.Close()
	return raw.Bytes()
}

type tarMember struct {
	typ  byte
	body []byte
}

func TestExtractSingleBinary(t *testing.T) {
	ok := tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("ELF...")}})
	if got, err := extractSingleBinary(ok, 1<<20); err != nil || string(got) != "ELF..." {
		t.Fatalf("single binary: got %q err %v", got, err)
	}
	for name, arc := range map[string][]byte{
		"extra member":   tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("a")}, "README": {tar.TypeReg, []byte("b")}}),
		"symlink member": tgz(t, map[string]tarMember{"mathion": {tar.TypeSymlink, nil}}),
		"dir member":     tgz(t, map[string]tarMember{"mathion": {tar.TypeDir, nil}}),
		"wrong name":     tgz(t, map[string]tarMember{"notmathion": {tar.TypeReg, []byte("a")}}),
		"traversal":      tgz(t, map[string]tarMember{"../mathion": {tar.TypeReg, []byte("a")}}),
	} {
		if _, err := extractSingleBinary(arc, 1<<20); err == nil {
			t.Errorf("%s must be rejected", name)
		}
	}
	if _, err := extractSingleBinary(ok, 2); err == nil {
		t.Error("over-size extraction must be rejected")
	}
}

func TestSelectRelease_FirstVerifiableDescending(t *testing.T) {
	relEntity, relKR := newSigner(t)
	aptEntity, _ := newSigner(t) // foreign — signs the higher tag, which must be SKIPPED
	asset := archiveName()
	sums := []byte(fmt.Sprintf("deadbeef  %s\n", asset))

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// URLs: /<tag>/checksums.txt[.asc]
		switch r.URL.Path {
		case "/cli-v0.4.0/checksums.txt", "/cli-v0.3.0/checksums.txt":
			w.Write(sums)
		case "/cli-v0.4.0/checksums.txt.asc":
			w.Write(armoredSig(t, aptEntity, sums)) // unverifiable (foreign key)
		case "/cli-v0.3.0/checksums.txt.asc":
			w.Write(armoredSig(t, relEntity, sums)) // verifiable
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	cfg := config{dlBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5),
		perReqTO: time.Second, capChecksums: 1 << 20, capAsc: 1 << 20,
		verifyBudget: 5 * time.Second, topN: 16}

	tag, sha, err := selectRelease(context.Background(), cfg, relKR, []string{"cli-v0.4.0", "cli-v0.3.0"})
	if err != nil || tag != "cli-v0.3.0" || sha != "deadbeef" {
		t.Fatalf("expected to skip unverifiable 0.4.0 and select 0.3.0: tag=%q sha=%q err=%v", tag, sha, err)
	}

	// topN=1 tries only the unverifiable top -> bound hit, no selection.
	cfg.topN = 1
	if _, _, err := selectRelease(context.Background(), cfg, relKR, []string{"cli-v0.4.0", "cli-v0.3.0"}); err == nil {
		t.Fatal("bounded loop with only an unverifiable top candidate must error")
	}
}

func TestDownloadArchive_SHAMismatch(t *testing.T) {
	payload := tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("bin")}})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	defer srv.Close()
	cfg := config{dlBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5),
		capArchive: 1 << 20, capExtracted: 1 << 20, archiveIdleTO: time.Second, archiveOverallTO: 5 * time.Second}

	good := sha256.Sum256(payload)
	if _, err := downloadArchive(context.Background(), cfg, "cli-v0.3.0", hex.EncodeToString(good[:])); err != nil {
		t.Fatalf("matching sha must succeed: %v", err)
	}
	if _, err := downloadArchive(context.Background(), cfg, "cli-v0.3.0", "00"); err == nil {
		t.Fatal("sha mismatch must abort")
	}
}

// §9.1 "bounded downloads": the archive path (getArchive/readIdleBounded) has its
// own size cap + idle/stall + overall-deadline bounds, separate from getLimited.
// All three abort promptly under tiny injected bounds (empirically verified).
func TestGetArchive_SizeCapAborts(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(make([]byte, 1000))
	}))
	defer srv.Close()
	cfg := config{client: newHTTPClient(srv.Client().Transport, 5), capArchive: 100,
		archiveIdleTO: time.Second, archiveOverallTO: 5 * time.Second}
	if _, err := getArchive(context.Background(), cfg, srv.URL+"/a.tgz"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("over-cap archive must abort with a size error, got %v", err)
	}
}

func TestGetArchive_IdleStallAborts(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte{'x'})
		w.(http.Flusher).Flush()
		<-release // stall indefinitely after the first byte
	}))
	// Defers run LIFO: srv.Close() (registered first) runs LAST, so close(release)
	// (registered last) runs FIRST and unblocks the handler before Close() waits on it.
	// The reverse order deadlocks (httptest.Server.Close waits for the stuck handler).
	defer srv.Close()
	defer close(release)
	cfg := config{client: newHTTPClient(srv.Client().Transport, 5), capArchive: 1 << 20,
		archiveIdleTO: 100 * time.Millisecond, archiveOverallTO: 10 * time.Second}
	start := time.Now()
	if _, err := getArchive(context.Background(), cfg, srv.URL+"/a.tgz"); err == nil {
		t.Fatal("an idle-stalled archive must abort")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("idle abort took %v — the overall deadline fired, not the idle timer", d)
	}
}

func TestGetArchive_OverallDeadlineAborts(t *testing.T) {
	stop := make(chan struct{})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fl := w.(http.Flusher)
		for {
			select {
			case <-stop:
				return
			default:
			}
			w.Write([]byte{'x'})
			fl.Flush()
			time.Sleep(30 * time.Millisecond) // always progressing (< idle) but never EOF
		}
	}))
	// LIFO: srv.Close() runs last; close(stop) runs first to end the handler loop.
	defer srv.Close()
	defer close(stop)
	cfg := config{client: newHTTPClient(srv.Client().Transport, 5), capArchive: 1 << 30,
		archiveIdleTO: 500 * time.Millisecond, archiveOverallTO: 300 * time.Millisecond}
	start := time.Now()
	if _, err := getArchive(context.Background(), cfg, srv.URL+"/a.tgz"); err == nil {
		t.Fatal("a slow-drip archive must hit the overall deadline")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("overall abort took too long: %v", d)
	}
}

// §9.1: the injected (small) verify-loop wall-clock budget aborts a slow origin.
func TestSelectRelease_BudgetAborts(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		fmt.Fprint(w, "deadbeef  "+archiveName()+"\n")
	}))
	defer srv.Close()
	_, relKR := newSigner(t)
	cfg := config{dlBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5), perReqTO: 5 * time.Second,
		capChecksums: 1 << 20, capAsc: 1 << 20, verifyBudget: 100 * time.Millisecond, topN: 16}
	if _, _, err := selectRelease(context.Background(), cfg, relKR, []string{"cli-v0.9.0", "cli-v0.8.0", "cli-v0.7.0"}); err == nil {
		t.Fatal("a slow origin must exhaust the verify budget")
	}
}

// §9.1 crossing-invariant boundary: candidate 16 (index 15) is reached, candidate
// 17 (index 16) is not, at topN=16. Only `verifiableTag` carries a real signature.
func TestSelectRelease_CrossingBoundary(t *testing.T) {
	relEntity, relKR := newSigner(t)
	aptEntity, _ := newSigner(t)
	sums := []byte(fmt.Sprintf("deadbeef  %s\n", archiveName()))
	newServer := func(verifiableTag string) *httptest.Server {
		return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case strings.HasSuffix(r.URL.Path, "/checksums.txt"):
				w.Write(sums)
			case strings.HasSuffix(r.URL.Path, "/checksums.txt.asc"):
				if strings.Contains(r.URL.Path, verifiableTag+"/") {
					w.Write(armoredSig(t, relEntity, sums))
				} else {
					w.Write(armoredSig(t, aptEntity, sums)) // unverifiable
				}
			default:
				w.WriteHeader(404)
			}
		}))
	}
	var tags []string
	for i := 20; i >= 1; i-- {
		tags = append(tags, fmt.Sprintf("cli-v0.%d.0", i))
	}
	at16, at17 := tags[15], tags[16]

	s16 := newServer(at16)
	defer s16.Close()
	cfg := config{dlBase: s16.URL, client: newHTTPClient(s16.Client().Transport, 5), perReqTO: 2 * time.Second,
		capChecksums: 1 << 20, capAsc: 1 << 20, verifyBudget: 10 * time.Second, topN: 16}
	if tag, _, err := selectRelease(context.Background(), cfg, relKR, tags); err != nil || tag != at16 {
		t.Fatalf("candidate 16 must be reached: tag=%q err=%v", tag, err)
	}

	s17 := newServer(at17)
	defer s17.Close()
	cfg.dlBase, cfg.client = s17.URL, newHTTPClient(s17.Client().Transport, 5)
	if tag, _, err := selectRelease(context.Background(), cfg, relKR, tags); err == nil {
		t.Fatalf("candidate 17 must NOT be reached at topN=16, but selected %q", tag)
	}
}
```

- [ ] **Step 2: Run — expect FAIL** (undefined symbols)

Run: `cd cli && go test ./internal/selfupdate/ -run 'Extract|SelectRelease|DownloadArchive' -v`
Expected: FAIL.

- [ ] **Step 3: Implement** — `cli/internal/selfupdate/artifact.go`:

```go
package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"runtime"
	"time"

	"github.com/ProtonMail/go-crypto/openpgp"
)

func archiveName() string  { return fmt.Sprintf("mathion_linux_%s.tar.gz", runtime.GOARCH) }
func checksumsURL(cfg config, tag string) string {
	return fmt.Sprintf("%s/%s/checksums.txt", cfg.dlBase, tag)
}
func archiveURL(cfg config, tag string) string {
	return fmt.Sprintf("%s/%s/%s", cfg.dlBase, tag, archiveName())
}

// selectRelease iterates tags DESCENDING, bounded to cfg.topN candidates and
// cfg.verifyBudget wall-clock, returning the first tag whose checksums verify
// against keyring plus the expected archive sha256. Checksums only — no archive.
// §4.2 step 5, §6.2.
func selectRelease(ctx context.Context, cfg config, keyring openpgp.EntityList, tags []string) (string, string, error) {
	loopCtx, cancel := context.WithTimeout(ctx, cfg.verifyBudget)
	defer cancel()
	asset := archiveName()
	limit := cfg.topN
	if len(tags) < limit {
		limit = len(tags)
	}
	for i := 0; i < limit; i++ {
		if loopCtx.Err() != nil {
			return "", "", errors.New("no verifiable newer release within the time budget")
		}
		tag := tags[i]
		sums, _, err := getLimited(loopCtx, cfg.client, checksumsURL(cfg, tag), cfg.capChecksums, cfg.perReqTO)
		if err != nil {
			continue
		}
		asc, _, err := getLimited(loopCtx, cfg.client, checksumsURL(cfg, tag)+".asc", cfg.capAsc, cfg.perReqTO)
		if err != nil {
			continue
		}
		if err := verifyChecksums(keyring, sums, asc); err != nil {
			continue // try the next-lower candidate
		}
		sha, err := checksumFor(sums, asset)
		if err != nil {
			return "", "", err // verified but malformed checksums -> hard error
		}
		return tag, sha, nil
	}
	return "", "", errors.New("no verifiable newer release within the attempt bound")
}

// downloadArchive fetches the archive under size + idle/overall time bounds, checks
// its sha256, and extracts the single mathion binary. §4.2 step 7, §6.4.
func downloadArchive(ctx context.Context, cfg config, tag, expectedSHA string) ([]byte, error) {
	raw, err := getArchive(ctx, cfg, archiveURL(cfg, tag))
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expectedSHA {
		return nil, fmt.Errorf("archive sha256 mismatch for %s", tag)
	}
	return extractSingleBinary(raw, cfg.capExtracted)
}

// getArchive GETs url with an OVERALL deadline plus an idle/stall timeout (so a
// slowloris origin cannot hang the process while holding the flock — §6.4).
func getArchive(ctx context.Context, cfg config, url string) ([]byte, error) {
	octx, cancel := context.WithTimeout(ctx, cfg.archiveOverallTO)
	defer cancel()
	req, err := http.NewRequestWithContext(octx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := cfg.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}
	return readIdleBounded(resp.Body, cfg.capArchive, cfg.archiveIdleTO, cancel)
}

// readIdleBounded reads up to capBytes, resetting an idle timer on each chunk of
// progress; if the timer fires (no progress within idleTO) it cancels the request
// context so the next Read errors out.
func readIdleBounded(r io.Reader, capBytes int64, idleTO time.Duration, cancel context.CancelFunc) ([]byte, error) {
	var buf bytes.Buffer
	chunk := make([]byte, 32*1024)
	timer := time.AfterFunc(idleTO, cancel)
	defer timer.Stop()
	for {
		n, err := r.Read(chunk)
		if n > 0 {
			timer.Reset(idleTO)
			if int64(buf.Len())+int64(n) > capBytes {
				return nil, fmt.Errorf("archive exceeds %d bytes", capBytes)
			}
			buf.Write(chunk[:n])
		}
		if err == io.EOF {
			return buf.Bytes(), nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// extractSingleBinary accepts EXACTLY ONE regular file named "mathion" (rejecting
// symlinks, hardlinks, dirs, devices, extra members, traversal) bounded by
// capExtracted. §4.2 step 7.
func extractSingleBinary(targz []byte, capExtracted int64) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(targz))
	if err != nil {
		return nil, fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var found []byte
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("tar: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			return nil, fmt.Errorf("archive member %q is not a regular file", hdr.Name)
		}
		if filepath.Clean(hdr.Name) != "mathion" {
			return nil, fmt.Errorf("unexpected archive member %q (want mathion)", hdr.Name)
		}
		if found != nil {
			return nil, errors.New("archive has more than one member")
		}
		data, err := io.ReadAll(io.LimitReader(tr, capExtracted+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > capExtracted {
			return nil, fmt.Errorf("extracted binary exceeds %d bytes", capExtracted)
		}
		found = data
	}
	if found == nil {
		return nil, errors.New("archive contains no mathion binary")
	}
	return found, nil
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd cli && go test ./internal/selfupdate/ -v && go vet ./internal/selfupdate/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/selfupdate/artifact.go cli/internal/selfupdate/artifact_test.go
git commit -m "feat(cli): selfupdate verify-until-verifiable select + bounded archive fetch/extract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: orchestrator (`Run`/`Check`), confirm, exit outcomes, default endpoints

Spec: §4.2 (all steps), §4.3 (`--check`), §3.1 (exit outcomes). Sequences steps 1–8: apt-defer exits before root; `--check` runs 1–3 + 4a + the checksums-only select, no root/archive/swap; the real path runs 4b (root + flock + identity recheck) → select → confirm → download+stage+assert → swap. The flock is held (parent-dir fd) from 4b through the swap.

**Files:**
- Create: `cli/internal/selfupdate/selfupdate.go` (untagged API), `cli/internal/selfupdate/endpoints_default.go` (`//go:build !mathion_selfupdate_test`), `cli/internal/selfupdate/run_linux.go` (`//go:build linux`), `cli/internal/selfupdate/run_other.go` (`//go:build !linux`), `cli/internal/selfupdate/run_linux_test.go` (`//go:build linux`)

**Interfaces:**
- Produces (untagged, `selfupdate.go`):
  - `type Params struct { Out, Err io.Writer; In io.Reader; Yes, Check bool; Cfg config; CurrentVersion string }`
  - `func DefaultConfig() config` — production endpoints + caps (`swapTarget=/usr/local/bin/mathion`).
- Produces (`//go:build linux`, `run_linux.go`):
  - `func Run(ctx context.Context, p Params) error` — nil on success/no-op/decline; error otherwise (caller maps nil→0, else→1).
  - Seams: `osExecutable`, `evalSymlinks`, `geteuid`, `loadKeyringFn`; plus `captureRunningImageFn` and `walkAncestryFn` (so orchestrator tests neutralize `/proc/self/exe` + the real root-owned-ancestry requirement — a `t.TempDir()` ancestry is world-writable `1777` and would fail `ancestrySafe`); reuses `stagedVersion` (T7).
- Produces (`//go:build !linux`, `run_other.go`):
  - `func Run(ctx context.Context, p Params) error` — stub returning "self-update is supported only on Linux" so macOS/Windows dev builds compile.
- Consumes: every prior task.

- [ ] **Step 1: Write the failing tests** — `cli/internal/selfupdate/run_linux_test.go` (`//go:build linux`; the real staged swap runs, so it needs the Linux `*at` syscalls):

```go
//go:build linux

package selfupdate

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ProtonMail/go-crypto/openpgp"
	"golang.org/x/sys/unix"
)

// harness wires a temp swap-target + a release server + throwaway keys, returning
// Params and a "root called?" flag. The env-coupled guards are seamed:
// captureRunningImageFn returns the temp target's real dev/ino (so the REAL
// recheckRunningIdentity passes when the target is unchanged) and walkAncestryFn
// returns a real fd to the temp dir with SYNTHETIC root-safe components (a real
// t.TempDir ancestry is 1777 world-writable and would fail ancestrySafe).
// stagedVersion is stubbed (real exec is Task 13); the stage+commit swap is REAL.
// The returned *int counts archive-endpoint hits (for the --check no-fetch assert);
// it is race-clean — only the happy path writes it, only the --check test reads it.
func harness(t *testing.T, currentVersion string) (Params, *bool, *int, func()) {
	t.Helper()
	dir := t.TempDir()
	target := filepath.Join(dir, "mathion")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	var tst unix.Stat_t
	if err := unix.Lstat(target, &tst); err != nil {
		t.Fatal(err)
	}
	relEntity, relKR := newSigner(t)
	asset := archiveName()
	bin := tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("newbin")}})
	sum := sha256.Sum256(bin)
	sums := []byte(fmt.Sprintf("%s  %s\n", hex.EncodeToString(sum[:]), asset))
	archiveHits := 0 // declared BEFORE srv so the handler closure can capture it

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/releases":
			fmt.Fprint(w, `[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.2.0"}]`)
		case strings.HasSuffix(r.URL.Path, "/checksums.txt"):
			w.Write(sums)
		case strings.HasSuffix(r.URL.Path, "/checksums.txt.asc"):
			w.Write(armoredSig(t, relEntity, sums))
		case strings.HasSuffix(r.URL.Path, asset):
			archiveHits++
			w.Write(bin)
		default:
			w.WriteHeader(404)
		}
	}))

	rootCalled := false
	oExe, oEval, oGe, oKr, oSv := osExecutable, evalSymlinks, geteuid, loadKeyringFn, stagedVersion
	oCap, oWalk, oDpkg := captureRunningImageFn, walkAncestryFn, dpkgSearch
	osExecutable = func() (string, error) { return target, nil }
	evalSymlinks = func(string) (string, error) { return target, nil }
	geteuid = func() int { rootCalled = true; return 0 }
	loadKeyringFn = func() (openpgp.EntityList, error) { return relKR, nil }
	stagedVersion = func(int, string) (string, error) { return "cli-v0.9.0", nil }
	captureRunningImageFn = func() (uint64, uint64, error) { return uint64(tst.Dev), uint64(tst.Ino), nil }
	walkAncestryFn = func(string) ([]component, int, error) {
		fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
		if err != nil {
			return nil, -1, err
		}
		return []component{{name: "/", uid: 0, mode: 0o755}}, fd, nil
	}
	dpkgSearch = func(context.Context, string) dpkgResult {
		return dpkgResult{stderr: []byte("no path found matching pattern"), exitCode: 1}
	}
	cleanup := func() {
		srv.Close()
		osExecutable, evalSymlinks, geteuid, loadKeyringFn, stagedVersion = oExe, oEval, oGe, oKr, oSv
		captureRunningImageFn, walkAncestryFn, dpkgSearch = oCap, oWalk, oDpkg
	}

	cfg := DefaultConfig()
	cfg.apiBase, cfg.dlBase = srv.URL, srv.URL
	cfg.client = newHTTPClient(srv.Client().Transport, 5)
	cfg.swapTarget = target
	cfg.verifyBudget, cfg.perReqTO = 5*time.Second, 2*time.Second
	cfg.archiveIdleTO, cfg.archiveOverallTO = 2*time.Second, 5*time.Second
	return Params{Out: &bytes.Buffer{}, Err: &bytes.Buffer{}, In: strings.NewReader("y\n"),
		Cfg: cfg, CurrentVersion: currentVersion}, &rootCalled, &archiveHits, cleanup
}

func TestRun_HappyPath_Swaps(t *testing.T) {
	p, _, _, done := harness(t, "cli-v0.2.0")
	defer done()
	p.Yes = true
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("run: %v", err)
	}
	got, _ := os.ReadFile(p.Cfg.swapTarget)
	if string(got) != "newbin" {
		t.Fatalf("target not swapped: %q", got)
	}
	if !strings.Contains(out.String(), "cli-v0.9.0") {
		t.Fatalf("missing old→new line: %q", out.String())
	}
}

func TestRun_Check_NoRootNoArchiveNoSwap(t *testing.T) {
	p, rootCalled, archiveHits, done := harness(t, "cli-v0.2.0")
	defer done()
	p.Check = true
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("check: %v", err)
	}
	if *rootCalled {
		t.Fatal("--check must NOT require root")
	}
	if *archiveHits != 0 {
		t.Fatalf("--check must NOT fetch the archive, but hit it %d time(s)", *archiveHits)
	}
	if got, _ := os.ReadFile(p.Cfg.swapTarget); string(got) != "old" {
		t.Fatal("--check must NOT swap the binary")
	}
	if !strings.Contains(out.String(), "installable") {
		t.Fatalf("--check output: %q", out.String())
	}
}

func TestRun_AptManaged_Defers(t *testing.T) {
	p, rootCalled, _, done := harness(t, "cli-v0.2.0")
	defer done()
	dpkgSearch = func(context.Context, string) dpkgResult {
		return dpkgResult{stdout: []byte("mathion: /usr/bin/mathion\n"), exitCode: 0}
	}
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("apt defer: %v", err)
	}
	if *rootCalled {
		t.Fatal("apt-managed must NOT require root")
	}
	if !strings.Contains(out.String(), "apt install --only-upgrade mathion") {
		t.Fatalf("apt defer output: %q", out.String())
	}
}

func TestRun_Decline_ReturnsNil(t *testing.T) {
	p, _, _, done := harness(t, "cli-v0.2.0")
	defer done()
	p.In = strings.NewReader("n\n")
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("decline must return nil (exit 0): %v", err)
	}
	if got, _ := os.ReadFile(p.Cfg.swapTarget); string(got) != "old" {
		t.Fatal("declined run must NOT swap")
	}
	if !strings.Contains(out.String(), "cancelled") {
		t.Fatalf("decline output: %q", out.String())
	}
}
```

- [ ] **Step 2: Run — expect FAIL** (undefined `Run`, `Params`, `DefaultConfig`, seams). `run_linux_test.go` is `//go:build linux`, so run it in a container:

Run: `docker run --rm -v "$(git rev-parse --show-toplevel)":/w -w /w/cli golang:1.24 go test ./internal/selfupdate/ -run TestRun -v`
Expected: FAIL.

- [ ] **Step 3a: Implement the default endpoints** — `cli/internal/selfupdate/endpoints_default.go`:

```go
//go:build !mathion_selfupdate_test

package selfupdate

// Production endpoints. The paired mathion_selfupdate_test build (Task 13) overrides
// these from env so an integration harness can point a REAL swapped binary at a
// throwaway server; the shipped release must be built WITHOUT that tag (CI-asserted).
func endpointAPIBase() string { return "https://api.github.com/repos/svkucheryavski/mathion" }
func endpointDLBase() string {
	return "https://github.com/svkucheryavski/mathion/releases/download"
}
```

- [ ] **Step 3b: Implement the untagged API** — `cli/internal/selfupdate/selfupdate.go` (compiles on every OS so `cmd` keeps building on macOS):

```go
package selfupdate

import (
	"io"
	"net/http"
	"time"
)

// Params bundles the command's runtime dependencies.
type Params struct {
	Out, Err       io.Writer
	In             io.Reader
	Yes, Check     bool
	Cfg            config
	CurrentVersion string // the baked buildVersion (cli-vX.Y.Z or dev)
}

// DefaultConfig is the production config (real endpoints + §6.4 caps).
func DefaultConfig() config {
	return config{
		apiBase: endpointAPIBase(), dlBase: endpointDLBase(),
		client:   newHTTPClient(http.DefaultTransport, 5),
		perReqTO: 30 * time.Second, pageCap: 10,
		capReleasesPage: 8 << 20, capChecksums: 64 << 10, capAsc: 16 << 10,
		capArchive: 64 << 20, capExtracted: 200 << 20,
		verifyBudget: 120 * time.Second, topN: 16,
		archiveIdleTO: 60 * time.Second, archiveOverallTO: 300 * time.Second,
		swapTarget: "/usr/local/bin/mathion",
	}
}
```

- [ ] **Step 3c: Implement the Linux orchestrator** — `cli/internal/selfupdate/run_linux.go` (`//go:build linux`):

```go
//go:build linux

package selfupdate

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Seams so orchestrator tests stay hermetic. osExecutable/evalSymlinks/geteuid/
// loadKeyringFn cover the environment; captureRunningImageFn/walkAncestryFn let a
// test neutralize /proc/self/exe and the real root-owned-ancestry requirement.
var (
	osExecutable          = os.Executable
	evalSymlinks          = filepath.EvalSymlinks
	geteuid               = os.Geteuid
	loadKeyringFn         = loadKeyring
	captureRunningImageFn = captureRunningImage
	walkAncestryFn        = walkAncestry
)

func ensureRoot() error {
	if geteuid() != 0 {
		return errors.New("requires root; re-run with sudo")
	}
	return nil
}

// Run executes self-update or --check. §4.2 / §4.3.
func Run(ctx context.Context, p Params) error {
	// Step 1: resolve self + capture the RUNNING-IMAGE identity (§4.2 step 1).
	exe, err := osExecutable()
	if err != nil {
		return fmt.Errorf("cannot resolve the running binary (it may have been updated by another process); rerun: %w", err)
	}
	resolved, err := evalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("cannot resolve the running binary (it may have been updated by another process); rerun: %w", err)
	}
	dev, ino, err := captureRunningImageFn()
	if err != nil {
		return err
	}

	// Step 2: channel (§4.2 step 2).
	switch ch, err := detectChannel(ctx, resolved); {
	case err != nil:
		return err
	case ch == channelApt:
		fmt.Fprintln(p.Out, "sudo apt update && sudo apt install --only-upgrade mathion")
		return nil // apt-managed: defer, no root, no swap (also under --check)
	}

	// Step 3: eligible releases + forward-gate (§4.2 step 3).
	rels, err := fetchReleases(ctx, p.Cfg)
	if err != nil {
		return err
	}
	tags := forwardEligible(rels, p.CurrentVersion)
	if len(tags) == 0 {
		fmt.Fprintln(p.Out, "already up to date")
		return nil
	}

	// Step 4a: eligibility guard (read-only, no root) (§4.2 step 4a).
	if err := guardTarget(resolved, p.Cfg.swapTarget); err != nil {
		return err
	}
	comps, parentFD, err := walkAncestryFn(p.Cfg.swapTarget)
	if err != nil {
		return err
	}
	defer func() { _ = closeFD(parentFD) }() // O_CLOEXEC close = crash/abnormal-exit backstop for the flock (correction 6)
	if err := ancestrySafe(comps); err != nil {
		return err
	}

	keyring, err := loadKeyringFn()
	if err != nil {
		return fmt.Errorf("load verifying keyring: %w", err)
	}

	// --check: select via checksums only, report, exit (no root/archive/swap).
	if p.Check {
		tag, _, err := selectRelease(ctx, p.Cfg, keyring, tags)
		if err != nil {
			return err
		}
		fmt.Fprintf(p.Out, "%s installable (current %s)\n", tag, p.CurrentVersion)
		return nil
	}

	// Step 4b: root gate + non-blocking mutation lock + identity recheck (§4.2 step 4b).
	if err := ensureRoot(); err != nil {
		return err
	}
	if err := acquireMutationLock(parentFD); err != nil {
		return err
	}
	// Explicit LOCK_UN on the normal path (correction 6, §4.2 step 4b); the O_CLOEXEC
	// close defer above is the crash backstop. Registered AFTER the close defer, so it
	// runs FIRST (LIFO): unlock, then close. Only registered once the lock is held.
	defer releaseMutationLock(parentFD)
	if err := recheckRunningIdentity(parentFD, filepath.Base(p.Cfg.swapTarget), dev, ino); err != nil {
		return err
	}

	// Step 5: select the release (checksums only) (§4.2 step 5).
	tag, sha, err := selectRelease(ctx, p.Cfg, keyring, tags)
	if err != nil {
		return err
	}

	// Step 6: confirm (§4.2 step 6).
	if !p.Yes {
		fmt.Fprintf(p.Out, "%s → %s\nProceed? [y/N] ", p.CurrentVersion, tag)
		line, _ := bufio.NewReader(p.In).ReadString('\n')
		if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
			fmt.Fprintln(p.Out, "self-update cancelled")
			return nil // exit 0
		}
	}

	// Step 7: download + stage + pre-swap assertion (§4.2 step 7).
	bin, err := downloadArchive(ctx, p.Cfg, tag, sha)
	if err != nil {
		return err
	}
	tempName, err := stageBinary(parentFD, bin)
	if err != nil {
		return err
	}
	staged, err := stagedVersion(parentFD, tempName)
	if err != nil {
		_ = cleanupTemp(parentFD, tempName)
		return err
	}
	if staged != tag {
		_ = cleanupTemp(parentFD, tempName)
		return fmt.Errorf("staged binary reports %q, expected %q; refusing", staged, tag)
	}

	// Step 8: swap (§4.2 step 8).
	if err := commitSwap(parentFD, tempName, filepath.Base(p.Cfg.swapTarget)); err != nil {
		var due *durabilityUncertainError
		if errors.As(err, &due) {
			return err // installed-but-durability-uncertain: no cleanup, no success line
		}
		_ = cleanupTemp(parentFD, tempName) // rename failed -> target unchanged
		return err
	}
	fmt.Fprintf(p.Out, "%s → %s\n", p.CurrentVersion, tag)
	return nil
}
```

- [ ] **Step 3d: Implement the non-Linux stub** — `cli/internal/selfupdate/run_other.go` (`//go:build !linux`):

```go
//go:build !linux

package selfupdate

import (
	"context"
	"errors"
)

// Run is a stub on non-Linux dev hosts so `go build ./...` / `go test ./cmd/`
// compile; the real implementation is Linux-only (run_linux.go). §5.2.
func Run(_ context.Context, _ Params) error {
	return errors.New("self-update is supported only on Linux")
}
```

- [ ] **Step 4: Run — expect PASS.** The untagged split builds on macOS; the orchestrator tests are `//go:build linux`, so exercise them in a container:

Run (macOS, proves the cross-platform build): `cd cli && go build ./... && go vet ./internal/selfupdate/`
Run (Linux, exercises `TestRun*`): `docker run --rm -v "$(git rev-parse --show-toplevel)":/w -w /w/cli golang:1.24 go test ./internal/selfupdate/... -v`
Expected: PASS (all selfupdate unit tests).

- [ ] **Step 5: Commit**

```bash
git add cli/internal/selfupdate/selfupdate.go cli/internal/selfupdate/endpoints_default.go cli/internal/selfupdate/run_linux.go cli/internal/selfupdate/run_other.go cli/internal/selfupdate/run_linux_test.go
git commit -m "feat(cli): selfupdate orchestrator (steps 1-8, --check, confirm, exit outcomes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: command wiring (`self-update`) + root registration

Spec: §3.1. A thin cobra command with `--yes`/`--check`, delegating to `selfupdate.Run`.

**Files:**
- Create: `cli/cmd/self_update.go`, `cli/cmd/self_update_test.go`
- Modify: `cli/cmd/root.go:66-70` (register the command)

**Interfaces:**
- Consumes: `selfupdate.Run`, `selfupdate.Params`, `selfupdate.DefaultConfig` (T9); `*App`, `buildVersion` (root.go).
- Produces: `func newSelfUpdateCmd(app *App) *cobra.Command`.

- [ ] **Step 1: Write the failing tests** — `cli/cmd/self_update_test.go`:

```go
package cmd

import (
	"io"
	"strings"
	"testing"
)

func TestSelfUpdateCmd_FlagsAndUse(t *testing.T) {
	c := newSelfUpdateCmd(&App{Out: io.Discard, Err: io.Discard, In: strings.NewReader("")})
	if c.Use != "self-update" {
		t.Fatalf("use = %q", c.Use)
	}
	if c.Flags().Lookup("yes") == nil || c.Flags().Lookup("check") == nil {
		t.Fatal("expected --yes and --check flags")
	}
}

func TestRootRegistersSelfUpdate(t *testing.T) {
	root := newRootCmd(&App{Out: io.Discard, Err: io.Discard, In: strings.NewReader("")})
	for _, c := range root.Commands() {
		if c.Name() == "self-update" {
			return
		}
	}
	t.Fatal("self-update not registered on root")
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd cli && go test ./cmd/ -run 'SelfUpdate|RootRegistersSelfUpdate' -v`
Expected: FAIL (undefined `newSelfUpdateCmd`).

- [ ] **Step 3a: Implement** — `cli/cmd/self_update.go`:

```go
package cmd

import (
	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/selfupdate"
)

func newSelfUpdateCmd(app *App) *cobra.Command {
	var yes, check bool
	c := &cobra.Command{
		Use:   "self-update",
		Short: "Update the mathion CLI binary (curl|sh installs; apt installs are deferred to apt)",
		RunE: func(c *cobra.Command, _ []string) error {
			return selfupdate.Run(c.Context(), selfupdate.Params{
				Out: app.Out, Err: app.Err, In: app.In,
				Yes: yes, Check: check,
				Cfg:            selfupdate.DefaultConfig(),
				CurrentVersion: buildVersion,
			})
		},
	}
	c.Flags().BoolVar(&yes, "yes", false, "skip the confirmation prompt")
	c.Flags().BoolVar(&check, "check", false, "report whether a newer installable release exists; no root, no swap")
	return c
}
```

- [ ] **Step 3b: Register** — in `cli/cmd/root.go`, add `newSelfUpdateCmd(app)` to the `root.AddCommand(...)` list (root.go:66-70):

```go
	root.AddCommand(
		newInstallCmd(app), newStartCmd(app), newStopCmd(app), newStatusCmd(app),
		newLogsCmd(app), newPinCmd(app), newSuperuserCmd(app), newVersionCmd(app),
		newUninstallCmd(app), newBackupCmd(app), newRestoreCmd(app), newUpdateCmd(app),
		newSelfUpdateCmd(app),
	)
```

- [ ] **Step 4: Run — expect PASS**, whole cmd suite green.

Run: `cd cli && go test ./cmd/ && go build ./...`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/self_update.go cli/cmd/self_update_test.go cli/cmd/root.go
git commit -m "feat(cli): wire self-update command + register on root

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: goreleaser binary-only archive + CI guards

Spec: §10, §6.1. Pin the `mathion` archive to binary-only via a **non-matching glob** (empty `[]` re-applies GoReleaser's default README*/LICENSE* globs, breaking the strict single-member extractor's precondition). Add CI guards: the embedded-keyring drift cmp (a Go test already exists — Task 4's `TestEmbeddedKeyringMatchesCanonical`), a single-member archive assertion, a no-test-tag assertion, and the **§6.1 build-time fingerprint pin** (assert the committed keyring's single signing subkey equals the expected S_rel fingerprint — catches a *wrong* single subkey that runtime membership alone would accept; gated on the fpr env being set, so it skips pre-keygen exactly like 4a's `S_APT_VERIFY_FPRS`).

**Files:**
- Modify: `cli/.goreleaser.yaml` (archives entry)
- Create: `cli/scripts/selfupdate-ci-guards.sh`
- Modify: `.github/workflows/ci.yml` (invoke the guard script)

**Interfaces:** none (build/CI only).

- [ ] **Step 1: Pin the archive binary-only** — in `cli/.goreleaser.yaml`, the `archives:` entry becomes:

```yaml
archives:
  - id: mathion
    name_template: "mathion_{{ .Os }}_{{ .Arch }}"
    formats: [tar.gz]
    files: ["none*"]   # non-matching glob -> binary-only. Empty [] would re-add README*/LICENSE*.
```

- [ ] **Step 2: Add the guard script** — `cli/scripts/selfupdate-ci-guards.sh`:

```sh
#!/bin/sh
# self-update release guards:
#  (1) the release config must NOT carry the mathion_selfupdate_test build tag
#      (it would let an env var redirect a root-executed updater's origin);
#  (2) each built archive must contain EXACTLY the single member "mathion"
#      (the strict single-binary extractor in extractSingleBinary depends on it);
#  (3) the committed keyring's single signing subkey fingerprint must equal the
#      expected S_rel fpr (§6.1 build-time pin) — catches a WRONG single subkey that
#      runtime membership + the load-time single-subkey assertion cannot. Gated on the
#      fpr env being set, so it skips the pre-keygen placeholder (like 4a's fpr pins).
set -eu
cd "$(dirname "$0")/.."   # -> cli/

# (1) no test tag anywhere in the release/build config
if grep -rn 'mathion_selfupdate_test' .goreleaser.yaml ../.github/workflows/release-cli.yml; then
  echo "FAIL: mathion_selfupdate_test tag must never be in the release build" >&2
  exit 1
fi

# (2) build a REAL snapshot and assert single-member archives.
# `goreleaser build` only compiles binaries (it produces NO archives), so the
# archive assertion requires `goreleaser release --snapshot` — which also runs
# nfpm, whose `contents:` inputs (the .gz variants + a placeholder keyring) are
# not in git. Materialize them first, exactly as deploy/deb/deb_test.sh does.
gzip -9nkf ../deploy/man/mathion.1
gzip -9nkf ../deploy/deb/changelog.Debian
gzip -9nkf ../deploy/deb/THIRD_PARTY_NOTICES
[ -f ../deploy/keys/mathion-archive-keyring.gpg ] || printf 'placeholder' > ../deploy/keys/mathion-archive-keyring.gpg

CLI_TAG=cli-v0.0.0 APP_IMAGE=v0.0.0 GORELEASER_CURRENT_TAG=v0.0.0 \
  goreleaser release --clean --skip=publish,sign --snapshot >/dev/null

n=0
for a in dist/mathion_linux_*.tar.gz; do
  [ -e "$a" ] || { echo "FAIL: no linux archive produced (glob did not match)" >&2; exit 1; }
  n=$((n + 1))
  members="$(tar tzf "$a" | sed '/\/$/d')"     # drop any dir entries
  if [ "$members" != "mathion" ]; then
    echo "FAIL: $a is not binary-only (members: $members)" >&2
    exit 1
  fi
done

# (3) fingerprint pin (§6.1). Only enforced once maintainer keys exist: when S_REL_FPR
# (steady) or S_REL_EMBEDDED_FPR (transition — the INCOMING key the asset embeds, which
# during a rotation differs from the outgoing signing key) is set. Pre-keygen the asset
# is a placeholder that cannot be parsed as a keyring, so skip — the go-live caveat.
EXPECT="${S_REL_EMBEDDED_FPR:-${S_REL_FPR:-}}"
if [ -n "$EXPECT" ]; then
  command -v gpg >/dev/null 2>&1 || { echo "FAIL: gpg required for the fingerprint pin" >&2; exit 1; }
  ringdir="$(mktemp -d)"; ring="$ringdir/ring.gpg"
  trap 'rm -rf "$ringdir"' EXIT
  gpg --no-default-keyring --keyring "$ring" --quiet --import ../deploy/keys/mathion-pubkey.asc 2>/dev/null \
    || { echo "FAIL: deploy/keys/mathion-pubkey.asc is not a parseable OpenPGP keyring" >&2; exit 1; }
  prim="$(gpg --no-default-keyring --keyring "$ring" --with-colons --list-keys | awk -F: '$1=="pub"{n++} END{print n+0}')"
  [ "$prim" = 1 ] || { echo "FAIL: keyring must hold exactly one primary key, found $prim" >&2; exit 1; }
  # Pair each signing-capable subkey (colon field 12 contains lowercase 's') with the
  # fpr line that follows it; assert exactly one, equal to EXPECT (uppercase, no spaces).
  sigfprs="$(gpg --no-default-keyring --keyring "$ring" --with-colons --with-fingerprint --list-keys \
    | awk -F: '$1=="sub" && $12 ~ /s/ {want=1; next} $1=="fpr" && want {print $10; want=0}')"
  cnt="$(printf '%s\n' "$sigfprs" | grep -c . || true)"
  [ "$cnt" = 1 ] || { echo "FAIL: keyring must hold exactly one signing subkey, found $cnt" >&2; exit 1; }
  want="$(printf '%s' "$EXPECT" | tr -d ' ' | tr 'a-z' 'A-Z')"   # normalize: strip spaces, uppercase
  if [ "$sigfprs" != "$want" ]; then
    echo "FAIL: embedded signing-subkey fpr $sigfprs != expected S_rel $want" >&2
    exit 1
  fi
  echo "fingerprint pin OK ($sigfprs)"
else
  echo "SKIP fingerprint pin: neither S_REL_FPR nor S_REL_EMBEDDED_FPR set (pre-keygen placeholder)"
fi

echo "self-update CI guards PASSED ($n binary-only archive(s))"
```

- [ ] **Step 3: Wire into CI** — add to the **`apt-scripts`** job in `.github/workflows/ci.yml`. It already has BOTH `setup-go` and the goreleaser action (so does `apt-e2e`, but that job is scoped to the apt end-to-end leg), AND it already runs the shell-script package tests — the natural home for one more guard script. `cli-unit` has `go test` but no goreleaser, so it can't host this. Place after the existing "Signing + package + dates-only resign tests" step:

```yaml
      - name: self-update release guards
        run: sh cli/scripts/selfupdate-ci-guards.sh
        env:
          # Wired now, empty until keygen -> the fpr pin (guard 3) skips. At rotation time
          # the maintainer sets these repo vars (S_REL_EMBEDDED_FPR only during a crossing).
          S_REL_FPR: ${{ vars.S_REL_FPR }}
          S_REL_EMBEDDED_FPR: ${{ vars.S_REL_EMBEDDED_FPR }}
```

- [ ] **Step 4: Verify locally** (macOS has goreleaser via brew; the run writes untracked `.gz` + placeholder keyring under `deploy/`, exactly like `deb_test.sh`):

Run: `chmod +x cli/scripts/selfupdate-ci-guards.sh && sh cli/scripts/selfupdate-ci-guards.sh`
Expected: `SKIP fingerprint pin: neither S_REL_FPR nor S_REL_EMBEDDED_FPR set (pre-keygen placeholder)` then `self-update CI guards PASSED (2 binary-only archive(s))` (amd64 + arm64). To exercise the pin locally post-keygen: `S_REL_FPR=<fpr> sh cli/scripts/selfupdate-ci-guards.sh` → `fingerprint pin OK (<fpr>)`.

- [ ] **Step 5: Commit**

```bash
git add cli/.goreleaser.yaml cli/scripts/selfupdate-ci-guards.sh .github/workflows/ci.yml
git commit -m "build(cli): binary-only self-update archive + CI single-member/no-test-tag guards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Deferred (rotation-time, §6.2/§12):** the crossing-invariant CI guard (fail a release whose greatest outgoing-key-verifiable release is not within the first N eligible during a rotation window) needs real keys and is a rotation-time task — not implemented here.

---

### Task 12: docs — man page, README, key runbook, .deb third-party notices

Spec: §10, §6.2, §12. Add the `self-update`/`version --short` docs, the `mathion self-update` README section, the rotation-runbook reconciliation in `deploy/keys/README.md`, and regenerate the `.deb` third-party notices for the new deps.

**Files:**
- Modify: `deploy/man/mathion.1`, `README.md`, `deploy/keys/README.md`, `deploy/deb/copyright`, `deploy/deb/THIRD_PARTY_NOTICES`

**Interfaces:** none (docs only). No test cycle — verify by rendering/reading.

- [ ] **Step 1: Man page** — in `deploy/man/mathion.1`, add a `self-update` entry under `.SH COMMANDS` (after the `backup\fR, \fBrestore\fR, \fBupdate` group) and note `version --short`:

```troff
.TP
.B self\-update
Update the mathion CLI binary itself. curl|sh installs are verified against the
signed release checksums and swapped in place; apt installs are deferred to apt.
Use \fB\-\-check\fR to report availability without changing anything, \fB\-\-yes\fR to skip the prompt.
```

And extend the `version` group line to mention `--short` (append to its description sentence): `Add \fB\-\-short\fR to print only the CLI version (the self-update oracle).`

- [ ] **Step 2: README** — add a `## Updating the CLI (`mathion self-update`)` section to `README.md` (near the install section). Content: what it does (upgrades the `mathion` binary, not the app/DB — that is `mathion update`); channel behavior (apt-managed → prints the apt command; curl|sh → verified + swapped); `--check` (report-only, no root) and `--yes`; the guarantees (forward-only, S_rel-signature-verified); and the note "a key rotation may take two runs" (§6.2). Also mention the Debian staff-group caveat from §6.3 (if `/usr/local` and `/usr/local/bin` are `root:staff 2775` — the `/etc/staff-group-for-usr-local` default — self-update refuses; because the ancestry walk refuses *any* group-writable component and fixing only the leaf leaves `/usr/local` refused, remediate **both**: `chgrp root /usr/local /usr/local/bin && chmod 0755 /usr/local /usr/local/bin`).

- [ ] **Step 3: Key runbook reconciliation** — in `deploy/keys/README.md`, apply the §6.2/§10 corrections exactly:
  - In §5 ("Which channels need a dual-accept overlap"), change the **4b self-update binary** row from **YES** to **NO (transition-release crossing)**, resolving the line-122-vs-line-269 contradiction; `mathion-pubkey.asc` stays primary + one S_rel subkey.
  - Add the **transition choreography** as a hard task (the three-way key state from spec §10): at the transition build, `mathion-pubkey.asc` + the binary embed the **incoming K2**, while that release's `checksums.txt` is **signed by the outgoing K1**; `install.sh`'s literal key **and** `EXPECTED_SIGNING_FPR` stay **outgoing K1** (with `EXPECTED_PRIMARY_FPR` invariant) until a K2-signed successor, then both flip **together with publishing** that successor. Do NOT regenerate `install.sh`'s literal from the K2 `mathion-pubkey.asc` at the transition build. **State that this flip is NOT delivery-atomic (MINOR-2):** `install.sh` is served from raw `main` (CDN-cached) while release assets publish through a separate workflow/endpoint, so whichever becomes visible first opens a brief window where a fresh install sees one but not the other and **fail-closed-rejects** — a **safe, retryable** outcome (re-run succeeds once both are visible), never a forgery or downgrade. Do NOT call the flip "atomic": keep the two publications as close in time as possible and **smoke a fresh `curl|sh` install once both are visible** before treating the rotation as live. Note that `release-cli.yml`'s single `S_REL_FPR` cannot express sign-K1/commit-K2 today (rotation-time workflow change), and that the §6.1 CI fingerprint pin (Task 11) consumes `S_REL_EMBEDDED_FPR` (= the incoming K2, distinct from the outgoing signing key) during a crossing.
  - Add a **4b-aware sentence to §6** (S_rel *compromise* recovery): because self-update's keyring is compiled in and a compromised outgoing key can never sign a transition release, every deployed pre-rotation self-update binary fails closed into **manual reinstall** on an S_rel compromise (the safe failure), mirroring the apt-compromise paragraph.

- [ ] **Step 4: .deb third-party notices** — regenerate for the new deps. If `go-licenses` is available:

```bash
cd cli && go install github.com/google/go-licenses@latest 2>/dev/null || true
go-licenses report ./... > /tmp/notices.txt 2>/dev/null || true
```
Then enumerate the new modules in `deploy/deb/THIRD_PARTY_NOTICES` and `deploy/deb/copyright` (DEP-5): `github.com/ProtonMail/go-crypto` (BSD-3-Clause), `github.com/cloudflare/circl` (BSD-3-Clause + others), `golang.org/x/crypto`, `golang.org/x/mod`, `golang.org/x/sys` (all BSD-3-Clause). Match the existing file's format; keep it lintian-clean.

- [ ] **Step 5: Verify** — render the man page and re-read the edits.

Run: `man -l deploy/man/mathion.1 | col -b | grep -A2 self-update`
Expected: the `self-update` entry renders.

- [ ] **Step 6: Commit**

```bash
git add deploy/man/mathion.1 README.md deploy/keys/README.md deploy/deb/copyright deploy/deb/THIRD_PARTY_NOTICES
git commit -m "docs(cli): self-update man/README + key-rotation runbook reconciliation + .deb notices

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: integration leg (real swapped binaries) + test-tag endpoint override

Spec: §9.2, §3.2, §6.4. A root-required Linux leg with throwaway OpenPGP keys and REAL shell-launched binaries (the in-process seams can't reach a binary self-update swapped in and re-launched). Covers ALL §9.2 scenarios: curl-managed happy path (real inherited-fd exec + swap), the two-invocation rotation crossing (K1 client → K1-signed transition embedding K2 → K2-only latest), apt-managed defer (a real dpkg-owned path), S_apt-signed rejection, and the **staged-exec bound + fd-hygiene legs (correction 6)** — a past-deadline abort plus the two fork-orphan legs (i) `Wait`-unblock + orderly release and (ii) fd-hygiene backstop (kill the parked updater before its `LOCK_UN`, then require a fresh-OFD `flock` succeeds → proves the flock fd was `O_CLOEXEC`). Adds the paired build-tag endpoint override and the build-tag-gated exec-bound env injection.

**Files:**
- Create: `cli/internal/selfupdate/endpoints_testtag.go`, `cli/internal/selfupdate/execbounds_testtag.go`, `cli/selfupdate_integration_test.sh`

This is a **standalone** leg (like `deploy/apt/e2e_test.sh`), gated behind `MATHION_SELFUPDATE_E2E=1` so it never mutates a real install by accident; it is NOT wired into `cli/integration_test.sh`.

**Interfaces:** `endpointAPIBase`/`endpointDLBase` overridden from env under `mathion_selfupdate_test`.

- [ ] **Step 1: Paired test-tag endpoints** — `cli/internal/selfupdate/endpoints_testtag.go`:

```go
//go:build mathion_selfupdate_test

package selfupdate

import "os"

// Under the mathion_selfupdate_test tag ONLY, endpoints come from env so an
// integration harness can point a REAL swapped binary at a throwaway server. The
// shipped release is built WITHOUT this tag (CI-asserted — Task 11).
func endpointAPIBase() string { return os.Getenv("MATHION_SELFUPDATE_API_BASE") }
func endpointDLBase() string  { return os.Getenv("MATHION_SELFUPDATE_DL_BASE") }
```

- [ ] **Step 1b: Build-tag-gated exec-bound injection** — `cli/internal/selfupdate/execbounds_testtag.go`. This is `linux && mathion_selfupdate_test` (the bounds live in `swap.go`, which is `//go:build linux`). No paired default file is needed — `init()` only MUTATES existing package vars (unlike the endpoint symbols, it defines nothing), so the production build simply keeps `swap.go`'s defaults:

```go
//go:build linux && mathion_selfupdate_test

package selfupdate

import (
	"os"
	"strconv"
	"time"
)

// Under the integration build tag ONLY, the staged-exec bounds can be injected from env
// so §9.2's staged-exec legs can (a) force a FAST deadline for the basic past-deadline
// abort and (b) inject a LONG deadline that parks the updater inside step 7 long enough
// to SIGKILL it before its LOCK_UN (leg ii). The shipped release lacks this tag
// (CI-asserted, Task 11), so production always uses swap.go's defaults.
func init() {
	if v := os.Getenv("MATHION_SELFUPDATE_EXEC_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			stagedExecTimeout = d
		}
	}
	if v := os.Getenv("MATHION_SELFUPDATE_OUTPUT_CAP"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			stagedExecOutputCap = n
		}
	}
}
```

- [ ] **Step 2: Confirm the pairing compiles both ways** (incl. the linux-tagged exec-bound file)

Run (macOS host, proves the untagged + all-OS-tagged builds): `cd cli && go build ./... && go build -tags mathion_selfupdate_test ./...`
Run (Linux container, proves the `linux && mathion_selfupdate_test` file compiles): `docker run --rm -v "$(git rev-parse --show-toplevel)":/w -w /w/cli golang:1.24 go build -tags mathion_selfupdate_test ./...`
Expected: all succeed (exactly one definition of `endpointAPIBase`/`endpointDLBase` per build; `execbounds_testtag.go` compiles only under `linux && mathion_selfupdate_test`).

- [ ] **Step 3: Write the integration leg** — `cli/selfupdate_integration_test.sh` (modeled on `deploy/apt/e2e_test.sh`). Two throwaway keys (K1, K2), four binaries built from throwaway tree-copies with the embedded keyring overwritten (the tracked asset is never touched — §6.1/§9.2), and a local release server. Requires root + gpg + python3 + dpkg + go; **skips unless `MATHION_SELFUPDATE_E2E=1`** (it mutates `/usr/local/bin/mathion` and `/usr/bin/mathion`):

```sh
#!/bin/sh
# self-update integration: throwaway OpenPGP keys + REAL shell-launched binaries.
# Covers all four §9.2 scenarios: happy path, rotation crossing, apt defer, S_apt reject.
set -eu
[ "${MATHION_SELFUPDATE_E2E:-}" = 1 ] || { echo "SKIP: set MATHION_SELFUPDATE_E2E=1 (mutates /usr/local/bin/mathion + /usr/bin/mathion)"; exit 0; }
[ "$(id -u)" = 0 ] || { echo "SKIP: needs root (swap + ancestry guard)"; exit 0; }
for t in gpg python3 dpkg go; do command -v "$t" >/dev/null 2>&1 || { echo "SKIP: $t required"; exit 0; }; done

CLI_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM
export GNUPGHOME="$WORK/gnupg"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
SITE="$WORK/site"; mkdir -p "$SITE"
ASSET="mathion_linux_$(go env GOARCH).tar.gz"

# --- helpers ---------------------------------------------------------------
gen_key() { # <email> -> prints the PRIMARY fingerprint (cert primary + sign subkey)
  cat > "$WORK/kp" <<EOF
%no-protection
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: cert
Subkey-Type: eddsa
Subkey-Curve: ed25519
Subkey-Usage: sign
Name-Real: Mathion Test $1
Name-Email: $1
Expire-Date: 0
%commit
EOF
  gpg --batch --gen-key "$WORK/kp" >/dev/null 2>&1
  gpg --batch --with-colons --list-keys "$1" | awk -F: '/^fpr:/{print $10; exit}'
}

build_bin() { # <baked-tag> <embed-pubkey.asc> <out-path>
  tree="$WORK/tree-$(basename "$3")"
  cp -a "$CLI_DIR" "$tree"
  cp "$2" "$tree/internal/selfupdate/mathion-pubkey.asc"   # overwrite the EMBED, not the tracked asset
  ( cd "$tree" && CGO_ENABLED=0 go build -tags mathion_selfupdate_test \
      -ldflags "-X main.version=$1" -o "$3" . )
  rm -rf "$tree"
}

publish() { # <tag> <binary> <signer-primary-fpr>
  d="$SITE/$1"; mkdir -p "$d"
  root="$WORK/pkgroot"; rm -rf "$root"; mkdir -p "$root"
  install -m0755 "$2" "$root/mathion"
  tar -C "$root" -czf "$d/$ASSET" mathion              # single regular member "mathion"
  sha="$(sha256sum "$d/$ASSET" | awk '{print $1}')"
  printf '%s  %s\n' "$sha" "$ASSET" > "$d/checksums.txt"
  gpg --batch --yes --armor --digest-algo SHA256 --local-user "$3" \
    --detach-sign -o "$d/checksums.txt.asc" "$d/checksums.txt"   # signs with the SIGN subkey
}

# --- keys + binaries -------------------------------------------------------
K1="$(gen_key k1@example.invalid)"; gpg --batch --armor --export "$K1" > "$WORK/k1.asc"
K2="$(gen_key k2@example.invalid)"; gpg --batch --armor --export "$K2" > "$WORK/k2.asc"

build_bin cli-v0.2.0 "$WORK/k1.asc" "$WORK/client_k1"      # curl client, trusts K1
build_bin cli-v0.9.0 "$WORK/k1.asc" "$WORK/rel090_k1"      # happy-path release payload
build_bin cli-v0.5.0 "$WORK/k2.asc" "$WORK/trans050_k2"    # transition payload: embeds K2
build_bin cli-v0.9.0 "$WORK/k2.asc" "$WORK/latest090_k2"   # rotation latest payload

# --- release server --------------------------------------------------------
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
( cd "$SITE" && exec python3 -m http.server "$PORT" >/dev/null 2>&1 ) & SERVER_PID=$!
sleep 1
BASE="http://127.0.0.1:$PORT"
export MATHION_SELFUPDATE_API_BASE="$BASE" MATHION_SELFUPDATE_DL_BASE="$BASE"
# plain HTTP is fine: the https-only policy binds redirect hops, not the injected endpoint.

verset() { printf '%s' "$1" > "$SITE/releases"; }   # <releases-json>

# === LEG 1: HAPPY PATH (curl-managed, K1-signed) ===========================
verset '[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.2.0"}]'
publish cli-v0.9.0 "$WORK/rel090_k1" "$K1"
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
/usr/local/bin/mathion self-update --yes
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.9.0" ] || { echo "FAIL(happy): want cli-v0.9.0, got $v"; exit 1; }

# === LEG 2: S_apt REJECTION (re-sign with K2, which the K1 client does not trust) ==
publish cli-v0.9.0 "$WORK/rel090_k1" "$K2"    # foreign signature
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
if /usr/local/bin/mathion self-update --yes; then echo "FAIL(reject): foreign-key sig accepted"; exit 1; fi
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(reject): binary changed to $v"; exit 1; }

# === LEG 3: APT DEFER (a real dpkg-owned path) =============================
# Make `dpkg -S /usr/bin/mathion` report the file as mathion-owned. A `.list`
# file ALONE is not enough — dpkg's search only reports files for packages that
# have a stanza in the status DB, so we must ALSO append a minimal
# `Status: install ok installed` stanza to /var/lib/dpkg/status (this is what a
# real apt install leaves behind: both the .list file and the status stanza).
# Back up the status DB first and restore it in cleanup — we are mutating the
# container's real dpkg database.
mkdir -p /var/lib/dpkg/info
cp /var/lib/dpkg/status "$WORK/status.bak"
printf '/usr/bin/mathion\n' > /var/lib/dpkg/info/mathion.list
printf '\nPackage: mathion\nStatus: install ok installed\nPriority: optional\nSection: admin\nMaintainer: Mathion Test <t@example.invalid>\nArchitecture: %s\nVersion: 0.2.0\nDescription: apt-defer test stub\n' "$(dpkg --print-architecture)" >> /var/lib/dpkg/status
install -m0755 "$WORK/client_k1" /usr/bin/mathion
publish cli-v0.9.0 "$WORK/rel090_k1" "$K1"    # a valid update EXISTS; defer must still win
out="$(/usr/bin/mathion self-update --yes)"
printf '%s' "$out" | grep -q 'apt install --only-upgrade mathion' || { echo "FAIL(apt): no defer message: $out"; exit 1; }
v="$(/usr/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(apt): dpkg-owned binary was swapped to $v"; exit 1; }
cp "$WORK/status.bak" /var/lib/dpkg/status
rm -f /var/lib/dpkg/info/mathion.list /usr/bin/mathion

# === LEG 4: ROTATION CROSSING (two invocations) ============================
# cli-v0.5.0: signed by OUTGOING K1, payload embeds INCOMING K2 (the transition).
# cli-v0.9.0: signed by INCOMING K2 only (the K1 client cannot verify it yet).
verset '[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.5.0"},{"tag_name":"cli-v0.2.0"}]'
publish cli-v0.5.0 "$WORK/trans050_k2" "$K1"
publish cli-v0.9.0 "$WORK/latest090_k2" "$K2"
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
# Run 1: K1 client skips the K2-signed 0.9.0 (unverifiable) and installs the K1-signed transition.
/usr/local/bin/mathion self-update --yes
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.5.0" ] || { echo "FAIL(rotate run1): want cli-v0.5.0, got $v"; exit 1; }
# Run 2: the now-installed transition binary embeds K2 and reaches the K2-signed latest.
/usr/local/bin/mathion self-update --yes
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.9.0" ] || { echo "FAIL(rotate run2): want cli-v0.9.0, got $v"; exit 1; }
rm -f /usr/local/bin/mathion

# === LEG 5: STAGED-EXEC BOUND + fd HYGIENE under the flock (§9.2 correction 6) =======
# A "forky" staged payload whose `version --short` double-forks a setsid orphan that
# INHERITS stdout and outlives the exec deadline. Behavior switches on FORKY_MODE:
#   sleep -> no fork; just sleep past a SHORT injected deadline (basic past-deadline abort)
#   exit  -> spawn orphan, then the DIRECT child EXITS  (leg i: WaitDelay must unblock Wait)
#   block -> spawn orphan, signal alive, then BLOCK     (leg ii: parked updater, killed pre-LOCK_UN)
# The client is the K1 curl client; the selected release's archive IS forky, K1-signed,
# so verification passes and the client reaches step 7 (stage + inherited-fd exec).
cat > "$WORK/forky.go" <<'EOF'
package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) < 3 || os.Args[1] != "version" || os.Args[2] != "--short" {
		os.Exit(2)
	}
	mode := os.Getenv("FORKY_MODE")
	alive := os.Getenv("FORKY_ALIVE")
	if os.Getenv("FORKY_CHILD") == "1" {
		// We are the double-forked orphan: a NEW SESSION (escaped the updater's
		// kill(-pgid)) still holding the inherited stdout. Signal alive, then outlive
		// the exec window. Bounded so no process lingers after the harness finishes.
		if alive != "" {
			_ = os.WriteFile(alive, []byte("1"), 0o644)
		}
		time.Sleep(15 * time.Second)
		os.Exit(0)
	}
	if mode == "sleep" {
		time.Sleep(15 * time.Second) // no fork; the updater's deadline+group-kill must reach this
		os.Exit(0)
	}
	// Spawn the orphan in a new session that inherits our stdout pipe.
	child := exec.Command("/proc/self/exe", "version", "--short")
	child.Env = append(os.Environ(), "FORKY_CHILD=1")
	child.Stdout = os.Stdout // inherit the exec'd stdout -> keeps the updater's io.Copy blocked
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := child.Start(); err != nil {
		os.Exit(3)
	}
	if mode == "block" {
		time.Sleep(15 * time.Second) // leg ii: park (the harness kills the updater within ~1s)
		os.Exit(0)
	}
	// leg i: print a bogus tag and EXIT; the orphan lives on holding stdout, so the
	// updater's Wait must rely on WaitDelay (a direct-child-only reap would hang).
	fmt.Println("cli-v0.0.0-forky")
	os.Exit(0)
}
EOF
( cd "$WORK" && go mod init forkyhelper >/dev/null 2>&1 && go build -o "$WORK/forky_bin" forky.go )

publish_forky() { # <tag> -- archive member "mathion" IS forky, K1-signed
  d="$SITE/$1"; mkdir -p "$d"
  root="$WORK/forkyroot"; rm -rf "$root"; mkdir -p "$root"
  install -m0755 "$WORK/forky_bin" "$root/mathion"
  tar -C "$root" -czf "$d/$ASSET" mathion
  sha="$(sha256sum "$d/$ASSET" | awk '{print $1}')"
  printf '%s  %s\n' "$sha" "$ASSET" > "$d/checksums.txt"
  gpg --batch --yes --armor --digest-algo SHA256 --local-user "$K1" \
    --detach-sign -o "$d/checksums.txt.asc" "$d/checksums.txt"
}
# A fresh open-file description must be able to LOCK_EX|LOCK_NB the locked parent dir.
lock_free() { flock -n /usr/local/bin -c true; }   # exit 0 = free, 1 = still held

verset '[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.2.0"}]'
publish_forky cli-v0.9.0

# --- LEG 5a: basic bound -- a staged binary that sleeps past a SHORT deadline aborts, no swap.
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
rc=0
FORKY_MODE=sleep MATHION_SELFUPDATE_EXEC_TIMEOUT=1s \
  timeout 30 /usr/local/bin/mathion self-update --yes >/dev/null 2>&1 || rc=$?
[ "$rc" = 124 ] && { echo "FAIL(bound): updater hung past the deadline (group-kill/WaitDelay broken)"; exit 1; }
[ "$rc" = 0 ]   && { echo "FAIL(bound): a past-deadline staged exec must abort self-update"; exit 1; }
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(bound): live binary was swapped to $v"; exit 1; }
lock_free || { echo "FAIL(bound): mutation lock not released after a deadline abort"; exit 1; }

# --- LEG 5b: fork-orphan (i) -- direct child exits; WaitDelay must unblock Wait + orderly release.
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
rm -f "$WORK/alive_i"
rc=0
FORKY_MODE=exit FORKY_ALIVE="$WORK/alive_i" MATHION_SELFUPDATE_EXEC_TIMEOUT=60s \
  timeout 30 /usr/local/bin/mathion self-update --yes >/dev/null 2>&1 || rc=$?
[ "$rc" = 124 ] && { echo "FAIL(fork-i): Wait hung on the inherited pipe -> WaitDelay did not force-close it"; exit 1; }
[ "$rc" = 0 ]   && { echo "FAIL(fork-i): must abort (forky reports a bogus tag), not swap"; exit 1; }
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(fork-i): live binary swapped to $v"; exit 1; }
lock_free || { echo "FAIL(fork-i): orderly LOCK_UN did not release the lock"; exit 1; }

# --- LEG 5c: fork-orphan (ii) -- kill the PARKED updater BEFORE its LOCK_UN; O_CLOEXEC must free the lock.
install -m0755 "$WORK/client_k1" /usr/local/bin/mathion
rm -f "$WORK/alive_ii"
FORKY_MODE=block FORKY_ALIVE="$WORK/alive_ii" MATHION_SELFUPDATE_EXEC_TIMEOUT=300s \
  /usr/local/bin/mathion self-update --yes >/dev/null 2>&1 &
UPD=$!
# Wait until the orphan signals alive: the updater is now PARKED inside step-7 exec,
# holding the lock, before any swap / LOCK_UN / abort-cleanup.
i=0
while [ ! -f "$WORK/alive_ii" ] && [ "$i" -lt 200 ]; do sleep 0.1; i=$((i + 1)); done
[ -f "$WORK/alive_ii" ] || { echo "FAIL(fork-ii): orphan never signaled alive"; kill -9 "$UPD" 2>/dev/null || true; exit 1; }
kill -9 "$UPD"; wait "$UPD" 2>/dev/null || true   # SIGKILL before LOCK_UN; wait -> updater fds fully closed
# The lock frees on the updater's death IFF the setsid orphan never inherited the flock
# fd (i.e. it was O_CLOEXEC). A leaked fd keeps the shared-OFD lock held through the
# still-alive orphan, so a fresh-OFD LOCK_EX|LOCK_NB would FAIL.
lock_free || { echo "FAIL(fork-ii): lock still held after killing the updater -> flock fd leaked into the setsid orphan (missing O_CLOEXEC)"; exit 1; }
v="$(/usr/local/bin/mathion version --short)"
[ "$v" = "cli-v0.2.0" ] || { echo "FAIL(fork-ii): live binary changed to $v"; exit 1; }
rm -f /usr/local/bin/mathion /usr/local/bin/.mathion-selfupdate-*.tmp

echo "self-update integration PASSED (happy + reject + apt-defer + rotation-crossing + staged-exec-bound + fd-hygiene i/ii)"
```

- [ ] **Step 4: Run the leg (root, Linux container)** — macOS can't run it (Linux swap syscalls + dpkg). Use a Debian-based Go container with gpg + python3:

Run: `docker run --rm -e MATHION_SELFUPDATE_E2E=1 -v "$(git rev-parse --show-toplevel)":/w -w /w golang:1.24 sh -c 'apt-get update >/dev/null && apt-get install -y --no-install-recommends gnupg python3 >/dev/null && sh cli/selfupdate_integration_test.sh'`
Expected: `self-update integration PASSED (happy + reject + apt-defer + rotation-crossing + staged-exec-bound + fd-hygiene i/ii)`. Without `MATHION_SELFUPDATE_E2E=1` (or off-root / missing tool) it prints `SKIP:` and exits 0. (`flock`, `timeout`, GNU `sleep` are all present in the Debian-based `golang:1.24` image the staged-exec legs use.)

- [ ] **Step 5: Commit**

```bash
chmod +x cli/selfupdate_integration_test.sh
git add cli/internal/selfupdate/endpoints_testtag.go cli/internal/selfupdate/execbounds_testtag.go cli/selfupdate_integration_test.sh
git commit -m "test(cli): self-update integration leg (happy/reject/apt-defer/rotation/staged-exec-bound) + test-tag endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Review ledger — accepted minors & conscious deviations

Recorded so the SDD per-task reviewer and the final whole-branch review don't re-litigate them:

- **S_apt-rejected test uses a foreign key, not a same-primary second subkey (accepted).** `verifyChecksums` enforces membership by issuer *fingerprint*, which is absent from the trimmed keyring in BOTH the foreign-key and same-primary-second-subkey cases — so the foreign-key unit test (`TestVerifyChecksums`) is behaviorally equivalent and sound. A same-primary variant was empirically found delicate to construct cleanly (signing through a filtered keyring view mis-selects the key) and adds no coverage; the integration leg (LEG 4) exercises real distinct keys end-to-end.
- **Rotation-time CI crossing-invariant guard is deferred (§6.2/§12, Task 11 note).** It requires real rotation keys that don't exist yet; defensible until a rotation is actually scheduled.
- **§6.1 "CI `cmp` drift guard" is realized as a Go test, not a shell `cmp`** (`TestEmbeddedKeyringMatchesCanonical`, Task 4). Acceptable: `ci.yml`'s `cli-unit` job runs `go test ./...` on ubuntu, so the drift assertion runs in CI on every push.
- **Task 12's README section is a content outline, not verbatim text.** The man-page and `deploy/keys/README.md` edits ARE exact; the README prose is detailed enough to write without ambiguity and depends on surrounding file content the implementer will read.
- **`verifyChecksums` needs NO revocation/expiry code (empirically verified).** go-crypto's `VerifyDetachedSignatureAndHash` rejects expired ("key expired") and revoked ("signature made by revoked key") signing subkeys natively; the §9.1 negatives are test-only additions (Task 4).
