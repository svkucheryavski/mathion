package dockerx

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// programmable fake: Output answers `ps` and `<kind> ls` existence checks; Run
// records rm / `<kind> rm` and can be made to fail per resource.
type purgeFake struct {
	compose.FakeRunner
	psIDs    string
	existing map[string]bool  // resource name -> present (reported by ls)
	lsErr    map[string]error // resource name -> existence-check error
	rmErr    map[string]error // resource name -> rm error
}

// filterName extracts <name> from a `name=^<name>$` ls filter argument.
func filterName(args []string) string {
	for _, a := range args {
		if strings.HasPrefix(a, "name=^") && strings.HasSuffix(a, "$") {
			return strings.TrimSuffix(strings.TrimPrefix(a, "name=^"), "$")
		}
	}
	return ""
}

func (p *purgeFake) Output(ctx context.Context, args ...string) (string, error) {
	p.Calls = append(p.Calls, args)
	switch {
	case args[0] == "ps":
		return p.psIDs, nil
	case (args[0] == "network" || args[0] == "volume") && args[1] == "ls":
		name := filterName(args)
		if err := p.lsErr[name]; err != nil {
			return "", err
		}
		if p.existing[name] {
			return name + "\n", nil
		}
		return "", nil
	}
	return "", nil
}

func (p *purgeFake) Run(ctx context.Context, args ...string) error {
	p.Calls = append(p.Calls, args)
	if (args[0] == "network" || args[0] == "volume") && args[1] == "rm" {
		if err := p.rmErr[args[2]]; err != nil {
			return err
		}
	}
	return nil
}

type noSuch struct{}

func (n *noSuch) Error() string { return "no such" }

func TestPurgeDiscoversAndRemovesInOrder(t *testing.T) {
	f := &purgeFake{
		psIDs: "abc123\ndef456\n",
		existing: map[string]bool{
			"mathion_prod_default":        true,
			"mathion_prod_frontend":       true,
			"mathion_prod_mathion_pgdata": true,
			"mathion_prod_mathion_assets": true,
			"mathion_prod_mathion_acme":   true,
		},
	}
	if err := Purge(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	// Assert the EXACT ordered sequence: discovery -> rm -f -> each resource is
	// existence-checked immediately before it is removed, networks (default,
	// frontend) before volumes (pgdata, assets, acme).
	want := [][]string{
		{"ps", "-aq", "--filter", "label=com.docker.compose.project=mathion_prod"},
		{"rm", "-f", "abc123", "def456"},
		{"network", "ls", "--filter", "name=^mathion_prod_default$", "--quiet"},
		{"network", "rm", "mathion_prod_default"},
		{"network", "ls", "--filter", "name=^mathion_prod_frontend$", "--quiet"},
		{"network", "rm", "mathion_prod_frontend"},
		{"volume", "ls", "--filter", "name=^mathion_prod_mathion_pgdata$", "--quiet"},
		{"volume", "rm", "mathion_prod_mathion_pgdata"},
		{"volume", "ls", "--filter", "name=^mathion_prod_mathion_assets$", "--quiet"},
		{"volume", "rm", "mathion_prod_mathion_assets"},
		{"volume", "ls", "--filter", "name=^mathion_prod_mathion_acme$", "--quiet"},
		{"volume", "rm", "mathion_prod_mathion_acme"},
	}
	if !reflect.DeepEqual(f.Calls, want) {
		t.Fatalf("call sequence mismatch:\n got %v\nwant %v", f.Calls, want)
	}
}

func TestPurgeEmptyContainersSkipsRm(t *testing.T) {
	f := &purgeFake{psIDs: "\n", existing: map[string]bool{"mathion_prod_mathion_pgdata": true}}
	if err := Purge(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.Calls {
		if len(c) > 0 && c[0] == "rm" {
			t.Fatal("rm invoked with no container IDs")
		}
	}
}

func TestPurgeAbsentResourcesSkipRemoval(t *testing.T) {
	// Nothing exists: every ls returns empty, so no resource is removed.
	f := &purgeFake{psIDs: "", existing: map[string]bool{}}
	if err := Purge(context.Background(), f, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.Calls {
		if len(c) >= 2 && c[1] == "rm" {
			t.Fatalf("removed an absent resource: %v", c)
		}
	}
}

func TestPurgeFailsClosedOnCheckError(t *testing.T) {
	// A non-absence error from the network existence check must fail teardown and
	// stop before any removal or any later existence check (fail-closed).
	f := &purgeFake{
		psIDs:    "",
		lsErr:    map[string]error{"mathion_prod_default": &noSuch{}},
		existing: map[string]bool{"mathion_prod_mathion_pgdata": true},
	}
	if err := Purge(context.Background(), f, "mathion_prod"); err == nil {
		t.Fatal("an existence-check error must fail teardown (fail closed)")
	}
	for _, c := range f.Calls {
		if len(c) >= 2 && c[1] == "rm" {
			t.Fatalf("teardown continued to a removal after a check error: %v", c)
		}
		if len(c) >= 2 && c[0] == "volume" && c[1] == "ls" {
			t.Fatalf("teardown continued to volumes after a network check error: %v", c)
		}
	}
}

func TestPurgeVolumeInUseFailsTeardown(t *testing.T) {
	f := &purgeFake{
		psIDs:    "",
		existing: map[string]bool{"mathion_prod_mathion_pgdata": true},
		rmErr:    map[string]error{"mathion_prod_mathion_pgdata": &noSuch{}}, // e.g. volume in use
	}
	if err := Purge(context.Background(), f, "mathion_prod"); err == nil {
		t.Fatal("a volume-rm failure on an existing volume must fail teardown")
	}
}

func TestPurgeRemovesFrontendAndAcme(t *testing.T) {
	var calls [][]string
	fr := &compose.FakeRunner{
		OutputFunc: func(args []string) (string, error) {
			// container list empty; every `<kind> ls` reports the resource present.
			if len(args) > 0 && args[0] == "ps" {
				return "", nil
			}
			return "found\n", nil
		},
		RunFunc: func(args []string) error { calls = append(calls, args); return nil },
	}
	if err := Purge(context.Background(), fr, "mathion_prod"); err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"network mathion_prod_frontend":    false,
		"volume mathion_prod_mathion_acme": false,
	}
	for _, c := range calls {
		j := strings.Join(c, " ")
		for k := range want {
			// removeIfPresent issues `<kind> rm <name>`.
			if strings.Contains(j, "rm "+strings.Fields(k)[1]) {
				want[k] = true
			}
		}
	}
	for k, seen := range want {
		if !seen {
			t.Errorf("Purge must remove %s; calls=%v", k, calls)
		}
	}
}
