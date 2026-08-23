# Phase 9-D Slice 5 — Bundled auto-TLS reverse proxy (`mathion tls`)

**Status:** Design — pending dual-gate review (independent reviewer + codex) and user approval
**Date:** 2026-08-23
**Phase:** 9-D (Deployment), Slice 5
**Depends on:** Slices 1–4b (prod image, compose, `mathion` CLI, signed releases) — all shipped.

---

## 1. Goal

Give self-hosters a **one-command, opt-in path to HTTPS** — `mathion tls enable --domain <fqdn> --email <addr>` — that stands up a bundled reverse proxy which obtains and auto-renews a Let's Encrypt certificate, with **zero certificate files to manage**. Operators who prefer their own external proxy keep today's path unchanged.

## 2. Background — current deployment state

Facts that constrain this design (verified against the repo, 2026-08-23):

- **One image, one origin.** A single uvicorn process serves both the API and the Svelte SPA on port 8000. The frontend uses only **relative URLs**, so a same-origin reverse proxy needs **no frontend rebuild**.
- **App is published loopback-only:** `docker-compose.prod.yml` publishes `127.0.0.1:8000:8000`. Inside the container uvicorn listens on `0.0.0.0:8000`. A **containerized** proxy therefore cannot reach the app via host loopback — it must join the compose network and target `app:8000` by service name.
- **No proxy exists in the stack.** Slice 1 explicitly deferred "bundled auto-HTTPS" to "a later slice" — this one. Today's docs tell operators to run their **own** external proxy; that path must remain intact.
- **The app already assumes it is externally HTTPS.** The CLI always builds `MATHION_BASE_URL=https://<domain>`; the prod `.env` sets `MATHION_COOKIE_SECURE=1`; the session cookie's `Secure` flag is gated purely on `MATHION_COOKIE_SECURE` (`backend/mathion/api/auth.py`). The app internally speaks plain HTTP and **consumes nothing from `X-Forwarded-*`**.
- **Two copies of the prod compose file must stay byte-identical:** the root `docker-compose.prod.yml` and the CLI-embedded `cli/internal/compose/docker-compose.yml` (guarded by a sync test). Any service added here must be added to both.
- **The compose child-env is curated by the Runner** (`cli/internal/compose/runner.go`), which strips `MATHION_VERSION` and `POSTGRES_*` so host env can't poison the image tag or DB creds. New proxy config must flow through `.env`, not ambient host env.

## 3. Scope

### In scope
- A bundled, **opt-in** reverse proxy (reproxy) added to the prod stack, dormant unless enabled.
- Automatic Let's Encrypt certificate issuance + auto-renewal for **one public domain**.
- A `mathion tls` command group: `enable`, `disable`, `status`.
- The coordinated `.env` state change that "HTTPS on" implies.

### Non-goals (explicitly out)
- **Bring-your-own-cert** (operator-supplied cert/key files). Deferred.
- **LAN / no-public-domain / self-signed** issuance. Deferred.
- **Path-prefix / sub-path mounting** (`https://host/mathion`). The `base_url` validator already rejects it; unchanged here.
- **Plain HTTP in production.** Production is HTTPS-only, by construction. Local development keeps plain HTTP through the existing dev workflow (dev compose / running the backend directly); this feature does not touch that.
- **Multiple domains / SANs, wildcard, DNS-01 challenges.** Single-domain HTTP-01 only.
- **Backend code changes.** None (see §7).

## 4. Key decisions

### 4.1 Proxy = reproxy
`ghcr.io/umputun/reproxy`, pinned by digest. Rationale over Caddy (the main alternative):
- **Zero config files.** reproxy is configured entirely by environment variables, so the whole proxy config lives in the compose service block sourced from `.env` — nothing new to embed, write to `/etc/mathion`, mount, or keep in sync beyond the service block. Caddy would require shipping and syncing a Caddyfile as a third artifact.
- **Ecosystem consistency.** reproxy is already the proxy our external-proxy documentation recommends; bundling it means one proxy across the bundled and external stories.
- Caddy's genuine edges — the most battle-tested ACME client (CertMagic) and an official Docker Library image — are **marginal at single-domain scale** and do not outweigh the simplicity and consistency reproxy buys here.

