package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// AtomicWrite writes data to path via a uniquely-named temp file in the same
// directory, fsync, then rename. mode is applied to the final file.
func AtomicWrite(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	// Distinctive temp prefix (not a generic ".tmp-*") so `uninstall --purge`'s
	// cleanup can target mathion's own atomic-write leftovers without ever matching
	// a user's ".tmp-…" file in a config dir mistakenly pointed at a populated location.
	f, err := os.CreateTemp(dir, ".mathion-tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp) // no-op after a successful rename
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Chmod(mode); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return fsyncDir(dir)
}

// fsyncDir fsyncs a directory so a rename/unlink of an entry within it is
// durable across a power loss (a file-only fsync does not persist the dirent).
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

// RemoveSync unlinks path and fsyncs its parent directory so the removal is
// durable. A missing file is not an error (idempotent — used to clear the
// recovery breadcrumb, which a re-run may find already gone).
func RemoveSync(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return fsyncDir(filepath.Dir(path))
}

func EnsureConfigDir(cfgdir string) error {
	if err := os.MkdirAll(cfgdir, 0o700); err != nil {
		return err
	}
	fi, err := os.Lstat(cfgdir)
	if err != nil {
		return err
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("config dir %q is a symlink; refusing (security)", cfgdir)
	}
	if !fi.IsDir() {
		return fmt.Errorf("config dir %q is not a directory", cfgdir)
	}
	if fi.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("config dir %q is group/world-writable (%v); refusing", cfgdir, fi.Mode().Perm())
	}
	// Root-ownership is enforced at runtime (install requires root); tests run
	// unprivileged, so ownership is not asserted here.
	return nil
}

type State struct {
	Schema     int    `json:"schema"`
	AdminEmail string `json:"admin_email"`
	Complete   bool   `json:"complete,omitempty"` // meaningful only for Schema >= 2
}

// InstallComplete reports whether install finished (migrate + superuser).
// Schema 1 (written by the pre-marker CLI) is grandfathered complete; Schema 2
// carries the explicit flag. Assumes the receiver already passed ParseState
// (Schema is 1 or 2).
func (s State) InstallComplete() bool { return s.Schema == 1 || s.Complete }

func WriteState(cfgdir string, s State) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return AtomicWrite(filepath.Join(cfgdir, "install-state"), b, 0o600)
}

func ReadState(cfgdir string) (State, error) {
	b, err := os.ReadFile(filepath.Join(cfgdir, "install-state"))
	if err != nil {
		return State{}, err
	}
	return ParseState(b)
}

// ParseState validates raw install-state bytes. Callers that must read the
// marker through a symlink-safe file handle (e.g. os.Root) read the bytes
// themselves and validate them here, so the exact same schema check backs both
// the path-based ReadState and the fd-bound recognition in `uninstall --purge`.
func ParseState(b []byte) (State, error) {
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		return State{}, fmt.Errorf("install-state is not valid JSON: %w", err)
	}
	if (s.Schema != 1 && s.Schema != 2) || s.AdminEmail == "" {
		return State{}, fmt.Errorf("install-state is incomplete or unknown schema (%d)", s.Schema)
	}
	return s, nil
}
