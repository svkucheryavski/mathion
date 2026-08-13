package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

func newStopCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the stack (containers stopped; data + config retained)",
		RunE: func(c *cobra.Command, _ []string) error {
			release, proceed, err := lockAndGuard(c.Context(), app, "stop")
			defer release()
			if err != nil || !proceed {
				return err
			}
			// Containment: note (never clear) a leftover recovery breadcrumb. Read it before
			// stopping so the hint can name the recovery command; stop does NOT touch the
			// breadcrumb — recovery is a deliberate restore, not a stop. A read error is
			// treated as "present" (fail-closed hint).
			j, present, rerr := varlib.ReadJournal()
			if err := app.compose(c.Context(), "stop"); err != nil {
				return err
			}
			if present || rerr != nil {
				if present && j != nil && j.BackupPath != "" {
					fmt.Fprintf(app.Err, "note: a previous mathion operation was interrupted; the stack is stopped but the deployment is UNVERIFIED. Recover before resuming:\n\n    %s\n", varlib.RecoveryCommand(j.BackupPath))
				} else {
					fmt.Fprintf(app.Err, "note: a previous mathion operation left a recovery breadcrumb at %s; the stack is stopped but the deployment is UNVERIFIED — restore from your most recent backup before resuming.\n", varlib.JournalPath())
				}
			}
			return nil
		},
	}
}
