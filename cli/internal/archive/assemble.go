package archive

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// memberOrder fixes the payload write order inside the archive. manifest.json is
// always written FIRST (before these) so a reader can learn the expected member
// hashes before it reaches the payload.
var memberOrder = []string{"db.dump", "assets.tar"}

// Assemble writes a durable gzip-tar backup archive into dstDir from the given
// staging members (member name → staging path) plus the marshaled manifest, and
// returns the final archive path.
//
// The archive is streamed to a temp file, fsynced, then renamed to a
// non-colliding mathion-backup-<ts>-<ver>.tar.gz name (ts = current UTC second,
// ver = manifest.MathionVersion); dstDir is fsynced afterward so the rename is
// durable across a power loss. Assemble NEVER overwrites: a same-second name
// collision takes a -2/-3/... suffix. On any failure the temp file is removed.
//
// dstDir is a root-only 0700 dir written under the operation lock (single
// writer), so the tiny name-choice race between Lstat and Rename is accepted,
// consistent with the project's other TOCTOU rulings.
func Assemble(dstDir string, members map[string]string, manifest Manifest) (finalPath string, err error) {
	tmp, err := os.CreateTemp(dstDir, "mathion-backup-*.tmp") // CreateTemp -> 0600
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	renamed := false
	defer func() {
		if !renamed {
			_ = os.Remove(tmpName)
		}
	}()

	if werr := writeArchive(tmp, members, manifest); werr != nil {
		_ = tmp.Close()
		return "", werr
	}
	if serr := tmp.Sync(); serr != nil {
		_ = tmp.Close()
		return "", serr
	}
	if cerr := tmp.Close(); cerr != nil {
		return "", cerr
	}

	finalPath, err = pickName(dstDir, manifest.MathionVersion)
	if err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, finalPath); err != nil {
		return "", err
	}
	renamed = true
	if err := fsyncDir(dstDir); err != nil {
		return finalPath, err
	}
	return finalPath, nil
}

// writeArchive streams manifest.json, then db.dump, then assets.tar into a
// gzip→tar over w. Each member is a 0600 regular-file entry named by its member
// key.
func writeArchive(w io.Writer, members map[string]string, manifest Manifest) error {
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)

	mb, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	if err := writeTarBytes(tw, "manifest.json", mb); err != nil {
		return err
	}
	for _, name := range memberOrder {
		path, ok := members[name]
		if !ok {
			return fmt.Errorf("assemble: missing member %q", name)
		}
		if err := writeTarFile(tw, name, path); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// fixedModTime keeps every tar header in the USTAR range so the writer never has
// to emit PAX extended-header records (a zero-value ModTime is year 1, which is
// out of USTAR range and would force PAX entries into the stream).
var fixedModTime = time.Unix(0, 0)

func writeTarBytes(tw *tar.Writer, name string, b []byte) error {
	if err := tw.WriteHeader(&tar.Header{
		Name:     name,
		Mode:     0o600,
		Size:     int64(len(b)),
		Typeflag: tar.TypeReg,
		ModTime:  fixedModTime,
	}); err != nil {
		return err
	}
	_, err := tw.Write(b)
	return err
}

func writeTarFile(tw *tar.Writer, name, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	if err := tw.WriteHeader(&tar.Header{
		Name:     name,
		Mode:     0o600,
		Size:     fi.Size(),
		Typeflag: tar.TypeReg,
		ModTime:  fixedModTime,
	}); err != nil {
		return err
	}
	_, err = io.Copy(tw, f)
	return err
}

// pickName returns the first non-existing archive path under dstDir for the
// current UTC second: mathion-backup-<ts>-<ver>.tar.gz, then -<ver>-2.tar.gz,
// -3, ... — the same shape SelectLatest parses.
func pickName(dstDir, ver string) (string, error) {
	base := "mathion-backup-" + time.Now().UTC().Format("20060102T150405Z") + "-" + ver
	for i := 1; ; i++ {
		name := base + ".tar.gz"
		if i >= 2 {
			name = fmt.Sprintf("%s-%d.tar.gz", base, i)
		}
		p := filepath.Join(dstDir, name)
		_, err := os.Lstat(p)
		if errors.Is(err, os.ErrNotExist) {
			return p, nil
		}
		if err != nil {
			return "", err
		}
	}
}

// fsyncDir fsyncs a directory so a rename of an entry within it is durable across
// a power loss (a file-only fsync does not persist the dirent).
func fsyncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	syncErr := d.Sync()
	closeErr := d.Close()
	if syncErr != nil {
		return errors.Join(syncErr, closeErr) // errors.Join drops nils
	}
	return closeErr
}
