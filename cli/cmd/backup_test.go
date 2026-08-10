package cmd

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// setupBackupEnv points MATHION_VARLIB_DIR at a fresh NESTED 0700 dir (a bare
// t.TempDir() is 0755 and EnsureBackupsDir refuses it) and writes a minimal .env
// into a config dir it returns.
func setupBackupEnv(t *testing.T) string {
	t.Helper()
	t.Setenv("MATHION_VARLIB_DIR", filepath.Join(t.TempDir(), "vl"))
	if err := varlib.EnsureBackupsDir(); err != nil {
		t.Fatal(err)
	}
	cfg := t.TempDir()
	if err := os.WriteFile(filepath.Join(cfg, ".env"), []byte("MATHION_VERSION=v9.9.9\nPOSTGRES_DB=mathion\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func backupApp(cfg string, f *compose.FakeRunner) (*App, *bytes.Buffer, *bytes.Buffer) {
	out, errb := &bytes.Buffer{}, &bytes.Buffer{}
	return &App{CfgDir: cfg, Project: "mathion_prod", Runner: f, Out: out, Err: errb}, out, errb
}

// okOutputs makes the db/app preconditions pass and returns deterministic
// alembic/image-id output.
func okOutputs(args []string) (string, error) {
	j := strings.Join(args, " ")
	switch {
	case strings.Contains(j, "ps -q db"):
		return "dbcid\n", nil
	case strings.Contains(j, "ps -q app"):
		return "appcid\n", nil
	case strings.Contains(j, "alembic current"):
		return "67e8294b4267 (head)\n", nil
	case len(args) > 0 && args[0] == "inspect":
		return "sha256:deadbeef\n", nil
	}
	return "", nil
}

// okStream writes deterministic bytes for the db.dump / assets.tar streams.
func okStream(w io.Writer, args []string) error {
	j := strings.Join(args, " ")
	switch {
	case strings.Contains(j, "pg_dump"):
		_, _ = w.Write([]byte("DBDUMP"))
	case strings.Contains(j, "tar -C /data/mathion/assets"):
		_, _ = w.Write([]byte("ASSETS"))
	}
	return nil
}

func okFake() *compose.FakeRunner {
	return &compose.FakeRunner{OutputFunc: okOutputs, StreamFunc: okStream}
}

func anyCallContains(calls [][]string, sub string) bool {
	for _, c := range calls {
		if strings.Contains(strings.Join(c, " "), sub) {
			return true
		}
	}
	return false
}

func countCallsContaining(calls [][]string, sub string) int {
	n := 0
	for _, c := range calls {
		if strings.Contains(strings.Join(c, " "), sub) {
			n++
		}
	}
	return n
}

// asRoot drives requireRoot's geteuid seam so a non-root test process passes the
// root gate, restoring the original on cleanup.
func asRoot(t *testing.T) {
	t.Helper()
	orig := geteuid
	geteuid = func() int { return 0 }
	t.Cleanup(func() { geteuid = orig })
}

// assertOrderedSubseq checks that wants appear as an ordered subsequence of the
// recorded calls (other calls may interleave).
func assertOrderedSubseq(t *testing.T, calls [][]string, wants []string) {
	t.Helper()
	idx := 0
	for _, c := range calls {
		if idx >= len(wants) {
			break
		}
		if strings.Contains(strings.Join(c, " "), wants[idx]) {
			idx++
		}
	}
	if idx != len(wants) {
		t.Fatalf("calls did not contain ordered subsequence %v (matched %d); calls=%v", wants, idx, calls)
	}
}

// assertCallEquals finds the first recorded call whose joined form contains marker
// and asserts its COMPLETE arg vector equals want (exact, order-sensitive).
func assertCallEquals(t *testing.T, calls [][]string, marker string, want []string) {
	t.Helper()
	for _, c := range calls {
		if strings.Contains(strings.Join(c, " "), marker) {
			if !reflect.DeepEqual(c, want) {
				t.Fatalf("call for %q:\n got  %v\n want %v", marker, c, want)
			}
			return
		}
	}
	t.Fatalf("no call matched %q; calls=%v", marker, calls)
}

func readManifest(t *testing.T, path string) archive.Manifest {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if hdr.Name == "manifest.json" {
			var m archive.Manifest
			if err := json.NewDecoder(tr).Decode(&m); err != nil {
				t.Fatal(err)
			}
			return m
		}
	}
	t.Fatal("manifest.json not found in archive")
	return archive.Manifest{}
}

func TestBackupEngineArgvAndManifest(t *testing.T) {
	cfg := setupBackupEnv(t)
	f := okFake()
	app, _, _ := backupApp(cfg, f)

	final, err := backupEngine(context.Background(), app, "")
	if err != nil {
		t.Fatal(err)
	}

	assertOrderedSubseq(t, f.Calls, []string{
		"exec -T db sh -c",
		"run --rm --no-deps --pull never -T app sh -c",
		"run --rm --no-deps --pull never -T app alembic current",
		"inspect appcid --format {{.Image}}",
	})
	// Full-vector equality (not substring): a broken PGPASSWORD wrapper, a dropped
	// -U/-Fc, a lost --pull never, or a reordered flag must fail the test.
	assertCallEquals(t, f.Calls, "pg_dump", app.composeArgs(
		"exec", "-T", "db", "sh", "-c",
		`PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"`,
	))
	assertCallEquals(t, f.Calls, "tar -C /data/mathion/assets", app.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never", "-T", "app", "sh", "-c",
		`tar -C /data/mathion/assets -cf - .`,
	))
	assertCallEquals(t, f.Calls, "alembic current", app.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never", "-T", "app", "alembic", "current",
	))
	assertCallEquals(t, f.Calls, "inspect appcid", []string{
		"inspect", "appcid", "--format", "{{.Image}}",
	})

	m := readManifest(t, final)
	if m.SHA256["db.dump"] == "" || m.SHA256["assets.tar"] == "" {
		t.Fatalf("manifest SHA256 incomplete: %v", m.SHA256)
	}
	// The recorded hashes must match the streamed bytes.
	if m.SHA256["db.dump"] != sha256Hex("DBDUMP") || m.SHA256["assets.tar"] != sha256Hex("ASSETS") {
		t.Fatalf("payload hashes wrong: %v", m.SHA256)
	}
	if m.ImageID != "sha256:deadbeef" {
		t.Fatalf("ImageID = %q, want sha256:deadbeef", m.ImageID)
	}
	if m.AlembicRevision != "67e8294b4267" {
		t.Fatalf("AlembicRevision = %q, want 67e8294b4267", m.AlembicRevision)
	}
	if m.MathionVersion != "v9.9.9" || m.DBName != "mathion" || m.Schema != 1 {
		t.Fatalf("manifest metadata wrong: %+v", m)
	}
}

