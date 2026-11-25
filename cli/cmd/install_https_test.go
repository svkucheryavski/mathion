package cmd

import (
	"bytes"
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/prompt"
)

const (
	httpsDomain = "learn.example.edu"
	httpsEmail  = "you@example.edu"
	httpsNext   = "sudo mathion tls enable --domain learn.example.edu --email you@example.edu"
	httpsLater  = "sudo mathion tls enable --domain learn.example.edu --email <your-email>"
)

// httpsWorld fakes ports, DNS, this server's addresses and the certificate probe.
type httpsWorld struct {
	app       *App
	out       *bytes.Buffer
	calls     [][]string
	busy      string // the port address that is taken, e.g. ":80"
	proxyUp   bool
	lookup    []string
	lookupErr error
	local     []net.IP
	ready     bool
}

func newHTTPSWorld(t *testing.T, answers string, interactive bool) *httpsWorld {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "p"))), 0o600); err != nil {
		t.Fatal(err)
	}
	w := &httpsWorld{out: &bytes.Buffer{}, lookup: []string{"203.0.113.9"}, local: []net.IP{net.ParseIP("203.0.113.9")}, ready: true}
	fr := &compose.FakeRunner{
		RunFunc: func(a []string) error { w.calls = append(w.calls, a); return nil },
		OutputFunc: func(a []string) (string, error) {
			if w.proxyUp && strings.Contains(strings.Join(a, " "), "ps -q proxy") {
				return "abc\n", nil
			}
			return "", nil
		},
	}
	w.app = &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: w.out, Err: w.out,
		Prompt: prompt.New(strings.NewReader(answers), w.out, interactive)}
	t.Cleanup(swapBindable(func(addr string) error {
		if addr == w.busy {
			return errors.New("address already in use")
		}
		return nil
	}))
	t.Cleanup(swapLookup(func(string) ([]string, error) { return w.lookup, w.lookupErr }))
	prevLocal, prevProbe, prevWait, prevPoll := localAddrs, probeDomainHTTPS, certWait, certPoll
	localAddrs = func() ([]net.IP, error) { return w.local, nil }
	probeDomainHTTPS = func(context.Context, string) bool { return w.ready }
	certWait, certPoll = 20*time.Millisecond, time.Millisecond
	t.Cleanup(func() { localAddrs, probeDomainHTTPS, certWait, certPoll = prevLocal, prevProbe, prevWait, prevPoll })
	return w
}

// noReads makes any question fail the test.
func (w *httpsWorld) noReads(t *testing.T) {
	w.app.Prompt = prompt.New(failReader{t}, w.out, true)
}

// proxyStarted reports whether the proxy was brought up with the tls profile.
func (w *httpsWorld) proxyStarted() bool {
	for _, c := range w.calls {
		j := strings.Join(c, " ")
		if strings.Contains(j, "--profile tls") && strings.HasSuffix(j, "up -d --wait") {
			return true
		}
	}
	return false
}

func (w *httpsWorld) step(t *testing.T, domain, email string, o installOpts) httpsResult {
	t.Helper()
	h, err := w.app.httpsStep(context.Background(), domain, email, o)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func wantOff(t *testing.T, w *httpsWorld, h httpsResult, reason, next string) {
	t.Helper()
	if h.On || !strings.Contains(h.Reason, reason) || h.NextCmd != next || w.proxyStarted() {
		t.Fatalf("result %+v, proxy started %v, out %q", h, w.proxyStarted(), w.out.String())
	}
}

func wantOn(t *testing.T, w *httpsWorld, h httpsResult, pending bool) {
	t.Helper()
	if !h.On || h.Pending != pending || !w.proxyStarted() {
		t.Fatalf("result %+v, proxy started %v, out %q", h, w.proxyStarted(), w.out.String())
	}
	m, _ := config.ReadEnvFile(w.app.CfgDir)
	if m["MATHION_TLS_DOMAIN"] != httpsDomain {
		t.Fatalf("TLS not saved: %v", m)
	}
}

func TestHTTPSHostPortSkips(t *testing.T) {
	w := newHTTPSWorld(t, "", true)
	w.noReads(t)
	wantOff(t, w, w.step(t, "learn.example.edu:8443", httpsEmail, installOpts{}), "not a plain domain name", "")
}

func TestHTTPSNoTLS(t *testing.T) {
	w := newHTTPSWorld(t, "", true)
	w.noReads(t)
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{NoTLS: true, Yes: true}), "--no-tls", httpsNext)
}

func TestHTTPSDeclined(t *testing.T) {
	w := newHTTPSWorld(t, "n\n", true)
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), "you answered no", httpsNext)
	if !strings.Contains(w.out.String(), "Turn on HTTPS with a free Let's Encrypt certificate? [Y/n]") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSNoTerminalOff(t *testing.T) {
	w := newHTTPSWorld(t, "", false)
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), "add --yes", httpsNext)
}

