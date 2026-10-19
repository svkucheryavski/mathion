# Polish 2: named items — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close the six items earlier slices deferred "to the end": a keyboard focus ring people can see (also in High Contrast) and reduced motion; a page ground that reads as depth, with white reading sheets; one style for the content teachers write, with links that look like links and open safely; a styled 404 page; and clickable bare URLs.

**Architecture:**
- **Focus (Task 1).** Four global rules in `base.css` replace the old halo: a 2px `--primary` ring on everything, the old border-and-halo on text fields only, no ring on script focus parking spots (`tabindex="-1"`), and a forced-colors outline. Components drop or inset the ring only where a clip or their own ring needs it.
- **Ground and sheets (Task 2).** Tokens: `--bg` becomes the clear tint `#F2F3F6`, `--focus-page` aliases it, and `--disabled-bg` keeps the old disabled fill. The player's content slot and the mini-project page become white sheets.
- **Authored content (Tasks 3, 4).** One global stylesheet, `styles/content.css`, styles `.prose` (page scale) and `.prose.compact`. Every surface that renders teacher markdown adds the class and the `externalLinks` attachment, which opens external links and Mathion's own files in a new tab. The per-surface `:global` content rules go.
- **404 (Task 5).** `NotFound` becomes a page `ErrorState` whose one button names the start page.
- **Bare URLs (Task 6, backend).** markdown-it's linkify, limited to `http://` and `https://`.

**Tech Stack:**
- **Svelte:** Svelte 5.55, runes only; attachments (`{@attach}`).
- **Frontend tests:** Vitest + jsdom, with `mount` / `unmount` / `flushSync` from `svelte`.
- **Gate:** the zsh gate `frontend/scripts/visual-refresh-gate.sh`; the build is vite 5.4 with esbuild 0.21's minifier.
- **Backend:** Python through `backend/.venv`; markdown-it-py 4.0, nh3; Task 6 adds `linkify-it-py>=2.0`.

**Spec:** `docs/superpowers/specs/2026-10-18-visual-refresh-polish2-named-items-design.md` (rev 5, commit `55be40e`, approved by the user on 2026-10-18; rev 6 adds D60 during Task 1). Its decisions D48–D60, its cascade facts and its gate sections are binding; this plan cites them by name. Decisions log: `.superpowers/sdd/2026-10-17-visual-refresh-polish2-named-items/decisions.md`. Mock-ups: `page-ground-mock.html`, `content-scale-mock.html` in the same folder.

**Line numbers** are from the Polish 1 tip `ba8ace4`. An earlier task shifts them in files it also touches (the gate above all): find the place by the quoted text, which is exact.

## Global Constraints

