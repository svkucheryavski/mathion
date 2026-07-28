# Phase 9-D Slice 2 — `mathion` Go CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single static Go binary `mathion` that automates Slice 1's manual self-hosting flow — `install`/`start`/`stop`/`status`/`logs`/`pin`/`superuser`/`version`/`uninstall` — wrapping the published production stack, distributed as `cli-v*` release binaries installable via `curl | sh`.

**Architecture:** A thin cobra-based orchestrator that shells out to the host's `docker compose` (and a few bare `docker` calls) and to the container's `alembic`/`mathion.superuser` entrypoints. It embeds a byte-identical copy of `docker-compose.prod.yml`, generates a secret-bearing `<cfgdir>/.env`, and changes **zero** backend/frontend/compose files. All commands go through a `Runner` seam so argv vectors are unit-tested without Docker.

**Tech Stack:** Go 1.23, `spf13/cobra`, `go:embed`, `crypto/rand`, goreleaser (build-only), GitHub Actions, POSIX `sh` installer.

**Spec:** `docs/superpowers/specs/2026-07-28-phase9-d-slice2-cli-design.md` (converged commit `8c99a3e`).

## Global Constraints

Every task's requirements implicitly include this section. Exact values are copied verbatim from the spec.

- **Module scope:** the CLI is a new Go module rooted at `cli/` (the repo has no other Go). ALL Go tooling is module-scoped: `go -C cli test ./...`, `go -C cli vet ./...`, `go -C cli build ./...`. Never run bare `go` from the repo root.
- **Compose invocation base:** every `docker compose` call passes, in order, `compose -p <project> -f <cfgdir>/docker-compose.yml --env-file <cfgdir>/.env …`. The **only** exceptions are `uninstall --purge`'s teardown and the install volume guard, which use **bare `docker`** by resolved identity (no `-f`/`--env-file`).
- **Runner binary is `docker`:** the `Runner` always invokes `docker`; callers pass the args (`compose …` or `volume inspect …` etc.). Real impl uses `exec.CommandContext`; tests inject a `FakeRunner` that records argv and returns programmed results.
- **Config dir:** `<cfgdir>` defaults to `/etc/mathion`, overridable via env `MATHION_CONFIG_DIR`. Resolved once into `App.CfgDir` and used everywhere — never hardcode `/etc/mathion` in a command.
- **Project name:** defaults to `mathion_prod`, overridable via hidden env `MATHION_PROJECT_OVERRIDE` (test/CI isolation only). Resolved once into `App.Project`. All derived resource names use it: volumes `<project>_mathion_pgdata` / `<project>_mathion_assets`, network `<project>_default`, label `com.docker.compose.project=<project>`.
- **Secrets:** `MATHION_SECRET_KEY` = base64 of 48 `crypto/rand` bytes; `POSTGRES_PASSWORD` = hex of 24 `crypto/rand` bytes. The **same** hex password appears in `POSTGRES_PASSWORD` and in `MATHION_DATABASE_URL`'s password field. **Never print a generated secret to stdout/logs.**
- **`.env` / state atomicity:** both `.env` and `install-state` are written atomically (unique temp file in the same dir, mode `0600`, `fsync`, `rename`). `install-state` is written **before** `.env`; `.env` is written **last** in the config step.
- **`.env` parity:** the generated `.env` carries the exact key set of `deploy/.env.prod.example` and the documented **fixed** values; a unit test enforces key + fixed-value parity so neither drifts.
- **Base URL:** `MATHION_BASE_URL = https://<domain>`, validated against `backend/mathion/config.py`'s `base_url` rules (no control/whitespace; scheme http|https; non-empty host; no userinfo; valid port; path ∈ {"","/"}; no query/fragment). A scheme typed into `--domain` is rejected.
- **Embedded compose:** `cli/internal/compose/docker-compose.yml` is a byte-identical copy of repo-root `docker-compose.prod.yml`, enforced by a drift-guard test. Slice 2 edits nothing in the repo-root compose file.
- **Release:** `cli-v*` tags, independent of the app image's `v*`. goreleaser runs **build-only** on a sanitized semver via `GORELEASER_CURRENT_TAG`; `gh release create` publishes. `CGO_ENABLED=0`; targets `linux/amd64` + `linux/arm64`. `checksum.name_template: 'checksums.txt'`; `main.version` injected from the original tag via `CLI_TAG`.
- **CI split:** `cli-unit` (fast, no Docker) is added to the reusable `ci.yml` and gates PRs + app releases. The Docker integration test + `install.sh` test live in `release-cli.yml` and do **not** gate app releases.
- **Discipline:** TDD (failing test first), frequent commits, DRY, YAGNI. `git add` exact named paths (never `-A`/`.`). Commit trailer EXACTLY:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
cli/
  go.mod  go.sum                       # module github.com/svkucheryavski/mathion/cli
  main.go                              # var version, defaultImage; func main(){ cmd.Execute() }
  cmd/
    root.go                            # App{CfgDir,Project,Runner}; newRootCmd; Execute; cfgdir/project resolve
    start.go stop.go logs.go status.go
    version.go superuser.go pin.go
    install.go uninstall.go
  internal/
    secrets/secrets.go                 # SecretKey(), PGPassword()
    config/
      env.go                           # Env model, GenerateEnv, RenderEnv, ParseEnv, ReadEnvFile
      validate.go                      # BuildBaseURL, ValidateEmail, ValidateOCITag, NormalizeEmail
      state.go                         # AtomicWrite, EnsureConfigDir, WriteState, ReadState
    compose/
      runner.go                        # Runner interface, ExecRunner, FakeRunner
      embed.go                         # //go:embed docker-compose.yml -> ComposeYAML
      docker-compose.yml               # byte-identical copy of repo docker-compose.prod.yml
    dockerx/
      health.go                        # HealthProbe (GET /health)
      preflight.go                     # Preflight, PortFree, VolumeExists
      teardown.go                      # Purge (identity teardown)
  .goreleaser.yaml
deploy/install.sh                      # curl|sh installer
deploy/install_sh_test.sh              # installer shell test (release-cli.yml)
cli/integration_test.sh                # real-Docker install/purge test (release-cli.yml)
.github/workflows/ci.yml               # MODIFY: add cli-unit job
.github/workflows/release-cli.yml      # NEW
README.md                              # MODIFY: add CLI self-hosting section
```

---

### Task 1: Module scaffold + Runner seam + App/root

**Files:**
- Create: `cli/go.mod`, `cli/main.go`, `cli/cmd/root.go`, `cli/internal/compose/runner.go`
- Test: `cli/cmd/root_test.go`, `cli/internal/compose/runner_test.go`

**Interfaces:**
- Produces: `compose.Runner interface { Run(ctx context.Context, args ...string) error; Output(ctx context.Context, args ...string) (string, error) }`; `compose.ExecRunner`; `compose.FakeRunner` (records `Calls [][]string`, programmable `RunFunc`/`OutputFunc`). `cmd.App struct { CfgDir, Project string; Runner compose.Runner; Out, Err io.Writer; In io.Reader }`; `cmd.newRootCmd(app *App) *cobra.Command`; `cmd.Execute()`. `main.version`, `main.defaultImage`.

- [ ] **Step 1: Create the module.** `cli/go.mod`:

```
module github.com/svkucheryavski/mathion/cli

go 1.23

require github.com/spf13/cobra v1.8.1
```

- [ ] **Step 2: Runner seam.** `cli/internal/compose/runner.go`:

```go
package compose

import (
	"context"
	"os"
	"os/exec"
)

// Runner runs the `docker` binary with the given arguments. Callers pass the
// full arg vector (e.g. "compose","-p",... or "volume","inspect",...).
type Runner interface {
	Run(ctx context.Context, args ...string) error
	Output(ctx context.Context, args ...string) (string, error)
}

type ExecRunner struct{ Bin string } // Bin defaults to "docker"

func (r ExecRunner) bin() string {
	if r.Bin == "" {
		return "docker"
	}
	return r.Bin
}

func (r ExecRunner) Run(ctx context.Context, args ...string) error {
	cmd := exec.CommandContext(ctx, r.bin(), args...)
	cmd.Stdout, cmd.Stderr, cmd.Stdin = os.Stdout, os.Stderr, os.Stdin
	return cmd.Run()
}

func (r ExecRunner) Output(ctx context.Context, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, r.bin(), args...).Output()
	return string(out), err
}
```

- [ ] **Step 3: FakeRunner** in `cli/internal/compose/runner.go` (same package, used across command tests):

```go
type FakeRunner struct {
	Calls      [][]string
	RunFunc    func(args []string) error
	OutputFunc func(args []string) (string, error)
}

func (f *FakeRunner) Run(_ context.Context, args ...string) error {
	f.Calls = append(f.Calls, args)
	if f.RunFunc != nil {
		return f.RunFunc(args)
	}
	return nil
}

func (f *FakeRunner) Output(_ context.Context, args ...string) (string, error) {
	f.Calls = append(f.Calls, args)
	if f.OutputFunc != nil {
		return f.OutputFunc(args)
	}
	return "", nil
}
```

- [ ] **Step 4: Write the failing test** `cli/cmd/root_test.go`:

```go
package cmd

import (
	"os"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestResolveCfgDirDefault(t *testing.T) {
	t.Setenv("MATHION_CONFIG_DIR", "")
	if got := resolveCfgDir(); got != "/etc/mathion" {
		t.Fatalf("cfgdir = %q, want /etc/mathion", got)
	}
}

func TestResolveCfgDirOverride(t *testing.T) {
	t.Setenv("MATHION_CONFIG_DIR", "/tmp/x")
	if got := resolveCfgDir(); got != "/tmp/x" {
		t.Fatalf("cfgdir = %q, want /tmp/x", got)
	}
}

func TestResolveProject(t *testing.T) {
	t.Setenv("MATHION_PROJECT_OVERRIDE", "")
	if got := resolveProject(); got != "mathion_prod" {
		t.Fatalf("project = %q, want mathion_prod", got)
	}
	t.Setenv("MATHION_PROJECT_OVERRIDE", "mathion_t123")
	if got := resolveProject(); got != "mathion_t123" {
		t.Fatalf("project = %q, want mathion_t123", got)
	}
}

func TestRootHasSubcommands(t *testing.T) {
	app := &App{CfgDir: "/tmp", Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr, In: os.Stdin}
	cmd := newRootCmd(app)
	want := []string{"install", "start", "stop", "status", "logs", "pin", "superuser", "version", "uninstall"}
	have := map[string]bool{}
	for _, c := range cmd.Commands() {
		have[c.Name()] = true
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("missing subcommand %q", w)
		}
	}
}
```

- [ ] **Step 5: Run it to see it fail** — `go -C cli test ./cmd/ -run TestRoot -v` → FAIL (undefined `App`/`newRootCmd`).

- [ ] **Step 6: Implement** `cli/cmd/root.go` (App, resolvers, root command wiring; each subcommand is added as a stub `newXxxCmd(app)` returning a `&cobra.Command{Use: "...", RunE: ...}` — the stubs are fleshed out in later tasks, but ALL nine must be registered here so the tree is complete):

```go
package cmd

