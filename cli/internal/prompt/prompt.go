// Package prompt asks the install questions on a terminal.
package prompt

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// ErrNotInteractive means there is no terminal to ask on.
var ErrNotInteractive = errors.New("no terminal to ask on")

// ErrTooLong means an answer filled the whole read buffer.
var ErrTooLong = errors.New("the answer is too long")

// Prompter reads answers from In and writes questions to Out.
type Prompter struct {
	In          *bufio.Reader
	Out         io.Writer
	Interactive bool
}

// New wraps in in a buffered reader; use one Prompter per process.
func New(in io.Reader, out io.Writer, interactive bool) *Prompter {
	return &Prompter{In: bufio.NewReader(in), Out: out, Interactive: interactive}
}

// readLine returns one trimmed line; input that ends before a newline is no answer.
func (p *Prompter) readLine() (string, error) {
	b, err := p.In.ReadSlice('\n')
	switch {
	case errors.Is(err, io.EOF):
		fmt.Fprintln(p.Out)
		return "", fmt.Errorf("no answer, input ended: %w", io.ErrUnexpectedEOF)
	case errors.Is(err, bufio.ErrBufferFull):
		return "", ErrTooLong
	case err != nil:
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

// Ask repeats the question until check accepts the answer.
func (p *Prompter) Ask(label string, check func(string) error) (string, error) {
	if !p.Interactive {
		return "", ErrNotInteractive
	}
	for {
		fmt.Fprintf(p.Out, "%s: ", label)
		s, err := p.readLine()
		if err != nil {
			return "", err
		}
		if check == nil {
			return s, nil
		}
		cerr := check(s)
		if cerr == nil {
			return s, nil
		}
		fmt.Fprintf(p.Out, "  %v\n", cerr)
	}
}

// Confirm asks a yes/no question; an empty answer takes def.
func (p *Prompter) Confirm(question string, def bool) (bool, error) {
	if !p.Interactive {
		return false, ErrNotInteractive
	}
	hint := "[y/N]"
	if def {
		hint = "[Y/n]"
	}
	for {
		fmt.Fprintf(p.Out, "%s %s ", question, hint)
		s, err := p.readLine()
		if err != nil {
			return false, err
		}
		switch strings.ToLower(s) {
		case "":
			return def, nil
		case "y", "yes":
			return true, nil
		case "n", "no":
			return false, nil
		}
		fmt.Fprintln(p.Out, "  Please answer y or n.")
	}
}

// StdinIsTerminal reports whether f is a character device other than the null device.
func StdinIsTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil || fi.Mode()&os.ModeCharDevice == 0 {
		return false
	}
	if null, err := os.Stat(os.DevNull); err == nil && os.SameFile(fi, null) {
		return false
	}
	return true
}
