package varlib

import (
	"os"
	"path/filepath"
	"testing"
)

// markerReady sets a fresh 0700 MATHION_VARLIB_DIR and creates the managed tree,
// mirroring journal_test.go's setup.
func markerReady(t *testing.T) {
	t.Helper()
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	if err := EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
}

func TestMarkerRoundTrip(t *testing.T) {
	markerReady(t)
	if present, err := MarkerPresent(); err != nil || present {
		t.Fatalf("marker should be absent initially (present=%v err=%v)", present, err)
	}
	if err := WriteMarker(); err != nil {
		t.Fatalf("WriteMarker: %v", err)
	}
	if present, err := MarkerPresent(); err != nil || !present {
		t.Fatalf("marker should be present after write (present=%v err=%v)", present, err)
	}
	if _, err := os.Stat(MarkerPath()); err != nil {
		t.Fatalf("marker file must exist at %s: %v", MarkerPath(), err)
	}
	if err := RemoveMarker(); err != nil {
		t.Fatalf("RemoveMarker: %v", err)
	}
	if present, err := MarkerPresent(); err != nil || present {
		t.Fatalf("marker should be absent after remove (present=%v err=%v)", present, err)
	}
}

func TestRemoveMarkerIdempotent(t *testing.T) {
	markerReady(t)
	if err := RemoveMarker(); err != nil {
		t.Fatalf("removing an absent marker must be a no-op, got %v", err)
	}
}

func TestMarkerIsPresenceOnly(t *testing.T) {
	markerReady(t)
	if err := WriteMarker(); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(MarkerPath())
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 0 {
		t.Fatalf("marker must be empty (presence-only); got %d bytes", len(b))
	}
}
