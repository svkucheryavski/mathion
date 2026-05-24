# Mini-Projects Authoring Frontend (slice A)

**Date:** 2026-05-24 (revised after 5-reviewer pass)
**Status:** Approved for implementation planning
**Slice:** Admin/teacher mini-project authoring only (CRUD, publish, run-assets). Read-only dashboard matrix deferred to slice B.
**Parent specs:**
- `docs/superpowers/specs/2026-04-27-phase7b-mini-projects-design.md` — backend mini-projects/submissions/evaluations/run-assets
- `docs/superpowers/specs/2026-05-01-phase7c-dashboards-design.md` — backend `/dashboard/mini-projects` matrix endpoint (consumed in slice B)
- `docs/superpowers/specs/2026-05-19-run-management-admin-design.md` — the just-merged run-management admin frontend whose patterns this slice extends

## Goal

Give admins and run-teachers a UI to create, edit, publish, and delete mini-projects on a run, and manage the run-scoped asset pool that mini-project markdown references. Lands as the 5th tab ("Mini-projects") on `RunDetailPage`. Reuses the run-management conventions established by the previous slice.

## Non-Goals

- Teacher review surface for submissions + evaluations — slice B.
- Student-facing flow (read assignment, submit PDF, view feedback) — slice C.
- **Read-only MPs × groups dashboard matrix** — deferred to slice B (where matrix cells become clickable into the submission/evaluation surface, giving the matrix real value beyond duplicating the per-row pills already in this slice's list).
- Editing locked mini-projects (those with submissions). `[Edit]` is hidden on locked rows in this slice; locked-MP deadline-extend lands in slice B alongside submission visibility.
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
| Mini-projects require `run.is_published = True` to publish | Phase 7b backend §publish gate |
| Force-delete requires course-admin (`require_course_admin`), not run-teacher | `mini_projects.py:204-209` |
| Locked-MP deadline edits are **extend-only** (and only non-null → non-null transitions allowed; `soft_deadline` is the only field allowed NULL → non-null) | `mini_projects.py:148-159`. Out of scope this slice. |
| Run-asset delete blocked when ref count > 0 (409); force-delete also course-admin-only | `run_assets.py:198-201`, `run_assets.py:181` |
| Mini-project title derived as `f"Mini project for Block {block.order}"` | `mini_projects.py:44` |

## Scope Slice (Author only)

```
RunDetailPage
└── tabs: Overview | Teachers | Groups | Roster | Mini-projects (NEW)
    └── RunMiniProjectsTab
        ├── header bar: "Mini-projects"   [+ New mini-project]
        ├── (actionable banners: !groups_enabled / version disabled / !run.is_published)
        ├── (empty-state CTA if no MPs)
        └── MP list (rows sorted by block.order asc)
              each row: block label, deadlines summary, status pill (Draft/Published/Locked)
              actions:
                Draft (unlocked):     [Edit] [Publish…] [×]
                Published (unlocked): [Edit]            [×]
                Locked (any):                           [×]   ← course-admin only; force confirm
```

## Backend Touchpoints

### Consumed (already shipped — verified by fidelity review)

| Endpoint | Used by | File |
|---|---|---|
| `POST /api/runs/{rid}/mini-projects` | MP create | `mini_projects.py:57` |
| `GET /api/runs/{rid}/mini-projects` | tab load | `mini_projects.py:102` |
| `GET /api/mini-projects/{mpId}` | modal prefill / stale-check refetch | `mini_projects.py:119` |
| `PATCH /api/mini-projects/{mpId}` | MP edit | `mini_projects.py:134` |
| `DELETE /api/mini-projects/{mpId}[?force=true]` | MP delete; force = course-admin only | `mini_projects.py:192` |
| `POST /api/mini-projects/{mpId}/publish` | publish | `mini_projects.py:248` |
| `POST /api/runs/{rid}/assets` | run-asset upload | `run_assets.py:27` |
| `GET /api/runs/{rid}/assets` | sidebar asset list | `run_assets.py:99` |
| `GET /api/runs/{rid}/assets/{filename}` | sidebar image preview + rendered markdown link target | `run_assets.py:122` |
| `DELETE /api/runs/{rid}/assets/{assetId}` | sidebar delete | `run_assets.py:177` |
| `GET /api/versions/{vid}/blocks` | populate block picker | `blocks.py:96` |

### New (this slice — backend addition)

| Endpoint | Why |
|---|---|
| `POST /api/runs/{rid}/render` | Mirrors `POST /api/versions/{vid}/render` (`versions.py:120`) but calls `render_with_run_assets(db, run_id, content_md)` (`helpers.py:421`). Lets the in-modal MarkdownEditor preview resolve `mathion:asset://...` refs against run-assets before save. Admin-or-teacher gated. Side-effect-free (matches version-render: validates + rewrites only; no `RunAssetReference` writes — those happen separately in PATCH/POST paths via `sync_run_asset_references`). ~20-line addition + 1 test. |

**No version.is_disabled enforcement is added in this slice.** Spec gates UX-only via `versionIsDisabled` banner + disabled buttons. Backend bypass via curl remains possible; acceptable for an internal tool. Future hardening sweep.

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

`uploadRunAsset` constructs `FormData` with field name `file`, matching the backend (verified `run_assets.py:30`). Passes `signal` to `fetch` for cancellation support.

### `lib/assetContext.ts` (new abstraction)

The MarkdownEditor + AssetSidebar today are wired against `versionId` + `lib/assets`. They need to dispatch four operations differently for run-assets: list, upload, delete, and `imgSrc` (the embedded image-preview thumbnail in the sidebar currently hardcodes `/assets/{version_id}/{filename}` — won't work for run-assets where the response shape has no `version_id`). The cleanest fix is a small adapter object passed as a single prop, replacing the current `versionId` prop.

```ts
export type AssetItem = {
  id: number;
  filename: string;
  mime_type: string;
  file_size: number;
  is_referenced: boolean;          // optional; missing on course assets uses ref-table lookup
};

export type AssetContext = {
  kind: 'course' | 'run';            // for label switching ("Course assets" vs "Run assets — shared across all MPs")
  list(): Promise<AssetItem[]>;
  upload(file: File, signal?: AbortSignal): Promise<AssetItem>;
  remove(assetId: number): Promise<void>;
  imgSrc(item: AssetItem): string;
  renderPreview(content_md: string): Promise<{ html: string }>;
};

export function courseAssetContext(versionId: number): AssetContext { ... }
export function runAssetContext(runId: number): AssetContext { ... }
```

Each factory closes over its ID and maps the native response shape (`AssetResponse` vs `RunAssetResponse`) onto the common `AssetItem`. `imgSrc` switches between `/api/assets/{versionId}/{filename}` and `/api/runs/{runId}/assets/{filename}`. `renderPreview` switches between `POST /api/versions/{vid}/render` and `POST /api/runs/{rid}/render` — this is also why `lib/runRender.ts` does NOT exist as its own module; the run-render call lives inside `runAssetContext`.

**Call-site migration:** `ItemEditPage` (the existing consumer) constructs `courseAssetContext(versionId)` and passes it to MarkdownEditor instead of the bare `versionId`. `MiniProjectModal` constructs `runAssetContext(runId)`. All other behavior preserved.

### `lib/datetime.ts` (small new helper)

```ts
// Browser-local naive string "2026-06-07T23:59" → ISO with offset "2026-06-07T23:59:00+02:00" (or Z when in UTC)
export function localInputToISO(value: string): string;

// Backend ISO (UTC-aware) → naive local string for <input type="datetime-local">
export function isoToLocalInput(iso: string): string;

// Format a UTC ISO for human display in browser-local TZ, e.g. "2026-06-07 23:59 CEST"
export function formatLocalWithTz(iso: string): string;

// Browser-local TZ abbreviation (e.g. "CEST", "UTC") for form labels
export function localTzLabel(): string;
```

All four are pure; tested in isolation.

### Type additions in `lib/types.ts`

Mirror Pydantic schemas: `MiniProjectCreate`, `MiniProjectUpdate`, `MiniProjectResponse`, `RunAssetResponse`. Export a literal type for the MP row status pill: `type MiniProjectRowStatus = 'draft' | 'published' | 'locked'`.

## Extended Existing Components

### `components/editor/MarkdownEditor.svelte`

**Prop signature change** (breaking but only one existing call site — ItemEditPage):

Before: `{ versionId: number; value: string; readOnly?: boolean; refreshKey?: number }`
After: `{ assetContext: AssetContext; value: string; readOnly?: boolean; refreshKey?: number }`

Internal changes:
- `loadPreview` calls `assetContext.renderPreview(value)` instead of inline POST.
- Textarea drag-drop handler (currently calls `uploadAsset(versionId, file)` directly at `MarkdownEditor.svelte:93`) becomes `assetContext.upload(file)`.
- `formatRef` (filename+mime → markdown snippet) stays as-is; it's asset-shape-agnostic.
- `AssetSidebar` instance receives the same `assetContext` (passed through).
- No `runId`/`versionId` leaks past the assetContext seam.

### `components/editor/AssetSidebar.svelte`

Same prop change: `{ assetContext: AssetContext; refreshKey?: number; onInsert: (snippet: string) => void; ... }`. Internally:
- `fetchAssets` calls `assetContext.list()`.
- Upload calls `assetContext.upload(file, signal)`.
- Delete calls `assetContext.remove(assetId)`.
- `imgSrc(asset)` calls `assetContext.imgSrc(item)`.
- Section label switches on `assetContext.kind`: "Course assets" vs "Run assets — shared across all MPs in this run".
- Cursor-aware "Insert ref" behavior (`cursorReady` + `onInsert(snippet)`) preserved unchanged; covered by an explicit test that mounts AssetSidebar with `runAssetContext` and verifies the insert callback receives the right snippet at the right cursor offset.

### Client-side file pre-validation (in AssetSidebar before calling `assetContext.upload`)

Mirrors backend (`backend/mathion/config.py:9`): `MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024`. Extension whitelist is the backend's allowlist (read from existing config or duplicated as a small frontend constant — to be confirmed with one grep in the planning pass; spec assumes a frontend constant that the planner will sync). Rejected file shows an inline sidebar error without hitting the network.

### AbortController plumbing

AssetSidebar tracks an in-flight upload's `AbortController`. Modal Cancel during upload calls `controller.abort()`. Server-side filesystem write may have already happened (backend is atomic but not abort-aware); modal close triggers an `assetContext.list()` refetch so the sidebar is consistent on next open.

## New Components

### `components/runs/RunMiniProjectsTab.svelte`

Props:
```ts
{
  runId: number;
  runIsPublished: boolean;
  runGroupsEnabled: boolean;
  runEndDate: string | null;            // ISO date; used to label publish-precondition copy
  versionIsDisabled: boolean;
  blocks: BlockResponse[];               // pinned version's blocks (from RunDetailPage)
  miniProjects: MiniProjectResponse[];
  isCourseAdmin: boolean;                // gates force-delete + delete on published rows
  onRefetchMiniProjects: () => Promise<void>;
  onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster') => void;
}
```

Responsibilities:
- Render the header bar with `[+ New mini-project]` (disabled per gating rules below)
- Render **actionable banners** when `!runGroupsEnabled`, `versionIsDisabled`, or `!runIsPublished`. Each banner ends in a link that calls `onNavigateToTab('overview')` (the source-of-truth tab for groups, version, and publish state).
- Empty-state CTA when `miniProjects.length === 0` with one-liner explaining what an MP is ("PDF assignment graded per group")
- Render MP list sorted by `block.order asc`. Each row shows: `Block {order} — {block.title}`, deadlines summary in browser-local TZ, status pill, and the actions described in the scope diagram
- Open `MiniProjectModal` in create or edit mode (modal NOT rendered for locked rows)
- Inline force-delete confirm flow on `[×]`

Gating rules (button disabled + `title` tooltip + `aria-disabled`):
- `!runGroupsEnabled` → "Mini-projects require groups. Enable groups on Overview."
- `versionIsDisabled` → "This run's course version is disabled."
- All blocks already have an MP → "All blocks in this course version already have a mini-project."
- `!isCourseAdmin && row.isPublished` → `[×]` disabled with "Only course admins can delete published mini-projects."
- `!isCourseAdmin && row.isLocked` → `[×]` disabled with "Only course admins can force-delete mini-projects with submissions."

### `components/runs/MiniProjectModal.svelte`

Props:
```ts
{
  runId: number;
  mode: 'create' | 'edit';
  initial: MiniProjectResponse | null;    // null when mode === 'create'
  availableBlocks: BlockResponse[];        // blocks without an MP (for create); empty for edit
  currentBlock: BlockResponse | null;      // for edit-mode label rendering
  runIsPublished: boolean;
  runEndDate: string | null;               // ISO date for publish-precondition validation
  onClose: () => void;
  onSaved: () => Promise<void>;            // tab calls onRefetchMiniProjects
}
```

**Internal architecture:**
- Constructs `runAssetContext(runId)` once on mount; passes to embedded MarkdownEditor.
- `formData` $state: `{ block_id, soft_local, hard_local, resub_local, assignment_md }` — datetime fields hold naive local strings throughout the modal lifecycle; converted via `localInputToISO` on POST/PATCH only.
- `submitting` $state (matches RosterImportModal pattern). `closeForCurrentStage()` guarded: refuses close while `submitting` is true. Backdrop / `[×]` / Escape all route through this guard.
- `DirtyGuard` component (`components/editor/DirtyGuard.svelte`) wired around the modal: `dirty = JSON.stringify(formData) !== JSON.stringify(initialSnapshot)`; on close attempt with dirty=true, native `confirm("Discard unsaved changes?")` blocks the close.
- `[Publish…]` button only rendered when `mode === 'edit'` and `!initial.is_published`. Click flips footer into an `InlineConfirm` row: *"Once published, this cannot be unpublished. To remove a published MP, force-delete (also removes submissions)."* with `[Cancel]` `[Confirm Publish]`.

**Layout:** Single-column body (defer responsive split). Sidebar (AssetSidebar) lives below the textarea, not beside it. Sticky header (modal title + close X) and sticky footer (actions). This is simpler than the two-column proposal and works at every viewport.

**Modal close on runId change:** RunDetailPage's `$effect` watching `runId` calls `onCloseModal` if the modal is open. Prevents stale-runId POST when the URL changes mid-edit.

**Validation (client-side, mirrors backend; mapped to fields via `aria-describedby`):**
- `assignment_md` non-empty → required for Save
- `soft_local <= hard_local` (when both set) — converted via `localInputToISO` then string-compared (ISO with offset is lexicographically comparable when normalized to same offset; safer: parse both via `new Date()` then compare timestamps)
- `hard_local <= resub_local` (when both set) — same comparison
- For Publish: all of the above PLUS
  - `hard_local` set
  - `resub_local` set
  - `new Date(hard_iso) > new Date()` (client-side proactive warning — backend re-checks)
  - `new Date(hard_iso) <= new Date(runEndDate + 'T23:59:59Z')` ditto
  - `runIsPublished === true`

**Publish-precondition presentation:** When Publish is clicked and any precondition fails, a banner inside the modal lists each unmet precondition as a bullet with the failing value substituted, e.g.:
```
Cannot publish:
  • Hard deadline must be set
  • Hard deadline must be before run end (2026-06-30)
  • Run must be published — Open Overview to publish.
```
Each bullet uses `aria-describedby` to tie to the offending field. The "Open Overview" link calls `onNavigateToTab('overview')` from the parent (passed through as a modal prop).

**Concurrent-edit stale check (on Save in edit mode):**
1. Before sending PATCH, call `getMiniProject(mpId)` to get current server state.
2. If `server.updated_at !== initial.updated_at` → show toast: *"Another editor has updated this mini-project. Reload to see their changes, or Continue to overwrite."* with `[Reload]` `[Continue]` buttons.
3. Reload → re-init the modal with `server` (replaces `initial`); user re-applies their edits if desired.
4. Continue → proceed with the PATCH (silent overwrite, original behavior).
5. On 404 (deleted by another teacher) → toast "This mini-project has been deleted." + close modal. Modal-local markdown is offered as a clipboard copy via a one-click `[Copy assignment markdown]` button in the toast so work isn't lost.

**Asset-broken-link surface:** After preview render returns 422 (`render_with_run_assets` rejects unknown filenames per `helpers.py:447`), the modal shows the backend's error message inline in the preview pane. No separate "missing refs" detection step — the existing render error is already specific enough (`"Unknown asset reference: 'final.csv'"` or similar).

**Save-then-Publish race:** Save and Publish buttons both flip `submitting=true` on click; while in flight, all action buttons are disabled.

**Error mapping:**
| Code | Source | UX |
|---|---|---|
| 409 on publish | preconditions not met | inline banner with `e.displayMessage` |
| 409 on PATCH | locked-after-open (race) | inline banner: "A student submitted while you were editing. This MP is now locked; please close and reopen." (modal stays open so user can copy markdown) |
| 409 on delete | locked, no force | confirm row in tab reveals force option (course-admin only) |
| 409 on asset delete | ref count > 0 | inline sidebar error with backend message (`"Asset 'X' is referenced by N mini-project(s)"`) |
| 422 on create/patch | bad payload | field-level error tied to offending field |
| 422 on render preview | bad markdown ref | inline preview-pane error |
| 5xx / network | unexpected | red banner in modal; modal stays open |
| 401 | session expired | existing global handler (silent return; auth layer redirects) |

### `RunDetailPage` changes

- `ActiveTab` type: add `'mini-projects'`
- 5th tab button "Mini-projects" in the tablist
- `loadAll`: existing fan-out resolves `versions` in the inner Promise.all. Add a sequenced step **after** versions resolves: find the pinned version, then `await listBlocks(pinned.id)` and `await listMiniProjects(rid)` in parallel (these two can be Promise.all'd together since both depend only on rid/versionId). Net: 7 fetches total, with blocks+mp as a second wave after versions.
- New state: `blocks: BlockResponse[] | null`, `miniProjects: MiniProjectResponse[] | null`
- `refetchMiniProjects()` helper; passed to the tab as prop
- `$effect` watching `runId`: closes any open `MiniProjectModal` via a `closeMiniProjectModal` setter, resetting `showMiniProjectModal=false` and clearing modal-related state
- `isCourseAdmin` derived from `course.is_admin` (already on Course response) — passed to the tab

## States & Edge Cases

| State | UX |
|---|---|
| `!runGroupsEnabled` | Actionable banner; `[+ New]` disabled |
| `versionIsDisabled` | Actionable banner; `[+ New]`, `[Edit]`, `[Publish]` disabled |
| `!runIsPublished` | Actionable banner; `[+ New]` and `[Edit]` allowed (drafts pre-publish are valid), `[Publish]` disabled |
| All blocks have MPs | `[+ New]` disabled with tooltip |
| No MPs | Empty-state CTA "Create the first mini-project" + one-liner explainer |
| MP `is_published === true && first_submitted_at === null` | Pill = "Published"; `[Publish]` hidden; `[Edit]` allowed for non-locked edits (assignment_md, deadlines per backend rules); `[×]` requires course-admin |
| MP `first_submitted_at !== null` | Pill = "Locked"; `[Edit]` hidden entirely (see Non-Goals); `[×]` requires course-admin + force confirm |
| Delete returns 409 (locked, no force) | Confirm row reveals force checkbox with explicit copy: *"Force delete will permanently remove N submission(s) and any evaluations. This cannot be undone."* N is parsed from backend's 409 detail message |
| Asset delete returns 409 | Inline sidebar error with backend's `Asset 'X' is referenced by N mini-project(s)` message — explicit gap: doesn't say *which* MP; accept this for the slice |
| 5xx on any mutation | Red banner inside modal/row; user retains state |
| Markdown preview render failure | Inline error in preview pane (existing pattern) |

## Race / Staleness Handling

Established patterns plus new mitigations identified in review:

- `loadToken` ratchets on `loadAll`; stale responses dropped on `runId` change.
- `$effect` watching `runId` closes any open modal (prevents stale-runId POST).
- Modal `onSaved()` triggers `refetchMiniProjects()`.
- Concurrent-edit stale check on Save (see MiniProjectModal section above).
- AssetSidebar bumps `refreshKey` after upload/delete; preview re-renders.
- Modal-close while submitting blocked via `closeForCurrentStage` guard.
- No optimistic UI.
- Out-of-scope race surface, documented for slice B / Phase 9:
  - Two teachers editing same MP simultaneously without an `If-Match` is documented but the stale-check above is the only mitigation; backend optimistic-concurrency is Phase 9.
  - Asset upload abort may leave a filesystem write; sidebar refetch on next open reconciles.

## Testing

### lib unit tests

- `tests/miniProjects.test.ts` — wrappers for list/get/create/update/delete/publish; 409 and 422 paths
- `tests/runAssets.test.ts` — list/upload (incl. AbortSignal threading)/delete; FormData field name = "file"; 409 on referenced delete
- `tests/datetime.test.ts` — `localInputToISO`, `isoToLocalInput`, `formatLocalWithTz`, `localTzLabel` round-trips; covers DST boundary and UTC fallback
- `tests/assetContext.test.ts` — both factories return adapters that route to the right URLs; both `imgSrc` shapes correct; mock fetch covers list/upload/remove/renderPreview for each kind

### component tests

- `tests/RunMiniProjectsTab.svelte.test.ts`
  - Empty state CTA + explainer copy when MPs list is empty
  - Actionable banner renders when `!runGroupsEnabled`; link click calls `onNavigateToTab('overview')`
  - Banner renders when `versionIsDisabled`; controls disabled
  - Banner renders when `!runIsPublished`; `[+ New]` allowed, `[Publish]` row-action disabled
  - All-blocks-used → `[+ New]` disabled with tooltip
  - MP rows sorted by `block.order asc` (covers non-sorted backend response)
  - Status pill mapping (Draft/Published/Locked)
  - Force-delete row only revealed after 409 from initial delete; submission count parsed from 409 detail
  - `[Edit]` hidden on locked rows; `[×]` disabled for non-admins on locked rows
- `tests/MiniProjectModal.svelte.test.ts`
  - Create flow: block picker filtered to availableBlocks, POST body shape (with localInputToISO conversion verified)
  - Edit flow: prefill from MP response; block shown as read-only `currentBlock` label; modal closes on success
  - Validation: deadline order errors; empty assignment blocks Save
  - Publish flow: precondition bullets render with field-level aria-describedby; inline confirm flow; 409 surfaces as banner
  - Concurrent-edit: server updated_at differs → toast with Reload/Continue; Reload re-inits with new server data; Continue overwrites
  - 404 on Save (deleted by another) → toast + close + copy-markdown button works
  - Modal close while submitting is blocked (closeForCurrentStage guard)
  - DirtyGuard prompts on close with unsaved changes
  - Save-then-Publish race: clicking Publish while Save in-flight is no-op (button disabled)

### MarkdownEditor / AssetSidebar regression tests (extension)

- Existing tests still pass when call sites pass `courseAssetContext(versionId)` instead of bare `versionId`
- New test: mount with `runAssetContext(runId)` and verify:
  - Preview renders against `/api/runs/{rid}/render`
  - Sidebar list hits `/api/runs/{rid}/assets`
  - Image preview thumbnails use `/api/runs/{rid}/assets/{filename}` URL
  - Drag-drop upload into textarea hits `/api/runs/{rid}/assets`
  - AbortController cancellation works (mock fetch rejects on signal)
  - Client-side oversize file rejected without network call
  - Cursor-aware insert injects markdown at cursor offset

### backend test addition (one)

- `tests/test_render_run.py` (or extend existing render tests): `POST /api/runs/{rid}/render` returns HTML with `mathion:asset://X` rewritten to `/api/runs/{rid}/assets/X`; admin-or-teacher gating; 422 on unknown asset ref; verifies side-effect-free (no `RunAssetReference` rows created by the call)

### manual smoke (final task in the plan)

1. Open Mini-projects tab on a run with groups enabled — empty-state CTA + explainer
2. Click `[+ New]` — modal opens; block picker shows unused blocks; TZ label shows e.g. "(Europe/Copenhagen)"
3. Fill assignment, upload run-asset via sidebar, insert ref at cursor, switch to Preview — URL resolves
4. Mid-upload: click Cancel — upload aborts; reopen modal — sidebar list reflects server state
5. Try oversize upload (>20MB) — inline rejection without network call
6. Save — appears as Draft in list
7. Click Publish — confirm dialog with full precondition list (if any fail); confirm → Published
8. Open second browser, edit same MP, then save from first browser — toast warns about concurrent edit; Reload works
9. Delete unpublished draft — gone
10. Force-delete a locked MP (after seeding a submission via DB) — confirm row shows submission count; force delete works as course-admin; refused for run-teacher only
11. Disable groups on Overview — banner appears on Mini-projects tab with link back; click → switches to Overview
12. Disable course version — banner + disabled controls

## Estimated Plan Size

**~10 tasks**, following the per-task review loop (reviewer + codex parallel, fix Critical/Important, re-review until clean):

- T1: backend `POST /api/runs/{rid}/render` endpoint + test
- T2: `lib/types.ts` additions + `lib/datetime.ts` + `lib/assetContext.ts` (with both factories) + tests
- T3: `lib/miniProjects.ts` + tests
- T4: `lib/runAssets.ts` (incl. AbortSignal) + tests
- T5: MarkdownEditor + AssetSidebar refactor to `assetContext` prop; migrate `ItemEditPage` call site; new run-mode tests; client-side file pre-validation
- T6: `MiniProjectModal.svelte` create + edit + publish + concurrent-edit stale check + DirtyGuard + closeForCurrentStage; all tests in one file
- T7: `RunMiniProjectsTab.svelte` shell + gating + actionable banners + list rendering + actions; all tests in one file
- T8: `RunDetailPage` integration (5th tab, loadAll sequencing for blocks-after-versions, `$effect`-on-runId modal close, `isCourseAdmin` derivation); integration tests
- T9: vitest/svelte-check baseline diff vs main (only if useful for confidence; can be folded into T8 review)
- T10: 12-step manual smoke

writing-plans will refine the dependencies, file paths, and exact TDD shape for each.

## Out-of-Scope Follow-ups (Tracked, Not Designed Here)

- **Slice B (teacher review):** browse submissions per MP, download PDFs, write/amend evaluations with feedback files. **The MPs × groups dashboard matrix from `/dashboard/mini-projects` lands here**, with clickable cells navigating into per-submission detail. Locked-MP deadline-extend modal also lands here.
- **Slice C (student-facing):** read assignment, submit PDF, view eval.
- **Phase 7c teacher progress dashboard:** sequences × students coverage matrix.
- **Backend hardening (Phase 9 candidates):** `version.is_disabled` enforcement on MP create/edit/publish; optimistic-concurrency (`If-Match` / `updated_at` token) on PATCH endpoints; abort-aware run-asset upload that rolls back filesystem on disconnect.
- **Multi-run-of-same-course teacher dashboard ambiguity:** auto-titled "Mini project for Block N" is identical across runs of the same course; teacher cross-run views (when they exist) will need a run prefix.
