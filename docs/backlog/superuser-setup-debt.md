# Superuser Set up: deferred work

Minors from the per-task reviews and the whole-branch review, by task, plus the spec's follow-ups.

## Spec follow-up

- **The installer calls the panel link "optional"** (spec non-goals). `cli/cmd/install.go:242` ends its next steps with "(optional) superuser panel URL: …". With Set up, the panel is where a fresh site gets its email, name, first course and sign-in rules, so the link is the next step, not an option. Fix in a CLI release: drop "(optional)" and say the panel walks through setting up.

## Task 1 (storage and the migration)

- **A site with a course but no settings row gets no kept marks** (Opus r1 M1, Fable r1 M1). The migration's two `UPDATE`s match nothing, and `get_row` later creates the row with both marks false, so the Dashboard would show the Site name and Sign-in lines on an established site. Unreachable in practice: the settings migration always inserts the row and no code deletes it. Fix if it ever shows: insert a defaults row before the `UPDATE`s when a course exists, with a test.
- **Two migration tests are looser than they look** (Opus r1 M2, M3). No case has a branding row still named "Mathion", so dropping `<> 'Mathion'` passes; and the step check is tested only by refusing 5, so `BETWEEN 1 AND 3` passes. Fix: a no-course case with a "Mathion" row expecting `(False, False)`; accept step 4 and refuse step 0.
- **`test_fresh_database_turns_wizard_on` has no settings row** (Fable r1 M2), so it is "no row, no course", not a real fresh install (that one is `test_upgrade_without_course_turns_wizard_on`). Fix: rename it or add a comment.
- **The model's kept marks use `server_default="false"`, the migration `sa.false()`** (Fable r1 M3). Equal on Postgres and to the drift gate; `create_all` would emit `DEFAULT 'false'`. Fix: `sa.false()` in the model.

## Task 2 (the done rules, the send record, the kept marks)

- **A PIN sent to a developer outbox writes `last_sent_at`** (Opus r1 M1, Fable r1 M1). In `file`/`memory` mode `_send_login_pin` still calls `_record_on_card(site, None)`, which now reaches `_record_sent` (and `get_row` may create the settings row). The queue's dev path doesn't record, so the two disagree. Harmless while the mode stays a developer one (Email is done there anyway), but a database that ran in file mode and is later served with `smtp` starts with a send no mail server made. Fix: record the success only when `settings.email_mode not in DEV_MODES`, as `panel_sends` does in `api/auth.py`.
- **Missing tests for the email rule's edges** (Opus r1 M2–M5, Fable r1 M2). The code is right; nothing pins: the `last_sent_at` clear in the "latest test becomes the card's test" branch (§5's new provider whose test failed, saved anyway); the clear when the old password can't be read (`old_fp` None); "Email is off." and "Sending is failing" ahead of a passed test or a send (the off and failing cases carry neither); the boundary `card_test_at == last_sent_at` (done). Fix: one test each.
- **The not-done reason keys on `card_test_at`, not `card_test_ok`** (Fable r1 M3). `card_test_ok=False` with `card_test_at=None` would say "Not tested yet". Unreachable: the card's three fields are always set together. Fix: `EMAIL_TEST_FAILED if view.card_test_ok is False else EMAIL_NOT_TESTED`.
- **`_site_kept` in `test_superuser_branding.py` imports `load` inside the function** (Fable r1 M4). Style: move it to the top.

## Task 3 (the wizard's moves and the panel API)

- **The read that ends the wizard commits before it builds the answer** (Opus r1 M2, Fable r1 M3). `read` commits the D5a update, then `_panel_course(facts)` touches the expired Course and User: two extra queries, and an `ObjectDeletedError` (500) if that course or admin is deleted in the gap. The window is milliseconds. Fix: build the answer first, then run the conditional update and commit.
- **Tests that pin less than they look** (Opus r1 M1, M3; Fable r1 M1). No test tells D4's "first after this step, wrapping round" from "first from step 1" (`_on(db, step=3, mask=0b0010)`, `skip(3)` → 4, not 1); the writes with a missing `site_setup` table are untested (the read is); `test_expired_token_404` passes without the router (an unknown path is 404 too): add a 200 with a live token beside it.
- **Callers must commit before `read()`** (Opus r1 M4). The moves lock `site_setup` then write `site_settings`; a later endpoint that calls `read(db)` (whose D5a update locks `site_setup`) with its own `site_settings` change uncommitted would invert that and could deadlock two tabs. Note it in `read`'s docstring when a second caller appears. `setup_state` also imports the private `_panel_admin` and `email_is_set_up` from `api/superuser_courses.py` (the plan's choice); that becomes a cycle if Courses ever imports `setup_state`.
- **The step number parses loosely, and only a range error gets the sentence** (Opus r1 M5, Fable r1 M2). Pydantic takes `true` as 1 and `"2"` or `2.0` as 2; a missing or non-integer step gets the list-shaped 422, not "The step must be from 1 to 4.". The page always sends an integer. Fix if wanted: `StrictInt` and a `field_validator` with the sentence.

