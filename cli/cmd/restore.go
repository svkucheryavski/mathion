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

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// newRestoreCmd builds `mathion restore`. It follows the same lock-taking preamble
// as backup (root -> ensure backups dir -> lock -> sweeps -> entry-check -> work),
// but restore is EXEMPT from the breadcrumb refusal (classify("restore")==proceed):
// it is a recovery command and RUNS WITH a leftover breadcrumb, replacing it with
// its own kind:"restore" one at step 6b and clearing it at step 10 on a clean gate.
func newRestoreCmd(app *App) *cobra.Command {
	var latest, yes bool
	c := &cobra.Command{
		Use:   "restore [archive]",
		Short: "Restore the database and assets from a managed or explicit backup archive",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			if err := requireRoot(); err != nil {
				return err
			}
			// Usage validation (fail fast, before the lock): EXACTLY one target source.
			if latest && len(args) > 0 {
				return errors.New("--latest and an explicit archive path are mutually exclusive")
			}
			if !latest && len(args) == 0 {
				return errors.New("provide an archive path or --latest")
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
			if proceed, err := guardEntry(app, "restore"); !proceed {
				return err // restore is exempt; this only trips on a hard read error's fail-closed path
			}
			if err := app.requireInstallComplete(); err != nil {
				return err
			}
			// Resolve the target archive (SelectLatest needs the ensured backups dir).
			path := ""
			if latest {
				path, err = archive.SelectLatest(varlib.BackupsDir())
				if err != nil {
					return err
				}
			} else {
				path = args[0]
			}
			caps, err := resolveRestoreCaps(path, varlib.BackupsDir())
			if err != nil {
				return err
			}
			return restoreEngine(c.Context(), app, path, restoreOpts{Yes: yes, WriteBreadcrumb: true, Caps: caps})
		},
	}
	c.Flags().BoolVar(&latest, "latest", false, "restore the most recent managed backup in the backups dir")
	c.Flags().BoolVar(&yes, "yes", false, "skip the destructive-restore confirmation prompt")
	return c
}

// resolveRestoreCaps picks the extraction tier for archivePath, honoring the
// operator's overrides for a MANAGED archive exactly as update does (update.go's
// step-4 ManagedCaps(os.Getenv) call). TierFor deliberately returns only the managed
// DEFAULTS for a backups-dir archive — its doc contract is that the restore flow
// itself calls ManagedCaps when it wants the MATHION_RESTORE_MAX_* overrides — so this
// is where restore honors them:
//   - MANAGED (path resolves under backupsDir): ManagedCaps(os.Getenv), HARD-FAILING on
//     a malformed override rather than silently widening/narrowing the DoS envelope.
//   - UNTRUSTED (anywhere else): the FIXED UntrustedCaps, which is NOT env-overridable —
//     a hostile /tmp archive can never widen its own caps.
//
// The UntrustedCaps() sentinel comparison is safe: Caps is a comparable 2×int64 struct
// and the managed defaults (50/120 GiB) never equal the untrusted tier (2/5 GiB).
func resolveRestoreCaps(archivePath, backupsDir string) (archive.Caps, error) {
	caps := archive.TierFor(archivePath, backupsDir)
	if caps == archive.UntrustedCaps() { // untrusted: fixed tier, overrides ignored
		return caps, nil
	}
	return archive.ManagedCaps(os.Getenv)
}

// gateFn is the deployment gate restoreEngine runs at step 10; a package seam so
// full-engine tests drive step-10 outcomes without a live app + HTTP server (the
// gate's own logic is covered directly by gate_test.go).
var gateFn = gateImageAndVersion

// imageResolve is the outcome of the read-only restore image preflight (step 4a):
// which local image the rewind would boot. RID is the resolved image id; when it
// is empty PullFlagged is set, deferring the tag-moving pull/retag to a later,
// post-confirmation step.
type imageResolve struct {
	RID         string
	PullFlagged bool
}

