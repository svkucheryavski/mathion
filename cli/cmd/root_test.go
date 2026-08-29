package cmd

import (
	"errors"
	"fmt"
	"os"
	"slices"
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
// --no-rollback, --yes, and --no-reconcile.
func TestUpdateCmdFlags(t *testing.T) {
	app := &App{CfgDir: "/tmp", Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr, In: os.Stdin}
	c := newUpdateCmd(app)
	if c.Name() != "update" {
		t.Fatalf("cmd name = %q; want update", c.Name())
	}
	for _, fl := range []string{"version", "no-rollback", "yes", "no-reconcile"} {
		if c.Flags().Lookup(fl) == nil {
			t.Errorf("missing --%s flag", fl)
		}
	}
}

func hasProfile(args []string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--profile" && args[i+1] == "tls" {
			return true
		}
	}
	return false
}

func TestTLSEnabledFromEnvFailsClosedOnPoisonedEnv(t *testing.T) {
	dir := writePoisonedTLSEnv(t)
	if tlsEnabledFromEnv(dir) {
		t.Fatal("a .env with an interpolation payload in a TLS value must read as DISABLED (fail closed)")
	}
	// And the start path must therefore add no --profile tls.
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}}
	app.tlsEnabled = tlsEnabledFromEnv(dir) // mirrors Execute()
	if hasProfile(app.composeArgs("up", "-d", "--wait")) {
		t.Fatal("start must NOT add --profile tls when the .env is inconsistent")
	}
}

func TestComposeArgsProfileSplit(t *testing.T) {
	app := &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: &compose.FakeRunner{}}

	// Containment / inspection: ALWAYS carries the profile, regardless of tlsEnabled.
	for _, sub := range [][]string{{"down"}, {"stop"}, {"rm", "-sf", "proxy"}, {"ps", "-q", "proxy"}, {"logs"}} {
		app.tlsEnabled = false
		if !hasProfile(app.composeArgs(sub...)) {
			t.Errorf("containment %v must carry --profile tls even when disabled", sub)
		}
	}

	// Start: profile ONLY when enabled.
	for _, sub := range [][]string{{"up", "-d", "--wait"}, {"start"}, {"create"}, {"run", "--rm"}} {
		app.tlsEnabled = false
		if hasProfile(app.composeArgs(sub...)) {
			t.Errorf("start %v must NOT carry the profile when disabled", sub)
		}
		app.tlsEnabled = true
		if !hasProfile(app.composeArgs(sub...)) {
			t.Errorf("start %v must carry the profile when enabled", sub)
		}
	}

	// Everything else: NEVER, regardless of tlsEnabled.
	for _, sub := range [][]string{{"pull"}, {"exec", "-T", "app", "sh"}, {"config"}} {
		for _, en := range []bool{false, true} {
			app.tlsEnabled = en
			if hasProfile(app.composeArgs(sub...)) {
				t.Errorf("non-start/non-containment %v must never carry the profile (tlsEnabled=%v)", sub, en)
			}
		}
	}

	// Empty sub: no panic, no profile.
	app.tlsEnabled = true
	got := app.composeArgs()
	if hasProfile(got) {
		t.Errorf("empty sub must not carry the profile: %v", got)
	}
	// The base flags are still present and ordered.
	if !slices.Equal(got[:3], []string{"compose", "-p", "mathion_prod"}) {
		t.Errorf("base args malformed: %v", got)
	}
}
