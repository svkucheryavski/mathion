# Teacher Monitoring Surface — Slice A: unblock + landing

**Date:** 2026-05-29
**Status:** Design (post 5-reviewer pass — Critical & Important fixes applied)
**Slice:** A — minimum viable unblock + landing page
**Out of scope:** Submissions review surface (B), evaluations writing UI (C), teacher dashboards consuming `/dashboard/*` endpoints (D), notifications (E)

---

## 1. Problem

Mathion's frontend has an authoring surface for course admins (`/courses` → courses they own → versions/editor) and a deep run-management surface used by admins for live-run operations. Teachers — users with `RunTeacher` rows but no `CourseAdmin` — have no entry point. They can authenticate, but:

- After login they land on `/courses`, which returns only courses they admin or are enrolled in. Teachers see an empty list and a dead-end "Courses" header.
- Even if they navigate directly to `/courses/:slug/runs/:rid`, `RunDetailPage.loadAll` calls `GET /api/courses/by-slug/{slug}` first; that endpoint is `require_course_admin_for_run`-gated, so teachers get a 403 "Access denied" page before the run UI ever mounts.
- Two subsequent reads inside `loadAll` — `GET /api/courses/{cid}/versions` and `GET /api/versions/{vid}/blocks` — are also `require_course_admin`-only, so even if `by-slug` were opened, the run-detail page would still fail to load.

The backend already permits teachers to read and write per-run resources (assets, mini-projects, roster, groups, evaluations, etc.) via `require_run_admin_or_teacher`. The blockers are entirely at the course-info and entry-point layers, plus the missing run-list UI.

Slice A unblocks the existing run-detail UI for teachers and adds a teacher-tailored landing page. It does NOT redesign the run-detail UI itself — admin-only actions are conditionally hidden, but the tab layout, components, and overall structure stay identical.

## 2. User stories

- *As a teacher who's been added to a course's run*, I want to log in and see a list of the runs I teach, organized so I can find my active terms quickly.
- *As a teacher*, when I click on a run, I want the same run-detail page admins use, but without buttons that I can't act on (publish/unpublish/delete the run, publish/unpublish mini-projects).
- *As a course admin who also teaches one of my own runs*, I want a clear nav switcher between Authoring and Teaching, and login should default me to Authoring (my primary day-to-day).
- *As a teacher with no current assignments*, I want a clear empty state telling me what will appear when a course admin adds me.

## 3. Architecture

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
    """True iff the user has a RunTeacher row on any run of any version of the course.

    Joins RunTeacher → Run → CourseVersion to test course_id; the helper does NOT
    short-circuit on is_superuser or CourseAdmin — those checks are explicit at the
    call site so that the admin/teacher/superuser precedence is visible in the route
    handler.
    """
    from mathion.models import CourseVersion, Run, RunTeacher
    return db.scalar(
        select(exists().where(
            RunTeacher.user_id == user.id,
            RunTeacher.run_id == Run.id,
            Run.version_id == CourseVersion.id,
            CourseVersion.course_id == course_id,
        ))
    ) is True
```

Both `course_admins.user_id` and `run_teachers.user_id` are already indexed; cost is one indexed EXISTS read on the teacher branch. Course-admin path is unchanged.

#### 3.1.2 Open `GET /api/courses/{course_id}/versions` to teachers — with draft filter

Same gate-order extension as §3.1.1, BUT with a content filter on the teacher branch to prevent leaking in-progress draft authoring (`state == "created"`):

- Superuser / admin path: return ALL versions of the course regardless of state (unchanged).
- Teacher path: return versions where `state IN ('published', 'archived')`. Excludes drafts (state == 'created'). The teacher's run is pinned to one specific version, so a published-or-archived list always contains the pinned version when the run is in an operational state; if the pinned version were ever a `created` draft (admin would not normally do this), the run-detail loader still falls back gracefully because the run carries its own `version_id`.

No schema change. Response shape stays `list[VersionResponse]` either way.

#### 3.1.3 Open `GET /api/versions/{version_id}/blocks` to teachers — with version-scope filter

Same gate-order shape, evaluated after the version is loaded:

1. `user.is_superuser` → allow.
2. User is `CourseAdmin` of `version.course_id` → allow.
3. `version.state IN ('published', 'archived')` AND `has_run_teacher_on_course(db, user, version.course_id)` is True → allow (NEW).
4. Else → 403.

Note: `version.is_disabled` does NOT block teacher reads. The run-detail page must render the historical block structure of the pinned version even when an admin later marks it disabled; tests in §6.1 lock this in.

Write endpoints on versions/blocks/sequences/items remain `require_course_admin`. Teachers can read the course skeleton (to render the run-detail tabs) but cannot modify it. Cascade endpoints under blocks (items, questions, answer options) stay admin-only — see §6.1 for a guard test.

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

**Why defaults matter:** Both `get_profile` (`backend/mathion/api/auth.py`) and `verify_pin` (`backend/mathion/api/auth.py:46`) call `UserResponse.model_validate(user)` against the ORM `User`, which has neither flag. Without defaults, `model_validate` raises and PIN-verify 500s. With defaults, both handlers MUST overwrite the flags before returning:

```python
def _user_response_with_flags(db: Session, user: User) -> UserResponse:
    has_admin = user.is_superuser or db.scalar(
        select(exists().where(CourseAdmin.user_id == user.id))
    ) is True
    has_teacher = db.scalar(
        select(exists().where(RunTeacher.user_id == user.id))
    ) is True
    return UserResponse.model_validate(user).model_copy(
        update={"has_course_admin": has_admin, "has_run_teacher": has_teacher}
    )
