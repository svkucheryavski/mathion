package cmd

import (
	"bytes"
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/prompt"
)

const guideURL = "https://github.com/svkucheryavski/mathion/blob/main/docs/self-hosting.md#tls--reverse-proxy-external"

// pinRunner answers the pin command with out/err and records every call.
func pinRunner(out string, err error) *compose.FakeRunner {
	return &compose.FakeRunner{OutputFunc: func(a []string) (string, error) {
		if strings.Contains(strings.Join(a, " "), "mathion.superuser pin --") {
			return out, err
		}
		return "", nil
	}}
}

func pinCalled(f *compose.FakeRunner) bool {
	for _, c := range f.Calls {
		if strings.HasSuffix(strings.Join(c, " "), "exec -T app python -m mathion.superuser pin -- you@example.edu") {
			return true
		}
	}
	return false
}

func endApp(f *compose.FakeRunner) (*App, *bytes.Buffer) {
	var out bytes.Buffer
	return &App{CfgDir: "/nonexistent", Project: "mathion_prod", Runner: f, Out: &out, Err: &out}, &out
}

func wantAll(t *testing.T, got string, want ...string) {
	t.Helper()
	for _, w := range want {
		if !strings.Contains(got, w) {
			t.Fatalf("output lacks %q:\n%s", w, got)
		}
	}
}

func TestEndingOnPrintsPIN(t *testing.T) {
	f := pinRunner("PIN: 482913\nIt expires in 15 minutes.\n", nil)
	app, out := endApp(f)
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{On: true})
	wantAll(t, out.String(), "✓ Mathion is running at https://learn.example.edu", "Sign in with:  you@example.edu",
		"First PIN:     482913   (works for 15 minutes)", "open the admin panel to set up email and your first course:\n      sudo mathion panel\n")
	if !pinCalled(f) || strings.Contains(out.String(), "ports 80 and 443") {
		t.Fatalf("calls %v out %q", f.Calls, out.String())
	}
}

func TestEndingOnPinFails(t *testing.T) {
	app, out := endApp(pinRunner("", errors.New("exit 1")))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{On: true})
	wantAll(t, out.String(), "✓ Mathion is running", "Run sudo mathion pin you@example.edu to get a sign-in PIN.", "sudo mathion panel")
	if strings.Contains(out.String(), "First PIN") {
		t.Fatalf("out %q", out.String())
	}
}

func TestEndingOnUnparsedPrintsRaw(t *testing.T) {
	app, out := endApp(pinRunner("something odd\n", nil))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{On: true})
	wantAll(t, out.String(), "First PIN:     something odd")
}

func TestEndingPendingAddsFirewallHint(t *testing.T) {
	app, out := endApp(pinRunner("PIN: 1\nIt expires in 15 minutes.\n", nil))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{On: true, Pending: true})
	wantAll(t, out.String(), "Mathion is installed. https://learn.example.edu will work once the certificate arrives.", "First PIN:     1",
		"If HTTPS does not start within a few minutes, check that your provider's firewall allows ports 80 and 443.")
	if strings.Contains(out.String(), "✓ Mathion is running") {
		t.Fatalf("out %q", out.String())
	}
}

func TestEndingOffNoPin(t *testing.T) {
	f := pinRunner("PIN: 1\n", nil)
	app, out := endApp(f)
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{Reason: "you answered no", NextCmd: httpsNext})
	wantAll(t, out.String(), "Mathion is installed but cannot be reached until HTTPS is set up.", "HTTPS is not on: you answered no.",
		httpsNext, guideURL, "Then run:  sudo mathion pin you@example.edu", "sudo mathion panel")
	if pinCalled(f) || strings.Contains(out.String(), "First PIN") || strings.Contains(out.String(), "✓") {
		t.Fatalf("calls %v out %q", f.Calls, out.String())
	}
}

func TestEndingOffHostPortGuide(t *testing.T) {
	app, out := endApp(pinRunner("", nil))
	app.printEnding(context.Background(), "learn.example.edu:8443", "you@example.edu", httpsResult{Reason: "this site address is not a plain domain name, which a free certificate needs"})
	wantAll(t, out.String(), guideURL, "Then run:  sudo mathion pin you@example.edu")
	if strings.Contains(out.String(), "tls enable") || strings.Contains(out.String(), "Turn it on with") {
		t.Fatalf("out %q", out.String())
	}
}

