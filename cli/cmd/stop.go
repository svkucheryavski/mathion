package cmd

import "github.com/spf13/cobra"

// newStopCmd is a stub; its RunE body is implemented in a later task.
func newStopCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "stop",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