func sha256Hex(s string) string {
	h, _ := archive.SHA256Of(strings.NewReader(s))
	return h
}

func TestBackupEngineDBDown(t *testing.T) {
	cfg := setupBackupEnv(t)
	f := &compose.FakeRunner{} // default Output -> "" so `ps -q db` reports down
	app, _, _ := backupApp(cfg, f)

	if _, err := backupEngine(context.Background(), app, ""); err == nil || !strings.Contains(err.Error(), "start") {
		t.Fatalf("expected start-the-stack error, got %v", err)
	}
	if anyCallContains(f.Calls, "pg_dump") {
		t.Fatal("no dump must be attempted when db is down")
	}
}

func TestBackupEngineTarExitOneTolerated(t *testing.T) {
	cfg := setupBackupEnv(t)
	f := &compose.FakeRunner{
		OutputFunc: okOutputs,
		StreamFunc: func(w io.Writer, args []string) error {
			if strings.Contains(strings.Join(args, " "), "tar -C") {
				return &compose.ExitError{Code: 1}
			}
			return okStream(w, args)
		},
	}
	app, _, errb := backupApp(cfg, f)
	final, err := backupEngine(context.Background(), app, "")
	if err != nil {
		t.Fatalf("tar exit 1 must be tolerated, got %v", err)
	}
	if final == "" {
		t.Fatal("expected a managed archive path")
	}
	if !strings.Contains(errb.String(), "warning") {
		t.Fatalf("expected a warning on tar exit 1, got %q", errb.String())
	}
}

