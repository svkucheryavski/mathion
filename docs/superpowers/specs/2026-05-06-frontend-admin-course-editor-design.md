# Mathion Frontend — Admin Course Editor (Slice 1) Design

**Status:** Brainstormed 2026-05-06 · Reviewed 2026-05-06 · Awaiting plan.

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
- **Slug editing post-create.** Slugs are set only at create-time; renaming is deferred (would need backend `*Update` schema additions and update-time uniqueness handling).

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
| — | Item types in slice | Icon-radio picker exposing `static_page` and `video` only. `quiz` and `interactive_app` are not creatable from this slice. Existing items of those types still appear in lists; opening one shows a read-only "Not editable in this slice" page with delete-gated-on-state allowed. |
| — | Slug editing | Set at create time only; not editable in slice 1 forms. |
| — | Block / sequence delete guards | New backend rule: cannot delete a block that has sequences; cannot delete a sequence that has items. Version-level delete remains cascading. State check runs first; child-count check runs second so the most actionable error wins. |

---

## 2. Project structure

### Frontend additions

```
frontend/src/
├── routes.ts                                 # +5 admin routes
├── App.svelte                                # MODIFIED — 5 new componentMap entries
├── lib/
│   ├── types.ts                              # extend with editor-side shapes
│   ├── router.svelte.ts                      # MODIFIED — add beforeNavigate hook (see §5)
│   ├── dirty.svelte.ts                       # NEW — unsaved-changes guard helper
│   └── versionPermissions.ts                 # NEW — pure helper, see §10
├── stores/
│   └── currentEditorVersion.svelte.ts        # NEW — admin-tree cache + actions
├── pages/
│   ├── CourseList.svelte                     # MODIFIED — admin "Edit" affordance per row
│   ├── CourseView.svelte                     # MODIFIED — admin "Edit course" link, gated to not break for non-enrolled admins (see §3)
│   └── editor/                               # NEW
│       ├── VersionsPage.svelte
│       ├── VersionEditPage.svelte
│       ├── BlockEditPage.svelte
│       ├── SequenceEditPage.svelte
│       └── ItemEditPage.svelte
└── components/
    ├── course/
    │   └── ItemIcon.svelte                   # MODIFIED — accept `mode: 'progress' | 'plain' | 'selectable'` prop so the radio picker can reuse the icon without progress-state styling
    └── editor/                               # NEW
        ├── ItemTypePicker.svelte             # icon-radio group reusing modified ItemIcon
        ├── MarkdownEditor.svelte             # textarea + Preview tab; props: { versionId, value, onchange }
        └── DirtyGuard.svelte                 # uses router.svelte.ts beforeNavigate hook + window.beforeunload
```

**Trimmed (rejected during spec review):**
- `ConfirmButton.svelte` — `confirm()` is one line; the wrapper added abstraction without value. Used inline at call sites.
- `VersionStateBadge.svelte` — a styled `<span>` per state, inlined in `VersionEditPage` / `VersionsPage`.
- `EditorHeader.svelte` — breadcrumbs are a few `<a>` tags, inlined per page.
- `ReorderRow.svelte` — two ↑/↓ buttons in a row, inlined per list.

Reused from the student MVP, unmodified: `lib/api.ts`, `lib/auth.svelte.ts`, `lib/events.ts`, `stores/session.svelte.ts`, `stores/toasts.svelte.ts`, `components/ui/*`, `components/chrome/Toaster.svelte`.

### Backend additions

