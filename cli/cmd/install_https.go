package cmd

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/prompt"
)

// httpsResult says how the HTTPS step ended.
type httpsResult struct {
	On      bool   // the proxy is up
	Pending bool   // the certificate was not verified within the wait
	Reason  string // when off: why, as a lowercase phrase
	NextCmd string // when off: the tls enable line to run later; empty for a host:port address
}

// Package seams for the HTTPS step's checks.
var (
	localAddrs       = interfaceIPs
	probeDomainHTTPS = getHealthOverHTTPS
	certWait         = 2 * time.Minute
	certPoll         = 5 * time.Second
)

// interfaceIPs lists this server's own addresses.
func interfaceIPs() ([]net.IP, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil, err
	}
	var ips []net.IP
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok {
			ips = append(ips, n.IP)
		}
	}
	return ips, nil
}

// getHealthOverHTTPS reports whether https://<domain>/health answers with a valid certificate.
func getHealthOverHTTPS(ctx context.Context, domain string) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+domain+"/health", nil)
	if err != nil {
		return false
	}
	client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}} // no proxy from the environment
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func tlsEnableLine(domain, email string) string {
	return fmt.Sprintf("sudo mathion tls enable --domain %s --email %s", domain, email)
}

// httpsStep turns on the bundled HTTPS proxy unless something stands in the way.
func (a *App) httpsStep(ctx context.Context, domain, email string, o installOpts) (httpsResult, error) {
	domain = config.NormalizeSiteAddress(domain)
	if config.ValidateDomain(domain) != nil {
		return httpsResult{Reason: "this site address is not a plain domain name, which a free certificate needs"}, nil
	}
	later := email
	if config.ValidateTLSEmail(email) != nil {
		later = "<your-email>"
	}
	off := func(reason string) (httpsResult, error) {
		return httpsResult{Reason: reason, NextCmd: tlsEnableLine(domain, later)}, nil
	}
	const noTerminal = "there was no terminal to ask on (add --yes to turn it on without asking)"
	if o.NoTLS {
		return off("--no-tls was given")
	}
	ok, err := a.confirm(o.Yes, "Turn on HTTPS with a free Let's Encrypt certificate?", true)
	switch {
	case errors.Is(err, prompt.ErrNotInteractive):
		return off(noTerminal)
	case err != nil:
		return httpsResult{}, unanswered(err, "add --no-tls to skip HTTPS")
	case !ok:
		return off("you answered no")
	}
	if !a.proxyRunning(ctx) {
		for _, p := range []string{"80", "443"} {
			if portBindable(":"+p) != nil {
				return off("port " + p + " is in use by another program, often Apache or nginx")
			}
		}
	}
	if config.ValidateTLSEmail(email) != nil {
		bad := "Let's Encrypt cannot use the email " + email
		if o.Yes {
			return httpsResult{Reason: bad, NextCmd: tlsEnableLine(domain, later)}, nil
		}
		fmt.Fprintf(a.Err, "  %s. Type another one for its notices.\n", bad)
		email, err = a.prompter().Ask("Email for Let's Encrypt", checkTLSEmail)
		switch {
		case errors.Is(err, prompt.ErrNotInteractive):
			return httpsResult{Reason: bad, NextCmd: tlsEnableLine(domain, later)}, nil
		case err != nil:
			return httpsResult{}, unanswered(err, "add --no-tls to skip HTTPS")
		}
	}
	email = config.NormalizeEmail(email)
	later = email
	if !a.dnsPointsHere(domain) {
		ok, err := a.confirm(o.Yes, "Turn on HTTPS anyway?", false)
		switch {
		case errors.Is(err, prompt.ErrNotInteractive):
			return off(noTerminal)
		case err != nil:
			return httpsResult{}, unanswered(err, "add --no-tls to skip HTTPS")
		case !ok:
			return off(domain + " does not point at this server yet")
		}
		if o.Yes {
			fmt.Fprintf(a.Err, "warning: turning HTTPS on anyway; it starts by itself once %s points at this server.\n", domain)
		}
	}
	if err := a.turnOnTLS(ctx, domain, email); err != nil {
		return httpsResult{}, err
	}
	return httpsResult{On: true, Pending: !a.waitForCertificate(ctx, domain)}, nil
}

// checkTLSEmail words the Let's Encrypt email check for the admin.
func checkTLSEmail(s string) error {
	if s == "" {
		return errors.New("Please type an email address.")
	}
	if config.ValidateTLSEmail(s) != nil {
		return errors.New("Let's Encrypt cannot use this address. Type one like name@school.edu, without spaces, quotes, $, braces or backslashes.")
	}
	return nil
}

