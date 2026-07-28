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