| # | Where | What | Size |
|---|---|---|---|
| 1 | `student.py` (`/api/my-courses`) + `schemas.py` (`MyCourseResponse`) | Extend the endpoint to also return courses where the user is a course admin (not just enrolled). Add `is_admin: bool` to `MyCourseResponse`. For admin-only rows: `version_id`, `version_state`, `is_active`, `total_items`, `covered_items` are returned as `null` / `false` / `0` (frontend hides student affordances when these are absent). For users who are both admin and enrolled, a single row returns with `is_admin=true` and the enrollment-derived fields populated. | ~25 LOC + 4 tests |
| 2 | `courses.py` + `schemas.py` (`CourseResponse`) | Add `is_admin: bool` to `CourseResponse` with a default of `False` so existing call sites validating courses (e.g. `student.py:194` `CourseResponse.model_validate(course)`) continue to work. Set explicitly to `True` for the requesting user in `list_courses`, `get_course`, and the new `by-slug` endpoint. **Superusers receive `is_admin=True` on every course** for UI-affordance consistency. | ~10 LOC + 3 tests |
| 3 | `courses.py` | Add `GET /api/courses/by-slug/{slug}` returning `CourseResponse`. **Course-admin-gated only** (not the broader visibility rules of `get_course`) — this is an admin entry point, so non-admins get 403/404. **Route declaration ordering:** the new route must be declared **before** `/api/courses/{course_id}` to prevent FastAPI from matching `by-slug` as an int and 422-ing. | ~15 LOC + 3 tests |
| 4 | `versions.py` | Add `PATCH /api/versions/{vid}` accepting `info_md` and `max_quiz_attempts`. Allowed only when `state == "created"` and not `is_disabled`. Re-renders `info_html` via `render_with_assets`, re-syncs asset references, and calls `bump_content_updated_at(version)` for ETag consistency (matches `items.py:62` and `items.py:102` pattern). New `VersionPatch` schema. | ~30 LOC + 5 tests |
| 5 | `versions.py` | Add `POST /api/versions/{vid}/render` accepting `{content_md: string}`, returning `{html: string}`. **Course-admin-gated.** Allowed in any state **except** `is_disabled` (returns 403). No persistence. Uses `render_with_assets`. New `VersionRenderRequest` / `VersionRenderResponse` schemas. | ~20 LOC + 3 tests |
| 6 | `content.py` (extend) | Add `GET /api/versions/{vid}/admin-tree`. **Course-admin-gated** (no enrolled-student fallback). **Allowed in every state including `is_disabled` and `created`** — admins must reach disabled versions to enable them, and reach created versions to edit them. Returns the same nested shape as `/content` plus `content_md`, `info_md`, parent FKs (`block.version_id`, `sequence.block_id`, `item.sequence_id`), and admin-only fields. New `AdminTreeResponse` schema (or untyped dict response, matching existing `/content` style). | ~50 LOC + 5 tests |
| 7 | `blocks.py` `delete_block` | After existing state check (`state != "created"` → 409), count sequences; if ≥ 1 → `409 "Cannot delete block: remove its sequences first."` Order matters: state error wins. | ~5 LOC + 2 tests |
| 8 | `blocks.py` `delete_sequence` | After existing state check, count items; if ≥ 1 → `409 "Cannot delete sequence: remove its items first."` | ~5 LOC + 2 tests |

Approximate totals: ~160 LOC backend, ~27 new backend tests. No DB schema migration.

**Schema naming convention.** New Pydantic models follow the existing `*Update` / `*Request` / `*Response` pattern: `VersionPatch` (PATCH body), `VersionRenderRequest`, `VersionRenderResponse`, `AdminTreeResponse` (or untyped). `MyCourseResponse` gets the new `is_admin` field.

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

Slug for course; numeric IDs for blocks/sequences/items (matches backend addressing). The `auth: true` flag only checks login; per-course admin enforcement is server-side (a non-admin hitting `/api/courses/by-slug/{slug}` gets 403 → frontend renders a back-to-courses panel).

**Route param strings vs tree IDs.** Route params are always strings; admin-tree IDs are numbers. Page guards must compare via `Number(params.versionId)` or `String(tree.id) === params.versionId`, never raw `tree.id !== params.versionId`.

**Deep link hierarchy validation.** When a deep link mounts a sub-page (block/sequence/item), the page must verify the cached admin-tree's hierarchy matches: course slug → version → block → sequence → item. If any link is wrong (e.g. block doesn't belong to this version), render 404 — don't show a wrong entity from the cached tree.

### Page-by-page summary

