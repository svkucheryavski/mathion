package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"runtime"
	"time"

	"github.com/ProtonMail/go-crypto/openpgp"
)

func archiveName() string { return fmt.Sprintf("mathion_linux_%s.tar.gz", runtime.GOARCH) }
func checksumsURL(cfg config, tag string) string {
	return fmt.Sprintf("%s/%s/checksums.txt", cfg.dlBase, tag)
}
func archiveURL(cfg config, tag string) string {
	return fmt.Sprintf("%s/%s/%s", cfg.dlBase, tag, archiveName())
}

// selectRelease iterates tags DESCENDING, bounded to cfg.topN candidates and
// cfg.verifyBudget wall-clock, returning the first tag whose checksums verify
// against keyring plus the expected archive sha256. Checksums only — no archive.
// §4.2 step 5, §6.2.
func selectRelease(ctx context.Context, cfg config, keyring openpgp.EntityList, tags []string) (string, string, error) {
	loopCtx, cancel := context.WithTimeout(ctx, cfg.verifyBudget)
	defer cancel()
	asset := archiveName()
	limit := cfg.topN
	if len(tags) < limit {
		limit = len(tags)
	}
	for i := 0; i < limit; i++ {
		if loopCtx.Err() != nil {
			return "", "", errors.New("no verifiable newer release within the time budget")
		}
		tag := tags[i]
		sums, _, err := getLimited(loopCtx, cfg.client, checksumsURL(cfg, tag), cfg.capChecksums, cfg.perReqTO)
		if err != nil {
			continue
		}
		asc, _, err := getLimited(loopCtx, cfg.client, checksumsURL(cfg, tag)+".asc", cfg.capAsc, cfg.perReqTO)
		if err != nil {
			continue
		}
		if err := verifyChecksums(keyring, sums, asc); err != nil {
			continue // try the next-lower candidate
		}
		sha, err := checksumFor(sums, asset)
		if err != nil {
			return "", "", err // verified but malformed checksums -> hard error
		}
		return tag, sha, nil
	}
	return "", "", errors.New("no verifiable newer release within the attempt bound")
}

// downloadArchive fetches the archive under size + idle/overall time bounds, checks
// its sha256, and extracts the single mathion binary. §4.2 step 7, §6.4.
func downloadArchive(ctx context.Context, cfg config, tag, expectedSHA string) ([]byte, error) {
	raw, err := getArchive(ctx, cfg, archiveURL(cfg, tag))
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expectedSHA {
		return nil, fmt.Errorf("archive sha256 mismatch for %s", tag)
	}
	return extractSingleBinary(raw, cfg.capExtracted)
}

// getArchive GETs url with an OVERALL deadline plus an idle/stall timeout (so a
// slowloris origin cannot hang the process while holding the flock — §6.4).
func getArchive(ctx context.Context, cfg config, url string) ([]byte, error) {
	octx, cancel := context.WithTimeout(ctx, cfg.archiveOverallTO)
	defer cancel()
	req, err := http.NewRequestWithContext(octx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := cfg.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}
	return readIdleBounded(resp.Body, cfg.capArchive, cfg.archiveIdleTO, cancel)
}

// readIdleBounded reads up to capBytes, resetting an idle timer on each chunk of
// progress; if the timer fires (no progress within idleTO) it cancels the request
// context so the next Read errors out.
func readIdleBounded(r io.Reader, capBytes int64, idleTO time.Duration, cancel context.CancelFunc) ([]byte, error) {
	var buf bytes.Buffer
	chunk := make([]byte, 32*1024)
	timer := time.AfterFunc(idleTO, cancel)
	defer timer.Stop()
	for {
		n, err := r.Read(chunk)
		if n > 0 {
			timer.Reset(idleTO)
			if int64(buf.Len())+int64(n) > capBytes {
				return nil, fmt.Errorf("archive exceeds %d bytes", capBytes)
			}
			buf.Write(chunk[:n])
		}
		if err == io.EOF {
			return buf.Bytes(), nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// extractSingleBinary accepts EXACTLY ONE regular file named "mathion" (rejecting
// symlinks, hardlinks, dirs, devices, extra members, traversal) bounded by
// capExtracted. §4.2 step 7.
func extractSingleBinary(targz []byte, capExtracted int64) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(targz))
	if err != nil {
		return nil, fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var found []byte
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("tar: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			return nil, fmt.Errorf("archive member %q is not a regular file", hdr.Name)
		}
		if filepath.Clean(hdr.Name) != "mathion" {
			return nil, fmt.Errorf("unexpected archive member %q (want mathion)", hdr.Name)
		}
		if found != nil {
			return nil, errors.New("archive has more than one member")
		}
		data, err := io.ReadAll(io.LimitReader(tr, capExtracted+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > capExtracted {
			return nil, fmt.Errorf("extracted binary exceeds %d bytes", capExtracted)
		}
		found = data
	}
	if found == nil {
		return nil, errors.New("archive contains no mathion binary")
	}
	return found, nil
}
