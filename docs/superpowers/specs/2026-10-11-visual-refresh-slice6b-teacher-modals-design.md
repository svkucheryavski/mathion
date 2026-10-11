# Visual refresh — Slice 6b: the four teacher modals, on the shared Modal

**Status:** draft, rev 1. Written 2026-10-11 for the user's review.

**Branch:** `feat/visual-refresh-slice6-teacher`, after the 6a Safari pass (`89fbcb2`). It stays local: no push, no merge.

**Authority:**
- The design handoff `docs/design/visual-refresh/` (`mathion-visual-spec.md`, `reference-screens.dc.html`) is the design authority. Its screens 10k, 10l, 10f, 10g and 10m are the 6b screens (`reference-screens.dc.html:285-479`, `:810-989`). Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/10{k,l,f,g,m}.png`.
- The user approved all five drawings "as drawn" in the 2026-10-10 walkthrough (`.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/walkthrough.md`), with one change: the mini-project assignment uses the 5b `MarkdownEditor`, not a plain box.
- The 6a spec (`docs/superpowers/specs/2026-10-10-visual-refresh-slice6a-teacher-restyle-design.md`, rev 5) still holds where this spec is silent: D5 (nothing that works today is dropped), D8 ("v. N"), R13 (block numbers by position), §Focus (focus never drops to `<body>`). So do the handoff's §1–§4 and the earlier slices' rules: tokens only, no emoji, no literal colours.
- The research behind this spec (every behaviour of the four modals today, with `file:line`) and the user's answers are in `.superpowers/sdd/2026-10-11-visual-refresh-slice6b-teacher-modals/decisions.md`.
- `file:line` references are to the code at `89fbcb2`.

## Why

The four teacher modals predate the shared `ui/Modal` (Slice 5b). Each rolls its own backdrop, Esc handler, focus trap and × button, with literal colours. They close on a backdrop click, unlike every authoring modal. Three of them have small focus or close bugs (§Fixes). 6b moves them onto `ui/Modal` and draws them as 10k, 10l, 10f/10g and 10m. 6c (Overview, Roster, side panel) follows.

## Decisions

The user's (2026-10-11), continuing the Slice-6 numbering:
- **D11 — A backdrop click never closes these modals.** × and Esc close them, as in every authoring modal (5b). Today all four close on a backdrop click.
- **D12 — The mini-project footer.**
  - Editing: "unsaved changes" (only while dirty) · Publish (only while unpublished) · Discard · **Save**. There is no Cancel; × and Esc close. Discard puts back the saved values.
  - Creating: Cancel · **Create**.
- **D13 — The mini-project publish preconditions show up front.** While the mini-project is unpublished and a precondition is unmet, the gold "Cannot publish yet" box lists them, and Publish is disabled with the title "Resolve the listed preconditions first". Today the list appears only after a Publish click.
- **D14 — No block pencil.** When editing, the Block row is read-only text. The backend cannot move a mini-project to another block (`MiniProjectUpdate` has no `block_id`, `backend/mathion/schemas.py:643-647`).
- **D15 — The import result's Detail column as drawn.**
  - Every failed row shows its reason.
  - An added row whose group changed says "re-bucketed from {old group}", or "re-bucketed from no group".
  - This is worked out in the browser from the roster read just before the import (§Import roster). No backend change.
- **D16 — Leaving with unsaved mini-project edits asks first.** Back, a reload, and a tab jump (including the precondition box's "Open Overview" link) ask while the mini-project modal has unsaved edits. Import paste and New run do not ask: a paste can be pasted again, and New run has three fields.
- **D17 — The import preview keeps its 10-row cap and says so:** "Showing the first 10 of N rows." The counts still cover every row.
- **D18 — The New run version line reads "will use {label} · v. N"** (the version id, as on the runs lists; D8), with no date.

Rulings taken at the controller's discretion (technical; the user defers these). Each states what it costs if wrong:
- **R16 — A shared `ui/Switch.svelte`** for "Groups enabled". It is a `<button role="switch" aria-checked>` drawn as the 30×17 track and knob of 10k, in tokens. Its visible label names it; its help line is its `aria-describedby`. 6c's Overview draws the same switch and reuses it. *Cost if wrong:* a checkbox again.
- **R17 — New run keeps its `<form>`; the footer's Create run submits it.** `ui/Button` gains a `form` prop, passed through to the `<button>`. The footer button is `type="submit" form={formId}`, so Enter in a field submits as today, and the tests that dispatch `submit` on the form keep working. *Cost if wrong:* one prop; the fallback is VersionSettingsModal's `onEnter` handler.
- **R18 — Field errors are tied to their fields.** Each errored input gets `aria-invalid="true"` and `aria-describedby` → its error. The server-error line gets `role="alert"`. This applies to New run and the mini-project editor. *Cost if wrong:* none for sighted users.
- **R19 — During a request the modal freezes, it does not grey out** (the 5b pattern).
  - Modal gets `closeDisabled` while a request runs, so × and Esc wait.
  - Inputs become `readonly`; `MarkdownEditor` gets `frozen`, not `disabled`. Focus does not blur.
  - The test "inputs disabled while submitting" changes on purpose.
  - *Cost if wrong:* a field greyed again.
- **R20 — The mini-project editor numbers blocks by position** (6a R13): the title "Edit — Block {n} — {title}" and the create-mode block picker "Block {n} — {title}" use `blockPositions(blocks)` (`lib/blockNumbers.ts:4`). `RunMiniProjectsTab` already receives `blocks`. This closes `docs/backlog/slice5c-constructor-polish-debt.md:158-162` for the mini-project editor. *Cost if wrong:* the stored order shows again.
- **R21 — Deadline zone labels read "GMT+2"**, without parentheses, mono `--muted` 10.5px after each label (10m draws "CEST" there). The value is `localTzLabel()` with its parentheses dropped. *Cost if wrong:* two characters.
- **R22 — Unsaved edits are not a precondition bullet.** The drawing shows "unsaved changes" in the footer and a gold box without a "save first" line.
  - So "Save your changes before publishing." leaves the box. While dirty, Publish is disabled with the title "Save your changes first", unless the box lists something; then its title is the D13 one.
  - Typing never makes the gold box appear.
  - *Cost if wrong:* one bullet back in the box.
- **R23 — Icons are drawn, not typed.**
  - The import preview's status is a 17px tile with an SVG check (accepted green) or an SVG × (needs-revision gold).
  - The tile's `title` and a visually-hidden text carry the row's reasons, which are visible text today.
  - No ✓ ✗ × glyphs remain in the four files, so the gate's emoji scan passes.
  - *Cost if wrong:* glyphs again.
- **R24 — The import result's Detail shows the server's text.** The drawn "Already active in another run of this course" is a placeholder. The server's "Already active in '{run}'" says more. *Cost if wrong:* a copy change.
- **R25 — Publish conflicts are labelled by their heading.** The dialog gets `labelledby` its `<h2>` instead of `aria-label="Cannot publish run"`; `RunDetailPage.publish.svelte.test.ts:330` changes on purpose. *Cost if wrong:* a label string.
- **R26 — The mini-project modal keeps its static id `mp-modal-title`.** There is one instance, and three test files use the id. *Cost if wrong:* none.
- **R27 — Copy keeps ASCII apostrophes** ("can't"), as the code does throughout. Drawn copy is taken as drawn otherwise, including "Organise". *Cost if wrong:* a character.
- **R28 — The staff e-mail links (`_staff_url`, `backend/mathion/notifications/templates.py:35`) stay for 6c**, as the 6a backlog says. *Cost if wrong:* none; the 6a redirects cover them.

## Scope

In:
- `components/runs/PublishConflictsModal.svelte`, `NewRunModal.svelte`, `RosterImportModal.svelte` and `MiniProjectModal.svelte`, on `ui/Modal` and drawn as 10l, 10k, 10f/10g and 10m.
- New `components/ui/Switch.svelte` (R16); a `form` prop on `ui/Button` (R17).
- In the parents, the small changes these need:
  - `RunDetailPage` (the conflicts modal's `open`);
  - `RunMiniProjectsTab` (it passes `blocks`, and the locked-edit guard, §Mini-project editor).
- Their tests, and the gate rows (§Gate).

Out:
- No backend change.
- 6c's Overview, Roster tab and side panel. The roster toolbar that opens the import stays as it is.
- `MarkdownEditor` and `AssetSidebar` are used as they are.
- The Polish slice's app-wide confirm style (6a backlog) is not started here.

## Common frame (all four)

- **`ui/Modal`** (`components/ui/Modal.svelte`) gives:
  - the frame: header, scrolling body and footer;
  - × at the right of the header (`aria-label="Close"`);
  - Esc to close;
  - scroll lock and the modal stack;
  - focus kept inside, and focus returned to the opener on close (through `FocusTrap`).
  - Each modal's own backdrop, Esc listener, `FocusTrap` and literal × go.
- **The title** is an `<h2>` with a `$props.id()` id, passed as `labelledby` (R26 keeps the mini-project's static id).
- **The footer** follows the 5b house layout: a muted note or marker at the left (`flex: 1`), then the secondary actions, then the primary `Button`, with `loading` while its request runs.
- **D11:** no `closeOnBackdrop`.
- **R19:** `closeDisabled` is true while a request runs.
- **Widths** as drawn: conflicts 560, New run 620, import 760, mini-project 820. `maxHeight` stays at Modal's 600 for the first two and is 720 for the other two (Modal clamps it to the window).
- **No literal colours, no emoji glyphs, tokens only.** Each modal's CSS is rewritten.

## Publish conflicts (10l, `PublishConflictsModal`)

- **Kept:** the props `open`, `conflicts`, `onClose`, and the parent's flow (`RunDetailPage.svelte:280-304`, `:501-505`). `<Modal>` mounts only while `open`, so the scroll lock is taken only then.
- **Title:** "1 student can't be added" / "N students can't be added", counting distinct students (`:17`, `:45-47`).
- **Body, grouped by run** (`run_id`, never by title, `:21-32`):
  - "They are already active in other runs:";
  - per run, its title at 13px/600, then its students' e-mails in mono 12px under a 2px `--border` left rule with a 12px indent;
  - then the drawn note, `--text-2`: "A student can only be active in one run of a course at a time. Remove them from the other run, or take them off this roster, then publish again."
- **Kept, restyled the same way:** the two shorter layouts.
  - One student: "{email} is already active in **{run}**." (or "… in:" with the runs listed).
  - One run: "They are already active in **{run}**:" with the list.
- **Footer:** the note "Nothing was published — the run is unchanged." · **Close** (secondary, `data-autofocus`). The label stays "Close": `RunDetailPage.publish` test 5 finds it by its text.
- **Focus:** on open, Close. On close, back to Publish (Modal's `FocusTrap`), which still exists after a 409.

## New run (10k, `NewRunModal`)

- **Kept:** the props `course`, `versions`, `onClose`, and the parent (`RunListPage.svelte:206-207`).
- **Body:**
  - **Title:** a stacked label "Title" (12.5px/500 `--text-3`) above a full-width 30px input, `name="title"`, `data-autofocus`.
  - **Start date / End date:** side by side in two equal columns; the inputs are mono, `name="start_date"`, `name="end_date"`.
  - **Groups enabled:** a `Switch` (R16) with the label "Groups enabled" and the muted help "Organise students into groups. Locked once the run is published — and mini-projects need it."
  - **The version strip:** `--surface-2`, radius 5px.
    - "Version" in `--muted`, then "will use {label}", then a mono `--muted` "· v. {id}" (D18).
    - The version is the newest published, enabled version, as today (`:23-30`).
    - With none, the strip reads today's "No published version — close this modal and publish one first." and Create run is disabled.
- **Validation on submit, as today** (`:32-42`): "Title is required", "Start date is required", "End date is required", "End date must be on or after start date".
  - Each error shows under its field in `--danger`, and the field gets a `--danger` border (R18).
- **Footer:** the note "The newest published version is pinned at creation and cannot be changed later." · Cancel (ghost) · **Create run** (primary, `type="submit"` for the form, R17; "Creating…" with `loading` while it runs).
- **Kept:**
  - the request (`createRun` without `version_id`);
  - success closes and opens `/teaching/{slug}/runs/{id}`;
  - the server error in a `role="alert"` line above the footer: `displayMessage`, or "Unable to create run.".
- **Fix:** Esc during "Creating…" did close the modal, and the success path still navigated (`:70-72`). Now `closeDisabled` holds it.

## Import roster (10f / 10g, `RosterImportModal`)

- **Kept:** the props (`:12-21`) and the parent (`RunDetailPage.svelte:444-451`).
- **Header, both stages:** "Import roster from CSV", then a two-step marker.
  - It is an `<ol>`, not focusable; the current step has `aria-current="step"`.
  - Paste stage: a filled `--primary` "1" circle with "Paste", a 14px rule, then a grey "2" with "Result".
  - Result stage: a green check circle for "Paste", a `--primary` rule, then a filled "2" with "Result".
  - The marker sits next to the title; × stays at the right edge.

**Paste stage (10f):**
- **Help, as drawn:** "Paste rows from Excel or Google Sheets, tab or comma separated. Columns: `name` optional, `email` required, `group` optional — a group that doesn't exist yet is created." (R27: ASCII apostrophe.)
- **The paste box:** a mono textarea, `data-autofocus`. It is parsed after a 200ms pause, as today (`:41-48`).
- **The preview card** (the 6a table style): # (mono) · Name · Email (mono) · Group · a status tile with no header text.
  - The tile is a check for a valid row (`title` "Valid"), or a × whose `title` is the row's reasons (R23).
  - Reasons are today's: "Missing email", "Invalid email format", "Duplicate in paste (will skip)".
  - An empty name or group shows "—".
  - The first 10 rows show. When there are more, a muted line follows: "Showing the first 10 of N rows." (D17).
- **The counts, as drawn:**
  - "{n} rows — **{v} valid**, {s} will skip ({i} invalid, {d} duplicate in paste)."
  - "Will create groups: {names}."
  - "Already enrolled, will be re-bucketed: {emails}." The list is still cut after 5 with "+N more" (`:50-53`).
  - A line is left out when its list is empty, as today.
- **Kept:** the parse error line ("Paste is empty.", "No email column found.").
- **Footer:**
  - the note "Invalid rows are skipped, never guessed at.";
  - Cancel (ghost, `data-action="cancel"`);
  - **Import {v} valid rows** (primary, `data-action="import"`): disabled at 0 valid, "Importing…" with `loading` while it runs.
- **The import, as today** (`:55-85`): snapshot, `onRefetchBeforeSubmit()`, the batch request, then the result stage. The error line ("Import failed — please retry." or the server's message) keeps `role="alert"`.

**Result stage (10g):**
- **The result card:** # (mono) · Email (mono) · Result · Detail (muted, one line with an ellipsis and the full text as `title`).
  - Result is a chip: "added" uses the accepted status tokens; "error" uses the rejected status tokens and keeps `data-result="error"`.
  - Detail (D15, R24):
    - a failed row shows the server's `detail` (every error code, not only `student_already_active_in_course` as today);
    - an added row whose group changed shows "re-bucketed from {old group}" or "re-bucketed from no group";
    - otherwise it is empty.
  - The old group comes from the roster `onRefetchBeforeSubmit()` returned: that student's `group_id` before, against the result row's `group_id`, named through that refetch's groups.
- **The summary:** "**{a} added**, {f} failed."
- **Footer:**
  - when something failed: the note "Failed rows can be copied as text and fixed in your sheet." and **Copy failed rows** (secondary, `data-action="copy-failed"`);
  - always: **Done** (primary, `data-action="done"`).
  - Kept: the copy fallback (a read-only `textarea.copy-fallback` when the clipboard refuses, `:87-103`).

**Closing:**
- × and Esc follow today's stage rule (`closeForCurrentStage`, `:110-114`): nothing while importing; close at once in the paste stage (D16: no prompt); run the Done flow in the result stage.

**Fixes:**
- **Focus on the stage switch.** The focused Import button unmounts. After `tick()`, focus goes to Done (§Focus).
- **Done runs once.** A `closing` flag ignores a second Done, ×, or Esc while the refetch runs, and `closeDisabled` covers it. The modal closes in `finally`; if the refetch fails, a toast says "Roster refresh failed — reload to see the latest." Today a rejection leaves the modal open and stuck.

## Mini-project editor (10m, `MiniProjectModal`)

- **Kept:**
  - the props (`:12-38`), plus `blocks` for R20;
  - the parent (`RunMiniProjectsTab.svelte:327-344`);
  - the requests: POST on create, PATCH without `block_id` on edit, the publish POST.
- **Title** (R26, R20): "New mini-project", or "Edit — Block {n} — {block title}".
- **The Block row:**
  - Editing (D14): a 150px / 1fr grid with "Block" (`--muted`) and "Block {n} — {title}". No control.
  - Creating: the label "Block" and today's picker, with options "Block {n} — {title}". Today's "No available blocks…" reason stays.
- **Assignment:**
  - the label "Assignment" (12.5px/500 `--text-3`);
  - `MarkdownEditor` as today: run-asset context, Edit/Preview, the asset panel;
  - new props: `ariaLabel="Assignment"`, `frozen` during a request (R19), and `bind:uploading`. While an upload runs, Save, Create and Publish wait.
- **Deadlines:** three equal columns, "Soft deadline", "Hard deadline", "Resubmission", each followed by its zone in mono `--muted` 10.5px (R21). The inputs are mono `datetime-local`, as today.
- **The precondition box** (D13, R22). It shows while editing an unpublished mini-project with at least one unmet precondition.
  - Gold: `--status-needs-revision-bg`, a 3px `--gold` left rule, text `--status-needs-revision-fg`.
  - The heading "Cannot publish yet", then today's bullets (`:180-245`), each opening with "·". "Save your changes before publishing." is not among them (R22).
  - The "Open Overview" link and its admin gating, as today (`:450-466`).
  - It keeps `data-testid="publish-preconditions"` and the bullet ids the inputs' `aria-describedby` point at.
- **Footer, editing** (D12):
  - "unsaved changes" at the left, mono `--status-needs-revision-fg`, only while dirty (as the 5b item editor);
  - **Publish** (secondary, `data-action="publish"`), only while unpublished. It is disabled with a title (D13, R22) when the box shows or the form is dirty;
  - **Discard** (ghost): disabled while clean; resets to the saved snapshot;
  - **Save** (primary, `data-action="save"`, "Saving…" with `loading`).
- **Footer, creating:** Cancel (ghost) · **Create** (primary, `data-action="save"`, "Creating…" with `loading`).
- **Kept confirms** (both `InlineConfirm` in the footer, now with `takeFocus`):
  - Publish → "Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions)." with `data-action="confirm-publish"`. Confirming rechecks before the request (`:277-309`).
  - Closing with unsaved edits (×, Esc, or Cancel) → "Discard unsaved changes?" with `data-action="confirm-discard"`.
  - Esc on an open confirm cancels the confirm; it does not close the modal.
  - Cancel on a confirm returns focus to the control that opened it, or to × when that was Esc.
- **Kept:**
  - every validation reason (`:125-141`), now shown as the disabled Save's `title`;
  - every save/publish error and its copy: 404 (with its keep-your-work text), 409 ("Refresh the page to see latest."), 422 field errors (`#err-{field}`, `role="alert"`), and the generic messages;
  - the abort of an upload on close.
