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
│   ├── CourseList.svelte                     # MODIFIED — admin "Edit" affordance per row + admin-only row UX (see §3)
│   └── editor/                               # NEW
│       ├── VersionsPage.svelte
│       ├── VersionEditPage.svelte
│       ├── BlockEditPage.svelte
│       ├── SequenceEditPage.svelte
│       └── ItemEditPage.svelte
└── components/
    └── editor/                               # NEW
        ├── ItemTypePicker.svelte             # `<fieldset>` of `<label>` wrapping visually-hidden `<input type="radio">` + an inline icon glyph; selected state styled via `:has(:checked)`. Does NOT reuse `ItemIcon.svelte` (which is a `<button>` — wrong semantics inside a radio group).
        ├── MarkdownEditor.svelte             # textarea + Preview tab; props: { versionId, value, onchange }
        └── DirtyGuard.svelte                 # uses router.svelte.ts navigation guard + window.beforeunload
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
| 1 | `student.py` (`/api/my-courses`) + `schemas.py` (`MyCourseResponse`) | Extend the endpoint to also return courses where the user is a course admin (not just enrolled), and — for superusers — every course. Schema changes: `MyCourseResponse.version_id: int \| None = None`, `version_state: str \| None = None`, `is_active: bool = False`, `total_items: int = 0`, `covered_items: int = 0`, `is_admin: bool = False`. Admin-only rows return `version_id=None, version_state=None`, the rest zeroed. Mixed (admin + enrolled) rows merge into one row with both flags populated. Frontend `CourseListItem` mirrors: `version_id: number \| null`, `version_state: 'created' \| 'published' \| 'archived' \| null`, `is_admin: boolean`. | ~30 LOC + 5 tests |
| 2 | `courses.py` + `schemas.py` (`CourseResponse`) | Add `is_admin: bool = False` to `CourseResponse` (default keeps existing `CourseResponse.model_validate(course)` callers working). Set to `True` for the requesting user in `list_courses`, `get_course`, and the new `by-slug` endpoint. Superusers receive `is_admin=True` on every course. | ~10 LOC + 3 tests |
| 3 | `courses.py` | Add `GET /api/courses/by-slug/{slug}` returning `CourseResponse`. **Course-admin-gated only** (not the broader visibility rules of `get_course`) — this is an admin entry point, so non-admins get 403/404. **Route placement:** insert between `list_courses` (`courses.py:50`) and `get_course` (`courses.py:53`) so FastAPI's declaration-order matching reaches the slug route before the int-typed `{course_id}` route and avoids a 422. | ~15 LOC + 3 tests |
| 4 | `versions.py` | Add `PATCH /api/versions/{vid}` accepting `info_md` and `max_quiz_attempts`. Allowed only when `state == "created"` and not `is_disabled`. Re-renders `info_html` via `render_with_assets`, re-syncs asset references, and calls `bump_content_updated_at(version)` for ETag consistency. New `VersionUpdate` schema (matches existing `*Update` naming convention — `BlockUpdate`, `ItemUpdate`, `SequenceUpdate`). | ~30 LOC + 5 tests |
| 5 | `versions.py` | Add `POST /api/versions/{vid}/render` accepting `{content_md: string}`, returning `{html: string}`. **Course-admin-gated.** Allowed in any state **except** `is_disabled` (returns 403). No persistence. Uses `render_with_assets`. New `VersionRenderRequest` / `VersionRenderResponse` schemas. | ~20 LOC + 3 tests |
| 6 | `content.py` (extend) | Add `GET /api/versions/{vid}/admin-tree`. **Course-admin-gated** (no enrolled-student fallback). **Allowed in every state including `is_disabled` and `created`** — admins must reach disabled versions to enable them, and reach created versions to edit them. Returns the same nested shape as `/content` plus `content_md`, `info_md`, parent FKs (`block.version_id`, `sequence.block_id`, `item.sequence_id`), and admin-only fields. New `AdminTreeResponse` schema (or untyped dict response, matching existing `/content` style). | ~50 LOC + 6 tests |
| 7 | `blocks.py` `delete_block` | After existing state check (`state != "created"` → 409), count sequences; if ≥ 1 → `409 "Cannot delete block: remove its sequences first."` Order matters: state error wins. | ~5 LOC + 3 tests |
| 8 | `blocks.py` `delete_sequence` | After existing state check, count items; if ≥ 1 → `409 "Cannot delete sequence: remove its items first."` | ~5 LOC + 3 tests |
| 9 | `versions.py` `publish_version` | Add `is_disabled` check at the top: `if version.is_disabled: raise 403 "Version is disabled"`. Currently missing — required so the §10 read-only matrix is actually enforced server-side (`canPublish` is `False` when `is_disabled`). Mirrors the `is_disabled` gate present on `archive_version`/`revert_version`. | ~3 LOC + 1 test |

