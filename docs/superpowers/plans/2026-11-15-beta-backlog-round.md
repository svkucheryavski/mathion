# Beta Backlog Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empty the code part of `docs/backlog/` before the first beta: the 4xx sentence, two mail-reset gaps, the Users/Courses debt, and every checklist bullet in the two beta-pass files that names a code fix.

**Architecture:** Three backend/lib tasks (each closes one backlog file), four frontend tasks grouped by surface (teacher run pages, superuser panel, authoring, student side, plus one CSS-only forced-colours task), and a final task that runs the checks agent-browser can do and rewrites the two checklists so they hold only person-only checks.

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL 17, pytest via `backend/.venv`; Svelte 5 runes, vitest (mount/unmount/flushSync), agent-browser (Chrome) for the checks.

**Spec:** the user's walk calls, copied below as C1-C5 (the walk file `.superpowers/sdd/2026-11-15-backlog-walk/calls.md` is scratch). Background specs: `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (D9c back-off, D10a off interval), `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (D4 email shape), `docs/superpowers/specs/2026-05-19-run-management-admin-design.md` (roster).

## Global Constraints

- **C1 (item 1):** a 4xx with no own JSON detail reads `REQUEST_ERROR_MESSAGE` ("Something went wrong. Try again."), never `res.statusText`, in `request()` and the asset helpers.
- **C2 (item 2):** a 421 (or a hang-up) to the RSET after a refused message is noticed: the refused message keeps its own refusal as its failure, the batch stops, and a 421 starts the back-off. After a refused DATA command, Mathion sends the RSET smtplib skips. The PIN-wait won't-fix stays as a `worth: no` item.
- **C3 (item 3):** (a) deleting a version or a non-forced run removes `courses/<vid>` / `runs/<rid>` after the commit; an upload that finds its version or run gone after writing removes the folder. (b) The dispatcher closes rows born in the off interval with `skipped: email was off` instead of leaving them silent. (c) Roster add and import check the panel's email shape (`^[^@\s]+@[^@\s]+$`), sentence "Enter an email address"; a bad import row gets its own error, the others go in.
- **C4 (item 4):** fix every beta-browser-pass bullet with a named fix; run in agent-browser every check Chrome can do (forced-colours and reduced-motion emulation, widths); the file keeps only Safari / Windows / real-proxy checks plus re-checks of the new fixes.
- **C5 (item 5):** fix every beta-voiceover-pass bullet with a named fix, tested in jsdom and the accessibility tree; kept choices stay; the file keeps only what VoiceOver must confirm (including the new fixes).
- No new npm or pip packages. Svelte 5 runes only. Code comments one short plain line.
- Python only via `backend/.venv`. Never run migrations on the dev DB `mathion` (this round adds none).
- Never `git add` `logo.png` or `favicon.svg`; stage exact paths.
- Per task: TDD (RED first; a test green on its first run gets a mutation check), then Opus + Fable review lanes on the uncommitted diff, re-review after every fix, commit on the user's OK.
- Gates per task: the task's tests, then `cd frontend && npx vitest run` (exit 0, no "Errors"/"Unhandled" line) and `npx svelte-check` (0 errors) for frontend tasks, `backend/.venv/bin/pytest -q` for backend tasks, and the visual-refresh gate (run with zsh) for any task touching `.svelte`/CSS.

## Review Focus

1. **A refusal followed by a server that is simply slow to answer the RSET** (no 421, no hang-up): nothing changes from today; the batch goes on. Task 2 pins it with a 250-to-RSET case.
2. **A double RSET after a refused body** (smtplib already sent one, and the DATA-command wrapper must not add a second): only a refused DATA *command* gets Mathion's RSET. Task 2 asserts the RSET count in the stub's log.
3. **An import with a mix of good and bad addresses** must add the good ones and report each bad one; the whole batch must never 422. Task 3 pins a 3-row mixed batch.
4. **A live region mounted empty then filled** must still render nothing visible while empty (no stray gap in a flex column). Task 6 asserts the empty wrapper has no text and the hint row's gap is unchanged.
5. **The external-link hidden text applied twice** (the `{@html}` re-renders, `externalLinks` runs again): one span per link. Task 8 pins idempotence.

