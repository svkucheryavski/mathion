package config

import (
	"encoding/json"
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

func TestRemoveSyncIdempotent(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "j.json")
	if err := AtomicWrite(p, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RemoveSync(p); err != nil {
		t.Fatalf("first RemoveSync: %v", err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("file still present: %v", err)
	}
	if err := RemoveSync(p); err != nil {
		t.Fatalf("RemoveSync on absent file must be a no-op, got %v", err)
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

func TestInstallCompleteTruthTable(t *testing.T) {
	cases := []struct {
		name string
		s    State
		want bool
	}{
		{"schema1 grandfathered", State{Schema: 1, AdminEmail: "a@b.c"}, true},
		{"schema2 incomplete", State{Schema: 2, AdminEmail: "a@b.c", Complete: false}, false},
		{"schema2 complete", State{Schema: 2, AdminEmail: "a@b.c", Complete: true}, true},
	}
	for _, c := range cases {
		if got := c.s.InstallComplete(); got != c.want {
			t.Errorf("%s: InstallComplete()=%v want %v", c.name, got, c.want)
		}
	}
}

func TestParseStateAcceptsSchema1And2(t *testing.T) {
	for _, raw := range []string{
		`{"schema":1,"admin_email":"a@b.c"}`,
		`{"schema":2,"admin_email":"a@b.c"}`,
		`{"schema":2,"admin_email":"a@b.c","complete":true}`,
	} {
		if _, err := ParseState([]byte(raw)); err != nil {
			t.Errorf("ParseState(%s) unexpected error: %v", raw, err)
		}
	}
	for _, raw := range []string{
		`{"schema":0,"admin_email":"a@b.c"}`,
		`{"schema":3,"admin_email":"a@b.c"}`,
		`{"schema":2,"admin_email":""}`,
	} {
		if _, err := ParseState([]byte(raw)); err == nil {
			t.Errorf("ParseState(%s) expected error, got nil", raw)
		}
	}
}

func TestSchema2IncompleteOmitsCompleteKey(t *testing.T) {
	dir := t.TempDir()
	if err := WriteState(dir, State{Schema: 2, AdminEmail: "a@b.c", Complete: false}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "install-state"))
	if err != nil {
		t.Fatal(err)
	}
	// Assert the exact key is ABSENT (not a raw substring: "complete" would also
	// match e.g. a future "completed_at" field). Unmarshal into a RawMessage map and
	// check the literal key.
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("state file is not valid JSON: %v (raw %s)", err, b)
	}
	if _, ok := m["complete"]; ok {
		t.Fatalf("complete:false must omit the key; got %s", b)
	}
	got, err := ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.InstallComplete() {
		t.Fatal("schema2 without complete key must read back incomplete")
	}
}

func TestSchema2CompleteRoundTrip(t *testing.T) {
	dir := t.TempDir()
	want := State{Schema: 2, AdminEmail: "a@b.c", Complete: true}
	if err := WriteState(dir, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("round-trip = %+v want %+v", got, want)
	}
}
