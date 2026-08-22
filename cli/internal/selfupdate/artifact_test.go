package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func tgz(t *testing.T, members map[string]tarMember) []byte {
	t.Helper()
	var raw bytes.Buffer
	gz := gzip.NewWriter(&raw)
	tw := tar.NewWriter(gz)
	for name, m := range members {
		hdr := &tar.Header{Name: name, Typeflag: m.typ, Mode: 0o755, Size: int64(len(m.body))}
		if m.typ == tar.TypeSymlink {
			hdr.Linkname = "x"
		}
		tw.WriteHeader(hdr)
		if m.typ == tar.TypeReg {
			tw.Write(m.body)
		}
	}
	tw.Close()
	gz.Close()
	return raw.Bytes()
}

type tarMember struct {
	typ  byte
	body []byte
}

func TestExtractSingleBinary(t *testing.T) {
	ok := tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("ELF...")}})
	if got, err := extractSingleBinary(ok, 1<<20); err != nil || string(got) != "ELF..." {
		t.Fatalf("single binary: got %q err %v", got, err)
	}
	for name, arc := range map[string][]byte{
		"extra member":   tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("a")}, "README": {tar.TypeReg, []byte("b")}}),
		"symlink member": tgz(t, map[string]tarMember{"mathion": {tar.TypeSymlink, nil}}),
		"dir member":     tgz(t, map[string]tarMember{"mathion": {tar.TypeDir, nil}}),
		"wrong name":     tgz(t, map[string]tarMember{"notmathion": {tar.TypeReg, []byte("a")}}),
		"traversal":      tgz(t, map[string]tarMember{"../mathion": {tar.TypeReg, []byte("a")}}),
		"empty":          tgz(t, map[string]tarMember{}),
	} {
		if _, err := extractSingleBinary(arc, 1<<20); err == nil {
			t.Errorf("%s must be rejected", name)
		}
	}
	if _, err := extractSingleBinary(ok, 2); err == nil {
		t.Error("over-size extraction must be rejected")
	}
}

func TestExtractSingleBinary_RejectsSecondMathion(t *testing.T) {
	var raw bytes.Buffer
	gz := gzip.NewWriter(&raw)
	tw := tar.NewWriter(gz)
	for _, body := range []string{"a", "b"} {
		hdr := &tar.Header{Name: "mathion", Typeflag: tar.TypeReg, Mode: 0o755, Size: int64(len(body))}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	tw.Close()
	gz.Close()
	if _, err := extractSingleBinary(raw.Bytes(), 1<<20); err == nil || !strings.Contains(err.Error(), "more than one member") {
		t.Fatalf("two mathion members must be rejected with the >1-member error, got %v", err)
	}
}

func TestSelectRelease_FirstVerifiableDescending(t *testing.T) {
	relEntity, relKR := newSigner(t)
	aptEntity, _ := newSigner(t) // foreign — signs the higher tag, which must be SKIPPED
	asset := archiveName()
	sums := []byte(fmt.Sprintf("deadbeef  %s\n", asset))

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// URLs: /<tag>/checksums.txt[.asc]
		switch r.URL.Path {
		case "/cli-v0.4.0/checksums.txt", "/cli-v0.3.0/checksums.txt":
			w.Write(sums)
		case "/cli-v0.4.0/checksums.txt.asc":
			w.Write(armoredSig(t, aptEntity, sums)) // unverifiable (foreign key)
		case "/cli-v0.3.0/checksums.txt.asc":
			w.Write(armoredSig(t, relEntity, sums)) // verifiable
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	cfg := config{dlBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5),
		perReqTO: time.Second, capChecksums: 1 << 20, capAsc: 1 << 20,
		verifyBudget: 5 * time.Second, topN: 16}

	tag, sha, err := selectRelease(context.Background(), cfg, relKR, []string{"cli-v0.4.0", "cli-v0.3.0"})
	if err != nil || tag != "cli-v0.3.0" || sha != "deadbeef" {
		t.Fatalf("expected to skip unverifiable 0.4.0 and select 0.3.0: tag=%q sha=%q err=%v", tag, sha, err)
	}

	// topN=1 tries only the unverifiable top -> bound hit, no selection.
	cfg.topN = 1
	if _, _, err := selectRelease(context.Background(), cfg, relKR, []string{"cli-v0.4.0", "cli-v0.3.0"}); err == nil {
		t.Fatal("bounded loop with only an unverifiable top candidate must error")
	}
}

func TestDownloadArchive_SHAMismatch(t *testing.T) {
	payload := tgz(t, map[string]tarMember{"mathion": {tar.TypeReg, []byte("bin")}})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	defer srv.Close()
	cfg := config{dlBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5),
		capArchive: 1 << 20, capExtracted: 1 << 20, archiveIdleTO: time.Second, archiveOverallTO: 5 * time.Second}

	good := sha256.Sum256(payload)
	if _, err := downloadArchive(context.Background(), cfg, "cli-v0.3.0", hex.EncodeToString(good[:])); err != nil {
		t.Fatalf("matching sha must succeed: %v", err)
	}
	if _, err := downloadArchive(context.Background(), cfg, "cli-v0.3.0", "00"); err == nil {
		t.Fatal("sha mismatch must abort")
	}
}

