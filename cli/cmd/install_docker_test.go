package cmd

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/dockersetup"
	"github.com/svkucheryavski/mathion/cli/internal/prompt"
)

// sysCmd fakes systemctl and dpkg.
type sysCmd struct {
	calls   []string
	outputs map[string]string
	runErr  map[string]error
}

func (s *sysCmd) Run(_ context.Context, name string, args ...string) error {
	c := strings.Join(append([]string{name}, args...), " ")
	s.calls = append(s.calls, c)
	return s.runErr[c]
}

func (s *sysCmd) Output(_ context.Context, name string, args ...string) (string, error) {
	c := strings.Join(append([]string{name}, args...), " ")
	s.calls = append(s.calls, c)
	out, ok := s.outputs[c]
	if !ok {
		return "", errors.New("exit status 1")
	}
	return out, nil
}

type dockerWorld struct {
	app        *App
	sys        *sysCmd
	out        bytes.Buffer
	installed  bool // whether Docker answers
	compose    bool // whether Compose v2 answers
	binary     bool // whether the Docker daemon program exists
	snap       bool // whether Docker is the snap
	installs   []string
	installErr error
}

func newDockerWorld(t *testing.T, answers string, interactive bool) *dockerWorld {
	w := &dockerWorld{sys: &sysCmd{outputs: map[string]string{"dpkg --print-architecture": "amd64\n", "dpkg --version": "Debian dpkg 1.21\n", "systemctl is-enabled docker": "enabled\n"}}}
	r := &compose.FakeRunner{OutputFunc: func(args []string) (string, error) {
		switch strings.Join(args, " ") {
		case "version":
			if w.installed {
				return "Docker 27", nil
			}
			return "", errors.New("Cannot connect to the Docker daemon")
		case "compose version":
			if w.installed && w.compose {
				return "v2.30", nil
			}
			return "", errors.New("unknown command")
		}
		return "", nil
	}}
	w.app = &App{
		Runner: r, Out: &w.out, Err: &w.out,
		Prompt:    prompt.New(strings.NewReader(answers), &w.out, interactive),
		DockerCmd: w.sys,
		DockerDaemon: func() string {
			switch {
			case w.snap:
				return "snap"
			case w.binary || w.installed:
				return "dockerd"
			}
			return ""
		},
		ReadOSRelease: func() (dockersetup.OS, error) {
			return dockersetup.OS{ID: "debian", VersionID: "12", Codename: "bookworm"}, nil
		},
		InstallDocker: func(_ context.Context, o dockersetup.OS, arch string, composeOnly bool) error {
			rec := o.Codename + "/" + arch
			if composeOnly {
				rec += "/compose-only"
			}
			w.installs = append(w.installs, rec)
			if w.installErr != nil {
				return w.installErr
			}
			w.installed, w.compose = true, true
			return nil
		},
	}
	return w
}

