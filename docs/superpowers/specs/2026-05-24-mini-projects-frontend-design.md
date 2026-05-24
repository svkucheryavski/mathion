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
- **DirtyGuard route-guard wiring.** `DirtyGuard` is route-level (hooks `registerNavigationGuard` + `beforeunload`); it does not intercept modal-internal close (backdrop/X/Escape). To avoid duplicating two confirm paths, this slice keeps dirty-confirm logic *inside* `closeForCurrentStage` only (see modal section). Route-level guard wiring lands in slice B alongside the longer-lived edit views.
- Optimistic UI updates. MP authoring is low-frequency; refetch round-trips are fine.
- Scheduled deadline notifications, email delivery (Phase 9).
- Full Phase 7c teacher progress dashboard (sequences × students coverage).

## Decisions Already Fixed by Parent Specs

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
| `POST /api/runs/{rid}/render` | Mirrors `POST /api/versions/{vid}/render` (`versions.py:120`) but calls `render_with_run_assets(db, run_id, content_md)` (`helpers.py:421`). Lets the in-modal MarkdownEditor preview resolve `mathion:asset://...` refs against run-assets before save. Course-admin gated (matches the rest of the run-management surface). Side-effect-free: `render_with_run_assets` only SELECTs + string-rewrites; `RunAssetReference` writes happen separately in `sync_run_asset_references` invoked only by PATCH/POST. ~20-line addition + 1 test. |

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

// MUST stay in sync with backend `ALLOWED_EXTENSIONS` (`backend/mathion/assets.py:4`).
// Backend list is 13 file types; mirrored here exactly:
export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.csv', '.tsv', '.txt', '.md',
  '.py', '.r', '.zip',
]);
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
// Browser-local naive string "2026-06-07T23:59" → ISO with offset.
// Implementation: new Date(naive).toISOString() — naive parsed as local per ECMA-262.
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
export function localTzLabel(): string;
```

All four are pure; tested in isolation with `TZ=Europe/Copenhagen` pinned via vitest setup file so DST + offset tests are deterministic.

**Deadline values reflect the *current* browser TZ in the modal — `isoToLocalInput` converts stored UTC to whatever local the teacher is in now. A teacher traveling across TZs and reopening the modal will see deadline times shift accordingly. Accepted for this slice; explicit run-pinned TZ is future work.**

### Type additions in `lib/types.ts`

Mirror Pydantic schemas: `MiniProjectCreate`, `MiniProjectUpdate`, `MiniProjectResponse`, `RunAssetResponse`. Export `type MiniProjectRowStatus = 'draft' | 'published' | 'locked'`.

## Extended Existing Components

### `components/editor/MarkdownEditor.svelte`

**Prop signature change** (single existing call site — ItemEditPage):

Before: `{ versionId: number; value: string; readOnly?: boolean; refreshKey?: number }`
After: `{ assetContext: AssetContext; value: string; readOnly?: boolean; refreshKey?: number }`

Internal changes:
- `loadPreview` calls `assetContext.renderPreview(value)`.
- Textarea drag-drop handler (today calls `uploadAsset(versionId, file)` at `:93`) becomes `assetContext.upload(file)`.
- `formatRef` (filename+mime → markdown snippet, `lib/assets.ts:69`) is shape-agnostic; reused unchanged.
- `AssetSidebar` instance receives the same `assetContext` (passed through).
- **Upload-state ownership preserved** (feasibility-reviewer Critical): the existing `uploading` / `uploadProgress` / `uploadError` $state lives in MarkdownEditor and is `$bindable` into AssetSidebar so that all three upload entry points (textarea drop, wrapper drop, sidebar drop) share a single overlay + error display. The adapter swap MUST preserve this contract. AssetSidebar still receives `bind:uploading`, `bind:uploadProgress`, `bind:uploadError`.

### `components/editor/AssetSidebar.svelte`

Same prop change: `{ assetContext: AssetContext; refreshKey?: number; onInsert: (snippet: string) => void; ... }`. Internally:
- `fetchAssets` calls `assetContext.list()`.
- Upload calls `assetContext.upload(file, signal)`.
- Delete calls `assetContext.remove(assetId)`.
- `imgSrc(asset)` calls `assetContext.imgSrc(item)`.
- Section label switches on `assetContext.kind`: "Course assets" vs "Run assets — shared across all MPs in this run".
- Cursor-aware "Insert ref" (`cursorReady` + `onInsert(snippet)`) preserved unchanged; covered by an explicit test that mounts AssetSidebar with `runAssetContext` and verifies the insert callback receives the right snippet at the right cursor offset.
- Upload-state bindings (`uploading`, `uploadProgress`, `uploadError`) remain `$bindable` and parent-owned.

### Client-side file pre-validation (in AssetSidebar before calling `assetContext.upload`)

Uses `MAX_FILE_SIZE_BYTES` and `ALLOWED_EXTENSIONS` from `lib/runAssets.ts`. Oversize or wrong-extension files show inline sidebar error (in the existing `uploadError` slot) without hitting the network.

### AbortController plumbing

AssetSidebar tracks an in-flight upload's `AbortController`. Modal Cancel during upload calls `controller.abort()`. **Server-side: the upload is atomic (DB row + filesystem write commit together at `run_assets.py:60-96`) and is NOT abort-aware** — the server may have committed by the time the client's signal fires, leaving an orphan asset row in the run pool that is visible (and trash-able) on next sidebar refetch. Spec accepts this; documented in "Race / Staleness Handling". Test recipe in jsdom: mock `fetch` rejects with `new DOMException('Aborted', 'AbortError')` when `signal` fires.

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
  blocks: BlockResponse[];                // pinned version's blocks (from RunDetailPage)
  miniProjects: MiniProjectResponse[];
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
  runEndDate: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
}
```

