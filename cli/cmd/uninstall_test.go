package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

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
	os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600)
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
	os.WriteFile(filepath.Join(dir, ".env"), []byte("x"), 0o600)
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
