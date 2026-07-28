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
