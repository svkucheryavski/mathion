# Mathion

**Run your own teaching platform.**

Mathion is an open-source learning platform for schools, universities and
training teams. It hosts your courses, assignments and student work on a server
you control. It is a simpler, lighter alternative to Open edX: one server, one
command-line tool to install and update it, and screens that stay out of the way.

Project site: https://svkucheryavski.github.io/mathion/

## What it does

**For students**

- Courses split into blocks (chapters), sequences (lessons) and items: text
  pages, videos, quizzes and interactive apps.
- A progress bar for every block and the whole course, and one clear deadline
  for each assignment.
- Formulas written in LaTeX show as real math in the browser.
- Sign in with a one-time PIN sent by email; there are no passwords to forget.
- Course pages work on a phone (interactive apps need a laptop or a larger
  screen).

**For teachers**

- Each course is taught as a run with its own dates; teachers add students and
  groups to it.
- A progress table shows where every student is.
- Mini-projects: student groups hand in a file, and teachers accept it, ask
  for a revision or reject it, with a score, written feedback and a feedback
  file. Groups can hand in again.

**For course authors**

- An editor for blocks, sequences, items and quizzes (single choice, multiple
  choice, numeric and text answers).
- Course versions: a published version stays fixed for its students while you
  prepare the next one.
- Import an existing Open edX course.
- Interactive apps: upload one JavaScript file and Mathion runs it in a sandbox
  that cannot reach the network ([rules for apps](docs/interactive-apps.md)).

**For the site administrator**

- An admin panel (the superuser panel) for users, courses, email, sign-in rules
  and branding (site name, logo and colours).
- A Set up page that walks you through the first steps.
- The `mathion` command installs, backs up, restores and updates the whole site.
- Every release of the `mathion` command is signed; the installer and
  `mathion self-update` check the signature before installing it.

## Install

You need:

- a 64-bit Linux server (Intel/AMD or ARM) with Docker, Docker Compose v2,
  `curl` and `gpg` installed;
- a domain name that points at the server, with ports 80 and 443 open;
- an email account (SMTP) that Mathion can send sign-in PINs from.

1. Install the `mathion` command:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh | sudo sh
   ```

2. Install Mathion and turn on HTTPS:

   ```bash
   sudo mathion install --domain learn.example.edu --admin-email you@example.edu
   sudo mathion tls enable --domain learn.example.edu --email you@example.edu
   ```

   Wait until `https://learn.example.edu` opens with a valid certificate; this
   can take a few minutes.

3. Get your first sign-in PIN for the `--admin-email` address, then open
   `https://learn.example.edu` and sign in with that email and PIN:

   ```bash
   sudo mathion pin you@example.edu
   ```

4. Get a link to the superuser panel and open it in the same browser. Its Set
   up page walks you through email, the site name, the first course and
   sign-in rules. Set up email first: until then, nobody else can sign in. The
   link stops working after 30 minutes without use; run the command again for
   a new one.

   ```bash
   sudo docker compose -p mathion_prod -f /etc/mathion/docker-compose.yml \
     --env-file /etc/mathion/.env exec -T app python -m mathion.superuser activate
   ```

To keep Mathion running after a reboot, run `sudo systemctl enable docker` once.

## Self-hosting

The full guide covers checking the installer's signature, the manual Docker
Compose setup, [using your own HTTPS proxy](docs/self-hosting.md#tls--reverse-proxy-external),
backups, upgrades and the `mathion` commands:
[docs/self-hosting.md](docs/self-hosting.md).

## Contributing

Developer setup, configuration and tests are in [DEVELOPER.md](DEVELOPER.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
