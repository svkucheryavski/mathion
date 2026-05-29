# Teacher Monitoring Surface — Slice A: unblock + landing

**Date:** 2026-05-29
**Status:** Design (post 5×6+codex×4 reviewer pass — rev 11 fixes 3 Important + 3 Minor from codex round 10): (1) **RunAssetsTab force-delete is "disabled + tooltip", not absent** — codex round 10 verified the actual UI at `RunAssetsTab.svelte:658-664, 804-811`: button stays in DOM with `disabled={!openConfirm.checkboxChecked || !course.is_admin}` and `title="Only course admins can force-delete a referenced asset."` Rev 11 fixes §3.1.6, §6.2 RunAssetsTab tests, and §6.3 step 6g to assert "disabled + tooltip" instead of "absent" / "GONE". (2) **§6.2 RunMP test bullets** added for "Enable on Overview", "See Overview", and `newDisabledTitle` — rev 10 specified them in §3.2.4 and §12 but the §6.2 list still only tested "Publish on Overview." Rev 11 locks the §3.2.4 contract in the §6.2 list too. (3) **`RunGroupsTab` admin-dead instruction** at `RunGroupsTab.svelte:100-103` — same pattern as MP tab. Placeholder reads "Enable in Overview → Settings" which is dead for teachers on published runs (groups toggle hard-disabled at `RunOverviewTab.svelte:166`; backend rejects flipping `groups_enabled` on published per `runs.py:84-85`). Rev 11 adds a 3-branch placeholder + `RunGroupsTab.svelte.test.ts` regression tests + §6.3 step 6h verification. Group CRUD (add/rename/delete) when groups are enabled stays teacher-allowed (`groups.py:20-23, 49-53, 67-71`). (4) **§12 mount counts synced** with §3.2.4: RunOverviewTab 8, checklist 7, RunMP ~22, RunTeachers ~12 (§12 still said 7/6/22/6 from earlier).
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
- *As a teacher*, when I click on a run, I want the same run-detail page admins use, but without buttons that I can't act on (publish/unpublish/delete the run, add/remove other teachers, force-delete a locked mini-project, navigate to admin-only "Open Overview" CTAs in the MP modal).
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

    Used by `GET /api/courses/by-slug/{slug}` ONLY (§3.1.1). The version-list and
    block-list endpoints (§3.1.2, §3.1.3) use tighter predicates: an IN-subquery
    over pinned versions and the `has_run_pinned_to_version` helper, respectively.
    UI-relevant predicate; never used for any write-path authorization decision.
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

**Implementation hazard — refactor to a single `is_admin` assignment site.** The current handler at `backend/mathion/api/courses.py:80` unconditionally sets `out.is_admin = True` after passing the admin/superuser gate. Naively adding a teacher branch with an "also remember to set `is_admin = False`" comment is fragile — a copy-paste omission would expose the entire admin UI to teachers (every `{#if course.is_admin}` in §3.2.4 bypassed, publish/unpublish/delete-run visible, MP toggles visible, teacher add/remove visible).

**Required refactor:** compute a boolean `is_admin_role` in the gate logic (`True` for superuser / `CourseAdmin`, `False` for teacher), then assign `out.is_admin = is_admin_role` at exactly ONE site. `CourseResponse.is_admin: bool = False` (`backend/mathion/schemas.py:24`) already defaults to False, so even if the new branch forgets the assignment, the response defaults safely closed — no admin-UI leak. The unconditional `out.is_admin = True` line at `courses.py:80` MUST be deleted as part of this task. Plan task wording: "Refactor `get_course_by_slug` to compute `is_admin_role` once and assign it exactly once."

#### 3.1.2 Open `GET /api/courses/{course_id}/versions` to teachers — pinned-versions-only filter

Same gate-order extension as §3.1.1, BUT with a content filter on the teacher branch that returns ONLY the versions actually pinned by at least one of the teacher's runs on this course. This is tighter than a state filter and fixes two issues at once:

