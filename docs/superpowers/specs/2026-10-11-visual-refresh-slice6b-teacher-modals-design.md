# Visual refresh — Slice 6b: the four teacher modals, on the shared Modal

**Status:** draft, rev 2. Written 2026-10-11 for the user's review.
- Rev 2 folds in round 1 of the spec review (fresh Opus on the code, fresh Opus on the design, Fable second opinion) and the user's answers D19–D22. Review notes: `.superpowers/sdd/2026-10-11-visual-refresh-slice6b-teacher-modals/spec-r1-*.md`.

**Branch:** `feat/visual-refresh-slice6-teacher`, after the 6a Safari pass (`89fbcb2`). It stays local: no push, no merge.

**Authority:**
- The design handoff `docs/design/visual-refresh/` (`mathion-visual-spec.md`, `reference-screens.dc.html`) is the design authority. Its screens 10k, 10l, 10f, 10g and 10m are the 6b screens (`reference-screens.dc.html:285-479`, `:810-989`). Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/10{k,l,f,g,m}.png`.
- The user approved all five drawings "as drawn" in the 2026-10-10 walkthrough (`.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/walkthrough.md`), with one change: the mini-project assignment uses the 5b `MarkdownEditor`, not a plain box.
- The 6a spec (`docs/superpowers/specs/2026-10-10-visual-refresh-slice6a-teacher-restyle-design.md`, rev 5) still holds where this spec is silent: D5 (nothing that works today is dropped), D8 ("v. N"), R13 (block numbers by position), §Focus (focus never drops to `<body>`), P10 (a tab jump focuses the new tab). So do the handoff's §1–§4 and the earlier slices' rules: tokens only, no emoji, no literal colours, every disabled control names its reason in `title`.
- The research behind this spec and the user's answers are in `.superpowers/sdd/2026-10-11-visual-refresh-slice6b-teacher-modals/decisions.md`.
- `file:line` references are to the code at `89fbcb2`.

## Why

The four teacher modals predate the shared `ui/Modal` (Slice 5b). Each rolls its own backdrop, Esc handler, focus trap and × button, with literal colours. They close on a backdrop click, unlike every authoring modal. Several have focus or close bugs (§Fixes in each section). 6b moves them onto `ui/Modal` and draws them as 10k, 10l, 10f/10g and 10m. 6c (Overview, Roster, side panel) follows.

## Decisions

The user's (2026-10-11), continuing the Slice-6 numbering:
- **D11 — A backdrop click never closes these modals.** × and Esc close them, as in every authoring modal (5b). Today all four close on a backdrop click.
- **D12 — The mini-project footer.**
  - Editing: "unsaved changes" (only while dirty) · Publish (only while unpublished) · Discard · **Save**. There is no Cancel; × and Esc close. Discard puts back the saved values.
  - Creating: Cancel · **Create**.
- **D13 — The mini-project publish preconditions show up front.** While editing an unpublished mini-project with a precondition unmet, the gold "Cannot publish yet" box lists them, and Publish is disabled with the title "Resolve the listed preconditions first". Today the list appears only after a Publish click.
- **D14 — No block pencil.** When editing, the Block row is read-only text. The backend cannot move a mini-project to another block (`MiniProjectUpdate` has no `block_id`, `backend/mathion/schemas.py:641-645`).
- **D15 — The import result's Detail column as drawn.** Every failed row shows its reason. An added row whose student was already on the roster in another group says "re-bucketed from {old group}", or "re-bucketed from no group". It is worked out in the browser (§Import roster). No backend change.
- **D16 — Leaving with unsaved mini-project edits asks first.** Back, a reload, and a tab jump (including the box's "Open Overview" link) ask while the mini-project modal has unsaved edits. Import paste and New run do not ask.
- **D17 — The import preview keeps its 10-row cap and says so:** "Showing the first 10 of N rows."
- **D18 — The New run version line reads "will use {label} · v. N"** (the version id, as on the runs lists; D8), with no date.
- **D19 — Save keeps the mini-project editor open when editing.** It shows a "Saved" toast, refreshes the list, and takes the saved values as the new starting point, so Publish becomes available. Create still closes the modal. Today Save closes it.
- **D20 — The import preview shows why a row will skip.** The drawn × tile stays, and the row's reasons show as muted text under its e-mail. Today they are visible text; the drawing would make them a tooltip.
- **D21 — The precondition box follows what is on screen.** Fixing a deadline removes its line as you type; clearing the assignment adds one. The dirty flag alone never shows the box (R22).
- **D22 — Skipped rows past the first 10 are named:** "Showing the first 10 of 34 rows. Rows 14, 27 will skip." Up to 5 numbers, then "+N more".

Rulings taken at the controller's discretion (technical; the user defers these). Each states what it costs if wrong:
- **R16 — A shared `ui/Switch.svelte`** for "Groups enabled"; 6c's Overview reuses it.
  - It is a `<button type="button" role="switch" aria-checked>`. `type="button"` keeps it from submitting New run's form or becoming its default button.
  - The look: the 30×17 track and 13px knob of 10k.
    - Off: a `--border-strong` track, knob at the left.
    - On: a `--primary` track, knob at the right.
    - Focus-visible: the house focus ring.
    - Disabled: a `--border-faint` track, with the reason as `title`.
    - Frozen (R19): `aria-disabled="true"`, and clicks are ignored.
  - Its `<label for>` is the visible text "Groups enabled", so a click on the text toggles it. The help line is its `aria-describedby`.
  - The off-state contrast is checked in the browser pass.
  - *Cost if wrong:* a checkbox again.
- **R17 — `ui/Button` gains two pass-through props, `form` and `data-autofocus`.**
  - New run keeps its `<form>`. Its footer Create run is `type="submit" form={formId}`, so Enter in a field submits (implicit submission), and the tests that dispatch `submit` keep working.
  - jsdom does not run implicit submission. Tests check the `form` link through a click; the browser pass checks Enter.
  - *Cost if wrong:* two props.
- **R18 — Field errors are tied to their fields.**
  - Each errored input gets `aria-invalid="true"` and `aria-describedby` → its error. Server-error lines get `role="alert"`.
  - The Assignment field is the exception: `MarkdownEditor` is used as is and has no `aria-invalid` hook. It keeps `ariaDescribedby` → its error.
  - *Cost if wrong:* none for sighted users.
- **R19 — During a request the modal freezes; it does not grey out** (the 5b pattern).
  - Modal gets `closeDisabled`, so × and Esc wait.
  - Text inputs become `readonly`; `MarkdownEditor` gets `frozen`; the Switch ignores clicks.
  - The create-mode block `<select>` keeps `disabled`, because `readonly` does not apply to a select and focus is on the primary button.
  - *Cost if wrong:* fields greyed again.
- **R20 — The busy button keeps focus.**
  - The button whose request runs keeps `loading` ("Creating…", "Importing…", "Saving…", "Publishing…") but is not `disabled`; its handler ignores a second click.
  - The other footer buttons (Cancel, Discard, Publish, Done, Copy failed rows) ignore clicks while a request runs.
  - So focus never falls off a button the browser has just disabled. Today New run's Cancel even closes mid-create.
  - Buttons that are unusable for a reason (validation, no valid rows, an upload running) stay `disabled` with a `title` naming the reason.
  - *Cost if wrong:* a focus drop after a failed request.
- **R21 — The mini-project editor numbers blocks by position** (6a R13).
  - The title "Edit — Block {n} — {title}" and the create-mode picker's "Block {n} — {title}" use `blockPositions(blocks)` (`lib/blockNumbers.ts:4`). `RunMiniProjectsTab` already receives `blocks`.
  - A block missing from `blocks` drops the "Block {n} — " prefix, as R13 does. Today the title reads "Block ?".
  - This closes `docs/backlog/slice5c-constructor-polish-debt.md:158-162` for the mini-project editor.
  - *Cost if wrong:* the stored order shows again.
- **R22 — Unsaved edits are not a precondition bullet.**
  - "Save your changes before publishing." leaves the box: the drawing shows "unsaved changes" in the footer and a box without a "save first" line.
  - While dirty, Publish is disabled with the title "Save your changes first", unless the box shows; then its title is D13's.
  - The publish confirm's recheck still refuses while dirty (§Mini-project editor), and the body is inert while the confirm is open, so an edit can never slip in between.
  - *Cost if wrong:* one bullet back in the box.
- **R23 — Zone labels read "GMT+2"**, without parentheses: `localTzLabel()` with its parentheses dropped, in mono `--muted` 10.5px after each deadline label. (10m draws "CEST" there.) *Cost if wrong:* two characters.
- **R24 — Icons are drawn, not typed.**
  - The import preview's status tile is 18×18, radius 4, with an 11px SVG: a check on the accepted-status tokens, or a × on the needs-revision tokens. Its `title` is "Valid" or the row's reasons.
  - No ✓ ✗ × glyphs remain in the four files, so the gate's emoji scan passes.
  - *Cost if wrong:* glyphs again.
- **R25 — The import result's Detail shows the server's text.**
  - The drawn "Already active in another run of this course" is a placeholder; the server's "Already active in '{run}'" says more.
  - A failed row with no detail reads "Not added". The server's bare "internal error" reads "Server error — try again".
  - *Cost if wrong:* copy changes.
- **R26 — Publish conflicts are labelled by their heading.** The dialog gets `labelledby` its `<h2>` instead of `aria-label="Cannot publish run"`. *Cost if wrong:* a label string.
- **R27 — The mini-project modal keeps its static id `mp-modal-title`.** There is one instance, and two test files use the id. *Cost if wrong:* none.
- **R28 — Copy.**
  - ASCII apostrophes ("can't"), as the code does throughout.
  - The drawn copy is taken as drawn, including "Organise" and "Publish" without an ellipsis.
  - Counts take their singular at 1: "1 row", "Import 1 valid row" (6a rule).
  - *Cost if wrong:* characters.
- **R29 — The staff e-mail links (`_staff_url`, `backend/mathion/notifications/templates.py:35`) stay for 6c**, as the 6a backlog says. *Cost if wrong:* none; the 6a redirects cover them.

## Scope

In:
- `components/runs/PublishConflictsModal.svelte`, `NewRunModal.svelte`, `RosterImportModal.svelte` and `MiniProjectModal.svelte`, on `ui/Modal` and drawn as 10l, 10k, 10f/10g and 10m.
- New `components/ui/Switch.svelte` (R16).
- `ui/Button`'s `form` and `data-autofocus` props (R17).
- `RunMiniProjectsTab`: it passes `blocks`; the locked-edit guard; focus after a create.
- Their tests, and the gate rows (§Gate).

Out:
- No backend change.
- 6c's Overview, Roster tab and side panel. The roster toolbar that opens the import stays as it is.
- `MarkdownEditor` and `AssetSidebar` are used as they are.
- The Polish slice's app-wide confirm style (6a backlog). Note for it: the mini-project editor asks "Discard unsaved changes?" in place when closed, while Back and tab jumps use the browser's prompt (`DirtyGuard`, as in 5b). The Polish slice settles both together.

## Common frame (all four)

- **`ui/Modal`** (`components/ui/Modal.svelte`) gives:
  - the frame: header, scrolling body and footer;
  - × at the right of the header (`aria-label="Close"`);
  - Esc to close;
  - scroll lock and the modal stack;
  - focus kept inside, and focus returned to the opener on close (through `FocusTrap`).
  - Each modal's own backdrop, Esc listener, `FocusTrap` and literal × go.
- **The title** is an `<h2>` with a `$props.id()` id, passed as `labelledby` (R27 keeps the mini-project's static id).
- **The footer** follows the 5b house layout: a muted note or marker at the left (`flex: 1`), then the secondary actions, then the primary `Button`.
- **D11:** no `closeOnBackdrop`.
- **R19:** `closeDisabled` is true while a request runs.
- **Widths** as drawn: conflicts 560, New run 620, import 760, mini-project 820. `maxHeight` stays at Modal's 600 for the first two and is 720 for the other two (Modal clamps it to the window).
- **Long values** (names, e-mails, groups, block titles) take one line with an ellipsis and the full text as `title`.
- **Server-error lines** use the 6a error banner (`role="alert"`).
- **No literal colours, no emoji glyphs, tokens only.** Each modal's CSS is rewritten.

## Publish conflicts (10l, `PublishConflictsModal`)

- **Kept:** the props `open`, `conflicts`, `onClose`, and the parent's flow (`RunDetailPage.svelte:280-304`, `:501-505`). `<Modal>` mounts only while `open` (`:61`), so the scroll lock is taken only then.
- **Title:** "1 student can't be added" / "N students can't be added", counting distinct students (`:17`, `:45-47`).
- **Body, grouped by run** (`run_id`, never by title, `:21-32`):
  - the lead "They are already active in other runs:" in `--text-2` 13px;
  - per run, its title in `<strong>` 13px/600, then its students' e-mails as a `<ul>` in mono 12px `--text-3`, under a 2px `--border` left rule with a 12px indent;
  - then the drawn note in `--muted` 12.5px: "A student can only be active in one run of a course at a time. Remove them from the other run, or take them off this roster, then publish again."
- **Kept, restyled the same way:** the two shorter layouts.
  - One student: "{email} is already active in **{run}**." (or "… in:" with the runs listed).
  - One run: "They are already active in **{run}**:" with the list.
  - The note shows in all three layouts.
- **Footer:** the note "Nothing was published — the run is unchanged." · **Close** (secondary, `data-action="close"`, `data-autofocus`, R17). The label stays "Close".
- **Focus:** on open, Close. On close, back to Publish, which still exists after a 409.

## New run (10k, `NewRunModal`)

- **Kept:** the props `course`, `versions`, `onClose`, and the parent (`RunListPage.svelte:206-207`).
- **Body:**
  - **The server error** (when a create fails) sits at the top of the body, as today above the form, as a `role="alert"` banner: `displayMessage`, or "Unable to create run.".
  - **Title:** a stacked label "Title" (12.5px/500 `--text-3`) above a full-width 30px input, `name="title"`, `data-autofocus`.
  - **Start date / End date:** side by side in two equal columns; the inputs are mono, `name="start_date"`, `name="end_date"`.
  - **Groups enabled:** a `Switch` (R16) labelled "Groups enabled", with the muted help "Organise students into groups. Locked once the run is published — and mini-projects need it."
  - **The version strip** (`--surface-2`, radius 5px):
    - "Version" in `--muted`, then "will use {label} · " and a mono `--muted` "v. {id}" (D18). The dot sits outside the mono span. An empty label leaves "will use v. {id}". This matches `RunListPage.svelte:156`.
    - The version is the newest published, enabled version, as today (`:23-30`).
    - With none, the strip reads today's "No published version — close this modal and publish one first." and Create run is disabled with that sentence as its `title`.
- **Validation on submit, as today** (`:32-42`): "Title is required", "Start date is required", "End date is required", "End date must be on or after start date".
  - Each error shows under its field in `--danger`, and the field gets a `--danger` border (R18).
  - A failed submit focuses the first invalid field. A field's error clears when it is edited.
- **Footer:**
  - the note "The newest published version is pinned at creation and cannot be changed later.";
  - Cancel (ghost; ignores clicks while creating, R20);
  - **Create run** (primary, `type="submit"` for the form, R17; "Creating…" with `loading`).
- **Kept:**
  - the request (`createRun` without `version_id`);
  - on success, close and open `/teaching/{slug}/runs/{id}`.
- **Fix:** Esc or Cancel during "Creating…" closed the modal, and the success path still navigated (`:70-72`, `:119`). Now `closeDisabled` and R20 hold it.

## Import roster (10f / 10g, `RosterImportModal`)

- **Kept:** the props (`:12-21`) and the parent (`RunDetailPage.svelte:444-451`).
- **Header, both stages:** "Import roster from CSV", then a two-step marker.
  - It is an `<ol>`, not focusable. The current step has `aria-current="step"`; the completed one carries visually-hidden "(done)".
  - Paste stage: a filled `--primary` 17px "1" circle with "Paste" (12px/500 `--text`), a 14px `--border-strong` rule, then "2" on `--border-soft` in `--muted` with "Result" (12px `--muted`).
  - Result stage: a check circle on the accepted-status tokens for "Paste", a `--primary` rule, then a filled "2" with "Result".
  - The marker sits next to the title; × stays at the right edge.

**Paste stage (10f):**
- **Help, as drawn:** "Paste rows from Excel or Google Sheets, tab or comma separated. Columns: `name` optional, `email` required, `group` optional — a group that doesn't exist yet is created." The column names are mono 12px `--text-3`, with no background.
- **The paste box:**
  - a mono textarea, `aria-label="Rows to import"`, `aria-describedby` → the help, `data-autofocus`;
  - `readonly` while importing;
  - parsed after a 200ms pause, as today (`:41-48`).
- **The preview card** (the 6a table style): # (mono) · Name · Email (mono) · Group · a status tile (R24) with no header text.
  - A row that will skip shows its reasons as muted 11.5px text under its e-mail (D20). The reasons are today's: "Missing email", "Invalid email format", "Duplicate in paste (will skip)".
  - An empty name, e-mail or group shows a `--muted` "—".
  - The first 10 rows show. Above 10, a muted line follows: "Showing the first 10 of N rows." (D17). When rows past the 10th will skip, it adds "Rows 14, 27 will skip." (D22): up to 5 numbers, then "+N more".
- **The counts, as drawn:** muted 12.5px, the key figures and names in `--text` (not bold).
  - "{n} rows — {v} valid, {s} will skip ({i} invalid, {d} duplicate in paste)."
  - "Will create groups: {names}."
  - "Already enrolled, will be re-bucketed: {emails}." The list is still cut after 5 with "+N more" (`:50-53`).
  - A line is left out when its list is empty, as today.
- **Kept:** the parse error line ("Paste is empty.", "No email column found.").
- **Footer:**
  - the note "Invalid rows are skipped, never guessed at.";
  - Cancel (ghost, `data-action="cancel"`);
  - **Import {v} valid rows** (primary, `data-action="import"`, "Importing…" with `loading`). At 0 valid it is disabled, titled "No valid rows to import".
- **The import, as today** (`:55-85`): snapshot, `onRefetchBeforeSubmit()`, the batch request, then the result stage. The error line ("Import failed — please retry." or the server's message) keeps `role="alert"`; focus stays on Import (R20).

**Result stage (10g):**
- **The result card:** # (mono) · Email (mono) · Result · Detail (muted, one line with an ellipsis and the full text as `title`).
  - Result is a radius-3 chip as drawn: "added" on the accepted-status tokens; "error" on the rejected-status tokens, keeping `data-result="error"`.
  - Detail (D15, R25):
    - a failed row shows the server's `detail`, for every error code (today only `student_already_active_in_course` shows it);
    - an added row shows "re-bucketed from {old group}" or "re-bucketed from no group" only when its e-mail was on the roster `onRefetchBeforeSubmit()` returned and its `group_id` there differs from the result's `group_id`;
    - e-mails are matched lower-cased, as `buildBatchRow` does (`lib/buildBatchRow.ts:27-29`). A new student never reads "re-bucketed". A paste row with an empty group keeps the current group, so it never does either.
    - Otherwise Detail is empty.
- **The summary:** "{a} added, {f} failed.", with `{a} added` in `--text`. Done's `aria-describedby` points at it, so a screen reader hears the outcome when focus lands on Done.
- **Footer:**
  - when something failed: the note "Failed rows can be copied as text and fixed in your sheet." and **Copy failed rows** (secondary, `data-action="copy-failed"`). A successful copy toasts "Copied N rows".
  - always: **Done** (primary, `data-action="done"`).
  - Kept: the copy fallback (`textarea.copy-fallback`, `:87-103`). It appears at the end of the body, takes focus and selects its text.

**Closing:**
- × and Esc follow today's stage rule (`closeForCurrentStage`, `:110-114`): nothing while importing; close at once in the paste stage (D16: no prompt); run the Done flow in the result stage.

**Fixes:**
- **Focus on the stage switch.** The focused Import button unmounts. After `tick()`, focus goes to Done.
- **Done runs once.** A `closing` flag ignores a second Done, ×, or Esc while the refetch runs, and `closeDisabled` covers it. The modal closes in `finally`; if the refetch fails, a toast says "Roster refresh failed — reload to see the latest." Today a rejection leaves the modal open and stuck.

## Mini-project editor (10m, `MiniProjectModal`)

- **Kept:**
  - the props (`:12-38`), plus `blocks` for R21;
  - the parent (`RunMiniProjectsTab.svelte:327-344`);
  - the requests: POST on create, PATCH without `block_id` on edit, the publish POST.
- **Title** (R27, R21): "New mini-project", or "Edit — Block {n} — {block title}", one line with an ellipsis.
- **The Block row** (a 150px / 1fr grid; "Block" in `--muted`):
  - Editing (D14): "Block {n} — {title}" as text, with no control.
  - Creating: today's picker at `--control-h`, options "Block {n} — {title}". Today's "No available blocks…" reason stays.
- **Assignment:**
  - the label "Assignment" (12.5px/500 `--text-3`);
  - `MarkdownEditor` as today: run-asset context, Edit/Preview, the asset panel;
  - new props, which it already has (`MarkdownEditor.svelte:17-24`): `ariaLabel="Assignment"`, `frozen` during a request (R19), and `bind:uploading`.
  - While an upload runs, Save, Create and Publish are disabled with "Wait for the upload to finish".
- **Deadlines:** three equal columns, "Soft deadline", "Hard deadline", "Resubmission", each followed by its zone (R23). The inputs are mono `datetime-local`, as today.

**The precondition box** (D13, D21, R22):
- **When it shows:** while editing an unpublished mini-project with at least one unmet precondition. Never when creating, and never on a published mini-project.
- **What it reads:** the bullets are today's (`:180-245`), computed from the values on screen (D21), each opening with "·". "Save your changes before publishing." is no longer among them (R22).
- **The look:** gold. `--status-needs-revision-bg`, a 3px `--gold` left rule, text in `--status-needs-revision-fg`, the heading "Cannot publish yet" at 600.
- **The "Open Overview" link** and its admin gating, as today (`:450-466`).
- **Hooks:**
  - It has no live role (today `role="alert"`, `:446`): it is information, not an error.
  - It keeps `data-testid="publish-preconditions"` and the bullet ids.
  - The inputs' `aria-describedby` point at their bullets whenever the box shows. Today that wiring waits for a Publish click (`preconditionIdsByField`, `:253`).

**Footer, editing** (D12):
- "unsaved changes" at the left, mono `--status-needs-revision-fg`, only while dirty (as the 5b item editor).
- **Publish** (secondary, `data-action="publish"`), only while unpublished. It is disabled (D13, R22) while the box shows or the form is dirty.
- **Discard** (ghost):
  - disabled while clean, titled "No changes to discard";
  - otherwise it resets the fields to the saved values and clears the server error and the field errors.
- **Save** (primary, `data-action="save"`):
  - disabled while clean ("No changes to save") or invalid (today's validation reason, `:125-141`, as its `title`);
  - "Saving…" with `loading` while it runs.
  - On success (D19): a "Saved" toast; the list refreshes (`onSaved`); the saved values become the new starting point; the modal stays open and focus stays on Save.

**Footer, creating:** Cancel (ghost) · **Create** (primary, `data-action="save"`, "Creating…" with `loading`). Create's disabled reasons are Save's. On success the modal closes and the list refreshes.

**The two confirms** (both `InlineConfirm` with `takeFocus`; each replaces the footer's buttons while it shows, and "unsaved changes" stays):
- **Publish** → "Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions)." with `data-action="confirm-publish"`.
  - Confirm rechecks both the box and the dirty flag (`:277-309`, plus R22). If either fails, the confirm closes and focus goes to Publish, or to × when Publish is now disabled.
  - On success: "Publishing…", then the list refreshes and the modal closes, as today.
- **Closing with unsaved edits** (×, Esc or create-mode Cancel) → "Discard unsaved changes?" with `data-action="confirm-discard"`. Confirm closes and drops the edits.
- **While either confirm shows:**
  - the body is inert (Modal's `bodyInert`), so nothing can be edited in between;
  - × and Esc never close the modal. They return focus to the confirm's Cancel. Esc on the confirm's own buttons cancels it;
  - Cancel returns focus to the control that opened the confirm: Publish, or × for a close.

**Kept:** every save/publish error and its copy:
- 404, with its keep-your-work text;
- 409 ("Refresh the page to see latest.");
- 422 field errors (`#err-{field}`, `role="alert"`);
- the generic messages.

