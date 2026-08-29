package cmd

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
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

type updateOpts struct {
	Version     string
	NoRollback  bool
	Yes         bool
	NoReconcile bool
}

// writeJournalFn is the step-6b breadcrumb writer; a package seam so a test can
// drive the pre-mutation 6b-write-failure path (RemoveSync + start app + abort)
// without corrupting the real backups dir.
var writeJournalFn = varlib.WriteJournal

const (
	restoreWaitTimeout     = 120 * time.Second
	restoreWaitTimeoutSecs = "120"
)

// writeMarkerFn is the apply-pending marker writer; a package seam (like writeJournalFn)
// so a test can drive the marker-write-failure branch of applyAndGate.
var writeMarkerFn = varlib.WriteMarker

// applyAndGate writes the marker, materializes+brings up the NEW compose, re-asserts the
// strict gate against gateID, and clears the marker ONLY after the gate passes. On ANY
// failure it best-effort restores prev and RETAINS the marker. Lock-free. Returns
// (restored, err): restored says whether the pre-apply state is back in place. NEVER
// calls updateFailure/restoreEngine — no DB rollback is reachable here.
func (a *App) applyAndGate(ctx context.Context, prev []byte, gateID, target string) (bool, error) {
	if e := writeMarkerFn(); e != nil {
		// Compose untouched, app unchanged → prior state intact, nothing to restore.
		return true, fmt.Errorf("could not record the pending stack apply: %w", e)
	}
	e := a.applyStack(ctx)
	if e == nil {
		e = gateFn(ctx, a, gateID, target, true)
	}
	if e != nil {
		return restorePrevCompose(ctx, a, prev), e // marker RETAINED → status/next-update self-heal
	}
	a.clearApplyMarker()
	return false, nil
}

// restorePrevCompose best-effort returns the deployment to its pre-apply, gate-proven
// stack definition. Bounded by a deadline AND --wait-timeout so a wedged restore cannot
// hold varlib.Lock forever; WithoutCancel so a late signal cannot abort the recovery.
// Guards an empty prev (writing 0 bytes would be worse than leaving what's there).
func restorePrevCompose(ctx context.Context, a *App, prev []byte) bool {
	if len(prev) == 0 {
		return false
	}
	if err := config.AtomicWrite(composePath(a), prev, 0o644); err != nil {
		return false
	}
	a.tlsEnabled = tlsEnabledFromEnv(a.CfgDir)
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), restoreWaitTimeout)
	defer cancel()
	return a.compose(rctx, "up", "-d", "--wait", "--wait-timeout", restoreWaitTimeoutSecs, "--pull", "never") == nil
}

// runningAppImageID resolves the RUNNING app CONTAINER's image id (compose ps -q app →
// inspect <cid> --format {{.Image}}), the same anchor gateFn uses (gate.go:44-53). NOT a
// re-inspection of the tag, which would already reflect an out-of-band tag move. Errors
// out (no tag fallback) so a run without a resolvable running image aborts before mutating.
func runningAppImageID(ctx context.Context, a *App) (string, error) {
	cout, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
	if err != nil {
		return "", fmt.Errorf("resolving the running app container: %w", err)
	}
	cid := strings.TrimSpace(cout)
	if cid == "" {
		return "", errors.New("no running app container")
	}
	raw, err := a.Runner.Output(ctx, "inspect", cid, "--format", "{{.Image}}")
	if err != nil {
		return "", fmt.Errorf("inspecting the running app image: %w", err)
	}
	id := strings.TrimSpace(raw)
	if id == "" {
		return "", errors.New("running app container has no image id")
	}
	return id, nil
}

// rollbackFailedError marks the worst update outcome: the update failed AND the auto-
// rollback to the pre-update backup ALSO failed, so the deployment is left in an unknown
// state with the recovery breadcrumb intact. exitCode maps it to 3 (distinct from a plain
// failure's 1) so an operator/automation can tell "failed but recovered" from "failed and
// NOT recovered — manual intervention required".
type rollbackFailedError struct{ err error }

func (e rollbackFailedError) Error() string { return e.err.Error() }
func (e rollbackFailedError) Unwrap() error { return e.err }

// committedPendingError: the image/DB update COMMITTED and the DB must NOT be rolled
// back, but required post-commit work (clear the recovery journal, or apply/verify the
// stack definition) did not finish. Exit 2 — distinct from 0/1/3.
type committedPendingError struct{ err error }

func (e committedPendingError) Error() string { return e.err.Error() }
func (e committedPendingError) Unwrap() error { return e.err }

