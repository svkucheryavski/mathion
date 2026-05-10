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
| 2 | **Auto-collapse on switch with dirty prompt.** Expanding a different block / sequence while the current one is dirty triggers `confirm("Save or discard your changes first?")`; cancel keeps the current edit open. | Mirrors today's per-page DirtyGuard semantics — no new failure modes. Save-as-you-go loses the safety net; multiple-pending-with-global-Save is harder to communicate. |
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
| `pages/editor/VersionEditPage.svelte` | Top-level page. Holds version meta form, state actions, and the blocks accordion. Owns the accordion's expansion state (`expandedBid`, `expandedSid`) and the global "active dirty form" reference (so DirtyGuard can ask the right tracker). |
| `components/editor/BlockAccordion.svelte` (NEW) | One block. Renders header (title, slug, reorder, expand). Body holds block meta form + sequences accordion. Owns its own dirty tracker. Emits `requestExpand` / `requestCollapse` to parent. |
| `components/editor/SequenceAccordion.svelte` (NEW) | One sequence. Renders header (title, slug, reorder, expand). Body holds sequence meta form + items list + create-item form. Owns its own dirty tracker. Emits `requestExpand` / `requestCollapse` to parent block. |
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

The `BlockEdit` and `SequenceEdit` route entries in `routes.ts` are renamed (logical name only — pattern stays the same) and point to `VersionEditPage`. The `componentMap` in `App.svelte` no longer references the deleted page components.

## Expansion state and URL synchronization

Accordion expansion is driven from URL route params, not from internal component state:

```typescript
// In VersionEditPage
const bid = $derived(routeBid);  // from route params; null on /v/:vid
const sid = $derived(routeSid);

// BlockAccordion is "expanded" iff its id matches `bid`
// SequenceAccordion is "expanded" iff its parent block matches `bid` AND its id matches `sid`
```

Clicking a block header to expand calls `navigate(/edit/v/${vid}/blocks/${block.id})` — the URL becomes the source of truth, the accordion re-derives expansion. Clicking the same expanded header to collapse calls `navigate(/edit/v/${vid})`. Same shape for sequences. Browser Back/Forward "just works" — the accordion follows the URL.

This avoids the subtle bug where component state drifts from URL state on Back/Forward navigation. It also gives deep-linking for free: a colleague can paste `/edit/v/3/blocks/12/sequences/47` and land in the right context.

## Dirty state contract

**Per-accordion-body trackers.** Each `BlockAccordion` body and each `SequenceAccordion` body owns its own `makeDirtyTracker` for its meta form. Trackers are created when the body mounts (i.e., when the accordion expands) and destroyed when the body unmounts (i.e., when collapsed). Same shape as today's per-page tracker — just relocated.

**Auto-collapse with dirty prompt.** When the user clicks to expand a different block (or different sequence within the same block), the parent intercepts and:

1. If the currently-expanded body's tracker reports `isDirty`: `confirm("Save or discard your changes first?")`. Cancel → ignore the click. Confirm → discard the dirty tracker (no save) and proceed to the new expansion.
2. If clean: navigate to the new expansion immediately.

This is implemented in `VersionEditPage` (for block-level) and in each `BlockAccordion` (for its sequence-level), using a small `tryNavigate(targetUrl)` helper that consults the active tracker before calling `navigate()`.

**DirtyGuard.** The page-level `<DirtyGuard isDirty={() => activeTracker?.isDirty ?? false} />` reads from a single "active tracker" reference that the page maintains. When a block or sequence accordion expands, it registers its tracker as the active one; when it collapses, it unregisters. This means external navigation (browser Back, click on the breadcrumb, click on a different sequence in another block) always consults the right tracker.

**One single-source-of-truth reference, three writers.** `VersionEditPage` holds `let activeTracker = $state<DirtyTracker | null>(null)`. The version-meta form, the active block accordion, and the active sequence accordion each write a reference into this slot when their body becomes the focus, and write `null` when they lose it. DirtyGuard always reads the current value through a closure, exactly as in slice 1.

## Item navigation

