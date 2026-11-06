package cmd

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// errBrandingTooOld is what an image from before `branding-reset` answers:
// argparse exits 2 with "invalid choice" (superuser Branding spec D15).
var errBrandingTooOld = errors.New("This server's Mathion is too old for branding reset: run `mathion update` first.")

func newBrandingCmd(app *App) *cobra.Command {
	branding := &cobra.Command{
		Use:   "branding",
		Short: "Manage the site's branding (the panel's Branding page)",
	}
	var all, yes bool
	reset := &cobra.Command{
		Use:   "reset",
		Short: "Remove the colour changes (--all: also the site name, logo and tab icon)",
		Long: "The way back when a colour theme makes even the superuser panel hard to use. " +
			"Without --all only the colour changes go; the site name, logo and tab icon stay.",
		Args: cobra.NoArgs,
		RunE: func(c *cobra.Command, _ []string) error {
			return app.brandingReset(c.Context(), all, yes)
		},
	}
	reset.Flags().BoolVar(&all, "all", false, "reset the site name, logo, tab icon and colours")
	reset.Flags().BoolVar(&yes, "yes", false, "skip the confirmation prompt (for automation)")
	branding.AddCommand(reset)
	return branding
}

// brandingReset asks first (`compose exec -T` has no terminal, so the prompt
// is here), then runs the app's own command through Stream, which captures its
// error output (D15).
func (a *App) brandingReset(ctx context.Context, all, yes bool) error {
	if !yes {
		what := "This removes the colour changes."
		if all {
			what = "This resets the site name, logo, tab icon and colours."
		}
		fmt.Fprint(a.Out, what+" Continue? [y/N] ")
		line, _ := bufio.NewReader(a.In).ReadString('\n')
		if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
			return errors.New("branding reset cancelled")
		}
	}
	sub := []string{"exec", "-T", "app", "python", "-m", "mathion.superuser", "branding-reset"}
	if all {
		sub = append(sub, "--all")
	}
	err := a.Runner.Stream(ctx, a.Out, a.composeArgs(sub...)...)
	var ee *compose.ExitError
	if !errors.As(err, &ee) {
		return err
	}
	if ee.Code == 2 && bytes.Contains(ee.Stderr, []byte("invalid choice")) {
		return errBrandingTooOld
	}
	// Docker Compose's "not running" arrives here: show it once, as it came.
	_, _ = a.Err.Write(ee.Stderr)
	return fmt.Errorf("branding reset failed (exit code %d)", ee.Code)
}
