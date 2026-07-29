package cmd

import (
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestStopArgv(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newStopCmd(newTestApp(f))
	_ = cmd.RunE(cmd, nil)
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "stop"}
	if len(f.Calls) != 1 || !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
}
