package dockerx

import (
	"context"
	"fmt"
	"net"
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

func VolumeExists(ctx context.Context, r compose.Runner, name string) (bool, error) {
	if _, err := r.Output(ctx, "volume", "inspect", name); err != nil {
		return false, nil // inspect exits non-zero when absent
	}
	return true, nil
}
