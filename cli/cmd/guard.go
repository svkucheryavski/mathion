package cmd

import (
	"errors"
	"fmt"
	"os"

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
	case "update", "start", "install", "backup":
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

// printRefuse writes the operator-facing recovery guidance for a leftover
// breadcrumb. The text is static-shaped (the breadcrumb carries no secrets): it
// names the exact restore command to recover, and — for operators who have
// independently confirmed the deployment is whole — the identity-verified manual
// clear, which requires the running image to equal the recorded target before the
// breadcrumb may be removed by hand.
func printRefuse(a *App, j *varlib.Journal) {
	w := a.Err

	// No usable BackupPath (undecodable breadcrumb, or one that names no backup):
	// generic fail-closed message. Never print a bogus `mathion restore -- ''`.
	if j.BackupPath == "" {
		fmt.Fprintf(w,
			"A previous mathion operation was interrupted and left an unreadable recovery\n"+
				"breadcrumb at %s; refusing to proceed. Restore from your most recent backup,\n"+
				"verify the deployment is whole, then remove that file by hand.\n",
			varlib.JournalPath())
		return
	}

	lead := "A previous operation was interrupted"
	switch j.Kind {
	case "update":
		lead = "A previous update was interrupted"
	case "restore":
		lead = "A previous restore was interrupted"
	}
	fmt.Fprintf(w, "%s and left the deployment in an unverified state; refusing to proceed.\n", lead)
	if j.OldTag != "" && j.TargetTag != "" {
		fmt.Fprintf(w, "Interrupted from %s toward %s.\n", j.OldTag, j.TargetTag)
	}

	fmt.Fprintf(w, "\nRecover by re-running the restore:\n\n    %s\n", varlib.RecoveryCommand(j.BackupPath))

	fmt.Fprint(w,
		"\nOnly if you have independently verified the deployment is already whole may\n"+
			"you clear this breadcrumb by hand. Inspect the running app container's image ID:\n\n"+
			"    docker inspect --format '{{.Image}}' <app-container>\n\n"+
			"and remove the breadcrumb ONLY IF that image ID equals the recorded target")
	if j.TargetImageID != "" {
		fmt.Fprintf(w, " (%s)", j.TargetImageID)
	}
	fmt.Fprintf(w, ":\n\n    rm -f %s\n\nChecking /version alone is NOT sufficient.\n", varlib.JournalPath())
}
