package compose

import (
	"os"
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
