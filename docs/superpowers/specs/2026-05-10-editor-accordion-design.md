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
| `components/editor/ItemRow.svelte` (NEW) | One item in a sequence's list. Shows title + type icon + reorder ↑/↓ + delete + Open button (navigates to `ItemEditPage`). The Open button's accessible name is per-item: `aria-label={`Open ${item.title}`}`. Delete button: `aria-label={`Delete ${item.title}`}`. Reorder uses scoped labels: `"Move item up"` / `"Move item down"`. Pure presentational; emits actions up. |
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

**Dirty registry — factory in `lib/dirtyRegistry.svelte.ts`.** A new helper module owns the registry's shape; `VersionEditPage` instantiates it once via the factory, then provides it via context. Forms anywhere below register themselves on mount, unregister on destroy.

```typescript
// frontend/src/lib/dirtyRegistry.svelte.ts
import { SvelteSet } from 'svelte/reactivity';

// Non-generic erased shape — registry stores trackers across all form shapes.
// The concrete tracker types still flow through their owning form; only the
// registry needs to forget the parameter.
export type RegisteredTracker = { readonly isDirty: boolean };

export const DIRTY_REGISTRY_KEY = Symbol('dirtyRegistry');

export type DirtyRegistry = {
  register(t: RegisteredTracker): void;
  unregister(t: RegisteredTracker): void;
  isAnyDirty(): boolean;
};

export function createDirtyRegistry(): DirtyRegistry {
  const registry = new SvelteSet<RegisteredTracker>();
  return {
    register(t)   { registry.add(t); },
    unregister(t) { registry.delete(t); },
    isAnyDirty() {
      for (const t of registry) if (t.isDirty) return true;
      return false;
    },
  };
}
```

`VersionEditPage` wires it once at the top of the component:

```typescript
import { setContext } from 'svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '$lib/dirtyRegistry.svelte';

const dirtyRegistry = createDirtyRegistry();
setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);
```

Forms (version-meta, BlockAccordion, SequenceAccordion, create-forms) consume it via the same key:

```typescript
import { getContext } from 'svelte';
import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '$lib/dirtyRegistry.svelte';

const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
// Required at this site — if undefined, that's a wiring bug (assert).

$effect(() => {
  dirty.register(tracker);
  return () => dirty.unregister(tracker);
});
```

`Symbol` key (not a magic string) prevents typo drift between provider and consumer — both import the same exported constant. The `$effect` setup/teardown is symmetric in one block, so the tracker can never leak even if the form unmounts mid-lifecycle.

Note `tracker.isDirty` is a **getter on the slice-1 tracker** (`get isDirty(): boolean` at `frontend/src/lib/dirty.svelte.ts:31`) — no parentheses. Reading it re-evaluates the union-of-keys snapshot comparison and triggers a reactive read on the underlying `$state` proxies. `isAnyDirty()` iterates the registry and reads `t.isDirty` as a property (never `t.isDirty()`) — every read participates in Svelte 5's reactivity graph.

`SvelteSet` (not plain `Set`) is what makes registry-membership changes reactive: when a form mounts and `register(t)` runs, any tracked context that calls `isAnyDirty()` will re-read the new set, including the newly-added tracker.

**isAnyDirty is called at navigation time, not subscribed to.** DirtyGuard receives `() => isAnyDirty()` as a callback — the function fires only when the router asks the guard whether to prompt (on a `navigate()` attempt or browser Back). It is not running continuously in a reactive scope. The `SvelteSet` + getter reactivity matters for *correct snapshot at call time*, not for live UI updates. If a future feature wants live-disabled "global Save" or similar, it should consume the registry via a `$derived` instead.

**Single nav-prompt path.** `DirtyGuard` owns the prompt for **every** navigation, including in-accordion expand/collapse clicks. There is no separate `tryNavigate` helper — accordion header click handlers call `navigate(...)` directly, and the existing `registerNavigationGuard` in slice-1's router fires `DirtyGuard.svelte` exactly once per navigation. `DirtyGuard` consumes the registry:

