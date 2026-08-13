package archive_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
)

func TestSelectLatest(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, mtime time.Time) {
		p := filepath.Join(dir, name)
		os.WriteFile(p, []byte("x"), 0o600)
		os.Chtimes(p, mtime, mtime)
	}
	base := time.Date(2026, 8, 6, 14, 15, 30, 0, time.UTC)
	write("mathion-backup-20260806T141500Z-v0.1.1.tar.gz", base.Add(-time.Minute))
	// same-second cluster: the -2 collision suffix sorts lexicographically FIRST
	// but is the NEWER file — mtime tie-break must pick it.
	write("mathion-backup-20260806T141530Z-v0.1.1.tar.gz", base)
	write("mathion-backup-20260806T141530Z-v0.1.1-2.tar.gz", base.Add(time.Second))
	write("notes.txt", base) // ignored (no prefix)
	got, err := archive.SelectLatest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(got) != "mathion-backup-20260806T141530Z-v0.1.1-2.tar.gz" {
		t.Fatalf("got %s", filepath.Base(got))
	}
	if _, err := archive.SelectLatest(t.TempDir()); err == nil {
		t.Fatalf("empty dir must error")
	}
}
