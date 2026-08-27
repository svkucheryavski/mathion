package varlib

import (
	"os"
	"path/filepath"

	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// MarkerPath returns the on-disk path of the reconcile apply-pending marker. It
// lives directly under Root() (the 0700 root-owned managed dir), alongside the
// lock — NOT under backups/.
func MarkerPath() string {
	return filepath.Join(Root(), "reconcile-pending")
}

// WriteMarker writes the apply-pending marker durably (atomic temp+rename+dir-fsync
// via config.AtomicWrite). It is an EMPTY, presence-only file: its bytes carry no
// schema, and its mere presence is the entire signal (spec §4.1 step 6a). Root()
// must already exist — reconcile takes the lock (which EnsureBackupsDir's Root())
// before calling this.
func WriteMarker() error {
	return config.AtomicWrite(MarkerPath(), []byte{}, 0o600)
}

// MarkerPresent reports whether the apply-pending marker exists. A not-exist result
// is (false, nil); any other stat error (e.g. a non-root caller that cannot traverse
// the 0700 dir) is returned so callers can fail-quiet per their own policy (spec §5).
func MarkerPresent() (bool, error) {
	_, err := os.Stat(MarkerPath())
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// RemoveMarker clears the apply-pending marker (idempotent unlink + parent-dir
// fsync via config.RemoveSync). A missing marker is not an error.
func RemoveMarker() error {
	return config.RemoveSync(MarkerPath())
}
