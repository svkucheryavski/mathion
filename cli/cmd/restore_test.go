package cmd

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// assertNoPullOrTag enforces that step 4a stayed READ-ONLY: no docker call may be
// a `pull` (which would move the :version tag) or a `tag`. Every preflight test
// asserts this over the full call log.
func assertNoPullOrTag(t *testing.T, calls [][]string) {
	t.Helper()
	for _, c := range calls {
		for _, arg := range c {
			if arg == "pull" || arg == "tag" {
				t.Fatalf("preflight must be read-only, found %q in call %v", arg, c)
			}
		}
	}
}

// TestPreflightImageRecordedIDLocal: the recorded image_id is locally present, so
// the recorded-id-first probe hits and short-circuits — no tag inspect at all.
func TestPreflightImageRecordedIDLocal(t *testing.T) {
	m := archive.Manifest{ImageID: "sha256:recorded", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			// The tag inspect (contains the repo) must NEVER be reached here; if it
			// is, returning a different id would fail the RID assertion below.
			if strings.Contains(strings.Join(args, " "), compose.ImageRepo) {
				return "sha256:tagid\n", nil
			}
			return "", nil // recorded-id inspect succeeds
		},
	}
	res, err := preflightImage(context.Background(), newTestApp(f), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.RID != "sha256:recorded" {
		t.Fatalf("RID = %q, want %q", res.RID, "sha256:recorded")
	}
	if res.PullFlagged {
		t.Fatalf("PullFlagged = true, want false")
	}
	if len(f.Calls) != 1 {
		t.Fatalf("recorded-id-first must short-circuit; calls = %v", f.Calls)
	}
	assertNoPullOrTag(t, f.Calls)
}

// TestPreflightImageOnlyTagLocal: no recorded id (image_id empty), so the tag
// inspect resolves the local id and no warning is possible.
func TestPreflightImageOnlyTagLocal(t *testing.T) {
	m := archive.Manifest{ImageID: "", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			if strings.Contains(strings.Join(args, " "), compose.ImageRepo) {
				return "sha256:tagid\n", nil
			}
			return "", errors.New("no such image")
		},
	}
	res, err := preflightImage(context.Background(), newTestApp(f), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.RID != "sha256:tagid" {
		t.Fatalf("RID = %q, want %q", res.RID, "sha256:tagid")
	}
	if res.PullFlagged {
		t.Fatalf("PullFlagged = true, want false")
	}
	assertNoPullOrTag(t, f.Calls)
}

// TestPreflightImageBothAbsent: neither the recorded id nor the local tag is
// present, so the pull is flagged for the later (post-confirmation) step — 4a
// itself issues no pull/tag.
func TestPreflightImageBothAbsent(t *testing.T) {
	m := archive.Manifest{ImageID: "sha256:recorded", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			return "", errors.New("no such image")
		},
	}
	res, err := preflightImage(context.Background(), newTestApp(f), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.PullFlagged {
		t.Fatalf("PullFlagged = false, want true")
	}
	if res.RID != "" {
		t.Fatalf("RID = %q, want empty", res.RID)
	}
	assertNoPullOrTag(t, f.Calls)
}

// TestPreflightImageWarnOnDiffer: the recorded id is not local but the local tag
// resolves to a DIFFERENT id — restore will boot the local tag's image, so 4a
// emits a loud warning to a.Err and still returns the tag's id.
func TestPreflightImageWarnOnDiffer(t *testing.T) {
	m := archive.Manifest{ImageID: "sha256:recorded", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			if strings.Contains(strings.Join(args, " "), compose.ImageRepo) {
				return "sha256:different\n", nil
			}
			return "", errors.New("no such image") // recorded id NOT local
		},
	}
	var errb bytes.Buffer
	app := &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f, Err: &errb}
	res, err := preflightImage(context.Background(), app, m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.RID != "sha256:different" {
		t.Fatalf("RID = %q, want %q", res.RID, "sha256:different")
	}
	if res.PullFlagged {
		t.Fatalf("PullFlagged = true, want false")
	}
	if w := errb.String(); !strings.Contains(w, "warning") || !strings.Contains(w, "differs") {
		t.Fatalf("expected a loud differ warning, got %q", w)
	}
	assertNoPullOrTag(t, f.Calls)
}

// --- restore engine core (Task 16) -----------------------------------------

func mustWrite(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// writeRestoreArchive builds a genuinely-extractable managed archive under dstDir
// via the real archive.Assemble path, so archive.Extract validates it end to end
// (schema/OCI-tag/per-member sha256). Callers pass any manifest fields they need;
// Schema/MathionVersion/SHA256 are filled in consistently.
func writeRestoreArchive(t *testing.T, dstDir string, m archive.Manifest) string {
	t.Helper()
	stg := t.TempDir()
	db := filepath.Join(stg, "db.dump")
	as := filepath.Join(stg, "assets.tar")
	mustWrite(t, db, []byte("DBDUMP"))
	mustWrite(t, as, validAssetsTar(t)) // a real, pre-scan-safe tar: step 3 now scans it
	m.Schema = 1
	if m.MathionVersion == "" {
		m.MathionVersion = "v1.2.3"
	}
	dbH, err := hashFile(db)
	if err != nil {
		t.Fatal(err)
	}
	asH, err := hashFile(as)
	if err != nil {
		t.Fatal(err)
	}
	m.SHA256 = map[string]string{"db.dump": dbH, "assets.tar": asH}
	final, err := archive.Assemble(dstDir, map[string]string{"db.dump": db, "assets.tar": as}, m)
	if err != nil {
		t.Fatal(err)
	}
	return final
}

func engineApp(cfg string, f *compose.FakeRunner, in string) (*App, *bytes.Buffer, *bytes.Buffer) {
	out, errb := &bytes.Buffer{}, &bytes.Buffer{}
	return &App{CfgDir: cfg, Project: "mathion_prod", Runner: f, Out: out, Err: errb, In: strings.NewReader(in)}, out, errb
}

func idxOfCall(calls [][]string, pred func([]string) bool) int {
	for i, c := range calls {
		if pred(c) {
			return i
		}
	}
	return -1
}

func hasCall(calls [][]string, pred func([]string) bool) bool { return idxOfCall(calls, pred) >= 0 }

func head(a []string) string {
	if len(a) > 0 {
		return a[0]
	}
	return ""
}

func isPull(a []string) bool  { return head(a) == "pull" }
func isTag(a []string) bool   { return head(a) == "tag" }
func isStart(a []string) bool { return head(a) == "start" }

func joinHas(sub string) func([]string) bool {
	return func(a []string) bool { return strings.Contains(strings.Join(a, " "), sub) }
}

const (
	callPsApp  = "ps -q app"
	callUpDB   = "up -d --pull never db"
	callStop   = "stop app"
	managedTag = "v1.2.3"
)

// managedCaps is a generous, non-untrusted tier so the confirmation flow does not
// emit the untrusted-path warning.
var managedCaps = archive.Caps{MaxMember: 1 << 30, MaxTotal: 1 << 30}

// recordedIDLocal makes preflight's recorded-id-first probe hit (RID = the recorded
// id, no pull) and the boot tag already resolve to it (no retag).
func recordedIDLocalOutput(args []string) (string, error) {
	j := strings.Join(args, " ")
	switch {
	case strings.Contains(j, callPsApp):
		return "", nil
	case len(args) >= 2 && args[0] == "image" && args[1] == "inspect" && !strings.Contains(j, "--format"):
		return "", nil // recorded id present locally
	case len(args) >= 2 && args[0] == "image" && args[1] == "inspect":
		return "sha256:rec\n", nil // boot tag already resolves to RID
	}
	return "", nil
}

// setupRestoreEnv is setupBackupEnv's complete-.env sibling: steps 9-10 run
// config.RepinVersion, which re-validates the WHOLE file via ValidateEnvComplete,
// so the minimal .env setupBackupEnv writes (missing SECRET_KEY / DATABASE_URL /
// coupled POSTGRES_* ...) would fail the re-pin. Render a full GenerateEnv set here
// so a restore that reaches step 9 can re-pin cleanly.
func setupRestoreEnv(t *testing.T) string {
	t.Helper()
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	cfg := t.TempDir()
	env := config.GenerateEnv("https://learn.example.edu", "v0.1.1", "SECRET==", "abc123hex")
	if err := os.WriteFile(filepath.Join(cfg, ".env"), []byte(config.RenderEnv(env)), 0o600); err != nil {
		t.Fatal(err)
	}
	return cfg
}

// setupRestoreCmdEnv is setupRestoreEnv plus a COMPLETE install-state, for the
// command-level restore tests that drive newRestoreCmd through the new
// requireInstallComplete gate. Engine-level tests keep using setupRestoreEnv
// (markerless) so an accidental gate inside restoreEngine fails them loudly.
func setupRestoreCmdEnv(t *testing.T) string {
	t.Helper()
	cfg := setupRestoreEnv(t)
	if err := config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "admin@example.edu", Complete: true}); err != nil {
		t.Fatal(err)
	}
	return cfg
}

