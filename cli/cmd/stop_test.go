package cmd

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

func TestStopArgv(t *testing.T) {
	rootedVarlib(t)
	f := &compose.FakeRunner{}
	cmd := newStopCmd(newTestApp(f))
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	// The sweep is call 0; find the `stop` and assert its exact argv.
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "--profile", "tls", "stop"}
	if i := idxOfCall(f.Calls, func(a []string) bool { return reflect.DeepEqual(a, want) }); i < 0 {
		t.Fatalf("stop must issue `... stop`, got %v", f.Calls)
	}
}

// TestStopContainmentRetainsBreadcrumbAndHints: stop is a containment command —
// with a leftover breadcrumb present it STILL stops the stack, RETAINS the
// breadcrumb (never clears it), never brings anything up or restores, and prints a
// recovery hint naming the restore command.
func TestStopContainmentRetainsBreadcrumbAndHints(t *testing.T) {
	rootedVarlib(t)
	seedBreadcrumb(t)
	f := &compose.FakeRunner{}
	var errb bytes.Buffer
	app := &App{CfgDir: "/etc/mathion", Project: "mathion_prod", Runner: f, Err: &errb}
	cmd := newStopCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	want := []string{"compose", "-p", "mathion_prod", "-f", "/etc/mathion/docker-compose.yml", "--env-file", "/etc/mathion/.env", "--profile", "tls", "stop"}
	if !hasCall(f.Calls, func(a []string) bool { return reflect.DeepEqual(a, want) }) {
		t.Fatalf("containment stop must still stop the stack; calls=%v", f.Calls)
	}
	if hasCall(f.Calls, joinHas("up -d")) || hasCall(f.Calls, joinHas("mathion_restore_db_")) {
		t.Fatalf("containment stop must not bring up or restore; calls=%v", f.Calls)
	}
	if _, present, _ := varlib.ReadJournal(); !present {
		t.Fatal("stop must RETAIN the breadcrumb (never clears it)")
	}
	w := errb.String()
	if !strings.Contains(w, "UNVERIFIED") || !strings.Contains(w, "mathion restore -- ") {
		t.Fatalf("expected a recovery hint naming the restore command; got %q", w)
	}
}
