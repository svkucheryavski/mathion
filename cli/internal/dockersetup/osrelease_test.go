package dockersetup

import (
	"strings"
	"testing"
)

const ubuntu2404 = `PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.1 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
UBUNTU_CODENAME=noble
`

const debian12 = `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
VERSION="12 (bookworm)"
VERSION_CODENAME=bookworm
ID=debian
`

func TestParseOSRelease(t *testing.T) {
	for in, want := range map[string]OS{
		ubuntu2404:                     {ID: "ubuntu", VersionID: "24.04", Codename: "noble"},
		debian12:                       {ID: "debian", VersionID: "12", Codename: "bookworm"},
		"ID='fedora'\nVERSION_ID=41\n": {ID: "fedora", VersionID: "41"},
	} {
		got, err := ParseOSRelease(strings.NewReader(in))
		if err != nil || got != want {
			t.Fatalf("got %+v, %v; want %+v", got, err, want)
		}
	}
}

func TestParseOSReleaseNoID(t *testing.T) {
	if _, err := ParseOSRelease(strings.NewReader("NAME=Something\n")); err == nil {
		t.Fatal("an os-release without ID must be an error")
	}
}

func TestSupported(t *testing.T) {
	yes := []OS{
		{ID: "ubuntu", VersionID: "22.04", Codename: "jammy"},
		{ID: "ubuntu", VersionID: "24.04", Codename: "noble"},
		{ID: "ubuntu", VersionID: "26.04", Codename: "x"},
		{ID: "debian", VersionID: "12", Codename: "bookworm"},
		{ID: "debian", VersionID: "13", Codename: "trixie"},
	}
	no := []OS{
		{ID: "ubuntu", VersionID: "20.04", Codename: "focal"},
		{ID: "ubuntu", VersionID: "22.04"}, // no codename: no apt line can be written
		{ID: "debian", VersionID: "11", Codename: "bullseye"},
		{ID: "debian", VersionID: "", Codename: "sid"},
		{ID: "fedora", VersionID: "41"},
		{},
	}
	for _, o := range yes {
		if !Supported(o) {
			t.Errorf("%+v should be supported", o)
		}
	}
	for _, o := range no {
		if Supported(o) {
			t.Errorf("%+v should not be supported", o)
		}
	}
}

func TestSupportedCodenameShape(t *testing.T) {
	for _, c := range []string{"book worm", "Noble", "noble]", "a/b"} {
		if Supported(OS{ID: "debian", VersionID: "12", Codename: c}) {
			t.Errorf("codename %q should not be supported", c)
		}
	}
}
