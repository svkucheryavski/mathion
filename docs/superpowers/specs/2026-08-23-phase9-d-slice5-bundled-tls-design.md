# Phase 9-D Slice 5 — Bundled auto-TLS reverse proxy (`mathion tls`)

**Status:** Design (rev 2 — dual-gate findings folded) — pending re-gate + user approval
**Date:** 2026-08-23
**Phase:** 9-D (Deployment), Slice 5
**Depends on:** Slices 1–4b (prod image, compose, `mathion` CLI, signed releases) — all shipped.

> **Rev 2 note.** Rev 1 was reviewed by an independent reviewer + codex@high. Both confirmed the core design (backend unchanged, compose-profile opt-in, disable-preserves-HTTPS) but codex returned BLOCK on two Criticals (proxy secret-leak via `env_file`; unverified cleartext/redirect) plus Importants (upload body-limit, profile-injection mechanism, restore/update proxy handling, lock/guard, purge volume, healthcheck). All are folded here. The reproxy source was inspected to resolve the redirect question (see §8).

---

## 1. Goal

Give self-hosters a **one-command, opt-in path to HTTPS** — `mathion tls enable --domain <fqdn> --email <addr>` — that stands up a bundled reverse proxy which obtains and auto-renews a Let's Encrypt certificate, with **zero certificate files to manage**. Operators who prefer their own external proxy keep today's path unchanged.

## 2. Background — current deployment state (verified 2026-08-23)

- **One image, one origin.** A single uvicorn process serves the API and the Svelte SPA on port 8000. The frontend uses only **relative URLs** → a same-origin proxy needs **no frontend rebuild**.
- **App published loopback-only:** `docker-compose.prod.yml` publishes `127.0.0.1:8000:8000`; uvicorn listens on `0.0.0.0:8000` inside the container (`Dockerfile:46`). A **containerized** proxy reaches the app over the compose network as `app:8000`, not via host loopback.
- **No proxy in the stack.** Slice 1 deferred "bundled auto-HTTPS" to this slice. Today's docs tell operators to run their own external proxy; that path must remain intact.
- **The app already assumes external HTTPS.** The CLI builds `MATHION_BASE_URL=https://<domain>` (`cli/internal/config/validate.go:29`); prod `.env` sets `MATHION_COOKIE_SECURE=1`; the session cookie `Secure` flag is gated solely on `cookie_secure` (`backend/mathion/api/auth.py:98,103`); the boot guard keys only off `cookie_secure`+`secret_key` (`backend/mathion/main.py`). Repo-wide search: the app consumes **no** `X-Forwarded-*`, request scheme, `request.client`, or `root_path`; the only `request.url` use is `request.url.path`.
- **Two prod compose copies must stay byte-identical:** root `docker-compose.prod.yml` and the CLI-embedded `cli/internal/compose/docker-compose.yml`, guarded by `TestEmbeddedComposeMatchesRepoRoot` (`cli/internal/compose/embed_test.go`).
- **The compose child-env is curated by the Runner** (`cli/internal/compose/runner.go`): `sanitizedEnviron()` passes `os.Environ()` minus `strippedEnvKeys` (`MATHION_VERSION`, `POSTGRES_*`). `Output`/`Stream` use `sanitizedEnviron()` with **no** caller-env; only `RunEnv`/`StreamInEnv` append caller env.
- **Uploads:** `max_file_size = 20 MiB` (`backend/mathion/config.py:12`). Our own README (`README.md:251`) warns reproxy's default body limit is **64K** and must be raised or uploads are rejected at the proxy.

## 3. Scope

### In scope
- A bundled, **opt-in** reverse proxy (reproxy), dormant unless enabled, with **network segmentation** so it cannot reach Postgres.
- Automatic Let's Encrypt issuance + auto-renewal for **one public domain**.
- A `mathion tls` group: `enable`, `disable`, `status`.
- The coordinated `.env` state change "HTTPS on" implies, and correct proxy lifecycle across `up`/`down`/`update`/`restore`/`uninstall --purge`.

### Non-goals
- Bring-your-own-cert; LAN / self-signed; path-prefix mounting; multiple domains / wildcard / DNS-01; **plain HTTP in production** (production is HTTPS-only; local dev keeps plain HTTP via the existing dev workflow, unchanged); **backend code changes** (none — §7).

