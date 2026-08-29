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
	// Step 3 (TLS re-derive UNDER THE LOCK) now lives in applyStack, right before the up.
	// Step 4: require a running app container (spec §4.1 step 4).
	if !a.appRunning(ctx) {
		return fmt.Errorf("no running app container for project %q; start the stack with `mathion start` "+
			"(or finish a fresh install with `mathion install`) before reconciling", a.Project)
	}
	// Step 5: drift read + confirm (spec §4.1 step 5).
	onDisk, _ := os.ReadFile(composePath(a)) // a read error → treat as "differs" and re-materialize anyway
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
	// Steps 6b–6e (shared with update): re-materialize + pre-pull + up + readiness.
	if err := a.applyStack(ctx); err != nil {
		return err // marker retained → status nags until a clean apply
	}
	// Step 6f: clear the marker (warn-only).
	a.clearApplyMarker()
	// Step 7: report.
	fmt.Fprintf(a.Out, "reconciled to this CLI's stack definition (%s); run `mathion status` to confirm.\n", buildVersion)
	return nil
}

// composePath is the on-disk compose location (honors MATHION_CONFIG_DIR via CfgDir).
func composePath(a *App) string { return filepath.Join(a.CfgDir, "docker-compose.yml") }

// applyStack re-materializes the embedded compose and reconciles the running project
// to it. LOCK-FREE: the caller holds varlib.Lock, has run the install/complete/running
// gates + confirmation, has ALREADY written the apply-pending marker, and clears it
// itself only after its own final validation. Mirrors the old reconcile steps 3 + 6b–6e.
func (a *App) applyStack(ctx context.Context) error {
	a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir) // re-derive UNDER the lock, fail-closed
	if err := config.EnsureConfigDir(a.CfgDir); err != nil {
		return err
	}
	if err := config.AtomicWrite(composePath(a), composeBytes(), 0o644); err != nil {
		return err
	}
	if a.tlsEnabled {
		pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
		err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init")
		pcancel()
		if err != nil {
			return fmt.Errorf("could not fetch the pinned bundled-proxy image reconcile needs "+
				"(check connectivity): %w", err)
		}
	}
	if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never"); err != nil {
		return err
	}
	if a.tlsEnabled {
		a.reportHTTPSReadiness()
	}
	return nil
}

// clearApplyMarker removes the apply-pending marker; a removal failure is warn-only.
// The message PRESERVES the substring "could not clear the apply-pending marker" that
// reconcile_test.go asserts.
func (a *App) clearApplyMarker() {
	if err := removeMarkerFn(); err != nil {
		fmt.Fprintf(a.Err, "warning: the stack was applied but could not clear the apply-pending marker at %s (%v); "+
			"`mathion status` may show a spurious drift notice until the next reconcile\n", varlib.MarkerPath(), err)
	}
}

// appRunning reports whether the project's app container is up (best-effort),
// mirroring proxyRunning (tls.go:258): `compose ps -q app` lists only running
// containers by default, so a non-empty result means the app is up.
func (a *App) appRunning(ctx context.Context) bool {
	out, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
	return err == nil && strings.TrimSpace(out) != ""
}
