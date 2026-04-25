# Phase 7a — Runs, Teachers, Groups

**Date:** 2026-04-25
**Status:** Approved for implementation planning
**Phase:** 7a (foundation for 7b mini-projects and 7c dashboards)
**Parent spec:** `docs/superpowers/specs/2026-04-19-mathion-platform-design.md` (sections 6, 7)

## Goal

Add **course runs** — time-bounded scheduled instances of a published course version — plus the supporting cohort infrastructure of **run teachers** and **groups**. This is the foundation for Phase 7b (mini-projects + submissions + evaluations) and Phase 7c (teacher dashboard + CSV export + bulk roster ops). Phase 7a ships standalone backend functionality: admins can create runs, assign teachers, manage rosters and groups, and publish/unpublish runs without any mini-project flow yet.

## Non-Goals

- Mini-projects, submissions, evaluations (Phase 7b)
- Teacher progress dashboard, CSV export, bulk roster ops UI (Phase 7c)
- Email delivery of notifications (Phase 9 — 7a writes rows to `notification_log` and stops)
- Student-facing run views (Phase 7c — students gain run-aware UI when there is run content to show)
- Frontend (any phase)

## Architecture

```
Course (existing)
└── CourseVersion (existing)
    ├── Block / Sequence / Item / Question / AssetReference (existing)
    └── Run (NEW)
        ├── RunTeacher (NEW)        run-scoped teacher assignments
        ├── Group (NEW)             only when groups_enabled
        └── RunStudent (NEW)        roster + group assignment
            └── (also reactivates/creates StudentEnrollment for run.version_id)
```

A run pins to a specific `version_id` at creation time (the newest published version of the course). Once `is_published=True`, both `version_id` and the existence of submissions become immutability anchors for run editing.

## Data Model

### `runs`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `version_id` | FK course_versions, ondelete RESTRICT | locked once `is_published=True` |
| `title` | str(200) NOT NULL | |
| `start_date` | date NOT NULL | |
| `end_date` | date NOT NULL | `end_date >= start_date` (CHECK) |
| `groups_enabled` | bool NOT NULL default False | locked once `is_published=True` |
| `is_published` | bool NOT NULL default False | controls student visibility |
| `created_by` | FK users, ondelete SET NULL | |
| `created_at` | timestamp tz | server_default now() |
| `updated_at` | timestamp tz | server_default now(), onupdate now() |

`version_id` uses `RESTRICT` (not CASCADE): you cannot delete a course version that has runs.

### `run_teachers`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `run_id` | FK runs, ondelete CASCADE | indexed |
| `user_id` | FK users, ondelete CASCADE | indexed |
| `created_at` | timestamp tz | |

UniqueConstraint(`run_id`, `user_id`) — `uq_run_teacher`.

### `groups`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `run_id` | FK runs, ondelete CASCADE | indexed |
| `name` | str(80) NOT NULL | |
| `created_at` | timestamp tz | |

UniqueConstraint(`run_id`, `name`) — `uq_group_run_name`.
App-level rule: 1-10 students per group, enforced on student-add and at publish-gate.

### `run_students`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `run_id` | FK runs, ondelete CASCADE | indexed |
| `user_id` | FK users, ondelete CASCADE | indexed |
| `group_id` | FK groups, ondelete SET NULL, **nullable** | indexed |
| `created_at` | timestamp tz | |
| `updated_at` | timestamp tz | onupdate now() |

UniqueConstraint(`run_id`, `user_id`) — `uq_run_student`. `group_id` nullable: pre-publish, students can sit in an "unassigned" pool. Publish-gate rejects if any unassigned remain when `groups_enabled=True`.

### Existing tables touched

- `student_enrollments` — when a user is added to a run, ensure an active StudentEnrollment row exists for `(user_id, run.version_id)` via the existing `_enroll_user` helper. This means run-students automatically gain access to the version's content.
- `notification_log` (Phase 9 — created here as part of 7a since email rows need a destination): `id`, `user_id`, `kind` (str), `payload` (JSON), `created_at`, `sent_at` nullable. 7a writes rows; Phase 9 sends and stamps `sent_at`.

## Lifecycle: dates + `is_published`

A run's *current state* is **derived**, not stored:

```
draft     = NOT is_published
upcoming  = is_published AND now < start_date
active    = is_published AND start_date <= now <= end_date
ended     = is_published AND now > end_date
```

There is no formal state machine. `is_published` is a single bool; admins flip it via dedicated `/publish` and `/unpublish` endpoints (matching the version-publish pattern).

### Editing rules

| Field | Pre-publish | Published |
|---|---|---|
| `title` | editable | editable |
| `start_date`, `end_date` | editable | editable, **unless** lowering `end_date` below `now` while submissions exist (Phase 7b hook) |
| `version_id` | implicit (newest published) | locked |
| `groups_enabled` | editable | locked |
| Roster, groups, teachers | editable | editable |

Roster/group/teacher operations are always allowed regardless of `is_published`. Lock-on-publish applies only to the `version_id` and `groups_enabled` columns.

### Publish-gate

