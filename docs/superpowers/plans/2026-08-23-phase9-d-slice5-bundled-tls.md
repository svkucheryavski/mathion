# Phase 9-D Slice 5 — Bundled auto-TLS reverse proxy (`mathion tls`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `mathion tls enable --domain <fqdn> --email <addr>` path that stands up a bundled, network-segmented reverse proxy which obtains and auto-renews a Let's Encrypt certificate, with zero cert files to manage — while leaving today's external-proxy path unchanged.

**Architecture:** One `reproxy` service (digest-pinned) plus a `busybox` `proxy-init` chown one-shot are baked into both prod compose copies behind a Compose `profiles: ["tls"]`, dormant until enabled. A central three-way `--profile tls` split in `composeArgs` activates them operation-sensitively. A new `frontend` network joins `proxy`+`app`; `db` stays on `default` so a compromised proxy shares no network with Postgres. The load-bearing security control is an interpolation-safe input validator that rejects `$ { } " ' \`, whitespace, and control chars so a crafted domain/email can never expand a secret into the proxy env via Compose's recursive `.env` interpolation.

**Tech Stack:** Go 1.24 CLI (cobra), Docker Compose v2, reproxy, busybox, PostgreSQL 17, FastAPI/Svelte app (unchanged).

**Spec:** `docs/superpowers/specs/2026-08-23-phase9-d-slice5-bundled-tls-design.md` (rev 7, APPROVED). The plan argues from that spec; executors read both.

## Global Constraints

- **Go module:** `github.com/svkucheryavski/mathion/cli`, `go 1.24.0`. All Go work happens under `cli/`.
- **Two compose copies stay byte-identical:** repo-root `docker-compose.prod.yml` and the CLI-embedded `cli/internal/compose/docker-compose.yml`, guarded by `TestEmbeddedComposeMatchesRepoRoot` (`cli/internal/compose/embed_test.go`). Any edit to one must be copied verbatim to the other.
- **Pinned image digests (resolved 2026-08-23, immutable):** reproxy `ghcr.io/umputun/reproxy@sha256:456d9d2ac7321e2bbb729a5580259d4fc6b52d0310c6cb79c1e30350dd6ba0f7` (tag `v1.2.1`); busybox `busybox@sha256:7a3ebe5bfd1a4a19797d20b0c0bb39d44393e9a03fd852c0865b0f540d868df0` (tag `1.37.0`). Use these exact digests.
- **Production is HTTPS-only.** `tls disable` never downgrades: it clears the TLS vars but leaves `MATHION_BASE_URL=https://…` and `MATHION_COOKIE_SECURE=1`.
- **Interpolation-safe validator is the load-bearing defense.** Compose recursively expands `.env` values, so `MATHION_TLS_EMAIL=${POSTGRES_PASSWORD}@x.y` would leak the DB password into `SSL_ACME_EMAIL`. Rejecting `$ { } " ' \`, whitespace, and control chars at the input boundary is mandatory and must be tested.
- **No backend changes.** The app consumes no forwarded headers; `MATHION_COOKIE_SECURE`/`MATHION_BASE_URL` already drive its behavior.
- **Test command (whole module):** `cd cli && go test ./...`. Also run `cd cli && gofmt -l .` (must print nothing) and `cd cli && go vet ./...` before each commit.
- **Commit trailer (exact):** end every commit message with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **`git add` exact named paths only** — never `git add -A`/`.`.
- **Branch:** `feat/phase9-d-slice5-bundled-tls` (already checked out; the spec is committed here).

---

### Task 1: Compose services, network, volume + digest pins + embed sync

**Files:**
- Modify: `docker-compose.prod.yml` (full rewrite — 41 → ~110 lines)
- Modify: `cli/internal/compose/docker-compose.yml` (byte-identical copy of the above)
- Test: `cli/internal/compose/embed_test.go`

**Interfaces:**
- Produces: a `proxy` service and a `proxy-init` service both under `profiles: ["tls"]`; a top-level `frontend` network; `app` on `networks: [default, frontend]`; `db` unchanged on `default`; a `mathion_acme` volume. Consumed by every later task via `${MATHION_TLS_DOMAIN}`/`${MATHION_TLS_EMAIL}` interpolation and the `--profile tls` selector.

- [ ] **Step 1: Write the full new `docker-compose.prod.yml`**

Replace the entire file with:

```yaml
name: mathion_prod

services:
  app:
    image: ghcr.io/svkucheryavski/mathion:${MATHION_VERSION}
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - mathion_assets:/data/mathion/assets
    ports:
      - "127.0.0.1:8000:8000"
    networks: [default, frontend]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status==200 else 1)"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 10s
    restart: unless-stopped
    stop_grace_period: 35s

  db:
    image: postgres:17
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - mathion_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 2s
      timeout: 3s
      retries: 30
    restart: unless-stopped

  # One-shot: make the fresh (root-owned) mathion_acme volume writable by the
  # non-root proxy (uid 1001), then exit. Required because the reproxy image is
  # FROM scratch (no chown/shell) and cannot self-fix ownership. NON-recursive
  # chown (not -R) so CAP_CHOWN alone suffices — no directory traversal into
  # reproxy's 0700 subtree. Only instantiated under the `tls` profile.
  proxy-init:
    image: busybox@sha256:7a3ebe5bfd1a4a19797d20b0c0bb39d44393e9a03fd852c0865b0f540d868df0
    profiles: ["tls"]
    command: ["chown", "1001:1001", "/srv/acme"]
    volumes:
      - mathion_acme:/srv/acme
    network_mode: none
    cap_drop: [ALL]
    cap_add: [CHOWN]
    security_opt: ["no-new-privileges:true"]
    restart: "no"

  # Bundled auto-HTTPS reverse proxy (Let's Encrypt). Dormant unless the `tls`
  # profile is active (`mathion tls enable`). NO env_file: it receives ONLY the
  # explicit SSL_*/STATIC_*/MAX_SIZE vars; domain/email arrive via ${...}
  # interpolation from --env-file .env, so no app/DB secret is ever in its env.
  proxy:
    image: ghcr.io/umputun/reproxy@sha256:456d9d2ac7321e2bbb729a5580259d4fc6b52d0310c6cb79c1e30350dd6ba0f7
    profiles: ["tls"]
    depends_on:
      app:
        condition: service_healthy
      proxy-init:
        condition: service_completed_successfully
    ports:
      - "80:8080"
      - "443:8443"
    environment:
      SSL_TYPE: auto
      SSL_ACME_EMAIL: ${MATHION_TLS_EMAIL}
      SSL_ACME_FQDN: ${MATHION_TLS_DOMAIN}
      SSL_ACME_LOCATION: /srv/acme
      STATIC_ENABLED: "true"
      STATIC_RULES: "${MATHION_TLS_DOMAIN},/,http://app:8000/"
      MAX_SIZE: "25M"
    volumes:
      - mathion_acme:/srv/acme
    networks: [frontend]
    user: "1001:1001"
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    read_only: true
    tmpfs: [/tmp]
    restart: unless-stopped

networks:
  frontend: {}

volumes:
  mathion_assets:
  mathion_pgdata:
  mathion_acme:
```

- [ ] **Step 2: Copy byte-identical into the embedded compose**

Run:

```bash
cp /Users/svkucheryavski/Documents/Developing/mathion/docker-compose.prod.yml \
   /Users/svkucheryavski/Documents/Developing/mathion/cli/internal/compose/docker-compose.yml