// TestRestoreCmdRefusesOnIncompleteInstall proves the install-completeness gate is
// wired into newRestoreCmd: with an explicit incomplete marker the command refuses
// BEFORE any engine work. The "did not finish" substring assertion is load-bearing —
// among the ERRORS reachable on this fixture's restore path it originates only in
// requireInstallComplete's incomplete-marker branch, so it distinguishes the gate's
// refusal from SelectLatest's "no backups" error (which the markerless empty backups
// dir would ALSO produce were the gate deleted — a false pass without this check).
// The phrase is not globally unique: version.go's install-incomplete and compose-drift
// notices also contain "did not finish", but those are printed notices, never returned
// errors, and restore never emits them — so none can reach this err.Error().
func TestRestoreCmdRefusesOnIncompleteInstall(t *testing.T) {
	cfg := setupRestoreEnv(t) // markerless; seed incomplete explicitly
	asRoot(t)
	if err := config.WriteState(cfg, config.State{Schema: 2, AdminEmail: "a@b.edu", Complete: false}); err != nil {
		t.Fatal(err)
	}
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.Flags().Set("yes", "true"); err != nil {
		t.Fatal(err)
	}
	err := c.RunE(c, nil)
	if err == nil {
		t.Fatal("restore must refuse on an incomplete install")
	}
	if !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("restore must refuse via the install-completeness gate (error containing %q); got a different error (e.g. SelectLatest's no-backups): %v", "did not finish", err)
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) || hasCall(f.Calls, isPull) {
		t.Fatalf("restore must not touch the engine on refusal; calls=%v", f.Calls)
	}
}

// stubGate replaces the step-10 deployment gate seam with one returning ret, so a
// full-engine test can drive the step-10 outcome without a live app + HTTP server
// (the gate's own logic is covered directly in gate_test.go). Restored on cleanup.
func stubGate(t *testing.T, ret error) {
	t.Helper()
	prev := gateFn
	gateFn = func(context.Context, *App, string, string, bool) error { return ret }
	t.Cleanup(func() { gateFn = prev })
}

// TestRestoreEngineConfirmAccept: typing the project name proceeds through up-db
// then stop-app, in that order.
func TestRestoreEngineConfirmAccept(t *testing.T) {
	cfg := setupRestoreEnv(t)
	stubGate(t, nil)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, CreatedAt: "2026-08-01T00:00:00Z", ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "mathion_prod\n")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{WriteBreadcrumb: true, Caps: managedCaps}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ui := idxOfCall(f.Calls, joinHas(callUpDB))
	si := idxOfCall(f.Calls, joinHas(callStop))
	if ui < 0 || si < 0 || ui >= si {
		t.Fatalf("want up(db) before stop(app); up=%d stop=%d calls=%v", ui, si, f.Calls)
	}
}

// TestRestoreEngineConfirmReject: a wrong confirmation aborts BEFORE any up/stop/
// pull/tag and writes no breadcrumb.
func TestRestoreEngineConfirmReject(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "nope\n")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected a confirmation-mismatch error")
	}
	if hasCall(f.Calls, joinHas(callUpDB)) || hasCall(f.Calls, joinHas(callStop)) {
		t.Fatalf("declined restore must not touch the stack; calls=%v", f.Calls)
	}
	if hasCall(f.Calls, isPull) || hasCall(f.Calls, isTag) {
		t.Fatalf("declined restore must not pull/tag; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("declined restore must not write a breadcrumb")
	}
}

// pullFlaggedRunner drives a both-absent preflight (=> pull-flagged) whose boot-tag
// inspect only succeeds AFTER a pull has run, mirroring how a real pull assigns the
// <v> tag. onStop, if set, runs inside the stop-app call (used to cancel ctx).
func pullFlaggedRunner(psApp, health string, pullErr error, onStop func()) *compose.FakeRunner {
	f := &compose.FakeRunner{}
	pulled := false
	f.OutputFunc = func(args []string) (string, error) {
		j := strings.Join(args, " ")
		switch {
		case strings.Contains(j, callPsApp):
			return psApp, nil
		case len(args) > 0 && args[0] == "inspect":
			return health, nil
		case len(args) >= 2 && args[0] == "image" && args[1] == "inspect":
			if pulled {
				return "sha256:pulled\n", nil
			}
			return "", errors.New("no such image")
		}
		return "", nil
	}
	f.RunFunc = func(args []string) error {
		switch {
		case strings.Contains(strings.Join(args, " "), callStop):
			if onStop != nil {
				onStop()
			}
			return nil
		case isPull(args):
			if pullErr != nil {
				return pullErr
			}
			pulled = true
			return nil
		}
		return nil
	}
	return f
}

