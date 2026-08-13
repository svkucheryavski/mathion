package dockerx

import (
	"context"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// assertCall passes if any recorded call's arg vector deeply equals want.
func assertCall(t *testing.T, calls [][]string, want []string) {
	t.Helper()
	for _, c := range calls {
		if reflect.DeepEqual(c, want) {
			return
		}
	}
	t.Fatalf("missing expected call %v; got %v", want, calls)
}

func TestSweepWorkersByLabel(t *testing.T) {
	f := &compose.FakeRunner{OutputFunc: func(a []string) (string, error) {
		if a[0] == "ps" {
			return "abc123\n", nil
		}
		return "", nil
	}}
	if err := SweepWorkers(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	// assert a ps with BOTH label filters, then rm -f abc123
	assertCall(t, f.Calls, []string{"ps", "-aq", "--filter", "label=io.mathion.worker=1", "--filter", "label=com.docker.compose.project=mathion_prod"})
	assertCall(t, f.Calls, []string{"rm", "-f", "abc123"})
}
