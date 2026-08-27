package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/varlib"
)

const driftNote = "apply it with: sudo mathion reconcile"

func TestComposeDriftPrintsWhenBytesDiffer(t *testing.T) {
	varlibReady(t) // fresh varlib so no stale marker
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("expected drift note when bytes differ; got %q", out.String())
	}
}

func TestComposeDriftPrintsWhenMarkerPresentBytesMatch(t *testing.T) {
	varlibReady(t)
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("expected drift note when the apply-pending marker is present; got %q", out.String())
	}
}

func TestComposeDriftSilentWhenComposeAbsentEvenWithMarker(t *testing.T) {
	varlibReady(t)
	if err := varlib.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir() // no docker-compose.yml (post-purge shape)
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if out.Len() != 0 {
		t.Errorf("compose-absent must be silent even with a stale marker (precedence); got %q", out.String())
	}
}

func TestComposeDriftSilentWhenMatchNoMarker(t *testing.T) {
	varlibReady(t)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/docker-compose.yml", compose.ComposeYAML, 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir)
	if out.Len() != 0 {
		t.Errorf("no drift + no marker must be silent; got %q", out.String())
	}
}

func TestComposeDriftHonorsCfgDir(t *testing.T) {
	varlibReady(t)
	dir := filepath.Join(t.TempDir(), "custom")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir+"/docker-compose.yml", []byte("stale\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	maybeWarnComposeDrift(&out, dir) // reads dir, not a hardcoded /etc/mathion
	if !strings.Contains(out.String(), driftNote) {
		t.Errorf("maybeWarnComposeDrift must honor the passed cfgDir; got %q", out.String())
	}
}
