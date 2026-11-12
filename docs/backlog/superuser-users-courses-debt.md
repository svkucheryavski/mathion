---
worth: later
added: 2026-11-03
---
# Superuser panel: Users and Courses — deferred items

Real gaps the slice leaves on purpose, and the minors the review lanes raised, by task.
Spec: `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (§7).
Plan: `docs/superpowers/plans/2026-11-03-superuser-users-courses.md`.

Sorted 2026-11-12: only items a person using the site can meet, and open calls, remain; test and comment nits were dropped and screen-reader items moved to beta-voiceover-pass.md.

## Out of scope (spec §7)

- **Files left on disk.** `delete_version` (`backend/mathion/api/versions.py:398-407`) and a non-force `delete_run` (`backend/mathion/api/runs.py:166-176`) leave `courses/<vid>` and `runs/<rid>` behind; the course delete can't see those. An asset upload racing a course delete can leave an orphan folder too: the upload commits its row before writing the file (T3 Opus r1). Open question that settles it: how much disk an install actually loses this way once real courses are retired.
- **Roster email checks.** The roster schemas accept any non-empty string as an email, the gap D4 closes for the panel. Open question: whether a bad roster address has ever caused trouble, or only clutter.

## Task minors

### Task 1 — one admin per course, `last_seen_at`

- The migration's `print` lines have no `flush=True`; under `docker compose run -T` stdout is a buffered pipe, so they can show up out of place in `mathion update`'s output (Opus r1).
- The printed lines name only ids; the admin's email and the course slug would make them a usable record of who lost admin rights (Opus r1).

### Task 2 — panel write guard, the course-admin email

- An admin invited by email alone (no name yet, D8) reads "Hi anna@x," — the shared `_name` falls back to the email for every kind. Greeting "Hi," when `full_name` is empty would read better; a copy call for the user (Fable r1).
- If the admin goes A → B → A before the queue drains, A gets the same email twice (both rows pass the send-time check). Task 3's queueing could drop an older unsent row for the same course and person (Opus r1).

### Task 5 — panel shell, routes, shared pieces

- `slugFromName`: ß, ł and đ don't decompose under NFKD and become a hyphen ("Straße" → "stra-e"); D13 names only æøå and accents, and a ß → ss line is cheap if wanted (Fable r1).

### Task 6 — Courses page

- Removing an admin someone else already removed: every Save gets the same 409 "This course has no admin" until Cancel; treat that answer as done, or move the baseline (Opus r1).
- Quiet list reloads are not ordered: an older reply can overwrite a newer one; a sequence counter as in `AdminEmailField` (Opus r1).
- A 409 from the delete-impact lookup does not reload the list (Opus r1).

### Task 7 — Users page

- A failed reload after a strip action or a save swaps the table for the error view; the Courses page keeps the table (a quiet reload) (Opus r1).
- Opening a second row's strip while the first confirm runs: the first one's finish closes the second (Opus r1).
- Disable warning copy: two courses read "admin of A and B and teaches 2 runs" (two "and"s), and student runs are never named; the spec's D18 example covers admin and teacher only (Opus r1).
- "Last active" uses a `now` taken at the first render, so it drifts on a page left open; keep `now` with `shown` (Fable r1).
- EditCourseDialog (Task 6) compares the admin email with case: a case-only retype sends a PUT and gets the "already the admin" note; lowercase it as EditAccountDialog now does (Fable r2).

### Final whole-branch review

- "<course> will have no admin." uses the saved name, not the one being edited in the same dialog (Opus).
- Replacing an admin in Edit course shows no "<old admin> will no longer be the admin." line; only clearing says what happens (Fable).
- Copy, user's call: "An email with a sign-in link is on its way" — the email links to the editor, and the colleague still asks for a PIN; the words are the spec's (Fable).
- No thousands separator in "Showing the 20 newest of 4213 accounts." (Fable).

### Safari pass — D14 rev 8 (short chips, greyed disabled rows)

- Same-named courses, or same-titled runs in one course (run titles aren't unique, `models.py:207`), give identical lines in the hover list (Fable).

### Safari pass — D14 rev 9 (capped hover lists)

- `cut()` counts code points, so it never splits a surrogate pair, but it can still split a visible character made of several code points (a ZWJ emoji, a flag, a letter plus a combining accent). Tooltip only, cosmetic; the comment and test name say "never splitting one in two", which overstates it (Opus).
- Fable concurs on code points vs visible characters: a cut between a letter and a combining accent drops the accent. `Intl.Segmenter` would cut by grapheme if it is ever wanted (Fable).
