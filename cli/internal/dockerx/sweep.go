package dockerx

import (
	"context"
	"fmt"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// SweepWorkers removes orphaned one-shot worker containers left behind by a
// crashed backup/restore/update operation. It is label-scoped — it matches only
// containers carrying BOTH the io.mathion.worker=1 marker and the resolved
// compose-project label, never a name substring — so it can never touch an
// unrelated container. No worker containers matching is not an error.
func SweepWorkers(ctx context.Context, r compose.Runner, project string) error {
	out, err := r.Output(ctx, "ps", "-aq", "--filter", "label=io.mathion.worker=1", "--filter", "label=com.docker.compose.project="+project)
	if err != nil {
		return fmt.Errorf("listing worker containers: %w", err)
	}
	var ids []string
	for _, ln := range strings.Fields(out) {
		if ln != "" {
			ids = append(ids, ln)
		}
	}
	if len(ids) > 0 {
		if err := r.Run(ctx, append([]string{"rm", "-f"}, ids...)...); err != nil {
			return fmt.Errorf("removing worker containers: %w", err)
		}
	}
	return nil
}
