//go:build linux

package selfupdate

import "testing"

// walkAncestry is exercised for real on a root-owned tree in integration (Task 13);
// here just prove it walks a real tree and returns a usable parent fd + components.
// It asserts STRUCTURE, not ownership, so it runs fine as root (the golang:1.24
// container runs as root) — do NOT skip under root, or the walk is never exercised.
func TestWalkAncestry_Smoke(t *testing.T) {
	comps, fd, err := walkAncestry("/usr/bin/mathion") // real dirs, read-only stats
	if err != nil {
		t.Skipf("environment lacks /usr/bin: %v", err)
	}
	defer func() { _ = closeFD(fd) }()
	if len(comps) == 0 {
		t.Fatal("expected at least the root component")
	}
}
