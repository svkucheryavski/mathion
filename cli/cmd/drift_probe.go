package cmd

import "io"

// RunDriftProbe writes the precise compose-drift notice (spec §4.3a / §5) to w and
// returns. It is the body of the hidden `_drift-probe` fast-path invoked by the .deb
// postinstall: it reuses resolveCfgDir + the hardened maybeWarnComposeDrift, deliberately
// BYPASSING cobra's Execute() (no unbounded .env/TLS read, no App, no lock, no Runner) so
// it can never take a Docker/compose action and can never hang dpkg on the .env read.
// Advisory only — the caller always returns exit 0.
func RunDriftProbe(w io.Writer) {
	maybeWarnComposeDrift(w, resolveCfgDir())
}