Approximate totals: ~170 LOC backend, ~32 new backend tests. No DB schema migration.

**Schema naming convention.** New Pydantic models follow the existing `*Update` / `*Request` / `*Response` pattern: `VersionUpdate` (PATCH body), `VersionRenderRequest`, `VersionRenderResponse`, `AdminTreeResponse` (or untyped). `MyCourseResponse` gets the new fields above. `CourseResponse` gets `is_admin`.

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
| **CourseList** (modified existing page) | `GET /api/my-courses` (extended) | Per-row UX: enrolled-only → progress + "Continue" link to `/courses/:slug` (existing behavior); admin-only → "Admin" badge instead of progress + "Edit" link to `/courses/:slug/edit` (no link to student `/courses/:slug` since it would 404 via `/my-version`); mixed (admin + enrolled) → progress + "Continue" link + small "Edit" affordance. Distinguished by `version_id !== null` (enrolled) vs `is_admin === true` (admin). |
| **VersionsPage** `/courses/:courseSlug/edit` | `GET /api/courses/by-slug/{slug}`, `GET /api/courses/{cid}/versions` | "Create new version" form (info_md + max_quiz_attempts); per-row Open / Disable / Enable / Delete (delete only when state=`created` and not disabled). |
| **VersionEditPage** `/.../v/:versionId` | `GET /api/versions/{vid}/admin-tree` | Edit version `info_md` + `max_quiz_attempts` (`PATCH /api/versions/{vid}`, gated by `canEditVersionMeta`); list blocks with ↑/↓ + Open; create block. State actions on this version: Publish / Archive / Revert / Disable / Enable / Delete (each gated per §10). |
| **BlockEditPage** `/.../blocks/:blockId` | reads from cached admin-tree | Edit `block.title` + `block.info` (`PATCH /api/blocks/{bid}`, gated by `canEditTextFields`); list sequences with ↑/↓ + Open; create sequence (gated by `canEditStructure`); "Delete this block" button (disabled when block has sequences or `!canEditStructure`). |
| **SequenceEditPage** `/.../sequences/:sequenceId` | reads from cached admin-tree | Edit `sequence.title` (`PATCH /api/sequences/{sid}`); list items with ↑/↓ + Open + per-row `ItemIcon` (existing component, used in its existing `<button>` mode for the row link); create item (icon-radio type picker, see below); "Delete this sequence" button (disabled when sequence has items or `!canEditStructure`). |
| **ItemEditPage** `/.../items/:itemId` | reads from cached admin-tree | Type-dispatched form: `static_page` → `MarkdownEditor` for `content_md`; `video` → `video_url` input (`type="url"`, native browser validation, http(s) only — backend rejects other schemes); `quiz` and `interactive_app` → read-only "Not editable in this slice" panel with the item's title and (for quiz) a count of questions. `PATCH /api/items/{iid}` on save for editable types. "Delete this item" button (gated by `canEditStructure`). |

Delete buttons live on each entity's own edit page (one click deeper than the list row). Parent-list rows expose ↑/↓ and Open only. Versions are an exception — top-level, deletable from VersionsPage rows.