| Page | Fetches | Key actions |
|---|---|---|
| **VersionsPage** `/courses/:courseSlug/edit` | `GET /api/courses/by-slug/{slug}`, `GET /api/courses/{cid}/versions` | "Create new version" form (info_md + max_quiz_attempts); per-row Open / Disable / Enable / Delete (delete only when state=`created` and not disabled). |
| **VersionEditPage** `/.../v/:versionId` | `GET /api/versions/{vid}/admin-tree` | Edit version `info_md` + `max_quiz_attempts` (`PATCH /api/versions/{vid}`, gated by `canEditVersionMeta`); list blocks with ↑/↓ + Open; create block. State actions on this version: Publish / Archive / Revert / Disable / Enable / Delete (each gated per §10). |
| **BlockEditPage** `/.../blocks/:blockId` | reads from cached admin-tree | Edit `block.title` + `block.info` (`PATCH /api/blocks/{bid}`, gated by `canEditTextFields`); list sequences with ↑/↓ + Open; create sequence (gated by `canEditStructure`); "Delete this block" button (disabled when block has sequences or `!canEditStructure`). |
| **SequenceEditPage** `/.../sequences/:sequenceId` | reads from cached admin-tree | Edit `sequence.title` (`PATCH /api/sequences/{sid}`); list items with ↑/↓ + Open + per-row `ItemIcon` (mode=`plain`); create item (icon-radio type picker, see below); "Delete this sequence" button (disabled when sequence has items or `!canEditStructure`). |
| **ItemEditPage** `/.../items/:itemId` | reads from cached admin-tree | Type-dispatched form: `static_page` → `MarkdownEditor` for `content_md`; `video` → `video_url` input; `quiz` and `interactive_app` → read-only "Not editable in this slice" panel with the item's title and (for quiz) a count of questions. `PATCH /api/items/{iid}` on save for editable types. "Delete this item" button (gated by `canEditStructure`). |

Delete buttons live on each entity's own edit page (one click deeper than the list row). Parent-list rows expose ↑/↓ and Open only. Versions are an exception — top-level, deletable from VersionsPage rows.

**Item creation flow** addresses the validator constraints (`ItemCreate` rejects empty `content_md` for `static_page` and missing `video_url` for `video`):

1. Click "+ New item" on `SequenceEditPage` — a 2-step inline form opens.
2. Step 1: `ItemTypePicker` (icon radios for `static_page` / `video`).
3. Step 2: title + slug + the type-specific required field:
   - `static_page` → a small `content_md` textarea seeded with `# {title}\n` (so the validator passes with non-empty content).
   - `video` → `video_url` input (URL, required).
4. Submit → `POST /api/sequences/{sid}/items` with the full payload. On 201 → refetch tree + navigate into the new item editor.

**`CourseView` admin link** (`pages/CourseView.svelte`). The student-mode `CourseView` calls `loadCourse(slug)` which hits `/my-version` and 404s for admin-not-enrolled. For slice 1 we keep `CourseView` student-only and the "Edit course" affordance lives on `CourseList` (where `is_admin` is already on every row). `CourseView` adds a small "Edit this course" link in its header **only when** the loaded course resolved successfully *and* the user `is_admin` (read from `currentCourse.value.is_admin`, which we add to the `loadCourse` flow as a passthrough). Admin-not-enrolled users never reach `CourseView`; they enter the editor from `CourseList` directly.

Direct URL hits work — see §4 admin-tree fetch.

---

## 4. Admin-tree fetch and cache

A new store `currentEditorVersion` (`stores/currentEditorVersion.svelte.ts`) holds the result of `GET /api/versions/{vid}/admin-tree`:

```ts
export const currentEditorVersion = $state<{
  value: AdminTree | null;
  loading: boolean;
  error: string | null;
}>({ value: null, loading: false, error: null });

// Single-flight: in-flight requests for the same versionId don't fan out.
// Stale-guard: a fetch completing for an older versionId is dropped.
export async function loadAdminTree(versionId: number): Promise<void> { ... }
export function clearEditorVersion(): void { ... }
```

The store exposes named actions (`loadAdminTree`, `clearEditorVersion`) so pages don't reach into `.value` to mutate it. This mirrors `currentCourse.svelte.ts` which exports `loadCourse` / `clearCourse`.

