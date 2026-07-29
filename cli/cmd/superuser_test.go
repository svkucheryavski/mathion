package cmd

import (
	"errors"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestSuperuserArgvAndGating(t *testing.T) {
	f := &compose.FakeRunner{RunFunc: func(args []string) error { return errors.New("boom") }}
	cmd := newSuperuserCmd(newTestApp(f))
	cmd.SetArgs([]string{"you@example.edu"})
	err := cmd.Execute()
	if err == nil {
		t.Fatal("superuser must propagate a non-zero exit from create-superuser")
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "exec", "-T", "app", "python", "-m", "mathion.superuser", "create-superuser", "you@example.edu"}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}
