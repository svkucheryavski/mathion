package cmd

import "github.com/spf13/cobra"

func newStartCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "start",
		Short: "Start the stack (docker compose up -d --wait)",
		RunE: func(c *cobra.Command, _ []string) error {
			release, proceed, err := lockAndGuard(c.Context(), app, "start")
			defer release()
			if err != nil || !proceed {
				return err
			}
			// --pull never: start boots the image already pinned in .env; it must
			// never reach out to a registry (a moved/absent tag would silently swap
			// the running image).
			return app.compose(c.Context(), "up", "-d", "--wait", "--pull", "never")
		},
	}
}
