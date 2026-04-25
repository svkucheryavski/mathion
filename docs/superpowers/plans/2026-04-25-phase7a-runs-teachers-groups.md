# Phase 7a: Runs, Teachers, Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add course runs (time-bounded scheduled instances of a published version), the supporting teacher and group infrastructure, and the run-aware enrollment cascade. Foundation for Phase 7b mini-projects and 7c dashboards.

**Architecture:** Four new tables (`runs`, `run_teachers`, `groups`, `run_students`) plus a `notification_log` for stub email rows. A run pins to a `version_id` at creation and is locked once `is_published=True`. Lifecycle is *derived* from `start_date`, `end_date`, and `is_published` — no state column. The roster cascade activates a `StudentEnrollment` row on add and deactivates it on remove if the user has no other run on the course. Permissions: most run-scoped endpoints accept course admin OR run teacher; lifecycle endpoints (publish/unpublish/delete) are course-admin-only.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Pydantic v2, Alembic (with `batch_alter_table` only if needed — these are all new tables, so plain `op.create_table` works).

**Spec:** `docs/superpowers/specs/2026-04-25-phase7a-runs-teachers-groups-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `mathion/models.py` | Add `Run`, `RunTeacher`, `Group`, `RunStudent` models |
| `mathion/models_auth.py` | Add `NotificationLogEntry` model |
| `mathion/schemas.py` | Add Run/Teacher/Group/Roster Pydantic schemas |
| `mathion/api/helpers.py` | Add `require_run_admin_or_teacher`, `_enroll_user_in_run` |
| `mathion/api/runs.py` | Run CRUD + publish/unpublish endpoints |
| `mathion/api/run_teachers.py` | Teacher add/list/remove endpoints |
| `mathion/api/groups.py` | Group CRUD endpoints |
| `mathion/api/run_roster.py` | Roster single + batch + patch + remove endpoints |
| `mathion/main.py` | Register four new routers |
| `tests/conftest.py` | Add `teacher_client` fixture and `run_factory` helper |
| `tests/test_runs.py` | Run CRUD, version-pinning, publish/unpublish, publish-gate |
| `tests/test_run_teachers.py` | Teacher endpoints + permissions |
| `tests/test_groups.py` | Group CRUD + capacity + delete-when-empty |
| `tests/test_run_roster.py` | Roster add/remove/move + StudentEnrollment cascade |
| `tests/test_run_notifications.py` | Notification log rows for the three event kinds |
| `alembic/versions/xxx_add_runs_groups_notifications.py` | Migration for five new tables |

---

### Task 1: Models + migration

**Files:**
- Modify: `mathion/models.py` (add Run, RunTeacher, Group, RunStudent)
- Modify: `mathion/models_auth.py` (add NotificationLogEntry)
- Create: `alembic/versions/<hash>_add_runs_groups_notifications.py`

- [ ] **Step 1: Add Run / RunTeacher / Group / RunStudent to `mathion/models.py`**

Insert immediately before the final `from mathion.models_auth import ...` line:

```python
class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="RESTRICT"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    groups_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    version: Mapped["CourseVersion"] = relationship()
    teachers: Mapped[list["RunTeacher"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    groups: Mapped[list["Group"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    students: Mapped[list["RunStudent"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class RunTeacher(Base):
    __tablename__ = "run_teachers"
    __table_args__ = (
        UniqueConstraint("run_id", "user_id", name="uq_run_teacher"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    run: Mapped["Run"] = relationship(back_populates="teachers")
    user: Mapped["User"] = relationship()


class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (
        UniqueConstraint("run_id", "name", name="uq_group_run_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    run: Mapped["Run"] = relationship(back_populates="groups")
    students: Mapped[list["RunStudent"]] = relationship(back_populates="group")


class RunStudent(Base):
    __tablename__ = "run_students"
    __table_args__ = (
        UniqueConstraint("run_id", "user_id", name="uq_run_student"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    run: Mapped["Run"] = relationship(back_populates="students")
    user: Mapped["User"] = relationship()
    group: Mapped["Group | None"] = relationship(back_populates="students")
```

Update the imports at the top of the file:

```python
from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
```

(Adding `date` to datetime import and `Date` to sqlalchemy import.)

- [ ] **Step 2: Add NotificationLogEntry to `mathion/models_auth.py`**

Append to the end of `mathion/models_auth.py`:

```python
class NotificationLogEntry(Base):
    __tablename__ = "notification_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()
```

Then update the re-export at the bottom of `mathion/models.py`:

```python
from mathion.models_auth import (  # noqa: F401
    User, Session, LoginPIN, StudentEnrollment, RateLimitEntry,
    UserItemState, NotificationLogEntry,
)
```

- [ ] **Step 3: Generate migration**

Run: `.venv/bin/alembic revision --autogenerate -m "add_runs_groups_notifications"`
Expected: A new migration file in `alembic/versions/` with `op.create_table` for the five new tables.

- [ ] **Step 4: Inspect the migration file and verify it creates exactly five new tables**

Open the generated file. Verify it contains `op.create_table` for: `runs`, `run_teachers`, `groups`, `run_students`, `notification_log`. No `alter_table` calls — these are all new. Add `down_revision` chain (autogenerated, but confirm).

- [ ] **Step 5: Apply migration**

Run: `.venv/bin/alembic upgrade head`
Expected: Migration applies cleanly.

- [ ] **Step 6: Run full test suite to confirm no regression**

Run: `.venv/bin/pytest -x`
Expected: All 327 existing tests still pass (no test added yet for new tables).

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/models.py backend/mathion/models_auth.py backend/alembic/versions/
git commit -m "feat: add Run, RunTeacher, Group, RunStudent, NotificationLogEntry models"
```

---

### Task 2: Pydantic schemas

**Files:**
- Modify: `mathion/schemas.py`

- [ ] **Step 1: Append run/teacher/group/roster schemas to `mathion/schemas.py`**

Append at the end of the file:

```python
from datetime import date


class RunCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_date: date
    end_date: date
    groups_enabled: bool = False

    @model_validator(mode="after")
    def check_date_order(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class RunUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    groups_enabled: bool | None = None


class RunResponse(BaseModel):
    id: int
    version_id: int
    title: str
    start_date: date
    end_date: date
    groups_enabled: bool
    is_published: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RunTeacherCreate(BaseModel):
    email: str = Field(min_length=1, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class RunTeacherResponse(BaseModel):
    id: int
    run_id: int
    user_id: int
    user_email: str
    user_full_name: str | None
    created_at: datetime


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)


class GroupResponse(BaseModel):
    id: int
    run_id: int
    name: str
    student_count: int = 0

    model_config = {"from_attributes": True}


class RunStudentCreate(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    group_id: int | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class RunStudentBatchRow(BaseModel):
    name: str | None = None
    email: str = Field(min_length=1, max_length=254)
    group: str | None = None  # group name; auto-created if missing

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class RunStudentBatchRequest(BaseModel):
    rows: list[RunStudentBatchRow] = Field(min_length=1)


class RunStudentBatchResultRow(BaseModel):
    email: str
    status: Literal["added", "error"]
    group_id: int | None = None
    detail: str | None = None


class RunStudentBatchResponse(BaseModel):
    results: list[RunStudentBatchResultRow]


class RunStudentUpdate(BaseModel):
    group_id: int | None = None  # explicit None means unassign


class RunStudentResponse(BaseModel):
    id: int
    run_id: int
    user_id: int
    user_email: str
    user_full_name: str | None
    group_id: int | None
    created_at: datetime
```

- [ ] **Step 2: Run pytest to confirm imports OK**

Run: `.venv/bin/pytest -x --co -q`
Expected: Test collection succeeds (no ImportError).

- [ ] **Step 3: Commit**

```bash
git add backend/mathion/schemas.py
git commit -m "feat: add run/teacher/group/roster schemas"
```

---

### Task 3: `teacher_client` fixture

**Files:**
- Modify: `tests/conftest.py`

- [ ] **Step 1: Add a `teacher_user` fixture and a `make_teacher_client` factory**

Append to `tests/conftest.py`:

```python
@pytest.fixture
def teacher_user(db):
    user = User(email="teacher@example.com", full_name="Teacher User")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def teacher_client(client, db, teacher_user):
    """An authenticated client for a non-admin user. Tests that need this user
    to be a RunTeacher on a specific run must add the RunTeacher row directly
    (the user is plain — not a course admin and not a superuser)."""
    c = CSRFTestClient(app)
    raw_pin = request_pin(db, teacher_user.email)
    token = verify_pin(db, teacher_user.email, raw_pin, duration_days=7)
    c.cookies.set("session_token", token)
    return c
```

- [ ] **Step 2: Run tests to ensure conftest still loads**

Run: `.venv/bin/pytest -x --co -q`
Expected: Collection succeeds.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test: add teacher_client fixture"
```

---

### Task 4: `require_run_admin_or_teacher` helper

**Files:**
- Modify: `mathion/api/helpers.py`
- Create: `tests/test_run_permissions.py`

- [ ] **Step 1: Write a failing test for the helper**

Create `backend/tests/test_run_permissions.py`:

```python
from datetime import date

import pytest
from fastapi import HTTPException

from mathion.api.helpers import require_run_admin_or_teacher
from mathion.models import Course, CourseAdmin, CourseVersion, Run, RunTeacher
from mathion.models_auth import User


def _make_run(db, course_admin_user_email="admin@example.com"):
    course = Course(slug="c1", name="C1", description="")
    db.add(course)
    db.flush()
    version = CourseVersion(course_id=course.id, state="published")
    db.add(version)
    db.flush()
    run = Run(
        version_id=version.id, title="r1",
        start_date=date(2026, 1, 1), end_date=date(2026, 6, 1),
    )
    db.add(run)
    db.flush()
    return course, run


def test_superuser_passes(db, superuser):
    _, run = _make_run(db)
    require_run_admin_or_teacher(db, superuser, run.id)  # no exception


def test_course_admin_passes(db, test_user):
    course, run = _make_run(db)
    db.add(CourseAdmin(course_id=course.id, user_id=test_user.id))
    db.commit()
    require_run_admin_or_teacher(db, test_user, run.id)  # no exception


def test_run_teacher_passes(db, test_user):
    _, run = _make_run(db)
    db.add(RunTeacher(run_id=run.id, user_id=test_user.id))
    db.commit()
    require_run_admin_or_teacher(db, test_user, run.id)  # no exception


def test_unrelated_user_403(db, test_user):
    _, run = _make_run(db)
    with pytest.raises(HTTPException) as excinfo:
        require_run_admin_or_teacher(db, test_user, run.id)
    assert excinfo.value.status_code == 403


def test_run_not_found_404(db, superuser):
    with pytest.raises(HTTPException) as excinfo:
        require_run_admin_or_teacher(db, superuser, 9999)
    assert excinfo.value.status_code == 404
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `.venv/bin/pytest tests/test_run_permissions.py -v`
Expected: `ImportError: cannot import name 'require_run_admin_or_teacher'`.

- [ ] **Step 3: Implement the helper**

Append to `mathion/api/helpers.py`:

```python
def require_run_admin_or_teacher(db: Session, user, run_id: int):
    """Verify user is a course admin of the run's course OR a RunTeacher of
    the run OR a superuser. Raises 404 if run missing, 403 if no access."""
    from mathion.models import CourseAdmin, CourseVersion, Run, RunTeacher

    if user.is_superuser:
        run = db.get(Run, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return

    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    version = db.get(CourseVersion, run.version_id)
    is_course_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    is_run_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run_id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if not (is_course_admin or is_run_teacher):
        raise HTTPException(status_code=403, detail="Run admin or teacher access required")
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `.venv/bin/pytest tests/test_run_permissions.py -v`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/helpers.py backend/tests/test_run_permissions.py
git commit -m "feat: add require_run_admin_or_teacher helper"
```

---

### Task 5: Run CRUD endpoints

**Files:**
- Create: `mathion/api/runs.py`
- Modify: `mathion/main.py`
- Create: `tests/test_runs.py`

- [ ] **Step 1: Write failing tests for create + list + get + patch + delete**

Create `backend/tests/test_runs.py`:

```python
from datetime import date


def _seed_minimal_publishable_version(admin_client, db):
    """Create a course + version with a single static-page item, then publish.
    Returns (course_dict, version_dict). Imported by other test files."""
    from mathion.models import Block, Sequence, Item
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="<p>x</p>"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    return course, version


def test_create_run_pins_to_newest_published_version(admin_client, db):
    course, version = _seed_minimal_publishable_version(admin_client, db)
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "Spring 2026", "start_date": "2026-09-01", "end_date": "2026-12-15"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Spring 2026"
    assert data["version_id"] == version["id"]
    assert data["is_published"] is False
    assert data["groups_enabled"] is False


def test_create_run_no_published_version_409(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "x", "name": "X", "description": ""}).json()
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "T", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    )
    assert response.status_code == 409


def test_create_run_end_before_start_422(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    response = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "T", "start_date": "2026-06-01", "end_date": "2026-01-01"},
    )
    assert response.status_code == 422


def test_list_runs(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"})
    admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"})
    response = admin_client.get(f"/api/courses/{course['id']}/runs")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_get_run(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.get(f"/api/runs/{run['id']}")
    assert response.status_code == 200
    assert response.json()["id"] == run["id"]


def test_patch_run_title(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "Old", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"title": "New"})
    assert response.status_code == 200
    assert response.json()["title"] == "New"


def test_patch_run_version_id_ignored(admin_client, db):
    """version_id in PATCH body must be silently ignored or rejected — never accepted."""
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"version_id": 999})
    # RunUpdate schema has no version_id field — pydantic ignores extra by default
    assert response.status_code == 200
    assert response.json()["version_id"] == run["version_id"]


def test_delete_unpublished_run(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 204
    assert admin_client.get(f"/api/runs/{run['id']}").status_code == 404


def test_non_admin_cannot_create_run(auth_client, admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    response = auth_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"})
    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `.venv/bin/pytest tests/test_runs.py -v`
Expected: All fail with 404 (routes don't exist).

- [ ] **Step 3: Create `mathion/api/runs.py` with the CRUD endpoints**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.enrollment import _get_newest_published_version
from mathion.api.helpers import get_or_404, require_course_admin, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseVersion, Run
from mathion.models_auth import User
from mathion.schemas import RunCreate, RunResponse, RunUpdate

router = APIRouter(tags=["runs"])


@router.post("/api/courses/{course_id}/runs", status_code=201, response_model=RunResponse)
def create_run(course_id: int, data: RunCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)
    version = _get_newest_published_version(db, course_id)
    run = Run(
        version_id=version.id,
        title=data.title,
        start_date=data.start_date,
        end_date=data.end_date,
        groups_enabled=data.groups_enabled,
        created_by=user.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.get("/api/courses/{course_id}/runs", response_model=list[RunResponse])
def list_runs(course_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_or_404(db, Course, course_id)
    require_course_admin(db, user, course_id)
    runs = db.execute(
        select(Run).join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(CourseVersion.course_id == course_id)
        .order_by(Run.start_date)
    ).scalars().all()
    return runs


@router.get("/api/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    return run


@router.patch("/api/runs/{run_id}", response_model=RunResponse)
def patch_run(run_id: int, data: RunUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    updates = data.model_dump(exclude_unset=True)

    if "groups_enabled" in updates and run.is_published:
        raise HTTPException(status_code=409, detail="Cannot change groups_enabled on published run")

    for field, value in updates.items():
        setattr(run, field, value)

    if run.end_date < run.start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")

    db.commit()
    db.refresh(run)
    return run


@router.delete("/api/runs/{run_id}", status_code=204)
def delete_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)
    if run.is_published:
        raise HTTPException(status_code=409, detail="Unpublish run before deleting")
    db.delete(run)
    db.commit()
```

- [ ] **Step 4: Wire the router in `mathion/main.py`**

Add the import after the existing `versions_router` import:

```python
from mathion.api.runs import router as runs_router
```

And register it after `assets_router`:

```python
app.include_router(runs_router)
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `.venv/bin/pytest tests/test_runs.py -v`
Expected: 9/9 pass.

- [ ] **Step 6: Run full suite to catch regressions**

Run: `.venv/bin/pytest -x`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/api/runs.py backend/mathion/main.py backend/tests/test_runs.py
git commit -m "feat: add Run CRUD endpoints"
```

---

### Task 6: Run teacher endpoints + run_teacher_assigned notification

**Files:**
- Create: `mathion/api/run_teachers.py`
- Modify: `mathion/main.py`
- Create: `tests/test_run_teachers.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_run_teachers.py`:

```python
from tests.test_runs import _seed_minimal_publishable_version


def _make_run(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    ).json()


def test_add_teacher_creates_user_if_absent(admin_client, db):
    run = _make_run(admin_client, db)
    response = admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "newteacher@example.com"}
    )
    assert response.status_code == 201
    assert response.json()["user_email"] == "newteacher@example.com"


def test_add_teacher_writes_notification_log_row(admin_client, db):
    from mathion.models_auth import NotificationLogEntry
    run = _make_run(admin_client, db)
    admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"}
    )
    rows = db.query(NotificationLogEntry).filter_by(kind="run_teacher_assigned").all()
    assert len(rows) == 1
    assert rows[0].payload["run_id"] == run["id"]


def test_list_teachers(admin_client, db):
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "a@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "b@example.com"})
    response = admin_client.get(f"/api/runs/{run['id']}/teachers")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_remove_teacher(admin_client, db):
    run = _make_run(admin_client, db)
    teacher = admin_client.post(
        f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"}
    ).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/teachers/{teacher['user_id']}")
    assert response.status_code == 204


def test_duplicate_add_409(admin_client, db):
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    response = admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    assert response.status_code == 409


def test_non_admin_cannot_add_teacher(auth_client, admin_client, db):
    run = _make_run(admin_client, db)
    response = auth_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "x@example.com"})
    assert response.status_code == 403


def test_teacher_can_list_but_not_add(teacher_client, admin_client, db, teacher_user):
    from mathion.models import RunTeacher
    run = _make_run(admin_client, db)
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    assert teacher_client.get(f"/api/runs/{run['id']}/teachers").status_code == 200
    assert teacher_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "x@example.com"}).status_code == 403
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `.venv/bin/pytest tests/test_run_teachers.py -v`
Expected: 404 errors (routes don't exist).

- [ ] **Step 3: Implement `mathion/api/run_teachers.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.enrollment import _get_or_create_user
from mathion.api.helpers import get_or_404, require_course_admin, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import CourseVersion, Run, RunTeacher
from mathion.models_auth import NotificationLogEntry, User
from mathion.schemas import RunTeacherCreate, RunTeacherResponse

router = APIRouter(tags=["run_teachers"])


def _to_response(rt: RunTeacher) -> dict:
    return {
        "id": rt.id,
        "run_id": rt.run_id,
        "user_id": rt.user_id,
        "user_email": rt.user.email,
        "user_full_name": rt.user.full_name,
        "created_at": rt.created_at,
    }


@router.post("/api/runs/{run_id}/teachers", status_code=201, response_model=RunTeacherResponse)
def add_teacher(run_id: int, data: RunTeacherCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)

    target = _get_or_create_user(db, data.email)
    existing = db.execute(
        select(RunTeacher).where(RunTeacher.run_id == run_id, RunTeacher.user_id == target.id)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="User already a teacher on this run")

    rt = RunTeacher(run_id=run_id, user_id=target.id)
    db.add(rt)
    db.flush()

    db.add(NotificationLogEntry(
        user_id=target.id,
        kind="run_teacher_assigned",
        payload={"run_id": run_id, "title": run.title},
    ))
    db.commit()
    db.refresh(rt)
    return _to_response(rt)


@router.get("/api/runs/{run_id}/teachers", response_model=list[RunTeacherResponse])
def list_teachers(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    rows = db.execute(
        select(RunTeacher).where(RunTeacher.run_id == run_id).order_by(RunTeacher.created_at)
    ).scalars().all()
    return [_to_response(rt) for rt in rows]


@router.delete("/api/runs/{run_id}/teachers/{user_id}", status_code=204)
def remove_teacher(run_id: int, user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)
    rt = db.execute(
        select(RunTeacher).where(RunTeacher.run_id == run_id, RunTeacher.user_id == user_id)
    ).scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=404, detail="Teacher not assigned to this run")
    db.delete(rt)
    db.commit()
```

- [ ] **Step 4: Wire router in `mathion/main.py`**

```python
from mathion.api.run_teachers import router as run_teachers_router
# ...
app.include_router(run_teachers_router)
```

- [ ] **Step 5: Run tests**

Run: `.venv/bin/pytest tests/test_run_teachers.py -v`
Expected: 7/7 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/run_teachers.py backend/mathion/main.py backend/tests/test_run_teachers.py
git commit -m "feat: add run teacher endpoints with notification stub"
```

---

### Task 7: Group endpoints

**Files:**
- Create: `mathion/api/groups.py`
- Modify: `mathion/main.py`
- Create: `tests/test_groups.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_groups.py`:

```python
from tests.test_runs import _seed_minimal_publishable_version


def _make_run(admin_client, db, groups_enabled=True):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={
            "title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
            "groups_enabled": groups_enabled,
        },
    ).json()


def test_create_group(admin_client, db):
    run = _make_run(admin_client, db)
    response = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Team A"})
    assert response.status_code == 201
    assert response.json()["name"] == "Team A"


def test_create_group_duplicate_name_409(admin_client, db):
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Team A"})
    response = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Team A"})
    assert response.status_code == 409


def test_list_groups(admin_client, db):
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "A"})
    admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "B"})
    response = admin_client.get(f"/api/runs/{run['id']}/groups")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_patch_group_name(admin_client, db):
    run = _make_run(admin_client, db)
    g = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Old"}).json()
    response = admin_client.patch(f"/api/groups/{g['id']}", json={"name": "New"})
    assert response.status_code == 200
    assert response.json()["name"] == "New"


def test_delete_empty_group(admin_client, db):
    run = _make_run(admin_client, db)
    g = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "G"}).json()
    response = admin_client.delete(f"/api/groups/{g['id']}")
    assert response.status_code == 204


def test_delete_non_empty_group_409(admin_client, db):
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    run = _make_run(admin_client, db)
    g = Group(run_id=run["id"], name="G")
    db.add(g); db.flush()
    u = User(email="s@example.com")
    db.add(u); db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.delete(f"/api/groups/{g.id}")
    assert response.status_code == 409


def test_teacher_can_create_group(teacher_client, admin_client, db, teacher_user):
    from mathion.models import RunTeacher
    run = _make_run(admin_client, db)
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    response = teacher_client.post(f"/api/runs/{run['id']}/groups", json={"name": "G"})
    assert response.status_code == 201


def test_unrelated_user_cannot_create_group(auth_client, admin_client, db):
    run = _make_run(admin_client, db)
    response = auth_client.post(f"/api/runs/{run['id']}/groups", json={"name": "G"})
    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `.venv/bin/pytest tests/test_groups.py -v`
Expected: 404 errors.

- [ ] **Step 3: Implement `mathion/api/groups.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Group, Run, RunStudent
from mathion.models_auth import User
from mathion.schemas import GroupCreate, GroupResponse, GroupUpdate

router = APIRouter(tags=["groups"])


def _to_response(g: Group, count: int) -> dict:
    return {"id": g.id, "run_id": g.run_id, "name": g.name, "student_count": count}


@router.post("/api/runs/{run_id}/groups", status_code=201, response_model=GroupResponse)
def create_group(run_id: int, data: GroupCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    g = Group(run_id=run_id, name=data.name)
    db.add(g)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Group name already exists in this run")
    db.refresh(g)
    return _to_response(g, 0)


@router.get("/api/runs/{run_id}/groups", response_model=list[GroupResponse])
def list_groups(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    rows = db.execute(
        select(Group, func.count(RunStudent.id))
        .outerjoin(RunStudent, RunStudent.group_id == Group.id)
        .where(Group.run_id == run_id)
        .group_by(Group.id)
        .order_by(Group.name)
    ).all()
    return [_to_response(g, count) for g, count in rows]


@router.patch("/api/groups/{group_id}", response_model=GroupResponse)
def patch_group(group_id: int, data: GroupUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    g = get_or_404(db, Group, group_id)
    require_run_admin_or_teacher(db, user, g.run_id)
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(g, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Group name already exists in this run")
    db.refresh(g)
    count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == g.id))
    return _to_response(g, count)


@router.delete("/api/groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    g = get_or_404(db, Group, group_id)
    require_run_admin_or_teacher(db, user, g.run_id)
    count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id))
    if count > 0:
        raise HTTPException(status_code=409, detail="Group has students; reassign or remove first")
    db.delete(g)
    db.commit()
```

- [ ] **Step 4: Wire router in `mathion/main.py`**

```python
from mathion.api.groups import router as groups_router
app.include_router(groups_router)
```

- [ ] **Step 5: Run tests**

Run: `.venv/bin/pytest tests/test_groups.py -v`
Expected: 8/8 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/groups.py backend/mathion/main.py backend/tests/test_groups.py
git commit -m "feat: add group CRUD endpoints"
```

---

### Task 8: Roster single endpoints + `_enroll_user_in_run` helper

**Files:**
- Modify: `mathion/api/helpers.py` (add `_enroll_user_in_run`)
- Create: `mathion/api/run_roster.py`
- Modify: `mathion/main.py`
- Create: `tests/test_run_roster.py`

- [ ] **Step 1: Write failing tests for the single-add / list / patch / remove flow**

Create `backend/tests/test_run_roster.py`:

```python
from tests.test_runs import _seed_minimal_publishable_version


def _make_run(admin_client, db, groups_enabled=False):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    return admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={
            "title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
            "groups_enabled": groups_enabled,
        },
    ).json()


def test_add_student_creates_user_and_enrollment(admin_client, db):
    from mathion.models_auth import StudentEnrollment, User
    run = _make_run(admin_client, db)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "alice@example.com"}
    )
    assert response.status_code == 201
    assert response.json()["user_email"] == "alice@example.com"
    user = db.query(User).filter_by(email="alice@example.com").one()
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=user.id, version_id=run["version_id"]
    ).one()
    assert enrollment.is_active is True


def test_add_student_with_group(admin_client, db):
    from mathion.models import Group
    run = _make_run(admin_client, db, groups_enabled=True)
    g = Group(run_id=run["id"], name="A")
    db.add(g); db.commit(); db.refresh(g)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "a@example.com", "group_id": g.id}
    )
    assert response.status_code == 201
    assert response.json()["group_id"] == g.id


def test_group_capacity_enforced_at_10(admin_client, db):
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    run = _make_run(admin_client, db, groups_enabled=True)
    g = Group(run_id=run["id"], name="A")
    db.add(g); db.flush()
    for i in range(10):
        u = User(email=f"u{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "overflow@example.com", "group_id": g.id}
    )
    assert response.status_code == 409


def test_list_students(admin_client, db):
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "b@example.com"})
    response = admin_client.get(f"/api/runs/{run['id']}/students")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_patch_student_change_group(admin_client, db):
    from mathion.models import Group
    run = _make_run(admin_client, db, groups_enabled=True)
    g1 = Group(run_id=run["id"], name="A"); db.add(g1)
    g2 = Group(run_id=run["id"], name="B"); db.add(g2)
    db.commit(); db.refresh(g1); db.refresh(g2)
    s = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "x@example.com", "group_id": g1.id}
    ).json()
    response = admin_client.patch(
        f"/api/runs/{run['id']}/students/{s['user_id']}", json={"group_id": g2.id}
    )
    assert response.status_code == 200
    assert response.json()["group_id"] == g2.id


def test_remove_student_deactivates_enrollment_when_no_other_run(admin_client, db):
    from mathion.models_auth import StudentEnrollment
    run = _make_run(admin_client, db)
    s = admin_client.post(
        f"/api/runs/{run['id']}/students", json={"email": "x@example.com"}
    ).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/students/{s['user_id']}")
    assert response.status_code == 204
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=s["user_id"], version_id=run["version_id"]
    ).one()
    assert enrollment.is_active is False


def test_remove_student_keeps_enrollment_if_other_run_exists(admin_client, db):
    from mathion.models_auth import StudentEnrollment
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run1 = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R1", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    run2 = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R2", "start_date": "2026-07-01", "end_date": "2026-12-01"}).json()
    s = admin_client.post(
        f"/api/runs/{run1['id']}/students", json={"email": "x@example.com"}
    ).json()
    admin_client.post(
        f"/api/runs/{run2['id']}/students", json={"email": "x@example.com"}
    )
    admin_client.delete(f"/api/runs/{run1['id']}/students/{s['user_id']}")
    enrollment = db.query(StudentEnrollment).filter_by(
        user_id=s["user_id"], version_id=run1["version_id"]
    ).one()
    assert enrollment.is_active is True


def test_add_student_writes_run_enrolled_notification(admin_client, db):
    from mathion.models_auth import NotificationLogEntry
    run = _make_run(admin_client, db)
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    rows = db.query(NotificationLogEntry).filter_by(kind="run_enrolled").all()
    assert len(rows) == 1
    assert rows[0].payload["run_id"] == run["id"]


def test_unrelated_user_cannot_add_student(auth_client, admin_client, db):
    run = _make_run(admin_client, db)
    response = auth_client.post(f"/api/runs/{run['id']}/students", json={"email": "x@example.com"})
    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to confirm failures**

Run: `.venv/bin/pytest tests/test_run_roster.py -v`
Expected: All fail (404 / NameError).

- [ ] **Step 3: Add `_enroll_user_in_run` helper to `mathion/api/helpers.py`**

Append:

```python
def _enroll_user_in_run(db: Session, user, run, group_id: int | None):
    """Enroll a user in a run.

    1. Group capacity check (max 10 if group_id given).
    2. Activate StudentEnrollment for run.version_id (deactivates other active
       enrollments on this course via the existing `_enroll_user`).
    3. Create or update RunStudent row.
    4. Write a `run_enrolled` notification log row.

    Caller must commit. Raises HTTPException on capacity / disabled-version.
    """
    from sqlalchemy import func
    from mathion.api.enrollment import _enroll_user
    from mathion.models import CourseVersion, RunStudent
    from mathion.models_auth import NotificationLogEntry

    version = db.get(CourseVersion, run.version_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Run version is disabled")

    if group_id is not None:
        count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id))
        if count >= 10:
            raise HTTPException(status_code=409, detail="Group capacity reached")

    _enroll_user(db, user, version.course_id, version)

    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run.id, RunStudent.user_id == user.id)
    ).scalar_one_or_none()
    if rs:
        rs.group_id = group_id
    else:
        rs = RunStudent(run_id=run.id, user_id=user.id, group_id=group_id)
        db.add(rs)
        db.flush()

    db.add(NotificationLogEntry(
        user_id=user.id,
        kind="run_enrolled",
        payload={
            "run_id": run.id,
            "course_slug": version.course.slug,
            "title": run.title,
        },
    ))
    return rs
```

- [ ] **Step 4: Implement `mathion/api/run_roster.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.enrollment import _get_or_create_user
from mathion.api.helpers import _enroll_user_in_run, get_or_404, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import CourseVersion, Group, Run, RunStudent
from mathion.models_auth import StudentEnrollment, User
from mathion.schemas import RunStudentCreate, RunStudentResponse, RunStudentUpdate

router = APIRouter(tags=["run_roster"])


def _to_response(rs: RunStudent) -> dict:
    return {
        "id": rs.id, "run_id": rs.run_id, "user_id": rs.user_id,
        "user_email": rs.user.email, "user_full_name": rs.user.full_name,
        "group_id": rs.group_id, "created_at": rs.created_at,
    }


@router.post("/api/runs/{run_id}/students", status_code=201, response_model=RunStudentResponse)
def add_student(run_id: int, data: RunStudentCreate, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    if data.group_id is not None:
        g = db.get(Group, data.group_id)
        if g is None or g.run_id != run_id:
            raise HTTPException(status_code=400, detail="Group not in this run")

    target = _get_or_create_user(db, data.email)
    rs = _enroll_user_in_run(db, target, run, data.group_id)
    db.commit()
    db.refresh(rs)
    return _to_response(rs)


@router.get("/api/runs/{run_id}/students", response_model=list[RunStudentResponse])
def list_students(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    rows = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id).order_by(RunStudent.created_at)
    ).scalars().all()
    return [_to_response(rs) for rs in rows]


@router.patch("/api/runs/{run_id}/students/{user_id}", response_model=RunStudentResponse)
def patch_student(run_id: int, user_id: int, data: RunStudentUpdate,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if not rs:
        raise HTTPException(status_code=404, detail="Student not in run")

    updates = data.model_dump(exclude_unset=True)
    if "group_id" in updates:
        new_gid = updates["group_id"]
        if new_gid is not None:
            g = db.get(Group, new_gid)
            if g is None or g.run_id != run_id:
                raise HTTPException(status_code=400, detail="Group not in this run")
            count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.group_id == new_gid))
            if count >= 10 and rs.group_id != new_gid:
                raise HTTPException(status_code=409, detail="Group capacity reached")
        rs.group_id = new_gid

    db.commit()
    db.refresh(rs)
    return _to_response(rs)


@router.delete("/api/runs/{run_id}/students/{user_id}", status_code=204)
def remove_student(run_id: int, user_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    rs = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id, RunStudent.user_id == user_id)
    ).scalar_one_or_none()
    if not rs:
        raise HTTPException(status_code=404, detail="Student not in run")

    db.delete(rs)
    db.flush()

    # Deactivate StudentEnrollment iff no other RunStudent rows remain on this course's runs
    other = db.execute(
        select(RunStudent)
        .join(Run, Run.id == RunStudent.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunStudent.user_id == user_id,
            CourseVersion.course_id == run.version.course_id,
        )
    ).scalar_one_or_none()
    if other is None:
        enrollment = db.execute(
            select(StudentEnrollment).where(
                StudentEnrollment.user_id == user_id,
                StudentEnrollment.version_id == run.version_id,
            )
        ).scalar_one_or_none()
        if enrollment:
            enrollment.is_active = False
    db.commit()
```

- [ ] **Step 5: Wire router in `mathion/main.py`**

```python
from mathion.api.run_roster import router as run_roster_router
app.include_router(run_roster_router)
```

- [ ] **Step 6: Run tests**

Run: `.venv/bin/pytest tests/test_run_roster.py -v`
Expected: 9/9 pass.

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/api/helpers.py backend/mathion/api/run_roster.py backend/mathion/main.py backend/tests/test_run_roster.py
git commit -m "feat: add run roster endpoints with enrollment cascade"
```

---

### Task 9: Batch enrollment endpoint

**Files:**
- Modify: `mathion/api/run_roster.py`
- Modify: `tests/test_run_roster.py`

- [ ] **Step 1: Append batch tests to `tests/test_run_roster.py`**

```python
def test_batch_add_auto_creates_groups(admin_client, db):
    run = _make_run(admin_client, db, groups_enabled=True)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [
            {"name": "Alice", "email": "alice@example.com", "group": "Team A"},
            {"name": "Bob",   "email": "bob@example.com",   "group": "Team B"},
        ]},
    )
    assert response.status_code == 207
    body = response.json()
    assert len(body["results"]) == 2
    assert all(r["status"] == "added" for r in body["results"])
    groups = admin_client.get(f"/api/runs/{run['id']}/groups").json()
    assert {g["name"] for g in groups} == {"Team A", "Team B"}


def test_batch_add_per_row_errors_do_not_abort(admin_client, db):
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    run = _make_run(admin_client, db, groups_enabled=True)
    g = Group(run_id=run["id"], name="Full")
    db.add(g); db.flush()
    for i in range(10):
        u = User(email=f"f{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [
            {"email": "ok@example.com", "group": "OK"},
            {"email": "fail@example.com", "group": "Full"},
        ]},
    )
    assert response.status_code == 207
    body = response.json()
    assert body["results"][0]["status"] == "added"
    assert body["results"][1]["status"] == "error"


def test_batch_add_no_group_field(admin_client, db):
    run = _make_run(admin_client, db, groups_enabled=False)
    response = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [{"email": "x@example.com"}]},
    )
    assert response.status_code == 207
    assert response.json()["results"][0]["status"] == "added"
```

- [ ] **Step 2: Run tests to confirm failures**

Run: `.venv/bin/pytest tests/test_run_roster.py::test_batch_add_auto_creates_groups -v`
Expected: 404.

- [ ] **Step 3: Append the batch endpoint to `mathion/api/run_roster.py`**

Per-row errors must NOT abort the batch. We use SAVEPOINTs (`db.begin_nested()`) so a failed row rolls back only that row's attempted writes. Pre-create the user *outside* the savepoint — `_get_or_create_user` does its own `db.rollback()` on duplicate-email races, which would blow past the savepoint if it fired inside.

```python
from fastapi.responses import JSONResponse

from mathion.schemas import RunStudentBatchRequest


@router.post("/api/runs/{run_id}/students/batch")
def add_students_batch(
    run_id: int,
    data: RunStudentBatchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_run_admin_or_teacher(db, user, run_id)
    run = db.get(Run, run_id)
    results = []

    for row in data.rows:
        # User creation happens at the outer transaction; safe to keep even if
        # the per-row enrollment later fails.
        target = _get_or_create_user(db, row.email)
        if row.name and not target.full_name:
            target.full_name = row.name

        sp = db.begin_nested()
        try:
            gid: int | None = None
            if row.group:
                g = db.execute(
                    select(Group).where(Group.run_id == run_id, Group.name == row.group)
                ).scalar_one_or_none()
                if g is None:
                    g = Group(run_id=run_id, name=row.group)
                    db.add(g)
                    db.flush()
                gid = g.id

            rs = _enroll_user_in_run(db, target, run, gid)
            db.flush()
            sp.commit()
            results.append({"email": row.email, "status": "added", "group_id": rs.group_id})
        except HTTPException as e:
            sp.rollback()
            results.append({"email": row.email, "status": "error", "detail": e.detail})
        except Exception as e:  # noqa: BLE001
            sp.rollback()
            results.append({"email": row.email, "status": "error", "detail": str(e)})

    db.commit()
    return JSONResponse(status_code=207, content={"results": results})
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_run_roster.py -v`
Expected: All previous + 3 new tests pass (12 total).

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/run_roster.py backend/tests/test_run_roster.py
git commit -m "feat: add batch student enrollment endpoint with auto-group creation"
```

---

### Task 10: Publish / unpublish + publish-gate + run_published notification

**Files:**
- Modify: `mathion/api/runs.py`
- Modify: `tests/test_runs.py`

- [ ] **Step 1: Append publish tests to `tests/test_runs.py`**

```python
def test_publish_run_no_teachers_409(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 409
    assert "teacher" in response.json()["detail"].lower()


def test_publish_run_with_teacher_succeeds(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 200
    assert response.json()["is_published"] is True


def test_publish_with_groups_enabled_unassigned_student_409(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
              "groups_enabled": True}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "s@example.com"})
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 409


def test_publish_with_oversized_group_409(admin_client, db):
    """Currently group capacity is enforced at 10 on add, so this guards against
    DB-level inconsistency (e.g., manual seeding) reaching publish."""
    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
              "groups_enabled": True}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    g = Group(run_id=run["id"], name="X")
    db.add(g); db.flush()
    for i in range(11):
        u = User(email=f"u{i}@example.com")
        db.add(u); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=u.id, group_id=g.id))
    db.commit()
    response = admin_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 409


def test_unpublish_run(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    response = admin_client.post(f"/api/runs/{run['id']}/unpublish")
    assert response.status_code == 200
    assert response.json()["is_published"] is False


def test_delete_published_run_409(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 409


def test_patch_groups_enabled_after_publish_409(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    response = admin_client.patch(f"/api/runs/{run['id']}", json={"groups_enabled": True})
    assert response.status_code == 409


def test_publish_writes_run_published_notification_per_student(admin_client, db):
    from mathion.models_auth import NotificationLogEntry
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "a@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "b@example.com"})
    admin_client.post(f"/api/runs/{run['id']}/publish")
    rows = db.query(NotificationLogEntry).filter_by(kind="run_published").all()
    assert len(rows) == 2


def test_teacher_cannot_publish(teacher_client, admin_client, db, teacher_user):
    from mathion.models import RunTeacher
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"}).json()
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id)); db.commit()
    response = teacher_client.post(f"/api/runs/{run['id']}/publish")
    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to confirm failures**

Run: `.venv/bin/pytest tests/test_runs.py -k "publish or unpublish" -v`
Expected: 404.

- [ ] **Step 3: Add publish/unpublish endpoints to `mathion/api/runs.py`**

Append:

```python
from sqlalchemy import func
from mathion.models import Group, RunStudent, RunTeacher
from mathion.models_auth import NotificationLogEntry


@router.post("/api/runs/{run_id}/publish", response_model=RunResponse)
def publish_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)
    if run.is_published:
        raise HTTPException(status_code=409, detail="Run is already published")

    violations: list[str] = []

    teacher_count = db.scalar(
        select(func.count(RunTeacher.id)).where(RunTeacher.run_id == run_id)
    )
    if teacher_count == 0:
        violations.append("at least one teacher required")

    if run.groups_enabled:
        unassigned = db.scalar(
            select(func.count(RunStudent.id)).where(
                RunStudent.run_id == run_id, RunStudent.group_id.is_(None)
            )
        )
        if unassigned > 0:
            violations.append(f"{unassigned} student(s) unassigned to a group")

        oversized = db.execute(
            select(Group.id, Group.name, func.count(RunStudent.id))
            .outerjoin(RunStudent, RunStudent.group_id == Group.id)
            .where(Group.run_id == run_id)
            .group_by(Group.id)
            .having(func.count(RunStudent.id) > 10)
        ).all()
        for _, gname, cnt in oversized:
            violations.append(f"group '{gname}' has {cnt} students (max 10)")

    if violations:
        raise HTTPException(status_code=409, detail="; ".join(violations))

    run.is_published = True
    db.flush()

    students = db.execute(
        select(RunStudent).where(RunStudent.run_id == run_id)
    ).scalars().all()
    for rs in students:
        db.add(NotificationLogEntry(
            user_id=rs.user_id,
            kind="run_published",
            payload={
                "run_id": run.id,
                "course_slug": version.course.slug,
                "title": run.title,
            },
        ))

    db.commit()
    db.refresh(run)
    return run


@router.post("/api/runs/{run_id}/unpublish", response_model=RunResponse)
def unpublish_run(run_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    run = get_or_404(db, Run, run_id)
    version = get_or_404(db, CourseVersion, run.version_id)
    require_course_admin(db, user, version.course_id)
    if not run.is_published:
        raise HTTPException(status_code=409, detail="Run is not published")
    run.is_published = False
    db.commit()
    db.refresh(run)
    return run
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/pytest tests/test_runs.py -v`
Expected: All run tests pass (16+).

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/runs.py backend/tests/test_runs.py
git commit -m "feat: add run publish/unpublish with publish-gate"
```

---

### Task 11: Notification log integration test

**Files:**
- Create: `tests/test_run_notifications.py`

- [ ] **Step 1: Write a single integration test that verifies all three kinds**

Create `backend/tests/test_run_notifications.py`:

```python
from mathion.models_auth import NotificationLogEntry

from tests.test_runs import _seed_minimal_publishable_version


def test_full_run_lifecycle_writes_three_notification_kinds(admin_client, db):
    course, _ = _seed_minimal_publishable_version(admin_client, db)
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    ).json()

    # 1. run_teacher_assigned
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "teacher@example.com"})

    # 2. run_enrolled
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "alice@example.com"})

    # 3. run_published (one row per student)
    admin_client.post(f"/api/runs/{run['id']}/publish")

    rows = db.query(NotificationLogEntry).all()
    by_kind = {}
    for r in rows:
        by_kind.setdefault(r.kind, []).append(r)

    assert "run_teacher_assigned" in by_kind
    assert "run_enrolled" in by_kind
    assert "run_published" in by_kind

    for r in rows:
        assert "run_id" in r.payload
        assert r.sent_at is None  # phase 9 hasn't run
```

- [ ] **Step 2: Run the test**

Run: `.venv/bin/pytest tests/test_run_notifications.py -v`
Expected: 1/1 pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_run_notifications.py
git commit -m "test: integration coverage for run notification log entries"
```

---

### Task 12: Final regression sweep

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `.venv/bin/pytest -v`
Expected: All tests pass. Target: ~330 + ~50 new = ~380 tests, 0 failures, 0 errors. Note any unexpected warnings.

- [ ] **Step 2: Run linter / formatter sanity checks**

Run: `.venv/bin/python -c "from mathion.main import app; print('routes:', len(app.routes))"`
Expected: app loads cleanly with all run/teacher/group/roster routes registered.

- [ ] **Step 3: Quick manual smoke via httpie or curl (optional)**

If you want a sanity check beyond tests, start the dev server and POST a course → version → publish → run → teacher → student → publish run cycle. Skip if green tests are sufficient.

- [ ] **Step 4: Commit any minor fixes discovered during sweep**

If anything was tweaked:

```bash
git add -p  # review hunks
git commit -m "fix: <concise description of any nit>"
```

If nothing was tweaked, this task is purely verification.

- [ ] **Step 5: Final phase commit marker (optional)**

If you want a clean phase marker commit:

```bash
git commit --allow-empty -m "chore: phase 7a complete"
```

---

## Notes for the Implementer

- **TDD is non-negotiable.** Write tests first, watch them fail with the expected error, implement, watch them pass, commit. Don't write production code without a failing test.
- **`db.flush()` vs `db.commit()`** — the helpers in this plan flush but defer commit to the route handler so multi-step routes are atomic. Don't add stray commits inside helpers.
- **Test fixture cookies** — `auth_client` and `admin_client` (and now `teacher_client`) use independent cookie jars. Tests that mix two of them in the same test will not have cookie collisions.
- **Seeding via direct DB inserts** is preferred over heavy API setup for non-target areas of a test (e.g., creating a 10-person group in `test_group_capacity_enforced_at_10`). Use the API only when the test's target is the API.
- **Cross-test imports** — `tests/test_runs.py` defines `_seed_minimal_publishable_version`; subsequent test files import it. This avoids duplicating 15+ lines of setup.
- **Don't forget `from datetime import date`** — schemas use it; migrations use `sa.Date()`.
- **Phase 7b hooks** referenced in the spec (end_date lowering with submissions) are not implemented in 7a. The end_date check in `patch_run` is intentionally permissive in this phase.