- **D16:** a `DirtyGuard` (`components/editor/DirtyGuard.svelte`) with `isDirty={() => dirty && !submitting}`. Back, a reload and a tab jump ask "Discard unsaved changes and continue?" while dirty.
- **Locked-edit guard** (`RunMiniProjectsTab`): the Assets "used by → Edit" path (`pendingEditTarget`, `:113-121`) opens nothing for a locked mini-project or a disabled version. It toasts that row's edit reason instead, as the disabled ✎ shows it (6a backlog, `slice6a-teacher-restyle-debt.md:106`).
- **Fix:** a second Esc while "Discard unsaved changes?" shows no longer discards without asking (`pendingClose` short-circuit, `:108-123`).

## Focus

6a §Focus holds: focus never drops to `<body>`. In 6b:
- **Open:** each modal focuses its `data-autofocus` element:
  - Publish conflicts: Close;
  - New run: Title;
  - import: the paste box;
  - mini-project: the assignment field, or × when the editor is frozen.
- **Close:** focus returns to the opener (`FocusTrap`).
  - A mini-project opened from Assets' "used by → Edit" was opened after a switch to the Mini-projects tab, so its opener (the Edit link on Assets) is gone. On close, focus goes to that mini-project's ✎ in its row, or else to the tab's `<h2>`.