// preflightImage resolves — READ-ONLY — which local image a restore would boot.
// It issues ONLY `docker image inspect` reads: never a `docker pull` (which would
// move the ImageRepo:version tag) and never a `docker tag`. Those mutations are
// deferred to the post-confirmation step.
//
// Resolution order:
//  1. Recorded id first (avoids a needless tag-moving pull): if the manifest
//     records an image id and that exact image is locally present, boot it. On an
//     auto-rollback the pre-update image is always local, so this is the common hit.
//  2. Local tag else: inspect ImageRepo:version and use its current id. If the
//     manifest recorded a DIFFERENT id, warn loudly — restore will boot the local
//     tag's image (gated on its resolved id, not the tag string).
//  3. Neither present: flag the pull for the later step; RID stays empty here.
//
// A not-found from `image inspect` is EXPECTED (it drives the fallthrough), so it
// is never surfaced as an error — all three normal paths return (imageResolve, nil).
func preflightImage(ctx context.Context, a *App, m archive.Manifest) (imageResolve, error) {
	// 1. Recorded id first — success (nil error) is the signal; no --format needed.
	if m.ImageID != "" {
		if _, err := a.Runner.Output(ctx, "image", "inspect", m.ImageID); err == nil {
			return imageResolve{RID: m.ImageID}, nil
		}
	}

	// 2. Local tag — resolve its current id.
	out, err := a.Runner.Output(ctx, "image", "inspect", compose.ImageRepo+":"+m.MathionVersion, "--format", "{{.Id}}")
	if err == nil {
		if rid := strings.TrimSpace(out); rid != "" {
			if m.ImageID != "" && m.ImageID != rid {
				fmt.Fprintf(a.Err, "warning: recorded image id %s differs from the local %s:%s id %s; restore will boot the local tag's image\n",
					m.ImageID, compose.ImageRepo, m.MathionVersion, rid)
			}
			return imageResolve{RID: rid}, nil
		}
	}

	// 3. Neither present — defer the pull/retag to the post-confirmation step.
	return imageResolve{PullFlagged: true}, nil
}

// restoreOpts configures the restore engine. Yes bypasses the destructive typed
// confirmation (the internal auto-rollback caller always sets it). WriteBreadcrumb
// is set by the standalone `restore` command and cleared by update's callers (their
// own update breadcrumb already covers the interrupted-restore window, so they must
// not write a second one). Caps is the extraction tier the command resolved for
// archivePath.
type restoreOpts struct {
	Yes             bool
	WriteBreadcrumb bool
	Caps            archive.Caps
}

// restartTimeout bounds the best-effort docker-start recovery on a 6c pull error:
// long enough for a real start of an already-built container, short enough that a
// wedged daemon cannot hang recovery indefinitely.
const restartTimeout = 30 * time.Second

// restoreDBScript decode-gates the load: pg_restore -f "$t" fully decodes the -Fc dump
// BEFORE the DROP/CREATE SCHEMA + psql load, which run under ON_ERROR_STOP=1 and
// --single-transaction so any failure rolls back (DB unchanged). Never add -j/-l/-L to
// pg_restore here: they need a seekable input, but the -Fc archive arrives on a
// non-seekable stdin pipe. psql -h db targets the running db service, not this
// postmaster-less client. $POSTGRES_* come from the db service's environment (compose
// interpolates them from --env-file), never host argv.
const restoreDBScript = `t=$(mktemp) || exit 1; r=$(mktemp) || { rm -f "$t"; exit 1; }; pg_restore -f "$t"; rc=$?; if [ "$rc" -ne 0 ]; then rm -f "$t" "$r"; exit "$rc"; fi; printf "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION \"%s\";\n" "$POSTGRES_USER" > "$r" || { rm -f "$t" "$r"; exit 1; }; PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction -f "$r" -f "$t" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null; rc=$?; rm -f "$t" "$r"; exit "$rc"`

