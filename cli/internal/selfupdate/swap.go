//go:build linux

package selfupdate

import (
	"bytes"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// Mutation-op seams so unit tests can drive the post-rename failure branches (§3.2).
var (
	fsRenameat = unix.Renameat
	fsFsync    = unix.Fsync
	fsUnlinkat = unix.Unlinkat
)

// Staged-exec bounds (§4.2 step 7, §6.4). Package VARS, not consts, so the integration
// build (Task 13, mathion_selfupdate_test tag only) can inject a longer deadline from
// env to park the updater for §9.2 leg (ii); the shipped release lacks that tag and
// uses these defaults. An honest `version --short` prints ~one short line in
// milliseconds, so these are orders of magnitude over the honest case yet finite —
// a hung, output-flooding, or fork-and-orphan staged binary cannot pin the flock.
var (
	stagedExecTimeout   = 30 * time.Second
	stagedExecOutputCap = int64(64 << 10) // 64 KiB
	stagedExecWaitDelay = 2 * time.Second // force-close inherited pipes so Wait can't hang on a forked pipe-holder
)

var (
	errLockContended = errors.New("another self-update is in progress; retry shortly")
	errBinaryChanged = errors.New("the binary was updated by another process; rerun to update from the new version")
)

// durabilityUncertainError is the ONE post-mutation failure: the rename committed
// but the directory fsync failed, so the new binary IS installed but its
// crash-durability is uncertain. No rollback; never claim "nothing changed". §5.3.
type durabilityUncertainError struct{ err error }

func (e *durabilityUncertainError) Error() string {
	return fmt.Sprintf("the new binary is INSTALLED but its crash-durability is uncertain (directory fsync failed: %v); do NOT assume nothing changed and do NOT roll back", e.err)
}
func (e *durabilityUncertainError) Unwrap() error { return e.err }

// captureRunningImage returns the device+inode of the EXECUTING image via
// /proc/self/exe (O_PATH), which resolves to the running inode even after the path
// is renamed over — the correct anti-downgrade anchor (NOT a pathname re-stat). §4.2 step1.
func captureRunningImage() (dev, ino uint64, err error) {
	fd, err := unix.Open("/proc/self/exe", unix.O_PATH|unix.O_CLOEXEC, 0)
	if err != nil {
		return 0, 0, fmt.Errorf("open /proc/self/exe: %w", err)
	}
	defer unix.Close(fd)
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return 0, 0, fmt.Errorf("fstat /proc/self/exe: %w", err)
	}
	return uint64(st.Dev), uint64(st.Ino), nil
}

// acquireMutationLock takes a non-blocking exclusive flock on the retained
// parent-dir fd (must be a normal fd, not O_PATH). §4.2 step4b.
func acquireMutationLock(parentFD int) error {
	if err := unix.Flock(parentFD, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		if errors.Is(err, unix.EWOULDBLOCK) {
			return errLockContended
		}
		return fmt.Errorf("flock parent dir: %w", err)
	}
	return nil
}

// releaseMutationLock explicitly drops the flock on the normal path (§4.2 step 4b,
// correction 6). Closing the O_CLOEXEC parent-dir fd would also release it — that is
// the crash/abnormal-exit backstop — but an EXPLICIT LOCK_UN at a known point is what
// §9.2 leg (i) asserts (orderly release), and it frees the lock before the fd's other
// teardown. Never called before commitSwap's fsync completes (the lock is held through
// step 8). Best-effort: a failed unlock still releases on the subsequent close.
func releaseMutationLock(parentFD int) {
	_ = unix.Flock(parentFD, unix.LOCK_UN)
}

// recheckRunningIdentity re-opens the target fd-relative and requires its dev+inode
// still equals the running-image identity captured in step 1; a mismatch means a
// concurrent self-update swapped it. §4.2 step4b.
func recheckRunningIdentity(parentFD int, targetName string, wantDev, wantIno uint64) error {
	fd, err := unix.Openat(parentFD, targetName, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return fmt.Errorf("reopen target under lock: %w", err)
	}
	defer unix.Close(fd)
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return fmt.Errorf("fstat target under lock: %w", err)
	}
	if uint64(st.Dev) != wantDev || uint64(st.Ino) != wantIno {
		return errBinaryChanged
	}
	return nil
}

