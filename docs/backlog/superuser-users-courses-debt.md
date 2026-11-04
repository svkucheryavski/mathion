---
worth: later
added: 2026-11-03
---
# Superuser panel: Users and Courses — deferred items

Real gaps the slice leaves on purpose, and the minors the review lanes raised, by task.
Spec: `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (§7).
Plan: `docs/superpowers/plans/2026-11-03-superuser-users-courses.md`.

## Out of scope (spec §7)

- **Files left on disk.** `delete_version` (`backend/mathion/api/versions.py:398-407`) and a non-force `delete_run` (`backend/mathion/api/runs.py:166-176`) leave `courses/<vid>` and `runs/<rid>` behind; the course delete can't see those. An asset upload racing a course delete can leave an orphan folder too: the upload commits its row before writing the file (T3 Opus r1). Open question that settles it: how much disk an install actually loses this way once real courses are retired.
- **Stale emails with email off.** The other email kinds still pile up in `notification_log` while email is disabled, and all go out at once when it is set up. The admin email avoids this (D5a). Open question: whether a first-time SMTP setup should drop or send the backlog — a Settings-slice decision.
- **Roster email checks.** The roster schemas accept any non-empty string as an email, the gap D4 closes for the panel. Open question: whether a bad roster address has ever caused trouble, or only clutter.

## Task minors

### Task 1 — one admin per course, `last_seen_at`

- The migration's `print` lines have no `flush=True`; under `docker compose run -T` stdout is a buffered pipe, so they can show up out of place in `mathion update`'s output (Opus r1).
- The printed lines name only ids; the admin's email and the course slug would make them a usable record of who lost admin rights (Opus r1).
- No test asserts the "one line per removed row" output; a `capsys` check in `test_keeps_lowest_id_admin_per_course` would (both lanes, r1).
- `verify_pin` stamps `last_seen_at` from the app clock while the new session's `last_active_at` takes the DB default; one `now` for both would keep them equal (Fable r1).
- `test_no_bump_inside_throttle` could also assert the session's `last_active_at` stayed (Fable r1).
- The comment above the throttled bump in `auth.py` still names only `last_active_at` (Opus r1).
- `test_backfill_from_real_sign_in_calls` asserts only `is not None` for the signed-in account; comparing with the PIN's `created_at` would pin the source too (Fable r3).

### Task 2 — panel write guard, the course-admin email

- An admin invited by email alone (no name yet, D8) reads "Hi anna@x," — the shared `_name` falls back to the email for every kind. Greeting "Hi," when `full_name` is empty would read better; a copy call for the user (Fable r1).
- A course deleted between the skip check and building the email raises `LookupError` → graded permanent, "flagged permanently" in the log. Milliseconds wide; could map to the "course gone" skip (Opus r1).
- If the admin goes A → B → A before the queue drains, A gets the same email twice (both rows pass the send-time check). Task 3's queueing could drop an older unsent row for the same course and person (Opus r1).
- `skip_reason` reports a missing recipient (FK cascade makes it near-unreachable) as "recipient disabled"; "recipient gone" would be more honest (Fable r1).
- No test puts a skipped row and a sendable row in one batch (Fable r1); none covers the skip check raising `SQLAlchemyError` (rollback, continue); none shows `course_admin_assigned` in a FileMailer `.eml` name (Opus r1).

### Task 3 — Courses API

- `delete-impact` with no admin (the `admin_id is None` branch) is untested; so are a list row with a disabled admin, PATCH with name and address together, and PATCH re-sending the current address (Fable r1).
- `_normalize_panel_email` strips, lowercases and length-checks, then calls `_normalize_email`, which does all three again; the inner check can't fire (Fable r2).
- `_SLUG_SHAPE` repeats `CourseCreate.slug`'s pattern literal; `CourseCreate` could take `pattern=_SLUG_SHAPE.pattern` so the two can't drift (Fable r2).
- The bad-email and bad-name tests accept any of their sentences for every case, so swapping two messages still passes; one expected sentence per case, as the slug test does, would pin them (Opus r2).

### Task 4 — Users API

- A sign-in waiting on the user-row lock during a disable still adds a session (rejected at its next request); if nothing uses it before a later Enable, that browser comes back signed in. Deleting unused PINs on disable too would make it fail as it does for an email change (Opus r1).
- A sign-in racing an email change gets a 500 (`StaleDataError` uncaught in `verify_pin`) instead of a clean refusal; safe, milliseconds wide (Opus r1).
- Untested: PATCH with name and email together on the happy path; Enable on a superuser row (allowed by ruling); disable keeping `RunTeacher` rows; the `lower(name)` order of `admin_of` (both lanes, r1).
- `_msg` is duplicated in both panel test files; a conftest home before Task 7 adds a third (Fable r1).
- The comment in `_assigned` says "The course is locked", which is inexact for `create_course` (a new, uncommitted course) (Fable r1).
- The `_locked_user` comment could name SQLAlchemy's unit-of-work flush order (the parent `users` UPDATE before `login_pins`/`sessions`) as why `last_seen_at` is written first, the invariant the lock relies on; its opening "closes the sign-in race" overstates the disable case its last sentence qualifies (both lanes, r2).

### Task 5 — panel shell, routes, shared pieces

- The shell's `expired` never resets if the token changes within one shell instance; unreachable today (a new token means typing a URL, which reloads) (Opus r1).
- An info `NoteStrip` inserted together with its text may not be announced by every screen reader (a status region announces changes, not its own insertion); for the VoiceOver pass at beta (Opus r1).
- `slugFromName`: ß, ł and đ don't decompose under NFKD and become a hyphen ("Straße" → "stra-e"); D13 names only æøå and accents, and a ß → ss line is cheap if wanted (Fable r1).
- Untested: a token spelled "users" reading as the Dashboard; `panelError`'s last fallback sentence; the expired text staying when a pill is clicked; FieldDialog's Cancel and Esc staying off while a save runs (dropping them would let Esc unmount the dialog and lose a 409's sentence) (both lanes, r1).

### Task 6 — Courses page

- After a course delete, focus returns to the trash of a row the reload removes; focus the heading or New course instead (Opus r1).
- Removing an admin someone else already removed: every Save gets the same 409 "This course has no admin" until Cancel; treat that answer as done, or move the baseline (Opus r1).
- Quiet list reloads are not ordered: an older reply can overwrite a newer one; a sequence counter as in `AdminEmailField` (Opus r1).
- The dialogs' error sentence is described on the form, not tied to its field (no `aria-invalid`); for the VoiceOver pass at beta (Opus r1).
- Enter-to-save goes through a `hidden` submit button, untested; check Safari submits through it in the Safari pass (Opus r1).
- A 409 from the delete-impact lookup does not reload the list (Opus r1).
- The blocked trash's reason is only in `title`; `aria-label` "Delete <name>" names it and a keyboard user sees no tooltip; put the reason in the label when blocked (Fable r1).
- Delete course on a course with 0 versions reads "Its 0 versions and their files go too."; skip the clause at 0 (Fable r1).
- Delete is gated on the impact lookup finishing, with no cue meanwhile; the failed-lookup-still-deletes path (D12a) is untested (Fable r1).
- The disabled hint ends with a period while §5 and the plan quote it without; ruled to keep the period (sentences end with one), spec to match at the next rev (Fable r1).
- The shell test does not check that `/superuser/T/courses` mounts the Courses page rather than the placeholder (Fable r1).

### Task 7 — Users page

- After a confirmed strip, focus is lost: Disable and Enable swap buttons, and a deleted row goes away; focus the heading or the row's next button (both lanes r1, as Task 6's delete).
- A failed reload after a strip action or a save swaps the table for the error view; the Courses page keeps the table (a quiet reload) (Opus r1).
- Opening a second row's strip while the first confirm runs: the first one's finish closes the second (Opus r1).
- Disable warning copy: two courses read "admin of A and B and teaches 2 runs" (two "and"s), and student runs are never named; the spec's D18 example covers admin and teacher only (Opus r1).
- "Last active" uses a `now` taken at the first render, so it drifts on a page left open; keep `now` with `shown` (Fable r1).
- `.u-count` is not a live region, so a screen reader does not hear the new count after a search or pill; for the VoiceOver pass at beta (Fable r1).
- Untested: typing then a pill click before the pause (one request, with the text); a page-level New account 409 reloading the list; a disabled admin's row (both lanes r1).
- Nits: `askEls` needn't be `$state`; after a 401/404 in a strip, the reload calls `onAuth` a second time (the shell handles it once) (Fable r1).
- EditCourseDialog (Task 6) compares the admin email with case: a case-only retype sends a PUT and gets the "already the admin" note; lowercase it as EditAccountDialog now does (Fable r2).

### Final whole-branch review

- The `last_seen_at` bump waits behind the panel's user lock (`auth.py:156-159`); a request in flight while its account is disabled, deleted or re-emailed can get one `StaleDataError` 500 instead of a 401 (Opus).
- The address-change warning reads "…: 0 runs, 0 students." on a course with no runs; skip the clause at 0 (both lanes).
- "<course> will have no admin." uses the saved name, not the one being edited in the same dialog (Opus).
- Replacing an admin in Edit course shows no "<old admin> will no longer be the admin." line; only clearing says what happens (Fable).
- The main-site `CourseUpdate.name` still accepts CR/LF and whitespace-only names; a line break makes a later admin email fail permanently; API-only, not reachable from the UI (Opus).
- No test runs two admin assigns at once; that they serialise is checked by reading the code only (Opus).
- Copy, user's call: "An email with a sign-in link is on its way" — the email links to the editor, and the colleague still asks for a PIN; the words are the spec's (Fable).
- The email-off note names `mathion pin` on a dev server too, where the command is `python -m mathion.superuser pin` (Fable).
- `_users_with_data` scans `runs.created_by`, `assets.uploaded_by` and `run_assets.uploaded_by`, none indexed, on each list and delete; fine at a university's size, index if lists slow down (Fable).
- No thousands separator in "Showing the 20 newest of 4213 accounts." (Fable).
- The delete-impact counts are not under the course lock; informational only (D12a), never to be treated as exact (Fable).
- `log_redaction.py` module docstring still describes token-only redaction; add the query string (both lanes, fix re-review).
- The test through uvicorn's real `AccessFormatter` uses a path with no query; add a `users?q=…` record (Opus, fix re-review).
- The 2026-07-14 hardening spec (lines 46, 78) still says the query string is preserved; add a "superseded 2026-11-03, see the Users+Courses spec §4" note (both lanes, fix re-review).

### Safari pass — D14 rev 8 (short chips, greyed disabled rows)

- The chips' hover list is in `title` only, so a sighted keyboard user can't open it; the chips are plain spans (both lanes; beta a11y pass).
- VoiceOver may read a chip's `title` and its hidden list twice; check in the VoiceOver pass at beta (Opus).
- A disabled account with no name and no role differs from a new one only by the near-white tint and the Enable glyph; the user approved the tint (Fable).
- Same-named courses, or same-titled runs in one course (run titles aren't unique, `models.py:207`), give identical lines in the hover list (Fable).
- `test_runs_order_by_course_then_title` pins `lower(Run.title)` (titles "A"/"a"/"B" fail without it on any collation) but not the `Run.id` tiebreak: Postgres happens to return the tied rows in insertion order. `lower(Course.name)` is unproven too; two courses "Algebra"/"algebra" would pin it (Opus r2).
