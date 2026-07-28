package cmd

import "github.com/spf13/cobra"

// newSuperuserCmd is a stub; its RunE body is implemented in a later task.
func newSuperuserCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "superuser",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