```svelte
<DirtyGuard isDirty={() => isAnyDirty()} />
```

This is the **only** prompt path; users never see the same `confirm()` twice for one click. The closure re-reads `isAnyDirty()` on every guard invocation (Task-13 lesson preserved at the literal-text level — the function reference, not the boolean value, is what DirtyGuard receives).

**Prompt copy.** When `isAnyDirty()` returns true, DirtyGuard calls `confirm("Discard unsaved changes and continue?")`. This is unambiguous about what "OK" does (discard, not save) — a slice-2 fix from the slice-1 copy. **Implementation note:** `frontend/src/components/editor/DirtyGuard.svelte` currently hardcodes `"Discard unsaved changes?"` (no "and continue"). Updating that string literal to the slice-2 copy is part of this slice's work — it is the only line-change needed inside DirtyGuard. See Implementation order step on DirtyGuard copy.

**Over-prompt is accepted, by design.** The aggregate `isAnyDirty()` fires whenever *any* form on the page is dirty, including version-meta. Concretely: a user editing version-meta who clicks a block header to "just look around" will see the prompt, even though the version-meta form survives the URL change. We accept this over-prompt as the cost of a simple, safe contract — a target-URL-aware predicate (where forms whose mount lifecycle survives the target don't count) would require changing DirtyGuard's `isDirty: () => boolean` signature to `isDirty: (targetUrl) => boolean` and threading target-URL info through. Slice 2's audience is internal admin users; "asks a redundant question occasionally" is preferable to "loses unsaved work because the predicate's lifecycle-prediction was wrong." Documented in the smoke checklist so QA isn't surprised.

**Cancel handling.** Native `confirm()` is synchronous and pre-empts the click before any URL change. If the user cancels, no navigation happens; the accordion stays as-is; the dirty form is preserved; no visual state needs restoring.

**Reorder / delete inside a dirty body.** Reorder ↑/↓ buttons and the inline delete buttons are **disabled** while their nearest enclosing form is dirty. Tooltip: "Save or discard your changes first." This avoids races between an in-flight reorder and an unsaved edit, and removes ambiguity about whether reorder counts as "abandoning" the edit. Same rule for the block-level delete affordance inside an expanded block body.

## Accordion a11y contract

`AccordionHeader` renders the same HTML shape at every level (block and sequence). The toggle button and the action buttons (reorder, eventually delete/open) are **siblings**, never nested:

```svelte
<!-- $level is "block" or "sequence" — used for scoped a11y labels -->
<div class="accordion-row">
  <button
    id={headerId}
    aria-expanded={expanded}
    aria-controls={panelId}
    onclick={onToggle}
    class="toggle"
  >
    <span class="title">{title}</span>
    <span class="slug" aria-hidden="true">/{slug}</span>
  </button>
  <button
    aria-label={`Move ${level} up`}
    onclick={onMoveUp}
    disabled={!canReorderUp || dirty || busy}
  >↑</button>
  <button
    aria-label={`Move ${level} down`}
    onclick={onMoveDown}
    disabled={!canReorderDown || dirty || busy}
  >↓</button>
</div>

{#if expanded}
  <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
    <!-- meta form, sub-accordion, etc. -->
  </div>
{/if}
```

Invariants:

- `headerId` and `panelId` are stable for the row's lifetime — derived from the entity's **id, coerced to string**: ``block-${String(block.id)}-header`` / `-panel` and ``seq-${String(seq.id)}-header`` / `-panel`. Use the entity's id from `tree.blocks` / `block.sequences`, not the route param string (route params can differ by encoding round-trip).
- Reorder buttons are **siblings** of the toggle button, not children. Nested `<button>` inside `<button>` is invalid HTML and breaks keyboard interaction.
- Reorder `aria-label` is **scoped per level**: `"Move block up"` / `"Move block down"` / `"Move sequence up"` / `"Move sequence down"` / `"Move item up"` / `"Move item down"`. The unscoped slice-1 `"Move up"` / `"Move down"` was unambiguous on a single-page editor but becomes ambiguous on the nested-accordion page where blocks, sequences, and items all carry the same controls.
- Toggle's accessible name is just the title — the visible `<span class="slug">` is `aria-hidden="true"` because screen readers would otherwise read `"/intro-1"` as `"slash intro dash one"`, doubling the announcement length without adding meaning.
- Panel `role="region"` + `aria-labelledby={headerId}` gives SR users a landmark to skim with.
- Collapsed bodies are truly unmounted — no `display:none`.

**Keyboard activation.** The toggle is a native `<button>`, so Enter and Space both activate it. Reorder buttons activate on Enter/Space. No custom `onkeydown` handlers — standard browser behavior.

**Keyboard navigation pattern: standard Tab order, no APG accordion shortcuts.** We deliberately do **not** implement the WAI-ARIA APG accordion pattern (Arrow Up/Down between headers, Home/End jumps). The trade-off: simpler implementation matching slice-1's flat tab order, at the cost of more tab stops in long lists. Tab order through an expanded block row:

1. Block toggle button
2. "Move block up" (↑)
3. "Move block down" (↓)
4. *(if expanded — panel content follows in DOM order)* first focusable inside the body: block-meta title input → block-meta info textarea → Save → Discard → first sequence toggle → that sequence's "Move sequence up" → "Move sequence down" → …

Shift-Tab reverses this. The consequence is that Shift-Tab from inside an expanded block body lands on the block's ↓ reorder button, then ↑, then the toggle — three steps to "go back to the header." We accept this; smoke item covers the path so QA isn't surprised.

**Focus management:**

| Event | Focus lands on |
|---|---|
| Deep-link / programmatic auto-expand on mount | Deepest expanded toggle button (sequence toggle if `sid` is set, else block toggle), then `scrollIntoView({block:'start', behavior:'instant'})` |
| User clicks a toggle to expand or collapse | Stays on the clicked toggle (default browser behavior) |
| User cancels the dirty-prompt | Stays on the toggle that triggered the prompt (no URL change happened) |
| User **confirms** the dirty-prompt (discards) | URL changes; old form unmounts; the deep-link rule fires for the new URL: focus on the deepest expanded toggle |
| After delete row | Next sibling row's toggle, or parent accordion header if the list is now empty |
| After reorder | Stays on the moved row's reorder button so repeated ↑/↓ presses work |
| Returning from `ItemEditPage` to `VersionEditPage` (via back / breadcrumb) | Same rule as deep-link: focus on the deepest expanded toggle |
| Shift-Tab from inside an expanded panel | Walks back through the panel's focusables in reverse DOM order, then onto the row's reorder ↓, ↑, then toggle. Accepted standard Tab order — see Keyboard navigation pattern above. |

**`scrollIntoView` chosen with `behavior: 'instant'`** (not `'smooth'`) so users on `prefers-reduced-motion` aren't surprised and so the scroll resolves in the same frame as the focus move — important for SR users whose virtual cursor is anchored to the focused element. Future "improvements" that change this to `'smooth'` should re-test on iOS Safari (where `scrollIntoView` on a focused element has been known to double-scroll).

## Item navigation

Clicking an item's "Open" button navigates to `/edit/v/:vid/blocks/:bid/sequences/:sid/items/:iid`. The user lands on `ItemEditPage` (unchanged). When they click the back button or the breadcrumb's `← {seq.title}` link, they go to `/edit/v/:vid/blocks/:bid/sequences/:sid` — `VersionEditPage` re-mounts with both the block and the sequence pre-expanded (URL drives state, see above). The return triggers one admin-tree refetch (`onDestroy(clearEditorVersion)` on the leaving ItemEditPage forces it) — accepted cost for guaranteed fresh state.

## Reorder

- Block reorder ↑/↓ lives in each `BlockAccordion` header (collapsed and expanded both). The arrow buttons use scoped `aria-label="Move block up"` / `"Move block down"` (see Accordion a11y contract — scoping is a slice-2 refinement on slice-1's bare `"Move up"` / `"Move down"`, since the nested accordion places block / sequence / item reorder buttons together on one page).
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

## Empty states

Three places need explicit empty-state copy so the page doesn't render as a void:

| Where | Copy |
|---|---|
| Version with zero blocks (above the "+ New block" button) | `"This version has no blocks yet."` |
| Expanded block with zero sequences (above the "+ New sequence" button) | `"No sequences yet."` |
| Expanded sequence with zero items (above the create-item picker) | `"No items yet — pick a type below to add one."` |

Render the copy in a `<p class="empty-state">` immediately preceding the create form. The create-form button remains the primary action — empty-state copy is informational only, not a CTA.

The block-level delete affordance (gated by "Save or discard first" + "Remove sequences first") is naturally adjacent to the zero-sequences empty state, since deleting a block requires the empty state first.

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
- `components/editor/DirtyGuard.svelte` — same callback-based contract; the only file change is updating the prompt string literal to `"Discard unsaved changes and continue?"` (slice-1 currently has `"Discard unsaved changes?"` — no "and continue"). Consumer-side: VersionEditPage passes `() => isAnyDirty()` from the page-wide registry instead of a single tracker reference
- All slice-1 backend changes (none modified in slice 2)

## Backend impact

None. The existing `/api/versions/{vid}/admin-tree` endpoint already returns the full hierarchical tree (course + version + blocks + sequences + items). Reuses the same per-entity PATCH / POST / DELETE endpoints. No schema changes, no new endpoints.

## Race safety / async correctness

Carries forward all slice-1 patterns:

- **Pin route IDs at await-start** in every async handler (save block, save sequence, reorder, delete, create). Same `savedVid`/`savedBid`/`savedSid`/`savedSlug` capture as in slice 1.
- **`loadAdminTree` LoadResult discrimination** (`'ok'` / `'error'` / `'discarded'`) in every save flow. Same toast policy.
- **`onDestroy(clearEditorVersion)`** at the page level (VersionEditPage). Same as slice 1.
- **Tracker rebuild keyed on `(trackerVid, trackerBid)`** for block trackers and `(trackerVid, trackerBid, trackerSid)` for sequence trackers. Defensive against future single-shell scenarios. **In the slice-2 mount model this is mostly belt-and-suspenders:** child bodies actually unmount via `{#if expanded}` when collapsed, so the tracker is destroyed and recreated naturally (see next bullet). The tuple-keyed rebuild is the secondary safety net for any case where the body stays mounted but its identity tracker should refresh (e.g., a future refactor that swaps from unmount-on-collapse to keep-mounted-and-hide).
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
- **`lib/dirtyRegistry.svelte.ts`** — exports `createDirtyRegistry()`, `DIRTY_REGISTRY_KEY: symbol`, `type DirtyRegistry`, `type RegisteredTracker`. Tests: factory returns an object with `register`/`unregister`/`isAnyDirty`; register/unregister symmetry on a `SvelteSet`; `isAnyDirty()` reads `t.isDirty` getter on each iterate call (verified by mutating a fake tracker's underlying state between calls); multiple trackers OR correctly (one dirty → true; all clean → false); add-then-remove returns to clean.
- **`lib/handleStaleIdFallback.ts`** — `handleStaleIdFallback({ staleBid, staleSid }, { vid, bid }, { toast, navigate }) → void`. Side-effecting stale-id response with injected `toast` and `navigate` so it's vitest-testable. Tests: `staleBid=true` calls `navigate('/edit/v/${vid}', { replace: true, force: true })` and `toast.info('Block not found.')`; `staleSid=true` calls `navigate('/edit/v/${vid}/blocks/${bid}', { replace: true, force: true })` and `toast.info('Sequence not found.')`; both false is a no-op. `{ force: true }` bypasses DirtyGuard for the stale-id case — prompting "save your changes?" on a deleted entity is pointless and Cancel would re-trigger the loop.

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
4. Edit block title → click another block header → `confirm("Discard unsaved changes and continue?")` prompts; Cancel keeps current; Confirm discards and switches (focus lands on the newly-expanded block's toggle).
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
23. Shift-Tab from inside an expanded block body lands on the row's ↓ reorder, then ↑, then the block toggle (standard Tab order; no APG accordion shortcut keys).
24. Scoped reorder labels: SR announces `"Move block up"`, `"Move sequence up"`, `"Move item up"` (not bare `"Move up"`).
25. Slug `aria-hidden`: SR does NOT read `"slash intro dash one"` when focused on a block toggle — only the title.
26. Empty states: brand-new course version shows `"This version has no blocks yet."` Expand a block with zero sequences → shows `"No sequences yet."` Expand a sequence with zero items → shows `"No items yet — pick a type below to add one."`
27. Over-prompt is accepted: edit version-meta title (dirty), click any block header to expand → prompt fires even though version-meta survives. Confirm discards version-meta edit; Cancel keeps it.

## Implementation order

Suggested order for the writing-plans phase to follow:

1. Branch hygiene + read-through of slice-1 patterns.
2. **Pure helpers + tests**: `deriveExpansion.ts`, `dirtyRegistry.svelte.ts` (with `createDirtyRegistry`, `DIRTY_REGISTRY_KEY`, `RegisteredTracker`), `handleStaleIdFallback.ts`. All three with vitest coverage.
3. **DirtyGuard string update**: edit `frontend/src/components/editor/DirtyGuard.svelte` to use `"Discard unsaved changes and continue?"`. Single-line literal change. Existing DirtyGuard tests pass.
4. **VersionEditPage shell**: new file scaffolding that provides `setContext(DIRTY_REGISTRY_KEY, createDirtyRegistry())` and the version-meta form registering into it. DirtyGuard wired with `() => isAnyDirty()`. No accordion children yet — just version meta + state actions. This step makes the registry **provider land before consumers**.
5. New leaf components: `AccordionHeader` (full a11y contract — scoped reorder labels, slug `aria-hidden`, stable IDs from entity.id), `ItemRow` (scoped reorder labels + per-item Open / Delete `aria-label`).
6. `SequenceAccordion` — items list + create-item + sequence meta form. Reads `getContext(DIRTY_REGISTRY_KEY)` and registers its sequence-meta tracker via `$effect`. Mount-tests via VersionEditPage shell (which now provides context).
7. `BlockAccordion` — uses `SequenceAccordion`. Reads context, registers its block-meta tracker, hosts the inner sequences list.
8. **VersionEditPage accordion wiring**: extend the shell to render the blocks accordion list with `deriveExpansion` driving URL→expansion. Wire the stale-id `$effect` on `(routeBid, routeSid, tree)` calling `handleStaleIdFallback`. Empty-state copy for zero-blocks.
9. **Routes**: keep `/blocks/:bid` and `/sequences/:sid` patterns; rebind to `VersionEditPage` in `routes.ts` + `App.svelte`.
10. **Focus + scroll management**: deep-link mount, post-`tick()` focus the deepest toggle, `scrollIntoView`. Focus rules for cancel-dirty, confirm-dirty, delete, reorder, Shift-Tab.
11. Delete `BlockEditPage.svelte` and `SequenceEditPage.svelte`. Remove their App.svelte / componentMap entries.
12. Manual smoke (the 27-item checklist above).
13. Multi-reviewer panel (race-safety, Svelte 5 idioms, UX/a11y, integration).

**Note on provider-before-consumers:** Steps 4 (shell) and 6–7 (Block/SequenceAccordion) are now correctly ordered — the page's context provider is wired in step 4, *before* any component that calls `getContext(DIRTY_REGISTRY_KEY)` mounts. Earlier versions of this plan had the consumers (BlockAccordion / SequenceAccordion) being built before the provider was in place; this revision moves the shell + context wiring up to step 4 to avoid that ordering bug. Consumers may assert `getContext(...) !== undefined` at mount — a missing provider is a wiring bug, not a recoverable runtime state.
