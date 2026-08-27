package cmd

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// installedDeployment writes a valid, installed deployment into a temp cfgdir: a
// complete .env (0600), an install-state marker, a STALE docker-compose.yml (so a
// reconcile must re-materialize it), and — when tls is true — TLS state.
func installedDeployment(t *testing.T, tls bool) string {
	t.Helper()
	dir := t.TempDir()
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "SECRET==", "abc123hex")
	if err := config.AtomicWrite(dir+"/.env", []byte(config.RenderEnv(env)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err)
	}
	if err := config.AtomicWrite(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if tls {
		if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// varlibReady sets a fresh 0700 MATHION_VARLIB_DIR and creates the managed tree, for
// tests that call (*App).reconcile directly (bypassing lockAndGuard's EnsureBackupsDir).
func varlibReady(t *testing.T) {
	t.Helper()
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileRequiresRoot(t *testing.T) {
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	orig := geteuid
	geteuid = func() int { return 1000 }
	defer func() { geteuid = orig }()
	fr := &compose.FakeRunner{}
	app := &App{CfgDir: t.TempDir(), Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: bytes.NewReader(nil)}
	cmd := newReconcileCmd(app)
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Fatal("reconcile must require root")
	}
	if len(fr.Calls) != 0 {
		t.Errorf("no docker calls when non-root: %v", fr.Calls)
	}
}

func TestReconcileRefusesOnBreadcrumb(t *testing.T) {
	rootedVarlib(t)
	seedBreadcrumb(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: bytes.NewReader(nil)}
	cmd := newReconcileCmd(app)
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Fatal("reconcile must refuse on a leftover recovery breadcrumb")
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("no up on breadcrumb refuse")
	}
}

func TestReconcileRefusesOnIncompleteInstall(t *testing.T) {
	dir := installedDeployment(t, false)
	varlibReady(t)
	if err := config.WriteState(dir, config.State{Schema: 2, AdminEmail: "admin@example.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: io.Discard, Err: io.Discard}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("reconcile must refuse on an incomplete install")
	}
	if hasCall(f.Calls, joinHas("up -d")) {
		t.Fatalf("reconcile must not bring the stack up on refusal; calls=%v", f.Calls)
	}
}

func TestReconcileRequiresInstalledDeployment(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir() // no .env, no state
	fr := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("reconcile must require an installed deployment")
	}
	if len(fr.Calls) != 0 {
		t.Errorf("no docker calls before the install gate: %v", fr.Calls)
	}
}

func TestReconcileRejectsLoosePermEnv(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false) // writes .env at 0600
	if err := os.Chmod(dir+"/.env", 0o644); err != nil {
		t.Fatal(err) // group/world-readable secrets: requireInstalledDeployment rejects (perm&0o077 != 0, tls.go:241)
	}
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("reconcile must reject a group/world-readable .env (spec §8 test 2)")
	}
	if len(fr.Calls) != 0 {
		t.Errorf("no docker calls before the permission gate: %v", fr.Calls)
	}
}

func TestReconcileRefusesWhenAppNotRunning(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "\n", nil }} // ps -q app => empty
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	err := app.reconcile(context.Background(), false)
	if err == nil {
		t.Fatal("reconcile must refuse when the app container is not running")
	}
	// spec §4.1 step 4 / §8 test 4: the refusal must point the operator at BOTH remedies.
	if !strings.Contains(err.Error(), "mathion start") || !strings.Contains(err.Error(), "mathion install") {
		t.Errorf("the not-running refusal must name both `mathion start` and `mathion install`; got %v", err)
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("no up should be issued when the app is not running")
	}
	got, _ := os.ReadFile(dir + "/docker-compose.yml")
	if bytes.Equal(got, compose.ComposeYAML) {
		t.Error("no compose re-materialize before the running-app gate passes")
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("no marker should be written when the app-running gate refuses")
	}
}