- **Branch:** `feat/visual-refresh-polish2-named-items` (cut from the Polish 1 tip `ba8ace4`). LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`. Scratch files go in `.superpowers/sdd/2026-10-17-visual-refresh-polish2-named-items/` (`$SDD`: probes in `probe/`, gate temp files and logs in `tmp/`, screenshots in `shots/`), never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. No new npm dependencies; the one new pip dependency is Task 6's `linkify-it-py`.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, NOT `@testing-library/svelte`.
  - Python, pytest and alembic only through `backend/.venv`.
  - Match the surrounding comment density. No comments that narrate the change ("added in Polish 2") beyond the decision tag the codebase already uses (`D56`, `Polish 2 D51`).
- **Colours and glyphs:**
  - No literal colours in component CSS or inline `style=`; theme tokens only (`src/styles/theme-default.css`). System colours (`Highlight`) only inside `@media (forced-colors: active)`.
  - No `opacity` to dim anything.
  - No emoji and no glyph characters from the gate's `emoji_scan` set in component code.
- **Pinned CSS rules are single-selector blocks.** The gate's `d` helper matches `.cls.svelte-HASH{…}`, so a pinned rule never shares a selector list. Svelte hashes the first compound and adds `:where(.svelte-HASH)` to later ones; the minifier keeps the quotes in `[tabindex="-1"]` and the space in `@media (forced-colors: active){`.
- **The gate's markup scanner runs inside `node -e '…'`.** Never put an apostrophe in that payload, comments included.
- **Commands** (`$SDD` stands for `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-17-visual-refresh-polish2-named-items`; write it out in full when you run them):
  - Frontend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. One file: `TZ=Europe/Copenhagen npx vitest run src/tests/<File>.test.ts` from the same directory.
  - Typecheck: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error > $SDD/tmp/svelte-check.log 2>&1; tail -3 $SDD/tmp/svelte-check.log`. It must report 0 errors. 13 warnings is the baseline; a task may not add one.
  - Gate: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. It must end `VISUAL-REFRESH GATE: ALL PASS (N checks)` with the N the task names. Never run it in two lanes at once.
  - Backend tests (Task 6): `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`.
  - Hashless rules as (b4) sees them: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && python3 $SDD/probe/hashless.py [selector-substring]` (after `npm run build`).
  - If a pinned gate row fails only because the minifier wrote a value differently, read the emitted rule (`grep -oE '\.CLASS\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`), match the emitted form, and ledger a ruling. Never loosen a row to make it pass. A hash computed while planning that differs from dist: dist wins, ledgered with both values.
- **Testing CSS** (spec §Testing CSS tasks): jsdom sees neither layout nor the cascade, so for Tasks 1–4 the gate row is the red/green: written first, run red against the old build, then green. Cheap jsdom tests pin what jsdom can see (classes, the attachment, markup order).
- **Per task, in this order** (the user's per-task loop; it overrides "continuous execution"):
  1. TDD, step by step as written.
  2. vitest (green as defined above), svelte-check (0 errors, 13 warnings), the gate (the task's N); for Task 6 also the backend tests.
  3. agent-browser screenshots of the real screens the task names, at 1280 wide (320 where the task says), with network mocks for every write. Show them in an agterm overlay with `--size-percent 60`, images as base64, and the HTML in `$SDD`. Then get the user's OK on the look.
  4. Two review lanes, Opus (high) and Fable, on the UNCOMMITTED diff. Fix every Critical and Important finding, then re-run both lanes after EVERY fix until both are clean. Push back on a wrong finding with evidence. Minors go to `docs/backlog/polish2-named-items-debt.md` (created in Task 1) under the task's heading. Do not edit the tree while a lane reviews.
  5. Commit with exact paths (never `git add -A`) and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (no session line).
  6. Ledger line in `$SDD/progress.md`, update memory, then WAIT for the user's "go" before the next task.
- **Dev servers for screenshots** (both already run in this session; never start a second copy, never restart them):
  - Backend: uvicorn started with `MATHION_DEBUG=1 MATHION_ASSET_PATH="$HOME/mathion-assets"` and `--reload`; its log and the sign-in PIN are in `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/backend.log`.
  - Frontend: vite on `http://localhost:5174`. agent-browser session `mathion-0fb6bc751f3c` (`export AGENT_BROWSER_SESSION=mathion-0fb6bc751f3c`). Screenshot paths must be absolute.
  - Logins: `dev@mathion.test` (course admin: the authoring screens) and `teacher@mathion.test` (teacher of run 8). Run 8 lives at `/teaching/demo-course/runs/8?tab=…`.
  - Never write to shared dev data without the user's yes. Every delete, publish, upload and save in a screenshot is mocked with `agent-browser network route "<url glob>" --body '…'` (see `agent-browser skills get core --full`), or avoided: authored-content screenshots inject a backend-rendered fixture into the live page (Task 3, Step 1). No real quiz attempts.

## Rulings made while planning

Each states what it costs if wrong. P-numbers continue from Polish 1's P96.

**Task 1 — focus ring and reduced motion**
- **P97 — RunRosterTab's `.ro-retry` takes the ring,** not the field look: it is a `<select>` drawn as an underlined link with `border: 0`, so the field rule would leave it only the 1.16:1 halo. *Cost:* one rule.
- **P98 — RunSubmissionTab's sort and status buttons get no inset rule.** Their cells are padded (`8px 12px`, `6px 12px`), so the 4px outset ring fits inside the clip. *Cost:* if Safari shows a clipped ring, one rule each.
- **P99 — No field needs its own `:focus-visible` rule.** The field audit (Task 1) finds every rest border at (0,2,0) or a (0,2,1) tie, which the global field rule beats; only the two single-class error rules needed fixing. *Cost:* a field that stays grey on focus; the Safari pass checks four.
- **P100 — The Progress grid's three inset rules are separate single-selector rules,** so each is pinned on its own. *Cost:* none.
- **P101 — Polish 2's rows live in a new gate section (an),** before the summary line; each task appends to it. *Cost:* none.

**Task 2 — ground and sheets**
- **P102 — The transparent ghost and borderless rules are written as single-selector rules** (`.btn.ghost:disabled`, `.btn.ghost.blocked`, …), not the spec's comma lists, so `d` pins each. A probe showed esbuild keeps them apart; if dist merges them, the pair becomes one `chk` (ledgered). *Cost:* none.
- **P103 — `.sheet > :last-child { margin-bottom: 0 }`:** the last card's own 14px margin would otherwise add to the sheet's bottom padding. *Cost:* one rule.
- **P104 — The mini-project breadcrumb keeps its 10px bottom margin** above the sheet; the Safari pass judges it beside the player's 14px. *Cost:* one value.

**Task 3 — content at page scale**
- **P105 — `content.css` joins the (b5) token harvest:** PageItem's rules took `--space-4` and `--control-pad-textarea` with them, and the guard must keep seeing them. *Cost:* none.
- **P106 — The "no content element re-declared" source check is broader than the spec's payload.** It also catches `a`, `img`, `p + p`, `ul > li`, `pre code`, `:is(h…)` and `:last-child`, and still lets `pre:focus-visible` through. It reads comments too, so the tasks reword comments that quote the old rules. *Cost:* a comment quoting such a form reds the gate.
- **P107 — Authored-content screenshots inject a backend-rendered fixture into the live page** (`agent-browser eval`), so no dev data is written. An injected fixture does not run the attachment; the tests cover the links. *Cost:* none.
- **P108 — `externalLinks.ts` also exports `opensInNewTab(href)`,** the D58/D59 test, for direct tests. *Cost:* one export.
- **P109 — PageItem gets its own test file,** with the coverage tracker and the course store mocked. *Cost:* one file.
- **P110 — The gate keeps two arrays:** `CONTENT_SURFACES` (the eleven files that may render `prose`) and `CONTENT_DONE` (the converted ones, the whole list from Task 4). *Cost:* none.

**Task 4 — compact surfaces**
- **P111 — Only the rendered preview carries the variant.** The "Rendering…" and error previews keep the body size (13px before). *Cost:* a 1px change in two transient lines.
- **P112 — The four unscanned surfaces (CourseView, VersionEditPage, QuestionCard, MarkdownEditor) are pinned by exact source lines** (`src_count`), the scanned ones by SIG and `attachOn`. *Cost:* a reflowed line reds the gate.

**Task 5 — 404**
- **P113 — NotFound uses ErrorState's `{#snippet action()}` child form,** as CourseView and SequencePlayer do, and keeps its `.page` rule exactly (the gate's page-column check reads it). No gate rows change. *Cost:* none.

**Task 6 — bare URLs**
- **P114 — The API test creates a static page.** D55's publish and clone paths already re-render (`versions.py:318-350`, `version_clone.py:143`) and are not re-tested. *Cost:* none.
- **P115 — The look check uses the editor's Preview tab,** which renders through the backend without saving. *Cost:* none.
- **P116 — D60 sets `--ring` in resting rules, not in new `:focus-visible` selectors** (added during Task 1). The Polish 1 `none` guards on InlineConfirm and DangerConfirm match any `.danger.H:focus-visible` or `.dc-force.H:focus-visible` selector, so an `outline-color` override there would trip them. `--ring` inherits, so it is set only on the focusable element itself. *Cost if wrong:* a container that sets `--ring` would recolour the rings inside it; none does.

## Review Focus

The five inputs or conditions most likely to bite a student, teacher or author that the spec's own test list does not name. Each has its test or pin in the owning task.

1. **A long unbreakable URL or a wide code block on a 320px phone,** on any authored-content surface or inside a sheet: no page-level sideways scroll. Pins: `.prose { overflow-wrap: anywhere }` and `.prose pre { overflow-x: auto; max-width: 100% }` frozen in (b4) (Task 3); each surface keeps its own `overflow-wrap` row (Tasks 3, 4); the 320px screenshots of both sheets (Task 2) and the page fixture (Task 3).
2. **Content that changes after the element mounted** (the mini-project's visibility refetch, a new explanation after a reveal, the preview re-rendered): the new links still open in a new tab. Tests: Task 3 (D6.12 runs against the attachment), Task 4 (QuizItem's explanation arrives after the reveal; the preview renders after its fetch).
3. **Hrefs in odd forms** that a teacher pastes or the renderer keeps: an uppercase scheme, `//host`, a same-origin absolute page URL, a relative file path, `#…`, `mailto:`, an href that does not parse. Tests: Task 3 (`externalLinks.test.ts`, 16 cases).
4. **An invalid field that script focuses after a failed submit** (MiniProjectModal's `focusFirstError()`): it stays red, not blue. Gate pins: Task 1 (`.nr-input.nr-invalid`, `.mpm-input.mpm-invalid` at (0,3,0)); the field audit re-run in Task 1, Step 6.
5. **Signed out on an unknown address:** NotFound renders with "Sign in", without the header, and no redirect to login fires. Test: Task 5 (`App.notFound.svelte.test.ts`).

## Gate ladder

`EXPECTED_CHECKS` starts at **2220** (`frontend/scripts/visual-refresh-gate.sh:90`). Section (an) is created in Task 1; each later task appends its rows to it.

| Task | Adds | `EXPECTED_CHECKS` |
|---|---|---|
| start | | 2220 |
| 1 — Focus ring and reduced motion | +19, then +14 for D60 and +3 for D61 (Step 9b) | 2256 |
| 2 — The page ground and the sheets | +26 −3 | 2279 |
| 3 — Authored content, page scale | +4 −13 | 2270 |
| 4 — Authored content, compact surfaces | +15 −5 | 2280 |
| 5 — The 404 page | 0 | 2280 |
| 6 — Bare URLs | 0 | 2280 |

## File map

Paths under `frontend/src` unless stated.

| File | Task | What changes |
|---|---|---|
| `styles/base.css` | 1 | the four global focus rules |
| `components/course/SequenceLink.svelte`, `MiniProjectLink.svelte` | 1 | `outline: none` on the inset ring |
| `components/runs/NewRunModal.svelte`, `MiniProjectModal.svelte` | 1 | compound error rules |
| `components/editor/MarkdownEditor.svelte` | 1, 4 | (1) card, textarea and tab focus; (4) `variant`, the preview's class, metrics and attachment |
| `components/runs/RunProgressTab.svelte`, `RunRosterTab.svelte`, `DashboardSidePanel.svelte` | 1 | inset rings; P97; the forced-colors rule |
| `components/items/VideoFrame.svelte`, `InteractiveFrame.svelte` | 1 | inset iframe ring |
| `components/ui/Switch.svelte` | 1 | reduced motion |
| `pages/Login.svelte`, `components/course/ItemIcon.svelte`, `BlockGroup.svelte` | 1, 2 | comments |
| `components/items/quiz/*Question.svelte` (four) | 1, 4 | (1) comments; (4) `prose compact`, the attachment, the `:global` rules go |
| `styles/theme-default.css` | 2 | `--bg`, `--focus-page`, `--disabled-bg`, the `--surface-3` comment |
| `components/ui/Button.svelte`, `IconButton.svelte`, `InlineConfirm.svelte`, `DangerConfirm.svelte`, `editor/QuestionTypePicker.svelte` | 2 | `--disabled-bg`; transparent ghost and borderless |
| `components/chrome/Toast.svelte`, `components/ui/FilterPills.svelte` | 2 | text colour; pressed border |
| `pages/SequencePlayer.svelte` | 2 | the sheet; the strip and footer rules go |
| `pages/MiniProjectDetailPage.svelte` | 1, 2, 3 | (1) a comment; (2) `div.sheet`, the breadcrumb above it; (3) `prose`, the attachment, the effect and `:global` rules go |
| `pages/editor/VersionsPage.svelte`, `VersionEditPage.svelte` | 2, 4 | (2) the `body:has` d0 rules go; (4) `.vinfo` is `prose compact` |
| `components/items/QuizItem.svelte` | 2, 4 | (2) comments; (4) `.exp` is `prose compact` |
| `styles/content.css` (new), `app.css` | 3 | `.prose`, `.prose.compact`; the import |
| `lib/externalLinks.ts` (new) | 3 | `externalLinks`, `opensInNewTab` |
| `components/items/PageItem.svelte` | 3 | `prose`, the attachment; its content rules go |
| `lib/studentMiniProjects.ts` | 3 | `rewriteExternalLinks` goes |
| `pages/CourseView.svelte`, `components/editor/quiz/QuestionCard.svelte` | 4 | `prose compact`, the attachment |
| `components/editor/quiz/NewQuestionModal.svelte`, `QuestionTextModal.svelte`, `ExplanationModal.svelte` | 4 | the preview `variant` |
| `lib/newTabLinks.ts` | 4 | deleted |
| `pages/NotFound.svelte` | 5 | the ErrorState page |
| `tests/*` | 2–5 | new: `externalLinks.test.ts`, `PageItem.svelte.test.ts`, `NotFound.svelte.test.ts`, `App.notFound.svelte.test.ts`; changed per task |
| `backend/pyproject.toml`, `backend/mathion/markdown.py`, `backend/tests/test_markdown.py`, `backend/tests/test_items.py` (repo root) | 6 | linkify |
| `scripts/visual-refresh-gate.sh` (`frontend/`) | 1–4 | (b4), the inventories, section (an), `EXPECTED_CHECKS` |
| `docs/backlog/*` (repo root) | 1–6 | `polish2-named-items-debt.md` created (1); resolved notes deleted per task (spec §Backlog lifecycle) |

## After the six tasks

A whole-branch review (fresh Opus and Fable) over `ba8ace4..HEAD`, then the Safari pass from the spec's §Carried to the Safari pass, one step at a time, with no VoiceOver steps (the beta VoiceOver list is in `polish2-named-items-debt.md`, Task 5).

---


### Task 1: Focus ring and reduced motion (D48, D49)

**Files:**
- Modify: `frontend/src/styles/base.css:22-26` (the global focus rules)
- Modify: `frontend/src/components/course/SequenceLink.svelte:49-58`, `frontend/src/components/course/MiniProjectLink.svelte:75-91` (`outline: none` on the inset ring)
- Modify: `frontend/src/components/runs/NewRunModal.svelte:229-231`, `frontend/src/components/runs/MiniProjectModal.svelte:752-754` (compound error rules)
- Modify: `frontend/src/components/editor/MarkdownEditor.svelte` (`<style>`: the card, textarea and tab focus rules)
- Modify: `frontend/src/components/runs/RunProgressTab.svelte` (`<style>`: three inset rules), `frontend/src/components/runs/RunRosterTab.svelte:140-149` (P97)
- Modify: `frontend/src/components/items/VideoFrame.svelte:18`, `frontend/src/components/items/InteractiveFrame.svelte:39` (inset iframe ring)
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte:1063` (forced-colors rule)
- Modify: `frontend/src/components/ui/Switch.svelte:49`, `:70-76` (reduced motion)
- Modify (comments only): `frontend/src/pages/Login.svelte:138`, `frontend/src/components/items/quiz/TextQuestion.svelte:86-90`, `:115-125`, `frontend/src/components/items/quiz/NumericQuestion.svelte:88-92`, `:117-127`, `frontend/src/components/items/quiz/SingleChoiceQuestion.svelte:220`, `frontend/src/components/items/quiz/MultiChoiceQuestion.svelte:231`, `frontend/src/pages/MiniProjectDetailPage.svelte:686`, `frontend/src/components/course/ItemIcon.svelte:31`, `frontend/src/components/course/BlockGroup.svelte:187-189`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (comments `:187-189`, `:299-300`, `:626-629`, `:2200-2212`; `FOCUS` `:2207`; (b4) `WANT_FULL` / `WANT_ORDER` `:550-570` and its comment log; NewRunModal `:4861`; MiniProjectModal `:4908`; new section (an) before `# The summary line is the parent process's (see the re-exec at the top).`; `EXPECTED_CHECKS` `:90`)
- Create: `docs/backlog/polish2-named-items-debt.md`
- Modify: `docs/backlog/polish1-confirms-debt.md` (`:120-124`, the Polish 3 list)
- Delete: `docs/backlog/global-focus-ring-invisible-in-forced-colors.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - The four global focus rules in `base.css`, frozen in (b4). Task 3 appends `content.css`'s rules to the same `WANT_FULL` / `WANT_ORDER`.
  - Gate section (an) `--- (an) Polish 2 — named items ---`. Tasks 2–6 append their rows to it.
  - `docs/backlog/polish2-named-items-debt.md`, where every task's minors go under `## Task N`.
  - `$SDD/probe/hashless.py` (already in the workspace): prints the bundle's hashless rules as (b4) sees them. Tasks 2 and 3 use it.

**The field audit (spec §The field audit).** Made while planning, from the Polish 1 tip's dist with `$SDD/probe/field-audit.py` (fields listed in `$SDD/probe/fields.txt`). The new field rule is (0,2,1). A field turns blue on focus unless a (0,3,0)+ rule sets its rest border.

| Field (file) | Rest border rule | Specificity | Blue on focus? |
|---|---|---|---|
| `.title-input` (AccordionHeader), `.add-input` (BlockAccordion, VersionEditPage) | `border:1.5px solid var(--primary)` | (0,2,0) | already blue |
| `.plain-input` (ItemEditorModal, NewItemModal, VersionSettingsModal, VideoBody) | `border:1px solid var(--border-strong)` | (0,2,0) | yes: own `:focus-visible` rule (0,3,0) |
| `.inline-input` (InlineInput), `.key-input` (KeyAnswer), `.nq-input` (NewQuestionModal), `.in-input` (InlineName) | same | (0,2,0) | yes: own rule (0,3,0) |
| `.num` (VersionSettingsModal, NumericQuestion), `.txt` (TextQuestion) | same | (0,2,0) | yes: own rule (0,3,0) |
| MarkdownEditor `textarea` | `border:0` | (0,1,1) | no border: the card shows it (rules below) |
| VersionsPage `.create input`, `.create textarea` | `border:1px solid var(--border)` | (0,2,1) | yes: ties, the global rule is later |
| `.sp-textarea`, `.sp-input` (DashboardSidePanel), `.t-input` (RunTeachersTab), `.ro-input` (RunRosterTab) | `border:1px solid …` | (0,2,0) | yes |
| `.nr-input` (NewRunModal), `.mpm-input` (MiniProjectModal) | same | (0,2,0) | yes; their single-class error rules are fixed below |
| `.ri-paste`, `.ri-fallback` (RosterImportModal), `.pg-control` (RunProgressTab), `.ro-select` (RunRosterTab), `.sub-control` (RunSubmissionTab), `.input` (ui/Input) | same | (0,2,0) | yes |
| `.ro-retry` (RunRosterTab), a `<select>` drawn as an underlined link | `border:0` | (0,2,0) | no border to colour: P97 gives it the ring |

Error rules that stay red on focus: `.input.error`, every `[aria-invalid=true]` compound (0,3,0). The three fields with `aria-invalid` and no error border (VersionEditPage and BlockAccordion create fields, AccordionHeader title) go to the Polish 3 list in Step 9. No field needs its own scoped `:focus-visible` rule.

**Inset rings, confirmed in source while planning** (spec §Inset rings; "the plan confirms each one"):
- RunProgressTab `.seg-btn`: flush inside `.seg { overflow: hidden }` → inset.
- RunProgressTab `.cell-btn` and `.progress-grid th button`: `width/height: 100%` in `th, td { padding: 0 }` inside `.table-scroll` → inset.
- MarkdownEditor tab buttons: flush at the top of `.md-card { overflow: hidden }` → inset. Its textarea: the rules below.
- `VideoFrame` and `InteractiveFrame` iframes: they fill `.frame` inside `.video-card` / `.app-card { overflow: hidden }` → inset.
- RunSubmissionTab's sort buttons (`th` padding `8px 12px`) and `status-cell-btn` (`td` padding `6px 12px`): the outset ring needs 4px and fits → no rule (P98).

- [ ] **Step 1: Write the failing gate rows**

In `frontend/scripts/visual-refresh-gate.sh`:

1. In the (b4) comment log, after the line `# reproduces 2448f67f).`, add:

```
# Polish 2 T1 (user D48, 2026-10-18): `:focus-visible` is the 2px --primary
# outline at a 2px offset (1684b043 -> <FV>). Its old declaration set moved
# unchanged to the new text-field rule, so that rule hashes to 1684b043. Two
# more rules follow it: `[tabindex="-1"]:focus-visible` (script focus parking
# spots show no ring) and the forced-colors outline, `!important` because eight
# components set `outline: none` in their own :focus-visible rules.
```

2. Replace `WANT_FULL` and `WANT_ORDER` (`:550-570`) with:

```python
WANT_FULL = [
    ('', '*,*:before,*:after', '8d5d6c83'), ('', '.mono,code,kbd', '84a226e9'),
    ('', ':focus-visible', '<FV>'),
    ('', ':is(input:not([type=checkbox],[type=radio],[type=file],[type=range],[type=color],[type=button],[type=submit],[type=reset]),textarea,select):focus-visible', '1684b043'),
    ('', ':root', 'a066ce4c'),
    ('', '[tabindex="-1"]:focus-visible', '<TI>'),
    ('', 'a', '1cdc0f83'), ('', 'a', '7bb41747'), ('', 'a:hover', '36ec7417'),
    ('', 'body', '0c999c4b'), ('', 'body', '77e2fef1'), ('', 'button', 'd50dfcde'),
    ('', 'button,input,select,textarea', '790e37af'), ('', 'h1', '778e3e41'),
    ('', 'h1,h2,h3,h4,h5,h6', '610dd856'), ('', 'h2', 'a8b134e8'),
    ('', 'h3', 'b36ddbd5'), ('', 'h4', 'f98d3d7e'), ('', 'html,body', '3bd2fa51'),
    ('', 'img,video', 'aa84fbab'), ('', 'p', '11696618'), ('', 'ul,ol', '99409a76'),
    ('@media (forced-colors:active)', ':focus-visible:not([tabindex="-1"])', '<FC>'),
]
# Document ORDER of the same 23 rules. `a` at #9 (reset.css) and #13 (base.css)
# are the live case: only order decides that base's --primary wins, and swapping
# two @imports in app.css flips it while the sorted multiset stays identical.
# The four focus rules close it: the field rule must come after `:focus-visible`
# (it wins that tie by order), and the forced-colors rule last.
WANT_ORDER = [
    ('', '*,*:before,*:after'), ('', 'html,body'), ('', 'body'), ('', 'ul,ol'),
    ('', 'h1,h2,h3,h4,h5,h6'), ('', 'p'), ('', 'button,input,select,textarea'),
    ('', 'button'), ('', 'img,video'), ('', 'a'), ('', ':root'), ('', 'body'),
    ('', '.mono,code,kbd'), ('', 'a'), ('', 'a:hover'), ('', 'h1'), ('', 'h2'),
    ('', 'h3'), ('', 'h4'), ('', ':focus-visible'),
    ('', ':is(input:not([type=checkbox],[type=radio],[type=file],[type=range],[type=color],[type=button],[type=submit],[type=reset]),textarea,select):focus-visible'),
    ('', '[tabindex="-1"]:focus-visible'),
    ('@media (forced-colors:active)', ':focus-visible:not([tabindex="-1"])'),
]
```

`WANT_FULL` is compared after `got_full.sort()`, so it stays in Python sort order: `''` contexts first, `:focus-visible` < `:is(` < `:root` < `[tabindex` < `a`, and the `@media` row last. Leave `<FV>`, `<TI>` and `<FC>` as they are until Step 4.

3. Replace `FOCUS = 'box-shadow:inset 0 0 0 2px var(--primary)'` (`:2207`) with `FOCUS = 'outline:none;box-shadow:inset 0 0 0 2px var(--primary)'`. The SequenceLink (`:2230`) and MiniProjectLink (`:2298`) rows use it, so both follow.

4. In the NewRunModal block (`:4861`) replace `d '\.nr-invalid' '' 'border-color:var\(--danger\)'` with `d '\.nr-input\.nr-invalid' '' 'border-color:var\(--danger\)'`. In the MiniProjectModal block (`:4908`) replace `d '\.mpm-invalid' '' 'border-color:var\(--danger\)'` with `d '\.mpm-input\.mpm-invalid' '' 'border-color:var\(--danger\)'`. (The old rows still match inside a compound selector, so only the compound form is red today.)

5. Before the line `# The summary line is the parent process's (see the re-exec at the top).` add section (an):

```zsh

echo
echo "--- (an) Polish 2 — named items ---"
# Task 1 — the focus ring (D48) and reduced motion (D49). The global rules are
# frozen in (b4); these are the component rules the new ring needs.
uniq1 switch
if [[ -n $REPLY ]]; then
  N=Switch; H=$REPLY
  check "Switch knob jumps under reduced motion (D49)" "@media \(prefers-reduced-motion: ?reduce\)\{\.knob\.${H}\{transition:none\}"
fi
# The evaluation radio is hidden with clip(), which clips the outline too, so
# High Contrast needs the ring on the label.
uniq1 sp-card
if [[ -n $REPLY ]]; then
  N=DashboardSidePanel; H=$REPLY
  chk "@media \(forced-colors: ?active\)\{\.sp-seg-opt\.${H}:has\(\.sp-radio:where\(\.${H}\):focus-visible\)" 'outline:2px solid Highlight' 'outline-offset:-2px'
fi
# Inset rings where a control is flush against an overflow clip (spec §Inset rings).
uniq1 seg-btn
if [[ -n $REPLY ]]; then
  N=RunProgressTab; H=$REPLY
  d '\.seg-btn' ':focus-visible' 'outline-offset:-2px'
  d '\.cell-btn' ':focus-visible' 'outline-offset:-2px'
  chk "\.progress-grid\.${H} th:where\(\.${H}\) button:where\(\.${H}\):focus-visible" 'outline-offset:-2px'
fi
uniq1 md-card
if [[ -n $REPLY ]]; then
  N=MarkdownEditor; H=$REPLY
  # The card shows the textarea focus; :has, not :focus-within, so a focused tab does not.
  chk "\.md-card\.${H}:has\(textarea:where\(\.${H}\):focus-visible\)" 'border-color:var\(--primary\)'
  # (0,3,1): beats the (0,2,1) field rule. The halo would be clipped and paint over the tabs.
  chk "\.md-card\.${H} textarea:where\(\.${H}\):focus-visible" 'box-shadow:none' 'outline-offset:-2px'
  chk "\.tabs\.${H} button:where\(\.${H}\):focus-visible" 'outline-offset:-2px'
fi
frames=$(grep -oE '\.frame\.svelte-[a-z0-9]+ iframe:where\(\.svelte-[a-z0-9]+\):focus-visible\{outline-offset:-2px\}' $CSS | sort -u | wc -l | tr -d ' ')
if [[ $frames -eq 2 ]]; then echo "PASS  the video and app iframes draw an inset ring (VideoFrame, InteractiveFrame)"
else echo "FAIL  the video and app iframes draw an inset ring (found $frames of 2)"; fail=1; fi
# P97: the retry select is drawn as an underlined link with no border, so the
# field rule would leave it only the 1.16:1 halo. It takes the ring instead.
uniq1 ro-retry
if [[ -n $REPLY ]]; then
  N=RunRosterTab; H=$REPLY
  d '\.ro-retry' ':focus-visible' 'outline:2px solid var\(--primary\)' 'outline-offset:2px' 'box-shadow:none'
fi
```

6. Set `EXPECTED_CHECKS=2239` (`:90`): 19 new PASS lines (five `uniq1` lines, one Switch row, two side-panel rows, three Progress rows, four MarkdownEditor rows, the iframe row and three `.ro-retry` rows). The FOCUS, NewRunModal, MiniProjectModal and (b4) edits change rows in place.

Run the gate (Global Constraints). Expected: FAIL. The failures are exactly:
- (b4) `hashless rule ORDER changed` and `the hashless rule inventory changed (23 -> 20)` (the three new rules are missing);
- T8a `SequenceLink` and `MiniProjectLink` `rule inventory`/declarations (no `outline:none` yet);
- `NewRunModal .nr-input.nr-invalid { border-color… }` and `MiniProjectModal .mpm-input.mpm-invalid { … }`;
- in (an): the Switch row, the two side-panel rows, the three Progress rows, the four MarkdownEditor rows, the iframe row and the three `.ro-retry` rows. The five `uniq1` lines pass.

The count line reads `FAILURES (… checks, expected 2239)`. Any other FAIL means a row is written wrong: fix the row, not the CSS.

- [ ] **Step 2: The global rules**

In `frontend/src/styles/base.css` replace

```css
:focus-visible {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
```

with

```css
/* D48: a ring on controls; text fields keep their blue border and halo. The
   field rule is (0,2,1), so a scoped error rule of (0,3,0) or more keeps its
   red border on focus. */
:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
:is(input:not([type=checkbox], [type=radio], [type=file], [type=range], [type=color], [type=button], [type=submit], [type=reset]), textarea, select):focus-visible {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
/* Focus parking spots: headings and panels that script focuses after an action. */
[tabindex="-1"]:focus-visible { outline: none; }
/* High Contrast drops box-shadow. `!important` because eight components set
   `outline: none` in their own :focus-visible rules. No offset here, so an
   inset ring keeps its own. */
@media (forced-colors: active) {
  :focus-visible:not([tabindex="-1"]) { outline: 2px solid Highlight !important; }
}
```

- [ ] **Step 3: The component rules**

1. `frontend/src/components/course/SequenceLink.svelte`, replace

```css
  /* An INSET ring: the global outset ring is clipped by the card's
     `overflow:hidden`. 2px `--primary` because `--primary-soft` is ~1.15:1. */
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  /* Forced colors drop box-shadow while the global `outline:none` still applies,
     so without this the row has no focus indicator in that mode. */
```

with

```css
  /* An INSET ring. The global outline would be clipped by the card's
     `overflow:hidden` and paint over the neighbouring rows, so it is dropped. */
  .row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  /* Forced colors drop box-shadow. This offset keeps the global forced-colors
     outline (base.css) inside the row. */
```

2. `frontend/src/components/course/MiniProjectLink.svelte`, replace the two comments and the rule (`:75-91`):

```css
  /* An INSET ring. The global :focus-visible (base.css:21-25) paints
     `box-shadow: 0 0 0 3px var(--primary-soft)` OUTSIDE the border box, and T8a's
     card is `overflow: hidden` with these rows spanning its padding box exactly —
     so the left and right bands were clipped away entirely, and the first and last
     row lost their outer band too. Painted inside, the ring survives the clip.
     2px `--primary` rather than 3px `--primary-soft`: at ~1.15:1 against
     `--surface` the soft token was never a usable indicator on its own. */
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  /* Forced-colors drops `box-shadow` outright while base.css:22's `outline: none`
     still applies, so without this the row has NO focus indicator at all in that
     mode — the exact mechanism recorded at visual-refresh-gate.sh:296. `Highlight`
     is a system colour, allowed by Constraint 1's forced-colors exemption. The
     idiom is the slice's own: Login.svelte:146 pairs it with the identical
     `box-shadow: inset 0 0 0 2px var(--primary)`, and all four question
     components ship the same companion. */
```

with

```css
  /* An INSET ring, the twin of SequenceLink's. The global outline (base.css)
     would be clipped by T8a's `overflow: hidden` card, whose rows span its
     padding box exactly, and paint over the neighbouring rows; so it is dropped. */
  .row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  /* Forced colors drop box-shadow. This offset keeps the global forced-colors
     outline (base.css) inside the row. `Highlight` is a system colour, allowed
     by Constraint 1's forced-colors exemption. */
```

3. `frontend/src/components/runs/NewRunModal.svelte:229`: `.nr-invalid {` becomes `.nr-input.nr-invalid {`. `frontend/src/components/runs/MiniProjectModal.svelte:752`: `.mpm-invalid {` becomes `.mpm-input.mpm-invalid {`. Both now (0,3,0), so the field rule does not turn them blue on focus (`MiniProjectModal.focusFirstError()` focuses exactly that field).

4. `frontend/src/components/editor/MarkdownEditor.svelte`, after the `.tabs button:disabled` rule add

```css
  .tabs button:focus-visible { outline-offset: -2px; }
```

and after the `textarea { … }` rule add

```css
  /* The card shows the textarea's focus (:has, not :focus-within, so a focused
     tab does not). The halo would be clipped by the card and paint over the
     tabs; (0,3,1) beats the global field rule. In High Contrast the outline is
     drawn inside the clip. */
  .md-card:has(textarea:focus-visible) { border-color: var(--primary); }
  .md-card textarea:focus-visible { box-shadow: none; outline-offset: -2px; }
```

5. `frontend/src/components/runs/RunProgressTab.svelte`: after `.seg-btn[aria-pressed='true'] { … }` add

```css
  .seg-btn:focus-visible { outline-offset: -2px; }
```

and after `.cell-btn { padding: 6px 12px; … }` add

```css
  /* Flush in `padding: 0` cells inside .table-scroll: inset, or the clip eats the ring. */
  .cell-btn:focus-visible { outline-offset: -2px; }
  .progress-grid th button:focus-visible { outline-offset: -2px; }
```

6. `frontend/src/components/items/VideoFrame.svelte` and `frontend/src/components/items/InteractiveFrame.svelte`: after the `.frame iframe { … }` rule add

```css
  .frame iframe:focus-visible { outline-offset: -2px; /* the player card clips the frame */ }
```

7. `frontend/src/components/runs/DashboardSidePanel.svelte`, after `.sp-seg-opt:has(.sp-radio:focus-visible) { box-shadow: … }` (`:1063`) add

```css
  /* The radio is hidden with clip(), which clips its outline too. */
  @media (forced-colors: active) {
    .sp-seg-opt:has(.sp-radio:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
  }
```

8. `frontend/src/components/runs/RunRosterTab.svelte`, after the `.ro-retry { … }` rule (`:140-149`) add

```css
  /* A select drawn as a link has no border to colour: it takes the ring (P97). */
  .ro-retry:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: none; }
```

9. `frontend/src/components/ui/Switch.svelte`: the comment at `:49` becomes `/* 10k: a 30×17 track with a 13px knob. Focus shows the global ring (base.css). Under reduced motion the knob jumps (D49). */`. After the `.switch.on .knob` rule add

```css
  @media (prefers-reduced-motion: reduce) {
    .knob { transition: none; }
  }
```

- [ ] **Step 4: Fill in the three hashes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run build > $SDD/tmp/build.log 2>&1 && python3 $SDD/probe/hashless.py focus-visible
```

Expected (computed while planning from the same CSS minified by esbuild 0.21):

```
('', ':focus-visible', '5b0269c3'),
('', ':is(input:not([type=checkbox],[type=radio],[type=file],[type=range],[type=color],[type=button],[type=submit],[type=reset]),textarea,select):focus-visible', '1684b043'),
('', '[tabindex="-1"]:focus-visible', 'f9b4dcdb'),
('@media (forced-colors:active)', ':focus-visible:not([tabindex="-1"])', '1ff87bb6'),
```

Put the printed values in place of `<FV>` (in `WANT_FULL` and in the comment from Step 1), `<TI>` and `<FC>`. If a printed value differs from the line above, the dist one wins: use it, and ledger a ruling with both values. If the printed selector text differs (minifier form), copy it into both lists and ledger it.

- [ ] **Step 5: Run the gate**

Expected: `VISUAL-REFRESH GATE: ALL PASS (2239 checks)`. If the (b5) token guard or (c) system-colour check fails, read its lines: the forced-colors rule is inside its block, and no token is redefined, so a failure there is a real finding.

- [ ] **Step 6: Re-run the field audit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && python3 $SDD/probe/field-audit.py x $SDD/probe/fields.txt > $SDD/tmp/field-audit.log 2>&1; grep -E "nr-invalid|mpm-invalid|ro-retry" $SDD/tmp/field-audit.log
```

Expected: `.nr-input.nr-invalid…` and `.mpm-input.mpm-invalid…` at `(0, 3, 0)`; `.ro-retry…:focus-visible` at `(0, 3, 0)` with `outline:2px solid var(--primary)`. Every other line matches the audit table above.

- [ ] **Step 7: The comments that go stale**

Comments only; nothing else in these files changes.

1. `frontend/src/pages/Login.svelte:138`, `frontend/src/components/items/quiz/SingleChoiceQuestion.svelte:220`, `frontend/src/components/items/quiz/MultiChoiceQuestion.svelte:231` and `frontend/src/pages/MiniProjectDetailPage.svelte:686`: the trailing comment on the `input:focus-visible { box-shadow: none; }` line becomes `/* a no-op since Polish 2 (the field rule skips this input); kept for Polish 3 */`.
2. `frontend/src/components/items/quiz/TextQuestion.svelte:88-90` and `frontend/src/components/items/quiz/NumericQuestion.svelte:90-92`: replace

```
     all — but base.css:22's `outline:none` leaves only the --primary-soft halo
     at 1.12:1 on --bg, drawing nothing. So the ring below is load-bearing,
     exactly as `.txt:focus-visible` is for the field. */
```

with

```
     all. The global ring (base.css) draws the same outline since Polish 2; the
     rule below stays pinned, so a change to the global ring cannot drop it. */
```

3. `TextQuestion.svelte:115-121` and `NumericQuestion.svelte:117-123`: replace the comment that starts `/* mechanism: the global \`:focus-visible\` (base.css:21-25) is (0,1,0) while` and ends `the absent member would warn, exactly as for \`:disabled\`. */` with

```
  /* The global field rule (base.css) also sets this border colour since
     Polish 2. This rule stays pinned by the T3 inventory. Per-component, NOT a
     combined `.num,.txt` list: the absent member would warn, exactly as for
     `:disabled`. */
```

4. `TextQuestion.svelte:122-125` and `NumericQuestion.svelte:124-127`: replace

```
  /* Forced-colors drops box-shadow AND border colours are system-forced, and
     base.css:22's `outline:none` is still in force — so without this a focused
     field has no indicator at all in that mode. Same restoration T2 made for
     the option rows. */
```

with

```
  /* Forced colors drop box-shadow and force border colours. This offset keeps
     the global forced-colors outline (base.css) inside the field. */
```

5. `frontend/src/components/course/ItemIcon.svelte:31`: `\`border-radius\` so the global :focus-visible ring (base.css:21-25) stays` becomes `\`border-radius\` so the global focus ring (base.css) stays`.
6. `frontend/src/components/course/BlockGroup.svelte:187`: `/* So the global :focus-visible halo (base.css:21-25) follows the card corner` becomes `/* So the global focus ring (base.css) follows the card corner`.
7. In the gate:
   - `:187-189`: the three comment lines become
     ```
       # ---- focus: the field's border turns --primary ----
       # Pinned since T3, when the global rule could not reach the scoped border.
       # The Polish 2 field rule (base.css) sets it too; this pin stays.
     ```
   - `:299-300`: `# forced-colors: that mode drops box-shadow while base.css:22's` / `# \`outline:none\` still applies, so this is the ONLY focus indicator left.` become `# forced-colors: the offset keeps the global forced-colors outline inside the field.`
   - `:626-629`: `# Seed from the frozen global rules too: (b4) pins \`:focus-visible\`'s` becomes `# Seed from the frozen global rules too: (b4) pins the field focus rule's`. The rest of that comment stands.
   - `:2200-2206`: replace the comment above `FOCUS` with
     ```
     # An INSET ring. The global outline (base.css) would be clipped by T8a's
     # `overflow:hidden` card, whose rows span its padding box EXACTLY, and paint
     # over the neighbouring rows; so the row drops it (`outline:none`) and draws
     # the ring inside. Pinned in full because "just use the global ring" reads as
     # a tidy-up in review and would silently re-clip it.
     ```
   - `:2208-2212`: replace the forced-colors comment with
     ```
     # ...and its forced-colors companion: that mode drops box-shadow, and this
     # offset keeps the global forced-colors outline inside the row. `Highlight`
     # is a system colour under Constraint 1's forced-colors exemption.
     # Normalised (unspaced) form -- dist is minified.
     ```

- [ ] **Step 8: Full checks**

Run vitest, svelte-check and the gate (Global Constraints). Expected: vitest green (no test reads CSS); svelte-check 0 errors, 13 warnings; gate `ALL PASS (2239 checks)`.

- [ ] **Step 9: The backlog**

1. Create `docs/backlog/polish2-named-items-debt.md`:

```markdown
# Polish 2 (named items) — deferred minors

Minors the review lanes raised and the user did not take into the slice, by task.
Spec: `docs/superpowers/specs/2026-10-18-visual-refresh-polish2-named-items-design.md`.
Plan: `docs/superpowers/plans/2026-10-18-visual-refresh-polish2-named-items.md`.

## Task 1 — focus ring and reduced motion
```

2. In `docs/backlog/polish1-confirms-debt.md`, replace the line `- The global focus halo on other Button variants (\`base.css:22-26\`) stays until Polish 2 takes it with the forced-colors ring.` with

```markdown
- ~~The global focus halo on other Button variants~~ — done in Polish 2 Task 1 (D48: the 2px ring, and an outline in forced colors).
- **Focus not obscured (WCAG 2.4.11) in the Progress and Submissions grids:** a focused cell scrolled under the sticky columns or header. Polish 3 candidate.
- **Three fields carry `aria-invalid` with no error border:** the VersionEditPage and BlockAccordion create fields and the AccordionHeader title field. They turn blue on focus like any field. Polish 3 candidate.
- **Internal links in authored content do a full page reload.** A mid-quiz click on one still loses unsubmitted answers; routing same-origin links through `navigate()` is the candidate fix. Polish 3 candidate.
- **No-op focus rules kept by Polish 2:** the hidden inputs' `input:focus-visible { box-shadow: none }` (Login, Single/MultiChoice, the mini-project `.drop`), the seven `:focus { outline: none }` heading rules, and the 16 per-component forced-colors blocks the global rule now covers. Polish 3: remove them with their gate pins.
```

3. Delete `docs/backlog/global-focus-ring-invisible-in-forced-colors.md` (`git rm`).

- [ ] **Step 9b: Ring colours (D60, added during Task 1 at the look review)**

The user's D60: the ring colour follows the element (spec rev 6, §Ring colour). Gate rows first. Append to section (an), after the Task 1 rows:

```zsh
# D60 — the ring colour follows the element. The global ring reads
# var(--ring,var(--primary)); a coloured element sets --ring in its resting rule
# (P116: not in a new :focus-visible selector, which the Polish 1 none-guards catch).
uniq1 app-header
if [[ -n $REPLY ]]; then
  N=AppHeader; H=$REPLY
  chk "\.links\.${H} a:where\(\.${H}\)" '--ring:var\(--gold-text\)'
fi
uniq1 btn
if [[ -n $REPLY ]]; then
  N=Button; H=$REPLY
  d '\.ghost' '' '--ring:var\(--muted\)'
  d '\.danger' '' '--ring:var\(--danger\)'
  d '\.danger-off' '' '--ring:var\(--danger\)'
fi
uniq1 icon-btn
if [[ -n $REPLY ]]; then
  N=IconButton; H=$REPLY
  d '\.danger' '' '--ring:var\(--danger\)'
fi
uniq1 inline-confirm
if [[ -n $REPLY ]]; then
  N=InlineConfirm; H=$REPLY
  d '\.danger' '' '--ring:var\(--danger\)'
  d '\.cancel' '' '--ring:var\(--muted\)'
fi
uniq1 danger-confirm
if [[ -n $REPLY ]]; then
  N=DangerConfirm; H=$REPLY
  d '\.dc-force' '' '--ring:var\(--danger\)'
  d '\.dc-cancel' '' '--ring:var\(--muted\)'
fi
```

In the Polish 1 blocks, the three own-ring rows change in place: InlineConfirm's `d '\.ic-btn' ':focus-visible' …`, DangerConfirm's `d '\.dc-btn' ':focus-visible' …` and Button's `d '\.danger' ':focus-visible' …` pin `'outline:2px solid var\(--ring,var\(--primary\)\)'` instead of `var\(--primary\)`. In (b4) the `:focus-visible` hash becomes `<FV>` again, with a comment line `# D60 (user, 2026-10-18): the ring reads var(--ring,var(--primary)) (5b0269c3 -> <FV>).` `EXPECTED_CHECKS=2253` (+14: five `uniq1` lines and nine declaration rows).

Run the gate. Expected FAIL, exactly: (b4) `the hashless rule inventory changed (23 -> 23)` (same order, one changed body), the nine new declaration rows and the three re-pinned own-ring rows.

Then the CSS:
1. `base.css`: `:focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; }`. The D48 comment gains a line: D60, an element sets `--ring` to colour its ring.
2. `components/chrome/AppHeader.svelte`: `.links a { … }` gains `--ring: var(--gold-text);`.
3. `components/ui/Button.svelte`: `.ghost { … }` gains `--ring: var(--muted);`; `.danger { … }` and `.danger-off { … }` gain `--ring: var(--danger);`; `.danger:focus-visible` reads `outline: 2px solid var(--ring, var(--primary))`.
4. `components/ui/IconButton.svelte`: `.danger { color: var(--danger); }` gains `--ring: var(--danger);`.
5. `components/ui/InlineConfirm.svelte`: `.danger { … }` gains `--ring: var(--danger);`, `.cancel { … }` gains `--ring: var(--muted);`, `.ic-btn:focus-visible` reads `var(--ring, var(--primary))`.
6. `components/ui/DangerConfirm.svelte`: `.dc-force { … }` gains `--ring: var(--danger);`, `.dc-cancel { … }` gains `--ring: var(--muted);`, `.dc-btn:focus-visible` reads `var(--ring, var(--primary))`.

Build, print the new hash (`python3 $SDD/probe/hashless.py focus-visible`), put it in place of `<FV>`, then the full checks. Expected: vitest green, svelte-check 0 errors and 13 warnings, gate `ALL PASS (2253 checks)`. **D61, from review round 1:** `.cell-btn { …; --ring: var(--heat-fg); }` in RunProgressTab, with a `uniq1 seg-btn` block pinning it and a row that counts ten `--ring` declarations in dist (`EXPECTED_CHECKS=2256`). Re-shoot the coloured cases for the overlay: "Authoring", "Logout", "Collapse all", an InlineConfirm Cancel and red Delete, a trash IconButton, a danger Button. The commit in Step 10 adds the five D60 files (AppHeader, Button, IconButton, InlineConfirm, DangerConfirm) to its `git add` list.

- [ ] **Step 10: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, each with the focus put there by Tab (`agent-browser press Tab` until the target is focused; check with `agent-browser eval "document.activeElement.outerHTML.slice(0,120)"`):
- the header, a primary Button and a ghost Button, an IconButton, a filled IconButton;
- a CourseCard on the course list, a SequenceLink row (one ring only), an accordion header, the strip icons in the player;
- the DangerConfirm checkbox (Teaching → run 8 → Assets, delete with the request held), a roster checkbox;
- a Progress segment and a heat cell next to the sticky column;
- Login's e-mail field (signed out), an invalid NewRunModal title (submit empty: nothing is sent), the MarkdownEditor card and its Write tab (item editor, no save);
- the Switch (Teaching → run 8 → Overview) toggled with `prefers-reduced-motion` emulated (`agent-browser` media emulation from the core guide), as two frames.

Show them in an overlay (Global Constraints), then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/styles/base.css \
  frontend/src/components/course/SequenceLink.svelte frontend/src/components/course/MiniProjectLink.svelte \
  frontend/src/components/runs/NewRunModal.svelte frontend/src/components/runs/MiniProjectModal.svelte \
  frontend/src/components/editor/MarkdownEditor.svelte frontend/src/components/runs/RunProgressTab.svelte \
  frontend/src/components/runs/RunRosterTab.svelte frontend/src/components/items/VideoFrame.svelte \
  frontend/src/components/items/InteractiveFrame.svelte frontend/src/components/runs/DashboardSidePanel.svelte \
  frontend/src/components/ui/Switch.svelte frontend/src/pages/Login.svelte \
  frontend/src/components/items/quiz/TextQuestion.svelte frontend/src/components/items/quiz/NumericQuestion.svelte \
  frontend/src/components/items/quiz/SingleChoiceQuestion.svelte frontend/src/components/items/quiz/MultiChoiceQuestion.svelte \
  frontend/src/pages/MiniProjectDetailPage.svelte frontend/src/components/course/ItemIcon.svelte \
  frontend/src/components/course/BlockGroup.svelte frontend/scripts/visual-refresh-gate.sh \
  docs/backlog/polish2-named-items-debt.md docs/backlog/polish1-confirms-debt.md
git rm -q docs/backlog/global-focus-ring-invisible-in-forced-colors.md
git commit -m "$(cat <<'EOF'
feat(polish2): a visible focus ring, also in High Contrast; the Switch knob respects reduced motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The page ground and the reading sheets (D50, D56)

**Files:**
- Modify: `frontend/src/styles/theme-default.css:5`, `:8`, `:13` (tokens)
- Modify: `frontend/src/components/ui/Button.svelte:69-81` (disabled fills, transparent ghost)
- Modify: `frontend/src/components/ui/IconButton.svelte:212-225` (disabled fills, transparent borderless)
- Modify: `frontend/src/components/ui/InlineConfirm.svelte:149`, `frontend/src/components/ui/DangerConfirm.svelte:155-160`, `frontend/src/components/editor/QuestionTypePicker.svelte:48`, `frontend/src/pages/MiniProjectDetailPage.svelte:695` (`--disabled-bg`)
- Modify: `frontend/src/components/chrome/Toast.svelte:19`, `frontend/src/components/ui/FilterPills.svelte:35`
- Modify: `frontend/src/pages/SequencePlayer.svelte:276-284`, `:333-341` (the sheet; strip and footer rules)
- Modify: `frontend/src/pages/MiniProjectDetailPage.svelte:474-631` (markup: breadcrumb out of `<header>`, new `div.sheet`) and its `<style>` (`.sheet` rules, the `.grid2` comment)
- Modify: `frontend/src/pages/editor/VersionsPage.svelte:382-384`, `frontend/src/pages/editor/VersionEditPage.svelte:763`, `:797-800` (the `body:has` rules)
- Modify (comments only): `frontend/src/components/items/QuizItem.svelte:249-252`, `:268-269`, `frontend/src/components/course/BlockGroup.svelte:128-133`
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((b4) `:root` hash and comment log; GLOBAL_ALLOW VersionsPage entry `:489-492`; rows `:2716-2723`, `:3636`, `:3700`, `:3759-3760`, `:3852`, `:4400-4403`, `:4632`, `:4973`, `:4978`, `:5176`; section (an); `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` (the "9c frame + header" describe, `:850`)
- **D62 (added at the look review, 2026-10-19; spec rev 8 §The player strip):** Modify `frontend/src/components/course/ItemMark.svelte` (`inStrip` prop, `class:in-strip`, the `in-strip` rules), `frontend/src/components/course/ItemIcon.svelte` (passes `inStrip`; the strip margins on `.icon` and `.icon.current`); the SequencePlayer `.strip`, `.counter`, `.content` and the mini-project `.sheet` as the spec says; gate section (i) inventory, (m) rows, the `.sheet` row and the two markup pins, `EXPECTED_CHECKS` unchanged. Test: `frontend/src/tests/ItemMark.svelte.test.ts` and `ItemIcon.svelte.test.ts` (one test each). The commit adds these files to Step 11's `git add` list.
- Modify: `docs/backlog/polish2-named-items-debt.md` (`## Task 2` heading)
- Delete: `docs/backlog/page-background-reads-gray-against-header.md`

**Interfaces:**
- Consumes: Task 1's section (an) and `docs/backlog/polish2-named-items-debt.md`.
- Produces:
  - The token `--disabled-bg` (`#FBFBFC`): the fill of every disabled or blocked bordered control. New disabled recipes use it, never `--bg`.
  - `--bg` is the page ground `#F2F3F6`; `--focus-page` is `var(--bg)`.
  - The mini-project page's `div.sheet`. Task 3 adds `prose` to the `.assignment-html` inside it.
  - The player's `main.content` is the white sheet. Task 3's PageItem and Task 4's QuizItem render inside it.

- [ ] **Step 1: Write the failing jsdom tests**

In `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts`, inside `describe('MiniProjectDetailPage 9c frame + header (Slice-4 T3)', …)`, after the `breadcrumb:` test, add:

```ts
  it('D56: the breadcrumb sits above the white sheet, which holds the header and everything below it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [makeEntry({ submission_number: 1, evaluation: null })] }));
    await mountPage();
    const sheet = target.querySelector('.mp-col > .sheet');
    expect(sheet).not.toBeNull();
    const nav = target.querySelector('nav.breadcrumb');
    // The crumbs stay on the ground, as the player's do: before the sheet, not inside it.
    expect(nav!.parentElement!.classList.contains('mp-col')).toBe(true);
    expect(nav!.nextElementSibling).toBe(sheet);
    expect(sheet!.querySelector('header .title-row h1')).not.toBeNull();
    expect(sheet!.querySelector('header nav.breadcrumb')).toBeNull();
    expect(sheet!.querySelector('section.assignment')).not.toBeNull();
    expect(sheet!.querySelector('.grid2')).not.toBeNull();
    expect(sheet!.querySelector('section.history')).not.toBeNull();
  });

  it('D56: the loading and error states stay on the ground (no sheet)', async () => {
    vi.mocked(fetchDetail).mockReturnValueOnce(new Promise<StudentMiniProjectDetail>(() => {}));
    component = mount(MiniProjectDetailPage, { target, props: { courseSlug: 'course-x', blockSlug: 'block-y' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelector('.sheet')).toBeNull();
    unmount(component);
    component = null;
    target.innerHTML = '';
    vi.mocked(fetchDetail).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    await mountPage();
    expect(target.querySelector('[data-testid="fetch-error-banner"]')).not.toBeNull();
    expect(target.querySelector('.sheet')).toBeNull();
  });
```

`unmount`, `flushSync`, `ApiError` (`../lib/api`), `makeEntry` and the `StudentMiniProjectDetail` type are already in this file. The file's `afterEach` unmounts `component` when it is set, so the test clears it after its own `unmount`.

Run:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MiniProjectDetailPage.svelte.test.ts > $SDD/tmp/vitest-t2.log 2>&1; tail -30 $SDD/tmp/vitest-t2.log
```

Expected: FAIL, the first test only (`.mp-col > .sheet` is null). The second passes today (no `.sheet` anywhere); it pins the states once the sheet exists.

- [ ] **Step 2: Write the failing gate rows**

In `frontend/scripts/visual-refresh-gate.sh`:

1. (b4): in `WANT_FULL`, `('', ':root', 'a066ce4c')` becomes `('', ':root', '7bfdd12a')`. After the comment block Task 1 added, add:

```
# Polish 2 T2 (user D50, 2026-10-18): the :root hash moved (a066ce4c ->
# 7bfdd12a): --bg is the page ground #F2F3F6 (was #FBFBFC), --focus-page is
# var(--bg), and --disabled-bg (#FBFBFC) is new and holds the old disabled
# fill. The --surface-3 comment changed, which hashes nothing.
```

2. GLOBAL_ALLOW: delete the VersionsPage entry and its three comment lines:

```
    # 5c follow-up (user, 2026-10-08): the versions list takes the editor's
    # page shade. `:global(body):has(.page)` keeps `.page` SCOPED, so it matches
    # only while VersionsPage is mounted; that page never renders a quiz.
    ('src/pages/editor/VersionsPage.svelte', 'body'),
```

3. SequencePlayer's (m) inventory (`:2716-2723`): replace the `.strip`, `.content` and `footer` entries with

```python
    ('.strip' + W,
     'display:flex;gap:6px;padding:0;margin-bottom:20px;align-items:center;flex-wrap:wrap'),
    ('.counter' + W, 'margin-left:auto;font-family:var(--font-mono);font-size:12.5px;color:var(--muted)'),
    # Polish 2 D56: the content slot is the white reading sheet (artboard 2c's
    # card padding). The strip's bottom rule and the footer's top rule went
    # with it: each would run parallel to the sheet's edge.
    ('.content' + W,
     'background:var(--surface);border:1px solid var(--border);'
     'border-radius:var(--radius-lg);padding:16px 20px 20px;min-height:200px'),
    ('footer' + W,
     'display:flex;justify-content:space-between;align-items:center;margin-top:24px'),
```

(the `.counter` line is unchanged; it is shown so the replaced range is clear).

4. In place, `var\(--bg\)` becomes `var\(--disabled-bg\)` in these five rows: `:3636` (MP `.drop:has(input:disabled)`), `:3700` (`d '\.icon-btn' ':disabled' …`), `:4973` (`d '\.btn\.blocked' …`), `:4978` (`d '\.icon-btn\.blocked' …`), `:5176` (`d '\.cancel\[aria-disabled=true\]' …`).

5. Delete the VersionsPage pair (`:3759-3760`):

```zsh
  chk "body:has\(\.page\.${H}\)" 'background:var\(--focus-page\)'
  none "VersionsPage no fully-global body:has(.page) (.page stays scoped)" "body:has\(\.page\)"
```

and the d0 row of VersionEditPage (`:3852`), `chk "body:has\(\.canvas\.d0\.${H}\)" 'background:var\(--focus-page\)'`. In the comment above it (`:3851`), `# 5c T5 (user): with nothing open the page is one half-step darker, so the white block rows stand out.` becomes `# 5c T5: one level open, the page is a step darker. With nothing open it is the page ground (Polish 2 D50).`

6. The canvas count (`:4400-4403`) becomes:

```zsh
# R3 / T1 ruling: the canvas shades <body> through a scoped :has() and the tokens
# only. Polish 2 D50: with nothing open (d0) the page ground is already
# --focus-page, so only d1 and d2 shade it.
if [[ $(grep -cE ':global\(body\):has\(\.canvas\.d[12]\)[[:space:]]*\{[[:space:]]*background:[[:space:]]*var\(--focus-(1|2)\);?[[:space:]]*\}' src/pages/editor/VersionEditPage.svelte) -eq 2 ]]; then
  echo "PASS  the canvas shades the body only through the focus tokens (d1/d2)"
else echo "FAIL  the canvas shades the body only through the focus tokens (d1/d2)"; fail=1; fi
```

7. FilterPills (`:4632`): the `chk` gains a third declaration, `'border-color:var\(--primary\)'`.

8. Append to section (an):

```zsh
# Task 2 — the page ground (D50) and the reading sheets (D56).
# Disabled fills use --disabled-bg (the old #FBFBFC), so they stay a step above
# the darker ground. Ghost and borderless stay transparent when disabled: a
# filled tile would make the disabled control look raised.
uniq1 btn
if [[ -n $REPLY ]]; then
  N=Button; H=$REPLY
  d '\.btn' ':disabled' 'background:var\(--disabled-bg\)'
  d '\.btn\.ghost' ':disabled' 'background:transparent' 'border-color:transparent'
  d '\.btn\.ghost\.blocked' '' 'background:transparent' 'border-color:transparent'
fi
uniq1 icon-btn
if [[ -n $REPLY ]]; then
  N=IconButton; H=$REPLY
  d '\.icon-btn\.borderless' ':disabled' 'background:transparent' 'border-color:transparent'
  d '\.icon-btn\.borderless\.blocked' '' 'background:transparent' 'border-color:transparent'
fi
uniq1 qtype-picker
if [[ -n $REPLY ]]; then
  N=QuestionTypePicker; H=$REPLY
  chk "\.qtype-picker\.${H}:disabled label:where\(\.${H}\)" 'background:var\(--disabled-bg\)'
fi
uniq1 danger-confirm
if [[ -n $REPLY ]]; then
  N=DangerConfirm; H=$REPLY
  d '\.dc-cancel' ':disabled' 'background:var\(--disabled-bg\)'
fi
# The toast's text was --bg; on the dark fill it is the "text on a dark fill" token.
uniq1 toast
if [[ -n $REPLY ]]; then
  N=Toast; H=$REPLY
  d '\.toast' '' 'color:var\(--primary-text\)'
fi
# The mini-project page's white sheet: the player's declarations (D56).
uniq1 sheet
if [[ -n $REPLY ]]; then
  N=MiniProjectDetailPage; H=$REPLY
  d '\.sheet' '' 'background:var\(--surface\)' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius-lg\)' 'padding:16px 20px 20px' 'min-height:200px'
  chk "\.sheet\.${H}>(:where\(\.${H}\))?:last-child(:where\(\.${H}\))?" 'margin-bottom:0'
fi
# One page ground: no page re-shades the body with it any more.
none "no body:has() rule sets --focus-page (Polish 2 D50)" "body:has\([^)]*\)\{[^}]*--focus-page"
```

9. `EXPECTED_CHECKS` becomes `2279`: +26 new PASS lines (the FilterPills declaration; in (an) six uniq1 lines, Button 5, IconButton 4, QuestionTypePicker 1, DangerConfirm 1, Toast 1, the sheet 6, the `none`), −3 removed (the VersionsPage pair and the d0 row).

Run the gate (Global Constraints). Expected: FAIL. The failures are exactly:
- (b4) `the hashless rule inventory changed` (the `:root` hash);
- (b3) `the set of :global rules outside T3 changed`, with `new: src/pages/editor/VersionsPage.svelte :global(body)` (the rule still exists, its entry is gone);
- SequencePlayer (m) inventory;
- the five flipped `--disabled-bg` rows and the FilterPills `border-color` row;
- the canvas count (3 rules, not 2) and the `none "no body:has() rule sets --focus-page"` row;
- in (an): Button 5, IconButton 4, QuestionTypePicker 1, DangerConfirm 1, Toast 1, `uniq1 sheet` (no `.sheet` yet; its rows are skipped, so the count line is short by 6).

Any other FAIL means a row is written wrong: fix the row, not the CSS.

- [ ] **Step 3: The tokens**

`frontend/src/styles/theme-default.css`:
- `:5` `--bg: #FBFBFC;              /* page background */` becomes `--bg: #F2F3F6;              /* the page ground (D50): white cards and the header read as steps above it */`.
- `:8` `--surface-3: #FCFCFD;       /* nested/inset panels */` becomes `--surface-3: #FCFCFD;       /* a near-white tint inside a white surface; never on the ground */`.
- `:13` becomes:

```css
  --focus-page: var(--bg);   /* the page with nothing open is the page ground (D50). A theme that changes --bg keeps it below --focus-1 and --focus-2, which stay literals. */
```

- After `--surface-3`, add:

```css
  --disabled-bg: #FBFBFC;     /* disabled and blocked controls: a step above the ground (D50) */
```

- [ ] **Step 4: Disabled fills**

1. `frontend/src/components/ui/Button.svelte`: in `.btn:disabled` and `.btn.blocked`, `background: var(--bg);` becomes `background: var(--disabled-bg);`. After the `.ghost { … }` rule add:

```css
  /* Disabled ghost stays transparent: its enabled look has no fill, so a
     --disabled-bg tile would make the disabled one look raised. (0,4,0) beats
     .btn:disabled and .btn.blocked. */
  .btn.ghost:disabled { background: transparent; border-color: transparent; }
  .btn.ghost.blocked { background: transparent; border-color: transparent; }
```

2. `frontend/src/components/ui/IconButton.svelte`: in `.icon-btn:disabled` and `.icon-btn.blocked`, `background: var(--bg);` becomes `background: var(--disabled-bg);`. After the `.icon-btn.blocked { … }` rule add:

```css
  /* Borderless stays transparent when disabled, as the ghost Button does. */
  .icon-btn.borderless:disabled { background: transparent; border-color: transparent; }
  .icon-btn.borderless.blocked { background: transparent; border-color: transparent; }
```

3. `background: var(--bg)` becomes `background: var(--disabled-bg)` in: `frontend/src/components/ui/InlineConfirm.svelte:149` (`.cancel[aria-disabled="true"]`), `frontend/src/components/ui/DangerConfirm.svelte:156` (`.dc-cancel:disabled`), `frontend/src/components/editor/QuestionTypePicker.svelte:48` (`.qtype-picker:disabled label`), `frontend/src/pages/MiniProjectDetailPage.svelte:695` (`.drop:has(input:disabled)`).

4. `frontend/src/components/chrome/Toast.svelte:19`: `color: var(--bg);` becomes `color: var(--primary-text);`.

5. `frontend/src/components/ui/FilterPills.svelte:35`: in `.fp[aria-pressed='true']`, `border-color: var(--primary-soft);` becomes `border-color: var(--primary);` (the soft fill and border are 1.04:1 on the ground).

Check that no `var(--bg)` is left as a fill or text colour outside the page itself:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && grep -rn "var(--bg)" src --include='*.svelte' --include='*.css'
```

Expected: only `src/styles/theme-default.css` (`--focus-page: var(--bg)`) and the body rule in `src/styles/base.css` (`background: var(--bg)`). Anything else is a finding: decide it by the spec (§Disabled controls) and ledger a ruling.

- [ ] **Step 5: The player sheet**

`frontend/src/pages/SequencePlayer.svelte`:

1. `.strip` (`:276-284`): `padding: 0 0 14px; /* ref 2112 — no top padding */` becomes `padding: 0; /* D56: the sheet's edge replaces the bottom rule */`, and the `border-bottom: 1px solid var(--border);` line goes.
2. `.content` (`:333`): `.content { padding: 0; min-height: 200px; }` becomes

```css
  /* D56: the white reading sheet. The padding is artboard 2c's card (measured
     above); the crumbs, the strip and the footer stay on the ground. */
  .content { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 20px 20px; min-height: 200px; }
```

3. `footer` (`:334-341`): the `padding-top: 14px; /* ref 2138 */` and `border-top: 1px solid var(--border);` lines go; `margin-top: 24px; /* ref 2138 */` stays.

- [ ] **Step 6: The mini-project sheet**

`frontend/src/pages/MiniProjectDetailPage.svelte`:

1. Markup. In the `{:else if data}` branch, move `<nav class="breadcrumb" …>…</nav>` (`:476-482`) out of `<header>` to just before it, and wrap everything from `<header>` to the history's `{/if}` in `<div class="sheet">`:

```svelte
    {:else if data}
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/courses">Courses</a>
        <span class="sep" aria-hidden="true">/</span>
        <a href="/courses/{courseSlug}">{currentCourse.value?.course.name ?? '<Course Name>'}</a>
        <span class="sep" aria-hidden="true">/</span>
        <span class="current" aria-current="page">{titleForHeading}</span>
      </nav>
      <!-- D56: the white reading sheet; the crumbs stay on the ground, as the player's do. -->
      <div class="sheet">
        <header>
          <div class="title-row">
          …(unchanged: the title row and the deadlines)…
        </header>
        …(unchanged: section.assignment, .grid2, the history {#if})…
      </div>
    {/if}
```

Re-indent the moved block by two spaces; change nothing else inside it.

2. Style. After the `.mp-col { max-width: 760px; }` rule add:

```css
  /* D56: the player's sheet declarations. The cards inside keep their own
     border and fill and read as bordered sections. */
  .sheet { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 20px 20px; min-height: 200px; }
  /* The last card's own margin would add to the sheet's bottom padding. */
  .sheet > :last-child { margin-bottom: 0; }
```

3. The `.grid2` comment (`:672`): `at the spec's 320px test width the content box is exactly 280px, the bare floor, and any pixel shaved off it (a classic scrollbar) would overflow the page` becomes `inside the Polish 2 sheet a 320px viewport leaves well under 280px, so the min() is what keeps one column from overflowing the page`.

- [ ] **Step 7: The `body:has` rules**

1. `frontend/src/pages/editor/VersionsPage.svelte:382-384`: delete

```css
  /* 5c follow-up (user): the editor's page shade, so the course page and the
     version page read alike. `.page` stays scoped: the rule ends with the page. */
  :global(body):has(.page) { background: var(--focus-page); }
```

2. `frontend/src/pages/editor/VersionEditPage.svelte`:
   - `:797-800`: replace

```css
  /* R3: the page shade spans the viewport. body:has() needs no JS and ends
     with the page (no .canvas → no rule). `.canvas` stays scoped, so the rule
     matches only while THIS page is mounted. */
  :global(body):has(.canvas.d0) { background: var(--focus-page); }
```

   with

```css
  /* R3: one level open shades the whole viewport a step darker. body:has()
     needs no JS and ends with the page (no .canvas → no rule). `.canvas` stays
     scoped, so the rule matches only while THIS page is mounted. With nothing
     open (d0) the page ground is already --focus-page (D50). */
```

   - `:763`: `the 1px line keeps it visible on --focus-page.` becomes `the 1px line keeps it visible on the page ground.`

- [ ] **Step 8: Comments that go stale**

1. `frontend/src/components/items/QuizItem.svelte:249-252`: replace

```
       but it is LIGHTER (contrast on --bg: --border 1.22:1, --border-faint
       1.11:1, --border-soft 1.09:1), which works against the very complaint this
       rule answers. --border is also what the two rules bracketing this quiz on
       the same screen use (SequencePlayer .strip bottom, footer top). */
```

with

```
       but it is LIGHTER (on the white player sheet: --border 1.26:1,
       --border-faint 1.15:1, --border-soft 1.13:1), which works against the
       very complaint this rule answers. --border is also the sheet's own edge. */
```

2. `QuizItem.svelte:268-269`: `/* --surface-2, not --surface-3: the card sits on the article's inherited` / `--bg, against which --surface-3 is a near-invisible step. flex-start keeps` becomes `/* --surface-2, not --surface-3: the card sits on the white player sheet` / `(D56), against which --surface-3 is a near-invisible step. flex-start keeps`.

3. `frontend/src/components/course/BlockGroup.svelte:130-131`: `.page\` sets no background, so without it the card inherits \`--bg\` (#FBFBFC)` becomes `.page\` sets no background, so without it the card inherits the page ground \`--bg\``.

- [ ] **Step 9: Build, check the hash, run everything**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run build > $SDD/tmp/build.log 2>&1 && python3 $SDD/probe/hashless.py ':root'
```

Expected: `('', ':root', '7bfdd12a'),`. If the printed hash differs, the dist one wins: use it in `WANT_FULL` and in the Step 2 comment, and ledger a ruling with both values.

Then the full checks (Global Constraints). Expected: vitest green, including the two new tests; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2279 checks)`. If the ghost or borderless rows fail because dist merged a pair into one selector list (`.btn.ghost.svelte-H:disabled,.btn.ghost.blocked.svelte-H{…}`), replace that pair's two `d` rows with one `chk` on the emitted list (two declarations, the same count) and ledger it.

- [ ] **Step 10: The backlog**

1. Append `## Task 2 — the page ground and the sheets` to `docs/backlog/polish2-named-items-debt.md`.
2. Delete `docs/backlog/page-background-reads-gray-against-header.md` (`git rm`).

- [ ] **Step 11: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide, and the two sheets again at 320 wide (no sideways scroll: `agent-browser eval "document.documentElement.scrollWidth"` equals the viewport width):
- the course list, a course view;
- the player: the top edge (crumbs, strip, sheet) and the bottom edge (sheet, footer) on a page with code; a submitted quiz (explanation panel, result card, locked options), read only, no new attempt;
- the mini-project page (sheet, inner cards, the "Not submitted" pill);
- Teaching with a pressed filter pill; the run's Assets tab with a pressed pill;
- the versions page;
- a disabled Button and IconButton on the ground: the player's Previous on the first item, the editor bar.

Show them in an overlay, then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/styles/theme-default.css \
  frontend/src/components/ui/Button.svelte frontend/src/components/ui/IconButton.svelte \
  frontend/src/components/ui/InlineConfirm.svelte frontend/src/components/ui/DangerConfirm.svelte \
  frontend/src/components/editor/QuestionTypePicker.svelte frontend/src/components/chrome/Toast.svelte \
  frontend/src/components/ui/FilterPills.svelte frontend/src/pages/SequencePlayer.svelte \
  frontend/src/pages/MiniProjectDetailPage.svelte frontend/src/pages/editor/VersionsPage.svelte \
  frontend/src/pages/editor/VersionEditPage.svelte frontend/src/components/items/QuizItem.svelte \
  frontend/src/components/course/BlockGroup.svelte frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/MiniProjectDetailPage.svelte.test.ts docs/backlog/polish2-named-items-debt.md
git rm -q docs/backlog/page-background-reads-gray-against-header.md
git commit -m "$(cat <<'EOF'
feat(polish2): a clear-tint page ground, white reading sheets on the player and the mini-project page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Authored content at page scale, and external links (D51, D52, D57, D58, D59)

**Files:**
- Create: `frontend/src/styles/content.css`
- Modify: `frontend/src/app.css` (import after `base.css`)
- Create: `frontend/src/lib/externalLinks.ts`
- Test: `frontend/src/tests/externalLinks.test.ts` (new), `frontend/src/tests/PageItem.svelte.test.ts` (new)
- Modify: `frontend/src/components/items/PageItem.svelte` (markup `:35`, `<style>` from `/* ---- {@html} content styles` to the end)
- Modify: `frontend/src/pages/MiniProjectDetailPage.svelte` (header comment `:6`, import `:23-30`, `assignmentEl` `:45-46`, the `$effect` `:182-190`, markup `:503-506`, `<style>` `:659-670`)
- Modify: `frontend/src/lib/studentMiniProjects.ts` (header `:3`, `:8`; delete `rewriteExternalLinks` `:129-150`)
- Modify: `frontend/src/tests/studentMiniProjects.test.ts` (import `:6`; delete `describe('rewriteExternalLinks', …)` `:233-287`)
- Modify: `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` (D6.11 `:661-679`, comment `:961`)
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((b4) `WANT_FULL` / `WANT_ORDER` and comment log; (b5) harvest list `:685`; GLOBAL_ALLOW PageItem and MiniProjectDetailPage entries `:416-438`, `:463-476`; (g2) TARGETS `:979-986`; (h) `:1082-1119`; markup scanner header `:1216-1218`, SPEC `:1390`, SIG `:1573-1575`, the walk `:1743-1745`, `:1895`, `:1964-1971`; (p) PageItem spec `:3297-3326`; (s) `:3560-3566`; section (an); `EXPECTED_CHECKS`)
- Modify: `docs/backlog/polish2-named-items-debt.md` (`## Task 3` heading)
- Delete: `docs/backlog/page-content-h4-h6-and-blockquote-unstyled.md`

- **D63 (added at the look review, 2026-10-19; spec rev 9):** the three heading-margin rules in `content.css` become one, `.prose :where(h1, h2, h3, h4, h5, h6) { margin: 1em 0 .5em; }`; (b4) `WANT_FULL` / `WANT_ORDER` drop `.prose :where(h1,h2,h3)`, `.prose :where(h4,h5,h6)` and `.prose.compact :where(h1,h2,h3,h4,h5,h6)` and gain `.prose :where(h1,h2,h3,h4,h5,h6)` (`8f770fc2`, dist); 26 `.prose` rules; `EXPECTED_CHECKS` unchanged (2270).

**Interfaces:**
- Consumes: Task 1's (b4) lists and section (an); Task 2's `div.sheet` on the mini-project page.
- Produces:
  - `frontend/src/styles/content.css`: `.prose` (page scale) and `.prose.compact`. Task 4 adds the class to the compact surfaces.
  - `frontend/src/lib/externalLinks.ts`:
    - `export function externalLinks(_html: string): (el: HTMLElement) => void` — an attachment factory. Use it as `{@attach externalLinks(<the same html expression the element renders>)}` on the element that holds the `{@html}`.
    - `export function opensInNewTab(href: string): boolean` — the D58/D59 test.
  - In the gate: the zsh arrays `CONTENT_SURFACES` (the eleven files that may render `prose`) and `CONTENT_DONE` (the converted ones; Task 4 sets it to the whole list), the source checks that use them, and the scanner's `attachOn` carve-out. Task 4 adds `attachOn` entries for QuizItem and the four question components.

- [ ] **Step 1: "Before" screenshots**

The content is rendered by the backend and injected into the live page, so no dev data is written. Save the fixture as `$SDD/probe/content-fixture.md`:

~~~markdown
# Heading one

A paragraph with a [link](https://example.org/x), `inline code` and a long unbreakable https://example.org/a-very-long-path-that-does-not-break-anywhere-at-all-in-a-narrow-window

## Heading two

### Heading three

#### Heading four

##### Heading five

###### Heading six

> A quote with **bold** text.
> Its second line.

- a tight list
- with a nested ordered list
  1. first
  2. second
- > a quote inside a list item

---

- a loose list item

  with a second paragraph

- another loose item

```python
def f(x):
    return x ** 2
```

The last paragraph.
~~~

Render it (read only):

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && backend/.venv/bin/python -c "import sys; from mathion.markdown import render_markdown; print(render_markdown(open(sys.argv[1]).read()))" $SDD/probe/content-fixture.md > $SDD/probe/content-fixture.html
```

In the dev browser, signed in as `dev@mathion.test`, open a page item of the demo course in the player and replace the rendered content with the fixture (`agent-browser eval` setting `document.querySelector('.page-item .content').innerHTML` to the file's text). Screenshot the article at 1280 wide, then the same on the mini-project page's `[data-testid="assignment-html"]`. Keep both as `$SDD/shots/t3-before-*.png`.

- [ ] **Step 2: Write the failing `externalLinks` tests**

Create `frontend/src/tests/externalLinks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { externalLinks, opensInNewTab } from '../lib/externalLinks';

// jsdom's origin is http://localhost:3000; same-origin hrefs are built from it, never hard-coded.
const here = location.origin;

function attach(href: string): HTMLAnchorElement {
  const el = document.createElement('div');
  const a = document.createElement('a');
  a.setAttribute('href', href);
  a.textContent = 'x';
  el.append(a);
  externalLinks('<p>unused</p>')(el);
  return a;
}

describe('externalLinks (Polish 2 D58, D59)', () => {
  it.each([
    ['https to another origin', 'https://example.org/x'],
    ['http to another origin', 'http://example.org'],
    ['an uppercase scheme (the renderer keeps scheme case)', 'HTTPS://EXAMPLE.ORG/A'],
    ['a protocol-relative host', '//cdn.example.org/x'],
    ['a course file, relative', '/assets/12/notes.pdf'],
    ['a run file, relative', '/api/runs/3/assets/data.csv'],
    ['a course file, same-origin absolute', `${here}/assets/12/notes.pdf`],
    ['a run file, same-origin absolute', `${here}/api/runs/3/assets/data.csv`],
  ])('%s opens in a new tab with rel=noopener noreferrer', (_label, href) => {
    const a = attach(href);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each([
    ['a Mathion page, same-origin absolute', `${here}/courses/demo`],
    ['a Mathion page, relative', '/courses/x'],
    ['an anchor', '#section-2'],
    ['mailto', 'mailto:a@b.org'],
    ['tel', 'tel:+4512345678'],
    ['an href that does not parse', 'http://[bad'],
  ])('%s stays in the tab', (_label, href) => {
    const a = attach(href);
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.hasAttribute('rel')).toBe(false);
  });

  it('leaves an anchor without href alone', () => {
    const el = document.createElement('div');
    el.innerHTML = '<a name="top">top</a>';
    externalLinks('')(el);
    expect(el.querySelector('a')!.hasAttribute('target')).toBe(false);
  });

  it('opensInNewTab is the same test', () => {
    expect(opensInNewTab('https://example.org')).toBe(true);
    expect(opensInNewTab('/assets/1/a.pdf')).toBe(true);
    expect(opensInNewTab('/courses/x')).toBe(false);
  });
});
```

Run:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/externalLinks.test.ts > $SDD/tmp/vitest-t3.log 2>&1; tail -20 $SDD/tmp/vitest-t3.log
```

Expected: FAIL, the module `../lib/externalLinks` does not resolve.

- [ ] **Step 3: `externalLinks.ts`**

Create `frontend/src/lib/externalLinks.ts`:

```ts
// Links in authored content (Polish 2 D58, D59). A link to another site, or to
// one of Mathion's own files (/assets/… course files, /api/… run files), opens
// in a new tab, so a student mid-quiz keeps unsubmitted answers. A Mathion
// page, an #anchor, mailto: and tel: stay in the tab.
//
// The test is by origin, not by prefix: a teacher may paste a Mathion address
// from the address bar, and it stays in the tab. The URL parser lowercases the
// scheme, so HTTPS://… is caught, and a //host href resolves to the page's
// scheme and takes the same test. An href that does not parse is left alone.
//
// Trust boundary (F8/L1/M7): the HTML is sanitised server-side (backend
// markdown.py, nh3), which already adds rel="noopener noreferrer"; this sets it
// again as defence in depth. Teachers remain the authoring trust boundary.
// Same-origin file URLs are not rewritten, only opened in a new tab.
export function opensInNewTab(href: string): boolean {
  let u: URL;
  try {
    u = new URL(href, document.baseURI);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.origin !== location.origin) return true;
  return /^\/(assets|api)\//.test(u.pathname);
}

// An attachment factory: `{@attach externalLinks(html)}` on the element that
// renders `{@html html}`. Passing the HTML makes the attachment run again
// whenever the content changes.
export function externalLinks(_html: string) {
  return (el: HTMLElement): void => {
    for (const a of el.querySelectorAll('a[href]')) {
      if (!opensInNewTab(a.getAttribute('href') ?? '')) continue;
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  };
}
```

Run the Step 2 command. Expected: PASS (16 tests).

- [ ] **Step 4: Write the failing surface tests**

1. Create `frontend/src/tests/PageItem.svelte.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// PageItem starts a coverage tracker on mount; neither it nor the store matters here.
vi.mock('../lib/coverage.svelte', () => ({
  createCoverageTracker: () => ({ start: vi.fn(), stop: vi.fn(async () => {}), markCovered: vi.fn(async () => {}) }),
}));
vi.mock('../stores/currentCourse.svelte', () => ({ markItemCovered: vi.fn() }));

import PageItem from '../components/items/PageItem.svelte';
import type { StaticPageItem } from '../lib/types';

function makeItem(content_html: string): StaticPageItem {
  return { id: 1, sequence_id: 1, title: 'A page', slug: 'a-page', order: 0, type: 'static_page', content_md: '', content_html };
}

let target: HTMLElement;
let component: ReturnType<typeof mount> | null = null;
beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) { unmount(component); component = null; } target.remove(); });

describe('PageItem authored content (Polish 2)', () => {
  it('D51: the content renders in the page-scale prose box', () => {
    component = mount(PageItem, { target, props: { item: makeItem('<p>x</p>') } });
    flushSync();
    const box = target.querySelector('.page-item .content')!;
    expect(box.classList.contains('prose')).toBe(true);
    expect(box.classList.contains('compact')).toBe(false);
  });

  it('D58: an external link opens in a new tab; a Mathion page link stays', () => {
    const html = `<p><a href="https://example.org/x">ext</a> <a href="${location.origin}/courses/x">page</a></p>`;
    component = mount(PageItem, { target, props: { item: makeItem(html) } });
    flushSync();
    const ext = target.querySelector('a[href="https://example.org/x"]')!;
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');
    const page = target.querySelector(`a[href="${location.origin}/courses/x"]`)!;
    expect(page.hasAttribute('target')).toBe(false);
  });
});
```

2. `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts`, replace the D6.11 test (`:661-679`) with:

```ts
  it('D6.11 external and file links open in a new tab; a page link and mailto stay (D58, D59)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      assignment_html: `<p><a href="https://example.com">ext</a><a href="/api/runs/1/assets/x.png">asset</a><a href="${location.origin}/courses/x">page</a><a href="mailto:t@x">mail</a></p>`,
    }));
    await mountPage();

    const box = target.querySelector('[data-testid="assignment-html"]')!;
    expect(box.classList.contains('prose')).toBe(true);
    expect(box.classList.contains('compact')).toBe(false);

    const ext = box.querySelector('a[href="https://example.com"]');
    if (!ext) throw new Error('expected external link');
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');

    // D59: Mathion's own files open in a new tab too, so unsubmitted work stays.
    const asset = box.querySelector('a[href="/api/runs/1/assets/x.png"]');
    if (!asset) throw new Error('expected asset link');
    expect(asset.getAttribute('target')).toBe('_blank');
    expect(asset.getAttribute('rel')).toBe('noopener noreferrer');

    const page = box.querySelector(`a[href="${location.origin}/courses/x"]`);
    if (!page) throw new Error('expected page link');
    expect(page.getAttribute('target')).toBeNull();

    const mail = box.querySelector('a[href="mailto:t@x"]');
    if (!mail) throw new Error('expected mailto link');
    expect(mail.getAttribute('target')).toBeNull();
  });
```

   The D6.12 test (`:681-…`) stays as it is: it is the only test that shows the links follow a content change, and it now runs against the attachment. At `:961`, the trailing comment `// rewriteExternalLinks still bound (L1/M1)` becomes `// the externalLinks attachment (D58)`.

Run:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/PageItem.svelte.test.ts src/tests/MiniProjectDetailPage.svelte.test.ts > $SDD/tmp/vitest-t3.log 2>&1; tail -40 $SDD/tmp/vitest-t3.log
```

Expected: FAIL in three tests: PageItem's two (no `prose`; no `target`) and D6.11 (no `prose`; the asset link has no `target`). Every other MiniProjectDetailPage test passes, D6.12 included.

- [ ] **Step 5: Write the failing gate rows**

In `frontend/scripts/visual-refresh-gate.sh`:

1. (b4) comment log, after Task 2's block:

```
# Polish 2 T3 (user D51/D52, 2026-10-18): content.css joins the global files,
# imported after base.css: 28 rules, every one scoped under `.prose`. ORDER
# matters here: the first/last-child margin rules (0,2,0) win over the compact
# spacing rules (0,2,0) only by coming after them.
```

2. `WANT_FULL`: after `('', '.mono,code,kbd', '84a226e9'),` insert, in this order (Python sort order):

```python
    ('', '.prose', '115422ed'),
    ('', '.prose :is(h1,h2,h3,h4,h5,h6)', '9dabc362'),
    ('', '.prose :where(h1,h2,h3)', 'aabf96b1'),
    ('', '.prose :where(h4,h5,h6)', 'f5a4886a'),
    ('', '.prose :where(p,ul,ol,pre,blockquote,hr,div.math)', '13af6f60'),
    ('', '.prose :where(ul,ol)', '17bebee9'),
    ('', '.prose :where(ul,ol):has(>li>p)>li+li', 'ca5345b0'),
    ('', '.prose a', '0be0b8c6'),
    ('', '.prose a:hover', '98e62ed4'),
    ('', '.prose blockquote', '5fe22df0'),
    ('', '.prose code', 'a92bcf18'),
    ('', '.prose h1', '8d5cc1f9'),
    ('', '.prose h2', '805a16ec'),
    ('', '.prose h3', '85586ccb'),
    ('', '.prose h4', '08f874dd'),
    ('', '.prose h5', 'a838c678'),
    ('', '.prose h6', 'fdbae480'),
    ('', '.prose hr', 'a216bc6c'),
    ('', '.prose ol>li', 'd67e9248'),
    ('', '.prose pre', 'bd339863'),
    ('', '.prose pre code', 'f4859c1f'),
    ('', '.prose ul>li', '20d7366f'),
    ('', '.prose.compact :where(h1,h2,h3,h4,h5,h6)', 'a480a97d'),
    ('', '.prose.compact :where(p,ul,ol,pre,blockquote,hr,div.math)', 'e291811a'),
    ('', '.prose.compact h1', 'a5b38d68'),
    ('', '.prose.compact h2', 'c2943c7b'),
    ('', '.prose>:first-child,.prose :where(li,blockquote)>:first-child', 'd462248a'),
    ('', '.prose>:last-child,.prose :where(li,blockquote)>:last-child', 'ef0b7a11'),
```

3. `WANT_ORDER`: after the forced-colors row (content.css comes after base.css) append, in document order:

```python
    ('', '.prose'), ('', '.prose :is(h1,h2,h3,h4,h5,h6)'),
    ('', '.prose h1'), ('', '.prose h2'), ('', '.prose h3'), ('', '.prose h4'),
    ('', '.prose h5'), ('', '.prose h6'), ('', '.prose.compact h1'), ('', '.prose.compact h2'),
    ('', '.prose :where(p,ul,ol,pre,blockquote,hr,div.math)'),
    ('', '.prose :where(h1,h2,h3)'), ('', '.prose :where(h4,h5,h6)'),
    ('', '.prose.compact :where(p,ul,ol,pre,blockquote,hr,div.math)'),
    ('', '.prose.compact :where(h1,h2,h3,h4,h5,h6)'),
    ('', '.prose>:first-child,.prose :where(li,blockquote)>:first-child'),
    ('', '.prose>:last-child,.prose :where(li,blockquote)>:last-child'),
    ('', '.prose :where(ul,ol):has(>li>p)>li+li'),
    ('', '.prose :where(ul,ol)'), ('', '.prose ul>li'), ('', '.prose ol>li'),
    ('', '.prose blockquote'), ('', '.prose hr'), ('', '.prose code'),
    ('', '.prose pre'), ('', '.prose pre code'), ('', '.prose a'), ('', '.prose a:hover'),
```

   and in the comment above `WANT_ORDER`, `# Document ORDER of the same 23 rules.` becomes `# Document ORDER of the same 51 rules.`; add the line `# content.css follows base.css: its first/last-child rules must come after the compact spacing rules.`

4. (b5) harvest list: the `content.css` line is added in Step 6, with the file. The harvest opens each file it names, and a missing one would crash the whole Python block instead of failing one row.

5. GLOBAL_ALLOW: delete the twelve PageItem entries with their comments (from `# PageItem renders the Page item type; it never contains a quiz.` to `('src/components/items/PageItem.svelte', 'pre code'),`, and the three entries `('src/components/items/PageItem.svelte', 'ol')`, `'p'`, `'ul'`), keeping the VideoItem and InteractiveAppItem `.frame` entries and their comment between them. Delete the eight MiniProjectDetailPage entries and their comment (from `# Slice-4 T3. The mini-project assignment card's content typography (spec` to `('src/pages/MiniProjectDetailPage.svelte', 'code'),`).

6. (g2) TARGETS (`:979-986`): delete the comment `# PageItem's {@html} rules: …` (four lines) and the four entries `'page content p'`, `'page list padding'`, `'page ul markers'`, `'page ol markers'`.

7. (h) (`:1082-1119`): replace the comment block from `# PageItem {@html} content rules. Load-bearing against reset.css:4, which zeroes` through `# top-level declaration, which is what closes the duplicate/@media hole.` with

```zsh
# PageItem's {@html} body is styled by content.css (`.prose`, Polish 2 D51).
# The component keeps only its box: the reflow guard, the page line-height and
# the text colour, which the content inherits. Checked in DIST and anchored on
# the PageItem hash.
```

   and replace the rows from `check "PageItem :global(p) margin-bottom"` through `none  "no blanket list-style:disc reaching <ol>" …` with

```zsh
  check "PageItem .content carries the page line-height (moved off p, Polish 2)" \
        "\.content\.${PI_H}\{([^}]*;)?line-height:1\.6[;}]"
  check "PageItem .content text colour" "\.content\.${PI_H}\{([^}]*;)?color:var\(--text-2\)[;}]"
  none  "PageItem has no {@html} element rules left (content.css styles them)" "\.content\.${PI_H} [a-z]"
```

   The anchor, the overflow-wrap row with its comment, and the mid-sequence `:global(ul) li` check after the block stay.

8. The markup scanner:
   - header (`:1216-1218`): after `needing to be enumerated as they are invented.` add `Polish 2: an {@attach} passes only where the file's attachOn names it, by element and exact source, exactly once (the authored-content links, D58).` (This line is in a zsh comment, outside the `node -e` payload.)
   - SPEC (`:1390`): `"PageItem.svelte":        { nodes: BASE.concat("HtmlTag"), tags: ["article", "div", "h2"] },` becomes

```js
  "PageItem.svelte":        { nodes: BASE.concat("HtmlTag"), tags: ["article", "div", "h2"],
                              attachOn: { "div:content.prose": "{@attach externalLinks(item.content_html)}" } },
```

   - SIG (`:1574`): `"div:content[class=\"content\"]"` becomes `"div:content.prose[class=\"content prose\"]"`.
   - The walk: after `const seenHidden = {};` (`:1744`) add `const seenAttach = {};`. Before `if (!ATTR.has(a.type)) { hits.push(…); continue; }` (`:1895`) add:

```js
          // Polish 2 D58: the authored-content link attachment is the only
          // {@attach} a scanned file may carry. Pinned by element and exact
          // source, and required exactly once, as styleOn is.
          if (a.type === "AttachTag") {
            const want = (spec.attachOn || {})[me];
            const got = srcText.slice(a.start, a.end).split(/\s+/).join(" ");
            if (want === undefined) hits.push(`<${n.name}> {@attach} ${got}`);
            else if (got !== want) hits.push(`<${n.name}> attachment is ${got} (pinned ${want})`);
            else seenAttach[me] = (seenAttach[me] || 0) + 1;
            continue;
          }
```

   - after the `hiddenOn` exactly-once loop (`:1968-1971`) add:

```js
  for (const [k, v] of Object.entries(spec.attachOn || {})) {
    const c = seenAttach[k] || 0;
    if (c !== 1) hits.push(`approved ${v} on ${k} appears ${c} times (pinned exactly once)`);
  }
```

   The scanner is inside `node -e '…'`: these lines contain no apostrophe, and none may be added.

9. (p) PageItem spec (`:3297-3326`): the comment above it becomes

```python
    # `max-width:652px` is the corrected measure -- the handoff sets no root
    # font-size so its `ch` resolves against 16px while this app sets 14px on
    # BODY, and 68ch would silently shrink the measure 12.5% here. The {@html}
    # body is styled by content.css since Polish 2; `.content` keeps the I2
    # reflow fix (`overflow-wrap:anywhere`) and the page's text metrics, which
    # the content inherits.
```

   and the spec's rows become:

```python
    spec('PageItem', pi, [
        ('.page-item@W@', SHELL + ';max-width:652px'),
        ('.page-item@W@ h2:where(@W@)', H2),
        ('.content@W@', 'overflow-wrap:anywhere;color:var(--text-2);line-height:1.6'),
    ]),
```

10. (s) (`:3560-3566`): replace the seven `.assignment-html` rows with

```zsh
  # The assignment's content is styled by content.css (Polish 2 D51); the box
  # keeps ref 1279's metrics, which the content inherits.
  d '\.assignment-html' '' 'overflow-wrap:anywhere' 'font-size:14px' 'line-height:1\.65' 'color:var\(--text-2\)'
  none "MP .assignment-html has no element rules left (content.css styles them)" "\.assignment-html\.${H} [a-z]"
```

11. Append to section (an):

```zsh
# Task 3 — authored content (D51, D52, D57-D59). content.css is frozen in (b4).
# The content surfaces are the only files that may render the `prose` class.
CONTENT_SURFACES=(src/components/items/PageItem.svelte src/pages/MiniProjectDetailPage.svelte
  src/components/items/quiz/SingleChoiceQuestion.svelte src/components/items/quiz/MultiChoiceQuestion.svelte
  src/components/items/quiz/NumericQuestion.svelte src/components/items/quiz/TextQuestion.svelte
  src/components/items/QuizItem.svelte src/pages/CourseView.svelte src/pages/editor/VersionEditPage.svelte
  src/components/editor/quiz/QuestionCard.svelte src/components/editor/MarkdownEditor.svelte)
# The surfaces converted so far. Task 4 sets this to the whole list.
CONTENT_DONE=(src/components/items/PageItem.svelte src/pages/MiniProjectDetailPage.svelte)
nstray=$(grep -rlE 'class="([^"]* )?prose( [^"]*)?"' src --include='*.svelte' | grep -vxF -f <(print -l $CONTENT_SURFACES) | grep -c .)
if [[ $nstray -eq 0 ]]; then echo "PASS  only the content surfaces render the prose class"
else echo "FAIL  the prose class outside the content surfaces ($nstray files)"; fail=1; fi
# Content structure lives in content.css alone. Anchored on the element right
# after `:global(`, so the prompts' `pre:focus-visible` ring does not match.
nredecl=$(grep -lE ':global\((:is\()?(p|ul|ol|li|a|img|code|pre|blockquote|hr|h[1-6])([ ,)]|:last-child)' $CONTENT_DONE | grep -c .)
if [[ $nredecl -eq 0 ]]; then echo "PASS  no converted content surface re-declares a content element"
else echo "FAIL  a converted content surface re-declares a content element ($nredecl files)"; fail=1; fi
if grep -rqE 'rewriteExternalLinks' src; then echo "FAIL  src still mentions rewriteExternalLinks"; fail=1
else echo "PASS  nothing under src mentions rewriteExternalLinks (externalLinks replaces it)"; fi
if [[ $(grep -cF '<div class="assignment-html prose" data-testid="assignment-html" {@attach externalLinks(data.assignment_html)}>' src/pages/MiniProjectDetailPage.svelte) -eq 1 ]]; then
  echo "PASS  the mini-project assignment is page-scale prose with the link attachment"
else echo "FAIL  the mini-project assignment is page-scale prose with the link attachment"; fail=1; fi
```

12. `EXPECTED_CHECKS` becomes `2270`: −4 (g2), −4 (h) (nine rows become five), −5 (s) (ten rows become five), +4 (an).

Run the gate. Expected: FAIL. The failures are exactly:
- (b4) `hashless rule ORDER changed` and the inventory row (no content.css yet);
- (b3) `the set of :global rules outside T3 changed` (`new:` lines for the 20 PageItem and MiniProjectDetailPage rules still in source);
- (h) and (p) for PageItem (the old rules are still there: the `none` row, the `.content` line-height and the inventory);
- the markup scanner for PageItem (`markup signature changed`; `approved {@attach …} appears 0 times`);
- (s): the three new `.assignment-html` declarations and its `none`;
- in (an): the redeclare check, the `rewriteExternalLinks` check and the assignment check.

Any other FAIL means a row is written wrong.

- [ ] **Step 6: `content.css`**

Create `frontend/src/styles/content.css`:

```css
/* Authored content: the HTML teachers write in markdown (Polish 2 D51, D52).
   `.prose` is the page scale; `.prose.compact` the quiz prompts, explanations,
   course and version info, and the editor's question cards. Each surface keeps
   its own font-size, line-height and colour on its box; everything here is
   relative to them. Global, and imported after base.css, so it is last in the
   bundle: no component rule out-orders it at equal specificity. Every rule is
   scoped under `.prose`. */

.prose { overflow-wrap: anywhere; }

/* Headings. Weight 600 comes from reset.css. */
.prose :is(h1, h2, h3, h4, h5, h6) { color: var(--text); line-height: 1.3; }
.prose h1 { font-size: 1.5em; letter-spacing: -.015em; }
.prose h2 { font-size: 1.143em; }   /* 16px on the 14px page */
.prose h3 { font-size: 1em; }
.prose h4 { font-size: 1em; color: var(--text-3); }
.prose h5 { font-size: max(12px, .93em); color: var(--muted); }
.prose h6 { font-size: max(12px, .86em); color: var(--muted); letter-spacing: .02em; }
.prose.compact h1 { font-size: 1.15em; }
.prose.compact h2 { font-size: 1.05em; }

/* Spacing. Every margin is set by element, not by position, so nested blocks
   (a quote in a list item, a code block in a quote) never keep browser margins.
   :where() keeps these at (0,1,0) and the compact ones at (0,2,0); the
   first/last-child rules come last at (0,2,0) and win by order. */
.prose :where(p, ul, ol, pre, blockquote, hr, div.math) { margin: 0 0 var(--space-3); }
.prose :where(h1, h2, h3) { margin: var(--space-4) 0 var(--space-2); }
.prose :where(h4, h5, h6) { margin: var(--space-3) 0 var(--space-1); }
.prose.compact :where(p, ul, ol, pre, blockquote, hr, div.math) { margin: 0 0 var(--space-2); }
.prose.compact :where(h1, h2, h3, h4, h5, h6) { margin: 12px 0 var(--space-1); }   /* 12px: between --space-2 and --space-3 */
.prose > :first-child,
.prose :where(li, blockquote) > :first-child { margin-top: 0; }
.prose > :last-child,
.prose :where(li, blockquote) > :last-child { margin-bottom: 0; }
/* A loose list (items wrapped in <p>) keeps a gap between items, since each item's last <p> is zeroed above. */
.prose :where(ul, ol):has(> li > p) > li + li { margin-top: var(--space-2); }

/* Lists and quotes. reset.css zeroes list padding and markers. */
.prose :where(ul, ol) { padding-inline-start: var(--space-4); }
.prose ul > li { list-style: disc; }
.prose ol > li { list-style: decimal; }
.prose blockquote { border-inline-start: 3px solid var(--focus-line-strong); padding: 2px 0; padding-inline-start: 12px; color: var(--muted); }
.prose hr { border: 0; border-top: 1px solid var(--border-strong); }

/* Code: the fill plus a hairline, so it reads on white, on the ground and on --surface-2 panels. */
.prose code { font-size: .93em; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border); padding: 2px 4px; border-radius: var(--radius); }
.prose pre { font-size: .93em; line-height: 1.5; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border); padding: var(--control-pad-textarea); border-radius: var(--radius); overflow-x: auto; max-width: 100%; }
.prose pre code { font-size: inherit; padding: 0; background: none; box-shadow: none; }

/* Links (D57). App chrome links keep base.css's no-underline style. */
.prose a { color: var(--primary); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.prose a:hover { text-decoration-thickness: 2px; }
```

`frontend/src/app.css`: after `@import './styles/base.css';` add `@import './styles/content.css';`.

In the gate's (b5) harvest list (`:685`), after `'src/components/items/PageItem.svelte',` add

```python
           # Polish 2: PageItem's {@html} rules moved to content.css, and with
           # them --space-4 and --control-pad-textarea. Harvest it too, or an
           # ancestor could zero them unguarded.
           'src/styles/content.css',
```


- [ ] **Step 7: PageItem**

`frontend/src/components/items/PageItem.svelte`:

1. Script: after `import { markItemCovered } from '../../stores/currentCourse.svelte';` add `import { externalLinks } from '../../lib/externalLinks';`.
2. Markup: `<div class="content">{@html item.content_html}</div>` becomes `<div class="content prose" {@attach externalLinks(item.content_html)}>{@html item.content_html}</div>`.
3. Style: replace everything from `/* ---- {@html} content styles -------------------------------------------` to the line before `</style>` with:

```css
  /* The {@html} body is styled by content.css (`.prose`, Polish 2 D51). The
     box keeps the page's text metrics, so lists, quotes and headings inherit
     them. overflow-wrap is the reflow guard (WCAG 1.4.10): one long
     unbreakable URL gave 433px of page-level horizontal scroll at a 320px
     viewport, because the overflow escapes .page-item and .page and neither
     clips. `.prose` sets it too; the box keeps its own, which the gate pins. */
  .content { overflow-wrap: anywhere; color: var(--text-2); line-height: 1.6; }
```

- [ ] **Step 8: The mini-project assignment**

`frontend/src/pages/MiniProjectDetailPage.svelte`:

1. Header comment `:6`: `// {@html} block with rewriteExternalLinks effect (L1/M1/M7), group context` becomes `// {@html} block with the externalLinks attachment (D58/D59), group context`.
2. Imports: delete `    rewriteExternalLinks,` from the `../lib/studentMiniProjects` import, and after that import add `import { externalLinks } from '../lib/externalLinks';`.
3. Delete `:45-46`:

```ts
  // N4 — `$state()` with no arg per RunTeachersTab.svelte:20 precedent.
  let assignmentEl: HTMLDivElement | undefined = $state();
```

4. Delete the effect (`:182-190`), from `// L1/M7 — link rewriter effect.` through its closing `});`, and the blank line after it.
5. Markup (`:503-506`; Task 2 indented it by two more spaces, keep that indent):

```svelte
        <!-- D58/D59: the attachment and {@html} on the SAME div, so the links follow a content change; data-testid is the test seam. -->
        <div class="assignment-html prose" data-testid="assignment-html" {@attach externalLinks(data.assignment_html)}>
          {@html data.assignment_html}
        </div>
```

6. Style: replace `:659-670` (the `/* Assignment card …` comment through `.assignment-html :global(code) { … }`) with:

```css
  /* Assignment card — ref 1277-1280. Its content is styled by content.css
     (`.prose`, Polish 2 D51); the box keeps ref 1279's metrics, so lists,
     quotes and headings inherit them. */
  .assignment { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 16px 18px; margin-bottom: 14px; /* ref 1277 */ }
  .assignment h2 { font-size: 14px; margin: 0 0 8px; /* ref 1278 */ }
  .assignment-html { overflow-wrap: anywhere; font-size: 14px; line-height: 1.65; color: var(--text-2); /* ref 1279 */ }
```

- [ ] **Step 9: Retire `rewriteExternalLinks`**

1. `frontend/src/lib/studentMiniProjects.ts`: `// Owns the four endpoints behind the student MP slice:` becomes `// Owns the three endpoints behind the student MP slice:`; delete the line `//   - rewriteExternalLinks → DOM post-processor for assignment_html (F8)`; delete from `// Defense-in-depth pass over assignment_html after Svelte commits {@html}.` through the closing `}` of `rewriteExternalLinks`, and the blank line before it.
2. `frontend/src/tests/studentMiniProjects.test.ts`: delete `  rewriteExternalLinks,` from the import, and the whole `describe('rewriteExternalLinks', …)` block with the blank line before it. Its cases live on in `externalLinks.test.ts`; the `/api/runs/...` case is reversed there under D59.

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && grep -rn "rewriteExternalLinks\|assignmentEl" src
```

Expected: no output.

- [ ] **Step 10: Build and check the hashes**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run build > $SDD/tmp/build.log 2>&1 && python3 $SDD/probe/hashless.py .prose
```

Expected: the 28 rows of Step 5.2, in the document order of Step 5.3 (computed while planning from the same CSS minified by esbuild 0.21). A different hash or selector form: dist wins; copy it into both lists and ledger a ruling with both values.

- [ ] **Step 11: The scanner refuses any other attachment**

A probe, reverted after. Save the file, add a second attachment, run the gate, restore:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && cp src/components/items/PageItem.svelte $SDD/tmp/PageItem.svelte.keep \
  && sed -i '' 's|<h2>{item.title}</h2>|<h2 {@attach externalLinks(item.content_html)}>{item.title}</h2>|' src/components/items/PageItem.svelte \
  && (TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate-probe.log 2>&1; grep -n "attach" $SDD/tmp/gate-probe.log | head); \
  cp $SDD/tmp/PageItem.svelte.keep src/components/items/PageItem.svelte
```

Expected: a FAIL naming `<h2> {@attach} {@attach externalLinks(item.content_html)}`. Then the same with the `div`'s attachment removed (`sed -i '' 's| {@attach externalLinks(item.content_html)}>{@html|>{@html|'`): a FAIL naming `appears 0 times`. After each probe, `cmp src/components/items/PageItem.svelte $SDD/tmp/PageItem.svelte.keep` prints nothing.

- [ ] **Step 12: Full checks**

Expected: vitest green (the three Step 4 tests now pass, the 16 `externalLinks` tests, D6.12); svelte-check 0 errors, 13 warnings; gate `ALL PASS (2270 checks)`.

- [ ] **Step 13: The backlog**

1. Append `## Task 3 — authored content, page scale` to `docs/backlog/polish2-named-items-debt.md`.
2. Delete `docs/backlog/page-content-h4-h6-and-blockquote-unstyled.md` (`git rm`).

- [ ] **Step 14: Screenshots, the user's OK, review lanes, commit**

"After" screenshots with the same fixture and the same injection as Step 1 (an injected fixture does not run the attachment; the link rule is covered by the tests): the page article at 1280 and at 320 wide (no sideways scroll), and the mini-project assignment. Show before and after side by side in an overlay. Also check a real page in the player with a link: it opens in a new tab (`agent-browser eval "document.querySelector('.page-item .content a')?.target"` prints `_blank`).

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/styles/content.css frontend/src/app.css \
  frontend/src/lib/externalLinks.ts frontend/src/tests/externalLinks.test.ts frontend/src/tests/PageItem.svelte.test.ts \
  frontend/src/components/items/PageItem.svelte frontend/src/pages/MiniProjectDetailPage.svelte \
  frontend/src/lib/studentMiniProjects.ts frontend/src/tests/studentMiniProjects.test.ts \
  frontend/src/tests/MiniProjectDetailPage.svelte.test.ts frontend/scripts/visual-refresh-gate.sh \
  docs/backlog/polish2-named-items-debt.md
git rm -q docs/backlog/page-content-h4-h6-and-blockquote-unstyled.md
git commit -m "$(cat <<'EOF'
feat(polish2): one style for authored content (page scale); external and file links open in a new tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Authored content on the compact surfaces (D51, D52, D57, D58)

**Files:**
- Modify: `frontend/src/components/items/quiz/SingleChoiceQuestion.svelte` (import `:2`, markup `:20`, `<style>` `:103-131`), `frontend/src/components/items/quiz/MultiChoiceQuestion.svelte` (import `:2`, markup `:26`, `<style>` `:115-143`)
- Modify: `frontend/src/components/items/quiz/TextQuestion.svelte` (import `:2`, markup `:20`, `<style>` `:60-92`), `frontend/src/components/items/quiz/NumericQuestion.svelte` (import `:2`, markup `:20`, `<style>` `:62-94`)
- Modify: `frontend/src/components/items/QuizItem.svelte` (import, markup `:169`, `<style>` `:292-300`)
- Modify: `frontend/src/pages/CourseView.svelte` (import, markup `:89`, `:94`)
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (import, markup `:633`)
- Modify: `frontend/src/components/editor/quiz/QuestionCard.svelte` (import `:15`, markup `:83`, `:129`, `<style>` `:159-163`)
- Modify: `frontend/src/components/editor/MarkdownEditor.svelte` (import, props `:11-50`, markup `:327`, `<style>` `:373`)
- Modify: `frontend/src/components/editor/quiz/NewQuestionModal.svelte:166`, `frontend/src/components/editor/quiz/QuestionTextModal.svelte:145`, `frontend/src/components/editor/quiz/ExplanationModal.svelte:189` (the `variant` prop)
- Delete: `frontend/src/lib/newTabLinks.ts`
- Test: `frontend/src/tests/SingleChoiceQuestion.svelte.test.ts`, `MultiChoiceQuestion.svelte.test.ts`, `NumericQuestion.svelte.test.ts`, `TextQuestion.svelte.test.ts`, `QuizItem.svelte.test.ts` (`:509-523`), `CourseView.svelte.test.ts`, `VersionEditPage.svelte.test.ts` (`:102-112`), `QuizOverview.svelte.test.ts` (`:99-106`), `MarkdownEditor.svelte.test.ts` (all in `frontend/src/tests/`)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (T3 `dd` rows `:171-179`; T3 (a) `:288-292` and its comment; (b) `WANT_GLOBAL` `:337-338`; (f) `:764-775`; GLOBAL_ALLOW `:406-414`, `:439-454`; markup SPEC `:1374-1381`, `:1401-1402`; SIG `:1551`, `:1562`, `:1613`, `:1617`, `:1621`; (n) docstring `:2846-2849` and `L` `:2877-2880`; QuizItem comment `:3157-3160` and `WANT` `:3181-3184`; MarkdownEditor `.preview` `:4060`; the 5d emoji scan `:4527`; section (an); `EXPECTED_CHECKS`)
- Modify: `docs/backlog/slice5c-constructor-polish-debt.md:66`, `docs/backlog/polish2-named-items-debt.md` (`## Task 4` heading)

**Interfaces:**
- Consumes: Task 3's `externalLinks(_html: string)` from `frontend/src/lib/externalLinks.ts`, `.prose` / `.prose.compact` from `content.css`, the gate arrays `CONTENT_SURFACES` / `CONTENT_DONE`, the `rewriteExternalLinks` source check, and the scanner's `attachOn` carve-out.
- Produces:
  - `MarkdownEditor`'s prop `variant?: 'page' | 'prompt' | 'explanation'` (default `'page'`). The rendered preview carries `preview prose pv-<variant>`, plus `compact` unless `'page'`.
  - Every authored-content surface carries `prose` (page) or `prose compact`, and `{@attach externalLinks(<its html>)}`.
  - `newTabLinks` no longer exists.

The six heading levels on a compact surface are shown to the user in Step 13 before approval (spec §What the scale gives).

- [ ] **Step 1: Write the failing tests**

1. In each of `SingleChoiceQuestion.svelte.test.ts`, `MultiChoiceQuestion.svelte.test.ts`, `NumericQuestion.svelte.test.ts` and `TextQuestion.svelte.test.ts`, add to the first `describe` (it uses the file's own `render()` and `question()` helpers):

```ts
  it('Polish 2: the prompt is compact prose; an external link opens in a new tab, a Mathion page link stays', () => {
    render({ question: { ...question(), text_html: `<p><a href="https://example.org/x">ext</a> <a href="${location.origin}/courses/x">page</a></p>` } });
    const text = host.querySelector('.text')!;
    expect(text.classList.contains('prose')).toBe(true);
    expect(text.classList.contains('compact')).toBe(true);
    expect(text.querySelector('a[href="https://example.org/x"]')!.getAttribute('target')).toBe('_blank');
    expect(text.querySelector(`a[href="${location.origin}/courses/x"]`)!.hasAttribute('target')).toBe(false);
  });
```

2. `QuizItem.svelte.test.ts`, the test whose reveal carries `explanation_html: '<p>Because the determinant is negative.</p>'` (`:509`): the fixture becomes

```ts
          explanation_html: `<p>Because the determinant is negative. <a href="https://example.org/d">More</a> <a href="${location.origin}/courses/x">Course</a></p>`,
```

and after `expect(exp?.textContent).toContain('Because the determinant is negative.');` add:

```ts
    expect(exp!.classList.contains('prose')).toBe(true);
    expect(exp!.classList.contains('compact')).toBe(true);
    expect(exp!.querySelector('a[href="https://example.org/d"]')!.getAttribute('target')).toBe('_blank');
    expect(exp!.querySelector(`a[href="${location.origin}/courses/x"]`)!.hasAttribute('target')).toBe(false);
```

3. `CourseView.svelte.test.ts`, after the `numbers blocks by their place in the list` test:

```ts
  it('Polish 2: course info is compact prose, beside the summary and alone; links follow D58', async () => {
    const html = `<p><a href="https://example.org/c">ext</a> <a href="${location.origin}/courses/y">page</a></p>`;
    seedCourse(twoBlocks, {}, html);
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    const info = target.querySelector('.top .info')!;
    expect(info.classList.contains('prose')).toBe(true);
    expect(info.classList.contains('compact')).toBe(true);
    expect(info.querySelector('a[href="https://example.org/c"]')!.getAttribute('target')).toBe('_blank');
    expect(info.querySelector(`a[href="${location.origin}/courses/y"]`)!.hasAttribute('target')).toBe(false);
    unmount(component); component = null;
    target.innerHTML = '';
    seedCourse([], {}, html);
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    const alone = target.querySelector('.info')!;
    expect(alone.classList.contains('prose')).toBe(true);
    expect(alone.querySelector('a[href="https://example.org/c"]')!.getAttribute('target')).toBe('_blank');
  });
```

   (`unmount` is imported by the file; if not, add it to the `svelte` import.)

4. `VersionEditPage.svelte.test.ts`, in `non-empty version info shows as muted rendered text…` (`:102`): `info_html` becomes `` `<p>Hi <strong>all</strong> <a href="https://example.org/v">ext</a> <a href="${location.origin}/courses/x">page</a></p>` ``, and after `expect(info.textContent).not.toContain('**');` add:

```ts
    expect(info.classList.contains('prose')).toBe(true);
    expect(info.classList.contains('compact')).toBe(true);
    expect(info.querySelector('a[href="https://example.org/v"]')!.getAttribute('target')).toBe('_blank');
    expect(info.querySelector(`a[href="${location.origin}/courses/x"]`)!.hasAttribute('target')).toBe(false);
```

5. `QuizOverview.svelte.test.ts` (`:99-106`), the test becomes:

```ts
  it('links in question text and explanations: external ones open in a new tab, a Mathion page stays (D58)', async () => {
    const s = new QuizServer([q({
      id: 1, text_html: `<p><a href="https://a.test" rel="noopener noreferrer">a</a> <a href="${location.origin}/courses/x">c</a></p>`,
      explanation_md: 'see', explanation_html: '<p><a href="https://b.test" rel="noopener noreferrer">b</a></p>',
    })]);
    await renderQuiz(s);
    const card = cards()[0];
    for (const sel of ['.qtext', '.qexpl-body']) {
      expect(card.querySelector(sel)!.classList.contains('prose')).toBe(true);
      expect(card.querySelector(sel)!.classList.contains('compact')).toBe(true);
    }
    const links = [...card.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('target'))).toEqual(['_blank', null, '_blank']);
  });
```

6. `MarkdownEditor.svelte.test.ts`, append:

```ts
describe('MarkdownEditor — preview variant (Polish 2 D51)', () => {
  it.each([
    [undefined, 'pv-page', false],
    ['page', 'pv-page', false],
    ['prompt', 'pv-prompt', true],
    ['explanation', 'pv-explanation', true],
  ])('variant %s: the preview is prose with %s (compact: %s); external links open in a new tab, page links stay', async (variant, cls, compact) => {
    (stubCtx.renderPreview as ReturnType<typeof vi.fn>).mockResolvedValue({ html: `<p><a href="https://example.org/p">x</a> <a href="${location.origin}/courses/x">y</a></p>` });
    const { target } = mountEditor(variant === undefined ? { readOnly: true } : { readOnly: true, variant });
    await vi.waitFor(() => expect(target.querySelector('.preview a')).not.toBeNull());
    const preview = target.querySelector('.preview')!;
    expect(preview.classList.contains('prose')).toBe(true);
    expect(preview.classList.contains(cls)).toBe(true);
    expect(preview.classList.contains('compact')).toBe(compact);
    expect(preview.querySelector('a[href="https://example.org/p"]')!.getAttribute('target')).toBe('_blank');
    // D58: inside the editor a Mathion page link stays in the tab, where DirtyGuard covers unsaved work.
    expect(preview.querySelector(`a[href="${location.origin}/courses/x"]`)!.hasAttribute('target')).toBe(false);
  });
});
```

Run:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/SingleChoiceQuestion.svelte.test.ts src/tests/MultiChoiceQuestion.svelte.test.ts src/tests/NumericQuestion.svelte.test.ts src/tests/TextQuestion.svelte.test.ts src/tests/QuizItem.svelte.test.ts src/tests/CourseView.svelte.test.ts src/tests/VersionEditPage.svelte.test.ts src/tests/QuizOverview.svelte.test.ts src/tests/MarkdownEditor.svelte.test.ts > $SDD/tmp/vitest-t4.log 2>&1; grep -E "✓|×|FAIL|Tests " $SDD/tmp/vitest-t4.log | tail -40
```

Expected: FAIL in exactly the new or changed tests: the four prompt tests, QuizItem's explanation test, CourseView's, VersionEditPage's, QuizOverview's (the page link has `_blank` today) and the four MarkdownEditor variants. Every other test in these files passes.

- [ ] **Step 2: Write the failing gate rows**

In `frontend/scripts/visual-refresh-gate.sh`:

1. T3 `dd` rows (`:171-179`): delete the comment block `# ---- paired .text paragraph margins (\`:global(p)\` stays bare in dist) ----` and its six comment lines, and the two rows `dd '\.text' 'p' …` and `dd '\.text' 'p:last-child' …`.

2. T3 (a) `want` (`:288-292`): delete the three rows `('', '.text.%s pre' % h, …)`, `('', '.text.%s p' % h, …)`, `('', '.text.%s p:last-child' % h, …)`. The `pre:focus-visible` row stays.

3. T3 (b): `WANT_GLOBAL = ['.text :global(p)', '.text :global(p:last-child)',` / `'.text :global(pre)', '.text :global(pre:focus-visible)']` becomes

```python
# Polish 2: the prompts' p and pre rules moved to content.css (`.prose.compact`);
# only the code-block focus ring stays a :global of the component.
WANT_GLOBAL = ['.text :global(pre:focus-visible)']
```

4. T3 (f) (`:764-775`): replace from `# (f) CUMULATIVE — T2's two prompt-paragraph pairs plus T3's two, in one bundle.` through the closing `% (len(pairs), len(last), set(pairs) == last, mine <= set(pairs)))` with

```python
# (f) CUMULATIVE — Polish 2 moved the prompts' paragraph and code rules to
#     content.css (`.prose.compact`). No `.text` rule of any component may
#     re-declare them, or the prompt spacing forks again.
BASE = [(s, b) for s, b, m in ALL if not m]
left = sorted(s for s, b in BASE if re.fullmatch(r'\.text\.svelte-[a-z0-9]+ (p|p:last-child|pre)', s))
if not left:
    print('PASS  no .text prompt rule re-declares p, p:last-child or pre (content.css owns them)')
else:
    bad = 1
    print('FAIL  .text prompt rules left: %s' % left)
```

5. GLOBAL_ALLOW: delete
   - the QuestionCard comment (`# Slice-5d: the authoring quiz card's rendered question text / explanation` and its two lines) and its four entries;
   - the choice-question comment (`# The choice questions are SIBLINGS of T3 …`, two lines) and the four Single/Multi `p` and `p:last-child` entries;
   - the reflow comment (`# Reflow fix (whole-branch review I2): …`, eight lines) and the three `pre` entries (QuizItem, Multi, Single).

6. Markup SPEC (`:1374-1381`, `:1401-1402`): add the carve-outs:

```js
  "QuizItem.svelte":        { nodes: BASE.concat("EachBlock", "HtmlTag", "ConstTag"),
                              tags: ["article", "div", "h2", "p", "span", "strong"],
                              attachOn: { "div:exp.prose.compact": "{@attach externalLinks(r.explanation_html)}" } },
  "SingleChoiceQuestion.svelte": { nodes: BASE.concat("EachBlock", "HtmlTag", "ConstTag"),
                              tags: ["div", "fieldset", "input", "label", "legend",
                                     "line", "polyline", "span", "svg"],
                              attachOn: { "div:text.prose.compact": "{@attach externalLinks(question.text_html)}" } },
  "MultiChoiceQuestion.svelte":  { nodes: BASE.concat("EachBlock", "HtmlTag", "ConstTag"),
                              tags: ["div", "fieldset", "input", "label", "legend",
                                     "line", "polyline", "span", "svg"],
                              attachOn: { "div:text.prose.compact": "{@attach externalLinks(question.text_html)}" } },
```

   and

```js
  "NumericQuestion.svelte": { nodes: BASE.concat("HtmlTag"), tags: ["div", "input", "p", "strong"],
                              attachOn: { "div:text.prose.compact": "{@attach externalLinks(question.text_html)}" } },
  "TextQuestion.svelte":    { nodes: BASE.concat("HtmlTag"), tags: ["div", "input", "p", "strong"],
                              attachOn: { "div:text.prose.compact": "{@attach externalLinks(question.text_html)}" } },
```

7. SIG: `"div:exp[class=\"exp\"]"` (`:1551`) becomes `"div:exp.prose.compact[class=\"exp prose compact\"]"`; `"div:text[class=\"text\"]"` (`:1562`, `:1621`) becomes `"div:text.prose.compact[class=\"text prose compact\"]"`; `"div:text[class=\"text\" id]"` (`:1613`, `:1617`) becomes `"div:text.prose.compact[class=\"text prose compact\" id]"`.

8. (n) docstring (`:2846-2849`): `` scroll); `.text pre { overflow-x: auto; max-width: 100% }` is its `` / `companion, and \`legend { max-width: 100% }\` is load-bearing with it --` becomes `` scroll); content.css's `.prose pre` scroller (Polish 2) is its `` / `companion, and \`legend { max-width: 100% }\` is load-bearing with it --`. `L` (`:2877-2880`): delete the three rows `('.text%s pre' % W, …)`, `('.text%s p' % W, …)`, `('.text%s p:last-child' % W, …)`.

9. QuizItem: the comment (`:3157-3160`) `` #   `.exp`'s `overflow-wrap: anywhere` and `.exp pre { overflow-x: auto }` are `` becomes `` #   `.exp`'s `overflow-wrap: anywhere` and content.css's `.prose pre` scroller are ``; delete the `WANT` row `('.exp%s pre' % W, 'overflow-x:auto;max-width:100%'),`.

10. MarkdownEditor (`:4060`): `d '\.preview' '' 'padding:12px 14px' 'font-size:13px' 'color:var\(--text\)'` becomes `d '\.preview' '' 'padding:12px 14px' 'min-height:200px'`.

11. The 5d emoji scan (`:4527`): `src/lib/quizContext.ts src/lib/newTabLinks.ts` becomes `src/lib/quizContext.ts src/lib/externalLinks.ts`.

12. Section (an), Task 3's rows:
    - `CONTENT_DONE=(src/components/items/PageItem.svelte src/pages/MiniProjectDetailPage.svelte)` and the comment above it become `# Every content surface is converted (Polish 2 Task 4).` / `CONTENT_DONE=($CONTENT_SURFACES)`;
    - the `rewriteExternalLinks` check becomes:

```zsh
if grep -rqE 'newTabLinks|rewriteExternalLinks' src; then echo "FAIL  src still mentions newTabLinks or rewriteExternalLinks"; fail=1
else echo "PASS  nothing under src mentions newTabLinks or rewriteExternalLinks (externalLinks replaces both)"; fi
```

13. Append to section (an):

```zsh
# Task 4 — authored content on the compact surfaces. The scanned files (quiz)
# are pinned by SIG and attachOn; these four are not scanned, so their class
# and attachment are pinned by source, exactly.
src_count() { if [[ $(grep -cF -- "$4" $3) -eq $2 ]]; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi }
src_count "course info is compact prose with the link attachment (both branches)" 2 src/pages/CourseView.svelte \
  '<div class="info prose compact" {@attach externalLinks(currentCourse.value.version.info_html)}>'
src_count "version info is compact prose with the link attachment" 1 src/pages/editor/VersionEditPage.svelte \
  '<div class="vinfo prose compact" {@attach externalLinks(v.info_html)}>'
src_count "the editor question text is compact prose with the link attachment" 1 src/components/editor/quiz/QuestionCard.svelte \
  '<div class="qtext prose compact" id={textId} {@attach externalLinks(q.text_html)}>'
src_count "the editor explanation is compact prose with the link attachment" 1 src/components/editor/quiz/QuestionCard.svelte \
  '<div class="qexpl-body prose compact" {@attach externalLinks(q.explanation_html ?? '"''"')}>'
src_count "the editor preview is prose, by variant, with the link attachment" 1 src/components/editor/MarkdownEditor.svelte \
  '<div class="preview prose pv-{variant}" class:compact={variant !== '"'page'"'} {@attach externalLinks(html ?? '"''"')}>'
# The preview takes the student surface's metrics, by variant (spec §The editor preview).
uniq1 md-card
if [[ -n $REPLY ]]; then
  N=MarkdownEditor; H=$REPLY
  d '\.preview\.pv-page' '' 'font-size:14px' 'line-height:1\.6' 'color:var\(--text-2\)'
  d '\.preview\.pv-prompt' '' 'font-size:14\.5px' 'line-height:1\.6' 'color:var\(--text-2\)'
  d '\.preview\.pv-explanation' '' 'font-size:13px' 'color:var\(--text-2\)'
  none "MarkdownEditor .preview sets no type metrics of its own (the variant does)" "\.preview\.${H}\{[^}]*(font-size|color):"
fi
```

   (`'"''"'` is zsh for two apostrophes inside a single-quoted literal: the source reads `?? ''`. This section is zsh, outside every `node -e` payload.)

14. `EXPECTED_CHECKS` becomes `2280`: −4 (the T3 `dd` rows), −1 (the `.preview` row loses a declaration), +15 in (an) (five `src_count` rows, one `uniq1`, eight variant declarations, the `none`).

Run the gate. Expected: FAIL. The failures are exactly:
- T3 (a) inventories for Numeric and Text (the `p`, `p:last-child`, `pre` rules still exist), (b) `:global` usage, (f);
- (b3) `the set of :global rules outside T3 changed` (`new:` lines for the 14 rules still in source);
- the markup scanner for QuizItem and the four question components (signature changed; `appears 0 times`);
- (n) for Single and Multi, the QuizItem inventory;
- MarkdownEditor `.preview { min-height:200px }` (the 5d emoji scan passes: `src/lib/externalLinks.ts` exists since Task 3);
- in (an): the `newTabLinks` check, the five `src_count` rows, the eight variant rows and the `none`; the redeclare check (the eleven files are now all in `CONTENT_DONE`).

Any other FAIL means a row is written wrong.

- [ ] **Step 3: The four quiz prompts**

1. `SingleChoiceQuestion.svelte` and `MultiChoiceQuestion.svelte`:
   - after the `import type …` line add `import { externalLinks } from '../../../lib/externalLinks';`;
   - markup: `<legend><div class="text">{@html question.text_html}</div></legend>` becomes `<legend><div class="text prose compact" {@attach externalLinks(question.text_html)}>{@html question.text_html}</div></legend>`;
   - in the legend comment, `SHRINK-TO-FIT, so a <pre> inside it widens the legend itself and the` / `scroller below never fires —` becomes `SHRINK-TO-FIT, so a <pre> inside it widens the legend itself and the` / `` `.prose pre` scroller never fires — ``;
   - replace from `  /* Server-rendered markdown: keep the inter-paragraph rhythm (reset.css zeroes` through `  .text :global(p:last-child) { margin: 0; }` with:

```css
  /* Reflow (WCAG 1.4.10). The prompt renders UNBOUNDED teacher markdown through
     `{@html}` (`text_md` is uncapped — backend/mathion/schemas.py:323). Measured
     at a 320px viewport before the guards: one hyphen-free URL produced 659px of
     PAGE-level horizontal scroll, a fenced code block 784px. `overflow-wrap`
     closes the prose case; content.css's `.prose pre` scroller (Polish 2), with
     the legend's `max-width` above, closes the code case. Paragraph spacing is
     content.css's too (`.prose.compact`).

     The fieldset's `min-inline-size: 0` above is a DIFFERENT fix and does not
     cover this: it stops an unbreakable prompt token from dragging the OPTION
     rows wide, but never wraps the prompt itself. */
  .text { overflow-wrap: anywhere; }
```

2. `TextQuestion.svelte` and `NumericQuestion.svelte`:
   - the same import line;
   - markup: `<div class="text" id={promptId}>{@html question.text_html}</div>` becomes `<div class="text prose compact" id={promptId} {@attach externalLinks(question.text_html)}>{@html question.text_html}</div>`;
   - in the `.text` comment, replace from the sentence `This closes PROSE only` to the end of that comment with `This closes PROSE only; a <pre> scrolls by content.css's \`.prose pre\` (Polish 2). */`;
   - replace from `  /* Server-rendered markdown: keep the inter-paragraph rhythm (reset.css zeroes` through `  .text :global(pre:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }` with:

```css
  /* Code blocks scroll by content.css's `.prose pre` (Polish 2), and its
     paragraph spacing is content.css's too. The scroller is keyboard-focusable
     in Chromium, which is what lets a keyboard user scroll it at all; this ring
     is pinned by the T3 inventory, so a change to the global ring cannot drop it. */
  .text :global(pre:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }
```

- [ ] **Step 4: The explanation, course info and version info**

1. `frontend/src/components/items/QuizItem.svelte`: add `import { externalLinks } from '../../lib/externalLinks';` after the `assertNever` import; `<div class="exp">{@html r.explanation_html}</div>` becomes `<div class="exp prose compact" {@attach externalLinks(r.explanation_html)}>{@html r.explanation_html}</div>`; in the `.exp` comment, `in a column flex, so it needs no \`max-width\` — these two rules are the` / `whole fix. */` becomes `in a column flex, so it needs no \`max-width\`: this and content.css's` / `` `.prose pre` scroller are the whole fix. */ ``; delete `  .exp :global(pre) { overflow-x: auto; max-width: 100%; }`.
2. `frontend/src/pages/CourseView.svelte`: add `import { externalLinks } from '../lib/externalLinks';` after the `progress` import; both `<div class="info">{@html currentCourse.value.version.info_html}</div>` (`:89`, `:94`) become `<div class="info prose compact" {@attach externalLinks(currentCourse.value.version.info_html)}>{@html currentCourse.value.version.info_html}</div>`.
3. `frontend/src/pages/editor/VersionEditPage.svelte`: add `import { externalLinks } from '../../lib/externalLinks';` after the `formErrors` import; `<div class="vinfo">{@html v.info_html}</div>` becomes `<div class="vinfo prose compact" {@attach externalLinks(v.info_html)}>{@html v.info_html}</div>`.

- [ ] **Step 5: The editor's question card**

`frontend/src/components/editor/quiz/QuestionCard.svelte`:
- `import { newTabLinks } from '../../../lib/newTabLinks';` becomes `import { externalLinks } from '../../../lib/externalLinks';`;
- `<div class="qtext" id={textId} {@attach newTabLinks(q.text_html)}>` becomes `<div class="qtext prose compact" id={textId} {@attach externalLinks(q.text_html)}>`;
- `<div class="qexpl-body" {@attach newTabLinks(q.explanation_html ?? '')}>` becomes `<div class="qexpl-body prose compact" {@attach externalLinks(q.explanation_html ?? '')}>`;
- delete the comment `/* Rendered author content: images fit the card; headings keep their tags at body size. */` and the four `.qtext :global(…), .qexpl-body :global(…)` rules after it (`:159-163`). Images keep reset.css's `max-width: 100%`.

Then `git rm -q frontend/src/lib/newTabLinks.ts` (from the repo root).

- [ ] **Step 6: The editor preview**

`frontend/src/components/editor/MarkdownEditor.svelte`:
1. After `import AssetSidebar from './AssetSidebar.svelte';` add `import { externalLinks } from '../../lib/externalLinks';`.
2. Props: after `noAssets = false,` add `variant = 'page',`; after the `noAssets?: boolean;` type line add

```ts
    // Polish 2 D51: which student surface the rendered preview matches, in
    // class (`prose`, `prose compact`) and text metrics.
    variant?: 'page' | 'prompt' | 'explanation';
```

3. Markup (`:327`): `<div class="preview">{@html html ?? ''}</div>` becomes `<div class="preview prose pv-{variant}" class:compact={variant !== 'page'} {@attach externalLinks(html ?? '')}>{@html html ?? ''}</div>`. The "Rendering…" and error previews are unchanged.
4. Style (`:373`): `.preview { min-height: 200px; padding: 12px 14px; font-size: 13px; color: var(--text); /* ref 1708 */ }` becomes

```css
  /* The rendered preview matches the student surface (Polish 2 D51): content.css's
     `.prose` plus that surface's text metrics. Line breaks still differ: the
     preview is narrower than the 652px measure. */
  .preview { min-height: 200px; padding: 12px 14px; }
  .preview.pv-page { font-size: 14px; line-height: 1.6; color: var(--text-2); /* PageItem .content */ }
  .preview.pv-prompt { font-size: 14.5px; line-height: 1.6; color: var(--text-2); /* the quiz prompt */ }
  .preview.pv-explanation { font-size: 13px; color: var(--text-2); /* QuizItem .exp */ }
```

5. Hosts:
   - `frontend/src/components/editor/quiz/NewQuestionModal.svelte:166`: `<MarkdownEditor ariaLabel="Question text" …` gains `variant="prompt"` after `ariaLabel="Question text"`;
   - `frontend/src/components/editor/quiz/QuestionTextModal.svelte:145`: the same;
   - `frontend/src/components/editor/quiz/ExplanationModal.svelte:189`: `variant="explanation"` after `ariaLabel="Explanation"`;
   - `PageBody` and `MiniProjectModal` keep the default `'page'`.

- [ ] **Step 7: No content rule left in the surfaces**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && grep -nE ':global\((:is\()?(p|ul|ol|li|a|img|code|pre|blockquote|hr|h[1-6])([ ,)]|:last-child)' src/components/items/quiz/*.svelte src/components/items/QuizItem.svelte src/components/editor/quiz/QuestionCard.svelte src/pages/CourseView.svelte src/pages/editor/VersionEditPage.svelte src/components/editor/MarkdownEditor.svelte; grep -rn "newTabLinks" src
```

Expected: no output (comments included: the gate check reads them too).

- [ ] **Step 8: Full checks**

Expected: vitest green (Step 1's tests pass; `QuizModals.svelte.test.ts:45` still finds `target="_blank"` on its external `.qtext` link); svelte-check 0 errors, 13 warnings (a new "unused CSS selector" warning for a `.pv-*` rule is a finding: the class is dynamic, so Svelte keeps the rules); gate `ALL PASS (2280 checks)`.

- [ ] **Step 9: The backlog**

1. `docs/backlog/slice5c-constructor-polish-debt.md:66`: the bullet `- **Rich version info under the title (review r1, both lanes).** …` becomes `- ~~**Rich version info under the title (review r1, both lanes).**~~ Done in Polish 2 Task 4: \`.vinfo\` is \`prose compact\` (content.css), with a heading scale and paragraph spacing.`
2. Append `## Task 4 — authored content, compact surfaces` to `docs/backlog/polish2-named-items-debt.md`.

- [ ] **Step 10: Screenshots, the user's OK, review lanes, commit**

Same no-write method as Task 3 (the fixture `$SDD/probe/content-fixture.html` injected with `agent-browser eval`), each surface at 1280 wide:
- a single-choice and a multi-choice prompt (one step), a text and a numeric prompt (another step), in the player;
- the explanation panel of an already-submitted quiz (read only; no new attempt);
- course info (`.info`, on the ground) and version info (`.vinfo`);
- the editor's question card `.qtext` and `.qexpl-body` (item editor, nothing saved);
- the preview in each variant: a page body, the question text modal, the explanation modal (Preview tab; nothing saved).

Each shows all six heading levels, a quote and code. Show them in an overlay; the user approves the compact heading scale here (spec §What the scale gives). Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add \
  frontend/src/components/items/quiz/SingleChoiceQuestion.svelte frontend/src/components/items/quiz/MultiChoiceQuestion.svelte \
  frontend/src/components/items/quiz/TextQuestion.svelte frontend/src/components/items/quiz/NumericQuestion.svelte \
  frontend/src/components/items/QuizItem.svelte frontend/src/pages/CourseView.svelte frontend/src/pages/editor/VersionEditPage.svelte \
  frontend/src/components/editor/quiz/QuestionCard.svelte frontend/src/components/editor/MarkdownEditor.svelte \
  frontend/src/components/editor/quiz/NewQuestionModal.svelte frontend/src/components/editor/quiz/QuestionTextModal.svelte \
  frontend/src/components/editor/quiz/ExplanationModal.svelte \
  frontend/src/tests/SingleChoiceQuestion.svelte.test.ts frontend/src/tests/MultiChoiceQuestion.svelte.test.ts \
  frontend/src/tests/NumericQuestion.svelte.test.ts frontend/src/tests/TextQuestion.svelte.test.ts \
  frontend/src/tests/QuizItem.svelte.test.ts frontend/src/tests/CourseView.svelte.test.ts \
  frontend/src/tests/VersionEditPage.svelte.test.ts frontend/src/tests/QuizOverview.svelte.test.ts \
  frontend/src/tests/MarkdownEditor.svelte.test.ts frontend/scripts/visual-refresh-gate.sh \
  docs/backlog/slice5c-constructor-polish-debt.md docs/backlog/polish2-named-items-debt.md
git commit -m "$(cat <<'EOF'
feat(polish2): authored content on the compact surfaces and the editor preview; newTabLinks retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(`frontend/src/lib/newTabLinks.ts` was staged as deleted by `git rm` in Step 5.)

---

### Task 5: The 404 page (D53)

**Files:**
- Modify: `frontend/src/pages/NotFound.svelte` (script and markup; the `.page` rule stays exactly as it is, the gate's page-column check at `:4379` reads it)
- Test: `frontend/src/tests/NotFound.svelte.test.ts` (new), `frontend/src/tests/App.notFound.svelte.test.ts` (new)
- Modify: `docs/backlog/polish2-named-items-debt.md` (`## Task 5` heading)

**Interfaces:**
- Consumes: `ErrorState` (`variant="page"`, `title`, `message`, the `action` snippet; root `role="alert"`, page title `h1.title`), `Button` (`variant="secondary"`), `defaultLandingPath(user)` and `navigate(path)` from `frontend/src/lib/router.svelte.ts`, `session` from `frontend/src/stores/session.svelte.ts`.
- Produces: nothing other tasks use. No gate rows change (`EXPECTED_CHECKS` stays `2280`).

- [ ] **Step 1: Write the failing component tests**

Create `frontend/src/tests/NotFound.svelte.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Keep the real defaultLandingPath; only navigate is observed.
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});

import NotFound from '../pages/NotFound.svelte';
import { session } from '../stores/session.svelte';
import { navigate } from '../lib/router.svelte';
import type { User } from '../lib/types';

function user(over: Partial<User> = {}): User {
  return {
    id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
    has_course_admin: false, has_run_teacher: false, ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  vi.mocked(navigate).mockClear();
  session.loading = false;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  session.user = null;
});

function render() {
  component = mount(NotFound, { target });
  flushSync();
  return target.querySelector<HTMLButtonElement>('.error-state .action button')!;
}

describe('NotFound (Polish 2 D53)', () => {
  it('is a page ErrorState: the h1, one line, an alert', () => {
    session.user = user();
    render();
    const card = target.querySelector('.page .error-state.page')!;
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.querySelector('h1.title')!.textContent).toBe('Page not found');
    expect(card.querySelector('.message')!.textContent).toBe('The address may be mistyped, or the page has moved.');
    expect(card.querySelectorAll('button').length).toBe(1);
  });

  it.each([
    ['a course admin', { has_course_admin: true, has_run_teacher: true }, 'Back to courses', '/courses'],
    ['a teacher only', { has_run_teacher: true }, 'Back to teaching', '/teaching'],
    ['a student', {}, 'Back to courses', '/courses'],
  ])('signed in as %s: the button names the start page', (_who, over, label, path) => {
    session.user = user(over);
    const btn = render();
    expect(btn.textContent!.trim()).toBe(label);
    expect(btn.classList.contains('secondary')).toBe(true);
    btn.click();
    expect(navigate).toHaveBeenCalledWith(path);
  });

  it('signed out: "Sign in" goes to /login (defaultLandingPath(null) would say /courses)', () => {
    session.user = null;
    const btn = render();
    expect(btn.textContent!.trim()).toBe('Sign in');
    btn.click();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
```

Run:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/NotFound.svelte.test.ts > $SDD/tmp/vitest-t5.log 2>&1; tail -30 $SDD/tmp/vitest-t5.log
```

Expected: FAIL, all five (no `.error-state` today; the old page has a plain "Back" link).

- [ ] **Step 2: Write the failing App tests**

Create `frontend/src/tests/App.notFound.svelte.test.ts`, in the manner of `App.runsRedirect.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import App from '../App.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';

// An unknown address renders NotFound through App. Only fetch is stubbed, and it
// never resolves, so a page behind a click stays in its loading state.
vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
  getAuthConfig: vi.fn(async () => ({ send_pin_enabled: true })),
  bootstrapSession: vi.fn(async () => {}),
  requestPin: vi.fn(async () => {}),
  verifyPin: vi.fn(async () => ({})),
}));

const originalFetch = globalThis.fetch;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
const STUDENT = {
  id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
  has_course_admin: false, has_run_teacher: false,
};

function go(path: string) {
  history.replaceState(null, '', path);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}

beforeEach(() => {
  __resetGuardsForTests();
  globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  target = document.createElement('div');
  document.body.appendChild(target);
  session.loading = false;
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  globalThis.fetch = originalFetch;
  session.user = null;
});

describe('App: an unknown address (Polish 2 D53)', () => {
  it('signed in: NotFound under the header', async () => {
    session.user = STUDENT;
    go('/no/such/page');
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('.app-header')).not.toBeNull();
    expect(target.querySelector('.error-state h1.title')!.textContent).toBe('Page not found');
    expect(location.pathname).toBe('/no/such/page');
  });

  it('signed out: NotFound with "Sign in", no header, no redirect', async () => {
    session.user = null;
    go('/no/such/page');
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('.app-header')).toBeNull();
    expect(target.querySelector('.error-state .action button')!.textContent!.trim()).toBe('Sign in');
    expect(location.pathname).toBe('/no/such/page');
  });

  it('an unmatched /superuser/... path: NotFound without the header, and the button still works', async () => {
    session.user = STUDENT;
    go('/superuser/abc/def');
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('.app-header')).toBeNull();
    const btn = target.querySelector<HTMLButtonElement>('.error-state .action button')!;
    expect(btn.textContent!.trim()).toBe('Back to courses');
    btn.click();
    await settle();
    expect(location.pathname).toBe('/courses');
  });
});
```

Run it the same way. Expected: FAIL in all three (no `.error-state` on the 404). If a test fails for another reason (a header or route that differs from what is stated here), read `App.svelte:61-75` and the routes again before changing anything: that is a finding about the test, ledgered.

- [ ] **Step 3: The page**

Replace the script and markup of `frontend/src/pages/NotFound.svelte` (the `<style>` block stays as it is):

```svelte
<script lang="ts">
  import { session } from '../stores/session.svelte';
  import { defaultLandingPath, navigate } from '../lib/router.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';
  import Button from '../components/ui/Button.svelte';

  // D53: one button that names the person's start page. Signed out it is
  // "Sign in": defaultLandingPath(null) returns /courses, so that case is
  // decided here. A Button, as on the other page ErrorStates (no cmd-click).
  const target = $derived(session.user === null ? '/login' : defaultLandingPath(session.user));
  const label = $derived(
    session.user === null ? 'Sign in' : target === '/teaching' ? 'Back to teaching' : 'Back to courses',
  );
</script>

<div class="page">
  <ErrorState variant="page" title="Page not found" message="The address may be mistyped, or the page has moved.">
    {#snippet action()}
      <Button variant="secondary" onclick={() => navigate(target)}>{label}</Button>
    {/snippet}
  </ErrorState>
</div>
```

Run both test files. Expected: PASS (5 + 3).

- [ ] **Step 4: Full checks**

Expected: vitest green; svelte-check 0 errors, 13 warnings; gate `ALL PASS (2280 checks)` (the page column check still finds NotFound's `.page` rule).

- [ ] **Step 5: The backlog**

Append `## Task 5 — the 404 page` to `docs/backlog/polish2-named-items-debt.md`. Add to the file's end a section `## For the beta VoiceOver pass` with two bullets: the 404 announces itself on load (ErrorState's `role="alert"`); nothing announces that an authored link opens a new tab (a visually hidden "(opens in a new tab)" from `externalLinks` is the candidate).

- [ ] **Step 6: Screenshots, the user's OK, review lanes, commit**

Screenshots at 1280 wide: `/courses/x/y/z` signed in as `dev@mathion.test` (course admin: "Back to courses"), as `teacher@mathion.test` ("Back to teaching"), and signed out ("Sign in", no header). Signing in and out writes only session rows, as every earlier pass did. Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/pages/NotFound.svelte \
  frontend/src/tests/NotFound.svelte.test.ts frontend/src/tests/App.notFound.svelte.test.ts \
  docs/backlog/polish2-named-items-debt.md
git commit -m "$(cat <<'EOF'
feat(polish2): a styled 404 page whose button names the start page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Bare URLs become links (D54, D55; backend)

**Files:**
- Modify: `backend/pyproject.toml:14` (the dependency)
- Modify: `backend/mathion/markdown.py:7-8` (the renderer)
- Test: `backend/tests/test_markdown.py` (append), `backend/tests/test_items.py` (append)
- Delete: `docs/backlog/bare-urls-not-autolinked-in-markdown.md`, `docs/backlog/stored-content-html-not-rerendered-after-renderer-change.md`
- Modify: `docs/backlog/polish2-named-items-debt.md` (`## Task 6` heading)

**Interfaces:**
- Consumes: nothing from the frontend tasks. The frontend treats a linkified URL like an authored `[text](url)`: Tasks 3 and 4's `externalLinks` opens it in a new tab.
- Produces: `render_markdown(text)` (unchanged signature) now emits `<a href="…" rel="noopener noreferrer">…</a>` for a bare `http://` or `https://` URL. Stored HTML changes only on the next save, publish or clone (D55); there is no migration.

The Dockerfile (`:23-25`) and CI (`ci.yml:36`) install from `pyproject.toml`, so neither needs an edit.

- [ ] **Step 1: The dependency, first**

Without `linkify-it-py`, `_md.linkify` is `None` and the Step 4 renderer raises at import, which would break every backend test and the running dev server (uvicorn `--reload` picks up the edit). So the package goes in before any code uses it.

`backend/pyproject.toml:14`: `"markdown-it-py>=3.0",` becomes

```toml
    "markdown-it-py[linkify]>=3.0",
    # The [linkify] extra alone allows linkify-it-py>=1; 2.0 is the floor that
    # has match_at_start, which markdown-it's inline linkify rule uses.
    "linkify-it-py>=2.0",
```

Install into the project venv (from the repo root; the backend is an editable install):

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && backend/.venv/bin/pip install -e './backend[dev]' > $SDD/tmp/pip-t6.log 2>&1; tail -3 $SDD/tmp/pip-t6.log; backend/.venv/bin/python -c "import linkify_it, importlib.metadata as m; print(m.version('linkify-it-py'))"
```

Expected: `Successfully installed … linkify-it-py-2.…` (or "already satisfied"), then a version `2.x`. The probe used 2.2.0. If pip needs the network and the sandbox refuses it, stop and ask the user: this is the one outward step of the slice.

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_markdown.py`:

```python
import pytest


# D54: only text that starts with http:// or https:// becomes a link.
@pytest.mark.parametrize("md, href", [
    ("Read https://example.org/path?q=1 first.", "https://example.org/path?q=1"),
    ("Plain http://example.org here.", "http://example.org"),
    ("A paren URL https://en.wikipedia.org/wiki/Function_(mathematics) works.",
     "https://en.wikipedia.org/wiki/Function_(mathematics)"),
    ("(see https://en.wikipedia.org/wiki/Function_(mathematics))",
     "https://en.wikipedia.org/wiki/Function_(mathematics)"),
    ("see https://x.org.", "https://x.org"),
    ("Mail <a@b.org> on purpose.", "mailto:a@b.org"),
])
def test_render_bare_url_becomes_one_link(md, href):
    result = render_markdown(md)
    assert f'href="{href}"' in result
    assert result.count("<a ") == 1
    assert 'rel="noopener noreferrer"' in result


def test_render_bare_url_keeps_trailing_punctuation_outside_the_link():
    result = render_markdown("see https://x.org.")
    assert 'href="https://x.org."' not in result
    assert "</a>." in result


def test_render_bare_url_in_parentheses_keeps_the_closing_paren_outside():
    result = render_markdown("(see https://en.wikipedia.org/wiki/Function_(mathematics))")
    assert "</a>)" in result


def test_render_bare_url_uppercase_scheme_is_linked():
    # The renderer keeps the scheme's case; the frontend's URL parser lowercases it (D58).
    assert "<a " in render_markdown("HTTPS://X.ORG/A")


@pytest.mark.parametrize("md", [
    "`https://example.org` in code",
    "```\nhttps://example.org\n```",
    "    https://example.org indented code",
    "Math $x = https://example.org$ inline.",
    "$$\nhttps://example.org\n$$",
    "Escaped http\\://example.com/ stays text.",
    "Visit www.example.org today.",
    "Visit example.org today.",
    "Run numpy.py now.",
    "Write to a@b.org please.",
    "Write to mailto:a@b.org please.",
    "Get ftp://files.example.org/x here.",
    "Load //cdn.example.org/x here.",
])
def test_render_text_that_is_not_a_full_url_stays_plain(md):
    assert "<a" not in render_markdown(md)


@pytest.mark.parametrize("md", [
    "[text](https://example.org)",
    "<https://example.org>",
])
def test_render_existing_link_stays_one_link(md):
    assert render_markdown(md).count("<a ") == 1
```

Append to `backend/tests/test_items.py`:

```python
def test_api_static_page_bare_url_is_stored_as_a_link(admin_client):
    """D54/D55: a pasted https:// address becomes a link when the content is saved."""
    seq, version = _setup_sequence(admin_client)
    response = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Links", "type": "static_page", "content_md": "Read https://example.org/notes first.",
    })
    assert response.status_code == 201
    assert 'href="https://example.org/notes"' in response.json()["content_html"]
```

Run:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_markdown.py tests/test_items.py > $SDD/tmp/pytest-t6.log 2>&1; tail -25 $SDD/tmp/pytest-t6.log
```

Expected: FAIL in exactly the linked cases: the six `test_render_bare_url_becomes_one_link` cases except `<a@b.org>` (a CommonMark autolink, already a link), the trailing-punctuation and closing-paren tests, the uppercase test, and the API test. Every "stays plain" and "stays one link" case passes already (that is the point of them: they pin what must not change).

- [ ] **Step 3: The renderer**

`backend/mathion/markdown.py`: replace

```python
_md = MarkdownIt("commonmark", {"html": False})
dollarmath_plugin(_md)
```

with

```python
_md = MarkdownIt("commonmark", {"html": False, "linkify": True}).enable("linkify")
# D54: only http:// and https:// become links. fuzzy_link off keeps www. and
# bare domains plain; the add() line disables linkify-it's other schemas, or
# ftp: would come out as an <a> without href (nh3 drops the scheme) and //host
# as a live protocol-relative link. An authored [text](mailto:…) or <a@b.org>
# is a markdown link, not linkify, and still works.
_md.linkify.set({"fuzzy_link": False, "fuzzy_email": False, "fuzzy_ip": False})
_md.linkify.add("ftp:", None).add("//", None).add("mailto:", None)
dollarmath_plugin(_md)
```

Run the Step 2 command. Expected: PASS, every case.

- [ ] **Step 4: The whole backend suite, and the dev server**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest-t6-all.log 2>&1; tail -5 $SDD/tmp/pytest-t6-all.log
```

Expected: all pass (the count rises by the new cases). Then the running dev backend: its log (`.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/backend.log`) shows a reload after the `markdown.py` edit and no traceback in its last lines. Do not restart it.

Frontend checks too (nothing there changed): vitest green, svelte-check 0 errors and 13 warnings, gate `ALL PASS (2280 checks)`.

- [ ] **Step 5: The backlog**

1. Delete `docs/backlog/bare-urls-not-autolinked-in-markdown.md` and `docs/backlog/stored-content-html-not-rerendered-after-renderer-change.md` (`git rm`). The second one's point lives on in D55: stored HTML picks up a renderer change on the next save, publish or clone.
2. Append `## Task 6 — bare URLs` to `docs/backlog/polish2-named-items-debt.md`.

- [ ] **Step 6: A look check, the user's OK, review lanes, commit**

No dev data is written: in the item editor, type into a page body (not saved) `Read https://example.org/notes, not www.example.org or \`https://example.org/code\`.` and open the Preview tab, which renders through the backend. Screenshot it: the first address is an underlined link that opens in a new tab (`agent-browser eval "document.querySelector('.preview a')?.target"` prints `_blank`); `www.example.org` and the code stay plain. Leave the editor with Discard.

Then the per-task loop: the user's OK, both lanes until clean, commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add backend/pyproject.toml backend/mathion/markdown.py \
  backend/tests/test_markdown.py backend/tests/test_items.py docs/backlog/polish2-named-items-debt.md
git rm -q docs/backlog/bare-urls-not-autolinked-in-markdown.md docs/backlog/stored-content-html-not-rerendered-after-renderer-change.md
git commit -m "$(cat <<'EOF'
feat(polish2): bare http(s) URLs in authored markdown become links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
