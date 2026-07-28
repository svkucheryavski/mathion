# Phase 9-D Slice 2 — `mathion` Go CLI: Design

**Status:** design (brainstorming output, round-2 after spec-convergence review; awaiting
re-review → writing-plans)
**Epic:** Phase 9-D (make Mathion self-hostable + distributable). Slice 1 (Deployment
Foundation) shipped as `ghcr.io/svkucheryavski/mathion:v0.1.1` (public). This is Slice 2
of 4.

> Round-2 note: this revision resolves the round-1 convergence review (4 Opus lenses +
> codex). Key corrections: the compose file already ships `restart: unless-stopped`
> (Slice 2 changes **zero** Slice-1 files); the CLI always passes an explicit
> `-p mathion_prod` (deterministic project — safety for `--purge`); `MATHION_BASE_URL` is
> built as `https://<domain>` and validated against the backend rule; `install` **resumes**
> (never regenerates secrets) so partial-failure retry is safe; plain `uninstall` retains
> config + volumes; goreleaser runs **build-only** (cli-v* isn't semver) with `gh` publish;
> the `version` GHCR probe is cut (deferred to Slice 3).

## 1. Goal

A single static Go binary, `mathion`, that automates Slice 1's manual self-hosting flow.
It wraps the existing production stack (`docker-compose.prod.yml` + the published image) so
an operator runs `sudo mathion install` instead of the multi-step README sequence, and
manages the deployment with `start`/`stop`/`status`/`logs`/`pin`/`superuser`/`uninstall`.

The CLI is a thin orchestrator: it shells out to the host's `docker compose` and to the
container's own `alembic` / `mathion.superuser` entrypoints. It contains no application
logic and **changes no backend, frontend, or compose file** — it embeds a byte-identical
copy of `docker-compose.prod.yml` (which already carries everything it needs).

## 2. Scope

**In scope (Slice 2):** the `mathion` binary with nine commands (§7); a generated,
secret-bearing `<cfgdir>/.env`; a `go:embed`-ed compose copy kept byte-identical to the
repo's; goreleaser-based distribution via a `cli-v*` GitHub Release + a `curl | sh`
installer; CI that unit-tests the CLI plus a real `install` integration test.

**Explicitly deferred (do NOT build here):**
- `update`, `backup`/`restore`, a `/version` HTTP endpoint, **and any "is a newer version
  available?" discovery** → **Slice 3**.
- Signed `.deb` + apt repo + CLI self-update, **and cryptographic release signing** →
  **Slice 4**.
- Reverse proxy / TLS automation → stays external and manual (as in Slice 1); `install`
  only prints the pointer to the README's proxy section.
- Any non-Docker runtime (bare systemd services, k8s, etc.).

## 3. Architecture overview

Decisions locked during brainstorming (unchanged) + round-2 refinements:

- **Runtime model:** thin wrapper over `docker compose`. `start` = `up -d --wait`,
  `stop` = `stop`, `status` = `ps` + a `/health` probe. **Boot persistence** already comes
  from `restart: unless-stopped` on both services (shipped in Slice 1) plus Docker enabled
  at boot (`systemctl enable docker`, documented). No systemd unit, no Docker SDK.
- **Deterministic project name (round-2):** every `docker compose` invocation passes an
  explicit **`-p mathion_prod`**. This makes the target project independent of an inherited
  `COMPOSE_PROJECT_NAME`, so `--purge`'s `down -v` can never delete another project's
  volumes. (This is a deliberate exception to "let the file's `name:` decide" — chosen for
  destructive-op safety.) A hidden test-only override sets `-p` to a unique name for
  isolation (§11).
- **Privilege & layout:** system-wide, root. Binary at `/usr/local/bin/mathion`; config at
  `/etc/mathion/` (overridable — §5); data in the existing Docker named volumes. Root is
  needed to write `/etc/mathion` + `/usr/local/bin`. The **config** layout is shared with
  Slice 4's apt package; the binary path differs by channel (apt conventionally uses
  `/usr/bin`) — Slice 4 resolves dual-install/PATH precedence.
- **`install` depth:** stands the stack up, migrates, and creates the first superuser
  **account**, then stops. The time-sensitive first-login PIN is issued separately by
  `mathion pin <email>` (§8). `install` is **resume-safe** (§8): re-running never
  regenerates secrets.
- **Implementation posture:** conventional Go — `spf13/cobra` for the command tree,
  `go:embed` for a static compose copy (drift-guarded by a test), goreleaser (build-only)
  for cross-compiled release binaries.

