package dockerx

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func Preflight(ctx context.Context, r compose.Runner) error {
	if _, err := r.Output(ctx, "version"); err != nil {
		return fmt.Errorf("docker not available or daemon unreachable: %w", err)
	}
	if _, err := r.Output(ctx, "compose", "version"); err != nil {
		return fmt.Errorf("docker compose v2 not available: %w", err)
	}
	return nil
}

// PortFree returns an error if addr accepts a TCP connection (port in use).
func PortFree(addr string) error {
	c, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
	if err == nil {
		c.Close()
		return fmt.Errorf("%s is already in use", addr)
	}
	return nil
}

// VolumeExists reports whether a docker volume named exactly `name` exists.
// It fails CLOSED: a daemon/CLI error propagates (never read as "absent"), so
// the install volume-guard can never regenerate secrets over initialized data
// just because the check itself failed. `volume ls --filter name=^X$ --quiet`
// prints the volume's name when present and nothing when absent (an anchored
// filter, so `mathion_pgdata` cannot match `mathion_pgdata_old`).
func VolumeExists(ctx context.Context, r compose.Runner, name string) (bool, error) {
	out, err := r.Output(ctx, "volume", "ls", "--filter", "name=^"+name+"$", "--quiet")
	if err != nil {
		return false, fmt.Errorf("checking volume %s: %w", name, err)
	}
	return strings.TrimSpace(out) != "", nil
}
