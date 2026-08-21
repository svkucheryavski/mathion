//go:build !linux

package selfupdate

import (
	"context"
	"errors"
)

// Run is a stub on non-Linux dev hosts so `go build ./...` / `go test ./cmd/`
// compile; the real implementation is Linux-only (run_linux.go). §5.2.
func Run(_ context.Context, _ Params) error {
	return errors.New("self-update is supported only on Linux")
}
