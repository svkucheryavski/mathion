# Mathion Frontend — Admin Course Editor (Slice 1) Design

**Status:** Brainstormed 2026-05-06 · Awaiting plan.

**Goal:** Build the first slice of the **course admin editor** — the surface course admins use to author courses. Layered into the existing `frontend/` (the same Svelte 5 app that hosts the student MVP), end-to-end: a course admin logs in, sees their admin courses, opens an editor, creates/edits a version with blocks/sequences/items, authors static-page content with markdown preview, edits video URL items, and publishes the version.

**Role boundary.** This is the **admin** surface (`CourseAdmin`-gated, course authoring). The **teacher** surface (`RunTeacher`-gated, run dashboards / mini-project review / roster) is a separate slice and is not included here.

**Out of scope for this slice** (each gets its own spec when needed):
- Quiz authoring (questions + options + correctness UI).
- Asset upload UI. Existing asset references in markdown still resolve at render time, but no new uploads.
- Course creation. `POST /api/courses` is superuser-only and remains accessible only via API / seed scripts.
- Interactive-app item type (Phase 8 backend not yet shipped).
- Teacher run-monitoring surface.
- Drag-and-drop reorder, autosave, side-by-side live preview, slug auto-derivation.
- Math/LaTeX rendering (deferred from the student MVP too).

---

## 1. Resolved decisions

| # | Decision | Choice |
|---|---|---|
| Q1 | Slice scope | Structure CRUD + static-page authoring + video URL + publish flow. Quiz authoring + asset upload deferred. |
| Q2 | Frontend integration | Same app, route-level switch. New editor routes added to existing `frontend/`. |
| Q3 | Editor entry | Versions list page first; click a version to enter its editor. State transitions live on the version detail page. |
| Q4 | Editor layout | Drill-in pages: version → block → sequence → item editor. Breadcrumbs link back. |
| Q5 | Save semantics | Explicit Save/Discard on each form. Dirty-state warning on navigation. Structural ops (create / delete / reorder) commit immediately. |
| Q6 | Markdown UX | Textarea + on-demand "Preview" tab. New backend endpoint `POST /api/versions/{vid}/render` (course-admin-gated, no persistence). |
| Q7 | Reorder UX | ↑/↓ arrow buttons on each row. No drag-and-drop. |
| — | Item types in slice | Icon-radio picker exposing `static_page` and `video` only. `quiz` and `interactive_app` hidden until their slices land. Existing items of any type still display in lists. |
| — | Block / sequence delete guards | New backend rule: cannot delete a block that has sequences; cannot delete a sequence that has items. Version-level delete remains cascading. |

---

## 2. Project structure

### Frontend additions

```
frontend/src/
├── routes.ts                                 # +5 admin routes
├── lib/
│   ├── types.ts                              # extend with editor-side shapes
│   └── dirty.svelte.ts                       # NEW — unsaved-changes guard
├── stores/
│   └── currentEditorVersion.svelte.ts        # NEW — admin-tree cache
├── pages/
│   ├── CourseList.svelte                     # MODIFIED — admin "Edit" affordance per row
│   ├── CourseView.svelte                     # MODIFIED — admin "Edit course" link
│   └── editor/                               # NEW
│       ├── VersionsPage.svelte
│       ├── VersionEditPage.svelte
│       ├── BlockEditPage.svelte
│       ├── SequenceEditPage.svelte
│       └── ItemEditPage.svelte
└── components/
    └── editor/                               # NEW
        ├── EditorHeader.svelte               # breadcrumb + course/version context
        ├── VersionStateBadge.svelte          # created / published / archived (+disabled)
        ├── VersionStateActions.svelte        # publish/archive/revert/disable/enable/delete
        ├── ReorderRow.svelte                 # row wrapper with ↑/↓
        ├── ItemTypePicker.svelte             # icon-radio group reusing ItemIcon
        ├── MarkdownEditor.svelte             # textarea + Preview tab
        ├── DirtyGuard.svelte                 # confirm before nav/unmount when dirty
        └── ConfirmButton.svelte              # button that wraps native confirm()
```

Reused from the student MVP, unmodified: `lib/api.ts`, `lib/auth.svelte.ts`, `lib/router.svelte.ts`, `lib/events.ts`, `stores/session.svelte.ts`, `stores/toasts.svelte.ts`, `components/ui/*`, `components/chrome/Toaster.svelte`, `components/course/ItemIcon.svelte` (reused inside `ItemTypePicker`).

### Backend additions

