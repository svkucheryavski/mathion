package cmd

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// assertNoPullOrTag enforces that step 4a stayed READ-ONLY: no docker call may be
// a `pull` (which would move the :version tag) or a `tag`. Every preflight test
// asserts this over the full call log.
func assertNoPullOrTag(t *testing.T, calls [][]string) {
	t.Helper()
	for _, c := range calls {
		for _, arg := range c {
			if arg == "pull" || arg == "tag" {
				t.Fatalf("preflight must be read-only, found %q in call %v", arg, c)
			}
		}
	}
}

// TestPreflightImageRecordedIDLocal: the recorded image_id is locally present, so
// the recorded-id-first probe hits and short-circuits — no tag inspect at all.
func TestPreflightImageRecordedIDLocal(t *testing.T) {
	m := archive.Manifest{ImageID: "sha256:recorded", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			// The tag inspect (contains the repo) must NEVER be reached here; if it
			// is, returning a different id would fail the RID assertion below.
			if strings.Contains(strings.Join(args, " "), compose.ImageRepo) {
				return "sha256:tagid\n", nil
			}
			return "", nil // recorded-id inspect succeeds
		},
	}
	res, err := preflightImage(context.Background(), newTestApp(f), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.RID != "sha256:recorded" {
		t.Fatalf("RID = %q, want %q", res.RID, "sha256:recorded")
	}
	if res.PullFlagged {
		t.Fatalf("PullFlagged = true, want false")
	}
	if len(f.Calls) != 1 {
		t.Fatalf("recorded-id-first must short-circuit; calls = %v", f.Calls)
	}
	assertNoPullOrTag(t, f.Calls)
}

// TestPreflightImageOnlyTagLocal: no recorded id (image_id empty), so the tag
// inspect resolves the local id and no warning is possible.
func TestPreflightImageOnlyTagLocal(t *testing.T) {
	m := archive.Manifest{ImageID: "", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			if strings.Contains(strings.Join(args, " "), compose.ImageRepo) {
				return "sha256:tagid\n", nil
			}
			return "", errors.New("no such image")
		},
	}
	res, err := preflightImage(context.Background(), newTestApp(f), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.RID != "sha256:tagid" {
		t.Fatalf("RID = %q, want %q", res.RID, "sha256:tagid")
	}
	if res.PullFlagged {
		t.Fatalf("PullFlagged = true, want false")
	}
	assertNoPullOrTag(t, f.Calls)
}

// TestPreflightImageBothAbsent: neither the recorded id nor the local tag is
// present, so the pull is flagged for the later (post-confirmation) step — 4a
// itself issues no pull/tag.
func TestPreflightImageBothAbsent(t *testing.T) {
	m := archive.Manifest{ImageID: "sha256:recorded", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			return "", errors.New("no such image")
		},
	}
	res, err := preflightImage(context.Background(), newTestApp(f), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.PullFlagged {
		t.Fatalf("PullFlagged = false, want true")
	}
	if res.RID != "" {
		t.Fatalf("RID = %q, want empty", res.RID)
	}
	assertNoPullOrTag(t, f.Calls)
}

// TestPreflightImageWarnOnDiffer: the recorded id is not local but the local tag
// resolves to a DIFFERENT id — restore will boot the local tag's image, so 4a
// emits a loud warning to a.Err and still returns the tag's id.
func TestPreflightImageWarnOnDiffer(t *testing.T) {
	m := archive.Manifest{ImageID: "sha256:recorded", MathionVersion: "v1.2.3"}
	f := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			if strings.Contains(strings.Join(args, " "), compose.ImageRepo) {
				return "sha256:different\n", nil
			}
			return "", errors.New("no such image") // recorded id NOT local
		},
	}
	var errb bytes.Buffer
	app := &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f, Err: &errb}
	res, err := preflightImage(context.Background(), app, m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.RID != "sha256:different" {
		t.Fatalf("RID = %q, want %q", res.RID, "sha256:different")
	}
	if res.PullFlagged {
		t.Fatalf("PullFlagged = true, want false")
	}
	if w := errb.String(); !strings.Contains(w, "warning") || !strings.Contains(w, "differs") {
		t.Fatalf("expected a loud differ warning, got %q", w)
	}
	assertNoPullOrTag(t, f.Calls)
}
