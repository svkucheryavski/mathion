package cmd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

const (
	gateTargetID  = "sha256:tgt"
	gateTargetVer = "v1.2.3"
	gateAppCID    = "appcid"
)

// gateRunner answers `compose … ps -q app` with cid and a raw
// `inspect <cid> --format {{.Image}}` with imageID — the two Output calls the gate
// makes for its authoritative image-identity check.
func gateRunner(cid, imageID string) *compose.FakeRunner {
	return &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			j := strings.Join(args, " ")
			switch {
			case strings.Contains(j, "ps -q app"):
				return cid + "\n", nil
			case len(args) >= 1 && args[0] == "inspect":
				return imageID + "\n", nil
			}
			return "", nil
		},
	}
}

func gateApp(f *compose.FakeRunner) *App {
	return &App{Project: "mathion_prod", Runner: f}
}

// shrinkGate replaces the gate budget with fast test values and restores the real
// ones on cleanup (capturing the previous values, not the constants, so a later
// budget change never desyncs the restore).
func shrinkGate(t *testing.T, timeout, interval time.Duration) {
	t.Helper()
	pt, pp := gateTimeout, pollInterval
	t.Cleanup(func() { gateTimeout, pollInterval = pt, pp })
	gateTimeout, pollInterval = timeout, interval
}

// useGateServer points gateVersionURL at a fresh httptest server wrapping h, returns
// a per-request counter, and restores the URL + closes the server on cleanup.
func useGateServer(t *testing.T, h http.HandlerFunc) *int32 {
	t.Helper()
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&n, 1)
		h(w, r)
	}))
	prev := gateVersionURL
	gateVersionURL = srv.URL + "/version"
	t.Cleanup(func() {
		gateVersionURL = prev
		srv.Close()
	})
	return &n
}

// TestGatePassExactJSON: an ID match plus an exact `{"version":<target>}` passes in
// BOTH strict and non-strict mode.
func TestGatePassExactJSON(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"` + gateTargetVer + `"}`))
	})
	f := gateRunner(gateAppCID, gateTargetID)
	for _, strict := range []bool{false, true} {
		if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, strict); err != nil {
			t.Fatalf("strict=%v: exact version JSON must pass; got %v", strict, err)
		}
	}
}

// TestGatePassNonStrict404: an ID match with a 404 (no /version route) passes when
// !strictVersion — the image-ID already proved the deploy on a legacy image.
func TestGatePassNonStrict404(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	f := gateRunner(gateAppCID, gateTargetID)
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, false); err != nil {
		t.Fatalf("non-strict 404 must pass (legacy route-missing); got %v", err)
	}
}

// TestGatePassNonStrictSPA: an ID match with a 200 text/html SPA shell passes when
// !strictVersion (the second verified pre-slice-3 shape).
func TestGatePassNonStrictSPA(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<!doctype html><html><body>app</body></html>"))
	})
	f := gateRunner(gateAppCID, gateTargetID)
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, false); err != nil {
		t.Fatalf("non-strict 200 SPA shell must pass; got %v", err)
	}
}

// TestGateFailSubstringContentType: the SPA tolerance requires an EXACT text/html
// media type. A 200 whose Content-Type merely CONTAINS "text/html" as a parameter
// (e.g. application/json; profile="text/html") over a non-object body must NOT pass
// — it reaches the media-type check and mime.ParseMediaType yields application/json.
// Regression for the content-type substring-match (finding 2).
func TestGateFailSubstringContentType(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", `application/json; profile="text/html"`)
		_, _ = w.Write([]byte("<not-json>")) // non-object body ⇒ falls through to the media-type check
	})
	f := gateRunner(gateAppCID, gateTargetID)
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, false); err == nil {
		t.Fatal(`a content-type that only contains "text/html" as a parameter must not pass as an SPA shell`)
	}
}

// TestGateFailRedirectNotFollowed: a 302 from /version is a TERMINAL fail — the gate
// must NOT follow it to a 200 text/html login page and mis-classify that as the
// SPA-shell pass. Regression for the redirect-following fail-open (finding 1).
func TestGateFailRedirectNotFollowed(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/version" {
			http.Redirect(w, r, "/login", http.StatusFound) // 302 -> auth wall
			return
		}
		// The login page a redirect-following client would have chased into and
		// wrongly accepted as the non-strict SPA shell.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<!doctype html><html><body>login</body></html>"))
	})
	f := gateRunner(gateAppCID, gateTargetID)
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, false); err == nil {
		t.Fatal("a 302 from /version must be a terminal fail, not followed to a 200 SPA page")
	}
}

// TestGateFailDifferentVersion: an exact JSON with a DIFFERENT version fails in both
// modes (a terminal reject — the wrong code is serving).
func TestGateFailDifferentVersion(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"v9.9.9"}`))
	})
	f := gateRunner(gateAppCID, gateTargetID)
	for _, strict := range []bool{false, true} {
		if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, strict); err == nil {
			t.Fatalf("strict=%v: a different reported version must fail", strict)
		}
	}
}

// TestGateFail5xx: any non-200/non-404 status (here 500) fails, even non-strict.
func TestGateFail5xx(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	f := gateRunner(gateAppCID, gateTargetID)
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, false); err == nil {
		t.Fatal("a 5xx must fail the gate")
	}
}

// TestGateFailIDMismatch: the running image ID != target fails BEFORE any /version
// fetch (the ID check is authoritative and short-circuits) — the server sees 0 hits.
func TestGateFailIDMismatch(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	n := useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"` + gateTargetVer + `"}`))
	})
	f := gateRunner(gateAppCID, "sha256:OTHER")
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, false); err == nil {
		t.Fatal("an image-ID mismatch must fail (a moved tag booted the wrong image)")
	}
	if got := atomic.LoadInt32(n); got != 0 {
		t.Fatalf("/version must NOT be hit on an ID mismatch; got %d requests", got)
	}
}

// TestGateFailStrict404: strictVersion has no legacy tolerance, so a 404 fails.
func TestGateFailStrict404(t *testing.T) {
	shrinkGate(t, 200*time.Millisecond, 10*time.Millisecond)
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	f := gateRunner(gateAppCID, gateTargetID)
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, true); err == nil {
		t.Fatal("strict mode must reject a 404 (no legacy tolerance)")
	}
}

// TestGateFailConnRefused: a transport error (connection refused) is non-terminal —
// the gate retries — but a budget that never clears ends in a failure.
func TestGateFailConnRefused(t *testing.T) {
	shrinkGate(t, 60*time.Millisecond, 10*time.Millisecond)
	// A server closed immediately, so its URL refuses connections for the whole run.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	prev := gateVersionURL
	gateVersionURL = srv.URL + "/version"
	srv.Close()
	t.Cleanup(func() { gateVersionURL = prev })
	f := gateRunner(gateAppCID, gateTargetID)
	if err := gateImageAndVersion(context.Background(), gateApp(f), gateTargetID, gateTargetVer, false); err == nil {
		t.Fatal("a connection-refused that never clears within the budget must fail")
	}
}
