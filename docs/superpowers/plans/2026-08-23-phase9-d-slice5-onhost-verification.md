# Slice 5 — On-host verification runbook (pinned-digest sign-off)

Run on a Docker host. Items 1–4 need only a local host; item 5 needs a public
domain + DNS + open 80/443. Record PASS/FAIL beside each. Pinned digests:
reproxy sha256:456d9d2ac7321e2bbb729a5580259d4fc6b52d0310c6cb79c1e30350dd6ba0f7,
busybox sha256:7a3ebe5bfd1a4a19797d20b0c0bb39d44393e9a03fd852c0865b0f540d868df0.

## 0. Structural (docker compose config)
- `docker compose -p mathion_prod -f docker-compose.prod.yml --env-file .env config`
  parses cleanly with NO profile, and with `--profile tls`.
- With `--profile tls`, assert: `proxy` on `frontend` only; `proxy-init` on `none`;
  `db` on `default` only (shares NO network with `proxy`); `app` on `default` +
  `frontend`; proxy has no `env_file` and no app/DB secret in its environment.

## 1. HTTP serves no app content (spec §8 acceptance)
- Enable TLS on a throwaway domain (or point STATIC_RULES at a test host); bring the
  stack up under `--profile tls`.
- `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <fqdn>' http://127.0.0.1/`
  must be a redirect or non-2xx — NEVER 200 with app HTML. Confirm the redirect
  target is https. Confirm port 80 serves the ACME HTTP-01 challenge path.
- Verify the exact redirect status against the pinned reproxy; note whether HSTS is
  present on HTTPS responses.

## 2. >64 KiB upload through the proxy (MAX_SIZE=25M)
- POST a ~1 MiB body through the proxy; it must NOT be rejected at the proxy layer
  (reproxy default body cap is 64K; MAX_SIZE=25M must override it).

## 3. Upgrade migration (pre-Slice-5 -> Slice-5)
- Start from a pre-Slice-5 on-disk compose (app+db on default, no proxy). Run
  `mathion tls enable …`. Confirm it re-materializes the compose, brings the stack
  onto default+frontend, and does NOT strand app<->db. Confirm SMTP egress still
  works (app stays on default, an egress bridge).

## 4. restore / update decoupling
- Standalone restore with TLS enabled runs pull -> run proxy-init -> up proxy and
  the proxy comes back; a slow/unhealthy proxy never fails the restore gate.
- `mathion update` recreates app WITHOUT restarting the proxy; confirm reproxy
  re-resolves app:8000 for new connections (brief blip then recovery).
- Confirm `up -d --wait` treats the healthcheck-less proxy as ready on "started"
  and that the whole-project up does not error on the completed proxy-init one-shot.

## 5. Real Let's Encrypt issuance (public domain required)
- install -> `mathion tls enable --domain <fqdn> --email <addr>` -> a valid cert on
  https://<fqdn> -> login works -> http://<fqdn> returns no app content ->
  SMTP notification still sends -> `mathion tls disable` preserves the https posture
  -> `mathion tls status` reflects each state.

## Sign-off
- [x] Items 0–4 PASS on Ubuntu 24.04 host `mathion` (amd64, Docker CE + compose v2.x) / 2026-08-26.
- [x] Item 5 PASS on `test.mathion.org` / 2026-08-26 — real Let's Encrypt production cert
  (issuer `O=Let's Encrypt, CN=YE1`, TLSv1.3/h2, `ssl_verify=0`), PIN login over HTTPS,
  HTTP:80 → 307 (no app content), `tls disable` preserved `MATHION_BASE_URL=https://…` +
  `MATHION_COOKIE_SECURE=1` (no downgrade). Item 3 migration reused the cert (no re-issuance);
  4a restore left the proxy undisturbed; 4b app-recreate left the proxy `StartedAt` unchanged.
- Delivered as `cli-v0.4.0` (signed release + apt); reached the host via both `apt upgrade`
  and `mathion self-update` (Slice 4b path verified E2E against a real signed release).
- Not exercised: SMTP send (no SMTP configured on the test deploy; app on `default` net,
  egress path intact). Minor future hardening: no HSTS header on HTTPS responses.
