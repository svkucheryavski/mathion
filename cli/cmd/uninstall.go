package cmd

import "github.com/spf13/cobra"

// newUninstallCmd is a stub; its RunE body is implemented in a later task.
func newUninstallCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "uninstall",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
