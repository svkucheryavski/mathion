package cmd

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// newBackupCmd builds the `mathion backup` command. It is the first lock-taking
// command and establishes the preamble order every such command follows:
// root check -> ensure managed backups dir -> take the operation lock (held for
// the whole run) -> sweep stale staging + orphaned worker containers -> refuse on
// a leftover recovery breadcrumb -> run the lock-free engine. guardEntry runs
// AFTER the lock so a concurrent operation cannot race the breadcrumb check.
func newBackupCmd(app *App) *cobra.Command {
	var out string
	c := &cobra.Command{
		Use:   "backup",
		Short: "Back up the database and assets to a managed archive",
		RunE: func(c *cobra.Command, _ []string) error {
			if err := requireRoot(); err != nil {
				return err
			}
			if err := varlib.EnsureBackupsDir(); err != nil {
				return err
			}
			release, err := varlib.Lock()
			if err != nil {
				return err // ErrLocked message is already clear
			}
			defer func() { _ = release() }()
			if err := varlib.SweepStaleStaging(); err != nil {
				return err
			}
			if err := dockerx.SweepWorkers(c.Context(), app.Runner, app.Project); err != nil {
				return err
			}
			if proceed, err := guardEntry(app, "backup"); !proceed {
				return err
			}
			_, err = backupEngine(c.Context(), app, out)
			return err
		},
	}
	c.Flags().StringVar(&out, "out", "", "also copy the archive to PATH (must not exist; a symlink is refused)")
	return c
}

// backupEngine performs a lock-free, online backup: it dumps the database and the
// asset tree into a fresh 0700 staging dir, records a metadata manifest, assembles
// a durable mathion-backup-<ts>-<ver>.tar.gz under the managed backups dir, and
// optionally copies it to an operator --out path. It returns the managed archive
// path.
//
// The caller (the `backup` command, Task 13) owns the root check, operation lock,
// and stale-staging sweep; this engine takes no lock.
func backupEngine(ctx context.Context, a *App, out string) (string, error) {
	// 1. Fresh 0700 staging dir; nothing partial survives a failure.
	staging, err := varlib.StagingDir()
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	dbPath := filepath.Join(staging, "db.dump")
	assetsPath := filepath.Join(staging, "assets.tar")

	// 2. db-running precondition (the first runner call). No point dumping a stack
	// that is down — and it keeps the error crisp instead of a raw compose failure.
	cid, _ := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "db")...)
	if strings.TrimSpace(cid) == "" {
		return "", errors.New("start the stack first: mathion start")
	}

	// 3. DB dump -> staging/db.dump. ANY error here is fatal, but a
	// *compose.ExitError MUST be scrubbed before it surfaces — pg_dump stderr can
	// embed row-level PII (see spoolPGStderr).
	if err := streamToFile(ctx, a, dbPath, a.composeArgs(
		"exec", "-T", "db", "sh", "-c",
		`PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"`,
	)); err != nil {
		return "", spoolPGStderr("pg_dump", err)
	}

	// 4. Assets -> staging/assets.tar. This is an online snapshot: a concurrent
	// upload can change/remove a file mid-read, which GNU tar reports as exit 1 —
	// tolerable, we keep the best-effort archive. Exit >=2 (or any non-ExitError,
	// e.g. spawn failure / context cancel) is a real failure. --pull never keeps the
	// one-off from reaching for the registry.
	if err := streamToFile(ctx, a, assetsPath, a.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never", "-T", "app", "sh", "-c",
		`tar -C /data/mathion/assets -cf - .`,
	)); err != nil {
		var ee *compose.ExitError
		if errors.As(err, &ee) && ee.Code == 1 {
			fmt.Fprintln(a.Err, "warning: asset files changed during backup (tar exit 1); archive holds a best-effort snapshot")
		} else {
			return "", err
		}
	}

	// 5. Alembic revision (informational only; never fatal). Parsed defensively so
	// odd/empty/multi-head output cannot break a backup.
	rawRev, _ := a.Runner.Output(ctx, a.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never", "-T", "app", "alembic", "current",
	)...)
	rev := parseAlembicRev(rawRev)

	// 6. image id probe (empty on any failure -> restore takes the tag-pull path).
	id := probeImageID(ctx, a)

	// 7. Manifest + assemble. Hash each staging file, then stream-assemble the
	// archive into the managed backups dir.
	dbHash, err := hashFile(dbPath)
	if err != nil {
		return "", err
	}
	assetsHash, err := hashFile(assetsPath)
	if err != nil {
		return "", err
	}
	env, _ := config.ReadEnvFile(a.CfgDir) // best-effort: absent .env -> empty metadata, tolerated
	manifest := archive.Manifest{
		Schema:          1,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339),
		MathionVersion:  env["MATHION_VERSION"],
		ImageID:         id,
		AlembicRevision: rev,
		CLIVersion:      buildVersion,
		DBName:          env["POSTGRES_DB"],
		SHA256: map[string]string{
			"db.dump":    dbHash,
			"assets.tar": assetsHash,
		},
	}
	final, err := archive.Assemble(varlib.BackupsDir(), map[string]string{
		"db.dump":    dbPath,
		"assets.tar": assetsPath,
	}, manifest)
	if err != nil {
		return "", err
	}

	// 8. --out copy (if requested). O_EXCL|O_NOFOLLOW refuses an existing or
	// symlinked target. A failed --out does NOT lose the managed backup: return
	// non-nil but STILL report the managed archive path so the operator can find it.
	if out != "" {
		if err := copyOut(final, out); err != nil {
			return final, fmt.Errorf("backup saved to %s, but copying to --out %q failed: %w", final, out, err)
		}
	}

	// 9. Report.
	if fi, statErr := os.Stat(final); statErr == nil {
		fmt.Fprintf(a.Out, "backup written to %s (%d bytes)\n", final, fi.Size())
	} else {
		fmt.Fprintf(a.Out, "backup written to %s\n", final)
	}
	return final, nil
}

