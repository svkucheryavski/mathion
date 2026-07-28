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