```

- [ ] **Step 3: Write the failing structural test**

Append to `cli/internal/compose/embed_test.go`:

```go
func TestEmbeddedComposeDeclaresTLSProfile(t *testing.T) {
	s := string(ComposeYAML)
	for _, want := range []string{
		"ghcr.io/umputun/reproxy@sha256:456d9d2ac7321e2bbb729a5580259d4fc6b52d0310c6cb79c1e30350dd6ba0f7",
		"busybox@sha256:7a3ebe5bfd1a4a19797d20b0c0bb39d44393e9a03fd852c0865b0f540d868df0",
		"proxy-init:",
		`profiles: ["tls"]`,
		`command: ["chown", "1001:1001", "/srv/acme"]`,
		"SSL_TYPE: auto",
		`STATIC_RULES: "${MATHION_TLS_DOMAIN},/,http://app:8000/"`,
		`MAX_SIZE: "25M"`,
		"networks: [default, frontend]", // app dual membership
		"networks: [frontend]",          // proxy only
		"frontend: {}",
		"mathion_acme:",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("embedded compose missing %q", want)
		}
	}
	// The proxy MUST NOT carry env_file (it would import the DB secrets). The only
	// env_file in the file is the app's.
	if strings.Count(s, "env_file:") != 1 {
		t.Errorf("expected exactly one env_file (app's); got %d — proxy must not have one", strings.Count(s, "env_file:"))
	}
}
```

Add `"strings"` to the imports of `embed_test.go` (currently `"os"`, `"testing"`).

- [ ] **Step 4: Run tests**

Run: `cd cli && go test ./internal/compose/... -run 'TestEmbedded' -v`
Expected: `TestEmbeddedComposeMatchesRepoRoot` PASS (files identical) and `TestEmbeddedComposeDeclaresTLSProfile` PASS.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml cli/internal/compose/docker-compose.yml cli/internal/compose/embed_test.go
git commit -m "$(cat <<'EOF'
feat(cli): bake dormant tls-profile proxy + proxy-init into prod compose

Add digest-pinned reproxy + busybox chown one-shot behind profiles:[tls],
a frontend network (proxy+app), app dual-membership, and mathion_acme volume.
db stays on default so a compromised proxy shares no network with Postgres.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Runner strips the TLS/profile keys from the child env

**Files:**
- Modify: `cli/internal/compose/runner.go:57-62` (`strippedEnvKeys`)
- Test: `cli/internal/compose/runner_test.go`

**Interfaces:**
- Produces: `COMPOSE_PROFILES`, `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL` are removed from every compose child env, so an ambient `COMPOSE_PROFILES=tls` cannot activate the proxy and `--env-file .env` stays authoritative for the `${MATHION_TLS_*}` interpolation.

- [ ] **Step 1: Write the failing test**

Append to `cli/internal/compose/runner_test.go` (create the file if it does not exist, with `package compose` and imports `"os"`, `"strings"`, `"testing"`):

```go
func TestSanitizedEnvironStripsTLSKeys(t *testing.T) {
	for _, k := range []string{"COMPOSE_PROFILES", "MATHION_TLS_DOMAIN", "MATHION_TLS_EMAIL"} {
		t.Setenv(k, "poison")
	}
	got := sanitizedEnviron()
	for _, kv := range got {
		key, _, _ := strings.Cut(kv, "=")
		switch key {
		case "COMPOSE_PROFILES", "MATHION_TLS_DOMAIN", "MATHION_TLS_EMAIL":
			t.Errorf("child env must not carry %s (ambient COMPOSE_PROFILES=tls must never activate the proxy)", key)
		}
	}
	_ = os.Environ
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cli && go test ./internal/compose/... -run TestSanitizedEnvironStripsTLSKeys -v`
Expected: FAIL — the three keys are still present.

- [ ] **Step 3: Add the three keys to `strippedEnvKeys`**

In `cli/internal/compose/runner.go`, replace the `strippedEnvKeys` map so it reads:

```go
var strippedEnvKeys = map[string]struct{}{
	"MATHION_VERSION":    {},
	"POSTGRES_USER":      {},
	"POSTGRES_PASSWORD":  {},
	"POSTGRES_DB":        {},
	"COMPOSE_PROFILES":   {},
	"MATHION_TLS_DOMAIN": {},
	"MATHION_TLS_EMAIL":  {},
}
```

Update the doc comment above `strippedEnvKeys` to add: "COMPOSE_PROFILES and the MATHION_TLS_* pair are stripped so an ambient `COMPOSE_PROFILES=tls` cannot activate the bundled proxy and `--env-file .env` stays authoritative for `${MATHION_TLS_*}` interpolation."

- [ ] **Step 4: Run tests**

Run: `cd cli && go test ./internal/compose/... -v`
Expected: PASS (new test + all existing runner tests).

- [ ] **Step 5: Commit**

```bash
git add cli/internal/compose/runner.go cli/internal/compose/runner_test.go
git commit -m "$(cat <<'EOF'
feat(cli): strip COMPOSE_PROFILES + MATHION_TLS_* from compose child env

Blocks an ambient COMPOSE_PROFILES=tls from activating the bundled proxy and
keeps --env-file .env authoritative for the ${MATHION_TLS_*} interpolation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Strict, interpolation-safe domain/email validators

**Files:**
- Modify: `cli/internal/config/validate.go` (add validators; do NOT change the existing `ValidateEmail`/`emailRe` — admin-email keeps its current rules)
- Test: `cli/internal/config/validate_test.go` (create if absent)

**Interfaces:**
- Produces: `ValidateDomain(s string) error`, `ValidateTLSEmail(s string) error`, `hasInterpolationMeta(s string) bool`. Consumed by Task 4 (`SetTLS`, pair-consistency) and Task 7 (`tls enable`).

**Note (design decision — flag for review):** we add a *separate* `ValidateTLSEmail` rather than tightening `ValidateEmail`. `ValidateEmail` gates the admin-email, which flows only into install-state + superuser creation — it never reaches a Compose-interpolated `.env` value. The interpolation risk is specific to the TLS email that lands in `.env → SSL_ACME_EMAIL`, so scoping the strict validator there adds the load-bearing defense exactly where it is needed without regressing install's admin-email acceptance.

- [ ] **Step 1: Write the failing tests**

Create `cli/internal/config/validate_test.go`:

```go
package config

import "testing"

func TestValidateDomain(t *testing.T) {
	good := []string{"example.edu", "learn.example.edu", "a.b.c.example.com", "x-y.example.io"}
	for _, s := range good {
		if err := ValidateDomain(s); err != nil {
			t.Errorf("ValidateDomain(%q) = %v, want nil", s, err)
		}
	}
	bad := []string{
		"", "localhost", "example", // <2 labels
		"Example.edu",   // uppercase
		"a..b",          // empty label
		"-a.example",    // leading hyphen
		"a-.example",    // trailing hyphen
		".example.edu",  // leading dot
		"example.edu.",  // trailing dot
		"1.2.3.4",       // IPv4 literal (numeric TLD)
		"a b.example",   // whitespace
		"a$b.example",   // interpolation meta
		"${X}.example",  // interpolation
		`a".example`,    // quote
	}
	for _, s := range bad {
		if err := ValidateDomain(s); err == nil {
			t.Errorf("ValidateDomain(%q) = nil, want error", s)
		}
	}
}

