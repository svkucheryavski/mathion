# Frontend Admin Course Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first slice of the Mathion course-admin editor — admins author courses end-to-end (versions → blocks → sequences → items → publish) layered into the existing Svelte 5 student frontend.

**Architecture:** Drill-in pages backed by a single admin-tree fetch, explicit Save/Discard with a router-level dirty-guard, server-rendered markdown preview, ↑/↓ reorder. Backend gets 9 small additions/changes; frontend gets 5 pages, 3 editor components, 4 lib modules, and one router contract change.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic; Svelte 5 (no runtime JS deps); Vite; pytest + vitest.

**Spec:** [`docs/superpowers/specs/2026-05-06-frontend-admin-course-editor-design.md`](../specs/2026-05-06-frontend-admin-course-editor-design.md)

**Conventions baked in:**
- Always invoke pytest/python via `backend/.venv/bin/<tool>`, never bare.
- Tests use existing fixtures: `db`, `client`, `auth_client` (logged-in test_user), `admin_client` (superuser), `teacher_client`. To get a non-superuser course-admin, attach a `CourseAdmin` row to `test_user` and use `auth_client`.
- Frontend tests are vitest unit tests for non-`.svelte` modules. Component-level Svelte tests are out of scope for slice 1; pages are validated via `npm run check` (svelte-check) and the manual smoke list at the end.
- Feature-branch workflow: a single branch off `main`; commit per task; merge at the end.

---

## Task 0: Create the feature branch

- [ ] **Step 1: Create branch off main**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion checkout main
git -C /Users/svkucheryavski/Documents/Developing/mathion pull --ff-only origin main 2>/dev/null || true
git -C /Users/svkucheryavski/Documents/Developing/mathion checkout -b frontend-admin-editor
```

- [ ] **Step 2: Verify clean tree on the new branch**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion status
```
Expected: "On branch frontend-admin-editor / nothing to commit, working tree clean".

- [ ] **Step 3: Confirm test baseline before any change**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test
```
Expected: backend 513 passing (per project memory), frontend tests green. Capture the exact backend count — every later task asserts a target count by adding to it.

---

## Phase 1 — Backend additions

### Task 1: `is_admin` field on `CourseResponse`

**Files:**
- Modify: `backend/mathion/schemas.py:19-26` (`CourseResponse`)
- Modify: `backend/mathion/api/courses.py:16-95` (populate `is_admin` in create/list/get)
- Test: `backend/tests/test_courses.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_courses.py`:

```python
def test_course_response_is_admin_for_superuser(admin_client):
    course = admin_client.post(
        "/api/courses", json={"slug": "s1", "name": "S1", "description": ""}
    ).json()
    # Superuser is admin on every course
    assert course["is_admin"] is True

    listed = admin_client.get("/api/courses").json()
    assert all(c["is_admin"] is True for c in listed)


def test_course_response_is_admin_for_course_admin(client, db, test_user):
    """A non-superuser CourseAdmin sees is_admin=true on their course."""
    from mathion.models import Course, CourseAdmin
    from mathion.auth import request_pin, verify_pin
    from mathion.tests.conftest import CSRFTestClient  # available via tests/conftest
    course = Course(slug="c", name="C", description="")
    db.add(course); db.commit(); db.refresh(course)
    db.add(CourseAdmin(course_id=course.id, user_id=test_user.id))
    db.commit()
    raw = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw, duration_days=7)
    # Use the auth_client pattern inline (test_user → CSRF client with token cookie)
    from fastapi.testclient import TestClient as Base
    # Use the existing app via the same db override the `client` fixture set up
    from mathion.main import app
    c = Base(app)
    c.cookies.set("session_token", token)
    r = c.get(f"/api/courses/{course.id}")
    assert r.status_code == 200
    assert r.json()["is_admin"] is True


