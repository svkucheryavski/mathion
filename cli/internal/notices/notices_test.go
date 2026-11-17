package notices

import (
	"os"
	"os/exec"
	"regexp"
	"strings"
	"testing"
)

const mainModule = "github.com/svkucheryavski/mathion/cli"

var header = regexp.MustCompile(`(?m)^===== (.+) =====$`)

// Every module compiled into a linux binary has its own notices section.
func TestNoticesCoverCompiledModules(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not on PATH")
	}
	have := map[string]bool{}
	for _, m := range header.FindAllStringSubmatch(Text, -1) {
		have[m[1]] = true
	}
	for _, arch := range []string{"amd64", "arm64"} {
		cmd := exec.Command("go", "list", "-deps", "-f", "{{with .Module}}{{.Path}}{{end}}", mainModule)
		cmd.Env = append(os.Environ(), "GOOS=linux", "GOARCH="+arch, "CGO_ENABLED=0")
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("go list (%s): %v", arch, err)
		}
		mods := map[string]bool{}
		for _, mod := range strings.Split(string(out), "\n") {
			if mod != "" && mod != mainModule {
				mods[mod] = true
			}
		}
		if len(mods) == 0 {
			t.Fatalf("linux/%s: go list found no dependency modules", arch)
		}
		for mod := range mods {
			if !have[mod] {
				t.Errorf("linux/%s: module %s has no ===== %s ===== section", arch, mod, mod)
			}
		}
	}
}

// The Go standard library section carries Go's LICENSE and PATENTS.
func TestNoticesHaveGoStandardLibrary(t *testing.T) {
	const h = "===== Go standard library ====="
	i := strings.Index(Text, "\n"+h+"\n")
	if i < 0 {
		t.Fatalf("no %q line", h)
	}
	sec := Text[i+len(h)+2:]
	if j := header.FindStringIndex(sec); j != nil {
		sec = sec[:j[0]]
	}
	for _, want := range []string{"Copyright 2009 The Go Authors", "Redistribution and use in source and binary forms", "Additional IP Rights Grant (Patents)"} {
		if !strings.Contains(sec, want) {
			t.Errorf("Go standard library section lacks %q", want)
		}
	}
}

// The text opens with a section header.
func TestNoticesStartWithAHeader(t *testing.T) {
	if !strings.HasPrefix(Text, "===== ") {
		t.Fatalf("notices must start with a header; got %q", Text[:min(40, len(Text))])
	}
}