func TestReconcileNonTLSReMaterializesAndUps(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "appcontainer\n", nil }}
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &out, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(dir + "/docker-compose.yml")
	if !bytes.Equal(got, compose.ComposeYAML) {
		t.Fatal("on-disk compose not re-materialized to the embed")
	}
	i := idxOfCall(fr.Calls, joinHas("up -d --wait --pull never"))
	if i < 0 {
		t.Fatalf("no up call; calls=%v", fr.Calls)
	}
	// Exact tail: refute a stray trailing service (`... --pull never app`) that a
	// substring match would accept. composeArgs appends `--profile tls` (if any) BEFORE
	// the subcommand, so the last five args are always the up subcommand + flags.
	if c := fr.Calls[i]; len(c) < 5 || strings.Join(c[len(c)-5:], " ") != "up -d --wait --pull never" {
		t.Errorf("up must end EXACTLY with `up -d --wait --pull never` (no trailing service): %v", c)
	}
	if containsArg(fr.Calls[i], "--profile") {
		t.Errorf("non-TLS up must not carry --profile tls: %v", fr.Calls[i])
	}
	for _, c := range fr.Calls {
		if containsArg(c, "--remove-orphans") {
			t.Errorf("reconcile must never pass --remove-orphans: %v", c)
		}
		if containsArg(c, "--pull") && (containsArg(c, "missing") || containsArg(c, "always")) {
			t.Errorf("reconcile up must be --pull never only: %v", c)
		}
		if containsArg(c, "pull") && containsArg(c, "--policy") {
			t.Errorf("non-TLS reconcile must not pre-pull the proxy: %v", c)
		}
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("marker should be cleared after a successful reconcile")
	}
	if !strings.Contains(out.String(), "reconciled to this CLI's stack definition") {
		t.Errorf("missing success line: %q", out.String())
	}
}

func TestReconcileTLSPrePullsAndUpsWithProfile(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, true)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "appcontainer\n", nil }}
	defer swapProbe(func() bool { return true })()
	// Startup snapshot deliberately FALSE; the .env is TLS-enabled, so the re-derive
	// under the lock must turn it ON.
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n"), tlsEnabled: false}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	pi := idxOfCall(fr.Calls, joinHas("pull --policy missing proxy proxy-init"))
	if pi < 0 {
		t.Fatalf("TLS reconcile must pre-pull the pinned proxy: %v", fr.Calls)
	}
	ui := idxOfCall(fr.Calls, joinHas("up -d --wait --pull never"))
	if ui < 0 || !containsArg(fr.Calls[ui], "--profile") {
		t.Fatalf("TLS up must carry --profile tls: %v", fr.Calls)
	}
	uc := fr.Calls[ui]
	if len(uc) < 5 || strings.Join(uc[len(uc)-5:], " ") != "up -d --wait --pull never" {
		t.Errorf("TLS up must still end EXACTLY with `up -d --wait --pull never`: %v", uc)
	}
	profAdjTLS := false
	for j, a := range uc {
		if a == "--profile" && j+1 < len(uc) && uc[j+1] == "tls" {
			profAdjTLS = true
		}
	}
	if !profAdjTLS {
		t.Errorf("--profile must be immediately followed by `tls`: %v", uc)
	}
	if pi > ui {
		t.Errorf("pre-pull must precede up (pi=%d ui=%d)", pi, ui)
	}
}

func TestReconcileReDerivesTLSFromEnvNotStartupSnapshot(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false) // .env is NON-TLS
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	// Startup snapshot lies (TRUE); the re-derive must drop --profile tls.
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n"), tlsEnabled: true}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	ui := idxOfCall(fr.Calls, joinHas("up -d --wait --pull never"))
	if ui < 0 || containsArg(fr.Calls[ui], "--profile") {
		t.Fatalf("startup TLS=true but .env non-TLS: up must drop --profile tls after re-derive: %v", fr.Calls)
	}
	if idxOfCall(fr.Calls, joinHas("pull --policy missing proxy")) >= 0 {
		t.Error("re-derived non-TLS must not pre-pull the proxy")
	}
}

