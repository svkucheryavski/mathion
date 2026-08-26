package config

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// Env is an ordered list of key/value pairs rendered into a `.env` file. Order
// mirrors deploy/.env.prod.example so generated files read like the contract.
type Env []struct{ Key, Value string }

// GenerateEnv builds the production `.env` key/value set. POSTGRES_PASSWORD and
// the password embedded in MATHION_DATABASE_URL are the same hex string, so the
// database credentials stay coupled.
func GenerateEnv(baseURL, version, secretKey, pgPassword string) Env {
	dbURL := fmt.Sprintf("postgresql+psycopg://mathion:%s@db:5432/mathion", pgPassword)
	return Env{
		{"MATHION_SECRET_KEY", secretKey},
		{"POSTGRES_USER", "mathion"},
		{"POSTGRES_DB", "mathion"},
		{"POSTGRES_PASSWORD", pgPassword},
		{"MATHION_DATABASE_URL", dbURL},
		{"MATHION_BASE_URL", baseURL},
		{"MATHION_COOKIE_SECURE", "1"},
		{"MATHION_DEBUG", "0"},
		{"MATHION_EMAIL_MODE", "disabled"},
		{"MATHION_ASSET_PATH", "/data/mathion/assets"},
		{"MATHION_MAX_FILE_SIZE", "20971520"},
		{"MATHION_MAX_COURSE_SIZE", "524288000"},
		{"MATHION_VERSION", version},
		{"MATHION_TLS_DOMAIN", ""},
		{"MATHION_TLS_EMAIL", ""},
	}
}

// RenderEnv serializes an Env into `KEY=VALUE` lines, preserving order.
func RenderEnv(e Env) string {
	var b strings.Builder
	for _, kv := range e {
		fmt.Fprintf(&b, "%s=%s\n", kv.Key, kv.Value)
	}
	return b.String()
}

// ParseEnv reads `KEY=VALUE` lines into a map, ignoring blank lines and comments.
func ParseEnv(text string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

// envLineKey computes the key a `.env` line contributes, matching ParseEnv's
// per-line rule exactly (TrimSpace, skip blank/comment, Cut on '=', TrimSpace the
// key). A line that contributes no key returns "" — which never equals a real key
// name — so re-pin passes it through verbatim.
func envLineKey(line string) string {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return ""
	}
	k, _, ok := strings.Cut(line, "=")
	if !ok {
		return ""
	}
	return strings.TrimSpace(k)
}

// RepinVersion rewrites MATHION_VERSION in <cfgdir>/.env to newTag while
// preserving every unrelated line. It is line-oriented (not a full regenerate) so
// operator edits, comments, and extra keys survive an `update`/rollback re-pin.
// The tag is validated BEFORE any read or write — a hostile tag must never touch
// the file — and the whole file is re-validated AFTER the write so a re-pin can
// never leave a corrupt or mis-targeted `.env` behind. Error messages stay static
// or name only the key/tag role: the file carries the DB password and must never
// leak into an operator-visible error.
func RepinVersion(cfgdir, newTag string) error {
	// (1) Validate the tag first — reject a hostile tag before touching the file.
	if err := ValidateOCITag(newTag); err != nil {
		return err
	}
	// (2) Read the current `.env` raw so unrelated lines pass through verbatim.
	raw, err := os.ReadFile(cfgdir + "/.env")
	if err != nil {
		return fmt.Errorf("re-pin: read .env: %w", err)
	}
	// (3) Walk lines: emit the new value on the FIRST MATHION_VERSION match, drop
	// later exact matches, append if never seen, pass everything else through.
	lines := strings.Split(string(raw), "\n")
	out := make([]string, 0, len(lines)+1)
	seen := false
	for _, line := range lines {
		if envLineKey(line) == "MATHION_VERSION" {
			if seen {
				continue // collapse duplicates
			}
			out = append(out, "MATHION_VERSION="+newTag)
			seen = true
			continue
		}
		out = append(out, line)
	}
	if !seen {
		// Append. When the file ended with a newline, Split left a trailing "" —
		// insert the new line before it so we keep exactly one trailing newline and
		// never double a blank line.
		if n := len(out); n > 0 && out[n-1] == "" {
			out[n-1] = "MATHION_VERSION=" + newTag
			out = append(out, "")
		} else {
			out = append(out, "MATHION_VERSION="+newTag)
		}
	}
	// (4) Write atomically with the private mode the `.env` requires.
	if err := AtomicWrite(cfgdir+"/.env", []byte(strings.Join(out, "\n")), 0o600); err != nil {
		return fmt.Errorf("re-pin: write .env: %w", err)
	}
	// (5) Re-read and assert the re-pin took AND the whole file is still valid, so a
	// re-pin can never leave a corrupt or mis-targeted `.env`.
	m, err := ReadEnvFile(cfgdir)
	if err != nil {
		return fmt.Errorf("re-pin: re-read .env: %w", err)
	}
	if m["MATHION_VERSION"] != newTag {
		return fmt.Errorf("re-pin: MATHION_VERSION did not take effect")
	}
	if err := ValidateEnvComplete(m); err != nil {
		return fmt.Errorf("re-pin produced an invalid .env: %w", err)
	}
	return nil
}

