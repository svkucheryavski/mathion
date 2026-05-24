# Mini-Projects Authoring Frontend (slice A+D)

**Date:** 2026-05-24
**Status:** Approved for implementation planning
**Slice:** Author + read-only dashboard view
**Parent specs:**
- `docs/superpowers/specs/2026-04-27-phase7b-mini-projects-design.md` — backend mini-projects/submissions/evaluations/run-assets
- `docs/superpowers/specs/2026-05-01-phase7c-dashboards-design.md` — backend `/dashboard/mini-projects` matrix endpoint
- `docs/superpowers/specs/2026-05-19-run-management.md` — the just-merged run-management admin frontend whose patterns this slice extends

## Goal

Give admins and run-teachers a UI to create, edit, publish, and delete mini-projects on a run, manage the run-scoped asset pool that mini-project markdown references, and see a read-only MPs × groups status matrix that summarizes submission/evaluation state across the run.

Lands as the 5th tab ("Mini-projects") on `RunDetailPage`. Reuses the run-management conventions established by the previous slice (`lib/*.ts` clients, `components/runs/*.svelte` tab/modal split, `LoadingPlaceholder`, `InlineConfirm`, `FocusTrap`).

## Non-Goals

- Teacher review surface for submissions + evaluations (separate later slice "B"). The matrix cells are read-only in this slice.
- Student-facing flow: read assignment, submit PDF, view feedback (separate later slice "C").
- Full Phase 7c teacher progress dashboard (sequences × students coverage). Only the mini-projects sub-dashboard is in scope.
- Scheduled deadline notifications, email delivery (Phase 9).
- Optimistic updates. MP authoring is low-frequency; refetch round-trips are fine.

## Decisions Already Fixed by Parent Specs

| Decision | Source |
|---|---|
| One mini-project per `(run, block)` | Phase 7b §1075 |
| `is_published` is one-way; only unpublish path is `?force=true` delete | Phase 7b §62 |
| Locked = `first_submitted_at IS NOT NULL`; orthogonal to `is_published` | Phase 7b §74 |
| Mini-projects require `run.groups_enabled = True` | Phase 7b §74 |
| Mini-projects require `run.is_published = True` to publish | Phase 7b §93 |
| Disabled course version blocks create/edit (409) | Phase 7b extension B1 |
| Matrix payload from `/api/runs/{rid}/dashboard/mini-projects`: MPs × groups with status enum `not_submitted / awaiting_eval / needs_revision / accepted / rejected` and per-cell counts | Phase 7c |
| Run-asset deletes blocked when ref count > 0 (409) | Phase 7b run-assets §651 |
| `mini_project.title` derived as `f"Mini project for Block {block.order}"` | Phase 7b §74 |

These are not re-litigated here.

## Scope Slice (A+D)

```
RunDetailPage
└── tabs: Overview | Teachers | Groups | Roster | Mini-projects (NEW)
    └── RunMiniProjectsTab
        ├── header bar: "Mini-projects"   [+ New mini-project]
        ├── (banners: !groups_enabled / version disabled / no published version)
        ├── (empty-state CTA if no MPs)
        ├── MP list (rows sorted by block.order asc)
        │     each row: block label, deadlines summary, status pill
        │                actions [Edit] [Publish] [×]
        └── Group progress matrix (read-only)
              rows = groups, cols = MPs, cells = status badge + optional count
```

## Backend Touchpoints

### Consumed (already shipped)

| Endpoint | Used by |
|---|---|
| `POST /api/runs/{rid}/mini-projects` | MP create |
| `GET /api/runs/{rid}/mini-projects` | tab load |
| `GET /api/mini-projects/{mpId}` | modal prefill on edit |
| `PATCH /api/mini-projects/{mpId}` | MP edit |
| `DELETE /api/mini-projects/{mpId}[?force=true]` | MP delete + force-delete |
| `POST /api/mini-projects/{mpId}/publish` | publish |
| `POST /api/runs/{rid}/assets` | run-asset upload |
| `GET /api/runs/{rid}/assets` | sidebar asset list |
| `GET /api/runs/{rid}/assets/{filename}` | preview rendering serves files |
| `DELETE /api/runs/{rid}/assets/{assetId}` | sidebar delete |
| `GET /api/runs/{rid}/dashboard/mini-projects` | matrix payload |

### New (this slice — backend addition)

| Endpoint | Why |
|---|---|
| `POST /api/runs/{rid}/render` | Mirror of existing `POST /api/versions/{vid}/render`, but uses `render_with_run_assets(db, run_id, content_md)`. Lets the MarkdownEditor preview tab resolve `mathion:asset://...` refs against run-assets during edit. Without it, preview cannot show resolved URLs until save. Admin-or-teacher gated. ~20-line addition mirroring `versions.py:120`. |