---

### Task 1: The 4xx sentence (backlog `raw-4xx-status-text.md`)

**Files:**
- Modify: `frontend/src/lib/api.ts:90`, `frontend/src/lib/assets.ts:73`, `frontend/src/lib/assets.ts:107`
- Test: `frontend/src/tests/api.test.ts:208-217`, `frontend/src/tests/assets.test.ts`
- Delete: `docs/backlog/raw-4xx-status-text.md`

**Interfaces:** none new; `REQUEST_ERROR_MESSAGE` from `lib/api.ts`.

- [ ] **Step 1:** Flip the pinned test to `'a %i with no sentence of its own says the general sentence'` for `[413,'Payload Too Large'],[429,'Too Many Requests'],[431,'Request Header Fields Too Large'],[403,'Forbidden']`: `expect(err).toMatchObject({ status, detail: REQUEST_ERROR_MESSAGE })`. Add the same for `fetchAssetSource` (`assets.ts:107`, a 403 with `statusText: 'Forbidden'`) and the upload helper (`assets.ts:73`, a 413 HTML page): detail is `REQUEST_ERROR_MESSAGE` (the upload helper's `'Upload failed'` fallback goes too).
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/tests/api.test.ts src/tests/assets.test.ts` — Expected: FAIL (detail is the status text).
- [ ] **Step 3:** In all three places pass `REQUEST_ERROR_MESSAGE` as the fallback (`errorDetail(res, parsedBody, REQUEST_ERROR_MESSAGE)`; `fetchAssetSource` throws `new ApiError(res.status, errorDetail(res, undefined, REQUEST_ERROR_MESSAGE))`). Drop the HTTP/2 comment that no longer applies.
- [ ] **Step 4:** Re-run — Expected: PASS. Then the full vitest + svelte-check gates.
- [ ] **Step 5:** Commit with `git rm docs/backlog/raw-4xx-status-text.md`: `fix(api): a 4xx with no sentence of its own says the general sentence`.

### Task 2: The mail resets (backlog `superuser-settings-debt.md`)

**Files:**
- Modify: `backend/mathion/notifications/mailer.py:97-168` (`session`, new `_watch_reset`, `send`), `backend/mathion/notifications/smtp_errors.py` (new `closed_after`), `backend/mathion/notifications/dispatcher.py:418-440` (error branch)
- Test: `backend/tests/test_smtp_errors.py` (uses `_stub`, `_talker`), `backend/tests/test_dispatcher_settings.py`
- Replace: `docs/backlog/superuser-settings-debt.md` → `docs/backlog/pin-email-ignores-backoff.md` (`worth: no`, the won't-fix bullet's text, `added: 2026-11-15`)

**Interfaces:**
- Produces: `smtp_errors.closed_after(exc: BaseException) -> BaseException | None` — the 421 (`smtplib.SMTPResponseException(421, msg)`) or `smtplib.SMTPServerDisconnected` met at the reset after `exc`, else None. `SMTPMailer.send` sets it as the attribute `closed_after` on the exception it re-raises.

- [ ] **Step 1: Write the failing tests** in `test_smtp_errors.py`, each driving `SMTPMailer` (built as `test_notifications_mailer._smtp` does, encryption `none`, no login) against a `_stub`:
  - `test_a_421_to_the_reset_after_a_refusal_is_kept`: RCPT → `550 no such user`, RSET → `421 closing`. `send()` raises `SMTPRecipientsRefused` whose `closed_after(exc).smtp_code == 421`; `closing(exc)` is False; `describe(exc).code == 550`.
  - `test_a_hang_up_at_the_reset_is_kept`: RCPT → 550, the stub closes the socket on RSET. `isinstance(closed_after(exc), smtplib.SMTPServerDisconnected)`.
  - `test_a_250_to_the_reset_changes_nothing`: RCPT → 550, RSET → 250. `closed_after(exc) is None`.
  - `test_a_refused_data_command_is_reset`: a stateful stub that answers `503 nested MAIL command` to MAIL inside an open transaction; DATA → `554 no`. First `send()` raises `SMTPDataError(554)`; the stub's log has exactly one `RSET` after `DATA`; a second `send()` in the same session succeeds.
  - `test_a_refused_body_gets_one_reset`: DATA → 354, end of body → `554 rejected`. Exactly one `RSET` in the log (smtplib's own).
  - `test_a_refused_data_command_then_a_421_reset`: DATA → `451`, RSET → `421 closing`. `closed_after(exc).smtp_code == 421`.
- [ ] **Step 2:** Dispatcher tests in `test_dispatcher_settings.py` with a fake mailer whose first `send` raises `SMTPRecipientsRefused({"a@x": (550, b"no")})` carrying `closed_after = SMTPResponseException(421, b"closing")`:
  - `test_a_421_after_a_refusal_charges_the_refusal_and_backs_off`: row 1 is charged with the 550 failure (its stored error is the recipient sentence, not TRY_LATER); row 2 is untouched (`attempts` unchanged); `result.failure.sentence == TRY_LATER`.
  - `test_a_hang_up_after_a_refusal_ends_the_batch_uncharged`: same with `closed_after = SMTPServerDisconnected()`: row 1 charged with its refusal, row 2 untouched, `result.connected is False`, `result.failure is None`.
- [ ] **Step 3:** Run `backend/.venv/bin/pytest -q backend/tests/test_smtp_errors.py backend/tests/test_dispatcher_settings.py -k "reset or refusal"` — Expected: FAIL (`closed_after` missing).
- [ ] **Step 4: Implement.**
  - `SMTPMailer._watch_reset(smtp)` (static, installed in `session()` next to `_stop_on_421`): replaces `smtp._rset` with a wrapper that calls `smtp.rset()`; a 421 reply records `SMTPResponseException(421, msg)` and `smtp.close()`s; `SMTPServerDisconnected` records that exception. It also wraps `smtp.data`: an `SMTPDataError` raised by `data()` itself (the DATA command; `data()` raises only there) with a code other than 421 calls `smtp._rset()` then re-raises. The recorded exception lives on the mailer instance (`self._closed_by`).
  - `send()`: clears `self._closed_by`; on an exception from `send_message`, sets `exc.closed_after = self._closed_by` when set, and re-raises.
  - `smtp_errors.closed_after(exc)`: `getattr(exc, "closed_after", None)`.
  - Dispatcher error branch, after `_charge(...)`: `after = closed_after(send_exc)`; a 421 → `result.failure = describe(after, recipient=recipient, **_where(mailer, view))`, log as the closing branch does, `break`; a disconnect → `result.connected = False`, `break` (as the existing mid-batch disconnect).
  - The PIN path (`api/auth.py:_send_login_pin`) is unchanged: one message, the session ends anyway.
- [ ] **Step 5:** Re-run — Expected: PASS. Full `backend/.venv/bin/pytest -q`.
- [ ] **Step 6:** Commit with the debt file replaced by `pin-email-ignores-backoff.md`: `fix(mail): a server closing at the reset stops the batch, and a refused DATA is reset`.

### Task 3: Users and Courses debt (backlog `superuser-users-courses-debt.md`)

**Files:**
- Modify: `backend/mathion/api/versions.py:395-404` (`delete_version`), `backend/mathion/api/runs.py:166-205` (non-force path; one `_remove_run_tree(run_id)` used by both paths), `backend/mathion/api/assets.py:79-100` (`upload_asset`), `backend/mathion/api/run_assets.py:29-70` (`upload_run_asset`)
- Modify: `backend/mathion/notifications/dispatcher.py:280-289` (off interval), `backend/mathion/api/superuser_settings.py:58` (`_SKIPPED_OFF` moves to the dispatcher as `SKIPPED_OFF`, imported back)
- Modify: `backend/mathion/schemas.py:528-546` (roster schemas), `backend/mathion/api/run_roster.py:52` (`add_student`), `:168-…` (`add_students_batch`), `BulkRosterErrorCode` (`schemas.py:576`) + `frontend/src/lib/types.ts:347` gain `'invalid_email'`
- Test: `backend/tests/test_versions.py`, `backend/tests/test_runs.py`, `backend/tests/test_assets_api.py`, `backend/tests/test_run_assets.py`, `backend/tests/test_dispatcher_settings.py`, `backend/tests/test_run_roster.py`, `backend/tests/test_run_roster_bulk.py`, `frontend/src/tests/RunRosterTab.toolbar.svelte.test.ts`
- Delete: `docs/backlog/superuser-users-courses-debt.md`

**Interfaces:**
- Produces: `dispatcher.SKIPPED_OFF = "skipped: email was off"`; `schemas.email_shape_ok(v: str) -> bool` (the panel's `_PANEL_EMAIL_SHAPE` check, reused by `_normalize_panel_email`).

- [ ] **Step 1: Failing tests.**
  - `test_delete_created_version_removes_its_folder` / `test_delete_unpublished_run_removes_its_folder`: create the folder with a file under `settings.asset_path`, delete via the API (204), assert the folder is gone.
  - `test_upload_into_a_version_deleted_meanwhile_leaves_no_folder` (and the run twin): monkeypatch `os.replace` in the handler's module to delete the version (or run) in a separate `SessionLocal()` before calling the real one; after the request the folder does not exist.
  - `test_rows_born_off_are_closed_skipped`: a row created inside `[off_at, on_at)` and still open after the turn-on (late commit); after `tick`, `row.error == SKIPPED_OFF` and `sent_at is None`. Update `test_late_commit_in_off_interval_not_sent` to expect the closed row.
  - `test_add_student_rejects_a_bad_email`: POST `{"email": "anna"}` → 422 with `detail == "Enter an email address"` (a string, raised in the handler, so the add row shows it as is).
  - `test_batch_with_a_bad_email_adds_the_rest`: rows `anna@uni.dk`, `not-an-email`, `bo@uni.dk` → 207; row 2 `status == "error"`, `error_code == "invalid_email"`, `detail == "Enter an email address"`; rows 1 and 3 added.
  - Frontend: the add row shows "Enter an email address" for that 422 (`RunRosterTab.toolbar` test).
- [ ] **Step 2:** Run the named tests — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Deletes: after the commit, `shutil.rmtree(<folder>, ignore_errors=True)` (as `superuser_courses.py:253` does).
  - Uploads: after the file is in place (and, for runs, after the commit or its failure), `db.expire_all()`; if `db.get(CourseVersion|Run, id)` is None, `shutil.rmtree` the version folder / run tree.
  - Dispatcher: when `off_interval` has both times, before the select, `update(NotificationLogEntry).where(open, born_off).values(error=SKIPPED_OFF)` and commit; the select's `not_(born_off)` stays.
  - Roster: `RunStudentCreate`/`RunStudentBatchRow` keep `_normalize_email`; `add_student` raises `HTTPException(422, "Enter an email address")` when `not email_shape_ok(data.email)`; the batch loop gives such a row `{"status": "error", "error_code": "invalid_email", "detail": "Enter an email address"}` before any lock work for it.
- [ ] **Step 4:** Re-run — Expected: PASS. Full pytest, vitest, svelte-check.
- [ ] **Step 5:** Commit with `git rm docs/backlog/superuser-users-courses-debt.md`: `fix: delete leaves no folders, born-off rows close, roster checks emails`.

### Task 4: Forced colours and confirm-row layout (CSS)

**Files:**
- Modify: `frontend/src/components/editor/ItemTypePicker.svelte:61`, `frontend/src/components/editor/QuestionTypePicker.svelte:50` — `label.selected { border-color: Highlight; outline: 2px solid Highlight; outline-offset: -1px; }` (border width stays 1px).
- Modify: `frontend/src/components/editor/BlockAccordion.svelte:441-445`, `frontend/src/components/editor/SequenceAccordion.svelte:364-368` — `@media (forced-colors: active) { .block-card.focus, .block-card.parent { outline: 2px solid CanvasText; outline-offset: -1px } }` (and `.seq-card.focus`).
- Modify: `frontend/src/components/ui/Switch.svelte:50-79` — `@media (forced-colors: active) { .switch { border: 1px solid ButtonText } .switch.on .knob { background: Highlight; forced-color-adjust: none } }`.
- Modify: `.ro-confirm-row td` / `tr.delete-row td` top padding `4px` in `RunRosterTab.svelte:1184`, `RunAssetsTab.svelte:979`, `RunMiniProjectsTab.svelte:448`, `pages/superuser/SuperuserUsers.svelte:340`.
- Modify: `frontend/src/components/ui/InlineConfirm.svelte:115` — `.inline-confirm.end .warning { text-align: end; }`.
- Modify: the Run Assets table at 1000px — if the agent-browser check (Step 1) shows the Filename column squeezed by a long filename + long uploader email, give the Filename column `min-width: 12rem` and let the email cell wrap (`overflow-wrap: anywhere`).

- [ ] **Step 1:** In agent-browser (Chrome, `--color-scheme`, CDP `Emulation.setEmulatedMedia` with `forced-colors: active`), screenshot before: the picker's selected card, a focused block panel, the Switch on/off, a roster delete confirm row, a wrapped `align="end"` warning, the Assets table at 1000px with a 120-char filename and a 60-char email. Record which defects show.
- [ ] **Step 2:** Apply the CSS above (the Filename rule only if Step 1 showed the squeeze; otherwise ledger a ruling).
- [ ] **Step 3:** Screenshot after, same states; compare. The gate and the full vitest + svelte-check.
- [ ] **Step 4:** Commit: `fix(css): forced-colours cues, confirm-row ring room, end-aligned warnings`.

### Task 5: Teacher run pages — keyboard and screen reader

**Files and fixes** (tests: the component's own test file named in each line):
- `components/runs/RunRosterTab.svelte:494` — `onAddKeydown` ignores an Esc whose target is the group `<select>` (`RunRosterTab.toolbar`).
- `RunRosterTab.svelte:520` + form `:720` — an always-mounted `<p class="vh" role="status">` filled with `` `${email} added` `` after a successful add, cleared on the next input (`RunRosterTab.toolbar`).
- `RunRosterTab.svelte:102-108` — the import opened from the empty-roster link remembers it (`openedFromLink`); Cancel/Esc with no import refocuses that link (`RunRosterTab.svelte.test`).
- `components/runs/MiniProjectModal.svelte:659-661` — the server-error banner moves to the top of the body, before `.mpm-block` (`MiniProjectModal.create-edit`).
- `MiniProjectModal.svelte:665,783` — `role="list"` on `.mpm-box-list`; `content: '· ' / '';` (`MiniProjectModal.box`).
- `components/runs/PublishConflictsModal.svelte:66` and `RosterImportModal.svelte:215` — `role="list"`.
- `components/ui/DangerConfirm.svelte:84` — group name `` `Confirm ${confirmLabel.toLowerCase()}` `` (`DangerConfirm`).
- `RunMiniProjectsTab.svelte:365`, `RunAssetsTab.svelte:832` — the warning becomes `Delete "{title}"?` / `Delete "{filename}"?` (no extra label, so the group is named after its row once).
- `pages/runs/RunDetailPage.svelte:473` — `tabindex="0"` on the tabpanel (`RunDetailPage.tabs`).
- `RunSubmissionTab.svelte:297` — `<span class="empty-cell" aria-hidden="true">—</span><span class="vh">No data</span>`.
- `pages/runs/RunListPage.svelte:150` — `<th scope="col"><span class="vh">Actions</span></th>`.
- `RunProgressTab.svelte:427,430` and `RunSubmissionTab.svelte:268` — focusing a pinned sort button restores the grid's `scrollLeft` from before the focus (a scroll listener keeps the last value; `onfocus` puts it back).
- `RunOverviewTab.svelte:105-107` — a busy Publish's title is "Wait for the publish to finish"; `:298` the Version ✎ gets `aria-label="Edit the version"`.
- `DashboardSidePanel.svelte:852,867` — the feedback-file error `<p id="{uid}-file-err">` joins the attach button's `aria-describedby` while shown.

Shared: `frontend/src/styles/base.css` gains a global `.vh` (visually hidden: `position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap`), used by Tasks 5-8; local `.vh` copies stay.

- [ ] **Step 1:** Write one failing test per line above (role, name, describedby, focus target, banner order, scroll value).
- [ ] **Step 2:** Run them — Expected: FAIL.
- [ ] **Step 3:** Implement each line.
- [ ] **Step 4:** Re-run — PASS; full vitest, svelte-check, gate.
- [ ] **Step 5:** Commit: `fix(teaching): keyboard and screen-reader fixes from the beta checklists`.

### Task 6: Superuser panel — screen reader and focus

- `pages/superuser/SuperuserCourses.svelte:131-138` — after a delete, focus the page `<h1>` (PanelHead's `tabindex="-1"`); `:199-201` a blocked trash's `aria-label` is `` `Delete ${c.name}: ${runsReason(c.run_count)}` ``.
- `pages/superuser/SuperuserUsers.svelte:136-163` — after a confirmed strip, `await load(true)`, then focus the swapped button (Disable ↔ Enable) or, after a delete, the `<h1>`; `:271` `.u-count` gets `role="status"`; `:221-226` a chip with items gets `tabindex="0"`, no `title`, and a CSS tooltip (shown on `:hover` and `:focus-visible`) whose text is the visually-hidden list (one element serves both, so nothing is read twice).
- `components/superuser/NoteStrip.svelte:14` + callers (SuperuserCourses:149, SuperuserUsers:179, setup/StepCourse:144) — the callers keep an always-mounted `<div role="status">` that the info strip fills; NoteStrip keeps `role="alert"` for errors only.
- `components/superuser/EditEmailDialog.svelte:100-102`, `setup/StepEmail.svelte:173-175` — the result line sits in an always-mounted `role="status"` wrapper.
- `components/ui/InlineName.svelte:115-116` — the wait hint fills an always-mounted `role="status"` wrapper that has no size while empty.
- `NewAccountDialog.svelte`, `EditAccountDialog.svelte`, `NewCourseDialog.svelte`, `EditCourseDialog.svelte` — a 422 whose first error names a field puts `aria-invalid="true"` and `aria-describedby={errId}` on that field's input; otherwise the form keeps its describedby.
- `EditEmailDialog.svelte:95` — `` autofocusSelector={`[data-autofocus]:not(:disabled), #${uid}-on`} `` so email-off opens on the switch.
- `components/ui/Segmented.svelte:47` — new `labelledby?: string` prop (`aria-labelledby` when set, else `aria-label`); `fields/EmailFields.svelte:34` passes `{uid}-enc`; `fields/SignInFields.svelte:20` gives its caption `id="{uid}-longest-label"` and passes it.
- `EditColoursDialog.svelte:156` — `.ec-file` gets `aria-live="polite"`.

- [ ] **Step 1:** One failing test per line (tests: `SuperuserCourses`, `SuperuserUsers`, `NoteStrip`, `EditEmailDialog`, `SuperuserSetup`, `InlineName`, `Segmented`, `EditSignInDialog`, `EditColoursDialog`); Review Focus 4: the empty status wrapper renders no text and the InlineName row keeps its gap.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS; full gates.
- [ ] **Step 5:** Commit: `fix(superuser): focus, live regions and names from the beta checklist`.

### Task 7: Authoring and quiz editor

- `components/editor/AccordionHeader.svelte:204-222` — while renaming, render the `<h3|h4 id={headerId}>` with the input inside it, so the region's `aria-labelledby` still resolves.
- "+ Add …" glyph wrapped `<span aria-hidden="true">+</span>` at `VersionEditPage.svelte:697`, `BlockAccordion.svelte:423`, `SequenceAccordion.svelte:340`, `VersionsPage.svelte:473`, `quiz/QuizBody.svelte:364`, `quiz/ChoiceAnswers.svelte:380`, `quiz/QuestionCard.svelte:134`, `runs/RunAssetsTab.svelte:666`; the ~16 name assertions `'+ Add …'` become `'Add …'`.
- `VersionSettingsModal.svelte:111` — on a validation error focus the first invalid field (label, then attempts).
- `ItemRow.svelte:53` — a visually hidden `{ITEM_TYPE_NAME[item.type]}: ` before the title (`lib/dashboards.ts:208`).
- `AssetSidebar.svelte:371` — a referenced asset's trash `aria-label` is `` `${inUseReason}: ${a.filename}` ``.
- `item/PageBody.svelte:58,60` pass `ariaLabel="Content"`; `MarkdownEditor.svelte:295` puts `role="group" aria-label={ariaLabel}` on `.md-card` when plain or read-only.
- `lib/quizEdits.svelte.ts:100-104` — `say()` sets the text after a 150 ms timeout (cleared on a newer `say`), so VoiceOver speaks it after the focus move.
- `lib/quizFormat.ts:29-32` — `cutName` cuts by code points (`Array.from`).
- `quiz/ChoiceRow.svelte:48` — `title={textReason ?? undefined}`.

- [ ] **Step 1:** Failing tests (`accordionHeader`, `VersionSettingsModal`, `ItemRow`, `AssetSidebar`, `MarkdownEditor`, `quizEdits` with fake timers, `quizFormat.test.ts` with `'🙂'.repeat(30)`, `ChoiceAnswers`). **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; full gates.
- [ ] **Step 5:** Commit: `fix(authoring): screen-reader names, focus on errors, the late "Saved"`.

### Task 8: Student side

- `components/items/QuizItem.svelte:298-303` — the score line and attempt line get ids (`$props.id()`); Try again and Show correct answers get `aria-describedby` to both.
- `components/course/ItemIcon.svelte:10` — `aria-current={istate === 'current' ? 'step' : undefined}`.
- `lib/externalLinks.ts:33-35` — append `<span class="vh"> (opens in a new tab)</span>` to each new-tab link once (skip a link that already has one; Review Focus 5).

- [ ] **Step 1:** Failing tests (`QuizItem`, `ItemIcon`, `externalLinks`, including running it twice on the same node → one span). **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; full gates.
- [ ] **Step 5:** Commit: `fix(student): quiz result descriptions, current item, new-tab links`.

### Task 9: Browser checks and the two checklists

- [ ] **Step 1:** In agent-browser on a throwaway DB (seeded as in earlier passes; dev backend with `MATHION_ASSET_PATH`): Chrome forced-colours emulation on the student, authoring and teaching screens (incl. the strip, the picker, the focus panel, the Switch); reduced-motion emulation on every transition; the superuser pages (13d); the Evaluation control (8i); the Esc-in-select and pinned-sort-scroll fixes; the Filename column at 1000px; the `datetime-local` Esc; × while a confirm shows. Screenshots read, findings ledgered; a defect found is fixed in this task (TDD where jsdom can see it).
- [ ] **Step 2:** Rewrite `docs/backlog/beta-browser-pass.md`: only Safari / Windows High Contrast / real HTTP/1.1 proxy / iframe-keyboard checks, plus "re-check in Safari" lines for Task 4-5 fixes; history and done lines go.
- [ ] **Step 3:** Rewrite `docs/backlog/beta-voiceover-pass.md`: only what VoiceOver must confirm (the CHECK lines and a re-test line per Task 5-8 fix); kept choices stay as one line each with their reason.
- [ ] **Step 4:** Commit: `docs(backlog): the beta checklists hold only person-only checks`.

## Kept (not fixed, by earlier decision)

- Beta-browser B/P1 "Esc in a clean title edit while #19's question asks" — R53 (one question per place) puts focus on the question on purpose.
- VO: the heading link's purpose in `title` (spec choice); the progress phrase in panel names (kept, the sr-only form mis-announced); the MiniProjectModal publish group named by its warning (noted, no fix named).
