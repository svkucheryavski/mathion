package dockerx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthProbeOK(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer s.Close()
	if err := HealthProbe(context.Background(), s.URL+"/health"); err != nil {
		t.Fatalf("HealthProbe = %v, want nil", err)
	}
}

func TestHealthProbeBadBody(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"degraded"}`))
	}))
	defer s.Close()
	if err := HealthProbe(context.Background(), s.URL+"/health"); err == nil {
		t.Fatal("HealthProbe accepted a non-ok body")
	}
}