import (
	"context"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

type App struct {
	CfgDir  string
	Project string
	Runner  compose.Runner
	Out     io.Writer
	Err     io.Writer
	In      io.Reader
}

func resolveCfgDir() string {
	if v := os.Getenv("MATHION_CONFIG_DIR"); v != "" {
		return v
	}
	return "/etc/mathion"
}

func resolveProject() string {
	if v := os.Getenv("MATHION_PROJECT_OVERRIDE"); v != "" {
		return v
	}
	return "mathion_prod"
}

func newRootCmd(app *App) *cobra.Command {
	root := &cobra.Command{
		Use:           "mathion",
		Short:         "Self-host and manage a Mathion deployment",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(
		newInstallCmd(app), newStartCmd(app), newStopCmd(app), newStatusCmd(app),
		newLogsCmd(app), newPinCmd(app), newSuperuserCmd(app), newVersionCmd(app),
		newUninstallCmd(app),
	)
	return root
}

func Execute() {
	app := &App{
		CfgDir:  resolveCfgDir(),
		Project: resolveProject(),
		Runner:  compose.ExecRunner{},
		Out:     os.Stdout, Err: os.Stderr, In: os.Stdin,
	}
	if err := newRootCmd(app).ExecuteContext(context.Background()); err != nil {
		app.Err.Write([]byte("error: " + err.Error() + "\n"))
		os.Exit(1)
	}
}
```

`cli/main.go`:

```go
package main

import "github.com/svkucheryavski/mathion/cli/cmd"

// Overridden by goreleaser ldflags at release; non-empty defaults so plain
// `go build` (tests/CI) works.
var (
	version      = "dev"
	defaultImage = "v0.1.1"
)

func main() {
	cmd.SetBuildInfo(version, defaultImage)
	cmd.Execute()
}
```

Add to `root.go` a package var + setter so `main`'s ldflags reach the commands:

```go
var buildVersion, buildDefaultImage = "dev", "v0.1.1"

func SetBuildInfo(v, img string) { buildVersion, buildDefaultImage = v, img }
```

Add **stub** command constructors in their target files (e.g. `cli/cmd/start.go` etc.) each returning `&cobra.Command{Use: "start", RunE: func(*cobra.Command, []string) error { return nil }}` so the module compiles; later tasks replace the `RunE` bodies. (Create one stub file per command now.)

- [ ] **Step 7: Populate `go.sum`** — `go -C cli mod tidy`.

- [ ] **Step 8: Run tests + vet** — `go -C cli test ./...` (PASS) and `go -C cli vet ./...` (clean).

- [ ] **Step 9: Commit**

```bash
git add cli/go.mod cli/go.sum cli/main.go cli/cmd cli/internal/compose/runner.go
git commit -m "feat(cli): module scaffold, Runner seam, cobra root with command tree"
```

---

### Task 2: Secrets generation

**Files:**
- Create: `cli/internal/secrets/secrets.go`
- Test: `cli/internal/secrets/secrets_test.go`

**Interfaces:**
- Produces: `secrets.SecretKey() (string, error)` (base64 of 48 rand bytes); `secrets.PGPassword() (string, error)` (hex of 24 rand bytes).

- [ ] **Step 1: Write the failing test** `secrets_test.go`:

```go
package secrets

import (
	"encoding/base64"
	"encoding/hex"
	"regexp"
	"testing"
)

func TestSecretKeyIs48Base64Bytes(t *testing.T) {
	s, err := SecretKey()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("not valid base64: %v", err)
	}
	if len(raw) != 48 {
		t.Fatalf("decoded len = %d, want 48", len(raw))
	}
}

func TestPGPasswordIsHex24(t *testing.T) {
	p, err := PGPassword()
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{48}$`).MatchString(p) {
		t.Fatalf("pg password %q not 48 hex chars", p)
	}
	raw, _ := hex.DecodeString(p)
	if len(raw) != 24 {
		t.Fatalf("decoded len = %d, want 24", len(raw))
	}
}

func TestSecretsDiffer(t *testing.T) {
	a, _ := SecretKey()
	b, _ := SecretKey()
	if a == b {
		t.Fatal("two SecretKey() calls returned identical values")
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go -C cli test ./internal/secrets/ -v` → FAIL (undefined).

- [ ] **Step 3: Implement** `secrets.go`:

```go
package secrets

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
)

func SecretKey() (string, error) {
	b := make([]byte, 48)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

func PGPassword() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
```

- [ ] **Step 4: Run tests** — `go -C cli test ./internal/secrets/ -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/secrets
git commit -m "feat(cli): crypto/rand secret + pg-password generation"
```

---

### Task 3: `.env` model — generate, render, parse, parity

**Files:**
- Create: `cli/internal/config/env.go`
- Test: `cli/internal/config/env_test.go`

**Interfaces:**
- Consumes: nothing (callers pass secrets + domain + version as strings).
- Produces: `config.Env` = an **ordered** list of `{Key, Value string}`; `config.GenerateEnv(baseURL, version, secretKey, pgPassword string) config.Env`; `config.RenderEnv(config.Env) string`; `config.ParseEnv(text string) map[string]string`; `config.ReadEnvFile(cfgdir string) (map[string]string, error)`.

- [ ] **Step 1: Write the failing test** `env_test.go` (key set + fixed values + password coupling + parity with `deploy/.env.prod.example`). The parity test reads `../../../deploy/.env.prod.example` (test CWD is the package dir `cli/internal/config`):

```go
package config

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func gen() Env {
	return GenerateEnv("https://learn.example.edu", "v0.1.1", "SECRET==", "abc123hex")
}

func TestEnvFixedValues(t *testing.T) {
	m := ParseEnv(RenderEnv(gen()))
	fixed := map[string]string{
		"POSTGRES_USER": "mathion", "POSTGRES_DB": "mathion",
		"MATHION_COOKIE_SECURE": "1", "MATHION_DEBUG": "0",
		"MATHION_EMAIL_MODE": "disabled",
		"MATHION_ASSET_PATH": "/data/mathion/assets",
		"MATHION_MAX_FILE_SIZE": "20971520", "MATHION_MAX_COURSE_SIZE": "524288000",
	}
	for k, v := range fixed {
		if m[k] != v {
			t.Errorf("%s = %q, want %q", k, m[k], v)
		}
	}
}

func TestEnvPasswordCoupling(t *testing.T) {
	m := ParseEnv(RenderEnv(gen()))
	if m["POSTGRES_PASSWORD"] != "abc123hex" {
		t.Fatalf("POSTGRES_PASSWORD=%q", m["POSTGRES_PASSWORD"])
	}
	if m["MATHION_DATABASE_URL"] != "postgresql+psycopg://mathion:abc123hex@db:5432/mathion" {
		t.Fatalf("DB URL = %q", m["MATHION_DATABASE_URL"])
	}
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" {
		t.Fatalf("BASE_URL = %q", m["MATHION_BASE_URL"])
	}
	if m["MATHION_VERSION"] != "v0.1.1" {
		t.Fatalf("VERSION = %q", m["MATHION_VERSION"])
	}
}

// exampleKeys parses the committed contract, ignoring comments/blanks.
func exampleKeys(t *testing.T) map[string]string {
	f, err := os.Open("../../../deploy/.env.prod.example")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		// strip trailing inline comments from the example's documented values
		v = strings.TrimSpace(strings.SplitN(v, "#", 2)[0])
		out[strings.TrimSpace(k)] = v
	}
	return out
}

func TestEnvKeyParityWithExample(t *testing.T) {
	gen := ParseEnv(RenderEnv(gen()))
	for k := range exampleKeys(t) {
		if _, ok := gen[k]; !ok {
			t.Errorf("generated .env missing key present in example: %s", k)
		}
	}
	for k := range gen {
		if _, ok := exampleKeys(t)[k]; !ok {
			t.Errorf("generated .env has key absent from example: %s", k)
		}
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go -C cli test ./internal/config/ -run TestEnv -v` → FAIL.

- [ ] **Step 3: Implement** `env.go` (ordered key list mirroring the §6 table + `.env.prod.example`; `ParseEnv` ignores blanks/comments):

```go
package config

import (
	"fmt"
	"sort"
	"strings"
)

type Env []struct{ Key, Value string }

func GenerateEnv(baseURL, version, secretKey, pgPassword string) Env {
	dbURL := fmt.Sprintf("postgresql+psycopg://mathion:%s@db:5432/mathion", pgPassword)
	return Env{
		{"MATHION_SECRET_KEY", secretKey},
		{"POSTGRES_USER", "mathion"},
		{"POSTGRES_DB", "mathion"},
		{"POSTGRES_PASSWORD", pgPassword},
		{"MATHION_DATABASE_URL", dbURL},
		{"MATHION_BASE_URL", baseURL},
		{"MATHION_COOKIE_SECURE", "1"},
		{"MATHION_DEBUG", "0"},
		{"MATHION_EMAIL_MODE", "disabled"},
		{"MATHION_ASSET_PATH", "/data/mathion/assets"},
		{"MATHION_MAX_FILE_SIZE", "20971520"},
		{"MATHION_MAX_COURSE_SIZE", "524288000"},
		{"MATHION_VERSION", version},
	}
}

func RenderEnv(e Env) string {
	var b strings.Builder
	for _, kv := range e {
		fmt.Fprintf(&b, "%s=%s\n", kv.Key, kv.Value)
	}
	return b.String()
}

func ParseEnv(text string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

// keysSorted is a helper for stable error messages in tests.
func keysSorted(m map[string]string) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}
```

Add `ReadEnvFile`:

```go
import "os"

func ReadEnvFile(cfgdir string) (map[string]string, error) {
	b, err := os.ReadFile(cfgdir + "/.env")
	if err != nil {
		return nil, err
	}
	return ParseEnv(string(b)), nil
}
```

> Note: `.env.prod.example` documents `MATHION_DATABASE_URL` with a `<same-hex-password>` placeholder and an inline `# comment`; the parity test compares **keys** (both directions) and the generator test asserts the fixed values, so the example's placeholder value never has to equal a generated secret. If `mathion` and the example diverge on the KEY SET, this test fails — which is the drift guard's whole point.

- [ ] **Step 4: Run tests** — `go -C cli test ./internal/config/ -run TestEnv -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config/env.go cli/internal/config/env_test.go
git commit -m "feat(cli): .env model + generation with key/value parity to .env.prod.example"
```

---

### Task 4: Domain→URL, email, OCI-tag validation (golden table)

**Files:**
- Create: `cli/internal/config/validate.go`
- Test: `cli/internal/config/validate_test.go`

**Interfaces:**
- Produces: `config.BuildBaseURL(domain string) (string, error)`; `config.ValidateEmail(s string) error`; `config.NormalizeEmail(s string) string`; `config.ValidateOCITag(s string) error`.

Rules replicate `backend/mathion/config.py` `_validate_base_url` (read it: no control/whitespace anywhere; scheme ∈ {http,https}; non-empty host; no userinfo; valid port; path ∈ {"","/"}; no query; no fragment).

- [ ] **Step 1: Write the failing test** `validate_test.go` — golden accept/reject table:

```go
package config

import "testing"

func TestBuildBaseURLAccept(t *testing.T) {
	for _, in := range []string{"learn.example.edu", "learn.example.edu:8443", "10.0.0.5:8000"} {
		got, err := BuildBaseURL(in)
		if err != nil {
			t.Errorf("BuildBaseURL(%q) unexpected err: %v", in, err)
			continue
		}
		if got != "https://"+in {
			t.Errorf("BuildBaseURL(%q) = %q, want https://%s", in, got, in)
		}
	}
}

func TestBuildBaseURLReject(t *testing.T) {
	bad := []string{
		"https://learn.example.edu",     // scheme typed into --domain
		"http://learn.example.edu",       // scheme typed in
		"user:pass@learn.example.edu",    // userinfo
		"learn.example.edu:99999",        // out-of-range port
		"learn.example.edu:notaport",     // bad port
		"learn.example.edu/admin",        // path
		"learn.example.edu?x=1",          // query
		"learn.example.edu#frag",         // fragment
		"learn.example.edu ",             // whitespace
		"learn\texample.edu",             // control/whitespace
		"",                               // empty host
	}
	for _, in := range bad {
		if _, err := BuildBaseURL(in); err == nil {
			t.Errorf("BuildBaseURL(%q) = nil err, want rejection", in)
		}
	}
}

func TestValidateEmail(t *testing.T) {
	for _, ok := range []string{"you@example.edu", "a.b+c@sub.example.com"} {
		if err := ValidateEmail(ok); err != nil {
			t.Errorf("ValidateEmail(%q) rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "noat", "a@b", "a @b.com", "a@b .com"} {
		if err := ValidateEmail(bad); err == nil {
			t.Errorf("ValidateEmail(%q) accepted, want reject", bad)
		}
	}
	if NormalizeEmail("  YOU@Example.EDU ") != "you@example.edu" {
		t.Errorf("NormalizeEmail did not trim+lowercase")
	}
}

func TestValidateOCITag(t *testing.T) {
	for _, ok := range []string{"v0.1.1", "latest", "sha-abc123", "1.2.3-rc.1"} {
		if err := ValidateOCITag(ok); err != nil {
			t.Errorf("ValidateOCITag(%q) rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "has space", "bad\ttab", ".startsdot", strings("a", 200)} {
		if err := ValidateOCITag(bad); err == nil {
			t.Errorf("ValidateOCITag(%q) accepted, want reject", bad)
		}
	}
}

func strings(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}
```

- [ ] **Step 2: Run to verify it fails** — `go -C cli test ./internal/config/ -run 'TestBuildBaseURL|TestValidate' -v` → FAIL.

- [ ] **Step 3: Implement** `validate.go`:

```go
package config

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
)

func hasCtrlOrSpace(s string) bool {
	for _, r := range s {
		if r < 0x20 || r == 0x7f || unicode.IsSpace(r) {
			return true
		}
	}
	return false
}

// BuildBaseURL takes an authority (host[:port], no scheme), constructs
// https://<authority>, and validates it against backend config.py rules.
func BuildBaseURL(domain string) (string, error) {
	if hasCtrlOrSpace(domain) {
		return "", fmt.Errorf("--domain contains control or whitespace characters: %q", domain)
	}
	if strings.Contains(domain, "://") {
		return "", fmt.Errorf("--domain must be a host[:port] authority, not a URL with a scheme: %q", domain)
	}
	raw := "https://" + domain
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("--domain is not a valid host: %q (%v)", domain, err)
	}
	if u.Host == "" {
		return "", fmt.Errorf("--domain missing host: %q", domain)
	}
	if u.User != nil {
		return "", fmt.Errorf("--domain must not contain userinfo (user:pass@): %q", domain)
	}
	if p := u.Port(); p != "" {
		if _, err := parsePort(p); err != nil {
			return "", fmt.Errorf("--domain has invalid port: %q", domain)
		}
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("--domain must not include a path: %q", domain)
	}
	if u.RawQuery != "" {
		return "", fmt.Errorf("--domain must not include a query string: %q", domain)
	}
	if u.Fragment != "" {
		return "", fmt.Errorf("--domain must not include a fragment: %q", domain)
	}
	return raw, nil
}

func parsePort(p string) (int, error) {
	var n int
	if _, err := fmt.Sscanf(p, "%d", &n); err != nil {
		return 0, err
	}
	if n < 1 || n > 65535 {
		return 0, fmt.Errorf("port out of range")
	}
	return n, nil
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func NormalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func ValidateEmail(s string) error {
	s = NormalizeEmail(s)
	if !emailRe.MatchString(s) {
		return fmt.Errorf("invalid email address: %q", s)
	}
	return nil
}

var ociTagRe = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$`)

func ValidateOCITag(s string) error {
	if !ociTagRe.MatchString(s) {
		return fmt.Errorf("invalid image tag: %q", s)
	}
	return nil
}
```

- [ ] **Step 4: Run tests** — `go -C cli test ./internal/config/ -run 'TestBuildBaseURL|TestValidate' -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config/validate.go cli/internal/config/validate_test.go
git commit -m "feat(cli): domain->URL/email/OCI-tag validation mirroring config.py"
```

---

### Task 5: Atomic write + install-state + config-dir safety

**Files:**
- Create: `cli/internal/config/state.go`
- Test: `cli/internal/config/state_test.go`

**Interfaces:**
- Produces: `config.AtomicWrite(path string, data []byte, mode os.FileMode) error`; `config.EnsureConfigDir(cfgdir string) error`; `config.State struct { Schema int; AdminEmail string }`; `config.WriteState(cfgdir string, s State) error`; `config.ReadState(cfgdir string) (State, error)`.

- [ ] **Step 1: Write the failing test** `state_test.go`:

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteModeAndContent(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	if err := AtomicWrite(p, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "hello" {
		t.Fatalf("content = %q", b)
	}
	fi, _ := os.Stat(p)
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", fi.Mode().Perm())
	}
	// no stale temp files left behind
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("expected only the target file, got %d entries", len(entries))
	}
}

func TestStateRoundTrip(t *testing.T) {
	dir := t.TempDir()
	if err := WriteState(dir, State{Schema: 1, AdminEmail: "you@example.edu"}); err != nil {
		t.Fatal(err)
	}
	got, err := ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.AdminEmail != "you@example.edu" || got.Schema != 1 {
		t.Fatalf("round-trip = %+v", got)
	}
	fi, _ := os.Stat(filepath.Join(dir, "install-state"))
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("state mode = %v, want 0600", fi.Mode().Perm())
	}
}

func TestReadStateMissingOrInvalid(t *testing.T) {
	dir := t.TempDir()
	if _, err := ReadState(dir); err == nil {
		t.Error("ReadState on missing file should error")
	}
	os.WriteFile(filepath.Join(dir, "install-state"), []byte("{ not json"), 0o600)
	if _, err := ReadState(dir); err == nil {
		t.Error("ReadState on invalid JSON should error")
	}
	os.WriteFile(filepath.Join(dir, "install-state"), []byte(`{"schema":1,"admin_email":""}`), 0o600)
	if _, err := ReadState(dir); err == nil {
		t.Error("ReadState with empty admin_email should error")
	}
}

func TestEnsureConfigDirRejectsSymlink(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "real")
	os.MkdirAll(real, 0o700)
	link := filepath.Join(base, "link")
	os.Symlink(real, link)
	if err := EnsureConfigDir(link); err == nil {
		t.Error("EnsureConfigDir should reject a symlinked config dir")
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go -C cli test ./internal/config/ -run 'TestAtomic|TestState|TestReadState|TestEnsure' -v` → FAIL.

- [ ] **Step 3: Implement** `state.go`:

```go
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// AtomicWrite writes data to path via a uniquely-named temp file in the same
// directory, fsync, then rename. mode is applied to the final file.
func AtomicWrite(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp) // no-op after a successful rename
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Chmod(mode); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func EnsureConfigDir(cfgdir string) error {
	if err := os.MkdirAll(cfgdir, 0o700); err != nil {
		return err
	}
	fi, err := os.Lstat(cfgdir)
	if err != nil {
		return err
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("config dir %q is a symlink; refusing (security)", cfgdir)
	}
	if !fi.IsDir() {
		return fmt.Errorf("config dir %q is not a directory", cfgdir)
	}
	if fi.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("config dir %q is group/world-writable (%v); refusing", cfgdir, fi.Mode().Perm())
	}
	// Root-ownership is enforced at runtime (install requires root); tests run
	// unprivileged, so ownership is not asserted here.
	return nil
}

type State struct {
	Schema     int    `json:"schema"`
	AdminEmail string `json:"admin_email"`
}

func WriteState(cfgdir string, s State) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return AtomicWrite(filepath.Join(cfgdir, "install-state"), b, 0o600)
}

func ReadState(cfgdir string) (State, error) {
	b, err := os.ReadFile(filepath.Join(cfgdir, "install-state"))
	if err != nil {
		return State{}, err
	}
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		return State{}, fmt.Errorf("install-state is not valid JSON: %w", err)
	}
	if s.Schema != 1 || s.AdminEmail == "" {
		return State{}, fmt.Errorf("install-state is incomplete or unknown schema (%d)", s.Schema)
	}
	return s, nil
}
```

- [ ] **Step 4: Run tests** — `go -C cli test ./internal/config/ -v` → PASS (whole package).

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config/state.go cli/internal/config/state_test.go
git commit -m "feat(cli): atomic writes, install-state, config-dir safety checks"
```

---

### Task 6: Embed compose + byte-identical drift guard

**Files:**
- Create: `cli/internal/compose/docker-compose.yml` (byte-identical copy), `cli/internal/compose/embed.go`
- Test: `cli/internal/compose/embed_test.go`

**Interfaces:**
- Produces: `compose.ComposeYAML []byte`.

- [ ] **Step 1: Copy the file byte-identically**

```bash
cp docker-compose.prod.yml cli/internal/compose/docker-compose.yml
```

- [ ] **Step 2: Write the failing test** `embed_test.go` (repo root is `../../../` from this package dir):

```go
package compose

import (
	"os"
	"testing"
)

func TestEmbeddedComposeMatchesRepoRoot(t *testing.T) {
	repo, err := os.ReadFile("../../../docker-compose.prod.yml")
	if err != nil {
		t.Fatal(err)
	}
	if string(ComposeYAML) != string(repo) {
		t.Fatal("embedded docker-compose.yml has drifted from repo-root docker-compose.prod.yml; re-copy it")
	}
}
```

- [ ] **Step 3: Run to verify it fails** — `go -C cli test ./internal/compose/ -run TestEmbedded -v` → FAIL (undefined `ComposeYAML`).

- [ ] **Step 4: Implement** `embed.go`:

```go
package compose

import _ "embed"

//go:embed docker-compose.yml
var ComposeYAML []byte
```

- [ ] **Step 5: Run tests** — `go -C cli test ./internal/compose/ -v` → PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/internal/compose/docker-compose.yml cli/internal/compose/embed.go cli/internal/compose/embed_test.go
git commit -m "feat(cli): embed docker-compose.yml with byte-identical drift guard"
```

---

### Task 7: Compose base args + `start` + `stop`

**Files:**
- Modify: `cli/cmd/root.go` (add `App.composeArgs`, `App.compose`), `cli/cmd/start.go`, `cli/cmd/stop.go`
- Test: `cli/cmd/start_test.go`, `cli/cmd/stop_test.go`

**Interfaces:**
- Consumes: `App.Runner`, `App.CfgDir`, `App.Project`.
- Produces: `App.composeArgs(sub ...string) []string`; `App.compose(ctx, sub ...string) error`.

- [ ] **Step 1: Write the failing test** `start_test.go`:

```go
package cmd

import (
	"context"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func newTestApp(f *compose.FakeRunner) *App {
	return &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f}
}

func TestStartArgv(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newStartCmd(newTestApp(f))
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "up", "-d", "--wait"}
	if len(f.Calls) != 1 || !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
	_ = context.Background()
}

func TestStopArgv(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newStopCmd(newTestApp(f))
	_ = cmd.RunE(cmd, nil)
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "stop"}
	if len(f.Calls) != 1 || !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go -C cli test ./cmd/ -run 'TestStart|TestStop' -v` → FAIL.

- [ ] **Step 3: Implement** the helpers in `root.go`:

```go
func (a *App) composeArgs(sub ...string) []string {
	base := []string{
		"compose", "-p", a.Project,
		"-f", a.CfgDir + "/docker-compose.yml",
		"--env-file", a.CfgDir + "/.env",
	}
	return append(base, sub...)
}

func (a *App) compose(ctx context.Context, sub ...string) error {
	return a.Runner.Run(ctx, a.composeArgs(sub...)...)
}
```

`cli/cmd/start.go`:

```go
package cmd

import "github.com/spf13/cobra"

func newStartCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "start",
		Short: "Start the stack (docker compose up -d --wait)",
		RunE: func(c *cobra.Command, _ []string) error {
			return app.compose(c.Context(), "up", "-d", "--wait")
		},
	}
}
```

`cli/cmd/stop.go`:

```go
package cmd

import "github.com/spf13/cobra"

func newStopCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the stack (containers stopped; data + config retained)",
		RunE: func(c *cobra.Command, _ []string) error {
			return app.compose(c.Context(), "stop")
		},
	}
}
```

> `c.Context()` is `nil` in a bare `cmd.RunE(cmd, nil)` unit call; `FakeRunner` ignores ctx, so tests pass. `Execute()` uses `ExecuteContext(context.Background())` in production.

- [ ] **Step 4: Run tests** — `go -C cli test ./cmd/ -run 'TestStart|TestStop' -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/root.go cli/cmd/start.go cli/cmd/stop.go cli/cmd/start_test.go cli/cmd/stop_test.go
git commit -m "feat(cli): compose arg base + start/stop commands"
```

---

### Task 8: `logs` + `status` + `version` + health probe

**Files:**
- Create: `cli/internal/dockerx/health.go`, `cli/cmd/logs.go`, `cli/cmd/status.go`, `cli/cmd/version.go`
- Test: `cli/internal/dockerx/health_test.go`, `cli/cmd/logs_test.go`, `cli/cmd/version_test.go`

**Interfaces:**
- Consumes: `App.compose`, `config.ReadEnvFile`, `buildVersion`.
- Produces: `dockerx.HealthProbe(ctx context.Context, url string) error`; `logs`/`status`/`version` commands.

- [ ] **Step 1: Write the failing tests.** `health_test.go`:

```go
package dockerx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthProbeOK(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer s.Close()
	if err := HealthProbe(context.Background(), s.URL+"/health"); err != nil {
		t.Fatalf("HealthProbe = %v, want nil", err)
	}
}

func TestHealthProbeBadBody(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"degraded"}`))
	}))
	defer s.Close()
	if err := HealthProbe(context.Background(), s.URL+"/health"); err == nil {
		t.Fatal("HealthProbe accepted a non-ok body")
	}
}
```

`logs_test.go` (argv for `logs -f app`):

```go
package cmd

