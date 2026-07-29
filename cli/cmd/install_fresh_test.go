package cmd

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

func TestFreshInstallWritesConfigAndRuns(t *testing.T) {
	dir := t.TempDir()
	f := &compose.FakeRunner{} // all runs succeed, volume-inspect returns absent by default
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstallFresh(context.Background(), installOpts{
		Domain: "learn.example.edu", AdminEmail: "You@Example.edu", Version: "v0.1.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	// state persisted with the NORMALIZED email
	st, err := config.ReadState(dir)
	if err != nil || st.AdminEmail != "you@example.edu" {
		t.Fatalf("state = %+v, err=%v", st, err)
	}
	// .env present, base URL constructed, secrets non-empty & coupled
	m, err := config.ReadEnvFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" {
		t.Fatalf("base url = %q", m["MATHION_BASE_URL"])
	}
	if m["MATHION_SECRET_KEY"] == "" || m["POSTGRES_PASSWORD"] == "" {
		t.Fatal("secrets not generated")
	}
	// compose file materialized from the embed
	if b, _ := os.ReadFile(filepath.Join(dir, "docker-compose.yml")); string(b) != string(compose.ComposeYAML) {
		t.Fatal("compose file not written from embed")
	}
	// verify the ordered compose subcommands were invoked
	saw := func(sub string) bool {
		for _, c := range f.Calls {
			for _, a := range c {
				if a == sub {
					return true
				}
			}
		}
		return false
	}
	for _, s := range []string{"pull", "up", "upgrade", "create-superuser"} {
		if !saw(s) {
			t.Errorf("install never ran %q", s)
		}
	}
}
