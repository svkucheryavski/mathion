package selfupdate

import (
	"io"
	"net/http"
	"time"
)

// Params bundles the command's runtime dependencies.
type Params struct {
	Out, Err       io.Writer
	In             io.Reader
	Yes, Check     bool
	Cfg            config
	CurrentVersion string // the baked buildVersion (cli-vX.Y.Z or dev)
}

// DefaultConfig is the production config (real endpoints + §6.4 caps).
func DefaultConfig() config {
	return config{
		apiBase: endpointAPIBase(), dlBase: endpointDLBase(),
		client:   newHTTPClient(http.DefaultTransport, 5),
		perReqTO: 30 * time.Second, pageCap: 10,
		capReleasesPage: 8 << 20, capChecksums: 64 << 10, capAsc: 16 << 10,
		capArchive: 64 << 20, capExtracted: 200 << 20,
		verifyBudget: 120 * time.Second, topN: 16,
		archiveIdleTO: 60 * time.Second, archiveOverallTO: 300 * time.Second,
		swapTarget: "/usr/local/bin/mathion",
	}
}