```

Both `get_profile` and `verify_pin` return `_user_response_with_flags(db, user)`. Superuser short-circuits `has_course_admin` to `True` so superuser-without-an-admin-row still defaults to the Authoring landing.

**Flags are UI-only.** The backend continues to evaluate every authorization decision via `require_*` helpers that re-query `CourseAdmin` / `RunTeacher` on each request. Stale flags cannot grant access — every write attempt re-checks roles server-side. The flags exist only to render the right nav links.

**Refresh cadence.** Flags are recomputed on every `/me` response. `/me` is invoked exactly twice in the user lifecycle: (a) on PIN verify and (b) on app boot (cookie-restored session). No other refresh trigger. Mid-session role changes by an admin are NOT pushed live — see §5.1.

#### 3.1.5 New `GET /api/teaching/runs`

New router file `backend/mathion/api/teaching.py`:

```python
@router.get("/api/teaching/runs", response_model=list[TeachingRunRow])
def list_teaching_runs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeachingRunRow]: ...
```

`TeachingRunRow` is built by hand in the handler — its fields cross multiple tables, so `from_attributes` will NOT hydrate it from a single ORM row:

```python
class TeachingRunRow(BaseModel):
    run: RunResponse
    course_id: int
    course_name: str
    course_slug: str
    student_count: int

    model_config = {"from_attributes": True}
```

**No server-side sort.** Backend returns rows ordered by `Run.id ASC` (stable). The frontend derives status via the existing `frontend/src/lib/runStatus.ts` (which uses local-midnight boundaries) and performs grouping + within-group sort client-side. This eliminates the timezone divergence risk between server `date.today()` and client local time, and makes the existing `runStatus.ts` the single source of truth for status display. With typical teacher run-counts well under 50, client-side sort is cheap.

**Authorization.** Endpoint requires only `get_current_user`. There is NO superuser bypass — superusers see only runs where they hold a `RunTeacher` row, not every run system-wide. A user with no `RunTeacher` rows receives `[]`.

**N+1 prevention — concrete SQL pattern.** A single grouped query with one LEFT JOIN + COUNT subquery:

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
        student_count=int(row.student_count or 0),
    )
    for row in rows
]
```

A run with zero students returns `student_count == 0` (not null) because of the `int(... or 0)` coercion. Drafts with NULL `start_date`/`end_date` are not an issue since `Run.start_date`/`end_date` are `nullable=False` per `models.py:197-198`.

**No pagination.** Teachers typically have <50 runs total. A future slice can add it if a deployment ever needs it.

**Router registration.** `app.include_router(teaching_router)` must be invoked BEFORE the SPA `/api/{rest:path}` 404 catch-all in `backend/mathion/main.py:66-71` (or wherever the catch-all lives at implementation time). Plan task should grep `include_router` to find the registration block.

#### 3.1.6 No changes to other run-scoped endpoints

Assets, mini-projects (CRUD/list/get/render), roster (read/write), groups, evaluations, run GET/PATCH all use `require_run_admin_or_teacher` already. No change.

Run lifecycle (POST publish, POST unpublish, DELETE run, POST new run) and mini-project publish/unpublish stay `require_course_admin` / `require_course_admin_for_run`. Teachers calling these continue to receive 403; the frontend just won't show the buttons.

**Verification subtask for the plan.** The plan MUST include a pre-implementation read of `backend/mathion/api/runs.py` to confirm the actual gate on `PATCH /api/runs/{rid}` before §3.2.4's RunOverviewTab hides assume "PATCH end-date / title / metadata are teacher-allowed". If the actual gate is `require_course_admin_for_run`, the frontend hides change — those fields become admin-only too.

### 3.2 Frontend changes

#### 3.2.1 New `components/chrome/AppHeader.svelte`

Thin top bar, rendered by `App.svelte` for every authenticated route (hidden on `/login`, hidden during `session.loading`).

