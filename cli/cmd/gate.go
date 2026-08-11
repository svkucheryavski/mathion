package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Gate budget. VARS (not consts) so tests can shrink them. The image-ID check is
// authoritative; /version is a secondary, legacy-tolerant confirmation.
var (
	gateTimeout  = 120 * time.Second
	pollInterval = 2 * time.Second
	// gateVersionURL is the /version endpoint the gate polls; a package var so tests
	// point it at an httptest server (the loopback app port in production).
	gateVersionURL = "http://127.0.0.1:8000/version"
)

// gateImageAndVersion is the post-recreate deployment gate. It first makes the
// AUTHORITATIVE check — the running app container's resolved image ID must equal
// targetID (comparing IDs, not the mutable tag string, is what proves the correct
// CODE is deployed) — then polls /version as a secondary confirmation. On the
// version poll: the exact JSON {"version":targetVersion} passes; when !strictVersion
// a 404 or a 200 text/html SPA shell also passes ("route unavailable, image-ID
// already proved the deploy" — the two verified pre-slice-3 shapes); ANYTHING else
// fails (a different version, 401/403, 5xx, a malformed/non-SPA 200, or
// connection-refused that never clears within the budget). up -d --wait (step 9)
// already owns the health-wait, so the gate does NOT re-wait on /health.
func gateImageAndVersion(ctx context.Context, a *App, targetID, targetVersion string, strictVersion bool) error {
	// 1. Authoritative image-identity by resolved ID.
	out, err := a.Runner.Output(ctx, a.composeArgs("ps", "-q", "app")...)
	if err != nil {
		return fmt.Errorf("gate: resolving app container: %w", err)
	}
	cid := strings.TrimSpace(out)
	if cid == "" {
		return fmt.Errorf("gate: no running app container")
	}
	img, err := a.Runner.Output(ctx, "inspect", cid, "--format", "{{.Image}}")
	if err != nil {
		return fmt.Errorf("gate: inspecting app image: %w", err)
	}
	if got := strings.TrimSpace(img); got != targetID {
		return fmt.Errorf("gate: running image %s does not match target %s (a moved tag booted the wrong image)", got, targetID)
	}
	// 2. Secondary /version confirmation, polled within the budget.
	deadline := time.Now().Add(gateTimeout)
	for {
		pass, terminal, detail := probeVersionOnce(ctx, targetVersion, strictVersion)
		if pass {
			return nil
		}
		if terminal {
			return fmt.Errorf("gate: /version rejected the deploy (%s)", detail)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("gate: /version did not confirm within %s (%s)", gateTimeout, detail)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}

// probeVersionOnce performs one GET of /version and classifies it. It returns
// (pass, terminal, detail): a transport error is NON-terminal (terminal=false ⇒
// retry within the budget — the app may still be accepting connections); any HTTP
// response is terminal (a decisive pass or fail).
func probeVersionOnce(ctx context.Context, targetVersion string, strictVersion bool) (pass, terminal bool, detail string) {
	rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(rctx, http.MethodGet, gateVersionURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, false, err.Error() // transport error ⇒ retry
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	ct := resp.Header.Get("Content-Type")

	// Exact version JSON: {"version":"<target>"} ⇒ pass; a different version ⇒ fail.
	if resp.StatusCode == http.StatusOK {
		var vj struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(body, &vj) == nil && looksLikeJSONObject(body) {
			if vj.Version == targetVersion {
				return true, true, ""
			}
			return false, true, fmt.Sprintf("version %q != target %q", vj.Version, targetVersion)
		}
		// Non-JSON 200: the SPA shell is the only tolerated shape (non-strict).
		if !strictVersion && strings.Contains(strings.ToLower(ct), "text/html") {
			return true, true, ""
		}
		return false, true, fmt.Sprintf("unexpected 200 body (content-type %q)", ct)
	}
	// Legacy route-missing (non-strict): a 404 means "no /version route", ID already proved it.
	if !strictVersion && resp.StatusCode == http.StatusNotFound {
		return true, true, ""
	}
	return false, true, fmt.Sprintf("status %d", resp.StatusCode)
}

// looksLikeJSONObject guards json.Unmarshal-into-struct from silently accepting a
// bare JSON `null`/number/string as an object; the /version contract is an object.
func looksLikeJSONObject(b []byte) bool {
	t := strings.TrimSpace(string(b))
	return strings.HasPrefix(t, "{")
}
