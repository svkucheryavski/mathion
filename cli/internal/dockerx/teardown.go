package dockerx

import (
	"context"
	"fmt"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// Purge tears down the resolved project's resources by name (config-independent).
// Order: containers -> network -> volumes. Only a not-found outcome is tolerated;
// any other failure fails teardown so the caller retains <cfgdir>.
func Purge(ctx context.Context, r compose.Runner, project string) error {
	out, err := r.Output(ctx, "ps", "-aq", "--filter", "label=com.docker.compose.project="+project)
	if err != nil {
		return fmt.Errorf("listing project containers: %w", err)
	}
	var ids []string
	for _, ln := range strings.Fields(out) {
		if ln != "" {
			ids = append(ids, ln)
		}
	}
	if len(ids) > 0 {
		if err := r.Run(ctx, append([]string{"rm", "-f"}, ids...)...); err != nil {
			return fmt.Errorf("removing containers: %w", err)
		}
	}
	if err := removeIfPresent(ctx, r, []string{"network", "inspect"}, []string{"network", "rm"}, project+"_default"); err != nil {
		return err
	}
	for _, vol := range []string{project + "_mathion_pgdata", project + "_mathion_assets"} {
		if err := removeIfPresent(ctx, r, []string{"volume", "inspect"}, []string{"volume", "rm"}, vol); err != nil {
			return err
		}
	}
	return nil
}

// removeIfPresent inspects a resource; if absent, skips (tolerated); if present,
// removes it and returns any removal error (a non-absence failure).
func removeIfPresent(ctx context.Context, r compose.Runner, inspect, remove []string, name string) error {
	if _, err := r.Output(ctx, append(inspect, name)...); err != nil {
		return nil // absent -> nothing to remove
	}
	if err := r.Run(ctx, append(remove, name)...); err != nil {
		return fmt.Errorf("removing %s: %w", name, err)
	}
	return nil
}