Layout:

```
[Mathion]          [Authoring]  [Teaching]                Sergey Kucheryavski  [Logout]
```

- **Brand** — `<a>` element with text "Mathion". `href` resolved at render time from session flags: `/courses` if `has_course_admin`, else `/teaching` if `has_run_teacher`, else `/courses` (student/empty fallback). No `/` indirection — the brand goes directly to its landing target.
- **Center nav links** — each link renders only when its corresponding role flag is true. `aria-current="page"` when the link's path matches the current route prefix (`/courses*` for Authoring, `/teaching*` for Teaching). Active link gets a distinct visual treatment (underline + bold weight); the test for `aria-current` does NOT mandate a specific visual style.
- **Right side** — user's `full_name` rendered as plain text. Falls back to `email` only when `full_name === null`. Immediately to the right of the name: a `<button>` labeled "Logout". No dropdown. The button calls `logout()` imported from `frontend/src/lib/auth.svelte.ts` (NOT `session.logout` — that does not exist) and on success navigates to `/login`. Designed for an icon-only swap later (`aria-label="Logout"` reserved for that swap).
- **Reactivity** — AppHeader reads `session.user?.has_course_admin` / `has_run_teacher` directly via runes. The next `/me` response updates the nav reactively without remounting; this is the mechanism by which a fresh login (or page reload) refreshes role-driven visibility.
- No new CSS dependencies; uses existing color tokens.

#### 3.2.2 New `pages/teaching/TeacherRunListPage.svelte`

Route: `/teaching` (added to `routes.ts`, `auth: true`).

Lifecycle states:

| State | Render |
|---|---|
| Loading | `<LoadingPlaceholder label="Loading runs…" />` — same component used by `pages/runs/RunListPage.svelte:76-79`. |
| Error (`/api/teaching/runs` fails) | `loadError` string in a styled error banner with a "Back to courses" link, mirroring `RunListPage`'s error pattern. |
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

**Status derivation, grouping, and within-group sort happen client-side**, using the existing `runStatus(run)` from `frontend/src/lib/runStatus.ts` so the displayed status matches the rest of the app's local-midnight semantics. Pseudocode:

```ts
const all = await listTeachingRuns();             // server-ordered by run.id ASC
const withStatus = all.map(r => ({ row: r, status: runStatus(r.run) }));
const byStatus = groupBy(withStatus, x => x.status); // 'Active'|'Upcoming'|'Ended'|'Draft'
function sortGroup(rows, status) {
  switch (status) {
    case 'Active':   return [...rows].sort(byEndDateAscThenId);
    case 'Upcoming': return [...rows].sort(byStartDateAscThenId);
    case 'Ended':    return [...rows].sort(byEndDateDescThenId);
    case 'Draft':    return [...rows].sort(byCreatedAtDescThenId); // updated_at not exposed; created_at via Run.created_at proxy if exposed, else by id desc
  }
}
const ordered = [
  ...sortGroup(byStatus.Active ?? [], 'Active'),
  ...sortGroup(byStatus.Upcoming ?? [], 'Upcoming'),
  ...sortGroup(byStatus.Ended ?? [], 'Ended'),
  ...sortGroup(byStatus.Draft ?? [], 'Draft'),
];
```

Sort keys:
- **Active**: `end_date ASC, id ASC` — "wrapping up soonest first".
- **Upcoming**: `start_date ASC, id ASC` — "starting soonest first".
- **Ended**: `end_date DESC, id ASC` — "most recently ended first".
- **Draft**: If `RunResponse` exposes `created_at`/`updated_at` at implementation time, use `updated_at DESC, id ASC`; otherwise fall back to `id DESC` (stable, recent-creation proxy). The plan must check the schema; the spec does not require adding `updated_at` solely for this.

Pills:
- **All 5 filter pills always visible** (even when count is 0), matching the `RunAssetsTab` pattern.
- **Default selection: Active.** Rationale: matches user story 1 ("find my active terms quickly"); mid-semester is the dominant teaching state. When Active count is 0 (e.g. between terms), the page stays on the Active pill and shows the empty-filter message — explicitly chosen over auto-switching so the teacher sees the "no active runs right now" cue rather than landing silently on a different pill. The pill counts make the alternative options self-evident.
- Pill counts are derived from the FULL response (not affected by the selected filter).
- Selected pill is a `<button aria-pressed="true">` with a distinct visual style (background + border-color); the test asserts `aria-pressed` only.

Table:
- **Single `<table>`** rendered below the pills, filtered client-side by the selected pill.
- **Row navigation** uses cell-level anchor elements following the `RunListPage:116` pattern: each cell wraps its content in `<a href={runUrl} onclick={e => { e.preventDefault(); navigate(runUrl); }}>`. NO `<tr onclick>` — keyboard and screen-reader navigation must work on real anchors.
- **Status column** is kept so the "All" view stays meaningful when statuses mix.

