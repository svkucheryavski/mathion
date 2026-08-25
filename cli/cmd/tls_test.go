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