`POST /api/runs/{rid}/publish` enforces:
1. At least one `RunTeacher` row exists for the run.
2. If `groups_enabled=True`, every `RunStudent` has a non-null `group_id`.
3. If `groups_enabled=True`, every `Group` has 1-10 students.

If any condition fails, return 409 with a list of violations. Otherwise `is_published := True`.

### Unpublish

`POST /api/runs/{rid}/unpublish` is course-admin-only (not teacher). It re-hides the run from students. No state-machine transitions; just flips `is_published` back to False.

### Delete

`DELETE /api/runs/{rid}` is course-admin-only and rejected if `is_published=True`. Admin must unpublish first. CASCADE deletes RunTeacher / Group / RunStudent rows. Does not delete StudentEnrollment rows (those persist as free-pace until manually removed).

## API Surface

All endpoints require an authenticated user. Authorization rules in the right column:

| Method | Path | Auth |
|---|---|---|
| POST | `/api/courses/{course_id}/runs` | course admin |
| GET | `/api/courses/{course_id}/runs` | course admin |
| GET | `/api/runs/{rid}` | course admin OR run teacher |
| PATCH | `/api/runs/{rid}` | course admin OR run teacher |
| DELETE | `/api/runs/{rid}` | course admin |
| POST | `/api/runs/{rid}/publish` | course admin |
| POST | `/api/runs/{rid}/unpublish` | course admin |
| POST | `/api/runs/{rid}/teachers` | course admin |
| GET | `/api/runs/{rid}/teachers` | course admin OR run teacher |
| DELETE | `/api/runs/{rid}/teachers/{user_id}` | course admin |
| POST | `/api/runs/{rid}/groups` | course admin OR run teacher |
| GET | `/api/runs/{rid}/groups` | course admin OR run teacher |
| PATCH | `/api/groups/{gid}` | course admin OR run teacher |
| DELETE | `/api/groups/{gid}` | course admin OR run teacher; 409 if non-empty |
| POST | `/api/runs/{rid}/students` | course admin OR run teacher |
| POST | `/api/runs/{rid}/students/batch` | course admin OR run teacher |
| GET | `/api/runs/{rid}/students` | course admin OR run teacher |
| PATCH | `/api/runs/{rid}/students/{user_id}` | course admin OR run teacher |
| DELETE | `/api/runs/{rid}/students/{user_id}` | course admin OR run teacher |

**Permission helper:** `require_run_admin_or_teacher(db, user, run_id)` — passes if user is a course admin of `run.course_id` OR has a `RunTeacher` row for `run_id` OR is superuser. Use everywhere except the `course-admin-only` rows above (those keep using `require_course_admin`).

### Request/response shapes (representative)

**Create run** — `POST /api/courses/{cid}/runs`:
```json
{ "title": "Spring 2026", "start_date": "2026-09-01", "end_date": "2026-12-15", "groups_enabled": true }
```
Response 201: full run object including `version_id` (resolved server-side to newest published version of the course; 409 if no published version exists).

**Patch run** — `PATCH /api/runs/{rid}`:
```json
{ "title": "...", "start_date": "...", "end_date": "...", "groups_enabled": true }
```
`version_id` is never accepted in input. `groups_enabled` is rejected (409) if `is_published=True`.

**Add teacher** — `POST /api/runs/{rid}/teachers`:
```json
{ "email": "teacher@example.com" }
```
Auto-creates user if absent (matches existing `_get_or_create_user`).

**Add student (single)** — `POST /api/runs/{rid}/students`:
```json
{ "email": "student@example.com", "group_id": 12 }
```
`group_id` optional. If `groups_enabled=True` but `group_id` is missing, student is added unassigned (legal pre-publish, blocked at publish-gate).

**Add students (batch)** — `POST /api/runs/{rid}/students/batch`:
```json
{ "rows": [
    {"name": "Alice Smith", "email": "alice@example.com", "group": "Team A"},
    {"name": "Bob Jones",   "email": "bob@example.com",   "group": "Team B"}
] }
```
Behavior:
- `group` is a name string. If a group with that name doesn't exist on the run, **auto-create** it.
- Per-row processing: errors on one row do not abort the batch.
- Response 207 Multi-Status with per-row result list:
```json
{ "results": [
    {"email": "alice@example.com", "status": "added", "group_id": 5},
    {"email": "bob@example.com",   "status": "error", "detail": "group capacity exceeded"}
] }
```

**Patch student (change group)** — `PATCH /api/runs/{rid}/students/{user_id}`:
```json
{ "group_id": 7 }
```
Use `null` to unassign.

## Roster Cascade

### On add

