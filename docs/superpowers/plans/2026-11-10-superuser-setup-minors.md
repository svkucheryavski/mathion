# Superuser Set up: the minors round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (Native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close every item in `docs/backlog/superuser-setup-debt.md` (user 2026-11-10: "Everything").

**Architecture:** No new surface. Each item is fixed where it lives, test first, and its bullet is deleted from the backlog in the commit that lands it. Items the user or a ruling decides not to change are deleted with the decision recorded in the ledger.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (Postgres 17), Svelte 5 runes, Vitest (mount/unmount/flushSync), Go (the CLI).

**Spec:** `docs/superpowers/specs/2026-11-06-superuser-setup-design.md` rev 17. Rev 18 adds D7's Remove link and the installer line.

## Global Constraints

- Branch `feat/superuser-setup-minors` from main `399ca02`. Local only: no push, no merge without the user.
- The user's loop per task: TDD → the task's suites green → shots + the user's OK where a screen changes → Opus (high) + Fable lanes on the UNCOMMITTED diff, fix every Critical/Important and re-run both after each fix → new minors to the backlog → commit on the user's OK → ledger + memory → wait for "go".
- pytest only via `backend/.venv`; vitest green = exit 0 and no "Errors"/"Unhandled" line; svelte-check 0 errors / 13 warnings; gate via zsh (`TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh`, 3028 at the start); Go: `cd cli && go test ./...`.
- No new packages. Theme tokens only. Copy: plain words, spec sentences verbatim.
- Never leave the repo dir; scratch in `.superpowers/sdd/2026-11-10-superuser-setup-minors/`.

## User decisions (2026-11-10)

- **U1 Installer line 4:** "4. Open the superuser panel; its Set up page walks you through email, the site name, the first course and sign-in rules: docker compose ... exec -T app python -m mathion.superuser activate".
- **U2 List text:** the dashed mark's hidden text is "(not done)".
- **U3 Step 4 errors:** keep one line, the first failing check (the bullet is closed as decided).
- **U4 Refused logo:** a "Remove" link beside the chosen file's name, only while a new logo is chosen; it drops the choice and keeps the saved logo. Shots before review.

## Review Focus

1. A skipped send record (whole-branch M1) leaves a site that failed, then recovered, at "Sending is failing" or at a stale "last test failed": the early return must not skip a needed clear.
2. Building `read()`'s answer before its commit must still answer `wizard_on: false` when it stores over, and never a 500 if a course goes between.
3. Shared step code (Task 8 M4) must keep each step's own hold, Discard and keep-alive: one step's tracker never answers for another.
4. The "Remove" link must never drop a logo that already saved, nor leave `due` set without a send.
5. Withdrawing the page's leave question on a card change must not drop a move the person confirmed.

---

### Task 1: Backend — storage, the done rules and the send record

**Items:** Task 1 M1–M4, Task 2 M1–M4, whole-branch M1–M3.

