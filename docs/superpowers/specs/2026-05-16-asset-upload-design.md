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
  lowercased base, then **spaces and underscores → hyphens**, then **all
  other non-`[a-z0-9-]` characters are removed** (NOT replaced with hyphens).
  Example: `My Image (final).PNG` → `my-image-final.png`,
  `my.report.v2.pdf` → `myreportv2.pdf` (dots in the base are stripped, NOT
  preserved). The 409 error message echoes the **sanitized** filename, not
  the client-side name the user picked.
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
    - `cursorReady: boolean` (default false; controls the first-time banner
      visibility — see `MarkdownEditor` state). **One-way: read-only from
      the sidebar's perspective**, NOT `$bindable`. Only `MarkdownEditor`
      writes to `cursorReady` (on first textarea `focus` AND on first
      `onInsert` call). Sidebar reads to gate banner visibility.
    - `uploading: boolean` (default false; declared `$bindable` — see
      "Shared `uploading` state" in the Boundary section). When true:
      sidebar renders its drop-zone overlay AND its file picker is
      disabled. When sidebar starts/finishes a file-picker or sidebar-drop
      upload, it sets `uploading` accordingly.
    - `uploadProgress: { current: number; total: number; filename: string } | null`
      (default null; declared `$bindable`). Drives the "Uploading file
      {N} of {M}…" / "Uploading {filename}…" transient row at the top
      of the list. Written by EVERY upload entry point (textarea drop,
      `.edit-content` wrapper drop in `MarkdownEditor`; sidebar drop
      zone, sidebar root `<aside>` handler, sidebar file picker in
      `AssetSidebar`) — both components write through this shared
      state so the sidebar renders one canonical progress row
      regardless of which entry point started the upload. Reset to
      `null` in the upload loop's `try/finally`.
    - `uploadError: { detail: string; stoppedAt?: { n: number; m: number } } | null`
      (default null; declared `$bindable`). Drives the inline error
      region. `detail` is the verbatim server `detail` string (or the
      network-failure copy). `stoppedAt` is set ONLY for multi-file
      batches where the batch was halted mid-loop — sidebar renders
      "Upload stopped at file {n} of {m}" as a prefix on the error
      detail. Written by every upload entry point; dismissed by the
      user via the `×` button (which the sidebar owns) → sets
      `uploadError = null`.
  - Renders the right-rail in Edit mode.
  - Owns: GET listing, file-picker upload, sidebar drop-zone upload, per-row
    click-to-insert, per-row delete (only when `!is_referenced`),
    **rendering** of the inline error region and the "Uploading…"
    transient row (the underlying state is shared via `$bindable
    uploadProgress` and `$bindable uploadError`), first-time banner,
    404-on-delete handling (rare race). The sidebar is the **sole
    render site** for upload progress and upload errors — even when
    the upload originated in `MarkdownEditor`'s textarea/wrapper drop
    handlers. This keeps one canonical UI location for upload status,
    regardless of entry point.
