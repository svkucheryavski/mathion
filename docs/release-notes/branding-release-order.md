# Releasing the panel's Branding: image first, then the CLI

The Branding slice adds a page to the superuser panel (spec
`docs/superpowers/specs/2026-11-05-superuser-branding-design.md`) and a way
back from the server: `mathion branding reset` (D15). The CLI command runs
`python -m mathion.superuser branding-reset` inside the app container, so it
needs an image that has that subcommand. Against an older image it says:
"This server's Mathion is too old for branding reset: run `mathion update`
first."

The order is the Settings slice's (`settings-release-order.md`). If Settings
hasn't been released yet, both slices ship in one release: follow these steps
once, and tell operators what both notes say. Every step runs on `main`, after
the Branding branch is merged and pushed. The tags below are examples, the
same as the Settings note's for a shared release; if Settings has shipped
already, use the next free ones.

1. **Push the image tag first:**

   ```bash
   git switch main
   git tag v0.3.0 && git push origin v0.3.0
   ```

   `release.yml` builds and pushes `ghcr.io/svkucheryavski/mathion:v0.3.0`.
   Wait until its run on GitHub's Actions tab is green.
2. **Raise the CLI's image pin to that tag**, in two places:
   - `APP_IMAGE` in `.github/workflows/release-cli.yml` (the goreleaser step's
     `env`);
   - the `app_version` default in `.github/workflows/amd64-smoke.yml`.

   Then commit and push them to `main`:

   ```bash
   git add .github/workflows/release-cli.yml .github/workflows/amd64-smoke.yml
   git commit -m "chore(release): the CLI installs v0.3.0"
   git push origin main
   ```
3. **Tag that commit with the next CLI tag:**

   ```bash
   git tag cli-v0.9.0 && git push origin cli-v0.9.0
   ```

   `release-cli.yml` builds, signs and publishes it to the curl|sh and apt
   channels as usual.
4. Optionally run the amd64 smoke workflow against the new CLI and image.

## What to tell operators

Upgrade the CLI, then update Mathion:

```bash
sudo mathion self-update      # a CLI installed with curl | sh
# or, for a CLI installed from the apt repository:
sudo apt update && sudo apt install --only-upgrade mathion

sudo mathion update
```

- The superuser panel gains a Branding page: the site name, a logo, a tab
  icon and the colours. Nothing changes until a superuser saves something
  there.
- If a colour theme ever makes the panel hard to use, `sudo mathion branding
  reset` removes the colour changes; `--all` also resets the site name, logo
  and tab icon.
- **With an older CLI** (for example after `mathion update --version …`
  from a CLI released before this one), the same way back works by hand:

  ```bash
  sudo docker compose -p mathion_prod -f /etc/mathion/docker-compose.yml \
    --env-file /etc/mathion/.env exec -T app python -m mathion.superuser branding-reset
  ```

  Add `--all` at the end to reset every branding item.

The release itself is the maintainer's step; nothing here is automated.
