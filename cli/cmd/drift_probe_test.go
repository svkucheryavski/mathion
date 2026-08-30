package cmd

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestRunDriftProbeWarnsOnDrift(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	t.Setenv("MATHION_CONFIG_DIR", dir) // RunDriftProbe resolves via resolveCfgDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	RunDriftProbe(&out)
	if !strings.Contains(out.String(), driftNote) {
		t.Fatalf("probe must warn on drift; got %q", out.String())
	}
}

func TestRunDriftProbeSilentWhenAbsent(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir() // no docker-compose.yml
	t.Setenv("MATHION_CONFIG_DIR", dir)
	var out bytes.Buffer
	RunDriftProbe(&out)
	if out.Len() != 0 {
		t.Fatalf("probe must be silent when compose is absent; got %q", out.String())
	}
}

func TestRunDriftProbeSilentWhenMatchNoMarker(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	t.Setenv("MATHION_CONFIG_DIR", dir)
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	RunDriftProbe(&out)
	if out.Len() != 0 {
		t.Fatalf("probe must be silent when compose matches and no marker; got %q", out.String())
	}
}
