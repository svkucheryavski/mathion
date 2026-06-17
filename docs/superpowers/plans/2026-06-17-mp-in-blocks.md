# MP-in-Blocks Student Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the student-facing mini-project surface (block link + detail page) inside the existing course view, plus enforce the new roster invariant "≤1 active RunStudent per (course, user)" on add-student / batch-add / publish-run.

**Architecture:** Two NEW student GET endpoints synthesize all data for the discovery + detail UIs from existing models — no migration, no model changes. Constraint enforced at application layer in three write paths via two new helpers. Frontend adds a wire module + 4 components + 1 page + extends 6 existing files.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic v2 (backend); Svelte 5 runes + TypeScript strict + mount/unmount/flushSync test pattern (frontend); vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-06-15-mp-in-blocks-design.md` (rev 14). Tasks cite spec sections for code shapes rather than duplicating them — read the spec ALONGSIDE each task.

**Branch:** `mp-in-blocks` (created from `main`).

**Critical conventions (from CLAUDE.md + memory):**
- Always invoke pytest / python / alembic via `backend/.venv` — never bare.
- Svelte tests use `mount/unmount/flushSync` from `svelte`, NEVER `@testing-library/svelte`.
- Date fixtures: use `NEAR_DEADLINE_ISO` / `FAR_DEADLINE_ISO` from `backend/tests/conftest.py:30-38` — no hardcoded ISO strings.
- After each task: stop, run tests, commit. Strict per-task review loop (memory).

---

## Phase A — Backend foundation: schemas + helpers + constraint enforcement

Frontend types mirror backend Pydantic, so backend lands first.

### Task A1: Add `from __future__ import annotations` + extend `BulkRosterErrorCode` + add `error_code` to `RunStudentBatchResultRow`

**Files:**
- Modify: `backend/mathion/schemas.py:1` (add `from __future__ import annotations`)
- Modify: `backend/mathion/schemas.py:478-482` (extend `RunStudentBatchResultRow`)
- Modify: `backend/mathion/schemas.py:500-504` (extend `BulkRosterErrorCode`)

**Spec refs:** §2 schemas entry, H1 changelog, I2 changelog.

- [ ] Read `backend/mathion/schemas.py:1-10` to confirm current import header has no `from __future__ import annotations`.

- [ ] Add `from __future__ import annotations` as the FIRST non-comment line at the top of `backend/mathion/schemas.py` (resolves the forward-reference for the next change).

- [ ] Extend `BulkRosterErrorCode` at `schemas.py:500-504`:

```python
BulkRosterErrorCode = Literal[
    "not_in_run",
    "capacity_reached",
    "internal_error",
    "student_already_active_in_course",
]
```

- [ ] Add the `error_code` field to `RunStudentBatchResultRow` at `schemas.py:478-482`:

```python
class RunStudentBatchResultRow(BaseModel):
    email: str
    status: Literal["added", "error"]
    group_id: int | None = None
    detail: str | None = None
    error_code: BulkRosterErrorCode | None = None
```

- [ ] Verify the import works:

```bash
cd backend && .venv/bin/python -c "import mathion.schemas"
```

Expected: prints nothing, exit 0. If `NameError`, revert and re-check the field ordering.

- [ ] Commit:

```bash
git add backend/mathion/schemas.py
git commit -m "feat(backend): extend BulkRosterErrorCode + add error_code to RunStudentBatchResultRow

- Adds 'student_already_active_in_course' literal for the new 409 surface.
- Adds 'from __future__ import annotations' so RunStudentBatchResultRow can
  reference BulkRosterErrorCode (defined later in the same module)."
```

---

### Task A2: New constraint helpers + constant in `helpers.py`

**Files:**
- Modify: `backend/mathion/api/helpers.py` (add imports + constant + two helpers; spec §3.3)
- Create: `backend/tests/test_active_constraint_helpers.py` (~80 lines, ~6 tests)

**Spec refs:** §3.3 helper definitions (full code block), N2+P1 imports, M3 signature note.

- [ ] Read `backend/mathion/api/helpers.py:1-9` to confirm: `from sqlalchemy import select` is already at line 7; no model imports yet.

- [ ] Add imports just below the existing sqlalchemy import (preserve grouping):

```python
from mathion.models import RunStudent, Run, CourseVersion
```

- [ ] Add module-level constant near top of file (after imports):

```python
STUDENT_ALREADY_ACTIVE_ERROR_CODE = "student_already_active_in_course"
```

- [ ] Add the two helpers — full code per spec §3.3 (~lines 421-490 of spec). Use the LOCKED M3 signature:

```python
def find_student_active_conflicts(
    db: Session,
    user_id: int,
    *,
    course_id: int,
    exclude_run_id: int,
) -> list[tuple[int, str]]:
    """Return [(conflicting_run_id, conflicting_run_title), ...] for OTHER
    published runs of the same course where the user is an active RunStudent.
    BOTH course_id and exclude_run_id are required keyword args."""
    rows = db.execute(
        select(RunStudent.run_id, Run.title)
        .join(Run, Run.id == RunStudent.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunStudent.user_id == user_id,
            CourseVersion.course_id == course_id,
            Run.is_published == True,
            Run.id != exclude_run_id,
        )
    ).all()
    return [(row[0], row[1]) for row in rows]


def make_already_active_409_body(
    conflicts: list[dict], *, summary_override: str | None = None
) -> dict:
    """Build the JSONResponse content for the 409. Top-level `error_code` so
    ApiError in frontend/src/lib/api.ts:46 picks it up."""
    if summary_override is not None:
        detail = summary_override
    elif conflicts:
        c = conflicts[0]
        detail = (
            f"Student is already active in run \"{c['run_title']}\" of the same course."
        )
    else:
        detail = "Student is already active in another run of the same course."
    return {
        "detail": detail,
        "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
        "conflicts": conflicts,
    }
```

- [ ] Write failing tests at `backend/tests/test_active_constraint_helpers.py`:

```python
from sqlalchemy.orm import Session
from mathion.api.helpers import (
    STUDENT_ALREADY_ACTIVE_ERROR_CODE,
    find_student_active_conflicts,
    make_already_active_409_body,
)


def test_constant_value():
    assert STUDENT_ALREADY_ACTIVE_ERROR_CODE == "student_already_active_in_course"


def test_find_returns_empty_when_no_conflicts(db: Session, seed_run_with_published_mp):
    run, mp, student = seed_run_with_published_mp()
    conflicts = find_student_active_conflicts(
        db, student.id, course_id=run.version.course_id, exclude_run_id=run.id
    )
    assert conflicts == []


def test_find_returns_other_runs_when_conflict(db, seed_two_published_runs_same_course):
    run_a, run_b, student = seed_two_published_runs_same_course()
    # student is active on both runs (legacy data)
    conflicts = find_student_active_conflicts(
        db, student.id, course_id=run_a.version.course_id, exclude_run_id=run_a.id
    )
    assert len(conflicts) == 1
    assert conflicts[0][0] == run_b.id
    assert conflicts[0][1] == run_b.title


def test_find_excludes_unpublished_runs(db, seed_run_and_draft_run_same_course):
    run, draft_run, student = seed_run_and_draft_run_same_course()
    # student is in both but draft is unpublished
    conflicts = find_student_active_conflicts(
        db, student.id, course_id=run.version.course_id, exclude_run_id=run.id
    )
    assert conflicts == []


def test_make_body_with_conflicts_uses_first():
    body = make_already_active_409_body(
        [{"run_id": 7, "run_title": "Spring 26"}]
    )
    assert body["error_code"] == "student_already_active_in_course"
    assert "Spring 26" in body["detail"]
    assert body["conflicts"] == [{"run_id": 7, "run_title": "Spring 26"}]


def test_make_body_summary_override():
    body = make_already_active_409_body(
        [{"run_id": 1, "run_title": "X"}],
        summary_override="3 students cannot be added — already active in other runs of this course.",
    )
    assert body["detail"].startswith("3 students cannot be added")
