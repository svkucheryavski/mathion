# Teacher Monitoring Surface — Slice A: unblock + landing

**Date:** 2026-05-29
**Status:** Design (pre-plan)
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

### 3.1 Backend changes — three opened endpoints, one extended endpoint, one new endpoint

#### 3.1.1 Open `GET /api/courses/by-slug/{slug}` to teachers

Current handler returns 403 if the user is not a `CourseAdmin` of the course. After this change:

- If the user is a `CourseAdmin` → return `is_admin: true` (unchanged).
- Else if the user has at least one `RunTeacher` row on a run whose `course_version.course_id == course.id` → return `is_admin: false`.
- Else → 403 (unchanged).

The `is_admin` field is already on `CourseResponse`; no schema change.

New helper in `backend/mathion/api/helpers.py`:

```python
def has_run_teacher_on_course(db: Session, user: User, course_id: int) -> bool:
    """True iff the user has a RunTeacher row on any run of any version of the course."""
    from mathion.models import CourseVersion, Run, RunTeacher
    return db.scalar(
        select(literal(True))
        .select_from(RunTeacher)
        .join(Run, Run.id == RunTeacher.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunTeacher.user_id == user.id,
            CourseVersion.course_id == course_id,
        )
        .limit(1)
    ) is True
```

Used by three endpoints (see below). Side-effect-free, single indexed read; cheap.

#### 3.1.2 Open `GET /api/courses/{course_id}/versions` to teachers

Same change shape: keep the `CourseAdmin` allowance, add the `has_run_teacher_on_course` allowance, otherwise 403. Response unchanged.

#### 3.1.3 Open `GET /api/versions/{version_id}/blocks` to teachers

Same shape, but the helper is called with `version.course_id` after the version is loaded.

Write endpoints on versions/blocks/sequences/items stay `require_course_admin`. Teachers can read the course skeleton (to render the run-detail tabs) but cannot modify it.

#### 3.1.4 Extend `GET /me` with role flags

`UserResponse` gains two booleans:

```python
class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    is_superuser: bool
    is_disabled: bool
    photo_url: str | None
    has_course_admin: bool   # NEW
    has_run_teacher: bool    # NEW

    model_config = {"from_attributes": True}
```

Computed in the `/me` handler via two `exists()` subqueries:

```python
has_course_admin = db.scalar(
    select(literal(True)).select_from(CourseAdmin)
    .where(CourseAdmin.user_id == user.id).limit(1)
) is True
has_run_teacher = db.scalar(
    select(literal(True)).select_from(RunTeacher)
    .where(RunTeacher.user_id == user.id).limit(1)
) is True
```

Both tables are small and indexed on `user_id`; the two reads add negligible cost.

Flags are computed at login (or page reload). Mid-session role changes by an admin are NOT pushed live — see §5.1.

#### 3.1.5 New `GET /api/teaching/runs`

New router file `backend/mathion/api/teaching.py`:

```python
@router.get("/api/teaching/runs", response_model=list[TeachingRunRow])
def list_teaching_runs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ...
```

Returns every run the current user has a `RunTeacher` row for, **across all courses**. Each row carries:

```python
class TeachingRunRow(BaseModel):
    run: RunResponse
    course_id: int
    course_name: str
    course_slug: str
    student_count: int

    model_config = {"from_attributes": True}
```

`student_count` is `COUNT(RunStudent.id WHERE run_id == run.id)`. Computed via a `func.count(...)` subquery to avoid N+1.

Server-side order: status group (Active → Upcoming → Ended → Draft) then within-group:
- Active: `start_date ASC` (next-ending soonest first; ties broken by `id ASC`).
- Upcoming: `start_date ASC` (next-starting first).
- Ended: `end_date DESC` (most recent first).
- Draft: `updated_at DESC` (most recently edited first).

Status derivation (per the existing `runStatus` logic the frontend already encodes; mirror it in the backend handler for consistent sort):
- `Draft`: `is_published == false`
- `Active`: `is_published AND start_date <= today <= end_date`
- `Upcoming`: `is_published AND today < start_date`
- `Ended`: `is_published AND today > end_date`

