package cmd

import "github.com/spf13/cobra"

func newStartCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "start",
		Short: "Start the stack (docker compose up -d --wait)",
		RunE: func(c *cobra.Command, _ []string) error {
			return app.compose(c.Context(), "up", "-d", "--wait")
		},
	}
}
