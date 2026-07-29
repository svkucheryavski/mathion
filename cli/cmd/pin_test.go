package cmd

import (
	"errors"
	"io"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestPinArgvDoesNotGate(t *testing.T) {
	f := &compose.FakeRunner{RunFunc: func(args []string) error { return errors.New("ignored") }}
	// newTestApp leaves Out nil; pin writes an advisory line to it, so supply a
	// sink (production sets Out=os.Stdout in Execute). Mirrors version_test.
	app := newTestApp(f)
	app.Out = io.Discard
	cmd := newPinCmd(app)
	cmd.SetArgs([]string{"you@example.edu"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("pin must not gate on the subcommand exit code, got %v", err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", "you@example.edu"}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}
