# Slice 6c: Overview, Roster and the side panel — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** draw the teacher run page's Overview (10a), Roster (10b) and grading / progress side panel (9b) to the approved screens, add the server guard against force-deleting a published run, and close the items routed from 6a and 6b.

**Architecture:**
- **Overview.** `RunOverviewTab` becomes two columns of cards. Run details edit one field at a time through `ui/InlineName` (R31). The Overview holds one `runWrite` lock over its own requests and the page's publish / unpublish (R32). Publish and Unpublish move from the title row into the Publish readiness card. The page keeps the requests, the load token and the conflicts modal, and returns an outcome the Overview turns into focus (R33). "Delete this run" force-deletes through `ui/DangerConfirm` (D24).
- **One backend change (D28).** `delete_run` refuses a published run on both paths.
- **Roster.** `RunRosterTab` gets the 10b toolbar with an add row behind + (D25), the bulk strip, the result banner and the table. Busy controls keep focus and ignore input (R44). The import modal renders in the page's loaded branch, so a tab change no longer unmounts it (R39).
- **Side panel.** `DashboardSidePanel` renders on `ui/Modal` with `placement="right"` (R30, D27); a click on the dimmed page does not close it (D29). The read-only cards move to `SubmissionCards.svelte` as exported snippets; the evaluation form is one snippet with four native radios (R37, R43). The Progress variant moves to `ProgressBreakdown.svelte`.
- **Shared pieces gain small props:**
  - `Modal`: `placement`, `closeTitle`;
  - `InlineName`: `type`, `emptyTitle`;
  - `IconButton`: `aria-disabled`, `href`, `download`, `describedby`;
  - `Switch`: `onchange`;
  - `Button`: `aria-disabled`, and `aria-busy` while loading;
  - `DangerConfirm`: refocuses its box after a request (R45).

**Tech Stack:**
- **Svelte:** Svelte 5.55, runes only, no JS/CSS dependencies.
- **Frontend tests:** Vitest + jsdom, with `mount` / `unmount` / `flushSync` from `svelte`.
- **Backend:** FastAPI + SQLAlchemy on PostgreSQL 17; pytest through `backend/.venv`.
- **Gate:** the zsh gate `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel-design.md` (rev 4, commit `6402e1e`, approved by the user on 2026-10-13). Its D24–D29 and R30–R45 are binding; this plan cites them by number. Where it is silent, the 6a spec (rev 5) and the 6b spec (rev 4) hold: 6a D5, D6, D8, R13, §Focus, P10; 6b D11, R16, R19, R20.
**Design authority:** `docs/design/visual-refresh/reference-screens.dc.html` screens 10a (`:481-585`), 10b (`:586-670`), 9b (`:1147-1250`). Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/{10a,10b,9b}.png`.

## Global Constraints

- **Branch:** `feat/visual-refresh-slice6-teacher` (HEAD `6402e1e` when this plan was written). LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`. Scratch files go in `.superpowers/sdd/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel/` (the "6c sdd dir": probes in `probe/`, gate temp files and logs in `tmp/`), never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. No new npm or pip dependencies.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, NOT `@testing-library/svelte`.
  - Python only through `backend/.venv` (`backend/.venv/bin/pytest`, never a bare `pytest`).
  - Match the surrounding comment density. No comments that narrate the change ("moved in 6c").
- **Colours and glyphs:**
  - No literal colours in component CSS or inline `style=`; theme tokens only (`src/styles/theme-default.css`). No `hsl(`, no hex fallbacks in `var(--x, #…)`. `Modal.svelte`'s two shadows are the only allowed literals (R30).
  - No `opacity` to dim anything.
  - No emoji and no glyph characters from the gate's `emoji_scan` set in component code: no `✓ ✗ × → ✎ 🗑 ⤓ ＋`. The scan strips comments and does not read test files. Icons are inline SVG or `IconButton` glyphs. `—`, `·`, `…` and `›` are allowed text.
  - Numerals, e-mails, dates and versions are mono (`font-family: var(--font-mono)`) wherever the drawing sets them so. The Overview's Start and End are not (P30).
- **Class prefixes:** `ov-` RunOverviewTab, `ro-` RunRosterTab, `sp-` DashboardSidePanel, `sc-` SubmissionCards, `te-` SubmissionThreadEntry, `pb-` ProgressBreakdown. The gate's `own` needs a class authored by one file only.
- **Pinned CSS rules are single-selector blocks.** The gate's `d` helper matches `.cls.svelte-HASH{…}`, so a pinned rule never shares a selector list. Test-hook classes (`confirm`, `cancel`, `hint-button`, `form-error`, `banner-error`) stay unstyled or are styled only through a prefixed class beside them.
- **Commands** (`$SDD` below stands for `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel`; write it out in full when you run them):
  - Frontend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. One file: `TZ=Europe/Copenhagen npx vitest run src/tests/<File>.test.ts` from the same directory.
  - Typecheck: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error > $SDD/tmp/svelte-check.log 2>&1; tail -3 $SDD/tmp/svelte-check.log`. It must report 0 errors. 13 warnings is the baseline; a task may not add one.
  - Gate: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. It must end `VISUAL-REFRESH GATE: ALL PASS (N checks)` with the N the task names. Never run it in two lanes at once.
  - Backend (Task 2): `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo "exit $?"; tail -3 $SDD/tmp/pytest.log`. One file: `.venv/bin/pytest tests/test_runs.py -q`.
  - If a pinned gate row fails only because the minifier wrote a value differently, read the emitted rule (`grep -oE '\.CLASS\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`), match the emitted form, and ledger a ruling. Never loosen a row to make it pass.
- **Per task, in this order** (the user's per-task loop; it overrides "continuous execution"):
  1. TDD, step by step as written.
  2. vitest (green as defined above), svelte-check (0 errors), the gate (the task's N); Task 2 also the backend suite.
  3. agent-browser screenshots of the real screen at 1280 and 1000 wide (dev data, run 8, plus network mocks for every write), in an agterm overlay with `--size-percent 60`, images as base64, the HTML in the 6c sdd dir (copy the shape of `.superpowers/sdd/2026-10-10-visual-refresh-slice6a-teacher-restyle/mk-t11.py`). Then the user's OK on the look.
  4. Two review lanes, Opus (high) and Fable, on the UNCOMMITTED diff. Fix every Critical and Important finding, then re-run both lanes after EVERY fix until both are clean. Minors go to `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md` (created in Task 1) under the task's heading. Do not edit the tree while a lane reviews.
  5. Commit with exact paths (never `git add -A`) and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (no session line).
  6. Ledger line in `$SDD/progress.md`, update memory, then WAIT for the user's "go" before the next task.
- **Dev servers for screenshots** (both already run in this session; never start a second copy):
  - Backend: uvicorn started with `MATHION_DEBUG=1 MATHION_ASSET_PATH="$HOME/mathion-assets"`; the PIN appears in `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/backend.log`.
  - Frontend: vite on `http://localhost:5174`. agent-browser session `mathion-0fb6bc751f3c` (`export AGENT_BROWSER_SESSION=mathion-0fb6bc751f3c`), signed in as `dev@mathion.test`. Screenshot paths must be absolute.
  - Logins: `dev@mathion.test` (course admin) and `teacher@mathion.test` (teacher of run 8). Run 8 lives at `/teaching/demo-course/runs/8?tab=…`.
  - Never write to shared dev data without the user's yes. Every field save, switch, publish, unpublish, delete, add, move, remove and evaluation request in a screenshot is mocked with `agent-browser network route "<url glob>" --body '…'` (status per the core guide, `agent-browser skills get core --full`). Never press Enter in a real field unless its request is mocked. No real quiz attempts.
- **Texts are verbatim** from the spec's §Copy changes and its Overview, Roster and Side panel sections. Tests compare them exactly. ASCII apostrophes, singular at 1 ("1 student is…", "Remove 1 student from this run?").

## Rulings made while planning

Each states what it costs if wrong. P-numbers continue from 6b's P18.

- **P19 — The readiness and outcome types live in `RunOverviewTab`'s `<script module>`**: `ReadinessRow`, `Readiness`, `PublishOutcome`, `UnpublishOutcome`, `DeleteOutcome`. The page imports them from there (`import RunOverviewTab, { type Readiness, … } from …`). *Cost:* none; no new lib file.
- **P20 — The readiness hint links carry `data-action="goto-teachers"` and `"goto-groups"`.** The Roster one keeps `goto-unassigned`. *Cost:* names.
- **P21 — `InlineName`'s `emptyTitle` defaults to `saveTitle`**, not to "Save" as R31 words it, so the Groups rename keeps its "Save name" while empty. *Cost:* none for existing callers.
- **P22 — The Delete card's `<h2>` is 13px / 600, as drawn** (a one-line card); the other card titles are 14px / 600. *Cost:* 1px.
- **P23 — An `aria-disabled` control looks disabled.** `Button` gets `class:blocked={ariaDisabled && !loading}` and `IconButton` gets `class:blocked={ariaDisabled}`, each with the `:disabled` tokens (`--bg`, `--faint`, `--border-faint`, `cursor: not-allowed`). A busy `Button` (loading) keeps its variant look and its spinner. *Cost:* two rules.
- **P24 — The page owns the delete toasts** ("Run deleted.", "This run was published in the meantime. Unpublish it before deleting."); the Overview owns the panel, the error line and the focus. *Cost:* none.
- **P25 — The page passes `publishing={publishing || unpublishing}`.** Only one of Publish run and Unpublish is ever on screen, so one flag drives both; "Publishing…" shows only on a draft. *Cost:* none.
- **P26 — The Overview's props become** `run`, `setRun`, `pinned`, `isAdmin`, `readiness`, `publishing`, `onNavigateTab`, `onPublish`, `onUnpublish`, `onDeleteRun`. `course`, `teachers`, `groups` and `students` go: the Overview read only `course.is_admin`, and the rows carry the rest. *Cost:* none.
- **P27 — While the unpublish request runs, the Unpublish confirm's Cancel and Esc do nothing.** The control Cancel would focus (Unpublish) is `aria-disabled` then. *Cost:* the confirm cannot be dismissed for the length of one request.
- **P28 — `InlineName` gains `type` only for its `<input>`; a date's value is trimmed like text**, and "unchanged" compares the ISO strings. *Cost:* none.
- **P29 — Task 1 keeps the old readiness and delete markup**, moved into the right column (the spec's Task 1 screenshot note), but strips their hex fallbacks so the (al) sweep passes. `RunOverviewTab` joins `FILES_6C` in Task 2, when the old ✓ ✗ glyphs go. *Cost:* one interim commit with old-looking lower cards.
- **P30 — Start and End are in the body face, not mono.** 10a draws "01 Sep 2026" at 13px in the body font; the version's "v. N" is mono. *Cost:* a font.
- **P31 — The retry select's placeholder writes its arrow as `&rarr;`.** It renders the spec's "Retry N → group…" verbatim, and the gate's `emoji_scan` forbids a raw ← … ⇿ character in component code. *Cost:* one HTML entity.
- **P32 — `RunRosterTab` joins `FILES_6C` and gets its `sweep` in Task 4, not Task 3.** Task 3 leaves the old strip, result banner and table in place, with their "× clear" and "→" glyphs and their hex fallbacks; Task 4 replaces them. *Cost:* one interim commit whose roster file is not glyph- or colour-scanned.
- **P33 — The add row's Esc handler sits on its `<form>`, under `<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->`.** A probe showed `<form onkeydown>` warns and that `role="group"` warns too; the comment is the only warning-free form. *Cost:* one ignore comment.
- **P34 — Closing the add row (Esc, Cancel, the toggle) is ignored while an add runs; closing clears the error but keeps the typed e-mail.** While busy, Add has the R44 title "Wait for the current change to finish". After an add, success or failure, focus goes to the e-mail field (6b R20: the field the error is about). *Cost:* none.
- **P35 — The bulk confirm replaces everything after "N selected"** (the move select, 🗑 and Clear selection), so its two buttons are the only actions while it asks. *Cost:* layout only.
- **P36 — The bulk-move and retry selects are uncontrolled (no `bind:value`).** One helper reads `el.value`, resets it to `''` and returns while a bulk op runs (R44). That makes the reset independent of Svelte's binding order. *Cost:* none.
- **P37 — Two new hooks:** `data-action="open-add-link"` (the empty state's "Add student") and `"cancel-add-student"` (the add row's Cancel). *Cost:* names.
- **P38 — The Group column renders only when groups are on.** Today's "—" column goes. The table renders only while a row is visible; the empty state or the no-match line replaces it. *Cost:* a column.
- **P39 — "Move the N not processed…" and "Retry the N not processed" count what the retry sends: the cancelled and the failed students.** The retry selects' hidden labels use the singular at 1 ("Move the 1 failed student to a group"). The cancelled select's label reads "Move the N not processed students to a group". *Cost:* copy.
- **P40 — Sizes as drawn:** selects are 26px, the search and e-mail fields `--control-h-sm` (28px), and the add toggle is `IconButton size="sm"` (24px). *Cost:* 2px between a field and a select.
- **P41 — `isAdmin` is a required `RunRosterTab` prop.** Every roster test helper passes `isAdmin: true`. *Cost:* test churn.
- **P42 — A settled bulk op moves focus (§Focus) only when focus is on `<body>` or inside the strip or the banner.** A teacher who moved on keeps their place. After the bulk confirm's Remove, focus waits on the strip's 🗑 (`aria-disabled` while the op runs). *Cost:* one guard.
- **P43 — An emptied selection closes an open bulk confirm** (one `$effect`), so the confirm never comes back open with the next selection. *Cost:* one effect.
- **P44 — `IconButton`'s link variant renders only while not `disabled`.** A disabled control stays a `<button>`. The link carries no `aria-disabled`, `aria-expanded` or `aria-controls`, and does not bind `element`. *Cost:* none for Task 6's download.
- **P45 — The marked-row rule is `.ro-mark` on the row's first cell.** `row-error` stays on the `<tr>` as an unstyled test hook (the bulk tests read it). *Cost:* none.
- **P46 — Task 5 draws the frame, the header, the discard footer and the Progress view only.** The submission body keeps its markup and its old styles until Task 6 rewrites the file; `DashboardSidePanel` joins `FILES_6C` (with its `sweep`) in Task 6. *Cost:* one interim commit whose submission body still looks old.
- **P47 — `SubmissionCards` exports more than the two snippets R43 names:** a third snippet `submissionChips` (the "resubmission" / "late" chips sit in the panel's card head, and an opened earlier submission needs them too), the helper `evaluatedLine(ev)` ("{by} · {when}") and the type `EvaluationView`. *Cost:* three more exports.
- **P48 — `Button` gains a `data-test` pass-through**, so Edit and Cancel keep `edit-evaluation` and `cancel-button` on the shared Button. New test hooks: `data-test="evaluation-card"` (the read-only card), `"submission-content"` and `"evaluation-content"` (the snippets' rows), `data-action="attach-feedback-file"` and `"remove-feedback-file"`. *Cost:* one prop.
- **P49 — The panel finds Modal's `.modal-panel` and × from its own title** (`titleEl.closest('.modal-panel')`); Modal exposes no refs. *Cost:* a DOM query.
- **P50 — The form card is headed "Evaluate" in create and in edit mode** (the spec: Edit "turns the card into the Evaluate form"). *Cost:* wording.
- **P51 — Save's `title` while a save runs is "Wait for the save to finish"**, the same as ×'s `closeTitle` (R44 asks for a reason title). *Cost:* wording.
- **P52 — A 409 race focuses × at once** (the form is gone and the winning card has not loaded yet). When the Evaluation card renders, its `<h3>` takes focus only if focus is still on × or `<body>`. *Cost:* none.
- **P53 — Feedback and Score align to the top (`align-items: start`), not the drawn `end`.** An error or the counter under Feedback then leaves Score in place; the drawn state looks the same. *Cost:* none.
- **P54 — Undrawn details use tokens.**
  - The Evaluate head's bottom line is `--border`, because the drawn `#D8E1E9` has no token.
  - The read-only Score is mono.
  - Feedback reads "—" when the text is empty as well as when it is null.
  - The "Evaluation" sub-heading of an opened earlier submission is an `<h4>` 12.5px / 600.

  *Cost:* small visual differences from an undrawn ideal.
- **P55 — `lib/dashboards.ts` gets two narrowing helpers beside the maps.** `RESULT_LABEL` (typed over `EvaluationResult`) gets `resultLabel(result: string)`, so the thread's untyped `result` maps and an unknown one shows raw. `ITEM_TYPE_NAME` gets `drillItemType(t: string): DrillItemType | null`, which uses `hasOwnProperty`, so `"toString"` is not a type. *Cost:* two helpers.

## Review Focus

The five inputs or conditions most likely to bite a teacher that no spec line tests directly. Each has its test in the owning task.

1. **Leaving the Overview mid-save.** A teacher saves a field and switches to Roster before the response lands. When they come back, nothing is locked and the saved value shows. Test: Task 1.
2. **A field save rejected with a 422 field list** (a non-string `detail`). The field stays open with "Please correct the highlighted fields." under it, with no toast and no silent close. Test: Task 1.
3. **Long text.** A 200-character title and a 254-character e-mail wrap inside their cells; the Overview grid and the roster table keep their columns. Gate pins: Task 1 (`overflow-wrap:anywhere` on the details value), Task 4 (on the e-mail cell).
4. **More than 200 selected students.** The in-flight banner counts all of them ("Moving 236…"), and a select change between the chunks sends nothing. Test: Task 4.
5. **A submission made at 23:30 UTC.** Its earlier-submission row shows the viewer's local date (the next day in Copenhagen); Start and End never shift a day. Tests: Task 6 (`formatLocalShortDate`), Task 1 (the Start row reads "01 Jun 2026").

## Gate ladder

`EXPECTED_CHECKS` starts at **1774** (`frontend/scripts/visual-refresh-gate.sh:90`). Section (al) is created in Task 1; each task appends its rows to it and its files to `FILES_6C`.

| Task | Adds | `EXPECTED_CHECKS` |
|---|---|---|
| start | | 1774 |
| 1 — Overview details and settings | 36 | 1810 |
| 2 — Readiness, publish and delete | 41 | 1851 |
| 3 — Roster toolbar, add row, empty states | 35 | 1886 |
| 4 — Roster strip, banner and table | 35 | 1921 |
| 5 — Drawer frame and progress view | 47 | 1968 |
| 6 — Submission cards and evaluation form | 94 | 2062 |

## File map

| File | Task | What changes |
|---|---|---|
| `frontend/src/components/ui/InlineName.svelte` | 1 | `type`, `emptyTitle` (R31, P21, P28) |
| `frontend/src/components/ui/Switch.svelte` | 1 | `onchange` (R42) |
| `frontend/src/components/runs/RunOverviewTab.svelte` | 1, 2 | 10a: layout, Run details, Settings (1); readiness, publish, delete (2) |
| `frontend/src/pages/runs/RunDetailPage.svelte` | 1, 2, 3 | Overview props (1); readiness rows, publish / unpublish / delete outcomes, no publish bar (2); the import modal in the loaded branch, `isAdmin` to Roster (3) |
| `frontend/src/components/ui/Button.svelte` | 2, 6 | `aria-disabled`, `aria-busy` while loading (R44, P23) (2); `data-test` (6, P48) |
| `frontend/src/components/ui/IconButton.svelte` | 2, 3 | `aria-disabled` (2); `href`, `download`, `describedby` (3) |
| `frontend/src/components/ui/DangerConfirm.svelte` | 2 | refocus after a request (R45) |
| `frontend/src/lib/runs.ts` | 2 | `deleteRun(runId, { force })` |
| `backend/mathion/api/runs.py`, `backend/mathion/api/submission_files.py` | 2 | D28 guard; comments |
| `backend/tests/test_runs.py`, `backend/tests/test_concurrency_mini_project.py` | 2 | D28 tests |
| `frontend/src/components/runs/RunRosterTab.svelte` | 3, 4 | 10b: banner, toolbar, add row, empty states (3); strip, result banner, table, confirms (4) |
| `frontend/src/components/ui/Modal.svelte`, `frontend/src/tests/support/ModalHarness.svelte` | 5 | `placement`, `closeTitle` (R30) |
| `frontend/src/components/runs/DashboardSidePanel.svelte` | 5, 6 | on Modal, header, discard footer (5); submission cards, evaluation form (6) |
| `frontend/src/components/runs/ProgressBreakdown.svelte` (new) | 5 | the Items card |
| `frontend/src/lib/dashboards.ts` | 5, 6 | `ITEM_TYPE_NAME` (5); `RESULT_LABEL` (6) |
| `frontend/src/components/runs/SubmissionCards.svelte` (new) | 6 | `submissionContent`, `evaluationContent` snippets |
| `frontend/src/components/runs/SubmissionThreadEntry.svelte` | 6 | the disclosure row |
| `frontend/src/components/runs/RunSubmissionTab.svelte` | 6 | passes `blockLabel` (R35) |
| `frontend/src/lib/datetime.ts` | 6 | `formatLocalShortDate` |
| `frontend/scripts/visual-refresh-gate.sh` | 1–6 | section (al), the (aa) allowance (5), `EXPECTED_CHECKS` |
| `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md` (new) | 1 | the 6c backlog |
| tests (see each task), incl. new `RunRosterTab.toolbar` (3), `RunRosterTab.table` (4), `ProgressBreakdown` (5), `SubmissionCards` + its harness (6) | 1–6 | |

---

### Task 1: Overview — layout, Run details and Settings

**Files:**
- Modify: `frontend/src/components/ui/InlineName.svelte:11-30` (props), `:78-96` (the input and ✓)
- Modify: `frontend/src/components/ui/Switch.svelte:6-27` (props, `toggle`)
- Modify: `frontend/src/components/runs/RunOverviewTab.svelte` (whole file: new script, markup and style; the old readiness and delete markup moves into the right column unchanged, P29)
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte:414-424` (the `RunOverviewTab` call)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (new section (al) before `# The summary line is the parent process's (see the re-exec at the top).`; `EXPECTED_CHECKS` at `:90`)
- Create: `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md`
- Test: `frontend/src/tests/InlineName.svelte.test.ts`, `frontend/src/tests/Switch.svelte.test.ts`, `frontend/src/tests/support/SwitchHarness.svelte`, `frontend/src/tests/RunOverviewTab.svelte.test.ts` (rewritten), `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts` (helper; two switch tests move out)

**Interfaces:**
- Consumes: `ui/IconButton` (`glyph`, `size`, `title`, `aria-label`, `data-action`, `disabled`, `bind:element`, `onclick`), `lib/datetime.formatShortDate(yyyyMmDd: string): string`, `lib/runs.updateRun(runId, body): Promise<RunResponse>`.
- Produces:
  - `InlineName` props `type?: 'text' | 'date'` (default `'text'`) and `emptyTitle?: string` (default: `saveTitle`, P21).
  - `Switch` prop `onchange?: (next: boolean) => void`, called after the flip, never while `disabled` or `frozen`.
  - `RunOverviewTab` props after this task: `run: RunResponse`, `setRun: (r: RunResponse) => void`, `pinned: Version | undefined`, `isAdmin: boolean`, `readiness: { checks: ChecklistRow[]; firstViolation: string | null }` (old shape until Task 2), `onNavigateTab`, `onDeleteRun: () => void` (old shape until Task 2).
  - Its hooks: `.ov-row[data-field="title" | "start_date" | "end_date" | "version"]`, `.ov-value`, `.ov-ver`, `button[data-action="edit-title" | "edit-start-date" | "edit-end-date" | "edit-version"]`, `button[role="switch"]`.
  - Its internal lock `localWrite` and `const runWrite = $derived(localWrite)`; Task 2 widens `runWrite` with the `publishing` prop.
  - Gate section (al) with an empty `FILES_6C=( )` array and the `RunOverviewTab` block (`own ov-grid` / `uniq1 ov-grid`).

- [ ] **Step 1: Write the failing `InlineName` tests**

Append inside the `describe('InlineName (handoff §4 Inline field editing)', …)` block of `frontend/src/tests/InlineName.svelte.test.ts`, before its closing `});`:

```ts
  it('type="date" renders a date field; an empty date keeps ✓ disabled with emptyTitle (R31)', async () => {
    const { input, check, onSave } = render({
      label: 'Start date', value: '2026-06-01', type: 'date',
      saveTitle: 'Save start date', emptyTitle: 'Choose a date',
    });
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-06-01');
    expect(check.getAttribute('title')).toBe('Save start date');
    type(input, '');
    expect(check.disabled).toBe(true);
    expect(check.getAttribute('title')).toBe('Choose a date');
    type(input, '2026-06-02');
    expect(check.getAttribute('title')).toBe('Save start date');
    key(input, 'Enter');
    await settle();
    expect(onSave).toHaveBeenCalledWith('2026-06-02');
  });

  it('emptyTitle defaults to saveTitle (P21)', () => {
    const { input, check } = render({ saveTitle: 'Save name' });
    type(input, '');
    expect(check.getAttribute('title')).toBe('Save name');
  });
```

- [ ] **Step 2: Write the failing `Switch` tests**

In `frontend/src/tests/support/SwitchHarness.svelte`, replace the props block

```svelte
  let { disabled = false, frozen = false, title = undefined }: {
    disabled?: boolean;
    frozen?: boolean;
    title?: string;
  } = $props();
```

with

```svelte
  let { disabled = false, frozen = false, title = undefined, onchange = undefined }: {
    disabled?: boolean;
    frozen?: boolean;
    title?: string;
    onchange?: (next: boolean) => void;
  } = $props();
```

and the Switch line

```svelte
  <Switch id="sw" bind:checked {disabled} {frozen} {title} describedby="sw-help" />
```

with

```svelte
  <Switch id="sw" bind:checked {disabled} {frozen} {title} {onchange} describedby="sw-help" />
```

Append inside `describe('Switch (R16)', …)` in `frontend/src/tests/Switch.svelte.test.ts`:

```ts
  it('onchange gets the new value after the flip, once per click (R42)', () => {
    const calls: boolean[] = [];
    const sw = render({ onchange: (v: boolean) => calls.push(v) });
    sw.click();
    flushSync();
    expect(calls).toEqual([true]);
    expect(value()).toBe('true');
    sw.click();
    flushSync();
    expect(calls).toEqual([true, false]);
  });

  it('a disabled or frozen switch calls no onchange', () => {
    const calls: boolean[] = [];
    const off = render({ disabled: true, onchange: (v: boolean) => calls.push(v) });
    off.click();
    flushSync();
    unmount(cmp!);
    cmp = undefined;
    host.remove();
    const frozen = render({ frozen: true, onchange: (v: boolean) => calls.push(v) });
    frozen.click();
    flushSync();
    expect(calls).toEqual([]);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/InlineName.svelte.test.ts src/tests/Switch.svelte.test.ts`
Expected: FAIL — the date test finds `input.type === 'text'`; the first Switch test fails because `onchange` is never called (`calls` stays `[]`). Two new tests already pass and pin behaviour that must not change: "emptyTitle defaults to saveTitle" (today ✓ always shows `saveTitle`) and "a disabled or frozen switch calls no onchange".

- [ ] **Step 4: Add `type` and `emptyTitle` to `InlineName`**

In `frontend/src/components/ui/InlineName.svelte`, replace the props block (`:11-30`)

```ts
  let {
    label,
    value = '',
    maxlength = undefined,
    onSave,
    onCancel,
    saveTitle = 'Save',
    aside = undefined,
    subject = undefined,
  }: {
    label: string;
    value?: string;
    maxlength?: number;
    onSave: (value: string) => Promise<void>;
    onCancel: () => void;
    saveTitle?: string;
    aside?: Snippet;
    // What the field renames ("Group A"): × and ✓ name it for a screen reader.
    subject?: string;
  } = $props();
```

with

```ts
  let {
    label,
    value = '',
    maxlength = undefined,
    onSave,
    onCancel,
    saveTitle = 'Save',
    aside = undefined,
    subject = undefined,
    type = 'text',
    emptyTitle = undefined,
  }: {
    label: string;
    value?: string;
    maxlength?: number;
    onSave: (value: string) => Promise<void>;
    onCancel: () => void;
    saveTitle?: string;
    aside?: Snippet;
    // What the field renames ("Group A"): × and ✓ name it for a screen reader.
    subject?: string;
    // Slice-6c R31: the run's Start / End are date fields.
    type?: 'text' | 'date';
    // ✓'s title while the field is empty ("Choose a date"); else saveTitle.
    emptyTitle?: string;
  } = $props();
```

Replace `type="text"` on the `<input>` (`:80`) with `{type}`. Replace the ✓ line (`:94`)

```svelte
    <IconButton glyph="check" size="sm" primary title={saving ? 'Saving…' : saveTitle}
```

with

```svelte
    <IconButton glyph="check" size="sm" primary title={saving ? 'Saving…' : !trimmed ? (emptyTitle ?? saveTitle) : saveTitle}
```

- [ ] **Step 5: Add `onchange` to `Switch`**

In `frontend/src/components/ui/Switch.svelte`, replace the props block and `toggle` (`:6-27`)

```ts
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
```

with

```ts
  let {
    checked = $bindable(false),
    id,
    disabled = false,
    frozen = false,
    title = undefined,
    describedby = undefined,
    onchange = undefined,
  }: {
    checked?: boolean;
    id: string;
    disabled?: boolean;
    // R19: a request is running. The switch keeps focus and its look, and
    // ignores clicks.
    frozen?: boolean;
    title?: string;
    describedby?: string;
    // Slice-6c R42: the new value, after the flip (the Overview saves it).
    onchange?: (next: boolean) => void;
  } = $props();

  function toggle() {
    if (disabled || frozen) return;
    checked = !checked;
    onchange?.(checked);
  }
```

- [ ] **Step 6: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/InlineName.svelte.test.ts src/tests/Switch.svelte.test.ts`
Expected: PASS (all InlineName and Switch tests, old and new).

- [ ] **Step 7: Write the failing Overview tests**

Replace the whole of `frontend/src/tests/RunOverviewTab.svelte.test.ts` with:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab from '../components/runs/RunOverviewTab.svelte';
import type { RunResponse, Version } from '../lib/types';

vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...actual, pushToast: vi.fn() };
});

import { pushToast } from '../stores/toasts.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  vi.mocked(pushToast).mockClear();
  document.body.innerHTML = '';
});

const makeRun = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...over,
} as RunResponse);

const makeVersion = (over: Partial<Version> = {}): Version => ({
  id: 99, course_id: 1, state: 'published', is_disabled: false, info_md: '', info_html: '',
  max_quiz_attempts: 3, label: 'Spring 2026', created_at: '2026-01-01', published_at: '2026-01-02',
  archived_at: null, ...over,
});

function okRes(body: unknown, status = 200): Response {
  return {
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const jres = (body: unknown, status = 200) => Promise.resolve(okRes(body, status));

// A response the test releases by hand: a request "in flight".
function held() {
  let release!: (r: Response) => void;
  const p = new Promise<Response>((r) => { release = r; });
  return { p, release };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

type Extra = { run?: Partial<RunResponse>; pinned?: Version | undefined; isAdmin?: boolean };

function mountOverview(extra: Extra = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const setRunSpy = vi.fn();
  const props = $state({
    run: makeRun(extra.run ?? {}),
    setRun: setRunSpy as (r: RunResponse) => void,
    pinned: 'pinned' in extra ? extra.pinned : makeVersion(),
    isAdmin: extra.isAdmin ?? true,
    readiness: { checks: [], firstViolation: null },
    onNavigateTab: vi.fn(),
    onDeleteRun: vi.fn(),
  });
  setRunSpy.mockImplementation((r: RunResponse) => { props.run = r; });
  const cmp = mount(RunOverviewTab, { target, props });
  flushSync();
  return { target, cmp, props, setRunSpy };
}

type Pencil = 'title' | 'start-date' | 'end-date' | 'version';
const edit = (t: HTMLElement, f: Pencil) => t.querySelector(`button[data-action="edit-${f}"]`) as HTMLButtonElement;
const field = (t: HTMLElement) => t.querySelector('input.in-input') as HTMLInputElement | null;
const sw = (t: HTMLElement) => t.querySelector('button[role="switch"]') as HTMLButtonElement;
const rowText = (t: HTMLElement, f: string) =>
  (t.querySelector(`.ov-row[data-field="${f}"] .ov-value`)?.textContent ?? '').trim();

function type(input: HTMLInputElement, v: string) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(el: HTMLElement, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
}

describe('Run details (10a, R31, R32)', () => {
  it('shows Title, Start, End and Version; dates read "01 Jun 2026" (Review Focus 5)', () => {
    const { target, cmp } = mountOverview();
    expect(Array.from(target.querySelectorAll('.ov-row .ov-label')).map((l) => l.textContent?.trim()))
      .toEqual(['Title', 'Start', 'End', 'Version']);
    expect(rowText(target, 'title')).toBe('Spring');
    expect(rowText(target, 'start_date')).toBe('01 Jun 2026');
    expect(rowText(target, 'end_date')).toBe('30 Jun 2026');
    expect(rowText(target, 'version')).toBe('Spring 2026 · v. 99');
    expect(target.querySelector('.ov-row[data-field="version"] .ov-ver')?.textContent).toBe('v. 99');
    unmount(cmp);
  });

  it('a version with no label, or a missing version, reads "v. 99"; its pencil is disabled with its reason', () => {
    for (const pinned of [makeVersion({ label: '' }), undefined]) {
      const { target, cmp } = mountOverview({ pinned });
      expect(rowText(target, 'version')).toBe('v. 99');
      expect(edit(target, 'version').disabled).toBe(true);
      expect(edit(target, 'version').title).toBe('The version is fixed when the run is created');
      unmount(cmp);
    }
  });

  it('each pencil is named for its field', () => {
    const { target, cmp } = mountOverview();
    expect(edit(target, 'title').getAttribute('aria-label')).toBe('Edit the title');
    expect(edit(target, 'start-date').title).toBe('Edit the start date');
    expect(edit(target, 'end-date').title).toBe('Edit the end date');
    unmount(cmp);
  });

  it('the pencil opens the field with focus; Enter sends one PATCH {title}, closes it, focus back on the pencil', async () => {
    fetchSpy.mockImplementation(() => jres(makeRun({ title: 'Summer' })));
    const { target, cmp, setRunSpy } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    const input = field(target)!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('Title');
    expect(input.maxLength).toBe(200);
    type(input, 'Summer');
    key(input, 'Enter');
    key(input, 'Enter');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/runs/10');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Summer' });
    expect(setRunSpy).toHaveBeenCalledTimes(1);
    expect(field(target)).toBeNull();
    expect(rowText(target, 'title')).toBe('Summer');
    expect(document.activeElement).toBe(edit(target, 'title'));
    unmount(cmp);
  });

  it('Esc closes without a request, and so does an unchanged value; focus back on the pencil', async () => {
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    key(field(target)!, 'Escape');
    await settle();
    expect(field(target)).toBeNull();
    expect(document.activeElement).toBe(edit(target, 'title'));
    edit(target, 'title').click();
    flushSync();
    key(field(target)!, 'Enter');
    await settle();
    expect(field(target)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(edit(target, 'title'));
    unmount(cmp);
  });

  it('a failed save keeps the field open with the server text under it, and no toast', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'end_date must be on or after start_date' }, 422));
    const { target, cmp } = mountOverview();
    edit(target, 'end-date').click();
    flushSync();
    const input = field(target)!;
    type(input, '2026-05-01');
    key(input, 'Enter');
    await settle();
    expect(field(target)).toBe(input);
    expect(target.querySelector('p.in-err')?.textContent).toBe('end_date must be on or after start_date');
    expect(pushToast).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    unmount(cmp);
  });

  it('a 422 field list shows "Please correct the highlighted fields." and the field stays open (Review Focus 2)', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: [{ loc: ['body', 'title'], msg: 'String too long', type: 'value_error' }] }, 422));
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    expect(field(target)).not.toBeNull();
    expect(target.querySelector('p.in-err')?.textContent).toBe('Please correct the highlighted fields.');
    expect(pushToast).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Start and End are date fields; an empty date keeps ✓ disabled with "Choose a date"', () => {
    const { target, cmp } = mountOverview();
    edit(target, 'start-date').click();
    flushSync();
    const input = field(target)!;
    expect(input.type).toBe('date');
    expect(input.getAttribute('aria-label')).toBe('Start date');
    const check = target.querySelector('button[data-glyph="check"]') as HTMLButtonElement;
    expect(check.title).toBe('Save start date');
    type(input, '');
    expect(check.disabled).toBe(true);
    expect(check.title).toBe('Choose a date');
    unmount(cmp);
  });

  it('while one field is open the other pencils are disabled with "Finish editing the title first"', () => {
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    for (const f of ['start-date', 'end-date'] as const) {
      expect(edit(target, f).disabled).toBe(true);
      expect(edit(target, f).title).toBe('Finish editing the title first');
    }
    unmount(cmp);
  });

  it('R32: a field save freezes the switch; the switch request disables the pencils', async () => {
    const save = held();
    fetchSpy.mockImplementationOnce(() => save.p);
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    expect(sw(target).getAttribute('aria-disabled')).toBe('true');
    sw(target).click();
    flushSync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    const toggle = held();
    fetchSpy.mockImplementationOnce(() => toggle.p);
    sw(target).click();
    await settle();
    for (const f of ['title', 'start-date', 'end-date'] as const) {
      expect(edit(target, f).disabled).toBe(true);
      expect(edit(target, f).title).toBe('Wait for the current change to save');
    }
    toggle.release(okRes(makeRun({ title: 'Summer', groups_enabled: true })));
    await settle();
    expect(edit(target, 'title').disabled).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    unmount(cmp);
  });

  it('leaving mid-save and coming back: nothing is locked and the saved title shows (Review Focus 1)', async () => {
    const save = held();
    fetchSpy.mockImplementationOnce(() => save.p);
    const { target, cmp, props } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    unmount(cmp);
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    expect(props.run.title).toBe('Summer');
    const again = mount(RunOverviewTab, { target, props });
    flushSync();
    expect(rowText(target, 'title')).toBe('Summer');
    expect(edit(target, 'title').disabled).toBe(false);
    expect(sw(target).getAttribute('aria-disabled')).toBeNull();
    unmount(again);
  });
});

describe('Settings (R42)', () => {
  it('one PATCH {groups_enabled: true} per toggle; setRun gets the answer', async () => {
    fetchSpy.mockImplementation(() => jres(makeRun({ groups_enabled: true })));
    const { target, cmp, setRunSpy } = mountOverview();
    sw(target).click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ groups_enabled: true });
    expect(setRunSpy).toHaveBeenCalledTimes(1);
    expect(sw(target).getAttribute('aria-checked')).toBe('true');
    unmount(cmp);
  });

  it('a failure sets the switch back and toasts "Could not update setting: …"', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Cannot disable groups; mini-projects exist' }, 409));
    const { target, cmp } = mountOverview({ run: { groups_enabled: true } });
    sw(target).click();
    flushSync();
    expect(sw(target).getAttribute('aria-checked')).toBe('false');
    await settle();
    expect(sw(target).getAttribute('aria-checked')).toBe('true');
    expect(pushToast).toHaveBeenCalledWith('Could not update setting: Cannot disable groups; mini-projects exist', 'error');
    unmount(cmp);
  });

  it('a draft: the visible label names the switch and the help line describes it; no lock line', () => {
    const { target, cmp } = mountOverview();
    const s = sw(target);
    expect(target.querySelector(`label[for="${s.id}"]`)?.textContent?.trim()).toBe('Groups enabled');
    expect(s.disabled).toBe(false);
    expect(s.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent))
      .toEqual(['Disabling hides assignments but does not delete them.']);
    unmount(cmp);
  });

  for (const [isAdmin, text] of [
    [true, 'Locked while the run is published — unpublish to change.'],
    [false, 'Locked while the run is published — ask a course admin to unpublish.'],
  ] as const) {
    it(`published (${isAdmin ? 'admin' : 'teacher'}): disabled, the visible lock line first in its description, the same title`, () => {
      const { target, cmp } = mountOverview({ isAdmin, run: { is_published: true } });
      const s = sw(target);
      expect(s.disabled).toBe(true);
      expect(s.title).toBe(text);
      expect(s.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent))
        .toEqual([text, 'Disabling hides assignments but does not delete them.']);
      unmount(cmp);
    });
  }
});

describe('role gating', () => {
  it('teachers edit the fields and the switch too', () => {
    const { target, cmp } = mountOverview({ isAdmin: false });
    for (const f of ['title', 'start-date', 'end-date'] as const) expect(edit(target, f).disabled).toBe(false);
    expect(sw(target).disabled).toBe(false);
    unmount(cmp);
  });

  it('hides Delete-run from teachers', () => {
    const { target, cmp } = mountOverview({ isAdmin: false });
    expect(target.querySelector('button[data-action="delete-run"]')).toBeNull();
    unmount(cmp);
  });

  it('shows Delete-run to admins on a draft', () => {
    const { target, cmp } = mountOverview({ isAdmin: true });
    expect(target.querySelector('button[data-action="delete-run"]')).not.toBeNull();
    unmount(cmp);
  });
});
```

In `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts`:
- Replace line 4 `import type { Course, RunResponse } from '../lib/types';` with `import type { RunResponse } from '../lib/types';` and delete line 6 (`const baseCourse …`).
- Replace the `Extra` type and `mountTab` (`:35-63`) with:

```ts
type Extra = {
  run?: Partial<RunResponse>;
  readiness?: { checks: Array<{ id: string; label: string; state: 'ok' | 'violated' | 'na'; hint?: string }>; firstViolation: string | null };
  isAdmin?: boolean;
};

function mountTab(extra: Extra = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const setRun = vi.fn();
  const onNavigateTab = vi.fn();
  const onDeleteRun = vi.fn();
  const cmp = mount(RunOverviewTab, {
    target,
    props: {
      run: makeRun(extra.run ?? {}),
      setRun,
      pinned: undefined,
      isAdmin: extra.isAdmin ?? true,
      readiness: extra.readiness ?? { checks: [], firstViolation: null },
      onNavigateTab,
      onDeleteRun,
    },
  });
  return { target, cmp, setRun, onNavigateTab, onDeleteRun };
}
```

- Delete the tests `'PATCHes groups_enabled when checkbox toggled'` (`:104-119`) and `'disables groups_enabled checkbox with tooltip when published'` (`:121-131`); the Settings describe above replaces them (spec §Code changes: the lock text moves from a `<label title>` to a visible line). Delete the `jres` helper too (`:21-28`): the first of those tests was its only user, and `noUnusedLocals` makes it a svelte-check error.

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunOverviewTab.svelte.test.ts src/tests/RunOverviewTab.checklist.svelte.test.ts`
Expected: FAIL — no `.ov-row`, no `button[data-action="edit-title"]`, no `button[role="switch"]` (today's Overview has plain inputs and a checkbox). Both files fail as a whole: the old component reads `course.is_admin`, and the new helpers pass no `course` (a `TypeError`).

- [ ] **Step 8: Rewrite `RunOverviewTab.svelte`**

Replace the whole file with:

```svelte
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { updateRun } from '../../lib/runs';
  import { formatShortDate } from '../../lib/datetime';
  import { pushToast } from '../../stores/toasts.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import InlineName from '../ui/InlineName.svelte';
  import Switch from '../ui/Switch.svelte';
  import type { RunResponse, RunUpdateRequest, Version } from '../../lib/types';

  type ChecklistRow = { id: string; label: string; state: 'ok' | 'violated' | 'na'; hint?: string };
  type Readiness = { checks: ChecklistRow[]; firstViolation: string | null };
  type Field = 'title' | 'start_date' | 'end_date';

  let {
    run,
    setRun,
    pinned,
    isAdmin,
    readiness,
    onNavigateTab,
    onDeleteRun,
  }: {
    run: RunResponse;
    setRun: (r: RunResponse) => void;
    pinned: Version | undefined;
    isAdmin: boolean;
    readiness: Readiness;
    onNavigateTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster', prefilter?: 'unassigned' | null) => void;
    onDeleteRun: () => void;
  } = $props();

  const uid = $props.id();
  const WAIT = 'Wait for the current change to save';
  // Run details: the row label, the field's name, and its noun for the titles.
  const FIELDS: { key: Field; label: string; name: string; noun: string; type: 'text' | 'date'; action: string }[] = [
    { key: 'title', label: 'Title', name: 'Title', noun: 'the title', type: 'text', action: 'edit-title' },
    { key: 'start_date', label: 'Start', name: 'Start date', noun: 'the start date', type: 'date', action: 'edit-start-date' },
    { key: 'end_date', label: 'End', name: 'End date', noun: 'the end date', type: 'date', action: 'edit-end-date' },
  ];
  const NOUN: Record<Field, string> = { title: 'the title', start_date: 'the start date', end_date: 'the end date' };

  let editing = $state<Field | null>(null);
  // R32: one run write at a time — a field save or the switch's request.
  // An open field is not a write.
  let localWrite = $state(false);
  const runWrite = $derived(localWrite);
  const editEls: Partial<Record<Field, HTMLButtonElement>> = $state({});
  let confirmDeleteOpen = $state(false);

  // R42: the switch follows `run` after every setRun; a failure sets it back.
  let groupsOn = $state(untrack(() => run.groups_enabled));
  $effect(() => {
    groupsOn = run.groups_enabled;
  });

  const lockText = $derived(isAdmin
    ? 'Locked while the run is published — unpublish to change.'
    : 'Locked while the run is published — ask a course admin to unpublish.');

  function editTitle(noun: string): string {
    if (runWrite) return WAIT;
    if (editing !== null) return `Finish editing ${NOUN[editing]} first`;
    return `Edit ${noun}`;
  }

  async function focusEdit(field: Field) {
    await tick();
    editEls[field]?.focus();
  }

  // InlineName shows a rejection under the field, so this only rethrows.
  async function saveField(field: Field, value: string): Promise<void> {
    localWrite = true;
    const updated = await updateRun(run.id, { [field]: value } as RunUpdateRequest)
      .finally(() => { localWrite = false; });
    setRun(updated);
    editing = null;
    await focusEdit(field);
  }

  function cancelField(field: Field) {
    editing = null;
    void focusEdit(field);
  }

  async function toggleGroups(next: boolean) {
    localWrite = true;
    try {
      setRun(await updateRun(run.id, { groups_enabled: next }));
    } catch (e) {
      groupsOn = run.groups_enabled;
      if (e instanceof ApiError) pushToast(`Could not update setting: ${e.displayMessage}`, 'error');
    } finally {
      localWrite = false;
    }
  }
</script>

<div class="ov-grid">
  <section class="ov-card" aria-labelledby="{uid}-details">
    <h2 class="ov-title" id="{uid}-details">Run details</h2>
    <div class="ov-details">
      {#each FIELDS as f (f.key)}
        <div class="ov-row" data-field={f.key}>
          <span class="ov-label">{f.label}</span>
          {#if editing === f.key}
            <div class="ov-edit">
              <InlineName
                label={f.name}
                type={f.type}
                value={run[f.key]}
                maxlength={f.key === 'title' ? 200 : undefined}
                saveTitle="Save {f.name.toLowerCase()}"
                emptyTitle={f.type === 'date' ? 'Choose a date' : undefined}
                onSave={(v) => saveField(f.key, v)}
                onCancel={() => cancelField(f.key)}
              />
            </div>
          {:else}
            <span class="ov-value">{f.type === 'date' ? formatShortDate(run[f.key]) : run[f.key]}</span>
            <span class="ov-act">
              <IconButton
                glyph="pencil"
                size="sm"
                title={editTitle(f.noun)}
                aria-label="Edit {f.noun}"
                data-action={f.action}
                disabled={runWrite || editing !== null}
                bind:element={editEls[f.key]}
                onclick={() => (editing = f.key)}
              />
            </span>
          {/if}
        </div>
      {/each}
      <div class="ov-row" data-field="version">
        <span class="ov-label">Version</span>
        <span class="ov-value">{pinned?.label ? `${pinned.label} · ` : ''}<span class="ov-ver">v. {run.version_id}</span></span>
        <span class="ov-act">
          <IconButton glyph="pencil" size="sm" title="The version is fixed when the run is created"
                      data-action="edit-version" disabled />
        </span>
      </div>
    </div>
  </section>

  <div class="ov-col">
    <section class="ov-card" aria-labelledby="{uid}-settings">
      <h2 class="ov-title ov-title-loose" id="{uid}-settings">Settings</h2>
      <div class="ov-setting">
        <span class="ov-switch-slot">
          <Switch
            id="{uid}-groups"
            bind:checked={groupsOn}
            disabled={run.is_published}
            frozen={runWrite}
            title={run.is_published ? lockText : undefined}
            describedby={run.is_published ? `${uid}-lock ${uid}-help` : `${uid}-help`}
            onchange={(next) => void toggleGroups(next)}
          />
        </span>
        <div class="ov-setting-text">
          <label class="ov-setting-label" for="{uid}-groups">Groups enabled</label>
          {#if run.is_published}<p class="ov-help" id="{uid}-lock">{lockText}</p>{/if}
          <p class="ov-help" id="{uid}-help">Disabling hides assignments but does not delete them.</p>
        </div>
      </div>
    </section>

    <section class="readiness">
      <h3>Publish readiness</h3>
      <ul>
        {#each readiness.checks as row (row.id)}
          <li class="state-{row.state}">
            {#if row.state === 'ok'}✓{:else if row.state === 'violated'}✗{:else}—{/if}
            {row.label}
            {#if row.state === 'violated' && row.id === 'assigned' && row.hint}
              <button
                type="button"
                class="hint-button"
                data-action="goto-unassigned"
                onclick={() => onNavigateTab('roster', 'unassigned')}
              >{row.hint}</button>
            {:else if row.hint}
              <span class="hint">{row.hint}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>

    {#if !run.is_published && isAdmin}
      <section class="danger-zone">
        <h3>Danger zone</h3>
        {#if confirmDeleteOpen}
          <InlineConfirm
            confirmLabel="Confirm Delete"
            confirmDataAction="confirm-delete"
            onConfirm={onDeleteRun}
            onCancel={() => (confirmDeleteOpen = false)}
          />
        {:else}
          <button type="button" data-action="delete-run" onclick={() => (confirmDeleteOpen = true)}>Delete run</button>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  /* 10a: two columns of cards; below 880px they stack, Run details first. */
  .ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  @media (max-width: 880px) {
    .ov-grid { grid-template-columns: 1fr; }
  }
  .ov-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .ov-card { min-width: 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .ov-title { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--text); }
  .ov-title:focus { outline: none; }
  .ov-title-loose { margin-bottom: 10px; }

  /* Run details: label / value / action slot, as drawn. */
  .ov-details { display: flex; flex-direction: column; }
  .ov-row { display: grid; grid-template-columns: 132px 1fr 54px; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border-soft); }
  .ov-row:last-child { border-bottom: 0; }
  .ov-label { font-size: 12.5px; color: var(--muted); }
  .ov-value { min-width: 0; font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .ov-ver { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
  .ov-act { display: flex; justify-content: flex-end; }
  /* The open field spans value and action; its ✓ lands in the action slot. */
  .ov-edit { grid-column: 2 / 4; display: flex; min-width: 0; }

  .ov-setting { display: flex; align-items: flex-start; gap: 11px; }
  .ov-switch-slot { display: flex; padding-top: 2px; }
  .ov-setting-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ov-setting-label { font-size: 13px; color: var(--text); }
  .ov-help { margin: 0; font-size: 12px; line-height: 1.45; color: var(--muted); }

  .readiness,
  .danger-zone {
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border);
  }
  .readiness h3,
  .danger-zone h3 {
    margin: 0 0 var(--space-2);
    font-size: 1em;
    color: var(--text);
  }
  .readiness ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .readiness li.state-ok { color: var(--text); }
  .readiness li.state-violated { color: var(--danger); }
  .readiness li.state-na { color: var(--muted); }
  .readiness .hint { color: var(--muted); margin-left: 4px; }
  .readiness .hint-button {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--primary);
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
    margin-left: 4px;
  }
  .danger-zone button[data-action="delete-run"] {
    background: var(--danger);
    color: var(--primary-text);
    border: 0;
    padding: 8px 14px;
    border-radius: var(--radius);
    cursor: pointer;
  }
</style>
```

(The `.readiness` and `.danger-zone` rules are today's, minus their hex fallbacks, `var(--link, #335)` → `var(--primary)`, `#fff` → `var(--primary-text)`, `4px` radius → `var(--radius)` (P29). Task 2 replaces them.)

- [ ] **Step 9: Pass the new props from the page**

In `frontend/src/pages/runs/RunDetailPage.svelte`, replace the Overview call (`:414-424`)

```svelte
        <RunOverviewTab
          {run}
          setRun={(r) => (run = r)}
          {teachers}
          {groups}
          {students}
          {readiness}
          onNavigateTab={gotoTab}
          {onDeleteRun}
          course={course!}
        />
```

with

```svelte
        <RunOverviewTab
          {run}
          setRun={(r) => (run = r)}
          {pinned}
          {isAdmin}
          {readiness}
          onNavigateTab={gotoTab}
          {onDeleteRun}
        />
```

- [ ] **Step 10: Run the Overview tests to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunOverviewTab.svelte.test.ts src/tests/RunOverviewTab.checklist.svelte.test.ts src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.publish.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts`
Expected: PASS. (The page files still find Publish in the title row, `delete-run` + `confirm-delete` and `goto-unassigned` in the old markup.)

- [ ] **Step 11: Add gate section (al) and the 6c backlog**

In `frontend/scripts/visual-refresh-gate.sh`, insert before the line `# The summary line is the parent process's (see the re-exec at the top).`:

```zsh
echo
echo "--- (al) Slice-6c — Overview, Roster and the side panel ---"
# Every component Slice 6c restyles or creates; each task appends its files (spec §Gate).
FILES_6C=(
)
emoji_scan "all Slice-6c files" $FILES_6C
colour_scan 6c-teacher $FILES_6C
own ov-grid RunOverviewTab.svelte
uniq1 ov-grid
if [[ -n $REPLY ]]; then
  N=RunOverviewTab; H=$REPLY
  d '\.ov-grid' '' 'display:grid' 'grid-template-columns:1fr 1fr' 'gap:14px' 'align-items:start'
  check "RunOverviewTab stacks its columns below 880px" "@media \(max-width: 880px\)\{\.ov-grid\.${H}\{grid-template-columns:1fr\}"
  d '\.ov-col' '' 'display:flex' 'flex-direction:column' 'gap:14px'
  d '\.ov-card' '' 'padding:16px 18px' 'background:var\(--surface\)' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)'
  d '\.ov-title' '' 'font-size:14px' 'font-weight:600' 'color:var\(--text\)'
  d '\.ov-row' '' 'display:grid' 'grid-template-columns:132px 1fr 54px' 'gap:12px' 'padding:9px 0' 'border-bottom:1px solid var\(--border-soft\)'
  d '\.ov-label' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  # Review Focus 3: a 200-character title wraps inside its cell.
  d '\.ov-value' '' 'font-size:13px' 'color:var\(--text\)' 'overflow-wrap:anywhere'
  d '\.ov-ver' '' 'font-family:var\(--font-mono\)' 'color:var\(--muted\)'
  d '\.ov-edit' '' 'grid-column:2 ?/ ?4'
  d '\.ov-help' '' 'font-size:12px' 'color:var\(--muted\)'
  sweep RunOverviewTab $H
fi
```

and set `EXPECTED_CHECKS=1810` at `:90` (1774 + 36: emoji 1, colour 1, own 1, uniq1 1, the 880px stack 1, 29 declarations (`.ov-grid` 4, `.ov-col` 3, `.ov-card` 4, `.ov-title` 3, `.ov-row` 5, `.ov-label` 2, `.ov-value` 3, `.ov-ver` 2, `.ov-edit` 1, `.ov-help` 2), sweep 2). `FILES_6C` starts empty: `RunOverviewTab` joins in Task 2, once its old ✓ ✗ glyphs are gone (P29).

Create `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md`:

```markdown
# Slice 6c — Overview, Roster and the side panel: debt and deferred minors

Spec: `docs/superpowers/specs/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel-design.md`.
Plan: `docs/superpowers/plans/2026-10-13-visual-refresh-slice6c-teacher-overview-roster-panel.md`.

Review minors and browser-pass findings, by task. Each entry says where it lives and what fixing it would take.
```

- [ ] **Step 12: Run the full checks**

Run the frontend tests, svelte-check and the gate exactly as Global Constraints › Commands give them.
Expected: vitest `exit 0` and `0` Errors/Unhandled lines; svelte-check 0 errors, 13 warnings; gate `VISUAL-REFRESH GATE: ALL PASS (1810 checks)`.

- [ ] **Step 13: Screenshots for the user**

No write is needed. Signed in as `dev@mathion.test`, open `http://localhost:5174/teaching/demo-course/runs/8?tab=overview` and screenshot at 1280×800, 1000×800 and 860×900 (the stack). Then click ✎ Title (do not type or press Enter) and screenshot at 1280×800 to show the open field. If run 8 is published, the Settings card shows the lock line; for the draft look, mock `**/api/runs/8` with the real body (read it first through `agent-browser network requests`) and `"is_published": false`, reload, and screenshot again at 1280. Absolute paths in the 6c sdd dir. Build the overlay (10a reference image beside each shot), open it with `--size-percent 60`, and wait for the user's OK; the lower right cards are still the old markup (P29), and the OK covers Run details and Settings. Clear the routes afterwards.

- [ ] **Step 14: Review lanes**

Run the Opus (high) and Fable lanes on the uncommitted diff (`git diff` plus the new backlog file), with the spec, this task's text and the Global Constraints. Fix every Critical and Important finding; re-run both lanes after every fix until both are clean. Minors go to the backlog under "## Task 1 — Overview details and settings".

- [ ] **Step 15: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/ui/InlineName.svelte frontend/src/components/ui/Switch.svelte \
  frontend/src/components/runs/RunOverviewTab.svelte frontend/src/pages/runs/RunDetailPage.svelte \
  frontend/scripts/visual-refresh-gate.sh docs/backlog/slice6c-teacher-overview-roster-panel-debt.md \
  frontend/src/tests/InlineName.svelte.test.ts frontend/src/tests/Switch.svelte.test.ts \
  frontend/src/tests/support/SwitchHarness.svelte frontend/src/tests/RunOverviewTab.svelte.test.ts \
  frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6c): Overview run details and settings (10a); InlineName type, Switch onchange

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Then the ledger line, memory, and wait for "go".

---

### Task 2: Overview — Publish readiness, Publish / Unpublish, Delete this run, and the server guard

**Files:**
- Modify: `backend/mathion/api/runs.py:139-152` (the published check moves out of `if not force:`; the force comment)
- Modify: `backend/mathion/api/submission_files.py:15` (comment)
- Modify: `backend/tests/test_runs.py:209-223` (flips to 409) and a new test after it
- Modify: `backend/tests/test_concurrency_mini_project.py:391-398` (a new `_unpublish` helper after `_unpublish_and_clear_roster`), `:623-624` (Force RED), `:695-696` (Force GREEN)
- Modify: `frontend/src/lib/runs.ts:26-28` (`deleteRun` options)
- Modify: `frontend/src/components/ui/Button.svelte` (`aria-disabled`, `aria-busy`, `.blocked`; R44, P23)
- Modify: `frontend/src/components/ui/IconButton.svelte` (`aria-disabled`, `.blocked`; R44, P23)
- Modify: `frontend/src/components/ui/DangerConfirm.svelte` (R45)
- Modify: `frontend/src/components/runs/RunOverviewTab.svelte` (module types; readiness card; footer; delete card; `runWrite` widened)
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte`: imports (`:27`, `:132-133`); `loadAll` (`:101-104`); `:226-347` (readiness rows, publish flags, outcomes); the publish bar (`:368-383`); the Overview call (from Task 1); `.publish-bar` (`:513`)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (al); `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/Button.svelte.test.ts`, `frontend/src/tests/IconButton.svelte.test.ts`, `frontend/src/tests/DangerConfirm.svelte.test.ts`, `frontend/src/tests/RunOverviewTab.svelte.test.ts`, `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts` (rewritten), `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`, `frontend/src/tests/RunDetailPage.svelte.test.ts:272-287`, `frontend/src/tests/RunDetailPage.tabs.svelte.test.ts:49` (one group in `mockRun`)

**Interfaces:**
- Consumes (Task 1): `RunOverviewTab`'s `FIELDS`, `localWrite`, `editing`, `WAIT`, the Run details and Settings cards; gate section (al) with `FILES_6C=( )` and the `RunOverviewTab` block; `lib/focusFirst.focusFirst(candidates): boolean`.
- Produces:
  - `RunOverviewTab` `<script module>` types (P19):
    - `ReadinessRow = { id: 'teacher' | 'version' | 'assigned' | 'sizes'; label: string; state: 'ok' | 'violated' | 'na'; hint?: string; hintTab?: 'teachers' | 'groups' | 'roster'; reason?: string }`;
    - `Readiness = { checks: ReadinessRow[] }`;
    - `PublishOutcome = 'published' | 'conflicts' | 'failed'`;
    - `UnpublishOutcome = 'unpublished' | 'draft-now' | 'failed'`;
    - `DeleteOutcome = { kind: 'deleted' } | { kind: 'published-now' } | { kind: 'failed'; message: string }`.
  - `RunOverviewTab` final props (P26): `run`, `setRun`, `pinned`, `isAdmin`, `readiness: Readiness`, `publishing: boolean`, `onNavigateTab`, `onPublish: () => Promise<PublishOutcome>`, `onUnpublish: () => Promise<UnpublishOutcome>`, `onDeleteRun: () => Promise<DeleteOutcome>`.
  - `ui/Button`: `'aria-disabled': boolean = false` → `aria-disabled="true"` and `class="… blocked"` unless `loading`; `aria-busy="true"` while `loading`. `onclick` still fires; the caller returns at once.
  - `ui/IconButton`: `'aria-disabled'?: boolean` → `aria-disabled="true"` and the `blocked` class.
  - `ui/DangerConfirm`: after `onConfirm` settles, if `busy` was set during it, the box is still mounted, and focus is on `<body>` or on Force delete → focus the box (R45).
  - `lib/runs.deleteRun(runId: number, opts?: { force?: boolean }): Promise<void>`.
  - Page: `publishing` / `unpublishing` flags; `doPublish`, `doUnpublish`, `onDeleteRun` return the outcomes; `loadAll` resets both flags. No publish bar.
  - Overview hooks: `li.ov-check[data-check][data-state]`, `.ov-box-{ok|violated|na}`, `.ov-vh`, `.ov-check-label`, `.ov-hint`, `button[data-action="goto-unassigned" | "goto-teachers" | "goto-groups"]`, `.ov-foot-note`, `button[data-action="publish" | "unpublish" | "confirm-unpublish" | "delete-run"]`, `.ov-err`.
  - Server: `DELETE /api/runs/{id}` (forced or not) on a published run → 409 "Unpublish run before deleting".

- [ ] **Step 1: Write the failing backend tests (D28)**

In `backend/tests/test_runs.py`, change line 5 `from mathion.models import Block, Run` to

```python
from mathion.models import Block, Evaluation, Group, MiniProject, Run, RunStudent, Submission
```

add `func` to line 3 (`from sqlalchemy import func, select`), and replace `test_force_delete_published_run` (`:209-223`) with:

```python
def test_force_delete_published_run(admin_client, db, seed_run_with_groups):
    """D28: a published run is never deleted, not even with ?force=true."""
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": NEAR_DEADLINE_ISO,
              "resubmission_deadline": FAR_DEADLINE_ISO},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    response = admin_client.delete(f"/api/runs/{run['id']}?force=true")
    assert response.status_code == 409
    assert response.json()["detail"] == "Unpublish run before deleting"
    db.expire_all()
    assert db.get(Run, run["id"]) is not None


def test_force_delete_draft_with_students_and_submissions(admin_client, student_client_for, db, seed_run_with_groups):
    """D24: a forced delete of an unpublished run removes it with its roster, groups,
    mini-projects, submissions and evaluations, and its file tree."""
    from mathion.api.submission_files import submission_storage_dir
    import os

    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": NEAR_DEADLINE_ISO,
              "resubmission_deadline": FAR_DEADLINE_ISO},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    alice = student_client_for("alice@example.com")
    sub = alice.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert sub.status_code == 201
    ev = admin_client.post(f"/api/submissions/{sub.json()['id']}/evaluation", data={"result": "accepted"})
    assert ev.status_code == 201
    assert os.path.isdir(submission_storage_dir(run["id"], ga["id"]))
    assert admin_client.post(f"/api/runs/{run['id']}/unpublish").status_code == 200

    response = admin_client.delete(f"/api/runs/{run['id']}?force=true")
    assert response.status_code == 204
    db.expire_all()
    assert db.get(Run, run["id"]) is None
    count = lambda model, cond: db.scalar(select(func.count()).select_from(model).where(cond))
    assert count(RunStudent, RunStudent.run_id == run["id"]) == 0
    assert count(Group, Group.run_id == run["id"]) == 0
    assert count(MiniProject, MiniProject.run_id == run["id"]) == 0
    assert count(Submission, Submission.id == sub.json()["id"]) == 0
    assert count(Evaluation, Evaluation.submission_id == sub.json()["id"]) == 0
    assert not os.path.isdir(submission_storage_dir(run["id"], ga["id"]))
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_runs.py -q -k "force_delete"`
Expected: FAIL — `test_force_delete_published_run` gets 204 (today the forced path skips the published check). `test_force_delete_draft_with_students_and_submissions` already passes: it pins the force cascade that D28 must keep.

- [ ] **Step 2: Move the published check (D28)**

In `backend/mathion/api/runs.py`, replace (`:139-152`)

```python
    if not force:
        if run.is_published:
            raise HTTPException(status_code=409, detail="Unpublish run before deleting")
        student_count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.run_id == run_id))
```

with

```python
    # D28 (Slice 6c): a published run is never deleted, forced or not, so a stale
    # page cannot wipe a live run. publish_run takes a different lock, so this is
    # not atomic against a concurrent publish; that window is accepted.
    if run.is_published:
        raise HTTPException(status_code=409, detail="Unpublish run before deleting")

    if not force:
        student_count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.run_id == run_id))
```

and the comment line

```python
    # ?force=true: course-admin only AND override all blocks
```

with

```python
    # ?force=true on an unpublished run (course admins): override the student and submission blocks
```

In `backend/mathion/api/submission_files.py:15`, replace

```python
    - `runs.py:delete_run` — to block deletion when submissions exist (force flag bypasses)
```

with

```python
    - `runs.py:delete_run` — to block deletion when submissions exist (force bypasses this; a published run is never deleted)
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_runs.py -q`
Expected: PASS.

- [ ] **Step 3: Watch the two force concurrency tests fail, then re-stage them**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_concurrency_mini_project.py -q -k "force"`
Expected: FAIL — `test_delete_run_force_race_reproduces_fk_23503` raises `HTTPException` 409 from `delete_run` (its seed run is published), and `test_delete_run_force_lock_blocks_submit_then_404` records `res_a["error"]` with the 409.

In `backend/tests/test_concurrency_mini_project.py`, add after `_unpublish_and_clear_roster` (after `:398`):

```python


def _unpublish(db, run_id):
    """D28: make a run force-deletable (a published run is never deleted). Unlike
    _unpublish_and_clear_roster it keeps the roster, which the force tests need."""
    run_obj = db.get(Run, run_id)
    run_obj.is_published = False
    db.commit()
```

In `test_delete_run_force_race_reproduces_fk_23503`, replace

```python
    tb = concurrency.spawn(submit_b)  # B: refetches mp (exists), parks at submission_pending
    assert b_parked.wait(timeout=10), "submit B never reached submission_pending"

    # A force-deletes the run to a full commit (mini-projects + groups gone).
```

with

```python
    tb = concurrency.spawn(submit_b)  # B: refetches mp (exists), parks at submission_pending
    assert b_parked.wait(timeout=10), "submit B never reached submission_pending"

    _unpublish(db, run["id"])  # B already past its checks

    # A force-deletes the run to a full commit (mini-projects + groups gone).
```

In `test_delete_run_force_lock_blocks_submit_then_404`, replace

```python
    tb = concurrency.spawn(submit_b)  # B: past up-front checks (published/enrolled), parks
    assert b_at_lock.wait(timeout=10), "submit B never reached the MINIPROJECT acquire"

    ta = concurrency.spawn(delete_a)  # A: acquires + holds MINIPROJECT
```

with

```python
    tb = concurrency.spawn(submit_b)  # B: past up-front checks (published/enrolled), parks
    assert b_at_lock.wait(timeout=10), "submit B never reached the MINIPROJECT acquire"

    _unpublish(db, run["id"])  # B already past its checks

    ta = concurrency.spawn(delete_a)  # A: acquires + holds MINIPROJECT
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_runs.py tests/test_concurrency_mini_project.py -q`
Expected: PASS.

- [ ] **Step 4: Write the failing `Button`, `IconButton` and `DangerConfirm` tests**

Append inside `describe('Button', …)` in `frontend/src/tests/Button.svelte.test.ts`:

```ts
  it('aria-disabled: not natively disabled, marked blocked, onclick still fires (R44)', () => {
    const onclick = vi.fn();
    const btn = render({ 'aria-disabled': true, title: 'Wait for the current change to save', onclick });
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.classList.contains('blocked')).toBe(true);
    btn.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });
  it('loading sets aria-busy and keeps the variant look (P23)', () => {
    const btn = render({ loading: true, 'aria-disabled': true });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.classList.contains('blocked')).toBe(false);
    expect(btn.querySelector('.spinner')).not.toBeNull();
  });
  it('omits aria-disabled and aria-busy by default', () => {
    const btn = render({});
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
  });
```

Append inside `describe('IconButton', …)` in `frontend/src/tests/IconButton.svelte.test.ts`:

```ts
  it('aria-disabled keeps the button focusable and marks it blocked (R44)', () => {
    const onclick = vi.fn();
    const btn = render({ glyph: 'trash', title: 'Wait for the current change to save', 'aria-disabled': true, onclick });
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.classList.contains('blocked')).toBe(true);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    btn.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });
  it('omits aria-disabled by default', () => {
    const btn = render({ glyph: 'trash', title: 'Delete' });
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
    expect(btn.classList.contains('blocked')).toBe(false);
  });
```

Append to `frontend/src/tests/DangerConfirm.svelte.test.ts`:

```ts
describe('DangerConfirm after a request (R45)', () => {
  // A caller like the run's delete: busy while its request runs.
  function renderBusy() {
    host = document.createElement('div');
    document.body.appendChild(host);
    let release!: () => void;
    const props = $state({
      message,
      busy: false,
      onCancel: vi.fn(),
      onConfirm: async () => {
        props.busy = true;
        await new Promise<void>((r) => { release = r; });
        props.busy = false;
        throw new Error('failed');
      },
    });
    component = mount(DangerConfirm, { target: host, props: props as ComponentProps<typeof DangerConfirm> });
    flushSync();
    const box = host.querySelector('input[data-role="danger-ack"]') as HTMLInputElement;
    const force = host.querySelector('button[data-action="force-delete"]') as HTMLButtonElement;
    return { box, force, release: () => release() };
  }

  it('busy disabled the box and Force delete; once the request settles, focus is back on the box', async () => {
    const { box, force, release } = renderBusy();
    tick(box);
    force.focus();
    force.click();
    await settle();
    expect(force.disabled).toBe(true);
    expect(box.disabled).toBe(true);
    release();
    await settle();
    await settle();
    expect(box.checked).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it('focus the caller moved elsewhere during the request stays there', async () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    const { box, force, release } = renderBusy();
    tick(box);
    force.focus();
    force.click();
    await settle();
    other.focus();
    release();
    await settle();
    await settle();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('a caller that never sets busy (Assets) keeps focus where it was', async () => {
    const { box, force } = render({ onConfirm: vi.fn().mockRejectedValue(new Error('x')) });
    tick(box);
    force.focus();
    force.click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(force);
  });
});
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/Button.svelte.test.ts src/tests/IconButton.svelte.test.ts src/tests/DangerConfirm.svelte.test.ts`
Expected: FAIL — no `aria-disabled` / `aria-busy` / `blocked` on either button; the first R45 test ends with focus on Force delete. The "omits … by default" tests, the R45 "focus the caller moved elsewhere" test and the Assets test pass already (they pin behaviour that stays).

- [ ] **Step 5: Implement R44 on `Button` and `IconButton`, R45 on `DangerConfirm`**

In `frontend/src/components/ui/Button.svelte`, add after `'aria-describedby': ariaDescribedby = undefined as string | undefined,`:

```ts
    // Slice-6c R44: a control that must not act right now but keeps focus (a
    // busy Publish run). onclick still fires, so the caller returns at once.
    'aria-disabled': ariaDisabled = false,
```

replace the opening tag's

```svelte
  class="btn {variant}"
  class:full={full}
```

with

```svelte
  class="btn {variant}"
  class:full={full}
  class:blocked={ariaDisabled && !loading}
```

and

```svelte
  aria-describedby={ariaDescribedby}
```

with

```svelte
  aria-describedby={ariaDescribedby}
  aria-disabled={ariaDisabled ? 'true' : undefined}
  aria-busy={loading ? 'true' : undefined}
```

and add after the `.btn:disabled { … }` rule:

```css
  /* P23: blocked (aria-disabled, not busy) looks disabled but keeps focus. A
     busy button keeps its variant look and its spinner. */
  .btn.blocked {
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
```

In `frontend/src/components/ui/IconButton.svelte`, add to `Props` after `'aria-controls'?: string;`:

```ts
    // Slice-6c R44: blocked but focusable; the caller's onclick returns at once.
    'aria-disabled'?: boolean;
```

to the destructuring after `'aria-controls': ariaControls = undefined,`:

```ts
    'aria-disabled': ariaDisabled = false,
```

to the `<button>` after `class:primary`:

```svelte
  class:blocked={ariaDisabled}
```

and after `aria-controls={ariaControls}`:

```svelte
  aria-disabled={ariaDisabled ? 'true' : undefined}
```

and add after the `.icon-btn:disabled { … }` rule:

```css
  /* P23: aria-disabled looks like :disabled; (0,3,0) also beats .primary/.danger. */
  .icon-btn.blocked {
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
```

In `frontend/src/components/ui/DangerConfirm.svelte`, replace `import { onMount, type Snippet } from 'svelte';` with `import { onMount, tick, type Snippet } from 'svelte';`, and replace

```ts
  let boxEl = $state<HTMLInputElement>();
  onMount(() => boxEl?.focus());

  const blocked = $derived(busy || disabledReason !== undefined);
  const forceTitle = $derived(disabledReason ?? (armed ? undefined : 'Tick “I understand” first'));

  async function confirm() {
    if (!armed || blocked || pending) return;
    pending = true;
    try {
      await onConfirm();
    } catch {
      // The caller reports its own failure (banner, toast); the box re-arms.
    } finally {
      armed = false;
      pending = false;
    }
  }
```

with

```ts
  let boxEl = $state<HTMLInputElement>();
  let forceEl = $state<HTMLButtonElement>();
  onMount(() => boxEl?.focus());

  const blocked = $derived(busy || disabledReason !== undefined);
  const forceTitle = $derived(disabledReason ?? (armed ? undefined : 'Tick “I understand” first'));

  // R45: `busy` disabled the box and Force delete, which leaves focus on
  // <body> or on the disabled button; after the request it goes back to the box.
  let busySeen = false;
  $effect(() => {
    if (busy) busySeen = true;
  });

  async function confirm() {
    if (!armed || blocked || pending) return;
    pending = true;
    busySeen = busy;
    try {
      await onConfirm();
    } catch {
      // The caller reports its own failure (banner, toast); the box re-arms.
    } finally {
      armed = false;
      pending = false;
    }
    await tick();
    const active = document.activeElement;
    if (busySeen && boxEl?.isConnected && (active === null || active === document.body || active === forceEl)) {
      boxEl.focus();
    }
  }
```

and add `bind:this={forceEl}` to the Force delete `<button>` (after `class="dc-force"`).

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/Button.svelte.test.ts src/tests/IconButton.svelte.test.ts src/tests/DangerConfirm.svelte.test.ts src/tests/RunMiniProjectsTab.svelte.test.ts src/tests/RunAssetsTab.svelte.test.ts`
Expected: PASS (the two existing `DangerConfirm` callers' suites included).

- [ ] **Step 6: `deleteRun` takes `force`**

In `frontend/src/lib/runs.ts`, replace

```ts
export function deleteRun(runId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}`);
}
```

with

```ts
export function deleteRun(runId: number, opts: { force?: boolean } = {}): Promise<void> {
  return api.delete(`/api/runs/${runId}${opts.force ? '?force=true' : ''}`);
}
```

(The runs list keeps calling `deleteRun(id)`.)

- [ ] **Step 7: Write the failing Overview unit tests**

In `frontend/src/tests/RunOverviewTab.svelte.test.ts`:
- Replace the component import with

```ts
import RunOverviewTab, {
  type DeleteOutcome, type PublishOutcome, type Readiness, type UnpublishOutcome,
} from '../components/runs/RunOverviewTab.svelte';
```

- Replace the `Extra` type and the `props` object of `mountOverview` with

```ts
type Extra = {
  run?: Partial<RunResponse>;
  pinned?: Version | undefined;
  isAdmin?: boolean;
  readiness?: Readiness;
  publishing?: boolean;
};
```

```ts
  const props = $state({
    run: makeRun(extra.run ?? {}),
    setRun: setRunSpy as (r: RunResponse) => void,
    pinned: 'pinned' in extra ? extra.pinned : makeVersion(),
    isAdmin: extra.isAdmin ?? true,
    readiness: extra.readiness ?? { checks: [] },
    publishing: extra.publishing ?? false,
    onNavigateTab: vi.fn(),
    onPublish: vi.fn(async (): Promise<PublishOutcome> => 'failed'),
    onUnpublish: vi.fn(async (): Promise<UnpublishOutcome> => 'failed'),
    onDeleteRun: vi.fn(async (): Promise<DeleteOutcome> => ({ kind: 'failed', message: 'x' })),
  });
```

- Append:

```ts
describe('R32 across the run writes', () => {
  const WAIT = 'Wait for the current change to save';

  async function startTitleSave(target: HTMLElement) {
    const save = held();
    fetchSpy.mockImplementationOnce(() => save.p);
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    return save;
  }

  it('during a field save, Publish run and the trash are aria-disabled with the reason and do nothing', async () => {
    const { target, cmp, props } = mountOverview();
    const save = await startTitleSave(target);
    const pub = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(pub.disabled).toBe(false);
    expect(pub.getAttribute('aria-disabled')).toBe('true');
    expect(pub.title).toBe(WAIT);
    pub.click();
    flushSync();
    expect(props.onPublish).not.toHaveBeenCalled();
    const trash = target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement;
    expect(trash.getAttribute('aria-disabled')).toBe('true');
    expect(trash.title).toBe(WAIT);
    trash.click();
    flushSync();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    expect(pub.getAttribute('aria-disabled')).toBeNull();
    unmount(cmp);
  });

  it('during a field save on a published run, Unpublish does nothing', async () => {
    const { target, cmp } = mountOverview({ run: { is_published: true } });
    const save = await startTitleSave(target);
    const unpub = target.querySelector('button[data-action="unpublish"]') as HTMLButtonElement;
    expect(unpub.getAttribute('aria-disabled')).toBe('true');
    unpub.click();
    flushSync();
    expect(target.querySelector('button[data-action="confirm-unpublish"]')).toBeNull();
    save.release(okRes(makeRun({ title: 'Summer', is_published: true })));
    await settle();
    unmount(cmp);
  });

  it('while the page publishes (also after a remount), the pencils and the switch do nothing; Publish run is busy', () => {
    const { target, cmp } = mountOverview({ publishing: true });
    expect(edit(target, 'title').disabled).toBe(true);
    expect(edit(target, 'title').title).toBe(WAIT);
    expect(sw(target).getAttribute('aria-disabled')).toBe('true');
    const pub = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(pub.getAttribute('aria-busy')).toBe('true');
    expect(pub.textContent?.trim()).toBe('Publishing…');
    unmount(cmp);
  });

  it("an open danger panel's Force delete is disabled while a field saves", async () => {
    const { target, cmp } = mountOverview();
    (target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement).click();
    flushSync();
    const save = await startTitleSave(target);
    const force = target.querySelector('button[data-action="force-delete"]') as HTMLButtonElement;
    expect(force.disabled).toBe(true);
    expect(force.title).toBe(WAIT);
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    expect(force.disabled).toBe(false);
    unmount(cmp);
  });
});
```

Replace the whole of `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts` with:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab, {
  type DeleteOutcome, type PublishOutcome, type Readiness, type ReadinessRow, type UnpublishOutcome,
} from '../components/runs/RunOverviewTab.svelte';
import type { RunResponse } from '../lib/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

const makeRun = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...over,
} as RunResponse);

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const TEACHER: ReadinessRow = { id: 'teacher', label: 'At least one teacher assigned', state: 'ok' };
const VERSION: ReadinessRow = { id: 'version', label: 'Course version enabled', state: 'ok' };
const ASSIGNED_NA: ReadinessRow = { id: 'assigned', label: 'Every student assigned to a group', state: 'na' };
const SIZES_NA: ReadinessRow = { id: 'sizes', label: 'No group over 10 students', state: 'na' };
const NO_TEACHER: ReadinessRow = {
  id: 'teacher', label: 'At least one teacher assigned', state: 'violated',
  hint: 'Add a teacher — open Teachers', hintTab: 'teachers', reason: 'No teacher is assigned yet',
};
const UNASSIGNED: ReadinessRow = {
  id: 'assigned', label: 'Every student assigned to a group', state: 'violated',
  hint: '3 unassigned — open Roster', hintTab: 'roster', reason: '3 students are still unassigned to a group',
};
const NO_GROUPS: ReadinessRow = {
  id: 'assigned', label: 'Every student assigned to a group', state: 'violated',
  hint: 'No groups yet — open Groups', hintTab: 'groups', reason: '1 student is still unassigned to a group',
};
const READY: Readiness = { checks: [TEACHER, VERSION, ASSIGNED_NA, SIZES_NA] };

type Extra = { run?: Partial<RunResponse>; readiness?: Readiness; isAdmin?: boolean };

function mountTab(extra: Extra = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({
    run: makeRun(extra.run ?? {}),
    setRun: vi.fn() as (r: RunResponse) => void,
    pinned: undefined,
    isAdmin: extra.isAdmin ?? true,
    readiness: extra.readiness ?? READY,
    publishing: false,
    onNavigateTab: vi.fn(),
    onPublish: vi.fn(async (): Promise<PublishOutcome> => 'failed'),
    onUnpublish: vi.fn(async (): Promise<UnpublishOutcome> => 'failed'),
    onDeleteRun: vi.fn(async (): Promise<DeleteOutcome> => ({ kind: 'failed', message: 'x' })),
  });
  const cmp = mount(RunOverviewTab, { target, props });
  flushSync();
  return { target, cmp, props };
}

const btn = (t: HTMLElement, action: string) => t.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
const note = (t: HTMLElement) => t.querySelector('.ov-foot-note')?.textContent?.trim();

describe('Publish readiness rows (R34)', () => {
  it('the rows in order, each with its status box, hidden state word and hint', () => {
    const { target, cmp } = mountTab({ run: { groups_enabled: true }, readiness: { checks: [TEACHER, VERSION, UNASSIGNED, SIZES_NA] } });
    const lis = Array.from(target.querySelectorAll('li.ov-check'));
    expect(lis.map((li) => li.getAttribute('data-check'))).toEqual(['teacher', 'version', 'assigned', 'sizes']);
    expect(lis.map((li) => li.querySelector('.ov-box')!.className.match(/ov-box-(\w+)/)![1])).toEqual(['ok', 'ok', 'violated', 'na']);
    expect(lis.every((li) => li.querySelector('.ov-box')!.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(lis.map((li) => li.querySelector('.ov-vh')?.textContent ?? null)).toEqual(['Done:', 'Done:', 'To do:', null]);
    expect(lis.map((li) => li.querySelector('.ov-check-label')!.textContent)).toEqual([
      'At least one teacher assigned', 'Course version enabled', 'Every student assigned to a group', 'No group over 10 students',
    ]);
    expect(lis[2].querySelector('button[data-action="goto-unassigned"]')!.textContent).toBe('3 unassigned — open Roster');
    expect(lis[3].querySelector('.ov-hint')!.textContent).toBe('not applicable');
    unmount(cmp);
  });

  it('the hint links open their tab: Roster with the Unassigned filter, Teachers, Groups (P10, P20)', () => {
    const one = mountTab({ readiness: { checks: [NO_TEACHER, VERSION, UNASSIGNED, SIZES_NA] } });
    btn(one.target, 'goto-unassigned')!.click();
    expect(one.props.onNavigateTab).toHaveBeenLastCalledWith('roster', 'unassigned');
    btn(one.target, 'goto-teachers')!.click();
    expect(one.props.onNavigateTab).toHaveBeenLastCalledWith('teachers', null);
    unmount(one.cmp);
    const two = mountTab({ readiness: { checks: [TEACHER, VERSION, NO_GROUPS, SIZES_NA] } });
    btn(two.target, 'goto-groups')!.click();
    expect(two.props.onNavigateTab).toHaveBeenLastCalledWith('groups', null);
    unmount(two.cmp);
  });

  it('the card heading is a focus fallback (tabindex -1)', () => {
    const { target, cmp } = mountTab();
    const h = Array.from(target.querySelectorAll('h2')).find((e) => e.textContent === 'Publish readiness')!;
    expect(h.getAttribute('tabindex')).toBe('-1');
    unmount(cmp);
  });
});

describe('The readiness footer', () => {
  it('admin, draft, nothing to fix: "Ready to publish." and Publish run enabled', () => {
    const { target, cmp } = mountTab();
    expect(note(target)).toBe('Ready to publish.');
    const pub = btn(target, 'publish')!;
    expect(pub.textContent?.trim()).toBe('Publish run');
    expect(pub.disabled).toBe(false);
    unmount(cmp);
  });

  it('one violated row: "Fix the outstanding check to publish."; Publish run disabled with its reason', () => {
    const { target, cmp } = mountTab({ readiness: { checks: [NO_TEACHER, VERSION, ASSIGNED_NA, SIZES_NA] } });
    expect(note(target)).toBe('Fix the outstanding check to publish.');
    expect(btn(target, 'publish')!.disabled).toBe(true);
    expect(btn(target, 'publish')!.title).toBe('No teacher is assigned yet');
    unmount(cmp);
  });

  it('two violated rows: "Fix the 2 outstanding checks to publish."; the title is the first one\'s reason', () => {
    const { target, cmp } = mountTab({ readiness: { checks: [TEACHER, VERSION, UNASSIGNED, { ...SIZES_NA, state: 'violated', hint: 'Group A (12)', reason: 'Groups over 10 students: Group A (12)' }] } });
    expect(note(target)).toBe('Fix the 2 outstanding checks to publish.');
    expect(btn(target, 'publish')!.title).toBe('3 students are still unassigned to a group');
    unmount(cmp);
  });

  it('teacher: the rows and "A course admin publishes this run." with no button, and no delete card', () => {
    const { target, cmp } = mountTab({ isAdmin: false });
    expect(target.querySelectorAll('li.ov-check')).toHaveLength(4);
    expect(note(target)).toBe('A course admin publishes this run.');
    expect(btn(target, 'publish')).toBeNull();
    expect(btn(target, 'delete-run')).toBeNull();
    unmount(cmp);
  });

  it('teacher, published: "Published — students have access." and no button', () => {
    const { target, cmp } = mountTab({ isAdmin: false, run: { is_published: true } });
    expect(note(target)).toBe('Published — students have access.');
    expect(btn(target, 'unpublish')).toBeNull();
    unmount(cmp);
  });

  it('admin, published: "Published — students have access." with Unpublish', () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    expect(note(target)).toBe('Published — students have access.');
    expect(btn(target, 'unpublish')!.textContent?.trim()).toBe('Unpublish');
    unmount(cmp);
  });
});

describe('Publish and Unpublish focus (R33, spec §Focus)', () => {
  it('"published" moves focus to Unpublish', async () => {
    const { target, cmp, props } = mountTab();
    props.onPublish = vi.fn(async (): Promise<PublishOutcome> => {
      props.run = makeRun({ is_published: true });
      return 'published';
    });
    const pub = btn(target, 'publish')!;
    pub.focus();
    pub.click();
    await settle();
    expect(document.activeElement).toBe(btn(target, 'unpublish'));
    unmount(cmp);
  });

  it('"failed" keeps focus on Publish run', async () => {
    const { target, cmp, props } = mountTab();
    const pub = btn(target, 'publish')!;
    pub.focus();
    pub.click();
    await settle();
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(pub);
    unmount(cmp);
  });

  it('Unpublish opens the one-line confirm with focus on its Cancel; Cancel returns focus to Unpublish', async () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    btn(target, 'unpublish')!.click();
    flushSync();
    const confirm = target.querySelector('.inline-confirm') as HTMLElement;
    expect(confirm.textContent).toContain('Students lose access immediately; their progress is kept.');
    expect(btn(target, 'confirm-unpublish')!.textContent).toBe('Unpublish');
    const cancel = confirm.querySelector('button.cancel') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await settle();
    expect(document.activeElement).toBe(btn(target, 'unpublish'));
    unmount(cmp);
  });

  it('"unpublished" moves focus to Publish run, or to the readiness heading while Publish run is disabled', async () => {
    for (const readiness of [READY, { checks: [NO_TEACHER, VERSION, ASSIGNED_NA, SIZES_NA] }]) {
      const { target, cmp, props } = mountTab({ run: { is_published: true }, readiness });
      props.onUnpublish = vi.fn(async (): Promise<UnpublishOutcome> => {
        props.run = makeRun({ is_published: false });
        return 'unpublished';
      });
      btn(target, 'unpublish')!.click();
      flushSync();
      btn(target, 'confirm-unpublish')!.click();
      await settle();
      const expected = readiness === READY
        ? btn(target, 'publish')
        : Array.from(target.querySelectorAll('h2')).find((e) => e.textContent === 'Publish readiness');
      expect(document.activeElement).toBe(expected);
      unmount(cmp);
    }
  });

  it('"failed" closes the confirm and returns focus to Unpublish', async () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    btn(target, 'unpublish')!.click();
    flushSync();
    btn(target, 'confirm-unpublish')!.click();
    await settle();
    expect(btn(target, 'confirm-unpublish')).toBeNull();
    expect(document.activeElement).toBe(btn(target, 'unpublish'));
    unmount(cmp);
  });
});

describe('Delete this run (D24)', () => {
  const box = (t: HTMLElement) => t.querySelector('input[data-role="danger-ack"]') as HTMLInputElement | null;

  it('the card: heading, the muted line, and the trash named "Delete this run"', () => {
    const { target, cmp } = mountTab();
    const h = Array.from(target.querySelectorAll('h2')).find((e) => e.textContent === 'Delete this run')!;
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(target.querySelector('.ov-del-sub')?.textContent).toBe('Only while unpublished. Roster, groups and submissions go with it.');
    const trash = btn(target, 'delete-run')!;
    expect(trash.getAttribute('aria-label')).toBe('Delete this run');
    expect(trash.getAttribute('aria-expanded')).toBe('false');
    unmount(cmp);
  });

  it('published: the trash shows, disabled with "Unpublish the run before deleting it"', () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    const trash = btn(target, 'delete-run')!;
    expect(trash.disabled).toBe(true);
    expect(trash.title).toBe('Unpublish the run before deleting it');
    unmount(cmp);
  });

  it('draft: the trash opens the danger panel with its message; Force delete is inert until "I understand"', () => {
    const { target, cmp, props } = mountTab();
    btn(target, 'delete-run')!.click();
    flushSync();
    expect(btn(target, 'delete-run')!.getAttribute('aria-expanded')).toBe('true');
    expect(target.querySelector('.danger-confirm .dc-msg')?.textContent).toBe(
      'This deletes the run with its roster, groups, teacher assignments, mini-projects, assets, submissions and evaluations, and every uploaded file. It cannot be undone.');
    expect(document.activeElement).toBe(box(target));
    const force = btn(target, 'force-delete')!;
    expect(force.getAttribute('aria-disabled')).toBe('true');
    force.click();
    expect(props.onDeleteRun).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Cancel closes the panel and returns focus to the trash', async () => {
    const { target, cmp } = mountTab();
    btn(target, 'delete-run')!.click();
    flushSync();
    (Array.from(target.querySelectorAll('.danger-confirm button')).find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement).click();
    await settle();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(document.activeElement).toBe(btn(target, 'delete-run'));
    unmount(cmp);
  });

  it('Force delete runs onDeleteRun with the panel busy; "failed" shows its message under the panel and re-arms with focus on the box', async () => {
    const { target, cmp, props } = mountTab();
    let release!: (o: DeleteOutcome) => void;
    props.onDeleteRun = vi.fn(() => new Promise<DeleteOutcome>((r) => { release = r; }));
    btn(target, 'delete-run')!.click();
    flushSync();
    box(target)!.click();
    flushSync();
    const force = btn(target, 'force-delete')!;
    force.focus();
    force.click();
    await settle();
    expect(props.onDeleteRun).toHaveBeenCalledTimes(1);
    expect(force.getAttribute('aria-busy')).toBe('true');
    release({ kind: 'failed', message: 'Database is busy' });
    await settle();
    await settle();
    const err = target.querySelector('.ov-err') as HTMLElement;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toBe('Database is busy');
    expect(box(target)!.checked).toBe(false);
    expect(document.activeElement).toBe(box(target));
    unmount(cmp);
  });

  it('"published-now" closes the panel and focuses the card heading (the trash is disabled by then)', async () => {
    const { target, cmp, props } = mountTab();
    props.onDeleteRun = vi.fn(async (): Promise<DeleteOutcome> => {
      props.run = makeRun({ is_published: true });
      return { kind: 'published-now' };
    });
    btn(target, 'delete-run')!.click();
    flushSync();
    box(target)!.click();
    flushSync();
    btn(target, 'force-delete')!.click();
    await settle();
    await settle();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(btn(target, 'delete-run')!.disabled).toBe(true);
    expect((document.activeElement as HTMLElement).textContent).toBe('Delete this run');
    unmount(cmp);
  });
});
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunOverviewTab.svelte.test.ts src/tests/RunOverviewTab.checklist.svelte.test.ts`
Expected: FAIL — the files load (type imports erase), but the Overview has no `li.ov-check`, no `.ov-foot-note` and no `button[data-action="publish"]`, and its delete card is still the old Danger zone. The existing R32 tests of Task 1 still pass.

- [ ] **Step 8: The Overview's readiness, footer and delete card**

In `frontend/src/components/runs/RunOverviewTab.svelte`:

Add at the very top of the file, before `<script lang="ts">`:

```svelte
<script module lang="ts">
  export type ReadinessRow = {
    id: 'teacher' | 'version' | 'assigned' | 'sizes';
    label: string;
    state: 'ok' | 'violated' | 'na';
    // Shown in the row; a link to hintTab when that is set.
    hint?: string;
    hintTab?: 'teachers' | 'groups' | 'roster';
    // R34: Publish run's title while this is the first violated row.
    reason?: string;
  };
  export type Readiness = { checks: ReadinessRow[] };
  export type PublishOutcome = 'published' | 'conflicts' | 'failed';
  export type UnpublishOutcome = 'unpublished' | 'draft-now' | 'failed';
  export type DeleteOutcome = { kind: 'deleted' } | { kind: 'published-now' } | { kind: 'failed'; message: string };
</script>

```

In the instance script:
- Replace the imports block with

```ts
  import { tick, untrack } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { updateRun } from '../../lib/runs';
  import { formatShortDate } from '../../lib/datetime';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import DangerConfirm from '../ui/DangerConfirm.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import InlineName from '../ui/InlineName.svelte';
  import Switch from '../ui/Switch.svelte';
  import type { RunResponse, RunUpdateRequest, Version } from '../../lib/types';
```

- Delete the two lines `type ChecklistRow = …` and `type Readiness = …`.
- Replace the props destructuring and its type with

```ts
  let {
    run,
    setRun,
    pinned,
    isAdmin,
    readiness,
    publishing,
    onNavigateTab,
    onPublish,
    onUnpublish,
    onDeleteRun,
  }: {
    run: RunResponse;
    setRun: (r: RunResponse) => void;
    pinned: Version | undefined;
    isAdmin: boolean;
    readiness: Readiness;
    // R33 / P25: the page is publishing or unpublishing this run.
    publishing: boolean;
    onNavigateTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster', prefilter?: 'unassigned' | null) => void;
    onPublish: () => Promise<PublishOutcome>;
    onUnpublish: () => Promise<UnpublishOutcome>;
    onDeleteRun: () => Promise<DeleteOutcome>;
  } = $props();
```

- Replace

```ts
  // R32: one run write at a time — a field save or the switch's request.
  // An open field is not a write.
  let localWrite = $state(false);
  const runWrite = $derived(localWrite);
  const editEls: Partial<Record<Field, HTMLButtonElement>> = $state({});
  let confirmDeleteOpen = $state(false);
```

with

```ts
  // R32: one run write at a time — a field save, the switch's request, the
  // delete, or the page's publish / unpublish (that one outlives a remount).
  // An open field is not a write.
  let localWrite = $state(false);
  const runWrite = $derived(localWrite || publishing);
  const editEls: Partial<Record<Field, HTMLButtonElement>> = $state({});

  let unpublishConfirmOpen = $state(false);
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);
  let publishEl = $state<HTMLButtonElement>();
  let unpublishEl = $state<HTMLButtonElement>();
  let trashEl = $state<HTMLButtonElement>();
  let readyHead = $state<HTMLElement>();
  let deleteHead = $state<HTMLElement>();

  const violated = $derived(readiness.checks.filter((c) => c.state === 'violated'));
  const publishBlocked = $derived(violated.length > 0);
  const publishTitle = $derived(publishBlocked
    ? (violated[0].reason ?? '')
    : runWrite && !publishing ? WAIT : undefined);
  const footNote = $derived(
    run.is_published ? 'Published — students have access.'
    : !isAdmin ? 'A course admin publishes this run.'
    : violated.length === 1 ? 'Fix the outstanding check to publish.'
    : violated.length > 1 ? `Fix the ${violated.length} outstanding checks to publish.`
    : 'Ready to publish.');
  const trashTitle = $derived(run.is_published
    ? 'Unpublish the run before deleting it'
    : runWrite ? WAIT : 'Delete this run');
```

- Add after `toggleGroups`:

```ts
  function goHint(row: ReadinessRow) {
    if (row.hintTab) onNavigateTab(row.hintTab, row.hintTab === 'roster' ? 'unassigned' : null);
  }

  // R33: the page sends the request; the outcome says where focus goes.
  // 'failed' keeps it on Publish run (it never lost it, R20); 'conflicts' hands
  // it to the modal, whose FocusTrap brings it back here.
  async function publish() {
    if (runWrite || publishBlocked) return;
    const outcome = await onPublish();
    if (outcome !== 'published') return;
    await tick();
    focusFirst([unpublishEl, readyHead]);
  }

  function openUnpublish() {
    if (runWrite) return;
    unpublishConfirmOpen = true;
  }

  // P27: nothing to cancel while the request runs.
  async function cancelUnpublish() {
    if (publishing) return;
    unpublishConfirmOpen = false;
    await tick();
    focusFirst([unpublishEl, readyHead]);
  }

  async function confirmUnpublish() {
    if (runWrite) return;
    const outcome = await onUnpublish();
    unpublishConfirmOpen = false;
    await tick();
    focusFirst(outcome === 'failed' ? [unpublishEl, readyHead] : [publishEl, readyHead]);
  }

  function toggleDelete() {
    if (deleteOpen) {
      void cancelDelete();
      return;
    }
    if (runWrite || run.is_published) return;
    deleteError = null;
    deleteOpen = true;
  }

  async function cancelDelete() {
    if (deleteBusy) return;
    deleteOpen = false;
    deleteError = null;
    await tick();
    focusFirst([trashEl, deleteHead]);
  }

  // D24: the page deletes, toasts and navigates (P24); a 'failed' stays here.
  async function forceDelete(): Promise<void> {
    if (runWrite) return;
    localWrite = true;
    deleteBusy = true;
    deleteError = null;
    const outcome = await onDeleteRun().finally(() => {
      localWrite = false;
      deleteBusy = false;
    });
    if (outcome.kind === 'failed') {
      deleteError = outcome.message;
    } else if (outcome.kind === 'published-now') {
      deleteOpen = false;
      await tick();
      focusFirst([trashEl, deleteHead]);
    }
  }
```

In the markup, add before `<div class="ov-grid">`:

```svelte
{#snippet deleteMessage()}This deletes the run with its roster, groups, teacher assignments, mini-projects, assets, submissions and evaluations, and every uploaded file. It cannot be undone.{/snippet}

```

and replace everything from `<section class="readiness">` to the closing `{/if}` of the danger zone (the two blocks after the Settings card) with:

```svelte
    <section class="ov-card" aria-labelledby="{uid}-ready">
      <h2 class="ov-title" id="{uid}-ready" tabindex="-1" bind:this={readyHead}>Publish readiness</h2>
      <ul class="ov-checks">
        {#each readiness.checks as row (row.id)}
          <li class="ov-check" data-check={row.id} data-state={row.state}>
            <span class="ov-box ov-box-{row.state}" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                {#if row.state === 'ok'}
                  <polyline points="3.4,8.4 6.6,11.6 12.6,4.8" stroke-width="1.9" />
                {:else if row.state === 'violated'}
                  <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
                {:else}
                  <line x1="5" y1="8" x2="11" y2="8" />
                {/if}
              </svg>
            </span>
            {#if row.state !== 'na'}<span class="ov-vh">{row.state === 'ok' ? 'Done:' : 'To do:'}</span>{/if}
            <span class="ov-check-label">{row.label}</span>
            {#if row.state === 'na'}
              <span class="ov-hint">not applicable</span>
            {:else if row.state === 'violated' && row.hintTab}
              <button
                type="button"
                class="ov-hint-link"
                data-action={row.hintTab === 'roster' ? 'goto-unassigned' : `goto-${row.hintTab}`}
                onclick={() => goHint(row)}
              >{row.hint}</button>
            {:else if row.state === 'violated' && row.hint}
              <span class="ov-hint">{row.hint}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if isAdmin && run.is_published && unpublishConfirmOpen}
        <div class="ov-foot">
          <InlineConfirm
            row
            takeFocus
            warning="Students lose access immediately; their progress is kept."
            confirmLabel="Unpublish"
            confirmDataAction="confirm-unpublish"
            onConfirm={() => void confirmUnpublish()}
            onCancel={() => void cancelUnpublish()}
          />
        </div>
      {:else}
        <div class="ov-foot">
          <span class="ov-foot-note">{footNote}</span>
          {#if isAdmin && !run.is_published}
            <Button
              variant="primary"
              data-action="publish"
              bind:element={publishEl}
              disabled={publishBlocked}
              aria-disabled={!publishBlocked && runWrite}
              loading={publishing}
              title={publishTitle}
              onclick={() => void publish()}
            >{publishing ? 'Publishing…' : 'Publish run'}</Button>
          {:else if isAdmin}
            <Button
              variant="secondary"
              data-action="unpublish"
              bind:element={unpublishEl}
              aria-disabled={runWrite}
              title={runWrite ? WAIT : undefined}
              onclick={openUnpublish}
            >Unpublish</Button>
          {/if}
        </div>
      {/if}
    </section>

    {#if isAdmin}
      <section class="ov-card ov-del-card" aria-labelledby="{uid}-del">
        <div class="ov-del">
          <div class="ov-del-text">
            <h2 class="ov-del-title" id="{uid}-del" tabindex="-1" bind:this={deleteHead}>Delete this run</h2>
            <p class="ov-del-sub">Only while unpublished. Roster, groups and submissions go with it.</p>
          </div>
          <IconButton
            glyph="trash"
            danger
            title={trashTitle}
            aria-label="Delete this run"
            data-action="delete-run"
            disabled={run.is_published}
            aria-disabled={!run.is_published && runWrite}
            aria-expanded={deleteOpen}
            aria-controls={deleteOpen ? `${uid}-delpanel` : undefined}
            bind:element={trashEl}
            onclick={toggleDelete}
          />
        </div>
        {#if deleteOpen}
          <div class="ov-del-panel" id="{uid}-delpanel">
            <DangerConfirm
              message={deleteMessage}
              busy={deleteBusy}
              disabledReason={runWrite && !deleteBusy ? WAIT : undefined}
              onConfirm={forceDelete}
              onCancel={() => void cancelDelete()}
            />
          </div>
        {/if}
        {#if deleteError}<p class="ov-err" role="alert">{deleteError}</p>{/if}
      </section>
    {/if}
```

In the `<style>` block, delete every rule from `.readiness,` through `.danger-zone button[data-action="delete-run"] { … }` and add before `</style>`:

```css
  /* Publish readiness: an 18px status box, the label, an optional hint. */
  .ov-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .ov-check { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; padding: 7px 0; border-bottom: 1px solid var(--border-soft); }
  .ov-check:last-child { border-bottom: 0; }
  .ov-box { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 18px; height: 18px; border-radius: 4px; }
  .ov-box svg { width: 11px; height: 11px; }
  .ov-box-ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ov-box-violated { background: var(--status-needs-revision-bg); color: var(--status-needs-revision-fg); }
  .ov-box-na { background: var(--surface-2); color: var(--muted); }
  .ov-check-label { font-size: 13px; color: var(--text); }
  .ov-hint { font-size: 12.5px; color: var(--muted); }
  .ov-hint-link { padding: 0; border: 0; background: none; font: inherit; font-size: 12.5px; color: var(--primary); text-align: left; cursor: pointer; }
  .ov-hint-link:hover { text-decoration: underline; }
  .ov-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
  .ov-foot-note { flex: 1; font-size: 12.5px; color: var(--muted); }

  /* Delete this run: one row (P22), then the danger panel under it. */
  .ov-del-card { padding: 14px 18px; }
  .ov-del { display: flex; align-items: center; gap: 12px; }
  .ov-del-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .ov-del-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text); }
  .ov-del-title:focus { outline: none; }
  .ov-del-sub { margin: 0; font-size: 12px; color: var(--muted); }
  .ov-del-panel { margin-top: 12px; }
  .ov-err { margin: 12px 0 0; padding: 8px 12px; background: var(--status-rejected-bg); border-left: 3px solid var(--danger); border-radius: var(--radius); font-size: 13px; color: var(--status-rejected-fg); }
  .ov-vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
```

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunOverviewTab.svelte.test.ts src/tests/RunOverviewTab.checklist.svelte.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing page tests**

In `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`:
- Add `import { currentRoute } from '../lib/router.svelte';` after the `RunDetailPage` import, and end `beforeEach` with these lines, so a hint link's `?tab=` from one test does not open the next test on that tab (the `at()` helper of `RunDetailPage.tabs.svelte.test.ts`):

```ts
  history.replaceState(null, '', '/teaching/algebra/runs/10');
  currentRoute.path = location.pathname;
  currentRoute.search = '';
  currentRoute.hash = '';
```
- In `'renders Unpublish + confirmation for published runs'`, replace

```ts
    expect(target.textContent).toContain('Confirm Unpublish');
    expect(target.textContent).toContain('lose access');
```

with

```ts
    expect(target.querySelector('button[data-action="confirm-unpublish"]')?.textContent).toBe('Unpublish');
    expect(target.textContent).toContain('Students lose access immediately; their progress is kept.');
```

- In `'refetches run on 409 unpublish race so the UI flips back to Publish'`, add after `expect(runGetCount).toBe(2);`:

```ts
    // 'draft-now' (R33): focus lands on Publish run, never on <body>.
    expect(document.activeElement).toBe(pubBtn);
```

- In `describe('publish-bar split for course.is_admin', …)`, change both `/^Publish$/` to `/^Publish run$/`, and add to the teacher test before `unmount(cmp);`:

```ts
    expect(target.querySelector('.ov-foot-note')?.textContent?.trim()).toBe('A course admin publishes this run.');
```

- Append at the end of the file:

```ts
// A response the test releases by hand.
function held() {
  let release!: (r: Response) => void;
  const p = new Promise<Response>((r) => { release = r; });
  return { p, release };
}
function resp(body: unknown, status = 200): Response {
  return {
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const runBase = {
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false,
};
type Route = (url: string, init?: RequestInit) => Promise<Response> | null;

// The page's loads (one teacher by default, so Publish run is enabled), with
// `extra` asked first: a write the test answers or holds.
function mountWith(extra: Route, opts: {
  run?: Record<string, unknown>;
  course?: Record<string, unknown>;
  version?: Record<string, unknown>;
  teachers?: unknown[];
  groups?: unknown[];
  students?: unknown[];
} = {}) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const hit = extra(url, init);
    if (hit) return hit;
    if (url.includes('/courses/by-slug/')) return jres({
      id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true, ...(opts.course ?? {}),
    });
    const m = url.match(/\/api\/runs\/(\d+)$/);
    if (m && init?.method === 'GET') return jres({ ...runBase, ...(opts.run ?? {}), id: Number(m[1]) });
    if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
    if (url.includes('/mini-projects')) return jres([]);
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
    if (url.includes('/versions')) return jres([{
      id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false, label: 'Spring 2026',
      ...(opts.version ?? {}),
    }]);
    if (url.includes('/teachers')) return jres(opts.teachers ?? [{ user_id: 1, user_email: 't@x.com' }]);
    if (url.includes('/groups')) return jres(opts.groups ?? []);
    if (url.includes('/students')) return jres(opts.students ?? []);
    return Promise.reject(new Error('unexpected ' + url));
  });
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ courseSlug: 'algebra', runId: '10' });
  const cmp = mount(RunDetailPage, { target, props });
  return { target, cmp, props };
}

const q = (t: HTMLElement, action: string) => t.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
const isPost = (url: string, init: RequestInit | undefined, tail: string) => url.endsWith(tail) && init?.method === 'POST';

describe('Publish and Unpublish live in the Overview (R33, R44)', () => {
  it('the title row has no publish bar', async () => {
    const { target, cmp } = mountWith(() => null);
    await settle();
    expect(target.querySelector('.run-title-row button')).toBeNull();
    expect(target.querySelector('.publish-bar')).toBeNull();
    expect(q(target, 'publish')?.textContent?.trim()).toBe('Publish run');
    unmount(cmp);
  });

  it('two clicks while the request runs send one POST; the busy button is aria-disabled, keeps focus, then Unpublish has it', async () => {
    const hold = held();
    let posts = 0;
    const { target, cmp } = mountWith((url, init) => {
      if (isPost(url, init, '/publish')) { posts++; return hold.p; }
      return null;
    });
    await settle();
    const btn = q(target, 'publish')!;
    btn.focus();
    btn.click();
    btn.click();
    await settle();
    expect(posts).toBe(1);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent?.trim()).toBe('Publishing…');
    expect(document.activeElement).toBe(btn);
    hold.release(resp({ ...runBase, is_published: true }));
    await settle();
    expect(document.activeElement).toBe(q(target, 'unpublish'));
    unmount(cmp);
  });

  it('a 409 that is not a conflicts response refetches; a run found published counts as published', async () => {
    let published = false;
    const { target, cmp } = mountWith((url, init) => {
      if (isPost(url, init, '/publish')) { published = true; return jres({ detail: 'Run already published' }, 409); }
      if (/\/api\/runs\/10$/.test(url) && init?.method === 'GET' && published) return jres({ ...runBase, is_published: true });
      return null;
    });
    await settle();
    q(target, 'publish')!.focus();
    q(target, 'publish')!.click();
    await settle();
    await settle();
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('Run already published', 'error');
    expect(document.activeElement).toBe(q(target, 'unpublish'));
    unmount(cmp);
  });

  it("a second click on the confirm's Unpublish sends one POST; then Publish run has focus", async () => {
    const hold = held();
    let posts = 0;
    const { target, cmp } = mountWith((url, init) => {
      if (isPost(url, init, '/unpublish')) { posts++; return hold.p; }
      return null;
    }, { run: { is_published: true } });
    await settle();
    q(target, 'unpublish')!.click();
    flushSync();
    const confirm = q(target, 'confirm-unpublish')!;
    confirm.click();
    confirm.click();
    await settle();
    expect(posts).toBe(1);
    hold.release(resp({ ...runBase, is_published: false }));
    await settle();
    expect(document.activeElement).toBe(q(target, 'publish'));
    unmount(cmp);
  });

  it('a run change (loadAll) frees a stuck publish: Publish run sends again on the new run', async () => {
    const hold = held();
    const posts: string[] = [];
    const { target, cmp, props } = mountWith((url, init) => {
      if (isPost(url, init, '/publish')) {
        posts.push(url);
        return posts.length === 1 ? hold.p : jres({ ...runBase, id: 11, is_published: true });
      }
      return null;
    });
    await settle();
    q(target, 'publish')!.click();
    await settle();
    props.runId = '11';
    flushSync();
    await settle();
    const again = q(target, 'publish')!;
    expect(again.getAttribute('aria-disabled')).toBeNull();
    again.click();
    await settle();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain('/api/runs/11/publish');
    unmount(cmp);
  });

  it('a remount of the Overview while publishing keeps the pencils and the switch locked (R32)', async () => {
    const hold = held();
    const { target, cmp } = mountWith((url, init) => (isPost(url, init, '/publish') ? hold.p : null));
    await settle();
    q(target, 'publish')!.click();
    await settle();
    (target.querySelector('#run-tab-teachers') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('#run-tab-overview') as HTMLButtonElement).click();
    await settle();
    expect(q(target, 'edit-title')!.disabled).toBe(true);
    expect(target.querySelector('button[role="switch"]')!.getAttribute('aria-disabled')).toBe('true');
    hold.release(resp({ ...runBase, is_published: true }));
    await settle();
    expect(q(target, 'edit-title')!.disabled).toBe(false);
    unmount(cmp);
  });
});

describe('Publish readiness rows from the page (R34)', () => {
  const rows = (t: HTMLElement) => Array.from(t.querySelectorAll('li.ov-check')).map((li) => [
    li.getAttribute('data-check'), li.getAttribute('data-state'),
    li.querySelector('.ov-hint, .ov-hint-link')?.textContent?.trim() ?? '',
  ]);

  it('groups off: four rows, the two group rows not applicable', async () => {
    const { target, cmp } = mountWith(() => null);
    await settle();
    expect(rows(target)).toEqual([
      ['teacher', 'ok', ''], ['version', 'ok', ''],
      ['assigned', 'na', 'not applicable'], ['sizes', 'na', 'not applicable'],
    ]);
    unmount(cmp);
  });

  it('no teacher: "Add a teacher — open Teachers" opens Teachers with focus on its tab', async () => {
    const { target, cmp } = mountWith(() => null, { teachers: [] });
    await settle();
    expect(rows(target)[0]).toEqual(['teacher', 'violated', 'Add a teacher — open Teachers']);
    expect(q(target, 'publish')!.title).toBe('No teacher is assigned yet');
    q(target, 'goto-teachers')!.click();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('#run-tab-teachers'));
    unmount(cmp);
  });

  it('a disabled version: row 2 violated with the role hint; Publish run disabled with "The course version is disabled"', async () => {
    const admin = mountWith(() => null, { version: { is_disabled: true } });
    await settle();
    expect(rows(admin.target)[1]).toEqual(['version', 'violated', 'Re-enable it in the course editor']);
    expect(q(admin.target, 'publish')!.disabled).toBe(true);
    expect(q(admin.target, 'publish')!.title).toBe('The course version is disabled');
    unmount(admin.cmp);
    const teacher = mountWith(() => null, { version: { is_disabled: true }, course: { is_admin: false } });
    await settle();
    expect(rows(teacher.target)[1]).toEqual(['version', 'violated', 'Ask a course admin to re-enable it']);
    unmount(teacher.cmp);
  });

  it('groups on, no students: row 3 ok and Publish run enabled', async () => {
    const { target, cmp } = mountWith(() => null, { run: { groups_enabled: true } });
    await settle();
    expect(rows(target)[2]).toEqual(['assigned', 'ok', '']);
    expect(q(target, 'publish')!.disabled).toBe(false);
    unmount(cmp);
  });

  it('groups on, no groups and an unassigned student: "No groups yet — open Groups"', async () => {
    const { target, cmp } = mountWith(() => null, {
      run: { groups_enabled: true },
      students: [{ user_id: 2, email: 'a@x.com', full_name: null, group_id: null }],
    });
    await settle();
    expect(rows(target)[2]).toEqual(['assigned', 'violated', 'No groups yet — open Groups']);
    expect(q(target, 'publish')!.title).toBe('1 student is still unassigned to a group');
    unmount(cmp);
  });

  it('groups on, 3 unassigned and an oversized group: two violations and the Roster jump', async () => {
    const { target, cmp } = mountWith(() => null, {
      run: { groups_enabled: true },
      groups: [{ id: 1, run_id: 10, name: 'Group A', student_count: 12 }],
      students: [1, 2, 3].map((n) => ({ user_id: n, email: `s${n}@x.com`, full_name: null, group_id: null })),
    });
    await settle();
    expect(rows(target).slice(2)).toEqual([
      ['assigned', 'violated', '3 unassigned — open Roster'],
      ['sizes', 'violated', 'Group A (12)'],
    ]);
    expect(target.querySelector('.ov-foot-note')?.textContent?.trim()).toBe('Fix the 2 outstanding checks to publish.');
    expect(q(target, 'publish')!.title).toBe('3 students are still unassigned to a group');
    unmount(cmp);
  });
});

describe('Delete this run from the page (D24, D28, P24)', () => {
  async function arm(target: HTMLElement) {
    q(target, 'delete-run')!.click();
    flushSync();
    (target.querySelector('input[data-role="danger-ack"]') as HTMLInputElement).click();
    flushSync();
    return q(target, 'force-delete')!;
  }

  it('Force delete sends DELETE ?force=true and toasts "Run deleted."', async () => {
    const deletes: string[] = [];
    const { target, cmp } = mountWith((url, init) => {
      if (init?.method === 'DELETE') { deletes.push(url); return jres(null, 204); }
      return null;
    });
    await settle();
    (await arm(target)).click();
    await settle();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/api/runs/10?force=true');
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('Run deleted.', 'success');
    unmount(cmp);
  });

  it('a 409 refetches the run, closes the panel, toasts, and focuses the card heading', async () => {
    let published = false;
    const { target, cmp } = mountWith((url, init) => {
      if (init?.method === 'DELETE') { published = true; return jres({ detail: 'Unpublish run before deleting' }, 409); }
      if (/\/api\/runs\/10$/.test(url) && init?.method === 'GET' && published) return jres({ ...runBase, is_published: true });
      return null;
    });
    await settle();
    (await arm(target)).click();
    await settle();
    await settle();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(vi.mocked(pushToast)).toHaveBeenCalledWith('This run was published in the meantime. Unpublish it before deleting.', 'error');
    expect(q(target, 'delete-run')!.disabled).toBe(true);
    expect(q(target, 'delete-run')!.title).toBe('Unpublish the run before deleting it');
    expect((document.activeElement as HTMLElement).textContent).toBe('Delete this run');
    unmount(cmp);
  });

  it('another failure shows the error line, keeps the panel and refocuses its box (R45)', async () => {
    const { target, cmp } = mountWith((_url, init) => (init?.method === 'DELETE' ? jres({ detail: 'Database is busy' }, 503) : null));
    await settle();
    const force = await arm(target);
    force.focus();
    force.click();
    await settle();
    await settle();
    expect(target.querySelector('.ov-err')?.textContent).toBe('Database is busy');
    const box = target.querySelector('input[data-role="danger-ack"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(document.activeElement).toBe(box);
    unmount(cmp);
  });
});
```

In `frontend/src/tests/RunDetailPage.svelte.test.ts`, replace the test `'deleting a run from Overview lands on /teaching/:slug (6a D3)'` (`:272-287`) with:

```ts
  it('deleting a run from Overview force-deletes it and lands on /teaching/:slug (6a D3, D24)', async () => {
    mockHappyPath();
    const inner = fetchSpy.getMockImplementation()!;
    const deletes: string[] = [];
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') { deletes.push(url); return jres(null, 204); }
      return inner(url, init);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    (target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement).click();
    flushSync();
    (target.querySelector('input[data-role="danger-ack"]') as HTMLInputElement).click();
    flushSync();
    (target.querySelector('button[data-action="force-delete"]') as HTMLButtonElement).click();
    await settle();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/api/runs/10?force=true');
    expect(location.pathname).toBe('/teaching/algebra');
    unmount(cmp);
  });
```

In `frontend/src/tests/RunDetailPage.tabs.svelte.test.ts`, `mockRun` (`:49`), replace

```ts
    if (url.includes('/groups')) return jres([]);
```

with

```ts
    // R34: with zero groups the unassigned row offers Groups; one group keeps the Roster jump.
    if (url.includes('/groups')) return jres([{ id: 1, run_id: 10, name: 'Group A', is_disabled: false, student_count: 0 }]);
```

so its three `goto-unassigned` tests (`:140-149`, `:167ff`, `:217ff`) still find the Roster jump.

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunDetailPage.publish.svelte.test.ts src/tests/RunDetailPage.svelte.test.ts`
Expected: FAIL — the page still passes the old props (`onPublish` is undefined, so Publish run in the Overview throws or does nothing), the publish bar still sits in the title row, and the readiness rows carry the old labels and no `version` row.

- [ ] **Step 10: The page — readiness rows, outcomes, flags, no publish bar**

In `frontend/src/pages/runs/RunDetailPage.svelte`:

Remove the import `import Button from '../../components/ui/Button.svelte';` and replace

```ts
  import InlineConfirm from '../../components/ui/InlineConfirm.svelte';
  import RunOverviewTab from '../../components/runs/RunOverviewTab.svelte';
```

with

```ts
  import RunOverviewTab, {
    type DeleteOutcome, type PublishOutcome, type Readiness, type ReadinessRow, type UnpublishOutcome,
  } from '../../components/runs/RunOverviewTab.svelte';
```

In `loadAll`, replace

```ts
    const myToken = ++loadToken;
    course = null; run = null; versions = null; teachers = null;
```

with

```ts
    const myToken = ++loadToken;
    // R33: a run change, a course change or reloadRun() frees a stuck publish.
    publishing = false; unpublishing = false;
    course = null; run = null; versions = null; teachers = null;
```

Replace everything from `  type ChecklistState = 'ok' | 'violated' | 'na';` through the closing `}` of `doUnpublish` (`:226-347`) with:

```ts
  // R34: the rows in the order of the server's publish checks (api/runs.py
  // publish_run): a teacher, an enabled version, no unassigned student, no
  // oversized group. No students and no groups are fine.
  const readiness = $derived.by((): Readiness => {
    if (!run || teachers === null || groups === null || students === null) return { checks: [] };
    const checks: ReadinessRow[] = [];
    const teacherLabel = 'At least one teacher assigned';
    checks.push(teachers.length > 0
      ? { id: 'teacher', label: teacherLabel, state: 'ok' }
      : { id: 'teacher', label: teacherLabel, state: 'violated', hint: 'Add a teacher — open Teachers', hintTab: 'teachers', reason: 'No teacher is assigned yet' });
    const versionLabel = 'Course version enabled';
    if (!pinned) checks.push({ id: 'version', label: versionLabel, state: 'na' });
    else if (pinned.is_disabled) {
      checks.push({
        id: 'version', label: versionLabel, state: 'violated',
        hint: isAdmin ? 'Re-enable it in the course editor' : 'Ask a course admin to re-enable it',
        reason: 'The course version is disabled',
      });
    } else checks.push({ id: 'version', label: versionLabel, state: 'ok' });
    const assignedLabel = 'Every student assigned to a group';
    const sizesLabel = 'No group over 10 students';
    if (!run.groups_enabled) {
      checks.push({ id: 'assigned', label: assignedLabel, state: 'na' }, { id: 'sizes', label: sizesLabel, state: 'na' });
      return { checks };
    }
    const unassigned = students.filter((s: RunStudentResponse) => s.group_id === null).length;
    if (unassigned === 0) checks.push({ id: 'assigned', label: assignedLabel, state: 'ok' });
    else {
      checks.push({
        id: 'assigned', label: assignedLabel, state: 'violated',
        hint: groups.length === 0 ? 'No groups yet — open Groups' : `${unassigned} unassigned — open Roster`,
        hintTab: groups.length === 0 ? 'groups' : 'roster',
        reason: unassigned === 1 ? '1 student is still unassigned to a group' : `${unassigned} students are still unassigned to a group`,
      });
    }
    const oversized = groups.filter((g: GroupResponse) => g.student_count > 10);
    if (oversized.length === 0) checks.push({ id: 'sizes', label: sizesLabel, state: 'ok' });
    else {
      const list = oversized.map((g: GroupResponse) => `${g.name} (${g.student_count})`).join(', ');
      checks.push({ id: 'sizes', label: sizesLabel, state: 'violated', hint: list, reason: `Groups over 10 students: ${list}` });
    }
    return { checks };
  });

  let publishConflicts: PublishConflict[] = $state([]);
  let publishModalOpen = $state(false);
  // R33: one publish / unpublish request at a time. Each flag clears only on
  // its own load token; loadAll resets both.
  let publishing = $state(false);
  let unpublishing = $state(false);

  // After a publish 409 the page may be stale: read back what the rows use.
  async function refetchReadiness(rid: number, myToken: number): Promise<void> {
    if (!course) return;
    try {
      const [r, vs, ts, gs, ss] = await Promise.all([
        getRun(rid), listVersions(course.id), listRunTeachers(rid), listGroups(rid), listRunStudents(rid),
      ]);
      if (myToken !== loadToken) return;
      run = r; versions = vs; teachers = ts; groups = gs; students = ss;
    } catch { /* the toast already said why; the page keeps what it had */ }
  }

  async function doPublish(): Promise<PublishOutcome> {
    if (runIdInt === null || publishing || unpublishing) return 'failed';
    const myToken = loadToken;
    const rid = runIdInt;
    publishing = true;
    try {
      const r = await publishRun(rid);
      if (myToken !== loadToken) return 'failed';
      run = r;
      return 'published';
    } catch (e) {
      if (myToken !== loadToken) return 'failed';
      if (e instanceof ApiError && e.errorCode === 'student_already_active_in_course') {
        const raw = (e.body as { conflicts?: unknown } | undefined)?.conflicts;
        const conflicts: PublishConflict[] = Array.isArray(raw) ? (raw as PublishConflict[]) : [];
        if (conflicts.length === 0) {
          pushToast(e.displayMessage, 'error');
          return 'failed';
        }
        publishConflicts = conflicts;
        publishModalOpen = true;
        return 'conflicts';
      }
      if (e instanceof ApiError) {
        pushToast(e.displayMessage, 'error');
        // Published elsewhere, or a check this page missed: read the run back.
        if (e.status === 409) {
          await refetchReadiness(rid, myToken);
          if (myToken === loadToken && run?.is_published) return 'published';
        }
      }
      return 'failed';
    } finally {
      if (myToken === loadToken) publishing = false;
    }
  }

  async function doUnpublish(): Promise<UnpublishOutcome> {
    if (runIdInt === null || publishing || unpublishing) return 'failed';
    const myToken = loadToken;
    const rid = runIdInt;
    unpublishing = true;
    try {
      const r = await unpublishRun(rid);
      if (myToken !== loadToken) return 'failed';
      run = r;
      return 'unpublished';
    } catch (e) {
      if (myToken !== loadToken) return 'failed';
      if (e instanceof ApiError) {
        pushToast(e.displayMessage, 'error');
        // 409 "Run is not published": another tab unpublished first.
        if (e.status === 409) {
          try {
            const r = await getRun(rid);
            if (myToken !== loadToken) return 'failed';
            run = r;
            if (!r.is_published) return 'draft-now';
          } catch { /* refetch failed; toast already shown */ }
        }
      }
      return 'failed';
    } finally {
      if (myToken === loadToken) unpublishing = false;
    }
  }

  // D24 / D28 / P24: a forced delete; a 409 means the run was published meanwhile.
  async function onDeleteRun(): Promise<DeleteOutcome> {
    if (runIdInt === null) return { kind: 'failed', message: 'Invalid run.' };
    const myToken = loadToken;
    const rid = runIdInt;
    try {
      await deleteRun(rid, { force: true });
      pushToast('Run deleted.', 'success');
      void navigate(`/teaching/${encodeURIComponent(courseSlug)}`);
      return { kind: 'deleted' };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          const r = await getRun(rid);
          if (myToken === loadToken) run = r;
        } catch { /* keep the page as it is; the toast explains */ }
        pushToast('This run was published in the meantime. Unpublish it before deleting.', 'error');
        return { kind: 'published-now' };
      }
      return { kind: 'failed', message: e instanceof ApiError ? e.displayMessage : 'Could not delete the run.' };
    }
  }
```

In the markup, delete the whole publish bar from the title row (`:368-383`):

```svelte
        {#if course.is_admin}
          <div class="publish-bar">
            …
          </div>
        {/if}
```

so the row reads `<h1>`, `<RunStatusChip>`, `<p class="run-meta">` only. Replace the Overview call (Task 1's) with:

```svelte
        <RunOverviewTab
          {run}
          setRun={(r) => (run = r)}
          {pinned}
          {isAdmin}
          {readiness}
          publishing={publishing || unpublishing}
          onNavigateTab={gotoTab}
          onPublish={doPublish}
          onUnpublish={doUnpublish}
          {onDeleteRun}
        />
```

In the `<style>` block delete the line `.publish-bar { margin-left: auto; display: flex; align-items: center; gap: 8px; }`.

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunDetailPage.publish.svelte.test.ts src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts src/tests/RunOverviewTab.svelte.test.ts src/tests/RunOverviewTab.checklist.svelte.test.ts`
Expected: PASS. (The existing conflicts tests keep passing unchanged: Publish run keeps focus while busy, so the modal's FocusTrap returns focus to it, `:555-574`; Test 4's `capacity_reached` 409 refetches without a second toast.)

- [ ] **Step 11: Gate rows**

In `frontend/scripts/visual-refresh-gate.sh` section (al):

Replace

```zsh
FILES_6C=(
)
```

with

```zsh
FILES_6C=(
  src/components/runs/RunOverviewTab.svelte
)
```

Inside the `RunOverviewTab` block, insert before `  sweep RunOverviewTab $H`:

```zsh
  d '\.ov-check' '' 'display:flex' 'gap:9px' 'padding:7px 0' 'border-bottom:1px solid var\(--border-soft\)'
  d '\.ov-box' '' 'width:18px' 'height:18px' 'border-radius:4px'
  chk "\.ov-box\.${H} svg:where\(\.${H}\)" 'width:11px' 'height:11px'
  d '\.ov-box-ok' '' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)'
  d '\.ov-box-violated' '' 'background:var\(--status-needs-revision-bg\)' 'color:var\(--status-needs-revision-fg\)'
  d '\.ov-box-na' '' 'background:var\(--surface-2\)' 'color:var\(--muted\)'
  d '\.ov-hint-link' '' 'color:var\(--primary\)'
  d '\.ov-foot' '' 'margin-top:12px' 'padding-top:12px' 'border-top:1px solid var\(--border\)'
  d '\.ov-foot-note' '' 'flex:1' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.ov-del-card' '' 'padding:14px 18px'
  d '\.ov-del-title' '' 'font-size:13px' 'font-weight:600'
  d '\.ov-err' '' 'background:var\(--status-rejected-bg\)' 'border-left:3px solid var\(--danger\)' 'color:var\(--status-rejected-fg\)'
  none "RunOverviewTab's pre-6c rules are gone (.readiness, .danger-zone, .run-summary, .run-settings)" "\.(readiness|danger-zone|run-summary|run-settings)\.${H}"
```

and after the block's closing `fi`, add:

```zsh
# R44 / P23: an aria-disabled Button or IconButton looks disabled; a busy Button keeps its look.
own btn Button.svelte
uniq1 btn
if [[ -n $REPLY ]]; then
  N=Button; H=$REPLY
  d '\.btn\.blocked' '' 'background:var\(--bg\)' 'color:var\(--faint\)' 'border-color:var\(--border-faint\)' 'cursor:not-allowed'
fi
uniq1 icon-btn
if [[ -n $REPLY ]]; then
  N=IconButton; H=$REPLY
  d '\.icon-btn\.blocked' '' 'background:var\(--bg\)' 'color:var\(--faint\)' 'border-color:var\(--border-faint\)' 'cursor:not-allowed'
fi
# Publish run lives in the Overview: the run page's title row has no publish bar.
none "RunDetailPage has no .publish-bar rule" "\.publish-bar\."
```

Set `EXPECTED_CHECKS=1851` at `:90` (1810 + 41: the Overview's 28 declarations (`.ov-check` 4, `.ov-box` 3, its svg 2, the three box states 6, `.ov-hint-link` 1, `.ov-foot` 3, `.ov-foot-note` 3, `.ov-del-card` 1, `.ov-del-title` 2, `.ov-err` 3) and its old-rules `none` 1; Button `own` 1, `uniq1` 1, 4 declarations; IconButton `uniq1` 1, 4 declarations; the `.publish-bar` `none` 1). `RunOverviewTab` joining `FILES_6C` adds no line: the two scans already run once each.

- [ ] **Step 12: Run the full checks**

Run the backend suite, the frontend tests, svelte-check and the gate exactly as Global Constraints › Commands give them.
Expected: backend `exit 0` with no failures; vitest `exit 0` and `0` Errors/Unhandled lines; svelte-check 0 errors, 13 warnings; gate `VISUAL-REFRESH GATE: ALL PASS (1851 checks)`.

- [ ] **Step 13: Screenshots for the user**

Signed in as `dev@mathion.test`, on `http://localhost:5174/teaching/demo-course/runs/8?tab=overview`. Read the real `GET /api/runs/8` body first (`agent-browser network requests`). Shots at 1280×800 and 1000×800 (absolute paths in the 6c sdd dir):
1. The run as it is (published, if it is): the readiness card with "Published — students have access." and Unpublish; the delete card with the disabled 🗑.
2. Unpublish clicked: the one-line confirm (do NOT click its Unpublish unless `**/api/runs/8/unpublish` is mocked).
3. A draft: mock `**/api/runs/8` with the real body and `"is_published": false`, reload: "Ready to publish." (or the outstanding-check note) and Publish run.
4. Publish run busy: mock `**/api/runs/8/publish` with a slow response (the core guide's delay option) and click it once.
5. The danger panel: on the mocked draft, click 🗑 and tick "I understand"; then mock `**/api/runs/8?force=true` → 503 `{"detail":"Database is busy"}`, click Force delete, and shoot the error line.

Build the overlay (10a reference beside each shot), open it with `--size-percent 60`, and wait for the user's OK. Clear every route afterwards.

- [ ] **Step 14: Review lanes**

Run the Opus (high) and Fable lanes on the uncommitted diff (frontend and backend), with the spec, this task's text and the Global Constraints. Fix every Critical and Important finding; re-run both lanes after every fix until both are clean. Minors go to the backlog under "## Task 2 — Readiness, publish and delete".

- [ ] **Step 15: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/mathion/api/runs.py backend/mathion/api/submission_files.py \
  backend/tests/test_runs.py backend/tests/test_concurrency_mini_project.py \
  frontend/src/lib/runs.ts frontend/src/components/ui/Button.svelte frontend/src/components/ui/IconButton.svelte \
  frontend/src/components/ui/DangerConfirm.svelte frontend/src/components/runs/RunOverviewTab.svelte \
  frontend/src/pages/runs/RunDetailPage.svelte frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/Button.svelte.test.ts frontend/src/tests/IconButton.svelte.test.ts \
  frontend/src/tests/DangerConfirm.svelte.test.ts frontend/src/tests/RunOverviewTab.svelte.test.ts \
  frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts frontend/src/tests/RunDetailPage.publish.svelte.test.ts \
  frontend/src/tests/RunDetailPage.svelte.test.ts frontend/src/tests/RunDetailPage.tabs.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6c): Overview readiness, publish and force delete (10a); server refuses deleting a published run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Then the ledger line, memory, and wait for "go".

---

### Task 3: Roster — banner, toolbar, add row, empty states and the import modal

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte` (whole file, 686 lines at `6402e1e`): the props gain `isAdmin`. The draft banner (`:387-402`), the toolbar (`:404-419`), the empty `<p>` (`:421-426`), the no-match `<p>` (`:594-604`) and the add form under the table (`:606-620`) are replaced. The old result banner (`:428-479`), strip (`:481-520`) and table (`:522-592`) stay unchanged for Task 4, except that the table now renders only while a row is visible. The style block loses the old `.banner`, `.roster-tab`, `.roster-toolbar`, `.prefilter-pill`, `.add-row`, `.empty`, `.error` and `.linklike` rules.
- Modify: `frontend/src/components/ui/IconButton.svelte`, as Task 2 left it: the header comment `:2`, the `Props` type (after `tabindex?: number;`, `:38` at `6402e1e`), the destructuring (after `tabindex = undefined,`, `:60`), the markup `<button …>…</button>` (`:65-128`), and the style (after the `.icon-btn` rule, `:134-145`). Line numbers are those at `6402e1e`; Task 2's `aria-disabled` shifts them.
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte`, anchors by content (lines at `6402e1e`, shifted after Tasks 1–2):
  - the `RunRosterTab` call (`runIsPublished={run.is_published}`, `:432`);
  - the `{#if showImportModal}` block inside the roster branch (`:444-452`);
  - the end of the loaded branch (`</div>` of `.run-panel`, then `{/if}`, `:497-498`);
  - `refetchGroupsAndStudents` (`:189-194`).
- Modify: `frontend/scripts/visual-refresh-gate.sh`: append rows at the end of section (al), just before `# The summary line is the parent process's (see the re-exec at the top).`; `EXPECTED_CHECKS` at `:90`.
- Create: `frontend/src/tests/RunRosterTab.toolbar.svelte.test.ts`.
- Test (modify):
  - `frontend/src/tests/RunRosterTab.svelte.test.ts`, `RunRosterTab.draft-gate.svelte.test.ts`, `RunRosterTab.add-error.svelte.test.ts`: `isAdmin`; the add row opens behind +.
  - `RunRosterTab.bulk-banner.svelte.test.ts`, `RunRosterTab.bulk-core.svelte.test.ts`, `RunRosterTab.optimistic.svelte.test.ts`: `isAdmin` only.
  - `IconButton.svelte.test.ts`: R41.
  - `RunDetailPage.tabs.svelte.test.ts`: the chip copy, and R39.

**Interfaces:**
- Consumes:
  - From Task 2, `ui/Button` props `'aria-disabled'` (→ `aria-disabled="true"`, `class:blocked`) and `loading` (→ `aria-busy="true"`); the click still fires.
  - From Task 2, `ui/IconButton` prop `'aria-disabled'?: boolean` (local name `ariaDisabled`; → `aria-disabled="true"`, `class:blocked`).
  - `ui/EmptyState` (`title`, an `action` snippet); `RosterImportModal` (`runId`, `existingRoster`, `existingGroups`, `onRefetchBeforeSubmit`, `onClose`; its paste-stage Cancel is `button[data-action="cancel"]`).
  - The page's `isAdmin` (`$derived(course?.is_admin === true)`), `tabEls`, `activeTab` and `tick` (already imported).
- Produces:
  - `RunRosterTab` prop `isAdmin: boolean` (required).
  - Its hooks:
    - `button[data-action="toggle-add-student"]`: `aria-expanded`, `aria-controls` → `form.ro-add`, glyph plus / close;
    - `button[data-action="cancel-add-student"]`, `button[data-action="open-add-link"]`;
    - `form.ro-add`, `p.ro-err.error[role="alert"]` (id in the e-mail field's `aria-describedby`);
    - `.ro-info#roster-draft-publish-hint`, `.ro-chip`, `.ro-nomatch`.
  - Its internals for Task 4:
    - `uid`, `DRAFT_HINT_ID`, `draftTitle`, `enabledGroups`, `groupLabel(g)`, `addShown`, `adding`;
    - the refs `searchEl`, `toggleEl`, `emailEl`, `importBtnEl`;
    - `clearPrefilter()`, `clearSearch()`, `openAdd()`, `closeAdd()`;
    - the classes `.ro-tab`, `.ro-select`, `.ro-link`, `.vh`.
  - `IconButton` props `href?: string`, `download?: boolean | string`, `describedby?: string` (Task 6's download link uses `href` + `download`).
  - `RunDetailPage.closeImport()`; the import modal renders after `.run-panel` in the loaded branch.
  - Gate: the `RunRosterTab` block in (al) (`own ro-toolbar` / `uniq1 ro-toolbar`, `if … fi`), which Task 4 extends.

- [ ] **Step 1: Write the failing toolbar tests**

Create `frontend/src/tests/RunRosterTab.toolbar.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

// Slice 6c Task 3 (10b): the draft banner, the toolbar, the add row behind +
// (D25), the empty state and the no-match lines. §Focus › Roster.
const fetchSpy = vi.fn();
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
});

function resp(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const jres = (body: unknown, status = 200) => Promise.resolve(resp(body, status));

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const student = (id: number, over: Partial<RunStudentResponse> = {}): RunStudentResponse => ({
  id,
  run_id: 10,
  user_id: id,
  user_email: `s${id}@x.com`,
  user_full_name: `S${id}`,
  group_id: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
} as RunStudentResponse);

const group = (id: number, name: string, over: Partial<GroupResponse> = {}): GroupResponse => ({
  id,
  run_id: 10,
  name,
  student_count: 0,
  is_disabled: false,
  ...over,
} as GroupResponse);

function open(props: Record<string, unknown> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(RunRosterTab, {
    target,
    props: {
      runId: 10,
      runIsPublished: true,
      isAdmin: true,
      courseSlug: 'test',
      onNavigateToTab: vi.fn(),
      students: [student(1)],
      groups: [],
      groupsEnabled: false,
      rosterPrefilter: null,
      onPrefilterClear: vi.fn(),
      onRefetchRosterData: vi.fn().mockResolvedValue({ students: [], groups: [] }),
      onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
      onOpenImport: vi.fn(),
      ...props,
    },
  });
  flushSync();
}

const act = (action: string) => target.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
const toggle = () => act('toggle-add-student')!;
const email = () => target.querySelector('input[name="new-email"]') as HTMLInputElement | null;
const search = () => target.querySelector('input[name="roster-search"]') as HTMLInputElement;
const labelFor = (el: Element) => target.querySelector(`label[for="${el.id}"]`)?.textContent ?? null;
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('RunRosterTab — the add toggle and the add row (D25)', () => {
  it('+ opens the row under the toolbar with focus on the e-mail field; the toggle turns into × and closes it', async () => {
    open();
    expect(email()).toBeNull();
    expect(target.querySelector('form.add-row')).toBeNull();
    expect(toggle().getAttribute('data-glyph')).toBe('plus');
    expect(toggle().getAttribute('aria-label')).toBe('Add student');
    expect(toggle().getAttribute('title')).toBe('Add student');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    toggle().click();
    await settle();
    const field = email()!;
    expect(document.activeElement).toBe(field);
    const form = field.closest('form')!;
    expect(form.classList.contains('ro-add')).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(form.id);
    expect(toggle().getAttribute('data-glyph')).toBe('close');
    expect(toggle().getAttribute('aria-label')).toBe('Close add row');
    expect(toggle().getAttribute('title')).toBe('Close add row');
    // The row sits under the toolbar, before the table.
    expect(form.compareDocumentPosition(target.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    toggle().click();
    await settle();
    expect(email()).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('Esc in the row and Cancel close it; focus returns to the toggle', async () => {
    open();
    toggle().click();
    await settle();
    email()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(email()).toBeNull();
    expect(document.activeElement).toBe(toggle());

    toggle().click();
    await settle();
    expect(text(act('cancel-add-student'))).toBe('Cancel');
    act('cancel-add-student')!.click();
    await settle();
    expect(email()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('the row: hidden labels, the e-mail field, "Unassigned" and the enabled groups as "Name · n/10" (R38, R40)', async () => {
    open({
      groupsEnabled: true,
      groups: [group(1, 'Alpha', { student_count: 7 }), group(2, 'Beta', { is_disabled: true })],
    });
    toggle().click();
    await settle();
    const field = email()!;
    expect(labelFor(field)).toBe('Student email');
    expect(field.type).toBe('email');
    expect(field.maxLength).toBe(254);
    expect(field.placeholder).toBe('student@example.com');
    const sel = target.querySelector('form.ro-add select') as HTMLSelectElement;
    expect(labelFor(sel)).toBe('Group');
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Unassigned', 'Alpha · 7/10']);
    expect(sel.value).toBe('__unassigned');
  });

  it('groups off: the row has no group select', async () => {
    open({ groupsEnabled: false });
    toggle().click();
    await settle();
    expect(target.querySelector('form.ro-add select')).toBeNull();
  });

  it('Add is disabled with "Enter an email address" while the field is empty', async () => {
    open();
    toggle().click();
    await settle();
    const add = act('add-student')!;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('title')).toBe('Enter an email address');
    type(email()!, '   ');
    expect(add.disabled).toBe(true);
    type(email()!, 'x@y.z');
    expect(add.disabled).toBe(false);
    expect(add.getAttribute('title')).toBeNull();
  });

  it('a successful add empties the field, resets the group, keeps the row open, refetches and refocuses the e-mail field', async () => {
    fetchSpy.mockImplementation(() => jres(student(9, { user_email: 'new@x.com', group_id: 1 }), 201));
    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    open({ groupsEnabled: true, groups: [group(1, 'Alpha')], onRefetchRosterData: refetch });
    toggle().click();
    await settle();
    type(email()!, ' new@x.com ');
    const sel = target.querySelector('form.ro-add select') as HTMLSelectElement;
    sel.value = '1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    act('add-student')!.click();
    await settle();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/runs/10/students');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'new@x.com', group_id: 1 });
    expect(refetch).toHaveBeenCalledTimes(1);
    const field = email()!;
    expect(field.value).toBe('');
    expect((target.querySelector('form.ro-add select') as HTMLSelectElement).value).toBe('__unassigned');
    expect(document.activeElement).toBe(field);
    expect(target.querySelector('p.ro-err')).toBeNull();
  });

  it('a second submit during the add or its refetch sends nothing; Add is busy, not disabled; the field is read-only (R44)', async () => {
    let answer!: (r: Response) => void;
    fetchSpy.mockImplementation(() => new Promise<Response>((res) => { answer = res; }));
    let refetched!: (v: { students: RunStudentResponse[]; groups: GroupResponse[] }) => void;
    const refetch = vi.fn(() => new Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>((res) => { refetched = res; }));
    open({ onRefetchRosterData: refetch });
    toggle().click();
    await settle();
    type(email()!, 'new@x.com');
    const add = act('add-student')!;
    const form = email()!.form!;
    add.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(add.disabled).toBe(false);
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-busy')).toBe('true');
    expect(add.getAttribute('title')).toBe('Wait for the current change to finish');
    expect(email()!.readOnly).toBe(true);
    // A second click, and Enter in the field (implicit submission).
    add.click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    answer(resp(student(9), 201));
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(email()!.readOnly).toBe(true);
    type(email()!, 'other@x.com');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Esc does not close the row mid-add.
    email()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(email()).not.toBeNull();

    refetched({ students: [], groups: [] });
    await settle();
    expect(email()!.readOnly).toBe(false);
    expect(add.getAttribute('aria-busy')).toBeNull();
    expect(add.getAttribute('aria-disabled')).toBeNull();
  });

  it('the duplicate check and a server error show under the row; the field is invalid and described by the error', async () => {
    open({ students: [student(1, { user_email: 'a@x.com' })] });
    toggle().click();
    await settle();
    const field = email()!;
    type(field, 'A@X.COM');
    act('add-student')!.click();
    await settle();
    const dup = target.querySelector('form.ro-add + p.ro-err[role="alert"]')!;
    expect(dup.textContent).toBe('A@X.COM is already enrolled. Edit their group in the table.');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(dup.id);

    fetchSpy.mockImplementation(() => jres({ detail: 'Group capacity reached' }, 409));
    type(field, 'b@x.com');
    act('add-student')!.click();
    await settle();
    await settle();
    expect(text(target.querySelector('p.ro-err'))).toBe('Group capacity reached');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);

    // Closing the row clears the error; the typed e-mail stays for next time.
    toggle().click();
    await settle();
    expect(target.querySelector('p.ro-err')).toBeNull();
    toggle().click();
    await settle();
    expect(email()!.value).toBe('b@x.com');
    expect(email()!.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('RunRosterTab — the draft banner and the draft-disabled add controls', () => {
  it('admin: the info banner with "Publish on Overview"; the toggle, Import roster and both empty links are disabled, titled and described by it', () => {
    const onNavigateToTab = vi.fn();
    open({ runIsPublished: false, isAdmin: true, students: [], onNavigateToTab });
    const hint = target.querySelector('#roster-draft-publish-hint')!;
    expect(hint.classList.contains('ro-info')).toBe(true);
    expect(hint.getAttribute('role')).toBe('status');
    expect(text(hint)).toBe(
      'Publish this run before adding students. You can still move or remove students already on the roster. Publish on Overview',
    );
    for (const b of [toggle(), act('open-import')!, act('open-import-link')!, act('open-add-link')!]) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute('title')).toBe('Publish this run before adding students');
      expect(b.getAttribute('aria-describedby')).toBe('roster-draft-publish-hint');
    }
    expect(toggle().getAttribute('aria-label')).toBe('Add student');
    act('nav-overview-publish-roster')!.click();
    expect(onNavigateToTab).toHaveBeenCalledWith('overview');
  });

  it('teacher: the teacher text without a link, and the teacher title', () => {
    open({ runIsPublished: false, isAdmin: false, students: [] });
    const hint = target.querySelector('#roster-draft-publish-hint')!;
    expect(text(hint)).toBe(
      'This run is not published yet. A course admin publishes it; then students can be added. You can still move or remove students already on the roster.',
    );
    expect(act('nav-overview-publish-roster')).toBeNull();
    for (const b of [toggle(), act('open-import')!, act('open-import-link')!, act('open-add-link')!]) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute('title')).toBe('A course admin must publish this run first');
    }
  });

  it('published: no banner, and nothing points at it', () => {
    open({ runIsPublished: true });
    expect(target.querySelector('#roster-draft-publish-hint')).toBeNull();
    expect(toggle().hasAttribute('aria-describedby')).toBe(false);
    expect(act('open-import')!.hasAttribute('aria-describedby')).toBe(false);
    expect(act('open-import')!.hasAttribute('title')).toBe(false);
  });
});

describe('RunRosterTab — the toolbar', () => {
  it('the search field has its hidden label and placeholder; the chip reads "Unassigned (N)"; × clears the filter and focuses the search', async () => {
    const onPrefilterClear = vi.fn();
    open({
      rosterPrefilter: 'unassigned',
      onPrefilterClear,
      students: [student(1), student(2, { group_id: 9 }), student(3)],
    });
    expect(labelFor(search())).toBe('Search students');
    expect(search().placeholder).toBe('Search name or email…');
    expect(text(target.querySelector('.ro-chip'))).toBe('Unassigned (2)');
    const x = act('clear-prefilter')!;
    expect(x.getAttribute('aria-label')).toBe('Clear filter');
    expect(x.getAttribute('title')).toBe('Clear filter');
    expect(x.textContent!.trim()).toBe('');
    x.click();
    await settle();
    expect(onPrefilterClear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(search());
  });

  it('no chip without the filter', () => {
    open();
    expect(target.querySelector('.ro-chip')).toBeNull();
    expect(act('clear-prefilter')).toBeNull();
  });

  it('Import roster is a secondary button that opens the import', () => {
    const onOpenImport = vi.fn();
    open({ onOpenImport });
    const b = act('open-import')!;
    expect(b.textContent!.trim()).toBe('Import roster');
    expect(b.getAttribute('data-variant')).toBe('secondary');
    b.click();
    expect(onOpenImport).toHaveBeenCalledTimes(1);
  });
});

describe('RunRosterTab — the empty roster and the no-match lines', () => {
  it('"No students yet." with Import roster (focus moves to the toolbar button without scrolling) and Add student', async () => {
    const onOpenImport = vi.fn();
    open({ students: [], onOpenImport });
    expect(text(target.querySelector('.empty-state .title'))).toBe('No students yet.');
    expect(target.querySelector('table')).toBeNull();
    const link = act('open-import-link')!;
    expect(link.textContent!.trim()).toBe('Import roster');
    const toolbarImport = act('open-import')!;
    const focusSpy = vi.spyOn(toolbarImport, 'focus');
    link.click();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(onOpenImport).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(toolbarImport);
    focusSpy.mockRestore();

    expect(act('open-add-link')!.textContent!.trim()).toBe('Add student');
    act('open-add-link')!.click();
    await settle();
    expect(document.activeElement).toBe(email());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('"No students match …. Clear search." clears the search and focuses it', async () => {
    open({ students: [student(1)] });
    type(search(), 'zzz');
    expect(target.querySelector('table')).toBeNull();
    expect(text(target.querySelector('.ro-nomatch'))).toBe("No students match 'zzz'. Clear search.");
    act('clear-search-link')!.click();
    await settle();
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(search());
    expect(target.querySelectorAll('tr[data-row="student"]').length).toBe(1);
  });

  it('"No students are unassigned. Clear filter." clears the filter and focuses the search', async () => {
    const onPrefilterClear = vi.fn();
    open({ rosterPrefilter: 'unassigned', onPrefilterClear, students: [student(1, { group_id: 9 })] });
    expect(text(target.querySelector('.ro-nomatch'))).toBe('No students are unassigned. Clear filter.');
    act('clear-prefilter-link')!.click();
    await settle();
    expect(onPrefilterClear).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(search());
  });
});
```

- [ ] **Step 2: Update the existing roster tests**

In `RunRosterTab.svelte.test.ts`, `RunRosterTab.bulk-banner.svelte.test.ts`, `RunRosterTab.bulk-core.svelte.test.ts` and `RunRosterTab.optimistic.svelte.test.ts`, the `mountTab` helper's props gain `isAdmin` (one occurrence in each file):

```ts
      runIsPublished: true,
      courseSlug: 'test',
```

becomes

```ts
      runIsPublished: true,
      isAdmin: true,
      courseSlug: 'test',
```

In `RunRosterTab.draft-gate.svelte.test.ts` and `RunRosterTab.add-error.svelte.test.ts`, `BASE_PROPS` gains `isAdmin: true,` right after its `runIsPublished: …,` line.

In `RunRosterTab.svelte.test.ts`:
- In `'client-side dup check blocks POST and shows inline error'`, insert right after the first `await settle();`, before `const emailInput = …`:

```ts
    (target.querySelector('button[data-action="toggle-add-student"]') as HTMLButtonElement).click();
    await settle();
```

- Rename `'persistent add-student row stays in DOM across filter changes'` to `'an open add row stays in the DOM across filter changes'`, and replace its

```ts
    await settle();
    // Prefilter active: only Alice visible. Add row must still exist.
```

with

```ts
    await settle();
    (target.querySelector('button[data-action="toggle-add-student"]') as HTMLButtonElement).click();
    await settle();
    // Prefilter active: only Alice visible. The open add row must still exist.
```

In `RunRosterTab.add-error.svelte.test.ts`, replace the first two lines of `clickAdd`'s body

```ts
async function clickAdd(email: string) {
  const root = getTarget();
```

with

```ts
async function clickAdd(email: string) {
  const root = getTarget();
  // D25: the add row opens behind the toolbar's +.
  const toggle = root.querySelector('button[data-action="toggle-add-student"]') as HTMLButtonElement;
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    toggle.click();
    await settle();
  }
```

(`p.error[role="alert"]` stays the hook its `errorText()` reads.)

In `RunRosterTab.draft-gate.svelte.test.ts`:
- the import line becomes `import { describe, it, expect, afterEach, vi } from 'vitest';`
- replace the two tests `'add button disabled when draft'` and `'add button not draft-gated when published'` with

```ts
  it('the add toggle and Import roster are disabled on a draft and described by the banner', () => {
    mountTab({ runIsPublished: false });
    for (const action of ['toggle-add-student', 'open-import']) {
      const btn = target!.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('aria-describedby')).toBe('roster-draft-publish-hint');
    }
    expect(target!.querySelector('input[name="new-email"]')).toBeNull();
  });

  it('the add toggle is not draft-gated when published', () => {
    mountTab({ runIsPublished: true });
    const btn = target!.querySelector('button[data-action="toggle-add-student"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-describedby')).toBeNull();
  });
```

- in `'focuses the toolbar Import roster before opening the import'`, replace

```ts
    const link = target!.querySelector<HTMLButtonElement>('button[data-action="open-import-link"]')!;
    link.focus();
    link.click();
    flushSync();
    const toolbar = target!.querySelector<HTMLButtonElement>('button[data-action="open-import"]')!;
    expect(opened).toBe(1);
```

with (6b backlog `:71`: `preventScroll`)

```ts
    const link = target!.querySelector<HTMLButtonElement>('button[data-action="open-import-link"]')!;
    const toolbar = target!.querySelector<HTMLButtonElement>('button[data-action="open-import"]')!;
    const focusSpy = vi.spyOn(toolbar, 'focus');
    link.focus();
    link.click();
    flushSync();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(opened).toBe(1);
```

- [ ] **Step 3: Write the failing `IconButton` tests (R41)**

Append to `frontend/src/tests/IconButton.svelte.test.ts`, after its last `});`:

```ts
describe('IconButton — the link variant and describedby (6c R41)', () => {
  function renderHost(props: Record<string, unknown>) {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(IconButton, { target: host, props: props as ComponentProps<typeof IconButton> });
    flushSync();
    return host;
  }
  function reset() {
    if (component) unmount(component);
    component = null;
    host.remove();
  }

  it('href renders an <a> with the same classes, glyph, title and name', () => {
    const a = renderHost({ glyph: 'download', title: 'Download submission', href: '/api/files/3', download: true, size: 'sm' })
      .querySelector('a')!;
    expect(host.querySelector('button')).toBeNull();
    expect(a.getAttribute('href')).toBe('/api/files/3');
    expect(a.getAttribute('download')).toBe('');
    expect([...a.classList]).toEqual(expect.arrayContaining(['icon-btn', 'icon-link', 'sm']));
    expect(a.getAttribute('data-glyph')).toBe('download');
    expect(a.getAttribute('title')).toBe('Download submission');
    expect(a.getAttribute('aria-label')).toBe('Download submission');
    expect(a.querySelector('svg')).not.toBeNull();
  });

  it('a string download is forwarded; without download the attribute is absent', () => {
    let a = renderHost({ glyph: 'download', title: 'Get', href: '/f', download: 'answer.pdf' }).querySelector('a')!;
    expect(a.getAttribute('download')).toBe('answer.pdf');
    reset();
    a = renderHost({ glyph: 'download', title: 'Get', href: '/f' }).querySelector('a')!;
    expect(a.hasAttribute('download')).toBe(false);
  });

  it('a disabled control with href stays a disabled <button>', () => {
    const h = renderHost({ glyph: 'download', title: 'No file yet', href: '/f', disabled: true });
    expect(h.querySelector('a')).toBeNull();
    expect((h.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('describedby sets aria-describedby on the button and on the link; absent by default', () => {
    expect(render({ glyph: 'plus', title: 'Add', describedby: 'hint-1' }).getAttribute('aria-describedby')).toBe('hint-1');
    reset();
    const a = renderHost({ glyph: 'download', title: 'Get', href: '/f', describedby: 'hint-2' }).querySelector('a')!;
    expect(a.getAttribute('aria-describedby')).toBe('hint-2');
    reset();
    expect(render({ glyph: 'plus', title: 'Add' }).hasAttribute('aria-describedby')).toBe(false);
  });
});
```

- [ ] **Step 4: Write the failing R39 test and update the chip copy in the page tabs test**

In `frontend/src/tests/RunDetailPage.tabs.svelte.test.ts`, at every occurrence (four at `6402e1e`: `:148`, `:224` positive; `:186`, `:230` negative, wherever Task 2 left them):

```ts
    expect(target.textContent).toContain('Showing: Unassigned');
```

becomes

```ts
    expect(target.querySelector('button[data-action="clear-prefilter"]')).not.toBeNull();
    expect(target.textContent).toContain('Unassigned (1)');
```

and

```ts
    expect(target.textContent).not.toContain('Showing: Unassigned');
```

becomes

```ts
    expect(target.querySelector('button[data-action="clear-prefilter"]')).toBeNull();
```

Append at the end of the file:

```ts
describe('RunDetailPage — the import modal (R39)', () => {
  it('stays open across a tab change; closed then, it focuses the active tab', async () => {
    at('/teaching/algebra/runs/10?tab=roster');
    open();
    await settle();
    const importBtn = target.querySelector('button[data-action="open-import"]') as HTMLButtonElement;
    importBtn.focus();
    importBtn.click();
    await settle();
    expect(document.querySelector('textarea[aria-label="Rows to import"]')).not.toBeNull();

    at('/teaching/algebra/runs/10?tab=overview');
    await settle();
    expect(selected()).toBe('run-tab-overview');
    expect(importBtn.isConnected).toBe(false);
    expect(document.querySelector('textarea[aria-label="Rows to import"]')).not.toBeNull();

    (document.querySelector('[role="dialog"] button[data-action="cancel"]') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('textarea[aria-label="Rows to import"]')).toBeNull();
    expect(document.activeElement).toBe(tab('overview'));
  });

  it('closed on the tab that opened it, focus returns to Import roster', async () => {
    at('/teaching/algebra/runs/10?tab=roster');
    open();
    await settle();
    const importBtn = target.querySelector('button[data-action="open-import"]') as HTMLButtonElement;
    importBtn.focus();
    importBtn.click();
    await settle();
    (document.querySelector('[role="dialog"] button[data-action="cancel"]') as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(importBtn);
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunRosterTab.toolbar.svelte.test.ts src/tests/RunRosterTab.svelte.test.ts src/tests/RunRosterTab.draft-gate.svelte.test.ts src/tests/RunRosterTab.add-error.svelte.test.ts src/tests/IconButton.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts > $SDD/tmp/t3-red.log 2>&1; tail -5 $SDD/tmp/t3-red.log`
Expected: FAIL, 28 tests:
- the toolbar file: 16 of 17 fail (there is no `toggle-add-student`, `.ro-chip`, `.ro-info` or `open-add-link`); only `'no chip without the filter'` already holds;
- the dup and open-row tests and both new draft-gate tests fail on the missing toggle;
- the three `add-error` tests fail inside `clickAdd`;
- the empty-link test fails on `preventScroll`;
- 3 of the 4 IconButton tests fail (no `<a>`, no `aria-describedby`); `'a disabled control with href stays a disabled <button>'` already holds;
- in the tabs file, the chip assertions already hold (the old pill has `clear-prefilter` and "Unassigned (1)"); R39's first case fails at `expected null not to be null`, because the dialog unmounts with the Roster tab.

- [ ] **Step 6: Give `IconButton` `href`, `download` and `describedby` (R41)**

In `frontend/src/components/ui/IconButton.svelte`:

1. The header comment's first line

```ts
  // Shared icon-only button. A <button> shell carrying data-glyph, a required
```

becomes

```ts
  // Shared icon-only button. A <button> shell (an <a> with `href`) carrying data-glyph, a required
```

2. In `Props`, after `tabindex?: number;`, add:

```ts
    // Slice-6c R41: with `href` (and not `disabled`) the control is an <a> with
    // the same look, e.g. a download; `download: true` sets the bare attribute.
    href?: string;
    download?: boolean | string;
    // Slice-6c R41: the id of the text that explains the control (a disabled reason).
    describedby?: string;
```

3. In the destructuring, after `tabindex = undefined,`, add:

```ts
    href = undefined,
    download = undefined,
    describedby = undefined,
```

4. Replace the whole `<button …>…</button>` element (as Task 2 left it, with `class:blocked={ariaDisabled}` and `aria-disabled={ariaDisabled ? 'true' : undefined}`) with:

```svelte
{#snippet mark()}
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if glyph === 'pencil'}
      <path d="M3.2 12.8l.5-2.7 6.9-6.9 2.2 2.2-6.9 6.9z" /><line x1="9.6" y1="3.8" x2="12.2" y2="6.4" />
    {:else if glyph === 'duplicate'}
      <rect x="5.8" y="5.8" width="7.2" height="7.2" rx="1.4" /><path d="M10.2 3.6H4.4A1.4 1.4 0 0 0 3 5v5.8" />
    {:else if glyph === 'disable'}
      <circle cx="8" cy="8" r="5.4" /><line x1="4.6" y1="11.4" x2="11.4" y2="4.6" />
    {:else if glyph === 'enable'}
      <circle cx="8" cy="8" r="5.4" /><polyline points="5.5,8.2 7.3,10 10.6,5.9" />
    {:else if glyph === 'trash'}
      <line x1="3" y1="4.6" x2="13" y2="4.6" /><path d="M5.5 4.6V3.2h5v1.4" /><path d="M4.4 4.6l.7 8.2h5.8l.7-8.2" />
    {:else if glyph === 'plus'}
      <line x1="8" y1="3.4" x2="8" y2="12.6" /><line x1="3.4" y1="8" x2="12.6" y2="8" />
    {:else if glyph === 'up'}
      <line x1="8" y1="12.4" x2="8" y2="3.6" /><polyline points="4.4,7.2 8,3.6 11.6,7.2" />
    {:else if glyph === 'down'}
      <line x1="8" y1="3.6" x2="8" y2="12.4" /><polyline points="4.4,8.8 8,12.4 11.6,8.8" />
    {:else if glyph === 'chevron'}
      <polyline points="4.6,6.6 8,10 11.4,6.6" />
    {:else if glyph === 'chevron-right'}
      <polyline points="6.6,4.6 10,8 6.6,11.4" />
    {:else if glyph === 'close'}
      <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
    {:else if glyph === 'back'}
      <line x1="12.4" y1="8" x2="3.6" y2="8" /><polyline points="7.2,4.4 3.6,8 7.2,11.6" />
    {:else if glyph === 'check'}
      <!-- per-element 1.9: the check is the one heavier mark (visual-spec §4) -->
      <polyline points="3.4,8.4 6.6,11.6 12.6,4.8" stroke-width="1.9" />
    {:else if glyph === 'refresh'}
      <path d="M12.4 8a4.4 4.4 0 1 1-1.3-3.1" /><polyline points="11.4,2.4 11.4,5.1 8.7,5.1" />
    {:else if glyph === 'download'}
      <line x1="8" y1="2.8" x2="8" y2="9.6" /><polyline points="5,6.8 8,9.8 11,6.8" /><path d="M3 10.8v2h10v-2" />
    {/if}
  </svg>
{/snippet}

{#if href && !disabled}
  <a
    {href}
    download={download === true ? '' : download || undefined}
    class="icon-btn icon-link {size}"
    class:danger
    class:borderless
    class:round
    class:primary
    data-glyph={glyph}
    {title}
    {id}
    data-action={dataAction}
    {tabindex}
    aria-label={ariaLabel ?? title}
    aria-hidden={ariaHidden}
    aria-describedby={describedby}
    {onclick}
    {onmousedown}
  >
    {@render mark()}
  </a>
{:else}
  <button
    bind:this={element}
    {type}
    class="icon-btn {size}"
    class:danger
    class:borderless
    class:round
    class:primary
    class:blocked={ariaDisabled}
    data-glyph={glyph}
    {disabled}
    {title}
    {id}
    data-action={dataAction}
    {tabindex}
    aria-label={ariaLabel ?? title}
    aria-hidden={ariaHidden}
    aria-expanded={ariaExpanded}
    aria-controls={ariaControls}
    aria-disabled={ariaDisabled ? 'true' : undefined}
    aria-describedby={describedby}
    {onclick}
    {onmousedown}
  >
    {@render mark()}
  </button>
{/if}
```

5. In the style, right after the `.icon-btn { … }` rule, add:

```css
  .icon-link { text-decoration: none; }
```

- [ ] **Step 7: Rewrite `RunRosterTab.svelte` (banner, toolbar, add row, empty states)**

Replace the whole of `frontend/src/components/runs/RunRosterTab.svelte` with the following. Only the script's new and changed parts, the markup above the old result banner, the markup after the table, and the new styles are new. The bulk code, the old result banner, strip and table, and their styles are copied unchanged from today's file; Task 4 replaces them.

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet, SvelteMap } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import {
    addRunStudent,
    removeRunStudent,
    updateRunStudent,
    bulkMoveRunStudents,
    bulkDeleteRunStudents,
  } from '../../lib/runRoster';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { GroupResponse, RunStudentResponse, BulkRosterErrorCode } from '../../lib/types';
  import type { ActiveTab } from '../../lib/runTabs';

  type BulkOpKind = 'move' | 'delete';
  type BulkRowErrorMeta = { error_code?: BulkRosterErrorCode | null; detail?: string | null };
  type BulkOpResult = {
    kind: 'idle' | 'in-flight' | 'success' | 'partial' | 'cancelled';
    succeededIds: number[];
    chunkErrorRowIds: number[];
    cancelledIds: number[];
    lastOp: BulkOpKind;
    // Records the move target for the last op. Reserved by the spec's §10 T14
    // contract for future "Repeat move" / "Retry to same group" UX; not consumed
    // by T15's current banner code (T15 retries on a different group, since the
    // chunk-level cancellation usually implies the original target was bad).
    lastTargetGroupId?: number | null;
    error?: ApiError;
  };

  let {
    runId,
    runIsPublished,
    isAdmin,
    courseSlug: _courseSlug,
    onNavigateToTab,
    students,
    groups,
    groupsEnabled,
    rosterPrefilter,
    onPrefilterClear,
    onRefetchRosterData,
    onRefetchGroupsOnly,
    onOpenImport,
  }: {
    runId: number;
    runIsPublished: boolean;
    isAdmin: boolean;
    courseSlug: string;
    onNavigateToTab: (tab: ActiveTab) => void;
    students: RunStudentResponse[];
    groups: GroupResponse[];
    groupsEnabled: boolean;
    rosterPrefilter: 'unassigned' | null;
    onPrefilterClear: () => void;
    onRefetchRosterData: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onRefetchGroupsOnly: () => Promise<void>;
    onOpenImport: () => void;
  } = $props();

  const uid = $props.id();
  // The draft banner's id: a test hook, and the description of every add
  // control a draft disables.
  const DRAFT_HINT_ID = 'roster-draft-publish-hint';
  const draftTitle = $derived(
    isAdmin ? 'Publish this run before adding students' : 'A course admin must publish this run first',
  );
  const enabledGroups = $derived(groups.filter((g) => !g.is_disabled));
  const unassignedCount = $derived(students.filter((s) => s.group_id === null).length);

  // R38: every roster group select reads "Group A · 7/10" (a native option
  // cannot set the count in mono).
  function groupLabel(g: GroupResponse): string {
    return `${g.name} · ${g.student_count}/10`;
  }

  let searchEl = $state<HTMLInputElement>();
  let toggleEl = $state<HTMLButtonElement>();
  let emailEl = $state<HTMLInputElement>();

  // The empty-roster link unmounts once an import fills the roster, so the
  // modal could not return focus to it. Hand focus to the toolbar's Import
  // roster first: that is the opener the modal returns to after Done.
  let importBtnEl = $state<HTMLButtonElement>();
  function openImportFromLink() {
    importBtnEl?.focus({ preventScroll: true });
    onOpenImport();
  }

  let search = $state('');
  let newEmail = $state('');
  let newGroupId = $state<number | '__unassigned'>('__unassigned');
  let addError: string | null = $state(null);
  let pendingDelete = $state<number | null>(null);

  // D25: + opens the add row under the toolbar. `adding` spans the POST and
  // its refetch: Add stays focusable but inert, the field read-only (6b R20).
  let addOpen = $state(false);
  let adding = $state(false);
  const addShown = $derived(addOpen && runIsPublished);

  const pendingGroupId = new SvelteMap<number, number | null>();
  const selected = new SvelteSet<number>();

  // Bulk-op state (T14). Exposed by-reference to T15's banner via component scope.
  // `rowErrorBorders` flags per-row red border; `rowErrorMeta` drives the tooltip.
  // We reassign new instances (not `.clear()`) on each dispatch so Svelte's
  // reactivity tracker treats the change as a fresh reference, even though
  // SvelteSet/SvelteMap mutations would also notify.
  // `bulkOpResult` is mutated by `dispatchBulkOp` and consumed by T15's banner.
  // Already used here to disable the action-strip buttons during in-flight ops,
  // preventing the user from queueing a second bulk-op before the first refetch.
  let bulkOpResult = $state<BulkOpResult>({
    kind: 'idle',
    succeededIds: [],
    chunkErrorRowIds: [],
    cancelledIds: [],
    lastOp: 'move',
  });
  const bulkInFlight = $derived(bulkOpResult.kind === 'in-flight');
  let rowErrorBorders = $state(new SvelteSet<number>());
  let rowErrorMeta = $state(new SvelteMap<number, BulkRowErrorMeta>());
  let bulkDeleteConfirm = $state(false);
  // Bind-value for the bulk-move select. Resetting to '' inside `bulkMoveSelected`
  // lets the user pick the same group twice in a row (sticky-select UX defect
  // avoidance — see deviation #7 in the T14 brief).
  let bulkMoveSelectValue = $state('');
  // Same sticky-select defect avoidance for the T15 retry <select>s. Plan uses
  // a literal `value=""` attribute on the retry-move and retry-cancelled selects;
  // jsdom's `<select>` does not reset to "" after onchange just because the
  // attribute says so, so we bind to a state variable and reset to '' inside
  // the change handler — identical pattern to `bulkMoveSelectValue`.
  let retryMoveSelectValue = $state('');
  let retryCancelledSelectValue = $state('');

  // Banner auto-dismiss state. Re-set to false at the start of each new
  // success run (so a previously-dismissed banner reappears for a fresh op);
  // flipped to true 5s after `bulkOpResult.kind` lands on 'success'. The
  // $effect's cleanup clears the timer when kind transitions away from
  // 'success' before the 5s elapses, preventing a stale dismiss.
  let bannerDismissed = $state(false);

  $effect(() => {
    if (bulkOpResult.kind === 'success') {
      bannerDismissed = false;
      const t = setTimeout(() => (bannerDismissed = true), 5000);
      return () => clearTimeout(t);
    }
  });

  function summaryText(): string {
    const r = bulkOpResult;
    const total = r.succeededIds.length + r.chunkErrorRowIds.length + r.cancelledIds.length;
    const verb = r.lastOp === 'move' ? 'Moved' : 'Deleted';
    if (r.kind === 'success') return `${verb} ${r.succeededIds.length} of ${total} — 0 failed.`;
    if (r.kind === 'partial') return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed.`;
    if (r.kind === 'cancelled') {
      return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed, ${r.cancelledIds.length} cancelled (connection issue).`;
    }
    return '';
  }

  function retryMove(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    if (raw === '') return;
    const target: number | null = raw === '__unassigned' ? null : Number(raw);
    const ids = bulkOpResult.chunkErrorRowIds;
    retryMoveSelectValue = '';
    dispatchBulkOp('move', ids, target);
  }

  function retryDelete() {
    dispatchBulkOp('delete', bulkOpResult.chunkErrorRowIds);
  }

  function retryCancelledMove(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    if (raw === '') return;
    const target: number | null = raw === '__unassigned' ? null : Number(raw);
    const ids = [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds];
    retryCancelledSelectValue = '';
    dispatchBulkOp('move', ids, target);
  }

  function retryCancelledDelete() {
    // Only the chunk-level-cancelled bulk-DELETE branch uses this helper. The
    // move branch re-enters dispatchBulkOp via `retryCancelledMove` (a separate
    // helper so the select can reset its bind-value before dispatching).
    const ids = [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds];
    dispatchBulkOp('delete', ids);
  }

  function bulkErrorTooltip(meta: BulkRowErrorMeta | undefined): string {
    if (!meta) return '';
    const code = meta.error_code;
    if (code === 'not_in_run') return 'Student is no longer enrolled in this run.';
    if (code === 'capacity_reached') return 'Target group is full (10 students).';
    if (code === 'internal_error') return 'Server error — please retry.';
    // code is null/undefined: fall back to backend-supplied detail, else generic.
    return meta.detail ? meta.detail : 'Unknown error.';
  }

  async function dispatchBulkOp(
    kind: BulkOpKind,
    userIds: number[],
    groupId: number | null = null,
  ) {
    // Step 1: clear borders/meta for this op (new instances → guaranteed reactivity).
    rowErrorBorders = new SvelteSet<number>();
    rowErrorMeta = new SvelteMap<number, BulkRowErrorMeta>();
    bulkOpResult = {
      kind: 'in-flight',
      succeededIds: [],
      chunkErrorRowIds: [],
      cancelledIds: [],
      lastOp: kind,
      lastTargetGroupId: groupId,
    };

    const chunks: number[][] = [];
    for (let i = 0; i < userIds.length; i += 200) chunks.push(userIds.slice(i, i + 200));

    const succeededIds: number[] = [];
    const chunkErrorRowIds: number[] = [];
    let cancelledIds: number[] = [];
    let chunkLevelError: ApiError | undefined;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      try {
        const response = kind === 'move'
          ? await bulkMoveRunStudents(runId, chunk, groupId)
          : await bulkDeleteRunStudents(runId, chunk);
        for (const row of response.results) {
          if (row.status === 'ok') {
            succeededIds.push(row.user_id);
          } else {
            chunkErrorRowIds.push(row.user_id);
            rowErrorMeta.set(row.user_id, { error_code: row.error_code, detail: row.detail });
          }
        }
      } catch (e) {
        // Whole-chunk failure (network or non-207 like 400/409). All
        // unprocessed user_ids from this and later chunks become cancelled.
        const remainingFromThisChunk = chunk;
        const remainingFromLaterChunks = chunks.slice(ci + 1).flat();
        cancelledIds = [...remainingFromThisChunk, ...remainingFromLaterChunks];
        chunkLevelError = e instanceof ApiError ? e : new ApiError(500, 'Network error');
        break;
      }
    }

    // Refetch roster + groups so capacity badges and group_id reflect the server.
    await onRefetchRosterData();

    // Selection book-keeping: remove succeeded, keep errored/cancelled selected.
    for (const id of succeededIds) selected.delete(id);
    for (const id of chunkErrorRowIds) {
      selected.add(id);
      rowErrorBorders.add(id);
    }
    for (const id of cancelledIds) selected.add(id);

    let finalKind: BulkOpResult['kind'];
    if (chunkLevelError) finalKind = 'cancelled';
    else if (chunkErrorRowIds.length > 0) finalKind = 'partial';
    else finalKind = 'success';

    bulkOpResult = {
      kind: finalKind,
      succeededIds,
      chunkErrorRowIds,
      cancelledIds,
      lastOp: kind,
      lastTargetGroupId: groupId,
      error: chunkLevelError,
    };
  }

  function bulkMoveSelected(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    if (raw === '') return; // disabled placeholder; ignore.
    const target: number | null = raw === '__unassigned' ? null : Number(raw);
    // Reset the select immediately so the same group can be chosen again later.
    bulkMoveSelectValue = '';
    dispatchBulkOp('move', Array.from(selected), target);
  }

  function bulkDeleteSelected() {
    dispatchBulkOp('delete', Array.from(selected));
    bulkDeleteConfirm = false;
  }

  function selectValueFor(s: RunStudentResponse): number | '__unassigned' {
    const effective = pendingGroupId.has(s.user_id) ? pendingGroupId.get(s.user_id)! : s.group_id;
    return effective === null ? '__unassigned' : effective;
  }

  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (rosterPrefilter === 'unassigned' && s.group_id !== null) return false;
      if (!q) return true;
      const email = s.user_email.toLowerCase();
      const name = (s.user_full_name ?? '').toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  });

  const selectedVisibleCount = $derived(visible.filter((s) => selected.has(s.user_id)).length);
  const headerChecked = $derived(visible.length > 0 && selectedVisibleCount === visible.length);
  const headerIndeterminate = $derived(selectedVisibleCount > 0 && selectedVisibleCount < visible.length);

  function onHeaderClick(event: Event) {
    event.preventDefault();
    if (headerChecked) {
      for (const s of visible) selected.delete(s.user_id);
    } else {
      for (const s of visible) selected.add(s.user_id);
    }
  }

  function onSearchInput(event: Event) {
    search = (event.currentTarget as HTMLInputElement).value;
    if (search && rosterPrefilter !== null) onPrefilterClear();
  }

  // §Focus: chip ×, Clear filter and Clear search → the search field.
  async function clearPrefilter() {
    onPrefilterClear();
    await tick();
    searchEl?.focus();
  }

  async function clearSearch() {
    search = '';
    await tick();
    searchEl?.focus();
  }

  async function openAdd() {
    if (!runIsPublished) return;
    addOpen = true;
    await tick();
    emailEl?.focus();
  }

  // Closing keeps the typed e-mail; it is ignored while an add runs.
  async function closeAdd() {
    if (adding) return;
    addOpen = false;
    addError = null;
    await tick();
    toggleEl?.focus();
  }

  function toggleAdd() {
    if (addShown) void closeAdd();
    else void openAdd();
  }

  function onAddKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void closeAdd();
  }

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    if (adding || !runIsPublished) return;
    addError = null;
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const dup = students.some((s) => s.user_email.toLowerCase() === email);
    if (dup) {
      addError = `${newEmail} is already enrolled. Edit their group in the table.`;
      return;
    }
    adding = true;
    try {
      const groupId: number | null = newGroupId === '__unassigned' ? null : newGroupId;
      await addRunStudent(runId, newEmail.trim(), groupId);
      newEmail = '';
      newGroupId = '__unassigned';
      await onRefetchRosterData();
    } catch (e) {
      // Surface every ApiError (4xx/5xx) inline via the backend-supplied
      // displayMessage — covers run_unpublished, student_already_active_in_course,
      // capacity_reached, group_disabled, and any future error_code without
      // per-branch wiring. Non-ApiError exceptions (e.g., TypeError from a
      // fetch network failure) are silently dropped, matching confirmDelete
      // and onGroupChange below.
      if (e instanceof ApiError) {
        addError = e.displayMessage;
      }
    } finally {
      adding = false;
    }
    // Success: ready for the next student. Failure: the field the error is about.
    await tick();
    emailEl?.focus();
  }

  async function confirmDelete(userId: number) {
    try {
      await removeRunStudent(runId, userId);
      pendingDelete = null;
      await onRefetchRosterData();
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
    }
  }

  async function onGroupChange(s: RunStudentResponse, raw: string) {
    const targetGroupId: number | null = raw === '__unassigned' ? null : Number(raw);
    pendingGroupId.set(s.user_id, targetGroupId);
    try {
      const updated = await updateRunStudent(runId, s.user_id, targetGroupId);
      // Mutate the local student row in place. Spec §4.4: inline-edit success
      // branch refetches groups only (for capacity badges), NOT students; this
      // keeps the row's group_id in sync until the next full roster refetch.
      s.group_id = updated.group_id;
      pendingGroupId.delete(s.user_id);
      await onRefetchGroupsOnly();
    } catch (e) {
      // Delete from pendingGroupId on EVERY error path (incl. network failures),
      // otherwise a TypeError thrown by fetch would leave the row permanently disabled.
      pendingGroupId.delete(s.user_id);
      if (e instanceof ApiError) {
        // Per-errorCode branches kept for future divergence (e.g. distinct toast
        // kinds or copy). For now all 409 paths display the backend-supplied
        // detail string via ApiError.displayMessage.
        if (e.status === 409 && e.errorCode === 'capacity_reached') {
          pushToast(e.displayMessage, 'error');
        } else if (e.status === 409 && e.errorCode === 'group_disabled') {
          pushToast(e.displayMessage, 'error');
        } else {
          pushToast(e.displayMessage, 'error');
        }
      }
    }
  }

  // prunePendingGroups: fires on every reassignment of the parent's `students`
  // prop. Removes pending-overlay entries for user_ids no longer in the roster.
  // Covers all 5 refetch paths from spec §4.4 without parent-side setter wrapping.
  $effect(() => {
    // Dependency declaration trick: reading `students` here registers the
    // effect's dependency on the array reference for fine-grained reactivity.
    void students;
    const liveIds = new Set(students.map((s) => s.user_id));
    for (const uid of Array.from(pendingGroupId.keys())) {
      if (!liveIds.has(uid)) pendingGroupId.delete(uid);
    }
  });
</script>

<section class="ro-tab">
  {#if !runIsPublished}
    <div id={DRAFT_HINT_ID} class="ro-info" role="status" data-action="draft-publish-hint">
      {#if isAdmin}
        Publish this run before adding students. You can still move or remove students already on the roster.
        <button
          type="button"
          class="ro-link"
          data-action="nav-overview-publish-roster"
          onclick={() => onNavigateToTab('overview')}
        >Publish on Overview</button>
      {:else}
        This run is not published yet. A course admin publishes it; then students can be added. You can still move or remove students already on the roster.
      {/if}
    </div>
  {/if}

  <div class="ro-toolbar">
    <label class="vh" for="{uid}-search">Search students</label>
    <input
      id="{uid}-search"
      class="ro-input ro-search"
      name="roster-search"
      placeholder="Search name or email…"
      autocomplete="off"
      value={search}
      oninput={onSearchInput}
      bind:this={searchEl}
    />
    {#if rosterPrefilter === 'unassigned'}
      <span class="ro-chip">
        Unassigned ({unassignedCount})
        <button
          type="button"
          class="ro-chip-x"
          data-action="clear-prefilter"
          aria-label="Clear filter"
          title="Clear filter"
          onclick={clearPrefilter}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" /></svg>
        </button>
      </span>
    {/if}
    <div class="ro-tools-right">
      <Button
        variant="secondary"
        data-action="open-import"
        disabled={!runIsPublished}
        title={runIsPublished ? undefined : draftTitle}
        aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
        bind:element={importBtnEl}
        onclick={onOpenImport}
      >Import roster</Button>
      <IconButton
        glyph={addShown ? 'close' : 'plus'}
        primary={!addShown}
        size="sm"
        title={!runIsPublished ? draftTitle : addShown ? 'Close add row' : 'Add student'}
        aria-label={addShown ? 'Close add row' : 'Add student'}
        disabled={!runIsPublished}
        describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
        aria-expanded={addShown}
        aria-controls={addShown ? `${uid}-add` : undefined}
        data-action="toggle-add-student"
        bind:element={toggleEl}
        onclick={toggleAdd}
      />
    </div>
  </div>

  {#if addShown}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form id="{uid}-add" class="ro-add" onsubmit={submitAdd} onkeydown={onAddKeydown}>
      <label class="vh" for="{uid}-email">Student email</label>
      <input
        id="{uid}-email"
        class="ro-input ro-email"
        name="new-email"
        type="email"
        maxlength="254"
        placeholder="student@example.com"
        autocomplete="off"
        readonly={adding}
        aria-invalid={addError ? 'true' : undefined}
        aria-describedby={addError ? `${uid}-add-err` : undefined}
        bind:value={newEmail}
        bind:this={emailEl}
      />
      {#if groupsEnabled}
        <label class="vh" for="{uid}-group">Group</label>
        <select id="{uid}-group" class="ro-select" bind:value={newGroupId}>
          <option value="__unassigned">Unassigned</option>
          {#each enabledGroups as g (g.id)}
            <option value={g.id}>{groupLabel(g)}</option>
          {/each}
        </select>
      {/if}
      <Button
        type="submit"
        variant="primary"
        data-action="add-student"
        loading={adding}
        aria-disabled={adding}
        disabled={!adding && !newEmail.trim()}
        title={adding ? 'Wait for the current change to finish' : newEmail.trim() ? undefined : 'Enter an email address'}
      >Add</Button>
      <Button variant="secondary" data-action="cancel-add-student" onclick={closeAdd}>Cancel</Button>
    </form>
    {#if addError}<p id="{uid}-add-err" class="ro-err error" role="alert">{addError}</p>{/if}
  {/if}

  {#if bulkOpResult.kind !== 'idle' && !(bulkOpResult.kind === 'success' && bannerDismissed)}
    <div class="bulk-banner bulk-banner-{bulkOpResult.kind}">
      <span>{summaryText()}</span>

      {#if bulkOpResult.kind === 'partial' && bulkOpResult.lastOp === 'move'}
        <select
          data-action="retry-move-select"
          bind:value={retryMoveSelectValue}
          onchange={retryMove}
          disabled={bulkInFlight}
        >
          <option value="" disabled>Retry {bulkOpResult.chunkErrorRowIds.length} → group…</option>
          <option value="__unassigned">Unassign</option>
          {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
            <option value={g.id}>{g.name} ({g.student_count}/10)</option>
          {/each}
        </select>
      {:else if bulkOpResult.kind === 'partial' && bulkOpResult.lastOp === 'delete'}
        <button data-action="retry-delete" onclick={retryDelete} disabled={bulkInFlight}>
          Retry {bulkOpResult.chunkErrorRowIds.length} delete
        </button>
      {:else if bulkOpResult.kind === 'cancelled'}
        {#if bulkOpResult.lastOp === 'move'}
          <select
            data-action="retry-cancelled"
            bind:value={retryCancelledSelectValue}
            onchange={retryCancelledMove}
            disabled={bulkInFlight}
          >
            <option value="" disabled>Retry cancelled → group…</option>
            <option value="__unassigned">Unassign</option>
            {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
              <option value={g.id}>{g.name} ({g.student_count}/10)</option>
            {/each}
          </select>
        {:else}
          <button data-action="retry-cancelled" onclick={retryCancelledDelete} disabled={bulkInFlight}>
            Retry cancelled
          </button>
        {/if}
      {/if}

      {#if bulkOpResult.kind !== 'in-flight'}
        <button
          data-action="dismiss-banner"
          onclick={() => (bulkOpResult = { ...bulkOpResult, kind: 'idle' })}
        >
          Dismiss
        </button>
      {/if}
    </div>
  {/if}

  {#if selected.size > 0}
    <div data-strip="bulk" class="bulk-strip">
      <span>
        {selected.size} selected{visible.length < students.length
          ? ` (${visible.filter((s) => selected.has(s.user_id)).length} visible)`
          : ''}
      </span>
      {#if groupsEnabled}
        <select
          data-action="bulk-move-select"
          bind:value={bulkMoveSelectValue}
          onchange={bulkMoveSelected}
          disabled={bulkInFlight}
        >
          <option value="" disabled>Move to group…</option>
          <option value="__unassigned">Unassign</option>
          {#each groups.filter((g) => !g.is_disabled) as g (g.id)}
            <option value={g.id}>{g.name} ({g.student_count}/10)</option>
          {/each}
        </select>
      {/if}
      {#if bulkDeleteConfirm}
        <InlineConfirm
          confirmLabel={`Confirm Delete — ${selected.size} students will be removed.`}
          confirmDataAction="confirm-bulk-delete"
          onConfirm={bulkDeleteSelected}
          onCancel={() => (bulkDeleteConfirm = false)}
        />
      {:else}
        <button
          data-action="bulk-delete"
          disabled={bulkInFlight}
          onclick={() => (bulkDeleteConfirm = true)}
        >
          Delete selected
        </button>
      {/if}
      <button data-action="clear-selection" onclick={() => selected.clear()}>× clear</button>
    </div>
  {/if}

  {#if visible.length > 0}
    <table>
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              data-header-checkbox
              checked={headerChecked}
              onclick={onHeaderClick}
              bind:indeterminate={() => headerIndeterminate, () => {}}
            />
          </th>
          <th>Email</th>
          <th>Full name</th>
          <th>Group</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as s (s.user_id)}
          <tr
            data-row="student"
            data-user-id={s.user_id}
            class:row-error={rowErrorBorders.has(s.user_id)}
            title={bulkErrorTooltip(rowErrorMeta.get(s.user_id))}
          >
            <td>
              <input
                type="checkbox"
                data-row-checkbox
                checked={selected.has(s.user_id)}
                onchange={(e) => {
                  if ((e.currentTarget as HTMLInputElement).checked) selected.add(s.user_id);
                  else selected.delete(s.user_id);
                }}
              />
            </td>
            <td>{s.user_email}</td>
            <td>{s.user_full_name || '—'}</td>
            <td>
              {#if groupsEnabled}
                <select
                  value={selectValueFor(s)}
                  disabled={pendingGroupId.has(s.user_id)}
                  onchange={(e) => onGroupChange(s, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="__unassigned">Unassigned</option>
                  {#each groups as g (g.id)}
                    <option value={g.id}>{g.name} ({g.student_count}/10){g.is_disabled ? ' (disabled)' : ''}</option>
                  {/each}
                </select>
              {:else}
                —
              {/if}
            </td>
            <td>
              {#if pendingDelete === s.user_id}
                <InlineConfirm
                  confirmLabel="Confirm Delete"
                  confirmDataAction="confirm-delete-student"
                  onConfirm={() => confirmDelete(s.user_id)}
                  onCancel={() => (pendingDelete = null)}
                />
              {:else}
                <button data-action="delete-student" onclick={() => (pendingDelete = s.user_id)}>Delete</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if students.length === 0}
    <EmptyState title="No students yet.">
      {#snippet action()}
        <span class="ro-empty-links">
          <button
            type="button"
            class="ro-link"
            data-action="open-import-link"
            disabled={!runIsPublished}
            title={runIsPublished ? undefined : draftTitle}
            aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
            onclick={openImportFromLink}
          >Import roster</button>
          <button
            type="button"
            class="ro-link"
            data-action="open-add-link"
            disabled={!runIsPublished}
            title={runIsPublished ? undefined : draftTitle}
            aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
            onclick={openAdd}
          >Add student</button>
        </span>
      {/snippet}
    </EmptyState>
  {:else if visible.length === 0}
    <p class="ro-nomatch">
      {#if rosterPrefilter === 'unassigned'}
        No students are unassigned.
        <button type="button" class="ro-link" data-action="clear-prefilter-link" onclick={clearPrefilter}>Clear filter</button>.
      {:else}
        No students match '{search}'.
        <button type="button" class="ro-link" data-action="clear-search-link" onclick={clearSearch}>Clear search</button>.
      {/if}
    </p>
  {/if}
</section>

<style>
  .ro-tab { display: flex; flex-direction: column; gap: 10px; }

  /* The 6a info precondition banner. */
  .ro-info {
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: 0 var(--radius) var(--radius) 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .ro-link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--primary);
    text-decoration: underline;
    cursor: pointer;
  }
  .ro-link:disabled { color: var(--faint); text-decoration: none; cursor: not-allowed; }

  .ro-toolbar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .ro-tools-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  /* R40: native fields in the 6a field style (RunTeachersTab's .t-input). */
  .ro-input {
    box-sizing: border-box;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
  }
  .ro-input[aria-invalid='true'] { border-color: var(--danger); }
  .ro-search { width: 230px; max-width: 100%; }
  .ro-email { flex: 1 1 240px; min-width: 0; max-width: 360px; }
  .ro-select {
    box-sizing: border-box;
    height: 26px;
    max-width: 100%;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
  }
  .ro-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 4px 0 10px;
    border-radius: 13px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-3);
  }
  .ro-chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .ro-chip-x:hover { background: var(--border); color: var(--text); }

  /* D25: the 6a add-row look. */
  .ro-add {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .ro-err { margin: 0; font-size: 12px; color: var(--danger); }
  .ro-nomatch { margin: 0; font-size: 13px; color: var(--muted); }
  .ro-empty-links { display: inline-flex; gap: 16px; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border, #eee); text-align: left; }
  thead th { position: sticky; top: 0; background: var(--surface, #fff); }
  .bulk-strip {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    background: var(--surface-muted, #f5f5f5);
    border-radius: 4px;
  }
  .bulk-banner {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--surface-muted, #f5f5f5);
  }
  .bulk-banner-success { background: var(--success-soft, #e6f6ea); }
  .bulk-banner-partial { background: var(--warn-soft, #fff4e0); }
  .bulk-banner-cancelled { background: var(--danger-soft, #fdecea); }
  .row-error {
    box-shadow: inset 4px 0 0 0 var(--danger, #c00);
  }
</style>
```

- [ ] **Step 8: The page — `isAdmin` to the Roster, the import modal in the loaded branch (R39)**

In `frontend/src/pages/runs/RunDetailPage.svelte`:

1. In the `RunRosterTab` call, after `runIsPublished={run.is_published}`, add `{isAdmin}`:

```svelte
          runIsPublished={run.is_published}
          {isAdmin}
          {courseSlug}
```

2. Delete the `{#if showImportModal}` block that follows the `RunRosterTab` call inside the roster branch:

```svelte
        {#if showImportModal}
          <RosterImportModal
            runId={runIdInt!}
            existingRoster={students}
            existingGroups={groups}
            onRefetchBeforeSubmit={refetchRosterData}
            onClose={() => (showImportModal = false)}
          />
        {/if}
```

3. Render it after the `.run-panel` div, still inside the loaded `{:else}` branch. The page's end

```svelte
        <RunTeachersTab runId={runIdInt!} {teachers} onRefetch={refetchTeachers} course={course!} />
      {/if}
    </div>
  {/if}
```

becomes

```svelte
        <RunTeachersTab runId={runIdInt!} {teachers} onRefetch={refetchTeachers} course={course!} />
      {/if}
    </div>
    {#if showImportModal}
      <RosterImportModal
        runId={runIdInt!}
        existingRoster={students}
        existingGroups={groups}
        onRefetchBeforeSubmit={refetchRosterData}
        onClose={closeImport}
      />
    {/if}
  {/if}
```

4. After `refetchGroupsAndStudents`, add:

```ts
  // R39: the import modal outlives a tab change. Closed while another tab is
  // open, its opener is gone and focus would fall to <body>: take the tab.
  async function closeImport(): Promise<void> {
    showImportModal = false;
    await tick();
    const active = document.activeElement;
    if (!active || active === document.body) tabEls[activeTab]?.focus();
  }
```

The runId-change effect (`showImportModal = false`, `:202-208` at `6402e1e`) stays as it is.

- [ ] **Step 9: Run them to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunRosterTab.toolbar.svelte.test.ts src/tests/RunRosterTab.svelte.test.ts src/tests/RunRosterTab.draft-gate.svelte.test.ts src/tests/RunRosterTab.add-error.svelte.test.ts src/tests/RunRosterTab.bulk-banner.svelte.test.ts src/tests/RunRosterTab.bulk-core.svelte.test.ts src/tests/RunRosterTab.optimistic.svelte.test.ts src/tests/IconButton.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts > $SDD/tmp/t3-green.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/t3-green.log`
Expected: PASS, `exit 0`. The bulk files still pass unchanged, apart from `isAdmin`: the old strip, banner and table keep their hooks and texts until Task 4.

- [ ] **Step 10: Gate rows**

In `frontend/scripts/visual-refresh-gate.sh`, at the end of section (al), just before `# The summary line is the parent process's (see the re-exec at the top).`, insert:

```zsh
# R41: the IconButton link variant keeps the boxed look, without an underline.
uniq1 icon-btn
if [[ -n $REPLY ]]; then
  N=IconButton; H=$REPLY
  d '\.icon-link' '' 'text-decoration:none'
fi
# RunRosterTab (10b): the toolbar, the add row, the draft banner (Task 3);
# the strip, the result banner and the table (Task 4).
own ro-toolbar RunRosterTab.svelte
uniq1 ro-toolbar
if [[ -n $REPLY ]]; then
  N=RunRosterTab; H=$REPLY
  d '\.ro-toolbar' '' 'display:flex' 'align-items:center' 'gap:9px' 'flex-wrap:wrap'
  d '\.ro-tools-right' '' 'margin-left:auto' 'gap:8px'
  d '\.ro-search' '' 'width:230px'
  d '\.ro-input' '' 'height:var\(--control-h-sm\)' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'font-size:var\(--control-font\)'
  d '\.ro-chip' '' 'height:26px' 'border-radius:13px' 'background:var\(--surface-2\)' 'font-size:12px' 'color:var\(--text-3\)'
  d '\.ro-chip-x' '' 'width:18px' 'height:18px' 'border-radius:50%'
  # The draft banner is the 6a info precondition banner.
  d '\.ro-info' '' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)'
  d '\.ro-add' '' 'display:flex' 'background:var\(--surface-2\)' 'border:1px solid var\(--border\)'
  d '\.ro-err' '' 'font-size:12px' 'color:var\(--danger\)'
  d '\.ro-link' '' 'color:var\(--primary\)' 'text-decoration:underline'
  none "RunRosterTab has no add-row form under the table (D25)" "\.add-row\.${H}"
fi
if grep -q 'class="add-row"' src/components/runs/RunRosterTab.svelte; then
  echo "FAIL  RunRosterTab still has the add form under the table (D25)"; fail=1
else
  echo "PASS  RunRosterTab has no add form under the table (D25)"
fi
```

`FILES_6C` stays as Task 2 left it (`src/components/runs/RunOverviewTab.svelte` only). `RunRosterTab` joins it in Task 4 (P32).

Set `EXPECTED_CHECKS=1886` at `:90`. That is 1851 + 35:
- IconButton: `uniq1` 1, `.icon-link` 1;
- RunRosterTab: `own` 1, `uniq1` 1;
- 29 declarations: `.ro-toolbar` 4, `.ro-tools-right` 2, `.ro-search` 1, `.ro-input` 5, `.ro-chip` 5, `.ro-chip-x` 3, `.ro-info` 2, `.ro-add` 3, `.ro-err` 2, `.ro-link` 2;
- the D25 `none` 1 and the source check 1.

- [ ] **Step 11: Run the full checks**

Run the frontend tests, svelte-check and the gate exactly as Global Constraints › Commands give them.
Expected:
- vitest: `exit 0` and `0` Errors/Unhandled lines;
- svelte-check: 0 errors and 13 warnings (the `<form onkeydown>` carries its ignore comment, P33);
- the gate: `VISUAL-REFRESH GATE: ALL PASS (1886 checks)`.

- [ ] **Step 12: Screenshots for the user**

Signed in as `dev@mathion.test`, open `http://localhost:5174/teaching/demo-course/runs/8?tab=roster`. Save every shot as an absolute path in the 6c sdd dir (`t3-*.png`). Every write is mocked or stopped:
1. **The toolbar.** 1280×800 and 1000×800.
2. **The add row.** Click + (type nothing yet), then 1280×800: the row is open with focus in the e-mail field.
3. **The duplicate error, with no request.** First read an e-mail that is on the roster from the table. Add a safety net: `agent-browser network route "**/api/runs/8/students" --abort`. Type that e-mail into the add row and click Add, then 1280×800: the error line under the row, the red field edge. The client duplicate check stops before any POST, and the route would abort one anyway. Then `agent-browser network unroute "**/api/runs/8/students"`.
4. **The chip.** If the Overview shows "N unassigned — open Roster", click it, then 1280×800: the "Unassigned (N)" chip. Otherwise skip, and say so in the overlay.
5. **The empty state.** `agent-browser network route "**/api/runs/8/students" --body '[]'` (it only answers the roster GET). Reload, then 1280×800. Then unroute it.
6. **A draft, admin view.** Read the real `GET /api/runs/8` body (`agent-browser network requests --filter /api/runs/8`, then `agent-browser network request <id>`). Route `**/api/runs/8` with that body and `"is_published": false`, and reload `?tab=roster`. Then 1280×800: the info banner with "Publish on Overview", and + and Import roster disabled. Then unroute it.

The teacher wording is covered by the tests; no teacher login is needed.

Build the overlay (the 10b reference image beside each shot; copy the shape of `.superpowers/sdd/2026-10-10-visual-refresh-slice6a-teacher-restyle/mk-t11.py`; images as base64), open it with `--size-percent 60`, and wait for the user's OK. The strip, the result banner and the table still have the old look until Task 4; the OK covers the banner, the toolbar, the add row and the empty state. Finally, check that no route is left (`agent-browser network unroute`).

- [ ] **Step 13: Review lanes**

Run the Opus (high) and Fable lanes on the uncommitted diff (`git diff`, plus the new test file). Give them the spec (§Roster, §Focus › Roster, §Testing › Roster, R39–R41, R44), this task's text and the Global Constraints. Fix every Critical and Important finding; re-run both lanes after every fix until both are clean. Minors go to `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md` under "## Task 3 — Roster toolbar and add row".

- [ ] **Step 14: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunRosterTab.svelte frontend/src/components/ui/IconButton.svelte \
  frontend/src/pages/runs/RunDetailPage.svelte frontend/scripts/visual-refresh-gate.sh \
  docs/backlog/slice6c-teacher-overview-roster-panel-debt.md \
  frontend/src/tests/RunRosterTab.toolbar.svelte.test.ts frontend/src/tests/RunRosterTab.svelte.test.ts \
  frontend/src/tests/RunRosterTab.draft-gate.svelte.test.ts frontend/src/tests/RunRosterTab.add-error.svelte.test.ts \
  frontend/src/tests/RunRosterTab.bulk-banner.svelte.test.ts frontend/src/tests/RunRosterTab.bulk-core.svelte.test.ts \
  frontend/src/tests/RunRosterTab.optimistic.svelte.test.ts frontend/src/tests/IconButton.svelte.test.ts \
  frontend/src/tests/RunDetailPage.tabs.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6c): Roster toolbar, add row and empty states (10b); IconButton href/download/describedby; the import modal outlives a tab change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Then the ledger line in `$SDD/progress.md`, memory, and wait for "go".

---

### Task 4: Roster — bulk strip, result banner, table and confirms

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte` (whole file, as Task 3 left it):
  - the script: `BulkOpResult` gains `total`; the bulk and retry handlers follow R44 (P36); the row remove gets the focus chain; new refs; the select bind-values and their comments go;
  - the markup: the old result banner, strip and table (Task 3's copies of `6402e1e` `:428-592`);
  - the style: the old `table`, `th, td`, `thead th`, `.bulk-strip`, `.bulk-banner*` and `.row-error` rules.
- Modify: `frontend/scripts/visual-refresh-gate.sh`: `FILES_6C` in section (al); rows inside Task 3's `RunRosterTab` block; `EXPECTED_CHECKS` at `:90`.
- Create: `frontend/src/tests/RunRosterTab.table.svelte.test.ts`.
- Test (unchanged; must stay green): `RunRosterTab.svelte.test.ts`, `RunRosterTab.bulk-banner.svelte.test.ts`, `RunRosterTab.bulk-core.svelte.test.ts`, `RunRosterTab.optimistic.svelte.test.ts`. They keep `bulk-move-select`, `retry-move-select`, `retry-cancelled`, `tr[data-user-id]`, `tr.row-error`, the row `title`, `tbody select`, "1 selected", "Moved 3 of 3" and "Moved 2 of 3 … 1 failed".

**Interfaces:**
- Consumes:
  - Task 3: `isAdmin`, `uid`, `DRAFT_HINT_ID`, `draftTitle`, `enabledGroups`, `groupLabel`, the refs `searchEl` / `toggleEl` / `emailEl` / `importBtnEl`, `.ro-select`, `.vh`, the gate's `RunRosterTab` block.
  - Task 2: `IconButton` `'aria-disabled'`.
  - `lib/focusFirst.focusFirst(candidates)`, which skips disconnected, disabled and `aria-disabled` elements.
  - `ui/InlineConfirm` (`row`, `takeFocus`, `warning`, `confirmLabel`, `confirmDataAction`; Cancel is `button.cancel`, the group is `[role="group"]`, the question is `.warning`).
  - `stores/toasts.svelte` `toasts.list`, read by the tests.
- Produces:
  - The finished 10b `RunRosterTab`.
  - Its hooks:
    - `[data-strip="bulk"].ro-strip` with `.ro-count`;
    - `.ro-banner` (`role="status"`) with the tone classes `ro-banner-info` / `-ok` / `-warn` and `.ro-banner-text`;
    - `.ro-retry` on the retry controls;
    - `.ro-table-wrap > table.ro-table`;
    - `tr.ro-selected`, `td.ro-mark` and the hidden `.ro-email-cell .vh` "Failed: …" on a marked row (`tr.row-error` stays);
    - `tr.ro-confirm-row`.
  - `BulkOpResult.total`.
  - `FILES_6C` = `RunOverviewTab`, `RunRosterTab`; the panel tasks append theirs.

- [ ] **Step 1: Write the failing table tests**

Create `frontend/src/tests/RunRosterTab.table.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import { toasts } from '../stores/toasts.svelte';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

// Slice 6c Task 4 (10b): the bulk strip and its confirm, the result banner,
// the table, marked rows and the row confirm. R38, R44, §Focus › Roster,
// Review Focus 4.
const fetchSpy = vi.fn();
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
// What the next roster refetch returns; null keeps the students as they are.
let server: RunStudentResponse[] | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  toasts.list.length = 0;
  server = null;
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  vi.useRealTimers();
});

function resp(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const jres = (body: unknown, status = 200) => Promise.resolve(resp(body, status));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}
async function settleAll() {
  for (let i = 0; i < 4; i++) await settle();
}

const student = (id: number, over: Partial<RunStudentResponse> = {}): RunStudentResponse => ({
  id,
  run_id: 10,
  user_id: id,
  user_email: `s${id}@x.com`,
  user_full_name: `S${id}`,
  group_id: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
} as RunStudentResponse);

const group = (id: number, name: string, over: Partial<GroupResponse> = {}): GroupResponse => ({
  id,
  run_id: 10,
  name,
  student_count: 0,
  is_disabled: false,
  ...over,
} as GroupResponse);

const ALPHA = group(99, 'Alpha', { student_count: 7 });
const BETA_OFF = group(100, 'Beta', { student_count: 3, is_disabled: true });

// One result row per id: `ok` succeed, `failed` = [id, error_code, detail].
function result(ok: number[], failed: Array<[number, string | null, string | null]> = []) {
  return {
    results: [
      ...ok.map((user_id) => ({ user_id, status: 'ok' })),
      ...failed.map(([user_id, error_code, detail]) => ({ user_id, status: 'error', error_code, detail })),
    ],
    summary: { total: ok.length + failed.length, ok: ok.length, error: failed.length },
  };
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function open(over: Record<string, unknown> = {}) {
  const props = $state({
    runId: 10,
    runIsPublished: true,
    isAdmin: true,
    courseSlug: 'test',
    onNavigateToTab: vi.fn(),
    students: [student(1), student(2), student(3)] as RunStudentResponse[],
    groups: [ALPHA, BETA_OFF] as GroupResponse[],
    groupsEnabled: true,
    rosterPrefilter: null as 'unassigned' | null,
    onPrefilterClear: vi.fn(),
    onRefetchRosterData: vi.fn(async () => {
      if (server) props.students = server;
      return { students: props.students, groups: props.groups };
    }),
    onRefetchGroupsOnly: vi.fn().mockResolvedValue(undefined),
    onOpenImport: vi.fn(),
    ...over,
  });
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(RunRosterTab, { target, props });
  flushSync();
  return props;
}

const act = <T extends HTMLElement = HTMLButtonElement>(action: string) =>
  target.querySelector(`[data-action="${action}"]`) as T | null;
const row = (id: number) => target.querySelector(`tr[data-user-id="${id}"]`) as HTMLTableRowElement | null;
const trash = (id: number) => row(id)!.querySelector('button[data-action="delete-student"]') as HTMLButtonElement;
const strip = () => target.querySelector('[data-strip="bulk"]') as HTMLElement | null;
const bulkTrash = () => act('bulk-delete')!;
const banner = () => target.querySelector('.ro-banner') as HTMLElement | null;
const bannerText = () => text(target.querySelector('.ro-banner-text'));
const search = () => target.querySelector('input[name="roster-search"]') as HTMLInputElement;
const labelFor = (el: Element) => target.querySelector(`label[for="${el.id}"]`)?.textContent ?? null;
const options = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.textContent);
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const bulkCalls = (kind: 'bulk-move' | 'bulk-delete') =>
  fetchSpy.mock.calls.filter(([u]) => String(u).endsWith(`/students/${kind}`));

function check(id: number) {
  (row(id)!.querySelector('input[data-row-checkbox]') as HTMLInputElement).click();
  flushSync();
}
function checkAll() {
  (target.querySelector('input[data-header-checkbox]') as HTMLInputElement).click();
  flushSync();
}
function pick(sel: HTMLSelectElement, value: string) {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('RunRosterTab — the bulk strip', () => {
  it('"N selected", the hidden-labelled move select with "Name · n/10", 🗑 "Remove selected" and Clear selection', () => {
    open();
    check(1);
    check(2);
    expect(strip()!.classList.contains('ro-strip')).toBe(true);
    expect(text(target.querySelector('.ro-count'))).toBe('2 selected');
    const sel = act<HTMLSelectElement>('bulk-move-select')!;
    expect(labelFor(sel)).toBe('Move selected to a group');
    expect(options(sel)).toEqual(['Move to group…', 'Unassign', 'Alpha · 7/10']);
    expect(sel.value).toBe('');
    expect(bulkTrash().getAttribute('data-glyph')).toBe('trash');
    expect(bulkTrash().getAttribute('aria-label')).toBe('Remove selected');
    expect(bulkTrash().getAttribute('title')).toBe('Remove selected');
    expect(bulkTrash().hasAttribute('aria-disabled')).toBe(false);
    expect(text(act('clear-selection'))).toBe('Clear selection');
  });

  it('" (M visible)" while the search hides some students', () => {
    open();
    check(1);
    check(2);
    search().value = 's1';
    search().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(text(target.querySelector('.ro-count'))).toBe('2 selected (1 visible)');
  });

  it('selected rows carry the tint class', () => {
    open();
    check(2);
    expect(row(2)!.classList.contains('ro-selected')).toBe(true);
    expect(row(1)!.classList.contains('ro-selected')).toBe(false);
  });

  it('groups off: no move select', () => {
    open({ groupsEnabled: false });
    check(1);
    expect(act('bulk-move-select')).toBeNull();
    expect(bulkTrash()).not.toBeNull();
  });

  it('Clear selection empties the selection and focuses the search field', async () => {
    open();
    check(1);
    act('clear-selection')!.click();
    await settle();
    expect(strip()).toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it('the bulk confirm replaces the strip\'s right part, focuses Cancel, says plural or singular; Cancel → 🗑', async () => {
    open();
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    const warning = strip()!.querySelector('[role="group"] .warning');
    expect(text(warning)).toBe('Remove 2 students from this run?');
    expect(text(act('confirm-bulk-delete'))).toBe('Remove');
    expect(act('bulk-move-select')).toBeNull();
    expect(act('clear-selection')).toBeNull();
    const cancel = strip()!.querySelector('button.cancel') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await settle();
    expect(act('confirm-bulk-delete')).toBeNull();
    expect(document.activeElement).toBe(bulkTrash());

    check(2);
    bulkTrash().click();
    await settle();
    expect(text(strip()!.querySelector('[role="group"] .warning'))).toBe('Remove 1 student from this run?');
  });

  it('an emptied selection does not bring the confirm back with the next selection', async () => {
    open();
    check(1);
    bulkTrash().click();
    await settle();
    check(1);
    expect(strip()).toBeNull();
    check(2);
    expect(act('confirm-bulk-delete')).toBeNull();
    expect(bulkTrash()).not.toBeNull();
  });

  it('Remove sends one bulk delete of the selected ids; the banner says "Removed"; focus → Dismiss', async () => {
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-delete') ? jres(result([1, 2])) : jres([])));
    open();
    server = [student(3)];
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    act('confirm-bulk-delete')!.click();
    await settleAll();
    expect(bulkCalls('bulk-delete')).toHaveLength(1);
    expect(JSON.parse((bulkCalls('bulk-delete')[0][1] as RequestInit).body as string)).toEqual({ user_ids: [1, 2] });
    expect(bannerText()).toBe('Removed 2 of 2 — 0 failed.');
    expect(banner()!.classList.contains('ro-banner-ok')).toBe(true);
    expect(strip()).toBeNull();
    expect(row(1)).toBeNull();
    expect(document.activeElement).toBe(act('dismiss-banner'));
  });
});

describe('RunRosterTab — R44: busy bulk controls keep focus and ignore input', () => {
  it('during a bulk op the move select sends nothing and resets; 🗑 is aria-disabled with its title and does nothing', async () => {
    const pending = deferred<Response>();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? pending.promise : jres([])));
    open();
    check(1);
    check(2);
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settle();
    expect(bulkCalls('bulk-move')).toHaveLength(1);
    expect(act<HTMLSelectElement>('bulk-move-select')!.value).toBe('');
    expect(bannerText()).toBe('Moving 2…');
    expect(banner()!.classList.contains('ro-banner-info')).toBe(true);
    // In flight the banner has no actions, so no retry can be sent either.
    expect(banner()!.querySelector('button, select')).toBeNull();

    const sel = act<HTMLSelectElement>('bulk-move-select')!;
    expect(sel.disabled).toBe(false);
    pick(sel, '__unassigned');
    await settle();
    expect(sel.value).toBe('');
    expect(bulkCalls('bulk-move')).toHaveLength(1);

    const t = bulkTrash();
    expect(t.disabled).toBe(false);
    expect(t.getAttribute('aria-disabled')).toBe('true');
    expect(t.getAttribute('title')).toBe('Wait for the current change to finish');
    t.click();
    await settle();
    expect(act('confirm-bulk-delete')).toBeNull();

    pending.resolve(resp(result([1, 2])));
    await settleAll();
    expect(bannerText()).toBe('Moved 2 of 2 — 0 failed.');
    expect(bulkCalls('bulk-move')).toHaveLength(1);
  });

  it('Review Focus 4: 236 students → "Moving 236…"; a select change between the chunks sends nothing; then 200 + 36', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const sizes: number[] = [];
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      if (!url.endsWith('/bulk-move')) return jres([]);
      sizes.push(JSON.parse(init.body as string).user_ids.length);
      return sizes.length === 1 ? first.promise : second.promise;
    });
    open({ students: range(1, 236).map((id) => student(id)) });
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settle();
    expect(bannerText()).toBe('Moving 236…');
    expect(sizes).toEqual([200]);
    pick(act<HTMLSelectElement>('bulk-move-select')!, '__unassigned');
    await settle();
    expect(sizes).toEqual([200]);

    first.resolve(resp(result(range(1, 200))));
    await settle();
    expect(sizes).toEqual([200, 36]);
    expect(bannerText()).toBe('Moving 236…');
    pick(act<HTMLSelectElement>('bulk-move-select')!, '__unassigned');
    await settle();
    expect(sizes).toEqual([200, 36]);
    expect(act<HTMLSelectElement>('bulk-move-select')!.value).toBe('');

    second.resolve(resp(result(range(201, 236))));
    await settleAll();
    expect(bannerText()).toBe('Moved 236 of 236 — 0 failed.');
  });
});

describe('RunRosterTab — the result banner', () => {
  it('success: green, focus on Dismiss, closes itself after 5 s and hands focus to the search field', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? jres(result([1, 2, 3])) : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(banner()!.getAttribute('role')).toBe('status');
    expect(banner()!.classList.contains('ro-banner-ok')).toBe(true);
    expect(bannerText()).toBe('Moved 3 of 3 — 0 failed.');
    expect(document.activeElement).toBe(act('dismiss-banner'));
    vi.advanceTimersByTime(5100);
    await settle();
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it('success with focus elsewhere: the auto-close leaves focus alone', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? jres(result([1, 2, 3])) : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    const box = row(1)!.querySelector('input[data-row-checkbox]') as HTMLInputElement;
    box.focus();
    vi.advanceTimersByTime(5100);
    await settle();
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it('partial move: gold, the hover hint, the hidden-labelled retry select; focus on the strip\'s 🗑; the retry sends the failed ids', async () => {
    let phase = 1;
    fetchSpy.mockImplementation((url: string) => {
      if (!url.endsWith('/bulk-move')) return jres([]);
      return jres(phase++ === 1 ? result([1, 3], [[2, 'capacity_reached', 'full']]) : result([2]));
    });
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(banner()!.classList.contains('ro-banner-warn')).toBe(true);
    expect(bannerText()).toBe('Moved 2 of 3 — 1 failed. Hover a marked row for the reason.');
    const retry = act<HTMLSelectElement>('retry-move-select')!;
    expect(retry.classList.contains('ro-retry')).toBe(true);
    expect(options(retry)).toEqual(['Retry 1 → group…', 'Unassign', 'Alpha · 7/10']);
    expect(labelFor(retry)).toBe('Move the 1 failed student to a group');
    expect(text(target.querySelector('.ro-count'))).toBe('1 selected');
    expect(document.activeElement).toBe(bulkTrash());

    pick(retry, '99');
    await settleAll();
    expect(bulkCalls('bulk-move')).toHaveLength(2);
    expect(JSON.parse((bulkCalls('bulk-move')[1][1] as RequestInit).body as string)).toEqual({ user_ids: [2], group_id: 99 });
    expect(bannerText()).toBe('Moved 1 of 1 — 0 failed.');
  });

  it('a marked row: the rule class on its first cell, its reason as the row title, and a hidden "Failed: …"', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.endsWith('/bulk-move') ? jres(result([1, 3], [[2, 'capacity_reached', 'full']])) : jres([]));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    const r2 = row(2)!;
    expect(r2.classList.contains('row-error')).toBe(true);
    expect(r2.querySelector('td')!.classList.contains('ro-mark')).toBe(true);
    expect(r2.getAttribute('title')).toBe('Target group is full (10 students).');
    expect(text(r2.querySelector('.ro-email-cell .vh'))).toBe('Failed: Target group is full (10 students).');
    expect(row(1)!.querySelector('td')!.classList.contains('ro-mark')).toBe(false);
    expect(row(1)!.hasAttribute('title')).toBe(false);
    expect(row(1)!.querySelector('.ro-email-cell .vh')).toBeNull();
  });

  it('partial remove: "Removed …" and "Retry removing N"', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.endsWith('/bulk-delete') ? jres(result([1], [[2, 'not_in_run', null]])) : jres([]));
    open();
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    act('confirm-bulk-delete')!.click();
    await settleAll();
    expect(bannerText()).toBe('Removed 1 of 2 — 1 failed. Hover a marked row for the reason.');
    expect(text(act('retry-delete'))).toBe('Retry removing 1');
    expect(act('retry-delete')!.classList.contains('ro-retry')).toBe(true);
    expect(document.activeElement).toBe(bulkTrash());
  });

  it('cancelled move without marked rows: no hover hint; "Move the N not processed…" with its hidden label', async () => {
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? jres({ detail: 'Server error' }, 500) : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    expect(banner()!.classList.contains('ro-banner-warn')).toBe(true);
    expect(bannerText()).toBe('Moved 0 of 3 — 0 failed, 3 cancelled (connection issue).');
    const rc = act<HTMLSelectElement>('retry-cancelled')!;
    expect(rc.tagName).toBe('SELECT');
    expect(options(rc)).toEqual(['Move the 3 not processed…', 'Unassign', 'Alpha · 7/10']);
    expect(labelFor(rc)).toBe('Move the 3 not processed students to a group');
  });

  it('cancelled remove: "Retry the N not processed"', async () => {
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-delete') ? jres({ detail: 'Server error' }, 500) : jres([])));
    open();
    check(1);
    check(2);
    bulkTrash().click();
    await settle();
    act('confirm-bulk-delete')!.click();
    await settleAll();
    expect(text(act('retry-cancelled'))).toBe('Retry the 2 not processed');
  });

  it('Dismiss closes the banner and focuses the search field', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.endsWith('/bulk-move') ? jres(result([1, 3], [[2, 'capacity_reached', 'full']])) : jres([]));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settleAll();
    act('dismiss-banner')!.click();
    await settle();
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it('a settled op leaves focus where the teacher moved it', async () => {
    const pending = deferred<Response>();
    fetchSpy.mockImplementation((url: string) => (url.endsWith('/bulk-move') ? pending.promise : jres([])));
    open();
    checkAll();
    pick(act<HTMLSelectElement>('bulk-move-select')!, '99');
    await settle();
    search().focus();
    pending.resolve(resp(result([1, 3], [[2, 'capacity_reached', 'full']])));
    await settleAll();
    expect(bannerText()).toMatch(/^Moved 2 of 3/);
    expect(document.activeElement).toBe(search());
  });
});

describe('RunRosterTab — the table', () => {
  it('columns, header box and accessible names', () => {
    open();
    expect(target.querySelector('.ro-table-wrap > table.ro-table')).not.toBeNull();
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => text(th))).toEqual(['', 'Email', 'Full name', 'Group', 'Actions']);
    expect(target.querySelector('thead th .vh')!.textContent).toBe('Actions');
    expect(target.querySelector('input[data-header-checkbox]')!.getAttribute('aria-label')).toBe('Select all visible students');
    expect(row(1)!.querySelector('input[data-row-checkbox]')!.getAttribute('aria-label')).toBe('Select s1@x.com');
    const sel = row(1)!.querySelector('select') as HTMLSelectElement;
    expect(sel.getAttribute('aria-label')).toBe('Group for s1@x.com');
    expect(trash(1).getAttribute('aria-label')).toBe('Remove s1@x.com');
    expect(trash(1).getAttribute('title')).toBe('Remove from run');
    expect(trash(1).getAttribute('data-glyph')).toBe('trash');
    expect(row(1)!.getAttribute('data-row')).toBe('student');
  });

  it('the row select reads "Name · n/10", adding " · disabled" for a disabled group (R38)', () => {
    open();
    expect(options(row(1)!.querySelector('select') as HTMLSelectElement)).toEqual([
      'Unassigned', 'Alpha · 7/10', 'Beta · 3/10 · disabled',
    ]);
  });

  it('groups off: no Group column', () => {
    open({ groupsEnabled: false });
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => text(th))).toEqual(['', 'Email', 'Full name', 'Actions']);
    expect(row(1)!.querySelector('select')).toBeNull();
  });

  it('an empty full name shows a muted dash; the e-mail cell can wrap', () => {
    open({ students: [student(1, { user_full_name: null })] });
    expect(text(row(1)!.querySelector('.ro-none'))).toBe('—');
    expect(row(1)!.querySelector('td.ro-email-cell')!.textContent).toBe('s1@x.com');
  });

  it('no table while nothing matches', () => {
    open();
    search().value = 'zzz';
    search().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('table')).toBeNull();
  });
});

describe('RunRosterTab — the row confirm', () => {
  it('opens a one-line row under its row with focus on Cancel; Cancel → its 🗑', async () => {
    open();
    trash(2).click();
    await settle();
    const confirmRow = row(2)!.nextElementSibling as HTMLTableRowElement;
    expect(confirmRow.classList.contains('ro-confirm-row')).toBe(true);
    expect(confirmRow.querySelector('td')!.getAttribute('colspan')).toBe('5');
    expect(text(confirmRow.querySelector('.warning'))).toBe('Remove s2@x.com from this run?');
    expect(text(act('confirm-delete-student'))).toBe('Remove');
    const cancel = confirmRow.querySelector('button.cancel') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await settle();
    expect(target.querySelector('.ro-confirm-row')).toBeNull();
    expect(document.activeElement).toBe(trash(2));
  });

  it('Remove → the next row\'s 🗑, else the previous row\'s, else the add toggle', async () => {
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => (init?.method === 'DELETE' ? jres(null, 204) : jres([])));
    open();
    server = [student(1), student(3)];
    trash(2).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(row(2)).toBeNull();
    expect(document.activeElement).toBe(trash(3));

    server = [student(1)];
    trash(3).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(document.activeElement).toBe(trash(1));

    server = [];
    trash(1).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(document.activeElement).toBe(act('toggle-add-student'));
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(3);
  });

  it('on a draft (the toggle disabled) the last Remove → the search field', async () => {
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => (init?.method === 'DELETE' ? jres(null, 204) : jres([])));
    open({ runIsPublished: false, students: [student(1)] });
    server = [];
    trash(1).click();
    await settle();
    act('confirm-delete-student')!.click();
    await settleAll();
    expect(document.activeElement).toBe(search());
  });

  it('two clicks on Remove send one DELETE; a failed Remove toasts, closes the confirm and focuses its 🗑', async () => {
    const pending = deferred<Response>();
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => (init?.method === 'DELETE' ? pending.promise : jres([])));
    open();
    trash(2).click();
    await settle();
    act('confirm-delete-student')!.click();
    act('confirm-delete-student')!.click();
    await settle();
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(1);
    pending.resolve(resp({ detail: 'Student has submissions' }, 409));
    await settleAll();
    expect(target.querySelector('.ro-confirm-row')).toBeNull();
    expect(row(2)).not.toBeNull();
    expect(toasts.list.map((t) => t.message)).toContain('Student has submissions');
    expect(document.activeElement).toBe(trash(2));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunRosterTab.table.svelte.test.ts > $SDD/tmp/t4-red.log 2>&1; tail -5 $SDD/tmp/t4-red.log`
Expected: FAIL, 25 of 28. The old strip has no `.ro-count`, no 🗑 `IconButton` and no hidden label; the old banner reads "Deleted" and shows nothing in flight; the old confirms say "Confirm Delete"; the old table has no `.ro-table-wrap`, no accessible names and no " · " labels. Three guards already hold: `'groups off: no move select'`, `'success with focus elsewhere: the auto-close leaves focus alone'` and `'no table while nothing matches'` (Task 3 already hides the table).

- [ ] **Step 3: Rewrite `RunRosterTab.svelte` (strip, banner, table, confirms)**

Replace the whole of `frontend/src/components/runs/RunRosterTab.svelte` with the file below. Compared with Task 3:
- the script:
  - `BulkOpResult.total`;
  - `BUSY_TITLE`, `colCount`, the refs `stripEl`, `bulkTrashEl`, `bannerEl`, the retry refs, `dismissEl`, `trashEls`, and `removing`;
  - the selection effect (P43) and the auto-close focus;
  - `summaryText` (in flight, "Removed", the hover hint);
  - `takeChoice` (R44, P36) and the guarded retries;
  - `focusIsOurs` and the settle focus (P42);
  - `askBulkDelete` / `cancelBulkDelete` / `bulkDeleteSelected` / `clearSelection` / `dismissBanner`;
  - `askRemove` / `cancelRemove` / `confirmRemove` (6a's chain);
  - the four select bind-values go;
- the markup: the strip, the banner, the table and the confirm row;
- the style: the old rules go, and the 10b ones come in.

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet, SvelteMap } from 'svelte/reactivity';
  import { ApiError } from '../../lib/api';
  import {
    addRunStudent,
    removeRunStudent,
    updateRunStudent,
    bulkMoveRunStudents,
    bulkDeleteRunStudents,
  } from '../../lib/runRoster';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { GroupResponse, RunStudentResponse, BulkRosterErrorCode } from '../../lib/types';
  import type { ActiveTab } from '../../lib/runTabs';

  type BulkOpKind = 'move' | 'delete';
  type BulkRowErrorMeta = { error_code?: BulkRosterErrorCode | null; detail?: string | null };
  type BulkOpResult = {
    kind: 'idle' | 'in-flight' | 'success' | 'partial' | 'cancelled';
    // How many students the op was asked to process ("Moving 236…").
    total: number;
    succeededIds: number[];
    chunkErrorRowIds: number[];
    cancelledIds: number[];
    lastOp: BulkOpKind;
    // Records the move target for the last op. Reserved by the spec's §10 T14
    // contract for future "Repeat move" / "Retry to same group" UX; not consumed
    // by T15's current banner code (T15 retries on a different group, since the
    // chunk-level cancellation usually implies the original target was bad).
    lastTargetGroupId?: number | null;
    error?: ApiError;
  };

  let {
    runId,
    runIsPublished,
    isAdmin,
    courseSlug: _courseSlug,
    onNavigateToTab,
    students,
    groups,
    groupsEnabled,
    rosterPrefilter,
    onPrefilterClear,
    onRefetchRosterData,
    onRefetchGroupsOnly,
    onOpenImport,
  }: {
    runId: number;
    runIsPublished: boolean;
    isAdmin: boolean;
    courseSlug: string;
    onNavigateToTab: (tab: ActiveTab) => void;
    students: RunStudentResponse[];
    groups: GroupResponse[];
    groupsEnabled: boolean;
    rosterPrefilter: 'unassigned' | null;
    onPrefilterClear: () => void;
    onRefetchRosterData: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onRefetchGroupsOnly: () => Promise<void>;
    onOpenImport: () => void;
  } = $props();

  const uid = $props.id();
  // The draft banner's id: a test hook, and the description of every add
  // control a draft disables.
  const DRAFT_HINT_ID = 'roster-draft-publish-hint';
  const BUSY_TITLE = 'Wait for the current change to finish';
  const draftTitle = $derived(
    isAdmin ? 'Publish this run before adding students' : 'A course admin must publish this run first',
  );
  const enabledGroups = $derived(groups.filter((g) => !g.is_disabled));
  const unassignedCount = $derived(students.filter((s) => s.group_id === null).length);
  const colCount = $derived(groupsEnabled ? 5 : 4);

  // R38: every roster group select reads "Group A · 7/10" (a native option
  // cannot set the count in mono).
  function groupLabel(g: GroupResponse): string {
    return `${g.name} · ${g.student_count}/10`;
  }

  let searchEl = $state<HTMLInputElement>();
  let toggleEl = $state<HTMLButtonElement>();
  let emailEl = $state<HTMLInputElement>();
  let stripEl = $state<HTMLDivElement>();
  let bulkTrashEl = $state<HTMLButtonElement>();
  let bannerEl = $state<HTMLDivElement>();
  let retryMoveEl = $state<HTMLSelectElement>();
  let retryDeleteEl = $state<HTMLButtonElement>();
  let retryCancelledSelectEl = $state<HTMLSelectElement>();
  let retryCancelledBtnEl = $state<HTMLButtonElement>();
  let dismissEl = $state<HTMLButtonElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  // The empty-roster link unmounts once an import fills the roster, so the
  // modal could not return focus to it. Hand focus to the toolbar's Import
  // roster first: that is the opener the modal returns to after Done.
  let importBtnEl = $state<HTMLButtonElement>();
  function openImportFromLink() {
    importBtnEl?.focus({ preventScroll: true });
    onOpenImport();
  }

  let search = $state('');
  let newEmail = $state('');
  let newGroupId = $state<number | '__unassigned'>('__unassigned');
  let addError: string | null = $state(null);
  let pendingDelete = $state<number | null>(null);
  let removing = $state(false);

  // D25: + opens the add row under the toolbar. `adding` spans the POST and
  // its refetch: Add stays focusable but inert, the field read-only (6b R20).
  let addOpen = $state(false);
  let adding = $state(false);
  const addShown = $derived(addOpen && runIsPublished);

  const pendingGroupId = new SvelteMap<number, number | null>();
  const selected = new SvelteSet<number>();

  // Bulk-op state (T14), read by the strip and the result banner.
  // `rowErrorBorders` marks the rows that failed; `rowErrorMeta` drives their reason.
  // We reassign new instances (not `.clear()`) on each dispatch so Svelte's
  // reactivity tracker treats the change as a fresh reference, even though
  // SvelteSet/SvelteMap mutations would also notify.
  // While `bulkInFlight`, every bulk and retry control ignores input (R44), so a
  // second bulk op cannot start before the first one's refetch.
  let bulkOpResult = $state<BulkOpResult>({
    kind: 'idle',
    total: 0,
    succeededIds: [],
    chunkErrorRowIds: [],
    cancelledIds: [],
    lastOp: 'move',
  });
  const bulkInFlight = $derived(bulkOpResult.kind === 'in-flight');
  let rowErrorBorders = $state(new SvelteSet<number>());
  let rowErrorMeta = $state(new SvelteMap<number, BulkRowErrorMeta>());
  let bulkDeleteConfirm = $state(false);

  // An emptied selection unmounts the strip; its confirm must not come back
  // open with the next selection.
  $effect(() => {
    if (selected.size === 0) bulkDeleteConfirm = false;
  });

  // Banner auto-dismiss state. Re-set to false at the start of each new
  // success run (so a previously-dismissed banner reappears for a fresh op);
  // flipped to true 5s after `bulkOpResult.kind` lands on 'success'. The
  // $effect's cleanup clears the timer when kind transitions away from
  // 'success' before the 5s elapses, preventing a stale dismiss. §Focus: when
  // focus was inside the banner, it goes to the search field.
  let bannerDismissed = $state(false);

  $effect(() => {
    if (bulkOpResult.kind === 'success') {
      bannerDismissed = false;
      const t = setTimeout(() => {
        const hadFocus = bannerEl?.contains(document.activeElement) ?? false;
        bannerDismissed = true;
        if (hadFocus) void tick().then(() => searchEl?.focus());
      }, 5000);
      return () => clearTimeout(t);
    }
  });

  function summaryText(): string {
    const r = bulkOpResult;
    if (r.kind === 'in-flight') return `${r.lastOp === 'move' ? 'Moving' : 'Removing'} ${r.total}…`;
    const total = r.succeededIds.length + r.chunkErrorRowIds.length + r.cancelledIds.length;
    const verb = r.lastOp === 'move' ? 'Moved' : 'Removed';
    const hint = r.chunkErrorRowIds.length > 0 ? ' Hover a marked row for the reason.' : '';
    if (r.kind === 'success') return `${verb} ${r.succeededIds.length} of ${total} — 0 failed.`;
    if (r.kind === 'partial') return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed.${hint}`;
    if (r.kind === 'cancelled') {
      return `${verb} ${r.succeededIds.length} of ${total} — ${r.chunkErrorRowIds.length} failed, ${r.cancelledIds.length} cancelled (connection issue).${hint}`;
    }
    return '';
  }

  // R44: a native <select> cannot be aria-disabled. The bulk and retry selects
  // snap back to their placeholder after every change, and the choice is
  // ignored while a bulk op runs. Returns the group (null = Unassign), or
  // undefined when there is nothing to do.
  function takeChoice(event: Event): number | null | undefined {
    const el = event.currentTarget as HTMLSelectElement;
    const raw = el.value;
    el.value = '';
    if (raw === '' || bulkInFlight) return undefined;
    return raw === '__unassigned' ? null : Number(raw);
  }

  function retryMove(event: Event) {
    const groupId = takeChoice(event);
    if (groupId === undefined) return;
    void dispatchBulkOp('move', bulkOpResult.chunkErrorRowIds, groupId);
  }

  function retryDelete() {
    if (bulkInFlight) return;
    void dispatchBulkOp('delete', bulkOpResult.chunkErrorRowIds);
  }

  // The "not processed" retries send the cancelled and the failed students.
  function retryCancelledMove(event: Event) {
    const groupId = takeChoice(event);
    if (groupId === undefined) return;
    void dispatchBulkOp('move', [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds], groupId);
  }

  function retryCancelledDelete() {
    if (bulkInFlight) return;
    void dispatchBulkOp('delete', [...bulkOpResult.cancelledIds, ...bulkOpResult.chunkErrorRowIds]);
  }

  function bulkErrorTooltip(meta: BulkRowErrorMeta | undefined): string {
    if (!meta) return '';
    const code = meta.error_code;
    if (code === 'not_in_run') return 'Student is no longer enrolled in this run.';
    if (code === 'capacity_reached') return 'Target group is full (10 students).';
    if (code === 'internal_error') return 'Server error — please retry.';
    // code is null/undefined: fall back to backend-supplied detail, else generic.
    return meta.detail ? meta.detail : 'Unknown error.';
  }

  // §Focus: a settled op moves focus only from where the op left it (<body>,
  // the strip or the banner); a teacher who moved on keeps their place.
  function focusIsOurs(): boolean {
    const a = document.activeElement;
    return !a || a === document.body || !!stripEl?.contains(a) || !!bannerEl?.contains(a);
  }

  async function dispatchBulkOp(
    kind: BulkOpKind,
    userIds: number[],
    groupId: number | null = null,
  ) {
    // Step 1: clear borders/meta for this op (new instances → guaranteed reactivity).
    rowErrorBorders = new SvelteSet<number>();
    rowErrorMeta = new SvelteMap<number, BulkRowErrorMeta>();
    bulkOpResult = {
      kind: 'in-flight',
      total: userIds.length,
      succeededIds: [],
      chunkErrorRowIds: [],
      cancelledIds: [],
      lastOp: kind,
      lastTargetGroupId: groupId,
    };

    const chunks: number[][] = [];
    for (let i = 0; i < userIds.length; i += 200) chunks.push(userIds.slice(i, i + 200));

    const succeededIds: number[] = [];
    const chunkErrorRowIds: number[] = [];
    let cancelledIds: number[] = [];
    let chunkLevelError: ApiError | undefined;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      try {
        const response = kind === 'move'
          ? await bulkMoveRunStudents(runId, chunk, groupId)
          : await bulkDeleteRunStudents(runId, chunk);
        for (const row of response.results) {
          if (row.status === 'ok') {
            succeededIds.push(row.user_id);
          } else {
            chunkErrorRowIds.push(row.user_id);
            rowErrorMeta.set(row.user_id, { error_code: row.error_code, detail: row.detail });
          }
        }
      } catch (e) {
        // Whole-chunk failure (network or non-207 like 400/409). All
        // unprocessed user_ids from this and later chunks become cancelled.
        const remainingFromThisChunk = chunk;
        const remainingFromLaterChunks = chunks.slice(ci + 1).flat();
        cancelledIds = [...remainingFromThisChunk, ...remainingFromLaterChunks];
        chunkLevelError = e instanceof ApiError ? e : new ApiError(500, 'Network error');
        break;
      }
    }

    // Refetch roster + groups so capacity badges and group_id reflect the server.
    await onRefetchRosterData();

    // Selection book-keeping: remove succeeded, keep errored/cancelled selected.
    for (const id of succeededIds) selected.delete(id);
    for (const id of chunkErrorRowIds) {
      selected.add(id);
      rowErrorBorders.add(id);
    }
    for (const id of cancelledIds) selected.add(id);

    let finalKind: BulkOpResult['kind'];
    if (chunkLevelError) finalKind = 'cancelled';
    else if (chunkErrorRowIds.length > 0) finalKind = 'partial';
    else finalKind = 'success';

    bulkOpResult = {
      kind: finalKind,
      total: userIds.length,
      succeededIds,
      chunkErrorRowIds,
      cancelledIds,
      lastOp: kind,
      lastTargetGroupId: groupId,
      error: chunkLevelError,
    };

    // §Focus: the strip's 🗑 if the strip is still there, else the banner's
    // first retry control, else Dismiss. Failed and cancelled rows stay
    // selected, so while a retry control exists the strip does too: the retry
    // entries are defensive, kept to match the spec's chain.
    await tick();
    if (focusIsOurs()) {
      focusFirst([bulkTrashEl, retryMoveEl, retryDeleteEl, retryCancelledSelectEl, retryCancelledBtnEl, dismissEl]);
    }
  }

  function bulkMoveSelected(event: Event) {
    const groupId = takeChoice(event);
    if (groupId === undefined) return;
    void dispatchBulkOp('move', Array.from(selected), groupId);
  }

  function askBulkDelete() {
    if (bulkInFlight) return;
    bulkDeleteConfirm = true;
  }

  async function cancelBulkDelete() {
    bulkDeleteConfirm = false;
    await tick();
    bulkTrashEl?.focus();
  }

  async function bulkDeleteSelected() {
    if (bulkInFlight) return;
    bulkDeleteConfirm = false;
    const op = dispatchBulkOp('delete', Array.from(selected));
    // The confirm unmounts under focus: hold focus on the strip's 🗑
    // (aria-disabled while the op runs) until the op settles.
    await tick();
    bulkTrashEl?.focus();
    await op;
  }

  async function clearSelection() {
    selected.clear();
    await tick();
    searchEl?.focus();
  }

  async function dismissBanner() {
    bulkOpResult = { ...bulkOpResult, kind: 'idle' };
    await tick();
    searchEl?.focus();
  }

  function selectValueFor(s: RunStudentResponse): number | '__unassigned' {
    const effective = pendingGroupId.has(s.user_id) ? pendingGroupId.get(s.user_id)! : s.group_id;
    return effective === null ? '__unassigned' : effective;
  }

  const visible = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (rosterPrefilter === 'unassigned' && s.group_id !== null) return false;
      if (!q) return true;
      const email = s.user_email.toLowerCase();
      const name = (s.user_full_name ?? '').toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  });

  const selectedVisibleCount = $derived(visible.filter((s) => selected.has(s.user_id)).length);
  const headerChecked = $derived(visible.length > 0 && selectedVisibleCount === visible.length);
  const headerIndeterminate = $derived(selectedVisibleCount > 0 && selectedVisibleCount < visible.length);

  function onHeaderClick(event: Event) {
    event.preventDefault();
    if (headerChecked) {
      for (const s of visible) selected.delete(s.user_id);
    } else {
      for (const s of visible) selected.add(s.user_id);
    }
  }

  function onSearchInput(event: Event) {
    search = (event.currentTarget as HTMLInputElement).value;
    if (search && rosterPrefilter !== null) onPrefilterClear();
  }

  // §Focus: chip ×, Clear filter and Clear search → the search field.
  async function clearPrefilter() {
    onPrefilterClear();
    await tick();
    searchEl?.focus();
  }

  async function clearSearch() {
    search = '';
    await tick();
    searchEl?.focus();
  }

  async function openAdd() {
    if (!runIsPublished) return;
    addOpen = true;
    await tick();
    emailEl?.focus();
  }

  // Closing keeps the typed e-mail; it is ignored while an add runs.
  async function closeAdd() {
    if (adding) return;
    addOpen = false;
    addError = null;
    await tick();
    toggleEl?.focus();
  }

  function toggleAdd() {
    if (addShown) void closeAdd();
    else void openAdd();
  }

  function onAddKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void closeAdd();
  }

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    if (adding || !runIsPublished) return;
    addError = null;
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const dup = students.some((s) => s.user_email.toLowerCase() === email);
    if (dup) {
      addError = `${newEmail} is already enrolled. Edit their group in the table.`;
      return;
    }
    adding = true;
    try {
      const groupId: number | null = newGroupId === '__unassigned' ? null : newGroupId;
      await addRunStudent(runId, newEmail.trim(), groupId);
      newEmail = '';
      newGroupId = '__unassigned';
      await onRefetchRosterData();
    } catch (e) {
      // Surface every ApiError (4xx/5xx) inline via the backend-supplied
      // displayMessage — covers run_unpublished, student_already_active_in_course,
      // capacity_reached, group_disabled, and any future error_code without
      // per-branch wiring. Non-ApiError exceptions (e.g., TypeError from a
      // fetch network failure) are silently dropped, matching confirmRemove
      // and onGroupChange below.
      if (e instanceof ApiError) {
        addError = e.displayMessage;
      }
    } finally {
      adding = false;
    }
    // Success: ready for the next student. Failure: the field the error is about.
    await tick();
    emailEl?.focus();
  }

  function askRemove(userId: number) {
    if (removing) return;
    pendingDelete = userId;
  }

  async function cancelRemove(userId: number) {
    pendingDelete = null;
    await tick();
    trashEls[userId]?.focus();
  }

  // §Focus (6a's chain): Remove → the next row's 🗑, else the previous row's,
  // else the add toggle, else the search field; a failure → this row's 🗑.
  async function confirmRemove(userId: number) {
    if (removing) return;
    removing = true;
    const idx = visible.findIndex((s) => s.user_id === userId);
    try {
      await removeRunStudent(runId, userId);
      pendingDelete = null;
      await onRefetchRosterData();
      await tick();
      const next = visible[idx];
      const prev = idx > 0 ? visible[idx - 1] : undefined;
      focusFirst([next && trashEls[next.user_id], prev && trashEls[prev.user_id], toggleEl, searchEl]);
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
      await tick();
      focusFirst([trashEls[userId], toggleEl, searchEl]);
    } finally {
      removing = false;
    }
  }

  async function onGroupChange(s: RunStudentResponse, raw: string) {
    const targetGroupId: number | null = raw === '__unassigned' ? null : Number(raw);
    pendingGroupId.set(s.user_id, targetGroupId);
    try {
      const updated = await updateRunStudent(runId, s.user_id, targetGroupId);
      // Mutate the local student row in place. Spec §4.4: inline-edit success
      // branch refetches groups only (for capacity badges), NOT students; this
      // keeps the row's group_id in sync until the next full roster refetch.
      s.group_id = updated.group_id;
      pendingGroupId.delete(s.user_id);
      await onRefetchGroupsOnly();
    } catch (e) {
      // Delete from pendingGroupId on EVERY error path (incl. network failures),
      // otherwise a TypeError thrown by fetch would leave the row permanently disabled.
      pendingGroupId.delete(s.user_id);
      if (e instanceof ApiError) {
        // Per-errorCode branches kept for future divergence (e.g. distinct toast
        // kinds or copy). For now all 409 paths display the backend-supplied
        // detail string via ApiError.displayMessage.
        if (e.status === 409 && e.errorCode === 'capacity_reached') {
          pushToast(e.displayMessage, 'error');
        } else if (e.status === 409 && e.errorCode === 'group_disabled') {
          pushToast(e.displayMessage, 'error');
        } else {
          pushToast(e.displayMessage, 'error');
        }
      }
    }
  }

  // prunePendingGroups: fires on every reassignment of the parent's `students`
  // prop. Removes pending-overlay entries for user_ids no longer in the roster.
  // Covers all 5 refetch paths from spec §4.4 without parent-side setter wrapping.
  $effect(() => {
    // Dependency declaration trick: reading `students` here registers the
    // effect's dependency on the array reference for fine-grained reactivity.
    void students;
    const liveIds = new Set(students.map((s) => s.user_id));
    for (const uid of Array.from(pendingGroupId.keys())) {
      if (!liveIds.has(uid)) pendingGroupId.delete(uid);
    }
  });
</script>

<section class="ro-tab">
  {#if !runIsPublished}
    <div id={DRAFT_HINT_ID} class="ro-info" role="status" data-action="draft-publish-hint">
      {#if isAdmin}
        Publish this run before adding students. You can still move or remove students already on the roster.
        <button
          type="button"
          class="ro-link"
          data-action="nav-overview-publish-roster"
          onclick={() => onNavigateToTab('overview')}
        >Publish on Overview</button>
      {:else}
        This run is not published yet. A course admin publishes it; then students can be added. You can still move or remove students already on the roster.
      {/if}
    </div>
  {/if}

  <div class="ro-toolbar">
    <label class="vh" for="{uid}-search">Search students</label>
    <input
      id="{uid}-search"
      class="ro-input ro-search"
      name="roster-search"
      placeholder="Search name or email…"
      autocomplete="off"
      value={search}
      oninput={onSearchInput}
      bind:this={searchEl}
    />
    {#if rosterPrefilter === 'unassigned'}
      <span class="ro-chip">
        Unassigned ({unassignedCount})
        <button
          type="button"
          class="ro-chip-x"
          data-action="clear-prefilter"
          aria-label="Clear filter"
          title="Clear filter"
          onclick={clearPrefilter}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" /></svg>
        </button>
      </span>
    {/if}
    <div class="ro-tools-right">
      <Button
        variant="secondary"
        data-action="open-import"
        disabled={!runIsPublished}
        title={runIsPublished ? undefined : draftTitle}
        aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
        bind:element={importBtnEl}
        onclick={onOpenImport}
      >Import roster</Button>
      <IconButton
        glyph={addShown ? 'close' : 'plus'}
        primary={!addShown}
        size="sm"
        title={!runIsPublished ? draftTitle : addShown ? 'Close add row' : 'Add student'}
        aria-label={addShown ? 'Close add row' : 'Add student'}
        disabled={!runIsPublished}
        describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
        aria-expanded={addShown}
        aria-controls={addShown ? `${uid}-add` : undefined}
        data-action="toggle-add-student"
        bind:element={toggleEl}
        onclick={toggleAdd}
      />
    </div>
  </div>

  {#if addShown}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form id="{uid}-add" class="ro-add" onsubmit={submitAdd} onkeydown={onAddKeydown}>
      <label class="vh" for="{uid}-email">Student email</label>
      <input
        id="{uid}-email"
        class="ro-input ro-email"
        name="new-email"
        type="email"
        maxlength="254"
        placeholder="student@example.com"
        autocomplete="off"
        readonly={adding}
        aria-invalid={addError ? 'true' : undefined}
        aria-describedby={addError ? `${uid}-add-err` : undefined}
        bind:value={newEmail}
        bind:this={emailEl}
      />
      {#if groupsEnabled}
        <label class="vh" for="{uid}-group">Group</label>
        <select id="{uid}-group" class="ro-select" bind:value={newGroupId}>
          <option value="__unassigned">Unassigned</option>
          {#each enabledGroups as g (g.id)}
            <option value={g.id}>{groupLabel(g)}</option>
          {/each}
        </select>
      {/if}
      <Button
        type="submit"
        variant="primary"
        data-action="add-student"
        loading={adding}
        aria-disabled={adding}
        disabled={!adding && !newEmail.trim()}
        title={adding ? BUSY_TITLE : newEmail.trim() ? undefined : 'Enter an email address'}
      >Add</Button>
      <Button variant="secondary" data-action="cancel-add-student" onclick={closeAdd}>Cancel</Button>
    </form>
    {#if addError}<p id="{uid}-add-err" class="ro-err error" role="alert">{addError}</p>{/if}
  {/if}

  {#if selected.size > 0}
    <div data-strip="bulk" class="ro-strip" bind:this={stripEl}>
      <span class="ro-count">{selected.size} selected{visible.length < students.length ? ` (${selectedVisibleCount} visible)` : ''}</span>
      {#if bulkDeleteConfirm}
        <InlineConfirm
          row
          takeFocus
          warning={selected.size === 1 ? 'Remove 1 student from this run?' : `Remove ${selected.size} students from this run?`}
          confirmLabel="Remove"
          confirmDataAction="confirm-bulk-delete"
          onConfirm={bulkDeleteSelected}
          onCancel={cancelBulkDelete}
        />
      {:else}
        {#if groupsEnabled}
          <label class="vh" for="{uid}-bulk-move">Move selected to a group</label>
          <select id="{uid}-bulk-move" class="ro-select" data-action="bulk-move-select" onchange={bulkMoveSelected}>
            <option value="" disabled selected>Move to group…</option>
            <option value="__unassigned">Unassign</option>
            {#each enabledGroups as g (g.id)}
              <option value={g.id}>{groupLabel(g)}</option>
            {/each}
          </select>
        {/if}
        <IconButton
          glyph="trash"
          size="sm"
          danger
          title={bulkInFlight ? BUSY_TITLE : 'Remove selected'}
          aria-label="Remove selected"
          aria-disabled={bulkInFlight}
          data-action="bulk-delete"
          bind:element={bulkTrashEl}
          onclick={askBulkDelete}
        />
        <button type="button" class="ro-text-btn ro-clear" data-action="clear-selection" onclick={clearSelection}>Clear selection</button>
      {/if}
    </div>
  {/if}

  {#if bulkOpResult.kind !== 'idle' && !(bulkOpResult.kind === 'success' && bannerDismissed)}
    <div
      class="ro-banner"
      class:ro-banner-info={bulkOpResult.kind === 'in-flight'}
      class:ro-banner-ok={bulkOpResult.kind === 'success'}
      class:ro-banner-warn={bulkOpResult.kind === 'partial' || bulkOpResult.kind === 'cancelled'}
      role="status"
      bind:this={bannerEl}
    >
      <span class="ro-banner-text">{summaryText()}</span>
      {#if bulkOpResult.kind === 'partial' && bulkOpResult.lastOp === 'move'}
        {@const n = bulkOpResult.chunkErrorRowIds.length}
        <label class="vh" for="{uid}-retry-move">Move the {n} failed {n === 1 ? 'student' : 'students'} to a group</label>
        <select id="{uid}-retry-move" class="ro-retry" data-action="retry-move-select" bind:this={retryMoveEl} onchange={retryMove}>
          <option value="" disabled selected>Retry {n} &rarr; group…</option>
          <option value="__unassigned">Unassign</option>
          {#each enabledGroups as g (g.id)}
            <option value={g.id}>{groupLabel(g)}</option>
          {/each}
        </select>
      {:else if bulkOpResult.kind === 'partial'}
        <button type="button" class="ro-retry" data-action="retry-delete" bind:this={retryDeleteEl} onclick={retryDelete}>Retry removing {bulkOpResult.chunkErrorRowIds.length}</button>
      {:else if bulkOpResult.kind === 'cancelled'}
        {@const m = bulkOpResult.cancelledIds.length + bulkOpResult.chunkErrorRowIds.length}
        {#if bulkOpResult.lastOp === 'move'}
          <label class="vh" for="{uid}-retry-cancelled">Move the {m} not processed {m === 1 ? 'student' : 'students'} to a group</label>
          <select id="{uid}-retry-cancelled" class="ro-retry" data-action="retry-cancelled" bind:this={retryCancelledSelectEl} onchange={retryCancelledMove}>
            <option value="" disabled selected>Move the {m} not processed…</option>
            <option value="__unassigned">Unassign</option>
            {#each enabledGroups as g (g.id)}
              <option value={g.id}>{groupLabel(g)}</option>
            {/each}
          </select>
        {:else}
          <button type="button" class="ro-retry" data-action="retry-cancelled" bind:this={retryCancelledBtnEl} onclick={retryCancelledDelete}>Retry the {m} not processed</button>
        {/if}
      {/if}
      {#if bulkOpResult.kind !== 'in-flight'}
        <button type="button" class="ro-text-btn ro-dismiss" data-action="dismiss-banner" bind:this={dismissEl} onclick={dismissBanner}>Dismiss</button>
      {/if}
    </div>
  {/if}

  {#if visible.length > 0}
    <div class="ro-table-wrap">
      <table class="ro-table">
        <thead>
          <tr>
            <th class="ro-col-check">
              <input
                type="checkbox"
                data-header-checkbox
                aria-label="Select all visible students"
                checked={headerChecked}
                onclick={onHeaderClick}
                bind:indeterminate={() => headerIndeterminate, () => {}}
              />
            </th>
            <th>Email</th>
            <th class="ro-col-name">Full name</th>
            {#if groupsEnabled}<th class="ro-col-group">Group</th>{/if}
            <th class="ro-col-actions"><span class="vh">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each visible as s (s.user_id)}
            {@const marked = rowErrorBorders.has(s.user_id)}
            {@const reason = bulkErrorTooltip(rowErrorMeta.get(s.user_id))}
            <tr
              data-row="student"
              data-user-id={s.user_id}
              class:row-error={marked}
              class:ro-selected={selected.has(s.user_id)}
              title={reason || undefined}
            >
              <td class:ro-mark={marked}>
                <input
                  type="checkbox"
                  data-row-checkbox
                  aria-label="Select {s.user_email}"
                  checked={selected.has(s.user_id)}
                  onchange={(e) => {
                    if ((e.currentTarget as HTMLInputElement).checked) selected.add(s.user_id);
                    else selected.delete(s.user_id);
                  }}
                />
              </td>
              <td class="ro-email-cell">{s.user_email}{#if marked}<span class="vh"> Failed: {reason}</span>{/if}</td>
              <td>{#if s.user_full_name}{s.user_full_name}{:else}<span class="ro-none">—</span>{/if}</td>
              {#if groupsEnabled}
                <td>
                  <select
                    class="ro-select"
                    aria-label="Group for {s.user_email}"
                    value={selectValueFor(s)}
                    disabled={pendingGroupId.has(s.user_id)}
                    onchange={(e) => onGroupChange(s, (e.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="__unassigned">Unassigned</option>
                    {#each groups as g (g.id)}
                      <option value={g.id}>{groupLabel(g)}{g.is_disabled ? ' · disabled' : ''}</option>
                    {/each}
                  </select>
                </td>
              {/if}
              <td class="ro-actions">
                <IconButton
                  glyph="trash"
                  size="sm"
                  danger
                  title="Remove from run"
                  aria-label="Remove {s.user_email}"
                  data-action="delete-student"
                  bind:element={trashEls[s.user_id]}
                  onclick={() => askRemove(s.user_id)}
                />
              </td>
            </tr>
            {#if pendingDelete === s.user_id}
              <tr class="ro-confirm-row">
                <td colspan={colCount}>
                  <InlineConfirm
                    row
                    takeFocus
                    warning="Remove {s.user_email} from this run?"
                    confirmLabel="Remove"
                    confirmDataAction="confirm-delete-student"
                    onConfirm={() => confirmRemove(s.user_id)}
                    onCancel={() => cancelRemove(s.user_id)}
                  />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if students.length === 0}
    <EmptyState title="No students yet.">
      {#snippet action()}
        <span class="ro-empty-links">
          <button
            type="button"
            class="ro-link"
            data-action="open-import-link"
            disabled={!runIsPublished}
            title={runIsPublished ? undefined : draftTitle}
            aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
            onclick={openImportFromLink}
          >Import roster</button>
          <button
            type="button"
            class="ro-link"
            data-action="open-add-link"
            disabled={!runIsPublished}
            title={runIsPublished ? undefined : draftTitle}
            aria-describedby={runIsPublished ? undefined : DRAFT_HINT_ID}
            onclick={openAdd}
          >Add student</button>
        </span>
      {/snippet}
    </EmptyState>
  {:else if visible.length === 0}
    <p class="ro-nomatch">
      {#if rosterPrefilter === 'unassigned'}
        No students are unassigned.
        <button type="button" class="ro-link" data-action="clear-prefilter-link" onclick={clearPrefilter}>Clear filter</button>.
      {:else}
        No students match '{search}'.
        <button type="button" class="ro-link" data-action="clear-search-link" onclick={clearSearch}>Clear search</button>.
      {/if}
    </p>
  {/if}
</section>

<style>
  .ro-tab { display: flex; flex-direction: column; gap: 10px; }

  /* The 6a info precondition banner. */
  .ro-info {
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: 0 var(--radius) var(--radius) 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .ro-link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--primary);
    text-decoration: underline;
    cursor: pointer;
  }
  .ro-link:disabled { color: var(--faint); text-decoration: none; cursor: not-allowed; }

  .ro-toolbar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .ro-tools-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  /* R40: native fields in the 6a field style (RunTeachersTab's .t-input). */
  .ro-input {
    box-sizing: border-box;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
  }
  .ro-input[aria-invalid='true'] { border-color: var(--danger); }
  .ro-search { width: 230px; max-width: 100%; }
  .ro-email { flex: 1 1 240px; min-width: 0; max-width: 360px; }
  .ro-select {
    box-sizing: border-box;
    height: 26px;
    max-width: 100%;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
  }
  .ro-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 4px 0 10px;
    border-radius: 13px;
    background: var(--surface-2);
    font-size: 12px;
    color: var(--text-3);
  }
  .ro-chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .ro-chip-x:hover { background: var(--border); color: var(--text); }

  /* D25: the 6a add-row look. */
  .ro-add {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .ro-err { margin: 0; font-size: 12px; color: var(--danger); }

  .ro-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--primary-soft);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .ro-count { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .ro-text-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer;
  }
  .ro-text-btn:hover { text-decoration: underline; }
  .ro-clear { margin-left: auto; }

  /* The result banner: info while in flight, the accepted tint on success,
     the 6a warning banner for a partial or cancelled op. */
  .ro-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 12px;
    border-left: 3px solid var(--primary);
    border-radius: 0 var(--radius) var(--radius) 0;
    font-size: 12.5px;
  }
  .ro-banner-info { background: var(--surface-2); color: var(--text-2); }
  .ro-banner-ok {
    background: var(--status-accepted-bg);
    border-left-color: var(--success);
    color: var(--status-accepted-fg);
  }
  .ro-banner-warn {
    background: var(--status-needs-revision-bg);
    border-left-color: var(--gold);
    color: var(--status-needs-revision-fg);
  }
  .ro-banner-text { flex: 1 1 auto; min-width: 0; }
  /* Text-styled retries: the banner's colour, underlined. */
  .ro-retry {
    appearance: none;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .ro-dismiss { color: inherit; }

  /* The 6a table look; the wrapper scrolls sideways on a narrow window. */
  .ro-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .ro-table { width: 100%; min-width: 640px; border-collapse: collapse; }
  .ro-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .ro-table td {
    padding: 4px 12px;
    border-top: 1px solid var(--border-soft);
    font-size: 13px;
    color: var(--text);
    vertical-align: middle;
  }
  .ro-col-check { width: 26px; }
  .ro-col-name { width: 150px; }
  .ro-col-group { width: 172px; }
  .ro-col-actions { width: 30px; }
  .ro-actions { text-align: right; }
  .ro-selected { background: var(--primary-soft); }
  /* A row that failed its last bulk op: a 3px rule on its first cell. */
  .ro-mark { box-shadow: inset 3px 0 0 0 var(--danger); }
  .ro-email-cell { overflow-wrap: anywhere; }
  .ro-none { color: var(--muted); }
  .ro-confirm-row td { padding: 0 12px 10px; border-top: 0; }

  .ro-nomatch { margin: 0; font-size: 13px; color: var(--muted); }
  .ro-empty-links { display: inline-flex; gap: 16px; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
```

- [ ] **Step 4: Run the roster tests to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunRosterTab.table.svelte.test.ts src/tests/RunRosterTab.toolbar.svelte.test.ts src/tests/RunRosterTab.svelte.test.ts src/tests/RunRosterTab.draft-gate.svelte.test.ts src/tests/RunRosterTab.add-error.svelte.test.ts src/tests/RunRosterTab.bulk-banner.svelte.test.ts src/tests/RunRosterTab.bulk-core.svelte.test.ts src/tests/RunRosterTab.optimistic.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts > $SDD/tmp/t4-green.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/t4-green.log`
Expected: PASS, `exit 0`, no "Errors" / "Unhandled" line. The bulk files pass unchanged:
- the retry selects keep their hooks and `'99'` options;
- `tr.row-error` and the row `title` stay;
- the success text is unchanged; the partial text gains only the hover hint after "1 failed.", which their regexes allow.

- [ ] **Step 5: Gate rows**

In `frontend/scripts/visual-refresh-gate.sh`, section (al):

1. `FILES_6C` becomes

```zsh
FILES_6C=(
  src/components/runs/RunOverviewTab.svelte
  src/components/runs/RunRosterTab.svelte
)
```

2. Inside Task 3's `RunRosterTab` block, insert before its closing `fi` (the line after `none "RunRosterTab has no add-row form under the table (D25)" "\.add-row\.${H}"`):

```zsh
  d '\.ro-strip' '' 'display:flex' 'padding:8px 12px' 'background:var\(--primary-soft\)' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)'
  d '\.ro-count' '' 'font-size:12\.5px' 'font-weight:600'
  d '\.ro-banner' '' 'display:flex' 'padding:8px 12px' 'border-left:3px solid var\(--primary\)'
  d '\.ro-banner-info' '' 'background:var\(--surface-2\)' 'color:var\(--text-2\)'
  d '\.ro-banner-ok' '' 'background:var\(--status-accepted-bg\)' 'border-left-color:var\(--success\)' 'color:var\(--status-accepted-fg\)'
  d '\.ro-banner-warn' '' 'background:var\(--status-needs-revision-bg\)' 'border-left-color:var\(--gold\)' 'color:var\(--status-needs-revision-fg\)'
  d '\.ro-retry' '' 'text-decoration:underline' 'color:inherit'
  d '\.ro-table-wrap' '' 'overflow-x:auto' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)'
  chk "\.ro-table\.${H} th:where\(\.${H}\)" 'background:var\(--surface-2\)' 'font-size:12px' 'font-weight:600'
  chk "\.ro-table\.${H} td:where\(\.${H}\)" 'border-top:1px solid var\(--border-soft\)'
  d '\.ro-selected' '' 'background:var\(--primary-soft\)'
  d '\.ro-mark' '' 'box-shadow:inset 3px 0 0 0 var\(--danger\)'
  # Review Focus 3: a 254-character e-mail wraps inside its cell.
  d '\.ro-email-cell' '' 'overflow-wrap:anywhere'
  d '\.ro-none' '' 'color:var\(--muted\)'
  none "RunRosterTab pre-6c roster rules are gone" "\.(banner|bulk-banner(-[a-z]+)?|bulk-strip|prefilter-pill|row-error|roster-tab|roster-toolbar|linklike|empty|error)\.${H}"
  sweep RunRosterTab $H
```

3. Set `EXPECTED_CHECKS=1921` at `:90`. That is 1886 + 35:
- 31 declarations: `.ro-strip` 5, `.ro-count` 2, `.ro-banner` 3, `.ro-banner-info` 2, `.ro-banner-ok` 3, `.ro-banner-warn` 3, `.ro-retry` 2, `.ro-table-wrap` 4, `.ro-table th` 3, `.ro-table td` 1, `.ro-selected` 1, `.ro-mark` 1, `.ro-email-cell` 1, `.ro-none` 1;
- the old-rules `none` 1;
- the `sweep` 2.

`FILES_6C` gaining a file adds no check: `emoji_scan` and `colour_scan` are one check each over the whole list.

- [ ] **Step 6: Run the full checks**

Run the frontend tests, svelte-check and the gate exactly as Global Constraints › Commands give them.
Expected:
- vitest: `exit 0` and `0` Errors/Unhandled lines;
- svelte-check: 0 errors and 13 warnings;
- the gate: `VISUAL-REFRESH GATE: ALL PASS (1921 checks)`. The `emoji_scan` and `colour_scan` lines now cover `RunRosterTab`: no `×`, `→` or hex is left in it.

- [ ] **Step 7: Screenshots for the user**

Signed in as `dev@mathion.test`, open `http://localhost:5174/teaching/demo-course/runs/8?tab=roster`. Read from the page the `data-user-id` of the first two rows (A, B) and one enabled group id G from a row select's options. If run 8 has groups off, there is no move select: use the bulk-delete route below for the partial and success shots instead, through 🗑 and the confirm's Remove.

Before any click, set the mocks, so no request reaches the server:
- `agent-browser network route "**/api/runs/8/students/bulk-move" --body '{"results":[{"user_id":A,"status":"ok"},{"user_id":B,"status":"error","error_code":"capacity_reached","detail":null}],"summary":{"total":2,"ok":1,"error":1}}'` (A, B as numbers);
- `agent-browser network route "**/api/runs/8/students/bulk-delete" --body '{"results":[],"summary":{"total":0,"ok":0,"error":0}}'` (a safety net);
- `agent-browser network route "**/api/runs/8/students/A" --abort` and the same for B. These cover a stray row remove or group change on the two rows used.

The roster refetch after an op is a real GET; nothing changed on the server.

Shots (absolute paths in the 6c sdd dir, `t4-*.png`):
1. **The strip.** Check rows A and B, then 1280×800 and 1000×800.
2. **The bulk confirm.** Click the strip's 🗑, then 1280×800: "Remove 2 students from this run?". Click Cancel.
3. **A partial result.** Choose group G in the strip's select, then 1280×800 and 1000×800: the gold banner with the hover hint and "Retry 1 → group…", row B marked, A no longer selected.
4. **Success.** Unroute bulk-move, then route it again with both rows ok (`{"results":[{"user_id":A,"status":"ok"},{"user_id":B,"status":"ok"}],"summary":{"total":2,"ok":2,"error":0}}`). Dismiss, check A and B, choose G, then within 5 s 1280×800: the green banner.
5. **The row confirm.** Click row A's 🗑, then 1280×800: the confirm row under it. Click Cancel; never Remove.
6. **Narrow.** 700×800: the table scrolls sideways inside its frame.

Finally `agent-browser network unroute`.

Build the overlay (the 10b reference image beside each shot; same script shape as Task 3), open it with `--size-percent 60`, and wait for the user's OK. A marked row's tooltip is a native `title` that headless screenshots do not show; it is a browser-pass item.

- [ ] **Step 8: Review lanes**

Run the Opus (high) and Fable lanes on the uncommitted diff (`git diff`, plus the new test file). Give them the spec (§Roster, §Focus › Roster, §Testing › Roster, R38, R44, Review Focus 3–4), this task's text and the Global Constraints. Fix every Critical and Important finding; re-run both lanes after every fix until both are clean. Minors go to `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md` under "## Task 4 — Roster strip, banner and table". Log there too, found in the plan review: a failed row that the refetch no longer lists stays selected, so the strip counts a student no table row shows ("1 selected"); pre-existing, as today. And spec §Focus › Roster's "else the banner's first retry control" never fires (the strip is up whenever a retry control is): trim its wording in the Polish slice.

- [ ] **Step 9: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/RunRosterTab.svelte frontend/scripts/visual-refresh-gate.sh \
  docs/backlog/slice6c-teacher-overview-roster-panel-debt.md \
  frontend/src/tests/RunRosterTab.table.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(6c): Roster bulk strip, result banner, table and confirms (10b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Then the ledger line in `$SDD/progress.md`, memory, and wait for "go".

---

### Task 5: Drawer frame and progress view (R30, D27, D29, R36)

**Files:**
- Modify: `frontend/src/components/ui/Modal.svelte` (Props `:17-31`, the destructure `:38-52`, backdrop `:132`, panel `:136-146`, × `:149`, CSS after `.modal-panel` `:177-188`)
- Modify: `frontend/src/tests/support/ModalHarness.svelte` (props `:5-27`, the `<Modal>` call `:39-47`)
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte`:
  - header comment `:1-6`, imports `:8-28`, `canWrite` `:58`;
  - the discard state `:235-244`, `handleCancel` `:358-372`, `tryClose` / `discardAndClose` `:374-397`;
  - the Progress error `:442-444`, `handleKeydown` `:483-491`;
  - markup `:494-545` and `:760-772`, styles `:775-785`.
- Create: `frontend/src/components/runs/ProgressBreakdown.svelte`
- Modify: `frontend/src/lib/dashboards.ts` (after `SequenceItemStateResponse`, `:180-184`)
- Modify: `frontend/scripts/visual-refresh-gate.sh`:
  - (aa) `:4084-4090`;
  - `colour_scan`'s `ALLOWED` `:4261-4263`;
  - section (al): its end, and `FILES_6C`;
  - `EXPECTED_CHECKS` `:90`.
- Test: `frontend/src/tests/Modal.svelte.test.ts`, `frontend/src/tests/DashboardSidePanel.svelte.test.ts`, `frontend/src/tests/dashboards.test.ts`, `frontend/src/tests/RunSubmissionTab.svelte.test.ts` (`:343-357`), `frontend/src/tests/RunProgressTab.svelte.test.ts` (`:352-374`)
- Create: `frontend/src/tests/ProgressBreakdown.svelte.test.ts`

**Interfaces:**
- **Consumes:**
  - `ui/Modal` (`labelledby`, `width`, `closeDisabled`, `bodyInert`, `autofocusSelector`, `header` / `footer` snippets);
  - `ui/InlineConfirm` (`row`, `takeFocus`, `confirmDataAction`);
  - `course/ItemMark` (`type`, `state`);
  - `lib/focusFirst.focusFirst`;
  - `STATUS_SHORT_LABEL`;
  - section (al) and `FILES_6C` (Task 1, holding `RunOverviewTab` and `RunRosterTab` by now).
- **Produces:**
  - `Modal`: `placement?: 'center' | 'right'` (default `'center'`) and `closeTitle?: string`.
  - `ProgressBreakdown.svelte` with props `{ items: SequenceItemState[] }`.
  - `lib/dashboards.ts`: `type DrillItemType`, `ITEM_TYPE_NAME`, `drillItemType(t)`.
  - Inside `DashboardSidePanel`:
    - `uid`, `titleId`, `titleEl`, `discardEl`, `panelEl()`, `closeX()`;
    - `askDiscard(source)`, `discard()`, `cancelDiscard()`;
    - the derived `title` and `subtitle`;
    - the `head` and `discardFooter` snippets.
  - In the panel test: `closeX()`, `panelTitle()`, `discardCancel()`, `discardConfirm()`, `pickResult(value)`, `typeFeedback(text)`, `NEEDS_REVISION_EVAL`.
  - The gate's `uniq1 sp-title` block (`N=DashboardSidePanel`).

- [ ] **Step 1: Write the failing tests**

1. `frontend/src/tests/support/ModalHarness.svelte`: in the props destructure, after `withHiddenFile = false,` add

```ts
    placement = 'center',
    closeTitle = undefined,
```

and in its type, after `withHiddenFile?: boolean;`, add

```ts
    placement?: 'center' | 'right';
    closeTitle?: string;
```

and in the `<Modal …>` call, after `{bodyInert}`, add

```svelte
  {placement}
  {closeTitle}
```

2. Append to `frontend/src/tests/Modal.svelte.test.ts`:

```ts
describe('Modal — right placement (6c R30)', () => {
  it('centre is the default: no right modifier', () => {
    render();
    expect(backdrop().classList.contains('right')).toBe(false);
    expect(panel().classList.contains('right')).toBe(false);
  });

  it('placement="right" marks the backdrop and the panel; a backdrop click still does nothing', () => {
    const p = render({ placement: 'right' });
    expect(backdrop().classList.contains('right')).toBe(true);
    expect(panel().classList.contains('right')).toBe(true);
    backdrop().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('closeTitle is the × title only while closeDisabled; its name stays "Close"', () => {
    const p = render({ closeTitle: 'Wait for the save to finish' });
    expect(closeBtn().getAttribute('title')).toBe('Close');
    p.closeDisabled = true;
    flushSync();
    expect(closeBtn().getAttribute('title')).toBe('Wait for the save to finish');
    expect(closeBtn().getAttribute('aria-label')).toBe('Close');
    expect(closeBtn().disabled).toBe(true);
  });
});
```

3. In `frontend/src/tests/dashboards.test.ts`, add `ITEM_TYPE_NAME,` and `drillItemType,` to the import list (after `heatToken,`) and append:

```ts
describe('ITEM_TYPE_NAME / drillItemType (6c §Progress variant)', () => {
  it('names the four drill-down item types', () => {
    expect(ITEM_TYPE_NAME).toEqual({
      static_page: 'Page', video: 'Video', quiz: 'Quiz', interactive_app: 'Interactive app',
    });
  });
  it('narrows a known type and refuses anything else (P55)', () => {
    expect(drillItemType('quiz')).toBe('quiz');
    expect(drillItemType('static_page')).toBe('static_page');
    expect(drillItemType('mini_project')).toBeNull();
    expect(drillItemType('toString')).toBeNull();
  });
});
```

4. Create `frontend/src/tests/ProgressBreakdown.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ProgressBreakdown from '../components/runs/ProgressBreakdown.svelte';
import type { SequenceItemState } from '../lib/dashboards';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

function item(o: Partial<SequenceItemState> = {}): SequenceItemState {
  return {
    item_id: 1, item_order: 1, item_title: 'Item One', item_type: 'static_page',
    is_covered: true, last_score: null, last_visited_at: null, ...o,
  };
}

function render(items: SequenceItemState[]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(ProgressBreakdown, { target: host, props: { items } });
  flushSync();
}

const rows = () => Array.from(host.querySelectorAll<HTMLElement>('li.pb-row'));

describe('ProgressBreakdown (6c §Progress variant)', () => {
  it('one Items card, named by its <h3>, with one row per item in order', () => {
    render([item({ item_id: 1, item_title: 'First' }), item({ item_id: 2, item_title: 'Second' })]);
    const card = host.querySelector('section.pb-card') as HTMLElement;
    const h = document.getElementById(card.getAttribute('aria-labelledby')!)!;
    expect(h.tagName).toBe('H3');
    expect(h.textContent).toBe('Items');
    expect(rows().map((r) => r.querySelector('.pb-name')!.textContent)).toEqual(['First', 'Second']);
  });

  it('each row: the ItemMark of its state, the hidden state word and the readable type name', () => {
    render([
      item({ item_id: 1, item_type: 'static_page', is_covered: true }),
      item({ item_id: 2, item_type: 'video', is_covered: false }),
      item({ item_id: 3, item_type: 'quiz', is_covered: false }),
      item({ item_id: 4, item_type: 'interactive_app', is_covered: true }),
    ]);
    const r = rows();
    expect(r[0]!.querySelector('.item-mark')!.classList.contains('covered')).toBe(true);
    expect(r[1]!.querySelector('.item-mark')!.classList.contains('not-yet')).toBe(true);
    expect(r.map((x) => x.querySelector('.pb-sr')!.textContent)).toEqual(['covered', 'not covered', 'not covered', 'covered']);
    expect(r.map((x) => x.querySelector('.pb-type')!.textContent)).toEqual(['Page', 'Video', 'Quiz', 'Interactive app']);
    // The quiz mark is ItemMark's quiz glyph (its own stroke width).
    expect(r[2]!.querySelector('.item-mark svg')!.getAttribute('stroke-width')).toBe('1.9');
  });

  it('an unknown type gets an empty 22px box and its raw name', () => {
    render([item({ item_type: 'mini_project' })]);
    const r = rows()[0]!;
    expect(r.querySelector('.item-mark')).toBeNull();
    expect(r.querySelector('span.pb-nomark[aria-hidden="true"]')).not.toBeNull();
    expect(r.querySelector('.pb-type')!.textContent).toBe('mini_project');
  });

  it('the last score shows as "3/4"; no score, no score cell', () => {
    render([item({ item_id: 1, last_score: { correct: 3, total: 4 } }), item({ item_id: 2, last_score: null })]);
    expect(rows()[0]!.querySelector('.pb-score')!.textContent).toBe('3/4');
    expect(rows()[1]!.querySelector('.pb-score')).toBeNull();
  });
});
```

5. `frontend/src/tests/DashboardSidePanel.svelte.test.ts`:

   **a. Helpers.** After `evalCalls` (`:80`) add:

```ts
// The drawer's frame (6c D27): Modal's ×, the dialog's title, the footer confirm.
const closeX = () => host.querySelector('.modal-head button[aria-label="Close"]') as HTMLButtonElement;
function panelTitle(): HTMLElement | null {
  const dialog = host.querySelector('section.modal-panel') as HTMLElement;
  return document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
}
const discardCancel = () => host.querySelector<HTMLButtonElement>('footer.modal-foot .inline-confirm button.cancel');
const discardConfirm = () => host.querySelector<HTMLButtonElement>('footer.modal-foot button.confirm[data-action="confirm-discard"]');

// Picks the Result.
function pickResult(value: string) {
  const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

// Types into Feedback with focus in it (makes the form dirty).
async function typeFeedback(text: string) {
  const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
  textarea.focus();
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return textarea;
}

const NEEDS_REVISION_EVAL = {
  id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' },
  result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true,
};
```

   **b. Tests 4 and 5** (`:277`, `:285`). Replace both `'Item details unavailable. The dashboard may be out of date — Refresh.'` with `'Item details unavailable. The dashboard may be out of date — close this panel and refresh the table.'`.

   **c. Test 6** (`:289-306`).
   - Its title becomes `'submission variant: renders the block title, group, submission, and evaluation details'`.
   - Replace `    expect(host.textContent).toContain('MP Alpha');` with `    expect(panelTitle()!.textContent).toBe('Block X');`.

   **d. Test 11** (`:351-360`). Replace the whole test with:

```ts
  // 11. D29: a click on the dimmed page does not close the panel
  it('backdrop click does nothing (D29)', () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    const { onClose } = mountPanel({ target: makeProgressTarget() });
    const backdrop = host.querySelector('div.modal-backdrop') as HTMLElement;
    expect(backdrop).toBeTruthy();
    backdrop.click();
    flushSync();
    expect(onClose).not.toHaveBeenCalled();
  });
```

   **e. Test 12** (`:366`). Replace `    const closeBtn = host.querySelector('[aria-label="Close panel"]') as HTMLButtonElement;` with `    const closeBtn = closeX();`.

   **f. T28b, T28c, T28d** (`:1218-1275`). Replace the three tests with:

```ts
  // T28b: dirty create + Escape → the footer confirm, focus on its Cancel, the body inert
  it('T28b: dirty create + Escape → the footer confirm; focus on its Cancel; the body inert', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    await typeFeedback('unsaved');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(host.querySelector('footer.modal-foot')!.textContent).toContain('Discard unsaved changes?');
    expect(discardConfirm()).toBeTruthy();
    expect(document.activeElement).toBe(discardCancel());
    expect(host.querySelector('.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  // T28c (D29): a click on the dimmed page does nothing, even with edits
  it('T28c: dirty + backdrop click → nothing (D29)', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    await typeFeedback('unsaved');
    (host.querySelector('div.modal-backdrop') as HTMLElement).click();
    await settle();
    expect(discardCancel()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  // T28d: dirty + × → the footer confirm, focus on its Cancel
  it('T28d: dirty + × → the footer confirm; focus on its Cancel', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    await typeFeedback('unsaved');
    closeX().click();
    await settle();
    expect(discardConfirm()).toBeTruthy();
    expect(document.activeElement).toBe(discardCancel());
  });
```

   **g. T8FIX** (`:1350`). Replace `    const closeBtn = host.querySelector('[data-side-panel-close]') as HTMLButtonElement;` with `    const closeBtn = closeX();`.

   **h. Append** after the file's last line:

```ts
// --- 6c Task 5: the drawer frame, the header, the discard footer, Progress ---

describe('DashboardSidePanel — drawer frame (6c T5)', () => {
  it('renders inside a 520px .modal-panel.right, named by its <h2> title (D27, R30)', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }) });
    await settle();
    const panel = host.querySelector('section.modal-panel') as HTMLElement;
    expect(panel.classList.contains('right')).toBe(true);
    expect(host.querySelector('div.modal-backdrop')!.classList.contains('right')).toBe(true);
    expect(panel.style.getPropertyValue('--modal-w')).toBe('520px');
    expect(panel.getAttribute('aria-label')).toBeNull();
    const title = panelTitle()!;
    expect(title.tagName).toBe('H2');
    expect(title.getAttribute('tabindex')).toBe('-1');
  });

  it('submission header: the block title, the group, and the short status badge', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }) });
    await settle();
    expect(panelTitle()!.textContent).toBe('Block X');
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('G7');
    const badge = host.querySelector('.modal-head .status-badge') as HTMLElement;
    expect(badge.textContent).toBe('awaiting eval');
    expect(badge.getAttribute('data-status')).toBe('awaiting_eval');
  });

  it('progress header: "Item details" while loading, no subtitle, no badge', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never resolves */ })));
    mountPanel({ target: makeProgressTarget() });
    expect(panelTitle()!.textContent).toBe('Item details');
    expect(host.querySelector('.modal-head .sp-sub')).toBeNull();
    expect(host.querySelector('.modal-head .status-badge')).toBeNull();
    expect(host.textContent).toContain('Loading…');
  });

  it('progress header after the load: the student and "Block — Sequence"', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse()));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(panelTitle()!.textContent).toBe('Alice');
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('B1 — S1');
  });

  it('progress header: the e-mail when the student has no name', async () => {
    const body = makeItemsResponse();
    vi.stubGlobal('fetch', mockFetch(200, { ...body, student: { ...body.student, full_name: null } }));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(panelTitle()!.textContent).toBe('alice@test.com');
  });

  it('progress header after an error stays "Item details"', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { detail: 'boom' }));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    expect(panelTitle()!.textContent).toBe('Item details');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('close this panel and refresh the table.');
  });

  it('the Items card: ItemMark rows with the readable type name and the score', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makeItemsResponse([
      { item_id: 1, item_order: 1, item_title: 'Item One', item_type: 'static_page', is_covered: true, last_score: null, last_visited_at: null },
      { item_id: 2, item_order: 2, item_title: 'Check', item_type: 'quiz', is_covered: false, last_score: { correct: 3, total: 4 }, last_visited_at: null },
    ])));
    mountPanel({ target: makeProgressTarget() });
    await settle();
    const rows = host.querySelectorAll('li.pb-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.item-mark')!.classList.contains('covered')).toBe(true);
    expect(rows[0]!.textContent).toContain('Page');
    expect(rows[1]!.querySelector('.item-mark')!.classList.contains('not-yet')).toBe(true);
    expect(rows[1]!.textContent).toContain('Quiz');
    expect(rows[1]!.textContent).toContain('3/4');
  });

  it('nothing closes while a save runs; × is disabled with "Wait for the save to finish"', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ submissions: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      return new Promise<Response>(() => { /* the save never answers */ });
    }));
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    flushSync();
    expect(closeX().disabled).toBe(true);
    expect(closeX().getAttribute('title')).toBe('Wait for the save to finish');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    closeX().click();
    flushSync();
    expect(onClose).not.toHaveBeenCalled();
    expect(discardCancel()).toBeNull();
  });

  it('× while the confirm shows focuses its Cancel and keeps the confirm', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    closeX().click();
    await settle();
    expect(document.activeElement).toBe(discardCancel());
    closeX().focus();
    closeX().click();
    await settle();
    expect(discardConfirm()).toBeTruthy();
    expect(document.activeElement).toBe(discardCancel());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc on the confirm\'s Cancel closes it; focus returns to the field focused when it opened', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    const textarea = await typeFeedback('unsaved');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    const cancel = discardCancel()!;
    expect(document.activeElement).toBe(cancel);
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(discardCancel()).toBeNull();
    expect(host.querySelector('.modal-body')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('R36: a dirty edit → Cancel → Discard ends the edit; the panel stays; focus on Edit', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'needs_revision', latest_evaluation: NEEDS_REVISION_EVAL }),
      isAdmin: true,
    });
    await settle();
    (host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement).click();
    await settle();
    await typeFeedback('Changed');
    (host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(discardCancel());
    discardConfirm()!.click();
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(discardCancel()).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button[data-test="edit-evaluation"]'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('R36: a dirty edit → × → Discard closes the panel', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'needs_revision', latest_evaluation: NEEDS_REVISION_EVAL }),
      isAdmin: true,
    });
    await settle();
    (host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement).click();
    await settle();
    await typeFeedback('Changed');
    closeX().click();
    await settle();
    discardConfirm()!.click();
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('R36: a dirty create → Esc → Discard closes the panel', async () => {
    const { onClose } = mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), isAdmin: true });
    await settle();
    await typeFeedback('unsaved');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    discardConfirm()!.click();
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

6. `frontend/src/tests/RunSubmissionTab.svelte.test.ts`, test "cell click: opens DashboardSidePanel (role=dialog) with submission target". Replace

```ts
    expect(panel!.getAttribute('aria-label')).toBe('Submission details');
    // mp.title and group_name from submissionMock should appear in the panel
    expect(panel!.textContent).toContain('Mini project for Block 1');
    expect(panel!.textContent).toContain('G1');
```

with

```ts
    // The dialog is named by its <h2>, the block title (6c D27, 6a D6).
    const title = document.getElementById(panel!.getAttribute('aria-labelledby')!);
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('B1');
    expect(panel!.textContent).toContain('G1');
```

7. `frontend/src/tests/RunProgressTab.svelte.test.ts`, test "cell click: opens DashboardSidePanel (role=dialog) with progress target". Replace

```ts
    expect(panel!.getAttribute('aria-label')).toBe('Item-level breakdown');
```

with

```ts
    // Named by its <h2>: the student once the drill-down has loaded (6c §Progress variant).
    expect(document.getElementById(panel!.getAttribute('aria-labelledby')!)?.textContent).toBe('Alice');
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/Modal.svelte.test.ts src/tests/ProgressBreakdown.svelte.test.ts src/tests/dashboards.test.ts src/tests/DashboardSidePanel.svelte.test.ts src/tests/RunSubmissionTab.svelte.test.ts src/tests/RunProgressTab.svelte.test.ts`

Expected: FAIL.
- `Modal`: two new tests fail (no `right` class, × keeps "Close"); "centre is the default" passes.
- `ProgressBreakdown`: the file cannot import the component.
- `dashboards`: the two new tests fail, because `ITEM_TYPE_NAME` and `drillItemType` are undefined.
- `DashboardSidePanel`:
  - tests 4, 5, 6, 11, 12, T28b, T28c, T28d and T8FIX fail;
  - every new "drawer frame" test fails (no `.modal-panel`, no `.modal-head` ×, no `footer.modal-foot`).
- The `RunSubmissionTab` and `RunProgressTab` panel tests fail: no `aria-labelledby`.

- [ ] **Step 3: Modal's right placement (R30)**

In `frontend/src/components/ui/Modal.svelte`:

1. In `type Props`, replace

```ts
    bodyInert?: boolean;
    header: Snippet;
```

with

```ts
    bodyInert?: boolean;
    // Slice-6c R30: `right` docks the panel to the right edge as a full-height
    // drawer (the side panel, 9b); `maxHeight` is ignored there. `closeTitle`
    // is ×'s title while `closeDisabled`, saying what the panel waits for.
    placement?: 'center' | 'right';
    closeTitle?: string;
    header: Snippet;
```

2. In the destructure, replace

```ts
    bodyInert = false,
    header,
```

with

```ts
    bodyInert = false,
    placement = 'center',
    closeTitle = undefined,
    header,
```

3. Replace the backdrop's opening tag

```svelte
<div class="modal-backdrop" role="presentation" onmousedown={onBackdropMousedown} onclick={onBackdropClick}>
```

with

```svelte
<div
  class="modal-backdrop"
  class:right={placement === 'right'}
  role="presentation"
  onmousedown={onBackdropMousedown}
  onclick={onBackdropClick}
>
```

4. In the `<section>`, replace `      class="modal-panel"` with

```svelte
      class="modal-panel"
      class:right={placement === 'right'}
```

5. Replace the × line

```svelte
        <IconButton id={closeId} glyph="close" size="md" title="Close" aria-label="Close" disabled={closeDisabled} onclick={onRequestClose} />
```

with

```svelte
        <IconButton
          id={closeId}
          glyph="close"
          size="md"
          title={closeDisabled && closeTitle ? closeTitle : 'Close'}
          aria-label="Close"
          disabled={closeDisabled}
          onclick={onRequestClose}
        />
```

6. In `<style>`, right after the `.modal-panel { … }` rule (it ends with `box-shadow: 0 16px 44px rgba(20,24,35,.22); /* ref 1684 */` and `}`), insert:

```css
  /* R30: the drawer (9b) — full height at the right edge, square, its left
     edge drawn. The centre rules above stay as they are (gate (aa)). */
  .modal-backdrop.right {
    justify-content: flex-end;
    align-items: stretch;
    padding: 0;
  }
  .modal-panel.right {
    width: min(var(--modal-w), 100vw);
    height: 100dvh;
    max-height: none;
    border-radius: 0;
    border: 0;
    border-left: 1px solid var(--border-strong);
    box-shadow: -14px 0 40px rgba(20,24,35,.22); /* 9b's edge, the shadow colour above */
  }
```

esbuild emits these as `.modal-backdrop.right.svelte-H{justify-content:flex-end;align-items:stretch;padding:0}` and `.modal-panel.right.svelte-H{width:min(var(--modal-w),100vw);height:100dvh;max-height:none;border-radius:0;border:0;border-left:1px solid var(--border-strong);box-shadow:-14px 0 40px #14182338}` (checked on a probe copy while planning).

- [ ] **Step 4: `ITEM_TYPE_NAME` and `ProgressBreakdown`**

1. In `frontend/src/lib/dashboards.ts`, right after the `SequenceItemStateResponse` interface (before `// ---- Wire functions ----`), add:

```ts
// The drill-down's item types and their readable names (6c §Progress variant);
// `static_page` reads "Page", its authoring name.
export type DrillItemType = 'static_page' | 'video' | 'quiz' | 'interactive_app';

export const ITEM_TYPE_NAME: Record<DrillItemType, string> = {
  static_page: 'Page',
  video: 'Video',
  quiz: 'Quiz',
  interactive_app: 'Interactive app',
};

// Narrows the wire's `item_type` before it reaches ItemMark; anything else is
// null (an own key only, so "toString" is not a type).
export function drillItemType(t: string): DrillItemType | null {
  return Object.prototype.hasOwnProperty.call(ITEM_TYPE_NAME, t) ? (t as DrillItemType) : null;
}
```

2. Create `frontend/src/components/runs/ProgressBreakdown.svelte`:

```svelte
<script lang="ts">
  import ItemMark from '../course/ItemMark.svelte';
  import { ITEM_TYPE_NAME, drillItemType, type SequenceItemState } from '../../lib/dashboards';

  // The Progress drawer's Items card (6c §Progress variant): per item its type
  // mark (covered or not yet), the title, a hidden coverage word, the readable
  // type name and the last score. The panel keeps loading, error and empty.
  let { items }: { items: SequenceItemState[] } = $props();

  const uid = $props.id();
</script>

<section class="pb-card" aria-labelledby="{uid}-items">
  <div class="pb-head"><h3 class="pb-title" id="{uid}-items">Items</h3></div>
  <ol class="pb-list">
    {#each items as it (it.item_id)}
      {@const type = drillItemType(it.item_type)}
      <li class="pb-row">
        {#if type}
          <ItemMark {type} state={it.is_covered ? 'covered' : 'not-yet'} />
        {:else}
          <span class="pb-nomark" aria-hidden="true"></span>
        {/if}
        <span class="pb-text">
          <span class="pb-name">{it.item_title}</span>
          <span class="pb-sr">{it.is_covered ? 'covered' : 'not covered'}</span>
          <span class="pb-type">{type ? ITEM_TYPE_NAME[type] : it.item_type}</span>
        </span>
        {#if it.last_score}
          <span class="pb-score">{it.last_score.correct}/{it.last_score.total}</span>
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .pb-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
  }
  .pb-head {
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .pb-title {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .pb-list { margin: 0; padding: 0; list-style: none; }
  .pb-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border-soft);
  }
  .pb-row:last-child { border-bottom: 0; }
  /* An unknown type: ItemMark's empty 22px box. */
  .pb-nomark {
    box-sizing: border-box;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .pb-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .pb-name { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .pb-type { font-size: 11.5px; color: var(--muted); }
  .pb-score {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }
  .pb-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
```

- [ ] **Step 5: The panel on Modal (D27, D29, R36)**

In `frontend/src/components/runs/DashboardSidePanel.svelte` (each "old" block occurs once; the body between the replaced frame lines keeps its indentation until Task 6 rewrites the file):

1. Replace the header comment

```svelte
<!--
  Slide-in side drawer (NOT centered modal). Width: min(640px, 90vw).
  Pattern: peek-and-back-to-list, not focused-edit. Deliberate divergence
  from the existing modal pattern; see spec §6.5 line 1304.
-->
```

with

```svelte
<!--
  The grading / progress side panel (9b): a 520px drawer on ui/Modal at the
  right edge (6c D27, R30). × and Esc close it; a click on the dimmed page
  does not (D29).
-->
```

2. Imports:
   - Replace `    resultToStatus,\n    type MpGroupStatus,` with `    resultToStatus,\n    STATUS_SHORT_LABEL,\n    type MpGroupStatus,`.
   - Replace `  import FocusTrap from '../ui/FocusTrap.svelte';` with:

```ts
  import ProgressBreakdown from './ProgressBreakdown.svelte';
  import Modal from '../ui/Modal.svelte';
```

   - After `  import { formatFileSize } from '../../lib/format';` add `  import { focusFirst } from '../../lib/focusFirst';`.

3. After `  const canWrite = $derived(isAdmin || isTeacher);` insert:

```ts

  const uid = $props.id();
  const titleId = `${uid}-title`;
  let titleEl = $state<HTMLElement>();
  let discardEl = $state<HTMLElement>();
  // Modal owns the panel and ×; the panel finds them from its title.
  const panelEl = () => titleEl?.closest<HTMLElement>('.modal-panel') ?? null;
  const closeX = () => panelEl()?.querySelector<HTMLButtonElement>('.modal-head button[aria-label="Close"]') ?? null;
```

4. Replace

```ts
  let confirmDiscard = $state(false);

  $effect(() => {
    if (confirmDiscard) {
      tick().then(() => {
        const btn = document.querySelector('.inline-confirm button') as HTMLButtonElement | null;
        btn?.focus();
      });
    }
  });
```

with

```ts
  // The discard confirm in Modal's footer. R36: Discard after the form's
  // Cancel ends the edit; after × or Esc it closes the panel. Cancel returns
  // focus to where it was when the confirm opened.
  let confirmDiscard = $state(false);
  let discardSource: 'cancel' | 'close' = 'close';
  let discardReturnEl: HTMLElement | null = null;

  function askDiscard(source: 'cancel' | 'close') {
    discardSource = source;
    discardReturnEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmDiscard = true;
  }
```

5. In `handleCancel`, replace

```ts
    if (isDirty) {
      confirmDiscard = true;
      return;
    }
    editing = false;
```

with

```ts
    if (isDirty) {
      askDiscard('cancel');
      return;
    }
    editing = false;
```

6. Replace `tryClose` and `discardAndClose` (`:374-397`) with:

```ts
  function tryClose() {
    if (submitting) return;
    // × (or Esc on ×) while the confirm asks: go to its Cancel, don't ask twice.
    if (confirmDiscard) {
      discardEl?.querySelector<HTMLButtonElement>('button.cancel')?.focus();
      return;
    }
    if (isDirty) {
      askDiscard('close');
      return;
    }
    onClose();
  }

  function discard() {
    confirmDiscard = false;
    if (discardSource === 'close') {
      onClose();
      return;
    }
    editing = false;
    formResult = '';
    formScore = null;
    formFeedbackText = '';
    formFeedbackFile = null;
    fileError = null;
    prefillSnapshot = null;
    formSubmitAttempted = false;
    tick().then(() => {
      focusFirst([panelEl()?.querySelector<HTMLElement>('button[data-test="edit-evaluation"]')]);
    });
  }

  async function cancelDiscard() {
    confirmDiscard = false;
    await tick();
    focusFirst([
      discardReturnEl,
      panelEl()?.querySelector<HTMLElement>('select[name="evaluation-result"]'),
      closeX(),
    ]);
  }
```

7. In the Progress fetch, replace

```ts
        // Spec §6.5 line 1322: "Fetch error (incl. 404)" → uniform message
        // for ALL fetch errors (404 not split from other errors).
        error = 'Item details unavailable. The dashboard may be out of date — Refresh.';
```

with

```ts
        // One message for every fetch error, 404 included.
        error = 'Item details unavailable. The dashboard may be out of date — close this panel and refresh the table.';
```

8. Replace the `handleKeydown` block and the closing tag:

```ts
  // Escape handled via svelte:window per spec §6.5 line 1300 (matches the
  // RosterImportModal.svelte:111-116 pattern). FocusTrap handles Tab/Shift+Tab
  // cycling + previousFocus restore on unmount.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      tryClose();
    }
  }
</script>
```

with

```ts
  // The header: the block title (6a D6) and the group for a submission; the
  // student and "{Block} — {Sequence}" for progress, "Item details" until
  // they load, so the dialog is always named.
  const title = $derived(
    target.kind === 'submission'
      ? target.mp.block_title
      : data
        ? (data.student.full_name ?? data.student.email)
        : 'Item details',
  );
  const subtitle = $derived(
    target.kind === 'submission'
      ? target.entry.group_name
      : data
        ? `${data.sequence.block_title} — ${data.sequence.sequence_title}`
        : '',
  );
</script>
```

9. Replace the markup from `<svelte:window onkeydown={handleKeydown} />` (`:494`) through the submission header and its badge (`:545`, the blank line after `<StatusBadge status={panelStatus} />`). That is everything from the window tag to just before `      {#if newest == null}`. The replacement:

```svelte
{#snippet head()}
  <div class="sp-titles">
    <h2 class="sp-title" id={titleId} tabindex="-1" bind:this={titleEl}>{title}</h2>
    {#if subtitle}<p class="sp-sub">{subtitle}</p>{/if}
  </div>
  {#if target.kind === 'submission'}
    <StatusBadge status={panelStatus} label={STATUS_SHORT_LABEL[panelStatus]} />
  {/if}
{/snippet}

{#snippet discardFooter()}
  <div class="sp-discard" bind:this={discardEl}>
    <InlineConfirm
      row
      takeFocus
      warning="Discard unsaved changes?"
      confirmLabel="Discard"
      confirmDataAction="confirm-discard"
      onConfirm={discard}
      onCancel={cancelDiscard}
    />
  </div>
{/snippet}

<Modal
  placement="right"
  width={520}
  labelledby={titleId}
  closeDisabled={submitting}
  closeTitle="Wait for the save to finish"
  bodyInert={confirmDiscard}
  autofocusSelector={'select[name="evaluation-result"], .modal-head button[aria-label="Close"]'}
  onRequestClose={tryClose}
  header={head}
  footer={confirmDiscard ? discardFooter : undefined}
>
    {#if target.kind === 'progress'}
      {#if loading}
        <p class="sp-muted">Loading…</p>
      {:else if error}
        <p class="sp-error" role="alert">{error}</p>
      {:else if data}
        {#if data.items.length === 0}
          <p class="sp-muted">No items in this sequence.</p>
        {:else}
          <ProgressBreakdown items={data.items} />
        {/if}
      {/if}
    {:else}
```

10. Replace the end of the markup:

```svelte
    {#if confirmDiscard}
      <div class="discard-confirm">
        <InlineConfirm
          confirmLabel="Discard"
          warning="Discard unsaved changes?"
          onConfirm={discardAndClose}
          onCancel={() => (confirmDiscard = false)}
        />
      </div>
    {/if}
    <DirtyGuard isDirty={() => isDirty && !submitting} />
  </div>
</FocusTrap>
```

with

```svelte
    <DirtyGuard isDirty={() => isDirty && !submitting} />
</Modal>
```

11. In `<style>`, replace the first three rules

```css
  .panel-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100;
  }
  .dashboard-side-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: min(640px, 90vw);
    background: var(--bg, #fff); padding: 1.5rem;
    overflow-y: auto; z-index: 101;
    box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  }
  .panel-close { float: right; font-size: 1.5em; background: none; border: none; cursor: pointer; }
```

with

```css
  .sp-titles { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
  .sp-title {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .sp-sub {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .sp-muted { margin: 0; font-size: 13px; color: var(--muted); }
  /* The 6a error banner. */
  .sp-error {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .sp-discard { flex: 1 1 auto; font-size: 13px; color: var(--text-2); }
```

The other old rules (`.banner-info`, `.banner-error`, `.form-error`, `.helper-text`, `.sr-only`) stay until Task 6 (P46). `RunProgressTab.svelte` and `RunSubmissionTab.svelte` keep their panel calls unchanged.

- [ ] **Step 6: Run the tests**

Run the Step 2 command. Expected: PASS (all six files, exit 0, no "Errors" / "Unhandled" line). Then run the panel's other users: `TZ=Europe/Copenhagen npx vitest run src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts` → PASS.

- [ ] **Step 7: Gate rows**

In `frontend/scripts/visual-refresh-gate.sh`:

1. **(aa)** — replace

```zsh
  # Constraint 11: the ref-1684 shadow is the ONE hex allowed in Modal's rules.
  modal_rules=$(grep -oE "[^{}]*\.${H}[^{]*\{[^}]*\}" $CSS)
  if print -r -- "$modal_rules" | sed 's/box-shadow:0 16px 44px #14182338//g' | grep -qE '#[0-9a-fA-F]{3}'; then
    echo "FAIL  Modal no hex beyond the ref-1684 shadow"; fail=1
  else
    echo "PASS  Modal no hex beyond the ref-1684 shadow"
  fi
```

with

```zsh
  # Constraint 11 + 6c R30: the centre (ref 1684) and drawer (9b) shadows are
  # the only hex in Modal's rules.
  modal_rules=$(grep -oE "[^{}]*\.${H}[^{]*\{[^}]*\}" $CSS)
  if print -r -- "$modal_rules" | sed -e 's/box-shadow:0 16px 44px #14182338//g' -e 's/box-shadow:-14px 0 40px #14182338//g' | grep -qE '#[0-9a-fA-F]{3}'; then
    echo "FAIL  Modal no hex beyond its two shadows (ref 1684, 9b)"; fail=1
  else
    echo "PASS  Modal no hex beyond its two shadows (ref 1684, 9b)"
  fi
```

2. **`colour_scan`** (in (ag)) — replace

```python
# The one Modal literal the spec allows (Constraint 11), compared whitespace-free.
# The backdrop is color-mix(…var(--text)…transparent) — no literal, so no entry.
ALLOWED = {'Modal.svelte': {'box-shadow:0 16px 44px rgba(20,24,35,.22)'.replace(' ', '')}}
```

with

```python
# The two Modal literals the specs allow (5b Constraint 11, 6c R30), compared
# whitespace-free. The backdrop is color-mix(…var(--text)…transparent) — no
# literal, so no entry.
ALLOWED = {'Modal.svelte': {s.replace(' ', '') for s in (
    'box-shadow:0 16px 44px rgba(20,24,35,.22)',   # the centre panel (ref 1684)
    'box-shadow:-14px 0 40px rgba(20,24,35,.22)',  # the right drawer (9b)
)}}
```

3. **`FILES_6C`** — inside the array, after the last entry, add the line `  src/components/runs/ProgressBreakdown.svelte`.

4. **Section (al)** — append at its end, just before `# The summary line is the parent process's (see the re-exec at the top).`:

```zsh

# 6c T5 — the drawer (R30, D27, D29) and the Progress view.
uniq1 modal-panel
if [[ -n $REPLY ]]; then
  N=Modal; H=$REPLY
  d '\.modal-backdrop\.right' '' 'justify-content:flex-end' 'align-items:stretch' 'padding:0'
  d '\.modal-panel\.right' '' 'width:min\(var\(--modal-w\),100vw\)' 'height:100dvh' 'max-height:none' 'border-radius:0' 'border:0' 'border-left:1px solid var\(--border-strong\)' 'box-shadow:-14px 0 40px #14182338'
fi
none "DashboardSidePanel's own backdrop, dialog box and close button are gone (D27)" '\.(panel-backdrop|dashboard-side-panel|panel-close)\.svelte-'
SP=src/components/runs/DashboardSidePanel.svelte
if grep -qE '<svelte:window|FocusTrap|closeOnBackdrop' $SP; then
  echo "FAIL  DashboardSidePanel rides on Modal alone: no window keydown, no FocusTrap, no backdrop close (D27, D29)"; fail=1
else
  echo "PASS  DashboardSidePanel rides on Modal alone: no window keydown, no FocusTrap, no backdrop close (D27, D29)"
fi
if grep -q 'placement="right"' $SP; then
  echo "PASS  DashboardSidePanel opens Modal at the right edge (R30)"
else
  echo "FAIL  DashboardSidePanel opens Modal at the right edge (R30)"; fail=1
fi
own sp-title DashboardSidePanel.svelte
uniq1 sp-title
if [[ -n $REPLY ]]; then
  N=DashboardSidePanel; H=$REPLY
  d '\.sp-title' '' 'margin:0' 'font-size:14\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.sp-sub' '' 'font-family:var\(--font-mono\)' 'font-size:11\.5px' 'color:var\(--muted\)'
fi
own pb-card ProgressBreakdown.svelte
uniq1 pb-card
if [[ -n $REPLY ]]; then
  N=ProgressBreakdown; H=$REPLY
  d '\.pb-card' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden' 'background:var\(--surface\)'
  d '\.pb-head' '' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.pb-title' '' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.pb-row' '' 'display:flex' 'align-items:center' 'gap:9px' 'padding:9px 12px' 'border-bottom:1px solid var\(--border-soft\)'
  d '\.pb-nomark' '' 'width:22px' 'height:22px' 'border:1px solid var\(--border-strong\)'
  d '\.pb-score' '' 'margin-left:auto' 'font-family:var\(--font-mono\)'
  sweep ProgressBreakdown $H
fi
```

5. Set `EXPECTED_CHECKS=1968` (1921 + 47: Modal drawer `uniq1` 1 + 3 + 7 declarations = 11; the gone-classes `none` 1; two source checks 2; `sp-title` `own` 1 + `uniq1` 1 + 4 + 3 declarations = 9; `pb-card` `own` 1 + `uniq1` 1 + 4 + 3 + 3 + 5 + 3 + 2 declarations + `sweep` 2 = 24. The (aa) and `colour_scan` edits and the new `FILES_6C` entry add 0 lines).

- [ ] **Step 8: Run the full checks**

As Global Constraints › Commands. Expected:
- vitest green;
- svelte-check 0 errors, 13 warnings;
- gate `ALL PASS (1968 checks)`.

If a `.modal-*.right` row fails only on the emitted form, read the rule with `grep -oE '\.modal-panel\.right\.svelte-[a-z0-9]+\{[^}]*\}' dist/_app/*.css` and follow the head's minifier rule.

- [ ] **Step 9: Screenshots for the user**

Before any click, mock both evaluation writes with `agent-browser network route`:
- `"**/api/submissions/*/evaluation"`: status 201, `{"id":9001,"submission_id":1,"result":"accepted","score":null,"feedback_text":null,"has_feedback_file":false,"evaluated_at":"2026-10-13T10:00:00Z","evaluated_by":1}`;
- `"**/api/evaluations/*"`: status 200, the same body.

No Save is pressed in this task. Shots at 1280 and 1000:
1. `http://localhost:5174/teaching/demo-course/runs/8?tab=progress`, click a heatmap cell: the drawer with the student, "Block — Sequence" and the Items card.
2. `?tab=submissions`, click a cell with a submission: the drawer frame, its header (block title, group, short badge), with the body still old (P46).
3. In that drawer, type in Feedback and press Esc: the footer confirm "Discard unsaved changes?" with Cancel focused. Click Cancel, close with ×.
4. Click the dimmed page with the drawer open: nothing happens (a before/after pair).

Overlay with `ref/9b.png` beside the shots (`--size-percent 60`, images as base64); wait for the user's OK. Clear the routes.

- [ ] **Step 10: Review lanes**

Opus (high) + Fable on the uncommitted diff (including the new files). Point them at:
- R30's "centre rules unchanged" (gate (aa));
- R36;
- the discard focus rules of spec §Focus › Side panel.

Fix every Critical and Important finding and re-run both lanes after every fix until clean. Minors → backlog "## Task 5 — Drawer frame and progress view".

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/ui/Modal.svelte frontend/src/tests/support/ModalHarness.svelte \
  frontend/src/tests/Modal.svelte.test.ts frontend/src/components/runs/DashboardSidePanel.svelte \
  frontend/src/components/runs/ProgressBreakdown.svelte frontend/src/lib/dashboards.ts \
  frontend/src/tests/dashboards.test.ts frontend/src/tests/ProgressBreakdown.svelte.test.ts \
  frontend/src/tests/DashboardSidePanel.svelte.test.ts frontend/src/tests/RunSubmissionTab.svelte.test.ts \
  frontend/src/tests/RunProgressTab.svelte.test.ts frontend/scripts/visual-refresh-gate.sh
git commit -m "$(cat <<'EOF'
feat(6c): the side panel as a right-hand drawer on ui/Modal (R30, D27, D29, R36)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Add `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md` to the `git add` if the lanes left minors. Then the ledger line in `$SDD/progress.md`, memory, and wait for "go".

---

### Task 6: Submission cards and evaluation form (R35, R37, R43, R44, D26)

**Files:**
- Create: `frontend/src/components/runs/SubmissionCards.svelte`
- Modify (whole file): `frontend/src/components/runs/SubmissionThreadEntry.svelte`, `frontend/src/components/runs/DashboardSidePanel.svelte`
- Modify: `frontend/src/components/runs/RunSubmissionTab.svelte` (`blockPos` `:145`, the panel call `:294-300`)
- Modify: `frontend/src/components/ui/Button.svelte` (props, the `<button>` tag)
- Modify: `frontend/src/lib/dashboards.ts` (imports `:4`, the `STATUS_SHORT_LABEL` comment `:23-24`, after `resultToStatus` `:48-54`)
- Modify: `frontend/src/lib/datetime.ts` (after `formatShortDate`)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (al), `FILES_6C`, `EXPECTED_CHECKS`)
- Create: `frontend/src/tests/SubmissionCards.svelte.test.ts`, `frontend/src/tests/support/SubmissionCardsHarness.svelte`
- Test: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`, `frontend/src/tests/SubmissionThreadEntry.svelte.test.ts`, `frontend/src/tests/RunSubmissionTab.svelte.test.ts`, `frontend/src/tests/Button.svelte.test.ts`, `frontend/src/tests/dashboards.test.ts`, `frontend/src/tests/datetime.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 5's frame: `Modal placement="right"`, `closeTitle`, the `head` / `discardFooter` snippets, `askDiscard` / `discard` / `cancelDiscard`, `ProgressBreakdown`, and the test helpers `closeX`, `panelTitle`, `discardCancel`, `discardConfirm`, `pickResult`, `typeFeedback`, `NEEDS_REVISION_EVAL`.
  - Task 2's `Button 'aria-disabled'` (with `aria-busy` while `loading`).
  - Task 3's `IconButton href download` (it renders `<a href download>` named by `title`).
  - `lib/blockNumbers.blockPositions` (6a), `STATUS_SHORT_LABEL`, `resultToStatus`, `formatLocalWithTz`, `formatFileSize`, `focusFirst`.
- **Produces:**
  - `SubmissionCards.svelte` (module exports):
    - the snippets `submissionChips(sub)`, `submissionContent(sub)` and `evaluationContent(ev, evaluated)`;
    - `evaluatedLine(ev)`;
    - `type EvaluationView`.
  - `lib/dashboards.ts`: `RESULT_LABEL`, `resultLabel(result)`.
  - `lib/datetime.ts`: `formatLocalShortDate(iso)`.
  - `Button`: a `'data-test'` pass-through (P48).
  - `DashboardSidePanel`:
    - the prop `blockLabel?: string` (R35);
    - the `evaluationCard` and `evaluationForm(mode)` snippets;
    - the hooks `[data-test="evaluation-card"]`, `[data-action="attach-feedback-file"]` and `[data-action="remove-feedback-file"]`, plus `fieldset#evaluation-result` (a radiogroup).
  - `RunSubmissionTab`: `blockLabelOf(mp)`.
  - Panel test helpers: `resultRadio(value)`, `checkedResult()`, and `MountPanelOpts.blockLabel`.

- [ ] **Step 1: Write the failing tests**

1. `frontend/src/tests/datetime.test.ts`: add `formatLocalShortDate` to the import list (after `formatShortDate,`) and append:

```ts
describe('formatLocalShortDate (6c §Dates)', () => {
  it('a UTC instant as the local calendar date, mono-ready "DD Mon YYYY"', () => {
    expect(formatLocalShortDate('2026-08-02T10:00:00Z')).toBe('02 Aug 2026');
  });
  it('23:30 UTC is the next day in Copenhagen (CEST, Review Focus 5)', () => {
    expect(formatLocalShortDate('2026-08-01T23:30:00Z')).toBe('02 Aug 2026');
  });
  it('and across the year in winter (CET)', () => {
    expect(formatLocalShortDate('2026-12-31T23:30:00Z')).toBe('01 Jan 2027');
  });
});
```

2. `frontend/src/tests/dashboards.test.ts`: add `RESULT_LABEL,` and `resultLabel,` to the import list (after `drillItemType,`) and append:

```ts
describe('RESULT_LABEL / resultLabel (6c §Already evaluated)', () => {
  it('names each result in its own words', () => {
    expect(RESULT_LABEL).toEqual({
      accepted: 'Accepted',
      minor_revision: 'Minor revision',
      major_revision: 'Major revision',
      rejected: 'Rejected',
    });
  });
  it('maps a known result and shows anything else raw (P55)', () => {
    expect(resultLabel('minor_revision')).toBe('Minor revision');
    expect(resultLabel('surprise')).toBe('surprise');
    expect(resultLabel('toString')).toBe('toString');
  });
});
```

3. `frontend/src/tests/Button.svelte.test.ts`: append inside the top-level `describe('Button', …)` (before its closing `});`):

```ts
  it('forwards data-test (6c P48)', () => {
    expect(render({ 'data-test': 'edit-evaluation' }).getAttribute('data-test')).toBe('edit-evaluation');
  });

  it('omits data-test by default', () => {
    expect(render({}).hasAttribute('data-test')).toBe(false);
  });
```

4. Create `frontend/src/tests/support/SubmissionCardsHarness.svelte`:

```svelte
<script lang="ts">
  // Renders SubmissionCards' snippets on their own (6c T6).
  import {
    submissionChips,
    submissionContent,
    evaluationContent,
    type EvaluationView,
  } from '../../components/runs/SubmissionCards.svelte';
  import type { ThreadSubmissionBase } from '../../lib/dashboards';

  let { sub, ev = null, evaluated = '' }: {
    sub: ThreadSubmissionBase;
    ev?: EvaluationView | null;
    evaluated?: string;
  } = $props();
</script>

<div data-testid="chips">{@render submissionChips(sub)}</div>
<div data-testid="sub">{@render submissionContent(sub)}</div>
{#if ev}<div data-testid="ev">{@render evaluationContent(ev, evaluated)}</div>{/if}
```

5. Create `frontend/src/tests/SubmissionCards.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './support/SubmissionCardsHarness.svelte';
import { evaluatedLine } from '../components/runs/SubmissionCards.svelte';
import type { ThreadEvaluation, ThreadSubmissionBase } from '../lib/dashboards';
import { formatLocalWithTz } from '../lib/datetime';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

function sub(o: Partial<ThreadSubmissionBase> = {}): ThreadSubmissionBase {
  return {
    id: 42, submission_number: 3, submitted_at: '2026-06-01T10:00:00Z',
    submitted_by: { user_id: 5, full_name: 'Alice' },
    is_late: false, is_resubmission: false, file_size: 2_400_000, ...o,
  };
}

function ev(o: Partial<ThreadEvaluation> = {}): ThreadEvaluation {
  return {
    id: 11, evaluated_at: '2026-06-02T09:00:00Z', evaluated_by: { user_id: 3, full_name: 'Prof' },
    result: 'minor_revision', score: 72, feedback_text: 'Line 1\nLine 2', has_feedback_file: true, ...o,
  };
}

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(Harness, { target: host, props: props as { sub: ThreadSubmissionBase } });
  flushSync();
}

const part = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const rows = (el: Element) =>
  Array.from(el.querySelectorAll('dt')).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.trim()]);

describe('SubmissionCards — submissionChips', () => {
  it('no chips for a first, on-time submission', () => {
    render({ sub: sub() });
    expect(part('chips').querySelector('.sc-chip')).toBeNull();
    expect(part('chips').textContent!.trim()).toBe('');
  });
  it('"resubmission" and "late" chips when they apply', () => {
    render({ sub: sub({ is_resubmission: true, is_late: true }) });
    const chips = Array.from(part('chips').querySelectorAll('.sc-chip')).map((c) => c.textContent);
    expect(chips).toEqual(['resubmission', 'late']);
    expect(part('chips').querySelector('.sc-late')!.textContent).toBe('late');
  });
});

describe('SubmissionCards — submissionContent', () => {
  it('rows: Submitted (local, with zone), By, Number', () => {
    render({ sub: sub() });
    expect(rows(part('sub').querySelector('[data-test="submission-content"]')!)).toEqual([
      ['Submitted', formatLocalWithTz('2026-06-01T10:00:00Z')],
      ['By', 'Alice'],
      ['Number', '3'],
    ]);
  });
  it('By falls back to the user id, then to "—"', () => {
    render({ sub: sub({ submitted_by: { user_id: 5, full_name: null } }) });
    expect(rows(part('sub'))[1]).toEqual(['By', '5']);
    unmount(component!); component = null; host.remove();
    render({ sub: sub({ submitted_by: null, submitted_at: null }) });
    expect(rows(part('sub'))[0]).toEqual(['Submitted', '—']);
    expect(rows(part('sub'))[1]).toEqual(['By', '—']);
  });
  it('the file card (D26): "Submission 3", "PDF · 2.4 MB" and a download link', () => {
    render({ sub: sub() });
    const card = part('sub').querySelector('.sc-file') as HTMLElement;
    expect(card.querySelector('.sc-file-name')!.textContent).toBe('Submission 3');
    expect(card.querySelector('.sc-file-meta')!.textContent).toBe('PDF · 2.4 MB');
    const a = card.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/api/submissions/42/file');
    expect(a.hasAttribute('download')).toBe(true);
    expect(a.getAttribute('aria-label')).toBe('Download submission 3');
  });
});

describe('SubmissionCards — evaluationContent', () => {
  it('Result is a badge with the result\'s own label; Score; pre-wrapped Feedback; Evaluated', () => {
    const e = ev();
    render({ sub: sub(), ev: e, evaluated: evaluatedLine(e) });
    const box = part('ev').querySelector('[data-test="evaluation-content"]') as HTMLElement;
    const badge = box.querySelector('.status-badge') as HTMLElement;
    expect(badge.textContent).toBe('Minor revision');
    expect(badge.getAttribute('data-status')).toBe('needs_revision');
    expect(rows(box).slice(1)).toEqual([
      ['Score', '72'],
      ['Feedback', 'Line 1\nLine 2'],
      ['Evaluated', `Prof · ${formatLocalWithTz('2026-06-02T09:00:00Z')}`],
    ]);
  });
  it('"—" for an empty score and for empty or missing feedback', () => {
    render({ sub: sub(), ev: ev({ score: null, feedback_text: '' }), evaluated: 'You · Just now' });
    expect(rows(part('ev')).slice(1)).toEqual([
      ['Score', '—'], ['Feedback', '—'], ['Evaluated', 'You · Just now'],
    ]);
  });
  it('the feedback file card only when there is a file', () => {
    render({ sub: sub(), ev: ev(), evaluated: '' });
    const card = part('ev').querySelector('.sc-file') as HTMLElement;
    expect(card.querySelector('.sc-file-name')!.textContent).toBe('Feedback file');
    expect(card.querySelector('.sc-file-meta')!.textContent).toBe('PDF');
    const a = card.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/api/evaluations/11/feedback-file');
    expect(a.getAttribute('aria-label')).toBe('Download feedback file');
    unmount(component!); component = null; host.remove();
    render({ sub: sub(), ev: ev({ has_feedback_file: false }), evaluated: '' });
    expect(part('ev').querySelector('.sc-file')).toBeNull();
  });
  it('evaluatedLine: the user id, then "—", when the name or the time is missing', () => {
    expect(evaluatedLine(ev({ evaluated_by: { user_id: 3, full_name: null }, evaluated_at: null }))).toBe('3 · —');
    expect(evaluatedLine(ev({ evaluated_by: null }))).toBe(`— · ${formatLocalWithTz('2026-06-02T09:00:00Z')}`);
  });
});
```

6. `frontend/src/tests/SubmissionThreadEntry.svelte.test.ts`: replace the whole `describe('SubmissionThreadEntry', () => { … });` block with:

```ts
describe('SubmissionThreadEntry (6c 9b rows)', () => {
  const toggle = () => host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement;

  it('collapsed: a disclosure row with the name, the local date and the short badge; no content', () => {
    mountEntry(makeSubmission(), false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().querySelector('.te-name')!.textContent).toBe('Submission 3');
    expect(toggle().querySelector('.te-date')!.textContent).toBe('01 Jun 2026');
    const badge = toggle().querySelector('.status-badge') as HTMLElement;
    expect(badge.textContent).toBe('accepted');
    expect(badge.getAttribute('data-status')).toBe('accepted');
    expect(host.querySelector('[data-test="submission-content"]')).toBeNull();
    expect(host.querySelector('a[download]')).toBeNull();
  });

  it('a submission at 23:30 UTC shows the viewer\'s next day (Review Focus 5)', () => {
    mountEntry(makeSubmission({ submitted_at: '2026-08-01T23:30:00Z' }), false);
    expect(toggle().querySelector('.te-date')!.textContent).toBe('02 Aug 2026');
  });

  it('expanded: the submission and evaluation content, both downloads', () => {
    mountEntry(makeSubmission(), true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-test="submission-content"]')).toBeTruthy();
    expect(host.querySelector('.sc-file-meta')!.textContent).toBe('PDF · 2.0 kB');
    expect(host.querySelector('h4')!.textContent).toBe('Evaluation');
    const ev = host.querySelector('[data-test="evaluation-content"]') as HTMLElement;
    expect(ev.querySelector('.status-badge')!.textContent).toBe('Accepted');
    const links = Array.from(host.querySelectorAll('a[download]')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/api/submissions/42/file', '/api/evaluations/11/feedback-file']);
  });

  it('expanded + null evaluation: the placeholder, no evaluation content, the awaiting badge', () => {
    mountEntry(makeSubmission({ evaluation: null }), true);
    const placeholder = host.querySelector('[data-test="awaiting-evaluation-placeholder"]');
    expect(placeholder?.textContent).toBe('Awaiting evaluation');
    expect(host.querySelector('[data-test="evaluation-content"]')).toBeNull();
    const badge = host.querySelector('.status-badge') as HTMLElement;
    expect(badge.getAttribute('data-status')).toBe('awaiting_eval');
    expect(badge.textContent).toBe('awaiting eval');
  });

  it('expanded + is_resubmission: the chip and the auto-accept line', () => {
    mountEntry(makeSubmission({ is_resubmission: true }), true);
    expect(host.querySelector('.te-chips')!.textContent).toContain('resubmission');
    expect(host.querySelector('p.te-info[role="status"]')!.textContent)
      .toBe('Auto-accepted on resubmission. No manual evaluation needed.');
  });

  it('clicking the row calls onToggle', () => {
    let toggled = 0;
    mountEntry(makeSubmission(), false, () => { toggled += 1; });
    toggle().click();
    flushSync();
    expect(toggled).toBe(1);
  });
});
```

7. `frontend/src/tests/RunSubmissionTab.svelte.test.ts`: append after the test "cell click: opens DashboardSidePanel (role=dialog) with submission target":

```ts
  // R35: the panel's subtitle carries the block's B-label from `blocks`.
  it('the side panel subtitle reads "{Group} · B{n}" (R35)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab(1, { blocks: BLOCKS });
    await settle();
    (host.querySelector('.status-cell-btn') as HTMLButtonElement).click();
    flushSync();
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('G1 · B1');
  });
```

8. `frontend/src/tests/DashboardSidePanel.svelte.test.ts` — from the Result `<select>` to the R37 radios, and the new copy:

   a. Add `import { formatLocalWithTz } from '../lib/datetime';` after the `import type { DashboardMpRow, DashboardMpGroupEntry } from '../lib/dashboards';` line.

   b. Save this script as `$SDD/probe/t6-migrate.py` and run it with `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && python3 $SDD/probe/t6-migrate.py`. It must print `19 2 4 1 2` and stop on any assertion.

```python
# 6c T6: the panel test from the Result <select> to the R37 radios.
import re, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'src/tests/DashboardSidePanel.svelte.test.ts'
s = open(p).read()

def once(old, new):
    global s
    assert s.count(old) == 1, ('not unique', old[:70])
    s = s.replace(old, new)

def every(old, new, n):
    global s
    assert s.count(old) == n, ('count', old[:70], s.count(old))
    s = s.replace(old, new)

SEL = "host.querySelector('select[name=\"evaluation-result\"]') as HTMLSelectElement"

# A. The helpers.
once("""// Picks the Result.
function pickResult(value: string) {
  const select = """ + SEL + """;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}
""", """// The Result radios (R37); a click picks one (a disabled one stays unpicked).
const resultRadio = (value: string) =>
  host.querySelector(`input[name="evaluation-result"][value="${value}"]`) as HTMLInputElement;
function pickResult(value: string) {
  resultRadio(value).click();
  flushSync();
}
const checkedResult = () =>
  (host.querySelector('input[name="evaluation-result"]:checked') as HTMLInputElement | null)?.value ?? '';
""")
once("""  onRefetch?: () => void;
}
""", """  onRefetch?: () => void;
  blockLabel?: string;
}
""")
once("""      onRefetch,
    },
  });""", """      onRefetch,
      blockLabel: opts.blockLabel,
    },
  });""")

# B. T15: open focuses the first radio.
once("""  it('T15: shows form when canWrite + no eval + not auto-accept; focus on result <select>', async () => {""",
     """  it('T15: shows form when canWrite + no eval + not auto-accept; focus on the first Result radio', async () => {""")
once("""    const select = """ + SEL + """;
    expect(select).toBeTruthy();
    expect(document.activeElement).toBe(select);
""", """    expect(document.activeElement).toBe(resultRadio('accepted'));
""")

# C. T40: the radiogroup.
once("""  it('T40: result <select> has visible "(required)" helper text + aria-describedby', async () => {""",
     """  it('T40: the Result radiogroup shows "(required)", is aria-required, and its error describes it', async () => {""")
once("""    const helper = host.querySelector('#evaluation-result-helper') as HTMLElement;
    expect(helper).toBeTruthy();
    expect(helper.textContent).toContain('(required)');
    const select = """ + SEL + """;
    const desc = select.getAttribute('aria-describedby') ?? '';
    expect(desc.split(/\\s+/)).toContain('evaluation-result-helper');
""", """    const group = host.querySelector('fieldset#evaluation-result') as HTMLFieldSetElement;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-required')).toBe('true');
    expect(group.querySelector('legend')!.textContent).toBe('Result (required)');
    expect(group.hasAttribute('aria-describedby')).toBe(false);
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect((group.getAttribute('aria-describedby') ?? '').split(/\\s+/)).toContain('evaluation-result-error');
""")

# D. T25: the lock disables three radios.
once("""  it('T25: result-lock — non-accepted options disabled + verbatim helper text + fetch not called', async () => {""",
     """  it('T25: result-lock — three radios disabled with the lock line; a click on one changes nothing', async () => {""")
once("""    const opts = host.querySelectorAll('select[name="evaluation-result"] option');
    const optMap = new Map<string, HTMLOptionElement>();
    opts.forEach((o) => optMap.set((o as HTMLOptionElement).value, o as HTMLOptionElement));
    expect(optMap.get('rejected')?.disabled).toBe(true);
    expect(optMap.get('major_revision')?.disabled).toBe(true);
    expect(optMap.get('minor_revision')?.disabled).toBe(true);
    expect(optMap.get('accepted')?.disabled).toBe(false);
    expect(host.textContent).toContain('Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead.');
    const select = """ + SEL + """;
    select.value = 'rejected';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(evalCalls(fetchMock)).toHaveLength(0);
""", """    const LOCK = 'Without a feedback file the result can only be Accepted.';
    for (const v of ['minor_revision', 'major_revision', 'rejected']) {
      expect(resultRadio(v).disabled).toBe(true);
      expect(resultRadio(v).title).toBe(LOCK);
    }
    expect(resultRadio('accepted').disabled).toBe(false);
    expect(checkedResult()).toBe('accepted');
    expect(host.querySelector('#evaluation-result-lock')!.textContent).toBe(LOCK);
    const desc = host.querySelector('fieldset#evaluation-result')!.getAttribute('aria-describedby') ?? '';
    expect(desc.split(/\\s+/)).toContain('evaluation-result-lock');
    pickResult('rejected');
    expect(checkedResult()).toBe('accepted');
    expect(evalCalls(fetchMock)).toHaveLength(0);
""")

# E. T30b: Edit focuses the checked radio.
once("""  it('T30b: focus moves to result <select> after [Edit] click', async () => {""",
     """  it('T30b: focus moves to the checked Result radio after [Edit] click', async () => {""")
once("""    const select = """ + SEL + """;
    expect(document.activeElement).toBe(select);
""", """    expect(document.activeElement).toBe(resultRadio('major_revision'));
""")

# F. T21 / T29: R44 on Save.
once("""    expect(saveBtn.getAttribute('aria-busy')).toBe('true');
    expect(saveBtn.disabled).toBe(true);
""", """    expect(saveBtn.getAttribute('aria-busy')).toBe('true');
    // R44: busy, not disabled — it keeps focus.
    expect(saveBtn.getAttribute('aria-disabled')).toBe('true');
    expect(saveBtn.disabled).toBe(false);
""")
once("""    expect(saveBtn.getAttribute('aria-busy')).toBe('false');""",
     """    expect(saveBtn.getAttribute('aria-busy')).toBeNull();""")

# G. Headings and copy.
once("""    const h4s = Array.from(host.querySelectorAll('h4')).map((h) => h.textContent?.trim());
    expect(h4s).not.toContain('Submission');
    expect(h4s).not.toContain('Evaluation');
""", """    const h3s = Array.from(host.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(h3s).not.toContain('Latest submission');
    expect(h3s).not.toContain('Evaluation');
""")
once("""    const h4s = Array.from(host.querySelectorAll('h4')).map((h) => h.textContent?.trim());
    expect(h4s).toContain('Submission');
    expect(h4s).not.toContain('Evaluation');
""", """    const h3s = Array.from(host.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(h3s).toContain('Latest submission');
    expect(h3s).not.toContain('Evaluation');
""")
once("""    // result
    expect(host.textContent).toContain('accepted');""", """    // result (RESULT_LABEL)
    expect(host.textContent).toContain('Accepted');""")
every("section.evaluation-block", '[data-test="evaluation-card"]', 4)
every("Previous submissions", "Earlier submissions", 3)
every("Existing feedback file uploaded — replace not supported (Phase 9)", "The feedback file cannot be replaced.", 2)

# H. Every other pick and read of the Result.
DECL = r"const (select|sel2?) = host\.querySelector\('select\[name=\"evaluation-result\"\]'\) as HTMLSelectElement;"
n1 = n2 = n3 = n4 = n5 = 0
def r1(m):
    global n1; n1 += 1; return f"{m.group(1)}pickResult('{m.group(3)}');"
s = re.sub(r"( *)" + DECL + r"\n\s*\2\.value = '(\w+)';\s*\2\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\);\n\s*flushSync\(\);", r1, s)
def r2(m):
    global n2; n2 += 1; return f"{m.group(1)}pickResult('{m.group(3)}');"
s = re.sub(r"( *)\b(select|sel2?)\.value = '(\w+)';\s*\2\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\);\n\s*flushSync\(\);", r2, s)
def r3(m):
    global n3; n3 += 1; return f"expect(checkedResult()).toBe('{m.group(2)}')"
s = re.sub(r"expect\((select|sel2?)\.value\)\.toBe\('(\w+)'\)", r3, s)
def r4(m):
    global n4; n4 += 1; return f"expect(checkedResult()).toBe('{m.group(1)}')"
s = re.sub(r"expect\(\(host\.querySelector\('select\[name=\"evaluation-result\"\]'\) as HTMLSelectElement\)\.value\)\.toBe\('(\w+)'\)", r4, s)
def r5(m):
    global n5; n5 += 1; return ''
s = re.sub(r" *" + DECL + r"\n", r5, s)
print(n1, n2, n3, n4, n5)
assert 'HTMLSelectElement' not in s and 'select[name="evaluation-result"]' not in s
assert not re.search(r"\b(select|sel|sel2)\.", s), re.findall(r".*\b(?:select|sel|sel2)\..*", s)
open(p, 'w').write(s)
```

   It does the following:
   - Rewrites Task 5's `pickResult` onto the radios and adds `resultRadio` / `checkedResult`.
   - Gives `mountPanel` the `blockLabel` option.
   - Re-points T15 / T30b's focus at the radios.
   - Rewrites T40 (the radiogroup) and T25 (three disabled radios; a click changes nothing; there is no longer an invalid result to submit).
   - Flips T21 / T29 to R44 (`aria-disabled`, no `disabled`; `aria-busy` absent when idle).
   - Changes the copy: the `h3` "Latest submission", "Accepted", "Earlier submissions", "The feedback file cannot be replaced.", and `[data-test="evaluation-card"]` for `section.evaluation-block`.
   - Turns every other "set the select + change" into `pickResult(…)` and every read into `checkedResult()`.

   The probe dry run on today's file plus Task 5's helper printed `19 2 4 1 2`.

   c. Append after the file's last line:

```ts
// --- 6c Task 6: the submission cards and the evaluation form ---

const sectionTitled = (text: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('section.sp-card')).find((s) => s.querySelector('h3')?.textContent === text) ?? null;

describe('DashboardSidePanel — submission cards (6c T6)', () => {
  it('header subtitle: "{Group} · B2" with blockLabel, the group alone without (R35)', async () => {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }), blockLabel: 'B2' });
    await settle();
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('G7 · B2');
    unmount(component!); component = null; host.remove();
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval' }) });
    await settle();
    expect(host.querySelector('.modal-head .sp-sub')!.textContent).toBe('G7');
  });

  it('the Latest submission card: its <h3>, the chips, the rows and the file card (D26)', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    t.entry.latest_submission = { ...t.entry.latest_submission!, submission_number: 3, file_size: 2_400_000, is_late: true };
    mountPanel({ target: t });
    await settle();
    const card = sectionTitled('Latest submission')!;
    expect(document.getElementById(card.getAttribute('aria-labelledby')!)!.tagName).toBe('H3');
    expect(Array.from(card.querySelectorAll('.sp-card-head .sc-chip')).map((c) => c.textContent)).toEqual(['late']);
    const dds = Array.from(card.querySelectorAll('[data-test="submission-content"] dd')).map((d) => d.textContent?.trim());
    expect(dds).toEqual([formatLocalWithTz('2026-06-04T10:00:00Z'), 'Alice', '3']);
    expect(card.querySelector('.sc-file-name')!.textContent).toBe('Submission 3');
    expect(card.querySelector('.sc-file-meta')!.textContent).toBe('PDF · 2.4 MB');
    const a = card.querySelector('a[href="/api/submissions/100/file"]') as HTMLAnchorElement;
    expect(a.hasAttribute('download')).toBe(true);
    expect(a.getAttribute('aria-label')).toBe('Download submission 3');
  });

  it('the Evaluation card: "Minor revision", "—" for empty score and feedback, the file, Edit', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        latest_evaluation: { ...NEEDS_REVISION_EVAL, result: 'minor_revision', score: null, feedback_text: '' },
      }),
      isAdmin: true,
    });
    await settle();
    const card = host.querySelector('[data-test="evaluation-card"]') as HTMLElement;
    const h = document.getElementById(card.getAttribute('aria-labelledby')!)!;
    expect(h.tagName).toBe('H3');
    expect(h.textContent).toBe('Evaluation');
    expect(h.getAttribute('tabindex')).toBe('-1');
    const badge = card.querySelector('[data-test="evaluation-content"] .status-badge') as HTMLElement;
    expect(badge.textContent).toBe('Minor revision');
    expect(badge.getAttribute('data-status')).toBe('needs_revision');
    const dds = Array.from(card.querySelectorAll('[data-test="evaluation-content"] dd')).map((d) => d.textContent?.trim());
    expect(dds.slice(1)).toEqual(['—', '—', `Prof · ${formatLocalWithTz('2026-06-01T10:00:00Z')}`]);
    expect(card.querySelector('a[href="/api/evaluations/42/feedback-file"]')!.hasAttribute('download')).toBe(true);
    const edit = card.querySelector('.sp-card-head button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(edit.textContent!.trim()).toBe('Edit');
    expect(edit.getAttribute('data-variant')).toBe('secondary');
  });

  it('after a save the card reads "You · Just now" until the refetch brings the evaluation', async () => {
    const evalResp = { id: 8, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 201, body: evalResp } }));
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }), isAdmin: true });
    await settle();
    pickResult('accepted');
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const dds = Array.from(host.querySelectorAll('[data-test="evaluation-card"] dd')).map((d) => d.textContent?.trim());
    expect(dds[0]).toBe('Accepted');
    expect(dds[3]).toBe('You · Just now');
  });
});

describe('DashboardSidePanel — the Evaluate form (6c T6, R37, R44)', () => {
  async function mountCreate() {
    mountPanel({ target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }), isAdmin: true });
    await settle();
  }
  const save = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
  const submit = () =>
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  it('the "Evaluate" card; Result as four radios in the drawn order, none checked', async () => {
    await mountCreate();
    expect(host.querySelector('section.sp-evaluate h3')!.textContent).toBe('Evaluate');
    const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[name="evaluation-result"]'));
    expect(radios.map((r) => r.value)).toEqual(['accepted', 'minor_revision', 'major_revision', 'rejected']);
    expect(radios.map((r) => r.closest('label')!.textContent!.trim()))
      .toEqual(['Accepted', 'Minor revision', 'Major revision', 'Rejected']);
    expect(radios.some((r) => r.checked)).toBe(false);
    pickResult('major_revision');
    expect(resultRadio('major_revision').closest('label')!.classList.contains('checked')).toBe(true);
  });

  it('Feedback and the feedback file say "(required)" unless Accepted', async () => {
    await mountCreate();
    const fb = () => host.querySelector('label[for="evaluation-feedback"]')!.textContent;
    const attach = () => host.querySelector('button[data-action="attach-feedback-file"]') as HTMLButtonElement;
    const file = () => document.getElementById(attach().getAttribute('aria-describedby')!.split(' ')[0]!)!.textContent;
    expect(fb()).toBe('Feedback (required)');
    expect(file()).toBe('Feedback file (required)');
    pickResult('accepted');
    expect(fb()).toBe('Feedback (optional)');
    expect(file()).toBe('Feedback file (optional)');
    pickResult('rejected');
    expect(file()).toBe('Feedback file (required)');
  });

  it('"attach PDF" is one tab stop that opens the hidden input, described by the label and the help', async () => {
    await mountCreate();
    const input = host.querySelector('input#evaluation-file') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.hidden).toBe(true);
    const attach = host.querySelector('button[data-action="attach-feedback-file"]') as HTMLButtonElement;
    expect(attach.textContent).toBe('attach PDF');
    const described = attach.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent);
    expect(described).toEqual(['Feedback file (required)', 'PDF only, max 20 MB.']);
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    attach.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('a chosen file shows "{name} · {size}" with its remove × focused; remove clears the input and focuses "attach PDF"', async () => {
    await mountCreate();
    const input = host.querySelector('input#evaluation-file') as HTMLInputElement;
    const pdf = new File([new Uint8Array(2048)], 'notes.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [pdf], configurable: true });
    const setValue = vi.fn();
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: setValue });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const chosen = host.querySelector('.sp-chosen') as HTMLElement;
    expect(chosen.textContent).toContain('notes.pdf');
    expect(chosen.textContent).toContain('· 2.0 kB');
    expect(host.querySelector('button[data-action="attach-feedback-file"]')).toBeNull();
    const remove = host.querySelector('[data-action="remove-feedback-file"]') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove notes.pdf');
    expect(document.activeElement).toBe(remove);
    remove.click();
    await settle();
    expect(setValue).toHaveBeenCalledWith('');
    expect(host.querySelector('.sp-chosen')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button[data-action="attach-feedback-file"]'));
  });

  it("Save's disabled reason, first match wins", async () => {
    await mountCreate();
    expect(save().disabled).toBe(true);
    expect(save().title).toBe('Choose a result');
    pickResult('rejected');
    const score = host.querySelector('#evaluation-score') as HTMLInputElement;
    score.value = '101';
    score.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(save().title).toBe('Score must be a whole number between 0 and 100');
    score.value = '';
    score.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(save().title).toBe('Write feedback for a non-accepted result');
    await typeFeedback('Redo the proof');
    expect(save().title).toBe('Attach the feedback PDF');
    pickResult('accepted');
    expect(save().disabled).toBe(false);
    expect(save().hasAttribute('title')).toBe(false);
    expect(save().textContent!.trim()).toBe('Save');
  });

  it('while saving: Save keeps focus, busy and not disabled; the fields freeze; a second submit sends nothing', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ submissions: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      return new Promise<Response>(() => { /* the save never answers */ });
    });
    vi.stubGlobal('fetch', fetchMock);
    await mountCreate();
    pickResult('accepted');
    save().focus();
    submit();
    await tick();
    flushSync();
    expect(document.activeElement).toBe(save());
    expect(save().disabled).toBe(false);
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(save().getAttribute('aria-busy')).toBe('true');
    expect(save().title).toBe('Wait for the save to finish');
    expect(save().textContent!.trim()).toBe('Saving…');
    expect((host.querySelector('#evaluation-feedback') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((host.querySelector('#evaluation-score') as HTMLInputElement).readOnly).toBe(true);
    expect((host.querySelector('fieldset#evaluation-result') as HTMLFieldSetElement).disabled).toBe(true);
    expect(host.querySelector('.sp-file-ctl')!.hasAttribute('inert')).toBe(true);
    save().click();
    submit();
    await tick();
    expect(evalCalls(fetchMock)).toHaveLength(1);
  });

  it('a failed save → after the un-freeze, focus on Save (no field has an error)', async () => {
    vi.stubGlobal('fetch', routedFetch({ evalResponse: { status: 400, body: { detail: 'Bad request' } } }));
    await mountCreate();
    pickResult('accepted');
    resultRadio('accepted').focus();
    submit();
    await settle();
    expect(host.querySelector('[role="alert"].form-error')!.textContent).toContain('Bad request');
    expect((host.querySelector('fieldset#evaluation-result') as HTMLFieldSetElement).disabled).toBe(false);
    expect(document.activeElement).toBe(save());
  });

  it('Cancel upload → the form stays, focus on Save', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ submissions: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      return new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }));
    await mountCreate();
    pickResult('accepted');
    submit();
    await tick();
    flushSync();
    const cancel = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    expect(cancel.textContent!.trim()).toBe('Cancel upload');
    cancel.click();
    await settle();
    expect(host.querySelector('button[data-test="cancel-button"]')).toBeNull();
    expect(checkedResult()).toBe('accepted');
    expect(document.activeElement).toBe(save());
  });

  it('a 409 → focus on the winning Evaluation card\'s <h3> once it renders', async () => {
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const winning = { submissions: [{ ...start.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Winner', has_feedback_file: false } }] };
    vi.stubGlobal('fetch', sequencedThreadFetch(
      [echoThread(start), winning],
      { status: 409, body: { detail: 'Already evaluated' } },
    ));
    mountPanel({ target: start, isAdmin: true });
    await settle();
    pickResult('accepted');
    submit();
    await settle();
    await settle();
    const card = host.querySelector('[data-test="evaluation-card"]') as HTMLElement;
    expect(card.textContent).toContain('Other Prof');
    expect(document.activeElement).toBe(card.querySelector('h3'));
  });

  it('Edit with no feedback file: Accepted is focused, the other results lock, the lock line shows', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        latest_evaluation: { ...NEEDS_REVISION_EVAL, result: 'major_revision', has_feedback_file: false },
      }),
      isAdmin: true,
    });
    await settle();
    (host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement).click();
    await settle();
    // The lock keeps the stored non-accepted result until the teacher picks Accepted.
    expect(resultRadio('major_revision').disabled).toBe(true);
    expect(document.activeElement).toBe(resultRadio('accepted'));
    expect(host.querySelector('#evaluation-result-lock')!.textContent)
      .toBe('Without a feedback file the result can only be Accepted.');
  });
});

describe('DashboardSidePanel — earlier submissions and Retry (6c T6)', () => {
  it('the loading line first; then a card with the count; rows toggle; an auto-accepted entry keeps its line', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const older = (id: number, n: number, extra: Record<string, unknown> = {}) => ({
      id, submission_number: n, submitted_at: '2026-06-01T09:00:00Z',
      submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
      file_size: 500, evaluation: null, ...extra,
    });
    const thread = { submissions: [
      { ...t.entry.latest_submission!, evaluation: null },
      older(56, 2, { is_resubmission: true, evaluation: { id: 8, evaluated_at: '2026-06-02T09:00:00Z',
        evaluated_by: { user_id: 3, full_name: 'Prof' }, result: 'accepted', score: null, feedback_text: null,
        has_feedback_file: false } }),
      older(55, 1),
    ] };
    let resolveThread!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolveThread = r; })));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-loading"]')!.textContent).toBe('Loading earlier submissions…');
    expect(host.querySelector('[data-test="thread-history"]')).toBeNull();
    resolveThread(new Response(JSON.stringify(thread), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(host.querySelector('[data-test="thread-loading"]')).toBeNull();
    const card = sectionTitled('Earlier submissions')!;
    expect(card.querySelector('.sp-count-n')!.textContent).toBe('2');
    const toggles = card.querySelectorAll<HTMLButtonElement>('[data-test="thread-entry-toggle"]');
    expect(toggles).toHaveLength(2);
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false');
    toggles[0]!.click();
    flushSync();
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(toggles[0]!.closest('[data-test="thread-entry"]')!.textContent)
      .toContain('Auto-accepted on resubmission. No manual evaluation needed.');
  });

  it('Retry → focus on the panel title', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'GET' && String(url).endsWith('/submissions')) {
        calls += 1;
        if (calls === 1) return Promise.reject(new TypeError('network down'));
        return Promise.resolve(new Response(JSON.stringify(echoThread(t)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    const err = host.querySelector('[data-test="thread-error"]') as HTMLElement;
    expect(err.textContent).toContain("Couldn't load submission history.");
    (host.querySelector('[data-test="thread-retry"]') as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeNull();
    expect(document.activeElement).toBe(panelTitle());
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/datetime.test.ts src/tests/dashboards.test.ts src/tests/Button.svelte.test.ts src/tests/SubmissionCards.svelte.test.ts src/tests/SubmissionThreadEntry.svelte.test.ts src/tests/RunSubmissionTab.svelte.test.ts src/tests/DashboardSidePanel.svelte.test.ts`

Expected: FAIL.
- `datetime`: `formatLocalShortDate` is not a function.
- `dashboards`: `RESULT_LABEL` / `resultLabel` are undefined.
- `Button`: no `data-test`; "omits data-test by default" passes.
- `SubmissionCards`: cannot import the component.
- `SubmissionThreadEntry`: every rewritten test fails except "clicking the row calls onToggle".
- `RunSubmissionTab`: the R35 test fails (`.sp-sub` reads "G1").
- `DashboardSidePanel`: there are no radios, so every test that picks a result fails, as do the new describes. The tests that never touch the Result or the new copy still pass.

- [ ] **Step 3: `RESULT_LABEL`, `formatLocalShortDate`, Button's `data-test`**

1. `frontend/src/lib/dashboards.ts`:
   - After `import { api } from './api';  // existing project-wide fetch helper` add `import type { EvaluationResult } from './evaluations';`.
   - Replace

```ts
// Lowercase short labels for the Submissions grid cells (spec §Submissions).
// STATUS_LABEL stays for the side panel, the thread entries and cell names.
```

with

```ts
// Lowercase short labels for the Submissions grid cells, the side panel's
// badge and its earlier-submission rows. STATUS_LABEL stays for the cells'
// accessible names.
```

   - After the `resultToStatus` function's closing `}` insert:

```ts

// Each result in its own words, for the read-only Evaluation rows and the
// Result radios (6c R37); the badge colour still comes from resultToStatus.
export const RESULT_LABEL: Record<EvaluationResult, string> = {
  accepted: 'Accepted',
  minor_revision: 'Minor revision',
  major_revision: 'Major revision',
  rejected: 'Rejected',
};

// The thread's `result` is a plain string; an unknown one shows raw.
export function resultLabel(result: string): string {
  return Object.prototype.hasOwnProperty.call(RESULT_LABEL, result)
    ? RESULT_LABEL[result as EvaluationResult]
    : result;
}
```

2. `frontend/src/lib/datetime.ts`: after `formatShortDate`'s closing `}` insert:

```ts

// A UTC ISO instant as the viewer's local calendar date: "02 Aug 2026".
export function formatLocalShortDate(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
```

3. `frontend/src/components/ui/Button.svelte`:
   - After Task 2's `'aria-disabled': ariaDisabled = false,` add:

```ts
    // Slice-6c P48: a test hook (the side panel's Edit and Cancel).
    'data-test': dataTest = undefined as string | undefined,
```

   - In the tag, replace `  data-action={dataAction}` with:

```svelte
  data-action={dataAction}
  data-test={dataTest}
```

- [ ] **Step 4: `SubmissionCards` and the restyled `SubmissionThreadEntry`**

1. Create `frontend/src/components/runs/SubmissionCards.svelte`:

```svelte
<script module lang="ts">
  // Read-only submission and evaluation content (9b), shared by the side
  // panel's cards and its earlier-submission rows (6c R43). The caller draws
  // the frame around it: a card, or a row's indented body.
  import IconButton from '../ui/IconButton.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import {
    resultLabel,
    resultToStatus,
    type ThreadEvaluation,
    type ThreadSubmissionBase,
  } from '../../lib/dashboards';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { formatFileSize } from '../../lib/format';

  // What the Evaluation rows read: a thread evaluation, or the panel's
  // just-saved one (lib/evaluations' Evaluation) before the refetch.
  export type EvaluationView = Pick<ThreadEvaluation, 'id' | 'result' | 'score' | 'feedback_text' | 'has_feedback_file'>;

  // The Evaluated row: "{by} · {when}".
  export function evaluatedLine(ev: ThreadEvaluation): string {
    const by = ev.evaluated_by?.full_name ?? ev.evaluated_by?.user_id ?? '—';
    const when = ev.evaluated_at ? formatLocalWithTz(ev.evaluated_at) : '—';
    return `${by} · ${when}`;
  }

  export { submissionChips, submissionContent, evaluationContent };
</script>

{#snippet submissionChips(sub: ThreadSubmissionBase)}
  {#if sub.is_resubmission}<span class="sc-chip">resubmission</span>{/if}
  {#if sub.is_late}<span class="sc-chip sc-late">late</span>{/if}
{/snippet}

{#snippet submissionContent(sub: ThreadSubmissionBase)}
  <dl class="sc-rows" data-test="submission-content">
    <dt class="sc-k">Submitted</dt>
    <dd class="sc-v">{sub.submitted_at ? formatLocalWithTz(sub.submitted_at) : '—'}</dd>
    <dt class="sc-k">By</dt>
    <dd class="sc-v">{sub.submitted_by?.full_name ?? sub.submitted_by?.user_id ?? '—'}</dd>
    <dt class="sc-k">Number</dt>
    <dd class="sc-v sc-mono">{sub.submission_number}</dd>
  </dl>
  <!-- D26: no file name is stored, so the card names the submission. -->
  <div class="sc-file">
    <span class="sc-tile" aria-hidden="true">PDF</span>
    <span class="sc-file-text">
      <span class="sc-file-name">Submission {sub.submission_number}</span>
      <span class="sc-file-meta">PDF · {formatFileSize(sub.file_size)}</span>
    </span>
    <IconButton
      glyph="download"
      size="sm"
      title="Download submission {sub.submission_number}"
      href="/api/submissions/{sub.id}/file"
      download
    />
  </div>
{/snippet}

{#snippet evaluationContent(ev: EvaluationView, evaluated: string)}
  <dl class="sc-rows" data-test="evaluation-content">
    <dt class="sc-k">Result</dt>
    <dd class="sc-v"><StatusBadge status={resultToStatus(ev.result)} label={resultLabel(ev.result)} /></dd>
    <dt class="sc-k">Score</dt>
    <dd class="sc-v sc-mono">{ev.score ?? '—'}</dd>
    <dt class="sc-k">Feedback</dt>
    <dd class="sc-v sc-pre">{ev.feedback_text || '—'}</dd>
    <dt class="sc-k">Evaluated</dt>
    <dd class="sc-v">{evaluated}</dd>
  </dl>
  {#if ev.has_feedback_file}
    <div class="sc-file">
      <span class="sc-tile" aria-hidden="true">PDF</span>
      <span class="sc-file-text">
        <span class="sc-file-name">Feedback file</span>
        <span class="sc-file-meta">PDF</span>
      </span>
      <IconButton
        glyph="download"
        size="sm"
        title="Download feedback file"
        href="/api/evaluations/{ev.id}/feedback-file"
        download
      />
    </div>
  {/if}
{/snippet}

<style>
  .sc-rows {
    display: grid;
    grid-template-columns: 104px 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 12.5px;
  }
  .sc-k { margin: 0; color: var(--muted); }
  .sc-v { margin: 0; min-width: 0; color: var(--text); overflow-wrap: anywhere; }
  .sc-mono { font-family: var(--font-mono); }
  .sc-pre { white-space: pre-wrap; }
  .sc-chip {
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }
  .sc-late {
    background: var(--status-needs-revision-bg);
    color: var(--status-needs-revision-fg);
  }
  .sc-file {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-3);
  }
  .sc-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 32px;
    height: 28px;
    border-radius: 4px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .sc-file-text { display: flex; flex-direction: column; gap: 1px; flex: 1 1 auto; min-width: 0; }
  .sc-file-name { font-size: 12.5px; color: var(--text); }
  .sc-file-meta { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
</style>
```

2. Replace the whole of `frontend/src/components/runs/SubmissionThreadEntry.svelte` with:

```svelte
<!-- frontend/src/components/runs/SubmissionThreadEntry.svelte -->
<!-- One earlier submission in the side panel's "Earlier submissions" card (9b):
     a disclosure row, and when open the read-only content indented under it.
     The newest submission is the panel's own "Latest submission" card. -->
<script lang="ts">
  import { type ThreadSubmission, resultToStatus, STATUS_SHORT_LABEL } from '../../lib/dashboards';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatLocalShortDate } from '../../lib/datetime';
  import { submissionChips, submissionContent, evaluationContent, evaluatedLine } from './SubmissionCards.svelte';

  let { submission, expanded, onToggle }: {
    submission: ThreadSubmission;
    expanded: boolean;
    onToggle: () => void;
  } = $props();

  const evaluation = $derived(submission.evaluation);
  const status = $derived(resultToStatus(evaluation?.result ?? null));
</script>

<div class="te-entry" data-test="thread-entry" data-submission-id={submission.id}>
  <button
    type="button"
    class="te-toggle"
    data-test="thread-entry-toggle"
    aria-expanded={expanded}
    onclick={onToggle}
  >
    <svg class="te-chev" class:open={expanded} width="12" height="12" viewBox="0 0 16 16" fill="none"
         stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="6.6,4.6 10,8 6.6,11.4" />
    </svg>
    <span class="te-name">Submission {submission.submission_number}</span>
    <span class="te-date">{submission.submitted_at ? formatLocalShortDate(submission.submitted_at) : '—'}</span>
    <span class="te-badge"><StatusBadge {status} label={STATUS_SHORT_LABEL[status]} /></span>
  </button>

  {#if expanded}
    <div class="te-body">
      {#if submission.is_resubmission || submission.is_late}
        <div class="te-chips">{@render submissionChips(submission)}</div>
      {/if}
      {@render submissionContent(submission)}
      {#if submission.is_resubmission}
        <p class="te-info banner-info" role="status">Auto-accepted on resubmission. No manual evaluation needed.</p>
      {/if}
      {#if evaluation}
        <h4 class="te-h">Evaluation</h4>
        {@render evaluationContent(evaluation, evaluatedLine(evaluation))}
      {:else}
        <p class="te-muted" data-test="awaiting-evaluation-placeholder">Awaiting evaluation</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .te-entry { border-bottom: 1px solid var(--border-soft); }
  .te-entry:last-child { border-bottom: 0; }
  .te-toggle {
    display: flex;
    align-items: center;
    gap: 9px;
    box-sizing: border-box;
    width: 100%;
    padding: 9px 12px;
    border: 0;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .te-chev { flex: 0 0 auto; color: var(--muted); }
  .te-chev.open { transform: rotate(90deg); }
  .te-name { font-size: 13px; color: var(--text); }
  .te-date {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
  }
  .te-badge { margin-left: auto; }
  /* Indented under the row's name (12px padding + 12px chevron + 9px gap). */
  .te-body { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px 33px; }
  .te-chips { display: flex; gap: 6px; }
  .te-info {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text-2);
  }
  .te-h { margin: 4px 0 0; font-size: 12.5px; font-weight: 600; color: var(--text); }
  .te-muted { margin: 0; font-size: 13px; color: var(--muted); }
</style>
```

The thread entry keeps `banner-info` beside `te-info` only as a test hook, unstyled (head › Global Constraints, pinned rules and test-hook classes). The panel does the same with `banner-info` and `form-error`.

- [ ] **Step 5: The panel's cards and the Evaluate form (R37, R43, R44, §Focus)**

Replace the whole of `frontend/src/components/runs/DashboardSidePanel.svelte` with the version below. Compared with Task 5's file:
- the state machine, the fetches, `errors` / `valid` and the dirty logic are the same;
- the select, the `<h4>` blocks and every old style are gone;
- `saveTitle`, `resultDescribedby`, `resetForm`, `focusAfterEdit`, `firstErroredField`, `startEdit`, `removeFile` and the P52 race focus are new, and `handleSave` now ends in the §Focus step.

```svelte
<!-- frontend/src/components/runs/DashboardSidePanel.svelte -->
<!--
  The grading / progress side panel (9b): a 520px drawer on ui/Modal at the
  right edge (6c D27, R30). × and Esc close it; a click on the dimmed page
  does not (D29). The read-only cards come from SubmissionCards; one
  evaluationForm snippet serves create and edit (R43).
-->
<script lang="ts">
  import {
    getSequenceItemState,
    getSubmissionThread,
    resultToStatus,
    RESULT_LABEL,
    STATUS_SHORT_LABEL,
    type MpGroupStatus,
    type SequenceItemStateResponse,
    type DashboardMpRow,
    type DashboardMpGroupEntry,
    type ThreadSubmission,
  } from '../../lib/dashboards';
  import SubmissionThreadEntry from './SubmissionThreadEntry.svelte';
  import {
    submissionChips,
    submissionContent,
    evaluationContent,
    evaluatedLine,
    type EvaluationView,
  } from './SubmissionCards.svelte';
  import ProgressBreakdown from './ProgressBreakdown.svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import DirtyGuard from '../editor/DirtyGuard.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatFileSize } from '../../lib/format';
  import { focusFirst } from '../../lib/focusFirst';
  import { MAX_FEEDBACK_FILE_SIZE_BYTES, type EvaluationResult, createEvaluation, patchEvaluation, type Evaluation } from '../../lib/evaluations';
  import { ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { tick } from 'svelte';

  type ProgressTarget = {
    kind: 'progress';
    runId: number;
    user_id: number;
    sequence_id: number;
  };
  type SubmissionTarget = {
    kind: 'submission';
    runId: number;
    mp: DashboardMpRow;
    entry: DashboardMpGroupEntry;
  };
  export type PanelTarget = ProgressTarget | SubmissionTarget;

  let {
    target,
    onClose,
    isAdmin = false,
    isTeacher = false,
    onRefetch = () => {},
    blockLabel = undefined,
  }: {
    target: PanelTarget;
    onClose: () => void;
    isAdmin?: boolean;
    isTeacher?: boolean;
    onRefetch?: () => void;
    // R35: the block's "B2" from the Submissions tab; none when the block is
    // not in the run's pinned version.
    blockLabel?: string;
  } = $props();

  const canWrite = $derived(isAdmin || isTeacher);
  let editing = $state(false);

  // R37: the drawn order. No result is checked until the teacher picks one.
  const RESULT_ORDER: EvaluationResult[] = ['accepted', 'minor_revision', 'major_revision', 'rejected'];
  const LOCK_TEXT = 'Without a feedback file the result can only be Accepted.';
  const SAVE_WAIT = 'Wait for the save to finish';
  // §Focus: open → the checked Result radio, else the first radio when the
  // form shows, else Modal's ×.
  const AUTOFOCUS =
    'input[name="evaluation-result"]:checked, input[name="evaluation-result"]:not(:disabled), .modal-head button[aria-label="Close"]';

  const uid = $props.id();
  const titleId = `${uid}-title`;
  let titleEl = $state<HTMLElement>();
  let discardEl = $state<HTMLElement>();
  let saveEl = $state<HTMLButtonElement>();
  let fileInputEl = $state<HTMLInputElement>();
  // P49: Modal owns the panel and ×; the panel finds them from its title.
  const panelEl = () => titleEl?.closest<HTMLElement>('.modal-panel') ?? null;
  const find = <T extends HTMLElement>(sel: string) => panelEl()?.querySelector<T>(sel) ?? null;
  const closeX = () => find<HTMLButtonElement>('.modal-head button[aria-label="Close"]');
  const editBtn = () => find<HTMLButtonElement>('button[data-test="edit-evaluation"]');
  const evalHead = () => document.getElementById(`${uid}-eval`);
  const checkedRadio = () => find<HTMLInputElement>('input[name="evaluation-result"]:checked');
  const acceptedRadio = () => find<HTMLInputElement>('input[name="evaluation-result"][value="accepted"]');

  let formResult = $state<EvaluationResult | ''>('');
  let formScore = $state<number | null>(null);
  let formFeedbackText = $state('');
  let formFeedbackFile = $state<File | null>(null);
  let fileError = $state<string | null>(null);
  // Set true on first submit attempt; controls whether `errors.result` surfaces
  // the "Result is required." inline error vs. just relying on native `disabled`.
  let formSubmitAttempted = $state(false);

  const SUBMIT_TIMEOUT_MS = 60_000;

  let stateLatestEvaluation = $state<Evaluation | null>(null);
  let submitting = $state(false);
  let serverError = $state<string | null>(null);
  let submitController: AbortController | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let raceTransition = $state(false);
  // P52: set by a 409; the winning evaluation's <h3> takes focus when it renders.
  let raceFocusPending = false;

  // Captured when Edit is clicked. The dirty check compares the form against
  // it, so a clean just-opened edit is NOT dirty. `null` means create mode.
  let prefillSnapshot = $state<{ result: EvaluationResult | ''; score: number | null; feedback_text: string } | null>(null);

  // --- Submission thread (Slice B) ---
  let threadState = $state<ThreadSubmission[] | null>(null);
  let threadLoading = $state(false);
  let threadError = $state(false);
  let threadCtl: AbortController | null = null;
  let expandedById = $state<Record<number, boolean>>({});

  // Gated primitive ids — the fetch effect reads ONLY primitive $derived (these three
  // plus the sub/eval-id primitives declared below), never `target` inline, so it fires
  // once per (cell + cell sub/eval-id state): the ids recompute to strict-equal values
  // across an onRefetch()-driven `target` object swap, so a no-op refresh propagates
  // nothing. null when not a submission target or nothing submitted yet.
  const submissionRunId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.runId : null,
  );
  const submissionMpId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.mp.id : null,
  );
  const submissionGroupId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.entry.group_id : null,
  );
  // Also key the fetch effect on the cell's latest submission/evaluation ids so an
  // EXTERNAL grid refresh (onRefetch reassigns `data` → a new cell entry with a
  // changed submission or evaluation) re-fetches the thread — spec §8: "surfaced on
  // the next thread refetch / manual grid refresh". Primitive values → no refire when
  // the ids are unchanged (a no-op grid refresh does not refetch). After a create
  // write the cell's evaluation id changes null→N via onRefetch, so the effect DOES
  // refire and fetches once more on top of the manual refetch; this is benign
  // (loadThread aborts the prior in-flight request, so the two serialize) and is the
  // same mechanism that surfaces a concurrent external evaluation.
  const submissionLatestSubId = $derived(
    target.kind === 'submission' ? (target.entry.latest_submission?.id ?? null) : null,
  );
  const submissionLatestEvalId = $derived(
    target.kind === 'submission' ? (target.entry.latest_evaluation?.id ?? null) : null,
  );

  // The authoritative newest entry. Once the thread resolves, thread[0] wins
  // (may differ from the cell entry if the group resubmitted). Before that (or
  // defensively if the thread resolves empty) fall back to the cell entry.
  const newest = $derived.by<ThreadSubmission | null>(() => {
    if (target.kind !== 'submission' || target.entry.latest_submission == null) return null;
    if (threadState != null && threadState.length > 0) return threadState[0];
    return { ...target.entry.latest_submission, evaluation: target.entry.latest_evaluation };
  });

  const effectiveEvaluation = $derived.by(() => {
    if (target.kind !== 'submission') return null;
    // The post-write bridge only applies to the submission it was created for.
    // If the thread's newest is now a DIFFERENT submission (the group resubmitted
    // between the write and the refetch), fall through to the thread's own newest
    // evaluation so we never render/PATCH the previous submission's evaluation
    // against a newer one.
    if (stateLatestEvaluation != null && stateLatestEvaluation.submission_id === newest?.id) {
      return stateLatestEvaluation;
    }
    return newest?.evaluation ?? null;
  });

  const panelStatus = $derived.by<MpGroupStatus>(() => {
    // Badge only renders for submission targets; this fallback is dead code that
    // must still typecheck (ProgressTarget has no `entry`), so return a valid status.
    if (target.kind !== 'submission') return 'not_submitted';
    if (newest == null) return 'not_submitted';
    return resultToStatus(effectiveEvaluation?.result ?? null);
  });

  function loadThread(runId: number, mpId: number, groupId: number) {
    threadCtl?.abort();
    const ctl = new AbortController();
    threadCtl = ctl;
    threadLoading = true; threadError = false; threadState = null;
    getSubmissionThread(runId, mpId, groupId, { signal: ctl.signal })
      .then((res) => {
        if (ctl.signal.aborted) return;
        threadState = res.submissions;
        threadLoading = false;
        // Drop the post-write bridge once the refetch supersedes it: the newest
        // submission now carries its own evaluation, OR the newest is a DIFFERENT
        // submission than the bridge was created for (a concurrent resubmission
        // landed). Never on an empty thread (keeps the create-then-edit flat eval)
        // and never mid-edit (would reset the in-progress form).
        const newestAfter = res.submissions.length > 0 ? res.submissions[0] : null;
        if (
          !editing &&
          stateLatestEvaluation != null &&
          newestAfter != null &&
          (newestAfter.evaluation != null || newestAfter.id !== stateLatestEvaluation.submission_id)
        ) {
          stateLatestEvaluation = null;
        }
      })
      .catch((err: unknown) => {
        if (ctl.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
        threadError = true; threadLoading = false;
      });
  }

  async function retryThread() {
    if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
      loadThread(submissionRunId, submissionMpId, submissionGroupId);
    }
    // §Focus: Retry leaves with the error line; the panel title takes focus.
    await tick();
    focusFirst([titleEl]);
  }

  function toggleThreadEntry(id: number) {
    expandedById = { ...expandedById, [id]: !expandedById[id] };
  }

  const existingHasFeedbackFile = $derived(effectiveEvaluation?.has_feedback_file ?? false);
  const resultLocked = $derived(editing && effectiveEvaluation != null && !effectiveEvaluation.has_feedback_file);

  $effect(() => {
    if (effectiveEvaluation == null) return;
    raceTransition = false;
    if (!raceFocusPending) return;
    raceFocusPending = false;
    // P52: move to the winning card unless the teacher has moved on from ×.
    tick().then(() => {
      const active = document.activeElement;
      if (active === document.body || active === closeX()) focusFirst([evalHead()]);
    });
  });

  $effect(() => {
    if (editing && effectiveEvaluation) {
      formResult = effectiveEvaluation.result as EvaluationResult;
      formScore = effectiveEvaluation.score;
      formFeedbackText = effectiveEvaluation.feedback_text ?? '';
      formFeedbackFile = null;
      fileError = null;
      prefillSnapshot = {
        result: effectiveEvaluation.result as EvaluationResult,
        score: effectiveEvaluation.score,
        feedback_text: effectiveEvaluation.feedback_text ?? '',
      };
      // §Focus: Edit → the checked Result radio (Accepted when locked).
      tick().then(() => focusFirst([checkedRadio(), acceptedRadio()]));
    }
  });

  const isDirty = $derived.by(() => {
    if (prefillSnapshot) {
      return (
        formResult !== prefillSnapshot.result ||
        formScore !== prefillSnapshot.score ||
        formFeedbackText !== prefillSnapshot.feedback_text ||
        formFeedbackFile !== null
      );
    }
    return (
      formResult !== '' ||
      formScore !== null ||
      formFeedbackText !== '' ||
      formFeedbackFile !== null
    );
  });

  // The discard confirm in Modal's footer. R36: Discard after the form's
  // Cancel ends the edit; after × or Esc it closes the panel. Cancel returns
  // focus to where it was when the confirm opened.
  let confirmDiscard = $state(false);
  let discardSource: 'cancel' | 'close' = 'close';
  let discardReturnEl: HTMLElement | null = null;

  function askDiscard(source: 'cancel' | 'close') {
    discardSource = source;
    discardReturnEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmDiscard = true;
  }

  const feedbackCharCount = $derived(formFeedbackText.length);
  const counterApproaching = $derived(feedbackCharCount >= 900);

  // aria-live region emits a CONSTANT string when over threshold so SRs announce
  // ONCE (on the empty→constant transition at 900), NOT on every keystroke after.
  // Going below 900 makes the live region empty again (no announcement on empty).
  const announcedCounter = $derived(counterApproaching ? 'Approaching limit' : '');

  const errors = $derived.by(() => {
    const e: { result?: string; score?: string; feedbackText?: string; feedbackFile?: string } = {};
    if (formResult === '' && formSubmitAttempted) {
      e.result = 'Result is required.';
    }
    if (formScore !== null && !Number.isNaN(formScore)) {
      if (!Number.isInteger(formScore) || formScore < 0 || formScore > 100) {
        e.score = 'Score must be a whole number between 0 and 100.';
      }
    }
    const requiresFeedback = formResult !== '' && formResult !== 'accepted';
    if (requiresFeedback) {
      if (formFeedbackText.trim() === '') {
        e.feedbackText = 'Feedback is required when the result is not Accepted.';
      }
      if (!formFeedbackFile && !existingHasFeedbackFile) {
        e.feedbackFile = 'PDF file required for non-accepted results.';
      }
    }
    if (fileError) e.feedbackFile = fileError;
    return e;
  });

  // `valid` deliberately ignores `errors.result` (which only surfaces post-attempt
  // for UX) — the native `disabled` covers it pre-attempt.
  const valid = $derived(formResult !== '' && !errors.score && !errors.feedbackText && !errors.feedbackFile);

  // Save's reason while it is disabled; the first match wins.
  const saveTitle = $derived(
    formResult === ''
      ? 'Choose a result'
      : errors.score
        ? 'Score must be a whole number between 0 and 100'
        : errors.feedbackText
          ? 'Write feedback for a non-accepted result'
          : errors.feedbackFile
            ? 'Attach the feedback PDF'
            : undefined,
  );

  const resultDescribedby = $derived(
    [errors.result ? 'evaluation-result-error' : null, resultLocked ? 'evaluation-result-lock' : null]
      .filter(Boolean)
      .join(' ') || undefined,
  );

  function resetForm() {
    formResult = '';
    formScore = null;
    formFeedbackText = '';
    formFeedbackFile = null;
    fileError = null;
    prefillSnapshot = null;
    formSubmitAttempted = false;
  }

  // §Focus: after a save, an edit's Cancel or a Discard from Cancel.
  async function focusAfterEdit() {
    await tick();
    focusFirst([editBtn(), evalHead()]);
  }

  function firstErroredField(): HTMLElement | null {
    if (errors.result) return find('input[name="evaluation-result"]:not(:disabled)');
    if (errors.score) return find('#evaluation-score');
    if (errors.feedbackText) return find('#evaluation-feedback');
    if (errors.feedbackFile) return find('[data-action="attach-feedback-file"]');
    return null;
  }

  async function handleSave() {
    formSubmitAttempted = true; // surfaces errors.result = 'Result is required.' if blank
    // R44: a second submit while saving does nothing.
    if (!valid || submitting) return;
    submitting = true;
    serverError = null;
    submitController = new AbortController();
    timeoutHandle = setTimeout(() => submitController?.abort('timeout'), SUBMIT_TIMEOUT_MS);
    let outcome: 'saved' | 'race' | 'failed' = 'failed';
    try {
      let result: Evaluation;
      if (effectiveEvaluation == null) {
        if (target.kind !== 'submission' || newest == null) throw new Error('handleSave called with no submission');
        result = await createEvaluation({
          submission_id: newest.id,
          result: formResult as EvaluationResult,
          score: formScore,
          feedback_text: formFeedbackText || null,
          feedback_file: formFeedbackFile,
        }, { signal: submitController.signal });
      } else {
        result = await patchEvaluation(effectiveEvaluation.id, {
          result: formResult as EvaluationResult,
          score: formScore,
          feedback_text: formFeedbackText || null,
        }, { signal: submitController.signal });
      }
      stateLatestEvaluation = result;
      editing = false;
      // Reset form/dirty state so a later × or Esc doesn't trip the dirty
      // check against stale post-save values. Edit re-prefills from the bridge.
      resetForm();
      pushToast('Evaluation saved; group notified', 'success');
      onRefetch();
      if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
        loadThread(submissionRunId, submissionMpId, submissionGroupId);
      }
      outcome = 'saved';
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        raceTransition = true;
        editing = false;
        raceFocusPending = true;
        onRefetch();
        if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
          loadThread(submissionRunId, submissionMpId, submissionGroupId);
        }
        outcome = 'race';
      } else if ((e as { name?: string })?.name === 'AbortError') {
        const reason = (submitController?.signal as AbortSignal & { reason?: unknown })?.reason;
        // A user cancel reverts silently; a timeout says so.
        if (reason === 'timeout') serverError = 'Upload timed out. Try again.';
      } else if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        serverError = 'Unexpected error';
      }
    } finally {
      submitting = false;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      submitController = null;
    }
    // §Focus, after the un-freeze: Edit (else the Evaluation <h3>) after a
    // save; the <h3> (else ×) after a 409; the first errored field (else Save
    // evaluation) after a failure or a cancelled upload.
    await tick();
    if (outcome === 'saved') focusFirst([editBtn(), evalHead()]);
    else if (outcome === 'race') focusFirst([evalHead(), closeX()]);
    else focusFirst([firstErroredField(), saveEl]);
  }

  function startEdit() {
    raceFocusPending = false;
    editing = true;
  }

  function handleCancel() {
    if (submitting) {
      submitController?.abort('user-cancel');
      return;
    }
    if (isDirty) {
      askDiscard('cancel');
      return;
    }
    editing = false;
    resetForm();
    void focusAfterEdit();
  }

  function tryClose() {
    if (submitting) return;
    // × (or Esc on ×) while the confirm asks: go to its Cancel, don't ask twice.
    if (confirmDiscard) {
      discardEl?.querySelector<HTMLButtonElement>('button.cancel')?.focus();
      return;
    }
    if (isDirty) {
      askDiscard('close');
      return;
    }
    onClose();
  }

  function discard() {
    confirmDiscard = false;
    if (discardSource === 'close') {
      onClose();
      return;
    }
    editing = false;
    resetForm();
    void focusAfterEdit();
  }

  async function cancelDiscard() {
    confirmDiscard = false;
    await tick();
    focusFirst([discardReturnEl, checkedRadio(), closeX()]);
  }

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    fileError = null;
    if (!file) { formFeedbackFile = null; return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      fileError = 'Only PDF files accepted.';
      formFeedbackFile = null; return;
    }
    if (file.type !== '' && file.type !== 'application/pdf') {
      fileError = 'Only PDF files accepted.';
      formFeedbackFile = null; return;
    }
    if (file.size === 0) {
      fileError = 'File appears empty.';
      formFeedbackFile = null; return;
    }
    if (file.size > MAX_FEEDBACK_FILE_SIZE_BYTES) {
      fileError = 'File exceeds 20 MB limit.';
      formFeedbackFile = null; return;
    }
    formFeedbackFile = file;
    // §Focus: a chosen file → its remove ×.
    await tick();
    focusFirst([find('[data-action="remove-feedback-file"]')]);
  }

  async function removeFile() {
    formFeedbackFile = null;
    fileError = null;
    if (fileInputEl) fileInputEl.value = '';
    // §Focus: remove → "attach PDF".
    await tick();
    focusFirst([find('[data-action="attach-feedback-file"]')]);
  }

  // Progress fetch state — only relevant when target.kind === 'progress'.
  let data = $state<SequenceItemStateResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let abortCtl: AbortController | null = null;

  $effect(() => {
    abortCtl?.abort();
    if (target.kind !== 'progress') {
      data = null; loading = false; error = null;
      return;
    }
    const ctl = new AbortController();
    abortCtl = ctl;
    loading = true; error = null; data = null;
    getSequenceItemState(target.runId, target.user_id, target.sequence_id, { signal: ctl.signal })
      .then((res) => { data = res; loading = false; })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // One message for every fetch error, 404 included.
        error = 'Item details unavailable. The dashboard may be out of date — close this panel and refresh the table.';
        loading = false;
      });
    return () => ctl.abort();
  });

  // Thread fetch — keyed on the gated primitive ids only (see their comment).
  // Fires once per (cell + cell-submission/eval-id state): on a genuine cell switch
  // AND when an external grid refresh lands a new submission/evaluation for the same
  // cell. `loadThread` nulls `threadState` on every fire, so a cell switch shows the
  // new cell's own optimistic newest rather than the previous cell's thread[0].
  //
  // NOTE: it deliberately does NOT reset `expandedById`. That map is keyed by
  // globally-unique submission id, so a switched-away cell's keys are inert (no other
  // cell can carry the same submission id) — while NOT clearing it is exactly what
  // makes a write survive the post-write refire without collapsing expanded history
  // (spec §6.2). Clearing it here would collapse an expanded older entry every time a
  // create write's onRefetch changes the cell's evaluation id.
  $effect(() => {
    const runId = submissionRunId;
    const mpId = submissionMpId;
    const groupId = submissionGroupId;
    // Track the cell's submission/eval ids too, so an external grid refresh that
    // changes either re-fetches the thread (see their declaration comment). `void`
    // reads register the reactive dependency without using the values.
    void submissionLatestSubId;
    void submissionLatestEvalId;
    threadCtl?.abort();
    if (runId == null || mpId == null || groupId == null) {
      threadState = null; threadLoading = false; threadError = false;
      return;
    }
    loadThread(runId, mpId, groupId);
    return () => threadCtl?.abort();
  });

  // Unmount-only cleanup for any in-flight panel fetch (mirrors the tab pattern).
  $effect(() => () => abortCtl?.abort());

  // The header: the block title (6a D6) and "{Group} · B2" for a submission;
  // the student and "{Block} — {Sequence}" for progress, "Item details" until
  // they load, so the dialog is always named.
  const title = $derived(
    target.kind === 'submission'
      ? target.mp.block_title
      : data
        ? (data.student.full_name ?? data.student.email)
        : 'Item details',
  );
  const subtitle = $derived(
    target.kind === 'submission'
      ? (blockLabel ? `${target.entry.group_name} · ${blockLabel}` : target.entry.group_name)
      : data
        ? `${data.sequence.block_title} — ${data.sequence.sequence_title}`
        : '',
  );
</script>

{#snippet head()}
  <div class="sp-titles">
    <h2 class="sp-title" id={titleId} tabindex="-1" bind:this={titleEl}>{title}</h2>
    {#if subtitle}<p class="sp-sub">{subtitle}</p>{/if}
  </div>
  {#if target.kind === 'submission'}
    <StatusBadge status={panelStatus} label={STATUS_SHORT_LABEL[panelStatus]} />
  {/if}
{/snippet}

{#snippet discardFooter()}
  <div class="sp-discard" bind:this={discardEl}>
    <InlineConfirm
      row
      takeFocus
      warning="Discard unsaved changes?"
      confirmLabel="Discard"
      confirmDataAction="confirm-discard"
      onConfirm={discard}
      onCancel={cancelDiscard}
    />
  </div>
{/snippet}

{#snippet evaluationCard(ev: EvaluationView, evaluated: string, withEdit: boolean)}
  <section class="sp-card" aria-labelledby="{uid}-eval" data-test="evaluation-card">
    <div class="sp-card-head">
      <h3 class="sp-h" id="{uid}-eval" tabindex="-1">Evaluation</h3>
      {#if withEdit}
        <Button variant="secondary" data-test="edit-evaluation" onclick={startEdit}>Edit</Button>
      {/if}
    </div>
    <div class="sp-card-body">{@render evaluationContent(ev, evaluated)}</div>
  </section>
{/snippet}

{#snippet evaluationForm(mode: 'create' | 'edit')}
  {@const requiredHint = formResult === 'accepted' ? '(optional)' : '(required)'}
  <section class="sp-card sp-evaluate" aria-labelledby="{uid}-form">
    <div class="sp-card-head sp-evaluate-head">
      <h3 class="sp-h" id="{uid}-form">Evaluate</h3>
    </div>
    <form class="sp-form" aria-label="Write evaluation" onsubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      <fieldset
        id="evaluation-result"
        class="sp-result"
        role="radiogroup"
        aria-required="true"
        aria-describedby={resultDescribedby}
        disabled={submitting}
      >
        <legend class="sp-legend">Result <span class="sp-hint">(required)</span></legend>
        <div class="sp-seg">
          {#each RESULT_ORDER as r (r)}
            {@const locked = resultLocked && r !== 'accepted'}
            <label class="sp-seg-opt" class:checked={formResult === r} class:locked title={locked ? LOCK_TEXT : undefined}>
              <input
                class="sp-radio"
                type="radio"
                name="evaluation-result"
                value={r}
                bind:group={formResult}
                disabled={locked}
                title={locked ? LOCK_TEXT : undefined}
              />
              <span>{RESULT_LABEL[r]}</span>
            </label>
          {/each}
        </div>
        {#if errors.result}<p class="sp-field-err" id="evaluation-result-error" role="alert">{errors.result}</p>{/if}
        {#if resultLocked}<p class="sp-lock" id="evaluation-result-lock">{LOCK_TEXT}</p>{/if}
      </fieldset>

      <div class="sp-fields">
        <div class="sp-field">
          <label class="sp-label" for="evaluation-feedback">Feedback <span class="sp-hint">{requiredHint}</span></label>
          <textarea
            id="evaluation-feedback"
            name="evaluation-feedback"
            class="sp-textarea"
            maxlength="1000"
            readonly={submitting}
            bind:value={formFeedbackText}
            aria-invalid={errors.feedbackText ? 'true' : undefined}
            aria-describedby={errors.feedbackText ? 'evaluation-feedback-count evaluation-feedback-error' : 'evaluation-feedback-count'}
          ></textarea>
          <span id="evaluation-feedback-count" class="sp-count" data-test="feedback-counter-visible">
            {feedbackCharCount} / 1000{#if counterApproaching}<strong> — approaching limit</strong>{/if}
          </span>
          <span class="sp-sr" data-test="feedback-counter-live" aria-live="polite">{announcedCounter}</span>
          {#if errors.feedbackText}<p class="sp-field-err" id="evaluation-feedback-error" role="alert">{errors.feedbackText}</p>{/if}
        </div>
        <div class="sp-field">
          <label class="sp-label" for="evaluation-score">Score <span class="sp-hint">(optional, 0–100)</span></label>
          <input
            id="evaluation-score"
            name="evaluation-score"
            class="sp-input"
            type="number"
            min="0"
            max="100"
            step="1"
            readonly={submitting}
            value={formScore ?? ''}
            oninput={(e) => {
              const v = e.currentTarget.value;
              formScore = v === '' ? null : Number(v);
            }}
            aria-invalid={errors.score ? 'true' : undefined}
            aria-describedby={errors.score ? 'evaluation-score-error' : undefined}
          />
          {#if errors.score}<p class="sp-field-err" id="evaluation-score-error" role="alert">{errors.score}</p>{/if}
        </div>
      </div>

      {#if serverError}<p class="sp-error form-error" role="alert">{serverError}</p>{/if}

      <div class="sp-bottom">
        <!-- The file control is inert while a save runs (the attribute, not the
             property: jsdom lacks `inert`). -->
        <div class="sp-file-ctl" {@attach (el) => { el.toggleAttribute('inert', submitting); }}>
          {#if mode === 'create'}
            <span class="sp-file-line">
              <span id="{uid}-file-label">Feedback file <span class="sp-hint">{requiredHint}</span></span>
              {#if formFeedbackFile}
                <span class="sp-chosen">
                  <span class="sp-chosen-name">{formFeedbackFile.name}</span>
                  <span class="sp-chosen-size">· {formatFileSize(formFeedbackFile.size)}</span>
                  <IconButton
                    glyph="close"
                    size="sm"
                    borderless
                    title="Remove {formFeedbackFile.name}"
                    data-action="remove-feedback-file"
                    onclick={removeFile}
                  />
                </span>
              {:else}
                <span aria-hidden="true">—</span>
                <button
                  type="button"
                  class="sp-link"
                  data-action="attach-feedback-file"
                  aria-describedby="{uid}-file-label {uid}-file-help"
                  onclick={() => fileInputEl?.click()}
                >attach PDF</button>
              {/if}
            </span>
            <input
              bind:this={fileInputEl}
              id="evaluation-file"
              name="evaluation-file"
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onchange={handleFileChange}
            />
            <span class="sp-help" id="{uid}-file-help">PDF only, max 20 MB.</span>
            {#if errors.feedbackFile}<p class="sp-field-err" role="alert">{errors.feedbackFile}</p>{/if}
          {:else if existingHasFeedbackFile}
            <p class="sp-muted">The feedback file cannot be replaced.</p>
          {/if}
        </div>
        <div class="sp-actions">
          {#if editing || submitting}
            <Button variant="secondary" data-test="cancel-button" onclick={handleCancel}>{submitting ? 'Cancel upload' : 'Cancel'}</Button>
          {/if}
          <Button
            type="submit"
            bind:element={saveEl}
            loading={submitting}
            aria-disabled={submitting}
            disabled={!valid && !submitting}
            title={submitting ? SAVE_WAIT : saveTitle}
          >{submitting ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </form>
  </section>
{/snippet}

<Modal
  placement="right"
  width={520}
  labelledby={titleId}
  closeDisabled={submitting}
  closeTitle={SAVE_WAIT}
  bodyInert={confirmDiscard}
  autofocusSelector={AUTOFOCUS}
  onRequestClose={tryClose}
  header={head}
  footer={confirmDiscard ? discardFooter : undefined}
>
  {#if target.kind === 'progress'}
    {#if loading}
      <p class="sp-muted">Loading…</p>
    {:else if error}
      <p class="sp-error" role="alert">{error}</p>
    {:else if data}
      {#if data.items.length === 0}
        <p class="sp-muted">No items in this sequence.</p>
      {:else}
        <ProgressBreakdown items={data.items} />
      {/if}
    {/if}
  {:else if newest == null}
    <p class="sp-muted">Not submitted yet.</p>
  {:else}
    {@const sub = newest}
    <section class="sp-card" aria-labelledby="{uid}-latest">
      <div class="sp-card-head">
        <h3 class="sp-h" id="{uid}-latest">Latest submission</h3>
        {@render submissionChips(sub)}
      </div>
      <div class="sp-card-body">{@render submissionContent(sub)}</div>
    </section>

    {#if sub.is_resubmission}
      <p class="sp-info banner-info" role="status">Auto-accepted on resubmission. No manual evaluation needed.</p>
      {#if sub.evaluation}
        {@render evaluationCard(sub.evaluation, evaluatedLine(sub.evaluation), false)}
      {/if}
    {:else if effectiveEvaluation && !editing}
      {@render evaluationCard(
        effectiveEvaluation,
        sub.evaluation ? evaluatedLine(sub.evaluation) : 'You · Just now',
        canWrite,
      )}
    {:else if effectiveEvaluation && canWrite}
      {@render evaluationForm('edit')}
    {:else if !effectiveEvaluation && canWrite && !raceTransition}
      {@render evaluationForm('create')}
    {:else}
      <p class="sp-muted" data-test="awaiting-evaluation-placeholder">Awaiting evaluation</p>
    {/if}

    {#if threadLoading}
      <p class="sp-muted" data-test="thread-loading">Loading earlier submissions…</p>
    {:else if threadError}
      <p class="sp-error" role="alert" data-test="thread-error">
        Couldn't load submission history.
        <button type="button" class="sp-link" data-test="thread-retry" onclick={retryThread}>Retry</button>
      </p>
    {:else if threadState && threadState.length > 1}
      <section class="sp-card" aria-labelledby="{uid}-earlier">
        <div class="sp-card-head">
          <h3 class="sp-h" id="{uid}-earlier">Earlier submissions</h3>
          <span class="sp-count-n">{threadState.length - 1}</span>
        </div>
        <div data-test="thread-history">
          {#each threadState.slice(1) as histSub (histSub.id)}
            <SubmissionThreadEntry
              submission={histSub}
              expanded={!!expandedById[histSub.id]}
              onToggle={() => toggleThreadEntry(histSub.id)}
            />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
  <DirtyGuard isDirty={() => isDirty && !submitting} />
</Modal>

<style>
  .sp-titles { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
  .sp-title {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .sp-sub {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .sp-muted { margin: 0; font-size: 13px; color: var(--muted); }
  /* The 6a error and info banners. */
  .sp-error {
    margin: 0;
    padding: 8px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--status-rejected-fg);
  }
  .sp-info {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text-2);
  }
  .sp-link {
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: var(--primary);
    text-decoration: underline;
    cursor: pointer;
  }
  .sp-discard { flex: 1 1 auto; font-size: 13px; color: var(--text-2); }

  /* Cards (9b): a --surface-2 head strip holding an <h3>. */
  .sp-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
  }
  .sp-card-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .sp-h {
    flex: 1 1 auto;
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .sp-card-body { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
  .sp-count-n { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }

  /* The Evaluate card: a --primary border with a --primary-soft halo and head. */
  .sp-evaluate {
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .sp-evaluate-head { background: var(--primary-soft); }
  .sp-form { display: flex; flex-direction: column; gap: 10px; padding: 12px; }

  /* R37: four native radios drawn as a segmented control. */
  .sp-result { min-width: 0; margin: 0; padding: 0; border: 0; }
  .sp-legend { margin: 0 0 6px; padding: 0; font-size: 12.5px; font-weight: 500; color: var(--text-3); }
  .sp-hint { font-weight: 400; color: var(--muted); }
  .sp-seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .sp-seg-opt {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px 0;
    font-size: 12.5px;
    color: var(--muted);
    background: var(--surface);
    border-left: 1px solid var(--border);
    cursor: pointer;
  }
  .sp-seg-opt:first-child { border-left: 0; }
  .sp-seg-opt.checked {
    color: var(--text);
    font-weight: 500;
    background: var(--primary-soft);
  }
  .sp-seg-opt.locked { color: var(--faint); cursor: not-allowed; }
  .sp-seg-opt:has(.sp-radio:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }
  .sp-radio {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .sp-lock { margin: 6px 0 0; font-size: 12px; color: var(--muted); }

  /* P53: top-aligned, so an error or the counter under Feedback leaves Score in place. */
  .sp-fields {
    display: grid;
    grid-template-columns: 1fr 96px;
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 480px) {
    .sp-fields { grid-template-columns: 1fr; }
  }
  .sp-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .sp-label { font-size: 12.5px; font-weight: 500; color: var(--text-3); }
  .sp-textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 54px;
    padding: var(--control-pad-textarea);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-2);
    resize: vertical;
  }
  .sp-textarea[aria-invalid='true'] { border-color: var(--danger); }
  .sp-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: var(--control-font);
    color: var(--text);
  }
  .sp-input[aria-invalid='true'] { border-color: var(--danger); }
  .sp-count { font-size: 11.5px; color: var(--muted); }
  .sp-field-err { margin: 0; font-size: 12px; color: var(--danger); }
  .sp-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* The bottom row: the feedback-file control left, Save right. */
  .sp-bottom { display: flex; align-items: center; gap: 9px; }
  .sp-file-ctl {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .sp-file-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .sp-chosen { display: inline-flex; align-items: center; gap: 4px; min-width: 0; color: var(--text); }
  .sp-chosen-name { overflow-wrap: anywhere; }
  .sp-chosen-size { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
  .sp-help { font-size: 11.5px; color: var(--muted); }
  .sp-actions { display: flex; align-items: center; gap: 9px; margin-left: auto; }
</style>
```

Notes for the reviewer:
- **R37:** the Result is a `fieldset role="radiogroup"` of four native radios with `bind:group`. The legend is the visible "Result (required)". `aria-describedby` lists the error and the lock line only while they show. `disabled` while saving freezes the whole group.
- **R44:** Save passes `aria-disabled={submitting}` and `loading={submitting}`. Task 2's Button then sets `aria-disabled="true"` and `aria-busy="true"` without native `disabled`, so focus stays. `handleSave` returns at once while `submitting`.
- **Edit mode:** the PATCH carries no file, but while it runs the Cancel button still reads "Cancel upload" and aborts it, as today.
- **`{@attach}` for `inert`:** jsdom has no `inert` property, so the attachment toggles the attribute (Modal's `bodyInert` does the same).

- [ ] **Step 6: `blockLabel` from the Submissions tab (R35)**

In `frontend/src/components/runs/RunSubmissionTab.svelte`:

1. After the `line2` function (it starts right under `const blockPos = $derived(blockPositions(blocks));`), insert after its closing `}`:

```ts

  // R35: the side panel's "B2", from the same positions as line 2.
  function blockLabelOf(mp: DashboardMpRow): string | undefined {
    const n = blockPos.get(mp.block_id);
    return n === undefined ? undefined : `B${n}`;
  }
```

2. Replace

```svelte
            onRefetch={refresh}
          />
```

with

```svelte
            onRefetch={refresh}
            blockLabel={blockLabelOf(panelTarget.mp)}
          />
```

- [ ] **Step 7: Run the tests**

Run the Step 2 command, then `TZ=Europe/Copenhagen npx vitest run src/tests/RunProgressTab.svelte.test.ts src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts src/tests/Modal.svelte.test.ts`. Expected: PASS, exit 0, no "Errors" / "Unhandled" line.

- [ ] **Step 8: Gate rows**

In `frontend/scripts/visual-refresh-gate.sh`:

1. **`FILES_6C`**: inside the array, after Task 5's `src/components/runs/ProgressBreakdown.svelte` line, add:

```zsh
  src/components/runs/DashboardSidePanel.svelte
  src/components/runs/SubmissionCards.svelte src/components/runs/SubmissionThreadEntry.svelte
```

2. **Section (al)**: append after Task 5's block, still before `# The summary line is the parent process's (see the re-exec at the top).`:

```zsh

# 6c T6 — the side panel's cards and Evaluate form (9b, R37, R43).
own sp-card DashboardSidePanel.svelte
uniq1 sp-card
if [[ -n $REPLY ]]; then
  N=DashboardSidePanel; H=$REPLY
  d '\.sp-card' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden' 'background:var\(--surface\)'
  d '\.sp-card-head' '' 'display:flex' 'align-items:center' 'gap:9px' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.sp-h' '' 'margin:0' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.sp-evaluate' '' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  d '\.sp-evaluate-head' '' 'background:var\(--primary-soft\)'
  d '\.sp-seg' '' 'display:flex' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden'
  d '\.sp-seg-opt' '' 'flex:1' 'padding:3px 0' 'font-size:12\.5px' 'color:var\(--muted\)' 'background:var\(--surface\)' 'border-left:1px solid var\(--border\)'
  d '\.sp-seg-opt\.checked' '' 'color:var\(--text\)' 'font-weight:500' 'background:var\(--primary-soft\)'
  d '\.sp-fields' '' 'display:grid' 'grid-template-columns:1fr 96px' 'gap:12px'
  check "DashboardSidePanel Feedback and Score stack below 480px" "@media \(max-width: ?480px\)\{\.sp-fields\.${H}\{grid-template-columns:1fr\}"
  d '\.sp-info' '' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)'
  none "DashboardSidePanel's old banner, form-error and helper rules are gone" "\.(banner-info|banner-error|form-error|helper-text)\.${H}[{ ,:.]"
  sweep DashboardSidePanel $H
fi
SP=src/components/runs/DashboardSidePanel.svelte
if grep -q '<select' $SP; then
  echo "FAIL  DashboardSidePanel's Result is radios, not a select (R37)"; fail=1
else
  echo "PASS  DashboardSidePanel's Result is radios, not a select (R37)"
fi
if [[ $(grep -c 'aria-label="Write evaluation"' $SP) -eq 1 ]]; then
  echo "PASS  DashboardSidePanel renders one evaluationForm for create and edit (R43)"
else
  echo "FAIL  DashboardSidePanel renders one evaluationForm for create and edit (R43)"; fail=1
fi
if grep -q 'blockLabel=' src/components/runs/RunSubmissionTab.svelte; then
  echo "PASS  RunSubmissionTab passes the panel its block label (R35)"
else
  echo "FAIL  RunSubmissionTab passes the panel its block label (R35)"; fail=1
fi
own sc-rows SubmissionCards.svelte
uniq1 sc-rows
if [[ -n $REPLY ]]; then
  N=SubmissionCards; H=$REPLY
  d '\.sc-rows' '' 'display:grid' 'grid-template-columns:104px 1fr' 'gap:6px 12px' 'font-size:12\.5px'
  d '\.sc-k' '' 'color:var\(--muted\)'
  d '\.sc-chip' '' 'padding:3px 8px' 'border-radius:var\(--radius-pill\)' 'background:var\(--surface-2\)' 'color:var\(--text-3\)' 'font-size:11px' 'font-weight:500'
  d '\.sc-late' '' 'background:var\(--status-needs-revision-bg\)' 'color:var\(--status-needs-revision-fg\)'
  d '\.sc-file' '' 'display:flex' 'align-items:center' 'gap:9px' 'padding:8px 10px' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface-3\)'
  d '\.sc-tile' '' 'width:32px' 'height:28px' 'border-radius:4px' 'background:var\(--surface-2\)' 'font-family:var\(--font-mono\)' 'font-size:9\.5px' 'font-weight:600' 'color:var\(--muted\)'
  d '\.sc-file-meta' '' 'font-family:var\(--font-mono\)' 'font-size:11\.5px' 'color:var\(--muted\)'
  sweep SubmissionCards $H
fi
own te-toggle SubmissionThreadEntry.svelte
uniq1 te-toggle
if [[ -n $REPLY ]]; then
  N=SubmissionThreadEntry; H=$REPLY
  d '\.te-toggle' '' 'display:flex' 'align-items:center' 'gap:9px' 'width:100%' 'padding:9px 12px'
  d '\.te-entry' '' 'border-bottom:1px solid var\(--border-soft\)'
  d '\.te-date' '' 'font-family:var\(--font-mono\)' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.te-badge' '' 'margin-left:auto'
  none "SubmissionThreadEntry's old banner rule is gone" "\.banner-info\.${H}[{ ,:.]"
  sweep SubmissionThreadEntry $H
fi
```

3. Set `EXPECTED_CHECKS=2062` (1968 + 94: the panel 41 (`own` 1, `uniq1` 1, `d` declarations 4+6+4+2+1+4+6+3+3+2 = 35, the media `check` 1, `none` 1, `sweep` 2); three source checks 3; SubmissionCards 35 (`own` 1, `uniq1` 1, 4+1+6+2+7+8+3 = 31, `sweep` 2); SubmissionThreadEntry 15 (`own` 1, `uniq1` 1, 5+1+3+1 = 10, `none` 1, `sweep` 2). The new `FILES_6C` entries add 0 lines; `emoji_scan` and `colour_scan` now read them).

- [ ] **Step 9: Run the full checks**

As Global Constraints › Commands. Expected:
- vitest green;
- svelte-check 0 errors, 13 warnings;
- gate `ALL PASS (2062 checks)`.

If a `.sp-seg-opt` or media row fails only on the emitted form, read the rule from `dist/_app/*.css` and follow the head's minifier rule.

- [ ] **Step 10: Screenshots for the user**

Before any click, route both evaluation writes:
- `agent-browser network route "**/api/submissions/*/evaluation"` → status 201 with `{"id":9001,"submission_id":1,"result":"accepted","score":null,"feedback_text":null,"has_feedback_file":false,"evaluated_at":"2026-10-13T10:00:00Z","evaluated_by":1}`;
- `"**/api/evaluations/*"` → status 200 with the same body.

Keep both routes until the last shot. No real write reaches the dev database, and no file is chosen in the browser. Shots at 1280 and 1000 (`?tab=submissions` on run 8):
1. An "awaiting eval" cell: the header "{Group} · B{n}", the Latest submission card with its file card, the Evaluate card with no result picked (hover Save for "Choose a result").
2. The same after picking Major revision and typing feedback: "(required)" labels, "attach PDF", the counter.
3. Picking Accepted, then Save (mocked 201): the read-only Evaluation card "You · Just now" with Edit focused.
4. A "needs revision" cell: the Evaluation card with "Minor revision" / "Major revision", then Edit: the form pre-filled (and, if a no-file evaluation exists in dev data, the lock line).
5. A group with two or more submissions: the "Earlier submissions" card, one row opened.
6. `?tab=progress`: the drawer again (Task 5's Items card) to confirm nothing moved.

Overlay with `ref/9b.png` beside the shots (`--size-percent 60`, base64 images); wait for the user's OK. Clear the routes.

- [ ] **Step 11: Review lanes**

Opus (high) + Fable on the uncommitted diff, including the new files. Point them at:
- R37, R43 and R44;
- §Focus › Side panel, rule by rule;
- the "Hooks that stay" list for the panel;
- the select-to-radio test migration, which must change selectors without dropping an assertion's intent (spec: "updated, not removed").

Fix every Critical and Important finding and re-run both lanes after every fix until clean. Minors → backlog "## Task 6 — Submission cards and evaluation form".

- [ ] **Step 12: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/runs/SubmissionCards.svelte frontend/src/components/runs/SubmissionThreadEntry.svelte \
  frontend/src/components/runs/DashboardSidePanel.svelte frontend/src/components/runs/RunSubmissionTab.svelte \
  frontend/src/components/ui/Button.svelte frontend/src/lib/dashboards.ts frontend/src/lib/datetime.ts \
  frontend/src/tests/SubmissionCards.svelte.test.ts frontend/src/tests/support/SubmissionCardsHarness.svelte \
  frontend/src/tests/DashboardSidePanel.svelte.test.ts frontend/src/tests/SubmissionThreadEntry.svelte.test.ts \
  frontend/src/tests/RunSubmissionTab.svelte.test.ts frontend/src/tests/Button.svelte.test.ts \
  frontend/src/tests/dashboards.test.ts frontend/src/tests/datetime.test.ts frontend/scripts/visual-refresh-gate.sh
git commit -m "$(cat <<'EOF'
feat(6c): the side panel's submission cards and Evaluate form (R35, R37, R43, R44)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Add `docs/backlog/slice6c-teacher-overview-roster-panel-debt.md` to the `git add` if the lanes left minors. Then the ledger line in `$SDD/progress.md`, memory, and wait for "go". Task 6 is the last task: the whole-branch review and the Safari pass follow on the user's go.

---