**Rejected:** Traefik (label-routing overkill for one upstream); nginx + certbot (two components + cron renewal); a `docker-compose.tls.yml` overlay file (forces conditional `-f` juggling into the CLI's single centralized `composeArgs`, plus a second file to sync); generating the proxy service into the compose file at enable-time (breaks the byte-identical embedded-artifact invariant + its sync test).

### 4.2 Wiring = one baked service gated by a Compose profile
Add a single `proxy` service to both prod compose copies with `profiles: ["tls"]`. A profiled service is **dormant by default** — Compose never creates it unless the profile is active. When TLS is off, non-TLS users see an inert service block and nothing else changes.

### 4.3 Profile activation = `COMPOSE_PROFILES` injected by the Runner
"TLS enabled" is defined as **`MATHION_TLS_DOMAIN` being non-empty in `.env`.** The Runner injects `COMPOSE_PROFILES=tls` into the curated compose child-env **iff** that domain is set. Consequently every compose op (`up`/`down`/`ps`/`update`/`restore`) consistently treats the proxy as part of the project when enabled, and the service is dormant everywhere when disabled — with **no `--profile` flags scattered across subcommands and no compose-file branching.**

`COMPOSE_PROFILES` must be added to the Runner's child-env allowlist (it must not be stripped).

### 4.4 Backend unchanged
Secure cookies are already gated on `MATHION_COOKIE_SECURE`; the app consumes no forwarded headers. The proxy terminates TLS and forwards plain HTTP to `app:8000`. We deliberately do **not** add uvicorn `--proxy-headers`/`--forwarded-allow-ips` (nothing consumes them), consistent with the Slice 1 decision.

## 5. The compose service

Added identically to `docker-compose.prod.yml` and `cli/internal/compose/docker-compose.yml`:

```yaml
  proxy:
    image: ghcr.io/umputun/reproxy@sha256:<PINNED_DIGEST>   # exact digest chosen at implementation
    profiles: ["tls"]
    env_file: .env
    depends_on:
      app:
        condition: service_healthy
    ports:
      - "80:8080"     # reproxy HTTP (ACME HTTP-01 challenge + HTTP->HTTPS redirect)
      - "443:8443"    # reproxy HTTPS (Docker defaults: http 8080 / ssl 8443)
    environment:
      SSL_TYPE: auto
      SSL_ACME_EMAIL: ${MATHION_TLS_EMAIL}
      SSL_ACME_FQDN: ${MATHION_TLS_DOMAIN}
      SSL_ACME_LOCATION: /srv/acme
      STATIC_ENABLED: "true"
      STATIC_RULES: "*,/,http://app:8000/"
    volumes:
      - mathion_acme:/srv/acme
    healthcheck:
      test: ["CMD", "reproxy", "--help"]   # liveness placeholder; final form chosen at implementation (see §11)
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 10s
    restart: unless-stopped
```

New named volume `mathion_acme` added to both files' `volumes:` block. `SSL_ACME_LOCATION` is set to a **persisted** path so certs survive restarts (reproxy's default `./var/acme` is ephemeral; persistence avoids re-issuance and Let's Encrypt rate-limit exposure).

Confirmed reproxy facts (from its README, 2026-08-23): static-provider env vars are `STATIC_ENABLED` / `STATIC_RULES` (plural); rule format is `server,src,dest` → `*,/,http://app:8000/`; Docker listen defaults are `0.0.0.0:8080` (http) and `0.0.0.0:8443` (ssl); `SSL_ACME_FQDN` accepts a single FQDN (comma-separated for multiple — unused here).

## 6. The `mathion tls` command group

New file `cli/cmd/tls.go`, registered in `cli/cmd/root.go`.

### 6.1 `mathion tls enable --domain <fqdn> --email <addr>`
Both flags required. Steps:

1. **Require an installed stack** — `<CfgDir>/.env` and `<CfgDir>/docker-compose.yml` present and valid; else error with guidance to run `mathion install` first.
2. **Validate `--domain`:** a syntactically valid FQDN with at least one dot; reject empty, `localhost`, and bare IP literals (Let's Encrypt will not issue for those).
3. **Validate `--email`:** basic RFC-style check (non-empty, single `@`, a dotted domain part); used by Let's Encrypt for expiry notices.
4. **Port preflight (first-enable only):** if TLS is not already enabled (domain currently empty), require host ports **80 and 443 free** via the existing `dockerx.PortFree` pattern; fail clearly if taken (likely another web server / the operator's own proxy). **Skip this check on re-enable/update** (domain already set → we already own those ports).
5. **DNS preflight (warn, non-blocking):** best-effort A/AAAA lookup of `<domain>`. If it does not resolve to a reachable address, print a warning that certificate issuance will wait until DNS points at this host — but proceed.
6. **Mutate `.env` atomically** (line-oriented, like `RepinVersion`, via `config.AtomicWrite`): set `MATHION_TLS_DOMAIN=<fqdn>`, `MATHION_TLS_EMAIL=<addr>`, `MATHION_BASE_URL=https://<fqdn>`, `MATHION_COOKIE_SECURE=1`.
7. **Bring the stack up:** `up -d --wait` (the Runner now injects `COMPOSE_PROFILES=tls`). This starts the proxy and recreates the `app` container so it picks up the new base-url/cookie env (brief expected downtime during recreate).
8. **Report:** TLS enabled for `https://<fqdn>`; the certificate is obtained automatically on first access / shortly after startup; if the site is not HTTPS yet, check `mathion tls status` and `mathion logs`; ensure host ports 80 and 443 are open in any firewall and DNS points here.

Enable is **idempotent / update-capable:** running it again with a new domain updates all four vars and recreates proxy + app.

### 6.2 `mathion tls disable`
Production is HTTPS-only, so disable **never downgrades to plain HTTP.** It exists for operators moving to their **own** external HTTPS proxy. Steps:

1. If TLS is not enabled, report that and exit 0 (idempotent).
2. **Remove the bundled proxy container** while the profile is still active: `compose rm -sf proxy` (child-env still injects `COMPOSE_PROFILES=tls` because the domain is still set at this point).
3. **Mutate `.env`:** clear `MATHION_TLS_DOMAIN` and `MATHION_TLS_EMAIL` (set to empty). **Leave `MATHION_BASE_URL` (https) and `MATHION_COOKIE_SECURE=1` untouched** — the app still expects HTTPS in front.
4. **Report:** bundled proxy stopped; the app still expects an HTTPS proxy in front of `127.0.0.1:8000` (base-url + secure cookies preserved). Put your own TLS proxy in front, or re-run `mathion tls enable`. If your proxy serves a different hostname, update `MATHION_BASE_URL` accordingly.

There is **no `--plain` flag** and no production plain-HTTP path.

### 6.3 `mathion tls status`
Prints:
- **Enabled/disabled** (derived from `MATHION_TLS_DOMAIN` non-empty in `.env`).
- When enabled: `domain`, `email`, and whether the `proxy` container is **running** (via `compose ps` for the `proxy` service, using the existing ps/status seam), plus a `verify at https://<domain>` line.
- When disabled: a one-line hint to run `mathion tls enable`.

Live certificate-expiry probing is **out of scope** for this slice (needs outbound network + correct DNS; flaky). Easy to add later.

## 7. Backend

**No changes.** Rationale restated for the reviewer: `MATHION_COOKIE_SECURE=1` (set by enable) drives the cookie `Secure` flag; `MATHION_BASE_URL=https://<domain>` (set by enable) drives notification + superuser-panel links; the app reads no `X-Forwarded-*`; the SPA uses relative URLs. reproxy terminating TLS and forwarding to `app:8000` requires nothing from the app.

## 8. HTTP → HTTPS redirect (open item, security-relevant)

reproxy's README documents `X-Forwarded-Proto/Port` injection in `auto` mode but **does not document** an automatic HTTP→HTTPS redirect. Go's `autocert.Manager.HTTPHandler(nil)` — the standard mechanism reproxy uses for HTTP-01 challenges — redirects all non-challenge HTTP traffic to HTTPS, so the redirect is **expected** but **must be verified at implementation**, not assumed.

**Requirement:** In the enabled state, a plain-HTTP request to the domain must **301/308 redirect to HTTPS** (no app content served over plain HTTP), satisfying the "no plain HTTP in production" rule. This is an **acceptance criterion** verified by the manual on-host check (§10). If reproxy does not redirect out of the box, the fallback is an explicit redirect rule; the implementation plan must confirm the behavior before the slice is considered done. Port 80 must remain published because HTTP-01 challenge validation requires it.

## 9. Configuration surface (`.env`) & docs

- Add two **optional** vars — `MATHION_TLS_DOMAIN` and `MATHION_TLS_EMAIL` (default empty) — to `GenerateEnv`/`RenderEnv` in `cli/internal/config/env.go`. `ValidateEnvComplete` treats them as **optional** (empty is valid); it must not fail a non-TLS install.
- Add a `SetTLS(domain, email)` / `ClearTLS()` helper in `env.go` (sibling to `RepinVersion`) performing the atomic line-oriented `.env` mutations for enable/disable, including the `MATHION_BASE_URL` + `MATHION_COOKIE_SECURE` updates on enable.
- `deploy/.env.prod.example`: document the two new vars (commented, with a one-line pointer to `mathion tls enable`).
- `README.md`: new "Bundled HTTPS (`mathion tls`)" subsection presented as the easy path; the existing external-proxy section stays for BYO. Document the host firewall requirement (open 80 + 443) and the DNS requirement.
- `cli/cmd/install.go` `nextSteps`: add a "for automatic HTTPS, run `mathion tls enable --domain … --email …`" line.
- `deploy/man/mathion.1`: document the `tls` subcommand.

## 10. Testing strategy

### Automated (CI)
- **CLI unit tests** (`cli/cmd/tls_test.go`, hermetic via existing seams):
  - domain validation: valid FQDN accepted; empty / `localhost` / IP literal rejected.
  - email validation: valid accepted; empty / malformed rejected.
  - `.env` mutation: `enable` writes all four vars; `disable` clears domain/email and **preserves** `MATHION_BASE_URL`/`MATHION_COOKIE_SECURE`.
  - `enable` requires both flags (cobra wiring).
  - port preflight: calls `PortFree` for 80 and 443 on first enable; **skipped** on re-enable (domain already set).
  - `status` output for enabled / disabled / proxy-running states (via the compose-ps seam).
- **Runner test:** `COMPOSE_PROFILES=tls` present in the child-env iff `MATHION_TLS_DOMAIN` is set; absent otherwise; and `COMPOSE_PROFILES` is not stripped.
- **Compose sync test:** extend the embedded-vs-root sync test to cover the new `proxy` service + `mathion_acme` volume, and pin the reproxy image line.
- **`docker compose config`** parses cleanly both without the profile (default) and with `COMPOSE_PROFILES=tls`.

### Manual on-host (documented, not CI)
Real Let's Encrypt issuance needs a public domain with DNS pointed at the host — CI cannot provide this. Tracked openly as a deferred on-host verification (same class as the amd64 cloud smoke), **not** a silent gap. Steps to document:
1. On a host with a real domain + open 80/443, `mathion install` then `mathion tls enable --domain … --email …`.
2. `https://domain` serves the app with a valid Let's Encrypt cert.
3. `http://domain` **redirects to** `https://domain` (satisfies §8).
4. Login works (secure cookie set + accepted over HTTPS).
5. `mathion tls disable` stops the proxy and preserves the HTTPS posture; `mathion tls status` reflects each state.

## 11. Files touched

- `docker-compose.prod.yml` — add `proxy` service + `mathion_acme` volume.
- `cli/internal/compose/docker-compose.yml` — identical change (synced).
- compose sync test (e.g. `cli/internal/compose/image_test.go` or a sibling) — cover the proxy service + image pin.
- `cli/cmd/tls.go` **(new)** — the `tls` command group.
- `cli/cmd/tls_test.go` **(new)** — unit tests.
- `cli/cmd/root.go` — register `tls`; TLS-enabled detection feeding the Runner.
- `cli/internal/config/env.go` — two optional vars in `GenerateEnv`/`RenderEnv`; optional in `ValidateEnvComplete`; `SetTLS`/`ClearTLS` helpers.
- `cli/internal/config/env_test.go` — cover the new vars + helpers.
- `cli/internal/compose/runner.go` — inject `COMPOSE_PROFILES=tls` when TLS enabled; keep it off the strip list.
- `cli/internal/compose/runner_test.go` — cover the injection.
- `deploy/.env.prod.example` — document the two vars.
- `README.md` — bundled-HTTPS subsection + firewall/DNS notes.
- `cli/cmd/install.go` — `nextSteps` HTTPS hint.
- `deploy/man/mathion.1` — `tls` subcommand.

No `deploy/proxy/` directory — reproxy needs no config file.

## 12. Security considerations

- **reproxy image pinned by digest** (supply-chain).
- **Ports 80/443 exposed publicly** — intended; documented firewall requirement. Port 80 is required for HTTP-01 and must serve only the ACME challenge + the HTTPS redirect (§8), never app content in the clear.
- **No new secrets.** The ACME email is low-sensitivity and lives in `.env`.
- **Certificate private keys** live in the `mathion_acme` volume (container-owned). **Not** included in `mathion backup` — certs are re-issuable; excluding them avoids backing up private keys and avoids restore-time staleness. (Repeated enable/disable cycles re-issue certs; Let's Encrypt weekly rate limits are generous but worth an operator note.)
- **Disable never downgrades security** — HTTPS posture (base-url + secure cookie) is preserved (§6.2).
- **App remains loopback-only** on `127.0.0.1:8000`; the proxy reaches it over the compose network, not the host publish.

## 13. Open items / risks

1. **HTTP→HTTPS redirect (§8)** — expected via Go autocert but must be verified at implementation; it is a security acceptance criterion.
2. **Proxy healthcheck form (§5)** — the exact `healthcheck.test` (e.g. reproxy `/ping` on the HTTP port vs a lightweight process check) is finalized at implementation once reproxy's in-container health endpoint/behavior is confirmed; it must make `up --wait` reflect proxy liveness without depending on successful cert issuance (which is async and DNS-dependent).
3. **App recreate on enable** — changing `.env` values consumed via `env_file` triggers an `app` container recreate on `up -d`; the implementation must confirm this recreate happens (so the app picks up `https` base-url + secure cookie) and document the brief downtime.
4. **reproxy exact env semantics** — env-var names and rule format are taken from reproxy's current README; the implementation validates them by actually booting the container (`docker compose config` + a live `up`) before the slice is done.

---

## Appendix — command UX summary

```
mathion tls enable --domain example.edu --email admin@example.edu
mathion tls status
mathion tls disable
```
Production is HTTPS-only. Local development keeps plain HTTP via the existing dev workflow, unchanged.
