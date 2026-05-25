# Run-Assets Management Design

**Date:** 2026-05-25
**Status:** Draft — under review (rev. 3 after 5×2-reviewer pass)

## Goal

Add a standalone Assets management surface to `RunDetailPage` so admins and teachers can audit, clean up, pre-upload, and replace files attached to a run — independent of the per-MP modal sidebar that exists today.

## Non-goals

- **Renaming an asset** — would invalidate all `RunAssetReference` rows and require coordinated rewrite of every MP's `assignment_md`. Out of scope.
- **Asset preview inline** — clicking a filename uses the existing GET serve URL in a new tab; no inline PDF/image viewer.
- **Asset download as zip / bulk-download** — not asked for, not in scope.
- **Per-asset version history** — replace overwrites; no audit trail of past versions.
- **Tagging / metadata fields** — assets carry only `filename`, `size`, `mime_type`, `uploaded_at`, `uploaded_by`.
- **Server-side bulk-delete endpoint** — `RunRosterTab` uses one, but the asset surface is much smaller (typical ~20 assets) and a sequential client-side loop is simpler. Single-row DELETEs with `AbortController` keep the partial-failure UX clean.

## Architecture

### Surface
New `Assets` tab on `RunDetailPage` (6th button, after Mini-projects). Same `role="tab"` + `aria-selected` pattern as the other five (see `RunDetailPage.svelte:323-327`).

### Component
`RunAssetsTab.svelte`, sibling of `RunMiniProjectsTab.svelte` at `frontend/src/components/runs/`.

### Backend additions

**1. New endpoint:** `PUT /api/runs/{run_id}/assets/{asset_id}` (multipart upload)
- Permissions: `require_run_admin_or_teacher` (same gate as POST/DELETE-without-force, per `backend/mathion/api/run_assets.py`).
- **Ordering of operations** (no orphan temp file on early failures):
  1. Load existing asset row (`get_or_404` → 404 before touching disk).
  2. **Ownership check**: verify `asset.run_id == run_id` (mirrors existing DELETE at `backend/mathion/api/run_assets.py:192-194`); otherwise 404. **Pre-temp**: still no orphan temp file.
  3. Validate incoming extension matches the existing asset's extension — **case-insensitive** (both compared lowercased; 422 otherwise). Existing `assets.py:validate_extension` already lowercases on POST, so PUT uses the same helper.
  4. Validate per-file size (`MAX_FILE_SIZE_BYTES`).
  5. Validate per-run aggregate (`MAX_COURSE_SIZE`) using **delta** (`new_size - old_size`) so a small replace can't push the run over quota; 413 otherwise.
  6. Write temp file (`tempfile.mkstemp`).
  7. Atomic `os.replace` from temp → final path under the **existing** filename.
  8. Update `file_size`, `mime_type`, `uploaded_at`, `uploaded_by`; commit.
  9. `RunAssetReference` rows untouched (sync intentionally skipped — filename unchanged ⇒ refs still valid).
  10. Return updated `RunAssetResponse` with `is_referenced` and `uploaded_by_email` populated consistently with GET (see below).

The incoming file's name is ignored — backend always stores under the existing row's filename so all references survive.

**2. Schema extension:** `RunAssetResponse.uploaded_by_email: str | None = None`

- Today's `uploaded_by: int | None` (user ID) is unhelpful to teachers. Add the email alongside.
- **Schema default must be `None`** so existing call sites that don't populate it pass validation. Critically: the existing POST endpoint at `backend/mathion/api/run_assets.py:97-99` returns the ORM row directly via `RunAssetResponse.model_validate(...)`. Adding the field without a default would break POST validation. Default ensures backwards-compat.
- **Construction pattern** (no `from_model` helper exists today — the current list at `backend/mathion/api/run_assets.py:119` is `resp = RunAssetResponse.model_validate(a); resp.is_referenced = ref_count > 0`). Add post-hoc population the same way at ALL three response sites (POST, GET-list, PUT):
  ```python
  resp = RunAssetResponse.model_validate(a)
  resp.is_referenced = ref_count > 0
  resp.uploaded_by_email = (
      db.scalar(select(User.email).where(User.id == a.uploaded_by))
      if a.uploaded_by is not None else None
  )
  ```
- **N+1 only compounds on the list endpoint** (~20 micro-queries per list call at typical scale, all indexed `users.id` lookups). POST/PUT/single-GET each do exactly one email lookup. If profiling later shows the list on a hot path, a single `outerjoin(User, User.id == RunAsset.uploaded_by)` (pattern seen at `backend/mathion/api/dashboard.py:296`) is the optimization.
- `uploaded_by_email` is null when (a) the FK is null (column nullable; `ondelete="SET NULL"` for deleted users), (b) the FK points at a now-missing user row (hard delete bypassed cascade — defensive: `db.scalar(...)` returns `None`, no raise).
- Frontend type at `frontend/src/lib/types.ts` extended in lock-step (`uploaded_by_email: string | null`).