// TestRestoreEngineOrdering: 4a -> confirm(bypassed) -> capture -> up db -> stop app
// -> pull, in that order, with a breadcrumb landing before the pull.
func TestRestoreEngineOrdering(t *testing.T) {
	cfg := setupRestoreEnv(t)
	stubGate(t, nil)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := pullFlaggedRunner("appcid\n", "true healthy\n", nil, nil)
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	psi := idxOfCall(f.Calls, joinHas(callPsApp))
	ui := idxOfCall(f.Calls, joinHas(callUpDB))
	si := idxOfCall(f.Calls, joinHas(callStop))
	pi := idxOfCall(f.Calls, isPull)
	if psi < 0 || ui < 0 || si < 0 || pi < 0 || !(psi < ui && ui < si && si < pi) {
		t.Fatalf("bad order psi=%d ui=%d si=%d pi=%d calls=%v", psi, ui, si, pi, f.Calls)
	}
	// (The trailing "breadcrumb present after" assertion is gone: a successful
	// restore now clears its breadcrumb at step 10. The ordering above is the point.)
}

// TestRestoreEnginePullFlaggedFinalize: the breadcrumb is written with an absent
// target_image_id, then finalized to the pulled id on pull success; no retag runs.
func TestRestoreEnginePullFlaggedFinalize(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := pullFlaggedRunner("", "", nil, nil) // no app => no restart concern
	// Fail the DB load so the engine returns at step 7 — before step 10 would clear
	// the breadcrumb — leaving the 6c-finalized target_image_id intact to assert.
	f.StreamInFunc = func(_ io.Reader, args []string) error {
		if joinHas("mathion_restore_db_")(args) {
			return errors.New("db load stops the restore before step 9")
		}
		return nil
	}
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the DB-load failure to stop the restore before step 9")
	}
	if !hasCall(f.Calls, isPull) {
		t.Fatalf("expected a pull; calls=%v", f.Calls)
	}
	if hasCall(f.Calls, isTag) {
		t.Fatalf("a successful pull already moves the tag; no retag expected; calls=%v", f.Calls)
	}
	j, present, err := varlib.ReadJournal()
	if err != nil || !present {
		t.Fatalf("breadcrumb missing after restore (present=%v err=%v)", present, err)
	}
	if j.TargetImageID != "sha256:pulled" {
		t.Fatalf("target_image_id = %q, want finalized %q", j.TargetImageID, "sha256:pulled")
	}
}

// TestRestoreEngineLocalRIDRetag: recorded-id-first hit (no pull) with a boot tag
// that points elsewhere => a docker tag <RID> ImageRepo:<version> runs.
func TestRestoreEngineLocalRIDRetag(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, callPsApp):
				return "", nil
			case len(args) >= 2 && args[0] == "image" && args[1] == "inspect" && !strings.Contains(j, "--format"):
				return "", nil // recorded id present => RID = sha256:rec, no pull
			case len(args) >= 2 && args[0] == "image" && args[1] == "inspect":
				return "sha256:other\n", nil // boot tag points elsewhere => retag needed
			}
			return "", nil
		},
		// Fail the DB load so the engine returns at step 7 (before step 10 would clear
		// the breadcrumb), preserving the 6c-written target_image_id for the assertion.
		StreamInFunc: func(_ io.Reader, args []string) error {
			if joinHas("mathion_restore_db_")(args) {
				return errors.New("db load stops the restore before step 9")
			}
			return nil
		},
	}
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the DB-load failure to stop the restore before step 9")
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("recorded-id-local restore must not pull; calls=%v", f.Calls)
	}
	ti := idxOfCall(f.Calls, isTag)
	if ti < 0 {
		t.Fatalf("expected a retag; calls=%v", f.Calls)
	}
	if got := f.Calls[ti]; got[1] != "sha256:rec" || got[2] != compose.ImageRepo+":"+managedTag {
		t.Fatalf("retag args = %v, want [tag sha256:rec %s:%s]", got, compose.ImageRepo, managedTag)
	}
	j, _, _ := varlib.ReadJournal()
	if j == nil || j.TargetImageID != "sha256:rec" {
		t.Fatalf("breadcrumb target_image_id = %v, want sha256:rec", j)
	}
}

// TestRestoreEngineLostAck (round-10 #3): a pull error RETAINS the breadcrumb (with
// an absent target_image_id — never finalized) and aborts; no restart when the app
// was not running.
func TestRestoreEngineLostAck(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := pullFlaggedRunner("", "", errors.New("pull failed"), nil) // no app => no restart
	app, _, _ := engineApp(cfg, f, "")
	err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps})
	if err == nil {
		t.Fatal("expected a pull error to surface")
	}
	if hasCall(f.Calls, isStart) {
		t.Fatalf("no restart expected when the app was not running; calls=%v", f.Calls)
	}
	j, present, rerr := varlib.ReadJournal()
	if rerr != nil || !present {
		t.Fatalf("breadcrumb must be RETAINED on a pull error (present=%v err=%v)", present, rerr)
	}
	if j.TargetImageID != "" {
		t.Fatalf("target_image_id = %q, want absent (never finalized on a pull error)", j.TargetImageID)
	}
}

// TestRestoreEngineRestartOnCleanPullError (round-11/12/13): a clean standalone
// restore whose app was running+healthy best-effort restarts the captured container
// by ID on a 6c pull error. The restart MUST run on a live, deadline-bounded context
// (WithTimeout(WithoutCancel(ctx), restartTimeout)) even though the pull ran on a
// context already cancelled by the Ctrl-C that triggered the failure.
func TestRestoreEngineRestartOnCleanPullError(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Cancel ctx inside stop-app so the subsequent pull call snapshots as cancelled,
	// and make the pull fail (as a cancelled docker pull would).
	f := pullFlaggedRunner("appcid\n", "true healthy\n", errors.New("context canceled"), cancel)
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(ctx, app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the pull error to surface")
	}
	pi := idxOfCall(f.Calls, isPull)
	sti := idxOfCall(f.Calls, isStart)
	if pi < 0 || sti < 0 {
		t.Fatalf("want both a pull and a restart; calls=%v", f.Calls)
	}
	if f.Calls[sti][1] != "appcid" {
		t.Fatalf("restart must target the captured id; got %v", f.Calls[sti])
	}
	if f.CtxSnaps[pi].Err == nil {
		t.Fatal("pull call should have snapshotted a CANCELLED context")
	}
	s := f.CtxSnaps[sti]
	if s.Err != nil {
		t.Fatalf("restart must run on a LIVE context, got Err=%v", s.Err)
	}
	if !s.HasDeadline {
		t.Fatal("restart context must carry a deadline")
	}
	// Symmetric tolerance: a regression that used a much shorter timeout (e.g. the
	// wrong context nesting, or a 1s constant) must fail the LOWER bound too.
	if d := time.Until(s.Deadline); d < restartTimeout-2*time.Second || d > restartTimeout+2*time.Second {
		t.Fatalf("restart deadline %v not within ±2s of %v", d, restartTimeout)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("breadcrumb must remain after a best-effort restart")
	}
}

