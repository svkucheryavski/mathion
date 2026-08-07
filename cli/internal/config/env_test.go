package config

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func gen() Env {
	return GenerateEnv("https://learn.example.edu", "v0.1.1", "SECRET==", "abc123hex")
}

func TestEnvFixedValues(t *testing.T) {
	m := ParseEnv(RenderEnv(gen()))
	fixed := map[string]string{
		"POSTGRES_USER": "mathion", "POSTGRES_DB": "mathion",
		"MATHION_COOKIE_SECURE": "1", "MATHION_DEBUG": "0",
		"MATHION_EMAIL_MODE":    "disabled",
		"MATHION_ASSET_PATH":    "/data/mathion/assets",
		"MATHION_MAX_FILE_SIZE": "20971520", "MATHION_MAX_COURSE_SIZE": "524288000",
	}
	for k, v := range fixed {
		if m[k] != v {
			t.Errorf("%s = %q, want %q", k, m[k], v)
		}
	}
}

func TestEnvPasswordCoupling(t *testing.T) {
	m := ParseEnv(RenderEnv(gen()))
	if m["POSTGRES_PASSWORD"] != "abc123hex" {
		t.Fatalf("POSTGRES_PASSWORD=%q", m["POSTGRES_PASSWORD"])
	}
	if m["MATHION_DATABASE_URL"] != "postgresql+psycopg://mathion:abc123hex@db:5432/mathion" {
		t.Fatalf("DB URL = %q", m["MATHION_DATABASE_URL"])
	}
	if m["MATHION_BASE_URL"] != "https://learn.example.edu" {
		t.Fatalf("BASE_URL = %q", m["MATHION_BASE_URL"])
	}
	if m["MATHION_VERSION"] != "v0.1.1" {
		t.Fatalf("VERSION = %q", m["MATHION_VERSION"])
	}
}

// exampleKeys parses the committed contract, ignoring comments/blanks.
func exampleKeys(t *testing.T) map[string]string {
	f, err := os.Open("../../../deploy/.env.prod.example")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		// strip trailing inline comments from the example's documented values
		v = strings.TrimSpace(strings.SplitN(v, "#", 2)[0])
		out[strings.TrimSpace(k)] = v
	}
	return out
}

func TestValidateEnvComplete(t *testing.T) {
	// A freshly generated .env is complete and coupled.
	good := ParseEnv(RenderEnv(gen()))
	if err := ValidateEnvComplete(good); err != nil {
		t.Fatalf("a generated .env must validate, got %v", err)
	}
	// Each required key missing → error naming that key.
	for _, k := range []string{"MATHION_SECRET_KEY", "POSTGRES_PASSWORD", "MATHION_DATABASE_URL", "MATHION_BASE_URL", "MATHION_VERSION"} {
		m := ParseEnv(RenderEnv(gen()))
		delete(m, k)
		if err := ValidateEnvComplete(m); err == nil || !strings.Contains(err.Error(), k) {
			t.Errorf("missing %s must fail closed, got %v", k, err)
		}
	}
	// Decoupled DB password (URL no longer carries POSTGRES_PASSWORD) → error.
	dec := ParseEnv(RenderEnv(gen()))
	dec["POSTGRES_PASSWORD"] = "rotated-but-url-not-updated"
	if err := ValidateEnvComplete(dec); err == nil || !strings.Contains(err.Error(), "coupled") {
		t.Errorf("decoupled DB password must fail closed, got %v", err)
	}
	// Spoof: the real userinfo password is wrong, but a decoy `mathion:<pw>@` sits
	// in a query string. A substring check would accept it; parsing userinfo rejects.
	spoof := ParseEnv(RenderEnv(gen()))
	spoof["POSTGRES_PASSWORD"] = "expected"
	spoof["MATHION_DATABASE_URL"] = "postgresql+psycopg://mathion:wrong@db:5432/mathion?x=mathion:expected@"
	if err := ValidateEnvComplete(spoof); err == nil || !strings.Contains(err.Error(), "coupled") {
		t.Errorf("a decoy substring must not satisfy the coupling check, got %v", err)
	}
	// Malformed URL → fail closed, and the error must NOT echo the URL: a raw
	// url.Parse error carries the whole URL, DB password included.
	bad := ParseEnv(RenderEnv(gen()))
	bad["MATHION_DATABASE_URL"] = "postgresql+psycopg://mathion:" + bad["POSTGRES_PASSWORD"] + "@db:5432/mathion\x7f" // control char → parse error
	if err := ValidateEnvComplete(bad); err == nil {
		t.Errorf("a malformed DB URL must fail closed, got nil")
	} else if strings.Contains(err.Error(), bad["POSTGRES_PASSWORD"]) {
		t.Errorf("malformed-URL error must not leak the DB password: %q", err)
	}
}

