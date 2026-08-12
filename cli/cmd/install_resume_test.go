package cmd

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// helper: a fake runner whose `volume ls --filter name=^X$ --quiet` reports the
// named volumes present (VolumeExists prints the name when present, nothing when
// absent). Everything else (docker/compose version preflight) returns OK.
func runnerWithVolumes(present map[string]bool) *compose.FakeRunner {
	return &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if len(args) >= 2 && args[0] == "volume" && args[1] == "ls" {
			for _, a := range args {
				if name := strings.TrimSuffix(strings.TrimPrefix(a, "name=^"), "$"); name != a && present[name] {
					return name + "\n", nil
				}
			}
			return "", nil
		}
		return "", nil
	}}
}

type noSuch struct{}

func (n *noSuch) Error() string { return "no such volume" }

func TestResumeReusesSecrets(t *testing.T) {
	dir := t.TempDir()
	// seed a complete prior install: state + .env
	config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"})
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "OLD_SECRET==", "oldhex")
	os.WriteFile(filepath.Join(dir, ".env"), []byte(config.RenderEnv(env)), 0o600)

	f := &compose.FakeRunner{}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstall(context.Background(), installOpts{Domain: "ignored.example.edu", AdminEmail: "new@x.edu", Version: "v9"}); err != nil {
		t.Fatal(err)
	}
	m, _ := config.ReadEnvFile(dir)
	if m["MATHION_SECRET_KEY"] != "OLD_SECRET==" || m["POSTGRES_PASSWORD"] != "oldhex" {
		t.Fatalf("resume regenerated secrets: %v", m)
	}
}

func TestFailClosedOnMissingState(t *testing.T) {
	dir := t.TempDir()
	// .env present but NO install-state → abort, no regen
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_SECRET_KEY=x\n"), 0o600)
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil || !strings.Contains(err.Error(), "install-state") {
		t.Fatalf("expected fail-closed on missing state, got %v", err)
	}
}

func TestDanglingEnvSymlinkFailsClosed(t *testing.T) {
	dir := t.TempDir()
	// .env is a symlink whose target does not exist. os.Stat(.env) would return
	// ENOENT (following the link) and a Stat-based check would treat it as "absent"
	// → fresh install → regenerated secrets. The dispatcher must instead treat the
	// broken symlink as present-but-not-a-regular-file and fail closed.
	if err := os.Symlink(filepath.Join(dir, "nonexistent-target"), filepath.Join(dir, ".env")); err != nil {
		t.Fatal(err)
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("dangling .env symlink must fail closed, got %v", err)
	}
	// no fresh install ran: .env must still be the dangling symlink, never replaced
	// by a regular file full of freshly-generated secrets.
	fi, lerr := os.Lstat(filepath.Join(dir, ".env"))
	if lerr != nil || fi.Mode()&os.ModeSymlink == 0 {
		t.Fatalf(".env should remain the dangling symlink, got mode=%v err=%v", fi.Mode(), lerr)
	}
}

func TestVolumeGuardBlocksFreshOverExistingVolume(t *testing.T) {
	dir := t.TempDir() // no .env, no state → provisionally fresh
	f := runnerWithVolumes(map[string]bool{"mathion_prod_mathion_pgdata": true})
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil {
		t.Fatal("volume guard must abort a fresh install when a fixed-project volume exists")
	}
	// NO secret written
	if _, e := os.Stat(filepath.Join(dir, ".env")); e == nil {
		t.Fatal(".env was written despite the volume guard aborting")
	}
}

func TestVolumeGuardFailsClosedOnDockerError(t *testing.T) {
	dir := t.TempDir() // no .env, no state → provisionally fresh
	// docker/compose version preflight OK, but the volume check itself errors.
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if len(args) >= 2 && args[0] == "volume" && args[1] == "ls" {
			return "", &noSuch{}
		}
		return "", nil
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil {
		t.Fatal("volume guard must fail closed when the docker volume check errors")
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e == nil {
		t.Fatal(".env was written despite the volume check erroring")
	}
}

func TestResumeFailsClosedOnLooseEnvPerms(t *testing.T) {
	dir := t.TempDir()
	config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"})
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "S==", "hex")
	envPath := filepath.Join(dir, ".env")
	os.WriteFile(envPath, []byte(config.RenderEnv(env)), 0o600)
	os.Chmod(envPath, 0o644) // force group/world-readable regardless of umask
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil || !strings.Contains(err.Error(), "group/world") {
		t.Fatalf("resume must reject a group/world-accessible .env, got %v", err)
	}
}

func TestResumeFailsClosedOnIncompleteEnv(t *testing.T) {
	dir := t.TempDir()
	config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"})
	// readable + 0600, but missing MATHION_DATABASE_URL/BASE_URL/VERSION coupling
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_SECRET_KEY=x\nPOSTGRES_PASSWORD=hex\n"), 0o600)
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu", AdminEmail: "a@b.edu"})
	if err == nil || !strings.Contains(err.Error(), "incomplete or inconsistent") {
		t.Fatalf("resume must reject an incomplete .env, got %v", err)
	}
}

func TestInstallRequiresBothFlags(t *testing.T) {
	dir := t.TempDir() // no .env, no state → fresh path
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: os.Stdout, Err: os.Stderr}
	err := app.runInstall(context.Background(), installOpts{Domain: "d.edu"}) // admin-email omitted
	if err == nil || !strings.Contains(err.Error(), "requires --domain and --admin-email") {
		t.Fatalf("install must require both flags regardless of --yes, got %v", err)
	}
	if _, e := os.Stat(filepath.Join(dir, ".env")); e == nil {
		t.Fatal(".env written despite a missing required flag")
	}
}