## Task 4 (the six shared forms)

- **The edit count isn't one convention** (Opus r1 M1, Fable r1 M3). `edits` is a plain field; `LogoPick.choose()` and `reset()` bump it directly (also for a file later refused), `SiteNameForm.resetToDefault()` doesn't bump it. No consumer reads it outside the email test today. Fix if a step needs it: make it `$state`, or route every change through `edited()`.
- **`saved` is fixed for a form's life** (Opus r1 M3). After a half-save the step builds a new form for the part that saved, which resets `edits` and normalises " 15" to "15". Accepted; Task 8 knows.
- **LogoPick has no "checking" state** (Opus r1 M5). Between `choose()` and the file read's answer, `changed` and `ready` still describe the previous choice. The old dialog had the same milliseconds-long window.

## Task 5 (the setup store, the route, the pill and the redirect)

- **Both entry moves mount the page being left for one flush** (Opus r1 M1, Fable r1 M1, M2). On the mount redirect `ready` turns true before `navigate` lands, so the Dashboard mounts for a microtask, fires its stats request, and the page change adds a second setup read; on a `/setup` entry that ends "leaving", SuperuserSetup mounts and unmounts the same way. Nothing paints, but Task 7's focus-on-show and `keepAlive` on mount would run on a page torn down at once. Fix in Task 7: `await navigate(...)` before `ready = true`, and hold the bar while `page === 'setup' && setupEntry === null && setup.state !== null`.
- **`keepAlive` has no stop a page can call** (Opus r1 M2, Fable r1 M3). Only `dispose()` stops it, and that ends the shell's store; its ticks are timed from the `keepAlive()` call, so the first read after typing starts can come up to 4 minutes late. Fix in Task 7: return a stop function, and say `dispose()` is the shell's alone.
- **A waiting pill looks live** (Opus r1 M3, Fable r1 M6). No rule styles `.su-pill[aria-disabled="true"]`, so while a save runs a click silently does nothing. Fix in Task 7 with the pill-wait test: `color: var(--muted); cursor: default;` and a gate row.
- **Cancel on the shell's leave question drops focus to `<body>`** (Opus r1 M4, Fable r1 M5). VersionsPage and VersionEditPage put it back with `focusAfter` on "cancel". Fix where the question ends up in Task 7.
- **A ⌘-, Ctrl- or middle-click on a pill cancels this tab's redirect** (Opus r1 M6, Fable r1 M4), though the click opens another tab. Fix: `routeClick(e, href); if (e.defaultPrevented) entryOpen = false;`.
- **Test gaps** (Opus r1 M5, Fable r1 note). Not pinned: a write queued while a read waits; a 404 to `onAuth` once; the four write calls' URLs; only the bar while "leaving"; re-entering `/setup` after it held "open" through an over answer, which should then leave.

## Task 6 (the Finish setting up card and the Courses note)

- **A failed Keep's sentence outlives its line** (Opus r1 M1). If a later read takes the Sign-in line away, the card's error stays under the other lines. Fix: clear `error` when the Sign-in line goes.
- **A successful Keep drops focus to the page** (Opus r1 M2): it removes its own button. Fix: move focus to the card's heading (tabindex -1) or the next line's link.
- **Keep makes the pills wait** (Opus r1 M3, Fable r1 M4). Ruling 1 sends it through `setup.write`, which sets `busy`; the "Do it now" links don't wait. Covered by Task 7's waiting-pill styling and test (Task 5 item above).
- **Try again on the Dashboard gives no sign of a press** (Opus r1 M4, Fable r1 M3). It isn't blocked while its read runs, and a failure with the same sentence leaves the screen unchanged. Fix if wanted: a `reading` flag on the store, bound to the button's loading state.
- **Test gaps** (Opus r1 M5, Fable r1 M1, M2, M5). Not pinned: Keep's double click and its `aria-disabled` while running; the Edit dialog's assign when the admin is you, at page level; "every step skipped (D4a)" in `setup.test.ts` only repeats "done steps are left out" (D4a is the server's): rename it.
- **Where the "no `mathion pin` command when it's you" rule lives** (Fable r1 M2). The Courses page decides it, `adminNote` writes the sentence; Task 9's step note needs the same. Fix in Task 9: a helper beside `adminNote` that returns `{ text, command? }`, used by both.