func TestValidateTLSEmail(t *testing.T) {
	good := []string{"admin@example.edu", "ops.team@learn.example.edu"}
	for _, s := range good {
		if err := ValidateTLSEmail(s); err != nil {
			t.Errorf("ValidateTLSEmail(%q) = %v, want nil", s, err)
		}
	}
	// The load-bearing case: an interpolation payload must be rejected at input.
	bad := []string{
		"", "no-at-sign", "a@@b.com", "@example.edu", "admin@localhost",
		"${POSTGRES_PASSWORD}@x.y", // the DB-password leak payload
		"a$b@example.edu",
		`a"@example.edu`,
		"a b@example.edu", // whitespace
		"admin@ex ample.edu",
	}
	for _, s := range bad {
		if err := ValidateTLSEmail(s); err == nil {
			t.Errorf("ValidateTLSEmail(%q) = nil, want error", s)
		}
	}
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./internal/config/... -run 'TestValidateDomain|TestValidateTLSEmail' -v`
Expected: FAIL with "undefined: ValidateDomain" / "undefined: ValidateTLSEmail".

- [ ] **Step 3: Implement the validators**

Append to `cli/internal/config/validate.go`:

```go
// dnsLabelRe matches a single DNS label: 1–63 chars of lowercase ASCII alnum, with
// internal (not leading/trailing) hyphens. The charset also rejects every
// dotenv/Compose interpolation metacharacter ($ { } " ' \), whitespace, and control
// char, so a validated label can never carry interpolation syntax.
var dnsLabelRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// ValidateDomain checks s is a proper, lowercase, public DNS hostname safe to
// interpolate into .env / a compose value: >=2 labels, each 1–63 chars, total <=253,
// no scheme/port/path, TLD not all-numeric (rejects IP literals), and — via the label
// charset — none of $ { } " ' \, whitespace, or control chars. Rejecting these at the
// input boundary is the load-bearing defense (spec §12) against a crafted domain
// expanding a secret into SSL_ACME_*.
func ValidateDomain(s string) error {
	if s == "" {
		return fmt.Errorf("domain is required")
	}
	if s != strings.ToLower(s) {
		return fmt.Errorf("domain must be lowercase: %q", s)
	}
	if len(s) > 253 {
		return fmt.Errorf("domain is too long (>253 chars)")
	}
	if strings.HasPrefix(s, ".") || strings.HasSuffix(s, ".") {
		return fmt.Errorf("domain must not start or end with a dot: %q", s)
	}
	labels := strings.Split(s, ".")
	if len(labels) < 2 {
		return fmt.Errorf("domain must be a fully-qualified name with at least two labels: %q", s)
	}
	for _, l := range labels {
		if len(l) < 1 || len(l) > 63 || !dnsLabelRe.MatchString(l) {
			return fmt.Errorf("domain has an invalid label %q in %q", l, s)
		}
	}
	tld := labels[len(labels)-1]
	if !strings.ContainsFunc(tld, func(r rune) bool { return r >= 'a' && r <= 'z' }) {
		return fmt.Errorf("domain's top-level label must contain a letter (not an IP literal): %q", s)
	}
	return nil
}

// hasInterpolationMeta reports whether s carries any dotenv/Compose interpolation
// metacharacter ($ { } " ' \), whitespace, or control char — none of which may appear
// in a value interpolated into .env / a compose environment.
func hasInterpolationMeta(s string) bool {
	if hasCtrlOrSpace(s) {
		return true
	}
	return strings.ContainsAny(s, "${}\"'\\")
}

// ValidateTLSEmail validates the Let's Encrypt contact email that lands in
// .env → SSL_ACME_EMAIL. Interpolation-safe (spec §12): rejects $ { } " ' \,
// whitespace, and control chars anywhere; requires exactly one '@', a non-empty local
// part, and a domain part validated by ValidateDomain. Distinct from ValidateEmail
// (admin-email), which never reaches a compose-interpolated value.
func ValidateTLSEmail(s string) error {
	if s == "" {
		return fmt.Errorf("email is required")
	}
	if hasInterpolationMeta(s) {
		return fmt.Errorf("email contains interpolation-unsafe characters: %q", s)
	}
	local, domain, ok := strings.Cut(s, "@")
	if !ok || strings.Contains(domain, "@") {
		return fmt.Errorf("email must contain exactly one '@': %q", s)
	}
	if local == "" {
		return fmt.Errorf("email has an empty local part: %q", s)
	}
	if err := ValidateDomain(strings.ToLower(domain)); err != nil {
		return fmt.Errorf("email domain is invalid: %w", err)
	}
	return nil
}
```

(`validate.go` already imports `fmt`, `regexp`, `strings` — no import change needed.)

- [ ] **Step 4: Run tests**

Run: `cd cli && go test ./internal/config/... -run 'TestValidateDomain|TestValidateTLSEmail' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/internal/config/validate.go cli/internal/config/validate_test.go
git commit -m "$(cat <<'EOF'
feat(cli): interpolation-safe ValidateDomain + ValidateTLSEmail

Strict DNS-label domain validation and a TLS-email validator that rejects
$ { } " ' \, whitespace, and control chars — the load-bearing defense against
a crafted value expanding a secret into SSL_ACME_* via compose interpolation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `.env` TLS vars, `SetTLS`/`ClearTLS`, pair-consistency, example parity

**Files:**
- Modify: `cli/internal/config/env.go` (`GenerateEnv`; add `rewriteEnv`, `SetTLS`, `ClearTLS`; extend `ValidateEnvComplete`)
- Modify: `deploy/.env.prod.example` (add the two keys so the parity test holds)
- Test: `cli/internal/config/env_test.go`

**Interfaces:**
- Consumes: `ValidateDomain`, `ValidateTLSEmail` (Task 3); `BuildBaseURL`, `AtomicWrite`, `ReadEnvFile`, `envLineKey` (existing).
- Produces: `SetTLS(cfgdir, domain, email string) error`, `ClearTLS(cfgdir string) error`. `GenerateEnv` now emits `MATHION_TLS_DOMAIN`/`MATHION_TLS_EMAIL` (empty). `ValidateEnvComplete` enforces the TLS pair invariant. Consumed by Tasks 5–9.

- [ ] **Step 1: Write the failing tests**

Append to `cli/internal/config/env_test.go`:

```go
func TestSetAndClearTLS(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(RenderEnv(gen())), 0o600)

	if err := SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
		t.Fatal(err)
	}
	m, _ := ReadEnvFile(dir)
	if m["MATHION_TLS_DOMAIN"] != "learn.example.edu" || m["MATHION_TLS_EMAIL"] != "admin@example.edu" {
		t.Fatalf("TLS vars not set: %q / %q", m["MATHION_TLS_DOMAIN"], m["MATHION_TLS_EMAIL"])
	}
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" {
		t.Fatalf("base-url not repinned: %q", m["MATHION_BASE_URL"])
	}
	if m["MATHION_COOKIE_SECURE"] != "1" {
		t.Fatalf("cookie-secure = %q, want 1", m["MATHION_COOKIE_SECURE"])
	}
	if err := ValidateEnvComplete(m); err != nil {
		t.Fatalf("post-SetTLS .env must validate: %v", err)
	}

	// A hostile input must be rejected BEFORE any write (file byte-identical).
	before, _ := os.ReadFile(dir + "/.env")
	if err := SetTLS(dir, "learn.example.edu", "${POSTGRES_PASSWORD}@x.y"); err == nil {
		t.Fatal("SetTLS must reject an interpolation payload")
	}
	after, _ := os.ReadFile(dir + "/.env")
	if string(before) != string(after) {
		t.Fatal("a rejected SetTLS must leave .env byte-identical")
	}

	if err := ClearTLS(dir); err != nil {
		t.Fatal(err)
	}
	m, _ = ReadEnvFile(dir)
	if m["MATHION_TLS_DOMAIN"] != "" || m["MATHION_TLS_EMAIL"] != "" {
		t.Fatalf("ClearTLS left TLS vars: %q / %q", m["MATHION_TLS_DOMAIN"], m["MATHION_TLS_EMAIL"])
	}
	// Disable never downgrades: base-url + cookie-secure survive.
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" || m["MATHION_COOKIE_SECURE"] != "1" {
		t.Fatalf("ClearTLS must preserve https posture: %q / %q", m["MATHION_BASE_URL"], m["MATHION_COOKIE_SECURE"])
	}
}

func TestValidateEnvCompleteTLSPair(t *testing.T) {
	base := ParseEnv(RenderEnv(gen())) // both TLS keys empty -> valid (disabled)
	if err := ValidateEnvComplete(base); err != nil {
		t.Fatalf("a fresh .env (TLS empty) must validate: %v", err)
	}
	// Half-set pair -> reject.
	half := ParseEnv(RenderEnv(gen()))
	half["MATHION_TLS_DOMAIN"] = "learn.example.edu"
	if err := ValidateEnvComplete(half); err == nil {
		t.Error("a half-set TLS pair must be rejected")
	}
	// Interpolation payload smuggled into the email -> reject.
	bad := ParseEnv(RenderEnv(gen()))
	bad["MATHION_TLS_DOMAIN"] = "learn.example.edu"
	bad["MATHION_TLS_EMAIL"] = "${POSTGRES_PASSWORD}@x.y"
	bad["MATHION_BASE_URL"] = "https://learn.example.edu"
	if err := ValidateEnvComplete(bad); err == nil {
		t.Error("an interpolation payload in MATHION_TLS_EMAIL must be rejected by an update/resume")
	}
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./internal/config/... -run 'TestSetAndClearTLS|TestValidateEnvCompleteTLSPair' -v`
Expected: FAIL (undefined `SetTLS`/`ClearTLS`; pair check not yet present).

- [ ] **Step 3: Add the two vars to `GenerateEnv`**

In `cli/internal/config/env.go`, in `GenerateEnv`, add two entries at the end of the returned `Env` (after `{"MATHION_VERSION", version}`):

```go
		{"MATHION_VERSION", version},
		{"MATHION_TLS_DOMAIN", ""},
		{"MATHION_TLS_EMAIL", ""},
	}
```

- [ ] **Step 4: Add `rewriteEnv`, `SetTLS`, `ClearTLS`**

Append to `cli/internal/config/env.go`:

```go
// envUpdate is one key/value change for rewriteEnv.
type envUpdate struct{ Key, Value string }

// rewriteEnv applies each update to <cfgdir>/.env line-orientedly (like
// RepinVersion, but for multiple keys): the FIRST matching line is rewritten,
// later exact-key duplicates are dropped, keys never seen are appended (in the
// given order) before any trailing newline, and every other line passes through
// verbatim. It writes atomically at 0o600, then re-reads and asserts every update
// took AND the whole file still passes ValidateEnvComplete, so a rewrite can never
// leave a corrupt or inconsistent .env. Error messages never echo values.
func rewriteEnv(cfgdir string, updates []envUpdate) error {
	raw, err := os.ReadFile(cfgdir + "/.env")
	if err != nil {
		return fmt.Errorf("update .env: read: %w", err)
	}
	want := make(map[string]string, len(updates))
	for _, u := range updates {
		want[u.Key] = u.Value
	}
	lines := strings.Split(string(raw), "\n")
	out := make([]string, 0, len(lines)+len(updates))
	seen := map[string]bool{}
	for _, line := range lines {
		k := envLineKey(line)
		if v, ok := want[k]; ok {
			if seen[k] {
				continue // collapse duplicates
			}
			out = append(out, k+"="+v)
			seen[k] = true
			continue
		}
		out = append(out, line)
	}
	var missing []string
	for _, u := range updates {
		if !seen[u.Key] {
			missing = append(missing, u.Key+"="+u.Value)
		}
	}
	if len(missing) > 0 {
		if n := len(out); n > 0 && out[n-1] == "" {
			out = out[:n-1]
			out = append(out, missing...)
			out = append(out, "")
		} else {
			out = append(out, missing...)
		}
	}
	if err := AtomicWrite(cfgdir+"/.env", []byte(strings.Join(out, "\n")), 0o600); err != nil {
		return fmt.Errorf("update .env: write: %w", err)
	}
	m, err := ReadEnvFile(cfgdir)
	if err != nil {
		return fmt.Errorf("update .env: re-read: %w", err)
	}
	for _, u := range updates {
		if strings.TrimSpace(m[u.Key]) != strings.TrimSpace(u.Value) {
			return fmt.Errorf("update .env: %s did not take effect", u.Key)
		}
	}
	if err := ValidateEnvComplete(m); err != nil {
		return fmt.Errorf("update produced an invalid .env: %w", err)
	}
	return nil
}

// SetTLS enables bundled TLS: it writes MATHION_TLS_DOMAIN, MATHION_TLS_EMAIL,
// MATHION_BASE_URL (https://<domain>), and MATHION_COOKIE_SECURE=1, preserving every
// unrelated line. Inputs are validated with the strict interpolation-safe validators
// BEFORE any read or write, so a hostile value never touches the file.
func SetTLS(cfgdir, domain, email string) error {
	if err := ValidateDomain(domain); err != nil {
		return err
	}
	if err := ValidateTLSEmail(email); err != nil {
		return err
	}
	// ValidateDomain already rejected any ':'/port, so BuildBaseURL yields https://<domain>.
	baseURL, err := BuildBaseURL(domain)
	if err != nil {
		return err
	}
	return rewriteEnv(cfgdir, []envUpdate{
		{"MATHION_TLS_DOMAIN", domain},
		{"MATHION_TLS_EMAIL", email},
		{"MATHION_BASE_URL", baseURL},
		{"MATHION_COOKIE_SECURE", "1"},
	})
}

// ClearTLS disables bundled TLS: it clears MATHION_TLS_DOMAIN and MATHION_TLS_EMAIL
// and DELIBERATELY leaves MATHION_BASE_URL (https) and MATHION_COOKIE_SECURE=1 —
// production stays HTTPS-only; disable never downgrades.
func ClearTLS(cfgdir string) error {
	return rewriteEnv(cfgdir, []envUpdate{
		{"MATHION_TLS_DOMAIN", ""},
		{"MATHION_TLS_EMAIL", ""},
	})
}
```

- [ ] **Step 5: Add the pair-consistency check to `ValidateEnvComplete`**

In `cli/internal/config/env.go`, inside `ValidateEnvComplete`, immediately before the final `return nil`, insert:

```go
	// Bundled-TLS pair invariant (spec §9): both empty (disabled) or both present and
	// valid. When present, run the SAME strict interpolation-safe validators the
	// `tls enable` input path uses, so a hand-edited .env that smuggled interpolation
	// syntax into a TLS value fails an update/resume closed; and the https posture
	// (base-url + secure cookie) must be coherent.
	tlsDomain := strings.TrimSpace(m["MATHION_TLS_DOMAIN"])
	tlsEmail := strings.TrimSpace(m["MATHION_TLS_EMAIL"])
	if (tlsDomain == "") != (tlsEmail == "") {
		return fmt.Errorf("MATHION_TLS_DOMAIN and MATHION_TLS_EMAIL must be both set or both empty")
	}
	if tlsDomain != "" {
		if err := ValidateDomain(tlsDomain); err != nil {
			return fmt.Errorf("MATHION_TLS_DOMAIN is invalid")
		}
		if err := ValidateTLSEmail(tlsEmail); err != nil {
			return fmt.Errorf("MATHION_TLS_EMAIL is invalid")
		}
		if m["MATHION_BASE_URL"] != "https://"+tlsDomain {
			return fmt.Errorf("MATHION_BASE_URL must equal https://<MATHION_TLS_DOMAIN> when TLS is enabled")
		}
		if strings.TrimSpace(m["MATHION_COOKIE_SECURE"]) != "1" {
			return fmt.Errorf("MATHION_COOKIE_SECURE must be 1 when TLS is enabled")
		}
	}
```

- [ ] **Step 6: Update `deploy/.env.prod.example`**

Append to `deploy/.env.prod.example`:

```
# --- Bundled auto-HTTPS (optional; managed by `mathion tls enable`) ---
# Leave empty for the external-proxy path. `mathion tls enable --domain <fqdn>
# --email <addr>` fills these in and stands up a Let's Encrypt reverse proxy.
MATHION_TLS_DOMAIN=
MATHION_TLS_EMAIL=
```

- [ ] **Step 7: Run tests**

Run: `cd cli && go test ./internal/config/... -v`
Expected: PASS — including the existing `TestEnvKeyParityWithExample` (the example now carries both new keys), `TestValidateEnvComplete`, `TestValidateEnvCompleteStrengthened`, `TestRepinVersion`, and the two new tests.

- [ ] **Step 8: Commit**

```bash
git add cli/internal/config/env.go cli/internal/config/env_test.go deploy/.env.prod.example
git commit -m "$(cat <<'EOF'
feat(cli): SetTLS/ClearTLS + TLS pair-consistency in .env

GenerateEnv emits empty MATHION_TLS_DOMAIN/EMAIL; SetTLS/ClearTLS rewrite them
atomically (validate-before-write, assert-after) alongside the https posture;
ValidateEnvComplete enforces the both-or-neither pair invariant with the strict
validators so an update/resume rejects a smuggled interpolation payload.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `App.tlsEnabled` + three-way `--profile tls` in `composeArgs`

**Files:**
- Modify: `cli/cmd/root.go` (`App` struct; `composeArgs`; fail-safe startup read in `Execute`)
- Test: `cli/cmd/root_test.go` (create if absent)

**Interfaces:**
- Produces: `App.tlsEnabled bool`; `composeArgs` inserts `--profile tls` per the three-way split keyed on `sub[0]`. Consumed by Tasks 6–9.

- [ ] **Step 1: Write the failing test**

Create `cli/cmd/root_test.go`:

```go
package cmd

import (
	"slices"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func hasProfile(args []string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--profile" && args[i+1] == "tls" {
			return true
		}
	}
	return false
}

func TestComposeArgsProfileSplit(t *testing.T) {
	app := &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: &compose.FakeRunner{}}

	// Containment / inspection: ALWAYS carries the profile, regardless of tlsEnabled.
	for _, sub := range [][]string{{"down"}, {"stop"}, {"rm", "-sf", "proxy"}, {"ps", "-q", "proxy"}, {"logs"}} {
		app.tlsEnabled = false
		if !hasProfile(app.composeArgs(sub...)) {
			t.Errorf("containment %v must carry --profile tls even when disabled", sub)
		}
	}

	// Start: profile ONLY when enabled.
	for _, sub := range [][]string{{"up", "-d", "--wait"}, {"start"}, {"create"}, {"run", "--rm"}} {
		app.tlsEnabled = false
		if hasProfile(app.composeArgs(sub...)) {
			t.Errorf("start %v must NOT carry the profile when disabled", sub)
		}
		app.tlsEnabled = true
		if !hasProfile(app.composeArgs(sub...)) {
			t.Errorf("start %v must carry the profile when enabled", sub)
		}
	}

	// Everything else: NEVER, regardless of tlsEnabled.
	for _, sub := range [][]string{{"pull"}, {"exec", "-T", "app", "sh"}, {"config"}} {
		for _, en := range []bool{false, true} {
			app.tlsEnabled = en
			if hasProfile(app.composeArgs(sub...)) {
				t.Errorf("non-start/non-containment %v must never carry the profile (tlsEnabled=%v)", sub, en)
			}
		}
	}

	// Empty sub: no panic, no profile.
	app.tlsEnabled = true
	got := app.composeArgs()
	if hasProfile(got) {
		t.Errorf("empty sub must not carry the profile: %v", got)
	}
	// The base flags are still present and ordered.
	if !slices.Equal(got[:3], []string{"compose", "-p", "mathion_prod"}) {
		t.Errorf("base args malformed: %v", got)
	}
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./cmd/... -run TestComposeArgsProfileSplit -v`
Expected: FAIL (`App` has no `tlsEnabled`; `composeArgs` adds no profile).

- [ ] **Step 3: Add the field, the split, and the fail-safe read**

In `cli/cmd/root.go`:

Add `tlsEnabled bool` to the `App` struct:

```go
type App struct {
	CfgDir     string
	Project    string
	Runner     compose.Runner
	Out        io.Writer
	Err        io.Writer
	In         io.Reader
	tlsEnabled bool // read fail-safe at startup; toggled by tls enable/disable
}
```

Replace `composeArgs` and add `tlsProfileWanted`:

```go
func (a *App) composeArgs(sub ...string) []string {
	base := []string{
		"compose", "-p", a.Project,
		"-f", a.CfgDir + "/docker-compose.yml",
		"--env-file", a.CfgDir + "/.env",
	}
	if a.tlsProfileWanted(sub) {
		base = append(base, "--profile", "tls")
	}
	return append(base, sub...)
}

// tlsProfileWanted decides whether `--profile tls` is added, keyed on the subcommand
// sub[0] — the three-way split (spec §4.3):
//   - containment / inspection (down/stop/rm/ps/logs): ALWAYS, so `mathion stop`/
//     `uninstall`/`tls disable` reach a running proxy; harmless no-op when the on-disk
//     compose declares no tls profile (verified: rc=0 on Compose v5.1.2).
//   - start (up/start/create/run): ONLY when TLS is enabled, so the proxy is never
//     started on a non-TLS deployment.
//   - everything else (pull/exec/config/…) and an empty sub: NEVER — install's
//     whole-project `compose pull` must not fetch the proxy images (would fail in
//     air-gapped registries); TLS resume/restore pull the proxy images explicitly.
func (a *App) tlsProfileWanted(sub []string) bool {
	if len(sub) == 0 {
		return false
	}
	switch sub[0] {
	case "down", "stop", "rm", "ps", "logs":
		return true
	case "up", "start", "create", "run":
		return a.tlsEnabled
	default:
		return false
	}
}

// tlsEnabledFromEnv reads MATHION_TLS_DOMAIN fail-safe: a missing/corrupt/absent .env
// (any command before install) reads as disabled, never a hard error.
func tlsEnabledFromEnv(cfgDir string) bool {
	m, err := config.ReadEnvFile(cfgDir)
	if err != nil {
		return false
	}
	return strings.TrimSpace(m["MATHION_TLS_DOMAIN"]) != ""
}
```

In `Execute()`, set the field right after constructing `app` (before `newRootCmd`):

```go
	app := &App{
		CfgDir:  resolveCfgDir(),
		Project: resolveProject(),
		Runner:  compose.ExecRunner{},
		Out:     os.Stdout, Err: os.Stderr, In: os.Stdin,
	}
	app.tlsEnabled = tlsEnabledFromEnv(app.CfgDir)
```

Add `"strings"` and `"github.com/svkucheryavski/mathion/cli/internal/config"` to `root.go`'s imports.

- [ ] **Step 4: Run tests**

Run: `cd cli && go test ./cmd/... -run TestComposeArgsProfileSplit -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/root.go cli/cmd/root_test.go
git commit -m "$(cat <<'EOF'
feat(cli): three-way --profile tls split in composeArgs + fail-safe tlsEnabled

Containment/inspection always carries the profile (so stop/uninstall/tls disable
reach a running proxy); start carries it only when enabled; pull/exec/config and
an empty sub never do. App.tlsEnabled is read fail-safe at startup.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `mathion tls` group — `status` + `disable` + registration + classify

**Files:**
- Create: `cli/cmd/tls.go`
- Modify: `cli/cmd/root.go:66-71` (register `newTLSCmd(app)`)
- Modify: `cli/cmd/guard.go:72-79` (`classify`: add `tls-enable` → refuse)
- Test: `cli/cmd/tls_test.go`

**Interfaces:**
- Consumes: `lockAndGuard` (guard.go), `config.ReadEnvFile`, `config.ClearTLS` (Task 4), `App.composeArgs`/`App.tlsEnabled` (Task 5), `compose.ExitError`/`Runner.Stream`.
- Produces: `newTLSCmd(app *App) *cobra.Command` with `status` and `disable` subcommands; `App.tlsDisable`; package seam `probeHTTPS func() bool`. `newTLSEnableCmd` is added in Task 7 — this task wires `newTLSCmd` to reference it, so Task 7 only fills the body.

- [ ] **Step 1: Write the failing tests**

Create `cli/cmd/tls_test.go`:

```go
package cmd

import (
	"bytes"
	"context"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// writeEnabledEnv writes a valid, TLS-enabled .env into a temp cfgdir.
func writeEnabledEnv(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "SECRET==", "abc123hex")
	if err := os.WriteFile(dir+"/.env", []byte(config.RenderEnv(env)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestTLSStatusDisabled(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://x.example.edu", "v0.1.1", "s", "p"))), 0o600)
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out, Err: &out}
	cmd := newTLSCmd(app)
	cmd.SetArgs([]string{"status"})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "disabled") {
		t.Fatalf("status should report disabled, got %q", out.String())
	}
}

func TestTLSStatusEnabled(t *testing.T) {
	dir := writeEnabledEnv(t)
	var out bytes.Buffer
	fr := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "deadbeef\n", nil }} // ps -q proxy => running
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out, tlsEnabled: true}
	defer swapProbe(func() bool { return true })()
	cmd := newTLSCmd(app)
	cmd.SetArgs([]string{"status"})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	for _, want := range []string{"enabled", "learn.example.edu", "admin@example.edu"} {
		if !strings.Contains(s, want) {
			t.Errorf("status missing %q in %q", want, s)
		}
	}
}