- **Import stage switch:** focus goes to Done.
- **The mini-project's confirms:** as §Mini-project editor says.

## Code changes

- **Changed:**
  - `components/runs/{PublishConflictsModal,NewRunModal,RosterImportModal,MiniProjectModal}.svelte`;
  - `components/runs/RunMiniProjectsTab.svelte` (passes `blocks`, the locked-edit guard);
  - `pages/runs/RunDetailPage.svelte` (only if the conflicts modal's mounting changes);
  - `components/ui/Button.svelte` (`form`).
- **New:** `components/ui/Switch.svelte`.
- **Tests:** the nine modal test files, plus `RunDetailPage.publish`, `RunMiniProjectsTab`, `RunDetailPage.tabs`, and new `Switch` and `Button` tests.
- **The gate:** §Gate.

## Process

As in 6a (the per-task loop):
1. TDD per step.
2. vitest (exit 0, no "Errors" / "Unhandled" line).
3. svelte-check with 0 errors.
4. The gate.
5. Screenshots of the real modals at 1280 and 1000 in an overlay → the user's OK.
6. Opus + Fable review lanes on the uncommitted diff until clean.
7. Commit with exact paths.
8. Wait for the user's "go".

Rules for the work:
- Screenshots use the dev data (run 8) plus network mocks. No writes to shared data unless the user agrees: the Create, Import, Save and Publish requests are mocked.
- The final whole-branch review and a Safari pass (one step at a time) close 6b.

Suggested order: Publish conflicts (smallest; sets up the gate list) → New run with `Switch` and `Button form` → Import roster → the mini-project frame, footer, freeze and guards → the up-front precondition box.

## Testing

Existing tests keep their hooks unless a line here changes them on purpose.

- **Every modal:**
  - it renders inside `ui/Modal` (`[role="dialog"]` named by its `<h2>`);
  - a backdrop click does not close it (D11);
  - × and Esc close it, except during a request (R19);
  - focus on open as in §Focus;
  - no literal colours (the gate).
- **Publish conflicts:**
  - the three layouts and their counts;
  - grouping by `run_id`;
  - the note and the footer note;
  - Close is focused and closes;
  - `PublishConflictsModal.svelte.test.ts:43` changes from `.modal` to the dialog;
  - `RunDetailPage.publish.svelte.test.ts:330` finds the dialog by its heading (R25).
- **New run:**
  - the four validation messages, each tied to its field (`aria-invalid`, `aria-describedby`);
  - the Switch toggles `groups_enabled` in the request;
  - Enter in Title submits (R17);
  - the version strip "will use {label} · v. {id}". `NewRunModal.svelte.test.ts:116-126` changes from "v2 (2026-02-01)" (D18);
  - with no published version, the strip text shows and Create run is disabled;
  - Esc while creating does nothing, and success still navigates once.
- **Switch:**
  - `role="switch"` and `aria-checked` follow the value;
  - click and Space toggle it;
  - disabled does nothing;
  - the label and help are wired.
- **Button:** `form` reaches the `<button>`.
- **Import roster:**
  - the step marker in both stages (`aria-current`);
  - the drawn help and counts;
  - "Showing the first 10 of N rows." only above 10 rows (D17);
  - the × tile carries the reasons as `title` and as hidden text;
  - the Detail column for every error code, and "re-bucketed from …" for an added row that changed group, from no group, and not for an unchanged one (D15). `RosterImportModal.already-active` tests 1-2 change on purpose;
  - focus lands on Done after the switch;
  - Done, then Done again or Esc, runs one refetch, and a failed refetch still closes with the toast;
  - the backdrop tests (`RosterImportModal.submit.svelte.test.ts:283-310`) now assert it stays open (D11).
- **Mini-project editor:**
  - the title and picker use position numbers (R20);
  - editing shows the Block row as text, with no control (D14);
  - creating shows Cancel · Create; editing shows Publish · Discard · Save and "unsaved changes" only while dirty (D12);
  - Discard resets the fields;
  - the precondition box shows up front while unmet, without a Publish click, and not on a published or new mini-project (D13);
  - Publish's two disabled titles (R22);
  - typing alone never shows the box;
  - the publish confirm and the discard confirm take focus, Esc cancels them, and a second Esc does not discard;
  - the request freezes the fields (`readonly`, `frozen`) rather than disabling them. The "inputs disabled while submitting" test changes on purpose;
  - Save waits for an upload;
  - `DirtyGuard` asks on a tab jump while dirty;
  - zone labels without parentheses;
  - the structure tests that used `[data-role=backdrop]`, `.modal > header`, `.modal > footer`, `.backdrop` and `button[data-action=close-x]` (`MiniProjectModal.create-edit.svelte.test.ts:294`, `:573-577`, and four `close-x` uses) move to Modal's markup and its × `aria-label="Close"`.
- **RunMiniProjectsTab:** the "used by → Edit" path opens nothing for a locked mini-project and toasts its reason.

## Gate

- **A `FILES_6B` list:** the four modals and `ui/Switch.svelte`. It runs the `emoji_scan` and `colour_scan` of 5b's (ag) over them, in the style of 6a's (aj) (`frontend/scripts/visual-refresh-gate.sh:4526-4545`).
  - The (ag) comment and the 5b backlog line (`docs/backlog/slice5b-authoring-polish-debt.md:258`) that kept MiniProjectModal out "until Slice 6" are updated in step.
- **Modal owns `.modal-backdrop` again:** `own modal-backdrop Modal.svelte`, which (aa) could not assert while three run modals authored that class (`:4074`).
- **New classes** each get `own` / `uniq1` and their `d` / `chk` rows, plus the `sweep` (no hex, no opacity dim).
- **Key declarations pinned:** the four widths, the switch track and knob, the step marker, the status tiles, the gold box (background, the 3px gold rule, text colour), and the "unsaved changes" marker.
- `EXPECTED_CHECKS` moves with each task; the plan lists the ladder.

## Carried to the 6b browser pass

- Each modal at a laptop width and at about 1000px; the mini-project editor's asset panel beside the field at 820px.
- The import with a real paste from a sheet (tabs), and the copy-failed path, on mocked requests.
- The mini-project editor: typing, Discard, the up-front box, "Open Overview" with unsaved edits (D16), Esc on a confirm.
- The interim mixed look (6c's Overview, Roster and side panel are still old) is expected, not a finding.
