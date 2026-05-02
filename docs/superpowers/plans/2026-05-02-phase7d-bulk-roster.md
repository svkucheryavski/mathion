# Phase 7d — Bulk Roster Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/runs/{id}/students/bulk-move` and `bulk-delete` endpoints to the Mathion roster API, mirroring the existing `/batch` (adds) pattern with 207 multi-status, per-row SAVEPOINTs, and `user_id` identifiers.

**Architecture:** Two new endpoints in the existing `mathion/api/run_roster.py`. Cascade-to-enrollment logic from single DELETE is extracted to a new `remove_run_student` helper in `helpers.py` so single + bulk share one implementation. Six new Pydantic schemas (request/result-row/response per endpoint), with a `field_validator` that 422s on duplicate `user_ids`. No DB schema change, no Alembic migration.

**Tech Stack:** FastAPI, SQLAlchemy 2.x ORM, Pydantic v2, pytest, SQLite (test) / Postgres (target).

**Spec:** `docs/superpowers/specs/2026-05-01-phase7d-bulk-roster-design.md` (commit `5d228f6`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/mathion/api/helpers.py` | shared helpers; gains `remove_run_student` | modify, +~25 LOC |
| `backend/mathion/api/run_roster.py` | roster endpoints; refactor `remove_student` to use the new helper; add `bulk_delete_students` and `bulk_move_students` | modify, +~80 LOC, refactor ~30 LOC |
| `backend/mathion/schemas.py` | Pydantic schemas; add 6 new bulk schemas with duplicate-rejecting validators | modify, +~45 LOC |
| `backend/tests/test_run_roster_bulk.py` | new test file for bulk endpoints (kept separate from `test_run_roster.py` to avoid bloat) | create, ~280 LOC |

## Task overview

1. Extract `remove_run_student` helper; refactor single DELETE to use it.
2. Add 6 bulk schemas with `no_duplicates` validators (and unit tests for the validators).
3. Implement bulk-delete endpoint end-to-end with all 5 endpoint-level tests.
4. Implement bulk-move pre-flight (whole-call 400/409).
5. Implement bulk-move per-row processing with capacity-fills-mid-loop and "no-op + fill mix" regression test.
6. Bulk-move auth + 422 endpoint-level tests.
7. Full regression run, project memory update.

---

## Task 1: Extract `remove_run_student` helper

**Goal:** Move the cascade-to-enrollment logic from single `DELETE /api/runs/{id}/students/{user_id}` into a reusable helper. The single endpoint then calls the helper. All existing tests must still pass — this is a pure refactor.

**Files:**
- Modify: `backend/mathion/api/helpers.py` (add new helper)
- Modify: `backend/mathion/api/run_roster.py:100-137` (refactor `remove_student` to call helper)

**Why TDD-light here:** there are no new behaviors, only a code shuffle. The "failing test" in this case is the existing test suite still running green. We add one tiny new direct-helper test for completeness.

- [ ] **Step 1: Read the existing single-DELETE handler.**

Open `backend/mathion/api/run_roster.py` lines 100-137 and read carefully. The behavior to preserve:
1. Look up `RunStudent` for `(run_id, user_id)`. If missing, raise 404 `"Student not in run"`.
2. Delete the row and `db.flush()`.
3. Cross-version sibling check: any other `RunStudent` row exists for this user on any version of the same course? Use `Run` → `CourseVersion` → `course_id` join, `limit(1).first()`.
4. If no siblings, find `StudentEnrollment` for `(user_id, run.version_id)` and set `is_active = False`.
5. Final `db.commit()` happens in the endpoint, not the helper.

- [ ] **Step 2: Add a unit test for the new helper.**

Add to `backend/tests/test_run_roster.py`:

```python
def test_remove_run_student_helper_returns_false_for_unknown_user(db, seed_publishable_version, admin_client):
    from mathion.api.helpers import remove_run_student
    from mathion.models import Run

    run_data = _make_run(admin_client, seed_publishable_version)
    run = db.get(Run, run_data["id"])
    result = remove_run_student(db, run, user_id=99999)
    assert result is False


def test_remove_run_student_helper_deletes_and_returns_true(db, seed_publishable_version, admin_client):
    from mathion.api.helpers import remove_run_student
    from mathion.models import Run, RunStudent
    from mathion.models_auth import StudentEnrollment

    run_data = _make_run(admin_client, seed_publishable_version)
    run = db.get(Run, run_data["id"])
    s = admin_client.post(
        f"/api/runs/{run_data['id']}/students", json={"email": "x@example.com"}
    ).json()
    db.expire_all()  # refresh ORM state to see API-side commits

    result = remove_run_student(db, run, user_id=s["user_id"])
    db.commit()
    assert result is True
    assert db.query(RunStudent).filter_by(run_id=run.id, user_id=s["user_id"]).first() is None
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=s["user_id"], version_id=run.version_id
    ).one()
    assert enrollment.is_active is False
