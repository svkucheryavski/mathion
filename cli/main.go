package main

import "github.com/svkucheryavski/mathion/cli/cmd"

// Overridden by goreleaser ldflags at release; non-empty defaults so plain
// `go build` (tests/CI) works.
var (
	version      = "dev"
	defaultImage = "v0.1.1"
)

func main() {
	cmd.SetBuildInfo(version, defaultImage)
	cmd.Execute()
}