// stageBinary writes data to a randomly-named O_EXCL temp fd-relative off parentFD,
// fchmods 0755, fsyncs, and CLOSES the writable fd (so a later self-exec can't hit
// ETXTBSY). On any error it attempts to unlink the temp. §4.2 step7, §5.3.
func stageBinary(parentFD int, data []byte) (string, error) {
	name, err := randTempName()
	if err != nil {
		return "", err
	}
	fd, err := unix.Openat(parentFD, name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_CLOEXEC, 0o755)
	if err != nil {
		return "", fmt.Errorf("create staged temp: %w", err)
	}
	f := os.NewFile(uintptr(fd), name)
	fail := func(op string, e error) (string, error) {
		_ = f.Close()
		_ = fsUnlinkat(parentFD, name, 0)
		return "", fmt.Errorf("%s staged temp: %w", op, e)
	}
	if _, err := f.Write(data); err != nil {
		return fail("write", err)
	}
	if err := f.Chmod(0o755); err != nil { // O_CREAT mode is umask'd; force 0755
		return fail("chmod", err)
	}
	if err := f.Sync(); err != nil { // fsync BEFORE close -> bytes durable
		return fail("fsync", err)
	}
	if err := f.Close(); err != nil { // close writable fd -> no ETXTBSY on exec
		_ = fsUnlinkat(parentFD, name, 0)
		return "", fmt.Errorf("close staged temp: %w", err)
	}
	return name, nil
}

// cappedBuffer accumulates up to cap bytes and flags overflow; bytes past the cap are
// discarded, and Write NEVER errors (so os/exec's copy goroutine keeps draining the
// pipe and the child cannot block on a full pipe). This bounds MEMORY. On the FIRST
// overrun it also pokes the shared notify channel so the exec loop can kill the group
// IMMEDIATELY — spec §4.2 step 7 requires a kill "on deadline OR output overrun", not
// only at the deadline. Fields are read only after Cmd.Wait returns (which synchronizes
// the copy goroutines) and each buffer is written by a single copy goroutine, so no locking.
type cappedBuffer struct {
	cap      int64
	buf      bytes.Buffer
	overflow bool
	notify   chan struct{} // shared, buffered(1): a nonblocking signal on FIRST overflow
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if room := c.cap - int64(c.buf.Len()); room > 0 {
		if int64(len(p)) > room {
			c.buf.Write(p[:room])
			c.signalOverflow()
		} else {
			c.buf.Write(p)
		}
	} else if len(p) > 0 {
		c.signalOverflow()
	}
	return len(p), nil // report full acceptance so io.Copy keeps draining
}

// signalOverflow flags the first overrun and pokes the shared notify channel (nonblocking,
// once) so the exec loop kills the group at cap-crossing rather than at the deadline.
func (c *cappedBuffer) signalOverflow() {
	if c.overflow {
		return
	}
	c.overflow = true
	if c.notify != nil {
		select {
		case c.notify <- struct{}{}:
		default:
		}
	}
}

func (c *cappedBuffer) String() string { return c.buf.String() }

