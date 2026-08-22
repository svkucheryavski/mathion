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
	nrErr := ancestrySafe(nonRoot)
	if nrErr == nil || !strings.Contains(nrErr.Error(), "chown root:root /usr/local/bin && chmod 0755 /usr/local/bin") {
		t.Fatalf("non-root OWNER must get the chown (not chgrp) remediation: %v", nrErr)
	}
	groupW := []component{{"/", 0, 0o755}, {"/usr/local/bin", 0, 0o775}}
	err := ancestrySafe(groupW)
	if err == nil || !strings.Contains(err.Error(), "/usr/local/bin") {
		t.Fatalf("group-writable component must be named: %v", err)
	}
	// §6.3 MINOR-1: the refusal carries the both-components chgrp remediation (staff-group
	// host makes /usr/local group-writable too; fixing only the leaf leaves the parent refused).
	if !strings.Contains(err.Error(), "chgrp root /usr/local /usr/local/bin && chmod 0755 /usr/local /usr/local/bin") {
		t.Fatalf("group-writable must get the chgrp (not chown) both-components remediation: %v", err)
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
