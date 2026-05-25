# Run-Assets Management Design

**Date:** 2026-05-25
**Status:** Draft — awaiting user review

## Goal

Add a standalone Assets management surface to `RunDetailPage` so admins and teachers can audit, clean up, pre-upload, and replace files attached to a run — independent of the per-MP modal sidebar that exists today.

## Non-goals

- **Renaming an asset** — would invalidate all `RunAssetReference` rows and require coordinated rewrite of every MP's `assignment_md`. Out of scope.
- **Asset preview inline** — clicking a filename uses the existing GET serve URL in a new tab; no inline PDF/image viewer.
- **Asset download as zip / bulk-download** — not asked for, not in scope.
- **Per-asset version history** — replace overwrites; no audit trail of past versions.
- **Tagging / metadata fields** — assets carry only `filename`, `size`, `mime_type`, `uploaded_at`, `uploaded_by`.

## Architecture

**Surface:** New `Assets` tab on `RunDetailPage` (6th button, after Mini-projects). Same `role="tab"` + `aria-selected` pattern as the other five.

**Component:** `RunAssetsTab.svelte`, sibling of `RunMiniProjectsTab.svelte`.

**Backend extension:** One new endpoint —
```
PUT /api/runs/{run_id}/assets/{asset_id}
```
Accepts multipart upload. Preserves the existing row's `filename` (incoming file's name is ignored). Validates the incoming file's extension matches the existing asset's extension (422 otherwise). Atomic file write (temp → rename). Updates `file_size`, `mime_type`, `uploaded_at`, `uploaded_by`. `RunAssetReference` rows untouched. Returns the updated `RunAssetResponse`.

Permissions: `require_run_admin_or_teacher` (same gate as POST/DELETE-without-force).

No change to `RunAssetResponse` shape. The existing `is_referenced: bool` (set by the backend from `RunAssetReference` joins) is the authoritative flag used for:
- the `?force=true` decision when deleting (bulk and single)
- the 403 backstop check on the backend

The per-asset reference *enumeration* (count for the "uses N" badge + the list of referencing MPs shown in the sub-panel) is computed CLIENT-SIDE by scanning each MP's `assignment_md` for the asset's filename — O(assets × MPs), trivial at typical scale of ~20 each, wrapped in a `$derived`. The Orphan/Referenced filter pill counts are derived from the same client-side scan so they stay consistent with the sub-panel.

