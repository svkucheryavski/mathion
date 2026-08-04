package dockerx

import (
	"context"
	"net"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestVolumeExists(t *testing.T) {
	// `volume ls --filter name=^X$ --quiet` prints the volume name when present.
	present := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		return "mathion_prod_mathion_pgdata\n", nil
	}}
	got, err := VolumeExists(context.Background(), present, "mathion_prod_mathion_pgdata")
	if err != nil || !got {
		t.Fatalf("VolumeExists present = (%v,%v), want (true,nil)", got, err)
	}
	// ...and prints nothing when the volume is absent.
	absent := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "", nil }}
	got, err = VolumeExists(context.Background(), absent, "x")
	if err != nil || got {
		t.Fatalf("VolumeExists absent = (%v,%v), want (false,nil)", got, err)
	}
	// A daemon/CLI error must PROPAGATE (fail closed), never be read as "absent".
	failing := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "", &exitErr{} }}
	if got, err := VolumeExists(context.Background(), failing, "x"); err == nil || got {
		t.Fatalf("VolumeExists on docker error = (%v,%v), want (false, non-nil)", got, err)
	}
}

type exitErr struct{}

func (e *exitErr) Error() string { return "exit status 1" }

func TestPortFree(t *testing.T) {
	if err := PortFree("127.0.0.1:0"); err != nil {
		t.Fatalf("PortFree on an unused port errored: %v", err)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	if err := PortFree(ln.Addr().String()); err == nil {
		t.Fatal("PortFree should fail when the port is in use")
	}
}
