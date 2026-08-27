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

// composeDrifted reports whether the on-disk compose at cfgDir differs from this
// binary's embedded revision, and whether a compose file is present at all. An
// ErrNotExist file reports (false, false) — the caller treats "absent" as silent
// (spec §5 precedence rule 1). Any OTHER read error reports (false, true): present
// but unreadable → fail-quiet on the drift signal, but not "absent".
func composeDrifted(cfgDir string) (drifted, present bool) {
	b, err := os.ReadFile(filepath.Join(cfgDir, "docker-compose.yml"))
	if errors.Is(err, fs.ErrNotExist) {
		return false, false
	}
	if err != nil {
		return false, true
	}
	return !bytes.Equal(b, compose.ComposeYAML), true
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
