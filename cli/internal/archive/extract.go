package archive

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/config"
)

// Cap trust tiers -----------------------------------------------------------
//
// A backup archive is an UNTRUSTED input until restore has verified it. Its
// declared sizes are attacker-controlled, so the extractor refuses to read or
// write more than a cap. Which cap applies depends on WHERE the archive came
// from: an archive the root operator dropped into the root-owned backups dir is
// "managed" and gets a generous cap; anything else is "untrusted" and gets a
// deliberately tight one.

const (
	ManagedDefaultMember int64 = 50 << 30  // 50 GiB
	ManagedDefaultTotal  int64 = 120 << 30 // 120 GiB

	capFloor int64 = 1 << 30 // 1 GiB   — smallest permitted managed cap
	capCeil  int64 = 1 << 40 // 1 TiB   — largest permitted managed cap
)

// Caps bounds a single restore extraction. MaxMember caps any one archive
// member's declared/extracted size; MaxTotal caps the cumulative decompressed
// bytes drawn from the gzip stream (headers, bodies, padding and skips).
type Caps struct {
	MaxMember, MaxTotal int64
}

// UntrustedCaps is the FIXED, non-overridable tier for an archive from outside
// the managed backups dir. Deliberately small so a hostile archive dropped in
// /tmp can never make restore chew through host disk or memory.
func UntrustedCaps() Caps {
	return Caps{MaxMember: 2 << 30, MaxTotal: 5 << 30} // 2 GiB / 5 GiB
}

// ManagedCaps returns the managed tier, starting from the generous defaults and
// applying the MATHION_RESTORE_MAX_MEMBER_BYTES / _TOTAL_BYTES env overrides.
//
// An override is plain decimal bytes, or a decimal count with a trailing G/M
// suffix meaning GiB/MiB. Every RESULTING cap must land in [1 GiB, 1 TiB]. A
// value that is unparseable OR out of range is a HARD error — never a silent
// fallback to the default, because a misconfigured cap must fail loudly rather
// than quietly widen (or narrow) the DoS envelope. An unset var keeps the
// default.
func ManagedCaps(env func(string) string) (Caps, error) {
	c := Caps{MaxMember: ManagedDefaultMember, MaxTotal: ManagedDefaultTotal}

	if v := env("MATHION_RESTORE_MAX_MEMBER_BYTES"); v != "" {
		n, err := parseCapBytes(v)
		if err != nil {
			return Caps{}, fmt.Errorf("MATHION_RESTORE_MAX_MEMBER_BYTES=%q: %w", v, err)
		}
		c.MaxMember = n
	}
	if v := env("MATHION_RESTORE_MAX_TOTAL_BYTES"); v != "" {
		n, err := parseCapBytes(v)
		if err != nil {
			return Caps{}, fmt.Errorf("MATHION_RESTORE_MAX_TOTAL_BYTES=%q: %w", v, err)
		}
		c.MaxTotal = n
	}

	if err := validateCap("MATHION_RESTORE_MAX_MEMBER_BYTES", c.MaxMember); err != nil {
		return Caps{}, err
	}
	if err := validateCap("MATHION_RESTORE_MAX_TOTAL_BYTES", c.MaxTotal); err != nil {
		return Caps{}, err
	}
	return c, nil
}

func validateCap(name string, v int64) error {
	if v < capFloor || v > capCeil {
		return fmt.Errorf("%s out of range [1 GiB, 1 TiB]: %d bytes", name, v)
	}
	return nil
}

// parseCapBytes parses "<digits>" or "<digits>G" / "<digits>M" (case-insensitive
// suffix, GiB/MiB) into a byte count. The numeric part must be decimal digits
// ONLY — a leading sign, hex, underscores or spaces are rejected — so garbage
// fails loudly rather than being silently coerced.
func parseCapBytes(s string) (int64, error) {
	digits := s
	mult := int64(1)
	if len(s) > 0 {
		switch s[len(s)-1] {
		case 'G', 'g':
			mult = 1 << 30
			digits = s[:len(s)-1]
		case 'M', 'm':
			mult = 1 << 20
			digits = s[:len(s)-1]
		}
	}
	if !allDigits(digits) {
		return 0, fmt.Errorf("not a byte count (decimal digits, optional G/M suffix)")
	}
	n, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return 0, err // overflow of an all-digit string
	}
	prod := n * mult
	if prod/mult != n { // multiply overflow
		return 0, fmt.Errorf("byte count overflows int64")
	}
	return prod, nil
}

