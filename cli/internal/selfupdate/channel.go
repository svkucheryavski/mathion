package selfupdate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
)

type channelResult int

const (
	channelApt channelResult = iota
	channelCurl
)

type dpkgResult struct {
	stdout, stderr []byte
	exitCode       int
	absent         bool // dpkg binary not on PATH
}

// dpkgSearch runs `LC_ALL=C dpkg -S <path>` (seam for hermetic tests).
var dpkgSearch = func(ctx context.Context, path string) dpkgResult {
	cmd := exec.CommandContext(ctx, "dpkg", "-S", path)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	var so, se bytes.Buffer
	cmd.Stdout, cmd.Stderr = &so, &se
	err := cmd.Run()
	r := dpkgResult{stdout: so.Bytes(), stderr: se.Bytes()}
	switch {
	case err == nil:
		r.exitCode = 0
	case errors.Is(err, exec.ErrNotFound):
		r.absent = true
	default:
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			r.exitCode = ee.ExitCode()
		} else {
			r.exitCode = -1
		}
	}
	return r
}

// parseDpkgPkg extracts the package name from "pkg[:arch]: /path" (first line),
// tolerating the multiarch :arch qualifier (dpkg renders `mathion:amd64: ...`).
func parseDpkgPkg(out []byte) string {
	line := out
	if i := bytes.IndexByte(out, '\n'); i >= 0 {
		line = out[:i]
	}
	if colon := bytes.IndexByte(line, ':'); colon >= 0 {
		return string(line[:colon]) // package name is up to the FIRST colon
	}
	return ""
}

// detectChannel classifies the install channel, failing closed on anything
// ambiguous or foreign. §4.2 step 2.
func detectChannel(ctx context.Context, path string) (channelResult, error) {
	r := dpkgSearch(ctx, path)
	if r.absent {
		return channelCurl, nil
	}
	switch r.exitCode {
	case 0:
		if pkg := parseDpkgPkg(r.stdout); pkg == "mathion" {
			return channelApt, nil
		} else {
			return 0, fmt.Errorf("%s is owned by package %q, not mathion; refusing", path, pkg)
		}
	case 1:
		if bytes.Contains(r.stderr, []byte("no path found matching pattern")) {
			return channelCurl, nil
		}
		return 0, fmt.Errorf("dpkg -S %s: unexpected exit-1 output: %s", path, bytes.TrimSpace(r.stderr))
	default:
		return 0, fmt.Errorf("dpkg -S %s failed (exit %d): %s", path, r.exitCode, bytes.TrimSpace(r.stderr))
	}
}