// restoreAssetsScript clears the assets volume's contents (dotfiles included, mountpoint
// kept) then extracts the pre-scanned assets.tar from stdin. --no-same-owner: the app
// container runs as a non-root uid; && stops extraction after a failed clear.
const restoreAssetsScript = `find /data/mathion/assets -mindepth 1 -delete && tar --no-same-owner -C /data/mathion/assets -xf -`

// workerRemoveTries bounds forceRemoveWorker's create/observe race loop.
const workerRemoveTries = 10

// restoreEngine rewinds the deployment from archivePath end to end: read/confirm/
// stage (steps 2, 4a, 5, 6, 6b, 6c), the destructive DB + assets load (steps 7-8),
// then the .env re-pin + app recreate + deployment gate (steps 9-10), clearing the
// recovery breadcrumb only once the gate confirms the correct image is serving.
// Nothing before step 6 mutates deployment state, so a declined confirmation or an
// extract/preflight failure leaves the deployment untouched.
func restoreEngine(ctx context.Context, a *App, archivePath string, opts restoreOpts) error {
	// (0) Whether a recovery breadcrumb was ALREADY present at entry — read before
	// 6b writes our own. restore is exempt from the entry-check refusal, so it may
	// run WITH a breadcrumb (as recovery); this flag gates the 6c restart. FAIL
	// CLOSED: a journal read error means we cannot prove the deployment is clean, so
	// treat it as "breadcrumb present" and SUPPRESS the best-effort restart — wrongly
	// restarting a recovery restore could boot an inconsistent pre-restore container
	// (e.g. an interrupted update's old app against a forward-migrated DB).
	_, present, jerr := varlib.ReadJournal()
	breadcrumbAtEntry := present || jerr != nil

	// (2) Extract + validate into a fresh 0700 staging dir. Any failure aborts
	// BEFORE any mutation; the staging dir is discarded no matter what.
	staging, err := varlib.StagingDir()
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	manifest, err := archive.Extract(staging, archivePath, opts.Caps)
	if err != nil {
		return err
	}
	// (3) Pre-scan the inner assets.tar for symlink/traversal — the outer extractor
	// only proved it is a regular file, not that its members are safe. This guards
	// step 8's extract, so abort here (before confirm/DB-load) on a hostile archive.
	if err := archive.PrescanAssets(filepath.Join(staging, "assets.tar")); err != nil {
		return err
	}

	// (4a) Read-only image preflight — resolve the boot image from LOCAL images.
	img, err := preflightImage(ctx, a, manifest)
	if err != nil {
		return err
	}

	// (5) Destructive confirmation (skipped by --yes and the internal caller).
	if !opts.Yes {
		if opts.Caps == archive.UntrustedCaps() {
			fmt.Fprintf(a.Err, "warning: %s is outside the managed backups dir; its contents are size-bounded, not trusted.\n", filepath.Base(archivePath))
		}
		fmt.Fprintf(a.Out, "This REPLACES the current database and assets with backup %s (version %s, created %s). Current data is lost.\nType the project name (%s) to confirm: ",
			filepath.Base(archivePath), manifest.MathionVersion, manifest.CreatedAt, a.Project)
		line, _ := bufio.NewReader(a.In).ReadString('\n')
		if strings.TrimSpace(line) != a.Project {
			return fmt.Errorf("confirmation did not match %q; aborting", a.Project)
		}
	}

	// (6) Capture the pre-restore app state BEFORE stopping it (round-11 #1), then
	// bring db up (idempotent — enables restore after a full-stack crash; --pull
	// never so a missing postgres:17 fails loudly instead of pulling) and stop app
	// so there are no writers during the load.
	preAppID, preHealthy := capturePreRestoreAppState(ctx, a)
	if err := a.compose(ctx, "up", "-d", "--pull", "never", "db"); err != nil {
		return err
	}
	if err := a.compose(ctx, "stop", "app"); err != nil {
		return err
	}

	// (6b) Standalone restore only: write the durable recovery breadcrumb BEFORE the
	// pull/retag and the (later) destructive load. target_image_id is absent when the
	// image is pull-flagged — finalized at 6c after the pull; an absent target keeps
	// the manual-clear escape disabled and the breadcrumb fail-closed.
	if opts.WriteBreadcrumb {
		if err := writeRestoreBreadcrumb(archivePath, manifest.MathionVersion, img.RID); err != nil {
			return err
		}
	}

	// (6c) Obtain (pull if flagged) + identity retag onto the boot tag.
	if img.PullFlagged {
		if err := a.Runner.Run(ctx, "pull", compose.ImageRepo+":"+manifest.MathionVersion); err != nil {
			// Lost-acknowledgement (round-10 #3): a CLI-level pull error does not
			// prove the daemon did not already move the <v> tag, so RETAIN the
			// breadcrumb and abort. Only a clean standalone restore — no breadcrumb
			// at entry AND an app that was running+health-passing at entry — may
			// best-effort restart its captured container; every other case leaves
			// app stopped behind the retained breadcrumb.
			if !breadcrumbAtEntry && preHealthy && preAppID != "" {
				// Order-critical: WithoutCancel wraps ctx FIRST, then WithTimeout —
				// the reverse strips the deadline WithTimeout just added. Detaching
				// from ctx lets the restart run even when the pull error is a Ctrl-C
				// that cancelled ctx (exec.CommandContext refuses to start on a
				// cancelled context). docker start by ID re-boots exactly the
				// pre-restore image, immune to any tag move.
				restartCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), restartTimeout)
				defer cancel()
				_ = a.Runner.Run(restartCtx, "start", preAppID) // best-effort; breadcrumb stays
			}
			return fmt.Errorf("pulling %s: %w", compose.ImageRepo+":"+manifest.MathionVersion, err)
		}
		// Pull succeeded: resolve the pulled id STRICTLY. If we cannot confirm the
		// resulting id (read failure or empty id), the post-pull state is UNCERTAIN —
		// retain the absent-id breadcrumb from 6b and abort rather than record an
		// unresolved target; a re-run then resolves the now-local image via 4a. A
		// successful pull already moved the boot tag onto the pulled digest, so NO
		// retag is needed on this path.
		rid, err := resolveImageID(ctx, a, manifest.MathionVersion)
		if err != nil {
			return fmt.Errorf("resolving pulled %s: %w", compose.ImageRepo+":"+manifest.MathionVersion, err)
		}
		img.RID = rid
		if manifest.ImageID != "" && manifest.ImageID != rid {
			fmt.Fprintf(a.Err, "warning: recorded image id %s differs from the pulled %s:%s id %s\n",
				manifest.ImageID, compose.ImageRepo, manifest.MathionVersion, rid)
		}
		if opts.WriteBreadcrumb {
			if err := writeRestoreBreadcrumb(archivePath, manifest.MathionVersion, rid); err != nil {
				return err
			}
		}
	} else {
		// Local-R_id path: retag if the boot tag does not already resolve to R_id (the
		// tag moved off the backed-up image, or R_id is a still-local recorded id the
		// current tag no longer points at). This runs ONLY when no pull happened — a
		// successful pull already moved the tag, so re-inspecting there risks a
		// transient failure spuriously retagging.
		if imageIDOfTag(ctx, a, manifest.MathionVersion) != img.RID {
			if err := a.Runner.Run(ctx, "tag", img.RID, compose.ImageRepo+":"+manifest.MathionVersion); err != nil {
				return err
			}
		}
	}

	// pid-scoped one-off worker names so cleanupWorkers can target exactly this run's
	// containers. Both loads are NAMED `compose run` one-offs (not `exec`) so a
	// cancellation can force-remove the whole decode+load lifecycle.
	pid := os.Getpid()
	dbWorker := fmt.Sprintf("mathion_restore_db_%d", pid)
	assetsWorker := fmt.Sprintf("mathion_restore_assets_%d", pid)

	// cleanupWorkers force-removes BOTH named workers under a fresh WithoutCancel
	// context (so it runs even when ctx was cancelled), before restoreEngine returns —
	// i.e. before the command layer releases the lock. Safe to call when a worker never
	// started (--rm already removed a completed one; a never-created name is stably
	// absent immediately).
	cleanupWorkers := func() {
		wc := context.WithoutCancel(ctx)
		forceRemoveWorker(wc, a.Runner, dbWorker)
		forceRemoveWorker(wc, a.Runner, assetsWorker)
	}

	// (7) Restore the DB: pg_restore fully DECODES the -Fc dump to a temp file, and only
	// then is the destructive DROP/CREATE SCHEMA + load run under ON_ERROR_STOP +
	// --single-transaction (so a mid-load failure rolls back; a bad decode never reaches
	// the DROP). Named one-off so cancellation force-removes the whole decode+load
	// lifecycle. pg stderr may embed row-level PII → spoolPGStderr, NEVER surface it.
	dbf, err := os.Open(filepath.Join(staging, "db.dump"))
	if err != nil {
		return err
	}
	defer dbf.Close()
	// Progress line: the psql load's stdout is redirected to /dev/null in restoreDBScript
	// (its DDL/command-tag echo is noise; errors still surface via the captured/spooled
	// stderr), so print a single status line here to show a large restore is working.
	fmt.Fprintln(a.Err, "restoring database...")
	if err := a.Runner.StreamIn(ctx, dbf, a.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never",
		"--name", dbWorker, "--label", "io.mathion.worker=1",
		"-T", "db", "sh", "-c", restoreDBScript,
	)...); err != nil {
		cleanupWorkers()
		return spoolPGStderr("pg_restore", err)
	}

	// (8) Restore assets on the manifest-target image (app still stopped). MATHION_VERSION
	// pins the validated target (retagged local at 6c) rather than the not-yet-re-pinned
	// .env tag. --pull never (target already local). find … -delete clears contents incl.
	// dotfiles without removing the mountpoint; --no-same-owner since the container runs as
	// a non-root uid; && stops extraction after a failed clear. DB first (transactional);
	// re-running the same restore is idempotent if assets fail after the DB is in.
	af, err := os.Open(filepath.Join(staging, "assets.tar"))
	if err != nil {
		return err
	}
	defer af.Close()
	if err := a.Runner.StreamInEnv(ctx, []string{"MATHION_VERSION=" + manifest.MathionVersion}, af, a.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never",
		"--name", assetsWorker, "--label", "io.mathion.worker=1",
		"-T", "app", "sh", "-c", restoreAssetsScript,
	)...); err != nil {
		cleanupWorkers()
		return fmt.Errorf("restoring assets: %w", err)
	}

	// (9) Re-pin .env to the restored version (assert-after-write inside RepinVersion),
	// then recreate app on the validated, now-local target image. --wait owns the
	// health-wait; --pull never because 6c guaranteed the image is local.
	if err := config.RepinVersion(a.CfgDir, manifest.MathionVersion); err != nil {
		return err
	}
	if err := a.compose(ctx, "up", "-d", "--wait", "--pull", "never", "app"); err != nil {
		return err
	}
	// (10) Gate: authoritative image-ID match + legacy-tolerant /version. Restore is
	// non-strict (a rewind to a pre-/version image must pass on the SPA/404 shape).
	if err := gateFn(ctx, a, img.RID, manifest.MathionVersion, false); err != nil {
		return err
	}
	// Gate passed = the correct image is serving. A STANDALONE restore now clears its
	// step-6b breadcrumb; a failed clear is a NON-FATAL warning (the restore is done).
	if opts.WriteBreadcrumb {
		if err := varlib.RemoveJournal(); err != nil {
			fmt.Fprintf(a.Err, "restored successfully; remove %s manually (%v)\n", varlib.JournalPath(), err)
		}
	}
	// (11) Bundled proxy: standalone-restore-only, non-gating, bounded, forward-only.
	a.restoreProxyIfEnabled(ctx, opts)
	fmt.Fprintf(a.Out, "restored to %s from %s\n", manifest.MathionVersion, filepath.Base(archivePath))
	return nil
}