// matchingDNS makes the HTTPS step's checks pass for learn.example.edu.
func matchingDNS(t *testing.T) {
	t.Cleanup(swapBindable(func(string) error { return nil }))
	t.Cleanup(swapLookup(func(string) ([]string, error) { return []string{"203.0.113.9"}, nil }))
	prevLocal, prevProbe := localAddrs, probeDomainHTTPS
	localAddrs = func() ([]net.IP, error) { return []net.IP{net.ParseIP("203.0.113.9")}, nil }
	probeDomainHTTPS = func(context.Context, string) bool { return true }
	t.Cleanup(func() { localAddrs, probeDomainHTTPS = prevLocal, prevProbe })
}

func callIndex(f *compose.FakeRunner, suffix string) int {
	for i, c := range f.Calls {
		if strings.HasSuffix(strings.Join(c, " "), suffix) {
			return i
		}
	}
	return -1
}

func TestFreshInstallNoOldNextSteps(t *testing.T) {
	app, out := endApp(pinRunner("", nil))
	app.CfgDir = t.TempDir()
	if err := app.runInstallFresh(context.Background(), installOpts{Domain: "learn.example.edu", AdminEmail: "you@example.edu", Version: "v0.1.1"}); err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{"docker compose ... exec", "README", "Deployment up"} {
		if strings.Contains(out.String(), s) {
			t.Fatalf("old next steps remain (%q):\n%s", s, out.String())
		}
	}
	wantAll(t, out.String(), "Mathion is installed but cannot be reached until HTTPS is set up.")
}

func TestFreshInstallEndsWithPIN(t *testing.T) {
	matchingDNS(t)
	f := pinRunner("PIN: 482913\nIt expires in 15 minutes.\n", nil)
	app, out := endApp(f)
	app.CfgDir = t.TempDir()
	app.Prompt = prompt.New(strings.NewReader("y\n"), out, true)
	if err := app.runInstallFresh(context.Background(), installOpts{Domain: "learn.example.edu", AdminEmail: "you@example.edu", Version: "v0.1.1"}); err != nil {
		t.Fatal(err)
	}
	su, tls, pin := callIndex(f, "create-superuser -- you@example.edu"), callIndex(f, "--profile tls up -d --wait"), callIndex(f, "mathion.superuser pin -- you@example.edu")
	if su < 0 || tls <= su || pin <= tls {
		t.Fatalf("order superuser=%d tls=%d pin=%d calls %v", su, tls, pin, f.Calls)
	}
	wantAll(t, out.String(), "First PIN:     482913   (works for 15 minutes)")
}

// seedInstalled writes a complete install; tls turns bundled HTTPS on in .env.
func seedInstalled(t *testing.T, tls bool) string {
	t.Helper()
	dir := t.TempDir()
	if err := config.WriteState(dir, config.State{Schema: 2, AdminEmail: "you@example.edu", Complete: true}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "p"))), 0o600); err != nil {
		t.Fatal(err)
	}
	if tls {
		if err := config.SetTLS(dir, "learn.example.edu", "you@example.edu"); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestResumeAsksHTTPSWhenOff(t *testing.T) {
	matchingDNS(t)
	f := pinRunner("PIN: 482913\nIt expires in 15 minutes.\n", nil)
	app, out := endApp(f)
	app.CfgDir = seedInstalled(t, false)
	app.Prompt = prompt.New(strings.NewReader("y\n"), out, true)
	probeDomainHTTPS = func(context.Context, string) bool { return callIndex(f, "--profile tls up -d --wait") >= 0 } // answers once the proxy is up
	if err := app.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	m, _ := config.ReadEnvFile(app.CfgDir)
	if m["MATHION_TLS_DOMAIN"] != "learn.example.edu" || callIndex(f, "--profile tls up -d --wait") < 0 {
		t.Fatalf("env %v calls %v", m, f.Calls)
	}
	wantAll(t, out.String(), "Turn on HTTPS with a free Let's Encrypt certificate? [Y/n]", "First PIN:     482913")
}

func TestResumeWithTLSOnNoNewPin(t *testing.T) {
	matchingDNS(t)
	f := pinRunner("PIN: 1\n", nil)
	app, out := endApp(f)
	app.CfgDir = seedInstalled(t, true)
	app.tlsEnabled = true
	app.Prompt = prompt.New(failReader{t}, out, true)
	if err := app.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	if pinCalled(f) || strings.Contains(out.String(), "First PIN") {
		t.Fatalf("calls %v out %q", f.Calls, out.String())
	}
	wantAll(t, out.String(), "✓ Mathion is running at https://learn.example.edu", "Run sudo mathion pin you@example.edu to get a sign-in PIN.", "sudo mathion panel")
}

func TestResumeWithTLSOnChecksCertificate(t *testing.T) {
	app, out := endApp(pinRunner("", nil))
	app.CfgDir = seedInstalled(t, true)
	app.tlsEnabled = true
	if err := app.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	wantAll(t, out.String(), "The certificate is still on its way.", "check that your provider's firewall allows ports 80 and 443")
	if strings.Contains(out.String(), "First PIN") {
		t.Fatalf("out %q", out.String())
	}
}

func TestEndingOnEmptyPinOutput(t *testing.T) {
	app, out := endApp(pinRunner("  \n", nil))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{On: true})
	wantAll(t, out.String(), "Run sudo mathion pin you@example.edu to get a sign-in PIN.")
	if strings.Contains(out.String(), "First PIN") {
		t.Fatalf("out %q", out.String())
	}
}

