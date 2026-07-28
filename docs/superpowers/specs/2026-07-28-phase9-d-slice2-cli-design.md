# Phase 9-D Slice 2 — `mathion` Go CLI: Design

**Status:** design (brainstorming output, awaiting user review → writing-plans)
**Epic:** Phase 9-D (make Mathion self-hostable + distributable). Slice 1 (Deployment
Foundation) shipped as `ghcr.io/svkucheryavski/mathion:v0.1.1` (public). This slice is
Slice 2 of 4.

## 1. Goal

A single static Go binary, `mathion`, that automates Slice 1's manual self-hosting
flow. It wraps the existing production stack (`docker-compose.prod.yml` + the published
image) so an operator runs `sudo mathion install` instead of the multi-step README
sequence, and manages the running deployment with `start`/`stop`/`status`/`logs`/`pin`/
`superuser`/`uninstall`.

The CLI is a thin orchestrator: it shells out to the host's `docker compose` and to the
container's own `alembic` / `mathion.superuser` entrypoints. It contains no application
logic and changes no backend or frontend code (one backward-compatible line is added to
the compose file — see §9).

## 2. Scope

**In scope (Slice 2):** the `mathion` binary with nine commands (§7); a generated,
secret-bearing `/etc/mathion/.env`; `go:embed`-ed compose file kept in sync with the
repo's; goreleaser-based distribution via GitHub Releases + a `curl | sh` installer; a
CI job that unit-tests the CLI and runs a real `install` integration test.

**Explicitly deferred (do NOT build here):**
- `update`, `backup`/`restore`, and a `/version` HTTP endpoint → **Slice 3**.
- Signed `.deb` + apt repository + CLI self-update → **Slice 4**.
- Reverse proxy / TLS automation → stays external and manual (as in Slice 1); `install`
  only prints the pointer to the README's proxy section.
- Any non-Docker runtime (bare systemd services, k8s, etc.).

## 3. Architecture overview

Decisions locked during brainstorming:

- **Runtime model:** thin wrapper over `docker compose`. `start` = `up -d --wait`,
  `stop` = `stop`, `status` = `ps` + a `/health` probe. **Boot persistence** comes from
  `restart: unless-stopped` on the services (§9) plus Docker being enabled at boot
  (`systemctl enable docker`, documented). No systemd unit, no Docker SDK — the compose
  file stays the single source of truth that operators can also run by hand.
- **Privilege & layout:** system-wide, root. Binary at `/usr/local/bin/mathion`; config
  at `/etc/mathion/`; data in the existing Docker named volumes. `install`/`start`/etc.
  need `sudo`. This matches the Slice 4 `apt` layout so nothing relocates later.
- **`install` depth:** stands the stack up, migrates, and creates the first superuser
  **account**, then stops. The time-sensitive first-login PIN is issued separately by
  `mathion pin <email>`, because it expires in 10 minutes and only works once the
  operator's HTTPS reverse proxy is live.
- **Implementation posture:** conventional Go — `spf13/cobra` for the command tree,
  `go:embed` for a static compose copy (drift-guarded by a test), goreleaser for
  cross-compiled release binaries.

## 4. Repository layout (new Go module)

```
cli/
  go.mod                     # module github.com/svkucheryavski/mathion/cli ; dep: spf13/cobra
  go.sum
  main.go                    # ldflags-injected version/defaultImage; calls cmd.Execute()
  cmd/
    root.go                  # cobra root, global flags, config-dir resolution
    install.go start.go stop.go status.go pin.go
    logs.go version.go superuser.go uninstall.go
  internal/
    config/                  # paths, .env read/generate (0600), domain/email validation
    secrets/                 # crypto/rand → base64-48 secret, hex-24 pg password
    compose/                 # //go:embed docker-compose.yml + exec wrapper (argv builder)
    dockerx/                 # preflight (docker+compose present), /health probe
    compose/docker-compose.yml   # committed copy, embedded; drift-guarded vs repo root
  .goreleaser.yaml
```

The Go module lives at `cli/` (its own `go.mod`) so the repo's Python/JS tooling is
untouched. `go:embed` can only reference files inside the package directory, so the
embedded compose is a committed copy at `cli/internal/compose/docker-compose.yml`; a Go
test asserts byte-equality with the repo-root `docker-compose.prod.yml` (§9).

## 5. Filesystem & config layout

| Path | Contents | Mode/owner |
|---|---|---|
| `/usr/local/bin/mathion` | the binary | 0755 root |
| `/etc/mathion/docker-compose.yml` | written from the embed at `install` | 0644 root |
| `/etc/mathion/.env` | generated secrets + config | **0600 root** |
| Docker volumes `mathion_pgdata`, `mathion_assets` | all state | Docker-managed |

