package compose

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

// requireSh skips a test when /bin/sh is unavailable (e.g. Windows). The
// behavioral env/streaming tests below shell out to /bin/sh on purpose so they
// exercise the real subprocess env and pipe wiring rather than a mock.
func requireSh(t *testing.T) {
	t.Helper()
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skipf("/bin/sh not available: %v", err)
	}
}

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

// TestExecRunnerSanitizesEnv verifies behaviorally that the four secret/version
// keys are stripped from every child's environment while an unrelated key still
// passes through. Asserting through a real /bin/sh child proves the actual
// cmd.Env application, not just a helper's return value.
func TestExecRunnerSanitizesEnv(t *testing.T) {
	requireSh(t)
	t.Setenv("MATHION_VERSION", "vBOGUS")
	t.Setenv("MATHION_VERSION_EXTRA", "survive") // near-miss: exact-key, not prefix, stripping
	t.Setenv("POSTGRES_USER", "pguser")
	t.Setenv("POSTGRES_PASSWORD", "leak")
	t.Setenv("POSTGRES_DB", "pgdb")
	t.Setenv("OTHER_KEY", "keep")

	r := ExecRunner{Bin: "/bin/sh"}
	var out bytes.Buffer
	err := r.Stream(context.Background(), &out,
		"-c", `printf '%s|%s|%s|%s|%s|%s' "$MATHION_VERSION" "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$POSTGRES_DB" "$OTHER_KEY" "$MATHION_VERSION_EXTRA"`)
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	// Four keys stripped; OTHER_KEY kept; MATHION_VERSION_EXTRA survives (exact-key
	// stripping must not match the MATHION_VERSION prefix).
	if got, want := out.String(), "||||keep|survive"; got != want {
		t.Fatalf("child env = %q, want %q", got, want)
	}
}

// TestExecRunnerRunEnvOverrideWins verifies the appended env var overrides the
// stripped baseline: the child must see the caller-supplied MATHION_VERSION.
func TestExecRunnerRunEnvOverrideWins(t *testing.T) {
	requireSh(t)
	t.Setenv("MATHION_VERSION", "vBOGUS")

	r := ExecRunner{Bin: "/bin/sh"}
	// Appended env wins: child sees v2, so the shell test succeeds (exit 0).
	if err := r.RunEnv(context.Background(), []string{"MATHION_VERSION=v2"},
		"-c", `[ "$MATHION_VERSION" = "v2" ]`); err != nil {
		t.Fatalf("RunEnv override not applied (child did not see v2): %v", err)
	}
	// RunEnv(nil) == Run: the baseline strips MATHION_VERSION, so it is empty
	// (not "v2") and the same shell test fails.
	if err := r.RunEnv(context.Background(), nil,
		"-c", `[ "$MATHION_VERSION" = "v2" ]`); err == nil {
		t.Fatal("expected non-nil error: stripped MATHION_VERSION must not equal v2")
	}
}

// TestExecRunnerStreamCapturesStdoutAndExitError checks that Stream routes child
// stdout to the writer and returns a typed *ExitError carrying the exit code and
// the child's captured stderr.
func TestExecRunnerStreamCapturesStdoutAndExitError(t *testing.T) {
	requireSh(t)
	r := ExecRunner{Bin: "/bin/sh"}
	var out bytes.Buffer
	err := r.Stream(context.Background(), &out, "-c", "printf out; printf err 1>&2; exit 2")
	if out.String() != "out" {
		t.Fatalf("stdout = %q, want %q", out.String(), "out")
	}
	var ee *ExitError
	if !errors.As(err, &ee) {
		t.Fatalf("error = %v (%T), want *ExitError", err, err)
	}
	if ee.Code != 2 {
		t.Fatalf("ExitError.Code = %d, want 2", ee.Code)
	}
	if string(ee.Stderr) != "err" {
		t.Fatalf("ExitError.Stderr = %q, want %q", ee.Stderr, "err")
	}
}

