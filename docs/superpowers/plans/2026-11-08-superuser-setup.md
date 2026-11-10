# Superuser panel: Set up — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a one-time **Set up** wizard on its own panel page (Email, Site name and logo, First course and its admin, Sign-in rules and limits), and a **Finish setting up** card on the Dashboard that lists the steps not done.

**Architecture:**
- **Backend (Tasks 1–3).**
  - One Alembic revision adds a one-row `site_setup` table and three `site_settings` columns: `site_name_kept` (D7, D4a), `sign_in_kept` (D9) and `last_sent_at` (D6).
  - `mathion/setup_state.py` owns the done rules, the reasons and the wizard's moves (D4–D10).
  - The queue, the PIN email and the Settings and Branding saves write the new facts.
  - `api/superuser_setup.py` has one read and four writes. Each answers the whole state (D13).
- **Shared forms (Task 4).** The six forms are moved out of their dialogs: email, site name, logo, new course, sign-in and limits. Each becomes a form class (`*.svelte.ts`) plus a fields component, so a dialog and a step use the same fields, checks and sentences (anti-goal 1). The dialogs keep their behaviour, and their tests prove it.
- **Shell and Dashboard (Tasks 5, 6).**
  - `SetupStore` is the one copy of the state (D13). It sends one request at a time, drops answers older than the last one applied, and keeps the link alive while typing.
  - The shell gets the `/setup` route, the pill and the once-per-tab redirect (D1, D2), and passes the store down.
  - The Dashboard gets the Finish setting up card (D12). The Courses note changes: "you", and Email's reason (D8).
