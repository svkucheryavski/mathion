package cmd

import (
	"bytes"
	"io"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

func TestGuardEntryRouting(t *testing.T) {
	root := filepath.Join(t.TempDir(), "vl") // EnsureBackupsDir MkdirAll's this fresh at 0700; a bare t.TempDir() is 0755 under umask 022 and would be refused
	t.Setenv("MATHION_VARLIB_DIR", root)
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	if err := varlib.WriteJournal(varlib.Journal{Schema: 1, Kind: "update", OldTag: "v0.1.0",
		TargetTag: "v0.2.0", TargetImageID: "sha256:aa", BackupPath: "/b/x.tar.gz"}); err != nil {
		t.Fatal(err)
	}
	cases := map[string]bool{ // command -> expected proceed
		"restore": true, "uninstall": true, "stop": true,
		"update": false, "start": false, "install": false, "backup": false,
	}
	for cmd, wantProceed := range cases {
		var out bytes.Buffer
		app := &App{Out: &out, Err: &out}
		proceed, err := guardEntry(app, cmd)
		if proceed != wantProceed {
			t.Errorf("%s: proceed=%v want %v", cmd, proceed, wantProceed)
		}
		if !wantProceed {
			if err == nil {
				t.Errorf("%s: expected refuse error", cmd)
			}
			if !strings.Contains(out.String(), "mathion restore -- '/b/x.tar.gz'") {
				t.Errorf("%s: refuse must print recovery cmd, got %q", cmd, out.String())
			}
			if !strings.Contains(out.String(), "image ID equals the recorded target") {
				t.Errorf("%s: refuse must print identity-verified escape", cmd)
			}
		}
	}
}

func TestGuardEntryNoBreadcrumbProceeds(t *testing.T) {
	root := filepath.Join(t.TempDir(), "vl") // EnsureBackupsDir MkdirAll's this fresh at 0700; a bare t.TempDir() is 0755 under umask 022 and would be refused
	t.Setenv("MATHION_VARLIB_DIR", root)
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	for _, cmd := range []string{"update", "start", "install", "backup", "restore", "stop", "uninstall"} {
		app := &App{Out: io.Discard, Err: io.Discard}
		if proceed, err := guardEntry(app, cmd); !proceed || err != nil {
			t.Errorf("%s with no breadcrumb: proceed=%v err=%v", cmd, proceed, err)
		}
	}
}

func TestRequireRoot(t *testing.T) {
	orig := geteuid
	defer func() { geteuid = orig }()

	geteuid = func() int { return 0 }
	if err := requireRoot(); err != nil {
		t.Errorf("euid 0: got error %v, want nil", err)
	}

	geteuid = func() int { return 1000 }
	if err := requireRoot(); err == nil {
		t.Error("non-zero euid: expected error, got nil")
	} else if err.Error() != "requires root; re-run with sudo" {
		t.Errorf("non-zero euid: error = %q, want %q", err.Error(), "requires root; re-run with sudo")
	}
}
