package cmd

import (
	"bytes"
	"context"
	"errors"
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

// writePoisonedTLSEnv writes a .env that is a valid, TLS-enabled deployment EXCEPT the
// TLS email is a Compose interpolation payload — the exact shape a hand edit / partial
// write / crafted backup could produce. It bypasses SetTLS (which would reject it).
func writePoisonedTLSEnv(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "abc123hex"))), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(dir + "/.env")
	if err != nil {
		t.Fatal(err)
	}
	poisoned := strings.Replace(string(raw), "admin@example.edu", "${POSTGRES_PASSWORD}@x.y", 1)
	if poisoned == string(raw) {
		t.Fatal("fixture setup: email line not found to poison")
	}
	if err := os.WriteFile(dir+"/.env", []byte(poisoned), 0o600); err != nil {
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

func TestTLSStatusFailsClosedOnPoisonedEnv(t *testing.T) {
	dir := writePoisonedTLSEnv(t)
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out, Err: &out}
	cmd := newTLSCmd(app)
	cmd.SetArgs([]string{"status"})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "disabled") {
		t.Fatalf("status must report disabled on an inconsistent .env; got %q", out.String())
	}
	if strings.Contains(out.String(), "POSTGRES_PASSWORD") {
		t.Fatalf("status must not echo the payload value; got %q", out.String())
	}
}

func TestTLSEnableRejectsWhitespaceEmail(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://x.example.edu", "v0.1.1", "s", "p"))), 0o600)
	// A VALID installed deployment (state + hermetic seams) so the email validator — not
	// a missing install-state — is the operative gate. Without this, pre-fix code errors
	// at requireInstalledDeployment for the WRONG reason and the test would pass vacuously
	// (NormalizeEmail would have silently trimmed the leading space); with it, pre-fix runs
	// clean to success (fails the test) and only the raw-email fix rejects it (passes).
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err)
	}
	defer swapProbe(func() bool { return true })()
	defer swapBindable(func(string) error { return nil })()
	defer swapLookup(func(string) ([]string, error) { return []string{"1.2.3.4"}, nil })()
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: io.Discard, Err: io.Discard}
	if err := app.tlsEnable(context.Background(), tlsEnableOpts{Domain: "learn.example.edu", Email: " admin@example.edu"}); err == nil {
		t.Fatal("enable must reject an email with leading whitespace, not silently trim it")
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

func TestTLSDisableAbortsOnNonToleratedExitError(t *testing.T) {
	dir := writeEnabledEnv(t)
	var out bytes.Buffer
	fr := &compose.FakeRunner{
		StreamFunc: func(_ io.Writer, _ []string) error {
			return &compose.ExitError{Code: 1, Stderr: []byte("permission denied while trying to connect to the Docker daemon socket")}
		},
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out, tlsEnabled: true}
	if err := app.tlsDisable(context.Background()); err == nil {
		t.Fatal("disable must return an error when the reap fails for a non-tolerated reason")
	}
	if !app.tlsEnabled {
		t.Error("tlsEnabled must stay true after an aborted disable")
	}
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_TLS_DOMAIN"] != "learn.example.edu" {
		t.Fatalf("a failed reap must NOT clear TLS state; domain=%q", m["MATHION_TLS_DOMAIN"])
	}
	if m["MATHION_TLS_EMAIL"] != "admin@example.edu" {
		t.Fatalf("a failed reap must NOT clear TLS email; email=%q", m["MATHION_TLS_EMAIL"])
	}
}