// TestRestoreEngineNoRestartOnRecovery: a restore entered WITH a breadcrumb (as
// recovery) never restarts the pre-restore container, even if it was healthy.
func TestRestoreEngineNoRestartOnRecovery(t *testing.T) {
	cfg := setupBackupEnv(t)
	if err := varlib.WriteJournal(varlib.Journal{Schema: 1, Kind: "update", TargetTag: "v0.0.9", BackupPath: "/x/y.tar.gz"}); err != nil {
		t.Fatal(err)
	}
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := pullFlaggedRunner("appcid\n", "true healthy\n", errors.New("pull failed"), nil)
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the pull error to surface")
	}
	if hasCall(f.Calls, isStart) {
		t.Fatalf("a recovery restore must not restart the pre-restore container; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("breadcrumb must remain")
	}
}

// TestRestoreEngineNoRestartWhenUnhealthy: a clean restore whose app was NOT
// health-passing at entry does not restart it on a pull error.
func TestRestoreEngineNoRestartWhenUnhealthy(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := pullFlaggedRunner("appcid\n", "true starting\n", errors.New("pull failed"), nil)
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the pull error to surface")
	}
	if hasCall(f.Calls, isStart) {
		t.Fatalf("an unhealthy pre-state must not be restarted; calls=%v", f.Calls)
	}
}

// TestRestoreEngineNoRestartWhenJournalUnreadable: a journal read error at entry
// must FAIL CLOSED (breadcrumbAtEntry treated as present) so a healthy clean-looking
// restore does NOT restart on a pull error — a wrong restart could boot an
// inconsistent pre-restore container.
func TestRestoreEngineNoRestartWhenJournalUnreadable(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("run as non-root: mode 0000 does not block root reads")
	}
	cfg := setupBackupEnv(t)
	if err := varlib.WriteJournal(varlib.Journal{Schema: 1, Kind: "update", TargetTag: "v0.0.9", BackupPath: "/x/y.tar.gz"}); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(varlib.JournalPath(), 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(varlib.JournalPath(), 0o600) })
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := pullFlaggedRunner("appcid\n", "true healthy\n", errors.New("pull failed"), nil)
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the pull error to surface")
	}
	if hasCall(f.Calls, isStart) {
		t.Fatalf("an unreadable journal must fail closed (no restart); calls=%v", f.Calls)
	}
}

// TestRestoreEngineNoRestartWhenPsErrors: a `compose ps -q app` error — even one
// that emits a partial container id on stdout — must classify not-healthy (any ps
// failure ⇒ fail-safe), so no restart runs on a pull error.
func TestRestoreEngineNoRestartWhenPsErrors(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, callPsApp):
				return "appcid\n", errors.New("daemon hiccup") // partial stdout + error
			case len(args) > 0 && args[0] == "inspect":
				return "true healthy\n", nil
			case len(args) >= 2 && args[0] == "image" && args[1] == "inspect":
				return "", errors.New("no such image")
			}
			return "", nil
		},
		RunFunc: func(args []string) error {
			if isPull(args) {
				return errors.New("pull failed")
			}
			return nil
		},
	}
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the pull error to surface")
	}
	if hasCall(f.Calls, isStart) {
		t.Fatalf("a ps failure must classify not-healthy (no restart) despite partial stdout; calls=%v", f.Calls)
	}
}

// TestRestoreEnginePullSucceedsButResolveFails (round-10 #3 sibling): a pull that
// succeeds but whose resulting id cannot be resolved is an UNCERTAIN state — the
// engine must abort (not return success), leave the absent-id breadcrumb retained,
// and never retag on a "" id.
func TestRestoreEnginePullSucceedsButResolveFails(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, callPsApp):
				return "", nil // no app
			case len(args) >= 2 && args[0] == "image" && args[1] == "inspect":
				return "", errors.New("inspect unavailable") // preflight => pull-flagged; post-pull => still fails
			}
			return "", nil
		},
		RunFunc: func(args []string) error { return nil }, // pull SUCCEEDS
	}
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("a pull whose id cannot be resolved must abort (uncertain state)")
	}
	if hasCall(f.Calls, isTag) {
		t.Fatalf("must not retag when the pulled id is unresolvable; calls=%v", f.Calls)
	}
	j, present, _ := varlib.ReadJournal()
	if !present {
		t.Fatal("the absent-id breadcrumb must be retained")
	}
	if j.TargetImageID != "" {
		t.Fatalf("target_image_id = %q, want absent (never finalized on an unresolved pull)", j.TargetImageID)
	}
}

// --- restore DB load + assets + cancellation cleanup (Task 17) --------------