- [ ] Migration `a6d2e9c4f1b8`: when a course exists and no `site_settings` row does, insert the defaults row before the two kept `UPDATE`s. Test: a course and no settings row → `(True, True)`. (Not released yet; dev DB re-run not needed: it has the row.)
- [ ] Tighten tests: a no-course case with a branding row named "Mathion" → `(False, False)`; the step check accepts 4 and refuses 0. Rename `test_fresh_database_turns_wizard_on` → `test_no_settings_row_no_course_turns_wizard_on`.
- [ ] Model kept marks: `server_default=sa.false()`.
- [ ] `_send_login_pin`: record a success only when `settings.email_mode not in DEV_MODES`. Test: file mode PIN → `last_sent_at` stays None.
- [ ] Edge tests for `email_done`: the `last_sent_at` clear when the latest test becomes the card's test; the clear when the old password can't be read; "Email is off." and "Sending is failing" ahead of a passed test or a send; `card_test_at == last_sent_at` is done.
- [ ] `email_done`'s reason keys on `card_test_ok is False`.
- [ ] `_site_kept` import to the top of `test_superuser_branding.py`.
- [ ] `_record_sent`: return before `_fresh_row` when `view.last_sent_at` is set, no failure is stored (`send_failure_message`, `send_retry_at`, `send_backoff_step` all empty) and no failed card test is newer than `last_sent_at`. Tests: a healthy repeat send writes nothing (no row lock: assert the row's `updated` value or a statement count); a send after a failed card test still records.
- [ ] One helper `course_sign_in_url(slug) -> str` in a new `backend/mathion/course_links.py`, used by `setup_state` and `api/superuser_courses`. Test: both answers carry the same URL.
- [ ] `read()` works out `email_set_up` from the view `_done` loaded (not a second `load`). Test: one settings select per read.

Suites: backend pytest. Commit: `fix(setup): the backend minors`.

### Task 2: Backend — the read, the moves and the API

**Items:** Task 3 M1–M4.

- [ ] `read()`: build the answer, then run the conditional over update and commit. Test: a course deleted between `_done` and the answer can't 500 (unit: answer built before commit; assert `wizard_on` false and stored).
- [ ] Tests: `_on(step=3, mask=0b0010)`, `skip(3)` → step 4; the four writes with a missing `site_setup` table; a 200 with a live token beside `test_expired_token_404`.
- [ ] `read()`'s docstring: callers commit their own `site_settings` changes first (lock order `site_setup` → `site_settings`). Move `email_is_set_up` and `_panel_admin` (as `panel_admin`) to a neutral module (`backend/mathion/panel_people.py`), imported by both.
- [ ] `SetupStepIn.step`: `StrictInt` + a `field_validator`; a missing or non-integer step answers "The step must be from 1 to 4." Tests: `true`, `"2"`, `2.0`, missing.

Suites: backend pytest. Commit: `fix(setup): the read, the moves and the step check`.

### Task 3: The CLI installer line (U1)

- [ ] `cli/cmd/install.go` next steps line 4 per U1; a test asserts the new line and no "(optional)". README/docs that quote the old line follow.
- [ ] Spec rev 18: the non-goal's follow-up names the new line.

Suites: `cd cli && go test ./...`. Commit: `fix(cli): the installer names the panel's Set up as the next step`.

### Task 4: Frontend — the store, the shell, the Dashboard and the Courses note

**Items:** Task 5 test gaps; Task 6 M1–M5; whole-branch Fable M1.

- [ ] Task 5 tests: a write queued while a read waits; one `onAuth` for a 404; the four write URLs; re-entering `/setup` after an over answer held "open" leaves.
- [ ] FinishCard: a failed Keep's error clears when the Sign-in line goes; after a successful Keep focus moves to the card's heading (tabindex -1), or to the page heading when the card goes.
- [ ] Store `reading` flag (true while a read runs); the Dashboard's Try again shows `loading` and ignores presses while it runs.
- [ ] Tests: Keep double click and `aria-disabled`; the Edit dialog's assign when the admin is you, at page level; rename the "every step skipped (D4a)" test.
- [ ] Courses note with `setup.state === null`: re-read first, then build the note (with D6's reason if the read answers). Test.

Suites: vitest, svelte-check, gate. Shots: Try again while reading. Commit: `fix(setup): the store, the card and the Courses note`.

### Task 5: Frontend — the shared forms, the Set up page and the list

**Items:** Task 4 M1, M3 + Task 8 M3 (one fix), Task 4 M2 (closed as accepted), Task 7 all.

- [ ] One edit-count convention: every change goes through `edited()`; `LogoPick.choose()`/`reset()` and `SiteNameForm.resetToDefault()` call it.
- [ ] LogoPick `checking` state from `choose()` to the read's answer: `ready` false, `changed` true. Step 2's Save waits (blocked) while checking. Tests in `panelForms.test.ts` and step 2.
- [ ] Page: `focusAfter` the asking control when a move fails after Discard; the page's question is dismissed on unmount and on a card change; `move` refuses (focuses the shell's Cancel) while the shell's question is open, through a `navAsk.open` getter in context.
- [ ] StepList hidden text "(not done)" (U2).
- [ ] Task 7 test gaps (both rounds) as listed in the backlog.
- [ ] The `onHold` comment in `lib/setup.ts` reworded as the backlog says.

Suites: vitest, svelte-check, gate. Commit: `fix(setup): the forms, the page and the list`.

### Task 6: Frontend — steps 1, 2 and 4

**Items:** Task 7 r2 M1 (step 1 canSave), Task 8 all (M5 closed by U3), whole-branch Fable M3.

- [ ] A step helper in `lib/setup.ts` (`useStepGuards({ dirty, discard, errors, setup, onHold })` or equivalent) for the tracker, registry, onHold, keepAlive and moveError effect, used by StepEmail, StepSite, StepSignIn and StepCourse.
- [ ] Step 1: `canSave={(form?.ready ?? false) || (due && !changed)}`, the handler's gate the same; carry `result` over to the rebuilt form.
- [ ] Step 2: "Remove" link (U4; spec rev 18 D7), clear both errors at the top of `onSave`, the reason hides while `due` (steps 1 and 2).
- [ ] Comment nit in StepSignIn; the decode-stub harness loops until `decodes` grows (bounded) and installs only where used.
- [ ] Task 8 test gaps as listed.

Suites: vitest, svelte-check, gate. Shots: step 2 with a chosen logo and Remove; after a 413. Commit: `fix(setup): steps 1, 2 and 4`.

### Task 7: Frontend — step 3 and the Courses page

**Items:** Task 9 all.

- [ ] Focus to the footer's Continue when the note, the 409 done view or emptied fields replace the fields.
- [ ] Continue on the note sends "step 3 saved" again when `cardAfterOwn(setup.state) === 3`.
- [ ] Clear `form.error` and reset the form (and `slugEdited`) when the done view goes away under an emptied form.
- [ ] Nits: `savedOk` plain `let`; `canSave` reads `mode === 'save' ? form.ready : true`.
- [ ] Courses' note close button assertion; Task 9 test gaps as listed.

Suites: vitest, svelte-check, gate. Commit: `fix(setup): step 3 and the Courses note`.

**After Task 7** (each on the user's go): whole-branch review (fresh Opus + Fable), a short Safari pass of the screens that changed (Try again, step 2 Remove, focus after Enter on step 3), cleanup, the backlog file deleted if empty, the finishing menu.
