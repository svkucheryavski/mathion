# Asset Panel Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor's asset panel shows the 6 newest assets, filters the full list from a search
field while typing, and scrolls inside a bounded height, so the text area and the list scroll
independently.

**Architecture:** Pure list logic (sort, match, cap) goes in a new `frontend/src/lib/assetList.ts`;
`AssetSidebar.svelte` keeps the full list from the server and renders a derived slice. CSS caps the
list height; the text area already matches the panel's height through the flex row.

**Tech Stack:** Svelte 5, TypeScript, Vitest (mount/unmount/flushSync, not testing-library).

**Spec:** `docs/superpowers/specs/2026-11-27-asset-panel-search-design.md`

## Global Constraints

- Frontend only; no server change; no new dependencies; Svelte 5 runes.
- Copy, exact: placeholder and accessible name `Find an asset`; `N more, type to find them`;
  `No assets match`.
- Cap: 6 rows (owner, 2026-11-27; was 8) when the search is empty. Matching: name contains the trimmed text, case-insensitive.
- Order: `uploaded_at` newest first; equal or unreadable times → higher `id` first.
- Code comments: one short plain line.
- Tests: `cd frontend && npm test -- <file>`; types: `cd frontend && npm run check`. Never two test
  processes at once.

## Review Focus

1. Delete focus repair after the list is sliced: a deleted last shown row with more assets behind it must
   land on the trash now at that position, never on `<body>` (test in Task 2).
2. A reload after a save (refreshKey bump, no new asset) must keep the typed search (Task 2).
3. Escape with an empty field must still close the modal (not default-prevented) (Task 2).
4. Run-asset lists whose JSON lacks `uploaded_at` (old fixtures) must not throw or misorder (Task 1).
5. An open idle delete question on a row the search hides must close, not linger off screen (Task 2).

---

### Task 1: List logic

**Files:**
- Create: `frontend/src/lib/assetList.ts`
- Modify: `frontend/src/lib/assetContext.ts` (`AssetItem` gains `uploaded_at: string`)
- Test: `frontend/src/tests/assetList.test.ts`

**Interfaces:**
- Produces:
  - `export const ASSET_CAP = 6;`
  - `export function newestFirst<T extends Pick<AssetItem, 'id' | 'uploaded_at'>>(list: T[]): T[]` — new array.
  - `export function shownAssets<T extends Pick<AssetItem, 'id' | 'uploaded_at' | 'filename'>>(list: T[], query: string, cap = ASSET_CAP): { rows: T[]; more: number }`
    — empty trimmed query: first `cap` of `newestFirst`, `more = total - cap` (min 0); otherwise every
    match, newest first, `more = 0`.

- [ ] **Step 1: Write the failing tests** in `assetList.test.ts`:
  - `newestFirst` orders `2026-05-03` > `2026-05-02` > `2026-05-01`; equal times → `id` 7 before 3;
    `uploaded_at` missing or `'junk'` sorts as oldest, ties by id; input array not mutated.
  - `shownAssets(10 assets, '')` → 6 rows (the 6 newest), `more: 4`; 5 assets → 5 rows, `more: 0`.
  - `shownAssets(list, '  HIST ')` matches `histogram.png` and `Hist2.pdf`, not `bar.png`; 12 matches
    → all 12 rows, `more: 0`; no match → `rows: []`, `more: 0`.
