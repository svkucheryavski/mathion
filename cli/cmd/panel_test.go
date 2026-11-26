package cmd

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func runPanel(t *testing.T, f *compose.FakeRunner, dir string) (string, error) {
	t.Helper()
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: &out, Err: &out}
	c := newPanelCmd(app)
	c.SetArgs([]string{})
	c.SetOut(&out)
	c.SetErr(&out)
	err := c.ExecuteContext(context.Background())
	return out.String(), err
}

func TestPanelRunsActivate(t *testing.T) {
	asRoot(t)
	f := &compose.FakeRunner{}
	if _, err := runPanel(t, f, seedInstalled(t, false)); err != nil {
		t.Fatal(err)
	}
	if len(f.Calls) != 1 || !strings.HasSuffix(strings.Join(f.Calls[0], " "), "exec -T app python -m mathion.superuser activate") || f.Calls[0][0] != "compose" {
		t.Fatalf("calls %v", f.Calls)
	}
}

func TestPanelNamesAdminEmail(t *testing.T) {
	asRoot(t)
	out, err := runPanel(t, &compose.FakeRunner{}, seedInstalled(t, false))
	if err != nil || !strings.Contains(out, "Sign in as you@example.edu first, then open this link in the same browser. It stops working after 30 minutes without use; running this command again replaces it.") {
		t.Fatalf("err=%v out=%q", err, out)
	}
}

func TestPanelComposeError(t *testing.T) {
	asRoot(t)
	f := &compose.FakeRunner{RunFunc: func([]string) error { return errors.New("exit 1") }}
	out, err := runPanel(t, f, seedInstalled(t, false))
	if err == nil || !strings.Contains(err.Error(), "no panel link was made (exit 1). Is Mathion running? Start it with: sudo mathion start") || strings.Contains(out, "Sign in as") {
		t.Fatalf("err=%v out=%q", err, out)
	}
}

func TestPanelNeedsRoot(t *testing.T) {
	orig := geteuid
	geteuid = func() int { return 1000 }
	t.Cleanup(func() { geteuid = orig })
	f := &compose.FakeRunner{}
	if _, err := runPanel(t, f, t.TempDir()); err == nil || len(f.Calls) != 0 {
		t.Fatalf("err=%v calls=%v", err, f.Calls)
	}
}

func TestPanelInHelp(t *testing.T) {
	var out bytes.Buffer
	root := newRootCmd(&App{CfgDir: t.TempDir(), Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out, Err: &out})
	root.SetOut(&out)
	root.SetArgs([]string{"--help"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "panel") || !strings.Contains(out.String(), "Print a link to the admin panel") {
		t.Fatalf("help %q", out.String())
	}
}

func TestPanelNoInstall(t *testing.T) {
	asRoot(t)
	f := &compose.FakeRunner{}
	_, err := runPanel(t, f, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "mathion install") || len(f.Calls) != 0 {
		t.Fatalf("err=%v calls=%v", err, f.Calls)
	}
}
