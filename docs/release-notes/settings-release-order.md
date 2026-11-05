# Releasing the panel's Settings: image first, then the CLI

The Settings slice raises the largest upload to 50 MB (spec
`docs/superpowers/specs/2026-11-04-superuser-settings-design.md`, D11c). The
bundled HTTPS proxy now allows 60 MiB (`MAX_SIZE: "60M"` in
`docker-compose.prod.yml` and the CLI's embedded copy). It used to allow
25 MiB.

A plain `mathion update` or `mathion install` deploys the image tag baked into
the CLI (`APP_IMAGE`), together with that CLI's compose file. So the order
matters. Every step runs on `main`, after the Settings branch is merged and
pushed. The tags below are examples: use the next free ones.

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
3. **Tag that commit with the CLI tag** (the next after `cli-v0.8.0`):

   ```bash
   git tag cli-v0.9.0 && git push origin cli-v0.9.0
   ```

   A tag on an earlier commit would ship a CLI that still installs the old
   image. `release-cli.yml` builds, signs and publishes it to the curl|sh and
   apt channels as usual.
4. Optionally run the amd64 smoke workflow against the new CLI and image.

Then a plain update brings the new image and the 60M proxy together.

## What to tell operators

Upgrade the CLI, then update Mathion:

```bash
sudo mathion self-update      # a CLI installed with curl | sh
# or, for a CLI installed from the apt repository:
sudo apt update && sudo apt install --only-upgrade mathion

sudo mathion update
sudo mathion version          # shows the new CLI tag and the new image tag
```

If `sudo mathion version` still shows the old CLI, the upgrade didn't happen:
`mathion update` then says there is nothing to do.

- Your email, upload and sign-in settings are copied once from `.env` into
  the panel's Settings. From then on the panel decides, and startup names any
  of those keys that `.env` still sets.
- Nothing is removed from an existing `.env`.
- The upload limit stays where it was (20 MB unless `.env` said otherwise)
  until a superuser raises it in the panel. A value above 50 MB becomes 50 MB;
  the update prints a `site-settings:` line for each value it changed.
- Running `mathion update --version <tag>` from an **old** CLI deploys the new
  image with the old 25 MiB proxy. If the panel's limit is then raised above
  25 MB, bigger files are refused by the proxy, and Mathion says "This file is
  over the server's upload limit." Upgrading the CLI and running
  `mathion update` fixes it.
- With your own proxy in front of Mathion (not `mathion tls`), raise its body
  limit first (reproxy `--max`, nginx `client_max_body_size`) to a little more
  than the largest file you'll allow, then raise the limit in the panel.

The release itself is the maintainer's step; nothing here is automated.