func TestEndingPortBusySaysWhen(t *testing.T) {
	app, out := endApp(pinRunner("", nil))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu",
		httpsResult{Reason: "port 80 is in use by another program, often Apache or nginx", NextCmd: httpsNext, PortBusy: true})
	wantAll(t, out.String(), "Once the port is free, turn it on with:\n      "+httpsNext)
}

// TestFreshInstallAsksHTTPSBeforeStarting pins the sketch's order: every question before the long start.
func TestFreshInstallAsksHTTPSBeforeStarting(t *testing.T) {
	matchingDNS(t)
	f := pinRunner("PIN: 1\nIt expires in 15 minutes.\n", nil)
	app, out := endApp(f)
	app.CfgDir = t.TempDir()
	asked := -1
	app.Prompt = prompt.New(strings.NewReader("y\n"), out, true)
	f.RunFunc = func(a []string) error {
		if asked < 0 && strings.Contains(out.String(), "Turn on HTTPS with a free Let's Encrypt certificate?") {
			asked = len(f.Calls)
		}
		return nil
	}
	if err := app.runInstallFresh(context.Background(), installOpts{Domain: "learn.example.edu", AdminEmail: "you@example.edu", Version: "v0.1.1"}); err != nil {
		t.Fatal(err)
	}
	pull := callIndex(f, " pull")
	if pull < 0 || asked < 0 || asked > pull+1 {
		t.Fatalf("question not before pull: asked=%d pull=%d", asked, pull)
	}
	if strings.Index(out.String(), "points at this server … ok") > strings.Index(out.String(), "Starting Mathion …") {
		t.Fatalf("DNS check after start:\n%s", out.String())
	}
	wantAll(t, out.String(), "  Starting Mathion … ok\n", "First PIN:     1")
}

func TestFreshInstallInputEndsAtHTTPSWritesNothing(t *testing.T) {
	app, out := endApp(pinRunner("", nil))
	app.CfgDir = t.TempDir()
	app.Prompt = prompt.New(strings.NewReader(""), out, true)
	if err := app.runInstallFresh(context.Background(), installOpts{Domain: "learn.example.edu", AdminEmail: "you@example.edu", Version: "v0.1.1"}); err == nil {
		t.Fatal("want the unanswered error")
	}
	if _, err := os.Stat(app.CfgDir + "/.env"); err == nil {
		t.Fatal(".env written although the HTTPS question was not answered")
	}
}

func TestResumeOwnProxyAnswersNoQuestion(t *testing.T) {
	prev := probeDomainHTTPS
	probeDomainHTTPS = func(context.Context, string) bool { return true }
	t.Cleanup(func() { probeDomainHTTPS = prev })
	f := pinRunner("PIN: 1\n", nil)
	app, out := endApp(f)
	app.CfgDir = seedInstalled(t, false)
	app.Prompt = prompt.New(failReader{t}, out, true)
	if err := app.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	if pinCalled(f) || callIndex(f, "--profile tls up -d --wait") >= 0 {
		t.Fatalf("calls %v", f.Calls)
	}
	wantAll(t, out.String(), "✓ Mathion is running at https://learn.example.edu", "Run sudo mathion pin you@example.edu to get a sign-in PIN.")
}

