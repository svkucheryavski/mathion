package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
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
	mustWrite(t, as, []byte("ASSETS")) // raw bytes ok: the inner pre-scan is deferred
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

// TestRestoreEngineConfirmAccept: typing the project name proceeds through up-db
// then stop-app, in that order.
func TestRestoreEngineConfirmAccept(t *testing.T) {
	cfg := setupBackupEnv(t)
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
	cfg := setupBackupEnv(t)
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
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("expected a breadcrumb after a pull-flagged restore")
	}
}

// TestRestoreEnginePullFlaggedFinalize: the breadcrumb is written with an absent
// target_image_id, then finalized to the pulled id on pull success; no retag runs.
func TestRestoreEnginePullFlaggedFinalize(t *testing.T) {
	cfg := setupBackupEnv(t)
	arc := writeRestoreArchive(t, t.TempDir(), archive.Manifest{MathionVersion: managedTag})
	f := pullFlaggedRunner("", "", nil, nil) // no app => no restart concern
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err != nil {
		t.Fatalf("unexpected error: %v", err)
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
	}
	app, _, _ := engineApp(cfg, f, "")
	if err := restoreEngine(context.Background(), app, arc, restoreOpts{Yes: true, WriteBreadcrumb: true, Caps: managedCaps}); err != nil {
		t.Fatalf("unexpected error: %v", err)
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
	if d := time.Until(s.Deadline); d <= 0 || d > restartTimeout+2*time.Second {
		t.Fatalf("restart deadline %v out of expected ~%v range", d, restartTimeout)
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
