package cmd

import (
	"bytes"
	"context"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

// stubVersionEnv replaces the .env reader seam so the not-installed (ENOENT) vs
// installed-but-unreadable (EACCES) branches are exercised WITHOUT depending on the
// test process uid. Restored on cleanup.
func stubVersionEnv(t *testing.T, m map[string]string, err error) {
	t.Helper()
	prev := versionEnvReader
	versionEnvReader = func(string) (map[string]string, error) { return m, err }
	t.Cleanup(func() { versionEnvReader = prev })
}

// stubRunningProbe replaces the live /version reader seam so the command's DISPLAY
// branches stay hermetic (no accidental network). Restored on cleanup.
func stubRunningProbe(t *testing.T, v string) {
	t.Helper()
	prev := versionRunningProbe
	versionRunningProbe = func(context.Context) string { return v }
	t.Cleanup(func() { versionRunningProbe = prev })
}

func TestVersionPrintsBoth(t *testing.T) {
	stubRunningProbe(t, "")
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_VERSION=v9.9.9\n"), 0o600)
	// SetBuildInfo mutates the package globals buildVersion/buildDefaultImage; capture
	// and restore them so this test does not bleed "cli-v0.1.0"/"v0.1.1" into any other
	// test (e.g. one asserting the default buildDefaultImage update target).
	prevV, prevImg := buildVersion, buildDefaultImage
	t.Cleanup(func() { SetBuildInfo(prevV, prevImg) })
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
	if !strings.Contains(s, "image (pinned)  v9.9.9") {
		t.Fatalf("expected pinned line, got: %q", s)
	}
	if strings.Contains(s, "image (running)") {
		t.Fatalf("running line should be omitted when probe returns empty: %q", s)
	}
}

func TestVersionNotInstalled(t *testing.T) {
	stubRunningProbe(t, "")
	var out bytes.Buffer
	app := &App{CfgDir: t.TempDir(), Out: &out} // no .env → REAL ENOENT
	cmd := newVersionCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	if !strings.Contains(s, "mathion "+buildVersion) {
		t.Fatalf("expected cli version line, got: %q", s)
	}
	if !strings.Contains(s, "not installed") {
		t.Fatalf("expected not-installed line, got: %q", s)
	}
	if strings.Contains(s, "image (pinned)") || strings.Contains(s, "image (running)") {
		t.Fatalf("no pinned/running line expected when not installed: %q", s)
	}
}

func TestVersionInstalledUnreadableEacces(t *testing.T) {
	stubVersionEnv(t, nil, &fs.PathError{Op: "open", Path: "/etc/mathion/.env", Err: fs.ErrPermission})
	stubRunningProbe(t, "")
	var out bytes.Buffer
	app := &App{CfgDir: "/etc/mathion", Out: &out}
	cmd := newVersionCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	if !strings.Contains(s, "installed (run with sudo to read the pinned version)") {
		t.Fatalf("expected installed-unreadable line, got: %q", s)
	}
	if strings.Contains(s, "not installed") {
		t.Fatalf("EACCES must not misreport as not installed: %q", s)
	}
}

func TestVersionPinnedAndRunning(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_VERSION=v9.9.9\n"), 0o600)
	stubRunningProbe(t, "v9.9.9")
	var out bytes.Buffer
	app := &App{CfgDir: dir, Out: &out}
	cmd := newVersionCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	if !strings.Contains(s, "image (pinned)  v9.9.9") {
		t.Fatalf("expected pinned line, got: %q", s)
	}
	if !strings.Contains(s, "image (running) v9.9.9") {
		t.Fatalf("expected running line, got: %q", s)
	}
}

func TestVersionRunningOmittedWhenUnreachable(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, ".env"), []byte("MATHION_VERSION=v9.9.9\n"), 0o600)
	stubRunningProbe(t, "")
	var out bytes.Buffer
	app := &App{CfgDir: dir, Out: &out}
	cmd := newVersionCmd(app)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	if !strings.Contains(s, "image (pinned)  v9.9.9") {
		t.Fatalf("expected pinned line, got: %q", s)
	}
	if strings.Contains(s, "image (running)") {
		t.Fatalf("running line must be omitted when unreachable: %q", s)
	}
}

func TestVersionProbeRunningHTTP(t *testing.T) {
	t.Run("json", func(t *testing.T) {
		useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"version":"v3.2.1"}`))
		})
		if got := probeRunningVersion(context.Background()); got != "v3.2.1" {
			t.Fatalf("json probe = %q, want v3.2.1", got)
		}
	})
	t.Run("spa", func(t *testing.T) {
		useGateServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<!doctype html><html><body>app</body></html>"))
		})
		if got := probeRunningVersion(context.Background()); got != "" {
			t.Fatalf("spa probe = %q, want empty", got)
		}
	})
	t.Run("unreachable", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
		u := srv.URL
		srv.Close()
		prev := gateVersionURL
		gateVersionURL = u + "/version"
		t.Cleanup(func() { gateVersionURL = prev })
		if got := probeRunningVersion(context.Background()); got != "" {
			t.Fatalf("unreachable probe = %q, want empty", got)
		}
	})
}

func TestMaybeWarnDualInstall(t *testing.T) {
	origExists, origLook := binExists, lookPath
	t.Cleanup(func() { binExists, lookPath = origExists, origLook })

	// both channels present -> warn, naming the PATH-resolved binary
	binExists = func(p string) bool { return p == aptBinPath || p == curlBinPath }
	lookPath = func(string) (string, error) { return curlBinPath, nil }
	var buf bytes.Buffer
	maybeWarnDualInstall(&buf)
	out := buf.String()
	if !strings.Contains(out, aptBinPath) || !strings.Contains(out, curlBinPath) {
		t.Fatalf("warning should name both paths; got %q", out)
	}
	if !strings.Contains(out, "your shell runs: "+curlBinPath) {
		t.Fatalf("warning should name the PATH-resolved binary; got %q", out)
	}

	// only one channel -> silent
	binExists = func(p string) bool { return p == curlBinPath }
	buf.Reset()
	maybeWarnDualInstall(&buf)
	if buf.Len() != 0 {
		t.Fatalf("no warning expected for a single install; got %q", buf.String())
	}
}
