package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"time"

	"github.com/spf13/cobra"
	"github.com/svkucheryavski/mathion/cli/internal/config"
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

func newVersionCmd(app *App) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the CLI version and the pinned/running image version",
		RunE: func(c *cobra.Command, _ []string) error {
			fmt.Fprintf(app.Out, "mathion %s\n", buildVersion)
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
