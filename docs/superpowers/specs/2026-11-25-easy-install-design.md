# Easier install — design

Status: APPROVED by the owner, 2026-11-25, after a builder check (the "my call" items included). Branch `feat/easy-install`, started from `docs/readme-split`.

## Why

Mathion is meant for schools and teachers, and the person who installs it is usually not a developer. Today a fresh server needs Docker installed by hand, `systemctl enable docker`, and five `mathion` commands, one of them a long `docker compose … exec` line (see the README's Install section on `docs/readme-split`). The owner wants installation and administration "as easy as possible".

**Success:** on a fresh Ubuntu or Debian server, one command line plus a few answered questions ends with Mathion running over HTTPS, the admin holding a first sign-in PIN, and one short command to open the admin panel.

## Goals

1. The one-line installer leads straight into setup: after it installs `mathion`, it asks "Set up Mathion on this server now?" and runs `mathion install` with the keyboard attached.
2. `mathion install` asks for anything not given as a flag: the site address and the admin email.
3. If Docker is missing on Ubuntu or Debian, `mathion install` offers to install it from Docker's official package source, and does so only on a yes. On other systems it stops with clear instructions.
4. HTTPS is on by default: `install` asks "Turn on HTTPS with a free Let's Encrypt certificate? [Y/n]" and, on yes, does what `mathion tls enable` does, using the admin email for Let's Encrypt.
5. Before the certificate is requested, `install` checks that the site address really reaches this server.
6. `install` ends by printing the admin's first sign-in PIN and the panel command.
7. A new command, `sudo mathion panel`, prints the admin panel link.
8. The README Install section and the guide (`docs/self-hosting.md`) describe the new flow.

## Non-goals

- Setting up email (SMTP) from the command line: the panel's Set up page does it.
- Automatic Docker install on systems other than Ubuntu and Debian.
- Removing Docker on `mathion uninstall`.
- Changing the manual docker-compose path in the guide.
- Releasing: tagging `cli-v0.9.0` stays the maintainer's step.

## Anti-goals (a failure even if it works)

- Changing the server without a yes: installing Docker or adding a package source silently.
- Weakening any signature check: Mathion's own release check stays as it is, and Docker's signing key is pinned by fingerprint.
- Removing or replacing packages the admin already has.
- A scripted install (`--yes`, or no keyboard attached) that stops to ask a question.

## Constraints

- Supported for automatic Docker install (owner, 2026-11-25): Ubuntu 22.04 and 24.04, Debian 12 and 13, on 64-bit Intel/AMD or ARM, matching `deploy/install.sh`'s architecture check. A newer release of either is accepted when Docker's package source has it; otherwise it gets the instructions.
- Docker source (owner, 2026-11-25): Docker's official apt repository (`download.docker.com`), as in Docker's Debian and Ubuntu install guides. Packages: `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-compose-plugin`. Debian 12's own packages are not an option: they ship Docker 20.10 and Compose 1.29, not Compose v2.
- Docker's signing key (my call, from the builder check): `mathion` carries only the key's fingerprint, downloads the key from `https://download.docker.com/linux/<ubuntu|debian>/gpg`, checks the fingerprint with the existing `ProtonMail/go-crypto` library, and refuses on a mismatch. Docker's current install guide no longer prints the fingerprint, so the builder confirms `9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88` from two independent sources (for example the key downloaded from `download.docker.com` and a public keyserver) and records both in the plan.
- Docker is checked before the existing startup check that runs `docker ps`, so a server without Docker reaches the install question instead of an error. Supported systems are detected from the `ID` and `VERSION_ID` fields of `/etc/os-release`. If installing Docker's packages would remove packages already on the server (for example `containerd`, `runc` or `podman-docker`), `install` stops with instructions.
- When the installer runs as `curl … | sh`, its standard input is the script, so prompts read from `/dev/tty`. If there is no terminal, it asks nothing.
- The CLI is Go with no new dependencies (owner rule), and its tests use the existing seams (`compose.Runner`, `portBindable`, `dnsLookup`) plus new ones in the same style.
- Nothing is tested by opening the owner's Mac to the network. Real-server checks go to the owner's rented beta server.

## Approaches considered

**Where Docker comes from**
- **A (picked by the owner).** Docker's official signed apt repository. It works the same on all four supported releases with current Docker, and normal system updates keep it current. The cost is trusting Docker as a second publisher, made explicit by the pinned key and the yes-question.
- **B.** Each system's own packages. Only the system's publisher is trusted, but Debian 12 cannot be covered, versions are older, and the steps differ per system.
- **Dropped.** Docker's `get.docker.com` script: Docker advises against it on production servers.

**Where the setup logic lives (my call)**
- **Picked.** In `mathion install` (Go), with `install.sh` only handing over. One place holds the logic, it is testable with Go seams, and it works the same for someone who got `mathion` another way.
- **Not picked.** In `install.sh`. Shell code is harder to test, and the logic would be split between two programs.

## The flow (approved by the owner, 2026-11-25)

```
$ curl -fsSL https://…/install.sh | sudo sh
✓ mathion 0.9.0 downloaded, signature checked

Docker is not installed. Install it from Docker's official packages? [Y/n] y
✓ Docker installed, starts at boot

Set up Mathion on this server now? [Y/n] y
Site address (e.g. learn.school.edu): learn.school.edu
Your email (you become the site administrator): you@school.edu
Turn on HTTPS with a free Let's Encrypt certificate? [Y/n] y

  Checking that learn.school.edu points at this server … ok
  Starting Mathion … ok
  Getting the certificate … ok

✓ Mathion is running at https://learn.school.edu

  Sign in with:  you@school.edu
  First PIN:     482913   (works for 15 minutes)

  Then open the admin panel to set up email and your first course:
      sudo mathion panel
```

The sketch shows the Docker question before "Set up Mathion now?". In the build, the Docker question belongs to `mathion install`, so it comes right after "Set up Mathion now? y". The builder may use either order, as long as nothing is installed before a yes.

## Behaviour in detail

**`install.sh` hand-off**
- After it installs `mathion`, and only when there is no existing deployment (no `/etc/mathion/.env`) and `/dev/tty` can be opened, the script asks "Set up Mathion on this server now? [Y/n]". On yes, it runs `mathion install </dev/tty`.
- On a server that already runs Mathion, re-running the one-liner only installs the command, as today, and says that `sudo mathion self-update` / `sudo mathion update` are the update commands.
- With no terminal, it prints the `sudo mathion install …` command to run and exits successfully.

**Questions in `mathion install`**
- Flags still win: `--domain` and `--admin-email` skip their questions.
- Each answer is checked with the existing validators (`BuildBaseURL`, `ValidateEmail`), and a bad answer is asked again with the reason.
- `--yes` never asks. It needs `--domain` and `--admin-email`, as today, and it answers yes to Docker and HTTPS, unless `--no-tls` is given.
- With no terminal and no `--yes`, missing values are an error naming the flags, as today.

**Docker**
- If `docker version` and `docker compose version` both work, Docker is left alone. If the Docker service is not enabled at boot, `install` enables it and prints one line saying so.
- If Docker works but Compose v2 is missing (for example Debian 12's own `docker.io`), `install` stops with instructions. It never removes packages.
- If Docker is missing: read `/etc/os-release`. On a supported Ubuntu or Debian release, ask. On yes, add Docker's apt source with the pinned key, install the four packages, enable and start the service, then re-check. Any other system gets a short message with the link to Docker's install guide.
- Every apt step's output goes to the terminal. A failure stops the install with the failed step named.

**HTTPS**
- "Turn on HTTPS …? [Y/n]" is asked only when the site address is a plain public domain (`ValidateDomain` passes). A `host:port` address skips it, and the end message points to the guide's "TLS / reverse proxy (external)" section.
- `--no-tls`, or answering no: install without the bundled proxy and point to the same section.
- **Ports first (my call, from the builder check).** If port 80 or 443 is already taken (the existing `portBindable` check), `install` names the problem ("port 80 is in use by another program, often Apache or nginx"), finishes without HTTPS (see the end of install), and prints the `tls enable` line to run once the port is free. `--yes` does the same; it never stops to ask.
- **DNS check (my call, from the builder check).**
  - `install` looks up the domain and compares the result with the server's own network addresses. It says only what it can know: "learn.school.edu points at this server" or "learn.school.edu points at 203.0.113.9, but this server's addresses are …".
  - No outside service is asked, so the check cannot see a provider's firewall. The message says so in one line: "If your provider has a firewall, it must allow ports 80 and 443."
  - If the server has only private addresses (behind a router), the comparison cannot work. `install` says so and goes on.
  - On a mismatch or a failed lookup, `install` asks "Turn on HTTPS anyway? [y/N]". On no, it finishes without HTTPS. With `--yes`, it turns HTTPS on anyway: the proxy keeps retrying, so HTTPS starts by itself once DNS points at the server.
- **No firewall step (my call, from the builder check).** The earlier `ufw` question is dropped. Docker publishes the proxy's ports 80 and 443 past `ufw`, so opening them in `ufw` would change nothing.
- **Turning HTTPS on** shares its code with `tls enable` (shared, not copied). The Let's Encrypt email is the admin email. If that email fails the stricter `ValidateTLSEmail`, `install` asks for another address; `--yes` finishes without HTTPS and prints the `tls enable` line.
- **Waiting for the certificate (my call, from the builder check).** `install` waits up to 2 minutes for a verified HTTPS connection to `https://<domain>/health`, printing a dot every few seconds. On success it prints "Getting the certificate … ok". Otherwise it prints "The certificate is still on its way. Check with `sudo mathion tls status` in a few minutes." The install still counts as done.

**End of install (two endings; my call, from the builder check)**
- **HTTPS is on**, including "certificate still on its way": run the existing `python -m mathion.superuser pin -- <email>` and show its PIN and lifetime as in the sketch, then the sign-in address, the email and `sudo mathion panel`. If the PIN step fails, the install still counts as done, and the message says to run `sudo mathion pin <email>`.
- **HTTPS is not on** (answered no, `--no-tls`, a `host:port` address, a port taken, a refused DNS check): no PIN is made, because the site cannot be reached without HTTPS and the PIN would expire unused. The message says Mathion is installed but not reachable yet, then gives either the exact `sudo mathion tls enable --domain … --email …` line or the link to the guide's "TLS / reverse proxy (external)" section, followed by "then run `sudo mathion pin <email>` and `sudo mathion panel`".
- The old next-steps text, including the literal `docker compose ... exec`, is removed.

**Running `sudo mathion install` again (my call, from the builder check)**
- After a failed or unfinished first run, `.env` exists and today's resume path runs. It stays as it is (domain and email come from the saved state; flags that differ get the existing warning), and then it gains the same HTTPS step and ending as a fresh install: when bundled HTTPS is not on yet and the saved domain is a plain public domain, it asks the HTTPS question, runs the checks, and prints the matching ending.
- On a complete install with HTTPS already on, a re-run changes nothing new and prints the "HTTPS is on" ending without a new PIN, plus `sudo mathion pin <email>` for one.

**Installer and older `mathion` (my call, from the builder check)**
- `install.sh` comes from `main`, but it may install an older `mathion` (a pinned version, or `main` ahead of the release). Before handing over, the script checks that the installed `mathion` supports the questions (`mathion install --help` lists `--no-tls`). If it doesn't, the script prints today's `sudo mathion install --domain … --admin-email …` line instead of handing over.

**`mathion panel`**
- Runs `python -m mathion.superuser activate` through the same compose call as `pin`, and prints the link.
- Adds one line: "Open it in the browser where you are signed in as <admin email>. It stops working after 30 minutes without use."
- Needs root, like the other commands that touch the stack.

**Docs**
- README Install becomes the one-liner plus the questions, and the requirements list loses "with Docker … installed" for Ubuntu and Debian.
- The guide's "Self-hosting with the `mathion` CLI" section and command table follow: new rows for `panel` and `--no-tls`.
- `cli/cmd/install.go`'s `see README "Self-hosting"` text goes away with the old next-steps.

## Testing

- **Go unit tests (hermetic, run on the Mac and in CI):**
  - prompts, through a reader/writer seam: flags win, bad answers are asked again, `--yes` never asks, no terminal means an error;
  - `/etc/os-release` parsing, through a file seam: each supported release, an unsupported one, an unknown one;
  - Docker install, through a command-runner seam that records apt and systemctl calls: the order, a failure at each step, and Docker present but Compose missing;
  - the DNS check, through `dnsLookup` and a new local-addresses seam: a match, a mismatch, a failed lookup, private-only addresses;
  - the HTTPS paths: yes, no, `--no-tls`, `host:port`, a port taken, a refused DNS check, each with and without `--yes`, and a stricter-email refusal;
  - the certificate wait, through an HTTPS-probe seam: ready, still on its way;
  - both endings, including a failed PIN step;
  - the re-run paths: unfinished install, HTTPS not yet on, everything already done;
  - `mathion panel`.
- **`install.sh`:** a shell test for the hand-off decisions (existing deployment, no tty, a yes and a no, an older `mathion` without `--no-tls`), using stubbed commands, in the style of `cli/integration_test.sh`.
- **On the owner's rented server, before the beta:**
  - a fresh Ubuntu 24.04 run of the whole flow;
  - the same on Debian 12, after the provider reinstalls the system;
  - a run where DNS does not point at the server yet;
  - a re-run of the one-liner on the installed server.

  These go into `docs/backlog/beta-browser-pass.md` as server checks.

## Left to the builder

The exact wording of every message except the sketch's; how the seams are named; the timeout values (the certificate wait is 2 minutes; keep every other wait under 30 s); and splitting the work into tasks.
