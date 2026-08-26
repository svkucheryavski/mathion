package dockerx

import (
	"context"
	"fmt"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// Purge tears down the resolved project's resources by name (config-independent).
// Order: containers -> network -> volumes. A resource is removed only when it is
// positively present; any error while checking or removing fails teardown so the
// caller retains <cfgdir> (fail-closed).
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
	for _, netName := range []string{project + "_default", project + "_frontend"} {
		if err := removeIfPresent(ctx, r, "network", netName); err != nil {
			return err
		}
	}
	for _, vol := range []string{project + "_mathion_pgdata", project + "_mathion_assets", project + "_mathion_acme"} {
		if err := removeIfPresent(ctx, r, "volume", vol); err != nil {
			return err
		}
	}
	return nil
}

// removeIfPresent checks whether a resource of the given kind ("network" | "volume")
// exists via `<kind> ls --filter name=^<name>$ --quiet`, which lists the resource
// only when it is present and exits zero either way. An empty result means the
// resource is absent (tolerated, skipped); a non-empty result means it exists, so
// it is removed. Any error from the existence check or the removal fails teardown:
// unlike `inspect`, `ls` errors only on a genuine failure (daemon down, permission,
// transport), never merely because the resource is missing, so only a positively
// absent resource is skipped.
func removeIfPresent(ctx context.Context, r compose.Runner, kind, name string) error {
	out, err := r.Output(ctx, kind, "ls", "--filter", "name=^"+name+"$", "--quiet")
	if err != nil {
		return fmt.Errorf("checking %s %s: %w", kind, name, err)
	}
	if strings.TrimSpace(out) == "" {
		return nil // absent -> nothing to remove
	}
	if err := r.Run(ctx, kind, "rm", name); err != nil {
		return fmt.Errorf("removing %s: %w", name, err)
	}
	return nil
}
