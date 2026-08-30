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

// TestPreRunRoutesDriftToStderr drives the root drift pre-run across every
// compose/marker state through a non-excluded, Runner-free command (bare `version`,
// no Docker) and COUNTS the shared drift string per stream — spec §7 mandates
// "per-stream + counting ... not global emptiness", not a Contains check.
func TestPreRunRoutesDriftToStderr(t *testing.T) {
	rows := []struct {
		name      string
		writeFile bool
		content   string // compose bytes when writeFile is true
		marker    bool
		wantErr   int // expected count of driftNote on stderr (stdout is always 0)
	}{
		{name: "drifted", writeFile: true, content: "stale: true\n", wantErr: 1},
		{name: "identical", writeFile: true, content: string(compose.ComposeYAML), wantErr: 0},
		{name: "absent", writeFile: false, wantErr: 0},
		{name: "identical+marker", writeFile: true, content: string(compose.ComposeYAML), marker: true, wantErr: 1},
		{name: "absent+marker", writeFile: false, marker: true, wantErr: 0}, // §5: absent silences even a stale marker
	}
	for _, r := range rows {
		t.Run(r.name, func(t *testing.T) {
			varlibReady(t)
			if r.marker {
				if err := varlib.WriteMarker(); err != nil {
					t.Fatal(err)
				}
			}
			dir := t.TempDir()
			if r.writeFile {
				if err := os.WriteFile(dir+"/docker-compose.yml", []byte(r.content), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			var o, e bytes.Buffer
			app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &o, Err: &e, In: bytes.NewReader(nil)}
			root := newRootCmd(app)
			root.SetArgs([]string{"version"})
			root.SetOut(&o)
			root.SetErr(&e)
			if err := root.ExecuteContext(context.Background()); err != nil {
				t.Fatalf("version via root: %v", err)
			}
			if got := strings.Count(e.String(), driftNote); got != r.wantErr {
				t.Errorf("stderr driftNote count = %d, want %d; err=%q", got, r.wantErr, e.String())
			}
			if got := strings.Count(o.String(), driftNote); got != 0 {
				t.Errorf("stdout must never carry the drift note; count = %d, out=%q", got, o.String())
			}
		})
	}
}

// TestPreRunExcludedCommandsSilent proves every excluded command emits ZERO drift
// lines with a DRIFTED compose present (spec §7 enumerated set). Two mechanisms:
// name-gated commands whose RunE would take the lock / hit the Runner
// (reconcile/update/install/uninstall/self-update) are exercised by invoking the
// root pre-run DIRECTLY on the registered leaf — no RunE side effects; the flag/
// ancestry-gated ones (version --short, help, completion bash) run through
// ExecuteContext so cobra parses --short and lazily materializes help/completion.
func TestPreRunExcludedCommandsSilent(t *testing.T) {
	seedDrift := func(t *testing.T) string {
		t.Helper()
		dir := t.TempDir()
		if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		return dir
	}
	// mechanism A: direct hook on registered, name-excluded leaves.
	for _, name := range []string{"reconcile", "update", "install", "uninstall", "self-update"} {
		t.Run("direct/"+name, func(t *testing.T) {
			varlibReady(t)
			dir := seedDrift(t)
			var o, e bytes.Buffer
			app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &o, Err: &e, In: bytes.NewReader(nil)}
			root := newRootCmd(app)
			leaf := findCmd(root, name)
			if leaf == nil {
				t.Fatalf("command %q is not registered on the root", name)
			}
			if err := root.PersistentPreRunE(leaf, nil); err != nil {
				t.Fatalf("pre-run must never error; got %v", err)
			}
			if c := strings.Count(e.String(), driftNote) + strings.Count(o.String(), driftNote); c != 0 {
				t.Errorf("excluded %q emitted %d drift line(s); out=%q err=%q", name, c, o.String(), e.String())
			}
		})
	}
	// mechanism B: through ExecuteContext (flag/ancestry-gated; RunE is print-only).
	// help/completion may write their OWN text to these streams — assert the absence
	// of the DRIFT string only, never emptiness (spec §7 line 139).
	for _, args := range [][]string{{"version", "--short"}, {"help"}, {"completion", "bash"}} {
		t.Run("exec/"+strings.Join(args, "_"), func(t *testing.T) {
			varlibReady(t)
			dir := seedDrift(t)
			var o, e bytes.Buffer
			app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &o, Err: &e, In: bytes.NewReader(nil)}
			root := newRootCmd(app)
			root.SetArgs(args)
			root.SetOut(&o)
			root.SetErr(&e)
			_ = root.ExecuteContext(context.Background())
			if c := strings.Count(e.String(), driftNote) + strings.Count(o.String(), driftNote); c != 0 {
				t.Errorf("excluded %v emitted %d drift line(s); out=%q err=%q", args, c, o.String(), e.String())
			}
		})
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
	if _, err := os.Stat(varlib.LockPath()); !os.IsNotExist(err) {
		t.Errorf("pre-run must not create the lock file %s (stat err=%v)", varlib.LockPath(), err)
	}
	if b, _ := os.ReadFile(dir + "/docker-compose.yml"); string(b) != "stale: true\n" {
		t.Error("pre-run must not rewrite the on-disk compose")
	}
	if strings.Count(e.String(), driftNote) != 1 {
		t.Errorf("pre-run should still have printed exactly one drift note (proving it ran); got %q", e.String())
	}
}