// tlsProxyPullTimeout / tlsProxyStepTimeout bound each best-effort proxy-restore
// step so a slow/unhealthy proxy can never fail the (already-complete) restore gate
// or the auto-rollback.
const tlsProxyPullTimeout = 60 * time.Second
const tlsProxyStepTimeout = 60 * time.Second

// restoreProxyIfEnabled brings the bundled proxy back after a STANDALONE restore
// (opts.WriteBreadcrumb) when TLS is enabled in .env — a non-gating, bounded,
// forward-only step. Every error is demoted to a warning so it can never fail the
// restore's own gate. The auto-rollback caller (update.go:113, WriteBreadcrumb:false)
// returns immediately here, so a rollback issues NO proxy-up. Order (spec §10):
//  1. bounded best-effort `pull --policy missing proxy proxy-init` (present for a
//     new-host / post-`--purge` restore; --policy missing skips the registry when
//     the images are already cached);
//  2. chown one-shot synchronously via the one-off worker idiom `run … -T proxy-init`
//     (returns the TRUE exit code — not `up --wait proxy-init`, which returns rc=1 on
//     a one-shot that exits), mandatory --name/--label + forceRemoveWorker on
//     error/timeout before continuing;
//  3. `up -d proxy --pull never --no-deps` (chown already ran; app/db undisturbed).
func (a *App) restoreProxyIfEnabled(ctx context.Context, opts restoreOpts) {
	if !opts.WriteBreadcrumb {
		return // rollback path: never bring the proxy up
	}
	if !tlsEnabledFromEnv(a.CfgDir) {
		return // TLS not enabled, or .env inconsistent — fail closed (never up a proxy over a poisoned .env)
	}
	a.tlsEnabled = true // so composeArgs adds --profile tls to the start commands below

	// 1. Bounded best-effort targeted pull.
	pctx, pcancel := context.WithTimeout(ctx, tlsProxyPullTimeout)
	if err := a.compose(pctx, "pull", "--policy", "missing", "proxy", "proxy-init"); err != nil {
		fmt.Fprintf(a.Err, "note: could not pre-pull the bundled proxy images (%v); continuing with cached images\n", err)
	}
	pcancel()

	// 2. Chown one-shot, synchronously. Mandatory name/label => reapable.
	name := fmt.Sprintf("mathion_proxyinit_%d", os.Getpid())
	ictx, icancel := context.WithTimeout(ctx, tlsProxyStepTimeout)
	ierr := a.Runner.Run(ictx, a.composeArgs(
		"run", "--rm", "--no-deps", "--pull", "never",
		"--name", name, "--label", "io.mathion.worker=1",
		"-T", "proxy-init",
	)...)
	icancel()
	if ierr != nil {
		fmt.Fprintf(a.Err, "note: bundled-proxy ACME-dir chown did not complete (%v); the proxy may be unable to write certs — check `mathion tls status`\n", ierr)
		forceRemoveWorker(context.WithoutCancel(ctx), a.Runner, name)
		return // do not start the proxy over a half-done chown
	}

	// 3. Start ONLY the proxy.
	uctx, ucancel := context.WithTimeout(ctx, tlsProxyStepTimeout)
	if err := a.compose(uctx, "up", "-d", "proxy", "--pull", "never", "--no-deps"); err != nil {
		fmt.Fprintf(a.Err, "note: could not start the bundled proxy after restore (%v); re-run `mathion tls enable` if HTTPS is down\n", err)
	}
	ucancel()
}

