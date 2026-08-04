package compose

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

// Compile-time assertions that both implementations satisfy the seam.
var (
	_ Runner = ExecRunner{}
	_ Runner = (*FakeRunner)(nil)
)

func TestFakeRunnerRecordsRunCalls(t *testing.T) {
	f := &FakeRunner{}
	if err := f.Run(context.Background(), "compose", "up", "-d"); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if err := f.Run(context.Background(), "volume", "inspect", "mathion_db"); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	want := [][]string{
		{"compose", "up", "-d"},
		{"volume", "inspect", "mathion_db"},
	}
	if !reflect.DeepEqual(f.Calls, want) {
		t.Fatalf("Calls = %v, want %v", f.Calls, want)
	}
}

func TestFakeRunnerRecordsOutputCalls(t *testing.T) {
	f := &FakeRunner{}
	if _, err := f.Output(context.Background(), "compose", "ps"); err != nil {
		t.Fatalf("Output() error = %v", err)
	}
	want := [][]string{{"compose", "ps"}}
	if !reflect.DeepEqual(f.Calls, want) {
		t.Fatalf("Calls = %v, want %v", f.Calls, want)
	}
}

func TestFakeRunnerRunFuncResult(t *testing.T) {
	sentinel := errors.New("boom")
	f := &FakeRunner{RunFunc: func(args []string) error { return sentinel }}
	if err := f.Run(context.Background(), "compose", "up"); !errors.Is(err, sentinel) {
		t.Fatalf("Run() error = %v, want %v", err, sentinel)
	}
	if len(f.Calls) != 1 {
		t.Fatalf("Calls len = %d, want 1", len(f.Calls))
	}
}

func TestFakeRunnerOutputFuncResult(t *testing.T) {
	f := &FakeRunner{OutputFunc: func(args []string) (string, error) { return "running\n", nil }}
	out, err := f.Output(context.Background(), "compose", "ps")
	if err != nil {
		t.Fatalf("Output() error = %v", err)
	}
	if out != "running\n" {
		t.Fatalf("Output() = %q, want %q", out, "running\n")
	}
	if len(f.Calls) != 1 {
		t.Fatalf("Calls len = %d, want 1", len(f.Calls))
	}
}

func TestFakeRunnerDefaults(t *testing.T) {
	f := &FakeRunner{}
	if err := f.Run(context.Background(), "noop"); err != nil {
		t.Fatalf("Run() default error = %v, want nil", err)
	}
	out, err := f.Output(context.Background(), "noop")
	if err != nil {
		t.Fatalf("Output() default error = %v, want nil", err)
	}
	if out != "" {
		t.Fatalf("Output() default = %q, want empty", out)
	}
}

func TestExecRunnerBinDefault(t *testing.T) {
	if got := (ExecRunner{}).bin(); got != "docker" {
		t.Fatalf("bin() = %q, want docker", got)
	}
	if got := (ExecRunner{Bin: "podman"}).bin(); got != "podman" {
		t.Fatalf("bin() = %q, want podman", got)
	}
}

func TestExecRunnerOutputRunsBinary(t *testing.T) {
	// Exercise the real exec path against a harmless binary instead of docker.
	r := ExecRunner{Bin: "echo"}
	out, err := r.Output(context.Background(), "hello")
	if err != nil {
		t.Fatalf("Output() error = %v", err)
	}
	if out != "hello\n" {
		t.Fatalf("Output() = %q, want %q", out, "hello\n")
	}
}