func TestReconcileFailsClosedOnPoisonedEnv(t *testing.T) {
	varlibReady(t)
	dir := writePoisonedTLSEnv(t)
	if err := config.WriteState(dir, config.State{Schema: 1, AdminEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err) // so ValidateEnvComplete (not a missing state marker) is the operative gate
	}
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("reconcile must fail closed on a poisoned .env")
	}
	if idxOfCall(fr.Calls, joinHas("up")) >= 0 {
		t.Error("no up over a poisoned .env")
	}
}

func TestReconcileFatalPrePullAbortsBeforeUp(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, true)
	fr := &compose.FakeRunner{
		OutputFunc: func([]string) (string, error) { return "c\n", nil },
		RunFunc: func(args []string) error {
			if containsArg(args, "pull") {
				return errors.New("network down")
			}
			return nil
		},
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("a failed pinned-proxy pre-pull must be fatal")
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("up must not run after a fatal pre-pull")
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Error("marker must remain after a failed apply (written before the pre-pull)")
	}
}

func TestReconcileMarkerLeftAfterFailedUp(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{
		OutputFunc: func([]string) (string, error) { return "c\n", nil },
		RunFunc: func(args []string) error {
			if containsArg(args, "up") {
				return errors.New("healthcheck timeout")
			}
			return nil
		},
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("a failed up must return an error")
	}
	if present, _ := varlib.MarkerPresent(); !present {
		t.Error("marker must remain after a failed up")
	}
}

func TestReconcileMarkerRemovalFailureStillSucceeds(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	orig := removeMarkerFn
	removeMarkerFn = func() error { return errors.New("boom") }
	defer func() { removeMarkerFn = orig }()
	var out, errb bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: &out, Err: &errb, In: strings.NewReader("y\n")}
	if err := app.reconcile(context.Background(), false); err != nil {
		t.Fatalf("marker-removal failure after a successful apply must NOT fail reconcile: %v", err)
	}
	if !strings.Contains(errb.String(), "warning:") || !strings.Contains(errb.String(), "could not clear the apply-pending marker") {
		t.Errorf("expected a WARNING about the marker (spec §4.1 step 6f); got %q", errb.String())
	}
	if !strings.Contains(out.String(), "reconciled to this CLI's stack definition") {
		t.Errorf("success line still expected: %q", out.String())
	}
}

func TestReconcilePromptDeclineAborts(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: strings.NewReader("n\n")}
	if err := app.reconcile(context.Background(), false); err == nil {
		t.Fatal("a 'n' answer must abort")
	}
	if idxOfCall(fr.Calls, joinHas("up -d")) >= 0 {
		t.Error("no up after a declined prompt")
	}
	got, _ := os.ReadFile(dir + "/docker-compose.yml")
	if bytes.Equal(got, compose.ComposeYAML) {
		t.Error("no re-materialize after a declined prompt")
	}
	if present, _ := varlib.MarkerPresent(); present {
		t.Error("no marker after a declined prompt")
	}
}

func TestReconcileYesSkipsPrompt(t *testing.T) {
	varlibReady(t)
	dir := installedDeployment(t, false)
	fr := &compose.FakeRunner{OutputFunc: func([]string) (string, error) { return "c\n", nil }}
	// In is EMPTY: with --yes, reconcile must not read a prompt and must proceed.
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: io.Discard, Err: io.Discard, In: bytes.NewReader(nil)}
	if err := app.reconcile(context.Background(), true); err != nil {
		t.Fatalf("--yes must proceed without a prompt: %v", err)
	}
	if idxOfCall(fr.Calls, joinHas("up -d --wait --pull never")) < 0 {
		t.Errorf("--yes must proceed to up: %v", fr.Calls)
	}
}
