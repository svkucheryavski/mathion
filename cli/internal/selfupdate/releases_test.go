package selfupdate

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestNormalizeForCompare(t *testing.T) {
	cases := map[string]string{
		"cli-v1.2.3":     "v1.2.3",
		"dev":            "",
		"cli-v1.2":       "", // not 3-component canonical
		"cli-v1.2.3-rc1": "", // prerelease
		"cli-vX":         "",
	}
	for in, want := range cases {
		if got := normalizeForCompare(in); got != want {
			t.Errorf("normalizeForCompare(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestForwardEligible(t *testing.T) {
	all := []release{
		{Tag: "cli-v0.2.0"}, {Tag: "cli-v0.3.0"}, {Tag: "cli-v0.10.0"},
		{Tag: "v0.9.0"},                       // app release — excluded
		{Tag: "cli-v0.4.0", Draft: true},      // draft — excluded
		{Tag: "cli-v0.5.0", Prerelease: true}, // prerelease — excluded
		{Tag: "cli-v0.2.0-rc1"},               // non-canonical — excluded
	}
	got := forwardEligible(all, "cli-v0.2.0")
	if want := []string{"cli-v0.10.0", "cli-v0.3.0"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("current=0.2.0: got %v want %v", got, want)
	}
	// dev build: every canonical cli-v* is forward, descending.
	got = forwardEligible(all, "dev")
	if want := []string{"cli-v0.10.0", "cli-v0.3.0", "cli-v0.2.0"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("current=dev: got %v want %v", got, want)
	}
}

func TestFetchReleases_PaginatesAndCaps(t *testing.T) {
	// Two-page server: page 1 links to a next page; page 2 does not.
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("page") {
		case "1":
			w.Header().Set("Link", `<https://x/releases?page=2>; rel="next"`)
			fmt.Fprint(w, `[{"tag_name":"cli-v0.2.0","draft":false,"prerelease":false}]`)
		case "2":
			fmt.Fprint(w, `[{"tag_name":"cli-v0.3.0","draft":false,"prerelease":false}]`)
		default:
			fmt.Fprint(w, `[]`)
		}
	}))
	defer srv.Close()
	cfg := config{apiBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5),
		capReleasesPage: 1 << 20, perReqTO: time.Second, pageCap: 10}

	rels, err := fetchReleases(context.Background(), cfg)
	if err != nil || len(rels) != 2 {
		t.Fatalf("paginated fetch: rels=%v err=%v", rels, err)
	}

	// pageCap=1 but page 1 still advertises a next page -> fail-closed, never truncate.
	cfg.pageCap = 1
	if _, err := fetchReleases(context.Background(), cfg); err == nil {
		t.Fatal("exceeding the pagination cap must abort, not truncate")
	}
}
