package dockersetup

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
)

type fakeCmd struct {
	calls   []string
	errs    map[string][]error // per call, popped in order; nil when used up
	outputs map[string]string
}

func (f *fakeCmd) next(c string) error {
	f.calls = append(f.calls, c)
	q := f.errs[c]
	if len(q) == 0 {
		return nil
	}
	f.errs[c] = q[1:]
	return q[0]
}

func (f *fakeCmd) Run(_ context.Context, name string, args ...string) error {
	return f.next(strings.Join(append([]string{name}, args...), " "))
}

func (f *fakeCmd) Output(_ context.Context, name string, args ...string) (string, error) {
	c := strings.Join(append([]string{name}, args...), " ")
	return f.outputs[c], f.next(c)
}

type written struct {
	path string
	data string
	perm os.FileMode
}

type world struct {
	t        *testing.T
	cmd      *fakeCmd
	key      []byte
	release  error // result of fetching InRelease
	keyErr   error
	rmErr    error
	fetches  []string
	files    map[string]string
	writes   []written
	removed  []string
	writeErr map[string]error
	sleeps   []time.Duration
	out      bytes.Buffer
}

func newWorld(t *testing.T) *world {
	return &world{t: t, cmd: &fakeCmd{errs: map[string][]error{}, outputs: map[string]string{}}, key: dockerKey(t), files: map[string]string{}, writeErr: map[string]error{}}
}

func (w *world) steps(arch string) Steps {
	return Steps{
		Cmd: w.cmd,
		Fetch: func(_ context.Context, url string) ([]byte, error) {
			w.fetches = append(w.fetches, url)
			if strings.HasSuffix(url, "/gpg") {
				return w.key, w.keyErr
			}
			return []byte("Origin: Docker\n"), w.release
		},
		ReadFile: func(p string) ([]byte, error) {
			s, ok := w.files[p]
			if !ok {
				return nil, fs.ErrNotExist
			}
			return []byte(s), nil
		},
		WriteFile: func(p string, d []byte, m os.FileMode) error {
			if err := w.writeErr[p]; err != nil {
				return err
			}
			w.writes = append(w.writes, written{p, string(d), m})
			w.files[p] = string(d)
			return nil
		},
		Remove: func(p string) error {
			if w.rmErr != nil {
				return w.rmErr
			}
			w.removed = append(w.removed, p)
			delete(w.files, p)
			return nil
		},
		Sleep: func(d time.Duration) { w.sleeps = append(w.sleeps, d) },
		Out:   &w.out,
		Arch:  arch,
	}
}

var (
	bookworm = OS{ID: "debian", VersionID: "12", Codename: "bookworm"}
	noble    = OS{ID: "ubuntu", VersionID: "24.04", Codename: "noble"}
)

const (
	pkgs      = "docker-ce docker-ce-cli containerd.io docker-compose-plugin"
	update    = "apt-get update"
	simulate  = "apt-get -o DPkg::Lock::Timeout=120 install -s " + pkgs
	installY  = "apt-get -o DPkg::Lock::Timeout=120 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install -y --no-remove " + pkgs
	enableNow = "systemctl enable --now docker"
)

func checkedKey(t *testing.T) string {
	k, err := CheckKey(dockerKey(t), DockerKeyFingerprint)
	if err != nil {
		t.Fatal(err)
	}
	return string(k)
}

func TestInstallStepsInOrder(t *testing.T) {
	for _, tc := range []struct {
		o    OS
		arch string
		base string
	}{
		{bookworm, "amd64", "https://download.docker.com/linux/debian"},
		{noble, "arm64", "https://download.docker.com/linux/ubuntu"},
	} {
		w := newWorld(t)
		if err := w.steps(tc.arch).Install(context.Background(), tc.o); err != nil {
			t.Fatal(err)
		}
		if want := []string{tc.base + "/gpg", tc.base + "/dists/" + tc.o.Codename + "/InRelease"}; !reflect.DeepEqual(w.fetches, want) {
			t.Fatalf("fetches = %q", w.fetches)
		}
		wantFiles := []written{
			{"/etc/apt/keyrings/docker.asc", checkedKey(t), 0o644},
			{"/etc/apt/sources.list.d/docker.list", "deb [arch=" + tc.arch + " signed-by=/etc/apt/keyrings/docker.asc] " + tc.base + " " + tc.o.Codename + " stable\n", 0o644},
		}
		if !reflect.DeepEqual(w.writes, wantFiles) {
			t.Fatalf("files = %+v", w.writes)
		}
		if want := []string{update, simulate, installY, enableNow}; !reflect.DeepEqual(w.cmd.calls, want) {
			t.Fatalf("calls = %q", w.cmd.calls)
		}
	}
}

