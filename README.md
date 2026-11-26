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

- a 64-bit Ubuntu (22.04 or later) or Debian (12 or later) server, Intel/AMD
  or ARM. Another Linux works too if Docker and Docker Compose v2 are already
  installed;
- `curl` and `gpg` (`sudo apt install curl gpg` if they are missing);
- a domain name that points at the server, with ports 80 and 443 open;
- an email account (SMTP) that Mathion can send sign-in PINs from.

The commands below start with `sudo`. If you are logged in as root and the
server has no `sudo`, leave it out.

1. Log in to the server (over SSH), run the installer there and answer `Y`
   when it asks `Set up Mathion on this server now?`:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/svkucheryavski/mathion/main/deploy/install.sh | sudo sh
   ```

2. Answer the questions: your site address (for example `learn.school.edu`)
   and your email, which becomes the administrator's. It also asks two yes/no
   questions, whether to install Docker (when it is missing) and whether to
   turn on HTTPS with a free Let's Encrypt certificate; press Enter to take the
   suggested answer.
   Then it starts the site. If something stops HTTPS, the last lines say why
   and which command turns it on later.

3. The last lines show your sign-in email and a first PIN. Open your site,
   for example `https://learn.school.edu`, and sign in with them. A PIN
   works for a limited time; `sudo mathion pin you@school.edu` gives a new one.

4. Get a link to the admin panel:

   ```bash
   sudo mathion panel
   ```

   Open it in the browser where you just signed in. Its Set up page walks you
   through email, the site name, the first course and sign-in rules. Set up
   email first: until then, nobody else can sign in. The link stops working
   after 30 minutes without use; run the command again for a new one.

## Self-hosting

The full guide covers checking the installer's signature, the manual Docker
Compose setup, [using your own HTTPS proxy](docs/self-hosting.md#tls--reverse-proxy-external),
backups, upgrades and the `mathion` commands:
[docs/self-hosting.md](docs/self-hosting.md).

## Contributing

Developer setup, configuration and tests are in [DEVELOPER.md](DEVELOPER.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