```

For now, declare the new fixtures `seed_two_published_runs_same_course` and `seed_run_and_draft_run_same_course` as TODOs; they get implemented in Task A4/A5 alongside the constraint tests, but this test file uses the smaller, helper-only versions inline. **Update fixture wiring**: if these fixtures don't exist yet in `conftest.py`, mark these two helper-find tests as `@pytest.mark.skip(reason="awaits A4/A5 conftest seed fixtures")` for this task; they re-enable in A4.

- [ ] Run helper tests:

```bash
backend/.venv/bin/pytest backend/tests/test_active_constraint_helpers.py -v
```

Expected: 3 tests pass (constant + two `make_body` tests). 2 skipped pending fixtures.

- [ ] Commit:

```bash
git add backend/mathion/api/helpers.py backend/tests/test_active_constraint_helpers.py
git commit -m "feat(backend): add find_student_active_conflicts + make_already_active_409_body helpers

Constants + helpers for the new 'student already active in another run of
the same course' 409 path. Helper signature locked to required keyword
args (course_id, exclude_run_id) so callers pass course_id once before
the publish_run loop and avoid per-call lazy SELECT on run.version."
```

---

### Task A3: Promote `_make_published_mp` to conftest as `seed_run_with_published_mp`

**Files:**
- Modify: `backend/tests/conftest.py` (add `seed_run_with_published_mp` factory fixture)
- Modify: `backend/tests/test_submissions.py` (delete local helper, import from conftest)

**Spec refs:** §2 conftest entry + C26 changelog.

- [ ] Read `backend/tests/test_submissions.py:7-22` to see the current `_make_published_mp` shape.

- [ ] Move `_make_published_mp` to `backend/tests/conftest.py` as a `pytest.fixture` returning a factory:

```python
@pytest.fixture
def seed_run_with_published_mp(db, make_user):
    """Factory: returns (run, mini_project, student_user). Promoted from
    test_submissions.py per C26 (rev 2). Sets group_id on the student so
    submission paths work without extra setup."""

    def _factory(**overrides):
        # ... move the body of _make_published_mp here, accepting overrides
        # for is_published, deadlines, etc. Return (run, mp, student).
        ...

    return _factory
```

Preserve all existing keyword-arg defaults from the original helper.

- [ ] Delete the local helper at `backend/tests/test_submissions.py:7-22`. Replace call sites with the fixture parameter:

```python
def test_X(seed_run_with_published_mp, db):
    run, mp, student = seed_run_with_published_mp()
    ...
```

- [ ] Run the affected test file:

```bash
backend/.venv/bin/pytest backend/tests/test_submissions.py -v
```

Expected: all existing tests pass — promotion must not change behavior.

- [ ] Commit:

```bash
git add backend/tests/conftest.py backend/tests/test_submissions.py
git commit -m "test(conftest): promote _make_published_mp → seed_run_with_published_mp fixture

Factory now available to multiple test files (new constraint tests + new
student mini-projects tests). test_submissions.py updated to consume the
fixture; no behavior change."
```

---

### Task A4: Constraint check in `POST /api/runs/{rid}/students` (add_student) + tests

**Files:**
- Modify: `backend/mathion/api/run_roster.py` (insert check between `:64-69` group_id validation and `:71` `get_or_create_user` call)
- Create: `backend/tests/test_run_roster_active_constraint.py` (~80 lines, ~6 tests for this endpoint)
- Modify: `backend/tests/conftest.py` (add `seed_two_published_runs_same_course` fixture)

**Spec refs:** §3.3 add_student row, L2/M6 ordering note, L4/M2 side-effects block.

- [ ] Read `backend/mathion/api/run_roster.py:46-100` to confirm: `require_run_admin_or_teacher` at line ~50, `is_published` check at 59-63, `group_id` validation at 64-69, `get_or_create_user` at line 71.

- [ ] Add `seed_two_published_runs_same_course` fixture in `conftest.py`:

```python
@pytest.fixture
def seed_two_published_runs_same_course(db, make_user, make_published_run):
    """Factory: (run_a, run_b, student) where student is active RunStudent
    on BOTH runs (legacy duplicate scenario). Used by constraint tests."""

    def _factory():
        course, version = ...  # one course, one version
        run_a = make_published_run(version=version, title="Spring 26")
        run_b = make_published_run(version=version, title="Summer 26")
        student = make_user(email="s@x.com")
        db.add(RunStudent(run_id=run_a.id, user_id=student.id))
        db.add(RunStudent(run_id=run_b.id, user_id=student.id))
        db.commit()
        return run_a, run_b, student

    return _factory