// ReadEnvFile loads and parses the `.env` file in cfgdir.
func ReadEnvFile(cfgdir string) (map[string]string, error) {
	b, err := os.ReadFile(cfgdir + "/.env")
	if err != nil {
		return nil, err
	}
	return ParseEnv(string(b)), nil
}

// pgIdentRe matches a plain SQL identifier — the only shape POSTGRES_USER and
// POSTGRES_DB may take, so the values we pin MATHION_DATABASE_URL against cannot
// smuggle URL metacharacters (`@`, `/`, `?`, `%`, …) into the comparison.
var pgIdentRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ValidateEnvComplete checks a parsed `.env` carries the load-bearing keys and
// that the DB target stays pinned — MATHION_DATABASE_URL must address the bundled
// `db` service on 5432 with the exact POSTGRES_USER/PASSWORD/DB (see GenerateEnv),
// and MATHION_VERSION must be a legal image tag. A resume trusts an existing
// `.env` instead of regenerating it, so a half-written or hand-corrupted file
// must fail closed rather than boot a mis-credentialed or mis-targeted stack.
func ValidateEnvComplete(m map[string]string) error {
	for _, k := range []string{
		"MATHION_SECRET_KEY",
		"POSTGRES_USER",
		"POSTGRES_DB",
		"POSTGRES_PASSWORD",
		"MATHION_DATABASE_URL",
		"MATHION_BASE_URL",
		"MATHION_VERSION",
	} {
		if strings.TrimSpace(m[k]) == "" {
			return fmt.Errorf("missing required key %s", k)
		}
	}
	// POSTGRES_USER/POSTGRES_DB must be plain identifiers — they are the trusted
	// values the DB URL below is pinned against.
	for _, k := range []string{"POSTGRES_USER", "POSTGRES_DB"} {
		if !pgIdentRe.MatchString(m[k]) {
			return fmt.Errorf("%s is not a valid identifier", k)
		}
	}
	// MATHION_VERSION is interpolated into `image: ...:<tag>`; reject anything an
	// OCI tag may not contain (quotes, shell-expansion, whitespace) before it can
	// reach the compose file.
	if err := ValidateOCITag(m["MATHION_VERSION"]); err != nil {
		return fmt.Errorf("MATHION_VERSION is not a valid image tag")
	}
	// The DB URL is a compose-internal target, not an arbitrary DSN: reject
	// percent-encoding outright. GenerateEnv never emits it (the password is hex),
	// and url.Parse would otherwise decode `%61`→`a` and let a disguised host, db,
	// or userinfo slip past the exact-match component checks below.
	if strings.Contains(m["MATHION_DATABASE_URL"], "%") {
		return fmt.Errorf("MATHION_DATABASE_URL must not be percent-encoded")
	}
	u, err := url.Parse(m["MATHION_DATABASE_URL"])
	if err != nil {
		// Static message on purpose: *url.Error.Error() echoes the raw URL, which
		// carries the DB password — never wrap it into an operator-visible error.
		return fmt.Errorf("MATHION_DATABASE_URL is not a valid URL")
	}
	// Pin scheme/host/port to the bundled db service — a divergent host or port
	// a resumed deploy would silently trust must fail closed.
	if u.Scheme != "postgresql+psycopg" || u.Hostname() != "db" || u.Port() != "5432" {
		return fmt.Errorf("MATHION_DATABASE_URL does not target the bundled db service")
	}
	// Compare actual userinfo to POSTGRES_USER/PASSWORD — a substring match on the
	// raw string is spoofable (a decoy `mathion:<pw>@` in a query would pass while
	// the real credentials are wrong). Checked before the query guard so a mismatch
	// still surfaces as a coupling error.
	if u.User == nil {
		return fmt.Errorf("MATHION_DATABASE_URL is not coupled to POSTGRES_PASSWORD")
	}
	pw, hasPw := u.User.Password()
	if u.User.Username() != m["POSTGRES_USER"] || !hasPw || pw != m["POSTGRES_PASSWORD"] {
		return fmt.Errorf("MATHION_DATABASE_URL is not coupled to POSTGRES_PASSWORD")
	}
	// Go's url.Parse splits userinfo at the LAST '@', but SQLAlchemy/libpq split at
	// the FIRST — a password containing '@host' makes Go see host "db" while the
	// backend connects elsewhere. The canonical URL has exactly one '@' (hex
	// password). Checked after the coupling check so a wrong password still surfaces
	// as the "coupled" error (the pre-existing spoof case has a decoy '@' in a query).
	if strings.Count(m["MATHION_DATABASE_URL"], "@") != 1 {
		return fmt.Errorf("MATHION_DATABASE_URL must contain exactly one '@'")
	}
	// Path must be exactly the target database, with no query or fragment that
	// could redirect the connection (e.g. `?host=` / `?dbname=`).
	if u.EscapedPath() != "/"+m["POSTGRES_DB"] {
		return fmt.Errorf("MATHION_DATABASE_URL does not target the POSTGRES_DB database")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("MATHION_DATABASE_URL must not carry query or fragment parameters")
	}
	// Bundled-TLS pair invariant (spec §9): both empty (disabled) or both present and
	// valid. When present, run the SAME strict interpolation-safe validators the
	// `tls enable` input path uses, so a hand-edited .env that smuggled interpolation
	// syntax into a TLS value fails an update/resume closed; and the https posture
	// (base-url + secure cookie) must be coherent.
	tlsDomain := strings.TrimSpace(m["MATHION_TLS_DOMAIN"])
	tlsEmail := strings.TrimSpace(m["MATHION_TLS_EMAIL"])
	if (tlsDomain == "") != (tlsEmail == "") {
		return fmt.Errorf("MATHION_TLS_DOMAIN and MATHION_TLS_EMAIL must be both set or both empty")
	}
	if tlsDomain != "" {
		if err := ValidateDomain(tlsDomain); err != nil {
			return fmt.Errorf("MATHION_TLS_DOMAIN is invalid")
		}
		if err := ValidateTLSEmail(tlsEmail); err != nil {
			return fmt.Errorf("MATHION_TLS_EMAIL is invalid")
		}
		if m["MATHION_BASE_URL"] != "https://"+tlsDomain {
			return fmt.Errorf("MATHION_BASE_URL must equal https://<MATHION_TLS_DOMAIN> when TLS is enabled")
		}
		if strings.TrimSpace(m["MATHION_COOKIE_SECURE"]) != "1" {
			return fmt.Errorf("MATHION_COOKIE_SECURE must be 1 when TLS is enabled")
		}
	}
	return nil
}

