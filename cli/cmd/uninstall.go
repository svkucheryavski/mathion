package cmd

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
)

func newUninstallCmd(app *App) *cobra.Command {
	var purge bool
	c := &cobra.Command{
		Use:   "uninstall",
		Short: "Stop and remove containers (keeps data + config unless --purge)",
		RunE: func(c *cobra.Command, _ []string) error {
			if !purge {
				return app.compose(c.Context(), "down")
			}
			// --purge: identity-bound typed confirmation, then identity teardown,
			// then remove <cfgdir> only after teardown succeeds.
			pgdata := app.Project + "_mathion_pgdata"
			assets := app.Project + "_mathion_assets"
			fmt.Fprintf(app.Out, "This PERMANENTLY deletes project %q, volumes %s and %s, and config dir %s.\nType the project name (%s) to confirm: ", app.Project, pgdata, assets, app.CfgDir, app.Project)
			line, _ := bufio.NewReader(app.In).ReadString('\n')
			if strings.TrimSpace(line) != app.Project {
				return fmt.Errorf("confirmation did not match %q; aborting", app.Project)
			}
			// Bind the config-dir removal to a directory mathion recognizes BEFORE
			// any teardown, so a mis-set MATHION_CONFIG_DIR (e.g. "/", "$HOME") fails
			// closed with nothing destroyed rather than being blown away by RemoveAll.
			// The guard returns the CLEANED path — use it for RemoveAll so a trailing
			// slash can't make Lstat dereference a final symlink the guard then skips.
			cleanDir, err := recognizedCfgDir(app.CfgDir)
			if err != nil {
				return err
			}
			if err := dockerx.Purge(c.Context(), app.Runner, app.Project); err != nil {
				return err // teardown failed -> cfgdir retained
			}
			if err := os.RemoveAll(cleanDir); err != nil {
				return err
			}
			fmt.Fprintln(app.Out, "purged.")
			return nil
		},
	}
	c.Flags().BoolVar(&purge, "purge", false, "also remove volumes and config (destructive)")
	return c
}

// recognizedCfgDir verifies cfgdir is a real, absolute, non-symlink directory
// that mathion created — proven by a readable, valid install-state marker inside
// it — and returns the CLEANED path for the caller to remove. This binds the
// caller's os.RemoveAll to a directory we own, so a mis-set MATHION_CONFIG_DIR
// ("/", "$HOME", a symlink, a path with no marker) can never be recursively
// deleted by `uninstall --purge`. The path is cleaned ONCE up front and every
// check runs against that clean path: a trailing slash or `/.` would otherwise
// make Lstat dereference a final symlink, letting the symlink guard skip it.
func recognizedCfgDir(cfgdir string) (string, error) {
	if !filepath.IsAbs(cfgdir) {
		return "", fmt.Errorf("config dir %q is not an absolute path; refusing to purge it", cfgdir)
	}
	clean := filepath.Clean(cfgdir)
	if clean == "/" {
		return "", fmt.Errorf("config dir %q resolves to the filesystem root; refusing to purge it", cfgdir)
	}
	fi, err := os.Lstat(clean)
	if err != nil {
		return "", fmt.Errorf("cannot access config dir %q: %w", clean, err)
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("config dir %q is a symlink; refusing to purge it", clean)
	}
	if !fi.IsDir() {
		return "", fmt.Errorf("config dir %q is not a directory; refusing to purge it", clean)
	}
	if _, err := config.ReadState(clean); err != nil {
		return "", fmt.Errorf("config dir %q has no valid mathion install-state marker (%w); refusing to purge it — remove it by hand if that is really what you want", clean, err)
	}
	return clean, nil
}
