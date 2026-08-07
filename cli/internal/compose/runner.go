package compose

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Runner runs the `docker` binary with the given arguments. Callers pass the
// full arg vector (e.g. "compose","-p",... or "volume","inspect",...).
//
// Every method runs the child with a sanitized environment (see
// sanitizedEnviron): MATHION_VERSION and the POSTGRES_* credentials are stripped
// from the host env so a poisoned host environment cannot leak into the image
// tag or database credentials the orchestrated engines rely on. The *Env
// variants append caller-supplied values LAST, which — because the same keys are
// stripped from the baseline — makes the appended value the sole occurrence.
type Runner interface {
	Run(ctx context.Context, args ...string) error
	Output(ctx context.Context, args ...string) (string, error)
	// Stream routes child stdout to the given writer while capturing child
	// stderr; a non-zero exit returns a *ExitError carrying the code and stderr.
	Stream(ctx context.Context, stdout io.Writer, args ...string) error
	// StreamIn feeds stdin to the child to EOF. If the child exits non-zero it
	// returns that *ExitError (with captured stderr) in preference to any
	// stdin-copy EPIPE/ErrClosedPipe caused by the child exiting early.
	StreamIn(ctx context.Context, stdin io.Reader, args ...string) error
	// RunEnv is Run with caller env appended to the sanitized baseline.
	RunEnv(ctx context.Context, env []string, args ...string) error
	// StreamInEnv is StreamIn with caller env appended to the sanitized baseline.
	StreamInEnv(ctx context.Context, env []string, stdin io.Reader, args ...string) error
}

// ExitError reports a non-zero child exit from Stream/StreamIn. It exposes the
// exit Code (so callers can branch — e.g. tar exit 1 = warning vs >=2 = fail)
// and the raw captured Stderr for spooling into logs.
type ExitError struct {
	Code   int
	Stderr []byte
}

func (e *ExitError) Error() string {
	if s := bytes.TrimSpace(e.Stderr); len(s) > 0 {
		return fmt.Sprintf("exit code %d: %s", e.Code, s)
	}
	return fmt.Sprintf("exit code %d", e.Code)
}

// strippedEnvKeys are removed from the child environment by sanitizedEnviron so
// a poisoned host env cannot influence the image version or DB credentials.
var strippedEnvKeys = map[string]struct{}{
	"MATHION_VERSION":   {},
	"POSTGRES_USER":     {},
	"POSTGRES_PASSWORD": {},
	"POSTGRES_DB":       {},
}

// sanitizedEnviron returns os.Environ() with the strippedEnvKeys removed. The
// result is a freshly allocated slice safe to append caller env onto.
func sanitizedEnviron() []string {
	src := os.Environ()
	out := make([]string, 0, len(src))
	for _, kv := range src {
		key, _, _ := strings.Cut(kv, "=")
		if _, stripped := strippedEnvKeys[key]; stripped {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// toExitError converts a *exec.ExitError into the typed *ExitError with captured
// stderr; other errors (spawn failure, context cancellation) pass through as-is.
func toExitError(err error, stderr []byte) error {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return &ExitError{Code: ee.ExitCode(), Stderr: stderr}
	}
	return err
}

type ExecRunner struct{ Bin string } // Bin defaults to "docker"

func (r ExecRunner) bin() string {
	if r.Bin == "" {
		return "docker"
	}
	return r.Bin
}

func (r ExecRunner) Run(ctx context.Context, args ...string) error {
	return r.RunEnv(ctx, nil, args...)
}

func (r ExecRunner) RunEnv(ctx context.Context, env []string, args ...string) error {
	cmd := exec.CommandContext(ctx, r.bin(), args...)
	cmd.Env = append(sanitizedEnviron(), env...)
	cmd.Stdout, cmd.Stderr, cmd.Stdin = os.Stdout, os.Stderr, os.Stdin
	return cmd.Run()
}

func (r ExecRunner) Output(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, r.bin(), args...)
	cmd.Env = sanitizedEnviron()
	out, err := cmd.Output()
	return string(out), err
}

func (r ExecRunner) Stream(ctx context.Context, stdout io.Writer, args ...string) error {
	cmd := exec.CommandContext(ctx, r.bin(), args...)
	cmd.Env = sanitizedEnviron()
	cmd.Stdout = stdout
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return toExitError(err, stderr.Bytes())
	}
	return nil
}

