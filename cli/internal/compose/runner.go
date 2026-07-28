package compose

import (
	"context"
	"os"
	"os/exec"
)

// Runner runs the `docker` binary with the given arguments. Callers pass the
// full arg vector (e.g. "compose","-p",... or "volume","inspect",...).
type Runner interface {
	Run(ctx context.Context, args ...string) error
	Output(ctx context.Context, args ...string) (string, error)
}

type ExecRunner struct{ Bin string } // Bin defaults to "docker"

func (r ExecRunner) bin() string {
	if r.Bin == "" {
		return "docker"
	}
	return r.Bin
}

func (r ExecRunner) Run(ctx context.Context, args ...string) error {
	cmd := exec.CommandContext(ctx, r.bin(), args...)
	cmd.Stdout, cmd.Stderr, cmd.Stdin = os.Stdout, os.Stderr, os.Stdin
	return cmd.Run()
}

func (r ExecRunner) Output(ctx context.Context, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, r.bin(), args...).Output()
	return string(out), err
}

type FakeRunner struct {
	Calls      [][]string
	RunFunc    func(args []string) error
	OutputFunc func(args []string) (string, error)
}

func (f *FakeRunner) Run(_ context.Context, args ...string) error {
	f.Calls = append(f.Calls, args)
	if f.RunFunc != nil {
		return f.RunFunc(args)
	}
	return nil
}

func (f *FakeRunner) Output(_ context.Context, args ...string) (string, error) {
	f.Calls = append(f.Calls, args)
	if f.OutputFunc != nil {
		return f.OutputFunc(args)
	}
	return "", nil
}
