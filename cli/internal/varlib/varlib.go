// Package varlib owns Mathion's root-owned managed state directory
// (default /var/lib/mathion), where backup dumps and asset tarballs are staged.
// It creates the tree with hardened permissions (0700, root-owned at runtime)
// and refuses a symlinked or group/world-accessible managed dir so an attacker
// cannot redirect where dumps land or make them readable by other users.
package varlib

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// defaultRoot is the on-host managed state dir. Tests override it via the
// MATHION_VARLIB_DIR env var, mirroring config's MATHION_CONFIG_DIR.
const defaultRoot = "/var/lib/mathion"

// Root returns the managed state directory: MATHION_VARLIB_DIR if set, else
// the default /var/lib/mathion.
func Root() string {
	if v := os.Getenv("MATHION_VARLIB_DIR"); v != "" {
		return v
	}
	return defaultRoot
}

// BackupsDir returns the directory that holds backup dumps and asset tarballs.
func BackupsDir() string {
	return filepath.Join(Root(), "backups")
}

// LockPath returns the path of the cross-process lock file guarding
// backup/restore/update operations.
func LockPath() string {
	return filepath.Join(Root(), ".lock")
}

// EnsureBackupsDir creates the managed state tree (Root then backups/) with
// mode 0700, fsyncing the parent of each newly-created level so the creation is
// durable. It validates each level BEFORE descending: a symlinked, non-directory,
// or group/world-accessible level is rejected. Guarding Root() first is
// security-load-bearing — creating backups/ under an unvalidated (possibly
// symlinked) Root would write through the symlink into an attacker's target.
func EnsureBackupsDir() error {
	root := Root()
	created, err := ensureLevel(root)
	if err != nil {
		return err
	}
	if created {
		if err := fsyncDir(filepath.Dir(root)); err != nil {
			return err
		}
	}

	backups := BackupsDir()
	created, err = ensureLevel(backups)
	if err != nil {
		return err
	}
	if created {
		if err := fsyncDir(root); err != nil {
			return err
		}
	}
	return nil
}

// ensureLevel creates dir (mode 0700) and validates it, returning whether this
// call newly created it (so the caller can fsync the parent only when needed —
// an idempotent second call creates nothing and does no redundant fsync).
func ensureLevel(dir string) (created bool, err error) {
	// Stat-before to detect whether MkdirAll creates this level.
	_, statErr := os.Stat(dir)
	preexisting := statErr == nil

	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, err
	}
	// Lstat (not Stat) so a symlink at dir is seen as a symlink, not followed.
	fi, err := os.Lstat(dir)
	if err != nil {
		return false, err
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		return false, fmt.Errorf("managed dir %q is a symlink; refusing (security)", dir)
	}
	if !fi.IsDir() {
		return false, fmt.Errorf("managed dir %q is not a directory", dir)
	}
	// Stricter than config's 0o022: reject ANY group/other bit — a managed
	// state dir must be 0700-exact.
	if fi.Mode().Perm()&0o077 != 0 {
		return false, fmt.Errorf("managed dir %q is group/world-accessible (%v); refusing", dir, fi.Mode().Perm())
	}
	// Root-ownership is enforced at runtime (operations require root); tests run
	// unprivileged, so ownership is not asserted here.
	return !preexisting, nil
}

// StagingDir creates a unique per-call staging directory under Root (mode 0700)
// with a name that carries the caller's PID. Its random suffix makes two calls
// in one process distinct.
func StagingDir() (string, error) {
	return os.MkdirTemp(Root(), fmt.Sprintf("staging-%d-*", os.Getpid()))
}

// SweepStaleStaging removes leftover staging-* directories under Root. It is
// called strictly after the operation lock is held (wired in a later task), so
// no live staging dir belongs to another run. A missing/empty Root is not an
// error.
func SweepStaleStaging() error {
	root := Root()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "staging-") {
			if err := os.RemoveAll(filepath.Join(root, e.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// fsyncDir fsyncs a directory so a create/rename/unlink of an entry within it is
// durable across a power loss (a file-only fsync does not persist the dirent).
// Mirrors config.fsyncDir (unexported there); kept local to keep this task
// purely additive.
func fsyncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	syncErr := d.Sync()
	closeErr := d.Close()
	if syncErr != nil {
		return errors.Join(syncErr, closeErr) // errors.Join drops nils
	}
	return closeErr
}
