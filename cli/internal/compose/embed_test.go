package compose

import (
	"os"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestEmbeddedComposeMatchesRepoRoot(t *testing.T) {
	repo, err := os.ReadFile("../../../docker-compose.prod.yml")
	if err != nil {
		t.Fatal(err)
	}
	if string(ComposeYAML) != string(repo) {
		t.Fatal("embedded docker-compose.yml has drifted from repo-root docker-compose.prod.yml; re-copy it")
	}
}

// composeService is a minimal typed view of the fields Slice 5 must guarantee.
// env_file is a yaml.Node so we can assert PRESENCE/ABSENCE regardless of whether
// it is written as a string or a list — a substring match could not distinguish
// `env_file: secrets.env` or list syntax from real absence.
type composeService struct {
	Image       string            `yaml:"image"`
	Profiles    []string          `yaml:"profiles"`
	Networks    []string          `yaml:"networks"`
	EnvFile     yaml.Node         `yaml:"env_file"`
	Environment map[string]string `yaml:"environment"`
	Command     []string          `yaml:"command"`
	NetworkMode string            `yaml:"network_mode"`
	CapDrop     []string          `yaml:"cap_drop"`
	CapAdd      []string          `yaml:"cap_add"`
	SecurityOpt []string          `yaml:"security_opt"`
	User        string            `yaml:"user"`
	ReadOnly    bool              `yaml:"read_only"`
	Restart     string            `yaml:"restart"`
}

type composeFile struct {
	Services map[string]composeService `yaml:"services"`
	Networks map[string]yaml.Node      `yaml:"networks"`
	Volumes  map[string]yaml.Node      `yaml:"volumes"`
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// effectiveNetworks returns a service's networks, defaulting to {"default"} when it
// declares none (compose's implicit default network) — so the segmentation check
// below reasons about the ACTUAL network membership, not just the explicit list.
func effectiveNetworks(n []string) []string {
	if len(n) == 0 {
		return []string{"default"}
	}
	return n
}

// TestEmbeddedComposeTLSTopology parses the embedded compose and asserts the exact
// Slice-5 topology and hardening — a real regression tripwire (unlike a substring
// scan): it fails if db gains a shared network with the proxy, a service loses its
// tls profile, the proxy gains an env_file (in any syntax), a digest changes, or the
// proxy/proxy-init hardening is weakened.
func TestEmbeddedComposeTLSTopology(t *testing.T) {
	const (
		reproxyImg = "ghcr.io/umputun/reproxy@sha256:456d9d2ac7321e2bbb729a5580259d4fc6b52d0310c6cb79c1e30350dd6ba0f7"
		busyboxImg = "busybox@sha256:7a3ebe5bfd1a4a19797d20b0c0bb39d44393e9a03fd852c0865b0f540d868df0"
	)
	var cf composeFile
	if err := yaml.Unmarshal(ComposeYAML, &cf); err != nil {
		t.Fatalf("embedded compose is not valid YAML: %v", err)
	}

	app, ok := cf.Services["app"]
	if !ok {
		t.Fatal("missing service: app")
	}
	proxy, ok := cf.Services["proxy"]
	if !ok {
		t.Fatal("missing service: proxy")
	}
	proxyInit, ok := cf.Services["proxy-init"]
	if !ok {
		t.Fatal("missing service: proxy-init")
	}
	db, ok := cf.Services["db"]
	if !ok {
		t.Fatal("missing service: db")
	}

	// --- Pinned digests (exact) ---
	if proxy.Image != reproxyImg {
		t.Errorf("proxy image = %q, want %q", proxy.Image, reproxyImg)
	}
	if proxyInit.Image != busyboxImg {
		t.Errorf("proxy-init image = %q, want %q", proxyInit.Image, busyboxImg)
	}

	// --- Both TLS services are profile-gated (dormant by default) ---
	for name, svc := range map[string]composeService{"proxy": proxy, "proxy-init": proxyInit} {
		if len(svc.Profiles) != 1 || svc.Profiles[0] != "tls" {
			t.Errorf("%s profiles = %v, want [tls]", name, svc.Profiles)
		}
	}

	// --- Network segmentation (spec §4.4): proxy shares NO network with db ---
	if !(len(proxy.Networks) == 1 && proxy.Networks[0] == "frontend") {
		t.Errorf("proxy networks = %v, want [frontend] only", proxy.Networks)
	}
	if !contains(app.Networks, "default") || !contains(app.Networks, "frontend") {
		t.Errorf("app networks = %v, want both default and frontend", app.Networks)
	}
	for _, pn := range effectiveNetworks(proxy.Networks) {
		if contains(effectiveNetworks(db.Networks), pn) {
			t.Errorf("proxy and db must share NO network, but both are on %q (proxy=%v db=%v)", pn, proxy.Networks, db.Networks)
		}
	}

	// --- The proxy must carry NO env_file (no DB secret may reach it) ---
	if proxy.EnvFile.Kind != 0 {
		t.Error("proxy must not declare env_file (it would import the DB secrets)")
	}
	// Sanity: the app DOES declare env_file — proves the negative assertion is meaningful.
	if app.EnvFile.Kind == 0 {
		t.Error("app is expected to declare env_file: .env (guards the negative assertion above)")
	}

	// --- Proxy env: only the explicit SSL_*/STATIC_*/MAX_SIZE keys, exact values ---
	for k, want := range map[string]string{
		"SSL_TYPE":          "auto",
		"SSL_ACME_LOCATION": "/srv/acme",
		"STATIC_ENABLED":    "true",
		"STATIC_RULES":      "${MATHION_TLS_DOMAIN},/,http://app:8000/",
		"MAX_SIZE":          "25M",
	} {
		if proxy.Environment[k] != want {
			t.Errorf("proxy env %s = %q, want %q", k, proxy.Environment[k], want)
		}
	}
	for _, k := range []string{"SSL_ACME_EMAIL", "SSL_ACME_FQDN"} {
		if _, ok := proxy.Environment[k]; !ok {
			t.Errorf("proxy env missing %s", k)
		}
	}

	// --- Proxy hardening ---
	if !contains(proxy.CapDrop, "ALL") {
		t.Errorf("proxy cap_drop = %v, want to contain ALL", proxy.CapDrop)
	}
	if proxy.User != "1001:1001" {
		t.Errorf("proxy user = %q, want 1001:1001", proxy.User)
	}
	if !proxy.ReadOnly {
		t.Error("proxy must be read_only")
	}
	if !contains(proxy.SecurityOpt, "no-new-privileges:true") {
		t.Errorf("proxy security_opt = %v, want to contain no-new-privileges:true", proxy.SecurityOpt)
	}

	// --- proxy-init hardening: non-recursive chown, CHOWN-only, no network, no restart ---
	wantCmd := []string{"chown", "1001:1001", "/srv/acme"}
	if len(proxyInit.Command) != len(wantCmd) {
		t.Errorf("proxy-init command = %v, want %v", proxyInit.Command, wantCmd)
	} else {
		for i := range wantCmd {
			if proxyInit.Command[i] != wantCmd[i] {
				t.Errorf("proxy-init command = %v, want %v", proxyInit.Command, wantCmd)
				break
			}
		}
	}
	if proxyInit.NetworkMode != "none" {
		t.Errorf("proxy-init network_mode = %q, want none", proxyInit.NetworkMode)
	}
	if !contains(proxyInit.CapDrop, "ALL") {
		t.Errorf("proxy-init cap_drop = %v, want to contain ALL", proxyInit.CapDrop)
	}
	if !contains(proxyInit.CapAdd, "CHOWN") {
		t.Errorf("proxy-init cap_add = %v, want to contain CHOWN", proxyInit.CapAdd)
	}
	if !contains(proxyInit.SecurityOpt, "no-new-privileges:true") {
		t.Errorf("proxy-init security_opt = %v, want no-new-privileges:true", proxyInit.SecurityOpt)
	}
	if proxyInit.Restart != "no" {
		t.Errorf("proxy-init restart = %q, want %q", proxyInit.Restart, "no")
	}

	// --- Top-level frontend network + mathion_acme volume declared ---
	if _, ok := cf.Networks["frontend"]; !ok {
		t.Error("top-level networks must declare frontend")
	}
	if _, ok := cf.Volumes["mathion_acme"]; !ok {
		t.Error("top-level volumes must declare mathion_acme")
	}
}