- **NEW** `frontend/src/lib/assets.ts` — pure helper module for the three
  asset endpoints.
  - `uploadAsset(versionId, file): Promise<AssetResponse>` — **uses raw
    `fetch`**, NOT `api.post`. The existing `api.post` in `lib/api.ts`
    hardcodes `Content-Type: application/json` and `JSON.stringify(body)`,
    which would silently corrupt multipart uploads. `uploadAsset` builds a
    `FormData` with the file (field name `file`, matching the FastAPI
    parameter), omits any `Content-Type` header (browser sets the multipart
    boundary), and includes the same auth-relevant headers `api.ts` uses
    (`credentials: 'include'`, `X-Requested-With: mathion`). On non-2xx, it
    constructs an `ApiError` from the response body so callers get the same
    error shape as the rest of the API layer. **On 401 specifically, it
    must replicate the
    `emitUnauthorized(location.pathname + location.search + location.hash)`
    call that `api.ts:request` does internally** (matches `api.ts:41`
    exactly — all three location parts, not just pathname + search) —
    otherwise an expired session mid-upload surfaces as a confusing
    inline "Not authenticated" error instead of bouncing to login. Either
    re-export the helper from `api.ts` or duplicate the one-liner.
  - `formatRef(filename: string, mimeType: string): string` — pure helper
    that returns the markdown reference (`\n![{stem}]({filename})\n` for
    image mime types, `\n[{filename}]({filename})\n` otherwise). Used by
    `MarkdownEditor` drop handler and `AssetSidebar` click handler.
    Lives in `lib/assets.ts` (not `lib/format.ts` — kept with the asset
    module to avoid splitting asset concerns).
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
    closure — NOT exported via Svelte 5 component bindings. Tests exercise
    it indirectly via simulated event paths (drag-drop, sidebar `onInsert`
    callback), not via a test-only export.
    **Null-textarea guard:** if the textarea ref is `null` at call time
    (Edit→Preview switched mid-upload while a background upload was still
    awaiting), `insertAtCursor` must early-return without throwing. The
    in-flight upload completes silently — the `refreshKey++` bump
    (which runs in the textarea-drop handler **after** `uploadAsset`
    resolves, regardless of whether `insertAtCursor` no-ops) still
    happens, so when the user returns to Edit the sidebar shows the
    new asset row. User then clicks the (now visible) row to insert
    manually.
  - **Internal `$state` variables** (not props):
    - `lastOffset = $state(value.length)` — tracks the most recent textarea
      selection. Updated on textarea `blur` and `selectionchange` events.
      Used as the fallback insert position when the sidebar fires
      `onInsert` and the textarea isn't currently focused.
    - `cursorReady = $state(false)` — flips to `true` on the textarea's
      first `focus` event AND on the first `onInsert` call (whichever
      comes first — see Edge cases for why first-insert also clears the
      banner). Forwarded to `<AssetSidebar cursorReady={cursorReady} />`.
      **Assignment ordering inside `onInsert`:** the handler MUST set
      `cursorReady = true` **before** calling `insertAtCursor`. Reason:
      Svelte 5 reactivity batches synchronously, but the banner-clear
      visual change should be tied to the same tick as the insert so a
      future reader can't reason about a one-frame interleaving. (Both
      orders work in practice — pin the order for clarity, not
      correctness.)
    - `uploading = $state(false)` — true while ANY upload batch is in
      flight (textarea drop, `.edit-content` wrapper drop, sidebar drop
      zone, sidebar root `<aside>` handler, OR sidebar file picker —
      five entry points total). Forwarded bidirectionally to
      AssetSidebar via `bind:uploading` (Svelte 5 `$bindable` on the
      sidebar side) so the sidebar can flip it when its own upload
      paths start/finish. Used by both components for the "Drop
      arriving WHILE uploading" overlay state and re-entrancy guards
      on all drop handlers.
    - `uploadProgress = $state<UploadProgress | null>(null)` —
      `{ current, total, filename }` while a batch is in flight;
      `null` otherwise. Forwarded to AssetSidebar via
      `bind:uploadProgress` ($bindable two-way). Written by
      MarkdownEditor's textarea-drop and wrapper-drop handlers as
      they advance through the sequential loop; written by AssetSidebar's
      file-picker and sidebar-drop handlers similarly. Reset to `null`
      in the upload loop's `try/finally` block. The sidebar is the
      sole render site (transient row at top of list).
    - `uploadError = $state<UploadError | null>(null)` —
      `{ detail, stoppedAt? }` after a failed upload; `null` otherwise.
      Forwarded to AssetSidebar via `bind:uploadError` ($bindable
      two-way). Written by MarkdownEditor on its own upload paths
      (with `stoppedAt: { n, m }` set when a multi-file batch halted
      mid-loop); written by AssetSidebar on its own paths similarly.
      Cleared on user dismiss (the sidebar owns the `×` button which
      sets `uploadError = null`) OR at the top of the next batch's
      `try` block (right after `uploading = true`). Crucially, NOT
      cleared in `finally` — that would erase the error the catch
      block just wrote, since `finally` runs on the error path too.
      **TOCTOU avoidance — set `uploading = true` SYNCHRONOUSLY** at the
      top of every upload entry point — all five: textarea drop
      handler, `.edit-content` wrapper drop handler, sidebar drop-zone
      handler, sidebar root `<aside>` drop handler, sidebar file-picker
      change handler — **before the first `await`**. The guard check
      (`if (uploading) { … return; }`) and the synchronous write must
      both occur in the same microtask tick. Without this discipline,
      two near-simultaneous drops can each pass the guard check before
      either writes the flag, producing concurrent upload loops and a
      double overlay flash. The flag must also be reset in a
      `try/finally` so a thrown error always returns it to `false`.
  - `dragover` and `drop` listeners on **two surfaces**: the textarea AND an
    **inner edit-content wrapper `<div>` that sits inside the `{#if mode ===
    'edit' && !readOnly}` block**. The wrapper, NOT the always-rendered
    outer `.editor` container, hosts the data-loss guard. Why this matters:
    the existing outer `.editor` wraps the tab strip too — putting listeners
    on it would catch drops on the Edit/Preview tabs (harmless but ugly in
    Preview, where the user is reading not editing). Putting them on an
    inner wrapper inside the Edit-mode conditional ensures the guard is
    Edit-only by construction.
  - The DOM structure becomes:
    ```
    <div class="editor">                         ← outer (existing)
      <div class="tabs">...</div>                ← Edit/Preview tabs
      {#if mode === 'edit' && !readOnly}
        <div class="edit-content"                ← NEW guard wrapper
             ondragover={...} ondrop={...}>
          <textarea ondragover={...}             ← productive path
                    ondrop={...}>...</textarea>
          <AssetSidebar ... />
        </div>
      {:else if mode === 'preview'}
        <div class="preview">...</div>
      {/if}
    </div>
    ```
    **`.edit-content` styling** (required, not optional): `display: flex;
    flex-direction: row; gap: <existing editor spacing>;` — the wrapper
    becomes the flex container that previously was the outer `.editor`.
    Move any flex/gap styling that was on `.editor` (for the textarea +
    Edit/Preview content row) down to `.edit-content`. Outer `.editor`
    keeps `display: flex; flex-direction: column;` so the tab strip
    stacks above the edit-content row.
  - **Event propagation:** `<AssetSidebar />` is nested inside the
    `.edit-content` wrapper, so DOM drop events on the sidebar AND on the
    textarea both bubble up to the wrapper handler. Without guards, a
    single drop on either inner element fires its own handler AND the
    wrapper handler → double upload + double `refreshKey++`. Required
    discipline:
    1. **Textarea `drop` handler** MUST call
       `event.preventDefault(); event.stopPropagation();` as its
       **first synchronous work**, BEFORE the `if (uploading) … return`
       re-entrancy guard, BEFORE setting `uploading = true`, and
       BEFORE the first `await`. DOM propagation is synchronous —
       calling `stopPropagation()` after `await uploadAsset(...)` is too
       late; by then the wrapper handler has already fired.
    2. **AssetSidebar's sidebar-drop-zone `drop` handler** MUST do the
       same: `event.preventDefault(); event.stopPropagation();` as the
       first synchronous statements, before guards or awaits. Without
       this, a sidebar drop bubbles to the wrapper and triggers a
       redundant upload + `refreshKey++`.
    3. **`.edit-content` wrapper `drop` handler** runs only for drops
       that landed neither on the textarea nor in the sidebar (i.e.,
       the data-loss guard catches drops on padding / gaps). It also
       starts with `event.preventDefault();` (no stopPropagation needed
       since it's the outermost guarded element).

    The canonical drop-handler shape lives in the Boundary summary's
    "Synchronous write requirement" subsection below — see the code
    block there (single source of truth). All four drop handlers
    (textarea, sidebar drop zone, sidebar root `<aside>`, `.edit-content`
    wrapper) follow that shape, with entry-point-specific work inside
    the loop body
    (insertAtCursor + refreshKey++ for textarea; refreshKey++ only for
    wrapper; listAssets for sidebar paths). The wrapper handler omits
    `event.stopPropagation()` since it is the outermost guarded
    element.

    Spec recommends `stopPropagation()` on the inner handlers (the
    pattern is symmetric and self-documenting) rather than the
    alternative `event.target !== ...` filter approach in the wrapper
    handler. Either approach must be wired, or a single inner-element
    drop will fire two handlers (the inner handler AND the bubbled
    wrapper handler) → double upload of the same file.
  - Textarea drop computes the drop offset via
    `document.caretPositionFromPoint` (Firefox-spec name) with a fallback to
    `document.caretRangeFromPoint` (Chrome/WebKit legacy alias); both
    chromium-class browsers and Firefox are covered. If both return null
    (e.g., jsdom in tests, or older browsers), fall back to `lastOffset`.
  - Drop handler calls `uploadAsset` then `insertAtCursor` for each file. See
    UI / Interaction § "Drop on textarea" for sequential-vs-parallel and
    the in-flight-drop UI state.
  - `refreshKey: number` is a **`$bindable` prop** (Svelte 5 two-way),
    forwarded to `AssetSidebar` and to `ItemEditPage` (via
    `bind:refreshKey`). Default `0`; sidebar re-fetches on **any change**
    to the prop (so `++` is the natural mutation pattern). **Three write
    sites:**
    (a) `ItemEditPage` bumps after a successful content save (drives
    `is_referenced` re-evaluation),
    (b) `MarkdownEditor`'s textarea drop handler bumps after each
    successful upload, and
    (c) `MarkdownEditor`'s `.edit-content` wrapper drop handler bumps
    after each successful upload (both (b) and (c) drive the new asset
    to appear in the sidebar list for upload paths that don't run
    inside `AssetSidebar`). Sidebar-initiated uploads (file picker,
    sidebar drop zone, sidebar root `<aside>` handler) refresh via the
    sidebar's own upload-success closure and do NOT bump `refreshKey`
    (would double-fetch). This is the single signal that ties all
    upload paths to a list refresh.
- **MODIFIED** `frontend/src/pages/editor/ItemEditPage.svelte` — adds a
  `let refreshKey = $state(0)` declaration, forwards it via
  `<MarkdownEditor bind:refreshKey={refreshKey} />` ($bindable two-way),
  and bumps `refreshKey++` after a **successful** content save (the
  `result === 'ok'` branch of the existing save flow — NOT on error).
  Sidebar then re-fetches and `is_referenced` flags reflect the latest
  `AssetReference` rows. The same `refreshKey` is also bumped from
  inside `MarkdownEditor` on textarea/wrapper drop upload success
  (see above); `ItemEditPage` doesn't see or care about that — it's
  just a shared counter.

### ReadOnly mode

When `MarkdownEditor` is mounted with `readOnly` (disabled version, or
preview-only contexts), the sidebar is **not rendered at all**. There's no
edit cursor to insert into, and the backend 403s upload/delete on disabled
versions anyway. Avoiding the mount also avoids a spurious GET that would
otherwise be ignored.

### Boundary summary

| Concern | Owner |
|---|---|
| `uploadAsset` / `listAssets` / `deleteAsset` API calls + multipart + error mapping + 401 → emitUnauthorized + `AssetResponse` type | `lib/assets.ts` |
| List rendering, thumbnails, sidebar root-level + drop-zone drop handling (synchronous stopPropagation), file picker, click-to-insert callback, delete UI, first-time banner copy, **rendering** of "Uploading…" transient row and inline error region (state shared via $bindable) | `AssetSidebar.svelte` |
| `lastOffset`, `cursorReady` (one-way), **shared `uploading`** ($bindable, synchronous-write), **shared `uploadProgress`** ($bindable), **shared `uploadError`** ($bindable), textarea drag-drop (synchronous stopPropagation), edit-content-wrapper drop guard, `insertAtCursor` (with null-textarea guard), conditional sidebar mount, **`refreshKey` bump on textarea/wrapper drop upload success** ($bindable two-way with `ItemEditPage`), `formatRef` import from `lib/assets.ts` | `MarkdownEditor.svelte` |
| Save lifecycle (own existing flow), `refreshKey` declaration + `bind:refreshKey` forward + bump on save success | `ItemEditPage.svelte` (and any future host of `MarkdownEditor`) |
| Asset reference sync (`AssetReference` rows for item/question/info contexts) | Backend (`render_with_assets`) — unchanged |

**Shared `uploading` state via `$bindable`:** the re-entrancy guard and the
"Upload in progress" overlay need to coordinate across all five upload entry
points (textarea drop, `.edit-content` wrapper drop, sidebar drop zone,
sidebar root `<aside>` handler, sidebar file picker). The single source of
truth is `MarkdownEditor`'s
`uploading = $state(false)`, exposed to `AssetSidebar` via
`bind:uploading` (declared `$bindable` on the sidebar side). When an
AssetSidebar-path upload starts, the sidebar sets `uploading = true`; when
done, `false`. MarkdownEditor's textarea/wrapper drop handlers do the same.
Both components check `uploading` before starting a new batch and refuse to
re-enter. Both render the overlay while `uploading === true`.

**Synchronous write requirement (TOCTOU fix):** every upload entry point —
in BOTH components — must set `uploading = true` SYNCHRONOUSLY in the
same microtask as the guard check, before issuing any `await`. The handler
shape is:

```ts
function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();               // synchronous, FIRST — before guards
  if (uploading) { /* show 1.5s flash, return */ return; }
  uploading = true;                  // synchronous, same tick as the guard
  uploadError = null;                // clear stale error from a prior batch
  const files = Array.from(e.dataTransfer.files);  // hoisted for catch block
  let i = 0;
  try {
    for (; i < files.length; i++) {
      uploadProgress = { current: i + 1, total: files.length, filename: files[i].name };
      const asset = await uploadAsset(...);   // first await
      // entry-point-specific work: insertAtCursor + refreshKey++ for
      // textarea drop; refreshKey++ only for wrapper drop; listAssets()
      // for sidebar paths.
    }
  } catch (err) {
    uploadError = {
      detail: err.detail ?? 'Could not reach server. Check your connection.',
      stoppedAt: files.length > 1 ? { n: i + 1, m: files.length } : undefined,
    };
  } finally {
    uploading = false;
    uploadProgress = null;
    // uploadError is NOT reset here — error must persist until the user
    // dismisses (× button) or the next successful batch clears it at
    // the top of its try block.
  }
}
```

Without the synchronous flag write, two near-simultaneous drops (e.g.,
user double-drops a file in <16ms) both pass the guard before either
writes the flag, producing concurrent upload loops. Without synchronous
`stopPropagation()`, a single inner-element drop bubbles to the wrapper
handler before any `await` returns, causing double upload. Re-entrancy
guards in `AssetSidebar`'s file-picker change handler and sidebar drop
handler follow the same shape.

**Why upload logic doesn't live in `AssetSidebar`:** two components own
upload entry points — `MarkdownEditor` (textarea drop, `.edit-content`
wrapper drop) and `AssetSidebar` (file picker, drop zone, root `<aside>`
handler). Both must call the same upload helper to share error
semantics, sequential queueing, and progress UI. Putting the helper in
`lib/assets.ts` (a pure module) lets both `AssetSidebar` and
`MarkdownEditor` call it directly,
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
- Asset row: thumbnail box (image `<img loading="lazy" src="/assets/{vid}/{filename}">` for image mime types; extension chip e.g. `PDF` / `CSV` / `XLSX` / `PY` / `JS` — drawn from the actual ALLOWED_EXTENSIONS list — for others) + filename + file size in muted subtitle + a small `used` badge when `is_referenced === true` (no badge otherwise — less visual noise).
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
  - `{filename}` is the **server-returned** value from
    `AssetResponse.filename` (i.e., the sanitized form). `{stem}` is that
    sanitized filename with the **last** extension stripped (one dot from
    the right). Examples (post-sanitization values):
    - `histogram.png` → stem `histogram` → `\n![histogram](histogram.png)\n`
    - `my-report-v2.pdf` (client `My Report v2.pdf`) → stem `my-report-v2`
    - `myreportv2.pdf` (client `my.report.v2.pdf`) → stem `myreportv2`
  - Because sanitization runs server-side at upload, the frontend never
    invents the stem from the original client filename — always from
    `AssetResponse.filename`.
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

### Drop on textarea and edit-content wrapper

Two drop targets need handlers, for different reasons:

1. **Textarea drop** — the productive path. `dragover` + `drop` listeners on
   the textarea element itself; drop computes a precise offset from
   `caretPositionFromPoint`/`caretRangeFromPoint` (with `lastOffset`
   fallback), uploads, and inserts the markdown reference at that offset.
   The textarea handler calls `event.stopPropagation()` to prevent the
   wrapper handler below from also firing (would otherwise double-upload).
2. **Edit-content wrapper drop** — the **data-loss guard**. `dragover` +
   `drop` listeners on an inner `<div class="edit-content">` wrapper that
   sits inside `{#if mode === 'edit' && !readOnly}` (NOT on the
   always-rendered outer `.editor`). A drop that lands on the wrapper's
   padding / inside the wrapper but not on the textarea does NOT fall
   through to the browser's default file-handler (which would navigate to
   `file://` and discard all unsaved edits). The wrapper handler treats
   the file as a sidebar-style upload: upload only, no auto-insert. User
   can then click the resulting sidebar row to insert if they meant to.
   **`refreshKey` behavior:** the wrapper handler **bumps `refreshKey++`**
   after each successful upload (writing to the `$bindable` prop shared
   with `ItemEditPage`). This is the single signal that drives
   `AssetSidebar` to re-fetch and surface the new row — same mechanism
   `ItemEditPage` uses post-save. Sidebar-initiated uploads (file picker,
   sidebar drop zone, sidebar root `<aside>` handler) do NOT bump
   `refreshKey`; the sidebar refreshes via its own upload-success
   closure instead (to avoid a double-fetch).
   In Preview mode the wrapper isn't rendered (the conditional), so no
   listeners are active — preview drops fall to the browser default
   (navigation), acceptable in V1 since admins in Preview aren't editing.

