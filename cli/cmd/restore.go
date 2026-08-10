package cmd

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

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

// restoreEngine rewinds the deployment from archivePath. It implements the read /
// confirm / stage half of restore — steps 2, 4a, 5, 6, 6b, 6c — and returns before
// the destructive DB/assets load (steps 7-10 land in later tasks, which also clear
// the breadcrumb on the step-10 gate). Nothing before step 6 mutates deployment
// state, so a declined confirmation or an extract/preflight failure leaves the
// deployment untouched.
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

	// R_id is the gate target for step 10; steps 7-10 (DB load, assets, .env re-pin,
	// gate + breadcrumb clear) land in Tasks 17-18.
	return nil
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