A failed request focuses the first field with an error, or else stays on its button (R20). Closing still aborts an upload in flight.

**D16:** a `DirtyGuard` (`components/editor/DirtyGuard.svelte`) with `isDirty={() => dirty && !submitting}`. Back, a reload and a tab jump ask "Discard unsaved changes and continue?" while dirty. The router guards cover `?tab` changes, popstate and the "Open Overview" link (`lib/router.svelte.ts:112`, `:126`).

**The locked-edit guard** (`RunMiniProjectsTab`): the Assets "used by → Edit" path (`pendingEditTarget`, `:113-121`) reads the tab's own row (`stillExists`, `:116`).
- It opens nothing for a locked mini-project or a disabled version. It toasts that row's edit reason instead, as the disabled ✎ shows it (6a backlog, `slice6a-teacher-restyle-debt.md:106`).
- It still calls `onPendingEditConsumed()` (`RunDetailPage.tabs.svelte.test.ts:168-200`).

**Fix:** with the discard confirm showing, a second Esc from the assignment field, or a click on ×, discarded without asking (`closeForCurrentStage`, `:108-117`). Now the inert body and the confirm-open rule hold it.

## Focus

6a §Focus holds: focus never drops to `<body>`. In 6b:
- **Open:** each modal focuses:
  - Publish conflicts: Close (`data-autofocus`);
  - New run: Title;
  - import: the paste box;
  - mini-project: the assignment field, via `autofocusSelector={'textarea, header.modal-head button[aria-label="Close"]'}` as the 5b editors do (`editor/quiz/QuestionTextModal.svelte:116`).