## New Frontend Modules

Layout mirrors the run-management slice for consistency.

### `lib/miniProjects.ts`

Pure typed wrappers around the endpoints above. No state, no UI. Each function maps 1:1 to an endpoint and returns the typed response (or throws `ApiError`).

```ts
listMiniProjects(runId: number): Promise<MiniProjectResponse[]>
getMiniProject(mpId: number): Promise<MiniProjectResponse>
createMiniProject(runId: number, body: MiniProjectCreate): Promise<MiniProjectResponse>
updateMiniProject(mpId: number, body: MiniProjectUpdate): Promise<MiniProjectResponse>
publishMiniProject(mpId: number): Promise<MiniProjectResponse>
deleteMiniProject(mpId: number, opts?: { force?: boolean }): Promise<void>
getRunMiniProjectsDashboard(runId: number): Promise<RunMiniProjectsDashboardResponse>
```

### `lib/runAssets.ts`

```ts
listRunAssets(runId: number): Promise<RunAssetResponse[]>
uploadRunAsset(runId: number, file: File): Promise<RunAssetResponse>
deleteRunAsset(runId: number, assetId: number): Promise<void>
```

`uploadRunAsset` constructs `FormData` with field name `file`, matching the backend.

### `lib/runRender.ts`

```ts
renderRunMarkdown(runId: number, contentMd: string): Promise<{ html: string }>
```

Single POST to the new `/api/runs/{rid}/render`.

### Type additions in `lib/types.ts`

Mirror the Pydantic schemas (`MiniProjectCreate`, `MiniProjectUpdate`, `MiniProjectResponse`, `RunAssetResponse`, `RunMiniProjectsDashboardResponse` and its row type).

## New Components

### `components/runs/RunMiniProjectsTab.svelte`

Props:
```ts
{
  runId: number;
  runIsPublished: boolean;
  runGroupsEnabled: boolean;
  versionIsDisabled: boolean;
  blocks: BlockResponse[];           // pinned version's blocks (provided by RunDetailPage)
  groups: GroupResponse[];           // from RunDetailPage (already loaded)
  miniProjects: MiniProjectResponse[];
  matrix: RunMiniProjectsDashboardResponse | null;
  onRefetchMiniProjects: () => Promise<void>;
  onRefetchMatrix: () => Promise<void>;
}
```

Responsibilities:
- Render the header bar with `[+ New mini-project]` button (disabled per gating rules below)
- Render banners when `!runGroupsEnabled`, when `versionIsDisabled`, or when no published version exists
- Render the empty-state CTA when `miniProjects.length === 0`
- Render the MP list with status pill, deadlines summary, and `[Edit]` `[Publish]` `[×]` actions
- Open `MiniProjectModal` in create or edit mode
- Render `RunMiniProjectMatrix` when `miniProjects.length > 0` and `groups.length > 0`
- Manage local `showModal` state and editing target

Gating rules (button disabled + tooltip):
- `!runGroupsEnabled` → "Mini-projects require groups. Enable groups on this run first."
- `versionIsDisabled` → "This run's course version is disabled."
- Every block already has an MP → "All blocks in this course version already have a mini-project."
- Otherwise enabled

### `components/runs/MiniProjectModal.svelte`

Props:
```ts
{
  runId: number;
  mode: 'create' | 'edit';
  initial: MiniProjectResponse | null;    // null when mode === 'create'
  availableBlocks: BlockResponse[];        // blocks without an MP (for create); current block only (for edit)
  runIsPublished: boolean;
  runEndDate: string | null;               // for validation hint
  onClose: () => void;
  onSaved: () => Promise<void>;            // tab calls onRefetchMiniProjects + refetchMatrix
}
```

Layout (large modal; two-column when wide):
- Header: title + `[×]`
- Block picker (create mode only — `<select>` populated from `availableBlocks`; on edit, shown as a read-only label)
- Three `<input type="datetime-local">` fields: soft / hard / resub deadline
- Two-column body:
  - Left: extended `MarkdownEditor` with `runId` prop
  - Right: extended `AssetSidebar` with `runId` prop, labeled "Run assets — shared across all MPs in this run"
- Footer: `[Cancel]` `[Save]` and (when edit-mode + draft) a `[Publish…]` button

Validation (matches backend):
- `assignment_md` non-empty → required for Save
- `soft_deadline <= hard_deadline` (when both set)
- `hard_deadline <= resubmission_deadline` (when both set)
- On Publish: `hard_deadline != null`, `resubmission_deadline != null`, `hard_deadline > now()`, both `<= runEndDate`, `runIsPublished === true`

