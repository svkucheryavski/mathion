package dockersetup

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const (
	keyPath     = "/etc/apt/keyrings/docker.asc"
	sourcesPath = "/etc/apt/sources.list.d/docker.list"
	// lockWait is how long to wait for another program holding the apt lock.
	lockWait = 2 * time.Minute
	lockPoll = 10 * time.Second
	lockHint = "wait a few minutes and run sudo mathion install again"
)

var packages = []string{"docker-ce", "docker-ce-cli", "containerd.io", "docker-compose-plugin"}

// lockOpt makes apt wait for the dpkg lock instead of failing at once.
var lockOpt = []string{"-o", fmt.Sprintf("DPkg::Lock::Timeout=%d", int(lockWait/time.Second))}

var (
	// ErrWouldRemove means installing Docker would remove packages already on the server.
	ErrWouldRemove = errors.New("Docker's packages would remove packages already on this server")
	// ErrNoDockerRelease means Docker publishes no packages for this release.
	ErrNoDockerRelease = errors.New("Docker publishes no packages for this release yet")
	// ErrLocked means another program holds the apt lock.
	ErrLocked = errors.New("another program is using apt")
	// ErrNotFound means a download answered 404.
	ErrNotFound = errors.New("not found")
)

// Cmd runs system commands such as apt-get and systemctl.
type Cmd interface {
	Run(ctx context.Context, name string, args ...string) error
	Output(ctx context.Context, name string, args ...string) (string, error)
}

// ExecCmd runs commands for real, with no stdin and no prompts.
type ExecCmd struct{}

var cmdEnv = []string{"DEBIAN_FRONTEND=noninteractive", "NEEDRESTART_MODE=l", "LC_ALL=C"}

// newCmd stops a cancelled command with SIGTERM, so dpkg is never killed outright.
func newCmd(ctx context.Context, name string, args ...string) *exec.Cmd {
	c := exec.CommandContext(ctx, name, args...)
	c.Cancel = func() error { return c.Process.Signal(syscall.SIGTERM) }
	c.WaitDelay = 30 * time.Second
	c.Env = append(os.Environ(), cmdEnv...)
	return c
}

// showStderr says whose error output belongs on the terminal; systemctl's would look like a failure.
func showStderr(name string) bool { return name == "apt-get" }

// Run shows the command's output on the terminal; a lock failure wraps ErrLocked.
func (ExecCmd) Run(ctx context.Context, name string, args ...string) error {
	c := newCmd(ctx, name, args...)
	var tail tailBuffer
	c.Stdout, c.Stderr = os.Stdout, io.MultiWriter(os.Stderr, &tail)
	err := c.Run()
	if err != nil && isLockMessage(tail.String()) {
		return fmt.Errorf("%w: %v", ErrLocked, err)
	}
	return err
}

// Output returns the command's stdout; apt-get's stderr is shown on the terminal.
func (ExecCmd) Output(ctx context.Context, name string, args ...string) (string, error) {
	c := newCmd(ctx, name, args...)
	if showStderr(name) {
		c.Stderr = os.Stderr
	}
	out, err := c.Output()
	return string(out), err
}

func isLockMessage(s string) bool {
	for _, m := range []string{"Could not get lock", "Unable to lock directory", "Unable to acquire the dpkg frontend lock"} {
		if strings.Contains(s, m) {
			return true
		}
	}
	return false
}