| # | Where | What | Size |
|---|---|---|---|
| 1 | `schemas.py` + `courses.py` | Add `is_admin: bool` to `CourseResponse`. Computed in `list_courses` and `get_course` from the existing admin lookup. | ~10 LOC + 2 tests |
| 2 | `courses.py` | Add `GET /api/courses/by-slug/{slug}` returning `CourseResponse`. Visibility rules mirror `get_course`. | ~15 LOC + 3 tests |
| 3 | `versions.py` | Add `PATCH /api/versions/{vid}` accepting `info_md` and `max_quiz_attempts`. Allowed only when `state == "created"` (and not `is_disabled`). Re-renders `info_html` and re-syncs asset references. | ~25 LOC + 4 tests |
| 4 | `versions.py` | Add `POST /api/versions/{vid}/render` accepting `{content_md: string}`, returning `{html: string}`. Course-admin-gated. Calls `render_with_assets`. No persistence. | ~15 LOC + 2 tests |
| 5 | `content.py` (extend) | Add `GET /api/versions/{vid}/admin-tree`. Course-admin-gated; allowed in any state including `created`; returns the same tree shape as `/content` plus `content_md`, `info_md`, and admin-only fields. | ~40 LOC + 4 tests |
| 6 | `blocks.py` `delete_block` | After state check, count sequences; if ≥ 1 → `409 "Cannot delete block: remove its sequences first."` | ~5 LOC + 2 tests |
| 7 | `blocks.py` `delete_sequence` | After state check, count items; if ≥ 1 → `409 "Cannot delete sequence: remove its items first."` | ~5 LOC + 2 tests |

Approximate totals: ~115 LOC backend, ~19 new backend tests. No DB schema migration.

---

## 3. Routes and pages

### Route table additions (`frontend/src/routes.ts`)

```ts
{ path: '/courses/:courseSlug/edit', component: 'VersionsPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId', component: 'VersionEditPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId', component: 'BlockEditPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId', component: 'SequenceEditPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId/items/:itemId', component: 'ItemEditPage', auth: true },
```

Slug for course (consistent with student URLs); numeric IDs for blocks/sequences/items (matches backend addressing).

### Page-by-page summary

| Page | Fetches | Key actions |
|---|---|---|
| **VersionsPage** `/courses/:courseSlug/edit` | `GET /api/courses/by-slug/{slug}`, `GET /api/courses/{cid}/versions` | "Create new version" form (info_md, max_quiz_attempts, optional copy_assets_from selector); per-row Open / Disable / Enable / Delete (delete only when state=created). |
| **VersionEditPage** `/.../v/:versionId` | `GET /api/versions/{vid}/admin-tree` | Edit version `info_md` (`PATCH /api/versions/{vid}`); list blocks with ↑/↓ + Open; create block. State actions on this version: Publish / Archive / Revert / Disable / Enable / Delete. |
| **BlockEditPage** `/.../blocks/:blockId` | reads from cached admin-tree | Edit `block.title/slug/info` (`PATCH /api/blocks/{bid}`); list sequences with ↑/↓ + Open; create sequence; "Delete this block" button (disabled when block has sequences, see §6). |
| **SequenceEditPage** `/.../sequences/:sequenceId` | reads from cached admin-tree | Edit `sequence.title/slug` (`PATCH /api/sequences/{sid}`); list items with ↑/↓ + Open + per-row `ItemIcon`; create item (icon-radio type picker); "Delete this sequence" button (disabled when sequence has items, see §6). |
| **ItemEditPage** `/.../items/:itemId` | reads from cached admin-tree | Type-specific form: `static_page` → `MarkdownEditor` (with Preview); `video` → `video_url` input. `PATCH /api/items/{iid}` on save. "Delete this item" button (allowed only when version state=created). |

Delete buttons live on each entity's own edit page (one click deeper than the list row), so users confirm what they're editing before destroying it. Parent-list rows expose ↑/↓ and Open only.

Direct URL hits work — see §4 admin-tree fetch.

---

## 4. Admin-tree fetch and cache

A new store `currentEditorVersion` holds the result of `GET /api/versions/{vid}/admin-tree`:

```ts
export const currentEditorVersion = $state<{
  value: AdminTree | null;
  loading: boolean;
  error: string | null;
}>({ value: null, loading: false, error: null });
```

**On page load:** if `currentEditorVersion.value?.id !== params.versionId`, the page fetches the tree before rendering. Sub-pages (block / sequence / item) read directly from the cached tree.

**After mutations:** the page that performed the mutation refetches the tree before re-rendering or navigating. Optimistic updates are slice-2 polish.

**Tree shape (admin-tree response):**