def test_course_response_is_admin_false_for_enrolled_student(auth_client, admin_client, db, test_user):
    """Enrolled-but-not-admin sees is_admin=false."""
    from mathion.models import CourseVersion
    from mathion.models_auth import StudentEnrollment
    course = admin_client.post(
        "/api/courses", json={"slug": "c2", "name": "C2", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    db.add(StudentEnrollment(user_id=test_user.id, version_id=version["id"], is_active=True))
    db.commit()
    r = auth_client.get(f"/api/courses/{course['id']}")
    assert r.status_code == 200
    assert r.json()["is_admin"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_courses.py::test_course_response_is_admin_for_superuser tests/test_courses.py::test_course_response_is_admin_for_course_admin tests/test_courses.py::test_course_response_is_admin_false_for_enrolled_student -v
```
Expected: KeyError on `is_admin` (field doesn't exist yet) → 3 failures.

- [ ] **Step 3: Add field + populator helper**

In `backend/mathion/schemas.py`, replace the `CourseResponse` class (lines 19-26) with:

```python
class CourseResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    is_admin: bool = False  # populated per-request; defaults False so model_validate(course) keeps working

    model_config = {"from_attributes": True}
```

In `backend/mathion/api/courses.py`, add a small helper near the top (after imports, before `router = ...`):

```python
def _is_admin_for(db: Session, user: User, course_id: int) -> bool:
    if user.is_superuser:
        return True
    return db.execute(
        select(CourseAdmin.user_id).where(
            CourseAdmin.course_id == course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
```

Then update each endpoint that returns a `CourseResponse` to set the field on the response model. Replace the `return course` lines:

- In `create_course` (currently `return course` at line 26): replace with
  ```python
  out = CourseResponse.model_validate(course)
  out.is_admin = True  # creator is the superuser per require_superuser
  return out
  ```
- In `list_courses` (line ~50, `return courses`): replace with
  ```python
  return [
      CourseResponse.model_validate(c).model_copy(update={"is_admin": _is_admin_for(db, user, c.id)})
      for c in courses
  ]
  ```
- In `get_course` (line ~76, `return course`): replace with
  ```python
  out = CourseResponse.model_validate(course)
  out.is_admin = _is_admin_for(db, user, course.id)
  return out
  ```
- In `update_course` (`return course`): replace with same shape as `get_course`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_courses.py -v
```
Expected: all course tests pass, including the 3 new ones. Existing tests should still pass — `is_admin: bool = False` default keeps `CourseResponse.model_validate(course)` callers in `student.py` working.

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/schemas.py backend/mathion/api/courses.py backend/tests/test_courses.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): add is_admin to CourseResponse"
```

---

### Task 2: `GET /api/courses/by-slug/{slug}`

**Files:**
- Modify: `backend/mathion/api/courses.py` (insert new route between `list_courses` and `get_course`)
- Test: `backend/tests/test_courses.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_courses.py`:

```python
def test_by_slug_admin(client, db, test_user):
    from mathion.models import Course, CourseAdmin
    from mathion.auth import request_pin, verify_pin
    from fastapi.testclient import TestClient as Base
    from mathion.main import app
    course = Course(slug="calc", name="Calc", description="")
    db.add(course); db.commit(); db.refresh(course)
    db.add(CourseAdmin(course_id=course.id, user_id=test_user.id))
    db.commit()
    raw = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw, duration_days=7)
    c = Base(app)
    c.cookies.set("session_token", token)
    r = c.get("/api/courses/by-slug/calc")
    assert r.status_code == 200
    assert r.json()["slug"] == "calc"
    assert r.json()["is_admin"] is True


def test_by_slug_non_admin_forbidden(auth_client, admin_client):
    admin_client.post("/api/courses", json={"slug": "calc", "name": "Calc", "description": ""})
    r = auth_client.get("/api/courses/by-slug/calc")
    assert r.status_code == 403


def test_by_slug_unknown(auth_client):
    r = auth_client.get("/api/courses/by-slug/nope")
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_courses.py::test_by_slug_admin tests/test_courses.py::test_by_slug_non_admin_forbidden tests/test_courses.py::test_by_slug_unknown -v
```
Expected: route doesn't exist → 422 (slug-as-int) or similar.

- [ ] **Step 3: Add the endpoint**

In `backend/mathion/api/courses.py`, **insert this route between `list_courses` and `get_course`** (declaration order matters — must be before `/api/courses/{course_id}` so FastAPI matches it first):

```python
@router.get("/api/courses/by-slug/{slug}", response_model=CourseResponse)
def get_course_by_slug(slug: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    course = db.execute(select(Course).where(Course.slug == slug)).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Not found")
    if not _is_admin_for(db, user, course.id):
        raise HTTPException(status_code=403, detail="Access denied")
    out = CourseResponse.model_validate(course)
    out.is_admin = True
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_courses.py -v
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/api/courses.py backend/tests/test_courses.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): add GET /api/courses/by-slug/{slug}"
```

---

### Task 3: Extend `/api/my-courses` (admin merge + superuser-sees-all + Optional fields)

**Files:**
- Modify: `backend/mathion/schemas.py:237-243` (`MyCourseResponse`)
- Modify: `backend/mathion/api/student.py:146-203` (`my_courses`)
- Test: `backend/tests/test_student.py` (append 5 tests)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_student.py`:

```python
def test_my_courses_admin_only_row(client, db, test_user):
    """Admin-not-enrolled sees their course with version_id=None."""
    from mathion.models import Course, CourseAdmin
    from mathion.auth import request_pin, verify_pin
    from fastapi.testclient import TestClient as Base
    from mathion.main import app
    course = Course(slug="adm", name="Adm", description="")
    db.add(course); db.commit(); db.refresh(course)
    db.add(CourseAdmin(course_id=course.id, user_id=test_user.id))
    db.commit()
    raw = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw, duration_days=7)
    c = Base(app)
    c.cookies.set("session_token", token)
    r = c.get("/api/my-courses")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["course"]["slug"] == "adm"
    assert row["is_admin"] is True
    assert row["version_id"] is None
    assert row["version_state"] is None
    assert row["total_items"] == 0
    assert row["covered_items"] == 0
    assert row["is_active"] is False


def test_my_courses_enrolled_only_unchanged(auth_client, admin_client, db, test_user):
    """Enrolled-only behaviour matches pre-existing shape (with is_admin=false default)."""
    from mathion.models_auth import StudentEnrollment
    course = admin_client.post(
        "/api/courses", json={"slug": "enr", "name": "Enr", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    db.add(StudentEnrollment(user_id=test_user.id, version_id=version["id"], is_active=True))
    db.commit()
    rows = auth_client.get("/api/my-courses").json()
    row = next(r for r in rows if r["course"]["slug"] == "enr")
    assert row["is_admin"] is False
    assert row["version_id"] == version["id"]
    assert row["version_state"] == "published"
    assert row["is_active"] is True


def test_my_courses_admin_and_enrolled_merged(client, admin_client, db, test_user):
    """User who is both admin and enrolled sees one row with both fields populated."""
    from mathion.models import CourseAdmin
    from mathion.models_auth import StudentEnrollment
    from mathion.auth import request_pin, verify_pin
    from fastapi.testclient import TestClient as Base
    from mathion.main import app
    course = admin_client.post(
        "/api/courses", json={"slug": "both", "name": "Both", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    db.add(CourseAdmin(course_id=course["id"], user_id=test_user.id))
    db.add(StudentEnrollment(user_id=test_user.id, version_id=version["id"], is_active=True))
    db.commit()
    raw = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw, duration_days=7)
    c = Base(app)
    c.cookies.set("session_token", token)
    rows = c.get("/api/my-courses").json()
    matches = [r for r in rows if r["course"]["slug"] == "both"]
    assert len(matches) == 1, "admin+enrolled must merge to a single row"
    row = matches[0]
    assert row["is_admin"] is True
    assert row["version_id"] == version["id"]


def test_my_courses_superuser_sees_all(admin_client):
    admin_client.post("/api/courses", json={"slug": "x1", "name": "X1", "description": ""})
    admin_client.post("/api/courses", json={"slug": "x2", "name": "X2", "description": ""})
    rows = admin_client.get("/api/my-courses").json()
    slugs = {r["course"]["slug"] for r in rows}
    assert {"x1", "x2"}.issubset(slugs)
    assert all(r["is_admin"] is True for r in rows)


def test_my_courses_no_role_sees_empty(auth_client):
    """Plain user with no enrollments and no admin role sees []."""
    rows = auth_client.get("/api/my-courses").json()
    assert rows == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_student.py -k "my_courses_admin_only_row or my_courses_admin_and_enrolled_merged or my_courses_superuser_sees_all" -v
```
Expected: validation errors (`is_admin` missing, `version_id` not Optional).

- [ ] **Step 3: Update the schema**

In `backend/mathion/schemas.py`, replace the `MyCourseResponse` class (lines 237-243) with:

```python
class MyCourseResponse(BaseModel):
    course: CourseResponse
    version_id: int | None = None
    version_state: str | None = None
    total_items: int = 0
    covered_items: int = 0
    is_active: bool = False
    is_admin: bool = False
```

- [ ] **Step 4: Update the endpoint**

In `backend/mathion/api/student.py`, replace the body of `my_courses` (lines 147-203) with logic that:

```python
@router.get("/api/my-courses", response_model=list[MyCourseResponse])
def my_courses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from mathion.models import CourseAdmin
    # Build a set of (course_id, is_admin) keys we'll collect rows for.
    admin_course_ids: set[int] = set()
    if user.is_superuser:
        admin_course_ids = set(db.scalars(select(Course.id)).all())
    else:
        admin_course_ids = set(db.scalars(
            select(CourseAdmin.course_id).where(CourseAdmin.user_id == user.id)
        ).all())

    # Existing enrolled-courses pass — keyed by course_id, most-recent enrollment per course.
    enrollments = db.execute(
        select(StudentEnrollment)
        .where(StudentEnrollment.user_id == user.id)
        .order_by(StudentEnrollment.created_at.desc())
    ).scalars().all()

    rows_by_course: dict[int, MyCourseResponse] = {}

    for enrollment in enrollments:
        version = db.get(CourseVersion, enrollment.version_id)
        if not version or version.is_disabled:
            continue
        if version.course_id in rows_by_course:
            continue  # only most-recent enrollment per course
        course = db.get(Course, version.course_id)
        if not course:
            continue
        total_items = db.scalar(
            select(func.count())
            .select_from(Item)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(Block.version_id == version.id)
        ) or 0
        covered_items = db.scalar(
            select(func.count())
            .select_from(UserItemState)
            .join(Item, Item.id == UserItemState.item_id)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(
                Block.version_id == version.id,
                UserItemState.user_id == user.id,
                UserItemState.is_covered == True,  # noqa: E712
            )
        ) or 0
        rows_by_course[version.course_id] = MyCourseResponse(
            course=CourseResponse.model_validate(course).model_copy(
                update={"is_admin": version.course_id in admin_course_ids}
            ),
            version_id=version.id,
            version_state=version.state,
            total_items=total_items,
            covered_items=covered_items,
            is_active=enrollment.is_active,
            is_admin=version.course_id in admin_course_ids,
        )

    # Add admin-only rows for any admin course not already covered by an enrollment.
    for cid in admin_course_ids:
        if cid in rows_by_course:
            continue
        course = db.get(Course, cid)
        if not course:
            continue
        rows_by_course[cid] = MyCourseResponse(
            course=CourseResponse.model_validate(course).model_copy(update={"is_admin": True}),
            is_admin=True,
            # version_id, version_state remain None; counters and is_active default to 0/False
        )

    return list(rows_by_course.values())
```

(`Course`, `CourseAdmin` imports — confirm `student.py` imports include them; add if missing.)

- [ ] **Step 5: Run all student tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_student.py -v
```
Expected: all pre-existing tests pass + 5 new ones pass.

- [ ] **Step 6: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/schemas.py backend/mathion/api/student.py backend/tests/test_student.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): /my-courses includes admin courses; Optional version fields"
```

---

### Task 4: Block delete-with-sequences guard

**Files:**
- Modify: `backend/mathion/api/blocks.py:112-123` (`delete_block`)
- Test: `backend/tests/test_blocks.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_blocks.py`:

```python
def test_delete_block_empty_succeeds(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b"}
    ).json()
    r = admin_client.delete(f"/api/blocks/{block['id']}")
    assert r.status_code == 204


def test_delete_block_with_sequences_blocked(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b"}
    ).json()
    admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"})
    r = admin_client.delete(f"/api/blocks/{block['id']}")
    assert r.status_code == 409
    assert "remove its sequences first" in r.json()["detail"]


def test_delete_block_state_error_precedes_child_count(admin_client, db, seed_publishable_version):
    """On a published version (where state forbids delete), the state error wins
    over the child-count error so the more actionable message surfaces."""
    from mathion.models import Block
    course, version = seed_publishable_version()
    block = db.execute(select(Block).where(Block.version_id == version["id"])).scalar_one()
    r = admin_client.delete(f"/api/blocks/{block.id}")
    assert r.status_code == 409
    # State message wins; child-count message must NOT appear.
    assert "'created' state" in r.json()["detail"]
    assert "remove its sequences" not in r.json()["detail"]
```

(Top of file may need `from sqlalchemy import select`.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_blocks.py -k "delete_block" -v
```
Expected: `test_delete_block_with_sequences_blocked` fails (currently cascade-deletes silently → 204).

- [ ] **Step 3: Add the guard**

In `backend/mathion/api/blocks.py`, replace `delete_block` (lines 112-123) with:

```python
@router.delete("/api/blocks/{block_id}", status_code=204)
def delete_block(block_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete blocks in 'created' state")
    has_seq = db.scalar(select(Sequence.id).where(Sequence.block_id == block_id).limit(1))
    if has_seq is not None:
        raise HTTPException(status_code=409, detail="Cannot delete block: remove its sequences first.")
    db.delete(block)
    db.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_blocks.py -v
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/api/blocks.py backend/tests/test_blocks.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): block delete blocked when sequences present"
```

---

### Task 5: Sequence delete-with-items guard

**Files:**
- Modify: `backend/mathion/api/blocks.py:219-231` (`delete_sequence`)
- Test: `backend/tests/test_blocks.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_blocks.py`:

```python
def test_delete_sequence_empty_succeeds(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    r = admin_client.delete(f"/api/sequences/{seq['id']}")
    assert r.status_code == 204


def test_delete_sequence_with_items_blocked(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b"}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    admin_client.post(
        f"/api/sequences/{seq['id']}/items",
        json={"title": "I", "slug": "i", "type": "static_page", "content_md": "x"},
    )
    r = admin_client.delete(f"/api/sequences/{seq['id']}")
    assert r.status_code == 409
    assert "remove its items first" in r.json()["detail"]


def test_delete_sequence_state_error_precedes_child_count(admin_client, db, seed_publishable_version):
    from mathion.models import Sequence
    course, version = seed_publishable_version()
    seq = db.execute(select(Sequence)).scalar()
    r = admin_client.delete(f"/api/sequences/{seq.id}")
    assert r.status_code == 409
    assert "'created' state" in r.json()["detail"]
    assert "remove its items" not in r.json()["detail"]
```

- [ ] **Step 2: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_blocks.py -k "delete_sequence" -v
```

- [ ] **Step 3: Add guard**

In `backend/mathion/api/blocks.py`, replace `delete_sequence` (lines 219-231) with:

```python
@router.delete("/api/sequences/{sequence_id}", status_code=204)
def delete_sequence(sequence_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    seq = get_or_404(db, Sequence, sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete sequences in 'created' state")
    from mathion.models import Item  # local import keeps symbol surface tight
    has_item = db.scalar(select(Item.id).where(Item.sequence_id == sequence_id).limit(1))
    if has_item is not None:
        raise HTTPException(status_code=409, detail="Cannot delete sequence: remove its items first.")
    db.delete(seq)
    db.commit()
```

- [ ] **Step 4: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_blocks.py -v
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/api/blocks.py backend/tests/test_blocks.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): sequence delete blocked when items present"
```

---

### Task 6: `publish_version` `is_disabled` gate

**Files:**
- Modify: `backend/mathion/api/versions.py:100-105` (top of `publish_version`)
- Test: `backend/tests/test_versions.py` (append)

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_versions.py`:

```python
def test_publish_disabled_version_returns_403(admin_client):
    course = admin_client.post(
        "/api/courses", json={"slug": "d", "name": "D", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert r.status_code == 403
    assert "disabled" in r.json()["detail"].lower()
```

- [ ] **Step 2: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_versions.py::test_publish_disabled_version_returns_403 -v
```
Expected: currently returns 409 (state-not-created? or different) instead of 403.

- [ ] **Step 3: Add the gate**

In `backend/mathion/api/versions.py`, in `publish_version` (line ~102), insert just after `require_course_admin(...)`:

```python
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
```

- [ ] **Step 4: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_versions.py -v
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/api/versions.py backend/tests/test_versions.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): publish_version refuses on is_disabled"
```

---

### Task 7: `PATCH /api/versions/{vid}` (info_md + max_quiz_attempts)

**Files:**
- Modify: `backend/mathion/schemas.py` (add `VersionUpdate` near `VersionCreate`)
- Modify: `backend/mathion/api/versions.py` (add new PATCH endpoint after `create_version`)
- Test: `backend/tests/test_versions.py` (append 5 tests)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_versions.py`:

```python
def test_patch_version_info_md_in_created(admin_client, db):
    from mathion.models import CourseVersion
    course = admin_client.post("/api/courses", json={"slug": "p", "name": "P", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "old"}).json()
    before = db.get(CourseVersion, version["id"]).content_updated_at
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "new # heading"})
    assert r.status_code == 200
    assert r.json()["info_md"] == "new # heading"
    assert "<" in r.json()["info_html"]  # was rendered
    after = db.get(CourseVersion, version["id"]).content_updated_at
    assert after > before


def test_patch_version_max_quiz_attempts(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "p", "name": "P", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"max_quiz_attempts": 5})
    assert r.status_code == 200
    assert r.json()["max_quiz_attempts"] == 5


def test_patch_version_published_409(admin_client, seed_publishable_version):
    course, version = seed_publishable_version()
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "x"})
    assert r.status_code == 409


