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
   image. `release-cli.yml` builds, signs and publishes it for curl|sh as usual.
4. Optionally run the amd64 smoke workflow against the new CLI and image.

Then a plain update brings the new image and the 60M proxy together.

## What to tell operators

Upgrade the CLI, then update Mathion:

```bash
sudo mathion self-update

sudo mathion update
sudo mathion version          # shows the new CLI tag and the new image tag
```

Run `sudo mathion version` before `mathion update` too: if it still shows the
old CLI, the upgrade didn't happen, and `mathion update` then says there is
nothing to do.

- Your email, upload and sign-in settings are copied once from `.env` into
  the panel's Settings. From then on the panel decides. Startup names any of
  those keys that `.env` still sets, in one INFO line in
  `sudo mathion logs app`.
- Nothing is removed from an existing `.env`.
- The upload limit stays where it was (20 MB unless `.env` said otherwise)
  until a superuser raises it in the panel. A value above 50 MB becomes 50 MB;
  the update prints a `site-settings:` line for each value it changed or
  dropped.
- Running `mathion update --version <tag>` from an **old** CLI deploys the new
  image with the old 25 MiB proxy. If the panel's limit is then raised above
  25 MB, bigger files are refused by the proxy, and Mathion says "This file is
  over the server's upload limit." Upgrading the CLI and running
  `mathion update` fixes it.
- An old CLI's bundled proxy (`mathion tls`) also lacks the new timeouts:
  until the CLI is upgraded and `mathion update` is run, a slow email test gets
  a 502 after 5 seconds, and a large upload or download is cut off at 30
  seconds.
- Restoring a backup taken before this update, with the old image, needs the
  old email keys still in `.env`: with `MATHION_EMAIL_MODE=smtp` and those
  keys removed, the old image refuses to start.
- On the manual docker-compose path there is no `mathion self-update` or
  `mathion update`: set `MATHION_VERSION` to the new tag, pull the image and
  run the migration yourself, as "Upgrade on the manual docker-compose path"
  under Operations in `docs/self-hosting.md` says. The migration prints the same
  `site-settings:` lines there too.
- With your own proxy in front of Mathion (not `mathion tls`), raise its body
  limit first (reproxy `--max`, nginx `client_max_body_size`) to a little more
  than the largest file you'll allow, then raise the limit in the panel. Raise
  its timeouts too (reproxy `--timeout.resp-header=30s --timeout.write=15m`,
  as in `docs/self-hosting.md`), or a slow email test and a large upload are cut off.

The release itself is the maintainer's step; nothing here is automated.