// exitCode maps a top-level command error to a process exit code: 0 (nil), 3 (a
// rollbackFailedError anywhere in the chain), 2 (a committedPendingError), else 1.
// root.go's Execute calls osExit(exitCode(err)).
func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var rbf rollbackFailedError
	if errors.As(err, &rbf) {
		return 3
	}
	var cpe committedPendingError
	if errors.As(err, &cpe) {
		return 2
	}
	return 1
}

// withSignalCancel returns a child ctx cancelled on the FIRST SIGINT/SIGTERM (a graceful
// stop the update failure handler observes via ctx.Err()) and hard-exits 130 on the SECOND
// (an impatient operator's escape hatch, bypassing any in-flight rollback). stop() (deferred
// by the caller) unregisters the handler and releases the goroutine on the normal path.
// Installed ONLY for the update command's duration; exit is injectable for tests.
func withSignalCancel(parent context.Context, exit func(int)) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	ch := make(chan os.Signal, 2)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		defer signal.Stop(ch)
		select {
		case <-ch:
			cancel() // first signal: graceful cancel
		case <-done:
			return // command finished without a signal
		}
		select {
		case <-ch:
			exit(130) // second signal: hard exit
		case <-done:
			return
		}
	}()
	return ctx, func() { close(done); cancel() }
}

// updateFailMeta carries the state a step-7..10 failure needs to recover.
type updateFailMeta struct {
	oldTag, target, backupPath, migrateWorker string
	caps                                      archive.Caps
}

// updateFailure is the failure matrix for a clean or interrupted step-7..10 error. It ALWAYS
// reaps the migrate one-off first (idempotent — covers a cancel, a clean non-zero migrate exit,
// or a transport error, any of which can leave the container behind despite --rm), then branches:
//   - ctx cancelled (an interrupt): REFUSE — no auto-rollback; leave the breadcrumb + failed
//     state and hand back the manual-recovery command (a half-known state is safer rewound
//     deliberately than automatically).
//   - --no-rollback: leave the breadcrumb + failed state; hand back the hint.
//   - otherwise (a clean failure, ctx live): auto-rollback IN-PROCESS to the just-taken backup
//     under a FRESH UNCANCELLED ctx (a late signal must not abort the rewind; the second-signal
//     hard-exit is the only way out). On success clear the breadcrumb (a failed clear only WARNS);
//     on failure return a rollbackFailedError (exit 3) with the breadcrumb LEFT IN PLACE.
func updateFailure(ctx context.Context, a *App, opts updateOpts, m updateFailMeta, cause error) error {
	forceRemoveWorker(context.WithoutCancel(ctx), a.Runner, m.migrateWorker)

	if ctx.Err() != nil {
		return fmt.Errorf("update %s → %s interrupted; the deployment may be partway through — recover with: %s (cause: %w)", m.oldTag, m.target, varlib.RecoveryCommand(m.backupPath), cause)
	}
	if opts.NoRollback {
		return fmt.Errorf("update %s → %s failed and --no-rollback is set; the deployment is left as-is — recover with: %s (cause: %w)", m.oldTag, m.target, varlib.RecoveryCommand(m.backupPath), cause)
	}

	fmt.Fprintf(a.Err, "update %s → %s failed (%v); rolling back to %s\n", m.oldTag, m.target, cause, m.backupPath)
	if rbErr := restoreEngine(context.WithoutCancel(ctx), a, m.backupPath, restoreOpts{Yes: true, WriteBreadcrumb: false, Caps: m.caps}); rbErr != nil {
		return rollbackFailedError{err: fmt.Errorf("update %s → %s failed (%v) AND the auto-rollback to %s ALSO failed (%v); the deployment is in an UNKNOWN state — the recovery breadcrumb at %s is retained, recover manually with: %s", m.oldTag, m.target, cause, m.backupPath, rbErr, varlib.JournalPath(), varlib.RecoveryCommand(m.backupPath))}
	}
	if err := varlib.RemoveJournal(); err != nil {
		fmt.Fprintf(a.Err, "rolled back to %s; the deployment is healthy — remove %s manually (%v)\n", m.backupPath, varlib.JournalPath(), err)
	}
	return fmt.Errorf("update %s → %s failed (%w); rolled back — the previous version is restored and serving", m.oldTag, m.target, cause)
}

