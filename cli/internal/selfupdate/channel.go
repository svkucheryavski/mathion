package selfupdate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
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

// packageOwners lists the dpkg packages that own path; none when dpkg is absent or knows no owner.
func packageOwners(ctx context.Context, path string) ([]string, error) {
	r := dpkgSearch(ctx, path)
	if r.absent {
		return nil, nil
	}
	switch r.exitCode {
	case 0:
		var owners []string
		seen := map[string]bool{}
		for _, line := range strings.Split(string(r.stdout), "\n") {
			pkgs, ok := strings.CutSuffix(line, ": "+path)
			if !ok || strings.HasPrefix(line, "diversion by ") || strings.HasPrefix(line, "local diversion ") {
				continue
			}
			for _, pkg := range strings.Split(pkgs, ", ") {
				if c := strings.IndexByte(pkg, ':'); c >= 0 {
					pkg = pkg[:c] // drop the multiarch :arch suffix
				}
				if pkg != "" && !seen[pkg] {
					seen[pkg] = true
					owners = append(owners, pkg)
				}
			}
		}
		if len(owners) == 0 {
			return nil, fmt.Errorf("dpkg -S %s: could not read the owning package from: %s", path, bytes.TrimSpace(r.stdout))
		}
		return owners, nil
	case 1:
		if bytes.Contains(r.stderr, []byte("no path found matching pattern")) {
			return nil, nil
		}
		return nil, fmt.Errorf("dpkg -S %s: unexpected exit-1 output: %s", path, bytes.TrimSpace(r.stderr))
	default:
		return nil, fmt.Errorf("dpkg -S %s failed (exit %d): %s", path, r.exitCode, bytes.TrimSpace(r.stderr))
	}
}

// refusePackageOwned refuses to replace a binary that a system package owns.
func refusePackageOwned(path string, owners []string) error {
	switch {
	case len(owners) == 0:
		return nil
	case len(owners) == 1 && owners[0] == "mathion":
		return fmt.Errorf("%s belongs to the system package mathion. Remove it (sudo apt remove mathion) and install Mathion with curl | sh.", path)
	default:
		return fmt.Errorf("%s belongs to the system package %s; refusing to replace it.", path, strings.Join(owners, ", "))
	}
}