- **Draft leak** — in-progress `created`-state drafts the teacher's runs aren't pinned to are excluded.
- **Cross-version leak** — a teacher of a run pinned to v2 cannot read v1's structure even if v1 is published.
- **Loader-mount safety** — `frontend/src/pages/runs/RunDetailPage.svelte:78` resolves `pinnedVersion = vs.find(v => v.id === r.version_id) ?? null`. If the response excluded the pinned version (e.g., because it's still in `created` state), `pinnedVersion` would be `null` and the block-load branch would be silently skipped. The pinned-versions-only filter guarantees the pinned version is always present.

Implementation — **two branches, explicit**. The admin and teacher paths run different SELECTs so the existing admin behavior is preserved exactly:

- **Superuser / admin path: unchanged.** Returns all versions ordered by `CourseVersion.created_at DESC, CourseVersion.id DESC` with the existing `limit`/`offset` pagination from `versions.py:138-145`. Slice A does not touch this code path.
- **Teacher path: new SELECT.** Returns only versions pinned by the teacher's runs on this course, ordered by `CourseVersion.id ASC`. No pagination (teacher's pinned set is small — typically 1, occasionally a handful):
  ```python
  versions = db.scalars(
      select(CourseVersion)
      .where(
          # Outer scope: versions on the requested course.
          CourseVersion.course_id == course_id,
          # Inner scope: version IDs pinned by ANY of the user's runs (across all
          # courses; the outer `course_id` filter intersects to this course). Safe
          # because CourseVersion.id is a globally-unique PK belonging to exactly
          # one course via the course_id FK.
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

Order divergence between branches is intentional and load-bearing only for admins (they need the most-recent-version-first display in the editor). Teachers see their pinned set — order doesn't affect the loader (`vs.find(v => v.id === r.version_id)` is order-agnostic).

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

**Accepted trade-off — `info_md` exposure on pinned drafts.** Because §3.1.2 returns the full `VersionResponse` (`info_md` + `info_html` per `schemas.py:48-60`) for a pinned `created`-state version, a teacher of a run pinned to a draft sees the author's working-draft markdown source. This is intentional: an admin pinning a draft to a live run has implicitly designated the draft as operationally in production, and the run-detail UI needs `info_html` (rendered from `info_md`) to display the version info panel. The risk surface is bounded by the admin's pinning decision, not by the spec.

The same trade-off applies at the block level: `BlockResponse.info` + `info_html` (`schemas.py:69-77`) is teacher-visible on pinned drafts via this endpoint. Same framing as the version-level trade-off above — bounded by the admin's pinning decision; no additional spec guard.

New helper in `backend/mathion/api/helpers.py`:

```python
def has_run_pinned_to_version(db: Session, user: User, version_id: int) -> bool:
    """Return True iff the user has a RunTeacher row on a run whose version_id matches.

    Used by `GET /api/versions/{vid}/blocks` to scope teacher reads to exactly the
    versions their runs need. No `course_id` parameter is required: `CourseVersion.id`
    is a globally-unique PK belonging to exactly one course via the `course_id` FK,
    so course scoping is implicit. UI-relevant predicate; never used for any
    write-path authorization decision.
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

#### 3.1.3a Open `GET /assets/{version_id}/{filename}` to teachers — same pinned-version-only gate

`VersionResponse.info_html` (§3.1.2) and `BlockResponse.info_html` (§3.1.3) embed `<img src="/assets/{vid}/{filename}">` URLs generated by `resolve_asset_urls` (`backend/mathion/markdown.py:71-80`; called from `backend/mathion/api/helpers.py:308`). Without opening the asset-serving endpoint, every embedded image and downloadable file returns 403 to teachers — block content and the version info panel render as broken images. This is the natural read-companion to §3.1.2 and §3.1.3.

Current handler `serve_asset` at `backend/mathion/api/assets.py:130-182` has this gate structure:

```
1. version = get_or_404(db, CourseVersion, version_id)
2. if version.is_disabled: 403 (for ALL roles — pre-existing behavior; admins included)
3. if not user.is_superuser:
     if not CourseAdmin on version.course_id:
       if not StudentEnrollment.is_active on version_id (direct join, no Run table):
         403
4. asset existence + path-safety checks; return FileResponse
```

Slice A inserts a 4th role branch at step 3, after the StudentEnrollment check:

```
3. if not user.is_superuser:
     if not CourseAdmin on version.course_id:
       if not StudentEnrollment.is_active on version_id:
         if not has_run_pinned_to_version(db, user, version_id):  # NEW
           403
```

Same helper as §3.1.3 — no new function. The handler stays a single `serve_asset` with the four-branch gate; `FileResponse`, asset-existence check, and path-safety realpath verification (`assets.py:175-180`) are all unchanged. Write endpoints on assets (`upload_asset`, `list_assets` admin-only list, `delete_asset`) stay `require_course_admin`.

The teacher branch allows reads regardless of `version.state` (including `created`-state drafts) — same UX rationale as §3.1.3 for block content. A teacher of a run pinned to a `created`-state v2 with an image asset CAN download it; the block UI renders the image instead of 403.

**`is_disabled` semantics — admin-symmetric (NOT changed).** The pre-existing `assets.py:139-140` short-circuit raises 403 on `version.is_disabled` BEFORE any role branch — for everyone, including superusers and admins. This is locked in by the existing test `test_serve_asset_disabled_version_blocks_admin` at `backend/tests/test_assets_api.py:216-229`. Slice A does NOT change this: when a pinned version is disabled, embedded `<img>` tags 403 for teachers, the same way they 403 for admins today. The §5.4 disabled-version banner copy (and the tooltip overlays on action buttons) DOES still render — the banner is driven by `versionIsDisabled` frontend state, not by an HTTP asset fetch. What 403s is only the embedded image content authored inside `info_html`. This is acceptable: the UX is symmetric with admin behavior, and an admin who disabled a version doesn't expect its image content to remain live anyway. Widening this to teacher-only would be (a) inconsistent (admins would still see broken images) and (b) a behavior change requiring its own design pass; out of scope for Slice A.

**Existence-confirmation oracle.** The asset-existence check at `assets.py:160-167` runs AFTER the gate — so 404 leaks only to authorized callers (admin / enrolled / pinned-teacher). Non-pinned non-admins get 403 with no existence signal. Same oracle exists today; Slice A doesn't widen it.

**Path-traversal defenses unchanged.** `upload_asset` sanitizer (`backend/mathion/assets.py:29-49`) restricts filenames to `[a-z0-9-]+` plus extension; `serve_asset` defends in depth via `os.path.realpath` + `commonpath` at `assets.py:175-180`. Adding the teacher branch does not change the file-system boundary — teachers of a pinned version are bounded to `_asset_dir(version_id)`. No new attack surface.

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

**Refresh cadence.** Flags are recomputed on every `GET /api/auth/me` response (the full route — `/me` is the relative path inside `auth_router` which is mounted under `/api/auth`). `/api/auth/me` is invoked exactly twice in the user lifecycle: (a) on PIN verify, (b) on app boot (cookie-restored session). No other refresh trigger. Mid-session role changes by an admin are NOT pushed live — see §5.1.

**`update_profile` (PATCH `/api/auth/me`) is NOT wired to recompute flags.** The handler at `backend/mathion/api/auth.py:54-60` also returns `UserResponse` via `response_model=UserResponse`. With the rev-7 defaults (`= False`) in place, calling `update_profile` would emit `has_course_admin: false, has_run_teacher: false` regardless of the user's actual rows. Slice A does NOT wire `_user_response_with_flags` into `update_profile` because (a) the existing frontend at `frontend/src/lib/auth.svelte.ts` does not appear to replace `session.user` from the PATCH response and (b) the profile-edit surface is itself out of scope here. Tracked as a known future-wiring follow-up; not a Slice-A blocker. If a future slice adds a "save profile" flow that updates `session.user` from this response, it MUST also route through `_user_response_with_flags` to avoid clobbering the nav.

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
        Course.id,
        Course.name,
        Course.slug,
        func.count(RunStudent.id),
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
# Tuple destructuring matches the codebase idiom (e.g., dashboard.py:62, dashboard.py:166).
return [
    TeachingRunRow(
        run=RunResponse.model_validate(run),
        course_id=course_id,
        course_name=course_name,
        course_slug=course_slug,
        student_count=student_count,
    )
    for (run, course_id, course_name, course_slug, student_count) in rows
]
```

Notes:
- `func.count(RunStudent.id)` on an outer-joined empty side returns `0` (not NULL) on both SQLite and PostgreSQL — no coercion needed.
- `group_by(Run.id, Course.id)` relies on functional-dependency rules in PostgreSQL (PK → all columns) and SQLite's lenient grouping. If MySQL ever becomes a deployment target with `ONLY_FULL_GROUP_BY`, add `Course.name, Course.slug` to the GROUP BY.
- Backend `Run.id ASC` order is for test determinism only — the frontend re-groups and re-sorts client-side.

**No pagination.** Teachers typically have <50 runs total. A future slice can add it if a deployment ever needs it.

**Router registration.** `app.include_router(teaching_router)` must be invoked BEFORE the SPA `/api/{rest:path}` 404 catch-all at `backend/mathion/main.py:66-71`. Easiest insertion point: between `dashboard_router` (`main.py:50`) and the `@app.get("/health")` block at `main.py:53`.

#### 3.1.6 No changes to other run-scoped endpoints — and confirmed teacher-allowed writes

Assets, mini-projects (CRUD/list/get/render), roster (read/write), groups, evaluations, and run GET/PATCH all use `require_run_admin_or_teacher` already. No change.

**`PATCH /api/runs/{rid}` is teacher-allowed.** Verified at `backend/mathion/api/runs.py:78-81` (`require_run_admin_or_teacher`). Teachers CAN PATCH title / start_date / end_date / `groups_enabled` per `RunUpdate` (`backend/mathion/schemas.py:394-399`). Note that `RunUpdate` does NOT include `is_published` — there is no PATCH route into publish/unpublish; the dedicated POST routes (`/publish` and `/unpublish`) at `backend/mathion/api/runs.py:171-178` are the only run-lifecycle writes and they are course-admin-only. §3.2.4 commits accordingly — title / dates / `groups_enabled` controls stay visible to teachers in `RunOverviewTab`; publish/unpublish UI is course-admin-only.

**`POST /api/mini-projects/{mid}/publish` is teacher-allowed today.** Verified at `backend/mathion/api/mini_projects.py:248-256` (`require_run_admin_or_teacher`). Teachers can publish mini-projects within their runs. Slice A KEEPS this — MP publish is run management (analogous to roster / groups / assets / run PATCH), not course content authoring. The modal Publish button in `frontend/src/components/runs/MiniProjectModal.svelte:483-485` stays visible to teachers. There is NO dedicated unpublish endpoint today (publish is one-way for the MP's `is_published` flag; unpublish flows through PATCH MP if at all). The early reviewer-round claim that "MP publish/unpublish stays admin-only" was a wrong observation — codex round-7 caught it.

**Run lifecycle stays course-admin-only.** `POST /api/runs/{rid}/publish`, `POST /api/runs/{rid}/unpublish`, `DELETE /api/runs/{rid}`, and `POST /api/courses/{cid}/runs` (new run) remain `require_course_admin` / `require_course_admin_for_run`. Teachers calling these receive 403; the frontend just won't show the buttons. There is no PATCH-based publish/unpublish path (rev-7 incorrectly hedged about a back-door — `RunUpdate` does not include `is_published`).

**Force-delete locked MPs is course-admin-only.** `DELETE /api/mini-projects/{mid}?force=true` re-checks `require_course_admin` at `backend/mathion/api/mini_projects.py:204-209` when the MP is locked (has submissions). Non-locked MP delete stays teacher-allowed. §3.2.4 commits accordingly.

**Force-delete REFERENCED run-assets is course-admin-only — same pattern.** `DELETE /api/runs/{rid}/assets/{aid}?force=true` re-checks `require_course_admin_for_run` at `backend/mathion/api/run_assets.py:309-311`. Non-force delete (unreferenced asset) stays teacher-allowed. The frontend already reflects this at `frontend/src/components/runs/RunAssetsTab.svelte:658-664, 804-811` — the force-delete button STAYS IN THE DOM but is DISABLED (`disabled={!openConfirm.checkboxChecked || !course.is_admin}`) with an admin-only tooltip (`title={!course.is_admin ? 'Only course admins can force-delete a referenced asset.' : ''}`). Slice A KEEPS this existing pattern — no UI change in `RunAssetsTab`; only the spec needs to document the exact contract so smoke + tests assert "disabled + tooltip" rather than "absent."

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

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;  // ISO date strings sort lexicographically
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

**Styles.** `RunListPage.svelte` has NO per-component `<style>` block. The page-shell, headings, and table elements (`<table>`/`<thead>`/`<tbody>`) inherit from global stylesheets (`frontend/src/styles/*.css`) — TeacherRunListPage uses the same global patterns for those elements, no per-component styles required.

**Status-badge styles are NOT global.** The `.badge` / `.badge-active` / `.badge-upcoming` / `.badge-ended` / `.badge-draft` rules live ONLY inside `RunDetailPage.svelte:433-437` (Svelte-scoped); there are no global badge styles in `app.css` / `styles/base.css` / `styles/reset.css`. `RunListPage.svelte:117` currently renders unstyled "badges" — a pre-existing visual gap.

To avoid mirroring that gap in `TeacherRunListPage`, pick one of these at implementation time (NOT in scope to refactor RunListPage's pre-existing bug):

1. **Recommended:** Copy the four `.badge-*` rules into a scoped `<style>` block at the bottom of `TeacherRunListPage.svelte`. Same rules, scoped duplicate. Slice A keeps shipping value without touching `RunListPage`.
2. Extract `.badge-*` to a global stylesheet (`frontend/src/styles/badges.css` or similar) and use everywhere. Out of scope — a small follow-up.
3. Drop the Status column's badge styling and render plain text. Lowest effort; weaker visual cue.

Plan task should pick (1) unless the implementer prefers (3) for slice-A simplicity.

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

**Prop shape — `course: Course` (required), matching `RunAssetsTab.svelte:23,33`.** Each tab destructures `let { course, /* ...existing props */ } = $props<{ course: Course; /* ... */ }>()` and reads `course.is_admin` directly. `Course.is_admin` in `frontend/src/lib/types.ts` is non-optional `boolean` — `{#if course.is_admin}` is type-safe; test stubs must always set the field.

Required (not optional) — RunDetailPage always loads `course` before mounting the tab; existing tests of each tab will be updated to supply a stub `course: { is_admin: true }` (preserving today's "controls visible" behavior). Tests that want to assert the teacher view supply `course: { is_admin: false }`.

**Existing-test update scope is broader than one file per tab.** The prop change touches ~40 existing tests across SIX test files (counts verified at rev-6 spec time; may drift):

| File | Mount sites (verified by grep at rev-6 spec time; verify at impl time) |
|---|---|
| `frontend/src/tests/RunOverviewTab.svelte.test.ts` | 8 `mountOverview()` call sites (shared `mountOverview` helper — single helper edit. Verified by `grep -c 'mountOverview(' ...` at rev-10 spec time.) |
| `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts` | 7 `mountTab()` call sites (separate file ALSO mounting RunOverviewTab; shared `mountTab` helper — single helper edit). |
| `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` | ~22 mount sites total (mix of helper + direct mounts; codex round-9 grep). Extract a `mountMpTab(extra)` helper as part of this task so the prop change touches one helper, not 22 sites. |
| `frontend/src/tests/RunTeachersTab.svelte.test.ts` | ~12 mount sites (inline; codex round-9 grep). |
| `frontend/src/tests/RunAssetsTab.svelte.test.ts` | N/A for prop wiring (already receives `course`); add the new regression tests per §6.2 RunAssetsTab block. |
| `frontend/src/tests/RunDetailPage.svelte.test.ts` | indirect; audit `course = {...}` and `/api/courses/by-slug/` response literals for missing `is_admin` (see below) |
| `frontend/src/tests/RunDetailPage.publish.svelte.test.ts` | ~5 (indirect; `setup({...})` helper) |

**Required:** as part of this task, extract a `mountMpTab(extra)` helper inside `RunMiniProjectsTab.svelte.test.ts` (mirroring the existing `mountOverview` pattern) so the ~22 mount sites are updated through one helper, not 22 inline edits. The plan task MUST size for this. Without the helper, the prop change touches every test body and the cleanup-cost balloons.

**Test-fixture audit required for `RunDetailPage.svelte.test.ts`.** At least one Course-shape inline `/api/courses/by-slug/` response inside this file is MISSING the `is_admin` AND `description` fields at rev-7 spec time: line 56 has `jres({ id: 1, slug: 'c', name: 'C' })` with no `is_admin` and no `description`. Line 23 has the canonical `courseFixture` with `is_admin: true` (correct); line 29 is `versionFixture` (NOT a Course — earlier revisions of this spec mis-cited this line). Because both `Course.is_admin` and `Course.description` are non-optional in `frontend/src/lib/types.ts:198-200`, an absent `is_admin` flows as `undefined → false`, hiding admin controls under `{#if course.is_admin}` and silently regressing the Publish-bar and Assets-tab-integration tests; an absent `description` triggers TS-strict warnings. The prop-wiring task MUST grep the file end-to-end for `/courses/by-slug/` responses and for `course = {...}` literals — there may be more than one beyond line 56 (line ranges below 199 already verified at spec time; verify above 199 at impl time) — and explicitly set `is_admin: true` AND `description: ''` (preserving today's behavior) before running the suite.

**Conditional hides — verified UI locations:**

- **`RunDetailPage` header — split the publish-bar so status badge + version label stay visible** (`frontend/src/pages/runs/RunDetailPage.svelte:310-336`). The status badge (lines 311-313) and version label (lines 314-316) are CURRENTLY INSIDE the `.publish-bar` div — a naive `{#if course.is_admin}` wrap around the whole bar would hide them too, failing §6.3 step 6b and the §6.2 publish-bar tests. Two equivalent options at implementation time:

  1. **Recommended — restructure**: pull the badge and version label into a sibling `<div class="run-meta">` immediately before `.publish-bar`, then wrap only `.publish-bar` (now containing only Publish / Unpublish / InlineConfirm) in `{#if course.is_admin}`. Existing CSS scoped to `.publish-bar` (line 431+ — `display: flex; gap: 8px`) needs duplicating for `.run-meta`, or both classes can share the rule via a `, ` selector. Cleanest result.
  2. **Minimal patch**: keep the structure, wrap only the publish/unpublish block (lines 317-335) in `{#if course.is_admin}`. The badge (311-313) and version label (314-316) stay outside the `{#if}` block. CSS flex container holds; the bar collapses to badge + label for teachers.

  Either way the contract is: status badge + version label visible to ALL roles; Publish/Unpublish/InlineConfirm visible only when `course.is_admin`. (Earlier reviewer rounds mis-located these controls inside `RunOverviewTab` — codex round-7 caught it; codex round-8 caught the badges-inside-bar regression.)
- **`RunOverviewTab` Delete-run only** — accept required `course: Course` prop; wrap the `Delete run` button + delete confirm at `frontend/src/components/runs/RunOverviewTab.svelte:199-207` inside `{#if course.is_admin}`. PATCH-title / PATCH-end-date / `groups_enabled` toggle / metadata edits stay visible (PATCH on the run is `require_run_admin_or_teacher` per §3.1.6).
- **`RunMiniProjectsTab`** — accept required `course: Course` prop. **No MP-publish hide** — `publish_mini_project` is teacher-allowed (§3.1.6) and the modal Publish button (`MiniProjectModal.svelte:483-485`) stays visible to teachers. The only hide is for **force-delete of locked MPs**: when the row's MP is locked AND `!course.is_admin`, hide (or disable with tooltip) the force-confirm Delete affordance. Non-locked delete stays teacher-visible. **Locked signal:** `MiniProjectResponse.has_submissions` does NOT exist — the actual signal is `first_submitted_at !== null` per `backend/mathion/schemas.py:599` (`first_submitted_at: datetime | None`), exposed to the frontend at `frontend/src/lib/types.ts:393`, and matching the backend `is_locked = mp.first_submitted_at is not None` checks at `backend/mathion/api/mini_projects.py:145, 203`. Add a small derived helper at the top of `RunMiniProjectsTab.svelte`:

  ```ts
  const isLocked = (mp: MiniProjectResponse) => mp.first_submitted_at !== null;
  ```

  then gate the force-delete affordance with `{#if course.is_admin || !isLocked(mp)}`.
- **`RunTeachersTab`** — accept required `course: Course` prop; hide the "Add teacher" form and per-row "Remove" buttons inside `{#if course.is_admin}`. Run-teachers add/remove endpoints are `require_course_admin_for_run` server-side; this removes dead controls from the teacher view.
- **`RunGroupsTab`** (codex round-10) — accept required `course: Course` prop AND require `runIsPublished` (already a parent-supplied prop in `RunDetailPage.svelte:369-375`). The groups-disabled placeholder at `frontend/src/components/runs/RunGroupsTab.svelte:100-103` currently reads `"Groups are disabled for this run. Enable in Overview → Settings to manage groups."` That instruction is admin-dead for teachers on published runs (groups toggle hard-disabled at `RunOverviewTab.svelte:166` when `is_published`; backend rejects flipping `groups_enabled` on a published run per `backend/mathion/api/runs.py:84-85`). Rewrite the placeholder text:
  ```svelte
  {#if !groupsEnabled}
    <section class="groups-disabled-placeholder">
      {#if !runIsPublished}
        Groups are disabled for this run. Enable in Overview → Settings to manage groups.
      {:else if course.is_admin}
        Groups are disabled for this run. Unpublish in Overview before enabling groups.
      {:else}
        Groups are disabled for this run. Ask a course admin to unpublish the run and enable groups.
      {/if}
    </section>
  {:else}
    <!-- Existing groups-tab CRUD unchanged. Add/Rename/Delete groups are teacher-allowed
         per backend/mathion/api/groups.py:20-23, 49-53, 67-71. -->
  {/if}
  ```
  When groups ARE enabled, the existing CRUD (add/rename/delete + assignment) is teacher-allowed at the backend and STAYS visible. No `{#if course.is_admin}` wrap on the group CRUD itself.

No new components. The hides are `{#if course.is_admin}` blocks; the prop wiring extends to `RunDetailPage` itself + 3 tabs + `MiniProjectModal` (for the admin-dead navigation CTAs — see next paragraph). The modal's Publish button stays visible to all roles per Option A.

**Admin-dead navigation CTAs in MP flow** (codex rounds 8 + 9). The MP UI surfaces several "Open Overview to ..." link-buttons that point teachers toward admin-only actions. They MUST be conditionally hidden for teachers; the informational warning text stays visible.

In `RunMiniProjectsTab.svelte`:

- **Line 185 — "Publish on Overview"** (`<button data-action="nav-overview">`). Targets the publish-bar, course-admin-only. Wrap in `{#if course.is_admin}`. The surrounding "Run is not yet published." banner stays visible for teachers.
- **Line 170-175 — "Enable on Overview"** in the `!runGroupsEnabled` banner. Groups are teacher-editable via `RunUpdate` (§3.1.6) ONLY WHEN the run is NOT published; the `RunOverviewTab.svelte:161-167` toggle is hard-disabled by `disabled={run.is_published || groupsEnabledBusy}`. So the gate is `{#if !runIsPublished || course.is_admin}`. Banner text stays unconditional.
- **Line 96-99 — `newDisabledTitle` tooltip** "Mini-projects require groups. Enable groups on Overview." This tooltip lies to a teacher on a published run (they cannot enable groups without admin unpublishing first). Replace with a course-aware computation:
  ```ts
  if (!runGroupsEnabled) {
    return (!runIsPublished || course.is_admin)
      ? 'Mini-projects require groups. Enable groups on Overview.'
      : 'Mini-projects require groups. Ask a course admin to unpublish the run and enable groups.';
  }
  ```
- **Line 179 — "See Overview"** in the `versionIsDisabled` banner. Navigates to Overview which shows the same warning (re-enable is course-version authoring, admin-only). For teachers the CTA has no actionable destination. Wrap in `{#if course.is_admin}`; banner text stays.

In `MiniProjectModal.svelte`:

- **Line 216 — "Open Overview to publish"** (precondition bullet for `!run.is_published`). Hide link portion for teachers; warning text stays.
- **Line 222 — "Open Overview to re-enable it"** (precondition bullet for `pinnedVersion.is_disabled`). Hide link portion for teachers; warning text stays. (Re-enabling is course-version authoring.)
- **Line 201 — "Open Overview to set it"** (precondition bullet for `!run.end_date`). **Keep visible to teachers** — `end_date` is teacher-editable. No change.

Plan-task implementation pattern: pass `course: Course` into BOTH `MiniProjectModal` (new required prop) AND require `RunMiniProjectsTab` to have `course` + `runIsPublished` available (it already receives `runIsPublished`). Gate the link-rendering branches in `MiniProjectModal.svelte:439-447` on `course.is_admin` for the two admin-only bullets; the bullet `text` strings stay verbatim, only the `<button>` wrapping the "Open Overview" substring is conditional.

**Breadcrumb fix for pure teachers.** `RunDetailPage.svelte:304-307` renders breadcrumbs as `Courses › {course.name} › Runs › {run.title}` with the first two links pointing at `/courses` and `/courses/{slug}/runs`. For pure teachers (`!course.is_admin`), `/courses` returns an empty list and `/courses/{slug}/runs` is course-admin-gated — both are dead-ends. Rev-8 hide:

- When `course.is_admin === true` — render today's breadcrumb verbatim.
- When `course.is_admin === false` — render `Teaching › {course.name} › {run.title}`, where (a) `Teaching` is an `<a href="/teaching">` and (b) `{course.name}` and the static `Runs ›` segment between it and the run title are dropped (the course name becomes plain text immediately before the run title, since a pure teacher has no `/courses/{slug}` destination either).

The change is local to `RunDetailPage.svelte:304-307`; no new helper. Plan-writer should add a test in `RunDetailPage.svelte.test.ts` asserting (1) the `/courses` anchor is absent when `course.is_admin === false` and (2) the `/teaching` anchor is present.

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

**Default-route effect — merged form preserving the auth guard.** The current `$effect` at `App.svelte:34-43` handles BOTH the auth-guard for protected routes (with a `?next=...` round-trip so deep links survive login) AND would benefit from a `/` redirect branch. Slice A adds the `/` branch; preserves the auth-guard's `next` query-string construction + `force: true` flag verbatim (those are load-bearing for §5.5 — deep link from email survives login); and performs ONE small refactor: hoists `!session.loading` out of both branches into a top-level early-return. Behaviorally equivalent; structurally cleaner. The snippet:

```svelte
$effect(() => {
  if (session.loading) return;

  // 1. Default route: '/' redirects based on session role flags.
  //    (NEW in Slice A.)
  if (currentRoute.path === '/') {
    navigate(defaultLandingPath(session.user), { replace: true });
    return;
  }

  // 2. Auth guard for protected routes — preserved verbatim from existing
  //    App.svelte:39-42. DO NOT drop the `?next=...` or `force: true`.
  if (matched && matched.route.auth && session.user === null) {
    const next = encodeURIComponent(
      currentRoute.path + currentRoute.search + currentRoute.hash
    );
    navigate(`/login?next=${next}`, { replace: true, force: true });
  }
});
```

Diff against the existing `App.svelte:34-43` before editing — variable names (`matched`, `matched.route.auth`, `currentRoute.search`, `currentRoute.hash`) must match the real file exactly.

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

**New route entry in `routes.ts`:** `{ path: '/teaching', component: 'TeacherRunListPage', auth: true }`. In `App.svelte`: (a) add `import TeacherRunListPage from './pages/teaching/TeacherRunListPage.svelte'`, and (b) add a `TeacherRunListPage` entry to the `componentMap` object that the existing route-rendering uses to dispatch on `route.component`. Both edits are required — adding the route entry without the componentMap entry will route to an unknown component.

**Ordering constraint for the plan.** The `User` type at `frontend/src/lib/types.ts:5-12` must be extended with `has_course_admin: boolean` and `has_run_teacher: boolean` BEFORE `defaultLandingPath(user)` is consumed. If the types extension is staged into one plan task and the AppHeader / `App.svelte` routing into another, sequence the types task first so the consumers type-check.

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

Existing `versionIsDisabled` UX (banner above tab content + tooltips on action buttons) already works for both roles — the `pinnedVersion.is_disabled` field flows through the same loadAll path. The §3.1.3 teacher branch explicitly allows reads on `is_disabled` versions, so block text content (including `info_html` markup) renders. Manual smoke step 6b confirms.

**Embedded asset `<img>` images on disabled versions — admin-symmetric broken-image behavior, accepted.** `serve_asset` 403s for ALL roles when `version.is_disabled` (pre-existing behavior, locked in by `test_assets_api.py:216-229`). So when a pinned version is disabled, the banner and tooltips render normally, but embedded `<img>` references inside `info_html` show broken-image icons — exactly as they do for admins today. Slice A does not widen the asset gate to teacher-only on disabled versions; the asymmetry would be confusing (admins would still see broken images on their own disabled versions), and the use case is rare (admin disabling a live-pinned version mid-term).

### 5.5 Deep-link from email

When a course admin invites a teacher via email, the email may contain a deep link to `/courses/:slug/runs/:rid`. After login, the user lands on the deep link route, `by-slug` succeeds, run loads. Identical to the admin path.

### 5.6 Superuser

Users with `is_superuser: true` get `has_course_admin: True` regardless of `CourseAdmin` rows (§3.1.4 short-circuits the EXISTS query). They land on `/courses` by default. `has_run_teacher` reflects ONLY their actual `RunTeacher` rows; the Teaching link appears only when they hold at least one. `/api/teaching/runs` does NOT bypass for superusers — they see only their own teaching runs (§3.1.5). Test coverage in §6.1.

### 5.7 User with only enrollment, no admin / no teacher

Student-only users get `has_course_admin: false` and `has_run_teacher: false`. They land on `/courses` (existing fallback). AppHeader shows neither nav link — just brand + name + logout.

### 5.8 Role-removed-but-cookie-still-valid, and disabled-user handling

If an admin removes ALL of user X's `RunTeacher` rows AND X has no `CourseAdmin` rows AND X has no enrollment, X's cookie still authenticates `/me`. They see the header with no nav links and an empty `/courses`. Degenerate state; tightening it is out of scope.

`is_disabled` users are handled at the auth layer — `validate_session` (`backend/mathion/auth.py:129-146`) destroys the session and returns `None` when `user.is_disabled`. A disabled teacher cannot reach any of the new endpoints. Flipping `is_disabled` mid-session invalidates the very next request (not the current page state) — the user's next API call returns 401 and the frontend's ApiError flow takes over. No extra guard needed.

If an admin deletes the user row outright, `validate_session`'s `db.get(User, session.user_id)` returns `None` and `get_current_user` (`dependencies.py:22-23`) cleanly 401s the next request — no 500 risk.

### 5.9 Teacher who is also enrolled as a student on the same course

Possible if an admin both enrolls and teaches a user. `by-slug` returns `is_admin: false`; run-detail page mounts as teacher with teacher controls. The user can also see the course in their student view via existing `MyCourseResponse` flow. Consistent behavior; one regression test in §6.1.

### 5.10 Course slug rename (out of scope, noted)

`Course.slug` is mutable via admin PATCH. A teacher's bookmarked `/courses/{old-slug}/runs/{rid}` will 404 after rename. Out of scope for Slice A; a future slug-redirect layer may handle it.

### 5.11 Teacher viewing a run whose pinned version was later disabled

Per §3.1.3, teacher branch allows reads on disabled versions (and §5.4 confirms the existing UX renders). Test `test_blocks_list_allows_teacher_on_pinned_disabled_version` (§6.1) locks this in.

### 5.12 Session race during cookie restore

If `session.user` is null when `/teaching` mounts (cookie restore not yet completed), the existing `App.svelte` auth-guard `$effect` redirects to `/login?next=...` (preserving the deep link). No additional guard is required on the page itself.

### 5.13 Pinned-version deletion semantics

`Run.version_id` is `ForeignKey("course_versions.id", ondelete="RESTRICT")` at `backend/mathion/models.py:195`. An admin attempting to delete a `CourseVersion` row that any run still pins gets a constraint violation from the DB — the delete is rejected. To remove the version, the admin must first re-pin or delete the runs that point to it. No additional guard is needed at the teacher endpoints; the FK does the work. Tests do not need to fixture-prove this for Slice A.

## 6. Testing

### 6.1 Backend (pytest, `backend/.venv`)

New test file `tests/test_teaching.py`. The `teacher_user` and `teacher_client` fixtures already exist in `backend/tests/conftest.py:124-130` and `:133-142` — leverage them. There is NO `course_admin_client` fixture; for tests that need a non-superuser `CourseAdmin`, copy `_client_for(db, email)` from `backend/tests/test_run_assets.py:9-17` (calls `request_pin` + `verify_pin` and mints a cookied client). **IMPORTANT — the helper logs in only.** It does NOT seed any role rows; the caller must FIRST seed the `User` row AND insert the `CourseAdmin(user_id=u.id, course_id=c.id)` row, THEN call `_client_for(db, u.email)` to get the authenticated client. A plan-writer who treats `_client_for(...)` as a one-shot like `admin_client` will produce tests where the cascade-guard assertions pass for the wrong reason (the user is just a plain authenticated user, not a CourseAdmin). Pattern: seed → `_client_for` → exercise. (Earlier revisions of this spec cited `test_run_teachers.py` as the precedent; that file actually uses `admin_client` (superuser) exclusively. The genuine non-superuser inline-seeding pattern is in `test_run_assets.py`.)

**Helper unit tests** are called as Python functions (NOT via HTTP), matching the precedent at `backend/tests/test_slugify.py:3` and `test_run_permissions.py:6` — `from mathion.api.helpers import has_run_teacher_on_course, has_run_pinned_to_version` and call with the `db` session + inline-seeded rows. No HTTP round-trip needed.

**Helper unit tests** (`has_run_teacher_on_course`):
- `test_has_teacher_on_course_hits_when_teacher_row_on_pinned_version`
- `test_has_teacher_on_course_hits_when_teacher_row_on_different_version_of_same_course`
- `test_has_teacher_on_course_hits_when_teacher_row_on_draft_state_version`
- `test_has_teacher_on_course_hits_when_multiple_teacher_rows_on_same_course`
- `test_has_teacher_on_course_misses_when_no_teacher_row`
- `test_has_teacher_on_course_misses_when_teacher_row_on_different_course`
- `test_has_teacher_on_course_misses_when_only_other_user_has_teacher_row` (proves the `user_id` WHERE predicate is real, not accidental)

**Helper unit tests** (`has_run_pinned_to_version`):
- `test_has_pinned_hits_when_teacher_row_on_run_with_this_version_id`
- `test_has_pinned_misses_when_teacher_row_on_run_with_different_version_id`
- `test_has_pinned_misses_when_no_teacher_row`
- `test_has_pinned_misses_when_only_other_user_has_teacher_row` (same defense for the `user_id` predicate)
- `test_has_pinned_hits_when_pinned_version_is_created_state` (locks state-agnostic loader-mount fix)
- `test_has_pinned_hits_when_pinned_version_is_disabled` (locks §5.4/§5.11)

**Opened endpoints — gate behavior**:
- `test_by_slug_allows_run_teacher_returns_is_admin_false`
- `test_by_slug_admin_who_is_also_teacher_returns_is_admin_true` (admin precedence)
- `test_by_slug_superuser_returns_is_admin_true`
- `test_by_slug_still_rejects_non_member`
- `test_versions_list_returns_only_pinned_versions_for_teacher` — fixture: course C with v1/v2/v3 (all published), teacher's only run pinned to v2; assert response IDs = `[v2.id]` exactly.
- `test_versions_list_returns_multiple_pinned_versions_when_teacher_teaches_multiple_runs_on_same_course` — fixture: course C with v1/v2/v3, teacher's runs r1→v1 and r2→v2; assert response IDs = `[v1.id, v2.id]` in `id ASC` order.
- `test_versions_list_includes_pinned_draft_state_version_for_teacher` (locks loader-mount safety)
- `test_versions_list_includes_pinned_disabled_version_for_teacher` (locks §5.4/§5.11)
- `test_versions_list_admin_still_sees_all_versions_with_original_order_and_pagination` — fixture: course with 3 versions; assert default-query (no `?limit`/`?offset`) returns all 3 in `created_at DESC, id DESC` order; assert `?limit=1&offset=1` returns the middle row only. Defaults from `versions.py:135`: `limit=100, offset=0`.
- `test_versions_list_still_rejects_non_member`
- `test_blocks_list_allows_teacher_on_pinned_version`
- `test_blocks_list_allows_teacher_on_pinned_disabled_version` (§5.4/§5.11)
- `test_blocks_list_allows_teacher_on_pinned_draft_state_version` (locks Critical loader-mount fix)
- `test_blocks_list_rejects_teacher_on_unpinned_published_version` (cross-version leak guard)
- `test_blocks_list_still_rejects_non_member`
- `test_assets_serve_allows_teacher_on_pinned_version` (§3.1.3a — fixture: upload a small asset via admin (see helper note below), then `GET /assets/{vid}/{filename}` as teacher; assert 200 + correct body bytes)
- `test_assets_serve_rejects_teacher_on_pinned_disabled_version` (admin-symmetric — `is_disabled` 403s for all roles; this test LOCKS the §5.4 accepted-broken-image trade-off, NOT a teacher-allowed case. Parallel to existing `test_serve_asset_disabled_version_blocks_admin` at `backend/tests/test_assets_api.py:216-229`.)
- `test_assets_serve_allows_teacher_on_pinned_draft_state_version` (locks §3.1.3a draft loader-mount — `state` does NOT short-circuit, only `is_disabled` does)
- `test_assets_serve_rejects_teacher_on_unpinned_version` (cross-version leak guard parallel to blocks test)
- `test_assets_serve_still_rejects_non_member`
- `test_assets_list_still_admin_only_for_teacher` (regression — `list_assets` admin-only list path stays admin)
- `test_assets_upload_still_admin_only_for_teacher` (regression — write path stays admin)
- `test_assets_delete_still_admin_only_for_teacher` (regression — write path stays admin)

**Asset-upload helper.** The asset-serving tests need an asset on disk under the version's `_asset_dir`. Use the existing pattern from `backend/tests/test_assets_api.py:8-17` — `_create_published_version(admin_client)` + an admin-client POST to `/api/versions/{vid}/assets` with a small in-memory binary. Do NOT confuse this with `/api/runs/{rid}/assets` (run-level uploads use a different URL shape and are not what `serve_asset` reads).

**Shared local helper for the 7 asset tests.** Each test repeats: create course + version, upload one asset via admin, create teacher User row, insert RunTeacher row pinning teacher's run to the version, mint teacher client. To avoid ~80 lines of duplication, extract a `_seed_teacher_with_pinned_version_and_asset(db, *, state='published', is_disabled=False)` helper at the top of `test_teaching.py` returning the tuple `(teacher_client, version, asset_filename)`. The 7 asset tests then vary only the kwargs and the assertions.

**Cascade guard** (lock in that opening `/blocks` does NOT cascade to authoring leaves). Cascade URL patterns verified against current handlers:
- `test_sequences_list_still_admin_only_for_teacher` — `GET /api/blocks/{block_id}/sequences` (`backend/mathion/api/blocks.py:272`)
- `test_sequences_write_still_admin_only_for_teacher` — one representative POST + one DELETE
- `test_items_list_still_admin_only_for_teacher` — `GET /api/sequences/{sequence_id}/items` (`backend/mathion/api/items.py:91`)
- `test_questions_list_still_admin_only_for_teacher` — `GET /api/items/{item_id}/questions` (`backend/mathion/api/questions.py:80`)
- `test_answer_options_list_still_admin_only_for_teacher` — `GET /api/questions/{question_id}/options` (`backend/mathion/api/questions.py:188`)

**Write-still-admin regression**:
- `test_versions_write_still_admin_only` (one representative POST)
- `test_blocks_write_still_admin_only` (one representative POST)
- `test_run_publish_still_admin_only_for_teacher`
- `test_run_unpublish_still_admin_only_for_teacher`
- `test_run_delete_still_admin_only_for_teacher`
- `test_mini_project_publish_remains_teacher_allowed` (regression — locks §3.1.6 teacher-allowed MP publish so a future tightening of `publish_mini_project` doesn't silently land)
- `test_mini_project_force_delete_still_admin_only_for_teacher` (locks `mini_projects.py:204-209` force=true gate)
- `test_mini_project_delete_unlocked_remains_teacher_allowed` (regression — non-locked delete stays teacher-allowed)

**`/me` flag tests**:
- `test_me_role_flags` (parameterized: admin / teacher-only / both / neither / superuser — the superuser case specifically exercises the `user.is_superuser or ...` short-circuit; not redundant)
- `test_me_response_shape_includes_existing_fields` (regression — ensures `id`, `email`, `full_name`, `is_superuser`, `is_disabled`, `photo_url` all still present alongside the new flags)

**`api_verify_pin` flag test — concrete body**:

```python
from mathion.auth import request_pin   # service-layer fn returns the raw PIN; signature: (db, email) -> str | None

def test_verify_pin_response_includes_role_flags(client, teacher_user, db):
    # 1. Request a PIN via the service layer (returns the raw PIN — same pattern
    #    used by backend/tests/conftest.py:107-141 fixtures; no separate helper).
    pin = request_pin(db, teacher_user.email)
    assert pin is not None  # rate-limit defensive check, mirroring conftest.py:194 student_client_for pattern
    # 2. Verify via the HTTP route (this is what exercises _user_response_with_flags).
    r = client.post("/api/auth/verify-pin", json={"email": teacher_user.email, "pin": pin})
    assert r.status_code == 200
    body = r.json()
    # 3. Wrap preserved AND new flags present.
    assert "user" in body
    assert body["user"]["has_run_teacher"] is True
    assert body["user"]["has_course_admin"] is False
    # 4. Pre-existing fields still present (regression for schema-change risk).
    for key in ("id", "email", "full_name", "is_superuser", "is_disabled", "photo_url"):
        assert key in body["user"]
```

Fixture-name notes (verified against `backend/tests/conftest.py`):
- `db` is the session fixture (line 60) — NOT `db_session`.
- `client` (unauthenticated), `teacher_user` (line 124-130), `teacher_client` (line 133-142), `admin_client` (line 116-121, **superuser-backed**) exist. There is NO `course_admin_client` fixture. Tests that need a non-superuser `CourseAdmin` must seed inline; copy the `_client_for(db, email)` helper from `backend/tests/test_run_assets.py:9-17` (creates User, calls `request_pin`/`verify_pin`, mints the cookie).
- `api_verify_pin` (`backend/mathion/api/auth.py:29-46`) has NO `response_model` decorator — it returns a plain dict that FastAPI serializes via `jsonable_encoder`. Adding the new flags requires NO decorator change.
- `get_profile` (`backend/mathion/api/auth.py:49`) DOES carry `response_model=UserResponse`. After widening to return `_user_response_with_flags(db, user)` (which returns a `UserResponse`), FastAPI re-serializes through the same response_model — the new flag fields are part of the post-§3.1.4 UserResponse schema, so the decorator stays unchanged.

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
- `test_teaching_runs_response_key_set` — assert top-level row keys exactly: `{run, course_id, course_name, course_slug, student_count}` AND nested `run` includes at least `{id, title, start_date, end_date, is_published, created_at}` (the fields the frontend grouping/sort depends on). Paired with frontend mock-shape assertion.
- `test_teaching_runs_course_slug_populated` (frontend builds the URL from this — assert non-null/non-empty)
- `test_teaching_runs_includes_runs_pinned_to_disabled_versions` (no `is_disabled` filter on the SQL — regression guard against accidental future filter)
- `test_teaching_runs_includes_unpublished_draft_runs` (no `is_published` filter — Draft pill consumers depend on this)
- `test_teaching_runs_returns_run_when_user_is_one_of_multiple_teachers` (fixture: run has `[user, otherTeacher]` rows; assert response has exactly one row for this run — no duplication despite no DISTINCT in SQL, because `RunTeacher.user_id == user.id` narrows to one row)

(The earlier `test_teaching_runs_no_n_plus_one` is DROPPED for slice A — no `capture_queries` helper exists in `backend/tests/conftest.py`. Adding one is its own work item; the SQL is reviewed visibly in §3.1.5.)

### 6.2 Frontend (vitest)

New `src/tests/AppHeader.svelte.test.ts`:
- Renders both nav links when both flags true.
- Renders only one link when only one flag true.
- Renders no nav links (just brand + name + logout) when both flags false.
- Active link gets `aria-current="page"` when the route matches the prefix — including deep routes like `/courses/foo/runs/bar` (Authoring should still be marked).
- `aria-current` updates reactively when `currentRoute.path` changes (not just on initial render). Implementation hint: `AppHeader.svelte` must `import { currentRoute } from '../../lib/router.svelte'` for the reactive update to fire — same pattern as `App.svelte:3`. Without this import the test fails because the `$state`-tracked object isn't subscribed.
- Logout button click awaits `logout()` (mocked from `lib/auth.svelte.ts`) THEN navigates to `/login`.
- Shows `full_name` when present.
- Falls back to `email` when `full_name === null`.
- *(`/login` and `session.loading` visibility are NOT tested here.)* The conditional that hides AppHeader on `/login` and during `session.loading` lives in `App.svelte`, not in AppHeader itself (AppHeader has no internal "should I render?" logic). There's no jsdom integration test harness for App.svelte routing in this codebase (per §6.2 final paragraph), so these branches are covered by manual smoke §6.3 steps 0 and 1 only. Earlier reviewer rounds proposed adding these to the AppHeader test file — codex round-7 caught that as wrong unit.
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
- When `course.is_admin === false`, the `Delete run` button is NOT in the DOM (assert via `queryByText`/`queryByRole` returning null).
- When `course.is_admin === true`, the `Delete run` button IS in the DOM (regression guard).
- PATCH-title, PATCH-end-date, and `groups_enabled` toggle ARE in the DOM regardless of `course.is_admin` (locks the teacher-allowed PATCH semantics — see §3.1.6).

Extend `src/tests/RunDetailPage.publish.svelte.test.ts` (and/or `RunDetailPage.svelte.test.ts`):
- When `course.is_admin === false`: `button[data-action="publish"]`, `button[data-action="unpublish"]`, and the unpublish `InlineConfirm` are all NOT in the DOM. `[data-testid="status-badge"]` AND `[data-testid="version-label"]` ARE still in the DOM. (This assertion shape works for BOTH publish-bar wrap options in §3.2.4: whether the `.publish-bar` div is empty/removed or restructured into a sibling `.run-meta` is an implementation detail — the contract is about specific buttons absent and specific testid elements present.)
- When `course.is_admin === true`: Publish or Unpublish button IS in the DOM (whichever matches `run.is_published`); badge + version label IS in the DOM; today's interaction behavior unchanged.

Extend `src/tests/RunMiniProjectsTab.svelte.test.ts`:
- Existing tests pass `course={ ..., is_admin: true }`.
- **Modal Publish button** is visible REGARDLESS of `course.is_admin` (locks the §3.1.6 teacher-allowed MP publish — regression guard against accidentally hiding it). New tests MUST open the modal and scope assertions to within it; the existing test at `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts:185-189` asserts no row-level `button[data-action="publish"]` — that assertion stays true and is not in conflict, because the new tests target the modal Publish button, not a row affordance.
- When `course.is_admin === false` AND the row's MP is locked (fixture: `first_submitted_at: '2026-04-15T10:00:00Z'`), the force-confirm Delete affordance is NOT in the DOM.
- When `course.is_admin === true` AND the row's MP is locked, the force-confirm Delete affordance IS in the DOM.
- When `course.is_admin === false` AND the row's MP is NOT locked (fixture: `first_submitted_at: null`), the normal Delete button IS in the DOM (teacher-allowed via `require_run_admin_or_teacher`).
- When `course.is_admin === false` AND `!run.is_published`, the "Publish on Overview" link-button at `RunMiniProjectsTab.svelte:185` is NOT in the DOM; the surrounding "Run is not yet published" banner text IS in the DOM.
- When `course.is_admin === true` AND `!run.is_published`, both the banner AND the "Publish on Overview" link-button ARE in the DOM.
- When `course.is_admin === false` AND `run.is_published === true` AND `!runGroupsEnabled`, the "Enable on Overview" link-button at `RunMiniProjectsTab.svelte:170-175` is NOT in the DOM (groups toggle is hard-disabled on published runs and unpublish is admin-only); the surrounding "Mini-projects require groups." banner text IS in the DOM.
- When `course.is_admin === false` AND `!run.is_published` AND `!runGroupsEnabled`, the "Enable on Overview" link-button IS in the DOM (teacher CAN flip groups while unpublished).
- When `course.is_admin === true` AND `!runGroupsEnabled`, the "Enable on Overview" link-button IS in the DOM regardless of `run.is_published`.
- When `course.is_admin === false` AND `versionIsDisabled`, the "See Overview" link-button at `RunMiniProjectsTab.svelte:179` is NOT in the DOM; the surrounding "This run's course version is disabled." banner text IS in the DOM.
- When `course.is_admin === true` AND `versionIsDisabled`, the "See Overview" link-button IS in the DOM.
- `newDisabledTitle` tooltip is course-aware: for `(course.is_admin === false, run.is_published === true, !runGroupsEnabled)` it returns "...Ask a course admin to unpublish the run and enable groups." (not the unconditional "Enable groups on Overview" — that would mislead teachers).

New `src/tests/MiniProjectModal.teacher-gating.svelte.test.ts` (matches the existing split convention — `MiniProjectModal.publish.svelte.test.ts` and `MiniProjectModal.create-edit.svelte.test.ts` already exist; do NOT create a generic `MiniProjectModal.svelte.test.ts`. Verify split convention at impl time):
- Existing modal tests in the two existing files pass `course={ ..., is_admin: true }` to preserve today's behavior (no `is_admin: false` cases needed in those files — they cover different surfaces).
- New file `teacher-gating`:
  - When `course.is_admin === false` AND `!run.is_published`, the modal's "Open Overview to publish" link-button portion of the precondition bullet at line 216 is NOT in the DOM; the "Run must be published" text IS in the DOM.
  - When `course.is_admin === false` AND `pinnedVersion.is_disabled`, the modal's "Open Overview to re-enable it" link-button portion of the precondition bullet at line 222 is NOT in the DOM; the "This run's course version is disabled" text IS in the DOM.
  - When `course.is_admin === false` AND `!run.end_date`, the modal's "Open Overview to set it" link-button portion at line 201 IS in the DOM (teacher-editable; locks the §3.1.6 PATCH end_date allowance).
  - When `course.is_admin === true`, all three link-button portions ARE in the DOM (admin-precedence regression guard).

Extend `src/tests/RunTeachersTab.svelte.test.ts`:
- Existing tests pass `course={ ..., is_admin: true }`.
- When `course.is_admin === false`, the Add-teacher form and per-row Remove buttons are NOT in the DOM.
- When `course.is_admin === true`, both ARE in the DOM (regression guard).

New / extend `src/tests/RunGroupsTab.svelte.test.ts` (codex round-10 — verify file exists at impl time; create if not):
- When `groupsEnabled === false` AND `!runIsPublished` (regardless of `course.is_admin`): placeholder reads "Enable in Overview → Settings to manage groups."
- When `groupsEnabled === false` AND `runIsPublished === true` AND `course.is_admin === true`: placeholder reads "Unpublish in Overview before enabling groups."
- When `groupsEnabled === false` AND `runIsPublished === true` AND `course.is_admin === false`: placeholder reads "Ask a course admin to unpublish the run and enable groups."
- When `groupsEnabled === true`: existing group CRUD (Add / Rename / Delete) IS in the DOM regardless of `course.is_admin` (regression — these are teacher-allowed per `groups.py:20-23, 49-53, 67-71`).

Extend `src/tests/RunAssetsTab.svelte.test.ts` (RunAssetsTab already receives `course` and already gates referenced-asset force-delete — these are regression guards for the existing disabled+tooltip behavior, locking the §3.1.6 contract):
- When `course.is_admin === false` AND the user opens the referenced-asset confirm, the "Force delete" button at `RunAssetsTab.svelte:658-664, 804-811` IS in the DOM but `disabled` is true AND `title="Only course admins can force-delete a referenced asset."` (not absent — current code keeps it visible for discoverability).
- When `course.is_admin === true` AND the user opens the referenced-asset confirm and ticks "I understand", the "Force delete" button IS in the DOM, `disabled` is false, and `title` is empty.
- When `course.is_admin === false` AND the asset is unreferenced, the normal Delete button IS in the DOM and is enabled (teacher-allowed per `run_assets.py:309-311`).
- Upload, list, replace, and render-URL behavior is unchanged regardless of `course.is_admin`.

**No `App.svelte.test.ts` integration test.** No existing precedent for integration-testing `App.svelte` routing in jsdom. The `defaultLandingPath` helper unit tests cover the routing logic; AppHeader visibility on `/login` and during `session.loading` is NOT covered by `AppHeader.svelte.test.ts` (that conditional lives in `App.svelte`, not in AppHeader — codex round-7); manual smoke (§6.3 steps 0, 1, 7) confirms end-to-end.

### 6.3 Manual smoke walkthrough (the plan's final task)

0. Visit `/login` without auth → AppHeader is NOT visible.
1. Login as a course-admin-only user → AppHeader shows Authoring (active), no Teaching link; lands on `/courses`; brand href is `/courses`.
2. As the course-admin of some course (the user from step 1, or a different course-admin if needed), navigate to a run's `RunTeachersTab` and add the target email via the existing UI. The frontend POSTs `/api/runs/{rid}/teachers`, creates/updates the user, and the new `RunTeacher` row is in place. (Course admins can manage teachers on their own courses — `require_course_admin_for_run` allows it. No superuser session required.)
3. Log out, then log in as the target teacher user. `/me` returns `has_run_teacher: true` (and `has_course_admin: false` unless they're also an admin elsewhere). AppHeader shows Teaching (active for teacher-only users); brand href is `/teaching`.
4. Click Teaching → land on `/teaching` with pills, default Active, table populated.
5. Switch through each pill and verify row counts match pill counts and rows within each group appear in the documented sort order (e.g. for Active, leftmost end-date first).
6. Click a row → run-detail page; verify: (a) the header Publish and Unpublish buttons are GONE (course-admin-only); (b) Status badge and version label ARE still shown in the header (the `.publish-bar` div itself may be empty or restructured — only the lifecycle buttons must be absent); (c) Overview tab has NO `Delete run` button (course-admin-only); (d) Overview PATCH-title, PATCH-end-date, and `groups_enabled` toggle ARE present (teachers CAN edit run metadata; `groups_enabled` toggle is enabled iff `!run.is_published` — same as today); (e) MP tab — modal Publish button IS present (teachers CAN publish MPs per §3.1.6); locked-row force-delete affordance is GONE; non-locked Delete IS present; Edit IS present; "Publish on Overview" link is GONE; "Enable on Overview" link is GONE if `run.is_published`, present if `!run.is_published`; "See Overview" link in the version-disabled banner is GONE; (f) Teachers tab has NO add-form and NO Remove buttons; (g) Assets tab — open the referenced-asset confirm: "Force delete" button IS visible but DISABLED with tooltip "Only course admins can force-delete a referenced asset." (current code keeps the button visible for discoverability — not absent); non-force delete on unreferenced assets works normally; upload IS present; (h) Groups tab — if groups disabled AND run published, placeholder reads "Ask a course admin to unpublish the run and enable groups." (NOT "Enable in Overview → Settings"); if groups disabled AND run NOT published, placeholder reads the original "Enable in Overview → Settings..." (teacher can act); if groups enabled, Add/Rename/Delete CRUD works normally; Evaluations tab works normally; (i) breadcrumb shows `Teaching › {course.name} › {run.title}` with the `Teaching` link working — NO `/courses` link visible.
6b. As the teacher, view a run whose pinned version is disabled. The Authoring UI doesn't expose a "disable" toggle currently — set `course_versions.is_disabled = true` for the relevant `version.id` directly in the dev DB (`backend/.venv` → `sqlite3 backend/mathion.db "UPDATE course_versions SET is_disabled = 1 WHERE id = <vid>;"`). Verify the version-disabled banner renders and tooltips on disabled actions still appear. Restore with `is_disabled = 0` afterwards.
6c. As the teacher, view a run whose pinned version is in `created` state (locks the loader-mount Critical fix). The Authoring UI doesn't expose a "downgrade-to-draft" action; set `course_versions.state = 'created'` for the pinned version directly in the dev DB. Verify the run-detail page mounts successfully, the version dropdown shows that one version, and the blocks tab renders (no white screen). Restore `state = 'published'` afterwards.
7. Log in as a teacher-only user (no `CourseAdmin` rows): AppHeader shows Teaching only; `/` redirects to `/teaching`; brand href is `/teaching`.
8. To exercise the empty-state path: as the admin from step 2, REMOVE the teacher's `RunTeacher` row via the same `RunTeachersTab`. Log out (admin), log in as the teacher again. The teacher's flags now: `has_run_teacher: false` (assuming no other rows). AppHeader shows no nav links; `/teaching` direct-load still fetches `/api/teaching/runs` and gets `[]`, rendering the page-level empty state ("You're not assigned to any runs yet…").
9. Direct URL `/courses/:slug/runs/:rid` as a teacher → loads correctly with hidden admin actions.
10. Direct URL `/courses/:slug/runs/:rid` as a non-member → 403 "Access denied" via existing error path.
10b. Asset-serving smoke (locks §3.1.3a). Use a NON-disabled, NON-draft pinned version for this step (disabled-version embedded images 403 for everyone per §5.4; this step verifies the live path). As an admin, upload an asset to the pinned course version (existing admin Assets UI under `/courses/{slug}/version/{vid}/assets`); reference the asset via Markdown image syntax in the version `info_md` or in a block's `info_md`. Log out, log in as the teacher of a run pinned to that version, navigate to the run-detail page. Verify the rendered `info_html` `<img>` loads (HTTP 200, image visible — NO broken-image icon). Devtools Network panel: `GET /assets/{vid}/{filename}` returns 200, not 403.

11. Pinned-version-switch smoke (locks the IN-subquery filter behavior): as the course admin, create a new version v2 on a course you've assigned the teacher to. The admin UI does NOT expose a run-level re-pin control (verified — `PATCH /api/runs/{rid}` does not accept `version_id`), so re-pin directly in the dev DB: `sqlite3 backend/mathion.db "UPDATE runs SET version_id = <v2.id> WHERE id = <run.id>;"`. Log out, log in as the teacher, reload the run-detail page. Verify `GET /api/courses/{cid}/versions` returns v2 only — v1 should no longer appear in the response, and the version dropdown reflects v2.

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
- **Authoring UI warning when an admin pins a `created`-state (draft) version to a run** — §3.1.3 accepts that the teacher of such a run will see the author's working-draft `info_md`. A future authoring-side safeguard (modal warning at pin time: "This version is still in draft — teachers will see the working markdown") closes the symmetric UX gap. Out of scope for Slice A; revisit when authoring pin-time UX is touched.

## 12. Files touched (summary, for plan-sizing)

**Backend:**
- `backend/mathion/api/helpers.py` — add `has_run_teacher_on_course` AND `has_run_pinned_to_version`.
- `backend/mathion/api/courses.py` — extend `get_course_by_slug` gate (4-tier order).
- `backend/mathion/api/versions.py` — extend `list_versions` gate + pinned-versions-only subquery filter on teacher branch.
- `backend/mathion/api/blocks.py` — extend `list_blocks` gate using `has_run_pinned_to_version`.
- `backend/mathion/api/assets.py` — extend `serve_asset` gate (line 130-158) with a 4th branch using `has_run_pinned_to_version` (§3.1.3a). No other handler in this file changes; `upload_asset`, `list_assets`, `delete_asset` stay `require_course_admin`.
- `backend/mathion/api/auth.py` — add `_user_response_with_flags` private helper colocated with handlers; widen `get_profile` signature with `db: Session = Depends(get_db)` (keep existing `response_model=UserResponse` decorator — no change needed; the new flags become part of the schema via §3.1.4); wire helper into both `get_profile` and `api_verify_pin` (preserving the `{"user": ...}` dict wrap on `api_verify_pin` — that handler has NO `response_model` decorator, also no change needed). New imports: `from sqlalchemy import exists` (currently absent — `select` and `Session` are already imported at lines 2-3) and a new line `from mathion.models import CourseAdmin, RunTeacher` (currently the file imports only `from mathion.models_auth import User`; the new line is needed because CourseAdmin and RunTeacher live in `mathion.models`, not `models_auth`).
- `backend/mathion/schemas.py` — extend `UserResponse` with two `bool = False` defaults; add `TeachingRunRow` (no `model_config`).
- `backend/mathion/api/teaching.py` — new router file.
- `backend/mathion/main.py` — register `teaching_router` between `dashboard_router` (line 50) and the `@app.get("/health")` block (line 53), BEFORE the SPA catch-all (`main.py:66-71`).
- `backend/tests/test_teaching.py` — new test file (helper + endpoint + cascade-guard tests).
- `backend/tests/test_auth.py` — extend with `/me` flag tests, `api_verify_pin` shape regression, and PIN-verify role-flag test.

**Frontend:**
- `frontend/src/components/chrome/AppHeader.svelte` — new.
- `frontend/src/pages/teaching/TeacherRunListPage.svelte` — new.
- `frontend/src/lib/teaching.ts` — new.
- `frontend/src/lib/types.ts` — extend `User` type with `has_course_admin: boolean` + `has_run_teacher: boolean`. (`TeachingRunRow` interface is defined LOCALLY in `frontend/src/lib/teaching.ts` per §3.2.3 — same pattern as wire-module-local types elsewhere in this codebase.)
- `frontend/src/lib/router.svelte.ts` — add `defaultLandingPath(user)` helper.
- `frontend/src/App.svelte` — render `AppHeader`; update default-route `$effect` (keep auth-guard branch using existing local names `matched` / `matched.route.auth`); add `TeacherRunListPage` to component map.
- `frontend/src/routes.ts` — add `/teaching` route.
- `frontend/src/pages/runs/RunDetailPage.svelte` — thread `course` prop to three additional tabs (already passed to RunAssetsTab) AND to `MiniProjectModal` (via `RunMiniProjectsTab`); SPLIT the header `.publish-bar` at lines 310-336 so status badge (311-313) and version label (314-316) stay visible to all roles; wrap only Publish/Unpublish/InlineConfirm (lines 317-335) in `{#if course.is_admin}` (recommended: extract badge + label to a sibling `<div class="run-meta">` per §3.2.4); rewrite breadcrumbs at lines 304-307 to use `Teaching` root + drop the `Runs` segment for teachers (per §3.2.4 breadcrumb-fix).
- `frontend/src/components/runs/RunOverviewTab.svelte` — accept required `course: Course` prop; `{#if course.is_admin}` around `Delete run` button + confirm at lines 199-207 (publish/unpublish are in RunDetailPage header, NOT here).
- `frontend/src/components/runs/RunMiniProjectsTab.svelte` — accept required `course: Course` prop; pass `course` to `MiniProjectModal`; add `const isLocked = (mp) => mp.first_submitted_at !== null` helper; for locked MPs AND `!course.is_admin`, hide the force-confirm Delete affordance; wrap the "Publish on Overview" link-button at line 185 in `{#if course.is_admin}`. No MP-publish hide on the modal Publish button (teacher-allowed per §3.1.6).
- `frontend/src/components/runs/MiniProjectModal.svelte` — accept required `course: Course` prop; gate the link-rendering branches for the "Open Overview to publish" bullet (line 216) and "Open Overview to re-enable it" bullet (line 222) on `course.is_admin`. Keep the bullet text and the "Open Overview to set it" (end_date, line 201) link unconditional.
- `frontend/src/components/runs/RunTeachersTab.svelte` — accept required `course: Course` prop; `{#if course.is_admin}` around add-teacher form and per-row Remove.
- `frontend/src/components/runs/RunGroupsTab.svelte` — accept required `course: Course` AND `runIsPublished: boolean` props; rewrite the groups-disabled placeholder at lines 100-103 with a 3-branch text based on `runIsPublished` + `course.is_admin` (see §3.2.4). No changes to the groups-enabled CRUD section (Add/Rename/Delete are teacher-allowed at the backend).
- `frontend/src/tests/AppHeader.svelte.test.ts` — new.
- `frontend/src/tests/TeacherRunListPage.svelte.test.ts` — new.
- `frontend/src/tests/teaching.test.ts` — new (wire-module).
- `frontend/src/tests/router.test.ts` — extend with `defaultLandingPath` unit tests.
- `frontend/src/tests/RunOverviewTab.svelte.test.ts` — extend (8 `mountOverview()` call sites per rev-10 grep; update existing tests to pass stub `course={ ..., is_admin: true }`; add `is_admin: false` cases).
- `frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts` — extend (7 `mountTab()` call sites per rev-10 grep, SAME PROP UPDATES; this file ALSO mounts RunOverviewTab).
- `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` — extend (~22 mount sites per codex round-9 grep; extract a `mountMpTab(extra)` helper as part of this task to avoid touching every site). Add modal-Publish-visible-regardless-of-is_admin test (must open modal, scoped to within it so the existing global "no row publish button" assertion at lines 185-189 stays valid); add locked-row force-delete hide test (use `first_submitted_at: ISO-string` fixture for locked, `null` for unlocked); add "Publish on Overview" link-button hide test; add "Enable on Overview" link-button conditional test (visible iff `!run.is_published || course.is_admin`); add "See Overview" version-disabled-banner link-button hide test; add `newDisabledTitle` tooltip-message-aware-of-course-is_admin test.
- `frontend/src/tests/MiniProjectModal.teacher-gating.svelte.test.ts` — NEW (separate file matching the existing split convention; existing `MiniProjectModal.publish.svelte.test.ts` and `MiniProjectModal.create-edit.svelte.test.ts` are NOT extended) — add the four precondition-link tests for "Open Overview to publish" / "Open Overview to re-enable it" / "Open Overview to set it" (kept visible for teachers) / admin-precedence per §3.2.4.
- `frontend/src/tests/RunAssetsTab.svelte.test.ts` — extend with the 4 force-delete + non-force-delete regression tests per §6.2 RunAssetsTab block. RunAssetsTab already receives `course` and already gates force-delete on `!course.is_admin` (verified at `frontend/src/components/runs/RunAssetsTab.svelte:658-664, 804-811`) — these tests lock the existing behavior so the §3.1.6 contract isn't accidentally broken by future refactors.
- `frontend/src/tests/RunTeachersTab.svelte.test.ts` — extend (~12 mount sites per codex round-9 grep; inline mounts).
- `frontend/src/tests/RunGroupsTab.svelte.test.ts` — new or extend (verify at impl time) — add the 4 placeholder-text regression tests per §6.2 RunGroupsTab block.
- `frontend/src/tests/RunDetailPage.svelte.test.ts` — extend (indirect; RunDetailPage now passes `course` to three more tabs — verify integration).
- `frontend/src/tests/RunDetailPage.publish.svelte.test.ts` — extend (~5 mount sites, indirect).

(No `App.svelte.test.ts` extension — see §6.2 final paragraph.)

Plan-sized estimate: ~10-13 tasks with aggressive bundling, e.g.:
1. Backend: helpers (`has_run_teacher_on_course` + `has_run_pinned_to_version`) + 4 read-endpoint gate-opens (by-slug, versions w/ pinned-versions filter, blocks, assets) + cascade-guard tests + backend tests.
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
