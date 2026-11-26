# README split — short design

Approved by the owner on 2026-11-25.

**Why:** the README mixed developer setup with user material, and its 330-line self-hosting guide buried what Mathion is.

**Approaches:** (A, picked) README as a landing page with a short install, full self-hosting guide moved to `docs/self-hosting.md`, developer material to `DEVELOPER.md`; (B) README keeps the whole self-hosting guide under the pitch, about 350 lines.

**Design:**
- `README.md`: what Mathion is and who it is for (matching the project site's "Run your own teaching platform"), what it does for students, teachers, authors and the site administrator, today's install steps, links to the guide, `DEVELOPER.md` and the license.
- `docs/self-hosting.md`: the old self-hosting and CLI-update sections, moved word for word; only heading levels and relative links change, plus six rows added to the command table (tls, backup, restore, update, reconcile, self-update), which a review found missing.
- `DEVELOPER.md`: prerequisites, dev setup, runner scripts, configuration, tests (backend, frontend, gate, CLI) and where things are.
- Links that pointed at old README sections now point at the guide. The README keeps a "Self-hosting" heading, because `mathion install` prints `see README "Self-hosting"`.

**Not included:** CLI changes, screenshots, rewording the guide.

**Follow-up (owner, 2026-11-25):** an easier install as its own project: the installer sets up Docker, `mathion install` asks for missing values, turns on HTTPS and prints the first PIN, and a `mathion` command gives the panel link.
