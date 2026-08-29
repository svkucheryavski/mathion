package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
)

// healthProbe is the /health seam so status_test can force the healthy/unhealthy
// branches without a live app. Its inferred type is func(context.Context, string) error,
// but status.go names no `context` identifier of its own (c.Context() is a method
// call), so `context` is NOT imported here — an unused import would fail to compile.
var healthProbe = dockerx.HealthProbe

func newStatusCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show stack status + /health",
		RunE: func(c *cobra.Command, _ []string) error {
			if err := app.compose(c.Context(), "ps"); err != nil {
				return err
			}
			// Passive pre-health notice: install-incomplete is orthogonal to /health,
			// so it is emitted on BOTH return-nil branches below. The compose-drift
			// notice is NOT emitted here — the root pre-run (spec §4.1) owns it now and
			// routes it to stderr on every non-excluded command, so status inherits it
			// without a second, stdout copy.
			maybeWarnInstallIncomplete(app.Out, app.CfgDir)
			img := ""
			if m, err := config.ReadEnvFile(app.CfgDir); err == nil {
				img = m["MATHION_VERSION"]
			}
			if err := healthProbe(c.Context(), "http://127.0.0.1:8000/health"); err != nil {
				fmt.Fprintf(app.Out, "stack not healthy: %v (is it running? `mathion start`)\n", err)
				return nil
			}
			fmt.Fprintf(app.Out, "healthy — image %s\n", img)
			return nil
		},
	}
}