// envUpdate is one key/value change for rewriteEnv.
type envUpdate struct{ Key, Value string }

// rewriteEnv applies each update to <cfgdir>/.env line-orientedly (like
// RepinVersion, but for multiple keys): the FIRST matching line is rewritten,
// later exact-key duplicates are dropped, keys never seen are appended (in the
// given order) before any trailing newline, and every other line passes through
// verbatim. It writes atomically at 0o600, then re-reads and asserts every update
// took AND the whole file still passes ValidateEnvComplete, so a rewrite can never
// leave a corrupt or inconsistent .env. Error messages never echo values.
func rewriteEnv(cfgdir string, updates []envUpdate) error {
	raw, err := os.ReadFile(cfgdir + "/.env")
	if err != nil {
		return fmt.Errorf("update .env: read: %w", err)
	}
	want := make(map[string]string, len(updates))
	for _, u := range updates {
		want[u.Key] = u.Value
	}
	lines := strings.Split(string(raw), "\n")
	out := make([]string, 0, len(lines)+len(updates))
	seen := map[string]bool{}
	for _, line := range lines {
		k := envLineKey(line)
		if v, ok := want[k]; ok {
			if seen[k] {
				continue // collapse duplicates
			}
			out = append(out, k+"="+v)
			seen[k] = true
			continue
		}
		out = append(out, line)
	}
	var missing []string
	for _, u := range updates {
		if !seen[u.Key] {
			missing = append(missing, u.Key+"="+u.Value)
		}
	}
	if len(missing) > 0 {
		if n := len(out); n > 0 && out[n-1] == "" {
			out = out[:n-1]
			out = append(out, missing...)
			out = append(out, "")
		} else {
			out = append(out, missing...)
		}
	}
	if err := AtomicWrite(cfgdir+"/.env", []byte(strings.Join(out, "\n")), 0o600); err != nil {
		return fmt.Errorf("update .env: write: %w", err)
	}
	m, err := ReadEnvFile(cfgdir)
	if err != nil {
		return fmt.Errorf("update .env: re-read: %w", err)
	}
	for _, u := range updates {
		if strings.TrimSpace(m[u.Key]) != strings.TrimSpace(u.Value) {
			return fmt.Errorf("update .env: %s did not take effect", u.Key)
		}
	}
	if err := ValidateEnvComplete(m); err != nil {
		return fmt.Errorf("update produced an invalid .env: %w", err)
	}
	return nil
}