// §9.1 "bounded downloads": the archive path (getArchive/readIdleBounded) has its
// own size cap + idle/stall + overall-deadline bounds, separate from getLimited.
// All three abort promptly under tiny injected bounds (empirically verified).
func TestGetArchive_SizeCapAborts(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(make([]byte, 1000))
	}))
	defer srv.Close()
	cfg := config{client: newHTTPClient(srv.Client().Transport, 5), capArchive: 100,
		archiveIdleTO: time.Second, archiveOverallTO: 5 * time.Second}
	if _, err := getArchive(context.Background(), cfg, srv.URL+"/a.tgz"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("over-cap archive must abort with a size error, got %v", err)
	}
}

func TestGetArchive_IdleStallAborts(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte{'x'})
		w.(http.Flusher).Flush()
		<-release // stall indefinitely after the first byte
	}))
	// Defers run LIFO: srv.Close() (registered first) runs LAST, so close(release)
	// (registered last) runs FIRST and unblocks the handler before Close() waits on it.
	// The reverse order deadlocks (httptest.Server.Close waits for the stuck handler).
	defer srv.Close()
	defer close(release)
	cfg := config{client: newHTTPClient(srv.Client().Transport, 5), capArchive: 1 << 20,
		archiveIdleTO: 100 * time.Millisecond, archiveOverallTO: 10 * time.Second}
	start := time.Now()
	if _, err := getArchive(context.Background(), cfg, srv.URL+"/a.tgz"); err == nil {
		t.Fatal("an idle-stalled archive must abort")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("idle abort took %v — the overall deadline fired, not the idle timer", d)
	}
}

func TestGetArchive_OverallDeadlineAborts(t *testing.T) {
	stop := make(chan struct{})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fl := w.(http.Flusher)
		for {
			select {
			case <-stop:
				return
			default:
			}
			w.Write([]byte{'x'})
			fl.Flush()
			time.Sleep(30 * time.Millisecond) // always progressing (< idle) but never EOF
		}
	}))
	// LIFO: srv.Close() runs last; close(stop) runs first to end the handler loop.
	defer srv.Close()
	defer close(stop)
	cfg := config{client: newHTTPClient(srv.Client().Transport, 5), capArchive: 1 << 30,
		archiveIdleTO: 2 * time.Second, archiveOverallTO: 200 * time.Millisecond}
	start := time.Now()
	if _, err := getArchive(context.Background(), cfg, srv.URL+"/a.tgz"); err == nil {
		t.Fatal("a slow-drip archive must hit the overall deadline")
	}
	if d := time.Since(start); d > 1*time.Second {
		t.Fatalf("overall abort took too long (idle timer may have fired instead): %v", d)
	}
}