func TestHTTPSInputEnds(t *testing.T) {
	w := newHTTPSWorld(t, "", true)
	_, err := w.app.httpsStep(context.Background(), httpsDomain, httpsEmail, installOpts{})
	if err == nil || !strings.Contains(err.Error(), "The question was not answered") || w.proxyStarted() {
		t.Fatalf("err=%v", err)
	}
}

func TestHTTPSPortBusy(t *testing.T) {
	for _, yes := range []bool{false, true} {
		w := newHTTPSWorld(t, "y\n", true)
		if yes {
			w.noReads(t)
		}
		w.busy = ":80"
		wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{Yes: yes}), "port 80 is in use by another program, often Apache or nginx", httpsNext)
	}
}

func TestHTTPSOwnProxySkipsPortCheck(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.busy, w.proxyUp = ":443", true
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
}

func TestHTTPSDNSMatch(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if !strings.Contains(w.out.String(), "Checking that learn.example.edu points at this server … ok") || strings.Contains(w.out.String(), "anyway") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSDNSMatchesAnyAddress(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.local = []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("2001:db8::5"), net.ParseIP("203.0.113.9")}
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if strings.Contains(w.out.String(), "anyway") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSPrivateOnlyGoesOn(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.local = []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("fe80::1"), net.ParseIP("10.0.0.5"), net.ParseIP("fd00::5")}
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if !strings.Contains(w.out.String(), "This server has only private addresses, so the domain cannot be compared; going on.") || strings.Contains(w.out.String(), "anyway") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSDNSMismatchAsks(t *testing.T) {
	w := newHTTPSWorld(t, "y\nn\n", true)
	w.local = []net.IP{net.ParseIP("198.51.100.7"), net.ParseIP("2001:db8::5")}
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), "learn.example.edu does not point at this server yet", httpsNext)
	for _, s := range []string{
		"learn.example.edu points at 203.0.113.9, but this server's addresses are 198.51.100.7, 2001:db8::5.",
		"If your provider has a firewall, it must allow ports 80 and 443.",
		"Turn on HTTPS anyway? [y/N]",
	} {
		if !strings.Contains(w.out.String(), s) {
			t.Fatalf("output lacks %q: %q", s, w.out.String())
		}
	}
}

