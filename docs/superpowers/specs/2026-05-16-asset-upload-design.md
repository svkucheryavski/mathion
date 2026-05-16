# Asset Upload & Media Library — Design

**Date:** 2026-05-16
**Status:** Design (awaiting plan)
**Scope:** Frontend only. Backend asset endpoints are already complete.

## Goal

Give course admins a UI to upload assets (images, PDFs, etc.) and insert
references into markdown content without leaving the editor. Today the backend
exposes `POST /api/versions/{vid}/assets`, `GET /api/versions/{vid}/assets`,
`DELETE /api/assets/{id}`, and `GET /assets/{vid}/{filename}`, all auth-gated
and size/extension-validated, but no UI calls them. Authors who want to embed
an image must currently upload via API and hand-write `![alt](filename.png)` in
the markdown textarea — the bare filename, which `render_with_assets`
server-side rewrites to `/assets/{vid}/{filename}` and tracks via
`AssetReference` rows.

This design adds a right-rail media library inside the existing
`MarkdownEditor` component plus drag-drop on the textarea itself, so insertion
is a single click or drop.

## Non-goals (V1)

These are deliberately deferred to keep V1 shippable:

- Force-delete of referenced assets. (Workflow: remove the reference from
  content_md → save → delete the now-unreferenced asset.)
- Search / filter (by filename, mime type, or referenced status).
- Asset rename or replace. (No backend PUT endpoint exists, and adding one is
  a separate decision.)
- XHR upload progress percentage. Indeterminate spinner only.
- Server-generated thumbnails for non-image previews (PDF first page, etc.).
- Bulk operations (multi-select delete, batch upload reordering).
- Sidebar collapse/expand state persistence (the sidebar is always-on in Edit
  mode).

## Architecture

### Where the feature lives

- **NEW** `frontend/src/components/editor/AssetSidebar.svelte` — version-scoped
  media library component.
  - Props: `versionId: number`, `onInsert: (filename: string, mimeType: string) => void`,
    `refreshKey: number`.
  - Renders the right-rail in Edit mode.
  - Owns: GET listing, file-picker upload, drop-zone upload, per-row
    click-to-insert, per-row delete (only when `!is_referenced`).
- **NEW** `frontend/src/lib/assets.ts` — pure helper module wrapping the
  three asset endpoints via the existing `api` from `lib/api.ts`. Keeps fetch
  + multipart + error mapping out of components.
  - `uploadAsset(versionId, file): Promise<AssetResponse>`
  - `listAssets(versionId): Promise<AssetResponse[]>`
  - `deleteAsset(assetId): Promise<void>`
- **MODIFIED** `frontend/src/components/editor/MarkdownEditor.svelte`:
  - Layout shift: textarea + sidebar side-by-side in Edit mode (textarea
    flex-grow, sidebar fixed ~280px). Preview mode unchanged — full-width
    preview, no sidebar.
  - `insertAtCursor(text, atOffset?)` helper that reads/writes
    `selectionStart`/`selectionEnd` on the textarea ref.
  - `dragover` and `drop` listeners on the textarea. On drop, `preventDefault`,
    compute drop offset via `document.caretPositionFromPoint`, then call
    `uploadAsset` → `insertAtCursor` for each dropped file.
  - `refreshKey: number` prop forwarded to `AssetSidebar` so the parent can
    trigger a list re-fetch after save.
- **MODIFIED** `frontend/src/pages/editor/ItemEditPage.svelte` — bumps
  `refreshKey` after a successful content save so the sidebar's
  `is_referenced` flags re-compute.

### ReadOnly mode

When `MarkdownEditor` is mounted with `readOnly` (disabled version, or
preview-only contexts), the sidebar is **not rendered at all**. There's no
edit cursor to insert into, and the backend 403s upload/delete on disabled
versions anyway. Avoiding the mount also avoids a spurious GET that would
otherwise be ignored.

### Boundary summary

| Concern | Owner |
|---|---|
| Multipart upload + error mapping | `lib/assets.ts` |
| List rendering, thumbnails, click/drop handlers, delete UI | `AssetSidebar.svelte` |
| Textarea selection, cursor, drag-drop position, insertion | `MarkdownEditor.svelte` |
| Save lifecycle, `refreshKey` bump | `ItemEditPage.svelte` (and any future host) |
| Asset reference sync (`AssetReference` rows) | Backend (`render_with_assets`) — unchanged |

