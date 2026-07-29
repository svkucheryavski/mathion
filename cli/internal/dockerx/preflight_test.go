package dockerx

import (
	"context"
	"net"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestVolumeExists(t *testing.T) {
	present := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "ok", nil }}
	got, err := VolumeExists(context.Background(), present, "mathion_prod_mathion_pgdata")
	if err != nil || !got {
		t.Fatalf("VolumeExists present = (%v,%v), want (true,nil)", got, err)
	}
	// docker volume inspect exits non-zero when the volume is absent.
	absent := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "", &exitErr{} }}
	got, err = VolumeExists(context.Background(), absent, "x")
	if err != nil || got {
		t.Fatalf("VolumeExists absent = (%v,%v), want (false,nil)", got, err)
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
