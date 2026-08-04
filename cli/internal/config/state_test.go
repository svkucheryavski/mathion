package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteModeAndContent(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	if err := AtomicWrite(p, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "hello" {
		t.Fatalf("content = %q", b)
	}
	fi, _ := os.Stat(p)
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", fi.Mode().Perm())
	}
	// no stale temp files left behind
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("expected only the target file, got %d entries", len(entries))
	}
}

func TestStateRoundTrip(t *testing.T) {
	dir := t.TempDir()
	if err := WriteState(dir, State{Schema: 1, AdminEmail: "you@example.edu"}); err != nil {
		t.Fatal(err)
	}
	got, err := ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.AdminEmail != "you@example.edu" || got.Schema != 1 {
		t.Fatalf("round-trip = %+v", got)
	}
	fi, _ := os.Stat(filepath.Join(dir, "install-state"))
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("state mode = %v, want 0600", fi.Mode().Perm())
	}
}

func TestReadStateMissingOrInvalid(t *testing.T) {
	dir := t.TempDir()
	if _, err := ReadState(dir); err == nil {
		t.Error("ReadState on missing file should error")
	}
	os.WriteFile(filepath.Join(dir, "install-state"), []byte("{ not json"), 0o600)
	if _, err := ReadState(dir); err == nil {
		t.Error("ReadState on invalid JSON should error")
	}
	os.WriteFile(filepath.Join(dir, "install-state"), []byte(`{"schema":1,"admin_email":""}`), 0o600)
	if _, err := ReadState(dir); err == nil {
		t.Error("ReadState with empty admin_email should error")
	}
}

func TestEnsureConfigDirRejectsSymlink(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "real")
	os.MkdirAll(real, 0o700)
	link := filepath.Join(base, "link")
	os.Symlink(real, link)
	if err := EnsureConfigDir(link); err == nil {
		t.Error("EnsureConfigDir should reject a symlinked config dir")
	}
}
