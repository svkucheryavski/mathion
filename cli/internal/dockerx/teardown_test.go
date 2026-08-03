package dockerx

import (
	"context"
	"reflect"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// programmable fake: Output for ps/inspect, Run for rm/network rm/volume rm.
type purgeFake struct {
	compose.FakeRunner
	psIDs     string
	inspectOK map[string]bool // resource name -> exists
	rmVolErr  map[string]error
}

func (p *purgeFake) Output(ctx context.Context, args ...string) (string, error) {
	p.Calls = append(p.Calls, args)
	switch {
	case args[0] == "ps":
		return p.psIDs, nil
	case args[0] == "network" && args[1] == "inspect":
		if p.inspectOK[args[2]] {
			return "ok", nil
		}
		return "", &noSuch{}
	case args[0] == "volume" && args[1] == "inspect":
		if p.inspectOK[args[2]] {
			return "ok", nil
		}
		return "", &noSuch{}
	}
	return "", nil
}

func (p *purgeFake) Run(ctx context.Context, args ...string) error {
	p.Calls = append(p.Calls, args)
	if args[0] == "volume" && args[1] == "rm" {
		if err := p.rmVolErr[args[2]]; err != nil {
			return err
		}
	}
	return nil
}

type noSuch struct{}

func (n *noSuch) Error() string { return "no such" }

func TestPurgeDiscoversAndRemovesInOrder(t *testing.T) {
	f := &purgeFake{
		psIDs:     "abc123\ndef456\n",
		inspectOK: map[string]bool{"mathion_prod_default": true, "mathion_prod_mathion_pgdata": true, "mathion_prod_mathion_assets": true},
	}
	if err := Purge(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	// container discovery + rm -f with the discovered ids
	assertCall(t, f.Calls, []string{"ps", "-aq", "--filter", "label=com.docker.compose.project=mathion_prod"})
	assertCall(t, f.Calls, []string{"rm", "-f", "abc123", "def456"})
	assertCall(t, f.Calls, []string{"network", "rm", "mathion_prod_default"})
	assertCall(t, f.Calls, []string{"volume", "rm", "mathion_prod_mathion_pgdata"})
	assertCall(t, f.Calls, []string{"volume", "rm", "mathion_prod_mathion_assets"})
}

func TestPurgeEmptyContainersSkipsRm(t *testing.T) {
	f := &purgeFake{psIDs: "\n", inspectOK: map[string]bool{"mathion_prod_mathion_pgdata": true}}
	if err := Purge(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.Calls {
		if len(c) > 0 && c[0] == "rm" {
			t.Fatal("rm invoked with no container IDs")
		}
	}
}

func TestPurgeVolumeInUseFailsTeardown(t *testing.T) {
	f := &purgeFake{
		psIDs:     "",
		inspectOK: map[string]bool{"mathion_prod_mathion_pgdata": true},
		rmVolErr:  map[string]error{"mathion_prod_mathion_pgdata": &noSuch{}}, // simulate a non-absence failure
	}
	if err := Purge(context.Background(), f, "mathion_prod"); err == nil {
		t.Fatal("a volume-rm failure on an existing volume must fail teardown")
	}
}

func assertCall(t *testing.T, calls [][]string, want []string) {
	t.Helper()
	for _, c := range calls {
		if reflect.DeepEqual(c, want) {
			return
		}
	}
	t.Fatalf("expected call %v not found in %v", want, calls)
}