func TestBackupEngineTarExitTwoFatal(t *testing.T) {
	cfg := setupBackupEnv(t)
	f := &compose.FakeRunner{
		OutputFunc: okOutputs,
		StreamFunc: func(w io.Writer, args []string) error {
			if strings.Contains(strings.Join(args, " "), "tar -C") {
				return &compose.ExitError{Code: 2}
			}
			return okStream(w, args)
		},
	}
	app, _, _ := backupApp(cfg, f)
	if _, err := backupEngine(context.Background(), app, ""); err == nil {
		t.Fatal("tar exit 2 must be fatal")
	}
}

func TestBackupEnginePGStderrScrubbed(t *testing.T) {
	cfg := setupBackupEnv(t)
	const pii = "secret@example.com"
	rawStderr := []byte("ERROR: Key (email)=(" + pii + ") already exists")
	f := &compose.FakeRunner{
		OutputFunc: okOutputs,
		StreamFunc: func(w io.Writer, args []string) error {
			if strings.Contains(strings.Join(args, " "), "pg_dump") {
				return &compose.ExitError{Code: 1, Stderr: rawStderr}
			}
			return okStream(w, args)
		},
	}
	app, _, _ := backupApp(cfg, f)

	_, err := backupEngine(context.Background(), app, "")
	if err == nil {
		t.Fatal("pg_dump failure must be fatal")
	}
	if strings.Contains(err.Error(), pii) {
		t.Fatalf("returned error leaked PII: %v", err)
	}
	matches, _ := filepath.Glob(filepath.Join(varlib.Root(), "pg-error-*.log"))
	if len(matches) != 1 {
		t.Fatalf("expected exactly one pg-error log under Root, got %v", matches)
	}
	if !strings.Contains(err.Error(), matches[0]) {
		t.Fatalf("scrubbed error must name the log path %s, got %v", matches[0], err)
	}
	fi, statErr := os.Stat(matches[0])
	if statErr != nil {
		t.Fatal(statErr)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("pg-error log mode = %v, want 0600", fi.Mode().Perm())
	}
	// "full stderr saved" must be truthful: the persisted log is EXACTLY the raw
	// stderr bytes, byte-for-byte (not merely a substring).
	b, _ := os.ReadFile(matches[0])
	if !bytes.Equal(b, rawStderr) {
		t.Fatalf("spooled log must equal the raw stderr exactly; got %q want %q", string(b), string(rawStderr))
	}
}

func TestBackupEngineOutHappy(t *testing.T) {
	cfg := setupBackupEnv(t)
	app, _, _ := backupApp(cfg, okFake())
	out := filepath.Join(t.TempDir(), "copy.tar.gz")

	final, err := backupEngine(context.Background(), app, out)
	if err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(out)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("--out mode = %v, want 0600", fi.Mode().Perm())
	}
	a, _ := os.ReadFile(final)
	b, _ := os.ReadFile(out)
	if !bytes.Equal(a, b) {
		t.Fatal("--out copy content differs from the managed archive")
	}
}

func TestBackupEngineOutRefusesExisting(t *testing.T) {
	cfg := setupBackupEnv(t)
	app, _, _ := backupApp(cfg, okFake())
	out := filepath.Join(t.TempDir(), "copy.tar.gz")
	if err := os.WriteFile(out, []byte("preexisting"), 0o600); err != nil {
		t.Fatal(err)
	}

	final, err := backupEngine(context.Background(), app, out)
	if err == nil {
		t.Fatal("an existing --out must be refused (O_EXCL)")
	}
	if final == "" || !strings.Contains(err.Error(), final) {
		t.Fatalf("error must still name the managed archive path %q: %v", final, err)
	}
	if _, e := os.Stat(final); e != nil {
		t.Fatalf("managed archive must survive a failed --out: %v", e)
	}
	if b, _ := os.ReadFile(out); string(b) != "preexisting" {
		t.Fatalf("existing --out must be left untouched, got %q", string(b))
	}
}