**Textarea drop algorithm:**

- `dragover`: `preventDefault()` (required so `drop` fires) + optional hover
  style on the textarea border.
- `drop`: `preventDefault()`. Compute `dropOffset` once at drop time via
  `caretPositionFromPoint` (or `caretRangeFromPoint` fallback, then
  `lastOffset`). Extract `e.dataTransfer.files`. For each file
  (sequentially, not concurrently):
  1. `uploadAsset(versionId, file)` — `await`.
  2. On success: `insertAtCursor(formatRef(filename, mimeType), atOffset=offset)`,
     then `refreshKey++` to signal `AssetSidebar` to re-fetch (so the new
     row appears with the correct `is_referenced` once the user saves).
     Subsequent files in the same drop advance `offset` by
     `formattedRef.length` (the length of the markdown string returned
     by `formatRef`, including the leading and trailing `\n`). Use the
     server's `mime_type` from the response.
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
  helper. No insertion — the file just appears in the list after upload
  (sidebar's own `listAssets()` re-fetch on upload-success). User clicks
  to insert later.
- **The `drop` handler MUST call
  `event.preventDefault(); event.stopPropagation();` as its first
  synchronous statements**, before the re-entrancy guard, the
  `uploading = true` write, or any `await`. DOM propagation is
  synchronous — stopping it after an awaited upload is too late, by
  which point the wrapper handler has already fired. AssetSidebar is
  rendered inside the `.edit-content` wrapper (which has its own
  data-loss-guard drop handler), so without synchronous stopPropagation
  a sidebar-drop bubbles to the wrapper and triggers a redundant
  upload + `refreshKey++`. The textarea drop handler enforces the same
  discipline — see the canonical drop-handler shape in the Boundary
  summary's "Synchronous write requirement" subsection (single source
  of truth).
