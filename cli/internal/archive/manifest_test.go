package archive_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
)

func TestSHA256OfMatchesCrypto(t *testing.T) {
	data := []byte("mathion-backup-payload-\x00\x01\x02\xff")
	sum := sha256.Sum256(data)
	want := hex.EncodeToString(sum[:])
	got, err := archive.SHA256Of(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("SHA256Of = %s, want %s", got, want)
	}
	// Empty input hashes to the well-known empty-sha256 (streamed, not buffered).
	got, err = archive.SHA256Of(strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	if got != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" {
		t.Fatalf("SHA256Of(empty) = %s", got)
	}
}

func TestManifestJSONTags(t *testing.T) {
	m := archive.Manifest{
		Schema:          1,
		CreatedAt:       "2026-08-09T00:00:00Z",
		MathionVersion:  "v9.9.9",
		ImageID:         "sha256:deadbeef",
		AlembicRevision: "67e8294b4267",
		CLIVersion:      "dev",
		DBName:          "mathion",
		SHA256:          map[string]string{"db.dump": "aa", "assets.tar": "bb"},
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, key := range []string{
		`"schema"`, `"created_at"`, `"mathion_version"`, `"image_id"`,
		`"alembic_revision"`, `"cli_version"`, `"db_name"`, `"sha256"`,
	} {
		if !strings.Contains(s, key) {
			t.Errorf("manifest JSON missing key %s; got %s", key, s)
		}
	}
	// Round-trip: the exact tags must decode back into the struct.
	var back archive.Manifest
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back.AlembicRevision != "67e8294b4267" || back.SHA256["db.dump"] != "aa" {
		t.Fatalf("round-trip lost fields: %+v", back)
	}
}