```

- [ ] **Step 3: Run the new tests to verify they fail.**

Run: `.venv/bin/pytest backend/tests/test_run_roster.py::test_remove_run_student_helper_returns_false_for_unknown_user backend/tests/test_run_roster.py::test_remove_run_student_helper_deletes_and_returns_true -v`

Expected: FAIL with `ImportError: cannot import name 'remove_run_student' from 'mathion.api.helpers'`.

- [ ] **Step 4: Add the helper to `helpers.py`.**

Append to `backend/mathion/api/helpers.py` (after `enroll_user_in_run` ~line 195):

```python
def remove_run_student(db: Session, run, user_id: int) -> bool:
    """Remove a student from a run.

    1. Look up RunStudent for (run.id, user_id). Return False if not found.
    2. Delete the RunStudent row and flush.
    3. Check whether the user has any other RunStudent on any version of
       the same course (joins Run -> CourseVersion -> course_id).
    4. If no siblings remain, set StudentEnrollment.is_active = False
       for (user_id, run.version_id).
    5. Caller must commit.

    Returns True if a row was deleted, False if no matching RunStudent.
    """
    from mathion.models import CourseVersion, Run, RunStudent
    from mathion.models_auth import StudentEnrollment

    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run.id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if rs is None:
        return False

    db.delete(rs)
    db.flush()

    other = db.execute(
        select(RunStudent.id)
        .join(Run, Run.id == RunStudent.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunStudent.user_id == user_id,
            CourseVersion.course_id == run.version.course_id,
        )
        .limit(1)
    ).first()
    if other is None:
        enrollment = db.execute(
            select(StudentEnrollment).where(
                StudentEnrollment.user_id == user_id,
                StudentEnrollment.version_id == run.version_id,
            )
        ).scalar_one_or_none()
        if enrollment:
            enrollment.is_active = False
    return True
