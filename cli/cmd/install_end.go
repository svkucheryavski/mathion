package cmd

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// externalProxyGuide is the guide section for running your own HTTPS proxy.
const externalProxyGuide = "https://github.com/svkucheryavski/mathion/blob/main/docs/self-hosting.md#tls--reverse-proxy-external"

var (
	pinRe     = regexp.MustCompile(`PIN: (\d+)`)
	minutesRe = regexp.MustCompile(`It expires in (\d+) minutes`)
)

const panelLines = "  Then open the admin panel to set up email and your first course:\n      sudo mathion panel\n"

// printEnding tells the admin how to sign in, or what is left before the site can be reached.
func (a *App) printEnding(ctx context.Context, domain, email string, h httpsResult) {
	if !h.On {
		a.printOffEnding(email, h)
		return
	}
	a.printOnHeader(domain, email, h)
	out, err := a.Runner.Output(ctx, a.composeArgs("exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", "--", email)...)
	pin, mins := pinRe.FindStringSubmatch(out), minutesRe.FindStringSubmatch(out)
	switch {
	case err != nil || strings.TrimSpace(out) == "":
		fmt.Fprintf(a.Out, "  Run sudo mathion pin %s to get a sign-in PIN.\n", email)
	case pin != nil && mins != nil:
		fmt.Fprintf(a.Out, "  First PIN:     %s   (works for %s minutes)\n", pin[1], mins[1])
	default:
		fmt.Fprintf(a.Out, "  First PIN:     %s\n", strings.Join(strings.Fields(out), " "))
	}
	fmt.Fprint(a.Out, "\n"+panelLines)
}

// printRerunEnding is the ending of a re-run on a site that already has HTTPS: no new PIN.
func (a *App) printRerunEnding(domain, email string, h httpsResult) {
	a.printOnHeader(domain, email, h)
	fmt.Fprintf(a.Out, "  Run sudo mathion pin %s to get a sign-in PIN.\n\n%s", email, panelLines)
}

func (a *App) printOnHeader(domain, email string, h httpsResult) {
	if h.Pending {
		fmt.Fprintf(a.Out, "\nMathion is installed. https://%s will work once the certificate arrives.\n\n", domain)
		fmt.Fprint(a.Out, "  If HTTPS does not start within a few minutes, check that your provider's firewall allows ports 80 and 443.\n\n")
	} else {
		fmt.Fprintf(a.Out, "\n✓ Mathion is running at https://%s\n\n", domain)
	}
	fmt.Fprintf(a.Out, "  Sign in with:  %s\n", email)
}

func (a *App) printOffEnding(email string, h httpsResult) {
	fmt.Fprintln(a.Out, "\nMathion is installed but cannot be reached until HTTPS is set up.")
	fmt.Fprintf(a.Out, "  HTTPS is not on: %s.\n\n", h.Reason)
	turnOn := "Turn it on with:"
	if h.PortBusy {
		turnOn = "Once the port is free, turn it on with:"
	}
	if h.NextCmd != "" {
		fmt.Fprintf(a.Out, "  %s\n      %s\n  Or put your own HTTPS proxy in front, as the guide shows:\n      %s\n\n", turnOn, h.NextCmd, externalProxyGuide)
	} else {
		fmt.Fprintf(a.Out, "  Put your own HTTPS proxy in front, as the guide shows:\n      %s\n\n", externalProxyGuide)
	}
	fmt.Fprintf(a.Out, "  Then run:  sudo mathion pin %s\n  and open the admin panel to set up email and your first course:\n      sudo mathion panel\n", email)
}

// rerunHTTPS finishes a re-run: the HTTPS step when it is off, then the matching ending.
func (a *App) rerunHTTPS(ctx context.Context, email string, o installOpts) error {
	m, err := config.ReadEnvFile(a.CfgDir)
	if err != nil {
		return err
	}
	domain := config.NormalizeSiteAddress(strings.TrimPrefix(strings.TrimPrefix(m["MATHION_BASE_URL"], "https://"), "http://"))
	if a.tlsEnabled {
		a.printRerunEnding(domain, email, httpsResult{On: true, Pending: !a.waitForCertificate(ctx, domain)})
		return nil
	}
	if probeDomainHTTPS(ctx, domain) { // HTTPS already served, e.g. by the admin's own proxy
		a.printRerunEnding(domain, email, httpsResult{On: true})
		return nil
	}
	h, err := a.httpsStep(ctx, domain, email, o)
	if err != nil {
		return err
	}
	a.printEnding(ctx, domain, email, h)
	return nil
}
