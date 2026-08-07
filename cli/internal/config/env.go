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
	return nil
}