```jsonc
{
  "course": { "id": 1, "name": "Calculus", "slug": "calculus" },
  "version": {
    "id": 3, "state": "created", "is_disabled": false,
    "info_md": "...", "info_html": "...", "max_quiz_attempts": 3,
    "created_at": "...", "published_at": null, "archived_at": null
  },
  "blocks": [
    {
      "id": 12, "title": "Limits", "slug": "limits", "order": 1,
      "info": "...", "info_html": "...",
      "sequences": [
        {
          "id": 47, "title": "Intro", "slug": "intro", "order": 1,
          "items": [
            {
              "id": 87, "title": "What is a limit", "slug": "what-is-limit",
              "order": 1, "type": "static_page",
              "content_md": "...", "content_html": "...",
              "video_url": null, "script_url": null
            }
          ]
        }
      ]
    }
  ]
}
```

Includes `content_md` / `info_md` so the editor can populate forms without extra fetches. Existing student `/api/versions/{vid}/content` is unchanged.

---

## 5. Save / dirty / discard flow

Each form snapshot is captured on mount. `dirty = !equal(form, snapshot)`. Save button disabled until dirty.

| Action | Behavior |
|---|---|
| **Save** | `PATCH /api/{thing}/{id}` → on 200 refetch the relevant cache (admin-tree inside a version editor; versions list on `VersionsPage`), reset snapshot, toast "Saved". On 422 → inline per-field errors via `ApiError.validationErrors()`. On 409 → toast. |
| **Discard** | Reset form to snapshot. |
| **Navigate while dirty** | `DirtyGuard` intercepts router navigation and `window.beforeunload`; native `confirm("Discard unsaved changes?")`. |

Structural ops (create / delete / reorder) commit immediately — they are not gated by Save.

---

## 6. Reorder, create, delete

**Reorder ↑/↓.** Click → compute full new ordering → `POST .../reorder` → refetch tree. Buttons disabled while in flight to prevent double-clicks.

**Create (sub-entity).** Inline form below the list (or expands on "+ New" click). POST. On 201 refetch tree, reset form, navigate into the new entity. 409 (slug collision in same parent) → inline error on the slug field. 422 → inline.

**Delete.**
- Confirm via native `confirm()` ("Delete block 'Limits'? This cannot be undone.").
- `DELETE /api/{thing}/{id}` → on 204 refetch and navigate up one level.
- 409 → toast with backend message.

**Block / sequence delete guards (new backend rule).**
- Backend: `DELETE /api/blocks/{bid}` returns `409 "Cannot delete block: remove its sequences first."` when the block has sequences. `DELETE /api/sequences/{sid}` returns `409 "Cannot delete sequence: remove its items first."` when the sequence has items.
- Frontend: the Delete button on `BlockEditPage` / `SequenceEditPage` is disabled with a tooltip ("Remove sequences first" / "Remove items first") when the cached tree shows children present. Backend remains source of truth.
- Version-level delete is unchanged (cascading).

---

## 7. Markdown preview

`MarkdownEditor.svelte` has two tabs: **Edit** (textarea) and **Preview**.

- Switching to Preview calls `POST /api/versions/{vid}/render` with `{content_md: <textarea value>}` and shows the returned HTML.
- No debounce — only re-fetches on tab switch.
- Loading and error states handled inline within the Preview tab (spinner during fetch; error message on failure).
- Preview never persists. Save is a separate explicit action (§5).

Endpoint shape:

```http
POST /api/versions/{vid}/render
Content-Type: application/json
{ "content_md": "..." }
```

```http
200 OK
{ "html": "..." }
```

