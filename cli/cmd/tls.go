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

// newTLSEnableCmd is fully implemented in Task 7.
func newTLSEnableCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:    "enable",
		Short:  "Enable bundled auto-HTTPS for one public domain (Let's Encrypt)",
		Hidden: true,
		RunE:   func(c *cobra.Command, _ []string) error { return errors.New("not yet implemented") },
	}
}
