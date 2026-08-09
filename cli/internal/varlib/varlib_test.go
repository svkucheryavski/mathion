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