- **Drops on AssetSidebar descendants outside the drop zone** — asset
  rows, the list-empty area, the first-time banner, the error region:
  these all bubble through the sidebar's root `<aside>` (or equivalent
  root element). Spec choice: install a root-level `dragover` +
  `drop` handler on AssetSidebar's root element. The root handler
  starts with `event.preventDefault(); event.stopPropagation();` as
  its first synchronous statements (same discipline as the drop-zone
  handler). It is upload-only (no insert) and routes through the
  same upload helper as the drop zone. The drop zone is still rendered
  as the discoverable affordance, but drops anywhere inside the
  sidebar boundary behave consistently (upload, appear in list). This
  is simpler than trying to discriminate "drop zone vs everywhere
  else" and matches user intuition: a drop inside the visible sidebar
  boundary is meant for the sidebar.

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
| Drop arriving WHILE uploading | Sidebar drop zone + textarea both display a `Upload in progress — please wait` overlay state (red border / muted background) for 1.5s; the dropped file is silently discarded. After the 1.5s the overlay fades, BUT `uploading === true` is still in effect — the sidebar's "Uploading file {N} of {M}…" transient row remains visible as the persistent busy signal. A second drop arriving after the overlay fade but before upload completion is still discarded, and re-shows the 1.5s overlay. The flash overlay signals the rejected drop; the transient row signals "still busy". |
| Upload error (any) | Inline error region at top of sidebar with server's `detail` text, dismissable via `×`. Multi-file: "Upload stopped at file {N} of {M}" prefix. |
| Delete error | Same channel as upload error |
| Disabled-version upload/delete error | Inline error "Version is disabled" + disable drop zone + hide trash icons. Sidebar list itself stays populated since LIST doesn't 403 on disabled. |
| `used` badge hover | Tooltip: "Remove this reference from content and save to enable delete." Makes the absent trash icon discoverable. |
| First-time sidebar click before textarea ever focused | Insert proceeds at `lastOffset` (= `value.length`, i.e., end of content). A one-time muted banner at the top of the sidebar — "Click in the editor to position the cursor, or new assets will be appended to the end." — is visible until `cursorReady === true` (set on first textarea `focus` OR first `onInsert` call). |

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
| 409 "Asset '{X}' already exists in this version" | Inline error verbatim PLUS UI hint: "Rename the file on disk and re-upload." (V1 has no in-browser rename.) **`{X}` is the SANITIZED filename**: see the "sanitize_filename" assumption — spaces/underscores become hyphens, other non-`[a-z0-9-]` chars are stripped. E.g., `My Image.PNG` → error references `my-image.png`; `histogram.png` (already sanitized form) → error references `histogram.png` unchanged. |
| 500 "Failed to write asset to disk" | Inline error + re-fetch list (backend already rolled back the registry row) |
| Network failure | Inline error "Could not reach server. Check your connection." |

