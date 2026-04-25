# Phase 3: Student Course View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend APIs that power the student course experience: progress tracking, state persistence, course list with progress summaries, and version routing by course slug.

**Architecture:** UserItemState model tracks per-user, per-item progress (time spent, covered status, quiz attempts). State JSON endpoint returns all item states for a version. Tracking endpoints accept progress updates from the frontend. Student course list aggregates progress across enrollments.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.x, Pydantic v2, pytest

**Spec:** `docs/superpowers/specs/2026-04-19-mathion-platform-design.md` (Sections 2, 4)

**Existing code:** 155 passing tests, 12 models, ~30 API endpoints. Venv at `backend/.venv`.

---

## File Structure

### New files
- `backend/mathion/api/student.py` — Student-facing endpoints (my-courses, version routing, state, tracking)
- `backend/tests/test_student.py` — Tests for all student endpoints

### Modified files
- `backend/mathion/models_auth.py` — Add UserItemState model
- `backend/mathion/models.py` — Update import registration
- `backend/mathion/schemas.py` — Add state/tracking/student schemas
- `backend/mathion/main.py` — Register student router

---

### Task 1: UserItemState Model

**Files:**
- Modify: `backend/mathion/models_auth.py`
- Modify: `backend/mathion/models.py`
- Create: `backend/tests/test_student.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_student.py`:

```python
from datetime import datetime, timezone

from mathion.models import Block, Course, CourseVersion, Item, Sequence
from mathion.models_auth import User, UserItemState


def _make_item_and_user(db):
    """Create a course structure with one item and one enrolled user."""
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="published", info_md="", info_html="")
    db.add(version)
    db.commit()
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()
    item = Item(sequence_id=seq.id, title="Intro", slug="intro", order=1, type="static_page",
                content_md="# Hello", content_html="<h1>Hello</h1>")
    db.add(item)
    db.commit()
    user = User(email="student@example.com", full_name="Student")
    db.add(user)
    db.commit()
    db.refresh(item)
    db.refresh(user)
    db.refresh(version)
    return item, user, version


def test_create_user_item_state(db):
    item, user, version = _make_item_and_user(db)
    state = UserItemState(
        user_id=user.id,
        item_id=item.id,
        is_covered=False,
        time_spent=0,
    )
    db.add(state)
    db.commit()
    db.refresh(state)

    assert state.id is not None
    assert state.is_covered is False
    assert state.time_spent == 0
    assert state.attempt_count == 0
    assert state.last_answers is None
    assert state.last_score_correct is None
    assert state.last_score_total is None


def test_user_item_state_unique_per_user_per_item(db):
    import pytest
    from sqlalchemy.exc import IntegrityError

    item, user, version = _make_item_and_user(db)
    s1 = UserItemState(user_id=user.id, item_id=item.id, is_covered=False, time_spent=0)
    db.add(s1)
    db.commit()
    s2 = UserItemState(user_id=user.id, item_id=item.id, is_covered=True, time_spent=100)
    db.add(s2)
    with pytest.raises(IntegrityError):
        db.commit()


def test_update_item_state(db):
    item, user, version = _make_item_and_user(db)
    state = UserItemState(user_id=user.id, item_id=item.id, is_covered=False, time_spent=0)
    db.add(state)
    db.commit()

    state.time_spent = 120
    state.is_covered = True
    state.last_visited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(state)

    assert state.time_spent == 120
    assert state.is_covered is True
```

- [ ] **Step 2: Run to verify fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/pytest tests/test_student.py -v
```

Expected: FAIL — `ImportError: cannot import name 'UserItemState'`

- [ ] **Step 3: Implement UserItemState model**

Add to `backend/mathion/models_auth.py`:

```python
from sqlalchemy import JSON, UniqueConstraint


