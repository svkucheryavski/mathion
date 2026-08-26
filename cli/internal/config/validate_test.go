package config

import (
	"strings"
	"testing"
)

func TestBuildBaseURLAccept(t *testing.T) {
	for _, in := range []string{"learn.example.edu", "learn.example.edu:8443", "10.0.0.5:8000"} {
		got, err := BuildBaseURL(in)
		if err != nil {
			t.Errorf("BuildBaseURL(%q) unexpected err: %v", in, err)
			continue
		}
		if got != "https://"+in {
			t.Errorf("BuildBaseURL(%q) = %q, want https://%s", in, got, in)
		}
	}
}

func TestBuildBaseURLReject(t *testing.T) {
	bad := []string{
		"https://learn.example.edu",   // scheme typed into --domain
		"http://learn.example.edu",    // scheme typed in
		"user:pass@learn.example.edu", // userinfo
		"learn.example.edu:99999",     // out-of-range port
		"learn.example.edu:notaport",  // bad port
		"learn.example.edu/admin",     // path
		"learn.example.edu?x=1",       // query
		"learn.example.edu#frag",      // fragment
		"learn.example.edu ",          // whitespace
		"learn\texample.edu",          // control/whitespace
		":8000",                       // port with no host
		"",                            // empty host
	}
	for _, in := range bad {
		if _, err := BuildBaseURL(in); err == nil {
			t.Errorf("BuildBaseURL(%q) = nil err, want rejection", in)
		}
	}
}

func TestValidateEmail(t *testing.T) {
	for _, ok := range []string{"you@example.edu", "a.b+c@sub.example.com"} {
		if err := ValidateEmail(ok); err != nil {
			t.Errorf("ValidateEmail(%q) rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "noat", "a@b", "a @b.com", "a@b .com"} {
		if err := ValidateEmail(bad); err == nil {
			t.Errorf("ValidateEmail(%q) accepted, want reject", bad)
		}
	}
	if NormalizeEmail("  YOU@Example.EDU ") != "you@example.edu" {
		t.Errorf("NormalizeEmail did not trim+lowercase")
	}
}

func TestValidateOCITag(t *testing.T) {
	for _, ok := range []string{"v0.1.1", "latest", "sha-abc123", "1.2.3-rc.1"} {
		if err := ValidateOCITag(ok); err != nil {
			t.Errorf("ValidateOCITag(%q) rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "has space", "bad\ttab", ".startsdot", strings.Repeat("a", 200)} {
		if err := ValidateOCITag(bad); err == nil {
			t.Errorf("ValidateOCITag(%q) accepted, want reject", bad)
		}
	}
}

func TestValidateDomain(t *testing.T) {
	good := []string{"example.edu", "learn.example.edu", "a.b.c.example.com", "x-y.example.io"}
	for _, s := range good {
		if err := ValidateDomain(s); err != nil {
			t.Errorf("ValidateDomain(%q) = %v, want nil", s, err)
		}
	}
	bad := []string{
		"", "localhost", "example", // <2 labels
		"Example.edu",  // uppercase
		"a..b",         // empty label
		"-a.example",   // leading hyphen
		"a-.example",   // trailing hyphen
		".example.edu", // leading dot
		"example.edu.", // trailing dot
		"1.2.3.4",      // IPv4 literal (numeric TLD)
		"a b.example",  // whitespace
		"a$b.example",  // interpolation meta
		"${X}.example", // interpolation
		`a".example`,   // quote
	}
	for _, s := range bad {
		if err := ValidateDomain(s); err == nil {
			t.Errorf("ValidateDomain(%q) = nil, want error", s)
		}
	}
}

func TestValidateTLSEmail(t *testing.T) {
	good := []string{"admin@example.edu", "ops.team@learn.example.edu"}
	for _, s := range good {
		if err := ValidateTLSEmail(s); err != nil {
			t.Errorf("ValidateTLSEmail(%q) = %v, want nil", s, err)
		}
	}
	// The load-bearing case: an interpolation payload must be rejected at input.
	bad := []string{
		"", "no-at-sign", "a@@b.com", "@example.edu", "admin@localhost",
		"${POSTGRES_PASSWORD}@x.y", // the DB-password leak payload
		"a$b@example.edu",
		`a"@example.edu`,
		"a b@example.edu", // whitespace
		"admin@ex ample.edu",
		"a@example.edu",    // C1 control (the bypass)
		"a\x00@example.edu", // NUL (C0)
		"a\nb@example.edu",  // newline
	}
	for _, s := range bad {
		if err := ValidateTLSEmail(s); err == nil {
			t.Errorf("ValidateTLSEmail(%q) = nil, want error", s)
		}
	}
}
