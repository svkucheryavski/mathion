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
			// The superuser subcommand prints the PIN and its real lifetime (from
			// the panel's Settings) and skips the request limit (Settings D12).
			// For an unknown or disabled email it says which and exits 1; `docker
			// compose exec` itself fails the same way (daemon down, app container
			// not running). Either way no PIN was issued, so no advisory. `--`
			// ends option parsing so an email is never mistaken for a flag.
			if err := app.compose(c.Context(), "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", "--", args[0]); err != nil {
				return fmt.Errorf("no PIN was issued (%w)", err)
			}
			fmt.Fprintln(app.Out, "Log in at your HTTPS domain — NOT http://127.0.0.1:8000 (the Secure cookie won't persist over plain HTTP).")
			return nil
		},
	}
}