func TestInstallRefusesBadInput(t *testing.T) {
	for _, tc := range []struct {
		o    OS
		arch string
	}{
		{OS{ID: "fedora", VersionID: "41", Codename: "x"}, "amd64"},
		{bookworm, ""},
		{bookworm, "armhf"},
		{OS{ID: "debian", VersionID: "12", Codename: "book worm"}, "amd64"},
	} {
		w := newWorld(t)
		if err := w.steps(tc.arch).Install(context.Background(), tc.o); err == nil || len(w.fetches) != 0 {
			t.Fatalf("%+v/%q: err=%v fetches=%q", tc.o, tc.arch, err, w.fetches)
		}
	}
}

func TestInstallRejectsWrongKey(t *testing.T) {
	w := newWorld(t)
	w.key = otherKey(t)
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || len(w.writes) != 0 || len(w.cmd.calls) != 0 {
		t.Fatalf("err=%v files=%d calls=%q", err, len(w.writes), w.cmd.calls)
	}
}

func TestInstallNoDockerRelease(t *testing.T) {
	w := newWorld(t)
	w.release = ErrNotFound
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if !errors.Is(err, ErrNoDockerRelease) || len(w.writes) != 0 || len(w.cmd.calls) != 0 {
		t.Fatalf("err=%v writes=%d calls=%q", err, len(w.writes), w.cmd.calls)
	}
	w = newWorld(t)
	w.release = errors.New("dial tcp: no route")
	err = w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || errors.Is(err, ErrNoDockerRelease) || len(w.writes) != 0 {
		t.Fatalf("network error: err=%v writes=%d", err, len(w.writes))
	}
}

func TestInstallUpdateFailureTakesSourceOut(t *testing.T) {
	w := newWorld(t)
	w.cmd.errs[update] = []error{errors.New("exit status 100")}
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || !strings.Contains(err.Error(), "apt-get update") {
		t.Fatalf("err = %v", err)
	}
	if _, ok := w.files[sourcesPath]; ok || !reflect.DeepEqual(w.removed, []string{sourcesPath}) {
		t.Fatalf("source left behind: files=%v removed=%q", w.files, w.removed)
	}

	w = newWorld(t)
	w.files[sourcesPath] = "deb old\n"
	w.cmd.errs[update] = []error{errors.New("exit status 100")}
	if err := w.steps("amd64").Install(context.Background(), bookworm); err == nil {
		t.Fatal("want an error")
	}
	if w.files[sourcesPath] != "deb old\n" || len(w.removed) != 0 {
		t.Fatalf("old source not put back: %q removed=%q", w.files[sourcesPath], w.removed)
	}
}

func TestInstallWaitsForAptLock(t *testing.T) {
	w := newWorld(t)
	w.cmd.errs[update] = []error{ErrLocked, ErrLocked}
	if err := w.steps("amd64").Install(context.Background(), bookworm); err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(strings.Join(w.cmd.calls, "\n"), update); n != 3 || len(w.sleeps) != 2 {
		t.Fatalf("update runs %d, sleeps %v", n, w.sleeps)
	}
	if strings.Count(w.out.String(), "Another program is updating") != 1 {
		t.Fatalf("output %q", w.out.String())
	}
}

func TestInstallGivesUpOnAptLock(t *testing.T) {
	w := newWorld(t)
	for i := 0; i < 50; i++ {
		w.cmd.errs[update] = append(w.cmd.errs[update], ErrLocked)
	}
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if !errors.Is(err, ErrLocked) || !strings.Contains(err.Error(), "sudo mathion install again") {
		t.Fatalf("err = %v", err)
	}
	var total time.Duration
	for _, d := range w.sleeps {
		total += d
	}
	if total != 2*time.Minute {
		t.Fatalf("waited %v", total)
	}
	if _, ok := w.files[sourcesPath]; ok {
		t.Fatal("source left behind")
	}
}

func TestInstallRefusesRemovals(t *testing.T) {
	w := newWorld(t)
	w.cmd.outputs[simulate] = "Inst docker-ce\nRemv containerd [1.6.20]\nConf docker-ce\n"
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if !errors.Is(err, ErrWouldRemove) || !strings.Contains(err.Error(), "containerd") {
		t.Fatalf("err = %v", err)
	}
	if !strings.HasPrefix(err.Error(), "installing Docker: ") {
		t.Fatalf("error lacks the step prefix: %v", err)
	}
	if w.cmd.calls[len(w.cmd.calls)-1] != simulate {
		t.Fatalf("calls after the simulation: %q", w.cmd.calls)
	}
}