// newUpdateCmd builds `mathion update`. It follows the lock-taking preamble backup/
// restore establish (root -> ensure backups dir -> lock -> sweeps -> entry-check), then
// installs a two-signal handler for the run's duration (first SIGINT/SIGTERM cancels
// gracefully so the failure handler refuses rather than auto-rolls-back; a second hard-
// exits 130) and drives runUpdate. "update" is in classify's REFUSE set, so a leftover
// breadcrumb makes guardEntry refuse.
func newUpdateCmd(app *App) *cobra.Command {
	var version string
	var noRollback, yes, noReconcile bool
	c := &cobra.Command{
		Use:   "update",
		Short: "Update the deployment to a new version (pull-verify → back up → migrate → health-check, auto-rollback on failure)",
		Long: `Update the deployment to a new version: pull-verify the target image, back up, migrate, health-check, then apply this release's embedded stack definition (auto-rollback on failure).

Exit codes: 0 success; 1 the update failed and was rolled back (or nothing changed); 2 the image/database update committed but applying/verifying this release's stack definition is still pending — re-run ` + "`sudo mathion reconcile`" + `; 3 the update failed AND its rollback also failed (deployment state unknown).`,
		Args: cobra.NoArgs,
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
			if proceed, err := guardEntry(app, "update"); !proceed {
				return err
			}
			if err := app.requireInstallComplete(); err != nil {
				return err
			}
			ctx, stop := withSignalCancel(c.Context(), osExit)
			defer stop()
			return runUpdate(ctx, app, updateOpts{Version: version, NoRollback: noRollback, Yes: yes, NoReconcile: noReconcile})
		},
	}
	c.Flags().StringVar(&version, "version", "", "target version tag (default: the CLI's built-in target)")
	c.Flags().BoolVar(&noRollback, "no-rollback", false, "on failure leave the deployment as-is instead of auto-rolling-back")
	c.Flags().BoolVar(&yes, "yes", false, "skip the update confirmation prompt")
	c.Flags().BoolVar(&noReconcile, "no-reconcile", false, "apply only the image upgrade; defer this release's stack-definition change")
	return c
}