- [ ] **Step 2: Run** `cd frontend && npm test -- src/tests/assetList.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `assetList.ts`; parse times with `Date.parse`, `NaN` → `-Infinity`.
  Add `uploaded_at: string` to `AssetItem`; fix the typed `AssetItem` literals in
  `src/tests/assetContext.test.ts` (two) to carry it.
- [ ] **Step 4: Run** the test file, then `npm run check`. Expected: PASS; check reports 0 errors.
- [ ] **Step 5: Commit** (after the review loop and the owner's OK):
  `git add frontend/src/lib/assetList.ts frontend/src/lib/assetContext.ts frontend/src/tests/assetList.test.ts frontend/src/tests/assetContext.test.ts frontend/src/tests/AssetSidebar.run-mode.svelte.test.ts`
  `git commit -m "feat(editor): asset list order, match and cap helpers"`

### Task 2: Panel search, slice and scrolling

**Files:**
- Modify: `frontend/src/components/editor/AssetSidebar.svelte`
- Test: `frontend/src/tests/AssetSidebar.svelte.test.ts` (new `describe('AssetSidebar — search')`)

**Interfaces:**
- Consumes: `shownAssets`, `ASSET_CAP` from Task 1.
- Produces: `data-testid="asset-search"` (the input), `data-testid="asset-more"`,
  `data-testid="asset-no-match"`.

- [ ] **Step 1: Write the failing tests.** Fixture: 10 assets, ids 1–10, `uploaded_at` rising with id
  (`2026-05-01T00:00:0${n}Z`-style, distinct), names `pic-1.png`…`pic-10.png`, plus where needed
  `Histogram.png`. Tests:
  - `search field has placeholder and aria-label "Find an asset" and no <label>`.
  - `empty search shows the 6 newest and "4 more, type to find them"` — rows 10…5 in that DOM order;
    `asset-more` text exact.
  - `typing filters all assets, case-insensitive` — set input value `PIC-1`, dispatch `input`,
    flushSync → rows `pic-10.png`, `pic-1.png` only; no `asset-more`.
  - `no match shows "No assets match"`.
  - `Escape in a non-empty search clears it and is default-prevented`; `Escape in an empty search is
    not default-prevented`.
  - `a reload bringing a new asset clears the search` (list mock returns an extra id 11, bump
    `refreshKey` via a mount with a `$state` prop or re-mount pattern used elsewhere in the file);
    `a reload without a new asset keeps the search`.
  - `an idle delete question on a row the search hides closes` — open the trash on `pic-5.png`, type
    `pic-1`, assert no `.inline-confirm`.
  - `deleting the last shown row moves focus to the trash now at that position` — 10 assets, delete
    row id 5 (6th shown); list mock then returns ids 1…4,6…10; focus lands on id 4's trash.
  - Update existing tests whose expected row order assumed server order: give their fixtures
    distinct `uploaded_at`, or assert by testid instead of position.
- [ ] **Step 2: Run** `cd frontend && npm test -- src/tests/AssetSidebar.svelte.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `AssetSidebar.svelte`:
  - `let query = $state('')`; `const shown = $derived(shownAssets(assets, query))`; the `{#each}` runs
    over `shown.rows`; `asset-more` (muted) when `shown.more > 0 && !query.trim()`; `asset-no-match`
    (muted, `role="status"`) when the query is non-empty and no row matches. The empty-course line
    (`No assets yet…`) stays keyed on `assets.length === 0`.
  - Input after `<h3>`, before the cursor hint: `type="text"`, `placeholder` and `aria-label`
    `Find an asset`, `autocomplete="off"`, `spellcheck="false"`, not disabled by `disabled`. Keydown:
    Escape (not composing, `keyCode !== 229`) with non-empty value → `preventDefault()`, `query = ''`.
  - Clear rule: keep `let seenIds: Set<number> | null = null` (plain `let`); in `fetchAssets` success,
    if `seenIds` and the list has an id not in it → `query = ''`; then `seenIds = new Set(ids)`. Reset
    to `null` on a context swap.
  - Use `shown.rows` instead of `assets` for indexes in `refocusAfterDelete` and `idleQuestionGone`.
  - `$effect`: an idle `confirmId` not in `shown.rows` closes, with the same inside-focus repair as the
    disabled effect.
  - CSS: `.list { max-height: 312px; overflow-y: auto; }` (6.5 rows of about 47.5px, measured in Chrome) and a `.rows.full { min-height: 312px }` wrapper when there are more assets than the cap; search input styled at sidebar size (12px text, compact padding,
    the global field look).
- [ ] **Step 4: Run** the sidebar test file, `src/tests/AssetSidebar.run-mode.svelte.test.ts`,
  `src/tests/MarkdownEditor.svelte.test.ts`, then the whole `npm test` and `npm run check`.
  Expected: all PASS, 0 errors, no "Unhandled" line.
- [ ] **Step 5: Browser check** (agent-browser, dev server, a course with 12+ assets): the panel
  shows 6 rows and the `more` line; the list scrolls inside the panel with a search matching 12;
  the text area scrolls on its own; the modal is no taller than with 6 assets; below 880px the list
  keeps its cap. Screenshots compared Chrome vs the spec, then Safari-only checks to the owner.
- [ ] **Step 6: Commit** (after the review loop and the owner's OK):
  `git add frontend/src/components/editor/AssetSidebar.svelte frontend/src/tests/AssetSidebar.svelte.test.ts`
  `git commit -m "feat(editor): asset panel search, newest 6 and its own scrolling"`