**On page load.** If `currentEditorVersion.value?.id !== Number(params.versionId)`, the page calls `loadAdminTree(Number(params.versionId))` before rendering. Sub-pages (block / sequence / item) read directly from the cached tree.

**After mutations.** The page that performed the mutation calls `loadAdminTree(versionId)` again to refetch before re-rendering or navigating. Optimistic updates are slice-2 polish.

**Concurrency.** Last-write-wins for now. The backend already documents that order assignment is not safe under concurrent writes (`blocks.py:51`, `items.py:46`). The frontend mitigates by refetching the tree after every mutation and treating 400/409 reorder failures as "refresh and retry — toast the message and force a tree reload". A real `SELECT FOR UPDATE` fix lands with the broader Phase 9 concurrency sweep.

**Tree shape (admin-tree response):**

```jsonc
{
  "course": { "id": 1, "name": "Calculus", "slug": "calculus" },
  "version": {
    "id": 3, "course_id": 1, "state": "created", "is_disabled": false,
    "info_md": "...", "info_html": "...", "max_quiz_attempts": 3,
    "created_at": "...", "published_at": null, "archived_at": null,
    "content_updated_at": "..."
  },
  "blocks": [
    {
      "id": 12, "version_id": 3,
      "title": "Limits", "slug": "limits", "order": 1,
      "info": "...", "info_html": "...",
      "sequences": [
        {
          "id": 47, "block_id": 12,
          "title": "Intro", "slug": "intro", "order": 1,
          "items": [
            {
              "id": 87, "sequence_id": 47,
              "title": "What is a limit", "slug": "what-is-limit",
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

Includes `content_md` / `info_md` so the editor can populate forms without extra fetches; includes parent FKs so deep-link hierarchy validation (see §3) can run without recomputing relationships. Existing student `/api/versions/{vid}/content` is unchanged.

---

## 5. Save / dirty / discard flow

Each form snapshot is captured on mount as a plain object. Dirty detection is a **shallow string-field compare** between the live form values and the snapshot (`for (k of keys) if (form[k] !== snap[k]) return true`). All current editor forms only contain string fields (titles, slugs, markdown, URLs) so no deep-equal helper is needed and no JS dep is pulled in.

`lib/dirty.svelte.ts` exposes:

```ts
export function makeDirtyTracker<T extends Record<string, string>>(initial: T): {
  current: T;          // reactive form values
  isDirty: boolean;    // reactive flag
  reset(next: T): void; // re-snapshot after Save
};
```

| Action | Behavior |
|---|---|
| **Save** | `PATCH /api/{thing}/{id}` → on 200 refetch the relevant cache (admin-tree inside a version editor; versions list on `VersionsPage`), `tracker.reset(serverResponse)`, toast "Saved". On 422 → inline per-field errors via `ApiError.validationErrors()`. On 409 → toast. |
| **Discard** | `tracker.reset(snapshot)` — form reverts to last-saved state. |
| **Navigate while dirty** | `DirtyGuard` registers itself with the router's new `beforeNavigate` hook (see below) and with `window.beforeunload`. Both prompt with native `confirm("Discard unsaved changes?")`. |

**Router contract change.** `lib/router.svelte.ts` is **MODIFIED** to add a navigation-guard registry:

```ts
type Guard = () => boolean | Promise<boolean>;  // false = cancel navigation
let guards: Guard[] = [];
export function registerNavigationGuard(g: Guard): () => void { ... }  // returns disposer
// navigate() and the popstate handler now `await` every registered guard;
// if any returns false, navigation is cancelled and history is not updated
// (for popstate, `history.go(1)` is used to undo the back).
```

`DirtyGuard.svelte` registers a guard on mount and disposes it on unmount. This is the only router contract change in slice 1.

**Dirty + state actions.** Publishing, archiving, reverting, disabling, deleting, or any structural op (create/delete/reorder) on a page where the local form is dirty must first prompt: "You have unsaved changes. Save them, discard them, or cancel?" This prevents the admin from clicking Publish after typing content and accidentally publishing the previous persisted state. Implementation: each action handler asks the active dirty tracker before proceeding.

Structural ops (create / delete / reorder) on *another* form (no dirty tracker active) commit immediately without a Save button — they're not gated by Save themselves.

---

## 6. Reorder, create, delete

**Reorder ↑/↓.** Click → compute full new ordering → `POST .../reorder` → refetch tree. Buttons disabled while in flight to prevent double-clicks. On 4xx (e.g. concurrent edit invalidated the order list) → toast the backend message and force-refetch the tree.

**Create (sub-entity).** Inline form below the list (or expands on "+ New" click). For items, the type-specific required-fields step described in §3 is part of the create form. POST. On 201 refetch tree, reset form, navigate into the new entity. 409 (slug collision in same parent) → inline error on the slug field. 422 → inline.

**Delete.**
- Confirm via native `confirm()` ("Delete block 'Limits'? This cannot be undone.").
- `DELETE /api/{thing}/{id}` → on 204 refetch and navigate up one level.
- 409 (state restriction OR delete guard) → toast with backend message.

**Block / sequence delete guards (new backend rule, codified order).**
- Backend `delete_block` (`blocks.py:112`): existing state check first (`state != "created"` → 409); then count sequences and 409 if non-empty. State error wins so the most actionable error surfaces.
- Backend `delete_sequence` (`blocks.py:219`): existing state check first; then count items and 409 if non-empty.
- Frontend: the Delete button on `BlockEditPage` / `SequenceEditPage` is disabled with a tooltip ("Remove sequences first" / "Remove items first") when the cached tree shows children present and the version state allows structure edits. Backend remains source of truth.
- Version-level delete is unchanged (cascading) and only allowed in state=`created`.

---

## 7. Markdown preview

`MarkdownEditor.svelte` props:

```ts
let { versionId, value, onchange }: {
  versionId: number;
  value: string;
  onchange: (next: string) => void;
} = $props();
```

Two tabs: **Edit** (textarea bound via `value` + `onchange`) and **Preview**.

- Switching to Preview calls `POST /api/versions/{versionId}/render` with `{content_md: value}` and shows the returned HTML.
- No debounce — only re-fetches on tab switch.
- Loading and error states handled inline within the Preview tab.
- Preview never persists. Save is a separate explicit action (§5).

Endpoint:

```http
POST /api/versions/{vid}/render
Content-Type: application/json
{ "content_md": "..." }

