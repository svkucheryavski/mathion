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
