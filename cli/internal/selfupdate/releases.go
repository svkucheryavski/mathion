package selfupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

// config carries every injected endpoint / cap / timeout so unit tests need no
// network or root. Defined in full here (Go structs are single-definition); each
// field notes the task that consumes it. The OpenPGP keyring is deliberately NOT a
// field (it would force a go-crypto import before Task 4) — it is passed separately.
type config struct {
	apiBase          string        // Task 3 — https://api.github.com/repos/<owner>/<repo>
	dlBase           string        // Task 8 — https://github.com/<owner>/<repo>/releases/download
	client           *http.Client  // Task 3
	perReqTO         time.Duration // Task 3 — per-request timeout
	pageCap          int           // Task 3
	capReleasesPage  int64         // Task 3
	capChecksums     int64         // Task 8
	capAsc           int64         // Task 8
	capArchive       int64         // Task 8
	capExtracted     int64         // Task 8
	verifyBudget     time.Duration // Task 8 — overall verify-loop wall-clock
	topN             int           // Task 8 — max candidates tried
	archiveIdleTO    time.Duration // Task 8 — archive idle/stall timeout
	archiveOverallTO time.Duration // Task 8 — archive overall deadline
	swapTarget       string        // Task 9 — configured swap-target (default /usr/local/bin/mathion)
}

type release struct {
	Tag        string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// normalizeForCompare maps a CLI tag / buildVersion to a semver string for
// semver.Compare, or "" if it is not a canonical 3-component cli-vX.Y.Z with no
// prerelease. "" sorts below every release (so a `dev` build always proceeds). §4.1.
func normalizeForCompare(tag string) string {
	v := strings.TrimPrefix(tag, "cli-") // cli-v1.2.3 -> v1.2.3 ; dev -> dev
	if !semver.IsValid(v) || semver.Canonical(v) != v || semver.Prerelease(v) != "" {
		return ""
	}
	return v
}

// forwardEligible keeps non-draft, non-prerelease, canonical cli-vX.Y.Z tags
// strictly greater than current (normalized), sorted DESCENDING. §4.2 step 3.
func forwardEligible(all []release, current string) []string {
	cur := normalizeForCompare(current) // "" for dev -> everything is forward
	var out []string
	for _, r := range all {
		if r.Draft || r.Prerelease || !strings.HasPrefix(r.Tag, "cli-v") {
			continue
		}
		nv := normalizeForCompare(r.Tag)
		if nv == "" {
			continue
		}
		if cur == "" || semver.Compare(nv, cur) > 0 {
			out = append(out, r.Tag)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return semver.Compare(normalizeForCompare(out[i]), normalizeForCompare(out[j])) > 0
	})
	return out
}

// hasNextLink reports whether a GitHub Link header advertises another page.
func hasNextLink(link string) bool { return strings.Contains(link, `rel="next"`) }

// fetchReleases GETs every page of /releases (per_page=100) up to pageCap,
// accumulating ALL entries. If a (pageCap+1)-th page is advertised it aborts
// fail-closed rather than truncating. §4.2 step 3, §6.4.
func fetchReleases(ctx context.Context, cfg config) ([]release, error) {
	var out []release
	for page := 1; page <= cfg.pageCap; page++ {
		url := fmt.Sprintf("%s/releases?per_page=100&page=%d", cfg.apiBase, page)
		body, hdr, err := getLimited(ctx, cfg.client, url, cfg.capReleasesPage, cfg.perReqTO)
		if err != nil {
			return nil, err
		}
		var pageRels []release
		if err := json.Unmarshal(body, &pageRels); err != nil {
			return nil, fmt.Errorf("parse releases page %d: %w", page, err)
		}
		out = append(out, pageRels...)
		if !hasNextLink(hdr.Get("Link")) {
			return out, nil
		}
		if page == cfg.pageCap {
			return nil, fmt.Errorf("release list exceeds the pagination cap (%d pages)", cfg.pageCap)
		}
	}
	return out, nil
}