**Table-style reuse.** `RunListPage`'s `<style>` block is component-scoped and cannot be shared via `import`. Slice A duplicates the relevant table styles inside `TeacherRunListPage.svelte` — copy the same rules, do not refactor `RunListPage`. A future slice may extract a `<RunTable>` sub-component or move shared rules into a global stylesheet; explicitly out of scope here.

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

Mirrors `lib/runs.ts` conventions. Frontend uses `row.run.title` etc. via the nested shape — every column accessor in the table accounts for the nesting.

#### 3.2.4 `pages/runs/RunDetailPage.svelte` — thread `course` prop + conditional hiding

**Current state (not what the prior spec revision claimed):** `RunDetailPage.svelte` passes `course` only to `<RunAssetsTab>` (around line 418, `course={course!}`). `<RunOverviewTab>`, `<RunMiniProjectsTab>`, and `<RunTeachersTab>` currently receive NO `course` prop. Slice A must thread it.

**Two-part change:**

1. **Thread the prop.** Pass `isCourseAdmin={course?.is_admin ?? false}` to each of `<RunOverviewTab>`, `<RunMiniProjectsTab>`, `<RunTeachersTab>`. Extend each tab's `$props()` destructure and TypeScript type to accept the boolean. Default value `false` to keep tests that don't supply the prop safe.

2. **Conditional hides inside each tab:**
   - **`RunOverviewTab`** — hide `Publish`, `Unpublish`, and `Delete run` buttons when `!isCourseAdmin`. Keep PATCH-end-date / PATCH-title / metadata edits visible *if and only if* the §3.1.6 plan verification confirms `PATCH /api/runs/{rid}` is `require_run_admin_or_teacher`. If verification reveals it's admin-only, hide those too — the spec does not pre-commit before the gate is read.
   - **`RunMiniProjectsTab`** — hide the per-row MP `Publish` / `Unpublish` toggle when `!isCourseAdmin`. Other MP controls (Edit, Delete with force-confirm) stay visible — backend already permits teachers via `require_run_admin_or_teacher`.
   - **`RunTeachersTab`** — hide the "Add teacher" form and per-row "Remove" buttons when `!isCourseAdmin`. Run-teachers add/remove endpoints are already `require_course_admin_for_run` server-side; this removes dead controls from the teacher view.

No new components. The hides are `{#if isCourseAdmin}` blocks; the prop wiring is the meaningful work.

#### 3.2.5 `App.svelte` — routing + AppHeader integration

**AppHeader placement.** Lift above the loading guard and render conditionally:

```svelte
{#if !session.loading && session.user && currentRoute.path !== '/login'}
  <AppHeader />
{/if}

{#if session.loading}
  <LoadingPlaceholder />
{:else if matched}
  <svelte:component this={...} />
{:else}
  <NotFound />
{/if}
```

This keeps AppHeader visible on `NotFound` (it should be — the user is still logged in) and hidden on `/login` and during initial session load.

**Default-route effect — merged form preserving the auth guard.** The current `$effect` in `App.svelte:34-43` handles both the `/` redirect AND an auth-guard for protected routes. Slice A only replaces the `/` branch:

```svelte
$effect(() => {
  if (session.loading) return;

  // 1. Default route: '/' redirects based on session role flags.
  if (currentRoute.path === '/') {
    const target =
      session.user?.has_course_admin ? '/courses' :
      session.user?.has_run_teacher  ? '/teaching' :
      '/courses';                                    // student/empty fallback
    navigate(target, { replace: true });
    return;
  }

  // 2. Auth guard for protected routes (preserved verbatim from existing code).
  if (matchedRoute?.auth && !session.user) {
    navigate('/login', { replace: true });
    return;
  }
});
```

The plan task that touches `App.svelte` must keep the auth-guard branch intact; this snippet is illustrative — diff against the existing file before editing.

**Extract `defaultLandingPath(user)` helper.** To make the routing decision unit-testable without driving jsdom navigation, extract the inner ternary into a pure function in `frontend/src/lib/router.svelte.ts`:

```ts
export function defaultLandingPath(user: User | null): string {
  if (user?.has_course_admin) return '/courses';
  if (user?.has_run_teacher)  return '/teaching';
  return '/courses';
}
```

Unit-tested in `frontend/src/tests/router.test.ts` (existing file). The `App.svelte` `$effect` calls it; smoke covers the end-to-end navigation.

**New route entry in `routes.ts`:** `{ path: '/teaching', component: 'TeacherRunListPage', auth: true }`. Add `TeacherRunListPage` import + entry to `componentMap`.

