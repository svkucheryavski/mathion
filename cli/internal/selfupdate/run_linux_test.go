//go:build linux

package selfupdate

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ProtonMail/go-crypto/openpgp"
	"golang.org/x/sys/unix"
)

// harness wires a temp swap-target + a release server + throwaway keys, returning
// Params and a "root called?" flag. The env-coupled guards are seamed:
// captureRunningImageFn returns the temp target's real dev/ino (so the REAL
// recheckRunningIdentity passes when the target is unchanged) and walkAncestryFn
// returns a real fd to the temp dir with SYNTHETIC root-safe components (a real
// t.TempDir ancestry is 1777 world-writable and would fail ancestrySafe).
// stagedVersion is stubbed (real exec is Task 13); the stage+commit swap is REAL.
// The returned *int counts archive-endpoint hits (for the --check no-fetch assert);
// it is race-clean — only the happy path writes it, only the --check test reads it.
func harness(t *testing.T, currentVersion string) (Params, *bool, *int, func()) {
	t.Helper()
	dir := t.TempDir()
	target := filepath.Join(dir, "mathion")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	var tst unix.Stat_t
	if err := unix.Lstat(target, &tst); err != nil {
		t.Fatal(err)
	}
	relEntity, relKR := newSigner(t)
	asset := archiveName()
	bin := tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("newbin")}})
	sum := sha256.Sum256(bin)
	sums := []byte(fmt.Sprintf("%s  %s\n", hex.EncodeToString(sum[:]), asset))
	archiveHits := 0 // declared BEFORE srv so the handler closure can capture it

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/releases":
			fmt.Fprint(w, `[{"tag_name":"cli-v0.9.0"},{"tag_name":"cli-v0.2.0"}]`)
		case strings.HasSuffix(r.URL.Path, "/checksums.txt"):
			w.Write(sums)
		case strings.HasSuffix(r.URL.Path, "/checksums.txt.asc"):
			w.Write(armoredSig(t, relEntity, sums))
		case strings.HasSuffix(r.URL.Path, asset):
			archiveHits++
			w.Write(bin)
		default:
			w.WriteHeader(404)
		}
	}))

	rootCalled := false
	oExe, oEval, oGe, oKr, oSv := osExecutable, evalSymlinks, geteuid, loadKeyringFn, stagedVersion
	oCap, oWalk, oDpkg := captureRunningImageFn, walkAncestryFn, dpkgSearch
	osExecutable = func() (string, error) { return target, nil }
	evalSymlinks = func(string) (string, error) { return target, nil }
	geteuid = func() int { rootCalled = true; return 0 }
	loadKeyringFn = func() (openpgp.EntityList, error) { return relKR, nil }
	stagedVersion = func(int, string) (string, error) { return "cli-v0.9.0", nil }
	captureRunningImageFn = func() (uint64, uint64, error) { return uint64(tst.Dev), uint64(tst.Ino), nil }
	walkAncestryFn = func(string) ([]component, int, error) {
		fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
		if err != nil {
			return nil, -1, err
		}
		return []component{{name: "/", uid: 0, mode: 0o755}}, fd, nil
	}
	dpkgSearch = func(context.Context, string) dpkgResult {
		return dpkgResult{stderr: []byte("no path found matching pattern"), exitCode: 1}
	}
	cleanup := func() {
		srv.Close()
		osExecutable, evalSymlinks, geteuid, loadKeyringFn, stagedVersion = oExe, oEval, oGe, oKr, oSv
		captureRunningImageFn, walkAncestryFn, dpkgSearch = oCap, oWalk, oDpkg
	}

	cfg := DefaultConfig()
	cfg.apiBase, cfg.dlBase = srv.URL, srv.URL
	cfg.client = newHTTPClient(srv.Client().Transport, 5)
	cfg.swapTarget = target
	cfg.verifyBudget, cfg.perReqTO = 5*time.Second, 2*time.Second
	cfg.archiveIdleTO, cfg.archiveOverallTO = 2*time.Second, 5*time.Second
	return Params{Out: &bytes.Buffer{}, Err: &bytes.Buffer{}, In: strings.NewReader("y\n"),
		Cfg: cfg, CurrentVersion: currentVersion}, &rootCalled, &archiveHits, cleanup
}

func TestRun_HappyPath_Swaps(t *testing.T) {
	p, _, _, done := harness(t, "cli-v0.2.0")
	defer done()
	p.Yes = true
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("run: %v", err)
	}
	got, _ := os.ReadFile(p.Cfg.swapTarget)
	if string(got) != "newbin" {
		t.Fatalf("target not swapped: %q", got)
	}
	if !strings.Contains(out.String(), "cli-v0.9.0") {
		t.Fatalf("missing old→new line: %q", out.String())
	}
	if !strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("a successful self-update must nudge toward reconcile; got %q", out.String())
	}
	if si, ni := strings.Index(out.String(), "cli-v0.9.0"), strings.Index(out.String(), "sudo mathion reconcile"); ni < si {
		t.Fatalf("the reconcile nudge must FOLLOW the success line (spec §8 test 13 ordering); got %q", out.String())
	}
	if !strings.Contains(out.String(), "will report whether this release changed the stack") {
		t.Fatalf("self-update must print the neutral next-command line; got %q", out.String())
	}
	if strings.Contains(out.String(), "if this release updated the stack definition") {
		t.Fatalf("the old unconditional nudge phrase must be gone; got %q", out.String())
	}
}

