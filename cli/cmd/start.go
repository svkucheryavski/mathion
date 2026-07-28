package cmd

import "github.com/spf13/cobra"

// newStartCmd is a stub; its RunE body is implemented in a later task.
func newStartCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "start",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
