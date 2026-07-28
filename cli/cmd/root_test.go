package cmd

import (
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
	want := []string{"install", "start", "stop", "status", "logs", "pin", "superuser", "version", "uninstall"}
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
