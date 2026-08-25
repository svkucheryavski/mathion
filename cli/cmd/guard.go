package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// geteuid is a package-level seam over os.Geteuid so tests can drive requireRoot
// without actually running as root. It is never rebound outside tests.
var geteuid = os.Geteuid

// requireRoot fails closed unless the process runs as root. Operations that move
// Docker tags, touch /var/lib/mathion, or edit /etc/mathion must run privileged;
// this is the single gate they call first.
func requireRoot() error {
	if geteuid() != 0 {
		return errors.New("requires root; re-run with sudo")
	}
	return nil
}

// lockAndGuard runs the shared preamble every lock-taking command performs before its own
// work: root check → ensure the managed backups dir → take the operation lock (held for the
// whole run) → sweep stale staging + orphaned worker containers → entry-check. It returns a
// release the caller MUST defer (a no-op until the lock is actually taken, so `defer release()`
// is safe on every path), plus guardEntry's proceed/err. On proceed=false the lock (if taken)
// is released by that deferred release; the caller just returns err.
func lockAndGuard(ctx context.Context, app *App, cmd string) (release func() error, proceed bool, err error) {
	release = func() error { return nil }
	if err = requireRoot(); err != nil {
		return release, false, err
	}
	if err = varlib.EnsureBackupsDir(); err != nil {
		return release, false, err
	}
	rel, err := varlib.Lock()
	if err != nil {
		return release, false, err // ErrLocked message is already clear
	}
	release = rel
	if err = varlib.SweepStaleStaging(); err != nil {
		return release, false, err
	}
	if err = dockerx.SweepWorkers(ctx, app.Runner, app.Project); err != nil {
		return release, false, err
	}
	proceed, err = guardEntry(app, cmd)
	return release, proceed, err
}

// entryOutcome classifies how a command reacts to a leftover recovery breadcrumb
// (a prior update/restore that crashed mid-flight): most commands must refuse to
// run on top of an unverified deployment, while the containment/exempt commands
// that exist to recover from that very state are allowed through.
type entryOutcome int

const (
	outcomeProceed entryOutcome = iota
	outcomeRefuse
)

// classify maps a command name to its breadcrumb reaction. The refuse set makes
// deployment-affecting changes and must fail closed when a crash breadcrumb is
// present; everything else (restore/uninstall which clear the breadcrumb in their
// own late flow, stop which contains the stack, and any unknown command) proceeds.
func classify(cmd string) entryOutcome {
	switch cmd {
	case "update", "start", "install", "backup", "tls-enable":
		return outcomeRefuse
	default:
		return outcomeProceed
	}
}

// guardEntry is the three-outcome entry-check every lock-taking command runs
// before its own work. It reads the recovery breadcrumb and:
//   - refuses (proceed=false, non-nil err) when cmd is in the refuse set AND a
//     breadcrumb is present in any form (including a Fatal/undecodable one),
//     printing operator recovery guidance first;
//   - proceeds (true, nil) otherwise.
//
// It NEVER clears the breadcrumb: exempt/containment commands proceed with it
// retained and their own flows remove it once recovery is complete. A hard read
// error fails closed for the refuse set (refuse + surface the error) but does not
// block the proceed set.
func guardEntry(a *App, cmd string) (proceed bool, err error) {
	refuse := classify(cmd) == outcomeRefuse

	j, present, readErr := varlib.ReadJournal()
	if readErr != nil {
		if refuse {
			fmt.Fprintf(a.Err, "cannot read the recovery breadcrumb at %s (%v); refusing to proceed.\n", varlib.JournalPath(), readErr)
			return false, readErr
		}
		return true, nil
	}

	if refuse && present {
		printRefuse(a, j)
		return false, errors.New("refusing: a previous mathion operation was interrupted; recover before retrying")
	}
	return true, nil
}

// leadFor returns the kind-worded opening sentence fragment for the refuse
// message, so both message branches share one wording and a decoded kind is
// reported even when the breadcrumb names no backup.
func leadFor(kind string) string {
	switch kind {
	case "update":
		return "A previous update was interrupted"
	case "restore":
		return "A previous restore was interrupted"
	default:
		return "A previous mathion operation was interrupted"
	}
}

// printRefuse writes the operator-facing recovery guidance for a leftover
// breadcrumb. The text is static-shaped (the breadcrumb carries no secrets): it
// names how to recover, and — for operators who have independently confirmed the
// deployment is whole — the identity-verified manual clear, which requires the
// running image to equal the recorded target before the breadcrumb may be removed
// by hand. BOTH branches emit that same escape so an undecodable breadcrumb is no
// weaker a gate than a decoded one.
func printRefuse(a *App, j *varlib.Journal) {
	w := a.Err

	// No usable BackupPath (undecodable breadcrumb, or one that names no backup):
	// fail-closed message. Never print a bogus `mathion restore -- ''`; direct the
	// operator to restore from their most recent backup (which clears the
	// breadcrumb) rather than a specific recovery command.
	if j.BackupPath == "" {
		fmt.Fprintf(w,
			"%s and left an unreadable recovery breadcrumb at %s; refusing to proceed.\n"+
				"It records no backup path, so restore from your most recent backup (the\n"+
				"restore clears this breadcrumb).\n",
			leadFor(j.Kind), varlib.JournalPath())
		writeIdentityEscape(w, j.TargetImageID)
		return
	}

	fmt.Fprintf(w, "%s and left the deployment in an unverified state; refusing to proceed.\n", leadFor(j.Kind))
	if j.OldTag != "" && j.TargetTag != "" {
		fmt.Fprintf(w, "Interrupted from %s toward %s.\n", j.OldTag, j.TargetTag)
	}
	fmt.Fprintf(w, "\nRecover by re-running the restore:\n\n    %s\n", varlib.RecoveryCommand(j.BackupPath))
	writeIdentityEscape(w, j.TargetImageID)
}

// writeIdentityEscape writes the identity-verified manual-clear escape: the
// operator may remove the breadcrumb by hand ONLY IF the running app container's
// image ID equals the recorded target. A /version check is explicitly rejected as
// insufficient (it is env-derived and would report the target even if a moved tag
// booted a different image). When targetImageID is empty the recorded target is
// unavailable (an undecodable breadcrumb), so the manual clear CANNOT be satisfied
// and restore is the only safe path.
func writeIdentityEscape(w io.Writer, targetImageID string) {
	fmt.Fprint(w,
		"\nOnly if you have independently verified the deployment is already whole may\n"+
			"you clear this breadcrumb by hand. Inspect the running app container's image ID:\n\n"+
			"    docker inspect --format '{{.Image}}' <app-container>\n\n"+
			"and remove the breadcrumb ONLY IF that image ID equals the recorded target")
	if targetImageID != "" {
		fmt.Fprintf(w, " (%s)", targetImageID)
	} else {
		fmt.Fprint(w,
			".\nThis breadcrumb is unreadable, so the recorded target is UNAVAILABLE and the\n"+
				"manual clear CANNOT be satisfied — restore is the only safe path")
	}
	fmt.Fprintf(w, ":\n\n    rm -f %s\n\nChecking /version alone is NOT sufficient.\n", varlib.JournalPath())
}
