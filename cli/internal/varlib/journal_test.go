package varlib_test

import (
	"os"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

func TestJournalRoundTrip(t *testing.T) {
	root := t.TempDir()
	// EnsureBackupsDir refuses a group/world-accessible managed dir; t.TempDir()
	// yields 0755 under the default umask, so tighten it to the required 0700.
	os.Chmod(root, 0o700)
	t.Setenv("MATHION_VARLIB_DIR", root)
	varlib.EnsureBackupsDir()
	j := varlib.Journal{Schema: 1, CreatedAt: "2026-08-06T00:00:00Z", Kind: "update",
		OldTag: "v0.1.0", TargetTag: "v0.2.0", TargetImageID: "sha256:aa", BackupPath: "/var/lib/mathion/backups/b.tar.gz"}
	if err := varlib.WriteJournal(j); err != nil {
		t.Fatal(err)
	}
	got, present, err := varlib.ReadJournal()
	if err != nil || !present || got.Kind != "update" || got.OldTag != "v0.1.0" {
		t.Fatalf("roundtrip: %+v present=%v err=%v", got, present, err)
	}
	if err := varlib.RemoveJournal(); err != nil {
		t.Fatal(err)
	}
	_, present, _ = varlib.ReadJournal()
	if present {
		t.Fatalf("journal should be absent after RemoveJournal")
	}
}

func TestJournalUnknownKindFailsClosed(t *testing.T) {
	root := t.TempDir()
	os.Chmod(root, 0o700) // EnsureBackupsDir requires a 0700-exact managed dir
	t.Setenv("MATHION_VARLIB_DIR", root)
	varlib.EnsureBackupsDir()
	os.WriteFile(varlib.JournalPath(), []byte(`{"schema":1,"kind":"bogus","backup_path":"/b"}`), 0o600)
	got, present, _ := varlib.ReadJournal()
	if !present || got.Fatal() == false { // Fatal() true => entry-check must refuse
		t.Fatalf("unknown kind must fail closed: %+v", got)
	}
}

func TestRecoveryCommandShellQuotes(t *testing.T) {
	got := varlib.RecoveryCommand("/var/lib/mathion/backups/my backup.tar.gz")
	if got != `mathion restore -- '/var/lib/mathion/backups/my backup.tar.gz'` {
		t.Fatalf("got %q", got)
	}
}