// runUpdate performs an in-place upgrade end to end: pull-verify a DISTINCT target
// image (capturing its id A) → stop app → take + validate a consistent offline backup →
// write the recovery breadcrumb → migrate → re-pin .env → recreate app → STRICT gate =
// the commit point (a passing gate clears the breadcrumb and is never auto-rolled-back).
// A clean step-7..10 failure auto-rolls-back IN-PROCESS to the just-taken backup; an
// interrupt (ctx cancelled) or --no-rollback instead refuses, leaving the breadcrumb and
// failed state behind the manual-recovery hint. See updateFailure for the full matrix.
func runUpdate(ctx context.Context, a *App, opts updateOpts) error {
	// 0. Refuse a missing/non-regular/group-or-world-accessible .env BEFORE reading or
	// mutating anything — it holds secrets and, with a bundled TLS proxy, Compose
	// interpolates it into the proxy env. Shared verbatim with reconcile/tls.
	if err := a.requirePrivateEnv(); err != nil {
		return err
	}

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

	// Drift signal: the on-disk compose differs from this CLI's embedded stack, or a
	// pending-apply marker is present. wantApply folds --no-reconcile into the decision
	// the apply branches (Tasks 7–8) act on; a compose read error counts as drift so a
	// missing/unreadable file is reconciled rather than silently skipped.
	onDisk, readErr := os.ReadFile(composePath(a))
	composeDiffers := readErr != nil || !bytes.Equal(onDisk, compose.ComposeYAML)
	markerPresent, _ := varlib.MarkerPresent()
	drift := composeDiffers || markerPresent
	wantApply := drift && !opts.NoReconcile

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
		if wantApply {
			if !a.appRunning(ctx) {
				return errors.New("this release's stack definition needs applying, but the stack is not running; start it with `sudo mathion start`, then `sudo mathion reconcile` (or re-run update)")
			}
			if !opts.Yes {
				msg := "a previous stack apply did not finish; re-apply this CLI's stack definition now?"
				if composeDiffers {
					msg = "this release updates the stack definition; apply it now?"
				}
				fmt.Fprintf(a.Out, "%s any changed service is briefly recreated (an HTTPS interruption if the bundled proxy changed). Continue? [y/N] ", msg)
				line, _ := bufio.NewReader(a.In).ReadString('\n')
				if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
					return errors.New("update cancelled")
				}
			}
			stID, err := runningAppImageID(ctx, a)
			if err != nil {
				return err
			}
			restored, applyErr := a.applyAndGate(ctx, onDisk, stID, target)
			if applyErr != nil {
				if restored {
					return fmt.Errorf("applying this CLI's stack definition failed (%w); the previous definition is in place and the stack is running — retry with `sudo mathion reconcile`", applyErr)
				}
				return fmt.Errorf("applying this CLI's stack definition failed (%w) AND restoring the previous definition also failed; the runtime may be degraded — run `mathion status`, then `sudo mathion reconcile`", applyErr)
			}
			fmt.Fprintf(a.Out, "applied this CLI's stack definition (%s); run `mathion status` to confirm.\n", buildVersion)
			return nil
		}
		pass, _, _ := probeVersionOnce(ctx, target, true)
		if pass {
			fmt.Fprintf(a.Out, "already at %s; nothing to do\n", target)
		} else {
			fmt.Fprintf(a.Out, "already pinned to %s; a same-version refresh is not supported. To redeploy or repair a broken deployment, use mathion restore or reinstall.\n", target)
		}
		if opts.NoReconcile && drift {
			fmt.Fprintln(a.Out, "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile")
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
		if composeDiffers {
			fmt.Fprintln(a.Out, "This release also updates the stack definition; it is applied after the update completes (brief HTTPS interruption if the bundled proxy changed).")
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

	// (7) Migrate WITHOUT serving and WITHOUT re-pinning, via the env-aware RunEnv. The
	// appended MATHION_VERSION=<target> overrides the sanitized baseline so the one-off
	// runs the TARGET image while .env still pins the old tag. A plain `run` (App.compose)
	// CANNOT set the env — it would interpolate the OLD ${MATHION_VERSION}, run the old
	// image, apply nothing, and make the gate fail → a rollback EVERY time. The
	// deterministic --name/--label let the Task-23 failure handler force-remove a
	// still-running migrate one-off and let the startup sweep reap it after a SIGKILL.
	migrateWorker := fmt.Sprintf("mathion_migrate_%d", os.Getpid())
	meta := updateFailMeta{oldTag: oldTag, target: target, backupPath: backupPath, migrateWorker: migrateWorker, caps: caps}
	if err := a.Runner.RunEnv(ctx, []string{"MATHION_VERSION=" + target}, a.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never",
		"--name", migrateWorker, "--label", "io.mathion.worker=1",
		"-T", "app", "alembic", "upgrade", "head",
	)...); err != nil {
		return updateFailure(ctx, a, opts, meta, err)
	}

	// (8) Re-pin MATHION_VERSION=<target> — ONLY now, after migrate succeeded (line
	// -oriented, atomic, validated, assert-after-write inside RepinVersion).
	if err := config.RepinVersion(a.CfgDir, target); err != nil {
		return updateFailure(ctx, a, opts, meta, err)
	}

	// (9) Recreate app on the migrated schema (--pull never — target already pulled at
	// step 4; --wait blocks on the healthcheck).
	if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never", "app"); err != nil {
		return updateFailure(ctx, a, opts, meta, err)
	}

	// (10) STRICT gate = the commit point: the running app's resolved image ID must ==
	// the captured A (NOT a re-resolved tag), plus a strict JSON /version=={"version":
	// target} (a forward update always targets a slice-3+ image, so /version is present
	// and exact — no legacy SPA/404 tolerance here; that applies only to the rollback's
	// own gate). A passing gate = committed; NEVER auto-rolled-back thereafter.
	if err := gateFn(ctx, a, A, target, true); err != nil {
		return updateFailure(ctx, a, opts, meta, err)
	}

	// Committed. Clear the breadcrumb. A FAILED clear is a DISTINCT non-rollback warning
	// (the update is healthy — do NOT roll back / enter the matrix / exit 3); a leftover
	// breadcrumb would otherwise make the next command refuse.
	if err := varlib.RemoveJournal(); err != nil {
		return committedPendingError{err: fmt.Errorf("updated %s → %s successfully, but could not remove the recovery breadcrumb %s; the deployment is healthy — verify the app serves %s (running image ID == %s), then remove %s manually: %w",
			oldTag, target, varlib.JournalPath(), target, A, varlib.JournalPath(), err)}
	}
	if wantApply {
		restored, applyErr := a.applyAndGate(ctx, onDisk, A, target)
		if applyErr != nil {
			if restored {
				return committedPendingError{err: fmt.Errorf("updated to %s and it is serving; applying this release's stack definition failed (%w) and the previous definition is in place — the database is intact, re-apply with: sudo mathion reconcile", target, applyErr)}
			}
			return committedPendingError{err: fmt.Errorf("updated to %s (database committed and NOT rolled back), but applying this release's stack definition failed (%w) AND restoring the previous definition also failed; the runtime may be degraded — run `mathion status`, then `sudo mathion reconcile`", target, applyErr)}
		}
		fmt.Fprintf(a.Out, "updated %s → %s and applied this release's stack definition (%s) (backup: %s; prune old backups manually)\n", oldTag, target, buildVersion, backupPath)
		return nil
	}
	if opts.NoReconcile && drift {
		fmt.Fprintln(a.Out, "note: this release's stack definition was NOT applied (--no-reconcile); apply it later with: sudo mathion reconcile")
	}
	fmt.Fprintf(a.Out, "updated %s → %s (backup: %s; prune old backups manually)\n", oldTag, target, backupPath)
	return nil
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
