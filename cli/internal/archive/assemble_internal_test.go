package archive

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestAssembleCollisionSuffix pins the clock seam so two Assemble calls
// deterministically land in the SAME UTC second: the second must NOT overwrite
// the first — it takes a -2 collision suffix, and the first archive survives.
// White-box (package archive) so it can rebind the unexported `now` seam.
func TestAssembleCollisionSuffix(t *testing.T) {
	fixed := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	orig := now
	now = func() time.Time { return fixed }
	defer func() { now = orig }()

	staging := t.TempDir()
	dst := t.TempDir()
	dbPath := filepath.Join(staging, "db.dump")
	assetsPath := filepath.Join(staging, "assets.tar")
	if err := os.WriteFile(dbPath, []byte("DB"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetsPath, []byte("AS"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{Schema: 1, MathionVersion: "v9.9.9"}
	members := map[string]string{"db.dump": dbPath, "assets.tar": assetsPath}

	final1, err := Assemble(dst, members, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(filepath.Base(final1), "-v9.9.9.tar.gz") || strings.Contains(filepath.Base(final1), "-2.") {
		t.Fatalf("first archive must be the unsuffixed name, got %s", filepath.Base(final1))
	}

	final2, err := Assemble(dst, members, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if final2 == final1 {
		t.Fatalf("second Assemble reused the first path %s", final2)
	}
	if !strings.HasSuffix(filepath.Base(final2), "-v9.9.9-2.tar.gz") {
		t.Fatalf("same-second collision must yield a -2 suffix, got %s", filepath.Base(final2))
	}
	if _, err := os.Stat(final1); err != nil {
		t.Fatalf("first archive must survive the second Assemble: %v", err)
	}
}
