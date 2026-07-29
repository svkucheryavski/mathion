package cmd

import (
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func newTestApp(f *compose.FakeRunner) *App {
	return &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f}
}

func TestStartArgv(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newStartCmd(newTestApp(f))
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "up", "-d", "--wait"}
	if len(f.Calls) != 1 || !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
}