import (
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestLogsArgvFollowService(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newLogsCmd(newTestApp(f))
	cmd.SetArgs([]string{"-f", "app"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "logs", "--follow", "app"}
	if len(f.Calls) != 1 || !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
}
```

`version_test.go` (prints build version + pinned `MATHION_VERSION` from `.env`):

```go
package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestVersionPrintsBoth(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_VERSION=v9.9.9\n"), 0o600)
	SetBuildInfo("cli-v0.1.0", "v0.1.1")
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out}
	cmd := newVersionCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	if !strings.Contains(s, "cli-v0.1.0") || !strings.Contains(s, "v9.9.9") {
		t.Fatalf("version output missing fields: %q", s)
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go -C cli test ./internal/dockerx/ ./cmd/ -run 'Health|Logs|Version' -v` → FAIL.

- [ ] **Step 3: Implement.** `health.go`:

```go
package dockerx

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func HealthProbe(ctx context.Context, url string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("/health returned %d", resp.StatusCode)
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if !strings.Contains(string(b), `"status":"ok"`) {
		return fmt.Errorf("/health body not ok: %q", string(b))
	}
	return nil
}
```

`logs.go` (a `--follow/-f` flag + optional `[app|db]` positional):

```go
package cmd

import "github.com/spf13/cobra"

func newLogsCmd(app *App) *cobra.Command {
	var follow bool
	c := &cobra.Command{
		Use:   "logs [app|db]",
		Short: "Show stack logs",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			sub := []string{"logs"}
			if follow {
				sub = append(sub, "--follow")
			}
			sub = append(sub, args...)
			return app.compose(c.Context(), sub...)
		},
	}
	c.Flags().BoolVarP(&follow, "follow", "f", false, "follow log output")
	return c
}
```

`version.go`:

```go
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

func newVersionCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print CLI + pinned image version",
		RunE: func(_ *cobra.Command, _ []string) error {
			img := "(not installed)"
			if m, err := config.ReadEnvFile(app.CfgDir); err == nil {
				if v := m["MATHION_VERSION"]; v != "" {
					img = v
				}
			}
			fmt.Fprintf(app.Out, "mathion %s\nimage %s\n", buildVersion, img)
			return nil
		},
	}
}
```

`status.go` (ps via compose + health probe + pinned version; prints a clear "stack is down" if ps shows nothing / health fails):

```go
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
)

func newStatusCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show stack status + /health",
		RunE: func(c *cobra.Command, _ []string) error {
			if err := app.compose(c.Context(), "ps"); err != nil {
				return err
			}
			img := ""
			if m, err := config.ReadEnvFile(app.CfgDir); err == nil {
				img = m["MATHION_VERSION"]
			}
			if err := dockerx.HealthProbe(c.Context(), "http://127.0.0.1:8000/health"); err != nil {
				fmt.Fprintf(app.Out, "stack not healthy: %v (is it running? `mathion start`)\n", err)
				return nil
			}
			fmt.Fprintf(app.Out, "healthy — image %s\n", img)
			return nil
		},
	}
}
```

- [ ] **Step 4: Run tests** — `go -C cli test ./internal/dockerx/ ./cmd/ -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/dockerx/health.go cli/internal/dockerx/health_test.go cli/cmd/logs.go cli/cmd/status.go cli/cmd/version.go cli/cmd/logs_test.go cli/cmd/version_test.go
git commit -m "feat(cli): logs/status/version commands + /health probe"
```

---

### Task 9: `superuser` + `pin`

**Files:**
- Create: `cli/cmd/superuser.go`, `cli/cmd/pin.go`
- Test: `cli/cmd/superuser_test.go`, `cli/cmd/pin_test.go`

**Interfaces:**
- Consumes: `App.compose`, `App.composeArgs`, `App.Runner`.
- Produces: `superuser <email>` (gates on exit code), `pin <email>` (surfaces stdout, does not gate).

- [ ] **Step 1: Write the failing tests.** `superuser_test.go`:

```go
package cmd

