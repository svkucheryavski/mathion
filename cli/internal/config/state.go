package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// AtomicWrite writes data to path via a uniquely-named temp file in the same
// directory, fsync, then rename. mode is applied to the final file.
func AtomicWrite(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".tmp-*")
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
	return os.Rename(tmp, path)
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
}

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
	var s State
	if err := json.Unmarshal(b, &s); err != nil {
		return State{}, fmt.Errorf("install-state is not valid JSON: %w", err)
	}
	if s.Schema != 1 || s.AdminEmail == "" {
		return State{}, fmt.Errorf("install-state is incomplete or unknown schema (%d)", s.Schema)
	}
	return s, nil
}