func TestHTTPSLookupFailsAsks(t *testing.T) {
	w := newHTTPSWorld(t, "y\n\n", true)
	w.lookup, w.lookupErr = nil, errors.New("no such host")
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), "does not point at this server yet", httpsNext)
	if !strings.Contains(w.out.String(), "Could not look up learn.example.edu") || !strings.Contains(w.out.String(), "Turn on HTTPS anyway? [y/N]") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSDNSMismatchYes(t *testing.T) {
	w := newHTTPSWorld(t, "", true)
	w.noReads(t)
	w.local = []net.IP{net.ParseIP("198.51.100.7")}
	w.ready = false
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{Yes: true}), true)
	if !strings.Contains(w.out.String(), "The certificate is still on its way. Check with sudo mathion tls status in a few minutes.") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSStricterEmailAsks(t *testing.T) {
	w := newHTTPSWorld(t, "y\nnot-an-email\nadmin@example.edu\n", true)
	wantOn(t, w, w.step(t, httpsDomain, "o'brien@example.edu", installOpts{}), false)
	m, _ := config.ReadEnvFile(w.app.CfgDir)
	if m["MATHION_TLS_EMAIL"] != "admin@example.edu" {
		t.Fatalf("TLS email %q", m["MATHION_TLS_EMAIL"])
	}
	if !strings.Contains(w.out.String(), "Email for Let's Encrypt: ") || !strings.Contains(w.out.String(), "  Let's Encrypt cannot use this address") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSStricterEmailYesOff(t *testing.T) {
	w := newHTTPSWorld(t, "", true)
	w.noReads(t)
	wantOff(t, w, w.step(t, httpsDomain, "o'brien@example.edu", installOpts{Yes: true}), "Let's Encrypt cannot use the email", httpsLater)
}

func TestHTTPSCertReady(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if !strings.Contains(w.out.String(), "  Getting the certificate … ok\n") || strings.Contains(w.out.String(), "still on its way") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSCertReadyAfterRetries(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	tries := 0
	probeDomainHTTPS = func(context.Context, string) bool { tries++; return tries == 3 }
	certWait = time.Second
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if !strings.Contains(w.out.String(), "  Getting the certificate ….. ok\n") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSNormalisesTheAddress(t *testing.T) {
	for _, d := range []string{"Learn.Example.EDU.", "learn.example.edu/"} {
		w := newHTTPSWorld(t, "y\n", true)
		wantOn(t, w, w.step(t, d, httpsEmail, installOpts{}), false)
	}
	w := newHTTPSWorld(t, "", true)
	w.noReads(t)
	wantOff(t, w, w.step(t, "203.0.113.9", httpsEmail, installOpts{}), "not a plain domain name", "")
}

func TestHTTPSNextCmdNeverCarriesARefusedEmail(t *testing.T) {
	w := newHTTPSWorld(t, "", true)
	w.noReads(t)
	wantOff(t, w, w.step(t, httpsDomain, "o'brien@example.edu", installOpts{NoTLS: true}), "--no-tls", httpsLater)
}

func TestHTTPSPort443Busy(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.busy = ":443"
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), "port 443 is in use", httpsNext)
}

func TestHTTPSMatchNotFirst(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.lookup = []string{"2001:db8::9", "203.0.113.9"}
	w.local = []net.IP{net.ParseIP("203.0.113.9"), net.ParseIP("2001:db8::5")}
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if strings.Contains(w.out.String(), "anyway") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSPrivateIPv4PublicIPv6GoesOn(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.local = []net.IP{net.ParseIP("10.0.0.5"), net.ParseIP("2001:db8::5")}
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if !strings.Contains(w.out.String(), "This server has no public IPv4 address of its own, so the domain cannot be compared; going on.") || strings.Contains(w.out.String(), "anyway") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSIPv6MismatchStillAsks(t *testing.T) {
	w := newHTTPSWorld(t, "y\nn\n", true)
	w.lookup = []string{"203.0.113.9", "2001:db8::9"}
	w.local = []net.IP{net.ParseIP("10.0.0.5"), net.ParseIP("2001:db8::5")}
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), "does not point at this server yet", httpsNext)
}

func TestHTTPSSharedRangeCountsAsPrivate(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.local = []net.IP{net.ParseIP("10.0.0.5"), net.ParseIP("100.100.1.2")}
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
}

func TestHTTPSMismatchListsOnlyPublicAddresses(t *testing.T) {
	w := newHTTPSWorld(t, "y\nn\n", true)
	w.local = []net.IP{net.ParseIP("198.51.100.7"), net.ParseIP("172.17.0.1")}
	w.step(t, httpsDomain, httpsEmail, installOpts{})
	if !strings.Contains(w.out.String(), "but this server's addresses are 198.51.100.7.") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSHostsFileLoopbackGoesOn(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.lookup = []string{"127.0.1.1"}
	w.local = []net.IP{net.ParseIP("198.51.100.7")}
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if !strings.Contains(w.out.String(), "learn.example.edu points at this server's loopback address (often set in /etc/hosts), so public DNS cannot be checked from here; going on.") || strings.Contains(w.out.String(), "anyway") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSLookupFailsOnPrivateServerAsks(t *testing.T) {
	w := newHTTPSWorld(t, "y\n\n", true)
	w.lookup, w.lookupErr = nil, errors.New("no such host")
	w.local = []net.IP{net.ParseIP("10.0.0.5")}
	wantOff(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), "does not point at this server yet", httpsNext)
}

func TestHTTPSMismatchYesWarns(t *testing.T) {
	w := newHTTPSWorld(t, "", true)
	w.noReads(t)
	w.local = []net.IP{net.ParseIP("198.51.100.7")}
	w.step(t, httpsDomain, httpsEmail, installOpts{Yes: true})
	if !strings.Contains(w.out.String(), "warning: turning HTTPS on anyway; it starts by itself once learn.example.edu points at this server.") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestHTTPSInputEndsAtEmail(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	_, err := w.app.httpsStep(context.Background(), httpsDomain, "o'brien@example.edu", installOpts{})
	if err == nil || !strings.Contains(err.Error(), "The question was not answered") || w.proxyStarted() {
		t.Fatalf("err=%v", err)
	}
}

func TestHTTPSStartFailureIsAnError(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.app.Runner.(*compose.FakeRunner).RunFunc = func([]string) error { return errors.New("pull failed") }
	h, err := w.app.httpsStep(context.Background(), httpsDomain, httpsEmail, installOpts{})
	if err == nil || h.On {
		t.Fatalf("h=%+v err=%v", h, err)
	}
}

func TestHTTPSTypedEmailInLaterCommand(t *testing.T) {
	w := newHTTPSWorld(t, "y\nadmin@example.edu\nn\n", true)
	w.local = []net.IP{net.ParseIP("198.51.100.7")}
	wantOff(t, w, w.step(t, httpsDomain, "o'brien@example.edu", installOpts{}), "does not point at this server yet",
		"sudo mathion tls enable --domain learn.example.edu --email admin@example.edu")
}

func TestHTTPSUnreadableOwnAddressesGoesOn(t *testing.T) {
	w := newHTTPSWorld(t, "y\n", true)
	w.local = nil
	wantOn(t, w, w.step(t, httpsDomain, httpsEmail, installOpts{}), false)
	if !strings.Contains(w.out.String(), "This server's own addresses could not be read, so the domain cannot be compared; going on.") {
		t.Fatalf("out %q", w.out.String())
	}
}
