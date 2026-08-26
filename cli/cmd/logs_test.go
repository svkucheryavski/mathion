package cmd

import (
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestLogsArgvFollowService(t *testing.T) {
	f := &compose.FakeRunner{}
	cmd := newLogsCmd(newTestApp(f))
	cmd.SetArgs([]string{"-f", "app"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "--profile", "tls", "logs", "--follow", "app"}
	if len(f.Calls) != 1 || !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls, want)
	}
}
