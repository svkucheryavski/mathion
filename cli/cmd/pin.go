package cmd

import "github.com/spf13/cobra"

// newPinCmd is a stub; its RunE body is implemented in a later task.
func newPinCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "pin",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