- **Close:** focus returns to the opener (`FocusTrap`). Two cases where the opener cannot take it:
  - **A mini-project opened from Assets' "used by → Edit":** the opener is the Mini-projects tab, which `RunDetailPage` focuses before the modal opens (`:85-88`, 6a P10). Kept: focus returns to that tab.
  - **After Create:** "+ New" can become disabled, when the last free block gets its mini-project (`RunMiniProjectsTab.svelte:124-126`). After a create, focus goes to the new row's ✎, or else the tab's `<h2>`.
- **Requests:** R20; a failed request focuses the first errored field, or else stays on its button.
- **Import stage switch:** focus goes to Done.
- **The mini-project's confirms:** as §Mini-project editor says.

## Code changes

- **Changed:**
  - `components/runs/{PublishConflictsModal,NewRunModal,RosterImportModal,MiniProjectModal}.svelte`;
  - `components/runs/RunMiniProjectsTab.svelte` (passes `blocks`, the locked-edit guard, focus after a create);
  - `components/ui/Button.svelte` (`form`, `data-autofocus`).
- **New:** `components/ui/Switch.svelte`.
- **Tests:** the nine modal test files, plus `RunDetailPage.publish`, `RunMiniProjectsTab`, `RunDetailPage.tabs`, the existing `Button.svelte.test.ts`, and a new `Switch` test.
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