func TestEnsureDockerPresentEnablesBoot(t *testing.T) {
	w := newDockerWorld(t, "", false)
	w.installed, w.compose = true, true
	w.sys.outputs["systemctl is-enabled docker"] = "disabled\n"
	if err := w.app.ensureDocker(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(w.out.String(), "Docker will now start at boot.") || w.sys.calls[len(w.sys.calls)-1] != "systemctl enable docker" {
		t.Fatalf("out %q calls %q", w.out.String(), w.sys.calls)
	}

	w = newDockerWorld(t, "", false)
	w.installed, w.compose = true, true
	if err := w.app.ensureDocker(context.Background(), false); err != nil || w.out.Len() != 0 || len(w.installs) != 0 {
		t.Fatalf("already enabled: err=%v out=%q installs=%v", err, w.out.String(), w.installs)
	}
}

func TestEnsureDockerComposeMissingStops(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.installed = true
	err := w.app.ensureDocker(context.Background(), true)
	if err == nil || !strings.Contains(err.Error(), "Compose v2 is missing") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerInstalledButStopped(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.binary = true
	w.sys.outputs[dpkgStatus] = "install ok installed"
	err := w.app.ensureDocker(context.Background(), true)
	if err == nil || !strings.Contains(err.Error(), "sudo systemctl enable --now docker") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerUnsupportedOS(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.app.ReadOSRelease = func() (dockersetup.OS, error) { return dockersetup.OS{ID: "fedora", VersionID: "41"}, nil }
	err := w.app.ensureDocker(context.Background(), true)
	if err == nil || !strings.Contains(err.Error(), "https://docs.docker.com/engine/install/") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerUnsupportedArch(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.sys.outputs["dpkg --print-architecture"] = "armhf\n"
	err := w.app.ensureDocker(context.Background(), true)
	if err == nil || !strings.Contains(err.Error(), "https://docs.docker.com/engine/install/") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerAsksAndInstalls(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	if err := w.app.ensureDocker(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(w.out.String(), "Install it from Docker's official packages? [Y/n]") {
		t.Fatalf("no question: %q", w.out.String())
	}
	if len(w.installs) != 1 || w.installs[0] != "bookworm/amd64" {
		t.Fatalf("installs %v", w.installs)
	}
	var versionChecks int
	for _, c := range w.app.Runner.(*compose.FakeRunner).Calls {
		if strings.Join(c, " ") == "version" {
			versionChecks++
		}
	}
	if versionChecks != 2 {
		t.Fatalf("Docker must be checked again after the install, version calls %d", versionChecks)
	}
}

func TestEnsureDockerDeclined(t *testing.T) {
	w := newDockerWorld(t, "n\n", true)
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "Docker is needed") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerNoTerminalNoYes(t *testing.T) {
	w := newDockerWorld(t, "", false)
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "--yes") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerYesInstallsWithoutAsking(t *testing.T) {
	w := newDockerWorld(t, "", true)
	w.app.Prompt = prompt.New(failReader{t}, &w.out, true)
	if err := w.app.ensureDocker(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if len(w.installs) != 1 || strings.Contains(w.out.String(), "[Y/n]") {
		t.Fatalf("installs %v out %q", w.installs, w.out.String())
	}
}

func TestEnsureDockerNoRelease(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.installErr = dockersetup.ErrNoDockerRelease
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "https://docs.docker.com/engine/install/") || !strings.Contains(err.Error(), "does not publish packages for debian bookworm") {
		t.Fatalf("err=%v", err)
	}
}

func TestEnsureDockerInstallFailureStops(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.installErr = errors.New("installing Docker: apt-get update: exit status 100")
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "apt-get update") {
		t.Fatalf("err=%v", err)
	}
}

// failReader fails the test if anything reads from it.
type failReader struct{ t *testing.T }

func (f failReader) Read([]byte) (int, error) {
	f.t.Fatal("read from the keyboard under --yes")
	return 0, nil
}

func TestInstallChecksDockerBeforeLock(t *testing.T) {
	rootedVarlib(t)
	w := newDockerWorld(t, "", false)
	w.app.CfgDir, w.app.Project = t.TempDir(), "mathion_prod"
	w.app.ReadOSRelease = func() (dockersetup.OS, error) { return dockersetup.OS{ID: "fedora", VersionID: "41"}, nil }
	c := newInstallCmd(w.app)
	c.Flags().Set("domain", "learn.example.edu")
	c.Flags().Set("admin-email", "you@example.edu")
	if err := c.RunE(c, nil); err == nil || !strings.Contains(err.Error(), "docs.docker.com") {
		t.Fatalf("err = %v", err)
	}
	for _, call := range w.app.Runner.(*compose.FakeRunner).Calls {
		if strings.Join(call, " ") != "version" {
			t.Fatalf("Docker was used before it was checked: %q", call)
		}
	}
}

const dpkgStatus = "dpkg-query -W -f=${Status} docker-ce"

func TestEnsureDockerRedoesHalfInstalled(t *testing.T) {
	for _, status := range []string{"install ok unpacked", "install ok half-configured", "deinstall ok config-files"} {
		w := newDockerWorld(t, "y\n", true)
		w.binary = true
		w.sys.outputs[dpkgStatus] = status
		if err := w.app.ensureDocker(context.Background(), false); err != nil || len(w.installs) != 1 {
			t.Fatalf("%q: err=%v installs=%v", status, err, w.installs)
		}
	}
}

func TestEnsureDockerStoppedHintsConfigure(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.binary = true // no dpkg record: a Docker from elsewhere
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "dpkg --configure -a") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerBootFailureIsANote(t *testing.T) {
	w := newDockerWorld(t, "", false)
	w.installed, w.compose = true, true
	w.sys.outputs["systemctl is-enabled docker"] = "disabled\n"
	w.sys.runErr = map[string]error{"systemctl enable docker": errors.New("exit status 1")}
	if err := w.app.ensureDocker(context.Background(), false); err != nil {
		t.Fatalf("a failed boot setting must not stop the install: %v", err)
	}
	if !strings.Contains(w.out.String(), "sudo systemctl enable docker") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestEnsureDockerWouldRemoveNamesPackages(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.installErr = fmt.Errorf("installing Docker: %w: containerd, runc. Remove or replace them yourself, then run sudo mathion install again", dockersetup.ErrWouldRemove)
	err := w.app.ensureDocker(context.Background(), false)
	if !errors.Is(err, dockersetup.ErrWouldRemove) || !strings.Contains(err.Error(), "containerd, runc") || strings.Contains(err.Error(), "installing Docker: installing") {
		t.Fatalf("err=%v", err)
	}
}

func TestEnsureDockerInputEndsAtQuestion(t *testing.T) {
	w := newDockerWorld(t, "", true)
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "The question was not answered") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerStillSilentAfterInstall(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.app.InstallDocker = func(context.Context, dockersetup.OS, string, bool) error { return nil } // Docker stays silent
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "does not answer yet") {
		t.Fatalf("err=%v", err)
	}
}

func TestEnsureDockerOSReleaseUnreadable(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.app.ReadOSRelease = func() (dockersetup.OS, error) { return dockersetup.OS{}, errors.New("no such file") }
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "docs.docker.com") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerNoTerminalNamesFullLine(t *testing.T) {
	w := newDockerWorld(t, "", false)
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "sudo mathion install --yes --domain") {
		t.Fatalf("err=%v", err)
	}
}

func installCmdWith(t *testing.T, w *dockerWorld, flags map[string]string) error {
	t.Helper()
	rootedVarlib(t)
	w.app.CfgDir, w.app.Project = t.TempDir(), "mathion_prod"
	c := newInstallCmd(w.app)
	for k, v := range flags {
		if err := c.Flags().Set(k, v); err != nil {
			t.Fatal(err)
		}
	}
	return c.RunE(c, nil)
}

func TestInstallChecksFlagsBeforeDocker(t *testing.T) {
	for _, tc := range []struct {
		flags       map[string]string
		interactive bool
		want        string
	}{
		{map[string]string{"yes": "true", "domain": "learn.example.edu"}, true, "requires --domain and --admin-email"},
		{map[string]string{"domain": "learn.example.edu"}, false, "requires --domain and --admin-email"},
		{map[string]string{"domain": "https://learn.example.edu"}, true, "--domain"},
		{map[string]string{"admin-email": "nonsense"}, true, "invalid email"},
		{map[string]string{"yes": "true", "domain": "learn.example.edu", "admin-email": "a@b.edu", "version": "bad tag!"}, true, "tag"},
	} {
		w := newDockerWorld(t, "y\n", tc.interactive)
		err := installCmdWith(t, w, tc.flags)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%v: err=%v", tc.flags, err)
		}
		if len(w.installs) != 0 || strings.Contains(w.out.String(), "[Y/n]") {
			t.Fatalf("%v: Docker touched before the flags were checked: installs=%v out=%q", tc.flags, w.installs, w.out.String())
		}
	}
}

func TestEnsureDockerFinishesComposeFromOwnInstall(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.installed = true
	w.sys.outputs[dpkgStatus] = "install ok installed"
	if err := w.app.ensureDocker(context.Background(), false); err != nil || len(w.installs) != 1 || w.installs[0] != "bookworm/amd64/compose-only" {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
	if !strings.Contains(w.out.String(), "Docker Compose is missing. Install it from Docker's official packages? [Y/n]") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestEnsureDockerStoppedSnap(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.snap = true
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "sudo snap start docker") || strings.Contains(err.Error(), "systemctl") || len(w.installs) != 0 {
		t.Fatalf("err=%v installs=%v", err, w.installs)
	}
}

func TestEnsureDockerComposePathWording(t *testing.T) {
	for _, tc := range []struct {
		answers     string
		interactive bool
		want        string
	}{
		{"", false, "Docker Compose is missing. Run sudo mathion install in a terminal"},
		{"n\n", true, "Docker Compose is needed, and it was not installed."},
	} {
		w := newDockerWorld(t, tc.answers, tc.interactive)
		w.installed = true
		w.sys.outputs[dpkgStatus] = "install ok installed"
		err := w.app.ensureDocker(context.Background(), false)
		if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "Docker is not installed") {
			t.Fatalf("%q: err=%v", tc.answers, err)
		}
	}
	w := newDockerWorld(t, "y\n", true)
	w.installed = true
	w.sys.outputs[dpkgStatus] = "install ok installed"
	if err := w.app.ensureDocker(context.Background(), false); err != nil || !strings.Contains(w.out.String(), "✓ Docker Compose installed") {
		t.Fatalf("err=%v out=%q", err, w.out.String())
	}
}

func TestEnsureDockerInstalledLineMatchesSketch(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	if err := w.app.ensureDocker(context.Background(), false); err != nil || !strings.Contains(w.out.String(), "✓ Docker installed, starts at boot") {
		t.Fatalf("err=%v out=%q", err, w.out.String())
	}
}

func TestEnsureDockerStoppedNoDpkgHintWithoutDpkg(t *testing.T) {
	w := newDockerWorld(t, "y\n", true)
	w.binary = true
	delete(w.sys.outputs, "dpkg --version")
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || strings.Contains(err.Error(), "dpkg") || !strings.Contains(err.Error(), "sudo systemctl enable --now docker") {
		t.Fatalf("err=%v", err)
	}
}

func TestEnsureDockerNoTerminalLineCanBePasted(t *testing.T) {
	w := newDockerWorld(t, "", false)
	err := w.app.ensureDocker(context.Background(), false)
	if err == nil || !strings.Contains(err.Error(), "sudo mathion install --yes --domain SITE-ADDRESS --admin-email YOUR-EMAIL") || strings.Contains(err.Error(), "<") {
		t.Fatalf("err=%v", err)
	}
}

func TestDockerStepsComposeOnly(t *testing.T) {
	if s := dockerSteps("amd64", io.Discard, true); !reflect.DeepEqual(s.Packages, []string{"docker-compose-plugin"}) || s.Arch != "amd64" {
		t.Fatalf("compose only: %+v", s.Packages)
	}
	if s := dockerSteps("arm64", io.Discard, false); s.Packages != nil || s.Arch != "arm64" {
		t.Fatalf("full: %+v", s.Packages)
	}
}
