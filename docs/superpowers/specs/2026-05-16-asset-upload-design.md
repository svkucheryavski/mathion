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

### Backend-pipeline assumptions this design relies on

These are facts about the backend that the frontend design depends on; verified
against `backend/mathion/api/assets.py`, `backend/mathion/markdown.py`, and
`backend/mathion/api/helpers.py`:

- `render_with_assets` (called inside `_process_content_md` on every item save)
  scans `content_md` for bare filenames, looks them up in the `Asset` table,
  and: (a) rewrites matched filenames to `/assets/{vid}/{filename}`, AND
  (b) raises **HTTP 422 "Referenced assets not found in version: …"** when
  any bare filename in the markdown has no matching `Asset` row. This is a
  cross-channel error: the save fails through `ItemEditPage`'s existing
  save-error path, NOT through the asset sidebar. See Error handling §
  "Cross-channel: save 422 from unknown asset filenames" below.
- Asset filenames are server-side **sanitized** at upload (`sanitize_filename`):
  lowercased, non-alphanumeric collapsed to hyphens. The 409 error message
  echoes the **sanitized** filename, not the client-side name the user picked.
- `is_referenced` on `AssetResponse` counts ALL `AssetReference` rows for the
  asset — set by item `content_md`, question `text_md` and `explanation_md`,
  AND version `info_md`. The "save then delete" workflow only resolves
  references in whatever markdown context the user is currently editing.
- `AssetReference.asset_id` has `ondelete=CASCADE` on the FK
  (`backend/mathion/models.py:185`); deleting an `Asset` row also wipes all
  reference rows. This is relevant for the V2 force-delete follow-up — no
  dangling-reference cleanup needed.
- Allowed extensions (`backend/mathion/assets.py` `ALLOWED_EXTENSIONS`):
  `png, jpg, jpeg, gif, pdf, csv, xls, xlsx, ppt, pptx, r, py, m, js`.
  **SVG and WebP are NOT in this list** — even though they're image mime
  types, uploading either returns 400. The frontend's image-syntax check
  must therefore gate only on `image/png`, `image/jpeg`, `image/gif`.
- `GET /assets/{vid}/{filename}` (the file-serve endpoint) DOES 403 on
  disabled versions. Since the sidebar isn't rendered in readOnly mode (see
  "ReadOnly mode" below), thumbnails never hit this in practice — but the
  fact is worth documenting.
