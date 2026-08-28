package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// statusWithHealth runs `mathion status` against a drifted on-disk compose with the
// health probe forced to healthErr, and returns captured stdout.
func statusWithHealth(t *testing.T, healthErr error) string {
	t.Helper()
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir+"/.env", []byte("MATHION_VERSION=v0.1.1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	orig := healthProbe
	healthProbe = func(context.Context, string) error { return healthErr }
	t.Cleanup(func() { healthProbe = orig })
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out, Err: &out, In: bytes.NewReader(nil)}
	cmd := newStatusCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatalf("status RunE: %v", err)
	}
	return out.String()
}

func TestStatusEmitsDriftOnHealthyBranch(t *testing.T) {
	s := statusWithHealth(t, nil)
	if !strings.Contains(s, "apply it with: sudo mathion reconcile") {
		t.Errorf("healthy status must emit the drift notice; got %q", s)
	}
}

func TestStatusEmitsDriftOnUnhealthyBranch(t *testing.T) {
	s := statusWithHealth(t, errors.New("connection refused"))
	if !strings.Contains(s, "apply it with: sudo mathion reconcile") {
		t.Errorf("unhealthy status must still emit the drift notice; got %q", s)
	}
	if !strings.Contains(s, "stack not healthy") {
		t.Errorf("expected the unhealthy line; got %q", s)
	}
}

func TestMaybeWarnInstallIncomplete(t *testing.T) {
	// incomplete → notice
	inc := t.TempDir()
	config.WriteState(inc, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: false})
	var b bytes.Buffer
	maybeWarnInstallIncomplete(&b, inc)
	if !strings.Contains(b.String(), "did not finish") {
		t.Fatalf("incomplete install must warn; got %q", b.String())
	}
	// complete + grandfathered + missing → silent. Seeds return their WriteState error
	// so a fixture-creation failure can't make a silence case false-pass (an unwritten
	// marker would also produce empty output).
	for _, seed := range []func(string) error{
		func(d string) error {
			return config.WriteState(d, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: true})
		},
		func(d string) error { return config.WriteState(d, config.State{Schema: 1, AdminEmail: "a@b.c"}) },
		func(string) error { return nil }, // no marker at all
	} {
		d := t.TempDir()
		if err := seed(d); err != nil {
			t.Fatalf("seed failed: %v", err)
		}
		var q bytes.Buffer
		maybeWarnInstallIncomplete(&q, d)
		if q.Len() != 0 {
			t.Fatalf("must be silent; got %q", q.String())
		}
	}
}

func TestStatusEmitsIncompleteNotice(t *testing.T) {
	cfg := t.TempDir()
	config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "a@b.c", Complete: false})
	f := &compose.FakeRunner{}
	var out bytes.Buffer
	app := &App{CfgDir: cfg, Project: "mathion_prod", Runner: f, Out: &out, Err: &out}
	// Force the health probe to fail so status returns nil without a live app.
	prev := healthProbe
	healthProbe = func(context.Context, string) error { return errors.New("stub") }
	t.Cleanup(func() { healthProbe = prev })
	c := newStatusCmd(app)
	c.SetContext(context.Background())
	if err := c.RunE(c, nil); err != nil {
		t.Fatal(err)
	}
	// Strengthened assertion: use the fragment UNIQUE to the incomplete-install
	// notice. The compose-drift notice (called on the same path) also contains
	// "did not finish", so the bare substring is fragile; this fragment appears
	// only in maybeWarnInstallIncomplete's output.
	if !strings.Contains(out.String(), "install did not finish — run `sudo mathion install`") {
		t.Fatalf("status must surface the incomplete-install notice; got %q", out.String())
	}
}
