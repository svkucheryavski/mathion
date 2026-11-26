package dockersetup

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPFetch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Write([]byte("body"))
		case "/missing":
			http.NotFound(w, r)
		case "/redirect":
			http.Redirect(w, r, "http://"+r.Host+"/ok", http.StatusFound)
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	if b, err := HTTPFetch(ctx, srv.URL+"/ok"); err != nil || string(b) != "body" {
		t.Fatalf("ok: %q, %v", b, err)
	}
	if _, err := HTTPFetch(ctx, srv.URL+"/missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if _, err := HTTPFetch(ctx, srv.URL+"/fail"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("500: %v", err)
	}
	if _, err := HTTPFetch(ctx, srv.URL+"/redirect"); err == nil {
		t.Fatal("a redirect to plain http must be refused")
	}
}
