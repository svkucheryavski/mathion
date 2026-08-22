//go:build linux

package selfupdate

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func openDir(t *testing.T, dir string) int {
	t.Helper()
	fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = unix.Close(fd) })
	return fd
}

func TestCaptureRunningImage(t *testing.T) {
	dev, ino, err := captureRunningImage()
	if err != nil || ino == 0 {
		t.Fatalf("dev=%d ino=%d err=%v", dev, ino, err)
	}
}

func TestAcquireMutationLock_Contended(t *testing.T) {
	dir := t.TempDir()
	if err := acquireMutationLock(openDir(t, dir)); err != nil {
		t.Fatalf("first lock: %v", err)
	}
	if err := acquireMutationLock(openDir(t, dir)); !errors.Is(err, errLockContended) {
		t.Fatalf("second (separate OFD) lock must be contended: %v", err)
	}
}

func TestReleaseMutationLock_FreesForNextOFD(t *testing.T) {
	dir := t.TempDir()
	fd1 := openDir(t, dir)
	if err := acquireMutationLock(fd1); err != nil {
		t.Fatalf("first lock: %v", err)
	}
	releaseMutationLock(fd1) // explicit LOCK_UN (correction 6) — not the fd close
	// A separate open-file description must now be able to take the lock.
	if err := acquireMutationLock(openDir(t, dir)); err != nil {
		t.Fatalf("after explicit release, a fresh-OFD lock must succeed: %v", err)
	}
}

func TestCappedBuffer(t *testing.T) {
	under := &cappedBuffer{cap: 8}
	if n, _ := under.Write([]byte("abc")); n != 3 || under.overflow || under.String() != "abc" {
		t.Fatalf("under-cap: n=%d overflow=%v s=%q", n, under.overflow, under.String())
	}
	overCh := make(chan struct{}, 1)
	over := &cappedBuffer{cap: 4, notify: overCh}
	if n, _ := over.Write([]byte("abcdefgh")); n != 8 || !over.overflow || over.String() != "abcd" {
		t.Fatalf("over-cap must report full write, flag overflow, keep only cap bytes: n=%d overflow=%v s=%q", n, over.overflow, over.String())
	}
	select {
	case <-overCh: // first overrun must poke the shared notify channel
	default:
		t.Fatal("overflow must signal the notify channel so the exec loop can kill the group")
	}
	// A second overrun must NOT block or double-signal (nonblocking, once).
	over.Write([]byte("more"))
	if len(overCh) != 0 {
		t.Fatal("notify must fire only once")
	}
}

func TestRecheckRunningIdentity(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mathion")
	if err := os.WriteFile(path, []byte("v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	dfd := openDir(t, dir)
	var st unix.Stat_t
	if err := unix.Fstatat(dfd, "mathion", &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		t.Fatal(err)
	}
	dev, ino := uint64(st.Dev), uint64(st.Ino)

	if err := recheckRunningIdentity(dfd, "mathion", dev, ino); err != nil {
		t.Fatalf("unchanged target must pass: %v", err)
	}
	// replace with a NEW inode (rename-over) -> must be detected.
	np := filepath.Join(dir, "new")
	if err := os.WriteFile(np, []byte("v2"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(np, path); err != nil {
		t.Fatal(err)
	}
	if err := recheckRunningIdentity(dfd, "mathion", dev, ino); !errors.Is(err, errBinaryChanged) {
		t.Fatalf("replaced target must be detected: %v", err)
	}
}

func TestStageAndCommit_HappyPath(t *testing.T) {
	dir := t.TempDir()
	dfd := openDir(t, dir)
	payload := []byte("#!/bin/true\n")
	name, err := stageBinary(dfd, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := commitSwap(dfd, name, "mathion"); err != nil {
		t.Fatalf("commit: %v", err)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "mathion"))
	if !bytes.Equal(got, payload) {
		t.Fatalf("content = %q", got)
	}
	if fi, _ := os.Stat(filepath.Join(dir, "mathion")); fi.Mode().Perm() != 0o755 {
		t.Fatalf("mode = %o", fi.Mode().Perm())
	}
}

func TestCommitSwap_PostRenameBranches(t *testing.T) {
	origR, origF := fsRenameat, fsFsync
	t.Cleanup(func() { fsRenameat, fsFsync = origR, origF })
	var due *durabilityUncertainError

	// renameat fails -> plain error, target unchanged (NOT durability-uncertain).
	fsRenameat = func(int, string, int, string) error { return errors.New("rename boom") }
	if err := commitSwap(-1, "tmp", "mathion"); err == nil || errors.As(err, &due) {
		t.Fatalf("renameat failure must be a plain error: %v", err)
	}
	// renameat OK, fsync(dir) fails -> dedicated durability-uncertain error.
	fsRenameat = func(int, string, int, string) error { return nil }
	fsFsync = func(int) error { return errors.New("fsync boom") }
	if err := commitSwap(-1, "tmp", "mathion"); !errors.As(err, &due) {
		t.Fatalf("post-rename fsync failure must be durabilityUncertainError: %v", err)
	}
}
