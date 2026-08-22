//go:build linux

package selfupdate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

// closeFD is a seam so tests/callers close a raw fd uniformly.
var closeFD = unix.Close

// walkAncestry opens the target's parent directory and every ancestor from "/" with
// openat(O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC), fstat-ing each fd, and returns
// the per-component metadata + the RETAINED parent-dir fd (NOT O_PATH — step 4b's
// flock needs a normal fd). The caller must closeFD(parentFD). §4.2 step 4a, §5.2.
func walkAncestry(targetPath string) ([]component, int, error) {
	const flags = unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
	parent := filepath.Dir(targetPath) // /usr/local/bin/mathion -> /usr/local/bin

	fd, err := unix.Openat(unix.AT_FDCWD, "/", flags, 0)
	if err != nil {
		return nil, -1, fmt.Errorf("open /: %w", err)
	}
	comps, err := appendStat(nil, fd, "/")
	if err != nil {
		_ = unix.Close(fd)
		return nil, -1, err
	}

	cur := ""
	for _, p := range splitAbs(parent) {
		cur += "/" + p
		next, err := unix.Openat(fd, p, flags, 0)
		_ = unix.Close(fd) // keep only the deepest fd open
		if err != nil {
			return nil, -1, fmt.Errorf("open %s: %w", cur, err)
		}
		fd = next
		if comps, err = appendStat(comps, fd, cur); err != nil {
			_ = unix.Close(fd)
			return nil, -1, err
		}
	}
	return comps, fd, nil // fd == parent dir, retained for the caller
}

func appendStat(comps []component, fd int, name string) ([]component, error) {
	var st unix.Stat_t
	if err := unix.Fstat(fd, &st); err != nil {
		return nil, fmt.Errorf("fstat %s: %w", name, err)
	}
	return append(comps, component{name: name, uid: st.Uid, mode: os.FileMode(st.Mode).Perm()}), nil
}

func splitAbs(p string) []string {
	var parts []string
	for _, s := range strings.Split(p, "/") {
		if s != "" {
			parts = append(parts, s)
		}
	}
	return parts
}