No pagination for Slice A — teachers typically have well under 50 runs across their full history. If a deployment ever needs it, add a later slice.

The endpoint requires only `get_current_user`; it doesn't need any role gate (`exists`-style: returns `[]` for users with no `RunTeacher` rows).

#### 3.1.6 No changes to other run-scoped endpoints

Assets, mini-projects (CRUD/list/get/render), roster (read/write), groups, evaluations, run GET/PATCH all use `require_run_admin_or_teacher` already. No change.

Run lifecycle (POST publish, POST unpublish, DELETE run, POST new run) and mini-project publish/unpublish stay `require_course_admin` / `require_course_admin_for_run`. Teachers calling these continue to receive 403; the frontend just won't show the buttons.

### 3.2 Frontend changes

#### 3.2.1 New `components/chrome/AppHeader.svelte`

Thin top bar, rendered by `App.svelte` for every authenticated route (hidden on `/login`, hidden during `session.loading`).

Layout:

```
[Mathion]          [Authoring]  [Teaching]                Sergey Kucheryavski  [Logout]
```

- **Brand text** "Mathion" on the left. Click → `/courses` if `has_course_admin`, else `/teaching` if `has_run_teacher`, else `/`.
- **Center nav links** — each link renders only when its role flag is true. `aria-current="page"` when the link's path matches the current route prefix (`/courses*` for Authoring, `/teaching*` for Teaching). Visual emphasis (e.g., underline + bold) on the active link.
- **Right side** — user's `full_name` rendered as plain text. Falls back to `email` only when `full_name === null` (the "invited" case for admins who haven't completed their profile). Immediately right of the name: a `[Logout]` button. No dropdown. The button calls `session.logout()` (existing) and navigates to `/login`. Designed for an icon-only swap later.
- No new CSS dependencies; uses existing color tokens.

#### 3.2.2 New `pages/teaching/TeacherRunListPage.svelte`

Route: `/teaching` (added to `routes.ts`, `auth: true`).

On mount: `GET /api/teaching/runs` via the new wire module `lib/teaching.ts`.

Layout:

```
[Active (3)]  [Upcoming (1)]  [Ended (5)]  [Draft (0)]  [All (9)]
─────────────────────────────────────────────────────────────────

| Course    | Run title  | Status   | Start–End                | Students |
| --------- | ---------- | -------- | ------------------------ | -------- |
| Calc 101  | Spring '26 | Active   | 2026-02-01 → 2026-05-30  | 24       |
| Stats 200 | Spring '26 | Active   | 2026-02-15 → 2026-06-15  | 18       |
```

- **All 5 filter pills always visible** (even when count is 0), matching `RunAssetsTab`'s pattern.
- **Default selection: Active** (`aria-pressed=true`). Pill counts derived client-side from the full response.
- **Single `<table>`** rendered below the pills, filtered client-side by the selected pill. Reuses the styles from the admin `RunListPage` table.
- **Sort within the filtered view**: server-side order is already grouped+sorted, so the client just renders the response in order, applying the pill filter as a final step.
- **Whole-row click** → navigate to `/courses/:courseSlug/runs/:runId`. The cell content is a styled link so screen-reader navigation lands on a real anchor.
- **Status column** is kept in the table so the "All" view stays meaningful when statuses mix.
- **Empty-filter state** (the selected pill matches zero rows but the response is non-empty): inline message `"No active runs. You have N upcoming and M ended."` (numbers derived from the full response, no extra fetch).
- **Whole-page empty state** (response was `[]`): no pills, no table; show `"You're not assigned to any runs yet. When a course admin adds you as a teacher, the run will appear here."`

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

Mirrors `lib/runs.ts` conventions.

#### 3.2.4 `pages/runs/RunDetailPage.svelte` — conditional hiding

`loadAll` already passes `course` (with `course.is_admin`) to all tab children. Slice A wires that flag into conditional rendering at three sites:

- **`RunOverviewTab`** — hide `Publish`, `Unpublish`, and `Delete run` buttons when `!course.is_admin`. Keep PATCH-end-date / PATCH-title / metadata edits visible (teachers may PATCH these per the run router's `require_run_admin_or_teacher`).
- **`RunMiniProjectsTab`** — hide the per-row MP `Publish` / `Unpublish` toggle when `!course.is_admin`. Other MP controls (Edit, Delete with force-confirm) stay visible — backend already permits teachers via `require_run_admin_or_teacher`.
- **`RunTeachersTab`** — verify the "Add teacher" form and "Remove" buttons are hidden when `!course.is_admin`. Run-teachers add/remove endpoints are already `require_course_admin_for_run` server-side; this is just removing dead controls from the teacher view.

No new components. The hiding is a few `{#if course.is_admin}` blocks.

#### 3.2.5 `App.svelte` — routing + AppHeader integration

- Render `<AppHeader />` between the loading guard and the route component, only when `session.user !== null` and `currentRoute.path !== '/login'`.
- Default-route `$effect`, replacing the existing `navigate('/courses')` branch:
  ```svelte
  if (currentRoute.path === '/' && !session.loading) {
    if (session.user?.has_course_admin) navigate('/courses', { replace: true });
    else if (session.user?.has_run_teacher) navigate('/teaching', { replace: true });
    else navigate('/courses', { replace: true });  // student / empty fallback
    return;
  }
  ```
- New route entry in `routes.ts`: `{ path: '/teaching', component: 'TeacherRunListPage', auth: true }`.
- Add `TeacherRunListPage` import + entry to `componentMap`.

#### 3.2.6 Session store

`session.user` already comes from a `GET /me` fetch on app boot and on PIN verification. The new `has_course_admin` / `has_run_teacher` flags pass through transparently if the existing TypeScript `User` type is extended. No store-shape change.

### 3.3 No mobile / responsive changes

Slice A assumes the desktop layout used elsewhere in the app. Mobile is a project-wide concern, not scoped here.

## 4. Data flow

### 4.1 Login → landing

```
POST /api/auth/verify-pin   (cookie set)
        ↓
GET /me   →   { full_name, has_course_admin, has_run_teacher, ... }
        ↓
session.user populated
        ↓
App.svelte $effect on '/' :
  has_course_admin       → navigate('/courses')
  else has_run_teacher   → navigate('/teaching')
  else                   → navigate('/courses')   (existing student/empty fallback)
```

AppHeader renders link visibility from the same flags. Same flow on a fresh tab that still has a valid cookie (no PIN, just `/me`).

### 4.2 Teacher opens a run

```
/teaching → click row → /courses/{slug}/runs/{rid}
        ↓
RunDetailPage.loadAll(slug, rid):
  GET /api/courses/by-slug/{slug}    → 200, course.is_admin = false   (opened by §3.1.1)
  Promise.all([
    GET /api/runs/{rid}                → 200   (existing teacher allowance)
    GET /api/courses/{cid}/versions    → 200   (opened by §3.1.2)
    GET /api/runs/{rid}/teachers       → 200
    GET /api/runs/{rid}/groups         → 200
    GET /api/runs/{rid}/students       → 200
    GET /api/runs/{rid}/assets         → 200
  ])
  if pinnedVersion:
    Promise.all([
      GET /api/versions/{vid}/blocks       → 200   (opened by §3.1.3)
      GET /api/runs/{rid}/mini-projects    → 200
    ])
```

After the load, the run-detail tabs render with `course.is_admin = false`, hiding the four admin-only control groups.

### 4.3 Direct URL navigation

- `/teaching` without `has_run_teacher` — page mounts, fetches `/api/teaching/runs`, gets `[]`, shows the page-level empty state. No guard.
- `/courses/:slug/runs/:rid` for a course the user has no role on — `by-slug` returns 403; existing error display shows "Access denied".

### 4.4 Logout

`AppHeader` Logout button → `session.logout()` (existing) → `navigate('/login')`. Session cookie cleared by the backend. On re-login, `/me` is re-fetched.

## 5. Edge cases and accepted gaps

### 5.1 Role flag staleness — Accepted gap

`has_course_admin` / `has_run_teacher` are computed at login and on each fresh `/me` fetch (app boot). Mid-session role changes are not pushed live.

Consequences and chosen behavior:

| Scenario | What happens |
|---|---|
| Admin promotes user X to `RunTeacher` mid-session | X's "Teaching" link doesn't appear until they reload the page. The deep link `/teaching` still works if X navigates there directly — the page fetches `/api/teaching/runs` fresh. |
| Admin removes user X's `RunTeacher` row mid-session | X's "Teaching" link still shows until reload. Clicking it loads `/api/teaching/runs`, which returns `[]` for X now; X sees the empty state. No crash. |
| Admin removes user X's `CourseAdmin` row mid-session | X's "Authoring" link still shows until reload. `/courses` returns the filtered list (possibly empty); the link visibility is wrong but not load-bearing. |
| Admin promotes user X to `CourseAdmin` mid-session | "Authoring" link missing until reload. |

A future slice may add a `/me` re-fetch hook on key navigation events; deferred.

### 5.2 (Invited) teacher logging in

When an admin invites a teacher via the `RunTeachersTab`, the system creates a `User` row with `full_name = null` (the user hasn't completed their profile yet). PIN login works for these users.

- AppHeader's name field falls back to `email` when `full_name === null`. No extra state needed.
- All other behavior is identical.

### 5.3 Concurrent role removal mid-action

If an admin removes a teacher's `RunTeacher` row while the teacher has the run-detail page open AND the teacher then triggers a write (e.g., evaluating a submission), the backend returns 403. The existing `ApiError` flow surfaces an error banner. No new code.

### 5.4 Course pinned version disabled

Existing `versionIsDisabled` UX (banner above tab content + tooltips on action buttons) already works for both roles — the `pinnedVersion.is_disabled` field flows through the same loadAll path. No change.

### 5.5 Deep-link from email

When a course admin invites a teacher via email (out of scope for this slice — invitation email content is a separate concern), the email might contain a deep link to `/courses/:slug/runs/:rid`. After login, the user lands on the deep link route, `by-slug` succeeds because the `RunTeacher` row exists, page loads. Identical to the admin path.

### 5.6 Superuser

Users with `is_superuser: true` get `has_course_admin: true` (they bypass admin gates everywhere). They land on `/courses` by default. If they also have `RunTeacher` rows, the Teaching link shows.

### 5.7 User with only enrollment, no admin / no teacher

Student-only users (existing student MVP audience) get `has_course_admin: false` and `has_run_teacher: false`. They land on `/courses` (existing fallback) and see their enrolled courses. AppHeader shows neither Authoring nor Teaching link — just the brand + name + logout. The header on student pages is a small new surface for them; the rest of the student MVP is unchanged.

### 5.8 Role-removed-but-cookie-still-valid

If an admin removes ALL of user X's `RunTeacher` rows AND X has no `CourseAdmin` rows AND X has no enrollment, X's existing cookie still authenticates `/me`. They see the header with no nav links and an empty `/courses`. That's a degenerate state; tightening it (e.g., forcing logout) is out of scope.

## 6. Testing

### 6.1 Backend (pytest, `backend/.venv`)

New test file `tests/test_teaching.py`:

- `test_by_slug_allows_run_teacher`
- `test_by_slug_still_rejects_non_member`
- `test_by_slug_returns_is_admin_false_for_teacher`
- `test_versions_list_allows_run_teacher`
- `test_versions_list_still_rejects_non_member`
- `test_blocks_list_allows_run_teacher`
- `test_blocks_list_still_rejects_non_member`
- `test_versions_write_still_admin_only` (one representative write op, e.g. POST new version)
- `test_blocks_write_still_admin_only` (one representative write op)
- `test_me_role_flags` (parameterized: admin / teacher-only / both / neither)
- `test_teaching_runs_returns_only_my_runs`
- `test_teaching_runs_status_grouping_and_within_group_sort`
- `test_teaching_runs_student_count`
- `test_teaching_runs_empty`
- `test_teaching_runs_excludes_course_admin_only_runs`
- `test_teaching_runs_ignores_runs_on_other_courses` (negative: teacher on course A doesn't see course B's runs)

Helper-level unit test for `has_run_teacher_on_course` (3 cases: hits, misses on course mismatch, misses on user mismatch).

### 6.2 Frontend (vitest)

New `src/tests/AppHeader.svelte.test.ts`:

- Renders both links when both flags true.
- Renders only one when only one flag true.
- Renders no nav links (just brand + name + logout) when both flags false.
- Active link gets `aria-current="page"` matching the current route prefix.
- Logout button click calls `session.logout()` and navigates to `/login`.
- Shows `full_name` when present; falls back to `email` when `full_name === null`.
- Hidden on `/login` route.

New `src/tests/TeacherRunListPage.svelte.test.ts`:

- Renders all 5 pills with counts from the response.
- Default selected pill is `Active`; `aria-pressed=true`.
- Switching pills filters table rows correctly.
- Pill counts always derived from the full response (don't change when filtering).
- Empty response → page-level empty state copy, no pills/table.
- Non-empty response with 0 matching rows for the selected pill → inline empty-filter state with cross-counts.
- Row click navigates to `/courses/:slug/runs/:rid`.
- Within-group sort verified (server returns the data already sorted; assert the rendered DOM order matches the response order).

Extend `src/tests/RunOverviewTab.svelte.test.ts`:

- When `course.is_admin === false`, the publish/unpublish/delete-run buttons are NOT in the DOM.
- When `course.is_admin === true`, all three controls ARE in the DOM (regression guard).

Extend `src/tests/RunMiniProjectsTab.svelte.test.ts`:

- When `course.is_admin === false`, the MP publish/unpublish toggle is NOT in the DOM.
- When `course.is_admin === true`, the toggle IS in the DOM (regression guard).

Extend `src/tests/RunTeachersTab.svelte.test.ts`:

- When `course.is_admin === false`, the Add-teacher form and per-row Remove buttons are NOT in the DOM.
- When `course.is_admin === true`, both ARE in the DOM (regression guard).

Extend `src/tests/App.svelte.test.ts` (or create if missing):

- Login routing: user with `has_course_admin: true` → navigated to `/courses`.
- Login routing: teacher-only → `/teaching`.
- Login routing: neither flag → `/courses` (student/empty fallback).
- AppHeader hidden on `/login`.
- AppHeader visible everywhere else.

### 6.3 Manual smoke walkthrough (the plan's final task)

Steps to be detailed in the plan. Outline:

1. Login as course-admin only → AppHeader shows Authoring (active), no Teaching link; lands on `/courses`.
2. Add yourself as `RunTeacher` to a run on a course you're not admin of (via seed script or DB). Re-login.
3. AppHeader now shows both Authoring + Teaching; `/me` confirms both flags.
4. Click Teaching → land on `/teaching` with pills, default Active, table populated.
5. Switch pills, verify row counts + sort.
6. Click a row → run-detail page; verify Overview has NO publish/unpublish/delete; MP tab has NO publish toggle; Teachers tab has NO add/remove; other tabs work.
7. Login as teacher-only user → header shows Teaching only; `/` redirects to `/teaching`.
8. Empty-state check: teacher-only user with no `RunTeacher` rows → page-level empty state.
9. Direct URL `/courses/:slug/runs/:rid` as a teacher → loads correctly with hidden admin actions.
10. Direct URL as a non-member → 403 "Access denied" via existing error path.

## 7. Migration / data

No database schema change. No migrations needed.

## 8. Backward compatibility

- `UserResponse` gains two new boolean fields. Frontend `User` TypeScript type extended to match. Older frontend builds calling `/me` will ignore the new fields (additive).
- No breaking changes to existing endpoints.

## 9. Performance

- `/me`: +2 small `EXISTS` reads per call. Both tables indexed on `user_id`. Negligible.
- `/api/teaching/runs`: typical teacher has <20 runs total. Single grouped query with a `COUNT` subquery; no N+1. Cheap.
- Opened read endpoints (`by-slug`, `versions`, `blocks`): the new helper `has_run_teacher_on_course` adds one indexed read per gated call when the user is not a `CourseAdmin`. Course-admin path unchanged.

## 10. Accessibility

- AppHeader nav uses semantic `<nav>` with `<a>` elements. Active link marked with `aria-current="page"`.
- TeacherRunListPage pills are `<button>` elements with `aria-pressed`; selection state communicated.
- Table uses semantic `<table>`/`<thead>`/`<tbody>` with column headers in `<th scope="col">`. Row navigation through anchor elements so keyboard users can tab through rows.
- Logout button has accessible text "Logout" (icon-only swap later will require an `aria-label`).

## 11. Open questions and explicit deferrals

- **Submissions review surface** — slice B. Spec'd later.
- **Evaluations writing surface** — slice C. Spec'd later.
- **Teacher dashboards consuming `/dashboard/progress` and `/dashboard/mini-projects`** — slice D. Spec'd later.
- **Notifications / pending-action signals** — slice E. The "K pending" badge per run row is intentionally not in slice A.
- **Live role-flag refresh** — accepted gap §5.1. Future slice may add `/me` re-fetch on key navigation events.
- **AppHeader icon-only logout button** — visual polish, swappable when iconography lands.
- **Mobile / responsive layout** — project-wide concern, not scoped here.
- **Account dropdown (settings, profile, etc.)** — slice-A header is just name + logout. Profile/settings UI lands when those backends do.

## 12. Files touched (summary, for plan-sizing)

**Backend:**
- `backend/mathion/api/helpers.py` — add `has_run_teacher_on_course`.
- `backend/mathion/api/courses.py` — extend `get_course_by_slug` gate.
- `backend/mathion/api/versions.py` — extend `list_versions` gate.
- `backend/mathion/api/blocks.py` — extend `list_blocks` gate.
- `backend/mathion/api/auth.py` — extend `/me` handler with role flags.
- `backend/mathion/schemas.py` — extend `UserResponse`; add `TeachingRunRow`.
- `backend/mathion/api/teaching.py` — new router file.
- `backend/mathion/main.py` (or wherever routers register) — register new router.
- `backend/tests/test_teaching.py` — new test file.

**Frontend:**
- `frontend/src/components/chrome/AppHeader.svelte` — new.
- `frontend/src/pages/teaching/TeacherRunListPage.svelte` — new.
- `frontend/src/lib/teaching.ts` — new.
- `frontend/src/lib/types.ts` — extend `User` type with role flags; add `TeachingRunRow`.
- `frontend/src/App.svelte` — render `AppHeader`; update default-route effect; add `TeacherRunListPage` to component map.
- `frontend/src/routes.ts` — add `/teaching` route.
- `frontend/src/components/runs/RunOverviewTab.svelte` — `{#if course.is_admin}` around publish/unpublish/delete-run.
- `frontend/src/components/runs/RunMiniProjectsTab.svelte` — `{#if course.is_admin}` around per-row publish toggle.
- `frontend/src/components/runs/RunTeachersTab.svelte` — `{#if course.is_admin}` around add-teacher form and per-row Remove.
- `frontend/src/tests/AppHeader.svelte.test.ts` — new.
- `frontend/src/tests/TeacherRunListPage.svelte.test.ts` — new.
- `frontend/src/tests/RunOverviewTab.svelte.test.ts` — extend.
- `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` — extend.
- `frontend/src/tests/RunTeachersTab.svelte.test.ts` — extend.
- `frontend/src/tests/App.svelte.test.ts` — extend or create.

Plan-sized estimate: ~12-15 tasks (backend gating + helper + new endpoint + frontend nav + landing page + conditional hides + tests + smoke).