// streamToFile opens dst as a fresh 0600 file (O_EXCL — the staging dir is empty)
// and streams the runner's child stdout for args into it, returning the runner
// error (if any) after closing the file.
func streamToFile(ctx context.Context, a *App, dst string, args []string) error {
	f, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	streamErr := a.Runner.Stream(ctx, f, args...)
	closeErr := f.Close()
	if streamErr != nil {
		return streamErr
	}
	return closeErr
}

// spoolPGStderr turns a pg_dump (or any pg one-off — restore reuses this) failure
// into an operator-safe error. A *compose.ExitError's raw stderr can embed
// row-level PII, so the FULL stderr is written to a 0600 pg-error-*.log that
// PERSISTS under varlib.Root(), and the returned error names ONLY the op, exit
// code, and log path — never the stderr bytes. A non-ExitError (context cancel,
// spawn failure) carries no captured stderr and passes through unchanged.
func spoolPGStderr(op string, err error) error {
	var ee *compose.ExitError
	if !errors.As(err, &ee) {
		return err
	}
	f, cerr := os.CreateTemp(varlib.Root(), "pg-error-*.log") // CreateTemp -> 0600
	if cerr != nil {
		// Still must not leak the stderr — report only that the save failed.
		return fmt.Errorf("%s failed (exit %d); stderr could not be saved (%v)", op, ee.Code, cerr)
	}
	// Check the write/sync/close: pg_dump often fails BECAUSE the disk is full,
	// which is exactly when this spool truncates. Only a fully persisted log lets
	// us truthfully claim "full stderr saved"; on any I/O failure remove the
	// incomplete log and say so. The io error is an fs error (not the stderr
	// bytes), so it is safe to surface; ee.Stderr is NEVER included.
	path := f.Name()
	n, werr := f.Write(ee.Stderr)
	if werr == nil && n != len(ee.Stderr) {
		werr = fmt.Errorf("short write %d/%d", n, len(ee.Stderr))
	}
	syncErr := f.Sync()
	closeErr := f.Close()
	if ioErr := cmp.Or(werr, syncErr, closeErr); ioErr != nil {
		_ = os.Remove(path)
		return fmt.Errorf("%s failed (exit %d); stderr could not be fully saved (%v)", op, ee.Code, ioErr)
	}
	return fmt.Errorf("%s failed (exit %d); full stderr (may contain PII) saved to %s", op, ee.Code, path)
}

// copyOut copies src to dst, refusing an existing or symlinked dst
// (O_CREATE|O_EXCL|O_NOFOLLOW) and writing it 0600, fsynced before close.
func copyOut(src, dst string) error {
	df, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return err
	}
	sf, err := os.Open(src)
	if err != nil {
		_ = df.Close()
		return err
	}
	_, copyErr := io.Copy(df, sf)
	_ = sf.Close()
	if copyErr != nil {
		_ = df.Close()
		return copyErr
	}
	if syncErr := df.Sync(); syncErr != nil {
		_ = df.Close()
		return syncErr
	}
	return df.Close()
}

// probeImageID resolves the running app image id for the manifest. It prefers the
// live app container's .Image (a raw `docker inspect`, NOT a compose call); if no
// app container is up it falls back to inspecting the pinned ImageRepo:tag. Any
// failure yields "" so restore takes the tag-pull path rather than trusting a
// wrong id.
func probeImageID(ctx context.Context, a *App) string {
	if acid, _ := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...); strings.TrimSpace(acid) != "" {
		id, err := a.Runner.Output(ctx, "inspect", strings.TrimSpace(acid), "--format", "{{.Image}}")
		if err != nil {
			return ""
		}
		return strings.TrimSpace(id)
	}
	env, _ := config.ReadEnvFile(a.CfgDir)
	id, err := a.Runner.Output(ctx, "image", "inspect", compose.ImageRepo+":"+env["MATHION_VERSION"], "--format", "{{.Id}}")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(id)
}

// parseAlembicRev extracts the revision id from `alembic current` output: the
// first whitespace token of the last non-empty line, with a trailing "(head)"
// marker stripped. Empty output yields ""; multi-head output degrades to the
// first head. Purely informational, so it never errors.
func parseAlembicRev(out string) string {
	var last string
	for _, ln := range strings.Split(out, "\n") {
		if strings.TrimSpace(ln) != "" {
			last = ln
		}
	}
	fields := strings.Fields(last)
	if len(fields) == 0 {
		return ""
	}
	return strings.TrimSuffix(fields[0], "(head)")
}

// hashFile returns the lowercase-hex sha256 of the file at path.
func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	return archive.SHA256Of(f)
}
