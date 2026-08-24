package compose

import (
	"os"
	"slices"
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
	NetworkMode string            `yaml:"network_mode"`
	EnvFile     yaml.Node         `yaml:"env_file"`
	Environment map[string]string `yaml:"environment"`
	Command     []string          `yaml:"command"`
	Volumes     []string          `yaml:"volumes"`
	CapDrop     []string          `yaml:"cap_drop"`
	CapAdd      []string          `yaml:"cap_add"`
	SecurityOpt []string          `yaml:"security_opt"`
	Privileged  bool              `yaml:"privileged"`
	Pid         string            `yaml:"pid"`
	Ipc         string            `yaml:"ipc"`
	UsernsMode  string            `yaml:"userns_mode"`
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
// scan). Hardening is asserted with EXACT matches (not `contains`) so ADDED privileges
// (an extra cap_add, an unconfined security_opt, a network_mode namespace-share) are
// caught, not just removals: for an internet-facing proxy, defense-in-depth must fail
// closed on additive weakening too.
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
	// A network_mode: service:<x> / container:<x> would share another container's
	// network namespace, bypassing the networks-based segmentation above. proxy and db
	// must NOT use one (proxy-init legitimately uses network_mode: none, asserted below).
	if db.NetworkMode != "" {
		t.Errorf("db network_mode = %q, want empty (a shared namespace would bypass network segmentation)", db.NetworkMode)
	}
	if proxy.NetworkMode != "" {
		t.Errorf("proxy network_mode = %q, want empty (it must use networks:[frontend], not another container's namespace)", proxy.NetworkMode)
	}

	// --- The proxy must carry NO env_file (no DB secret may reach it) ---
	if proxy.EnvFile.Kind != 0 {
		t.Error("proxy must not declare env_file (it would import the DB secrets)")
	}
	// Sanity: the app DOES declare env_file — proves the negative assertion is meaningful.
	if app.EnvFile.Kind == 0 {
		t.Error("app is expected to declare env_file: .env (guards the negative assertion above)")
	}

	// --- Proxy env: EXACTLY the explicit SSL_*/STATIC_*/MAX_SIZE keys ---
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
	// Exactly these 7 keys — an injected extra (e.g. another SSL_* var) could alter
	// proxy behavior and must trip the wire.
	if len(proxy.Environment) != 7 {
		t.Errorf("proxy has %d env keys, want exactly 7; extra keys are a red flag: %v", len(proxy.Environment), proxy.Environment)
	}

	// --- Proxy hardening (EXACT, so added privileges are caught, not just removed) ---
	if !slices.Equal(proxy.CapDrop, []string{"ALL"}) {
		t.Errorf("proxy cap_drop = %v, want exactly [ALL]", proxy.CapDrop)
	}
	if len(proxy.CapAdd) != 0 {
		t.Errorf("proxy cap_add = %v, want none (the internet-facing proxy needs no added capability)", proxy.CapAdd)
	}
	if !slices.Equal(proxy.SecurityOpt, []string{"no-new-privileges:true"}) {
		t.Errorf("proxy security_opt = %v, want exactly [no-new-privileges:true]", proxy.SecurityOpt)
	}
	if proxy.User != "1001:1001" {
		t.Errorf("proxy user = %q, want 1001:1001", proxy.User)
	}
	if !proxy.ReadOnly {
		t.Error("proxy must be read_only")
	}
	if proxy.Restart != "unless-stopped" {
		t.Errorf("proxy restart = %q, want unless-stopped", proxy.Restart)
	}

	// --- proxy-init hardening (EXACT): non-recursive chown, CHOWN-ONLY, no network ---
	wantCmd := []string{"chown", "1001:1001", "/srv/acme"}
	if !slices.Equal(proxyInit.Command, wantCmd) {
		t.Errorf("proxy-init command = %v, want %v", proxyInit.Command, wantCmd)
	}
	if proxyInit.NetworkMode != "none" {
		t.Errorf("proxy-init network_mode = %q, want none", proxyInit.NetworkMode)
	}
	if !slices.Equal(proxyInit.CapDrop, []string{"ALL"}) {
		t.Errorf("proxy-init cap_drop = %v, want exactly [ALL]", proxyInit.CapDrop)
	}
	if !slices.Equal(proxyInit.CapAdd, []string{"CHOWN"}) {
		t.Errorf("proxy-init cap_add = %v, want exactly [CHOWN] (CHOWN-only)", proxyInit.CapAdd)
	}
	if !slices.Equal(proxyInit.SecurityOpt, []string{"no-new-privileges:true"}) {
		t.Errorf("proxy-init security_opt = %v, want exactly [no-new-privileges:true]", proxyInit.SecurityOpt)
	}
	if proxyInit.Restart != "no" {
		t.Errorf("proxy-init restart = %q, want %q", proxyInit.Restart, "no")
	}

	// --- No privilege- or namespace-escape on EITHER TLS container. cap_drop:[ALL]
	// is worthless if a single line re-grants everything: privileged:true restores all
	// capabilities; a host pid/ipc namespace or userns share breaks isolation; and a
	// stray bind-mount (e.g. the docker socket) is a direct host escape. Assert the
	// exact minimal volume set so only the acme volume is mounted. ---
	for name, svc := range map[string]composeService{"proxy": proxy, "proxy-init": proxyInit} {
		if svc.Privileged {
			t.Errorf("%s must not set privileged:true (it re-grants every capability, voiding cap_drop:[ALL])", name)
		}
		if svc.Pid != "" || svc.Ipc != "" || svc.UsernsMode != "" {
			t.Errorf("%s must not share a host/other namespace (pid=%q ipc=%q userns_mode=%q)", name, svc.Pid, svc.Ipc, svc.UsernsMode)
		}
		if !slices.Equal(svc.Volumes, []string{"mathion_acme:/srv/acme"}) {
			t.Errorf("%s volumes = %v, want exactly [mathion_acme:/srv/acme] (a stray bind-mount such as the docker socket would be a host escape)", name, svc.Volumes)
		}
	}

	// --- Top-level frontend network + mathion_acme volume declared ---
	if _, ok := cf.Networks["frontend"]; !ok {
		t.Error("top-level networks must declare frontend")
	}
	if _, ok := cf.Volumes["mathion_acme"]; !ok {
		t.Error("top-level volumes must declare mathion_acme")
	}
}
