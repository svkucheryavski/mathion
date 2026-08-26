# Phase 9-D Slice 5 — Bundled auto-TLS reverse proxy (`mathion tls`)

**Status:** Design (rev 7 — round-7 confirmation re-gate clean: Opus SHIP + codex SHIP-WITH-CHANGES, zero Critical/Important) — **APPROVED**; proceeding to implementation plan
**Date:** 2026-08-23
**Phase:** 9-D (Deployment), Slice 5
**Depends on:** Slices 1–4b (prod image, compose, `mathion` CLI, signed releases) — all shipped.

> **Revision history.**
> - **Rev 1** reviewed by independent reviewer + codex@high → BLOCK (2 Crit: proxy secret-leak via `env_file`, unverified cleartext/redirect; + Importants).
> - **Rev 2** folded rev-1. Re-review: codex BLOCK / independent SHIP-WITH-CHANGES — both confirmed all rev-1 findings RESOLVED and the network topology sound, but surfaced NEW issues: stale on-disk compose on upgrade, an email→secret interpolation leak, a risky db network-migration, an infeasible in-container healthcheck (the reproxy image is `FROM scratch`), proxy-runs-as-root, and restore/update rollback coupling.
> - **Rev 3:** folded all rev-2 findings — simplified the network split (one `frontend` network; db stays on `default`), replaced the container healthcheck with a host-side CLI readiness poll, added compose re-materialization on enable, strict domain/email validation, non-root proxy, restore/update decoupling.
> - **Rev 4:** round-3 re-review (codex BLOCK / independent SHIP-WITH-CHANGES) confirmed the design sound and all rev-2/3 findings resolved. Folds the remaining refinements: **operation-sensitive `--profile tls`** (always for stop/down/rm/ps so `mathion stop`/`uninstall` can't orphan the running proxy); a **`proxy-init` chown one-shot** so the non-root proxy can write a fresh (root-owned) ACME volume; corrected the interpolation *test* (Compose recursively expands `.env` values, so the input validator is the real defense — the test asserts rejection); proper DNS-label validation; enable reuses the install identity guard and allows image pull; restore/update proxy-up is `--pull never --no-deps` + bounded + rollback-exempt; redirect is 307.
> - **Rev 5:** round-4 re-review (codex BLOCK / independent SHIP-WITH-CHANGES) — both gates confirmed the security core empirically on live Compose v5.1.2. No Critical. Folded: restore/update proxy-up runs `proxy-init` before the `--no-deps` proxy; explicit **three-way** `composeArgs` split (start=gated / containment=always / everything-else incl. `pull`=no profile); **`tls disable`** reaps the proxy idempotently **before** consulting `.env`; `proxy-init` cap-hardened; proxy-up gated on `opts.WriteBreadcrumb`; DNS validator before `BuildBaseURL`; downgrade caveat to README/man.
> - **Rev 6:** round-5 re-review (codex BLOCK / independent SHIP-WITH-CHANGES) — **both gates verified empirically on live Compose v5.1.2**, and converged: the rev-5 `up -d --wait proxy-init` primitive is **wrong** (a standalone one-shot that exits returns **rc=1**, indistinguishable success-vs-failure) → replaced with the codebase's synchronous one-off idiom **`run --rm --no-deps --pull never … -T proxy-init`** (returns the true exit code). `proxy-init` chown made **non-recursive** (`chown 1001:1001`, not `-R`) so `CAP_CHOWN`-only needs no directory-traversal privilege on reproxy's `0700` subtree. **TLS-enabled resume/restore** now do a bounded **targeted `pull proxy proxy-init`** before their `--pull never` up (a profile-free general `pull` left the proxy image absent → `up --pull never` would fail on a new host / digest bump / pgdata-skip). `tls disable`'s reap-`rm` uses a **captured-stderr seam** — rc=0 proceed, `no such service` tolerate, any other error **aborts** disable (never clears TLS with a proxy possibly still up). Framing corrected: the proxy-restore step is **standalone-restore-only** (`update`'s forward path keeps the proxy running, needs none); `composeArgs` guards `len(sub)==0`.
> - **Rev 7 (this):** round-6 re-review — **both gates SHIP-WITH-CHANGES, zero Critical/Important** ("buildable as-is"). All rev-5 findings empirically RESOLVED on live Compose v5.1.2. Folds three **Minors**: the targeted pull is `pull --policy missing proxy proxy-init` (a plain cached pull still does a registry round-trip; `--policy missing` truly skips when cached) + reworded as bounded/best-effort (a warning, not an abort, on an unreachable registry); the `run proxy-init` one-off gets **mandatory** `--name`/`--label` + `forceRemoveWorker` on error/timeout before `up proxy` (a killed `run` can leave the container alive); §13.5 adds an open item to confirm reproxy **re-resolves `app:8000`** after `update` recreates `app` (no proxy restart needed). **Round-7 confirmation re-gate: independent Opus SHIP + codex SHIP-WITH-CHANGES** (zero Critical/Important; two trivial minors folded here — this revision-history ordering, and a note that `proxy-init` cleanup inherits `forceRemoveWorker`'s loop-bound + startup-sweep boundedness rather than a context deadline). The dual-gate loop is converged.

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
- **Add `--profile tls`** in the central `composeArgs` builder (`cli/cmd/root.go:32`, through which *every* compose invocation flows), **operation-sensitively — a three-way split keyed on the subcommand (`sub[0]`):**
  - **Containment / removal / inspection** (`down`, `stop`, `rm`, `ps`, `logs`) → **always** include `--profile tls`. This is essential: a profiled service is out of scope for a command run without its profile, so a plain `mathion stop`/`uninstall` (`stop`/`down`) would otherwise **leave the internet-facing proxy and ports 80/443 running** while stopping app+db. Including the profile is harmless when no proxy exists — **verified** on Compose v5.1.2: `--profile tls` against a **pre-Slice-5 on-disk compose that declares no `tls` profile** is a rc=0 no-op for `down`/`stop`/`ps`/`config` (Compose ignores a profile that matches no service), so a CLI upgrade never breaks `mathion stop`/`uninstall` on a not-yet-`tls enable`d install.
  - **Start** (`up`, `start`, `create`, `run`) → include `--profile tls` **only when TLS is enabled**, so the proxy is never started on a non-TLS deployment.
  - **Everything else** (`pull`, `exec`, `config`, …) → **never** add the profile. The default bucket is "no profile," **not** "not-a-start ⇒ always": `install` runs a whole-project `compose pull` (`install.go:140,196`) on a deployment where TLS is always off, and adding the profile there would fetch the `reproxy`+`busybox` images needlessly and **fail in air-gapped / mirror-only registries**. (TLS-enabled resume/restore fetch the proxy images via an **explicit targeted `pull --policy missing proxy proxy-init`** instead — §10/§11 — not by profiling the general `pull`.) An **empty or unrecognized `sub[0]` defaults to this no-profile bucket** (no panic on `len(sub)==0`).
- "TLS enabled" is derived from `MATHION_TLS_DOMAIN` non-empty in `.env`. The `App` reads this at startup into a `tlsEnabled` field **fail-safe** (a missing/corrupt `.env` — e.g. any command before `install` — reads as `false`, never a hard error); `SetTLS`/`ClearTLS` update the field so that within the `enable` process (which mutates `.env` before `up`) `composeArgs` reflects the new state. `composeArgs` sees the subcommand (`sub[0]`) already, so the three-way split lives in that one place — no per-call-site flags. Because containment always carries the profile, an actually-running proxy is reaped by `mathion stop`/`uninstall` and by `tls disable` — which issues an idempotent `compose rm -sf proxy` **before** it consults `.env`, so it reaps even when `.env` reads disabled (see §6.2).

### 4.4 Network segmentation (blast-radius containment) — minimal one-network form
The internet-facing proxy must **not** be able to reach Postgres. Rev-2 review showed the two-network form (moving `db` onto a separate `internal` network) forces a **risky migration of the running `db`** off `mathion_prod_default` — stranding `app`↔`db` during `update`'s in-place migration one-off (`update.go:312` `run --no-deps app`) and introducing a multi-network default-gateway ambiguity for `app`'s egress. Rev 3 uses the **minimal** form that achieves the same isolation without moving `db`:

- **`default`** (the existing implicit network): members `app` + `db` — **unchanged from today**.
- **`frontend`** (NEW): members `proxy` + `app`.

`proxy` joins **only `frontend`**; `db` joins **only `default`** → they share **no** network, so a compromised proxy cannot resolve or route to Postgres (the C1 goal). `app` joins **both** (`default` to reach `db` as today; `frontend` so the proxy can reach `app:8000`). Because `db` never leaves `default` and both networks are ordinary egress-capable bridges, there is **no db recreation, no `internal:true` gateway ambiguity, and `update`'s app↔db migration one-off keeps working**. On enable, only `app` is recreated (to join `frontend` — it is being recreated anyway for the env change); `db` is untouched; the non-TLS `127.0.0.1:8000` publish is unchanged.

(The dropped extra — marking a db-only network `internal: true` so Postgres cannot make *outbound* connections — is marginal: `db` today already sits on an egress bridge with no published port and is not internet-reachable inbound. Rev 3 preserves that status quo; the meaningful win, proxy↔db isolation, is kept.)

### 4.5 Backend unchanged
`MATHION_COOKIE_SECURE=1` drives the cookie `Secure` flag; `MATHION_BASE_URL=https://<domain>` drives generated links; the app reads no forwarded headers; the SPA is relative. `Settings` has no `extra="forbid"`, so the two `MATHION_TLS_*` vars reaching the app container are ignored harmlessly. We deliberately do not add uvicorn `--proxy-headers` (nothing consumes it), consistent with Slice 1.

## 5. The compose service + networks

Added identically to `docker-compose.prod.yml` and `cli/internal/compose/docker-compose.yml`. **No `env_file: .env`** on the proxy — it receives only explicit vars; domain/email arrive via `${…}` interpolation from `--env-file .env`:

```yaml
  # One-shot: make the fresh (root-owned) ACME volume writable by the non-root proxy, then exit.
  # Required because the reproxy image is FROM scratch (no chown/shell) and cannot self-fix ownership.
  proxy-init:
    image: busybox@sha256:<PINNED_DIGEST>        # pinned; tiny; only used under the tls profile
    profiles: ["tls"]
    command: ["chown", "1001:1001", "/srv/acme"] # NON-recursive (not -R) — see note below
    volumes:
      - mathion_acme:/srv/acme
    network_mode: none
    cap_drop: [ ALL ]                            # runs as root only to chown; drop everything else
    cap_add: [ CHOWN ]                           # the sole capability the chown needs
    security_opt: [ "no-new-privileges:true" ]
    restart: "no"

  proxy:
    image: ghcr.io/umputun/reproxy@sha256:<PINNED_DIGEST>   # digest chosen + behavior-verified at implementation
    profiles: ["tls"]
    depends_on:
      app:
        condition: service_healthy
      proxy-init:
        condition: service_completed_successfully     # ACME dir is chowned before the proxy (uid 1001) starts
    ports:
      - "80:8080"     # reproxy HTTP: ACME HTTP-01 challenge + a temporary redirect to HTTPS (see §8)
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
    user: "1001:1001"                       # image defaults to root (for docker-socket discovery we don't use); drop it
    cap_drop: [ ALL ]
    security_opt: [ "no-new-privileges:true" ]
    read_only: true                          # scratch rootfs; only /srv/acme (a volume) is written
    tmpfs: [ /tmp ]                           # in case reproxy needs scratch space under read_only (verify at impl)
    # NO container healthcheck: the image is FROM scratch (no shell/curl/wget), so an in-container probe is impossible.
    # Liveness is checked host-side by the CLI after `up` (see §6.1 step 8 / §6.3). `up --wait` waits for "started".
    restart: unless-stopped
```

**Why the `chown` is non-recursive** (`chown 1001:1001`, not `chown -R`): under `cap_drop:[ALL]`+`cap_add:[CHOWN]` the root process has `CAP_CHOWN` but **not** `CAP_DAC_READ_SEARCH`/`CAP_DAC_OVERRIDE`, so a recursive walk that must traverse into an existing `0700` subdirectory owned by uid 1001 (reproxy's ACME account/key dirs) would hit `EACCES`. A non-recursive `chown` of the mount root needs no traversal, so `CAP_CHOWN` alone is sufficient — and it is enough: a **fresh** `mathion_acme` volume is an empty root-owned mountpoint (only the top dir needs re-owning; reproxy then creates everything inside as uid 1001), and on any **later** run reproxy's descendants are **already** 1001-owned, so re-chowning only the mount root is correct and idempotent. (The two reviewers split on whether `-R` works under CHOWN-only caps — one tested a fresh tree and it passed, the other flagged the `0700`-subdir traversal; non-recursive sidesteps the question entirely.)

`app` gains `networks: [default, frontend]`; **`db` is unchanged (stays on `default`)**. New top-level blocks (both files):

```yaml
networks:
  frontend: {}
  # `default` is compose's implicit network; app + db remain on it (no explicit block needed,
  # but app lists it explicitly alongside frontend).

volumes:
  mathion_pgdata: {}
  mathion_assets: {}
  mathion_acme: {}     # NEW — persisted ACME cert store (survives restarts; no re-issue)
```

**Confirmed reproxy facts** (README + source inspection of `app/proxy/ssl.go` + `app/main.go` + the Dockerfile, 2026-08-23): env vars `SSL_TYPE`, `SSL_ACME_EMAIL`, `SSL_ACME_FQDN`, `SSL_ACME_LOCATION`, `SSL_HTTP_PORT`, `STATIC_ENABLED`, `STATIC_RULES`, `LISTEN`, `MAX_SIZE` (flag `--max`, default `64K`); Docker listen defaults `0.0.0.0:8080`/`0.0.0.0:8443`; rule format `server,src,dest`; the final image is `FROM scratch` (binary-only, implicit root, no HEALTHCHECK) — hence the non-root proxy + the `proxy-init` chown one-shot (the image can't self-fix volume ownership). **Implementation must verify against the pinned digests:** that reproxy (uid 1001) can write `/srv/acme` after the init chown and that `read_only: true` + `tmpfs:/tmp` cover all of reproxy's write paths; that `busybox` is a suitable pinned init image; that the `STATIC_RULES` src `/` matches **all** paths (`/api/…`, `/courses/…`); and the redirect/HSTS behavior (§8).

## 6. The `mathion tls` command group

New `cli/cmd/tls.go`, registered in `root.go`.

### 6.1 `mathion tls enable --domain <fqdn> --email <addr>`
Both flags required. Runs under **`lockAndGuard`** (root check + operation lock + worker sweep + breadcrumb entry-check); `enable` is added to the breadcrumb **refuse set** in `classify()` (it brings services up on top of a possibly-unverified deployment).

1. **Require a valid, installed deployment** — reuse the same installed-deployment identity/state guard install-resume uses (`install.go:59` — a present, regular, private `.env` on the expected project), not merely "files exist"; else guide to `mathion install`. (Downgrade note: this guard does not add a compose-schema version allowlist, so running an **older** CLI's `tls enable` against a newer install would rewrite the on-disk compose with the older embed. That newer→older path is unsupported and documented; a schema-revision allowlist is a deferred hardening, not built in this slice.)
2. **Validate `--domain`:** a proper **DNS name** — lowercase ASCII, labels of 1–63 chars matching `[a-z0-9]([a-z0-9-]*[a-z0-9])?`, total ≤253, ≥2 labels; reject empty, `localhost`, IP literals, empty/leading/trailing-dot forms (`a..b`, `-a.example`, `a-.example`), and — implied by the charset — anything with `$ { } " ' \` whitespace or control chars, so a value can never carry dotenv/Compose interpolation syntax.
3. **Validate `--email`:** single `@`, a local part, and a domain validated by the same DNS-label routine; **reject `$ { } " ' \` whitespace and control chars.** (The current `ValidateEmail` at `cli/internal/config/validate.go:68` is too loose — `${POSTGRES_PASSWORD}@x.y` passes it, and because Compose **recursively interpolates** `.env` values that would expand the DB password into `SSL_ACME_EMAIL` and send it to Let's Encrypt. Rejecting `$` at the input boundary is the sole real defense — see §10.)
4. **Re-materialize the on-disk compose (CRITICAL for upgraders):** `update`/`self_update`/`restore` never rewrite `<CfgDir>/docker-compose.yml`, so after a CLI upgrade the on-disk copy predates Slice 5 (no `proxy` service, no `frontend` network) and `up … proxy` would fail with `no such service: proxy`. Under the lock, after the identity guard and before mutating `.env`, `AtomicWrite(<CfgDir>/docker-compose.yml, composeBytes())` (exactly as install's resume path does) to bring the on-disk compose to the embedded revision.
5. **Port preflight (only when the project's `proxy` container is not already running):** require host 80 + 443 bindable (test wildcard IPv4/IPv6 bindability rather than mere connectivity; Docker's own bind remains the authoritative backstop). Skipping keys off *actual proxy-running state*, not merely a non-empty domain.
6. **DNS preflight (warn, non-blocking):** best-effort A/AAAA lookup; warn that issuance waits until DNS points here; proceed.
7. **`SetTLS(domain, email)`** — atomic, validate-before-write, then reread + assert postcondition (mirrors `RepinVersion`, `env.go`): writes `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL`, `MATHION_BASE_URL` (built via `BuildBaseURL` for validator-consistency), `MATHION_COOKIE_SECURE=1`. The strict DNS-label validator (step 2) runs on `--domain` **before** `BuildBaseURL` — `BuildBaseURL` (`validate.go:22`) accepts a `host:port` form, but step 2 already rejected any `:`/port, so a port can never slip into `MATHION_BASE_URL`. Pair invariant: TLS fields are both-empty or both-valid; when enabled, `MATHION_BASE_URL == https://<domain>` and secure-cookie true. Sets `App.tlsEnabled=true`.
8. **Full-project `up -d --wait`** (profile now active; **pull allowed** — unlike `start`/`update`/`restore` this omits `--pull never` so the reproxy + busybox images are fetched on first enable; the app image is not re-resolved because its tag is unchanged). A whole-project up (not service-scoped) so `app` is recreated to join `frontend` and pick up the new env, `proxy-init` chowns the ACME volume, and the `proxy` is created; `db` (unchanged config) is not recreated. Then **poll readiness host-side** (the container has no healthcheck): the CLI best-effort TCP-dials `127.0.0.1:443` for a short bounded window and reports — non-fatal (issuance/DNS may still be pending).
9. **Report:** enabled for `https://<fqdn>`; cert obtained automatically shortly after start; if not HTTPS yet, check `mathion tls status` / `mathion logs`; ensure the firewall opens 80 + 443 and DNS points here. First enable briefly recreates `app` (db stays up). **A failed/timed-out enable leaves TLS enabled in `.env`** (with a possibly-unhealthy proxy); remedy is re-run `enable` or `mathion tls disable`.

Idempotent/update-capable: re-running with a new domain updates all four vars and recreates.

### 6.2 `mathion tls disable`
Production is HTTPS-only, so disable **never downgrades**. Runs under `lockAndGuard` (classified **proceed** on breadcrumb, like `stop`/containment). Steps:

1. **`compose rm -sf proxy` first, unconditionally** — before consulting `.env` state. Containment always carries `--profile tls` (§4.3), so this idempotently reaps a running proxy **even when `.env` reads disabled** (a corrupt/partial-edited `.env`, or an `enable` that half-completed). Issue it through a **captured-stderr seam** (`Runner.Stream`/`Output`, not `Runner.Run` — which streams stderr uncaptured at `runner.go:98`) so the result can be classified rather than blanket-swallowed: **rc=0** proceed (on Compose v5.1.2 `rm -sf proxy` returns rc=0 "No stopped containers" even when the service is absent — verified); **rc≠0 whose stderr matches "no such service: proxy"** (older Compose against a pre-Slice-5 on-disk compose) proceed — nothing to reap; **any other rc≠0** (daemon down, permission) is a **real error → abort disable and report** (do **not** `ClearTLS`, so TLS is never cleared while a proxy might still be running). A blanket "demote every rc" is wrong here for exactly that reason.
2. If `.env` was **not** enabled: report "TLS already disabled (ensured no bundled proxy is running)" + exit 0.
3. **`ClearTLS()`** — clear `MATHION_TLS_DOMAIN`/`EMAIL`; **leave `MATHION_BASE_URL` (https) + `MATHION_COOKIE_SECURE=1`**. Sets `App.tlsEnabled=false`.
4. **Report:** bundled proxy stopped; the app still expects HTTPS in front and is **currently unreachable** (loopback-only `127.0.0.1:8000`, secure cookies on) until you put your own TLS proxy in front or re-run `mathion tls enable`. If your proxy serves a different hostname, update `MATHION_BASE_URL`.

No `--plain` flag.

### 6.3 `mathion tls status`
Read-only (no lock, like `status`). Prints enabled/disabled (from `.env`, read fail-safe — a missing/corrupt `.env` reads as disabled, never a hard error); when enabled: `domain`, `email`, whether the `proxy` container is running (`compose ps proxy`), an optional best-effort host-side `127.0.0.1:443` reachability line, a `verify at https://<domain>` line, and a caveat that a running/reachable container does **not** confirm the certificate has issued (check `mathion logs` if HTTPS is failing).

## 7. Backend

**No changes.** (Rationale in §2/§4.5; verified by both reviewers.)

## 8. HTTP listener behavior — resolved by source inspection

reproxy source (`app/proxy/ssl.go`) shows that in `ssl.type=auto` the HTTP (port-80) server's handler is the challenge router: it serves ACME HTTP-01 challenges and **redirects all other requests to HTTPS** (upstream `master` uses `http.StatusTemporaryRedirect`, i.e. 307). The static proxy rules (app content) are bound **exclusively to the HTTPS listener** (`ListenAndServeTLS`). **Therefore there is no cleartext path to application content** — the "no plain HTTP in production" rule holds by the proxy's construction, not merely by assumption. (Behavior verified against upstream `master`; the exact status and this handler wiring are re-verified against the pinned digest at implementation.)

Residual (UX, not security): the exact redirect status code is version-dependent and **not** a security concern.

**Acceptance criteria (automated, §10):** with TLS enabled, an HTTP request carrying the configured `Host` for a normal app path must **never** return application content (assert non-app response — a redirect or a non-2xx), and the app must be served over HTTPS. HSTS is added on HTTPS responses if the pinned reproxy supports it (verified at implementation).

## 9. Configuration surface (`.env`) & docs

- Add `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL` to `GenerateEnv`/`RenderEnv` (emitted with **empty active assignments**, e.g. `MATHION_TLS_DOMAIN=`) — a commented form would break the generated-vs-example parity test (`env_test.go:201`, which ignores comments). Optional in `ValidateEnvComplete` (empty valid); the **conditional pair-consistency** check (§6.1-7) runs the **strict validators on the `.env`-resident values** (not just non-empty), so `update`/resume catch a hand-edited `.env` that smuggled interpolation syntax into `MATHION_TLS_EMAIL`.
- **Strict, interpolation-safe validators** in `cli/internal/config/validate.go` (tighten/replace the loose `ValidateEmail:68`) — proper DNS-label validation for the domain (and the email's domain part) plus rejection of `$ { } " ' \` whitespace and control chars (§6.1 steps 2–3), so a value can never carry dotenv/Compose interpolation syntax.
- `SetTLS`/`ClearTLS` helpers in `env.go` (siblings of `RepinVersion`): validate → atomic write → reread → assert.
- `deploy/.env.prod.example`: document both vars (empty active assignments + explanatory comments pointing at `mathion tls enable`).
- `README.md`: "Bundled HTTPS (`mathion tls`)" as the easy path; keep the external-proxy section; document firewall (open 80 + 443) + DNS requirements; **note the downgrade caveat** — running an **older** CLI's `tls enable` against a newer install rewrites the on-disk compose with the older embed (unsupported; upgrade the CLI first).
- `cli/cmd/install.go` `nextSteps`: add the `mathion tls enable …` hint.
- `deploy/man/mathion.1`: document the `tls` subcommand, incl. the same newer→older downgrade caveat.

## 10. Testing strategy

### Automated (CI)
- **`tls_test.go`** (hermetic via seams): strict domain/email validation (incl. rejecting `${POSTGRES_PASSWORD}@x.y` and other `$`/`{`/quote inputs); `SetTLS` writes all four vars + asserts postcondition; `ClearTLS` clears domain/email and **preserves** base-url/cookie; pair-consistency validation; `enable` requires both flags; `enable` re-materializes the on-disk compose before `up`; port preflight only when proxy not running; `status` output per state.
- **Interpolation-injection regression (validator is the defense, not compose):** Compose *recursively expands* `.env` values, so a `.env` literally holding `MATHION_TLS_EMAIL=${POSTGRES_PASSWORD}@x.y` **would** leak the secret into `SSL_ACME_EMAIL` — `docker compose config` does not neutralize it. The test therefore asserts the **input is rejected**: `tls enable`/`SetTLS` with that payload returns an error and leaves `.env` **byte-identical**; a *separate* documentation test may show that raw Compose *would* expand the sentinel (proving why the `$`-rejecting validator is mandatory).
- **Runner env-strip test** (`runner_test.go`): `COMPOSE_PROFILES`, `MATHION_TLS_DOMAIN`, `MATHION_TLS_EMAIL` stripped from the child env; ambient `COMPOSE_PROFILES=tls` does **not** leak through.
- **`composeArgs` profile test** (`root` test) — the **three-way** split: `--profile tls` present on start commands (`up`/`start`) **iff** `tlsEnabled`; **always** present on containment/inspection (`down`/`stop`/`rm`/`ps`) regardless of `tlsEnabled` (so `stop`/`uninstall` reach the proxy); and **absent on `pull`/`exec`/`config` regardless of `tlsEnabled`** (so `install`'s whole-project `compose pull` never fetches the proxy images on a non-TLS deploy); an **empty `sub`** falls to the no-profile bucket without panicking. Verified after an in-process `SetTLS`; `tlsEnabled` reads **fail-safe** (missing/corrupt `.env` → false).
- **Compose sync test:** extend `embed_test.go` coverage to the `proxy` + `proxy-init` services, the `frontend` network + `app`'s dual membership, and the `mathion_acme` volume; pin both the reproxy and busybox image lines.
- **`docker compose config`** parses cleanly without the profile and with `--profile tls`; assert `proxy`/`proxy-init` are on `frontend`/none, `db` on `default` only (shares no network with `proxy`), `app` on both `default` and `frontend`.
- **Purge test:** `uninstall --purge` removes `<project>_frontend` and `<project>_mathion_acme` **in addition to** the `<project>_default` network + pgdata/assets it already removes; and acme is **excluded** from the fresh-install refuse-guard (teardown_test + install-guard test).

### On-host integration (CI where dockerable; else documented manual)
- **HTTP-serves-no-app-content** (§8 acceptance) — bootable in a container without a public domain by hitting the HTTP listener directly.
- **>64 KiB upload** through the proxy succeeds (guards the `MAX_SIZE` fix).
- **Upgrade migration:** from a **pre-Slice-5 compose fixture** (app/db on `default`, no proxy), `tls enable` re-materializes compose and brings the stack onto `default`+`frontend` without stranding app↔db.
- **restore (standalone) with TLS enabled** restores the proxy + ACME-ownership invariant as a **non-gating, bounded, forward-only** step, **gated on `opts.WriteBreadcrumb==true`** — the shared `restoreEngine` is called by standalone restore (`restore.go:74`, `WriteBreadcrumb:true`) **and** by update auto-rollback (`update.go:113`, `WriteBreadcrumb:false`), so gating on the breadcrumb flag (or placing the step in the restore-command wrapper) keeps the **rollback path from ever issuing a proxy-up**. **`update`'s forward path needs no proxy-up:** it only `stop app` (`update.go:256`) + `up --wait app` (`update.go:328`, service-scoped) — the proxy is never stopped, keeps running, and re-resolves `app:8000` after `app` is recreated. The restore step, in order, each under a short independent timeout with errors demoted to a warning:
  1. **Bounded best-effort targeted `pull --policy missing proxy proxy-init`** (explicit service names → selected regardless of profile; **`--policy missing`** pulls only images not already present, so a cached same-host restore skips the registry entirely — a plain `pull` re-checks the registry even for a cached digest). A **new-host restore or post-`--purge`** has no cached `reproxy`/`busybox` images, and the subsequent one-off + up are `--pull never`; without this pull they would fail. It is **best-effort**: a warning (not an abort) if the registry is unreachable — the bounded timeout cancels a hung pull and the later `--pull never` steps use whatever is cached.
  2. **Chown one-shot, run synchronously via the codebase's one-off worker idiom** — `run --rm --no-deps --pull never --name mathion_proxyinit_<pid> --label io.mathion.worker=1 -T proxy-init` (as `update.go:313`/`restore.go:355` run their workers). The `--name`/`--label` are **mandatory** (not optional): they make the one-off reapable by the worker sweep, and on a **run error or timeout** the step must `forceRemoveWorker(context.WithoutCancel(ctx), …, mathion_proxyinit_<pid>)` (the existing helper, `restore.go:417`) **before** proceeding — a killed `run` can leave the container alive, and step 3 must not start the proxy over a half-done chown. This matches the codebase's existing worker cleanup verbatim (`update.go:103`, `restore.go:336-337`): `forceRemoveWorker` is deliberately called under `context.WithoutCancel` (so a cancelled/timed-out parent still cleans up before the lock releases) and is bounded by its **`workerRemoveTries` loop + the startup-sweep backstop**, not by a context deadline — do **not** wrap it in a per-call `WithTimeout` (that would break the "cleanup runs even if the parent is cancelled" guarantee). This is the correct primitive: **empirically on Compose v5.1.2 a standalone `up -d --wait proxy-init` returns rc=1** (a one-shot that *exits* is treated as a `--wait` failure, so its rc cannot distinguish a successful chown from a failed one), whereas `run` **returns the container's true exit code** (rc=0 on the chown, non-zero on failure), blocks until completion, and does not start the proxy. Restores ownership on a fresh/recreated root-owned `mathion_acme` volume that the uid-1001 proxy otherwise could not write.
  3. **`up -d proxy --pull never --no-deps`** — `--no-deps` keeps `app`/`db` undisturbed (the chown already ran in step 2, so skipping `proxy-init` here is intentional and safe).
  Hermetic tests: the **rollback** path (`WriteBreadcrumb:false`) issues **none** of the three steps; a **fresh root-owned `mathion_acme`** case asserts the targeted pull + `run proxy-init` precede `up proxy`; the `run proxy-init` seam surfaces a **non-zero chown exit** (not swallowed); and a Runner whose step **blocks until context cancellation** must not delay the restore's app gate or the rollback (assert the timeout cancels it **and force-removes the `proxy-init` worker before continuing**).
- **install-resume with TLS enabled** (`resume()`, `install.go:120`): before the whole-project `up -d --wait --pull never` (`install.go:144`, which now includes the TLS-profiled `proxy`/`proxy-init`), do the same **bounded targeted `pull --policy missing proxy proxy-init`** when `tlsEnabled` — otherwise a TLS-enabled resume on a new host, after a proxy digest bump, or on the pgdata-present fast-path (which skips the app pull entirely) hits `--pull never` with the proxy image absent and fails. Like restore, this pull is **best-effort/demoted** — the subsequent whole-project `up` is authoritative. (The app image keeps its existing pgdata-gated pull; only the re-issuable proxy images get this targeted pull.)
- **Real Let's Encrypt issuance** needs a public domain + DNS → **documented manual on-host verification** (same class as the amd64 cloud smoke), not a silent gap: install → `tls enable` → valid cert on `https://domain` → login works → `http://domain` returns no app content → SMTP notification still sends (app egress intact) → `tls disable` preserves posture → `status` reflects each state.

## 11. Files touched

- `docker-compose.prod.yml` + `cli/internal/compose/docker-compose.yml` — `proxy` (non-root hardened) + `proxy-init` (acme-volume chown one-shot) services, `frontend` network + `app`'s dual membership (db unchanged on `default`), `mathion_acme` volume (synced byte-for-byte).
- `cli/internal/compose/embed_test.go` — extend sync coverage + pin reproxy **and** busybox image lines.
- `cli/cmd/tls.go` **(new)** + `cli/cmd/tls_test.go` **(new)** — the command group; enable reuses the install-resume identity guard, then re-materializes the on-disk compose via `composeBytes()`/`AtomicWrite`.
- `cli/cmd/root.go` — register `tls`; `App.tlsEnabled` (read fail-safe at startup); **operation-sensitive** `--profile tls` in `composeArgs` — the **three-way** split: always for containment/inspection (`down`/`stop`/`rm`/`ps`/`logs`); start (`up`/`start`/`create`/`run`) only when enabled; **never** for anything else (`pull`/`exec`/`config`).
- `cli/internal/config/validate.go` (+test) — strict DNS-label + interpolation-safe domain/email validators.
- `cli/internal/config/env.go` (+`env_test.go`) — two optional vars; `SetTLS`/`ClearTLS`; pair-consistency in `ValidateEnvComplete` (runs the strict validators on `.env` values).
- `cli/internal/compose/runner.go` (+`runner_test.go`) — add the three keys to `strippedEnvKeys`.
- `cli/cmd/restore.go` — when TLS is enabled, restore the proxy + ACME-ownership invariant as a **separate, non-gating, bounded** step **after** the app-gated restore, **gated on `opts.WriteBreadcrumb==true`** (or placed in the restore-command wrapper) so the shared `restoreEngine`'s auto-rollback call (`update.go:113`, `WriteBreadcrumb:false`) issues **no** proxy-up. Order (§10): (1) bounded best-effort targeted `pull --policy missing proxy proxy-init` (present for new-host/post-`--purge`; skips the registry when cached); (2) chown one-shot **synchronously** via the one-off worker idiom `run --rm --no-deps --pull never --name mathion_proxyinit_<pid> --label io.mathion.worker=1 -T proxy-init` (returns the true exit code — **not** `up -d --wait proxy-init`, which returns rc=1 on a one-shot that exits), with **mandatory** name/label + `forceRemoveWorker` on error/timeout before step 3; (3) `up -d proxy --pull never --no-deps`. Each bounded, errors demoted.
- `cli/cmd/update.go` — **no forward proxy-up** (update only `stop app`/`up --wait app`; the proxy keeps running and re-resolves `app:8000`). Its sole obligation is that the auto-rollback `restoreEngine` call stays `WriteBreadcrumb:false` (so rollback issues no proxy-up). Tests: standalone restore runs pull→`run proxy-init`→`up proxy` (and surfaces a non-zero chown exit); the rollback path runs none; a blocking step never delays the app gate or the rollback.
- `cli/cmd/install.go` — `resume()` (`install.go:120`): when `tlsEnabled`, a **bounded best-effort targeted `pull --policy missing proxy proxy-init`** before the whole-project `up -d --wait --pull never` (`install.go:144`), so a TLS-enabled resume (new host / proxy digest bump / pgdata-present skip-pull) doesn't hit `--pull never` with the proxy image absent; `nextSteps` HTTPS hint.
- `cli/internal/dockerx/teardown.go` (+test) and `cli/cmd/uninstall.go` — `Purge` removes `<project>_mathion_acme` and `<project>_frontend` **in addition to** the `<project>_default` network + volumes it already removes; confirmation text updated. **acme is NOT added to the fresh-install refuse-guard** (`install.go:88`) — it holds only re-issuable certs, so a leftover acme volume must not block reinstall (auto-clean/ignore instead).
- `deploy/.env.prod.example`, `README.md`, `deploy/man/mathion.1`.

No `deploy/proxy/` directory — reproxy needs no config file.

## 12. Security considerations

- **Proxy holds no app/DB secrets** — no `env_file: .env`; only `SSL_*`/`STATIC_*`/`MAX_SIZE` (§5).
- **No secret-via-interpolation** — because Compose recursively expands `.env` values, the load-bearing defense is the **input validator** rejecting `$ { } " ' \` so a crafted domain/email can never reach `.env` and expand a secret into `SSL_ACME_EMAIL` (§6.1 steps 2–3); the regression test asserts the input is *rejected* (not that compose neutralizes it) (§10).
- **Network segmentation** — a compromised internet-facing proxy shares no network with `db` and cannot reach Postgres (`proxy` on `frontend`; `db` on `default`; they never share a network) (§4.4).
- **Proxy runs non-root + least-privilege** — `user: "1001:1001"` (made writable by the `proxy-init` chown one-shot), `cap_drop: [ALL]`, `no-new-privileges`, `read_only` rootfs + `tmpfs:/tmp` (§5).
- **reproxy image pinned by digest.**
- **No cleartext app content** — port 80 serves ACME challenges + a redirect to HTTPS only; app content is HTTPS-listener-only (§8); `STATIC_RULES` scoped to the FQDN; HSTS on HTTPS if supported.
- **Ports 80/443 exposed publicly** — intended; documented firewall requirement.
- **No new secrets** — ACME email is low-sensitivity, in `.env`.
- **Cert private keys** live in `mathion_acme` (container-owned); **excluded from `mathion backup`** (backup archives only DB + assets, `backup.go:149`) — re-issuable, avoids storing private keys. A restore to a **new host** re-issues (brief HTTP-only window); repeated enable/disable does **not** re-issue (the named volume persists — `compose rm` never deletes it); re-issue happens only on host loss, `--purge`, or a domain change.
- **Disable never downgrades** the HTTPS posture (§6.2).
- **App remains loopback-only** on `127.0.0.1:8000`; the proxy reaches it over `frontend`.

## 13. Open items / risks (implementation must close, verified against the pinned digest)

1. **Pinned digests + live behavior** — choose the reproxy **and busybox** digests and verify: the §8 HTTP redirect / no-app-over-HTTP behavior; that reproxy serves the ACME HTTP-01 challenge on its HTTP listener (host `80`→`8080`) so port-80 validation resolves (`SSL_HTTP_PORT` left at the Docker default — confirm, set explicitly if needed); that `STATIC_RULES` src `/` matches **all** app paths (`/api/…`, `/courses/…`), not just root; `MAX_SIZE=25M` effect; and HSTS support.
2. **Non-root + read-only compatibility** — confirm the ownership mechanism works end-to-end: the `proxy-init` one-shot chowns `mathion_acme` so reproxy (uid 1001) can write it under `read_only: true`, and that `tmpfs:/tmp` covers any other reproxy write path (else widen the writable set). Confirm busybox is an acceptable pinned init image (or substitute a smaller pinned one).
3. **Host-side readiness (replaces the impossible container healthcheck)** — the CLI polls `127.0.0.1:443` after `up` (§6.1 step 8); confirm `up --wait` treats the healthcheck-less proxy as ready on "started" and the poll is non-fatal/ACME-independent.
4. **App env pickup + migration on enable** — confirm the full-project `up` recreates `app` onto `default`+`frontend` and it picks up the new `.env` (secure cookie + base-url); confirm the pre-Slice-5 → Slice-5 compose migration (§10 upgrade test) and that SMTP egress survives (app stays on `default`, an egress bridge).
5. **restore/update proxy decoupling** — confirm the proxy is brought up as a **non-gating** step and that a slow/unhealthy proxy can never fail the deployment gate or the auto-rollback (§11 tests). Also confirm that after `update` recreates `app` (service-scoped `up app`, proxy untouched), the running reproxy **re-resolves `app:8000`** for new connections — a brief blip then recovery is expected (Go's `http.Transport` re-dials/re-resolves per new connection); verify against the pinned digest that no proxy restart is needed.
6. **Upload-limit coupling** — `MAX_SIZE=25M` covers the default `MATHION_MAX_FILE_SIZE=20 MiB`; document that raising the app's file-size limit above ~24 MiB requires raising `MAX_SIZE` too (or derive it), with a non-default-size proxy test.

---

## Appendix — command UX

```
mathion tls enable --domain example.edu --email admin@example.edu
mathion tls status
mathion tls disable
```
Production is HTTPS-only. Local development keeps plain HTTP via the existing dev workflow, unchanged.
