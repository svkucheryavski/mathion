package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/notices"
)

func newLicensesCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "licenses",
		Short: "Print the licences of Mathion and the code built into it",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			_, err := fmt.Fprintf(app.Out, "Mathion CLI is licensed under the Apache License 2.0 (see LICENSE in the source repository).\n\n%s", notices.Text)
			return err
		},
	}
}
