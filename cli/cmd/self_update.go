package cmd

import (
	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/selfupdate"
)

func newSelfUpdateCmd(app *App) *cobra.Command {
	var yes, check bool
	c := &cobra.Command{
		Use:   "self-update",
		Short: "Update the mathion CLI binary (curl|sh installs; apt installs are deferred to apt)",
		RunE: func(c *cobra.Command, _ []string) error {
			return selfupdate.Run(c.Context(), selfupdate.Params{
				Out: app.Out, Err: app.Err, In: app.In,
				Yes: yes, Check: check,
				Cfg:            selfupdate.DefaultConfig(),
				CurrentVersion: buildVersion,
			})
		},
	}
	c.Flags().BoolVar(&yes, "yes", false, "skip the confirmation prompt")
	c.Flags().BoolVar(&check, "check", false, "report whether a newer installable release exists; no root, no swap")
	return c
}
