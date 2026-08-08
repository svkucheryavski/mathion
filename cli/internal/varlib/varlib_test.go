package varlib_test

import (
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