Suggested order:
1. Publish conflicts (smallest; sets up the gate list) with `Button`'s two props.
2. New run with `Switch`.
3. Import roster.
4. The mini-project frame, footer, freeze, Save-stays-open, confirms and guards.
5. The up-front precondition box.

## Testing

Existing tests keep their hooks unless a line here changes them on purpose.

**Every modal:**
- It renders inside `ui/Modal` (`[role="dialog"]` named by its `<h2>`).
- A backdrop click does not close it (D11).
- × and Esc close it, except during a request (R19).
- Focus on open as in §Focus.
- During a request the primary keeps focus, and a failed request leaves focus on it or on the first errored field (R20).

**Publish conflicts:**
- The three layouts and their counts; grouping by `run_id`; the note in all three layouts; the footer note.
- Close is focused and closes.
- Changed on purpose:
  - `PublishConflictsModal.svelte.test.ts:43`: `.modal` → the dialog;
  - `RunDetailPage.publish.svelte.test.ts:330`: the dialog is found by its heading (R26).
- `PublishConflictsModal.svelte.test.ts:46-129` keep passing: the `<strong>` titles and the `<ul>/<li>` lists stay inside Modal's `.modal-body`.

**New run:**
- The four validation messages, each tied to its field (`aria-invalid`, `aria-describedby`). A failed submit focuses the first invalid field.
- Clicking the Switch toggles `groups_enabled` in the request and does not submit the form.
- The footer button submits the form through `form` (a click; R17).
- The version strip: "will use {label} · v. {id}", and "will use v. {id}" for an empty label. `NewRunModal.svelte.test.ts:116-126` changes from "v2 (2026-02-01)" (D18), and `.version-row` stays as the hook.
- With no published version, the strip text shows and Create run is disabled with it as `title`.
- Esc and Cancel while creating do nothing, and success navigates once.

