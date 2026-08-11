package cmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

type updateOpts struct {
	Version    string
	NoRollback bool
	Yes        bool
}

// writeJournalFn is the step-6b breadcrumb writer; a package seam so a test can
// drive the pre-mutation 6b-write-failure path (RemoveSync + start app + abort)
// without corrupting the real backups dir.
var writeJournalFn = varlib.WriteJournal

// runUpdate performs an in-place upgrade: pull-verify a DISTINCT target, stop, take
// a consistent offline backup, migrate, re-pin, recreate, and gate — with
// auto-rollback on a clean failure. THIS skeleton implements steps 1-4 only
// (preconditions, same-tag guard, confirm, pull + capture the target image ID A);
// steps 5-10 + the failure matrix arrive in Tasks 21-23.
func runUpdate(ctx context.Context, a *App, opts updateOpts) error {
	// 1. Precondition: the STRENGTHENED env validation (ValidateEnvComplete also
	// ValidateOCITags MATHION_VERSION) BEFORE any docker mutation — so the same-tag
	// guard compares the target against a canonical .env tag == Compose's effective
	// tag, and a broken .env aborts before anything is pulled.
	env, err := config.ReadEnvFile(a.CfgDir)
	if err != nil {
		return err
	}
	if err := config.ValidateEnvComplete(env); err != nil {
		return err
	}
	oldTag := env["MATHION_VERSION"]

	// 2. Resolve target + same-tag guard (round-9 #2 — update NEVER pulls the active
	// tag: pulling imageRepo:<active> would MOVE the live deployment tag before any
	// backup/breadcrumb exists, so a crash could strand an unverified image that
	// `start` boots with no refusal). Only a DISTINCT target proceeds to the pull.
	target := opts.Version
	if target == "" {
		target = buildDefaultImage
	}
	if err := config.ValidateOCITag(target); err != nil {
		return err
	}
	if target == oldTag {
		// No pull. strictVersion=true so ONLY an exact JSON {"version":target} is a
		// match (a); a legacy 200 text/html SPA, a /version mismatch, or an
		// unreachable app all fall to (b). Reuses the gate's /version classifier.
		pass, _, _ := probeVersionOnce(ctx, target, true)
		if pass {
			fmt.Fprintf(a.Out, "already at %s; nothing to do\n", target)
		} else {
			fmt.Fprintf(a.Out, "already pinned to %s; a same-version refresh is not supported. To redeploy or repair a broken deployment, use mathion restore or reinstall.\n", target)
		}
		return nil
	}

	// 3. Confirm (plan + a failure clause branched on --no-rollback; --yes skips).
	if !opts.Yes {
		fmt.Fprintf(a.Out, "Update %s → %s: pull-verified → stop → back up → migrate → health-check\n", oldTag, target)
		if opts.NoRollback {
			fmt.Fprintln(a.Out, "on failure the stack is left as-is; recover with mathion restore -- <backup>")
		} else {
			fmt.Fprintln(a.Out, "auto-rollback on failure")
		}
		fmt.Fprint(a.Out, "Brief downtime during the update; block external traffic first. Continue? [y/N] ")
		line, _ := bufio.NewReader(a.In).ReadString('\n')
		if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
			return errors.New("update cancelled")
		}
	}

	// 4. Pull the DISTINCT target explicitly (a plain, non-compose docker pull), then
	// IMMEDIATELY capture the pulled image ID A. The step-10 gate compares the running
	// app's resolved ID against THIS captured A (not a tag re-resolved at gate time —
	// a rollback retag or a concurrent tag move could shift what imageRepo:<target>
	// resolves to between pull and gate). Bad tag / network fail → clean abort,
	// nothing changed, no backup taken.
	if err := a.Runner.Run(ctx, "pull", compose.ImageRepo+":"+target); err != nil {
		return fmt.Errorf("pulling %s:%s: %w", compose.ImageRepo, target, err)
	}
	rawID, err := a.Runner.Output(ctx, "image", "inspect", compose.ImageRepo+":"+target, "--format", "{{.Id}}")
	if err != nil {
		return fmt.Errorf("resolving pulled target image id: %w", err)
	}
	A := strings.TrimSpace(rawID)
	if A == "" {
		return errors.New("pulled target image has no id")
	}

	// Resolve the managed extraction ceilings ONCE — 6a's pre-mutation validation and
	// the later auto-rollback (Task 23) MUST use the SAME ceilings, so any backup 6a
	// accepts is one the rollback can also extract. A bad ceiling env aborts here,
	// before app is stopped.
	caps, err := archive.ManagedCaps(os.Getenv)
	if err != nil {
		return err
	}

	// (5) Stop app (db stays up) so the backup is a consistent OFFLINE snapshot. On a
	// stop failure nothing is mutated yet — abort plainly (app may still be up).
	if err := a.compose(ctx, "stop", "app"); err != nil {
		return err
	}

	// (6) Offline auto-backup — the rollback point, retained in backups/. On failure,
	// bring app back up (uncancelled ctx) and abort.
	backupPath, err := backupEngine(ctx, a, "")
	if err != nil {
		startAppOnAbort(ctx, a)
		return err
	}

	// (6a) Validate the rollback point BEFORE mutating: the restore engine's
	// NON-MUTATING prefix (allowlist-extract + per-member sha256 + manifest checks +
	// inner assets.tar pre-scan + read-only image preflight — 4a only, NO 6c retag),
	// under the SAME managed caps the rollback will use. A backup restore would reject
	// is caught HERE, as a clean pre-mutation abort — not a self-rejecting rollback
	// mid-outage. Failure → start app (uncancelled) + abort, nothing mutated.
	if err := validateBackup(ctx, a, backupPath, caps); err != nil {
		startAppOnAbort(ctx, a)
		return err
	}

	// (6b) Durable crash breadcrumb — AFTER the backup is validated, BEFORE any
	// mutation. kind:"update" routes the entry-check; target_image_id == the captured
	// A makes the refuse path's manual-clear escape verifiable. AtomicWrite + parent
	// -dir fsync (varlib.WriteJournal). A 6b write failure is PRE-mutation: idempotently
	// RemoveSync any partial breadcrumb, start app (uncancelled), and abort — reporting
	// both errors if the cleanup is not durable; nothing was migrated.
	j := varlib.Journal{
		Schema:        1,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
		Kind:          "update",
		OldTag:        oldTag,
		TargetTag:     target,
		TargetImageID: A,
		BackupPath:    backupPath,
	}
	if err := writeJournalFn(j); err != nil {
		rmErr := varlib.RemoveJournal()
		startAppOnAbort(ctx, a)
		if rmErr != nil {
			return fmt.Errorf("%w; also could not clear the partial breadcrumb at %s: %v", err, varlib.JournalPath(), rmErr)
		}
		return err
	}

	return nil // steps 7-10 (migrate, re-pin, recreate, gate, commit) in Task 22
}

