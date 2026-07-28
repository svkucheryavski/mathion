package config

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
)

func hasCtrlOrSpace(s string) bool {
	for _, r := range s {
		if r < 0x20 || r == 0x7f || unicode.IsSpace(r) {
			return true
		}
	}
	return false
}

// BuildBaseURL takes an authority (host[:port], no scheme), constructs
// https://<authority>, and validates it against backend config.py rules.
func BuildBaseURL(domain string) (string, error) {
	if hasCtrlOrSpace(domain) {
		return "", fmt.Errorf("--domain contains control or whitespace characters: %q", domain)
	}
	if strings.Contains(domain, "://") {
		return "", fmt.Errorf("--domain must be a host[:port] authority, not a URL with a scheme: %q", domain)
	}
	raw := "https://" + domain
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("--domain is not a valid host: %q (%v)", domain, err)
	}
	if u.Hostname() == "" {
		return "", fmt.Errorf("--domain missing host: %q", domain)
	}
	if u.User != nil {
		return "", fmt.Errorf("--domain must not contain userinfo (user:pass@): %q", domain)
	}
	if p := u.Port(); p != "" {
		if _, err := parsePort(p); err != nil {
			return "", fmt.Errorf("--domain has invalid port: %q", domain)
		}
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("--domain must not include a path: %q", domain)
	}
	if u.RawQuery != "" {
		return "", fmt.Errorf("--domain must not include a query string: %q", domain)
	}
	if u.Fragment != "" {
		return "", fmt.Errorf("--domain must not include a fragment: %q", domain)
	}
	return raw, nil
}

func parsePort(p string) (int, error) {
	var n int
	if _, err := fmt.Sscanf(p, "%d", &n); err != nil {
		return 0, err
	}
	if n < 1 || n > 65535 {
		return 0, fmt.Errorf("port out of range")
	}
	return n, nil
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func NormalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func ValidateEmail(s string) error {
	s = NormalizeEmail(s)
	if !emailRe.MatchString(s) {
		return fmt.Errorf("invalid email address: %q", s)
	}
	return nil
}

var ociTagRe = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$`)

func ValidateOCITag(s string) error {
	if !ociTagRe.MatchString(s) {
		return fmt.Errorf("invalid image tag: %q", s)
	}
	return nil
}