All upload errors come from the `ApiError` class — `lib/assets.ts` constructs
one from the non-2xx response body (since `uploadAsset` uses raw `fetch`, not
`api.post`). `listAssets` and `deleteAsset` use the existing `api.get` /
`api.delete` wrappers which already produce `ApiError`.

### Cross-channel: save 422 from unknown asset filenames

`render_with_assets` raises **422 "Referenced assets not found in version:
…"** when `content_md` references a bare filename with no matching `Asset`
row. This is a content-save error (from `PATCH /api/items/{id}` save —
the existing item-edit endpoint), NOT an asset-upload error. It can occur if:

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
- **Drop on edit-content wrapper vs textarea vs preview:**
  - Textarea drop → uploads + inserts at drop offset (the productive path).
    Textarea handler calls `stopPropagation` so the wrapper handler does
    NOT also fire (no double-upload).
  - `.edit-content` wrapper drop (anywhere inside the wrapper but not on
    the textarea precisely) → uploads only (data-loss guard); user clicks
    the resulting sidebar row to insert.
  - Drop on the rendered preview area (in Preview mode) — no listeners
    (the wrapper isn't rendered in Preview, the textarea isn't either).
    Browser default behavior (navigates to `file://`). Accepted V1
    tradeoff: admins in Preview mode aren't actively editing.
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
  muted banner at the top of the sidebar — "Click in the editor to position
  the cursor, or new assets will be appended to the end." — is visible
  until `cursorReady === true`. The banner clears when **either**:
  (a) the textarea receives its first `focus` event, OR
  (b) `onInsert` is called for the first time (the user just learned by
      doing). Both paths set `cursorReady = true`. After clearing, the
  banner stays hidden for the mount lifetime.
- **Banner across Edit↔Preview round-trips:** the sidebar is unmounted on
  Preview-mode toggle and remounted on return. `cursorReady` lives in
  `MarkdownEditor` (not unmounted by the tab toggle), so it survives the
  round-trip. The banner stays hidden after first focus, even after
  switching to Preview and back.
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
  `credentials: 'include'`, **`X-Requested-With: mathion` header set**
  (matches `api.ts:request` — backend mutating endpoints check this
  header in `backend/mathion/dependencies.py:14`), and **no `Content-Type`
  header** (browser sets the multipart boundary).
- `uploadAsset` propagates `ApiError` with status + detail for each error
  class (400 ext, 400 size, 400 total-size, 400 no-filename, 403 disabled,
  409 already-exists, 500 disk-write, network failure). The cross-channel
  422 "Referenced assets not found in version: …" is **NOT** an upload
  error — it surfaces through `PATCH /api/items/{id}` (the save flow) via
  `ItemEditPage`'s existing save-error path (`mapCreateError` /
  `createGlobalError`). No automated test in `uploadAsset` covers it;
  the existing item-edit save-error tests cover the surfacing channel,
  and smoke step 17 exercises it end-to-end.
- `uploadAsset` on 401: calls `emitUnauthorized(location.pathname +
  location.search + location.hash)` (mirrors `api.ts:request` exactly —
  all three location parts, not just pathname + search) BEFORE throwing.
  Test stubs the events module and asserts the call with all three
  parts concatenated.
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
- File picker → calls `uploadAsset` → writes `uploadProgress` /
  `uploadError` through $bindable → refreshes list via own closure.
