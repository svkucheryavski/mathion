package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
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