The config directory defaults to `/etc/mathion`, overridable via a **`MATHION_CONFIG_DIR`
environment variable**. This is an advanced/hidden affordance whose primary purpose is
testability: the integration test and CI point `install` at a temp dir so they need no
root and don't touch a real deployment. It is documented as advanced, not a headline
flag.

## 6. Secrets generation

`install` generates, using `crypto/rand`:
- `MATHION_SECRET_KEY` — 48 random bytes, base64 (equivalent to `openssl rand -base64 48`).
- `POSTGRES_PASSWORD` — 24 random bytes, hex (URL-safe; equivalent to `openssl rand -hex 24`).

The same hex password is written to both `POSTGRES_PASSWORD` and the password field of
`MATHION_DATABASE_URL`. The generated `.env` carries the **exact key set** of
`deploy/.env.prod.example` (a unit test enforces parity so the contract can't drift):
`MATHION_SECRET_KEY`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`,
`MATHION_DATABASE_URL`, `MATHION_BASE_URL`, `MATHION_COOKIE_SECURE=1`, `MATHION_DEBUG=0`,
`MATHION_EMAIL_MODE=disabled`, `MATHION_ASSET_PATH`, `MATHION_MAX_FILE_SIZE`,
`MATHION_MAX_COURSE_SIZE`, `MATHION_VERSION`.

`MATHION_VERSION` defaults to an image tag **baked into the CLI at build time**
(goreleaser ldflags `main.defaultImage`, e.g. `v0.1.1`), overridable with
`--version <tag>`, so an install is deterministic and reproducible.

## 7. Command surface

All `compose`/`exec` calls use the base:
`docker compose -f <cfgdir>/docker-compose.yml --env-file <cfgdir>/.env`.
The compose file's top-level `name: mathion_prod` fixes the project; the CLI passes no
`-p` in normal operation. (The integration test isolates itself with a distinct project
name + temp config dir + temp volumes — see §11.)

| Command | Behaviour |
|---|---|
| `install` | see §8 |
| `start` | `compose up -d --wait` |
| `stop` | `compose stop` |
| `status` | `compose ps`; probe `http://127.0.0.1:8000/health` (expect `200 {"status":"ok"}`); print the pinned `MATHION_VERSION`. Reports clearly if the stack is down. |
| `pin <email>` | `compose exec -T app python -m mathion.superuser pin <email>` (requires stack running; errors clearly if not) |
| `superuser <email>` | `compose exec -T app python -m mathion.superuser create-superuser <email>` |
| `logs [app\|db] [-f]` | `compose logs [--follow] [service]` |
| `version` | CLI version (ldflags) + `MATHION_VERSION` from `.env` + best-effort "newer tag on GHCR?" (network optional, never fatal) |
| `uninstall` | `compose down` + remove `/etc/mathion` (data volumes **kept**); `--purge` → `compose down -v` (deletes volumes) behind a typed `purge` confirmation |

The exact container entrypoint strings (`python -m mathion.superuser {create-superuser,pin}`,
`alembic upgrade head`) are taken from the README self-hosting section and re-verified
against `backend/mathion/superuser.py` during planning.

## 8. `install` flow

```
sudo mathion install [--domain D] [--admin-email E] [--version TAG] [--yes]
```

1. **Preflight.** Require: write access to the config dir (i.e. root for the default
   `/etc/mathion`), `docker` + `docker compose` v2 present and the daemon reachable, and
   host port `127.0.0.1:8000` free. Fail fast with a specific message per failure.
2. **Idempotency guard.** If `/etc/mathion/.env` already exists, refuse (don't clobber
   secrets) and point to `mathion start` / `mathion status`.
3. **Gather inputs.** Prompt for domain (validated: authority only, no scheme/path —
   matches the backend's `MATHION_BASE_URL` rule) and admin email (format-checked).
   `--domain`/`--admin-email` skip the corresponding prompt; `--yes` requires both flags
   and runs fully non-interactively.
4. **Write config.** Generate secrets (§6); write `/etc/mathion/docker-compose.yml` from
   the embed and `/etc/mathion/.env` (0600).
5. **Pull + up.** `compose pull` then `compose up -d --wait`.
6. **Migrate.** `compose exec -T app alembic upgrade head`.
7. **Create superuser account.** `compose exec -T app python -m mathion.superuser
   create-superuser <email>`.
8. **Next steps.** Print: set up the reverse proxy (link to the README section), confirm
   `https://<domain>` serves, then `sudo mathion pin <email>` for the first-login PIN.

**Error stance:** on any step failure, stop and print the failing command's output plus a
hint (usually `mathion logs`). No automatic destructive rollback — leave state inspectable.
Re-running after a partial failure is guarded by step 2; recovery guidance names the
manual `compose` command or suggests `uninstall` then retry.

## 9. Compose change (only Slice-1 artifact touched)

Add `restart: unless-stopped` to the `app` and `db` services in the repo's
`docker-compose.prod.yml` (backward-compatible; also benefits manual operators, giving
the reboot-survival the CLI relies on). The CLI embeds a committed copy at
`cli/internal/compose/docker-compose.yml`; a Go test reads both files and asserts they are
**byte-identical**, so the embedded copy can never silently drift from the canonical file.

## 10. Distribution & versioning

- **goreleaser** cross-compiles `linux/amd64` + `linux/arm64` (the server targets; no
  macOS/Windows build — the CLI runs on the deployment host). It produces the archives
  plus a `checksums.txt`.
- **Independent version line.** CLI releases are triggered by a **`cli-v*`** git tag (a
  separate namespace from the app image's `v*` tags) so the CLI and the app image version
  independently. The CLI starts at `cli-v0.1.0`. A new GitHub Actions workflow
  (`release-cli.yml`, tag `cli-v*`) runs `go test ./cli/...` then goreleaser → GitHub
  Releases.
- **`curl | sh` installer.** `deploy/install.sh`: detects arch, downloads the latest
  `cli-v*` release archive for the platform, verifies it against `checksums.txt`, installs
  to `/usr/local/bin/mathion`. Usage:
  `curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh | sudo sh`.

## 11. Testing strategy

**Unit (Go, no Docker):**
- secrets: correct byte length + encoding/charset; two calls differ.
- `.env` generation: all keys present; `POSTGRES_PASSWORD` == password embedded in
  `MATHION_DATABASE_URL`; key set matches `deploy/.env.prod.example` (parity guard).
- argv construction: each command builds the exact `docker compose …` argument vector,
  asserted via an **injected fake exec-runner** (no real Docker invoked).
- domain + email validation (accept/reject tables).
- **embed drift guard:** `cli/internal/compose/docker-compose.yml` == repo
  `docker-compose.prod.yml`, byte for byte.

**Integration (CI, real Docker):** non-interactive `install --yes --domain … --admin-email
…` into a temp `MATHION_CONFIG_DIR`, isolated project name + volumes → assert the stack is
healthy, `/health` returns `200`, and the superuser row exists → `uninstall --purge` cleans
up. This mirrors the manual `validate-published.sh` proof already run against v0.1.1.

**CI wiring:** add a `cli` job to `.github/workflows/ci.yml` running `go vet ./cli/...`,
`go test ./cli/...`, and the integration test (ubuntu runners provide Docker). The job is
part of the existing `ci` reusable workflow, so it also gates releases.

## 12. Boundaries & non-goals

- Wraps only: `docker compose` (Slice 1), the container's `alembic`, and
  `python -m mathion.superuser {create-superuser,pin}`. No new backend/frontend code; the
  sole Python/compose-side change is the one `restart:` line in §9.
- Not responsible for TLS/reverse proxy, DNS, firewalls, or OS packages.
- Not `update`/`backup` (Slice 3) — `version` only *reports*; it does not mutate.

## 13. Resolved decisions (record)

1. Runtime model → `docker compose` wrapper + `restart: unless-stopped` (not systemd, not
   Docker SDK).
2. Layout/privilege → system-wide root, `/etc/mathion` + `/usr/local/bin` (apt-forward).
3. `install` depth → up to superuser **account**; PIN via separate `mathion pin`.
4. Command surface → core (install/start/stop/status/pin) + logs/version/superuser/uninstall.
5. Posture → cobra + goreleaser + `go:embed` (drift-guarded).
6. `cli-v*` tag namespace, independent of the app image's `v*`.
7. `MATHION_CONFIG_DIR` hidden override exists solely for test/CI isolation.
8. linux/amd64 + linux/arm64 only.

## 14. Success criteria

On a fresh Linux host with Docker: `sudo mathion install` (with a domain + admin email)
produces a healthy stack answering `/health`, a migrated schema, and a superuser account;
`mathion status` reports healthy + the pinned version; `mathion pin <email>` prints a
working first-login PIN; `mathion stop`/`start` cycle the stack; `mathion uninstall` tears
it down (data kept unless `--purge`). The CLI ships as `cli-v0.1.0` release binaries
(linux amd64+arm64) installable via `curl | sh`, and the full unit + integration suite is
green in CI.