#### 3.2.6 Session store

`frontend/src/stores/session.svelte.ts` stores `user: User | null` opaquely. The new `has_course_admin` / `has_run_teacher` fields flow through transparently once the `User` type in `frontend/src/lib/types.ts:5-12` is extended. No store-shape change. `logout` is imported from `frontend/src/lib/auth.svelte.ts:44` (NOT from the session store).

Flag freshness: the same `/me` response that updates other fields also carries the flags. They become reactive in AppHeader on the next `/me`.

### 3.3 No mobile / responsive changes

Slice A assumes the desktop layout used elsewhere in the app. Mobile is a project-wide concern, not scoped here.

## 4. Data flow

### 4.1 Login → landing

```
POST /api/auth/verify-pin
        ↓
verify_pin handler builds UserResponse with role flags (§3.1.4 — _user_response_with_flags)
        ↓
session.user populated immediately with flags (no second /me call required)
        ↓
App.svelte $effect on '/' :
  has_course_admin       → navigate('/courses')
  else has_run_teacher   → navigate('/teaching')
  else                   → navigate('/courses')   (student/empty fallback)
```

On a fresh tab with a valid cookie, the same flow runs via `GET /me` instead of `verify-pin`. AppHeader renders link visibility from the same flags.

### 4.2 Teacher opens a run

```
/teaching → click row anchor → /courses/{slug}/runs/{rid}
        ↓
RunDetailPage.loadAll(slug, rid):
  GET /api/courses/by-slug/{slug}    → 200, course.is_admin = false   (opened by §3.1.1)
  Promise.all([
    GET /api/runs/{rid}                → 200   (existing teacher allowance)
    GET /api/courses/{cid}/versions    → 200, filtered to state in ('published','archived')   (§3.1.2)
    GET /api/runs/{rid}/teachers       → 200
    GET /api/runs/{rid}/groups         → 200
    GET /api/runs/{rid}/students       → 200
    GET /api/runs/{rid}/assets         → 200
  ])
  if pinnedVersion:
    Promise.all([
      GET /api/versions/{vid}/blocks       → 200   (opened by §3.1.3; reads disabled+non-draft fine)
      GET /api/runs/{rid}/mini-projects    → 200
    ])
```

After the load, `course.is_admin = false` propagates to the four affected tabs and hides admin-only controls.

### 4.3 Direct URL navigation

- `/teaching` without `has_run_teacher` — page mounts, fetches `/api/teaching/runs`, gets `[]`, shows the page-level empty state. No guard.
- `/courses/:slug/runs/:rid` for a course the user has no role on — `by-slug` returns 403; existing error display shows "Access denied".

### 4.4 Logout

`AppHeader` Logout button → `logout()` (from `lib/auth.svelte.ts`) → backend clears cookie → `navigate('/login')`. On re-login, `/me` (or PIN-verify) re-fetches the user with fresh flags.

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

### 5.8 Role-removed-but-cookie-still-valid

If an admin removes ALL of user X's `RunTeacher` rows AND X has no `CourseAdmin` rows AND X has no enrollment, X's cookie still authenticates `/me`. They see the header with no nav links and an empty `/courses`. Degenerate state; tightening it is out of scope.

`is_disabled` users are handled at the auth layer — `validate_session` (`backend/mathion/auth.py:142-146`) destroys the session and returns `None` when `user.is_disabled`. A disabled teacher cannot reach any of the new endpoints; no extra guard needed.

### 5.9 Teacher who is also enrolled as a student on the same course

Possible if an admin both enrolls and teaches a user. `by-slug` returns `is_admin: false`; run-detail page mounts as teacher with teacher-controls. The user can also see the course in their student view via existing `MyCourseResponse` flow. Consistent behavior; one regression test in §6.1.

### 5.10 Course slug rename (out of scope, noted)

`Course.slug` is mutable via admin PATCH. A teacher's bookmarked `/courses/{old-slug}/runs/{rid}` will 404 after rename. Out of scope for Slice A; a future slug-redirect layer may handle it.

### 5.11 Teacher viewing a run whose pinned version was later disabled

Per §3.1.3, teacher branch allows reads on disabled versions (and §5.4 confirms the existing UX renders). A test in §6.1 (`test_blocks_disabled_version_readable_by_teacher`) locks this in.

## 6. Testing

### 6.1 Backend (pytest, `backend/.venv`)

New test file `tests/test_teaching.py`. The `teacher_client` fixture already exists in `backend/tests/conftest.py:124-143` — leverage it.

**Helper unit tests** (`has_run_teacher_on_course`):
- `test_helper_hits_when_teacher_row_on_pinned_version`
- `test_helper_hits_when_teacher_row_on_different_version_of_same_course`
- `test_helper_hits_when_multiple_teacher_rows_on_same_course`
- `test_helper_misses_when_no_teacher_row`
- `test_helper_misses_when_teacher_row_on_different_course`