// forceRemoveWorker best-effort force-removes a named one-off worker and confirms it
// is stably absent, closing the create/observe race where a create is still
// registering server-side. Because StreamIn/StreamInEnv are synchronous, by the time
// a caller handles their error the `compose run` HAS returned (launch-resolved), so
// this only needs to drive the name to absent. Called under context.WithoutCancel so a
// cancelled parent still cleans up before the lock releases. Errors are swallowed: a
// second signal / wedged daemon falls back to the startup orphan sweep. Shared with
// update's migrate cleanup. No sleep — the docker round-trips pace the loop; the bound
// + startup-sweep backstop cover a wedged daemon.
func forceRemoveWorker(ctx context.Context, r compose.Runner, name string) {
	for i := 0; i < workerRemoveTries; i++ {
		_ = r.Run(ctx, "rm", "-f", name) // idempotent; ignores "No such container"
		// `ps -aq --filter name=^<name>$` lists the id only when present and exits zero
		// either way, so err==nil && empty ⇒ stably absent (unlike `inspect`, which
		// errors merely because a container is missing).
		out, err := r.Output(ctx, "ps", "-aq", "--filter", "name=^"+name+"$")
		if err == nil && strings.TrimSpace(out) == "" {
			return // stably absent
		}
	}
}

// writeRestoreBreadcrumb durably writes the kind:"restore" recovery breadcrumb. rid
// is the resolved boot image id, or "" (absent, omitempty) when the image is still
// pull-flagged — an absent target_image_id keeps the manual-clear escape disabled.
// backupPath is resolved to an absolute path so the printed recovery command works
// from any cwd.
func writeRestoreBreadcrumb(backupPath, version, rid string) error {
	abs, err := filepath.Abs(backupPath)
	if err != nil {
		return err
	}
	return varlib.WriteJournal(varlib.Journal{
		Schema:        1,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
		Kind:          "restore",
		TargetTag:     version,
		TargetImageID: rid,
		BackupPath:    abs,
	})
}

