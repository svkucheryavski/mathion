package secrets

import (
	"encoding/base64"
	"encoding/hex"
	"regexp"
	"testing"
)

func TestSecretKeyIs48Base64Bytes(t *testing.T) {
	s, err := SecretKey()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("not valid base64: %v", err)
	}
	if len(raw) != 48 {
		t.Fatalf("decoded len = %d, want 48", len(raw))
	}
}

func TestPGPasswordIsHex24(t *testing.T) {
	p, err := PGPassword()
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{48}$`).MatchString(p) {
		t.Fatalf("pg password %q not 48 hex chars", p)
	}
	raw, _ := hex.DecodeString(p)
	if len(raw) != 24 {
		t.Fatalf("decoded len = %d, want 24", len(raw))
	}
}

func TestSecretsDiffer(t *testing.T) {
	a, _ := SecretKey()
	b, _ := SecretKey()
	if a == b {
		t.Fatal("two SecretKey() calls returned identical values")
	}
}
