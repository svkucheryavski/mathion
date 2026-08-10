package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// imageResolve is the outcome of the read-only restore image preflight (step 4a):
// which local image the rewind would boot. RID is the resolved image id; when it
// is empty PullFlagged is set, deferring the tag-moving pull/retag to a later,
// post-confirmation step.
type imageResolve struct {
	RID         string
	PullFlagged bool
}

// preflightImage resolves — READ-ONLY — which local image a restore would boot.
// It issues ONLY `docker image inspect` reads: never a `docker pull` (which would
// move the ImageRepo:version tag) and never a `docker tag`. Those mutations are
// deferred to the post-confirmation step.
//
// Resolution order:
//  1. Recorded id first (avoids a needless tag-moving pull): if the manifest
//     records an image id and that exact image is locally present, boot it. On an
//     auto-rollback the pre-update image is always local, so this is the common hit.
//  2. Local tag else: inspect ImageRepo:version and use its current id. If the
//     manifest recorded a DIFFERENT id, warn loudly — restore will boot the local
//     tag's image (gated on its resolved id, not the tag string).
//  3. Neither present: flag the pull for the later step; RID stays empty here.
//
// A not-found from `image inspect` is EXPECTED (it drives the fallthrough), so it
// is never surfaced as an error — all three normal paths return (imageResolve, nil).
func preflightImage(ctx context.Context, a *App, m archive.Manifest) (imageResolve, error) {
	// 1. Recorded id first — success (nil error) is the signal; no --format needed.
	if m.ImageID != "" {
		if _, err := a.Runner.Output(ctx, "image", "inspect", m.ImageID); err == nil {
			return imageResolve{RID: m.ImageID}, nil
		}
	}

	// 2. Local tag — resolve its current id.
	out, err := a.Runner.Output(ctx, "image", "inspect", compose.ImageRepo+":"+m.MathionVersion, "--format", "{{.Id}}")
	if err == nil {
		if rid := strings.TrimSpace(out); rid != "" {
			if m.ImageID != "" && m.ImageID != rid {
				fmt.Fprintf(a.Err, "warning: recorded image id %s differs from the local %s:%s id %s; restore will boot the local tag's image\n",
					m.ImageID, compose.ImageRepo, m.MathionVersion, rid)
			}
			return imageResolve{RID: rid}, nil
		}
	}

	// 3. Neither present — defer the pull/retag to the post-confirmation step.
	return imageResolve{PullFlagged: true}, nil
}