## 4. Repository layout (new Go module)

```
cli/
  go.mod                     # module github.com/svkucheryavski/mathion/cli ; dep: spf13/cobra
  go.sum
  main.go                    # var version, defaultImage (non-empty in-source defaults); cmd.Execute()
  cmd/
    root.go                  # cobra root; builds the App (config dir + Runner); global flags
    install.go start.go stop.go status.go pin.go
    logs.go version.go superuser.go uninstall.go
  internal/
    config/                  # resolve cfgdir, .env generate/read (atomic 0600), URL/email validation
    secrets/                 # crypto/rand → base64-48 secret, hex-24 pg password
    compose/                 # //go:embed docker-compose.yml + Runner (argv builder + exec)
    dockerx/                 # preflight (docker+compose present, daemon reachable), /health probe
    compose/docker-compose.yml   # committed BYTE-IDENTICAL copy of repo docker-compose.prod.yml
  .goreleaser.yaml
```

- The module lives at `cli/` with its own `go.mod` (the repo has no other Go). All Go
  tooling runs **module-scoped**: `go -C cli test ./...`, `go -C cli vet ./...`, and CI
  jobs use `working-directory: cli`.
- **Build-time vars (`main.go`):** `var version = "dev"` and `var defaultImage = "v0.1.1"`
  — **non-empty in-source defaults** so plain `go build` (tests/CI) works. goreleaser
  overrides both via ldflags at release; `defaultImage` is a **hand-maintained literal**
  (the app image tag this CLI release recommends), decoupled from the CLI's own `cli-v*`
  tag.
- **Runner seam (round-2):** `internal/compose` defines
  `type Runner interface { Run(ctx, args ...string) error; Output(ctx, args ...string) (string, error) }`.
  `root.go` constructs the real (`exec.CommandContext`) Runner and threads it (plus the
  resolved config dir) through an `App` struct to every command. Unit tests inject a fake
  Runner that records argv without executing, so the exact `docker compose …` argument
  vectors are asserted with no Docker.

## 5. Filesystem & config layout

| Path | Contents | Mode/owner |
|---|---|---|
| `/usr/local/bin/mathion` | the binary | 0755 root |
| `<cfgdir>/docker-compose.yml` | written from the embed at `install` | 0644 root |
| `<cfgdir>/.env` | generated secrets + config | **0600 root** |
| Docker volumes `mathion_prod_mathion_pgdata`, `…_mathion_assets` | all state | Docker-managed |

`<cfgdir>` defaults to `/etc/mathion`, overridable via **`MATHION_CONFIG_DIR`** (an
advanced/hidden affordance whose primary purpose is test/CI isolation — every command uses
the **resolved** `<cfgdir>`, never a hardcoded `/etc/mathion`).