func TestValidateEnvCompleteStrengthened(t *testing.T) {
	good := ParseEnv(RenderEnv(GenerateEnv("https://x", "v0.1.1", "sk", "pw")))
	if err := ValidateEnvComplete(good); err != nil {
		t.Fatalf("GenerateEnv output must pass: %v", err)
	}
	base := func() map[string]string {
		m := map[string]string{}
		for k, v := range good {
			m[k] = v
		}
		return m
	}
	reject := map[string]string{
		"divergent host": "postgresql+psycopg://mathion:pw@remote:5432/mathion",
		"wrong port":     "postgresql+psycopg://mathion:pw@db:5433/mathion",
		"query dbname":   "postgresql+psycopg://mathion:pw@db:5432/mathion?dbname=other",
		"query host":     "postgresql+psycopg://mathion:pw@db:5432/mathion?host=evil",
		"raw pct db":     "postgresql+psycopg://mathion:pw@db:5432/m%61thion",
		"raw pct db2":    "postgresql+psycopg://mathion:pw@db:5432/%6Dathion",
		"trailing pct":   "postgresql+psycopg://mathion:pw@db:5432/mathion%2F",
		"pct userinfo":   "postgresql+psycopg://m%61thion:pw@db:5432/mathion",
		"wrong scheme":   "postgresql://mathion:pw@db:5432/mathion",
	}
	for name, url := range reject {
		m := base()
		m["MATHION_DATABASE_URL"] = url
		if err := ValidateEnvComplete(m); err == nil {
			t.Errorf("%s: expected rejection, got nil", name)
		}
	}
	// round-10 #2: MATHION_VERSION must pass ValidateOCITag.
	for _, bad := range []string{`"v0.1.1"`, "${X:-v0.1.1}", "v 0.1.1"} {
		m := base()
		m["MATHION_VERSION"] = bad
		if err := ValidateEnvComplete(m); err == nil {
			t.Errorf("MATHION_VERSION=%q must be rejected", bad)
		}
	}
	// missing POSTGRES_USER / POSTGRES_DB, and non-identifier values.
	for _, k := range []string{"POSTGRES_USER", "POSTGRES_DB"} {
		m := base()
		delete(m, k)
		if err := ValidateEnvComplete(m); err == nil {
			t.Errorf("missing %s must be rejected", k)
		}
		m2 := base()
		m2[k] = "bad-name!"
		if err := ValidateEnvComplete(m2); err == nil {
			t.Errorf("non-identifier %s must be rejected", k)
		}
	}
	// Parser differential: Go splits userinfo at the last '@', SQLAlchemy/libpq at
	// the first. Coupling passes (password matches POSTGRES_PASSWORD), so the
	// multi-'@' guard must reject.
	adv := base()
	adv["POSTGRES_PASSWORD"] = "pw@evil.example,db"
	adv["MATHION_DATABASE_URL"] = "postgresql+psycopg://mathion:pw@evil.example,db@db:5432/mathion"
	if err := ValidateEnvComplete(adv); err == nil {
		t.Errorf("multi-@ userinfo differential must be rejected")
	}
}

func TestEnvKeyParityWithExample(t *testing.T) {
	gen := ParseEnv(RenderEnv(gen()))
	for k := range exampleKeys(t) {
		if _, ok := gen[k]; !ok {
			t.Errorf("generated .env missing key present in example: %s", k)
		}
	}
	for k := range gen {
		if _, ok := exampleKeys(t)[k]; !ok {
			t.Errorf("generated .env has key absent from example: %s", k)
		}
	}
}