// validAssetsTar returns a REAL, pre-scan-safe assets.tar (one regular file, no
// "..", no absolute path) so the step-3 PrescanAssets accepts it.
func validAssetsTar(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	body := []byte("hi")
	if err := tw.WriteHeader(&tar.Header{Name: "hello.txt", Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// containsArg reports whether call contains want as a whole token.
func containsArg(call []string, want string) bool {
	for _, a := range call {
		if a == want {
			return true
		}
	}
	return false
}

// argAfter returns the token immediately following flag in call, or "".
func argAfter(call []string, flag string) string {
	for i, a := range call {
		if a == flag && i+1 < len(call) {
			return call[i+1]
		}
	}
	return ""
}

// hasEnv reports whether any EnvCalls vector carries the want "K=V" entry.
func hasEnv(envCalls [][]string, want string) bool {
	for _, e := range envCalls {
		for _, kv := range e {
			if kv == want {
				return true
			}
		}
	}
	return false
}

// rmForce matches a `rm -f <name>` cleanup call whose name carries the prefix.
func rmForce(prefix string) func([]string) bool {
	return func(c []string) bool {
		return len(c) == 3 && c[0] == "rm" && c[1] == "-f" && strings.HasPrefix(c[2], prefix)
	}
}

// isLoadCall matches a destructive one-off compose-run call for the given worker
// name prefix (distinct from the `rm`/`ps` cleanup calls, which do not start with
// "compose").
func isLoadCall(prefix string) func([]string) bool {
	return func(c []string) bool { return head(c) == "compose" && joinHas(prefix)(c) }
}

// TestRestoreLoadHappyPath: with a clean local-RID preflight and both destructive
// one-offs returning nil, the engine returns nil after driving the DB load via
// StreamIn (compose run, NOT exec, restoreDBScript trailing) and the assets restore
// via StreamInEnv (MATHION_VERSION pinned, restoreAssetsScript trailing), DB first.
func TestRestoreLoadHappyPath(t *testing.T) {
	cfg := setupRestoreEnv(t)
	stubGate(t, nil)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	var sawDB, sawAssets bool
	f := &compose.FakeRunner{
		OutputFunc: recordedIDLocalOutput,
		StreamInFunc: func(_ io.Reader, args []string) error {
			switch {
			case joinHas("mathion_restore_db_")(args):
				sawDB = true
			case joinHas("mathion_restore_assets_")(args):
				sawAssets = true
			}
			return nil
		},
	}
	app, _, errb := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !sawDB || !sawAssets {
		t.Fatalf("both loads must run through StreamIn/StreamInEnv (db=%v assets=%v)", sawDB, sawAssets)
	}
	if !strings.Contains(errb.String(), "restoring database") {
		t.Fatalf("a progress line must precede the now-quiet DB load; err=%q", errb.String())
	}
	di := idxOfCall(f.Calls, isLoadCall("mathion_restore_db_"))
	ai := idxOfCall(f.Calls, isLoadCall("mathion_restore_assets_"))
	if di < 0 || ai < 0 || di >= ai {
		t.Fatalf("want DB load before assets load; db=%d assets=%d calls=%v", di, ai, f.Calls)
	}
	db := f.Calls[di]
	if containsArg(db, "exec") {
		t.Fatalf("DB load must be a `run` one-off, not `exec`; got %v", db)
	}
	for _, want := range []string{"run", "--rm", "--no-deps", "--pull", "never", "--label", "io.mathion.worker=1", "-T", "db", "sh", "-c"} {
		if !containsArg(db, want) {
			t.Fatalf("DB load argv missing %q; got %v", want, db)
		}
	}
	if !strings.HasPrefix(argAfter(db, "--name"), "mathion_restore_db_") {
		t.Fatalf("DB load must carry a pid-scoped --name; got %v", db)
	}
	if db[len(db)-1] != restoreDBScript {
		t.Fatalf("DB load trailing arg must be restoreDBScript; got %q", db[len(db)-1])
	}
	as := f.Calls[ai]
	for _, want := range []string{"run", "-T", "app"} {
		if !containsArg(as, want) {
			t.Fatalf("assets load argv missing %q; got %v", want, as)
		}
	}
	if !strings.HasPrefix(argAfter(as, "--name"), "mathion_restore_assets_") {
		t.Fatalf("assets load must carry a pid-scoped --name; got %v", as)
	}
	if as[len(as)-1] != restoreAssetsScript {
		t.Fatalf("assets load trailing arg must be restoreAssetsScript; got %q", as[len(as)-1])
	}
	if !hasEnv(f.EnvCalls, "MATHION_VERSION="+managedTag) {
		t.Fatalf("assets load must pin MATHION_VERSION=%s via StreamInEnv; EnvCalls=%v", managedTag, f.EnvCalls)
	}
}

// TestRestoreDBScriptQuietsPsqlStdout pins the pre-release polish: the psql load's
// stdout (its DDL/command-tag echo) is redirected to /dev/null so a successful restore
// is quiet, while the PII-scrubbed stderr channel is left untouched and the transactional
// guards (ON_ERROR_STOP + --single-transaction) are preserved — errors still surface and
// still roll back.
func TestRestoreDBScriptQuietsPsqlStdout(t *testing.T) {
	if !strings.Contains(restoreDBScript, `-d "$POSTGRES_DB" >/dev/null`) {
		t.Fatalf("psql load stdout must be redirected to /dev/null; script=%q", restoreDBScript)
	}
	if strings.Contains(restoreDBScript, "2>") {
		t.Fatalf("restoreDBScript must never redirect stderr (the spooled PII-scrubbed channel); script=%q", restoreDBScript)
	}
	for _, must := range []string{"ON_ERROR_STOP=1", "--single-transaction"} {
		if !strings.Contains(restoreDBScript, must) {
			t.Fatalf("restoreDBScript must keep %q (the quiet redirect must not weaken the transactional load); script=%q", must, restoreDBScript)
		}
	}
}

// TestRestoreLoadDBErrorPIISafe: a non-zero DB-load exit is scrubbed via
// spoolPGStderr (generic message + 0600 log path, never the raw pg stderr), both
// named workers are force-removed, and the recovery breadcrumb is RETAINED. Also
// covers the "surfaces the real command ExitError, not a stdin EPIPE" requirement.
func TestRestoreLoadDBErrorPIISafe(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	f := &compose.FakeRunner{
		OutputFunc: recordedIDLocalOutput,
		StreamInFunc: func(_ io.Reader, args []string) error {
			if joinHas("mathion_restore_db_")(args) {
				return &compose.ExitError{Code: 1, Stderr: []byte("SECRET_PII_ROW")}
			}
			return nil
		},
	}
	app, _, _ := engineApp(cfg, f, "")
	err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps})
	if err == nil {
		t.Fatal("expected a DB-load error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "pg_restore failed (exit 1)") || !strings.Contains(msg, "saved to") {
		t.Fatalf("want a scrubbed pg_restore error with a saved-log path; got %q", msg)
	}
	if strings.Contains(msg, "SECRET_PII_ROW") {
		t.Fatalf("error leaked raw pg stderr: %q", msg)
	}
	// The surfaced error came from the command ExitError (exit 1), not a stdin EPIPE.
	if strings.Contains(msg, "closed pipe") || strings.Contains(strings.ToLower(msg), "epipe") {
		t.Fatalf("want the command exit error, not a stdin pipe error: %q", msg)
	}
	if !hasCall(f.Calls, rmForce("mathion_restore_db_")) || !hasCall(f.Calls, rmForce("mathion_restore_assets_")) {
		t.Fatalf("both workers must be force-removed on a DB-load failure; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("breadcrumb must be RETAINED on a DB-load failure")
	}
}

// TestRestoreLoadAssetsError: a failed assets restore returns a wrapped
// "restoring assets" error, force-removes both workers, and retains the breadcrumb.
func TestRestoreLoadAssetsError(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	f := &compose.FakeRunner{
		OutputFunc: recordedIDLocalOutput,
		StreamInFunc: func(_ io.Reader, args []string) error {
			if joinHas("mathion_restore_assets_")(args) {
				return errors.New("tar: broken pipe")
			}
			return nil // DB load succeeds
		},
	}
	app, _, _ := engineApp(cfg, f, "")
	err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps})
	if err == nil {
		t.Fatal("expected an assets-restore error")
	}
	if !strings.Contains(err.Error(), "restoring assets") {
		t.Fatalf("want a wrapped 'restoring assets' error; got %q", err.Error())
	}
	if !hasCall(f.Calls, rmForce("mathion_restore_db_")) || !hasCall(f.Calls, rmForce("mathion_restore_assets_")) {
		t.Fatalf("both workers must be force-removed on an assets-restore failure; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("breadcrumb must be RETAINED on an assets-restore failure")
	}
}

// TestRestoreCancelCleansUpUnderWithoutCancel: a context cancel mid-DB-load (as if
// Ctrl-C while pg_restore is still decoding) force-removes BOTH workers before the
// engine returns, and the cleanup runs under context.WithoutCancel — so the rm call
// snapshots a LIVE context (Err()==nil), not the cancelled parent. Breadcrumb kept.
func TestRestoreCancelCleansUpUnderWithoutCancel(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f := &compose.FakeRunner{
		OutputFunc: recordedIDLocalOutput,
		StreamInFunc: func(_ io.Reader, args []string) error {
			if joinHas("mathion_restore_db_")(args) {
				cancel() // Ctrl-C lands while the decode+load one-off is still running
				return ctx.Err()
			}
			return nil
		},
	}
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(ctx, app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err == nil {
		t.Fatal("expected the cancellation to surface")
	}
	di := idxOfCall(f.Calls, rmForce("mathion_restore_db_"))
	if di < 0 {
		t.Fatalf("db worker must be force-removed on cancel; calls=%v", f.Calls)
	}
	// WithoutCancel proof: had cleanup reused the cancelled ctx, this snapshot would
	// be context.Canceled.
	if s := f.CtxSnaps[di]; s.Err != nil {
		t.Fatalf("cleanup must run under context.WithoutCancel (live ctx); got Err=%v", s.Err)
	}
	if !hasCall(f.Calls, rmForce("mathion_restore_assets_")) {
		t.Fatalf("assets worker must also be force-removed on cancel; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("breadcrumb must be RETAINED on cancel")
	}
}

// --- restore re-pin + recreate + gate (Task 18) -----------------------------

// TestRestoreGatePassClearsBreadcrumb: a full happy restore re-pins .env to the
// restored version, recreates app (up -d --wait --pull never app), and — because
// the (stubbed) gate passes — clears the step-6b breadcrumb and prints the summary.
func TestRestoreGatePassClearsBreadcrumb(t *testing.T) {
	cfg := setupRestoreEnv(t)
	stubGate(t, nil)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, out, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// (a) the re-pin took.
	m, err := config.ReadEnvFile(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if m["MATHION_VERSION"] != managedTag {
		t.Fatalf("MATHION_VERSION re-pin = %q, want %q", m["MATHION_VERSION"], managedTag)
	}
	// (b) app was recreated on the validated local image with --wait and --pull never.
	if !hasCall(f.Calls, joinHas("up -d --wait --pull never app")) {
		t.Fatalf("expected an `up -d --wait --pull never app` recreate; calls=%v", f.Calls)
	}
	// (c) the breadcrumb was cleared post-gate.
	if _, present, _ := varlib.ReadJournal(); present {
		t.Fatal("a passed-gate restore must clear its breadcrumb")
	}
	// (d) the success summary was printed.
	if s := out.String(); !strings.Contains(s, "restored to "+managedTag+" from ") {
		t.Fatalf("expected a `restored to %s from ` summary; got %q", managedTag, s)
	}
}

// TestRestoreGateFailRetainsBreadcrumb: a failing gate surfaces its error and
// RETAINS the breadcrumb (never cleared on a gate failure), so a re-run still
// recovers.
func TestRestoreGateFailRetainsBreadcrumb(t *testing.T) {
	cfg := setupRestoreEnv(t)
	stubGate(t, errors.New("gate: mismatch"))
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "")
	err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps})
	if err == nil || !strings.Contains(err.Error(), "gate: mismatch") {
		t.Fatalf("expected the gate error to surface; got %v", err)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("breadcrumb must be RETAINED on a gate failure")
	}
}

// --- restore COMMAND (Task 19) ----------------------------------------------

// TestRestoreCmdLatestResolves: with `--latest` (no positional) and a managed
// archive in the backups dir, the command resolves the target via SelectLatest and
// runs the engine end to end (proven by the DB-load one-off being issued).
func TestRestoreCmdLatestResolves(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	stubGate(t, nil)
	// Two managed archives: the SECOND written (v2.0.0) is newest by every SelectLatest
	// tiebreak (equal-or-later ts, later mtime, lexicographically greater name), so
	// --latest must resolve to IT — proven by the .env being re-pinned to v2.0.0, not
	// v1.2.3. One archive alone could not tell "newest" from "the only/arbitrary one".
	writeRestoreArchive(t, varlib.BackupsDir(), archive.Manifest{ImageID: "sha256:rec", MathionVersion: "v1.2.3"})
	writeRestoreArchive(t, varlib.BackupsDir(), archive.Manifest{ImageID: "sha256:rec", MathionVersion: "v2.0.0"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "")
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.Flags().Set("yes", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.RunE(c, nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("engine must have run the DB load; calls=%v", f.Calls)
	}
	env, err := config.ReadEnvFile(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if env["MATHION_VERSION"] != "v2.0.0" {
		t.Fatalf("--latest must restore the NEWEST archive (re-pin to v2.0.0); got MATHION_VERSION=%q", env["MATHION_VERSION"])
	}
}

// TestRestoreCmdLatestNoBackups: `--latest` against a freshly-ensured (empty)
// backups dir surfaces SelectLatest's no-backups error and never touches the engine.
func TestRestoreCmdLatestNoBackups(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "")
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	err := c.RunE(c, nil)
	if err == nil || !strings.Contains(err.Error(), "no backups matching") {
		t.Fatalf("expected SelectLatest's specific no-backups error; got %v", err)
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("engine must not run when SelectLatest finds nothing; calls=%v", f.Calls)
	}
}

// TestRestoreCmdUntrustedPathWarns: an explicit archive OUTSIDE the backups dir
// makes TierFor pick UntrustedCaps, so the engine's !Yes confirm path prints the
// untrusted-SQL warning; the typed project name confirms and the restore completes.
func TestRestoreCmdUntrustedPathWarns(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	stubGate(t, nil)
	path := writeRestoreArchive(t, t.TempDir(), archive.Manifest{ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, errb := engineApp(cfg, f, "mathion_prod\n") // confirm input; NOT --yes
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.RunE(c, []string{path}); err != nil {
		t.Fatalf("confirmation should match and the restore succeed; got %v", err)
	}
	if !strings.Contains(errb.String(), "outside the managed backups dir") {
		t.Fatalf("expected the untrusted-path warning (TierFor -> UntrustedCaps); errb=%q", errb.String())
	}
}

// TestResolveRestoreCapsHonorsManagedOverrides pins the restore command's cap
// resolution (the update-vs-restore parity fix): a MANAGED archive (under the backups
// dir) honors the operator's MATHION_RESTORE_MAX_* overrides — lowered, raised, and
// HARD-FAILING on a malformed value — exactly as update.go's ManagedCaps(os.Getenv)
// call does; an UNTRUSTED archive keeps the FIXED UntrustedCaps with the overrides
// IGNORED (a hostile archive can never widen its own DoS envelope).
func TestResolveRestoreCapsHonorsManagedOverrides(t *testing.T) {
	setupRestoreEnv(t) // sets MATHION_VARLIB_DIR + ensures the backups dir
	backups := varlib.BackupsDir()
	managed := filepath.Join(backups, "mathion-backup-x.tar.gz")
	untrusted := filepath.Join(t.TempDir(), "hostile.tar.gz")

	// Hermetic baseline: neutralize any ambient MATHION_RESTORE_MAX_* (ManagedCaps
	// treats "" as unset) so each subtest exercises ONLY the override it sets — an
	// inherited malformed/out-of-range value in the OTHER cap var must not bleed in
	// and spuriously hard-fail the lowered/raised cases.
	t.Setenv("MATHION_RESTORE_MAX_MEMBER_BYTES", "")
	t.Setenv("MATHION_RESTORE_MAX_TOTAL_BYTES", "")

	t.Run("managed lowered", func(t *testing.T) {
		t.Setenv("MATHION_RESTORE_MAX_MEMBER_BYTES", "1G")
		caps, err := resolveRestoreCaps(managed, backups)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if caps.MaxMember != 1<<30 {
			t.Fatalf("MaxMember = %d, want the lowered override 1 GiB (%d)", caps.MaxMember, int64(1<<30))
		}
		if caps.MaxMember >= archive.ManagedDefaultMember {
			t.Fatalf("override must LOWER below the default %d; got %d", archive.ManagedDefaultMember, caps.MaxMember)
		}
	})

	t.Run("managed raised", func(t *testing.T) {
		t.Setenv("MATHION_RESTORE_MAX_TOTAL_BYTES", "500G")
		caps, err := resolveRestoreCaps(managed, backups)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if caps.MaxTotal != 500<<30 {
			t.Fatalf("MaxTotal = %d, want the raised override 500 GiB (%d)", caps.MaxTotal, int64(500<<30))
		}
		if caps.MaxTotal <= archive.ManagedDefaultTotal {
			t.Fatalf("override must RAISE above the default %d; got %d", archive.ManagedDefaultTotal, caps.MaxTotal)
		}
	})

	t.Run("managed invalid hard-fails", func(t *testing.T) {
		t.Setenv("MATHION_RESTORE_MAX_MEMBER_BYTES", "banana")
		if _, err := resolveRestoreCaps(managed, backups); err == nil ||
			!strings.Contains(err.Error(), "MATHION_RESTORE_MAX_MEMBER_BYTES") {
			t.Fatalf("a malformed managed override must hard-fail with the ManagedCaps error; got %v", err)
		}
	})

	t.Run("untrusted ignores overrides", func(t *testing.T) {
		// A malformed override that WOULD hard-fail a managed archive must be IGNORED for
		// an untrusted path (fixed low tier, never env-overridable) — no error, caps stay
		// UntrustedCaps despite a raised total also being set.
		t.Setenv("MATHION_RESTORE_MAX_MEMBER_BYTES", "banana")
		t.Setenv("MATHION_RESTORE_MAX_TOTAL_BYTES", "500G")
		caps, err := resolveRestoreCaps(untrusted, backups)
		if err != nil {
			t.Fatalf("an untrusted path must ignore overrides, not hard-fail; got %v", err)
		}
		if caps != archive.UntrustedCaps() {
			t.Fatalf("untrusted caps = %+v, want the fixed UntrustedCaps %+v", caps, archive.UntrustedCaps())
		}
	})
}

// TestRestoreCmdInvalidManagedCapHardFails: end-to-end wiring — a MANAGED archive with
// a malformed MATHION_RESTORE_MAX_* override makes the command HARD-FAIL at cap
// resolution (proving restore, like update, honors managed cap overrides) with NO
// restore attempted (the destructive DB-load one-off never runs).
func TestRestoreCmdInvalidManagedCapHardFails(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	t.Setenv("MATHION_RESTORE_MAX_MEMBER_BYTES", "banana")
	writeRestoreArchive(t, varlib.BackupsDir(), archive.Manifest{ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "")
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.Flags().Set("yes", "true"); err != nil {
		t.Fatal(err)
	}
	err := c.RunE(c, nil)
	if err == nil || !strings.Contains(err.Error(), "MATHION_RESTORE_MAX_MEMBER_BYTES") {
		t.Fatalf("a malformed managed cap override must hard-fail the command; got %v", err)
	}
	if hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("no restore must be attempted on a bad managed cap override; calls=%v", f.Calls)
	}
}

// TestRestoreCmdExemptProceedsReplacesBreadcrumb: restore is EXEMPT from the
// entry-check refusal — it PROCEEDS past a leftover kind:"update" breadcrumb (unlike
// backup, which refuses) and REPLACES it with its own kind:"restore" one at step 6b.
// A stubbed gate failure stops the engine at step 10 with that breadcrumb retained,
// so this single test pins both "exempt proceeds" and "replaced with kind:restore".
func TestRestoreCmdExemptProceedsReplacesBreadcrumb(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	if err := varlib.WriteJournal(varlib.Journal{Schema: 1, Kind: "update", TargetTag: "v9.9.9", BackupPath: "/b/x.tar.gz"}); err != nil {
		t.Fatal(err)
	}
	stubGate(t, errors.New("gate stop"))
	writeRestoreArchive(t, varlib.BackupsDir(), archive.Manifest{ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "")
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.Flags().Set("yes", "true"); err != nil {
		t.Fatal(err)
	}
	err := c.RunE(c, nil)
	if err == nil || !strings.Contains(err.Error(), "gate stop") {
		t.Fatalf("restore must PROCEED past the update breadcrumb and stop at the gate; got %v", err)
	}
	j, present, rerr := varlib.ReadJournal()
	if rerr != nil || !present {
		t.Fatalf("breadcrumb must be retained on a gate failure; present=%v err=%v", present, rerr)
	}
	if j.Kind != "restore" {
		t.Fatalf("step 6b must REPLACE the update breadcrumb with a kind:restore one; got kind=%q", j.Kind)
	}
}

// TestRestoreCmdLockHeld: mirroring backup, a concurrently held operation lock makes
// the command fail closed with the ErrLocked sentinel before any resolution or engine
// work (the lock is taken right after EnsureBackupsDir). No archive need exist.
func TestRestoreCmdLockHeld(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	release, err := varlib.Lock()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = release() }()
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "")
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.RunE(c, []string{"/any/path.tar.gz"}); !errors.Is(err, varlib.ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}
	// The lock is taken right after EnsureBackupsDir, BEFORE the sweeps — so NOT ONE
	// runner call (SweepWorkers' ps included, recorded in Calls) may have been issued.
	if len(f.Calls) != 0 {
		t.Fatalf("no runner work must run when the lock is held; calls=%v", f.Calls)
	}
}

// TestRestoreCmdYesBypassesConfirm: `--yes` skips the destructive confirmation, so an
// EMPTY In still completes — whereas without --yes the empty In would fail step 5.
func TestRestoreCmdYesBypassesConfirm(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	stubGate(t, nil)
	writeRestoreArchive(t, varlib.BackupsDir(), archive.Manifest{ImageID: "sha256:rec"})
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, _ := engineApp(cfg, f, "") // EMPTY In
	c := newRestoreCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.Flags().Set("yes", "true"); err != nil {
		t.Fatal(err)
	}
	if err := c.RunE(c, nil); err != nil {
		t.Fatalf("--yes must bypass the confirm on an empty In; got %v", err)
	}
}

// TestRestoreCmdFlagValidation: the two usage errors fail fast (before the lock),
// with no engine work. (a) --latest AND a positional path are mutually exclusive;
// (b) neither is provided. Fresh command per sub-case.
func TestRestoreCmdFlagValidation(t *testing.T) {
	cfg := setupRestoreCmdEnv(t)
	asRoot(t)
	// Hold the operation lock for the whole test: usage validation runs BEFORE the
	// lock, so each bad invocation must return its SPECIFIC validation error — NOT
	// ErrLocked — and issue no runner call. (If validation moved after the lock,
	// these would come back ErrLocked instead.)
	release, err := varlib.Lock()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = release() }()
	// (a) --latest AND an explicit path -> mutually exclusive.
	f1 := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app1, _, _ := engineApp(cfg, f1, "")
	c1 := newRestoreCmd(app1)
	c1.SetContext(context.Background())
	if err := c1.Flags().Set("latest", "true"); err != nil {
		t.Fatal(err)
	}
	err = c1.RunE(c1, []string{"/p.tar.gz"})
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") || errors.Is(err, varlib.ErrLocked) {
		t.Fatalf("--latest + a path must fail validation BEFORE the lock; got %v", err)
	}
	if len(f1.Calls) != 0 {
		t.Fatalf("no runner work on a usage error; calls=%v", f1.Calls)
	}
	// (b) neither --latest nor a path -> must provide one.
	f2 := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app2, _, _ := engineApp(cfg, f2, "")
	c2 := newRestoreCmd(app2)
	c2.SetContext(context.Background())
	err = c2.RunE(c2, nil)
	if err == nil || !strings.Contains(err.Error(), "provide an archive") || errors.Is(err, varlib.ErrLocked) {
		t.Fatalf("neither --latest nor a path must fail validation BEFORE the lock; got %v", err)
	}
	if len(f2.Calls) != 0 {
		t.Fatalf("no runner work on a usage error; calls=%v", f2.Calls)
	}
}

// TestRestoreGateRemoveWarns: the gate passes but the post-gate breadcrumb remove
// fails (backups dir turned read-only by the gate's side effect exactly when the
// unlink runs). The failed remove is a NON-FATAL warning — the restore still
// returns nil — and the warning names the journal path for manual cleanup.
func TestRestoreGateRemoveWarns(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("run as non-root: mode 0500 does not block root unlink")
	}
	cfg := setupRestoreEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag, ImageID: "sha256:rec"})
	// The gate stub side-effects the backups dir read-only exactly when it runs —
	// AFTER 6b wrote the breadcrumb (dir still 0700), but BEFORE the post-gate
	// RemoveJournal, so the unlink fails. Restore the mode before the temp-dir cleanup.
	prev := gateFn
	gateFn = func(context.Context, *App, string, string, bool) error {
		_ = os.Chmod(varlib.BackupsDir(), 0o500)
		return nil
	}
	t.Cleanup(func() { gateFn = prev })
	t.Cleanup(func() { _ = os.Chmod(varlib.BackupsDir(), 0o700) })
	f := &compose.FakeRunner{OutputFunc: recordedIDLocalOutput}
	app, _, errb := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err != nil {
		t.Fatalf("a failed post-gate remove must be non-fatal; got %v", err)
	}
	w := errb.String()
	if !strings.Contains(w, "remove ") || !strings.Contains(w, varlib.JournalPath()) {
		t.Fatalf("expected a non-fatal remove warning naming the journal path; got %q", w)
	}
}