```

- [ ] **Step 5: Refactor `remove_student` in `run_roster.py` to use the helper.**

Replace `backend/mathion/api/run_roster.py` lines 100-137 with:

```python
@router.delete("/api/runs/{run_id}/students/{user_id}", status_code=204)
def remove_student(run_id: int, user_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    if not remove_run_student(db, run, user_id):
        raise HTTPException(status_code=404, detail="Student not in run")
    db.commit()
```

Update the imports at the top of `run_roster.py` to include `remove_run_student`:

```python
from mathion.api.helpers import (
    enroll_user_in_run,
    get_or_404,
    get_or_create_user,
    remove_run_student,
    require_run_admin_or_teacher,
)
```

Remove now-unused imports if any (likely `StudentEnrollment` is no longer needed in `run_roster.py` after this refactor — verify and remove). Likely also `CourseVersion` import becomes unused.

- [ ] **Step 6: Run new helper tests + all existing roster tests.**

Run: `.venv/bin/pytest backend/tests/test_run_roster.py -v`

Expected: ALL pass — both the two new helper tests and the existing 12 roster tests (especially `test_remove_student_deactivates_enrollment_when_no_other_run` and `test_remove_student_keeps_enrollment_if_other_run_exists`, which exercise the cross-version cascade).

- [ ] **Step 7: Run full suite to confirm no other regression.**

Run: `.venv/bin/pytest -q`

Expected: 477 passed (475 baseline + 2 new helper tests).

- [ ] **Step 8: Commit.**

```bash
git add backend/mathion/api/helpers.py backend/mathion/api/run_roster.py backend/tests/test_run_roster.py
git commit -m "refactor(phase7d): extract remove_run_student helper from single DELETE

Lifts the cascade-to-enrollment logic out of run_roster.remove_student
into helpers.remove_run_student so single DELETE and the upcoming
bulk-delete share one implementation. Mirrors the existing
enroll_user_in_run pattern that unifies single ADD and /batch.

Pure refactor — no behavior change."
```

---

## Task 2: Add bulk schemas with duplicate-rejecting validators

**Goal:** Define the 6 Pydantic models the bulk endpoints will use. Validators must 422 on duplicate `user_ids` (consistent with the spec's "422 means UI bug" stance).

**Files:**
- Modify: `backend/mathion/schemas.py` (append after the existing `RunStudentBatchResponse` at line 465)

- [ ] **Step 1: Write failing tests for the validators.**

Add to a new file `backend/tests/test_bulk_roster_schemas.py`:

```python
import pytest
from pydantic import ValidationError


def test_bulk_move_request_rejects_duplicates():
    from mathion.schemas import RunStudentBulkMoveRequest

    with pytest.raises(ValidationError) as ei:
        RunStudentBulkMoveRequest(user_ids=[1, 2, 1], group_id=7)
    assert "must not contain duplicates" in str(ei.value)


def test_bulk_move_request_rejects_empty_list():
    from mathion.schemas import RunStudentBulkMoveRequest

    with pytest.raises(ValidationError):
        RunStudentBulkMoveRequest(user_ids=[], group_id=7)


def test_bulk_move_request_rejects_oversize_list():
    from mathion.schemas import RunStudentBulkMoveRequest

    with pytest.raises(ValidationError):
        RunStudentBulkMoveRequest(user_ids=list(range(201)), group_id=7)


def test_bulk_move_request_accepts_null_group():
    from mathion.schemas import RunStudentBulkMoveRequest

    req = RunStudentBulkMoveRequest(user_ids=[1, 2, 3], group_id=None)
    assert req.group_id is None
    assert req.user_ids == [1, 2, 3]


def test_bulk_delete_request_rejects_duplicates():
    from mathion.schemas import RunStudentBulkDeleteRequest

    with pytest.raises(ValidationError) as ei:
        RunStudentBulkDeleteRequest(user_ids=[5, 5])
    assert "must not contain duplicates" in str(ei.value)


def test_bulk_delete_request_rejects_empty_list():
    from mathion.schemas import RunStudentBulkDeleteRequest

    with pytest.raises(ValidationError):
        RunStudentBulkDeleteRequest(user_ids=[])


def test_bulk_delete_request_rejects_oversize_list():
    from mathion.schemas import RunStudentBulkDeleteRequest

    with pytest.raises(ValidationError):
        RunStudentBulkDeleteRequest(user_ids=list(range(201)))


def test_bulk_move_result_row_shape():
    from mathion.schemas import RunStudentBulkMoveResultRow

    ok = RunStudentBulkMoveResultRow(user_id=12, status="ok", group_id=7)
    assert ok.detail is None
    err = RunStudentBulkMoveResultRow(user_id=34, status="error", detail="Group capacity reached")
    assert err.group_id is None


def test_bulk_delete_result_row_shape():
    from mathion.schemas import RunStudentBulkDeleteResultRow

    ok = RunStudentBulkDeleteResultRow(user_id=12, status="ok")
    assert ok.detail is None
    err = RunStudentBulkDeleteResultRow(user_id=34, status="error", detail="Student not in run")
    assert err.detail == "Student not in run"
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `.venv/bin/pytest backend/tests/test_bulk_roster_schemas.py -v`

Expected: 9 FAILures, all `ImportError: cannot import name 'RunStudentBulkMoveRequest'` etc.

- [ ] **Step 3: Add the 6 schemas to `schemas.py`.**

Append to `backend/mathion/schemas.py` (after line 465, the existing `RunStudentBatchResponse`):

```python
# ---- Phase 7d: bulk roster operations ---------------------------------------

class RunStudentBulkMoveRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)
    group_id: int | None = None  # explicit None means unassign

    @field_validator("user_ids")
    @classmethod
    def no_duplicates(cls, v: list[int]) -> list[int]:
        if len(set(v)) != len(v):
            raise ValueError("user_ids must not contain duplicates")
        return v


class RunStudentBulkMoveResultRow(BaseModel):
    user_id: int
    status: Literal["ok", "error"]
    group_id: int | None = None  # populated on success (target group, or null for unassign)
    detail: str | None = None    # populated on error


class RunStudentBulkMoveResponse(BaseModel):
    results: list[RunStudentBulkMoveResultRow]


class RunStudentBulkDeleteRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)

    @field_validator("user_ids")
    @classmethod
    def no_duplicates(cls, v: list[int]) -> list[int]:
        if len(set(v)) != len(v):
            raise ValueError("user_ids must not contain duplicates")
        return v


class RunStudentBulkDeleteResultRow(BaseModel):
    user_id: int
    status: Literal["ok", "error"]
    detail: str | None = None  # populated on error


class RunStudentBulkDeleteResponse(BaseModel):
    results: list[RunStudentBulkDeleteResultRow]
```

Verify imports at the top of `schemas.py` already include `field_validator`, `Field`, `Literal`, `BaseModel` (they do — used by existing schemas).

- [ ] **Step 4: Run schema tests to verify they pass.**

Run: `.venv/bin/pytest backend/tests/test_bulk_roster_schemas.py -v`

Expected: 9 passed.

- [ ] **Step 5: Run full suite.**

Run: `.venv/bin/pytest -q`

Expected: 486 passed (477 + 9 new schema tests).

- [ ] **Step 6: Commit.**

```bash
git add backend/mathion/schemas.py backend/tests/test_bulk_roster_schemas.py
git commit -m "feat(phase7d): bulk roster schemas with duplicate-rejecting validators

Add RunStudentBulk{Move,Delete}{Request,ResultRow,Response} — 6 models
total. Move and delete use separate result-row models so each
endpoint's OpenAPI schema only carries fields it populates. Both
requests reject duplicate user_ids with 422 (consistent with spec's
'422 = UI bug' stance) and enforce min_length=1 / max_length=200."
```

---

## Task 3: Bulk-delete endpoint

**Goal:** Implement `POST /api/runs/{run_id}/students/bulk-delete` end-to-end. Per-row SAVEPOINTs delegate to the `remove_run_student` helper from Task 1. All 5 bulk-delete endpoint tests pass.

**Files:**
- Create: `backend/tests/test_run_roster_bulk.py`
- Modify: `backend/mathion/api/run_roster.py` (add `bulk_delete_students` handler)

- [ ] **Step 1: Write failing tests covering all bulk-delete behaviors.**

Create `backend/tests/test_run_roster_bulk.py` with the following content:

```python
"""Bulk roster operation tests — POST /students/bulk-delete and bulk-move."""

import pytest


def _make_run(admin_client, seed_publishable_version, groups_enabled=True):
    course, _ = seed_publishable_version()
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={
            "title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
            "groups_enabled": groups_enabled,
        },
    ).json()


def _add_student(admin_client, run_id, email, group_id=None):
    body = {"email": email}
    if group_id is not None:
        body["group_id"] = group_id
    return admin_client.post(f"/api/runs/{run_id}/students", json=body).json()


def _make_group(admin_client, run_id, name):
    return admin_client.post(f"/api/runs/{run_id}/groups", json={"name": name}).json()


# ---- bulk-delete -----------------------------------------------------------

def test_bulk_delete_requires_admin_or_teacher(admin_client, auth_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = auth_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete", json={"user_ids": [1]}
    )
    assert response.status_code == 403


def test_bulk_delete_returns_404_for_missing_run(admin_client):
    response = admin_client.post(
        "/api/runs/9999/students/bulk-delete", json={"user_ids": [1]}
    )
    assert response.status_code == 404


def test_bulk_delete_rejects_empty_and_oversize_lists(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    r1 = admin_client.post(f"/api/runs/{run['id']}/students/bulk-delete", json={"user_ids": []})
    assert r1.status_code == 422
    r2 = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": list(range(201))},
    )
    assert r2.status_code == 422


def test_bulk_delete_rejects_duplicates(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": [1, 1, 2]},
    )
    assert response.status_code == 422
    assert "duplicates" in response.text


def test_bulk_delete_happy_path_with_enrollment_cascade(admin_client, db, seed_publishable_version):
    """3 students removed; 2 had no other run on the course (enrollment deactivated);
    1 also exists on a sibling run on the same course (enrollment stays active).

    Uses two runs on the SAME published version — this still exercises the
    cross-version cascade query because the `Run -> CourseVersion -> course_id`
    join finds any sibling RunStudent on the same course regardless of version.
    """
    from mathion.models_auth import StudentEnrollment

    course, _ = seed_publishable_version()
    run1 = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    ).json()
    run2 = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"},
    ).json()

    a = _add_student(admin_client, run1["id"], "a@example.com")
    b = _add_student(admin_client, run1["id"], "b@example.com")
    c = _add_student(admin_client, run1["id"], "c@example.com")
    # c also enrolled on run2 (sibling run on the same course).
    _add_student(admin_client, run2["id"], "c@example.com")

    response = admin_client.post(
        f"/api/runs/{run1['id']}/students/bulk-delete",
        json={"user_ids": [a["user_id"], b["user_id"], c["user_id"]]},
    )
    assert response.status_code == 207
    body = response.json()
    assert len(body["results"]) == 3
    assert all(r["status"] == "ok" for r in body["results"])
    assert {r["user_id"] for r in body["results"]} == {a["user_id"], b["user_id"], c["user_id"]}

    db.expire_all()
    # a and b had only run1 → enrollment deactivated.
    for sid in [a["user_id"], b["user_id"]]:
        enr = db.query(StudentEnrollment).filter_by(
            user_id=sid, version_id=run1["version_id"]
        ).one()
        assert enr.is_active is False
    # c also has run2 → enrollment for run1's version stays active.
    enr_c = db.query(StudentEnrollment).filter_by(
        user_id=c["user_id"], version_id=run1["version_id"]
    ).one()
    assert enr_c.is_active is True


def test_bulk_delete_mixed_results(admin_client, seed_publishable_version):
    """Some user_ids are in the run, some aren't — per-row results reflect both."""
    run = _make_run(admin_client, seed_publishable_version)
    a = _add_student(admin_client, run["id"], "a@example.com")
    b = _add_student(admin_client, run["id"], "b@example.com")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": [a["user_id"], 99999, b["user_id"]]},
    )
    assert response.status_code == 207
    by_uid = {r["user_id"]: r for r in response.json()["results"]}
    assert by_uid[a["user_id"]]["status"] == "ok"
    assert by_uid[b["user_id"]]["status"] == "ok"
    assert by_uid[99999]["status"] == "error"
    assert by_uid[99999]["detail"] == "Student not in run"


def test_bulk_delete_returns_207_even_when_all_succeed(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    a = _add_student(admin_client, run["id"], "a@example.com")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-delete",
        json={"user_ids": [a["user_id"]]},
    )
    assert response.status_code == 207
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `.venv/bin/pytest backend/tests/test_run_roster_bulk.py -v`

Expected: 7 FAILures (most likely 404 because the endpoint doesn't exist yet, plus 422 cases that may pass via Pydantic validation alone).

- [ ] **Step 3: Add the `bulk_delete_students` handler.**

Append to `backend/mathion/api/run_roster.py` (after `add_students_batch`):

```python
@router.post(
    "/api/runs/{run_id}/students/bulk-delete",
    status_code=207,
    response_model=RunStudentBulkDeleteResponse,
)
def bulk_delete_students(
    run_id: int,
    data: RunStudentBulkDeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    results = []
    for uid in data.user_ids:
        sp = db.begin_nested()
        try:
            if remove_run_student(db, run, uid):
                sp.commit()
                results.append({"user_id": uid, "status": "ok"})
            else:
                sp.rollback()
                results.append({"user_id": uid, "status": "error", "detail": "Student not in run"})
        except Exception:  # noqa: BLE001
            logger.exception("Unexpected error in bulk-delete for user %s on run %s", uid, run_id)
            sp.rollback()
            results.append({"user_id": uid, "status": "error", "detail": "internal error"})

    db.commit()
    return {"results": results}
```

Update imports in `run_roster.py` to include the new schemas:

```python
from mathion.schemas import (
    RunStudentBatchRequest,
    RunStudentBatchResponse,
    RunStudentBulkDeleteRequest,
    RunStudentBulkDeleteResponse,
    RunStudentCreate,
    RunStudentResponse,
    RunStudentUpdate,
)
```

- [ ] **Step 4: Run bulk-delete tests to verify they pass.**

Run: `.venv/bin/pytest backend/tests/test_run_roster_bulk.py -v`

Expected: 7 passed.

- [ ] **Step 5: Run full suite.**

Run: `.venv/bin/pytest -q`

Expected: 493 passed (486 + 7 new).

- [ ] **Step 6: Commit.**

```bash
git add backend/mathion/api/run_roster.py backend/tests/test_run_roster_bulk.py
git commit -m "feat(phase7d): bulk-delete endpoint with per-row 207 multi-status

POST /api/runs/{id}/students/bulk-delete delegates each row to
remove_run_student under a SAVEPOINT, so one row's failure (e.g.,
'Student not in run') doesn't poison the rest. Cascade-to-enrollment
deactivation runs per row, identical to single DELETE."
```

---

## Task 4: Bulk-move pre-flight (whole-call failures)

**Goal:** Implement the pre-flight half of the bulk-move endpoint: a bad target group fails the whole call (400 / 409). Per-row processing comes in Task 5.

**Files:**
- Modify: `backend/tests/test_run_roster_bulk.py` (append tests)
- Modify: `backend/mathion/api/run_roster.py` (add `bulk_move_students` handler — pre-flight only)

- [ ] **Step 1: Write failing tests for pre-flight.**

Append to `backend/tests/test_run_roster_bulk.py`:

```python
# ---- bulk-move pre-flight --------------------------------------------------

def test_bulk_move_requires_admin_or_teacher(admin_client, auth_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    response = auth_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [1], "group_id": 1},
    )
    assert response.status_code == 403