**Switch:**
- `type="button"`; `role="switch"` and `aria-checked` follow the value.
- Click and Space toggle it; a click on the label toggles it.
- Disabled and frozen ignore clicks; the help is wired.

**Button:** `form` and `data-autofocus` reach the `<button>`.

**Import roster:**
- The step marker in both stages (`aria-current`, the hidden "(done)").
- The paste box's name and description.
- The drawn help and counts. `RosterImportModal.scaffold.svelte.test.ts:46` ("Will auto-create groups: G1") changes on purpose.
- A skipping row shows its reasons as text (D20) and in its tile's `title`.
- "Showing the first 10 of N rows." only above 10 rows (D17), plus "Rows … will skip." with the cut after 5 (D22).
- Singular counts.
- The Detail column:
  - every error code shows its detail; "Not added" when there is none; the "internal error" mapping (R25);
  - "re-bucketed from …" for a student who changed group, and "from no group" for one who had none;
  - nothing for an unchanged student, a new student, or an empty group cell (D15).
  - `RosterImportModal.already-active.svelte.test.ts` Test 2 changes on purpose; Test 1 keeps passing.
- Focus lands on Done after the switch; Done is described by the summary.
- Done, then Done again or Esc, runs one refetch; a failed refetch still closes with the toast.
- The copy toast; the fallback textarea takes focus and selects.
- `RosterImportModal.submit.svelte.test.ts:283-310` now asserts the modal stays open on a backdrop click (D11).
- The hooks `p.error[role="alert"]`, `p.error`, `table.result`, `span.badge.badge-error[data-result="error"]` and `.error-detail` either stay or change on purpose in the same task; the plan names which.

