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
//
// DependsOn is a raw nested map (service → nested-key → node) rather than a typed
// {condition} struct: a typed struct would silently ignore extra nested keys, so a
// `required: false` alongside `condition:` would make the dependency optional while
// every check still passed. The raw form lets the assertions fail closed on ANY
// nested key other than `condition` (the same discipline as the top-level allowlist).
type composeService struct {
	Image       string                          `yaml:"image"`
	Profiles    []string                        `yaml:"profiles"`
	Networks    []string                        `yaml:"networks"`
	NetworkMode string                          `yaml:"network_mode"`
	EnvFile     yaml.Node                       `yaml:"env_file"`
	Environment map[string]string               `yaml:"environment"`
	Command     []string                        `yaml:"command"`
	Volumes     []string                        `yaml:"volumes"`
	Ports       []string                        `yaml:"ports"`
	Tmpfs       []string                        `yaml:"tmpfs"`
	DependsOn   map[string]map[string]yaml.Node `yaml:"depends_on"`
	CapDrop     []string                        `yaml:"cap_drop"`
	CapAdd      []string                        `yaml:"cap_add"`
	SecurityOpt []string                        `yaml:"security_opt"`
	User        string                          `yaml:"user"`
	ReadOnly    bool                            `yaml:"read_only"`
	Restart     string                          `yaml:"restart"`
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
	// Exact membership (not just containment): an ADDITIVE network on app or db must
	// trip this tripwire, so a future edit cannot quietly widen connectivity.
	if appNets := effectiveNetworks(app.Networks); !(len(appNets) == 2 && contains(appNets, "default") && contains(appNets, "frontend")) {
		t.Errorf("app networks = %v, want EXACTLY [default frontend]", appNets)
	}
	if dbNets := effectiveNetworks(db.Networks); !(len(dbNets) == 1 && dbNets[0] == "default") {
		t.Errorf("db networks = %v, want EXACTLY [default]", dbNets)
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

	// --- Proxy env: EXACTLY these 7 keys, each with its EXACT value. The email/domain
	// come only from ${MATHION_TLS_EMAIL}/${MATHION_TLS_DOMAIN}: asserting the exact
	// interpolation token (not mere presence) is what stops a DB secret from being piped
	// into the proxy env via e.g. `SSL_ACME_EMAIL: ${POSTGRES_PASSWORD}`. ---
	for k, want := range map[string]string{
		"SSL_TYPE":          "auto",
		"SSL_ACME_EMAIL":    "${MATHION_TLS_EMAIL}",
		"SSL_ACME_FQDN":     "${MATHION_TLS_DOMAIN}",
		"SSL_ACME_LOCATION": "/srv/acme",
		"STATIC_ENABLED":    "true",
		"STATIC_RULES":      "${MATHION_TLS_DOMAIN},/,http://app:8000/",
		"MAX_SIZE":          "25M",
	} {
		if proxy.Environment[k] != want {
			t.Errorf("proxy env %s = %q, want %q", k, proxy.Environment[k], want)
		}
	}
	// Exactly these 7 keys — an injected extra (e.g. another SSL_* var) could alter
	// proxy behavior and must trip the wire.
	if len(proxy.Environment) != 7 {
		t.Errorf("proxy has %d env keys, want exactly 7; extra keys are a red flag: %v", len(proxy.Environment), proxy.Environment)
	}

	// --- HSTS: reproxy has no env binding for --header, so it is passed as a command
	// arg (verified against the pinned image; it lands on client responses). Assert the
	// EXACT flag so a removal or weakening (shorter max-age, dropped directive) trips the
	// wire. Living on this tls-profile-only service, HSTS is emitted only when the bundled
	// proxy terminates HTTPS. ---
	if !slices.Equal(proxy.Command, []string{"--header=Strict-Transport-Security:max-age=31536000"}) {
		t.Errorf("proxy command = %v, want exactly [--header=Strict-Transport-Security:max-age=31536000]", proxy.Command)
	}

	// --- Proxy publishes EXACTLY 80/443 (the only ports an internet TLS terminator
	// needs) — an extra published port would widen the host exposure surface. ---
	if !slices.Equal(proxy.Ports, []string{"80:8080", "443:8443"}) {
		t.Errorf("proxy ports = %v, want exactly [80:8080 443:8443]", proxy.Ports)
	}
	// --- tmpfs is the ONLY writable surface on the read_only proxy; pin it to /tmp so a
	// writable mount over a sensitive path (e.g. /etc:mode=1777) cannot weaken read_only. ---
	if !slices.Equal(proxy.Tmpfs, []string{"/tmp"}) {
		t.Errorf("proxy tmpfs = %v, want exactly [/tmp]", proxy.Tmpfs)
	}
	// --- depends_on gates startup: proxy waits for app healthy AND the proxy-init chown
	// to complete (so the acme volume is 1001-owned before the non-root proxy writes to it). ---
	wantDeps := map[string]string{
		"app":        "service_healthy",
		"proxy-init": "service_completed_successfully",
	}
	if len(proxy.DependsOn) != len(wantDeps) {
		t.Errorf("proxy depends_on services = %v, want %v", proxy.DependsOn, wantDeps)
	}
	for svc, cond := range wantDeps {
		dep := proxy.DependsOn[svc]
		// Exactly one nested key, `condition`: a second key such as `required: false`
		// would silently make the dependency optional and un-gate startup ordering.
		if len(dep) != 1 {
			t.Errorf("proxy depends_on[%s] has %d nested keys, want exactly 1 (condition); an extra key like required:false would weaken the startup gate: %v", svc, len(dep), dep)
		}
		if dep["condition"].Value != cond {
			t.Errorf("proxy depends_on[%s].condition = %q, want %q", svc, dep["condition"].Value, cond)
		}
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

	// --- Each TLS service mounts EXACTLY the acme volume: the exact-match makes a stray
	// second bind-mount (e.g. the docker socket) fail even though `volumes` is allowed. ---
	for name, svc := range map[string]composeService{"proxy": proxy, "proxy-init": proxyInit} {
		if !slices.Equal(svc.Volumes, []string{"mathion_acme:/srv/acme"}) {
			t.Errorf("%s volumes = %v, want exactly [mathion_acme:/srv/acme] (a stray bind-mount such as the docker socket would be a host escape)", name, svc.Volumes)
		}
	}

	// --- Fail closed on ANY unmodeled compose key on the two internet-adjacent TLS
	// containers. The typed assertions above validate the VALUES of expected keys, but a
	// single unmodeled line can re-grant privilege while every typed check still passes:
	// privileged, use_api_socket, volumes_from, devices, device_cgroup_rules, sysctls,
	// group_add, cgroup, pid/ipc/userns_mode host-shares, ... Blocklisting that open-ended
	// set never ends; instead require every key on proxy/proxy-init to be in a reviewed
	// allowlist, so a NEW key trips the wire and must be consciously vetted as safe here
	// before being added. (Removal of a critical key is caught by the value assertions
	// above; the small overlap with those checks is deliberate defense-in-depth.) ---
	var raw struct {
		Services map[string]map[string]yaml.Node `yaml:"services"`
	}
	if err := yaml.Unmarshal(ComposeYAML, &raw); err != nil {
		t.Fatalf("embedded compose is not valid YAML: %v", err)
	}
	proxyAllowedKeys := map[string]bool{
		"image": true, "profiles": true, "depends_on": true, "ports": true,
		"environment": true, "command": true, "volumes": true, "networks": true,
		"user": true, "cap_drop": true, "security_opt": true, "read_only": true,
		"tmpfs": true, "restart": true,
	}
	proxyInitAllowedKeys := map[string]bool{
		"image": true, "profiles": true, "command": true, "volumes": true,
		"network_mode": true, "cap_drop": true, "cap_add": true,
		"security_opt": true, "restart": true,
	}
	for svc, allowed := range map[string]map[string]bool{"proxy": proxyAllowedKeys, "proxy-init": proxyInitAllowedKeys} {
		keys, ok := raw.Services[svc]
		if !ok {
			t.Errorf("raw parse missing service %q", svc)
			continue
		}
		for k := range keys {
			if !allowed[k] {
				t.Errorf("%s carries unreviewed compose key %q — a hardening escape must not slip in unmodeled; if the key is legitimate, add it to the allowlist after reviewing it is safe on an internet-adjacent least-privilege container", svc, k)
			}
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