// tailBuffer keeps the last 4 KiB written to it.
type tailBuffer struct{ b []byte }

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.b = append(t.b, p...)
	if len(t.b) > 4096 {
		t.b = t.b[len(t.b)-4096:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string { return string(t.b) }

// Steps installs Docker; its fields are seams for tests.
type Steps struct {
	Cmd       Cmd
	Fetch     func(ctx context.Context, url string) ([]byte, error)
	ReadFile  func(path string) ([]byte, error)
	WriteFile func(path string, data []byte, perm os.FileMode) error
	Remove    func(path string) error
	Sleep     func(time.Duration)
	Out       io.Writer
	Arch      string
}

// NewSteps returns Steps that act on this server.
func NewSteps(arch string, out io.Writer) Steps {
	return Steps{Cmd: ExecCmd{}, Fetch: HTTPFetch, ReadFile: os.ReadFile, WriteFile: WriteFileWhole, Remove: os.Remove, Sleep: time.Sleep, Out: out, Arch: arch}
}

// Install adds Docker's checked apt source and installs Docker and Compose.
func (s Steps) Install(ctx context.Context, o OS) error {
	if !Supported(o) {
		return fmt.Errorf("installing Docker: %s %s is not supported", o.ID, o.VersionID)
	}
	if s.Arch != "amd64" && s.Arch != "arm64" {
		return fmt.Errorf("installing Docker: architecture %q is not supported", s.Arch)
	}
	base := "https://download.docker.com/linux/" + o.ID
	raw, err := s.Fetch(ctx, base+"/gpg")
	if err != nil {
		return fmt.Errorf("installing Docker: downloading Docker's signing key: %w", err)
	}
	key, err := CheckKey(raw, DockerKeyFingerprint)
	if err != nil {
		return fmt.Errorf("installing Docker: %w", err)
	}
	if _, err := s.Fetch(ctx, base+"/dists/"+o.Codename+"/InRelease"); err != nil {
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("installing Docker: %w (%s %s)", ErrNoDockerRelease, o.ID, o.Codename)
		}
		return fmt.Errorf("installing Docker: checking Docker's package source: %w", err)
	}
	if err := s.WriteFile(keyPath, key, 0o644); err != nil {
		return fmt.Errorf("installing Docker: writing %s: %w", keyPath, err)
	}
	old, err := s.ReadFile(sourcesPath)
	hadOld := err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("installing Docker: reading %s: %w", sourcesPath, err)
	}
	line := fmt.Sprintf("deb [arch=%s signed-by=%s] %s %s stable\n", s.Arch, keyPath, base, o.Codename)
	if err := s.WriteFile(sourcesPath, []byte(line), 0o644); err != nil {
		return fmt.Errorf("installing Docker: writing %s: %w", sourcesPath, err)
	}
	if err := s.update(ctx); err != nil {
		var rerr error
		if hadOld {
			rerr = s.WriteFile(sourcesPath, old, 0o644)
		} else {
			rerr = s.Remove(sourcesPath)
		}
		if rerr != nil {
			return fmt.Errorf("installing Docker: apt-get update: %w; remove %s by hand (%v)", err, sourcesPath, rerr)
		}
		return fmt.Errorf("installing Docker: apt-get update: %w; the Docker source was taken out again", err)
	}
	sim, err := s.Cmd.Output(ctx, "apt-get", append(append(append([]string{}, lockOpt...), "install", "-s"), packages...)...)
	if err != nil {
		return fmt.Errorf("installing Docker: apt-get install -s: %w", err)
	}
	if removed := removals(sim); len(removed) > 0 {
		return fmt.Errorf("installing Docker: %w: %s. Remove or replace them yourself, then run sudo mathion install again", ErrWouldRemove, strings.Join(removed, ", "))
	}
	args := append(append([]string{}, lockOpt...), "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "install", "-y", "--no-remove")
	if err := s.Cmd.Run(ctx, "apt-get", append(args, packages...)...); err != nil {
		if errors.Is(err, ErrLocked) {
			return fmt.Errorf("installing Docker: apt-get install: %w (waited %v); %s", ErrLocked, lockWait, lockHint)
		}
		return fmt.Errorf("installing Docker: apt-get install: %w. If apt says dpkg was interrupted, run sudo dpkg --configure -a, then sudo mathion install again", err)
	}
	if err := s.Cmd.Run(ctx, "systemctl", "enable", "--now", "docker"); err != nil {
		return fmt.Errorf("installing Docker: systemctl enable --now docker: %w", err)
	}
	return nil
}

// update runs apt-get update, waiting while another program holds the apt lock.
func (s Steps) update(ctx context.Context) error {
	var waited time.Duration
	for {
		err := s.Cmd.Run(ctx, "apt-get", "update")
		if !errors.Is(err, ErrLocked) {
			return err
		}
		if waited >= lockWait {
			return fmt.Errorf("%w (waited %v); %s", ErrLocked, lockWait, lockHint)
		}
		if waited == 0 {
			fmt.Fprintf(s.Out, "Another program is updating this server (common right after it starts). Waiting up to %v...\n", lockWait)
		}
		s.Sleep(lockPoll)
		if err := ctx.Err(); err != nil {
			return err
		}
		waited += lockPoll
	}
}

// removals lists the packages an apt-get simulation would remove or purge.
func removals(sim string) []string {
	var out []string
	for _, l := range strings.Split(sim, "\n") {
		rest, ok := strings.CutPrefix(l, "Remv ")
		if !ok {
			rest, ok = strings.CutPrefix(l, "Purg ")
		}
		if f := strings.Fields(rest); ok && len(f) > 0 {
			out = append(out, f[0])
		}
	}
	return out
}

// EnableAtBoot turns on the Docker service at boot when systemd says it is disabled.
func EnableAtBoot(ctx context.Context, c Cmd) (changed bool, err error) {
	out, _ := c.Output(ctx, "systemctl", "is-enabled", "docker")
	if strings.TrimSpace(out) != "disabled" {
		return false, nil
	}
	if err := c.Run(ctx, "systemctl", "enable", "docker"); err != nil {
		return false, fmt.Errorf("systemctl enable docker: %w", err)
	}
	return true, nil
}

// Instructions follows the reason with how to install Docker by hand.
func Instructions(reason string) string {
	return reason + "\n" +
		"Install Docker Engine and Docker Compose v2 by following https://docs.docker.com/engine/install/\n" +
		"(it first removes the system's own docker.io and docker-compose packages),\n" +
		"then run sudo mathion install again."
}

// WriteFileWhole writes data to a temp file and renames it over path.
func WriteFileWhole(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if _, err := os.Stat(dir); errors.Is(err, fs.ErrNotExist) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := os.Chmod(dir, 0o755); err != nil {
			return err
		}
	}
	f, err := os.CreateTemp(dir, ".mathion-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Chmod(perm); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

var httpsOnly = &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" {
			return errors.New("refusing a redirect away from https")
		}
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		return nil
	},
}

// HTTPFetch downloads a small file over HTTPS; a 404 wraps ErrNotFound.
func HTTPFetch(ctx context.Context, url string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := httpsOnly.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("%s: %w", url, ErrNotFound)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", url, resp.Status)
	}
	var buf bytes.Buffer
	_, err = io.Copy(&buf, io.LimitReader(resp.Body, 1<<20))
	return buf.Bytes(), err
}
