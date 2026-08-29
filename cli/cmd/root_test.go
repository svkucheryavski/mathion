package cmd

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
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

func findCmd(root *cobra.Command, args ...string) *cobra.Command {
	c, _, err := root.Find(args)
	if err != nil {
		return nil
	}
	return c
}

// The principled exclusion set (spec §4.1): commands that re-materialize the compose and
// report their own next-step, teardown, self-update, and machine/first-contact surfaces.
func TestDriftHookExcludedPredicate(t *testing.T) {
	root := newRootCmd(&App{})
	for _, name := range []string{"reconcile", "update", "install", "uninstall", "self-update"} {
		if c := findCmd(root, name); c == nil || !driftHookExcluded(c) {
			t.Errorf("%q must be excluded", name)
		}
	}
	// version: excluded ONLY with --short.
	v := findCmd(root, "version")
	if v == nil || driftHookExcluded(v) {
		t.Error("bare `version` must NOT be excluded")
	}
	if err := v.Flags().Set("short", "true"); err != nil {
		t.Fatal(err)
	}
	if !driftHookExcluded(v) {
		t.Error("`version --short` must be excluded")
	}
	// a representative non-excluded management command fires.
	if s := findCmd(root, "status"); s == nil || driftHookExcluded(s) {
		t.Error("`status` must NOT be excluded")
	}
	// completion is excluded by ANCESTRY, so `completion bash` (leaf named "bash") is caught.
	parent := &cobra.Command{Use: "completion"}
	child := &cobra.Command{Use: "bash"}
	parent.AddCommand(child)
	if !driftHookExcluded(child) {
		t.Error("`completion bash` (leaf `bash`, parent `completion`) must be excluded by ancestry")
	}
	if driftHookExcluded(&cobra.Command{Use: "somethingelse"}) {
		t.Error("an unrelated leaf must NOT be excluded")
	}
}

// No DESCENDANT may define its own PersistentPreRun* — cobra runs only the most-specific
// one, so a descendant hook would silently suppress the root's drift pre-run (spec §7).
func TestNoDescendantDefinesPersistentPreRun(t *testing.T) {
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			if sub.PersistentPreRun != nil || sub.PersistentPreRunE != nil {
				t.Errorf("%q defines a PersistentPreRun* that would suppress the root drift hook", sub.Name())
			}
			walk(sub)
		}
	}
	walk(newRootCmd(&App{}))
}

// The pre-run prints the drift note to Err (not Out) for a non-excluded command, and is
// silent for an excluded one — asserted by COUNTING the drift string per stream.
func TestPreRunRoutesDriftToStderr(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// version --short is EXCLUDED → no drift note anywhere; bare version is non-excluded.
	run := func(args ...string) (out, errb string) {
		var o, e bytes.Buffer
		app := &App{CfgDir: dir, Project: "mathion_prod", Out: &o, Err: &e, In: bytes.NewReader(nil)}
		root := newRootCmd(app)
		root.SetArgs(args)
		root.SetOut(&o)
		root.SetErr(&e)
		_ = root.ExecuteContext(context.Background())
		return o.String(), e.String()
	}
	// bare `version` (non-excluded, no Docker) → drift on Err, none on Out.
	out, errb := run("version")
	if !strings.Contains(errb, driftNote) {
		t.Errorf("non-excluded command must print drift on stderr; got err=%q", errb)
	}
	if strings.Contains(out, driftNote) {
		t.Errorf("drift must be on stderr, not stdout; got out=%q", out)
	}
	// `version --short` (excluded) → no drift string on either stream.
	out, errb = run("version", "--short")
	if strings.Contains(out, driftNote) || strings.Contains(errb, driftNote) {
		t.Errorf("excluded command must emit no drift; got out=%q err=%q", out, errb)
	}
}

// Mutation-safety (spec §6): the hook only READS — invoking it directly performs no
// Runner call, no marker write, no compose write.
func TestPreRunIsReadOnly(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var e bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &bytes.Buffer{}, Err: &e}
	root := newRootCmd(app)
	if err := root.PersistentPreRunE(findCmd(root, "status"), nil); err != nil {
		t.Fatalf("pre-run must never error; got %v", err)
	}
	if fr := app.Runner.(*compose.FakeRunner); len(fr.Calls) != 0 {
		t.Errorf("pre-run must not invoke the Runner; got %v", fr.Calls)
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("pre-run must not write the apply-pending marker")
	}
	if b, _ := os.ReadFile(dir + "/docker-compose.yml"); string(b) != "stale: true\n" {
		t.Error("pre-run must not rewrite the on-disk compose")
	}
	if !strings.Contains(e.String(), driftNote) {
		t.Errorf("pre-run should still have printed the drift note (proving it ran); got %q", e.String())
	}
}