200 OK
{ "html": "..." }
```

Course-admin-gated (`require_course_admin` on the version's course). `is_disabled` → 403. All other states (created/published/archived) → OK.

---

## 8. Publish flow

`VersionEditPage` exposes a "Publish version" button when `canPublish` (see §10).

1. **Dirty check first.** If `info_md` or `max_quiz_attempts` is dirty, prompt save/discard/cancel before continuing.
2. Confirm via `confirm()`.
3. `POST /api/versions/{vid}/publish`.
4. **200** → refetch admin-tree, toast "Version published".
5. **409** → toast the backend message verbatim. The backend already returns user-facing error strings such as: *"Block 'Limits' has no sequences. Every block must have at least one sequence to publish."*, *"Sequence 'Intro' has no items..."*, *"Question '…' needs at least 2 options to publish."* Frontend does not pre-validate.

Other state transitions (`archive`, `revert`, `disable`, `enable`, `delete`) follow the same pattern: dirty-check → confirm → POST → refetch / navigate / toast.

---

## 9. Error → UI mapping

Consistent with the student MVP.

| Status | Where | Why |
|---|---|---|
| 401 | Existing `events.emitUnauthorized` → redirect to `/login` | Session bounce |
| 403 / 404 | Full-page panel with back link | Permission / missing data; page can't render |
| 409 | Toast | Action-level business rule (state restriction, slug collision, publish-validation, delete guard, reorder race). **Exception:** slug collision on create is shown as an inline field error. |
| 422 | Inline per-field via `ApiError.validationErrors()` | Pydantic field validation |
| 5xx | Toast "Something went wrong. Please try again." | Server error |

---

## 10. Read-only handling per version state

Every editor page reads its enabled-affordance set from a single helper:

```ts
// lib/versionPermissions.ts
export type VersionPermissions = {
  canEditVersionMeta: boolean;   // info_md, max_quiz_attempts
  canEditStructure:   boolean;   // create / delete / reorder block, sequence, item
  canEditTextFields:  boolean;   // titles, info, content_md, video_url
  canPublish:         boolean;
  canArchive:         boolean;
  canRevert:          boolean;
  canDisable:         boolean;
  canEnable:          boolean;
  canDeleteVersion:   boolean;
};

