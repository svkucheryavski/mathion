# Slice 6b: the four teacher modals, on the shared Modal — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** move Publish conflicts, New run, Import roster and the Mini-project editor onto `ui/Modal`, draw them as screens 10l, 10k, 10f/10g and 10m, and fix their focus, close and save bugs.

**Architecture:**
- **One frame.** Each modal renders `<Modal>` with a header snippet (an `<h2>` that names the dialog), a body, and a footer snippet in the 5b house layout: a muted note or marker at the left (`flex: 1`), then the secondary actions, then the primary `Button`. Each modal's own backdrop, Esc listener, `FocusTrap` and × go. The backdrop never closes (D11).
- **Requests freeze, they don't grey out.** While a request runs, `closeDisabled` holds × and Esc, fields turn `readonly`, and the busy button keeps `loading` without `disabled`. Its handler and the other footer buttons ignore clicks (R19, R20).
- **Two shared additions.** A new `ui/Switch.svelte` (R16). `ui/Button` gains `form`, `data-autofocus` (R17) and `aria-describedby` (P1).
- **The mini-project editor** keeps its requests. It re-bases its baseline after an edit Save and stays open (D19). It shows the publish preconditions up front (D13), confirms in place with an inert body, and registers a `DirtyGuard` (D16). `RunMiniProjectsTab` passes `blocks`, guards the Assets "used by → Edit" path, and focuses the new row's ✎ after a create.
- **No backend change.**

**Tech Stack:**
- **Svelte:** Svelte 5.55, runes only, no JS/CSS dependencies.
- **Tests:** Vitest + jsdom, with `mount` / `unmount` / `flushSync` from `svelte`.
- **Gate:** the zsh gate `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-10-11-visual-refresh-slice6b-teacher-modals-design.md` (rev 4, commit `8074983`, approved by the user on 2026-10-11). Its D11–D23 and R16–R29 are binding; this plan cites them by number. Where it is silent, the 6a spec (rev 5) holds: D5, D8, R13, §Focus, P10.
**Design authority:** `docs/design/visual-refresh/reference-screens.dc.html` screens 10k (`:285-338`), 10l (`:339-387`), 10m (`:388-479`), 10f (`:810-905`), 10g (`:906-989`). Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/10{k,l,f,g,m}.png`.

## Global Constraints

- **Branch:** `feat/visual-refresh-slice6-teacher` (HEAD `8074983` when this plan was written). LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`. Scratch files go in `.superpowers/sdd/2026-10-11-visual-refresh-slice6b-teacher-modals/` (the "6b sdd dir": probes in `probe/`, gate temp files and logs in `tmp/`), never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. No new npm or pip dependencies.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, NOT `@testing-library/svelte`.
  - Match the surrounding comment density. No comments that narrate the change ("moved in 6b").
- **Colours and glyphs:**
  - No literal colours in component CSS or inline `style=`; theme tokens only (`src/styles/theme-default.css`). No `hsl(`, no hex fallbacks in `var(--x, #…)`. `Modal.svelte`'s shadow is the one allowed literal, and it is not in these files.
  - No `opacity` to dim anything.
  - No emoji and no glyph characters from the gate's `emoji_scan` set in component code: no `✓ ✗ × → ✎ 🗑`. The scan strips comments and does not read test files. Icons are inline SVG (R24) or `IconButton` glyphs.
  - Numerals, e-mails, dates and versions are mono: the global `mono` class or `font-family: var(--font-mono)`.
- **Class prefixes (P8):** `pc-` PublishConflictsModal, `nr-` NewRunModal, `ri-` RosterImportModal, `mpm-` MiniProjectModal, `switch` / `knob` Switch. `RunMiniProjectsTab` already owns `mp-`.
- **Pinned CSS rules are single-selector blocks (P13).** The gate's `d` helper matches `.cls.svelte-HASH{…}`, so a pinned rule must never share a selector list. Keep the hook classes `error`, `copy-fallback`, `badge`, `badge-ok`, `badge-error`, `error-detail`, `version-row`, `banner-error`, `field-error`, `precondition-banner` unstyled or styled only through a prefixed class beside them.
- **Commands** (`$SDD` below stands for `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-11-visual-refresh-slice6b-teacher-modals`; write it out in full when you run them):
  - Frontend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "Errors|Unhandled" $SDD/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. One file: `TZ=Europe/Copenhagen npx vitest run src/tests/<File>.test.ts` from the same directory.
  - Typecheck: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error > $SDD/tmp/svelte-check.log 2>&1; tail -3 $SDD/tmp/svelte-check.log`. It must report 0 errors. 13 warnings is the baseline; a task may not add one.
  - Gate: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. It must end `VISUAL-REFRESH GATE: ALL PASS (N checks)` with the N the task names. Never run it in two lanes at once.
  - If a pinned gate row fails only because the minifier wrote a value differently, read the emitted rule (`grep -oE '\.CLASS\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`), match the emitted form, and ledger a ruling. Never loosen a row to make it pass.
- **Per task, in this order** (the user's per-task loop; it overrides "continuous execution"):
  1. TDD, step by step as written.
  2. vitest (green as defined above), svelte-check (0 errors), the gate (the task's N).
  3. agent-browser screenshots of the real modal at 1280 and 1000 wide (dev data, run 8, plus network mocks for every write), in an agterm overlay with `--size-percent 60`, images as base64, the HTML in the 6b sdd dir (copy the shape of `.superpowers/sdd/2026-10-10-visual-refresh-slice6a-teacher-restyle/mk-t11.py`). Then the user's OK on the look.
  4. Two review lanes, Opus (high) and Fable, on the UNCOMMITTED diff. Fix every Critical and Important finding, then re-run both lanes after EVERY fix until both are clean. Minors go to `docs/backlog/slice6b-teacher-modals-debt.md` (created in Task 1) under the task's heading. Do not edit the tree while a lane reviews.
  5. Commit with exact paths (never `git add -A`) and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (no session line).
  6. Ledger line in `$SDD/progress.md`, update memory, then WAIT for the user's "go" before the next task.
- **Dev servers for screenshots** (both already run in this session; never start a second copy):
  - Backend: uvicorn started with `MATHION_DEBUG=1 MATHION_ASSET_PATH="$HOME/mathion-assets"`; the PIN appears in `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/backend.log`.
  - Frontend: vite on `http://localhost:5174`. agent-browser session `mathion-0fb6bc751f3c` (`export AGENT_BROWSER_SESSION=mathion-0fb6bc751f3c`), signed in as `dev@mathion.test`. Screenshot paths must be absolute.
  - Logins: `dev@mathion.test` (course admin) and `teacher@mathion.test` (teacher of run 8). Run 8 lives at `/teaching/demo-course/runs/8?tab=…`.
  - Never write to shared dev data without the user's yes: every Create, Import, Save and Publish request in a screenshot is mocked with `agent-browser network route "<url glob>" --body '…'` (status per the core guide, `agent-browser skills get core --full`). On sequence pages mock `**/api/items/*/track`. Never press Enter in a real field.
- **Texts, verbatim** (spec; R28: ASCII apostrophes, singular at 1):
  - Conflicts title: `1 student can't be added` / `{N} students can't be added`; lead `They are already active in other runs:`; note `A student can only be active in one run of a course at a time. Remove them from the other run, or take them off this roster, then publish again.`; footer note `Nothing was published — the run is unchanged.`
  - New run: labels `Title`, `Start date`, `End date`, `Groups enabled`; help `Organise students into groups. Locked once the run is published — and mini-projects need it.`; strip `Version` + `will use {label} · v. {id}` (or `will use v. {id}`); no version `No published version — close this modal and publish one first.`; footer note `The newest published version is pinned at creation and cannot be changed later.`; buttons `Cancel`, `Create run` / `Creating…`; errors `Title is required`, `Start date is required`, `End date is required`, `End date must be on or after start date`, `Unable to create run.`
  - Import: title `Import roster from CSV`; steps `Paste`, `Result`, hidden ` (done)`; help `Paste rows from Excel or Google Sheets, tab or comma separated. Columns: name optional, email required, group optional — a group that doesn't exist yet is created.` (the three column names in `<code>`); paste box name `Rows to import`; hidden header `Status`; tiles `Valid` / `Will skip`; `Showing the first 10 of {N} rows.`; `Row {n} will skip.` / `Rows {a}, {b} will skip.` (P7: `…, +{k} more will skip.`); `{n} rows — {v} valid, {s} will skip ({i} invalid, {d} duplicate in paste).` (`1 row — …`); `Will create groups: {names}.`; `Already enrolled, will be re-bucketed: {emails}.`; footer `Invalid rows are skipped, never guessed at.`, `Import {v} valid rows` / `Import 1 valid row` / `Importing…`, title `No valid rows to import`; result headers `#`, `Email`, `Result`, `Detail`; chips `added`, `error`; `Not added`, `Server error — try again`, `re-bucketed from {group}`, `re-bucketed from no group`; summary `{a} added, {f} failed.`; footer `Failed rows can be copied as text and fixed in your sheet.`, `Copy failed rows`, `Done`; toasts `Copied 1 row` / `Copied {n} rows`, `Roster refresh failed — reload to see the latest.`; errors `Import failed — please retry.`, `Paste is empty.`, `No email column found.`
  - Mini-project: titles `New mini-project`, `Edit — Block {n} — {title}` (P5: `Edit mini-project` with no block); row key `Block`; labels `Assignment`, `Soft deadline`, `Hard deadline`, `Resubmission`; zone `GMT+2` (no parentheses); box heading `Cannot publish yet`; footer marker `unsaved changes`; buttons `Publish` / `Publishing…`, `Discard`, `Save` / `Saving…`, `Cancel`, `Create` / `Creating…`; titles `No changes to save`, `No changes to discard`, `Wait for the upload to finish`, `Resolve the listed preconditions first`, `Save your changes first`; confirms `Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions).` (confirm `Publish`) and `Discard unsaved changes?` (confirm `Discard`); toasts `Saved`, `Saved (refresh failed — reload to see latest)`, `Created (refresh failed — reload to see latest)`; DirtyGuard prompt (unchanged) `Discard unsaved changes and continue?`
  - Mini-projects tab ✎ reasons (6a, unchanged): `Has submissions — editing is off`, `This run's course version is disabled.`

## Rulings made while planning

Each states what it costs if wrong. P-numbers avoid a clash with the spec's R-numbers.

- **P1 — `ui/Button` also forwards `aria-describedby`.** The import's Done is described by the summary (spec §Import › Result stage), and `Button` has no rest props. *Cost:* a third optional prop.
- **P2 — The "·" before each precondition bullet is drawn by CSS (`li::before`).** `MiniProjectModal.teacher-gating.svelte.test.ts:134-136` compares a bullet's text exactly, and the bullet ids are `aria-describedby` targets, so the text stays the sentence alone. *Cost:* none.
- **P3 — One toast after an edit Save, sent once the list refresh settles:** `Saved`, or `Saved (refresh failed — reload to see latest)` when only the refresh failed. This is 5b's order (`ItemEditorModal.svelte:200-208`). The spec numbers the toast before the refresh but says that on a failed refresh "the toast reads" the other text: one toast, never two that contradict. *Cost:* the toast waits for the refresh.
- **P4 — `blocks` is an optional `MiniProjectModal` prop (default `[]`).** The existing suites build their prop objects without it and stay valid; `RunMiniProjectsTab` always passes it, and its test pins the numbered title. Without it the "Block {n} — " prefix drops, which is R21's missing-block rule. *Cost:* a caller that forgets it shows titles without numbers.
- **P5 — An edit with no `currentBlock` is titled `Edit mini-project`, and its Block row shows a muted "—".** Today it reads "Edit — Block ? — ". *Cost:* copy.
- **P6 — Space on the Switch is the platform's.** jsdom does not turn Space into a click on a `<button>`, so the Switch test asserts a native `<button type="button">` and the browser pass checks Space. jsdom does click a button through its `<label for>` (`HTMLLabelElement-impl.js` activation behaviour), and submits a form through a `form=` button (`HTMLButtonElement-impl.js` resolves the owner through `formOwner`, which honours `form=`). *Cost:* none.
- **P7 — D22's cut follows the enrolled list's existing form**, `, +N more`: `Rows 11, 12, 13, 14, 15, +2 more will skip.` *Cost:* characters.
- **P8 — Class prefixes `pc- nr- ri- mpm-` and `switch`.** The gate's `own` needs a class authored by one file only. *Cost:* none.
- **P9 — "re-bucketed from …" needs the result row's `group_id`** (`RunStudentBatchResultRow.group_id?`, `lib/types.ts:339-345`). A row without it, or whose old group is missing from the refetched groups, gets an empty Detail rather than a guess. *Cost:* a real move without a known old group reads as no move.
- **P10 — The import's copy fallback textarea is named `Failed rows`** (today it has no name). *Cost:* a label.
- **P11 — On the publish confirm's Confirm, the busy Publish takes focus before the request starts.** The confirm's buttons unmount under the focus (R20: the busy button keeps focus). *Cost:* none.
- **P12 — New run's version strip is `<p class="nr-strip version-row">`.** `.version-row` stays the test hook. *Cost:* none.
- **P13 — Pinned CSS rules are single-selector blocks** (Global Constraints). *Cost:* a few repeated declarations.
- **P14 — The mini-project task is split as the spec suggests.** Task 4 restyles the box (gold, "Cannot publish yet", no `.banner-error`) but keeps today's Publish-click gating and `role="alert"`. Task 5 shows it up front, drops the live role, wires `aria-describedby` whenever it shows, and disables Publish while it shows (D13). *Cost:* one interim commit where the box still waits for a click.
- **P15 — New 6b behaviour of `MiniProjectModal` is tested in two new files**, `MiniProjectModal.frame.svelte.test.ts` (Task 4) and `MiniProjectModal.box.svelte.test.ts` (Task 5). The three old suites change only where the spec's Testing list says "changed on purpose". *Cost:* two more files.
- **P16 — The import's Done shows no loading state while its refetch runs**; the `closing` flag and `closeDisabled` hold the modal (spec §Import › Fixes). *Cost:* none; the refetch is short.
- **P17 — The locked-edit guard opens the tab's own row** (fresh from `miniProjects`), not the parent's object, and its toast is `info`. *Cost:* none.
- **P18 — The mini-project's "unsaved changes" marker shows only when editing.** D12 draws it in the edit footer; in create mode every keystroke is unsaved, so the span stays as the empty `flex: 1` spacer before Cancel · Create. *Cost:* a marker in create mode, if wanted.

## Review Focus

The five inputs or conditions most likely to bite a teacher that no spec line tests directly. Each has its test in the owning task.

1. **A double action.** A double-click on Create run, Import, Save or Publish, or Enter pressed twice in New run, sends one request and navigates or closes once (R20). Tests: Task 2 (New run, Enter + click), Task 3 (Import), Task 4 (Save).
2. **Mixed-case e-mails.** A roster e-mail stored as `Ann@X.com` and a paste `ann@x.com,G1` is a real move in the preview (D23) and a re-bucket in the result (D15). Test: Task 3.
3. **Closing and reopening.** After a modal closes, the scroll lock is released and a second open works. Test: Task 1 (`document.documentElement.style.overflow` back to `''`).
4. **Focus after a save in Preview mode.** The editor in Preview has no textarea; focus lands on the Edit tab, never on `<body>`. Test: Task 4.
5. **A refresh that fails after a successful write.** The form is clean, no save error shows, the right toast shows, and a create still closes (D19). Tests: Task 4 (edit and create).

## Gate ladder

`EXPECTED_CHECKS` starts at **1624** (`frontend/scripts/visual-refresh-gate.sh:90`).

| Task | Adds | EXPECTED_CHECKS |
|---|---|---|
| 1 Publish conflicts + Button + (ak) | 30 | 1654 |
| 2 New run + Switch | 43 | 1697 |
| 3 Import roster | 35 | 1732 |
| 4 Mini-project frame, footer, confirms, guards | 36 | 1768 |
| 5 The up-front precondition box | 4 | 1772 |

## File map

| File | Task | What changes |
|---|---|---|
| `frontend/src/components/ui/Button.svelte` | 1 | `form`, `data-autofocus`, `aria-describedby` pass-through props |
| `frontend/src/components/runs/PublishConflictsModal.svelte` | 1 | on `Modal`, drawn as 10l |
| `frontend/src/components/ui/Switch.svelte` (new) | 2 | the switch (R16) |
| `frontend/src/components/runs/NewRunModal.svelte` | 2 | on `Modal`, drawn as 10k, R17–R20 |
| `frontend/src/components/runs/RosterImportModal.svelte` | 3 | on `Modal`, drawn as 10f/10g, D15/D17/D20/D22/D23, fixes |
| `frontend/src/components/runs/MiniProjectModal.svelte` | 4, 5 | on `Modal`, drawn as 10m, D12–D16, D19, D21, R19–R23 |
| `frontend/src/components/runs/RunMiniProjectsTab.svelte` | 4 | passes `blocks`, locked-edit guard, focus after a create |
| `frontend/scripts/visual-refresh-gate.sh` | 1–5 | section (ak), the (aa)/(af) comments, `EXPECTED_CHECKS` |
| `docs/backlog/slice6b-teacher-modals-debt.md` (new) | 1 | the 6b backlog |
| `docs/backlog/slice5b-authoring-polish-debt.md` | 4 | the "until Slice 6" line closes |
| `docs/backlog/slice5c-constructor-polish-debt.md`, `docs/backlog/slice6a-teacher-restyle-debt.md` | 4 | the block-number line (R21) and the locked "used by → Edit" line close |
| tests (see each task) | 1–5 | |

---

### Task 1: Publish conflicts on Modal, Button's pass-through props, gate section (ak)

**Files:**
- Modify: `frontend/src/components/ui/Button.svelte` (props block `:3-19`, the `<button>` `:22-33`)
- Modify (rewrite): `frontend/src/components/runs/PublishConflictsModal.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (`:90` EXPECTED_CHECKS; new section (ak) before the closing `# The summary line is the parent process's` comment)
- Create: `docs/backlog/slice6b-teacher-modals-debt.md`
- Test: `frontend/src/tests/Button.svelte.test.ts`, `frontend/src/tests/PublishConflictsModal.svelte.test.ts`, `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`

**Interfaces:**
- Consumes: `ui/Modal` (props `labelledby`, `width`, `onRequestClose`, `header`, `footer`, `children`; autofocus default `[data-autofocus], #{uid}-close`), `ui/Button`.
- Produces:
  - `Button` props `form?: string`, `'data-autofocus'?: boolean`, `'aria-describedby'?: string`. Tasks 2–4 use them.
  - Gate section (ak) with the list `FILES_6B` and the helper `srcw RELPATH WIDTH` (`RELPATH` under `src/components/`). Tasks 2–5 append to both.
  - `docs/backlog/slice6b-teacher-modals-debt.md`, which every later task writes its minors into.

- [ ] **Step 1: Write the failing Button tests**

Append inside `describe('Button', …)` in `frontend/src/tests/Button.svelte.test.ts`, after the `forwards data-action (6a P2)` test:

```ts
  // Slice-6b R17 / P1: pass-throughs for the run modals.
  it('forwards form, so a footer button can submit a form it sits outside of', () => {
    expect(render({ type: 'submit', form: 'f1' }).getAttribute('form')).toBe('f1');
  });
  it('omits form by default', () => {
    expect(render({}).hasAttribute('form')).toBe(false);
  });
  it('marks data-autofocus when asked, so ui/Modal focuses it on open', () => {
    expect(render({ 'data-autofocus': true }).hasAttribute('data-autofocus')).toBe(true);
  });
  it('omits data-autofocus by default', () => {
    expect(render({}).hasAttribute('data-autofocus')).toBe(false);
  });
  it('forwards aria-describedby', () => {
    expect(render({ 'aria-describedby': 'sum' }).getAttribute('aria-describedby')).toBe('sum');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/Button.svelte.test.ts`
Expected: FAIL — 3 tests fail (`form`, `data-autofocus`, `aria-describedby` are not forwarded); the two "omits" tests pass already.

- [ ] **Step 3: Add the three props to Button**

In `frontend/src/components/ui/Button.svelte`, after the `'data-action'` prop (`:14`), add:

```ts
    // Slice-6b R17: a footer button submits the form it sits outside of through
    // `form`; `data-autofocus` lets ui/Modal pick it on open. P1: the import's
    // Done is described by its summary.
    form = undefined as string | undefined,
    'data-autofocus': dataAutofocus = false,
    'aria-describedby': ariaDescribedby = undefined as string | undefined,
```

and in the `<button>` element, after `data-action={dataAction}`:

```svelte
  data-autofocus={dataAutofocus ? '' : undefined}
  {form}
  aria-describedby={ariaDescribedby}
```

- [ ] **Step 4: Run the Button tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/Button.svelte.test.ts`
Expected: PASS (all Button tests).

- [ ] **Step 5: Write the failing PublishConflictsModal tests**

In `frontend/src/tests/PublishConflictsModal.svelte.test.ts`:

1. Change the imports and the cleanup so a test that mounts its own instances never unmounts a stale one:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

```ts
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  document.body.removeChild(target);
});

// FocusTrap autofocuses in a microtask; Modal registers its listeners on mount.
async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flushSync();
}
```

2. At `:43`, the body is no longer `.modal` (changed on purpose, spec §Testing):

```ts
    const body = target.querySelector('[role="dialog"]')?.textContent ?? '';