**Item creation flow** addresses the validator constraints (`ItemCreate` rejects empty `content_md` for `static_page` and missing `video_url` for `video`):

1. Click "+ New item" on `SequenceEditPage` — a 2-step inline form opens.
2. Step 1: `ItemTypePicker` — `<fieldset>` with `<label>` per type wrapping a visually-hidden `<input type="radio">` plus an inline icon glyph. Selected state styled via the parent label's `:has(:checked)` selector. Real `<input type="radio">` keeps keyboard navigation and screen-reader semantics correct.
3. Step 2: title + slug + the type-specific required field:
   - `static_page` → a small `content_md` textarea seeded with `# {title}\n` (so the `ItemCreate` validator passes with non-empty content; `# {title}` is a sensible h1 the author will likely keep).
   - `video` → `video_url` input (`type="url"`, required, http(s) accepted by backend).
4. Submit → `POST /api/sequences/{sid}/items` with the full payload. On 201 → refetch tree + navigate into the new item editor.

**`CourseView` is intentionally NOT modified** in slice 1. The student `CourseView` calls `/api/courses/{slug}/my-version`, which 404s for admin-not-enrolled, and adding admin-aware logic to the student page sits outside this slice. The admin "Edit course" affordance lives only on `CourseList` rows. Slice 2 can add a richer `CourseView` admin overlay if needed.

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

// Module-level single-flight + stale-guard state.
let inflight: { versionId: number; promise: Promise<void> } | null = null;
let token = 0;

/**
 * loadAdminTree(versionId, { force }) — fetches the admin tree.
 *
 * Read dedupe: callers requesting the *same* versionId while a fetch is in
 * flight share the same Promise, so each `await` resolves only after data is
 * available (no caller proceeds before the tree is loaded).
 *
 * Force refetch: callers passing { force: true } always start a new request,
 * regardless of any in-flight call. Use after mutations (PATCH/POST/DELETE)
 * to ensure the cache reflects the write — never skip a refetch.
 *
 * Stale-guard: a request whose token is older than the latest token discards
 * its result (token is bumped on every new call, including force).
 */
export async function loadAdminTree(
  versionId: number,
  opts: { force?: boolean } = {},
): Promise<void> {
  // Read dedupe: same versionId in flight, no force → return the same promise.
  if (!opts.force && inflight && inflight.versionId === versionId) {
    return inflight.promise;
  }

  const myToken = ++token;
  currentEditorVersion.loading = true;
  currentEditorVersion.error = null;

  const promise = (async () => {
    try {
      const tree = await api.get<AdminTree>(`/api/versions/${versionId}/admin-tree`);
      if (myToken !== token) return;          // stale-guard: a newer call has started
      currentEditorVersion.value = tree;
    } catch (e) {
      if (myToken !== token) return;
      currentEditorVersion.error =
        e instanceof ApiError ? e.displayMessage : 'Could not load version.';
    } finally {
      if (myToken === token) {
        currentEditorVersion.loading = false;
        if (inflight && inflight.promise === promise) inflight = null;
      }
    }
  })();

  inflight = { versionId, promise };
  return promise;
}