def test_patch_version_archived_409(admin_client, seed_publishable_version):
    course, version = seed_publishable_version()
    admin_client.post(f"/api/versions/{version['id']}/archive")
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "x"})
    assert r.status_code == 409


def test_patch_version_disabled_403(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "p", "name": "P", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.patch(f"/api/versions/{version['id']}", json={"info_md": "x"})
    assert r.status_code == 403
```

- [ ] **Step 2: Run + observe failures**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_versions.py -k "patch_version" -v
```
Expected: 405/404 (route doesn't exist).

- [ ] **Step 3: Add the schema**

In `backend/mathion/schemas.py`, after `VersionCreate` (line 28-31), add:

```python
class VersionUpdate(BaseModel):
    info_md: str | None = None
    max_quiz_attempts: int | None = Field(default=None, ge=1, le=10)
```

- [ ] **Step 4: Add the endpoint**

In `backend/mathion/api/versions.py`, add (after `create_version`, before `list_versions`):

```python
@router.patch("/api/versions/{version_id}", response_model=VersionResponse)
def update_version(
    version_id: int,
    data: VersionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only edit version meta in 'created' state")

    updates = data.model_dump(exclude_unset=True)
    if "info_md" in updates:
        version.info_md = updates["info_md"]
        version.info_html = render_with_assets(db, version.id, updates["info_md"])
        sync_asset_references(db, version.id, [updates["info_md"]], {"info_version_id": version.id})
    if "max_quiz_attempts" in updates:
        version.max_quiz_attempts = updates["max_quiz_attempts"]

    bump_content_updated_at(version)
    db.commit()
    db.refresh(version)
    return version
```

Add `VersionUpdate` to the imports at the top.

- [ ] **Step 5: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_versions.py -v
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/schemas.py backend/mathion/api/versions.py backend/tests/test_versions.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): PATCH /api/versions/{id} (info_md + max_quiz_attempts)"
```

---

### Task 8: `POST /api/versions/{vid}/render`

**Files:**
- Modify: `backend/mathion/schemas.py` (add `VersionRenderRequest`/`VersionRenderResponse`)
- Modify: `backend/mathion/api/versions.py` (add render endpoint)
- Test: `backend/tests/test_versions.py` (append 3 tests)

- [ ] **Step 1: Write failing tests**

Append:

```python
def test_render_endpoint_admin(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "r", "name": "R", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = admin_client.post(
        f"/api/versions/{version['id']}/render", json={"content_md": "# hello"}
    )
    assert r.status_code == 200
    assert "<h1>" in r.json()["html"].lower() or "<h1" in r.json()["html"]


def test_render_endpoint_non_admin_403(auth_client, admin_client):
    course = admin_client.post("/api/courses", json={"slug": "r", "name": "R", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    r = auth_client.post(
        f"/api/versions/{version['id']}/render", json={"content_md": "# x"}
    )
    assert r.status_code == 403


def test_render_endpoint_disabled_403(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "r", "name": "R", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.post(
        f"/api/versions/{version['id']}/render", json={"content_md": "x"}
    )
    assert r.status_code == 403
```

- [ ] **Step 2: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_versions.py -k "render_endpoint" -v
```

- [ ] **Step 3: Add schemas**

In `backend/mathion/schemas.py`, near `VersionUpdate`:

```python
class VersionRenderRequest(BaseModel):
    content_md: str


class VersionRenderResponse(BaseModel):
    html: str
```

- [ ] **Step 4: Add endpoint**

In `backend/mathion/api/versions.py`:

```python
@router.post("/api/versions/{version_id}/render", response_model=VersionRenderResponse)
def render_version_md(
    version_id: int,
    data: VersionRenderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    return VersionRenderResponse(html=render_with_assets(db, version.id, data.content_md))
```

Add the new schema names to the import block at the top of the file.

- [ ] **Step 5: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_versions.py -v
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/schemas.py backend/mathion/api/versions.py backend/tests/test_versions.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): POST /api/versions/{id}/render markdown preview"
```

---

### Task 9: `GET /api/versions/{vid}/admin-tree`

**Files:**
- Modify: `backend/mathion/api/content.py` (add admin-tree endpoint)
- Test: `backend/tests/test_admin_tree.py` (new file, 6 tests)

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_admin_tree.py`:

```python
import pytest
from sqlalchemy import select


def _make_course_with_one_item(admin_client, content_md="hello"):
    course = admin_client.post(
        "/api/courses", json={"slug": "tree", "name": "Tree", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": "v-info"}
    ).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": "b-info"}
    ).json()
    seq = admin_client.post(
        f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}
    ).json()
    item = admin_client.post(
        f"/api/sequences/{seq['id']}/items",
        json={"title": "I", "slug": "i", "type": "static_page", "content_md": content_md},
    ).json()
    return course, version, block, seq, item


def test_admin_tree_in_created_state(admin_client):
    course, version, block, seq, item = _make_course_with_one_item(admin_client)
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200
    body = r.json()
    assert body["version"]["id"] == version["id"]
    assert body["version"]["state"] == "created"
    assert body["version"]["info_md"] == "v-info"
    assert body["blocks"][0]["version_id"] == version["id"]
    assert body["blocks"][0]["info"] == "b-info"
    s = body["blocks"][0]["sequences"][0]
    assert s["block_id"] == block["id"]
    i = s["items"][0]
    assert i["sequence_id"] == seq["id"]
    assert i["content_md"] == "hello"


def test_admin_tree_published_ok(admin_client, seed_publishable_version):
    course, version = seed_publishable_version()
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200


def test_admin_tree_archived_ok(admin_client, seed_publishable_version):
    course, version = seed_publishable_version()
    admin_client.post(f"/api/versions/{version['id']}/archive")
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200


def test_admin_tree_disabled_ok(admin_client):
    course, version, *_ = _make_course_with_one_item(admin_client)
    admin_client.post(f"/api/versions/{version['id']}/disable")
    r = admin_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 200
    assert r.json()["version"]["is_disabled"] is True


def test_admin_tree_non_admin_403(auth_client, admin_client):
    course, version, *_ = _make_course_with_one_item(admin_client)
    r = auth_client.get(f"/api/versions/{version['id']}/admin-tree")
    assert r.status_code == 403


def test_admin_tree_returns_parent_fks_and_md(admin_client):
    """Frontend deep-link validation reads block.version_id, sequence.block_id, item.sequence_id."""
    course, version, block, seq, item = _make_course_with_one_item(admin_client, content_md="foo")
    body = admin_client.get(f"/api/versions/{version['id']}/admin-tree").json()
    assert body["blocks"][0]["version_id"] == version["id"]
    assert body["blocks"][0]["sequences"][0]["block_id"] == block["id"]
    assert body["blocks"][0]["sequences"][0]["items"][0]["sequence_id"] == seq["id"]
    assert body["blocks"][0]["sequences"][0]["items"][0]["content_md"] == "foo"
    assert body["version"]["info_md"] == "v-info"
```

- [ ] **Step 2: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_admin_tree.py -v
```
Expected: 404 (route absent).

- [ ] **Step 3: Add endpoint**

In `backend/mathion/api/content.py`, append:

```python
@router.get("/api/versions/{version_id}/admin-tree")
def get_admin_tree(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from mathion.api.helpers import require_course_admin
    version = db.execute(
        select(CourseVersion)
        .options(joinedload(CourseVersion.course))
        .where(CourseVersion.id == version_id)
    ).scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    require_course_admin(db, user, version.course_id)

    blocks = db.execute(
        select(Block)
        .where(Block.version_id == version_id)
        .options(
            joinedload(Block.sequences)
            .joinedload(Sequence.items)
        )
        .order_by(Block.order)
    ).unique().scalars().all()

    return {
        "course": {"id": version.course.id, "name": version.course.name, "slug": version.course.slug},
        "version": {
            "id": version.id,
            "course_id": version.course_id,
            "state": version.state,
            "is_disabled": version.is_disabled,
            "info_md": version.info_md,
            "info_html": version.info_html,
            "max_quiz_attempts": version.max_quiz_attempts,
            "created_at": version.created_at.isoformat() if version.created_at else None,
            "published_at": version.published_at.isoformat() if version.published_at else None,
            "archived_at": version.archived_at.isoformat() if version.archived_at else None,
            "content_updated_at": version.content_updated_at.isoformat() if version.content_updated_at else None,
        },
        "blocks": [
            {
                "id": b.id,
                "version_id": b.version_id,
                "title": b.title,
                "slug": b.slug,
                "order": b.order,
                "info": b.info,
                "info_html": b.info_html,
                "sequences": sorted(
                    [
                        {
                            "id": s.id,
                            "block_id": s.block_id,
                            "title": s.title,
                            "slug": s.slug,
                            "order": s.order,
                            "items": sorted(
                                [
                                    {
                                        "id": it.id,
                                        "sequence_id": it.sequence_id,
                                        "title": it.title,
                                        "slug": it.slug,
                                        "order": it.order,
                                        "type": it.type,
                                        "content_md": it.content_md,
                                        "content_html": it.content_html,
                                        "video_url": it.video_url,
                                        "script_url": it.script_url,
                                    }
                                    for it in s.items
                                ],
                                key=lambda x: x["order"],
                            ),
                        }
                        for s in b.sequences
                    ],
                    key=lambda x: x["order"],
                ),
            }
            for b in blocks
        ],
    }
```

- [ ] **Step 4: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_admin_tree.py -v
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q
```
Expected: 6 new tests pass; full suite still green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add backend/mathion/api/content.py backend/tests/test_admin_tree.py
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(backend): GET /api/versions/{id}/admin-tree"
```

---

## Phase 2 — Frontend infrastructure

### Task 10: Router navigation-guard hook

**Files:**
- Modify: `frontend/src/lib/router.svelte.ts` (add guard registry, navigate awaits guards, popstate restores via pushState)
- Modify: `frontend/src/tests/router.test.ts` (append guard tests)

- [ ] **Step 1: Read the current router** to understand the change surface.

Read: `frontend/src/lib/router.svelte.ts` (whole file).

- [ ] **Step 2: Write failing tests**

Append to `frontend/src/tests/router.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  navigate, registerNavigationGuard, currentRoute,
} from '../lib/router.svelte';

describe('navigation guards', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/');
  });

  it('cancels navigate when a guard returns false', async () => {
    const dispose = registerNavigationGuard(() => false);
    await navigate('/courses');
    expect(currentRoute.path).toBe('/');
    dispose();
  });

  it('proceeds when guards return true', async () => {
    const dispose = registerNavigationGuard(() => true);
    await navigate('/courses');
    expect(currentRoute.path).toBe('/courses');
    dispose();
  });

  it('disposer removes the guard', async () => {
    const dispose = registerNavigationGuard(() => false);
    dispose();
    await navigate('/courses');
    expect(currentRoute.path).toBe('/courses');
  });

  it('async guards are awaited', async () => {
    const dispose = registerNavigationGuard(async () => false);
    await navigate('/courses');
    expect(currentRoute.path).toBe('/');
    dispose();
  });
});
```

- [ ] **Step 3: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run test -- router.test.ts
```
Expected: import error (`registerNavigationGuard` does not exist).

- [ ] **Step 4: Modify the router**

In `frontend/src/lib/router.svelte.ts`, add a guard registry, change `navigate` to async, and update the popstate handler. Sketch (preserve the existing types and `matchRoute`/`currentRoute`):

```ts
type NavGuard = () => boolean | Promise<boolean>;
const guards: NavGuard[] = [];
let suppressGuards = false;
let lastResolvedPath = location.pathname + location.search + location.hash;

export function registerNavigationGuard(g: NavGuard): () => void {
  guards.push(g);
  return () => {
    const i = guards.indexOf(g);
    if (i >= 0) guards.splice(i, 1);
  };
}

async function runGuards(): Promise<boolean> {
  if (suppressGuards) return true;
  for (const g of guards) {
    const ok = await g();
    if (!ok) return false;
  }
  return true;
}

export async function navigate(path: string, opts: { replace?: boolean } = {}): Promise<void> {
  if (path === currentRoute.path + currentRoute.search + currentRoute.hash) return;
  if (!(await runGuards())) return;
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  applyLocationToRoute();
  lastResolvedPath = location.pathname + location.search + location.hash;
}

window.addEventListener('popstate', async () => {
  if (suppressGuards) return;
  if (!(await runGuards())) {
    suppressGuards = true;
    history.pushState(null, '', lastResolvedPath);
    suppressGuards = false;
    return;
  }
  applyLocationToRoute();
  lastResolvedPath = location.pathname + location.search + location.hash;
});
```

(`applyLocationToRoute()` is whatever the existing handler does to update `currentRoute` from `location`. Keep its existing body.)

- [ ] **Step 5: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test
```
Expected: all router tests pass (including new ones); other tests still pass.

- [ ] **Step 6: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/lib/router.svelte.ts frontend/src/tests/router.test.ts
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): router navigation-guard hook"
```

---

### Task 11: Frontend types extension

**Files:**
- Modify: `frontend/src/lib/types.ts` (extend `CourseListItem`; add `AdminTree`, `AdminTreeBlock`, `AdminTreeSequence`, `AdminTreeItem`, `VersionState`)

- [ ] **Step 1: Update `CourseListItem`** to mirror the new `MyCourseResponse`:

```ts
export type CourseListItem = {
  course: { id: number; slug: string; name: string; description: string; is_admin: boolean };
  version_id: number | null;
  version_state: 'created' | 'published' | 'archived' | null;
  covered_items: number;
  total_items: number;
  is_active: boolean;
  is_admin: boolean;
};
```

(Plus update `currentCourse.svelte.ts` and any other consumer if `is_admin` becomes required there. Run `npm run check` after to surface call sites.)

- [ ] **Step 2: Add admin-tree types**

Append to `frontend/src/lib/types.ts`:

```ts
export type AdminTreeVersion = {
  id: number;
  course_id: number;
  state: 'created' | 'published' | 'archived';
  is_disabled: boolean;
  info_md: string;
  info_html: string;
  max_quiz_attempts: number;
  created_at: string;
  published_at: string | null;
  archived_at: string | null;
  content_updated_at: string;
};

export type AdminTreeItem = {
  id: number;
  sequence_id: number;
  title: string;
  slug: string;
  order: number;
  type: 'static_page' | 'video' | 'quiz' | 'interactive_app';
  content_md: string | null;
  content_html: string | null;
  video_url: string | null;
  script_url: string | null;
};

export type AdminTreeSequence = {
  id: number;
  block_id: number;
  title: string;
  slug: string;
  order: number;
  items: AdminTreeItem[];
};

export type AdminTreeBlock = {
  id: number;
  version_id: number;
  title: string;
  slug: string;
  order: number;
  info: string;
  info_html: string;
  sequences: AdminTreeSequence[];
};

export type AdminTree = {
  course: { id: number; name: string; slug: string };
  version: AdminTreeVersion;
  blocks: AdminTreeBlock[];
};
```

- [ ] **Step 3: Run check, fix consumers**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
```
Expected: errors at any call site that destructured `course.version_id` as `number` — fix them to handle `number | null`. Likely sites: `pages/CourseList.svelte` (already to-be-modified later), `components/course/CourseCard.svelte`. Add `version_id !== null ? ... : ...` guards.

- [ ] **Step 4: Run frontend tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run test
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/lib/types.ts frontend/src/components frontend/src/pages
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): types for admin-tree and is_admin/Optional fields"
```

---

### Task 12: `lib/versionPermissions.ts`

**Files:**
- Create: `frontend/src/lib/versionPermissions.ts`
- Test: `frontend/src/tests/versionPermissions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/tests/versionPermissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { versionPermissions } from '../lib/versionPermissions';

const cases: Array<[string, boolean, Partial<ReturnType<typeof versionPermissions>>]> = [
  ['created', false, {
    canEditVersionMeta: true, canEditStructure: true, canEditTextFields: true,
    canPublish: true, canArchive: false, canRevert: false,
    canDisable: true, canEnable: false, canDeleteVersion: true,
  }],
  ['published', false, {
    canEditVersionMeta: false, canEditStructure: false, canEditTextFields: true,
    canPublish: false, canArchive: true, canRevert: true,
    canDisable: true, canEnable: false, canDeleteVersion: false,
  }],
  ['archived', false, {
    canEditVersionMeta: false, canEditStructure: false, canEditTextFields: false,
    canPublish: false, canArchive: false, canRevert: false,
    canDisable: true, canEnable: false, canDeleteVersion: false,
  }],
];

describe('versionPermissions', () => {
  for (const [state, is_disabled, expected] of cases) {
    it(`state=${state}, is_disabled=${is_disabled}`, () => {
      const got = versionPermissions({ state, is_disabled });
      for (const k of Object.keys(expected) as Array<keyof typeof expected>) {
        expect(got[k]).toBe(expected[k]);
      }
    });
  }

  it('is_disabled overrides everything except canEnable', () => {
    for (const state of ['created', 'published', 'archived']) {
      const got = versionPermissions({ state, is_disabled: true });
      expect(got.canEnable).toBe(true);
      expect(got.canEditVersionMeta).toBe(false);
      expect(got.canEditStructure).toBe(false);
      expect(got.canEditTextFields).toBe(false);
      expect(got.canPublish).toBe(false);
      expect(got.canArchive).toBe(false);
      expect(got.canRevert).toBe(false);
      expect(got.canDisable).toBe(false);
      expect(got.canDeleteVersion).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run test -- versionPermissions.test.ts
```
Expected: import error (file doesn't exist).

- [ ] **Step 3: Implement helper**

Create `frontend/src/lib/versionPermissions.ts`:

```ts
export type VersionPermissions = {
  canEditVersionMeta: boolean;
  canEditStructure:   boolean;
  canEditTextFields:  boolean;
  canPublish:         boolean;
  canArchive:         boolean;
  canRevert:          boolean;
  canDisable:         boolean;
  canEnable:          boolean;
  canDeleteVersion:   boolean;
};

export function versionPermissions(v: { state: string; is_disabled: boolean }): VersionPermissions {
  const created = v.state === 'created' && !v.is_disabled;
  const published = v.state === 'published' && !v.is_disabled;
  const archived = v.state === 'archived' && !v.is_disabled;
  return {
    canEditVersionMeta: created,
    canEditStructure:   created,
    canEditTextFields:  created || published,
    canPublish:         created,
    canArchive:         published,
    canRevert:          published,
    canDisable:         !v.is_disabled && (created || published || archived),
    canEnable:          v.is_disabled,
    canDeleteVersion:   created,
  };
}
```

- [ ] **Step 4: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test -- versionPermissions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/lib/versionPermissions.ts frontend/src/tests/versionPermissions.test.ts
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): versionPermissions helper"
```

---

### Task 13: `lib/dirty.svelte.ts`

**Files:**
- Create: `frontend/src/lib/dirty.svelte.ts`
- Test: `frontend/src/tests/dirty.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/tests/dirty.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeDirtyTracker } from '../lib/dirty.svelte';