## UI / Interaction

### Layout

```
┌─ Edit | Preview ─────────────────────────────────────────────┐
│  ┌──────────────────────────────────┐  ┌────────────────────┐│
│  │                                  │  │  Assets            ││
│  │  <textarea>                      │  │  ┌───┐ ┌───┐ ┌───┐  ││
│  │  (drag-drop target)              │  │  │img│ │img│ │pdf│  ││
│  │                                  │  │  └───┘ └───┘ └───┘  ││
│  │                                  │  │  filename  filename ││
│  │                                  │  │  used      —        ││
│  │                                  │  │  ...                ││
│  │                                  │  │                     ││
│  │                                  │  │  ┌─ Drop here ─┐    ││
│  │                                  │  │  │ or pick file│    ││
│  │                                  │  │  └─────────────┘    ││
│  └──────────────────────────────────┘  └────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

- Textarea: `flex: 1` (grow to fill).
- Sidebar: `flex: 0 0 280px`.
- Preview mode: sidebar `display: none`, preview spans full width.
- Asset row: thumbnail box (image `<img loading="lazy" src="/assets/{vid}/{filename}">` for image mime types; extension chip e.g. `PDF` / `MD` / `TXT` for others) + filename + file size in muted subtitle + a small `used` badge when `is_referenced === true` (no badge otherwise — less visual noise).
- Single click anywhere on the row → insert at the textarea's current cursor.
- Hover reveals a small trash icon on `!is_referenced` rows only. Click →
  confirm via a tiny inline two-state ("Delete?" / "Confirm" buttons) rather
  than a full modal — fits the rail and matches the existing accordion-editor
  aesthetic.
- The bottom of the sidebar contains a labeled drop zone that doubles as the
  file picker: drag a file in OR click it to open a hidden `<input type="file">`.
  Single affordance, two interaction paths.

### Insert format

- Image mime types (`image/png`, `image/jpeg`, `image/svg+xml`, `image/gif`,
  `image/webp`, etc.) → `\n![{stem}]({filename})\n` where `{stem}` is the
  filename minus the extension.
  - Example: `histogram.png` → `\n![histogram](histogram.png)\n`
- Non-image mime types → `\n[{filename}]({filename})\n`.
  - Example: `worksheet.pdf` → `\n[worksheet.pdf](worksheet.pdf)\n`
- Leading and trailing newlines ensure that two consecutive inserts don't end
  up concatenated on the same line. If the cursor is already at the start of
  a blank line, the leading newline is a no-op visually. (No special-casing —
  authors can clean up extra blank lines themselves; markdown renderers
  collapse them.)

### Drop on textarea

- `dragover`: `preventDefault()` (required so `drop` fires). Optional small
  hover style on the textarea border to signal it's a drop target.
- `drop`: `preventDefault()`. Extract `e.dataTransfer.files`. For each file
  (sequentially, not concurrently):
  1. Compute drop offset once at drop time via
     `document.caretPositionFromPoint(e.clientX, e.clientY)`. Fallback: current
     `selectionStart` if the API isn't available (older browsers; we can
     accept this since the editor is admin-only and chromium-class browsers
     all support it).
  2. `uploadAsset(versionId, file)` — `await`.
  3. On success: `insertAtCursor(formatRef(filename, mimeType), atOffset=offset)`.
     Subsequent files in the same drop advance the offset by the length of
     the just-inserted text.
- Sequential, not parallel: a 400 on file 3 of 5 doesn't lose progress on
  files 1 and 2, and error messages can be attributed cleanly. UI shows
  "Uploading file 3 of 5…" if more than one file is being processed.

### Drop on sidebar

- Same `dragover`/`drop` handlers on the sidebar's drop zone. Same upload
  helper. No insertion — the file just appears in the list after upload. User
  clicks to insert later.

### Sort & filter

- Sort: alphabetical by filename, server-side (existing behavior in
  `GET /api/versions/{vid}/assets`). No client-side resort.
- Filter: none in V1.

### Empty / loading / progress / error states

| State | Render |
|---|---|
| Initial load | Small inline spinner at top of sidebar list area |
| Empty list (loaded, zero assets) | "No assets yet. Drop a file in the zone below or click it to pick." |
| Upload in flight | Transient row at top of list: "Uploading {filename}…" with indeterminate spinner. Subsequent drops ignored until done. |
| Upload error (any) | Inline error region at top of sidebar with server's `detail` text, dismissable via `×` |
| Delete error | Same channel as upload error |
| Disabled-version GET / upload error | Inline error "Version is disabled" + disable drop zone + hide trash icons |

## Error handling

### Backend response → UI surface

| Status / detail | UI surface |
|---|---|
| 201 + AssetResponse | List refreshes; the new asset appears at its alphabetical slot |
| 400 "File extension not allowed: {name}" | Inline error verbatim |
| 400 "File size {N} exceeds max {M}" | Inline error verbatim |
| 400 "Total version asset size would exceed limit ({M} bytes)" | Inline error verbatim |
| 400 "No filename provided" | Inline error verbatim (practically unreachable from the DOM file picker / DataTransfer path) |
| 403 "Version is disabled" | Inline error + disable upload UI |
| 409 "Asset '{X}' already exists in this version" | Inline error suggesting "rename and retry". No client-side rename in V1. |
| 500 "Failed to write asset to disk" | Inline error + re-fetch list (backend already rolled back the registry row) |
| Network failure | Inline error "Could not reach server. Check your connection." |

All errors come from the existing `ApiError` class via `lib/api.ts` — the
helper module passes them through unchanged.

### Edge cases

- **Two uploads in flight:** prevented at the UI layer. Drop handler queues
  files sequentially. While an upload is in progress the drop zone shows the
  "Uploading…" state; further drops are ignored. (No client-side queue
  beyond "one in flight, the rest of the current batch awaits in the same
  async loop".)
- **Drop on textarea in Preview mode:** the textarea isn't rendered in
  preview, so no handler exists. Drop on the preview area: no handlers, browser
  default. (Browser navigates to `file://`. That's the existing behavior; not
  our problem to suppress unless reported.)