**Mini-project editor:**
- The title and picker use position numbers, and the prefix drops for a missing block (R21).
- Editing shows the Block row as text, with no control (D14).
- Creating shows Cancel · Create. Editing shows Publish · Discard · Save, and "unsaved changes" only while dirty (D12).
- The disabled titles of Save, Discard, Create and Publish, and "Wait for the upload to finish" while uploading.
- Discard resets the fields and clears the errors.
- Save keeps the modal open, toasts "Saved", calls `onSaved`, and leaves the form clean (D19).
- The box:
  - it shows up front, without a Publish click, and not on a new or a published mini-project (D13);
  - it follows the fields on screen (D21);
  - typing into the assignment of a mini-project whose preconditions are all met never shows it (R22);
  - it has no `role="alert"`;
  - the `aria-describedby` wiring is present whenever it shows.
- The confirms:
  - both take focus;
  - the body is inert while either shows;
  - × and Esc from anywhere keep the confirm and the modal open;
  - Cancel returns focus to its opener;
  - the publish confirm refuses while dirty or while the box shows, and focus then goes to Publish or ×.
- During a request the fields are `readonly` and `MarkdownEditor` is `frozen`, rather than disabled. Changed on purpose:
  - "inputs disabled while submitting" (`MiniProjectModal.create-edit.svelte.test.ts:413`);
  - "clicking Publish disables Save" (`MiniProjectModal.publish.svelte.test.ts:589-612`). It becomes "Save ignores clicks while publishing", and "Publishing…" is kept.