Clicking an item's "Open" button navigates to `/edit/v/:vid/blocks/:bid/sequences/:sid/items/:iid`. The user lands on `ItemEditPage` (unchanged). When they click the back button or the breadcrumb's `← {seq.title}` link, they go to `/edit/v/:vid/blocks/:bid/sequences/:sid` — `VersionEditPage` re-mounts with both the block and the sequence pre-expanded (URL drives state, see above).

## Reorder

- Block reorder ↑/↓ lives in each `BlockAccordion` header (collapsed and expanded both). The arrow buttons retain `aria-label="Move up"` / `"Move down"` from slice 1's E-I2 fix.
- Sequence reorder ↑/↓ lives in each `SequenceAccordion` header within an expanded block. Same a11y.
- Item reorder ↑/↓ lives in each `ItemRow` within an expanded sequence. Same a11y.

All three call the existing `/api/.../reorder` endpoints; refetch tree on success. Disabled while in flight (existing `busy` flag pattern).

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
- `components/editor/DirtyGuard.svelte` — same callback-based contract; just consumes a parent-managed active-tracker reference
- All slice-1 backend changes (none modified in slice 2)

## Backend impact

None. The existing `/api/versions/{vid}/admin-tree` endpoint already returns the full hierarchical tree (course + version + blocks + sequences + items). Reuses the same per-entity PATCH / POST / DELETE endpoints. No schema changes, no new endpoints.

## Race safety / async correctness

Carries forward all slice-1 patterns:

- **Pin route IDs at await-start** in every async handler (save block, save sequence, reorder, delete, create). Same `savedVid`/`savedBid`/`savedSid`/`savedSlug` capture as in slice 1.
- **`loadAdminTree` LoadResult discrimination** (`'ok'` / `'error'` / `'discarded'`) in every save flow. Same toast policy.
- **`onDestroy(clearEditorVersion)`** at the page level (VersionEditPage). Same as slice 1.
- **Tracker rebuild keyed on `(trackerVid, trackerBid)`** for block trackers and `(trackerVid, trackerBid, trackerSid)` for sequence trackers. Defensive against future single-shell scenarios.
- **DirtyGuard closure re-reads live tracker reference** every invocation — same Task-13 closure-snapshot lesson applied.

## Testing approach

Add component-level tests for the accordion expansion logic:

- `tests/blockAccordion.test.ts`: expand/collapse, dirty-prompt on switch, reorder calls correct endpoint, create-form maps errors via `mapCreateError`
- `tests/sequenceAccordion.test.ts`: same shape at sequence level
- `tests/versionEditPage.accordion.test.ts`: URL → expansion derivation, deep-link auto-expand, browser-Back consistency

Existing tests preserved:
- `currentEditorVersion.test.ts` (store behavior)
- `formErrors.test.ts`, `safeIframeUrl.test.ts`, `normalizeVideoUrl.test.ts`, `versionsPageLoader.test.ts`, `dirty.test.ts`, `router.test.ts`, `versionPermissions.test.ts`
- `ItemEditPage` smoke (still mounts the item editor route)

Tests removed:
- Any tests specific to the deleted `BlockEditPage` / `SequenceEditPage` routes (none exist today; both are page-shell components without dedicated unit tests).

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
16. Disabled-version branch: editor renders preview-only MarkdownEditor for static_page items inside the accordion (same logic as ItemEditPage's preview-only branch).
17. DirtyGuard: open block, edit title, click browser Back → confirm prompt; Cancel restores URL.

## Implementation order

Suggested order for the writing-plans phase to follow:

1. Branch hygiene + read-through of slice-1 patterns
2. New leaf components: `AccordionHeader`, `ItemRow`
3. `SequenceAccordion` (smallest level — items list + create-item + sequence meta form). Tests.
4. `BlockAccordion` (uses `SequenceAccordion`). Tests.
5. `VersionEditPage` rewrite (accordion list + URL-derived expansion + active-tracker registry + dirty-prompt-on-switch). Tests.
6. Routes: keep `/blocks/:bid` and `/sequences/:sid` patterns but rebind to `VersionEditPage` in `routes.ts` + `App.svelte`.
7. Delete `BlockEditPage` and `SequenceEditPage`.
8. Manual smoke (the 17-item checklist above).
9. Multi-reviewer panel (race-safety, Svelte 5 idioms, UX/a11y, integration).