func TestTLSDisableReapsThenClears(t *testing.T) {
	dir := writeEnabledEnv(t)
	var out bytes.Buffer
	var calls [][]string
	fr := &compose.FakeRunner{
		StreamFunc: func(_ io.Writer, args []string) error { calls = append(calls, args); return nil },
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out, tlsEnabled: true}
	if err := app.tlsDisable(context.Background()); err != nil {
		t.Fatal(err)
	}
	// The reap must have targeted `rm -sf proxy` under the tls profile.
	var reaped bool
	for _, c := range calls {
		j := strings.Join(c, " ")
		if strings.Contains(j, "--profile tls") && strings.Contains(j, "rm -sf proxy") {
			reaped = true
		}
	}
	if !reaped {
		t.Fatalf("disable must reap `rm -sf proxy` under --profile tls; calls=%v", calls)
	}
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_TLS_DOMAIN"] != "" {
		t.Fatalf("disable must clear TLS domain; got %q", m["MATHION_TLS_DOMAIN"])
	}
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" || m["MATHION_COOKIE_SECURE"] != "1" {
		t.Fatalf("disable must preserve https posture; base=%q secure=%q", m["MATHION_BASE_URL"], m["MATHION_COOKIE_SECURE"])
	}
}
```

(`compose.FakeRunner.StreamFunc` is exactly `func(w io.Writer, args []string) error` — `runner.go:203`; the test captures `args` and returns nil.)

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./cmd/... -run TestTLS -v`
Expected: FAIL (undefined `newTLSCmd`, `tlsDisable`, `swapProbe`).

- [ ] **Step 3: Create `cli/cmd/tls.go` (status + disable + group; enable stub delegates to Task 7)**