def test_bulk_move_returns_404_for_missing_run(admin_client):
    response = admin_client.post(
        "/api/runs/9999/students/bulk-move",
        json={"user_ids": [1], "group_id": 1},
    )
    assert response.status_code == 404


def test_bulk_move_returns_400_when_group_belongs_to_other_run(admin_client, seed_publishable_version):
    run1 = _make_run(admin_client, seed_publishable_version)
    run2 = _make_run(admin_client, seed_publishable_version)
    g_other = _make_group(admin_client, run2["id"], "Group X")
    a = _add_student(admin_client, run1["id"], "a@example.com")

    response = admin_client.post(
        f"/api/runs/{run1['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"]], "group_id": g_other["id"]},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Group not in this run"


def test_bulk_move_returns_409_for_disabled_group(admin_client, db, seed_publishable_version):
    from mathion.models import Group

    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "Group A")
    a = _add_student(admin_client, run["id"], "a@example.com")
    # Disable the group.
    admin_client.patch(f"/api/groups/{g['id']}", json={"is_disabled": True})

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Cannot move student into disabled group"
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `.venv/bin/pytest backend/tests/test_run_roster_bulk.py -v -k bulk_move`

Expected: 4 FAILures (404 from missing endpoint).

- [ ] **Step 3: Add the bulk-move handler skeleton with pre-flight.**

