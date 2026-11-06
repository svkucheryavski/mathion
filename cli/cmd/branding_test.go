package cmd

import (
	"bytes"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// brandingApp is a test App whose prompt reads `answer` and whose output and
// error output are captured.
func brandingApp(f *compose.FakeRunner, answer string) (*App, *bytes.Buffer, *bytes.Buffer) {
	var out, errOut bytes.Buffer
	return &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f,
		Out: &out, Err: &errOut, In: strings.NewReader(answer)}, &out, &errOut
}

func runBranding(app *App, args ...string) error {
	c := newBrandingCmd(app)
	c.SetArgs(args)
	c.SetOut(io.Discard)
	c.SetErr(io.Discard)
	return c.Execute()
}

func brandingArgv(extra ...string) []string {
	return append([]string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml",
		"--env-file", "/etc/mathion/.env", "exec", "-T", "app", "python", "-m", "mathion.superuser",
		"branding-reset"}, extra...)
}

func TestBrandingResetPromptsAndStreams(t *testing.T) {
	f := &compose.FakeRunner{StreamFunc: func(w io.Writer, args []string) error {
		_, _ = w.Write([]byte("Removed the colour changes.\n"))
		return nil
	}}
	app, out, _ := brandingApp(f, "y\n")
	if err := runBranding(app, "reset"); err != nil {
		t.Fatalf("reset: %v", err)
	}
	want := "This removes the colour changes. Continue? [y/N] Removed the colour changes.\n"
	if out.String() != want {
		t.Fatalf("output = %q, want %q", out.String(), want)
	}
	if len(f.Calls) != 1 || !reflect.DeepEqual(f.Calls[0], brandingArgv()) {
		t.Fatalf("calls = %v, want one %v", f.Calls, brandingArgv())
	}
}

func TestBrandingResetAllPrompt(t *testing.T) {
	f := &compose.FakeRunner{}
	app, out, _ := brandingApp(f, "yes\n")
	if err := runBranding(app, "reset", "--all"); err != nil {
		t.Fatalf("reset --all: %v", err)
	}
	if !strings.HasPrefix(out.String(), "This resets the site name, logo, tab icon and colours. Continue? [y/N] ") {
		t.Fatalf("prompt = %q", out.String())
	}
	if !reflect.DeepEqual(f.Calls[0], brandingArgv("--all")) {
		t.Fatalf("argv = %v, want %v", f.Calls[0], brandingArgv("--all"))
	}
}

func TestBrandingResetNoCancels(t *testing.T) {
	for _, answer := range []string{"n\n", "\n", ""} {
		f := &compose.FakeRunner{}
		app, _, _ := brandingApp(f, answer)
		if err := runBranding(app, "reset"); err == nil {
			t.Fatalf("answer %q: want a cancel error", answer)
		}
		if len(f.Calls) != 0 {
			t.Fatalf("answer %q: ran %v, want nothing", answer, f.Calls)
		}
	}
}

func TestBrandingResetYesSkipsPrompt(t *testing.T) {
	f := &compose.FakeRunner{}
	app, out, _ := brandingApp(f, "")
	if err := runBranding(app, "reset", "--all", "--yes"); err != nil {
		t.Fatalf("reset --all --yes: %v", err)
	}
	if strings.Contains(out.String(), "Continue?") {
		t.Fatalf("--yes still prompted: %q", out.String())
	}
	if !reflect.DeepEqual(f.Calls[0], brandingArgv("--all")) {
		t.Fatalf("argv = %v", f.Calls[0])
	}
}

func TestBrandingResetOnAnOlderImage(t *testing.T) {
	f := &compose.FakeRunner{StreamFunc: func(w io.Writer, args []string) error {
		return &compose.ExitError{Code: 2, Stderr: []byte("usage: python -m mathion.superuser ...\n" +
			"python -m mathion.superuser: error: argument command: invalid choice: 'branding-reset' " +
			"(choose from 'create-superuser', 'pin', 'activate')\n")}
	}}
	app, _, errOut := brandingApp(f, "")
	err := runBranding(app, "reset", "--yes")
	want := "This server's Mathion is too old for branding reset: run `mathion update` first."
	if err == nil || err.Error() != want {
		t.Fatalf("err = %v, want %q", err, want)
	}
	if errOut.Len() != 0 {
		t.Fatalf("argparse's text leaked: %q", errOut.String())
	}
}

func TestBrandingResetOtherFailureShowsItsErrorOutput(t *testing.T) {
	notRunning := "service \"app\" is not running\n"
	f := &compose.FakeRunner{StreamFunc: func(w io.Writer, args []string) error {
		return &compose.ExitError{Code: 1, Stderr: []byte(notRunning)}
	}}
	app, _, errOut := brandingApp(f, "")
	err := runBranding(app, "reset", "--yes")
	if err == nil {
		t.Fatal("want the failure returned")
	}
	if errOut.String() != notRunning {
		t.Fatalf("error output = %q, want %q", errOut.String(), notRunning)
	}
	if strings.Contains(err.Error(), "not running") {
		t.Fatalf("error repeats the captured output (printed twice): %v", err)
	}
	// Code 2 without "invalid choice" isn't the older-image case.
	f.StreamFunc = func(w io.Writer, args []string) error {
		return &compose.ExitError{Code: 2, Stderr: []byte("boom\n")}
	}
	app, _, errOut = brandingApp(f, "")
	if err := runBranding(app, "reset", "--yes"); err == nil || strings.Contains(err.Error(), "too old") {
		t.Fatalf("err = %v, want a plain failure", err)
	}
	if errOut.String() != "boom\n" {
		t.Fatalf("error output = %q", errOut.String())
	}
}

func TestBrandingResetNonExitErrorReturned(t *testing.T) {
	sentinel := errors.New("docker not found")
	f := &compose.FakeRunner{StreamFunc: func(w io.Writer, args []string) error { return sentinel }}
	app, _, _ := brandingApp(f, "")
	if err := runBranding(app, "reset", "--yes"); !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want %v", err, sentinel)
	}
}

func TestBrandingRegisteredOnRoot(t *testing.T) {
	root := newRootCmd(newTestApp(&compose.FakeRunner{}))
	c, _, err := root.Find([]string{"branding", "reset"})
	if err != nil || c.Name() != "reset" || c.Parent().Name() != "branding" {
		t.Fatalf("branding reset not registered: %v %v", c, err)
	}
}