Publish UX: clicking `[Publish…]` flips that footer area into an `InlineConfirm` row with the warning "Once published, this cannot be unpublished." Cancel returns to normal footer.

Error mapping:
- 409 on publish/delete → inline banner inside modal with `e.displayMessage`
- 422 on create/patch → field-level error tied to the offending field
- 5xx / network → red banner inside modal; modal stays open so user doesn't lose work
- 401 → existing global handler (silent return; auth layer redirects)

### `components/runs/RunMiniProjectMatrix.svelte`

Props:
```ts
{
  matrix: RunMiniProjectsDashboardResponse;
  groupsEmpty: boolean;
}
```

Renders a table: rows = groups, columns = MPs. Each cell shows a colored badge for its status enum value with an optional `(count)` suffix when count > 1. Cells are non-interactive in this slice (no click handler). When `groupsEmpty` is true, render an inline hint "Enable groups to see progress" in place of the table.

Status → badge mapping:
| Status enum | Badge class | Label |
|---|---|---|
| `not_submitted` | `badge-muted` | `—` |
| `awaiting_eval` | `badge-pending` | `◎ awaiting` |
| `needs_revision` | `badge-warn` | `↻ revision` |
| `accepted` | `badge-ok` | `✓ accepted` |
| `rejected` | `badge-error` | `✗ rejected` |

## Extended Existing Components

Diff is small; in-place extension preferred over duplication. Both components currently take `versionId`; both will get an optional `runId` prop with the contract "exactly one of `{versionId, runId}` must be provided."

### `components/editor/MarkdownEditor.svelte`

- Add optional `runId?: number` prop alongside `versionId?: number`
- When `runId` is set, preview POSTs `/api/runs/{rid}/render` instead of `/api/versions/{vid}/render`
- Asset uploads via the `AssetSidebar` slot still target the correct context — pass `runId` through to the embedded `AssetSidebar`
- TypeScript: enforce mutual exclusivity at the type level (`{ versionId: number; runId?: never } | { versionId?: never; runId: number }`)
- Existing call sites unchanged (still pass `versionId`)

### `components/editor/AssetSidebar.svelte`

- Add optional `runId?: number` prop
- When `runId` is set, asset list/upload/delete calls hit the `lib/runAssets` client instead of `lib/assets`
- `Insert ref` button generates the same `mathion:asset://{filename}` syntax (asset namespace is filename-based and shared between course and run rendering)
- Label switches: "Course assets" (default) vs "Run assets — shared across all MPs in this run" when `runId` is set

## `RunDetailPage` Changes

- `ActiveTab` type: add `'mini-projects'`
- Tab button "Mini-projects" added in the tablist (fifth position)
- `loadAll` adds `listMiniProjects(rid)` to its `Promise.all` fan-out (call it 7th fetch)
- New state: `miniProjects: MiniProjectResponse[] | null`, `mpMatrix: RunMiniProjectsDashboardResponse | null`
- Matrix lazy-loads on first visit to the Mini-projects tab (separate `loadMatrix` triggered by `$effect` watching `activeTab`)
- `refetchMiniProjects()`, `refetchMatrix()` helpers passed to the tab as props
- Blocks list for the tab: pulled from the pinned version's content via `GET /api/versions/{vid}/blocks` (existing endpoint, `backend/mathion/api/blocks.py:96`). **Decision:** load alongside on `loadAll` to keep the create button's gating decision synchronous. Adds one fetch to the existing fan-out.

## States & Edge Cases

| State | UX |
|---|---|
| `!runGroupsEnabled` | Banner; `[+ New]` disabled; matrix empty-groups hint |
| `versionIsDisabled` | Banner; create/edit/publish all disabled |
| `!runIsPublished` | `[Publish]` disabled with tooltip "Publish the run first." Create/edit still allowed (drafts pre-publish are valid). |
| All blocks have MPs | `[+ New]` disabled with tooltip |
| No MPs | Empty-state CTA "Create the first mini-project" |
| MP `is_published === true` | Pill = "Published"; `[Publish]` hidden; `[×]` still allowed if `first_submitted_at` is null |
| MP `first_submitted_at !== null` | Pill = "Locked"; `[Edit]` opens read-only modal (assignment_md not editable, deadlines still editable per backend rules); `[×]` requires force confirm |
| Delete returns 409 (locked, no force) | Confirm row reveals force checkbox; resubmit with `?force=true` |
| Asset delete returns 409 (referenced) | Inline sidebar error; refuse delete |
| 5xx on any mutation | Red banner inside modal/row; user retains state |
| Markdown preview render failure | Inline error in preview pane (existing MarkdownEditor behavior) |

