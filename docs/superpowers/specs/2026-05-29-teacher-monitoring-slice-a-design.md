# Teacher Monitoring Surface — Slice A: unblock + landing

**Date:** 2026-05-29
**Status:** Design (post 5+5 reviewer pass — rev 3 incorporates round-2 Critical & Important fixes, including authz Critical: pinned-versions-only filter replaces state filter to fix loader-mount + cross-version leak)
**Slice:** A — minimum viable unblock + landing page
**Out of scope:** Submissions review surface (B), evaluations writing UI (C), teacher dashboards consuming `/dashboard/*` endpoints (D), notifications (E)

---

## 1. Problem

Mathion's frontend has an authoring surface for course admins (`/courses` → courses they own → versions/editor) and a deep run-management surface used by admins for live-run operations. Teachers — users with `RunTeacher` rows but no `CourseAdmin` — have no entry point. They can authenticate, but:

- After login they land on `/courses`, which returns only courses they admin or are enrolled in. Teachers see an empty list and a dead-end "Courses" header.
- Even if they navigate directly to `/courses/:slug/runs/:rid`, `RunDetailPage.loadAll` calls `GET /api/courses/by-slug/{slug}` first; that endpoint is `require_course_admin_for_run`-gated, so teachers get a 403 "Access denied" page before the run UI ever mounts.
- Two subsequent reads inside `loadAll` — `GET /api/courses/{cid}/versions` and `GET /api/versions/{vid}/blocks` — are also `require_course_admin`-only, so even if `by-slug` were opened, the run-detail page would still fail to load.

The backend already permits teachers to read and write per-run resources (assets, mini-projects, roster, groups, evaluations, etc.) via `require_run_admin_or_teacher`, INCLUDING `PATCH /api/runs/{rid}` (verified at `backend/mathion/api/runs.py:78-81`). The blockers are entirely at the course-info and entry-point layers, plus the missing run-list UI.

Slice A unblocks the existing run-detail UI for teachers and adds a teacher-tailored landing page. It does NOT redesign the run-detail UI itself — admin-only actions are conditionally hidden, but the tab layout, components, and overall structure stay identical.

## 2. User stories

- *As a teacher who's been added to a course's run*, I want to log in and see a list of the runs I teach, organized so I can find my active terms quickly.
- *As a teacher*, when I click on a run, I want the same run-detail page admins use, but without buttons that I can't act on (publish/unpublish/delete the run, publish/unpublish mini-projects).
- *As a course admin who also teaches one of my own runs*, I want a clear nav switcher between Authoring and Teaching, and login should default me to Authoring (my primary day-to-day).
- *As a teacher with no current assignments*, I want a clear empty state telling me what will appear when a course admin adds me.

## 3. Architecture

### Notes on code snippets

