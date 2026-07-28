package cmd

import "github.com/spf13/cobra"

// newStatusCmd is a stub; its RunE body is implemented in a later task.
func newStatusCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "status",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