class UserItemState(Base):
    __tablename__ = "user_item_states"
    __table_args__ = (
        UniqueConstraint("user_id", "item_id", name="uq_user_item_state"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True)
    is_covered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    time_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # seconds
    last_visited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Quiz-specific fields
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_answers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_score_correct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_score_total: Mapped[int | None] = mapped_column(Integer, nullable=True)

    user: Mapped["User"] = relationship()
```

Note: `JSON` import needed from sqlalchemy. `UniqueConstraint` may already be imported — check first.

Update `backend/mathion/models.py` bottom import:
```python
from mathion.models_auth import User, Session, LoginPIN, StudentEnrollment, RateLimitEntry, UserItemState  # noqa: F401
```

- [ ] **Step 4: Run tests**

```bash
.venv/bin/pytest tests/ -v
```

Expected: all PASS (155 old + 3 new)

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: add UserItemState model for progress tracking"
```

---

### Task 2: State JSON Endpoint

**Files:**
- Modify: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/student.py`
- Modify: `backend/mathion/main.py`
- Modify: `backend/tests/test_student.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_student.py`:

```python
from mathion.models_auth import StudentEnrollment, UserItemState


def _setup_enrolled_student(client, db):
    """Create course, publish version, create student, enroll, return (version, student, token).
    Uses admin_client to set up course, then creates a student with their own session."""
    from mathion.auth import request_pin, verify_pin

    # Create course and version via admin
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "Welcome"}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    seq = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1", "slug": "s1",
    }).json()
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page", "content_md": "# Hello",
    })
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Quiz", "slug": "quiz", "type": "quiz",
    })
    client.post(f"/api/versions/{version['id']}/publish")

    # Create student and enroll
    student = User(email="student@example.com", full_name="Student")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()

    # Get student session
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    db.refresh(student)
    return version, student, token, course


