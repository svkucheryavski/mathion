package selfupdate

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRedirectAllowed(t *testing.T) {
	if err := redirectAllowed("https", 1, 5); err != nil {
		t.Fatalf("https within depth allowed: %v", err)
	}
	if err := redirectAllowed("http", 1, 5); err == nil {
		t.Fatal("http hop must be rejected")
	}
	if err := redirectAllowed("https", 6, 5); err == nil {
		t.Fatal("over-depth must be rejected")
	}
	if err := redirectAllowed("https", 5, 5); err != nil {
		t.Fatalf("boundary depth == maxDepth must be allowed: %v", err)
	}
}

func TestGetLimited_CapStatus(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Write([]byte("hello"))
		case "/big":
			w.Write(bytes.Repeat([]byte("x"), 100))
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer srv.Close()
	c := newHTTPClient(srv.Client().Transport, 5)
	ctx := context.Background()

	body, _, err := getLimited(ctx, c, srv.URL+"/ok", 10, time.Second)
	if err != nil || string(body) != "hello" {
		t.Fatalf("ok: body=%q err=%v", body, err)
	}
	if _, _, err := getLimited(ctx, c, srv.URL+"/big", 10, time.Second); err == nil {
		t.Fatal("over-cap body must error")
	}
	if _, _, err := getLimited(ctx, c, srv.URL+"/err", 10, time.Second); err == nil {
		t.Fatal("non-200 must error")
	}
}

func TestGetLimited_FollowsHTTPSRedirect_CapsPostRedirectBody(t *testing.T) {
	var reachedFinal atomic.Bool
	final := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reachedFinal.Store(true)
		w.Write(bytes.Repeat([]byte("y"), 50)) // 50 bytes AFTER the redirect
	}))
	defer final.Close()
	front := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, final.URL+"/asset", http.StatusFound)
	}))
	defer front.Close()

	pool := x509.NewCertPool()
	pool.AddCert(front.Certificate())
	pool.AddCert(final.Certificate())
	c := newHTTPClient(&http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}, 5)

	// cap 10 < 50: the post-redirect body must be the one that trips the cap.
	_, _, err := getLimited(context.Background(), c, front.URL+"/dl", 10, time.Second)
	if err == nil {
		t.Fatal("post-redirect body over cap must error (proves cap binds the FINAL body)")
	}
	// Discriminate: the error must come from the FINAL body cap, not from a rejected
	// redirect or an unreached final server (either would also produce a non-nil err).
	if !reachedFinal.Load() {
		t.Fatal("redirect was not followed to the final server — error did not originate from the final-body cap")
	}
	if !strings.Contains(err.Error(), "body exceeds 10 bytes") {
		t.Fatalf("want final-body cap error, got %v", err)
	}
}