func tlsEnvDir(t *testing.T, enabled bool) string {
	t.Helper()
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "abc123hex"))), 0o600)
	if enabled {
		if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func joinAll(calls [][]string) []string {
	out := make([]string, len(calls))
	for i, c := range calls {
		out[i] = strings.Join(c, " ")
	}
	return out
}

func TestRestoreProxy_RollbackIssuesNothing(t *testing.T) {
	dir := tlsEnvDir(t, true)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error { calls = append(calls, a); return nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: false}) // rollback path
	for _, j := range joinAll(calls) {
		if strings.Contains(j, "proxy") {
			t.Fatalf("rollback (WriteBreadcrumb:false) must issue no proxy commands; saw %q", j)
		}
	}
}

func TestRestoreProxy_DisabledIssuesNothing(t *testing.T) {
	dir := tlsEnvDir(t, false)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error { calls = append(calls, a); return nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: true})
	if len(calls) != 0 {
		t.Fatalf("TLS-disabled restore must issue no proxy commands; saw %v", joinAll(calls))
	}
}

func TestRestoreProxy_PoisonedEnvIssuesNothing(t *testing.T) {
	dir := writePoisonedTLSEnv(t)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error { calls = append(calls, a); return nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: true})
	if len(calls) != 0 {
		t.Fatalf("an inconsistent .env must issue no proxy commands; saw %v", joinAll(calls))
	}
}