- `MiniProjectModal.publish.svelte.test.ts:229-250` (the dirty bullet) changes to the R22 titles.
- `DirtyGuard` asks on a tab jump while dirty.
- Zone labels without parentheses.
- Structure tests:
  - `[data-role=backdrop]`, `.modal > header`, `.modal > footer` and `.backdrop` (`MiniProjectModal.create-edit.svelte.test.ts:294`, `:573-577`) move to Modal's markup;
  - the five `button[data-action=close-x]` uses move to Modal's × (`aria-label="Close"`);
  - `MiniProjectModal.create-edit.svelte.test.ts:271-298` flips: a backdrop click now leaves the modal open (D11);
  - `.banner-error` stays as the hook for the server-error banner.

**RunMiniProjectsTab:**
- The "used by → Edit" path opens nothing for a locked mini-project, toasts its reason, and still consumes the pending edit.
- After a create that disables "+", focus is on the new row's ✎.

## Gate

- **A `FILES_6B` list:** the four modals and `ui/Switch.svelte`. It runs the `emoji_scan` and `colour_scan` of 5b's (ag) over them, in the style of 6a's (aj) (`frontend/scripts/visual-refresh-gate.sh:4525-4543`).
  - Each modal joins the list in the task that migrates it.
  - The (ag) comment and the 5b backlog line (`docs/backlog/slice5b-authoring-polish-debt.md:258`) that kept MiniProjectModal out "until Slice 6" are updated in the mini-project task.
