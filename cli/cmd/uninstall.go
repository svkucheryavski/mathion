package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// errCfgUnrecognized is returned by removeCfgArtifacts when the opened config
// dir carries no valid install-state marker. It is not a failure: the caller
// leaves the dir in place with a note (teardown has already succeeded and purge
// must stay re-runnable). It also fail-safely closes a leaf-swap race — see
// removeCfgArtifacts.
var errCfgUnrecognized = errors.New("config dir has no valid mathion install-state marker")

func newUninstallCmd(app *App) *cobra.Command {
	var purge bool
	c := &cobra.Command{
		Use:   "uninstall",
		Short: "Stop and remove containers (keeps data + config unless --purge)",
		RunE: func(c *cobra.Command, _ []string) error {
			release, proceed, err := lockAndGuard(c.Context(), app, "uninstall")
			defer release()
			if err != nil || !proceed {
				return err
			}
			if !purge {
				return app.compose(c.Context(), "down")
			}
			// --purge: identity-bound typed confirmation, then identity teardown,
			// then remove <cfgdir> only after teardown succeeds.
			pgdata := app.Project + "_mathion_pgdata"
			assets := app.Project + "_mathion_assets"
			acme := app.Project + "_mathion_acme"
			fmt.Fprintf(app.Out, "This PERMANENTLY deletes project %q, volumes %s, %s and %s (bundled-TLS certs; re-issuable), and config dir %s (backups in %s are kept).\nType the project name (%s) to confirm: ", app.Project, pgdata, assets, acme, app.CfgDir, varlib.BackupsDir(), app.Project)
			line, _ := bufio.NewReader(app.In).ReadString('\n')
			if strings.TrimSpace(line) != app.Project {
				return fmt.Errorf("confirmation did not match %q; aborting", app.Project)
			}
			// Identity teardown FIRST — the typed confirmation above is what gates it.
			// It removes the resolved project's docker resources BY NAME and needs no
			// config, so it must run even in the orphan (.env/config gone, volumes
			// surviving) state and stay safely re-runnable to finish a partial purge —
			// exactly the recovery hatch the install volume-guard points to. Gating it
			// on cfgdir recognition would defeat that (a lost /etc/mathion would strand
			// the docker resources).
			if err := dockerx.Purge(c.Context(), app.Runner, app.Project); err != nil {
				return err // teardown failed -> cfgdir retained (survives non-absence failure)
			}
			// Purge succeeded — the deployment is gone, so clear any recovery breadcrumb now
			// (uninstall is exempt from the entry-check, so it ran WITH one; only post-teardown
			// is removing it safe). A leftover would otherwise make a fresh install refuse. A
			// failed remove is a non-fatal note (purge stays re-runnable).
			if err := varlib.RemoveJournal(); err != nil {
				fmt.Fprintf(app.Err, "note: could not remove the recovery breadcrumb at %s (%v)\n", varlib.JournalPath(), err)
			}
			// Remove <cfgdir> ONLY if it is a directory mathion recognizes — that is
			// what keeps a mis-set MATHION_CONFIG_DIR ("/", "$HOME", a symlink) from
			// being blown away by RemoveAll. recognizedCfgDir returns the CLEANED path
			// (so a trailing slash can't make Lstat dereference a final symlink). An
			// unrecognized-or-already-gone cfgdir is NOT a failure here: teardown has
			// already succeeded and purge must stay re-runnable, so leave it in place
			// with a note rather than aborting.
			if cleanDir, err := recognizedCfgDir(app.CfgDir); err != nil {
				fmt.Fprintf(app.Err, "note: config dir left in place (%v)\n", err)
			} else if err := removeCfgArtifacts(cleanDir); errors.Is(err, errCfgUnrecognized) {
				// A leaf-swap race redirected the open to a dir with no valid
				// marker: delete nothing, leave it in place (fail-safe).
				fmt.Fprintf(app.Err, "note: config dir left in place (%v)\n", err)
			} else if err != nil {
				return err
			} else if err := rmdirCfgDir(cleanDir); err != nil && !os.IsNotExist(err) {
				// cfgdir is not empty: the operator pointed MATHION_CONFIG_DIR at a
				// populated/sensitive directory ($HOME, /etc, ...). We removed the
				// files mathion wrote and leave everything else intact — os.RemoveAll
				// would have recursively wiped the whole directory.
				fmt.Fprintf(app.Err, "note: removed mathion's config files but left %s in place (%v)\n", cleanDir, err)
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

// removeCfgArtifacts deletes ONLY the files mathion writes into a config dir —
// never recursively: the compose file, install-state, .env, and any leftover
// atomic-write temp files. The caller then rmdir's the directory only if it is
// now empty. So even though `install` will plant an install-state marker wherever
// MATHION_CONFIG_DIR points (making recognizedCfgDir accept e.g. a home dir or
// /etc), a --purge of such a location removes only mathion's own files and leaves
// everything else — where os.RemoveAll would have wiped the entire directory.
//
// It returns errCfgUnrecognized (a non-fatal signal to leave the dir in place)
// when the OPENED handle carries no valid install-state marker.
func removeCfgArtifacts(cfgdir string) error {
	// Open cfgdir THROUGH its parent as an os.Root so every removal below is
	// symlink-safe and fd-relative. recognizedCfgDir already Lstat'd cfgdir as a
	// real dir, but that is a path-based check: between it and these deletes, a
	// user who controls the parent could swap cfgdir for a symlink and redirect
	// path-based os.Remove calls (os.RemoveAll used fd-relative unlinkat and did
	// not have this exposure). Resolving cfgdir under its parent Root rejects a
	// swap to an ESCAPING symlink with "path escapes from parent".
	parent, err := os.OpenRoot(filepath.Dir(cfgdir))
	if err != nil {
		return err
	}
	defer parent.Close()
	root, err := parent.OpenRoot(filepath.Base(cfgdir))
	if err != nil {
		return err
	}
	defer root.Close()
	// A swap to a RELATIVE in-parent symlink (e.g. cfgdir -> a sibling victim)
	// stays inside the parent root, so parent.OpenRoot FOLLOWS it rather than
	// rejecting it. Close that leaf race by re-validating the install-state marker
	// through the SAME opened handle we are about to delete from: if the open was
	// redirected to any directory without a valid mathion marker (a user's $HOME,
	// /etc, ...), we remove nothing. A swap can therefore only ever land on another
	// directory that already IS a mathion config dir — not a meaningful target.
	if err := readMarker(root); err != nil {
		return err
	}
	// .env first: it holds the secrets, so it goes even if a later step fails.
	for _, name := range []string{".env", "docker-compose.yml", "install-state"} {
		if err := root.Remove(name); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	d, err := root.Open(".")
	if err != nil {
		return err
	}
	entries, err := d.ReadDir(-1)
	d.Close()
	if err != nil {
		return err
	}
	for _, e := range entries {
		// Only mathion's own atomic-write leftovers: a distinctive prefix (so a
		// user's ".tmp-…" file is never matched) AND a regular file (so a hand-made
		// directory of that name is never touched — it would also block the rmdir).
		if e.Type().IsRegular() && strings.HasPrefix(e.Name(), ".mathion-tmp-") {
			if err := root.Remove(e.Name()); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}

// readMarker validates the install-state marker through an already-opened,
// symlink-safe os.Root handle (as opposed to path-based config.ReadState),
// binding the recognition check to the exact inode removeCfgArtifacts deletes
// from. A missing or invalid marker yields errCfgUnrecognized; a genuine I/O
// error is returned as-is (the caller fails closed and retains the dir).
func readMarker(root *os.Root) error {
	f, err := root.Open("install-state")
	if err != nil {
		if os.IsNotExist(err) {
			return errCfgUnrecognized
		}
		return err
	}
	b, err := io.ReadAll(f)
	f.Close()
	if err != nil {
		return err
	}
	if _, err := config.ParseState(b); err != nil {
		return fmt.Errorf("%w (%v)", errCfgUnrecognized, err)
	}
	return nil
}

// rmdirCfgDir removes the (now-empty) config dir via its parent Root. Going
// through the parent means an ESCAPING symlink swapped in for cfgdir is rejected
// ("path escapes from parent"); a swap to a relative in-parent symlink unlinks
// the symlink itself (parent.Remove does not follow the final component) rather
// than the directory it points at. A non-empty dir yields a normal error the
// caller surfaces as a note.
func rmdirCfgDir(cfgdir string) error {
	parent, err := os.OpenRoot(filepath.Dir(cfgdir))
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Remove(filepath.Base(cfgdir))
}