- **`onInsert` called while textarea has no focus:** insert at the last known
  cursor position. If the textarea has never been focused since mount, insert
  at the very end of its content. `MarkdownEditor` tracks "last known cursor"
  via the standard `selectionStart`/`selectionEnd` snapshot on `blur`.
- **Referenced asset becomes unreferenced after content edit:** the
  `is_referenced` flag reflects `AssetReference` rows server-side. The trash
  icon won't appear until the user saves content_md and the sidebar refreshes
  (via `refreshKey`). Acceptable: matches the "save first, then delete"
  workflow.
- **Disabled-version mid-session:** backend 403s any new upload/delete; the
  inline error appears and the upload zone disables. Existing list rendering
  continues to work since GET doesn't 403 on disabled versions. User can
  re-enable the version and retry.

## Testing approach

### `lib/assets.ts` (vitest, no DOM)

- `uploadAsset` happy path: returns the AssetResponse from a mocked
  `api.post` of `/api/versions/{vid}/assets`.
- `uploadAsset` propagates `ApiError` with status + detail for each error
  class above.
- `listAssets`: returns array; sorted as the backend does (we don't re-sort).
- `deleteAsset`: succeeds on 204; 409 raises `ApiError` with `detail`
  preserved.

### `AssetSidebar.svelte` (vitest + jsdom)

- Renders the list returned by `listAssets` on mount.
- Click on a row calls `onInsert(filename, mimeType)`.
- File picker → calls `uploadAsset` → refreshes list.
- Drop on sidebar drop zone → same upload path.
- Trash icon hidden when `is_referenced === true`; visible (on hover) when
  false. Click → `deleteAsset` → refresh.
- Each error state renders the server's `detail` text verbatim.
- `readOnly` prop: tested via the MarkdownEditor wrapper rather than directly
  (sidebar isn't mounted in readOnly mode; verified at the wrapper level).
- `refreshKey` prop change triggers a re-fetch.

### `MarkdownEditor.svelte` extended tests (vitest + jsdom)

- Existing tests preserved.
- `insertAtCursor`: programmatic call splices at the selection and restores
  cursor position just after the inserted text.
- Drag-drop on textarea: stub `dataTransfer.files` + `clientX`/`clientY`,
  fire `drop`, assert `uploadAsset` called and text inserted at the
  caret-from-point-derived offset. Stub `document.caretPositionFromPoint` if
  jsdom doesn't implement it (it probably doesn't — fall back path).
- In `readOnly` mode, no sidebar element is rendered.
- `refreshKey` change is forwarded to the sidebar (verified via prop pass-
  through, not internal sidebar state).

### Manual smoke (in the eventual plan's final task)

1. Upload an image via the sidebar's file picker → appears in sidebar.
2. Click the image row → markdown reference appears in textarea at cursor.
3. Switch to Preview → image renders.
4. Drop image onto textarea at a specific position → uploaded + inserted at
   drop point. Drop position visually matches.
5. Drop the SAME filename again → 409 inline error in sidebar.
6. Drop a `.exe` (or other disallowed extension) → 400 inline error.
7. Drop a file larger than `max_file_size` → 400 inline error with byte
   numbers.
8. Reference an asset in content_md, save → sidebar refreshes, the asset's
   trash icon disappears, "used" indicator visible.
9. Remove the reference from content_md, save → trash icon reappears.
10. Click trash on an unreferenced asset → row disappears.
11. Disable the version (separate UI), then try to upload → 403 inline,
    drop zone disabled.

## Data flow summary

### Drop on textarea (happy path)

```
User drops file.png on textarea
  ↓
MarkdownEditor: dragover preventDefault, drop preventDefault
  ↓
caretPositionFromPoint(clientX, clientY) → drop offset
  ↓
lib/assets.ts → uploadAsset(versionId, file)
  ↓
POST /api/versions/{vid}/assets  (multipart/form-data)
  ↓
Backend: validate → write atomic → return AssetResponse
  ↓
MarkdownEditor → insertAtCursor(formatRef(name, mime), atOffset=dropOffset)
  ↓
ItemEditPage → refreshKey++  (after the eventual content save)
  ↓
AssetSidebar (via prop change) → listAssets() → re-render with new is_referenced
```

### Sidebar click → insert

```
User clicks asset row
  ↓
AssetSidebar → onInsert(filename, mimeType)
  ↓
MarkdownEditor → insertAtCursor(formatRef(...), atOffset=textarea.selectionStart)
```

### Sidebar delete (V1, unreferenced only)

```
User clicks trash on row where is_referenced === false
  ↓
Inline confirm appears
  ↓
User confirms
  ↓
lib/assets.ts → deleteAsset(assetId)
  ↓
DELETE /api/assets/{id}  →  204
  ↓
AssetSidebar → listAssets() → re-render without the deleted row
```

### Refresh triggers (sidebar listAssets re-fetch)

- On AssetSidebar mount.
- After successful upload (each file in a multi-file drop).
- After successful delete.
- When `refreshKey` prop changes (parent bumps after successful save of
  content_md or after future markdown-field saves).

## File structure

| File | Status | LOC estimate |
|---|---|---|
| `frontend/src/lib/assets.ts` | NEW | ~80 |
| `frontend/src/lib/assets.test.ts` | NEW | ~120 |
| `frontend/src/components/editor/AssetSidebar.svelte` | NEW | ~200 (template + script + style) |
| `frontend/src/tests/AssetSidebar.test.ts` | NEW | ~200 |
| `frontend/src/components/editor/MarkdownEditor.svelte` | MODIFIED | +60 / -10 |
| `frontend/src/tests/MarkdownEditor.test.ts` | NEW or MODIFIED | +80 |
| `frontend/src/pages/editor/ItemEditPage.svelte` | MODIFIED | +3 / -0 |

No backend changes. No new dependencies. Svelte 5 native (no DOM
manipulation libraries, no UI kit).

## Estimated implementation scope

Likely 5-6 tasks in the plan:

1. `lib/assets.ts` + unit tests.
2. `AssetSidebar.svelte` (no MarkdownEditor wiring yet) + component tests.
3. `MarkdownEditor.svelte` layout shift + `insertAtCursor` + sidebar mount.
4. `MarkdownEditor.svelte` textarea drag-drop + tests.
5. `ItemEditPage.svelte` `refreshKey` wire after save.
6. Final verification: pytest unchanged, svelte-check, vitest, manual smoke.

Smaller than auto-slug-from-title (which was 12 tasks across backend + frontend).