- **Modal owns `.modal-backdrop` again:** `own modal-backdrop Modal.svelte`, which (aa) could not assert while three run modals authored that class (`:4074`). It lands with the import task, after the last of those three moves.
- **New classes** each get `own` / `uniq1` and their `d` / `chk` rows, plus the `sweep` (no hex, no opacity dim).
- **Key declarations pinned:**
  - the four widths;
  - the switch track and knob, off and on;
  - the step marker;
  - the status tiles;
  - the gold box (background, the 3px gold rule, text colour);
  - the "unsaved changes" marker.
- `EXPECTED_CHECKS` moves with each task; the plan lists the ladder.

## Carried to the 6b browser pass

- Each modal at a laptop width and at about 1000px; the mini-project editor's asset panel beside the field at 820px (its stacking rule is a viewport query at 880px).
- Enter in New run's fields submits (implicit submission through `form`; R17).
- The Switch's off-state contrast (R16).
- The import with a real paste from a sheet (tabs), and the copy-failed path, on mocked requests.
- The mini-project editor: typing, Save staying open, Discard, the up-front box, "Open Overview" with unsaved edits (D16), Esc and × with a confirm open.
- Safari does not focus a button on a mouse click, so a mouse-opened modal may return focus to `<body>`. This is the same in every 5b modal; note it rather than fix it in 6b.
- The interim mixed look (6c's Overview, Roster and side panel are still old) is expected, not a finding.