// dnsPointsHere compares the domain's addresses with this server's; true also when it cannot tell.
func (a *App) dnsPointsHere(domain string) bool {
	got, lerr := dnsLookup(domain)
	mine := ownAddrs()
	if lerr == nil {
		var ips []net.IP
		for _, g := range got {
			if ip := net.ParseIP(g); ip != nil && !ip.IsLoopback() {
				ips = append(ips, ip)
			}
		}
		if len(ips) == 0 && len(got) > 0 {
			fmt.Fprintf(a.Out, "  %s points at this server's loopback address (often set in /etc/hosts), so public DNS cannot be checked from here; going on.\n", domain)
			return true
		}
		for _, ip := range ips {
			for _, m := range mine {
				if ip.Equal(m) {
					fmt.Fprintf(a.Out, "  Checking that %s points at this server … ok\n", domain)
					return true
				}
			}
		}
		if len(mine) == 0 {
			fmt.Fprintln(a.Out, "  This server's own addresses could not be read, so the domain cannot be compared; going on.")
			return true
		}
		if allPrivate(mine) {
			fmt.Fprintln(a.Out, "  This server has only private addresses, so the domain cannot be compared; going on.")
			return true
		}
		if fam, ok := noPublicFamily(ips, mine); ok {
			fmt.Fprintf(a.Out, "  This server has no public %s address of its own, so the domain cannot be compared; going on.\n", fam)
			return true
		}
	}
	list := "none found"
	if shown := publicOrAll(mine); len(shown) > 0 {
		s := make([]string, len(shown))
		for i, m := range shown {
			s[i] = m.String()
		}
		list = strings.Join(s, ", ")
	}
	if lerr != nil {
		fmt.Fprintf(a.Out, "  Could not look up %s (%v). This server's addresses are %s.\n", domain, lerr, list)
	} else {
		fmt.Fprintf(a.Out, "  %s points at %s, but this server's addresses are %s.\n", domain, strings.Join(got, ", "), list)
	}
	fmt.Fprintln(a.Out, "  If your provider has a firewall, it must allow ports 80 and 443.")
	return false
}

// ownAddrs lists this server's addresses other than loopback and link-local.
func ownAddrs() []net.IP {
	all, err := localAddrs()
	if err != nil {
		return nil
	}
	var out []net.IP
	for _, ip := range all {
		if !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified() {
			out = append(out, ip)
		}
	}
	return out
}

// sharedRange is 100.64.0.0/10 (carrier NAT, Tailscale).
var sharedRange = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

func isPrivate(ip net.IP) bool {
	return ip.IsPrivate() || sharedRange.Contains(ip)
}

func allPrivate(ips []net.IP) bool {
	for _, ip := range ips {
		if !isPrivate(ip) {
			return false
		}
	}
	return len(ips) > 0
}

func familyOf(ip net.IP) string {
	if ip.To4() != nil {
		return "IPv4"
	}
	return "IPv6"
}

// noPublicFamily reports a family DNS uses when the server has no public address in any family DNS uses.
func noPublicFamily(dns, mine []net.IP) (string, bool) {
	public := map[string]bool{}
	for _, m := range mine {
		if !isPrivate(m) {
			public[familyOf(m)] = true
		}
	}
	fam := ""
	for _, ip := range dns {
		if public[familyOf(ip)] {
			return "", false
		}
		fam = familyOf(ip)
	}
	return fam, fam != ""
}

// publicOrAll returns the public addresses, or all of them when none is public.
func publicOrAll(ips []net.IP) []net.IP {
	var pub []net.IP
	for _, ip := range ips {
		if !isPrivate(ip) {
			pub = append(pub, ip)
		}
	}
	if len(pub) == 0 {
		return ips
	}
	return pub
}

// waitForCertificate polls the site over HTTPS until it answers or certWait passes.
func (a *App) waitForCertificate(ctx context.Context, domain string) bool {
	fmt.Fprint(a.Out, "  Getting the certificate …")
	deadline := time.Now().Add(certWait)
	for {
		if probeDomainHTTPS(ctx, domain) {
			fmt.Fprintln(a.Out, " ok")
			return true
		}
		if ctx.Err() != nil || !time.Now().Before(deadline) {
			fmt.Fprintln(a.Out)
			fmt.Fprintln(a.Out, "  The certificate is still on its way. Check with sudo mathion tls status in a few minutes.")
			return false
		}
		fmt.Fprint(a.Out, ".")
		select {
		case <-ctx.Done():
		case <-time.After(certPoll):
		}
	}
}
