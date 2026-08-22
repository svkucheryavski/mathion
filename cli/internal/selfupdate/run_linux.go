//go:build linux

package selfupdate

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Seams so orchestrator tests stay hermetic. osExecutable/evalSymlinks/geteuid/
// loadKeyringFn cover the environment; captureRunningImageFn/walkAncestryFn let a
// test neutralize /proc/self/exe and the real root-owned-ancestry requirement.
var (
	osExecutable          = os.Executable
	evalSymlinks          = filepath.EvalSymlinks
	geteuid               = os.Geteuid
	loadKeyringFn         = loadKeyring
	captureRunningImageFn = captureRunningImage
	walkAncestryFn        = walkAncestry
)

func ensureRoot() error {
	if geteuid() != 0 {
		return errors.New("requires root; re-run with sudo")
	}
	return nil
}

// Run executes self-update or --check. §4.2 / §4.3.
func Run(ctx context.Context, p Params) error {
	// Step 1: resolve self + capture the RUNNING-IMAGE identity (§4.2 step 1).
	exe, err := osExecutable()
	if err != nil {
		return fmt.Errorf("cannot resolve the running binary (it may have been updated by another process); rerun: %w", err)
	}
	resolved, err := evalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("cannot resolve the running binary (it may have been updated by another process); rerun: %w", err)
	}
	dev, ino, err := captureRunningImageFn()
	if err != nil {
		return err
	}

	// Step 2: channel (§4.2 step 2).
	switch ch, err := detectChannel(ctx, resolved); {
	case err != nil:
		return err
	case ch == channelApt:
		fmt.Fprintln(p.Out, "sudo apt update && sudo apt install --only-upgrade mathion")
		return nil // apt-managed: defer, no root, no swap (also under --check)
	}

	// Step 3: eligible releases + forward-gate (§4.2 step 3).
	rels, err := fetchReleases(ctx, p.Cfg)
	if err != nil {
		return err
	}
	tags := forwardEligible(rels, p.CurrentVersion)
	if len(tags) == 0 {
		fmt.Fprintln(p.Out, "already up to date")
		return nil
	}

	// Step 4a: eligibility guard (read-only, no root) (§4.2 step 4a).
	if err := guardTarget(resolved, p.Cfg.swapTarget); err != nil {
		return err
	}
	comps, parentFD, err := walkAncestryFn(p.Cfg.swapTarget)
	if err != nil {
		return err
	}
	defer func() { _ = closeFD(parentFD) }() // O_CLOEXEC close = crash/abnormal-exit backstop for the flock (correction 6)
	if err := ancestrySafe(comps); err != nil {
		return err
	}

	keyring, err := loadKeyringFn()
	if err != nil {
		return fmt.Errorf("load verifying keyring: %w", err)
	}

	// --check: select via checksums only, report, exit (no root/archive/swap).
	if p.Check {
		tag, _, err := selectRelease(ctx, p.Cfg, keyring, tags)
		if err != nil {
			return err
		}
		fmt.Fprintf(p.Out, "%s installable (current %s)\n", tag, p.CurrentVersion)
		return nil
	}

	// Step 4b: root gate + non-blocking mutation lock + identity recheck (§4.2 step 4b).
	if err := ensureRoot(); err != nil {
		return err
	}
	if err := acquireMutationLock(parentFD); err != nil {
		return err
	}
	// Explicit LOCK_UN on the normal path (correction 6, §4.2 step 4b); the O_CLOEXEC
	// close defer above is the crash backstop. Registered AFTER the close defer, so it
	// runs FIRST (LIFO): unlock, then close. Only registered once the lock is held.
	defer releaseMutationLock(parentFD)
	if err := recheckRunningIdentity(parentFD, filepath.Base(p.Cfg.swapTarget), dev, ino); err != nil {
		return err
	}

	// Step 5: select the release (checksums only) (§4.2 step 5).
	tag, sha, err := selectRelease(ctx, p.Cfg, keyring, tags)
	if err != nil {
		return err
	}

	// Step 6: confirm (§4.2 step 6).
	if !p.Yes {
		fmt.Fprintf(p.Out, "%s → %s\nProceed? [y/N] ", p.CurrentVersion, tag)
		line, _ := bufio.NewReader(p.In).ReadString('\n')
		if ans := strings.ToLower(strings.TrimSpace(line)); ans != "y" && ans != "yes" {
			fmt.Fprintln(p.Out, "self-update cancelled")
			return nil // exit 0
		}
	}

	// Step 7: download + stage + pre-swap assertion (§4.2 step 7).
	bin, err := downloadArchive(ctx, p.Cfg, tag, sha)
	if err != nil {
		return err
	}
	tempName, err := stageBinary(parentFD, bin)
	if err != nil {
		return err
	}
	staged, err := stagedVersion(parentFD, tempName)
	if err != nil {
		return errors.Join(err, cleanupTemp(parentFD, tempName))
	}
	if staged != tag {
		return errors.Join(fmt.Errorf("staged binary reports %q, expected %q; refusing", staged, tag), cleanupTemp(parentFD, tempName))
	}

	// Step 8: swap (§4.2 step 8).
	if err := commitSwap(parentFD, tempName, filepath.Base(p.Cfg.swapTarget)); err != nil {
		var due *durabilityUncertainError
		if errors.As(err, &due) {
			return err // installed-but-durability-uncertain: no cleanup, no success line
		}
		// rename failed -> target unchanged; surface any cleanup failure alongside err
		return errors.Join(err, cleanupTemp(parentFD, tempName))
	}
	fmt.Fprintf(p.Out, "%s → %s\n", p.CurrentVersion, tag)
	return nil
}