describe('makeDirtyTracker', () => {
  it('starts clean and turns dirty on change', () => {
    const t = makeDirtyTracker({ title: 'a', max: 3 });
    expect(t.isDirty).toBe(false);
    t.current.title = 'b';
    expect(t.isDirty).toBe(true);
  });

  it('reset to a new snapshot clears dirty', () => {
    const t = makeDirtyTracker({ title: 'a' });
    t.current.title = 'b';
    expect(t.isDirty).toBe(true);
    t.reset({ title: 'b' });
    expect(t.isDirty).toBe(false);
    expect(t.current.title).toBe('b');
  });

  it('discard via reset to original snapshot reverts', () => {
    const t = makeDirtyTracker({ title: 'a' });
    t.current.title = 'b';
    t.reset({ title: 'a' });
    expect(t.current.title).toBe('a');
    expect(t.isDirty).toBe(false);
  });

  it('handles number fields', () => {
    const t = makeDirtyTracker({ count: 3 });
    expect(t.isDirty).toBe(false);
    t.current.count = 5;
    expect(t.isDirty).toBe(true);
    t.reset({ count: 5 });
    expect(t.isDirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run test -- dirty.test.ts
```

- [ ] **Step 3: Implement**

Create `frontend/src/lib/dirty.svelte.ts`:

```ts
type Allowed = string | number;

export function makeDirtyTracker<T extends Record<string, Allowed>>(initial: T) {
  let snapshot: T = { ...initial };
  const current = $state<T>({ ...initial });

  return {
    current,
    get isDirty(): boolean {
      for (const k of Object.keys(snapshot) as (keyof T)[]) {
        if (current[k] !== snapshot[k]) return true;
      }
      return false;
    },
    reset(next: T): void {
      snapshot = { ...next };
      for (const k of Object.keys(next) as (keyof T)[]) {
        current[k] = next[k];
      }
    },
  };
}
```

- [ ] **Step 4: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test -- dirty.test.ts
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/lib/dirty.svelte.ts frontend/src/tests/dirty.test.ts
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): dirty-state tracker helper"
```

---

### Task 14: `currentEditorVersion` store

**Files:**
- Create: `frontend/src/stores/currentEditorVersion.svelte.ts`
- Test: `frontend/src/tests/currentEditorVersion.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/tests/currentEditorVersion.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../stores/currentEditorVersion.svelte';

const tree = (id: number) => ({
  course: { id: 1, name: 'C', slug: 'c' },
  version: { id, course_id: 1, state: 'created', is_disabled: false, info_md: '',
             info_html: '', max_quiz_attempts: 3, created_at: '', published_at: null,
             archived_at: null, content_updated_at: '' },
  blocks: [],
});

describe('currentEditorVersion', () => {
  beforeEach(() => clearEditorVersion());
  afterEach(() => vi.restoreAllMocks());

  it('loads a tree and stores it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(tree(3)), { status: 200 }),
    );
    await loadAdminTree(3);
    expect(currentEditorVersion.value?.version.id).toBe(3);
  });

  it('dedupes concurrent reads of the same versionId', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(tree(3)), { status: 200 }),
    );
    await Promise.all([loadAdminTree(3), loadAdminTree(3), loadAdminTree(3)]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('force=true does NOT dedupe (post-mutation refetch)', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(tree(3)), { status: 200 }),
    );
    await loadAdminTree(3);
    await loadAdminTree(3, { force: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('stale-guard: a slow response for an older versionId does not overwrite', async () => {
    let resolveFirst: (v: Response) => void;
    const slow = new Promise<Response>((r) => { resolveFirst = r; });
    const mock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce(new Response(JSON.stringify(tree(4)), { status: 200 }));
    const p1 = loadAdminTree(3);
    const p2 = loadAdminTree(4);
    await p2;
    resolveFirst!(new Response(JSON.stringify(tree(3)), { status: 200 }));
    await p1;
    expect(currentEditorVersion.value?.version.id).toBe(4);
  });

  it('clearEditorVersion empties the store and invalidates pending', () => {
    clearEditorVersion();
    expect(currentEditorVersion.value).toBe(null);
    expect(currentEditorVersion.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run + observe failure**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run test -- currentEditorVersion.test.ts
```

- [ ] **Step 3: Implement the store**

Create `frontend/src/stores/currentEditorVersion.svelte.ts`:

```ts
import { api, ApiError } from '../lib/api';
import type { AdminTree } from '../lib/types';

export const currentEditorVersion = $state<{
  value: AdminTree | null;
  loading: boolean;
  error: string | null;
}>({ value: null, loading: false, error: null });

let inflight: { versionId: number; promise: Promise<void> } | null = null;
let token = 0;

export async function loadAdminTree(versionId: number, opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force && inflight && inflight.versionId === versionId) {
    return inflight.promise;
  }
  const myToken = ++token;
  currentEditorVersion.loading = true;
  currentEditorVersion.error = null;

  const promise: Promise<void> = (async () => {
    try {
      const tree = await api.get<AdminTree>(`/api/versions/${versionId}/admin-tree`);
      if (myToken !== token) return;
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
  token++;
  inflight = null;
  currentEditorVersion.value = null;
  currentEditorVersion.error = null;
  currentEditorVersion.loading = false;
}
```

- [ ] **Step 4: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test -- currentEditorVersion.test.ts
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/stores/currentEditorVersion.svelte.ts frontend/src/tests/currentEditorVersion.test.ts
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): currentEditorVersion store with single-flight + force"
```

---

### Task 15: `DirtyGuard` component

**Files:**
- Create: `frontend/src/components/editor/DirtyGuard.svelte`

- [ ] **Step 1: Implement** (no unit test — Svelte component, validated downstream)

Create `frontend/src/components/editor/DirtyGuard.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { registerNavigationGuard } from '../../lib/router.svelte';

  let { isDirty }: { isDirty: () => boolean } = $props();

  function confirmDiscard(): boolean {
    return window.confirm('Discard unsaved changes?');
  }

  onMount(() => {
    const dispose = registerNavigationGuard(() => {
      if (!isDirty()) return true;
      return confirmDiscard();
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      dispose();
      window.removeEventListener('beforeunload', onUnload);
    };
  });
</script>
```

(`isDirty` is passed as a callback so the parent's reactive `$state` reads through it without the guard re-creating on every value change.)

- [ ] **Step 2: Run check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/components/editor/DirtyGuard.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): DirtyGuard component"
```

---

## Phase 3 — Frontend pages

### Task 16: CourseList admin Edit affordance + admin-only row UX

**Files:**
- Modify: `frontend/src/pages/CourseList.svelte` (existing)
- Modify: `frontend/src/components/course/CourseCard.svelte` (existing — admin-only treatment)

- [ ] **Step 1: Read current CourseList + CourseCard** to ground the edit.

- [ ] **Step 2: Update `CourseCard.svelte`**

The card receives a `CourseListItem`. Render:

- If `course.is_admin && course.version_id === null` (admin-only): show "Admin" badge, link href `/courses/${slug}/edit`. No progress row.
- If `course.is_admin && course.version_id !== null` (mixed): show progress + "Continue" link to `/courses/${slug}` AND a small "Edit" link to `/courses/${slug}/edit`.
- If not admin: existing behavior (link to `/courses/${slug}`, progress).

Replace the body with:

```svelte
<script lang="ts">
  import type { CourseListItem } from '../../lib/types';
  import { formatProgress } from '../../lib/format';
  import { navigate } from '../../lib/router.svelte';
  let { course }: { course: CourseListItem } = $props();
  const adminOnly = course.is_admin && course.version_id === null;
  const studentHref = `/courses/${course.course.slug}`;
  const editHref = `/courses/${course.course.slug}/edit`;
</script>

<div class="card">
  <div class="title-row">
    <h3>{course.course.name}</h3>
    {#if course.is_admin}
      <span class="badge">Admin</span>
    {/if}
  </div>
  {#if adminOnly}
    <a class="action" href={editHref} onclick={(e) => { e.preventDefault(); navigate(editHref); }}>Edit course →</a>
  {:else}
    <div class="progress">{formatProgress(course.covered_items, course.total_items)}</div>
    <div class="actions">
      <a href={studentHref} onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>Continue →</a>
      {#if course.is_admin}
        <a class="edit" href={editHref} onclick={(e) => { e.preventDefault(); navigate(editHref); }}>Edit</a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .card { display: block; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); }
  .card:hover { border-color: var(--primary); }
  .title-row { display: flex; align-items: center; gap: var(--space-2); }
  .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--primary-soft, #eef); color: var(--primary, #335); }
  .progress { color: var(--muted); font-size: 0.875rem; margin-top: var(--space-2); }
  .actions { display: flex; gap: var(--space-3); margin-top: var(--space-2); }
  .actions a { text-decoration: none; }
  .action { display: inline-block; margin-top: var(--space-2); }
</style>
```

- [ ] **Step 3: Verify CourseList.svelte still consumes the new shape**

`pages/CourseList.svelte` already iterates the response; the type change in Task 11 ensures `version_id: number | null` is honored. If `npm run check` complains about a `null` access, guard appropriately.

- [ ] **Step 4: Run check + tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/components/course/CourseCard.svelte frontend/src/pages/CourseList.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): admin Edit affordance on CourseList rows"
```

---

### Task 17: Route table + App.svelte componentMap entries

**Files:**
- Modify: `frontend/src/routes.ts`
- Modify: `frontend/src/App.svelte`
- Create (empty stubs): `frontend/src/pages/editor/{VersionsPage,VersionEditPage,BlockEditPage,SequenceEditPage,ItemEditPage}.svelte`

- [ ] **Step 1: Add the 5 routes** to `frontend/src/routes.ts`:

```ts
{ path: '/courses/:courseSlug/edit', component: 'VersionsPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId', component: 'VersionEditPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId', component: 'BlockEditPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId', component: 'SequenceEditPage', auth: true },
{ path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId/items/:itemId', component: 'ItemEditPage', auth: true },
```

- [ ] **Step 2: Create page stubs** so `App.svelte` can import them. For each of the 5 pages:

```svelte
<!-- frontend/src/pages/editor/VersionsPage.svelte (and the four others) -->
<script lang="ts">
  let _params: Record<string, string> = $props();
</script>
<div class="page"><h1>VersionsPage (stub)</h1></div>
```

(Replace `VersionsPage` with each of the other names. The stubs are filled in subsequent tasks.)

- [ ] **Step 3: Wire `App.svelte`**

In `frontend/src/App.svelte`, add 5 imports and 5 entries in `componentMap`:

```svelte
import VersionsPage from './pages/editor/VersionsPage.svelte';
import VersionEditPage from './pages/editor/VersionEditPage.svelte';
import BlockEditPage from './pages/editor/BlockEditPage.svelte';
import SequenceEditPage from './pages/editor/SequenceEditPage.svelte';
import ItemEditPage from './pages/editor/ItemEditPage.svelte';
```

```ts
const componentMap: Record<string, Component<Record<string, string>>> = {
  Login: Login as Component<Record<string, string>>,
  CourseList: CourseList as Component<Record<string, string>>,
  CourseView: CourseView as Component<Record<string, string>>,
  SequencePlayer: SequencePlayer as Component<Record<string, string>>,
  VersionsPage: VersionsPage as Component<Record<string, string>>,
  VersionEditPage: VersionEditPage as Component<Record<string, string>>,
  BlockEditPage: BlockEditPage as Component<Record<string, string>>,
  SequenceEditPage: SequenceEditPage as Component<Record<string, string>>,
  ItemEditPage: ItemEditPage as Component<Record<string, string>>,
};
```

- [ ] **Step 4: Extend router test** for new patterns. In `frontend/src/tests/router.test.ts`:

```ts
it('matches admin editor routes', () => {
  const routes = [
    { path: '/courses/:courseSlug/edit', component: 'VersionsPage', auth: true },
    { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId/items/:itemId', component: 'ItemEditPage', auth: true },
  ];
  const m = matchRoute(routes, '/courses/calc/edit/v/3/blocks/12/sequences/47/items/87');
  expect(m?.route.component).toBe('ItemEditPage');
  expect(m?.params).toEqual({ courseSlug: 'calc', versionId: '3', blockId: '12', sequenceId: '47', itemId: '87' });
});
```

- [ ] **Step 5: Run + verify**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/routes.ts frontend/src/App.svelte frontend/src/pages/editor/ frontend/src/tests/router.test.ts
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): wire 5 admin editor routes (page stubs)"
```

---

### Task 18: VersionsPage

**Files:**
- Modify: `frontend/src/pages/editor/VersionsPage.svelte` (replace stub)

- [ ] **Step 1: Implement**

The page receives `{ courseSlug }`. Behavior:
1. On mount, `await api.get<CourseResponse>(\`/api/courses/by-slug/${slug}\`)` to resolve course id and confirm `is_admin`.
2. `await api.get<VersionResponse[]>(\`/api/courses/${cid}/versions\`)` for the rows.
3. Render a "+ Create new version" inline form (info_md, max_quiz_attempts) → `POST /api/courses/${cid}/versions`. On 201, refetch versions and navigate to `/courses/${slug}/edit/v/${newVersion.id}`.
4. Per-row: state badge, dates, **Open** (navigate to v/:id), **Disable** (POST /disable), **Enable** (POST /enable), **Delete** (DELETE; only when state=`created` and not is_disabled).

Replace stub with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Input from '../../components/ui/Input.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { toasts } from '../../stores/toasts.svelte';

  let { courseSlug }: { courseSlug: string } = $props();

  type Course = { id: number; slug: string; name: string; description: string; is_admin: boolean };
  type Version = {
    id: number; course_id: number; state: 'created' | 'published' | 'archived';
    is_disabled: boolean; info_md: string; info_html: string; max_quiz_attempts: number;
    created_at: string; published_at: string | null; archived_at: string | null;
  };

  let course = $state<Course | null>(null);
  let versions = $state<Version[]>([]);
  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  // Create form
  let creating = $state(false);
  let info_md = $state('');
  let max_quiz_attempts = $state(3);

  async function load() {
    loading = true;
    error = null;
    try {
      course = await api.get<Course>(`/api/courses/by-slug/${encodeURIComponent(courseSlug)}`);
      versions = await api.get<Version[]>(`/api/courses/${course.id}/versions`);
    } catch (e) {
      if (e instanceof ApiError) error = { status: e.status, message: e.displayMessage };
      else error = { status: 500, message: 'Could not load.' };
    } finally {
      loading = false;
    }
  }

  async function createVersion() {
    if (!course) return;
    try {
      const v = await api.post<Version>(`/api/courses/${course.id}/versions`, { info_md, max_quiz_attempts });
      navigate(`/courses/${courseSlug}/edit/v/${v.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Failed to create version';
      toasts.add({ kind: 'error', message: msg });
    }
  }

  async function transition(v: Version, action: 'disable' | 'enable') {
    try {
      await api.post(`/api/versions/${v.id}/${action}`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : `Could not ${action}`;
      toasts.add({ kind: 'error', message: msg });
    }
  }

  async function deleteVersion(v: Version) {
    if (!confirm(`Delete draft version ${v.id}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/versions/${v.id}`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not delete';
      toasts.add({ kind: 'error', message: msg });
    }
  }

  onMount(() => { load(); });
</script>

<div class="page">
  {#if loading}
    <Spinner />
  {:else if error}
    <h1>Couldn't load</h1>
    <p>{error.message}</p>
    <Button variant="ghost" onclick={() => navigate('/courses')}>← Back to courses</Button>
  {:else if course}
    <header>
      <Button variant="ghost" onclick={() => navigate('/courses')}>← Courses</Button>
      <h1>Edit · {course.name}</h1>
    </header>
    <section class="versions">
      <div class="head">
        <h2>Versions</h2>
        <Button onclick={() => (creating = !creating)}>{creating ? 'Cancel' : '+ New version'}</Button>
      </div>
      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); createVersion(); }}>
          <label>Info (markdown)
            <textarea bind:value={info_md} rows="3"></textarea>
          </label>
          <label>Max quiz attempts
            <Input type="number" min="1" max="10" bind:value={max_quiz_attempts} />
          </label>
          <Button type="submit">Create</Button>
        </form>
      {/if}
      {#if versions.length === 0}
        <p class="empty">No versions yet. Create one to start authoring.</p>
      {:else}
        <ul>
          {#each versions as v (v.id)}
            <li class="row">
              <div>
                <strong>v{v.id}</strong>
                <span class="badge state-{v.state}">{v.state}</span>
                {#if v.is_disabled}<span class="badge disabled">disabled</span>{/if}
              </div>
              <div class="actions">
                <Button onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)}>Open</Button>
                {#if v.is_disabled}
                  <Button variant="ghost" onclick={() => transition(v, 'enable')}>Enable</Button>
                {:else}
                  <Button variant="ghost" onclick={() => transition(v, 'disable')}>Disable</Button>
                {/if}
                {#if v.state === 'created' && !v.is_disabled}
                  <Button variant="ghost" onclick={() => deleteVersion(v)}>Delete</Button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
  .row { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
  .actions { display: flex; gap: var(--space-2); }
  .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; margin-left: var(--space-2); }
  .badge.state-created { background: #ffeac0; color: #663; }
  .badge.state-published { background: #ddf3dd; color: #265; }
  .badge.state-archived { background: #eee; color: #555; }
  .badge.disabled { background: #fdd; color: #833; }
  .create { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-3); }
  textarea { width: 100%; }
  .empty { color: var(--muted); }
</style>
```

- [ ] **Step 2: Run check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/pages/editor/VersionsPage.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): VersionsPage (list + create + state actions)"
```

---

### Task 19: VersionEditPage

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte`

- [ ] **Step 1: Implement.** Behavior:
1. Resolve `versionId` from route param (number); call `loadAdminTree(Number(versionId))` if cache stale or missing.
2. Render breadcrumb (`Courses › courseSlug › Edit › v{id}`).
3. **Permissions banner** if `is_disabled` ("This version is disabled — editing is not allowed").
4. **Version-meta form** (info_md textarea + max_quiz_attempts number input) — gated by `canEditVersionMeta`. Tracker via `makeDirtyTracker`. Save calls `PATCH /api/versions/${vid}` then `loadAdminTree(vid, { force: true })` then `tracker.reset({ info_md, max_quiz_attempts })`. Use `<DirtyGuard isDirty={() => tracker.isDirty} />`.
5. **Block list** with ↑/↓, **Open** → block edit page; "+ New block" inline form (title, slug, info=""). Reorder calls `POST /api/versions/${vid}/blocks/reorder` with the full ordering, then `loadAdminTree(vid, {force:true})`.
6. **State actions row**: Publish / Archive / Revert / Disable / Enable / Delete — each shown only when corresponding `versionPermissions(...)` flag is true. **All disabled while form dirty** with tooltip "Save or discard changes first."

Inline-document the dirty-button rule with a `disabled={tracker.isDirty || !canPublish}` style and `title={tracker.isDirty ? 'Save or discard changes first' : ''}`.

(See `VersionsPage` for the API shape and toasts pattern. The reorder logic should construct `{ order: [{id, order}, ...] }` and POST it.)

- [ ] **Step 2: Run check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
```

- [ ] **Step 3: Manual smoke**

Start backend (`cd backend && .venv/bin/uvicorn mathion.main:app --reload`) and frontend (`cd frontend && npm run dev`). Seed via `cd backend && PYTHONPATH=. .venv/bin/python scripts/seed_demo.py`. Log in as `dev@mathion.test`, hit `/courses/<slug>/edit/v/<vid>`, exercise: edit info_md → Save → reload page → persists; reorder block ↑/↓ → backend persists; create block → appears in list; Publish flow with empty block → 409 toast.

- [ ] **Step 4: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/pages/editor/VersionEditPage.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): VersionEditPage (meta form + blocks + state actions)"
```

---

### Task 20: BlockEditPage

**Files:**
- Modify: `frontend/src/pages/editor/BlockEditPage.svelte`

- [ ] **Step 1: Implement.** Behavior:
1. Read `versionId` and `blockId` from route params.
2. Ensure admin-tree loaded for this version (`loadAdminTree`); locate `block` in tree, 404 page if not found or `block.version_id !== Number(versionId)` (deep-link hierarchy validation).
3. **Edit form** for `title` + `info` (gated by `canEditTextFields`). Uses `makeDirtyTracker` + `DirtyGuard`. Save → `PATCH /api/blocks/${blockId}` → `loadAdminTree(versionId, { force: true })` → reset.
4. **Sequences list** with ↑/↓ + Open + "+ New sequence" form (title + slug). Reorder → `POST /api/blocks/${blockId}/sequences/reorder`.
5. **"Delete this block" button** at bottom — gated by `canEditStructure && block.sequences.length === 0`. Tooltip when disabled: "Remove sequences first" or "Only allowed in 'created' state". On confirm + 204 → navigate up to `/courses/${courseSlug}/edit/v/${versionId}`.

(Mirror VersionEditPage's tracker + DirtyGuard + state-action-disabled-while-dirty pattern.)

- [ ] **Step 2: Run check + manual smoke**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
```

Smoke: open a block → edit title → Save → see persisted; create a sequence; try delete with a sequence present → button disabled with tooltip; remove the sequence → delete works.

- [ ] **Step 3: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/pages/editor/BlockEditPage.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): BlockEditPage"
```

---

### Task 21: ItemTypePicker component

**Files:**
- Create: `frontend/src/components/editor/ItemTypePicker.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  type ItemType = 'static_page' | 'video';
  let { value = $bindable() }: { value: ItemType } = $props();
</script>

<fieldset class="picker">
  <legend>Item type</legend>
  <label class:selected={value === 'static_page'}>
    <input type="radio" name="item-type" value="static_page" bind:group={value} />
    <span class="glyph" aria-hidden="true">📄</span>
    <span>Page</span>
  </label>
  <label class:selected={value === 'video'}>
    <input type="radio" name="item-type" value="video" bind:group={value} />
    <span class="glyph" aria-hidden="true">▶️</span>
    <span>Video</span>
  </label>
</fieldset>

<style>
  .picker { display: flex; gap: var(--space-3); border: 0; padding: 0; margin: 0; }
  legend { padding: 0; margin-bottom: var(--space-2); font-weight: 600; }
  label { display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
    padding: var(--space-2); border: 2px solid var(--border); border-radius: var(--radius); cursor: pointer; min-width: 96px; }
  label.selected { border-color: var(--primary); }
  label input { position: absolute; opacity: 0; pointer-events: none; }
  .glyph { font-size: 1.5rem; }
</style>
```

(`bind:group` is the Svelte 5 idiom for radio groups. Selected state is mirrored via the `class:selected` binding rather than `:has(:checked)` so we don't depend on browser support questions.)

- [ ] **Step 2: Run check + commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/components/editor/ItemTypePicker.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): ItemTypePicker (icon radio group)"
```

---

### Task 22: SequenceEditPage

**Files:**
- Modify: `frontend/src/pages/editor/SequenceEditPage.svelte`

- [ ] **Step 1: Implement.** Behavior:
1. Read `versionId`, `blockId`, `sequenceId`. Ensure admin-tree loaded; deep-link validate.
2. **Edit form** for `sequence.title` (gated by `canEditTextFields`). Tracker + DirtyGuard.
3. **Items list** with ↑/↓ + Open + per-row icon (use existing `ItemIcon.svelte` with the item type — render only the static glyph, no progress state).
4. **"+ New item" 2-step inline form**:
   - Step 1: `<ItemTypePicker bind:value={newType} />`.
   - Step 2: `title`, `slug`, plus type-specific:
     - `static_page` → small `content_md` textarea seeded with `# {title}\n` (pre-fill once title is set; updateable).
     - `video` → `video_url` input (`type="url"`, required).
   - Submit: `POST /api/sequences/${sequenceId}/items` with `{ title, slug, type, content_md?, video_url? }`. On 201 → refetch tree + navigate into the new item.
5. **"Delete this sequence" button** — gated by `canEditStructure && sequence.items.length === 0`. Tooltip when disabled.

- [ ] **Step 2: Run check + manual smoke**

Smoke: create a static_page item with title "Intro" → form pre-fills `# Intro\n`; submit → backend accepts; navigates into ItemEditPage. Try video with empty URL → form prevents submit. Try delete sequence with items → button disabled.

- [ ] **Step 3: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/pages/editor/SequenceEditPage.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): SequenceEditPage with 2-step item create"
```

---

### Task 23: MarkdownEditor component

**Files:**
- Create: `frontend/src/components/editor/MarkdownEditor.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { api, ApiError } from '../../lib/api';

  let { versionId, value = $bindable() }: { versionId: number; value: string } = $props();
  let mode = $state<'edit' | 'preview'>('edit');
  let html = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function loadPreview() {
    loading = true;
    error = null;
    try {
      const res = await api.post<{ html: string }>(`/api/versions/${versionId}/render`, { content_md: value });
      html = res.html;
    } catch (e) {
      error = e instanceof ApiError ? e.displayMessage : 'Could not render preview.';
    } finally {
      loading = false;
    }
  }

  function setMode(m: 'edit' | 'preview') {
    mode = m;
    if (m === 'preview') loadPreview();
  }
</script>

<div class="editor">
  <div role="tablist" class="tabs">
    <button role="tab" aria-selected={mode === 'edit'} onclick={() => setMode('edit')}>Edit</button>
    <button role="tab" aria-selected={mode === 'preview'} onclick={() => setMode('preview')}>Preview</button>
  </div>
  {#if mode === 'edit'}
    <textarea bind:value rows="14" spellcheck="false"></textarea>
  {:else if loading}
    <div class="preview"><em>Rendering…</em></div>
  {:else if error}
    <div class="preview err">{error}</div>
  {:else}
    <div class="preview">{@html html ?? ''}</div>
  {/if}
</div>

<style>
  .editor { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tabs button { background: none; border: 0; padding: var(--space-2) var(--space-3); cursor: pointer; }
  .tabs button[aria-selected="true"] { background: var(--surface, #f7f7f7); font-weight: 600; }
  textarea { width: 100%; border: 0; padding: var(--space-3); font-family: ui-monospace, monospace; }
  .preview { padding: var(--space-3); min-height: 200px; }
  .preview.err { color: #a33; }
</style>
```

- [ ] **Step 2: Run check + commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/components/editor/MarkdownEditor.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): MarkdownEditor with on-demand preview"
```

---

### Task 24: ItemEditPage

**Files:**
- Modify: `frontend/src/pages/editor/ItemEditPage.svelte`

- [ ] **Step 1: Implement.** Behavior:
1. Read all four ids from route. Ensure admin-tree loaded; deep-link validate (item.sequence_id matches param, etc.).
2. Switch on `item.type`:
   - `static_page` → `MarkdownEditor` for `content_md`, plain `Input` for `title`. Tracker covers `{ title, content_md }`. Save → `PATCH /api/items/${iid}` → refetch + reset.
   - `video` → `Input` for `title`, `Input type="url"` for `video_url`. Tracker covers `{ title, video_url }`.
   - `quiz` or `interactive_app` → read-only panel: title, type, "Not editable in this slice" message; for quiz, count of questions if available (admin-tree doesn't currently include questions — say "Questions are managed via the API in slice 1; quiz authoring UI lands in slice 2"). Show a Delete button still gated by `canEditStructure`.
3. "Delete this item" button at bottom — gated by `canEditStructure`. Confirm + 204 → navigate up to sequence.

(Reuse the tracker + DirtyGuard + dirty-disables-state-actions pattern from VersionEditPage / BlockEditPage.)

- [ ] **Step 2: Run check + manual smoke**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check
```

Smoke: edit a static_page → Save → reload → persists. Try Preview tab. Open a quiz item → see read-only panel. Delete a static_page item.

- [ ] **Step 3: Commit**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion add frontend/src/pages/editor/ItemEditPage.svelte
git -C /Users/svkucheryavski/Documents/Developing/mathion commit -m "feat(frontend): ItemEditPage (page/video editors + read-only fallback)"
```

---

### Task 25: Manual smoke pass + production build verification

**Files:** none modified; verifying behavior end-to-end.

- [ ] **Step 1: Run all tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run check && npm run test
```
Expected: all green; new backend test count = baseline + 32; new frontend tests for router-guards / versionPermissions / dirty / currentEditorVersion all pass.

- [ ] **Step 2: Manual smoke per spec §11 checklist**

Start the dev server (backend + frontend), seed (`PYTHONPATH=. .venv/bin/python scripts/seed_demo.py`), log in as `dev@mathion.test`, and walk the 14-step checklist from spec §11 ("Manual smoke checklist"). Each step has a single yes/no acceptance. Note any failure as a follow-up commit on this branch.

- [ ] **Step 3: Production build verification**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run build
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && MATHION_DEBUG=1 .venv/bin/uvicorn mathion.main:app --reload
```

Hit deep editor URLs against the production-built SPA mount; refresh at every depth (`/courses/calc/edit`, `/courses/calc/edit/v/3`, `/courses/calc/edit/v/3/blocks/12/sequences/47/items/87`). All should resolve via SPA fallback.

- [ ] **Step 4: Open PR (optional)**

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion push -u origin frontend-admin-editor
gh pr create --title "feat: course-admin editor (slice 1)" --body "$(cat <<'EOF'
## Summary
- 9 small backend additions/changes (is_admin, by-slug, /my-courses extension, delete guards, publish disabled gate, PATCH version, render endpoint, admin-tree)
- 5 new editor pages (Versions, VersionEdit, BlockEdit, SequenceEdit, ItemEdit)
- 3 new editor components (ItemTypePicker, MarkdownEditor, DirtyGuard)
- 4 new lib/store modules (versionPermissions, dirty, currentEditorVersion store, router beforeNavigate hook)
- ~32 new backend tests; ~12 new frontend tests; manual smoke pass complete

## Spec
docs/superpowers/specs/2026-05-06-frontend-admin-course-editor-design.md

## Test plan
- [x] Backend pytest: green
- [x] Frontend svelte-check + vitest: green
- [x] Manual smoke checklist (spec §11): all 14 items pass
- [x] Production build deep-link refresh: works at all depths

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Skip the PR step if the user prefers to merge locally.)

---

## Spec coverage self-review

| Spec section | Tasks |
|---|---|
| §1 Resolved decisions | All decisions implemented across the plan |
| §2 Project structure (frontend) | Tasks 10, 11, 12, 13, 14, 15, 17, 21, 23 (libs/components); 16, 18-20, 22, 24 (pages) |
| §2 Backend additions (rows 1-9) | Tasks 1-9 (one task per row) |
| §3 Routes/pages | Task 17 (routes); Tasks 18-20, 22, 24 (pages); Task 16 (CourseList) |
| §4 Admin-tree fetch + cache | Task 14 (store with single-flight + force) |
| §5 Save/dirty/discard + router contract | Tasks 10 (router), 13 (tracker), 15 (DirtyGuard), 19/20/22/24 (per-page wiring) |
| §6 Reorder/create/delete + guards | Tasks 4, 5 (backend guards); 19, 20, 22 (frontend reorder/CRUD); 22 (item create flow) |
| §7 Markdown preview | Task 8 (backend render); Task 23 (MarkdownEditor) |
| §8 Publish flow | Task 6 (backend is_disabled gate); Task 19 (publish action with dirty-button gate) |
| §9 Error → UI mapping | Inherited from existing `lib/api.ts` ApiError; per-page toasts in pages |
| §10 Read-only matrix + helper | Task 12 (helper + tests); Tasks 19/20/22/24 consume |
| §11 Testing approach | Backend tests in Tasks 1-9; frontend unit tests in Tasks 10, 12, 13, 14, 17; manual smoke in Task 25 |
| §12 Suggested implementation order | Plan task order matches spec §12 ordering |

No spec section is left without implementing tasks.
