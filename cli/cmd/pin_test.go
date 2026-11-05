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
	if strings.Contains(out.String(), "Log in at") {
		t.Fatalf("pin must not print the advisory when the exec failed, got %q", out.String())
	}
	// `--` ends option parsing so a leading-dash email is never read as a flag.
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "exec", "-T", "app", "python", "-m", "mathion.superuser", "pin", "--", "you@example.edu"}
	if !reflect.DeepEqual(f.Calls[0], want) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], want)
	}
}

func TestPinSuccessPrintsAdvisory(t *testing.T) {
	// The subcommand exits 0, so a clean exec prints the advisory and returns
	// no error.
	f := &compose.FakeRunner{}
	app := newTestApp(f)
	var out bytes.Buffer
	app.Out = &out
	cmd := newPinCmd(app)
	cmd.SetArgs([]string{"you@example.edu"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("pin on a clean exec must not error, got %v", err)
	}
	if !strings.Contains(out.String(), "Log in at your HTTPS domain") {
		t.Fatalf("expected the advisory after a clean exec, got %q", out.String())
	}
}

func TestPinTextQuotesNoFixedNumbers(t *testing.T) {
	// Settings D14: the panel's Settings set how long a PIN lasts and the
	// request limit, and `mathion pin` skips that limit; the backend prints the
	// real minutes. So neither the help nor the advisory quotes a number.
	f := &compose.FakeRunner{}
	app := newTestApp(f)
	var out bytes.Buffer
	app.Out = &out
	cmd := newPinCmd(app)
	cmd.SetArgs([]string{"you@example.edu"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("pin on a clean exec must not error, got %v", err)
	}
	for _, text := range []string{cmd.Short, cmd.Long, out.String()} {
		for _, old := range []string{"10 min", "3/hour"} {
			if strings.Contains(text, old) {
				t.Errorf("pin text quotes %q: %q", old, text)
			}
		}
	}
	if !strings.Contains(cmd.Short, "Settings") {
		t.Errorf("pin help should point to the panel's Settings, got %q", cmd.Short)
	}
}
