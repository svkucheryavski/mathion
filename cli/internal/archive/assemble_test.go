package archive_test

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
)

func writeStaging(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// tarMembers re-opens a gzip-tar and returns its member name→content map.
func tarMembers(t *testing.T, path string) map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	out := map[string]string{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(tr)
		if err != nil {
			t.Fatal(err)
		}
		out[hdr.Name] = string(b)
	}
	return out
}

func memberNames(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestAssembleMembersAndNoOverwrite(t *testing.T) {
	staging := t.TempDir()
	dst := t.TempDir()
	dbPath := writeStaging(t, staging, "db.dump", "DBDUMP-CONTENT")
	assetsPath := writeStaging(t, staging, "assets.tar", "ASSETS-CONTENT")

	manifest := archive.Manifest{
		Schema:         1,
		MathionVersion: "v9.9.9",
		SHA256:         map[string]string{"db.dump": "aa", "assets.tar": "bb"},
	}
	members := map[string]string{"db.dump": dbPath, "assets.tar": assetsPath}

	final1, err := archive.Assemble(dst, members, manifest)
	if err != nil {
		t.Fatal(err)
	}
	got := tarMembers(t, final1)
	names := memberNames(got)
	if len(names) != 3 || names[0] != "assets.tar" || names[1] != "db.dump" || names[2] != "manifest.json" {
		t.Fatalf("members = %v, want exactly [assets.tar db.dump manifest.json]", names)
	}
	if got["db.dump"] != "DBDUMP-CONTENT" {
		t.Fatalf("db.dump = %q", got["db.dump"])
	}
	if got["assets.tar"] != "ASSETS-CONTENT" {
		t.Fatalf("assets.tar = %q", got["assets.tar"])
	}
	if !strings.Contains(got["manifest.json"], `"mathion_version"`) {
		t.Fatalf("manifest.json member is not the marshaled manifest: %q", got["manifest.json"])
	}
	// The archive name must match the SelectLatest naming contract.
	if !strings.HasPrefix(filepath.Base(final1), "mathion-backup-") || !strings.HasSuffix(final1, "-v9.9.9.tar.gz") {
		t.Fatalf("unexpected archive name %s", filepath.Base(final1))
	}
	// No leftover temp files. (Same-second no-overwrite is covered deterministically
	// by the white-box TestAssembleCollisionSuffix in assemble_internal_test.go.)
	entries, _ := os.ReadDir(dst)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}
}
