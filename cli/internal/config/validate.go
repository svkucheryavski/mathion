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

// dnsLabelRe matches a single DNS label: 1–63 chars of lowercase ASCII alnum, with
// internal (not leading/trailing) hyphens. The charset also rejects every
// dotenv/Compose interpolation metacharacter ($ { } " ' \), whitespace, and control
// char, so a validated label can never carry interpolation syntax.
var dnsLabelRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// ValidateDomain checks s is a proper, lowercase, public DNS hostname safe to
// interpolate into .env / a compose value: >=2 labels, each 1–63 chars, total <=253,
// no scheme/port/path, TLD not all-numeric (rejects IP literals), and — via the label
// charset — none of $ { } " ' \, whitespace, or control chars. Rejecting these at the
// input boundary is the load-bearing defense (spec §12) against a crafted domain
// expanding a secret into SSL_ACME_*.
func ValidateDomain(s string) error {
	if s == "" {
		return fmt.Errorf("domain is required")
	}
	if s != strings.ToLower(s) {
		return fmt.Errorf("domain must be lowercase: %q", s)
	}
	if len(s) > 253 {
		return fmt.Errorf("domain is too long (>253 chars)")
	}
	if strings.HasPrefix(s, ".") || strings.HasSuffix(s, ".") {
		return fmt.Errorf("domain must not start or end with a dot: %q", s)
	}
	labels := strings.Split(s, ".")
	if len(labels) < 2 {
		return fmt.Errorf("domain must be a fully-qualified name with at least two labels: %q", s)
	}
	for _, l := range labels {
		if len(l) < 1 || len(l) > 63 || !dnsLabelRe.MatchString(l) {
			return fmt.Errorf("domain has an invalid label %q in %q", l, s)
		}
	}
	tld := labels[len(labels)-1]
	if !strings.ContainsFunc(tld, func(r rune) bool { return r >= 'a' && r <= 'z' }) {
		return fmt.Errorf("domain's top-level label must contain a letter (not an IP literal): %q", s)
	}
	return nil
}

// hasInterpolationMeta reports whether s carries any dotenv/Compose interpolation
// metacharacter ($ { } " ' \), any Unicode control character (unicode.IsControl covers
// the C0, C1, and DEL ranges), or whitespace — none of which may appear in a value
// interpolated into .env / a compose environment. It does not delegate to
// hasCtrlOrSpace, which only catches C0/DEL and so would miss the C1 range
// (U+0080–U+009F).
func hasInterpolationMeta(s string) bool {
	for _, r := range s {
		switch r {
		case '$', '{', '}', '"', '\'', '\\':
			return true
		}
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return true
		}
	}
	return false
}

// ValidateTLSEmail validates the Let's Encrypt contact email that lands in
// .env → SSL_ACME_EMAIL. Interpolation-safe (spec §12): rejects $ { } " ' \,
// whitespace, and control chars anywhere; requires exactly one '@', a non-empty local
// part, and a domain part validated by ValidateDomain. Distinct from ValidateEmail
// (admin-email), which never reaches a compose-interpolated value.
func ValidateTLSEmail(s string) error {
	if s == "" {
		return fmt.Errorf("email is required")
	}
	if hasInterpolationMeta(s) {
		return fmt.Errorf("email contains interpolation-unsafe characters: %q", s)
	}
	local, domain, ok := strings.Cut(s, "@")
	if !ok || strings.Contains(domain, "@") {
		return fmt.Errorf("email must contain exactly one '@': %q", s)
	}
	if local == "" {
		return fmt.Errorf("email has an empty local part: %q", s)
	}
	if err := ValidateDomain(strings.ToLower(domain)); err != nil {
		return fmt.Errorf("email domain is invalid: %w", err)
	}
	return nil
}