// --- Task 26: resume hardening (volume-gated pull, --pull never, always-migrate) ---

// hasBareArg reports whether any recorded call has an argv element exactly == arg.
// Distinguishes the bare `pull` subcommand from the `--pull never` flag pair.
func hasBareArg(calls [][]string, arg string) bool {
	for _, c := range calls {
		for _, a := range c {
			if a == arg {
				return true
			}
		}
	}
	return false
}

// seedValidResume writes a complete prior install (install-state + a 0600 .env that
// passes ValidateEnvComplete) into a fresh dir so runInstall takes the resume path.
func seedValidResume(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	config.WriteState(dir, config.State{Schema: 1, AdminEmail: "you@example.edu"})
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "S==", "hex")
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(config.RenderEnv(env)), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

// runResumeWith seeds a valid resume and drives runInstall down the resume path
// with the given runner, asserting the resume itself returns nil (B1-B4 all expect
// a nil-returning resume — even the fail-closed volume-check error PROCEEDS). The
// caller then inspects f.Calls.
func runResumeWith(t *testing.T, f *compose.FakeRunner) {
	t.Helper()
	dir := seedValidResume(t)
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: f, Out: os.Stdout, Err: os.Stderr}
	if err := app.runInstall(context.Background(), installOpts{Domain: "ignored", AdminEmail: "x@x.edu"}); err != nil {
		t.Fatalf("resume must return nil; got %v", err)
	}
}

// TestResumePgdataPresentSkipsPullStillMigrates: the pgdata volume already exists,
// so the image was obtained by the prior attempt — resume issues NO bare `pull`,
// its `up` carries --pull never, and it still runs the idempotent migrate.
func TestResumePgdataPresentSkipsPullStillMigrates(t *testing.T) {
	f := runnerWithVolumes(map[string]bool{"mathion_prod_mathion_pgdata": true})
	runResumeWith(t, f)
	if hasBareArg(f.Calls, "pull") {
		t.Fatalf("pgdata present must skip the bare `pull`; calls=%v", f.Calls)
	}
	if !hasCall(f.Calls, joinHas("up -d --wait --pull never")) {
		t.Fatalf("resume `up` must carry --pull never; calls=%v", f.Calls)
	}
	if !hasCall(f.Calls, joinHas("alembic upgrade head")) {
		t.Fatalf("resume must still run the idempotent migrate; calls=%v", f.Calls)
	}
}

// TestResumeAfterCrashBeforeMigrateCompletes: a fresh install that crashed after
// `compose up` (pgdata volume created) but before migrate. The retry sees the
// volume present (image already obtained), so it does NO pull and still runs the
// migrate to completion.
func TestResumeAfterCrashBeforeMigrateCompletes(t *testing.T) {
	f := runnerWithVolumes(map[string]bool{"mathion_prod_mathion_pgdata": true})
	runResumeWith(t, f)
	if hasBareArg(f.Calls, "pull") {
		t.Fatalf("a crash-recovery retry must not re-pull; calls=%v", f.Calls)
	}
	if !hasCall(f.Calls, joinHas("alembic upgrade head")) {
		t.Fatalf("the retry must run the migrate to completion; calls=%v", f.Calls)
	}
}

// TestResumePgdataAbsentAllowsPull: pgdata is positively absent (FakeRunner's
// volume ls -> "" -> absent), so the prior attempt died before `up` — a bare
// `pull` IS allowed, and the `up` still carries --pull never.
func TestResumePgdataAbsentAllowsPull(t *testing.T) {
	f := &compose.FakeRunner{}
	runResumeWith(t, f)
	if !hasBareArg(f.Calls, "pull") {
		t.Fatalf("a positively-absent pgdata must allow the pull; calls=%v", f.Calls)
	}
	if !hasCall(f.Calls, joinHas("up -d --wait --pull never")) {
		t.Fatalf("resume `up` must carry --pull never even when pulling; calls=%v", f.Calls)
	}
}

// TestResumeVolumeCheckErrorFailsClosed: the volume-existence check itself errors,
// so resume fails CLOSED (treat as present) — it PROCEEDS (nil err, does not
// abort), issues no pull, and still runs the migrate.
func TestResumeVolumeCheckErrorFailsClosed(t *testing.T) {
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		if len(args) >= 2 && args[0] == "volume" && args[1] == "ls" {
			return "", &noSuch{}
		}
		return "", nil
	}}
	runResumeWith(t, f)
	if hasBareArg(f.Calls, "pull") {
		t.Fatalf("a volume-check error must fail closed (no pull); calls=%v", f.Calls)
	}
	if !hasCall(f.Calls, joinHas("alembic upgrade head")) {
		t.Fatalf("the migrate must still run when the volume check fails closed; calls=%v", f.Calls)
	}
}

// TestInstallRefusesOnBreadcrumb: install is in the refuse set, so a leftover
// recovery breadcrumb makes its RunE refuse (non-nil error) BEFORE reaching
// runInstall — no `up`, no `pull` — and the breadcrumb is retained (install never
// clears it). No flags needed: the guard refuses before flag validation.
func TestInstallRefusesOnBreadcrumb(t *testing.T) {
	rootedVarlib(t)
	seedBreadcrumb(t)
	f := &compose.FakeRunner{}
	var errb bytes.Buffer
	app := &App{CfgDir: t.TempDir(), Project: "mathion_prod", Runner: f, Err: &errb}
	cmd := newInstallCmd(app)
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Fatal("install must refuse on a leftover recovery breadcrumb")
	}
	if hasCall(f.Calls, joinHas("up -d")) || hasBareArg(f.Calls, "pull") {
		t.Fatalf("install must not reach runInstall on a breadcrumb; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("install must retain the breadcrumb (never clears it)")
	}
}