func TestInstallStopsAtEachFailedStep(t *testing.T) {
	boom := errors.New("boom")
	for _, tc := range []struct {
		name  string
		setup func(w *world)
		calls int
	}{
		{"downloading Docker's signing key", func(w *world) { w.keyErr = boom }, 0},
		{keyPath, func(w *world) { w.writeErr[keyPath] = boom }, 0},
		{sourcesPath, func(w *world) { w.writeErr[sourcesPath] = boom }, 0},
		{"apt-get install -s", func(w *world) { w.cmd.errs[simulate] = []error{boom} }, 2},
		{"apt-get install", func(w *world) { w.cmd.errs[installY] = []error{boom} }, 3},
		{"systemctl enable --now docker", func(w *world) { w.cmd.errs[enableNow] = []error{boom} }, 4},
	} {
		w := newWorld(t)
		tc.setup(w)
		err := w.steps("amd64").Install(context.Background(), bookworm)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), tc.name) {
			t.Fatalf("%s: err = %v", tc.name, err)
		}
		if len(w.cmd.calls) != tc.calls {
			t.Fatalf("%s: calls %q", tc.name, w.cmd.calls)
		}
	}
}

func TestInstallFailureHintsDpkgConfigure(t *testing.T) {
	w := newWorld(t)
	w.cmd.errs[installY] = []error{errors.New("exit status 100")}
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || !strings.Contains(err.Error(), "dpkg --configure -a") {
		t.Fatalf("err = %v", err)
	}
}

func TestRemovals(t *testing.T) {
	sim := "Remv containerd [1.6.20-0ubuntu1]\nRemv runc [1.1.7] [docker.io:amd64 ]\nPurg docker.io [20.10]\nRemv \nInst docker-ce\n"
	if got := removals(sim); !reflect.DeepEqual(got, []string{"containerd", "runc", "docker.io"}) {
		t.Fatalf("got %q", got)
	}
}

