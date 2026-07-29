package cmd

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// helper: a fake runner whose `volume inspect` reports the named volumes present.
func runnerWithVolumes(present map[string]bool) *compose.FakeRunner {
	return &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if len(args) >= 3 && args[0] == "volume" && args[1] == "inspect" {
			if present[args[2]] {
				return "ok", nil
			}
			return "", &noSuch{}
		}
		return "", nil
	}}
}

type noSuch struct{}

func (n *noSuch) Error() string { return "no such volume" }

func TestResumeReusesSecrets(t *testing.T) {
	dir := t.TempDir()
	// seed a complete prior install: state + .env
	config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"})
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "OLD_SECRET==", "oldhex")
	os.WriteFile(filepath.Join(dir, ".env"), []byte(config.RenderEnv(env)), 0o600)

	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstall(context.Background(), installOpts{Domain: "ignored.example.edu", AdminEmail: "new@x.edu", Version: "v9"}); err != nil {
		t.Fatal(err)
	}
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_SECRET_KEY"] != "OLD_SECRET==" || m["POSTGRES_PASSWORD"] != "oldhex" {
		t.Fatalf("resume regenerated secrets: %v", m)
	}
}

func TestFailClosedOnMissingState(t *testing.T) {
	dir := t.TempDir()
	// .env present but NO install-state → abort, no regen
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_SECRET_KEY=x\n"), 0o600)
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil || !strings.Contains(err.Error(), "install-state") {
		t.Fatalf("expected fail-closed on missing state, got %v", err)
	}
}

func TestVolumeGuardBlocksFreshOverExistingVolume(t *testing.T) {
	dir := t.TempDir() // no .env, no state → provisionally fresh
	f := runnerWithVolumes(map[string]bool{"mathion_prod_mathion_pgdata": true})
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil {
		t.Fatal("volume guard must abort a fresh install when a fixed-project volume exists")
	}
	// NO secret written
	if _, e := os.Stat(filepath.Join(dir, ".env")); e == nil {
		t.Fatal(".env was written despite the volume guard aborting")
	}
}
