package cmd

import "github.com/spf13/cobra"

// newLogsCmd is a stub; its RunE body is implemented in a later task.
func newLogsCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "logs",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