func TestWriteFileWhole(t *testing.T) {
	old := syscall.Umask(0o077)
	defer syscall.Umask(old)
	dir := filepath.Join(t.TempDir(), "keyrings")
	p := filepath.Join(dir, "docker.list")
	if err := WriteFileWhole(p, []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteFileWhole(p, []byte("two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	fi, _ := os.Stat(p)
	if string(b) != "two\n" || fi.Mode().Perm() != 0o644 {
		t.Fatalf("content %q mode %v", b, fi.Mode().Perm())
	}
	if di, _ := os.Stat(dir); di.Mode().Perm() != 0o755 {
		t.Fatalf("new directory mode %v under a strict umask", di.Mode().Perm())
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 1 {
		t.Fatalf("leftover files: %v", ents)
	}
}

func TestEnableAtBoot(t *testing.T) {
	for state, wantEnable := range map[string]bool{
		"enabled\n": false, "disabled\n": true, "": false, "masked\n": false,
		"static\n": false, "enabled-runtime\n": false, "not-found\n": false,
	} {
		c := &fakeCmd{errs: map[string][]error{}, outputs: map[string]string{"systemctl is-enabled docker": state}}
		if state != "enabled\n" {
			c.errs["systemctl is-enabled docker"] = []error{errors.New("exit status 1")}
		}
		changed, err := EnableAtBoot(context.Background(), c)
		enabled := c.calls[len(c.calls)-1] == "systemctl enable docker"
		if err != nil || changed != wantEnable || enabled != wantEnable {
			t.Fatalf("%q: changed=%v err=%v calls=%q", state, changed, err, c.calls)
		}
	}
}

func TestInstructions(t *testing.T) {
	s := Instructions("Docker Compose v2 is missing.")
	for _, want := range []string{"Docker Compose v2 is missing.", "https://docs.docker.com/engine/install/", "Compose v2", "docker.io", "sudo mathion install"} {
		if !strings.Contains(s, want) {
			t.Fatalf("instructions lack %q: %s", want, s)
		}
	}
}

func TestInstallRollbackFailureNamesTheFile(t *testing.T) {
	w := newWorld(t)
	w.rmErr = errors.New("read-only file system")
	w.cmd.errs[update] = []error{errors.New("exit status 100")}
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || strings.Contains(err.Error(), "taken out again") || !strings.Contains(err.Error(), "remove "+sourcesPath) {
		t.Fatalf("err = %v", err)
	}
}

func TestInstallLockMessages(t *testing.T) {
	w := newWorld(t)
	for i := 0; i < 50; i++ {
		w.cmd.errs[update] = append(w.cmd.errs[update], ErrLocked)
	}
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || strings.Count(err.Error(), "another program is using apt") != 1 || strings.Contains(err.Error(), "exit status") {
		t.Fatalf("update lock: %v", err)
	}

	w = newWorld(t)
	w.cmd.errs[installY] = []error{fmt.Errorf("%w: exit status 100", ErrLocked)}
	err = w.steps("amd64").Install(context.Background(), bookworm)
	if !errors.Is(err, ErrLocked) || strings.Contains(err.Error(), "dpkg --configure") || !strings.Contains(err.Error(), "sudo mathion install again") {
		t.Fatalf("install lock: %v", err)
	}
}

func TestInstallLockWaitStopsOnCancel(t *testing.T) {
	w := newWorld(t)
	for i := 0; i < 50; i++ {
		w.cmd.errs[update] = append(w.cmd.errs[update], ErrLocked)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := w.steps("amd64")
	s.Sleep = func(time.Duration) { cancel() }
	if err := s.Install(ctx, bookworm); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if n := strings.Count(strings.Join(w.cmd.calls, "\n"), update); n != 1 {
		t.Fatalf("update ran %d times after cancel", n)
	}
}

func TestShowStderrOnlyForApt(t *testing.T) {
	if !showStderr("apt-get") || showStderr("systemctl") {
		t.Fatal("apt-get's stderr is shown, systemctl's is not")
	}
}

func TestInstallRerunWritesWholeFiles(t *testing.T) {
	w := newWorld(t)
	w.files[keyPath] = "stale key\n"
	w.files[sourcesPath] = "deb stale\n"
	for run := 1; run <= 2; run++ {
		if err := w.steps("amd64").Install(context.Background(), bookworm); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		wantSrc := "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable\n"
		if w.files[keyPath] != checkedKey(t) || w.files[sourcesPath] != wantSrc {
			t.Fatalf("run %d: files not written whole: %q", run, w.files)
		}
	}
	for _, wr := range w.writes {
		if strings.Contains(wr.data, "stale") {
			t.Fatalf("a write kept old content: %+v", wr)
		}
	}
}

func TestInstallComposeOnly(t *testing.T) {
	w := newWorld(t)
	s := w.steps("amd64")
	s.Packages = []string{"docker-compose-plugin"}
	if err := s.Install(context.Background(), bookworm); err != nil {
		t.Fatal(err)
	}
	sim := "apt-get -o DPkg::Lock::Timeout=120 install -s docker-compose-plugin"
	inst := "apt-get -o DPkg::Lock::Timeout=120 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install -y --no-remove docker-compose-plugin"
	if want := []string{update, sim, inst, enableNow}; !reflect.DeepEqual(w.cmd.calls, want) {
		t.Fatalf("calls = %q", w.cmd.calls)
	}
}

func TestInstallSimulateFailureHints(t *testing.T) {
	w := newWorld(t)
	w.cmd.errs[simulate] = []error{errors.New("exit status 100")}
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || !strings.Contains(err.Error(), "sudo dpkg --configure -a") || !strings.Contains(err.Error(), lockHint) {
		t.Fatalf("err = %v", err)
	}
}

func TestInstallUpdateFailureNamesOldSources(t *testing.T) {
	w := newWorld(t)
	w.files["/etc/apt/sources.list.d/docker.sources"] = "Types: deb\n"
	w.cmd.errs[update] = []error{errors.New("exit status 100")}
	err := w.steps("amd64").Install(context.Background(), bookworm)
	if err == nil || !strings.Contains(err.Error(), "/etc/apt/sources.list.d/docker.sources") || !strings.Contains(err.Error(), "Conflicting values") {
		t.Fatalf("err = %v", err)
	}
	w = newWorld(t)
	w.cmd.errs[update] = []error{errors.New("exit status 100")}
	if err := w.steps("amd64").Install(context.Background(), bookworm); err == nil || strings.Contains(err.Error(), "docker.sources") {
		t.Fatalf("no old file: err = %v", err)
	}
}

func TestInstallComposeOnlyUsesExistingDockerSources(t *testing.T) {
	w := newWorld(t)
	w.files["/etc/apt/sources.list.d/docker.sources"] = "Types: deb\n"
	s := w.steps("amd64")
	s.Packages = []string{"docker-compose-plugin"}
	if err := s.Install(context.Background(), bookworm); err != nil {
		t.Fatal(err)
	}
	if len(w.writes) != 0 {
		t.Fatalf("wrote %+v next to docker.sources", w.writes)
	}
	if len(w.cmd.calls) != 4 || w.cmd.calls[0] != update {
		t.Fatalf("calls = %q", w.cmd.calls)
	}
}
