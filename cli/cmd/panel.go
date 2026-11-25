package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

func newPanelCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "panel",
		Short: "Print a link to the admin panel",
		Args:  cobra.NoArgs,
		RunE: func(c *cobra.Command, _ []string) error {
			if err := requireRoot(); err != nil {
				return err
			}
			if err := app.requireInstalledDeployment(); err != nil {
				return err
			}
			// The backend prints the link; a new link replaces the old one.
			if err := app.compose(c.Context(), "exec", "-T", "app", "python", "-m", "mathion.superuser", "activate"); err != nil {
				return fmt.Errorf("no panel link was made (%w). Is Mathion running? Start it with: sudo mathion start", err)
			}
			who := "a superuser"
			if st, err := config.ReadState(app.CfgDir); err == nil && st.AdminEmail != "" {
				who = st.AdminEmail
			}
			fmt.Fprintf(app.Out, "Sign in as %s first, then open this link in the same browser. It stops working after 30 minutes without use; running this command again replaces it.\n", who)
			return nil
		},
	}
}