```go
package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// probeHTTPS best-effort reports whether something accepts TCP on 127.0.0.1:443.
// A package var so tests can stub it (the readiness/status lines are non-fatal).
var probeHTTPS = func() bool {
	c, err := net.DialTimeout("tcp", "127.0.0.1:443", 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

// swapProbe swaps probeHTTPS for a test and returns a restore func.
func swapProbe(fn func() bool) func() {
	prev := probeHTTPS
	probeHTTPS = fn
	return func() { probeHTTPS = prev }
}

func newTLSCmd(app *App) *cobra.Command {
	c := &cobra.Command{
		Use:   "tls",
		Short: "Manage the bundled auto-HTTPS reverse proxy (Let's Encrypt)",
	}
	c.AddCommand(newTLSEnableCmd(app), newTLSDisableCmd(app), newTLSStatusCmd(app))
	return c
}

func newTLSStatusCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show bundled-TLS state (enabled/disabled, domain, proxy running)",
		RunE: func(c *cobra.Command, _ []string) error {
			m, _ := config.ReadEnvFile(app.CfgDir) // fail-safe: nil map => disabled
			domain := strings.TrimSpace(m["MATHION_TLS_DOMAIN"])
			if domain == "" {
				fmt.Fprintln(app.Out, "bundled TLS: disabled")
				return nil
			}
			fmt.Fprintf(app.Out, "bundled TLS: enabled\n  domain: %s\n  email:  %s\n",
				domain, strings.TrimSpace(m["MATHION_TLS_EMAIL"]))
			out, err := app.Runner.Output(c.Context(), app.composeArgs("ps", "-q", "proxy")...)
			if err == nil && strings.TrimSpace(out) != "" {
				fmt.Fprintln(app.Out, "  proxy container: running")
			} else {
				fmt.Fprintln(app.Out, "  proxy container: not running")
			}
			if probeHTTPS() {
				fmt.Fprintln(app.Out, "  https listener: reachable on 127.0.0.1:443")
			} else {
				fmt.Fprintln(app.Out, "  https listener: not reachable (may still be starting / issuing)")
			}
			fmt.Fprintf(app.Out, "  verify at https://%s\n", domain)
			fmt.Fprintln(app.Out, "  note: a running/reachable proxy does NOT confirm the certificate has issued; check `mathion logs` if HTTPS is failing.")
			return nil
		},
	}
}

func newTLSDisableCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "disable",
		Short: "Stop the bundled proxy (production stays HTTPS-only; never downgrades)",
		RunE: func(c *cobra.Command, _ []string) error {
			release, proceed, err := lockAndGuard(c.Context(), app, "tls-disable")
			defer release()
			if err != nil || !proceed {
				return err
			}
			return app.tlsDisable(c.Context())
		},
	}
}

// tlsDisable reaps the proxy unconditionally FIRST (before consulting .env), then
// clears the TLS vars only if the reap was clean. Containment always carries
// --profile tls (spec §4.3), so this reaps a running proxy even when .env reads
// disabled. The reap uses the captured-stderr seam (Stream, not Run) so its outcome
// is classified rather than blanket-swallowed.
func (a *App) tlsDisable(ctx context.Context) error {
	// 1. Reap.
	if err := a.Runner.Stream(ctx, io.Discard, a.composeArgs("rm", "-sf", "proxy")...); err != nil {
		var ee *compose.ExitError
		if errors.As(err, &ee) && strings.Contains(string(ee.Stderr), "no such service: proxy") {
			// Older Compose against a pre-Slice-5 on-disk compose: nothing to reap.
		} else {
			return fmt.Errorf("stopping the bundled proxy failed; not clearing TLS state: %w", err)
		}
	}
	// 2. Already disabled?
	m, err := config.ReadEnvFile(a.CfgDir)
	if err == nil && strings.TrimSpace(m["MATHION_TLS_DOMAIN"]) == "" {
		fmt.Fprintln(a.Out, "TLS already disabled (ensured no bundled proxy is running).")
		a.tlsEnabled = false
		return nil
	}
	// 3. Clear TLS vars (keep https posture).
	if err := config.ClearTLS(a.CfgDir); err != nil {
		return err
	}
	a.tlsEnabled = false
	// 4. Report.
	fmt.Fprintln(a.Out, "bundled proxy stopped. The app still expects HTTPS in front and is currently\n"+
		"unreachable (loopback-only 127.0.0.1:8000, secure cookies on) until you put your\n"+
		"own TLS proxy in front or re-run `mathion tls enable`. If your proxy serves a\n"+
		"different hostname, update MATHION_BASE_URL.")
	return nil
}
```

- [ ] **Step 4: Register the command in `root.go`**

In `newRootCmd`'s `AddCommand(...)` list, add `newTLSCmd(app)`:

```go
	root.AddCommand(
		newInstallCmd(app), newStartCmd(app), newStopCmd(app), newStatusCmd(app),
		newLogsCmd(app), newPinCmd(app), newSuperuserCmd(app), newVersionCmd(app),
		newUninstallCmd(app), newBackupCmd(app), newRestoreCmd(app), newUpdateCmd(app),
		newSelfUpdateCmd(app), newTLSCmd(app),
	)
```

- [ ] **Step 5: Add `tls-enable` to the refuse set in `classify`**

In `cli/cmd/guard.go`, update `classify`:

```go
func classify(cmd string) entryOutcome {
	switch cmd {
	case "update", "start", "install", "backup", "tls-enable":
		return outcomeRefuse
	default:
		return outcomeProceed
	}
}
```

(`tls-disable` falls to `default` → proceed, like `stop`/containment.)

- [ ] **Step 6: Run tests**

Run: `cd cli && go test ./cmd/... -run TestTLS -v`
Expected: PASS (status disabled/enabled, disable reaps + clears). The build will also require `newTLSEnableCmd` to exist; add a minimal placeholder at the bottom of `tls.go` so this task compiles:

```go
// newTLSEnableCmd is fully implemented in Task 7.
func newTLSEnableCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:    "enable",
		Short:  "Enable bundled auto-HTTPS for one public domain (Let's Encrypt)",
		Hidden: true,
		RunE:   func(c *cobra.Command, _ []string) error { return errors.New("not yet implemented") },
	}
}
```

- [ ] **Step 7: Commit**

```bash
git add cli/cmd/tls.go cli/cmd/tls_test.go cli/cmd/root.go cli/cmd/guard.go
git commit -m "$(cat <<'EOF'
feat(cli): mathion tls group — status + disable + registration

status reports state fail-safe; disable reaps `rm -sf proxy` (captured-stderr
seam) before clearing TLS vars while preserving the https posture. tls-enable is
added to the breadcrumb refuse set. enable body lands in the next task.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `mathion tls enable`

**Files:**
- Modify: `cli/cmd/tls.go` (replace the `newTLSEnableCmd` placeholder; add `tlsEnable` + helpers)
- Modify: `cli/internal/dockerx/preflight.go` (add `PortBindable`)
- Test: `cli/cmd/tls_test.go`, `cli/internal/dockerx/preflight_test.go`

**Interfaces:**
- Consumes: `config.ValidateDomain`/`ValidateTLSEmail`/`NormalizeEmail`/`SetTLS`/`ReadState`/`ReadEnvFile`/`ValidateEnvComplete` (Tasks 3–4), `composeBytes`+`config.AtomicWrite`, `dockerx.PortBindable`, `App.compose`/`composeArgs`, `probeHTTPS`.
- Produces: fully-functional `enable` with a bounded readiness report; `dockerx.PortBindable(addr string) error`.

- [ ] **Step 1: Write the failing tests**

Add to `cli/internal/dockerx/preflight_test.go`:

```go
func TestPortBindable(t *testing.T) {
	// A free high port is bindable.
	if err := PortBindable("127.0.0.1:0"); err != nil {
		t.Fatalf("a free port must be bindable: %v", err)
	}
	// A port we are actively listening on is NOT bindable.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	if err := PortBindable(l.Addr().String()); err == nil {
		t.Fatal("a port in use must not be bindable")
	}
}
```

(Ensure `preflight_test.go` imports `"net"`.)

Add to `cli/cmd/tls_test.go`:

```go
func TestTLSEnableRequiresBothFlags(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://x.example.edu", "v0.1.1", "s", "p"))), 0o600)
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: io.Discard, Err: io.Discard}
	if err := app.tlsEnable(context.Background(), tlsEnableOpts{Domain: "learn.example.edu"}); err == nil {
		t.Error("enable must require --email")
	}
	if err := app.tlsEnable(context.Background(), tlsEnableOpts{Email: "a@b.edu"}); err == nil {
		t.Error("enable must require --domain")
	}
}

func TestTLSEnableRejectsInterpolationPayload(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://x.example.edu", "v0.1.1", "s", "p"))), 0o600)
	before, _ := os.ReadFile(dir + "/.env")
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: io.Discard, Err: io.Discard}
	if err := app.tlsEnable(context.Background(), tlsEnableOpts{Domain: "learn.example.edu", Email: "${POSTGRES_PASSWORD}@x.y"}); err == nil {
		t.Fatal("enable must reject an interpolation payload before any write")
	}
	after, _ := os.ReadFile(dir + "/.env")
	if string(before) != string(after) {
		t.Fatal("a rejected enable must leave .env byte-identical")
	}
}

func TestTLSEnableHappyPath(t *testing.T) {
	dir := t.TempDir()
	// A valid installed deployment: .env (0600) + install-state.
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://x.example.edu", "v0.1.1", "s", "p"))), 0o600)
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err)
	}
	// docker-compose.yml must exist for AtomicWrite target dir; EnsureConfigDir/AtomicWrite create files.
	var out bytes.Buffer
	var calls [][]string
	fr := &compose.FakeRunner{
		RunFunc:    func(args []string) error { calls = append(calls, args); return nil },
		OutputFunc: func(args []string) (string, error) { return "", nil }, // ps -q proxy => not running
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out}
	defer swapProbe(func() bool { return true })()
	defer swapBindable(func(string) error { return nil })()                                // don't touch real 80/443 in tests
	defer swapLookup(func(string) ([]string, error) { return []string{"1.2.3.4"}, nil })() // no live DNS in unit tests
	if err := app.tlsEnable(context.Background(), tlsEnableOpts{Domain: "learn.example.edu", Email: "admin@example.edu"}); err != nil {
		t.Fatal(err)
	}
	// .env now enabled with https posture.
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_TLS_DOMAIN"] != "learn.example.edu" || m["MATHION_BASE_URL"] != "https://learn.example.edu" {
		t.Fatalf("enable did not set TLS vars: %v", m)
	}
	// A whole-project `up -d --wait` (profile active) must have been issued.
	var upped bool
	for _, c := range calls {
		if len(c) >= 2 && c[0] == "compose" {
			j := strings.Join(c, " ")
			if strings.Contains(j, "--profile tls") && strings.Contains(j, "up -d --wait") {
				upped = true
			}
		}
	}
	if !upped {
		t.Fatalf("enable must issue a profiled whole-project up; calls=%v", calls)
	}
}
```

The test relies on three seams: `swapProbe` (defined in Task 6's `tls.go`) plus `swapBindable` and `swapLookup`, both added in Step 4 alongside their package vars (`portBindable`, `dnsLookup`). Do not redefine `portBindable` anywhere else — it lives once, in Step 4.

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./cmd/... -run TestTLSEnable -v` and `cd cli && go test ./internal/dockerx/... -run TestPortBindable -v`
Expected: FAIL (undefined `tlsEnable`, `tlsEnableOpts`, `PortBindable`, `swapBindable`).

- [ ] **Step 3: Add `PortBindable` to dockerx**

Append to `cli/internal/dockerx/preflight.go`:

```go
// PortBindable returns an error if addr cannot be bound (already in use or not
// permitted). Unlike PortFree (which only dials), this attempts an actual listen, so
// a preflight matches what Docker's own bind will need. addr like ":80" binds the
// wildcard IPv4+IPv6; Docker's own bind remains the authoritative backstop.
func PortBindable(addr string) error {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("cannot bind %s: %w", addr, err)
	}
	_ = l.Close()
	return nil
}
```

- [ ] **Step 4: Implement `enable` in `tls.go`**

Replace the placeholder `newTLSEnableCmd` with the real command + `tlsEnable`, and add the `portBindable`/`swapBindable` seam. Add imports `"os"`, `"github.com/svkucheryavski/mathion/cli/internal/dockerx"` to `tls.go`.