- Drop on sidebar drop zone → same upload path. Verify the handler
  calls `stopPropagation` synchronously (assert via spy that
  `stopPropagation` was called BEFORE `uploadAsset` started awaiting).
- Drop on sidebar root (anywhere inside the sidebar `<aside>` but not
  on the drop zone, e.g., on a list row's empty area) → same upload
  path, no insertion.
- Trash icon hidden when `is_referenced === true`; the `used` badge is
  visible with the tooltip text. Trash visible (on hover) when
  `is_referenced === false`. Click → inline confirm → `deleteAsset` → refresh.
- **Transient row from shared `uploadProgress`:** mount sidebar with
  `uploadProgress = { current: 2, total: 5, filename: 'foo.png' }` →
  asserts "Uploading file 2 of 5…" row renders.
- **Inline error region from shared `uploadError`:** mount with
  `uploadError = { detail: 'File size … exceeds max …', stoppedAt: { n: 3, m: 5 } }`
  → asserts "Upload stopped at file 3 of 5: File size … exceeds max …"
  renders. Click `×` button → assert `uploadError` is written to `null`
  through the $bindable.
- `refreshKey` prop change (any change, not just increment) triggers a
  re-fetch.
- Banner copy "Click in the editor to position the cursor, or new assets
  will be appended to the end." (canonical literal — see state table
  row "First-time sidebar click before textarea ever focused") is
  visible when the sidebar's `cursorReady` prop is `false` and hidden
  when `true`. `cursorReady` is owned by `MarkdownEditor` (it knows when
  the textarea is first focused or first onInsert fires). Read-only from
  the sidebar — sidebar does NOT write to `cursorReady`. Default
  `false`; flips to `true` on textarea's first `focus` event OR on
  `MarkdownEditor`'s first `onInsert` handling, and stays true for the
  session.

### `MarkdownEditor.svelte` extended tests (vitest + jsdom)

The current file has no test (`src/tests/MarkdownEditor.test.ts` does not
exist yet); this task creates it from scratch.

- Existing render/mode behavior covered (Edit/Preview tab toggling,
  `loadPreview` lifecycle, `readOnly` mode).
- `insertAtCursor`: programmatic invocation via a simulated event path
  (drag-drop event with `dataTransfer.files`, or a programmatic
  `onInsert` invocation from the mounted sidebar) splices at the
  selection and restores cursor position just after the inserted text.
  NO test-only export — the helper is a local closure inside
  `MarkdownEditor`; tests reach it only through public surfaces (drop
  events on the textarea, sidebar click → `onInsert` callback).
- `insertAtCursor` null-textarea guard: simulate Edit→Preview toggle
  while an upload promise is still pending (textarea ref becomes null),
  then resolve the upload. Verify `insertAtCursor` returns silently
  without throwing AND `refreshKey++` still fires (so the sidebar sees
  the new asset when the user returns to Edit). The
  refreshKey bump happens in the drop handler after `uploadAsset`
  resolves, separately from the `insertAtCursor` call.
- `lastOffset` tracks textarea `blur` and `selectionchange`. Initial value
  is `value.length`. After programmatic textarea cursor moves, `lastOffset`
  reflects the latest selection.
- `cursorReady` is `false` on mount and flips to `true` on EITHER the
  textarea's first `focus` event OR the first `onInsert` call from the
  sidebar — verified separately. Once true, stays true for the mount
  lifetime (survives Edit↔Preview round-trips because `MarkdownEditor`
  doesn't unmount on tab toggle).
- `uploading` is `false` on mount. While a textarea-drop batch is in
  flight, `uploading === true` and a second drop on the textarea is
  refused (re-entrancy guard) and shows the 1.5s overlay flash.
- **TOCTOU on `uploading`:** fire TWO `drop` events on the textarea
  back-to-back **within the same microtask** (no awaited yields in
  between — use a synchronous test scheduler or
  `Promise.all([fire1, fire2])` with the drop handlers stubbed to
  delay). Verify `uploadAsset` is called exactly ONCE — the second
  drop's synchronous guard check sees `uploading === true` (set
  synchronously by the first drop before its first `await`) and
  rejects. Without the synchronous-set discipline this test fails.
- `bind:uploading` two-way: simulate sidebar setting `uploading = true`
  (e.g., starting a file-picker upload); textarea-drop in the same moment
  is rejected.
- Drag-drop on textarea: stub `dataTransfer.files` + `clientX`/`clientY`,
  fire `drop`, assert `uploadAsset` called and text inserted at the
  drop-offset, AND assert `refreshKey` was incremented (the $bindable
  write). `document.caretPositionFromPoint` and `caretRangeFromPoint`
  are both stubbed to return a known offset; if both return null, the test
  verifies fallback to `lastOffset`.
- Drag-drop on the `.edit-content` wrapper (the data-loss guard): fire
  `dragover` and `drop` on the wrapper `<div>` (target is the wrapper, not
  the textarea), assert `preventDefault` is called and `uploadAsset` is
  called with upload-only behavior (no insertion), AND assert `refreshKey`
  was incremented (so the sidebar will re-fetch and show the new row).
- **No double-fire on textarea drop:** fire `drop` on the textarea with a
  realistic event, assert `uploadAsset` is called exactly ONCE (the
  textarea handler), NOT also by the wrapper handler. Verifies
  `stopPropagation()` (or equivalent guard) is wired.
- **No double-fire on sidebar drop:** mount `MarkdownEditor` with the
  sidebar nested as in production. Fire `drop` on the sidebar's drop
  zone with a realistic event. Assert:
  (a) `uploadAsset` is called exactly ONCE (the sidebar handler), NOT
      also by the wrapper handler.
  (b) `refreshKey` is NOT bumped by `MarkdownEditor`'s wrapper handler
      (the sidebar refreshes its list via its own upload-success closure;
      a wrapper bump would mean stopPropagation failed and the wrapper
      handler also fired).
  Verifies the sidebar drop handler's `stopPropagation()` prevents the
  wrapper handler from also firing for the same event.
- Re-entrancy guard: while `uploading === true`, a second `drop` does not
  start a second loop; visual signal state is set briefly.
