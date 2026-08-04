package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestVersionPrintsBoth(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_VERSION=v9.9.9\n"), 0o600)
	SetBuildInfo("cli-v0.1.0", "v0.1.1")
	var out bytes.Buffer
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: &compose.FakeRunner{}, Out: &out}
	cmd := newVersionCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	if !strings.Contains(s, "cli-v0.1.0") || !strings.Contains(s, "v9.9.9") {
		t.Fatalf("version output missing fields: %q", s)
	}
}