```go
type tlsEnableOpts struct {
	Domain, Email string
}

func newTLSEnableCmd(app *App) *cobra.Command {
	var o tlsEnableOpts
	c := &cobra.Command{
		Use:   "enable",
		Short: "Enable bundled auto-HTTPS for one public domain (Let's Encrypt)",
		RunE: func(c *cobra.Command, _ []string) error {
			release, proceed, err := lockAndGuard(c.Context(), app, "tls-enable")
			defer release()
			if err != nil || !proceed {
				return err
			}
			return app.tlsEnable(c.Context(), o)
		},
	}
	c.Flags().StringVar(&o.Domain, "domain", "", "public FQDN to serve over HTTPS (required)")
	c.Flags().StringVar(&o.Email, "email", "", "contact email for Let's Encrypt (required)")
	return c
}

// Package seams so unit tests avoid real port binds / DNS lookups.
var (
	portBindable = dockerx.PortBindable
	dnsLookup    = net.LookupHost
)

func swapBindable(fn func(string) error) func() {
	prev := portBindable
	portBindable = fn
	return func() { portBindable = prev }
}

func swapLookup(fn func(string) ([]string, error)) func() {
	prev := dnsLookup
	dnsLookup = fn
	return func() { dnsLookup = prev }
}

func (a *App) tlsEnable(ctx context.Context, o tlsEnableOpts) error {
	// 1. Both flags required.
	if o.Domain == "" || o.Email == "" {
		return fmt.Errorf("tls enable requires --domain and --email")
	}
	// 2-3. Strict, interpolation-safe validation (rejects $ { } " ' \ + whitespace).
	if err := config.ValidateDomain(o.Domain); err != nil {
		return err
	}
	email := config.NormalizeEmail(o.Email)
	if err := config.ValidateTLSEmail(email); err != nil {
		return err
	}
	// 1 (identity): require a valid, installed deployment (same guard install-resume uses).
	if err := a.requireInstalledDeployment(); err != nil {
		return err
	}
	// 4. Re-materialize the on-disk compose to the embedded (Slice-5) revision so
	// `up … proxy` finds the service after a CLI upgrade.
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(a.CfgDir+"/docker-compose.yml", composeBytes(), 0o644); err != nil {
		return err
	}
	// 5. Port preflight — only when the proxy is not already running.
	if !a.proxyRunning(ctx) {
		for _, addr := range []string{":80", ":443"} {
			if err := portBindable(addr); err != nil {
				return fmt.Errorf("port preflight: %w (free it, or use your own external proxy on the non-TLS path)", err)
			}
		}
	}
	// 6. DNS preflight (warn, non-blocking; dnsLookup is a seam for hermetic tests).
	if _, err := dnsLookup(o.Domain); err != nil {
		fmt.Fprintf(a.Err, "warning: DNS lookup for %s failed (%v); Let's Encrypt issuance waits until DNS points at this host.\n", o.Domain, err)
	}
	// 7. SetTLS: atomic, validate-before-write, reread + assert; then reflect the new
	// state so composeArgs adds --profile tls to the `up` below.
	if err := config.SetTLS(a.CfgDir, o.Domain, email); err != nil {
		return err
	}
	a.tlsEnabled = true
	// 8. Full-project up (profile now active; pull ALLOWED so reproxy + busybox are
	// fetched on first enable — this omits --pull never, unlike start/update/restore).
	if err := a.compose(ctx, "up", "-d", "--wait"); err != nil {
		return err
	}
	// Readiness (non-fatal): the container has no healthcheck.
	a.reportHTTPSReadiness()
	// 9. Report.
	fmt.Fprintf(a.Out, "bundled TLS enabled for https://%s.\n"+
		"A Let's Encrypt certificate is obtained automatically shortly after start.\n"+
		"Ensure the firewall opens ports 80 and 443 and DNS points at this host.\n"+
		"If HTTPS is not up yet, check `mathion tls status` / `mathion logs`.\n", o.Domain)
	return nil
}

// requireInstalledDeployment reuses the install-resume identity/state guard
// (install.go:59) — a present, regular, private .env on a valid, complete install.
func (a *App) requireInstalledDeployment() error {
	envPath := a.CfgDir + "/.env"
	fi, err := os.Lstat(envPath)
	if err != nil {
		return fmt.Errorf("no installed deployment at %s (%v); run `mathion install` first", a.CfgDir, err)
	}
	if !fi.Mode().IsRegular() {
		return fmt.Errorf(".env at %s is not a regular file; repair it or run `mathion install`", envPath)
	}
	if perm := fi.Mode().Perm(); perm&0o077 != 0 {
		return fmt.Errorf(".env at %s is group/world-accessible (%v); it holds secrets — fix with `chmod 600 %s`", envPath, perm, envPath)
	}
	if _, err := config.ReadState(a.CfgDir); err != nil {
		return fmt.Errorf("install-state is missing or invalid (%w); run `mathion install`", err)
	}
	m, err := config.ReadEnvFile(a.CfgDir)
	if err != nil {
		return fmt.Errorf(".env is unreadable (%w); repair it or run `mathion install`", err)
	}
	if err := config.ValidateEnvComplete(m); err != nil {
		return fmt.Errorf(".env is incomplete or inconsistent (%w); repair it or run `mathion install`", err)
	}
	return nil
}

// proxyRunning reports whether the project's proxy container is up (best-effort).
func (a *App) proxyRunning(ctx context.Context) bool {
	out, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "proxy")...)
	return err == nil && strings.TrimSpace(out) != ""
}

// reportHTTPSReadiness prints a single bounded best-effort readiness line. Bounded by
// httpsPollAttempts probes spaced by sleepBetweenPolls (both package seams so tests
// stay fast). Never fatal — issuance/DNS may still be pending.
func (a *App) reportHTTPSReadiness() {
	for i := 0; i < httpsPollAttempts; i++ {
		if probeHTTPS() {
			fmt.Fprintln(a.Out, "  https listener up on 127.0.0.1:443.")
			return
		}
		sleepBetweenPolls()
	}
	fmt.Fprintln(a.Out, "  https listener not yet reachable — issuance/DNS may still be pending; check `mathion tls status`.")
}

var httpsPollAttempts = 6
var sleepBetweenPolls = func() { time.Sleep(500 * time.Millisecond) }
```

The `swapBindable`/`swapLookup`/`portBindable`/`dnsLookup` seams are all defined above in this step (in `tls.go`); tests just call the swap helpers. `TestTLSEnableHappyPath` stubs `probeHTTPS` to return true, so `reportHTTPSReadiness` returns on the first probe and never calls `sleepBetweenPolls` — no sleep occurs in that test. Any test that exercises the not-ready branch must first set `sleepBetweenPolls = func(){}` (restore it with a deferred closure) so it does not actually sleep.

- [ ] **Step 5: Run tests**

Run: `cd cli && go test ./cmd/... -run TestTLS -v` and `cd cli && go test ./internal/dockerx/... -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/cmd/tls.go cli/cmd/tls_test.go cli/internal/dockerx/preflight.go cli/internal/dockerx/preflight_test.go
git commit -m "$(cat <<'EOF'
feat(cli): mathion tls enable

Validate (interpolation-safe) -> identity guard -> re-materialize on-disk compose
-> bindability preflight of 80/443 -> DNS warn -> SetTLS -> profiled whole-project
up -> bounded readiness report. Adds dockerx.PortBindable (listen, not dial).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Proxy lifecycle on restore (standalone-only); update forward-path unchanged

**Files:**
- Modify: `cli/cmd/restore.go` (add `restoreProxyIfEnabled` + call it after step 10)
- Test: `cli/cmd/restore_test.go` (add proxy-lifecycle tests)

**Interfaces:**
- Consumes: `restoreOpts.WriteBreadcrumb`, `config.ReadEnvFile`, `App.compose`/`composeArgs`, `forceRemoveWorker` (restore.go:417), `context.WithTimeout`/`WithoutCancel`.
- Produces: `App.restoreProxyIfEnabled(ctx, opts)`; consts `tlsProxyPullTimeout`, `tlsProxyStepTimeout` (reused by Task 9). `update.go` needs **no change** — its auto-rollback call at `update.go:113` already passes `WriteBreadcrumb:false`, and the forward path (`stop app` at :256, `up --wait app` at :328) never brings the proxy up; the running proxy re-resolves `app:8000` after `app` is recreated.

- [ ] **Step 1: Write the failing tests**

Append to `cli/cmd/restore_test.go` (create if absent, `package cmd`, imports `context`, `os`, `strings`, `testing`, `github.com/svkucheryavski/mathion/cli/internal/compose`, `github.com/svkucheryavski/mathion/cli/internal/config`):

```go
func tlsEnvDir(t *testing.T, enabled bool) string {
	t.Helper()
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "abc123hex"))), 0o600)
	if enabled {
		if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func joinAll(calls [][]string) []string {
	out := make([]string, len(calls))
	for i, c := range calls {
		out[i] = strings.Join(c, " ")
	}
	return out
}

func TestRestoreProxy_RollbackIssuesNothing(t *testing.T) {
	dir := tlsEnvDir(t, true)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error { calls = append(calls, a); return nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: false}) // rollback path
	for _, j := range joinAll(calls) {
		if strings.Contains(j, "proxy") {
			t.Fatalf("rollback (WriteBreadcrumb:false) must issue no proxy commands; saw %q", j)
		}
	}
}

func TestRestoreProxy_DisabledIssuesNothing(t *testing.T) {
	dir := tlsEnvDir(t, false)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error { calls = append(calls, a); return nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: true})
	if len(calls) != 0 {
		t.Fatalf("TLS-disabled restore must issue no proxy commands; saw %v", joinAll(calls))
	}
}

func TestRestoreProxy_EnabledOrder(t *testing.T) {
	dir := tlsEnvDir(t, true)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error { calls = append(calls, a); return nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: true})
	all := joinAll(calls)
	var iPull, iInit, iUp int = -1, -1, -1
	for i, j := range all {
		switch {
		case strings.Contains(j, "pull --policy missing proxy proxy-init"):
			iPull = i
		case strings.Contains(j, "run --rm --no-deps --pull never") && strings.Contains(j, "proxy-init"):
			iInit = i
		case strings.Contains(j, "up -d proxy --pull never --no-deps"):
			iUp = i
		}
	}
	if iPull < 0 || iInit < 0 || iUp < 0 {
		t.Fatalf("missing a step: pull=%d init=%d up=%d; calls=%v", iPull, iInit, iUp, all)
	}
	if !(iPull < iInit && iInit < iUp) {
		t.Fatalf("steps out of order: pull=%d init=%d up=%d", iPull, iInit, iUp)
	}
}

