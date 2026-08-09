package varlib

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// Journal is the durable recovery breadcrumb written before a backup/restore/
// update operation moves a deployment-affecting Docker tag. On clean completion
// the operation removes it; a later run that finds it knows a prior operation
// crashed mid-flight and must REFUSE (fail closed) and tell the operator how to
// recover.
//
// decodeErr is unexported so encoding/json never serializes it; ReadJournal sets
// it only when the on-disk breadcrumb fails to decode, and Fatal() surfaces it.
type Journal struct {
	Schema        int    `json:"schema"`
	CreatedAt     string `json:"created_at"`
	Kind          string `json:"kind"`
	OldTag        string `json:"old_tag,omitempty"`
	TargetTag     string `json:"target_tag"`
	TargetImageID string `json:"target_image_id,omitempty"`
	BackupPath    string `json:"backup_path"`

	decodeErr error
}

// JournalPath returns the on-disk path of the recovery breadcrumb.
func JournalPath() string {
	return filepath.Join(BackupsDir(), ".update-journal.json")
}

// WriteJournal serializes j and writes it durably (atomic temp+rename+dir-fsync)
// so the breadcrumb survives a crash immediately after the write.
func WriteJournal(j Journal) error {
	b, err := json.Marshal(j)
	if err != nil {
		return err
	}
	return config.AtomicWrite(JournalPath(), b, 0o600)
}

// ReadJournal reads the recovery breadcrumb, failing closed. It returns:
//   - (nil, false, nil)                  when no breadcrumb file exists;
//   - (nil, false, err)                  on any other read error;
//   - (&Journal{decodeErr: err}, true, nil) when the file is present but does not
//     decode (corrupt/empty) — present, with Fatal() true;
//   - (&j, true, nil)                    when it decodes (even if kind is
//     unknown/empty — usability is decided by Fatal(), never by hiding it).
//
// present == true whenever a breadcrumb file exists in any form, so a decode or
// kind problem is refused rather than fail-open.
func ReadJournal() (*Journal, bool, error) {
	b, err := os.ReadFile(JournalPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	var j Journal
	if err := json.Unmarshal(b, &j); err != nil {
		return &Journal{decodeErr: err}, true, nil
	}
	return &j, true, nil
}

// Fatal reports whether the breadcrumb means the entry-check must REFUSE: it did
// not decode, or its kind is not a known operation, or it names no backup.
func (j *Journal) Fatal() bool {
	return j.decodeErr != nil || (j.Kind != "update" && j.Kind != "restore") || j.BackupPath == ""
}

// RemoveJournal clears the breadcrumb (idempotent unlink + parent-dir fsync) so a
// clean completion leaves nothing for a later run to refuse on.
func RemoveJournal() error {
	return config.RemoveSync(JournalPath())
}

// RecoveryCommand returns the exact shell command an operator runs to recover
// from a crashed operation. The backup path is POSIX single-quote escaped and the
// `--` guards a leading-`-` path, so a path with spaces stays one argument.
func RecoveryCommand(backupPath string) string {
	return "mathion restore -- " + shellQuote(backupPath)
}

// shellQuote wraps s in single quotes, escaping any embedded single quote via the
// standard POSIX close-escape-reopen idiom so the result is a single, literal
// shell word.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
