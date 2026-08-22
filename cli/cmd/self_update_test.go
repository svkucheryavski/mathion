package cmd

import (
	"io"
	"strings"
	"testing"
)

func TestSelfUpdateCmd_FlagsAndUse(t *testing.T) {
	c := newSelfUpdateCmd(&App{Out: io.Discard, Err: io.Discard, In: strings.NewReader("")})
	if c.Use != "self-update" {
		t.Fatalf("use = %q", c.Use)
	}
	if c.Flags().Lookup("yes") == nil || c.Flags().Lookup("check") == nil {
		t.Fatal("expected --yes and --check flags")
	}
}

func TestRootRegistersSelfUpdate(t *testing.T) {
	root := newRootCmd(&App{Out: io.Discard, Err: io.Discard, In: strings.NewReader("")})
	for _, c := range root.Commands() {
		if c.Name() == "self-update" {
			return
		}
	}
	t.Fatal("self-update not registered on root")
}