```

Add a parallel fixture `seed_run_and_draft_run_same_course` for the unpublished-run exclusion test from Task A2.

- [ ] Re-enable the two skipped tests in `backend/tests/test_active_constraint_helpers.py` (remove the `@pytest.mark.skip`). Run them; they must pass now:

```bash
backend/.venv/bin/pytest backend/tests/test_active_constraint_helpers.py -v
```

Expected: all 5 tests pass.

- [ ] Write the failing add_student test at `backend/tests/test_run_roster_active_constraint.py`:

```python
def test_add_student_409_when_user_already_active_on_other_published_run(
    client, admin_session, seed_two_published_runs_same_course, db
):
    run_a, run_b, student = seed_two_published_runs_same_course()
    # Try to add `student` to run_a — but they're already on run_b (same course)
    response = client.post(
        f"/api/runs/{run_a.id}/students",
        json={"email": student.email},
        headers=admin_session,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "student_already_active_in_course"  # top-level, NOT nested in detail
    assert "Summer 26" in body["detail"]
    assert body["conflicts"] == [
        {
            "user_id": student.id,
            "email": student.email,
            "run_id": run_b.id,
            "run_title": "Summer 26",
        }
    ]


def test_add_student_409_after_group_id_validation(
    client, admin_session, seed_two_published_runs_same_course, db
):
    """L2/M6: input-validation 400 takes precedence over business 409."""
    run_a, run_b, student = seed_two_published_runs_same_course()
    response = client.post(
        f"/api/runs/{run_a.id}/students",
        json={"email": student.email, "group_id": 999999},  # invalid group
        headers=admin_session,
    )
    assert response.status_code == 400  # bad group_id wins, NOT 409
```

Add four more tests: 200 happy when no conflict, 200 when conflict is on a draft run, 200 when conflict is on a different course, "no User created on 409" (assert User row count unchanged via `db.scalar(select(func.count(User.id)).where(User.email == ...))`).

- [ ] Run failing tests:

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_active_constraint.py::test_add_student_409_when_user_already_active_on_other_published_run -v
```

Expected: FAIL (endpoint doesn't enforce yet).

- [ ] Implement the check in `add_student` (insert AFTER `run_roster.py:64-69` group validation, BEFORE `get_or_create_user`):

```python
# L2/M6: check runs AFTER input-validation, BEFORE side effects.
# Resolve user only — do NOT create. If user doesn't exist, no conflict
# possible (no RunStudent row to compare against).
existing_user = db.execute(
    select(User).where(User.email == data.email)
).scalar_one_or_none()
if existing_user is not None:
    conflicts = find_student_active_conflicts(
        db,
        existing_user.id,
        course_id=run.version.course_id,
        exclude_run_id=run.id,
    )
    if conflicts:
        conflict_dicts = [
            {
                "user_id": existing_user.id,
                "email": existing_user.email,
                "run_id": rid_other,
                "run_title": title,
            }
            for (rid_other, title) in conflicts
        ]
        detail = (
            f"{data.email} is already active in run "
            f"\"{conflict_dicts[0]['run_title']}\" of the same course."
        )
        return JSONResponse(
            status_code=409,
            content=make_already_active_409_body(
                conflict_dicts, summary_override=detail
            ),
        )
```

Add `from fastapi.responses import JSONResponse`, `from sqlalchemy import select`, and helper imports at the top if not present.

- [ ] Run tests:

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_active_constraint.py -v
```

Expected: all add_student tests pass.

- [ ] Commit:

```bash
git add backend/mathion/api/run_roster.py backend/tests/test_run_roster_active_constraint.py backend/tests/conftest.py backend/tests/test_active_constraint_helpers.py
git commit -m "feat(backend): enforce one-active-RunStudent-per-course invariant on add_student

POST /api/runs/{rid}/students returns 409 when target user already has an
active RunStudent row on another published run of the same course. Check
runs after existing group_id validation (so 400 wins over 409) and before
get_or_create_user (so no User row is created on rejected add)."
```

---

### Task A5: Constraint check in `POST /api/runs/{rid}/students/batch` + tests

**Files:**
- Modify: `backend/mathion/api/run_roster.py` (insert check inside the per-row loop at `:155-189`)
- Modify: `backend/tests/test_run_roster_active_constraint.py` (+3 batch tests)

**Spec refs:** §3.3 batch row + F1/M5 changelog (precise insertion point).

- [ ] Read `backend/mathion/api/run_roster.py:131-189` (existing batch endpoint). Locate the per-row loop and `get_or_create_user(db, row.email)` call (~line 160). M5 mandates the check goes IMMEDIATELY after this call, BEFORE the `target.full_name` mutation, Group lookup/creation, and `enroll_user_in_run`.

- [ ] Write failing batch tests at `backend/tests/test_run_roster_active_constraint.py`:

```python
def test_batch_partial_success_with_one_conflict_row(
    client, admin_session, seed_two_published_runs_same_course, make_user, db
):
    run_a, run_b, student_on_b = seed_two_published_runs_same_course()
    fresh_student = make_user(email="fresh@x.com")
    response = client.post(
        f"/api/runs/{run_a.id}/students/batch",
        json={
            "rows": [
                {"email": fresh_student.email},
                {"email": student_on_b.email},
                {"email": "new-user@x.com"},
            ]
        },
        headers=admin_session,
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["status"] == "added"
    assert results[1]["status"] == "error"
    assert results[1]["error_code"] == "student_already_active_in_course"
    assert results[2]["status"] == "added"


def test_batch_conflict_does_not_overwrite_full_name(
    client, admin_session, seed_two_published_runs_same_course, db
):
    """M5: rejected rows MUST NOT mutate target.full_name."""
    run_a, _, student = seed_two_published_runs_same_course()
    original_name = student.full_name  # may be None
    client.post(
        f"/api/runs/{run_a.id}/students/batch",
        json={"rows": [{"email": student.email, "name": "Other Name"}]},
        headers=admin_session,
    )
    db.refresh(student)
    assert student.full_name == original_name  # unchanged
```

Add one more: all-conflict batch (3 rows, all conflict → 0 added, 3 error_code rows).

- [ ] Run failing tests:

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_active_constraint.py::test_batch_partial_success_with_one_conflict_row -v
```

Expected: FAIL.

- [ ] Resolve `course_id` ONCE before the per-row loop (paste just before the loop):

```python
course_id = run.version.course_id
```

- [ ] Insert the conflict check IMMEDIATELY after `target = get_or_create_user(db, row.email)` and BEFORE any other mutation:

```python
conflicts = find_student_active_conflicts(
    db, target.id, course_id=course_id, exclude_run_id=run.id
)
if conflicts:
    results.append({
        "email": row.email,
        "status": "error",
        "detail": f"Already active in '{conflicts[0][1]}'",
        "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
    })
    continue
```

Import `STUDENT_ALREADY_ACTIVE_ERROR_CODE` from `mathion.api.helpers`.

- [ ] Run tests:

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_active_constraint.py -v
```

Expected: all add_student + batch tests pass.

- [ ] Commit:

```bash
git add backend/mathion/api/run_roster.py backend/tests/test_run_roster_active_constraint.py
git commit -m "feat(backend): enforce active-run invariant on /students/batch endpoint

Per-row conflict check inserted immediately after get_or_create_user and
before any side effects (full_name mutation, Group creation, enroll call),
so rejected rows don't mutate target user state. Adds 'error_code' to the
result row when student is already active on another published run of the
same course."
```

---

### Task A6: Constraint check in `POST /api/runs/{rid}/publish` (publish_run) + tests

**Files:**
- Modify: `backend/mathion/api/runs.py` (insert check before `is_published=True` flip)
- Modify: `backend/tests/test_run_roster_active_constraint.py` (+5 publish tests)

**Spec refs:** §3.3 publish_run row (L3 query + M3/M4 signature), G3 grouping by run_id, G8 singular/plural copy.

- [ ] Read `backend/mathion/api/runs.py:172-219` (publish_run). Locate the existing teacher-count + group-size checks. Confirm publish_run does NOT currently load students — the new query is additive. Confirm function signature uses `run_id: int` parameter (M4).

- [ ] Add `User` import to `runs.py` if not present:

```python
from mathion.models_auth import User
```

- [ ] Write failing publish tests:

```python
def test_publish_run_409_with_aggregate_conflicts(
    client, admin_session, db, make_published_run, make_user
):
    # Course X: run_a (about to publish) has 3 students. 2 are also on run_b (published, same course).
    course, version = ...
    run_a = make_published_run(version=version, is_published=False, title="Fall 26")
    run_b = make_published_run(version=version, is_published=True, title="Spring 26")
    s1 = make_user(email="s1@x.com")
    s2 = make_user(email="s2@x.com")
    s3 = make_user(email="s3@x.com")
    # All 3 on run_a roster
    for s in (s1, s2, s3):
        db.add(RunStudent(run_id=run_a.id, user_id=s.id))
    # s1 + s2 also on run_b (the conflict)
    db.add(RunStudent(run_id=run_b.id, user_id=s1.id))
    db.add(RunStudent(run_id=run_b.id, user_id=s2.id))
    db.commit()

    response = client.post(f"/api/runs/{run_a.id}/publish", headers=admin_session)

    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "student_already_active_in_course"
    assert len(body["conflicts"]) == 2
    assert {c["user_id"] for c in body["conflicts"]} == {s1.id, s2.id}
    # run_a still unpublished
    db.refresh(run_a)
    assert run_a.is_published is False


def test_publish_run_409_singular_copy_for_n_eq_1(client, admin_session, db, ...):
    # 1 conflicting student → "1 student cannot be added — already active in another run of this course."
    ...
    assert body["detail"] == "1 student cannot be added — already active in another run of this course."


def test_publish_run_409_plural_copy_for_n_geq_2(client, admin_session, db, ...):
    # 3 conflicting students → "3 students cannot be added — already active in other runs of this course."
    ...
    assert body["detail"] == "3 students cannot be added — already active in other runs of this course."


def test_publish_run_200_when_no_conflicts(client, admin_session, db, ...):
    ...
    assert response.status_code == 200
    db.refresh(run)
    assert run.is_published is True


def test_publish_run_self_skip(client, admin_session, db, ...):
    """exclude_run_id=run_id ensures the run being published isn't counted against itself."""
    # student is in run_a's roster only; run_a is unpublished. Publishing run_a must succeed.
    ...
    assert response.status_code == 200
```

- [ ] Run failing tests:

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_active_constraint.py::test_publish_run_409_with_aggregate_conflicts -v
```

Expected: FAIL.

- [ ] Insert the check in `publish_run` between existing checks and the `is_published=True` flip:

```python
# Resolve course_id ONCE (avoids per-call lazy SELECT inside helper).
course_id = run.version.course_id

# JOINed query to avoid N+1; fetch (user_id, email) per RunStudent.
student_rows = db.execute(
    select(RunStudent.user_id, User.email)
    .join(User, User.id == RunStudent.user_id)
    .where(RunStudent.run_id == run_id)
).all()

aggregate: list[dict] = []
for uid, user_email in student_rows:
    conflicts = find_student_active_conflicts(
        db, uid, course_id=course_id, exclude_run_id=run_id
    )
    for (rid_other, title) in conflicts:
        aggregate.append({
            "user_id": uid,
            "email": user_email,
            "run_id": rid_other,
            "run_title": title,
        })

if aggregate:
    n = len({c["user_id"] for c in aggregate})
    if n == 1:
        summary = "1 student cannot be added — already active in another run of this course."
    else:
        summary = f"{n} students cannot be added — already active in other runs of this course."
    return JSONResponse(
        status_code=409,
        content=make_already_active_409_body(aggregate, summary_override=summary),
    )
```

Add imports at top: `from fastapi.responses import JSONResponse`, `from sqlalchemy import select`, helpers.

- [ ] Run all constraint tests:

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_active_constraint.py backend/tests/test_active_constraint_helpers.py -v
```

Expected: all pass.

- [ ] Run the full backend suite to check for regressions:

```bash
backend/.venv/bin/pytest backend/tests/ -x
```

Expected: all green.

- [ ] Commit:

```bash
git add backend/mathion/api/runs.py backend/tests/test_run_roster_active_constraint.py
git commit -m "feat(backend): enforce active-run invariant on publish_run + aggregate 409 body

publish_run loads all RunStudents (JOINed with User.email), collects all
cross-run conflicts in a single aggregate, returns 409 with the full list
(not first-conflict-wins) so admins can fix in one pass. Detail copy
explicit singular/plural based on unique student count."
```

---

## Phase B — Backend: new student endpoints

### Task B1: Create `student_mini_projects.py` skeleton + `_resolve_student_run` helper + tests

**Files:**
- Create: `backend/mathion/api/student_mini_projects.py` (~50 lines for this task — file grows in B2/B3)
- Create: `backend/tests/test_student_mini_projects.py` (~120 lines for resolver tests)

**Spec refs:** §4.1 resolver SQL + D2 inactive enrollment divergence + D6 2+ defensive-pick test.

- [ ] Read `backend/mathion/api/student.py:216-244` for the `/my-version` precedent shape — `_resolve_student_run` mirrors its 404/403 boundaries but resolves a `Run` (not a version).

- [ ] Write failing tests:

```python
import pytest
from mathion.api.student_mini_projects import _resolve_student_run


def test_resolve_returns_run_when_student_active(db, seed_run_with_published_mp):
    run, _, student = seed_run_with_published_mp()
    result = _resolve_student_run(db, student, run.version.course.slug)
    assert result.id == run.id


def test_resolve_raises_404_when_course_slug_missing(db, make_user):
    student = make_user()
    with pytest.raises(HTTPException) as exc_info:
        _resolve_student_run(db, student, "nope-no-such-slug")
    assert exc_info.value.status_code == 404


def test_resolve_raises_403_when_student_has_enrollment_but_no_run_student(
    db, make_user, seed_published_course_version_with_enrollment_only
):
    """User has StudentEnrollment on version, but no RunStudent on any run."""
    student, course = seed_published_course_version_with_enrollment_only()
    with pytest.raises(HTTPException) as exc_info:
        _resolve_student_run(db, student, course.slug)
    assert exc_info.value.status_code == 403


def test_resolve_raises_404_when_no_enrollment(db, make_user, seed_published_course):
    student = make_user()
    course = seed_published_course()
    with pytest.raises(HTTPException) as exc_info:
        _resolve_student_run(db, student, course.slug)
    assert exc_info.value.status_code == 404


def test_resolve_defensive_pick_most_recent_when_two_active_runs(
    db, seed_two_published_runs_same_course, caplog
):
    """D6: legacy data may have 2 active RunStudent rows; pick most-recent
    by Run.start_date DESC and emit warning."""
    run_a, run_b, student = seed_two_published_runs_same_course()
    # Assume seed sets run_b.start_date > run_a.start_date
    with caplog.at_level("WARNING"):
        result = _resolve_student_run(db, student, run_a.version.course.slug)
    assert result.id == run_b.id  # newer wins
    assert any("multiple active" in rec.message.lower() for rec in caplog.records)
```

- [ ] Run failing tests:

```bash
backend/.venv/bin/pytest backend/tests/test_student_mini_projects.py -v
```

Expected: ImportError (file doesn't exist).

- [ ] Create `backend/mathion/api/student_mini_projects.py` skeleton with the resolver per spec §4.1:

```python
"""Student-facing mini-project discovery + detail endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.dependencies import get_current_user, get_db
from mathion.models import Course, CourseVersion, Run, RunStudent
from mathion.models_auth import StudentEnrollment, User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["student-mini-projects"])


def _resolve_student_run(db: Session, user: User, course_slug: str) -> Run:
    """Resolve the student's active Run for this course slug.

    - 404 if course slug doesn't exist OR user has no StudentEnrollment on
      any version of this course.
    - 403 if user has a StudentEnrollment but no active RunStudent on any
      published run of the course.

    D2: also requires StudentEnrollment.is_active == True (intentional
    divergence from /my-version, which lacks this filter — inactive
    enrollments must NOT see MPs).

    D6: if 2+ active RunStudent rows exist for the same user+course (legacy
    data), pick by Run.start_date DESC and emit a warning.
    """
    course = db.execute(
        select(Course).where(Course.slug == course_slug)
    ).scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    enrolled_versions = db.execute(
        select(CourseVersion.id)
        .join(StudentEnrollment, StudentEnrollment.version_id == CourseVersion.id)
        .where(
            CourseVersion.course_id == course.id,
            CourseVersion.is_disabled == False,
            StudentEnrollment.user_id == user.id,
            StudentEnrollment.is_active == True,
        )
    ).scalars().all()
    if not enrolled_versions:
        raise HTTPException(status_code=404, detail="Not enrolled in this course")

    runs = db.execute(
        select(Run)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .join(RunStudent, RunStudent.run_id == Run.id)
        .where(
            CourseVersion.course_id == course.id,
            Run.is_published == True,
            RunStudent.user_id == user.id,
        )
        .order_by(Run.start_date.desc())
    ).scalars().all()
    if not runs:
        raise HTTPException(
            status_code=403, detail="No active run for this course"
        )
    if len(runs) > 1:
        logger.warning(
            "Multiple active RunStudent rows for user=%s course_slug=%s "
            "(legacy data); picking most recent by start_date.",
            user.id, course_slug,
        )
    return runs[0]
```

- [ ] Add the missing fixtures (`seed_published_course_version_with_enrollment_only`, `seed_published_course`) to `conftest.py`. Adjust the existing `seed_two_published_runs_same_course` so `run_b.start_date > run_a.start_date` for the D6 test.

- [ ] Run tests:

```bash
backend/.venv/bin/pytest backend/tests/test_student_mini_projects.py -v
```

Expected: all 5 resolver tests pass.

- [ ] Commit:

```bash
git add backend/mathion/api/student_mini_projects.py backend/tests/test_student_mini_projects.py backend/tests/conftest.py
git commit -m "feat(backend): add student_mini_projects router + _resolve_student_run helper

Resolver mirrors /my-version 404 semantics but resolves a Run (not a
version), gates on StudentEnrollment.is_active=True (D2), and defensively
picks most-recent-by-start_date with a warning when legacy data shows
multiple active RunStudent rows."
```

---

### Task B2: List endpoint `GET /api/courses/{slug}/mini-projects` + tests

**Files:**
- Modify: `backend/mathion/api/student_mini_projects.py` (add list endpoint + `latest_status` helper)
- Modify: `backend/mathion/schemas.py` (add `StudentMiniProjectListItem`)
- Modify: `backend/tests/test_student_mini_projects.py` (+ ~10 list tests)

**Spec refs:** §3.1 response shape + latest_status derivation; C28 cross-course positive test.

- [ ] Add `StudentMiniProjectListItem` to `schemas.py` (full shape per spec §3.1, ~lines 264-282 of spec).

- [ ] Write failing list tests:

```python
def test_list_200_empty_when_no_mps(client, student_session, seed_run_no_mps):
    course = seed_run_no_mps()
    response = client.get(
        f"/api/courses/{course.slug}/mini-projects", headers=student_session
    )
    assert response.status_code == 200
    assert response.json() == []


def test_list_returns_pending_group_assignment_when_no_group(
    client, student_session, seed_run_with_published_mp_no_group
):
    course, mp = seed_run_with_published_mp_no_group()
    response = client.get(f"/api/courses/{course.slug}/mini-projects", headers=student_session)
    assert response.status_code == 200
    assert response.json() == [{
        "mp_id": mp.id,
        "block_id": mp.block_id,
        "block_slug": mp.block.slug,
        "block_order": mp.block.order,
        "block_title": mp.block.title,
        "hard_deadline": None,
        "soft_deadline": None,
        "resubmission_deadline": None,
        "latest_status": "pending_group_assignment",
    }]


def test_list_returns_not_submitted_when_grouped_no_submission(...): ...
def test_list_returns_awaiting_evaluation_when_submission_no_eval(...): ...
def test_list_returns_eval_result_status(...): ...  # all 4 result values

def test_list_sorted_by_block_order_asc(...): ...

def test_list_401_when_no_session(client, seed_run_with_published_mp):
    run, _, _ = seed_run_with_published_mp()
    response = client.get(f"/api/courses/{run.version.course.slug}/mini-projects")
    assert response.status_code == 401


def test_list_403_when_no_active_run(...): ...
def test_list_404_when_course_slug_missing(...): ...

def test_list_cross_course_isolation(
    client, student_session, seed_student_in_two_courses
):
    """C28: student in course X and Y returns only X's MPs."""
    course_x, course_y, ... = seed_student_in_two_courses()
    response = client.get(f"/api/courses/{course_x.slug}/mini-projects", headers=student_session)
    # only X's MP ids appear
    assert all(item["mp_id"] in expected_x_mp_ids for item in response.json())
```

- [ ] Run failing tests:

```bash
backend/.venv/bin/pytest backend/tests/test_student_mini_projects.py::test_list_200_empty_when_no_mps -v
```

Expected: 404 (endpoint not registered yet — that's fine for now, we'll know when it works).

- [ ] Implement the list endpoint in `student_mini_projects.py`:

```python
@router.get(
    "/api/courses/{slug}/mini-projects",
    response_model=list[StudentMiniProjectListItem],
)
def list_student_mini_projects(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[StudentMiniProjectListItem]:
    run = _resolve_student_run(db, user, slug)

    mps = db.execute(
        select(MiniProject)
        .join(Block, Block.id == MiniProject.block_id)
        .where(
            MiniProject.run_id == run.id,
            MiniProject.is_published == True,
        )
        .order_by(Block.order.asc())
    ).scalars().all()

    items: list[StudentMiniProjectListItem] = []
    for mp in mps:
        items.append(_serialize_list_item(db, run, mp, user))
    return items


def _serialize_list_item(db, run, mp, user) -> StudentMiniProjectListItem:
    group = get_submitter_group(db, run.id, user.id)
    status = _derive_latest_status(db, mp, group)
    return StudentMiniProjectListItem(
        mp_id=mp.id,
        block_id=mp.block.id,
        block_slug=mp.block.slug,
        block_order=mp.block.order,
        block_title=mp.block.title,
        hard_deadline=mp.hard_deadline,
        soft_deadline=mp.soft_deadline,
        resubmission_deadline=mp.resubmission_deadline,
        latest_status=status,
    )


def _derive_latest_status(db, mp, group) -> str:
    """Per spec §3.1 derivation rules."""
    if group is None:
        return "pending_group_assignment"
    latest_sub = db.execute(
        select(Submission)
        .where(Submission.mini_project_id == mp.id, Submission.group_id == group.id)
        .order_by(Submission.submission_number.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest_sub is None:
        return "not_submitted"
    eval_row = db.execute(
        select(Evaluation).where(Evaluation.submission_id == latest_sub.id)
    ).scalar_one_or_none()
    if eval_row is None:
        return "awaiting_evaluation"
    return eval_row.result  # 'rejected' | 'major_revision' | 'minor_revision' | 'accepted'
```

Add the missing imports (`MiniProject`, `Block`, `Submission`, `Evaluation`, `get_submitter_group`, `StudentMiniProjectListItem`).

- [ ] Run list tests:

```bash
backend/.venv/bin/pytest backend/tests/test_student_mini_projects.py -v
```

Expected: all list tests pass.

- [ ] Commit:

```bash
git add backend/mathion/api/student_mini_projects.py backend/mathion/schemas.py backend/tests/test_student_mini_projects.py backend/tests/conftest.py
git commit -m "feat(backend): add GET /api/courses/{slug}/mini-projects list endpoint

Returns one row per published MP for the student's active run, sorted by
block.order ASC, each with a derived latest_status from the 7-value enum.
Handles ungrouped (pending_group_assignment), awaiting_evaluation, and all
evaluation result values."
```

---

### Task B3: Detail endpoint `GET /api/courses/{slug}/blocks/{block_slug}/mini-project` + tests

**Files:**
- Modify: `backend/mathion/api/student_mini_projects.py` (+detail endpoint, +`_resolve_block`, +`_display_name`, +`can_submit` ladder)
- Modify: `backend/mathion/schemas.py` (add `StudentMiniProjectDetail`, `StudentGroupSummary`, `StudentGroupMember`, `StudentSubmissionHistoryEntry`, `StudentSubmissionHistoryEvaluation`)
- Modify: `backend/tests/test_student_mini_projects.py` (+ ~15 detail tests)

**Spec refs:** §3.2 (response shape, fallback rule, 7-step `can_submit` ladder, 8-step read ordering) + §4.2 (block resolver, IDOR test).

- [ ] Add all detail schemas to `schemas.py` per spec §3.2 (~lines 309-363 of spec) — careful with field ordering and the `_display_name`-fed `str` (not `str | None`) for full_name fields.

- [ ] Add `_display_name(user)` helper per spec §3.2 (`split('@')[0]` fallback for email local-part).

- [ ] Add `_resolve_block(db, run, block_slug)` per spec §4.2:

```python
def _resolve_block(db: Session, run: Run, block_slug: str) -> Block:
    block = db.execute(
        select(Block).where(
            Block.version_id == run.version_id,
            Block.slug == block_slug,
        )
    ).scalar_one_or_none()
    if block is None:
        raise HTTPException(status_code=404, detail="Block not found")
    return block
```

- [ ] Write failing detail tests (~15 cases):

```python
def test_detail_200_with_grouped_can_submit_true(...): ...
def test_detail_200_with_ungrouped_returns_group_none(...): ...
def test_detail_can_submit_ladder_step_1_mp_not_visible(...): ...
def test_detail_can_submit_ladder_step_2_pending_group_assignment(...): ...
def test_detail_can_submit_ladder_step_3_group_disabled(...): ...
def test_detail_can_submit_ladder_step_4_already_accepted(...): ...
def test_detail_can_submit_ladder_step_5_awaiting_evaluation(...): ...
def test_detail_can_submit_ladder_step_6_hard_deadline_passed(...): ...
def test_detail_can_submit_ladder_step_7_resubmission_deadline_passed(...): ...
def test_detail_full_name_fallback_to_email_local_part(...): ...
def test_detail_history_desc_by_submission_number(...): ...
def test_detail_404_when_block_slug_missing_on_version(...): ...
def test_detail_404_when_mp_not_published(...): ...

def test_detail_idor_cross_version_block_slug_returns_404(
    client, student_session, seed_two_versions_same_block_slug
):
    """C4: same block slug on a different version of the same course must 404,
    not return the other version's MP."""
    course, version_a, version_b, block_a, block_b, run_a, student = seed_two_versions_same_block_slug()
    # student is on run_a (version_a). Try to fetch block_b (slug equal to block_a, but on version_b).
    response = client.get(
        f"/api/courses/{course.slug}/blocks/{block_b.slug}/mini-project",
        headers=student_session,
    )
    assert response.status_code == 404


def test_detail_uses_NEAR_FAR_deadlines_not_hardcoded(...):
    """C17: deadline-related tests use conftest constants."""
    from tests.conftest import NEAR_DEADLINE_ISO, FAR_DEADLINE_ISO
    ...  # parameterize with these
```

- [ ] Run failing tests:

```bash
backend/.venv/bin/pytest backend/tests/test_student_mini_projects.py -v
```

Expected: detail tests fail (endpoint not implemented).

- [ ] Implement the detail endpoint per spec §3.2 8-step read ordering. Use `_display_name` for all `*_full_name` fields; build the Pydantic instances with names pre-composed. Implement the 7-step `can_submit` ladder verbatim from spec §3.2 (~lines 386-407).

- [ ] Run detail tests:

```bash
backend/.venv/bin/pytest backend/tests/test_student_mini_projects.py -v
```

Expected: all pass.

- [ ] Commit:

```bash
git add backend/mathion/api/student_mini_projects.py backend/mathion/schemas.py backend/tests/test_student_mini_projects.py backend/tests/conftest.py
git commit -m "feat(backend): add GET /api/courses/{slug}/blocks/{block_slug}/mini-project endpoint

Detail endpoint synthesizes assignment HTML, group context (with disabled
flag), submission history (DESC), latest_status, and can_submit + reason
code in one round-trip. Mirrors POST /submissions enforcement via the
7-step can_submit ladder. Version-scoped block lookup prevents IDOR."
```

---

### Task B4: Register router in `main.py` + integration smoke test

**Files:**
- Modify: `backend/mathion/main.py` (+1 include line)

**Spec refs:** §2 main.py entry.

- [ ] Read `backend/mathion/main.py` to confirm router-include conventions (look at how other routers are imported / included).

- [ ] Add the import + include for the new router:

```python
from mathion.api.student_mini_projects import router as student_mini_projects_router
...
app.include_router(student_mini_projects_router)
```

Match the import/include placement of the closest student-facing router (e.g. `student.py`).

- [ ] Run the full backend suite:

```bash
backend/.venv/bin/pytest backend/tests/ -x
```

Expected: all green, including all new endpoints.

- [ ] Commit:

```bash
git add backend/mathion/main.py
git commit -m "feat(backend): register student_mini_projects router in main.py"
```

---

## Phase C — Frontend foundation: types, ApiError, wire module

### Task C1: Extend `ApiError` with `body: unknown`

**Files:**
- Modify: `frontend/src/lib/api.ts` (extend `ApiError` constructor + parse logic)
- Modify: `frontend/src/lib/api.test.ts` if it exists; otherwise create `frontend/src/tests/api.test.ts`

**Spec refs:** §2 api.ts entry + F3 + G4 + H3 changelog.

- [ ] Read `frontend/src/lib/api.ts:1-80` (current `ApiError` shape + non-2xx parse path).

- [ ] Write failing tests:

```typescript
import { describe, it, expect } from 'vitest';
import { ApiError } from '../lib/api';

describe('ApiError.body', () => {
  it('exposes parsed JSON body on non-2xx', () => {
    const err = new ApiError(409, 'X', 'err_x', { conflicts: [{ run_id: 1 }] });
    expect(err.body).toEqual({ conflicts: [{ run_id: 1 }] });
  });

  it('exposes body = undefined when constructed without body', () => {
    const err = new ApiError(0, 'network');
    expect(err.body).toBeUndefined();
  });

  // Integration test: 409 response with JSON body populates ApiError.body
  it('api.post() throws ApiError with body populated from response JSON', async () => {
    // mock fetch returning 409 with { detail, error_code, conflicts }
    // assert thrown error has .body containing conflicts
  });

  it('api.post() throws ApiError with body=undefined when response is not JSON', async () => {
    // mock fetch returning 500 with HTML error page (text/html)
    // assert thrown error has .body === undefined (parse failure silent)
  });
});
```

- [ ] Run failing tests:

```bash
cd frontend && pnpm vitest run src/tests/api.test.ts
```

Expected: FAIL (no `body` field).

- [ ] Extend the `ApiError` class:

```typescript
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly displayMessage: string,
    public readonly errorCode?: string,
    public readonly body?: unknown,
  ) {
    super(displayMessage);
  }
}
```

- [ ] In the non-2xx parse block (`api.ts:46` area), wrap the `await res.json()` call so a parse failure yields `undefined` for `body`:

```typescript
let parsedBody: unknown = undefined;
try {
  parsedBody = await res.json();
} catch {
  // non-JSON response (HTML error page, truncation) — body stays undefined.
}
const detail = (parsedBody as { detail?: string })?.detail ?? defaultDetail;
const errorCode = (parsedBody as { error_code?: string })?.error_code;
throw new ApiError(res.status, detail, errorCode, parsedBody);
```

- [ ] Run tests:

```bash
cd frontend && pnpm vitest run src/tests/api.test.ts
```

Expected: all pass.

- [ ] Run svelte-check to catch any type-mirror breakage:

```bash
cd frontend && pnpm svelte-check
```

Expected: no errors.

- [ ] Commit:

```bash
git add frontend/src/lib/api.ts frontend/src/tests/api.test.ts
git commit -m "feat(frontend): extend ApiError with body: unknown carrier

Populated from await res.json() on non-2xx; undefined on parse failure.
Callers must narrow at access sites under strict TS — see PublishConflicts
narrowing pattern in PublishConflictsModal."
```

---

### Task C2: Add types to `types.ts` + `REASON_LABELS` to (not yet existing) `studentMiniProjects.ts`

**Files:**
- Modify: `frontend/src/lib/types.ts` (+ student MP types, `PublishConflict`, extend `BulkRosterErrorCode`, add `error_code?` to `RunStudentBatchResultRow`)
- Create: `frontend/src/lib/studentMiniProjects.ts` skeleton with `REASON_LABELS` + `CanSubmitReason` (full wire module comes in C3)

**Spec refs:** §2 types.ts entry (I1+I2) + §3.2 `REASON_LABELS` + label organization in `types.ts:326-336`.

- [ ] Read `frontend/src/lib/types.ts:300-360` to confirm domain organization. `BulkRosterErrorCode` is at `:333-337`; `RunStudentBatchResultRow` is at `:326-336`.

- [ ] Add the new student-MP types (mirror backend Pydantic per spec §3.1 + §3.2) — place under a new `// ---- Mini-projects (student) ----` heading near other mini-project types. Snake_case field names matching backend.

- [ ] Add `PublishConflict` near `BulkRosterErrorCode` (under `// ---- Run management ----`):

```typescript
export type PublishConflict = {
  user_id: number;
  email: string;
  run_id: number;
  run_title: string;
};
```

- [ ] Extend `BulkRosterErrorCode`:

```typescript
export type BulkRosterErrorCode =
  | 'not_in_run'
  | 'capacity_reached'
  | 'internal_error'
  | 'student_already_active_in_course';
```

- [ ] Add `error_code` to `RunStudentBatchResultRow`:

```typescript
export type RunStudentBatchResultRow = {
  email: string;
  status: 'added' | 'error';
  group_id?: number | null;
  detail?: string | null;
  error_code?: BulkRosterErrorCode | null;
};
```

- [ ] Create `frontend/src/lib/studentMiniProjects.ts` with just the labels for now:

```typescript
export const REASON_LABELS = {
  mp_not_visible: 'This mini-project is no longer available.',
  pending_group_assignment: "Your teacher will assign you to a group soon. You'll be able to submit then.",
  group_disabled: 'Your group is disabled. Contact your teacher.',
  already_accepted: 'Your project has been accepted — no further submission needed.',
  awaiting_evaluation: 'Your previous submission is awaiting evaluation.',
  hard_deadline_passed: 'The submission deadline has passed.',
  resubmission_deadline_passed: 'The resubmission deadline has passed.',
} as const;

export type CanSubmitReason = keyof typeof REASON_LABELS;
```

- [ ] Run svelte-check (must pass with no errors):

```bash
cd frontend && pnpm svelte-check
```

- [ ] Commit:

```bash
git add frontend/src/lib/types.ts frontend/src/lib/studentMiniProjects.ts
git commit -m "feat(frontend): add student MP types + PublishConflict + extend BulkRosterErrorCode

Mirrors backend Pydantic schemas. PublishConflict shape is uniform across
add_student, batch, and publish_run 409 paths so a single typed handler
covers all 3. REASON_LABELS is the single source of truth for can_submit
reason copy."
```

---

### Task C3: Wire module — `fetchListSwallow403`, `fetchDetail`, `submit`, `rewriteExternalLinks` + tests

**Files:**
- Modify: `frontend/src/lib/studentMiniProjects.ts` (add full wire module ~180 lines)
- Create: `frontend/src/tests/studentMiniProjects.test.ts` (~12 tests)

**Spec refs:** §7 fetchListSwallow403 + §3.2 fetchDetail behaviors + F8/L1/M7 rewriteExternalLinks + D5 test cases.

- [ ] Write failing tests first (~12 cases): list 200/403/network/AbortError, detail 401→emitUnauthorized/403/404/network, submit happy/409/4xx, rewriteExternalLinks all link types (http/https/protocol-relative/mailto/tel/asset).

```typescript
// Example skeleton:
import { mount, unmount } from 'svelte';
import { describe, it, expect, vi } from 'vitest';
import {
  fetchListSwallow403,
  fetchDetail,
  submit,
  rewriteExternalLinks,
} from '../lib/studentMiniProjects';
import { ApiError } from '../lib/api';

describe('fetchListSwallow403', () => {
  it('returns map of block_id → item on 200', async () => { ... });
  it('returns {} on 403 (no emitUnauthorized)', async () => { ... });
  it('throws on 401', async () => { ... });
  it('throws on 500', async () => { ... });
  it('propagates AbortError', async () => { ... });
});

describe('fetchDetail', () => {
  it('builds correct URL with encodeURIComponent on both slugs', async () => { ... });
  it('calls emitUnauthorized on 401', async () => { ... });
  it('throws ApiError on 403', async () => { ... });
  it('throws ApiError on 404', async () => { ... });
  it('throws ApiError on network failure', async () => { ... });
});

describe('rewriteExternalLinks', () => {
  it('adds target=_blank rel=noopener noreferrer to https links', () => {
    const div = document.createElement('div');
    div.innerHTML = '<a href="https://example.com">x</a>';
    rewriteExternalLinks(div);
    const a = div.querySelector('a')!;
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
  });

  it('leaves /api/runs/... asset links unchanged', () => { ... });
  it('leaves mailto: links unchanged', () => { ... });
  it('leaves tel: links unchanged', () => { ... });
  it('rewrites protocol-relative // links', () => { ... });
});
```

- [ ] Run failing tests:

```bash
cd frontend && pnpm vitest run src/tests/studentMiniProjects.test.ts
```

Expected: most fail (functions not exported yet).

- [ ] Implement the wire module — full bodies per spec §7 + §6 step 4 + spec wire section. Include the `rewriteExternalLinks(container: HTMLElement)` helper that iterates `container.querySelectorAll('a')` and applies the `target`/`rel` policy.

- [ ] Run tests:

```bash
cd frontend && pnpm vitest run src/tests/studentMiniProjects.test.ts
```

Expected: all 12 pass.

- [ ] Commit:

```bash
git add frontend/src/lib/studentMiniProjects.ts frontend/src/tests/studentMiniProjects.test.ts
git commit -m "feat(frontend): wire module for student mini-project endpoints + link rewriter

fetchListSwallow403 returns {} on 403 so loadCourse can't be aborted by a
student who has no active run. fetchDetail propagates 401 via
emitUnauthorized. submit handles 201/409/4xx per state machine.
rewriteExternalLinks applies target/rel policy to external <a>s only."
```

---

## Phase D — Frontend UI components

### Task D1: `StatusPill.svelte` component + tests

**Files:**
- Create: `frontend/src/components/course/StatusPill.svelte` (~50 lines)
- Create: `frontend/src/tests/StatusPill.svelte.test.ts` (~5 tests)

**Spec refs:** §5 StatusPill + C14 (non-color leading token) + 7-value enum.

- [ ] Write failing tests for all 7 status values, the leading-text token, and the `aria-label` policy (none on the pill per D3).

- [ ] Implement the component with `$props()` typed `{ status: CanSubmitReason | 'not_submitted' | 'awaiting_evaluation' | 'rejected' | 'major_revision' | 'minor_revision' | 'accepted' | 'pending_group_assignment' }` — single source of truth for label + class + leading glyph token.

- [ ] Run tests + commit.

---

### Task D2: `MiniProjectLink.svelte` component + tests

**Files:**
- Create: `frontend/src/components/course/MiniProjectLink.svelte` (~80 lines)
- Create: `frontend/src/tests/MiniProjectLink.svelte.test.ts` (~5 tests)

**Spec refs:** §5 MiniProjectLink + C10 (encodeURIComponent on hrefs) + I3 ungrouped link UX.

- [ ] Write failing tests: href encoding, status pill embedded, "Mini-project: {block_title}" copy, aria-label on the `<a>` element (not on pill).

- [ ] Implement per spec §5. Props `{ courseSlug: string; item: StudentMiniProjectListItem }`. Renders `<li><a href={encoded}>Mini-project: {item.block_title} <StatusPill status={item.latest_status} /></a></li>`.

- [ ] Run tests + commit.

---

### Task D3: Modify `BlockGroup.svelte` to render `MiniProjectLink` + tests

**Files:**
- Modify: `frontend/src/components/course/BlockGroup.svelte:19-23` (insertion point: after sequences)
- Create: `frontend/src/tests/BlockGroup.svelte.test.ts` (~5 tests — new file)

**Spec refs:** §5 BlockGroup section + C22 (test file doesn't exist yet, create it).

- [ ] Read `frontend/src/components/course/BlockGroup.svelte` current shape.

- [ ] Write failing tests (per spec §8 5-test plan): sequences-only renders no MP, sequences+MP renders MP after sequences (DOM-order assertion), MP-only renders just MP, prop omitted → no MP ever, `mpByBlockId[blockId]` uses `String(block.id)` key.

- [ ] Add new optional prop `mpByBlockId?: Record<string, StudentMiniProjectListItem>`; render `<MiniProjectLink>` as a `<li>` after the existing sequences `<li>`s when `mpByBlockId?.[String(block.id)]` exists. Pass `courseSlug` prop down.

- [ ] Run tests + commit.

---

### Task D4: `PublishConflictsModal.svelte` component + tests (4 tests, I4 dedupe)

**Files:**
- Create: `frontend/src/components/runs/PublishConflictsModal.svelte` (~150 lines)
- Create: `frontend/src/tests/PublishConflictsModal.svelte.test.ts` (~120 lines, 4 tests)

**Spec refs:** §3.3 modal section (G3/I4/J2/K2) + §8 modal tests.

- [ ] Write failing tests (4 tests per spec §8): 1-conflict singular copy, N-same-run-id grouping, N-multi-run-id grouping, I4 dedupe (same `user_id` different `run_id` → heading "1 student").

- [ ] Implement the modal — pure presentation, no `ApiError` import. Props `{ open, conflicts, onClose }`. Use `studentCount = new Set(conflicts.map(c => c.user_id)).size` for heading. Branch the 3 layouts per spec §3.3.

- [ ] Run tests + commit.

---

### Task D5: `MiniProjectDetailPage.svelte` — page skeleton + assignment + group context + history

**Files:**
- Create: `frontend/src/pages/MiniProjectDetailPage.svelte` (~250 lines for this task — submit flow + state machine come in D6)
- Create: `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` (~250 lines for 7 fixture scenarios)

**Spec refs:** §6 step 1-5 + §3.2 response shape + L1/M1/M7/N4 assignment-html plumbing.

- [ ] Write failing tests: 7 fixture scenarios per spec §8 (empty grouped can_submit=true, pending evaluation, accepted, rejected, minor revision required, pending group assignment D4, late submission).

- [ ] Implement page skeleton with:
  - `let courseSlug = $props()` etc. (route params)
  - `let data: StudentMiniProjectDetail | null = $state(null);`
  - `let assignmentEl: HTMLDivElement | undefined = $state();` (N4 — `$state()` per `RunTeachersTab.svelte:20` precedent)
  - `$effect(() => { /* fetchDetail */ })` for initial load (with AbortController, slug-aware stale-write guard, error handling per spec §6 step 7)
  - Header (block title + deadline pills)
  - Assignment: `<div class="assignment-html" data-testid="assignment-html" bind:this={assignmentEl}>{@html data.assignment_html}</div>` (M1)
  - Effect for link rewriting: `$effect(() => { if (!assignmentEl) return; void data.assignment_html; rewriteExternalLinks(assignmentEl); })` (M7)
  - Group context (3 branches per spec §6 step 3)
  - Submission history (DESC, ungrouped → absent)

- [ ] Run tests + commit.

---

### Task D6: `MiniProjectDetailPage.svelte` — submit flow + state machine + visibility refresh + external-link tests

**Files:**
- Modify: `frontend/src/pages/MiniProjectDetailPage.svelte` (+submit section + state machine)
- Modify: `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` (+ ~12 tests for submit flow + state machine + refetch)

**Spec refs:** §6 step 4-7 + state machine (C15) + visibilitychange (F19 jsdom seam) + N3 refetch external-link test + F6/J2-equivalent slug guard + aria-live (C16).

- [ ] Write failing tests: 7 submit-flow tests + 4 state-machine + 4 misc (visibilitychange sequence, slug-guard for cross-course write-back, sr-only `aria-live` identity, external-link rewrite mount + refetch).

The external-link rewrite tests use `data-testid="assignment-html"` per M1, and the refetch test uses the visibilitychange path per N3+P2 (await initial fetch first to satisfy single-flight guard).

- [ ] Implement the submit section (state machine `idle | submitting | error | success`), POST `/api/mini-projects/{mp_id}/submissions` via `submit` from wire module, fetchDetail refetch on 201, write-back to `currentCourse.value.miniProjectsByBlockId[String(data.block_id)]` only when `currentCourse.value?.slug === courseSlug` (F6 slug guard).

- [ ] Add the visibilitychange listener (`$effect` with cleanup, single-flight guard) per spec §6 step 6.

- [ ] Add `<div class="sr-only" aria-live="polite" data-testid="sr-live">` for status announcer per C16.

- [ ] Run tests + commit.

---

### Task D7: Routes + componentMap registration

**Files:**
- Modify: `frontend/src/routes.ts` (add `/courses/:courseSlug/blocks/:blockSlug/mini-project` → `MiniProjectDetailPage` with `auth: true`)
- Modify: `frontend/src/App.svelte:21-32` (register `MiniProjectDetailPage` in `componentMap`)

**Spec refs:** §2 routes + App.svelte entries + C8 changelog.

- [ ] Add route entry. Run `pnpm svelte-check` to confirm wiring.

- [ ] Register in componentMap (alphabetical-ish between existing entries).

- [ ] Smoke: `pnpm vitest run` and `pnpm svelte-check` both green.

- [ ] Commit.

---

## Phase E — Frontend integration with course view + admin publish flow + roster import

### Task E1: Extend `currentCourse` store with `miniProjectsByBlockId`

**Files:**
- Modify: `frontend/src/stores/currentCourse.svelte.ts:36-73` (3-element Promise.all + new snapshot field)

**Spec refs:** §7 + C9 changelog + F16 5xx behavior.

- [ ] Write failing test extending the store's existing tests: snapshot has `miniProjectsByBlockId` after load; `loadCourse` triggers `fetchListSwallow403`; stale-write guard works with 3 elements.

- [ ] Modify `loadCourse` to call `Promise.all([content, state, fetchListSwallow403(slug, controller.signal)])` and write `miniProjectsByBlockId` into the snapshot.

- [ ] Run tests + commit.

---

### Task E2: `CourseView.svelte` — pass `mpByBlockId` down to `BlockGroup`

**Files:**
- Modify: `frontend/src/pages/CourseView.svelte` (~+5 lines)

- [ ] Pass `mpByBlockId={currentCourse.value?.miniProjectsByBlockId}` and `courseSlug={currentCourse.value?.slug}` down to each `<BlockGroup>`.

- [ ] Run existing CourseView tests (must remain green).

- [ ] Commit.

---

### Task E3: `RunDetailPage.svelte` — wire `PublishConflictsModal` into `doPublish`

**Files:**
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte:243-254` (replace error path inside `doPublish`)
- Modify: `frontend/src/tests/RunDetailPage.svelte.test.ts` if it exists (+ ~3 tests for publish 409 flow)

**Spec refs:** §2 RunDetailPage entry + §3.3 modal section (H3/I1/J2/K3 narrowing + open guard + toast kind).

- [ ] Write failing tests: 409 with conflicts opens modal; 409 with empty/missing conflicts (malformed body) toasts `pushToast(e.displayMessage, 'error')` and does NOT open modal; non-409 takes existing toast path.

- [ ] Import `PublishConflictsModal` + `PublishConflict` type. Replace the existing `pushToast(e.displayMessage)` error path with the narrowing + open-guard pattern from spec §3.3:

```typescript
if (e instanceof ApiError && e.errorCode === 'student_already_active_in_course') {
  const conflicts = (e.body as { conflicts?: PublishConflict[] } | undefined)?.conflicts ?? [];
  if (conflicts.length === 0) {
    pushToast(e.displayMessage, 'error');
    return;
  }
  // open modal with conflicts
  publishConflicts = conflicts;
  modalOpen = true;
} else {
  pushToast(e.displayMessage, 'error');
}
```

- [ ] Mount `<PublishConflictsModal bind:open={modalOpen} conflicts={publishConflicts} onClose={() => modalOpen = false} />` somewhere in the page.

- [ ] Run tests + svelte-check + commit.

---

### Task E4: Extend `RosterImportModal` for `student_already_active_in_course` error code

**Files:**
- Modify: `frontend/src/components/runs/RosterImportModal.svelte` (handle new error code)
- Modify or Create: `frontend/src/tests/RosterImportModal.svelte.test.ts` (+ ~2 tests)

**Spec refs:** §2 RosterImportModal entry + F15 changelog.

- [ ] Read the existing modal to find the error-row rendering path.

- [ ] Write tests: when a result row has `error_code === 'student_already_active_in_course'`, the row's `detail` text renders verbatim with the "Already active in 'X'" copy from the backend.

- [ ] Implement (probably just a typed case clause in an existing switch or a small UI tweak).

- [ ] Run tests + commit.

---

## Phase F — Acceptance

### Task F1: Run full backend + frontend test suites

- [ ] Backend: `backend/.venv/bin/pytest backend/tests/` — all green.
- [ ] Frontend: `cd frontend && pnpm vitest run && pnpm svelte-check` — all green.
- [ ] If any flake: fix root cause, do NOT re-run blindly.

### Task F2: Manual smoke walkthrough

Run through the spec §16 manual smoke runbook:

- [ ] Login as student → navigate to course → expand block with published MP → see "Mini-project: <Block>" link with "Not yet submitted" pill.
- [ ] Click link → detail page renders with assignment HTML, group context, no history, submit section enabled.
- [ ] Submit a PDF → success state → BlockGroup pill refreshes on return.
- [ ] Login as admin → add a student already on another published run of the same course → see 409 / RosterImportModal error row.
- [ ] Try to publish a run containing such a student → PublishConflictsModal opens with the conflict list.
- [ ] Document any UX surprises as follow-up issues; do NOT silently fix in this slice.

### Task F3: Update CLAUDE.md if any new convention was discovered

- [ ] If implementer found a new test pattern, helper convention, or constraint worth memorializing, append a one-line note to `CLAUDE.md`. Otherwise skip.

- [ ] Commit any remaining doc updates.

---

## Self-Review Notes

After writing this plan, I checked it against rev 14 of the spec:

**Spec coverage check:**
- §1 scope: list endpoint (B2), detail endpoint (B3), constraint enforcement (A4-A6) — all covered.
- §2 files touched: all listed files appear in a task. `helpers.py` imports (N2/P1), `from __future__` (H1), constant location (F11), `STUDENT_ALREADY_ACTIVE_ERROR_CODE` all explicitly handled in A1-A2.
- §3.1 list: B2 with all `latest_status` derivation cases + status codes 401/403/404.
- §3.2 detail: B3 with all schemas, can_submit ladder, fallback rule, IDOR test.
- §3.3 constraint: A4 (add_student), A5 (batch), A6 (publish_run) with M3 signature + L2/M5/M6 ordering + L4/M2 side-effect notes baked in.
- §4 resolvers: B1 (`_resolve_student_run`) + B3 (`_resolve_block`).
- §5 UI components: D1 (StatusPill), D2 (MiniProjectLink), D3 (BlockGroup), D4 (modal). Trust-boundary note + rewriteExternalLinks live in C3 wire module + D6 detail page tests.
- §6 detail page: D5 (skeleton + assignment + group + history), D6 (submit + state + visibility + refetch tests). All 7 steps mapped.
- §7 state plumbing: E1 (currentCourse extension), E2 (CourseView), E3 (RunDetailPage), E4 (RosterImportModal).
- §8 tests: every test family from spec §8 mapped onto its host task.
- §9 migration: none required — confirmed in A1 notes.
- §10 locked decisions D1-D9: invariant enforced in A4-A6; D2 inactive enrollment in B1; D3 no peer emails in C2/B3; D4 ungrouped UX in B3/D5; D5 history DESC in B3.
- §11 out of scope: respected (no model changes, no migration, no admin tooling).
- §12 self-review + §13 reviewer notes: informational, no task needed.

**Placeholder scan:** every "..." in code blocks is followed by a concrete shape in the spec referenced by section number; the implementer should expand them by reading the cited spec lines. No "TBD", "implement later", or "add error handling" — all behaviors specified.

**Type consistency:** function names + signatures used are stable across tasks (e.g., `_resolve_student_run`, `find_student_active_conflicts(db, user_id, *, course_id, exclude_run_id)`, `_display_name`, `rewriteExternalLinks(containerEl)`, `fetchListSwallow403`, `fetchDetail`, `submit`, `PublishConflict`, `REASON_LABELS`).
