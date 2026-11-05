package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newPinCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "pin <email>",
		Short: "Issue a sign-in PIN (the panel's Settings page sets how long a PIN lasts)",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			// The superuser subcommand streams the PIN and its real lifetime (from
			// the panel's Settings) to stdout and always exits 0, so we do NOT gate
			// on ITS result. It skips the request limit (Settings D12). But
			// `docker compose exec` itself fails (daemon down, app container not
			// running) with a non-zero exit — surface that instead of printing a
			// misleading advisory as if a PIN had been issued. `--` ends option
			// parsing so an email is never mistaken for a flag.
			if err := app.compose(c.Context(), "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", "--", args[0]); err != nil {
				return err
			}
			fmt.Fprintln(app.Out, "Log in at your HTTPS domain — NOT http://127.0.0.1:8000 (the Secure cookie won't persist over plain HTTP).")
			return nil
		},
	}
}
