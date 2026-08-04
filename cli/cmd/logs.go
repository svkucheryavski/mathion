package cmd

import "github.com/spf13/cobra"

func newLogsCmd(app *App) *cobra.Command {
	var follow bool
	c := &cobra.Command{
		Use:   "logs [app|db]",
		Short: "Show stack logs",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			sub := []string{"logs"}
			if follow {
				sub = append(sub, "--follow")
			}
			sub = append(sub, args...)
			return app.compose(c.Context(), sub...)
		},
	}
	c.Flags().BoolVarP(&follow, "follow", "f", false, "follow log output")
	return c
}