// capturePreRestoreAppState resolves the app container id and whether it is running
// AND health-passing, via a raw docker inspect (mirroring probeImageID's compose-ps
// then raw-inspect shape). Any failure yields (id, false) — this is best-effort
// state used only to gate the 6c restart, never a hard precondition.
func capturePreRestoreAppState(ctx context.Context, a *App) (id string, runningHealthy bool) {
	out, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
	if err != nil {
		return "", false // any ps failure ⇒ not-healthy (fail-safe; ps may emit partial stdout on error)
	}
	id = strings.TrimSpace(out)
	if id == "" {
		return "", false
	}
	// The template is nil-safe: the app service defines a healthcheck, but guard the
	// deref anyway so a container without one reports "true" (running, not-healthy)
	// rather than erroring.
	st, err := a.Runner.Output(ctx, "inspect", id, "--format", "{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}")
	if err != nil {
		return id, false
	}
	fs := strings.Fields(st)
	runningHealthy = len(fs) >= 2 && fs[0] == "true" && fs[1] == "healthy"
	return id, runningHealthy
}

// imageIDOfTag returns the local id ImageRepo:<version> resolves to, or "" on any
// error (a missing tag => "" => a retag is needed). Used only on the local-R_id
// retag path, where a "" (unresolved) result correctly means "retag needed".
func imageIDOfTag(ctx context.Context, a *App, version string) string {
	out, err := a.Runner.Output(ctx, "image", "inspect", compose.ImageRepo+":"+version, "--format", "{{.Id}}")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// resolveImageID resolves ImageRepo:<version> to its local id STRICTLY: a read
// failure OR an empty id is returned as an error. It is used after a pull, where an
// unresolvable id means the post-pull state is uncertain and the restore must abort
// (retaining the absent-id breadcrumb) rather than record an absent target.
func resolveImageID(ctx context.Context, a *App, version string) (string, error) {
	out, err := a.Runner.Output(ctx, "image", "inspect", compose.ImageRepo+":"+version, "--format", "{{.Id}}")
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(out)
	if id == "" {
		return "", fmt.Errorf("image inspect returned an empty id for %s:%s", compose.ImageRepo, version)
	}
	return id, nil
}