```python
def _enroll_user_in_run(db, user, run, group_id=None):
    # 1. Group capacity check (if group_id given)
    if group_id is not None:
        count = db.scalar(select(func.count()).where(RunStudent.group_id == group_id))
        if count >= 10:
            raise HTTPException(409, "Group capacity (10) reached")

    # 2. StudentEnrollment side — reuses existing _enroll_user behavior
    #    (deactivates other active enrollments on this course; creates/reactivates
    #    enrollment for run.version_id)
    _enroll_user(db, user, run.course_id, run.version)

    # 3. RunStudent — reactivate if exists, else create
    rs = db.execute(select(RunStudent).where(
        RunStudent.run_id == run.id, RunStudent.user_id == user.id
    )).scalar_one_or_none()
    if rs:
        rs.group_id = group_id
    else:
        db.add(RunStudent(run_id=run.id, user_id=user.id, group_id=group_id))

    # 4. Notification stub
    db.add(NotificationLogEntry(user_id=user.id, kind="run_enrolled",
                                payload={"run_id": run.id,
                                         "course_slug": run.version.course.slug,
                                         "title": run.title}))
```

### On remove

`DELETE /api/runs/{rid}/students/{user_id}` hard-deletes the RunStudent row. The StudentEnrollment side: deactivate iff the user has no other RunStudent rows on this course's runs (RunStudent has no `is_active` flag in 7a — rows are hard-deleted). This means a student who was *only* in this run loses content access; a student who is also in another run on the same course retains access. Free-pace-only enrollments are not affected by run removal because they have no RunStudent row.

### On group change

`PATCH /api/runs/{rid}/students/{user_id}` body `{"group_id": X}` — checks group capacity for X (rejects 409 if full), then sets the new `group_id`. `null` is allowed pre-publish.

## Notifications (stubs)

Phase 7a writes rows to `notification_log` for the following events. Phase 9 picks them up and sends via SMTP.

| `kind` | Trigger | Recipient |
|---|---|---|
| `run_enrolled` | student added to a run | the added student |
| `run_published` | admin publishes a run | every roster student |
| `run_teacher_assigned` | teacher added to a run | the added teacher |

Payload shape (JSON column): `{"run_id": int, "course_slug": str, "title": str, ...}`. Exact fields per `kind` documented in the schemas module.

## Error Handling

| Scenario | Status | Detail |
|---|---|---|
| No published version exists for course | 409 | "Course has no published version; runs require one" |
| Run delete while `is_published=True` | 409 | "Unpublish run before deleting" |
| Publish-gate fails | 409 | List of violations: missing teachers, unassigned students, group size violations |
| Group delete with students | 409 | "Group has students; reassign or remove first" |
| Group capacity (10) on add or move | 409 | "Group capacity reached" |
| Lower end_date below now while submissions exist | 409 | "Cannot shorten run while submissions exist" (Phase 7b hook returns False in 7a) |
| Add student to run on disabled version | 403 | "Run version is disabled" |
| Non-admin / non-teacher accessing run | 403 | "Run admin or teacher access required" |

## Testing Strategy

Test files (TDD, mirroring existing structure):

| File | Coverage |
|---|---|
| `tests/test_runs.py` | Run CRUD, version pinning, publish/unpublish, publish-gate, edit rules, delete-when-unpublished |
| `tests/test_run_teachers.py` | Add/list/remove teachers, permissions, auto-user-creation |
| `tests/test_groups.py` | Group CRUD, name uniqueness, capacity rule, delete-when-empty |
| `tests/test_run_roster.py` | Add/remove students, group changes, batch CSV-style endpoint, StudentEnrollment cascade, capacity enforcement |
| `tests/test_run_notifications.py` | `notification_log` rows written for the three kinds |

Use existing `admin_client` and `auth_client` fixtures (now independent per the recent conftest refactor). Add a `teacher_client` fixture that authenticates as a non-admin user assigned as RunTeacher on a specific run. Test count delta target: ~50-70 tests.

## Migration Strategy

One Alembic migration adding four tables (`runs`, `run_teachers`, `groups`, `run_students`) plus `notification_log`. SQLite-compatible (no constraint changes to existing tables, so no batch_alter_table needed). Tested locally on the project's SQLite dev database; designed to apply cleanly on Postgres.

## Open Questions / Deferred to 7b/7c

- **Bulk operations** (move multiple students between groups, bulk remove): deferred to 7c.
- **Student-facing run view** (`/api/courses/{slug}/my-runs`, `/api/runs/{rid}/my-view`): deferred to 7c, when there's mini-project content to display.
- **Run archive flag** (read-only after end_date passed): not in 7a. The derived `ended` state is sufficient for now; explicit archive flag added in 7c if dashboards need it.
- **Submission-existence check on end_date lowering**: 7a stubs the hook to always return False; 7b implements it.
- **Teacher invitation email content**: row written to `notification_log`, exact text decided in Phase 9 with other email templates.

## Implementation Sequence (preview for the plan)

1. Models + migration (Run, RunTeacher, Group, RunStudent, NotificationLogEntry)
2. Schemas (RunCreate, RunUpdate, RunResponse, etc.)
3. `_enroll_user_in_run` helper + permission helpers
4. Run CRUD endpoints (create, list, get, patch, delete)
5. Publish/unpublish endpoints with publish-gate
6. RunTeacher endpoints
7. Group endpoints
8. Roster endpoints (single add, list, patch, remove)
9. Batch enrollment endpoint
10. Notification log entries on the three triggers
11. Final regression sweep

Each step is its own commit with TDD red-green cycle.
