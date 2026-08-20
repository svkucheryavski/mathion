package selfupdate

import (
	"strings"
	"testing"
)

func TestAncestrySafe(t *testing.T) {
	ok := []component{{"/", 0, 0o755}, {"/usr", 0, 0o755}, {"/usr/local/bin", 0, 0o755}}
	if err := ancestrySafe(ok); err != nil {
		t.Fatalf("all root:0755 must pass: %v", err)
	}
	nonRoot := []component{{"/", 0, 0o755}, {"/usr/local/bin", 1000, 0o755}}
	if err := ancestrySafe(nonRoot); err == nil || !strings.Contains(err.Error(), "/usr/local/bin") {
		t.Fatalf("non-root component must be named: %v", err)
	}
	groupW := []component{{"/", 0, 0o755}, {"/usr/local/bin", 0, 0o775}}
	err := ancestrySafe(groupW)
	if err == nil || !strings.Contains(err.Error(), "/usr/local/bin") {
		t.Fatalf("group-writable component must be named: %v", err)
	}
	// §6.3 MINOR-1: the refusal carries the both-components remediation, since a
	// staff-group host makes /usr/local group-writable too and fixing only the leaf
	// leaves the parent refused.
	if !strings.Contains(err.Error(), "chmod 0755 /usr/local /usr/local/bin") {
		t.Fatalf("refusal must give the both-components remediation: %v", err)
	}
	worldW := []component{{"/usr/local/bin", 0, 0o757}}
	if err := ancestrySafe(worldW); err == nil {
		t.Fatal("world-writable component must be refused")
	}
}

func TestGuardTarget(t *testing.T) {
	if err := guardTarget("/usr/local/bin/mathion", "/usr/local/bin/mathion"); err != nil {
		t.Fatalf("matching target must pass: %v", err)
	}
	if err := guardTarget("/home/x/mathion", "/usr/local/bin/mathion"); err == nil {
		t.Fatal("a relocated binary must be refused")
	}
}
