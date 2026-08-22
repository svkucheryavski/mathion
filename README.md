# Mathion

A learning-management backend (FastAPI + SQLAlchemy 2.0 + Alembic) on
**PostgreSQL 17**, with a Svelte 5 frontend.

## Prerequisites

- Docker (for the local Postgres) and Docker Compose
- Python 3.12+ with the backend virtualenv at `backend/.venv`

## Dev bootstrap

From the repository root:

```bash
# 1. Start the local Postgres (compose service `db`, matches the config default URL).
#    Run from the repo root, where docker-compose.yml lives.
docker compose up -d --wait db

# 2-4. The remaining commands run from the backend/ directory.
cd backend

# 2. Create the schema.
.venv/bin/alembic upgrade head

# 3. (optional) Seed demo data.
.venv/bin/python -m scripts.seed_demo

# 4. Run the app.
.venv/bin/uvicorn mathion.main:app --reload
```

Or use the dev runner scripts:

- `./run-debug.sh` — start Postgres, then the backend in developer mode (login PINs
  printed to stdout; assumes the schema already exists — run step 2 once first).
- `./run-dashboards-smoke.sh` — start Postgres, migrate, seed the teacher-dashboards
  smoke fixture, then serve. Assumes a clean database; to reset, drop the compose
  volume first: `docker compose down -v && docker compose up -d --wait db`.

## Configuration

Settings come from environment variables with the `MATHION_` prefix (e.g.
`MATHION_DATABASE_URL`, `MATHION_DEBUG`). The app does **not** read a `.env`
file — any `.env` is only for `docker compose` and for values you `export`
yourself. `database_url` defaults to the local docker Postgres
(`postgresql+psycopg://mathion:mathion@localhost:5432/mathion`) for zero-config
dev.

**In production, `MATHION_DATABASE_URL` is required.** If it is unset, the app
silently falls back to the localhost dev default (and fails loud with a
connection error). On startup the app logs its password-redacted database
target so a misconfigured deploy is visible in the logs.

## Tests

The suite runs against a dedicated `mathion_test` database on the same local
Postgres:

```bash
cd backend && .venv/bin/pytest -q
```

## Self-hosting Mathion (production)