- `GET /api/versions/{vid}/assets` (the list endpoint) does NOT 403 on
  disabled versions, but DOES require `require_course_admin` (superuser or
  CourseAdmin row). Enrolled students cannot list assets.

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
  - Props:
    - `versionId: number`
    - `onInsert: (filename: string, mimeType: string) => void`
    - `refreshKey: number` (default 0; any change triggers re-fetch)
    - `cursorReady: boolean` (default false; controls the "click in the
      editor to choose where assets will be inserted" first-time banner)
  - Renders the right-rail in Edit mode.
  - Owns: GET listing, file-picker upload, sidebar drop-zone upload, per-row
    click-to-insert, per-row delete (only when `!is_referenced`), inline
    error region, "Uploading…" transient row, first-time banner.
- **NEW** `frontend/src/lib/assets.ts` — pure helper module for the three
  asset endpoints.
  - `uploadAsset(versionId, file): Promise<AssetResponse>` — **uses raw
    `fetch`**, NOT `api.post`. The existing `api.post` in `lib/api.ts`
    hardcodes `Content-Type: application/json` and `JSON.stringify(body)`,
    which would silently corrupt multipart uploads. `uploadAsset` builds a
    `FormData` with the file, omits any `Content-Type` header (browser sets
    the multipart boundary), and includes the same auth-relevant headers
    `api.ts` uses (`credentials: 'include'`, `X-Requested-With: mathion`).
    On non-2xx, it constructs an `ApiError` from the response body so callers
    get the same error shape as the rest of the API layer.
  - `listAssets(versionId): Promise<AssetResponse[]>` — uses `api.get`.
  - `deleteAsset(assetId): Promise<void>` — uses `api.delete` (which already
    handles 204 returning `Promise<void>`).
  - Defines and exports the `AssetResponse` type locally (not via
    `lib/types.ts`) — keeps the asset module self-contained and avoids
    expanding the cross-module types surface for a single feature. Shape
    matches backend `schemas.AssetResponse`: `{ id, version_id, filename,
    file_size, mime_type, uploaded_at, uploaded_by, is_referenced }`.
- **MODIFIED** `frontend/src/components/editor/MarkdownEditor.svelte`:
  - Layout shift: textarea + sidebar side-by-side in Edit mode (textarea
    flex-grow, sidebar fixed ~280px). The sidebar is **conditionally rendered**
    (`{#if mode === 'edit' && !readOnly}`), not `display: none` — keeps the
    DOM clean and avoids stale transient state (e.g., an open inline
    delete-confirm) carrying across Edit↔Preview toggles.
  - `insertAtCursor(text, atOffset?)` helper that reads/writes
    `selectionStart`/`selectionEnd` on the textarea ref. Defined as a local
    closure — NOT exported via Svelte 5 component bindings (no caller outside
    the component needs it in V1).
  - `lastOffset` ($state, initialized to `value.length`): tracks the most
    recent textarea selection. Updated on textarea `blur` and `selectionchange`
    events. Used as the fallback insert position when the sidebar fires
    `onInsert` and the textarea isn't currently focused. Initial value of
    `value.length` means the first sidebar click before any focus inserts at
    the end of existing content (predictable rather than position-zero).
  - `dragover` and `drop` listeners on **both** the textarea AND the outer
    editor container `<div>`. The outer container is the critical addition:
    without it, a drop on the editor's gap/border/label area falls through
    to the browser default and navigates to `file://`, discarding all unsaved
    edits. The outer-container handlers `preventDefault` and route the file
    to the sidebar's upload helper (upload-only, no auto-insert) so a slightly
    miss-aimed drop never destroys work.
  - Textarea drop computes the drop offset via
    `document.caretPositionFromPoint` (Firefox-spec name) with a fallback to
    `document.caretRangeFromPoint` (Chrome/WebKit legacy alias); both
    chromium-class browsers and Firefox are covered. If both return null
    (e.g., jsdom in tests, or older browsers), fall back to `lastOffset`.
  - Drop handler calls `uploadAsset` then `insertAtCursor` for each file. See
    UI / Interaction § "Drop on textarea" for sequential-vs-parallel and
    the in-flight-drop UI state.
  - `refreshKey: number` prop forwarded to `AssetSidebar` so the parent can
    trigger a list re-fetch after save. Default `0`; sidebar re-fetches on
    **any change** to the prop (so `++` is the natural mutation pattern).
- **MODIFIED** `frontend/src/pages/editor/ItemEditPage.svelte` — adds a
  `let refreshKey = $state(0)` declaration, forwards it to `<MarkdownEditor
  refreshKey={refreshKey} />`, and bumps `refreshKey++` after a **successful**
  content save (the `result === 'ok'` branch of the existing save flow —
  NOT on error). Sidebar then re-fetches and `is_referenced` flags reflect
  the latest `AssetReference` rows.

### ReadOnly mode

When `MarkdownEditor` is mounted with `readOnly` (disabled version, or
preview-only contexts), the sidebar is **not rendered at all**. There's no
edit cursor to insert into, and the backend 403s upload/delete on disabled
versions anyway. Avoiding the mount also avoids a spurious GET that would
otherwise be ignored.

### Boundary summary

| Concern | Owner |
|---|---|
| `uploadAsset` / `listAssets` / `deleteAsset` API calls + multipart + error mapping + `AssetResponse` type | `lib/assets.ts` |
| List rendering, thumbnails, sidebar drop zone, file picker, click-to-insert callback, delete UI | `AssetSidebar.svelte` |
| Textarea selection (`lastOffset`), cursor, **textarea drag-drop**, **outer-container drag-drop guard**, insertion at offset, conditional sidebar mount, `refreshKey` pass-through | `MarkdownEditor.svelte` |
| Save lifecycle (own existing flow), `refreshKey` declaration + bump on success | `ItemEditPage.svelte` (and any future host of `MarkdownEditor`) |
| Asset reference sync (`AssetReference` rows for item/question/info contexts) | Backend (`render_with_assets`) — unchanged |

**Why upload logic doesn't live in `AssetSidebar`:** the data flow has two
upload paths — sidebar drop-zone/file-picker AND textarea drag-drop. Both
must call the same upload helper to share error semantics, sequential
queueing, and progress UI. Putting the helper in `lib/assets.ts` (a pure
module) lets both `AssetSidebar` and `MarkdownEditor` call it directly,
without crossing the component boundary in either direction.

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

- Textarea container: `flex: 1 1 0; min-width: 0` (the `min-width: 0` is
  required so the textarea can shrink below its intrinsic content width in a
  flex row — common flex-layout gotcha).
- Sidebar: `flex: 0 0 280px`.
- Preview mode and ReadOnly mode: sidebar is **not rendered**
  (`{#if mode === 'edit' && !readOnly}`). Preview spans full width; on
  return to Edit, the sidebar remounts and re-fetches (any transient state
  like an open inline delete-confirm is discarded).
- The outer `.editor` container's existing border now wraps the flex row
  (textarea + sidebar). The flex row becomes the new direct child of
  `.editor`.
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

- **Image mime types** (must match the backend's allowed-extensions list):
  exactly `image/png`, `image/jpeg`, `image/gif`. SVG and WebP are NOT
  accepted by the backend uploader, so the frontend never sees those as
  successfully-uploaded assets and the image-syntax check only needs to
  recognize these three.
  - Format: `\n![{stem}]({filename})\n`.
  - `{stem}` is the filename with the **last** extension stripped (one dot
    from the right). Example: `histogram.png` → `histogram`,
    `my.report.v2.pdf` → `my.report.v2`.
  - Example: `histogram.png` → `\n![histogram](histogram.png)\n`.
- **Non-image mime types** → `\n[{filename}]({filename})\n`.
  - Example: `worksheet.pdf` → `\n[worksheet.pdf](worksheet.pdf)\n`.
- The mime type used for the image-vs-link check comes from the **server's
  `AssetResponse.mime_type`** (from the upload response, or from the
  sidebar's listing), NOT the client-side `File.type`. Client browsers
  sometimes report `image/jpg` (non-canonical) or empty strings; the server
  normalizes to `image/jpeg`. Sidebar click and textarea drop both rely on
  the server-canonical value.
- Leading and trailing newlines ensure that two consecutive inserts don't end
  up concatenated on the same line. If the cursor is already at the start of
  a blank line, the leading newline is a no-op visually. (No special-casing —
  authors can clean up extra blank lines themselves; markdown renderers
  collapse them.)
- **Accessibility note (V1 tradeoff):** the alt text defaults to the
  filename stem (e.g., `histogram` from `histogram.png`). This is poor a11y
  if the stem is a code slug like `chart-v2-final-2`. Authors who care can
  edit the alt text in the textarea immediately after insertion. A future
  enhancement could prompt for alt text on insert; V1 keeps the path
  click-fast.

### Drop on textarea and outer container

Two drop targets need handlers, for different reasons:

1. **Textarea drop** — the productive path. `dragover` + `drop` listeners on
   the textarea element itself; drop computes a precise offset from
   `caretPositionFromPoint`/`caretRangeFromPoint` (with `lastOffset`
   fallback), uploads, and inserts the markdown reference at that offset.
2. **Outer container drop** — the **data-loss guard**. `dragover` + `drop`
   listeners on the outer `.editor` `<div>` so a drop that lands in the
   editor's border/gap/label area (not on the textarea precisely) does NOT
   fall through to the browser's default file-handler (which would navigate
   to `file://` and discard all unsaved edits). The outer-container drop
   handler treats the file as a sidebar-style upload: upload only, no
   auto-insert. User can then click the resulting sidebar row to insert if
   they meant to.

**Textarea drop algorithm:**

- `dragover`: `preventDefault()` (required so `drop` fires) + optional hover
  style on the textarea border.
- `drop`: `preventDefault()`. Compute `dropOffset` once at drop time via
  `caretPositionFromPoint` (or `caretRangeFromPoint` fallback, then
  `lastOffset`). Extract `e.dataTransfer.files`. For each file
  (sequentially, not concurrently):
  1. `uploadAsset(versionId, file)` — `await`.
  2. On success: `insertAtCursor(formatRef(filename, mimeType), atOffset=offset)`.
     Subsequent files in the same drop advance `offset` by the length of the
     just-inserted text. Use the server's `mime_type` from the response.
  3. On error: stop the loop. Subsequent files in the batch are NOT
     uploaded. The inline error region surfaces the failure with explicit
     "Upload stopped at file N of M" wording when M > 1, so the user knows
     which files succeeded.
- Sequential, not parallel: a 400 on file 3 of 5 doesn't lose progress on
  files 1 and 2, and error messages can be attributed cleanly. UI shows
  "Uploading file 3 of 5…" if more than one file is being processed.

**Re-entrancy guard:** an `uploading: boolean` flag (in `MarkdownEditor`)
blocks a new `drop` event from starting a second loop while a batch is in
flight. A discarded drop is signalled visually — see "Empty / loading /
progress / error states" below.

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
| Upload in flight (single file) | Transient row at top of list: "Uploading {filename}…" with indeterminate spinner |
| Upload in flight (multi-file batch from one drop) | Transient row: "Uploading file {N} of {M}…" |
| Drop arriving WHILE uploading | Sidebar drop zone + textarea both display a momentary `Upload in progress — please wait` overlay state (red border / muted background, 1.5s). New drop is silently discarded — but the user sees they were discarded. |
| Upload error (any) | Inline error region at top of sidebar with server's `detail` text, dismissable via `×`. Multi-file: "Upload stopped at file {N} of {M}" prefix. |
| Delete error | Same channel as upload error |
| Disabled-version upload/delete error | Inline error "Version is disabled" + disable drop zone + hide trash icons. Sidebar list itself stays populated since LIST doesn't 403 on disabled. |
| `used` badge hover | Tooltip: "Remove this reference from content and save to enable delete." Makes the absent trash icon discoverable. |
| First-time sidebar click before textarea ever focused | Insert proceeds at `lastOffset` (= `value.length`, i.e., end of content). Could be surprising; mitigation: a one-time muted banner at the top of the sidebar — "Click in the editor to choose where assets will be inserted." — visible until the textarea is focused for the first time, then permanently hidden. |

## Error handling

### Backend response → UI surface

| Status / detail | UI surface |
|---|---|
| 201 + AssetResponse | List refreshes; the new asset appears at its alphabetical slot |
| 400 "File extension not allowed: {name}" | Inline error verbatim. `{name}` is the original (un-sanitized) client filename. |
| 400 "File size {N} exceeds max {M}" | Inline error verbatim. `{N}` and `{M}` are raw byte integers (e.g., "10485761 exceeds max 10485760"); UI shows them as-is for V1. |
| 400 "Total version asset size would exceed limit ({M} bytes)" | Inline error verbatim |
| 400 "No filename provided" | Inline error verbatim (practically unreachable from the DOM file picker / DataTransfer path) |
| 403 "Version is disabled" | Inline error + disable upload UI |
| 409 "Asset '{X}' already exists in this version" | Inline error suggesting "rename and retry". **`{X}` is the SANITIZED filename** (lowercased, non-alphanumeric collapsed to hyphens — e.g., uploading `My Image.PNG` gives an error saying `Asset 'my-image.png' already exists`). No client-side rename in V1. |
| 500 "Failed to write asset to disk" | Inline error + re-fetch list (backend already rolled back the registry row) |
| Network failure | Inline error "Could not reach server. Check your connection." |

All upload errors come from the `ApiError` class — `lib/assets.ts` constructs
one from the non-2xx response body (since `uploadAsset` uses raw `fetch`, not
`api.post`). `listAssets` and `deleteAsset` use the existing `api.get` /
`api.delete` wrappers which already produce `ApiError`.

### Cross-channel: save 422 from unknown asset filenames

`render_with_assets` raises **422 "Referenced assets not found in version:
…"** when `content_md` references a bare filename with no matching `Asset`
row. This is a content-save error (from `POST /api/items/{id}` save), NOT an
asset-upload error. It can occur if:

- The user hand-types `![foo](nonexistent.png)` in the textarea.
- The user has a typo in a filename (`histogran.png` instead of
  `histogram.png`).
- A path-style reference like `![alt](subdir/foo.png)` — `sanitize_filename`
  strips `/` at upload, so stored filenames are always flat. The bare-filename
  matcher won't find `subdir/foo.png` in the Asset table and the save 422s.

**UI surface:** the existing save-error path in `ItemEditPage` handles this
via the standard `mapCreateError` / save-error toast; the asset sidebar is
NOT involved. The sidebar correctly shows all referenced and unreferenced
assets — the user inspects the sidebar to find the right filename and
corrects the textarea reference. The 422 detail message names the bad
filenames, which is enough to act on. No spec change to the save flow.

### Edge cases

- **Two uploads in flight:** prevented at the UI layer. Drop handler queues
  files sequentially. While an upload is in progress an `uploading: boolean`
  flag (in `MarkdownEditor`) blocks new drops from starting a second loop.
  Discarded drops trigger a 1.5s visual signal (see "Drop arriving WHILE
  uploading" row in the state table).
- **Drop on outer container vs textarea vs preview:**
  - Textarea drop → uploads + inserts at drop offset (the productive path).
  - Outer `.editor` container drop → uploads only (data-loss guard); user
    clicks the resulting sidebar row to insert.
  - Drop on the rendered preview area (in Preview mode, when the textarea
    isn't mounted) — no listeners. Browser default behavior (navigates to
    `file://`). Mitigation: the outer `.editor` container's drop guard fires
    in Edit mode only; in Preview mode the preview content doesn't have
    listeners. We accept this for V1 — admins in Preview mode aren't actively
    editing and the navigation is recoverable.
- **`onInsert` called while textarea has no focus:** insert at `lastOffset`
  (`$state`), which `MarkdownEditor` maintains via textarea `blur` and
  `selectionchange` handlers. Initial value: `value.length` (end of
  content). When the user clicks a sidebar row, the standard browser event
  order is `blur → mouseup → click`, so the most recent textarea cursor
  position is captured **just before** the sidebar click fires its handler.
  This makes "click in textarea to position cursor, then click sidebar row
  to insert" the natural workflow.
- **First-time sidebar click before any textarea focus:** insert lands at
  the end of existing content (`lastOffset === value.length`). A one-time
  muted banner at the top of the sidebar — "Click in the editor to choose
  where assets will be inserted." — is visible until the textarea is
  focused for the first time, then permanently hidden for the session.
  Makes the rule discoverable without forcing a modal.
- **Referenced asset becomes unreferenced after content edit:** the
  `is_referenced` flag reflects `AssetReference` rows server-side. The trash
  icon won't appear until the user saves content_md (or the relevant
  question/info markdown) and the sidebar refreshes via `refreshKey`. A
  tooltip on the `used` badge ("Remove this reference from content and save
  to enable delete.") teaches the workflow. Matches the "save first, then
  delete" workflow.
- **`is_referenced` includes question text/explanation and version info_md:**
  the backend sync runs `AssetReference` for all three contexts, not just
  `content_md`. So a sidebar showing `used` for an asset may mean it's
  referenced from a question elsewhere in the version, or from `info_md`.
  V1 doesn't surface which context — the workflow ("remove the reference,
  save, delete") still works as long as the user finds the right place.
  Documented limitation; a future enhancement could surface the reference
  list.
- **Disabled-version mid-session:**
  - LIST endpoint does NOT 403, so the sidebar's existing data stays usable.
  - UPLOAD and DELETE return 403 "Version is disabled" — surfaced inline,
    drop zones disabled, trash icons hidden.
  - The file-serve endpoint (`GET /assets/{vid}/{filename}`) DOES 403 on
    disabled versions, which would break thumbnails — but the sidebar is
    not rendered in readOnly mode, so this code path isn't hit in practice.
    If a version is disabled mid-session while the sidebar is open (the
    `readOnly` prop hasn't flipped yet — unlikely race), broken thumbnail
    images would be visible until the next refresh. Acceptable for V1.
- **Network failure mid-multi-file-drop:** the sequential loop aborts on
  any error. Files that uploaded successfully (and had their references
  inserted) stay in the textarea and sidebar; files that hadn't started
  yet are not uploaded. Inline error explains: "Upload stopped at file
  {N} of {M}."

## Testing approach

### `lib/assets.ts` (vitest, no DOM)

- `uploadAsset` happy path: mocked `fetch` returns 201 + `AssetResponse`-shaped
  JSON; assert the returned object matches.
- `uploadAsset` request shape: assert `fetch` is called with `method: 'POST'`,
  body is a `FormData` containing the file under field name `file`,
  `credentials: 'include'`, and **no `Content-Type` header** (browser sets
  the multipart boundary).
- `uploadAsset` propagates `ApiError` with status + detail for each error
  class (400 ext, 400 size, 400 total-size, 400 no-filename, 403 disabled,
  409 already-exists, 500 disk-write, network failure).
- `listAssets`: returns array; uses backend's alphabetical sort (we don't
  re-sort).
- `deleteAsset`: succeeds on 204. Note: the backend's 409 "is_referenced"
  path is not exercised by the UI because the trash icon is hidden for
  referenced assets — so this test asserts the happy path only. A 404 on
  delete (race: someone else deleted it) DOES need a test — `ApiError` with
  detail preserved.

### `AssetSidebar.svelte` (vitest + jsdom)

- Renders the list returned by `listAssets` on mount.
- Click on a row calls `onInsert(filename, mimeType)` where `mimeType` is
  the server's value from the asset row (not the client `File.type`).
- File picker → calls `uploadAsset` → refreshes list.
- Drop on sidebar drop zone → same upload path.
- Trash icon hidden when `is_referenced === true`; the `used` badge is
  visible with the tooltip text. Trash visible (on hover) when
  `is_referenced === false`. Click → inline confirm → `deleteAsset` → refresh.
- Each error state renders the server's `detail` text verbatim, prefixed
  with "Upload stopped at file N of M" when applicable.
- `refreshKey` prop change (any change, not just increment) triggers a
  re-fetch.
- "Click in the editor to choose where assets will be inserted" banner
  is visible when the sidebar's `cursorReady` prop is `false` and hidden
  when `true`. `cursorReady` is owned by `MarkdownEditor` (it knows when
  the textarea is first focused). Default `false`; flips to `true` on
  textarea's first `focus` event and stays true for the session.

### `MarkdownEditor.svelte` extended tests (vitest + jsdom)

The current file has no test (`src/tests/MarkdownEditor.test.ts` does not
exist yet); this task creates it from scratch.

- Existing render/mode behavior covered (Edit/Preview tab toggling,
  `loadPreview` lifecycle, `readOnly` mode).
- `insertAtCursor`: programmatic invocation (via a small test-only export
  or simulated event path) splices at the selection and restores cursor
  position just after the inserted text.
- `lastOffset` tracks textarea `blur` and `selectionchange`. Initial value
  is `value.length`. After programmatic textarea cursor moves, `lastOffset`
  reflects the latest selection.
- `cursorReady` is `false` on mount and flips to `true` on the textarea's
  first `focus` event.
- Drag-drop on textarea: stub `dataTransfer.files` + `clientX`/`clientY`,
  fire `drop`, assert `uploadAsset` called and text inserted at the
  drop-offset. `document.caretPositionFromPoint` and `caretRangeFromPoint`
  are both stubbed to return a known offset; if both return null, the test
  verifies fallback to `lastOffset`.
- Drag-drop on outer container (the data-loss guard): fire `dragover` and
  `drop` on the outer `.editor` `<div>`, assert `preventDefault` is called
  and `uploadAsset` is called with upload-only behavior (no insertion).
- Re-entrancy guard: while `uploading === true`, a second `drop` does not
  start a second loop; visual signal state is set briefly.
- Multi-file drop: sequential upload-then-insert; on mid-batch error, the
  loop aborts and the error includes "Upload stopped at file N of M".
- In `readOnly` mode, no sidebar element is rendered (queried by selector).
- Sidebar receives forwarded props (`refreshKey`, `versionId`,
  `cursorReady`, `onInsert`).

### Manual smoke (in the eventual plan's final task)

1. Upload an image via the sidebar's file picker → appears in sidebar with
   thumbnail.
2. Click the image row → markdown reference appears in textarea at the
   current cursor. Switch to Preview → image renders.
3. **First-time banner**: open a fresh item where you haven't clicked the
   textarea yet. Confirm the "Click in the editor to choose where assets
   will be inserted" banner is visible. Click in the textarea — banner
   disappears. Don't refocus the textarea between tests in this scenario.
4. **Click-with-no-focus fallback**: as a continuation, open another fresh
   item and immediately (without clicking the textarea) click a sidebar
   row. Verify the markdown reference is inserted at the end of existing
   content (`lastOffset === value.length`).
5. **Textarea drop**: drag an image into a specific position inside the
   textarea (e.g., mid-paragraph). Verify the inserted markdown appears on
   the line corresponding to the drop point, NOT at the end.
6. **Outer-container drop guard**: drag a file and drop it 10px ABOVE the
   textarea (on the editor's border/padding area). Verify the browser does
   NOT navigate away (no `file://` redirect, unsaved edits intact) and the
   file appears in the sidebar (upload only, no insert).
7. **Same-filename re-upload**: drop the SAME filename twice → second drop
   triggers a 409 inline error in sidebar. Note: the error message uses
   the **sanitized** filename (e.g., `my-image.png`).
8. **Disallowed extension**: drop a `.exe` (or any extension not in the
   backend's `ALLOWED_EXTENSIONS`) → 400 inline error.
9. **Oversize file**: drop a file larger than `max_file_size` → 400 inline
   error with byte numbers (raw integers, no KB/MB units in V1).
10. **Reference + save + sidebar refresh**: reference an asset in
    content_md, save. Verify the sidebar refreshes via `refreshKey`, the
    `used` badge appears, and the trash icon disappears. Hover the badge →
    tooltip explains the workflow.
11. **Unreference + save**: remove the reference from content_md, save.
    Verify the `used` badge disappears and the trash icon (on hover) is
    back. Click trash → inline confirm → delete → row disappears.
12. **Multi-file drop with mid-batch error**: drop 5 files at once where
    one is oversize. Verify files before the error are uploaded and
    inserted; files after the error are NOT. Error message says "Upload
    stopped at file N of 5".
13. **Drop-while-uploading**: drop a big file (slow upload), then drop a
    second file mid-upload. Verify the second drop is discarded with a
    visual signal (1.5s overlay) — NOT silently lost.
14. **Edit → Preview → Edit round-trip**: upload a file in Edit mode,
    switch to Preview, switch back. Verify the new file is still in the
    sidebar (list re-fetches on remount; no stale state like an open
    delete-confirm carries over).
15. **Save 422 (cross-channel)**: type `![ghost](does-not-exist.png)` in
    the textarea and save. Verify the 422 surfaces via the existing item
    save-error path (not in the sidebar). Sidebar's existing list is
    unchanged.
16. **Disabled version**: disable the version via the version-meta panel,
    then return to an item edit. Verify the sidebar is not rendered
    (readOnly mode). Re-enable, return: sidebar comes back.

## Data flow summary

### Drop on textarea (happy path)

```
User drops file.png on textarea
  ↓
MarkdownEditor: dragover preventDefault, drop preventDefault
  ↓
caretPositionFromPoint(clientX, clientY) → drop offset
  (fallback chain: caretRangeFromPoint → lastOffset)
  ↓
lib/assets.ts → uploadAsset(versionId, file)
  ↓ raw fetch with FormData, no Content-Type header
POST /api/versions/{vid}/assets  (multipart/form-data)
  ↓
Backend: validate → write atomic → return AssetResponse
  ↓ mime_type comes from server response (not File.type)
MarkdownEditor → insertAtCursor(formatRef(name, mime), atOffset=dropOffset)
  ↓
ItemEditPage → refreshKey++  (after the eventual content save)
  ↓
AssetSidebar (via prop change) → listAssets() → re-render with new is_referenced
```

### Drop on outer container (data-loss guard)

```
User drops file.png slightly off the textarea (border, gap, label area)
  ↓
.editor outer div: dragover preventDefault, drop preventDefault
  ↓ (prevents browser navigation to file://)
lib/assets.ts → uploadAsset(versionId, file)
  ↓
POST /api/versions/{vid}/assets
  ↓
Backend: returns AssetResponse
  ↓
AssetSidebar → listAssets() → re-render with new row
  (no auto-insert — user clicks to insert if intended)
```

### Sidebar click → insert

```
User clicks asset row
  ↓ (browser event order: textarea blur → mouseup → click)
MarkdownEditor blur handler: lastOffset = textarea.selectionStart
  ↓
AssetSidebar → onInsert(filename, mimeType)  (mime from server's value)
  ↓
MarkdownEditor → insertAtCursor(formatRef(...), atOffset=lastOffset)
```

If the textarea has never been focused (`cursorReady === false`),
`lastOffset` is its initial value of `value.length` — the insert lands at
the end of existing content. The first-time banner makes this discoverable.

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
- After each successful upload (each file in a multi-file drop) — runs
  inside the sequential loop so each new asset becomes visible without
  waiting for the batch to finish.
- After successful delete.
- When `refreshKey` prop changes (parent bumps after successful save of
  content_md, or after any future markdown-field save in the same version).

## File structure

| File | Status | LOC estimate |
|---|---|---|
| `frontend/src/lib/assets.ts` | NEW | ~100 (helper module + `AssetResponse` type + raw-fetch upload + error mapping) |
| `frontend/src/tests/assets.test.ts` | NEW | ~150 |
| `frontend/src/components/editor/AssetSidebar.svelte` | NEW | ~220 (template + script + style; first-time banner adds ~15 LoC over the prior estimate) |
| `frontend/src/tests/AssetSidebar.test.ts` | NEW | ~220 |
| `frontend/src/components/editor/MarkdownEditor.svelte` | MODIFIED | +80 / -10 (layout shift + drag-drop on both surfaces + lastOffset / cursorReady state + sidebar mount) |
| `frontend/src/tests/MarkdownEditor.test.ts` | NEW | ~120 |
| `frontend/src/pages/editor/ItemEditPage.svelte` | MODIFIED | +4 / -0 (state declaration + prop forward + bump in save success branch) |

Test files all live in `frontend/src/tests/` (matching the existing
convention — `accordionHeader.svelte.test.ts`, `api.test.ts`,
`format.test.ts`, etc. all live there). NOT colocated in `src/lib/`.

`AssetSidebar.svelte` at ~220 LoC is on the edge. **Optional split:** a
sub-component `AssetRow.svelte` for per-row state (delete-confirm two-state
button) would keep the sidebar parent under ~150 LoC and isolate row-level
state. **Decision deferred to the implementer:** if the sidebar feels
unwieldy during implementation (especially when the inline delete-confirm
state machine starts to tangle with the list-level error and uploading
states), extract `AssetRow.svelte`. Don't force it preemptively.

No backend changes. No new dependencies. Svelte 5 native (no DOM
manipulation libraries, no UI kit).

## Estimated implementation scope

Likely 6-7 tasks in the plan:

1. `lib/assets.ts` + `AssetResponse` type + unit tests (including raw-fetch
   FormData shape assertions).
2. `AssetSidebar.svelte` shell (list, row, file picker, drop zone, error
   region, transient upload row, `cursorReady` banner) + component tests.
   No MarkdownEditor wiring yet — sidebar mounted standalone for testing.
3. `AssetSidebar.svelte` delete UI (inline confirm + `used` badge tooltip)
   + tests.
4. `MarkdownEditor.svelte` layout shift, `lastOffset` / `cursorReady`
   state, conditional sidebar mount, `insertAtCursor` + sidebar click
   wiring (no drag-drop yet) + tests.
5. `MarkdownEditor.svelte` textarea drag-drop + outer-container drop guard
   + re-entrancy guard + multi-file sequential loop + tests.
6. `ItemEditPage.svelte` `refreshKey` declaration + bump on save success.
7. Final verification: pytest unchanged, svelte-check, vitest, manual
   smoke (16 steps above).

Still smaller than auto-slug-from-title (which was 12 tasks across backend
+ frontend), but the original 5-6 estimate undercounted the work in
`MarkdownEditor`. The added task splits drag-drop into its own task
(separable, larger change) and isolates delete-UI from initial sidebar
shell.