func TestRestoreProxy_InitFailureSkipsUpAndReaps(t *testing.T) {
	dir := tlsEnvDir(t, true)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error {
		calls = append(calls, a)
		if strings.Contains(strings.Join(a, " "), "-T proxy-init") {
			return &compose.ExitError{Code: 1}
		}
		return nil
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: true})
	all := joinAll(calls)
	for _, j := range all {
		if strings.Contains(j, "up -d proxy") {
			t.Fatalf("a failed chown must skip `up proxy`; saw %q", j)
		}
	}
	// forceRemoveWorker must have force-removed the named proxy-init worker.
	var reaped bool
	for _, j := range all {
		if strings.HasPrefix(j, "rm -f mathion_proxyinit_") {
			reaped = true
		}
	}
	if !reaped {
		t.Fatalf("a failed chown must forceRemoveWorker the proxy-init one-off; calls=%v", all)
	}
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./cmd/... -run TestRestoreProxy -v`
Expected: FAIL (undefined `restoreProxyIfEnabled`).

- [ ] **Step 3: Implement `restoreProxyIfEnabled` and wire it into `restoreEngine`**

Append to `cli/cmd/restore.go`:

```go
// tlsProxyPullTimeout / tlsProxyStepTimeout bound each best-effort proxy-restore
// step so a slow/unhealthy proxy can never fail the (already-complete) restore gate
// or the auto-rollback.
const tlsProxyPullTimeout = 60 * time.Second
const tlsProxyStepTimeout = 60 * time.Second

// restoreProxyIfEnabled brings the bundled proxy back after a STANDALONE restore
// (opts.WriteBreadcrumb) when TLS is enabled in .env — a non-gating, bounded,
// forward-only step. Every error is demoted to a warning so it can never fail the
// restore's own gate. The auto-rollback caller (update.go:113, WriteBreadcrumb:false)
// returns immediately here, so a rollback issues NO proxy-up. Order (spec §10):
//  1. bounded best-effort `pull --policy missing proxy proxy-init` (present for a
//     new-host / post-`--purge` restore; --policy missing skips the registry when
//     the images are already cached);
//  2. chown one-shot synchronously via the one-off worker idiom `run … -T proxy-init`
//     (returns the TRUE exit code — not `up --wait proxy-init`, which returns rc=1 on
//     a one-shot that exits), mandatory --name/--label + forceRemoveWorker on
//     error/timeout before continuing;
//  3. `up -d proxy --pull never --no-deps` (chown already ran; app/db undisturbed).
func (a *App) restoreProxyIfEnabled(ctx context.Context, opts restoreOpts) {
	if !opts.WriteBreadcrumb {
		return // rollback path: never bring the proxy up
	}
	m, err := config.ReadEnvFile(a.CfgDir)
	if err != nil || strings.TrimSpace(m["MATHION_TLS_DOMAIN"]) == "" {
		return // TLS not enabled
	}
	a.tlsEnabled = true // so composeArgs adds --profile tls to the start commands below

	// 1. Bounded best-effort targeted pull.
	pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
	if err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init"); err != nil {
		fmt.Fprintf(a.Err, "note: could not pre-pull the bundled proxy images (%v); continuing with cached images\n", err)
	}
	pcancel()

	// 2. Chown one-shot, synchronously. Mandatory name/label => reapable.
	name := fmt.Sprintf("mathion_proxyinit_%d", os.Getpid())
	ictx, icancel := context.WithTimeout(ctx, tlsProxyStepTimeout)
	ierr := a.Runner.Run(ictx, a.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never",
		"--name", name, "--label", "io.mathion.worker=1",
		"-T", "proxy-init",
	)...)
	icancel()
	if ierr != nil {
		fmt.Fprintf(a.Err, "note: bundled-proxy ACME-dir chown did not complete (%v); the proxy may be unable to write certs — check `mathion tls status`\n", ierr)
		forceRemoveWorker(context.WithoutCancel(ctx), a.Runner, name)
		return // do not start the proxy over a half-done chown
	}

	// 3. Start ONLY the proxy.
	uctx, ucancel := context.WithTimeout(ctx, tlsProxyStepTimeout)
	if err := a.compose(uctx, "up", "-d", "proxy", "--pull", "never", "--no-deps"); err != nil {
		fmt.Fprintf(a.Err, "note: could not start the bundled proxy after restore (%v); re-run `mathion tls enable` if HTTPS is down\n", err)
	}
	ucancel()
}
```

In `restoreEngine`, insert the call immediately before the final success print (currently `fmt.Fprintf(a.Out, "restored to %s from %s\n", …)` at restore.go:404):

```go
	// (11) Bundled proxy: standalone-restore-only, non-gating, bounded, forward-only.
	a.restoreProxyIfEnabled(ctx, opts)
	fmt.Fprintf(a.Out, "restored to %s from %s\n", manifest.MathionVersion, filepath.Base(archivePath))
	return nil
```

- [ ] **Step 4: Run tests**

Run: `cd cli && go test ./cmd/... -run TestRestoreProxy -v`
Expected: PASS. Then `cd cli && go test ./cmd/... -run 'TestRestore|TestUpdate'` to confirm no regression in existing restore/update tests.

- [ ] **Step 5: Commit**

```bash
git add cli/cmd/restore.go cli/cmd/restore_test.go
git commit -m "$(cat <<'EOF'
feat(cli): bring the bundled proxy back on standalone restore (non-gating)

restoreProxyIfEnabled runs only on the standalone path (WriteBreadcrumb:true) when
TLS is enabled: bounded pull --policy missing -> synchronous run proxy-init (true
exit code, mandatory name/label + forceRemoveWorker on failure) -> up proxy --no-deps.
Auto-rollback issues nothing. update's forward path is unchanged (proxy keeps running,
re-resolves app:8000).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: install-resume targeted pull + `nextSteps` HTTPS hint

**Files:**
- Modify: `cli/cmd/install.go` (`resume` at :120-153; `nextSteps` const + its `Fprintf` call at :210)
- Test: `cli/cmd/install_test.go` (add a resume-with-TLS test)

**Interfaces:**
- Consumes: `App.tlsEnabled` (set fail-safe at startup; on resume the .env exists so it reflects TLS state), `App.compose`, `tlsProxyPullTimeout` (Task 8, same package).
- Produces: resume pulls the proxy images when `tlsEnabled` before the `--pull never` up; `nextSteps` mentions `mathion tls enable`.

- [ ] **Step 1: Write the failing test**

Append to `cli/cmd/install_test.go` (create if absent):

```go
func TestResumePullsProxyImagesWhenTLSEnabled(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "abc123hex"))), 0o600)
	if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
		t.Fatal(err)
	}
	var calls [][]string
	fr := &compose.FakeRunner{
		RunFunc:    func(a []string) error { calls = append(calls, a); return nil },
		OutputFunc: func(a []string) (string, error) { return "present\n", nil }, // pgdata present => skip app pull
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr, tlsEnabled: true}
	// resume runs migrate+superuser via compose exec; the FakeRunner returns nil for those.
	_ = app.resume(context.Background(), config.State{Schema: 1, AdminEmail: "admin@example.edu"})
	var pulled bool
	for _, c := range calls {
		if strings.Contains(strings.Join(c, " "), "pull --policy missing proxy proxy-init") {
			pulled = true
		}
	}
	if !pulled {
		t.Fatalf("a TLS-enabled resume must targeted-pull the proxy images before --pull never up; calls=%v", calls)
	}
}
```

(Ensure `install_test.go` imports `context`, `os`, `strings`, `testing`, `compose`, `config`.)

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./cmd/... -run TestResumePullsProxyImages -v`
Expected: FAIL (resume does not pull the proxy images).

- [ ] **Step 3: Add the targeted pull to `resume`**

In `cli/cmd/install.go`, inside `resume`, immediately before `if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never"); err != nil {` (currently line 144), insert:

```go
	// TLS-enabled resume: the whole-project up below is --pull never and now includes
	// the profiled proxy/proxy-init, so on a new host / after a proxy digest bump / on
	// the pgdata-present fast-path (which skipped the app pull) the proxy image may be
	// absent. Bounded best-effort targeted pull first; the up stays authoritative.
	if a.tlsEnabled {
		pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
		if err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init"); err != nil {
			fmt.Fprintf(a.Err, "note: could not pre-pull the bundled proxy images (%v); continuing with cached images\n", err)
		}
		pcancel()
	}
```

Add `"context"` to `install.go` imports if not present (it is — `runInstall` takes `ctx context.Context`; confirm `context` is imported).

- [ ] **Step 4: Update `nextSteps`**

Replace the `nextSteps` const and its `Fprintf` call. New const:

```go
const nextSteps = `
Deployment up. Next:
  1. Front it with HTTPS. Easiest — bundled auto-TLS (opens 80+443, obtains a
     Let's Encrypt cert):
         sudo mathion tls enable --domain %s --email you@example.org
     Or run your own TLS proxy (see README "Self-hosting").
  2. Log in at https://%s — NOT http://127.0.0.1:8000 (the Secure session cookie
     won't persist over plain HTTP).
  3. Issue your first-login PIN:  sudo mathion pin %s
  4. (optional) superuser panel URL: docker compose ... exec -T app python -m mathion.superuser activate
`
```

Update the call at install.go:210 to pass `o.Domain` twice:

```go
	fmt.Fprintf(a.Out, nextSteps, o.Domain, o.Domain, email)
```

- [ ] **Step 5: Run tests**

Run: `cd cli && go test ./cmd/... -run 'TestResumePullsProxyImages|TestInstall' -v` then `cd cli && go test ./cmd/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/cmd/install.go cli/cmd/install_test.go
git commit -m "$(cat <<'EOF'
feat(cli): resume targeted-pulls proxy images when TLS enabled + tls next-step

A TLS-enabled resume pre-pulls proxy/proxy-init (--policy missing, bounded,
best-effort) before the --pull never up so a new host / digest bump / pgdata
fast-path doesn't hit an absent proxy image. install's next-steps now points at
`mathion tls enable`.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Purge removes `frontend` + `mathion_acme`; acme excluded from reinstall guard

**Files:**
- Modify: `cli/internal/dockerx/teardown.go:15-40` (`Purge`)
- Modify: `cli/cmd/uninstall.go:41-47` (confirmation text mentions acme)
- Test: `cli/internal/dockerx/teardown_test.go`

**Interfaces:**
- Produces: `Purge` also removes `<project>_frontend` (network) and `<project>_mathion_acme` (volume). The fresh-install refuse-guard (`install.go:88-97`) deliberately does NOT check the acme volume (re-issuable certs must not block reinstall).

- [ ] **Step 1: Write the failing test**

Append to `cli/internal/dockerx/teardown_test.go`:

```go
func TestPurgeRemovesFrontendAndAcme(t *testing.T) {
	var calls [][]string
	fr := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			// container list empty; every `<kind> ls` reports the resource present.
			if len(args) > 0 && args[0] == "ps" {
				return "", nil
			}
			return "found\n", nil
		},
		RunFunc: func(args []string) error { calls = append(calls, args); return nil },
	}
	if err := Purge(context.Background(), fr, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"network mathion_prod_frontend":     false,
		"volume mathion_prod_mathion_acme":  false,
	}
	for _, c := range calls {
		j := strings.Join(c, " ")
		for k := range want {
			// removeIfPresent issues `<kind> rm <name>`.
			if strings.Contains(j, "rm "+strings.Fields(k)[1]) {
				want[k] = true
			}
		}
	}
	for k, seen := range want {
		if !seen {
			t.Errorf("Purge must remove %s; calls=%v", k, calls)
		}
	}
}
```

(Ensure `teardown_test.go` imports `context`, `strings`, `testing`, `compose`.)

- [ ] **Step 2: Run to confirm failure**

Run: `cd cli && go test ./internal/dockerx/... -run TestPurgeRemovesFrontendAndAcme -v`
Expected: FAIL (frontend network + acme volume not removed).

- [ ] **Step 3: Extend `Purge`**

In `cli/internal/dockerx/teardown.go`, replace the network-removal line and the volume loop:

```go
	for _, netName := range []string{project + "_default", project + "_frontend"} {
		if err := removeIfPresent(ctx, r, "network", netName); err != nil {
			return err
		}
	}
	for _, vol := range []string{project + "_mathion_pgdata", project + "_mathion_assets", project + "_mathion_acme"} {
		if err := removeIfPresent(ctx, r, "volume", vol); err != nil {
			return err
		}
	}
	return nil