// §9.1: the idle timer must RESET on each progress chunk, so a healthy stream that
// always makes progress within idleTO (but takes longer than idleTO overall) completes
// successfully. Locks artifact.go's timer.Reset(idleTO): delete that reset and the
// once-armed idle timer fires mid-stream and kills this healthy download.
func TestGetArchive_IdleResetAllowsHealthySlowStream(t *testing.T) {
	const drips = 8
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fl := w.(http.Flusher)
		for i := 0; i < drips; i++ {
			w.Write([]byte{'x'})
			fl.Flush()
			time.Sleep(40 * time.Millisecond) // 40ms << 200ms idle: a working reset keeps the idle timer from firing
		}
		// handler returns -> EOF
	}))
	defer srv.Close()
	cfg := config{client: newHTTPClient(srv.Client().Transport, 5), capArchive: 1 << 20,
		archiveIdleTO: 200 * time.Millisecond, archiveOverallTO: 10 * time.Second}
	got, err := getArchive(context.Background(), cfg, srv.URL+"/a.tgz")
	if err != nil {
		t.Fatalf("a healthy stream progressing within the idle window must succeed (idle reset broken?): %v", err)
	}
	if len(got) != drips {
		t.Fatalf("expected %d bytes, got %d", drips, len(got))
	}
}

// §9.1: the injected (small) verify-loop wall-clock budget aborts a slow origin.
func TestSelectRelease_BudgetAborts(t *testing.T) {
	relEntity, relKR := newSigner(t)
	sums := []byte("deadbeef  " + archiveName() + "\n")
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		if strings.HasSuffix(r.URL.Path, ".asc") {
			w.Write(armoredSig(t, relEntity, sums))
			return
		}
		w.Write(sums)
	}))
	defer srv.Close()
	cfg := config{dlBase: srv.URL, client: newHTTPClient(srv.Client().Transport, 5), perReqTO: 5 * time.Second,
		capChecksums: 1 << 20, capAsc: 1 << 20, verifyBudget: 100 * time.Millisecond, topN: 16}
	if _, _, err := selectRelease(context.Background(), cfg, relKR, []string{"cli-v0.9.0", "cli-v0.8.0", "cli-v0.7.0"}); err == nil {
		t.Fatal("a slow origin must exhaust the verify budget")
	}
}

// §9.1 crossing-invariant boundary: candidate 16 (index 15) is reached, candidate
// 17 (index 16) is not, at topN=16. Only `verifiableTag` carries a real signature.
func TestSelectRelease_CrossingBoundary(t *testing.T) {
	relEntity, relKR := newSigner(t)
	aptEntity, _ := newSigner(t)
	sums := []byte(fmt.Sprintf("deadbeef  %s\n", archiveName()))
	newServer := func(verifiableTag string) *httptest.Server {
		return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case strings.HasSuffix(r.URL.Path, "/checksums.txt"):
				w.Write(sums)
			case strings.HasSuffix(r.URL.Path, "/checksums.txt.asc"):
				if strings.Contains(r.URL.Path, verifiableTag+"/") {
					w.Write(armoredSig(t, relEntity, sums))
				} else {
					w.Write(armoredSig(t, aptEntity, sums)) // unverifiable
				}
			default:
				w.WriteHeader(404)
			}
		}))
	}
	var tags []string
	for i := 20; i >= 1; i-- {
		tags = append(tags, fmt.Sprintf("cli-v0.%d.0", i))
	}
	at16, at17 := tags[15], tags[16]

	s16 := newServer(at16)
	defer s16.Close()
	cfg := config{dlBase: s16.URL, client: newHTTPClient(s16.Client().Transport, 5), perReqTO: 2 * time.Second,
		capChecksums: 1 << 20, capAsc: 1 << 20, verifyBudget: 10 * time.Second, topN: 16}
	if tag, _, err := selectRelease(context.Background(), cfg, relKR, tags); err != nil || tag != at16 {
		t.Fatalf("candidate 16 must be reached: tag=%q err=%v", tag, err)
	}

	s17 := newServer(at17)
	defer s17.Close()
	cfg.dlBase, cfg.client = s17.URL, newHTTPClient(s17.Client().Transport, 5)
	if tag, _, err := selectRelease(context.Background(), cfg, relKR, tags); err == nil {
		t.Fatalf("candidate 17 must NOT be reached at topN=16, but selected %q", tag)
	}
}
