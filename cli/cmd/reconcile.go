package cmd

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// removeMarkerFn is the step-6f marker-clear seam so a test can exercise the
// "removal failed after a successful apply → warn, exit 0" path (spec §4.1 step 6f).
var removeMarkerFn = varlib.RemoveMarker

func newReconcileCmd(app *App) *cobra.Command {
	var yes bool
	c := &cobra.Command{
		Use:   "reconcile",
		Short: "Apply this CLI's bundled stack definition to the running deployment",
		Long: "Re-materialize the embedded Docker Compose to /etc/mathion and bring the " +
			"project up so Compose reconciles the running containers to it. Use after a CLI " +
			"upgrade that changed the stack definition (see `mathion status`).",
		RunE: func(c *cobra.Command, _ []string) error {
			release, proceed, err := lockAndGuard(c.Context(), app, "reconcile")
			defer release()
			if err != nil || !proceed {
				return err
			}
			return app.reconcile(c.Context(), yes)
		},
	}
	c.Flags().BoolVar(&yes, "yes", false, "skip the confirmation prompt (for automation)")
	return c
}

// reconcile applies the embedded compose to a running deployment (spec §4.1). The
// caller (newReconcileCmd) has already taken the operation lock and run the
// breadcrumb entry-check via lockAndGuard.
func (a *App) reconcile(ctx context.Context, yes bool) error {
	// Step 2: installed-deployment gate — fail closed on a poisoned/incomplete .env
	// BEFORE any write or container mutation (spec §4.1 step 2).
	if err := a.requireInstalledDeployment(); err != nil {
		return err
	}
	// Completeness gate: refuse a never-finished install BEFORE any mutation (spec §4.3).
	if err := a.requireInstallComplete(); err != nil {
		return err
	}
	// Step 3: re-derive TLS state UNDER THE LOCK — not the pre-lock startup snapshot
	// (spec §4.1 step 3). tlsEnabledFromEnv fails closed.
	a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)
	// Step 4: require a running app container (spec §4.1 step 4).
	if !a.appRunning(ctx) {
		return fmt.Errorf("no running app container for project %q; start the stack with `mathion start` "+
			"(or finish a fresh install with `mathion install`) before reconciling", a.Project)
	}
	// Step 5: drift read + confirm (spec §4.1 step 5).
	composePath := filepath.Join(a.CfgDir, "docker-compose.yml")
	onDisk, _ := os.ReadFile(composePath) // a read error → treat as "differs" and re-materialize anyway
	differs := !bytes.Equal(onDisk, compose.ComposeYAML)
	if !yes {
		if differs {
			fmt.Fprint(a.Out, "the on-disk stack definition differs from this mathion binary's embedded "+
				"definition; reconcile will re-materialize it and recreate any service whose configuration "+
				"changed. Any changed service is briefly recreated (an HTTPS interruption if the proxy changes; "+
				"app downtime if the app definition changed). Continue? [y/N] ")
		} else {
			fmt.Fprint(a.Out, "the on-disk stack definition already matches this binary; reconcile will ensure "+
				"the running containers match it. Continue? [y/N] ")
		}
		line, _ := bufio.NewReader(a.In).ReadString('\n')
		if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
			return errors.New("reconcile cancelled")
		}
	}
	// Step 6a: apply-pending marker BEFORE any container change (spec §4.1 step 6a).
	if err := varlib.WriteMarker(); err != nil {
		return fmt.Errorf("writing the apply-pending marker: %w", err)
	}
	// Step 6b: re-materialize the on-disk compose from the embed (the exact write
	// install/tls enable use).
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(composePath, composeBytes(), 0o644); err != nil {
		return err
	}
	// Step 6c: targeted pinned-proxy pre-pull, TLS only, FATAL on failure (spec §4.1 step 6c).
	if a.tlsEnabled {
		pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
		err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init")
		pcancel()
		if err != nil {
			return fmt.Errorf("could not fetch the pinned bundled-proxy image reconcile needs "+
				"(check connectivity): %w", err)
		}
	}
	// Step 6d: whole-project bring-up; never pulls a mutable tag; never reaps orphans.
	if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never"); err != nil {
		return err
	}
	// Step 6e: bounded HTTPS readiness (TLS only; the proxy has no healthcheck).
	if a.tlsEnabled {
		a.reportHTTPSReadiness()
	}
	// Step 6f: clear the marker; a removal failure does NOT fail a successful apply
	// (spec §4.1 step 6f) — warn and exit 0.
	if err := removeMarkerFn(); err != nil {
		fmt.Fprintf(a.Err, "warning: reconcile succeeded but could not clear the apply-pending marker at %s (%v); "+
			"`mathion status` may show a spurious drift notice until the next reconcile\n", varlib.MarkerPath(), err)
	}
	// Step 7: report this CLI's stack revision (buildVersion, not the app image tag).
	fmt.Fprintf(a.Out, "reconciled to this CLI's stack definition (%s); run `mathion status` to confirm.\n", buildVersion)
	return nil
}

// appRunning reports whether the project's app container is up (best-effort),
// mirroring proxyRunning (tls.go:258): `compose ps -q app` lists only running
// containers by default, so a non-empty result means the app is up.
func (a *App) appRunning(ctx context.Context) bool {
	out, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
	return err == nil && strings.TrimSpace(out) != ""
}