### Frontend lib helpers

- **New:** `replaceRunAsset(runId: number, assetId: number, file: File, signal?: AbortSignal): Promise<RunAssetResponse>` in `frontend/src/lib/runAssets.ts`. Wraps the new PUT. Wire-format mirrors `uploadRunAsset` exactly (see `frontend/src/tests/runAssets.test.ts:37-68`): multipart `FormData` with `file`, `credentials: 'include'`, `X-Requested-With: mathion`, no manual `Content-Type`, `signal` threaded for abort.
- **Extend existing:** `deleteRunAsset(runId, assetId, options?: { force?: boolean, signal?: AbortSignal })`. Current signature at `frontend/src/lib/runAssets.ts:60` has neither. Appends `?force=true` querystring only when `options.force === true` (omitted on `false` or `undefined`). Signal threaded for AbortController support in the bulk loop.
- **`AssetContext.remove` contract**: this is a shared interface between `courseAssetContext` and `runAssetContext` (`frontend/src/lib/assetContext.ts:17`). It stays unchanged (no `force` flag) — `RunAssetsTab` calls `deleteRunAsset` directly. The per-MP modal sidebar continues to use `AssetContext.remove` for orphan-only deletes (its existing UX doesn't include force-confirm).

### GET serve URL (clickable filename)

The existing GET endpoint is keyed by **filename**, not asset_id: `GET /api/runs/{rid}/assets/{filename}`. Clicking the filename column opens this URL in a new tab. Because filename is preserved across replace, the URL is **stable** — bookmarkable, linkable from markdown.

### `loadAll` placement (outer batch, run-scoped)

`RunDetailPage.loadAll` has two Promise.all batches (verified at `RunDetailPage.svelte:62-68` outer, inner after the pinned-version gate):
- **Outer**: `[getRun, listVersions, listRunTeachers, listGroups, listRunStudents]` — run-scoped data.
- **Inner** (gated on `pinnedVersion != null`): `[listBlocks, listMiniProjects]` — version-scoped.

Assets are **run-scoped**, not version-scoped (a run keeps its assets even if the pinned version is removed). So `listRunAssets(rid)` joins the **outer** batch:

```ts
const [r, vs, ts, gs, ss, assetList] = await Promise.all([
  getRun(rid), listVersions(courseId), listRunTeachers(rid),
  listGroups(rid), listRunStudents(rid), listRunAssets(rid),
]);
```

(Variable name `assetList` avoids the `as` TypeScript keyword.) Same all-or-nothing invariant — any rejection fails `loadAll` and renders `loadError`.

### Reference resolution split

- **Backend `is_referenced: bool`** is authoritative — used for:
  - the `?force=true` decision when calling DELETE (single and bulk),
  - the 403 backstop gate on the backend.
- **Client-side scan** computes the per-asset *enumeration*:
  - the "uses N" badge count,
  - the list of referencing MPs in the sub-panel,
  - the Orphan/Referenced filter pill counts (kept consistent with the sub-panel).
- **Scan implementation matches the backend extractor** at `backend/mathion/markdown.py:52-68`, which pulls Markdown image/link targets only (not free-text mentions). Naive `assignment_md.includes(filename)` false-positives prose, code blocks, and substring overlaps (`data.csv` inside `my-data.csv`), drifting away from `is_referenced`. Use the same regex as the backend extractor — match `!\[...\](filename)` and `[...](filename)` patterns scoped to the resolved URL — wrapped in a `$derived`. A small frontend helper `extractAssetRefs(md: string): Set<string>` mirrors `markdown.extract_asset_filenames` (Python). O(assets × MPs × parse), trivial at ~20 of each.
- Filenames are sanitized server-side (`assets.py:sanitize_filename` strips to `[a-z0-9-]`), so URL/markdown escaping is a non-issue.
- Backend `is_referenced` and client scan can briefly drift (e.g., stale MP list after a cascade). Documented in [Accepted gaps](#accepted-gaps). When `miniProjects === null` the badge column renders `—` (unknown), filter counts treat MPs as empty, and the **delete force flag still uses backend `is_referenced`** so the contract holds.

## Data flow

- New `$state` on RunDetailPage: `assets = $state<RunAssetResponse[] | null>(null)`. Reset to null in entry-reset alongside blocks/MPs. Add to the `{:else if ... || assets === null}` loading guard at `RunDetailPage.svelte:277` to prevent tab-button flash.
- **`refetchAssets()`** mirrors `refetchMiniProjects()` (`RunDetailPage.svelte:92-101`):
  - Captures `rid + myToken` at entry.
  - **No** `pinnedAvailable` gate (assets are run-scoped — distinct from `refetchMiniProjects` which IS gated).
  - Post-await re-check `myToken === loadToken && rid === runIdInt` before assigning `assets`.
- **Four callback props** on RunAssetsTab (mirroring the MP tab's prop wiring):
  - `onRefetchAssets(): Promise<void>` — fired after every successful mutation.
  - `onRefetchMiniProjects(): Promise<void>` — fired **alongside** `onRefetchAssets` after force-delete (single or bulk-with-any-referenced) using `await Promise.all([onRefetchAssets(), onRefetchMiniProjects()])` so both `$state` writes settle in the same microtask flush (avoids the assets-new / MPs-old intermediate render). Both refetches capture `loadToken + rid` at entry (each independently); when the parent's `loadToken` changes mid-flight, **both** early-return symmetrically — there's no scenario where one writes and the other doesn't, because they share the ratchet.
  - `onEditMiniProject(mp: MiniProjectResponse): void` — fired when the user clicks `[Edit]` on a referencing MP in the sub-panel. **The Assets tab resolves the MP object from its local `miniProjects` prop and passes the full object** (not just the id) so the parent skips the resolution race. RunDetailPage handles the not-found case (force-delete cascade may have removed the MP between sub-panel render and click) by no-op'ing — the cascade refetch will close the stale sub-panel on its next render.
  - `onReloadRun(): Promise<void>` — fired after a stale-permission 403 from force-delete (see [States & edge cases](#states--edge-cases)). Calls the parent's `loadAll()` so `course.is_admin` (and the rest of the run-detail context) is refreshed. Without this prop the Assets tab has no way to trigger `loadAll` — the function is parent-local at `RunDetailPage.svelte:54-89`.
- **Parent state for cross-tab edit:** `pendingEditTarget = $state<MiniProjectResponse | null>(null)` and `activeTab = $state(...)` on RunDetailPage (existing variable; spec previously named this `currentTab` in error). `onEditMiniProject(mp)` sets `pendingEditTarget = mp`, switches `activeTab = 'mini-projects'`. A new prop on `RunMiniProjectsTab` consumes `pendingEditTarget`:
  - `$effect` watches `pendingEditTarget`; on truthy → set local `modalMode = 'edit'` + `editTarget = pendingEditTarget`, then call `onPendingEditConsumed()` callback so the parent clears `pendingEditTarget` (preventing re-trigger on subsequent tab switches).

## Layout

Columns (left to right):
1. checkbox (bulk-select)
2. filename — clickable → opens GET serve URL in a new tab
3. size — `formatFileSize(bytes)` from `lib/format.ts`
4. uploaded — `formatLocalWithTz(iso)` from `lib/datetime.ts`
5. uploaded_by — `uploaded_by_email` or `—` if null
6. **uses** — clickable disclosure badge. Click toggles an inline sub-panel below the row listing referencing MPs with block title + `[Edit]` action. `—` if `miniProjects === null`.
7. actions — `[↻ Replace]`, `[×]` delete

Above the table:
- **Filter pills** (single-select, button group with `aria-pressed`): `All (N)` / `Orphan (N)` / `Referenced (N)`. Default: All. Pattern matches `frontend/src/components/MarkdownEditor.svelte:253-254`.
- **Sort headers**: `<th aria-sort="ascending|descending|none"><button>` — `aria-sort` lives on the `<th>` per ARIA 1.2; the inner button is the keyboard activator. Activation toggles asc → desc → none. Default sort: filename asc. Sort state **persists across filter changes**.
- **`[+ Upload]` button** (top-right). Entire tab body is also a drop zone. Same `MAX_FILE_SIZE_BYTES` + `ALLOWED_EXTENSIONS` validation from T5a's `AssetSidebar.svelte` (multi-file picker reuses the stop-on-any-invalid pre-pass at `AssetSidebar.svelte:113-127` and the `uploadProgress.current/total` indicator). Drop zone is **decorative for keyboard users**; `[+ Upload]` is the canonical control.
- **Drag-over visual**: dashed border on the table wrapper when populated, on the empty-state CTA container when empty.

Empty states:
- No assets in the run → CTA `No assets yet. Drop files here or click + Upload.`
- Filter narrows to empty → `No orphan assets.` / `No referenced assets.` — distinct from the global empty CTA.

Error banners render at the **top of the tab body** (above filter pills, and below the `versionIsDisabled` / `pinnedAvailable` gating banner if present). Single banner slot, single-instance: newer banners replace older. `role="status"` (implies `aria-live="polite"`) for screen-reader announcement. The overwrite race is documented in Accepted gaps.

## Replace flow

**File picker mechanics:** one hidden `<input type="file">` per tab (single shared input). A `pendingReplaceAssetId = $state<number | null>(null)` tracks which row triggered. `handleReplaceClick(assetId)` sets `pendingReplaceAssetId = assetId` then `.click()`s the input. The `onchange` handler reads `pendingReplaceAssetId`, validates+confirms+PUTs, then resets BOTH `input.value = ''` AND `pendingReplaceAssetId = null` (matching `AssetSidebar.svelte:155-161,313-321` reset pattern). Also wire `oncancel` (HTML spec, Chromium 113+/Safari 16.4+) to reset `pendingReplaceAssetId = null` so an OS dialog-cancel doesn't leave stale state.

Per-row `[↻ Replace]` flow:
1. Click → file picker opens. Picker fires **first**.
2. Client-side validation:
   - Extension must match — lowercase both sides before compare.
   - Size under `MAX_FILE_SIZE_BYTES`.
   - On failure → row-local inline error (red text under the actions cell); no confirm shown.
3. Validation passes → **per-row InlineConfirm** rendered **alongside** the actions cell (mirrors `frontend/src/components/runs/RunMiniProjectsTab.svelte:206-243` pattern: the `[↻ Replace]` / `[×]` stay visible while the confirm is shown in the same `<li>`/cell). **Mutual exclusion** is enforced by a single shared `openConfirm = $state<{ kind: 'replace'; assetId: number } | { kind: 'delete'; assetId: number } | { kind: 'bulk-delete' } | null>(null)` — all three confirm surfaces share the slot, so opening one closes any other (per-row replace, per-row delete, or bulk-strip).
4. Confirm copy: *"Replace `assignment.pdf` (new size: 1.4 MB)? The current content will be overwritten and cannot be recovered. N mini-project(s) that reference this file will continue to point at the new content."* When N=0, omit the trailing sentence.
5. `[Confirm]` → PUT request (with `AbortSignal` from a `pendingReplaceController = new AbortController()`). On 200 → `onRefetchAssets()`, row re-renders with new size + uploaded_at.
6. `[Cancel]` or 422 → close inline confirm, file dropped, controller discarded.
7. **Unmount / runId-change cleanup**: same Svelte 5 `$effect` pattern as the bulk loop — track `runId` explicitly and abort the controller on cleanup:
   ```ts
   $effect(() => {
     runId; // tracked dep
     return () => pendingReplaceController?.abort();
   });
   ```
   Otherwise an in-flight PUT after the user navigates away may still commit server-side (same risk profile as the bulk-delete in-flight gap; documented in Accepted gaps).

## Delete flow

**Orphan (uses === 0):**
- `[×]` → per-row InlineConfirm "Delete this asset?" + `[Confirm]` / `[Cancel]` (alongside actions cell, mirroring RunMiniProjectsTab pattern).
- DELETE without `force` → 204 → `onRefetchAssets()`.

**Referenced (uses > 0):**
- `[×]` → per-row force-confirm view (mirror of T7 mini-project locked path): warning copy + `I understand` checkbox + danger button. Danger button disabled until checkbox checked.
- Warning: *"This asset is referenced by N mini-project(s). Deleting it will leave their `![ref]` markdown broken. This cannot be undone."* (linked to the danger button via `aria-describedby`).
- Danger button **gated client-side on `course.is_admin`** (accessible via `RunDetailPage.svelte:60,82` → `loaded.course.is_admin`). Disabled with tooltip `Only course admins can force-delete a referenced asset.` otherwise.
- Backend re-validates regardless (`require_course_admin_for_run`, `backend/mathion/api/helpers.py:96-105`). 403 backstop on stale session.
- Confirm → DELETE with `?force=true` → 204 → `await Promise.all([onRefetchAssets(), onRefetchMiniProjects()])`.

## Bulk operations

- Header-row checkbox selects all currently-**visible** rows (respects the active filter).
- **Filter change clears the selection** (simplest invariant; user explicitly re-selects after re-filtering). No banner — the empty selection is its own feedback.
- N rows checked → **action strip** below the filter pills: `N selected` + `[Delete N selected]` button. **In-flow placement** (not sticky): the tab body has no scroll container, and the tabs row itself (`RunDetailPage.svelte:322-328`) is not sticky either, so a `position: sticky` strip would float against an empty viewport when the user scrolls past it. At the expected scale (~20 assets) the strip rarely leaves the viewport; if it does, the user scrolls back up to the filter pills. Simpler than introducing a new `--tabs-height` variable + making the tabs row sticky.
- **Mutual exclusion with per-row InlineConfirm:** opening the bulk-confirm strip sets `openConfirm = { kind: 'bulk-delete' }` which closes any open per-row confirm; toggling a row checkbox while a per-row confirm is open also closes it via the same slot.
- Click → InlineConfirm-on-strip with a single confirmation for the batch. Lists "M orphan, N referenced"; force-required if any are referenced; the force-disable + tooltip + `course.is_admin` gate applies the same way.
- Confirm → sequential DELETE per asset, threaded through a single `AbortController`:
  - Bulk controller (`bulkController = new AbortController()`) created on Confirm; its `signal` is threaded into each `deleteRunAsset(..., { signal: bulkController.signal })`.
  - Each iteration **re-checks** `myToken === loadToken && rid === runIdInt` before dispatching the next DELETE; on mismatch the loop calls `bulkController.abort()` and breaks. It still fires a refetch (so the user sees any already-committed deletes) but skips the summary banner — the user navigated away anyway.
  - On unmount OR on `runId` prop change, an `$effect` aborts the controller. **Svelte 5 footgun**: `$effect` cleanup only runs on unmount or when a reactive value *read inside the effect body* changes. RunAssetsTab stays mounted across `runIdInt` changes while `activeTab === 'assets'`, so the effect must explicitly track the `runId` prop:
    ```ts
    $effect(() => {
      runId; // tracked dep — re-runs (and runs cleanup) when parent's runIdInt changes
      return () => bulkController?.abort();
    });
    ```
  - Each DELETE uses its own `force` flag derived from the per-row backend `is_referenced` (NOT the client-side scan — important when MPs are stale).
  - On per-row error (4xx/5xx) the loop continues. `AbortError` is detected and breaks the loop cleanly.
  - Final summary banner (token+rid guarded): `Deleted M of N. Failed: {filename1}, {filename2}. (Refetched.)`
  - If any referenced asset was force-deleted in the batch → `await Promise.all([onRefetchAssets(), onRefetchMiniProjects()])`; otherwise just `await onRefetchAssets()`.

## States & edge cases

| State | UI |
|---|---|
| `pinnedAvailable === false` | Same banner as Mini-projects: "Cannot load — pinned version not found." |
| `versionIsDisabled === true` | `[+ Upload]`, `[↻ Replace]`, `[×]`, bulk-delete strip all disabled with tooltip `This run's course version is disabled.` Row checkboxes also disabled (no selection without an actionable destination). Asset list itself remains readable. |
| `miniProjects === null` | Badge column renders `—`; filter counts treat MPs as empty. Bulk-delete still uses backend `is_referenced` for the force flag, so the contract is safe. Documented in Accepted gaps. |
| `!runIsPublished` | No banner, no gating — uploads to drafts are fine. |
| Force-delete without `course.is_admin` | Danger button disabled with tooltip. Backend 403 as backstop. |
| Force-delete 403 (stale session / role race) | Banner *"You no longer have permission to force-delete. Refresh and retry."* + call `onReloadRun()` callback prop → parent's `loadAll()` so `course.is_admin` and disabled-state catch up. |
| Upload 409 collision | Banner "An asset named '{name}' already exists. Use Replace on the existing row, or rename your file." |
| Replace 422 extension mismatch | Banner "New file must have the same extension as the original ({ext})." Inline confirm closes; no state change ⇒ no refetch. |
| Replace 413 quota exceeded | Banner "Replacing would exceed this run's storage quota by {delta}." Inline confirm closes. |
| Replace 404 mid-flight | Backend's lookup-before-temp-write guarantees no orphan file. Banner: *"This asset was deleted by another user."* → auto-refetch. |
| Cross-user delete race (404, single) | Per-asset row: banner "This asset was deleted by another user." Auto-refetch. |
| Cross-user delete race (404, storm) | First 404 starts a 500ms timer; subsequent 404s within the window are coalesced into a single banner *"Some assets were deleted by another user."* and a single refetch at flush. Mechanism: component-scoped `let storm404Timer: ReturnType<typeof setTimeout> \| null = null; let storm404Seen = 0;`. On 404: increment, start timer if null, on flush fire one refetch + banner, clear timer + counter. On unmount: `clearTimeout(storm404Timer)`. Coalescing key is "any 404 from this tab" (cross-asset). |
| Bulk partial failure | Summary banner: "Deleted M of N. Failed: {list}. (Refetched.)" |
| Bulk delete + runId change mid-loop | `bulkController.abort()` cancels in-flight DELETE; per-iteration guard breaks; no summary banner write. Server-side commits for already-dispatched requests are documented as Accepted gap. |
| In-flight upload + tab unmount | `AbortController.abort()` via the `mounted` flag (T6a pattern). |
| Server-side partial upload | If client aborts after multipart parse, server may persist a DB row. Visible on next refetch; user can delete normally. Accepted gap. |
| Replace lost-update race (concurrent admins) | Last writer wins; no `ETag` / `If-Unmodified-Since`. Accepted gap. |

## Permissions matrix

| Action | Backend gate |
|---|---|
| List assets | `require_run_admin_or_teacher` |
| Upload (POST) | `require_run_admin_or_teacher` |
| Replace (PUT) | `require_run_admin_or_teacher` |
| Delete unreferenced (DELETE no force) | `require_run_admin_or_teacher` |
| Delete referenced (DELETE `?force=true`) | `require_course_admin_for_run` (`backend/mathion/api/helpers.py:96-105`) |

Frontend hides nothing — buttons are visible but disabled with tooltips when the user lacks privileges. Backend is the source of truth (403 backstop).

## Accessibility

- **Force-confirm view**: focus moves to the `I understand` checkbox on open. On cancel, focus returns to the row's `[×]`. On confirm, focus moves to the next row's `[×]`; if the deleted row was the last and the bulk strip is open, focus moves to the strip's primary button; otherwise focus moves to `[+ Upload]`. Danger button has `aria-describedby="warn-{assetId}"` pointing at the warning text.
- **Filter pills**: `<button aria-pressed="true|false">` triplet (single-select toggle group). Pattern at `MarkdownEditor.svelte:253-254`. Keyboard: Tab to focus, Space/Enter to activate.
- **Sort headers**: `<th aria-sort="ascending|descending|none"><button>...</button></th>` — `aria-sort` on the `<th>` per ARIA 1.2 spec; the inner `<button>` is the keyboard activator. Activation cycles asc → desc → none.
- **Drop zone**: decorative for keyboard users. `[+ Upload]` is the canonical control. Drag-over visual is a dashed border; transient, no announcement.
- **Sub-panel disclosure**: `<button aria-expanded="true|false" aria-controls="uses-{assetId}">` on the badge. Esc collapses. Only one sub-panel open at a time (clicking another badge collapses the previous).
- **`[Edit]` link in sub-panel**: blur on click, fire `onEditMiniProject(mp)`. The MP tab's modal opens with its own `FocusTrap`. **Focus return**: when the MP modal closes, focus stays on the MP tab (existing behavior); the user must Tab/click back to Assets manually. Listed in Accepted gaps as a known UX limitation.
- **Banners**: rendered with `role="status"` (implies `aria-live="polite"`).
- **Upload progress**: the `uploadProgress.current/total` text is wrapped in `<div role="status" aria-live="polite">` so screen-reader users hear "Uploading 2 of 5", etc.

## Race / staleness handling

- `loadToken` ratchet on RunDetailPage covers all `$state` writes after `loadAll` (T8 pattern), extended to cover `assets`.
- `refetchAssets()` captures `rid + myToken` at entry; verifies both still match post-await before assigning `assets`.
- **Bulk-delete loop**: `AbortController` threaded through every DELETE; per-iteration guard re-checks `myToken === loadToken && rid === runIdInt`; on mismatch calls `bulkController.abort()` and breaks (no summary write, no refetch). On unmount, an `$effect` cleanup also aborts the controller. Already-committed server-side deletes are accepted (gap).
- **Double-refetch on force-delete**: `await Promise.all([onRefetchAssets(), onRefetchMiniProjects()])` so both writes settle in the same microtask flush. Avoids the intermediate "new assets + stale MPs" render.
- **In-flight upload abort**: `AbortController` tied to the tab's `mounted` flag. Server may persist a partial-state row; surfaces on next refetch (accepted gap).
- **Cross-user 404 storm**: 500ms coalescer (single component-scoped timer + counter, cleared on unmount). Single refetch + banner per window.
- **Client-side scan drift**: depends on `miniProjects` being current. After any MP-tab mutation the modal's `onSaved` chain refetches MPs; the Assets tab's `$derived` re-evaluates the enumeration automatically. After force-delete in the Assets tab, both refetches fire together so the MP tab reflects the cascade.

## Testing scope

**Frontend — `frontend/src/tests/RunAssetsTab.svelte.test.ts` (new):**
- Empty state CTA (global empty)
- Filter pill counts accuracy against a fixture
- Filter pill selection narrows the table (shares fixture with above)
- Filter narrows to empty → "No orphan assets." (distinct from global empty)
- Sort toggle (filename, size, uploaded date) cycles asc → desc → none; sort persists across filter changes
- `$derived` filter counts recompute when `miniProjects` prop updates
- `miniProjects === null` → uses badge renders `—`; filter counts treat as empty
- Upload via **file picker**: success + inline rejection (oversize, wrong extension)
- Upload via **drop zone**: success + inline rejection (oversize, wrong extension) — separate from picker path
- Upload 409 collision banner
- Delete orphan (single + bulk)
- Delete referenced → force-confirm view; checkbox gates danger button
- Force-delete without `course.is_admin` → danger button disabled + tooltip
- Force-delete fires **both** `onRefetchAssets` AND `onRefetchMiniProjects` (via `Promise.all`)
- Bulk delete with backend `is_referenced=true` but client scan returning 0 (stale `miniProjects` fixture) → DELETE still carries `?force=true` (locks the contract that the code reads backend, not the scan)
- Replace: same-extension success
- Replace: `.PDF` accepts `.pdf` and vice versa (case-insensitive client-side ext compare)
- Replace: 422 extension mismatch banner
- Replace: 413 quota-exceeded banner
- Replace: 404 mid-flight → banner + auto-refetch
- Bulk-select action strip: visibility, count, mutual exclusion with per-row InlineConfirm
- Bulk delete with mixed orphan + referenced: each DELETE carries correct `?force` per row
- Bulk delete + runId changes mid-loop → `bulkController.abort()` called, loop breaks, refetch fires, no summary banner write
- Bulk delete + tab unmount mid-loop → `$effect` cleanup fires `bulkController.abort()` (parallel of the upload-unmount test at line cited below)
- Bulk delete + `runId` prop change while tab stays mounted (e.g., navigating between runs while `activeTab === 'assets'`) → `$effect`'s tracked `runId` dep fires cleanup → `bulkController.abort()`
- Bulk delete partial-failure summary banner; refetch settles
- Selection clears on filter change
- 404 on delete (single): per-row banner + auto-refetch
- 404 storm: with `vi.useFakeTimers()`, dispatch 2 × 404 within 400ms → assert single banner + single refetch; advance past 500ms, dispatch another 404, assert a second batch (verifies window reset)
- 404 storm + unmount during window: assert timer cleared, no late refetch fires
- Click "uses N" → sub-panel toggles (open/close); only one open at a time
- `[Edit]` in sub-panel → `onEditMiniProject(mp)` called with full MP object
- In-flight upload + tab unmount → `AbortController.abort()` fires (T6a pattern; mirror `frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts:488`)
- In-flight Replace PUT + tab unmount → `pendingReplaceController.abort()` fires via `$effect` cleanup
- In-flight Replace PUT + runId prop change while tab stays mounted → `$effect`'s tracked `runId` dep fires cleanup → `pendingReplaceController.abort()`
- Force-delete 403 stale session → banner shown + `onReloadRun()` callback called once (parent `loadAll` triggered)
- `versionIsDisabled` banner + all action buttons disabled (parallel of `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts:72-92`)
- `pinnedAvailable === false` banner (mirror `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts:125`)

**Frontend — `frontend/src/tests/RunDetailPage.svelte.test.ts` (extended):**
- 6th tab renders; switching to it shows RunAssetsTab empty state
- `listAssets` fails → whole page renders `loadError` (all-or-nothing invariant)
- `assets === null` loading guard prevents tab-button flash before `loadAll` completes
- Fixtures across `.svelte.test.ts` and `.publish.svelte.test.ts` get a new branch for `/api/runs/{rid}/assets` returning `[]` by default (pre-existing tests don't break)
- New fixture shape (used by tests that exercise the Assets tab): `[{ id, filename, file_size, mime_type, uploaded_at, uploaded_by, uploaded_by_email, is_referenced }]` with at least one orphan and one referenced

**Frontend — `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` (extended):**
- Given `pendingEditTarget = { id: X, ... }` prop, modal mounts in edit mode for that MP
- `onPendingEditConsumed` callback fires so the parent clears `pendingEditTarget`
- Stale `pendingEditTarget` (MP no longer in `miniProjects` list — cascade race) → modal does NOT open; consumed callback still fires to clear the dangling reference

**Frontend — `frontend/src/tests/runAssets.test.ts` (extended; file already exists):**
- New `replaceRunAsset(runId, assetId, file, signal?)` PUT contract test — mirror the 6 wire properties locked by `uploadRunAsset` at lines 37-68: method PUT, URL `/api/runs/{rid}/assets/{aid}`, FormData body with `file`, `credentials: 'include'`, `X-Requested-With: mathion`, no manual `Content-Type`, `signal` threaded
- `deleteRunAsset(runId, assetId, { force: true })` appends `?force=true` querystring
- `deleteRunAsset(runId, assetId, { force: false })` omits querystring
- `deleteRunAsset(runId, assetId, { force: undefined })` omits querystring
- `deleteRunAsset(runId, assetId)` (no options) omits querystring
- `signal` is threaded through delete fetch options

**Backend — `backend/tests/test_run_assets.py` (extended):**
PUT endpoint:
- 200 success with same-extension upload
- 200 success with `.PDF` replacing `.pdf` (case-insensitive)
- 422 on extension mismatch
- 413 on per-file oversize
- 413 on aggregate quota exceeded (size delta enforces correctly)
- 403 on a different run (auth boundary)
- 404 on missing asset; **no orphan temp file on disk**: assert `os.listdir(upload_dir)` count is unchanged pre/post the 404 PUT
- 404 on cross-run asset_id: PUT against `run_A` with an `asset_id` belonging to `run_B` (user authorized on both) → 404 (ownership check fires before temp write); assert no orphan temp file
- File content is actually overwritten (read-after-write assertion)
- `RunAssetReference` rows preserved across replace: **fixture has ≥2 referencing MPs**; assert `select(RunAssetReference.id).where(run_asset_id == aid)` returns the **same set of IDs** pre/post AND the row count is unchanged (forbids both delete-and-reinsert and orphan inserts)
- Returns `is_referenced` recomputed (matches GET behavior)
- Returns `uploaded_by_email` populated

DELETE endpoint (force backstop):
- `?force=true` by non-admin (run-teacher) on referenced asset → 403
- `?force=false` (or omitted) by run-teacher on referenced asset → existing 409 semantics (verifies the gate distinguishes force from non-force)
- `?force=true` by course-admin on referenced asset → 204; cascades `RunAssetReference`

Schema:
- `RunAssetResponse.uploaded_by_email` populated when user row exists
- `RunAssetResponse.uploaded_by_email` is null when `uploaded_by` FK is null (post user-delete SET NULL)
- `RunAssetResponse.uploaded_by_email` is null when `uploaded_by` FK points at a hard-deleted user row (FK still set, user row missing) — `db.scalar(...)` returns None, no raise

## Accepted gaps

- **No version history**: replace overwrites. InlineConfirm warns about irreversibility.
- **Broken refs after force-delete**: an MP's `![alt](filename.pdf)` markdown becomes a dangling ref. The MP modal's preview renders the raw markdown (existing Phase 6 behavior); admin must edit the MP to fix. Both refetches fire on force-delete so the MP tab reflects the cascade promptly.
- **Reference-count drift when `miniProjects` is stale or null**: badge column renders `—` (unknown); filter counts treat MPs as empty. Contract is safe because the **delete force flag uses backend `is_referenced`**, not the scan.
- **In-flight Replace PUT cancellation**: `$effect` cleanup aborts the controller on tab unmount or `runId` prop change, but a PUT already-dispatched server-side may still commit. Same shape as the bulk-delete in-flight gap and the partial-upload gap. Surfaces on next refetch.
- **Replace lost-update race**: two admins replacing the same asset concurrently — last writer wins. No `ETag` / `If-Unmodified-Since`. Same risk profile as other mutation endpoints.
- **Server-side partial upload after client abort**: if client aborts after multipart parse completes, the asset row may persist on the server. Visible on next refetch; user can delete normally.
- **Bulk-delete in-flight abort doesn't roll back the server**: `AbortController.abort()` cancels the client's network wait but a DELETE that's already reached the backend may still commit. Same shape as the partial-upload gap. Surfaces on next refetch.
- **Cross-tab consistency from a peer browser session**: if user B (different session) force-deletes an asset, user A's open Assets tab is stale until their next refetch trigger or page reload. No real-time sync.
- **Banner overwrite race**: single banner slot; a 404 within ms of a 409 may clobber the 409 before the user reads it. Acceptable: banner replacement is the simplest model and matches existing patterns in the codebase.
- **`[Edit]` cross-tab focus return**: clicking `[Edit]` in the Assets sub-panel switches to the MP tab and opens the modal. On modal close, focus stays on the MP tab; user must navigate back to Assets manually. Acceptable for the audit workflow.
- **No upload progress percentage**: inherits T5a's `uploadProgress.current/total` (count-of-files), not per-file byte progress.
- **N+1 query on list endpoint for `uploaded_by_email`**: ~20 queries per asset list call at typical scale. Acceptable; optimize to `outerjoin(User, ...)` if profiling later shows it hot.

## Slice boundary

Single slice. Backend: one new endpoint (PUT replace) + one schema field (`uploaded_by_email` populated post-hoc; default `None` so the existing POST and GET sites pass validation without changes — populate at all three response sites). Frontend: one new component (`RunAssetsTab.svelte`), one new lib helper (`replaceRunAsset`), one extension to an existing helper (`deleteRunAsset` + optional `force` + `signal`), one new helper `extractAssetRefs(md): Set<string>` matching `backend/mathion/markdown.py:52-68`, one new tab + state + **four** callback props on RunDetailPage (`onRefetchAssets`, `onRefetchMiniProjects`, `onEditMiniProject`, `onReloadRun`). Plus a small `RunMiniProjectsTab.svelte` change to consume `pendingEditTarget` from the parent.

If this turns out larger than expected during planning, the natural sub-slice to defer is the **Replace flow + PUT endpoint** (and the `replaceRunAsset` wrapper). The audit/cleanup/upload features stand on their own; replace can ship as a follow-up without changing any of the upload/delete/sub-panel/filter/sort surface.