```

3. Append a new `describe` block at the end of the file:

```ts
describe('PublishConflictsModal — on ui/Modal (10l)', () => {
  const NOTE =
    'A student can only be active in one run of a course at a time. Remove them from the other run, or take them off this roster, then publish again.';
  const two: PublishConflict[] = [
    { user_id: 1, email: 'a@example.com', run_id: 10, run_title: 'Spring 2025' },
    { user_id: 2, email: 'b@example.com', run_id: 11, run_title: 'Fall 2025' },
  ];

  it('renders inside ui/Modal, named by its heading (R26)', async () => {
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose: () => {} } });
    await settle();
    const dialog = target.querySelector('section.modal-panel[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.hasAttribute('aria-label')).toBe(false);
    const heading = document.getElementById(dialog!.getAttribute('aria-labelledby') ?? '');
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe("2 students can't be added");
  });

  it('shows the drawn note in all three layouts, and the footer note', async () => {
    const layouts: PublishConflict[][] = [
      [{ ...BASE_CONFLICT }],
      [{ ...BASE_CONFLICT }, { ...BASE_CONFLICT, user_id: 2, email: 'b@example.com' }],
      two,
    ];
    for (const conflicts of layouts) {
      const cmp = mount(PublishConflictsModal, { target, props: { open: true, conflicts, onClose: () => {} } });
      await settle();
      expect(target.querySelector('.modal-body')?.textContent).toContain(NOTE);
      expect(target.querySelector('.modal-foot')?.textContent).toContain('Nothing was published — the run is unchanged.');
      unmount(cmp);
    }
  });

  it('the grouped layout leads with the drawn sentence; long values keep their full text as title', async () => {
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose: () => {} } });
    await settle();
    expect(target.querySelector('.pc-lead')?.textContent?.trim()).toBe('They are already active in other runs:');
    const titles = Array.from(target.querySelectorAll('.pc-title')).map((t) => t.getAttribute('title'));
    expect(titles).toEqual(['Spring 2025', 'Fall 2025']);
    const emails = Array.from(target.querySelectorAll('.pc-emails li')).map((li) => li.getAttribute('title'));
    expect(emails).toEqual(['a@example.com', 'b@example.com']);
  });

  it('focuses Close on open, and Close closes', async () => {
    const onClose = vi.fn();
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose } });
    await settle();
    const close = target.querySelector<HTMLButtonElement>('.modal-foot button[data-action="close"]')!;
    expect(close.textContent?.trim()).toBe('Close');
    expect(close.getAttribute('data-variant')).toBe('secondary');
    expect(document.activeElement).toBe(close);
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('× and Esc close it; a backdrop click does not (D11)', async () => {
    const onClose = vi.fn();
    component = mount(PublishConflictsModal, { target, props: { open: true, conflicts: two, onClose } });
    await settle();
    target.querySelector<HTMLElement>('.modal-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    target.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('mounts nothing while closed and releases the scroll lock on close (Review Focus 3)', async () => {
    const props = $state({ open: false, conflicts: two, onClose: () => {} });
    component = mount(PublishConflictsModal, { target, props });
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    props.open = true;
    await settle();
    expect(document.documentElement.style.overflow).toBe('hidden');
    props.open = false;
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    props.open = true;
    await settle();
    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/PublishConflictsModal.svelte.test.ts`
Expected: FAIL — the six new tests fail (no `section.modal-panel`, no note, no `.pc-*`, no `data-action="close"`, the backdrop closes, no scroll lock). The four old layout tests still pass.

- [ ] **Step 7: Rewrite PublishConflictsModal on Modal**

Replace `frontend/src/components/runs/PublishConflictsModal.svelte` with:

```svelte
<script lang="ts">
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import type { PublishConflict } from '../../lib/types';

  // Pure-presentation modal: parent narrows the 409 publish-conflict body and
  // passes `conflicts` already typed. NO ApiError import here (spec §2 line
  // 225 / K2). NO empty-state branch (parent's J2 guard prevents `length === 0`
  // mounts). <Modal> mounts only while `open`, so the scroll lock is taken
  // only then.
  let { open, conflicts, onClose }: {
    open: boolean;
    conflicts: PublishConflict[];
    onClose: () => void;
  } = $props();

  // $props.id() may only initialise a top-level declaration.
  const uid = $props.id();
  const titleId = `${uid}-title`;

  // Heading count dedupes on user_id (I4): a single student appearing in
  // multiple conflict rows counts once.
  const studentCount = $derived(new Set(conflicts.map((c) => c.user_id)).size);

  // Group by run_id, NOT run_title (G3): two runs may share a title; they must
  // render as separate groups.
  const groupedByRun = $derived.by(() => {
    const map = new Map<number, { run_title: string; emails: string[] }>();
    for (const c of conflicts) {
      const existing = map.get(c.run_id);
      if (existing) {
        if (!existing.emails.includes(c.email)) existing.emails.push(c.email);
      } else {
        map.set(c.run_id, { run_title: c.run_title, emails: [c.email] });
      }
    }
    return Array.from(map.entries()).map(([run_id, v]) => ({ run_id, ...v }));
  });

  // Layout selector mirrors spec §3.3 lines 546-548:
  //   'single-sentence' — exactly one student AND one conflict row.
  //   'single-group'    — N≥2 students all on the same run.
  //   'grouped'         — multi-group form (covers both N≥2 across runs AND
  //                       the I4 legacy single-user-multi-run dup case).
  const layout = $derived.by<'single-sentence' | 'single-group' | 'grouped'>(() => {
    if (studentCount === 1 && conflicts.length === 1) return 'single-sentence';
    if (studentCount >= 2 && groupedByRun.length === 1) return 'single-group';
    return 'grouped';
  });

  const headingText = $derived(
    studentCount === 1 ? "1 student can't be added" : `${studentCount} students can't be added`,
  );
</script>

{#snippet head()}
  <h2 id={titleId} class="pc-heading">{headingText}</h2>
{/snippet}

{#snippet foot()}
  <span class="pc-foot-note">Nothing was published — the run is unchanged.</span>
  <Button variant="secondary" data-action="close" data-autofocus onclick={onClose}>Close</Button>
{/snippet}

{#snippet emailList(emails: string[])}
  <ul class="pc-emails">
    {#each emails as email (email)}
      <li title={email}>{email}</li>
    {/each}
  </ul>
{/snippet}

{#if open}
  <Modal
    labelledby={titleId}
    width={560}
    onRequestClose={onClose}
    header={head}
    footer={foot}
  >
    {#if layout === 'single-sentence'}
      <p class="pc-lead">{conflicts[0].email} is already active in <strong>{conflicts[0].run_title}</strong>.</p>
    {:else if layout === 'single-group'}
      <div class="pc-run">
        <p class="pc-lead">They are already active in <strong>{groupedByRun[0].run_title}</strong>:</p>
        {@render emailList(groupedByRun[0].emails)}
      </div>
    {:else}
      <!-- grouped: covers I4 single-user-multi-run AND N≥2 across distinct runs -->
      {#if studentCount === 1}
        <p class="pc-lead">{conflicts[0].email} is already active in:</p>
      {:else}
        <p class="pc-lead">They are already active in other runs:</p>
      {/if}
      <div class="pc-runs">
        {#each groupedByRun as group (group.run_id)}
          <div class="pc-run">
            <strong class="pc-title" title={group.run_title}>{group.run_title}</strong>
            {@render emailList(group.emails)}
          </div>
        {/each}
      </div>
    {/if}
    <p class="pc-note">A student can only be active in one run of a course at a time. Remove them from the other run, or take them off this roster, then publish again.</p>
  </Modal>
{/if}

<style>
  /* The × sits at the right edge of the header. */
  .pc-heading {
    margin-right: auto;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .pc-lead {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .pc-lead strong { font-weight: 600; color: var(--text); }
  .pc-runs {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pc-run {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .pc-title {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pc-emails {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 0 0 0 12px;
    list-style: none;
    border-left: 2px solid var(--border);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }
  .pc-emails li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pc-note {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--muted);
  }
  .pc-foot-note {
    flex: 1;
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
```

- [ ] **Step 8: Run the PublishConflictsModal tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/PublishConflictsModal.svelte.test.ts`
Expected: PASS (10 tests). The old tests' `.modal-body strong` / `.modal-body ul` queries still find the `<strong>` titles and lists inside Modal's `.modal-body` (spec §Testing).

- [ ] **Step 9: Find the dialog by its heading in the publish wiring tests, and pin the focus return**

In `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`, replace `dialogEl()` (`:329-331`) — changed on purpose, R26:

```ts
// R26: the dialog is named by its <h2>, not by an aria-label.
function dialogEl(): Element | null {
  return Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => {
    const id = d.getAttribute('aria-labelledby');
    return !!id && /can't be added$/.test(document.getElementById(id)?.textContent?.trim() ?? '');
  }) ?? null;
}
```

and append inside `describe('PublishConflictsModal wiring (E3)', …)`:

```ts
  it('closing the conflicts modal returns focus to Publish (spec §Publish conflicts › Focus)', async () => {
    const { target, cmp } = setupWithPublishStub({
      detail: 'Cannot publish: 1 student already active',
      error_code: 'student_already_active_in_course',
      conflicts: [{ user_id: 1, email: 'a@example.com', run_id: 7, run_title: 'Old Run A' }],
    }, 409);
    await settle();
    const btn = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    btn.focus();
    btn.click();
    await settle();
    const close = dialogEl()!.querySelector<HTMLButtonElement>('button[data-action="close"]')!;
    expect(document.activeElement).toBe(close);
    close.click();
    await settle();
    expect(dialogEl()).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('button[data-action="publish"]'));
    unmount(cmp);
  });
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunDetailPage.publish.svelte.test.ts`
Expected: PASS. (Before the `dialogEl` change the old helper's `aria-label="Cannot publish run"` would find nothing and Tests 1, 4 and 5 would fail.)

- [ ] **Step 10: Add gate section (ak) and the 6b backlog**

In `frontend/scripts/visual-refresh-gate.sh`, insert before the line `# The summary line is the parent process's (see the re-exec at the top).`:

```zsh
echo
echo "--- (ak) Slice-6b — the four teacher modals on ui/Modal ---"
# Every file Slice 6b migrates or creates; each task appends its files (spec §Gate).
FILES_6B=(
  src/components/runs/PublishConflictsModal.svelte
)
emoji_scan "all Slice-6b files" $FILES_6B
colour_scan 6b-modals $FILES_6B
# D11: no 6b modal closes on a backdrop click or draws a backdrop of its own.
if grep -lE 'closeOnBackdrop|class="(modal-)?backdrop"' $FILES_6B >/dev/null 2>&1; then
  echo "FAIL  no 6b modal closes on a backdrop click or draws its own backdrop (D11)"; fail=1
else echo "PASS  no 6b modal closes on a backdrop click or draws its own backdrop (D11)"; fi
# srcw RELPATH WIDTH — the modal renders ui/Modal at its drawn width (spec §Common frame).
srcw() {
  local f=src/components/$1
  if grep -q "import Modal from '../ui/Modal.svelte'" $f && grep -qE "^[[:space:]]*width=\{$2\}" $f; then
    echo "PASS  ${1:t} renders ui/Modal at width $2"
  else
    echo "FAIL  ${1:t} renders ui/Modal at width $2"; fail=1
  fi
}
srcw runs/PublishConflictsModal.svelte 560
own pc-emails PublishConflictsModal.svelte
uniq1 pc-emails
if [[ -n $REPLY ]]; then
  N=PublishConflictsModal; H=$REPLY
  d '\.pc-heading' '' 'font-size:15px' 'font-weight:600' 'color:var\(--text\)'
  d '\.pc-lead' '' 'font-size:13px' 'color:var\(--text-2\)'
  d '\.pc-run' '' 'display:flex' 'flex-direction:column' 'gap:5px'
  d '\.pc-title' '' 'font-size:13px' 'font-weight:600' 'color:var\(--text\)'
  d '\.pc-emails' '' 'padding:0 0 0 12px' 'border-left:2px solid var\(--border\)' 'font-family:var\(--font-mono\)' 'font-size:12px' 'color:var\(--text-3\)'
  d '\.pc-note' '' 'font-size:12\.5px' 'line-height:1\.5' 'color:var\(--muted\)'
  d '\.pc-foot-note' '' 'flex:1' 'font-size:12\.5px' 'color:var\(--muted\)'
  sweep PublishConflictsModal $H
fi
```

and set `EXPECTED_CHECKS=1654` at `:90` (1624 + 30: emoji 1, colour 1, D11 1, srcw 1, own 1, uniq1 1, 22 declarations, sweep 2).

Create `docs/backlog/slice6b-teacher-modals-debt.md`:

```markdown
# Slice 6b — teacher modals: debt and deferred minors

Spec: `docs/superpowers/specs/2026-10-11-visual-refresh-slice6b-teacher-modals-design.md`.
Plan: `docs/superpowers/plans/2026-10-11-visual-refresh-slice6b-teacher-modals.md`.

Review minors and browser-pass findings, by task. Each entry says where it lives and what fixing it would take.
```

- [ ] **Step 11: Run the full checks**

Run the frontend tests, svelte-check and the gate exactly as Global Constraints › Commands give them.
Expected: vitest `exit 0` and `0` Errors/Unhandled lines; svelte-check 0 errors, 13 warnings; gate `VISUAL-REFRESH GATE: ALL PASS (1654 checks)`.

- [ ] **Step 12: Screenshots for the user**

The modal needs a publish 409 on a draft run. Open `http://localhost:5174/teaching/demo-course/runs/8?tab=overview`. If run 8 shows no Publish button (it is published), mock `**/api/runs/8` with the real response's body and `"published_at": null` (read the real body first with `agent-browser network requests` or a plain `curl` through the dev proxy). Mock `**/api/runs/8/publish` → status 409 with:

```json
{"detail":"Cannot publish: 3 students already active","error_code":"student_already_active_in_course","conflicts":[{"user_id":1,"email":"mei.tanaka@uni.edu","run_id":3,"run_title":"Spring 2026"},{"user_id":2,"email":"pavel.novak@uni.edu","run_id":3,"run_title":"Summer intensive with a very long run title that should cut off"},{"user_id":3,"email":"lena.wolf@uni.edu","run_id":4,"run_title":"Summer intensive"}]}
```

Click Publish, then screenshot at 1280×800 and 1000×800 (absolute paths in the 6b sdd dir). Build the overlay (10l reference image beside each shot), open it with `--size-percent 60`, and wait for the user's OK. Clear the routes afterwards.

- [ ] **Step 13: Review lanes**

Run the Opus (high) and Fable lanes on the uncommitted diff (`git diff` plus the new backlog file), with the spec, this task's text and the Global Constraints. Fix every Critical and Important finding; re-run both lanes after every fix until both are clean. Minors go to the backlog under "## Task 1 — Publish conflicts".

- [ ] **Step 14: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/ui/Button.svelte frontend/src/components/runs/PublishConflictsModal.svelte \
  frontend/scripts/visual-refresh-gate.sh docs/backlog/slice6b-teacher-modals-debt.md \
  frontend/src/tests/Button.svelte.test.ts frontend/src/tests/PublishConflictsModal.svelte.test.ts \
  frontend/src/tests/RunDetailPage.publish.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6b): publish conflicts on ui/Modal (10l); Button form/autofocus props

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Then the ledger line, memory, and wait for "go".

---

### Task 2: New run on Modal, and the Switch

**Files:**
- Create: `frontend/src/components/ui/Switch.svelte`
- Create: `frontend/src/tests/support/SwitchHarness.svelte`, `frontend/src/tests/Switch.svelte.test.ts`
- Modify (rewrite): `frontend/src/components/runs/NewRunModal.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (ak), `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/NewRunModal.svelte.test.ts`

**Interfaces:**
- Consumes: `Button` props `form`, `data-autofocus` (Task 1); `Modal` (`closeDisabled`); gate `FILES_6B`, `srcw` (Task 1).
- Produces: `ui/Switch.svelte` — props `checked` (bindable boolean), `id: string` (required; the caller's `<label for>` points at it), `disabled?: boolean`, `frozen?: boolean`, `title?: string`, `describedby?: string`. 6c's Overview reuses it.

- [ ] **Step 1: Write the failing Switch tests**

Create `frontend/src/tests/support/SwitchHarness.svelte`:

```svelte
<script lang="ts">
  // Test host for ui/Switch: a bound value, a visible <label for>, a help line,
  // and a form that counts submits (a switch click must never submit).
  import Switch from '../../components/ui/Switch.svelte';
  let { disabled = false, frozen = false, title = undefined }: {
    disabled?: boolean;
    frozen?: boolean;
    title?: string;
  } = $props();
  let checked = $state(false);
  let submits = $state(0);
</script>

<form onsubmit={(e) => { e.preventDefault(); submits += 1; }}>
  <label for="sw">Groups enabled</label>
  <Switch id="sw" bind:checked {disabled} {frozen} {title} describedby="sw-help" />
  <p id="sw-help">Help text</p>
</form>
<output data-testid="value">{checked}</output>
<output data-testid="submits">{submits}</output>
```

Create `frontend/src/tests/Switch.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SwitchHarness from './support/SwitchHarness.svelte';

let host: HTMLDivElement;
let cmp: ReturnType<typeof mount> | undefined;

function render(props: Record<string, unknown> = {}): HTMLButtonElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  cmp = mount(SwitchHarness, { target: host, props });
  flushSync();
  return host.querySelector('button[role="switch"]') as HTMLButtonElement;
}
const value = () => host.querySelector('[data-testid="value"]')!.textContent;
const submits = () => host.querySelector('[data-testid="submits"]')!.textContent;

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = undefined;
  host.remove();
});

describe('Switch (R16)', () => {
  // P6: Space and Enter come from the platform because it is a native button;
  // jsdom does not synthesise them, so the browser pass checks Space.
  it('is a native type=button with role=switch; aria-checked and the on class follow the value', () => {
    const sw = render();
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.type).toBe('button');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.classList.contains('on')).toBe(false);
    sw.click();
    flushSync();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.classList.contains('on')).toBe(true);
    expect(value()).toBe('true');
  });

  it('a click never submits the form it sits in', () => {
    const sw = render();
    sw.click();
    sw.click();
    flushSync();
    expect(value()).toBe('false');
    expect(submits()).toBe('0');
  });

  it('a click on its label toggles it', () => {
    render();
    host.querySelector('label')!.click();
    flushSync();
    expect(value()).toBe('true');
  });

  it('the help line is its description', () => {
    const sw = render();
    expect(sw.getAttribute('aria-describedby')).toBe('sw-help');
  });

  it('disabled ignores clicks and names its reason', () => {
    const sw = render({ disabled: true, title: 'Locked once the run is published' });
    sw.click();
    flushSync();
    expect(sw.disabled).toBe(true);
    expect(sw.title).toBe('Locked once the run is published');
    expect(value()).toBe('false');
  });

  it('frozen keeps focus and its look but ignores clicks (R19)', () => {
    const sw = render({ frozen: true });
    sw.focus();
    sw.click();
    flushSync();
    expect(value()).toBe('false');
    expect(sw.disabled).toBe(false);
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(sw);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/Switch.svelte.test.ts`
Expected: FAIL — the import of `../../components/ui/Switch.svelte` cannot be resolved.

- [ ] **Step 3: Write the Switch**

Create `frontend/src/components/ui/Switch.svelte`:

```svelte
<script lang="ts">
  // A two-state switch (Slice-6b R16). A native <button type="button"> with
  // role="switch": Space and Enter come from the platform, and it never
  // submits a form or becomes one's default button. The caller writes the
  // visible <label for={id}>; a click on that label clicks the button.
  let {
    checked = $bindable(false),
    id,
    disabled = false,
    frozen = false,
    title = undefined,
    describedby = undefined,
  }: {
    checked?: boolean;
    id: string;
    disabled?: boolean;
    // R19: a request is running. The switch keeps focus and its look, and
    // ignores clicks.
    frozen?: boolean;
    title?: string;
    describedby?: string;
  } = $props();

  function toggle() {
    if (disabled || frozen) return;
    checked = !checked;
  }
</script>

<button
  {id}
  type="button"
  role="switch"
  class="switch"
  class:on={checked}
  aria-checked={checked}
  aria-disabled={frozen ? 'true' : undefined}
  aria-describedby={describedby}
  {disabled}
  {title}
  onclick={toggle}
><span class="knob" aria-hidden="true"></span></button>

<style>
  /* 10k: a 30×17 track with a 13px knob. Focus shows the global ring (base.css). */
  .switch {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    width: 30px;
    height: 17px;
    padding: 2px;
    border: 0;
    border-radius: 9px;
    background: var(--border-strong);
    cursor: pointer;
  }
  .switch.on {
    background: var(--primary);
  }
  .switch:disabled {
    background: var(--border-faint);
    cursor: not-allowed;
  }
  .knob {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--surface);
    transition: transform .12s;
  }
  .switch.on .knob {
    transform: translateX(13px);
  }
</style>
```

- [ ] **Step 4: Run the Switch tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/Switch.svelte.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing New run tests**

In `frontend/src/tests/NewRunModal.svelte.test.ts`:

1. At `:116-126` (changed on purpose, D18), the strip now shows the version id:

```ts
  it('the strip shows the NEWEST published, non-disabled version (not the oldest), as "v. {id}" (D18)', async () => {
    const oldVersion: Version = { id: 88, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false, label: '' } as Version;
    const newVersion: Version = { id: 99, course_id: 1, created_at: '2026-02-01', published_at: '2026-02-02', is_disabled: false, label: '' } as Version;
    // Backend returns versions DESC by created_at — simulate that ordering.
    const { target, cmp } = mountModal({ versions: [newVersion, oldVersion] });
    await settle();
    const versionRow = target.querySelector('.version-row');
    expect(versionRow?.textContent).toMatch(/will use v\. 99/);
    expect(versionRow?.textContent).not.toContain('v. 88');
    unmount(cmp);
  });
```

2. The router only pushes when the target differs from `currentRoute`, and jsdom delivers the `hashchange` from `beforeEach`'s `location.hash = …` in a later macrotask, so `currentRoute` can still hold the previous test's `/teaching/algebra/runs/42` and `navigate()` returns early. Reset it synchronously (as `RunDetailPage.tabs`'s `at()` helper does). Add to the imports:

```ts
import { currentRoute } from '../lib/router.svelte';
```

and in `beforeEach` replace `location.hash = '#/courses/algebra/runs';` with:

```ts
  history.replaceState(null, '', '/courses/algebra/runs');
  Object.assign(currentRoute, { path: '/courses/algebra/runs', search: '', hash: '' });
```

3. After `mountModal`, add helpers:

```ts
function fill(target: HTMLElement, name: string, value: string) {
  const el = target.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function fillValid(target: HTMLElement) {
  fill(target, 'title', 'Spring');
  fill(target, 'start_date', '2026-06-01');
  fill(target, 'end_date', '2026-06-30');
  flushSync();
}
const createBtn = (t: HTMLElement) => t.querySelector('button[data-action="create"]') as HTMLButtonElement;
const input = (t: HTMLElement, name: string) => t.querySelector(`input[name="${name}"]`) as HTMLInputElement;
function created(): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 201,
    json: () => Promise.resolve({ id: 42 }),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
const NO_VERSION = 'No published version — close this modal and publish one first.';
```

4. Append a new `describe` block:

```ts
describe('NewRunModal — on ui/Modal (10k)', () => {
  it('renders inside ui/Modal named "New run"; Title has focus; the backdrop does not close; Cancel, × and Esc do (D11)', async () => {
    const { target, cmp, onClose } = mountModal();
    await settle();
    const dialog = target.querySelector('section.modal-panel[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('New run');
    expect(document.activeElement).toBe(input(target, 'title'));
    target.querySelector<HTMLElement>('.modal-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    target.querySelector<HTMLButtonElement>('button[data-action="cancel"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    target.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount(cmp);
  });

  it('ties each error to its field and focuses the first invalid field (R18)', async () => {
    const { target, cmp } = mountModal();
    await settle();
    fill(target, 'title', 'Spring');
    createBtn(target).click();
    await settle();
    const start = input(target, 'start_date');
    const end = input(target, 'end_date');
    expect(input(target, 'title').hasAttribute('aria-invalid')).toBe(false);
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(start.getAttribute('aria-describedby')!)?.textContent).toBe('Start date is required');
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(end.getAttribute('aria-describedby')!)?.textContent).toBe('End date is required');
    expect(document.activeElement).toBe(start);
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it("clears a field's error when that field is edited", async () => {
    const { target, cmp } = mountModal();
    await settle();
    createBtn(target).click();
    await settle();
    expect(target.textContent).toContain('Title is required');
    fill(target, 'title', 'S');
    flushSync();
    expect(target.textContent).not.toContain('Title is required');
    expect(input(target, 'title').hasAttribute('aria-invalid')).toBe(false);
    expect(target.textContent).toContain('Start date is required');
    unmount(cmp);
  });

  it('the footer Create run sits outside the form and submits it through `form` (R17)', async () => {
    fetchSpy.mockImplementation(created);
    const { target, cmp } = mountModal();
    await settle();
    fillValid(target);
    const btn = createBtn(target);
    const form = target.querySelector('form')!;
    expect(btn.type).toBe('submit');
    expect(btn.getAttribute('form')).toBe(form.id);
    expect(form.contains(btn)).toBe(false);
    btn.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('the Switch sets groups_enabled, never submits, and is named by its label and help', async () => {
    let body: Record<string, unknown> = {};
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return created();
    });
    const { target, cmp } = mountModal();
    await settle();
    fillValid(target);
    const sw = target.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    expect(target.querySelector(`label[for="${sw.id}"]`)?.textContent).toBe('Groups enabled');
    expect(document.getElementById(sw.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Organise students into groups. Locked once the run is published — and mini-projects need it.',
    );
    sw.click();
    flushSync();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(fetchSpy).not.toHaveBeenCalled();
    createBtn(target).click();
    await settle();
    expect(body.groups_enabled).toBe(true);
    unmount(cmp);
  });

  it('the strip reads "will use {label} · v. {id}", with the dot outside the mono id (D18)', async () => {
    const labelled = { ...versions[0], id: 12, label: 'Spring 2026' } as Version;
    const { target, cmp } = mountModal({ versions: [labelled] });
    await settle();
    const row = target.querySelector('.version-row')!;
    expect(row.textContent).toMatch(/will use Spring 2026 · v\. 12/);
    expect(row.querySelector('.mono')?.textContent).toBe('v. 12');
    unmount(cmp);
  });

  it('with no published version the strip says so and Create run is disabled with that title', async () => {
    const draft = { ...versions[0], published_at: null } as Version;
    const { target, cmp } = mountModal({ versions: [draft] });
    await settle();
    expect(target.querySelector('.version-row')?.textContent).toContain(NO_VERSION);
    expect(createBtn(target).disabled).toBe(true);
    expect(createBtn(target).title).toBe(NO_VERSION);
    unmount(cmp);
  });

  it('while creating, Esc, × and Cancel do nothing and the fields are readonly; success closes and navigates once (R19, R20)', async () => {
    let resolve!: (r: Response) => void;
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    const { target, cmp, onClose } = mountModal();
    await settle();
    fillValid(target);
    createBtn(target).click();
    await settle();
    const btn = createBtn(target);
    expect(btn.textContent?.trim()).toBe('Creating…');
    expect(btn.disabled).toBe(false);
    expect(input(target, 'title').readOnly).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    target.querySelector<HTMLButtonElement>('button[data-action="cancel"]')!.click();
    target.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(onClose).not.toHaveBeenCalled();
    const push = vi.spyOn(history, 'pushState');
    resolve(await created());
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/teaching/algebra/runs/42');
    push.mockRestore();
    unmount(cmp);
  });

  it('a second submit while creating — Enter in a field or the busy button — sends one request (R20, Review Focus 1)', async () => {
    let resolve!: (r: Response) => void;
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    const { target, cmp, onClose } = mountModal();
    await settle();
    fillValid(target);
    createBtn(target).click();
    await settle();
    target.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    createBtn(target).click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const push = vi.spyOn(history, 'pushState');
    resolve(await created());
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    push.mockRestore();
    unmount(cmp);
  });

  it('a server error is an alert banner at the top of the body; focus stays on Create run', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'Title already exists in this course' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response));
    const { target, cmp } = mountModal();
    await settle();
    fillValid(target);
    createBtn(target).focus();
    createBtn(target).click();
    await settle();
    const first = target.querySelector('.modal-body')!.firstElementChild!;
    expect(first.getAttribute('role')).toBe('alert');
    expect(first.textContent).toContain('Title already exists');
    expect(document.activeElement).toBe(createBtn(target));
    expect(input(target, 'title').readOnly).toBe(false);
    unmount(cmp);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/NewRunModal.svelte.test.ts`
Expected: FAIL — the strip test (`v2 (2026-02-01)` today) and the ten new tests fail (no `section.modal-panel`, no `data-action="create"`, no switch, …). The first four old tests still pass.

- [ ] **Step 7: Rewrite NewRunModal on Modal**

Replace `frontend/src/components/runs/NewRunModal.svelte` with:

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { createRun } from '../../lib/runs';
  import { navigate } from '../../lib/router.svelte';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
  import Switch from '../ui/Switch.svelte';
  import type { Course, Version } from '../../lib/types';

  let { course, versions, onClose }: {
    course: Course;
    versions: Version[];
    onClose: () => void;
  } = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const formId = `${uid}-form`;
  const fid = (key: string) => `${uid}-${key}`;
  const NO_VERSION = 'No published version — close this modal and publish one first.';

  let title = $state('');
  let start_date = $state('');
  let end_date = $state('');
  let groups_enabled = $state(false);

  type Field = 'title' | 'start_date' | 'end_date';
  const FIELD_ORDER: Field[] = ['title', 'start_date', 'end_date'];
  let errors = $state<Partial<Record<Field, string>>>({});
  let inputEls = $state<Partial<Record<Field, HTMLInputElement>>>({});
  let submitError: string | null = $state(null);
  let submitting = $state(false);

  // The newest published, enabled version: it is pinned at creation (D18
  // shows it as the runs lists do, "v. {id}").
  const pinned = $derived.by(() => {
    const eligible = [...versions]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .filter((v) => v.published_at !== null && !v.is_disabled);
    return eligible.length > 0 ? eligible[eligible.length - 1] : null;
  });

  function validate(): boolean {
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Title is required';
    if (!start_date) next.start_date = 'Start date is required';
    if (!end_date) next.end_date = 'End date is required';
    if (start_date && end_date && end_date < start_date) {
      next.end_date = 'End date must be on or after start date';
    }
    errors = next;
    return Object.keys(next).length === 0;
  }

  function clearError(field: Field) {
    if (errors[field]) errors = { ...errors, [field]: undefined };
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    // R20: Enter in a (readonly) field or the busy button submits again while
    // a create runs; that second submit does nothing.
    if (submitting || pinned === null) return;
    if (!validate()) {
      await tick();
      const first = FIELD_ORDER.find((f) => errors[f]);
      if (first) inputEls[first]?.focus();
      return;
    }
    submitting = true;
    submitError = null;
    try {
      const run = await createRun(course.id, {
        title: title.trim(),
        start_date,
        end_date,
        groups_enabled,
      });
      onClose();
      navigate(`/teaching/${course.slug}/runs/${run.id}`);
    } catch (e) {
      if (e instanceof ApiError) submitError = e.displayMessage;
      else submitError = 'Unable to create run.';
    } finally {
      submitting = false;
    }
  }

  // R19: nothing closes the modal while a create runs.
  function requestClose() {
    if (submitting) return;
    onClose();
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="nr-heading">New run</h2>
{/snippet}

{#snippet foot()}
  <span class="nr-foot-note">The newest published version is pinned at creation and cannot be changed later.</span>
  <Button variant="ghost" data-action="cancel" onclick={requestClose}>Cancel</Button>
  <Button
    variant="primary"
    type="submit"
    form={formId}
    data-action="create"
    loading={submitting}
    disabled={!submitting && pinned === null}
    title={!submitting && pinned === null ? NO_VERSION : undefined}
  >{submitting ? 'Creating…' : 'Create run'}</Button>
{/snippet}

<Modal
  labelledby={titleId}
  width={620}
  onRequestClose={requestClose}
  closeDisabled={submitting}
  header={head}
  footer={foot}
>
  {#if submitError}
    <p class="nr-banner" role="alert">{submitError}</p>
  {/if}
  <form id={formId} class="nr-form" onsubmit={submit}>
    <div class="nr-field">
      <label class="nr-label" for={fid('title')}>Title</label>
      <input
        id={fid('title')}
        class="nr-input"
        class:nr-invalid={!!errors.title}
        name="title"
        maxlength="200"
        data-autofocus
        readonly={submitting}
        aria-invalid={errors.title ? 'true' : undefined}
        aria-describedby={errors.title ? fid('title-err') : undefined}
        bind:value={title}
        bind:this={inputEls.title}
        oninput={() => clearError('title')}
      />
      {#if errors.title}<span class="nr-err" id={fid('title-err')}>{errors.title}</span>{/if}
    </div>
    <div class="nr-dates">
      <div class="nr-field">
        <label class="nr-label" for={fid('start')}>Start date</label>
        <input
          id={fid('start')}
          class="nr-input mono"
          class:nr-invalid={!!errors.start_date}
          type="date"
          name="start_date"
          readonly={submitting}
          aria-invalid={errors.start_date ? 'true' : undefined}
          aria-describedby={errors.start_date ? fid('start-err') : undefined}
          bind:value={start_date}
          bind:this={inputEls.start_date}
          oninput={() => clearError('start_date')}
        />
        {#if errors.start_date}<span class="nr-err" id={fid('start-err')}>{errors.start_date}</span>{/if}
      </div>
      <div class="nr-field">
        <label class="nr-label" for={fid('end')}>End date</label>
        <input
          id={fid('end')}
          class="nr-input mono"
          class:nr-invalid={!!errors.end_date}
          type="date"
          name="end_date"
          readonly={submitting}
          aria-invalid={errors.end_date ? 'true' : undefined}
          aria-describedby={errors.end_date ? fid('end-err') : undefined}
          bind:value={end_date}
          bind:this={inputEls.end_date}
          oninput={() => clearError('end_date')}
        />
        {#if errors.end_date}<span class="nr-err" id={fid('end-err')}>{errors.end_date}</span>{/if}
      </div>
    </div>
    <div class="nr-switch-row">
      <Switch id={fid('groups')} bind:checked={groups_enabled} frozen={submitting} describedby={fid('groups-help')} />
      <div class="nr-switch-text">
        <label class="nr-switch-label" for={fid('groups')}>Groups enabled</label>
        <span class="nr-help" id={fid('groups-help')}>Organise students into groups. Locked once the run is published — and mini-projects need it.</span>
      </div>
    </div>
    <p class="nr-strip version-row">
      <span class="nr-strip-key">Version</span>
      {#if pinned}
        <span class="nr-strip-val" title={pinned.label ? `will use ${pinned.label} · v. ${pinned.id}` : undefined}>will use {#if pinned.label}{pinned.label}{' '}·{' '}{/if}<span class="nr-ver mono">v. {pinned.id}</span></span>
      {:else}
        <span class="nr-strip-val">{NO_VERSION}</span>
      {/if}
    </p>
  </form>
</Modal>

<style>
  /* The × sits at the right edge of the header. */
  .nr-heading { margin-right: auto; font-size: 15px; font-weight: 600; color: var(--text); }
  .nr-banner {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .nr-form { display: flex; flex-direction: column; gap: 12px; margin: 0; }
  .nr-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .nr-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-3);
  }
  .nr-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    font-size: var(--control-font);
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .nr-invalid {
    border-color: var(--danger);
  }
  .nr-err {
    font-size: 12px;
    color: var(--danger);
  }
  .nr-dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .nr-switch-row { display: flex; align-items: flex-start; gap: 11px; }
  .nr-switch-text { display: flex; flex-direction: column; gap: 2px; }
  .nr-switch-label { font-size: 13px; color: var(--text); cursor: pointer; }
  .nr-help {
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }
  .nr-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 9px 11px;
    background: var(--surface-2);
    border-radius: var(--radius);
    font-size: 12.5px;
  }
  .nr-strip-key { color: var(--muted); }
  .nr-strip-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .nr-ver {
    font-size: 11.5px;
    color: var(--muted);
  }
  .nr-foot-note {
    flex: 1;
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
```

- [ ] **Step 8: Run the New run tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/NewRunModal.svelte.test.ts src/tests/Switch.svelte.test.ts`
Expected: PASS (15 New run tests, 6 Switch tests). The four old New run tests still dispatch `submit` on the one `<form>`.

- [ ] **Step 9: Gate rows**

In section (ak) of `frontend/scripts/visual-refresh-gate.sh`, extend the list:

```zsh
FILES_6B=(
  src/components/runs/PublishConflictsModal.svelte
  src/components/runs/NewRunModal.svelte src/components/ui/Switch.svelte
)
```

and append after the PublishConflictsModal block:

```zsh
srcw runs/NewRunModal.svelte 620
own switch Switch.svelte
uniq1 switch
if [[ -n $REPLY ]]; then
  N=Switch; H=$REPLY
  d '\.switch' '' 'width:30px' 'height:17px' 'padding:2px' 'border-radius:9px' 'background:var\(--border-strong\)'
  d '\.switch\.on' '' 'background:var\(--primary\)'
  d '\.switch' ':disabled' 'background:var\(--border-faint\)'
  d '\.knob' '' 'width:13px' 'height:13px' 'border-radius:50%' 'background:var\(--surface\)'
  # esbuild minifies translateX(x) to translate(x) (translateY stays as written).
  chk "\.switch\.on\.${H} \.knob:where\(\.${H}\)" 'transform:translate\(13px\)'
  sweep Switch $H
fi
own nr-strip NewRunModal.svelte
uniq1 nr-strip
if [[ -n $REPLY ]]; then
  N=NewRunModal; H=$REPLY
  d '\.nr-label' '' 'font-size:12\.5px' 'font-weight:500' 'color:var\(--text-3\)'
  d '\.nr-input' '' 'height:var\(--control-h\)' 'border:1px solid var\(--border-strong\)'
  d '\.nr-invalid' '' 'border-color:var\(--danger\)'
  d '\.nr-err' '' 'font-size:12px' 'color:var\(--danger\)'
  d '\.nr-dates' '' 'display:grid' 'grid-template-columns:1fr 1fr' 'gap:14px'
  d '\.nr-help' '' 'font-size:12px' 'color:var\(--muted\)'
  d '\.nr-strip' '' 'padding:9px 11px' 'background:var\(--surface-2\)' 'border-radius:var\(--radius\)'
  d '\.nr-ver' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.nr-banner' '' 'background:var\(--status-rejected-bg\)' 'border-left:3px solid var\(--danger\)'
  d '\.nr-foot-note' '' 'flex:1' 'color:var\(--muted\)'
  sweep NewRunModal $H
fi
```

Set `EXPECTED_CHECKS=1697` (1654 + 43: srcw 1; Switch own/uniq1 2 + 12 declarations + sweep 2 = 16; New run own/uniq1 2 + 22 declarations + sweep 2 = 26). The emoji and colour scans still print one line each.

- [ ] **Step 10: Run the full checks**

As Global Constraints › Commands. Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (1697 checks)`.

- [ ] **Step 11: Screenshots for the user**

Open `http://localhost:5174/teaching/demo-course` (dev@ is a course admin), click + New run. Screenshot at 1280 and 1000: (a) empty, Title focused; (b) Title filled, End date before Start date, Create run clicked — the field error; (c) Groups enabled switched on. Mock `**/api/courses/*/runs` (POST) → status 500 `{"detail":"Mock error for the screenshot"}` and click Create run for (d) the banner. Never let a real create through. Overlay with 10k beside the shots; wait for the user's OK. Clear the routes.

- [ ] **Step 12: Review lanes**

Opus (high) + Fable on the uncommitted diff (including the new files). Fix Critical/Important, re-run after every fix until clean. Minors → backlog "## Task 2 — New run and Switch".

- [ ] **Step 13: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/ui/Switch.svelte frontend/src/components/runs/NewRunModal.svelte \
  frontend/scripts/visual-refresh-gate.sh frontend/src/tests/support/SwitchHarness.svelte \
  frontend/src/tests/Switch.svelte.test.ts frontend/src/tests/NewRunModal.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6b): New run on ui/Modal (10k) with the shared Switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Add `docs/backlog/slice6b-teacher-modals-debt.md` to the `git add` if the lanes left minors. Then the ledger line, memory, and wait for "go".

---

### Task 3: Import roster on Modal (10f / 10g)

**Files:**
- Modify (rewrite): `frontend/src/components/runs/RosterImportModal.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (ak), the (aa) comment at `:4074`, `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/RosterImportModal.scaffold.svelte.test.ts`, `frontend/src/tests/RosterImportModal.submit.svelte.test.ts`, `frontend/src/tests/RosterImportModal.already-active.svelte.test.ts` (`RosterImportModal.unpublished.svelte.test.ts` keeps passing unchanged)

**Interfaces:**
- Consumes: `Button` (`aria-describedby`, bindable `element`), `Modal` (`maxHeight`, `closeDisabled`), `pushToast(message, kind)` from `stores/toasts.svelte`, gate `FILES_6B` / `srcw`.
- Produces: no new API. Props unchanged (`runId`, `existingRoster`, `existingGroups`, `onRefetchBeforeSubmit`, `onClose`); `RunDetailPage.svelte:445-451` is untouched. Test hooks kept: `textarea` (the paste box), `button[data-action="import|cancel|done|copy-failed"]`, `p.error` (parse error, no role) and `p.error[role="alert"]` (submit error), `table.result`, `span.badge.badge-error[data-result="error"]` (title = the Detail text), `.error-detail` (now on every failed row), `textarea.copy-fallback`.

- [ ] **Step 1: Write the failing paste-stage tests**

In `frontend/src/tests/RosterImportModal.scaffold.svelte.test.ts`:

1. `:46` (changed on purpose, drawn copy):

```ts
    expect(target.textContent).toContain('Will create groups: G1.');
```

2. `:87-99` (changed on purpose, D23 — the paste names a group, so the seven enrolled rows are real moves):

```ts
  it('truncates the re-bucketed list with +N more', async () => {
    const roster = Array.from({ length: 7 }, (_, i) => ({ user_id: i+1, user_email: `e${i+1}@x.com`, user_full_name: '', group_id: null }));
    const csv = roster.map((r) => `${r.user_email},G1`).join('\n');
    const { target, cmp } = mountModal({ existingRoster: roster });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = csv;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    expect(target.textContent).toMatch(/Already enrolled, will be re-bucketed: e1@x\.com, e2@x\.com, e3@x\.com, e4@x\.com, e5@x\.com, \+2 more\./);
    unmount(cmp);
  });
```

3. Add a paste helper after `mountModal`:

```ts
function paste(target: HTMLElement, text: string) {
  const ta = target.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(210);
  flushSync();
}
```

4. Append a new `describe` block:

```ts
describe('RosterImportModal — paste stage on ui/Modal (10f)', () => {
  it('renders inside ui/Modal; a backdrop click does not close (D11); Esc does (D16)', async () => {
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onClose });
    await settle();
    const dialog = target.querySelector('section.modal-panel[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Import roster from CSV');
    target.querySelector<HTMLElement>('.modal-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    // Paste stage: Esc closes at once, with no prompt (D16).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('the step marker: Paste is the current step, Result is not', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const steps = Array.from(target.querySelectorAll('header.modal-head ol > li'));
    expect(steps.map((s) => s.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['1 Paste', '2 Result']);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(steps[1].hasAttribute('aria-current')).toBe(false);
    unmount(cmp);
  });

  it('the paste box is named and described by the drawn help', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea')!;
    expect(ta.getAttribute('aria-label')).toBe('Rows to import');
    expect(document.getElementById(ta.getAttribute('aria-describedby')!)?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "Paste rows from Excel or Google Sheets, tab or comma separated. Columns: name optional, email required, group optional — a group that doesn't exist yet is created.",
    );
    unmount(cmp);
  });

  it('a skipping row shows its reasons as text and in its tile; the status column has a hidden header (D20, R24)', async () => {
    const { target, cmp } = mountModal();
    await settle();
    paste(target, 'a@x.com\nbad');
    const rows = target.querySelectorAll('table.preview tbody tr');
    const ok = rows[0].querySelector('[role="img"]')!;
    expect(ok.getAttribute('aria-label')).toBe('Valid');
    expect(ok.getAttribute('title')).toBe('Valid');
    const skip = rows[1].querySelector('[role="img"]')!;
    expect(skip.getAttribute('aria-label')).toBe('Will skip');
    expect(skip.getAttribute('title')).toBe('Invalid email format');
    expect(rows[1].querySelector('.ri-why')?.textContent).toBe('Invalid email format');
    expect(rows[0].querySelector('.ri-why')).toBeNull();
    expect(target.querySelector('table.preview thead th:last-child')?.textContent?.trim()).toBe('Status');
    unmount(cmp);
  });

  it('"Showing the first 10 of N rows." appears only above 10 rows (D17)', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const emails = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}@x.com`).join('\n');
    paste(target, emails(10));
    expect(target.textContent).not.toContain('Showing the first');
    paste(target, emails(12));
    expect(target.textContent).toContain('Showing the first 10 of 12 rows.');
    expect(target.textContent).not.toContain('will skip.');
    expect(target.querySelectorAll('table.preview tbody tr').length).toBe(10);
    unmount(cmp);
  });

  it('names skipped rows past the first 10, cut after 5 (D22, P7), singular at one', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const ten = Array.from({ length: 10 }, (_, i) => `s${i + 1}@x.com`);
    paste(target, [...ten, 'bad11'].join('\n'));
    expect(target.textContent).toContain('Showing the first 10 of 11 rows. Row 11 will skip.');
    paste(target, [...ten, 'bad11', 'bad12', 'bad13', 'bad14', 'bad15', 'bad16', 'bad17', 's18@x.com'].join('\n'));
    expect(target.textContent).toContain('Showing the first 10 of 18 rows. Rows 11, 12, 13, 14, 15, +2 more will skip.');
    unmount(cmp);
  });

  it('counts take their singular at one, with the drawn wording', async () => {
    const { target, cmp } = mountModal();
    await settle();
    paste(target, 'a@x.com');
    expect(target.textContent).toContain('1 row — 1 valid, 0 will skip (0 invalid, 0 duplicate in paste).');
    expect(target.querySelector('button[data-action="import"]')?.textContent?.trim()).toBe('Import 1 valid row');
    paste(target, 'a@x.com\nb@x.com');
    expect(target.textContent).toContain('2 rows — 2 valid, 0 will skip (0 invalid, 0 duplicate in paste).');
    expect(target.querySelector('button[data-action="import"]')?.textContent?.trim()).toBe('Import 2 valid rows');
    unmount(cmp);
  });

  it('Import is disabled with its reason while nothing valid is pasted', async () => {
    const { target, cmp } = mountModal();
    await settle();
    const btn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('No valid rows to import');
    unmount(cmp);
  });

  it('the re-bucketed line lists only real moves, matching e-mails case-blind (D23, Review Focus 2)', async () => {
    const roster = [
      { user_id: 1, user_email: 'a@x.com', user_full_name: '', group_id: 1 },
      { user_id: 2, user_email: 'b@x.com', user_full_name: '', group_id: 1 },
      { user_id: 3, user_email: 'c@x.com', user_full_name: '', group_id: 1 },
      { user_id: 4, user_email: 'Dee@X.com', user_full_name: '', group_id: 2 },
    ];
    const groups = [
      { id: 1, run_id: 10, name: 'G1', is_disabled: false, student_count: 3 },
      { id: 2, run_id: 10, name: 'G2', is_disabled: false, student_count: 1 },
    ];
    const { target, cmp } = mountModal({ existingRoster: roster, existingGroups: groups });
    await settle();
    // a: same group (no move); b: empty group cell (keeps G1, no move);
    // c: G1 → G2 (move); dee: G2 → G1, roster e-mail in another case (move).
    paste(target, 'a@x.com,G1\nb@x.com\nc@x.com,G2\ndee@x.com,G1');
    expect(target.textContent).toContain('Already enrolled, will be re-bucketed: c@x.com, dee@x.com.');
    paste(target, 'a@x.com,G1\nb@x.com');
    expect(target.textContent).not.toContain('Already enrolled');
    unmount(cmp);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RosterImportModal.scaffold.svelte.test.ts`
Expected: FAIL — the two changed tests and the nine new tests fail. The six untouched old tests pass.

- [ ] **Step 3: Write the failing result-stage tests**

In `frontend/src/tests/RosterImportModal.submit.svelte.test.ts`:

1. Import the toast store at the top:

```ts
import { toasts, clearToasts } from '../stores/toasts.svelte';
```

and add `clearToasts();` to `beforeEach`.

2. Replace `:90-107` (changed on purpose, R20):

```ts
  it('Import and Cancel ignore clicks while importing; the busy Import keeps focus (R20)', async () => {
    // The refetch never settles: the import stays in flight for the whole test.
    const refetch = vi.fn(() => new Promise(() => {}));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    const importBtn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    importBtn.focus();
    importBtn.click();
    flushSync();
    expect(importBtn.disabled).toBe(false);
    expect(importBtn.textContent?.trim()).toBe('Importing…');
    expect(document.activeElement).toBe(importBtn);
    expect(ta.readOnly).toBe(true);
    importBtn.click();
    (target.querySelector('button[data-action="cancel"]') as HTMLButtonElement).click();
    flushSync();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });
```

3. Replace `:283-310` (changed on purpose, D11):

```ts
  it('Stage 2 backdrop click leaves the modal open (D11)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
    ] }));
    const refetch = vi.fn().mockResolvedValue({
      students: [student({ group_id: 99 })],
      groups: [group({ name: 'Alpha' })],
    });
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(target.querySelector('table.result')).toBeTruthy();
    const backdrop = target.querySelector('.modal-backdrop') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });
```

4. Add a helper after `mountModal` (it drives paste → import with a given batch response):

```ts
async function importWith(target: HTMLElement, text: string) {
  const ta = target.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(210);
  flushSync();
  (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
  vi.useRealTimers();
  await settle();
}
const toastTexts = () => toasts.list.map((t) => t.message);
```

5. Append a new `describe` block:

```ts
describe('RosterImportModal — a failed import (R20)', () => {
  it('shows the error as an alert and leaves focus on Import', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Run is not published' }, 409));
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    const importBtn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    importBtn.focus();
    importBtn.click();
    vi.useRealTimers();
    await settle();
    expect(target.querySelector('p.error[role="alert"]')?.textContent).toContain('Run is not published');
    expect(importBtn.disabled).toBe(false);
    expect(document.activeElement).toBe(importBtn);
    unmount(cmp);
  });
});

describe('RosterImportModal — result stage (10g)', () => {
  it('focus moves to Done on the stage switch; Done is described by the summary; the marker moves', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added', group_id: 99 },
      { email: 'b@x.com', status: 'error', detail: 'Run is full', error_code: 'capacity_reached' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'a@x.com\nb@x.com');
    const done = target.querySelector('button[data-action="done"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(done);
    const summary = document.getElementById(done.getAttribute('aria-describedby')!);
    expect(summary?.textContent).toBe('1 added, 1 failed.');
    const steps = Array.from(target.querySelectorAll('header.modal-head ol > li'));
    expect(steps[0].hasAttribute('aria-current')).toBe(false);
    expect(steps[0].textContent).toContain('(done)');
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(target.querySelector('.modal-foot')?.textContent).toContain('Failed rows can be copied as text and fixed in your sheet.');
    unmount(cmp);
  });

  it('Detail: each failed row shows the server text, "Not added" without one, and maps "internal error" (R25)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'e1@x.com', status: 'error', error_code: 'capacity_reached', detail: 'Run is full' },
      { email: 'e2@x.com', status: 'error', error_code: 'not_in_run' },
      { email: 'e3@x.com', status: 'error', error_code: 'internal_error', detail: 'internal error' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'e1@x.com');
    const details = Array.from(target.querySelectorAll('table.result tbody tr .error-detail')).map((d) => d.textContent);
    expect(details).toEqual(['Run is full', 'Not added', 'Server error — try again']);
    expect(target.querySelector('table.result tbody tr .error-detail')?.getAttribute('title')).toBe('Run is full');
    unmount(cmp);
  });

  it('Detail: "re-bucketed from …" only for a student whose group changed (D15, P9, Review Focus 2)', async () => {
    const refetch = vi.fn().mockResolvedValue({
      students: [
        student({ id: 1, user_id: 1, user_email: 'x1@x.com', group_id: 1 }),
        student({ id: 2, user_id: 2, user_email: 'Ann@X.com', group_id: 1 }),
        student({ id: 3, user_id: 3, user_email: 'x3@x.com', group_id: null }),
      ],
      groups: [group({ id: 1, name: 'Alpha' }), group({ id: 2, name: 'Beta' })],
    });
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'x1@x.com', status: 'added', group_id: 1 },
      { email: 'ann@x.com', status: 'added', group_id: 2 },
      { email: 'x3@x.com', status: 'added', group_id: 2 },
      { email: 'new@x.com', status: 'added', group_id: 2 },
      { email: 'nogroup@x.com', status: 'added' },
    ] }));
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch });
    await settle();
    await importWith(target, 'x1@x.com');
    const cells = Array.from(target.querySelectorAll('table.result tbody tr')).map(
      (tr) => tr.querySelector('td:last-child')?.textContent?.trim(),
    );
    expect(cells).toEqual(['', 're-bucketed from Alpha', 're-bucketed from no group', '', '']);
    unmount(cmp);
  });

  it('Done runs once: a second Done or Esc while its refetch runs does nothing; then it closes', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [{ email: 'a@x.com', status: 'added' }] }));
    let resolveDone!: (v: unknown) => void;
    const refetch = vi.fn()
      .mockResolvedValueOnce({ students: [], groups: [] })
      .mockImplementationOnce(() => new Promise((r) => { resolveDone = r; }));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    await importWith(target, 'a@x.com');
    const done = target.querySelector('button[data-action="done"]') as HTMLButtonElement;
    done.click();
    done.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await settle();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect((target.querySelector('header.modal-head button[aria-label="Close"]') as HTMLButtonElement).disabled).toBe(true);
    resolveDone({ students: [], groups: [] });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('a failed refetch on Done still closes, with a toast', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [{ email: 'a@x.com', status: 'added' }] }));
    const refetch = vi.fn()
      .mockResolvedValueOnce({ students: [], groups: [] })
      .mockRejectedValueOnce(new Error('network down'));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    await importWith(target, 'a@x.com');
    (target.querySelector('button[data-action="done"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastTexts()).toContain('Roster refresh failed — reload to see the latest.');
    unmount(cmp);
  });

  it('a successful copy toasts "Copied 1 row" in the singular', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'a@x.com\nbad@x.com');
    (target.querySelector('button[data-action="copy-failed"]') as HTMLButtonElement).click();
    await settle();
    expect(toastTexts()).toContain('Copied 1 row');
    unmount(cmp);
  });

  it('the copy fallback takes focus and selects its text (P10: it is named)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
      configurable: true,
    });
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'bad@x.com');
    (target.querySelector('button[data-action="copy-failed"]') as HTMLButtonElement).click();
    await settle();
    const fallback = target.querySelector('textarea.copy-fallback') as HTMLTextAreaElement;
    expect(fallback.getAttribute('aria-label')).toBe('Failed rows');
    expect(document.activeElement).toBe(fallback);
    expect(fallback.selectionStart).toBe(0);
    expect(fallback.selectionEnd).toBe(fallback.value.length);
    unmount(cmp);
  });
});
```

In `frontend/src/tests/RosterImportModal.already-active.svelte.test.ts`, replace Test 2 (`:107-131`, changed on purpose, R25 — every error code shows its detail):

```ts
  it('Test 2: other error_code shows its detail inline too, and keeps it as the chip title', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      {
        email: 'a@x.com',
        status: 'error',
        // Valid BulkRosterErrorCode union member (types.ts:347-351).
        error_code: 'capacity_reached',
        detail: 'something else',
      },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await pasteAndImport(target, 'a@x.com');

    const badge = target.querySelector('span.badge.badge-error[data-result="error"]');
    if (!badge) throw new Error('badge.badge-error not found');
    expect(badge.getAttribute('title')).toBe('something else');
    expect(target.querySelector('.error-detail')?.textContent?.trim()).toBe('something else');

    unmount(cmp);
  });
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RosterImportModal.submit.svelte.test.ts src/tests/RosterImportModal.already-active.svelte.test.ts`
Expected: FAIL — the two changed submit tests, the seven new result tests and already-active Test 2 fail. The new failed-import test passes already: it guards R20 through the rewrite. The other old tests pass.

- [ ] **Step 5: Rewrite RosterImportModal on Modal**

Replace `frontend/src/components/runs/RosterImportModal.svelte` with:

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { parseCsv } from '../../lib/csv';
  import type { CsvParseResult } from '../../lib/csv';
  import { ApiError } from '../../lib/api';
  import { batchAddRunStudents } from '../../lib/runRoster';
  import { buildBatchRow } from '../../lib/buildBatchRow';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
  import type {
    GroupResponse, RunStudentResponse, RunStudentBatchResultRow,
  } from '../../lib/types';

  let {
    runId, existingRoster, existingGroups,
    onRefetchBeforeSubmit, onClose,
  }: {
    runId: number;
    existingRoster: RunStudentResponse[];
    existingGroups: GroupResponse[];
    onRefetchBeforeSubmit: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onClose: () => void;
  } = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const helpId = `${uid}-help`;
  const summaryId = `${uid}-summary`;
  const PREVIEW_ROWS = 10;

  let text = $state('');
  let parsed = $state<CsvParseResult | null>(null);
  let parseTimer: ReturnType<typeof setTimeout> | null = null;
  let submitError = $state<string | null>(null);

  type Stage = 'paste' | 'result';
  let stage = $state<Stage>('paste');
  let submitting = $state(false);
  // Done's refetch is running: Done, ×, Esc and Copy wait (spec §Import › Fixes).
  let closing = $state(false);
  let resultRows = $state<RunStudentBatchResultRow[] | null>(null);
  // The roster and groups onRefetchBeforeSubmit returned for this import: the
  // "before" side of D15's re-bucketed Detail.
  let rosterAtSubmit: RunStudentResponse[] = [];
  let groupsAtSubmit: GroupResponse[] = [];
  let copyFallbackVisible = $state(false);
  let copyFallbackText = $state('');
  let doneEl = $state<HTMLButtonElement>();
  let copyFallbackEl = $state<HTMLTextAreaElement>();

  // Cancel any pending debounced parse on unmount so it can't fire and update
  // state after the component is gone.
  $effect(() => () => {
    if (parseTimer) clearTimeout(parseTimer);
  });

  function onTextInput(event: Event) {
    text = (event.currentTarget as HTMLTextAreaElement).value;
    submitError = null;
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      parsed = parseCsv(text, existingGroups.map((g) => g.name), existingRoster.map((r) => r.user_email));
    }, 200);
  }

  const validCount = $derived(parsed && parsed.ok ? parsed.validCount : 0);

  // D23: an enrolled student moves only when their pasted group names a group
  // other than their current one. Matched as the import matches: e-mails
  // lower-cased (parseCsv already lower-cases the paste), group names exactly
  // after parseCsv's trim. csv.ts's alreadyEnrolled keeps its wider meaning:
  // buildBatchRow resends the current group for an empty group cell.
  const realMoves = $derived.by((): string[] => {
    if (!parsed || !parsed.ok) return [];
    const groupIdByEmail = new Map(existingRoster.map((s) => [s.user_email.toLowerCase(), s.group_id]));
    const nameById = new Map(existingGroups.map((g) => [g.id, g.name]));
    const moves = new Set<string>();
    for (const row of parsed.rows) {
      if (!row.valid || !row.alreadyEnrolled || !row.parsed.group) continue;
      const gid = groupIdByEmail.get(row.parsed.email);
      const current = gid == null ? null : (nameById.get(gid) ?? null);
      if (current !== row.parsed.group) moves.add(row.parsed.email);
    }
    // In paste order, as the teacher pasted them.
    return [...moves];
  });

  // D22: skipped rows the 10-row preview does not show.
  const hiddenSkips = $derived(
    parsed && parsed.ok ? parsed.rows.slice(PREVIEW_ROWS).filter((r) => !r.valid).map((r) => r.rowIndex) : [],
  );

  function firstFive(list: (string | number)[]): string {
    if (list.length <= 5) return list.join(', ');
    return `${list.slice(0, 5).join(', ')}, +${list.length - 5} more`;
  }

  function skipLine(rows: number[]): string {
    return rows.length === 1 ? `Row ${rows[0]} will skip.` : `Rows ${firstFive(rows)} will skip.`;
  }

  async function onImport() {
    if (!parsed || !parsed.ok || parsed.validCount === 0 || submitting) return;
    submitError = null;
    // Snapshot parsed BEFORE the first await so a concurrent textarea edit
    // during in-flight submit can't mutate which rows we submit.
    const snapshot = parsed;
    // Cancel any pending debounce so it can't overwrite `parsed` mid-submit.
    if (parseTimer) { clearTimeout(parseTimer); parseTimer = null; }
    submitting = true;
    let switched = false;
    try {
      const fresh = await onRefetchBeforeSubmit();
      const rows = snapshot.rows
        .filter((r) => r.valid)
        .map((r) => buildBatchRow(r, fresh.students, fresh.groups));
      const response = await batchAddRunStudents(runId, rows);
      rosterAtSubmit = fresh.students;
      groupsAtSubmit = fresh.groups;
      resultRows = response.results;
      stage = 'result';
      switched = true;
    } catch (e) {
      // Surface submit-step errors via the separate submitError slot, NOT via
      // parsed.error (the client-side CSV parse-error channel).
      if (e instanceof ApiError) {
        submitError = e.displayMessage;
      } else {
        submitError = 'Import failed — please retry.';
        console.error(e);
      }
    } finally {
      submitting = false;
    }
    // The focused Import unmounted with the paste stage: Done takes focus.
    if (switched) {
      await tick();
      doneEl?.focus();
    }
  }

  // D15 / R25 / P9: what the Detail column says for one result row.
  function detailFor(r: RunStudentBatchResultRow): string {
    if (r.status === 'error') {
      if (!r.detail) return 'Not added';
      return r.detail === 'internal error' ? 'Server error — try again' : r.detail;
    }
    if (r.group_id === undefined) return '';
    const email = r.email.toLowerCase();
    const before = rosterAtSubmit.find((s) => s.user_email.toLowerCase() === email);
    if (!before || before.group_id === r.group_id) return '';
    if (before.group_id === null) return 're-bucketed from no group';
    const old = groupsAtSubmit.find((g) => g.id === before.group_id);
    return old ? `re-bucketed from ${old.name}` : '';
  }

  const added = $derived(resultRows ? resultRows.filter((r) => r.status === 'added').length : 0);
  const failed = $derived(resultRows ? resultRows.filter((r) => r.status === 'error').length : 0);

  function failedRowsAsText(): string {
    if (!resultRows) return '';
    return resultRows
      .filter((r) => r.status === 'error')
      .map((r) => `${r.email}\t${r.detail ?? ''}`)
      .join('\n');
  }

  async function onCopyFailed() {
    if (closing) return;
    const payload = failedRowsAsText();
    try {
      await navigator.clipboard.writeText(payload);
      pushToast(failed === 1 ? 'Copied 1 row' : `Copied ${failed} rows`, 'success');
    } catch {
      copyFallbackText = payload;
      copyFallbackVisible = true;
      await tick();
      copyFallbackEl?.focus();
      copyFallbackEl?.select();
    }
  }

  async function onDone() {
    if (closing) return;
    closing = true;
    try {
      await onRefetchBeforeSubmit();
    } catch {
      pushToast('Roster refresh failed — reload to see the latest.', 'error');
    } finally {
      onClose();
    }
  }

  function onCancel() {
    if (submitting) return;
    onClose();
  }

  function closeForCurrentStage() {
    if (submitting || closing) return;
    if (stage === 'paste') onClose();
    else void onDone();
  }
</script>

{#snippet check(size: number)}
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3.4,8.4 6.6,11.6 12.6,4.8" /></svg>
{/snippet}

{#snippet cross()}
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" /></svg>
{/snippet}

{#snippet head()}
  <h2 id={titleId} class="ri-heading">Import roster from CSV</h2>
  <ol class="ri-steps">
    <li class="ri-step" class:ri-current={stage === 'paste'} aria-current={stage === 'paste' ? 'step' : undefined}>
      {#if stage === 'paste'}
        <span class="ri-dot ri-dot-on mono">1</span>
      {:else}
        <span class="ri-dot ri-dot-done">{@render check(10)}</span>
      {/if}
      <span>Paste</span>{#if stage === 'result'}<span class="vh"> (done)</span>{/if}
    </li>
    <li class="ri-step" class:ri-current={stage === 'result'} aria-current={stage === 'result' ? 'step' : undefined}>
      <span class="ri-rule" class:ri-rule-done={stage === 'result'} aria-hidden="true"></span>
      <span class="ri-dot mono" class:ri-dot-on={stage === 'result'}>2</span>
      <span>Result</span>
    </li>
  </ol>
{/snippet}

{#snippet foot()}
  {#if stage === 'paste'}
    <span class="ri-foot-note">Invalid rows are skipped, never guessed at.</span>
    <Button variant="ghost" data-action="cancel" onclick={onCancel}>Cancel</Button>
    <Button
      variant="primary"
      data-action="import"
      loading={submitting}
      disabled={!submitting && validCount === 0}
      title={!submitting && validCount === 0 ? 'No valid rows to import' : undefined}
      onclick={() => void onImport()}
    >{submitting ? 'Importing…' : validCount === 1 ? 'Import 1 valid row' : `Import ${validCount} valid rows`}</Button>
  {:else}
    <span class="ri-foot-note">{failed > 0 ? 'Failed rows can be copied as text and fixed in your sheet.' : ''}</span>
    {#if failed > 0}
      <Button variant="secondary" data-action="copy-failed" onclick={() => void onCopyFailed()}>Copy failed rows</Button>
    {/if}
    <Button variant="primary" data-action="done" aria-describedby={summaryId} bind:element={doneEl} onclick={() => void onDone()}>Done</Button>
  {/if}
{/snippet}

<Modal
  labelledby={titleId}
  width={760}
  maxHeight={720}
  onRequestClose={closeForCurrentStage}
  closeDisabled={submitting || closing}
  header={head}
  footer={foot}
>
  {#if stage === 'paste'}
    <p class="ri-help" id={helpId}>Paste rows from Excel or Google Sheets, tab or comma separated. Columns: <code class="ri-col">name</code> optional, <code class="ri-col">email</code> required, <code class="ri-col">group</code> optional — a group that doesn't exist yet is created.</p>

    <textarea
      class="ri-paste"
      rows="7"
      aria-label="Rows to import"
      aria-describedby={helpId}
      data-autofocus
      readonly={submitting}
      value={text}
      oninput={onTextInput}
    ></textarea>

    {#if parsed && parsed.ok}
      <div class="ri-card">
        <table class="ri-table preview">
          <thead>
            <tr>
              <th scope="col" class="ri-num">#</th>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col" class="ri-group">Group</th>
              <th scope="col" class="ri-tile-col"><span class="vh">Status</span></th>
            </tr>
          </thead>
          <tbody>
            {#each parsed.rows.slice(0, PREVIEW_ROWS) as row (row.rowIndex)}
              {@const why = row.errors.join('; ')}
              <tr>
                <td class="ri-num mono">{row.rowIndex}</td>
                <td><span class="ri-line" title={row.parsed.name ?? undefined}>{#if row.parsed.name}{row.parsed.name}{:else}<span class="ri-none">—</span>{/if}</span></td>
                <td>
                  <span class="ri-line mono" title={row.parsed.email || undefined}>{#if row.parsed.email}{row.parsed.email}{:else}<span class="ri-none">—</span>{/if}</span>
                  {#if !row.valid}<span class="ri-why">{why}</span>{/if}
                </td>
                <td><span class="ri-line" title={row.parsed.group ?? undefined}>{#if row.parsed.group}{row.parsed.group}{:else}<span class="ri-none">—</span>{/if}</span></td>
                <td class="ri-tile-col">
                  {#if row.valid}
                    <span class="ri-tile ri-ok" role="img" aria-label="Valid" title="Valid">{@render check(11)}</span>
                  {:else}
                    <span class="ri-tile ri-skip" role="img" aria-label="Will skip" title={why}>{@render cross()}</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="ri-counts">
        {#if parsed.rows.length > PREVIEW_ROWS}
          <p>Showing the first {PREVIEW_ROWS} of {parsed.rows.length} rows.{#if hiddenSkips.length > 0}{' '}{skipLine(hiddenSkips)}{/if}</p>
        {/if}
        <p>
          {parsed.rows.length === 1 ? '1 row' : `${parsed.rows.length} rows`} — <span class="ri-key">{parsed.validCount} valid</span>,
          {parsed.invalidCount} will skip ({parsed.invalidCount - parsed.duplicateInPasteCount} invalid,
          {parsed.duplicateInPasteCount} duplicate in paste).
        </p>
        {#if parsed.willCreateGroups.length > 0}
          <p>Will create groups: {#each parsed.willCreateGroups as g, i (g)}{#if i > 0}, {/if}<span class="ri-key">{g}</span>{/each}.</p>
        {/if}
        {#if realMoves.length > 0}
          <p>Already enrolled, will be re-bucketed: {firstFive(realMoves)}.</p>
        {/if}
      </div>
    {:else if parsed && !parsed.ok}
      <p class="error ri-parse-error">{parsed.error}</p>
    {/if}

    {#if submitError}
      <p class="error ri-banner" role="alert">{submitError}</p>
    {/if}
  {:else if resultRows}
    <div class="ri-card">
      <table class="ri-table result">
        <thead>
          <tr>
            <th scope="col" class="ri-num">#</th>
            <th scope="col">Email</th>
            <th scope="col" class="ri-result">Result</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each resultRows as r, i (i)}
            {@const detail = detailFor(r)}
            <tr>
              <td class="ri-num mono">{i + 1}</td>
              <td><span class="ri-line mono" title={r.email}>{r.email}</span></td>
              <td>
                {#if r.status === 'added'}
                  <span class="badge badge-ok ri-chip ri-added">added</span>
                {:else}
                  <span class="badge badge-error ri-chip ri-failed" data-result="error" title={detail}>error</span>
                {/if}
              </td>
              <td>
                {#if r.status === 'error'}
                  <span class="ri-line ri-detail error-detail" title={detail}>{detail}</span>
                {:else if detail}
                  <span class="ri-line ri-detail" title={detail}>{detail}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="ri-summary" id={summaryId}><span class="ri-key">{added} added</span>, {failed} failed.</p>
    {#if copyFallbackVisible}
      <textarea class="copy-fallback ri-fallback" readonly aria-label="Failed rows" value={copyFallbackText} bind:this={copyFallbackEl}></textarea>
    {/if}
  {/if}
</Modal>

<style>
  .ri-heading { font-size: 15px; font-weight: 600; color: var(--text); }
  /* The step marker sits beside the title; the × keeps the right edge. */
  .ri-steps {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 auto 0 6px;
    padding: 0;
    list-style: none;
  }
  .ri-step { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
  .ri-current { font-weight: 500; color: var(--text); }
  .ri-rule {
    width: 14px;
    height: 1.5px;
    margin-right: 2px;
    background: var(--border-strong);
  }
  .ri-rule-done {
    background: var(--primary);
  }
  .ri-dot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: var(--border-soft);
    color: var(--muted);
    font-size: 9.5px;
    font-weight: 400;
  }
  .ri-dot-on {
    background: var(--primary);
    color: var(--primary-text);
    font-weight: 500;
  }
  .ri-dot-done {
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
  }
  .ri-help { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--muted); }
  .ri-col { font-size: 12px; color: var(--text-3); }
  .ri-paste {
    box-sizing: border-box;
    width: 100%;
    min-height: 120px;
    padding: 8px 10px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--text-2);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .ri-card { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .ri-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .ri-table th {
    padding: 4px 5px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-3);
    text-align: left;
  }
  .ri-table td {
    padding: 4px 5px;
    border-bottom: 1px solid var(--border-soft);
    font-size: 12.5px;
    color: var(--text);
    vertical-align: middle;
  }
  .ri-table tr > :first-child { padding-left: 9px; }
  .ri-table tr > :last-child { padding-right: 9px; }
  .ri-table tbody tr:last-child td { border-bottom: 0; }
  .ri-num { width: 30px; font-size: 11px; color: var(--muted); }
  .ri-group { width: 110px; }
  .ri-tile-col { width: 20px; }
  .ri-result { width: 84px; }
  .ri-line { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ri-none { color: var(--muted); }
  .ri-why {
    display: block;
    font-size: 11.5px;
    color: var(--muted);
  }
  .ri-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
  }
  .ri-ok {
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
  }
  .ri-skip {
    background: var(--status-needs-revision-bg);
    color: var(--status-needs-revision-fg);
  }
  .ri-counts { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--muted); }
  .ri-counts p { margin: 0; }
  .ri-key { color: var(--text); }
  .ri-parse-error { margin: 0; font-size: 12.5px; color: var(--danger); }
  .ri-banner {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .ri-chip {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }
  .ri-added {
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
  }
  .ri-failed {
    background: var(--status-rejected-bg);
    color: var(--status-rejected-fg);
  }
  .ri-detail { font-size: 12px; color: var(--muted); }
  .ri-summary { margin: 0; font-size: 12.5px; color: var(--muted); }
  .ri-fallback {
    box-sizing: border-box;
    width: 100%;
    min-height: 80px;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .ri-foot-note { flex: 1; font-size: 12.5px; color: var(--muted); }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
```

- [ ] **Step 6: Run the import tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RosterImportModal.scaffold.svelte.test.ts src/tests/RosterImportModal.submit.svelte.test.ts src/tests/RosterImportModal.already-active.svelte.test.ts src/tests/RosterImportModal.unpublished.svelte.test.ts`
Expected: PASS (all four files). Kept on purpose and still green: submit `:66-88` (an enrolled student with an empty group cell sends their current group, `group: 'Alpha'` — D23 must not change it), `:312-335` (× is disabled, Esc and the backdrop do nothing while importing), `:355-387` (the snapshot guard), already-active Tests 1 and 3, both unpublished tests.

- [ ] **Step 7: Gate rows; Modal owns `.modal-backdrop` again**

In section (ak) of `frontend/scripts/visual-refresh-gate.sh`, extend the list:

```zsh
FILES_6B=(
  src/components/runs/PublishConflictsModal.svelte
  src/components/runs/NewRunModal.svelte src/components/ui/Switch.svelte
  src/components/runs/RosterImportModal.svelte
)
```

and append after the NewRunModal block:

```zsh
srcw runs/RosterImportModal.svelte 760
# (aa) anchored on .modal-panel while three run modals authored .modal-backdrop;
# with the last of them on ui/Modal, the backdrop is Modal's alone again.
own modal-backdrop Modal.svelte
own ri-steps RosterImportModal.svelte
uniq1 ri-steps
if [[ -n $REPLY ]]; then
  N=RosterImportModal; H=$REPLY
  d '\.ri-rule' '' 'width:14px' 'height:1\.5px' 'background:var\(--border-strong\)'
  d '\.ri-rule-done' '' 'background:var\(--primary\)'
  d '\.ri-dot' '' 'width:17px' 'height:17px' 'border-radius:50%' 'background:var\(--border-soft\)'
  d '\.ri-dot-on' '' 'background:var\(--primary\)' 'color:var\(--primary-text\)'
  d '\.ri-dot-done' '' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)'
  d '\.ri-tile' '' 'width:18px' 'height:18px' 'border-radius:4px'
  d '\.ri-ok' '' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)'
  d '\.ri-skip' '' 'background:var\(--status-needs-revision-bg\)' 'color:var\(--status-needs-revision-fg\)'
  d '\.ri-why' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.ri-added' '' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)'
  d '\.ri-failed' '' 'background:var\(--status-rejected-bg\)' 'color:var\(--status-rejected-fg\)'
  d '\.ri-chip' '' 'border-radius:3px'
  d '\.ri-banner' '' 'background:var\(--status-rejected-bg\)' 'border-left:3px solid var\(--danger\)'
  d '\.ri-paste' '' 'font-family:var\(--font-mono\)'
  sweep RosterImportModal $H
fi
```

Change the (aa) comment at `:4074` to:

```zsh
# Anchored on .modal-panel (5b). Section (ak) asserts `own modal-backdrop`
# since 6b moved the last run modal that authored .modal-backdrop onto Modal.
```

Set `EXPECTED_CHECKS=1732` (1697 + 35: srcw 1, own modal-backdrop 1, own/uniq1 2, 29 declarations, sweep 2).

- [ ] **Step 8: Run the full checks**

As Global Constraints › Commands. Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (1732 checks)`.

- [ ] **Step 9: Screenshots for the user**

Open `http://localhost:5174/teaching/demo-course/runs/8?tab=roster`, open the import. Paste (type into the box with agent-browser's fill, never Enter) a sheet-like block with tabs: six rows as drawn in 10f, one invalid e-mail, one existing student of run 8 with a different group, and 13 rows in a second shot so "Showing the first 10 of 13 rows. Row 12 will skip." shows. Mock `**/api/runs/8/students/batch` → `{"results":[…]}` with one `added`, one `error` with `"Already active in 'Spring 2026'"`, one `internal error`, and one `added` whose `group_id` differs from that student's real one. Screenshot both stages at 1280 and 1000; overlay with 10f and 10g beside them; wait for the user's OK. Clear the routes.

- [ ] **Step 10: Review lanes**

Opus (high) + Fable on the uncommitted diff. Fix Critical/Important, re-run after every fix until clean. Minors → backlog "## Task 3 — Import roster".

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RosterImportModal.svelte frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/RosterImportModal.scaffold.svelte.test.ts frontend/src/tests/RosterImportModal.submit.svelte.test.ts \
  frontend/src/tests/RosterImportModal.already-active.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6b): Import roster on ui/Modal (10f/10g): step marker, drawn tiles, real moves, Done once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Add the backlog file if the lanes left minors. Then the ledger line, memory, and wait for "go".

---

### Task 4: Mini-project editor on Modal: frame, footer, freeze, Save, confirms, guards (10m)

**Files:**
- Modify (rewrite): `frontend/src/components/runs/MiniProjectModal.svelte`
- Modify: `frontend/src/components/runs/RunMiniProjectsTab.svelte` (passes `blocks` and `onCreated`, the locked-edit guard, focus after a create)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (ak), the (af) comment at `:4217-4218`, `EXPECTED_CHECKS`)
- Modify: `docs/backlog/slice5b-authoring-polish-debt.md:258`, `docs/backlog/slice5c-constructor-polish-debt.md:158-162`, `docs/backlog/slice6a-teacher-restyle-debt.md:106` (one closing line each)
- Create: `frontend/src/tests/MiniProjectModal.frame.svelte.test.ts` (P15)
- Test: `frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts`, `frontend/src/tests/MiniProjectModal.publish.svelte.test.ts`, `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` (`MiniProjectModal.teacher-gating.svelte.test.ts` and `RunDetailPage.tabs.svelte.test.ts` keep passing unchanged)

**Interfaces:**
- Consumes: `Modal` (`labelledby`, `width`, `maxHeight`, `onRequestClose`, `closeDisabled`, `bodyInert`, `autofocusSelector`, `header` / `footer` snippets); `Button` (`loading`, `disabled`, `title`, `data-action`, bindable `element`); `InlineConfirm` (`row`, `takeFocus`, `confirmDataAction`); `MarkdownEditor` (`frozen`, bindable `uploading`, `ariaLabel`); `DirtyGuard` (`isDirty`); `focusFirst(candidates)` from `lib/focusFirst`; `blockPositions(blocks)` from `lib/blockNumbers`; `pushToast(message, kind)`.
- Produces for Task 5 (all inside `MiniProjectModal.svelte`): `publishCheckResult` (no dirty bullet), `publishAttempted` (`$state`, removed in Task 5), `publishReason` (`$derived`), `preconditionIdsByField`, `handlePublishClick()`, `confirmPublish()` whose recheck ends in `focusFirst([publishEl, closeX()])`, and the box markup `div.mpm-box.precondition-banner[data-testid="publish-preconditions"]` with `p.mpm-box-head` and `ul.mpm-box-list`. New optional props: `blocks?: BlockResponse[]` (P4) and `onCreated?: (mp: MiniProjectResponse) => void`.

- [ ] **Step 1: Write the failing frame tests**

Create `frontend/src/tests/MiniProjectModal.frame.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';
import { localTzLabel } from '../lib/datetime';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';

type ModalProps = ComponentProps<typeof MiniProjectModal>;

const course: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
// Stored orders 5 and 9: titles and options must show positions 1 and 2 (R21).
const blocks: BlockResponse[] = [
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 5, info: '', info_html: '' },
  { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 9, info: '', info_html: '' },
];

// A draft whose publish preconditions are all met (2027 deadlines, before runEndDate).
function mp(o: Partial<MiniProjectResponse> = {}): MiniProjectResponse {
  return {
    id: 99, run_id: 10, block_id: 2, title: 'Mini project for Block 2',
    assignment_md: 'orig text', assignment_html: '<p>orig text</p>',
    soft_deadline: '2027-06-01T10:00:00Z', hard_deadline: '2027-06-15T10:00:00Z',
    resubmission_deadline: '2027-06-20T10:00:00Z',
    is_published: false, first_submitted_at: null,
    created_at: '2027-05-01T00:00:00Z', updated_at: '2027-05-01T00:00:00Z',
    ...o,
  };
}

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
let cmp: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres([]));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  clearToasts();
  __resetGuardsForTests();
});

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

function open(over: Record<string, unknown> = {}) {
  const props: Record<string, unknown> = {
    runId: 10, mode: 'edit', initial: mp(), availableBlocks: [], currentBlock: blocks[1], blocks,
    runIsPublished: true, versionIsDisabled: false, runEndDate: '2027-06-30', course,
    onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined), onNavigateToTab: vi.fn(),
    ...over,
  };
  const target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(MiniProjectModal, { target, props: props as ModalProps });
}
function reopen(over: Record<string, unknown> = {}) {
  if (cmp) unmount(cmp);
  cmp = null;
  document.body.innerHTML = '';
  open(over);
}
const createMode = { mode: 'create', initial: null, currentBlock: null, availableBlocks: blocks };

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const btn = (a: string) => panel().querySelector<HTMLButtonElement>(`button[data-action="${a}"]`);
const closeX = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const ta = () => panel().querySelector<HTMLTextAreaElement>('textarea')!;
const hardInput = () => panel().querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1];
const confirmCancel = () => panel().querySelector<HTMLButtonElement>('.modal-foot .inline-confirm button.cancel')!;
const footButtons = () =>
  [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].map((b) => b.textContent!.trim());
const marker = () => panel().querySelector('footer.modal-foot .mpm-dirty')!.textContent;
const bodyInert = () => panel().querySelector('div.modal-body')!.hasAttribute('inert');
const toastTexts = () => toasts.list.map((t) => t.message);
const isPatch = (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === 'PATCH';
function type(text: string) {
  ta().value = text;
  ta().dispatchEvent(new Event('input', { bubbles: true }));
}
function esc(el: EventTarget) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}
function patchOk() {
  fetchSpy.mockImplementation((_u: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? jres(mp({ assignment_md: 'new text' })) : jres([]));
}
function patchFails(field: string | null, status = 422) {
  fetchSpy.mockImplementation((_u: string, init?: RequestInit) =>
    init?.method !== 'PATCH'
      ? jres([])
      : field
        ? jres({ detail: [{ loc: ['body', field], msg: 'is wrong', type: 'value_error' }] }, status)
        : jres({ detail: 'Mini-project locked by concurrent edit' }, status));
}

describe('MiniProjectModal — frame and title (R21, D14, P5)', () => {
  it('renders inside ui/Modal, labelled by its numbered title; a backdrop click leaves it open (D11)', async () => {
    const onClose = vi.fn();
    open({ onClose });
    await settle();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-labelledby')).toBe('mp-modal-title');
    const h2 = document.getElementById('mp-modal-title')!;
    expect(h2.textContent).toBe('Edit — Block 2 — Theory');
    expect(h2.getAttribute('title')).toBe('Edit — Block 2 — Theory');
    document.querySelector<HTMLElement>('.modal-backdrop')!.click();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('editing shows the Block row as text, with no picker (D14)', async () => {
    open();
    await settle();
    expect(panel().querySelector('select')).toBeNull();
    expect(panel().querySelector('.mpm-block')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Block Block 2 — Theory');
  });

  it('a block missing from blocks drops the prefix; no block at all reads "Edit mini-project" with a "—" row', async () => {
    open({ blocks: [] });
    await settle();
    expect(document.getElementById('mp-modal-title')!.textContent).toBe('Edit — Theory');
    reopen({ currentBlock: null });
    await settle();
    expect(document.getElementById('mp-modal-title')!.textContent).toBe('Edit mini-project');
    expect(panel().querySelector('.mpm-block')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Block —');
  });

  it('the create picker is labelled "Block" and numbers blocks by position', async () => {
    open(createMode);
    await settle();
    expect(document.getElementById('mp-modal-title')!.textContent).toBe('New mini-project');
    expect([...panel().querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Block 1 — Intro', 'Block 2 — Theory']);
    const select = panel().querySelector('select')!;
    expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Block');
  });

  it('deadline labels carry the zone without parentheses (R23); the assignment field is named', async () => {
    open();
    await settle();
    const zone = localTzLabel().slice(1, -1);
    expect(zone).not.toMatch(/[()]/);
    const labels = [...panel().querySelectorAll('.mpm-deadlines label')].map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual([`Soft deadline ${zone}`, `Hard deadline ${zone}`, `Resubmission ${zone}`]);
    expect(ta().getAttribute('aria-label')).toBe('Assignment');
  });
});

describe('MiniProjectModal — footer (D12, R20)', () => {
  it('creating shows Cancel · Create; editing shows Publish · Discard · Save; a published one Discard · Save', async () => {
    open(createMode);
    await settle();
    expect(footButtons()).toEqual(['Cancel', 'Create']);
    reopen();
    await settle();
    expect(footButtons()).toEqual(['Publish', 'Discard', 'Save']);
    reopen({ initial: mp({ is_published: true }) });
    await settle();
    expect(footButtons()).toEqual(['Discard', 'Save']);
  });

  it('"unsaved changes" shows only while the form differs from the saved values', async () => {
    open();
    await settle();
    expect(marker()).toBe('');
    type('changed');
    await settle();
    expect(marker()).toBe('unsaved changes');
    type('orig text');
    await settle();
    expect(marker()).toBe('');
  });

  it('the disabled titles of Save, Discard, Publish and Create', async () => {
    open();
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('No changes to save');
    expect(btn('discard')!.disabled).toBe(true);
    expect(btn('discard')!.title).toBe('No changes to discard');
    expect(btn('publish')!.disabled).toBe(false);
    type('changed');
    await settle();
    expect(btn('save')!.disabled).toBe(false);
    expect(btn('discard')!.disabled).toBe(false);
    expect(btn('publish')!.disabled).toBe(true);
    expect(btn('publish')!.title).toBe('Save your changes first');
    type('');
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('Assignment text is required');
    reopen(createMode);
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('Assignment text is required');
  });

  it('an upload in flight disables Save and Publish with "Wait for the upload to finish"', async () => {
    let resolveUpload!: (v: unknown) => void;
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/api/runs/10/assets') && init?.method === 'POST'
        ? new Promise((r) => { resolveUpload = r; })
        : jres([]));
    open();
    await settle();
    type('changed');
    await settle();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    ta().dispatchEvent(drop);
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('Wait for the upload to finish');
    expect(btn('publish')!.disabled).toBe(true);
    expect(btn('publish')!.title).toBe('Wait for the upload to finish');
    resolveUpload({ ok: true, status: 200, json: () => Promise.resolve({ id: 1, filename: 'x.png' }) });
    await settle();
  });
});

describe('MiniProjectModal — Save keeps the editor open (D19)', () => {
  it('Save sends the edit, refreshes, toasts "Saved", leaves the form clean, and focuses Publish', async () => {
    patchOk();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    open({ onSaved, onClose });
    await settle();
    type('new text');
    await settle();
    btn('save')!.focus();
    btn('save')!.click();
    await settle();
    const patch = fetchSpy.mock.calls.find(isPatch)!;
    expect(JSON.parse((patch[1] as RequestInit).body as string).assignment_md).toBe('new text');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(toastTexts()).toEqual(['Saved']);
    expect(marker()).toBe('');
    expect(ta().value).toBe('new text');
    expect(btn('save')!.title).toBe('No changes to save');
    expect(document.activeElement).toBe(btn('publish'));
  });

  it('a busy Save stays enabled as "Saving…" and keeps focus; a second click sends nothing (R20, Review Focus 1)', async () => {
    let resolvePatch!: (v: unknown) => void;
    fetchSpy.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? new Promise((r) => { resolvePatch = r; }) : jres([]));
    open();
    await settle();
    type('new text');
    await settle();
    const save = btn('save')!;
    save.focus();
    save.click();
    save.click();
    await settle();
    expect(fetchSpy.mock.calls.filter(isPatch)).toHaveLength(1);
    expect(save.disabled).toBe(false);
    expect(save.textContent!.trim()).toBe('Saving…');
    expect(document.activeElement).toBe(save);
    expect(closeX().disabled).toBe(true);
    expect(ta().readOnly).toBe(true);
    resolvePatch({
      ok: true, status: 200,
      json: () => Promise.resolve(mp({ assignment_md: 'new text' })),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    await settle();
    expect(fetchSpy.mock.calls.filter(isPatch)).toHaveLength(1);
    expect(ta().readOnly).toBe(false);
  });

  it('with Publish hidden, focus goes to the assignment field; in Preview, to the Edit tab (Review Focus 4)', async () => {
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? jres(mp({ is_published: true }))
        : String(url).includes('/render') ? jres({ html: '<p>x</p>' }) : jres([]));
    open({ initial: mp({ is_published: true }) });
    await settle();
    type('new text');
    await settle();
    btn('save')!.click();
    await settle();
    expect(document.activeElement).toBe(ta());
    type('newer text');
    await settle();
    btn('preview')!.click();
    await settle();
    expect(panel().querySelector('textarea')).toBeNull();
    btn('save')!.click();
    await settle();
    expect(document.activeElement).toBe(btn('edit'));
  });

  it('a refresh that fails after a save: clean form, the refresh toast, no save error (Review Focus 5)', async () => {
    patchOk();
    open({ onSaved: vi.fn().mockRejectedValue(new Error('network')) });
    await settle();
    type('new text');
    await settle();
    btn('save')!.click();
    await settle();
    expect(toastTexts()).toEqual(['Saved (refresh failed — reload to see latest)']);
    expect(toasts.list[0].kind).toBe('info');
    expect(marker()).toBe('');
    expect(panel().querySelector('.banner-error')).toBeNull();
  });

  it('Create calls onCreated, then awaits onSaved, then closes; a failed refresh still closes, with its toast', async () => {
    const created = mp({ id: 5, block_id: 1 });
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST' && String(url).includes('/api/runs/10/mini-projects') ? jres(created) : jres([]));
    const calls: string[] = [];
    let rejectSaved!: (e: unknown) => void;
    open({
      ...createMode,
      onCreated: (m: MiniProjectResponse) => { calls.push(`created ${m.id}`); },
      onSaved: () => {
        calls.push('saved');
        return new Promise<void>((_res, rej) => { rejectSaved = rej; });
      },
      onClose: () => { calls.push('close'); },
    });
    await settle();
    type('Task');
    await settle();
    btn('save')!.click();
    await settle();
    expect(calls).toEqual(['created 5', 'saved']);
    expect(btn('save')!.textContent!.trim()).toBe('Creating…');
    rejectSaved(new Error('network'));
    await settle();
    expect(calls).toEqual(['created 5', 'saved', 'close']);
    expect(toastTexts()).toEqual(['Created (refresh failed — reload to see latest)']);
  });
});

describe('MiniProjectModal — Discard and failed saves (D12, R20)', () => {
  it('Discard puts back the saved values, clears the errors, and focuses the assignment field', async () => {
    patchFails('assignment_md');
    open();
    await settle();
    const before = hardInput().value;
    hardInput().value = '2027-06-16T10:00';
    hardInput().dispatchEvent(new Event('input', { bubbles: true }));
    type('bad');
    await settle();
    btn('save')!.click();
    await settle();
    expect(panel().querySelector('#err-assignment_md')).not.toBeNull();
    expect(panel().querySelector('.banner-error')).not.toBeNull();
    btn('discard')!.click();
    await settle();
    expect(ta().value).toBe('orig text');
    expect(hardInput().value).toBe(before);
    expect(panel().querySelector('#err-assignment_md')).toBeNull();
    expect(panel().querySelector('.banner-error')).toBeNull();
    expect(marker()).toBe('');
    expect(document.activeElement).toBe(ta());
  });

  it('Discard in Preview focuses the editor\'s Edit tab (§Focus › After Discard)', async () => {
    fetchSpy.mockImplementation((url: string) =>
      String(url).includes('/render') ? jres({ html: '<p>x</p>' }) : jres([]));
    open();
    await settle();
    type('changed');
    await settle();
    btn('preview')!.click();
    await settle();
    expect(panel().querySelector('textarea')).toBeNull();
    btn('discard')!.click();
    await settle();
    expect(document.activeElement).toBe(btn('edit'));
  });

  it('a failed save focuses the first errored field, marked invalid and no longer frozen', async () => {
    patchFails('hard_deadline');
    open();
    await settle();
    type('new text');
    await settle();
    btn('save')!.focus();
    btn('save')!.click();
    await settle();
    expect(document.activeElement).toBe(hardInput());
    expect(hardInput().getAttribute('aria-invalid')).toBe('true');
    expect(hardInput().getAttribute('aria-describedby')).toBe('err-hard_deadline');
    expect(hardInput().readOnly).toBe(false);
  });

  it('a failed save with no field error keeps focus on Save', async () => {
    patchFails(null, 409);
    open();
    await settle();
    type('new text');
    await settle();
    btn('save')!.focus();
    btn('save')!.click();
    await settle();
    expect(panel().querySelector('.banner-error')!.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(btn('save'));
  });
});

describe('MiniProjectModal — the two confirms', () => {
  it('closing with edits asks in place; × and Esc keep the confirm; the body is inert; Cancel returns to ×', async () => {
    const onClose = vi.fn();
    open({ onClose });
    await settle();
    type('changed');
    await settle();
    esc(ta());
    await settle();
    expect(panel().textContent).toContain('Discard unsaved changes?');
    expect(document.activeElement).toBe(confirmCancel());
    expect(bodyInert()).toBe(true);
    expect(marker()).toBe('unsaved changes');
    // jsdom ignores inert, so the test can put focus back in the field.
    ta().focus();
    esc(ta());
    await settle();
    closeX().click();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(confirmCancel());
    confirmCancel().click();
    await settle();
    expect(panel().textContent).not.toContain('Discard unsaved changes?');
    expect(bodyInert()).toBe(false);
    expect(document.activeElement).toBe(closeX());
    closeX().click();
    await settle();
    btn('confirm-discard')!.click();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the publish confirm takes focus, makes the body inert, survives Esc, and Cancel returns focus to Publish', async () => {
    open();
    await settle();
    btn('publish')!.click();
    await settle();
    expect(panel().textContent).toContain('Once published, this cannot be undone.');
    expect(document.activeElement).toBe(confirmCancel());
    expect(bodyInert()).toBe(true);
    esc(window);
    await settle();
    expect(btn('confirm-publish')).not.toBeNull();
    confirmCancel().click();
    await settle();
    expect(document.activeElement).toBe(btn('publish'));
  });

  it('the publish confirm refuses while dirty; focus goes to × because Publish is now disabled (R22)', async () => {
    open();
    await settle();
    btn('publish')!.click();
    await settle();
    // Inert in a browser; jsdom lets the test force an edit in between.
    type('slipped in');
    await settle();
    btn('confirm-publish')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('/publish'))).toBe(false);
    expect(btn('confirm-publish')).toBeNull();
    expect(btn('publish')!.title).toBe('Save your changes first');
    expect(document.activeElement).toBe(closeX());
  });
});

describe('MiniProjectModal — leaving with edits (D16)', () => {
  it('a tab jump asks while dirty, and never while clean', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open();
    await settle();
    await navigate('/mp-frame-clean');
    expect(ask).not.toHaveBeenCalled();
    type('changed');
    await settle();
    await navigate('/mp-frame-dirty');
    expect(ask).toHaveBeenCalledWith('Discard unsaved changes and continue?');
    ask.mockRestore();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MiniProjectModal.frame.svelte.test.ts`
Expected: FAIL — all 22 tests fail (no `section.modal-panel` yet).

- [ ] **Step 3: Change the old suites on purpose**

In `frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts`:

1. Four tests here (and a fifth in the publish suite, below) click Save on an untouched form, which now meets a disabled Save ("No changes to save"). Each makes an edit first: insert these four lines right before the first `button[data-action="save"]` click in the tests at `:372` (after `:402`), `:454` (after `:484`), `:579` (after `:611`) and `:625` (after `:656`):

```ts
    const edited = target.querySelector('textarea') as HTMLTextAreaElement;
    edited.value = 'changed';
    edited.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
```

2. Replace the test at `:271-298` (D11 flips it):

```ts
  it('a backdrop click leaves the modal open (D11)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        course: baseCourse,
        onClose,
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    (document.querySelector('.modal-backdrop') as HTMLElement).click();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('section.modal-panel[role="dialog"]')).not.toBeNull();
  });
```

3. Replace every `button[data-action="close-x"]` (five uses: `:356`, `:365`, `:487`, `:494`, `:535`) with `header.modal-head button[aria-label="Close"]`.

4. Replace the test at `:413-452` (R19 and R20 change it):

```ts
  it('fields freeze while submitting: readonly inputs, a frozen editor, and Save keeps focus as "Saving…" (R19, R20)', async () => {
    let resolvePost!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/mini-projects') && (init as RequestInit | undefined)?.method === 'PATCH') {
        return new Promise((r) => {
          resolvePost = r;
        });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        course: baseCourse,
        onClose: vi.fn(),
        onSaved: vi.fn().mockResolvedValue(undefined),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'changed';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const save = target.querySelector('button[data-action="save"]') as HTMLButtonElement;
    save.focus();
    save.click();
    await settle();
    expect(ta.readOnly).toBe(true);
    expect(ta.disabled).toBe(false);
    target.querySelectorAll('input[type="datetime-local"]').forEach((el) => {
      expect((el as HTMLInputElement).readOnly).toBe(true);
      expect((el as HTMLInputElement).disabled).toBe(false);
    });
    expect(save.disabled).toBe(false);
    expect(save.textContent?.trim()).toBe('Saving…');
    expect(document.activeElement).toBe(save);
    resolvePost({ ok: true, status: 200, json: () => Promise.resolve(initial) } as Response);
    await settle();
  });
```

5. Replace the structure test at `:547-577` (the frame is Modal's now):

```ts
  it('modal layout: ui/Modal frame with head, body and foot; no own backdrop (structural check, NOT computed-style)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: {
        runId: 10,
        mode: 'edit',
        initial,
        availableBlocks: [],
        currentBlock: blocks[0],
        runIsPublished: true,
        versionIsDisabled: false,
        runEndDate: '2026-06-30',
        course: baseCourse,
        onClose: vi.fn(),
        onSaved: vi.fn(),
        onNavigateToTab: vi.fn(),
      },
    });
    await settle();
    const dialog = document.querySelector('section.modal-panel[role="dialog"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('mp-modal-title');
    expect(dialog!.querySelector('header.modal-head')).toBeTruthy();
    expect(dialog!.querySelector('div.modal-body')).toBeTruthy();
    expect(dialog!.querySelector('footer.modal-foot')).toBeTruthy();
    expect(document.querySelector('.modal-backdrop')).toBeTruthy();
    expect(document.querySelector('[data-role="backdrop"], .backdrop')).toBeNull();
  });
```

Still holding, not to be flipped: `:81` (Create closes) and `:454-498` (× after the save closes the now-clean modal; its `if (!onClose.mock.calls.length)` branch now runs).

In `frontend/src/tests/MiniProjectModal.publish.svelte.test.ts`:

1. Replace the test at `:229-251` (R22):

```ts
  it('unsaved changes: Publish is disabled with "Save your changes first"; no "save first" bullet (R22)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({ initial: draftMp() }) as ModalProps,
    });
    await settle();
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'orig text + edits';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const publish = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(publish.title).toBe('Save your changes first');
    publish.click();
    await settle();
    expect(target.textContent).not.toContain('Save your changes before publishing.');
    expect(target.querySelector('button[data-action="confirm-publish"]')).toBeNull();
    expect(fetchSpy.mock.calls.find((c) => String(c[0]).includes('/publish'))).toBeFalsy();
  });
```

2. In the test at `:525`, insert the four edit lines from the create-edit item 1 right after `:538` (`await settle();`), before the Save click.

3. Replace the test at `:589-616` (R20, P11):

```ts
  it('a click on Save while publishing sends nothing; the busy Publish keeps focus as "Publishing…" (R20, P11)', async () => {
    let resolvePublish!: (v: unknown) => void;
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/publish') && (init as RequestInit | undefined)?.method === 'POST') {
        return new Promise((r) => {
          resolvePublish = r;
        });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, { target, props: defaultProps() as ModalProps });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-publish"]') as HTMLButtonElement).click();
    await settle();
    const publish = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    expect(publish.textContent?.trim()).toBe('Publishing…');
    expect(document.activeElement).toBe(publish);
    (target.querySelector('button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    expect(fetchSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
    resolvePublish({ ok: true, status: 200, json: () => Promise.resolve(draftMp({ is_published: true })) } as Response);
    await settle();
  });
```

- [ ] **Step 4: Write the failing tab tests**

In `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts`:

1. Add the toast store to the imports:

```ts
import { toasts, clearToasts } from '../stores/toasts.svelte';
```

2. The tab now opens a `ui/Modal` (a module-level stack, a window Esc listener, the scroll lock), and several existing tests never unmount. Make `mountMpTab` track what it mounts and unmount it after each test. Add above `mountMpTab`:

```ts
const mountedTabs: ReturnType<typeof mount>[] = [];
```

in `mountMpTab`, after `const cmp = mount(…);`, add `mountedTabs.push(cmp);`, and replace the file's `afterEach` with:

```ts
afterEach(() => {
  while (mountedTabs.length) {
    try {
      unmount(mountedTabs.pop()!);
    } catch {
      /* already unmounted by the test */
    }
  }
  clearToasts();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});
```

3. Append:

```ts
describe('RunMiniProjectsTab — 6b editor hand-off', () => {
  const draft = mkMp({ id: 10, block_id: 1, assignment_md: 'doc body' });

  it('"used by → Edit" on a locked mini-project opens nothing, toasts its reason, and is consumed', async () => {
    clearToasts();
    const onPendingEditConsumed = vi.fn();
    const { target, cmp } = mountMpTab({
      miniProjects: [{ ...draft, first_submitted_at: '2026-06-01T00:00:00Z' }],
      pendingEditTarget: draft,
      onPendingEditConsumed,
    });
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    // The target stays set (the spy never clears it): still one toast, one call.
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Has submissions — editing is off', 'info']]);
    expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('"used by → Edit" with a disabled version opens nothing and toasts the version reason', async () => {
    clearToasts();
    const onPendingEditConsumed = vi.fn();
    const { target, cmp } = mountMpTab({
      miniProjects: [draft],
      versionIsDisabled: true,
      pendingEditTarget: draft,
      onPendingEditConsumed,
    });
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(toasts.list.map((t) => t.message)).toContain("This run's course version is disabled.");
    expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('"used by → Edit" opens the tab\'s own row, numbered by position (P17, R21)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const { cmp } = mountMpTab({
      miniProjects: [draft],
      pendingEditTarget: { ...draft, assignment_md: 'stale copy' },
      onPendingEditConsumed: vi.fn(),
    });
    await settle();
    expect((document.querySelector('section.modal-panel textarea') as HTMLTextAreaElement).value).toBe('doc body');
    expect(document.getElementById('mp-modal-title')?.textContent).toBe('Edit — Block 1 — Intro');
    unmount(cmp);
  });

  it('after a create that takes the last free block, focus lands on the new row\'s pencil (§Focus › After Create)', async () => {
    const created = mkMp({ id: 2, block_id: 2 });
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/api/runs/10/mini-projects') && init?.method === 'POST' ? jres(created) : jres([]));
    const props = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true, runEndDate: '2026-06-30',
      versionIsDisabled: false, pinnedAvailable: true, blocks,
      miniProjects: [mkMp({ id: 1, block_id: 1 })] as MiniProjectResponse[],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
      course: baseCourse,
    });
    props.onRefetchMiniProjects = vi.fn(async () => {
      props.miniProjects = [...props.miniProjects, created];
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props });
    await settle();
    byAction(target, 'new-mp')!.click();
    await settle();
    const ta = document.querySelector('section.modal-panel textarea') as HTMLTextAreaElement;
    ta.value = 'New task';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (document.querySelector('section.modal-panel button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(byAction(target, 'new-mp')!.disabled).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit mini-project for Block 2');
    unmount(cmp);
  });
});
```

- [ ] **Step 5: Run the old suites and the tab tests to see the changes fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MiniProjectModal.create-edit.svelte.test.ts src/tests/MiniProjectModal.publish.svelte.test.ts src/tests/RunMiniProjectsTab.svelte.test.ts`
Expected: FAIL — create-edit: the backdrop, close-x, freeze and structure tests; publish: the R22 and "Publishing…" focus tests; tab: the four new tests (no toast, the parent's copy, "Block 0", focus on `<body>`). The rest pass.

- [ ] **Step 6: Rewrite MiniProjectModal on Modal**

Replace `frontend/src/components/runs/MiniProjectModal.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { runAssetContext } from '../../lib/assetContext';
  import { localInputToISO, isoToLocalInput, localTzLabel } from '../../lib/datetime';
  import { createMiniProject, updateMiniProject, publishMiniProject } from '../../lib/miniProjects';
  import { blockPositions } from '../../lib/blockNumbers';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import MarkdownEditor from '../editor/MarkdownEditor.svelte';
  import DirtyGuard from '../editor/DirtyGuard.svelte';
  import Button from '../ui/Button.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import Modal from '../ui/Modal.svelte';
  import type { Course, MiniProjectResponse, BlockResponse, ValidationErrorDetail } from '../../lib/types';

  let {
    runId,
    mode,
    initial,
    availableBlocks,
    currentBlock,
    runIsPublished,
    versionIsDisabled,
    runEndDate,
    course,
    blocks = [],
    onClose,
    onSaved,
    onCreated = undefined,
    onNavigateToTab,
  }: {
    runId: number;
    mode: 'create' | 'edit';
    initial: MiniProjectResponse | null;
    availableBlocks: BlockResponse[];
    currentBlock: BlockResponse | null;
    runIsPublished: boolean;
    versionIsDisabled: boolean;
    runEndDate: string | null;
    course: Course;
    // R21 / P4: the pinned version's blocks, for position numbers. Without
    // them the "Block {n} — " prefix drops.
    blocks?: BlockResponse[];
    onClose: () => void;
    onSaved: () => Promise<void>;
    // Create hands the new mini-project over before the refresh, so the tab
    // can focus its row once the modal closes (§Focus › After Create).
    onCreated?: (mp: MiniProjectResponse) => void;
    onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
  } = $props();

  const uid = $props.id();
  const assetContext = $derived(runAssetContext(runId));
  const UPLOAD_WAIT = 'Wait for the upload to finish';
  // R23: "GMT+2", without localTzLabel's parentheses.
  const zone = localTzLabel().slice(1, -1);

  // The modal is `{#if modalMode != null}`-gated by the parent: it unmounts
  // and remounts whenever mode/initial/availableBlocks change, so a one-shot
  // snapshot of the initial-mount values is the intended contract. Reading
  // the props through these locals (instead of the $state initializer
  // directly) avoids Svelte 5's `state_referenced_locally` warning while
  // preserving the "stable per mount" semantic.
  const initialBlockId = initial?.block_id ?? availableBlocks[0]?.id ?? null;
  const initialSoftLocal = initial?.soft_deadline ? isoToLocalInput(initial.soft_deadline) : '';
  const initialHardLocal = initial?.hard_deadline ? isoToLocalInput(initial.hard_deadline) : '';
  const initialResubLocal = initial?.resubmission_deadline
    ? isoToLocalInput(initial.resubmission_deadline)
    : '';
  const initialAssignmentMd = initial?.assignment_md ?? '';

  let formData = $state({
    block_id: initialBlockId,
    soft_local: initialSoftLocal,
    hard_local: initialHardLocal,
    resub_local: initialResubLocal,
    assignment_md: initialAssignmentMd,
  });

  let submitting = $state(false);
  let mounted = $state(false);
  let uploading = $state(false);
  let uploadAbortController = $state<AbortController | null>(null);
  let titleEl = $state<HTMLElement>();
  let publishEl = $state<HTMLButtonElement>();

  function currentFormSnapshot() {
    return {
      block_id: formData.block_id ?? null,
      soft_local: formData.soft_local,
      hard_local: formData.hard_local,
      resub_local: formData.resub_local,
      assignment_md: formData.assignment_md,
    };
  }
  // D19: the saved values the form compares against. An edit Save re-bases it
  // to the values it sent: the fields were frozen, so they equal the screen.
  let baseline = $state(currentFormSnapshot());

  onMount(() => {
    mounted = true;
  });
  onDestroy(() => {
    mounted = false;
  });

  let pendingClose = $state(false);
  let pendingPublishConfirm = $state(false);
  let publishing = $state(false);

  const dirty = $derived(JSON.stringify(currentFormSnapshot()) !== JSON.stringify(baseline));
  const saving = $derived(submitting && !publishing);
  const confirmOpen = $derived(pendingClose || pendingPublishConfirm);

  // R21: blocks are numbered by position; a block missing from `blocks` drops the prefix.
  const positions = $derived(blockPositions(blocks));
  function blockLabel(b: BlockResponse): string {
    const n = positions.get(b.id);
    return n === undefined ? b.title : `Block ${n} — ${b.title}`;
  }
  const heading = $derived(
    mode === 'create'
      ? 'New mini-project'
      : currentBlock
        ? `Edit — ${blockLabel(currentBlock)}`
        : 'Edit mini-project',
  );

  const saveError = $derived.by((): string | null => {
    if (mode === 'create' && formData.block_id == null) {
      return 'No available blocks to assign — every block already has a mini-project';
    }
    if (!formData.assignment_md.trim()) return 'Assignment text is required';
    if (formData.soft_local && formData.hard_local) {
      if (new Date(localInputToISO(formData.soft_local)) > new Date(localInputToISO(formData.hard_local))) {
        return 'Soft deadline must be before hard deadline';
      }
    }
    if (formData.hard_local && formData.resub_local) {
      if (new Date(localInputToISO(formData.hard_local)) > new Date(localInputToISO(formData.resub_local))) {
        return 'Hard deadline must be before resubmission deadline';
      }
    }
    return null;
  });

  let serverError = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});

  function mapValidationErrors(details: ValidationErrorDetail[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of details) {
      const segs = d.loc.filter((s): s is string => typeof s === 'string');
      const key = segs.length > 0 ? segs[segs.length - 1] : '_';
      if (!(key in out)) out[key] = d.msg;
    }
    return out;
  }

  // Publish flow (T6b). publishCheckResult lists unmet preconditions per spec
  // §"Validation" lines 491-510, computed from the values on screen. Each
  // bullet has optional `field` — when set, the bullet's <li> gets a stable ID
  // and the corresponding input adds it to aria-describedby (spec line 512).
  // Bullets containing "Open Overview" render that substring as a link to
  // onNavigateToTab('overview'). publishAttempted flips on the first Publish
  // click so the box only appears after the user tries. `adminOnly` flags a bullet whose "Open Overview" affordance only a
  // course admin can act on; for a teacher it renders as plain text.
  // Spec §6.2 RunMiniProjectsTab + MiniProjectModal teacher-gating.
  type FieldKey = 'assignment_md' | 'soft_deadline' | 'hard_deadline' | 'resubmission_deadline';
  type PreconditionBullet = { text: string; field?: FieldKey; adminOnly?: boolean };

  let publishAttempted = $state(false);

  const publishCheckResult = $derived.by((): PreconditionBullet[] | null => {
    if (mode !== 'edit' || initial?.is_published) return null;
    const unmet: PreconditionBullet[] = [];
    // Spec lines 491-497: "For Publish, ALL of the above PLUS" — the full
    // Save validation re-runs here so empty assignment_md / inverted
    // ordering surface BEFORE any network call.
    if (!formData.assignment_md.trim()) {
      unmet.push({ text: 'Assignment text is required', field: 'assignment_md' });
    }
    if (formData.soft_local && formData.hard_local) {
      if (new Date(localInputToISO(formData.soft_local)) > new Date(localInputToISO(formData.hard_local))) {
        unmet.push({ text: 'Soft deadline must be before hard deadline', field: 'soft_deadline' });
      }
    }
    if (formData.hard_local && formData.resub_local) {
      if (new Date(localInputToISO(formData.hard_local)) > new Date(localInputToISO(formData.resub_local))) {
        unmet.push({ text: 'Hard deadline must be before resubmission deadline', field: 'hard_deadline' });
      }
    }
    if (!formData.hard_local) {
      unmet.push({ text: 'Hard deadline must be set', field: 'hard_deadline' });
    }
    if (!formData.resub_local) {
      unmet.push({ text: 'Resubmission deadline must be set', field: 'resubmission_deadline' });
    }
    if (formData.hard_local) {
      const hardIso = localInputToISO(formData.hard_local);
      // Spec line 499: client-side proactive "hard in future" warning.
      if (new Date(hardIso) <= new Date()) {
        unmet.push({ text: 'Hard deadline must be in the future', field: 'hard_deadline' });
      }
      if (runEndDate === null) {
        unmet.push({ text: 'Run end date must be set — Open Overview to set it.', field: 'hard_deadline' });
      } else if (hardIso > `${runEndDate}T23:59:59Z`) {
        unmet.push({ text: `Hard deadline must be before run end (${runEndDate})`, field: 'hard_deadline' });
      }
    }
    if (formData.resub_local && runEndDate !== null) {
      const resubIso = localInputToISO(formData.resub_local);
      if (resubIso > `${runEndDate}T23:59:59Z`) {
        unmet.push({
          text: `Resubmission deadline must be before run end (${runEndDate})`,
          field: 'resubmission_deadline',
        });
      }
    }
    if (!runIsPublished) {
      unmet.push({ text: 'Run must be published — Open Overview to publish.', adminOnly: true });
    }
    // Spec line 548: versionIsDisabled blocks the modal-only publish, even for
    // a modal already open when it flips.
    if (versionIsDisabled) {
      unmet.push({ text: "This run's course version is disabled — Open Overview to re-enable it.", adminOnly: true });
    }
    // R22: unsaved edits are not a bullet. The backend publishes the persisted
    // mini-project, so Publish is disabled while dirty ("Save your changes
    // first") and the confirm's recheck refuses while dirty.
    return unmet;
  });

  // R20: when reasons overlap the first wins; a loading button ignores them.
  const saveReason = $derived(uploading ? UPLOAD_WAIT : (saveError ?? (dirty ? null : 'No changes to save')));
  const discardReason = $derived(dirty ? null : 'No changes to discard');
  const publishReason = $derived(uploading ? UPLOAD_WAIT : dirty ? 'Save your changes first' : null);

  // Stable bullet IDs grouped by field, used for aria-describedby on inputs.
  const preconditionIdsByField = $derived.by((): Record<string, string> => {
    const result: Record<string, string[]> = {};
    if (!publishAttempted || !publishCheckResult) return {};
    publishCheckResult.forEach((b, idx) => {
      if (b.field) {
        const id = `precondition-${idx}`;
        (result[b.field] ??= []).push(id);
      }
    });
    return Object.fromEntries(Object.entries(result).map(([k, ids]) => [k, ids.join(' ')]));
  });

  function ariaDescribedFor(field: FieldKey): string | undefined {
    const ids: string[] = [];
    if (fieldErrors[field]) ids.push(`err-${field}`);
    if (preconditionIdsByField[field]) ids.push(preconditionIdsByField[field]);
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  const DEADLINES = [
    { field: 'soft_deadline', local: 'soft_local', label: 'Soft deadline' },
    { field: 'hard_deadline', local: 'hard_local', label: 'Hard deadline' },
    { field: 'resubmission_deadline', local: 'resub_local', label: 'Resubmission' },
  ] as const;
  // R20: a failed request focuses the first errored field, in screen order.
  const FIELD_ORDER = ['block_id', 'assignment_md', 'soft_deadline', 'hard_deadline', 'resubmission_deadline'];

  // Modal owns the frame; the modal's own nodes are found from the title.
  function panel(): HTMLElement | null {
    return titleEl?.closest<HTMLElement>('section.modal-panel') ?? null;
  }
  function closeX(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]') ?? null;
  }
  // The assignment textarea exists only in the editor's Edit mode; its Edit
  // tab is the fallback (MarkdownEditor.svelte:285-296).
  function assignmentField(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>('.modal-body textarea') ?? null;
  }
  function editTab(): HTMLElement | null {
    return panel()?.querySelector<HTMLElement>('.modal-body button[data-action="edit"]') ?? null;
  }
  function focusFirstError() {
    focusFirst(
      FIELD_ORDER.filter((k) => fieldErrors[k]).map((k) =>
        panel()?.querySelector<HTMLElement>(`.modal-body [aria-describedby~="err-${k}"]`),
      ),
    );
  }

  // ×, Esc and create-mode Cancel. While a confirm shows they never close:
  // focus goes back to the confirm's Cancel.
  function requestClose() {
    if (submitting) return;
    if (confirmOpen) {
      panel()?.querySelector<HTMLElement>('.modal-foot .inline-confirm button.cancel')?.focus();
      return;
    }
    if (dirty) {
      pendingClose = true;
      return;
    }
    uploadAbortController?.abort();
    onClose();
  }

  async function cancelClose() {
    pendingClose = false;
    await tick();
    closeX()?.focus();
  }

  function confirmDiscard() {
    pendingClose = false;
    uploadAbortController?.abort();
    onClose();
  }

  // D12: put back the saved values (§Focus › After Discard).
  async function discard() {
    if (submitting || !dirty) return;
    Object.assign(formData, $state.snapshot(baseline));
    serverError = null;
    fieldErrors = {};
    await tick();
    focusFirst([assignmentField(), editTab(), closeX()]);
  }

  function handlePublishClick() {
    if (submitting || publishReason) return;
    publishAttempted = true;
    if (publishCheckResult && publishCheckResult.length > 0) return;
    pendingPublishConfirm = true;
  }

  async function cancelPublish() {
    pendingPublishConfirm = false;
    await tick();
    focusFirst([publishEl, closeX()]);
  }

  async function confirmPublish() {
    if (submitting) return;
    pendingPublishConfirm = false;
    // Re-check: the parent may have flipped versionIsDisabled (or
    // runIsPublished) since the click, and R22 refuses while dirty.
    if ((publishCheckResult && publishCheckResult.length > 0) || dirty) {
      publishAttempted = true;
      await tick();
      focusFirst([publishEl, closeX()]);
      return;
    }
    submitting = true;
    publishing = true;
    serverError = null;
    // P11: the confirm's buttons unmount under the focus; the busy Publish takes it.
    await tick();
    publishEl?.focus();
    try {
      await publishMiniProject(initial!.id);
      if (!mounted) return;
      await onSaved();
      if (!mounted) return;
      onClose();
    } catch (e: unknown) {
      if (!mounted) return;
      if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        const eo = e as { message?: unknown } | null | undefined;
        serverError = typeof eo?.message === 'string' ? eo.message : 'Publish failed';
      }
    } finally {
      if (mounted) {
        submitting = false;
        publishing = false;
      }
    }
  }

  async function handleSave() {
    if (submitting || saveReason) return;
    const sent = currentFormSnapshot();
    submitting = true;
    serverError = null;
    fieldErrors = {};
    let created: MiniProjectResponse | null = null;
    try {
      const body = {
        block_id: sent.block_id!,
        assignment_md: sent.assignment_md,
        soft_deadline: sent.soft_local ? localInputToISO(sent.soft_local) : null,
        hard_deadline: sent.hard_local ? localInputToISO(sent.hard_local) : null,
        resubmission_deadline: sent.resub_local ? localInputToISO(sent.resub_local) : null,
      };
      if (mode === 'create') {
        created = await createMiniProject(runId, body);
      } else {
        const { block_id: _block_id, ...patchBody } = body;
        await updateMiniProject(initial!.id, patchBody);
      }
    } catch (e: unknown) {
      if (!mounted) return;
      if (e instanceof ApiError && e.status === 404) {
        serverError =
          'This mini-project has been deleted. Select-all (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C) from the assignment textarea if you want to preserve your work before closing.';
        // T9 smoke catch: the MP is gone server-side; refresh the parent's
        // list so the stale row goes. Fire-and-forget by design; the explicit
        // .catch keeps a refresh failure from surfacing as unhandled.
        onSaved().catch(() => {});
      } else if (e instanceof ApiError && e.status === 409) {
        serverError = `${e.displayMessage} Refresh the page to see latest.`;
      } else if (e instanceof ApiError && e.status === 422) {
        const details = e.validationErrors();
        if (details) fieldErrors = mapValidationErrors(details);
        serverError = e.displayMessage;
      } else if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        const eo = e as { message?: unknown } | null | undefined;
        serverError = typeof eo?.message === 'string' ? eo.message : 'Save failed';
      }
      // R20: un-freeze, then focus the first errored field, or stay on Save.
      submitting = false;
      await tick();
      focusFirstError();
      return;
    }
    if (!mounted) return;
    if (mode === 'create') {
      if (created) onCreated?.(created);
    } else {
      baseline = sent;
    }
    // D19: the write succeeded; a failed list refresh is only a toast. The
    // modal stays frozen through the refresh (R20).
    let refreshFailed = false;
    try {
      await onSaved();
    } catch {
      refreshFailed = true;
    }
    if (!mounted) return;
    if (mode === 'create') {
      if (refreshFailed) pushToast('Created (refresh failed — reload to see latest)', 'info');
      submitting = false;
      onClose();
      return;
    }
    // P3: one toast, once the refresh settles (5b's order).
    if (refreshFailed) pushToast('Saved (refresh failed — reload to see latest)', 'info');
    else pushToast('Saved', 'success');
    submitting = false;
    await tick();
    // §Focus › After Save: Save itself just became disabled.
    focusFirst([publishEl, assignmentField(), editTab(), closeX()]);
  }
</script>

<DirtyGuard isDirty={() => dirty && !submitting} />

{#snippet head()}
  <h2 id="mp-modal-title" class="mpm-heading" title={heading} bind:this={titleEl}>{heading}</h2>
{/snippet}

{#snippet foot()}
  <span class="mpm-dirty mono">{mode === 'edit' && dirty ? 'unsaved changes' : ''}</span>
  {#if pendingClose}
    <InlineConfirm
      row
      takeFocus
      warning="Discard unsaved changes?"
      confirmLabel="Discard"
      confirmDataAction="confirm-discard"
      onCancel={() => void cancelClose()}
      onConfirm={confirmDiscard}
    />
  {:else if pendingPublishConfirm}
    <InlineConfirm
      row
      takeFocus
      warning="Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions)."
      confirmLabel="Publish"
      confirmDataAction="confirm-publish"
      onCancel={() => void cancelPublish()}
      onConfirm={() => void confirmPublish()}
    />
  {:else if mode === 'create'}
    <Button variant="ghost" data-action="cancel" onclick={requestClose}>Cancel</Button>
    <Button
      variant="primary"
      data-action="save"
      loading={saving}
      disabled={!saving && !!saveReason}
      title={saving ? undefined : (saveReason ?? undefined)}
      onclick={() => void handleSave()}
    >{saving ? 'Creating…' : 'Create'}</Button>
  {:else}
    {#if initial && !initial.is_published}
      <Button
        variant="secondary"
        data-action="publish"
        loading={publishing}
        disabled={!publishing && !!publishReason}
        title={publishing ? undefined : (publishReason ?? undefined)}
        bind:element={publishEl}
        onclick={handlePublishClick}
      >{publishing ? 'Publishing…' : 'Publish'}</Button>
    {/if}
    <Button
      variant="ghost"
      data-action="discard"
      disabled={!!discardReason}
      title={discardReason ?? undefined}
      onclick={() => void discard()}
    >Discard</Button>
    <Button
      variant="primary"
      data-action="save"
      loading={saving}
      disabled={!saving && !!saveReason}
      title={saving ? undefined : (saveReason ?? undefined)}
      onclick={() => void handleSave()}
    >{saving ? 'Saving…' : 'Save'}</Button>
  {/if}
{/snippet}

<Modal
  labelledby="mp-modal-title"
  width={820}
  maxHeight={720}
  onRequestClose={requestClose}
  closeDisabled={submitting}
  bodyInert={confirmOpen}
  autofocusSelector={'textarea, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <div class="mpm-block">
    {#if mode === 'create'}
      <label class="mpm-key" for="{uid}-block">Block</label>
      <select
        id="{uid}-block"
        class="mpm-input"
        class:mpm-invalid={!!fieldErrors.block_id}
        bind:value={formData.block_id}
        disabled={submitting}
        aria-invalid={fieldErrors.block_id ? 'true' : undefined}
        aria-describedby={fieldErrors.block_id ? 'err-block_id' : undefined}
      >
        {#each availableBlocks as b (b.id)}
          <option value={b.id}>{blockLabel(b)}</option>
        {/each}
      </select>
    {:else}
      <span class="mpm-key">Block</span>
      {#if currentBlock}
        <span class="mpm-block-name" title={blockLabel(currentBlock)}>{blockLabel(currentBlock)}</span>
      {:else}
        <span class="mpm-block-name mpm-none">—</span>
      {/if}
    {/if}
  </div>
  {#if fieldErrors.block_id}
    <span id="err-block_id" class="field-error mpm-error" role="alert">{fieldErrors.block_id}</span>
  {/if}

  <div class="mpm-field">
    <span class="mpm-label">Assignment</span>
    <MarkdownEditor
      {assetContext}
      bind:value={formData.assignment_md}
      frozen={submitting}
      bind:uploading
      bind:uploadAbortController
      ariaLabel="Assignment"
      ariaDescribedby={ariaDescribedFor('assignment_md')}
    />
    {#if fieldErrors.assignment_md}
      <span id="err-assignment_md" class="field-error mpm-error" role="alert">{fieldErrors.assignment_md}</span>
    {/if}
  </div>

  <div class="mpm-deadlines">
    {#each DEADLINES as d (d.field)}
      <div class="mpm-field">
        <label class="mpm-label" for="{uid}-{d.field}">{d.label} <span class="mpm-zone mono">{zone}</span></label>
        <input
          id="{uid}-{d.field}"
          class="mpm-input mpm-date"
          class:mpm-invalid={!!fieldErrors[d.field]}
          type="datetime-local"
          bind:value={formData[d.local]}
          readonly={submitting}
          aria-invalid={fieldErrors[d.field] ? 'true' : undefined}
          aria-describedby={ariaDescribedFor(d.field)}
        />
        {#if fieldErrors[d.field]}
          <span id="err-{d.field}" class="field-error mpm-error" role="alert">{fieldErrors[d.field]}</span>
        {/if}
      </div>
    {/each}
  </div>

  {#if serverError}
    <div class="banner banner-error mpm-banner" role="alert">{serverError}</div>
  {/if}
  {#if publishAttempted && publishCheckResult && publishCheckResult.length > 0}
    <div class="mpm-box precondition-banner" data-testid="publish-preconditions" role="alert">
      <p class="mpm-box-head">Cannot publish yet</p>
      <ul class="mpm-box-list">
        {#each publishCheckResult as bullet, idx (bullet.text)}
          {#if bullet.text.includes('Open Overview')}
            {@const linkIdx = bullet.text.indexOf('Open Overview')}
            {@const before = bullet.text.slice(0, linkIdx)}
            {@const after = bullet.text.slice(linkIdx + 'Open Overview'.length)}
            <!-- Render the bullet text verbatim. The "Open Overview"
                 substring becomes a <button> when the viewer can act on
                 the precondition (admin, or non-admin-only bullet); for
                 admin-only bullets viewed by a teacher it falls back to
                 plain text so the sentence stays grammatical. -->
            <li id={`precondition-${idx}`}
              >{before}{#if !bullet.adminOnly || course.is_admin}<button
                  type="button"
                  class="linklike"
                  data-action="publish-nav-overview"
                  onclick={() => onNavigateToTab('overview')}>Open Overview</button
                >{:else}Open Overview{/if}{after}</li
            >
          {:else}
            <li id={`precondition-${idx}`}>{bullet.text}</li>
          {/if}
        {/each}
      </ul>
    </div>
  {/if}
</Modal>

<style>
  .mpm-heading {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mpm-block {
    display: grid;
    grid-template-columns: 150px 1fr;
    align-items: center;
    gap: 12px;
  }
  .mpm-key {
    font-size: 12.5px;
    color: var(--muted);
  }
  .mpm-block-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--text); }
  .mpm-none { color: var(--muted); }
  .mpm-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .mpm-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-3);
  }
  .mpm-deadlines {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .mpm-zone {
    font-size: 10.5px;
    font-weight: 400;
    color: var(--muted);
  }
  .mpm-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .mpm-date { font-family: var(--font-mono); font-size: 12.5px; }
  .mpm-invalid {
    border-color: var(--danger);
  }
  .mpm-error { font-size: 12px; color: var(--danger); }
  .mpm-banner {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .mpm-box {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px 10px;
    background: var(--status-needs-revision-bg);
    border-left: 3px solid var(--gold);
    border-radius: 0 5px 5px 0;
    font-size: 12.5px;
    color: var(--status-needs-revision-fg);
  }
  .mpm-box-head {
    margin: 0;
    font-weight: 600;
  }
  .mpm-box-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    line-height: 1.5;
  }
  /* P2: the "·" is drawn, so a bullet's text stays the sentence alone. */
  .mpm-box-list li::before { content: '· '; }
  .linklike {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .linklike:hover { text-decoration: none; }
  .mpm-dirty {
    flex: 1;
    font-size: 11.5px;
    color: var(--status-needs-revision-fg);
  }
  /* The 880px responsive-stack rule belongs on MarkdownEditor's `.edit-content`
     (textarea + sidebar split) — see `MarkdownEditor.svelte`'s media query. */
</style>
```

- [ ] **Step 7: Pass `blocks` and `onCreated`; the locked-edit guard; focus after a create**

In `frontend/src/components/runs/RunMiniProjectsTab.svelte`:

1. Change `import { tick } from 'svelte';` to `import { tick, untrack } from 'svelte';`, and add the toast store to the imports, after `import { focusFirst } from '../../lib/focusFirst';`:

```ts
  import { pushToast } from '../../stores/toasts.svelte';
```

2. Replace `:107-122` (the comment and the `pendingEditTarget` effect) with:

```ts
  // Parent (RunDetailPage) hands us a MP to open in edit mode when the
  // Assets tab's [Edit] action navigates here. P17: open the tab's own row
  // (fresh from miniProjects), not the parent's copy. A locked row or a
  // disabled version opens nothing and toasts the reason its pencil shows.
  // A row that is gone (refetch dropped it) opens nothing. In every case
  // onPendingEditConsumed fires so the parent clears the reference; the
  // early-return on null prevents re-entry once it has. Only the target is
  // tracked: pushToast writes the toast list (a read-then-write of its length),
  // so running the body tracked would re-run the effect without end.
  $effect(() => {
    const target = pendingEditTarget;
    if (!target) return;
    untrack(() => {
      const row = miniProjects.find((mp) => mp.id === target.id);
      if (row) {
        const reason = editReason(row);
        if (reason) {
          pushToast(reason, 'info');
        } else {
          editTarget = row;
          modalMode = 'edit';
        }
      }
      onPendingEditConsumed?.();
    });
  });
```

3. After `const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});` (`:105`), add:

```ts
  const pencilEls: Record<number, HTMLButtonElement | undefined> = $state({});
  let createdId: number | null = null;

  // §Focus › After Create: "+" may now be disabled, so focus the new row's
  // pencil, or else the h2. Wait a tick so FocusTrap's restore has run.
  async function closeModal() {
    modalMode = null;
    editTarget = null;
    const id = createdId;
    createdId = null;
    if (id === null) return;
    await tick();
    focusFirst([pencilEls[id], headingEl]);
  }
```

4. On the row's pencil `IconButton` (`:295-297`), add `bind:element={pencilEls[r.mp.id]}` after `data-action="edit"`.

5. In the `MiniProjectModal` mount (`:328-344`), add `{blocks}` after `{course}`, and replace the `onClose={() => { … }}` prop with:

```svelte
      onClose={() => void closeModal()}
      onCreated={(mp) => (createdId = mp.id)}
```

- [ ] **Step 8: Run the mini-project tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MiniProjectModal.frame.svelte.test.ts src/tests/MiniProjectModal.create-edit.svelte.test.ts src/tests/MiniProjectModal.publish.svelte.test.ts src/tests/MiniProjectModal.teacher-gating.svelte.test.ts src/tests/RunMiniProjectsTab.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts`
Expected: PASS (all six files). The teacher-gating suite still clicks Publish before reading the box; the bullets' exact text holds because the "·" is CSS (P2).

- [ ] **Step 9: Gate rows; the (af) comment; the backlog lines**

In section (ak) of `frontend/scripts/visual-refresh-gate.sh`, add `src/components/runs/MiniProjectModal.svelte` as the last line of `FILES_6B`, and append after the RosterImportModal block:

```zsh
srcw runs/MiniProjectModal.svelte 820
own mpm-block MiniProjectModal.svelte
uniq1 mpm-block
if [[ -n $REPLY ]]; then
  N=MiniProjectModal; H=$REPLY
  d '\.mpm-heading' '' 'font-size:15px' 'font-weight:600' 'white-space:nowrap' 'text-overflow:ellipsis'
  d '\.mpm-block' '' 'display:grid' 'grid-template-columns:150px 1fr' 'gap:12px'
  d '\.mpm-key' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.mpm-label' '' 'font-size:12\.5px' 'font-weight:500' 'color:var\(--text-3\)'
  d '\.mpm-deadlines' '' 'display:grid' 'grid-template-columns:repeat\(3,1fr\)' 'gap:12px'
  d '\.mpm-zone' '' 'font-size:10\.5px' 'color:var\(--muted\)'
  d '\.mpm-input' '' 'height:var\(--control-h\)' 'border:1px solid var\(--border-strong\)'
  d '\.mpm-invalid' '' 'border-color:var\(--danger\)'
  d '\.mpm-dirty' '' 'flex:1' 'font-size:11\.5px' 'color:var\(--status-needs-revision-fg\)'
  d '\.mpm-banner' '' 'background:var\(--status-rejected-bg\)' 'border-left:3px solid var\(--danger\)'
  d '\.mpm-box' '' 'padding:8px 10px' 'background:var\(--status-needs-revision-bg\)' 'border-left:3px solid var\(--gold\)' 'border-radius:0 5px 5px 0' 'color:var\(--status-needs-revision-fg\)'
  d '\.mpm-box-head' '' 'font-weight:600'
  sweep MiniProjectModal $H
fi
```

Replace the comment above `FILES_5B` at `:4217-4218` (section (af); (ag) reuses the list — the spec's §Gate calls it "the (ag) comment") with:

```zsh
# MiniProjectModal.svelte is left out here: Slice 6b restyled it, and section
# (ak) scans it with the other teacher modals (FILES_6B).
```

Set `EXPECTED_CHECKS=1768` (1732 + 36: srcw 1, own/uniq1 2, 31 declarations, sweep 2).

Append one line under each backlog entry:
- `docs/backlog/slice5b-authoring-polish-debt.md:258`: `  6b (Task 4): MiniProjectModal and the run modals are scanned in section (ak), FILES_6B, not (ag).`
- `docs/backlog/slice5c-constructor-polish-debt.md:162`: `  6b (Task 4): MiniProjectModal numbers blocks by position too (R21). Closed.`
- `docs/backlog/slice6a-teacher-restyle-debt.md:106`: `  6b (Task 4): fixed — the "used by → Edit" path toasts the row's edit reason and opens nothing (P17).`

- [ ] **Step 10: Run the full checks**

As Global Constraints › Commands. Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (1768 checks)`.

- [ ] **Step 11: Screenshots for the user**

Find a run with groups enabled and a draft mini-project (`GET /api/runs/{id}/mini-projects` through the dev proxy); open it at `http://localhost:5174/teaching/demo-course/runs/{id}?tab=mini-projects`. Mock `**/api/mini-projects/*` (PATCH → 200 with the shown mini-project), `**/api/runs/*/mini-projects` (POST → 201 with a new one) and `**/api/mini-projects/*/publish` before any click. Shots at 1280 and 1000:
1. the editor open, clean;
2. after typing (the "unsaved changes" marker; Publish disabled);
3. the discard confirm (× pressed with edits);
4. the box after a Publish click on a mini-project with an unmet precondition (Task 4 still waits for the click);
5. New mini-project (create).

Overlay with 10m beside them; wait for the user's OK. Clear the routes.

- [ ] **Step 12: Review lanes**

Opus (high) + Fable on the uncommitted diff. Point them at Review Focus 1, 4 and 5. Fix Critical/Important, re-run after every fix until clean. Minors → backlog "## Task 4 — Mini-project editor".

- [ ] **Step 13: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/MiniProjectModal.svelte frontend/src/components/runs/RunMiniProjectsTab.svelte \
  frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/MiniProjectModal.frame.svelte.test.ts frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts \
  frontend/src/tests/MiniProjectModal.publish.svelte.test.ts frontend/src/tests/RunMiniProjectsTab.svelte.test.ts \
  docs/backlog/slice5b-authoring-polish-debt.md docs/backlog/slice5c-constructor-polish-debt.md \
  docs/backlog/slice6a-teacher-restyle-debt.md
git commit -m "$(cat <<'EOF'
feat(6b): Mini-project editor on ui/Modal (10m): Save stays open, Discard, confirms, DirtyGuard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Add the 6b backlog file if the lanes left minors. Then the ledger line, memory, and wait for "go".

---

### Task 5: The mini-project's precondition box, up front (D13, D21, R22)

**Files:**
- Modify: `frontend/src/components/runs/MiniProjectModal.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (ak), `EXPECTED_CHECKS`)
- Create: `frontend/src/tests/MiniProjectModal.box.svelte.test.ts` (P15)

**Interfaces:**
- Consumes (Task 4, inside `MiniProjectModal.svelte`): `publishCheckResult`, `publishAttempted`, `publishReason`, `preconditionIdsByField`, `handlePublishClick()`, `confirmPublish()`, the box markup `div.mpm-box.precondition-banner[data-testid="publish-preconditions"][role="alert"]`, and the gate block that sets `N=MiniProjectModal; H=$REPLY`.
- Produces: `boxShows` (`$derived`), which replaces `publishAttempted` everywhere. No prop or API change.

- [ ] **Step 1: Write the failing box tests**

Create `frontend/src/tests/MiniProjectModal.box.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import { __resetGuardsForTests } from '../lib/router.svelte';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';

type ModalProps = ComponentProps<typeof MiniProjectModal>;

const course: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
const blocks: BlockResponse[] = [
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 5, info: '', info_html: '' },
  { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 9, info: '', info_html: '' },
];

// A draft whose publish preconditions are all met (2027 deadlines, before runEndDate).
function mp(o: Partial<MiniProjectResponse> = {}): MiniProjectResponse {
  return {
    id: 99, run_id: 10, block_id: 2, title: 'Mini project for Block 2',
    assignment_md: 'orig text', assignment_html: '<p>orig text</p>',
    soft_deadline: '2027-06-01T10:00:00Z', hard_deadline: '2027-06-15T10:00:00Z',
    resubmission_deadline: '2027-06-20T10:00:00Z',
    is_published: false, first_submitted_at: null,
    created_at: '2027-05-01T00:00:00Z', updated_at: '2027-05-01T00:00:00Z',
    ...o,
  };
}

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
let cmp: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres([]));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  __resetGuardsForTests();
});

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

function baseProps(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 10, mode: 'edit', initial: mp(), availableBlocks: [], currentBlock: blocks[1], blocks,
    runIsPublished: true, versionIsDisabled: false, runEndDate: '2027-06-30', course,
    onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined), onNavigateToTab: vi.fn(),
    ...over,
  };
}
function open(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(MiniProjectModal, { target, props: props as ModalProps });
}
function reopen(props: Record<string, unknown>) {
  if (cmp) unmount(cmp);
  cmp = null;
  document.body.innerHTML = '';
  open(props);
}

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const box = () => panel().querySelector<HTMLElement>('[data-testid="publish-preconditions"]');
const bullets = () => [...box()!.querySelectorAll('li')].map((li) => li.textContent);
const btn = (a: string) => panel().querySelector<HTMLButtonElement>(`button[data-action="${a}"]`);
const closeX = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const ta = () => panel().querySelector<HTMLTextAreaElement>('textarea')!;
const hardInput = () => panel().querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1];
function type(text: string) {
  ta().value = text;
  ta().dispatchEvent(new Event('input', { bubbles: true }));
}

describe('MiniProjectModal — the precondition box up front (D13, D21, R22)', () => {
  it('shows without a Publish click while editing an unpublished mini-project with an unmet precondition', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    expect(box()).not.toBeNull();
    expect(box()!.querySelector('.mpm-box-head')!.textContent).toBe('Cannot publish yet');
    expect(bullets()).toEqual(['Hard deadline must be set']);
  });

  it('never shows when creating, nor on a published mini-project', async () => {
    open(baseProps({ mode: 'create', initial: null, currentBlock: null, availableBlocks: blocks }));
    await settle();
    expect(box()).toBeNull();
    reopen(baseProps({ initial: mp({ is_published: true, hard_deadline: null }) }));
    await settle();
    expect(box()).toBeNull();
  });

  it('follows the fields on screen: fixing a deadline removes its line, clearing the assignment adds one (D21)', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    hardInput().value = '2027-06-16T10:00';
    hardInput().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(box()).toBeNull();
    type('');
    await settle();
    expect(bullets()).toEqual(['Assignment text is required']);
  });

  it('typing into a mini-project whose preconditions are all met never shows it (R22)', async () => {
    open(baseProps());
    await settle();
    expect(box()).toBeNull();
    type('more text');
    await settle();
    expect(box()).toBeNull();
    expect(btn('publish')!.title).toBe('Save your changes first');
  });

  it('is information, not an alert: it has no live role', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    expect(box()!.hasAttribute('role')).toBe(false);
  });

  it('wires each field\'s aria-describedby to its bullets whenever it shows, without a click', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null, assignment_md: '' }) }));
    await settle();
    const lis = [...box()!.querySelectorAll('li')];
    const assign = lis.find((li) => li.textContent === 'Assignment text is required')!;
    const hard = lis.find((li) => li.textContent === 'Hard deadline must be set')!;
    expect(ta().getAttribute('aria-describedby')?.split(/\s+/)).toContain(assign.id);
    expect(hardInput().getAttribute('aria-describedby')?.split(/\s+/)).toContain(hard.id);
  });

  it('Publish is disabled with D13\'s title while it shows, even when the form is also dirty', async () => {
    open(baseProps({ initial: mp({ hard_deadline: null }) }));
    await settle();
    expect(btn('publish')!.disabled).toBe(true);
    expect(btn('publish')!.title).toBe('Resolve the listed preconditions first');
    type('more text');
    await settle();
    expect(btn('publish')!.title).toBe('Resolve the listed preconditions first');
  });

  it('a confirm opened before a precondition broke refuses it; focus goes to × (D13)', async () => {
    const props = $state(baseProps());
    open(props);
    await settle();
    btn('publish')!.click();
    await settle();
    props.versionIsDisabled = true;
    await settle();
    btn('confirm-publish')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('/publish'))).toBe(false);
    expect(bullets()).toContain("This run's course version is disabled — Open Overview to re-enable it.");
    expect(btn('publish')!.disabled).toBe(true);
    expect(document.activeElement).toBe(closeX());
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MiniProjectModal.box.svelte.test.ts`
Expected: FAIL — six tests fail (the box waits for a click, has `role="alert"`, and Publish is enabled). Two pass already and guard the new rule: "never shows when creating, nor on a published mini-project" and "typing … never shows it (R22)".

- [ ] **Step 3: Show the box up front**

In `frontend/src/components/runs/MiniProjectModal.svelte`:

1. In the publish-flow comment, replace the two lines

```ts
  // onNavigateToTab('overview'). publishAttempted flips on the first Publish
  // click so the box only appears after the user tries. `adminOnly` flags
```

with

```ts
  // onNavigateToTab('overview'). D13: the box shows up front whenever a
  // precondition is unmet. `adminOnly` flags
```

2. Delete `let publishAttempted = $state(false);` and add, right after the `publishCheckResult` block:

```ts
  // D13 / D21: the box shows while editing an unpublished mini-project with an
  // unmet precondition, computed from the values on screen.
  const boxShows = $derived(!!publishCheckResult && publishCheckResult.length > 0);
```

3. Replace the `publishReason` line with:

```ts
  const publishReason = $derived(
    uploading
      ? UPLOAD_WAIT
      : boxShows
        ? 'Resolve the listed preconditions first'
        : dirty
          ? 'Save your changes first'
          : null,
  );
```

4. In `preconditionIdsByField`, replace `if (!publishAttempted || !publishCheckResult) return {};` with:

```ts
    if (!boxShows || !publishCheckResult) return {};
```

5. Replace `handlePublishClick` with:

```ts
  function handlePublishClick() {
    if (submitting || publishReason) return;
    pendingPublishConfirm = true;
  }
```

6. In `confirmPublish`, replace the recheck block with:

```ts
    if (boxShows || dirty) {
      await tick();
      focusFirst([publishEl, closeX()]);
      return;
    }
```

7. In the markup, replace the box's opening lines:

```svelte
  {#if publishAttempted && publishCheckResult && publishCheckResult.length > 0}
    <div class="mpm-box precondition-banner" data-testid="publish-preconditions" role="alert">
```

with:

```svelte
  {#if boxShows && publishCheckResult}
    <div class="mpm-box precondition-banner" data-testid="publish-preconditions">
```

- [ ] **Step 4: Run the mini-project tests**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MiniProjectModal.box.svelte.test.ts src/tests/MiniProjectModal.frame.svelte.test.ts src/tests/MiniProjectModal.create-edit.svelte.test.ts src/tests/MiniProjectModal.publish.svelte.test.ts src/tests/MiniProjectModal.teacher-gating.svelte.test.ts src/tests/RunMiniProjectsTab.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts`
Expected: PASS (all seven files). The old precondition tests click a now-disabled Publish, which does nothing, and find their bullets in the up-front box. "versionIsDisabled flips while modal already open" (`publish.svelte.test.ts:398`) still passes: the recheck refuses, and focus goes to ×.

- [ ] **Step 5: Gate rows**

In section (ak) of `frontend/scripts/visual-refresh-gate.sh`, inside the MiniProjectModal `if` block, add after the `.mpm-box-head` row:

```zsh
  d '\.mpm-box-list' '' 'gap:4px' 'line-height:1\.5'
```

and after that block's `fi`:

```zsh
# D13: the precondition box shows up front, and it is information, not an alert.
MPM=src/components/runs/MiniProjectModal.svelte
if grep -q 'publishAttempted' $MPM; then
  echo "FAIL  MiniProjectModal's precondition box waits for a Publish click (D13)"; fail=1
else echo "PASS  MiniProjectModal's precondition box waits for no Publish click (D13)"; fi
box_line=$(grep 'data-testid="publish-preconditions"' $MPM)
if [[ $(grep -c 'data-testid="publish-preconditions"' $MPM) -eq 1 && $box_line != *role=* ]]; then
  echo "PASS  MiniProjectModal's precondition box has no live role"
else echo "FAIL  MiniProjectModal's precondition box has no live role"; fail=1; fi
```

Set `EXPECTED_CHECKS=1772` (1768 + 4: two declarations, two source checks).

- [ ] **Step 6: Run the full checks**

As Global Constraints › Commands. Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (1772 checks)`.

- [ ] **Step 7: Screenshots for the user**

As Task 4's Step 11, with the same mocks: a draft with an unmet precondition shows the gold box on open (no click), Publish disabled with its title; fixing the deadline in the field removes its line; typing into a mini-project whose preconditions are all met shows only "unsaved changes". 1280 and 1000; overlay with 10m; wait for the user's OK. Clear the routes.

- [ ] **Step 8: Review lanes**

Opus (high) + Fable on the uncommitted diff. Fix Critical/Important, re-run after every fix until clean. Minors → backlog "## Task 5 — The precondition box".

- [ ] **Step 9: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/MiniProjectModal.svelte frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/MiniProjectModal.box.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6b): the mini-project's precondition box shows up front (D13, D21, R22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Add the 6b backlog file if the lanes left minors. Then the ledger line and memory. 6b's tasks are done: next, on the user's "go", the whole-branch review (fresh Opus + Fable on `8074983..HEAD`, with the plan's Review Focus), then the 6b browser pass (spec §Carried to the 6b browser pass), one step at a time.