Append to `backend/mathion/api/run_roster.py`:

```python
@router.post(
    "/api/runs/{run_id}/students/bulk-move",
    status_code=207,
    response_model=RunStudentBulkMoveResponse,
)
def bulk_move_students(
    run_id: int,
    data: RunStudentBulkMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    # Pre-flight: validate target group (whole-call failure on bad target).
    if data.group_id is not None:
        g = db.get(Group, data.group_id)
        if g is None or g.run_id != run_id:
            raise HTTPException(status_code=400, detail="Group not in this run")
        if g.is_disabled:
            raise HTTPException(status_code=409, detail="Cannot move student into disabled group")

    # Per-row processing comes in Task 5; for now return empty results so the
    # endpoint exists and pre-flight tests pass.
    results = []  # TODO(phase7d-task5): per-row loop

    db.commit()
    return {"results": results}
```

Update imports:

```python
from mathion.schemas import (
    RunStudentBatchRequest,
    RunStudentBatchResponse,
    RunStudentBulkDeleteRequest,
    RunStudentBulkDeleteResponse,
    RunStudentBulkMoveRequest,
    RunStudentBulkMoveResponse,
    RunStudentCreate,
    RunStudentResponse,
    RunStudentUpdate,
)
```

- [ ] **Step 4: Run bulk-move pre-flight tests to verify they pass.**

Run: `.venv/bin/pytest backend/tests/test_run_roster_bulk.py -v -k bulk_move`

Expected: 4 passed.

- [ ] **Step 5: Run full suite.**

Run: `.venv/bin/pytest -q`

Expected: 497 passed (493 + 4 new).

- [ ] **Step 6: Commit.**

```bash
git add backend/mathion/api/run_roster.py backend/tests/test_run_roster_bulk.py
git commit -m "feat(phase7d): bulk-move pre-flight (400/409 on bad target group)

POST /api/runs/{id}/students/bulk-move skeleton with whole-call
pre-flight: 400 if group_id belongs to another run, 409 if the target
is disabled. Error string singular 'student' to match
patch_student at run_roster.py:86. Per-row loop is empty for now;
follows in Task 5."
```

---

## Task 5: Bulk-move per-row processing (the meaty task)

**Goal:** Implement the per-row loop with capacity check, no-op detection, null-target unassignment, and the regression-prone "no-op + fill mix" case.

**Files:**
- Modify: `backend/tests/test_run_roster_bulk.py` (append tests)
- Modify: `backend/mathion/api/run_roster.py` (replace pre-flight-only `bulk_move_students` body)