// startAppOnAbort best-effort restarts app after a pre-mutation abort in steps 5-6b,
// under context.WithoutCancel so a signal that cancelled ctx cannot stop app from
// coming back up. Errors are swallowed — the abort's own error is what matters.
func startAppOnAbort(ctx context.Context, a *App) {
	_ = a.compose(context.WithoutCancel(ctx), "start", "app")
}

// validateBackup runs the restore engine's non-mutating prefix (Extract + sha256 +
// manifest checks + inner assets.tar pre-scan + read-only preflightImage — 4a only,
// NO 6c retag) against a backup archive, discarding a disposable staging dir. It is
// the pre-mutation gate for update step 6a and the reason update never mutates atop
// a backup the auto-rollback could not restore. Callable standalone.
func validateBackup(ctx context.Context, a *App, path string, caps archive.Caps) error {
	staging, err := varlib.StagingDir()
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	m, err := archive.Extract(staging, path, caps)
	if err != nil {
		return err
	}
	if err := archive.PrescanAssets(filepath.Join(staging, "assets.tar")); err != nil {
		return err
	}
	// Read-only image preflight (4a). It never returns an error (it resolves or
	// pull-flags), so it does not gate validation; it is here for spec-parity with the
	// restore prefix and to surface the recorded-vs-local id warning. It performs NO
	// retag (6c) — so 6a cannot clobber the target image update pulled at step 4.
	if _, err := preflightImage(ctx, a, m); err != nil {
		return err
	}
	return nil
}
