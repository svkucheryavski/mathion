# Mini-Projects Authoring Frontend (slice A)

**Date:** 2026-05-24 (revised twice after two 5-reviewer passes)
**Status:** Approved for implementation planning
**Slice:** Admin/teacher mini-project authoring only (CRUD, publish, run-assets). Read-only dashboard matrix deferred to slice B.
**Parent specs:**
- `docs/superpowers/specs/2026-04-27-phase7b-mini-projects-design.md` — backend mini-projects/submissions/evaluations/run-assets
- `docs/superpowers/specs/2026-05-01-phase7c-dashboards-design.md` — backend `/dashboard/mini-projects` matrix endpoint (consumed in slice B)
- `docs/superpowers/specs/2026-05-19-run-management-admin-design.md` — the just-merged run-management admin frontend whose patterns this slice extends

## Goal

Give course-admins a UI to create, edit, publish, and delete mini-projects on a run, and manage the run-scoped asset pool that mini-project markdown references. Lands as the 5th tab ("Mini-projects") on `RunDetailPage`. Reuses the run-management conventions established by the previous slice.

## Non-Goals

- Teacher review surface for submissions + evaluations — slice B.
- Student-facing flow (read assignment, submit PDF, view feedback) — slice C.
- **Read-only MPs × groups dashboard matrix** — deferred to slice B (where matrix cells become clickable into the submission/evaluation surface, giving the matrix real value beyond duplicating the per-row pills already in this slice's list).
- Editing locked mini-projects (those with submissions). `[Edit]` is hidden on locked rows in this slice; locked-MP deadline-extend lands in slice B.
- **Optimistic-concurrency / concurrent-edit detection.** Phase 9 has proper `If-Match` slated. On a low-frequency authoring surface, an `updated_at` refetch-and-compare adds complexity (extra round-trip, never-converging Reload/Continue UX, toast component that doesn't support buttons today) without solving the underlying race. This slice accepts silent overwrite. The only mitigation: if the server returns a 409 the modal already surfaces it as an inline banner with the server message; the user can refresh manually.
- **Route-level DirtyGuard wiring.** `DirtyGuard` is route-level (`registerNavigationGuard` + `beforeunload`) and doesn't catch modal-internal close. Modal-internal dirty-confirm lives in `closeForCurrentStage` via an inline footer-row pattern (see modal section). Route-level guard wiring lands in slice B alongside longer-lived edit views.
- Optimistic UI updates. MP authoring is low-frequency; refetch round-trips are fine.
- Scheduled deadline notifications, email delivery (Phase 9).
- Full Phase 7c teacher progress dashboard (sequences × students coverage).

## Decisions Already Fixed by Parent Specs

*Backend `*.py:line` citations throughout this spec are relative to `backend/mathion/api/` unless otherwise prefixed (e.g. `backend/mathion/assets.py`, `backend/mathion/config.py`, `backend/mathion/schemas.py`, `backend/mathion/api/helpers.py`).*

| Decision | Source |
|---|---|
| One mini-project per `(run, block)` | Phase 7b §"Decisions Already Fixed by Master Spec" |
| `is_published` is one-way; only path to remove a published MP is force-delete | Phase 7b §"Phase 7b Extensions" |
| Locked = `first_submitted_at IS NOT NULL`; orthogonal to `is_published` | Phase 7b §"Phase 7b Extensions" |
| Mini-projects require `run.groups_enabled = True` | Phase 7b §"Phase 7b Extensions" |
| Mini-projects require `run.is_published = True` to publish | `mini_projects.py:259-260` |
| Force-delete requires course-admin (`require_course_admin`), not run-teacher | `mini_projects.py:206-209` |
| Locked-MP deadline edits are **extend-only**, non-null → null forbidden | `mini_projects.py:148-159`. Out of scope this slice. |
| Run-asset delete blocked when ref count > 0 (409); force-delete course-admin-only | `run_assets.py:188`, `run_assets.py:200` |
| Mini-project title derived as `f"Mini project for Block {block.order}"` | `mini_projects.py:44` |
| **`GET /api/courses/by-slug/{slug}` and `GET /api/versions/{vid}/blocks` are course-admin-gated.** | `courses.py:77-80`, `blocks.py:99` |

**Consequence of the last row:** RunDetailPage is currently unreachable to run-teachers who aren't course admins. This slice accepts that: every action on the tab is course-admin-implicitly. The earlier draft included `isCourseAdmin` row-action gating; that ladder is removed since `course.is_admin` is always `true` for anyone who can load the page. Relaxing by-slug to admit run-teachers is a separate slice.

**Backend gating note:** the MP and run-asset mutation endpoints themselves use `require_run_admin_or_teacher` (not `require_course_admin`) per `mini_projects.py` and `run_assets.py`. Force-delete on MP and run-asset is the only exception — both narrowed to `require_course_admin` per `mini_projects.py:206-209` and `run_assets.py:188`. The page-reachability gate via by-slug is what currently constrains this slice to course-admins; if/when by-slug is relaxed in a future slice, the existing backend gating accepts run-teachers correctly without further frontend changes — **with one caveat:** the new `POST /api/runs/{rid}/render` endpoint in T1 should also be `require_run_admin_or_teacher` (NOT course-admin) to match the rest of the run-asset surface, so the same future relaxation works for preview as well as authoring.

## Scope Slice (Author only)

```
RunDetailPage
└── tabs: Overview | Teachers | Groups | Roster | Mini-projects (NEW)
    └── RunMiniProjectsTab
        ├── header bar: "Mini-projects"   [+ New mini-project]
        ├── (actionable banners: !groups_enabled / version disabled / !run.is_published)
        ├── (empty-state CTA if no MPs)
        └── MP list (rows sorted by block.order asc)
              each row: block label, deadlines summary (browser-local TZ), status pill
              actions:
                Draft (unlocked):     [Edit] [Publish…] [×]
                Published (unlocked): [Edit]            [×]
                Locked (any):                           [×]   ← force confirm
```

## Backend Touchpoints

### Consumed (already shipped — verified by second-pass fidelity review)

| Endpoint | Used by | File |
|---|---|---|
| `POST /api/runs/{rid}/mini-projects` | MP create | `mini_projects.py:57` |
| `GET /api/runs/{rid}/mini-projects` | tab load | `mini_projects.py:102` |
| `GET /api/mini-projects/{mpId}` | modal prefill on edit | `mini_projects.py:119` |
| `PATCH /api/mini-projects/{mpId}` | MP edit | `mini_projects.py:134` |
| `DELETE /api/mini-projects/{mpId}[?force=true]` | MP delete; force = course-admin-only | `mini_projects.py:192` |
| `POST /api/mini-projects/{mpId}/publish` | publish | `mini_projects.py:248` |
| `POST /api/runs/{rid}/assets` | run-asset upload | `run_assets.py:27` |
| `GET /api/runs/{rid}/assets` | sidebar asset list | `run_assets.py:99` |
| `GET /api/runs/{rid}/assets/{filename}` | sidebar image preview + rendered-markdown link target | `run_assets.py:122` |
| `DELETE /api/runs/{rid}/assets/{assetId}` | sidebar delete | `run_assets.py:177` |
| `GET /api/versions/{vid}/blocks` | populate block picker | `blocks.py:96` |

### New (this slice — backend addition)

| Endpoint | Why |
|---|---|
| `POST /api/runs/{rid}/render` | Mirrors `POST /api/versions/{vid}/render` (`versions.py:120`) but calls `render_with_run_assets(db, run_id, content_md)` (`helpers.py:421`). Lets the in-modal MarkdownEditor preview resolve `mathion:asset://...` refs against run-assets before save. Gated by `require_run_admin_or_teacher` (matches the rest of the run-asset surface — `run_assets.py` mutations + listing all use the same dep). Side-effect-free: `render_with_run_assets` only SELECTs + string-rewrites; `RunAssetReference` writes happen separately in `sync_run_asset_references` invoked only by PATCH/POST. ~20-line addition + 1 test. |

**No `version.is_disabled` enforcement added in this slice.** Spec gates UX-only via `versionIsDisabled` banner + disabled buttons. Acceptable for an internal tool. Future hardening sweep.

**Locked-MP delete 409 detail stays as-is.** Backend at `mini_projects.py:205` returns the fixed string `"Mini-project is locked (has submissions); use ?force=true"` with no submission count. Adding a count would mean a SELECT + message-format change in T1; deferred. UI uses generic copy ("This mini-project has submissions").

## New Frontend Modules

### `lib/miniProjects.ts`

```ts
listMiniProjects(runId: number): Promise<MiniProjectResponse[]>
getMiniProject(mpId: number): Promise<MiniProjectResponse>
createMiniProject(runId: number, body: MiniProjectCreate): Promise<MiniProjectResponse>
updateMiniProject(mpId: number, body: MiniProjectUpdate): Promise<MiniProjectResponse>
publishMiniProject(mpId: number): Promise<MiniProjectResponse>
deleteMiniProject(mpId: number, opts?: { force?: boolean }): Promise<void>
```

### `lib/runAssets.ts`

```ts
listRunAssets(runId: number): Promise<RunAssetResponse[]>
uploadRunAsset(runId: number, file: File, signal?: AbortSignal): Promise<RunAssetResponse>
deleteRunAsset(runId: number, assetId: number): Promise<void>
```

`uploadRunAsset` constructs `FormData` with field name `file`, matching the backend (`run_assets.py:30`). Passes `signal` to `fetch` for cancellation support.

**Client-side pre-validation constants (also exported by this module):**
```ts
// MUST stay in sync with backend `Settings.max_file_size` (config.py:9), default 20 MB.
// Backend value is env-overridable via MATHION_MAX_FILE_SIZE; a deploy bumping the
// backend constant must hand-update this. Spec accepts this drift risk for the slice
// (a /api/config/limits endpoint is the principled fix; future hardening).
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// MUST stay in sync with backend `ALLOWED_EXTENSIONS` (`backend/mathion/assets.py:4-9`).
// Backend list is 14 file types stored WITHOUT a leading dot; mirrored here exactly:
export const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'pdf',
  'csv', 'xls', 'xlsx', 'ppt', 'pptx',
  'r', 'py', 'm', 'js',
]);
// Validation normalizes user-uploaded filenames to bare lowercase extension
// (strip leading dot) before checking membership.
```

### `lib/assetContext.ts` (new abstraction)

The MarkdownEditor + AssetSidebar today are wired against `versionId` + `lib/assets`. They dispatch six operations that need to differ for run-assets: list, upload, delete, `imgSrc`, `renderPreview`, and the textarea drag-drop upload (which today calls `uploadAsset` directly). The cleanest fix is a small adapter object passed as one prop, replacing the current `versionId` prop.

```ts
export type AssetItem = {
  id: number;
  filename: string;
  mime_type: string;
  file_size: number;
  is_referenced: boolean;          // populated server-side on both course and run shapes
};

export type AssetContext = {
  kind: 'course' | 'run';            // for label switching ("Course assets" vs "Run assets")
  list(): Promise<AssetItem[]>;
  upload(file: File, signal?: AbortSignal): Promise<AssetItem>;
  remove(assetId: number): Promise<void>;
  imgSrc(item: AssetItem): string;
  renderPreview(content_md: string): Promise<{ html: string }>;
};

export function courseAssetContext(versionId: number): AssetContext { ... }
export function runAssetContext(runId: number): AssetContext { ... }
```

**URL prefix asymmetry (fidelity-reviewer Critical):** course assets are served at `/assets/{versionId}/{filename}` (NO `/api` prefix, per `assets.py:130`); run-assets at `/api/runs/{runId}/assets/{filename}` (per `run_assets.py:122`). Each factory's `imgSrc` must produce the right prefix. Tests assert the literal URL produced for both kinds.

**`renderPreview` URL routing:**
- `courseAssetContext`: `POST /api/versions/{vid}/render`
- `runAssetContext`: `POST /api/runs/{rid}/render` (the new T1 endpoint)

This is why there's no separate `lib/runRender.ts` — the run-render call lives inside `runAssetContext`.

**Factory instantiation:** call sites use `$derived(courseAssetContext(vid))` / `$derived(runAssetContext(rid))` so the adapter is memoized on its closed-over ID. A bare call on each render would create a new function-identity on every re-render and re-fire any `$effect` that depends on `assetContext`.

**Call-site migration:** `ItemEditPage` constructs `courseAssetContext(versionId)` and passes it to MarkdownEditor instead of the bare `versionId`. `MiniProjectModal` constructs `runAssetContext(runId)`. All other behavior preserved.

**`is_referenced` staleness during in-modal edit (feasibility-reviewer Critical):** The server-side `is_referenced` flag is computed from committed `*AssetReference` rows; `sync_*_asset_references` runs only on PATCH/POST commit. While the user is typing `![x](file.csv)` in the modal before save, `is_referenced` reads `false` even though they're about to reference it. **Spec accepts server-truth-only:** the trash button uses the server flag; if the user deletes an asset their unsaved markdown will reference, the markdown preview will subsequently 422 — they see the missing-asset error and re-upload. The existing course-asset behavior has the same property; documented here for symmetry.

### `lib/datetime.ts` (small new helper)

```ts
// Browser-local naive string "2026-06-07T23:59" → ISO 8601 UTC string ending in "Z".
// Implementation: new Date(naive).toISOString() — naive parsed as local per ECMA-262,
// then serialized as UTC. Backend accepts ISO with "Z" suffix (UTC-aware datetime).
// DST spring-forward: non-existent local times (e.g. "2026-03-29T02:30" in CET)
// normalize forward by +1h per ECMA-262 §21.4.3.2; tests assert this.
export function localInputToISO(value: string): string;

// Backend UTC ISO → naive local string for <input type="datetime-local">
export function isoToLocalInput(iso: string): string;

// Format a UTC ISO for human display in browser-local TZ, e.g. "2026-06-07 23:59 GMT+2".
export function formatLocalWithTz(iso: string): string;

// Browser-local TZ short offset (e.g. "GMT+2", "UTC") for form labels.
// Pinned to Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' }) for
// cross-browser stability; the unpinned 'short' option returns locale-dependent
// abbreviations (Chrome "GMT+2" vs Safari "CEST") that are test-flaky.
// Returned label is the CURRENT-instant offset, so the same teacher in the same
// city sees "(GMT+2)" in summer and "(GMT+1)" in winter — accepted; per-run pinned
// TZ is future work.
export function localTzLabel(): string;
```

All four are pure; tested in isolation with `TZ=Europe/Copenhagen` pinned via the existing `vitest.setup.ts` (extend it; do NOT create a fresh global setup that could silently change other tests' local-date behavior).

**Deadline values reflect the *current* browser TZ in the modal — `isoToLocalInput` converts stored UTC to whatever local the teacher is in now. A teacher traveling across TZs and reopening the modal will see deadline times shift accordingly. Accepted for this slice; explicit run-pinned TZ is future work.**

### Type additions in `lib/types.ts`

Mirror Pydantic schemas: `MiniProjectCreate`, `MiniProjectUpdate`, `MiniProjectResponse`, `RunAssetResponse`, and **`BlockResponse`** (currently absent from `lib/types.ts` — verified). Export `type MiniProjectRowStatus = 'draft' | 'published' | 'locked'`.

### `lib/blocks.ts` (new — currently absent from the frontend)

```ts
listBlocks(versionId: number): Promise<BlockResponse[]>
```

Single thin wrapper around `GET /api/versions/{vid}/blocks`. Consumed by `RunDetailPage.loadAll` to populate the block picker.

## Extended Existing Components

### `components/editor/MarkdownEditor.svelte`

**Prop signature change** (single existing call site — ItemEditPage):

Before: `{ versionId: number; value: string; readOnly?: boolean; refreshKey?: number }`
After: `{ assetContext: AssetContext; value: string; readOnly?: boolean; disabled?: boolean; refreshKey?: number; uploadAbortController?: AbortController | null }`

Internal changes:
- `loadPreview` calls `assetContext.renderPreview(value)`.
- Textarea drag-drop handler (today calls `uploadAsset(versionId, file)` at `:93`) becomes `assetContext.upload(file, controller.signal)`.
- `formatRef` (filename+mime → markdown snippet, `lib/assets.ts:69`) is shape-agnostic; reused unchanged.
- `AssetSidebar` instance receives the same `assetContext` (passed through), plus a `disabled` prop.
- **Upload-state ownership preserved**: the existing `uploading` / `uploadProgress` / `uploadError` $state lives in MarkdownEditor and is `$bindable` into AssetSidebar so that all three upload entry points (textarea drop, wrapper drop, sidebar drop) share a single overlay + error display. AssetSidebar still receives `bind:uploading`, `bind:uploadProgress`, `bind:uploadError`.
- **All three upload entry points route through one shared `uploadOne(file)` helper inside MarkdownEditor** (codex round-3 catch — without this, sidebar-initiated and textarea/wrapper-drop uploads can race; the later upload overwrites `uploadAbortController` and the earlier upload's `finally` clears the newer controller, so a Cancel either aborts the wrong upload or none). Helper shape:
  ```ts
  // Internal MarkdownEditor state.
  let editorMounted = $state(false);     // local mounted guard; flipped in onMount/onDestroy
  // $bindable upload state shown by both editor and sidebar:
  let uploading = $state(false);          // $bindable
  let uploadProgress = $state(null);      // $bindable
  let uploadError = $state(null);         // $bindable
  let uploadAbortController = $state(null); // $bindable<AbortController | null>

  async function uploadOne(
    file: File,
    batch?: { current: number; total: number }   // optional: passed by sidebar in multi-file drops to preserve existing "n of m" progress UX
  ): Promise<AssetItem | null> {
    if (uploading) return null;           // single-flight guard — second drop while one is in flight is a no-op
    const controller = new AbortController();
    uploadAbortController = controller;
    uploading = true;
    uploadError = null;
    uploadProgress = { current: batch?.current ?? 1, total: batch?.total ?? 1, filename: file.name };  // multi-file callers pass {i+1, files.length}; single-file callers fall back to 1/1. No per-byte fetch progress events available (XHR.upload.onprogress is a future enhancement, out of scope).
    try {
      const item = await assetContext.upload(file, controller.signal);
      if (!editorMounted) return null;    // codex round-4: abort()-then-resolve race — fetch may fulfill just before/despite abort; do not propagate post-destroy
      return item;
    } catch (e: any) {
      if (!editorMounted) return null;
      if (e?.name === 'AbortError') return null;       // silent on abort
      uploadError = {
        detail: String(e?.detail ?? e?.message ?? e),
        // preserve existing "Upload stopped at file N of M" UX from AssetSidebar.svelte:88-94 —
        // only set stoppedAt when batch.total > 1, so single-file callers don't get spurious "1 of 1".
        stoppedAt: batch && batch.total > 1 ? { n: batch.current, m: batch.total } : undefined,
      };
      return null;
    } finally {
      // compare-before-clear + editorMounted guard: only clear if (a) this invocation
      // still owns the controller AND (b) the component is still mounted. The
      // single-flight guard above already prevents controller-overwrite during the
      // component's lifetime, but mounted-guard is needed to prevent post-destroy
      // $state writes.
      if (editorMounted && uploadAbortController === controller) {
        uploadAbortController = null;
      }
      if (editorMounted) {
        uploading = false;
        uploadProgress = null;
      }
    }
  }
  ```
  `uploadOne` is the ONLY upload path. Textarea drop, wrapper drop, and the sidebar's drop/file-picker all invoke it. The controller is exposed via `$bindable<AbortController | null>` so a consumer modal can read+abort it through `bind:uploadAbortController`. AssetSidebar does NOT own its own controller — it gets `uploadOne` injected as `onUploadFile`. `editorMounted` is flipped `true` in MarkdownEditor's `onMount` and back to `false` in `onDestroy`, which fires during MarkdownEditor unmount when its parent (MiniProjectModal) unmounts.

  **Single-flight UX:** the existing `uploading` overlay (rendered by both MarkdownEditor and AssetSidebar while `uploading === true`) is the only feedback for a single-flight skip. No "Already uploading" inline message needed — the overlay already communicates "an upload is in progress" and a second drop while it's visible silently no-ops. Documented here so reviewers don't ask for a toast.
- **Textarea/wrapper multi-file drop contract** (codex round-7 catch — existing MarkdownEditor supports multi-file batches with `stoppedAt`; the refactor must preserve this for non-sidebar entry points too). Both textarea drop and wrapper drop call the same internal loop, mirroring the sidebar's:
  ```ts
  // textarea drop OR wrapper drop handler
  async function handleEditorDrop(files: File[]) {
    for (let i = 0; i < files.length; i++) {
      const result = await uploadOne(files[i], { current: i + 1, total: files.length });
      if (result === null) break;
      // insertion-at-cursor (existing behavior, textarea drop only): format ref + splice at cursor offset
      if (entryPoint === 'textarea') insertRefAtCursor(formatRef(result));
      refreshKey += 1;  // bump so sidebar's $effect re-runs fetchAssets to reflect the new asset
    }
  }
  ```
  - Single-file textarea drop (the common case) still works — loop runs once, `batch={current:1,total:1}` means `uploadOne` writes no `stoppedAt`, refresh happens once.
  - Insertion-at-cursor stays scoped to textarea drop (preserves existing UX); wrapper drop has no cursor semantics and just uploads.
  - `refreshKey += 1` per successful file. Note: the sidebar's `$effect` re-runs on each bump, but how many of the resulting `fetchAssets` calls actually arrive at the await depends on Svelte's micro-task scheduler — the `$effect` is NOT debounced; it can fire multiple times in quick succession, producing overlapping `fetchAssets` calls whose responses race. The `loadToken` ratchet on `fetchAssets` makes those races safe (stale responses are dropped). **Test recipe for the textarea/wrapper path:** assert final rendered list membership (the 3 uploaded filenames all present), NOT call count. Exact `fetchAssets` call count under effect-driven refetch is scheduler-dependent and brittle. The sidebar-path test recipe (which awaits `fetchAssets` directly per success) does assert call count, but that's because the sidebar path bypasses `$effect`.
- **`disabled` prop** (codex-review Critical): when truthy, ALL interactive handlers no-op — textarea drag-drop, wrapper drag-drop, preview button, mode toggle. Textarea itself gets `disabled={disabled}`. Sidebar is passed `disabled` through.

### `components/editor/AssetSidebar.svelte`

Prop signature change:
```ts
{
  assetContext: AssetContext;
  disabled?: boolean;
  refreshKey?: number;             // plain observed prop (NOT $bindable — sidebar never writes it in the refactored design). External invalidation signal — bumping it from MarkdownEditor triggers the sidebar's own `$effect` at `AssetSidebar.svelte:54` to re-run `fetchAssets()`. MarkdownEditor bumps it at `MarkdownEditor.svelte:95` after non-sidebar-initiated uploads (textarea/wrapper drop) so the sidebar list stays in sync. Sidebar uses its own `fetchAssets` directly after its own uploads.
  onInsert: (snippet: string) => void;
  onUploadFile: (file: File, batch?: { current: number; total: number }) => Promise<AssetItem | null>;  // = MarkdownEditor's uploadOne, injected; sidebar passes batch={current: i+1, total: files.length} for multi-file drops to preserve "n of m" UX; null return on single-flight skip / abort / error (sidebar stops iterating)
  uploading: boolean;              // $bindable
  uploadProgress: { current: number; total: number; filename: string } | null;  // $bindable
  uploadError: { detail: string; stoppedAt?: { n: number; m: number } } | null; // $bindable
}
```

Internally:
- `fetchAssets` calls `assetContext.list()`, **with a `loadToken` ratchet** (codex round-7 catch — same pattern used in `RunDetailPage` for run lookups and `MarkdownEditor.loadPreview`). **Full contract** (codex round-8 catch — token-ownership must extend to `loading` and `listError`, not just to `assets`, or an unguarded `finally` can hide the spinner while a newer request is still pending):
  ```ts
  let loadToken = 0;  // plain `let`, NOT $state — fetchAssets is called from a $effect, so a reactive token would re-trigger the effect on every increment and create a refetch loop (codex round-9 catch).
  async function fetchAssets() {
    loadToken += 1;
    const myToken = loadToken;
    loading = true;       // request-start writes are NOT token-gated (they happen before any await; no race possible).
    listError = null;
    try {
      const list = await assetContext.list();
      if (myToken === loadToken) assets = list;   // stale responses dropped
    } catch (e) {
      if (myToken === loadToken) listError = e instanceof ApiError ? e.displayMessage : 'Could not load assets.';
    } finally {
      if (myToken === loadToken) loading = false;  // spinner only cleared by the latest request
    }
  }
  ```
  Three post-await writes (`assets`, `listError`, `loading=false`) are ALL token-gated; otherwise older responses could clobber state for the in-flight newer request. Request-start writes (`loading = true`, `listError = null`) are NOT gated because they happen before the await — there's no race window. This matters when sidebar's own post-upload refetch races with a `refreshKey`-triggered refetch from a sibling MarkdownEditor upload — without the ratchet, a stale response landing last could leave the sidebar showing N items instead of N+1 (or stuck-loading) until the user next interacts.
- **Sidebar does NOT own the upload controller and does NOT mutate `uploading` or `uploadProgress` directly.** It MAY write to `uploadError` for client-side pre-validation failures (oversize / wrong-extension) — see the pre-validation section below — since those branches never reach `uploadOne` and need a visible error. During an actual in-flight upload, only `uploadOne` writes upload-state. When the user drops/picks files, the sidebar iterates and calls `await onUploadFile(file)` for each one. `onUploadFile` is MarkdownEditor's `uploadOne` (see MarkdownEditor section above) injected by value, so the same single-flight guard, controller management, error/progress state, and `editorMounted` post-await guard apply to sidebar-initiated uploads.
  - **On success (non-null `AssetItem` returned):** sidebar calls its own `await fetchAssets()` (refetch/replace, mirroring the existing pattern at `AssetSidebar.svelte:85`) and continues to the next file in the batch. No append-then-bump — that would duplicate work, since `refreshKey`-change ALREADY triggers `fetchAssets` via the existing `$effect` at `AssetSidebar.svelte:54`. Sidebar does NOT bump `refreshKey` after its own uploads (would just re-fetch what it already re-fetched). No automatic insert-at-cursor — the existing "Insert ref" button per row remains the user's hook for that.
  - **On `null` returned:** no refetch, sidebar stops iterating the batch. The `uploadError` state set by `uploadOne` (or already present from a prior pre-validation failure) is preserved and shown via the existing error slot. Single-flight skip and AbortError are both silent (no `uploadError` set inside `uploadOne` for either); a network/server failure is the only path that surfaces an error string.
  - **Multi-file OS drop:** sidebar awaits each `onUploadFile` sequentially in a `for` loop, so the single-flight guard inside `uploadOne` never blocks the batch — each file waits for the prior one's await chain to resolve, then runs. The loop is explicit and threads the batch counters, and refetches after each success:
    ```ts
    for (let i = 0; i < files.length; i++) {
      const result = await onUploadFile(files[i], { current: i + 1, total: files.length });
      if (result === null) break;   // batch stops on null (skip / abort / error)
      await fetchAssets();          // refetch/replace after each successful file
    }
    ```
    Test recipe: drop 3 valid files. After resetting the `fetchAssets` spy that counted the initial-mount fetch, assert it's called 3 more times (one per successful upload). Assert all 3 filenames are present in the rendered list (backend sorts by filename, so don't assert tail position — assert set-membership).
- Delete calls `assetContext.remove(assetId)`.
- `imgSrc(asset)` calls `assetContext.imgSrc(item)`.
- Section label switches on `assetContext.kind`: "Course assets" vs "Run assets — shared across all MPs in this run".
- Cursor-aware "Insert ref" (`cursorReady` + `onInsert(snippet)`) preserved unchanged; covered by an explicit test that mounts AssetSidebar with `runAssetContext` and verifies the insert callback receives the right snippet at the right cursor offset.
- Upload-state bindings (`uploading`, `uploadProgress`, `uploadError`) remain `$bindable` and parent-owned in MarkdownEditor.
- **`disabled` prop**: when truthy, the file-input drop zone, upload button, "Insert ref" buttons, and per-row delete buttons all no-op (and visually use `disabled` styling). The list itself still renders.

### Client-side file pre-validation (in AssetSidebar before calling `onUploadFile`)

Uses `MAX_FILE_SIZE_BYTES` and `ALLOWED_EXTENSIONS` from `lib/runAssets.ts`. **Stop-on-any-invalid pre-pass:** sidebar validates ALL dropped files first (one pre-pass) BEFORE entering the upload loop. If any file fails validation, sidebar writes a message into `uploadError` and does NOT call `onUploadFile` for ANY file. The user retries with a valid subset. Message format matches existing UX conventions (no `file(s)` constructions):
- 1 invalid file: `Cannot upload: foo.exe (extension not allowed)` or `Cannot upload: big.zip (file exceeds 20MB)`
- N invalid files (N > 1): `Cannot upload 3 files: foo.exe (extension not allowed), big.zip (file exceeds 20MB), other.exe (extension not allowed)`

A subsequent valid retry clears the prior validation error: pre-pass passes → `uploadOne` runs → `uploadOne` sets `uploadError = null` at its start. (Until that retry, the validation error stays visible — that's the intended UX.)

Rationale (codex round-6 catch): per-file validation inside the upload loop hides validation errors — `uploadOne` clears `uploadError = null` at the start of each call, so a validation message set for file N gets wiped when file N+1 starts. Pre-pass + stop-on-any-invalid is simpler than per-file accumulation and gives the user a single clear message.

### AbortController plumbing

MarkdownEditor's `uploadOne` helper owns the upload's `AbortController` and is the single upload path for all three entry points (textarea drop, wrapper drop, sidebar drop — see the `uploadOne` listing above). The modal reads the in-flight controller via `bind:uploadAbortController={...}` on MarkdownEditor. Modal Cancel during upload calls `controller.abort()`. **Server-side: the upload is atomic (DB row + filesystem write commit together at `run_assets.py:60-96`) and is NOT abort-aware** — the server may have committed by the time the client's signal fires, leaving an orphan asset row in the run pool that is visible (and trash-able) on next sidebar refetch. Spec accepts this; documented in "Race / Staleness Handling". Test recipe in jsdom: mock `fetch` rejects with `new DOMException('Aborted', 'AbortError')` when `signal` fires.

## New Components

### `components/runs/RunMiniProjectsTab.svelte`

Props:
```ts
{
  runId: number;
  runIsPublished: boolean;
  runGroupsEnabled: boolean;
  runEndDate: string | null;             // ISO date; used in publish-precondition copy
  versionIsDisabled: boolean;
  pinnedAvailable: boolean;               // false → render "Cannot load — pinned version not found" instead of normal body
  blocks: BlockResponse[];                // pinned version's blocks (from RunDetailPage); empty array when !pinnedAvailable
  miniProjects: MiniProjectResponse[];     // empty array when !pinnedAvailable
  onRefetchMiniProjects: () => Promise<void>;
  onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
}
```

Responsibilities:
- Render the header bar with `[+ New mini-project]` (disabled per gating below).
- Render **actionable banners** when `!runGroupsEnabled`, `versionIsDisabled`, or `!runIsPublished`. Each banner ends in a link that calls `onNavigateToTab('overview')` (groups, version, publish-state all surface on Overview).
- Empty-state CTA when `miniProjects.length === 0` with copy: "No mini-projects yet. A mini-project is a PDF assignment that each group submits and you grade. **Click + New mini-project to assign one to a block.**"
- Render MP list sorted by `block.order asc`. Each row shows: `Block {order} — {block.title}`, deadlines summary in browser-local TZ (via `formatLocalWithTz`; wraps cleanly at narrow widths since the 3 deadlines stack vertically in the row when needed), status pill, and the actions per row state. **Pill is the primary state signal**; action presence is secondary.
- Open `MiniProjectModal` in create or edit mode (modal NOT rendered for locked rows).
- Inline force-delete confirm flow on `[×]`.

Gating rules (button disabled + `title` tooltip + `aria-disabled`):
- `!runGroupsEnabled` → "Mini-projects require groups. Enable groups on Overview."
- `versionIsDisabled` → "This run's course version is disabled."
- All blocks already have an MP → "All blocks in this course version already have a mini-project."

Locked-row delete confirm:
```
Force delete will permanently remove all submissions and evaluations for this
mini-project. This cannot be undone.
  [ ] I understand
                                                  [Cancel] [Force delete]
```
(No "N submission(s)" count — backend 409 detail doesn't carry one.)

### `components/runs/MiniProjectModal.svelte`

Props:
```ts
{
  runId: number;
  mode: 'create' | 'edit';
  initial: MiniProjectResponse | null;    // null when mode === 'create'
  availableBlocks: BlockResponse[];        // unused blocks (for create); empty for edit
  currentBlock: BlockResponse | null;      // for edit-mode label rendering
  runIsPublished: boolean;
  versionIsDisabled: boolean;               // codex round-3/4: needed by publishCheckResult so an already-open modal can't bypass spec line 547 if the parent flips this to true mid-edit
  runEndDate: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
}
```

**Internal architecture:**
- `assetContext = $derived(runAssetContext(runId))` (memoized; not constructed per render).
- `formData` $state: `{ block_id, soft_local, hard_local, resub_local, assignment_md }` — datetime fields hold naive local strings throughout the modal; converted via `localInputToISO` only at POST/PATCH time.
- `submitting` $state. **Inputs disabled while submitting:** all three datetime inputs and the block picker set `disabled={submitting}` directly; the MarkdownEditor and AssetSidebar both receive `disabled={submitting}` via the new `disabled` prop documented in their contracts above (textarea + drag-drop handlers + sidebar upload/insert/delete all no-op). This prevents the in-flight-edit data-loss case where a user keeps typing after Save → PATCH carries the pre-click snapshot → post-click edits are silently lost on the success refetch.
- `mounted` $state: set `true` in `onMount`, `false` in `onDestroy`. Every post-await state write inside **the modal** (Save success, Publish success, force-delete refetch, etc.) checks `if (!mounted) return;` first. This covers close-during-Save and close-during-Publish. **Note:** upload `.catch`/`.finally` writes are NOT modal-scoped — they live inside MarkdownEditor's `uploadOne` and are guarded by MarkdownEditor's own local `editorMounted` flag (see the MarkdownEditor section above). The modal's `mounted` flag cannot protect post-await writes inside a child component because those writes target the child's local state, not the modal's. Two flags, two scopes, same rule applied at each lifecycle boundary.
- **Dirty-confirm via `InlineConfirm` footer-row.** Tracks the full form snapshot (block_id, three deadlines, markdown) so accidental loss of deadline edits also triggers the confirm:
  ```ts
  // Plain-object snapshot built from formData AFTER initialization (NOT a $state proxy,
  // and NOT hardcoded — codex re-review caught: if the modal preselects the first
  // available block in create mode, a `null` initial block_id would make the form
  // dirty immediately on open). Snapshot is taken once inside onMount, after the
  // formData initialization step has run.
  let initialFormSnapshot: ReturnType<typeof currentFormSnapshot>;
  onMount(() => {
    // formData was already initialized inline above from `initial` (or to sensible
    // create-mode defaults — e.g., availableBlocks[0]?.id for block_id).
    initialFormSnapshot = currentFormSnapshot();
    mounted = true;
  });

  // currentFormSnapshot is a plain-object projection of formData re-built on every read.
  function currentFormSnapshot() {
    return {
      block_id: formData.block_id ?? null,
      soft_local: formData.soft_local,
      hard_local: formData.hard_local,
      resub_local: formData.resub_local,
      assignment_md: formData.assignment_md,
    };
  }

  let pendingClose = $state(false);
  const dirty = $derived(
    // initialFormSnapshot is undefined before onMount fires (single render tick); guard
    // so an early-render read of `dirty` doesn't evaluate truthy and surprise downstream.
    initialFormSnapshot == null
      ? false
      : JSON.stringify(currentFormSnapshot()) !== JSON.stringify(initialFormSnapshot)
  );

  function closeForCurrentStage() {
    if (submitting) return;
    if (dirty && !pendingClose) {
      pendingClose = true;  // flip footer to InlineConfirm
      return;
    }
    uploadAbortController?.abort();
    onClose();
  }
  ```
  When `pendingClose` is true, the footer renders an `InlineConfirm` row with `warning="Discard unsaved changes?"` and `confirmLabel="Discard"`. The existing component's cancel button reads "Cancel" — equivalent to "Keep editing" in this context; no component-API extension needed. **Cancel** sets `pendingClose=false` (returns to normal footer). **Discard** calls `closeForCurrentStage` again (now passes through to `onClose`). Backdrop / `[×]` / Escape all route through `closeForCurrentStage`. Comparing plain-object snapshots (not $state proxies) avoids the proxy-key-order footgun the third reviewer flagged.
- `uploadAbortController` $state: the latest in-flight `AbortController` for the active upload. **Created inside MarkdownEditor** (which owns ALL THREE upload entry points: textarea drop, wrapper drop, sidebar drop — see the MarkdownEditor section above) and exposed via `$bindable`. The modal reads it through `bind:uploadAbortController={...}` on MarkdownEditor so `closeForCurrentStage` can call `.abort()` before `onClose()`. MarkdownEditor's non-abort upload `.catch` branch sets `uploadError`; the `e.name === 'AbortError'` branch is silent. **Note:** abort prevents updating unmounted-modal state on the upload promise's resolution, but does NOT prevent the server-side commit (atomic upload at `run_assets.py:60-96` is not abort-aware). The resulting orphan asset row is the accepted gap documented in "Race / Staleness Handling" below.
- `[Publish…]` rendered only when `mode === 'edit'` and `!initial.is_published`. Click flips footer into an `InlineConfirm` with copy: *"Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions)."*
- **Modal close on runId change** is handled implicitly by the existing reset-effect's `activeTab = 'overview'` write (codex round-4 catch — corrected from earlier draft that said "add `showMiniProjectModal = false`"). The reset-effect flips activeTab → `{:else if activeTab === 'mini-projects'}` evaluates false → `RunMiniProjectsTab` unmounts → its internal `modalMode` / `editTarget` $state is destroyed by lifecycle. No new reset entries needed; modal state lives INSIDE RunMiniProjectsTab (not on RunDetailPage), and parent-driven unmount is the cleanup path.

**Layout:**
- Modal root: `max-width: 1100px; max-height: 90vh; overflow: auto`; sticky header (title + close X); sticky footer (action buttons).
- **Body layout — side-by-side, mirroring the course editor.** Textarea on the left, sidebar on the right. Single-column stack only below a **880px** viewport breakpoint (covers 50%-split-screen on 1920px displays + small-laptop split-screen scenarios). CSS-only `@media (max-width: 880px)` — no JS.

**Validation (client-side mirrors backend; field-level `aria-describedby`):**
- `assignment_md` non-empty → required for Save
- `soft_local <= hard_local` (when both set) — compare `Date(localInputToISO(...))` timestamps
- `hard_local <= resub_local` (when both set) — same comparison
- For Publish, ALL of the above PLUS:
  - `hard_local` set
  - `resub_local` set
  - `new Date(hard_iso) > new Date()` (client-side proactive warning — backend re-checks)
  - `runEndDate !== null` (precondition for the two date-bound checks below; bullet copy when violated: "Run end date must be set — Open Overview to set it."). Run table currently allows nullable end_date in some legacy rows, so the prop type stays `string | null` and the modal renders this bullet rather than throwing.
  - `hard_iso <= runEndDate + 'T23:59:59Z'` (matches backend publish check at `mini_projects.py:258-281` which does `hard_aware.date() > run.end_date` in UTC). **Note: this is a product-visible discrepancy with the existing run-status logic at `frontend/src/lib/runStatus.ts`, which treats `run.end_date` as a browser-local end-of-day boundary.** A teacher in HST setting hard_deadline to June 30 23:30 local (= July 1 09:30 UTC) sees publish fail even though their local clock says it's still June 30. Spec accepts this as inherited backend behavior; the cleanest fix is for backend publish to switch to `hard_aware.date() > run.end_date` in the run's local TZ once per-run TZ pinning lands in Phase 9.
  - `resub_iso <= runEndDate + 'T23:59:59Z'` (codex re-review catch: backend also enforces this at `mini_projects.py:271`; same UTC-date semantics as the hard-deadline check).
  - `runIsPublished === true`

**Publish-precondition presentation:** Inline banner inside the modal body (NOT floating sticky — so unbounded length doesn't push the footer off-screen). Each unmet precondition is a bullet with substituted value:
```
Cannot publish:
  • Hard deadline must be set
  • Hard deadline must be before run end (2026-06-30)
  • Run must be published — Open Overview to publish.
```
Each bullet uses `aria-describedby` on the offending field. The "Open Overview" link calls `onNavigateToTab('overview')`. Visual asymmetry between "fix here" bullets and "fix on Overview" bullets is mild and acceptable; future polish.

**Asset-broken-link surface:** After preview render returns 422, the modal shows the backend's message inline in the preview pane. Backend message format (verified `helpers.py:448-450`): `"Referenced run-assets not found: foo.csv, bar.png"` — already specific to which filenames are missing.

**Save-then-Publish in-flight protection:** Save and Publish buttons share `submitting`; both `disabled={submitting}` (RosterImportModal precedent). Visual feedback: button text changes ("Save" → "Saving…").

**Re-fire close after submit resolves:** If the user clicks X while `submitting`, the click is dropped (`closeForCurrentStage` early-returns). After submit resolves, `submitting=false`; the user clicks X again. Spec accepts this (matches RosterImportModal precedent — no queued close-intent).

**Error mapping:**
| Code | Source | UX |
|---|---|---|
| 409 on publish | preconditions not met | inline banner with `e.displayMessage` |
| 409 on PATCH | locked-after-open OR concurrent state change | inline banner with `e.displayMessage` and "Refresh the page to see latest." Modal stays open so the user can copy markdown manually before refresh. |
| 409 on delete | locked, no force | confirm row in tab reveals force option |
| 409 on asset delete | ref count > 0 | inline sidebar error with backend message (`"Asset 'X' is referenced by N mini-project(s). Use ?force=true to delete."`) |
| 422 on create/patch | bad payload | field-level error |
| 422 on render preview | bad markdown ref | inline preview-pane error showing the missing filenames |
| 404 on Save | MP deleted between open and Save | inline banner: "This mini-project has been deleted. Select-all (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C) from the assignment textarea if you want to preserve your work before closing." Modal stays open; textarea is no longer `disabled` once submitting resolves so the user can copy. The dirty-confirm footer-row WILL fire on close in this state — accepted, because the user has just been instructed to copy and clicking Discard is a deliberate confirmation. |
| 5xx / network | unexpected | red banner in modal; modal stays open |
| 401 | session expired | existing global handler (silent return; auth redirects) |

### `RunDetailPage` changes

- `ActiveTab` type: add `'mini-projects'`.
- 5th tab button "Mini-projects".
- `loadAll`: existing fan-out resolves `versions` in the inner Promise.all. **Add a sequenced step after `versions`:** find `pinned = versions.find(v => v.id === run.version_id)`. When `pinned == null` (defensive — version row hard-deleted while run kept its FK, or versions list is empty), set `blocks = []`, `miniProjects = []`, and pass `pinnedAvailable={false}` to the tab so it renders "Cannot load — pinned version not found." Otherwise, `Promise.all([listBlocks(pinned.id), listMiniProjects(rid)])` in parallel; pass `pinnedAvailable={true}`.
- New state on RunDetailPage: `blocks: BlockResponse[] | null`, `miniProjects: MiniProjectResponse[] | null`. (Codex round-4 catch — corrected from earlier draft that listed `showMiniProjectModal: boolean` + modal-mode state. Modal state lives INSIDE `RunMiniProjectsTab`, not on RunDetailPage.)
- `refetchMiniProjects()` helper passed to the tab.
- **Modal cleanup on runId change is implicit via the existing reset effect's `activeTab='overview'` write** (codex round-4 catch — corrected from earlier draft that said "add `showMiniProjectModal = false`"). RunMiniProjectsTab unmounts when activeTab leaves `'mini-projects'`, destroying its modalMode/editTarget $state by component lifecycle. No new reset-effect entries needed.
- `onNavigateToTab(tab)` setter passed through to the tab and modal.

## States & Edge Cases

| State | UX |
|---|---|
| `!runGroupsEnabled` | Actionable banner; `[+ New]` disabled |
| `versionIsDisabled` | Actionable banner; `[+ New]`, `[Edit]`, `[Publish]` disabled |
| `!runIsPublished` | Actionable banner; `[+ New]` and `[Edit]` allowed (drafts pre-publish are valid), `[Publish]` disabled |
| `pinned == null` (defensive) | Tab body renders "Cannot load — pinned version not found"; controls hidden |
| All blocks have MPs | `[+ New]` disabled with tooltip |
| No MPs | Empty-state CTA + explainer + create hint |
| MP `is_published === true && first_submitted_at === null` | Pill = "Published"; `[Publish]` hidden; `[Edit]` allowed; `[×]` allowed |
| MP `first_submitted_at !== null` | Pill = "Locked"; `[Edit]` hidden entirely; `[×]` force-confirm |
| Delete 409 (locked, no force) | Confirm row reveals force option (without count) |
| Asset delete 409 | Inline sidebar error with backend's message |
| 5xx on any mutation | Red banner; user retains state |
| Render preview failure | Inline preview-pane error (lists missing asset filenames) |

## Race / Staleness Handling

Established patterns plus what was kept after the second-pass review:

- `loadToken` ratchets on `loadAll`; stale responses dropped on runId change.
- Existing RunDetailPage reset effect closes any open modal on runId change.
- Modal `onSaved()` triggers `refetchMiniProjects()`.
- MarkdownEditor bumps `refreshKey` after non-sidebar-initiated uploads (textarea/wrapper drop) so the sidebar's `$effect` re-fetches its asset list. Sidebar uploads/deletes call `fetchAssets()` directly and do NOT bump `refreshKey`.
- Modal-close while submitting blocked; user re-clicks after resolve.
- `closeForCurrentStage` aborts any in-flight upload before `onClose()` so close-during-upload doesn't update unmounted-modal state (orphan asset rows may still land server-side per the accepted gap below — abort cancels client-side promise resolution, not the server commit).

**Accepted gaps (documented for slice B / Phase 9):**

- **No optimistic-concurrency token.** Two teachers editing the same MP can silently overwrite each other's `assignment_md`. The 409 banner only fires when the server detects a conflict (locked-after-open). Phase 9: `If-Match` + `updated_at`.
- **AbortController abort leaves orphan asset row.** Server-side commit is atomic and not abort-aware (`run_assets.py:60-96`); aborted-mid-write uploads still land in the DB whether the user cancelled explicitly or simply closed the modal during upload. Sidebar refetch on next open shows them; the user manually trashes them. Phase 9: abort-aware upload.
- **`is_referenced` is stale during in-modal edit.** Server-side flag updates only on PATCH/POST commit; in-modal references to a not-yet-saved asset don't bump the flag. Trash button can mislead. Spec accepts: matches existing course-asset behavior.
- **Cross-TZ deadline values shift.** `isoToLocalInput` reflects current browser TZ; a traveling teacher sees displayed times move. Phase 9: per-run pinned TZ.
- **Sidebar spinner can stall indefinitely on hung latest request** (codex round-9 catch). With the `loadToken` ratchet, only the LATEST `fetchAssets` request can clear `loading = false`. If that latest request hangs (network stall, server doesn't respond), the spinner stays up; the user can't tell whether to wait or retry. The existing `api.get` wrapper has no timeout, so this is the global behavior, not new. Phase 9: global fetch-timeout policy (e.g., 30s timeout → surface as retryable error).
- **Sidebar batch interruptible by sibling textarea/wrapper drop** (codex round-6 catch). After each successful file in a sidebar batch, `uploadOne` releases the single-flight lock briefly before the sidebar's next iteration acquires it. A textarea-drop in that window can take the slot; the sidebar's next iteration single-flight-rejects and returns `null`, stopping the batch at the current position. UX consequence: user sees the textarea-drop's file landed, sidebar list updates, but remaining sidebar-batch files were not uploaded. User can re-drop them. Documented rather than fixed (the alternative — restructuring to `uploadMany(files)` that holds the lock across the whole batch — doubles the API surface and adds a new contract for a rare edge case). Phase 9: batch-level lock if real users hit this.
<!-- (Removed: prior "concurrent fetchAssets can clobber" accepted gap. Codex round-7 catch: stale responses can land last and persist until a NEXT user action — not "next fetch corrects" as previously claimed. Fixed in T5a — see lib/sidebar refactor below.) -->

## Testing

### lib unit tests

- `tests/miniProjects.test.ts` — wrappers for list/get/create/update/delete/publish; 409 + 422 + 404 paths
- `tests/runAssets.test.ts` — list/upload (incl. AbortSignal threading + abort path via mock-fetch DOMException)/delete; FormData field name = "file"; oversize file rejected by pre-validation without network; bad-extension file rejected without network
- `tests/datetime.test.ts` — `localInputToISO`, `isoToLocalInput`, `formatLocalWithTz`, `localTzLabel` round-trips; covers DST spring-forward normalization, fall-back; `localTzLabel` returns shortOffset format. Run with `TZ=Europe/Copenhagen` pinned via `vitest.setup.ts` so all assertions are deterministic.
- `tests/assetContext.test.ts` — both factories route to right URLs; both `imgSrc` shapes correct (course: `/assets/{vid}/{file}`, run: `/api/runs/{rid}/assets/{file}`); mock fetch covers list/upload/remove/renderPreview for each kind; abort propagation through `upload`

### component tests

- `tests/RunMiniProjectsTab.svelte.test.ts`
  - Empty-state CTA + explainer + create-hint copy when no MPs
  - Actionable banner renders when `!runGroupsEnabled`; link click calls `onNavigateToTab('overview')`
  - Banner renders when `versionIsDisabled`; controls disabled
  - Banner renders when `!runIsPublished`; `[+ New]` allowed, `[Publish]` row-action disabled
  - "Cannot load" message when `pinned == null`
  - All-blocks-used → `[+ New]` disabled with tooltip
  - MP rows sorted by `block.order asc`
  - Status pill mapping (Draft/Published/Locked) as primary state signal
  - Force-delete confirm: copy includes "permanently remove" + checkbox + danger-styled button (no count)
  - `[Edit]` hidden on locked rows
- `tests/MiniProjectModal.svelte.test.ts` (split across two test files per Plan Size — T6a covers create/edit/close, T6b covers publish/preconditions/errors)
  - Create flow: block picker filtered, POST body shape (`localInputToISO` conversion verified), success refetches and closes
  - Edit flow: prefill, read-only block label, modal closes on success
  - Validation: deadline order; empty assignment blocks Save
  - Inputs disabled while submitting: textarea, datetime fields, block picker, sidebar upload all set `disabled={submitting}`; user keystrokes during in-flight save are no-ops
  - Publish flow: precondition bullets render with substituted runEndDate; field-level `aria-describedby`; inline confirm; 409 surfaces as inline banner
  - 409-PATCH: shows "Refresh to see latest"; modal stays open
  - 404 on Save: inline banner renders with Ctrl/Cmd+A/+C instructions
  - Close handler — clean form: backdrop/X/Escape → `closeForCurrentStage` → calls `onClose` immediately
  - Close handler — dirty form: footer flips to InlineConfirm; "Keep editing" returns to normal footer; "Discard" calls `onClose`
  - Close handler aborts in-flight upload: `bind:uploadAbortController` is read by the modal; `closeForCurrentStage` calls `.abort()` before `onClose()`; sidebar's upload `.catch` ignores `AbortError`
  - `mounted` flag: simulate close-during-clipboard-await OR close-during-Save-resolve; assert no post-await state write fires (`expect(setState).not.toHaveBeenCalled()` after unmount)
  - Save-then-Publish: Publish disabled while saving; button text changes to "Saving…"
  - X during submitting: ignored (early-return); subsequent click after submit resolves closes normally
  - Modal `max-width: 1100px; max-height: 90vh; overflow: auto`; sticky header + footer remain visible after long content

### MarkdownEditor / AssetSidebar regression tests (extension)

- Existing tests still pass when call sites pass `courseAssetContext(versionId)` instead of bare `versionId`
- New test: mount with `runAssetContext(runId)` and verify:
  - Preview hits `/api/runs/{rid}/render`
  - List hits `/api/runs/{rid}/assets`
  - imgSrc returns `/api/runs/{rid}/assets/{filename}`
  - Drag-drop into textarea hits `/api/runs/{rid}/assets` (not `/api/assets/...`)
  - AbortController cancellation propagates
  - Oversize / wrong-extension rejected without network
  - Cursor-aware insert injects at offset
  - Bound `uploading` / `uploadProgress` / `uploadError` correctly drive overlay across all three upload entry points

### Backend test addition (one)

- `tests/test_render_run.py` (or extend existing render tests):
  - `POST /api/runs/{rid}/render` returns HTML with `mathion:asset://X` rewritten to `/api/runs/{rid}/assets/X`
  - Gated by `require_run_admin_or_teacher`: course-admin OK, run-teacher OK, outsider → 403
  - 422 on unknown asset ref with the exact filenames in the message
  - Side-effect-free: no `RunAssetReference` rows created

### Manual smoke (final task)

1. Open Mini-projects tab on a run with groups enabled — empty-state CTA + explainer.
2. Click `[+ New]` — modal opens; block picker shows unused blocks; TZ label shows e.g. "(GMT+2)".
3. Fill assignment, upload run-asset via sidebar, insert ref at cursor, switch to Preview — URL resolves.
4. Mid-upload: click Cancel — upload aborts; reopen modal — sidebar reflects server state (incl. any orphan row from abort, which user manually trashes).
5. Try oversize / wrong-extension upload — inline rejection without network call.
6. Save — appears as Draft in list with TZ-labeled deadlines.
7. Click Publish on draft with missing deadlines — precondition bullets show with substituted values + aria links.
8. Set deadlines + run.is_published=true; Publish → confirm → Published.
9. Force-delete a locked MP (after seeding a submission via DB) — checkbox + force confirms; deletes.
10. Disable groups on Overview — banner appears on Mini-projects tab; click link → switches to Overview.
11. Edit modal, type some markdown, click X — footer flips to InlineConfirm "Discard unsaved changes?"; click Keep editing → footer reverts, modal stays; click X again → confirm reappears; click Discard → modal closes; reopen and verify the new text is gone.
12. While Save is in flight, try to type into the textarea / upload an asset — inputs are disabled, nothing happens.
13. 404 path (delete the MP via DB while modal is open, click Save) — banner shows Ctrl/Cmd+A/+C instructions; user selects text manually, copies, then closes (dirty-confirm fires; Discard).

## Estimated Plan Size

**~11 tasks**, per-task review loop (reviewer + codex parallel):

- T1: backend `POST /api/runs/{rid}/render` endpoint + test
- T2: `lib/types.ts` additions (incl. new `BlockResponse` type, currently absent in the frontend) + `lib/blocks.ts` with `listBlocks(versionId): Promise<BlockResponse[]>` (currently absent) + `lib/datetime.ts` + `lib/assetContext.ts` (both factories) + tests (incl. TZ-pinned setup file)
- T3: `lib/miniProjects.ts` + tests
- T4: `lib/runAssets.ts` (incl. AbortSignal, pre-validation constants) + tests
- T5a: MarkdownEditor + AssetSidebar refactor to `assetContext` prop; `bind:uploading/uploadProgress/uploadError` preserved; shared `uploadOne(file, batch?)` helper introduced inside MarkdownEditor; AssetSidebar `fetchAssets` gets `loadToken` ratchet; `ItemEditPage` call-site migration; existing-behavior regression tests pass
- T5b: new run-mode tests for MarkdownEditor + AssetSidebar (preview URL, list URL, imgSrc URL, drag-drop, abort, pre-validation, cursor insert)
- T6a: `MiniProjectModal.svelte` create + edit + `closeForCurrentStage` (InlineConfirm footer dirty-confirm, abort-in-flight-upload-on-close, mounted-flag rule, inputs-disabled-while-submitting); tests
- T6b: `MiniProjectModal.svelte` publish flow + precondition bullets + 409 PATCH banner + 404 Save banner (with Ctrl/Cmd+A/+C copy instructions); tests
- T7: `RunMiniProjectsTab.svelte` shell + gating + actionable banners + list rendering + force-delete confirm; tests
- T8: `RunDetailPage` integration (5th tab, loadAll sequencing for blocks-after-versions + `pinnedAvailable` prop, reset-effect modal-close fold-in, `onNavigateToTab` wiring); tests
- T9: 13-step manual smoke

writing-plans refines exact dependencies and TDD shape per task.

## Out-of-Scope Follow-ups (Tracked, Not Designed Here)

- **Slice B (teacher review):** browse submissions per MP, download PDFs, write/amend evaluations with feedback files. **The MPs × groups dashboard matrix from `/dashboard/mini-projects` lands here**, with clickable cells navigating into per-submission detail. Locked-MP deadline-extend modal also lands here. DirtyGuard route-guard wiring lands here (longer-lived edit views).
- **Slice C (student-facing):** read assignment, submit PDF, view eval.
- **Phase 7c teacher progress dashboard:** sequences × students coverage.
- **Backend hardening (Phase 9 candidates):**
  - `version.is_disabled` enforcement on MP create/edit/publish
  - `If-Match` / `updated_at` optimistic concurrency on PATCH endpoints
  - Abort-aware run-asset upload (rolls back DB + filesystem on disconnect)
  - Include submission count in locked-delete 409 detail
  - `GET /api/config/limits` to eliminate frontend/backend constant drift
  - Relax `GET /api/courses/by-slug/{slug}` and `GET /api/versions/{vid}/blocks` to admit run-teachers, enabling the deferred `isCourseAdmin`-gated UX
- **Multi-run-of-same-course teacher dashboard ambiguity:** auto-titled "Mini project for Block N" identical across runs.
- **Toast component extension:** action buttons + suppress-auto-dismiss when actions present, for future flows that need them.
