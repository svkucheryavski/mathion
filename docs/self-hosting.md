# Self-hosting Mathion

Requires: a Linux host with Docker + Compose v2 (the `mathion` CLI below installs
them on Ubuntu and Debian, and bundles the HTTPS proxy); a domain (A/AAAA) pointing at it;
inbound TCP **80 and 443** open (for ACME/Let's Encrypt); a reverse proxy for TLS
(reproxy primary, Caddy alternative — see below). These steps require a
**published** image — valid only after the maintainer has pushed a release and
made the GHCR package public.

## Server size

What to rent. These sizes are recommendations, not tested limits: Mathion has
not yet been run on a 1 GB or a single-core server.

| | Minimum | Recommended |
|---|---|---|
| CPU | 1 core | 2 cores |
| Memory | 1 GB, with a swap file | 2 GB |
| Disk | 10 GB | 20 GB or more |

- **Memory:** on a 4 GB Ubuntu 24.04 server right after an install, with the
  site idle, the whole server used about 770 MB. Mathion's three containers
  (the app, the database and the HTTPS proxy) used about 130 MB of that. Use
  grows as the site gets content and users. Importing a large course needs
  more for a while (not measured yet), so give a 1 GB server a swap file.
- **Disk:** on the same server the system, Docker and Mathion took about 4 GB.
  The rest is your data: the database, uploaded files, and the backups in
  `/var/lib/mathion/backups`. Each backup is a full copy of the database and
  the uploaded files, and while it is being made it briefly needs about twice
  that space. Mathion never deletes backups, and every `mathion update` makes
  one before it updates the database, so delete old backups from that folder now
  and then and keep the newest. An update also leaves the previous app image
  on disk.
- **CPU:** the app runs as one process, so it uses about one core. A second
  core leaves room for the database, backups and system updates next to it.

A swap file on a 1 GB server. Check first with `sudo swapon --show`: if it
prints anything, the server already has swap and you can skip this. Otherwise
these commands add 2 GB of swap that stays after a reboot:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Self-hosting with the `mathion` CLI

The recommended path. The `mathion` CLI installs and manages the whole stack for
you — no editing `.env` or running `docker compose` by hand. There are two
distinct steps: first install the CLI **binary**, then use it to stand up the
**deployment**.

**Install the CLI.** The one-liner downloads the latest `cli-v*` release, verifies
its signature and checksum (below), installs `mathion` to `/usr/local/bin`, and
then asks `Set up Mathion on this server now? [Y/n]`. Enter or `y` goes straight
on to `mathion install`; `n` prints the command to run later. It does not ask
when Mathion is already set up on the server, or its setup was started (it
prints how to finish it with `sudo mathion install` or update it), when there is no terminal to ask on, or when the release you pinned
(below) is older than this question (it prints the full `mathion install`
command instead):

```bash
curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh | sudo sh
```

Prefer to read before you run? Download, inspect, then execute:

```bash
curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh -o install.sh
less install.sh          # review what it does
sudo sh install.sh
```

*Check the release key (out of band).* The installer carries Mathion's release
key. To see which key it accepts, run this on the script you downloaded:

```bash
sed -n '/BEGIN PGP PUBLIC KEY BLOCK/,/END PGP PUBLIC KEY BLOCK/p' install.sh | gpg --show-keys
```

The first fingerprint it prints must be
`F00602DFE1BF8CD2B321FC72AD21D4AD294C31A0`, the one published on the project
site (https://svkucheryavski.github.io/mathion/) as
`F006 02DF E1BF 8CD2 B321  FC72 AD21 D4AD 294C 31A0`. This shows the key
the installer trusts, not that the rest of the script is honest: read it
before you run it. The copy in `deploy/keys/README.md` lives in this
repository, so it is not an independent check.

The installer verifies the release **signature** (authenticity) before the
**checksum** (integrity). It fetches `checksums.txt.asc` — a detached GPG
signature over `checksums.txt` made by Mathion's release subkey (`S_rel`) — and
rejects the download unless that signature validates against the installer's
embedded release key, pinned to the expected signing and primary fingerprints.
Only then does it verify the selected artifact's SHA-256 against the
now-authenticated `checksums.txt`. The signing key and its fingerprints are documented in
[`deploy/keys/README.md`](../deploy/keys/README.md). You can still inspect the
script and pin a known release tag (`sudo sh install.sh cli-v0.1.0`) for a
reproducible install.

**Stand up the deployment.** The `mathion` commands manage Docker containers, so
run them as root — prefix each with `sudo`. The installer runs this for you
when you answer yes; you can also run it yourself:

```bash
sudo mathion install
```

It asks only for what it needs:

1. **Docker.** When Docker is missing on Ubuntu 22.04 or later or Debian 12 or
   later (64-bit Intel/AMD or ARM), it asks
   `Docker is not installed. Install it from Docker's official packages?` and
   installs Docker Engine and Compose v2 from Docker's signed apt repository.
   On any other system it says how to install Docker yourself and stops; run
   `sudo mathion install` again afterwards. A Docker that already works is left
   as it is; when Docker from Docker's own packages works but Compose is
   missing, it offers to add only Compose. Once Docker works, it is set to start
   at boot.
2. **Site address** (`learn.school.edu`): a domain name, or `host:port`, with
   no `https://`. An IP address or a one-word name is refused here, because it
   cannot get a certificate. An address with a port (`learn.school.edu:8443`)
   is only for a server behind your own HTTPS proxy; it never gets the bundled
   HTTPS. Skipped when you pass `--domain`.
3. **Your email**, which becomes the first superuser's. Skipped when you pass
   `--admin-email`.
4. **HTTPS.** `Turn on HTTPS with a free Let's Encrypt certificate?` (default
   yes). Before turning it on, it checks that ports 80 and 443 are free and that
   the domain points at this server; when the domain points elsewhere, it asks
   `Turn on HTTPS anyway?` (default no). A `host:port` address never gets
   HTTPS, because a certificate needs a plain domain name.

Then it writes the config, pulls the image, starts the stack on
`127.0.0.1:8000`, migrates the database, creates the first superuser and, with
HTTPS on, starts the [bundled HTTPS proxy](#bundled-https-mathion-tls--the-easy-path)
and waits up to two minutes for the certificate.

It ends in one of two ways:

- **HTTPS is on.** It prints `✓ Mathion is running at https://<domain>`, your
  sign-in email and a first PIN. Browse to `https://<domain>` and sign in. If the
  certificate has not arrived within the wait, it says the site will work once
  it does and how to get a new PIN if this one runs out; open the site in a few
  minutes, or run `sudo mathion install` again to check.
- **HTTPS is off** (you answered no, a port was busy, the domain did not point
  here yet, or `--no-tls`). It says why, prints the `sudo mathion tls enable …`
  line that turns it on later, says that `sudo mathion install` again asks once
  more (for a `host:port` address, only the guide), and links the
  [guide for your own HTTPS proxy](#tls--reverse-proxy-external). Then run
  `sudo mathion pin <email>` for a PIN. Sign in over HTTPS, **not**
  `http://127.0.0.1:8000`: the Secure session cookie does not stick over plain
  HTTP.

Either way, `sudo mathion panel` then prints a link to the admin panel. Open it
in the browser where you are signed in. Its Set up page walks you through
email, the site name, the first course and sign-in rules. The link stops
working after 30 minutes without use; running the command again replaces it.

Running `sudo mathion install` again on a set-up server finishes an
interrupted install, or asks about HTTPS when it is still off; it never makes
a second deployment.

**Scripted installs.** `--yes` never asks: it needs `--domain` and
`--admin-email`, installs Docker when it is missing, and turns HTTPS on unless
you add `--no-tls`, a port is busy or Let's Encrypt refuses the email (the
ending says why). A domain that does not point here yet still gets HTTPS, with
a warning; it starts once DNS points here. `--no-tls` skips HTTPS, for a server
behind your own proxy. For example:

```bash
sudo mathion install --yes --domain school.edu --admin-email you@school.edu
sudo mathion install --no-tls --domain school.edu --admin-email you@school.edu
```

Without `--yes` and without a terminal, nothing is asked: a missing `--domain`
or `--admin-email` stops the install, so does a missing Docker, and HTTPS stays
off. Each case prints what to do instead.

**Survive a reboot.** The stack's containers use `restart: unless-stopped`,
which takes effect only when the Docker daemon starts at boot. `mathion install`
turns that on for you. On a system where it could not, it prints a note; run
this once:

```bash
sudo systemctl enable docker
```

**Command reference** (run each with `sudo` — the commands manage the Docker stack
or read root-owned config):

| Command | What it does |
| --- | --- |
| `mathion install [--domain <host[:port]>] [--admin-email <email>] [--version <tag>] [--yes] [--no-tls]` | Install and start a deployment, asking for what is missing (`--domain` has no scheme; `--yes` never asks and requires `--domain` + `--admin-email`; `--no-tls` skips the bundled HTTPS). |
| `mathion start` | Start the stack (`docker compose up -d --wait`). |
| `mathion stop` | Stop the stack (containers stopped; data + config retained). |
| `mathion status` | Show stack status + `/health`. |
| `mathion logs [app\|db]` | Show stack logs (optionally for a single service). |
| `mathion tls enable --domain <fqdn> --email <email>` / `tls status` / `tls disable` | Bundled HTTPS with a Let's Encrypt certificate (see [Bundled HTTPS](#bundled-https-mathion-tls--the-easy-path)). |
| `mathion backup [--out <path>]` | Back up the database and uploaded files to an archive in `/var/lib/mathion/backups` (`--out` also copies it to a new file). |
| `mathion restore <archive> [--yes]` or `mathion restore --latest [--yes]` | Restore the database and uploaded files from a backup archive (`--latest`: the newest backup in `/var/lib/mathion/backups`). **Replaces the current data.** |
| `mathion update [--version <tag>] [--yes] [--no-rollback] [--no-reconcile]` | Update the deployment: pull and check the new image, back up, migrate, check health, and roll back on failure. |
| `mathion reconcile [--yes]` | Apply this CLI's bundled stack definition to the running deployment (see [Applying a stack-definition change](#applying-a-stack-definition-change-after-a-cli-upgrade)). |
| `mathion self-update [--check] [--yes]` | Update the `mathion` command itself (see [Updating the CLI](#updating-the-cli-mathion-self-update)). |
| `mathion version` | Print CLI + pinned image version. |
| `mathion licenses` | Print the licenses of Mathion and the code built into it. |
| `mathion superuser <email>` | Create or promote a superuser account (idempotent). |
| `mathion pin <email>` | Issue a sign-in PIN (the panel's Settings page sets how long a PIN lasts). |
| `mathion panel` | Print a link to the admin panel. Sign in first and open it in the same browser; it stops working after 30 minutes without use, and running the command again replaces it. |
| `mathion branding reset [--all] [--yes]` | Remove the colour changes from the panel's Branding page (`--all` also resets the site name, logo and tab icon). |
| `mathion uninstall` | Stop and remove containers (keeps data + config). |
| `mathion uninstall --purge` | Also remove volumes and config — **destructive**; requires typing the project name to confirm. |

## Manual setup (docker compose)

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

# 6. Issue the first-login PIN LAST (it prints how long the PIN lasts)
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser pin you@school.edu
#    Then browse to https://<domain> (test via HTTPS, not http://127.0.0.1:8000 —
#    the Secure session cookie won't persist over plain HTTP) and log in with
#    email + PIN.

# 7. Open the superuser panel; its Set up page walks you through email, the site
#    name, the first course and sign-in rules:
docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser activate
```

## Bundled HTTPS (`mathion tls`) — the easy path

`mathion install` turns this on when you answer yes. Run the command below by
hand only when the install left HTTPS off (its last lines print this exact
command). If your server has a public domain and ports 80 + 443 open, Mathion can
run its own TLS-terminating reverse proxy and obtain a Let's Encrypt certificate
for you — no cert files to manage:

    sudo mathion tls enable --domain learn.example.edu --email you@example.org

This stands up a bundled, network-segmented reproxy (it shares no network with the
database), obtains and auto-renews the certificate, and serves the app over HTTPS.
Check state any time with `mathion tls status`; stop it with `mathion tls disable`.

**Requirements:** DNS for the domain must point at this host, and the firewall must
allow inbound TCP 80 (ACME HTTP-01 challenge + redirect) and 443 (HTTPS).

**Production is HTTPS-only.** `mathion tls disable` stops the bundled proxy but does
**not** downgrade to plain HTTP — the app keeps `Secure` cookies and its
`https://…` base URL, so put your own TLS proxy in front (or re-enable) to reach it.

**Upload limit:** the superuser panel's Settings page sets the largest file, up to
50 MB. The bundled proxy allows request bodies up to 60 MiB, enough for that
ceiling. The compose file an older `mathion` CLI wrote allows only 25 MiB: upgrade
the CLI (`mathion self-update`) and run `mathion update`.

**Downgrade caveat:** running an **older** `mathion` CLI's `tls enable` against a
**newer** install rewrites the on-disk compose with the older embedded copy. That
newer→older path is unsupported — upgrade the CLI first (`mathion self-update`).

Prefer your own external proxy? That path is unchanged — see below.

## TLS / reverse proxy (external)

Primary — **reproxy** (host-run; pin a specific release and verify the flags):

```bash
reproxy --listen=:443 --ssl.type=auto --ssl.fqdn=<domain> --ssl.http-port=80 \
        --max=60M --timeout.resp-header=30s --timeout.write=15m \
        --static.enabled --static.rule='*,/,http://127.0.0.1:8000'
```

Host mode defaults to `127.0.0.1:443`, so `--listen=:443` is required; ACME http-01
needs port 80; `--static.enabled` is required alongside `--static.rule`; and
reproxy's default `--max` is **64K** — raise it above the largest file set in the
panel's Settings (up to 50 MB) or uploads are rejected at the proxy. Its default
5 s wait for an answer is shorter than the panel's 20 s email test, and its 30 s
limit per request is too short for a big upload or download on a slow link: raise
both, as above. Binding 80/443 needs root or `CAP_NET_BIND_SERVICE`.

Alternative — **Caddy** (no low default body limit; auto-manages 80/443 + ACME):

```
<domain> {
    reverse_proxy 127.0.0.1:8000
}
```

A **containerized** proxy cannot reach the loopback-only `127.0.0.1:8000` publish —
join the compose network and target `http://app:8000`, or use host networking.

## Operations

- **Rate limits:** PIN requests and wrong PIN tries are limited per email per hour;
  the superuser panel's Settings page sets both. If someone is locked out,
  `sudo mathion pin <email>` makes a new PIN: it skips the request limit and clears
  that email's wrong tries. On the manual docker-compose path, which has no
  `mathion` command, run
  `docker compose -f docker-compose.prod.yml exec app python -m mathion.superuser pin <email>`.
- **Data safety:** `mathion_pgdata` + `mathion_assets` hold all state (project-prefixed as
  `mathion_prod_mathion_pgdata` / `mathion_prod_mathion_assets` in `docker volume ls`).
  **`docker compose -f docker-compose.prod.yml down -v` permanently deletes them** — use
  `docker compose -f docker-compose.prod.yml down` (no `-v`) to stop. Always pass
  `-f docker-compose.prod.yml` so the command targets the prod stack, not the dev `db`.
  Backup on the manual docker-compose path (with the `mathion` CLI, `sudo mathion backup` takes the
  same pair, online):
  `docker compose -f docker-compose.prod.yml exec db pg_dump -U mathion mathion > backup.sql`
  plus a snapshot of the assets volume. For a point-in-time-consistent pair, stop `app` first
  (`docker compose -f docker-compose.prod.yml stop app`) so a concurrent asset change can't leave
  the dump referencing a since-deleted file — at the cost of a longer stop.
- **DB password is first-init-only:** don't change `POSTGRES_PASSWORD` after the
  first `up` against an existing `mathion_pgdata`.
- **Upgrade on the manual docker-compose path** (brief downtime; with the `mathion` CLI,
  `sudo mathion update` pulls, backs up, migrates and restarts, rolling back on failure): back up →
  stop the proxy → `docker compose -f docker-compose.prod.yml stop app` → bump
  `MATHION_VERSION` → `pull` → migrate on the new image
  (`docker compose -f docker-compose.prod.yml run --rm app alembic upgrade head`) →
  `up -d --wait` → restart the proxy. (`/health` does no DB check, so migrating
  before serving avoids running new code on the old schema.)

## Updating the CLI (`mathion self-update`)

`mathion self-update` upgrades the **`mathion` CLI binary itself** — and nothing
else. It does **not** touch your deployment, its containers, or the database;
updating the running Mathion **stack** is a separate command, `mathion update`.

It updates the binary that `install.sh` put at `/usr/local/bin/mathion`: it
resolves the newest verifiable `cli-v*` release, downloads its `checksums.txt`,
verifies the detached signature against the binary's compiled-in release key
(`S_rel`), checks the downloaded binary's SHA-256 against the now-authenticated
checksums, and swaps it into place.

If a system package owns the binary (for example an old .deb), self-update
refuses and names the package; nothing is changed.

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
[`deploy/keys/README.md`](../deploy/keys/README.md).

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

### Applying a stack-definition change after a CLI upgrade

`mathion self-update` updates the CLI binary, not the running deployment: it does not
apply the bundled stack definition to the containers you already have running.

`mathion update` (the in-place deployment upgrade) now **also** applies this
release's embedded stack definition, not just the app image, so a single
`update` brings the deployment fully up to the CLI release. A few related points:

- `--no-reconcile` applies only the image upgrade and defers the stack change; a
  drift notice reminds you, and you apply it later with `sudo mathion reconcile`.
- **Behavior change:** a same-tag `update --yes` on a host whose compose has
  drifted now applies that drift — a call that used to be a no-op can briefly
  recreate the bundled TLS proxy, a short HTTPS blip.
- **Exit code 2** means the image/database update committed but post-commit work
  or verification is still pending — follow the recovery instructions in the
  message. Usually that is `sudo mathion reconcile`; if the message instead says
  the recovery breadcrumb could not be removed, remove it by hand as the message
  directs (`reconcile` refuses while the breadcrumb remains). The database is never
  rolled back; in the rare case the restore also failed the runtime may be
  degraded, so check `mathion status`. A same-tag apply that fails is exit 1
  (nothing committed).

To apply a stack-definition change on its own — after a CLI-only upgrade, or when
you deferred it with `--no-reconcile` — use:

```
sudo mathion reconcile
```

`mathion reconcile` re-materializes the bundled Docker Compose and recreates only
the services whose configuration changed (a brief interruption of those services).
`mathion status` tells you when a reconcile is needed.
