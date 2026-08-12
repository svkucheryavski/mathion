package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// TestUpdateGuardPreconditionValidatesEnv: a broken/incomplete .env aborts BEFORE
// any docker call — ValidateEnvComplete precedes every mutation.
func TestUpdateGuardPreconditionValidatesEnv(t *testing.T) {
	cfg := setupBackupEnv(t) // minimal .env → ValidateEnvComplete FAILS
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err == nil {
		t.Fatal("expected non-nil error from incomplete .env precondition")
	}
	if len(f.Calls) != 0 {
		t.Fatalf("no docker call must precede the env check; got %v", f.Calls)
	}
}

// TestUpdateGuardSameTagJSONMatch: target == active tag and /version returns the
// exact JSON {"version":<tag>} → exit 0 "already at <tag>", NO docker pull.
func TestUpdateGuardSameTagJSONMatch(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"v0.1.1"}`))
	})
	f := &compose.FakeRunner{}
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true}); err != nil {
		t.Fatalf("same-tag JSON match must return nil; got %v", err)
	}
	if !strings.Contains(out.String(), "already at v0.1.1") {
		t.Fatalf("want \"already at v0.1.1\" in output; got %q", out.String())
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("same-tag guard must NOT pull; got %v", f.Calls)
	}
}

// TestUpdateGuardSameTagLegacyNotSupported: target == active tag but /version is a
// legacy 200 text/html SPA shell → strict probe fails → exit 0 "not supported",
// NO docker pull.
func TestUpdateGuardSameTagLegacyNotSupported(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<!doctype html><html><body>app</body></html>"))
	})
	f := &compose.FakeRunner{}
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true}); err != nil {
		t.Fatalf("same-tag legacy shell must return nil; got %v", err)
	}
	if !strings.Contains(out.String(), "a same-version refresh is not supported") {
		t.Fatalf("want \"a same-version refresh is not supported\" in output; got %q", out.String())
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("same-tag guard must NOT pull; got %v", f.Calls)
	}
}

// TestUpdatePullDistinctTargetCapturesA: a DISTINCT target pulls then image-inspects
// for A, in that order with exact args, and NEVER probes /version.
func TestUpdatePullDistinctTargetCapturesA(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	// Install a counting /version server so any stray probe on a distinct target is
	// caught; a distinct target must never probe.
	n := useGateServer(t, func(w http.ResponseWriter, r *http.Request) {})
	// Steps 5-10 now run to completion, so drive a full valid backup/migrate/recreate
	// and stub the step-10 commit gate to nil so the run returns nil. stubGate replaces
	// gateFn only — NOT probeVersionOnce — so the counting server below still catches a
	// stray guard probe on the distinct-target path (the 0-probe assertion stays live).
	stubGate(t, nil)
	f := update21Fake(t)
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err != nil {
		t.Fatalf("distinct target with a good pull must return nil; got %v", err)
	}
	if got := atomic.LoadInt32(n); got != 0 {
		t.Fatalf("a distinct target must NOT probe /version; got %d probes", got)
	}
	wantPull := []string{"pull", compose.ImageRepo + ":v2.0.0"}
	pullIdx := idxOfCall(f.Calls, isPull)
	if pullIdx < 0 {
		t.Fatalf("expected a pull call; got %v", f.Calls)
	}
	if !reflect.DeepEqual(f.Calls[pullIdx], wantPull) {
		t.Fatalf("pull args = %v; want %v", f.Calls[pullIdx], wantPull)
	}
	wantInspect := []string{"image", "inspect", compose.ImageRepo + ":v2.0.0", "--format", "{{.Id}}"}
	inspectIdx := idxOfCall(f.Calls, func(a []string) bool { return reflect.DeepEqual(a, wantInspect) })
	if inspectIdx < 0 {
		t.Fatalf("expected an image-inspect for A; got %v", f.Calls)
	}
	if !(pullIdx < inspectIdx) {
		t.Fatalf("pull (idx %d) must precede image-inspect (idx %d); calls %v", pullIdx, inspectIdx, f.Calls)
	}
}

// TestUpdatePullBadTagAborts: a failed pull aborts before capturing A — no
// image-inspect for the id is issued, and (trivially) no backup is taken.
func TestUpdatePullBadTagAborts(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	f := &compose.FakeRunner{RunFunc: func(args []string) error { return errors.New("manifest unknown") }}
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v9.9.9", Yes: true}); err == nil {
		t.Fatal("expected non-nil error from a failed pull")
	}
	if hasCall(f.Calls, joinHas("{{.Id}}")) {
		t.Fatalf("a failed pull must abort before the A image-inspect; got %v", f.Calls)
	}
}

// TestUpdateGuardConfirmDeclined: a distinct target with Yes=false and "n" declines
// before the pull.
func TestUpdateGuardConfirmDeclined(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "n\n")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0"}); err == nil {
		t.Fatal("expected non-nil error when the confirm is declined")
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("a declined confirm must NOT pull; got %v", f.Calls)
	}
}

// TestUpdateGuardConfirmNoRollbackClause: the failure clause is branched on
// --no-rollback (both sub-cases decline so the confirm prints then aborts).
func TestUpdateGuardConfirmNoRollbackClause(t *testing.T) {
	t.Run("rollback", func(t *testing.T) {
		cfg := setupRestoreEnv(t)
		f := &compose.FakeRunner{}
		app, out, _ := engineApp(cfg, f, "n\n")
		_ = runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0"})
		if !strings.Contains(out.String(), "auto-rollback on failure") {
			t.Fatalf("want \"auto-rollback on failure\" in output; got %q", out.String())
		}
	})
	t.Run("no-rollback", func(t *testing.T) {
		cfg := setupRestoreEnv(t)
		f := &compose.FakeRunner{}
		app, out, _ := engineApp(cfg, f, "n\n")
		_ = runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", NoRollback: true})
		if !strings.Contains(out.String(), "left as-is; recover with mathion restore") {
			t.Fatalf("want \"left as-is; recover with mathion restore\" in output; got %q", out.String())
		}
	})
}

// --- update steps 5-6b (stop, offline backup, pre-mutation validate, breadcrumb) ---

// update21Fake drives a full Task-21 run to a REAL, prescan-valid auto-backup and a
// resolvable preflight. OutputFunc: ps -q db => "dbcid" (backup precondition), alembic
// current => a rev, then delegate to recordedIDLocalOutput (ps -q app => "", image
// inspect …{{.Id}} => "sha256:rec" [= captured A and manifest ImageID], recorded-id
// inspect => "" present). StreamFunc writes real db.dump bytes + a VALID assets tar.
func update21Fake(t *testing.T) *compose.FakeRunner {
	tarBytes := validAssetsTar(t)
	return &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, "ps -q db"):
				return "dbcid\n", nil
			case strings.Contains(j, "alembic current"):
				return "67e8294b4267 (head)\n", nil
			}
			return recordedIDLocalOutput(args)
		},
		StreamFunc: func(w io.Writer, args []string) error {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, "pg_dump"):
				_, _ = w.Write([]byte("DBDUMP"))
			case strings.Contains(j, "tar -C /data/mathion/assets"):
				_, _ = w.Write(tarBytes)
			}
			return nil
		},
	}
}

// TestUpdate6HappyOrderingAndBreadcrumb pins the whole steps-5..6b spine in one run:
// (a) ordering stop app -> offline backup (pg_dump stream) -> 6a preflight inspect;
// (b) 6a's preflight never retags (no `docker tag` anywhere); (c) the step-6b
// breadcrumb lands with EXACTLY the 7 fields, target_image_id == the captured A.
func TestUpdate6HappyOrderingAndBreadcrumb(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	// Steps 7-10 now exist; a PASSING step-10 gate would clear the very breadcrumb this
	// test inspects. Stub the gate to FAIL so the run stops at step 10 with steps 5-6b
	// already done and the breadcrumb still on disk (the technique the restore
	// PullFlagged tests use to freeze pre-clear state for inspection).
	stubGate(t, errors.New("gate stop"))
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err == nil || !strings.Contains(err.Error(), "gate stop") {
		t.Fatalf("the stubbed step-10 gate failure must surface (freezing the breadcrumb); got %v", err)
	}
	// (a) ordering: stop app -> backup pg_dump stream -> 6a preflight recorded-id inspect
	// (image inspect sha256:rec — unique to the preflight, unlike the pre-stop A-capture
	// inspect which targets ImageRepo:<tag>).
	si := idxOfCall(f.Calls, joinHas("stop app"))
	bi := idxOfCall(f.Calls, joinHas("pg_dump"))
	pi := idxOfCall(f.Calls, joinHas("inspect sha256:rec"))
	if si < 0 || bi < 0 || pi < 0 || !(si < bi && bi < pi) {
		t.Fatalf("bad order stop=%d backup=%d preflight=%d calls=%v", si, bi, pi, f.Calls)
	}
	// (b) 6a's preflight is read-only: no docker tag anywhere.
	if hasCall(f.Calls, isTag) {
		t.Fatalf("update steps 5-6b must never retag; calls=%v", f.Calls)
	}
	// (c) the durable breadcrumb landed with exactly the step-6b fields.
	j, present, err := varlib.ReadJournal()
	if err != nil || !present {
		t.Fatalf("breadcrumb must be present after 6b (present=%v err=%v)", present, err)
	}
	if j.Schema != 1 || j.Kind != "update" || j.OldTag != "v0.1.1" || j.TargetTag != "v2.0.0" || j.TargetImageID != "sha256:rec" {
		t.Fatalf("breadcrumb fields = %+v", j)
	}
	if j.CreatedAt == "" {
		t.Fatal("breadcrumb created_at must be set")
	}
	if j.BackupPath == "" || !strings.HasPrefix(j.BackupPath, varlib.BackupsDir()) {
		t.Fatalf("breadcrumb backup_path = %q, want a managed backups-dir path", j.BackupPath)
	}
}

// TestUpdate6aValidateFailStartsApp: the auto-backup's inner assets.tar is garbage, so
// 6a's PrescanAssets rejects the rollback point BEFORE any mutation — a clean abort
// that (i) starts app back up, (ii) writes NO breadcrumb, (iii) never retags. The
// parent ctx is pre-cancelled, so the start-app must run under context.WithoutCancel
// (its CtxSnap is LIVE) while the earlier stop-app snapshotted the cancelled parent.
func TestUpdate6aValidateFailStartsApp(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	// Corrupt the auto-backup's inner assets.tar so 6a's PrescanAssets fails.
	f.StreamFunc = func(w io.Writer, args []string) error {
		j := strings.Join(args, " ")
		switch {
		case strings.Contains(j, "pg_dump"):
			_, _ = w.Write([]byte("DBDUMP"))
		case strings.Contains(j, "tar -C /data/mathion/assets"):
			_, _ = w.Write([]byte("ASSETS")) // GARBAGE -> invalid inner tar
		}
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(ctx, app, updateOpts{Version: "v2.0.0", Yes: true}); err == nil {
		t.Fatal("6a must reject an invalid inner assets.tar")
	}
	if !hasCall(f.Calls, joinHas("start app")) {
		t.Fatalf("a 6a failure must start app; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("a 6a failure must not write a breadcrumb (nothing mutated)")
	}
	if hasCall(f.Calls, isTag) {
		t.Fatalf("6a must never retag; calls=%v", f.Calls)
	}
	// WithoutCancel proof: start app ran on a LIVE ctx though the parent was cancelled.
	sti := idxOfCall(f.Calls, joinHas("start app"))
	spi := idxOfCall(f.Calls, joinHas("stop app"))
	if f.CtxSnaps[sti].Err != nil {
		t.Fatalf("start app must run under context.WithoutCancel (live ctx); got Err=%v", f.CtxSnaps[sti].Err)
	}
	if f.CtxSnaps[spi].Err == nil {
		t.Fatal("stop app should have snapshotted the CANCELLED parent ctx")
	}
}

// TestUpdateBackupFailStartsApp: backupEngine's db-running precondition fails (ps -q db
// => ""), so step 6 aborts with "start the stack first". The engine must start app back
// up and write NO breadcrumb.
func TestUpdateBackupFailStartsApp(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			if strings.Contains(strings.Join(args, " "), "ps -q db") {
				return "", nil // backupEngine => "start the stack first"
			}
			return recordedIDLocalOutput(args)
		},
	}
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err == nil {
		t.Fatal("a backup precondition failure must abort")
	}
	if !hasCall(f.Calls, joinHas("start app")) {
		t.Fatalf("a step-6 backup failure must start app; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("a step-6 backup failure must not write a breadcrumb")
	}
}

// TestUpdate6bWriteFailStartsApp: backup + 6a succeed, but the 6b breadcrumb write
// fails (stubbed seam). That is a PRE-mutation abort: the error surfaces (carrying the
// write failure), app is started back up, and no breadcrumb persists.
func TestUpdate6bWriteFailStartsApp(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	prev := writeJournalFn
	writeJournalFn = func(varlib.Journal) error { return errors.New("fsync failed") }
	t.Cleanup(func() { writeJournalFn = prev })
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true})
	if err == nil || !strings.Contains(err.Error(), "fsync failed") {
		t.Fatalf("a 6b write failure must surface; got %v", err)
	}
	if !hasCall(f.Calls, joinHas("start app")) {
		t.Fatalf("a 6b write failure must start app; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("a failed 6b write must persist no breadcrumb")
	}
}

// --- update steps 7-10 (migrate, re-pin, recreate, strict gate = commit point) ---

// captureGate records the args the engine passes to the step-10 gate seam and returns
// ret; restores the previous gateFn on cleanup.
func captureGate(t *testing.T, ret error) *struct {
	ID, Ver        string
	Strict, Called bool
} {
	t.Helper()
	c := &struct {
		ID, Ver        string
		Strict, Called bool
	}{}
	prev := gateFn
	gateFn = func(_ context.Context, _ *App, id, ver string, strict bool) error {
		c.ID, c.Ver, c.Strict, c.Called = id, ver, strict, true
		return ret
	}
	t.Cleanup(func() { gateFn = prev })
	return c
}

// TestUpdateMigrateRunEnvTargetOnly pins step 7: the migrate one-off runs via the
// env-aware RunEnv with EXACTLY one env element (MATHION_VERSION=<target>) and nowhere
// else; it carries the deterministic --name/--label + --pull never; it precedes the
// step-9 recreate; and the step-8 re-pin took only after migrate succeeded.
func TestUpdateMigrateRunEnvTargetOnly(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	captureGate(t, nil) // pass the gate so the whole run completes
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err != nil {
		t.Fatalf("a full happy-path update must return nil; got %v", err)
	}
	// (a) EXACTLY one *Env call — the migrate one-off — carrying ONLY the target env
	// (backupEngine + preflight use no *Env call).
	if len(f.EnvCalls) != 1 {
		t.Fatalf("want exactly one Env call (migrate); got %d: %v", len(f.EnvCalls), f.EnvCalls)
	}
	if want := []string{"MATHION_VERSION=v2.0.0"}; !reflect.DeepEqual(f.EnvCalls[0], want) {
		t.Fatalf("migrate env = %v; want %v", f.EnvCalls[0], want)
	}
	// (b) the migrate argv carries the deterministic --name/--label + --pull never.
	mi := idxOfCall(f.Calls, joinHas("alembic upgrade head"))
	if mi < 0 {
		t.Fatalf("expected a migrate call; got %v", f.Calls)
	}
	migrate := f.Calls[mi]
	worker := fmt.Sprintf("mathion_migrate_%d", os.Getpid())
	for _, tok := range []string{"--name", worker, "--label", "io.mathion.worker=1", "--pull", "never"} {
		if !slices.Contains(migrate, tok) {
			t.Fatalf("migrate call missing %q; got %v", tok, migrate)
		}
	}
	// (c) ordering: migrate precedes the step-9 recreate.
	ri := idxOfCall(f.Calls, joinHas("up -d --wait --pull never app"))
	if ri < 0 || !(mi < ri) {
		t.Fatalf("migrate (idx %d) must precede recreate (idx %d); calls %v", mi, ri, f.Calls)
	}
	// (d) step-8 re-pin took (only after migrate) — .env now pins the target.
	env, err := config.ReadEnvFile(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if env["MATHION_VERSION"] != "v2.0.0" {
		t.Fatalf("re-pin: MATHION_VERSION = %q; want v2.0.0", env["MATHION_VERSION"])
	}
}

// TestUpdateGatePassCommits pins step 10: the strict gate is wired with the captured A
// as the target id, the target version, and strictVersion=true; a PASS is the commit
// point — the breadcrumb is cleared and the success line printed.
func TestUpdateGatePassCommits(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	c := captureGate(t, nil)
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err != nil {
		t.Fatalf("a passing gate must commit and return nil; got %v", err)
	}
	// Gate WIRING: strict, id == the captured A ("sha256:rec"), version == target.
	if !c.Called || c.ID != "sha256:rec" || c.Ver != "v2.0.0" || !c.Strict {
		t.Fatalf("gate wiring = %+v; want Called id=sha256:rec ver=v2.0.0 strict=true", c)
	}
	// COMMIT: the breadcrumb is cleared on the gate pass.
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("a passing gate must clear the recovery breadcrumb")
	}
	if !strings.Contains(out.String(), "updated v0.1.1 → v2.0.0 (backup: ") {
		t.Fatalf("want the commit success line; got %q", out.String())
	}
}

// TestUpdateGatePostRemoveWarns: the gate passes but the post-commit RemoveJournal
// fails (the gate stub turns the backups dir read-only exactly when it runs). That is a
// DISTINCT non-rollback warning — the update stays committed (no restore, not exit 3),
// the breadcrumb is left in place, and the operator is told to remove it manually.
func TestUpdateGatePostRemoveWarns(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("mode 0500 does not block a root unlink")
	}
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	// Side-effect gate: read-only the backups dir AFTER 6b wrote the breadcrumb and
	// BEFORE the post-gate unlink, so RemoveJournal's os.Remove fails.
	prev := gateFn
	gateFn = func(context.Context, *App, string, string, bool) error {
		_ = os.Chmod(varlib.BackupsDir(), 0o500)
		return nil
	}
	t.Cleanup(func() { _ = os.Chmod(varlib.BackupsDir(), 0o700); gateFn = prev })
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true})
	if err == nil || !strings.Contains(err.Error(), "could not remove the recovery breadcrumb") {
		t.Fatalf("a failed post-gate breadcrumb clear must warn; got %v", err)
	}
	// The unlink failed → the breadcrumb is STILL present (no rollback deleted it).
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("a failed clear must leave the breadcrumb in place")
	}
	// Guard against an accidental rollback: this task never restores.
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("this task never rolls back; got a restore call: %v", f.Calls)
	}
}

// --- update failure matrix (auto-rollback / --no-rollback / interrupt / exit-3) ---

// strictDiscriminatingGate stubs gateFn so update's FORWARD gate (strict=true) FAILS
// while the auto-rollback's own gate (strict=false) PASSES — a single seam that makes
// update fail its commit gate yet lets the rewind's non-strict gate succeed.
func strictDiscriminatingGate(t *testing.T) {
	t.Helper()
	prev := gateFn
	gateFn = func(_ context.Context, _ *App, _, _ string, strict bool) error {
		if strict {
			return errors.New("gate mismatch")
		}
		return nil
	}
	t.Cleanup(func() { gateFn = prev })
}

// TestUpdateRollbackOnGateFailRecovers: a clean step-10 gate failure (ctx live) auto-
// rolls-back IN-PROCESS to the just-taken backup under a fresh ctx — reaping the migrate
// one-off, reverting .env to the pre-update tag, and clearing the breadcrumb — and
// returns a plain "rolled back" error (NOT a rollbackFailedError).
func TestUpdateRollbackOnGateFailRecovers(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	strictDiscriminatingGate(t)
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true})
	// (a) non-nil, "rolled back", and NOT a rollbackFailedError.
	if err == nil || !strings.Contains(err.Error(), "rolled back") {
		t.Fatalf("want a \"rolled back\" error; got %v", err)
	}
	var rbf rollbackFailedError
	if errors.As(err, &rbf) {
		t.Fatalf("a recovered rollback must NOT be a rollbackFailedError; got %v", err)
	}
	// (b) the migrate one-off was force-removed.
	if !hasCall(f.Calls, joinHas("rm -f mathion_migrate_")) {
		t.Fatalf("the migrate one-off must be force-removed; calls=%v", f.Calls)
	}
	// (c) the rollback ran in-process (the named restore db worker appears).
	if !hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("the auto-rollback must run the in-process restore; calls=%v", f.Calls)
	}
	// (d) the breadcrumb is gone (cleared after the rewind).
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("a recovered rollback must clear the breadcrumb")
	}
	// (e) .env was reverted to the pre-update tag (the rollback undid step-8's re-pin).
	env, rerr := config.ReadEnvFile(cfg)
	if rerr != nil {
		t.Fatal(rerr)
	}
	if env["MATHION_VERSION"] != "v0.1.1" {
		t.Fatalf("rollback must revert .env to v0.1.1; got %q", env["MATHION_VERSION"])
	}
	// (f) the migrate ran with EXACTLY the deliberate sanitized-env override, exactly once
	// (the cmd-level sanitized-env guard; the rollback's assets load adds its OWN
	// MATHION_VERSION=v0.1.1 env, which must not be miscounted).
	count := 0
	for _, ec := range f.EnvCalls {
		if reflect.DeepEqual(ec, []string{"MATHION_VERSION=v2.0.0"}) {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("want exactly one migrate Env call [MATHION_VERSION=v2.0.0]; got %d in %v", count, f.EnvCalls)
	}
}

// TestUpdateRollbackNoRollbackLeavesState: with --no-rollback a step-7 migrate failure
// leaves the deployment as-is — no auto-rollback, breadcrumb retained, the manual-
// recovery hint returned — but the migrate one-off is still reaped.
func TestUpdateRollbackNoRollbackLeavesState(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	f.RunFunc = func(args []string) error {
		if strings.Contains(strings.Join(args, " "), "alembic upgrade head") {
			return errors.New("migrate boom")
		}
		return nil
	}
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true, NoRollback: true})
	if err == nil || !strings.Contains(err.Error(), "--no-rollback is set") || !strings.Contains(err.Error(), "mathion restore -- ") {
		t.Fatalf("want a --no-rollback leave-as-is error with the restore hint; got %v", err)
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("--no-rollback must NOT auto-rollback; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("--no-rollback must leave the breadcrumb in place")
	}
	if !hasCall(f.Calls, joinHas("rm -f mathion_migrate_")) {
		t.Fatalf("the migrate one-off must still be reaped; calls=%v", f.Calls)
	}
}

// TestUpdateRollbackAlsoFailsExit3: the update fails (gate) AND the auto-rollback's DB
// load ALSO fails → a rollbackFailedError (exit 3) whose message names the UNKNOWN
// state, with the breadcrumb LEFT IN PLACE (the deployment is unrecovered).
func TestUpdateRollbackAlsoFailsExit3(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	strictDiscriminatingGate(t)
	f.StreamInFunc = func(io.Reader, []string) error { return errors.New("restore db boom") }
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true})
	var rbf rollbackFailedError
	if !errors.As(err, &rbf) {
		t.Fatalf("a failed rollback must return a rollbackFailedError; got %v", err)
	}
	if !strings.Contains(err.Error(), "UNKNOWN state") {
		t.Fatalf("want the UNKNOWN-state message; got %v", err)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("an unrecovered rollback must leave the breadcrumb in place")
	}
}

// TestUpdateSignalRefusesOnInterrupt: a cancelled ctx (the state after the first signal
// cancelled it) makes the failure handler REFUSE — reap the migrate one-off, then leave
// the breadcrumb + failed state and return the manual-recovery hint, with NO auto-
// rollback. (The FakeRunner ignores ctx, so steps 5-6b still run; the handler's
// ctx.Err()!=nil branch is the unit under test.)
func TestUpdateSignalRefusesOnInterrupt(t *testing.T) {
	cfg := setupRestoreEnv(t)
	f := update21Fake(t)
	f.RunFunc = func(args []string) error {
		if strings.Contains(strings.Join(args, " "), "alembic upgrade head") {
			return errors.New("migrate boom")
		}
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	app, _, _ := engineApp(cfg, f, "")
	err := runUpdate(ctx, app, updateOpts{Version: "v2.0.0", Yes: true})
	if err == nil || !strings.Contains(err.Error(), "interrupted") || !strings.Contains(err.Error(), "mathion restore -- ") {
		t.Fatalf("want an interrupted refusal with the restore hint; got %v", err)
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("an interrupt must NOT auto-rollback; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("an interrupt must leave the breadcrumb in place")
	}
	if !hasCall(f.Calls, joinHas("rm -f mathion_migrate_")) {
		t.Fatalf("the migrate one-off must be reaped on interrupt; calls=%v", f.Calls)
	}
}
