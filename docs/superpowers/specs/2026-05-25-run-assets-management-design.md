# Run-Assets Management Design

**Date:** 2026-05-25
**Status:** Draft — under review (rev. 2 after 5-reviewer pass)

## Goal

Add a standalone Assets management surface to `RunDetailPage` so admins and teachers can audit, clean up, pre-upload, and replace files attached to a run — independent of the per-MP modal sidebar that exists today.

## Non-goals

- **Renaming an asset** — would invalidate all `RunAssetReference` rows and require coordinated rewrite of every MP's `assignment_md`. Out of scope.
- **Asset preview inline** — clicking a filename uses the existing GET serve URL in a new tab; no inline PDF/image viewer.
- **Asset download as zip / bulk-download** — not asked for, not in scope.
- **Per-asset version history** — replace overwrites; no audit trail of past versions.
- **Tagging / metadata fields** — assets carry only `filename`, `size`, `mime_type`, `uploaded_at`, `uploaded_by`.

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
  2. Validate incoming extension matches the existing asset's extension — **case-insensitive** (lowercase both sides before compare; 422 otherwise).
  3. Validate per-file size (`MAX_FILE_SIZE_BYTES`).
  4. Validate per-run aggregate (`MAX_COURSE_SIZE`) using **delta** (`new_size - old_size`) so a small replace can't push the run over quota; 413 otherwise.
  5. Write temp file (`tempfile.mkstemp`).
  6. Atomic `os.replace` from temp → final path under the **existing** filename.
  7. Update `file_size`, `mime_type`, `uploaded_at`, `uploaded_by`; commit.
  8. `RunAssetReference` rows untouched (sync intentionally skipped — filename unchanged ⇒ refs still valid).
  9. Return updated `RunAssetResponse` with `is_referenced` recomputed (consistent with GET).

The incoming file's name is ignored — backend always stores under the existing row's filename so all references survive.

**2. Schema extension:** `RunAssetResponse.uploaded_by_email: str | None`
- Today's `uploaded_by: int | None` (the user ID) is unhelpful to teachers. Add a server-side join on `users.email`. Null when: (a) the user row was deleted (`ondelete="SET NULL"`), (b) the column was nullable before this feature, (c) system upload.
- Backend join lives in the existing `RunAssetResponse.from_model` (or equivalent) constructor; no new endpoint.
- Frontend type in `lib/types.ts` extended in lock-step.

### Frontend lib helpers

- **New:** `replaceRunAsset(runId: number, assetId: number, file: File): Promise<RunAssetResponse>` in `frontend/src/lib/runAssets.ts`. Wraps the new PUT.
- **Extend existing:** `deleteRunAsset(runId, assetId, options?: { force?: boolean })`. Currently has no `force` arg (`frontend/src/lib/runAssets.ts:60`). Appends `?force=true` querystring when set. Also update `assetContext.ts:42` adapter signature.

### GET serve URL (clickable filename)

The existing GET endpoint is keyed by **filename**, not asset_id: `GET /api/runs/{rid}/assets/{filename}`. Clicking the filename column opens this URL in a new tab. Because filename is preserved across replace, the URL is **stable** — bookmarkable, linkable from markdown.

### `loadAll` placement (outer batch, run-scoped)

`RunDetailPage.loadAll` has two Promise.all batches:
- **Outer** (`RunDetailPage.svelte:62-79`): `[getRun, listVersions, listRunTeachers, listGroups, listRunStudents]` — run-scoped data.
- **Inner** (gated on `pinnedVersion != null`): `[listBlocks, listMiniProjects]` — version-scoped.

Assets are **run-scoped**, not version-scoped (a run keeps its assets even if the pinned version is removed). So `listRunAssets(rid)` joins the **outer** batch:

```ts
const [r, vs, rts, gs, rs, as] = await Promise.all([
  getRun(rid), listVersions(courseId), listRunTeachers(rid),
  listGroups(rid), listRunStudents(rid), listRunAssets(rid),
]);
```

