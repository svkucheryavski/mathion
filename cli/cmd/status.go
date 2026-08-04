package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
)

func newStatusCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show stack status + /health",
		RunE: func(c *cobra.Command, _ []string) error {
			if err := app.compose(c.Context(), "ps"); err != nil {
				return err
			}
			img := ""
			if m, err := config.ReadEnvFile(app.CfgDir); err == nil {
				img = m["MATHION_VERSION"]
			}
			if err := dockerx.HealthProbe(c.Context(), "http://127.0.0.1:8000/health"); err != nil {
				fmt.Fprintf(app.Out, "stack not healthy: %v (is it running? `mathion start`)\n", err)
				return nil
			}
			fmt.Fprintf(app.Out, "healthy — image %s\n", img)
			return nil
		},
	}
}
