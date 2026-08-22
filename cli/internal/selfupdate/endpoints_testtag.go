//go:build mathion_selfupdate_test

package selfupdate

import "os"

// Under the mathion_selfupdate_test tag ONLY, endpoints come from env so an
// integration harness can point a REAL swapped binary at a throwaway server. The
// shipped release is built WITHOUT this tag (CI-asserted — Task 11).
func endpointAPIBase() string { return os.Getenv("MATHION_SELFUPDATE_API_BASE") }
func endpointDLBase() string  { return os.Getenv("MATHION_SELFUPDATE_DL_BASE") }
