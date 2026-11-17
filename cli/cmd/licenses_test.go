package cmd

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/notices"
)

func TestLicensesPrintsNotices(t *testing.T) {
	var o, e bytes.Buffer
	fr := &compose.FakeRunner{}
	app := &App{CfgDir: t.TempDir(), Project: "mathion_prod", Runner: fr, Out: &o, Err: &e, In: bytes.NewReader(nil)}
	root := newRootCmd(app)
	root.SetArgs([]string{"licenses"})
	root.SetOut(&o)
	root.SetErr(&e)
	if err := root.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("licenses: %v", err)
	}
	want := "Mathion CLI is licensed under the Apache License 2.0 (see LICENSE in the source repository).\n\n" + notices.Text
	if o.String() != want {
		t.Fatalf("stdout mismatch; first 200 bytes: %q", o.String()[:min(200, o.Len())])
	}
	if e.Len() != 0 {
		t.Fatalf("stderr must be empty; got %q", e.String())
	}
	if len(fr.Calls) != 0 {
		t.Fatalf("licenses must run nothing; calls %v", fr.Calls)
	}
}

func TestLicensesListedInHelp(t *testing.T) {
	var o bytes.Buffer
	root := newRootCmd(&App{Out: &o, Err: &o, In: bytes.NewReader(nil)})
	root.SetArgs([]string{"--help"})
	root.SetOut(&o)
	if err := root.ExecuteContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(o.String(), "\n  licenses ") {
		t.Fatalf("--help must list licenses; got %q", o.String())
	}
}