Same all-or-nothing invariant — any rejection fails `loadAll` and renders `loadError`.

### Reference resolution split

- **Backend `is_referenced: bool`** is authoritative — used for:
  - the `?force=true` decision when calling DELETE (single and bulk),
  - the 403 backstop gate on the backend.
- **Client-side scan** computes the per-asset *enumeration*:
  - the "uses N" badge count,
  - the list of referencing MPs in the sub-panel,
  - the Orphan/Referenced filter pill counts (kept consistent with the sub-panel).
- Scan is `assignment_md.includes(filename)` per (asset × MP) — cheap; O(assets × MPs) trivial at ~20 each. Wrapped in `$derived`.
- Filenames are sanitized server-side (`assets.py:sanitize_filename` strips to `[a-z0-9-]`), so URL/markdown escaping is a non-issue.
- Backend `is_referenced` and client scan can briefly drift (e.g., stale MP list after a cascade). Documented in [Accepted gaps](#accepted-gaps).

## Data flow

- New `$state` on RunDetailPage: `assets = $state<RunAssetResponse[] | null>(null)`. Reset to null in entry-reset alongside blocks/MPs. Add to the `{:else if ... || assets === null}` loading guard at `RunDetailPage.svelte:277` to prevent tab-button flash.
- **`refetchAssets()`** mirrors `refetchMiniProjects()` exactly:
  - Captures `rid + myToken` at entry.
  - **No** `pinnedAvailable` gate (assets are run-scoped — distinct from `refetchMiniProjects` which IS gated).
  - Post-await re-check `myToken === loadToken && rid === runIdInt` before assigning `assets`.
- **Three callback props** on RunAssetsTab (mirroring the MP tab's prop wiring):
  - `onRefetchAssets()` — fired after every successful mutation (upload, replace, delete, bulk-delete).
  - `onRefetchMiniProjects()` — fired **additionally** after successful force-delete (single or bulk-with-any-referenced) so the MP tab reflects newly-broken refs.
  - `onEditMiniProject(mpId: number)` — fired when the user clicks `[Edit]` on a referencing MP in the sub-panel. RunDetailPage owns `pendingEditMpId = $state<number | null>(null)` and a `currentTab = $state(...)` switch; on `onEditMiniProject(id)`, it sets `pendingEditMpId = id`, switches `currentTab = 'mini-projects'`, and the existing RunMiniProjectsTab consumes `pendingEditMpId` via a new prop (open the modal in edit mode + clear the pending id).

## Layout

Columns (left to right):
1. checkbox (bulk-select)
2. filename — clickable → opens GET serve URL in a new tab
3. size — `formatFileSize(bytes)` from `lib/format.ts`
4. uploaded — `formatLocalWithTz(iso)` from `lib/datetime.ts`
5. uploaded_by — `uploaded_by_email` or `—` if null
6. **uses** — clickable disclosure badge. Click toggles an inline sub-panel below the row listing referencing MPs with block title + `[Edit]` action.
7. actions — `[↻ Replace]`, `[×]` delete

Above the table:
- **Filter pills** (single-select, button group with `aria-pressed`): `All (N)` / `Orphan (N)` / `Referenced (N)`. Default: All.
- **Sort headers**: button inside `<th>` with `aria-sort="ascending"|"descending"|"none"`. Default sort: filename asc. Sort state **persists across filter changes**.
- **`[+ Upload]` button** (top-right). Entire tab body is also a drop zone (drag-over highlight: dashed border on the table wrapper). Same `MAX_FILE_SIZE_BYTES` + `ALLOWED_EXTENSIONS` validation from T5a's `AssetSidebar.svelte`. Multi-file upload uses the pattern at `AssetSidebar.svelte:113-127` (stop-on-any-invalid pre-pass, then `uploadProgress.current/total` indicator). Drop zone is **decorative for keyboard users**; `[+ Upload]` is the canonical control.

Empty states:
- No assets in the run → CTA `No assets yet. Drop files here or click + Upload.`
- Filter narrows to empty → `No orphan assets.` / `No referenced assets.` — distinct from the global empty CTA.

Error banners render at the **top of the tab** (above filter pills), single-instance, matching `RunMiniProjectsTab.svelte:158 deleteError` pattern. `aria-live="polite"` for screen-reader announcement.

## Replace flow

Per-row `[↻ Replace]` button → triggers a hidden `<input type="file">` (one input per row, or a single shared input rebound to the row's assetId; the latter is simpler).

1. User picks a file. Picker fires **first**.
2. Client-side validation:
   - Extension must match (case-insensitive: lowercase both sides).
   - Size under `MAX_FILE_SIZE_BYTES`.
   - On failure → row-local inline error (e.g., red text under the actions cell); no confirm shown.
3. Validation passes → **per-row InlineConfirm** rendered inline (in the actions cell, replacing the `[↻ Replace]` / `[×]` buttons during confirm). Mirrors `RunMiniProjectsTab.svelte:233-243` anchor pattern.
4. Confirm copy: *"Replace `assignment.pdf` (new size: 1.4 MB)? The current content will be overwritten and cannot be recovered. N mini-project(s) that reference this file will continue to point at the new content."* When N=0, omit the trailing sentence.
5. `[Confirm]` → PUT request. On 200 → `onRefetchAssets()`, row re-renders with new size + uploaded_at.
6. `[Cancel]` or 422 → close inline confirm, file dropped.

## Delete flow

**Orphan (uses === 0):**
- `[×]` → per-row InlineConfirm "Delete this asset?" + `[Confirm]` / `[Cancel]` (replaces actions cell).
- DELETE without `force` → 204 → `onRefetchAssets()`.

**Referenced (uses > 0):**
- `[×]` → per-row force-confirm view (mirror of T7 mini-project locked path): warning copy + `I understand` checkbox + danger button. Danger button disabled until checkbox checked.
- Warning: *"This asset is referenced by N mini-project(s). Deleting it will leave their `![ref]` markdown broken. This cannot be undone."* (linked to the danger button via `aria-describedby`).
- Danger button **gated client-side on `course.is_admin`** (verified accessible via `RunDetailPage.svelte:60,82` → `loaded.course.is_admin`). Disabled with tooltip `Only course admins can force-delete a referenced asset.` otherwise.
- Backend re-validates regardless (`require_course_admin_for_run`, `backend/mathion/api/helpers.py:96-105`). 403 backstop on stale session.
- Confirm → DELETE with `?force=true` → 204 → `onRefetchAssets()` **and** `onRefetchMiniProjects()`.

## Bulk operations

- Header-row checkbox selects all currently-**visible** rows (respects the active filter).
- **Filter change clears the selection** (decision: simplest invariant; user explicitly re-selects after re-filtering).
- N rows checked → **sticky action strip** below the filter pills: `N selected` + `[Delete N selected]` button. Sticky scope: `position: sticky; top: 0` within the tab content panel (NOT the page) so it stays visible during long lists but doesn't overlap the tab buttons.
- **Mutual exclusion with per-row InlineConfirm:** if a per-row InlineConfirm is open when the user toggles a row checkbox, the per-row confirm closes silently (file/intent dropped). Inverse: opening the bulk-confirm strip closes any open per-row confirm.
- Click → InlineConfirm-on-strip with a single confirmation for the batch. Lists "M orphan, N referenced"; force-required if any are referenced; the force-disable + tooltip + `course.is_admin` gate applies the same way.
- Confirm → sequential DELETE per asset:
  - Each iteration **re-checks** `myToken === loadToken && rid === runIdInt` before dispatching the next DELETE; breaks out on mismatch (no summary write, no refetch — the ratchet will handle the stale state).
  - Each DELETE uses its own `force` flag derived from the per-row `is_referenced` (backend field, not the client-side scan).
  - On per-row error (4xx/5xx) the loop continues.
  - Final summary banner (token+rid guarded): `Deleted M of N. Failed: {filename1}, {filename2}. (Refetched.)`
  - If any referenced asset was force-deleted in the batch → also fire `onRefetchMiniProjects()`.

## States & edge cases

| State | UI |
|---|---|
| `pinnedAvailable === false` | Same banner as Mini-projects: "Cannot load — pinned version not found." (Assets are run-scoped, but the tab is meaningless without a working run shell.) |
| `versionIsDisabled === true` | `[+ Upload]`, `[↻ Replace]`, `[×]`, bulk-delete strip all disabled with tooltip `This run's course version is disabled.` Row checkboxes also disabled (no selection without an actionable destination). Asset list itself remains readable. |
| `miniProjects === null` (load failure path) | The `$derived` filter counts treat MPs as empty → every asset appears as orphan. Bulk-delete still uses backend `is_referenced` for the force flag (not the client-side scan), so the contract is safe. Documented in Accepted gaps. |
| `!runIsPublished` | No banner, no gating — uploads to drafts are fine. |
| Force-delete without `course.is_admin` | Danger button disabled with tooltip. Backend 403 as backstop. |
| Force-delete 403 (stale session / role race) | Banner *"You no longer have permission to force-delete. Refresh and retry."* + auto-refetch of the run-detail context (so the disabled state catches up). |
| Upload 409 collision | Banner "An asset named '{name}' already exists. Use Replace on the existing row, or rename your file." |
| Replace 422 extension mismatch | Banner "New file must have the same extension as the original ({ext})." Inline confirm closes; no state change ⇒ no refetch. |
| Replace 413 quota exceeded | Banner "Replacing would exceed this run's storage quota by {delta}." Inline confirm closes. |
| Replace 404 mid-flight | Backend's lookup-before-temp-write guarantees no orphan file. Banner: *"This asset was deleted by another user."* → auto-refetch. |
| Cross-user delete race (404, single) | Per-asset row: banner "This asset was deleted by another user." Auto-refetch. |
| Cross-user delete race (404, storm) | First 404 fires one refetch; subsequent 404s within 500ms are coalesced into a single banner *"Some assets were deleted by another user."* (Mitigates N-banner thrash during another admin's bulk delete.) |
| Bulk partial failure | Summary banner: "Deleted M of N. Failed: {list}. (Refetched.)" |
| Bulk delete + runId change mid-loop | Per-iteration token guard breaks out; no summary banner write; the parent's ratchet handles the new run's state. |
| In-flight upload + tab unmount | `AbortController.abort()` via the `mounted` flag (T6a pattern). |
| Server-side partial upload | If client aborts after the multipart parse completes, the server may persist a DB row. This will appear on next refetch; user can delete normally. Documented in Accepted gaps. |
| Replace lost-update race (concurrent admins) | Last writer wins; no `ETag` / `If-Unmodified-Since`. Documented in Accepted gaps. |

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

- **Force-confirm view**: focus moves to the `I understand` checkbox on open. On cancel, focus returns to the row's `[×]`. On confirm, focus moves to the next row's `[×]` (or to the bulk strip if the row was the last). Danger button has `aria-describedby="warn-{assetId}"` pointing at the warning text.
- **Filter pills**: `<button aria-pressed="true|false">` triplet (single-select toggle group). Keyboard: Tab to focus, Space/Enter to activate.
- **Sort headers**: `<th><button aria-sort="ascending|descending|none">` — activation toggles ascending → descending → none. Keyboard works as a normal button.
- **Drop zone**: decorative for keyboard users. `[+ Upload]` is the canonical control. Drag-over visual is a dashed border on the table wrapper; no announcement needed (transient, mouse-only).
- **Sub-panel disclosure**: `<button aria-expanded="true|false" aria-controls="uses-{assetId}">` on the badge. Esc collapses. Only one sub-panel open at a time (clicking another badge collapses the previous).
- **Banners**: rendered with `role="status" aria-live="polite"` so screen readers announce them without interrupting input.
- **`[Edit]` link in sub-panel**: on click, blur, fire `onEditMiniProject(mpId)`. The MP tab's modal opens with its own FocusTrap; focus transfers there.

## Race / staleness handling

- `loadToken` ratchet on RunDetailPage covers all `$state` writes after `loadAll` (T8 pattern), now extended to cover `assets`.
- `refetchAssets()` captures `rid + myToken` at entry; verifies both still match post-await before assigning `assets`.
- **Bulk-delete loop**: re-checks `myToken === loadToken && rid === runIdInt` before each iteration; breaks out (no summary write, no refetch) on mismatch.
- **In-flight upload abort**: `AbortController` tied to the tab's `mounted` flag. Server may persist a partial-state row; surfaces on next refetch (accepted gap).
- **Cross-user 404 storm**: 404 handler coalesces refetches within a 500ms window; banner is single-instance.
- **Client-side scan drift**: depends on `miniProjects` being current. After any MP-tab mutation the modal's `onSaved` chain refetches MPs; the Assets tab's `$derived` re-evaluates the enumeration automatically. After force-delete in the Assets tab, both `onRefetchAssets` and `onRefetchMiniProjects` fire so the MP tab reflects the cascade.

## Testing scope

**Frontend — `RunAssetsTab.svelte.test.ts` (new):**
- Empty state CTA (global empty)
- Filter pill **counts** accuracy against a known fixture
- Filter pill **selection** narrows the table
- Filter narrows to empty → "No orphan assets." (distinct from global empty)
- Sort toggle (filename, size, uploaded date) cycles asc → desc → none; sort persists across filter changes
- `$derived` filter counts recompute when `miniProjects` updates
- Upload via **file picker**: success + inline rejection (oversize, wrong extension)
- Upload via **drop zone**: success + inline rejection (oversize, wrong extension) — separate from picker path
- Upload 409 collision banner
- Delete orphan (single + bulk)
- Delete referenced → force-confirm view; checkbox gates danger button
- Force-delete without `course.is_admin` → danger button disabled + tooltip
- Force-delete fires **both** `onRefetchAssets` AND `onRefetchMiniProjects`
- Replace: same-extension success (case-sensitive: `.PDF` accepts `.pdf` and vice versa)
- Replace: 422 extension mismatch banner
- Replace: 413 quota-exceeded banner
- Replace: 404 mid-flight → banner + auto-refetch
- Bulk-select action strip: visibility, count, mutual exclusion with per-row InlineConfirm
- Bulk delete with **mixed** orphan + referenced: each DELETE carries correct `?force` per `is_referenced`
- Bulk delete + runId changes mid-loop → loop breaks, no summary banner write (loadToken guard)
- Bulk delete partial-failure summary banner; refetch settles
- Selection clears on filter change
- 404 on delete: per-row banner + auto-refetch
- 404 storm: ≥2 404s within 500ms → coalesced into one banner + one refetch
- Click "uses N" → sub-panel toggles (open/close); only one open at a time
- `[Edit]` in sub-panel → `onEditMiniProject(mpId)` called
- In-flight upload + tab unmount → `AbortController.abort()` fires (T6a pattern, mirrors `MiniProjectModal.create-edit.svelte.test.ts:488`)
- `versionIsDisabled` banner + all action buttons disabled (parallel of `RunMiniProjectsTab.svelte.test.ts:72-92`)
- `pinnedAvailable === false` banner (mirror `RunMiniProjectsTab.svelte.test.ts:125`)

**Frontend — `RunDetailPage.svelte.test.ts` (extended):**
- 6th tab renders; switching to it shows RunAssetsTab empty state
- `listAssets` fails → whole page renders `loadError` (all-or-nothing invariant)
- `assets === null` loading guard prevents tab-button flash before `loadAll` completes
- Fixtures across `.svelte.test.ts` and `.publish.svelte.test.ts` get a new branch for `/api/runs/{rid}/assets` returning `[]` by default (pre-existing tests don't break)
- New fixture shape (used by tests that exercise the Assets tab): `[{ id, filename, file_size, mime_type, uploaded_at, uploaded_by, uploaded_by_email, is_referenced }]` with at least one orphan and one referenced

**Frontend — `runAssets.test.ts` (extended, already exists at `frontend/src/tests/runAssets.test.ts`):**
- New `replaceRunAsset(runId, assetId, file)` PUT contract test
- `deleteRunAsset(runId, assetId, { force: true })` appends `?force=true` querystring; default omits

**Backend — `test_run_assets.py` (extended):**
PUT endpoint:
- 200 success with same-extension upload
- 200 success with `.PDF` replacing `.pdf` (case-insensitive)
- 422 on extension mismatch
- 413 on per-file oversize
- 413 on aggregate quota exceeded (size delta)
- 403 on a different run (auth boundary)
- 404 on missing asset; **no orphan temp file on disk** (lookup precedes temp write)
- File content is actually overwritten (read-after-write assertion)
- `RunAssetReference.id` values are preserved across replace for the same `(asset_id, mp_id)` pairs (compares row IDs pre/post, not just count)
- Returns `is_referenced` recomputed (matches GET behavior)

DELETE endpoint (force backstop):
- `?force=true` by non-admin (run-teacher) on referenced asset → 403
- `?force=false` (or omitted) by run-teacher on referenced asset → 409 (the existing semantics; verifies the gate distinguishes force from non-force)
- `?force=true` by course-admin on referenced asset → 204; cascades `RunAssetReference`

Schema:
- `RunAssetResponse.uploaded_by_email` populated when user row exists
- `RunAssetResponse.uploaded_by_email` is null when user FK is null (post user-delete)

## Accepted gaps

- **No version history**: replace overwrites. The InlineConfirm warns about irreversibility.
- **Broken refs after force-delete**: an MP's `![alt](filename.pdf)` markdown becomes a dangling ref. The MP modal's preview will render the raw markdown (existing Phase 6 behavior); admin must edit the MP to fix. Both `onRefetchAssets` and `onRefetchMiniProjects` fire on force-delete so the MP tab reflects the cascade promptly.
- **Reference-count drift when `miniProjects` is stale or null**: the client-side scan can briefly disagree with backend `is_referenced`. The contract is safe because the **delete force flag uses backend `is_referenced`**, not the scan.
- **Replace lost-update race**: two admins replacing the same asset concurrently — last writer wins. No `ETag` / `If-Unmodified-Since`. Acceptable: same risk profile as other mutation endpoints.
- **Server-side partial upload after client abort**: if the client aborts after the multipart parse completes, the asset row may persist on the server. Visible on next refetch; user can delete normally.
- **No upload progress percentage**: spec inherits T5a's `uploadProgress.current/total` (count-of-files), not per-file byte progress.

## Slice boundary

Single slice. Backend: one new endpoint (PUT replace) + one schema field (`uploaded_by_email` join). Frontend: one new component (`RunAssetsTab.svelte`), one new lib helper (`replaceRunAsset`), one extension to an existing helper (`deleteRunAsset` + `force`), one new tab + state + three callback props on RunDetailPage, extensions to existing test fixtures. Plus a small `RunMiniProjectsTab.svelte` change to consume `pendingEditMpId` from the parent.

If this turns out larger than expected during planning, the natural sub-slice to defer is the **Replace flow + PUT endpoint** (and the `replaceRunAsset` wrapper). The audit/cleanup/upload features stand on their own; replace can ship as a follow-up without changing any of the upload/delete/sub-panel/filter/sort surface.