def test_api_get_state_json(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Create a student client
    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db
    student_client = TestClient(app)
    def override():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[get_db] = override
    student_client.cookies.set("session_token", token)

    response = student_client.get(f"/api/versions/{version['id']}/state")
    assert response.status_code == 200
    data = response.json()

    assert data["version_id"] == version["id"]
    assert "items" in data
    # No states yet — items dict should be empty
    assert data["items"] == {}

    app.dependency_overrides.clear()


def test_api_get_state_json_with_progress(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Add some progress
    from mathion.models import Item
    items = db.query(Item).all()
    intro_item = [i for i in items if i.slug == "intro"][0]

    state = UserItemState(
        user_id=student.id,
        item_id=intro_item.id,
        is_covered=True,
        time_spent=120,
    )
    db.add(state)
    db.commit()

    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db
    student_client = TestClient(app)
    def override():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[get_db] = override
    student_client.cookies.set("session_token", token)

    response = student_client.get(f"/api/versions/{version['id']}/state")
    assert response.status_code == 200
    data = response.json()

    assert str(intro_item.id) in data["items"]
    item_state = data["items"][str(intro_item.id)]
    assert item_state["is_covered"] is True
    assert item_state["time_spent"] == 120

    app.dependency_overrides.clear()


def test_api_get_state_json_unenrolled_returns_403(auth_client):
    response = auth_client.get("/api/versions/999/state")
    assert response.status_code in (403, 404)
```

- [ ] **Step 2: Implement state schemas**

Add to `backend/mathion/schemas.py`:

```python
class ItemStateResponse(BaseModel):
    is_covered: bool
    time_spent: int
    last_visited_at: datetime | None = None
    attempt_count: int = 0
    max_attempts: int = 3
    last_score: dict | None = None  # {"correct": N, "total": N}
    last_answers: dict | None = None


class StateJsonResponse(BaseModel):
    version_id: int
    current_item_id: int | None = None
    items: dict[str, ItemStateResponse]  # keyed by item ID as string
```

- [ ] **Step 3: Implement state endpoint**

Create `backend/mathion/api/student.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Course, CourseVersion, Item, Sequence
from mathion.models_auth import StudentEnrollment, User, UserItemState
from mathion.schemas import StateJsonResponse, ItemStateResponse

router = APIRouter(tags=["student"])


def _check_version_access(db: Session, user: User, version_id: int) -> CourseVersion:
    """Verify user has access to this version (enrolled or admin)."""
    version = get_or_404(db, CourseVersion, version_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if user.is_superuser:
        return version
    # Check enrollment (active or inactive)
    from mathion.models import CourseAdmin
    is_admin = db.execute(
        select(CourseAdmin).where(CourseAdmin.course_id == version.course_id, CourseAdmin.user_id == user.id)
    ).scalar_one_or_none()
    if is_admin:
        return version
    is_enrolled = db.execute(
        select(StudentEnrollment).where(
            StudentEnrollment.version_id == version_id,
            StudentEnrollment.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not is_enrolled:
        raise HTTPException(status_code=403, detail="Access denied")
    return version


@router.get("/api/versions/{version_id}/state", response_model=StateJsonResponse)
def get_state_json(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    version = _check_version_access(db, user, version_id)

    # Get all item IDs for this version
    item_ids = db.execute(
        select(Item.id)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version_id)
    ).scalars().all()

    # Get user states for these items
    states = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id.in_(item_ids),
        )
    ).scalars().all()

    items_dict = {}
    for s in states:
        last_score = None
        if s.last_score_correct is not None and s.last_score_total is not None:
            last_score = {"correct": s.last_score_correct, "total": s.last_score_total}

        items_dict[str(s.item_id)] = ItemStateResponse(
            is_covered=s.is_covered,
            time_spent=s.time_spent,
            last_visited_at=s.last_visited_at,
            attempt_count=s.attempt_count,
            max_attempts=version.max_quiz_attempts,
            last_score=last_score,
            last_answers=s.last_answers,
        )

    return StateJsonResponse(
        version_id=version_id,
        current_item_id=None,  # Could be tracked separately
        items=items_dict,
    )
```

Register in `main.py`:
```python
from mathion.api.student import router as student_router
app.include_router(student_router)
```

- [ ] **Step 4: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add state JSON endpoint for student progress"
```

---

### Task 3: Item Tracking Endpoint

**Files:**
- Modify: `backend/mathion/api/student.py`
- Modify: `backend/mathion/schemas.py`
- Modify: `backend/tests/test_student.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_student.py`:

```python
def _make_student_client(db, token):
    """Create a TestClient with student auth."""
    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db
    sc = TestClient(app)
    def override():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[get_db] = override
    sc.cookies.set("session_token", token)
    return sc


def test_api_track_item(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    sc = _make_student_client(db, token)

    from mathion.models import Item
    items = db.query(Item).all()
    intro_item = [i for i in items if i.slug == "intro"][0]

    response = sc.post(f"/api/items/{intro_item.id}/track", json={
        "time_spent": 45,
    }, headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    data = response.json()
    assert data["time_spent"] == 45
    assert data["is_covered"] is False

    app.dependency_overrides.clear()


def test_api_track_item_accumulates_time(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    sc = _make_student_client(db, token)

    from mathion.models import Item
    items = db.query(Item).all()
    intro_item = [i for i in items if i.slug == "intro"][0]

    sc.post(f"/api/items/{intro_item.id}/track", json={"time_spent": 20},
            headers={"X-Requested-With": "mathion"})
    response = sc.post(f"/api/items/{intro_item.id}/track", json={"time_spent": 30},
                       headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert response.json()["time_spent"] == 50  # accumulated

    app.dependency_overrides.clear()


def test_api_track_item_mark_covered(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    sc = _make_student_client(db, token)

    from mathion.models import Item
    items = db.query(Item).all()
    intro_item = [i for i in items if i.slug == "intro"][0]

    response = sc.post(f"/api/items/{intro_item.id}/track", json={
        "time_spent": 30, "is_covered": True,
    }, headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert response.json()["is_covered"] is True

    app.dependency_overrides.clear()
```

- [ ] **Step 2: Implement tracking schema**

Add to `backend/mathion/schemas.py`:

```python
class TrackItemRequest(BaseModel):
    time_spent: int = Field(ge=0)  # seconds to add
    is_covered: bool | None = None  # set to True to mark covered
```

- [ ] **Step 3: Implement tracking endpoint**

Add to `backend/mathion/api/student.py`:

```python
from datetime import datetime, timezone
from mathion.schemas import TrackItemRequest


@router.post("/api/items/{item_id}/track")
def track_item(item_id: int, data: TrackItemRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = get_or_404(db, Item, item_id)

    # Verify user has access to this item's version
    seq = db.get(Sequence, item.sequence_id)
    block = db.get(Block, seq.block_id)
    _check_version_access(db, user, block.version_id)

    # Get or create state
    state = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()

    if not state:
        state = UserItemState(user_id=user.id, item_id=item_id, is_covered=False, time_spent=0)
        db.add(state)

    state.time_spent += data.time_spent
    state.last_visited_at = datetime.now(timezone.utc)
    if data.is_covered is True:
        state.is_covered = True

    db.commit()
    db.refresh(state)

    return {
        "item_id": state.item_id,
        "is_covered": state.is_covered,
        "time_spent": state.time_spent,
        "last_visited_at": state.last_visited_at.isoformat() if state.last_visited_at else None,
    }
```

- [ ] **Step 4: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add item tracking endpoint for progress updates"
```

---

### Task 4: Student Course List with Progress

**Files:**
- Modify: `backend/mathion/api/student.py`
- Modify: `backend/mathion/schemas.py`
- Modify: `backend/tests/test_student.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_student.py`:

```python
def test_api_my_courses(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    sc = _make_student_client(db, token)

    response = sc.get("/api/my-courses")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["course"]["slug"] == "stats"
    assert data[0]["version_id"] == version["id"]
    assert data[0]["total_items"] == 2
    assert data[0]["covered_items"] == 0

    app.dependency_overrides.clear()


def test_api_my_courses_with_progress(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)

    # Mark one item as covered
    from mathion.models import Item
    intro = db.query(Item).filter_by(slug="intro").first()
    state = UserItemState(user_id=student.id, item_id=intro.id, is_covered=True, time_spent=60)
    db.add(state)
    db.commit()

    sc = _make_student_client(db, token)
    response = sc.get("/api/my-courses")
    data = response.json()
    assert data[0]["covered_items"] == 1
    assert data[0]["total_items"] == 2

    app.dependency_overrides.clear()


def test_api_my_courses_empty(auth_client):
    response = auth_client.get("/api/my-courses")
    assert response.status_code == 200
    assert response.json() == []
```

- [ ] **Step 2: Implement my-courses schema**

Add to `backend/mathion/schemas.py`:

```python
class MyCourseResponse(BaseModel):
    course: CourseResponse
    version_id: int
    version_state: str
    total_items: int
    covered_items: int
    is_active: bool
```

- [ ] **Step 3: Implement my-courses endpoint**

Add to `backend/mathion/api/student.py`:

```python
from mathion.schemas import MyCourseResponse, CourseResponse


@router.get("/api/my-courses", response_model=list[MyCourseResponse])
def my_courses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enrollments = db.execute(
        select(StudentEnrollment)
        .where(StudentEnrollment.user_id == user.id)
        .order_by(StudentEnrollment.created_at.desc())
    ).scalars().all()

    results = []
    seen_courses = set()

    for enrollment in enrollments:
        version = db.get(CourseVersion, enrollment.version_id)
        if not version or version.is_disabled:
            continue

        # Only show the most recent enrollment per course
        if version.course_id in seen_courses:
            continue
        seen_courses.add(version.course_id)

        course = db.get(Course, version.course_id)

        # Count total items in this version
        total_items = db.scalar(
            select(func.count())
            .select_from(Item)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(Block.version_id == version.id)
        )

        # Count covered items for this user
        covered_items = db.scalar(
            select(func.count())
            .select_from(UserItemState)
            .join(Item, Item.id == UserItemState.item_id)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(
                Block.version_id == version.id,
                UserItemState.user_id == user.id,
                UserItemState.is_covered == True,
            )
        )

        results.append(MyCourseResponse(
            course=CourseResponse.model_validate(course),
            version_id=version.id,
            version_state=version.state,
            total_items=total_items or 0,
            covered_items=covered_items or 0,
            is_active=enrollment.is_active,
        ))

    return results
```

Add `func` import:
```python
from sqlalchemy import func, select
```

- [ ] **Step 4: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add student course list with progress summary"
```

---

### Task 5: Version Routing by Course Slug

**Files:**
- Modify: `backend/mathion/api/student.py`
- Modify: `backend/tests/test_student.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_student.py`:

```python
def test_api_resolve_version(admin_client, db):
    version, student, token, course = _setup_enrolled_student(admin_client, db)
    sc = _make_student_client(db, token)

    response = sc.get(f"/api/courses/stats/my-version")
    assert response.status_code == 200
    data = response.json()
    assert data["version_id"] == version["id"]
    assert data["course_slug"] == "stats"

    app.dependency_overrides.clear()


def test_api_resolve_version_not_enrolled(auth_client):
    response = auth_client.get("/api/courses/nonexistent/my-version")
    assert response.status_code == 404


def test_api_resolve_version_no_enrollment(admin_client, db, auth_client):
    # Create a course but don't enroll test_user
    admin_client.post("/api/courses", json={"slug": "physics", "name": "Physics", "description": ""})
    response = auth_client.get("/api/courses/physics/my-version")
    assert response.status_code == 404
```

- [ ] **Step 2: Implement version routing endpoint**

Add to `backend/mathion/api/student.py`:

```python
@router.get("/api/courses/{course_slug}/my-version")
def resolve_my_version(course_slug: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Resolve a course slug to the user's enrolled version."""
    course = db.execute(select(Course).where(Course.slug == course_slug)).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Find user's most recent enrollment on any version of this course
    enrollment = db.execute(
        select(StudentEnrollment)
        .join(CourseVersion, CourseVersion.id == StudentEnrollment.version_id)
        .where(
            CourseVersion.course_id == course.id,
            StudentEnrollment.user_id == user.id,
        )
        .order_by(StudentEnrollment.is_active.desc(), StudentEnrollment.created_at.desc())
    ).scalar_one_or_none()

    if not enrollment:
        raise HTTPException(status_code=404, detail="Not enrolled in this course")

    return {
        "course_slug": course_slug,
        "course_id": course.id,
        "version_id": enrollment.version_id,
        "is_active": enrollment.is_active,
    }
```

- [ ] **Step 3: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add version routing by course slug for students"
```

---

### Task 6: Alembic Migration

**Files:**
- Generate: `backend/alembic/versions/` (new migration)

- [ ] **Step 1: Update alembic env.py imports**

Add `UserItemState` to the imports in `backend/alembic/env.py`:
```python
from mathion.models_auth import (
    LoginPIN, RateLimitEntry, Session, StudentEnrollment, User, UserItemState,
)
```

- [ ] **Step 2: Generate migration**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/alembic revision --autogenerate -m "add user item states"
```

- [ ] **Step 3: Test migration**

```bash
MATHION_DATABASE_URL=sqlite:///./test_migration.db .venv/bin/alembic upgrade head
rm -f test_migration.db
```

- [ ] **Step 4: Run full test suite and commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/alembic/
git commit -m "feat: add migration for user item states"
```

---

## Summary

After completing all 6 tasks, Phase 3 delivers:

- **Model:** UserItemState (per-user, per-item progress with quiz tracking)
- **API endpoints:**
  - `GET /api/versions/{id}/state` — User's state JSON for a version (all item states)
  - `POST /api/items/{id}/track` — Update time spent and covered status
  - `GET /api/my-courses` — Student's enrolled courses with progress summaries
  - `GET /api/courses/{slug}/my-version` — Resolve course slug to enrolled version ID
- **Access control:** All endpoints require auth + enrollment/admin check

**Not included (deferred):**
- Quiz answer submission and evaluation (Phase 5)
- ETag/caching on state JSON (optimization)
- Current item tracking across sessions (can be added later)