- **The Set up page (Tasks 7–9).** The frame (the list, the step card, All set, D3a's hold) and step 1, then steps 2 and 4 (each a save that covers two endpoints), then step 3 (the note, the done view, the 409).

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic, PostgreSQL 17, Alembic, pytest (via `backend/.venv`); Svelte 5 runes, Vitest with jsdom (`mount`/`unmount`/`flushSync`); the zsh gate `frontend/scripts/visual-refresh-gate.sh`. No new npm or pip packages. No CLI change.

**Spec:** `docs/superpowers/specs/2026-11-06-superuser-setup-design.md`, rev 16 (`58df2f2`; rev 12 `6b28c2d` approved; rev 13 adds the user's D4a: a skipped Site name and logo, or Sign-in rules and limits, counts as done; revs 14–16 are its review).
- Its decisions D1–D13 and D4a and its sentences are binding. This plan cites them and doesn't repeat their reasons.
- Mockup: `.superpowers/brainstorm/45677-1793993092/content/wizard-layout.html`, option A. Where it differs from the spec, the spec wins.

**Line numbers** are from `6b28c2d`. An earlier task shifts them in files it also touches; find the place by the quoted text.

## Global Constraints

- **Branch:** `feat/superuser-setup` (off main `003df4f`). Local only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`.
  - `$SDD` = `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-11-06-superuser-setup`.
  - Probes go in `probe/`, logs and gate temp files in `tmp/`, screenshots in `shots/`. Never `/tmp`.
  - Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. Component tests use `mount` / `unmount` / `flushSync` from `svelte`, never `@testing-library/svelte`.
  - Python, pytest and alembic only through `backend/.venv`.
  - Match the surrounding comment density. A comment may carry the decision tag (`D3a`), never "added in this slice".
- **No new packages** (Python, JavaScript).
- **Colours:** theme tokens only, no literal colours, no `opacity` to dim.
- **UI** (spec §4):
  - same tab only;
  - the panel's existing components (`PanelHead`, `Button`, `NoteStrip`, `Segmented`, `Switch`, `InPlaceAsk` with `AskSlot`, `DirtyGuard`); `Modal` stays in the dialogs;
  - laptop-only, so no 400 px rule.
- **Copy:** plain words, never "he"/"she". Every quoted sentence in the spec is copied verbatim into code and tests.
- **Status codes:**
  - the panel guard's 404 means only "link expired";
  - a wizard write never answers 404 or 409; late ones answer 200 with the current state (D5a);
  - a bad step number is 422.
- **Panel calls:** the token guard, the CSRF header on writes (`require_superuser_panel_write`), and query strings redacted in the access log (already done for every `/api/superuser/` path).
- **Pinned CSS rules are single-selector blocks** (the gate's `d` helper matches `.cls.svelte-HASH{…}`). No apostrophe inside the gate's `node -e '…'` payload.
- **Commands** (write `$SDD` out in full when you run them):
  - **Backend:** `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo "exit $?"; tail -3 $SDD/tmp/pytest.log`. One file: `.venv/bin/pytest -q tests/<file>`.
  - **Frontend tests:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. Never bare `npx vitest`.
  - **Typecheck:** `npx svelte-check --output machine | tail -1`: 0 errors, no more warnings than the baseline.
  - **Gate:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. It ends `VISUAL-REFRESH GATE: ALL PASS (N checks)`. Bump `EXPECTED_CHECKS` (line 90, now 2937) by the rows a task adds. Rows pinned to a moved class move with it.
  - **Baselines:** at Task 1 start, record the gate, vitest, backend and svelte-check results in the ledger.
- **If an iCloud " 2" copy appears** (`find . -name "* 2.*"`), `cmp` it with its original and ask the user before deleting.
- **Per task, in this order** (the user's loop):
  1. TDD, step by step as written.
  2. The suites the task names, all green.
  3. Tasks 5–9: agent-browser shots at 1280 wide of the screens the task names. Use a fetch stub served from `$SDD/probe/` (as Branding's `t5_stub.js` did), with no dev data. Show the shots in an agterm overlay (`--size-percent 60`, base64 images, the HTML in `$SDD`), and get the user's OK on the look and on the copy marked *(mine)*.
  4. Two review lanes on the UNCOMMITTED diff: Opus (high effort) and Fable. ONLY ONE lane runs tests (the shared `mathion_test` database).
     - Fix every Critical and Important, then re-run both lanes after EVERY fix until both are clean.
     - Push back on a wrong finding with evidence.
     - Minors go to `docs/backlog/superuser-setup-debt.md` (created in Task 1) under the task's heading.
     - Never edit the tree while a lane reviews.
  5. With the user's commit OK: exact paths (never `git add -A`, never `logo.png` or `favicon.svg`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no session line.
  6. A ledger line in `$SDD/progress.md`, a memory update, then WAIT for the user's "go".
- **Dev servers and dev data:** start dev servers, run the dev migration, sign in, mint a panel token or write in the panel only with the user's yes. Never print the panel token. The ledger lists the rows to delete at the slice's end.

## Review Focus

These are the inputs most likely to bite a person that no other step pins down. Each one has its test in the task that owns it.

1. **An established site after the update shows the wizard**, or nags "Site name" or "Sign-in and limits" (D10, anti-goal 3). → Task 1, `test_upgrade_with_course_is_over_and_kept`.
2. **The admin's `mathion pin` instructions vanish**, either at once after step 3's automatic "step 3 saved" answer, or after a reload of the done view (D3a, D8). → Task 9, `the note survives its own step-saved answer` and `done view repeats the sign-in sentence`.
3. **Two tabs, or a late write after the wizard ended,** answer 404 or 409. The panel then shows "link expired", or Continue retries for ever (D5a). → Task 3, `test_late_writes_answer_200_with_state`.
4. **A failed read wipes typed values,** or a re-read moves the card away from an error or typed values (D2, D3a). → Task 5, `failed read keeps last good state`; Task 7, `held card ignores a re-read that moves the step`.
5. **A healthy upgraded site stays "Not tested yet" for ever**, because the send record is never written: `_clear_failure` returns early on a healthy server (D6). → Task 2, `test_sent_tick_records_last_sent_on_healthy_server`.

---

### Task 1: Storage, the migration, and the backlog file

**Files:**
- Create: `backend/alembic/versions/a6d2e9c4f1b8_site_setup.py` (revises `f3a9c1e7b2d4`)
- Modify: `backend/mathion/models_auth.py` (`SiteSettings` gains three columns; new `SiteSetup` after `SiteBrandingImage`)
- Modify: `backend/mathion/site_settings.py` (`SiteSettingsView` gains the three fields)
- Modify: `backend/tests/conftest.py:256` (`TRUNCATE site_settings, site_setup`)
- Create: `backend/tests/test_migration_site_setup.py`, `docs/backlog/superuser-setup-debt.md`

**Interfaces:**
- Produces:
  - `SiteSetup` (`site_setup`, `CheckConstraint("id = 1")`), with columns:
    - `id` int pk;
    - `wizard_on: bool` (not null);
    - `step: int` (not null, `CheckConstraint("step BETWEEN 1 AND 4")`);
    - `passed_mask: int` (not null, default 0; bit `1 << (n-1)` for step n).
  - Three new `SiteSettings` columns, each also on `SiteSettingsView`:
    - `site_name_kept: bool` and `sign_in_kept: bool` (not null, `server_default=false`);
    - `last_sent_at: datetime | None`.
  - `SETUP_REVISION = "a6d2e9c4f1b8"`.

- [ ] **Step 1: Write the failing migration tests** (pattern: `tests/test_migration_site_branding.py`, `BEFORE = "f3a9c1e7b2d4"`):
  - `test_fresh_database_turns_wizard_on`: downgrade to `BEFORE`, truncate `courses` and `site_settings`, then upgrade to head. Expect `site_setup` row 1 with `wizard_on` true, `step` 1, `passed_mask` 0, and both kept marks false if a settings row exists.
  - `test_upgrade_with_course_is_over_and_kept`: downgrade, insert one course plus the settings row 1 (as the settings migration leaves it), then upgrade. Expect no `site_setup` row (that means over, D10), and `site_name_kept` and `sign_in_kept` both true.
  - `test_upgrade_without_course_turns_wizard_on`: as above, but with a settings row and no course. Expect the wizard on and both kept marks false.
  - `test_upgrade_with_renamed_site_keeps_name`: no course, the settings row 1, and a `site_branding` row named "Lund" → wizard on, `site_name_kept` true, `sign_in_kept` false.
  - `test_downgrade_drops_table_and_columns`, `test_one_row_only`.
- [ ] **Step 2:** run `.venv/bin/pytest -q tests/test_migration_site_setup.py`: FAIL (no revision).
- [ ] **Step 3: Implement.**
  - **Model and view:** add the model and the three columns. `SiteSettingsView` gets `site_name_kept: bool = False`, `sign_in_kept: bool = False` and `last_sent_at: datetime | None = None`.
  - **Upgrade:**
    - create the table;
    - add the columns with `server_default=sa.false()` for both kept marks;
    - then, in SQL: `INSERT INTO site_setup (id, wizard_on, step, passed_mask) SELECT 1, true, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM courses)`, and `UPDATE site_settings SET site_name_kept = true, sign_in_kept = true WHERE EXISTS (SELECT 1 FROM courses)`, and `UPDATE site_settings SET site_name_kept = true WHERE EXISTS (SELECT 1 FROM site_branding WHERE site_name <> 'Mathion')`.
  - **Downgrade:** drop both columns and the table.
  - **Conftest:** truncate `site_setup` too, so every test starts with the wizard over (spec §4).
  - **Backlog file:** create it with a "Spec follow-up" entry: `cli/cmd/install.go:242` calls the panel link "optional" (spec non-goals).
- [ ] **Step 4:** run the migration tests: PASS. Then the backend suite: green.
- [ ] **Step 5: Commit** the files above, plus this plan and the ledger's first line: `feat(setup): the setup state's storage and its migration`.

### Task 2: The done rules, the send record and the kept marks

**Files:**
- Create: `backend/mathion/setup_state.py` (the done half; Task 3 adds the moves)
- Modify: `backend/mathion/notifications/dispatcher.py:391-410` (`_record`'s sent branch, `_clear_failure`, `record_send_outcome`)
- Modify: `backend/mathion/api/superuser_settings.py` (`save_email` clears the record; `save_limits` and `save_sign_in` set `sign_in_kept`)
- Modify: `backend/mathion/api/superuser_branding.py` (the name save and the logo save set `site_name_kept` through `get_row`, a Reset to default included; logo and icon share `_save_image`, so set it only when `kind == 'logo'`)
- Test: `backend/tests/test_setup_state.py`, `tests/test_dispatcher_settings.py`, `tests/test_superuser_settings.py`, `tests/test_superuser_branding.py`, `tests/test_auth_*` (the PIN email's success case: find the existing test of `record_send_outcome` via `api/auth.py`)

**Interfaces:**
- Consumes: Task 1's columns.
- Produces, in `mathion/setup_state.py`:
  - `STEPS = ("email", "site", "course", "sign_in")`
  - `@dataclass(frozen=True) class StepDone: done: bool; reason: str | None`
  - `email_done(view: SiteSettingsView, secret: str, email_mode: str) -> StepDone`
  - `site_done(name: str, kept: bool) -> StepDone`
  - `course_facts(db) -> CourseFacts`, where `CourseFacts` holds:
    - `first: tuple[Course, User] | None`: the course with an admin that has the lowest id, and that admin;
    - `without_admin: str | None`: the lowest-id course name without an admin, set only when `first` is None.
  - `defaults_in_use(view) -> bool`: all six sign-in and limit values equal `DEFAULTS`.
  - In `dispatcher.py`: `_record_sent(db, view, now)`. It replaces `_clear_failure`: it locks the fresh row (`_fresh_row`; when that answers None, it does nothing), sets `last_sent_at = now`, and clears the failure and the back-off.

- [ ] **Step 1: Write the failing tests.**
  - **`test_setup_state.py`, the email rule (D6), one test per reason, in first-match order.** Each test builds a `SiteSettingsView(...)`. The cases and their answers:
    - email off → `"Email is off."`;
    - a login with an unreadable seal → `"The saved password can't be read on this server."`;
    - `send_failure_message` set → `"Sending is failing: see Settings."`;
    - `card_test_ok=False` with no send → `"The last test failed."`;
    - nothing tested → `"Not tested yet: send a test email."`;
    - `card_test_ok=True` → done;
    - `last_sent_at` set and no card test → done;
    - `card_test_ok=False` with `card_test_at` before `last_sent_at` → done;
    - `card_test_ok=False` with `card_test_at` after `last_sent_at` → `"The last test failed."`;
    - email mode `file` → done (dev mode, D6), whatever the switch says.
  - **`test_setup_state.py`, the other rules:**
    - `site_done("Mathion", False)` → `"The site is still called Mathion."`; `site_done("Lund", False)` → done; `site_done("Mathion", True)` → done (D4a).
    - `course_facts`:
      - no course → both None;
      - courses 2 (no admin) and 3 (admin) → `first` is course 3;
      - only course 2 without an admin → `without_admin == <its name>`;
      - a disabled admin counts.
    - `defaults_in_use(DEFAULTS)` is True; changing any one of the six values makes it False.
  - **`test_dispatcher_settings.py`:**
    - `test_sent_tick_records_last_sent_on_healthy_server`: no stored failure, a tick sends → `last_sent_at` is set;
    - `test_sent_tick_skips_record_when_settings_changed` (`_fresh_row` is None);
    - `test_refusal_tick_records_failure_not_send`.
  - **The PIN email:** a successful send sets `last_sent_at`.
  - **`test_superuser_settings.py`:**
    - `test_email_save_with_changed_fingerprint_clears_last_sent`;
    - `test_email_save_unchanged_keeps_last_sent`;
    - `test_off_save_keeps_last_sent`;
    - `test_sign_in_save_marks_kept`;
    - `test_limits_save_marks_kept`.
  - **`test_superuser_branding.py`:** `test_name_save_marks_site_kept`, `test_logo_save_marks_site_kept`, `test_name_reset_marks_site_kept`, `test_logo_reset_marks_site_kept`, `test_icon_and_theme_saves_do_not_mark_site_kept`.
- [ ] **Step 2:** run the five files: FAIL.
- [ ] **Step 3: Implement.**
  - **Reasons:** module constants with the spec's exact sentences. `email_done` uses `password_is_readable`. The dev check is `email_mode in DEV_MODES`.
  - **`_record_sent`:** `_record`'s `elif result.sent:` and `record_send_outcome(..., None, ...)` both call it.
  - **`save_email`:** `if new_fp != old_fp: row.last_sent_at = None`, independent of the card-test branch.
  - **`save_limits` and `save_sign_in`:** set `row.sign_in_kept = True` before commit.
  - **Branding:** the name save (a reset too) and `_save_image` with `kind == 'logo'` (a reset too) set `get_row(db).site_name_kept = True` in the same transaction.
- [ ] **Step 4:** run the five files, then the backend suite: green.
- [ ] **Step 5: Commit:** `feat(setup): the done rules, the last send and the kept mark`.

### Task 3: The wizard's moves and the panel API

**Files:**
- Modify: `backend/mathion/setup_state.py` (the moves)
- Create: `backend/mathion/api/superuser_setup.py`; register in `backend/mathion/main.py` after `superuser_branding_router`
- Modify: `backend/mathion/schemas.py` (after `SignInIn`)
- Test: `backend/tests/test_superuser_setup.py`

**Interfaces:**
- Consumes: Task 2's rules; `branding.read_in(db).name` (never the cached `load_branding()`, spec §6); `email_is_set_up`, `_panel_admin` and the `sign_in_url` form from `api/superuser_courses.py`.
- Produces (schemas):
  - `PanelSetupStep(passed: bool, done: bool, reason: str | None)`
  - `PanelSetupCourse(name: str, sign_in_url: str, admin: PanelAdmin)`
  - `PanelSetup`, with fields:
    - `wizard_on: bool`;
    - `step: int` (1–4; the stored one while on, else 1);
    - `steps: list[PanelSetupStep]` (4, in `STEPS` order);
    - `course: PanelSetupCourse | None`;
    - `course_without_admin: str | None`;
    - `email_set_up: bool`;
    - `pin_minutes: int`;
    - `defaults_in_use: bool`.
  - `SetupStepIn(step: int)`: 1–4; anything else is a 422 with `"The step must be from 1 to 4."`.
- Produces (routes, each answering `PanelSetup`):
  - `GET /api/superuser/{token}/setup`;
  - `POST .../setup/go`, `.../setup/skip`, `.../setup/saved` with `SetupStepIn`;
  - `POST .../setup/keep-sign-in` (no body).
- Produces (`setup_state.py`): `read(db) -> PanelSetup`, `go_to(db, n)`, `skip(db, n)`, `saved(db, n)`, `keep_sign_in(db)`. Every write ends by returning `read(db)`.

- [ ] **Step 1: Write the failing tests** in `test_superuser_setup.py`. Use the panel fixtures from `tests/test_superuser_settings.py`. A helper inserts the `site_setup` row on.
  - `test_missing_row_reads_over` and `test_missing_table_reads_over` (spec D10: drop the table inside a savepoint, or monkeypatch the read to raise `UndefinedTable`).
  - `test_read_fresh_site`: on, step 1, no step passed or done, the three reasons, `defaults_in_use` true.
  - `test_skip_moves_to_next_not_passed`: skip 1 → step 2, step 1 passed and not done.
  - `test_skip_keeps_defaults` (D4a): skip 2 and skip 4 → both done; skip 1 and skip 3 → passed, not done.
  - `test_logo_only_save_counts`: name still "Mathion", `saved(2)` → step 2 done.
  - `test_saved_wraps_to_first_not_passed`: pass 2 and 3, go to 4, save 4 → step 1 (D4, D5: "Jumping to step 4 first").
  - `test_last_not_passed_ends_wizard`: skip 1–3, then skip 4 → `wizard_on` false, stored (a re-read without the row change is still over).
  - `test_read_with_all_done_ends_it` (D5a): make every step done on its own page, then read → over.
  - `test_done_step_counts_as_passed`: set a name, then read → `steps[1].passed`.
  - `test_late_writes_answer_200_with_state`: set `wizard_on = false` directly, with both kept marks false (no API path ends the wizard without setting them), then send go, `skip(2)`, `saved(2)` and `skip(4)`. Each answers 200 with `wizard_on` false, the row is unchanged, and both kept marks stay false.
  - `test_keep_sign_in_any_state`: with the wizard on and with it over, keep → `steps[3].done`. While on, if step 4 was the last not passed, the wizard ends.
  - `test_course_facts_in_answer`: `course.sign_in_url == f"{base_url}/courses/{slug}/edit"`, `admin.is_disabled` passes through, `pin_minutes` is the saved value, and `email_set_up` follows `email_is_set_up`.
  - `test_bad_step_is_422`, `test_writes_need_csrf`, `test_expired_token_404`.
- [ ] **Step 2:** run the file: FAIL.
- [ ] **Step 3: Implement.**
  - **`read`:**
    - load the row inside `db.begin_nested()`, catching `UndefinedTable` as `site_settings.load` does; a missing row or table means over;
    - compute `done` per step;
    - `passed = mask bit or done`;
    - if `wizard_on` and all four are passed, run `UPDATE site_setup SET wizard_on=false WHERE id=1 AND wizard_on`, commit, and answer over.
  - **The moves:** each one `SELECT … FOR UPDATE`, does nothing when the row is missing or off, then:
    - `go_to` sets `step = n`;
    - `skip` and `saved` set bit n; `skip(2)`, `saved(2)` and `skip(4)` also set that step's kept mark through `get_row` (D4a, D7); then `step = next_not_passed(n)`. That is the first step after n that isn't passed, wrapping round; when none is left, `wizard_on = false` (D4, D5).
  - **`keep_sign_in`:** sets `get_row(db).sign_in_kept = True`. It isn't a wizard write.
  - **Order:** no write ever inserts a `site_setup` row or turns the wizard on (spec §6).
- [ ] **Step 4:** run the file, then the backend suite: green.
- [ ] **Step 5: Commit:** `feat(setup): the wizard's moves and the panel API`.

### Task 4: The six forms, shared by the dialogs and the steps

No visible change. The dialogs keep every field, check, sentence, focus rule and busy rule. Their existing tests are the proof and must stay green unedited, apart from imports.

**Files:**
- Create: `frontend/src/lib/panelForms/emailForm.svelte.ts`, `siteNameForm.svelte.ts`, `logoPick.svelte.ts`, `courseForm.svelte.ts`, `signInForm.svelte.ts`, `limitsForm.svelte.ts`
- Create: `frontend/src/components/superuser/fields/EmailFields.svelte`, `SiteNameField.svelte`, `LogoPicker.svelte`, `CourseFields.svelte`, `SignInFields.svelte`, `LimitsFields.svelte`
- Modify: `EditEmailDialog.svelte`, `EditSiteNameDialog.svelte`, `EditImageDialog.svelte` (the `kind="logo"` reading, checking and decode-wait move into `logoPick`, which also serves `kind="icon"`), `NewCourseDialog.svelte`, `EditSignInDialog.svelte`, `EditLimitsDialog.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (rows pinned to the moved classes point at the new files)
- Test: `frontend/src/tests/panelForms.test.ts` (new); the existing dialog and Branding tests unchanged

**Interfaces:**
- Produces: one class per form. Each holds its `$state` fields and:
  - `changed: boolean` (`$derived`): differs from what it was built with;
  - `error: string | null`;
  - `edited()`: clears the error and bumps the edit count;
  - a `body()` that answers what the save sends, or a sentence. The sentences are the dialogs' own: `'Type a whole number.'` and `'The port must be from 1 to 65535.'`.

  The classes:
  - `class EmailForm`:
    - `constructor(saved: PanelEmailSettings)`;
    - `saveBody(): EmailSaveBody | string` (D7c: `{on:false}` alone when off);
    - `testBody(): EmailTestBody | string`;
    - `edits: number`;
    - `ready`.
  - `class SiteNameForm`: `constructor(saved: string)`, `body(): {name} | {reset: true} | string`.
  - `class LogoPick`:
    - `constructor(kind: 'logo' | 'icon')`;
    - `choose(file: File): Promise<void>` (the turn counter, `checkPngBytes`, the decode wait);
    - `pending`, `ready`, `shown`.
  - `class CourseForm`: `name`, `slug`, `slugEdited`, `email`, `onName()`, `ready`, `body()`.
  - `class SignInForm`: `constructor(saved: PanelSignIn)`, `body(): PanelSignIn | string`.
  - `class LimitsForm`: `constructor(saved: PanelLimits)`, `body(): PanelLimits | string`.

  Each fields component takes `{ form, uid, busy, ... }` and renders exactly the dialog's inputs and labels. The `es-`, `el-`, `nc-` and other classes move with them.

- [ ] **Step 1: Write the failing `panelForms.test.ts`.** One block per class, pinning the behaviour the dialogs had:
  - `EmailForm` off → `{on:false}`;
  - a port of `"58x"` → `'The port must be from 1 to 65535.'`;
  - the password is sent only when typed;
  - `SignInForm` with `"1.5"` → `'Type a whole number.'`;
  - `CourseForm` slug follows the name until edited;
  - `LogoPick` turn counter: of two quick choices, the last one wins.
- [ ] **Step 2:** run vitest: FAIL (no modules).
- [ ] **Step 3: Implement** the classes and fields components, then rewire the six dialogs onto them.
- [ ] **Step 4:** the frontend tests, svelte-check and the gate (rows moved, `EXPECTED_CHECKS` only if rows were added): all green, and the existing dialog tests unedited.
- [ ] **Step 5: Commit:** `refactor(panel): share the six forms between dialogs and steps`.

### Task 5: The setup store, the route, the pill and the redirect

**Files:**
- Create: `frontend/src/lib/setup.ts` (types, API calls, pure helpers), `frontend/src/lib/setupStore.svelte.ts`
- Modify: `frontend/src/routes.ts:19-23` (add `/superuser/:token/setup`), `frontend/src/lib/superuser.ts` (`PanelPage` gains `'setup'`)
- Modify: `frontend/src/pages/superuser/SuperuserShell.svelte`
- Create: `frontend/src/pages/superuser/SuperuserSetup.svelte` (a placeholder for now: the heading "Set up your site" and the store's error state; Task 7 fills it)
- Test: `frontend/src/tests/setupStore.svelte.test.ts`, `frontend/src/tests/SuperuserShell.svelte.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3's routes and `PanelSetup`, mirrored as TS types in `lib/setup.ts`. The API calls are `getSetup`, `setupGo`, `setupSkip`, `setupSaved` and `keepSignIn`, all with `{ skipAuthRedirect: true }`.
- Produces:
  - `class SetupStore` (`setupStore.svelte.ts`):
    - `constructor(token: string, onAuth: PanelOnAuth)`;
    - `state: PanelSetup | null`;
    - `failed: boolean`: true only while no read has succeeded (D2);
    - `read(): Promise<PanelSetup | null>`: waits for a running write; an answer older than the last one applied is dropped; after a good read, a failure keeps `state` (D2, D3a);
    - `write(call: () => Promise<PanelSetup>): Promise<PanelSetup>`: one at a time; it throws on failure, so the caller shows the error;
    - `busy: boolean`: a wizard write is running;
    - `saving: boolean`: set by a step around its own saves. While it or `busy` is true, the shell's pills wait (`aria-disabled`, and a click does nothing), as Back, Skip and the list do (D3);
    - `keepAlive(dirty: () => boolean)`: while `dirty()`, it reads every 240 000 ms, and stops 7 200 000 ms after the last `noteEdit()` (D3a, the user's 2 hours);
    - `noteEdit()`;
    - `dispose()`.
  - In `lib/setup.ts`:
    - `const SETUP_MARK = 'superuser_setup_seen'`;
    - `markFor(token): boolean`, `setMark(token)`, `clearMark()`: the mark stores the token, and a mark for another token reads as none (D2);
    - `entryMove(seg: string | undefined, state: PanelSetup): 'to-setup' | 'to-dashboard' | null`, a pure function:
      - `'to-setup'` only on the panel's own address while on and with no mark;
      - `'to-dashboard'` on `/setup` when over (D1);
      - otherwise null.
  - The shell:
    - creates one `SetupStore`, and passes `setup` to every page;
    - shows only its bar until the mount's read answers;
    - on that answer, runs `entryMove`, and calls `setMark(token)` whenever the answer says on;
    - re-reads on every panel page change;
    - clears the mark on Sign out and in the expired view;
    - puts the Set up pill first while `state?.wizard_on`, and keeps it while the page is `/setup` (D13);
    - `PAGES` keeps the Set up entry for the expired view's label (D1);
    - owns a dirty registry (`setContext(DIRTY_REGISTRY_KEY, …)`) and a `DirtyGuard` with `DISCARD_NAV_ASK`;
    - Sign out asks first when the registry is dirty (D3).

- [ ] **Step 1: Write the failing tests.**
  - **`setupStore.svelte.test.ts`**, with fake timers and a stubbed `api`:
    - `drops an older answer`;
    - `read waits for a running write`;
    - `failed read keeps last good state`;
    - `first failed read sets failed`;
    - `keepAlive reads every 4 minutes while dirty`;
    - `keepAlive stops 2 hours after the last edit`;
    - `401 goes to onAuth once`.
  - **`lib/setup.ts` cases:**
    - `entryMove` for `undefined` (the panel's own address) × on/over × mark/none;
    - `entryMove` for `'setup'` × over;
    - a mark for another token reads as none.
  - **Shell tests:**
    - `opens on Set up when on`;
    - `reload of Dashboard stays when marked`;
    - `pill first while on, gone after over once you leave Set up`;
    - `setup over on entry replaces the address with the panel's own`;
    - `sign out asks when dirty`;
    - `expired view clears the mark`;
    - `pill click never redirects`;
    - `re-reads on page change`.
- [ ] **Step 2:** run vitest: FAIL.
- [ ] **Step 3: Implement** as in the Interfaces block.
- [ ] **Step 4:** the frontend tests, svelte-check and the gate (pill rows if new classes): all green.
- [ ] **Step 5: Shots:** the panel with the pill on the Dashboard, and on the placeholder Set up page. Get the user's OK.
- [ ] **Step 6: Commit:** `feat(setup): the setup store, the Set up route, pill and redirect`.

### Task 6: The Finish setting up card and the Courses note

**Files:**
- Create: `frontend/src/components/superuser/FinishCard.svelte`
- Modify: `frontend/src/pages/superuser/SuperuserDashboard.svelte` (the card above the stat cards; the error state with Try again while `setup.failed`)
- Modify: `frontend/src/lib/superuser.ts` (`adminNote`), `frontend/src/pages/superuser/SuperuserCourses.svelte` (passes `me` and Email's reason)
- Test: `frontend/src/tests/FinishCard.svelte.test.ts`, `tests/setup.test.ts` (extend), `tests/SuperuserCourses.svelte.test.ts`, `tests/superuserApi.test.ts` (the `adminNote` cases)

**Interfaces:**
- Consumes: Task 5's `SetupStore`; `keepSignIn` from `lib/setup.ts`.
- Produces:
  - `finishLines(state: PanelSetup): FinishLine[]`, a pure function in `lib/setup.ts`.
    - `FinishLine = { step: 1|2|3|4; title: string; reason: string | null; page: 'settings' | 'branding' | 'courses'; keep: boolean }`.
    - Titles: `'Email'`, `'Site name and logo'`, `'First course and its admin'`, `'Sign-in rules and limits'`.
    - Reasons:
      - step 3: `` `${name} has no admin` `` when `course_without_admin` is set;
      - step 4: `"(Mathion's defaults are in use)"` when `defaults_in_use` is true.
    - `keep` is true on step 4.
  - `adminNote(result, kind, opts?: { me?: string | null; emailReason?: string | null })`:
    - **you:** `me` equals the admin's email, compared lower-cased. The note is then exactly:
      - create: `` `${course} is created; you are its admin. You'll find it on the Courses page of the main site.` ``;
      - assign: `` `You are now the admin of ${course}. You'll find it on the Courses page of the main site.` ``;
      - unchanged: `'You are already its admin; nothing changed.'`.
    - **`queued` with an `emailReason`:** the reason follows the sentence, after one space.

- [ ] **Step 1: Write the failing tests.**
  - **`finishLines`:**
    - a fresh state → four lines in order, with the reasons;
    - every step skipped → only the Email and First course lines (D4a);
    - done steps are left out;
    - the step 3 and step 4 reasons;
    - an all-done state → `[]`.
  - **`FinishCard`:**
    - `"Finish setting up"` and `"1 of 4 done"`;
    - every "Do it now" link has the page's `href`, followed in the same tab;
    - "Keep these values" calls `keepSignIn` and then `setup.read()`, and the line goes;
    - no card when everything is done.
  - **Dashboard:** while `setup.failed`, the error state and "Try again" show where the card goes, and the stat cards still show.
  - **`adminNote`:** the three "you" sentences; `queued` + `'Not tested yet: send a test email.'`; mixed case `Me@X.org` vs `me@x.org`; `me` null → the usual note.
- [ ] **Step 2:** run vitest: FAIL.
- [ ] **Step 3: Implement.**
  - The card's look: the Dashboard's `.card` white box at full width.
  - Each line: the title, " — ", the reason, then the links.
  - The Courses page passes `me = session.user?.email` and `emailReason = setup.state?.steps[0].done ? null : setup.state?.steps[0].reason`.
- [ ] **Step 4:** the frontend tests, svelte-check and the gate (`FinishCard` rows): green.
- [ ] **Step 5: Shots:**
  - the Dashboard with three lines;
  - the Dashboard with the error state;
  - the Courses note "you are its admin".

  Get the user's OK.
- [ ] **Step 6: Commit:** `feat(setup): the Finish setting up card and the Courses note`.

### Task 7: The Set up page frame, All set, and step 1 (Email)

**Files:**
- Modify: `frontend/src/pages/superuser/SuperuserSetup.svelte`
- Create: `frontend/src/components/superuser/setup/StepList.svelte`, `StepCard.svelte`, `AllSetCard.svelte`, `StepEmail.svelte`
- Modify: `frontend/src/lib/setup.ts` (the pure card rules)
- Test: `frontend/src/tests/SuperuserSetup.svelte.test.ts`, `tests/setup.test.ts` (extend)

**Interfaces:**
- Consumes: `SetupStore`; `EmailForm` and `EmailFields` (Task 4); `getSettings`, `saveEmail` and `testEmail` (`lib/superuser.ts`).
- Produces:
  - **The card type:** `type Card = 1 | 2 | 3 | 4 | 'allset'`.
  - **`cardAfterRead(shown: Card, state: PanelSetup, held: boolean): Card`**, pure:
    - when `held` (D3a: an error, unsaved changes or step 3's note), answer `shown`;
    - when `shown === 'allset'`, answer `'allset'`;
    - otherwise answer `state.wizard_on ? state.step : 'allset'`.
  - **`cardAfterOwn(state: PanelSetup): Card`**: the answer to this tab's own write. Step 3's note is the exception; Task 9 handles it.
  - **`StepCard` props:**
    - `title`, `note`;
    - `n: 1|2|3|4`;
    - `error: string | null`;
    - `busy`;
    - `mode: 'save' | 'continue' | 'none'`;
    - `canSave: boolean`;
    - `onBack?`, `onSkip?`, `onSave`;
    - a children snippet.

    It renders the heading (focused on step change, D3), the note, the fields, the error, and the footer: Back (absent on step 1), the skip button, then "Save and continue" or "Continue". The skip button reads `'Skip for now'` on steps 1 and 3, `'Keep the defaults'` on step 2 and `'Keep these values'` on step 4 (D4a). It renders only when `onSkip` is given, and each step passes `onSkip` only while `!setup.state.steps[n-1].done`, independent of `mode`, so a done step has none, even after an edit. Save is `aria-disabled` while `!canSave || busy`; Enter submits.
  - **The step component contract**, which Tasks 8 and 9 follow:
    - props `{ token, setup: SetupStore, onAuth, me, onDone: (state: PanelSetup) => void, back: () => void, skip: () => void }`;
    - it registers its dirty tracker with the shell's registry and calls `setup.noteEdit()` on each edit;
    - it holds (tells the page `held`) while it shows an error or unsaved changes.
  - **The page:**
    - the heading "Set up your site";
    - `StepList` (marks: tick when done, current, dashed when passed and not done, the number otherwise; every item clickable except on All set);
    - the shown card;
    - `AskSlot` for the leave question (Back, Skip or a list click on a dirty step, D3);
    - the store's error state with Try again in place of the card when `setup.failed` (D2).
  - **Step 1 text:**
    - title `'Email'` (the list says `'Email'` too);
    - note *(mine)* `'Sign-in links, PINs and notifications go out by email.'`;
    - the developer mode line is the spec's: `'Email goes to a developer outbox (set on the server).'`.
  - **List labels** (mockup): `'Email'`, `'Site name and logo'`, `'First course'`, `'Sign-in and limits'`.
  - **All set text (D5):**
    - `'Your site is set up.'`;
    - or `"Set up is over. These steps are left, and the Dashboard lists them until they're done:"` followed by the list titles;
    - one button, `'Go to the Dashboard'`.

- [ ] **Step 1: Write the failing tests.**
  - **`cardAfterRead`:** the full table of `held` × `allset` × on/over.
  - **The page:**
    - `held card ignores a re-read that moves the step`;
    - `own skip answer moves the card`;
    - `failed skip keeps the step and shows the error, retry resends` (D3a);
    - `Back/Skip/list on a dirty step asks first`;
    - `focus moves to the card heading on step change`;
    - `All set lists the steps left and its list cannot be clicked`;
    - `while a write or a step's save runs, Back/Skip/list and the pills wait` (D3);
    - `skip button label per step, and none on a done step, also after an edit (mode 'save')` (D4a).
  - **Step 1:**
    - `done step shows Continue when unchanged`;
    - `save then step saved, in that order`;
    - `a step whose save succeeded but step-saved failed retries only step-saved` (D3);
    - `not-done reason hidden while the form differs` (D6);
    - `a test answer triggers a store re-read, even after leaving step 1`;
    - `dev mode shows the outbox line and Continue`.
- [ ] **Step 2:** run vitest: FAIL.
- [ ] **Step 3: Implement.**
  - A step form starts from freshly read values each time it opens (`getSettings`). It shows a skeleton while loading, and the error state with Try again on a failure.
- [ ] **Step 4:** the frontend tests, svelte-check and the gate (the new classes' rows): green.
- [ ] **Step 5: Shots:**
  - step 1 (not done, with its reason);
  - step 1 done;
  - All set, with steps left.

  Get the user's OK, including the *(mine)* note.
- [ ] **Step 6: Commit:** `feat(setup): the Set up page, All set and the Email step`.

### Task 8: Step 2 (Site name and logo) and step 4 (Sign-in rules and limits)

**Files:**
- Create: `frontend/src/components/superuser/setup/StepSite.svelte`, `StepSignIn.svelte`
- Modify: `SuperuserSetup.svelte` (mount them)
- Test: `frontend/src/tests/SuperuserSetup.svelte.test.ts` (extend)

**Interfaces:**
- Consumes:
  - the step contract (Task 7);
  - `SiteNameForm`, `LogoPick`, `SignInForm` and `LimitsForm`, with their fields components (Task 4);
  - `getBranding`, `saveSiteName`, `saveImage` and `applyBranding` (as `SuperuserBranding.show` does);
  - `getSettings`, `saveSignIn`, `saveLimits` and `keepSignIn`.
- Produces: no new names. **The half-save rule** (Users/Courses D24) applies in both steps:
  - what saved becomes the step's new starting point;
  - the error shows;
  - Save and continue retries only the rest;
  - the page re-reads only after the whole sequence (D5a).
- **Step 2 text:** title `'Site name and logo'`; note `"Shown in every page's header and in emails."` (mockup). Save and continue waits for the chosen logo's checks and decode.
- **Step 4 text:**
  - title `'Sign-in rules and limits'`;
  - note *(mine)* `'How long a PIN lasts, how often people can ask for one, and how big files may be.'`;
  - Save and continue is usable with nothing changed (D9).

- [ ] **Step 1: Write the failing tests.**
  - **Step 2:**
    - `name then logo, each only when changed`;
    - `logo refused after the name saved: name stays, error shows, retry sends only the logo`;
    - `header shows the new name at once` (`applyBranding` called);
    - `not done says the site is still called Mathion`;
    - `skip keeps the defaults`: the step 2 button reads "Keep the defaults", sends only the skip write, and the list ticks it.
  - **Step 4:**
    - `unchanged save sends keep-sign-in then step saved`;
    - `changed sign-in only sends only sign-in`;
    - `limits refused after sign-in saved, when that completed the last step: error and typed limits stay, retry sends only limits, then All set`;
    - `"1.5" shows Type a whole number.`;
    - `skip on step 4 reads Keep these values, sends setupSkip(4) (never keepSignIn), ticks it and moves the card on` (D4a).
- [ ] **Step 2:** run vitest: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the frontend tests, svelte-check and the gate: green.
- [ ] **Step 5: Shots:** step 2 with a chosen logo; step 4 with the defaults. Get the user's OK, including the *(mine)* note.
- [ ] **Step 6: Commit:** `feat(setup): the site name and logo step, and the sign-in and limits step`.

### Task 9: Step 3 (First course and its admin)

**Files:**
- Create: `frontend/src/components/superuser/setup/StepCourse.svelte`
- Modify: `SuperuserSetup.svelte` (mount it; the note exception in `cardAfterOwn`), `frontend/src/lib/setup.ts` (`doneViewNote`)
- Test: `frontend/src/tests/SuperuserSetup.svelte.test.ts` (extend), `tests/setup.test.ts` (extend)

**Interfaces:**
- Consumes: `CourseForm` and `CourseFields`; `createCourse`, `adminNote(result, 'create', { me, emailReason })` and `pinCommand`; `NoteStrip`.
- Produces: `doneViewNote(state: PanelSetup, me: string | null): { text: string; command?: string }`, which builds the done view's text (D8):
  - it opens with `` `A course exists: ${name}.` ``;
  - next comes `` ` ${who} is its admin.` ``, or `' You are its admin.'` when the admin is you;
  - then the first sentence that applies (none when the admin is you):
    - the admin is disabled: `' This account is disabled. Enable it on the Users page so they can sign in.'`;
    - `!email_set_up`: `adminNote`'s own `email_off` tail, `` ` Email isn't set up on this server, so tell them yourself. They sign in at ${url} with a PIN: run ${pinCommand(email)} on the server (the PIN lasts ${n} minute(s)).` ``, with `command` set.
- **Step 3 text:**
  - title `'First course and its admin'`;
  - note *(mine)* `'A course and the person who will build it.'`;
  - fields: Course name, Address, Admin's email.
- **The no-admin line:** when `course_without_admin` is set, the form opens with `` `${name} has no admin: give it one on the Courses page, or create another course here.` ``

- [ ] **Step 1: Write the failing tests.**
  - `doneViewNote`, one case each: you; disabled; email off; email set up (no extra sentence); disabled and email off (disabled wins).
  - `the note survives its own step-saved answer`: the answer says step 4 or over, and the note is still on screen.
  - `Continue waits while step-saved runs, then moves by the newest state` (All set when over).
  - `list click after step-saved answered goes to the clicked step, or All set when the go answer says over`.
  - `step-saved failed: note stays, its error shows, Continue retries only step-saved`.
  - `409 shows the sentence, re-reads, and the done view replaces the form when step 3 is now done`.
  - `done view repeats the sign-in sentence` (email off, after a reload).
  - `no-admin course opens the form with its line`.
  - `held form still creates what was typed` (no 409).
- [ ] **Step 2:** run vitest: FAIL.
- [ ] **Step 3: Implement.**
  - "Step 3 saved" goes out right after the course is made, while the note shows.
  - Its answer updates the store, but never the card.
  - While it runs, Continue and the list wait.
- [ ] **Step 4:** the frontend tests, svelte-check, the gate and the backend suite: all green.
- [ ] **Step 5: Shots:**
  - step 3, empty;
  - the email-off note with the command;
  - the done view;
  - the no-admin line.

  Get the user's OK, including the *(mine)* note.
- [ ] **Step 6: Commit:** `feat(setup): the first course step`.

---

**After Task 9** (each on the user's go):
1. **Whole-branch review:** a fresh Opus lane and Fable.
2. **Dev migration and a Safari pass,** one step at a time, from spec §5. Start with a fresh-install open through sign-in.
3. **Cleanup:** the spec revision for anything the pass changed; dev rows deleted.
4. **The finishing menu.**