Requires: a Linux host with Docker + Compose v2; a domain (A/AAAA) pointing at it;
inbound TCP **80 and 443** open (for ACME/Let's Encrypt); a reverse proxy for TLS
(reproxy primary, Caddy alternative — see below). These steps require a
**published** image — valid only after the maintainer has pushed a release and
made the GHCR package public.

### Self-hosting with the `mathion` CLI

The recommended path. The `mathion` CLI installs and manages the whole stack for
you — no editing `.env` or running `docker compose` by hand. There are two
distinct steps: first install the CLI **binary**, then use it to stand up the
**deployment**.

**Install the CLI.** The one-liner downloads the latest `cli-v*` release, verifies
its checksum against the release `checksums.txt`, and installs `mathion` to
`/usr/local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh | sudo sh
```

Prefer to read before you run? Download, inspect, then execute:

```bash
curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh -o install.sh
less install.sh          # review what it does
sudo sh install.sh
```

The installer verifies the release **signature** (authenticity) before the
**checksum** (integrity). It fetches `checksums.txt.asc` — a detached GPG
signature over `checksums.txt` made by Mathion's release subkey (`S_rel`) — and
rejects the download unless that signature validates against the installer's
embedded release key, pinned to the expected signing and primary fingerprints.
Only then does it verify the selected artifact's SHA-256 against the
now-authenticated `checksums.txt`. The signing key and its fingerprints are documented in
[`deploy/keys/README.md`](deploy/keys/README.md). You can still inspect the
script and pin a known release tag (`sudo sh install.sh cli-v0.1.0`) for a
reproducible install.

**Install via apt (Debian/Ubuntu, alternative to `curl | sh`).** This adds
Mathion's apt repository so `mathion` upgrades with `apt upgrade` alongside the
rest of the system. The keyring bootstrap below is **trust-on-first-use (TOFU)**:
the first keyring fetch is trusted exactly as received, so verify its fingerprint
out of band (see below) before relying on it.

```bash
sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://svkucheryavski.github.io/mathion/deb/mathion-archive-keyring.gpg \
  | sudo tee /usr/share/keyrings/mathion-archive-keyring.gpg >/dev/null
sudo chmod 0644 /usr/share/keyrings/mathion-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/mathion-archive-keyring.gpg] \
  https://svkucheryavski.github.io/mathion/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/mathion.list
sudo apt update && sudo apt install mathion
```

*Verify the key fingerprint (out of band).* Because the first fetch is TOFU, the
maintainer publishes the primary key **fingerprint** so you can confirm the
keyring you received is genuine before trusting it. Display the fingerprint of
the keyring you just installed:

```bash
gpg --show-keys /usr/share/keyrings/mathion-archive-keyring.gpg
```

and compare it against the published fingerprint (`<primary-key-fingerprint>`).
The maintainer **records** the fingerprint in
[`deploy/keys/README.md`](deploy/keys/README.md) (§4, "Record the fingerprints")
once the offline key exists, but that file lives in this same repository — the
same origin as the keyring — so it is bookkeeping, not an independent check.
Confirm the fingerprint against a genuinely **independent channel** (the project
website or a signed announcement) before trusting the keyring, and only proceed
if the values match.

*Use one channel, not both.* apt installs the binary to `/usr/bin/mathion`, while
the `curl | sh` installer above installs to `/usr/local/bin/mathion`. On the
default Debian/Ubuntu `PATH`, `/usr/local/bin` comes **before** `/usr/bin`, so a
`curl | sh` binary **shadows** the apt-managed one — you would run the
hand-installed copy while apt silently updates a binary that normal PATH lookup
never selects. Pick **one channel** and stick with it. The `.deb` guards against the
mix: its postinst emits a warning (`… will shadow this apt package`) when it
detects a pre-existing `/usr/local/bin/mathion`.

**Stand up the deployment.** The `mathion` commands manage Docker containers, so
run them as root — prefix each with `sudo`. Pass the deployment **domain** and
**admin email** as flags (both are required):

```bash
sudo mathion install --domain school.edu --admin-email you@school.edu
```

`--domain` is a bare host or `host:port` — **no scheme**. This writes the config,
pulls the image, starts the stack on `127.0.0.1:8000`, migrates the database, and
creates the first superuser. For scripted or CI installs, add `--yes`; it requires
both `--domain` and `--admin-email` to be set. (Interactive prompting for omitted
values is planned but not yet available — supply both flags for now.)

Then finish setup:

1. Put a TLS reverse proxy in front of `127.0.0.1:8000` — see
   [TLS / reverse proxy (external)](#tls--reverse-proxy-external) below. Confirm
   `https://<domain>` loads with a valid cert before continuing (ACME + DNS can
   take minutes).
2. Issue the first-login PIN (it expires in 10 minutes):

   ```bash
   sudo mathion pin you@school.edu
   ```

3. Browse to **`https://<domain>`** and log in with your email + PIN. Log in over
   HTTPS, **not** `http://127.0.0.1:8000` — the Secure session cookie won't persist
   over plain HTTP, so a login there silently fails to stick.

**Survive a reboot.** The stack's containers use `restart: unless-stopped`, but
that policy only takes effect if the Docker daemon itself starts at boot. Enable
it once:

```bash
sudo systemctl enable docker
```

**Command reference** (run each with `sudo` — the commands manage the Docker stack
or read root-owned config):

| Command | What it does |
| --- | --- |
| `mathion install --domain <host[:port]> --admin-email <email> [--version <tag>] [--yes]` | Install and start a deployment (`--domain` has no scheme; `--yes` is non-interactive and requires `--domain` + `--admin-email`). |
| `mathion start` | Start the stack (`docker compose up -d --wait`). |
| `mathion stop` | Stop the stack (containers stopped; data + config retained). |
| `mathion status` | Show stack status + `/health`. |
| `mathion logs [app\|db]` | Show stack logs (optionally for a single service). |
| `mathion version` | Print CLI + pinned image version. |
| `mathion superuser <email>` | Create or promote a superuser account (idempotent). |
| `mathion pin <email>` | Issue a first-login PIN (expires in 10 min; rate-limited 3/hour). |
| `mathion uninstall` | Stop and remove containers (keeps data + config). |
| `mathion uninstall --purge` | Also remove volumes and config — **destructive**; requires typing the project name to confirm. |

### Manual setup (docker compose)

Work from a directory containing `docker-compose.prod.yml`.

```bash
# 1. Configure
cp deploy/.env.prod.example .env
#    Edit .env: set MATHION_BASE_URL; generate MATHION_SECRET_KEY (`openssl rand -base64 48`)
#    and POSTGRES_PASSWORD (`openssl rand -hex 24`, pasting the SAME value into
#    MATHION_DATABASE_URL); set MATHION_VERSION to the current release tag (see the
#    repo's Releases/Packages page, e.g. v0.1.0).

# 2. Pull + start
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --wait

# 3. Migrate the database
docker compose -f docker-compose.prod.yml exec app alembic upgrade head

# 4. Create the first superuser
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser create-superuser you@school.edu

# 5. Start your reverse proxy → 127.0.0.1:8000 (below) and confirm https://<domain>
#    loads with a valid cert FIRST (ACME + DNS can take minutes).

# 6. Issue the first-login PIN LAST (it expires in 10 minutes)
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser pin you@school.edu
#    Then browse to https://<domain> (test via HTTPS, not http://127.0.0.1:8000 —
#    the Secure session cookie won't persist over plain HTTP) and log in with
#    email + PIN.

# 7. (optional) Superuser panel URL:
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser activate
```

### TLS / reverse proxy (external)

Primary — **reproxy** (host-run; pin a specific release and verify the flags):

```bash
reproxy --listen=:443 --ssl.type=auto --ssl.fqdn=<domain> --ssl.http-port=80 \
        --max=25M --static.enabled --static.rule='*,/,http://127.0.0.1:8000'
```

Host mode defaults to `127.0.0.1:443`, so `--listen=:443` is required; ACME http-01
needs port 80; `--static.enabled` is required alongside `--static.rule`; and
reproxy's default `--max` is **64K** — raise it above `MATHION_MAX_FILE_SIZE`
(20 MiB) or uploads are rejected at the proxy. Binding 80/443 needs root or
`CAP_NET_BIND_SERVICE`.

Alternative — **Caddy** (no low default body limit; auto-manages 80/443 + ACME):

```
<domain> {
    reverse_proxy 127.0.0.1:8000
}
```

A **containerized** proxy cannot reach the loopback-only `127.0.0.1:8000` publish —
join the compose network and target `http://app:8000`, or use host networking.

### Operations

- **Rate limits:** PIN issuance 3/hour, verify failures 5/hour (both per email). If
  locked out during setup, wait an hour or clear the `rate_limit_entries` table.
- **Data safety:** `mathion_pgdata` + `mathion_assets` hold all state (project-prefixed as
  `mathion_prod_mathion_pgdata` / `mathion_prod_mathion_assets` in `docker volume ls`).
  **`docker compose -f docker-compose.prod.yml down -v` permanently deletes them** — use
  `docker compose -f docker-compose.prod.yml down` (no `-v`) to stop. Always pass
  `-f docker-compose.prod.yml` so the command targets the prod stack, not the dev `db`.
  Interim backup (until Slice 3 adds `mathion backup`):
  `docker compose -f docker-compose.prod.yml exec db pg_dump -U mathion mathion > backup.sql`
  plus a snapshot of the assets volume. For a point-in-time-consistent pair, stop `app` first
  (`docker compose -f docker-compose.prod.yml stop app`) so a concurrent asset change can't leave
  the dump referencing a since-deleted file — at the cost of a longer stop.
- **DB password is first-init-only:** don't change `POSTGRES_PASSWORD` after the
  first `up` against an existing `mathion_pgdata`.
- **Interim upgrade (brief downtime; until Slice 3's `mathion update`):** back up →
  stop the proxy → `docker compose -f docker-compose.prod.yml stop app` → bump
  `MATHION_VERSION` → `pull` → migrate on the new image
  (`docker compose -f docker-compose.prod.yml run --rm app alembic upgrade head`) →
  `up -d --wait` → restart the proxy. (`/health` does no DB check, so migrating
  before serving avoids running new code on the old schema.)

## Updating the CLI (`mathion self-update`)

`mathion self-update` upgrades the **`mathion` CLI binary itself** — and nothing
else. It does **not** touch your deployment, its containers, or the database;
updating the running Mathion **stack** is a separate command, `mathion update`.

How it behaves depends on how the binary was installed:

- **apt-managed** (`/usr/bin/mathion`, from the apt repository) — self-update does
  **not** replace the binary. apt owns it, so self-update just prints the apt
  command to run and exits (this is also what `--check` does on an apt host):

  ```bash
  sudo apt update && sudo apt install --only-upgrade mathion
  ```

- **`curl | sh`** (`/usr/local/bin/mathion`, from `install.sh`) — self-update
  resolves the newest verifiable `cli-v*` release, downloads its `checksums.txt`,
  verifies the detached signature against the binary's compiled-in release key
  (`S_rel`), checks the downloaded binary's SHA-256 against the now-authenticated
  checksums, and swaps it into place.

**Flags.**

- `--check` reports whether a newer installable release exists and exits
  **without changing anything**. It needs **no root** and performs no swap — safe
  to run as any user or from a scheduled check.
- `--yes` skips the confirmation prompt for scripted upgrades. The swap writes to
  `/usr/local/bin`, so the update itself still requires root
  (`sudo mathion self-update`).

**Guarantees.** self-update is **forward-only**: it moves to a release *greater*
than the one you are running and never downgrades or pins an arbitrary version.
It installs a release **only** after that release's `checksums.txt` signature
verifies against the compiled-in `S_rel` release key **and** the downloaded
binary's checksum matches; any verification, download, or staging failure aborts
**before the running binary is touched** (fail-closed). The one exception is a
rare post-swap durability-uncertain case: the replacement is already in place but
a directory `fsync` did not confirm — self-update reports that explicitly rather
than claiming a clean success or implying nothing changed. The signing key and its
fingerprints are documented in
[`deploy/keys/README.md`](deploy/keys/README.md).

**A key rotation may take two runs.** The verifying key is compiled into the
binary, so crossing a maintainer key rotation uses a *transition release* rather
than a re-fetched keyring: your current binary first updates to the transition
release (still signed by the key it already trusts, but carrying the new key),
and a **second** `mathion self-update` then reaches the release signed by the new
key. Run `mathion self-update` again **after a run that installs the transition
release** to pick up the new-key release. If a run instead reports **"already up
to date"** during a rotation window, the new-key successor is likely not published
yet — retry **later** rather than immediately.

**Debian staff-group hosts (`/usr/local` remediation).** Before swapping,
self-update requires `/usr/local/bin` and every ancestor up to `/` to be
root-owned and neither group- nor world-writable. Debian hosts that carry
`/etc/staff-group-for-usr-local` (an upgrade-path default) have `base-files` set
**both** `/usr/local` and `/usr/local/bin` to `root:staff 2775` — group-writable
— so self-update fail-closed-refuses and names the offending component. The
ancestry walk rejects **any** group-writable component from `/`, so fixing only
the leaf (`/usr/local/bin`) leaves `/usr/local` still refused; repair **both**:

```bash
sudo chgrp root /usr/local /usr/local/bin && sudo chmod 0755 /usr/local /usr/local/bin
```

Removing `/etc/staff-group-for-usr-local` alone does **not** re-permission an
already-created directory — it only stops *future* directories from being
staff-owned — so the `chgrp`/`chmod` above is what actually clears the refusal.