func TestRestoreProxy_EnabledOrder(t *testing.T) {
	dir := tlsEnvDir(t, true)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error { calls = append(calls, a); return nil }}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: true})
	all := joinAll(calls)
	var iPull, iInit, iUp int = -1, -1, -1
	for i, j := range all {
		switch {
		case strings.Contains(j, "pull --policy missing proxy proxy-init"):
			iPull = i
		case strings.Contains(j, "run --rm --no-deps --pull never") && strings.Contains(j, "proxy-init"):
			iInit = i
		case strings.Contains(j, "up -d proxy --pull never --no-deps"):
			iUp = i
		}
	}
	if iPull < 0 || iInit < 0 || iUp < 0 {
		t.Fatalf("missing a step: pull=%d init=%d up=%d; calls=%v", iPull, iInit, iUp, all)
	}
	if !(iPull < iInit && iInit < iUp) {
		t.Fatalf("steps out of order: pull=%d init=%d up=%d", iPull, iInit, iUp)
	}
}

func TestRestoreProxy_InitFailureSkipsUpAndReaps(t *testing.T) {
	dir := tlsEnvDir(t, true)
	var calls [][]string
	fr := &compose.FakeRunner{RunFunc: func(a []string) error {
		calls = append(calls, a)
		if strings.Contains(strings.Join(a, " "), "-T proxy-init") {
			return &compose.ExitError{Code: 1}
		}
		return nil
	}}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr}
	app.restoreProxyIfEnabled(context.Background(), restoreOpts{WriteBreadcrumb: true})
	all := joinAll(calls)
	for _, j := range all {
		if strings.Contains(j, "up -d proxy") {
			t.Fatalf("a failed chown must skip `up proxy`; saw %q", j)
		}
	}
	// forceRemoveWorker must have force-removed the named proxy-init worker.
	var reaped bool
	for _, j := range all {
		if strings.HasPrefix(j, "rm -f mathion_proxyinit_") {
			reaped = true
		}
	}
	if !reaped {
		t.Fatalf("a failed chown must forceRemoveWorker the proxy-init one-off; calls=%v", all)
	}
}