export function clearEditorVersion(): void {
  token++; // invalidate any in-flight call
  inflight = null;
  currentEditorVersion.value = null;
  currentEditorVersion.error = null;
  currentEditorVersion.loading = false;
}
```

The store exposes named actions (`loadAdminTree`, `clearEditorVersion`) so pages don't reach into `.value` to mutate it. Mirrors `currentCourse.svelte.ts` (`loadCourse` / `clearCourse`) — both single-flight against their key (versionId vs courseSlug) and use a token counter so a slow response for an older key never overwrites a newer one's value.

**Call sites:**
- Page mount → `await loadAdminTree(versionId)` (read-dedupes against any concurrent mount).
- After mutation (PATCH/POST/DELETE) → `await loadAdminTree(versionId, { force: true })` so the refetch is never skipped by a coincidental in-flight read.

**On page load.** If `currentEditorVersion.value?.id !== Number(params.versionId)`, the page `await`s `loadAdminTree(Number(params.versionId))` before rendering. Sub-pages (block / sequence / item) read directly from the cached tree.

**After mutations.** The page that performed the mutation `await`s `loadAdminTree(versionId, { force: true })` to refetch before re-rendering or navigating. The `force` flag is required so the refetch isn't deduped against a coincidental in-flight read. Optimistic updates are slice-2 polish.

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

Each form snapshot is captured on mount as a plain object — only the form-shaped subset of the entity, not the full server payload. Dirty detection is a **shallow value compare** between the live form values and the snapshot (`for (k of keys) if (form[k] !== snap[k]) return true`). Current editor forms hold strings (titles, slugs, markdown, URLs) and one number (`max_quiz_attempts`); both compare correctly with `!==` so no deep-equal helper is needed and no JS dep is pulled in.

`lib/dirty.svelte.ts` exposes:

```ts
// T can hold strings (most forms) and primitive numbers (max_quiz_attempts).
export function makeDirtyTracker<T extends Record<string, string | number>>(initial: T): {
  current: T;          // reactive form values ($state-backed)
  isDirty: boolean;    // reactive (read via tracker.isDirty; do NOT destructure)
  reset(next: T): void; // re-snapshot to a form-shaped object (NOT the raw server response)
};
```

After Save, callers project the server response into the form shape before calling `reset` — e.g. `tracker.reset({ title: server.title, info: server.info })`. Passing the raw response in is a bug because the response carries fields not present in the form (timestamps, FKs, html-rendered fields).

| Action | Behavior |
|---|---|
| **Save** | `PATCH /api/{thing}/{id}` → on 200 refetch the relevant cache (admin-tree inside a version editor; versions list on `VersionsPage`), project response into form shape and call `tracker.reset(formShape)`, toast "Saved". On 422 → inline per-field errors via `ApiError.validationErrors()`. On 409 → toast. |
| **Discard** | `tracker.reset(snapshot)` — form reverts to last-saved state. |
| **Navigate while dirty** | `DirtyGuard` registers itself with the router's new navigation guard (see below) and with `window.beforeunload`. Both prompt with native `confirm("Discard unsaved changes?")`. |

**Router contract change.** `lib/router.svelte.ts` is **MODIFIED** to add a navigation-guard registry:

```ts
type Guard = () => boolean | Promise<boolean>;  // false = cancel navigation
let guards: Guard[] = [];
let suppressGuards = false;  // re-entrancy flag during programmatic restoration

export function registerNavigationGuard(g: Guard): () => void { ... }  // returns disposer

// navigate(path, opts) is async-internally: it awaits every registered guard;
// if any returns false, neither history.pushState nor currentRoute is updated.

