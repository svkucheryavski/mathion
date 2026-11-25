package cmd

import (
	"context"
	"errors"
	"net"
	"os"
	"testing"
)

// TestMain keeps tests off real ports, DNS and HTTPS; a test that needs them swaps its own fakes in.
func TestMain(m *testing.M) {
	portBindable = func(string) error { return errors.New("tests do not bind real ports") }
	dnsLookup = func(string) ([]string, error) { return nil, errors.New("tests do not look up real DNS") }
	localAddrs = func() ([]net.IP, error) { return nil, errors.New("tests do not read real addresses") }
	probeDomainHTTPS = func(context.Context, string) bool { return false }
	certWait = 0
	os.Exit(m.Run())
}
