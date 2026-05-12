# Editor Accordion Redesign — Design

## Goal

Collapse the current 4-page editor navigation (Versions → Version → Block → Sequence → Item) into a single Version Edit page that surfaces the entire course structure inline as a 2-level accordion. Blocks expand to show their sequences; sequences expand to show their items. Item editing remains on its own page (existing `ItemEditPage`) since rich content editing benefits from a dedicated surface.

The motivation is direct: today an admin pays two full page loads to reach a sequence's items. With the accordion, structural review and most CRUD lives in one place — only the leaf (item content) is a navigation step.

## Scope

This is **slice 2** of the admin editor work, on its own branch (`frontend-admin-editor-accordion`) off the just-shipped slice 1 (`frontend-admin-editor`). All slice-1 hardening (race-safety, dirty-tracker, formErrors helper, Toast info styling, video preview, URL normalization) carries through unchanged. Backend is out of scope — the existing `/api/versions/{vid}/admin-tree` endpoint already returns the full tree shape this redesign needs.

## Resolved decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **2-level accordion in `VersionEditPage`** (Approach A). | Direct fit for the "1 page, items navigate" shape requested. Master-detail (B) is more layout-heavy for limited gain. Read-only overview (C) doesn't address the core complaint. |
| 2 | **Auto-collapse on switch with dirty prompt — covering ALL dirty forms.** When any form on the page is dirty (version meta, expanded block meta, expanded sequence meta, or any inline create form), expanding a different block / sequence or any other URL change triggers a single `confirm("Discard unsaved changes and continue?")`. Cancel keeps the current state. Confirm discards all dirty forms and proceeds. | Mirrors today's per-page DirtyGuard semantics but extended to the multi-form accordion. Save-as-you-go loses the safety net; multiple-pending-with-global-Save is harder to communicate. |
| 3 | **Deep-link URLs auto-expand the accordion.** `/edit/v/3/blocks/12/sequences/47` lands on `/edit/v/3` with block 12 and sequence 47 expanded; the page also scrolls the sequence header into view. | Preserves shareability ("look at this sequence") for collaborating admins. The route handler reads `bid`/`sid` route params and seeds the accordion's expansion state on mount. |
| 4 | **Default all collapsed.** Fresh navigation to `/edit/v/3` shows version meta + a list of collapsed block headers. | Cleanest first impression on a large course. Combined with deep-link auto-expand, no usability cost — admins land on the structure they need. |
| 5 | **Single-active-edit at each accordion level.** At most one block is expanded for editing, and within an expanded block at most one sequence is expanded for editing. Expanding another collapses the current one (subject to decision 2's dirty prompt). | Keeps DOM weight bounded and edit context clear. Users can still see all collapsed siblings for orientation. |

## Architecture overview

```
VersionEditPage (rewritten)
├── Version meta form (title, info, max_quiz_attempts) — same as today
├── State actions (publish/revert/disable/enable/delete) — same as today
└── Blocks accordion (replaces today's flat block list)
    ├── BlockAccordion (one per block in tree.blocks)
    │   ├── Header: title, slug, ↑/↓, expand toggle
    │   └── Body (when expanded):
    │       ├── Block meta form (title, info)
    │       ├── Save / Discard
    │       ├── Sequences accordion
    │       │   ├── SequenceAccordion (one per block.sequences)
    │       │   │   ├── Header: title, slug, ↑/↓, expand toggle
    │       │   │   └── Body (when expanded):
    │       │   │       ├── Sequence meta form (title)
    │       │   │       ├── Save / Discard
    │       │   │       ├── Items list (reorder, delete, click → ItemEditPage)
    │       │   │       └── + New item form (existing 2-step picker)
    │       │   └── ...
    │       ├── + New sequence form
    │       └── Delete this block
    └── ...
└── + New block form (collapsible)
```

`ItemEditPage` is unchanged from slice 1 — it's still its own route, still uses the existing `currentEditorVersion` store, still has its own DirtyGuard + breadcrumb back to the version page (which now lands the user back in the accordion with the right block + sequence still expanded — see "Return navigation" below).

## Components

| Component | Responsibility |
|---|---|
| `pages/editor/VersionEditPage.svelte` | Top-level page. Holds version meta form, state actions, and the blocks accordion. Expansion is derived directly from route params (`routeBid` / `routeSid`) — **no internal expansion state**. Holds the page-wide dirty registry that every form registers into (so DirtyGuard can ask "is anything dirty?"). |
| `components/editor/BlockAccordion.svelte` (NEW) | One block. Renders header (title, slug, reorder, expand toggle). Header `onclick` calls `navigate(...)` directly — no `requestExpand` event, no parent intercept. Body holds block meta form + sequences accordion; the block-meta form owns its own dirty tracker and registers it in the page-wide registry via context. |
| `components/editor/SequenceAccordion.svelte` (NEW) | One sequence. Renders header (title, slug, reorder, expand toggle). Header `onclick` calls `navigate(...)` directly. Body holds sequence meta form + items list + create-item form; the sequence-meta form owns its own dirty tracker and registers it in the page-wide registry via context. |
| `components/editor/ItemRow.svelte` (NEW) | One item in a sequence's list. Shows title + type icon + reorder ↑/↓ + delete + Open button (navigates to `ItemEditPage`). Pure presentational; emits actions up. |
| `components/editor/AccordionHeader.svelte` (NEW) | Reusable header element used by both Block and Sequence accordions. Renders the toggle button (`<button aria-expanded>`), title, slug, and slots for extra controls. Pure presentational. |
| `pages/editor/BlockEditPage.svelte` | **DELETED.** Functionality merges into BlockAccordion body. |
| `pages/editor/SequenceEditPage.svelte` | **DELETED.** Functionality merges into SequenceAccordion body. |
| `pages/editor/ItemEditPage.svelte` | **UNCHANGED.** Still its own route; back-button still works. |

## Routes

| Route | Behavior |
|---|---|
| `/courses/:slug/edit` | VersionsPage. Unchanged from slice 1. |
| `/courses/:slug/edit/v/:vid` | VersionEditPage with **all blocks collapsed**. Default landing for fresh navigation. |
| `/courses/:slug/edit/v/:vid/blocks/:bid` | VersionEditPage with **block `bid` expanded** (and that block's sequences accordion collapsed). Page scrolls block header into view. |
| `/courses/:slug/edit/v/:vid/blocks/:bid/sequences/:sid` | VersionEditPage with **block `bid` expanded** AND **sequence `sid` expanded**. Page scrolls sequence header into view. |
| `/courses/:slug/edit/v/:vid/blocks/:bid/sequences/:sid/items/:iid` | ItemEditPage. Unchanged from slice 1. Back button returns to `/blocks/:bid/sequences/:sid` so the user lands back in the accordion with their context preserved. |

The `BlockEdit` and `SequenceEdit` route entries in `routes.ts` keep their patterns and just point to `VersionEditPage` (the logical name in `routes.ts` is updated for clarity). The `componentMap` in `App.svelte` no longer references the deleted page components.

### Stale-id fallback

If `routeBid` doesn't resolve to a block in `tree.blocks` (deleted between deep-link share and click, or concurrent admin removed it), the page:

1. Shows a single info toast: "Block not found."
2. Replaces the URL to `/edit/v/:vid` (history **replace**, not push — so Back doesn't re-trigger the toast).
3. Renders the version page with all blocks collapsed.

Same shape for stale `routeSid` against the expanded block's `sequences`: toast "Sequence not found.", replace to `/edit/v/:vid/blocks/:bid` (keep the block expanded), proceed.

This mirrors slice-1's 404 path from `BlockEditPage.svelte:199` and `SequenceEditPage.svelte:241`, just rendered inline. Validation runs in an `$effect` keyed on `(routeBid, routeSid, tree)` so it fires on initial load, after any tree refetch, and on every route change.

## Expansion state and URL synchronization

Accordion expansion is **purely derived from URL route params** — `VersionEditPage` keeps no parallel expansion state:

```typescript
// In VersionEditPage
const bid = $derived(routeBid);  // from route params; null on /v/:vid
const sid = $derived(routeSid);

// BlockAccordion is "expanded" iff its id matches `bid`
// SequenceAccordion is "expanded" iff its parent block matches `bid` AND its id matches `sid`
```

Clicking a block header to expand calls `navigate('/edit/v/${vid}/blocks/${block.id}')` — the URL becomes the source of truth, the accordion re-derives expansion. Clicking the same expanded header to collapse calls `navigate('/edit/v/${vid}')`. Same shape for sequences. Browser Back/Forward "just works" — the accordion follows the URL.

**Push vs replace policy.** User-initiated expand/collapse clicks use `pushState` (so Back genuinely unwinds the user's exploration). Programmatic URL normalizations — stale-id fallback (see Routes), post-refetch repairs — use `replaceState` so Back doesn't re-trigger the broken state. The slice-1 router exposes both via `navigate(url, { replace: false })` (default push) and `navigate(url, { replace: true })`.

**Scroll + focus on deep-link / auto-expand.** When `VersionEditPage` mounts (or `routeBid` / `routeSid` change later) with non-null ids, after the admin-tree load resolves AND `await tick()` (so the accordion body has actually rendered into the DOM):

1. Move focus to the deepest expanded `AccordionHeader` toggle button (sequence toggle if `sid` is set, else block toggle).
2. Call `el.scrollIntoView({ block: 'start', behavior: 'instant' })` on the same element.

Focus first, then scroll — keyboard and screen-reader users land on a meaningful control, and `scrollIntoView` adjusts viewport regardless. (See Accordion a11y contract for the full focus rules across all interactions.)

This avoids the subtle bug where component state drifts from URL state on Back/Forward navigation. It also gives deep-linking for free: a colleague can paste `/edit/v/3/blocks/12/sequences/47` and land in the right context.

## Dirty state contract

**Per-form trackers.** Each editable form owns its own `makeDirtyTracker<T>`:

- Version-meta form — always mounted on `VersionEditPage`.
- Block-meta form — mounted only while a block is expanded.
- Sequence-meta form — mounted only while a sequence is expanded inside an expanded block.
- Inline create forms (new block, new sequence, new item) — mounted while their form is open.

Trackers are created on form mount and destroyed on unmount. Bodies of collapsed accordions are truly unmounted (no `display:none`); trackers they owned are gone.

**Dirty registry — `Set<DirtyTracker>` on `VersionEditPage`.** Forms register themselves into a page-wide reactive set, and the page exposes a single aggregate predicate:

```typescript
import { SvelteSet } from 'svelte/reactivity';

const registry = new SvelteSet<DirtyTracker>();

function register(t: DirtyTracker)   { registry.add(t); }
function unregister(t: DirtyTracker) { registry.delete(t); }

function isAnyDirty(): boolean {
  for (const t of registry) if (t.isDirty) return true;
  return false;
}
```

The registry and its `register` / `unregister` functions are provided via Svelte context (`setContext('dirtyRegistry', { register, unregister, isAnyDirty })`). Every form calls `register(tracker)` in an `$effect` (or `onMount`) and `unregister(tracker)` in its `onDestroy` cleanup — no prop-drilling through `BlockAccordion` → `SequenceAccordion`.

Note `tracker.isDirty` is a **getter on the slice-1 tracker** (`get isDirty(): boolean` at `frontend/src/lib/dirty.svelte.ts:31`) — no parentheses. Reading it re-evaluates the union-of-keys snapshot comparison and triggers a reactive read on the underlying `$state` proxies. The aggregate `isAnyDirty()` iterates the registry and reads `t.isDirty` (as a property, never `t.isDirty()`) — every read participates in Svelte 5's reactivity graph, so DirtyGuard reruns when any registered tracker's dirty state flips.

**Single nav-prompt path.** `DirtyGuard` owns the prompt for **every** navigation, including in-accordion expand/collapse clicks. There is no separate `tryNavigate` helper — accordion header click handlers call `navigate(...)` directly, and the existing `registerNavigationGuard` in slice-1's router fires `DirtyGuard.svelte:18` exactly once per navigation. `DirtyGuard` consumes the registry:

```svelte
<DirtyGuard isDirty={() => isAnyDirty()} />
```

This is the **only** prompt path; users never see the same `confirm()` twice for one click. The closure re-reads `isAnyDirty()` on every guard invocation (Task-13 lesson preserved at the literal-text level — the function reference, not the boolean value, is what DirtyGuard receives).

**Prompt copy.** When `isAnyDirty()` returns true, DirtyGuard calls `confirm("Discard unsaved changes and continue?")`. This is unambiguous about what "OK" does (discard, not save) — a slice-2 fix from the slice-1 copy "Save or discard your changes first?" which read as if confirm would save.

**Cancel handling.** Native `confirm()` is synchronous and pre-empts the click before any URL change. If the user cancels, no navigation happens; the accordion stays as-is; the dirty form is preserved; no visual state needs restoring.

**Reorder / delete inside a dirty body.** Reorder ↑/↓ buttons and the inline delete buttons are **disabled** while their nearest enclosing form is dirty. Tooltip: "Save or discard your changes first." This avoids races between an in-flight reorder and an unsaved edit, and removes ambiguity about whether reorder counts as "abandoning" the edit. Same rule for the block-level delete affordance inside an expanded block body.

## Accordion a11y contract

`AccordionHeader` renders the same HTML shape at every level (block and sequence). The toggle button and the action buttons (reorder, eventually delete/open) are **siblings**, never nested:

```svelte
<div class="accordion-row">
  <button
    id={headerId}
    aria-expanded={expanded}
    aria-controls={panelId}
    onclick={onToggle}
    class="toggle"
  >
    <span class="title">{title}</span>
    <span class="slug">/{slug}</span>
  </button>
  <button aria-label="Move up"   onclick={onMoveUp}   disabled={!canReorderUp   || dirty || busy}>↑</button>
  <button aria-label="Move down" onclick={onMoveDown} disabled={!canReorderDown || dirty || busy}>↓</button>
</div>

{#if expanded}
  <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
    <!-- meta form, sub-accordion, etc. -->
  </div>
{/if}
```

Invariants:

- `headerId` and `panelId` are stable for the row's lifetime — derived `block-${bid}-header` / `block-${bid}-panel` and `seq-${sid}-header` / `seq-${sid}-panel`.
- Reorder buttons are **siblings** of the toggle button, not children. Nested `<button>` inside `<button>` is invalid HTML and breaks keyboard interaction.
- Toggle label is just title + slug — short and announced by SR on focus.
- Panel `role="region"` + `aria-labelledby={headerId}` gives SR users a landmark to skim with.
- Collapsed bodies are truly unmounted — no `display:none`.

**Focus management:**

| Event | Focus lands on |
|---|---|
| Deep-link / programmatic auto-expand on mount | Deepest expanded toggle button (sequence toggle if `sid` is set, else block toggle), then `scrollIntoView({block:'start', behavior:'instant'})` |
| User clicks a toggle to expand or collapse | Stays on the clicked toggle (default browser behavior) |
| User cancels the dirty-prompt | Stays on the toggle that triggered the prompt (no URL change happened) |
| After delete row | Next sibling row's toggle, or parent accordion header if the list is now empty |
| After reorder | Stays on the moved row's reorder button so repeated ↑/↓ presses work |
| Returning from `ItemEditPage` to `VersionEditPage` (via back / breadcrumb) | Same rule as deep-link: focus on the deepest expanded toggle |

## Item navigation

Clicking an item's "Open" button navigates to `/edit/v/:vid/blocks/:bid/sequences/:sid/items/:iid`. The user lands on `ItemEditPage` (unchanged). When they click the back button or the breadcrumb's `← {seq.title}` link, they go to `/edit/v/:vid/blocks/:bid/sequences/:sid` — `VersionEditPage` re-mounts with both the block and the sequence pre-expanded (URL drives state, see above). The return triggers one admin-tree refetch (`onDestroy(clearEditorVersion)` on the leaving ItemEditPage forces it) — accepted cost for guaranteed fresh state.

## Reorder

- Block reorder ↑/↓ lives in each `BlockAccordion` header (collapsed and expanded both). The arrow buttons retain `aria-label="Move up"` / `"Move down"` from slice 1's E-I2 fix.
- Sequence reorder ↑/↓ lives in each `SequenceAccordion` header within an expanded block — present on both collapsed and expanded sequence headers, for parity with block reorder.
- Item reorder ↑/↓ lives in each `ItemRow` within an expanded sequence. Same a11y.

All three call the existing `/api/.../reorder` endpoints; refetch tree on success. Disabled while in flight (existing `busy` flag pattern). **Also disabled when the row's nearest enclosing form is dirty** — see Dirty state contract.

**Expansion preservation across reorder.** After a successful reorder + tree refetch:

- If the URL's `bid` / `sid` entities still exist in the new tree, expansion holds — the derived expansion looks them up by id, and reorder doesn't change ids.
- If a missing id surfaces (concurrent delete by another admin), the stale-id fallback (see Routes) kicks in: toast + history-replace to the nearest valid parent URL.
- The expanded body's tracker is unaffected — the tracker keys on `(vid, bid)` / `(vid, bid, sid)`, not on position.

## Create / delete

- Create new block: button at the bottom of the blocks accordion, expands a small inline form (slug+title), uses the existing `mapCreateError` helper for inline 422/409 field errors.
- Create new sequence: button at the bottom of an expanded block's sequence list. Same form pattern.
- Create new item: existing 2-step picker (`ItemTypePicker` + type-specific required field) at the bottom of an expanded sequence's items list. Auto-seeds `# {title}` for static_page items.
- Delete block: button at the bottom of an expanded block body, gated by "Save or discard first" + "Remove sequences first". Same as slice 1 BlockEditPage's delete affordance.
- Delete sequence: equivalent at sequence level.
- Delete item: in the item row's actions (no need to expand to ItemEditPage just to delete).

All inline forms reuse `mapCreateError` and the `.field-err` / `.form-err` styles from slice 1.

## What gets deleted

- `frontend/src/pages/editor/BlockEditPage.svelte` (functionality moves into `BlockAccordion`)
- `frontend/src/pages/editor/SequenceEditPage.svelte` (functionality moves into `SequenceAccordion`)
- Test fixtures and any test cases specific to the deleted pages
- App.svelte entries for the deleted components

## What stays unchanged from slice 1

- `pages/editor/VersionsPage.svelte` and its `versionsPageLoader` store
- `pages/editor/ItemEditPage.svelte` (the item editor itself)
- `stores/currentEditorVersion.svelte.ts` — same single-flight + force + token stale-guard contract; same `loadAdminTree` returning `'ok' | 'error' | 'discarded'`
- `lib/dirty.svelte.ts` `makeDirtyTracker` — used unchanged at every accordion level
- `lib/router.svelte.ts` `registerNavigationGuard` and `DirtyGuard` component
- `lib/versionPermissions.ts` — accordion bodies consume `canEditTextFields` / `canEditStructure` exactly as the deleted pages did
- `lib/formErrors.ts` `mapCreateError` and the `.field-err` / `.form-err` styling
- `lib/safeIframeUrl.ts` and `lib/normalizeVideoUrl.ts` — still used by `ItemEditPage`
- `components/editor/MarkdownEditor.svelte` and `VideoFrame.svelte` — still used by `ItemEditPage`
- `components/editor/DirtyGuard.svelte` — same callback-based contract; just consumes `() => isAnyDirty()` from the page-wide registry instead of a single tracker reference
- All slice-1 backend changes (none modified in slice 2)

## Backend impact

None. The existing `/api/versions/{vid}/admin-tree` endpoint already returns the full hierarchical tree (course + version + blocks + sequences + items). Reuses the same per-entity PATCH / POST / DELETE endpoints. No schema changes, no new endpoints.

## Race safety / async correctness

Carries forward all slice-1 patterns:

- **Pin route IDs at await-start** in every async handler (save block, save sequence, reorder, delete, create). Same `savedVid`/`savedBid`/`savedSid`/`savedSlug` capture as in slice 1.
- **`loadAdminTree` LoadResult discrimination** (`'ok'` / `'error'` / `'discarded'`) in every save flow. Same toast policy.
- **`onDestroy(clearEditorVersion)`** at the page level (VersionEditPage). Same as slice 1.
- **Tracker rebuild keyed on `(trackerVid, trackerBid)`** for block trackers and `(trackerVid, trackerBid, trackerSid)` for sequence trackers. Defensive against future single-shell scenarios; tuple-key promotion for sequence trackers reflects that the same `BlockAccordion` may persist across `routeSid` changes inside an expanded block.
- **DirtyGuard closure re-reads live registry** every invocation — `() => isAnyDirty()`, never `isAnyDirty()`. Same Task-13 closure-snapshot lesson applied at the registry level.

**New for single-component-multi-route.** `/v/:vid`, `/blocks/:bid`, and `/sequences/:sid` all render the same `VersionEditPage` instance — route changes no longer create a fresh component lifecycle. The page must therefore:

- React to `routeBid` / `routeSid` changes via `$effect`, not on `onMount`.
- Validate that `routeBid` / `routeSid` exist in the current tree on every change; trigger the stale-id fallback (see Routes) when not.
- Unmount the child accordion body when the URL collapses a level — natural in Svelte 5: `{#if expanded}` flips false, the body unmounts, child trackers run their `onDestroy(unregister(tracker))` cleanup. No manual registry cleanup on URL change.
- Treat `routeSid` going from one valid sid to another (same block) as: sequence body unmounts (old tracker unregistered), new sequence body mounts (new tracker registered). Reactive `{#if expanded}` inside `{#each block.sequences}` handles this via Svelte's keyed-block diffing — key the each block on `seq.id`.

## Testing approach

**Strategy: extract pure helpers; test those with existing vitest.** The repo has no `@testing-library/svelte` setup and slice 1 stayed entirely with store/lib tests via vitest. Slice 2 follows the same pattern — no new mount-test harness, no jsdom-DOM dependency added. Component-level behavior (expand/collapse, dirty-prompt, reorder/delete a11y, focus moves) is covered by the manual smoke checklist.

New pure helpers to extract and test:

- **`lib/deriveExpansion.ts`** — `deriveExpansion(bid, sid, tree) → { expandedBlock: Block | null, expandedSequence: Sequence | null, staleBid: boolean, staleSid: boolean }`. Encapsulates the lookup-and-stale-id logic. Tests: matching ids return entities; missing `bid` → `staleBid=true`; missing `sid` inside a valid block → `staleSid=true`; null `bid`/`sid` → null entities, `stale*` false.
- **`lib/dirtyRegistry.svelte.ts`** — `SvelteSet`-based registry with `register`, `unregister`, `isAnyDirty`. Tests: register/unregister symmetry; `isAnyDirty()` reflects underlying tracker `isDirty` getter state via fake trackers exposing a getter shape; multiple trackers OR correctly (one dirty → true; all clean → false).

Existing tests preserved unchanged:
- `currentEditorVersion.test.ts` (store behavior)
- `formErrors.test.ts`, `safeIframeUrl.test.ts`, `normalizeVideoUrl.test.ts`, `versionsPageLoader.test.ts`, `dirty.test.ts`, `router.test.ts`, `versionPermissions.test.ts`
- `ItemEditPage` smoke (still mounts the item editor route)

Tests removed:
- Any tests specific to the deleted `BlockEditPage` / `SequenceEditPage` routes (none exist today; both are page-shell components without dedicated unit tests).

**Adding `@testing-library/svelte` is a discrete future task — not blocking for slice 2.** If component-mount coverage is later desired (e.g., for the dirty-prompt cancel path), it's a self-contained add: install package, configure jsdom in `vite.config.ts`, write the tests. Not in scope here.

## Migration

This is a frontend-only redesign on a fresh branch. Slice 1 ships independently. When slice 2 lands, the route patterns `/blocks/:bid` and `/sequences/:sid` continue to work — they just resolve to `VersionEditPage` with the right accordion expansion. Existing bookmarks and shared links remain valid.

## Manual smoke checklist (slice 2)

1. Login → CourseList → click Edit on an admin course. (Unchanged.)
2. Versions list → open existing version. Lands on `VersionEditPage` with all blocks collapsed.
3. Click a block header → block expands, URL updates to `/blocks/:bid`, page scrolls header into view.
4. Edit block title → click another block header → confirm("Save or discard…?") prompts; Cancel keeps current; Confirm discards and switches.
5. Within an expanded block: click a sequence header → sequence expands, URL updates to `/sequences/:sid`.
6. Items list shows item titles + type icons + reorder + delete + Open button.
7. Click Open on an item → navigates to ItemEditPage. Click back / breadcrumb → returns to accordion with same block + sequence still expanded.
8. Browser Back from `/blocks/12/sequences/47` → URL becomes `/blocks/12` and sequence collapses (block stays expanded). Browser Back again → URL becomes `/v/3` and block collapses.
9. Deep-link: paste `/blocks/12/sequences/47` directly into address bar → page loads with both expanded.
10. Reorder block ↑/↓ from collapsed header → tree refetches; expansion state preserved.
11. Reorder sequence within expanded block → same behavior.
12. Reorder item within expanded sequence → same behavior.
13. Create new block → inline form with `mapCreateError` field errors on 409/422.
14. Same for create new sequence and create new item.
15. Delete block (after removing all sequences) / delete sequence (after removing all items) / delete item — all work without leaving the accordion.
16. Disabled-version branch on `VersionEditPage`: all meta forms render as disabled inputs; reorder, create, and delete controls are hidden or disabled; clicking an item's "Open" navigates to `ItemEditPage` which itself renders preview-only for static_page items (slice-1 behavior, unchanged).
17. DirtyGuard: open block, edit title, click browser Back → confirm prompt; Cancel restores URL and preserves the edit.
18. Keyboard walk: Tab through collapsed block toggles; Enter on one expands it; Tab into the body; Tab reaches first sequence toggle; Enter expands sequence; Tab into items list. Screen reader announces "expanded" / "collapsed" on toggle state change.
19. Deep-link focus: paste `/blocks/12/sequences/47` directly → after load, focus is on the sequence toggle, viewport scrolled to it.
20. Multi-dirty: edit version meta title + expand a block + edit block meta title → click a different block header → single confirm prompt fires; Cancel keeps both edits intact; Confirm discards both.
21. Stale-id fallback: open `/blocks/12`, have another admin delete block 12, click any action → tree refetches, page toasts "Block not found.", URL replaces to `/v/:vid`, all blocks collapsed. Repeat for stale sid.
22. Reorder-while-dirty: edit block meta title (dirty) → block reorder ↑/↓ is disabled with tooltip; same for sequence and item reorder inside dirty bodies.

## Implementation order

Suggested order for the writing-plans phase to follow:

1. Branch hygiene + read-through of slice-1 patterns.
2. **Pure helpers + tests**: `deriveExpansion.ts` and `dirtyRegistry.svelte.ts` first — they're the data model the rest hangs off.
3. New leaf components: `AccordionHeader` (with the a11y contract above), `ItemRow`.
4. `SequenceAccordion` — items list + create-item + sequence meta form. Registers its tracker via context.
5. `BlockAccordion` — uses `SequenceAccordion`, owns block-meta tracker, also registers via context.
6. `VersionEditPage` **layout phase**: render version-meta form + state actions + accordion list, with `deriveExpansion` driving URL→expansion. No registry wiring yet — DirtyGuard temporarily reads only version-meta tracker.
7. `VersionEditPage` **registry phase**: provide `dirtyRegistry` via `setContext`; replace DirtyGuard's `isDirty` callback with `() => isAnyDirty()`; verify single-prompt behavior with manual smoke.
8. Routes: keep `/blocks/:bid` and `/sequences/:sid` patterns but rebind to `VersionEditPage` in `routes.ts` + `App.svelte`. Wire stale-id fallback (`$effect` on `(routeBid, routeSid, tree)`).
9. Focus + scroll management: deep-link mount, post-`tick()` focus the deepest toggle, `scrollIntoView`. Focus rules for cancel-dirty, delete, reorder.
10. Delete `BlockEditPage.svelte` and `SequenceEditPage.svelte`. Remove their App.svelte/componentMap entries.
11. Manual smoke (the 22-item checklist above).
12. Multi-reviewer panel (race-safety, Svelte 5 idioms, UX/a11y, integration).
