package cmd

import (
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestResolveCfgDirDefault(t *testing.T) {
	t.Setenv("MATHION_CONFIG_DIR", "")
	if got := resolveCfgDir(); got != "/etc/mathion" {
		t.Fatalf("cfgdir = %q, want /etc/mathion", got)
	}
}

func TestResolveCfgDirOverride(t *testing.T) {
	t.Setenv("MATHION_CONFIG_DIR", "/tmp/x")
	if got := resolveCfgDir(); got != "/tmp/x" {
		t.Fatalf("cfgdir = %q, want /tmp/x", got)
	}
}

func TestResolveProject(t *testing.T) {
	t.Setenv("MATHION_PROJECT_OVERRIDE", "")
	if got := resolveProject(); got != "mathion_prod" {
		t.Fatalf("project = %q, want mathion_prod", got)
	}
	t.Setenv("MATHION_PROJECT_OVERRIDE", "mathion_t123")
	if got := resolveProject(); got != "mathion_t123" {
		t.Fatalf("project = %q, want mathion_t123", got)
	}
}

func TestRootHasSubcommands(t *testing.T) {
	app := &App{CfgDir: "/tmp", Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr, In: os.Stdin}
	cmd := newRootCmd(app)
	want := []string{"install", "start", "stop", "status", "logs", "pin", "superuser", "version", "uninstall", "update"}
	have := map[string]bool{}
	for _, c := range cmd.Commands() {
		have[c.Name()] = true
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("missing subcommand %q", w)
		}
	}
}

// TestExecuteExit3Mapping pins the pure exitCode mapping Execute uses: nil→0, a plain
// error→1, a rollbackFailedError (bare or wrapped, proving the errors.As chain walk)→3.
func TestExecuteExit3Mapping(t *testing.T) {
	if got := exitCode(nil); got != 0 {
		t.Fatalf("exitCode(nil) = %d; want 0", got)
	}
	if got := exitCode(errors.New("x")); got != 1 {
		t.Fatalf("exitCode(plain) = %d; want 1", got)
	}
	if got := exitCode(rollbackFailedError{err: errors.New("y")}); got != 3 {
		t.Fatalf("exitCode(rollbackFailed) = %d; want 3", got)
	}
	if got := exitCode(fmt.Errorf("wrap: %w", rollbackFailedError{err: errors.New("z")})); got != 3 {
		t.Fatalf("exitCode(wrapped rollbackFailed) = %d; want 3", got)
	}
}

// TestUpdateCmdFlags: newUpdateCmd registers under "update" with --version,
// --no-rollback, and --yes.
func TestUpdateCmdFlags(t *testing.T) {
	app := &App{CfgDir: "/tmp", Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr, In: os.Stdin}
	c := newUpdateCmd(app)
	if c.Name() != "update" {
		t.Fatalf("cmd name = %q; want update", c.Name())
	}
	for _, fl := range []string{"version", "no-rollback", "yes"} {
		if c.Flags().Lookup(fl) == nil {
			t.Errorf("missing --%s flag", fl)
		}
	}
}
