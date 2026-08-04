package cmd

import "github.com/spf13/cobra"

func newSuperuserCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "superuser <email>",
		Short: "Create or promote a superuser account (idempotent)",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			// create-superuser exits 0 on create/promote, non-zero on invalid
			// input — gate on the exit code. `--` ends option parsing so an email
			// is never mistaken for a flag.
			return app.compose(c.Context(), "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", "--", args[0])
		},
	}
}