**Internal architecture:**
- `assetContext = $derived(runAssetContext(runId))` (memoized; not constructed per render).
- `formData` $state: `{ block_id, soft_local, hard_local, resub_local, assignment_md }` — datetime fields hold naive local strings throughout the modal; converted via `localInputToISO` only at POST/PATCH time.
- `initialSnapshot = $state.snapshot(formData)` taken once on mount; re-snapshotted **after every successful Save** so a post-save close doesn't fire the dirty prompt.
- `submitting` $state. The single guarded close path:
  ```ts
  function closeForCurrentStage() {
    if (submitting) return;
    const dirty = JSON.stringify(formData) !== JSON.stringify(initialSnapshot);
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }
  ```
  Backdrop / `[×]` / Escape all route through this. (No DirtyGuard wiring — see Non-Goals.)
- `[Publish…]` rendered only when `mode === 'edit'` and `!initial.is_published`. Click flips footer into an `InlineConfirm` with copy: *"Once published, this cannot be undone. To remove a published mini-project, use force-delete (also removes submissions)."*
- **Modal close on runId change** is wired into RunDetailPage's existing reset-effect (the one at line ~100 that already resets `activeTab`, `rosterPrefilter`, `showImportModal`). Just add `showMiniProjectModal = false`. No new effect.

**Layout:**
- Modal root: `max-height: 90vh; overflow: auto`; sticky header (title + close X); sticky footer (action buttons).
- **Body layout — side-by-side, mirroring the course editor.** The first revision proposed sidebar-below-textarea; UX review flagged this as a regression vs ItemEditPage's side-by-side layout (cursor-blink visible while clicking "Insert ref"). Reverted: textarea on the left, sidebar on the right, single-column stack only below a narrow breakpoint (~720px).

**Validation (client-side mirrors backend; field-level `aria-describedby`):**
- `assignment_md` non-empty → required for Save
- `soft_local <= hard_local` (when both set) — compare `Date(localInputToISO(...))` timestamps
- `hard_local <= resub_local` (when both set) — same comparison
- For Publish, ALL of the above PLUS:
  - `hard_local` set
  - `resub_local` set
  - `new Date(hard_iso) > new Date()` (client-side proactive warning — backend re-checks)
  - `hard_iso <= runEndDate + 'T23:59:59Z'` (UTC boundary; teachers in deep west TZs may see this be confusing because their local June 30 23:30 is July 1 UTC; documented as accepted behavior — the alternative — local-offset boundary — drifts as the teacher moves)
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
| 404 on Save | MP deleted between open and Save | inline banner: "This mini-project has been deleted. Copy your markdown if needed, then close this dialog." (User selects the markdown manually from the textarea — no clipboard API + auto-toast theater.) |
| 5xx / network | unexpected | red banner in modal; modal stays open |
| 401 | session expired | existing global handler (silent return; auth redirects) |

### `RunDetailPage` changes

