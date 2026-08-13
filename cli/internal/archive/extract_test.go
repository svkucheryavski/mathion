package archive_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/svkucheryavski/mathion/cli/internal/archive"
)

// ---- in-memory archive builders -------------------------------------------

// tentry is one tar member. Size is derived from content for regular members.
type tentry struct {
	name     string
	typeflag byte
	content  string
	linkname string
}

func writeEntries(tw *tar.Writer, entries []tentry) {
	for _, e := range entries {
		hdr := &tar.Header{
			Name:     e.name,
			Mode:     0o600,
			Typeflag: e.typeflag,
			ModTime:  time.Unix(0, 0),
			Linkname: e.linkname,
		}
		if e.typeflag == tar.TypeReg || e.typeflag == tar.TypeRegA {
			hdr.Size = int64(len(e.content))
		}
		if err := tw.WriteHeader(hdr); err != nil {
			panic(err)
		}
		if e.typeflag == tar.TypeReg || e.typeflag == tar.TypeRegA {
			if _, err := io.WriteString(tw, e.content); err != nil {
				panic(err)
			}
		}
	}
}

// buildTar builds a PLAIN (uncompressed) tar — used for PrescanAssets, which
// scans the inner assets.tar.
func buildTar(entries []tentry) []byte {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	writeEntries(tw, entries)
	if err := tw.Close(); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

// buildTarGz builds a gzip-tar — the outer backup archive shape Extract consumes.
func buildTarGz(entries []tentry) []byte {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	writeEntries(tw, entries)
	if err := tw.Close(); err != nil {
		panic(err)
	}
	if err := gz.Close(); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

// archiveWith returns a builder for a single-member gzip-tar with the given
// name/type — enough to trip Extract's first-offending-entry abort.
func archiveWith(name string, typeflag byte) func() []byte {
	return func() []byte {
		e := tentry{name: name, typeflag: typeflag}
		switch typeflag {
		case tar.TypeSymlink, tar.TypeLink:
			e.linkname = "target"
		case tar.TypeReg, tar.TypeRegA:
			e.content = "x"
		}
		return buildTarGz([]tentry{e})
	}
}

// archiveWithExtra returns a builder for an OTHERWISE-VALID-looking archive that
// also carries one unexpected member — the allowlist must reject it.
func archiveWithExtra(extra string) func() []byte {
	return func() []byte {
		return buildTarGz([]tentry{
			{name: "manifest.json", typeflag: tar.TypeReg, content: "{}"},
			{name: "db.dump", typeflag: tar.TypeReg, content: "x"},
			{name: "assets.tar", typeflag: tar.TypeReg, content: "x"},
			{name: extra, typeflag: tar.TypeReg, content: "x"},
		})
	}
}

// archiveDuplicate returns a builder that lists the same member name twice.
func archiveDuplicate(name string) func() []byte {
	return func() []byte {
		return buildTarGz([]tentry{
			{name: "manifest.json", typeflag: tar.TypeReg, content: "{}"},
			{name: name, typeflag: tar.TypeReg, content: "x"},
			{name: name, typeflag: tar.TypeReg, content: "y"},
		})
	}
}

func sha256hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// buildArchive marshals m into manifest.json and packs it with db.dump/assets.tar.
func buildArchive(t *testing.T, m archive.Manifest, dbContent, assetsContent string) []byte {
	t.Helper()
	mb, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return buildTarGz([]tentry{
		{name: "manifest.json", typeflag: tar.TypeReg, content: string(mb)},
		{name: "db.dump", typeflag: tar.TypeReg, content: dbContent},
		{name: "assets.tar", typeflag: tar.TypeReg, content: assetsContent},
	})
}

func writeArchiveFile(t *testing.T, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "a.tar.gz")
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// ---- Extract: hostile-member rejection table ------------------------------

func TestExtractRejectsHostileMembers(t *testing.T) {
	caps := archive.Caps{MaxMember: 1 << 20, MaxTotal: 4 << 20}
	for _, tc := range []struct {
		name  string
		build func() []byte
	}{
		{"traversal", archiveWith("../evil", tar.TypeReg)},
		{"absolute", archiveWith("/etc/passwd", tar.TypeReg)},
		{"symlink", archiveWith("db.dump", tar.TypeSymlink)},
		{"hardlink", archiveWith("db.dump", tar.TypeLink)},
		{"dir-named-member", archiveWith("db.dump", tar.TypeDir)},
		{"extra-member", archiveWithExtra("surprise.sh")},
		{"duplicate", archiveDuplicate("db.dump")},
	} {
		dir := t.TempDir()
		if err := os.WriteFile(dir+"/a.tar.gz", tc.build(), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := archive.Extract(t.TempDir(), dir+"/a.tar.gz", caps); err == nil {
			t.Errorf("%s: expected rejection", tc.name)
		}
	}
}

// ---- Extract: gzip-bomb hard abort ----------------------------------------

func TestExtractGzipBombHardAborts(t *testing.T) {
	// (A) a member whose DECLARED Size exceeds MaxMember is rejected BEFORE its
	// body is copied (no need to read the bomb at all).
	capsA := archive.Caps{MaxMember: 1024, MaxTotal: 1 << 20}
	dataA := buildTarGz([]tentry{
		{name: "manifest.json", typeflag: tar.TypeReg, content: "{}"},
		{name: "db.dump", typeflag: tar.TypeReg, content: strings.Repeat("A", 4096)},
		{name: "assets.tar", typeflag: tar.TypeReg, content: "x"},
	})
	// (B) cumulative decompressed bytes over MaxTotal trip the io.LimitReader
	// wrapping the gzip stream, aborting mid-stream even though each member's
	// declared Size is under MaxMember.
	capsB := archive.Caps{MaxMember: 1 << 20, MaxTotal: 1024}
	dataB := buildTarGz([]tentry{
		{name: "manifest.json", typeflag: tar.TypeReg, content: "{}"},
		{name: "db.dump", typeflag: tar.TypeReg, content: strings.Repeat("A", 8192)},
		{name: "assets.tar", typeflag: tar.TypeReg, content: "x"},
	})
	for _, tc := range []struct {
		name string
		data []byte
		caps archive.Caps
	}{
		{"over-cap-member-size", dataA, capsA},
		{"total-over-limit", dataB, capsB},
	} {
		p := writeArchiveFile(t, tc.data)
		if _, err := archive.Extract(t.TempDir(), p, tc.caps); err == nil {
			t.Errorf("%s: expected hard abort", tc.name)
		}
	}
}

// ---- Extract: manifest sha256 must be present AND match --------------------

func TestExtractMissingShaHardFails(t *testing.T) {
	caps := archive.Caps{MaxMember: 1 << 20, MaxTotal: 4 << 20}
	db, assets := "DBDUMP", "ASSETS"
	for _, tc := range []struct {
		name string
		sha  map[string]string
	}{
		{"missing-db-hash", map[string]string{"assets.tar": sha256hex(assets)}},
		{"empty-db-hash", map[string]string{"db.dump": "", "assets.tar": sha256hex(assets)}},
		{"mismatched-db-hash", map[string]string{"db.dump": sha256hex("WRONG"), "assets.tar": sha256hex(assets)}},
		{"missing-assets-hash", map[string]string{"db.dump": sha256hex(db)}},
	} {
		m := archive.Manifest{Schema: 1, MathionVersion: "v9.9.9", SHA256: tc.sha}
		p := writeArchiveFile(t, buildArchive(t, m, db, assets))
		if _, err := archive.Extract(t.TempDir(), p, caps); err == nil {
			t.Errorf("%s: expected hard fail", tc.name)
		}
	}
}

// ---- Extract: post-extract manifest validation -----------------------------

func TestExtractRejectsBadManifest(t *testing.T) {
	caps := archive.Caps{MaxMember: 1 << 20, MaxTotal: 4 << 20}
	db, assets := "DBDUMP", "ASSETS"
	good := map[string]string{"db.dump": sha256hex(db), "assets.tar": sha256hex(assets)}
	for _, tc := range []struct {
		name string
		m    archive.Manifest
	}{
		{"schema-0", archive.Manifest{Schema: 0, MathionVersion: "v1.0.0", SHA256: good}},
		{"schema-2", archive.Manifest{Schema: 2, MathionVersion: "v1.0.0", SHA256: good}},
		{"bad-version", archive.Manifest{Schema: 1, MathionVersion: "../nope", SHA256: good}},
		{"empty-version", archive.Manifest{Schema: 1, MathionVersion: "", SHA256: good}},
	} {
		p := writeArchiveFile(t, buildArchive(t, tc.m, db, assets))
		if _, err := archive.Extract(t.TempDir(), p, caps); err == nil {
			t.Errorf("%s: expected rejection", tc.name)
		}
	}
}

// ---- Extract: manifest.json is size-bounded (OOM defense) ------------------

func TestExtractRejectsOversizedManifest(t *testing.T) {
	// MaxMember (4 MiB) is deliberately LARGER than the manifest body, so only
	// the dedicated 1 MiB manifest cap can reject it — proving that cap is what
	// fires, not the general payload cap. The oversized body is caught at the
	// header size check, before any large read (no OOM).
	caps := archive.Caps{MaxMember: 4 << 20, MaxTotal: 16 << 20}
	db, assets := "DBDUMP", "ASSETS"
	m := archive.Manifest{
		Schema:         1,
		MathionVersion: "v9.9.9",
		CreatedAt:      strings.Repeat("A", 2<<20), // 2 MiB → manifest.json body > 1 MiB
		SHA256:         map[string]string{"db.dump": sha256hex(db), "assets.tar": sha256hex(assets)},
	}
	p := writeArchiveFile(t, buildArchive(t, m, db, assets))
	if _, err := archive.Extract(t.TempDir(), p, caps); err == nil {
		t.Fatal("expected rejection of oversized manifest.json")
	}
}

// ---- Extract: happy path ---------------------------------------------------

func TestExtractHappyPath(t *testing.T) {
	caps := archive.Caps{MaxMember: 1 << 20, MaxTotal: 4 << 20}
	db, assets := "DBDUMP-CONTENT", "ASSETS-CONTENT"
	m := archive.Manifest{
		Schema:         1,
		MathionVersion: "v9.9.9",
		SHA256:         map[string]string{"db.dump": sha256hex(db), "assets.tar": sha256hex(assets)},
	}
	p := writeArchiveFile(t, buildArchive(t, m, db, assets))
	staging := t.TempDir()
	got, err := archive.Extract(staging, p, caps)
	if err != nil {
		t.Fatal(err)
	}
	if got.Schema != 1 || got.MathionVersion != "v9.9.9" {
		t.Fatalf("manifest = %+v", got)
	}
	if got.SHA256["db.dump"] != sha256hex(db) {
		t.Fatalf("returned manifest lost hashes: %+v", got)
	}
	// Every member is present in the staging dir with the exact content.
	for name, want := range map[string]string{"db.dump": db, "assets.tar": assets} {
		b, err := os.ReadFile(filepath.Join(staging, name))
		if err != nil {
			t.Fatalf("missing extracted %s: %v", name, err)
		}
		if string(b) != want {
			t.Fatalf("%s content = %q, want %q", name, b, want)
		}
	}
	if _, err := os.Stat(filepath.Join(staging, "manifest.json")); err != nil {
		t.Fatalf("manifest.json not extracted: %v", err)
	}
}

// ---- PrescanAssets ---------------------------------------------------------

func TestPrescanAssetsRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.tar")
	if err := os.WriteFile(bad, buildTar([]tentry{
		{name: "report.pdf", typeflag: tar.TypeSymlink, linkname: "/etc/passwd"},
	}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := archive.PrescanAssets(bad); err == nil {
		t.Fatal("expected rejection of planted symlink member")
	}

	// A clean tar with a nested directory + regular files is accepted — inner
	// subdirectory paths are LEGITIMATE for assets.tar and must not be rejected.
	good := filepath.Join(dir, "good.tar")
	if err := os.WriteFile(good, buildTar([]tentry{
		{name: "sub/", typeflag: tar.TypeDir},
		{name: "sub/report.pdf", typeflag: tar.TypeReg, content: "PDF"},
		{name: "top.txt", typeflag: tar.TypeReg, content: "hello"},
	}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := archive.PrescanAssets(good); err != nil {
		t.Fatalf("clean nested-dir tar rejected: %v", err)
	}
}

func TestPrescanAssetsRejectsBadPaths(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name    string
		entries []tentry
	}{
		{"hardlink", []tentry{{name: "report.pdf", typeflag: tar.TypeLink, linkname: "top.txt"}}},
		{"absolute", []tentry{{name: "/etc/passwd", typeflag: tar.TypeReg, content: "x"}}},
		{"dotdot-middle", []tentry{{name: "sub/../../etc/passwd", typeflag: tar.TypeReg, content: "x"}}},
		{"dotdot-leading", []tentry{{name: "../evil", typeflag: tar.TypeReg, content: "x"}}},
		{"dotdot-trailing", []tentry{{name: "sub/..", typeflag: tar.TypeDir}}},
	} {
		p := filepath.Join(dir, tc.name+".tar")
		if err := os.WriteFile(p, buildTar(tc.entries), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := archive.PrescanAssets(p); err == nil {
			t.Errorf("%s: expected rejection", tc.name)
		}
	}
}

// ---- Cap tiers -------------------------------------------------------------

func TestCapTierSplit(t *testing.T) {
	if archive.TierFor("/var/lib/mathion/backups/x.tar.gz", "/var/lib/mathion/backups").MaxTotal != archive.ManagedDefaultTotal {
		t.Fatal("under backups should be managed")
	}
	if archive.TierFor("/tmp/x.tar.gz", "/var/lib/mathion/backups") != archive.UntrustedCaps() {
		t.Fatal("outside should be untrusted")
	}
	// Managed tier carries BOTH managed defaults (TierFor never applies env overrides).
	if got := archive.TierFor("/var/lib/mathion/backups/sub/x.tar.gz", "/var/lib/mathion/backups"); got.MaxMember != archive.ManagedDefaultMember || got.MaxTotal != archive.ManagedDefaultTotal {
		t.Fatalf("nested-under-backups should be managed defaults: %+v", got)
	}
	// A sibling directory that merely shares a string prefix is NOT under backups.
	if got := archive.TierFor("/var/lib/mathion/backups-evil/x.tar.gz", "/var/lib/mathion/backups"); got != archive.UntrustedCaps() {
		t.Fatalf("sibling prefix must be untrusted, got %+v", got)
	}
	// The backups dir itself (rel == ".") is not "under" it → untrusted.
	if got := archive.TierFor("/var/lib/mathion/backups", "/var/lib/mathion/backups"); got != archive.UntrustedCaps() {
		t.Fatalf("backups dir itself must be untrusted, got %+v", got)
	}
}

func TestUntrustedCapsFixed(t *testing.T) {
	c := archive.UntrustedCaps()
	if c.MaxMember != 2<<30 || c.MaxTotal != 5<<30 {
		t.Fatalf("UntrustedCaps = %+v, want 2 GiB / 5 GiB", c)
	}
}

// ---- ManagedCaps env overrides --------------------------------------------

func envFn(member, total string) func(string) string {
	return func(k string) string {
		switch k {
		case "MATHION_RESTORE_MAX_MEMBER_BYTES":
			return member
		case "MATHION_RESTORE_MAX_TOTAL_BYTES":
			return total
		}
		return ""
	}
}

func TestManagedCapsOverride(t *testing.T) {
	// Unset → managed defaults.
	c, err := archive.ManagedCaps(envFn("", ""))
	if err != nil {
		t.Fatal(err)
	}
	if c.MaxMember != archive.ManagedDefaultMember || c.MaxTotal != archive.ManagedDefaultTotal {
		t.Fatalf("unset should give defaults: %+v", c)
	}

	// Valid overrides: G suffix, M suffix, and plain bytes — all in [1 GiB, 1 TiB].
	for _, tc := range []struct {
		member, total    string
		wantMem, wantTot int64
	}{
		{"2G", "5G", 2 << 30, 5 << 30},
		{"1024M", "2048M", 1 << 30, 2 << 30},
		{"1073741824", "2147483648", 1 << 30, 2 << 30}, // plain bytes = 1 GiB / 2 GiB
		{"1024G", "1024G", 1 << 40, 1 << 40},           // 1024 GiB = 1 TiB, exactly the ceiling
	} {
		c, err := archive.ManagedCaps(envFn(tc.member, tc.total))
		if err != nil {
			t.Fatalf("ManagedCaps(%q,%q) unexpected err: %v", tc.member, tc.total, err)
		}
		if c.MaxMember != tc.wantMem || c.MaxTotal != tc.wantTot {
			t.Fatalf("ManagedCaps(%q,%q) = %+v, want %d/%d", tc.member, tc.total, c, tc.wantMem, tc.wantTot)
		}
	}

	// Only one var set → the other stays at its managed default.
	c, err = archive.ManagedCaps(envFn("2G", ""))
	if err != nil {
		t.Fatal(err)
	}
	if c.MaxMember != 2<<30 || c.MaxTotal != archive.ManagedDefaultTotal {
		t.Fatalf("member-only override = %+v", c)
	}

	// Out-of-range and unparseable values are HARD errors, never silent fallback.
	for _, tc := range []struct{ member, total string }{
		{"512M", "5G"},   // below 1 GiB floor
		{"2G", "2000G"},  // above 1 TiB ceiling
		{"0", "5G"},      // zero < floor
		{"banana", "5G"}, // not a number
		{"2GB", "5G"},    // trailing "B" not a recognized suffix
		{"1T", "5G"},     // "T" is not a recognized suffix (only G/M)
		{"-1", "5G"},     // sign not decimal-digits-only
		{"+5G", "5G"},    // sign not decimal-digits-only
		{"2 G", "5G"},    // embedded space
		{"G", "5G"},      // suffix with no digits
	} {
		if _, err := archive.ManagedCaps(envFn(tc.member, tc.total)); err == nil {
			t.Errorf("ManagedCaps(%q,%q): expected hard error", tc.member, tc.total)
		}
	}
}
