# Easier install: `mathion install` asks, installs Docker and turns on HTTPS

From this release, the one-line installer offers to set Mathion up right away,
and `sudo mathion install` asks for the site address and the admin's email when
`--domain` or `--admin-email` is missing. At the end it prints the first
sign-in PIN, or the exact next step. `sudo mathion panel` prints the admin
panel link.

What changes for scripts written for an older CLI:

- `mathion install --yes --domain … --admin-email …` now installs Docker and
  Docker Compose from Docker's signed packages when they are missing (Ubuntu
  22.04 or later and Debian 12 or later), and sets Docker to start at boot.
- `--yes` now also turns on the bundled HTTPS proxy (`mathion tls`) with a
  Let's Encrypt certificate. Add `--no-tls` to keep the old behaviour, for a
  server behind your own HTTPS proxy.
- Without `--yes` and without a terminal, nothing is asked: HTTPS stays off,
  and a missing Docker stops the install with a message.
- Running `mathion install` again on an installed server with HTTPS off asks
  about HTTPS again (or, under `--yes`, turns it on unless `--no-tls` is given).

The full flow is in `docs/self-hosting.md`, "Self-hosting with the `mathion` CLI".