// TestExecRunnerStreamInFeedsStdin verifies StreamIn feeds the reader to the
// child to EOF; the child reads a line and its exit code reflects the content.
func TestExecRunnerStreamInFeedsStdin(t *testing.T) {
	requireSh(t)
	r := ExecRunner{Bin: "/bin/sh"}
	if err := r.StreamIn(context.Background(), strings.NewReader("ok\n"),
		"-c", `read v; [ "$v" = "ok" ]`); err != nil {
		t.Fatalf("StreamIn() error = %v (child did not receive stdin)", err)
	}
}

// TestExecRunnerStreamInPrefersExitOverEPIPE feeds a large stdin to a child that
// ignores it and exits non-zero immediately. The stdin copy will hit EPIPE, but
// StreamIn must surface the command's *ExitError, not the pipe error.
func TestExecRunnerStreamInPrefersExitOverEPIPE(t *testing.T) {
	requireSh(t)
	r := ExecRunner{Bin: "/bin/sh"}
	big := strings.NewReader(strings.Repeat("x", 1<<20)) // 1 MiB > pipe buffer
	err := r.StreamIn(context.Background(), big, "-c", "printf boom 1>&2; exit 3")
	var ee *ExitError
	if !errors.As(err, &ee) {
		t.Fatalf("error = %v (%T), want *ExitError (not an EPIPE)", err, err)
	}
	if ee.Code != 3 {
		t.Fatalf("ExitError.Code = %d, want 3", ee.Code)
	}
	if string(ee.Stderr) != "boom" {
		t.Fatalf("ExitError.Stderr = %q, want %q", ee.Stderr, "boom")
	}
}

// TestExecRunnerStreamInReportsUndeliveredStdin covers a child that exits 0 but
// does NOT consume all of stdin: the copy hits EPIPE, so StreamIn must report a
// non-nil delivery error rather than falsely claiming the dump was delivered. It
// is a wrapped copy error, not a command *ExitError (the command succeeded).
func TestExecRunnerStreamInReportsUndeliveredStdin(t *testing.T) {
	requireSh(t)
	r := ExecRunner{Bin: "/bin/sh"}
	big := strings.NewReader(strings.Repeat("x", 1<<20)) // 1 MiB > pipe buffer
	err := r.StreamIn(context.Background(), big, "-c", "exit 0")
	if err == nil {
		t.Fatal("expected non-nil error: child exited 0 without draining stdin")
	}
	var ee *ExitError
	if errors.As(err, &ee) {
		t.Fatalf("want a delivery error, got a command *ExitError: %v", err)
	}
}

// TestFakeRunnerRecordsEnvAndCtxSnapshot exercises EnvCalls plus the call-time
// context snapshot: a cancelled ctx records a non-nil Err, a deadline ctx records
// HasDeadline, and — crucially — cancelling AFTER a call must not mutate the
// already-recorded snapshot (proving it is captured at call time).
func TestFakeRunnerRecordsEnvAndCtxSnapshot(t *testing.T) {
	f := &FakeRunner{}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // record a cancelled snapshot
	_ = f.RunEnv(ctx, []string{"MATHION_VERSION=v2"}, "compose", "up")
	if len(f.EnvCalls) != 1 || f.EnvCalls[0][0] != "MATHION_VERSION=v2" {
		t.Fatalf("EnvCalls not captured: %v", f.EnvCalls)
	}
	if len(f.CtxSnaps) != 1 || f.CtxSnaps[0].Err == nil {
		t.Fatalf("expected a cancelled ctx snapshot at call time")
	}

	// A live ctx with a deadline is snapshotted with HasDeadline/Deadline set.
	dl := time.Now().Add(time.Hour)
	dctx, dcancel := context.WithDeadline(context.Background(), dl)
	defer dcancel()
	_ = f.StreamInEnv(dctx, nil, strings.NewReader(""), "compose", "run")
	last := f.CtxSnaps[len(f.CtxSnaps)-1]
	if !last.HasDeadline || !last.Deadline.Equal(dl) {
		t.Fatalf("deadline snapshot = (%v, has=%v), want %v", last.Deadline, last.HasDeadline, dl)
	}
	if last.Err != nil {
		t.Fatalf("live ctx snapshot Err = %v, want nil", last.Err)
	}
	if len(f.EnvCalls) != 2 {
		t.Fatalf("StreamInEnv should record EnvCalls too: len = %d, want 2", len(f.EnvCalls))
	}

	// The snapshot is taken at call time: cancelling AFTER the call must NOT
	// retroactively flip the recorded Err. (A stored-ctx-read-later impl fails.)
	ctx2, cancel2 := context.WithCancel(context.Background())
	_ = f.Run(ctx2, "compose", "ps")
	idx := len(f.CtxSnaps) - 1
	cancel2()
	if f.CtxSnaps[idx].Err != nil {
		t.Fatalf("call-time snapshot must stay nil after later cancel, got %v", f.CtxSnaps[idx].Err)
	}
}

