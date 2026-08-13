package archive

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
)

// Manifest is the metadata record stored as manifest.json inside every mathion
// backup archive. restore reads these fields, so the snake_case JSON tags are a
// stable cross-version contract and must not be renamed.
type Manifest struct {
	Schema          int    `json:"schema"`
	CreatedAt       string `json:"created_at"`
	MathionVersion  string `json:"mathion_version"`
	ImageID         string `json:"image_id"`
	AlembicRevision string `json:"alembic_revision"`
	CLIVersion      string `json:"cli_version"`
	DBName          string `json:"db_name"`
	// SHA256 maps each PAYLOAD member name ("db.dump","assets.tar") to its
	// lowercase-hex sha256. manifest.json is never listed here — it carries these
	// hashes and so cannot hash itself.
	SHA256 map[string]string `json:"sha256"`
}

// SHA256Of streams r through crypto/sha256 and returns the lowercase-hex digest.
// It reads incrementally so a multi-gigabyte dump is never buffered in memory.
func SHA256Of(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