func (r ExecRunner) StreamIn(ctx context.Context, stdin io.Reader, args ...string) error {
	return r.StreamInEnv(ctx, nil, stdin, args...)
}

func (r ExecRunner) StreamInEnv(ctx context.Context, env []string, stdin io.Reader, args ...string) error {
	cmd := exec.CommandContext(ctx, r.bin(), args...)
	cmd.Env = append(sanitizedEnviron(), env...)
	cmd.Stdout = os.Stdout
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	wc, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	// Copy stdin in a goroutine so an early child exit cannot deadlock the write.
	// The copy error (typically EPIPE/ErrClosedPipe once the child closes its
	// read end) is intentionally discarded: the child's exit status is the
	// authoritative outcome and is surfaced below.
	copyDone := make(chan struct{})
	go func() {
		defer close(copyDone)
		_, _ = io.Copy(wc, stdin)
		_ = wc.Close()
	}()

	waitErr := cmd.Wait()
	<-copyDone
	if waitErr != nil {
		return toExitError(waitErr, stderr.Bytes())
	}
	return nil
}

// ctxSnap is a call-time snapshot of a context's cancellation state and
// deadline, recorded by FakeRunner when a method receives the call. Storing the
// snapshot (rather than a live context read later) lets tests assert what the
// context looked like at the moment of the call.
type ctxSnap struct {
	Err         error
	Deadline    time.Time
	HasDeadline bool
}

func snapshot(ctx context.Context) ctxSnap {
	// A nil context is a caller bug for the real runner, but FakeRunner is a
	// test double that historically tolerated one (e.g. cobra's c.Context() is
	// nil when RunE is invoked without Execute); snapshot must not panic on it.
	if ctx == nil {
		return ctxSnap{}
	}
	dl, ok := ctx.Deadline()
	return ctxSnap{Err: ctx.Err(), Deadline: dl, HasDeadline: ok}
}

type FakeRunner struct {
	Calls    [][]string // arg vectors from every call, parallel with CtxSnaps
	EnvCalls [][]string // env vectors from *Env calls
	CtxSnaps []ctxSnap  // call-time context snapshots, parallel with Calls

	RunFunc      func(args []string) error
	OutputFunc   func(args []string) (string, error)
	StreamFunc   func(w io.Writer, args []string) error
	StreamInFunc func(r io.Reader, args []string) error
}

func (f *FakeRunner) Run(ctx context.Context, args ...string) error {
	f.CtxSnaps = append(f.CtxSnaps, snapshot(ctx))
	f.Calls = append(f.Calls, args)
	if f.RunFunc != nil {
		return f.RunFunc(args)
	}
	return nil
}

func (f *FakeRunner) Output(ctx context.Context, args ...string) (string, error) {
	f.CtxSnaps = append(f.CtxSnaps, snapshot(ctx))
	f.Calls = append(f.Calls, args)
	if f.OutputFunc != nil {
		return f.OutputFunc(args)
	}
	return "", nil
}

func (f *FakeRunner) Stream(ctx context.Context, stdout io.Writer, args ...string) error {
	f.CtxSnaps = append(f.CtxSnaps, snapshot(ctx))
	f.Calls = append(f.Calls, args)
	if f.StreamFunc != nil {
		return f.StreamFunc(stdout, args)
	}
	return nil
}

func (f *FakeRunner) StreamIn(ctx context.Context, stdin io.Reader, args ...string) error {
	f.CtxSnaps = append(f.CtxSnaps, snapshot(ctx))
	f.Calls = append(f.Calls, args)
	if f.StreamInFunc != nil {
		return f.StreamInFunc(stdin, args)
	}
	return nil
}

func (f *FakeRunner) RunEnv(ctx context.Context, env []string, args ...string) error {
	f.CtxSnaps = append(f.CtxSnaps, snapshot(ctx))
	f.Calls = append(f.Calls, args)
	f.EnvCalls = append(f.EnvCalls, env)
	if f.RunFunc != nil {
		return f.RunFunc(args)
	}
	return nil
}

func (f *FakeRunner) StreamInEnv(ctx context.Context, env []string, stdin io.Reader, args ...string) error {
	f.CtxSnaps = append(f.CtxSnaps, snapshot(ctx))
	f.Calls = append(f.Calls, args)
	f.EnvCalls = append(f.EnvCalls, env)
	if f.StreamInFunc != nil {
		return f.StreamInFunc(stdin, args)
	}
	return nil
}
