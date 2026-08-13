// Package archive assembles and selects mathion backup archives.
package archive

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

// backupNameRe matches a backup filename and captures ONLY the fixed 16-char
// YYYYMMDDTHHMMSSZ timestamp token. The `.*` after it swallows the version and
// any `-2`/`-3` collision counter, so a counter is never parsed as a timestamp.
var backupNameRe = regexp.MustCompile(`^mathion-backup-(\d{8}T\d{6}Z)-.*\.tar\.gz$`)

// tsLayout is the UTC layout of the captured timestamp token (trailing Z literal).
const tsLayout = "20060102T150405Z"

type candidate struct {
	ts    time.Time
	mtime time.Time
	name  string
}

// SelectLatest returns the path of the newest mathion backup in dir. Among the
// regular files (directories and symlinks are ignored) named
// mathion-backup-<YYYYMMDDTHHMMSSZ>-<version>.tar.gz, the newest timestamp token
// wins; a same-second tie is broken by file mtime (newest), then by filename
// (deterministic). It errors when dir cannot be read or holds no backup.
func SelectLatest(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}

	var cands []candidate
	for _, e := range entries {
		m := backupNameRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		info, err := e.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue // vanished between readdir and stat, or not a regular file
		}
		ts, err := time.Parse(tsLayout, m[1])
		if err != nil {
			continue // regex already constrains the shape; defensive
		}
		cands = append(cands, candidate{ts: ts, mtime: info.ModTime(), name: e.Name()})
	}
	if len(cands) == 0 {
		return "", fmt.Errorf("no backups matching mathion-backup-*.tar.gz in %s", dir)
	}

	sort.Slice(cands, func(i, j int) bool {
		a, b := cands[i], cands[j]
		if !a.ts.Equal(b.ts) {
			return a.ts.After(b.ts)
		}
		if !a.mtime.Equal(b.mtime) {
			return a.mtime.After(b.mtime)
		}
		return a.name > b.name
	})
	return filepath.Join(dir, cands[0].name), nil
}
