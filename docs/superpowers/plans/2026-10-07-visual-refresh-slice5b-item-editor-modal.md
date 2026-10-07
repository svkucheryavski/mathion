# Visual Refresh — Slice 5b: Authoring — Item Editor Modal (3c + 3e + 3f) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening an item no longer leaves the version editor. A 920px modal opens over it, with plain fields and one footer Save/Discard. The modal serves page (3c), video (3e), quiz (3f) and interactive app items, and is built on a new generic `ui/Modal` frame that Slice 6 reuses.

**Architecture:**
- `VersionEditPage` serves the item URL too (`itemId?` prop). It hosts `ItemEditorModal` behind `{#if expandedItem}{#key expandedItem.id}`, so no page swap ever shares the editor store. That swap was the Back-freeze.
- The modal owns the Title field, the footer, the ⌘S shortcut and the one page-registered dirty tracker.
- Each item type is a **body** (`PageBody`, `VideoBody`, `AppBody`, `QuizEditor`). Every body implements one contract: `save(titleDraft) → {outcome, savedTitle?}`, `discard`, `discardAll`, `validate`, plus bindable `saveDirty` / `guardDirty` / `busy` and a `frozen` prop.
- The quiz body runs one Save across N PATCHes through per-question **contributors** registered on a `QUIZ_SAVE_KEY` context.
- No backend, API or schema change.

**Tech Stack:** Svelte 5.55 runes + TypeScript, Vite, vitest + jsdom (`mount`/`unmount`/`flushSync` from `svelte`), and the zsh gate `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-visual-refresh-slice5b-item-editor-modal-design.md` (rev 7, commit `bec1628`, user-approved 2026-10-07). Read it alongside this plan. § and D-numbers below refer to it, and where the two disagree the spec wins.

**Branch:** `feat/visual-refresh-slice5-authoring`, continuing from the spec commit `bec1628` (5a tip `736bbd4`). It stays LOCAL: never push, never merge.

## How this plan was made (and how to read it)

- **Not pre-executed.** Unlike the 5a plan, this plan was **not** run in a scratch copy first. Every code block was written against the real source, read at commit `bec1628`, and is meant to be applied as given. The per-task two-lane review loop is the safeguard.
- **When a step's output differs from its `Expected:` line:**
  - if the plan is wrong, make the smallest change that satisfies the spec and ledger it as a `Ruling:`;
  - if the code is wrong, debug it systematically. Never patch a test to fit.
- **Gate pins.** Most pins quote the **minified** CSS that esbuild emits. Measured on this branch, esbuild:
  - rewrites `inset:0` as `top:0;right:0;bottom:0;left:0`;
  - rewrites `rgba(…)` as 8-digit hex, e.g. `rgba(20,24,35,.22)` → `#14182338`.

  Before writing a task's gate section, run the build and read the emitted rule: `grep -o '\.modal-panel\.svelte-[a-z0-9]*{[^}]*}' dist/_app/*.css`. If a spelling differs from the plan, pin the **emitted** spelling and ledger it.
- **Code forms.** Each code block is either a **full file** (new files and rewrites) or a **replace block**: the exact old text, then the new text. Apply tasks in the order they appear. That order is the execution order (Ruling R1).
- **Reading for design review only.** The **task summaries** (the paragraph under each task heading), the **Plan rulings** and the **Review Focus** list cover the design without the code.

## Global Constraints

Every task's requirements implicitly include these. Values are verbatim from spec §Global Constraints.

1. **Colours → existing tokens only.** No new colour tokens. Delete every hex literal in the touched files.
2. **No opacity-based dimming.**
3. **No emoji or decorative glyphs.** SVGs are `aria-hidden`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, stroke width 1.6 (1.9 for the check), round caps and joins.
4. **Mono for every numeral**, via the global `.mono` class.
5. **Per-component literals in one of three forms:**
   - (a) `/* ref NNNN */`;
   - (b) no ref, with the scale named;
   - (c) the mechanism.
   
   Literals are geometry only.
6. **Dense control metrics are final:** `ui/Button.svelte` is used as-is.
7. **`ItemMark` is used as-is.**
8. **No backend, API or schema change.**
9. **Commits** carry the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and **no `Claude-Session` line**. `git add` exact named paths only.
10. **Process per task:**
    - an Opus reviewer plus a second lane review the **uncommitted** diff;
    - fix every Critical/Important, then re-review **both lanes after every fix**;
    - commit only when both lanes are clean;
    - the user's explicit OK closes the task.
11. **Literal colours.** Exactly two literal colours exist in 5b-touched files, and only in `ui/Modal.svelte`:
    - `0 16px 44px rgba(20,24,35,.22)`, annotated `/* ref 1684 */`;
    - `color-mix(in srgb, var(--text) 34%, transparent)`, annotated `/* ref 1682 */`.

    No other 5b-touched CSS context may hold a hex, `rgb(`/`rgba(`/`hsl(`/`hsla(`, a named colour, or a `var()` fallback of one. That includes box-shadows. `transparent`, `currentColor`, `inherit`, system colours inside `@media (forced-colors: active)` and comments are exempt. `Modal.svelte` may duplicate `backdrop-filter` as `-webkit-backdrop-filter`.
12. **Gate discipline as in 5a.** Every new section:
    - is hash-anchored (`own` + `uniq1`);
    - has positive pins with paired negatives;
    - has a `sweep`, a "no rem font sizes" check and an emoji source scan.

    `EXPECTED_CHECKS` is bumped to the exact printed count.
13. **Stay in the project directory.** Scratch files, gate temp files and reviewer probes all go in `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/`. Run the gate with `TMPDIR` pointing there (see Conventions). Never `cd ..`; use absolute `cd /Users/svkucheryavski/Documents/Developing/mathion/...` only. Tell every subagent the same.
14. **Every commit is green:** full suite, `npm run check` (0 errors, warnings ≤ 18), and the gate ALL PASS. No task leaves an item type broken for a later task.

## Review Focus

These are the five failure modes most likely to bite a real author. Each is pinned by a test in the owning task.

1. **Closing never leaves the app** (D7). This covers a double ×, Escape-then-×, Escape auto-repeat, and a prompt cancelled and then retried, both on an in-page open and on a deep link. `history.back()` runs at most once, and a deep-link close replaces the URL with the sequence. → T3b: "in-page open, × twice → one history.back()", "Escape repeat is ignored", "cancelled prompt re-arms ×", "deep link × replaces".
2. **One Save across N PATCHes** (D10, §5.3).
   - The order is title, then questions in display order, then options with true before false.
   - Validation is dirty-scoped.
   - A partial failure keeps the earlier parts saved and the later parts dirty, and reloads the tree.
   - Normalised echoes (`"2.50"` → `"2.5"`, a trimmed text answer, the embed URL) come back clean.
   
   → T5a: "save order", "partial failure stops", "normalised echoes come back clean"; T3c: "a pasted watch URL saves clean".
3. **Structure operations with live drafts** (§5.4, D24). After reorder, delete, add or an option refetch, every draft stays on its own question or option. Deleting an option while correct-marks are drafted confirms first and resets only the marks. → T5b: "reorder keeps drafts", "refetch keeps surviving drafts", "D24 confirm resets marks only".
4. **Disabled version: zero `/render` and zero asset fetches** anywhere in the modal (D6): page body, quiz question editors and app preview. → T3a: "disabled page and quiz make no render call"; T4: "disabled app fetches nothing".
5. **Focus across open and close** (D18).
   - Open lands on Title (× when read-only), never on trash.
   - Close restores to the opener; when focus is on `body`, it goes to the closed item's pencil, then to the sequence header.
   - A plain tree reload never moves focus.
   
   → T3a: "autofocus"; T3b: "restore beats fallback", "reload does not move focus", "create-item close lands on the pencil".

## Plan rulings (decisions this plan makes beyond the spec)

Each ruling states what it costs if wrong.

- **R1 — Task order T3a → T3c → T3b.** The spec lists T3b (routing) before T3c (VideoBody). Once T3b routes items into the modal, a video item without a body would be broken, which violates Constraint 14. So `VideoBody` lands first. Cost if wrong: none; the deliverables are unchanged.
- **R2 — Asset "in use" reason is kind-aware.** The backend's `is_referenced` counts references across the whole version (`backend/mathion/api/assets.py:128`) or the whole run, not one item, so ref 1726's "referenced by this item" would be false. The disabled trash says:
  - "Remove asset — still referenced in this version" (course);
  - "Remove asset — referenced by a mini-project" (run).
  
  Cost: a wording change.
- **R3 — The frames zero their own margin.** `VideoFrame` and `InteractiveFrame` zero their own `margin-bottom` when given `height`, so the editor bodies need no `:global(.frame)`. The gate's reviewed `:global` allow-list (section b3) then gains only `Modal.svelte`'s `.modal-body > :global(*)`. Cost: none.
- **R4 — `QuizContributor.lastError` and `title()`.** The contributor exposes a read-only `lastError: string | null`, so `QuizEditor` can name what failed in the partial-failure toast. It also exposes `title()` (the header snippet, or `Question n`), which the T5b delete-question confirm quotes. Cost: two extra members.
- **R5 — No app preview card on a disabled version.** The modal's D6 note under the Title row is the note; a second copy inside the card would repeat it. Cost: none.
- **R6 — Shared types in `lib/`.**
  - `lib/itemBody.ts` holds the body contract types;
  - `lib/quizSave.ts` holds `QUIZ_SAVE_KEY`, `QUIZ_GUARD_KEY` and the contributor type.
- **R7 — Inline asset-delete focus.** Opening AssetSidebar's inline delete confirm focuses **Cancel**, so Escape reaches it. Cancel or Escape returns focus to that row's trash. Cost: none.
- **R8 — Modal gate anchor.** `.modal-backdrop` is already authored by three run modals, so the gate anchors Modal on `.modal-panel`.
- **R9 — Focus order on a failed validation.** The body validates first and focuses its first invalid field synchronously; then the modal validates Title. If Title is invalid it takes focus, because it is first on screen.
- **R10 — `MarkdownEditor.ariaLabel`.** Today's editors sit inside a `<label>`; the modal's bodies do not. A new optional `ariaLabel` prop (T2) names the textarea: "Content" for a page, "Question text" / "Explanation" in the quiz (T6). Cost: one prop.
- **R11 — `ItemEditorModal` takes no `courseSlug`, `block` or `seq`.** The spec lists them, but nothing in the modal reads them (`seqIndex` carries the "S1" label), and `noUnusedLocals` would fail `npm run check`. Cost: none.
- **R12 — The reorder titles are 5a's wording** (T6). They read `Move up — already first` / `Move down — already last`, as in `ItemRow.svelte:48-49`, rather than the spec's bare "Already first" / "Already last". One phrasing across the editor. Cost: none.
- **R13 — The quiz header keeps `correct-count`** (T6). It shows the draft count (D25) as mono 11.5px `--muted` before the type name. 3f doesn't draw it, but it is a working signal and tests pin it. Cost: one span.
- **R14 — The C2 delete title** (T6). When C2 blocks an option delete, its trash is titled `Can't delete the only correct option — mark another one correct and save first`. D24 says "the existing reason", but the old row had no title. Cost: one string.
- **R15 — What the quiz Save's `'partial'` outcome counts** (T5a). It counts only the title or an earlier question that saved completely. If a question saved some fields and then failed, the outcome is `'failed'` when nothing before it landed. The admin tree holds no question content, so no tree reload is owed for that progress, and the question itself keeps the advanced baselines. Cost if wrong: one skipped tree reload.
- **R16 — The text-side option lock goes in T5a; the two-way structure lock goes in T5b.** Drafts are local from T5a on, so typing during an option mutation is harmless. Structure under live drafts needs T5b's reasoning (D24, guard trackers), so the `dirty` term in `structureDisabled` / `optionsDisabled` stays one task longer. Cost: none; every commit is green.

## Conventions

- **Directories.** `npm`, `npx` and `zsh scripts/…` run in `frontend/`; `git` runs at the repo root.
- **Workspace (Constraint 13):** `W=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal`. Once per session run `mkdir -p $W/tmp`.
- **Baselines** (tip `bec1628`, measured):
  - `npm test`: 134 files / 1582 tests passed;
  - `npm run check`: 0 errors, 18 warnings;
  - gate: `EXPECTED_CHECKS=945`.
- **Test pattern.**
  - `mount` / `unmount` / `flushSync` from `svelte`, never `@testing-library/svelte`.
  - Reactive props are a `$state({...})` object, so the file is `*.svelte.test.ts`.
  - Delegated events (`click`, `input`, `change`, `keydown`) need `bubbles: true`.
- **Running tests.**
  - Whole suite: `npm test`.
  - One file: `TZ=Europe/Copenhagen npx vitest run src/tests/<file>`. Bare `npx vitest` fails `datetime.test.ts` on purpose.
- **Type check.** `npm run check` must give 0 errors and **≤ 18 warnings**.
- **Gate.** `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh`. The last line must read `VISUAL-REFRESH GATE: ALL PASS (N checks)`.
  - The gate grades the **built** bundle, so a component that nothing imports emits no CSS.
  - 5a helpers: `own ANCHOR FILE`, `uniq1 ANCHOR` (→ `REPLY`), `sweep LABEL HASH`, `d SEL SUF DECL…`, `chk EMITTED-SEL DECL…`, `check`/`none`.
- **Review loop ("Review" step of every task).**
  - Run both lanes on the **uncommitted** diff (`git status`, `git diff`, plus the new files):
    - an Opus reviewer at high effort;
    - codex at `model_reasoning_effort=high`, or Fable when codex is unavailable.
  - Give each reviewer the spec, this task's section, the Plan rulings and the Review Focus.
  - Fix every Critical/Important, then re-run **both** lanes. Repeat until both are clean.
  - Minor findings go to `docs/backlog/slice5b-authoring-polish-debt.md`, created by the first task that has one.
  - Wait for the user's explicit OK.
- **Commit.** `git add` exactly the task's **Files** paths, then `git commit` with the given message and the trailer.

## File structure

| file | status | task(s) | responsibility |
|---|---|---|---|
| `frontend/src/components/ui/Modal.svelte` | new | T1 | generic frame: backdrop, panel, head (+×), body, foot; Escape, focus containment, scroll lock, `closeDisabled`, `bodyInert` |
| `frontend/src/tests/support/ModalHarness.svelte` | new | T1 | snippet harness for Modal tests |
| `frontend/src/components/editor/MarkdownEditor.svelte` | modify | T2 | 3c restyle; `plain` (D6) and `frozen` (D10) props |
| `frontend/src/components/editor/AssetSidebar.svelte` | modify | T2 | 3c restyle, D11 hint, IconButton delete, Escape = Cancel |
| `frontend/src/lib/itemBody.ts` | new | T3a | `SaveOutcome`, `ItemBodyApi` |
| `frontend/src/components/editor/ItemEditorModal.svelte` | new | T3a, T3c, T4, T5a | header, Title row, D6 note, footer, Save/Discard/⌘S, registry tracker, delete freeze |
| `frontend/src/components/editor/item/PageBody.svelte` | new | T3a | page body (content_md) |
| `frontend/src/components/editor/item/VideoBody.svelte` | new | T3c, T4 | video URL field, validation, normalise-on-save (T3c); preview card (T4) |
| `frontend/src/components/editor/item/AppBody.svelte` | new | T4 | app script row + preview card; replaces `components/items/InteractiveAppEditor.svelte` |
| `frontend/src/components/items/InteractiveAppEditor.svelte` | modify, delete | T3a, T4 | interim `showTitle` + bindable `uploadBusy` (T3a); deleted (T4) |
| `frontend/src/components/items/VideoFrame.svelte`, `InteractiveFrame.svelte` | modify | T4 | optional `height` prop |
| `frontend/src/pages/editor/VersionEditPage.svelte` | modify | T3a, T3b | interim dead branch (T3a); host: `itemId`, D7/D9/D18/D19 (T3b) |
| `frontend/src/lib/deriveExpansion.ts`, `handleStaleIdFallback.ts` | modify | T3b | item level |
| `frontend/src/components/editor/ItemRow.svelte` | modify | T3b | `id="item-{id}-open"` on the Open pencil |
| `frontend/src/routes.ts`, `frontend/src/App.svelte` | modify | T3b | item route → `VersionEditPage`; drop `ItemEditPage` |
| `frontend/src/pages/editor/ItemEditPage.svelte` | delete | T3b | — |
| `frontend/src/stores/currentEditorVersion.svelte.ts` | modify | T3b | D22 contract comment |
| `frontend/src/lib/quizSave.ts` | new | T5a, T7 | `QUIZ_SAVE_KEY`, `QUIZ_GUARD_KEY`, `QuizContributor` (T5a); one comment (T7) |
| `frontend/src/components/editor/QuizEditor.svelte` | modify | T3a, T5a, T5b, T6 | interim props (T3a); body contract + Save (T5a); structure with drafts (T5b); 3f look (T6) |
| `frontend/src/components/editor/QuestionAccordion.svelte` | modify | T3a, T5a, T5b, T6 | `versionDisabled` (T3a); drafts + contributor (T5a); structure (T5b); 3f look (T6) |
| `frontend/src/components/editor/OptionRow.svelte` | rewrite | T5a, T6 | draft text + draft mark (T5a); 3f look (T6) |
| `frontend/src/components/editor/QuestionTypePicker.svelte` | rewrite | T6 | 3f type cards |
| `frontend/scripts/visual-refresh-gate.sh` | modify | T1–T7 | `:global` allow-list (T1); sections (aa)–(ag); `.notice` target; `EXPECTED_CHECKS` |
| `frontend/src/tests/*` | see tasks | all | new, ported and updated tests |
| `docs/backlog/slice5a-authoring-polish-debt.md` | modify | T7 | close the two 5b carry-overs |
| `frontend/src/pages/MiniProjectDetailPage.svelte`, `frontend/src/tests/AssetSidebar.svelte.test.ts`, `frontend/src/tests/dirtyRegistry.test.ts` | modify | T7 | stale `ItemEditPage` comments only |
| `frontend/src/tests/support/QuestionAccordionHarness.svelte` | rewrite | T5a, T5b | private registry + `QUIZ_SAVE_KEY` hub (T5a); `QUIZ_GUARD_KEY` guards (T5b) |

Not modified: `lib/dirty.svelte.ts`. Option drafts are a `$state` record keyed by option id inside `QuestionAccordion`, not trackers.

---

## Task 1: `ui/Modal.svelte` — the generic modal frame

**What this task builds.**
- **DOM:** a fixed, blurred backdrop above the app header, holding a centred 920px panel: a header with ×, a scrolling body, and an optional footer.
- **Closing:**
  - × and Escape call `onRequestClose`. Escape is ignored while composing, on Safari's `keyCode 229`, on auto-repeat, after an inner `preventDefault`, and while `closeDisabled`.
  - A backdrop click does nothing by default; `closeOnBackdrop` is for Slice 6. A backdrop `mousedown` is default-prevented, so focus never leaves the panel.
- **Focus:**
  - It opens on `[data-autofocus]`, falling back to ×, never the header trash (D18).
  - A document `focusin` listener pulls escaped focus back inside. The panel itself (`tabindex="-1"`) is the last resort.
- **Other behaviour:** the page behind doesn't scroll while open. `bodyInert` makes the body inert during an item delete (D9).
- **Gate:** none yet, because nothing imports Modal until T3a. The gate's reviewed `:global` allow-list gains Modal's one rule now, since that check reads source.

**Files:**
- Create: `frontend/src/components/ui/Modal.svelte`, `frontend/src/tests/support/ModalHarness.svelte`, `frontend/src/tests/Modal.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (the `GLOBAL_ALLOW` set, around `:449-453`)

**Interfaces:**
- Consumes: `FocusTrap` (`autofocusSelector`, `autofocusPriorityOrder`, `children`); `IconButton` (`id`, `glyph="close"`, `size="md"`, `title`, `aria-label`, `disabled`, `onclick`).
- Produces:
  - `Modal` props: `label?: string; labelledby?: string; width?: number (920); maxHeight?: number (600); onRequestClose: () => void; closeOnBackdrop?: boolean (false); autofocusSelector?: string ("[data-autofocus], #<closeId>"); autofocusPriorityOrder?: boolean (true); closeDisabled?: boolean (false); bodyInert?: boolean (false); header: Snippet; children: Snippet; footer?: Snippet`.
  - DOM hooks:
    - `div.modal-backdrop`;
    - `section.modal-panel[role=dialog][aria-modal=true][tabindex=-1]`;
    - `header.modal-head` (ends with `button[aria-label="Close"]`);
    - `div.modal-body` (with `inert` when `bodyInert`);
    - `footer.modal-foot`.

- [ ] **Step 1: Write the harness and the failing tests**

File `frontend/src/tests/support/ModalHarness.svelte` (full content):

```svelte
<script lang="ts">
  // Snippet harness for Modal.svelte.test.ts: a header button (stands in for
  // the item modal's trash), two body inputs and an optional footer button.
  import Modal from '../../components/ui/Modal.svelte';
  let {
    onRequestClose,
    closeOnBackdrop = false,
    closeDisabled = false,
    bodyInert = false,
    withFooter = true,
    autofocusTitle = true,
    headDisabled = false,
  }: {
    onRequestClose: () => void;
    closeOnBackdrop?: boolean;
    closeDisabled?: boolean;
    bodyInert?: boolean;
    withFooter?: boolean;
    autofocusTitle?: boolean;
    headDisabled?: boolean;
  } = $props();
</script>

{#snippet head()}
  <h2 id="mh-title">Edit thing</h2>
  <button type="button" data-testid="head-trash" disabled={headDisabled}>Trash</button>
{/snippet}
{#snippet foot()}
  <button type="button" data-testid="save">Save</button>
{/snippet}

<button type="button" data-testid="outside">Outside</button>
<Modal
  labelledby="mh-title"
  {onRequestClose}
  {closeOnBackdrop}
  {closeDisabled}
  {bodyInert}
  header={head}
  footer={withFooter ? foot : undefined}
>
  <input data-testid="title" data-autofocus={autofocusTitle ? '' : undefined} />
  <input data-testid="last" />
</Modal>
```

File `frontend/src/tests/Modal.svelte.test.ts` (full content):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './support/ModalHarness.svelte';

let target: HTMLDivElement | null = null;
let cmp: ReturnType<typeof mount> | null = null;

async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); }
function render(over: Record<string, unknown> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ onRequestClose: vi.fn(), ...over });
  cmp = mount(Harness, { target, props });
  flushSync();
  return props as { onRequestClose: ReturnType<typeof vi.fn> } & Record<string, unknown>;
}
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  target?.remove(); target = null;
  document.documentElement.style.overflow = '';
});

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const backdrop = () => document.querySelector<HTMLElement>('div.modal-backdrop')!;
const closeBtn = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
function esc(init: KeyboardEventInit = {}, on: EventTarget = window) {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  on.dispatchEvent(ev);
  return ev;
}

describe('Modal — identity', () => {
  it('is a labelled modal dialog with a focusable panel', () => {
    render();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(panel().getAttribute('aria-labelledby')).toBe('mh-title');
    expect(panel().getAttribute('tabindex')).toBe('-1');
  });

  it('renders the footer only when a footer snippet is given', () => {
    render({ withFooter: false });
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    unmount(cmp!); cmp = null; target!.remove();
    render();
    expect(panel().querySelector('footer.modal-foot [data-testid="save"]')).not.toBeNull();
  });
});

describe('Modal — closing', () => {
  it('× calls onRequestClose', () => {
    const p = render();
    closeBtn().click();
    expect(p.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onRequestClose and is default-prevented', () => {
    const p = render();
    const ev = esc();
    expect(p.onRequestClose).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Escape is ignored while composing, on keyCode 229, on repeat and after an inner preventDefault', () => {
    const p = render();
    esc({ isComposing: true });
    const ime = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    Object.defineProperty(ime, 'keyCode', { value: 229 });
    window.dispatchEvent(ime);
    esc({ repeat: true });
    const input = byId('title');
    input.addEventListener('keydown', (e) => e.preventDefault());
    esc({}, input);
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('closeDisabled disables × and ignores Escape', () => {
    const p = render({ closeDisabled: true });
    expect(closeBtn().disabled).toBe(true);
    esc();
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('a backdrop click does nothing by default', () => {
    const p = render();
    backdrop().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('closeOnBackdrop closes on a backdrop click, never on a click inside the panel', () => {
    const p = render({ closeOnBackdrop: true });
    panel().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    byId('title').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).not.toHaveBeenCalled();
    backdrop().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('a backdrop mousedown is default-prevented; a panel mousedown is not', () => {
    render();
    const onBackdrop = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    backdrop().dispatchEvent(onBackdrop);
    expect(onBackdrop.defaultPrevented).toBe(true);
    const onPanel = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    byId('title').dispatchEvent(onPanel);
    expect(onPanel.defaultPrevented).toBe(false);
  });
});

describe('Modal — focus', () => {
  it('autofocus lands on [data-autofocus], never on the header button', async () => {
    render();
    await settle();
    expect(document.activeElement).toBe(byId('title'));
  });

  it('autofocus falls back to × when nothing is marked', async () => {
    render({ autofocusTitle: false });
    await settle();
    expect(document.activeElement).toBe(closeBtn());
  });

  it('focus that lands outside the panel is moved back to the first focusable', async () => {
    render();
    await settle();
    byId('outside').focus();
    expect(document.activeElement).toBe(byId('head-trash'));
  });

  it('focus that leaves from the first focusable goes to the last one', async () => {
    render();
    await settle();
    const first = byId('head-trash');
    byId('outside').dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: first }));
    expect(document.activeElement).toBe(byId('save'));
  });

  it('when nothing inside can take focus, the panel itself takes it', async () => {
    render({ bodyInert: true, closeDisabled: true, headDisabled: true, withFooter: false });
    await settle();
    byId('outside').focus();
    expect(document.activeElement).toBe(panel());
  });

  it('bodyInert puts inert on the body only', () => {
    render({ bodyInert: true });
    expect(panel().querySelector('.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(panel().hasAttribute('inert')).toBe(false);
    expect(panel().querySelector('.modal-head')!.hasAttribute('inert')).toBe(false);
  });
});

describe('Modal — scroll lock', () => {
  it('locks <html> overflow while open and restores the previous value on close', () => {
    document.documentElement.style.overflow = 'scroll';
    render();
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount(cmp!); cmp = null;
    expect(document.documentElement.style.overflow).toBe('scroll');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/Modal.svelte.test.ts`
Expected: FAIL. The suite cannot resolve `../../components/ui/Modal.svelte`.

- [ ] **Step 3: Write `Modal.svelte`**

File `frontend/src/components/ui/Modal.svelte` (full content):

```svelte
<script lang="ts">
  // Generic modal frame (Slice-5b spec §1). It knows nothing about items: the
  // parent supplies header/body/footer snippets and decides what closing
  // means — Modal holds no dirty state. Slice 6 adopts it for the run modals.
  import { onMount, type Snippet } from 'svelte';
  import FocusTrap from './FocusTrap.svelte';
  import IconButton from './IconButton.svelte';

  type Props = {
    label?: string;
    labelledby?: string;
    width?: number;
    maxHeight?: number;
    onRequestClose: () => void;
    closeOnBackdrop?: boolean;
    autofocusSelector?: string;
    autofocusPriorityOrder?: boolean;
    closeDisabled?: boolean;
    bodyInert?: boolean;
    header: Snippet;
    children: Snippet;
    footer?: Snippet;
  };

  // A stable per-instance id for ×, so the default autofocus chain can name it
  // and never fall through to FocusTrap's own default (the header trash, D18).
  const uid = $props.id();
  const closeId = `${uid}-close`;

  let {
    label = undefined,
    labelledby = undefined,
    width = 920,
    maxHeight = 600,
    onRequestClose,
    closeOnBackdrop = false,
    autofocusSelector = `[data-autofocus], #${closeId}`,
    autofocusPriorityOrder = true,
    closeDisabled = false,
    bodyInert = false,
    header,
    children,
    footer = undefined,
  }: Props = $props();

  let panelEl: HTMLElement | undefined = $state();

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  // querySelectorAll still returns elements inside an `inert` subtree, and
  // .focus() on them is a silent no-op — filter them out here.
  function candidates(): HTMLElement[] {
    if (!panelEl) return [];
    return [...panelEl.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
  }
  function refocus(preferLast: boolean) {
    if (!panelEl) return;
    const list = candidates();
    (preferLast ? list[list.length - 1] : list[0])?.focus();
    // Verify it landed; the panel (tabindex -1) is the last-resort target.
    if (!panelEl.contains(document.activeElement)) panelEl.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      // FocusTrap wraps Tab only on the exact first/last focusable; with
      // nothing focusable left (body inert, buttons disabled) hold the panel.
      if (candidates().length === 0) { e.preventDefault(); panelEl?.focus(); }
      return;
    }
    // keyCode 229 is Safari's IME-composition signal; inner widgets that own
    // an Escape (InlineField, AssetSidebar's inline confirm) preventDefault first.
    if (e.key !== 'Escape' || closeDisabled || e.repeat || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    e.preventDefault();
    onRequestClose();
  }

  // D8: the backdrop never steals focus, and clicks on it close only on request.
  function onBackdropMousedown(e: MouseEvent) {
    if (e.target === e.currentTarget) e.preventDefault();
  }
  function onBackdropClick(e: MouseEvent) {
    if (closeOnBackdrop && e.target === e.currentTarget) onRequestClose();
  }

  onMount(() => {
    const html = document.documentElement;
    const savedOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    // D18 containment. On teardown Svelte detaches the DOM and runs FocusTrap's
    // restore-to-opener BEFORE this cleanup; the isConnected bail keeps this
    // listener from fighting that restore.
    const onFocusIn = (e: FocusEvent) => {
      if (!panelEl || !panelEl.isConnected) return;
      const t = e.target as Node | null;
      if (t && panelEl.contains(t)) return;
      const from = e.relatedTarget as HTMLElement | null;
      refocus(from !== null && from === candidates()[0]);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      html.style.overflow = savedOverflow;
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onmousedown={onBackdropMousedown} onclick={onBackdropClick}>
  <FocusTrap {autofocusSelector} {autofocusPriorityOrder}>
    <section
      bind:this={panelEl}
      class="modal-panel"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledby}
      tabindex="-1"
      style:--modal-w="{width}px"
      style:--modal-h="{maxHeight}px"
    >
      <header class="modal-head">
        {@render header()}
        <IconButton id={closeId} glyph="close" size="md" title="Close" aria-label="Close" disabled={closeDisabled} onclick={onRequestClose} />
      </header>
      <div class="modal-body" inert={bodyInert}>
        {@render children()}
      </div>
      {#if footer}
        <footer class="modal-foot">{@render footer()}</footer>
      {/if}
    </section>
  </FocusTrap>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100; /* (c): above the app header — the existing modals' value (D17) */
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 26px; /* ref 1684 */
    background: color-mix(in srgb, var(--text) 34%, transparent); /* ref 1682 */
    -webkit-backdrop-filter: blur(1px); /* (c): Safari < 18 */
    backdrop-filter: blur(1px); /* ref 1682 */
  }
  /* --modal-w / --modal-h are component-local, set from props — not theme tokens. */
  .modal-panel {
    box-sizing: border-box;
    width: min(var(--modal-w), 100vw - 32px); /* (c): 16px gutter each side */
    max-height: min(var(--modal-h), 100vh - 52px); /* (c): 26px above and below */
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 16px 44px rgba(20,24,35,.22); /* ref 1684 */
  }
  .modal-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px 12px 16px;
    border-bottom: 1px solid var(--border); /* ref 1685 */
  }
  .modal-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px; /* ref 1695 */
  }
  /* Children never shrink: the body scrolls instead (spec :220-221). */
  .modal-body > :global(*) { flex: 0 0 auto; }
  .modal-foot {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface-3); /* ref 1750 */
  }
</style>
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/Modal.svelte.test.ts`
Expected: PASS, 16 tests.

If "focus that lands outside … is moved back" fails because jsdom fires no `focusin` on `.focus()`, keep the test and drive it with a dispatched `FocusEvent('focusin', { bubbles: true })` on the outside button, as the next test already does. Ledger that as a ruling.

- [ ] **Step 5: Add Modal's `:global` to the gate's reviewed allow-list**

The gate's (b3) check reads **source**. It fails now, even though nothing imports Modal yet.

In `frontend/scripts/visual-refresh-gate.sh`, replace:

```
    # Slice-5a T6: the last item row drops its hairline (ref 1602).
    ('src/components/editor/SequenceAccordion.svelte', '.item-row'),
}
```

with:

```
    # Slice-5a T6: the last item row drops its hairline (ref 1602).
    ('src/components/editor/SequenceAccordion.svelte', '.item-row'),
    # Slice-5b T1: `.modal-body > :global(*)` (spec :220-221). Child-combinator
    # scoped under the hashed `.modal-body`, so it reaches only the direct
    # children of a modal body. A T3 question renders inside SequencePlayer,
    # which never mounts a Modal.
    ('src/components/ui/Modal.svelte', '*'),
}
```

- [ ] **Step 6: Full verification**

Run, from `frontend/`:
```
npm test 2>&1 | tail -4
npm run check 2>&1 | tail -1
mkdir -p $W/tmp && TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -2
```
Expected:
- tests: 135 files, 1598 tests passed (1582 + 16);
- check: `0 ERRORS 18 WARNINGS`;
- gate: `VISUAL-REFRESH GATE: ALL PASS (945 checks)`.

- [ ] **Step 7: Review.** Run both lanes on the uncommitted diff, fix, and re-run until clean (Conventions). Point the reviewers at Review Focus 5 and at D8/D17/D18 in the spec. Wait for the user's OK.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ui/Modal.svelte frontend/src/tests/support/ModalHarness.svelte frontend/src/tests/Modal.svelte.test.ts frontend/scripts/visual-refresh-gate.sh
git commit -m "$(cat <<'EOF'
feat(ui): Slice 5b T1 — generic Modal frame (Escape, focus containment, scroll lock)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `MarkdownEditor` + `AssetSidebar` — 3c restyle, `plain`, `frozen`, Escape = Cancel

**What this task builds.** The markdown editor and its asset sidebar take 3c's look:
- **Tab bar:** a flat bar where the active tab sits on `--surface-2`.
- **Pane:** a 13px/1.7 mono pane with a 230px minimum height.
- **Sidebar:** a 260px `--surface-3` column. Asset rows have a 32×28 type tile, the name, a mono size, a `used` badge and an `IconButton` trash; the drop zone is dashed.

**Two new props:**
- **`plain`** (D6) shows the source as read-only mono text, with no tabs, no sidebar and no `/render` call. A disabled version's page and quiz bodies use it.
- **`frozen`** (D10, D9) makes the textarea `readonly` without blurring it, and blocks drops, sidebar inserts and uploads. The tabs stay usable.

**Other behaviour:**
- The asset hint takes the information-banner colour treatment (D11); the legacy yellow hexes go.
- The inline asset delete confirm gains **Escape = Cancel**, default-prevented so the modal stays open. Opening the confirm focuses Cancel, and closing it returns focus to the trash (R7).
- A referenced asset now shows `used` plus a **disabled** trash with a kind-aware reason (R2).

The restyle also reaches `MiniProjectModal`'s use (D21). Gate section **(ab)** is added; both components are already in the bundle via ItemEditPage, QuestionAccordion and MiniProjectModal.

**Files:**
- Modify: `frontend/src/components/editor/MarkdownEditor.svelte`, `frontend/src/components/editor/AssetSidebar.svelte`, `frontend/scripts/visual-refresh-gate.sh`
- Test (modify): `frontend/src/tests/MarkdownEditor.svelte.test.ts`, `frontend/src/tests/AssetSidebar.svelte.test.ts`, `frontend/src/tests/AssetSidebar.run-mode.svelte.test.ts`

**Interfaces:**
- Consumes: `IconButton` (`glyph="trash"|"close"`, `size="sm"`, `danger`, `borderless`, `disabled`, `title`, `aria-label`, `element` bindable).
- Produces:
  - `MarkdownEditor` gains `plain?: boolean = false`, `frozen?: boolean = false` and `ariaLabel?: string` (R10); `uploading` stays bindable.
  - DOM hooks:
    - the root is `div.md-card`;
    - in plain mode, `pre.plain-src[data-testid="markdown-plain"]`;
    - `AssetSidebar`'s root is `aside.asset-sidebar[data-testid="asset-sidebar"]`;
    - the hint is `p.hint[data-testid="cursor-banner"]`;
    - the trash is `span[data-testid="delete-trash"] > button.icon-btn`;
    - the dismiss is `span[data-testid="upload-error-dismiss"] > button`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/tests/MarkdownEditor.svelte.test.ts`:

```ts
describe('MarkdownEditor — plain (Slice-5b D6)', () => {
  it('shows the source as text with no tabs, no sidebar and no /render call', async () => {
    const { target } = mountEditor({ value: '# Title\n$x^2$', plain: true });
    await Promise.resolve(); flushSync();
    expect(target.querySelector('[data-testid="markdown-plain"]')!.textContent).toBe('# Title\n$x^2$');
    expect(target.querySelector('.tabs')).toBeNull();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeNull();
    expect(target.querySelector('textarea')).toBeNull();
    expect(stubCtx.renderPreview).not.toHaveBeenCalled();
  });

  it('wins over readOnly: still no /render call', async () => {
    mountEditor({ value: 'x', plain: true, readOnly: true });
    await Promise.resolve(); flushSync();
    expect(stubCtx.renderPreview).not.toHaveBeenCalled();
  });
});

describe('MarkdownEditor — ariaLabel (Slice-5b R10)', () => {
  it('names the textarea', () => {
    const { target } = mountEditor({ ariaLabel: 'Content' });
    flushSync();
    expect(target.querySelector('textarea')!.getAttribute('aria-label')).toBe('Content');
  });
});

describe('MarkdownEditor — frozen (Slice-5b D10)', () => {
  it('makes the textarea readonly without blurring it', async () => {
    const { target, propsRef } = mountEditor({ value: 'abc' });
    flushSync();
    const ta = target.querySelector('textarea')!;
    ta.focus();
    propsRef.frozen = true;
    flushSync();
    expect(ta.hasAttribute('readonly')).toBe(true);
    expect(ta.disabled).toBe(false);
    expect(document.activeElement).toBe(ta);
  });

  it('blocks a textarea drop: no upload, no insert', async () => {
    const { target } = mountEditor({ value: 'abc', frozen: true });
    flushSync();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    target.querySelector('textarea')!.dispatchEvent(ev);
    await Promise.resolve(); flushSync();
    expect(stubCtx.upload).not.toHaveBeenCalled();
  });

  it('disables sidebar inserts and the drop zone', async () => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([mkAsset({ id: 1 })]);
    const { target } = mountEditor({ value: '', frozen: true });
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    expect(target.querySelector<HTMLButtonElement>('.row-click')!.disabled).toBe(true);
    expect(target.querySelector('[data-testid="drop-zone"]')!.classList.contains('disabled')).toBe(true);
  });

  it('keeps the tabs usable', async () => {
    const { target } = mountEditor({ value: 'abc', frozen: true });
    flushSync();
    const preview = target.querySelector<HTMLButtonElement>('button[data-action="preview"]')!;
    expect(preview.disabled).toBe(false);
    preview.click();
    await Promise.resolve(); flushSync();
    expect(stubCtx.renderPreview).toHaveBeenCalledWith('abc');
  });
});
```

Make these changes in `frontend/src/tests/AssetSidebar.svelte.test.ts`:

1. Every trash and dismiss selector now targets the button inside the testid wrapper. From `frontend/`, run:

```bash
sed -i '' 's/\[data-testid="delete-trash"\]/[data-testid="delete-trash"] button/g; s/\[data-testid="upload-error-dismiss"\]/[data-testid="upload-error-dismiss"] button/g' src/tests/AssetSidebar.svelte.test.ts src/tests/AssetSidebar.run-mode.svelte.test.ts
```

2. Replace the test `'trash icon is rendered for unreferenced rows and absent for referenced rows'` (around `:351`) with:

```ts
  it('a referenced row shows `used` and a disabled trash with the in-use reason (R2)', async () => {
    const { target } = mountSidebar();
    await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync();
    const t1 = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-1"] [data-testid="delete-trash"] button')!;
    const t2 = target.querySelector<HTMLButtonElement>('[data-testid="asset-row-2"] [data-testid="delete-trash"] button')!;
    expect(t1.disabled).toBe(false);
    expect(t1.title).toBe('Remove asset');
    expect(t2.disabled).toBe(true);
    expect(t2.title).toBe('Remove asset — still referenced in this version');
    expect(target.querySelector('[data-testid="asset-row-2"] [data-testid="used-badge"]')!.textContent).toBe('used');
  });
```

3. Append at the end of the file:

```ts
describe('AssetSidebar — Slice-5b restyle', () => {
  beforeEach(() => {
    (stubCtx.list as ReturnType<typeof vi.fn>).mockResolvedValue([mkAsset({ id: 1, filename: 'a.png' })]);
  });
  const settleList = async () => { await Promise.resolve(); flushSync(); await Promise.resolve(); flushSync(); };

  it('the cursor hint is the D11 hint paragraph', async () => {
    const { target } = mountSidebar({ cursorReady: false });
    await settleList();
    const hint = target.querySelector('[data-testid="cursor-banner"]')!;
    expect(hint.tagName).toBe('P');
    expect(hint.classList.contains('hint')).toBe(true);
  });

  it('opening the inline confirm focuses Cancel; Escape cancels it, is default-prevented and refocuses the trash', async () => {
    const { target } = mountSidebar();
    await settleList();
    target.querySelector<HTMLButtonElement>('[data-testid="delete-trash"] button')!.click();
    await Promise.resolve(); flushSync(); await Promise.resolve();
    const cancel = target.querySelector<HTMLButtonElement>('[data-testid="delete-cancel"]')!;
    expect(document.activeElement).toBe(cancel);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    cancel.dispatchEvent(ev);
    await Promise.resolve(); flushSync(); await Promise.resolve();
    expect(ev.defaultPrevented).toBe(true);
    expect(target.querySelector('[data-testid="delete-confirm"]')).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('[data-testid="delete-trash"] button'));
  });

  it('renders no emoji or text glyph controls', async () => {
    const { target } = mountSidebar({ uploadError: { detail: 'Boom' } });
    await settleList();
    expect(target.textContent).not.toMatch(/[\u{1F5D1}×]/u);
    expect(target.querySelector('[data-testid="delete-trash"] button svg')).not.toBeNull();
    expect(target.querySelector('[data-testid="upload-error-dismiss"] button svg')).not.toBeNull();
  });
});
```

In `frontend/src/tests/AssetSidebar.run-mode.svelte.test.ts` the sed above already updated the selector. Append at the end of the file. This file drives a real `runAssetContext(42)` through its module-level `fetchSpy`/`jres`/`settle`, not a stub:

```ts
describe('AssetSidebar run mode — in-use reason (Slice-5b R2)', () => {
  it('a referenced run asset shows a disabled trash naming the mini-project reason', async () => {
    fetchSpy.mockImplementation(() =>
      jres([{ id: 1, filename: 'p.png', mime_type: 'image/png', file_size: 1, is_referenced: true }]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(AssetSidebar, {
      target,
      props: {
        assetContext: runAssetContext(42),
        onInsert: vi.fn(),
        onUploadFile: vi.fn<(file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>>(),
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    const t = target.querySelector<HTMLButtonElement>('[data-testid="delete-trash"] button')!;
    expect(t.disabled).toBe(true);
    expect(t.title).toBe('Remove asset — referenced by a mini-project');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/MarkdownEditor.svelte.test.ts src/tests/AssetSidebar.svelte.test.ts src/tests/AssetSidebar.run-mode.svelte.test.ts`
Expected: FAIL. `plain`/`frozen` are unknown props, `[data-testid="delete-trash"] button` matches nothing, and the hint is not a `P.hint`.

- [ ] **Step 3: `MarkdownEditor.svelte` — props, guards, template, styles**

(a) Props. Replace:

```ts
    uploadAbortController = $bindable<AbortController | null>(null),
    ariaDescribedby = undefined,
  }: {
```
with:
```ts
    uploadAbortController = $bindable<AbortController | null>(null),
    ariaDescribedby = undefined,
    ariaLabel = undefined,
    plain = false,
    frozen = false,
  }: {
```
and replace:
```ts
    uploadAbortController?: AbortController | null;
    ariaDescribedby?: string;
  } = $props();
```
with:
```ts
    uploadAbortController?: AbortController | null;
    ariaDescribedby?: string;
    // Slice-5b R10: the textarea's accessible name. The editor used to sit
    // inside a <label>; the modal's bodies have none (PageBody: "Content").
    ariaLabel?: string;
    // Slice-5b D6: read-only source text — no tabs, no sidebar, no /render call
    // (a disabled version's /render is a deliberate 403). Wins over readOnly.
    plain?: boolean;
    // Slice-5b D10/D9: a Save or a delete is in flight. The textarea turns
    // readonly WITHOUT blurring (disabled would blur, readOnly would unmount it),
    // and drops / sidebar inserts / uploads are blocked. Tabs stay usable.
    frozen?: boolean;
  } = $props();
```

(b) `insertAtCursor` guard. Replace `if (!textareaEl || disabled) return;` with `if (!textareaEl || disabled || frozen) return;`.

(c) `uploadOne`. Replace:
```ts
  ): Promise<AssetItem | null> {
    if (uploading) { flashOverlay(); return null; }
```
with:
```ts
  ): Promise<AssetItem | null> {
    if (frozen) return null;
    if (uploading) { flashOverlay(); return null; }
```

(d) Both drop handlers. In `handleTextareaDrop` and in `handleWrapperDrop`, replace `if (disabled) return;` with `if (disabled || frozen) return;`. There are exactly two occurrences inside those two functions. Leave `setMode`'s `if (disabled) return;` alone.

(e) `onMount`. Replace `if (readOnly) void loadPreview();` with `if (readOnly && !plain) void loadPreview();`.

(f) Replace the whole template and `<style>` (from `<div class="editor">` to the end of the file) with:

```svelte
<div class="md-card">
  {#if plain}
    <pre class="plain-src" data-testid="markdown-plain">{value}</pre>
  {:else}
    {#if !readOnly}
      <div class="tabs">
        <button type="button" data-action="edit" aria-pressed={mode === 'edit'} disabled={disabled} onclick={() => setMode('edit')}>Edit</button>
        <button type="button" data-action="preview" aria-pressed={mode === 'preview'} disabled={disabled} onclick={() => setMode('preview')}>Preview</button>
      </div>
    {/if}
    {#if mode === 'edit' && !readOnly}
      <div
        class="edit-content"
        role="region"
        aria-label="Markdown editor"
        ondragover={handleWrapperDragOver}
        ondrop={handleWrapperDrop}
        class:flash={flashUntil > 0}
      >
        <textarea
          bind:this={textareaEl}
          bind:value
          rows="14"
          spellcheck="false"
          disabled={disabled}
          readonly={frozen}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedby}
          ondragover={handleTextareaDragOver}
          ondrop={handleTextareaDrop}
          onfocus={onTextareaFocus}
          onblur={onTextareaBlur}
          onselectionchange={onTextareaSelectionChange}
        ></textarea>
        <AssetSidebar
          {assetContext}
          disabled={disabled || frozen}
          onInsert={handleSidebarInsert}
          onUploadFile={uploadOne}
          {refreshKey}
          {cursorReady}
          bind:uploading
          bind:uploadProgress
          bind:uploadError
        />
      </div>
    {:else if loading}
      <div class="preview"><em>Rendering…</em></div>
    {:else if error}
      <div class="preview err">{error}</div>
    {:else}
      <div class="preview">{@html html ?? ''}</div>
    {/if}
  {/if}
</div>

<style>
  .md-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface); /* ref 1702 */
  }
  .tabs { display: flex; border-bottom: 1px solid var(--border); /* ref 1703 */ }
  .tabs button {
    padding: 8px 14px;
    border: 0;
    background: none;
    font-size: 13px;
    font-weight: 400;
    color: var(--muted);
    cursor: pointer; /* ref 1705 */
  }
  .tabs button[aria-pressed="true"] { background: var(--surface-2); font-weight: 600; color: var(--text); /* ref 1704 */ }
  .tabs button:disabled { color: var(--faint); cursor: not-allowed; }
  .edit-content { display: flex; flex-direction: row; align-items: stretch; min-height: 0; /* ref 1707 */ }
  /* Spec (mini-projects-frontend §"Layout") mandates the textarea + asset
     sidebar collapse to a single column below 880px (50%-split-screen on
     1920px + small-laptop split scenarios). The split lives here, NOT in
     MiniProjectModal's `.body` (codex T6a r1 catch). */
  @media (max-width: 880px) {
    .edit-content { flex-direction: column; }
  }
  textarea {
    flex: 1 1 0;
    min-width: 0;
    min-height: 230px;
    padding: 12px 14px;
    border: 0;
    background: var(--surface);
    font: 13px/1.7 var(--font-mono);
    color: var(--text-2);
    caret-color: var(--primary);
    resize: vertical; /* ref 1708 */
  }
  .preview { min-height: 200px; padding: 12px 14px; font-size: 13px; color: var(--text); /* ref 1708 */ }
  .preview.err { color: var(--danger); }
  .plain-src {
    margin: 0;
    padding: 12px 14px;
    font: 13px/1.7 var(--font-mono);
    color: var(--text-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere; /* ref 1708 — the pane, read-only */
  }
  .edit-content.flash { box-shadow: inset 0 0 0 2px var(--danger); }
</style>
```

- [ ] **Step 4: `AssetSidebar.svelte` — reasons, inline-confirm focus, template, styles**

(a) Imports. Replace `import { onMount } from 'svelte';` with:
```ts
  import { onMount, tick } from 'svelte';
  import IconButton from '../ui/IconButton.svelte';
```

(b) Replace the two lines:
```ts
  function askDelete(id: number) { if (disabled) return; confirmId = id; }
  function cancelDelete() { confirmId = null; }
```
with:
```ts
  // R2: `is_referenced` counts references across the whole version (course) or
  // the whole run, never one item — the reason says so.
  const inUseReason = $derived(
    assetContext.kind === 'run'
      ? 'Remove asset — referenced by a mini-project'
      : 'Remove asset — still referenced in this version',
  );
  // R7: the inline confirm takes focus on Cancel so Escape reaches it, and
  // gives it back to the row's trash when it closes.
  const trashEls = $state<Record<number, HTMLButtonElement | undefined>>({});
  const cancelEls = $state<Record<number, HTMLButtonElement | undefined>>({});
  async function askDelete(id: number) {
    if (disabled) return;
    confirmId = id;
    await tick();
    cancelEls[id]?.focus();
  }
  async function cancelDelete() {
    const id = confirmId;
    confirmId = null;
    await tick();
    if (id !== null) trashEls[id]?.focus();
  }
  // Escape = Cancel. preventDefault so an enclosing modal does not close (§1).
  function onConfirmKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    void cancelDelete();
  }
```

(c) Replace the whole template and `<style>` (from `<aside` to the end of the file) with:

```svelte
<aside
  class="asset-sidebar"
  data-testid="asset-sidebar"
  ondragover={handleDragOver}
  ondrop={handleAsideRootDrop}
>
  <h3>{assetContext.kind === 'run' ? 'Run assets — shared across all MPs in this run' : 'Course assets'}</h3>

  {#if !cursorReady}
    <p class="hint" data-testid="cursor-banner">
      Click in the editor to position the cursor, or new assets will be appended to the end.
    </p>
  {/if}

  {#if uploadError}
    <div class="error" data-testid="upload-error">
      <span class="msg">
        {#if uploadError.stoppedAt}
          Upload stopped at file {uploadError.stoppedAt.n} of {uploadError.stoppedAt.m}: {uploadError.detail}
        {:else}
          {uploadError.detail}
        {/if}
      </span>
      <span data-testid="upload-error-dismiss">
        <IconButton glyph="close" size="sm" borderless title="Dismiss error" onclick={() => (uploadError = null)} />
      </span>
    </div>
  {/if}

  {#if uploadProgress}
    <div class="progress" data-testid="upload-progress">
      {#if uploadProgress.total > 1}
        Uploading file {uploadProgress.current} of {uploadProgress.total}: {uploadProgress.filename}…
      {:else}
        Uploading {uploadProgress.filename}…
      {/if}
    </div>
  {/if}

  {#if deleteErrorMsg}
    <div class="error" data-testid="delete-error">
      <span class="msg">{deleteErrorMsg}</span>
      <IconButton glyph="close" size="sm" borderless title="Dismiss error" onclick={() => (deleteErrorMsg = null)} />
    </div>
  {/if}

  {#if loading}
    <p class="muted" data-testid="loading-indicator">Loading…</p>
  {:else if listError}
    <p class="error-inline">{listError}</p>
  {:else if assets.length === 0}
    <p class="muted">No assets yet. Drop a file in the zone below or click it to pick.</p>
  {:else}
    <ul class="list">
      {#each assets as a (a.id)}
        <li class="row" data-testid={`asset-row-${a.id}`}>
          <button
            type="button"
            class="row-click"
            disabled={disabled}
            onclick={() => onInsert(formatRef(a.filename, a.mime_type))}
          >
            <span class="thumb">
              {#if isImage(a.mime_type)}
                <img loading="lazy" src={assetContext.imgSrc(a)} alt="" />
              {:else}
                <span class="chip mono">{extChip(a)}</span>
              {/if}
            </span>
            <span class="meta">
              <span class="name" title={a.filename}>{displayName(a.filename)}</span>
              <span class="size mono">{formatFileSize(a.file_size)}</span>
            </span>
          </button>
          {#if a.is_referenced}
            <span
              class="used"
              data-testid="used-badge"
              title="Remove this reference from content and save to enable delete."
            >used</span>
          {/if}
          {#if confirmId === a.id}
            <span class="confirm-pair">
              <button
                type="button"
                class="confirm"
                data-testid="delete-confirm"
                disabled={disabled || deletingIds.has(a.id)}
                onkeydown={onConfirmKeydown}
                onclick={(e) => { e.stopPropagation(); void confirmDelete(a.id); }}
              >Confirm</button>
              <button
                type="button"
                class="cancel"
                data-testid="delete-cancel"
                bind:this={cancelEls[a.id]}
                onkeydown={onConfirmKeydown}
                onclick={(e) => { e.stopPropagation(); void cancelDelete(); }}
              >Cancel</button>
            </span>
          {:else}
            <span data-testid="delete-trash">
              <IconButton
                glyph="trash"
                size="sm"
                danger
                title={a.is_referenced ? inUseReason : 'Remove asset'}
                aria-label={`Delete ${a.filename}`}
                disabled={disabled || a.is_referenced}
                bind:element={trashEls[a.id]}
                onclick={() => void askDelete(a.id)}
              />
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div
    class="drop-zone"
    data-testid="drop-zone"
    ondragover={handleDragOver}
    ondrop={handleDropZone}
    role="button"
    tabindex="0"
    onclick={pickFile}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } }}
    class:disabled={disabled || uploading}
  >
    Drop here or click to pick
  </div>
  <input
    type="file"
    hidden
    multiple
    data-testid="file-picker"
    bind:this={fileInputEl}
    disabled={disabled || uploading}
    onchange={handleFileInput}
  />
</aside>

<style>
  .asset-sidebar {
    flex: 0 0 260px;
    min-width: 0;
    padding: 12px;
    border-left: 1px solid var(--border);
    background: var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 8px; /* ref 1717 */
  }
  /* Stacked under 880px (MarkdownEditor): a full-width block, not a 260px-tall one. */
  @media (max-width: 880px) {
    .asset-sidebar { flex: 0 0 auto; border-left: 0; border-top: 1px solid var(--border); }
  }
  h3 { font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1718 */ }
  /* D11: the information-banner colour treatment at sidebar size (ref 1719 geometry). */
  .hint {
    margin: 0;
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-3);
  }
  .error {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--danger);
    font-size: 11.5px;
    color: var(--danger); /* D11 treatment, error form */
  }
  .msg { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .progress {
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    color: var(--text-3); /* D11 treatment */
  }
  .muted { margin: 0; font-size: 12px; color: var(--muted); }
  .error-inline { margin: 0; font-size: 12px; color: var(--danger); }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .row { display: flex; align-items: center; gap: 9px; padding: 6px 7px; border-radius: var(--radius); /* ref 1720 */ }
  .row:hover { background: var(--surface-2); }
  .row-click {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px; /* ref 1720 */
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row-click:disabled { cursor: not-allowed; }
  .thumb {
    flex: 0 0 32px;
    width: 32px;
    height: 28px;
    border-radius: 4px; /* the 4px tile radius (ref 1721) */
    background: var(--border-soft); /* ref 1721 — no fill token; --border-soft is the same value */
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .chip { font-size: 9.5px; font-weight: 600; color: var(--muted); /* ref 1721 */ }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; /* ref 1722 */ }
  .name { font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; /* ref 1723 */ }
  .size { font-size: 10.5px; color: var(--muted); /* ref 1724 */ }
  .used {
    padding: 3px 8px;
    border-radius: 3px;
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap; /* ref 1726 */
  }
  .confirm-pair { display: flex; gap: 4px; /* the 4px step */ }
  .confirm-pair button {
    padding: 2px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 11.5px;
    cursor: pointer;
  }
  .confirm-pair .confirm { color: var(--danger); }
  .confirm-pair button:disabled { color: var(--faint); border-color: var(--border-faint); cursor: not-allowed; }
  .drop-zone {
    margin-top: 2px;
    padding: 11px 10px;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius);
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer; /* ref 1744 */
  }
  .drop-zone:hover { background: var(--surface-2); }
  .drop-zone.disabled { color: var(--faint); border-color: var(--border-faint); cursor: not-allowed; }
</style>
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/MarkdownEditor.svelte.test.ts src/tests/MarkdownEditor.run-mode.svelte.test.ts src/tests/AssetSidebar.svelte.test.ts src/tests/AssetSidebar.run-mode.svelte.test.ts src/tests/MiniProjectModal.create-edit.svelte.test.ts src/tests/MiniProjectModal.publish.svelte.test.ts`
Expected: PASS. The new tests: MarkdownEditor +7, AssetSidebar +3 (one replaced), run-mode +1.

A pre-existing test that clicked the old trash on a **referenced** row now finds a disabled button. If one fails on that, its assertion described the removed "no trash on referenced rows" rule: update the assertion to the D21/R2 behaviour and ledger it.

- [ ] **Step 6: Gate section (ab)**

In `frontend/scripts/visual-refresh-gate.sh`, insert this block **after** section (z)'s closing emoji check (`fi`), and **before** `# The summary line is the parent process's`:

```zsh
echo
echo "--- (ab) Slice-5b T2 — MarkdownEditor + AssetSidebar (3c) ---"
# Slice-5b helper (sections ab-ag). emoji_scan LABEL FILE... — Constraint 3 over
# source with comments stripped: <!-- -->, /* */, and // when it starts a line or
# follows whitespace (so https:// is not a comment). The arrows block and the
# multiplication sign are in the set: the old quiz controls used them as glyphs.
emoji_scan() {
  local label=$1; shift
  if python3 - "$@" <<'PY'
import re, sys
pat = re.compile('[\U0001F300-\U0001FAFF☀-➿⬀-⯿■-◿←-⇿⌘×＋]')
def strip(s):
    s = re.sub(r'<!--.*?-->', ' ', s, flags=re.S)
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    return re.sub(r'(?m)(^|\s)//.*$', ' ', s)
sys.exit(1 if any(pat.search(strip(open(f).read())) for f in sys.argv[1:]) else 0)
PY
  then echo "PASS  $label carry no emoji or decorative glyphs"
  else echo "FAIL  $label carry no emoji or decorative glyphs"; fail=1; fi
}

own md-card MarkdownEditor.svelte
uniq1 md-card
if [[ -n $REPLY ]]; then
  N=MarkdownEditor; H=$REPLY
  d '\.md-card' '' 'display:flex' 'flex-direction:column' 'overflow:hidden' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)'
  d '\.tabs' '' 'display:flex' 'border-bottom:1px solid var\(--border\)'
  chk "\.tabs\.${H} button:where\(\.${H}\)" 'padding:8px 14px' 'border:0' 'font-size:13px' 'font-weight:400' 'color:var\(--muted\)'
  chk "\.tabs\.${H} button\[aria-pressed=\"?true\"?\]:where\(\.${H}\)" 'background:var\(--surface-2\)' 'font-weight:600' 'color:var\(--text\)'
  chk "\.tabs\.${H} button:where\(\.${H}\):disabled" 'color:var\(--faint\)' 'cursor:not-allowed'
  d 'textarea' '' 'flex:1 1 0' 'min-width:0' 'min-height:230px' 'padding:12px 14px' 'border:0' 'font:13px/1\.7 var\(--font-mono\)' 'color:var\(--text-2\)' 'caret-color:var\(--primary\)' 'resize:vertical'
  d '\.preview' '' 'padding:12px 14px' 'font-size:13px' 'color:var\(--text\)'
  d '\.preview\.err' '' 'color:var\(--danger\)'
  d '\.plain-src' '' 'margin:0' 'padding:12px 14px' 'font:13px/1\.7 var\(--font-mono\)' 'color:var\(--text-2\)' 'white-space:pre-wrap'
  d '\.edit-content\.flash' '' 'box-shadow:inset 0 0 0 2px var\(--danger\)'
  none "MarkdownEditor pre-5b .editor root gone"   "\.editor\.${H}[{ ,:.]"
  none "MarkdownEditor no ui-monospace literal"    "\.[a-z-]+\.${H}[^{]*\{[^}]*ui-monospace"
  none "MarkdownEditor no rem font sizes"          "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep MarkdownEditor $H
fi

own asset-sidebar AssetSidebar.svelte
uniq1 asset-sidebar
if [[ -n $REPLY ]]; then
  N=AssetSidebar; H=$REPLY
  d '\.asset-sidebar' '' 'flex:0 0 260px' 'padding:12px' 'border-left:1px solid var\(--border\)' 'background:var\(--surface-3\)' 'display:flex' 'flex-direction:column' 'gap:8px'
  d 'h3' '' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.hint' '' 'margin:0' 'padding:8px 10px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:11\.5px' 'color:var\(--text-3\)'
  d '\.error' '' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--danger\)' 'color:var\(--danger\)'
  d '\.progress' '' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'color:var\(--text-3\)'
  d '\.row' '' 'display:flex' 'align-items:center' 'gap:9px' 'padding:6px 7px' 'border-radius:var\(--radius\)'
  d '\.thumb' '' 'width:32px' 'height:28px' 'border-radius:4px' 'background:var\(--border-soft\)'
  d '\.chip' '' 'font-size:9\.5px' 'font-weight:600' 'color:var\(--muted\)'
  d '\.name' '' 'font-size:12\.5px' 'color:var\(--text\)' 'text-overflow:ellipsis' 'white-space:nowrap'
  d '\.size' '' 'font-size:10\.5px' 'color:var\(--muted\)'
  d '\.used' '' 'padding:3px 8px' 'border-radius:3px' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)' 'font-size:11px' 'font-weight:500'
  d '\.drop-zone' '' 'padding:11px 10px' 'border:2px dashed var\(--border-strong\)' 'border-radius:var\(--radius\)' 'font-size:12px' 'color:var\(--muted\)'
  d '\.drop-zone\.disabled' '' 'color:var\(--faint\)' 'border-color:var\(--border-faint\)'
  none "AssetSidebar pre-5b .sidebar/.banner/.trash rules gone" "\.(sidebar|banner|trash)\.${H}[{ ,:.]"
  none "AssetSidebar no rem font sizes"                         "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep AssetSidebar $H
fi
emoji_scan "MarkdownEditor / AssetSidebar" src/components/editor/MarkdownEditor.svelte src/components/editor/AssetSidebar.svelte
```

Then run the gate once with the old count, read the printed total, and set `EXPECTED_CHECKS` to it:

```
TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -3
```
Expected: the only FAIL is the count line (`ran N checks, expected 945`). N is about 945 + 80; set `EXPECTED_CHECKS=N` and re-run.
Expected: `VISUAL-REFRESH GATE: ALL PASS (N checks)`.

**Mutation-test the section** (Constraint 12). Make each mutation, re-run, check that the named check goes red, then revert:
- `MarkdownEditor .tabs button` padding `8px 14px` → `8px 12px` → the `chk … padding` FAILs;
- `AssetSidebar .used` `var(--status-accepted-bg)` → `#d1fae5` → the `.used` pin **and** `sweep` FAIL;
- add `🗑` to AssetSidebar's template → `emoji_scan` FAILs;
- `.drop-zone.disabled` → add `opacity: .5` → `sweep` FAILs.

- [ ] **Step 7: Full verification**

Run: `npm test 2>&1 | tail -4`, then `npm run check 2>&1 | tail -1`, then `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`
Expected:
- tests: all pass, 1609 (1598 + 11);
- check: `0 ERRORS`, warnings ≤ 18;
- gate: `ALL PASS (N checks)`.

- [ ] **Step 8: Review** (both lanes, uncommitted diff; Review Focus 4). Wait for the user's OK.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/editor/MarkdownEditor.svelte frontend/src/components/editor/AssetSidebar.svelte frontend/scripts/visual-refresh-gate.sh frontend/src/tests/MarkdownEditor.svelte.test.ts frontend/src/tests/AssetSidebar.svelte.test.ts frontend/src/tests/AssetSidebar.run-mode.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5b T2 — MarkdownEditor + AssetSidebar 3c restyle, plain + frozen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3a: `ItemEditorModal` + `PageBody` + interim quiz/app wiring + gates (aa), (ac)

**What this task builds.** `ItemEditorModal` is the item editor (§2). This task builds it, unit-tested. It is not yet routed: `ItemEditPage` still serves item URLs until T3b.

**Header** (refs 1685-1689):
- the covered `ItemMark`;
- the item name (the dialog's accessible name);
- the mono context `static page · S2 · item 3 of 4`;
- the D9 trash, which calls the page's `onDeleteItem`.

**Body:**
- the Title `.field-row` (`132px 1fr`, D2), with a D12 plain input. It is read-only text when `!perms.canEditTextFields`;
- the D6 note on a disabled version;
- the type body.

**Footer** (ref 1750), shown only when text is editable: mono "unsaved changes", Discard and Save. ⌘S/Ctrl+S inside the dialog saves.

**Dirty tracking:**
- The modal registers **one** tracker in the page registry: `isDirty = titleDirty || bodyGuardDirty`.
- A confirmed close resets the title and calls `body.discardAll()`.

**`deleting` (D9)** puts `inert` on the body, disables ×, Escape, Save and trash, and on false refocuses the trash (or ×).

**`PageBody`** is the first body to implement the §2 contract:
- A `content_md` tracker.
- `MarkdownEditor`:
  - `plain` on a disabled version (D6);
  - `readOnly` on an archived one (`/render` is allowed there);
  - otherwise bound, with `frozen`, `refreshKey` and `uploading` → `busy`.
- Save sends one `PATCH {title?, content_md?}` and writes the echo back per field (D10).

**Interim wiring** (spec §Task decomposition):
- **Quiz:** today's `QuizEditor` with `showTitle={false}` and `versionDisabled`. Its `quizDirty` feeds `guardDirty` only, and the modal saves the title alone. `QuestionAccordion` passes `plain={versionDisabled}`, so a disabled quiz never calls `/render` (D6).
- **Interactive app:** today's `InteractiveAppEditor` with `showTitle={false}`, and its `uploadBusy` bound to `busy`. It mounts only on an enabled version.

**`VersionEditPage`** imports the modal behind `{#if expandedItem}`, with `expandedItem` always `null`, so the gate sees Modal's and the modal's CSS. Gate sections **(aa)** Modal and **(ac)** ItemEditorModal are added. `PageBody` authors no CSS.

**Files:**
- Create:
  - `frontend/src/lib/itemBody.ts`
  - `frontend/src/components/editor/ItemEditorModal.svelte`
  - `frontend/src/components/editor/item/PageBody.svelte`
  - `frontend/src/tests/support/ItemEditorModalHarness.svelte`
  - `frontend/src/tests/ItemEditorModal.svelte.test.ts`
- Modify:
  - `frontend/src/components/editor/QuizEditor.svelte`
  - `frontend/src/components/editor/QuestionAccordion.svelte`
  - `frontend/src/components/items/InteractiveAppEditor.svelte`
  - `frontend/src/pages/editor/VersionEditPage.svelte`
  - `frontend/scripts/visual-refresh-gate.sh`

**Interfaces:**
- Consumes:
  - `Modal` (T1: `labelledby`, `onRequestClose`, `closeDisabled`, `bodyInert`, `header`, `footer`, `children`);
  - `MarkdownEditor` (T2: `plain`, `frozen`, `ariaLabel`, bindable `value` / `refreshKey` / `uploading`);
  - `makeDirtyTracker`;
  - `DIRTY_REGISTRY_KEY` / `RegisteredTracker`;
  - `structureReason`;
  - `loadAdminTree` / `LoadResult`;
  - `courseAssetContext`.
- Produces (later tasks rely on these exact names):
  - `lib/itemBody.ts`:
    - `type SaveOutcome = { outcome: 'ok' | 'partial' | 'failed'; savedTitle?: string }`;
    - `type ItemBodyApi = { save(titleDraft: string | undefined): Promise<SaveOutcome>; discard(): void; discardAll(): void; validate(): boolean }`;
    - `type ItemEcho = { id: number; title: string; content_md: string | null; video_url: string | null; script_url: string | null }`;
    - `patchItem(id: number, body: Record<string, unknown>): Promise<ItemEcho>`;
    - `reportSaveFailure(e: unknown, vid: number, stillOnVid: (v: number) => boolean): void`.
  - **Body component contract.** `PageBody` here, `VideoBody` (T3c) and `AppBody` (T4):
    - props `item: AdminTreeItem; vid: number; assetContext: AssetContext; editable: boolean; versionDisabled: boolean; frozen: boolean; stillOnVid: (v: number) => boolean`;
    - bindable `saveDirty`, `guardDirty`, `busy`;
    - exported `save`, `discard`, `discardAll`, `validate`.

    **Rules every body follows:**
    - It **toasts its own failures** (`reportSaveFailure`) and its own partial-failure message.
    - The modal toasts "Saved" and reloads the tree.
    - A body that sends the title returns the echo as `savedTitle`.
  - `ItemEditorModal` props: `vid, version, perms, seqIndex, item, itemIndex, itemCount, stillOnVid, onRequestClose, onDeleteItem, deleting?` (R11).
  - DOM hooks:
    - `input.plain-input[aria-label="Title"]`;
    - `span.dirty`;
    - the footer's `button` "Save" / "Discard";
    - the header trash `button[aria-label="Delete item"]`;
    - `p.ro-note`.
  - `QuizEditor` gains `showTitle?: boolean = true` and `versionDisabled?: boolean = false`.
  - `QuestionAccordion` gains `versionDisabled?: boolean = false`.
  - `InteractiveAppEditor` gains `showTitle?: boolean = true` and bindable `uploadBusy`.

- [ ] **Step 1: Write the harness and the failing tests**

File `frontend/src/tests/support/ItemEditorModalHarness.svelte` (full content):

```svelte
<script lang="ts">
  // Provides the page's dirty registry (as VersionEditPage does) around one
  // ItemEditorModal, and mirrors registry.isAnyDirty() into the DOM.
  import { setContext, untrack, type ComponentProps } from 'svelte';
  import ItemEditorModal from '../../components/editor/ItemEditorModal.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';

  let { modal, onRegistry }: {
    modal: ComponentProps<typeof ItemEditorModal>;
    onRegistry?: (r: DirtyRegistry) => void;
  } = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  untrack(() => onRegistry)?.(registry);
  const anyDirty = $derived(registry.isAnyDirty());
</script>

<output data-testid="any-dirty">{anyDirty}</output>
<ItemEditorModal {...modal} />
```

File `frontend/src/tests/ItemEditorModal.svelte.test.ts` (full content):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './support/ItemEditorModalHarness.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
import { versionPermissions } from '../lib/versionPermissions';
import type { AdminTreeItem, AdminTreeVersion } from '../lib/types';
import type { DirtyRegistry } from '../lib/dirtyRegistry.svelte';

// Real store, real bodies; only fetch is stubbed.
const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function resp(body: unknown, status = 200) {
  return {
    ok: status < 400, status, statusText: 'x',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const jres = (body: unknown, status = 200) => Promise.resolve(resp(body, status));
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 3, label: '', created_at: '2026-01-01T00:00:00Z',
    published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function mkItem(over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id: 7, sequence_id: 3, title: 'Eigenvalues', slug: 'eig', order: 1, type: 'static_page',
    content_md: '# Hi', content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  };
}
const textQ = {
  id: 51, item_id: 7, text_md: 'What is $x$?', text_html: '<p>What is x?</p>', type: 'text_answer',
  order: 1, explanation_md: 'Because.', explanation_html: '', correct_numeric: null, precision: null, correct_text: 'x',
};

type Call = [string, RequestInit | undefined];
const calls = (re: RegExp, method = 'GET') =>
  (fetchSpy.mock.calls as Call[]).filter(([u, init]) => re.test(String(u)) && (init?.method ?? 'GET') === method);
const patchBodies = () => calls(/\/api\/items\/7$/, 'PATCH').map(([, init]) => JSON.parse(String(init!.body)));

function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    const custom = extra(u, init);
    if (custom) return custom;
    if (u.endsWith('/admin-tree')) return jres({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] });
    if (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH') {
      // Echo what was sent, with the title trimmed (models server normalisation).
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      const echo = { ...mkItem(), ...sent };
      if (typeof sent.title === 'string') echo.title = sent.title.trim();
      return jres(echo);
    }
    if (u.endsWith('/questions')) return jres([textQ]);
    if (u.endsWith('/render')) return jres({ html: '<p>rendered</p>' });
    if (u.endsWith('/assets')) return jres([]);
    return jres({});
  });
}

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let registry: DirtyRegistry | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let props: any;

async function render(over: { item?: Partial<AdminTreeItem>; version?: Partial<AdminTreeVersion>; modal?: Record<string, unknown> } = {}) {
  const version = mkVersion(over.version);
  props = $state({
    modal: {
      vid: 1, version, perms: versionPermissions(version), seqIndex: 2,
      item: mkItem(over.item), itemIndex: 3, itemCount: 4,
      stillOnVid: () => true, onRequestClose: vi.fn(), onDeleteItem: vi.fn(), deleting: false,
      ...over.modal,
    },
    onRegistry: (r: DirtyRegistry) => { registry = r; },
  });
  cmp = mount(Harness, { target, props });
  await settle();
}

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  serve();
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  target.remove();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  clearEditorVersion();
  clearToasts();
  registry = null;
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const titleInput = () => panel().querySelector<HTMLInputElement>('input.plain-input[aria-label="Title"]')!;
const textarea = () => panel().querySelector<HTMLTextAreaElement>('textarea')!;
const trash = () => panel().querySelector<HTMLButtonElement>('button[aria-label="Delete item"]')!;
const closeBtn = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const footBtn = (label: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label)!;
const dirtyText = () => panel().querySelector('footer.modal-foot .dirty')!.textContent;
const anyDirty = () => target.querySelector('[data-testid="any-dirty"]')!.textContent;
const toastTexts = () => toasts.list.map((t) => t.message);
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('ItemEditorModal — header and Title (T3a)', () => {
  it('header: covered mark, the name as the dialog label, the mono context and an enabled trash', async () => {
    await render();
    const name = panel().querySelector('h2.item-name')!;
    expect(name.textContent).toBe('Eigenvalues');
    expect(panel().getAttribute('aria-labelledby')).toBe(name.id);
    expect(panel().querySelector('.item-mark.covered')).not.toBeNull();
    const ctx = panel().querySelector('.item-ctx')!;
    expect(ctx.textContent).toBe('static page · S2 · item 3 of 4');
    expect(ctx.classList.contains('mono')).toBe(true);
    expect(trash().disabled).toBe(false);
    expect(trash().title).toBe('Delete this item');
  });

  it('Title is a plain, focused input with a 200-character cap', async () => {
    await render();
    expect(titleInput().value).toBe('Eigenvalues');
    expect(titleInput().maxLength).toBe(200);
    expect(document.activeElement).toBe(titleInput());
  });

  it('the trash calls onDeleteItem', async () => {
    await render();
    trash().click();
    expect(props.modal.onDeleteItem).toHaveBeenCalledTimes(1);
  });

  it('trash reasons: the structure reason when published; "save or discard first" when dirty', async () => {
    await render({ version: { state: 'published' } });
    expect(trash().disabled).toBe(true);
    expect(trash().title).toBe('Only a created version can change its structure');
    unmount(cmp!); cmp = null;
    await render();
    type(titleInput(), 'Eigen');
    expect(trash().disabled).toBe(true);
    expect(trash().title).toBe('Delete this item — save or discard changes first');
  });
});

describe('ItemEditorModal — footer, Save, Discard (T3a, page body)', () => {
  it('clean: Save and Discard are disabled with reasons and nothing reads "unsaved changes"', async () => {
    await render();
    expect(footBtn('Save').disabled).toBe(true);
    expect(footBtn('Save').title).toBe('No changes to save');
    expect(footBtn('Discard').disabled).toBe(true);
    expect(footBtn('Discard').title).toBe('No changes to discard');
    expect(dirtyText()).toBe('');
    expect(anyDirty()).toBe('false');
  });

  it('editing the title marks the footer and the page registry dirty', async () => {
    await render();
    type(titleInput(), 'Eigen');
    expect(dirtyText()).toBe('unsaved changes');
    expect(footBtn('Save').disabled).toBe(false);
    expect(anyDirty()).toBe('true');
  });

  it('Save sends one PATCH, writes the echo back, reloads the tree, toasts and refreshes the asset list', async () => {
    await render();
    const listsBefore = calls(/\/api\/versions\/1\/assets$/).length;
    type(titleInput(), 'New title  ');
    type(textarea(), '# Changed');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'New title  ', content_md: '# Changed' }]);
    expect(titleInput().value).toBe('New title');          // the trimmed echo is written back
    expect(dirtyText()).toBe('');
    expect(anyDirty()).toBe('false');
    expect(calls(/\/admin-tree$/).length).toBe(1);
    expect(toastTexts()).toContain('Saved');
    expect(calls(/\/api\/versions\/1\/assets$/).length).toBe(listsBefore + 1); // refreshKey++
  });

  it('a content-only change sends no title', async () => {
    await render();
    type(textarea(), 'body only');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ content_md: 'body only' }]);
  });

  it('a failed PATCH keeps the drafts, toasts the server message and does not reload', async () => {
    serve((u, init) => (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH' ? jres({ detail: 'Nope' }, 422) : undefined));
    await render();
    type(titleInput(), 'Eigen 2');
    footBtn('Save').click();
    await settle();
    expect(toastTexts()).toContain('Nope');
    expect(dirtyText()).toBe('unsaved changes');
    expect(calls(/\/admin-tree$/).length).toBe(0);
  });

  it('an empty title blocks Save: nothing is sent, the field shows its error and takes focus', async () => {
    await render();
    type(titleInput(), '   ');
    textarea().focus();
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([]);
    expect(titleInput().getAttribute('aria-invalid')).toBe('true');
    expect(panel().querySelector('.field-err')!.textContent).toBe('Title is required');
    expect(document.activeElement).toBe(titleInput());
    expect(toastTexts()).toContain('Fix the highlighted fields');
  });

  it('Discard restores the saved title and content', async () => {
    await render();
    type(titleInput(), 'X');
    type(textarea(), 'Y');
    footBtn('Discard').click();
    flushSync();
    expect(titleInput().value).toBe('Eigenvalues');
    expect(textarea().value).toBe('# Hi');
    expect(dirtyText()).toBe('');
  });

  it('⌘S in the textarea saves; while it runs inputs are readonly and focus stays in the textarea', async () => {
    let release!: () => void;
    serve((u, init) => {
      if (!(/\/api\/items\/7$/.test(u) && init?.method === 'PATCH')) return undefined;
      return new Promise((r) => { release = () => r(resp({ ...mkItem(), content_md: 'typed' })); });
    });
    await render();
    textarea().focus();
    type(textarea(), 'typed');
    const ev = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    textarea().dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(patchBodies()).toEqual([{ content_md: 'typed' }]);
    expect(textarea().hasAttribute('readonly')).toBe(true);
    expect(titleInput().hasAttribute('readonly')).toBe(true);
    expect(footBtn('Save').disabled).toBe(true);
    expect(document.activeElement).toBe(textarea());
    release();
    await settle();
    expect(textarea().hasAttribute('readonly')).toBe(false);
    expect(document.activeElement).toBe(textarea());
  });

  it('⌘S outside the dialog does nothing', async () => {
    await render();
    type(titleInput(), 'Eigen');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(patchBodies()).toEqual([]);
    outside.remove();
  });

  it('Save is disabled while an asset upload is in flight (busy interlock)', async () => {
    serve((u, init) => (u.endsWith('/assets') && init?.method === 'POST' ? new Promise(() => {}) : undefined));
    await render();
    type(titleInput(), 'Eigen');
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    textarea().dispatchEvent(ev);
    await settle();
    // The title is dirty, so only the in-flight upload can be disabling Save.
    expect(footBtn('Save').disabled).toBe(true);
    expect(footBtn('Discard').disabled).toBe(true);
  });

  it('a confirmed close (registry discard) resets title and content', async () => {
    await render();
    type(titleInput(), 'X');
    type(textarea(), 'Y');
    registry!.discardAll();
    flushSync();
    expect(titleInput().value).toBe('Eigenvalues');
    expect(textarea().value).toBe('# Hi');
    expect(anyDirty()).toBe('false');
  });
});

describe('ItemEditorModal — deleting freeze (T3a, D9)', () => {
  it('while deleting: body inert; ×, Save and trash disabled; Escape ignored', async () => {
    await render();
    type(titleInput(), 'Eigen');
    props.modal.deleting = true;
    flushSync();
    expect(panel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(closeBtn().disabled).toBe(true);
    expect(footBtn('Save').disabled).toBe(true);
    expect(trash().disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.modal.onRequestClose).not.toHaveBeenCalled();
  });

  it('deleting true → false returns focus to the trash', async () => {
    await render();
    props.modal.deleting = true;
    flushSync();
    props.modal.deleting = false;
    await settle();
    expect(document.activeElement).toBe(trash());
  });
});

describe('ItemEditorModal — read-only versions (T3a, D6)', () => {
  it('published: Title stays editable and the footer is shown', async () => {
    await render({ version: { state: 'published' } });
    expect(titleInput()).not.toBeNull();
    expect(panel().querySelector('footer.modal-foot')).not.toBeNull();
  });

  it('archived: title as text, no footer, × focused, the preview renders', async () => {
    await render({ version: { state: 'archived' } });
    expect(panel().querySelector('input.plain-input')).toBeNull();
    expect(panel().querySelector('.ro-value')!.textContent).toBe('Eigenvalues');
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    expect(document.activeElement).toBe(closeBtn());
    expect(calls(/\/render$/, 'POST').length).toBe(1);
    expect(panel().querySelector('.ro-note')).toBeNull();
  });

  it('disabled page: the D6 note and the plain source, with zero /render and zero asset calls', async () => {
    await render({ version: { is_disabled: true } });
    expect(panel().querySelector('.ro-note')!.textContent).toBe(
      'Preview is unavailable while this version is disabled — enable it to preview or edit.');
    expect(panel().querySelector('[data-testid="markdown-plain"]')!.textContent).toBe('# Hi');
    expect(calls(/\/render$/, 'POST').length).toBe(0);
    expect(calls(/\/assets/).length).toBe(0);
    expect(document.activeElement).toBe(closeBtn());
  });

  it('disabled quiz: expanding a question makes zero /render calls', async () => {
    await render({ item: { type: 'quiz' }, version: { is_disabled: true } });
    panel().querySelector<HTMLButtonElement>('[data-testid="question-header"] button.expand')!.click();
    await settle();
    expect(panel().querySelectorAll('[data-testid="markdown-plain"]').length).toBe(2);
    expect(calls(/\/render$/, 'POST').length).toBe(0);
    expect(calls(/\/assets/).length).toBe(0);
  });
});

describe('ItemEditorModal — interim wiring (T3a → T4 / T5a)', () => {
  it('quiz: a question draft makes the item guard-dirty only; the footer stays clean', async () => {
    await render({ item: { type: 'quiz' } });
    expect(panel().querySelector('[data-testid="quiz-title"]')).toBeNull();  // showTitle={false}
    panel().querySelector<HTMLButtonElement>('[data-testid="question-header"] button.expand')!.click();
    await settle();
    type(panel().querySelector<HTMLTextAreaElement>('.question textarea')!, 'Edited');
    await settle();
    expect(anyDirty()).toBe('true');
    expect(dirtyText()).toBe('');
    expect(footBtn('Save').disabled).toBe(true);
  });

  it('quiz: the footer Save sends the title alone', async () => {
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'Quiz 2' }]);
    expect(dirtyText()).toBe('');
    expect(toastTexts()).toContain('Saved');
  });

  it('app: the script editor mounts without its own title on an enabled version', async () => {
    await render({ item: { type: 'interactive_app' } });
    expect(panel().querySelector('.app-editor')).not.toBeNull();
    expect(panel().querySelector('.app-editor h3')).toBeNull();
  });

  it('app: nothing is mounted or fetched on a disabled version', async () => {
    await render({ item: { type: 'interactive_app', script_url: 'app.js' }, version: { is_disabled: true } });
    expect(panel().querySelector('.app-editor')).toBeNull();
    expect(calls(/\/assets/).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts`
Expected: FAIL. The suite cannot resolve `../../components/editor/ItemEditorModal.svelte`.

- [ ] **Step 3: `lib/itemBody.ts`** (full content)

```ts
// The item-body contract (Slice-5b §2). ItemEditorModal owns the Title and the
// footer; each type body (PageBody, VideoBody, AppBody, QuizEditor) implements
// this API, exported from the component and reached via bind:this.
import { api, ApiError } from './api';
import { loadAdminTree } from '../stores/currentEditorVersion.svelte';
import { pushToast } from '../stores/toasts.svelte';

export type SaveOutcome = {
  outcome: 'ok' | 'partial' | 'failed';
  // The server's echo of the title, when this save sent it and that part succeeded.
  savedTitle?: string;
};

export type ItemBodyApi = {
  // Send everything dirty (the title too, when titleDraft is defined). Never throws.
  save(titleDraft: string | undefined): Promise<SaveOutcome>;
  // Reset save drafts only (footer Discard).
  discard(): void;
  // Reset save drafts AND collapse typed create forms (a confirmed close, D5).
  discardAll(): void;
  // D10: check only what this Save would send; show inline errors; focus the first.
  validate(): boolean;
};

// PATCH /api/items/{id} → ItemResponse (the fields the editor reads back).
export type ItemEcho = {
  id: number;
  title: string;
  content_md: string | null;
  video_url: string | null;
  script_url: string | null;
};

export const patchItem = (id: number, body: Record<string, unknown>) =>
  api.patch<ItemEcho>(`/api/items/${id}`, body);

// The failure half of every body's save: toast the server's message; on 403/409
// (the version changed state under us) force a tree reload so perms catch up.
export function reportSaveFailure(e: unknown, vid: number, stillOnVid: (v: number) => boolean): void {
  pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
  if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(vid)) {
    void loadAdminTree(vid, { force: true });
  }
}
```

- [ ] **Step 4: `components/editor/item/PageBody.svelte`** (full content)

```svelte
<script lang="ts">
  // Static-page body (3c): the markdown card. Implements ItemBodyApi (§2).
  import { onDestroy, untrack } from 'svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import { makeDirtyTracker } from '../../../lib/dirty.svelte';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../../lib/itemBody';
  import type { AdminTreeItem } from '../../../lib/types';
  import type { AssetContext } from '../../../lib/assetContext';

  let {
    item, vid, assetContext, editable, versionDisabled, frozen, stillOnVid,
    saveDirty = $bindable(false), guardDirty = $bindable(false), busy = $bindable(false),
  }: {
    item: AdminTreeItem; vid: number; assetContext: AssetContext; editable: boolean;
    versionDisabled: boolean; frozen: boolean; stillOnVid: (v: number) => boolean;
    saveDirty?: boolean; guardDirty?: boolean; busy?: boolean;
  } = $props();

  // Seeded once per mount ({#key item.id} upstream); tree reloads never re-seed.
  let saved = untrack(() => item.content_md ?? '');
  const tracker = makeDirtyTracker({ content_md: saved });
  let refreshKey = $state(0);
  let uploading = $state(false);
  let alive = true;
  onDestroy(() => { alive = false; });

  $effect(() => { saveDirty = tracker.isDirty; });
  $effect(() => { guardDirty = tracker.isDirty; });
  $effect(() => { busy = uploading; });

  export function validate(): boolean { return true; }
  export function discard(): void { tracker.reset({ content_md: saved }); }
  export function discardAll(): void { discard(); }

  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    const savedVid = vid;
    const body: Record<string, unknown> = {};
    if (titleDraft !== undefined) body.title = titleDraft;
    if (tracker.isDirty) body.content_md = tracker.current.content_md;
    if (Object.keys(body).length === 0) return { outcome: 'ok' };
    try {
      const echo = await patchItem(item.id, body);
      // D10 per-field write-back: inputs were frozen while the request was out.
      if (alive && 'content_md' in body) {
        saved = echo.content_md ?? '';
        tracker.reset({ content_md: saved });
        refreshKey++; // the sidebar's `used` badges follow the saved content
      }
      return { outcome: 'ok', savedTitle: 'title' in body ? echo.title : undefined };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }
</script>

{#if versionDisabled}
  <MarkdownEditor {assetContext} value={item.content_md ?? ''} plain />
{:else if !editable}
  <MarkdownEditor {assetContext} value={item.content_md ?? ''} readOnly />
{:else}
  <MarkdownEditor
    {assetContext}
    ariaLabel="Content"
    {frozen}
    bind:value={tracker.current.content_md}
    bind:refreshKey
    bind:uploading
  />
{/if}
```

- [ ] **Step 5: `components/editor/ItemEditorModal.svelte`** (full content)

```svelte
<script lang="ts">
  // The item editor (Slice-5b §2): one modal for page / video / quiz /
  // interactive-app items, hosted by VersionEditPage while the item is in the
  // URL (D1). It owns the Title field, the footer Save/Discard (+ ⌘S), the one
  // tracker registered in the page's dirty registry, and the D9 delete freeze.
  // The type body owns everything else through ItemBodyApi (lib/itemBody.ts).
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Button from '../ui/Button.svelte';
  import ItemMark from '../course/ItemMark.svelte';
  import PageBody from './item/PageBody.svelte';
  import QuizEditor from './QuizEditor.svelte';
  import InteractiveAppEditor from '../items/InteractiveAppEditor.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { structureReason } from '../../lib/editorReasons';
  import { courseAssetContext } from '../../lib/assetContext';
  import { patchItem, reportSaveFailure, type ItemBodyApi, type SaveOutcome } from '../../lib/itemBody';
  import { loadAdminTree, type LoadResult } from '../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { AdminTreeItem, AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';

  type Props = {
    vid: number;
    version: AdminTreeVersion;
    perms: VersionPermissions;
    seqIndex: number;
    item: AdminTreeItem;
    itemIndex: number;
    itemCount: number;
    stillOnVid: (savedVid: number) => boolean;
    onRequestClose: () => void;
    onDeleteItem: () => void;
    // D9: the page's DELETE for THIS item is in flight.
    deleting?: boolean;
  };
  let {
    vid, version, perms, seqIndex, item, itemIndex, itemCount,
    stillOnVid, onRequestClose, onDeleteItem, deleting = false,
  }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-name`;
  const titleErrId = `${uid}-title-err`;

  const TYPE_WORDS: Record<AdminTreeItem['type'], string> = {
    static_page: 'static page', video: 'video', quiz: 'quiz', interactive_app: 'interactive app',
  };

  const versionDisabled = $derived(version.is_disabled);
  const canEditText = $derived(perms.canEditTextFields);
  // Memoised per vid (as ItemEditPage did): bodies compare it by identity.
  const assetContext = $derived(courseAssetContext(vid));

  // ---- Title draft. Seeded once per mount ({#key item.id} upstream); a tree
  //      reload never re-seeds. `savedTitle` is the last server echo. ----
  let savedTitle = untrack(() => item.title);
  const titleTracker = makeDirtyTracker({ title: savedTitle });
  const titleDirty = $derived(titleTracker.isDirty);
  let titleError = $state<string | null>(null);
  let titleEl = $state<HTMLInputElement>();

  // ---- The type body (§2 contract). Quiz and app have none until T5a / T4. ----
  let body = $state<ItemBodyApi | null>(null);
  let bodySaveDirty = $state(false);
  let bodyGuardDirty = $state(false);
  let bodyBusy = $state(false);

  let saving = $state(false);
  const frozen = $derived(saving || deleting);
  const saveDirty = $derived(titleDirty || bodySaveDirty);    // footer, Save, Discard
  const guardDirty = $derived(titleDirty || bodyGuardDirty);  // the prompt, D9's delete gate
  const saveBlocked = $derived(!canEditText || !saveDirty || frozen || bodyBusy);

  let alive = true;
  onDestroy(() => { alive = false; });

  // ---- One tracker in the page registry (D5): the page's DirtyGuard prompts
  //      on ×, Escape, Back and every in-app navigation. ----
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const pageTracker: RegisteredTracker = {
    get isDirty() { return guardDirty; },
    discard() { resetTitle(); body?.discardAll(); },
  };
  $effect(() => {
    if (!registry) return;
    registry.register(pageTracker);
    return () => registry.unregister(pageTracker);
  });

  function resetTitle() {
    titleTracker.reset({ title: savedTitle });
    titleError = null;
  }

  function validateTitle(): boolean {
    titleError = titleDirty && titleTracker.current.title.trim() === '' ? 'Title is required' : null;
    return titleError === null;
  }

  // Interim (quiz until T5a, app until T4): no body API, so the modal sends the title.
  async function saveTitleOnly(titleDraft: string | undefined): Promise<SaveOutcome> {
    if (titleDraft === undefined) return { outcome: 'ok' };
    const savedVid = vid;
    try {
      const echo = await patchItem(item.id, { title: titleDraft });
      return { outcome: 'ok', savedTitle: echo.title };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }

  async function save() {
    if (saveBlocked) return;
    // R9: the body validates first (and focuses its first invalid field); an
    // invalid Title then takes focus, because it is first on screen.
    const bodyOk = body ? body.validate() : true;
    const titleOk = validateTitle();
    if (!titleOk) titleEl?.focus();
    if (!bodyOk || !titleOk) {
      pushToast('Fix the highlighted fields', 'error');
      return;
    }
    const savedVid = vid;
    const titleDraft = titleDirty ? titleTracker.current.title : undefined;
    saving = true;
    try {
      const res = body ? await body.save(titleDraft) : await saveTitleOnly(titleDraft);
      if (alive && res.savedTitle !== undefined) {
        savedTitle = res.savedTitle;
        titleTracker.reset({ title: res.savedTitle });
      }
      if (res.outcome === 'failed') return;
      // D10: any success reloads the tree (header, item rows, `used` badges);
      // inputs stay frozen until it settles. Baselines came from the PATCH
      // echoes — nothing is re-seeded from the fresh tree.
      let refresh: LoadResult = 'discarded';
      if (stillOnVid(savedVid)) refresh = await loadAdminTree(savedVid, { force: true });
      // 'discarded' = the PATCH landed, only the refetch was superseded → "Saved".
      // A partial outcome's message was already toasted by the body.
      if (res.outcome === 'ok') {
        if (refresh === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
        else pushToast('Saved', 'success');
      }
    } finally {
      if (alive) saving = false;
    }
  }

  function discard() {
    if (frozen || bodyBusy) return;
    resetTitle();
    body?.discard();
  }

  // ⌘S / Ctrl+S inside this dialog only (D10). Default-prevented even when
  // blocked, so the browser's own Save dialog never opens over the editor.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element) || !e.target.closest('section.modal-panel')) return;
    e.preventDefault();
    void save();
  }

  // ---- D9: the header trash. The page owns the delete flow. ----
  const structReason = $derived(structureReason(version));
  const trashTitle = $derived(
    structReason ?? (guardDirty ? 'Delete this item — save or discard changes first' : 'Delete this item'),
  );
  const trashDisabled = $derived(!!structReason || guardDirty || bodyBusy || frozen);
  let trashEl = $state<HTMLButtonElement>();
  // A failed DELETE un-freezes the modal: focus goes back to the trash, or to ×
  // if the trash is still disabled (the disabled trash had dropped it to body).
  let wasDeleting = untrack(() => deleting);
  $effect(() => {
    const now = deleting;
    if (wasDeleting && !now) {
      void tick().then(() => {
        if (!alive || !trashEl) return;
        const next = !trashEl.disabled
          ? trashEl
          : trashEl.closest('section.modal-panel')
              ?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]');
        next?.focus();
      });
    }
    wasDeleting = now;
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet head()}
  <span class="mark-slot"><ItemMark type={item.type} state="covered" /></span>
  <h2 id={labelId} class="item-name">{item.title}</h2>
  <span class="mono item-ctx">{TYPE_WORDS[item.type]} · S{seqIndex} · item {itemIndex} of {itemCount}</span>
  <span class="head-actions">
    <IconButton
      glyph="trash"
      size="sm"
      danger
      title={trashTitle}
      aria-label="Delete item"
      disabled={trashDisabled}
      bind:element={trashEl}
      onclick={onDeleteItem}
    />
  </span>
{/snippet}

{#snippet foot()}
  <span class="dirty mono">{saveDirty ? 'unsaved changes' : ''}</span>
  <Button
    variant="ghost"
    disabled={!saveDirty || frozen || bodyBusy}
    title={saveDirty ? undefined : 'No changes to discard'}
    onclick={discard}
  >Discard</Button>
  <Button
    variant="primary"
    disabled={saveBlocked}
    title={saveDirty ? undefined : 'No changes to save'}
    loading={saving}
    onclick={() => void save()}
  >Save</Button>
{/snippet}

<Modal
  labelledby={labelId}
  {onRequestClose}
  closeDisabled={deleting}
  bodyInert={deleting}
  header={head}
  footer={canEditText ? foot : undefined}
>
  <div class="field-row">
    <span class="field-label">Title</span>
    {#if canEditText}
      <div class="field">
        <input
          bind:this={titleEl}
          class="plain-input"
          type="text"
          aria-label="Title"
          maxlength="200"
          required
          data-autofocus
          readonly={frozen}
          aria-invalid={titleError ? 'true' : undefined}
          aria-describedby={titleError ? titleErrId : undefined}
          bind:value={titleTracker.current.title}
          oninput={() => { if (titleError) titleError = null; }}
        />
        {#if titleError}<p class="field-err" id={titleErrId}>{titleError}</p>{/if}
      </div>
    {:else}
      <span class="ro-value">{item.title}</span>
    {/if}
  </div>

  {#if versionDisabled}
    <p class="ro-note">Preview is unavailable while this version is disabled — enable it to preview or edit.</p>
  {/if}

  {#if item.type === 'static_page'}
    <PageBody
      bind:this={body}
      {item}
      {vid}
      {assetContext}
      editable={canEditText}
      {versionDisabled}
      {frozen}
      {stillOnVid}
      bind:saveDirty={bodySaveDirty}
      bind:guardDirty={bodyGuardDirty}
      bind:busy={bodyBusy}
    />
  {:else if item.type === 'quiz'}
    <!-- Interim until T5a: today's editor; question drafts feed guardDirty only. -->
    <QuizEditor
      itemId={item.id}
      {vid}
      itemTitle={item.title}
      {version}
      {perms}
      {assetContext}
      showTitle={false}
      {versionDisabled}
      bind:quizDirty={bodyGuardDirty}
    />
  {:else if item.type === 'interactive_app'}
    <!-- Interim until T4. Not on a disabled version: its script fetch would 403. -->
    {#if !versionDisabled}
      <InteractiveAppEditor
        {item}
        versionId={vid}
        editable={canEditText}
        showTitle={false}
        bind:uploadBusy={bodyBusy}
      />
    {/if}
  {:else}
    <p class="muted">This item type can't be edited here.</p>
  {/if}
</Modal>

<style>
  .mark-slot { display: flex; /* (c): ItemMark takes no class (Constraint 7) */ }
  .item-name {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 600;
    color: var(--text); /* ref 1687 */
  }
  .item-ctx { font-size: 11.5px; color: var(--muted); white-space: nowrap; /* ref 1688 */ }
  .head-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; /* ref 1689 */ }
  .field-row {
    display: grid;
    grid-template-columns: 132px 1fr; /* ref 1696 — D2 drops the 54px pencil slot */
    align-items: center;
    gap: 12px;
  }
  .field-label { font-size: 12.5px; color: var(--muted); /* ref 1697 */ }
  .field { display: flex; flex-direction: column; gap: 4px; /* the 4px step */ min-width: 0; }
  /* D12: the 5a create-form input on the dense-control tokens. */
  .plain-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .plain-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft); /* D12 — InlineField's open editor */
  }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  .ro-value { font-size: 13px; color: var(--text); overflow-wrap: anywhere; /* ref 1698 */ }
  /* D6: the page banner's information form (VersionEditPage .banner). */
  .ro-note {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 13px;
    color: var(--text);
  }
  .muted { margin: 0; font-size: 13px; color: var(--muted); }
  .dirty { flex: 1; font-size: 11.5px; color: var(--status-needs-revision-fg); /* ref 1751 */ }
</style>
```

- [ ] **Step 6: Interim props on `QuizEditor`, `QuestionAccordion`, `InteractiveAppEditor`**

`QuizEditor.svelte` — replace:
```ts
    itemId, vid, itemTitle, version, perms, assetContext, quizDirty = $bindable(false),
  }: {
    itemId: number; vid: number; itemTitle: string;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    quizDirty?: boolean;
  } = $props();
```
with:
```ts
    itemId, vid, itemTitle, version, perms, assetContext, quizDirty = $bindable(false),
    showTitle = true, versionDisabled = false,
  }: {
    itemId: number; vid: number; itemTitle: string;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    quizDirty?: boolean;
    // Slice-5b interim (T3a → T5a): the item modal owns the Title row.
    showTitle?: boolean;
    // Slice-5b D6: question editors show plain source, with no /render call.
    versionDisabled?: boolean;
  } = $props();
```
In the template, wrap the whole `<div class="title-row"> … </div>` block in `{#if showTitle} … {/if}`. Then in the `<QuestionAccordion` call, after `{assetContext}`, add the line `{versionDisabled}`.

`QuestionAccordion.svelte` — replace:
```ts
    question, vid, index, count, perms, assetContext, expanded, locked, confirmKeyChange,
    onExpandToggle, onDelete, onMoveUp, onMoveDown,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
```
with:
```ts
    question, vid, index, count, perms, assetContext, expanded, locked, confirmKeyChange,
    onExpandToggle, onDelete, onMoveUp, onMoveDown, versionDisabled = false,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    // Slice-5b D6: plain source, no /render (a disabled version's /render is a 403).
    versionDisabled?: boolean;
```
In the template, add `plain={versionDisabled}` to both `<MarkdownEditor {assetContext} readOnly={!editable} disabled={textLocked} …>` tags, right after `{assetContext}`.

`InteractiveAppEditor.svelte` — replace:
```ts
  let { item, versionId, editable }: {
    item: AdminTreeItem | undefined; versionId: number; editable: boolean;
  } = $props();
```
with:
```ts
  let { item, versionId, editable, showTitle = true, uploadBusy = $bindable(false) }: {
    item: AdminTreeItem | undefined; versionId: number; editable: boolean;
    // Slice-5b interim (T3a → T4): the item modal owns the Title row, and
    // folds uploadBusy into its Save interlock (D10).
    showTitle?: boolean;
    uploadBusy?: boolean;
  } = $props();
```
Delete the line `  let uploadBusy = $state(false);`. Then replace `    <h3>{item.title}</h3>` with `    {#if showTitle}<h3>{item.title}</h3>{/if}`.

- [ ] **Step 7: `VersionEditPage.svelte` — the dead branch that puts the modal in the bundle**

Add to the imports, after `import VersionBadges …`:
```ts
  import ItemEditorModal from '../../components/editor/ItemEditorModal.svelte';
```
Replace `  import type { RegisteredTracker } from '../../lib/dirtyRegistry.svelte';` with:
```ts
  import type { RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import type { AdminTreeItem } from '../../lib/types';
```
After `let lastFocusedTarget = $state<string | null>(null);`'s whole focus `$effect` block (just before `let alive = true;`), insert:
```ts
  // Slice-5b T3a: always null until T3b routes items here (deriveExpansion).
  // $state, not a const: a `const … = null` narrows to `never` in the template.
  let expandedItem = $state<AdminTreeItem | null>(null);
```
In the template, insert right before `    <DirtyGuard isDirty=…`:
```svelte
    {#if expandedItem}
      {@const it = expandedItem}
      {@const hostBlock = tree.blocks.find((b) => b.sequences.some((s) => s.id === it.sequence_id))}
      {@const hostSeq = hostBlock?.sequences.find((s) => s.id === it.sequence_id)}
      {#if hostBlock && hostSeq}
        {#key it.id}
          <ItemEditorModal
            {vid}
            version={v}
            {perms}
            seqIndex={hostBlock.sequences.indexOf(hostSeq) + 1}
            item={it}
            itemIndex={hostSeq.items.findIndex((x) => x.id === it.id) + 1}
            itemCount={hostSeq.items.length}
            {stillOnVid}
            onRequestClose={() => (expandedItem = null)}
            onDeleteItem={() => {}}
          />
        {/key}
      {/if}
    {/if}
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts src/tests/QuizEditor.svelte.test.ts src/tests/QuestionAccordion.svelte.test.ts src/tests/InteractiveAppEditor.svelte.test.ts src/tests/VersionEditPage.svelte.test.ts`
Expected: PASS. `ItemEditorModal` has 25 tests; the others are unchanged and green (all the new props default to today's behaviour).

- [ ] **Step 9: Gate sections (aa) Modal and (ac) ItemEditorModal**

First build, then read the emitted rules and pin those spellings:
`npm run build >/dev/null && grep -oE '\.modal-(backdrop|panel|head|body|foot)\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`

Insert after section (ab):

```zsh
echo
echo "--- (aa) Slice-5b T1/T3a — ui/Modal ---"
# Anchored on .modal-panel: three run modals also author .modal-backdrop (R8).
own modal-panel Modal.svelte
uniq1 modal-panel
if [[ -n $REPLY ]]; then
  N=Modal; H=$REPLY
  d '\.modal-backdrop' '' 'position:fixed' 'top:0' 'right:0' 'bottom:0' 'left:0' 'z-index:100' 'display:flex' 'justify-content:center' 'align-items:flex-start' 'padding-top:26px' 'background:color-mix\(in srgb,var\(--text\) 34%,transparent\)' 'backdrop-filter:blur\(1px\)'
  d '\.modal-panel' '' 'width:min\(var\(--modal-w\),100vw - 32px\)' 'max-height:min\(var\(--modal-h\),100vh - 52px\)' 'display:flex' 'flex-direction:column' 'overflow:hidden' 'background:var\(--surface\)' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius-lg\)' 'box-shadow:0 16px 44px #14182338'
  d '\.modal-head' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:12px 14px 12px 16px' 'border-bottom:1px solid var\(--border\)'
  d '\.modal-body' '' 'flex:1 1 auto' 'min-height:0' 'overflow:auto' 'padding:14px 16px' 'display:flex' 'flex-direction:column' 'gap:12px'
  check "Modal .modal-body > * { flex:0 0 auto }" "\.modal-body\.${H}>\*\{flex:0 0 auto\}"
  d '\.modal-foot' '' 'display:flex' 'align-items:center' 'gap:9px' 'padding:12px 16px' 'border-top:1px solid var\(--border\)' 'background:var\(--surface-3\)'
  # Constraint 11: the ref-1684 shadow is the ONE hex allowed in Modal's rules.
  modal_rules=$(grep -oE "[^{}]*\.${H}[^{]*\{[^}]*\}" $CSS)
  if print -r -- "$modal_rules" | sed 's/box-shadow:0 16px 44px #14182338//g' | grep -qE '#[0-9a-fA-F]{3}'; then
    echo "FAIL  Modal no hex beyond the ref-1684 shadow"; fail=1
  else
    echo "PASS  Modal no hex beyond the ref-1684 shadow"
  fi
  none "Modal no opacity dim"      "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*opacity:0?\.[0-9]"
  none "Modal no rem font sizes"   "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  none "Modal backdrop is not a flat rgba scrim" "\.modal-backdrop\.${H}\{[^}]*background:rgba"
fi
emoji_scan "Modal" src/components/ui/Modal.svelte

echo
echo "--- (ac) Slice-5b T3a — ItemEditorModal (3c header, Title row, footer) ---"
own item-ctx ItemEditorModal.svelte
uniq1 item-ctx
if [[ -n $REPLY ]]; then
  N=ItemEditorModal; H=$REPLY
  d '\.item-name' '' 'margin:0' 'font-size:15px' 'font-weight:600' 'color:var\(--text\)' 'text-overflow:ellipsis'
  d '\.item-ctx' '' 'font-size:11\.5px' 'color:var\(--muted\)' 'white-space:nowrap'
  d '\.head-actions' '' 'margin-left:auto' 'display:flex' 'gap:6px'
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:center' 'gap:12px'
  d '\.field-label' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:var\(--control-font\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  chk "\.plain-input\[aria-invalid=\"?true\"?\]\.${H}" 'border:1\.5px solid var\(--danger\)'
  d '\.field-err' '' 'margin:0' 'font-size:12px' 'color:var\(--danger\)'
  d '\.ro-value' '' 'font-size:13px' 'color:var\(--text\)'
  d '\.ro-note' '' 'margin:0' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:13px' 'color:var\(--text\)'
  d '\.dirty' '' 'flex:1' 'font-size:11\.5px' 'color:var\(--status-needs-revision-fg\)'
  none "ItemEditorModal Title row has no 54px pencil slot (D2)" "\.field-row\.${H}\{[^}]*54px"
  none "ItemEditorModal input padding is the token, not the 5a literal" "\.plain-input\.${H}\{[^}]*padding:0 10px"
  none "ItemEditorModal dirty marker is not --gold-text" "\.dirty\.${H}\{[^}]*--gold-text"
  none "ItemEditorModal no rem font sizes" "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep ItemEditorModal $H
fi
emoji_scan "ItemEditorModal / PageBody / itemBody" src/components/editor/ItemEditorModal.svelte src/components/editor/item/PageBody.svelte src/lib/itemBody.ts
```

Run the gate. The only FAIL is the count; set `EXPECTED_CHECKS` to the printed N and re-run.
Expected: `VISUAL-REFRESH GATE: ALL PASS (N checks)`.

**Mutation-test** (Constraint 12). For each, mutate, re-run, check that the named check goes red, then revert:
- `Modal .modal-panel` box-shadow alpha `.22` → `.3` → the `box-shadow` pin FAILs;
- `Modal .modal-foot` `background: var(--surface-3)` → `#fcfcfd` → the pin **and** "no hex beyond the shadow" FAIL;
- `ItemEditorModal .field-row` `132px 1fr` → `132px 1fr 54px` → the pin and the D2 negative FAIL;
- `ItemEditorModal .dirty` `--status-needs-revision-fg` → `--gold-text` → the pin and the negative FAIL.

- [ ] **Step 10: Full verification**

Run: `npm test 2>&1 | tail -4`, then `npm run check 2>&1 | tail -1`, then `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.
Expected:
- tests: 136 files, 1634 tests (1609 + 25), all pass;
- check: `0 ERRORS`, warnings ≤ 18;
- gate: `ALL PASS`.

- [ ] **Step 11: Review** (both lanes, uncommitted diff; Review Focus 4 and 5), then wait for the user's OK.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/lib/itemBody.ts frontend/src/components/editor/ItemEditorModal.svelte frontend/src/components/editor/item/PageBody.svelte frontend/src/tests/support/ItemEditorModalHarness.svelte frontend/src/tests/ItemEditorModal.svelte.test.ts frontend/src/components/editor/QuizEditor.svelte frontend/src/components/editor/QuestionAccordion.svelte frontend/src/components/items/InteractiveAppEditor.svelte frontend/src/pages/editor/VersionEditPage.svelte frontend/scripts/visual-refresh-gate.sh
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5b T3a — ItemEditorModal + PageBody, interim quiz/app wiring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3c: `VideoBody` — Video URL field, validation, normalise-on-save

**What this task builds.** The video body's logic (§4), so a video item has a working body before T3b routes items into the modal (R1).
- **Field:** a Video URL `.field-row` with a mono D12 input and the hint "Paste any YouTube or Vimeo URL — it is converted to embed form on save."
- **Validation:** a dirty, empty URL blocks Save with "Video URL is required" and takes focus.
- **Save:** sends `PATCH {title?, video_url: normalizeVideoUrl(url)}` and writes the echo back. A pasted watch URL therefore comes back in embed form and the form is clean (Review Focus 2).
- **Read-only:** the URL is shown as mono text.
- **Preview:** a plain `VideoFrame`, fed by a 500ms debounce of `safeIframeUrl(normalizeVideoUrl(url))`, with the initial value applied immediately. T4 puts it in the 3e card.
- **No gate section here:** T4's (ad) pins VideoBody once its final CSS lands.

**Files:**
- Create: `frontend/src/components/editor/item/VideoBody.svelte`
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte`, `frontend/src/tests/ItemEditorModal.svelte.test.ts`

**Interfaces:**
- Consumes: the T3a body contract, `patchItem`, `reportSaveFailure`, `normalizeVideoUrl`, `safeIframeUrl`, `VideoFrame` (`src`, `title`).
- Produces: `VideoBody` with props `item, vid, editable, frozen, stillOnVid`, bindable `saveDirty` / `guardDirty`, and exported `save` / `discard` / `discardAll` / `validate`. It has no `busy` (nothing uploads). DOM hooks: `input.plain-input[aria-label="Video URL"]`, `.field-err`, `.field-hint`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/tests/ItemEditorModal.svelte.test.ts`:

```ts
describe('ItemEditorModal — video body (T3c)', () => {
  const WATCH = 'https://www.youtube.com/watch?v=abc123';
  const EMBED = 'https://www.youtube.com/embed/abc123';
  const urlInput = () => panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!;

  it('shows the Video URL field with its hint; editing marks the footer dirty', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    expect(panel().querySelector('.item-ctx')!.textContent).toBe('video · S2 · item 3 of 4');
    expect(urlInput().value).toBe(EMBED);
    expect(urlInput().classList.contains('mono')).toBe(true);
    expect(panel().querySelector('.field-hint')!.textContent).toBe(
      'Paste any YouTube or Vimeo URL — it is converted to embed form on save.');
    type(urlInput(), WATCH);
    expect(dirtyText()).toBe('unsaved changes');
  });

  it('a pasted watch URL is sent in embed form and the echo leaves the form clean', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), `  ${WATCH.replace('abc123', 'xyz789')}  `);
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ video_url: 'https://www.youtube.com/embed/xyz789' }]);
    expect(urlInput().value).toBe('https://www.youtube.com/embed/xyz789');
    expect(dirtyText()).toBe('');
    expect(toastTexts()).toContain('Saved');
  });

  it('an empty URL blocks Save with "Video URL is required" and focuses the field', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), '  ');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([]);
    expect(urlInput().getAttribute('aria-invalid')).toBe('true');
    expect(panel().querySelector('.field-err')!.textContent).toBe('Video URL is required');
    expect(document.activeElement).toBe(urlInput());
  });

  it('a title-only change sends no video_url', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(titleInput(), 'Lecture 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'Lecture 2' }]);
  });

  it('Discard restores the saved URL and clears the error', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), '');
    footBtn('Save').click();
    await settle();
    footBtn('Discard').click();
    flushSync();
    expect(urlInput().value).toBe(EMBED);
    expect(panel().querySelector('.field-err')).toBeNull();
  });

  it('archived: the URL is mono text and the preview still shows', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED }, version: { state: 'archived' } });
    expect(urlInput()).toBeNull();
    const ro = panel().querySelector('.ro-value.mono')!;
    expect(ro.textContent).toBe(EMBED);
    expect(panel().querySelector('iframe')!.getAttribute('src')).toBe(EMBED);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts`
Expected: FAIL in `video body (T3c)`. The modal renders "This item type can't be edited here." for video, so `urlInput()` is null.

- [ ] **Step 3: `components/editor/item/VideoBody.svelte`** (full content)

```svelte
<script lang="ts">
  // Video body (3e). Implements ItemBodyApi (§2). The URL is normalised to its
  // iframe-embed form on save (the student player iframes it verbatim) and the
  // server's echo is written back, so a pasted watch URL saves clean (D10).
  import { onDestroy, untrack } from 'svelte';
  import VideoFrame from '../../items/VideoFrame.svelte';
  import { makeDirtyTracker } from '../../../lib/dirty.svelte';
  import { normalizeVideoUrl } from '../../../lib/normalizeVideoUrl';
  import { safeIframeUrl } from '../../../lib/safeIframeUrl';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../../lib/itemBody';
  import type { AdminTreeItem } from '../../../lib/types';

  let {
    item, vid, editable, frozen, stillOnVid,
    saveDirty = $bindable(false), guardDirty = $bindable(false),
  }: {
    item: AdminTreeItem; vid: number; editable: boolean; frozen: boolean;
    stillOnVid: (v: number) => boolean;
    saveDirty?: boolean; guardDirty?: boolean;
  } = $props();

  const uid = $props.id();
  const hintId = `${uid}-hint`;
  const errId = `${uid}-err`;

  // Seeded once per mount ({#key item.id} upstream); tree reloads never re-seed.
  let saved = untrack(() => item.video_url ?? '');
  const tracker = makeDirtyTracker({ video_url: saved });
  let urlError = $state<string | null>(null);
  let urlEl = $state<HTMLInputElement>();
  let alive = true;
  onDestroy(() => { alive = false; });

  $effect(() => { saveDirty = tracker.isDirty; });
  $effect(() => { guardDirty = tracker.isDirty; });

  // Live preview: 500ms after the last keystroke (re-rendering the iframe per
  // keystroke would thrash the player). The initial value shows at once.
  let previewUrl = $state<string | null>(untrack(() => safeIframeUrl(normalizeVideoUrl(saved))));
  $effect(() => {
    const raw = tracker.current.video_url;
    const handle = setTimeout(() => { previewUrl = safeIframeUrl(normalizeVideoUrl(raw)); }, 500);
    return () => clearTimeout(handle);
  });

  export function validate(): boolean {
    // D10: only what this Save would send. The server requires a non-empty URL.
    urlError = tracker.isDirty && tracker.current.video_url.trim() === '' ? 'Video URL is required' : null;
    if (urlError) urlEl?.focus();
    return urlError === null;
  }
  export function discard(): void {
    tracker.reset({ video_url: saved });
    urlError = null;
  }
  export function discardAll(): void { discard(); }

  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    const savedVid = vid;
    const body: Record<string, unknown> = {};
    if (titleDraft !== undefined) body.title = titleDraft;
    if (tracker.isDirty) body.video_url = normalizeVideoUrl(tracker.current.video_url);
    if (Object.keys(body).length === 0) return { outcome: 'ok' };
    try {
      const echo = await patchItem(item.id, body);
      if (alive && 'video_url' in body) {
        saved = echo.video_url ?? '';
        tracker.reset({ video_url: saved });
      }
      return { outcome: 'ok', savedTitle: 'title' in body ? echo.title : undefined };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }
</script>

<div class="field-row">
  <span class="field-label">Video URL</span>
  {#if editable}
    <div class="field">
      <input
        bind:this={urlEl}
        class="plain-input mono"
        type="url"
        aria-label="Video URL"
        required
        placeholder="https://…"
        readonly={frozen}
        aria-invalid={urlError ? 'true' : undefined}
        aria-describedby={urlError ? `${errId} ${hintId}` : hintId}
        bind:value={tracker.current.video_url}
        oninput={() => { if (urlError) urlError = null; }}
      />
      {#if urlError}<p class="field-err" id={errId}>{urlError}</p>{/if}
      <p class="field-hint" id={hintId}>Paste any YouTube or Vimeo URL — it is converted to embed form on save.</p>
    </div>
  {:else}
    <span class="ro-value mono">{item.video_url || 'No video URL'}</span>
  {/if}
</div>

{#if previewUrl}
  <VideoFrame src={previewUrl} title={item.title || 'Video preview'} />
{/if}

<style>
  .field-row {
    display: grid;
    grid-template-columns: 132px 1fr; /* ref 1808 — D2 drops the 54px pencil slot */
    align-items: center;
    gap: 12px;
  }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 4px; /* the 4px step */ min-width: 0; }
  /* D12, as ItemEditorModal's Title input; the URL is mono (global .mono). */
  .plain-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .plain-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); }
  .field-hint { margin: 0; font-size: 12px; color: var(--muted); /* §4 */ }
  .ro-value { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
</style>
```

- [ ] **Step 4: Wire it into `ItemEditorModal.svelte`**

Add the import after `import PageBody …`:
```ts
  import VideoBody from './item/VideoBody.svelte';
```
Replace the comment `  // ---- The type body (§2 contract). Quiz and app have none until T5a / T4. ----` with:
```ts
  // ---- The type body (§2 contract). Quiz and app have none until T5a / T4;
  //      VideoBody has no `busy` (nothing in it uploads). ----
```
In the template, insert between the `PageBody` branch and `{:else if item.type === 'quiz'}`:
```svelte
  {:else if item.type === 'video'}
    <VideoBody
      bind:this={body}
      {item}
      {vid}
      editable={canEditText}
      {frozen}
      {stillOnVid}
      bind:saveDirty={bodySaveDirty}
      bind:guardDirty={bodyGuardDirty}
    />
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts`
Expected: PASS, 31 tests (25 + 6).

- [ ] **Step 6: Full verification**

Run: `npm test 2>&1 | tail -4`, `npm run check 2>&1 | tail -1`, `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.
Expected:
- tests: 136 files, 1640 tests, all pass;
- check: 0 errors, warnings ≤ 18;
- gate: `ALL PASS` with the count unchanged.

The (ac) `sweep` and `own` still pass: VideoBody's rules carry its own hash, and `.item-ctx` stays modal-only.

- [ ] **Step 7: Review** (both lanes, uncommitted diff; Review Focus 2), then wait for the user's OK.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/editor/item/VideoBody.svelte frontend/src/components/editor/ItemEditorModal.svelte frontend/src/tests/ItemEditorModal.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5b T3c — VideoBody (URL field, validation, normalise-on-save)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3b: Route items into `VersionEditPage` — close, delete, focus, stale item; delete `ItemEditPage`

**What this task builds.** The item URL is served by `VersionEditPage`, which shows `ItemEditorModal` over the page (D1). Because the page instance never swaps, the 5a Back-freeze cannot happen.
- **Close (D7):**
  - × and Escape call `requestCloseItem()`. That is `history.back()` when the item was opened in this page instance, otherwise `navigate(seqUrl, { replace: true })`.
  - A `closing` latch makes a double ×, Escape-then-× and auto-repeat one close.
  - A `popstate` listener, and a cancelled `navigate`, re-arm it.
- **Delete (D9):**
  - Page-owned `deleteOpenItem()` asks one confirm, then freezes the modal (`deletingIid`) while the DELETE runs.
  - On success it closes with `navigate(seqUrl, { replace: true, force: true })` and never `history.back()`. It then awaits a tick so the modal unmounts, reloads, toasts "Item deleted" and focuses the sequence header.
  - On failure it toasts, reloads and unfreezes; the modal refocuses its trash.
- **Focus (D18):**
  - The item-route effect records `lastClosedIid` and a one-shot `justClosedItem`.
  - After a close, the focus effect leaves FocusTrap's restore alone. Only when focus fell to `body` does it focus `#item-{id}-open`, or else the sequence header.
  - The effect does nothing while an item is open.
- **Stale item (D19):** "Item not found." plus a replace to the sequence URL, with the D9 `deletedIid` exception.
- **Route and file changes:**
  - `routes.ts` maps the item route to `VersionEditPage`; `App.svelte` drops `ItemEditPage`.
  - `ItemEditPage` and its two tests and harness are deleted; their app cases are ported to `ItemEditorModal` tests.
  - `ItemRow` gets the pencil id.
  - The store comment states the D22 contract.
- **Back-freeze test:** a new App-level test drives the real router through `App.svelte`. It is written **first**, run against today's routing, and mutation-proved after the switch.

**Files:**
- Create: `frontend/src/tests/App.editorRoutes.svelte.test.ts`
- Modify:
  - `frontend/src/lib/deriveExpansion.ts`
  - `frontend/src/lib/handleStaleIdFallback.ts`
  - `frontend/src/pages/editor/VersionEditPage.svelte`
  - `frontend/src/components/editor/ItemRow.svelte`
  - `frontend/src/routes.ts`
  - `frontend/src/App.svelte`
  - `frontend/src/stores/currentEditorVersion.svelte.ts`
  - `frontend/src/tests/deriveExpansion.test.ts`
  - `frontend/src/tests/handleStaleIdFallback.test.ts`
  - `frontend/src/tests/VersionEditPage.svelte.test.ts`
  - `frontend/src/tests/router.test.ts`
  - `frontend/src/tests/ItemEditorModal.svelte.test.ts`
- Delete:
  - `frontend/src/pages/editor/ItemEditPage.svelte`
  - `frontend/src/tests/ItemEditPage.interactive.svelte.test.ts`
  - `frontend/src/tests/ItemEditPage.refreshKey.svelte.test.ts`
  - `frontend/src/tests/ItemEditPage.refreshKey.harness.svelte`

**Interfaces:**
- Consumes: `ItemEditorModal` (T3a props, incl. `deleting`, `onDeleteItem`, `onRequestClose`); `navigate(path, { replace, force })` (synchronous up to `pushState` when `force`); the router's popstate guard behaviour (a rejected Back is restored by `pushState`, which fires no popstate).
- Produces:
  - `deriveExpansion(bid, sid, tree, iid = null)` → `Expansion` gains `expandedItem: AdminTreeItem | null` and `staleIid: boolean`;
  - `StaleFlags` gains `staleIid?: boolean`;
  - `StaleContext` gains `sid?: string | null; iid?: string | null; deletedIid?: number | null`;
  - `VersionEditPage` prop `itemId?: string`;
  - `ItemRow`'s Open button has `id="item-{id}-open"`.

- [ ] **Step 1: Write the App-level Back-freeze test FIRST, against today's routing**

File `frontend/src/tests/App.editorRoutes.svelte.test.ts` (full content):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import App from '../App.svelte';
import { session } from '../stores/session.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
import { clearToasts } from '../stores/toasts.svelte';
import type { AdminTree, AdminTreeItem } from '../lib/types';

// Slice-5b T3b: the 5a Back-freeze (open item → Back → the editor never
// recovers) through the REAL App + router + store. Only fetch is stubbed.
vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
  getAuthConfig: vi.fn(async () => ({ send_pin_enabled: true })),
  bootstrapSession: vi.fn(async () => {}),
  requestPin: vi.fn(async () => {}),
  verifyPin: vi.fn(async () => ({})),
}));
Element.prototype.scrollIntoView = () => {};

const SEQ = '/courses/c/edit/v/1/blocks/10/sequences/20';
const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
const jres = (body: unknown, status = 200) => Promise.resolve({
  ok: status < 400, status, statusText: 'x',
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(''),
  headers: new Headers({ 'content-type': 'application/json' }),
} as unknown as Response);
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
// jsdom fires popstate for history.back() asynchronously.
async function waitPop() { await new Promise((r) => setTimeout(r, 0)); await settle(); await settle(); }

function mkItem(id: number, over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id, sequence_id: 20, title: `Item ${id}`, slug: `i${id}`, order: id, type: 'static_page',
    content_md: `body ${id}`, content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  };
}
let tree: AdminTree;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
let errors: unknown[] = [];
const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); };
const onRejection = (e: PromiseRejectionEvent) => { errors.push(e.reason); };

beforeEach(async () => {
  __resetGuardsForTests();
  tree = {
    course: { id: 1, name: 'C', slug: 'c' },
    version: {
      id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
      max_quiz_attempts: 3, label: '', created_at: '2026-01-01T00:00:00Z',
      published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z',
    },
    blocks: [{
      id: 10, version_id: 1, title: 'Block 10', slug: 'b10', order: 1, info: '', info_html: '',
      sequences: [{ id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [mkItem(30), mkItem(31)] }],
    }],
  };
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/admin-tree')) return jres(structuredClone(tree));
    if (u === '/api/sequences/20/items' && init?.method === 'POST') {
      tree.blocks[0].sequences[0].items.push(mkItem(99, { title: 'Fresh' }));
      return jres({ id: 99 });
    }
    if (u.endsWith('/assets')) return jres([]);
    return jres({});
  });
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  session.user = {
    id: 1, email: 'a@example.org', full_name: 'Admin', is_superuser: false, is_disabled: false,
    photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
  session.loading = false;
  await navigate(SEQ, { force: true });
  errors = [];
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  clearEditorVersion();
  clearToasts();
  session.user = null;
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

const openBtn = (id: number) => target.querySelector<HTMLButtonElement>(`button[aria-label="Open Item ${id}"]`)!;

describe('App editor routes — the 5a Back-freeze (Slice-5b T3b)', () => {
  it('sequence → item → Back leaves a live page; a created item then opens in the modal', async () => {
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('.blocks-card')).not.toBeNull();

    // Stage 1 — the freeze.
    openBtn(30).click();
    await settle();
    expect(currentRoute.path).toBe(`${SEQ}/items/30`);
    history.back();
    await waitPop();
    expect(errors).toEqual([]);
    expect(currentRoute.path).toBe(SEQ);
    expect(target.querySelector('.blocks-card')).not.toBeNull();   // the load ran: not stuck on the Skeleton
    target.querySelector<HTMLButtonElement>('button[aria-label="New item in Seq 20"]')!.click();
    await settle();
    const title = target.querySelector<HTMLInputElement>('input[aria-label="Item title"]');
    expect(title).not.toBeNull();                                   // the create form opens

    // Stage 2 — the modal.
    title!.value = 'Fresh';
    title!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    title!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(currentRoute.path).toBe(`${SEQ}/items/99`);
    expect(target.querySelector('section.modal-panel h2.item-name')?.textContent).toBe('Fresh');
    expect(errors).toEqual([]);
  });

  it('sequence → item → sequence → item keeps one live page', async () => {
    component = mount(App, { target });
    await settle();
    openBtn(30).click();
    await settle();
    history.back();
    await waitPop();
    expect(target.querySelector('.blocks-card')).not.toBeNull();
    openBtn(31).click();
    await settle();
    expect(currentRoute.path).toBe(`${SEQ}/items/31`);
    expect(target.querySelector('section.modal-panel h2.item-name')?.textContent).toBe('Item 31');
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it against today's routing**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/App.editorRoutes.svelte.test.ts`

Expected: both tests FAIL.
- The first must fail at the **freeze stage**: an error captured, or no `.blocks-card`, or no create form after Back. A failure only at the modal stage (no `section.modal-panel`) proves nothing.
- Record the failing line in the ledger.
- If jsdom cannot reproduce the freeze, record `Task 3b: Ruling: jsdom does not reproduce the Back-freeze; kept as a routing smoke test` and continue. The Step 9 mutation still runs.

- [ ] **Step 3: Write the failing unit tests for the item level**

Append to `frontend/src/tests/deriveExpansion.test.ts`:

```ts
describe('deriveExpansion — the item level (Slice-5b D19)', () => {
  const item = (id: number, sequence_id: number) => ({
    id, sequence_id, title: `I${id}`, slug: `i${id}`, order: 1, type: 'static_page' as const,
    content_md: '', content_html: '', video_url: null, script_url: null, questions_count: 0,
  });
  function treeWithItems() {
    const t = makeTree();
    t.blocks[0].sequences[0].items = [item(5000, 1000)];
    t.blocks[0].sequences[1].items = [item(5001, 1001)];
    return t;
  }

  it('no item id: expandedItem null, not stale', () => {
    const e = deriveExpansion('100', '1000', treeWithItems());
    expect(e.expandedItem).toBeNull();
    expect(e.staleIid).toBe(false);
  });

  it('an item of the expanded sequence is expanded', () => {
    const e = deriveExpansion('100', '1000', treeWithItems(), '5000');
    expect(e.expandedItem?.id).toBe(5000);
    expect(e.staleIid).toBe(false);
  });

  it('an item that is missing, or belongs to another sequence, is stale', () => {
    expect(deriveExpansion('100', '1000', treeWithItems(), '9999').staleIid).toBe(true);
    const other = deriveExpansion('100', '1000', treeWithItems(), '5001');
    expect(other.staleIid).toBe(true);
    expect(other.expandedItem).toBeNull();
  });

  it('a non-canonical id ("abc", "05000") is stale; a stale sequence wins over the item', () => {
    expect(deriveExpansion('100', '1000', treeWithItems(), 'abc').staleIid).toBe(true);
    expect(deriveExpansion('100', '1000', treeWithItems(), '05000').staleIid).toBe(true);
    const e = deriveExpansion('100', '9999', treeWithItems(), '5000');
    expect(e.staleSid).toBe(true);
    expect(e.staleIid).toBe(false);
  });
});
```

Append to `frontend/src/tests/handleStaleIdFallback.test.ts`:

```ts
describe('handleStaleIdFallback — the item level (Slice-5b D19, D9)', () => {
  const ctx = { courseSlug: 'cs101', vid: '10', bid: '100', sid: '1000', iid: '5000' };

  it('staleIid: toast "Item not found." + replace+force to the sequence URL', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback({ staleBid: false, staleSid: false, staleIid: true }, ctx, { pushToast, navigate });
    expect(pushToast).toHaveBeenCalledWith('Item not found.', 'info');
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10/blocks/100/sequences/1000', { replace: true, force: true });
  });

  it('staleSid beats staleIid', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback({ staleBid: false, staleSid: true, staleIid: true }, ctx, { pushToast, navigate });
    expect(pushToast).toHaveBeenCalledWith('Sequence not found.', 'info');
    expect(pushToast).toHaveBeenCalledTimes(1);
  });

  it('the item we just deleted (deletedIid) is an expected close: no toast, no navigation', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback({ staleBid: false, staleSid: false, staleIid: true }, { ...ctx, deletedIid: 5000 }, { pushToast, navigate });
    expect(pushToast).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a deletedIid for a different item does not suppress', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback({ staleBid: false, staleSid: false, staleIid: true }, { ...ctx, deletedIid: 7 }, { pushToast, navigate });
    expect(pushToast).toHaveBeenCalledWith('Item not found.', 'info');
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
```

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/deriveExpansion.test.ts src/tests/handleStaleIdFallback.test.ts`
Expected: FAIL. `expandedItem` / `staleIid` are undefined, and no toast is pushed for `staleIid`.

- [ ] **Step 4: Implement the item level**

`frontend/src/lib/deriveExpansion.ts` (full content):

```ts
// deriveExpansion takes URL-parsed block/sequence/item ids and the loaded
// admin-tree and returns the matched entities plus stale-id flags. The
// accordion uses this to rebuild its expansion state from the URL alone —
// no parallel component state. Precedence staleBid > staleSid > staleIid by
// design: when a parent is gone, the nested URL is moot. An item id must match
// an item of the EXPANDED sequence exactly (String(id) === iid), so "05" or
// "abc" is stale too (Slice-5b D19).

import type { AdminTree, AdminTreeBlock, AdminTreeItem, AdminTreeSequence } from './types';

export type Expansion = {
  expandedBlock: AdminTreeBlock | null;
  expandedSequence: AdminTreeSequence | null;
  expandedItem: AdminTreeItem | null;
  staleBid: boolean;
  staleSid: boolean;
  staleIid: boolean;
};

const NONE: Expansion = {
  expandedBlock: null, expandedSequence: null, expandedItem: null,
  staleBid: false, staleSid: false, staleIid: false,
};

export function deriveExpansion(
  bid: string | null,
  sid: string | null,
  tree: AdminTree | null,
  iid: string | null = null,
): Expansion {
  if (!tree || bid === null) return NONE;
  const expandedBlock = tree.blocks.find((b) => String(b.id) === bid) ?? null;
  if (!expandedBlock) return { ...NONE, staleBid: true };
  if (sid === null) return { ...NONE, expandedBlock };
  const expandedSequence = expandedBlock.sequences.find((s) => String(s.id) === sid) ?? null;
  if (!expandedSequence) return { ...NONE, expandedBlock, staleSid: true };
  if (iid === null) return { ...NONE, expandedBlock, expandedSequence };
  const expandedItem = expandedSequence.items.find((it) => String(it.id) === iid) ?? null;
  return { ...NONE, expandedBlock, expandedSequence, expandedItem, staleIid: expandedItem === null };
}
```

`frontend/src/lib/handleStaleIdFallback.ts` — replace everything from `export type StaleFlags` to the end of the file with:

```ts
export type StaleFlags = {
  staleBid: boolean;
  staleSid: boolean;
  staleIid?: boolean;
};

export type StaleContext = {
  courseSlug: string;
  vid: string;
  bid: string | null;
  sid?: string | null;
  iid?: string | null;
  // Slice-5b D9: the item this page just deleted. Its route is an expected
  // close in flight, not a stale address — no toast, no navigation.
  deletedIid?: number | null;
};

export type StaleDeps = {
  pushToast: (msg: string, kind: 'info' | 'success' | 'error') => void;
  navigate: (path: string, opts: { replace: boolean; force: boolean }) => void;
};

export function handleStaleIdFallback(
  flags: StaleFlags,
  ctx: StaleContext,
  deps: StaleDeps,
): void {
  if (flags.staleBid) {
    deps.pushToast('Block not found.', 'info');
    deps.navigate(`/courses/${ctx.courseSlug}/edit/v/${ctx.vid}`, { replace: true, force: true });
    return;
  }
  // `bid !== null` is defense-in-depth: a stale `sid` only makes sense under a
  // valid block, but if bid were null we'd have nowhere to navigate back to.
  if (flags.staleSid && ctx.bid !== null) {
    deps.pushToast('Sequence not found.', 'info');
    deps.navigate(`/courses/${ctx.courseSlug}/edit/v/${ctx.vid}/blocks/${ctx.bid}`, { replace: true, force: true });
    return;
  }
  if (flags.staleIid && ctx.bid !== null && ctx.sid != null) {
    if (ctx.deletedIid != null && ctx.iid === String(ctx.deletedIid)) return;
    deps.pushToast('Item not found.', 'info');
    deps.navigate(
      `/courses/${ctx.courseSlug}/edit/v/${ctx.vid}/blocks/${ctx.bid}/sequences/${ctx.sid}`,
      { replace: true, force: true },
    );
  }
}
```

Also update the header comment's second sentence: replace `staleBid wins over staleSid because a` with `staleBid wins over staleSid (and staleSid over staleIid) because a`.

Run the Step 3 command again.
Expected: PASS. The 9 existing `deriveExpansion` tests stay green, since they check fields one by one.

- [ ] **Step 5: Write the failing host tests, update the router row, port the app cases**

In `frontend/src/tests/VersionEditPage.svelte.test.ts`:

1. **Imports.**
   - Replace `import type { AdminTree, AdminTreeBlock, AdminTreeSequence, AdminTreeVersion } from '../lib/types';` with:
```ts
import type { AdminTree, AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';
```
   - Replace `import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';` with:
```ts
import { clearEditorVersion, loadAdminTree } from '../stores/currentEditorVersion.svelte';
```

2. **`renderRouted`.** Replace `      get sequenceId() { return param('sequenceId'); },` with:
```ts
      get sequenceId() { return param('sequenceId'); },
      get itemId() { return param('itemId'); },
```

3. **Host tests.** Append at the end of the file:

```ts
// ---- Slice-5b T3b: the item modal hosted on the item route ----
function mkItem(id: number, over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id, sequence_id: 20, title: `Item ${id}`, slug: `i${id}`, order: id, type: 'static_page',
    content_md: `body ${id}`, content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  };
}
const SEQ = '/courses/c/edit/v/1/blocks/10/sequences/20';
const ITEM = (id: number) => `${SEQ}/items/${id}`;
// jsdom fires popstate for history.back() asynchronously.
async function waitPop() { await new Promise((r) => setTimeout(r, 0)); await settle(); await settle(); }
const modal = () => document.querySelector<HTMLElement>('section.modal-panel');
const xBtn = () => modal()!.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const trashBtn = () => modal()!.querySelector<HTMLButtonElement>('button[aria-label="Delete item"]')!;
const pencil = (id: number) => document.getElementById(`item-${id}-open`) as HTMLButtonElement | null;
const titleField = () => modal()!.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
const msgs = () => toasts.list.map((t) => t.message);
function typeInto(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const esc = (init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));
// A DELETE /api/items/{id} held until release(); release() also drops the item from the served tree.
function holdDelete(id: number) {
  let release!: () => void;
  serve((url, init) => {
    if (url === `/api/items/${id}` && init?.method === 'DELETE') {
      return new Promise<Response>((r) => {
        release = () => {
          const s = tree.blocks[0].sequences[0];
          s.items = s.items.filter((x) => x.id !== id);
          void jres({}).then(r);
        };
      });
    }
    return undefined;
  });
  return () => release();
}

describe('VersionEditPage — the item modal (Slice-5b T3b)', () => {
  beforeEach(() => {
    tree.blocks = [mkBlock(10, { sequences: [{ id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [mkItem(30), mkItem(31)] }] })];
  });
  async function openFromPage(id = 30) {
    await navigate(SEQ, { force: true });
    await renderRouted();
    pencil(id)!.focus();
    pencil(id)!.click();
    await settle();
  }

  it('Open, then ×: the modal closes, the sequence stays open, focus is back on the pencil', async () => {
    await openFromPage();
    expect(currentRoute.path).toBe(ITEM(30));
    expect(modal()!.querySelector('h2.item-name')!.textContent).toBe('Item 30');
    expect(modal()!.querySelector('.item-ctx')!.textContent).toBe('static page · S1 · item 1 of 2');
    xBtn().click();
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
    expect(document.activeElement).toBe(pencil(30));
  });

  it('restore beats fallback: focus returns to what had it when the item opened', async () => {
    await navigate(SEQ, { force: true });
    await renderRouted();
    const header = target.querySelector<HTMLElement>('#seq-20-header')!;
    header.focus();
    await navigate(ITEM(30));
    await settle();
    expect(modal()).not.toBeNull();
    xBtn().click();
    await waitPop();
    expect(document.activeElement).toBe(header);
  });

  it('in-page open: ×, × and Escape call history.back() once and stop on the sequence', async () => {
    await openFromPage();
    const back = vi.spyOn(history, 'back');
    xBtn().click();
    xBtn().click();
    esc();
    expect(back).toHaveBeenCalledTimes(1);
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
  });

  it('Escape closes; an auto-repeat Escape does not', async () => {
    await openFromPage();
    const back = vi.spyOn(history, 'back');
    esc({ repeat: true });
    expect(back).not.toHaveBeenCalled();
    esc();
    expect(back).toHaveBeenCalledTimes(1);
    await waitPop();
    expect(modal()).toBeNull();
  });

  it('a prompt cancelled on × re-arms it; the next confirmed × closes', async () => {
    await openFromPage();
    typeInto(titleField(), 'Draft');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const back = vi.spyOn(history, 'back');
    xBtn().click();
    await waitPop();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
    confirmSpy.mockReturnValue(true);
    xBtn().click();
    await waitPop();
    expect(back).toHaveBeenCalledTimes(2);
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });

  it('deep link, then ×: the address is replaced with the sequence; history.back() is never used', async () => {
    await navigate(ITEM(30), { force: true });
    await renderRouted();
    const back = vi.spyOn(history, 'back');
    const replace = vi.spyOn(history, 'replaceState');
    xBtn().click();
    await settle();
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(null, '', SEQ);
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });

  it('deep link with a draft: × prompts, cancel keeps the draft and re-arms; Escape prompts again', async () => {
    await navigate(ITEM(30), { force: true });
    await renderRouted();
    typeInto(titleField(), 'Draft');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    xBtn().click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
    esc();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(titleField().value).toBe('Draft');
  });

  it('browser Back and the course link prompt while the modal has a draft; cancel keeps it', async () => {
    await openFromPage();
    typeInto(titleField(), 'Draft');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    history.back();
    await waitPop();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(modal()).not.toBeNull();
    target.querySelector<HTMLAnchorElement>('h1 a')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(currentRoute.path).toBe(ITEM(30));
    expect(titleField().value).toBe('Draft');
  });

  it('a stale item address toasts "Item not found." and replaces the address with the sequence', async () => {
    await navigate(ITEM(999), { force: true });
    await renderRouted();
    await settle();
    expect(msgs()).toContain('Item not found.');
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });

  it('delete: one confirm, frozen in flight, one replace+force close after which the reload lands, then toast and header focus', async () => {
    const release = holdDelete(30);
    let modalAtReload: boolean | null = null;
    const inner = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/admin-tree') && modalAtReload === false) modalAtReload = modal() !== null;
      return inner(url, init);
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openFromPage();
    const back = vi.spyOn(history, 'back');
    const replace = vi.spyOn(history, 'replaceState');
    trashBtn().click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('Delete item "Item 30"? This cannot be undone.');
    expect(modal()!.querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    xBtn().click();
    esc();
    await settle();
    expect(back).not.toHaveBeenCalled();
    expect(currentRoute.path).toBe(ITEM(30));
    modalAtReload = false;           // arm: record the modal's presence at the next tree GET
    release();
    await settle();
    await settle();
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(null, '', SEQ);
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
    expect(modalAtReload).toBe(false);   // the reload ran after the modal unmounted
    expect(pencil(30)).toBeNull();
    expect(msgs()).toContain('Item deleted');
    expect(msgs()).not.toContain('Item not found.');
    expect(document.activeElement).toBe(target.querySelector('#seq-20-header'));
  });

  it('a failed DELETE keeps the modal open and unfrozen, with focus on the trash', async () => {
    serve((url, init) => (url === '/api/items/30' && init?.method === 'DELETE' ? jres({ detail: 'Nope' }, 409) : undefined));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openFromPage();
    trashBtn().click();
    await settle();
    await settle();
    expect(msgs()).toContain('Nope');
    expect(currentRoute.path).toBe(ITEM(30));
    expect(modal()!.querySelector('div.modal-body')!.hasAttribute('inert')).toBe(false);
    expect(xBtn().disabled).toBe(false);
    expect(document.activeElement).toBe(trashBtn());
  });

  it('browser Back during the DELETE, then another item: not frozen, × works, and the late success never navigates', async () => {
    const release = holdDelete(30);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openFromPage(30);
    trashBtn().click();
    await settle();
    history.back();
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
    pencil(31)!.focus();
    pencil(31)!.click();
    await settle();
    expect(modal()!.querySelector('h2.item-name')!.textContent).toBe('Item 31');
    expect(modal()!.querySelector('div.modal-body')!.hasAttribute('inert')).toBe(false);
    expect(xBtn().disabled).toBe(false);
    const back = vi.spyOn(history, 'back');
    release();
    await settle();
    await settle();
    expect(currentRoute.path).toBe(ITEM(31));
    expect(back).not.toHaveBeenCalled();
    xBtn().click();
    await waitPop();
    expect(back).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe(SEQ);
  });

  it('the page behind cannot take focus while the modal is open', async () => {
    await openFromPage();
    target.querySelector<HTMLElement>('#seq-20-header')!.focus();
    expect(modal()!.contains(document.activeElement)).toBe(true);
  });

  it('after creating an item the modal opens on it; closing lands focus on its Open pencil', async () => {
    serve((url, init) => {
      if (url === '/api/sequences/20/items' && init?.method === 'POST') {
        tree.blocks[0].sequences[0].items.push(mkItem(99, { title: 'Fresh' }));
        return jres({ id: 99 });
      }
      return undefined;
    });
    await navigate(SEQ, { force: true });
    await renderRouted();
    target.querySelector<HTMLButtonElement>('button[aria-label="New item in Seq 20"]')!.click();
    await settle();
    const t = target.querySelector<HTMLInputElement>('input[aria-label="Item title"]')!;
    typeInto(t, 'Fresh');
    const create = [...t.form!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Create')!;
    create.focus();
    t.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(currentRoute.path).toBe(ITEM(99));
    expect(modal()!.querySelector('h2.item-name')!.textContent).toBe('Fresh');
    xBtn().click();
    await waitPop();
    expect(currentRoute.path).toBe(SEQ);
    expect(document.activeElement).toBe(pencil(99));
  });

  it("after a deep-link close, focus lands on the closed item's Open pencil", async () => {
    await navigate(ITEM(31), { force: true });
    await renderRouted();
    xBtn().click();
    await settle();
    await settle();
    expect(currentRoute.path).toBe(SEQ);
    expect(document.activeElement).toBe(pencil(31));
  });

  it('a tree reload with focus on body does not move focus', async () => {
    await navigate(SEQ, { force: true });
    await renderRouted();
    (document.activeElement as HTMLElement | null)?.blur();
    target.querySelector<HTMLButtonElement>('button[aria-label="Move item down: Item 30"]')!.click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('the item is deleted elsewhere while its modal is open: the reload closes it with "Item not found.", no error', async () => {
    await openFromPage();
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => { errors.push(e.error ?? e.message); };
    window.addEventListener('error', onErr);
    tree.blocks[0].sequences[0].items = [mkItem(31)];
    await loadAdminTree(1, { force: true });
    await settle();
    await settle();
    window.removeEventListener('error', onErr);
    expect(errors).toEqual([]);
    expect(msgs()).toContain('Item not found.');
    expect(currentRoute.path).toBe(SEQ);
    expect(modal()).toBeNull();
  });
});
```

4. **`frontend/src/tests/router.test.ts`.** In the `it.each` table, change the item row's component `'ItemEditPage',` to `'VersionEditPage',`. Keep the column alignment.

5. **Port the two app cases** from the deleted `ItemEditPage.interactive` test. Append to `frontend/src/tests/ItemEditorModal.svelte.test.ts`:

```ts
describe('ItemEditorModal — ported from ItemEditPage.interactive (T3b)', () => {
  it('app: the fetched script previews in the sandboxed frame; there is no URL form', async () => {
    serve((u) => (u.includes('/assets/')
      ? Promise.resolve({ ok: true, status: 200, statusText: 'x', text: () => Promise.resolve("getElementById('app-root')") } as unknown as Response)
      : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    expect(panel().querySelector('iframe')?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
    expect(panel().querySelector('input[type="url"]')).toBeNull();
  });

  it('app: with no script the empty upload state shows', async () => {
    await render({ item: { type: 'interactive_app', script_url: null } });
    expect(panel().textContent).toContain('No app uploaded yet.');
  });
});
```

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts src/tests/router.test.ts`
Expected: FAIL. The item route still maps to `ItemEditPage`, `VersionEditPage` has no `itemId`, and `#item-30-open` does not exist.

- [ ] **Step 6: Implement the host**

`frontend/src/pages/editor/VersionEditPage.svelte`:

(a) **Imports and props.**
- Replace `  import { setContext, onDestroy, tick, untrack } from 'svelte';` with `  import { setContext, onDestroy, onMount, tick, untrack } from 'svelte';`.
- Delete the T3a line `  import type { AdminTreeItem } from '../../lib/types';`.
- Replace:
```ts
    blockId?: string;
    sequenceId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId }: Props = $props();
```
with:
```ts
    blockId?: string;
    sequenceId?: string;
    // Slice-5b D1: the item route is served here too; the item opens in a modal.
    itemId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId, itemId }: Props = $props();
```
- Replace `  const routeSid = $derived(sequenceId ?? null);` with:
```ts
  const routeSid = $derived(sequenceId ?? null);
  const routeIid = $derived(itemId ?? null);
```

(b) **Item-modal state.** Insert immediately **before** the comment `  // Load $effect — declared FIRST`:
```ts
  // ---- Slice-5b item modal (D7 close, D9 delete, D18 focus). Plain `let`s
  //      where nothing renders from the value. ----
  // D7: was the page mounted ON an item URL (deep link / reload)? Then × must
  // replace to the sequence; every later open is in-page and × = Back.
  let mountedOnItem = untrack(() => itemId) !== undefined;
  let openedFromPage = false;
  // Re-entrancy latch: a double ×, Escape-then-× or auto-repeat closes once.
  let closing = false;
  // D9: the item whose DELETE is in flight (freezes ITS modal only).
  let deletingIid = $state<number | null>(null);
  // D9: the item this page just deleted — its stale route is an expected close.
  let deletedIid: number | null = null;
  // D18: the one-shot close signal for the focus effect.
  let lastClosedIid: string | null = null;
  let justClosedItem = false;
  let prevRouteIid: string | null = untrack(() => routeIid);
```

(c) **Validation effect.** Replace the whole block from `  $effect(() => {` (the one containing `const expansion = deriveExpansion(routeBid, routeSid, effectiveTree);`) through its closing `  });` with:
```ts
  const expansion = $derived(deriveExpansion(routeBid, routeSid, effectiveTree, routeIid));
  $effect(() => {
    if (!effectiveTree) return;
    const e = expansion;
    if (e.staleBid || e.staleSid || e.staleIid) {
      handleStaleIdFallback(
        { staleBid: e.staleBid, staleSid: e.staleSid, staleIid: e.staleIid },
        { courseSlug, vid: String(vid), bid: routeBid, sid: routeSid, iid: routeIid, deletedIid },
        { pushToast, navigate },
      );
    }
  });

  // Item-route $effect (Slice-5b D7/D18) — declared after validation and
  // BEFORE focus: the focus effect reads the one-shot flag set here.
  $effect(() => {
    const iid = routeIid;
    untrack(() => {
      if (iid !== prevRouteIid) closing = false;
      if (iid !== null) {
        openedFromPage = !mountedOnItem;
      } else {
        if (prevRouteIid !== null) {
          lastClosedIid = prevRouteIid;
          justClosedItem = true;
        }
        mountedOnItem = false;   // every later open is in-page
        openedFromPage = false;
        deletedIid = null;
      }
      prevRouteIid = iid;
    });
  });
```

(d) **Focus effect.**

First, replace:
```ts
  $effect(() => {
    const bid = routeBid;
    const sid = routeSid;
    const t = effectiveTree;
    if (!t) return;
```
with:
```ts
  $effect(() => {
    const bid = routeBid;
    const sid = routeSid;
    const iid = routeIid;
    const t = effectiveTree;
    // D18 one-shot, read untracked at the TOP: a tracked write-then-read
    // would re-run this effect. Cleared on every early return below, so it
    // can never outlive its close.
    const closedNow = untrack(() => justClosedItem);
    // An open item owns focus (its modal): never race it.
    if (iid !== null) { justClosedItem = false; return; }
    if (!t) { justClosedItem = false; return; }
```

Then replace:
```ts
    if (!headerId) {
      // Collapsed back to version root — clear the memo so the next
      // expansion refocuses correctly.
      lastFocusedTarget = null;
      return;
    }

    // Skip refocus if route hasn't changed since the last auto-focus.
```
with:
```ts
    if (!headerId) {
      // Collapsed back to version root — clear the memo so the next
      // expansion refocuses correctly.
      lastFocusedTarget = null;
      justClosedItem = false;
      return;
    }

    if (closedNow) {
      // An item just closed. FocusTrap has already restored focus to the
      // opener, or to whatever the user had focused: leave it there. Only
      // when focus fell to <body> (the opener is gone: a create form's
      // button, a deep link) does the closed item's Open pencil take it, else
      // the header. Never the scroll path below. The memo is set so a later
      // reload does not refocus.
      lastFocusedTarget = headerId;
      const fallbackHeaderId = headerId;
      const closedIid = lastClosedIid;
      let cancelled = false;
      void (async () => {
        // Within this flush the modal's × is still mounted and focused.
        await tick();
        if (cancelled) return;
        justClosedItem = false;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const pencil = closedIid !== null ? document.getElementById(`item-${closedIid}-open`) : null;
        (pencil ?? document.getElementById(fallbackHeaderId))?.focus();
      })();
      return () => { cancelled = true; };
    }

    // Skip refocus if route hasn't changed since the last auto-focus.
```

Finally, delete the T3a block:
```ts
  // Slice-5b T3a: always null until T3b routes items here (deriveExpansion).
  // $state, not a const: a `const … = null` narrows to `never` in the template.
  let expandedItem = $state<AdminTreeItem | null>(null);
```

(e) **Close and delete.** Insert right **after** the `stillOnVid` function:
```ts
  // D7: a guard cancelled at the prompt leaves the item open — re-arm ×.
  onMount(() => {
    const onPop = () => { closing = false; };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  function seqUrl(): string {
    return `/courses/${courseSlug}/edit/v/${vid}/blocks/${routeBid}/sequences/${routeSid}`;
  }

  // D7: × and Escape. Back-equivalent when the item was opened in this page
  // instance; otherwise (deep link / reload) replace the address with the
  // sequence — × can never take the user out of the app. Guards run.
  function requestCloseItem() {
    if (closing) return;
    if (deletingIid !== null && String(deletingIid) === routeIid) return;
    closing = true;
    if (openedFromPage) { history.back(); return; }
    const from = routeIid;
    void navigate(seqUrl(), { replace: true }).then(() => {
      if (routeIid === from) closing = false;   // the prompt was cancelled
    });
  }

  // D9: page-owned, so the reload, toast and focus survive the modal's unmount.
  async function deleteOpenItem() {
    const it = expansion.expandedItem;
    if (!it || deletingIid !== null || !perms?.canEditStructure) return;
    if (!confirm(`Delete item "${it.title}"? This cannot be undone.`)) return;
    const id = it.id;
    const savedVid = vid;
    const savedSid = routeSid;
    const seqPath = seqUrl();
    deletingIid = id;
    try {
      await api.delete(`/api/items/${id}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      // A 403/409 from a state change mid-confirm: perms must catch up.
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      deletingIid = null;   // the modal refocuses its trash (or ×)
      await tick();
      return;
    }
    if (!stillOnVid(savedVid)) { deletingIid = null; return; }
    if (routeIid === String(id)) {
      deletedIid = id;
      closing = true;
      // Never history.back(): a Back the user queued while the DELETE was out
      // would be followed by a second traversal past the sequence (D9).
      void navigate(seqPath, { replace: true, force: true });
      await tick();   // the modal unmounts before the reload lands
    }
    await loadAdminTree(savedVid, { force: true });
    pushToast('Item deleted', 'success');
    if (routeIid === null && stillOnVid(savedVid) && routeSid === savedSid) {
      document.getElementById(`seq-${savedSid}-header`)?.focus();
    }
    deletingIid = null;
  }
```

(f) **Template.** Replace the T3a dead branch, from `    {#if expandedItem}` through its final `    {/if}`, with:
```svelte
    {#if expansion.expandedItem && expansion.expandedBlock && expansion.expandedSequence}
      {@const it = expansion.expandedItem}
      {@const hostBlock = expansion.expandedBlock}
      {@const hostSeq = expansion.expandedSequence}
      <!-- D1: the item opens over the page; keyed so drafts seed once per item. -->
      {#key it.id}
        <ItemEditorModal
          {vid}
          version={v}
          {perms}
          seqIndex={hostBlock.sequences.indexOf(hostSeq) + 1}
          item={it}
          itemIndex={hostSeq.items.indexOf(it) + 1}
          itemCount={hostSeq.items.length}
          {stillOnVid}
          onRequestClose={requestCloseItem}
          onDeleteItem={() => void deleteOpenItem()}
          deleting={deletingIid === it.id}
        />
      {/key}
    {/if}
```

`frontend/src/components/editor/ItemRow.svelte` — replace:
```svelte
    <IconButton size="sm" glyph="pencil" title="Open" aria-label={`Open ${ariaName}`} disabled={busy} onclick={onOpen} />
```
with:
```svelte
    <!-- id: the item modal's close falls back here (Slice-5b D18). -->
    <IconButton id={`item-${item.id}-open`} size="sm" glyph="pencil" title="Open" aria-label={`Open ${ariaName}`} disabled={busy} onclick={onOpen} />
```

`frontend/src/routes.ts` — in the item route's row, replace `component: 'ItemEditPage'` with `component: 'VersionEditPage'`.

`frontend/src/App.svelte`:
- delete `  import ItemEditPage from './pages/editor/ItemEditPage.svelte';`;
- delete `    ItemEditPage: ItemEditPage as Component<Record<string, string>>,`.

`frontend/src/stores/currentEditorVersion.svelte.ts` — replace the first five comment lines:
```ts
// Module-scoped reactive store for the version currently open in the admin
// editor. Holds the full AdminTree (course + version + blocks/sequences/items)
// fetched from `/api/versions/{vid}/admin-tree`. Pages subscribe via
// `currentEditorVersion.value` (reactive $state property), call `loadAdminTree`
// on mount, and `clearEditorVersion` on unmount.
```
with (D22):
```ts
// Module-scoped reactive store for the version currently open in the admin
// editor. Holds the full AdminTree (course + version + blocks/sequences/items)
// fetched from `/api/versions/{vid}/admin-tree`. Read by VersionEditPage and its
// subtree (BlockAccordion, SequenceAccordion, the item modal); loaded and
// cleared only by VersionEditPage. No other page may call clearEditorVersion.
```

Delete the old item page and its tests:
```bash
git rm frontend/src/pages/editor/ItemEditPage.svelte frontend/src/tests/ItemEditPage.interactive.svelte.test.ts frontend/src/tests/ItemEditPage.refreshKey.svelte.test.ts frontend/src/tests/ItemEditPage.refreshKey.harness.svelte
```
`git rm` stages the deletions. That is the only staging before the commit step, and it touches exactly these four named paths (Constraint 9).

- [ ] **Step 7: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts src/tests/router.test.ts src/tests/App.editorRoutes.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts src/tests/deriveExpansion.test.ts src/tests/handleStaleIdFallback.test.ts`
Expected: PASS. That includes the 17 new host tests, both App tests and the 2 ported modal tests.

- [ ] **Step 8: Prove the App test can fail (one-off mutation, never committed)**

1. Create `frontend/src/pages/editor/StubItemPage.svelte`:
```svelte
<script lang="ts">
  // TEMPORARY (T3b mutation proof): what ItemEditPage did to the store.
  import { onDestroy } from 'svelte';
  import { currentEditorVersion, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  const t = $derived(currentEditorVersion.value);
  onDestroy(() => clearEditorVersion());
</script>
<p>{t?.course.name ?? '…'}</p>
```
2. In `App.svelte`:
   - add `  import StubItemPage from './pages/editor/StubItemPage.svelte';`;
   - add the map entry `    StubItemPage: StubItemPage as Component<Record<string, string>>,`.
3. In `routes.ts`, set the item row to `component: 'StubItemPage'`.
4. Run: `TZ=Europe/Copenhagen npx vitest run src/tests/App.editorRoutes.svelte.test.ts`.

   Expected: the first test FAILS **at the freeze stage**. Record it in the ledger.
   - If it fails only at the modal stage, record `Ruling: the freeze does not reproduce in jsdom even with the stub — App test kept as a routing smoke test`.
5. Revert by hand:
   - delete `StubItemPage.svelte`;
   - remove the two `App.svelte` lines;
   - set `routes.ts` back to `'VersionEditPage'`.

   Then run `git status --short | grep -i stub` and `git diff | grep -i stub`. Both must print nothing.

- [ ] **Step 9: Full verification**

Run: `npm test 2>&1 | tail -4`, `npm run check 2>&1 | tail -1`, `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.

Expected:
- tests: 135 files (136 − 2 deleted + 1 new), 1663 tests (1640 − 6 deleted + 8 unit + 17 host + 2 App + 2 ported), all pass;
- check: 0 errors, warnings ≤ 18. Watch for `state_referenced_locally` on `mountedOnItem` / `prevRouteIid`; both read through `untrack`;
- gate: `ALL PASS`, with the count unchanged (no CSS changed).

Then run `grep -rn "ItemEditPage" frontend/src --include=*.ts --include=*.svelte | grep -v "^\s*//"`. Only comment mentions may remain; T7 rewrites them.

- [ ] **Step 10: Review** (both lanes, uncommitted diff plus the staged deletions; Review Focus 1 and 5), then wait for the user's OK.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/tests/App.editorRoutes.svelte.test.ts frontend/src/lib/deriveExpansion.ts frontend/src/lib/handleStaleIdFallback.ts frontend/src/pages/editor/VersionEditPage.svelte frontend/src/components/editor/ItemRow.svelte frontend/src/routes.ts frontend/src/App.svelte frontend/src/stores/currentEditorVersion.svelte.ts frontend/src/tests/deriveExpansion.test.ts frontend/src/tests/handleStaleIdFallback.test.ts frontend/src/tests/VersionEditPage.svelte.test.ts frontend/src/tests/router.test.ts frontend/src/tests/ItemEditorModal.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5b T3b — items open in a modal over VersionEditPage

The item route is served by VersionEditPage (D1), which hosts
ItemEditorModal: D7 close latch, page-owned D9 delete, D18 focus
fallback, D19 stale item. ItemEditPage is deleted; the 5a Back-freeze
is pinned by an App-level test.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Video preview card (3e) + `AppBody` (D4) + frame heights + gate (ad)

**What this task builds.**
- **Video preview card (D13, refs 1813–1823).** `VideoBody`'s bare `VideoFrame` becomes a card:
  - a header with "Preview" and the mono provider (`youtube` / `vimeo` / `embed`);
  - a 296px player area holding `VideoFrame height={296}`, or a centred "No preview";
  - a footer with the mono status and **Open in new tab**:
    - `embed resolved` plus the link when `safeIframeUrl` accepts the URL;
    - otherwise `no embed — paste a YouTube or Vimeo link` with no link.
- **`AppBody` (D4, D14) replaces `InteractiveAppEditor`:**
  - an **App script** row: the mono filename (or "No script"), then Upload, or Replace and Remove;
  - Upload and Replace act immediately: scan, upload, link, reload, toast. This keeps the orphan clean-up and the 409 message;
  - Remove now confirms first;
  - a **Preview** card: the mono meta `interactive app` and `InteractiveFrame height={360}`. The `.notice` texts become `.app-hint` (D11 treatment), and the blank-preview hint moves to the card footer;
  - a disabled version shows no card and fetches nothing (R5);
  - `busy` covers every upload, replace and remove, and disables Save (D10);
  - `save` sends `PATCH {title}` only.
- **Frames (R3).** `VideoFrame` and `InteractiveFrame` take an optional `height`. With it set, a `.fixed` modifier replaces the default box and zeroes the frame's own bottom margin. The student players keep 16:9 and 600px.
- **Tests.** The 13 `InteractiveAppEditor` tests are ported into `ItemEditorModal.svelte.test.ts`, and the old file is deleted with its component. The T3a interim app tests are replaced.
- **Gate (ad)** covers VideoBody, AppBody and the frame modifiers. The `.notice` structural target drops from 2 to 1.

**Files:**
- Create:
  - `frontend/src/components/editor/item/AppBody.svelte`
  - `frontend/src/tests/VideoFrame.svelte.test.ts`
- Modify:
  - `frontend/src/components/editor/item/VideoBody.svelte`
  - `frontend/src/components/editor/ItemEditorModal.svelte`
  - `frontend/src/components/items/VideoFrame.svelte`
  - `frontend/src/components/items/InteractiveFrame.svelte`
  - `frontend/src/tests/ItemEditorModal.svelte.test.ts`
  - `frontend/src/tests/InteractiveFrame.svelte.test.ts`
  - `frontend/src/tests/InteractiveAppItem.svelte.test.ts` (comment only)
  - `frontend/scripts/visual-refresh-gate.sh`
- Delete:
  - `frontend/src/components/items/InteractiveAppEditor.svelte`
  - `frontend/src/tests/InteractiveAppEditor.svelte.test.ts`

**Interfaces:**
- Consumes:
  - the T3a body contract, `patchItem` and `reportSaveFailure`;
  - from `lib/assets`: `fetchAssetSource(vid, filename, signal)`, `uploadAsset(vid, file)` (POST `/api/versions/{vid}/assets`) and `deleteAsset(id)` (DELETE `/api/assets/{id}`);
  - `scanAppSource(text) → string[]`.
- Produces:
  - `VideoFrame` props `{ src, title, height?: number }` and `InteractiveFrame` props `{ scriptSource, title, height?: number }`, each rendering `div.frame.fixed` with `style="--frame-h: {height}px"` when `height` is set;
  - `AppBody` props `item: AdminTreeItem | undefined, vid, editable, versionDisabled, frozen, stillOnVid`, bindable `busy`, and exported `save` / `discard` / `discardAll` / `validate`. It has no drafts, so no `saveDirty` / `guardDirty`;
  - DOM hooks:
    - `.app-preview`, `.script-name`, `.app-hint`, `.blank-hint`;
    - `.video-preview`, `.preview-meta`, `.preview-empty`, `.preview-status`, `a.open-link`.

- [ ] **Step 1: Write the failing tests**

(a) `frontend/src/tests/VideoFrame.svelte.test.ts` (full content):

```ts
import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VideoFrame from '../components/items/VideoFrame.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountFrame(props: { src: string; title: string; height?: number }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(VideoFrame, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return target.querySelector<HTMLElement>('.frame')!;
}

it('default: the 16:9 box, no fixed modifier, no height variable', () => {
  const f = mountFrame({ src: 'https://player.vimeo.com/video/1', title: 'V' });
  expect(f.classList.contains('fixed')).toBe(false);
  expect(f.style.getPropertyValue('--frame-h')).toBe('');
  expect(f.querySelector('iframe')!.getAttribute('src')).toBe('https://player.vimeo.com/video/1');
});

it('height: the fixed modifier and --frame-h (Slice-5b D13)', () => {
  const f = mountFrame({ src: 'https://player.vimeo.com/video/1', title: 'V', height: 296 });
  expect(f.classList.contains('fixed')).toBe(true);
  expect(f.style.getPropertyValue('--frame-h')).toBe('296px');
});
```

(b) Append to `frontend/src/tests/InteractiveFrame.svelte.test.ts`. First widen its helper's props type: replace `function mountFrame(props: { scriptSource: string; title: string }) {` with `function mountFrame(props: { scriptSource: string; title: string; height?: number }) {`. Then append:

```ts
it('height: the fixed modifier and --frame-h; the default has neither (Slice-5b D14)', () => {
  const sized = mountFrame({ scriptSource: 'x', title: 't', height: 360 }).parentElement!;
  expect(sized.classList.contains('fixed')).toBe(true);
  expect(sized.style.getPropertyValue('--frame-h')).toBe('360px');
  cleanup?.(); cleanup = null;
  const plain = mountFrame({ scriptSource: 'x', title: 't' }).parentElement!;
  expect(plain.classList.contains('fixed')).toBe(false);
});
```

(c) In `frontend/src/tests/ItemEditorModal.svelte.test.ts`:

1. Add at the top, after the `Harness` import:
```ts
import AppBody from '../components/editor/item/AppBody.svelte';
import * as editorStore from '../stores/currentEditorVersion.svelte';
```

2. Replace the two T3a interim app tests, from `  it('app: the script editor mounts without its own title on an enabled version', async () => {` through the end of `  it('app: nothing is mounted or fetched on a disabled version', …` (the line before the describe's closing `});`), with:

```ts
  it('app: the App script row shows the filename with Replace and Remove; with none, Upload', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    expect(panel().querySelector('.script-name')!.textContent).toBe('app.js');
    expect(panel().querySelector('.script-name')!.classList.contains('mono')).toBe(true);
    const labels = [...panel().querySelectorAll<HTMLButtonElement>('.script-row button')].map((b) => b.textContent!.trim());
    expect(labels).toEqual(['Replace', 'Remove']);
    unmount(cmp!); cmp = null;
    await render({ item: { type: 'interactive_app', script_url: null } });
    expect(panel().querySelector('.script-name')!.textContent).toBe('No script');
    expect([...panel().querySelectorAll('.script-row button')].map((b) => b.textContent!.trim())).toEqual(['Upload']);
  });

  it('app: on a disabled version the script row is text, there is no preview card, and nothing is fetched', async () => {
    await render({ item: { type: 'interactive_app', script_url: 'app.js' }, version: { is_disabled: true } });
    expect(panel().querySelector('.script-name')!.textContent).toBe('app.js');
    expect(panel().querySelector('.script-row button')).toBeNull();
    expect(panel().querySelector('.app-preview')).toBeNull();
    expect(calls(/\/assets/).length).toBe(0);
  });
```

3. Append these describes at the end of the file:

```ts
describe('ItemEditorModal — video preview card (T4, D13)', () => {
  const EMBED = 'https://www.youtube.com/embed/abc123';
  const urlInput = () => panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!;

  it('a resolvable URL: the 296px frame, the provider meta, "embed resolved" and Open in new tab', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    const card = panel().querySelector('.video-preview')!;
    expect(card.querySelector('.preview-meta')!.textContent).toBe('youtube');
    const frame = card.querySelector<HTMLElement>('.preview-area .frame')!;
    expect(frame.classList.contains('fixed')).toBe(true);
    expect(frame.style.getPropertyValue('--frame-h')).toBe('296px');
    expect(card.querySelector('.preview-status')!.textContent).toBe('embed resolved');
    const link = card.querySelector<HTMLAnchorElement>('a.open-link')!;
    expect(link.textContent).toBe('Open in new tab');
    expect(link.getAttribute('href')).toBe(EMBED);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('the provider meta reads vimeo and embed for those hosts', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: 'https://player.vimeo.com/video/42' } });
    expect(panel().querySelector('.preview-meta')!.textContent).toBe('vimeo');
    unmount(cmp!); cmp = null;
    await render({ item: { type: 'video', content_md: null, video_url: 'https://media.example.org/v/1' } });
    expect(panel().querySelector('.preview-meta')!.textContent).toBe('embed');
  });

  it('no embeddable URL: "No preview", the no-embed status, no link and no meta', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: 'not a url' } });
    const card = panel().querySelector('.video-preview')!;
    expect(card.querySelector('iframe')).toBeNull();
    expect(card.querySelector('.preview-empty')!.textContent).toBe('No preview');
    expect(card.querySelector('.preview-status')!.textContent).toBe('no embed — paste a YouTube or Vimeo link');
    expect(card.querySelector('a')).toBeNull();
    expect(card.querySelector('.preview-meta')).toBeNull();
  });

  it('the preview follows the URL 500ms after the last keystroke', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
      type(urlInput(), 'https://vimeo.com/77');
      vi.advanceTimersByTime(499);
      flushSync();
      expect(panel().querySelector('iframe')!.getAttribute('src')).toBe(EMBED);
      vi.advanceTimersByTime(1);
      flushSync();
      expect(panel().querySelector('iframe')!.getAttribute('src')).toBe('https://player.vimeo.com/video/77');
      expect(panel().querySelector('.preview-meta')!.textContent).toBe('vimeo');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ItemEditorModal — app body (T4; ported from InteractiveAppEditor)', () => {
  const APP_ASSET = {
    id: 5, version_id: 1, filename: 'new.js', file_size: 3, mime_type: 'application/javascript',
    uploaded_at: '', uploaded_by: 1, is_referenced: false,
  };
  const jsFile = (text: string, name = 'new.js') => new File([text], name, { type: 'application/javascript' });
  // jsdom fires FileReader.onload on a macrotask: drain macrotasks until `cond` holds.
  async function waitUntil(cond: () => boolean, tries = 60): Promise<void> {
    for (let i = 0; i < tries; i++) {
      flushSync();
      if (cond()) return;
      await new Promise((r) => setTimeout(r));
      await Promise.resolve();
    }
    flushSync();
  }
  function chooseFile(file: File) {
    const input = panel().querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));   // Svelte delegates onchange: must bubble
  }
  const scriptBtn = (label: string) =>
    [...panel().querySelectorAll<HTMLButtonElement>('.script-row button')].find((b) => b.textContent!.trim() === label)!;
  const uploadPosts = () => calls(/\/api\/versions\/1\/assets$/, 'POST');
  const serveUpload = (extra: (u: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) =>
    serve((u, init) => extra(u, init) ?? (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST' ? jres(APP_ASSET) : undefined));

  it('Upload links the script, reloads the tree and toasts', async () => {
    serveUpload();
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => calls(/\/admin-tree$/).length > 0);
    await settle();
    expect(uploadPosts().length).toBe(1);
    expect(patchBodies()).toEqual([{ script_url: 'new.js' }]);
    expect(toastTexts()).toContain('App uploaded');
  });

  it('busy: while the upload is out, Save and the script buttons are disabled', async () => {
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST' ? new Promise(() => {}) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    type(titleInput(), 'App 2');
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => uploadPosts().length > 0);
    expect(footBtn('Save').disabled).toBe(true);
    expect(scriptBtn('Upload').disabled).toBe(true);
  });

  it('surfaces the heuristic warnings (non-blocking) and still uploads', async () => {
    serveUpload();
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("import x from 'y'; fetch('/z')", 'm.js'));
    await waitUntil(() => calls(/\/admin-tree$/).length > 0);
    expect(panel().querySelector('.warnings')!.textContent).toContain('ES module');
    expect(panel().querySelector('.warnings')!.textContent).toContain('Network');
    expect(uploadPosts().length).toBe(1);
  });

  it('rejects an empty file before uploading', async () => {
    serveUpload();
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile('', 'empty.js'));
    await waitUntil(() => !!panel().querySelector('.field-err'));
    expect(panel().querySelector('.field-err')!.textContent).toContain('empty');
    expect(uploadPosts().length).toBe(0);
  });

  it('a duplicate filename (409) shows the rename message', async () => {
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST' ? jres({ detail: 'dupe' }, 409) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')", 'dupe.js'));
    await waitUntil(() => !!panel().querySelector('.field-err'));
    expect(panel().querySelector('.field-err')!.textContent).toContain('already exists');
  });

  it('a failed link deletes the orphaned asset and does not reload', async () => {
    serveUpload((u, init) => (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH' ? jres({ detail: 'boom' }, 500) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => calls(/\/api\/assets\/5$/, 'DELETE').length > 0);
    await settle();
    expect(calls(/\/admin-tree$/).length).toBe(0);
    expect(panel().querySelector('.field-err')).not.toBeNull();
  });

  it('a linked asset is kept when only the tree refresh fails', async () => {
    serveUpload();
    const load = vi.spyOn(editorStore, 'loadAdminTree').mockRejectedValue(new Error('refresh down'));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')", 'ok.js'));
    await waitUntil(() => load.mock.calls.length > 0);
    await settle();
    expect(patchBodies()).toEqual([{ script_url: 'new.js' }]);
    expect(calls(/\/api\/assets\/5$/, 'DELETE').length).toBe(0);
  });

  it('Remove confirms first: Cancel sends nothing; OK unlinks, reloads and toasts', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledWith('Remove the app script? Students will see an empty app.');
    expect(patchBodies()).toEqual([]);
    confirmSpy.mockReturnValue(true);
    scriptBtn('Remove').click();
    await settle();
    await settle();
    expect(patchBodies()).toEqual([{ script_url: null }]);
    expect(calls(/\/admin-tree$/).length).toBe(1);
    expect(toastTexts()).toContain('App removed');
  });

  it('the footer Save sends the title alone', async () => {
    await render({ item: { type: 'interactive_app', script_url: null } });
    type(titleInput(), 'App 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'App 2' }]);
    expect(dirtyText()).toBe('');
  });

  it('the ready preview: the 360px frame, the meta, and the blank-preview hint in the card footer', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    await settle();
    const card = panel().querySelector('.app-preview')!;
    expect(card.querySelector('.preview-meta')!.textContent).toBe('interactive app');
    const frame = card.querySelector<HTMLElement>('.frame')!;
    expect(frame.classList.contains('fixed')).toBe(true);
    expect(frame.style.getPropertyValue('--frame-h')).toBe('360px');
    expect(card.querySelector('.blank-hint')!.textContent).toContain('Blank preview?');
  });

  it('read-only with no script: "No app." and no script buttons', async () => {
    await render({ item: { type: 'interactive_app', script_url: null }, version: { state: 'archived' } });
    expect(panel().querySelector('.app-hint')!.textContent).toBe('No app.');
    expect(panel().querySelector('.script-row button')).toBeNull();
  });

  it("a failed source fetch: \"couldn't be loaded\", and the stored filename is never a link", async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp('', 404)) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' }, version: { state: 'archived' } });
    await settle();
    expect(panel().querySelector('iframe')).toBeNull();
    expect(panel().querySelector('.app-hint')!.textContent).toBe("This app couldn't be loaded.");
    expect(panel().querySelectorAll('a').length).toBe(0);
  });

  it('closing the modal mid-upload still links the script and throws nothing', async () => {
    let release!: () => void;
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST'
      ? new Promise<Response>((r) => { release = () => r(resp(APP_ASSET)); }) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => uploadPosts().length > 0);
    unmount(cmp!); cmp = null;
    release();
    await waitUntil(() => patchBodies().length > 0);
    await settle();
    expect(patchBodies()).toEqual([{ script_url: 'new.js' }]);
    expect(calls(/\/api\/assets\/5$/, 'DELETE').length).toBe(0);
  });

  it('AppBody tolerates `item` going undefined (a dying branch re-running its effect)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const p = $state<{ item: AdminTreeItem | undefined; vid: number; editable: boolean; versionDisabled: boolean; frozen: boolean; stillOnVid: () => boolean }>({
      item: mkItem({ type: 'interactive_app', script_url: 'app.js' }), vid: 1, editable: true,
      versionDisabled: false, frozen: false, stillOnVid: () => true,
    });
    const c = mount(AppBody, { target: host, props: p });
    await settle();
    expect(() => { p.item = undefined; flushSync(); }).not.toThrow();
    unmount(c);
    host.remove();
  });
});
```

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts src/tests/VideoFrame.svelte.test.ts src/tests/InteractiveFrame.svelte.test.ts`
Expected: FAIL.
- `AppBody.svelte` cannot be resolved, so the whole modal file fails to load.
- The frame tests fail: there is no `fixed` class.

- [ ] **Step 2: Frame heights (R3)**

`frontend/src/components/items/VideoFrame.svelte` (full content):

```svelte
<script lang="ts">
  // Shared 16:9 iframe wrapper. Used by the student-side VideoItem and the
  // editor's video preview card. Keeping the aspect-ratio CSS in one place
  // ensures both surfaces stay in visual sync; callers pass a sanitized `src`
  // (see lib/safeIframeUrl). Slice-5b D13: an optional `height` (the editor's
  // 296px player) replaces the 16:9 box, and the frame then zeroes its own
  // bottom margin, so the editor card needs no :global (R3).
  let { src, title, height }: { src: string; title: string; height?: number } = $props();
</script>

<div class="frame" class:fixed={height !== undefined} style:--frame-h={height !== undefined ? `${height}px` : undefined}>
  <iframe {src} {title} allowfullscreen></iframe>
</div>

<style>
  .frame { position: relative; padding-bottom: 56.25%; height: 0; margin-bottom: var(--space-3); }
  .frame.fixed { padding-bottom: 0; height: var(--frame-h); margin-bottom: 0; /* (c): the caller sizes it */ }
  .frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
```

`frontend/src/components/items/InteractiveFrame.svelte`:
- Replace `  let { scriptSource, title }: { scriptSource: string; title: string } = $props();` with:
```ts
  // Slice-5b D14: an optional `height` (the editor's 360px preview) replaces
  // the 600px default and zeroes the frame's own bottom margin (R3).
  let { scriptSource, title, height }: { scriptSource: string; title: string; height?: number } = $props();
```
- Replace `<div class="frame">` with:
```svelte
<div class="frame" class:fixed={height !== undefined} style:--frame-h={height !== undefined ? `${height}px` : undefined}>
```
- Replace `  .frame { width: 100%; height: 600px; margin-bottom: var(--space-3); }` with:
```css
  .frame { width: 100%; height: 600px; margin-bottom: var(--space-3); }
  .frame.fixed { height: var(--frame-h); margin-bottom: 0; /* (c): the caller sizes it */ }
```

- [ ] **Step 3: `VideoBody` — the preview card**

In `frontend/src/components/editor/item/VideoBody.svelte`:

(a) After the `previewUrl` debounce `$effect` block, insert:
```ts
  // D13: the provider only (no duration data). `previewUrl` already passed
  // safeIframeUrl, so it parses.
  function providerOf(url: string): string {
    const host = new URL(url).hostname.toLowerCase();
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === 'youtu.be') return 'youtube';
    if (/(^|\.)vimeo\.com$/.test(host)) return 'vimeo';
    return 'embed';
  }
  const provider = $derived(previewUrl ? providerOf(previewUrl) : null);
```

(b) Replace:
```svelte
{#if previewUrl}
  <VideoFrame src={previewUrl} title={item.title || 'Video preview'} />
{/if}
```
with:
```svelte
<div class="video-preview">
  <div class="preview-head">
    <span class="preview-title">Preview</span>
    {#if provider}<span class="mono preview-meta">{provider}</span>{/if}
  </div>
  <div class="preview-area">
    {#if previewUrl}
      <VideoFrame src={previewUrl} title={item.title || 'Video preview'} height={296} />
    {:else}
      <p class="preview-empty">No preview</p>
    {/if}
  </div>
  <div class="preview-foot">
    {#if previewUrl}
      <span class="mono preview-status">embed resolved</span>
      <a class="open-link" href={previewUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a>
    {:else}
      <span class="mono preview-status">no embed — paste a YouTube or Vimeo link</span>
    {/if}
  </div>
</div>
```

(c) Append inside `<style>`, before `</style>`:
```css
  .video-preview { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; /* ref 1813 */ }
  .preview-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border); /* ref 1814 — #E9EBEF → --border */
  }
  .preview-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1815 */ }
  .preview-meta { font-size: 11.5px; color: var(--muted); /* ref 1816 */ }
  .preview-area { height: 296px; background: var(--surface-2); /* ref 1818 — D13 */ }
  .preview-empty {
    margin: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--muted); /* D13 */
  }
  .preview-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-soft);
    background: var(--surface-3); /* ref 1821 — #F0F1F4 → --border-soft */
  }
  .preview-status { font-size: 11.5px; color: var(--muted); /* ref 1822 */ }
  .open-link { margin-left: auto; font-size: 12.5px; color: var(--primary); /* ref 1823 */ }
```

- [ ] **Step 4: `components/editor/item/AppBody.svelte`** (full content)

```svelte
<script lang="ts">
  // Interactive-app body (D4; no artboard, so it borrows 3e). Implements
  // ItemBodyApi (§2). The App script row acts immediately (files, not drafts);
  // the footer Save sends only the title. Previews the stored app in the real
  // strict-sandboxed frame (fetch → inline). NEVER renders a stored filename as
  // a link (security §6/§9).
  import { onDestroy } from 'svelte';
  import InteractiveFrame from '../../items/InteractiveFrame.svelte';
  import Button from '../../ui/Button.svelte';
  import { fetchAssetSource, uploadAsset, deleteAsset, type AssetResponse } from '../../../lib/assets';
  import { scanAppSource } from '../../../lib/appSourceScan';
  import { api, ApiError } from '../../../lib/api';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../../lib/itemBody';
  import { loadAdminTree } from '../../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../../stores/toasts.svelte';
  import type { AdminTreeItem } from '../../../lib/types';

  // `item` tolerates undefined: if a tree reload drops the item, a dying branch
  // may re-run this component's effect once with the new prop before teardown.
  let {
    item, vid, editable, versionDisabled, frozen, stillOnVid, busy = $bindable(false),
  }: {
    item: AdminTreeItem | undefined; vid: number; editable: boolean; versionDisabled: boolean;
    frozen: boolean; stillOnVid: (v: number) => boolean; busy?: boolean;
  } = $props();

  let alive = true;
  onDestroy(() => { alive = false; });

  let source = $state<string | null>(null);
  let status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty');

  // Re-previews on Replace/Remove (the item prop follows the reloaded tree).
  // AbortController + `stale` stop an out-of-order fetch flashing old source.
  // D6/R5: a disabled version fetches nothing (the asset route is a 403).
  $effect(() => {
    const filename = item?.script_url ?? null;
    if (versionDisabled || !filename) { status = 'empty'; source = null; return; }
    status = 'loading';
    source = null;
    const controller = new AbortController();
    let stale = false;
    void fetchAssetSource(vid, filename, controller.signal)
      .then((text) => { if (!stale) { source = text; status = 'ready'; } })
      .catch((e: unknown) => {
        if (stale || (e as { name?: string })?.name === 'AbortError') return;
        status = 'error';
        source = null;
      });
    return () => { stale = true; controller.abort(); };
  });

  let uploadBusy = $state(false);
  let warnings = $state<string[]>([]);
  let uploadError = $state<string | null>(null);
  let fileEl = $state<HTMLInputElement>();
  $effect(() => { busy = uploadBusy; });

  // FileReader, not File.prototype.text(): this project's jsdom lacks text().
  function readText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  async function onFileChosen(e: Event) {
    if (uploadBusy || frozen || !item) return;
    // Pin before any await: `item` is live and `vid` can change under us.
    const itemId = item.id;
    const savedVid = vid;
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-choosing the same filename
    if (!file) return;
    uploadError = null;
    warnings = [];
    uploadBusy = true;
    // uploadAsset commits the Asset independently of the PATCH that references
    // it, so a failed PATCH would strand an orphan that also blocks a retry
    // with a 409. On failure BEFORE linking, delete it. A reload failure AFTER
    // the link is not an orphan, so clean-up is gated on `linked`.
    let uploaded: AssetResponse | null = null;
    let linked = false;
    try {
      const text = await readText(file);
      if (text.trim() === '') {
        if (alive) uploadError = 'The file is empty — choose a non-empty .js file.';
        return;
      }
      if (alive) warnings = scanAppSource(text); // advisory, non-blocking
      uploaded = await uploadAsset(savedVid, file);
      await api.patch(`/api/items/${itemId}`, { script_url: uploaded.filename });
      linked = true;
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      pushToast('App uploaded', 'success');
    } catch (err) {
      if (uploaded && !linked) {
        // Best-effort: a failed clean-up leaves the orphan removable in the
        // asset manager; never surface a clean-up error.
        try { await deleteAsset(uploaded.id); } catch { /* ignore */ }
      }
      if (!alive) return;
      if (err instanceof ApiError && err.status === 409) {
        uploadError = 'A file with that name already exists. Rename it or remove the old one first.';
      } else {
        uploadError = err instanceof ApiError ? err.displayMessage : 'Upload failed.';
      }
    } finally {
      if (alive) uploadBusy = false;
    }
  }

  async function removeApp() {
    if (uploadBusy || frozen || !item) return;
    if (!confirm('Remove the app script? Students will see an empty app.')) return;
    const itemId = item.id;
    const savedVid = vid;
    uploadBusy = true;
    uploadError = null;
    try {
      await api.patch(`/api/items/${itemId}`, { script_url: null });
      if (stillOnVid(savedVid)) await loadAdminTree(savedVid, { force: true });
      if (alive) warnings = [];
      pushToast('App removed', 'success');
    } catch (err) {
      if (alive) uploadError = err instanceof ApiError ? err.displayMessage : 'Remove failed.';
    } finally {
      if (alive) uploadBusy = false;
    }
  }

  // ---- ItemBodyApi. No drafts here: the title is the modal's. ----
  export function validate(): boolean { return true; }
  export function discard(): void {}
  export function discardAll(): void {}
  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    if (titleDraft === undefined) return { outcome: 'ok' };
    if (!item) return { outcome: 'failed' };
    const savedVid = vid;
    try {
      const echo = await patchItem(item.id, { title: titleDraft });
      return { outcome: 'ok', savedTitle: echo.title };
    } catch (e) {
      reportSaveFailure(e, savedVid, stillOnVid);
      return { outcome: 'failed' };
    }
  }
</script>

{#if item}
  <div class="field-row">
    <span class="field-label">App script</span>
    <div class="script-row">
      <span class="mono script-name" class:none={!item.script_url}>{item.script_url ?? 'No script'}</span>
      {#if editable}
        <input
          bind:this={fileEl}
          type="file"
          accept=".js,application/javascript"
          hidden
          disabled={uploadBusy || frozen}
          onchange={onFileChosen}
        />
        <Button variant="secondary" disabled={uploadBusy || frozen} onclick={() => fileEl?.click()}>
          {item.script_url ? 'Replace' : 'Upload'}
        </Button>
        {#if item.script_url}
          <Button variant="ghost" disabled={uploadBusy || frozen} onclick={() => void removeApp()}>Remove</Button>
        {/if}
      {/if}
    </div>
  </div>
  {#if editable && uploadError}<p class="field-err" role="alert">{uploadError}</p>{/if}
  {#if editable && warnings.length}
    <ul class="warnings">
      {#each warnings as w}<li>{w}</li>{/each}
    </ul>
  {/if}

  {#if !versionDisabled}
    <div class="app-preview">
      <div class="preview-head">
        <span class="preview-title">Preview</span>
        <span class="mono preview-meta">interactive app</span>
      </div>
      {#if status === 'ready' && source !== null}
        <div class="preview-area">
          <InteractiveFrame scriptSource={source} title={item.title || 'Interactive app'} height={360} />
        </div>
        {#if editable}
          <!-- Spec §8/§10: a blank render can't be detected from JS (opaque
               origin), so a static hint sits beside a rendered preview only. -->
          <div class="preview-foot">
            <span class="blank-hint">Blank preview? The most common cause is an ES-module build instead of a single classic/IIFE bundle — see the tutorial.</span>
          </div>
        {/if}
      {:else if status === 'loading'}
        <div class="preview-area" aria-busy="true"></div>
      {:else if status === 'error'}
        <p class="app-hint">This app couldn't be loaded.</p>
      {:else}
        <p class="app-hint">{editable ? 'No app uploaded yet. Choose a .js file to upload.' : 'No app.'}</p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .field-row {
    display: grid;
    grid-template-columns: 132px 1fr; /* ref 1808 — D4 borrows 3e's row; D2 drops the pencil slot */
    align-items: center;
    gap: 12px;
  }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .script-row { display: flex; align-items: center; gap: 9px; min-width: 0; /* ref 1750 — the dense button gap */ }
  .script-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    color: var(--text); /* ref 1810 — the mono value */
  }
  .script-name.none { color: var(--muted); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  /* D11: the information-banner colour treatment at sidebar size. */
  .warnings {
    margin: 0;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    color: var(--text-3);
  }
  .app-preview { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; /* ref 1813 */ }
  .preview-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border); /* ref 1814 — #E9EBEF → --border */
  }
  .preview-title { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1815 */ }
  .preview-meta { font-size: 11.5px; color: var(--muted); /* ref 1816 */ }
  .preview-area { height: 360px; background: var(--surface-2); /* D14 */ }
  .app-hint {
    margin: 0;
    padding: 8px 10px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 11.5px;
    color: var(--text-3); /* D11 — was .notice */
  }
  .preview-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-soft);
    background: var(--surface-3); /* ref 1821 — #F0F1F4 → --border-soft */
  }
  .blank-hint { font-size: 12px; color: var(--muted); }
</style>
```

- [ ] **Step 5: Wire `AppBody` into `ItemEditorModal.svelte`; delete `InteractiveAppEditor`**

In `frontend/src/components/editor/ItemEditorModal.svelte`:
- Replace `  import InteractiveAppEditor from '../items/InteractiveAppEditor.svelte';` with `  import AppBody from './item/AppBody.svelte';`.
- Replace the comment:
```ts
  // ---- The type body (§2 contract). Quiz and app have none until T5a / T4;
  //      VideoBody has no `busy` (nothing in it uploads). ----
```
with:
```ts
  // ---- The type body (§2 contract). The quiz has none until T5a. VideoBody
  //      has no `busy` (nothing uploads); AppBody has no drafts (its script
  //      row acts immediately), so it binds `busy` only. ----
```
- Replace the comment `  // Interim (quiz until T5a, app until T4): no body API, so the modal sends the title.` with `  // Interim (quiz until T5a): no body API, so the modal sends the title.`
- Replace the whole interim app branch, from `  {:else if item.type === 'interactive_app'}` through its `{/if}` (the one closing `{#if !versionDisabled}`), with:
```svelte
  {:else if item.type === 'interactive_app'}
    <AppBody
      bind:this={body}
      {item}
      {vid}
      editable={canEditText}
      {versionDisabled}
      {frozen}
      {stillOnVid}
      bind:busy={bodyBusy}
    />
```

Delete the old editor and its tests (the ports above replace them):
```bash
git rm frontend/src/components/items/InteractiveAppEditor.svelte frontend/src/tests/InteractiveAppEditor.svelte.test.ts
```

In `frontend/src/tests/InteractiveAppItem.svelte.test.ts`, replace:
```ts
  // hash-coupled to the `.interactive-app` anchor, since `.notice` is not
  // component-unique (InteractiveAppEditor authors one and keeps its italic).
```
with:
```ts
  // hash-coupled to the `.interactive-app` anchor. (Until Slice 5b the editor
  // authored a `.notice` too; its AppBody successor renamed it `.app-hint`.)
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/ItemEditorModal.svelte.test.ts src/tests/VideoFrame.svelte.test.ts src/tests/InteractiveFrame.svelte.test.ts src/tests/InteractiveAppItem.svelte.test.ts src/tests/VideoItem.svelte.test.ts`
Expected: PASS. The two student-item files stay green: neither passes `height`.

- [ ] **Step 7: Gate — section (ad) and the `.notice` target**

(a) **The `.notice` target.** In the `TARGETS` list, replace:
```python
    # Two rightful authors each: .opts is Single+Multi; .notice is
    # InteractiveAppItem + the out-of-scope InteractiveAppEditor.
    ('option groups',         r'\.opts\.svelte-[a-z0-9]+$', 2),
    ('notices',               r'\.notice\.svelte-[a-z0-9]+$', 2),
```
with:
```python
    # .opts has two rightful authors (Single+Multi). .notice had two until
    # Slice 5b replaced InteractiveAppEditor with AppBody (whose rule is
    # .app-hint), so InteractiveAppItem is now its only author.
    ('option groups',         r'\.opts\.svelte-[a-z0-9]+$', 2),
    ('notices',               r'\.notice\.svelte-[a-z0-9]+$', 1),
```
Then replace the comment block:
```zsh
# .notice is NOT component-unique: InteractiveAppEditor.svelte authors it too
# (out of scope, and it legitimately keeps its italic). Anchor on the name-unique
# .interactive-app hash, or this judges the wrong component.
```
with:
```zsh
# .notice was not component-unique until Slice 5b (InteractiveAppEditor authored
# one too). Stay anchored on the name-unique .interactive-app hash anyway, so a
# future second author can never be the one judged here.
```
Also update the `# .notice and .opts each have TWO rightful authors; everything else must be` comment line above `FC = …` to `# .opts has TWO rightful authors; everything else must be`.

(b) First build, then read the emitted rules and pin those spellings:
`npm run build >/dev/null && grep -oE '\.(video-preview|app-preview|preview-[a-z]+|app-hint|frame)[.a-z]*\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`

Then insert after section (ac):

```zsh
echo
echo "--- (ad) Slice-5b T4 — VideoBody card (3e), AppBody (D4), frame heights ---"
own video-preview VideoBody.svelte
uniq1 video-preview
if [[ -n $REPLY ]]; then
  N=VideoBody; H=$REPLY
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:center' 'gap:12px'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\.${H}:focus-visible" 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  d '\.field-hint' '' 'font-size:12px' 'color:var\(--muted\)'
  d '\.video-preview' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden'
  d '\.preview-head' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.preview-title' '' 'flex:1' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.preview-meta' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.preview-area' '' 'height:296px' 'background:var\(--surface-2\)'
  d '\.preview-empty' '' 'height:100%' 'display:flex' 'align-items:center' 'justify-content:center' 'font-size:12px' 'color:var\(--muted\)'
  d '\.preview-foot' '' 'display:flex' 'gap:12px' 'padding:8px 12px' 'border-top:1px solid var\(--border-soft\)' 'background:var\(--surface-3\)'
  d '\.preview-status' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.open-link' '' 'margin-left:auto' 'font-size:12\.5px' 'color:var\(--primary\)'
  none "VideoBody preview footer rule is the soft one, not --border" "\.preview-foot\.${H}\{[^}]*border-top:1px solid var\(--border\)[;}]"
  none "VideoBody URL row has no 54px pencil slot (D2)" "\.field-row\.${H}\{[^}]*54px"
  none "VideoBody no rem font sizes" "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep VideoBody $H
fi

own app-preview AppBody.svelte
uniq1 app-preview
if [[ -n $REPLY ]]; then
  N=AppBody; H=$REPLY
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:center' 'gap:12px'
  d '\.script-row' '' 'display:flex' 'align-items:center' 'gap:9px'
  d '\.script-name' '' 'font-size:12\.5px' 'color:var\(--text\)' 'text-overflow:ellipsis'
  d '\.app-preview' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden'
  d '\.preview-head' '' 'display:flex' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.preview-area' '' 'height:360px' 'background:var\(--surface-2\)'
  d '\.app-hint' '' 'margin:0' 'padding:8px 10px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:11\.5px' 'color:var\(--text-3\)'
  d '\.warnings' '' 'padding:8px 10px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:11\.5px' 'color:var\(--text-3\)'
  d '\.preview-foot' '' 'border-top:1px solid var\(--border-soft\)' 'background:var\(--surface-3\)'
  d '\.blank-hint' '' 'font-size:12px' 'color:var\(--muted\)'
  none "AppBody .notice renamed .app-hint (D4)" "\.notice\.${H}"
  none "AppBody no italic notices" "\.[a-z-]+\.${H}[^{]*\{[^}]*font-style:italic"
  none "AppBody no rem font sizes" "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep AppBody $H
fi

# R3: the shared frames size themselves when given `height`; the student
# defaults (16:9, 600px) stay. Anchored on each default rule's declarations,
# since both components author `.frame`.
VFH=(${(f)"$(grep -oE '\.frame\.svelte-[a-z0-9]+\{position:relative;padding-bottom:56\.25%' $CSS | grep -oE 'svelte-[a-z0-9]+' | sort -u)"})
IFH=(${(f)"$(grep -oE '\.frame\.svelte-[a-z0-9]+\{width:100%;height:600px' $CSS | grep -oE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#VFH[@]} -eq 1 && ${#IFH[@]} -eq 1 ]]; then
  echo "PASS  VideoFrame and InteractiveFrame defaults resolve to one hash each"
  N=VideoFrame; chk "\.frame\.fixed\.${VFH[1]}" 'padding-bottom:0' 'height:var\(--frame-h\)' 'margin-bottom:0'
  N=InteractiveFrame; chk "\.frame\.fixed\.${IFH[1]}" 'height:var\(--frame-h\)' 'margin-bottom:0'
else
  echo "FAIL  frame defaults not unique (VideoFrame ${#VFH[@]}, InteractiveFrame ${#IFH[@]})"; fail=1
fi
emoji_scan "VideoBody / AppBody / frames" src/components/editor/item/VideoBody.svelte src/components/editor/item/AppBody.svelte src/components/items/VideoFrame.svelte src/components/items/InteractiveFrame.svelte
```

Run the gate. The only FAIL is the count; set `EXPECTED_CHECKS` to the printed N and re-run.
Expected: `VISUAL-REFRESH GATE: ALL PASS (N checks)`.

**Mutation-test** (Constraint 12). For each, mutate, re-run, check that the named check goes red, then revert:
- VideoBody `.preview-area` `296px` → `300px` → the pin FAILs;
- VideoBody `.preview-foot` `--border-soft` → `--border` → the pin **and** the negative FAIL;
- AppBody `.app-hint` `color: var(--text-3)` → `#5d4037` → the pin **and** the sweep FAIL;
- AppBody: add `.notice { margin: 0; }` → the `notices` target (count 1) **and** the rename negative FAIL;
- VideoFrame `.frame.fixed`: drop `margin-bottom: 0` → the pin FAILs.

- [ ] **Step 8: Full verification**

Run: `npm test 2>&1 | tail -4`, `npm run check 2>&1 | tail -1`, `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.

Expected:
- tests: 135 files (−1 deleted, +1 new), 1671 tests;
  - the arithmetic: 1663 − 13 deleted + 2 VideoFrame + 1 InteractiveFrame + 18 in `ItemEditorModal` (4 video card, 14 app body; the 2 interim app tests are replaced, not added);
  - all pass;
- check: 0 errors, warnings ≤ 18;
- gate: `ALL PASS`.

Then run `grep -rn "InteractiveAppEditor" frontend/src frontend/scripts`. Only comment mentions may remain; T7 rewrites them.

- [ ] **Step 9: Review** (both lanes, uncommitted diff plus the staged deletions; Review Focus 4), then wait for the user's OK.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/editor/item/AppBody.svelte frontend/src/tests/VideoFrame.svelte.test.ts frontend/src/components/editor/item/VideoBody.svelte frontend/src/components/editor/ItemEditorModal.svelte frontend/src/components/items/VideoFrame.svelte frontend/src/components/items/InteractiveFrame.svelte frontend/src/tests/ItemEditorModal.svelte.test.ts frontend/src/tests/InteractiveFrame.svelte.test.ts frontend/src/tests/InteractiveAppItem.svelte.test.ts frontend/scripts/visual-refresh-gate.sh
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5b T4 — video preview card, AppBody, frame heights

VideoBody's preview becomes the 3e card (296px player, provider meta,
embed status, Open in new tab). AppBody replaces InteractiveAppEditor
(App script row, Remove confirms, 360px preview, busy interlock). The
shared frames take an optional height (R3). Gate (ad); .notice target 2 → 1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5a: Quiz draft model + one Save (§5.1–5.3, D10, D20, D25, `frozen`)

**What this task builds.** The quiz becomes a real body of the modal. Question text, explanation, the numeric and text answers, option text and the correct marks all stop being immediate writes. They become drafts, and the footer Save sends them (D3).

**`QuestionAccordion`** owns its drafts on the always-mounted accordion, so they survive collapse:
- **Question drafts** (`draft` / `saved`), as today.
- **Option drafts**, a `$state` record keyed by option id: `{ text, is_correct }`. The loaded `options` array is the *saved* state.
  - `setOptions()` is the one assignment point. A new id gets a draft from the server and a gone id loses its draft. For a surviving id, each **clean** field follows the server and each **dirty** field keeps the author's text.
  - Because the saved baseline is the `options` array itself, no `makeDirtyTracker` is needed for options, and `lib/dirty.svelte.ts` stays unchanged.
- **Correct marks** (D25):
  - a single-choice radio drafts that option `true` and its siblings `false`;
  - a checkbox drafts only itself;
  - the `correct` badge, the row's `correct` class and the header count all follow the **draft**.
- **Contributor.** Each accordion registers one save contributor on `QUIZ_SAVE_KEY` (and one tracker in `QuizEditor`'s private registry). The contributor provides:
  - `validate()`: dirty-scoped (D10);
  - `focusFirstInvalid()`;
  - `save()`: §5.3 order, per-field write-back, stops at the first failure, and gives the "Saved partly" note on a split single-choice key;
  - `discard()`;
  - `keyChanged()` (D20);
  - `locked()`;
  - `lastError` (R4) and `title()`.
- **Removed:** the per-question Save/Discard, the option blur-commit, the immediate `toggleCorrect`, OptionRow's controlled-input workaround, and the per-question `confirmKeyChange` latch.
- **Text-side option lock dropped.** The text-side half of the option lock (`textLocked`, which *disabled* the editors during an option mutation) goes too. Drafts are local now, so typing during an option add/delete/reorder is harmless.
- **Kept until T5b:** the other half of the two-way lock. A dirty question still disables its own structure and option structure, so this task never has to reason about structure under drafts.

**`QuizEditor`** implements the §2 body contract:
- **Props:** `frozen`, `versionDisabled` and `stillOnVid`; bindable `saveDirty` / `guardDirty` / `busy`.
- **Exports:** `save(titleDraft)`, `discard`, `discardAll` and `validate`.
- **`save`:**
  - **one** D20 confirm before anything is sent;
  - then `PATCH {title}`;
  - then the dirty contributors in display order;
  - it stops at the first failure with the toast `Question N: <message> — Save again to send the rest.`, expanding that question;
  - it returns `'partial'` when anything had already succeeded.
- **Removed:** the title row, `itemTitle`, `quizDirty`, `showTitle` and the per-question latch.

**`ItemEditorModal`'s quiz branch** binds the body like the others. The interim bridge from T3a is gone. `saveTitleOnly` stays, for the unknown-type fallback.

**Files:**
- Create: `frontend/src/lib/quizSave.ts`
- Modify (full rewrites):
  - `frontend/src/components/editor/QuestionAccordion.svelte`
  - `frontend/src/components/editor/QuizEditor.svelte`
  - `frontend/src/components/editor/OptionRow.svelte`
  - `frontend/src/tests/support/QuestionAccordionHarness.svelte`
  - `frontend/src/tests/QuestionAccordion.svelte.test.ts`
  - `frontend/src/tests/QuizEditor.svelte.test.ts`
  - `frontend/src/tests/OptionRow.svelte.test.ts`
- Modify (edits): `frontend/src/components/editor/ItemEditorModal.svelte`, `frontend/src/tests/ItemEditorModal.svelte.test.ts`

**Interfaces:**
- Consumes:
  - `lib/itemBody.ts` (T3a): `SaveOutcome`, `patchItem`, `reportSaveFailure`;
  - `MarkdownEditor` (T2): `plain`, `frozen`, bindable `value` / `uploading`;
  - `createDirtyRegistry` / `DIRTY_REGISTRY_KEY` / `RegisteredTracker`.
- Produces (T5b and T6 rely on these exact names):
  - `lib/quizSave.ts`:
    - `QUIZ_SAVE_KEY` and `QUIZ_GUARD_KEY` (symbols);
    - `QuizContributor`;
    - `QuizSaveHub { register(c); unregister(c) }`.
  - **Body props:**
    - `QuestionAccordion`: `question, vid, index, count, perms, assetContext, expanded, locked, onExpandToggle, onDelete, onMoveUp, onMoveDown, versionDisabled?, frozen?`;
    - `QuizEditor`: `itemId, vid, version, perms, assetContext, stillOnVid, versionDisabled?, frozen?`, bindable `saveDirty` / `guardDirty` / `busy`;
    - `OptionRow`: `option, index, count, questionType, perms, draft (bindable), correct, frozen, optionsLocked, canDelete, mutating, onMark(next), onDelete, onMoveUp, onMoveDown`.
  - **DOM hooks:**
    - `[data-testid="question-header"]`, with `aria-invalid="true"` and `span[data-testid="needs-fixing"]` after a failed validate;
    - `[data-field="text"]` wraps the question-text editor;
    - `p[data-testid="text-error"]`, `p[data-testid="mark-error"]`, `p[data-testid="save-error"]`, `p[data-testid="save-note"]`;
    - the option row `div.option` gets the class `correct` from the draft mark;
    - the add buttons carry `aria-label="Add option"` / `aria-label="Add question"`.

- [ ] **Step 1: Write the failing tests**

File `frontend/src/tests/OptionRow.svelte.test.ts` (full content, replacing the file):

```ts
import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import OptionRow from '../components/editor/OptionRow.svelte';
import type { AuthoringOption } from '../lib/quizAuthoring';
import { versionPermissions } from '../lib/versionPermissions';

const PERMS = versionPermissions({ state: 'created', is_disabled: false });
const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 7, text: 'Paris', is_correct: false, order: 1, ...over,
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountRow(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
    option: opt(), index: 1, count: 3, questionType: 'single_choice', perms: PERMS,
    draft: opt().text, correct: false, frozen: false, optionsLocked: false, canDelete: true, mutating: false,
    onMark: vi.fn(), onDelete: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), ...over,
  });
  const cmp = mount(OptionRow, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, props };
}
const textInput = (t: HTMLElement) => t.querySelector('[data-testid="option-text"]') as HTMLInputElement;
const btn = (t: HTMLElement, label: string) => t.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

it('renders the bound draft text', () => {
  const { target } = mountRow({ draft: 'Berlin' });
  expect(textInput(target).value).toBe('Berlin');
});

it('typing writes the bound draft; nothing is committed (the footer Save sends it)', () => {
  const { target, props } = mountRow();
  textInput(target).value = 'Rome';
  textInput(target).dispatchEvent(new Event('input', { bubbles: true }));
  textInput(target).dispatchEvent(new Event('blur'));
  flushSync();
  expect(props.draft).toBe('Rome');
  expect(props.onMark).not.toHaveBeenCalled();
});

it('the correct badge and the row class follow the DRAFT mark, not the saved one (D25)', () => {
  const a = mountRow({ correct: true, option: opt({ is_correct: false }) });
  expect(a.target.querySelector('[data-testid="option-correct"]')!.textContent).toBe('correct');
  expect(a.target.querySelector('.option')!.classList.contains('correct')).toBe(true);
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const b = mountRow({ correct: false, option: opt({ is_correct: true }) });
  expect(b.target.querySelector('[data-testid="option-correct"]')).toBeNull();
  expect(b.target.querySelector('.option')!.classList.contains('correct')).toBe(false);
});

it('↑/↓/delete fire their callbacks', () => {
  const onMoveUp = vi.fn(), onMoveDown = vi.fn(), onDelete = vi.fn();
  const { target } = mountRow({ index: 2, count: 3, onMoveUp, onMoveDown, onDelete });
  btn(target, 'Move option up').click();
  btn(target, 'Move option down').click();
  btn(target, 'Delete option').click();
  expect(onMoveUp).toHaveBeenCalledOnce();
  expect(onMoveDown).toHaveBeenCalledOnce();
  expect(onDelete).toHaveBeenCalledOnce();
});

it('optionsLocked disables the structure buttons but leaves the text and the mark editable', () => {
  const { target } = mountRow({ index: 2, count: 3, optionsLocked: true });
  expect(btn(target, 'Move option up').disabled).toBe(true);
  expect(btn(target, 'Delete option').disabled).toBe(true);
  expect(textInput(target).readOnly).toBe(false);
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(false);
});

it('frozen: the text is readonly without losing focus, and the mark is disabled (D10)', () => {
  const { target, props } = mountRow();
  textInput(target).focus();
  props.frozen = true;
  flushSync();
  expect(textInput(target).readOnly).toBe(true);
  expect(document.activeElement).toBe(textInput(target));
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(true);
});

it('canDelete=false disables only delete (C2)', () => {
  const { target } = mountRow({ index: 2, canDelete: false });
  expect(btn(target, 'Delete option').disabled).toBe(true);
  expect(btn(target, 'Move option up').disabled).toBe(false);
});

it('reorder boundaries disable ↑ at top and ↓ at bottom', () => {
  const top = mountRow({ index: 1, count: 3 });
  expect(btn(top.target, 'Move option up').disabled).toBe(true);
  expect(btn(top.target, 'Move option down').disabled).toBe(false);
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const bottom = mountRow({ index: 3, count: 3 });
  expect(btn(bottom.target, 'Move option down').disabled).toBe(true);
});

it('single_choice: a radio reflecting the draft mark; picking it calls onMark(true)', () => {
  const onMark = vi.fn();
  const { target } = mountRow({ questionType: 'single_choice', correct: false, onMark });
  const radio = target.querySelector('input[type="radio"]') as HTMLInputElement;
  expect(radio.checked).toBe(false);
  radio.click();
  expect(onMark).toHaveBeenCalledWith(true);
});

it('multiple_choice: a checkbox reflecting the draft mark; clicking it calls onMark with the new state', () => {
  const onMark = vi.fn();
  const { target } = mountRow({ questionType: 'multiple_choice', correct: true, onMark });
  const box = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(box.checked).toBe(true);
  box.click();
  expect(onMark).toHaveBeenCalledWith(false);
});

it('mutating keeps the structure buttons natively enabled, so a clicked button keeps focus', () => {
  // In flight the accordion passes optionsLocked AND mutating; its handlers
  // guard re-entry. Disabling the clicked button would blur it to <body>.
  const { target } = mountRow({ index: 2, count: 3, optionsLocked: true, mutating: true });
  expect(btn(target, 'Move option up').disabled).toBe(false);
});

it('a read-only version: text readonly, mark disabled, no structure buttons', () => {
  const RO = versionPermissions({ state: 'archived', is_disabled: false });
  const { target } = mountRow({ perms: RO });
  expect(textInput(target).readOnly).toBe(true);
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(true);
  expect(btn(target, 'Delete option')).toBeNull();
});
```

File `frontend/src/tests/support/QuestionAccordionHarness.svelte` (full content):

```svelte
<script lang="ts">
  // Provides what QuizEditor provides in production: a private dirty registry
  // (mirrored at [data-testid="any-dirty"]) and the QUIZ_SAVE_KEY hub, whose
  // register() hands the accordion's save contributor to the test through
  // the `onContributor` prop. Every other prop passes through.
  import { setContext, untrack } from 'svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_SAVE_KEY, type QuizSaveHub } from '../../lib/quizSave';
  import QuestionAccordion from '../../components/editor/QuestionAccordion.svelte';
  let props = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  const hub: QuizSaveHub = {
    register(c) { untrack(() => props.onContributor)?.(c); },
    unregister() {},
  };
  setContext(QUIZ_SAVE_KEY, hub);
</script>
<output data-testid="any-dirty">{registry.isAnyDirty() ? 'dirty' : 'clean'}</output>
<QuestionAccordion {...props} />
```

File `frontend/src/tests/QuestionAccordion.svelte.test.ts` (full content, replacing the file):

```ts
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import * as qa from '../lib/quizAuthoring';
import type { AuthoringQuestion, AuthoringOption, OptionUpdateBody } from '../lib/quizAuthoring';
import type { QuizContributor } from '../lib/quizSave';
import { versionPermissions } from '../lib/versionPermissions';
import * as store from '../stores/currentEditorVersion.svelte';
// The Harness provides the private dirty registry and the QUIZ_SAVE_KEY hub
// (QuizEditor does this in production), exposes registry.isAnyDirty() at
// [data-testid="any-dirty"], and hands the save contributor to the test.
import Harness from './support/QuestionAccordionHarness.svelte';

const PERMS = versionPermissions({ state: 'created', is_disabled: false });
const stubAssetCtx = () => ({ kind: 'course', list: vi.fn().mockResolvedValue([]), upload: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined), imgSrc: () => '', renderPreview: vi.fn().mockResolvedValue({ html: '' }) }) as never;

const q = (over: Partial<AuthoringQuestion> = {}): AuthoringQuestion => ({
  id: 1, item_id: 4, text_md: 'Q', text_html: '<p>Q</p>', type: 'numeric_answer', order: 1,
  explanation_md: null, explanation_html: null, correct_numeric: 3, precision: 0, correct_text: null, ...over,
});
const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 1, text: 'A', is_correct: false, order: 1, ...over,
});
const choiceQ = (over: Partial<AuthoringQuestion> = {}) =>
  q({ type: 'single_choice', correct_numeric: null, precision: null, ...over });
const AB = () => [opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 })];

let cleanup: (() => void) | null = null;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

function mountAccordion(question: AuthoringQuestion, over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  let contributor: QuizContributor | null = null;
  const props: Record<string, unknown> = $state({
    question, vid: 10, index: 1, count: 1, perms: PERMS, assetContext: stubAssetCtx(),
    expanded: true, locked: false, versionDisabled: false, frozen: false,
    onExpandToggle: () => {}, onDelete: () => {}, onMoveUp: () => {}, onMoveDown: () => {},
    onContributor: (c: QuizContributor) => { contributor = c; },
    ...over,
  });
  const cmp = mount(Harness, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, props, c: () => contributor! };
}
const loaded = async () => { await tick(); await tick(); flushSync(); };
const setVal = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};
const anyDirty = (t: HTMLElement) => t.querySelector('[data-testid="any-dirty"]')?.textContent;
const numInput = (t: HTMLElement) => t.querySelector('[data-testid="numeric-input"]') as HTMLInputElement;
const textArea = (t: HTMLElement) => t.querySelector('[data-field="text"] textarea') as HTMLTextAreaElement;
const optInputs = (t: HTMLElement) => [...t.querySelectorAll('[data-testid="option-text"]')] as HTMLInputElement[];
const radios = (t: HTMLElement) => [...t.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
const boxes = (t: HTMLElement) => [...t.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
const addOptionBtn = (t: HTMLElement) => t.querySelector('button[aria-label="Add option"]') as HTMLButtonElement;
const addBtn = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement;
const header = (t: HTMLElement) => t.querySelector('[data-testid="question-header"]') as HTMLElement;
const echoOption = () =>
  vi.spyOn(qa, 'updateOption').mockImplementation((id: number, body: OptionUpdateBody) =>
    Promise.resolve(opt({ id, text: body.text ?? (id === 1 ? 'A' : 'B'), is_correct: body.is_correct ?? id === 1, order: id })));

// ---- Question drafts and save() (Slice-5b T5a, §5.2-5.3) ----

it('a numeric draft is dirty; save() sends the canonical value and the echo makes it clean', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ correct_numeric: 0.05 }));
  const { target, c } = mountAccordion(q());
  setVal(numInput(target), '0.0500');
  expect(c().isDirty).toBe(true);
  expect(anyDirty(target)).toBe('dirty');
  expect(await c().save()).toBe('ok');
  flushSync();
  expect(update).toHaveBeenCalledWith(1, { correct_numeric: 0.05, precision: 0 });
  expect(numInput(target).value).toBe('0.05');            // D10 per-field write-back
  expect(c().isDirty).toBe(false);
  expect(anyDirty(target)).toBe('clean');
});

it('an invalid numeric answer shows its inline error and fails validate()', () => {
  const update = vi.spyOn(qa, 'updateQuestion');
  const { target, c } = mountAccordion(q());
  setVal(numInput(target), '1.5e-20');
  expect(target.querySelector('[role="alert"]')).not.toBeNull();
  expect(c().validate()).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

it('a precision outside 0–10 fails validate() and marks the input invalid', () => {
  const { target, c } = mountAccordion(q());
  const prec = target.querySelector('[data-testid="precision-input"]') as HTMLInputElement;
  setVal(prec, '11');
  expect(c().validate()).toBe(false);
  expect(prec.getAttribute('aria-invalid')).toBe('true');
});

it('a text answer is sent trimmed and comes back clean; over 500 characters fails validate()', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(
    q({ type: 'text_answer', correct_text: 'paris', correct_numeric: null, precision: null }));
  const { target, c } = mountAccordion(q({ type: 'text_answer', correct_text: 'answer', correct_numeric: null, precision: null }));
  const txt = target.querySelector('[data-testid="text-answer-input"]') as HTMLInputElement;
  setVal(txt, '  paris  ');
  expect(await c().save()).toBe('ok');
  flushSync();
  expect(update).toHaveBeenCalledWith(1, { correct_text: 'paris' });
  expect(txt.value).toBe('paris');
  expect(c().isDirty).toBe(false);
  setVal(txt, 'x'.repeat(501));   // jsdom does not enforce maxlength on a programmatic value
  expect(c().validate()).toBe(false);
});

it('save() sends only the changed question fields, and the header snippet follows the echo', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ text_md: 'New body', text_html: '<p>New body</p>' }));
  const { target, c } = mountAccordion(q());
  setVal(textArea(target), 'New body');
  await c().save();
  flushSync();
  expect(update).toHaveBeenCalledWith(1, { text_md: 'New body' });
  expect(header(target).textContent).toContain('New body');
});

it('discard() reverts every draft to the last-saved baseline', () => {
  const { target, c } = mountAccordion(q({ correct_numeric: 3 }));
  setVal(numInput(target), '9');
  setVal(textArea(target), 'Edited');
  c().discard();
  flushSync();
  expect(numInput(target).value).toBe('3');
  expect(textArea(target).value).toBe('Q');
  expect(c().isDirty).toBe(false);
});

it('there is no per-question Save or Discard: the modal footer sends the drafts (D2)', () => {
  const { target } = mountAccordion(q());
  const labels = [...target.querySelectorAll('button')].map((b) => b.textContent?.trim());
  expect(labels).not.toContain('Save');
  expect(labels).not.toContain('Discard');
});

it('an archived version: fields are read-only', () => {
  const { target } = mountAccordion(q(), { perms: versionPermissions({ state: 'archived', is_disabled: false }) });
  expect(numInput(target).readOnly).toBe(true);
});

it("a dirty question disables its own delete and reorder (two-way lock; T5b removes it)", () => {
  const { target } = mountAccordion(q());
  setVal(numInput(target), '7');
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
});

it('the accordion-wide `locked` prop disables structural controls even when clean', () => {
  const { target, props } = mountAccordion(q());
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(false);
  props.locked = true;
  flushSync();
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
});

it('drafts survive body collapse (they live on the always-mounted accordion)', () => {
  const { target, props, c } = mountAccordion(q());
  setVal(numInput(target), '7');
  props.expanded = false;
  flushSync();
  expect(numInput(target)).toBeNull();
  expect(anyDirty(target)).toBe('dirty');
  expect(c().isDirty).toBe(true);
  props.expanded = true;
  flushSync();
  expect(numInput(target).value).toBe('7');
});

it('a save() response that resolves after a route (vid) change is discarded (§4.1a)', async () => {
  let resolveSave!: (updated: AuthoringQuestion) => void;
  vi.spyOn(qa, 'updateQuestion').mockReturnValue(new Promise((r) => { resolveSave = r; }));
  const { target, props, c } = mountAccordion(q({ correct_numeric: 3 }));
  setVal(numInput(target), '0.05');
  const pending = c().save();
  props.vid = 11;                                   // the route moved to another version mid-save
  flushSync();
  resolveSave(q({ correct_numeric: 0.05 }));
  expect(await pending).toBe('failed');
  flushSync();
  expect(anyDirty(target)).toBe('dirty');           // baseline NOT advanced
  expect(numInput(target).value).toBe('0.05');
});

// ---- Option loading ----

it('a choice question loads its own options on mount, sorted by order', async () => {
  const list = vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 2, order: 2, text: 'Second' }), opt({ id: 1, order: 1, text: 'First' }),
  ]);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  expect(list).toHaveBeenCalledWith(1);
  expect(optInputs(target).map((i) => i.value)).toEqual(['First', 'Second']);
});

it('numeric/text questions never fetch options', async () => {
  const list = vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  mountAccordion(q());
  await loaded();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  mountAccordion(q({ type: 'text_answer', correct_numeric: null, precision: null, correct_text: 'paris' }));
  await loaded();
  expect(list).not.toHaveBeenCalled();
});

it('an option-load failure shows an inline error and Retry; Retry re-fetches', async () => {
  vi.spyOn(qa, 'listOptions')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce([opt({ id: 5, text: 'Recovered' })]);
  const { target } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await loaded();
  expect(target.querySelector('[data-testid="option-load-error"]')).not.toBeNull();
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry')!.click();
  await loaded();
  expect(optInputs(target)[0].value).toBe('Recovered');
});

it('the header counts the draft-correct options', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await loaded();
  expect(target.querySelector('[data-testid="correct-count"]')?.textContent).toContain('1');
  boxes(target)[1].click();
  flushSync();
  expect(target.querySelector('[data-testid="correct-count"]')?.textContent).toContain('2');
});

it('a late option-load response after unmount is discarded (§4.1a onDestroy token bump)', async () => {
  let resolveList!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions').mockReturnValue(new Promise((r) => { resolveList = r; }));
  mountAccordion(choiceQ());
  await tick(); flushSync();
  cleanup?.(); cleanup = null;
  let orderReads = 0;
  const trap = () => ({ id: 9, question_id: 1, text: 'Late', is_correct: false,
    get order() { orderReads++; return 1; } } as unknown as AuthoringOption);
  resolveList([trap(), trap()]);
  await loaded();
  expect(orderReads).toBe(0);
});

// ---- Option structure (immediate) ----

it('inline add: trims, blocks whitespace-only, posts {text, is_correct}', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);   // empty → the first single-choice option is correct (§8.4)
  const create = vi.spyOn(qa, 'createOption').mockResolvedValue(opt({ id: 3, text: 'Madrid', is_correct: true, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  const input = target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement;
  setVal(input, '   ');
  expect(addBtn(target).disabled).toBe(true);
  setVal(input, '  Madrid  ');
  addBtn(target).click();
  await loaded();
  expect(create).toHaveBeenCalledWith(1, { text: 'Madrid', is_correct: true });
});

it('deleting the only correct option is blocked client-side (C2)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const del = vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const delBtn0 = target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement;
  expect(delBtn0.disabled).toBe(true);
  delBtn0.click();
  await loaded();
  expect(del).not.toHaveBeenCalled();
});

it('delete removes a non-last-correct option', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const del = vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  await loaded();
  expect(del).toHaveBeenCalledWith(2);
  expect(target.querySelectorAll('[data-testid="option-row"]')).toHaveLength(1);
});

it('an option-text draft is dirty; save() PATCHes {text} and the echo makes it clean', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const upd = vi.spyOn(qa, 'updateOption').mockResolvedValue(opt({ id: 1, text: 'Alpha', is_correct: true, order: 1 }));
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[0], 'Alpha ');
  expect(anyDirty(target)).toBe('dirty');
  expect(await c().save()).toBe('ok');
  flushSync();
  expect(upd).toHaveBeenCalledWith(1, { text: 'Alpha ' });
  expect(optInputs(target)[0].value).toBe('Alpha');   // the server's normalised echo is written back
  expect(anyDirty(target)).toBe('clean');
});

it('blurring an option input sends nothing (the blur commit is gone)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const upd = vi.spyOn(qa, 'updateOption');
  const { target } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[0], 'Alpha');
  optInputs(target)[0].dispatchEvent(new Event('blur'));
  await loaded();
  expect(upd).not.toHaveBeenCalled();
  expect(anyDirty(target)).toBe('dirty');
});

it('an option-text draft survives collapsing the question (§7.1)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target, props } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[0], 'Edited');
  props.expanded = false;
  flushSync();
  expect(target.querySelector('[data-testid="option-row"]')).toBeNull();
  expect(anyDirty(target)).toBe('dirty');
});

it('option mutations are serialized; text stays editable while one is in flight', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  let resolveDel!: () => void;
  const del = vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise((r) => { resolveDel = r as () => void; }));
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();   // delete pending
  flushSync();
  // Drafts are local now (D3), so typing during an option mutation is harmless:
  expect(optInputs(target)[0].readOnly).toBe(false);
  expect(textArea(target).disabled).toBe(false);
  expect(textArea(target).readOnly).toBe(false);
  // The clicked button stays enabled (no blur); the handler guard blocks re-entry.
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  flushSync();
  expect(del).toHaveBeenCalledTimes(1);
  resolveDel();
  await loaded();
});

it('resyncOptions discards a re-fetch that resolves after a vid change (§4.1a)', async () => {
  let resolveResync!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce(AB())
    .mockReturnValueOnce(new Promise((r) => { resolveResync = r; }));
  vi.spyOn(qa, 'reorderOptions').mockRejectedValue(new Error('boom'));
  const { target, props } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await loaded();
  props.vid = 11;
  flushSync();
  let orderReads = 0;
  const trap = () => ({ id: 99, question_id: 1, text: 'STALE', is_correct: false, get order() { orderReads++; return 1; } } as unknown as AuthoringOption);
  resolveResync([trap(), trap()]);
  await loaded();
  expect(orderReads).toBe(0);
});

it('a dirty question disables add-option (two-way lock; T5b removes it)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  setVal(textArea(target), 'Edited question body');
  expect(addOptionBtn(target).disabled).toBe(true);
});

// ---- Correct marks are drafts (D25, §5.2) ----

it('single choice: picking a radio is a draft (no PATCH); save() sends true before false', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const upd = echoOption();
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[1].click();
  flushSync();
  expect(upd).not.toHaveBeenCalled();
  expect(c().isDirty).toBe(true);
  expect(c().keyChanged()).toBe(true);
  expect(radios(target).map((r) => r.checked)).toEqual([false, true]);
  expect(await c().save()).toBe('ok');
  expect(upd.mock.calls).toEqual([[2, { is_correct: true }], [1, { is_correct: false }]]);
  flushSync();
  expect(c().isDirty).toBe(false);
});

it('picking the already-correct radio leaves the question clean', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[0].click();
  flushSync();
  expect(c().isDirty).toBe(false);
});

it('single choice two-correct repair: picking one drafts the other false; save() sends only that', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: true, order: 2 }),
  ]);
  const upd = echoOption();
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[0].click();
  flushSync();
  await c().save();
  expect(upd.mock.calls).toEqual([[2, { is_correct: false }]]);
});

it('multiple choice: unchecking the last correct fails validate() with the Options error; nothing is sent', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'C', is_correct: true, order: 1 })]);
  const upd = vi.spyOn(qa, 'updateOption');
  const { target, c } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await loaded();
  boxes(target)[0].click();
  flushSync();
  expect(boxes(target)[0].checked).toBe(false);
  expect(c().validate()).toBe(false);
  flushSync();
  expect(target.querySelector('[data-testid="mark-error"]')!.textContent).toBe('Mark at least one correct option');
  expect(upd).not.toHaveBeenCalled();
});

it('a split single-choice save (true sent, false failed) keeps it dirty with the "Saved partly" note and one correct row', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'updateOption')
    .mockResolvedValueOnce(opt({ id: 2, text: 'B', is_correct: true, order: 2 }))
    .mockRejectedValueOnce(new ApiError(500, 'Server down'));
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[1].click();
  flushSync();
  expect(await c().save()).toBe('failed');
  flushSync();
  expect(c().lastError).toBe('Server down');
  expect(target.querySelector('[data-testid="save-error"]')!.textContent).toBe('Server down');
  expect(target.querySelector('[data-testid="save-note"]')!.textContent)
    .toBe('Saved partly — save again to finish the answer key.');
  expect(c().isDirty).toBe(true);
  expect(target.querySelectorAll('[data-testid="option-correct"]')).toHaveLength(1);   // D25
  expect(radios(target)[1].checked).toBe(true);
});

it('a failed question PATCH stops before the options and keeps everything dirty', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'updateQuestion').mockRejectedValue(new ApiError(422, 'Nope'));
  const upd = vi.spyOn(qa, 'updateOption');
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  setVal(textArea(target), 'Edited');
  radios(target)[1].click();
  flushSync();
  expect(await c().save()).toBe('failed');
  expect(upd).not.toHaveBeenCalled();
  expect(c().lastError).toBe('Nope');
  expect(c().isDirty).toBe(true);
  expect(refresh).not.toHaveBeenCalled();                   // a 422 does not re-gate
});

it('a 409 on save() re-gates via loadAdminTree({force})', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'updateQuestion').mockRejectedValue(new ApiError(409, 'Conflict'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, c } = mountAccordion(q());
  setVal(numInput(target), '9');
  expect(await c().save()).toBe('failed');
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
});

it('a 409 on an option mutation re-gates via loadAdminTree({force}) and shows an inline error (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: false, order: 1 })]);
  vi.spyOn(qa, 'createOption').mockRejectedValue(new ApiError(409, "Can only add options in 'created' state"));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'X');
  addBtn(target).click();
  await loaded(); await loaded();
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.querySelector('[data-testid="option-mut-error"]')).not.toBeNull();
});

it('a 400 on an option mutation does NOT re-gate (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'reorderOptions').mockRejectedValue(new ApiError(400, 'Bad request'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await loaded(); await loaded();
  expect(refresh).not.toHaveBeenCalled();
});

it('keyChanged(): an answer change counts, a text-only change does not (D20)', () => {
  const { target, c } = mountAccordion(q());
  setVal(textArea(target), 'New body');
  expect(c().isDirty).toBe(true);
  expect(c().keyChanged()).toBe(false);
  setVal(numInput(target), '9');
  expect(c().keyChanged()).toBe(true);
});

it('§8.8: a published question shows the type dead-end note; created does not', () => {
  const pub = mountAccordion(q(), { perms: versionPermissions({ state: 'published', is_disabled: false }) });
  expect(pub.target.querySelector('[data-testid="published-type-note"]')).not.toBeNull();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const cre = mountAccordion(q());
  expect(cre.target.querySelector('[data-testid="published-type-note"]')).toBeNull();
});

it('published: structure hidden, marks and option text editable, no structural calls', async () => {
  const PUB = versionPermissions({ state: 'published', is_disabled: false });
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const create = vi.spyOn(qa, 'createOption');
  const { target } = mountAccordion(choiceQ(), { perms: PUB });
  await loaded();
  expect(addOptionBtn(target)).toBeNull();
  expect(target.querySelector('button[aria-label="Delete option"]')).toBeNull();
  expect(radios(target)[0].disabled).toBe(false);
  expect(optInputs(target)[0].readOnly).toBe(false);
  expect(create).not.toHaveBeenCalled();
});

it('archived: the option area is fully read-only', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target } = mountAccordion(choiceQ(), { perms: versionPermissions({ state: 'archived', is_disabled: false }) });
  await loaded();
  expect(optInputs(target)[0].readOnly).toBe(true);
  expect(radios(target)[0].disabled).toBe(true);
  expect(target.querySelector('button[aria-label="Delete option"]')).toBeNull();
});

// ---- a11y and focus ----

it('single_choice options form a labelled radiogroup (fieldset + legend)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const fs = target.querySelector('fieldset[data-testid="option-group"]');
  expect(fs?.querySelector('legend')).not.toBeNull();
  expect(fs?.querySelectorAll('input[type="radio"]')).toHaveLength(2);
});

it('reordering an option announces via the aria-live region', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'reorderOptions').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const live = target.querySelector('[data-testid="option-live"]') as HTMLElement;
  expect(live.getAttribute('aria-live')).toBe('polite');
  (target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await loaded();
  expect(live.textContent).toMatch(/position 2 of 2/i);
});

it('expanding a question moves focus into the body', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, is_correct: true, order: 1 })]);
  const { target, props } = mountAccordion(choiceQ(), { expanded: false });
  await loaded();
  props.expanded = true;
  await loaded();
  expect(target.querySelector('.body')?.contains(document.activeElement)).toBe(true);
});

it('adding an option focuses the new option input', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  vi.spyOn(qa, 'createOption').mockResolvedValue(opt({ id: 3, text: 'Madrid', is_correct: true, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'Madrid');
  addBtn(target).click();
  await loaded(); await loaded();
  expect(document.activeElement).toBe(optInputs(target).at(-1));
});

it('delete-option focuses the surviving sibling at the same position', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
    opt({ id: 3, text: 'C', is_correct: false, order: 3 }),
  ]);
  vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  await loaded(); await loaded();
  expect((document.activeElement as HTMLElement).getAttribute('data-option-id')).toBe('3');
});

it('save() leaves focus where it was (D10: the caret is never moved by a Save)', async () => {
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ text_md: 'New body', text_html: '<p>New body</p>' }));
  const { target, c } = mountAccordion(q());
  textArea(target).focus();
  setVal(textArea(target), 'New body');
  await c().save();
  await loaded();
  expect(document.activeElement).toBe(textArea(target));
});

it('a 409 whose resync resolves after a vid change does NOT re-gate (§4.1a second guard)', async () => {
  const { ApiError } = await import('../lib/api');
  let resolveResync!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce([opt({ id: 1, text: 'A', is_correct: false, order: 1 })])
    .mockReturnValueOnce(new Promise((r) => { resolveResync = r; }));
  vi.spyOn(qa, 'createOption').mockRejectedValue(new ApiError(409, "Can only add in 'created' state"));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'X');
  addBtn(target).click();
  await loaded();
  props.vid = 11;
  flushSync();
  resolveResync([opt({ id: 1, text: 'A', is_correct: false, order: 1 })]);
  await loaded();
  expect(refresh).not.toHaveBeenCalled();
});

it('frozen: inputs readonly with focus kept, marks and structure disabled; a click on a mark changes nothing', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target, props, c } = mountAccordion(choiceQ());
  await loaded();
  textArea(target).focus();
  props.frozen = true;
  flushSync();
  expect(textArea(target).readOnly).toBe(true);
  expect(document.activeElement).toBe(textArea(target));
  expect(optInputs(target)[0].readOnly).toBe(true);
  expect(radios(target).every((r) => r.disabled)).toBe(true);
  radios(target)[1].click();                      // a disabled input ignores click()
  flushSync();
  expect(c().isDirty).toBe(false);
  expect(radios(target)[0].checked).toBe(true);
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
  expect(addOptionBtn(target).disabled).toBe(true);
});

it('drafting a mark does not re-create the inputs (no blink)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const [beforeA, beforeB] = radios(target);
  radios(target)[1].click();
  flushSync();
  expect(radios(target)[0]).toBe(beforeA);
  expect(radios(target)[1]).toBe(beforeB);
});

it('the correct-row look follows the draft mark (D25)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[1].click();
  flushSync();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  expect(rows.map((r) => r.classList.contains('correct'))).toEqual([false, true]);
  expect(rows[1].querySelector('[data-testid="option-correct"]')).not.toBeNull();
});

it('a choice question with 1 option shows few-options-warn; with 2 options it does not', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const one = mountAccordion(choiceQ());
  await loaded();
  expect(one.target.querySelector('[data-testid="few-options-warn"]')).not.toBeNull();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const two = mountAccordion(choiceQ());
  await loaded();
  expect(two.target.querySelector('[data-testid="few-options-warn"]')).toBeNull();
});

// ---- validate() / focusFirstInvalid() (D10) ----

it('validate() is dirty-scoped: a clean choice question with no options passes', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  expect(c().validate()).toBe(true);
  flushSync();
  expect(target.querySelector('[data-testid="needs-fixing"]')).toBeNull();
});

it('an invalid dirty question shows "needs fixing" with aria-invalid on its header; it clears once fixed', () => {
  const { target, c } = mountAccordion(q({ type: 'text_answer', correct_text: 'a', correct_numeric: null, precision: null }));
  const txt = target.querySelector('[data-testid="text-answer-input"]') as HTMLInputElement;
  setVal(txt, '');
  expect(c().validate()).toBe(false);
  flushSync();
  expect(header(target).getAttribute('aria-invalid')).toBe('true');
  expect(header(target).querySelector('[data-testid="needs-fixing"]')!.textContent).toBe('needs fixing');
  setVal(txt, 'b');
  expect(header(target).querySelector('[data-testid="needs-fixing"]')).toBeNull();
  expect(header(target).hasAttribute('aria-invalid')).toBe(false);
});

it('an emptied question text fails with "Question text is required"; focusFirstInvalid() focuses that editor', () => {
  const { target, c } = mountAccordion(q());
  setVal(textArea(target), '   ');
  expect(c().validate()).toBe(false);
  flushSync();
  expect(target.querySelector('[data-testid="text-error"]')!.textContent).toBe('Question text is required');
  c().focusFirstInvalid();
  expect(document.activeElement).toBe(textArea(target));
});

it('focusFirstInvalid() on a collapsed question focuses the invalid field once it expands', async () => {
  const { target, props, c } = mountAccordion(q());
  setVal(numInput(target), 'abc');
  props.expanded = false;
  flushSync();
  expect(c().validate()).toBe(false);
  c().focusFirstInvalid();
  props.expanded = true;
  await loaded();
  expect(document.activeElement).toBe(numInput(target));
});
```

File `frontend/src/tests/QuizEditor.svelte.test.ts` (full content, replacing the file):

```ts
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import QuizEditor from '../components/editor/QuizEditor.svelte';
import * as qa from '../lib/quizAuthoring';
import * as itemBody from '../lib/itemBody';
import * as store from '../stores/currentEditorVersion.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { AuthoringQuestion } from '../lib/quizAuthoring';
import type { SaveOutcome } from '../lib/itemBody';
import { versionPermissions } from '../lib/versionPermissions';

const VERSION = { id: 10, course_id: 1, state: 'created', is_disabled: false, info_md: '',
  info_html: '', max_quiz_attempts: 3, label: '', created_at: '', published_at: null, archived_at: null,
  content_updated_at: '' } as const;
const PUB = { ...VERSION, state: 'published' as const };

const stubAssetCtx = () => ({
  kind: 'course', list: vi.fn().mockResolvedValue([]), upload: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined), imgSrc: () => '', renderPreview: vi.fn().mockResolvedValue({ html: '' }),
}) as never;

const q = (over: Partial<AuthoringQuestion> = {}): AuthoringQuestion => {
  const base: AuthoringQuestion = {
    id: 1, item_id: 4, text_md: 'Question one', text_html: '<p>Question one</p>',
    type: 'numeric_answer', order: 1, explanation_md: null, explanation_html: null,
    correct_numeric: 3, precision: 0, correct_text: null, ...over,
  };
  // The header snippet reads stripped text_html; keep it in sync with text_md
  // unless a test pins text_html explicitly.
  return over.text_html !== undefined ? base : { ...base, text_html: `<p>${base.text_md}</p>` };
};

type BodyApi = {
  save(t: string | undefined): Promise<SaveOutcome>;
  validate(): boolean; discard(): void; discardAll(): void;
};

let cleanup: (() => void) | null = null;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; clearToasts(); vi.restoreAllMocks(); });

function mountEditor(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
    itemId: 4, vid: 10, version: VERSION, perms: versionPermissions(VERSION), assetContext: stubAssetCtx(),
    stillOnVid: () => true, versionDisabled: false, frozen: false,
    saveDirty: false, guardDirty: false, busy: false, ...over,
  });
  const cmp = mount(QuizEditor, { target, props }) as unknown as BodyApi;
  cleanup = () => unmount(cmp as never);
  return { target, props, cmp };
}
const loaded = async () => { await tick(); await tick(); await tick(); flushSync(); };

// ---- helpers (robust to markup; the data-testids and aria are the contract) ----
function clickByText(target: HTMLElement, text: string) {
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement).click();
}
function openAddForm(target: HTMLElement) {
  (target.querySelector('button[aria-label="Add question"]') as HTMLButtonElement).click();
  flushSync();
}
function setInput(target: HTMLElement, testid: string, value: string) {
  const el = target.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement;
  el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
}
function setVal(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
}
function selectType(target: HTMLElement, type: string) {
  (target.querySelector(`input[name="question-type"][value="${type}"]`) as HTMLInputElement).click();
  flushSync();
}
const toggles = (t: HTMLElement) =>
  [...t.querySelectorAll('[data-testid="question-header"] button[aria-expanded]')] as HTMLButtonElement[];
async function expandQ(t: HTMLElement, qid: number) {
  const btn = t.querySelector(`[data-q-id="${qid}"] [data-testid="question-header"] button[aria-expanded]`) as HTMLButtonElement;
  if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
  await loaded();
}
const inQ = <T extends Element>(t: HTMLElement, qid: number, sel: string) => t.querySelector(`[data-q-id="${qid}"] ${sel}`) as T;
const toastTexts = () => toasts.list.map((x) => x.message);

it('loads questions on mount and lists them in order', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 2, order: 2, text_md: 'Second' }), q({ id: 1, order: 1, text_md: 'First' })]);
  const { target } = mountEditor();
  await loaded();
  const headers = [...target.querySelectorAll('[data-testid="question-header"]')];
  expect(headers).toHaveLength(2);
  expect(headers[0].textContent).toContain('First');
  expect(headers[1].textContent).toContain('Second');
});

it('shows the empty-state when there are no questions', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const { target } = mountEditor();
  await loaded();
  expect(target.textContent).toContain('No questions yet');
});

it('adds a numeric question with a VALIDATED answer, appends it, force-refreshes', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(q({ id: 5, type: 'numeric_answer', text_md: 'Added', order: 1 }));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'numeric_answer');
  setInput(target, 'new-question-text', 'Added');
  setInput(target, 'new-numeric', '5');
  setInput(target, 'new-precision', '0');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenCalledWith(4, { text_md: 'Added', type: 'numeric_answer', correct_numeric: 5, precision: 0 });
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.textContent).toContain('Added');
});

it('blocks Add for a numeric question with an invalid answer (§8.3)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(q());
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'numeric_answer');
  setInput(target, 'new-question-text', 'Bad');
  setInput(target, 'new-numeric', '1.5e-20');
  const add = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  expect(create).not.toHaveBeenCalled();
});

it('creates a text_answer question with the collected correct_text (not fabricated)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(
    q({ id: 6, type: 'text_answer', text_md: 'Cap?', correct_text: 'Paris', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'Cap?');
  setInput(target, 'new-text-answer', 'Paris');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenCalledWith(4, { text_md: 'Cap?', type: 'text_answer', correct_text: 'Paris' });
});

it('creates single_choice and multiple_choice with NO correctness fields', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion')
    .mockResolvedValueOnce(q({ id: 7, type: 'single_choice', text_md: 'Pick one', correct_numeric: null, precision: null }))
    .mockResolvedValueOnce(q({ id: 8, type: 'multiple_choice', text_md: 'Pick many', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'single_choice');
  setInput(target, 'new-question-text', 'Pick one');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenLastCalledWith(4, { text_md: 'Pick one', type: 'single_choice' });
  openAddForm(target);
  selectType(target, 'multiple_choice');
  setInput(target, 'new-question-text', 'Pick many');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenLastCalledWith(4, { text_md: 'Pick many', type: 'multiple_choice' });
});

it('reorder ↑ swaps order and POSTs the full id-set', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  const reorder = vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined);
  const { target } = mountEditor();
  await loaded();
  ([...target.querySelectorAll('button[aria-label="Move up"]')] as HTMLButtonElement[])[1].click();
  await loaded();
  expect(reorder).toHaveBeenCalledWith(4, [{ id: 2, order: 1 }, { id: 1, order: 2 }]);
});

it('deletes a question after confirm and force-refreshes', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' })]);
  const del = vi.spyOn(qa, 'deleteQuestion').mockResolvedValue();
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target } = mountEditor();
  await loaded();
  (target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).click();
  await loaded();
  expect(del).toHaveBeenCalledWith(1);
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.querySelector('[data-testid="question-header"]')).toBeNull();
});

it("disables a row's structural controls while an add is in flight; busy follows (§7.2, D10)", async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' })]);
  let resolveCreate!: (created: AuthoringQuestion) => void;
  vi.spyOn(qa, 'createQuestion').mockReturnValue(new Promise((r) => { resolveCreate = r; }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountEditor();
  await loaded();
  expect(props.busy).toBe(false);
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'Q');
  setInput(target, 'new-text-answer', 'a');
  clickByText(target, 'Add');
  flushSync();
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
  expect(props.busy).toBe(true);                    // the modal's Save is disabled meanwhile
  resolveCreate(q({ id: 2, type: 'text_answer', correct_numeric: null, precision: null, correct_text: 'a' }));
  await loaded();
  expect(props.busy).toBe(false);
});

it('a question draft sets saveDirty and guardDirty; discard() clears them and restores the value', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  const { target, props, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  expect(props.saveDirty).toBe(true);
  expect(props.guardDirty).toBe(true);
  cmp.discard();
  flushSync();
  expect(props.saveDirty).toBe(false);
  expect(props.guardDirty).toBe(false);
  expect(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]').value).toBe('3');
});

it('shows an error then re-loads on Retry (loadToken increments per load)', async () => {
  const list = vi.spyOn(qa, 'listQuestions')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce([q({ id: 3, text_md: 'Recovered' })]);
  const { target } = mountEditor();
  await loaded();
  expect(target.querySelector('[role="alert"]')?.textContent).toContain('Could not load questions');
  clickByText(target, 'Retry');
  await loaded();
  expect(target.textContent).toContain('Recovered');
  expect(list).toHaveBeenCalledTimes(2);
});

it('a disabled version shows the whole-editor read-only notice', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const DIS = { ...VERSION, is_disabled: true };
  const { target } = mountEditor({ version: DIS, perms: versionPermissions(DIS), versionDisabled: true });
  await loaded();
  expect(target.querySelector('[data-testid="quiz-readonly"]')).not.toBeNull();
});

// ---- D20: one published answer-key confirm per Save ----

it('D20: a published answer-key change confirms once per Save, before anything is sent; Cancel sends nothing', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1 }), q({ id: 2, order: 2, text_md: 'Two' })]);
  const update = vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number) => Promise.resolve(q({ id: qid, correct_numeric: 9 })));
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { target, cmp } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  await expandQ(target, 2);
  setVal(inQ<HTMLInputElement>(target, 2, '[data-testid="numeric-input"]'), '9');
  expect(await cmp.save(undefined)).toEqual({ outcome: 'failed' });
  expect(confirmSpy).toHaveBeenCalledOnce();
  expect(confirmSpy.mock.calls[0][0]).toMatch(/^This quiz is published\. Changing the answer key does not re-score/);
  expect(update).not.toHaveBeenCalled();
  confirmSpy.mockReturnValue(true);
  expect((await cmp.save(undefined)).outcome).toBe('ok');
  expect(confirmSpy).toHaveBeenCalledTimes(2);                   // once per Save, never per question
  expect(update).toHaveBeenCalledTimes(2);
});

it('D20: a published text-only change never confirms', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ id: 1, text_md: 'New body' }));
  const confirmSpy = vi.spyOn(window, 'confirm');
  const { target, cmp } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'New body');
  await cmp.save(undefined);
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith(1, { text_md: 'New body' });
});

it('D20: created versions never confirm', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ id: 1, correct_numeric: 9 }));
  const confirmSpy = vi.spyOn(window, 'confirm');
  const { target, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  await cmp.save(undefined);
  expect(confirmSpy).not.toHaveBeenCalled();
});

// ---- One Save across N PATCHes (D10, §5.3) ----

it('save(): the title first, then dirty questions in display order; clean questions send nothing', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' }), q({ id: 3, order: 3, text_md: 'C' }),
  ]);
  const log: string[] = [];
  vi.spyOn(itemBody, 'patchItem').mockImplementation((id: number, body: Record<string, unknown>) => {
    log.push(`item ${id}`);
    return Promise.resolve({ id, title: String(body.title), content_md: null, video_url: null, script_url: null });
  });
  vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number, body: { text_md?: string }) => {
    log.push(`question ${qid}`);
    return Promise.resolve(q({ id: qid, order: qid, text_md: body.text_md ?? '' }));
  });
  const { target, props, cmp } = mountEditor();
  await loaded();
  // Edit Q3 first, then Q1: the edit order must not matter, the display order does.
  await expandQ(target, 3);
  setVal(inQ<HTMLTextAreaElement>(target, 3, '[data-field="text"] textarea'), 'C2');
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  expect(await cmp.save('Quiz 2')).toEqual({ outcome: 'ok', savedTitle: 'Quiz 2' });
  expect(log).toEqual(['item 4', 'question 1', 'question 3']);
  flushSync();
  expect(props.saveDirty).toBe(false);
});

it('save(): a failing question stops the run — partial outcome, later questions stay dirty, the toast names it, it expands', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' }), q({ id: 3, order: 3, text_md: 'C' }),
  ]);
  vi.spyOn(itemBody, 'patchItem').mockResolvedValue({ id: 4, title: 'Quiz 2', content_md: null, video_url: null, script_url: null });
  const update = vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number, body: { text_md?: string }) =>
    qid === 2 ? Promise.reject(new ApiError(422, 'Too long')) : Promise.resolve(q({ id: qid, order: qid, text_md: body.text_md ?? '' })));
  const { target, props, cmp } = mountEditor();
  await loaded();
  for (const id of [1, 2, 3]) {
    await expandQ(target, id);
    setVal(inQ<HTMLTextAreaElement>(target, id, '[data-field="text"] textarea'), `edit ${id}`);
  }
  await expandQ(target, 1);                          // leave Q1 open: the failure must move it to Q2
  const res = await cmp.save('Quiz 2');
  expect(res).toEqual({ outcome: 'partial', savedTitle: 'Quiz 2' });
  expect(update.mock.calls.map((c) => c[0])).toEqual([1, 2]);     // Q3 never sent
  expect(toastTexts()).toContain('Question 2: Too long — Save again to send the rest.');
  await loaded();
  expect(props.saveDirty).toBe(true);
  expect(inQ<HTMLButtonElement>(target, 2, '[data-testid="question-header"] button[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
});

it('save(): a 422 on the title toasts it, sends nothing else and does not reload', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(itemBody, 'patchItem').mockRejectedValue(new ApiError(422, 'Title too long'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { cmp } = mountEditor();
  await loaded();
  expect(await cmp.save('x'.repeat(300))).toEqual({ outcome: 'failed' });
  expect(toastTexts()).toContain('Title too long');
  expect(refresh).not.toHaveBeenCalled();
});

it('save(): a 409 on the title reloads the tree (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(itemBody, 'patchItem').mockRejectedValue(new ApiError(409, 'Conflict'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { cmp } = mountEditor();
  await loaded();
  await cmp.save('New Title');
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
});

it('validate() is dirty-scoped: a clean choice question with zero options never blocks', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  const { cmp } = mountEditor();
  await loaded();
  expect(cmp.validate()).toBe(true);
});

it('validate(): the first invalid question is expanded, its field focused, its header marked', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1 }), q({ id: 2, order: 2, text_md: 'Two' })]);
  const { target, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 2);
  setVal(inQ<HTMLInputElement>(target, 2, '[data-testid="numeric-input"]'), 'abc');
  toggles(target)[1].click();                       // collapse Q2 again
  await loaded();
  expect(cmp.validate()).toBe(false);
  await loaded();
  expect(inQ<HTMLButtonElement>(target, 2, '[data-testid="question-header"] button[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(inQ(target, 2, '[data-testid="numeric-input"]'));
  expect(inQ(target, 2, '[data-testid="needs-fixing"]')).not.toBeNull();
  expect(inQ(target, 1, '[data-testid="needs-fixing"]')).toBeNull();
});

it('frozen disables add-question and the question structure controls', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 }), q({ id: 2, order: 2 })]);
  const { target, props } = mountEditor();
  await loaded();
  props.frozen = true;
  flushSync();
  expect((target.querySelector('button[aria-label="Add question"]') as HTMLButtonElement).disabled).toBe(true);
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
  expect((target.querySelectorAll('button[aria-label="Move down"]')[0] as HTMLButtonElement).disabled).toBe(true);
});

// ---- §10a a11y and focus ----

it('reordering a question announces via the aria-live region', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined as never);
  const { target } = mountEditor();
  await loaded();
  const live = target.querySelector('[data-testid="question-live"]') as HTMLElement;
  expect(live.getAttribute('aria-live')).toBe('polite');
  (target.querySelector('[data-testid="question-header"] button[aria-label="Move down"]') as HTMLButtonElement).click();
  await loaded();
  expect(live.textContent).toMatch(/position 2 of 2/i);
});

it('adding a question focuses the new question body (first field via the expand effect)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  vi.spyOn(qa, 'createQuestion').mockResolvedValue(
    q({ id: 42, type: 'single_choice', text_md: 'Pick one', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'single_choice');
  setInput(target, 'new-question-text', 'Pick one');
  clickByText(target, 'Add');
  await loaded();
  const active = document.activeElement as HTMLElement | null;
  expect(target.querySelector('[data-q-id="42"] .body')?.contains(active)).toBe(true);
  expect(active?.tagName).toBe('TEXTAREA');
});

it("one question's failed option fetch isolates to its accordion (§6)", async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, type: 'single_choice', text_md: 'Q1', correct_numeric: null, precision: null }),
    q({ id: 2, order: 2, type: 'single_choice', text_md: 'Q2', correct_numeric: null, precision: null }),
  ]);
  const list = vi.spyOn(qa, 'listOptions').mockImplementation((qid: number) =>
    qid === 1 ? Promise.reject(new Error('boom'))
      : Promise.resolve([{ id: 9, question_id: 2, text: 'ok-opt', is_correct: true, order: 1 }]));
  const { target } = mountEditor();
  await loaded();
  expect(list).toHaveBeenCalledWith(1);
  expect(list).toHaveBeenCalledWith(2);
  toggles(target)[0].click();
  await loaded();
  expect(target.querySelectorAll('[data-testid="option-load-error"]')).toHaveLength(1);
});

it('deleting the middle question focuses the surviving sibling\'s toggle', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' }), q({ id: 3, order: 3, text_md: 'C' }),
  ]);
  vi.spyOn(qa, 'deleteQuestion').mockResolvedValue();
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target } = mountEditor();
  await loaded();
  ([...target.querySelectorAll('button[aria-label="Delete question"]')] as HTMLButtonElement[])[1].click();
  await loaded(); await loaded();
  const focused = document.activeElement as HTMLElement | null;
  expect(focused?.hasAttribute('aria-expanded')).toBe(true);
  expect(focused?.closest('[data-q-id]')?.getAttribute('data-q-id')).toBe('3');
});
```

`frontend/src/tests/ItemEditorModal.svelte.test.ts` — four edits:

1. In `it('disabled quiz: expanding a question makes zero /render calls', …)`, replace `'[data-testid="question-header"] button.expand'` with `'[data-testid="question-header"] button[aria-expanded]'`. The T6 toggle is no longer `.expand`.
2. Delete the two interim quiz tests: everything from `  it('quiz: a question draft makes the item guard-dirty only; the footer stays clean', async () => {` through the closing `  });` of `  it('quiz: the footer Save sends the title alone', …)`. The describe then holds only T4's two app tests.
3. Rename that describe from `'ItemEditorModal — interim wiring (T3a → T4 / T5a)'` to `'ItemEditorModal — app script row (T4)'`.
4. Append this describe at the end of the file:

```ts
describe('ItemEditorModal — quiz body (T5a)', () => {
  const numQ = { ...textQ, id: 52, type: 'numeric_answer', correct_text: null, correct_numeric: 3, precision: 0 };
  const choiceQ = { ...textQ, id: 53, type: 'single_choice', correct_text: null };
  const choiceOpts = [
    { id: 61, question_id: 53, text: 'A', is_correct: true, order: 1 },
    { id: 62, question_id: 53, text: 'B', is_correct: false, order: 2 },
  ];
  const tail = (u: unknown) => String(u).replace(/^.*\/api\//, '');
  const qPatches = () => calls(/\/api\/questions\/\d+$/, 'PATCH').map(([u, init]) => [tail(u), JSON.parse(String(init!.body))]);
  const optPatches = () => calls(/\/api\/options\/\d+$/, 'PATCH').map(([u, init]) => [tail(u), JSON.parse(String(init!.body))]);
  // The quiz endpoints. A question or option PATCH echoes what was sent over
  // the stored row (the server's echo); `extra` overrides a URL first.
  function serveQuiz(questions: Record<string, unknown>[], extra: (u: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
    serve((u, init) => {
      const custom = extra(u, init);
      if (custom) return custom;
      if (u.endsWith('/items/7/questions')) return jres(questions);
      if (u.endsWith('/questions/53/options')) return jres(choiceOpts);
      const qm = /\/api\/questions\/(\d+)$/.exec(u);
      if (qm && init?.method === 'PATCH') return jres({ ...questions.find((x) => x.id === Number(qm[1])), ...JSON.parse(String(init.body)) });
      const om = /\/api\/options\/(\d+)$/.exec(u);
      if (om && init?.method === 'PATCH') return jres({ ...choiceOpts.find((x) => x.id === Number(om[1])), ...JSON.parse(String(init.body)) });
      return undefined;
    });
  }
  const toggle = (i = 0) => panel().querySelectorAll<HTMLButtonElement>('[data-testid="question-header"] button[aria-expanded]')[i];
  async function expand(i = 0) { toggle(i).click(); await settle(); }
  const answerInput = () => panel().querySelector<HTMLInputElement>('[data-testid="text-answer-input"]')!;

  it('a question draft marks the footer and the page registry dirty (the interim bridge is gone)', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    expect(panel().querySelector('[data-testid="quiz-title"]')).toBeNull();
    await expand();
    type(answerInput(), 'z');
    expect(dirtyText()).toBe('unsaved changes');
    expect(anyDirty()).toBe('true');
    expect(footBtn('Save').disabled).toBe(false);
  });

  it('Save sends the title, then the question; the trimmed answer comes back clean', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    await expand();
    type(answerInput(), '  y  ');
    footBtn('Save').click();
    await settle();
    const order = (fetchSpy.mock.calls as Call[]).filter(([, i]) => i?.method === 'PATCH').map(([u]) => tail(u));
    expect(order).toEqual(['items/7', 'questions/51']);
    expect(patchBodies()).toEqual([{ title: 'Quiz 2' }]);
    expect(qPatches()).toEqual([['questions/51', { correct_text: 'y' }]]);
    expect(answerInput().value).toBe('y');
    expect(dirtyText()).toBe('');
    expect(anyDirty()).toBe('false');
    expect(toastTexts()).toContain('Saved');
    expect(calls(/\/admin-tree$/).length).toBe(1);
  });

  it('the footer Save sends the title alone when no question changed', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'Quiz 2' }]);
    expect(qPatches()).toEqual([]);
    expect(dirtyText()).toBe('');
  });

  it('a numeric "2.50" saves as 2.5 and comes back clean', async () => {
    serveQuiz([numQ]);
    await render({ item: { type: 'quiz' } });
    await expand();
    const num = panel().querySelector<HTMLInputElement>('[data-testid="numeric-input"]')!;
    type(num, '2.50');
    footBtn('Save').click();
    await settle();
    expect(qPatches()).toEqual([['questions/52', { correct_numeric: 2.5, precision: 0 }]]);
    expect(num.value).toBe('2.5');
    expect(dirtyText()).toBe('');
  });

  it('⌘S in an option input saves; meanwhile the input is readonly with focus kept and the marks are disabled', async () => {
    let release!: () => void;
    serveQuiz([choiceQ], (u, init) => {
      if (!(/\/api\/options\/61$/.test(u) && init?.method === 'PATCH')) return undefined;
      return new Promise((r) => { release = () => r(resp({ ...choiceOpts[0], text: 'A2' })); });
    });
    await render({ item: { type: 'quiz' } });
    await expand();
    const optA = panel().querySelectorAll<HTMLInputElement>('[data-testid="option-text"]')[0];
    optA.focus();
    type(optA, 'A2');
    const ev = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    optA.dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(optPatches()).toEqual([['options/61', { text: 'A2' }]]);
    expect(optA.readOnly).toBe(true);
    expect(document.activeElement).toBe(optA);
    const radios = [...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.every((r) => r.disabled)).toBe(true);
    radios[1].click();                              // a disabled input ignores click()
    flushSync();
    expect(radios[0].checked).toBe(true);
    release();
    await settle();
    expect(optA.readOnly).toBe(false);
    expect(document.activeElement).toBe(optA);
    expect(dirtyText()).toBe('');
  });

  it('footer Discard and a confirmed close both reset question drafts', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    await expand();
    type(answerInput(), 'z');
    footBtn('Discard').click();
    flushSync();
    expect(answerInput().value).toBe('x');
    expect(dirtyText()).toBe('');
    type(answerInput(), 'w');
    registry!.discardAll();
    flushSync();
    expect(answerInput().value).toBe('x');
    expect(anyDirty()).toBe('false');
  });

  it('a question failing after the title saved is partial: the tree reloads, the toast names it, it stays dirty', async () => {
    serveQuiz([textQ], (u, init) => (/\/api\/questions\/51$/.test(u) && init?.method === 'PATCH' ? jres({ detail: 'Nope' }, 422) : undefined));
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    await expand();
    type(answerInput(), 'z');
    footBtn('Save').click();
    await settle();
    expect(toastTexts()).toContain('Question 1: Nope — Save again to send the rest.');
    expect(toastTexts()).not.toContain('Saved');
    expect(calls(/\/admin-tree$/).length).toBe(1);        // the title part landed → reload (D10)
    expect(titleInput().value).toBe('Quiz 2');
    expect(dirtyText()).toBe('unsaved changes');          // the question is still dirty
    expect(answerInput().value).toBe('z');
  });

  it('an invalid question blocks Save: nothing is sent; it is expanded, marked and focused', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    await expand();
    type(answerInput(), '');
    await expand();                                       // collapse it again
    footBtn('Save').click();
    await settle();
    expect(qPatches()).toEqual([]);
    expect(patchBodies()).toEqual([]);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('[data-testid="needs-fixing"]')!.textContent).toBe('needs fixing');
    expect(document.activeElement).toBe(answerInput());
    expect(toastTexts()).toContain('Fix the highlighted fields');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/OptionRow.svelte.test.ts src/tests/QuestionAccordion.svelte.test.ts src/tests/QuizEditor.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts`

Expected: FAIL.
- The harness cannot resolve `../../lib/quizSave`.
- OptionRow fails on the new props (`correct`, `onMark`).
- The modal's quiz tests find no `[data-field]`, and no footer dirt from a question draft.

- [ ] **Step 3: `lib/quizSave.ts`** (full content)

```ts
// The quiz body's one-Save orchestration (Slice-5b §5.1). Each QuestionAccordion
// registers a save contributor on QUIZ_SAVE_KEY; QuizEditor validates the dirty
// ones and saves them in display order after the title (§5.3). QUIZ_GUARD_KEY
// carries a second dirty registry for the typed add-question / add-option
// forms (T5b): they make closing the modal prompt (guardDirty), but the footer
// and Save ignore them (D5).

export const QUIZ_SAVE_KEY = Symbol('quizSave');
export const QUIZ_GUARD_KEY = Symbol('quizGuard');

export type QuizContributor = {
  readonly questionId: number;
  // Display position (1-based); QuizEditor sorts by it.
  order(): number;
  readonly isDirty: boolean;
  // An option add / delete / reorder, or an editor upload, is in flight (blocks Save).
  locked(): boolean;
  // D20: a numeric or text answer, or a correct mark, differs from saved.
  keyChanged(): boolean;
  // D10: dirty-scoped. Shows the inline errors; never moves focus.
  validate(): boolean;
  // Focuses the first invalid field (after the body expands, if collapsed).
  focusFirstInvalid(): void;
  // §5.3 order; stops at the first failure. Never throws.
  save(): Promise<'ok' | 'failed'>;
  discard(): void;
  // R4: the failed part's server message, for QuizEditor's toast.
  readonly lastError: string | null;
  // The header text, for confirms and messages.
  title(): string;
};

export type QuizSaveHub = {
  register(c: QuizContributor): void;
  unregister(c: QuizContributor): void;
};
```

- [ ] **Step 4: `OptionRow.svelte`** (full content)

```svelte
<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option. Presentational: it owns NO state (§4.1). The text input
     binds the accordion-owned draft, and the correct mark is the accordion's
     draft too (Slice-5b §5.2, D25); the row only emits callbacks. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';

  let {
    option, index, count, questionType, perms, draft = $bindable(''), correct,
    frozen, optionsLocked, canDelete, mutating,
    onMark, onDelete, onMoveUp, onMoveDown,
  }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
    perms: VersionPermissions; draft: string;
    // D25: the DRAFT mark, so the row shows what Save will send.
    correct: boolean;
    // D10/D9: a Save or an item delete is in flight.
    frozen: boolean;
    // Option structure is locked: a mutation in flight, a dirty question
    // (until T5b) or a frozen modal.
    optionsLocked: boolean;
    canDelete: boolean;
    // An option mutation is in flight: the clicked structure button stays
    // natively enabled (no blur); the accordion's handlers guard re-entry.
    mutating: boolean;
    onMark: (next: boolean) => void;
    onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  const textReadOnly = $derived(!perms.canEditTextFields || frozen);
  // Checkables ignore `readonly`, so a frozen mark is `disabled` (D10).
  const markDisabled = $derived(!perms.canEditTextFields || frozen);
  const structureDisabled = $derived(optionsLocked && !mutating);
  // DB String(500), min_length=1. Flagged live; the footer Save's validate() blocks it.
  const lenInvalid = $derived(draft.trim().length < 1 || draft.length > 500);
</script>

<div class="option" class:correct data-testid="option-row">
  {#if questionType === 'single_choice'}
    <input type="radio" name={`correct-${option.question_id}`} checked={correct}
           disabled={markDisabled} onchange={() => onMark(true)}
           aria-label={`Mark option ${index} correct`} />
  {:else if questionType === 'multiple_choice'}
    <input type="checkbox" checked={correct}
           disabled={markDisabled} onchange={(e) => onMark(e.currentTarget.checked)}
           aria-label={`Mark option ${index} correct`} />
  {/if}
  <span class="opt-num">{index}.</span>
  <input class="opt-input" data-testid="option-text" data-option-id={option.id} bind:value={draft}
         readonly={textReadOnly} aria-label={`Option ${index} text`} aria-invalid={lenInvalid} maxlength="500" />
  {#if lenInvalid}<span class="len-warn" role="alert" data-testid="option-len-warn">1–500 chars</span>{/if}
  {#if correct}<span class="correct-marker" data-testid="option-correct">correct</span>{/if}
  {#if perms.canEditStructure}
    <button type="button" aria-label="Move option up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move option down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete option" disabled={structureDisabled || !canDelete} onclick={onDelete}>🗑</button>
  {/if}
</div>

<style>
  .option { display: flex; align-items: center; gap: var(--space-2); }
  .opt-num { color: var(--muted); }
  .opt-input { flex: 1; }
  .correct-marker { font-size: 0.85em; color: var(--status-accepted-fg); }
  .len-warn { font-size: 0.8em; color: var(--danger); }
</style>
```

The ↑ ↓ 🗑 glyphs and the `em` sizes are T6's (3f look). This task only drops the hex fallbacks it touches.

- [ ] **Step 5: `QuestionAccordion.svelte`** (full content)

```svelte
<script lang="ts">
  // One quiz question (Slice-5b §5). The accordion is always mounted (only its
  // body collapses), so it owns the question's drafts: text, explanation, the
  // answer key, option text and correct marks. It registers one tracker in
  // QuizEditor's private dirty registry and one save contributor on the
  // QUIZ_SAVE_KEY hub; the modal's footer Save sends the drafts (D3). Option
  // structure (add / delete / reorder) still acts immediately.
  import { getContext, onMount, onDestroy, tick, untrack } from 'svelte';
  import type {
    AuthoringQuestion, AuthoringOption, OptionUpdateBody, QuestionUpdateBody,
  } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
  import {
    updateQuestion, validateNumericAnswer,
    listOptions, createOption, updateOption, deleteOption, reorderOptions,
  } from '../../lib/quizAuthoring';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Button from '../ui/Button.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import OptionRow from './OptionRow.svelte';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked,
    onExpandToggle, onDelete, onMoveUp, onMoveDown, versionDisabled = false, frozen = false,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
    // Slice-5b D6: plain source, no /render (a disabled version's /render is a 403).
    versionDisabled?: boolean;
    // Slice-5b D10/D9: a Save or an item delete is in flight. Inputs turn
    // read-only without losing focus; checkables and structure are disabled.
    frozen?: boolean;
  } = $props();

  const registry = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  const hub = getContext<QuizSaveHub>(QUIZ_SAVE_KEY);

  // ---- Lifecycle guard (§4.1a): every post-await write checks
  //      `alive && vid === savedVid` (vid = the live route prop). ----
  let alive = true;
  let optLoadToken = 0;                                 // bumped per load and on destroy
  onDestroy(() => { alive = false; optLoadToken++; });

  // ---- Question drafts. `draft` is bound to the inputs; `saved` is the last
  //      persisted state. Both are seeded ONCE (the accordion is keyed by q.id);
  //      `saved` advances per field from each PATCH echo (D10). ----
  type QDraft = { text_md: string; explanation_md: string; numericInput: string; precision: number; correct_text: string };
  const fromServer = (x: AuthoringQuestion): QDraft => ({
    text_md: x.text_md,
    explanation_md: x.explanation_md ?? '',
    numericInput: x.correct_numeric == null ? '' : String(x.correct_numeric),
    precision: x.precision ?? 0,
    correct_text: x.correct_text ?? '',
  });
  let saved = $state(untrack(() => fromServer(question)));
  let draft = $state(untrack(() => fromServer(question)));
  let textHtml = $state(untrack(() => question.text_html));   // header snippet; advances on save
  const isChoice = untrack(() => question.type === 'single_choice' || question.type === 'multiple_choice');

  const editable = $derived(perms.canEditTextFields);
  const isPublished = $derived(perms.canEditTextFields && !perms.canEditStructure);  // §8.8

  // ---- Per-type answer validity ----
  const numericCheck = $derived(
    question.type === 'numeric_answer' ? validateNumericAnswer(draft.numericInput) : { ok: true as const, canonical: '' },
  );
  const numericError = $derived(numericCheck.ok ? null : numericCheck.reason);
  const precisionValid = $derived(
    Number.isInteger(draft.precision) && draft.precision >= 0 && draft.precision <= 10,
  );
  const textAnswerValid = $derived(draft.correct_text.trim().length >= 1 && draft.correct_text.length <= 500);
  const answerValid = $derived(
    question.type === 'numeric_answer' ? (numericCheck.ok && precisionValid)
      : question.type === 'text_answer' ? textAnswerValid : true,
  );

  // ---- Options (choice types). `options` is the SAVED state from the server
  //      (order, text, marks); `optDrafts` holds the author's drafts per id. ----
  let options = $state<AuthoringOption[]>([]);
  let optStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>(isChoice ? 'loading' : 'idle');
  let optError = $state<string | null>(null);
  type ODraft = { text: string; is_correct: boolean };
  // Keyed by option id, so add / delete / reorder / refetch never move a draft
  // to another option (§5.4).
  let optDrafts = $state<Record<number, ODraft>>({});

  // The single assignment point for `options`. A new id gets a draft from the
  // server and a gone id loses its draft. For a surviving id, each CLEAN field
  // follows the server and each dirty field keeps the author's draft.
  function setOptions(next: AuthoringOption[]) {
    const prev = new Map(options.map((o) => [o.id, o]));
    for (const o of next) {
      const d = optDrafts[o.id];
      const p = prev.get(o.id);
      if (!d) optDrafts[o.id] = { text: o.text, is_correct: o.is_correct };
      else if (p) {
        if (d.text === p.text) d.text = o.text;
        if (d.is_correct === p.is_correct) d.is_correct = o.is_correct;
      }
    }
    const ids = new Set(next.map((o) => o.id));
    for (const id of Object.keys(optDrafts).map(Number)) if (!ids.has(id)) delete optDrafts[id];
    options = next;
  }
  function applyOption(updated: AuthoringOption) {     // apply-if-current (§7.2 backstop)
    const i = options.findIndex((o) => o.id === updated.id);
    if (i < 0) return;                                 // option gone → ignore a stale response
    const next = [...options];
    next[i] = updated;
    setOptions(next);
  }
  const draftOf = (o: AuthoringOption): ODraft => optDrafts[o.id] ?? { text: o.text, is_correct: o.is_correct };

  const correctCount = $derived(options.filter((o) => o.is_correct).length);              // saved (C2)
  const draftCorrectCount = $derived(options.filter((o) => draftOf(o).is_correct).length); // D25
  const marksChanged = $derived(options.some((o) => draftOf(o).is_correct !== o.is_correct));
  const optTextChanged = $derived(options.some((o) => draftOf(o).text !== o.text));
  const optTextInvalid = $derived(options.some((o) => {
    const t = draftOf(o).text;
    return t.trim().length < 1 || t.length > 500;
  }));

  // ---- Dirty ----
  const answerChanged = $derived(
    (question.type === 'numeric_answer' && (draft.numericInput !== saved.numericInput || draft.precision !== saved.precision)) ||
    (question.type === 'text_answer' && draft.correct_text !== saved.correct_text),
  );
  const qDirty = $derived(
    draft.text_md !== saved.text_md || draft.explanation_md !== saved.explanation_md || answerChanged,
  );
  const dirty = $derived(qDirty || optTextChanged || marksChanged);
  const keyChanged = $derived(answerChanged || marksChanged);   // D20

  // ---- D10 validation: only a dirty question is checked. The inline errors
  //      show after a failed Save and then follow the drafts live. ----
  let validated = $state(false);
  const textError = $derived(draft.text_md.trim() === '' ? 'Question text is required' : null);
  const markError = $derived.by(() => {
    // Only when the marks changed, and only with at least one loaded option:
    // a choice question with no options (or whose options failed to load) is
    // exempt, as created by design.
    if (!isChoice || optStatus !== 'loaded' || options.length === 0 || !marksChanged) return null;
    if (question.type === 'single_choice') return draftCorrectCount === 1 ? null : 'Mark exactly one correct option';
    return draftCorrectCount >= 1 ? null : 'Mark at least one correct option';
  });
  const needsFix = $derived(
    dirty && (textError !== null || !answerValid || markError !== null || optTextInvalid),
  );
  const showErrors = $derived(validated && dirty);

  function validate(): boolean {
    validated = dirty;
    return !needsFix;
  }

  let bodyEl: HTMLElement | undefined = $state();
  let pendingInvalidFocus = false;
  function focusInvalidNow() {
    if (!bodyEl) return;
    const el =
      (textError ? bodyEl.querySelector<HTMLElement>('[data-field="text"] textarea') : null) ??
      bodyEl.querySelector<HTMLElement>('input[aria-invalid="true"]') ??
      (markError ? bodyEl.querySelector<HTMLElement>('[data-testid="option-group"] input') : null);
    el?.focus();
  }
  function focusFirstInvalid() {
    if (expanded && bodyEl) focusInvalidNow();
    else pendingInvalidFocus = true;                    // the expand effect focuses it once rendered
  }

  // ---- Correct marks are drafts (§5.2, D25) ----
  function mark(oid: number, next: boolean) {
    if (frozen || !editable) return;
    if (question.type === 'single_choice') {
      for (const o of options) { const d = optDrafts[o.id]; if (d) d.is_correct = o.id === oid; }
    } else {
      const d = optDrafts[oid];
      if (d) d.is_correct = next;
    }
  }

  // ---- Option structure: immediate, serialised by `optionsLocked` (§7.2) ----
  let optionsLocked = $state(false);
  let optMutError = $state<string | null>(null);
  let optionAnnounce = $state('');
  // The two-way lock stays until T5b: a dirty question locks option structure.
  const optionsDisabled = $derived(optionsLocked || dirty || frozen);
  const canDeleteOption = (o: AuthoringOption) =>
    options.length === 1 || !(o.is_correct && correctCount === 1);   // C2 (§8.6): judged on SAVED marks

  async function resyncOptions(savedVid: number) {     // §6 write-back on error
    try {
      const list = await listOptions(question.id);
      if (!(alive && vid === savedVid)) return;
      setOptions([...list].sort((a, b) => a.order - b.order));
    } catch { /* keep the prior inline error; the loaded list stays as-is */ }
  }
  async function afterOptionError(e: unknown, savedVid: number, fallback: string) {
    if (!(alive && vid === savedVid)) return;
    optMutError = e instanceof ApiError ? e.displayMessage : fallback;
    await resyncOptions(savedVid);
    if (!(alive && vid === savedVid)) return;           // §4.1a: re-check after the resync await
    if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
      await loadAdminTree(savedVid, { force: true });   // §10 re-gate
    }
  }

  async function loadOptions() {
    optLoadToken += 1;
    const myToken = optLoadToken;
    optStatus = 'loading';
    optError = null;
    try {
      const list = await listOptions(question.id);
      if (myToken !== optLoadToken) return;            // superseded / unmounted → discard
      setOptions([...list].sort((a, b) => a.order - b.order));
      optStatus = 'loaded';
    } catch (e) {
      if (myToken !== optLoadToken) return;
      optError = e instanceof ApiError ? e.displayMessage : 'Could not load options.';
      optStatus = 'error';
    }
  }
  onMount(() => { if (isChoice) void loadOptions(); });

  let addingOption = $state(false);
  let newOptionText = $state('');
  const newOptionValid = $derived(newOptionText.trim().length >= 1 && newOptionText.length <= 500);

  async function addOption() {
    if (optionsDisabled || !perms.canEditStructure || !newOptionValid) return;
    const savedVid = vid;
    const text = newOptionText.trim();
    // §8.4: the first option of an empty single_choice list is correct; every
    // other new option (incl. every multiple_choice option) starts false.
    const is_correct = question.type === 'single_choice' && options.length === 0;
    optMutError = null;
    optionsLocked = true;
    try {
      const created = await createOption(question.id, { text, is_correct });
      if (!(alive && vid === savedVid)) return;
      setOptions([...options, created].sort((a, b) => a.order - b.order));
      addingOption = false; newOptionText = '';
      await tick();
      if (alive && vid === savedVid) bodyEl?.querySelector<HTMLElement>(`[data-option-id="${created.id}"]`)?.focus();
    } catch (e) {
      await afterOptionError(e, savedVid, 'Add option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function removeOption(oid: number) {
    if (optionsLocked || frozen || !perms.canEditStructure) return;
    const target = options.find((o) => o.id === oid);
    if (!target || !canDeleteOption(target)) return;
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      await deleteOption(oid);
      if (!(alive && vid === savedVid)) return;
      const idx = options.findIndex((o) => o.id === oid);
      const survivors = options.filter((o) => o.id !== oid);
      setOptions(survivors);
      const focusId = survivors[Math.min(idx, survivors.length - 1)]?.id;
      await tick();
      if (alive && vid === savedVid && focusId != null) bodyEl?.querySelector<HTMLElement>(`[data-option-id="${focusId}"]`)?.focus();
    } catch (e) {
      await afterOptionError(e, savedVid, 'Delete option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function moveOption(oid: number, dir: -1 | 1) {
    if (optionsLocked || frozen || !perms.canEditStructure) return;
    const idx = options.findIndex((o) => o.id === oid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= options.length) return;
    const savedVid = vid;
    const next = [...options];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOptions(next.map((o, i) => ({ ...o, order: i + 1 })));
    const newIndex = options.findIndex((o) => o.id === oid) + 1;
    optionAnnounce = `Option moved to position ${newIndex} of ${options.length}`;
    const order = options.map((o) => ({ id: o.id, order: o.order }));
    optMutError = null;
    optionsLocked = true;
    try {
      await reorderOptions(question.id, order);        // success: the optimistic state is authoritative
    } catch (e) {
      await afterOptionError(e, savedVid, 'Reorder failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  // ---- Inner MarkdownEditor uploads feed `locked()` (D10: Save waits for them).
  //      A collapse unmounts the editors, so their flags are cleared with it. ----
  let upText = $state(false);
  let upExpl = $state(false);
  $effect(() => { if (!expanded) { upText = false; upExpl = false; } });

  // ---- save() — §5.3 / D10 ----
  let lastError = $state<string | null>(null);
  let saveNote = $state<string | null>(null);

  function fail(e: unknown, savedVid: number, fallback: string): 'failed' {
    if (alive && vid === savedVid) {
      lastError = e instanceof ApiError ? e.displayMessage : fallback;
      if (e instanceof ApiError && (e.status === 403 || e.status === 409)) void loadAdminTree(savedVid, { force: true });
    }
    return 'failed';
  }

  // (a) The changed question fields, then (b) the option PATCHes: every
  // {is_correct:true} first, then every {is_correct:false}, then text-only, so
  // the server's ">=1 correct" rule holds mid-sequence. Stops at the first
  // failure; every part that succeeded has already advanced its baseline.
  // Inputs are frozen while this runs, so the per-field write-back can never
  // overwrite newer input.
  async function save(): Promise<'ok' | 'failed'> {
    if (!dirty) return 'ok';
    const savedVid = vid;
    lastError = null;
    saveNote = null;

    const body: QuestionUpdateBody = {};
    if (draft.text_md !== saved.text_md) body.text_md = draft.text_md;
    if (draft.explanation_md !== saved.explanation_md) {
      body.explanation_md = draft.explanation_md === '' ? null : draft.explanation_md;
    }
    if (question.type === 'numeric_answer' && answerChanged && numericCheck.ok) {
      body.correct_numeric = Number(numericCheck.canonical);
      body.precision = draft.precision;
    }
    if (question.type === 'text_answer' && answerChanged) body.correct_text = draft.correct_text.trim();
    if (Object.keys(body).length > 0) {
      try {
        const u = await updateQuestion(question.id, body);
        if (!(alive && vid === savedVid)) return 'failed';
        const echo = fromServer(u);
        // Per-field write-back: only the fields this request carried.
        if ('text_md' in body) { saved.text_md = echo.text_md; draft.text_md = echo.text_md; }
        if ('explanation_md' in body) { saved.explanation_md = echo.explanation_md; draft.explanation_md = echo.explanation_md; }
        if ('correct_numeric' in body) {
          saved.numericInput = echo.numericInput; draft.numericInput = echo.numericInput;
          saved.precision = echo.precision; draft.precision = echo.precision;
        }
        if ('correct_text' in body) { saved.correct_text = echo.correct_text; draft.correct_text = echo.correct_text; }
        textHtml = u.text_html;
      } catch (e) {
        return fail(e, savedVid, 'Save failed');
      }
    }

    const rank = (b: OptionUpdateBody) => (b.is_correct === true ? 0 : b.is_correct === false ? 1 : 2);
    const plan = options
      .map((o) => {
        const d = draftOf(o);
        const b: OptionUpdateBody = {};
        if (d.is_correct !== o.is_correct) b.is_correct = d.is_correct;
        if (d.text !== o.text) b.text = d.text;
        return { id: o.id, b };
      })
      .filter((p) => Object.keys(p.b).length > 0)
      .sort((x, y) => rank(x.b) - rank(y.b));          // stable: display order within a group
    let sentTrue = false;
    for (const p of plan) {
      try {
        const u = await updateOption(p.id, p.b);
        if (!(alive && vid === savedVid)) return 'failed';
        const d = optDrafts[u.id];
        if (d && 'text' in p.b) d.text = u.text;
        if (d && 'is_correct' in p.b) d.is_correct = u.is_correct;
        applyOption(u);
        if (p.b.is_correct === true) sentTrue = true;
      } catch (e) {
        // D10: the server briefly holds two correct options; the draft still
        // shows exactly one, and the next Save finishes the key.
        if (alive && vid === savedVid && question.type === 'single_choice' && sentTrue && p.b.is_correct === false) {
          saveNote = 'Saved partly — save again to finish the answer key.';
        }
        return fail(e, savedVid, 'Save failed');
      }
    }
    validated = false;
    return 'ok';
  }

  function discard() {
    draft = { ...saved };
    for (const o of options) {
      const d = optDrafts[o.id];
      if (d) { d.text = o.text; d.is_correct = o.is_correct; }
    }
    validated = false;
    lastError = null;
    saveNote = null;
  }

  // ---- Registration: one tracker in QuizEditor's private registry (the
  //      modal's footer and the page guard read it) and one save contributor. ----
  const snippet = $derived(textHtml.replace(/<[^>]*>/g, '').trim().slice(0, 80));
  const tracker: RegisteredTracker = { get isDirty() { return dirty; }, discard };
  const contributor: QuizContributor = {
    get questionId() { return question.id; },
    order: () => index,
    get isDirty() { return dirty; },
    locked: () => optionsLocked || upText || upExpl,
    keyChanged: () => keyChanged,
    validate,
    focusFirstInvalid,
    save,
    discard,
    get lastError() { return lastError; },
    title: () => snippet || `Question ${index}`,
  };
  $effect(() => {
    registry.register(tracker);
    hub.register(contributor);
    return () => { registry.unregister(tracker); hub.unregister(contributor); };
  });

  // Focus on expand (§10a): a pending invalid field first (D10), else the
  // body's first field, unless focus is already inside the body. tick() lets
  // the body render first.
  $effect(() => {
    if (expanded) {
      void tick().then(() => {
        if (!alive || !bodyEl) return;
        if (pendingInvalidFocus) {
          pendingInvalidFocus = false;
          // R9: a Title the modal has just flagged and focused keeps focus.
          if ((document.activeElement as HTMLElement | null)?.getAttribute('aria-invalid') === 'true') return;
          focusInvalidNow();
          return;
        }
        if (bodyEl.contains(document.activeElement)) return;
        bodyEl.querySelector<HTMLElement>('textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]), select:not([disabled])')?.focus();
      });
    }
  });

  // §7.2: structure is off without the structure perm, while this question is
  // dirty (until T5b), while a question add/delete/reorder is in flight
  // (`locked`), and while the modal is frozen.
  const structureDisabled = $derived(!perms.canEditStructure || dirty || locked || frozen);

  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'Single choice', multiple_choice: 'Multiple choice',
    numeric_answer: 'Numeric', text_answer: 'Text',
  };
  const toleranceHint = $derived(`± ${5 * Math.pow(10, -(draft.precision + 1))}`);
</script>

<div class="question" class:expanded>
  <div class="header" data-testid="question-header" aria-invalid={validated && needsFix ? 'true' : undefined}>
    <button type="button" class="expand" aria-expanded={expanded} onclick={onExpandToggle}>{expanded ? '▾' : '▸'}</button>
    <span class="num">{index}.</span>
    <span class="badge">{typeLabel[question.type]}</span>
    {#if isChoice}<span class="badge" data-testid="correct-count">{draftCorrectCount} correct</span>{/if}
    <span class="snippet">{snippet || '(no text)'}</span>
    {#if validated && needsFix}<span class="mono needs-fix" data-testid="needs-fixing">needs fixing</span>{/if}
    <span class="spacer"></span>
    <button type="button" aria-label="Move up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete question" disabled={structureDisabled} onclick={onDelete}>🗑</button>
  </div>

  {#if expanded}
    <div class="body" bind:this={bodyEl}>
      <span class="readonly-type">Type: {typeLabel[question.type]} (fixed)</span>
      {#if isPublished}
        <p class="muted" data-testid="published-type-note">Type can't be changed. To replace this question, create a new version.</p>
      {/if}
      <div class="text-field" data-field="text">
        <label>Question text
          <MarkdownEditor {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                          bind:value={draft.text_md} bind:uploading={upText} />
        </label>
        {#if showErrors && textError}<p class="err" role="alert" data-testid="text-error">{textError}</p>{/if}
      </div>
      <label>Explanation (optional)
        <MarkdownEditor {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                        bind:value={draft.explanation_md} bind:uploading={upExpl} />
      </label>

      {#if question.type === 'numeric_answer'}
        <label>Correct value
          <input data-testid="numeric-input" bind:value={draft.numericInput}
                 readonly={!editable || frozen} aria-required="true" aria-invalid={!numericCheck.ok} />
        </label>
        <label>Precision (0–10)
          <input data-testid="precision-input" type="number" min="0" max="10"
                 readonly={!editable || frozen} aria-invalid={!precisionValid} bind:value={draft.precision} />
        </label>
        <small class="hint">Accepted within {toleranceHint}</small>
        {#if numericError}<p class="err" role="alert">{numericError}</p>{/if}
        {#if !precisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
      {:else if question.type === 'text_answer'}
        <label>Correct answer
          <input data-testid="text-answer-input" bind:value={draft.correct_text}
                 readonly={!editable || frozen} maxlength="500" aria-required="true" aria-invalid={!textAnswerValid} />
        </label>
        <small class="hint">Case-insensitive, trimmed match. {draft.correct_text.length}/500</small>
        {#if !textAnswerValid}<p class="err" role="alert">Enter 1–500 characters.</p>{/if}
      {:else}
        {#if optStatus === 'loading'}
          <p class="muted">Loading options…</p>
        {:else if optStatus === 'error'}
          <p class="err" role="alert" data-testid="option-load-error">{optError}</p>
          <Button variant="ghost" onclick={() => void loadOptions()}>Retry</Button>
        {:else}
          {#if options.length === 0}
            <p class="muted">No options yet.</p>
          {:else}
            <fieldset class="option-group" data-testid="option-group">
              <legend>Answer options{question.type === 'single_choice' ? ' — select the correct option' : ' — select all correct options'}</legend>
              <ol class="options">
                {#each options as o, i (o.id)}
                  {@const d = optDrafts[o.id]}
                  {#if d}
                    <li>
                      <OptionRow
                        option={o} index={i + 1} count={options.length} questionType={question.type}
                        {perms} {frozen} optionsLocked={optionsDisabled} canDelete={canDeleteOption(o)}
                        mutating={optionsLocked}
                        correct={d.is_correct}
                        bind:draft={d.text}
                        onMark={(next) => mark(o.id, next)}
                        onDelete={() => void removeOption(o.id)}
                        onMoveUp={() => void moveOption(o.id, -1)}
                        onMoveDown={() => void moveOption(o.id, 1)}
                      />
                    </li>
                  {/if}
                {/each}
              </ol>
            </fieldset>
            {#if showErrors && markError}<p class="err" role="alert" data-testid="mark-error">{markError}</p>{/if}
          {/if}
          {#if isChoice && optStatus === 'loaded' && options.length < 2}<p class="muted" data-testid="few-options-warn">Add at least 2 options before publishing.</p>{/if}
          <p class="sr-only" aria-live="polite" data-testid="option-live">{optionAnnounce}</p>
          {#if optMutError}<p class="err" role="alert" data-testid="option-mut-error">{optMutError}</p>{/if}
          {#if perms.canEditStructure}
            {#if addingOption}
              <div class="add-option">
                <label>New option
                  <input data-testid="new-option-text" bind:value={newOptionText} maxlength="500" readonly={optionsDisabled} />
                </label>
                <Button onclick={() => void addOption()} disabled={optionsDisabled || !newOptionValid}>Add</Button>
                <Button variant="ghost" onclick={() => { addingOption = false; newOptionText = ''; }}>Cancel</Button>
              </div>
            {:else}
              <Button aria-label="Add option" onclick={() => { addingOption = true; }} disabled={optionsDisabled}>＋ Add option</Button>
            {/if}
          {/if}
        {/if}
      {/if}

      {#if saveNote}<p class="err" role="alert" data-testid="save-note">{saveNote}</p>{/if}
      {#if lastError}<p class="err" role="alert" data-testid="save-error">{lastError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .question { border: 1px solid var(--border); border-radius: var(--radius); }
  .header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); }
  .body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border-top: 1px solid var(--border); }
  .spacer { flex: 1; }
  .badge, .muted { font-size: 0.85em; color: var(--muted); }
  .needs-fix { font-size: 11.5px; color: var(--danger); }
  .err { color: var(--danger); }
  .options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .add-option { display: flex; align-items: end; gap: var(--space-2); }
  .option-group { border: none; margin: 0; padding: 0; }
  .option-group legend { font-size: 0.85em; color: var(--muted); padding: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
```

The interim styles above are plain token swaps (`--text-muted, #666` → `--muted`; `--danger, #c00` → `--danger`). T6 replaces the template and styles with the 3f look.

- [ ] **Step 6: `QuizEditor.svelte`** (full content)

```svelte
<script lang="ts">
  // The quiz body (Slice-5b §5): implements ItemBodyApi (lib/itemBody.ts) for
  // ItemEditorModal. Each QuestionAccordion owns its drafts and registers a
  // save contributor (QUIZ_SAVE_KEY). The footer Save validates the dirty ones
  // and sends them in display order after the title (§5.3). Structure (add /
  // delete / reorder of questions) acts immediately.
  import { onMount, onDestroy, setContext, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
  import { patchItem, reportSaveFailure, type SaveOutcome } from '../../lib/itemBody';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import QuestionAccordion from './QuestionAccordion.svelte';
  import QuestionTypePicker from './QuestionTypePicker.svelte';
  import {
    listQuestions, createQuestion, deleteQuestion, reorderQuestions,
    validateNumericAnswer,
    type AuthoringQuestion, type QuestionType, type QuestionCreateBody,
  } from '../../lib/quizAuthoring';

  let {
    itemId, vid, version, perms, assetContext, stillOnVid,
    versionDisabled = false, frozen = false,
    saveDirty = $bindable(false), guardDirty = $bindable(false), busy = $bindable(false),
  }: {
    itemId: number; vid: number;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    stillOnVid: (savedVid: number) => boolean;
    // D6: question editors show plain source, with no /render call.
    versionDisabled?: boolean;
    // D10/D9: a Save or an item delete is in flight.
    frozen?: boolean;
    saveDirty?: boolean; guardDirty?: boolean; busy?: boolean;
  } = $props();

  // ---- Save drafts (§5.1). This private registry shadows the page's, so the
  //      modal's ONE page tracker covers the quiz. Each accordion registers one
  //      tracker here and one save contributor on the hub. ----
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  const contributors = new SvelteSet<QuizContributor>();
  const hub: QuizSaveHub = {
    register(c) { contributors.add(c); },
    unregister(c) { contributors.delete(c); },
  };
  setContext(QUIZ_SAVE_KEY, hub);
  const ordered = () => [...contributors].sort((a, b) => a.order() - b.order());

  const KEY_CONFIRM =
    'This quiz is published. Changing the answer key does not re-score students who already ' +
    'attempted — their recorded scores keep the old key. To re-grade everyone, create a new ' +
    'version instead. Continue?';

  // ---- Lifecycle guard (§4.1a) ----
  let alive = true;
  let loadToken = 0;
  onDestroy(() => { alive = false; loadToken++; });

  // ---- Question list (authoritative; metadata + order) ----
  let questions = $state<AuthoringQuestion[]>([]);
  let loadStatus = $state<'loading' | 'loaded' | 'error'>('loading');
  let loadError = $state<string | null>(null);
  let expandedId = $state<number | null>(null);
  let questionsLocked = $state(false); // serialize add/delete/reorder (§7.2)
  let questionAnnounce = $state('');

  // ---- The §2 body contract's bindables ----
  $effect(() => { saveDirty = registry.isAnyDirty(); });
  // T5b adds the typed add-question / add-option forms here (QUIZ_GUARD_KEY).
  $effect(() => { guardDirty = registry.isAnyDirty(); });
  $effect(() => { busy = questionsLocked || [...contributors].some((c) => c.locked()); });

  async function load() {
    loadToken += 1;
    const myToken = loadToken;
    loadStatus = 'loading';
    loadError = null;
    try {
      const list = await listQuestions(itemId);
      if (myToken !== loadToken) return;
      questions = [...list].sort((a, b) => a.order - b.order);
      loadStatus = 'loaded';
    } catch (e) {
      if (myToken !== loadToken) return;
      loadError = e instanceof ApiError ? e.displayMessage : 'Could not load questions.';
      loadStatus = 'error';
    }
  }
  onMount(() => { void load(); });

  // ---- ItemBodyApi ----

  // D10: every contributor validates (so each invalid question shows its
  // errors); a clean one always passes. The first invalid question is
  // expanded and its first invalid field focused.
  export function validate(): boolean {
    const bad = ordered().filter((c) => !c.validate());
    if (bad.length === 0) return true;
    bad[0].focusFirstInvalid();
    expandedId = bad[0].questionId;
    return false;
  }

  export function discard(): void { registry.discardAll(); }
  export function discardAll(): void { discard(); }

  // §5.3: one D20 confirm, then the title, then the dirty questions in display
  // order. Stops at the first failure; 'partial' when anything had landed.
  export async function save(titleDraft: string | undefined): Promise<SaveOutcome> {
    const savedVid = vid;
    const dirtyOnes = ordered().filter((c) => c.isDirty);
    if (version.state === 'published' && dirtyOnes.some((c) => c.keyChanged()) && !confirm(KEY_CONFIRM)) {
      return { outcome: 'failed' };
    }
    let savedTitle: string | undefined;
    let progressed = false;
    if (titleDraft !== undefined) {
      try {
        savedTitle = (await patchItem(itemId, { title: titleDraft })).title;
        progressed = true;
      } catch (e) {
        reportSaveFailure(e, savedVid, stillOnVid);
        return { outcome: 'failed' };
      }
    }
    for (const c of dirtyOnes) {
      if (!alive) return { outcome: progressed ? 'partial' : 'failed', savedTitle };
      if ((await c.save()) === 'ok') { progressed = true; continue; }
      if (alive && stillOnVid(savedVid)) {
        const n = questions.findIndex((x) => x.id === c.questionId) + 1;
        pushToast(`Question ${n}: ${c.lastError ?? 'Save failed'} — Save again to send the rest.`, 'error');
        expandedId = c.questionId;
      }
      return { outcome: progressed ? 'partial' : 'failed', savedTitle };
    }
    return { outcome: 'ok', savedTitle };
  }

  // ---- Add-question form: collects the per-type CORRECT ANSWER at creation,
  //      because the backend does NOT validate correctness on create
  //      (questions.py:116 validates only on update; §3.6/§8). Fabricated
  //      defaults are NOT acceptable — they ship a wrong-but-valid-looking key. ----
  let adding = $state(false);
  let newType = $state<QuestionType>('single_choice');
  let newText = $state('');
  let newNumeric = $state('');     // numeric_answer: raw string, validated via §8.3
  let newPrecision = $state(0);    // numeric_answer: integer 0–10
  let newAnswer = $state('');      // text_answer: 1–500 chars
  let addError = $state<string | null>(null);

  const newNumericCheck = $derived(
    newType === 'numeric_answer' ? validateNumericAnswer(newNumeric) : { ok: true as const, canonical: '' },
  );
  const newNumericError = $derived(newNumericCheck.ok ? null : newNumericCheck.reason);
  const newPrecisionValid = $derived(
    Number.isInteger(newPrecision) && newPrecision >= 0 && newPrecision <= 10,
  );
  const addValid = $derived(
    newText.trim() !== '' && (
      newType === 'numeric_answer' ? (newNumericCheck.ok && newPrecisionValid)
        : newType === 'text_answer' ? (newAnswer.trim().length >= 1 && newAnswer.length <= 500)
          : true   // choice types: options (hence correctness) are added afterwards
    ),
  );

  function resetAddForm() {
    newText = ''; newNumeric = ''; newPrecision = 0; newAnswer = ''; addError = null;
  }

  function buildCreateBody(): QuestionCreateBody {
    const base = { text_md: newText.trim(), type: newType };
    if (newType === 'numeric_answer' && newNumericCheck.ok) {
      return { ...base, correct_numeric: Number(newNumericCheck.canonical), precision: newPrecision };
    }
    if (newType === 'text_answer') return { ...base, correct_text: newAnswer.trim() };
    return base;  // single_choice / multiple_choice — options are added afterwards
  }

  async function submitAdd() {
    if (questionsLocked || frozen || !perms.canEditStructure || !addValid) return;
    const savedVid = vid;
    const body = buildCreateBody();
    addError = null;
    questionsLocked = true;
    try {
      const created = await createQuestion(itemId, body);
      if (!(alive && vid === savedVid)) return;
      questions = [...questions, created].sort((a, b) => a.order - b.order);
      adding = false; resetAddForm();
      expandedId = created.id;                        // open the new question for editing
      await loadAdminTree(savedVid, { force: true }); // refresh questions_count
    } catch (e) {
      if (alive && vid === savedVid) {
        addError = e instanceof ApiError ? e.displayMessage : 'Add failed';
        if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
          await load();
          if (alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
        }
      }
    } finally { if (alive) questionsLocked = false; }
  }

  // ---- Delete question ----
  async function removeQuestion(qid: number) {
    if (questionsLocked || frozen || !perms.canEditStructure) return;
    if (!questions.some((x) => x.id === qid)) return;
    if (!confirm('Delete this question? Its options and text are lost.')) return;
    const savedVid = vid;
    const idx = questions.findIndex((x) => x.id === qid);
    questionsLocked = true;
    try {
      await deleteQuestion(qid);
      if (!(alive && vid === savedVid)) return;
      questions = questions.filter((x) => x.id !== qid);
      if (expandedId === qid) expandedId = null;
      const focusId = questions[Math.min(idx, questions.length - 1)]?.id;
      await loadAdminTree(savedVid, { force: true });
      await tick();
      if (alive && vid === savedVid && focusId != null) {
        document.querySelector<HTMLElement>(`[data-q-id="${focusId}"] [data-testid="question-header"] button[aria-expanded]`)?.focus();
      }
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
        await load();
        if (e instanceof ApiError && (e.status === 403 || e.status === 409) && alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  // ---- Reorder question (↑/↓): optimistic local swap, POST the full id-set ----
  async function move(qid: number, dir: -1 | 1) {
    if (questionsLocked || frozen || !perms.canEditStructure) return;
    const idx = questions.findIndex((x) => x.id === qid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= questions.length) return;
    const savedVid = vid;
    const next = [...questions];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    questions = next.map((x, i) => ({ ...x, order: i + 1 }));
    const newIndex = questions.findIndex((x) => x.id === qid) + 1;
    questionAnnounce = `Question moved to position ${newIndex} of ${questions.length}`;
    const order = questions.map((x) => ({ id: x.id, order: x.order }));
    questionsLocked = true;
    try {
      await reorderQuestions(itemId, order);
      // success: the optimistic state is authoritative; order is not shown in
      // the admin tree, so no forced reload is needed.
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
        await load();
        if (e instanceof ApiError && (e.status === 403 || e.status === 409) && alive && vid === savedVid) await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  function toggleExpand(qid: number) { expandedId = expandedId === qid ? null : qid; }
  const structureOff = $derived(!perms.canEditStructure);
  const readOnlyAll = $derived(!perms.canEditTextFields && !perms.canEditStructure);  // archived/disabled (§9)
</script>

<section class="quiz-editor" aria-label="Quiz editor">
  {#if readOnlyAll}<p class="muted" data-testid="quiz-readonly">This version is read-only — editing is disabled.</p>{/if}

  {#if loadStatus === 'loading'}
    <p class="muted">Loading questions…</p>
  {:else if loadStatus === 'error'}
    <p class="err" role="alert">{loadError}</p>
    <Button variant="ghost" onclick={() => void load()}>Retry</Button>
  {:else}
    {#if questions.length === 0}
      <p class="muted">No questions yet.</p>
    {:else}
      <p class="sr-only" aria-live="polite" data-testid="question-live">{questionAnnounce}</p>
      <ol class="questions">
        {#each questions as q, i (q.id)}
          <li data-q-id={q.id}>
            <QuestionAccordion
              question={q}
              {vid}
              index={i + 1}
              count={questions.length}
              {perms}
              {assetContext}
              {versionDisabled}
              {frozen}
              locked={questionsLocked}
              expanded={expandedId === q.id}
              onExpandToggle={() => toggleExpand(q.id)}
              onDelete={() => void removeQuestion(q.id)}
              onMoveUp={() => void move(q.id, -1)}
              onMoveDown={() => void move(q.id, 1)}
            />
          </li>
        {/each}
      </ol>
    {/if}

    {#if !structureOff}
      {#if adding}
        <div class="add-form">
          <QuestionTypePicker bind:value={newType} disabled={questionsLocked || frozen} />
          <label>Question text
            <input data-testid="new-question-text" bind:value={newText} required />
          </label>
          {#if newType === 'numeric_answer'}
            <label>Correct value
              <input data-testid="new-numeric" bind:value={newNumeric} aria-invalid={!newNumericCheck.ok} />
            </label>
            <label>Precision (0–10)
              <input data-testid="new-precision" type="number" min="0" max="10" bind:value={newPrecision} />
            </label>
            {#if newNumericError}<p class="err" role="alert">{newNumericError}</p>{/if}
            {#if !newPrecisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
          {:else if newType === 'text_answer'}
            <label>Correct answer
              <input data-testid="new-text-answer" bind:value={newAnswer} maxlength="500" />
            </label>
          {:else}
            <p class="muted">Add the answer options after creating the question.</p>
          {/if}
          {#if addError}<p class="err" role="alert">{addError}</p>{/if}
          <Button onclick={() => void submitAdd()} disabled={questionsLocked || frozen || !addValid}>Add</Button>
          <Button variant="ghost" onclick={() => { adding = false; resetAddForm(); }}>Cancel</Button>
        </div>
      {:else}
        <Button aria-label="Add question" onclick={() => { adding = true; }} disabled={questionsLocked || frozen}>＋ Add question</Button>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: var(--space-3); }
  .questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .muted { color: var(--muted); }
  .err { color: var(--danger); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
```

- [ ] **Step 7: Wire the quiz body into `ItemEditorModal.svelte`**

Replace the type-body comment:
```ts
  // ---- The type body (§2 contract). The quiz has none until T5a. VideoBody
  //      has no `busy` (nothing uploads); AppBody has no drafts (its script
  //      row acts immediately), so it binds `busy` only. ----
```
with:
```ts
  // ---- The type body (§2 contract). VideoBody has no `busy` (nothing
  //      uploads); AppBody has no drafts (its script row acts immediately), so
  //      it binds `busy` only. ----
```

Replace `  // Interim (quiz until T5a): no body API, so the modal sends the title.` with `  // No body (an item type this modal can't edit): the modal sends the title itself.`

Replace the whole interim quiz branch, from `  {:else if item.type === 'quiz'}` through the closing `/>` of its `<QuizEditor`, with:
```svelte
  {:else if item.type === 'quiz'}
    <QuizEditor
      bind:this={body}
      itemId={item.id}
      {vid}
      {version}
      {perms}
      {assetContext}
      {versionDisabled}
      {frozen}
      {stillOnVid}
      bind:saveDirty={bodySaveDirty}
      bind:guardDirty={bodyGuardDirty}
      bind:busy={bodyBusy}
    />
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/OptionRow.svelte.test.ts src/tests/QuestionAccordion.svelte.test.ts src/tests/QuizEditor.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts src/tests/dirtyRegistry.test.ts`

Expected: PASS.
- OptionRow: 12.
- QuestionAccordion: 54.
- QuizEditor: 26.
- ItemEditorModal: +6 net (2 interim quiz tests removed, 8 added).

Then run `grep -rn "confirmKeyChange\|quizDirty\|showTitle\|onCommitText\|onToggleCorrect" frontend/src`. Expected: no hits.

- [ ] **Step 9: Full verification**

Run: `npm test 2>&1 | tail -4`, then `npm run check 2>&1 | tail -1`, then `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.

Expected:
- tests: 135 files, 1686 tests, all pass;
  - the arithmetic: 1671 + OptionRow 0 (12 → 12) + QuestionAccordion 4 (50 → 54) + QuizEditor 5 (21 → 26) + ItemEditorModal 6;
- check: 0 errors, warnings ≤ 18 (the new top-level prop reads are wrapped in `untrack`);
- gate: `ALL PASS` (no CSS pinned by the gate changed).

- [ ] **Step 10: Review** (both lanes on the uncommitted diff; Review Focus 2). Then wait for the user's OK.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/quizSave.ts frontend/src/components/editor/QuestionAccordion.svelte frontend/src/components/editor/QuizEditor.svelte frontend/src/components/editor/OptionRow.svelte frontend/src/components/editor/ItemEditorModal.svelte frontend/src/tests/support/QuestionAccordionHarness.svelte frontend/src/tests/QuestionAccordion.svelte.test.ts frontend/src/tests/QuizEditor.svelte.test.ts frontend/src/tests/OptionRow.svelte.test.ts frontend/src/tests/ItemEditorModal.svelte.test.ts
git commit -m "$(cat <<'MSG'
feat(editor): Slice 5b T5a — quiz drafts + one footer Save

Question text, explanation, answers, option text and correct marks become
drafts on the always-mounted accordion; each registers a save contributor
(QUIZ_SAVE_KEY). QuizEditor implements the body contract: one D20 confirm,
then the title, then dirty questions in display order (true before false),
dirty-scoped validation, partial-failure toast. Per-question Save, the
option blur-commit, the immediate toggle and the per-question latch go.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5b: Quiz structure with live drafts (§5.4, D24, guard trackers)

**What this task builds.** Structure no longer waits for a clean question (D3, §5.4).

- **The two-way lock goes.** The `dirty` term leaves `structureDisabled` and `optionsDisabled` in `QuestionAccordion`. What stays serialised:
  - `questionsLocked` and `optionsLocked` still serialise structure operations;
  - `frozen` (a Save in flight) still disables structure;
  - `busy` still disables Save while structure is in flight. That landed in T5a; this task adds the tests for it under drafts.
- **Drafts are keyed by id**, so they survive every structure operation:
  - add, delete and reorder of questions and options;
  - an option refetch (`setOptions`: clean fields follow the server, dirty fields stay).
- **D24.** When a question's mark drafts differ from saved, deleting **any** of its options:
  1. asks `Delete option "…"? This cannot be undone. Your unsaved correct-answer change will be reset.`;
  2. on success, resets only that question's marks to saved. Its text drafts survive;
  3. on failure, changes nothing.
- **Delete question** asks `Delete question "<title>"? This cannot be undone.`, with `editorReasons.unsavedSuffix(contributor.isDirty)` appended.
- **The add forms are guard-dirty, not save-dirty (D5).**
  - `QuizEditor` creates a second private registry on `QUIZ_GUARD_KEY`.
  - The add-question form and each accordion's add-option form register 5a-style shims in it:
    - `isDirty` = the form is open **and** has typed input;
    - `discard()` collapses the form.
  - `guardDirty` = the save drafts **or** the guards.
  - `discardAll()` (a confirmed close) discards both. The footer's `discard()` discards save drafts only.

**Files:**
- Modify:
  - `frontend/src/components/editor/QuestionAccordion.svelte`
  - `frontend/src/components/editor/QuizEditor.svelte`
  - `frontend/src/components/editor/OptionRow.svelte` (one comment)
  - `frontend/src/tests/support/QuestionAccordionHarness.svelte`
  - `frontend/src/tests/QuestionAccordion.svelte.test.ts`
  - `frontend/src/tests/QuizEditor.svelte.test.ts`
  - `frontend/src/tests/ItemEditorModal.svelte.test.ts`

**Interfaces:**
- Consumes:
  - T5a's `QUIZ_GUARD_KEY`, `QuizContributor.title()` and `.isDirty`;
  - `createDirtyRegistry`, `RegisteredTracker`;
  - `unsavedSuffix` (`lib/editorReasons.ts`).
- Produces:
  - the `QUIZ_GUARD_KEY` context value is a `DirtyRegistry`;
  - the harness gains an `onGuards(registry)` prop and an `output[data-testid="guard-dirty"]`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/support/QuestionAccordionHarness.svelte` — replace:
```ts
  import { QUIZ_SAVE_KEY, type QuizSaveHub } from '../../lib/quizSave';
```
with:
```ts
  import { QUIZ_GUARD_KEY, QUIZ_SAVE_KEY, type QuizSaveHub } from '../../lib/quizSave';
```
Then replace:
```ts
  setContext(QUIZ_SAVE_KEY, hub);
</script>
<output data-testid="any-dirty">{registry.isAnyDirty() ? 'dirty' : 'clean'}</output>
```
with:
```ts
  setContext(QUIZ_SAVE_KEY, hub);
  // T5b: the typed add-option form registers here (guard-dirty, never save-dirty).
  const guards = createDirtyRegistry();
  setContext(QUIZ_GUARD_KEY, guards);
  untrack(() => props.onGuards)?.(guards);
</script>
<output data-testid="any-dirty">{registry.isAnyDirty() ? 'dirty' : 'clean'}</output>
<output data-testid="guard-dirty">{guards.isAnyDirty() ? 'dirty' : 'clean'}</output>
```

`frontend/src/tests/QuestionAccordion.svelte.test.ts`:

(a) Add `import type { DirtyRegistry } from '../lib/dirtyRegistry.svelte';` after the `QuizContributor` import.

(b) Replace the T5a test `it("a dirty question disables its own delete and reorder (two-way lock; T5b removes it)", () => {` and its body with:
```ts
it('a dirty question keeps its own delete and reorder enabled (§5.4: the two-way lock is gone)', () => {
  const { target } = mountAccordion(q(), { count: 2, index: 2 });
  setVal(numInput(target), '7');
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(false);
  expect((target.querySelector('button[aria-label="Move up"]') as HTMLButtonElement).disabled).toBe(false);
});
```

(c) Replace the T5a test `it('a dirty question disables add-option (two-way lock; T5b removes it)', async () => {` and its body with:
```ts
it('a dirty question keeps add-option enabled (§5.4)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  setVal(textArea(target), 'Edited question body');
  expect(addOptionBtn(target).disabled).toBe(false);
});
```

(d) Append:
```ts
// ---- Structure with live drafts (Slice-5b T5b, §5.4, D24) ----

const ABC = () => [
  opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
  opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  opt({ id: 3, text: 'C', is_correct: false, order: 3 }),
];
const rowBtn = (t: HTMLElement, row: number, label: string) =>
  t.querySelectorAll('[data-testid="option-row"]')[row].querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

it('with drafts, option add/delete/reorder stay usable and every draft stays on its own option', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(ABC());
  vi.spyOn(qa, 'reorderOptions').mockResolvedValue(undefined as never);
  vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  vi.spyOn(qa, 'createOption').mockResolvedValue(opt({ id: 4, text: 'D', is_correct: false, order: 4 }));
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[1], 'B2');                     // a text draft on B
  rowBtn(target, 1, 'Move option up').click();            // B moves to the top
  await loaded();
  expect(optInputs(target).map((i) => i.value)).toEqual(['B2', 'A', 'C']);
  rowBtn(target, 2, 'Delete option').click();             // delete C: no mark draft → no confirm
  await loaded();
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(optInputs(target).map((i) => i.value)).toEqual(['B2', 'A']);
  addOptionBtn(target).click();
  flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'D');
  addBtn(target).click();
  await loaded();
  expect(optInputs(target).map((i) => i.value)).toEqual(['B2', 'A', 'D']);
  expect(c().isDirty).toBe(true);
});

it('a refetch keeps a dirty draft and lets the clean fields follow the server', async () => {
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce(AB())
    .mockResolvedValueOnce([opt({ id: 1, text: 'A*', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 })]);
  vi.spyOn(qa, 'reorderOptions').mockRejectedValue(new Error('boom'));   // the failure triggers the §6 resync
  const { target } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[1], 'B2');
  rowBtn(target, 0, 'Move option down').click();
  await loaded(); await loaded();
  expect(optInputs(target).map((i) => i.value)).toEqual(['A*', 'B2']);
});

it('D24: with a mark draft, deleting an option asks first; Cancel sends nothing; OK deletes and resets only the marks', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(ABC());
  const del = vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[0], 'A2');                     // a text draft (survives)
  radios(target)[1].click();                              // a mark draft (B)
  flushSync();
  rowBtn(target, 2, 'Delete option').click();
  await loaded();
  expect(confirmSpy).toHaveBeenLastCalledWith(
    'Delete option "C"? This cannot be undone. Your unsaved correct-answer change will be reset.');
  expect(del).not.toHaveBeenCalled();
  rowBtn(target, 2, 'Delete option').click();
  await loaded(); await loaded();
  expect(del).toHaveBeenCalledWith(3);
  expect(radios(target).map((r) => r.checked)).toEqual([true, false]);   // marks back to saved
  expect(optInputs(target)[0].value).toBe('A2');                         // the text draft survives
  expect(c().keyChanged()).toBe(false);
});

it('D24: a failed delete leaves the mark drafts as they were', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(ABC());
  vi.spyOn(qa, 'deleteOption').mockRejectedValue(new Error('boom'));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[1].click();
  flushSync();
  rowBtn(target, 2, 'Delete option').click();
  await loaded(); await loaded();
  expect(radios(target).map((r) => r.checked)).toEqual([false, true, false]);
  expect(c().keyChanged()).toBe(true);
});

it('a typed add-option form is guard-dirty but not save-dirty; the guard discard collapses it', async () => {
  let guards!: DirtyRegistry;
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target, c } = mountAccordion(choiceQ(), { onGuards: (g: DirtyRegistry) => { guards = g; } });
  await loaded();
  const guardDirty = () => target.querySelector('[data-testid="guard-dirty"]')!.textContent;
  addOptionBtn(target).click();
  flushSync();
  expect(guardDirty()).toBe('clean');                     // open but empty
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'Half');
  expect(guardDirty()).toBe('dirty');
  expect(anyDirty(target)).toBe('clean');
  expect(c().isDirty).toBe(false);
  guards.discardAll();
  flushSync();
  expect(target.querySelector('[data-testid="new-option-text"]')).toBeNull();
  expect(guardDirty()).toBe('clean');
});

it('locked() is true while an option mutation is in flight (it blocks the footer Save)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  let resolveDel!: () => void;
  vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise((r) => { resolveDel = r as () => void; }));
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  expect(c().locked()).toBe(false);
  rowBtn(target, 1, 'Delete option').click();
  flushSync();
  expect(c().locked()).toBe(true);
  resolveDel();
  await loaded();
  expect(c().locked()).toBe(false);
});
```

`frontend/src/tests/QuizEditor.svelte.test.ts` — append:
```ts
// ---- Structure with live drafts (Slice-5b T5b, §5.4) ----

it('deleting a question confirms with its title, plus the unsaved suffix when it has drafts', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  const del = vi.spyOn(qa, 'deleteQuestion').mockResolvedValue();
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { target } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  inQ<HTMLButtonElement>(target, 1, 'button[aria-label="Delete question"]').click();
  inQ<HTMLButtonElement>(target, 2, 'button[aria-label="Delete question"]').click();
  expect(confirmSpy.mock.calls.map((c) => c[0])).toEqual([
    'Delete question "A"? This cannot be undone. Unsaved edits may be lost.',
    'Delete question "B"? This cannot be undone.',
  ]);
  expect(del).not.toHaveBeenCalled();
});

it('reordering keeps each draft on its question, and save() follows the new display order', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined);
  const log: number[] = [];
  vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number, body: { text_md?: string }) => {
    log.push(qid);
    return Promise.resolve(q({ id: qid, text_md: body.text_md ?? '' }));
  });
  const { target, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  await expandQ(target, 2);
  setVal(inQ<HTMLTextAreaElement>(target, 2, '[data-field="text"] textarea'), 'B2');
  inQ<HTMLButtonElement>(target, 2, 'button[aria-label="Move up"]').click();
  await loaded();
  await expandQ(target, 1);
  expect(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea').value).toBe('A2');
  await cmp.save(undefined);
  expect(log).toEqual([2, 1]);
});

it('adding a question keeps the drafts of the others', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  vi.spyOn(qa, 'createQuestion').mockResolvedValue(
    q({ id: 5, order: 2, type: 'text_answer', text_md: 'New', correct_text: 'a', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'New');
  setInput(target, 'new-text-answer', 'a');
  clickByText(target, 'Add');
  await loaded();
  expect(props.saveDirty).toBe(true);
  await expandQ(target, 1);
  expect(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]').value).toBe('9');
});

it('a typed add-question form is guard-dirty, not save-dirty; discard() keeps it, discardAll() collapses it', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const { target, props, cmp } = mountEditor();
  await loaded();
  openAddForm(target);
  expect(props.guardDirty).toBe(false);                   // open but empty
  setInput(target, 'new-question-text', 'Half-typed');
  expect(props.guardDirty).toBe(true);
  expect(props.saveDirty).toBe(false);
  cmp.discard();                                          // the footer Discard: save drafts only
  flushSync();
  expect(target.querySelector('[data-testid="new-question-text"]')).not.toBeNull();
  cmp.discardAll();                                       // a confirmed close
  flushSync();
  expect(target.querySelector('[data-testid="new-question-text"]')).toBeNull();
  expect(props.guardDirty).toBe(false);
});

it('an option structure op in flight makes busy true', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    { id: 1, question_id: 1, text: 'A', is_correct: true, order: 1 },
    { id: 2, question_id: 1, text: 'B', is_correct: false, order: 2 },
  ]);
  vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise(() => {}));
  const { target, props } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  (target.querySelectorAll('[data-testid="option-row"]')[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  flushSync();
  expect(props.busy).toBe(true);
});
```

`frontend/src/tests/ItemEditorModal.svelte.test.ts` — insert these two tests at the end of the `'ItemEditorModal — quiz body (T5a)'` describe, just before its closing `});` (the last line of the file), so they can use its `serveQuiz`:
```ts
  // ---- Structure with drafts (Slice-5b T5b) ----
  it('a typed add-question form makes closing prompt but leaves the footer clean; a confirmed close collapses it', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    panel().querySelector<HTMLButtonElement>('button[aria-label="Add question"]')!.click();
    flushSync();
    type(panel().querySelector<HTMLInputElement>('[data-testid="new-question-text"]')!, 'Half-typed');
    expect(anyDirty()).toBe('true');
    expect(dirtyText()).toBe('');
    expect(footBtn('Save').disabled).toBe(true);
    expect(trash().disabled).toBe(true);                    // D9: guard-dirty blocks the delete
    registry!.discardAll();
    flushSync();
    expect(panel().querySelector('[data-testid="new-question-text"]')).toBeNull();
    expect(anyDirty()).toBe('false');
  });

  it('Save is disabled while a question add is in flight, even with a dirty title', async () => {
    serveQuiz([textQ], (u, init) =>
      (u.endsWith('/items/7/questions') && init?.method === 'POST' ? new Promise<Response>(() => {}) : undefined));
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    expect(footBtn('Save').disabled).toBe(false);
    panel().querySelector<HTMLButtonElement>('button[aria-label="Add question"]')!.click();
    flushSync();
    type(panel().querySelector<HTMLInputElement>('[data-testid="new-question-text"]')!, 'Pick one');
    [...panel().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Add')!.click();
    await settle();
    expect(footBtn('Save').disabled).toBe(true);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/QuestionAccordion.svelte.test.ts src/tests/QuizEditor.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts`

Expected: FAIL, for these reasons:
- the structure buttons are still disabled while dirty (the two flipped tests and the "with drafts" tests);
- D24 calls no `confirm`;
- the delete-question message is the old one;
- `guard-dirty` stays `clean`;
- the modal's typed add form leaves `any-dirty` false.

Three new tests pin T5a behaviour that T5b must keep, so they pass before and after this task:
- `locked() is true while an option mutation is in flight`;
- `an option structure op in flight makes busy true`;
- `Save is disabled while a question add is in flight`.

- [ ] **Step 3: `QuestionAccordion.svelte`**

(a) Replace the imports:
```ts
  import { QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
```
with:
```ts
  import { QUIZ_GUARD_KEY, QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
```
and replace:
```ts
  const hub = getContext<QuizSaveHub>(QUIZ_SAVE_KEY);
```
with:
```ts
  const hub = getContext<QuizSaveHub>(QUIZ_SAVE_KEY);
  // T5b: the typed add-option form is guard-dirty (D5). Optional: a harness
  // without it simply has no guard.
  const guards = getContext<DirtyRegistry | undefined>(QUIZ_GUARD_KEY);
```

(b) Replace:
```ts
  // The two-way lock stays until T5b: a dirty question locks option structure.
  const optionsDisabled = $derived(optionsLocked || dirty || frozen);
```
with:
```ts
  // §5.4: drafts are keyed by id, so structure no longer waits for a clean
  // question. Only an in-flight option mutation or a frozen modal locks it.
  const optionsDisabled = $derived(optionsLocked || frozen);
```

(c) Replace the whole `removeOption` function with:
```ts
  async function removeOption(oid: number) {
    if (optionsLocked || frozen || !perms.canEditStructure) return;
    const target = options.find((o) => o.id === oid);
    if (!target || !canDeleteOption(target)) return;
    // D24: a mark draft could point at a deleted row, so this question's marks
    // are reset by the delete, and the author is asked first. Text drafts survive.
    const resetMarks = marksChanged;
    if (resetMarks && !confirm(
      `Delete option "${draftOf(target).text}"? This cannot be undone. Your unsaved correct-answer change will be reset.`,
    )) return;
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      await deleteOption(oid);
      if (!(alive && vid === savedVid)) return;
      const idx = options.findIndex((o) => o.id === oid);
      const survivors = options.filter((o) => o.id !== oid);
      setOptions(survivors);
      if (resetMarks) {
        for (const o of options) { const d = optDrafts[o.id]; if (d) d.is_correct = o.is_correct; }
      }
      const focusId = survivors[Math.min(idx, survivors.length - 1)]?.id;
      await tick();
      if (alive && vid === savedVid && focusId != null) bodyEl?.querySelector<HTMLElement>(`[data-option-id="${focusId}"]`)?.focus();
    } catch (e) {
      await afterOptionError(e, savedVid, 'Delete option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
  }
```

(d) Replace:
```ts
  let addingOption = $state(false);
  let newOptionText = $state('');
  const newOptionValid = $derived(newOptionText.trim().length >= 1 && newOptionText.length <= 500);
```
with:
```ts
  let addingOption = $state(false);
  let newOptionText = $state('');
  const newOptionValid = $derived(newOptionText.trim().length >= 1 && newOptionText.length <= 500);
  // The 5a create-form shim (D5): guard-dirty once something is typed; a
  // confirmed close collapses the form. Never save-dirty.
  const addOptionGuard: RegisteredTracker = {
    get isDirty() { return addingOption && newOptionText.trim() !== ''; },
    discard() { addingOption = false; newOptionText = ''; },
  };
  $effect(() => {
    if (!guards) return;
    guards.register(addOptionGuard);
    return () => guards.unregister(addOptionGuard);
  });
```

(e) Replace:
```ts
  // §7.2: structure is off without the structure perm, while this question is
  // dirty (until T5b), while a question add/delete/reorder is in flight
  // (`locked`), and while the modal is frozen.
  const structureDisabled = $derived(!perms.canEditStructure || dirty || locked || frozen);
```
with:
```ts
  // §7.2/§5.4: structure is off without the structure perm, while a question
  // add/delete/reorder is in flight (`locked`), and while the modal is frozen.
  // A dirty question no longer locks it (drafts are keyed by id).
  const structureDisabled = $derived(!perms.canEditStructure || locked || frozen);
```

- [ ] **Step 4: `QuizEditor.svelte`**

(a) Replace:
```ts
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
```
with:
```ts
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { QUIZ_GUARD_KEY, QUIZ_SAVE_KEY, type QuizContributor, type QuizSaveHub } from '../../lib/quizSave';
  import { unsavedSuffix } from '../../lib/editorReasons';
```

(b) Replace:
```ts
  const ordered = () => [...contributors].sort((a, b) => a.order() - b.order());
```
with:
```ts
  const ordered = () => [...contributors].sort((a, b) => a.order() - b.order());
  // D5: the typed add-question / add-option forms. They make closing prompt
  // (guardDirty) but never reach the footer or Save.
  const guards = createDirtyRegistry();
  setContext(QUIZ_GUARD_KEY, guards);
```

(c) Replace:
```ts
  $effect(() => { saveDirty = registry.isAnyDirty(); });
  // T5b adds the typed add-question / add-option forms here (QUIZ_GUARD_KEY).
  $effect(() => { guardDirty = registry.isAnyDirty(); });
```
with:
```ts
  $effect(() => { saveDirty = registry.isAnyDirty(); });
  $effect(() => { guardDirty = registry.isAnyDirty() || guards.isAnyDirty(); });
```

(d) Replace:
```ts
  export function discard(): void { registry.discardAll(); }
  export function discardAll(): void { discard(); }
```
with:
```ts
  // The footer Discard: save drafts only.
  export function discard(): void { registry.discardAll(); }
  // A confirmed close (D5): save drafts, and the typed add forms collapse.
  export function discardAll(): void { discard(); guards.discardAll(); }
```

(e) Replace:
```ts
  function resetAddForm() {
    newText = ''; newNumeric = ''; newPrecision = 0; newAnswer = ''; addError = null;
  }
```
with:
```ts
  function resetAddForm() {
    newText = ''; newNumeric = ''; newPrecision = 0; newAnswer = ''; addError = null;
  }
  // The 5a create-form shim (D5): guard-dirty once something is typed.
  const addFormGuard: RegisteredTracker = {
    get isDirty() {
      return adding && (newText.trim() !== '' || newNumeric.trim() !== '' || newAnswer.trim() !== '');
    },
    discard() { adding = false; resetAddForm(); },
  };
  $effect(() => { guards.register(addFormGuard); return () => guards.unregister(addFormGuard); });
```

(f) In `removeQuestion`, replace:
```ts
    if (!confirm('Delete this question? Its options and text are lost.')) return;
```
with:
```ts
    const c = [...contributors].find((x) => x.questionId === qid);
    const title = c?.title() ?? `Question ${questions.findIndex((x) => x.id === qid) + 1}`;
    if (!confirm(`Delete question "${title}"? This cannot be undone.` + unsavedSuffix(c?.isDirty ?? false))) return;
```

- [ ] **Step 5: `OptionRow.svelte`** — replace the comment:
```ts
    // Option structure is locked: a mutation in flight, a dirty question
    // (until T5b) or a frozen modal.
```
with:
```ts
    // Option structure is locked: a mutation in flight, or a frozen modal.
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/QuestionAccordion.svelte.test.ts src/tests/QuizEditor.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts src/tests/OptionRow.svelte.test.ts`

Expected: PASS. QuestionAccordion has 60 tests (54 + 6; the two lock tests are flipped, not added), QuizEditor 31, and ItemEditorModal gains 2.

- [ ] **Step 7: Full verification**

Run: `npm test 2>&1 | tail -4`, then `npm run check 2>&1 | tail -1`, then `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.

Expected:
- tests: 135 files, 1699 tests (1686 + 6 + 5 + 2), all pass;
- check: 0 errors, warnings ≤ 18;
- gate: `ALL PASS`.

- [ ] **Step 8: Review** (both lanes on the uncommitted diff; Review Focus 3). Then wait for the user's OK.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/editor/QuestionAccordion.svelte frontend/src/components/editor/QuizEditor.svelte frontend/src/components/editor/OptionRow.svelte frontend/src/tests/support/QuestionAccordionHarness.svelte frontend/src/tests/QuestionAccordion.svelte.test.ts frontend/src/tests/QuizEditor.svelte.test.ts frontend/src/tests/ItemEditorModal.svelte.test.ts
git commit -m "$(cat <<'MSG'
feat(editor): Slice 5b T5b — quiz structure with live drafts

The two-way lock goes: add/delete/reorder of questions and options work
while drafts exist, and drafts stay keyed by id across every structure
change and refetch. D24 confirms an option delete over a mark draft and
resets only the marks; question delete names the question with the
unsaved suffix. Typed add forms are guard-dirty, never save-dirty.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: Quiz look (3f, §5.5, D15, D16, D23) + `QuestionTypePicker` + gate (ae)

**What this task builds.** The 3f look across the quiz files. Behaviour does not change, except for:
- the collapsed-form toggles;
- the D15 / D16 reasons.

**Kept as contracts:** every `data-testid`, every structure `aria-label` ("Move up", "Move down", "Delete question", "Move option up", "Move option down", "Delete option", "Add question", "Add option"), `[data-field="text"]`, `.body`, `.option` / `.option.correct`, the option `fieldset`+`legend`, and the "Add" / "Retry" button texts.

The changes, by file:
- **`QuizEditor`.**
  - A Questions heading row (ref 1885): the label, a mono count, and a primary `+` toggle labelled "Add question".
  - The add form is 5a's collapsed form: `+` becomes `×`, there is no Cancel button, and `<form novalidate>` submits on Enter. It has D12 inputs, Answer and Precision rows, and the restyled `QuestionTypePicker`.
  - The version's `structureReason` is passed to each accordion.
- **`QuestionAccordion`.**
  - The 3f card (ref 1890).
  - A `button.q-toggle` (`aria-expanded`, `aria-controls` while open) wrapping the mono `Q{n}` badge and the title.
  - The mono `correct-count` and the lowercase mono type name.
  - `IconButton sm` ↑ ↓ trash, with the D15 titles.
  - The stacked Question and Explanation rows (D23, with `ariaLabel` per R10).
  - The Answer and Precision rows (132px grid, D12 inputs, numeric in mono).
  - The Options heading row (label, `mark-error`, primary `+` toggle) and the add-option form as a collapsed form.
  - The option legend is `sr-only`, because the visible "Options" label replaces it.
  - The "Type: … (fixed)" line goes: the header shows the type.
- **`OptionRow`.**
  - The D25 / ref 1913 row: native mark at 15px with `accent-color`, a borderless D12 text input, and the `correct` pill.
  - `IconButton sm` ↑ ↓ trash, with the D16 titles and the C2 reason.
  - The `1.` number prefix goes, since 3f has none.
- **`QuestionTypePicker`.** 5a's `ItemTypePicker` cards: lowercase names, no glyphs, token colours only.
- **Constraint 4.** Numerals in visible text get `class="mono"` (hints, the `1–500` / `0–10` errors, the count).

**Rulings recorded in this task:**
- **R12 — The reorder titles are 5a's wording.** They read `Move up — already first` / `Move down — already last` (as `ItemRow.svelte:48-49`), not the spec's bare "Already first" / "Already last". One phrasing across the editor. Cost: none.
- **R13 — The `correct-count` stays in the header.** It shows the draft count (D25) as mono 11.5px `--muted` before the type name. 3f doesn't draw it, but it is a working signal and tests pin it. Cost: one span.
- **R14 — The C2 delete title.** When C2 blocks an option delete, the trash's title is `Can't delete the only correct option — mark another one correct and save first`. D24 says "the existing reason", but the old row had no title at all. Cost: one string.

**Files:**
- Modify:
  - `frontend/src/components/editor/QuizEditor.svelte`
  - `frontend/src/components/editor/QuestionAccordion.svelte`
  - `frontend/src/components/editor/OptionRow.svelte`
  - `frontend/src/components/editor/QuestionTypePicker.svelte`
  - `frontend/scripts/visual-refresh-gate.sh`
- Test (append):
  - `frontend/src/tests/QuestionAccordion.svelte.test.ts`
  - `frontend/src/tests/OptionRow.svelte.test.ts`
  - `frontend/src/tests/QuizEditor.svelte.test.ts`
  - `frontend/src/tests/QuestionTypePicker.svelte.test.ts`

**Interfaces:**
- Consumes:
  - `IconButton` (`glyph`, `title`, `size`, `primary`, `danger`, `aria-label`, `aria-expanded`, `disabled`, `onclick`);
  - `structureReason(version)` from `lib/editorReasons.ts`;
  - `MarkdownEditor.ariaLabel` (T2, R10);
  - `Button type="submit"`.
- Produces:
  - `QuestionAccordion` prop `structReason?: string | null` (default `null`);
  - classes `.questions-head`, `.q-toggle`, `.q-badge`, `.q-title`, `.q-type`, `.opts-head`, `.correct-badge`, `.qtype-picker`. T7's scans and later look tests use them.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/tests/QuestionAccordion.svelte.test.ts`:
```ts
// ---- 3f look (Slice-5b T6, §5.5, D15, D16, D23) ----

it('the header toggle carries the Q badge and title, controls the body, and shows the lowercase type', () => {
  const { target, props } = mountAccordion(q({ text_html: '<p>Area of a square</p>' }), { index: 2, count: 3, expanded: false });
  const toggle = header(target).querySelector('button.q-toggle') as HTMLButtonElement;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.querySelector('.q-badge')!.textContent).toBe('Q2');
  expect(toggle.querySelector('.q-title')!.textContent).toBe('Area of a square');
  expect(header(target).querySelector('.q-type')!.textContent).toBe('numeric answer');
  props.expanded = true;
  flushSync();
  const body = target.querySelector('.body') as HTMLElement;
  expect(body.id).not.toBe('');
  expect(toggle.getAttribute('aria-controls')).toBe(body.id);
});

it('names every type in lowercase (D15)', () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  const names: string[] = [];
  for (const type of ['single_choice', 'multiple_choice', 'numeric_answer', 'text_answer'] as const) {
    const { target } = mountAccordion(q({ type }), { expanded: false });
    names.push(header(target).querySelector('.q-type')!.textContent!);
    cleanup?.(); cleanup = null; document.body.innerHTML = '';
  }
  expect(names).toEqual(['single choice', 'multiple choice', 'numeric answer', 'text answer']);
});

it('the arrows state the boundary; a version structure reason titles every control (D15, R12)', () => {
  const title = (t: HTMLElement, l: string) => (t.querySelector(`button[aria-label="${l}"]`) as HTMLButtonElement).title;
  const { target, props } = mountAccordion(q(), { index: 1, count: 2, expanded: false });
  expect(title(target, 'Move up')).toBe('Move up — already first');
  expect(title(target, 'Move down')).toBe('Move down');
  expect(title(target, 'Delete question')).toBe('Delete question');
  props.index = 2;
  flushSync();
  expect(title(target, 'Move up')).toBe('Move up');
  expect(title(target, 'Move down')).toBe('Move down — already last');
  props.structReason = 'Only a created version can change its structure';
  flushSync();
  for (const l of ['Move up', 'Move down', 'Delete question']) {
    expect(title(target, l)).toBe('Only a created version can change its structure');
  }
});

it('Question and Explanation stack their labels above editors named by ariaLabel (D23, R10)', () => {
  const { target } = mountAccordion(q());
  const text = target.querySelector('[data-field="text"]') as HTMLElement;
  const expl = target.querySelector('[data-field="explanation"]') as HTMLElement;
  expect(text.classList.contains('stack')).toBe(true);
  expect(expl.classList.contains('stack')).toBe(true);
  expect(text.firstElementChild!.textContent).toBe('Question');
  expect(text.querySelector('textarea')!.getAttribute('aria-label')).toBe('Question text');
  expect(expl.firstElementChild!.textContent).toBe('Explanation');
  expect(expl.querySelector('textarea')!.getAttribute('aria-label')).toBe('Explanation');
});

it('numeric Answer and Precision are labelled D12 mono inputs in grid rows', () => {
  const { target } = mountAccordion(q());
  const num = numInput(target);
  const prec = target.querySelector('[data-testid="precision-input"]') as HTMLInputElement;
  for (const el of [num, prec]) {
    expect(el.classList.contains('plain-input')).toBe(true);
    expect(el.classList.contains('mono')).toBe(true);
    expect(el.closest('.field-row')).not.toBeNull();
  }
  expect(num.labels![0].textContent).toBe('Answer');
  expect(prec.labels![0].textContent).toBe('Precision');
});

it('the Options heading row toggles the add-option form (+ ↔ ×), focusing the field on open', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const head = target.querySelector('.opts-head') as HTMLElement;
  expect(head.querySelector('.row-label')!.textContent).toBe('Options');
  const toggle = addOptionBtn(target);
  expect(head.contains(toggle)).toBe(true);
  expect(toggle.dataset.glyph).toBe('plus');
  toggle.click();
  await loaded();
  expect(toggle.dataset.glyph).toBe('close');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const input = target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  setVal(input, 'Half');
  toggle.click();
  flushSync();
  expect(target.querySelector('[data-testid="new-option-text"]')).toBeNull();
  toggle.click();
  await loaded();
  expect((target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement).value).toBe('');
});

it('renders no emoji or decorative glyphs; the controls are SVG icon buttons (Constraint 3)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  await loaded();
  expect(target.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿■-◿←-⇿＋×]/u);
  expect(target.querySelectorAll('button[aria-label="Move up"] svg, button[aria-label="Delete question"] svg')).toHaveLength(2);
});
```

Append to `frontend/src/tests/OptionRow.svelte.test.ts`:
```ts
// ---- 3f look (Slice-5b T6, D16, D25, R12, R14) ----

it('the structure controls are icon buttons titled with the boundary or the C2 reason (D16)', () => {
  const a = mountRow({ index: 1, count: 2, canDelete: false });
  expect(btn(a.target, 'Move option up').dataset.glyph).toBe('up');
  expect(btn(a.target, 'Move option up').title).toBe('Move up — already first');
  expect(btn(a.target, 'Move option down').title).toBe('Move down');
  expect(btn(a.target, 'Delete option').dataset.glyph).toBe('trash');
  expect(btn(a.target, 'Delete option').title)
    .toBe("Can't delete the only correct option — mark another one correct and save first");
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const b = mountRow({ index: 2, count: 2, canDelete: true });
  expect(btn(b.target, 'Move option down').title).toBe('Move down — already last');
  expect(btn(b.target, 'Delete option').title).toBe('Delete option');
});

it('a row has no number prefix and no glyph text; the correct mark is the 3f pill (D25)', () => {
  const { target } = mountRow({ correct: true });
  expect(target.querySelector('.opt-num')).toBeNull();
  expect(target.textContent).not.toMatch(/[←-⇿\u{1F5D1}]/u);
  expect(target.querySelector('[data-testid="option-correct"]')!.classList.contains('correct-badge')).toBe(true);
});
```

Append to `frontend/src/tests/QuizEditor.svelte.test.ts`:
```ts
// ---- 3f look (Slice-5b T6, §5.5, D15) ----

it('the Questions heading row shows the mono count; its + toggle opens and closes the add form', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 }), q({ id: 2, order: 2 })]);
  const { target } = mountEditor();
  await loaded();
  const head = target.querySelector('.questions-head') as HTMLElement;
  expect(head.querySelector('.questions-label')!.textContent).toBe('Questions');
  expect(head.querySelector('.q-count')!.textContent).toBe('2');
  const toggle = head.querySelector('button[aria-label="Add question"]') as HTMLButtonElement;
  expect(toggle.dataset.glyph).toBe('plus');
  toggle.click();
  await loaded();
  expect(toggle.dataset.glyph).toBe('close');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect((document.activeElement as HTMLInputElement).name).toBe('question-type');
  setInput(target, 'new-question-text', 'Half');
  toggle.click();
  flushSync();
  expect(target.querySelector('[data-testid="new-question-text"]')).toBeNull();
  toggle.click();
  await loaded();
  expect((target.querySelector('[data-testid="new-question-text"]') as HTMLInputElement).value).toBe('');
});

it('a published version titles every disabled question control with the structure reason (D15)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 }), q({ id: 2, order: 2 })]);
  const { target } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await loaded();
  expect(target.querySelector('button[aria-label="Add question"]')).toBeNull();
  const ctl = [...target.querySelectorAll(
    'button[aria-label="Move up"], button[aria-label="Move down"], button[aria-label="Delete question"]')] as HTMLButtonElement[];
  expect(ctl).toHaveLength(6);
  for (const b of ctl) {
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('Only a created version can change its structure');
  }
});

it('the add form offers the lowercase type cards', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  expect([...target.querySelectorAll('.qtype-picker label')].map((l) => l.textContent!.trim()))
    .toEqual(['single choice', 'multiple choice', 'numeric answer', 'text answer']);
});
```

Append to `frontend/src/tests/QuestionTypePicker.svelte.test.ts`:
```ts
it('renders 5a-style cards: lowercase names, the selected card marked, no glyphs (Slice-5b T6)', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer'; disabled?: boolean } =
    $state({ value: 'numeric_answer' });
  const cmp = mount(QuestionTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const labels = [...target.querySelectorAll('label')];
  expect(labels.map((l) => l.textContent!.trim())).toEqual(['single choice', 'multiple choice', 'numeric answer', 'text answer']);
  expect(labels.map((l) => l.classList.contains('selected'))).toEqual([false, false, true, false]);
  expect(target.querySelector('.glyph')).toBeNull();
  props.disabled = true;
  flushSync();
  expect([...target.querySelectorAll('input')].every((i) => i.disabled)).toBe(true);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/QuestionAccordion.svelte.test.ts src/tests/OptionRow.svelte.test.ts src/tests/QuizEditor.svelte.test.ts src/tests/QuestionTypePicker.svelte.test.ts`

Expected: FAIL, for these reasons:
- no `.q-toggle`, `.q-type`, `.stack`, `.opts-head`, `.questions-head` or `.qtype-picker`;
- the type names are capitalised;
- the structure buttons are text buttons with no titles or `data-glyph`;
- `.opt-num` exists;
- `.glyph` exists.

- [ ] **Step 3: `QuestionTypePicker.svelte`** (full content)

```svelte
<script lang="ts">
  // The add-question type picker (Slice-5b §5.5): 5a's ItemTypePicker cards,
  // with D15's lowercase type names and no glyphs (Constraint 3).
  import type { QuestionType } from '../../lib/quizAuthoring';
  let { value = $bindable(), disabled = false }: { value: QuestionType; disabled?: boolean } = $props();
  const TYPES: { value: QuestionType; label: string }[] = [
    { value: 'single_choice', label: 'single choice' },
    { value: 'multiple_choice', label: 'multiple choice' },
    { value: 'numeric_answer', label: 'numeric answer' },
    { value: 'text_answer', label: 'text answer' },
  ];
</script>

<fieldset class="qtype-picker" {disabled}>
  <legend>Question type</legend>
  <div class="cards">
    {#each TYPES as t (t.value)}
      <label class:selected={value === t.value}>
        <input type="radio" name="question-type" value={t.value} bind:group={value} {disabled} />
        <span>{t.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .qtype-picker { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 4px; /* the 4px label/field step */ font-size: 12.5px; color: var(--muted); }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; /* the 8px create-form gap (5a spec §4) */ }
  /* position: relative anchors the visually-hidden radio inside its card. */
  label {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  label.selected { border-color: var(--primary); background: var(--primary-soft); }
  /* The ItemTypePicker sr-only-radio focus idiom. */
  label:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }
  /* Constraint 2: the sr-only idiom for a still-focusable radio, not a dim. */
  label input { position: absolute; opacity: 0; pointer-events: none; }
  /* Disabled recedes via the disabled-control tokens (IconButton's), never opacity. */
  .qtype-picker:disabled label { border-color: var(--border-faint); background: var(--bg); color: var(--faint); cursor: not-allowed; }
  @media (forced-colors: active) {
    label.selected { border: 2px solid Highlight; }
    label:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
  }
</style>
```

- [ ] **Step 4: `OptionRow.svelte`** (full content)

```svelte
<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option (3f, ref 1913/1919). Presentational: it owns NO state
     (§4.1). The text input binds the accordion-owned draft, and the correct
     mark is the accordion's draft too (Slice-5b §5.2, D25); the row only
     emits callbacks. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import IconButton from '../ui/IconButton.svelte';

  let {
    option, index, count, questionType, perms, draft = $bindable(''), correct,
    frozen, optionsLocked, canDelete, mutating,
    onMark, onDelete, onMoveUp, onMoveDown,
  }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
    perms: VersionPermissions; draft: string;
    // D25: the DRAFT mark, so the row shows what Save will send.
    correct: boolean;
    // D10/D9: a Save or an item delete is in flight.
    frozen: boolean;
    // Option structure is locked: a mutation in flight, or a frozen modal.
    optionsLocked: boolean;
    canDelete: boolean;
    // An option mutation is in flight: the clicked structure button stays
    // natively enabled (no blur); the accordion's handlers guard re-entry.
    mutating: boolean;
    onMark: (next: boolean) => void;
    onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  const textReadOnly = $derived(!perms.canEditTextFields || frozen);
  // Checkables ignore `readonly`, so a frozen mark is `disabled` (D10).
  const markDisabled = $derived(!perms.canEditTextFields || frozen);
  const structureDisabled = $derived(optionsLocked && !mutating);
  // DB String(500), min_length=1. Flagged live; the footer Save's validate() blocks it.
  const lenInvalid = $derived(draft.trim().length < 1 || draft.length > 500);
  // D16 / R12: a disabled arrow states its boundary; R14: C2's reason on the trash.
  const upTitle = $derived(index <= 1 ? 'Move up — already first' : 'Move up');
  const downTitle = $derived(index >= count ? 'Move down — already last' : 'Move down');
  const deleteTitle = $derived(
    canDelete ? 'Delete option' : "Can't delete the only correct option — mark another one correct and save first",
  );
</script>

<div class="option" class:correct data-testid="option-row">
  {#if questionType === 'single_choice'}
    <input class="mark" type="radio" name={`correct-${option.question_id}`} checked={correct}
           disabled={markDisabled} onchange={() => onMark(true)}
           aria-label={`Mark option ${index} correct`} />
  {:else if questionType === 'multiple_choice'}
    <input class="mark" type="checkbox" checked={correct}
           disabled={markDisabled} onchange={(e) => onMark(e.currentTarget.checked)}
           aria-label={`Mark option ${index} correct`} />
  {/if}
  <input class="opt-input" data-testid="option-text" data-option-id={option.id} bind:value={draft}
         readonly={textReadOnly} aria-label={`Option ${index} text`} aria-invalid={lenInvalid} maxlength="500" />
  {#if lenInvalid}<span class="mono len-warn" role="alert" data-testid="option-len-warn">1–500 chars</span>{/if}
  {#if correct}<span class="correct-badge" data-testid="option-correct">correct</span>{/if}
  {#if perms.canEditStructure}
    <span class="actions">
      <IconButton size="sm" glyph="up" title={upTitle} aria-label="Move option up"
                  disabled={structureDisabled || index <= 1} onclick={onMoveUp} />
      <IconButton size="sm" glyph="down" title={downTitle} aria-label="Move option down"
                  disabled={structureDisabled || index >= count} onclick={onMoveDown} />
      <IconButton size="sm" glyph="trash" danger title={deleteTitle} aria-label="Delete option"
                  disabled={structureDisabled || !canDelete} onclick={onDelete} />
    </span>
  {/if}
</div>

<style>
  /* ref 1913 — #E9EBEF → --border (5a precedent), #fff → --surface. */
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 9px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius);
  }
  /* ref 1919 — follows the DRAFT mark (D25). */
  .option.correct { border-color: var(--primary); background: var(--primary-soft); }
  /* ref 1914: a 15px mark; the native control takes the primary accent. */
  .mark { flex: 0 0 auto; width: 15px; height: 15px; margin: 0; accent-color: var(--primary); }
  /* D12 metrics, borderless until focus, so the row reads like 3f's text but stays editable. */
  .opt-input {
    box-sizing: border-box;
    flex: 1;
    min-width: 0;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .opt-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft); /* D12 — InlineField's open editor */
    background: var(--surface);
  }
  .opt-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .len-warn { font-size: 12px; color: var(--danger); /* D12 */ }
  /* ref 1919 — #065F46 / #D1FAE5 → the accepted status pair. */
  .correct-badge {
    padding: 2px 7px;
    border-radius: 3px;
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
    font-size: 11px;
    font-weight: 500;
  }
  .actions { display: flex; align-items: center; gap: 6px; /* ref 1895 */ }
</style>
```

- [ ] **Step 5: `QuestionAccordion.svelte` — script edits**

(a) Replace:
```ts
  import Button from '../ui/Button.svelte';
```
with:
```ts
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
```

(b) Replace:
```ts
    onExpandToggle, onDelete, onMoveUp, onMoveDown, versionDisabled = false, frozen = false,
  }: {
```
with:
```ts
    onExpandToggle, onDelete, onMoveUp, onMoveDown, versionDisabled = false, frozen = false,
    structReason = null,
  }: {
```
Then replace:
```ts
    frozen?: boolean;
  } = $props();
```
with:
```ts
    frozen?: boolean;
    // Slice-5b D15: why the version forbids structure changes (the title of
    // every arrow and trash); null when it allows them.
    structReason?: string | null;
  } = $props();
  const uid = $props.id();
  const bodyId = `${uid}-body`;
```

(c) Append after the T5b `addOptionGuard` registration effect (the `$effect` ending `return () => guards.unregister(addOptionGuard);\n  });`):
```ts
  // The 5a collapsed-form toggle (+ ↔ ×): opening focuses the field; closing
  // drops what was typed.
  async function toggleAddOption() {
    if (optionsDisabled || !perms.canEditStructure) return;
    if (addingOption) { addingOption = false; newOptionText = ''; return; }
    addingOption = true;
    await tick();
    if (alive) bodyEl?.querySelector<HTMLInputElement>('[data-testid="new-option-text"]')?.focus();
  }
```

(d) Replace:
```ts
  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'Single choice', multiple_choice: 'Multiple choice',
    numeric_answer: 'Numeric', text_answer: 'Text',
  };
```
with:
```ts
  // D15: lowercase mono type names (3f, ref 1894).
  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'single choice', multiple_choice: 'multiple choice',
    numeric_answer: 'numeric answer', text_answer: 'text answer',
  };
  // D15 / R12: the version's reason first, then the boundary.
  const upTitle = $derived(structReason ?? (index <= 1 ? 'Move up — already first' : 'Move up'));
  const downTitle = $derived(structReason ?? (index >= count ? 'Move down — already last' : 'Move down'));
```

- [ ] **Step 6: `QuestionAccordion.svelte` — replace everything after `</script>`** with:

```svelte

<div class="question" class:expanded>
  <div class="q-head" data-testid="question-header" aria-invalid={validated && needsFix ? 'true' : undefined}>
    <button type="button" class="q-toggle" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined}
            onclick={onExpandToggle}>
      <span class="mono q-badge">Q{index}</span>
      <span class="q-title">{snippet || '(no text)'}</span>
    </button>
    {#if validated && needsFix}<span class="mono needs-fix" data-testid="needs-fixing">needs fixing</span>{/if}
    {#if isChoice}<span class="mono q-meta" data-testid="correct-count">{draftCorrectCount} correct</span>{/if}
    <span class="mono q-type">{typeLabel[question.type]}</span>
    <span class="actions">
      <IconButton size="sm" glyph="up" title={upTitle} aria-label="Move up"
                  disabled={structureDisabled || index <= 1} onclick={onMoveUp} />
      <IconButton size="sm" glyph="down" title={downTitle} aria-label="Move down"
                  disabled={structureDisabled || index >= count} onclick={onMoveDown} />
      <IconButton size="sm" glyph="trash" danger title={structReason ?? 'Delete question'} aria-label="Delete question"
                  disabled={structureDisabled} onclick={onDelete} />
    </span>
  </div>

  {#if expanded}
    <div class="body" id={bodyId} bind:this={bodyEl}>
      {#if isPublished}
        <p class="note" data-testid="published-type-note">Type can't be changed. To replace this question, create a new version.</p>
      {/if}
      <!-- D23: stacked, so the asset sidebar fits beside the pane. -->
      <div class="stack" data-field="text">
        <span class="row-label">Question</span>
        <MarkdownEditor ariaLabel="Question text" {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                        bind:value={draft.text_md} bind:uploading={upText} />
        {#if showErrors && textError}<p class="err" role="alert" data-testid="text-error">{textError}</p>{/if}
      </div>
      <div class="stack" data-field="explanation">
        <span class="row-label">Explanation</span>
        <MarkdownEditor ariaLabel="Explanation" {assetContext} plain={versionDisabled} readOnly={!editable} {frozen}
                        bind:value={draft.explanation_md} bind:uploading={upExpl} />
      </div>

      {#if question.type === 'numeric_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-num`}>Answer</label>
          <div class="field">
            <input id={`${uid}-num`} class="plain-input mono" data-testid="numeric-input" bind:value={draft.numericInput}
                   readonly={!editable || frozen} aria-required="true" aria-invalid={!numericCheck.ok}
                   aria-describedby={numericError ? `${uid}-num-err` : undefined} />
            {#if numericError}<p class="err" id={`${uid}-num-err`} role="alert">{numericError}</p>{/if}
          </div>
        </div>
        <div class="field-row">
          <label class="row-label" for={`${uid}-prec`}>Precision</label>
          <div class="field">
            <input id={`${uid}-prec`} class="plain-input mono" data-testid="precision-input" type="number" min="0" max="10"
                   readonly={!editable || frozen} aria-invalid={!precisionValid} bind:value={draft.precision}
                   aria-describedby={`${uid}-prec-hint`} />
            <small class="hint" id={`${uid}-prec-hint`}>Accepted within <span class="mono">{toleranceHint}</span></small>
            {#if !precisionValid}<p class="err" role="alert">Precision must be an integer <span class="mono">0–10</span>.</p>{/if}
          </div>
        </div>
      {:else if question.type === 'text_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-ans`}>Answer</label>
          <div class="field">
            <input id={`${uid}-ans`} class="plain-input" data-testid="text-answer-input" bind:value={draft.correct_text}
                   readonly={!editable || frozen} maxlength="500" aria-required="true" aria-invalid={!textAnswerValid}
                   aria-describedby={`${uid}-ans-hint`} />
            <small class="hint" id={`${uid}-ans-hint`}>Case-insensitive, trimmed match. <span class="mono">{draft.correct_text.length}/500</span></small>
            {#if !textAnswerValid}<p class="err" role="alert">Enter <span class="mono">1–500</span> characters.</p>{/if}
          </div>
        </div>
      {:else}
        <div class="opts-head">
          <span class="row-label opts-label">Options</span>
          {#if showErrors && markError}<p class="err" role="alert" data-testid="mark-error">{markError}</p>{/if}
          {#if perms.canEditStructure && optStatus === 'loaded'}
            <span class="opts-add">
              <IconButton primary size="sm" glyph={addingOption ? 'close' : 'plus'}
                          title={addingOption ? 'Cancel new option' : 'Add option'} aria-label="Add option"
                          aria-expanded={addingOption} disabled={optionsDisabled}
                          onclick={() => void toggleAddOption()} />
            </span>
          {/if}
        </div>
        {#if addingOption}
          <form class="add-form" novalidate onsubmit={(e) => { e.preventDefault(); void addOption(); }}>
            <input class="plain-input" data-testid="new-option-text" aria-label="New option" placeholder="Option text"
                   bind:value={newOptionText} maxlength="500" readonly={optionsDisabled} />
            <div class="add-actions">
              <Button type="submit" disabled={optionsDisabled || !newOptionValid}>Add</Button>
            </div>
          </form>
        {/if}
        {#if optStatus === 'loading'}
          <p class="muted">Loading options…</p>
        {:else if optStatus === 'error'}
          <p class="err" role="alert" data-testid="option-load-error">{optError}</p>
          <div><Button variant="ghost" onclick={() => void loadOptions()}>Retry</Button></div>
        {:else}
          {#if options.length === 0}
            <p class="muted">No options yet.</p>
          {:else}
            <fieldset class="option-group" data-testid="option-group">
              <legend class="sr-only">{question.type === 'single_choice'
                ? 'Answer options — select the correct option'
                : 'Answer options — select all correct options'}</legend>
              <ol class="options">
                {#each options as o, i (o.id)}
                  {@const d = optDrafts[o.id]}
                  {#if d}
                    <li>
                      <OptionRow
                        option={o} index={i + 1} count={options.length} questionType={question.type}
                        {perms} {frozen} optionsLocked={optionsDisabled} canDelete={canDeleteOption(o)}
                        mutating={optionsLocked}
                        correct={d.is_correct}
                        bind:draft={d.text}
                        onMark={(next) => mark(o.id, next)}
                        onDelete={() => void removeOption(o.id)}
                        onMoveUp={() => void moveOption(o.id, -1)}
                        onMoveDown={() => void moveOption(o.id, 1)}
                      />
                    </li>
                  {/if}
                {/each}
              </ol>
            </fieldset>
          {/if}
          {#if options.length < 2}<p class="muted" data-testid="few-options-warn">Add at least <span class="mono">2</span> options before publishing.</p>{/if}
          <p class="sr-only" aria-live="polite" data-testid="option-live">{optionAnnounce}</p>
          {#if optMutError}<p class="err" role="alert" data-testid="option-mut-error">{optMutError}</p>{/if}
        {/if}
      {/if}

      {#if saveNote}<p class="err" role="alert" data-testid="save-note">{saveNote}</p>{/if}
      {#if lastError}<p class="err" role="alert" data-testid="save-error">{lastError}</p>{/if}
    </div>
  {/if}
</div>

<style>
  /* 3f question card (ref 1890); #E9EBEF → --border (5a precedent). */
  .question { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
  .q-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface); /* ref 1891 */ }
  .question.expanded .q-head { background: var(--surface-2); border-bottom: 1px solid var(--border); /* ref 1891 */ }
  /* The whole badge + title is the toggle (D15: no chevron). */
  .q-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .q-badge { font-size: 11px; color: var(--primary); /* ref 1892 */ }
  .q-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; /* ref 1893 */ }
  .q-meta { font-size: 11.5px; color: var(--muted); /* R13, the ref 1894 type-name scale */ }
  .q-type { font-size: 11.5px; color: var(--muted); /* ref 1894 */ }
  .needs-fix { font-size: 11.5px; color: var(--danger); }
  .actions { display: flex; align-items: center; gap: 6px; /* ref 1895 */ }
  .body { padding: 12px; display: flex; flex-direction: column; gap: 10px; /* ref 1901 */ }
  /* D23: the label sits above a full-width editor (not the 132px grid). */
  .stack { display: flex; flex-direction: column; gap: 4px; /* the 4px label/field step */ min-width: 0; }
  .row-label { font-size: 12.5px; color: var(--muted); /* ref 1903 */ }
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; /* ref 1902 */ }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  /* D12: the 5a create-form input on the dense-control tokens. */
  .plain-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .plain-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft); /* D12 — InlineField's open editor */
  }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .hint { font-size: 12px; color: var(--muted); }
  .err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  .muted { margin: 0; font-size: 12.5px; color: var(--muted); }
  /* D6: the information-banner form (ItemEditorModal .ro-note). */
  .note { margin: 0; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--primary); font-size: 13px; color: var(--text); }
  .opts-head { display: flex; align-items: center; gap: 10px; /* ref 1907 */ }
  .opts-label { flex: 0 0 auto; width: 132px; /* ref 1908 */ }
  .opts-add { margin-left: auto; /* ref 1909 */ }
  .add-form { display: flex; flex-direction: column; gap: 8px; /* the 5a create-form gap */ }
  .add-actions { display: flex; justify-content: flex-end; }
  .option-group { border: 0; margin: 0; padding: 0; min-width: 0; }
  .options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; /* ref 1911 */ }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
```

- [ ] **Step 7: `QuizEditor.svelte` — script edits**

(a) Replace:
```ts
  import { unsavedSuffix } from '../../lib/editorReasons';
```
with:
```ts
  import { structureReason, unsavedSuffix } from '../../lib/editorReasons';
```
and replace:
```ts
  import Button from '../ui/Button.svelte';
```
with:
```ts
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
```

(b) Replace:
```ts
  const readOnlyAll = $derived(!perms.canEditTextFields && !perms.canEditStructure);  // archived/disabled (§9)
```
with:
```ts
  const readOnlyAll = $derived(!perms.canEditTextFields && !perms.canEditStructure);  // archived/disabled (§9)
  // D15: the version's reason titles every disabled question arrow and trash.
  const structReason = $derived(structureReason(version));
  const uid = $props.id();

  // The 5a collapsed-form toggle (+ ↔ ×): opening focuses the checked type;
  // closing drops what was typed.
  let addFormEl: HTMLFormElement | undefined = $state();
  async function toggleAdd() {
    if (questionsLocked || frozen || structureOff) return;
    if (adding) { adding = false; resetAddForm(); return; }
    adding = true;
    await tick();
    if (alive) addFormEl?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }
```

- [ ] **Step 8: `QuizEditor.svelte` — replace everything after `</script>`** with:

```svelte

<section class="quiz-editor" aria-label="Quiz editor">
  {#if readOnlyAll}<p class="note" data-testid="quiz-readonly">This version is read-only — editing is disabled.</p>{/if}

  <div class="questions-head">
    <span class="questions-label">Questions</span>
    {#if loadStatus === 'loaded'}<span class="mono q-count" data-testid="question-count">{questions.length}</span>{/if}
    {#if !structureOff}
      <span class="head-add">
        <IconButton primary size="sm" glyph={adding ? 'close' : 'plus'}
                    title={adding ? 'Cancel new question' : 'Add question'} aria-label="Add question"
                    aria-expanded={adding} disabled={questionsLocked || frozen || loadStatus !== 'loaded'}
                    onclick={() => void toggleAdd()} />
      </span>
    {/if}
  </div>

  {#if adding && !structureOff}
    <form class="add-form" novalidate bind:this={addFormEl} onsubmit={(e) => { e.preventDefault(); void submitAdd(); }}>
      <QuestionTypePicker bind:value={newType} disabled={questionsLocked || frozen} />
      <input class="plain-input" data-testid="new-question-text" aria-label="Question text" placeholder="Question text"
             bind:value={newText} readonly={questionsLocked || frozen} />
      {#if newType === 'numeric_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-num`}>Answer</label>
          <input id={`${uid}-num`} class="plain-input mono" data-testid="new-numeric" bind:value={newNumeric}
                 readonly={questionsLocked || frozen} aria-invalid={!newNumericCheck.ok} />
        </div>
        <div class="field-row">
          <label class="row-label" for={`${uid}-prec`}>Precision</label>
          <input id={`${uid}-prec`} class="plain-input mono" data-testid="new-precision" type="number" min="0" max="10"
                 bind:value={newPrecision} readonly={questionsLocked || frozen} aria-invalid={!newPrecisionValid} />
        </div>
        {#if newNumericError}<p class="err" role="alert">{newNumericError}</p>{/if}
        {#if !newPrecisionValid}<p class="err" role="alert">Precision must be an integer <span class="mono">0–10</span>.</p>{/if}
      {:else if newType === 'text_answer'}
        <div class="field-row">
          <label class="row-label" for={`${uid}-ans`}>Answer</label>
          <input id={`${uid}-ans`} class="plain-input" data-testid="new-text-answer" bind:value={newAnswer}
                 maxlength="500" readonly={questionsLocked || frozen} />
        </div>
      {:else}
        <p class="muted">Add the answer options after creating the question.</p>
      {/if}
      {#if addError}<p class="err" role="alert">{addError}</p>{/if}
      <div class="add-actions">
        <Button type="submit" disabled={questionsLocked || frozen || !addValid}>Add</Button>
      </div>
    </form>
  {/if}

  {#if loadStatus === 'loading'}
    <p class="muted">Loading questions…</p>
  {:else if loadStatus === 'error'}
    <p class="err" role="alert">{loadError}</p>
    <div><Button variant="ghost" onclick={() => void load()}>Retry</Button></div>
  {:else if questions.length === 0}
    <p class="muted">No questions yet.</p>
  {:else}
    <p class="sr-only" aria-live="polite" data-testid="question-live">{questionAnnounce}</p>
    <ol class="questions">
      {#each questions as q, i (q.id)}
        <li data-q-id={q.id}>
          <QuestionAccordion
            question={q}
            {vid}
            index={i + 1}
            count={questions.length}
            {perms}
            {assetContext}
            {versionDisabled}
            {frozen}
            {structReason}
            locked={questionsLocked}
            expanded={expandedId === q.id}
            onExpandToggle={() => toggleExpand(q.id)}
            onDelete={() => void removeQuestion(q.id)}
            onMoveUp={() => void move(q.id, -1)}
            onMoveDown={() => void move(q.id, 1)}
          />
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: 12px; /* the 3f card gap (ref 1890) */ }
  .questions-head { display: flex; align-items: center; gap: 10px; padding-top: 2px; /* ref 1885 */ }
  .questions-label { font-size: 12.5px; font-weight: 600; color: var(--text); /* ref 1886 */ }
  .q-count { font-size: 11.5px; color: var(--muted); /* ref 1887 */ }
  .head-add { margin-left: auto; /* ref 1888 */ }
  .questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; /* ref 1890 */ }
  .add-form { display: flex; flex-direction: column; gap: 8px; /* the 5a create-form gap */ }
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; /* ref 1902 */ }
  .row-label { font-size: 12.5px; color: var(--muted); /* ref 1903 */ }
  /* D12: the 5a create-form input on the dense-control tokens. */
  .plain-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .plain-input:focus-visible {
    outline: none;
    border: 1.5px solid var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft); /* D12 — InlineField's open editor */
  }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .add-actions { display: flex; justify-content: flex-end; }
  /* The information-banner form (ItemEditorModal .ro-note). */
  .note { margin: 0; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--primary); font-size: 13px; color: var(--text); }
  .muted { margin: 0; font-size: 12.5px; color: var(--muted); }
  .err { margin: 0; font-size: 12px; color: var(--danger); /* D12 */ }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/QuestionAccordion.svelte.test.ts src/tests/OptionRow.svelte.test.ts src/tests/QuizEditor.svelte.test.ts src/tests/QuestionTypePicker.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts`

Expected: PASS. That is QuestionAccordion 67, OptionRow 14, QuizEditor 34 and QuestionTypePicker 2; the ItemEditorModal count is unchanged.

If a T5a or T5b test leaned on the removed Cancel buttons or the "Type: … (fixed)" line, it fails here. Fix the **test**: replace a Cancel click with a click on the `+` / `×` toggle (`button[aria-label="Add question"]` / `"Add option"`), and ledger the edit. The plan's tests have no such use (checked by grep), so a failure here means a real regression.

- [ ] **Step 10: Gate — section (ae)**

First build, then read the emitted rules and confirm those spellings match the pins below:
`npm run build >/dev/null && grep -oE '\.(questions-head|q-toggle|q-head|correct-badge|opt-input|qtype-picker|option)[.a-z-]*\.svelte-[a-z0-9]+[^{]*\{[^}]*\}' dist/_app/*.css`

Then insert after section (ad):

```zsh
echo
echo "--- (ae) Slice-5b T6 — quiz look (3f): QuizEditor, QuestionAccordion, OptionRow, QuestionTypePicker ---"
own questions-head QuizEditor.svelte
uniq1 questions-head
if [[ -n $REPLY ]]; then
  N=QuizEditor; H=$REPLY
  d '\.quiz-editor' '' 'display:flex' 'flex-direction:column' 'gap:12px'
  d '\.questions-head' '' 'display:flex' 'align-items:center' 'gap:10px'
  d '\.questions-label' '' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.q-count' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.head-add' '' 'margin-left:auto'
  d '\.questions' '' 'display:flex' 'flex-direction:column' 'gap:12px'
  d '\.add-form' '' 'display:flex' 'flex-direction:column' 'gap:8px'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  none "QuizEditor input padding is the token, not the 5a literal" "\.plain-input\.${H}\{[^}]*padding:0 10px"
  none "QuizEditor no em/rem font sizes" "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep QuizEditor $H
fi

own q-toggle QuestionAccordion.svelte
uniq1 q-toggle
if [[ -n $REPLY ]]; then
  N=QuestionAccordion; H=$REPLY
  d '\.question' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden'
  d '\.q-head' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:8px 12px' 'background:var\(--surface\)'
  chk "\.question\.expanded\.${H} \.q-head:where\(\.${H}\)" 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.q-toggle' '' 'display:flex' 'flex:1' 'min-width:0' 'border:0' 'background:transparent' 'text-align:left' 'cursor:pointer'
  d '\.q-badge' '' 'font-size:11px' 'color:var\(--primary\)'
  d '\.q-title' '' 'font-size:13px' 'font-weight:600' 'color:var\(--text\)'
  d '\.q-type' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.actions' '' 'display:flex' 'align-items:center' 'gap:6px'
  d '\.body' '' 'padding:12px' 'display:flex' 'flex-direction:column' 'gap:10px'
  d '\.stack' '' 'display:flex' 'flex-direction:column' 'gap:4px'
  d '\.row-label' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:center' 'gap:12px'
  d '\.opts-head' '' 'display:flex' 'align-items:center' 'gap:10px'
  d '\.opts-label' '' 'width:132px'
  d '\.opts-add' '' 'margin-left:auto'
  d '\.options' '' 'display:flex' 'flex-direction:column' 'gap:6px'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\[aria-invalid=\"?true\"?\]\.${H}" 'border:1\.5px solid var\(--danger\)'
  none "QuestionAccordion closed header carries no rule (ref 1891: only the open one)" "\.q-head\.${H}\{[^}]*border-bottom"
  none "QuestionAccordion Question/Explanation rows are stacked, not the 132px grid (D23)" "\.stack\.${H}\{[^}]*grid-template-columns"
  none "QuestionAccordion no em/rem font sizes" "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep QuestionAccordion $H
fi

own correct-badge OptionRow.svelte
uniq1 correct-badge
if [[ -n $REPLY ]]; then
  N=OptionRow; H=$REPLY
  d '\.option' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:4px 9px' 'border:1px solid var\(--border\)' 'background:var\(--surface\)' 'border-radius:var\(--radius\)'
  d '\.option\.correct' '' 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
  d '\.mark' '' 'width:15px' 'height:15px' 'margin:0' 'accent-color:var\(--primary\)'
  d '\.opt-input' '' 'flex:1' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid transparent' 'background:transparent' 'color:var\(--text\)' 'font-size:var\(--control-font\)' 'caret-color:var\(--primary\)'
  chk "\.opt-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)' 'background:var\(--surface\)'
  d '\.correct-badge' '' 'padding:2px 7px' 'border-radius:3px' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)' 'font-size:11px' 'font-weight:500'
  d '\.actions' '' 'display:flex' 'align-items:center' 'gap:6px'
  none "OptionRow plain row is not drawn with the correct border" "\.option\.${H}\{[^}]*border:1px solid var\(--primary\)"
  none "OptionRow no --success / --text-muted leftovers" "\.${H}[^{]*\{[^}]*var\(--(success|text-muted)"
  none "OptionRow no em/rem font sizes" "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep OptionRow $H
fi

own qtype-picker QuestionTypePicker.svelte
uniq1 qtype-picker
if [[ -n $REPLY ]]; then
  N=QuestionTypePicker; H=$REPLY
  d '\.qtype-picker' '' 'border:0' 'padding:0' 'margin:0' 'min-width:0'
  d '\.cards' '' 'display:flex' 'flex-wrap:wrap' 'gap:8px'
  chk "label\.${H}" 'display:flex' 'padding:6px 10px' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:13px'
  chk "label\.selected\.${H}" 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
  none "QuestionTypePicker no --accent / --accent-bg fallbacks" "\.${H}[^{]*\{[^}]*var\(--accent"
  sweep QuestionTypePicker $H
fi
emoji_scan "quiz editor files" src/components/editor/QuizEditor.svelte src/components/editor/QuestionAccordion.svelte src/components/editor/OptionRow.svelte src/components/editor/QuestionTypePicker.svelte
```

Run the gate. The only FAIL is the count; set `EXPECTED_CHECKS` to the printed N and re-run.
Expected: `VISUAL-REFRESH GATE: ALL PASS (N checks)`.

**Mutation-test** (Constraint 12). For each, mutate, re-run, check that the named check goes red, then revert:
- OptionRow `.option.correct` background `--primary-soft` → `--surface-2`: the pin FAILs;
- QuestionAccordion `.body` `gap: 10px` → `8px`: the pin FAILs;
- QuestionAccordion `.stack`: add `display: grid; grid-template-columns: 132px 1fr`: the D23 negative FAILs;
- QuestionAccordion `.q-head`: add `border-bottom: 1px solid var(--border)`: the closed-header negative FAILs;
- QuestionTypePicker `label.selected` → `border-color: var(--accent, #46c)`: the pin, the `--accent` negative **and** the sweep FAIL;
- QuizEditor: put `＋ ` back in front of the toggle's title string: the emoji scan FAILs.

- [ ] **Step 11: Full verification**

Run: `npm test 2>&1 | tail -4`, `npm run check 2>&1 | tail -1`, `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.

Expected:
- tests: 135 files, 1712 tests (1699 + 7 + 2 + 3 + 1), all pass;
- check: 0 errors, warnings ≤ 18;
- gate: `ALL PASS`.

Then `grep -nE "＋|🗑|↑|↓|▾|▸|◉|☑|✎" src/components/editor/{QuizEditor,QuestionAccordion,OptionRow,QuestionTypePicker}.svelte`. Expected: only comment lines (the gate's emoji scan already strips comments, so this is a reading aid).

- [ ] **Step 12: Review** (both lanes on the uncommitted diff; spec §5.5, D15, D16, D23, Constraints 3/4/11). Then wait for the user's OK.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/components/editor/QuizEditor.svelte frontend/src/components/editor/QuestionAccordion.svelte frontend/src/components/editor/OptionRow.svelte frontend/src/components/editor/QuestionTypePicker.svelte frontend/scripts/visual-refresh-gate.sh frontend/src/tests/QuestionAccordion.svelte.test.ts frontend/src/tests/OptionRow.svelte.test.ts frontend/src/tests/QuizEditor.svelte.test.ts frontend/src/tests/QuestionTypePicker.svelte.test.ts
git commit -m "$(cat <<'MSG'
feat(editor): Slice 5b T6 — quiz look (3f)

The Questions heading row with a + toggle, 3f question cards (a Q-badge
toggle, lowercase mono type names, icon arrows with D15 reasons), stacked
Question/Explanation editors (D23), Answer/Precision grid rows, the
Options heading row and 3f option rows (D16 arrows, the correct pill).
QuestionTypePicker takes 5a's card look. No emoji left in the quiz files.
Gate (ae).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 7: Clean-up, backlog closure, gate (af) + (ag), final count

**What this task does.** It closes the slice. It ends with no stale references to the deleted pages, the two 5a carry-overs marked closed, and two gate sections that span every 5b file:
- **(af)** an emoji scan over every 5b source file, including the ones no styling section covered: `VersionEditPage`, `ItemRow`, `quizSave`, the router files and the store;
- **(ag)** the Constraint 11 literal-colour scan over every 5b-touched CSS context, with the exemptions from the spec.

No product behaviour changes, and no tests are added.

**Files:**
- Modify:
  - `frontend/src/pages/MiniProjectDetailPage.svelte` (one comment)
  - `frontend/src/tests/AssetSidebar.svelte.test.ts` (one comment)
  - `frontend/src/tests/dirtyRegistry.test.ts` (one comment)
  - `frontend/src/lib/quizSave.ts` (one comment)
  - `frontend/scripts/visual-refresh-gate.sh`
  - `docs/backlog/slice5a-authoring-polish-debt.md`

**Interfaces:**
- Consumes: the gate helpers `emoji_scan` (T2) and `fail`, and the full 5b file list from the File structure table.
- Produces: the final `EXPECTED_CHECKS`.

- [ ] **Step 1: Rewrite the stale comments**

`frontend/src/pages/MiniProjectDetailPage.svelte` — replace:
```ts
  // assignment_html dep without using the value (M7 idiom — precedent at
  // ItemEditPage.svelte:238). assignmentEl is bound on the SAME div as
```
with:
```ts
  // assignment_html dep without using the value (the M7 idiom). assignmentEl
  // is bound on the SAME div as
```

`frontend/src/tests/AssetSidebar.svelte.test.ts` — replace:
```ts
    // Codex T5a finding: ItemEditPage derives `editAssetContext` from `vid`.
```
with:
```ts
    // Codex T5a finding: the item editor derives its asset context from `vid`.
```

`frontend/src/tests/dirtyRegistry.test.ts` — replace:
```ts
    const legacy = fakeTracker(true);                       // no discard (e.g. ItemEditPage trackers)
```
with:
```ts
    const legacy = fakeTracker(true);                       // no discard (the legacy tracker shape)
```

`frontend/src/lib/quizSave.ts` — replace:
```ts
// forms (T5b): they make closing the modal prompt (guardDirty), but the footer
```
with:
```ts
// forms (§5.4): they make closing the modal prompt (guardDirty), but the footer
```

- [ ] **Step 2: Sweep for leftovers**

Run:
```bash
grep -rnE "ItemEditPage|InteractiveAppEditor" frontend/src frontend/scripts
grep -rnE "until T5|until T6|T5b removes|interim" frontend/src --include='*.svelte' --include='*.ts'
```
Expected:
- **The first grep** returns only past-tense history comments that name Slice 5b, for example:
  - the D22 store-contract comment (T3b);
  - the T4 `.notice` comments in the gate and in `InteractiveAppItem.svelte.test.ts`;
  - the Back-freeze stage notes in `App.editorRoutes.svelte.test.ts`.
  
  It returns no import, route, selector or present-tense claim. Rewrite any other hit the same way as Step 1, and ledger it.
- **The second grep** returns nothing.

- [ ] **Step 3: Close the two 5a carry-overs**

In `docs/backlog/slice5a-authoring-polish-debt.md`, append to the end of the first carry-over bullet (the one ending `**Regression test:** open an item → close or Back → create another item without reloading.`):
```markdown
  **Closed in Slice 5b (T3b).** Items open as a modal over the still-mounted `VersionEditPage`, `ItemEditPage`
  is deleted, and only `VersionEditPage` loads and clears the tree (D22, documented in
  `currentEditorVersion.svelte.ts`). Regression test: `frontend/src/tests/App.editorRoutes.svelte.test.ts`
  (two stages, mutation-proved).
```
and append to the end of the second carry-over bullet (the one ending `…or to show the reason in the modal instead.`):
```markdown
  **Closed in Slice 5b (D6; T2 `plain`, T3a, T4).** A disabled version's item shows its plain source plus the note
  "Preview is unavailable while this version is disabled — enable it to preview or edit.", and makes no `/render`
  or asset request (pinned in `ItemEditorModal.svelte.test.ts` for page, video, quiz and app). The endpoint is unchanged.
```

- [ ] **Step 4: Gate — sections (af) and (ag)**

Insert after section (ae):

```zsh
echo
echo "--- (af) Slice-5b T7 — emoji scan over every Slice-5b source file (Constraint 3) ---"
# Every 5b-touched component with CSS, in one list (reused by (ag)).
FILES_5B=(
  src/components/ui/Modal.svelte
  src/components/editor/MarkdownEditor.svelte src/components/editor/AssetSidebar.svelte
  src/components/editor/ItemEditorModal.svelte src/components/editor/item/PageBody.svelte
  src/components/editor/item/VideoBody.svelte src/components/editor/item/AppBody.svelte
  src/components/items/VideoFrame.svelte src/components/items/InteractiveFrame.svelte
  src/pages/editor/VersionEditPage.svelte src/components/editor/ItemRow.svelte
  src/components/editor/QuizEditor.svelte src/components/editor/QuestionAccordion.svelte
  src/components/editor/OptionRow.svelte src/components/editor/QuestionTypePicker.svelte
  src/pages/MiniProjectDetailPage.svelte src/App.svelte
)
emoji_scan "all Slice-5b source files" $FILES_5B src/lib/itemBody.ts src/lib/quizSave.ts \
  src/lib/deriveExpansion.ts src/lib/handleStaleIdFallback.ts src/routes.ts src/stores/currentEditorVersion.svelte.ts

echo
echo "--- (ag) Slice-5b T7 — no literal colour in a 5b-touched CSS context (Constraint 11) ---"
python3 - $FILES_5B <<'AG'
import re, sys
# Constraint 11 (spec §Global Constraints): no literal colour in a CSS context
# of a 5b-touched file. CSS contexts = <style> blocks and inline style="…".
NAMED = set('''aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink
indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
whitesmoke yellow yellowgreen'''.split())
LIT = re.compile(r'#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|(?<![\w-])(?:rgba?|hsla?)\(')
# The two Modal literals the spec allows (Constraint 11), compared whitespace-free.
ALLOWED = {'Modal.svelte': {'box-shadow:0 16px 44px rgba(20,24,35,.22)'.replace(' ', '')}}

def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    s = re.sub(r'<!--.*?-->', ' ', s, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$', ' ', s)   # only a line that STARTS with // (never https://)

def drop_forced_colors(css):
    while True:
        m = re.search(r'@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{', css)
        if not m:
            return css
        i, depth = m.end(), 1
        while i < len(css) and depth:
            depth += {'{': 1, '}': -1}.get(css[i], 0)
            i += 1
        css = css[:m.start()] + css[i:]

def bodies(src):
    out = []
    for m in re.finditer(r'<style[^>]*>(.*?)</style>', src, re.S):
        out += re.findall(r'\{([^{}]*)\}', drop_forced_colors(strip_comments(m.group(1))))
    out += [m.group(1) for m in re.finditer(r'\sstyle="([^"]*)"', src)]
    out += [m.group(1) for m in re.finditer(r"\sstyle='([^']*)'", src)]
    return out

def hits(path):
    name = path.rsplit('/', 1)[-1]
    found = []
    for body in bodies(open(path).read()):
        for decl in body.split(';'):
            if ':' not in decl:
                continue
            prop, val = (x.strip() for x in decl.split(':', 1))
            flat = (prop + ':' + val).replace(' ', '').replace('\n', '')
            if flat in ALLOWED.get(name, set()):
                continue
            # A named colour counts only as a whole value token, never inside var(--…).
            words = re.findall(r'(?<![\w-])[a-zA-Z]+(?![\w-])', re.sub(r'var\(\s*--[\w-]+', ' ', val))
            if LIT.search(val) or any(w.lower() in NAMED for w in words):
                found.append('%s: %s' % (prop, val))
    return found

bad = 0
for p in sys.argv[1:]:
    h = hits(p)
    if h:
        bad = 1
        print('FAIL  %s holds a literal colour in a CSS context: %s' % (p.rsplit('/', 1)[-1], '; '.join(h[:3])))
if not bad:
    print('PASS  no literal colour in any CSS context of the %d 5b-touched files (Constraint 11)' % (len(sys.argv) - 1))
sys.exit(bad)
AG
[[ $? -eq 0 ]] || fail=1
```

**What (ag) checks** (spec Constraint 11):
- **Scope.** CSS contexts only: every `<style>` block and every inline `style="…"` / `style='…'`. It never scans `.ts` or test files.
- **Stripped first:** comments (`/* */`, `<!-- -->`, and `//` only when it starts a line), then every `@media (forced-colors: active)` block (the system-colour exemption). Only declaration bodies are read, so a selector (`:has(…)`, `:not(.red)`) is never a hit.
- **A hit is any of:**
  - a hex value;
  - `rgb(` / `rgba(` / `hsl(` / `hsla(`;
  - a CSS named colour as a whole value token (`white-space` and `var(--gold-text)` are not hits);
  - a `var()` fallback that is one of the above.
- **Not hits:** `transparent`, `currentColor` and `inherit` (not in the list).
- **The one allowance:** `Modal.svelte`'s `box-shadow: 0 16px 44px rgba(20,24,35,.22)`. The backdrop's `color-mix(in srgb, var(--text) 34%, transparent)` holds no literal.

Run the gate. The only FAIL is the count; set `EXPECTED_CHECKS` to the printed N and re-run.
Expected: `VISUAL-REFRESH GATE: ALL PASS (N checks)`. N is the T6 count + 2.

**Mutation-test** (Constraint 12). For each, mutate, re-run, check that the named check goes red, then revert:
- `OptionRow.svelte` `.actions`: add `color: red;` → (ag) FAILs (named colour);
- `QuizEditor.svelte` `.muted`: `var(--muted)` → `var(--muted, #666)` → (ag) **and** the (ae) sweep FAIL;
- `ItemEditorModal.svelte`: add `style="color: white"` to the footer `<span class="dirty">` → (ag) FAILs (inline style);
- `Modal.svelte` panel shadow: `rgba(20,24,35,.22)` → `rgba(0,0,0,.3)` → (ag) FAILs (only the exact allowance passes);
- `QuestionAccordion.svelte` `.err`: add `/* was #c00 */` → (ag) still PASSes (comments are exempt);
- `ItemRow.svelte`: put `→` into the Open title text → (af) FAILs.

- [ ] **Step 5: Full verification**

Run: `npm test 2>&1 | tail -4`, `npm run check 2>&1 | tail -1`, `TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh | tail -1`.

Expected:
- tests: 135 files, 1712 tests (unchanged from T6), all pass;
- check: 0 errors, warnings ≤ 18 (not above the slice's 18 baseline);
- gate: `ALL PASS`.

- [ ] **Step 6: Review** (both lanes on the uncommitted diff; Constraint 11 exemptions and the (ag) parser are the focus). Then wait for the user's OK.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/MiniProjectDetailPage.svelte frontend/src/tests/AssetSidebar.svelte.test.ts frontend/src/tests/dirtyRegistry.test.ts frontend/src/lib/quizSave.ts frontend/scripts/visual-refresh-gate.sh docs/backlog/slice5a-authoring-polish-debt.md
git commit -m "$(cat <<'MSG'
chore(editor): Slice 5b T7 — clean-up, carry-overs closed, gate (af)/(ag)

Stale ItemEditPage references rewritten; the two 5a browser-pass
carry-overs (Back freeze, disabled-version 403) marked closed. Gate (af)
scans every 5b source file for emoji; (ag) enforces Constraint 11 (no
literal colour in a 5b-touched CSS context, with its exemptions).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 8: Slice close-out.** Run the whole-branch review: the Opus reviewer plus the second lane, with the Review Focus list given verbatim. Then do the browser pass with the user in Safari, step by step, over every item type and the version states. Both happen before any merge decision; the branch stays local.

---
