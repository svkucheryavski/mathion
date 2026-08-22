//go:build !mathion_selfupdate_test

package selfupdate

// Production endpoints. The paired mathion_selfupdate_test build (Task 13) overrides
// these from env so an integration harness can point a REAL swapped binary at a
// throwaway server; the shipped release must be built WITHOUT that tag (CI-asserted).
func endpointAPIBase() string { return "https://api.github.com/repos/svkucheryavski/mathion" }
func endpointDLBase() string {
	return "https://github.com/svkucheryavski/mathion/releases/download"
}
