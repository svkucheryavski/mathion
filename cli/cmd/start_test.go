package cmd

import (
	"bytes"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

func newTestApp(f *compose.FakeRunner) *App {
	return &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f}
}

// rootedVarlib makes the shared lock+guard preamble pass: geteuid→0 (asRoot) plus
// a fresh, writable MATHION_VARLIB_DIR (so there is no stale lock and no leftover
// recovery breadcrumb).
func rootedVarlib(t *testing.T) {
	t.Helper()
	asRoot(t) // backup_test.go — rebinds geteuid to return 0, restored on cleanup
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
}

// seedBreadcrumb writes a kind:"update" recovery breadcrumb into the (already-set)
// MATHION_VARLIB_DIR so a command's entry-check reacts to a leftover crash marker.
func seedBreadcrumb(t *testing.T) {
	t.Helper()
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	if err := varlib.WriteJournal(varlib.Journal{
		Schema: 1, Kind: "update", OldTag: "v0.1.1", TargetTag: "v2.0.0",
		BackupPath: filepath.Join(varlib.BackupsDir(), "mathion-backup-x.tar.gz"),
	}); err != nil {
		t.Fatal(err)
	}
}

func TestStartArgv(t *testing.T) {
	rootedVarlib(t)
	f := &compose.FakeRunner{}
	var out, errb bytes.Buffer
	app := &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f, Out: &out, Err: &errb}
	cmd := newStartCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	// The sweep is call 0; find the `up` and assert its exact argv (now carrying
	// --pull never).
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "up", "-d", "--wait", "--pull", "never"}
	i := idxOfCall(f.Calls, joinHas("up -d --wait --pull never"))
	if i < 0 || !reflect.DeepEqual(f.Calls[i], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
}

// TestStartRefusesOnBreadcrumb: start is in the refuse set, so a leftover recovery
// breadcrumb makes it refuse (non-nil error, no `up`); the breadcrumb is retained
// (start never clears it) and the operation lock is released so a later command can
// still take it.
func TestStartRefusesOnBreadcrumb(t *testing.T) {
	rootedVarlib(t)
	seedBreadcrumb(t)
	f := &compose.FakeRunner{}
	var errb bytes.Buffer
	app := &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f, Err: &errb}
	cmd := newStartCmd(app)
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Fatal("start must refuse on a leftover recovery breadcrumb")
	}
	if hasCall(f.Calls, joinHas("up -d")) {
		t.Fatalf("start must not bring the stack up on a breadcrumb; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("start must retain the breadcrumb (never clears it)")
	}
	// The lock must have been released on the refuse path (else this would ErrLocked).
	rel, lerr := varlib.Lock()
	if lerr != nil {
		t.Fatalf("lock not released: %v", lerr)
	}
	_ = rel()
}
