package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

func newVersionCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print CLI + pinned image version",
		RunE: func(_ *cobra.Command, _ []string) error {
			img := "(not installed)"
			if m, err := config.ReadEnvFile(app.CfgDir); err == nil {
				if v := m["MATHION_VERSION"]; v != "" {
					img = v
				}
			}
			fmt.Fprintf(app.Out, "mathion %s\nimage %s\n", buildVersion, img)
			return nil
		},
	}
}
