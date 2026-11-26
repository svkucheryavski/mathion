package prompt

import (
	"bytes"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"testing/iotest"
)

func newP(in string, interactive bool) (*Prompter, *bytes.Buffer) {
	var out bytes.Buffer
	return New(strings.NewReader(in), &out, interactive), &out
}

func rejectBad(s string) error {
	if s == "bad" {
		return errors.New("that will not do")
	}
	return nil
}

func TestAskRetriesUntilValid(t *testing.T) {
	p, out := newP("bad\ngood\n", true)
	got, err := p.Ask("Site address", rejectBad)
	if err != nil || got != "good" {
		t.Fatalf("got %q, %v", got, err)
	}
	if n := strings.Count(out.String(), "  that will not do\n"); n != 1 {
		t.Fatalf("check message shown %d times, output %q", n, out.String())
	}
	if n := strings.Count(out.String(), "Site address: "); n != 2 {
		t.Fatalf("label shown %d times, want 2", n)
	}
}

func TestAskTrims(t *testing.T) {
	for _, in := range []string{"  learn.example.edu \t\n", "learn.example.edu\r\n"} {
		p, _ := newP(in, true)
		got, err := p.Ask("Site address", nil)
		if err != nil || got != "learn.example.edu" {
			t.Fatalf("%q: got %q, %v", in, got, err)
		}
	}
}

func TestAskNotInteractive(t *testing.T) {
	p, out := newP("anything\n", false)
	_, err := p.Ask("Site address", nil)
	if !errors.Is(err, ErrNotInteractive) {
		t.Fatalf("err = %v", err)
	}
	if out.Len() != 0 {
		t.Fatalf("printed %q", out.String())
	}
}

func TestAskEOF(t *testing.T) {
	p, out := newP("bad\n", true)
	_, err := p.Ask("Site address", rejectBad)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("err = %v", err)
	}
	if !strings.HasSuffix(out.String(), "Site address: \n") {
		t.Fatalf("the cursor must leave the question line: %q", out.String())
	}
}

func TestAskLineWithoutNewlineIsNoAnswer(t *testing.T) {
	p, _ := newP("good", true)
	if _, err := p.Ask("Site address", nil); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("err = %v", err)
	}
}

func TestAskReadError(t *testing.T) {
	boom := errors.New("boom")
	p := New(iotest.ErrReader(boom), io.Discard, true)
	if _, err := p.Ask("Site address", nil); !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
}

func TestAskTooLong(t *testing.T) {
	p, _ := newP(strings.Repeat("a", 5000)+"\n", true)
	if _, err := p.Ask("Site address", nil); !errors.Is(err, ErrTooLong) {
		t.Fatalf("err = %v", err)
	}
}

func TestConfirmDefaults(t *testing.T) {
	p, out := newP("\n", true)
	if ok, err := p.Confirm("Install Docker?", true); err != nil || !ok {
		t.Fatalf("def true: %v, %v", ok, err)
	}
	if !strings.Contains(out.String(), "Install Docker? [Y/n] ") {
		t.Fatalf("output %q", out.String())
	}
	p, out = newP("\n", true)
	if ok, err := p.Confirm("Turn on HTTPS anyway?", false); err != nil || ok {
		t.Fatalf("def false: %v, %v", ok, err)
	}
	if !strings.Contains(out.String(), "Turn on HTTPS anyway? [y/N] ") {
		t.Fatalf("output %q", out.String())
	}
}

func TestConfirmAnswers(t *testing.T) {
	for _, def := range []bool{true, false} {
		for in, want := range map[string]bool{"Y\n": true, "yes\n": true, "yes\r\n": true, "y\n": true, "n\n": false, "no\n": false, "NO\n": false, "N\n": false} {
			p, _ := newP(in, true)
			if ok, err := p.Confirm("Go?", def); err != nil || ok != want {
				t.Fatalf("def %v, %q: %v, %v", def, in, ok, err)
			}
		}
	}
	p, out := newP("maybe\ny\n", true)
	if ok, err := p.Confirm("Go?", false); err != nil || !ok {
		t.Fatalf("maybe then y: %v, %v", ok, err)
	}
	if n := strings.Count(out.String(), "Go? [y/N] "); n != 2 {
		t.Fatalf("asked %d times, want 2", n)
	}
	if !strings.Contains(out.String(), "  Please answer y or n.\n") {
		t.Fatalf("no hint after a wrong answer: %q", out.String())
	}
}

func TestConfirmNotInteractive(t *testing.T) {
	p, out := newP("y\n", false)
	_, err := p.Confirm("Go?", true)
	if !errors.Is(err, ErrNotInteractive) || out.Len() != 0 {
		t.Fatalf("err = %v, out %q", err, out.String())
	}
}

func TestConfirmEOFNeverTakesDefault(t *testing.T) {
	for _, in := range []string{"", "  "} {
		p, _ := newP(in, true)
		if _, err := p.Confirm("Install Docker?", true); !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Fatalf("%q: err = %v", in, err)
		}
	}
}

func TestStdinIsTerminal(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "in")
	if err != nil {
		t.Fatal(err)
	}
	if StdinIsTerminal(f) {
		t.Fatal("a regular file is not a terminal")
	}
	f.Close()
	if StdinIsTerminal(f) {
		t.Fatal("a closed file is not a terminal")
	}
	null, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatal(err)
	}
	defer null.Close()
	if StdinIsTerminal(null) {
		t.Fatal("the null device is not a terminal")
	}
}

func TestStdinIsTerminalOtherCharDevice(t *testing.T) {
	zero, err := os.Open("/dev/zero")
	if err != nil {
		t.Skip("no /dev/zero")
	}
	defer zero.Close()
	if !StdinIsTerminal(zero) {
		t.Fatal("a character device other than null counts as a terminal")
	}
}