```

- [ ] **Step 4: Update the uninstall confirmation text**

In `cli/cmd/uninstall.go`, the `--purge` confirmation currently names `pgdata` and `assets`. Update it to also mention the acme volume so the operator knows certs are removed. Replace the `fmt.Fprintf(app.Out, "This PERMANENTLY deletes …` line's format to include the acme volume (a re-issuable cert store):

```go
			acme := app.Project + "_mathion_acme"
			fmt.Fprintf(app.Out, "This PERMANENTLY deletes project %q, volumes %s, %s and %s (bundled-TLS certs; re-issuable), and config dir %s (backups in %s are kept).\nType the project name (%s) to confirm: ", app.Project, pgdata, assets, acme, app.CfgDir, varlib.BackupsDir(), app.Project)
```

(Add `acme := app.Project + "_mathion_acme"` next to the existing `pgdata`/`assets` locals.)

- [ ] **Step 5: Run tests**

Run: `cd cli && go test ./internal/dockerx/... -v` and `cd cli && go test ./cmd/... -run TestUninstall -v`
Expected: PASS. (No change is needed to the fresh-install refuse-guard — it only checks pgdata+assets, so a leftover acme volume already cannot block a reinstall; verify by reading `install.go:88-97`.)

- [ ] **Step 6: Commit**

```bash
git add cli/internal/dockerx/teardown.go cli/internal/dockerx/teardown_test.go cli/cmd/uninstall.go
git commit -m "$(cat <<'EOF'
feat(cli): purge removes the frontend network + mathion_acme volume

uninstall --purge now tears down <project>_frontend and <project>_mathion_acme
(re-issuable certs) alongside the default network and data volumes; the
confirmation names them. The reinstall guard still ignores acme by design.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: User docs — README "Bundled HTTPS" + man page `tls`

**Files:**
- Modify: `README.md` (add a "Bundled HTTPS (`mathion tls`)" subsection to the self-hosting section; keep the external-proxy section; document firewall + DNS + the downgrade caveat)
- Modify: `deploy/man/mathion.1` (add a `tls` `.TP` block)

**Interfaces:** none (docs). No automated test; verified by `man` rendering and a build.

- [ ] **Step 1: Add the man-page block**

In `deploy/man/mathion.1`, after the `self-update` `.TP` block (ends before line 26 `.TP` for superuser), insert:

```
.TP
.B tls enable\fR, \fBtls disable\fR, \fBtls status
Manage the bundled auto-HTTPS reverse proxy (Let's Encrypt) for one public domain.
\fBtls enable \-\-domain <fqdn> \-\-email <addr>\fR stands up a digest-pinned reproxy that
obtains and auto-renews a certificate; \fBtls disable\fR stops the proxy (production stays
HTTPS-only \- it never downgrades); \fBtls status\fR reports state. Requires ports 80 and 443
open at the firewall and DNS pointing at this host. NOTE: running an OLDER CLI's
\fBtls enable\fR against a NEWER install rewrites the on-disk compose with the older embed
(unsupported \- upgrade the CLI first).
```

- [ ] **Step 2: Add the README subsection**

In `README.md`, in the self-hosting / TLS area (near the existing external-proxy guidance and the reproxy `MAX_SIZE` note at ~line 251), add a subsection. Keep the existing external-proxy text intact; add above it:

```markdown
### Bundled HTTPS (`mathion tls`) — the easy path

If your server has a public domain and ports 80 + 443 open, Mathion can run its
own TLS-terminating reverse proxy and obtain a Let's Encrypt certificate for you —
no cert files to manage:

    sudo mathion tls enable --domain learn.example.edu --email you@example.org

This stands up a bundled, network-segmented reproxy (it shares no network with the
database), obtains and auto-renews the certificate, and serves the app over HTTPS.
Check state any time with `mathion tls status`; stop it with `mathion tls disable`.

**Requirements:** DNS for the domain must point at this host, and the firewall must
allow inbound TCP 80 (ACME HTTP-01 challenge + redirect) and 443 (HTTPS).

**Production is HTTPS-only.** `mathion tls disable` stops the bundled proxy but does
**not** downgrade to plain HTTP — the app keeps `Secure` cookies and its
`https://…` base URL, so put your own TLS proxy in front (or re-enable) to reach it.

**Upload limit:** the bundled proxy allows request bodies up to 25 MiB (covers the
default 20 MiB upload cap). If you raise `MATHION_MAX_FILE_SIZE` above ~24 MiB, raise
the proxy's `MAX_SIZE` in the compose file to match.

**Downgrade caveat:** running an **older** `mathion` CLI's `tls enable` against a
**newer** install rewrites the on-disk compose with the older embedded copy. That
newer→older path is unsupported — upgrade the CLI first (`mathion self-update`).

Prefer your own external proxy? That path is unchanged — see below.
```

- [ ] **Step 3: Verify rendering + build**

Run: `man -l /Users/svkucheryavski/Documents/Developing/mathion/deploy/man/mathion.1 | head -60` (visual check the `tls` block renders) and `cd cli && go build ./...` (unaffected, sanity).
Expected: the `tls` block appears under COMMANDS; build OK.

- [ ] **Step 4: Commit**

```bash
git add README.md deploy/man/mathion.1
git commit -m "$(cat <<'EOF'
docs: document bundled HTTPS (mathion tls) in README + man page

Add the tls enable/disable/status path, firewall + DNS requirements, the
HTTPS-only/no-downgrade note, the MAX_SIZE upload coupling, and the newer->older
downgrade caveat.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: On-host verification runbook + pinned-digest behavior sign-off

**Files:**
- Create: `docs/superpowers/plans/2026-08-23-phase9-d-slice5-onhost-verification.md`

**Interfaces:** none. This closes the spec §13 open items that can only be verified against the pinned digests on a real Docker host + a public domain (the same class as the deferred amd64 cloud smoke). It is a maintainer runbook, not a CI test — but it is a first-class deliverable so nothing ships unverified silently.

**Note:** all hermetic behavior is covered by Tasks 1–10's unit tests. This task documents the on-host checks and records their outcome. Real Let's Encrypt issuance cannot run in CI.

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/plans/2026-08-23-phase9-d-slice5-onhost-verification.md` with exact commands:

```markdown
# Slice 5 — On-host verification runbook (pinned-digest sign-off)

Run on a Docker host. Items 1–4 need only a local host; item 5 needs a public
domain + DNS + open 80/443. Record PASS/FAIL beside each. Pinned digests:
reproxy sha256:456d9d2ac7321e2bbb729a5580259d4fc6b52d0310c6cb79c1e30350dd6ba0f7,
busybox sha256:7a3ebe5bfd1a4a19797d20b0c0bb39d44393e9a03fd852c0865b0f540d868df0.

## 0. Structural (docker compose config)
- `docker compose -p mathion_prod -f docker-compose.prod.yml --env-file .env config`
  parses cleanly with NO profile, and with `--profile tls`.
- With `--profile tls`, assert: `proxy` on `frontend` only; `proxy-init` on `none`;
  `db` on `default` only (shares NO network with `proxy`); `app` on `default` +
  `frontend`; proxy has no `env_file` and no app/DB secret in its environment.

## 1. HTTP serves no app content (spec §8 acceptance)
- Enable TLS on a throwaway domain (or point STATIC_RULES at a test host); bring the
  stack up under `--profile tls`.
- `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <fqdn>' http://127.0.0.1/`
  must be a redirect or non-2xx — NEVER 200 with app HTML. Confirm the redirect
  target is https. Confirm port 80 serves the ACME HTTP-01 challenge path.
- Verify the exact redirect status against the pinned reproxy; note whether HSTS is
  present on HTTPS responses.

## 2. >64 KiB upload through the proxy (MAX_SIZE=25M)
- POST a ~1 MiB body through the proxy; it must NOT be rejected at the proxy layer
  (reproxy default body cap is 64K; MAX_SIZE=25M must override it).

## 3. Upgrade migration (pre-Slice-5 -> Slice-5)
- Start from a pre-Slice-5 on-disk compose (app+db on default, no proxy). Run
  `mathion tls enable …`. Confirm it re-materializes the compose, brings the stack
  onto default+frontend, and does NOT strand app<->db. Confirm SMTP egress still
  works (app stays on default, an egress bridge).

## 4. restore / update decoupling
- Standalone restore with TLS enabled runs pull -> run proxy-init -> up proxy and
  the proxy comes back; a slow/unhealthy proxy never fails the restore gate.
- `mathion update` recreates app WITHOUT restarting the proxy; confirm reproxy
  re-resolves app:8000 for new connections (brief blip then recovery).
- Confirm `up -d --wait` treats the healthcheck-less proxy as ready on "started"
  and that the whole-project up does not error on the completed proxy-init one-shot.

## 5. Real Let's Encrypt issuance (public domain required)
- install -> `mathion tls enable --domain <fqdn> --email <addr>` -> a valid cert on
  https://<fqdn> -> login works -> http://<fqdn> returns no app content ->
  SMTP notification still sends -> `mathion tls disable` preserves the https posture
  -> `mathion tls status` reflects each state.

## Sign-off
- [ ] Items 0–4 PASS on <host / date>.
- [ ] Item 5 PASS on <domain / date> (or explicitly deferred, like the amd64 cloud smoke).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-23-phase9-d-slice5-onhost-verification.md
git commit -m "$(cat <<'EOF'
docs: Slice 5 on-host verification runbook (pinned-digest sign-off)

Enumerates the spec §13 checks that only run against a real Docker host + public
domain: structural config, HTTP-serves-no-app-content, >64KiB upload, upgrade
migration, restore/update decoupling, and real LE issuance.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)

- [ ] `cd cli && gofmt -l .` prints nothing.
- [ ] `cd cli && go vet ./...` is clean.
- [ ] `cd cli && go test ./...` is green.
- [ ] `diff docker-compose.prod.yml cli/internal/compose/docker-compose.yml` is empty (byte-identical invariant).
- [ ] `git log --oneline` shows one commit per task (12), each with the exact trailer.
