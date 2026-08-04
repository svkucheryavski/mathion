package cmd

import (
	"bytes"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestPinGatesOnComposeError(t *testing.T) {
	// A non-zero `docker compose exec` (daemon down, app container not running)
	// must surface as an error — pin no longer swallows it behind an advisory.
	f := &compose.FakeRunner{RunFunc: func(args []string) error { return errors.New("daemon down") }}
	app := newTestApp(f)
	var out bytes.Buffer
	app.Out = &out
	cmd := newPinCmd(app)
	cmd.SetArgs([]string{"you@example.edu"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("pin must surface a compose/infra error, not swallow it")
	}
	if strings.Contains(out.String(), "PIN expires") {
		t.Fatalf("pin must not print the advisory when the exec failed, got %q", out.String())
	}
	// `--` ends option parsing so a leading-dash email is never read as a flag.
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", "--", "you@example.edu"}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}

func TestPinSuccessPrintsAdvisory(t *testing.T) {
	// The subcommand exits 0 (including on rate-limit), so a clean exec prints
	// the advisory and returns no error.
	f := &compose.FakeRunner{}
	app := newTestApp(f)
	var out bytes.Buffer
	app.Out = &out
	cmd := newPinCmd(app)
	cmd.SetArgs([]string{"you@example.edu"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("pin on a clean exec must not error, got %v", err)
	}
	if !strings.Contains(out.String(), "PIN expires in 10 min") {
		t.Fatalf("expected the advisory after a clean exec, got %q", out.String())
	}
}