import (
	"errors"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestSuperuserArgvAndGating(t *testing.T) {
	f := &compose.FakeRunner{RunFunc: func(args []string) error { return errors.New("boom") }}
	cmd := newSuperuserCmd(newTestApp(f))
	cmd.SetArgs([]string{"you@example.edu"})
	err := cmd.Execute()
	if err == nil {
		t.Fatal("superuser must propagate a non-zero exit from create-superuser")
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", "you@example.edu"}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}
```

`pin_test.go` (argv + does NOT gate on exit):

```go
package cmd

import (
	"errors"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestPinArgvDoesNotGate(t *testing.T) {
	f := &compose.FakeRunner{RunFunc: func(args []string) error { return errors.New("ignored") }}
	cmd := newPinCmd(newTestApp(f))
	cmd.SetArgs([]string{"you@example.edu"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("pin must not gate on the subcommand exit code, got %v", err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", "you@example.edu"}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go -C cli test ./cmd/ -run 'Superuser|Pin' -v` → FAIL.

- [ ] **Step 3: Implement.** `superuser.go`:

```go
package cmd

import "github.com/spf13/cobra"

func newSuperuserCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "superuser <email>",
		Short: "Create or promote a superuser account (idempotent)",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			// create-superuser exits 0 on create/promote, non-zero on invalid
			// input — gate on the exit code.
			return app.compose(c.Context(), "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", args[0])
		},
	}
}
```

`pin.go`:

```go
package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newPinCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "pin <email>",
		Short: "Issue a first-login PIN (expires in 10 min; rate-limited 3/hour)",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			// The subcommand streams the PIN (or an error/rate-limit line) to
			// stdout and always exits 0 — surface its output, do NOT gate.
			_ = app.compose(c.Context(), "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", args[0])
			fmt.Fprintln(app.Out, "PIN expires in 10 min. Log in at your HTTPS domain — NOT http://127.0.0.1:8000 (the Secure cookie won't persist over plain HTTP).")
			return nil
		},
	}
}
```

> `app.compose` streams the container's stdout via `ExecRunner` (which wires `os.Stdout`). The operator sees the PIN directly; the CLI never captures or re-prints the secret.

- [ ] **Step 4: Run tests** — `go -C cli test ./cmd/ -run 'Superuser|Pin' -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/superuser.go cli/cmd/pin.go cli/cmd/superuser_test.go cli/cmd/pin_test.go
git commit -m "feat(cli): superuser (gated) + pin (non-gated, surfaces output) commands"
```

---

### Task 10: dockerx preflight + port + volume-exists

**Files:**
- Create: `cli/internal/dockerx/preflight.go`
- Test: `cli/internal/dockerx/preflight_test.go`

**Interfaces:**
- Consumes: `compose.Runner`.
- Produces: `dockerx.Preflight(ctx, r compose.Runner) error` (docker + `docker compose version` reachable); `dockerx.PortFree(addr string) error`; `dockerx.VolumeExists(ctx, r compose.Runner, name string) (bool, error)`.

- [ ] **Step 1: Write the failing test** `preflight_test.go`:

```go
package dockerx

import (
	"context"
	"net"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestVolumeExists(t *testing.T) {
	present := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "ok", nil }}
	got, err := VolumeExists(context.Background(), present, "mathion_prod_mathion_pgdata")
	if err != nil || !got {
		t.Fatalf("VolumeExists present = (%v,%v), want (true,nil)", got, err)
	}
	// docker volume inspect exits non-zero when the volume is absent.
	absent := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "", &exitErr{} }}
	got, err = VolumeExists(context.Background(), absent, "x")
	if err != nil || got {
		t.Fatalf("VolumeExists absent = (%v,%v), want (false,nil)", got, err)
	}
}

type exitErr struct{}

func (e *exitErr) Error() string { return "exit status 1" }

func TestPortFree(t *testing.T) {
	if err := PortFree("127.0.0.1:0"); err != nil {
		t.Fatalf("PortFree on an unused port errored: %v", err)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	if err := PortFree(ln.Addr().String()); err == nil {
		t.Fatal("PortFree should fail when the port is in use")
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go -C cli test ./internal/dockerx/ -run 'Volume|Port' -v` → FAIL.

- [ ] **Step 3: Implement** `preflight.go`:

```go
package dockerx

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func Preflight(ctx context.Context, r compose.Runner) error {
	if _, err := r.Output(ctx, "version"); err != nil {
		return fmt.Errorf("docker not available or daemon unreachable: %w", err)
	}
	if _, err := r.Output(ctx, "compose", "version"); err != nil {
		return fmt.Errorf("docker compose v2 not available: %w", err)
	}
	return nil
}

// PortFree returns an error if addr accepts a TCP connection (port in use).
func PortFree(addr string) error {
	c, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
	if err == nil {
		c.Close()
		return fmt.Errorf("%s is already in use", addr)
	}
	return nil
}

func VolumeExists(ctx context.Context, r compose.Runner, name string) (bool, error) {
	if _, err := r.Output(ctx, "volume", "inspect", name); err != nil {
		return false, nil // inspect exits non-zero when absent
	}
	return true, nil
}
```

- [ ] **Step 4: Run tests** — `go -C cli test ./internal/dockerx/ -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/dockerx/preflight.go cli/internal/dockerx/preflight_test.go
git commit -m "feat(cli): dockerx preflight, port probe, volume-exists"
```

---

### Task 11: `install` — fresh path

**Files:**
- Create: `cli/cmd/install.go`
- Test: `cli/cmd/install_fresh_test.go`

**Interfaces:**
- Consumes: everything above (`config.*`, `secrets.*`, `dockerx.*`, `compose.ComposeYAML`, `App.compose`, `buildDefaultImage`).
- Produces: `install` command with flags `--domain`, `--admin-email`, `--version`, `--yes`; helper `func (a *App) runInstall(ctx, opts installOpts) error`.

Fresh path (from §8, steps 2→8; the resume/fail-closed branch and the volume guard are Task 12). This task builds the happy fresh flow and its config-writing; Task 12 adds the branch that decides fresh-vs-resume-vs-abort **in front** of it.

- [ ] **Step 1: Write the failing test** `install_fresh_test.go` — drives a fresh install into a temp cfgdir with a fake runner and asserts: state written before `.env`, `.env` has generated secrets + constructed base URL, and the compose call sequence (pull, up, migrate, create-superuser):

```go
package cmd

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

func TestFreshInstallWritesConfigAndRuns(t *testing.T) {
	dir := t.TempDir()
	f := &compose.FakeRunner{} // all runs succeed, volume-inspect returns absent by default
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstallFresh(context.Background(), installOpts{
		Domain: "learn.example.edu", AdminEmail: "You@Example.edu", Version: "v0.1.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	// state persisted with the NORMALIZED email
	st, err := config.ReadState(dir)
	if err != nil || st.AdminEmail != "you@example.edu" {
		t.Fatalf("state = %+v, err=%v", st, err)
	}
	// .env present, base URL constructed, secrets non-empty & coupled
	m, err := config.ReadEnvFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" {
		t.Fatalf("base url = %q", m["MATHION_BASE_URL"])
	}
	if m["MATHION_SECRET_KEY"] == "" || m["POSTGRES_PASSWORD"] == "" {
		t.Fatal("secrets not generated")
	}
	// compose file materialized from the embed
	if b, _ := os.ReadFile(filepath.Join(dir, "docker-compose.yml")); string(b) != string(compose.ComposeYAML) {
		t.Fatal("compose file not written from embed")
	}
	// verify the ordered compose subcommands were invoked
	saw := func(sub string) bool {
		for _, c := range f.Calls {
			for _, a := range c {
				if a == sub {
					return true
				}
			}
		}
		return false
	}
	for _, s := range []string{"pull", "up", "upgrade", "create-superuser"} {
		if !saw(s) {
			t.Errorf("install never ran %q", s)
		}
	}
}
```

- [ ] **Step 2: Run to verify it fails** — `go -C cli test ./cmd/ -run TestFreshInstall -v` → FAIL.

- [ ] **Step 3: Implement** `install.go` (fresh path + flag wiring; the outer `runInstall` dispatcher is added in Task 12):

```go
package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/secrets"
)

type installOpts struct {
	Domain, AdminEmail, Version string
	Yes                          bool
}

func newInstallCmd(app *App) *cobra.Command {
	var o installOpts
	c := &cobra.Command{
		Use:   "install",
		Short: "Install and start a Mathion deployment",
		RunE: func(c *cobra.Command, _ []string) error {
			return app.runInstall(c.Context(), o) // dispatcher: Task 12
		},
	}
	c.Flags().StringVar(&o.Domain, "domain", "", "deployment domain (host[:port], no scheme)")
	c.Flags().StringVar(&o.AdminEmail, "admin-email", "", "first superuser email")
	c.Flags().StringVar(&o.Version, "version", "", "app image tag (default: recommended)")
	c.Flags().BoolVar(&o.Yes, "yes", false, "non-interactive: require --domain and --admin-email")
	return c
}

func (a *App) runInstallFresh(ctx context.Context, o installOpts) error {
	// 3. Gather + validate inputs.
	if o.Version == "" {
		o.Version = buildDefaultImage
	}
	if err := config.ValidateOCITag(o.Version); err != nil {
		return err
	}
	if err := config.ValidateEmail(o.AdminEmail); err != nil {
		return err
	}
	email := config.NormalizeEmail(o.AdminEmail)
	baseURL, err := config.BuildBaseURL(o.Domain)
	if err != nil {
		return err
	}

	// 4. Write config: compose + state BEFORE .env; .env LAST.
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(a.CfgDir+"/docker-compose.yml", composeBytes(), 0o644); err != nil {
		return err
	}
	if err := config.WriteState(a.CfgDir, config.State{Schema: 1, AdminEmail: email}); err != nil {
		return err
	}
	secret, err := secrets.SecretKey()
	if err != nil {
		return err
	}
	pw, err := secrets.PGPassword()
	if err != nil {
		return err
	}
	env := config.GenerateEnv(baseURL, o.Version, secret, pw)
	if err := config.AtomicWrite(a.CfgDir+"/.env", []byte(config.RenderEnv(env)), 0o600); err != nil {
		return err
	}

	// 5-7. Pull, up, migrate, create superuser.
	if err := a.compose(ctx, "pull"); err != nil {
		return err
	}
	if err := a.compose(ctx, "up", "-d", "--wait"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "alembic", "upgrade", "head"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", email); err != nil {
		return err
	}

	// 8. Next steps (no secrets printed).
	fmt.Fprintf(a.Out, nextSteps, o.Domain, email)
	return nil
}
```

Add a small `composeBytes()` wrapper in `cmd` (so `install.go` doesn't import the embed var name directly in two places) and the `nextSteps` template:

```go
import "github.com/svkucheryavski/mathion/cli/internal/compose"

func composeBytes() []byte { return compose.ComposeYAML }

const nextSteps = `
Deployment up. Next:
  1. Put a TLS-terminating reverse proxy in front (see README "Self-hosting").
  2. Log in at https://%s — NOT http://127.0.0.1:8000 (the Secure session cookie
     won't persist over plain HTTP).
  3. Issue your first-login PIN:  sudo mathion pin %s
  4. (optional) superuser panel URL: docker compose ... exec -T app python -m mathion.superuser activate
`
```

> Interactive prompting (when `--domain`/`--admin-email` are omitted and not `--yes`) reads from `app.In`. Add a minimal `promptIfEmpty(app, "domain")` helper here; in tests we always pass both values, so prompting is not exercised by the unit test. `--yes` requires both flags (error if either missing).

- [ ] **Step 4: Run tests** — `go -C cli test ./cmd/ -run TestFreshInstall -v` → PASS. (`runInstall` dispatcher is a stub that calls `runInstallFresh` until Task 12; add `func (a *App) runInstall(ctx context.Context, o installOpts) error { return a.runInstallFresh(ctx, o) }` temporarily.)

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/install.go cli/cmd/install_fresh_test.go
git commit -m "feat(cli): install fresh path — validate, write config, pull/up/migrate/superuser"
```

---

### Task 12: `install` — resume, fail-closed, volume guard

**Files:**
- Modify: `cli/cmd/install.go` (replace the `runInstall` dispatcher + preflight + branch logic)
- Test: `cli/cmd/install_resume_test.go`

**Interfaces:**
- Consumes: `config.ReadState`, `config.ReadEnvFile`, `dockerx.Preflight`, `dockerx.PortFree`, `dockerx.VolumeExists`.
- Produces: final `func (a *App) runInstall(ctx, o installOpts) error` implementing §8 step 1 (resume/fail-closed/volume-guard) then step 2 preflight, dispatching to `runInstallFresh` only on a clean slate.

- [ ] **Step 1: Write the failing tests** `install_resume_test.go`:

```go
package cmd

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// helper: a fake runner whose `volume inspect` reports the named volumes present.
func runnerWithVolumes(present map[string]bool) *compose.FakeRunner {
	return &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if len(args) >= 3 && args[0] == "volume" && args[1] == "inspect" {
			if present[args[2]] {
				return "ok", nil
			}
			return "", &noSuch{}
		}
		return "", nil
	}}
}

type noSuch struct{}

func (n *noSuch) Error() string { return "no such volume" }

func TestResumeReusesSecrets(t *testing.T) {
	dir := t.TempDir()
	// seed a complete prior install: state + .env
	config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"})
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "OLD_SECRET==", "oldhex")
	os.WriteFile(filepath.Join(dir, ".env"), []byte(config.RenderEnv(env)), 0o600)

	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstall(context.Background(), installOpts{Domain: "ignored.example.edu", AdminEmail: "new@x.edu", Version: "v9"}); err != nil {
		t.Fatal(err)
	}
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_SECRET_KEY"] != "OLD_SECRET==" || m["POSTGRES_PASSWORD"] != "oldhex" {
		t.Fatalf("resume regenerated secrets: %v", m)
	}
}

func TestFailClosedOnMissingState(t *testing.T) {
	dir := t.TempDir()
	// .env present but NO install-state → abort, no regen
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_SECRET_KEY=x\n"), 0o600)
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil || !strings.Contains(err.Error(), "install-state") {
		t.Fatalf("expected fail-closed on missing state, got %v", err)
	}
}

func TestVolumeGuardBlocksFreshOverExistingVolume(t *testing.T) {
	dir := t.TempDir() // no .env, no state → provisionally fresh
	f := runnerWithVolumes(map[string]bool{"mathion_prod_mathion_pgdata": true})
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil {
		t.Fatal("volume guard must abort a fresh install when a fixed-project volume exists")
	}
	// NO secret written
	if _, e := os.Stat(filepath.Join(dir, ".env")); e == nil {
		t.Fatal(".env was written despite the volume guard aborting")
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go -C cli test ./cmd/ -run 'Resume|FailClosed|VolumeGuard' -v` → FAIL (dispatcher still calls fresh directly).

- [ ] **Step 3: Implement** the real dispatcher in `install.go`, replacing the temporary stub:

```go
import (
	"os"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
)

func (a *App) runInstall(ctx context.Context, o installOpts) error {
	envPath := a.CfgDir + "/.env"
	_, statErr := os.Stat(envPath)
	envExists := statErr == nil

	// Step 2 (partial): docker/daemon reachable — needed by both branches.
	if err := dockerx.Preflight(ctx, a.Runner); err != nil {
		return err
	}

	if envExists {
		// RESUME or FAIL CLOSED. .env must be a complete, valid config.
		if fi, err := os.Lstat(envPath); err != nil || !fi.Mode().IsRegular() {
			return fmt.Errorf(".env at %s is not a regular file; repair it or run `mathion uninstall --purge`", envPath)
		}
		st, err := config.ReadState(a.CfgDir)
		if err != nil {
			return fmt.Errorf("install-state is missing or invalid (%w); repair it or run `mathion uninstall --purge`", err)
		}
		if _, err := config.ReadEnvFile(a.CfgDir); err != nil {
			return fmt.Errorf(".env is unreadable (%w); repair it or run `mathion uninstall --purge`", err)
		}
		warnDivergentFlags(a, o, st) // domain/email/version are ignored on resume
		return a.resume(ctx, st)
	}

	// FRESH branch: volume guard BEFORE any secret is generated.
	for _, vol := range []string{a.Project + "_mathion_pgdata", a.Project + "_mathion_assets"} {
		exists, err := dockerx.VolumeExists(ctx, a.Runner, vol)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("volume %s already exists but %s/.env is gone — refusing to regenerate secrets over initialized data. Restore .env, or run `mathion uninstall --purge` for a clean slate", vol, a.CfgDir)
		}
	}
	// Port preflight is fresh-only (on resume our own app legitimately holds it).
	if err := dockerx.PortFree("127.0.0.1:8000"); err != nil {
		return err
	}
	if o.Yes && (o.Domain == "" || o.AdminEmail == "") {
		return fmt.Errorf("--yes requires both --domain and --admin-email")
	}
	// (interactive prompt for any missing value when not --yes) — promptIfEmpty
	return a.runInstallFresh(ctx, o)
}

func warnDivergentFlags(a *App, o installOpts, st config.State) {
	if o.AdminEmail != "" && config.NormalizeEmail(o.AdminEmail) != st.AdminEmail {
		fmt.Fprintf(a.Err, "warning: --admin-email differs from the installed admin (%s); ignored on resume (use `mathion superuser`)\n", st.AdminEmail)
	}
	if o.Domain != "" || o.Version != "" {
		fmt.Fprintln(a.Err, "warning: --domain/--version are ignored on resume (Slice 3's `update` handles version bumps)")
	}
}

// resume re-materializes compose from the embed and re-runs idempotent steps.
func (a *App) resume(ctx context.Context, st config.State) error {
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(a.CfgDir+"/docker-compose.yml", composeBytes(), 0o644); err != nil {
		return err
	}
	if err := a.compose(ctx, "pull"); err != nil {
		return err
	}
	if err := a.compose(ctx, "up", "-d", "--wait"); err != nil {
		return err
	}
	if err := a.compose(ctx, "exec", "-T", "app", "alembic", "upgrade", "head"); err != nil {
		return err
	}
	return a.compose(ctx, "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", st.AdminEmail)
}
```

- [ ] **Step 4: Run the full cmd + package suites** — `go -C cli test ./... -v` → PASS (both fresh and resume/guard tests green).

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/install.go cli/cmd/install_resume_test.go
git commit -m "feat(cli): install resume, fail-closed, and volume guard"
```

---

### Task 13: `uninstall` + identity `--purge`

**Files:**
- Create: `cli/internal/dockerx/teardown.go`, `cli/cmd/uninstall.go`
- Test: `cli/internal/dockerx/teardown_test.go`, `cli/cmd/uninstall_test.go`

**Interfaces:**
- Consumes: `compose.Runner`, `App.compose`, `App.In`, `App.Project`, `App.CfgDir`.
- Produces: `dockerx.Purge(ctx, r compose.Runner, project string) error` (identity teardown, ordered, fail-on-non-absence); `uninstall` command with `--purge`.

- [ ] **Step 1: Write the failing tests** `teardown_test.go` (executable sequence: `ps -aq` discovery → conditional `rm -f` → inspect-then-remove network/volumes; empty container list skips `rm`; a non-absence `volume rm` failure fails teardown):

```go
package dockerx

import (
	"context"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// programmable fake: Output for ps/inspect, Run for rm/network rm/volume rm.
type purgeFake struct {
	compose.FakeRunner
	psIDs      string
	inspectOK  map[string]bool // resource name -> exists
	rmVolErr   map[string]error
}

func (p *purgeFake) Output(ctx context.Context, args ...string) (string, error) {
	p.Calls = append(p.Calls, args)
	switch {
	case args[0] == "ps":
		return p.psIDs, nil
	case args[0] == "network" && args[1] == "inspect":
		if p.inspectOK[args[2]] {
			return "ok", nil
		}
		return "", &noSuch{}
	case args[0] == "volume" && args[1] == "inspect":
		if p.inspectOK[args[2]] {
			return "ok", nil
		}
		return "", &noSuch{}
	}
	return "", nil
}

func (p *purgeFake) Run(ctx context.Context, args ...string) error {
	p.Calls = append(p.Calls, args)
	if args[0] == "volume" && args[1] == "rm" {
		if err := p.rmVolErr[args[2]]; err != nil {
			return err
		}
	}
	return nil
}

type noSuch struct{}

func (n *noSuch) Error() string { return "no such" }

func TestPurgeDiscoversAndRemovesInOrder(t *testing.T) {
	f := &purgeFake{
		psIDs:     "abc123\ndef456\n",
		inspectOK: map[string]bool{"mathion_prod_default": true, "mathion_prod_mathion_pgdata": true, "mathion_prod_mathion_assets": true},
	}
	if err := Purge(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	// container discovery + rm -f with the discovered ids
	assertCall(t, f.Calls, []string{"ps", "-aq", "--filter", "label=com.docker.compose.project=mathion_prod"})
	assertCall(t, f.Calls, []string{"rm", "-f", "abc123", "def456"})
	assertCall(t, f.Calls, []string{"network", "rm", "mathion_prod_default"})
	assertCall(t, f.Calls, []string{"volume", "rm", "mathion_prod_mathion_pgdata"})
	assertCall(t, f.Calls, []string{"volume", "rm", "mathion_prod_mathion_assets"})
}

func TestPurgeEmptyContainersSkipsRm(t *testing.T) {
	f := &purgeFake{psIDs: "\n", inspectOK: map[string]bool{"mathion_prod_mathion_pgdata": true}}
	if err := Purge(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.Calls {
		if len(c) > 0 && c[0] == "rm" {
			t.Fatal("rm invoked with no container IDs")
		}
	}
}

func TestPurgeVolumeInUseFailsTeardown(t *testing.T) {
	f := &purgeFake{
		psIDs:     "",
		inspectOK: map[string]bool{"mathion_prod_mathion_pgdata": true},
		rmVolErr:  map[string]error{"mathion_prod_mathion_pgdata": &noSuch{}}, // simulate a non-absence failure
	}
	if err := Purge(context.Background(), f, "mathion_prod"); err == nil {
		t.Fatal("a volume-rm failure on an existing volume must fail teardown")
	}
}

func assertCall(t *testing.T, calls [][]string, want []string) {
	t.Helper()
	for _, c := range calls {
		if reflect.DeepEqual(c, want) {
			return
		}
	}
	t.Fatalf("expected call %v not found in %v", want, calls)
}
```

`uninstall_test.go` (plain uninstall = compose down; purge gates on typed confirmation from stdin; cfgdir removed only after teardown):

```go
package cmd

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestUninstallPlainIsComposeDown(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newUninstallCmd(newTestApp(f))
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "down"}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}

func TestPurgeRequiresTypedProjectName(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600)
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr, In: strings.NewReader("wrong\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("purge must abort when the typed confirmation does not match the project name")
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e != nil {
		t.Fatal("cfgdir removed despite failed confirmation")
	}
}
```

- [ ] **Step 2: Run to verify they fail** — `go -C cli test ./internal/dockerx/ ./cmd/ -run 'Purge|Uninstall' -v` → FAIL.

- [ ] **Step 3: Implement** `teardown.go`:

```go
package dockerx

import (
	"context"
	"fmt"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// Purge tears down the resolved project's resources by name (config-independent).
// Order: containers -> network -> volumes. Only a not-found outcome is tolerated;
// any other failure fails teardown so the caller retains <cfgdir>.
func Purge(ctx context.Context, r compose.Runner, project string) error {
	out, err := r.Output(ctx, "ps", "-aq", "--filter", "label=com.docker.compose.project="+project)
	if err != nil {
		return fmt.Errorf("listing project containers: %w", err)
	}
	var ids []string
	for _, ln := range strings.Fields(out) {
		if ln != "" {
			ids = append(ids, ln)
		}
	}
	if len(ids) > 0 {
		if err := r.Run(ctx, append([]string{"rm", "-f"}, ids...)...); err != nil {
			return fmt.Errorf("removing containers: %w", err)
		}
	}
	if err := removeIfPresent(ctx, r, []string{"network", "inspect"}, []string{"network", "rm"}, project+"_default"); err != nil {
		return err
	}
	for _, vol := range []string{project + "_mathion_pgdata", project + "_mathion_assets"} {
		if err := removeIfPresent(ctx, r, []string{"volume", "inspect"}, []string{"volume", "rm"}, vol); err != nil {
			return err
		}
	}
	return nil
}

// removeIfPresent inspects a resource; if absent, skips (tolerated); if present,
// removes it and returns any removal error (a non-absence failure).
func removeIfPresent(ctx context.Context, r compose.Runner, inspect, remove []string, name string) error {
	if _, err := r.Output(ctx, append(inspect, name)...); err != nil {
		return nil // absent -> nothing to remove
	}
	if err := r.Run(ctx, append(remove, name)...); err != nil {
		return fmt.Errorf("removing %s: %w", name, err)
	}
	return nil
}
```

`uninstall.go`:

```go
package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
)

func newUninstallCmd(app *App) *cobra.Command {
	var purge bool
	c := &cobra.Command{
		Use:   "uninstall",
		Short: "Stop and remove containers (keeps data + config unless --purge)",
		RunE: func(c *cobra.Command, _ []string) error {
			if !purge {
				return app.compose(c.Context(), "down")
			}
			// --purge: identity-bound typed confirmation, then identity teardown,
			// then remove <cfgdir> only after teardown succeeds.
			pgdata := app.Project + "_mathion_pgdata"
			assets := app.Project + "_mathion_assets"
			fmt.Fprintf(app.Out, "This PERMANENTLY deletes project %q and volumes %s, %s.\nType the project name (%s) to confirm: ", app.Project, pgdata, assets, app.Project)
			line, _ := bufio.NewReader(app.In).ReadString('\n')
			if strings.TrimSpace(line) != app.Project {
				return fmt.Errorf("confirmation did not match %q; aborting", app.Project)
			}
			if err := dockerx.Purge(c.Context(), app.Runner, app.Project); err != nil {
				return err // teardown failed -> cfgdir retained
			}
			if err := os.RemoveAll(app.CfgDir); err != nil {
				return err
			}
			fmt.Fprintln(app.Out, "purged.")
			return nil
		},
	}
	c.Flags().BoolVar(&purge, "purge", false, "also remove volumes and config (destructive)")
	return c
}
```

- [ ] **Step 4: Run tests** — `go -C cli test ./... -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/dockerx/teardown.go cli/cmd/uninstall.go cli/internal/dockerx/teardown_test.go cli/cmd/uninstall_test.go
git commit -m "feat(cli): uninstall + identity-based --purge with typed confirmation"
```

---

### Task 14: `.goreleaser.yaml`

**Files:**
- Create: `cli/.goreleaser.yaml`
- Test: build validation (run goreleaser locally in check mode)

**Interfaces:** none (build config). Consumes `main.version`/`main.defaultImage` via ldflags.

- [ ] **Step 1: Write** `cli/.goreleaser.yaml` (version 2; build-only expectations; pinned templates per Global Constraints):

```yaml
version: 2

builds:
  - id: mathion
    main: ./
    binary: mathion
    env:
      - CGO_ENABLED=0
    goos: [linux]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w
      - -X main.version={{ .Env.CLI_TAG }}
      - -X main.defaultImage={{ .Env.APP_IMAGE }}

archives:
  - id: mathion
    name_template: "mathion_{{ .Os }}_{{ .Arch }}"
    formats: [tar.gz]

checksum:
  name_template: "checksums.txt"

release:
  disable: true   # goreleaser must NOT create the GitHub release; gh does (workflow)
```

> `.Env.CLI_TAG` (the full `cli-v*` tag) and `.Env.APP_IMAGE` (the recommended app image literal) are exported by `release-cli.yml` (Task 16). goreleaser's own version comes from `GORELEASER_CURRENT_TAG` (the sanitized semver) passed in the workflow — not from these env vars.

- [ ] **Step 2: Validate the config** — `go -C cli build ./...` compiles, and `cd cli && goreleaser check` reports the config is valid. If goreleaser is installed locally, dry-run the build:

```bash
cd cli && CLI_TAG=cli-v0.1.0 APP_IMAGE=v0.1.1 GORELEASER_CURRENT_TAG=v0.1.0 goreleaser release --clean --skip=publish --snapshot
# Expect dist/mathion_linux_amd64.tar.gz, dist/mathion_linux_arm64.tar.gz, dist/checksums.txt
ls dist/mathion_linux_amd64.tar.gz dist/mathion_linux_arm64.tar.gz dist/checksums.txt
```

Expected: exactly those three files exist (proves `name_template` + `checksum.name_template` match what `install.sh` will download). If goreleaser is not installed, note that CI (Task 16) runs this and the local check is deferred.

- [ ] **Step 3: Commit**

```bash
git add cli/.goreleaser.yaml
git commit -m "build(cli): goreleaser config (build-only, pinned archive + checksum names)"
```

---

### Task 15: `deploy/install.sh` + installer shell test

**Files:**
- Create: `deploy/install.sh`, `deploy/install_sh_test.sh`
- Test: `deploy/install_sh_test.sh` (runs against a local goreleaser `dist/`)

**Interfaces:** none (POSIX shell). Downloads the archive whose name matches `.goreleaser.yaml`'s `name_template`.

- [ ] **Step 1: Write** `deploy/install.sh` (POSIX `sh`; resolve latest `cli-v*` via paginated `/releases`, no `jq`; `uname -m` map with hard-fail; checksum-before-install; HTTPS-only `curl -f`):

```sh
#!/bin/sh
# Mathion CLI installer. Resolves the latest cli-v* release (or an explicit
# version arg), verifies the checksum, and installs to /usr/local/bin/mathion.
# Integrity only (checksums.txt), NOT authenticity — signing is Slice 4.
set -eu

REPO="svkucheryavski/mathion"
API="https://api.github.com/repos/${REPO}/releases"
DL="https://github.com/${REPO}/releases/download"
DEST="/usr/local/bin/mathion"

arch="$(uname -m)"
case "$arch" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac
ASSET="mathion_linux_${ARCH}.tar.gz"

TAG="${1:-}"
if [ -z "$TAG" ]; then
  page=1
  while [ -z "$TAG" ] && [ "$page" -le 10 ]; do
    body="$(curl -fsSL "${API}?per_page=100&page=${page}")" || break
    TAG="$(printf '%s' "$body" | grep -oE '"tag_name": *"cli-v[^"]*"' | head -1 | sed -E 's/.*"(cli-v[^"]*)".*/\1/')"
    [ -z "$body" ] || [ "$body" = "[]" ] && break
    page=$((page + 1))
  done
fi
[ -n "$TAG" ] || { echo "no cli-v* release found" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> Downloading ${ASSET} from ${TAG}"
curl -fsSL "${DL}/${TAG}/${ASSET}"        -o "${TMP}/${ASSET}"
curl -fsSL "${DL}/${TAG}/checksums.txt"   -o "${TMP}/checksums.txt"

echo "==> Verifying checksum"
( cd "$TMP" && grep " ${ASSET}\$" checksums.txt | sha256sum -c - ) \
  || { echo "checksum verification FAILED" >&2; exit 1; }

echo "==> Installing to ${DEST}"
tar -xzf "${TMP}/${ASSET}" -C "$TMP" mathion
install -m 0755 "${TMP}/mathion" "$DEST"
echo "==> Installed: $(${DEST} version 2>/dev/null | head -1 || echo mathion)"
```

- [ ] **Step 2: Write the failing test** `deploy/install_sh_test.sh` — builds a local `dist/` via goreleaser snapshot, serves it, and asserts `uname -m` mapping + checksum-before-install by pointing the installer at the local artifacts. Since networked GitHub calls aren't available in the test, factor the arch-map + checksum logic so the test drives them against `dist/`:

```sh
#!/bin/sh
set -eu
# Build local artifacts (mirrors release-cli.yml).
cd "$(dirname "$0")/../cli"
CLI_TAG=cli-v0.0.0-test APP_IMAGE=v0.1.1 GORELEASER_CURRENT_TAG=v0.0.0-test \
  goreleaser release --clean --skip=publish --snapshot
test -f dist/mathion_linux_amd64.tar.gz || { echo "FAIL: amd64 archive missing"; exit 1; }
test -f dist/mathion_linux_arm64.tar.gz || { echo "FAIL: arm64 archive missing"; exit 1; }
test -f dist/checksums.txt || { echo "FAIL: checksums.txt missing (name_template not pinned)"; exit 1; }
# checksum verifies for the host arch
case "$(uname -m)" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) echo "SKIP unknown arch"; exit 0;; esac
( cd dist && grep " mathion_linux_${A}.tar.gz\$" checksums.txt | sha256sum -c - ) || { echo "FAIL: checksum"; exit 1; }
echo "install_sh_test PASSED"
```

- [ ] **Step 3: Run the test** — `sh deploy/install_sh_test.sh` (requires goreleaser + Docker-free). Expected: `install_sh_test PASSED`. If goreleaser is absent locally, this is exercised in CI (Task 16).

- [ ] **Step 4: Commit**

```bash
git add deploy/install.sh deploy/install_sh_test.sh
git commit -m "feat(cli): curl|sh installer + shell test (arch map, checksum-before-install)"
```

---

### Task 16: CI wiring — `cli-unit` + `release-cli.yml` + integration test

**Files:**
- Modify: `.github/workflows/ci.yml` (add `cli-unit` job)
- Create: `.github/workflows/release-cli.yml`, `cli/integration_test.sh`

**Interfaces:** none.

- [ ] **Step 1: Add `cli-unit` to `ci.yml`** (fast, Docker-free; gates PRs + app releases). Append this job under `jobs:`:

```yaml
  cli-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.23"
      - name: Vet + unit tests
        working-directory: cli
        run: |
          go vet ./...
          go test ./...
```

- [ ] **Step 2: Write** `cli/integration_test.sh` (real Docker; mirrors `deploy/smoke.sh`; unique `-p` via `MATHION_PROJECT_OVERRIDE`; temp `MATHION_CONFIG_DIR`; asserts health + superuser row; purge confirmation piped via stdin):

```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")"
go build -o /tmp/mathion .

export MATHION_CONFIG_DIR="$(mktemp -d)"
export MATHION_PROJECT_OVERRIDE="mathion_it_$$"
cleanup() {
  printf '%s\n' "$MATHION_PROJECT_OVERRIDE" | /tmp/mathion uninstall --purge || true
  rm -rf "$MATHION_CONFIG_DIR" || true
}
trap cleanup EXIT

/tmp/mathion install --yes --domain localhost:8000 --admin-email you@example.edu --version "${APP_IMAGE:-v0.1.1}"
# NOTE: install builds MATHION_BASE_URL=https://localhost:8000; the /health probe
# still hits http://127.0.0.1:8000 (loopback), which is fine for the check.

curl -fsS http://127.0.0.1:8000/health | grep -q '"status":"ok"' || { echo "FAIL /health"; exit 1; }

CMP="docker compose -p ${MATHION_PROJECT_OVERRIDE} -f ${MATHION_CONFIG_DIR}/docker-compose.yml --env-file ${MATHION_CONFIG_DIR}/.env"
n="$($CMP exec -T db psql -U mathion -d mathion -tAc "select count(*) from users where is_superuser and email='you@example.edu'" | tr -d '[:space:]')"
[ "$n" = "1" ] || { echo "FAIL superuser row ($n)"; exit 1; }

# purge (typed confirmation piped)
printf '%s\n' "$MATHION_PROJECT_OVERRIDE" | /tmp/mathion uninstall --purge
docker volume inspect "${MATHION_PROJECT_OVERRIDE}_mathion_pgdata" >/dev/null 2>&1 && { echo "FAIL volume survived purge"; exit 1; }
echo "integration_test PASSED"
```

- [ ] **Step 3: Write** `.github/workflows/release-cli.yml` (dual trigger; unit + integration + install.sh on cli-touching PRs; goreleaser build-only + `gh release` gated to `cli-v*` tags):

```yaml
name: CLI release

on:
  push:
    tags: ["cli-v*"]
  pull_request:
    paths:
      - "cli/**"
      - "deploy/install.sh"
      - ".github/workflows/release-cli.yml"

permissions:
  contents: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.23" }
      - name: Unit
        working-directory: cli
        run: go vet ./... && go test ./...
      - name: Integration (real Docker install/purge)
        working-directory: cli
        run: sh integration_test.sh
      - uses: goreleaser/goreleaser-action@v6
        with: { install-only: true }
      - name: install.sh shell test
        run: sh deploy/install_sh_test.sh

  release:
    needs: [test]
    if: startsWith(github.ref, 'refs/tags/cli-v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.23" }
      - uses: goreleaser/goreleaser-action@v6
        with: { install-only: true }
      - name: Build (goreleaser, build-only on sanitized semver)
        working-directory: cli
        env:
          CLI_TAG: ${{ github.ref_name }}          # cli-v0.1.0 -> main.version
          APP_IMAGE: v0.1.1                          # recommended app image (hand-maintained)
        run: |
          SEMVER="v${CLI_TAG#cli-v}"                 # cli-v0.1.0 -> v0.1.0
          GORELEASER_CURRENT_TAG="$SEMVER" goreleaser release --clean --skip=publish
      - name: Publish release
        working-directory: cli
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "${{ github.ref_name }}" dist/*.tar.gz dist/checksums.txt --title "${{ github.ref_name }}" --notes "Mathion CLI ${{ github.ref_name }}"
```

- [ ] **Step 4: Validate locally what can be validated** — `go -C cli vet ./...`, `go -C cli test ./...` green; if Docker + goreleaser present, `sh cli/integration_test.sh` and `sh deploy/install_sh_test.sh` pass. YAML lints clean.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release-cli.yml cli/integration_test.sh
git commit -m "ci(cli): cli-unit gate + release-cli.yml (integration, installer, goreleaser+gh)"
```

---

### Task 17: README self-hosting CLI section

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add a "Self-hosting with the `mathion` CLI" subsection** to the existing self-hosting docs. It MUST state:
  - one-line install: `curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh | sudo sh`
  - the download-inspect-then-run alternative (trust model: integrity not authenticity; signing is Slice 4)
  - the command flow: `sudo mathion install` (domain + admin email) → set up TLS reverse proxy → log in at `https://<domain>` (NOT `http://127.0.0.1:8000`) → `sudo mathion pin <email>`
  - `enable docker at boot` note (`sudo systemctl enable docker`) since boot persistence relies on `restart: unless-stopped`
  - a command reference table (start/stop/status/logs/version/superuser/uninstall/`--purge`)

- [ ] **Step 2: Verify** the README renders (headings nest correctly, the install one-liner matches `install.sh`'s expected invocation).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: self-hosting with the mathion CLI (install, commands, trust model)"
```

---

## Self-Review

**1. Spec coverage.** Every §7 command → a task (start/stop T7; logs/status/version T8; superuser/pin T9; install T11–T12; uninstall/purge T13). §5 filesystem/atomicity → T5. §6 secrets/.env → T2–T3. §8.3 URL validation → T4. §8 install flow (resume/fail-closed/volume-guard) → T11–T12. §9 embed + drift guard → T6. §10 distribution (goreleaser + install.sh) → T14–T15. §11 testing (unit throughout; integration + install.sh in T16). §12/§13 boundaries/decisions honored in Global Constraints. §3 deterministic `-p` + hidden override → T1/T7. All covered.

**2. Placeholder scan.** No "TBD"/"add validation"/"similar to". Every code step has real code; every test step has real assertions; every run step has the exact command + expected result.

**3. Type consistency.** `Runner`/`FakeRunner` (T1) used verbatim in T7–T13. `App.compose`/`composeArgs` (T7) consumed by all command tasks. `config.State`/`AtomicWrite`/`BuildBaseURL`/`GenerateEnv`/`ReadEnvFile` (T3–T5) consumed by T8/T11/T12. `dockerx.VolumeExists`/`Preflight`/`PortFree` (T10) consumed by T12; `dockerx.Purge` (T13) signature matches its test. `installOpts`/`runInstall`/`runInstallFresh`/`resume` names consistent across T11–T12. `CLI_TAG`/`APP_IMAGE`/`GORELEASER_CURRENT_TAG` consistent across `.goreleaser.yaml` (T14) and `release-cli.yml` (T16). Archive name `mathion_linux_<arch>.tar.gz` consistent across T14/T15/T16.

**Known coordination notes for the executor:**
- T1 registers all nine subcommands as stubs so the module compiles; T7–T13 replace each stub's body. When a later task edits a command file first created as a stub in T1, `git add` that exact file.
- T11 temporarily wires `runInstall` → `runInstallFresh`; T12 replaces it with the real dispatcher. The T11 test targets `runInstallFresh` directly so it stays green after T12.
- Cross-dir test paths assume `go test` CWD == package dir: `cli/internal/config` → `../../../deploy/.env.prod.example`; `cli/internal/compose` → `../../../docker-compose.prod.yml`.
