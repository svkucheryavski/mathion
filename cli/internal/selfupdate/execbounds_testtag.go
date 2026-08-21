//go:build linux && mathion_selfupdate_test

package selfupdate

import (
	"os"
	"strconv"
	"time"
)

// Under the integration build tag ONLY, the staged-exec bounds can be injected from env
// so §9.2's staged-exec legs can (a) force a FAST deadline for the basic past-deadline
// abort and (b) inject a LONG deadline that parks the updater inside step 7 long enough
// to SIGKILL it before its LOCK_UN (leg ii). The shipped release lacks this tag
// (CI-asserted, Task 11), so production always uses swap.go's defaults.
func init() {
	if v := os.Getenv("MATHION_SELFUPDATE_EXEC_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			stagedExecTimeout = d
		}
	}
	if v := os.Getenv("MATHION_SELFUPDATE_OUTPUT_CAP"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			stagedExecOutputCap = n
		}
	}
}