func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// TierFor chooses the cap tier for archivePath purely LEXICALLY: an archive
// resolving under backupsDir gets the managed DEFAULTS (not the env-override
// caps — the restore flow calls ManagedCaps(os.Getenv) itself when it wants
// those); anything else gets UntrustedCaps.
//
// "Under" is computed with filepath.Rel on the cleaned paths, so a mere shared
// string prefix (backups vs backups-evil) does NOT count as under. No symlink
// resolution is done: backupsDir is a root-owned 0700 dir, and the tier is the
// root operator's own trust choice, so a lexical decision is sufficient and
// avoids a resolve-time TOCTOU.
func TierFor(archivePath, backupsDir string) Caps {
	rel, err := filepath.Rel(filepath.Clean(backupsDir), filepath.Clean(archivePath))
	if err != nil ||
		rel == "." ||
		rel == ".." ||
		strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return UntrustedCaps()
	}
	return Caps{MaxMember: ManagedDefaultMember, MaxTotal: ManagedDefaultTotal}
}

// Extract -------------------------------------------------------------------

// allowedMembers is the CLOSED allowlist of members restore will EVER unpack,
// matched by EXACT basename.
//
// SECURITY: this is an ALLOWLIST and MUST NEVER be loosened into a blocklist
// (e.g. "reject names containing ..") — a blocklist silently ACCEPTS every
// member an attacker can name that we forgot to enumerate (path traversal,
// symlink/hardlink, device node, a surprise executable, a second manifest),
// which is exactly the class of attack this extractor exists to stop. Extract
// aborts on the FIRST member not in this set.
var allowedMembers = map[string]bool{
	"manifest.json": true,
	"db.dump":       true,
	"assets.tar":    true,
}

// maxEntries is a defence-in-depth backstop on the header-iteration count. The
// abort-on-first-offending-entry logic already bounds a well-formed hostile
// archive to a handful of headers; this stops a pathological stream of empty,
// otherwise-allowed headers from spinning tar.Next forever.
const maxEntries = 16

// maxManifestBytes caps manifest.json specifically. A real manifest is a few
// hundred bytes; this only stops a hostile giant (a multi-MiB created_at, or
// millions of sha256 map entries) from making encoding/json allocate gigabytes
// and OOM-kill the root-privileged restore process. The payload cap
// (caps.MaxMember, up to 1 TiB) is far too loose to protect the JSON decoder.
const maxManifestBytes int64 = 1 << 20 // 1 MiB

// Extract is the DoS-safe ALLOWLIST extractor and the trust boundary that makes
// an untrusted backup archive safe to unpack on the host. It writes the three
// allowlisted members into stagingDir (which the caller treats as DISPOSABLE and
// discards on any error), then validates the manifest, and returns it.
//
// Defences, in order:
//   - io.LimitReader(gzr, caps.MaxTotal+1) wraps the gzip reader BEFORE tar, so
//     headers, bodies, padding AND tar.Next skips are all bounded — a gzip bomb
//     cannot amplify. Reading the (MaxTotal+1)'th byte hard-aborts the copy.
//   - Every member name must EXACTLY equal one of the three allowlisted
//     basenames; this single check rejects a path separator, "..", an absolute
//     path and any extra/unexpected member at once.
//   - Only tar.TypeReg/TypeRegA are accepted (no symlink/hardlink/dir/device/FIFO).
//   - h.Size must be in [0, caps.MaxMember], checked BEFORE the body is copied.
//   - Members are written through an os.Root bound to stagingDir with O_EXCL, so
//     a crafted name cannot escape staging and a duplicate cannot overwrite.
//   - After extraction (and before any real host mutation by the caller): the
//     manifest schema must be 1, mathion_version a valid OCI tag, and each
//     payload member's sha256 must be PRESENT in the manifest and match the
//     extracted bytes.
func Extract(stagingDir, archivePath string, caps Caps) (Manifest, error) {
	var zero Manifest

	f, err := os.Open(archivePath)
	if err != nil {
		return zero, err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return zero, fmt.Errorf("restore: open gzip: %w", err)
	}
	defer gzr.Close()

	// Bound the ENTIRE decompressed stream before tar ever sees it. The +1 makes
	// reading exactly MaxTotal bytes fine and the next byte a hard abort.
	lr := io.LimitReader(gzr, caps.MaxTotal+1)
	tr := tar.NewReader(lr)

	root, err := os.OpenRoot(stagingDir)
	if err != nil {
		return zero, err
	}
	defer root.Close()

	seen := map[string]bool{}
	entries := 0
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return zero, fmt.Errorf("restore: read archive: %w", err)
		}
		entries++
		if entries > maxEntries {
			return zero, fmt.Errorf("restore: too many archive entries (>%d)", maxEntries)
		}

		name := h.Name
		if !allowedMembers[name] {
			return zero, fmt.Errorf("restore: unexpected archive member %q (allowlist: manifest.json, db.dump, assets.tar)", name)
		}
		if seen[name] {
			return zero, fmt.Errorf("restore: duplicate archive member %q", name)
		}
		if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA {
			return zero, fmt.Errorf("restore: archive member %q is not a regular file (typeflag %d)", name, h.Typeflag)
		}
		sizeCap := caps.MaxMember
		if name == "manifest.json" {
			// manifest.json is decoded in-process by encoding/json, so it gets a
			// tiny dedicated cap rather than the (huge) payload cap.
			sizeCap = maxManifestBytes
		}
		if h.Size < 0 || h.Size > sizeCap {
			return zero, fmt.Errorf("restore: archive member %q size %d exceeds cap %d", name, h.Size, sizeCap)
		}
		if err := writeMember(root, name, tr); err != nil {
			return zero, err
		}
		seen[name] = true
	}

	for name := range allowedMembers {
		if !seen[name] {
			return zero, fmt.Errorf("restore: archive missing required member %q", name)
		}
	}

	// Post-extract validation. Extract has only written disposable staging, so
	// every check below still happens BEFORE the caller mutates the live host.
	m, err := readStagedManifest(root)
	if err != nil {
		return zero, err
	}
	if m.Schema != 1 {
		return zero, fmt.Errorf("restore: unsupported manifest schema %d (want 1)", m.Schema)
	}
	if err := config.ValidateOCITag(m.MathionVersion); err != nil {
		return zero, fmt.Errorf("restore: invalid mathion_version: %w", err)
	}
	for _, name := range []string{"db.dump", "assets.tar"} {
		want := m.SHA256[name]
		if want == "" {
			// A missing/empty hash is a HARD fail — never skipped — or an
			// attacker could omit a hash to disable integrity checking.
			return zero, fmt.Errorf("restore: manifest is missing the sha256 for %q", name)
		}
		got, err := hashStaged(root, name)
		if err != nil {
			return zero, err
		}
		if got != want {
			return zero, fmt.Errorf("restore: sha256 mismatch for %q (manifest %s, extracted %s)", name, want, got)
		}
	}
	return m, nil
}

