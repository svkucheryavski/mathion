package cmd

import "github.com/spf13/cobra"

// newVersionCmd is a stub; its RunE body is implemented in a later task.
func newVersionCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:  "version",
		RunE: func(*cobra.Command, []string) error { return nil },
	}
}
