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
- **An email queued in the instant email is turned on is never sent** (Fable T1 r2 M2). A row's `created_at` is its transaction's start, so a panel request that began just before the switch went on but read it as on queues a row the dispatcher leaves out as born while off (D10a) and never closes; the A → B → A check then counts it as waiting, so re-assigning that person adds nothing either. A same-millisecond coincidence. Open question that settles it: whether the dispatcher should close born-off rows with an error instead of leaving them silent (the Settings queue, D10a).
- **Roster email checks.** The roster schemas accept any non-empty string as an email, the gap D4 closes for the panel. Open question: whether a bad roster address has ever caused trouble, or only clutter.

## Task minors

### Task 1 — one admin per course, `last_seen_at`

- The migration's `print` lines have no `flush=True`; under `docker compose run -T` stdout is a buffered pipe, so they can show up out of place in `mathion update`'s output (Opus r1).
- The printed lines name only ids; the admin's email and the course slug would make them a usable record of who lost admin rights (Opus r1).
