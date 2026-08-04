package cmd

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

func TestFreshInstallWritesConfigAndRuns(t *testing.T) {
	dir := t.TempDir()
	f := &compose.FakeRunner{} // runInstallFresh bypasses the volume guard; all runs/outputs succeed
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
	// .env holds secrets: it must be written 0600 (owner-only).
	if fi, err := os.Stat(filepath.Join(dir, ".env")); err != nil {
		t.Fatal(err)
	} else if fi.Mode().Perm() != 0o600 {
		t.Fatalf(".env mode = %v, want 0600", fi.Mode().Perm())
	}
	// The compose steps must run in the exact order pull → up → migrate → superuser
	// (a wrong order would migrate before the stack is up, or create a superuser
	// against an unmigrated DB). Email is normalized; `--` guards the positional.
	base := []string{"compose", "-p", "mathion_prod", "-f", filepath.Join(dir, "docker-compose.yml"), "--env-file", filepath.Join(dir, ".env")}
	with := func(sub ...string) []string { return append(append([]string{}, base...), sub...) }
	want := [][]string{
		with("pull"),
		with("up", "-d", "--wait"),
		with("exec", "-T", "app", "alembic", "upgrade", "head"),
		with("exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", "--", "you@example.edu"),
	}
	if !reflect.DeepEqual(f.Calls, want) {
		t.Fatalf("compose calls =\n%v\nwant\n%v", f.Calls, want)
	}
}