**Config-dir + secret-file safety (round-2):**
- The config dir is created/validated as a **root-owned, non-symlink** directory, mode
  `0700` (so the mere existence of `.env` isn't world-listable). A world-writable or
  symlinked target is rejected.
- `.env` is written **atomically**: a temp file in the same directory opened
  `O_CREATE|O_EXCL|O_WRONLY, 0600`, fully written, `fsync`'d, then `rename`'d into place.
- `.env` is written **last** in the config step, so its presence marks a *complete* config
  transaction (a crash can't leave a truncated secret that the resume path would trust).

## 6. Secrets & generated `.env`

`install` generates, using `crypto/rand`:
- `MATHION_SECRET_KEY` — 48 random bytes, base64 (≈`openssl rand -base64 48`; 384 bits).
- `POSTGRES_PASSWORD` — 24 random bytes, hex (≈`openssl rand -hex 24`; URL- and
  interpolation-safe inside `MATHION_DATABASE_URL`).

The same hex password is written to both `POSTGRES_PASSWORD` and the password field of
`MATHION_DATABASE_URL`. The generated `.env` carries the **exact key set and the documented
values** of `deploy/.env.prod.example` (a unit test enforces key **and value** parity for
the fixed fields, so neither drifts):

| Key | Value |
|---|---|
| `MATHION_SECRET_KEY` | generated (base64-48) |
| `POSTGRES_USER` / `POSTGRES_DB` | `mathion` / `mathion` (hardcoded) |
| `POSTGRES_PASSWORD` | generated (hex-24) |
| `MATHION_DATABASE_URL` | `postgresql+psycopg://mathion:<hex>@db:5432/mathion` |
| `MATHION_BASE_URL` | `https://<validated-domain>` (see §8.3) |
| `MATHION_COOKIE_SECURE` / `MATHION_DEBUG` / `MATHION_EMAIL_MODE` | `1` / `0` / `disabled` |
| `MATHION_ASSET_PATH` | `/data/mathion/assets` |
| `MATHION_MAX_FILE_SIZE` / `MATHION_MAX_COURSE_SIZE` | `20971520` / `524288000` |
| `MATHION_VERSION` | `main.defaultImage` (e.g. `v0.1.1`), overridable `--version` |

A random base64(48) secret is non-empty and never equals the dev default, so it satisfies
the boot guard (`main.py` refuses to start when `cookie_secure` is set and `secret_key` is
empty/default). **Invariant: the CLI never prints generated secrets to stdout/logs.** The
`--version` value is validated as a legal OCI tag (charset; no whitespace/control chars).

## 7. Command surface

All `compose`/`exec` calls use the base:
`docker compose -p mathion_prod -f <cfgdir>/docker-compose.yml --env-file <cfgdir>/.env …`
(the explicit `-p` — §3 — is present on **every** call; a hidden test override changes only
the `-p` value).

| Command | Behaviour |
|---|---|
| `install` | see §8 |
| `start` | `compose up -d --wait` |
| `stop` | `compose stop` (containers stopped; volumes + config retained) |
| `status` | `compose ps`; probe `http://127.0.0.1:8000/health` (expect `200 {"status":"ok"}`); print pinned `MATHION_VERSION`. Clear message if the stack is down. |
| `pin <email>` | `compose exec -T app python -m mathion.superuser pin <email>`; **surfaces container stdout** (the printed PIN or the error/rate-limit line — the subcommand exits 0 regardless, so the CLI does not gate on exit code) and reminds the operator the PIN expires in 10 min and issuance is rate-limited 3/hour. Requires the stack running. |
| `superuser <email>` | `compose exec -T app python -m mathion.superuser create-superuser <email>`; surfaces stdout (treats "already exists" as a non-fatal notice) |
| `logs [app\|db] [-f]` | `compose logs [--follow] [service]` |
| `version` | prints the CLI build version (`main.version`) + the pinned `MATHION_VERSION` from `.env`. **No registry/GHCR query** (deferred to Slice 3). |
| `uninstall` | `compose down` — removes containers + network but **retains named volumes AND `<cfgdir>` (.env + compose)**, so `mathion start` fully restores the deployment. `--purge` → `compose down -v` **and** remove `<cfgdir>`, behind a confirmation that first **resolves and displays the exact project + volume names** and requires the operator to type that identity (not a generic word). |

The container entrypoint strings (`python -m mathion.superuser {create-superuser,pin}`,
`alembic upgrade head`) are re-verified during planning against the package
`backend/mathion/superuser/__main__.py` (subcommands `create-superuser`, `pin`,
`activate`) and the Dockerfile (`WORKDIR /app`, alembic assets present). The optional
`activate` step (prints the superuser-panel URL) is **not** wrapped; `install`'s next-steps
prints the exact manual `compose exec … activate` command for operators who want it.

## 8. `install` flow

```
sudo mathion install [--domain D] [--admin-email E] [--version TAG] [--yes]
```
(`--yes` is **scoped to `install`** — it never reaches `uninstall`'s purge confirmation.)

1. **Config-transaction / resume check FIRST.** If `<cfgdir>/.env` exists and is valid,
   `install` **resumes** — it reuses the existing secrets and re-runs the idempotent
   remaining steps (5–7); it never regenerates `POSTGRES_SECRET`/password. (This is what
   makes partial-failure retry safe: Postgres honors `POSTGRES_PASSWORD` only at first
   volume init, so regeneration would brick a half-initialized DB.)
2. **Preflight.** Config dir is a safe (non-symlink, root-owned, `0700`) directory;
   `docker` + `docker compose` v2 present and the daemon reachable; host port
   `127.0.0.1:8000` free (connect-probe). Fail fast with a specific message each.
3. **Gather inputs (fresh install only).** Prompt for domain and admin email
   (`--domain`/`--admin-email` skip the matching prompt; `--yes` requires both).
   **Domain → URL:** `--domain` accepts an *authority* — `host[:port]`, no scheme, no
   userinfo, no path/query/fragment. The CLI **constructs `MATHION_BASE_URL=https://<domain>`**
   and validates the constructed URL against the same rules the backend enforces
   (`config.py`: scheme ∈ {http,https} — always `https` here; non-empty netloc; no
   userinfo; valid in-range port; no path/query/fragment; no whitespace/control). A scheme
   typed into `--domain` is rejected (prevents `https://https://…`). A golden accept/reject
   table (derived from `config.py`) guards parity.
4. **Write config.** Generate secrets (§6); write `<cfgdir>/docker-compose.yml` from the
   embed, then `<cfgdir>/.env` atomically (last).
5. **Pull + up.** `compose pull` then `compose up -d --wait`.
6. **Migrate.** `compose exec -T app alembic upgrade head` (idempotent).
7. **Create superuser account.** `compose exec -T app python -m mathion.superuser
   create-superuser <email>` (idempotent notice if already present).
8. **Next steps.** Print: set up the reverse proxy (link to the README section); **then log
   in at `https://<domain>` — NOT `http://127.0.0.1:8000`** (the `Secure` session cookie
   won't persist over plain HTTP); then `sudo mathion pin <email>` for the first-login PIN;
   and the optional `activate` command.

**Error/recovery stance:** on a mid-flow failure, print the failing command's output plus a
hint (usually `mathion logs`). No destructive auto-rollback. Recovery is to **re-run
`install`** (it resumes with the same secrets). If the DB volume is in a bad state and must
be reset, `mathion uninstall --purge` gives a clean slate.

## 9. Embedded compose (no Slice-1 change)

`docker-compose.prod.yml` **already** carries `restart: unless-stopped` on both `app` and
`db` and `stop_grace_period: 35s` on `app` (shipped in Slice 1 / v0.1.1). Slice 2 therefore
**edits nothing** in that file. It only *adds* a committed copy at
`cli/internal/compose/docker-compose.yml` for `go:embed` (which can't reference `..`), and a
Go test that asserts the copy is **byte-identical** to the repo-root
`docker-compose.prod.yml` so it can never drift.

## 10. Distribution & versioning

- **goreleaser, build-only.** The CLI's `cli-v*` tag is **not** semver, and goreleaser's
  OSS edition requires a semver current tag (prefixed/monorepo tags are a Pro feature). So
  the release workflow: on a `cli-v*` tag → derive a sanitized semver (strip the `cli-v`
  prefix → e.g. `0.1.0`) → run goreleaser to **build/archive/checksum only** (no publish),
  with `CGO_ENABLED=0` (guaranteeing the static binary), `builds.main` pointing at `cli/`,
  `binary: mathion`, targets `linux/amd64` + `linux/arm64`, producing archives + a
  `checksums.txt` → then publish those artifacts to the `cli-v*` GitHub Release via
  `gh release create`. The workflow declares `permissions: contents: write`.
- **Independent version line.** CLI releases (`cli-v*`, starting `cli-v0.1.0`) version
  independently of the app image (`v*`). `main.version` = the CLI tag; `main.defaultImage`
  = the recommended app tag (hand-maintained, bumped when cutting a CLI release; operators
  can always override with `install --version`).
- **`curl | sh` installer** (`deploy/install.sh`): resolves the latest **`cli-v*`** release
  by **listing releases and filtering the `cli-` prefix** (GitHub's repo-wide
  `/releases/latest` is not prefix-aware and could return an app `v*` release), or takes an
  explicit version arg; maps `uname -m` (`x86_64→amd64`, `aarch64|arm64→arm64`, **hard-fail
  on anything else**); downloads the archive + `checksums.txt` with `curl -f` (fail-closed,
  HTTPS-only, no http fallback); **verifies the checksum before** extract/`chmod +x`;
  installs to `/usr/local/bin/mathion`. No undeclared `jq`/python dependency. Usage:
  `curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh | sudo sh`.
- **Trust model (documented limitation):** `checksums.txt` from the same release provides
  *integrity* (corruption/partial-download detection), not *authenticity* — the trust
  anchor is TLS + control of the GitHub repo/release. Cryptographic signing is **Slice 4**;
  the installer and README state this explicitly and offer a download-inspect-then-run path
  alongside `curl | sudo sh`.

## 11. Testing strategy

**Unit (`go -C cli test ./...`, no Docker):**
- secrets: correct byte length + encoding; two calls differ.
- `.env` generation: all keys **and fixed values** present; `POSTGRES_PASSWORD` == the
  password embedded in `MATHION_DATABASE_URL`; parity with `deploy/.env.prod.example`.
- **argv construction** for every command asserted via the injected fake Runner (§4) — incl.
  the `-p mathion_prod`, `-f <cfgdir>/…`, `--env-file <cfgdir>/…` on each call.
- domain→URL construction + validation: golden accept/reject table mirroring `config.py`
  (scheme rejection on input, userinfo, bad port, path/query/fragment, whitespace/control).
- `--version` OCI-tag validation; email validation.
- **embed drift guard:** `cli/internal/compose/docker-compose.yml` == repo
  `docker-compose.prod.yml`, byte for byte.

**Integration (real Docker):** non-interactive `install --yes --domain … --admin-email …
--version <published-tag>` into a temp `MATHION_CONFIG_DIR` with a **unique `-p` project**
(hidden test override) → assert stack healthy, `/health` `200`, and the superuser row via
`compose exec -T db psql -U mathion -d mathion -tAc "select count(*) from users where
is_superuser and email='…'"` → `uninstall --purge` cleans up (isolated volumes only). This
mirrors `deploy/smoke.sh`, which already proves Docker/Compose-v2 + this exact flow run on
`ubuntu-latest`.

**CI wiring (round-2, decoupled):**
- A **`cli-unit`** job is added to the reusable `.github/workflows/ci.yml`
  (`working-directory: cli`; `go vet ./...` + unit tests). It is fast and needs no
  Docker/registry, so it safely gates PRs **and** app-image releases.
- The **integration** test runs in the CLI's own release workflow (`release-cli.yml`, on
  `cli-v*`) and on PRs that touch `cli/` — but is **NOT** part of the app-release-gating
  reusable `ci.yml`, so a CLI-test flake or a GHCR hiccup can never block an app-image
  release. It passes an explicit published `--version`.

## 12. Boundaries & non-goals

- Wraps only: `docker compose` (Slice 1), the container's `alembic`, and
  `python -m mathion.superuser {create-superuser,pin}`. **Zero** changes to
  backend/frontend/compose — the embedded compose is a verbatim copy.
- Not responsible for TLS/reverse proxy, DNS, firewalls, or OS packages.
- Not `update`/`backup`/version-discovery (Slice 3); not signing/apt/self-update (Slice 4).

## 13. Resolved decisions (record)

1. Runtime → `docker compose` wrapper; boot persistence from the **already-present**
   `restart: unless-stopped` (not systemd, not Docker SDK).
2. **Always pass `-p mathion_prod`** (deterministic project; safety for `--purge`); hidden
   test override → unique `-p`.
3. Layout/privilege → system-wide root, `/etc/mathion` (config) + `/usr/local/bin` (binary);
   config layout is apt-forward (binary path differs by channel, Slice 4 resolves).
4. `install` depth → up to superuser **account**; PIN via separate `mathion pin`; **install
   resumes** (never regenerates secrets).
5. `MATHION_BASE_URL` = `https://<domain>`, validated against the backend rule; `--domain`
   is authority-only, scheme rejected. (`https`-only — prod is TLS-terminating proxy +
   `COOKIE_SECURE=1`.)
6. `uninstall` retains config + volumes; `--purge` removes both behind an identity-bound
   typed confirmation; `--yes` is install-scoped.
7. `version` prints CLI + pinned image version only; no GHCR discovery (Slice 3).
8. Posture → cobra + goreleaser (**build-only**, `gh` publish; no Pro) + `go:embed`
   (drift-guarded). `main.{version,defaultImage}` have non-empty in-source defaults.
9. `cli-v*` tag namespace, independent of the app image's `v*`; `defaultImage` hand-bumped
   per CLI release; `--version` overrides.
10. `MATHION_CONFIG_DIR` hidden override for test/CI isolation, threaded everywhere.
11. CI split: `cli-unit` gates PRs + app releases; the Docker integration test gates only
    CLI releases / cli-touching PRs.
12. linux/amd64 + linux/arm64 only; `CGO_ENABLED=0`.

## 14. Success criteria

On a fresh Linux host with Docker: `sudo mathion install` (domain + admin email) produces a
healthy stack answering `/health`, a migrated schema, and a superuser account; a partial
failure is recoverable by re-running `install` (same secrets); `mathion status` reports
healthy + pinned version; `mathion pin <email>` prints a working first-login PIN (with the
HTTPS-not-loopback reminder); `stop`/`start` cycle the stack; plain `uninstall` removes
containers but keeps data/config; `uninstall --purge` fully removes after an identity-bound
confirm. The CLI ships as `cli-v0.1.0` release binaries (linux amd64+arm64, static)
installable via `curl | sh`, and the unit + integration suites are green in CI.
