package cmd

import "github.com/spf13/cobra"

// newInstallCmd is a stub; its RunE body is implemented in a later task.
func newInstallCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "install",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
