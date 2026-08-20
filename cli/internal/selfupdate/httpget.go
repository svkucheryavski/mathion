// Package selfupdate implements `mathion self-update`: channel-aware,
// S_rel-signature-verified, forward-only in-place upgrade of the mathion CLI.
package selfupdate

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"
)

// redirectAllowed is the PURE redirect policy (unit-tested directly, not only via
// an injected client): follow redirects but reject any non-https hop and cap depth.
// GitHub asset URLs 302 to objects.githubusercontent.com (§3.2).
func redirectAllowed(nextScheme string, depth, maxDepth int) error {
	if nextScheme != "https" {
		return fmt.Errorf("refusing non-https redirect (scheme %q)", nextScheme)
	}
	if depth > maxDepth {
		return fmt.Errorf("too many redirects (>%d)", maxDepth)
	}
	return nil
}

// newHTTPClient builds the release-fetch client over an injected transport (a test
// supplies an httptest TLS server's trust). CheckRedirect enforces redirectAllowed;
// len(via) is the redirect depth so far.
func newHTTPClient(transport http.RoundTripper, maxDepth int) *http.Client {
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return redirectAllowed(req.URL.Scheme, len(via), maxDepth)
		},
	}
}

// getLimited GETs url under a per-request timeout, requires HTTP 200, and reads at
// most capBytes (erroring if the body would exceed it — the cap binds the FINAL,
// post-redirect body). Returns body + response headers (Link pagination needs them).
func getLimited(ctx context.Context, c *http.Client, url string, capBytes int64, perReq time.Duration) ([]byte, http.Header, error) {
	rctx, cancel := context.WithTimeout(ctx, perReq)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, nil, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, capBytes+1))
	if err != nil {
		return nil, nil, err
	}
	if int64(len(body)) > capBytes {
		return nil, nil, fmt.Errorf("GET %s: body exceeds %d bytes", url, capBytes)
	}
	return body, resp.Header, nil
}