export function versionPermissions(v: { state: string; is_disabled: boolean }): VersionPermissions;
```

The single helper centralizes the matrix so gaps are caught in one file rather than scattered across pages.

**State × permission matrix:**

| Permission | `created` (not disabled) | `published` | `archived` | `is_disabled` |
|---|:-:|:-:|:-:|:-:|
| `canEditVersionMeta` | ✓ | — | — | — |
| `canEditStructure` | ✓ | — | — | — |
| `canEditTextFields` | ✓ | ✓ | — | — |
| `canPublish` | ✓ | — | — | — |
| `canArchive` | — | ✓ | — | — |
| `canRevert` | — | ✓ (backend further checks no enrolled students) | — | — |
| `canDisable` | ✓ | ✓ | ✓ | — (backend further checks no active runs) |
| `canEnable` | — | — | — | ✓ |
| `canDeleteVersion` | ✓ | — | — | — |

UI behavior:
- `created` (default editable state) → all CRUD enabled per the table above.
- `published` → text-field edits remain (titles, info, content_md, video_url); structural ops (create/delete/reorder) and version-meta edits hidden / disabled with tooltip "Only allowed in 'created' state".
- `archived` → all edit affordances disabled. No state action available from this state in slice 1.
- `is_disabled` → top-of-page banner: "This version is disabled — editing is not allowed". All writes hidden. Only state action: Enable.

Backend already enforces these rules; the frontend's role is to hide/disable affordances so users don't see 409s for predictable cases. Tests for `versionPermissions` cover every state combination so a regression flips them visibly.

---

## 11. Testing approach

### Backend tests (pytest via `backend/.venv`)

| Concern | File | Tests |
|---|---|---|
| `is_admin` field on `CourseResponse` | `tests/test_courses.py` | 3 (admin true, non-admin false, superuser true) |
| `/api/my-courses` extension (admin courses + `is_admin` flag) | `tests/test_student.py` | 4 (admin-only, enrolled-only, both, neither) |
| `GET /api/courses/by-slug/{slug}` | `tests/test_courses.py` | 3 (admin 200, non-admin 403, unknown slug 404) |
| `PATCH /api/versions/{vid}` | `tests/test_versions.py` | 5 (created OK, published 409, archived 409, disabled 403, info_html re-render + bump_content_updated_at) |
| `POST /api/versions/{vid}/render` | `tests/test_versions.py` | 3 (admin OK, non-admin 403, disabled 403) |
| `GET /api/versions/{vid}/admin-tree` | `tests/test_content.py` (or new) | 5 (created OK, published OK, archived OK, disabled OK admin, non-admin 403, includes content_md/info_md/parent FKs) |
| Block delete-with-sequences guard | `tests/test_blocks.py` | 2 (empty→204, non-empty→409, state error precedes child-count error) |
| Sequence delete-with-items guard | `tests/test_blocks.py` | 2 (empty→204, non-empty→409, state error precedes child-count error) |

≈ 27 new backend tests using the existing in-process FastAPI test client + tmp-DB fixture. No infra change.

### Frontend tests (vitest, plain `.ts`)

Unit tests for non-component lib code, mirroring student-MVP pattern in `frontend/src/tests/`:

| Module | What |
|---|---|
| `lib/dirty.svelte.ts` | Snapshot equality (shallow string compare), dirty toggling, reset. |
| `lib/versionPermissions.ts` | Every (state, is_disabled) combination produces the expected permission set. |
| `lib/router.svelte.ts` | New `registerNavigationGuard` cancels navigation on `false`; popstate undo path. |
| `stores/currentEditorVersion.svelte.ts` | `loadAdminTree` single-flight + stale-guard, error states. |
| Router | Extend `tests/router.test.ts` for the 5 new patterns. |

Component-level `.svelte` tests are out of scope for slice 1 (would require `@testing-library/svelte` runtime, not worth it for this size). Validation done via the manual smoke checklist below.

### Manual smoke checklist

Run before claiming complete:

1. Login → CourseList — admin sees their admin courses (even when not enrolled); enrolled-only courses still appear; "Edit" button shown only on rows where `is_admin=true`.
2. Versions list → create new version → opens editor.
3. Block CRUD: create, rename, reorder ↑/↓, delete (empty).
4. Block delete guard: try to delete a block with sequences → 409 + tooltip on disabled button.
5. Sequence CRUD mirror; sequence delete-with-items guard.
6. Item create: icon-radio type picker; both `static_page` (textarea seeded with `# title`) and `video` (URL required) types. Create with empty content fails per backend validators — confirm the form prevents this.
7. `MarkdownEditor`: write content → Preview → renders correctly. Save → reload → content persists. Disabled-state version → Preview returns 403 → inline error.
8. Existing quiz/interactive item: clicking "Open" lands on read-only "Not editable in this slice" page with item title visible; delete works when state=`created`.
9. Dirty-state warning: edit a field, click another menu → confirm dialog; Cancel keeps you on page.
10. Dirty + Publish: edit info_md without saving, click Publish → save/discard/cancel prompt before publish call.
11. Publish flow: empty block (no sequences) → backend's exact 409 string in toast. Fix, retry → publishes.
12. Read-only state per `versionPermissions`: `published` keeps text edits; `archived` disables all; `is_disabled` shows banner. Verify all matrix cells.
13. Direct deep-link URL to an item editor (cold load) → admin-tree fetches, page renders. Hand-edited URL with mismatched hierarchy → 404 page (not wrong-entity render).
14. Production build (`npm run build` + backend SPA mount) → editor pages load via SPA routing; refresh works at every depth.