- `ActiveTab` type: add `'mini-projects'`.
- 5th tab button "Mini-projects".
- `loadAll`: existing fan-out resolves `versions` in the inner Promise.all. **Add a sequenced step after `versions`:** find `pinned = versions.find(v => v.id === run.version_id)`. If `pinned == null` (defensive — version row hard-deleted while run kept its FK), render an inline "Cannot load — pinned version not found" error in the Mini-projects tab and skip the blocks/MP fetches. Otherwise, `Promise.all([listBlocks(pinned.id), listMiniProjects(rid)])` in parallel.
- New state: `blocks: BlockResponse[] | null`, `miniProjects: MiniProjectResponse[] | null`, `showMiniProjectModal: boolean`, plus modal-mode state.
- `refetchMiniProjects()` helper passed to the tab.
- **Modal close on runId change folds into the existing reset effect** — add `showMiniProjectModal = false` (and clear modal-related state) alongside the existing `activeTab='overview'` / `rosterPrefilter=null` / `showImportModal=false` resets.
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
- AssetSidebar bumps `refreshKey` after upload/delete; preview re-renders.
- Modal-close while submitting blocked; user re-clicks after resolve.
- `closeForCurrentStage` does its own dirty-confirm via `window.confirm`.

**Accepted gaps (documented for slice B / Phase 9):**

- **No optimistic-concurrency token.** Two teachers editing the same MP can silently overwrite each other's `assignment_md`. The 409 banner only fires when the server detects a conflict (locked-after-open). Phase 9: `If-Match` + `updated_at`.
- **AbortController abort leaves orphan asset row.** Server-side commit is atomic and not abort-aware (`run_assets.py:60-96`); aborted-mid-write uploads still land in the DB. Sidebar refetch on next open shows them; the user manually trashes them. Phase 9: abort-aware upload.
- **`is_referenced` is stale during in-modal edit.** Server-side flag updates only on PATCH/POST commit; in-modal references to a not-yet-saved asset don't bump the flag. Trash button can mislead. Spec accepts: matches existing course-asset behavior.
- **Cross-TZ deadline values shift.** `isoToLocalInput` reflects current browser TZ; a traveling teacher sees displayed times move. Phase 9: per-run pinned TZ.

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
- `tests/MiniProjectModal.svelte.test.ts` (split across two test files — see Plan Size)
  - Create flow: block picker filtered, POST body shape (`localInputToISO` conversion verified), success refetches and closes
  - Edit flow: prefill, read-only block label, modal closes on success
  - Validation: deadline order; empty assignment blocks Save
  - Publish flow: precondition bullets render with substituted runEndDate; field-level `aria-describedby`; inline confirm; 409 surfaces as inline banner
  - 409-PATCH: shows "Refresh to see latest"; modal stays open
  - 404 on Save: inline banner with "copy your markdown" instruction; modal stays open
  - Dirty-confirm on close: clean = closes immediately; dirty = `window.confirm` invoked (mock confirm returns false → modal stays open)
  - Post-save re-snapshot: edit field → Save → close → no confirm prompt
  - Save-then-Publish: Publish disabled while saving; button text changes to "Saving…"
  - X during submitting: ignored
  - Modal `max-height: 90vh; overflow: auto`; sticky footer remains visible after long content

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
  - Course-admin gating (non-admin → 403)
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
11. Edit modal, type some markdown, click X — `window.confirm` fires; click Cancel in confirm → modal stays open; type more, click X, click OK → modal closes.

## Estimated Plan Size

**~11 tasks**, per-task review loop (reviewer + codex parallel):

- T1: backend `POST /api/runs/{rid}/render` endpoint + test
- T2: `lib/types.ts` additions + `lib/datetime.ts` + `lib/assetContext.ts` (both factories) + tests (incl. TZ-pinned setup file)
- T3: `lib/miniProjects.ts` + tests
- T4: `lib/runAssets.ts` (incl. AbortSignal, pre-validation constants) + tests
- T5a: MarkdownEditor + AssetSidebar refactor to `assetContext` prop; `bind:uploading/uploadProgress/uploadError` preserved; `ItemEditPage` call-site migration; existing-behavior regression tests pass
- T5b: new run-mode tests for MarkdownEditor + AssetSidebar (preview URL, list URL, imgSrc URL, drag-drop, abort, pre-validation, cursor insert)
- T6a: `MiniProjectModal.svelte` create + edit + closeForCurrentStage + dirty-confirm + post-save resnapshot; tests for those flows
- T6b: `MiniProjectModal.svelte` publish flow + precondition bullets + 409/404 banners + AbortController plumbing inside modal; tests
- T7: `RunMiniProjectsTab.svelte` shell + gating + actionable banners + list rendering + force-delete confirm; tests
- T8: `RunDetailPage` integration (5th tab, loadAll sequencing for blocks-after-versions + pinned-null defensive, reset-effect modal-close fold-in, `onNavigateToTab` wiring); tests
- T9: 11-step manual smoke

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