// stagedVersion runs the staged binary's `version --short` through an INHERITED fd
// (never by pathname, which would re-resolve ancestors). This runs while the mutation
// flock is held (§6.4), so the exec is BOUNDED and FORK-SAFE:
//   - the exec fd is handed over ONLY via Cmd.ExtraFiles (fd 3 in the child →
//     /proc/self/fd/3, an fexecve-equivalent); every other fd — the flock-bearing
//     parent-dir fd included — stays O_CLOEXEC and is NOT inherited, so no forked
//     descendant can retain the mutation lock (correction 6);
//   - the staged binary runs in its OWN process group (Setpgid); on deadline or output
//     overrun the WHOLE group is SIGKILLed (kill(-pgid)), so a child the binary forked
//     cannot survive;
//   - a nonzero Cmd.WaitDelay force-closes the inherited stdout/stderr pipe ends so Wait
//     returns even if a grandchild double-forked (setsid) out of the group still holding
//     a write end — a plain Cmd.Wait reaps only the direct child and would block forever.
//
// Seam: a unit test substitutes the whole var to cover only the compare/abort branch
// (§3.2); the real bounded/fork-safe exec is exercised in integration (§9.2). §4.2 step7.
var stagedVersion = func(parentFD int, tempName string) (string, error) {
	rofd, err := unix.Openat(parentFD, tempName, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return "", fmt.Errorf("open staged binary: %w", err)
	}
	f := os.NewFile(uintptr(rofd), tempName)
	defer f.Close()

	cmd := exec.Command("/proc/self/fd/3", "version", "--short")
	cmd.ExtraFiles = []*os.File{f}                        // → fd 3 in the child
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group (pgid == pid)
	cmd.WaitDelay = stagedExecWaitDelay                   // force-close inherited pipes if a grandchild holds them
	overCh := make(chan struct{}, 1)                      // shared: either capped buffer signals its first overrun here
	out := &cappedBuffer{cap: stagedExecOutputCap, notify: overCh}
	errOut := &cappedBuffer{cap: stagedExecOutputCap, notify: overCh}
	cmd.Stdout, cmd.Stderr = out, errOut

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start staged version --short: %w", err)
	}
	pgid := cmd.Process.Pid // Setpgid makes the child a group leader: pgid == pid
	killGroup := func() { _ = unix.Kill(-pgid, unix.SIGKILL) }
	defer killGroup() // final sweep of any non-setsid group straggler on every return path

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	timer := time.NewTimer(stagedExecTimeout)
	defer timer.Stop()

	select {
	case werr := <-done:
		if werr != nil {
			return "", fmt.Errorf("exec staged version --short: %w (stderr: %s)", werr, strings.TrimSpace(errOut.String()))
		}
	case <-overCh:
		killGroup() // output overrun: kill the whole group NOW, do not wait for the deadline
		<-done      // drain: Wait returns after the group dies / WaitDelay force-closes the pipes
		return "", fmt.Errorf("staged version --short exceeded the %d-byte output cap", stagedExecOutputCap)
	case <-timer.C:
		killGroup()
		<-done // Wait returns after WaitDelay force-closes the inherited pipes
		return "", fmt.Errorf("staged version --short exceeded the %s exec deadline", stagedExecTimeout)
	}
	if out.overflow || errOut.overflow { // overran but the child also exited before we selected overCh
		return "", fmt.Errorf("staged version --short exceeded the %d-byte output cap", stagedExecOutputCap)
	}
	return strings.TrimSpace(out.String()), nil
}

// commitSwap atomically renames the staged temp over the target then fsyncs the
// directory. renameat fail -> target unchanged (plain error). renameat OK +
// fsync(dir) fail -> durabilityUncertainError (no rollback). §4.2 step8, §5.3.
func commitSwap(parentFD int, tempName, targetName string) error {
	if err := fsRenameat(parentFD, tempName, parentFD, targetName); err != nil {
		return fmt.Errorf("rename staged binary into place: %w", err)
	}
	if err := fsFsync(parentFD); err != nil {
		return &durabilityUncertainError{err: err}
	}
	return nil
}

// cleanupTemp attempts to unlink a staged temp, returning any failure to report.
func cleanupTemp(parentFD int, tempName string) error {
	if err := fsUnlinkat(parentFD, tempName, 0); err != nil && !errors.Is(err, unix.ENOENT) {
		return fmt.Errorf("cleanup staged temp %s: %w", tempName, err)
	}
	return nil
}

func randTempName() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("random temp name: %w", err)
	}
	return fmt.Sprintf(".mathion-selfupdate-%x.tmp", b), nil
}