Course-admin-gated (`require_course_admin` on the version's course). `is_disabled` versions return 403.

---

## 8. Publish flow

`VersionStateActions` exposes a "Publish version" button on `VersionEditPage` when state=created.

1. Confirm via `confirm()`.
2. `POST /api/versions/{vid}/publish`.
3. **200** → refetch admin-tree, toast "Version published".
4. **409** → toast the backend message verbatim. The backend already returns user-facing error strings such as: *"Block 'Limits' has no sequences. Every block must have at least one sequence to publish."*, *"Sequence 'Intro' has no items..."*, *"Question '…' needs at least 2 options to publish."* Frontend does not pre-validate.

Other state transitions (`archive`, `revert`, `disable`, `enable`, `delete`) follow the same pattern: confirm → POST → refetch / navigate / toast.

---

## 9. Error → UI mapping

Consistent with the student MVP.

| Status | Where | Why |
|---|---|---|
| 401 | Existing `events.emitUnauthorized` → redirect to `/login` | Session bounce |
| 403 / 404 | Full-page panel with back link | Permission / missing data; page can't render |
| 409 | Toast | Action-level business rule (state restriction, slug collision, publish-validation, delete guard). **Exception:** slug collision on create is shown as an inline field error. |
| 422 | Inline per-field via `ApiError.validationErrors()` | Pydantic field validation |
| 5xx | Toast "Something went wrong. Please try again." | Server error |

---

## 10. Read-only handling per version state

| State | Behavior |
|---|---|
| `created` | All CRUD enabled. |
| `published` | Editable: `block.title/info`, `sequence.title`, `item.title/content_md/video_url`. Disabled with tooltip: create / delete / reorder, slug edits, publish (already published). Available state actions: Archive, Revert (if no enrolled students), Disable. |
| `archived` | All edit affordances disabled. State actions: none from this state. |
| `is_disabled` | Banner: "This version is disabled — editing is not allowed". All writes hidden. State action: Enable. |

Backend already enforces these rules; the frontend's role is to hide/disable the affordances so users don't see 409s for predictable cases.

---

## 11. Testing approach

### Backend tests (pytest via `backend/.venv`)

| Concern | File | Tests |
|---|---|---|
| `is_admin` on `CourseResponse` | `tests/test_courses.py` | 2 |
| `GET /api/courses/by-slug/{slug}` | `tests/test_courses.py` | 3 |
| `PATCH /api/versions/{vid}` | `tests/test_versions.py` | 4 |
| `POST /api/versions/{vid}/render` | `tests/test_versions.py` | 2 |
| `GET /api/versions/{vid}/admin-tree` | `tests/test_content.py` (or new) | 4 |
| Block delete-with-sequences guard | `tests/test_blocks.py` | 2 |
| Sequence delete-with-items guard | `tests/test_blocks.py` | 2 |

≈ 19 new backend tests using existing in-process FastAPI test client + tmp-DB fixture. No infra change.

### Frontend tests (vitest, plain `.ts`)

Unit tests for non-component lib code, mirroring student-MVP pattern in `frontend/src/tests/`:

| Module | What |
|---|---|
| `lib/dirty.svelte.ts` | Snapshot equality, dirty toggling, navigation interception (mocked router). |
| `stores/currentEditorVersion.svelte.ts` | Refetch hook, stale-detection, error states. |
| Router | Extend `tests/router.test.ts` for the 5 new patterns. |

Component-level `.svelte` tests are out of scope for slice 1 (would require `@testing-library/svelte` runtime, not worth it for this size). Validation done via the manual smoke checklist below.

### Manual smoke checklist

Run before claiming complete:

1. Login → CourseList as course admin → "Edit" appears on owned courses, not enrolled-only courses.
2. Versions list → create new version → opens editor.
3. Block CRUD: create, rename, reorder ↑/↓, delete (empty).
4. Block delete guard: try to delete a block with sequences → 409 + tooltip on disabled button.
5. Sequence CRUD mirror; sequence delete-with-items guard.
6. Item create: icon-radio type picker; both `static_page` and `video`.
7. `MarkdownEditor`: write content → Preview → renders correctly. Save → reload → content persists.
8. Dirty-state warning: edit a field, click another menu → confirm dialog.
9. Publish flow: empty block (no sequences) → backend's exact 409 string in toast. Fix, retry → publishes.
10. Read-only state: open a published version → structural buttons disabled with tooltip; allowed fields still editable.
11. Disabled version: editor shows banner, no writes.
12. Direct deep-link URL to an item editor (cold load) → admin-tree fetches, page renders.
13. Production build (`npm run build` + backend SPA mount) → editor pages load via SPA routing; refresh works.

---

## 12. Suggested implementation order

A plan will be written separately by the writing-plans skill. As an initial sketch:

1. Backend: `is_admin` field + `GET /api/courses/by-slug/{slug}` (smallest, unblocks frontend course resolution).
2. Backend: block / sequence delete guards (independent, small).
3. Backend: `PATCH /api/versions/{vid}`, `POST /api/versions/{vid}/render`, `GET /api/versions/{vid}/admin-tree` (the three editor-supporting endpoints).
4. Frontend: types, `currentEditorVersion` store, `dirty.svelte.ts`, `DirtyGuard`, `ConfirmButton`, route additions.
5. Frontend: `VersionsPage` + create/delete/disable/enable wiring.
6. Frontend: `VersionEditPage` + block CRUD + reorder + state actions.
7. Frontend: `BlockEditPage` + sequence CRUD.
8. Frontend: `SequenceEditPage` + item CRUD + `ItemTypePicker`.
9. Frontend: `ItemEditPage` + `MarkdownEditor` (with Preview).
10. Frontend: `CourseList` / `CourseView` admin "Edit" affordances.
11. Read-only state gating across pages.
12. Manual smoke pass + production build verification.

Each step lands on a feature branch off `main` (no worktrees), with backend tests passing per `backend/.venv/bin/pytest` and frontend tests passing per `npm run check && npm run test`.
