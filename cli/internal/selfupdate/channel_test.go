package selfupdate

import (
	"context"
	"testing"
)

func TestDetectChannel(t *testing.T) {
	orig := dpkgSearch
	t.Cleanup(func() { dpkgSearch = orig })
	ctx := context.Background()

	set := func(r dpkgResult) { dpkgSearch = func(context.Context, string) dpkgResult { return r } }

	set(dpkgResult{stdout: []byte("mathion: /usr/bin/mathion\n"), exitCode: 0})
	if c, err := detectChannel(ctx, "/usr/bin/mathion"); err != nil || c != channelApt {
		t.Fatalf("apt plain: c=%d err=%v", c, err)
	}
	set(dpkgResult{stdout: []byte("mathion:amd64: /usr/bin/mathion\n"), exitCode: 0})
	if c, err := detectChannel(ctx, "/usr/bin/mathion"); err != nil || c != channelApt {
		t.Fatalf("apt multiarch: c=%d err=%v", c, err)
	}
	set(dpkgResult{stderr: []byte("dpkg-query: no path found matching pattern /usr/local/bin/mathion"), exitCode: 1})
	if c, err := detectChannel(ctx, "/usr/local/bin/mathion"); err != nil || c != channelCurl {
		t.Fatalf("curl not-found: c=%d err=%v", c, err)
	}
	set(dpkgResult{absent: true})
	if c, err := detectChannel(ctx, "/usr/local/bin/mathion"); err != nil || c != channelCurl {
		t.Fatalf("curl dpkg-absent: c=%d err=%v", c, err)
	}
	set(dpkgResult{stdout: []byte("otherpkg: /usr/local/bin/mathion\n"), exitCode: 0})
	if _, err := detectChannel(ctx, "/usr/local/bin/mathion"); err == nil {
		t.Fatal("foreign package (exit 0, pkg != mathion) must abort")
	}
	set(dpkgResult{stderr: []byte("dpkg: some other error"), exitCode: 2})
	if _, err := detectChannel(ctx, "/usr/local/bin/mathion"); err == nil {
		t.Fatal("other dpkg error must abort")
	}
}