Backend `is_referenced` and client-side scan can briefly drift if the MP list is stale (e.g., between a force-delete cascade on the backend and the next MP refetch). Documented in [Accepted gaps](#accepted-gaps).

## Data flow

- `RunDetailPage.loadAll` extends its inner Promise.all from `[listBlocks, listMiniProjects]` to `[listBlocks, listMiniProjects, listRunAssets]` — same all-or-nothing invariant as T8.
- New `$state` on RunDetailPage: `assets = $state<RunAssetResponse[] | null>(null)`. Reset to null in the entry-reset alongside blocks/MPs. Loading guard at `{:else if ... || assets === null}` prevents tab-button flash.
- New helper `refetchAssets()` mirrors `refetchMiniProjects()` exactly: capture `rid + loadToken` at entry, post-await re-check before write. Threaded into RunAssetsTab as `onRefetchAssets`.
- On mutations inside the tab, `onRefetchAssets()` is fired. The T9 smoke catch pattern of firing a refetch on 404 inside the modal applies here too (replace 404 + delete 404).

## Layout

Columns (left to right):
1. checkbox (bulk-select)
2. filename — clickable → opens GET serve URL in a new tab
3. size — `formatFileSize(bytes)` from `lib/format.ts`
4. uploaded — `formatLocalWithTz(iso)` from `lib/datetime.ts`
5. uploaded_by — user email or `—` if null
6. **uses** — clickable badge (count). Click expands an inline sub-panel below the row listing referencing MPs with block title + `[Edit]` action that calls `onNavigateToTab('mini-projects')` and (via parent) sets the modal's `editTarget`.
7. actions — `[↻ Replace]`, `[×]` delete

Above the table:
- Filter pills (single-select): `All (N)` / `Orphan (N)` / `Referenced (N)`. Default: All.
- Sort toggle on any column header (default: filename asc).
- `[+ Upload]` button (top-right). Entire tab body is also a drop zone with the same `MAX_FILE_SIZE_BYTES` + `ALLOWED_EXTENSIONS` validation from T5a.

Empty state:
- No assets in the run → CTA `No assets yet. Drop files here or click + Upload.`
- Filter narrows to empty → `No orphan assets.` (etc.) — not the global empty CTA.

## Replace flow

Per-row `[↻ Replace]` → file picker. Picked file →
- Validated client-side: same extension as the existing asset, size under MAX_FILE_SIZE_BYTES.
- InlineConfirm: *"Replace `assignment.pdf`? The current content will be overwritten and cannot be recovered. N mini-project(s) that reference this file will continue to point at the new content."*
- Confirm → PUT request. On 200 → refetch, row re-renders with new size + uploaded_at.

Filename of the picked file is ignored — the backend always stores under the existing asset's filename so refs survive.

## Delete flow

**Orphan (uses === 0):**
- `[×]` → simple InlineConfirm "Delete this asset?" + `[Confirm]`/`[Cancel]`.
- DELETE without `force` → 204 → refetch.

**Referenced (uses > 0):**
- `[×]` → force-confirm view (mirror of T7 mini-project locked path): warning copy + `I understand` checkbox + danger button. Danger button disabled until checkbox checked.
- Warning copy: *"This asset is referenced by N mini-project(s). Deleting it will leave their `![ref]` markdown broken. This cannot be undone."*
- Danger button gated client-side on `course.is_admin` (shown disabled with tooltip `Only course admins can force-delete a referenced asset.` otherwise). Backend re-validates regardless (403 backstop).
- Confirm → DELETE with `?force=true` → 204 → refetch.

## Bulk operations

- Header-row checkbox selects all currently-visible rows (respects the active filter).
- N rows checked → sticky action strip below the filter pills: `N selected` + `[Delete selected]` button.
- Click → InlineConfirm-on-strip with a single confirmation for the batch. Lists how many are orphan vs referenced; force-required if any are referenced; the force-disable + tooltip applies the same gate.
- Confirm → sequential DELETE per asset (each with its own `force` flag derived from `is_referenced`). On per-row error, the loop continues. Summary banner after completion: `Deleted M of N. Failed: {filename1}, {filename2}.`

## States & edge cases

| State | UI |
|---|---|
| `pinnedAvailable === false` | Same banner as Mini-projects: "Cannot load — pinned version not found." (Assets are run-scoped, not version-scoped, but the Assets tab is meaningless without a working run shell.) |
| `versionIsDisabled === true` | `[+ Upload]`, `[↻ Replace]`, `[×]` all disabled with tooltip `This run's course version is disabled.` Bulk-delete strip also disabled. (Assets are still readable / inspectable.) |
| `!runIsPublished` | No banner, no gating — uploads to drafts are fine. |
| Force-delete without `course.is_admin` | Danger button disabled with tooltip. Backend 403 as backstop. |
| Upload 409 collision | Banner "An asset named '{name}' already exists. Use Replace on the existing row, or rename your file." |
| Replace 422 extension mismatch | Banner "New file must have the same extension as the original ({ext})." Inline confirm closes; no refetch needed (no state change). |
| Cross-user delete race (404) | Per-asset row: banner "This asset was deleted by another user." Auto-refetch. |
| Bulk partial failure | Summary banner: "Deleted M of N. Failed: {list}." Refetch settles to actual server state. |
| In-flight upload + tab unmount | `AbortController.abort()` via the `mounted` flag (T6a pattern). |
| Race: upload → navigate away mid-flight | `refetchAssets`'s `loadToken + rid` guard drops the stale write (T8 pattern). |

## Permissions matrix

| Action | Role required (backend) |
|---|---|
| List assets | run-teacher OR course-admin |
| Upload | run-teacher OR course-admin |
| Replace | run-teacher OR course-admin |
| Delete unreferenced | run-teacher OR course-admin |
| Delete referenced (force=true) | **course-admin only** |

Frontend hides nothing — buttons are visible but disabled with tooltip when the user lacks force-delete privileges. Backend is the source of truth (403 backstop).

## Race / staleness handling

- `loadToken` ratchet on RunDetailPage covers all $state writes after loadAll (T8 pattern, extended to cover `assets`).
- `refetchAssets()` captures `rid + myToken` at entry; verifies both still match post-await before assigning `assets`.
- The "client-side reference resolution" depends on `miniProjects` being current. After any MP-tab mutation, the modal's `onSaved` chain refetches MPs; the Assets tab's `$derived` re-evaluates `is_referenced` automatically from the new MP list.
- Force-delete cascades `RunAssetReference` server-side; the next refetch on the Mini-projects tab will show MPs with broken refs (rendered as raw markdown). Documented in the force-confirm warning copy.

## Testing scope

**Frontend:**

- `RunAssetsTab.svelte.test.ts` — new. Covers:
  - Empty state CTA
  - Filter pill counts + filter selection narrows the table
  - Sort toggle (filename, size, uploaded date)
  - Upload success + inline rejection (oversize, wrong extension)
  - Upload 409 collision banner
  - Delete orphan (single + bulk)
  - Delete referenced → force-confirm view + checkbox gates danger button
  - Force-delete without `course.is_admin` → danger button disabled + tooltip
  - Replace flow: same-extension success + 422 extension mismatch
  - Bulk-select action strip + partial-failure summary
  - Click "uses N" → sub-panel lists referencing MPs with Edit link
  - 404 on delete or replace → banner + auto-refetch

- `RunDetailPage.svelte.test.ts` — extended:
  - 6th tab renders; switching to it shows RunAssetsTab empty state
  - listAssets fails → whole page renders loadError (all-or-nothing invariant)
  - Fixtures across both `.svelte.test.ts` and `.publish.svelte.test.ts` get a new branch for `/api/runs/{rid}/assets`

- `lib/runAssets.test.ts` — new wrapper `replaceRunAsset(runId, assetId, file)` tests the PUT contract.

**Backend:**

- `test_run_assets.py` — new tests for PUT endpoint:
  - 200 success with same extension
  - 422 on extension mismatch
  - 422 on oversize
  - 403 on a different run (auth boundary)
  - 404 on missing asset
  - File content is actually overwritten (read-after-write assertion)
  - `RunAssetReference` rows preserved across replace

## Accepted gaps

- **No version history**: replace overwrites. If a user needs to recover an earlier version, they need a manual backup before clicking replace. The InlineConfirm warns about irreversibility.
- **Broken refs after force-delete**: an MP's `![alt](filename.pdf)` markdown becomes a dangling ref. The MP modal's preview will render the raw markdown (existing Phase 6 behavior); admin must edit the MP to fix. Documented in the force-confirm warning.
- **Reference resolution drift**: if the local MP list is stale, the orphan/referenced filter counts are stale until the next MP refetch. Mitigation: after force-delete, the existing T9 smoke-catch pattern in MiniProjectModal refetches the MP list; for the standalone Assets-tab flow, we explicitly refetch MPs alongside assets when force-delete completes.

## Slice boundary

Single slice. One backend endpoint (PUT replace). One new frontend component (RunAssetsTab.svelte). One new tab on RunDetailPage. Extensions to existing tests. No new lib helpers beyond `replaceRunAsset` (PUT wrapper).

If this turns out larger than expected during planning, the replace flow (Section 2b) is the natural sub-slice to defer — the audit/cleanup/upload features stand on their own, and replace can be a follow-up.