// popstate handler: if any guard returns false, restore the URL by pushing
// the previous path back. This avoids guessing Back vs Forward direction:
//   suppressGuards = true;
//   history.pushState(null, '', previousPath);  // creates a forward entry
//   suppressGuards = false;
// The user gets one extra forward entry; URL and currentRoute remain stable.
// `suppressGuards` prevents the pushState's own popstate-emit (none is fired
// by pushState, but the flag also skips guards on programmatic navigations
// triggered as part of restoration).
```

`previousPath` is captured by the router on every successful navigation (in a module-level `lastResolvedPath: string`). `DirtyGuard.svelte` registers a guard on mount and disposes it on unmount. This is the only router contract change in slice 1. `hashchange` is not guarded — quiz / sequence anchors use hashes and should not trigger the dirty prompt.

**Dirty + state actions (rule, simplified to avoid 3-way modals).** When a form is dirty, all state actions (Publish / Archive / Revert / Disable / Enable / Delete version / delete-this-block / etc.) and structural ops (create / delete / reorder children) on the same page are **disabled** with a tooltip: "Save or discard your changes first." The admin clicks Save (committing) or Discard (reverting) using the form's existing buttons before clicking the action. This sidesteps the 3-way save/discard/cancel prompt that native `confirm()` cannot render and keeps the rule trivially predictable: dirty form ⇒ buttons disabled.

Structural ops on *another* page (no active dirty tracker) commit immediately as before.

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

1. **Dirty gate.** If the version meta form is dirty, the Publish button is disabled with tooltip "Save or discard your changes first" (per §5 dirty-button rule). The user clicks Save or Discard, then Publish becomes enabled.
2. Confirm via `confirm("Publish version 3? This makes it visible to enrolled students.")`.
3. `POST /api/versions/{vid}/publish`.
4. **200** → refetch admin-tree, toast "Version published".
5. **403** → version is `is_disabled`; toast the backend message (added gate per §2 row 9).
6. **409** → toast the backend message verbatim. The backend already returns user-facing error strings such as: *"Block 'Limits' has no sequences. Every block must have at least one sequence to publish."*, *"Sequence 'Intro' has no items..."*, *"Question '…' needs at least 2 options to publish."* Frontend does not pre-validate.

Other state transitions (`archive`, `revert`, `disable`, `enable`, `delete`) follow the same pattern: dirty-button gate → confirm → POST → refetch / navigate / toast.

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
- `created` (default editable state) → all CRUD enabled per the table above. Available state actions: Publish, Disable, Delete.
- `published` → text-field edits remain (titles, info, content_md, video_url); structural ops (create/delete/reorder) and version-meta edits hidden / disabled with tooltip "Only allowed in 'created' state". Available state actions: Archive, Revert, Disable.
- `archived` → all edit affordances disabled. Available state action: **Disable** (per the matrix; matches the backend `disable_version` rule that allows disabling from any state, gated on no active runs).
- `is_disabled` → top-of-page banner: "This version is disabled — editing is not allowed". All writes hidden. Available state action: Enable.

Backend enforces these rules: the existing `disable`/`archive`/`revert`/`delete`/`PATCH` endpoints already check state, and the new spec adds the missing `is_disabled` check on `publish_version` (§2 row 9). The frontend's role is to hide / disable affordances so users don't see 409s for predictable cases. Tests for `versionPermissions` cover every state combination so a regression flips them visibly.

---

## 11. Testing approach

### Backend tests (pytest via `backend/.venv`)

| Concern | File | Tests |
|---|---|---|
| `is_admin` field on `CourseResponse` | `tests/test_courses.py` | 3 (admin true, non-admin false, superuser true) |
| `/api/my-courses` extension | `tests/test_student.py` | 5 (admin-only row has `version_id=None`, enrolled-only unchanged, mixed admin+enrolled merges to one row, superuser sees all courses with `is_admin=true`, plain user with neither role sees []) |
| `GET /api/courses/by-slug/{slug}` | `tests/test_courses.py` | 3 (admin 200, non-admin 403, unknown slug 404) |
| `PATCH /api/versions/{vid}` | `tests/test_versions.py` | 5 (created OK, published 409, archived 409, disabled 403, info_html re-render + `bump_content_updated_at` bump) |
| `POST /api/versions/{vid}/render` | `tests/test_versions.py` | 3 (admin OK, non-admin 403, disabled 403) |
| `GET /api/versions/{vid}/admin-tree` | `tests/test_content.py` (or new) | 6 (created OK, published OK, archived OK, disabled OK for admin, non-admin 403, response includes `content_md`/`info_md`/parent FKs) |
| Block delete-with-sequences guard | `tests/test_blocks.py` | 3 (empty→204, non-empty→409, state error precedes child-count error) |
| Sequence delete-with-items guard | `tests/test_blocks.py` | 3 (empty→204, non-empty→409, state error precedes child-count error) |
| `publish_version` `is_disabled` gate (new) | `tests/test_versions.py` | 1 (disabled→403) |

≈ 32 new backend tests using the existing in-process FastAPI test client + tmp-DB fixture. No infra change.

### Frontend tests (vitest, plain `.ts`)

Unit tests for non-component lib code, mirroring student-MVP pattern in `frontend/src/tests/`:

| Module | What |
|---|---|
| `lib/dirty.svelte.ts` | Snapshot equality (shallow value compare across string + number fields), dirty toggling, reset to form-shaped object. |
| `lib/versionPermissions.ts` | Every (state, is_disabled) combination produces the expected permission set — including `canDisable=true` on `archived`. |
| `lib/router.svelte.ts` | `registerNavigationGuard` cancels navigation on `false`; popstate cancel restores URL via pushState of `lastResolvedPath`; disposer removes guard; `suppressGuards` flag prevents re-entrancy. |
| `stores/currentEditorVersion.svelte.ts` | `loadAdminTree` single-flight (same versionId in flight is no-op), stale-guard (older response dropped if newer call started), `clearEditorVersion` invalidates pending. |
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
9. Dirty-state warning: edit a field, click another menu → confirm dialog; Cancel keeps you on page; browser Back while dirty → confirm dialog; Cancel restores URL.
10. Dirty + Publish: edit info_md without saving, Publish button is disabled with tooltip "Save or discard your changes first"; clicking Save (or Discard) re-enables Publish.
11. Publish flow: empty block (no sequences) → backend's exact 409 string in toast. Fix, retry → publishes.
12. Read-only state per `versionPermissions`: `published` keeps text edits and Archive/Revert/Disable; `archived` disables CRUD but **Disable** action is still available; `is_disabled` shows banner with **Enable** action. Verify all matrix cells.
13. Direct deep-link URL to an item editor (cold load) → admin-tree fetches, page renders. Hand-edited URL with mismatched hierarchy → 404 page (not wrong-entity render).
14. Production build (`npm run build` + backend SPA mount) → editor pages load via SPA routing; refresh works at every depth.

---

## 12. Suggested implementation order

A plan will be written separately by the writing-plans skill. As an initial sketch:

1. Backend: `is_admin` on `CourseResponse` (default `False`), superuser `is_admin=true`, `MyCourseResponse` schema extension (Optional version_id/version_state, `is_admin`), extend `/my-courses` to merge admin + enrolled rows + superuser-sees-all.
2. Backend: `GET /api/courses/by-slug/{slug}` (declared between `list_courses` and `get_course`).
3. Backend: block / sequence delete guards (independent, small).
4. Backend: `publish_version` `is_disabled` gate (small, prerequisite to §10 matrix correctness).
5. Backend: `PATCH /api/versions/{vid}`, `POST /api/versions/{vid}/render`, `GET /api/versions/{vid}/admin-tree` (the three editor-supporting endpoints).
6. Frontend: `lib/router.svelte.ts` `registerNavigationGuard` (router contract change, lands first to unblock `DirtyGuard`).
7. Frontend: types (Optional `version_id`/`version_state`, `is_admin`), `lib/versionPermissions.ts`, `lib/dirty.svelte.ts`, `currentEditorVersion` store with single-flight + stale-guard, `DirtyGuard`, route additions.
8. Frontend: `CourseList` admin "Edit" affordance + admin-only row UX (consumes new `/my-courses` shape).
9. Frontend: `VersionsPage` + create/delete/disable/enable wiring.
10. Frontend: `VersionEditPage` + version-meta form + block CRUD + reorder + state actions (with dirty-button gating).
11. Frontend: `BlockEditPage` + sequence CRUD.
12. Frontend: `SequenceEditPage` + item CRUD + `ItemTypePicker` + 2-step item create.
13. Frontend: `ItemEditPage` (static_page + video editors + read-only fallback for quiz/interactive).
14. Frontend: `MarkdownEditor` (with Preview). Wired into `ItemEditPage`.
15. Frontend: `App.svelte` `componentMap` entries for the 5 new pages.
16. Read-only state gating across pages — verify every page consults `versionPermissions`.
17. Manual smoke pass + production build verification.

Each step lands on a feature branch off `main` (no worktrees), with backend tests passing per `backend/.venv/bin/pytest` and frontend tests passing per `npm run check && npm run test`.
