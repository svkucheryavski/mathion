package compose

import (
	"os"
	"strings"
	"testing"
)

func TestEmbeddedComposeMatchesRepoRoot(t *testing.T) {
	repo, err := os.ReadFile("../../../docker-compose.prod.yml")
	if err != nil {
		t.Fatal(err)
	}
	if string(ComposeYAML) != string(repo) {
		t.Fatal("embedded docker-compose.yml has drifted from repo-root docker-compose.prod.yml; re-copy it")
	}
}

func TestEmbeddedComposeDeclaresTLSProfile(t *testing.T) {
	s := string(ComposeYAML)
	for _, want := range []string{
		"ghcr.io/umputun/reproxy@sha256:456d9d2ac7321e2bbb729a5580259d4fc6b52d0310c6cb79c1e30350dd6ba0f7",
		"busybox@sha256:7a3ebe5bfd1a4a19797d20b0c0bb39d44393e9a03fd852c0865b0f540d868df0",
		"proxy-init:",
		`profiles: ["tls"]`,
		`command: ["chown", "1001:1001", "/srv/acme"]`,
		"SSL_TYPE: auto",
		`STATIC_RULES: "${MATHION_TLS_DOMAIN},/,http://app:8000/"`,
		`MAX_SIZE: "25M"`,
		"networks: [default, frontend]", // app dual membership
		"networks: [frontend]",          // proxy only
		"frontend: {}",
		"mathion_acme:",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("embedded compose missing %q", want)
		}
	}
	// The proxy MUST NOT carry env_file (it would import the DB secrets). The only
	// env_file DIRECTIVE in the file is the app's (`env_file: .env`). We match the
	// full `env_file: .env` token rather than the bare `env_file:` substring so the
	// proxy service's explanatory "NO env_file:" comment is not miscounted.
	if strings.Count(s, "env_file: .env") != 1 {
		t.Errorf("expected exactly one env_file (app's); got %d — proxy must not have one", strings.Count(s, "env_file: .env"))
	}
}