func TestRun_Check_NoRootNoArchiveNoSwap(t *testing.T) {
	p, rootCalled, archiveHits, done := harness(t, "cli-v0.2.0")
	defer done()
	p.Check = true
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("check: %v", err)
	}
	if *rootCalled {
		t.Fatal("--check must NOT require root")
	}
	if *archiveHits != 0 {
		t.Fatalf("--check must NOT fetch the archive, but hit it %d time(s)", *archiveHits)
	}
	if got, _ := os.ReadFile(p.Cfg.swapTarget); string(got) != "old" {
		t.Fatal("--check must NOT swap the binary")
	}
	if !strings.Contains(out.String(), "installable") {
		t.Fatalf("--check output: %q", out.String())
	}
	if strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("--check must NOT print the reconcile nudge; got %q", out.String())
	}
}

func TestRun_AptManaged_Defers(t *testing.T) {
	p, rootCalled, _, done := harness(t, "cli-v0.2.0")
	defer done()
	dpkgSearch = func(context.Context, string) dpkgResult {
		return dpkgResult{stdout: []byte("mathion: /usr/bin/mathion\n"), exitCode: 0}
	}
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("apt defer: %v", err)
	}
	if *rootCalled {
		t.Fatal("apt-managed must NOT require root")
	}
	if !strings.Contains(out.String(), "apt install --only-upgrade mathion") {
		t.Fatalf("apt defer output: %q", out.String())
	}
	if strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("apt-defer must NOT print the reconcile nudge; got %q", out.String())
	}
}

func TestRun_Decline_ReturnsNil(t *testing.T) {
	p, _, _, done := harness(t, "cli-v0.2.0")
	defer done()
	p.In = strings.NewReader("n\n")
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("decline must return nil (exit 0): %v", err)
	}
	if got, _ := os.ReadFile(p.Cfg.swapTarget); string(got) != "old" {
		t.Fatal("declined run must NOT swap")
	}
	if !strings.Contains(out.String(), "cancelled") {
		t.Fatalf("decline output: %q", out.String())
	}
	if strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("a cancelled self-update must NOT print the reconcile nudge; got %q", out.String())
	}
}

func TestRun_UpToDate_NoNudge(t *testing.T) {
	p, _, _, done := harness(t, "cli-v0.9.0") // already the newest tag the release list offers
	defer done()
	p.Yes = true
	var out bytes.Buffer
	p.Out = &out
	if err := Run(context.Background(), p); err != nil {
		t.Fatalf("up-to-date must be a clean no-op: %v", err)
	}
	if got, _ := os.ReadFile(p.Cfg.swapTarget); string(got) != "old" {
		t.Fatal("up-to-date must NOT swap the binary")
	}
	if !strings.Contains(out.String(), "already up to date") {
		t.Fatalf("expected the up-to-date line; got %q", out.String())
	}
	if strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("up-to-date must NOT print the reconcile nudge; got %q", out.String())
	}
}

// TestRun_DurabilityUncertain_NoNudge closes the last spec §8 test-13 absence
// case: on the installed-but-durability-uncertain swap (rename committed, dir
// fsync failed), Run returns the durabilityUncertainError at run_linux.go:150 —
// BEFORE the success line and the reconcile nudge — so neither prints. Driven via
// the existing fsFsync seam (its only production call site is commitSwap's dir
// fsync at swap.go:258; staging's own fsync is a separate call), so overriding it
// exercises only the durability-uncertain branch.
func TestRun_DurabilityUncertain_NoNudge(t *testing.T) {
	p, _, _, done := harness(t, "cli-v0.2.0")
	defer done()
	p.Yes = true
	orig := fsFsync
	fsFsync = func(int) error { return errors.New("fsync boom") }
	defer func() { fsFsync = orig }()
	var out bytes.Buffer
	p.Out = &out
	err := Run(context.Background(), p)
	if err == nil {
		t.Fatal("a durability-uncertain swap must surface an error, not exit 0")
	}
	var due *durabilityUncertainError
	if !errors.As(err, &due) {
		t.Fatalf("expected a durabilityUncertainError, got %v", err)
	}
	// The rename DID commit — the binary is swapped — but the process returns
	// before the success line and the nudge.
	if got, _ := os.ReadFile(p.Cfg.swapTarget); string(got) != "newbin" {
		t.Fatalf("a durability-uncertain swap still renames the new binary into place; got %q", got)
	}
	if strings.Contains(out.String(), "sudo mathion reconcile") {
		t.Fatalf("a durability-uncertain self-update must NOT print the reconcile nudge; got %q", out.String())
	}
}
