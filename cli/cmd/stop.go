package cmd

import "github.com/spf13/cobra"

func newStopCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the stack (containers stopped; data + config retained)",
		RunE: func(c *cobra.Command, _ []string) error {
			return app.compose(c.Context(), "stop")
		},
	}
}