// SetTLS enables bundled TLS: it writes MATHION_TLS_DOMAIN, MATHION_TLS_EMAIL,
// MATHION_BASE_URL (https://<domain>), and MATHION_COOKIE_SECURE=1, preserving every
// unrelated line. Inputs are validated with the strict interpolation-safe validators
// BEFORE any read or write, so a hostile value never touches the file.
func SetTLS(cfgdir, domain, email string) error {
	if err := ValidateDomain(domain); err != nil {
		return err
	}
	if err := ValidateTLSEmail(email); err != nil {
		return err
	}
	// ValidateDomain already rejected any ':'/port, so BuildBaseURL yields https://<domain>.
	baseURL, err := BuildBaseURL(domain)
	if err != nil {
		return err
	}
	return rewriteEnv(cfgdir, []envUpdate{
		{"MATHION_TLS_DOMAIN", domain},
		{"MATHION_TLS_EMAIL", email},
		{"MATHION_BASE_URL", baseURL},
		{"MATHION_COOKIE_SECURE", "1"},
	})
}

// ClearTLS disables bundled TLS: it clears MATHION_TLS_DOMAIN and MATHION_TLS_EMAIL
// and DELIBERATELY leaves MATHION_BASE_URL (https) and MATHION_COOKIE_SECURE=1 —
// production stays HTTPS-only; disable never downgrades.
func ClearTLS(cfgdir string) error {
	return rewriteEnv(cfgdir, []envUpdate{
		{"MATHION_TLS_DOMAIN", ""},
		{"MATHION_TLS_EMAIL", ""},
	})
}