## 4. Key decisions

### 4.1 Proxy = reproxy
`ghcr.io/umputun/reproxy`, pinned by digest. Chosen over Caddy because reproxy is **configured entirely by environment variables** (no config file to embed/mount/sync) and is **already the proxy our external-proxy docs recommend** (one proxy across bundled + external). Caddy's edges (CertMagic maturity, official image) are marginal at single-domain scale. The redirect concern that might have favored Caddy is resolved in reproxy's favor by source inspection (§8). **Rejected:** Traefik (overkill), nginx+certbot (two components + cron), overlay compose file (forces conditional `-f` juggling), enable-time compose generation (breaks the byte-identical invariant).

### 4.2 Wiring = one baked service gated by a Compose profile
A single `proxy` service in both prod compose copies with `profiles: ["tls"]`. A profiled service is **dormant by default** — Compose never creates it unless the profile is active.

### 4.3 Profile activation = a single central `--profile tls`, with host-env poisoning blocked
Rev-1's "process-env `COMPOSE_PROFILES`" idea is replaced (it left host poisoning possible and `Output`/`Stream` do not carry per-call env). Instead:

- **Strip `COMPOSE_PROFILES`, `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL`** from the child env (add to `strippedEnvKeys`, `runner.go`). This blocks an ambient `COMPOSE_PROFILES=tls` from activating the proxy, and makes `--env-file .env` authoritative for the `${MATHION_TLS_*}` interpolation (host env otherwise overrides `--env-file`).
- **Add one `--profile tls`** to the central `composeArgs` builder (`cli/cmd/root.go:32`, through which *every* compose invocation flows) **when TLS is enabled.** "TLS enabled" is derived from `MATHION_TLS_DOMAIN` non-empty in `.env`. The `App` reads this at startup into a `tlsEnabled` field; `SetTLS`/`ClearTLS` update the field so that within the `enable` process (which mutates `.env` before `up`) `composeArgs` reflects the new state. This makes the profiled `proxy` visible to `up`, `down`, `ps`, `rm`, `update`, and `restore` uniformly — no per-subcommand `--profile` flags, no compose-file branching.

### 4.4 Network segmentation (blast-radius containment)
The internet-facing proxy must **not** be able to reach Postgres. Two networks (both compose copies):

- `frontend` — members `proxy` + `app` (has egress; the proxy reaches `app:8000` here).
- `backend` — members `app` + `db`, marked `internal: true` (no external gateway; DB isolated from the internet).

