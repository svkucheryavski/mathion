package cmd

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
	"github.com/svkucheryavski/mathion/cli/internal/config"
)

func TestResumePullsProxyImagesWhenTLSEnabled(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/.env", []byte(config.RenderEnv(config.GenerateEnv("https://learn.example.edu", "v0.1.1", "s", "abc123hex"))), 0o600)
	if err := config.SetTLS(dir, "learn.example.edu", "admin@example.edu"); err != nil {
		t.Fatal(err)
	}
	var calls [][]string
	fr := &compose.FakeRunner{
		RunFunc:    func(a []string) error { calls = append(calls, a); return nil },
		OutputFunc: func(a []string) (string, error) { return "present\n", nil }, // pgdata present => skip app pull
	}
	app := &App{CfgDir: dir, Project: "mathion_prod", Runner: fr, Out: os.Stderr, Err: os.Stderr, tlsEnabled: true}
	// resume runs migrate+superuser via compose exec; the FakeRunner returns nil for those.
	_ = app.resume(context.Background(), config.State{Schema: 1, AdminEmail: "admin@example.edu"})
	var pulled bool
	for _, c := range calls {
		if strings.Contains(strings.Join(c, " "), "pull --policy missing proxy proxy-init") {
			pulled = true
		}
	}
	if !pulled {
		t.Fatalf("a TLS-enabled resume must targeted-pull the proxy images before --pull never up; calls=%v", calls)
	}
}