// TestFakeRunnerToleratesNilContext locks in that the fake's call-time snapshot
// does not panic on a nil context (cobra's c.Context() is nil when RunE is
// invoked without Execute, as production callers do in tests).
func TestFakeRunnerToleratesNilContext(t *testing.T) {
	f := &FakeRunner{}
	//nolint:staticcheck // deliberately passing a nil context to assert tolerance
	if err := f.Run(nil, "compose", "up"); err != nil {
		t.Fatalf("Run(nil ctx) error = %v", err)
	}
	if len(f.CtxSnaps) != 1 {
		t.Fatalf("CtxSnaps len = %d, want 1", len(f.CtxSnaps))
	}
	if s := f.CtxSnaps[0]; s.Err != nil || s.HasDeadline {
		t.Fatalf("nil-ctx snapshot = %+v, want zero value", s)
	}
}

// TestFakeRunnerStreamHooks verifies the Stream/StreamIn fake hooks are invoked
// and receive the writer/reader and args.
func TestFakeRunnerStreamHooks(t *testing.T) {
	sentinel := errors.New("stream boom")
	var gotArgs []string
	f := &FakeRunner{
		StreamFunc: func(w io.Writer, args []string) error {
			_, _ = w.Write([]byte("hi"))
			gotArgs = args
			return sentinel
		},
	}
	var buf bytes.Buffer
	if err := f.Stream(context.Background(), &buf, "compose", "logs"); !errors.Is(err, sentinel) {
		t.Fatalf("Stream() error = %v, want %v", err, sentinel)
	}
	if buf.String() != "hi" {
		t.Fatalf("StreamFunc writer = %q, want %q", buf.String(), "hi")
	}
	if !reflect.DeepEqual(gotArgs, []string{"compose", "logs"}) {
		t.Fatalf("StreamFunc args = %v", gotArgs)
	}

	var gotIn string
	f2 := &FakeRunner{
		StreamInFunc: func(r io.Reader, args []string) error {
			b, _ := io.ReadAll(r)
			gotIn = string(b)
			return nil
		},
	}
	if err := f2.StreamIn(context.Background(), strings.NewReader("dump"), "exec", "psql"); err != nil {
		t.Fatalf("StreamIn() error = %v", err)
	}
	if gotIn != "dump" {
		t.Fatalf("StreamInFunc reader = %q, want %q", gotIn, "dump")
	}
}

// TestSanitizedEnvironStripsTLSKeys locks in that COMPOSE_PROFILES and the
// MATHION_TLS_* pair never reach a compose child: an ambient
// COMPOSE_PROFILES=tls must not activate the bundled proxy, and --env-file .env
// must stay authoritative for the ${MATHION_TLS_*} interpolation.
func TestSanitizedEnvironStripsTLSKeys(t *testing.T) {
	for _, k := range []string{"COMPOSE_PROFILES", "MATHION_TLS_DOMAIN", "MATHION_TLS_EMAIL"} {
		t.Setenv(k, "poison")
	}
	got := sanitizedEnviron()
	for _, kv := range got {
		key, _, _ := strings.Cut(kv, "=")
		switch key {
		case "COMPOSE_PROFILES", "MATHION_TLS_DOMAIN", "MATHION_TLS_EMAIL":
			t.Errorf("child env must not carry %s (ambient COMPOSE_PROFILES=tls must never activate the proxy)", key)
		}
	}
}