`app` joins **both** (retains egress for SMTP via `frontend`; reaches `db` via `backend`). `proxy` joins **only** `frontend` → a compromised proxy cannot authenticate to `db`. Non-TLS deployments are unaffected in behavior (app↔db over `backend`, app's `127.0.0.1:8000` publish unchanged); only the topology is made explicit.

### 4.5 Backend unchanged
`MATHION_COOKIE_SECURE=1` drives the cookie `Secure` flag; `MATHION_BASE_URL=https://<domain>` drives generated links; the app reads no forwarded headers; the SPA is relative. `Settings` has no `extra="forbid"`, so the two `MATHION_TLS_*` vars reaching the app container are ignored harmlessly. We deliberately do not add uvicorn `--proxy-headers` (nothing consumes it), consistent with Slice 1.

## 5. The compose service + networks

Added identically to `docker-compose.prod.yml` and `cli/internal/compose/docker-compose.yml`. **No `env_file: .env`** on the proxy — it receives only explicit vars; domain/email arrive via `${…}` interpolation from `--env-file .env`:

```yaml
  proxy:
    image: ghcr.io/umputun/reproxy@sha256:<PINNED_DIGEST>   # digest chosen + behavior-verified at implementation
    profiles: ["tls"]
    depends_on:
      app:
        condition: service_healthy
    ports:
      - "80:8080"     # reproxy HTTP: ACME HTTP-01 challenge only in auto mode (see §8)
      - "443:8443"    # reproxy HTTPS (Docker listen defaults: http 8080 / ssl 8443)
    environment:
      SSL_TYPE: auto
      SSL_ACME_EMAIL: ${MATHION_TLS_EMAIL}
      SSL_ACME_FQDN: ${MATHION_TLS_DOMAIN}
      SSL_ACME_LOCATION: /srv/acme
      STATIC_ENABLED: "true"
      STATIC_RULES: "${MATHION_TLS_DOMAIN},/,http://app:8000/"   # scoped to the FQDN, not "*"
      MAX_SIZE: "25M"                                            # reproxy default is 64K — must exceed 20 MiB uploads
    volumes:
      - mathion_acme:/srv/acme
    networks: [ frontend ]
    healthcheck:
      test: <real reproxy listener probe — finalized at implementation (§13); NOT `reproxy --help`>
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 15s
    restart: unless-stopped
```

`app` gains `networks: [frontend, backend]`; `db` gains `networks: [backend]`. New top-level blocks (both files):

```yaml
networks:
  frontend: {}
  backend:
    internal: true

volumes:
  mathion_pgdata: {}
  mathion_assets: {}
  mathion_acme: {}     # NEW — persisted ACME cert store (survives restarts; no re-issue)
```

**Confirmed reproxy env facts** (from README + source inspection, 2026-08-23): `SSL_TYPE`, `SSL_ACME_EMAIL`, `SSL_ACME_FQDN`, `SSL_ACME_LOCATION`, `SSL_HTTP_PORT`, `STATIC_ENABLED`, `STATIC_RULES`, `LISTEN`, `MAX_SIZE` (flag `--max`, default `64K`); Docker listen defaults `0.0.0.0:8080`/`0.0.0.0:8443`; rule format `server,src,dest`. Exact values are re-verified against the pinned image at implementation (`docker compose config` + a live `up`).

## 6. The `mathion tls` command group

New `cli/cmd/tls.go`, registered in `root.go`.

### 6.1 `mathion tls enable --domain <fqdn> --email <addr>`
Both flags required. Runs under **`lockAndGuard`** (root check + operation lock + worker sweep + breadcrumb entry-check); `enable` is added to the breadcrumb **refuse set** in `classify()` (it brings services up on top of a possibly-unverified deployment).

1. Require an installed stack (`.env` + compose present/valid); else guide to `mathion install`.
2. **Validate `--domain`:** syntactically valid FQDN with ≥1 dot; reject empty, `localhost`, IP literals.
3. **Validate `--email`:** non-empty, single `@`, dotted domain.
4. **Port preflight (only when the project's `proxy` container is not already running):** require host 80 + 443 bindable (test wildcard IPv4/IPv6 bindability rather than mere connectivity; Docker's own bind remains the authoritative backstop). Skipping keys off *actual proxy-running state*, not merely a non-empty domain.
5. **DNS preflight (warn, non-blocking):** best-effort A/AAAA lookup; warn that issuance waits until DNS points here; proceed.
6. **`SetTLS(domain, email)`** — atomic, validate-before-write, then reread + assert postcondition (mirrors `RepinVersion`, `env.go`): writes `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL`, `MATHION_BASE_URL` (built via `BuildBaseURL` for validator-consistency), `MATHION_COOKIE_SECURE=1`. Pair invariant: TLS fields are both-empty or both-valid; when enabled, `MATHION_BASE_URL == https://<domain>` and secure-cookie true. Sets `App.tlsEnabled=true`.
7. **`up -d --wait --force-recreate app proxy`** — `--force-recreate` makes the app pick up the new env explicitly (version-independent), and starts the profiled proxy.
8. **Report:** enabled for `https://<fqdn>`; cert obtained automatically shortly after start; if not HTTPS yet, check `mathion tls status` / `mathion logs`; ensure firewall opens 80 + 443 and DNS points here. **A failed/timed-out enable leaves TLS enabled in `.env`** (with a possibly-unhealthy proxy); remedy is re-run `enable` or `mathion tls disable`.

Idempotent/update-capable: re-running with a new domain updates all four vars and recreates.

### 6.2 `mathion tls disable`
Production is HTTPS-only, so disable **never downgrades**. Runs under `lockAndGuard` (classified **proceed** on breadcrumb, like `stop`/containment). Steps:

1. If not enabled, report + exit 0.
2. **`compose rm -sf proxy`** while the profile is still active (domain still set → `composeArgs` still adds `--profile tls`).
3. **`ClearTLS()`** — clear `MATHION_TLS_DOMAIN`/`EMAIL`; **leave `MATHION_BASE_URL` (https) + `MATHION_COOKIE_SECURE=1`**. Sets `App.tlsEnabled=false`.
4. **Report:** bundled proxy stopped; the app still expects HTTPS in front and is **currently unreachable** (loopback-only `127.0.0.1:8000`, secure cookies on) until you put your own TLS proxy in front or re-run `mathion tls enable`. If your proxy serves a different hostname, update `MATHION_BASE_URL`.

No `--plain` flag.

### 6.3 `mathion tls status`
Read-only (no lock, like `status`). Prints enabled/disabled (from `.env`); when enabled: `domain`, `email`, whether the `proxy` container is running (`compose ps proxy`), a `verify at https://<domain>` line, and a caveat that a running container does **not** confirm the certificate has issued (check `mathion logs` if HTTPS is failing).

## 7. Backend

**No changes.** (Rationale in §2/§4.5; verified by both reviewers.)

## 8. HTTP listener behavior — resolved by source inspection

reproxy source (`app/proxy/proxy.go`) shows that in `ssl.type=auto` the HTTP (port-80) server's handler is `httpChallengeRouter(m)` — it serves **only ACME HTTP-01 challenges**; the static proxy rules (app content) are bound **exclusively to the HTTPS listener** (`ListenAndServeTLS`). **Therefore there is no cleartext path to application content** — the "no plain HTTP in production" rule holds by the proxy's construction, not merely by assumption.

Residual (UX, not security): whether a non-challenge `http://` request 301-redirects to HTTPS or returns a challenge-router 404 is version-dependent and **not** a security concern. 

**Acceptance criteria (automated, §10):** with TLS enabled, an HTTP request carrying the configured `Host` for a normal app path must **never** return application content (assert non-app response — a redirect or a non-2xx), and the app must be served over HTTPS. HSTS is added on HTTPS responses if the pinned reproxy supports it (verified at implementation).

## 9. Configuration surface (`.env`) & docs

- Add `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL` to `GenerateEnv`/`RenderEnv` (emitted with **empty active assignments**, e.g. `MATHION_TLS_DOMAIN=`) — a commented form would break the generated-vs-example parity test (`env_test.go:201`, which ignores comments). Optional in `ValidateEnvComplete` (empty valid); add the **conditional pair-consistency** check from §6.1-6.
- `SetTLS`/`ClearTLS` helpers in `env.go` (siblings of `RepinVersion`): validate → atomic write → reread → assert.
- `deploy/.env.prod.example`: document both vars (empty active assignments + explanatory comments pointing at `mathion tls enable`).
- `README.md`: "Bundled HTTPS (`mathion tls`)" as the easy path; keep the external-proxy section; document firewall (open 80 + 443) + DNS requirements.
- `cli/cmd/install.go` `nextSteps`: add the `mathion tls enable …` hint.
- `deploy/man/mathion.1`: document the `tls` subcommand.

## 10. Testing strategy

### Automated (CI)
- **`tls_test.go`** (hermetic via seams): domain/email validation; `SetTLS` writes all four vars + asserts postcondition; `ClearTLS` clears domain/email and **preserves** base-url/cookie; pair-consistency validation; `enable` requires both flags; port preflight only when proxy not running; `status` output per state.
- **Runner env-strip test** (`runner_test.go`): `COMPOSE_PROFILES`, `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL` stripped from the child env; ambient `COMPOSE_PROFILES=tls` does **not** leak through.
- **`composeArgs` profile test** (`root` test): `--profile tls` present iff `tlsEnabled`; verified after an in-process `SetTLS`.
- **Compose sync test:** extend `embed_test.go` coverage to the `proxy` service, `frontend`/`backend` networks, and `mathion_acme` volume; pin the reproxy image line.
- **`docker compose config`** parses cleanly without the profile and with `--profile tls`; assert the proxy is on `frontend` only, `db` on `backend` only, `app` on both.
- **Purge test:** `uninstall --purge` targets `<project>_mathion_acme` (teardown_test).

### On-host integration (CI where dockerable; else documented manual)
- **HTTP-serves-no-app-content** (§8 acceptance) — bootable in a container without a public domain by hitting the HTTP listener directly.
- **>64 KiB upload** through the proxy succeeds (guards the `MAX_SIZE` fix).
- **restore/update with TLS enabled** brings the proxy back up (§11).
- **Real Let's Encrypt issuance** needs a public domain + DNS → **documented manual on-host verification** (same class as the amd64 cloud smoke), not a silent gap: install → `tls enable` → valid cert on `https://domain` → login works → `http://domain` returns no app content → `tls disable` preserves posture → `status` reflects each state.

## 11. Files touched

- `docker-compose.prod.yml` + `cli/internal/compose/docker-compose.yml` — `proxy` service, `frontend`/`backend` networks, `app`/`db` network membership, `mathion_acme` volume (synced).
- `cli/internal/compose/embed_test.go` — extend sync coverage + image pin.
- `cli/cmd/tls.go` **(new)** + `cli/cmd/tls_test.go` **(new)**.
- `cli/cmd/root.go` — register `tls`; `App.tlsEnabled` (read at startup); `--profile tls` in `composeArgs`.
- `cli/internal/config/env.go` (+`env_test.go`) — two optional vars; `SetTLS`/`ClearTLS`; pair-consistency in `ValidateEnvComplete`.
- `cli/internal/compose/runner.go` (+`runner_test.go`) — add the three keys to `strippedEnvKeys`.
- `cli/cmd/restore.go` and `cli/cmd/update.go` — bring the proxy up when TLS is enabled (final `up` includes `proxy`, e.g. full-project `up` under the active profile); tests for TLS-enabled restore/update.
- `cli/internal/dockerx/teardown.go` (+test) and `cli/cmd/uninstall.go` — add `mathion_acme` to purge + confirmation + fresh-install orphan-volume guard.
- `cli/cmd/install.go` — `nextSteps` HTTPS hint.
- `deploy/.env.prod.example`, `README.md`, `deploy/man/mathion.1`.

No `deploy/proxy/` directory — reproxy needs no config file.

## 12. Security considerations

- **Proxy holds no app/DB secrets** — no `env_file: .env`; only `SSL_*`/`STATIC_*`/`MAX_SIZE` (§5).
- **Network segmentation** — a compromised internet-facing proxy cannot reach Postgres (`db` on `internal: true` `backend`; proxy on `frontend` only) (§4.4).
- **reproxy image pinned by digest.**
- **No cleartext app content** — port 80 serves ACME challenges only (§8); `STATIC_RULES` scoped to the FQDN; HSTS on HTTPS if supported.
- **Ports 80/443 exposed publicly** — intended; documented firewall requirement.
- **No new secrets** — ACME email is low-sensitivity, in `.env`.
- **Cert private keys** live in `mathion_acme` (container-owned); **excluded from `mathion backup`** (backup archives only DB + assets, `backup.go:149`) — re-issuable, avoids storing private keys. A restore to a **new host** re-issues (brief HTTP-only window); repeated enable/disable does **not** re-issue (the named volume persists — `compose rm` never deletes it); re-issue happens only on host loss, `--purge`, or a domain change.
- **Disable never downgrades** the HTTPS posture (§6.2).
- **App remains loopback-only** on `127.0.0.1:8000`; the proxy reaches it over `frontend`.

## 13. Open items / risks (implementation must close)

1. **Pinned digest + live behavior** — choose the reproxy digest and verify against it: the §8 HTTP-no-app-content behavior, `MAX_SIZE` env name/effect, HSTS support, and the healthcheck endpoint.
2. **Healthcheck form (§5)** — a real probe that exercises the running reproxy listener (not `--help`), independent of ACME success (which is async/DNS-gated).
3. **`--force-recreate app proxy` on enable** — confirm the app picks up the new `.env` (secure cookie + base-url) on-host; keep the manual issuance check as a gate.
4. **restore/update proxy lifecycle** — confirm the profiled proxy is brought back up on TLS-enabled restore/update via the automated tests in §10.

---

## Appendix — command UX

```
mathion tls enable --domain example.edu --email admin@example.edu
mathion tls status
mathion tls disable
```
Production is HTTPS-only. Local development keeps plain HTTP via the existing dev workflow, unchanged.