func TestBackupEngineOutRefusesSymlink(t *testing.T) {
	cfg := setupBackupEnv(t)
	app, _, _ := backupApp(cfg, okFake())
	tmp := t.TempDir()
	target := filepath.Join(tmp, "target")
	if err := os.WriteFile(target, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(tmp, "link.tar.gz")
	if err := os.Symlink(target, out); err != nil {
		t.Fatal(err)
	}

	final, err := backupEngine(context.Background(), app, out)
	if err == nil {
		t.Fatal("a symlinked --out must be refused (O_NOFOLLOW)")
	}
	if final == "" || !strings.Contains(err.Error(), final) {
		t.Fatalf("error must still name the managed archive path: %v", err)
	}
	if b, _ := os.ReadFile(target); string(b) != "x" {
		t.Fatalf("symlink target must be untouched, got %q", string(b))
	}
}

func TestBackupEngineOutFailStillReportsManaged(t *testing.T) {
	cfg := setupBackupEnv(t)
	app, _, _ := backupApp(cfg, okFake())
	out := filepath.Join(t.TempDir(), "no-such-dir", "copy.tar.gz") // missing parent -> open fails

	final, err := backupEngine(context.Background(), app, out)
	if err == nil {
		t.Fatal("a failed --out copy must return non-nil")
	}
	if final == "" || !strings.Contains(err.Error(), final) {
		t.Fatalf("error must still name the managed archive path: %v", err)
	}
	if _, e := os.Stat(final); e != nil {
		t.Fatalf("managed archive must survive: %v", e)
	}
}

func TestBackupEngineImageIDFallbackToTag(t *testing.T) {
	cfg := setupBackupEnv(t)
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, "ps -q db"):
				return "dbcid\n", nil
			case strings.Contains(j, "ps -q app"):
				return "", nil // no app container -> fall back to image inspect
			case len(args) >= 2 && args[0] == "image" && args[1] == "inspect":
				return "sha256:fromtag\n", nil
			}
			return "", nil
		},
		StreamFunc: okStream,
	}
	app, _, _ := backupApp(cfg, f)

	final, err := backupEngine(context.Background(), app, "")
	if err != nil {
		t.Fatal(err)
	}
	if !anyCallContains(f.Calls, compose.ImageRepo+":v9.9.9") {
		t.Fatalf("fallback must inspect %s:v9.9.9; calls=%v", compose.ImageRepo, f.Calls)
	}
	if m := readManifest(t, final); m.ImageID != "sha256:fromtag" {
		t.Fatalf("ImageID = %q, want sha256:fromtag", m.ImageID)
	}
}

// TestBackupEngineImageIDEmptyWhenResolutionFails locks the invariant that a
// mutable tag is NEVER recorded as the immutable image_id when resolution fails:
// no app container is up AND the `image inspect <ImageRepo:ver>` call errors, so
// image_id must be empty (restore then takes the tag-pull path).
func TestBackupEngineImageIDEmptyWhenResolutionFails(t *testing.T) {
	cfg := setupBackupEnv(t)
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, "ps -q db"):
				return "dbcid\n", nil
			case strings.Contains(j, "ps -q app"):
				return "", nil // no app container -> fall back to image inspect
			case len(args) >= 2 && args[0] == "image" && args[1] == "inspect":
				return "sha256:should-not-be-used\n", errors.New("no such image")
			}
			return "", nil
		},
		StreamFunc: okStream,
	}
	app, _, _ := backupApp(cfg, f)

	final, err := backupEngine(context.Background(), app, "")
	if err != nil {
		t.Fatal(err)
	}
	if m := readManifest(t, final); m.ImageID != "" {
		t.Fatalf("ImageID = %q, want empty when tag resolution fails", m.ImageID)
	}
}