---

## 12. Suggested implementation order

A plan will be written separately by the writing-plans skill. As an initial sketch:

1. Backend: `is_admin` on `CourseResponse` (default `False`), `is_admin` flag for superusers, `MyCourseResponse.is_admin`, extend `/my-courses` to include admin courses (the smallest unblock for the frontend's CourseList).
2. Backend: `GET /api/courses/by-slug/{slug}` (route declared **before** `/api/courses/{course_id}`).
3. Backend: block / sequence delete guards (independent, small).
4. Backend: `PATCH /api/versions/{vid}`, `POST /api/versions/{vid}/render`, `GET /api/versions/{vid}/admin-tree` (the three editor-supporting endpoints).
5. Frontend: `lib/router.svelte.ts` `beforeNavigate` hook + `registerNavigationGuard` (router contract change, lands first to unblock `DirtyGuard`).
6. Frontend: types, `lib/versionPermissions.ts`, `lib/dirty.svelte.ts`, `currentEditorVersion` store, `DirtyGuard`, route additions.
7. Frontend: `CourseList` admin "Edit" affordance (consumes new `/my-courses` shape).
8. Frontend: `VersionsPage` + create/delete/disable/enable wiring.
9. Frontend: `VersionEditPage` + version-meta form + block CRUD + reorder + state actions.
10. Frontend: `BlockEditPage` + sequence CRUD.
11. Frontend: `SequenceEditPage` + item CRUD + `ItemTypePicker` + 2-step item create.
12. Frontend: `ItemEditPage` (static_page + video editors + read-only fallback for quiz/interactive).
13. Frontend: `MarkdownEditor` (with Preview). Wired into `ItemEditPage`.
14. Frontend: `CourseView` admin "Edit course" link (gated to not break for non-enrolled admins).
15. Frontend: `ItemIcon` `mode` prop refactor (consumed by the picker).
16. Frontend: `App.svelte` `componentMap` entries for the 5 new pages.
17. Read-only state gating across pages — verify every page consults `versionPermissions`.
18. Manual smoke pass + production build verification.

Each step lands on a feature branch off `main` (no worktrees), with backend tests passing per `backend/.venv/bin/pytest` and frontend tests passing per `npm run check && npm run test`.
