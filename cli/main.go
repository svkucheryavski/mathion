package main

import (
	"os"

	"github.com/svkucheryavski/mathion/cli/cmd"
)

// Overridden by goreleaser ldflags at release; non-empty defaults so plain
// `go build` (tests/CI) works.
var (
	version      = "dev"
	defaultImage = "v0.1.1"
)

func main() {
	// Hidden, bounded, file-only drift probe for the .deb postinstall (spec §4.3).
	// A main.go fast-path (NOT a cobra command) so it never enters Execute()'s
	// unconditional .env/TLS read and never appears in help/completion/the pre-run.
	if len(os.Args) >= 2 && os.Args[1] == "_drift-probe" {
		cmd.RunDriftProbe(os.Stdout)
		return
	}
	cmd.SetBuildInfo(version, defaultImage)
	cmd.Execute()
}
