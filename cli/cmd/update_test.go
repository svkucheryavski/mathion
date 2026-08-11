package cmd

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// TestUpdateGuardPreconditionValidatesEnv: a broken/incomplete .env aborts BEFORE
// any docker call — ValidateEnvComplete precedes every mutation.
func TestUpdateGuardPreconditionValidatesEnv(t *testing.T) {
	cfg := setupBackupEnv(t) // minimal .env → ValidateEnvComplete FAILS
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err == nil {
		t.Fatal("expected non-nil error from incomplete .env precondition")
	}
	if len(f.Calls) != 0 {
		t.Fatalf("no docker call must precede the env check; got %v", f.Calls)
	}
}

// TestUpdateGuardSameTagJSONMatch: target == active tag and /version returns the
// exact JSON {"version":<tag>} → exit 0 "already at <tag>", NO docker pull.
func TestUpdateGuardSameTagJSONMatch(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"v0.1.1"}`))
	})
	f := &compose.FakeRunner{}
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true}); err != nil {
		t.Fatalf("same-tag JSON match must return nil; got %v", err)
	}
	if !strings.Contains(out.String(), "already at v0.1.1") {
		t.Fatalf("want \"already at v0.1.1\" in output; got %q", out.String())
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("same-tag guard must NOT pull; got %v", f.Calls)
	}
}

// TestUpdateGuardSameTagLegacyNotSupported: target == active tag but /version is a
// legacy 200 text/html SPA shell → strict probe fails → exit 0 "not supported",
// NO docker pull.
func TestUpdateGuardSameTagLegacyNotSupported(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<!doctype html><html><body>app</body></html>"))
	})
	f := &compose.FakeRunner{}
	app, out, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v0.1.1", Yes: true}); err != nil {
		t.Fatalf("same-tag legacy shell must return nil; got %v", err)
	}
	if !strings.Contains(out.String(), "a same-version refresh is not supported") {
		t.Fatalf("want \"a same-version refresh is not supported\" in output; got %q", out.String())
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("same-tag guard must NOT pull; got %v", f.Calls)
	}
}

// TestUpdatePullDistinctTargetCapturesA: a DISTINCT target pulls then image-inspects
// for A, in that order with exact args, and NEVER probes /version.
func TestUpdatePullDistinctTargetCapturesA(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	// Install a counting /version server so any stray probe on a distinct target is
	// caught; a distinct target must never probe.
	n := useGateServer(t, func(w http.ResponseWriter, r *http.Request) {})
	f := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) { return "sha256:AAA\n", nil }}
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", Yes: true}); err != nil {
		t.Fatalf("distinct target with a good pull must return nil; got %v", err)
	}
	if got := atomic.LoadInt32(n); got != 0 {
		t.Fatalf("a distinct target must NOT probe /version; got %d probes", got)
	}
	wantPull := []string{"pull", compose.ImageRepo + ":v2.0.0"}
	pullIdx := idxOfCall(f.Calls, isPull)
	if pullIdx < 0 {
		t.Fatalf("expected a pull call; got %v", f.Calls)
	}
	if !reflect.DeepEqual(f.Calls[pullIdx], wantPull) {
		t.Fatalf("pull args = %v; want %v", f.Calls[pullIdx], wantPull)
	}
	wantInspect := []string{"image", "inspect", compose.ImageRepo + ":v2.0.0", "--format", "{{.Id}}"}
	inspectIdx := idxOfCall(f.Calls, func(a []string) bool { return reflect.DeepEqual(a, wantInspect) })
	if inspectIdx < 0 {
		t.Fatalf("expected an image-inspect for A; got %v", f.Calls)
	}
	if !(pullIdx < inspectIdx) {
		t.Fatalf("pull (idx %d) must precede image-inspect (idx %d); calls %v", pullIdx, inspectIdx, f.Calls)
	}
}

// TestUpdatePullBadTagAborts: a failed pull aborts before capturing A — no
// image-inspect for the id is issued, and (trivially) no backup is taken.
func TestUpdatePullBadTagAborts(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	f := &compose.FakeRunner{RunFunc: func(args []string) error { return errors.New("manifest unknown") }}
	app, _, _ := engineApp(cfg, f, "")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v9.9.9", Yes: true}); err == nil {
		t.Fatal("expected non-nil error from a failed pull")
	}
	if hasCall(f.Calls, joinHas("{{.Id}}")) {
		t.Fatalf("a failed pull must abort before the A image-inspect; got %v", f.Calls)
	}
}

// TestUpdateGuardConfirmDeclined: a distinct target with Yes=false and "n" declines
// before the pull.
func TestUpdateGuardConfirmDeclined(t *testing.T) {
	cfg := setupRestoreEnv(t) // active tag = v0.1.1
	f := &compose.FakeRunner{}
	app, _, _ := engineApp(cfg, f, "n\n")
	if err := runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0"}); err == nil {
		t.Fatal("expected non-nil error when the confirm is declined")
	}
	if hasCall(f.Calls, isPull) {
		t.Fatalf("a declined confirm must NOT pull; got %v", f.Calls)
	}
}

// TestUpdateGuardConfirmNoRollbackClause: the failure clause is branched on
// --no-rollback (both sub-cases decline so the confirm prints then aborts).
func TestUpdateGuardConfirmNoRollbackClause(t *testing.T) {
	t.Run("rollback", func(t *testing.T) {
		cfg := setupRestoreEnv(t)
		f := &compose.FakeRunner{}
		app, out, _ := engineApp(cfg, f, "n\n")
		_ = runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0"})
		if !strings.Contains(out.String(), "auto-rollback on failure") {
			t.Fatalf("want \"auto-rollback on failure\" in output; got %q", out.String())
		}
	})
	t.Run("no-rollback", func(t *testing.T) {
		cfg := setupRestoreEnv(t)
		f := &compose.FakeRunner{}
		app, out, _ := engineApp(cfg, f, "n\n")
		_ = runUpdate(context.Background(), app, updateOpts{Version: "v2.0.0", NoRollback: true})
		if !strings.Contains(out.String(), "left as-is; recover with mathion restore") {
			t.Fatalf("want \"left as-is; recover with mathion restore\" in output; got %q", out.String())
		}
	})
}
