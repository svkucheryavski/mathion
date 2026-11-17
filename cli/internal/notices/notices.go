// Package notices embeds the license texts of the code built into the mathion binary.
package notices

import _ "embed"

// Text is the third-party license notices, one "===== <module> =====" section per module.
//
//go:embed THIRD_PARTY_NOTICES
var Text string