- [ ] **Step 1: Write failing tests for per-row behaviors.**

Append to `backend/tests/test_run_roster_bulk.py`:

```python
# ---- bulk-move per-row -----------------------------------------------------

def test_bulk_move_happy_path(admin_client, db, seed_publishable_version):
    from mathion.models import RunStudent

    run = _make_run(admin_client, seed_publishable_version)
    src = _make_group(admin_client, run["id"], "Source")
    dst = _make_group(admin_client, run["id"], "Dest")
    s1 = _add_student(admin_client, run["id"], "s1@example.com", group_id=src["id"])
    s2 = _add_student(admin_client, run["id"], "s2@example.com", group_id=src["id"])
    s3 = _add_student(admin_client, run["id"], "s3@example.com", group_id=src["id"])

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={
            "user_ids": [s1["user_id"], s2["user_id"], s3["user_id"]],
            "group_id": dst["id"],
        },
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert len(results) == 3
    assert all(r["status"] == "ok" for r in results)
    assert all(r["group_id"] == dst["id"] for r in results)

    db.expire_all()
    for s in [s1, s2, s3]:
        rs = db.query(RunStudent).filter_by(run_id=run["id"], user_id=s["user_id"]).one()
        assert rs.group_id == dst["id"]


def test_bulk_move_already_in_target_is_noop(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    s = _add_student(admin_client, run["id"], "s@example.com", group_id=g["id"])

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [s["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert results[0]["status"] == "ok"
    assert results[0]["group_id"] == g["id"]


def test_bulk_move_unassign_with_null_group(admin_client, db, seed_publishable_version):
    from mathion.models import RunStudent

    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    s = _add_student(admin_client, run["id"], "s@example.com", group_id=g["id"])

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [s["user_id"]], "group_id": None},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "ok"
    assert response.json()["results"][0]["group_id"] is None

    db.expire_all()
    rs = db.query(RunStudent).filter_by(run_id=run["id"], user_id=s["user_id"]).one()
    assert rs.group_id is None


def test_bulk_move_unassigns_already_unassigned_student_as_noop(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    s = _add_student(admin_client, run["id"], "s@example.com")  # no group

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [s["user_id"]], "group_id": None},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "ok"


def test_bulk_move_user_not_in_run_returns_per_row_error(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [99999], "group_id": g["id"]},
    )
    assert response.status_code == 207
    row = response.json()["results"][0]
    assert row["status"] == "error"
    assert row["detail"] == "Student not in run"


def test_bulk_move_capacity_fills_mid_loop(admin_client, db, seed_publishable_version):
    """Target has room for 2; 4 movers requested. First 2 succeed, last 2 fail."""
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User

    run = _make_run(admin_client, seed_publishable_version)
    src = _make_group(admin_client, run["id"], "Source")
    dst = _make_group(admin_client, run["id"], "Dest")
    # Pre-fill dst with 8 students.
    for i in range(8):
        u = User(email=f"prefill{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=dst["id"]))
    db.commit()

    movers = [_add_student(admin_client, run["id"], f"m{i}@example.com", group_id=src["id"])
              for i in range(4)]
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [m["user_id"] for m in movers], "group_id": dst["id"]},
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert results[0]["status"] == "ok"
    assert results[1]["status"] == "ok"
    assert results[2]["status"] == "error"
    assert results[2]["detail"] == "Group capacity reached"
    assert results[3]["status"] == "error"
    assert results[3]["detail"] == "Group capacity reached"


def test_bulk_move_noop_plus_fill_mix(admin_client, db, seed_publishable_version):
    """Regression-locking case from the spec.

    Target B has 9 students (room for 1). user_X is already in B; user_Y and
    user_Z are in C. Request: [user_X, user_Y, user_Z]. Expected:
    - user_X: ok no-op (B unchanged at 9)
    - user_Y: ok (B fills to 10)
    - user_Z: error capacity
    """
    from mathion.models import RunStudent
    from mathion.models_auth import User

    run = _make_run(admin_client, seed_publishable_version)
    b = _make_group(admin_client, run["id"], "B")
    c = _make_group(admin_client, run["id"], "C")

    # Pre-fill B with 8 students (we'll add user_X bringing it to 9).
    for i in range(8):
        u = User(email=f"bfill{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=b["id"]))
    db.commit()

    user_x = _add_student(admin_client, run["id"], "x@example.com", group_id=b["id"])  # in B; B=9
    user_y = _add_student(admin_client, run["id"], "y@example.com", group_id=c["id"])  # in C
    user_z = _add_student(admin_client, run["id"], "z@example.com", group_id=c["id"])  # in C

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={
            "user_ids": [user_x["user_id"], user_y["user_id"], user_z["user_id"]],
            "group_id": b["id"],
        },
    )
    assert response.status_code == 207
    results = response.json()["results"]
    assert results[0]["user_id"] == user_x["user_id"]
    assert results[0]["status"] == "ok"
    assert results[1]["user_id"] == user_y["user_id"]
    assert results[1]["status"] == "ok"
    assert results[2]["user_id"] == user_z["user_id"]
    assert results[2]["status"] == "error"
    assert results[2]["detail"] == "Group capacity reached"


def test_bulk_move_mixed_results(admin_client, db, seed_publishable_version):
    """One success, one not-in-run, one already-in-target."""
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    a = _add_student(admin_client, run["id"], "a@example.com")  # ungrouped
    b = _add_student(admin_client, run["id"], "b@example.com", group_id=g["id"])  # already in G

    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"], 99999, b["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 207
    by_uid = {r["user_id"]: r for r in response.json()["results"]}
    assert by_uid[a["user_id"]]["status"] == "ok"
    assert by_uid[a["user_id"]]["group_id"] == g["id"]
    assert by_uid[99999]["status"] == "error"
    assert by_uid[99999]["detail"] == "Student not in run"
    assert by_uid[b["user_id"]]["status"] == "ok"
    assert by_uid[b["user_id"]]["group_id"] == g["id"]
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `.venv/bin/pytest backend/tests/test_run_roster_bulk.py -v -k "bulk_move"`

Expected: 8 new tests fail (current handler returns empty results, so all assertions on `results[0]` fail with IndexError or wrong content). The 4 pre-flight tests still pass.

- [ ] **Step 3: Replace `bulk_move_students` body with the per-row loop.**

Replace the empty-results stub in `backend/mathion/api/run_roster.py` (the `bulk_move_students` body) with:

```python
@router.post(
    "/api/runs/{run_id}/students/bulk-move",
    status_code=207,
    response_model=RunStudentBulkMoveResponse,
)
def bulk_move_students(
    run_id: int,
    data: RunStudentBulkMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    # Pre-flight: validate target group (whole-call failure on bad target).
    if data.group_id is not None:
        g = db.get(Group, data.group_id)
        if g is None or g.run_id != run_id:
            raise HTTPException(status_code=400, detail="Group not in this run")
        if g.is_disabled:
            raise HTTPException(status_code=409, detail="Cannot move student into disabled group")

    # TODO(phase 9): SELECT-count + UPDATE per row is non-atomic, and the bulk
    # version widens the window because the outer transaction commits only
    # after the whole loop. Two concurrent bulk-moves into the same near-full
    # group can both succeed past 10. Real-world impact is low; fix via
    # SELECT FOR UPDATE on Postgres alongside single-PATCH at run_roster.py:87.
    results = []
    for uid in data.user_ids:
        sp = db.begin_nested()
        try:
            rs = db.execute(
                select(RunStudent).where(
                    RunStudent.run_id == run_id, RunStudent.user_id == uid
                )
            ).scalar_one_or_none()
            if rs is None:
                sp.rollback()
                results.append({"user_id": uid, "status": "error", "detail": "Student not in run"})
                continue

            # Already in target → no-op success, skip capacity charge.
            if rs.group_id == data.group_id:
                sp.commit()
                results.append({"user_id": uid, "status": "ok", "group_id": data.group_id})
                continue

            if data.group_id is not None:
                count = db.scalar(
                    select(func.count(RunStudent.id)).where(RunStudent.group_id == data.group_id)
                )
                if count >= 10:
                    sp.rollback()
                    results.append({"user_id": uid, "status": "error", "detail": "Group capacity reached"})
                    continue

            rs.group_id = data.group_id
            db.flush()  # so next iteration's count includes this row
            sp.commit()
            results.append({"user_id": uid, "status": "ok", "group_id": data.group_id})
        except Exception:  # noqa: BLE001
            logger.exception("Unexpected error in bulk-move for user %s on run %s", uid, run_id)
            sp.rollback()
            results.append({"user_id": uid, "status": "error", "detail": "internal error"})

    db.commit()
    return {"results": results}
```

(`func` and `select` are already imported at top of `run_roster.py`. `RunStudent`, `Group` are already imported. `logger` is already defined.)

- [ ] **Step 4: Run all bulk-move tests.**

Run: `.venv/bin/pytest backend/tests/test_run_roster_bulk.py -v -k bulk_move`

Expected: 12 passed (4 pre-flight + 8 per-row).

- [ ] **Step 5: Run full suite.**

Run: `.venv/bin/pytest -q`

Expected: 505 passed (497 + 8 new).

- [ ] **Step 6: Commit.**

```bash
git add backend/mathion/api/run_roster.py backend/tests/test_run_roster_bulk.py
git commit -m "feat(phase7d): bulk-move per-row processing with capacity tracking

Per-row SAVEPOINT loop with: 'Student not in run' error, already-in-
target no-op (no capacity charge), capacity-fills-mid-loop ordering,
group_id=null unassignment. Includes the 'no-op + fill mix' regression
test that locks the load-bearing semantic — user_X already in B
no-ops at B=9, user_Y fills B to 10, user_Z fails capacity.

Phase 9 TODO comment matching run_roster.py:87 documents the widened
race window (outer commit deferred until end of loop)."
```

---

## Task 6: Bulk-move auth + 422 endpoint-level tests

**Goal:** Confirm the bulk-move endpoint enforces auth and Pydantic validation at the HTTP layer (not just unit-level on the schemas).

**Files:**
- Modify: `backend/tests/test_run_roster_bulk.py` (append)

These tests should pass without code changes — they verify the Pydantic and auth wiring is correct. If any fail, the cause is wrong wiring in earlier tasks.

- [ ] **Step 1: Write tests.**

Append to `backend/tests/test_run_roster_bulk.py`:

```python
# ---- bulk-move auth + 422 (endpoint-level) ---------------------------------

def test_bulk_move_rejects_empty_and_oversize_lists(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    r1 = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [], "group_id": g["id"]},
    )
    assert r1.status_code == 422
    r2 = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": list(range(201)), "group_id": g["id"]},
    )
    assert r2.status_code == 422