// writeMember copies one member body into the staging root. O_EXCL both keeps
// the write confined (os.Root refuses a name that escapes the root) and doubles
// as a duplicate-name defence.
func writeMember(root *os.Root, name string, r io.Reader) error {
	w, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("restore: create %q in staging: %w", name, err)
	}
	if _, err := io.Copy(w, r); err != nil {
		_ = w.Close()
		return fmt.Errorf("restore: write %q: %w", name, err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("restore: close %q: %w", name, err)
	}
	return nil
}

func readStagedManifest(root *os.Root) (Manifest, error) {
	var m Manifest
	f, err := root.Open("manifest.json")
	if err != nil {
		return m, fmt.Errorf("restore: open manifest.json: %w", err)
	}
	defer f.Close()
	// Belt-and-suspenders: the extraction size cap already bounds the written
	// file to <= maxManifestBytes, so this LimitReader never truncates a real
	// manifest — it only re-asserts the ceiling for the in-process JSON decode.
	if err := json.NewDecoder(io.LimitReader(f, maxManifestBytes)).Decode(&m); err != nil {
		return m, fmt.Errorf("restore: parse manifest.json: %w", err)
	}
	return m, nil
}

func hashStaged(root *os.Root, name string) (string, error) {
	f, err := root.Open(name)
	if err != nil {
		return "", fmt.Errorf("restore: reopen %q: %w", name, err)
	}
	defer f.Close()
	return SHA256Of(f)
}

// PrescanAssets walks the inner assets.tar (a PLAIN, non-gzip tar produced by
// `tar -C /data/mathion/assets -cf - .`) and rejects any member that would be
// unsafe to later unpack onto the host.
//
// Unlike the outer archive, assets.tar members LEGITIMATELY carry subdirectory
// paths, so path separators are allowed. What is NOT allowed: any type other
// than a regular file or a plain directory (this stops a planted
// "report.pdf -> /etc/passwd" symlink or a hardlink/device/FIFO), an absolute
// path, or any ".." path element. The first violation is returned as an error.
func PrescanAssets(assetsTarPath string) error {
	f, err := os.Open(assetsTarPath)
	if err != nil {
		return err
	}
	defer f.Close()

	tr := tar.NewReader(f)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("restore: read assets.tar: %w", err)
		}
		switch h.Typeflag {
		case tar.TypeReg, tar.TypeRegA, tar.TypeDir:
			// regular file or plain directory — allowed
		default:
			return fmt.Errorf("restore: assets.tar member %q has a disallowed type (typeflag %d)", h.Name, h.Typeflag)
		}
		if filepath.IsAbs(h.Name) {
			return fmt.Errorf("restore: assets.tar member %q is an absolute path", h.Name)
		}
		// tar always uses "/" as the separator; splitting on it catches a "..";
		// leading ("../x"), interior ("a/../b") or trailing ("a/..") element.
		for _, part := range strings.Split(h.Name, "/") {
			if part == ".." {
				return fmt.Errorf("restore: assets.tar member %q contains a %q path element", h.Name, "..")
			}
		}
	}
	return nil
}
