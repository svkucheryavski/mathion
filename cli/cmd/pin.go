package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newPinCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "pin <email>",
		Short: "Issue a first-login PIN (expires in 10 min; rate-limited 3/hour)",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			// The subcommand streams the PIN (or an error/rate-limit line) to
			// stdout and always exits 0 — surface its output, do NOT gate.
			_ = app.compose(c.Context(), "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", args[0])
			fmt.Fprintln(app.Out, "PIN expires in 10 min. Log in at your HTTPS domain — NOT http://127.0.0.1:8000 (the Secure cookie won't persist over plain HTTP).")
			return nil
		},
	}
}