**Opened endpoints — gate behavior**:
- `test_by_slug_allows_run_teacher_returns_is_admin_false`
- `test_by_slug_admin_who_is_also_teacher_returns_is_admin_true` (admin precedence)
- `test_by_slug_superuser_returns_is_admin_true`
- `test_by_slug_still_rejects_non_member`
- `test_versions_list_allows_run_teacher_filters_drafts` (asserts `state='created'` excluded for teacher)
- `test_versions_list_admin_still_sees_drafts` (regression)
- `test_versions_list_allows_archived_for_teacher`
- `test_versions_list_still_rejects_non_member`
- `test_blocks_list_allows_run_teacher_on_pinned_published_version`
- `test_blocks_list_allows_run_teacher_on_disabled_version` (locks §5.4/§5.11)
- `test_blocks_list_rejects_teacher_on_draft_state_version` (locks §3.1.3 state filter)
- `test_blocks_list_still_rejects_non_member`

**Cascade guard** (lock in that opening blocks does NOT cascade to authoring leaves):
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
- `test_me_role_flags` (parameterized: admin / teacher-only / both / neither / superuser)
- `test_me_response_shape_includes_existing_fields` (regression — ensures `id`, `email`, `full_name`, `is_superuser`, `is_disabled`, `photo_url` all still present alongside the new flags)
- `test_verify_pin_response_includes_role_flags` (THE critical regression test — PIN-verify path must not 500 after the schema change)

