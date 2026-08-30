package cmd

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

const driftNote = "apply it with: sudo mathion reconcile"

func TestComposeDriftPrintsWhenBytesDiffer(t *testing.T) {
	varlibReady(t) // fresh varlib so no stale marker
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("expected drift note when bytes differ; got %q", out.String())
	}
}

func TestComposeDriftPrintsWhenMarkerPresentBytesMatch(t *testing.T) {
	varlibReady(t)
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("expected drift note when the apply-pending marker is present; got %q", out.String())
	}
}

func TestComposeDriftSilentWhenComposeAbsentEvenWithMarker(t *testing.T) {
	varlibReady(t)
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir() // no docker-compose.yml (post-purge shape)
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if out.Len() != 0 {
		t.Errorf("compose-absent must be silent even with a stale marker (precedence); got %q", out.String())
	}
}

func TestComposeDriftSilentWhenMatchNoMarker(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if out.Len() != 0 {
		t.Errorf("no drift + no marker must be silent; got %q", out.String())
	}
}

func TestComposeDriftHonorsCfgDir(t *testing.T) {
	varlibReady(t)
	dir := filepath.Join(t.TempDir(), "custom")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir) // reads dir, not a hardcoded /etc/mathion
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("maybeWarnComposeDrift must honor the passed cfgDir; got %q", out.String())
	}
}

// --- driftFromReader: the read+compare+mapping seam (spec §4.3a) ---

// errInjectedRead is a non-EOF read error used to drive the post-open read-error branch
// hermetically (a real FIFO/EACCES fixture exercises open, not Read).
var errInjectedRead = errors.New("injected read error")

// eioReader yields some bytes then a non-EOF error on the SAME Read, mimicking a partial
// read that then fails (io.ReadAll surfaces the error). It records that it was read.
type eioReader struct{ read bool }

func (r *eioReader) Read(p []byte) (int, error) {
	r.read = true
	n := copy(p, []byte("partial"))
	return n, errInjectedRead
}

func TestDriftFromReaderMapping(t *testing.T) {
	embed := []byte("aaaa")
	cases := []struct {
		name        string
		in          []byte
		wantDrifted bool
	}{
		{"equal", []byte("aaaa"), false},
		{"shorter", []byte("aaa"), true},
		{"longer", []byte("baaaa"), true},
		{"prefix-equal-then-extra", []byte("aaaaX"), true},
		{"same-len-diff", []byte("aaab"), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			drifted, present := driftFromReader(bytes.NewReader(c.in), embed)
			if drifted != c.wantDrifted || !present {
				t.Fatalf("driftFromReader(%q) = (%v,%v), want (%v,true)", c.in, drifted, present, c.wantDrifted)
			}
		})
	}
}

func TestDriftFromReaderReadErrorMapsToUnreadable(t *testing.T) {
	r := &eioReader{}
	drifted, present := driftFromReader(r, []byte("aaaa"))
	if drifted != false || present != true {
		t.Fatalf("read error must map to (false,true); got (%v,%v)", drifted, present)
	}
	if !r.read {
		t.Fatal("the reader must have been read (seam not invoked)")
	}
}

// A non-regular (FIFO) compose is present-but-unreadable: composeDrifted returns
// (false,true) WITHOUT hanging on the open, and maybeWarnComposeDrift then warns iff a
// marker is present.
func TestComposeDriftedFifoIsPresentUnreadable(t *testing.T) {
	varlibReady(t) // fresh varlib: no stale marker
	dir := t.TempDir()
	fifo := filepath.Join(dir, "docker-compose.yml")
	if err := syscall.Mkfifo(fifo, 0o644); err != nil {
		t.Skipf("mkfifo unsupported here: %v", err)
	}
	drifted, present := composeDrifted(dir)
	if drifted != false || present != true {
		t.Fatalf("a FIFO compose must be (false,true); got (%v,%v)", drifted, present)
	}
	// present-but-unreadable precedence (spec §5 rule 3): silent without a marker...
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if out.Len() != 0 {
		t.Fatalf("FIFO compose + no marker must be silent; got %q", out.String())
	}
	// ...but a pending marker still warns.
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	maybeWarnComposeDrift(&out, dir)
	if n := strings.Count(out.String(), driftNote); n != 1 {
		t.Fatalf("FIFO compose + pending marker must warn exactly once; got %d in %q", n, out.String())
	}
}
