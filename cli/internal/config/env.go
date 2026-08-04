package config

import (
	"fmt"
	"os"
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

// ValidateEnvComplete checks a parsed `.env` carries the load-bearing keys and
// that the DB credentials stay coupled — the password inside MATHION_DATABASE_URL
// must equal POSTGRES_PASSWORD (see GenerateEnv). A resume trusts an existing
// `.env` instead of regenerating it, so a half-written or hand-corrupted file
// must fail closed rather than boot a mis-credentialed stack.
func ValidateEnvComplete(m map[string]string) error {
	for _, k := range []string{
		"MATHION_SECRET_KEY",
		"POSTGRES_PASSWORD",
		"MATHION_DATABASE_URL",
		"MATHION_BASE_URL",
		"MATHION_VERSION",
	} {
		if strings.TrimSpace(m[k]) == "" {
			return fmt.Errorf("missing required key %s", k)
		}
	}
	if pw := m["POSTGRES_PASSWORD"]; !strings.Contains(m["MATHION_DATABASE_URL"], "mathion:"+pw+"@") {
		return fmt.Errorf("MATHION_DATABASE_URL is not coupled to POSTGRES_PASSWORD")
	}
	return nil
}