func TestTLSDisableAbortsOnPlainErrorEvenWithPhrase(t *testing.T) {
	dir := writeEnabledEnv(t)
	var out bytes.Buffer
	fr := &compose.FakeRunner{
		StreamFunc: func(_ io.Writer, _ []string) error {
			return errors.New("no such service: proxy") // plain error, NOT *compose.ExitError
		},
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out, tlsEnabled: true}
	if err := app.tlsDisable(context.Background()); err == nil {
		t.Fatal("a plain (non-ExitError) reap error must abort even if its message contains the phrase")
	}
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_TLS_DOMAIN"] != "learn.example.edu" {
		t.Fatalf("plain-error abort must NOT clear TLS state; domain=%q", m["MATHION_TLS_DOMAIN"])
	}
}

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
	// A hostile domain OR email must be rejected BEFORE any write. The fixture is a
	// VALID installed deployment, so the identity guard passes and validation — not a
	// missing install-state — is the operative gate. docker-compose.yml is seeded with
	// a sentinel: a regression that re-materialized it (or wrote .env) before validating
	// would be caught here.
	const sentinel = "SENTINEL-COMPOSE-DO-NOT-REWRITE\n"
	cases := []struct {
		name, domain, email string
	}{
		{"hostile-email", "learn.example.edu", "${POSTGRES_PASSWORD}@x.y"},
		{"hostile-domain", "${INJECT}.example.edu", "admin@example.edu"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://x.example.edu", "v0.1.1", "s", "p"))), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "admin@example.edu"}); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(dir+"/docker-compose.yml", []byte(sentinel), 0o644); err != nil {
				t.Fatal(err)
			}
			envBefore, _ := os.ReadFile(dir + "/.env")

			var calls [][]string
			fr := &compose.FakeRunner{
				RunFunc:    func(args []string) error { calls = append(calls, args); return nil },
				OutputFunc: func(args []string) (string, error) { calls = append(calls, args); return "", nil },
				StreamFunc: func(_ io.Writer, args []string) error { calls = append(calls, args); return nil },
			}
			app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard}
			// Hermetic: on correct code these are never reached (validation rejects first),
			// but stub them so a regression can't touch real ports/DNS.
			defer swapBindable(func(string) error { return nil })()
			defer swapLookup(func(string) ([]string, error) { return []string{"1.2.3.4"}, nil })()

			if err := app.tlsEnable(context.Background(), tlsEnableOpts{Domain: tc.domain, Email: tc.email}); err == nil {
				t.Fatal("enable must reject an interpolation payload")
			}
			if envAfter, _ := os.ReadFile(dir + "/.env"); string(envAfter) != string(envBefore) {
				t.Fatal("a rejected enable must leave .env byte-identical")
			}
			if composeAfter, _ := os.ReadFile(dir + "/docker-compose.yml"); string(composeAfter) != sentinel {
				t.Fatal("a rejected enable must NOT re-materialize docker-compose.yml (validation precedes the compose write)")
			}
			if len(calls) != 0 {
				t.Fatalf("a rejected enable must issue no compose commands; got %v", calls)
			}
		})
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

func TestRequireInstallComplete(t *testing.T) {
	// missing marker
	empty := t.TempDir()
	if err := (&App{CfgDir: empty}).requireInstallComplete(); err == nil {
		t.Fatal("missing install-state must refuse")
	}
	// incomplete
	inc := t.TempDir()
	if err := config.WriteState(inc, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: false}); err != nil {
		t.Fatal(err)
	}
	err := (&App{CfgDir: inc}).requireInstallComplete()
	if err == nil || !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("incomplete install must refuse with a resume hint; got %v", err)
	}
	// complete + grandfathered
	for _, s := range []config.State{
		{Schema: 2, AdminEmail: "a@b.c", Complete: true},
		{Schema: 1, AdminEmail: "a@b.c"},
	} {
		d := t.TempDir()
		if err := config.WriteState(d, s); err != nil {
			t.Fatal(err)
		}
		if err := (&App{CfgDir: d}).requireInstallComplete(); err != nil {
			t.Fatalf("%+v must pass; got %v", s, err)
		}
	}
}

func TestTLSEnableRefusesOnIncompleteInstall(t *testing.T) {
	dir := installedDeployment(t, false) // seeds Schema 1 + .env + compose
	if err := config.WriteState(dir, config.State{Schema: 2, AdminEmail: "admin@example.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: io.Discard, Err: io.Discard}
	if err := app.tlsEnable(context.Background(), tlsEnableOpts{Domain: "learn.example.edu", Email: "admin@example.edu"}); err == nil {
		t.Fatal("tls enable must refuse on an incomplete install")
	}
	// spec §5: the gate precedes the compose re-materialize (tls.go AtomicWrite), so a
	// refusal must leave the stale installedDeployment seed in place, not the embed.
	if got, _ := os.ReadFile(dir + "/docker-compose.yml"); bytes.Equal(got, compose.ComposeYAML) {
		t.Error("refused tls enable must NOT re-materialize docker-compose.yml")
	}
	if hasCall(f.Calls, joinHas("up -d")) {
		t.Fatalf("tls enable must not bring the stack up on refusal; calls=%v", f.Calls)
	}
}

func TestTLSDisableToleratesNoSuchServiceThenClears(t *testing.T) {
	dir := writeEnabledEnv(t)
	var out bytes.Buffer
	fr := &compose.FakeRunner{
		StreamFunc: func(_ io.Writer, _ []string) error {
			return &compose.ExitError{Code: 1, Stderr: []byte("no such service: proxy")}
		},
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out, tlsEnabled: true}
	if err := app.tlsDisable(context.Background()); err != nil {
		t.Fatalf("a `no such service: proxy` reap must be tolerated: %v", err)
	}
	if app.tlsEnabled {
		t.Error("tlsEnabled must be false after a successful disable")
	}
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_TLS_DOMAIN"] != "" || m["MATHION_TLS_EMAIL"] != "" {
		t.Fatalf("tolerated reap must still clear TLS vars; domain=%q email=%q", m["MATHION_TLS_DOMAIN"], m["MATHION_TLS_EMAIL"])
	}
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" || m["MATHION_COOKIE_SECURE"] != "1" {
		t.Fatalf("posture must survive disable; base=%q secure=%q", m["MATHION_BASE_URL"], m["MATHION_COOKIE_SECURE"])
	}
}
