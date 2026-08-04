package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// seedInstall writes the install-state marker (+ a .env) that the --purge guard
// requires before it will os.RemoveAll a config dir.
func seedInstall(t *testing.T, dir string) {
	t.Helper()
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestUninstallPlainIsComposeDown(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newUninstallCmd(newTestApp(f))
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "down"}
	if len(f.Calls) != 1 {
		t.Fatalf("plain uninstall must issue exactly one command, got %d: %v", len(f.Calls), f.Calls)
	}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}

func TestPurgeRequiresTypedProjectName(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600)
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr, In: strings.NewReader("wrong\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("purge must abort when the typed confirmation does not match the project name")
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e != nil {
		t.Fatal("cfgdir removed despite failed confirmation")
	}
	// A mismatched confirmation must abort before any teardown work runs.
	if len(f.Calls) != 0 {
		t.Fatalf("a mismatched confirmation must run no docker commands, got %v", f.Calls)
	}
}

func TestPurgeSuccessRemovesCfgDir(t *testing.T) {
	dir := t.TempDir()
	seedInstall(t, dir) // install-state marker + .env
	// Default fake: ps -> "", every `ls` -> "" (absent) => Purge succeeds cleanly.
	f := &compose.FakeRunner{}
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: &out, Err: os.Stderr, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if _, e := os.Stat(dir); !os.IsNotExist(e) {
		t.Fatalf("cfgdir must be removed after a successful purge, stat err = %v", e)
	}
	if !strings.Contains(out.String(), "purged.") {
		t.Fatalf("expected confirmation output after purge, got %q", out.String())
	}
}

func TestPurgeRetainsCfgDirOnTeardownFailure(t *testing.T) {
	dir := t.TempDir()
	seedInstall(t, dir) // marker present, so the guard passes and we reach teardown
	// ps succeeds, but the existence check errors (daemon-down-like) => fail closed.
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if len(args) > 0 && args[0] == "ps" {
			return "", nil
		}
		return "", &noSuch{}
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("purge must fail when teardown fails")
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e != nil {
		t.Fatal("cfgdir removed despite teardown failure")
	}
}

func TestPurgeTearsDownButKeepsUnrecognizedCfgDir(t *testing.T) {
	dir := t.TempDir()
	// .env present but NO install-state marker → not a dir mathion owns. The
	// identity teardown must STILL run (it needs no config), but os.RemoveAll must
	// not touch this dir — it is left in place with a note, and the command succeeds.
	os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600)
	f := &compose.FakeRunner{} // default: ps/ls -> "" => teardown succeeds (absent = no-op)
	var errBuf bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errBuf, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("purge must complete (teardown runs) even when cfgdir is unrecognized, got %v", err)
	}
	if len(f.Calls) == 0 {
		t.Fatal("identity teardown must run regardless of cfgdir recognition")
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e != nil {
		t.Fatal("an unrecognized cfgdir must be left in place, not removed")
	}
	if !strings.Contains(errBuf.String(), "config dir left in place") {
		t.Fatalf("expected a note that the cfgdir was left in place, got %q", errBuf.String())
	}
}

func TestPurgeTearsDownButKeepsSymlinkCfgDir(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "target")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	seedInstall(t, target) // a VALID marker lives inside the symlink target
	link := filepath.Join(base, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	var errBuf bytes.Buffer
	// Trailing slash: Lstat(Clean(link+"/")) sees the LINK, so the removal guard
	// skips it. Teardown still runs; the symlink and its target are left untouched.
	app := &App{CfgDir: link + "/", Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errBuf, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("purge must complete (teardown runs) with a symlink cfgdir, got %v", err)
	}
	if len(f.Calls) == 0 {
		t.Fatal("identity teardown must run even when cfgdir is a symlink")
	}
	if _, e := os.Stat(filepath.Join(target, "install-state")); e != nil {
		t.Fatal("symlink target removed despite the removal guard")
	}
	if !strings.Contains(errBuf.String(), "config dir left in place") {
		t.Fatalf("expected a note that the cfgdir was left in place, got %q", errBuf.String())
	}
}

func TestPurgeOrphanStateStillTearsDown(t *testing.T) {
	// Orphan/recovery state: the config dir does not exist at all (.env + config
	// gone) but docker resources may survive. --purge is the config-independent
	// recovery hatch — teardown must run and the command must succeed (so a partial
	// purge can be re-run to finish), not abort on the missing dir.
	dir := filepath.Join(t.TempDir(), "gone") // never created
	f := &compose.FakeRunner{}
	var errBuf bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: &errBuf, In: strings.NewReader("mathion_prod\n")}
	cmd := newUninstallCmd(app)
	cmd.SetArgs([]string{"--purge"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("purge in the orphan state (no config) must still tear down, got %v", err)
	}
	if len(f.Calls) == 0 {
		t.Fatal("identity teardown must run in the orphan state")
	}
	if !strings.Contains(errBuf.String(), "config dir left in place") {
		t.Fatalf("expected a note about the missing config dir, got %q", errBuf.String())
	}
}
