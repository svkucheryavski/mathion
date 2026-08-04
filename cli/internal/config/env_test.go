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
	// Malformed URL → fail closed.
	bad := ParseEnv(RenderEnv(gen()))
	bad["MATHION_DATABASE_URL"] = "://not a url"
	if err := ValidateEnvComplete(bad); err == nil {
		t.Errorf("a malformed DB URL must fail closed, got nil")
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