- Multi-file drop: sequential upload-then-insert; on mid-batch error, the
  loop aborts and the error includes "Upload stopped at file N of M".
- In `readOnly` mode, no sidebar element is rendered (queried by selector).
- Sidebar receives forwarded props: `refreshKey` (as regular one-way
  prop to the sidebar; the `$bindable` two-way is between
  `MarkdownEditor` and `ItemEditPage`), `versionId`, `cursorReady`,
  `onInsert`, `bind:uploading`, `bind:uploadProgress`,
  `bind:uploadError`.
- **Shared `uploadProgress` write from MarkdownEditor:** simulate a
  textarea-drop batch in flight; assert that as the loop advances,
  `uploadProgress` is written with `{ current, total, filename }` and
  that the sidebar's transient row reflects the latest values. After
  the batch (success or error) `uploadProgress === null`.
- **Shared `uploadError` write from MarkdownEditor:** simulate a
  multi-file textarea-drop where the 3rd of 5 files errors; assert
  `uploadError === { detail: '<server detail>', stoppedAt: { n: 3, m: 5 } }`
  and the sidebar's error region renders "Upload stopped at file 3 of
  5: <detail>". Simulate the user clicking the sidebar `×` dismiss
  button and assert `uploadError === null` (the sidebar writes through
  the $bindable).

### `ItemEditPage.svelte` tests (vitest + jsdom)

The existing ItemEditPage test file covers save flow. This task adds:

- `refreshKey` declared as `$state(0)` and forwarded via
  `bind:refreshKey` to `MarkdownEditor`.
- After a successful save (`result === 'ok'` branch), `refreshKey` is
  bumped exactly once.
- After a failed save (non-ok result), `refreshKey` is NOT bumped.
- On the user discarding edits (or any other non-save exit), `refreshKey`
  is NOT bumped.
- `bind:refreshKey` round-trip: simulate `MarkdownEditor` writing
  `refreshKey++` (as it does on textarea/wrapper drop upload success);
  assert the parent `ItemEditPage`'s state is updated (no separate
  re-render path needed — Svelte 5 reactivity handles it).

### Manual smoke (in the eventual plan's final task)

1. Upload an image via the sidebar's file picker → appears in sidebar with
   thumbnail.
2. Click the image row → markdown reference appears in textarea at the
   current cursor. Switch to Preview → image renders.
3. **First-time banner — focus path**: hard-reload the page on an item
   where you haven't clicked the textarea. Confirm the banner is visible:
   "Click in the editor to position the cursor, or new assets will be
   appended to the end." Click in the textarea — banner disappears.
4. **First-time banner — insert path**: hard-reload (full page reload, NOT
   same-tab navigation) and immediately click a sidebar row WITHOUT
   clicking the textarea. Verify the reference is inserted at the END of
   existing content. Verify the banner ALSO clears after this first
   insert (the second clear-path).
5. **Textarea drop**: drag an image into a specific position inside the
   textarea (e.g., mid-paragraph). Verify (a) the inserted markdown
   appears on the line corresponding to the drop point, NOT at the end,
   and (b) the inserted text is preceded and followed by blank lines (the
   `\n…\n` wrap), with the text before and after the drop point intact.
