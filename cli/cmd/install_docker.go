package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/svkucheryavski/mathion/cli/internal/dockersetup"
	"github.com/svkucheryavski/mathion/cli/internal/dockerx"
	"github.com/svkucheryavski/mathion/cli/internal/prompt"
)

// readOSRelease reads this server's /etc/os-release.
func readOSRelease() (dockersetup.OS, error) {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return dockersetup.OS{}, err
	}
	defer f.Close()
	return dockersetup.ParseOSRelease(f)
}

// dockerDaemon names the Docker daemon on this server: "dockerd", "snap", or "" for none.
func dockerDaemon() string {
	if _, err := exec.LookPath("dockerd"); err == nil {
		return "dockerd"
	}
	if _, err := os.Stat("/snap/bin/docker"); err == nil {
		return "snap"
	}
	return ""
}

// prompter returns the install Prompter, or one that never asks.
func (a *App) prompter() *prompt.Prompter {
	if a.Prompt == nil {
		return prompt.New(strings.NewReader(""), a.Out, false)
	}
	return a.Prompt
}

// confirm asks a yes/no question; yes answers it without asking.
func (a *App) confirm(yes bool, question string, def bool) (bool, error) {
	if yes {
		return true, nil
	}
	return a.prompter().Confirm(question, def)
}

// unanswered rewords an ended input for the admin.
func unanswered(err error, how string) error {
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return fmt.Errorf("The question was not answered. Run sudo mathion install again, or %s.", how)
	}
	return err
}

// dockerCE returns dpkg's status of docker-ce; known is false when dpkg has no record of it.
func (a *App) dockerCE(ctx context.Context) (status string, known bool) {
	out, err := a.DockerCmd.Output(ctx, "dpkg-query", "-W", "-f=${Status}", "docker-ce")
	return strings.TrimSpace(out), err == nil
}

const ceInstalled = "install ok installed"

// ensureDocker leaves a working Docker alone and offers to install a missing one.
func (a *App) ensureDocker(ctx context.Context, yes bool) error {
	name, missing := "Docker", "Docker is not installed."
	if _, err := a.Runner.Output(ctx, "version"); err == nil {
		if _, err := a.Runner.Output(ctx, "compose", "version"); err == nil {
			a.dockerAtBoot(ctx)
			return nil
		}
		// Finish our own interrupted install; leave any other Docker alone.
		if s, known := a.dockerCE(ctx); !known || s != ceInstalled {
			return errors.New(dockersetup.Instructions("Docker works, but Docker Compose v2 is missing."))
		}
		name, missing = "Docker Compose", "Docker Compose is missing."
	} else if err := a.dockerStopped(ctx); err != nil {
		return err
	}
	o, err := a.ReadOSRelease()
	if err != nil || !dockersetup.Supported(o) {
		return errors.New(dockersetup.Instructions(missing + " Mathion installs it automatically only on Ubuntu 22.04 or newer and Debian 12 or newer."))
	}
	arch, err := a.DockerCmd.Output(ctx, "dpkg", "--print-architecture")
	if arch = strings.TrimSpace(arch); err != nil || (arch != "amd64" && arch != "arm64") {
		return errors.New(dockersetup.Instructions(missing + " Mathion installs it automatically only on 64-bit Intel/AMD or ARM systems."))
	}
	ok, err := a.confirm(yes, missing+" Install it from Docker's official packages?", true)
	if errors.Is(err, prompt.ErrNotInteractive) {
		return errors.New(missing + " Run sudo mathion install in a terminal to be asked, or install everything without questions:\n" +
			"  sudo mathion install --yes --domain <site address> --admin-email <your email>")
	}
	if err != nil {
		return unanswered(err, "add --yes to install "+name+" without asking")
	}
	if !ok {
		return errors.New(dockersetup.Instructions(name + " is needed, and it was not installed."))
	}
	if err := a.InstallDocker(ctx, o, arch); err != nil {
		if errors.Is(err, dockersetup.ErrNoDockerRelease) {
			return errors.New(dockersetup.Instructions(fmt.Sprintf("Docker does not publish packages for %s %s yet.", o.ID, o.Codename)))
		}
		return err
	}
	if err := dockerx.Preflight(ctx, a.Runner); err != nil {
		return fmt.Errorf("%s was installed but Docker does not answer yet: %w", name, err)
	}
	if name == "Docker" {
		fmt.Fprintln(a.Out, "Docker is installed and will start at boot.")
	} else {
		fmt.Fprintln(a.Out, "Docker Compose is installed.")
	}
	return nil
}

// dockerAtBoot makes a working Docker start at boot; a failure is only a note.
func (a *App) dockerAtBoot(ctx context.Context) {
	changed, err := dockersetup.EnableAtBoot(ctx, a.DockerCmd)
	if err != nil {
		fmt.Fprintf(a.Err, "note: could not make Docker start at boot (%v); run sudo systemctl enable docker\n", err)
	} else if changed {
		fmt.Fprintln(a.Out, "Docker will now start at boot.")
	}
}

// dockerStopped explains a Docker that is installed but does not answer; nil means install it.
func (a *App) dockerStopped(ctx context.Context) error {
	switch a.DockerDaemon() {
	case "snap":
		return errors.New("Docker (snap) is installed but does not answer. Start it with: sudo snap start docker\nthen run sudo mathion install again")
	case "dockerd":
		if s, known := a.dockerCE(ctx); known && s != ceInstalled {
			return nil // apt left docker-ce unfinished: install it again
		}
		return errors.New("Docker is installed but does not answer. Start it with: sudo systemctl enable --now docker\n" +
			"If that fails, run sudo dpkg --configure -a, then sudo mathion install again")
	}
	return nil
}
