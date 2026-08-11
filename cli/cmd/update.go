package cmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

type updateOpts struct {
	Version    string
	NoRollback bool
	Yes        bool
}

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
	_ = A // steps 5-10 (Tasks 21-23) consume A as the gate target T_id
	return nil
}