def test_bulk_move_rejects_duplicates(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [1, 1, 2], "group_id": g["id"]},
    )
    assert response.status_code == 422
    assert "duplicates" in response.text


def test_bulk_move_returns_207_even_when_all_succeed(admin_client, seed_publishable_version):
    run = _make_run(admin_client, seed_publishable_version)
    g = _make_group(admin_client, run["id"], "G")
    a = _add_student(admin_client, run["id"], "a@example.com")
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/bulk-move",
        json={"user_ids": [a["user_id"]], "group_id": g["id"]},
    )
    assert response.status_code == 207
```

- [ ] **Step 2: Run new tests.**

Run: `.venv/bin/pytest backend/tests/test_run_roster_bulk.py -v -k "bulk_move and (empty or duplicates or 207)"`

Expected: 3 passed.

- [ ] **Step 3: Run full suite.**

Run: `.venv/bin/pytest -q`

Expected: 508 passed (505 + 3 new).

- [ ] **Step 4: Commit.**

```bash
git add backend/tests/test_run_roster_bulk.py
git commit -m "test(phase7d): bulk-move auth + 422 endpoint-level tests

Verify Pydantic validators (empty/oversize/dupe) and per-endpoint
207-on-all-success behavior at the HTTP layer."
```

---

## Task 7: Final regression and merge readiness

**Goal:** Confirm zero regressions, update project memory, prepare for merge to main.

**Files:**
- Modify: `~/.claude/projects/-Users-svkucheryavski-Documents-Developing-mathion/memory/project_mathion_status.md` (after merge — done by controller, not by implementer)

- [ ] **Step 1: Run full test suite.**

Run: `.venv/bin/pytest -q`

Expected: 508 passed in ~12s.

- [ ] **Step 2: Verify alembic chain (no new migrations expected).**

Run: `rm -f /tmp/p7d-check.db && MATHION_DATABASE_URL="sqlite:////tmp/p7d-check.db" .venv/bin/alembic upgrade head 2>&1 | tail -20 && rm -f /tmp/p7d-check.db`

Expected: clean upgrade through every existing revision; head still `3e7ba736bcd2` (Phase 7c — no Phase 7d migrations); no errors. Phase 7d adds zero migrations.

- [ ] **Step 3: Verify head.**

Run: `.venv/bin/alembic heads`

Expected: `3e7ba736bcd2 (head)` — single head, unchanged from Phase 7c.

- [ ] **Step 4: Show commit history for the branch.**

Run: `git log --oneline main..HEAD`

Expected: 6 Phase 7d commits, in order:
1. `refactor(phase7d): extract remove_run_student helper from single DELETE`
2. `feat(phase7d): bulk roster schemas with duplicate-rejecting validators`
3. `feat(phase7d): bulk-delete endpoint with per-row 207 multi-status`
4. `feat(phase7d): bulk-move pre-flight (400/409 on bad target group)`
5. `feat(phase7d): bulk-move per-row processing with capacity tracking`
6. `test(phase7d): bulk-move auth + 422 endpoint-level tests`

- [ ] **Step 5: Stop here for controller-driven merge.**

The implementer-subagent stops here. Merging the branch into main and updating project memory are controller responsibilities. Suggested merge command (controller, not implementer):

```bash
git checkout main
git merge --no-ff phase7d-bulk-roster -m "Merge phase7d-bulk-roster: bulk delete + bulk move endpoints"
git branch -d phase7d-bulk-roster
```

After merge, the controller updates `~/.claude/projects/-Users-svkucheryavski-Documents-Developing-mathion/memory/project_mathion_status.md` with Phase 7d → DONE and the new 508-test baseline.

---

## Spec ↔ Plan coverage check

| Spec section | Implemented in |
|---|---|
| Helper extraction `remove_run_student` | Task 1 |
| 6 bulk schemas + `no_duplicates` validator | Task 2 |
| `POST /students/bulk-delete` endpoint | Task 3 |
| Bulk-delete auth (403) + 404 missing run | Task 3 |
| Bulk-delete 422 (empty/oversize/dupe) | Task 3 |
| Bulk-delete enrollment cascade (cross-version) | Task 3 |
| Bulk-delete mixed `ok`/`error` results | Task 3 |
| Bulk-delete 207 on all-success | Task 3 (last test) |
| `POST /students/bulk-move` pre-flight 400/409 | Task 4 |
| Bulk-move auth (403) + 404 missing run | Task 4 |
| Bulk-move per-row happy path | Task 5 |
| Already-in-target no-op (no capacity charge) | Task 5 |
| `group_id: null` unassign | Task 5 |
| Capacity-fills-mid-loop | Task 5 |
| "No-op + fill mix" regression test | Task 5 |
| Bulk-move 422 (empty/oversize/dupe) + 207 | Task 6 |
| Phase 9 TODO race comment | Task 5 (in handler code) |
| Singular "Cannot move student into disabled group" | Task 4 |
| No DB schema change, no migration | All tasks (verified Task 7 step 2) |