**`/api/teaching/runs` tests**:
- `test_teaching_runs_returns_only_my_runs`
- `test_teaching_runs_excludes_runs_without_teacher_row` (renamed from `_excludes_course_admin_only_runs`)
- `test_teaching_runs_ignores_runs_on_other_courses` (teacher of course A doesn't see course B)
- `test_teaching_runs_empty`
- `test_teaching_runs_student_count_zero` (run with no students)
- `test_teaching_runs_student_count_multiple` (run with N>1 students)
- `test_teaching_runs_no_n_plus_one` (assert single query via `with capture_queries(): client.get(...)` if a helper exists; otherwise document and skip — perf rather than correctness)
- `test_teaching_runs_superuser_sees_only_own_teacher_rows` (locks §3.1.5 no-bypass)
- `test_teaching_runs_orders_by_id_asc` (since sort is now client-side, backend just guarantees stable id-order)
- `test_teaching_runs_response_key_set` (asserts response[0].keys() == {run, course_id, course_name, course_slug, student_count} — contract test paired with frontend mock)

### 6.2 Frontend (vitest)

New `src/tests/AppHeader.svelte.test.ts`:
- Renders both nav links when both flags true.
- Renders only one link when only one flag true.
- Renders no nav links (just brand + name + logout) when both flags false.
- Active link gets `aria-current="page"` matching the current route prefix.
- Logout button click calls `logout()` (mocked from `lib/auth.svelte.ts`) and navigates to `/login`.
- Shows `full_name` when present; falls back to `email` when `full_name === null`.
- Hidden on `/login` route (set `currentRoute.path = '/login'` via the existing test pattern, e.g. `__resetGuardsForTests` in `router.test.ts:5-9`).
- Hidden during `session.loading === true`.
- Brand href resolves to `/courses` for admin, `/teaching` for teacher-only, `/courses` for student/empty.

New `src/tests/TeacherRunListPage.svelte.test.ts`:
- Loading state renders `<LoadingPlaceholder>`.
- Error state renders `loadError` banner with back-link.
- Renders all 5 pills with counts derived from the FULL response (don't change when filtering).
- Default selected pill is `Active`; `aria-pressed=true`.
- When the response has 0 Active runs, default pill stays on Active and the empty-filter message renders.
- Switching pills filters table rows correctly.
- Within-group sort: Active by `end_date ASC`, Upcoming by `start_date ASC`, Ended by `end_date DESC`, Draft by `updated_at`/`id DESC` (assert via a hand-built fixture).
- Status is derived client-side via `runStatus()` (assert that a fixture with `is_published=true, start_date=yesterday, end_date=tomorrow` lands in Active).
- Empty response → page-level empty state copy, no pills/table.
- Non-empty response with 0 matching rows for a NON-default pill (e.g. user switches to Draft, has none) → inline empty-filter state with cross-counts.
- Row click navigates to `/courses/:slug/runs/:rid` via cell-anchor click (not row click).
- Mocked-fetch response includes exact key set `{run, course_id, course_name, course_slug, student_count}` (contract test — paired with backend `test_teaching_runs_response_key_set`).

New `src/tests/teaching.test.ts`:
- `listTeachingRuns()` calls `GET /api/teaching/runs`.
- Returns the parsed response array.

New unit-test extension in `src/tests/router.test.ts`:
- `defaultLandingPath({ has_course_admin: true, has_run_teacher: false, ... })` → `/courses`.
- `defaultLandingPath({ has_course_admin: false, has_run_teacher: true, ... })` → `/teaching`.
- `defaultLandingPath({ has_course_admin: false, has_run_teacher: false, ... })` → `/courses`.
- `defaultLandingPath(null)` → `/courses`.

Extend `src/tests/RunOverviewTab.svelte.test.ts`:
- When `isCourseAdmin === false`, publish/unpublish/delete-run buttons are NOT in the DOM (assert via `queryByText`/`queryByRole` returning null, not `not.toBeVisible`).
- When `isCourseAdmin === true`, all three controls ARE in the DOM (regression guard).
- (Conditional on §3.1.6 verification) PATCH-end-date / PATCH-title fields presence matches verification outcome.

Extend `src/tests/RunMiniProjectsTab.svelte.test.ts`:
- When `isCourseAdmin === false`, the MP publish/unpublish toggle is NOT in the DOM.
- When `isCourseAdmin === true`, the toggle IS in the DOM (regression guard).

Extend `src/tests/RunTeachersTab.svelte.test.ts`:
- When `isCourseAdmin === false`, the Add-teacher form and per-row Remove buttons are NOT in the DOM.
- When `isCourseAdmin === true`, both ARE in the DOM (regression guard).

Extend `src/tests/App.svelte.test.ts` (or create if missing — note: no existing precedent for App.svelte routing tests in this codebase; the `defaultLandingPath` helper extraction above is what makes routing testable. If integration testing App.svelte proves intractable, demote these to manual smoke and rely on the helper unit tests):
- AppHeader hidden on `/login`.
- AppHeader visible on other authenticated routes.
- AppHeader hidden during `session.loading === true`.

### 6.3 Manual smoke walkthrough (the plan's final task)

0. Visit `/login` without auth → AppHeader is NOT visible.
1. Login as course-admin only → AppHeader shows Authoring (active), no Teaching link; lands on `/courses`.
2. As admin, add an existing user as `RunTeacher` to a run on a course you don't admin: log in as another admin (or use a superuser session), navigate to that run's `RunTeachersTab`, add the email through the existing UI. The frontend POST hits `/api/runs/{rid}/teachers` and creates/updates the user — this is the supported path, no SQL required.
3. Log in as the target teacher user. `/me` returns both flags. AppHeader shows both Authoring + Teaching.
4. Click Teaching → land on `/teaching` with pills, default Active, table populated.
5. Switch through each pill, verify row counts match pill counts and that rows within each group appear in the documented sort order (e.g. for Active, leftmost end-date first).
6. Click a row → run-detail page; verify Overview tab has NO publish/unpublish/delete; MP tab has NO publish toggle on rows; Teachers tab has NO add-form and NO remove buttons; Assets, Groups, Evaluations tabs work normally.
6b. As the teacher, view a run whose pinned version is disabled (admin sets `is_disabled` via Authoring): verify the version-disabled banner renders and tooltips on disabled actions still appear.
7. Log in as a teacher-only user (no `CourseAdmin` rows): AppHeader shows Teaching only; `/` redirects to `/teaching`; brand href is `/teaching`.
8. Create a fresh teacher-only user via PIN-invite flow, do NOT assign any `RunTeacher` rows. Log in: `/teaching` renders the page-level empty state ("You're not assigned to any runs yet…").
9. Direct URL `/courses/:slug/runs/:rid` as a teacher → loads correctly with hidden admin actions.
10. Direct URL `/courses/:slug/runs/:rid` as a non-member → 403 "Access denied" via existing error path.

## 7. Migration / data

No database schema change. No migrations needed.

## 8. Backward compatibility

- `UserResponse` gains two new boolean fields with `= False` defaults. PIN-verify and `/me` handlers overwrite them via `_user_response_with_flags`. Older frontend builds calling `/me` ignore the new fields (additive). Older frontend builds calling PIN-verify still receive a valid response shape.
- No breaking changes to existing endpoints. The opened `versions`/`blocks`/`by-slug` endpoints continue to return the same shape for admins; only the gate is widened (with a teacher-specific content filter on `versions`).

## 9. Performance

- `/me` and PIN-verify: +2 small `EXISTS` reads per call. Both tables indexed on `user_id`. Negligible.
- `/api/teaching/runs`: typical teacher has <50 runs total. Single grouped query with `LEFT JOIN ... COUNT GROUP BY`; no N+1. Cheap.
- Opened read endpoints (`by-slug`, `versions`, `blocks`): the new helper `has_run_teacher_on_course` adds one indexed EXISTS read per gated call when the user is not a `CourseAdmin`. Course-admin path unchanged.
- Frontend sort/group: O(N) over typically <50 rows. Trivial.

## 10. Accessibility

- AppHeader uses semantic `<nav>` containing `<a>` elements. Brand is `<a>`. Active link marked with `aria-current="page"`. Logout button has visible text "Logout" (icon-only swap later will require an `aria-label`).
- TeacherRunListPage pills are `<button>` elements with `aria-pressed`; selection state communicated.
- Table uses semantic `<table>`/`<thead>`/`<tbody>` with column headers in `<th scope="col">`. Row navigation via cell-anchors so keyboard users can tab through rows.
- Tab order through the header: brand → Authoring → Teaching → name → Logout. AppHeader tests assert focusability via `tabindex` (or absence of negative tabindex on anchor/button elements).

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
- **`<RunTable>` extraction for style reuse** — Slice A duplicates table styles inside `TeacherRunListPage`. A future slice may extract a shared component.
- **Slug-redirect on course rename** — §5.10. Out of scope.
- **A-prime (unblock-only without `/teaching` landing)** — considered and rejected. Teachers without a landing page have no entry point and cannot satisfy user story 1, so the unblock alone delivers no end-to-end value.

## 12. Files touched (summary, for plan-sizing)

**Backend:**
- `backend/mathion/api/helpers.py` — add `has_run_teacher_on_course`.
- `backend/mathion/api/courses.py` — extend `get_course_by_slug` gate (4-tier order).
- `backend/mathion/api/versions.py` — extend `list_versions` gate + state filter on teacher branch.
- `backend/mathion/api/blocks.py` — extend `list_blocks` gate + state filter.
- `backend/mathion/api/auth.py` — `_user_response_with_flags` helper; wire into `get_profile` AND `verify_pin`.
- `backend/mathion/schemas.py` — extend `UserResponse` with two `= False` defaults; add `TeachingRunRow`.
- `backend/mathion/api/teaching.py` — new router file.
- `backend/mathion/main.py` (and/or `backend/mathion/api/__init__.py` — verify at plan time) — register new router BEFORE the SPA catch-all.
- `backend/tests/test_teaching.py` — new test file (helper + endpoint + cascade-guard tests).
- `backend/tests/test_auth.py` — extend with `/me` flag tests and PIN-verify shape regression.

**Frontend:**
- `frontend/src/components/chrome/AppHeader.svelte` — new.
- `frontend/src/pages/teaching/TeacherRunListPage.svelte` — new.
- `frontend/src/lib/teaching.ts` — new.
- `frontend/src/lib/types.ts` — extend `User` type with role flags; add `TeachingRunRow`.
- `frontend/src/lib/router.svelte.ts` — add `defaultLandingPath(user)` helper.
- `frontend/src/App.svelte` — render `AppHeader`; update default-route effect (keep auth-guard branch); add `TeacherRunListPage` to component map.
- `frontend/src/routes.ts` — add `/teaching` route.
- `frontend/src/pages/runs/RunDetailPage.svelte` — thread `isCourseAdmin` prop to three tabs.
- `frontend/src/components/runs/RunOverviewTab.svelte` — accept `isCourseAdmin` prop; `{#if isCourseAdmin}` around publish/unpublish/delete-run (and, per §3.1.6 verification, around PATCH controls).
- `frontend/src/components/runs/RunMiniProjectsTab.svelte` — accept `isCourseAdmin` prop; `{#if isCourseAdmin}` around per-row publish toggle.
- `frontend/src/components/runs/RunTeachersTab.svelte` — accept `isCourseAdmin` prop; `{#if isCourseAdmin}` around add-teacher form and per-row Remove.
- `frontend/src/tests/AppHeader.svelte.test.ts` — new.
- `frontend/src/tests/TeacherRunListPage.svelte.test.ts` — new.
- `frontend/src/tests/teaching.test.ts` — new (wire-module).
- `frontend/src/tests/router.test.ts` — extend with `defaultLandingPath` unit tests.
- `frontend/src/tests/RunOverviewTab.svelte.test.ts` — extend.
- `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` — extend.
- `frontend/src/tests/RunTeachersTab.svelte.test.ts` — extend.
- `frontend/src/tests/App.svelte.test.ts` — extend or create (with documented fallback to manual smoke if jsdom integration proves intractable).

Plan-sized estimate: ~14-17 tasks. Reasonable bundling (e.g., "open 3 read endpoints + helper" as one task; "thread `isCourseAdmin` + 3 conditional-hide blocks + their test extensions" as one task) keeps it inside the 12-15 band the user prefers. No A-prime split.