All Python snippets below assume these imports at file top (already present where noted, OR added in §12's file touches):

```python
from sqlalchemy import select, exists, func
from sqlalchemy.orm import Session
from mathion.models import (
    Course, CourseVersion, Run, RunStudent, RunTeacher, CourseAdmin, User,
)
```

All `db.scalar(select(exists().where(...)))` returns are coerced via `bool(...)`. The test DB is SQLite (`backend/mathion/config.py:7`) and SQLAlchemy's SQLite dialect returns integer `1` / `0` for scalar EXISTS, NOT Python `True` / `False` — so a plain `is True` check evaluates to `False` and silently breaks the role check. The existing precedent at `backend/mathion/api/helpers.py:267-272` (`has_submissions`) uses `... or False`; rev 3 uses `bool(...)` for the same effect, just more explicit.

### 3.1 Backend changes

#### 3.1.1 Open `GET /api/courses/by-slug/{slug}` to teachers

Current handler returns 403 if the user is not a `CourseAdmin` of the course. After this change, the gate is evaluated in this order:

1. `user.is_superuser` → return `is_admin: True` (unchanged).
2. User is a `CourseAdmin` of the course → return `is_admin: True` (unchanged).
3. `has_run_teacher_on_course(db, user, course.id)` is True → return `is_admin: False` (NEW).
4. Else → 403 (unchanged).

The `is_admin` field is already on `CourseResponse` (`backend/mathion/schemas.py:24`, default `False`). No schema change.

New helper in `backend/mathion/api/helpers.py`:

```python
def has_run_teacher_on_course(db: Session, user: User, course_id: int) -> bool:
    """Return True iff the user has a RunTeacher row on any run of any version of the course.

    This is a UI-relevant predicate used to widen READ access on three course-info
    endpoints. It is NOT used for any write-path authorization decision; the existing
    require_* helpers continue to gate writes.
    """
    return bool(db.scalar(
        select(exists().where(
            RunTeacher.user_id == user.id,
            RunTeacher.run_id == Run.id,
            Run.version_id == CourseVersion.id,
            CourseVersion.course_id == course_id,
        ))
    ))
```

The pattern `select(exists().where(...))` with multi-table predicates is already used in this codebase (`helpers.py:267-272`); SQLAlchemy generates an EXISTS over the implicit-cross-join reduced by the WHERE clauses, and `user_id` / `run_id` / `version_id` / `course_id` are all indexed.

#### 3.1.2 Open `GET /api/courses/{course_id}/versions` to teachers — pinned-versions-only filter

Same gate-order extension as §3.1.1, BUT with a content filter on the teacher branch that returns ONLY the versions actually pinned by at least one of the teacher's runs on this course. This is tighter than a state filter and fixes two issues at once:

- **Draft leak** — in-progress `created`-state drafts the teacher's runs aren't pinned to are excluded.
- **Cross-version leak** — a teacher of a run pinned to v2 cannot read v1's structure even if v1 is published.
- **Loader-mount safety** — `frontend/src/pages/runs/RunDetailPage.svelte:78` resolves `pinnedVersion = vs.find(v => v.id === r.version_id) ?? null`. If the response excluded the pinned version (e.g., because it's still in `created` state), `pinnedVersion` would be `null` and the block-load branch would be silently skipped. The pinned-versions-only filter guarantees the pinned version is always present.

Implementation:

- Superuser / admin path: return ALL versions of the course regardless of state (unchanged).
- Teacher path:
  ```python
  versions = db.scalars(
      select(CourseVersion)
      .where(
          CourseVersion.course_id == course_id,
          CourseVersion.id.in_(
              select(Run.version_id)
              .select_from(Run)
              .join(RunTeacher, RunTeacher.run_id == Run.id)
              .where(RunTeacher.user_id == user.id)
          ),
      )
      .order_by(CourseVersion.id.asc())
  ).all()
  ```
  The IN-subquery returns every version ID pinned by any of the teacher's runs (across all courses); the outer query intersects with versions on this specific course. Net effect: the teacher sees exactly the versions their runs need — typically one, sometimes a small set if they teach multiple runs on the same course with different pinned versions.

The filter applies regardless of `state` — a teacher of a run pinned to a `created`-state draft (unusual but admin-possible) still sees that one version, so the run-detail page mounts correctly.

`CourseVersion.state` is `Mapped[str]` (`backend/mathion/models.py:42`) — a plain string column, not a Python `Enum`. No `state` literals are needed in this filter, but they remain how existing handlers (e.g. `versions.py:101, 154, 280, 295, 317`) compare elsewhere.

No schema change; response shape stays `list[VersionResponse]`.

#### 3.1.3 Open `GET /api/versions/{version_id}/blocks` to teachers — pinned-version-only gate

Same gate-order shape, evaluated after the version is loaded:

1. `user.is_superuser` → allow.
2. User is `CourseAdmin` of `version.course_id` → allow.
3. `has_run_pinned_to_version(db, user, version_id)` is True → allow (NEW).
4. Else → 403.

The teacher branch allows reads regardless of `version.state` (including `created` drafts) and regardless of `version.is_disabled`. The narrow condition is: this specific version must be pinned by at least one of the teacher's runs. So:

- A teacher of v2 CANNOT read v1's blocks even if v1 is published (cross-version leak guard).
- A teacher of a run pinned to a disabled v2 CAN read v2's blocks (the existing run-detail UX in §5.4 requires this).
- A teacher of a run pinned to a `created`-state v2 CAN read v2's blocks (locks loader-mount safety for the edge case admin allows).

New helper in `backend/mathion/api/helpers.py`:

```python
def has_run_pinned_to_version(db: Session, user: User, version_id: int) -> bool:
    """Return True iff the user has a RunTeacher row on a run whose version_id matches.

    Used by /api/versions/{vid}/blocks to scope teacher reads to exactly the versions
    their runs need. UI-relevant predicate; never used for any write-path authorization.
    """
    return bool(db.scalar(
        select(exists().where(
            RunTeacher.user_id == user.id,
            RunTeacher.run_id == Run.id,
            Run.version_id == version_id,
        ))
    ))
```

Write endpoints on versions/blocks/sequences/items remain `require_course_admin`. Teachers can read the blocks of their pinned version(s), but cannot modify them. Cascade endpoints under blocks — `list_sequences` (`backend/mathion/api/blocks.py:272-280`), `list_items`, `list_questions`, `list_options` — all stay admin-only; see §6.1 for guard tests.

#### 3.1.4 Extend `GET /me` AND PIN-verify response with role flags

`UserResponse` (`backend/mathion/schemas.py`) gains two booleans with defaults to preserve `from_attributes=True` deserialization from the ORM:

```python
class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    is_superuser: bool
    is_disabled: bool
    photo_url: str | None
    has_course_admin: bool = False   # NEW — overwritten in handlers
    has_run_teacher: bool = False    # NEW — overwritten in handlers

    model_config = {"from_attributes": True}
```

**Why defaults matter.** Both `get_profile` (`backend/mathion/api/auth.py:49-51`) and the route handler `api_verify_pin` (`backend/mathion/api/auth.py:29-46`) call `UserResponse.model_validate(user)` against the ORM `User`, which has neither flag column. Without defaults, `model_validate` raises and BOTH endpoints 500. With defaults, both handlers MUST overwrite the flags before returning, via a private helper colocated with them in `auth.py`:

```python
# In backend/mathion/api/auth.py — add to imports:
#   from sqlalchemy import exists, select
#   from mathion.models import CourseAdmin, RunTeacher

def _user_response_with_flags(db: Session, user: User) -> UserResponse:
    """Build a UserResponse with `has_course_admin` and `has_run_teacher` populated.

    NOTE: The returned flags are UI hints for nav rendering only. Server-side
    authorization is ALWAYS re-evaluated via require_* helpers (helpers.py:81-128).
    Do NOT branch on these flags in any new endpoint.
    """
    has_admin = user.is_superuser or bool(db.scalar(
        select(exists().where(CourseAdmin.user_id == user.id))
    ))
    has_teacher = bool(db.scalar(
        select(exists().where(RunTeacher.user_id == user.id))
    ))
    return UserResponse.model_validate(user).model_copy(
        update={"has_course_admin": has_admin, "has_run_teacher": has_teacher}
    )
```

The `model_validate(...).model_copy(update={...})` pattern is already used in this codebase at `backend/mathion/api/courses.py:47,67` for `CourseResponse.is_admin`. `model_config` is preserved through `model_copy`. The superuser short-circuit (`user.is_superuser or bool(...)`) skips the EXISTS query for superusers and pins `has_course_admin: True` for them per §5.6.

**Two wiring points:**

1. `get_profile` (currently `def get_profile(user: User = Depends(get_current_user))` at `auth.py:50-51`) must be widened to take `db: Session = Depends(get_db)` and return `_user_response_with_flags(db, user)`.

2. `api_verify_pin` (the route handler in `api/auth.py:29` — distinct from the service-level `verify_pin` in `mathion/auth.py`) already takes `db: Session = Depends(get_db)`. The current return shape is `{"user": UserResponse.model_validate(user)}` and the frontend destructures `const { user } = await api.post<{user: User}>(...)` at `frontend/src/lib/auth.svelte.ts:35`. Slice A preserves the `{"user": ...}` wrap exactly — only the inner UserResponse is built via `_user_response_with_flags(db, user)`.

**Flags are UI-only.** The backend continues to evaluate every authorization decision via `require_*` helpers that re-query `CourseAdmin` / `RunTeacher` on each request. Stale flags cannot grant access — every write attempt re-checks roles server-side. The flags exist only to render the right nav links.

**Refresh cadence.** Flags are recomputed on every `/me` response. `/me` is invoked exactly twice in the user lifecycle: (a) on PIN verify, (b) on app boot (cookie-restored session). No other refresh trigger. Mid-session role changes by an admin are NOT pushed live — see §5.1.

#### 3.1.5 New `GET /api/teaching/runs`

New router file `backend/mathion/api/teaching.py`:

```python
@router.get("/api/teaching/runs", response_model=list[TeachingRunRow])
def list_teaching_runs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeachingRunRow]: ...
```

`TeachingRunRow` is built by hand in the handler — its fields cross multiple tables, so `from_attributes` would not hydrate it from a single ORM row. Drop `model_config` to avoid implying otherwise:

```python
class TeachingRunRow(BaseModel):
    run: RunResponse
    course_id: int
    course_name: str
    course_slug: str
    student_count: int
```

**No server-side status derivation, no group-sort.** Backend returns rows ordered by `Run.id ASC` (deterministic for test assertions). The frontend derives status via the existing `frontend/src/lib/runStatus.ts` (which uses local-midnight boundaries and returns the lowercase string `'draft' | 'upcoming' | 'active' | 'ended'`) and performs grouping + within-group sort client-side. This eliminates the timezone divergence risk between server `date.today()` and client local time, and makes the existing `runStatus.ts` the single source of truth for status display.

**Authorization.** Endpoint requires only `get_current_user`. There is NO superuser bypass — superusers see only runs where they hold a `RunTeacher` row, not every run system-wide. A user with no `RunTeacher` rows receives `[]`.

**N+1-safe SQL — single grouped query**:

```python
rows = db.execute(
    select(
        Run,
        Course.id.label("course_id"),
        Course.name.label("course_name"),
        Course.slug.label("course_slug"),
        func.count(RunStudent.id).label("student_count"),
    )
    .select_from(RunTeacher)
    .join(Run, Run.id == RunTeacher.run_id)
    .join(CourseVersion, CourseVersion.id == Run.version_id)
    .join(Course, Course.id == CourseVersion.course_id)
    .outerjoin(RunStudent, RunStudent.run_id == Run.id)
    .where(RunTeacher.user_id == user.id)
    .group_by(Run.id, Course.id)
    .order_by(Run.id.asc())
).all()
return [
    TeachingRunRow(
        run=RunResponse.model_validate(row.Run),
        course_id=row.course_id,
        course_name=row.course_name,
        course_slug=row.course_slug,
        student_count=row.student_count,
    )
    for row in rows
]
```

Notes:
- `func.count(RunStudent.id)` on an outer-joined empty side returns `0` (not NULL) on both SQLite and PostgreSQL — no coercion needed.
- `group_by(Run.id, Course.id)` relies on functional-dependency rules in PostgreSQL (PK → all columns) and SQLite's lenient grouping. If MySQL ever becomes a deployment target with `ONLY_FULL_GROUP_BY`, add `Course.name, Course.slug` to the GROUP BY.
- Backend `Run.id ASC` order is for test determinism only — the frontend re-groups and re-sorts client-side.

**No pagination.** Teachers typically have <50 runs total. A future slice can add it if a deployment ever needs it.

**Router registration.** `app.include_router(teaching_router)` must be invoked BEFORE the SPA `/api/{rest:path}` 404 catch-all at `backend/mathion/main.py:66-71`. Easiest insertion point: between `dashboard_router` (`main.py:50`) and the `@app.get("/health")` block at `main.py:53`.

#### 3.1.6 No changes to other run-scoped endpoints — and confirmed-teacher-allowed write

Assets, mini-projects (CRUD/list/get/render), roster (read/write), groups, evaluations, and run GET/PATCH all use `require_run_admin_or_teacher` already. No change.

**`PATCH /api/runs/{rid}` is teacher-allowed.** Verified at `backend/mathion/api/runs.py:78-81` (`require_run_admin_or_teacher`). Teachers CAN PATCH title / dates / metadata. §3.2.4 commits accordingly — title / end-date / metadata controls stay visible to teachers in `RunOverviewTab`.

Run lifecycle (POST publish, POST unpublish, DELETE run, POST new run) and mini-project publish/unpublish stay `require_course_admin` / `require_course_admin_for_run`. Teachers calling these continue to receive 403; the frontend just won't show the buttons.

### 3.2 Frontend changes

#### 3.2.1 New `components/chrome/AppHeader.svelte`

Thin top bar, rendered by `App.svelte` for every authenticated route (hidden on `/login`, hidden during `session.loading`).

Layout:

```
[Mathion]          [Authoring]  [Teaching]                Sergey Kucheryavski  [Logout]
```

- **Brand** — `<a>` element with text "Mathion". `href` is a `$derived` runes expression: `const brandHref = $derived(defaultLandingPath(session.user))`. So the link target updates reactively when `session.user` changes (e.g., after `/me`).
- **Center nav links** — each link renders only when its corresponding role flag is true. `aria-current="page"` when the link's path matches the current route prefix (`/courses*` for Authoring, `/teaching*` for Teaching) so deep routes like `/courses/foo/runs/bar` still mark Authoring active. Active link gets a distinct visual treatment (underline + bold); the test for `aria-current` does NOT mandate a specific visual style.
- **Right side** — user's `full_name` rendered as plain text. Falls back to `email` only when `full_name === null`. Immediately to the right of the name: a `<button>` labeled "Logout". No dropdown. The handler is:
  ```ts
  import { logout } from '../../lib/auth.svelte';
  import { navigate } from '../../lib/router.svelte';
  async function onLogout() {
    await logout();        // clears session.user + course store + toasts; does NOT navigate
    navigate('/login');
  }
  ```
  `logout()` (at `frontend/src/lib/auth.svelte.ts:44-52`) returns `Promise<void>`, swallows API errors in a `try/finally`, and does NOT call `navigate`. The AppHeader handler is responsible for the navigation.
- **Reactivity** — AppHeader reads `session.user?.has_course_admin` / `has_run_teacher` directly via runes. `session.user` is `$state`-tracked in `frontend/src/stores/session.svelte.ts:3`, so the next `/me` response updates the nav reactively without remounting.
- No new CSS dependencies; uses existing color tokens.

#### 3.2.2 New `pages/teaching/TeacherRunListPage.svelte`

Route: `/teaching` (added to `routes.ts`, `auth: true`). Directory `pages/teaching/` matches the `pages/runs/` and `pages/editor/` precedent for feature-scoped subdirectories.

Lifecycle states:

| State | Render |
|---|---|
| Loading | `<LoadingPlaceholder label="Loading runs…" />` — same component used by `pages/runs/RunListPage.svelte`. |
| Error (`/api/teaching/runs` fails) | Styled error banner with the error message and a `Try again` button that re-invokes `listTeachingRuns()`. (Chosen over a "Back to courses" link, because pure teachers land on an empty `/courses` — a re-fetch is more useful.) |
| Empty response (`[]`) | Page-level empty state: no pills, no table; copy: `"You're not assigned to any runs yet. When a course admin adds you as a teacher, the run will appear here."` |
| Non-empty response, selected pill matches 0 rows | Inline empty-filter message: e.g. `"No active runs. You have N upcoming and M ended."` (numbers derived from the full response). |
| Non-empty response, selected pill has rows | Pills + table (below). |

Successful render layout:

```
[Active (3)]  [Upcoming (1)]  [Ended (5)]  [Draft (0)]  [All (9)]
─────────────────────────────────────────────────────────────────

| Course    | Run title  | Status   | Start–End                | Students |
| --------- | ---------- | -------- | ------------------------ | -------- |
| Calc 101  | Spring '26 | Active   | 2026-02-01 → 2026-05-30  | 24       |
| Stats 200 | Spring '26 | Active   | 2026-02-15 → 2026-06-15  | 18       |
```

**Status derivation, grouping, and within-group sort happen client-side.** `runStatus(run)` from `frontend/src/lib/runStatus.ts` returns the lowercase strings `'draft' | 'upcoming' | 'active' | 'ended'`. Pseudocode (the comparator helpers `byEndDateAscThenId` etc. are defined inline in the component, ~5 lines each):

```ts
type Status = 'active' | 'upcoming' | 'ended' | 'draft';
const all = await listTeachingRuns();          // server-ordered by run.id ASC
const withStatus = all.map(r => ({ row: r, status: runStatus(r.run) }));
const byStatus: Record<Status, typeof withStatus> = {
  active: [], upcoming: [], ended: [], draft: [],
};
for (const x of withStatus) byStatus[x.status].push(x);

function byEndDateAscThenId(a, b)   { return cmp(a.row.run.end_date, b.row.run.end_date)   || a.row.run.id - b.row.run.id; }
function byStartDateAscThenId(a, b) { return cmp(a.row.run.start_date, b.row.run.start_date) || a.row.run.id - b.row.run.id; }
function byEndDateDescThenId(a, b)  { return cmp(b.row.run.end_date, a.row.run.end_date)   || a.row.run.id - b.row.run.id; }
function byCreatedAtDescThenId(a,b) { return cmp(b.row.run.created_at, a.row.run.created_at) || a.row.run.id - b.row.run.id; }

const ordered = [
  ...byStatus.active.sort(byEndDateAscThenId),
  ...byStatus.upcoming.sort(byStartDateAscThenId),
  ...byStatus.ended.sort(byEndDateDescThenId),
  ...byStatus.draft.sort(byCreatedAtDescThenId),
];
```

Sort keys:
- **active**: `end_date ASC, id ASC` — "wrapping up soonest first".
- **upcoming**: `start_date ASC, id ASC` — "starting soonest first".
- **ended**: `end_date DESC, id ASC` — "most recently ended first".
- **draft**: `created_at DESC, id ASC` — `RunResponse.created_at` IS exposed (`frontend/src/lib/types.ts:266-275`); `updated_at` is NOT (it exists only on `MiniProjectResponse`). Use `created_at` for Draft order.

Display labels: a `displayLabel(status)` helper title-cases the lowercase status string for pill labels and the Status column (e.g., `'active' → 'Active'`). One-liner: `s[0].toUpperCase() + s.slice(1)`.

Pills:
- **All 5 filter pills always visible** (even when count is 0), matching the `RunAssetsTab` pattern.
- **Default selection: `'active'`** (lowercase key). Rationale: matches user story 1 ("find my active terms quickly"); mid-semester is the dominant teaching state. When `active` count is 0 (e.g. between terms), the page stays on the Active pill and shows the empty-filter message — explicitly chosen over auto-switching so the teacher sees the "no active runs right now" cue rather than landing silently on a different pill. Pill counts make the alternative options self-evident; no cross-link is added.
- Pill counts are derived from the FULL response (not affected by the selected filter).
- Selected pill is a `<button aria-pressed="true">` with a distinct visual style (background + border-color); the test asserts `aria-pressed` only.

Table:
- **Single `<table>`** rendered below the pills, filtered client-side by the selected pill.
- **Row navigation** uses cell-level anchor elements following the pattern at `frontend/src/pages/runs/RunListPage.svelte:116`: each cell wraps its content in `<a href={runUrl} onclick={(e) => { e.preventDefault(); navigate(runUrl); }}>`. NO `<tr onclick>` — keyboard and screen-reader navigation must work on real anchors.
- **Status column** is kept so the "All" view stays meaningful when statuses mix; renders `displayLabel(status)`.
- **Course column** renders `row.course_name` (not `course_slug`).

**Styles.** `RunListPage.svelte` has NO per-component `<style>` block — it uses ambient global classes/utility patterns. TeacherRunListPage uses the same global patterns; no per-component styles are required. If a layout tweak is unavoidable at implementation time, add a small scoped `<style>` block then. The rev-2 instruction "duplicate the table styles" was incorrect — there is no source `<style>` block to copy.

#### 3.2.3 New `lib/teaching.ts`

```ts
import { api } from './api';
import type { RunResponse } from './types';

export interface TeachingRunRow {
  run: RunResponse;
  course_id: number;
  course_name: string;
  course_slug: string;
  student_count: number;
}

export function listTeachingRuns(): Promise<TeachingRunRow[]> {
  return api.get('/api/teaching/runs');
}
```

Mirrors `lib/runs.ts` conventions. `api.get` at `frontend/src/lib/api.ts:48` returns `res.json()` directly — no envelope. Frontend code uses `row.run.title` etc. via the nested shape — every column accessor in the table accounts for the nesting.

#### 3.2.4 `pages/runs/RunDetailPage.svelte` — thread `course` prop + conditional hiding

**Current state:** `RunDetailPage.svelte` passes `course` to `<RunAssetsTab>` (line 418, `course={course!}`). The other three tabs (`<RunOverviewTab>`, `<RunMiniProjectsTab>`, `<RunTeachersTab>`) currently receive NO `course` prop. Slice A threads `course` into all three to match the existing `RunAssetsTab` precedent — same prop shape across all four tabs.

**Prop shape — `course: Course` (required), matching `RunAssetsTab.svelte:23,33`.** Each tab destructures `let { course, /* ...existing props */ } = $props<{ course: Course; /* ... */ }>()` and reads `course.is_admin` directly. Required (not optional) — RunDetailPage always loads `course` before mounting the tab; existing tests of each tab will be updated to supply a stub `course: { is_admin: true }` (preserving today's "controls visible" behavior). Tests that want to assert the teacher view supply `course: { is_admin: false }`.

**Conditional hides inside each tab:**

- **`RunOverviewTab`** — hide `Publish`, `Unpublish`, and `Delete run` buttons inside `{#if course.is_admin}`. PATCH-title / PATCH-end-date / metadata edits stay visible (PATCH on the run is `require_run_admin_or_teacher` per §3.1.6 verification).
- **`RunMiniProjectsTab`** — hide the per-row MP `Publish` / `Unpublish` toggle inside `{#if course.is_admin}`. Other MP controls (Edit, Delete with force-confirm) stay visible — backend already permits teachers via `require_run_admin_or_teacher`.
- **`RunTeachersTab`** — hide the "Add teacher" form and per-row "Remove" buttons inside `{#if course.is_admin}`. Run-teachers add/remove endpoints are `require_course_admin_for_run` server-side; this removes dead controls from the teacher view.

No new components. The hides are `{#if course.is_admin}` blocks; the prop wiring is the meaningful work.

#### 3.2.5 `App.svelte` — routing + AppHeader integration

**AppHeader placement.** Render conditionally above the existing route-rendering structure:

```svelte
{#if !session.loading && session.user && currentRoute.path !== '/login'}
  <AppHeader />
{/if}

<!-- Existing route-rendering structure preserved verbatim; do NOT edit the
     loading-guard / matched / NotFound branches as part of this change. -->
```

(The existing route-rendering pattern in `App.svelte:46-53` is preserved as-is; AppHeader is a sibling above it. AppHeader is hidden on `/login`, hidden during initial session load, and visible on every authenticated route — including `NotFound`, where it's correct to keep the chrome visible.)

`currentRoute` is imported from `./lib/router.svelte` (already imported in `App.svelte:3`).

**Default-route effect — merged form preserving the auth guard.** The current `$effect` at `App.svelte:34-43` handles BOTH the `/` redirect AND an auth-guard for protected routes. Use the existing local variable names (per `App.svelte:34-43`: `matched` is the route-match object; the auth guard reads `matched.route.auth`):

```svelte
$effect(() => {
  if (session.loading) return;

  // 1. Default route: '/' redirects based on session role flags.
  if (currentRoute.path === '/') {
    navigate(defaultLandingPath(session.user), { replace: true });
    return;
  }

  // 2. Auth guard for protected routes (preserved verbatim from existing code).
  if (matched?.route.auth && !session.user) {
    navigate('/login', { replace: true });
    return;
  }
});
```

The plan task that touches `App.svelte` must keep the auth-guard branch intact; this snippet is illustrative — diff against the existing file before editing.

**Extract `defaultLandingPath(user)` helper.** To make the routing decision unit-testable without driving jsdom navigation, extract the inner ternary into a pure function in `frontend/src/lib/router.svelte.ts`:

```ts
import type { User } from './types';

export function defaultLandingPath(user: User | null): string {
  if (user?.has_course_admin) return '/courses';
  if (user?.has_run_teacher)  return '/teaching';
  return '/courses';                                    // student/empty fallback
}
```

Unit-tested in `frontend/src/tests/router.test.ts` (existing file). The `App.svelte` `$effect` and the AppHeader's brand href both call it; smoke covers the end-to-end navigation.

**New route entry in `routes.ts`:** `{ path: '/teaching', component: 'TeacherRunListPage', auth: true }`. Add `TeacherRunListPage` import + entry to `componentMap`.

#### 3.2.6 Session store

`frontend/src/stores/session.svelte.ts:3` stores `user: User | null` as `$state(...)`. The new `has_course_admin` / `has_run_teacher` fields flow through transparently once the `User` type in `frontend/src/lib/types.ts:5-12` is extended. No store-shape change. `logout` is imported from `frontend/src/lib/auth.svelte.ts:44` (NOT from the session store).

### 3.3 No mobile / responsive changes

Slice A assumes the desktop layout used elsewhere in the app. Mobile is a project-wide concern, not scoped here.

## 4. Data flow

### 4.1 Login → landing

```
POST /api/auth/verify-pin
        ↓
api_verify_pin handler builds {"user": _user_response_with_flags(db, user)}
        ↓
session.user populated immediately with flags (no second /me call required)
        ↓
App.svelte $effect on '/' :
  navigate(defaultLandingPath(session.user), { replace: true })
    has_course_admin       → '/courses'
    else has_run_teacher   → '/teaching'
    else                   → '/courses'   (student/empty fallback)
```

On a fresh tab with a valid cookie, the same flow runs via `GET /me` (which now goes through `_user_response_with_flags`) instead of `verify-pin`. AppHeader renders link visibility from the same flags.

### 4.2 Teacher opens a run

```
/teaching → click row cell-anchor → /courses/{slug}/runs/{rid}
        ↓
RunDetailPage.loadAll(slug, rid):
  GET /api/courses/by-slug/{slug}    → 200, course.is_admin = false   (opened by §3.1.1)
  Promise.all([
    GET /api/runs/{rid}                → 200   (existing teacher allowance)
    GET /api/courses/{cid}/versions    → 200, filtered to versions pinned by teacher's runs (§3.1.2)
    GET /api/runs/{rid}/teachers       → 200
    GET /api/runs/{rid}/groups         → 200
    GET /api/runs/{rid}/students       → 200
    GET /api/runs/{rid}/assets         → 200
  ])
  if pinnedVersion:
    Promise.all([
      GET /api/versions/{vid}/blocks       → 200   (opened by §3.1.3; reads on the pinned version regardless of state/disabled)
      GET /api/runs/{rid}/mini-projects    → 200
    ])
```

After the load, `course.is_admin = false` propagates to the four affected tabs and hides admin-only controls.

### 4.3 Direct URL navigation

- `/teaching` without `has_run_teacher` — page mounts, fetches `/api/teaching/runs`, gets `[]`, shows the page-level empty state. No guard.
- `/courses/:slug/runs/:rid` for a course the user has no role on — `by-slug` returns 403; existing error display shows "Access denied".

### 4.4 Logout

`AppHeader` Logout button → `await logout()` (clears session.user, course store, toasts) → `navigate('/login')`. On re-login, `/me` (or PIN-verify) re-fetches the user with fresh flags.

## 5. Edge cases and accepted gaps

### 5.1 Role flag staleness — Accepted gap (with explicit safety claim)

`has_course_admin` / `has_run_teacher` are refreshed only on `/me` and PIN-verify (app boot, login). Mid-session role changes are not pushed live.

**Safety claim:** Flags are UI-only. The server re-evaluates every authorization decision via `require_*` helpers on every request. Stale `has_course_admin: true` cannot grant access — write attempts 403. The only consequence is visible nav links being slightly wrong until the next page reload.

| Scenario | What happens |
|---|---|
| Admin promotes user X to `RunTeacher` mid-session | X's "Teaching" link doesn't appear until reload. Deep link `/teaching` still works — page fetches `/api/teaching/runs` fresh. |
| Admin removes user X's `RunTeacher` row mid-session | X's "Teaching" link still shows until reload. Clicking it loads `/api/teaching/runs`, returns `[]` now; X sees empty state. No crash. |
| Admin removes user X's `CourseAdmin` row mid-session | X's "Authoring" link still shows until reload. `/courses` returns the filtered list (possibly empty); link visibility is wrong but not load-bearing — server still enforces. |
| Admin promotes user X to `CourseAdmin` mid-session | "Authoring" link missing until reload. |

A future slice may add a `/me` re-fetch hook on key navigation events; deferred.

### 5.2 (Invited) teacher logging in

When an admin invites a teacher via `RunTeachersTab`, the system creates a `User` row with `full_name = null`. PIN login works for these users.

- AppHeader's name field falls back to `email` when `full_name === null`. No extra state needed.
- All other behavior is identical.

### 5.3 Concurrent role removal mid-action

If an admin removes a teacher's `RunTeacher` row while the teacher has the run-detail page open AND the teacher then triggers a write (e.g., evaluating a submission), the backend returns 403. The existing `ApiError` flow surfaces an error banner. No new code.

### 5.4 Course pinned version disabled

Existing `versionIsDisabled` UX (banner above tab content + tooltips on action buttons) already works for both roles — the `pinnedVersion.is_disabled` field flows through the same loadAll path. The §3.1.3 teacher branch explicitly allows reads on `is_disabled` versions to preserve this. Manual smoke step 6b confirms.

### 5.5 Deep-link from email

When a course admin invites a teacher via email, the email may contain a deep link to `/courses/:slug/runs/:rid`. After login, the user lands on the deep link route, `by-slug` succeeds, run loads. Identical to the admin path.

### 5.6 Superuser

Users with `is_superuser: true` get `has_course_admin: True` regardless of `CourseAdmin` rows (§3.1.4 short-circuits the EXISTS query). They land on `/courses` by default. `has_run_teacher` reflects ONLY their actual `RunTeacher` rows; the Teaching link appears only when they hold at least one. `/api/teaching/runs` does NOT bypass for superusers — they see only their own teaching runs (§3.1.5). Test coverage in §6.1.

### 5.7 User with only enrollment, no admin / no teacher

Student-only users get `has_course_admin: false` and `has_run_teacher: false`. They land on `/courses` (existing fallback). AppHeader shows neither nav link — just brand + name + logout.

### 5.8 Role-removed-but-cookie-still-valid, and disabled-user handling

If an admin removes ALL of user X's `RunTeacher` rows AND X has no `CourseAdmin` rows AND X has no enrollment, X's cookie still authenticates `/me`. They see the header with no nav links and an empty `/courses`. Degenerate state; tightening it is out of scope.

`is_disabled` users are handled at the auth layer — `validate_session` (`backend/mathion/auth.py:142-146`) destroys the session and returns `None` when `user.is_disabled`. A disabled teacher cannot reach any of the new endpoints. Flipping `is_disabled` mid-session invalidates the very next request (not the current page state) — the user's next API call returns 401 and the frontend's ApiError flow takes over. No extra guard needed.

If an admin deletes the user row outright, `validate_session`'s `db.get(User, session.user_id)` returns `None` and `get_current_user` (`dependencies.py:22-23`) cleanly 401s the next request — no 500 risk.

### 5.9 Teacher who is also enrolled as a student on the same course

Possible if an admin both enrolls and teaches a user. `by-slug` returns `is_admin: false`; run-detail page mounts as teacher with teacher controls. The user can also see the course in their student view via existing `MyCourseResponse` flow. Consistent behavior; one regression test in §6.1.

### 5.10 Course slug rename (out of scope, noted)

`Course.slug` is mutable via admin PATCH. A teacher's bookmarked `/courses/{old-slug}/runs/{rid}` will 404 after rename. Out of scope for Slice A; a future slug-redirect layer may handle it.

### 5.11 Teacher viewing a run whose pinned version was later disabled

Per §3.1.3, teacher branch allows reads on disabled versions (and §5.4 confirms the existing UX renders). A test in §6.1 (`test_blocks_disabled_version_readable_by_teacher`) locks this in.

### 5.12 Session race during cookie restore

If `session.user` is null when `/teaching` mounts (cookie restore not yet completed), the existing `App.svelte` auth-guard `$effect` redirects to `/login`. No additional guard is required on the page itself.

## 6. Testing

### 6.1 Backend (pytest, `backend/.venv`)

New test file `tests/test_teaching.py`. The `teacher_client` fixture already exists in `backend/tests/conftest.py:124-143` — leverage it.

**Helper unit tests** (`has_run_teacher_on_course`):
- `test_has_teacher_on_course_hits_when_teacher_row_on_pinned_version`
- `test_has_teacher_on_course_hits_when_teacher_row_on_different_version_of_same_course`
- `test_has_teacher_on_course_hits_when_teacher_row_on_draft_state_version`
- `test_has_teacher_on_course_hits_when_multiple_teacher_rows_on_same_course`
- `test_has_teacher_on_course_misses_when_no_teacher_row`
- `test_has_teacher_on_course_misses_when_teacher_row_on_different_course`

**Helper unit tests** (`has_run_pinned_to_version`):
- `test_has_pinned_hits_when_teacher_row_on_run_with_this_version_id`
- `test_has_pinned_misses_when_teacher_row_on_run_with_different_version_id`
- `test_has_pinned_misses_when_no_teacher_row`
- `test_has_pinned_hits_regardless_of_version_state_or_is_disabled`

**Opened endpoints — gate behavior**:
- `test_by_slug_allows_run_teacher_returns_is_admin_false`
- `test_by_slug_admin_who_is_also_teacher_returns_is_admin_true` (admin precedence)
- `test_by_slug_superuser_returns_is_admin_true`
- `test_by_slug_still_rejects_non_member`
- `test_versions_list_returns_only_pinned_versions_for_teacher` (asserts other versions on course excluded)
- `test_versions_list_includes_pinned_draft_state_version_for_teacher` (locks loader-mount safety)
- `test_versions_list_includes_pinned_disabled_version_for_teacher` (locks §5.4/§5.11)
- `test_versions_list_admin_still_sees_all_versions` (regression for admin path)
- `test_versions_list_still_rejects_non_member`
- `test_blocks_list_allows_teacher_on_pinned_version`
- `test_blocks_list_allows_teacher_on_pinned_disabled_version` (§5.4/§5.11)
- `test_blocks_list_allows_teacher_on_pinned_draft_state_version` (locks Critical loader-mount fix)
- `test_blocks_list_rejects_teacher_on_unpinned_published_version` (cross-version leak guard)
- `test_blocks_list_still_rejects_non_member`

**Cascade guard** (lock in that opening `/blocks` does NOT cascade to authoring leaves — including the `list_sequences` endpoint at `blocks.py:272-280`):
- `test_sequences_list_still_admin_only_for_teacher`
- `test_sequences_write_still_admin_only_for_teacher` (one POST + one DELETE if both exist)
- `test_items_list_still_admin_only_for_teacher`
- `test_questions_list_still_admin_only_for_teacher`
- `test_answer_options_list_still_admin_only_for_teacher`

**Write-still-admin regression**:
- `test_versions_write_still_admin_only` (one representative POST)
- `test_blocks_write_still_admin_only` (one representative POST)
- `test_run_publish_still_admin_only_for_teacher`
- `test_run_unpublish_still_admin_only_for_teacher`
- `test_run_delete_still_admin_only_for_teacher`
- `test_mini_project_publish_still_admin_only_for_teacher`

**`/me` flag tests**:
- `test_me_role_flags` (parameterized: admin / teacher-only / both / neither / superuser — the superuser case specifically exercises the `user.is_superuser or ...` short-circuit; not redundant)
- `test_me_response_shape_includes_existing_fields` (regression — ensures `id`, `email`, `full_name`, `is_superuser`, `is_disabled`, `photo_url` all still present alongside the new flags)

**`api_verify_pin` flag test — concrete body**:
```python
def test_verify_pin_response_includes_role_flags(client, teacher_user, db_session):
    # 1. Request PIN
    r = client.post("/api/auth/request-pin", json={"email": teacher_user.email})
    assert r.status_code == 200
    # 2. Read the PIN (use whatever helper the existing conftest exposes — pattern from
    #    backend/tests/conftest.py request_pin/verify_pin fixtures; if no helper exists
    #    yet, add one that returns the PIN from the auth.pins table or notification log)
    pin = read_latest_pin_for(db_session, teacher_user.email)
    # 3. Verify
    r = client.post("/api/auth/verify-pin", json={"email": teacher_user.email, "pin": pin})
    assert r.status_code == 200
    body = r.json()
    # 4. Assert wrap preserved AND new flags present
    assert "user" in body
    assert body["user"]["has_run_teacher"] is True
    assert body["user"]["has_course_admin"] is False
    # 5. Assert pre-existing fields still present (regression for schema-change risk)
    for key in ("id", "email", "full_name", "is_superuser", "is_disabled", "photo_url"):
        assert key in body["user"]
```

**`/api/teaching/runs` tests**:
- `test_teaching_runs_returns_only_my_runs`
- `test_teaching_runs_excludes_runs_without_teacher_row`
- `test_teaching_runs_excludes_runs_on_other_courses` (teacher of course A doesn't see course B)
- `test_teaching_runs_excludes_runs_where_user_is_course_admin_but_not_teacher` (course-admin-only runs NOT returned)
- `test_teaching_runs_empty`
- `test_teaching_runs_student_count_zero` (run with no students returns 0, not null)
- `test_teaching_runs_student_count_multiple` (run with N>1 students returns COUNT)
- `test_teaching_runs_superuser_sees_only_own_teacher_rows` (locks §3.1.5 no-bypass)
- `test_teaching_runs_orders_by_id_asc` (with 2+ runs in fixture, assert backend stable order — frontend re-sorts but tests need a known baseline)
- `test_teaching_runs_response_key_set` (assert top-level row keys exactly: `{run, course_id, course_name, course_slug, student_count}`. Paired with frontend mock-shape assertion.)
- `test_teaching_runs_course_slug_populated` (frontend builds the URL from this — assert non-null/non-empty)

(The earlier `test_teaching_runs_no_n_plus_one` is DROPPED for slice A — no `capture_queries` helper exists in `backend/tests/conftest.py`. Adding one is its own work item; the SQL is reviewed visibly in §3.1.5.)

### 6.2 Frontend (vitest)

New `src/tests/AppHeader.svelte.test.ts`:
- Renders both nav links when both flags true.
- Renders only one link when only one flag true.
- Renders no nav links (just brand + name + logout) when both flags false.
- Active link gets `aria-current="page"` when the route matches the prefix — including deep routes like `/courses/foo/runs/bar` (Authoring should still be marked).
- `aria-current` updates reactively when `currentRoute.path` changes (not just on initial render).
- Logout button click awaits `logout()` (mocked from `lib/auth.svelte.ts`) THEN navigates to `/login`.
- Shows `full_name` when present.
- Falls back to `email` when `full_name === null`.
- Hidden on `/login` route (set `currentRoute.path = '/login'` via the existing test pattern — `__resetGuardsForTests` in `router.test.ts:5-9`).
- Hidden during `session.loading === true`.
- Brand href resolves to `/courses` for admin, `/teaching` for teacher-only, `/courses` for student/empty.

New `src/tests/TeacherRunListPage.svelte.test.ts`:
- Loading state renders `<LoadingPlaceholder>`.
- Error state renders error banner with `Try again` button; clicking the button re-invokes `listTeachingRuns()`.
- Renders all 5 pills with counts derived from the FULL response (don't change when filtering).
- Default selected pill is `active`; `aria-pressed=true`.
- When the response has 0 active runs (but other groups non-empty), default pill stays on Active and the empty-filter message renders with cross-counts.
- Switching pills filters table rows correctly; status-filter regression (no row from another status leaks into the filtered view).
- Within-group sort: active by `end_date ASC`; upcoming by `start_date ASC`; ended by `end_date DESC`; draft by `created_at DESC`. Assert via hand-built fixtures.
- Status derived client-side via `runStatus()` (assert that a fixture with `is_published=true, start_date=yesterday, end_date=tomorrow` lands in `active`).
- Display labels are title-cased ("Active", "Upcoming", ...) — assert one pill label and one Status-column cell.
- Empty response → page-level empty state copy, no pills/table.
- Non-empty response with 0 matching rows for a NON-default pill (e.g. user switches to Draft, has none) → inline empty-filter state with correct cross-counts.
- Course column renders `course_name` (not `course_slug`) — column-mapping regression.
- Cell-anchor `href` is set correctly (for keyboard/middle-click).
- Row click via cell-anchor navigates to `/courses/:slug/runs/:rid`.
- Mocked-fetch response includes exact key set `{run, course_id, course_name, course_slug, student_count}` (contract test — paired with backend `test_teaching_runs_response_key_set`).

New `src/tests/teaching.test.ts`:
- `listTeachingRuns()` calls `GET /api/teaching/runs` (use the same `vi.stubGlobal('fetch', mockFetch(200, [...]))` pattern as `frontend/src/tests/runs.test.ts:16-30`).
- Returns the parsed array directly (no envelope).

Extend `src/tests/router.test.ts`:
- `defaultLandingPath({ has_course_admin: true, has_run_teacher: false, ... })` → `/courses`.
- `defaultLandingPath({ has_course_admin: false, has_run_teacher: true, ... })` → `/teaching`.
- `defaultLandingPath({ has_course_admin: false, has_run_teacher: false, ... })` → `/courses`.
- `defaultLandingPath({ is_superuser: true, has_course_admin: true, has_run_teacher: true })` → `/courses` (locks admin-precedence contract; the helper just reads the flag, but explicit case documents that superusers go to Authoring).
- `defaultLandingPath(null)` → `/courses`.

Extend `src/tests/RunOverviewTab.svelte.test.ts`:
- Existing tests are updated to pass `course={ ...stub, is_admin: true }` (preserves today's "controls visible" behavior).
- When `course.is_admin === false`, publish/unpublish/delete-run buttons are NOT in the DOM (assert via `queryByText`/`queryByRole` returning null).
- When `course.is_admin === true`, all three controls ARE in the DOM (regression guard).
- PATCH-title and PATCH-end-date controls ARE in the DOM regardless of `course.is_admin` (locks the teacher-allowed PATCH semantics — see §3.1.6).

Extend `src/tests/RunMiniProjectsTab.svelte.test.ts`:
- Existing tests pass `course={ ..., is_admin: true }`.
- When `course.is_admin === false`, the MP publish/unpublish toggle is NOT in the DOM.
- When `course.is_admin === true`, the toggle IS in the DOM (regression guard).

Extend `src/tests/RunTeachersTab.svelte.test.ts`:
- Existing tests pass `course={ ..., is_admin: true }`.
- When `course.is_admin === false`, the Add-teacher form and per-row Remove buttons are NOT in the DOM.
- When `course.is_admin === true`, both ARE in the DOM (regression guard).

**No `App.svelte.test.ts` integration test.** No existing precedent for integration-testing `App.svelte` routing in jsdom. The `defaultLandingPath` helper unit tests cover the routing logic; AppHeader visibility on `/login` is covered by the AppHeader test file directly; manual smoke (§6.3 steps 0, 1, 7) confirms end-to-end.

### 6.3 Manual smoke walkthrough (the plan's final task)

0. Visit `/login` without auth → AppHeader is NOT visible.
1. Login as a course-admin-only user → AppHeader shows Authoring (active), no Teaching link; lands on `/courses`; brand href is `/courses`.
2. As the course-admin of some course (the user from step 1, or a different course-admin if needed), navigate to a run's `RunTeachersTab` and add the target email via the existing UI. The frontend POSTs `/api/runs/{rid}/teachers`, creates/updates the user, and the new `RunTeacher` row is in place. (Course admins can manage teachers on their own courses — `require_course_admin_for_run` allows it. No superuser session required.)
3. Log out, then log in as the target teacher user. `/me` returns `has_run_teacher: true` (and `has_course_admin: false` unless they're also an admin elsewhere). AppHeader shows Teaching (active for teacher-only users); brand href is `/teaching`.
4. Click Teaching → land on `/teaching` with pills, default Active, table populated.
5. Switch through each pill and verify row counts match pill counts and rows within each group appear in the documented sort order (e.g. for Active, leftmost end-date first).
6. Click a row → run-detail page; verify Overview tab has NO publish/unpublish/delete; PATCH-title and PATCH-end-date ARE present (teachers can edit metadata); MP tab has NO publish toggle on rows; Teachers tab has NO add-form and NO Remove buttons; Assets, Groups, Evaluations tabs work normally.
6b. As the teacher, view a run whose pinned version is disabled (admin sets `is_disabled` via Authoring's version actions, OR if the admin UI doesn't expose disable, set `course_versions.is_disabled = true` directly in the dev DB): verify the version-disabled banner renders and tooltips on disabled actions still appear.
7. Log in as a teacher-only user (no `CourseAdmin` rows): AppHeader shows Teaching only; `/` redirects to `/teaching`; brand href is `/teaching`.
8. To exercise the empty-state path: as the admin from step 2, REMOVE the teacher's `RunTeacher` row via the same `RunTeachersTab`. Log out (admin), log in as the teacher again. The teacher's flags now: `has_run_teacher: false` (assuming no other rows). AppHeader shows no nav links; `/teaching` direct-load still fetches `/api/teaching/runs` and gets `[]`, rendering the page-level empty state ("You're not assigned to any runs yet…").
9. Direct URL `/courses/:slug/runs/:rid` as a teacher → loads correctly with hidden admin actions.
10. Direct URL `/courses/:slug/runs/:rid` as a non-member → 403 "Access denied" via existing error path.

## 7. Migration / data

No database schema change. No migrations needed.

## 8. Backward compatibility

- `UserResponse` gains two new boolean fields with `= False` defaults. PIN-verify and `/me` handlers overwrite them via `_user_response_with_flags`. The `{"user": ...}` wrap on PIN-verify is preserved exactly. Older frontend builds calling `/me` ignore the new fields (additive). Older frontend builds calling PIN-verify still receive a valid response shape.
- No breaking changes to existing endpoints. The opened `versions`/`blocks`/`by-slug` endpoints continue to return the same shape for admins; only the gate is widened (with a teacher-specific content filter on `versions`).

## 9. Performance

- `/me` and `api_verify_pin`: +2 small `EXISTS` reads per call. Both tables indexed on `user_id`. Negligible.
- `/api/teaching/runs`: typical teacher has <50 runs total. Single grouped query with `LEFT JOIN ... COUNT GROUP BY`; no N+1. Cheap.
- Opened read endpoints (`by-slug`, `versions`, `blocks`): the new helper `has_run_teacher_on_course` adds one indexed EXISTS read per gated call when the user is not a `CourseAdmin`. Course-admin path unchanged.
- Frontend sort/group: O(N) over typically <50 rows. Trivial.

## 10. Accessibility

- AppHeader uses semantic `<nav>` containing `<a>` elements. Brand is `<a>`. Active link marked with `aria-current="page"`. Logout button has visible text "Logout" (icon-only swap later will require an `aria-label`).
- TeacherRunListPage pills are `<button>` elements with `aria-pressed`; selection state communicated.
- Table uses semantic `<table>`/`<thead>`/`<tbody>` with column headers in `<th scope="col">`. Row navigation via cell-anchors so keyboard users can tab through rows.
- Tab order through the header: brand → Authoring → Teaching → Logout. AppHeader tests assert focusability via `tabindex` (absence of negative tabindex on anchor/button elements).

## 11. Open questions and explicit deferrals

- **Submissions review surface** — slice B. Spec'd later.
- **Evaluations writing surface** — slice C. Spec'd later.
- **Teacher dashboards consuming `/dashboard/progress` and `/dashboard/mini-projects`** — slice D. Spec'd later.
- **Notifications / pending-action signals** — slice E. The "K pending" badge per run row is intentionally not in slice A. The `Students` column in §3.2.2 is a count, not a pending-action signal.
- **Live role-flag refresh** — accepted gap §5.1. Future slice may add `/me` re-fetch on key navigation events.
- **AppHeader icon-only logout button** — visual polish, swappable when iconography lands.
- **Mobile / responsive layout** — project-wide concern, not scoped here.
- **Account dropdown (settings, profile, etc.)** — slice-A header is just name + logout. Profile/settings UI lands when those backends do.
- **Internationalization (i18n)** — strings are English-only. Slice-agnostic concern.
- **`<RunTable>` extraction for shared run-list rendering** — Slice A does not refactor `RunListPage`; both pages share global table classes only. A future slice may extract a shared component.
- **Slug-redirect on course rename** — §5.10. Out of scope.
- **A-prime (unblock-only without `/teaching` landing)** — considered and rejected. Teachers without a landing page have no entry point and cannot satisfy user story 1, so the unblock alone delivers no end-to-end value. AppHeader is also load-bearing for user story 3 (dual-role admin nav switcher), which is why it ships in A and not later.
- **N+1 query-counting test helper** — `test_teaching_runs_no_n_plus_one` deferred until a `capture_queries` fixture is added to `backend/tests/conftest.py`. Not blocking; the SQL is reviewed visibly in §3.1.5.

## 12. Files touched (summary, for plan-sizing)

**Backend:**
- `backend/mathion/api/helpers.py` — add `has_run_teacher_on_course` AND `has_run_pinned_to_version`.
- `backend/mathion/api/courses.py` — extend `get_course_by_slug` gate (4-tier order).
- `backend/mathion/api/versions.py` — extend `list_versions` gate + pinned-versions-only subquery filter on teacher branch.
- `backend/mathion/api/blocks.py` — extend `list_blocks` gate using `has_run_pinned_to_version`.
- `backend/mathion/api/auth.py` — add `_user_response_with_flags` private helper colocated with handlers; widen `get_profile` signature with `db: Session = Depends(get_db)`; wire helper into both `get_profile` and `api_verify_pin` (preserving the `{"user": ...}` wrap on `api_verify_pin`); add imports `from sqlalchemy import exists, select` and `from mathion.models import CourseAdmin, RunTeacher` if not already present.
- `backend/mathion/schemas.py` — extend `UserResponse` with two `bool = False` defaults; add `TeachingRunRow` (no `model_config`).
- `backend/mathion/api/teaching.py` — new router file.
- `backend/mathion/main.py` — register `teaching_router` between `dashboard_router` (line 50) and the `@app.get("/health")` block (line 53), BEFORE the SPA catch-all (`main.py:66-71`).
- `backend/tests/test_teaching.py` — new test file (helper + endpoint + cascade-guard tests).
- `backend/tests/test_auth.py` — extend with `/me` flag tests, `api_verify_pin` shape regression, and PIN-verify role-flag test.
- `backend/tests/conftest.py` — may need a small `read_latest_pin_for(db, email)` helper for the PIN-verify regression test (only if no equivalent exists yet — check at impl time).

**Frontend:**
- `frontend/src/components/chrome/AppHeader.svelte` — new.
- `frontend/src/pages/teaching/TeacherRunListPage.svelte` — new.
- `frontend/src/lib/teaching.ts` — new.
- `frontend/src/lib/types.ts` — extend `User` type with `has_course_admin: boolean` + `has_run_teacher: boolean`; add `TeachingRunRow` interface.
- `frontend/src/lib/router.svelte.ts` — add `defaultLandingPath(user)` helper.
- `frontend/src/App.svelte` — render `AppHeader`; update default-route `$effect` (keep auth-guard branch using existing local names `matched` / `matched.route.auth`); add `TeacherRunListPage` to component map.
- `frontend/src/routes.ts` — add `/teaching` route.
- `frontend/src/pages/runs/RunDetailPage.svelte` — thread `course` prop to three additional tabs (already passed to RunAssetsTab).
- `frontend/src/components/runs/RunOverviewTab.svelte` — accept required `course: Course` prop; `{#if course.is_admin}` around publish/unpublish/delete-run.
- `frontend/src/components/runs/RunMiniProjectsTab.svelte` — accept required `course: Course` prop; `{#if course.is_admin}` around per-row publish toggle.
- `frontend/src/components/runs/RunTeachersTab.svelte` — accept required `course: Course` prop; `{#if course.is_admin}` around add-teacher form and per-row Remove.
- `frontend/src/tests/AppHeader.svelte.test.ts` — new.
- `frontend/src/tests/TeacherRunListPage.svelte.test.ts` — new.
- `frontend/src/tests/teaching.test.ts` — new (wire-module).
- `frontend/src/tests/router.test.ts` — extend with `defaultLandingPath` unit tests.
- `frontend/src/tests/RunOverviewTab.svelte.test.ts` — extend (update existing tests to pass stub `course` prop; add `is_admin: false` case).
- `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` — extend (same pattern).
- `frontend/src/tests/RunTeachersTab.svelte.test.ts` — extend (same pattern).

(No `App.svelte.test.ts` extension — see §6.2 final paragraph.)

Plan-sized estimate: ~10-13 tasks with aggressive bundling, e.g.:
1. Backend: helper + 3 read-endpoint gate-opens + state filter + backend tests.
2. Backend: `_user_response_with_flags` + UserResponse extension + `get_profile` widening + `api_verify_pin` wiring + tests.
3. Backend: new `/api/teaching/runs` router + schema + tests + router registration.
4. Frontend: types extension + `lib/teaching.ts` + `defaultLandingPath` + their unit tests.
5. Frontend: AppHeader component + tests.
6. Frontend: TeacherRunListPage component + tests.
7. Frontend: App.svelte routing + routes.ts.
8. Frontend: RunDetailPage prop-threading + 3 tab prop updates + 3 hide blocks + 3 test extensions.
9. Manual smoke walkthrough.
10. Cleanup / merge.

(Plan may granularize further if individual sub-tasks balloon; the bundling above is illustrative.)
