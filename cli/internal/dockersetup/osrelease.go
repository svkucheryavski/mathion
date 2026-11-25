// Package dockersetup installs Docker from Docker's signed apt source on Ubuntu and Debian.
package dockersetup

import (
	"bufio"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// OS is what /etc/os-release says about this server.
type OS struct {
	ID, VersionID, Codename string
}

// ParseOSRelease reads ID, VERSION_ID and VERSION_CODENAME.
func ParseOSRelease(r io.Reader) (OS, error) {
	var o OS
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
		if !ok {
			continue
		}
		v = strings.Trim(v, `"'`)
		switch k {
		case "ID":
			o.ID = v
		case "VERSION_ID":
			o.VersionID = v
		case "VERSION_CODENAME":
			o.Codename = v
		}
	}
	if err := sc.Err(); err != nil {
		return OS{}, err
	}
	if o.ID == "" {
		return OS{}, errors.New("os-release has no ID")
	}
	return o, nil
}

// oldest is the oldest supported release per system, as major*100+minor.
var oldest = map[string]int{"ubuntu": 2204, "debian": 1200}

// codename is the shape of a release codename that may go into an apt line.
var codename = regexp.MustCompile(`^[a-z]+$`)

// Supported reports whether Docker can be installed here automatically.
func Supported(o OS) bool {
	floor, ok := oldest[o.ID]
	if !ok || !codename.MatchString(o.Codename) {
		return false
	}
	major, minor, _ := strings.Cut(o.VersionID, ".")
	ma, err := strconv.Atoi(major)
	if err != nil {
		return false
	}
	mi := 0
	if minor != "" {
		if mi, err = strconv.Atoi(minor); err != nil {
			return false
		}
	}
	return ma*100+mi >= floor
}
