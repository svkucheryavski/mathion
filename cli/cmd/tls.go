package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
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
			if !tlsEnabledFromEnv(app.CfgDir) {
				fmt.Fprintln(app.Out, "bundled TLS: disabled")
				return nil
			}
			m, _ := config.ReadEnvFile(app.CfgDir) // validated above; re-read for display
			domain := strings.TrimSpace(m["MATHION_TLS_DOMAIN"])
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
	// Validate the RAW flag first so leading/trailing whitespace is rejected, not
	// silently trimmed away (NormalizeEmail would hide it). ValidateTLSEmail accepts
	// mixed case (it lowercases the domain part itself), so this never rejects a
	// legitimate email that only needs normalizing.
	if err := config.ValidateTLSEmail(o.Email); err != nil {
		return err
	}
	email := config.NormalizeEmail(o.Email)
	// 1 (identity): require a valid, installed deployment (same guard install-resume uses).
	if err := a.requireInstalledDeployment(); err != nil {
		return err
	}
	// Completeness gate: refuse a never-finished install before compose re-materialize / up (spec §4.3).
	if err := a.requireInstallComplete(); err != nil {
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

// requirePrivateEnv verifies .env exists, is a regular file, and is owner-only
// (perm&0o077 == 0). Shared verbatim by requireInstalledDeployment (reconcile/tls)
// and update's pre-apply gate — the error strings MUST NOT change (tests assert them).
func (a *App) requirePrivateEnv() error {
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
	return nil
}

// requireInstalledDeployment reuses the install-resume identity/state guard
// (install.go:59) — a present, regular, private .env on a valid, complete install.
func (a *App) requireInstalledDeployment() error {
	if err := a.requirePrivateEnv(); err != nil {
		return err
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

// requireInstallComplete refuses when install-state says the install never
// finished migrating/creating the superuser (Schema 2, complete:false), OR when
// there is no valid install-state at all (missing/corrupt). Schema 1 is
// grandfathered complete. It is a separate predicate from requireInstalledDeployment
// so start/update/restore adopt exactly this one check.
func (a *App) requireInstallComplete() error {
	st, err := config.ReadState(a.CfgDir)
	if err != nil {
		return fmt.Errorf("no valid mathion install found at %s (%w); run `sudo mathion install` to set one up. If a previous install left a broken marker here, repair its install-state so install can resume, or run `sudo mathion uninstall --purge` (removes containers and volumes) then remove the config dir by hand before reinstalling", a.CfgDir, err)
	}
	if !st.InstallComplete() {
		return errors.New("this deployment's install did not finish (database not migrated / superuser not created); resume it with `sudo mathion install` before continuing")
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
		if i+1 < httpsPollAttempts {
			sleepBetweenPolls()
		}
	}
	fmt.Fprintln(a.Out, "  https listener not yet reachable — issuance/DNS may still be pending; check `mathion tls status`.")
}

var httpsPollAttempts = 6
var sleepBetweenPolls = func() { time.Sleep(500 * time.Millisecond) }