func TestResumeHostPortGivesGuide(t *testing.T) {
	f := pinRunner("PIN: 1\n", nil)
	app, out := endApp(f)
	app.CfgDir = seedInstalled(t, false)
	if err := os.WriteFile(app.CfgDir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu:8443", "v0.1.1", "s", "p"))), 0o600); err != nil {
		t.Fatal(err)
	}
	app.Prompt = prompt.New(failReader{t}, out, true)
	if err := app.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	if pinCalled(f) {
		t.Fatalf("calls %v", f.Calls)
	}
	wantAll(t, out.String(), guideURL)
}

func TestResumeNoTLSChangesNothing(t *testing.T) {
	f := pinRunner("PIN: 1\n", nil)
	app, out := endApp(f)
	app.CfgDir = seedInstalled(t, false)
	app.Prompt = prompt.New(failReader{t}, out, true)
	if err := app.runInstall(context.Background(), installOpts{NoTLS: true}); err != nil {
		t.Fatal(err)
	}
	m, _ := config.ReadEnvFile(app.CfgDir)
	if m["MATHION_TLS_DOMAIN"] != "" || pinCalled(f) || callIndex(f, "--profile tls up -d --wait") >= 0 {
		t.Fatalf("env %v calls %v", m, f.Calls)
	}
	wantAll(t, out.String(), "HTTPS is not on: --no-tls was given.")
}

func TestResumeFailureSkipsTheEnding(t *testing.T) {
	f := pinRunner("", nil)
	f.RunFunc = func(a []string) error {
		if strings.HasSuffix(strings.Join(a, " "), "up -d --wait --pull never") {
			return errors.New("up failed")
		}
		return nil
	}
	app, out := endApp(f)
	app.CfgDir = seedInstalled(t, false)
	err := app.runInstall(context.Background(), installOpts{})
	if err == nil || !strings.Contains(err.Error(), "Fix the problem shown above, then run sudo mathion install again") {
		t.Fatalf("want the resume error with the next step, got %v", err)
	}
	if strings.Contains(out.String(), "Mathion is") {
		t.Fatalf("ending printed after a failed resume: %q", out.String())
	}
}

func TestResumeNormalisesTheSavedAddress(t *testing.T) {
	var probed string
	prev := probeDomainHTTPS
	probeDomainHTTPS = func(_ context.Context, d string) bool { probed = d; return true }
	t.Cleanup(func() { probeDomainHTTPS = prev })
	app, out := endApp(pinRunner("", nil))
	app.CfgDir = seedInstalled(t, false)
	if err := os.WriteFile(app.CfgDir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://Learn.Example.EDU./", "v0.1.1", "s", "p"))), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := app.runInstall(context.Background(), installOpts{}); err != nil {
		t.Fatal(err)
	}
	if probed != "learn.example.edu" {
		t.Fatalf("probed %q", probed)
	}
	wantAll(t, out.String(), "✓ Mathion is running at https://learn.example.edu\n")
}

func TestEndingPendingSaysHowToGetANewPIN(t *testing.T) {
	app, out := endApp(pinRunner("PIN: 482913\nIt expires in 15 minutes.\n", nil))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{On: true, Pending: true})
	wantAll(t, out.String(), "If the PIN runs out before the site opens, run sudo mathion pin you@example.edu for a new one.")
	app, out = endApp(pinRunner("PIN: 482913\nIt expires in 15 minutes.\n", nil))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{On: true})
	if strings.Contains(out.String(), "runs out") {
		t.Fatalf("not pending: %q", out.String())
	}
}

func TestEndingOffNamesInstallAgain(t *testing.T) {
	app, out := endApp(pinRunner("", nil))
	app.printEnding(context.Background(), "learn.example.edu", "you@example.edu", httpsResult{Reason: "you answered no", NextCmd: tlsEnableLine("learn.example.edu", "you@example.edu")})
	wantAll(t, out.String(), "Or run sudo mathion install again: it asks about HTTPS once more.")
	app, out = endApp(pinRunner("", nil))
	app.printEnding(context.Background(), "learn.example.edu:8443", "you@example.edu", httpsResult{Reason: "not a plain domain"})
	if strings.Contains(out.String(), "install again") {
		t.Fatalf("host:port: %q", out.String())
	}
}
