package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

// versionEnvReader is the .env reader seam so the not-installed (ENOENT) vs installed-but-
// unreadable (EACCES) branches are unit-testable WITHOUT depending on the test process uid.
var versionEnvReader = config.ReadEnvFile

// versionRunningProbe is the live /version reader seam (the running image's reported
// version, or "" when the app is unreachable / not serving JSON). A seam so the command's
// DISPLAY branches stay hermetic (no accidental network); probeRunningVersion's own HTTP
// parse is covered separately against an httptest server.
var versionRunningProbe = probeRunningVersion

// versionProbeTimeout bounds the display-only running-version GET so `mathion version`
// never hangs on a wedged or firewalled app port.
const versionProbeTimeout = 2 * time.Second

const (
	aptBinPath  = "/usr/bin/mathion"
	curlBinPath = "/usr/local/bin/mathion"
)

// Seams so version_test.go stays hermetic (no dependence on the test host's
// installed binaries or PATH).
var (
	binExists = func(p string) bool { _, err := os.Stat(p); return err == nil }
	lookPath  = exec.LookPath
)

// maybeWarnDualInstall emits a non-fatal warning when mathion is installed via
// BOTH channels (apt -> /usr/bin, curl|sh -> /usr/local/bin). /usr/local/bin
// precedes /usr/bin on the default PATH, so `apt upgrade` can update a binary
// the shell never runs. Never deletes anything.
func maybeWarnDualInstall(w io.Writer) {
	if w == nil || !(binExists(aptBinPath) && binExists(curlBinPath)) {
		return
	}
	active := curlBinPath + " (PATH precedence)"
	if p, err := lookPath("mathion"); err == nil {
		active = p
	}
	fmt.Fprintf(w, "warning: mathion is installed via BOTH apt (%s) and curl|sh (%s).\n", aptBinPath, curlBinPath)
	fmt.Fprintf(w, "         your shell runs: %s\n", active)
	fmt.Fprintln(w, "         use one channel only — remove the other (see README).")
}

// driftFromReader reads the compose bytes from r (the opened+fstat'd regular file, or an
// injected reader in tests) and reports drift vs embed, plus present=true. It bounds the
// read to len(embed)+1 bytes (the +1 distinguishes embed from embed+extra) and maps ANY
// read error to (false, true) — present-but-unreadable: fail-quiet on the drift signal,
// never a false claim (spec §4.3a / §5 rule 3). Factored out so the error→(false,true)
// mapping is unit-testable with an injected failing reader.
func driftFromReader(r io.Reader, embed []byte) (drifted, present bool) {
	buf, err := io.ReadAll(io.LimitReader(r, int64(len(embed))+1))
	if err != nil {
		return false, true
	}
	return !(len(buf) == len(embed) && bytes.Equal(buf, embed)), true
}

// composeDrifted reports whether the on-disk compose at cfgDir differs from this binary's
// embedded revision, and whether a compose file is present at all. Hardened (spec §4.3a)
// to be FIFO-safe + byte-bounded: a non-blocking open + an fstat on the OPENED fd (no
// Stat->Open TOCTOU) rejects a non-regular file before any read, and the read is bounded
// via driftFromReader. absent (ENOENT) -> (false, false); any other open/stat/read error,
// or a non-regular file -> (false, true) (present but unreadable). NOT wall-clock-bounded
// against a broken filesystem mount (Linux ignores O_NONBLOCK for regular files); the dpkg
// path is separately timeout-bounded (spec §4.3b).
func composeDrifted(cfgDir string) (drifted, present bool) {
	f, err := os.OpenFile(filepath.Join(cfgDir, "docker-compose.yml"), os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, false
		}
		return false, true
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return false, true
	}
	return driftFromReader(f, compose.ComposeYAML)
}

// maybeWarnInstallIncomplete prints a one-line notice when install-state says the
// install never finished, so `mathion status` surfaces it before the operator
// hits a hard refusal. Fail-quiet: an unreadable/absent install-state (e.g.
// non-root `mathion status`, mode-0600 file) prints nothing.
func maybeWarnInstallIncomplete(w io.Writer, cfgDir string) {
	if w == nil {
		return
	}
	st, err := config.ReadState(cfgDir)
	if err != nil {
		return
	}
	if !st.InstallComplete() {
		fmt.Fprintln(w, "note: this deployment's install did not finish — run `sudo mathion install` to complete it")
	}
}

// maybeWarnComposeDrift prints a one-line notice to w when this deployment's stack
// definition differs from this mathion version's embedded definition, OR a previous
// reconcile did not finish (an apply-pending marker is present). Precedence (spec §5):
//  1. compose file absent → silent (checked FIRST, so a stale marker after
//     `uninstall --purge` cannot nag a host with no deployment);
//  2. else warn if the marker is present OR the on-disk bytes differ;
//  3. any read error is fail-quiet for that input only.
func maybeWarnComposeDrift(w io.Writer, cfgDir string) {
	if w == nil {
		return
	}
	drifted, present := composeDrifted(cfgDir)
	if !present {
		return
	}
	markerPresent, merr := varlib.MarkerPresent()
	if drifted || (merr == nil && markerPresent) {
		fmt.Fprintln(w, "note: this deployment's stack definition differs from this mathion version's "+
			"embedded definition (or a previous reconcile did not finish); apply it with: sudo mathion reconcile")
	}
}

func newVersionCmd(app *App) *cobra.Command {
	var short bool
	c := &cobra.Command{
		Use:   "version",
		Short: "Print the CLI version and the pinned/running image version",
		RunE: func(c *cobra.Command, _ []string) error {
			if short {
				fmt.Fprintln(app.Out, buildVersion)
				return nil
			}
			fmt.Fprintf(app.Out, "mathion %s\n", buildVersion)
			maybeWarnDualInstall(app.Err)
			m, err := versionEnvReader(app.CfgDir)
			switch {
			case errors.Is(err, fs.ErrNotExist):
				fmt.Fprintln(app.Out, "image           not installed")
				return nil
			case errors.Is(err, fs.ErrPermission):
				fmt.Fprintln(app.Out, "image           installed (run with sudo to read the pinned version)")
				return nil
			case err != nil:
				return err // an UNEXPECTED read error (not ENOENT/EACCES) — surface it
			}
			pinned := m["MATHION_VERSION"]
			if pinned == "" {
				pinned = "(unknown)"
			}
			fmt.Fprintf(app.Out, "image (pinned)  %s\n", pinned)
			if running := versionRunningProbe(c.Context()); running != "" {
				fmt.Fprintf(app.Out, "image (running) %s\n", running)
			}
			return nil
		},
	}
	c.Flags().BoolVar(&short, "short", false, "print only the CLI version and exit")
	return c
}

// probeRunningVersion GETs /version and returns the running image's reported version, or
// "" on ANY error (unreachable, non-200, redirect, non-JSON-object body). Reuses the gate's
// non-redirect client + URL + JSON-object guard; display-only, never fatal.
func probeRunningVersion(ctx context.Context) string {
	rctx, cancel := context.WithTimeout(ctx, versionProbeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, gateVersionURL, nil)
	if err != nil {
		return ""
	}
	resp, err := gateHTTPClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil || !looksLikeJSONObject(body) {
		return ""
	}
	var vj struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(body, &vj) != nil {
		return ""
	}
	return vj.Version
}