## Race / Staleness Handling

Established patterns from run-management:
- `loadToken` ratchets on `loadAll`; stale responses dropped on `runId` change
- Modal `onSaved()` triggers refetch of both list and matrix
- `AssetSidebar` bumps `refreshKey` after upload/delete so preview rerenders
- No optimistic UI; round-trip after mutation

## Testing

### lib unit tests

- `tests/miniProjects.test.ts` — list/get/create/update/delete/publish/dashboard wrappers; 409 + 422 error paths
- `tests/runAssets.test.ts` — list/upload/delete; FormData shape on upload; 409 on referenced-delete
- `tests/runRender.test.ts` — POST body shape; success and error paths

### component tests

- `tests/RunMiniProjectsTab.svelte.test.ts`
  - Empty state CTA when MPs list is empty
  - Banner + disabled `[+ New]` when `!groups_enabled`
  - Banner + disabled controls when version disabled
  - MP rows sorted by `block.order asc`
  - Status pill mapping (Draft/Published/Locked)
  - Matrix renders when MPs and groups both present; hidden when no MPs
  - Matrix shows "Enable groups" hint when groups empty
  - Force-delete row only after 409 from initial delete
- `tests/MiniProjectModal.svelte.test.ts`
  - Create flow: block picker filtered, POST body shape, modal closes on success
  - Edit flow: prefills from MP response; block shown as read-only
  - Validation: deadline order errors; empty assignment blocks Save
  - Publish gating + inline confirm flow
  - 409 on publish surfaces as inline banner; modal stays open
  - Asset sidebar inside modal: upload bumps `refreshKey`, insert-ref injects markdown
- `tests/RunMiniProjectMatrix.svelte.test.ts`
  - MPs as columns, groups as rows
  - Each status enum value renders with the right badge class + label
  - Count suffix when count > 1
  - "Enable groups" hint when `groupsEmpty`

### backend test addition (one)

- Extend the existing render-endpoint tests (or `test_run_assets.py`): `POST /api/runs/{rid}/render` returns HTML with `mathion:asset://x` references rewritten to `/api/runs/{rid}/assets/x`. Auth gating: admin-or-teacher only.

### manual smoke (T-final task in the plan)

1. Open Mini-projects tab on a run with groups enabled — empty-state CTA
2. Create MP for an unused block — appears as Draft
3. Edit assignment, upload run-asset, insert ref, switch to Preview — URL resolves
4. Save, then Publish (after meeting requirements) — confirm dialog → published
5. Edit Published MP — assignment textarea is read-only, deadlines still editable
6. Delete an unpublished MP — gone
7. Try delete on locked MP (after seeding a submission via DB) — 409 → force checkbox appears → force delete works
8. Disable groups on the run (via Groups tab) — banner + disabled create button
9. Disable course version — banner + disabled create/edit/publish
10. Matrix renders with seeded submissions in mixed states

## Estimated Plan Size

~14-16 tasks, following the per-task review loop (reviewer + codex parallel, fix Critical/Important, re-review until clean). Likely shape:
- T1: backend `POST /api/runs/{rid}/render` endpoint + test
- T2: `lib/types.ts` additions
- T3: `lib/miniProjects.ts` + tests
- T4: `lib/runAssets.ts` + tests
- T5: `lib/runRender.ts` + tests
- T6: `MarkdownEditor` extension (optional `runId` prop) + tests for run-mode preview
- T7: `AssetSidebar` extension (optional `runId` prop) + tests for run-asset client
- T8: `MiniProjectModal` create flow + tests
- T9: `MiniProjectModal` edit flow + tests
- T10: `MiniProjectModal` publish flow + tests
- T11: `RunMiniProjectMatrix` component + tests
- T12: `RunMiniProjectsTab` shell with gating + tests
- T13: `RunMiniProjectsTab` list rendering + actions + tests
- T14: `RunDetailPage` integration (5th tab, loadAll fan-out, lazy matrix load)
- T15: vitest/svelte-check baseline diff vs main
- T16: 10-step manual smoke

writing-plans will refine this list with exact dependencies, file paths, and TDD shape for each task.

## Out-of-Scope Follow-ups (Tracked, Not Designed Here)

- **Slice B (teacher review):** browse submissions per MP, download PDFs, write/amend evaluations with feedback files. Endpoints `POST/GET/PATCH /api/submissions/.../evaluation` already exist. Matrix cells become clickable in that slice.
- **Slice C (student-facing):** read assignment, submit PDF, view eval. Needs new "Mini-projects" tab on the student course view.
- **Phase 7c teacher progress dashboard:** sequences × students coverage matrix from `/dashboard/progress`. Likely a sibling tab on RunDetailPage.