6. **Edit-content-wrapper drop guard**: drag a file and drop it 10px ABOVE
   the textarea (on the wrapper's padding area, NOT on the textarea).
   Verify the browser does NOT navigate away (no `file://` redirect,
   unsaved edits intact) and the file appears in the sidebar (upload only,
   no insert).
7. **No double-fire on textarea drop**: note the asset count before
   dropping. Drop a single file precisely on the textarea. Verify the
   asset list grows by exactly ONE row (count after − count before = 1,
   NOT 2), confirming the textarea handler's `stopPropagation` prevents
   the wrapper handler from firing for the same event.
8. **Same-filename re-upload**: drop the SAME filename twice → second
   drop triggers a 409 inline error. Verify the error message uses the
   **sanitized** filename and includes the hint "Rename the file on disk
   and re-upload."
9. **Disallowed extension**: drop a `.exe` → 400 inline error.
10. **Oversize file**: drop a file larger than `max_file_size` → 400 inline
    error with byte numbers (raw integers, no KB/MB units in V1).
11. **Reference + save + sidebar refresh**: reference an asset in
    content_md, save. Verify the sidebar refreshes via `refreshKey`, the
    `used` badge appears, and the trash icon disappears. Hover the badge →
    tooltip explains the workflow.
12. **Unreference + save**: remove the reference from content_md, save.
    Verify the `used` badge disappears and the trash icon (on hover) is
    back. Click trash → inline confirm → delete → row disappears.
13. **Multi-file drop with mid-batch 400**: drop 5 files at once where one
    is oversize. Verify files before the error are uploaded and inserted;
    files after the error are NOT. Error message includes "Upload stopped
    at file N of 5".
14. **Multi-file drop with mid-batch network failure**: open DevTools →
    Network and set throttling to Slow 3G FIRST (so the upload is slow
    enough to switch to Offline mid-batch). Drop 3 files; while file 1
    or 2 is uploading, flip Network to Offline. Verify the message
    begins "Could not reach server" with the "Upload stopped at file N
    of 3" context.
15. **Drop-while-uploading**: open DevTools → Network → Slow 3G (or
    equivalent throttling, since a local upload completes too fast
    otherwise). Drop a file, then drop a second file mid-upload. Verify
    the second drop is discarded with the 1.5s overlay flash (overlay
    fade timer is anchored at the moment of the discarded drop, not at
    upload start), while the "Uploading…" transient row remains visible
    the entire time.
16. **Edit → Preview → Edit round-trip**: upload a file in Edit mode,
    switch to Preview, switch back. Verify (a) the new file is still in
    the sidebar (list re-fetches on remount), (b) no stale state like an
    open delete-confirm carries over, (c) the first-time banner stays
    hidden if it was previously cleared (`cursorReady` survives the
    round-trip because it lives in `MarkdownEditor`, not the sidebar).
17. **Save 422 (cross-channel)**: type `![ghost](does-not-exist.png)` in
    the textarea and save (PATCH). Verify the 422 surfaces via the
    existing item save-error path (not in the sidebar). Sidebar's
    existing list is unchanged.
18. **Disabled version**: disable the version via the version-meta panel,
    then navigate away from the item and return (or full page reload).
    Verify the sidebar is not rendered (readOnly mode). Re-enable, return:
    sidebar comes back.

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
MarkdownEditor → refreshKey++ ($bindable write)
  ↓
AssetSidebar (via prop change) → listAssets() → row appears
  (is_referenced still false here — the textarea now has the reference
   but content_md hasn't been saved yet)
  ↓
[Later] ItemEditPage → refreshKey++  (after the eventual content save)
  ↓
AssetSidebar → listAssets() → re-render with is_referenced=true
```

### Drop on .edit-content wrapper (data-loss guard)

```
User drops file.png on the wrapper's padding / the gap between textarea
and sidebar — NOT on the textarea, NOT inside the sidebar boundary
  ↓
.edit-content div: synchronous preventDefault + (no stopPropagation
  needed — this is the outermost guarded element)
  ↓ (prevents browser navigation to file://)
lib/assets.ts → uploadAsset(versionId, file)
  ↓
POST /api/versions/{vid}/assets
  ↓
Backend: returns AssetResponse
  ↓
MarkdownEditor → refreshKey++ ($bindable write)
  ↓
AssetSidebar (via prop change) → listAssets() → re-render with new row
  (no auto-insert — user clicks to insert if intended)

Notes on event propagation (both inner handlers stop propagation
synchronously, so the wrapper handler runs ONLY for "true outside" drops):
- A precise drop on the textarea fires the textarea handler only — its
  synchronous stopPropagation prevents the wrapper handler from also
  firing.
- A drop anywhere inside the sidebar boundary (drop zone, asset row,
  empty list area, banner) fires the sidebar handler (drop-zone OR
  root-level <aside> handler) only — both call synchronous
  stopPropagation, so the wrapper handler does not fire and refreshKey
  is NOT bumped by MarkdownEditor for sidebar-interior drops (the
  sidebar refreshes via its own upload-success closure).
```

### Drop on sidebar interior (drop zone OR rows OR list area OR banner)

```
User drops file.png anywhere inside the sidebar's <aside> boundary
  ↓
AssetSidebar drop handler (drop zone if precise, root-level <aside>
  handler otherwise): synchronous preventDefault + stopPropagation
  ↓ (wrapper handler does NOT fire — synchronous stopPropagation)
lib/assets.ts → uploadAsset(versionId, file)
  ↓
POST /api/versions/{vid}/assets
  ↓
Backend: returns AssetResponse
  ↓
AssetSidebar internal closure → listAssets() → re-render with new row
  (no auto-insert — user clicks to insert if intended)
  (no refreshKey bump — sidebar paths refresh via own closure to avoid
   double-fetch)
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
- After each **sidebar-initiated** successful upload (file picker,
  sidebar drop zone, sidebar root `<aside>` handler — each file in a
  multi-file batch) — runs inside the sequential loop so each new
  asset becomes visible without waiting for the batch to finish. This
  is the sidebar's internal upload-success closure; does NOT route
  through `refreshKey`.
- After successful delete.
- When `refreshKey` prop changes. Three writers bump it:
  1. `ItemEditPage` after a successful content_md save (drives
     `is_referenced` re-evaluation).
  2. `MarkdownEditor`'s textarea drop handler after each successful
     upload in the loop.
  3. `MarkdownEditor`'s `.edit-content` wrapper drop handler after each
     successful upload in the loop.
  (`MarkdownEditor` writes via the `$bindable` declaration; the parent
  sees the changes too.)

## File structure

| File | Status | LOC estimate |
|---|---|---|
| `frontend/src/lib/assets.ts` | NEW | ~100 (helper module + `AssetResponse` type + raw-fetch upload + error mapping) |
| `frontend/src/tests/assets.test.ts` | NEW | ~150 |
| `frontend/src/components/editor/AssetSidebar.svelte` | NEW | ~220 (template + script + style; first-time banner adds ~15 LoC over the prior estimate) |
| `frontend/src/tests/AssetSidebar.test.ts` | NEW | ~220 |
| `frontend/src/components/editor/MarkdownEditor.svelte` | MODIFIED | +110 / -10 (DOM restructure with edit-content wrapper, two MarkdownEditor-owned drag-drop surfaces — textarea and `.edit-content` wrapper — with synchronous preventDefault + stopPropagation, lastOffset / cursorReady / uploading / uploadProgress / uploadError state, sidebar mount + bind:uploading + bind:uploadProgress + bind:uploadError + bind:refreshKey) |
| `frontend/src/tests/MarkdownEditor.test.ts` | NEW | ~150 (added: shared progress/error write tests, sidebar drop bubble test) |
| `frontend/src/pages/editor/ItemEditPage.svelte` | MODIFIED | +4 / -0 (state declaration + `bind:refreshKey` forward + bump in save success branch) |
| `frontend/src/tests/ItemEditPage.test.ts` | MODIFIED | +30 (new focused tests for `refreshKey` save-success bump and `bind:refreshKey` round-trip — only if the existing test file is structured to accommodate; otherwise NEW `ItemEditPage.refreshKey.test.ts` ~40 LoC) |

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
5. `MarkdownEditor.svelte` textarea drag-drop + `.edit-content` wrapper drop guard
   + re-entrancy guard + multi-file sequential loop + tests.
6. `ItemEditPage.svelte` `refreshKey` declaration + `bind:refreshKey`
   forward + bump on save success + focused tests (save-success bumps,
   non-save paths don't, $bindable round-trip).
7. Final verification: pytest unchanged, svelte-check, vitest, manual
   smoke (18 steps above).

Still smaller than auto-slug-from-title (which was 12 tasks across backend
+ frontend), but the original 5-6 estimate undercounted the work in
`MarkdownEditor`. The added task splits drag-drop into its own task
(separable, larger change) and isolates delete-UI from initial sidebar
shell.
