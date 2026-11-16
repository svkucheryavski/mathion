package selfupdate

import (
	"context"
	"reflect"
	"testing"
)

func TestPackageOwners(t *testing.T) {
	orig := dpkgSearch
	t.Cleanup(func() { dpkgSearch = orig })
	ctx := context.Background()
	const path = "/usr/bin/mathion"

	cases := []struct {
		name    string
		r       dpkgResult
		want    []string
		wantErr bool
	}{
		{"plain", dpkgResult{stdout: []byte("mathion: /usr/bin/mathion\n")}, []string{"mathion"}, false},
		{"multiarch", dpkgResult{stdout: []byte("mathion:amd64: /usr/bin/mathion\n")}, []string{"mathion"}, false},
		{"two owners", dpkgResult{stdout: []byte("a, b:arm64: /usr/bin/mathion\n")}, []string{"a", "b"}, false},
		{"diversion lines skipped", dpkgResult{stdout: []byte(
			"diversion by x from: /usr/bin/mathion\ndiversion by x to: /usr/bin/mathion.real\nmathion: /usr/bin/mathion\n")},
			[]string{"mathion"}, false},
		{"exact path only", dpkgResult{stdout: []byte("other: /usr/bin/mathion.d\nmathion: /usr/bin/mathion\n")},
			[]string{"mathion"}, false},
		{"only a diversion line", dpkgResult{stdout: []byte("diversion by x from: /usr/bin/mathion\n")}, nil, true},
		{"local diversion lines skipped", dpkgResult{stdout: []byte(
			"local diversion from: /usr/bin/mathion\nlocal diversion to: /usr/bin/mathion.distrib\nmathion: /usr/bin/mathion\n")},
			[]string{"mathion"}, false},
		{"only a local diversion line", dpkgResult{stdout: []byte("local diversion from: /usr/bin/mathion\n")}, nil, true},
		{"same owner twice", dpkgResult{stdout: []byte("mathion: /usr/bin/mathion\nmathion:amd64: /usr/bin/mathion\n")},
			[]string{"mathion"}, false},
		{"not found", dpkgResult{stderr: []byte("dpkg-query: no path found matching pattern /usr/bin/mathion"), exitCode: 1}, nil, false},
		{"dpkg absent", dpkgResult{absent: true}, nil, false},
		{"other exit-1 output", dpkgResult{stderr: []byte("dpkg: odd"), exitCode: 1}, nil, true},
		{"other exit code", dpkgResult{stderr: []byte("dpkg: some other error"), exitCode: 2}, nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := c.r
			dpkgSearch = func(context.Context, string) dpkgResult { return r }
			got, err := packageOwners(ctx, path)
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, c.wantErr)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("owners = %q, want %q", got, c.want)
			}
		})
	}
}

func TestPackageOwners_PathWithColonSpace(t *testing.T) {
	orig := dpkgSearch
	t.Cleanup(func() { dpkgSearch = orig })
	const path = "/opt/a: b/mathion"
	dpkgSearch = func(context.Context, string) dpkgResult {
		return dpkgResult{stdout: []byte("mathion: /opt/a: b/mathion\n")}
	}
	got, err := packageOwners(context.Background(), path)
	if err != nil || !reflect.DeepEqual(got, []string{"mathion"}) {
		t.Fatalf("owners = %q, err = %v", got, err)
	}
}

func TestRefusePackageOwned(t *testing.T) {
	const path = "/usr/bin/mathion"
	if err := refusePackageOwned(path, nil); err != nil {
		t.Fatalf("no owners must pass: %v", err)
	}
	cases := []struct {
		owners []string
		want   string
	}{
		{[]string{"mathion"}, "/usr/bin/mathion belongs to the system package mathion. Remove it (sudo apt remove mathion) and install Mathion with curl | sh."},
		{[]string{"a", "b"}, "/usr/bin/mathion belongs to the system package a, b; refusing to replace it."},
		{[]string{"mathion", "a"}, "/usr/bin/mathion belongs to the system package mathion, a; refusing to replace it."},
	}
	for _, c := range cases {
		err := refusePackageOwned(path, c.owners)
		if err == nil || err.Error() != c.want {
			t.Fatalf("owners %q: got %v, want %q", c.owners, err, c.want)
		}
	}
}