// TestBackupCmdLockHeldReturnsInProgress: a concurrently held operation lock makes
// the backup command fail closed with the ErrLocked sentinel (the RunE takes the
// lock right after EnsureBackupsDir, before any sweep or engine work).
func TestBackupCmdLockHeldReturnsInProgress(t *testing.T) {
	cfg := setupBackupEnv(t)
	asRoot(t)

	release, err := varlib.Lock()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = release() }()

	f := okFake()
	app, _, _ := backupApp(cfg, f)
	c := newBackupCmd(app)
	c.SetContext(context.Background())

	if err := c.RunE(c, nil); !errors.Is(err, varlib.ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}
	if anyCallContains(f.Calls, "pg_dump") {
		t.Fatalf("no work must run when the lock is held; calls=%v", f.Calls)
	}
}

// TestBackupCmdRefusesOnBreadcrumb: a leftover recovery breadcrumb makes backup
// refuse (guardEntry runs AFTER the lock, before the engine), so no pg_dump vector
// is ever issued.
func TestBackupCmdRefusesOnBreadcrumb(t *testing.T) {
	cfg := setupBackupEnv(t)
	asRoot(t)

	if err := varlib.WriteJournal(varlib.Journal{
		Schema:     1,
		Kind:       "update",
		TargetTag:  "v9.9.9",
		BackupPath: "/b/x.tar.gz",
	}); err != nil {
		t.Fatal(err)
	}

	f := okFake()
	app, _, _ := backupApp(cfg, f)
	c := newBackupCmd(app)
	c.SetContext(context.Background())

	if err := c.RunE(c, nil); err == nil {
		t.Fatal("backup must refuse on a leftover recovery breadcrumb")
	}
	// Sweep `ps -aq` calls may precede the refusal; only the dump vector's absence
	// proves the engine never ran.
	if anyCallContains(f.Calls, "pg_dump") {
		t.Fatalf("guardEntry must refuse before any pg_dump; calls=%v", f.Calls)
	}
}

// TestBackupCmdHappyPathCallsEngineOnce: with no breadcrumb, the command runs the
// engine exactly once (one pg_dump vector) and lands a single managed archive.
func TestBackupCmdHappyPathCallsEngineOnce(t *testing.T) {
	cfg := setupBackupEnv(t)
	asRoot(t)

	f := okFake()
	app, _, _ := backupApp(cfg, f)
	c := newBackupCmd(app)
	c.SetContext(context.Background())

	if err := c.RunE(c, nil); err != nil {
		t.Fatal(err)
	}
	if n := countCallsContaining(f.Calls, "pg_dump"); n != 1 {
		t.Fatalf("expected exactly one pg_dump call, got %d; calls=%v", n, f.Calls)
	}
	matches, _ := filepath.Glob(filepath.Join(varlib.BackupsDir(), "mathion-backup-*.tar.gz"))
	if len(matches) != 1 {
		t.Fatalf("expected exactly one managed archive in %s, got %v", varlib.BackupsDir(), matches)
	}
}

// TestBackupCmdOutFlagThreaded: the --out flag is threaded through to the engine,
// which drops a 0600 copy at the requested path.
func TestBackupCmdOutFlagThreaded(t *testing.T) {
	cfg := setupBackupEnv(t)
	asRoot(t)

	app, _, _ := backupApp(cfg, okFake())
	outPath := filepath.Join(t.TempDir(), "copy.tar.gz")

	c := newBackupCmd(app)
	c.SetContext(context.Background())
	if err := c.Flags().Set("out", outPath); err != nil {
		t.Fatal(err)
	}

	if err := c.RunE(c, nil); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(outPath)
	if err != nil {
		t.Fatalf("--out file must exist afterward: %v", err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("--out mode = %v, want 0600", fi.Mode().Perm())
	}
}
