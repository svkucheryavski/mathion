package varlib_test

import (
	"errors"
	"os"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

func TestEnsureBackupsDir(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MATHION_VARLIB_DIR", root+"/var/lib/mathion")
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(varlib.BackupsDir())
	if !fi.IsDir() || fi.Mode().Perm() != 0o700 {
		t.Fatalf("backups dir mode = %v", fi.Mode())
	}
	if err := varlib.EnsureBackupsDir(); err != nil { // idempotent
		t.Fatalf("second call: %v", err)
	}
	// reject a symlinked managed dir
	os.RemoveAll(varlib.Root())
	os.MkdirAll(root+"/decoy", 0o700)
	os.Symlink(root+"/decoy", varlib.Root())
	if err := varlib.EnsureBackupsDir(); err == nil {
		t.Fatalf("symlinked managed dir must be rejected")
	}
}

func TestLockExclusive(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MATHION_VARLIB_DIR", root)
	varlib.EnsureBackupsDir()
	rel, err := varlib.Lock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := varlib.Lock(); !errors.Is(err, varlib.ErrLocked) {
		t.Fatalf("second Lock should be ErrLocked, got %v", err)
	}
	if err := rel(); err != nil {
		t.Fatal(err)
	}
	rel2, err := varlib.Lock() // released -> reacquirable
	if err != nil {
		t.Fatalf("reacquire after release: %v", err)
	}
	rel2()
}

func TestLockReleaseIdempotent(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MATHION_VARLIB_DIR", root)
	varlib.EnsureBackupsDir()
	rel, err := varlib.Lock()
	if err != nil {
		t.Fatal(err)
	}
	if err := rel(); err != nil {
		t.Fatal(err)
	}
	// Fresh lock — its fd typically reuses the integer just closed.
	rel2, err := varlib.Lock()
	if err != nil {
		t.Fatalf("reacquire: %v", err)
	}
	defer rel2()
	// Stale second call of the FIRST release must be a safe no-op and must NOT
	// unlock/close rel2's (possibly fd-reused) descriptor.
	if err := rel(); err != nil {
		t.Fatalf("second release should be a safe no-op, got %v", err)
	}
	// rel2's lock must still be held.
	if _, err := varlib.Lock(); !errors.Is(err, varlib.ErrLocked) {
		t.Fatalf("stale double-release dropped the live lock; got %v", err)
	}
}

func TestStagingDirUnique(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MATHION_VARLIB_DIR", root)
	varlib.EnsureBackupsDir()
	a, _ := varlib.StagingDir()
	b, _ := varlib.StagingDir()
	if a == b {
		t.Fatalf("staging dirs must be unique: %s", a)
	}
}
