package compose_test

import (
	"bytes"
	"testing"

	"github.com/svkucheryavski/mathion/cli/internal/compose"
)

func TestImageRepoIsComposePrefix(t *testing.T) {
	want := compose.ImageRepo + ":${MATHION_VERSION}"
	if !bytes.Contains(compose.ComposeYAML, []byte(want)) {
		t.Fatalf("compose image line does not contain %q", want)
	}
}
