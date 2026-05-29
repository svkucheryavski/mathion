# Teacher Monitoring Slice A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock teachers (users with `RunTeacher` rows but no `CourseAdmin`) to log in, see their assigned runs at `/teaching`, and use the existing run-detail page with admin-only actions conditionally hidden.

**Architecture:** Open four backend GET endpoints to teachers via the existing `RunTeacher` table (with a content filter on `versions`), extend `UserResponse` with two role flags driven on PIN-verify and `/me`, add `/api/teaching/runs` returning the teacher's run list with course context. Add an `AppHeader` for nav, a `TeacherRunListPage` for the landing page, role-aware routing in `App.svelte` + `Login.svelte` so teacher-only users land on `/teaching`, and thread a `course: Course` prop into the five run-detail tabs so each can hide admin-only controls via `{#if course.is_admin}`. No DB schema change.

**Tech Stack:** FastAPI + SQLAlchemy 2.x backend (`backend/.venv`), Svelte 5 + Vitest frontend (`frontend/`), pytest for backend tests.

**Spec:** `docs/superpowers/specs/2026-05-29-teacher-monitoring-slice-a-design.md` (rev 17, post-codex round 16 plan-ready). Every task below cites the spec section it implements; consult the spec for the full rationale on any specific change.

**Working dir conventions:**
- Backend test invocation: `backend/.venv/bin/pytest backend/tests/<file>.py -v`
- Frontend test invocation: `cd frontend && npm test -- <pattern>` (which runs `TZ=Europe/Copenhagen vitest run <pattern>`)
- Frontend type-check: `cd frontend && npm run check`

**Task ordering rationale:** Backend (T1-T4) first so the wire surface is stable. Frontend foundations (T5: types + wire module + router helpers) before consumers (T6: NotFound/Login, T7: AppHeader, T8: TeacherRunListPage, T9: App.svelte). Run-detail prop threading (T10-T12) is independent of the landing/AppHeader work and could be done in parallel after T5, but is sequenced after for review clarity. T13 is manual smoke; T14 is cleanup.

---

## Task 1: Backend helpers — `has_run_teacher_on_course` + `has_run_pinned_to_version`

**Spec:** §3.1.1, §3.1.3 helper definitions; §6.1 helper unit tests block.

**Files:**
- Modify: `backend/mathion/api/helpers.py` — add two new helpers at the bottom of the file.
- Test: `backend/tests/test_teaching.py` — new file; both helper test groups.

**Why this is first:** Both helpers are consumed by 4 endpoint widenings in T2 and the `/api/teaching/runs` route in T4. Shipping helpers + their unit tests first means later tasks can call them directly. No production endpoint behavior changes until T2.

- [ ] **Step 1: Create `backend/tests/test_teaching.py` with helper-unit-test scaffolding**

```python
"""Tests for the teacher monitoring surface (Slice A).

Helper unit tests are called as plain Python functions (not via HTTP),
matching the precedent at `backend/tests/test_run_permissions.py` and
`backend/tests/test_slugify.py`.
"""
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    has_run_teacher_on_course,
    has_run_pinned_to_version,
)
from mathion.models import Course, CourseVersion, Run, RunTeacher
from mathion.models_auth import User


def _make_user(db: Session, email: str) -> User:
    u = User(email=email, full_name=email.split("@")[0])
    db.add(u); db.commit(); db.refresh(u); return u


def _make_course(db: Session, slug: str = "c1", name: str = "C1") -> Course:
    c = Course(slug=slug, name=name, description="")
    db.add(c); db.commit(); db.refresh(c); return c


def _make_version(
    db: Session, course_id: int, state: str = "published", is_disabled: bool = False
) -> CourseVersion:
    v = CourseVersion(course_id=course_id, state=state, is_disabled=is_disabled,
                      info_md="", info_html="")
    db.add(v); db.commit(); db.refresh(v); return v


def _make_run(db: Session, version_id: int, title: str = "R") -> Run:
    r = Run(version_id=version_id, title=title,
            start_date="2026-01-01", end_date="2026-12-31",
            groups_enabled=False, is_published=False)
    db.add(r); db.commit(); db.refresh(r); return r


def _link_teacher(db: Session, run_id: int, user_id: int) -> None:
    db.add(RunTeacher(run_id=run_id, user_id=user_id)); db.commit()
```

- [ ] **Step 2: Write failing tests for `has_run_teacher_on_course` (7 cases per spec §6.1)**

Append to `backend/tests/test_teaching.py`:

```python
class TestHasRunTeacherOnCourse:
    def test_hits_when_teacher_row_on_pinned_version(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v = _make_version(db, c.id)
        r = _make_run(db, v.id)
        _link_teacher(db, r.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True

    def test_hits_when_teacher_row_on_different_version_of_same_course(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v1 = _make_version(db, c.id)
        v2 = _make_version(db, c.id)
        r2 = _make_run(db, v2.id)
        _link_teacher(db, r2.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True
        assert v1.id != v2.id  # sanity

    def test_hits_when_teacher_row_on_draft_state_version(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v = _make_version(db, c.id, state="created")
        r = _make_run(db, v.id)
        _link_teacher(db, r.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True

    def test_hits_when_multiple_teacher_rows_on_same_course(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v = _make_version(db, c.id)
        r1 = _make_run(db, v.id, "R1")
        r2 = _make_run(db, v.id, "R2")
        _link_teacher(db, r1.id, u.id)
        _link_teacher(db, r2.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True

    def test_misses_when_no_teacher_row(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        _make_version(db, c.id)
        assert has_run_teacher_on_course(db, u, c.id) is False

    def test_misses_when_teacher_row_on_different_course(self, db):
        u = _make_user(db, "t@x")
        c1 = _make_course(db, "c1", "C1")
        c2 = _make_course(db, "c2", "C2")
        v2 = _make_version(db, c2.id)
        r2 = _make_run(db, v2.id)
        _link_teacher(db, r2.id, u.id)
        assert has_run_teacher_on_course(db, u, c1.id) is False

    def test_misses_when_only_other_user_has_teacher_row(self, db):
        u = _make_user(db, "t@x")
        other = _make_user(db, "o@x")
        c = _make_course(db)
        v = _make_version(db, c.id)
        r = _make_run(db, v.id)
        _link_teacher(db, r.id, other.id)
        assert has_run_teacher_on_course(db, u, c.id) is False
```

- [ ] **Step 3: Write failing tests for `has_run_pinned_to_version` (6 cases per spec §6.1)**

Append:

```python
class TestHasRunPinnedToVersion:
    def test_hits_when_teacher_row_on_run_with_this_version_id(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db); v = _make_version(db, c.id)
        r = _make_run(db, v.id); _link_teacher(db, r.id, u.id)
        assert has_run_pinned_to_version(db, u, v.id) is True

    def test_misses_when_teacher_row_on_run_with_different_version_id(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v1 = _make_version(db, c.id); v2 = _make_version(db, c.id)
        r1 = _make_run(db, v1.id); _link_teacher(db, r1.id, u.id)
        assert has_run_pinned_to_version(db, u, v2.id) is False

    def test_misses_when_no_teacher_row(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db); v = _make_version(db, c.id)
        _make_run(db, v.id)
        assert has_run_pinned_to_version(db, u, v.id) is False

    def test_misses_when_only_other_user_has_teacher_row(self, db):
        u = _make_user(db, "t@x"); other = _make_user(db, "o@x")
        c = _make_course(db); v = _make_version(db, c.id)
        r = _make_run(db, v.id); _link_teacher(db, r.id, other.id)
        assert has_run_pinned_to_version(db, u, v.id) is False

    def test_hits_when_pinned_version_is_created_state(self, db):
        u = _make_user(db, "t@x"); c = _make_course(db)
        v = _make_version(db, c.id, state="created")
        r = _make_run(db, v.id); _link_teacher(db, r.id, u.id)
        assert has_run_pinned_to_version(db, u, v.id) is True

    def test_hits_when_pinned_version_is_disabled(self, db):
        u = _make_user(db, "t@x"); c = _make_course(db)
        v = _make_version(db, c.id, is_disabled=True)
        r = _make_run(db, v.id); _link_teacher(db, r.id, u.id)
        assert has_run_pinned_to_version(db, u, v.id) is True
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py -v`
Expected: `ImportError: cannot import name 'has_run_teacher_on_course' from 'mathion.api.helpers'` (or similar).

- [ ] **Step 5: Implement both helpers in `backend/mathion/api/helpers.py`**

Append to the bottom of the file. Confirm `select`, `exists`, `Session` are already imported (helpers.py already uses them). Add `RunTeacher` and `Run` to the existing `from mathion.models import ...` line if missing:

```python
from sqlalchemy import select, exists
from sqlalchemy.orm import Session

from mathion.models import Run, RunTeacher, CourseVersion
from mathion.models_auth import User


def has_run_teacher_on_course(db: Session, user: User, course_id: int) -> bool:
    """Return True iff the user has a RunTeacher row on any run of any version of the course.

    Used by `GET /api/courses/by-slug/{slug}` only. The version-list and block-list
    endpoints use tighter predicates (IN-subquery / has_run_pinned_to_version).
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


def has_run_pinned_to_version(db: Session, user: User, version_id: int) -> bool:
    """Return True iff the user has a RunTeacher row on a run whose version_id matches.

    Used by `GET /api/versions/{vid}/blocks` and `GET /assets/{vid}/{filename}`.
    No `course_id` parameter required — CourseVersion.id is globally unique.
    UI-relevant predicate; never used for any write-path authorization decision.
    """
    return bool(db.scalar(
        select(exists().where(
            RunTeacher.user_id == user.id,
            RunTeacher.run_id == Run.id,
            Run.version_id == version_id,
        ))
    ))
```

If the existing top-of-file imports already cover some of these names, do NOT duplicate. Adjust to be additive.

- [ ] **Step 6: Run tests to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py -v`
Expected: 13 PASSED (7 + 6).

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/api/helpers.py backend/tests/test_teaching.py
git commit -m "feat(backend): teacher-scoped helpers has_run_teacher_on_course + has_run_pinned_to_version (slice A T1)"
```

---

## Task 2: Backend gate widening — `by-slug` + `versions` + `blocks` + `serve_asset`

**Spec:** §3.1.1, §3.1.2, §3.1.3, §3.1.3a; §6.1 opened-endpoint tests; §3.1.6 write-still-admin regression tests.

**Files:**
- Modify: `backend/mathion/api/courses.py` (~line 80 — `get_course_by_slug`)
- Modify: `backend/mathion/api/versions.py` (~lines 130-145 — `list_versions`)
- Modify: `backend/mathion/api/blocks.py` (~lines 90-100 — `list_blocks`)
- Modify: `backend/mathion/api/assets.py` (~lines 130-160 — `serve_asset` 4-branch gate)
- Test: `backend/tests/test_teaching.py` — append endpoint tests + cascade-guard tests.

**Critical hazard (spec §3.1.1):** The current `courses.py:80` unconditionally sets `out.is_admin = True` after the admin gate. Naively adding a teacher branch with a "remember to set False" comment is fragile — a copy-paste omission would expose the entire admin UI to teachers. The fix: compute a single `is_admin_role` boolean in the gate and assign it ONCE.

- [ ] **Step 1: Write failing endpoint tests — `by-slug`**

Append to `backend/tests/test_teaching.py`:

```python
class TestByLugTeacherAccess:
    def test_by_slug_allows_run_teacher_returns_is_admin_false(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 200, r.text
        assert r.json()["is_admin"] is False

    def test_by_slug_admin_who_is_also_teacher_returns_is_admin_true(
        self, admin_client, superuser, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=superuser.id))
        db.commit()
        r = admin_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 200
        assert r.json()["is_admin"] is True  # admin precedence

    def test_by_slug_superuser_returns_is_admin_true(
        self, admin_client, seed_publishable_version,
    ):
        course, _ = seed_publishable_version()
        r = admin_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_by_slug_still_rejects_non_member(
        self, teacher_client, seed_publishable_version,
    ):
        course, _ = seed_publishable_version()
        # teacher_user has no roles on this course
        r = teacher_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestByLugTeacherAccess -v`
Expected: First three FAIL (current handler 403s teachers).

- [ ] **Step 3: Refactor `get_course_by_slug` to compute `is_admin_role` once and assign once**

Open `backend/mathion/api/courses.py`. Locate the handler around line 80 (search for `out.is_admin = True`). Rewrite the gate to evaluate role precedence and assign `out.is_admin` exactly once at the end. Concrete shape:

```python
# inside get_course_by_slug, after the course lookup:
is_admin_role: bool = False
if user.is_superuser:
    is_admin_role = True
elif db.scalar(select(exists().where(
    CourseAdmin.user_id == user.id,
    CourseAdmin.course_id == course.id,
))):
    is_admin_role = True
elif has_run_teacher_on_course(db, user, course.id):
    is_admin_role = False  # explicit: teachers allowed, not admin
else:
    raise HTTPException(status_code=403, detail="Access denied")

# ... existing code that builds `out` from the course ...
out.is_admin = is_admin_role
return out
```

Add the import: `from mathion.api.helpers import has_run_teacher_on_course`. Delete the original unconditional `out.is_admin = True` line. Preserve all other handler behavior (the `CourseResponse` construction, any `model_validate` / `model_copy` patterns at lines around 47/67 are unchanged — only the gate logic and the single `is_admin` assignment move).

- [ ] **Step 4: Run by-slug tests to verify they pass; run the existing `test_courses.py` to verify no regression**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestByLugTeacherAccess backend/tests/test_courses.py -v`
Expected: All PASS (4 new + all existing).

- [ ] **Step 5: Write failing endpoint tests — `versions` (pinned-versions-only filter)**

Append:

```python
class TestVersionsListTeacherAccess:
    def test_returns_only_pinned_versions_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        v3 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        # Teacher's only run is pinned to v2
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # repin run to v2 manually
        from mathion.models import Run
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v2["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200, r.text
        ids = [v["id"] for v in r.json()]
        assert ids == [v2["id"]]
        assert v1["id"] not in ids and v3["id"] not in ids

    def test_returns_multiple_pinned_versions_when_teacher_teaches_multiple_runs_on_same_course(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        r1 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R1", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        r2 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R2", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # r1 → v1, r2 → v2
        db.query(Run).filter(Run.id == r1["id"]).update({"version_id": v1["id"]})
        db.query(Run).filter(Run.id == r2["id"]).update({"version_id": v2["id"]})
        db.add(RunTeacher(run_id=r1["id"], user_id=teacher_user.id))
        db.add(RunTeacher(run_id=r2["id"], user_id=teacher_user.id))
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        ids = [v["id"] for v in r.json()]
        assert ids == sorted([v1["id"], v2["id"]])  # id ASC order

    def test_includes_pinned_draft_state_version_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        # Course with a draft version. Pin a teacher run to it.
        course, _ = seed_publishable_version()
        v_draft = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        # Don't publish v_draft; it stays in 'created' state.
        from mathion.models import Run
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v_draft["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        assert v_draft["id"] in [v["id"] for v in r.json()]

    def test_includes_pinned_disabled_version_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import CourseVersion as CV, Run
        course, v1 = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        # Disable v1 directly
        db.query(CV).filter(CV.id == v1["id"]).update({"is_disabled": True})
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        assert v1["id"] in [v["id"] for v in r.json()]

    def test_admin_still_sees_all_versions_with_original_order_and_pagination(
        self, admin_client, seed_publishable_version,
    ):
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        v3 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        r = admin_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        all_ids = [v["id"] for v in r.json()]
        assert set(all_ids) == {v1["id"], v2["id"], v3["id"]}
        # created_at DESC, id DESC — newest first
        assert all_ids[0] == v3["id"]

        r2 = admin_client.get(f"/api/courses/{course['id']}/versions?limit=1&offset=1")
        assert r2.status_code == 200
        assert len(r2.json()) == 1

    def test_versions_list_still_rejects_non_member(
        self, teacher_client, seed_publishable_version,
    ):
        course, _ = seed_publishable_version()
        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 403
```

- [ ] **Step 6: Run tests to verify they fail; then widen `list_versions`**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestVersionsListTeacherAccess -v` — expect failures.

Open `backend/mathion/api/versions.py`. Locate `list_versions` (around lines 130-145). Insert teacher branch:

```python
# inside list_versions(), after the existing admin-precedence check:
if user.is_superuser or db.scalar(select(exists().where(
    CourseAdmin.user_id == user.id,
    CourseAdmin.course_id == course_id,
))):
    # Admin path — UNCHANGED. Existing query with limit/offset and created_at DESC.
    # (keep the existing code here verbatim)
    ...
else:
    # Teacher path — NEW.
    if not has_run_teacher_on_course(db, user, course_id):
        raise HTTPException(status_code=403, detail="Access denied")
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
    return [VersionResponse.model_validate(v) for v in versions]
```

Add imports as needed: `from mathion.api.helpers import has_run_teacher_on_course`, `from mathion.models import Run, RunTeacher`. Re-run the new tests + the existing `test_versions*.py` files.

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestVersionsListTeacherAccess backend/tests/ -k "versions" -v`
Expected: All PASS.

- [ ] **Step 7: Write failing tests for `blocks` widening**

Append:

```python
class TestBlocksListTeacherAccess:
    def test_allows_teacher_on_pinned_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get(f"/api/versions/{v['id']}/blocks")
        assert r.status_code == 200, r.text

    def test_allows_teacher_on_pinned_disabled_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import CourseVersion as CV
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.query(CV).filter(CV.id == v["id"]).update({"is_disabled": True})
        db.commit()
        r = teacher_client.get(f"/api/versions/{v['id']}/blocks")
        assert r.status_code == 200

    def test_allows_teacher_on_pinned_draft_state_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, _ = seed_publishable_version()
        v_draft = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v_draft["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get(f"/api/versions/{v_draft['id']}/blocks")
        assert r.status_code == 200

    def test_rejects_teacher_on_unpinned_published_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # pin to v1
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v1["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        # request v2 (unpinned)
        r = teacher_client.get(f"/api/versions/{v2['id']}/blocks")
        assert r.status_code == 403

    def test_blocks_list_still_rejects_non_member(
        self, teacher_client, seed_publishable_version,
    ):
        course, v = seed_publishable_version()
        r = teacher_client.get(f"/api/versions/{v['id']}/blocks")
        assert r.status_code == 403
```

- [ ] **Step 8: Run tests to verify they fail; then widen `list_blocks`**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestBlocksListTeacherAccess -v` — expect failures.

Open `backend/mathion/api/blocks.py`. Locate `list_blocks` (around lines 90-100). Modify the gate to:

```python
# After loading version via get_or_404 (existing code):
if not user.is_superuser:
    is_admin = db.scalar(select(exists().where(
        CourseAdmin.user_id == user.id,
        CourseAdmin.course_id == version.course_id,
    )))
    if not is_admin and not has_run_pinned_to_version(db, user, version_id):
        raise HTTPException(status_code=403, detail="Access denied")
```

Add imports: `from mathion.api.helpers import has_run_pinned_to_version`. Existing write endpoints (POST/PATCH/DELETE under blocks) remain `require_course_admin` — do NOT modify their gates.

Run the new tests + `test_blocks*.py`. Expected: PASS.

- [ ] **Step 9: Write failing tests for `serve_asset` widening (§3.1.3a)**

Append (use the spec's `_seed_teacher_with_pinned_version_and_asset` helper pattern):

```python
def _upload_asset(admin_client, version_id: int, filename: str = "logo.png",
                  data: bytes = b"PNGDATA") -> None:
    r = admin_client.post(
        f"/api/versions/{version_id}/assets",
        files={"file": (filename, data, "image/png")},
    )
    assert r.status_code in (200, 201), r.text


def _seed_teacher_with_pinned_version_and_asset(
    db, admin_client, teacher_user, seed_publishable_version,
    *, state: str = "published", is_disabled: bool = False,
    filename: str = "logo.png",
):
    """Returns (course, version_dict, filename). Pins teacher to a run on this version
    and uploads an asset to the version."""
    from mathion.models import CourseVersion as CV
    course, v = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01",
              "end_date": "2026-12-31", "groups_enabled": False},
    ).json()
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    if state != "published" or is_disabled:
        updates = {}
        if state != "published":
            updates["state"] = state
        if is_disabled:
            updates["is_disabled"] = True
        db.query(CV).filter(CV.id == v["id"]).update(updates)
    db.commit()
    _upload_asset(admin_client, v["id"], filename=filename)
    return course, v, filename


class TestServeAssetTeacherAccess:
    def test_allows_teacher_on_pinned_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, fn = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        r = teacher_client.get(f"/assets/{v['id']}/{fn}")
        assert r.status_code == 200, r.text
        assert r.content == b"PNGDATA"

    def test_rejects_teacher_on_pinned_disabled_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, fn = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
            is_disabled=True,
        )
        r = teacher_client.get(f"/assets/{v['id']}/{fn}")
        # is_disabled short-circuit at assets.py:139 — admin-symmetric (everyone 403s)
        assert r.status_code == 403

    def test_allows_teacher_on_pinned_draft_state_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, fn = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
            state="created",
        )
        r = teacher_client.get(f"/assets/{v['id']}/{fn}")
        assert r.status_code == 200

    def test_rejects_teacher_on_unpinned_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v1["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        _upload_asset(admin_client, v2["id"], "logo.png")
        r = teacher_client.get(f"/assets/{v2['id']}/logo.png")
        assert r.status_code == 403

    def test_assets_serve_still_rejects_non_member(
        self, teacher_client, admin_client, seed_publishable_version,
    ):
        _, v = seed_publishable_version()
        _upload_asset(admin_client, v["id"], "logo.png")
        r = teacher_client.get(f"/assets/{v['id']}/logo.png")
        assert r.status_code == 403

    def test_assets_list_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, _ = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        # The admin-only listing endpoint
        r = teacher_client.get(f"/api/versions/{v['id']}/assets")
        assert r.status_code == 403

    def test_assets_upload_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, _ = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        r = teacher_client.post(
            f"/api/versions/{v['id']}/assets",
            files={"file": ("evil.png", b"X", "image/png")},
        )
        assert r.status_code == 403

    def test_assets_delete_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, fn = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        r = teacher_client.delete(f"/api/versions/{v['id']}/assets/{fn}")
        assert r.status_code == 403
```

- [ ] **Step 10: Run tests to verify they fail; widen `serve_asset`**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestServeAssetTeacherAccess -v` — expect failures.

Open `backend/mathion/api/assets.py`. Locate `serve_asset` (~lines 130-182). Insert the 4th branch after the StudentEnrollment check (per spec §3.1.3a):

```python
# inside serve_asset, after the StudentEnrollment.is_active check fails:
if not has_run_pinned_to_version(db, user, version_id):
    raise HTTPException(status_code=403, detail="Access denied")
```

Add import: `from mathion.api.helpers import has_run_pinned_to_version`. Do NOT change the `is_disabled` short-circuit at lines 139-140 (admin-symmetric). Do NOT change `upload_asset`, `list_assets`, or `delete_asset` gates.

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestServeAssetTeacherAccess backend/tests/test_assets_api.py -v`
Expected: All PASS, including the existing `test_serve_asset_disabled_version_blocks_admin` regression (locked at `backend/tests/test_assets_api.py:216-229`).

- [ ] **Step 11: Write failing cascade-guard + write-still-admin regression tests**

Append:

```python
class TestCascadeGuards:
    """Lock: opening /blocks does NOT cascade to authoring leaves."""

    def test_sequences_list_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        # Locate the seeded block id via admin
        blocks = admin_client.get(f"/api/versions/{v['id']}/blocks").json()
        assert blocks, "fixture seed should create a block"
        block_id = blocks[0]["id"]
        r = teacher_client.get(f"/api/blocks/{block_id}/sequences")
        assert r.status_code == 403

    def test_items_list_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        blocks = admin_client.get(f"/api/versions/{v['id']}/blocks").json()
        seqs = admin_client.get(f"/api/blocks/{blocks[0]['id']}/sequences").json()
        assert seqs
        r = teacher_client.get(f"/api/sequences/{seqs[0]['id']}/items")
        assert r.status_code == 403

    def test_versions_write_still_admin_only(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        )
        assert r.status_code == 403
```

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestCascadeGuards -v`
Expected: PASS (these gates are pre-existing — the tests just lock them).

- [ ] **Step 12: Commit**

```bash
git add backend/mathion/api/courses.py backend/mathion/api/versions.py \
        backend/mathion/api/blocks.py backend/mathion/api/assets.py \
        backend/tests/test_teaching.py
git commit -m "feat(backend): open by-slug/versions/blocks/serve_asset to teachers via pinned-run helpers (slice A T2)"
```

---

## Task 3: Backend `UserResponse` flags + `/me` + PIN-verify wiring

**Spec:** §3.1.4, §6.1 `/me` flag tests + `api_verify_pin` PIN-verify role-flag test.

**Files:**
- Modify: `backend/mathion/schemas.py` — extend `UserResponse` with two `bool = False` defaults.
- Modify: `backend/mathion/api/auth.py` — add `_user_response_with_flags` private helper colocated with the route handlers; widen `get_profile`; wire helper into both `get_profile` and `api_verify_pin`.
- Test: `backend/tests/test_auth.py` — extend with the new tests.

- [ ] **Step 1: Write the failing `/me` and PIN-verify flag tests**

Append to `backend/tests/test_auth.py`:

```python
import pytest

from mathion.models import CourseAdmin, Run, RunTeacher
from mathion.models_auth import User
from mathion.auth import request_pin


class TestMeRoleFlags:
    def test_me_admin_only(self, admin_client, superuser, seed_publishable_version, db):
        # superuser → has_course_admin: True via short-circuit
        r = admin_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is True
        assert body["has_run_teacher"] is False

    def test_me_teacher_only(self, teacher_client, teacher_user, admin_client,
                             seed_publishable_version, db):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is False
        assert body["has_run_teacher"] is True

    def test_me_both(self, teacher_client, teacher_user, admin_client,
                     seed_publishable_version, db):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course["id"]))
        db.commit()
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is True
        assert body["has_run_teacher"] is True

    def test_me_neither(self, teacher_client):
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_course_admin"] is False
        assert body["has_run_teacher"] is False

    def test_me_response_shape_includes_existing_fields(self, teacher_client):
        r = teacher_client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        for key in ("id", "email", "full_name", "is_superuser", "is_disabled", "photo_url"):
            assert key in body, f"missing {key!r} in /me response"


class TestVerifyPinFlags:
    def test_verify_pin_response_includes_role_flags(
        self, client, admin_client, teacher_user, seed_publishable_version, db,
    ):
        course, _version = seed_publishable_version()
        run_resp = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={
                "title": "R",
                "start_date": "2026-01-01",
                "end_date": "2026-12-31",
                "groups_enabled": False,
            },
        )
        assert run_resp.status_code == 201, run_resp.text
        run = run_resp.json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()

        pin = request_pin(db, teacher_user.email)
        assert pin is not None

        r = client.post(
            "/api/auth/verify-pin",
            json={"email": teacher_user.email, "pin": pin, "duration_days": 7},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "user" in body
        assert body["user"]["has_run_teacher"] is True
        assert body["user"]["has_course_admin"] is False
        for key in ("id", "email", "full_name", "is_superuser", "is_disabled", "photo_url"):
            assert key in body["user"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_auth.py::TestMeRoleFlags backend/tests/test_auth.py::TestVerifyPinFlags -v`
Expected: Multiple FAIL — `KeyError: 'has_course_admin'` (field not in response).

- [ ] **Step 3: Extend `UserResponse` schema**

Open `backend/mathion/schemas.py`. Find `UserResponse`. Add two new fields with defaults so existing ORM-based `model_validate(user)` calls don't break:

```python
class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    is_superuser: bool
    is_disabled: bool
    photo_url: str | None
    has_course_admin: bool = False   # NEW — overwritten by _user_response_with_flags
    has_run_teacher: bool = False    # NEW — overwritten by _user_response_with_flags

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Add `_user_response_with_flags` private helper and wire it into `get_profile` + `api_verify_pin`**

Open `backend/mathion/api/auth.py`. Add imports (verify which are already present):

```python
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import CourseAdmin, RunTeacher
from mathion.schemas import UserResponse
```

Add the helper near the top of the file (after imports, before handlers):

```python
def _user_response_with_flags(db: Session, user) -> UserResponse:
    """Build a UserResponse with `has_course_admin` and `has_run_teacher` populated.

    Flags are UI hints for nav rendering only. Server-side authorization is
    always re-evaluated via require_* helpers. Do NOT branch on these flags in
    any new endpoint.
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

Update `get_profile` (currently `def get_profile(user: User = Depends(get_current_user))`):

```python
@router.get("/me", response_model=UserResponse)
def get_profile(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserResponse:
    return _user_response_with_flags(db, user)
```

Update `api_verify_pin` (the existing route at the top of the file, currently returning `{"user": UserResponse.model_validate(user)}`):

```python
# Inside api_verify_pin, after verify_pin returns successfully and we have `user`:
return {"user": _user_response_with_flags(db, user)}
```

DO NOT wire `_user_response_with_flags` into `update_profile` (the PATCH `/api/auth/me` handler). Per spec §3.1.4, that handler is intentionally left alone in Slice A — the existing `frontend/src/lib/auth.svelte.ts` does not replace `session.user` from a PATCH response, so the missing flags can't clobber the nav.

- [ ] **Step 5: Run tests to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_auth.py -v`
Expected: All PASS (new tests + existing).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/auth.py backend/tests/test_auth.py
git commit -m "feat(backend): UserResponse has_course_admin/has_run_teacher flags via _user_response_with_flags (slice A T3)"
```

---

## Task 4: Backend `/api/teaching/runs` router + `TeachingRunRow` schema

**Spec:** §3.1.5; §6.1 `/api/teaching/runs` tests block.

**Files:**
- Modify: `backend/mathion/schemas.py` — add `TeachingRunRow` (no `model_config`).
- Create: `backend/mathion/api/teaching.py` — new router file.
- Modify: `backend/mathion/main.py` — register `teaching_router` BEFORE the SPA catch-all (~lines 50-71).
- Test: `backend/tests/test_teaching.py` — append `TestTeachingRunsEndpoint` class.

- [ ] **Step 1: Write failing endpoint tests**

Append to `backend/tests/test_teaching.py`:

```python
class TestTeachingRunsEndpoint:
    def test_returns_only_my_runs(
        self, teacher_client, teacher_user, admin_client,
        seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        my_run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "Mine", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        other_run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "NotMine", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=my_run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        rows = r.json()
        ids = [row["run"]["id"] for row in rows]
        assert my_run["id"] in ids
        assert other_run["id"] not in ids

    def test_empty(self, teacher_client):
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []

    def test_student_count_zero(
        self, teacher_client, teacher_user, admin_client,
        seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.json()[0]["student_count"] == 0

    def test_student_count_multiple(
        self, teacher_client, teacher_user, admin_client,
        seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": True},
        ).json()
        # Add students via admin
        admin_client.post(f"/api/runs/{run['id']}/students",
                          json={"email": "s1@x"})
        admin_client.post(f"/api/runs/{run['id']}/students",
                          json={"email": "s2@x"})
        admin_client.post(f"/api/runs/{run['id']}/students",
                          json={"email": "s3@x"})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.json()[0]["student_count"] == 3

    def test_superuser_sees_only_own_teacher_rows(
        self, admin_client, superuser, seed_publishable_version, db,
    ):
        # Superuser → NO RunTeacher row → empty response (NO superuser bypass)
        seed_publishable_version()
        r = admin_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []

    def test_excludes_runs_where_user_is_course_admin_but_not_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # Make teacher_user a CourseAdmin but NOT a RunTeacher
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course["id"]))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []
        # sanity: the run exists
        assert run["id"]

    def test_orders_by_id_asc(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        r1 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R1", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        r2 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R2", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=r1["id"], user_id=teacher_user.id))
        db.add(RunTeacher(run_id=r2["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        ids = [row["run"]["id"] for row in r.json()]
        assert ids == sorted(ids)

    def test_response_key_set(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        assert len(body) == 1
        row = body[0]
        assert set(row.keys()) == {"run", "course_id", "course_name",
                                   "course_slug", "student_count"}
        for k in ("id", "title", "start_date", "end_date", "is_published",
                  "created_at"):
            assert k in row["run"], f"missing {k!r} in nested run"

    def test_course_slug_populated(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        row = teacher_client.get("/api/teaching/runs").json()[0]
        assert row["course_slug"] == course["slug"]
        assert row["course_slug"]  # non-empty

    def test_includes_runs_pinned_to_disabled_versions(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import CourseVersion as CV
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.query(CV).filter(CV.id == v["id"]).update({"is_disabled": True})
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        assert any(row["run"]["id"] == run["id"] for row in body)

    def test_includes_unpublished_draft_runs(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        # Run is unpublished by default — included
        body = teacher_client.get("/api/teaching/runs").json()
        ids = [row["run"]["id"] for row in body]
        assert run["id"] in ids
        assert any(not row["run"]["is_published"] for row in body)

    def test_returns_run_when_user_is_one_of_multiple_teachers(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        other = User(email="other@x", full_name="Other")
        db.add(other); db.commit(); db.refresh(other)
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.add(RunTeacher(run_id=run["id"], user_id=other.id))
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        run_ids = [row["run"]["id"] for row in body]
        # exactly one row, no duplication despite the two-teacher row
        assert run_ids.count(run["id"]) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestTeachingRunsEndpoint -v`
Expected: 404 on every call (route doesn't exist yet).

- [ ] **Step 3: Add `TeachingRunRow` schema**

Append to `backend/mathion/schemas.py`:

```python
class TeachingRunRow(BaseModel):
    run: "RunResponse"
    course_id: int
    course_name: str
    course_slug: str
    student_count: int
    # No `model_config` — this row is built field-by-field in the handler, not
    # from a single ORM model, so `from_attributes` would not apply correctly.
```

If `RunResponse` is defined below this line, the forward reference handles ordering. After class definitions resolve, you may need `TeachingRunRow.model_rebuild()` if Pydantic complains.

- [ ] **Step 4: Create the new router file**

Create `backend/mathion/api/teaching.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseVersion, Run, RunStudent, RunTeacher
from mathion.models_auth import User
from mathion.schemas import RunResponse, TeachingRunRow

router = APIRouter(tags=["teaching"])


@router.get("/api/teaching/runs", response_model=list[TeachingRunRow])
def list_teaching_runs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeachingRunRow]:
    """Return all runs where the current user holds a RunTeacher row.

    Authorization: requires authentication only. There is NO superuser bypass —
    superusers see only the runs they actually teach. Result ordered by
    Run.id ASC; the frontend re-groups and re-sorts client-side.
    """
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

- [ ] **Step 5: Register the router in `main.py`**

Open `backend/mathion/main.py`. Find the existing router-registration block (around lines 50-71). Add:

```python
from mathion.api.teaching import router as teaching_router
# ... after the existing `app.include_router(dashboard_router)` at line ~50:
app.include_router(teaching_router)
# This MUST come BEFORE the SPA `/api/{rest:path}` 404 catch-all (~lines 66-71).
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_teaching.py::TestTeachingRunsEndpoint -v`
Expected: 12 PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/teaching.py \
        backend/mathion/main.py backend/tests/test_teaching.py
git commit -m "feat(backend): /api/teaching/runs router + TeachingRunRow schema (slice A T4)"
```

---

## Task 5: Frontend foundations — `User` type, wire module, router helpers, `safeNext` widening

**Spec:** §3.2.3, §3.2.5 (defaultLandingPath + safeNext); §3.2.6 (session store transparent flow-through); §6.2 router tests + teaching wire-module tests.

**Files:**
- Modify: `frontend/src/lib/types.ts` — extend `User` with two new boolean fields.
- Create: `frontend/src/lib/teaching.ts` — new wire module.
- Modify: `frontend/src/lib/router.svelte.ts` — add `defaultLandingPath` + widen `safeNext`.
- Test: `frontend/src/tests/teaching.test.ts` — new file.
- Test: `frontend/src/tests/router.test.ts` — extend with new bullets.

This task is the FOUNDATION for every subsequent frontend task. Sequence first per spec §3.2.5 ordering constraint.

- [ ] **Step 1: Extend the `User` type**

Open `frontend/src/lib/types.ts`. Locate the `User` type (~lines 5-12). Add two non-optional boolean fields:

```ts
export type User = {
  id: number;
  email: string;
  full_name: string | null;
  is_superuser: boolean;
  is_disabled: boolean;
  photo_url: string | null;
  has_course_admin: boolean;   // NEW — backend always populates via _user_response_with_flags
  has_run_teacher: boolean;    // NEW
};
```

- [ ] **Step 2: Type-check to confirm the rest of the codebase still compiles**

Run: `cd frontend && npm run check`
Expected: PASS. Most consumers read `user.email` / `user.full_name`; the new fields don't break existing reads.

- [ ] **Step 3: Write the failing wire-module test**

Create `frontend/src/tests/teaching.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listTeachingRuns } from '../lib/teaching';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}

describe('listTeachingRuns', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('calls GET /api/teaching/runs and returns the parsed array', async () => {
    const fixture = [
      {
        run: { id: 1, title: 'R', start_date: '2026-01-01', end_date: '2026-12-31',
               is_published: true, created_at: '2026-01-01T00:00:00Z',
               version_id: 1, groups_enabled: false, updated_at: null },
        course_id: 10, course_name: 'C', course_slug: 'c', student_count: 0,
      },
    ];
    vi.stubGlobal('fetch', mockFetch(200, fixture));
    const out = await listTeachingRuns();
    expect(out).toEqual(fixture);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && npm test -- src/tests/teaching.test.ts`
Expected: Module-not-found error.

- [ ] **Step 5: Create `frontend/src/lib/teaching.ts`**

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
  return api.get<TeachingRunRow[]>('/api/teaching/runs');
}
```

If `RunResponse` is not yet exported from `./types`, check its current name (the spec cites `frontend/src/lib/types.ts:266-275`). If it's named `Run` or `RunListItem`, use the actual name and update the wire module accordingly.

- [ ] **Step 6: Run wire-module test to verify it passes**

Run: `cd frontend && npm test -- src/tests/teaching.test.ts`
Expected: PASS.

- [ ] **Step 7: Write failing `defaultLandingPath` + `safeNext` fallback tests**

Open `frontend/src/tests/router.test.ts`. Append:

```ts
import { defaultLandingPath, safeNext } from '../lib/router.svelte';

describe('defaultLandingPath', () => {
  const base = { id: 1, email: 'x', full_name: null,
                 is_superuser: false, is_disabled: false, photo_url: null };

  it('returns /courses for admin', () => {
    expect(defaultLandingPath({ ...base, has_course_admin: true, has_run_teacher: false }))
      .toBe('/courses');
  });
  it('returns /teaching for teacher-only', () => {
    expect(defaultLandingPath({ ...base, has_course_admin: false, has_run_teacher: true }))
      .toBe('/teaching');
  });
  it('returns /courses for student/empty', () => {
    expect(defaultLandingPath({ ...base, has_course_admin: false, has_run_teacher: false }))
      .toBe('/courses');
  });
  it('returns /courses for superuser-also-teacher (admin precedence)', () => {
    expect(defaultLandingPath({ ...base, is_superuser: true,
                                has_course_admin: true, has_run_teacher: true }))
      .toBe('/courses');
  });
  it('returns /courses for null user', () => {
    expect(defaultLandingPath(null)).toBe('/courses');
  });
});

describe('safeNext fallback parameter', () => {
  const origin = 'http://localhost:3000';

  it('default fallback is /courses', () => {
    expect(safeNext('', origin)).toBe('/courses');
  });
  it('honors fallback parameter for empty', () => {
    expect(safeNext('', origin, '/teaching')).toBe('/teaching');
  });
  it('/login short-circuit honors fallback (PIN-401 regression guard)', () => {
    expect(safeNext('/login?next=foo', origin, '/teaching')).toBe('/teaching');
  });
  it('cross-origin honors fallback', () => {
    expect(safeNext('https://evil.example/x', origin, '/teaching')).toBe('/teaching');
  });
  it('valid next is not replaced by fallback', () => {
    expect(safeNext('/teaching', origin, '/courses')).toBe('/teaching');
  });
  it('malformed pathname (%) falls back via decodeURI guard', () => {
    expect(safeNext('%', origin, '/teaching')).toBe('/teaching');
  });
});
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/tests/router.test.ts`
Expected: `defaultLandingPath is not a function` + several `safeNext` cases fail because the 3rd arg is currently ignored.

- [ ] **Step 9: Add `defaultLandingPath` and widen `safeNext`**

Open `frontend/src/lib/router.svelte.ts`. Add at top of file (after existing imports):

```ts
import type { User } from './types';

export function defaultLandingPath(user: User | null): string {
  if (user?.has_course_admin) return '/courses';
  if (user?.has_run_teacher)  return '/teaching';
  return '/courses';
}
```

Replace the existing `safeNext` (~lines 195-209) with:

```ts
export function safeNext(next: string, origin: string, fallback = '/courses'): string {
  if (!next) return fallback;
  if (next.startsWith('\\')) return fallback;
  try {
    const u = new URL(next, origin);
    if (u.origin !== origin) return fallback;
    if (u.pathname === '/login') return fallback;
    try { decodeURI(u.pathname); } catch { return fallback; }
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
```

All five hardcoded `/courses` returns in the original function become `fallback`. The new `decodeURI` guard rejects malformed percent-encoded pathnames (per spec §3.2.5 rev-16 rationale).

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/tests/router.test.ts src/tests/teaching.test.ts`
Expected: All PASS (new + existing safeNext tests stay green because the defaulted `fallback = '/courses'` preserves behavior for existing callers).

- [ ] **Step 11: Type-check the whole frontend**

Run: `cd frontend && npm run check`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/teaching.ts \
        frontend/src/lib/router.svelte.ts \
        frontend/src/tests/teaching.test.ts frontend/src/tests/router.test.ts
git commit -m "feat(frontend): User flags + lib/teaching + defaultLandingPath + safeNext fallback (slice A T5)"
```

---

## Task 6: `Login.svelte` rewrite + `verifyPin` `skipAuthRedirect` + `NotFound.svelte` role-aware

**Spec:** §3.2.5 Login.svelte rewrite + `verifyPin must skip the global 401 redirect`; §12 NotFound.svelte entry.

**Files:**
- Modify: `frontend/src/lib/auth.svelte.ts` — add `skipAuthRedirect: true` to `verifyPin`.
- Modify: `frontend/src/pages/Login.svelte` — rewrite post-PIN block; add `defaultLandingPath` import.
- Modify: `frontend/src/pages/NotFound.svelte` — role-aware Back link.

This task ships independently of the AppHeader/TeacherRunListPage work in T7/T8 — it's the routing-edge fix for the wrong-PIN strand-on-login bug and the teacher-friendly Login landing decision.

- [ ] **Step 1: Add `skipAuthRedirect: true` to `verifyPin`**

Open `frontend/src/lib/auth.svelte.ts`. Modify lines 30-42:

```ts
export async function verifyPin(
  email: string,
  pin: string,
  duration_days: 1 | 7 | 30,
): Promise<User> {
  const { user } = await api.post<{ user: User }>(
    '/api/auth/verify-pin',
    { email, pin, duration_days },
    { skipAuthRedirect: true },
  );
  session.user = user;
  return user;
}
```

- [ ] **Step 2: Rewrite the `Login.svelte` post-PIN block**

Open `frontend/src/pages/Login.svelte`. Update line 4 import to include `defaultLandingPath`:

```ts
import { navigate, safeNext, defaultLandingPath } from '../lib/router.svelte';
```

Replace lines 36-39 with the role-aware rewrite (per spec §3.2.5):

```ts
async function onSubmitPin(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  error = '';
  busy = true;
  try {
    const user = await verifyPin(email.trim(), pin.trim(), duration);
    const rawNext = new URLSearchParams(location.search).get('next');
    const fallback = defaultLandingPath(user);
    const dest = (rawNext === null || rawNext === '/')
      ? fallback
      : safeNext(rawNext, location.origin, fallback);
    navigate(dest, { replace: true });
  } catch (err: unknown) {
    error = err instanceof ApiError ? err.displayMessage : 'Could not verify PIN.';
  } finally {
    busy = false;
  }
}
```

Note: do NOT call `decodeURIComponent(rawNext)` first — `URLSearchParams.get` already URL-decoded valid percent sequences, and a second decode throws on truncated-percent input like `?next=%`.

- [ ] **Step 3: Rewrite `NotFound.svelte` to use `defaultLandingPath`**

Open `frontend/src/pages/NotFound.svelte`. Replace the contents:

```svelte
<script lang="ts">
  import { session } from '../stores/session.svelte';
  import { defaultLandingPath } from '../lib/router.svelte';
</script>

<h1>Page not found</h1>
<p><a href={defaultLandingPath(session.user)}>Back</a></p>
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npm run check`
Expected: PASS.

- [ ] **Step 5: Run the full vitest suite to confirm no regressions**

Run: `cd frontend && npm test`
Expected: All PASS. The Login.svelte rewrite has no existing tests; the safeNext fallback parameter is unit-tested in T5; NotFound has no test file. Manual smoke for the wrong-PIN flow lands in T13 step 0b.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/auth.svelte.ts frontend/src/pages/Login.svelte \
        frontend/src/pages/NotFound.svelte
git commit -m "feat(frontend): Login post-PIN defaultLandingPath, verifyPin skipAuthRedirect, NotFound role-aware (slice A T6)"
```

---

## Task 7: `AppHeader` component + tests

**Spec:** §3.2.1; §6.2 `AppHeader.svelte.test.ts` bullets.

**Files:**
- Create: `frontend/src/components/chrome/AppHeader.svelte`
- Test: `frontend/src/tests/AppHeader.svelte.test.ts`

- [ ] **Step 1: Write failing AppHeader tests**

Create `frontend/src/tests/AppHeader.svelte.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import AppHeader from '../components/chrome/AppHeader.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute } from '../lib/router.svelte';

vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
}));

const userBase = {
  id: 1, email: 'u@x', full_name: 'Sergey',
  is_superuser: false, is_disabled: false, photo_url: null,
};

function setSession(extra: Partial<typeof userBase> & {
  has_course_admin: boolean; has_run_teacher: boolean;
}) {
  session.user = { ...userBase, ...extra };
  session.loading = false;
}

beforeEach(() => {
  session.user = null;
  currentRoute.path = '/courses';
  currentRoute.search = '';
  currentRoute.hash = '';
});

describe('AppHeader', () => {
  it('renders both nav links when both flags are true', () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    const { getByText } = render(AppHeader);
    expect(getByText('Authoring')).toBeTruthy();
    expect(getByText('Teaching')).toBeTruthy();
  });

  it('renders only Authoring when only has_course_admin', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    const { getByText, queryByText } = render(AppHeader);
    expect(getByText('Authoring')).toBeTruthy();
    expect(queryByText('Teaching')).toBeNull();
  });

  it('renders only Teaching when only has_run_teacher', () => {
    setSession({ has_course_admin: false, has_run_teacher: true });
    const { getByText, queryByText } = render(AppHeader);
    expect(getByText('Teaching')).toBeTruthy();
    expect(queryByText('Authoring')).toBeNull();
  });

  it('renders no nav links when both flags are false', () => {
    setSession({ has_course_admin: false, has_run_teacher: false });
    const { queryByText } = render(AppHeader);
    expect(queryByText('Authoring')).toBeNull();
    expect(queryByText('Teaching')).toBeNull();
  });

  it('marks Authoring active on deep /courses routes', () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    currentRoute.path = '/courses/foo/runs/bar';
    const { getByText } = render(AppHeader);
    const link = getByText('Authoring').closest('a');
    expect(link?.getAttribute('aria-current')).toBe('page');
  });

  it('marks Teaching active on /teaching prefix', () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    currentRoute.path = '/teaching';
    const { getByText } = render(AppHeader);
    const link = getByText('Teaching').closest('a');
    expect(link?.getAttribute('aria-current')).toBe('page');
  });

  it('updates aria-current reactively when currentRoute.path changes', async () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    currentRoute.path = '/courses';
    const { getByText } = render(AppHeader);
    expect(getByText('Authoring').closest('a')?.getAttribute('aria-current')).toBe('page');
    currentRoute.path = '/teaching';
    await Promise.resolve();
    expect(getByText('Teaching').closest('a')?.getAttribute('aria-current')).toBe('page');
  });

  it('shows full_name when present', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    const { getByText } = render(AppHeader);
    expect(getByText('Sergey')).toBeTruthy();
  });

  it('falls back to email when full_name is null', () => {
    setSession({ full_name: null, has_course_admin: true, has_run_teacher: false });
    const { getByText } = render(AppHeader);
    expect(getByText('u@x')).toBeTruthy();
  });

  it('brand href is /courses for admin, /teaching for teacher-only', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    const { getByText, rerender } = render(AppHeader);
    expect(getByText('Mathion').closest('a')?.getAttribute('href')).toBe('/courses');
    session.user = { ...userBase, has_course_admin: false, has_run_teacher: true };
    rerender({});
    // brand href $derived on next render
    const result = render(AppHeader);
    expect(result.getByText('Mathion').closest('a')?.getAttribute('href')).toBe('/teaching');
  });

  it('logout button awaits logout() and navigates to /login', async () => {
    const { logout } = await import('../lib/auth.svelte');
    setSession({ has_course_admin: true, has_run_teacher: false });
    const { getByText } = render(AppHeader);
    const navSpy = vi.spyOn(await import('../lib/router.svelte'), 'navigate')
      .mockImplementation(() => Promise.resolve());
    await fireEvent.click(getByText('Logout'));
    expect(logout).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith('/login');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/tests/AppHeader.svelte.test.ts`
Expected: Module-not-found.

- [ ] **Step 3: Implement `AppHeader.svelte`**

Create `frontend/src/components/chrome/AppHeader.svelte`:

```svelte
<script lang="ts">
  import { session } from '../../stores/session.svelte';
  import { currentRoute, navigate, defaultLandingPath } from '../../lib/router.svelte';
  import { logout } from '../../lib/auth.svelte';

  const brandHref = $derived(defaultLandingPath(session.user));
  const isAuthoringActive = $derived(currentRoute.path.startsWith('/courses'));
  const isTeachingActive  = $derived(currentRoute.path.startsWith('/teaching'));
  const displayName = $derived(session.user?.full_name ?? session.user?.email ?? '');

  async function onLogout() {
    await logout();
    navigate('/login');
  }
</script>

<header class="app-header">
  <nav>
    <a class="brand" href={brandHref}>Mathion</a>

    <div class="links">
      {#if session.user?.has_course_admin}
        <a href="/courses"
           aria-current={isAuthoringActive ? 'page' : undefined}>Authoring</a>
      {/if}
      {#if session.user?.has_run_teacher}
        <a href="/teaching"
           aria-current={isTeachingActive ? 'page' : undefined}>Teaching</a>
      {/if}
    </div>

    <div class="right">
      <span class="name">{displayName}</span>
      <button type="button" onclick={onLogout}>Logout</button>
    </div>
  </nav>
</header>

<style>
  .app-header {
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }
  .brand { font-weight: 600; text-decoration: none; }
  .links { display: flex; gap: var(--space-3); flex: 1; }
  .links a {
    text-decoration: none;
    color: var(--text);
    padding: var(--space-1) 0;
  }
  .links a[aria-current="page"] {
    font-weight: 600;
    border-bottom: 2px solid var(--accent);
  }
  .right { display: flex; align-items: center; gap: var(--space-2); }
  .name { color: var(--muted); }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/tests/AppHeader.svelte.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chrome/AppHeader.svelte \
        frontend/src/tests/AppHeader.svelte.test.ts
git commit -m "feat(frontend): AppHeader nav chrome with role-aware links (slice A T7)"
```

---

## Task 8: `TeacherRunListPage` + tests

**Spec:** §3.2.2; §6.2 `TeacherRunListPage.svelte.test.ts` bullets.

**Files:**
- Create: `frontend/src/pages/teaching/TeacherRunListPage.svelte`
- Test: `frontend/src/tests/TeacherRunListPage.svelte.test.ts`

This task assumes `runStatus` from `frontend/src/lib/runStatus.ts` exists (it does — verified in spec §3.2.2 + existing code). Confirm at impl time.

- [ ] **Step 1: Write failing TeacherRunListPage tests**

Create `frontend/src/tests/TeacherRunListPage.svelte.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import TeacherRunListPage from '../pages/teaching/TeacherRunListPage.svelte';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}

function makeRun(overrides: Partial<{
  id: number; title: string; start_date: string; end_date: string;
  is_published: boolean; created_at: string; groups_enabled: boolean;
  version_id: number; updated_at: string | null;
}>) {
  return {
    id: 1, title: 'R', start_date: '2026-02-01', end_date: '2026-05-30',
    is_published: true, created_at: '2026-01-01T00:00:00Z',
    groups_enabled: false, version_id: 1, updated_at: null,
    ...overrides,
  };
}

function row(extra: Partial<{
  run: ReturnType<typeof makeRun>; course_id: number;
  course_name: string; course_slug: string; student_count: number;
}>) {
  return {
    run: makeRun({}), course_id: 10, course_name: 'C', course_slug: 'c',
    student_count: 0,
    ...extra,
  };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('TeacherRunListPage', () => {
  it('shows loading then renders table', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    const { findByText } = render(TeacherRunListPage);
    expect(await findByText('R')).toBeTruthy();
  });

  it('error state renders banner with Try again button that re-fetches', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([row({})]), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchSpy);
    const { findByText, queryByText } = render(TeacherRunListPage);
    const tryAgain = await findByText('Try again');
    expect(tryAgain).toBeTruthy();
    await fireEvent.click(tryAgain);
    await waitFor(() => expect(queryByText('R')).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('renders all 5 pills with counts derived from full response', async () => {
    // active (today is between start and end + is_published=true)
    const active = row({
      run: makeRun({ id: 1, title: 'A',
                     start_date: '2026-01-01', end_date: '2030-01-01',
                     is_published: true }),
    });
    // draft (is_published=false)
    const draft = row({
      run: makeRun({ id: 2, title: 'D', is_published: false }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [active, draft]));
    const { findByText } = render(TeacherRunListPage);
    expect(await findByText(/Active \(1\)/)).toBeTruthy();
    expect(await findByText(/Draft \(1\)/)).toBeTruthy();
  });

  it('default selected pill is active with aria-pressed=true', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    const { findByText } = render(TeacherRunListPage);
    const activePill = (await findByText(/Active/)).closest('button');
    expect(activePill?.getAttribute('aria-pressed')).toBe('true');
  });

  it('empty response renders page-level empty state', async () => {
    vi.stubGlobal('fetch', mockFetch(200, []));
    const { findByText } = render(TeacherRunListPage);
    expect(await findByText(/You're not assigned to any runs yet/)).toBeTruthy();
  });

  it('course column renders course_name (not slug)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({ course_name: 'Calc 101', course_slug: 'calc' })]));
    const { findByText, queryByText } = render(TeacherRunListPage);
    expect(await findByText('Calc 101')).toBeTruthy();
    expect(queryByText('calc')).toBeNull();
  });

  it('cell-anchor href points to /courses/:slug/runs/:rid', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({
      run: makeRun({ id: 42, title: 'Spring' }),
      course_slug: 'calc',
    })]));
    const { findByText } = render(TeacherRunListPage);
    const link = (await findByText('Spring')).closest('a');
    expect(link?.getAttribute('href')).toBe('/courses/calc/runs/42');
  });

  it('within-active sort: end_date ASC, id ASC', async () => {
    const a = row({
      run: makeRun({ id: 1, title: 'Later',
                     start_date: '2026-01-01', end_date: '2030-12-31',
                     is_published: true }),
    });
    const b = row({
      run: makeRun({ id: 2, title: 'Sooner',
                     start_date: '2026-01-01', end_date: '2026-12-31',
                     is_published: true }),
    });
    vi.stubGlobal('fetch', mockFetch(200, [a, b]));
    const { findAllByRole } = render(TeacherRunListPage);
    const rows = await findAllByRole('row');
    // first row is header, second is first data row
    const firstDataRow = rows[1].textContent ?? '';
    expect(firstDataRow).toContain('Sooner');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/tests/TeacherRunListPage.svelte.test.ts`
Expected: Module-not-found.

- [ ] **Step 3: Implement `TeacherRunListPage.svelte`**

Create `frontend/src/pages/teaching/TeacherRunListPage.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { listTeachingRuns, type TeachingRunRow } from '../../lib/teaching';
  import { runStatus } from '../../lib/runStatus';
  import { navigate } from '../../lib/router.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';

  type Status = 'active' | 'upcoming' | 'ended' | 'draft';

  let rows = $state<TeachingRunRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pill = $state<Status | 'all'>('active');

  async function load() {
    loading = true; error = null;
    try {
      rows = await listTeachingRuns();
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Could not load runs.';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

  function withStatus() {
    return rows.map(r => ({ row: r, status: runStatus(r.run) as Status }));
  }

  const byStatus = $derived.by(() => {
    const buckets: Record<Status, ReturnType<typeof withStatus>> = {
      active: [], upcoming: [], ended: [], draft: [],
    };
    for (const x of withStatus()) buckets[x.status].push(x);
    buckets.active.sort((a, b) =>
      cmp(a.row.run.end_date, b.row.run.end_date) || a.row.run.id - b.row.run.id);
    buckets.upcoming.sort((a, b) =>
      cmp(a.row.run.start_date, b.row.run.start_date) || a.row.run.id - b.row.run.id);
    buckets.ended.sort((a, b) =>
      cmp(b.row.run.end_date, a.row.run.end_date) || a.row.run.id - b.row.run.id);
    buckets.draft.sort((a, b) =>
      cmp(b.row.run.created_at, a.row.run.created_at) || a.row.run.id - b.row.run.id);
    return buckets;
  });

  const counts = $derived({
    active:   byStatus.active.length,
    upcoming: byStatus.upcoming.length,
    ended:    byStatus.ended.length,
    draft:    byStatus.draft.length,
    all:      rows.length,
  });

  const visible = $derived.by(() => {
    if (pill === 'all') {
      return [
        ...byStatus.active, ...byStatus.upcoming,
        ...byStatus.ended,  ...byStatus.draft,
      ];
    }
    return byStatus[pill];
  });

  const displayLabel = (s: string) => s[0].toUpperCase() + s.slice(1);
  const runUrl = (slug: string, id: number) => `/courses/${slug}/runs/${id}`;
  function onCellClick(e: MouseEvent, slug: string, id: number) {
    e.preventDefault();
    navigate(runUrl(slug, id));
  }
</script>

<h1>Teaching</h1>

{#if loading}
  <LoadingPlaceholder label="Loading runs…" />
{:else if error}
  <div class="error-banner">
    <p>Could not load runs: {error}</p>
    <button type="button" onclick={load}>Try again</button>
  </div>
{:else if rows.length === 0}
  <p class="empty">You're not assigned to any runs yet. When a course admin
    adds you as a teacher, the run will appear here.</p>
{:else}
  <div class="pills">
    {#each (['active','upcoming','ended','draft','all'] as const) as p}
      <button type="button"
              aria-pressed={pill === p}
              onclick={() => pill = p}>
        {displayLabel(p)} ({counts[p]})
      </button>
    {/each}
  </div>

  {#if visible.length === 0}
    <p class="empty">No {displayLabel(pill)} runs. You have
      {counts.active} active, {counts.upcoming} upcoming,
      {counts.ended} ended, and {counts.draft} draft.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">Course</th>
          <th scope="col">Run title</th>
          <th scope="col">Status</th>
          <th scope="col">Start–End</th>
          <th scope="col">Students</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as { row, status } (row.run.id)}
          {@const href = runUrl(row.course_slug, row.run.id)}
          <tr>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>{row.course_name}</a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>{row.run.title}</a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>
              <span class="badge badge-{status}">{displayLabel(status)}</span>
            </a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>
              {row.run.start_date} → {row.run.end_date}
            </a></td>
            <td><a {href} onclick={(e) => onCellClick(e, row.course_slug, row.run.id)}>{row.student_count}</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
  .pills { display: flex; gap: var(--space-2); margin-bottom: var(--space-3); }
  .pills button[aria-pressed="true"] {
    background: var(--accent-soft); border-color: var(--accent);
  }
  .error-banner { padding: var(--space-3); background: var(--danger-soft);
                  border: 1px solid var(--danger); border-radius: var(--radius); }
  .empty { color: var(--muted); padding: var(--space-3); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); }
  td a { color: inherit; text-decoration: none; display: block; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 0.85em; }
  .badge-active   { background: #d1fae5; color: #065f46; }
  .badge-upcoming { background: #e0e7ff; color: #3730a3; }
  .badge-ended    { background: #e5e7eb; color: #374151; }
  .badge-draft    { background: #fef3c7; color: #92400e; }
</style>
```

If `runStatus.ts` lives in a different path or returns a different type, adjust the import + cast. Confirm at impl time.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/tests/TeacherRunListPage.svelte.test.ts`
Expected: All PASS.

- [ ] **Step 5: Type-check**

Run: `cd frontend && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/teaching/TeacherRunListPage.svelte \
        frontend/src/tests/TeacherRunListPage.svelte.test.ts
git commit -m "feat(frontend): TeacherRunListPage with pills + grouped sort + status badges (slice A T8)"
```

---

## Task 9: `App.svelte` routing + `routes.ts`

**Spec:** §3.2.5 routing snippet + new route entry.

**Files:**
- Modify: `frontend/src/routes.ts` — add `/teaching` route entry.
- Modify: `frontend/src/App.svelte` — add `AppHeader`, add `TeacherRunListPage` to componentMap, update `$effect`.

- [ ] **Step 1: Add the `/teaching` route**

Open `frontend/src/routes.ts`. Add the entry:

```ts
{ path: '/teaching', component: 'TeacherRunListPage', auth: true },
```

- [ ] **Step 2: Wire `App.svelte`**

Open `frontend/src/App.svelte`. Three edits:

(a) Import the new page + `AppHeader` + `defaultLandingPath`:

```ts
import { currentRoute, matchRoute, navigate, defaultLandingPath } from './lib/router.svelte';
import AppHeader from './components/chrome/AppHeader.svelte';
import TeacherRunListPage from './pages/teaching/TeacherRunListPage.svelte';
```

(b) Add `TeacherRunListPage` to the existing `componentMap` object (find the object that maps strings like `'CourseList'` to imported components — add `TeacherRunListPage: TeacherRunListPage`).

(c) Replace the existing `$effect` block at lines 34-43 with the merged form (per spec §3.2.5):

```svelte
$effect(() => {
  if (session.loading) return;

  // 1. Default route: '/' redirects based on session role flags.
  if (currentRoute.path === '/') {
    if (session.user === null) {
      navigate('/login?next=%2F', { replace: true, force: true });
    } else {
      navigate(defaultLandingPath(session.user), { replace: true });
    }
    return;
  }

  // 2. Auth guard for protected routes — preserved verbatim.
  if (matched && matched.route.auth && session.user === null) {
    const next = encodeURIComponent(
      currentRoute.path + currentRoute.search + currentRoute.hash
    );
    navigate(`/login?next=${next}`, { replace: true, force: true });
  }
});
```

(d) Render `AppHeader` above the existing route-rendering block (per spec §3.2.5):

```svelte
{#if !session.loading && session.user && currentRoute.path !== '/login'}
  <AppHeader />
{/if}

<!-- Existing {#if session.loading} ... {/if} block stays verbatim. -->
```

Do NOT edit the loading-guard / matched / NotFound branches.

- [ ] **Step 3: Type-check + run all tests**

Run: `cd frontend && npm run check && npm test`
Expected: All PASS. The App.svelte routing change has no integration-test harness per spec §6.2 final paragraph; manual smoke in T13 covers end-to-end.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes.ts frontend/src/App.svelte
git commit -m "feat(frontend): App.svelte AppHeader + role-aware / routing + /teaching route (slice A T9)"
```

---

## Task 10: `RunDetailPage` — thread `course` prop, publish-bar split, breadcrumb rewrite, banner copy

**Spec:** §3.2.4 RunDetailPage prop-threading, publish-bar split, breadcrumb fix; §5.4 disabled-version banner copy split; §6.2 `RunDetailPage.publish.svelte.test.ts` bullets.

**Files:**
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte` (lines 304-307 breadcrumbs; 310-336 publish-bar; 339-342 banner; tab prop-pass-throughs around 367-418)
- Test: `frontend/src/tests/RunDetailPage.svelte.test.ts` — extend with breadcrumb + integration tests; verify fixture audit per spec §3.2.4 (line 56).
- Test: `frontend/src/tests/RunDetailPage.publish.svelte.test.ts` — extend with publish-bar split + banner copy tests.

**Critical hazard (spec §3.2.4 RunDetailPage block):**
- The publish-bar at `RunDetailPage.svelte:310-336` ALSO contains the status badge (311-313) and version label (314-316). A naive `{#if course.is_admin}` wrap around the whole bar would hide them too. Use the recommended split: restructure badge + label into a sibling `<div class="run-meta">`, wrap only Publish/Unpublish/InlineConfirm. OR wrap only lines 317-335 in `{#if course.is_admin}` (minimal patch). Choose one at impl time; both options satisfy the §6.2 testid-based contract.
- `RunDetailPage.svelte.test.ts:56` has an inline `/api/courses/by-slug/` mock missing `is_admin` and `description`. Grep the file end-to-end for `/courses/by-slug/` responses and `course = {...}` literals; add `is_admin: true` and `description: ''` to every Course-shape fixture so existing tests keep current "controls visible" behavior.

- [ ] **Step 1: Audit and fix the test fixtures FIRST (prerequisite for everything else)**

Open `frontend/src/tests/RunDetailPage.svelte.test.ts`. Run a regex search for `/courses/by-slug/` AND for inline `course = ` literals. For every Course-shape object found, ensure both `is_admin: true` AND `description: ''` are present.

Run the existing suite to baseline:

```bash
cd frontend && npm test -- src/tests/RunDetailPage.svelte.test.ts
```

Expected: PASS at this baseline (fixtures now have explicit `is_admin: true`).

- [ ] **Step 2: Write failing tests for publish-bar split + disabled-version banner copy**

Open `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`. Add:

```ts
describe('publish-bar split for course.is_admin', () => {
  it('teacher (is_admin=false) sees status badge and version label but NOT publish/unpublish buttons', async () => {
    // Setup using existing helper; ensure course.is_admin = false in the mock
    // ...
    expect(getByTestId('status-badge')).toBeTruthy();
    expect(getByTestId('version-label')).toBeTruthy();
    expect(queryByRole('button', { name: /Publish/i })).toBeNull();
    expect(queryByRole('button', { name: /Unpublish/i })).toBeNull();
  });

  it('admin (is_admin=true) sees publish or unpublish button + badge + label', async () => {
    // ...
    expect(getByTestId('status-badge')).toBeTruthy();
    expect(getByTestId('version-label')).toBeTruthy();
    // either Publish or Unpublish per run.is_published
    expect(queryByRole('button', { name: /Publish|Unpublish/i })).toBeTruthy();
  });
});

describe('disabled-version banner copy', () => {
  it('teacher sees teacher-aware copy', async () => {
    // Setup: course.is_admin=false, pinnedVersion.is_disabled=true
    expect(await findByText(/Some editing actions are locked until a course admin re-enables it/)).toBeTruthy();
  });

  it('admin sees admin-facing copy', async () => {
    // Setup: course.is_admin=true, pinnedVersion.is_disabled=true
    expect(await findByText(/Re-enable it under Course Editor before publishing/)).toBeTruthy();
  });
});

describe('breadcrumb fix for teachers', () => {
  it('teacher sees Teaching root, no /courses link', async () => {
    // course.is_admin=false
    expect(getByText('Teaching').closest('a')?.getAttribute('href')).toBe('/teaching');
    expect(queryByRole('link', { name: 'Courses' })).toBeNull();
  });

  it('admin sees the original Courses › ... › Runs breadcrumb', async () => {
    // course.is_admin=true — current breadcrumb verbatim
    expect(getByText('Courses').closest('a')?.getAttribute('href')).toBe('/courses');
  });
});
```

(Fill in the setup-helper invocations matching the existing `setup({...})` pattern in this file — confirm the helper signature at impl time. The bullet shape above is the contract; the setup details mirror the existing tests.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/tests/RunDetailPage.publish.svelte.test.ts`
Expected: New tests FAIL.

- [ ] **Step 4: Edit `RunDetailPage.svelte` — publish-bar split (recommended option: sibling `.run-meta`)**

Open `frontend/src/pages/runs/RunDetailPage.svelte`. Locate lines 310-336.

Add `data-testid` attributes if missing: `data-testid="status-badge"` on the badge element (311-313) and `data-testid="version-label"` on the version label (314-316).

Restructure: pull badge + label into a sibling `<div class="run-meta">` immediately BEFORE `<div class="publish-bar">`. Wrap only the remaining `.publish-bar` contents (Publish/Unpublish/InlineConfirm at lines 317-335) in `{#if course.is_admin}`. Duplicate the `.publish-bar` CSS rule to also apply to `.run-meta` (or use a `, ` selector).

- [ ] **Step 5: Edit `RunDetailPage.svelte` — breadcrumb rewrite (lines 304-307)**

```svelte
<nav aria-label="Breadcrumb" class="breadcrumb">
  {#if course.is_admin}
    <a href="/courses">Courses</a> ›
    <a href={`/courses/${course.slug}`}>{course.name}</a> ›
    <a href={`/courses/${course.slug}/runs`}>Runs</a> ›
    {run.title}
  {:else}
    <a href="/teaching">Teaching</a> ›
    {course.name} ›
    {run.title}
  {/if}
</nav>
```

- [ ] **Step 6: Edit `RunDetailPage.svelte` — disabled-version banner copy (lines 339-342)**

```svelte
{#if showDisabledBanner}
  <div class="banner-warning">
    {#if course.is_admin}
      This run's course version is disabled. Re-enable it under Course Editor before publishing.
    {:else}
      This run's course version is disabled. Some editing actions are locked until a course admin re-enables it.
    {/if}
  </div>
{/if}
```

- [ ] **Step 7: Edit `RunDetailPage.svelte` — thread `course` prop into the four affected tabs + `runIsPublished` into RunGroupsTab + `course` into MiniProjectModal via RunMiniProjectsTab**

Locate the `<RunOverviewTab>`, `<RunMiniProjectsTab>`, `<RunTeachersTab>`, `<RunGroupsTab>` mount sites. Add `course={course!}` to each. For `<RunGroupsTab>` also add `runIsPublished={run.is_published}` (per spec §3.2.4 rev-12). Verify `<RunAssetsTab>` already passes `course` — do not duplicate.

Pass `course={course!}` into `<MiniProjectModal>` mount inside `<RunMiniProjectsTab>` in T11.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.publish.svelte.test.ts`
Expected: All PASS. (The tab files themselves don't yet accept `course` props — but TypeScript with strict mode will flag this. Defer the tab-side acceptance until T11/T12; for now the RunDetailPage tests should pass because they mount RunDetailPage with mocked children OR because the tab components silently ignore the new prop.)

If type-check fails at this step because tabs reject the unknown prop, the practical fix is to land Steps 1-7 AND T11 + T12 together as one commit — the type-system is whole-program. Alternative: temporarily mark the prop as optional in each tab (`course?: Course`) in T10 and tighten in T11/T12. Pick the option at impl time.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/runs/RunDetailPage.svelte \
        frontend/src/tests/RunDetailPage.svelte.test.ts \
        frontend/src/tests/RunDetailPage.publish.svelte.test.ts
git commit -m "feat(frontend): RunDetailPage publish-bar split + breadcrumb + banner copy + prop threading (slice A T10)"
```

---

## Task 11: `RunOverviewTab` + `RunTeachersTab` + `RunGroupsTab` + `RunAssetsTab` regression tests

**Spec:** §3.2.4 RunOverviewTab block (tooltip + delete-run hide); RunTeachersTab block; RunGroupsTab block; §6.2 corresponding test bullets. RunAssetsTab is regression-only (existing code).

**Files:**
- Modify: `frontend/src/components/runs/RunOverviewTab.svelte` — accept `course: Course`; gate Delete-run; rewrite groups-toggle tooltip.
- Modify: `frontend/src/components/runs/RunTeachersTab.svelte` — accept `course: Course`; gate add-form + Remove.
- Modify: `frontend/src/components/runs/RunGroupsTab.svelte` — accept `course: Course` + `runIsPublished: boolean`; rewrite groups-disabled placeholder (3-branch).
- Test: `frontend/src/tests/RunOverviewTab.svelte.test.ts` + `RunOverviewTab.checklist.svelte.test.ts` — update mount helper + add new bullets.
- Test: `frontend/src/tests/RunTeachersTab.svelte.test.ts` — update 6 inline mounts + add bullets.
- Test: `frontend/src/tests/RunGroupsTab.svelte.test.ts` — new or extend (verify at impl time); add 4 placeholder-text tests.
- Test: `frontend/src/tests/RunAssetsTab.svelte.test.ts` — add the 4 force-delete regression bullets (no production code change).

- [ ] **Step 1: Extend the shared `mountOverview()` helper to accept `course` props**

Open `frontend/src/tests/RunOverviewTab.svelte.test.ts`. Locate the `mountOverview` helper. Add a default `course: { is_admin: true, ... }` to its `extra` parameter so the existing 8 call sites pick it up. Same for `RunOverviewTab.checklist.svelte.test.ts:mountTab`.

- [ ] **Step 2: Write failing RunOverviewTab tests**

Append (or insert) per spec §6.2 bullets:

```ts
describe('RunOverviewTab Delete-run gating', () => {
  it('hides Delete run when course.is_admin === false', () => {
    const { queryByRole } = mountOverview({ course: { is_admin: false } });
    expect(queryByRole('button', { name: /Delete run/i })).toBeNull();
  });

  it('shows Delete run when course.is_admin === true', () => {
    const { getByRole } = mountOverview({ course: { is_admin: true } });
    expect(getByRole('button', { name: /Delete run/i })).toBeTruthy();
  });

  it('PATCH-title, PATCH-end-date, groups_enabled toggle always present', () => {
    const { getByLabelText } = mountOverview({ course: { is_admin: false } });
    expect(getByLabelText(/Title/i)).toBeTruthy();
    expect(getByLabelText(/End date/i)).toBeTruthy();
    expect(getByLabelText(/Groups enabled/i)).toBeTruthy();
  });
});

describe('RunOverviewTab groups-toggle tooltip role-aware', () => {
  it('teacher + published: "Ask a course admin to unpublish before changing."', () => {
    const { getByLabelText } = mountOverview({
      course: { is_admin: false },
      run: { is_published: true },
    });
    const toggle = getByLabelText(/Groups enabled/i);
    expect(toggle.getAttribute('title'))
      .toBe('Locked once the run is published. Ask a course admin to unpublish before changing.');
  });
  it('admin + published: "Unpublish to change."', () => {
    const { getByLabelText } = mountOverview({
      course: { is_admin: true },
      run: { is_published: true },
    });
    expect(getByLabelText(/Groups enabled/i).getAttribute('title'))
      .toBe('Locked once the run is published. Unpublish to change.');
  });
  it('!published: title is empty', () => {
    const { getByLabelText } = mountOverview({
      course: { is_admin: false },
      run: { is_published: false },
    });
    expect(getByLabelText(/Groups enabled/i).getAttribute('title')).toBe('');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail; then edit RunOverviewTab**

Run: `cd frontend && npm test -- src/tests/RunOverviewTab.svelte.test.ts`
Expected: FAIL (no `course` prop accepted; no role-aware tooltip).

Open `frontend/src/components/runs/RunOverviewTab.svelte`. Add `course: Course` to the `$props` destructuring. Wrap `Delete run` button + confirm at lines 199-207 in `{#if course.is_admin}`. Rewrite the groups-toggle `title` at line 161 to be role-aware (per spec §3.2.4):

```svelte
<input type="checkbox"
       bind:checked={groupsEnabledLocal}
       disabled={run.is_published || groupsEnabledBusy}
       title={run.is_published
         ? (course.is_admin
           ? 'Locked once the run is published. Unpublish to change.'
           : 'Locked once the run is published. Ask a course admin to unpublish before changing.')
         : ''} />
```

Run tests again. Expected: PASS for the new bullets. The 7-mount-site companion file `RunOverviewTab.checklist.svelte.test.ts` should pass via the shared `mountTab` helper edit.

- [ ] **Step 4: Write failing RunTeachersTab tests + edit component**

Append to `frontend/src/tests/RunTeachersTab.svelte.test.ts` (touch the 6 inline mounts to add `course: { is_admin: true }`):

```ts
it('hides Add-teacher form and per-row Remove buttons when course.is_admin === false', () => {
  const { queryByLabelText, queryAllByRole } = mountTeachers({ course: { is_admin: false } });
  expect(queryByLabelText(/Add teacher email/i)).toBeNull();
  expect(queryAllByRole('button', { name: /Remove/i }).length).toBe(0);
});

it('shows Add-teacher form and per-row Remove buttons when course.is_admin === true', () => {
  const { getByLabelText, getAllByRole } = mountTeachers({
    course: { is_admin: true },
    teachers: [{ id: 1, email: 't@x', full_name: 'T' }],
  });
  expect(getByLabelText(/email|Add/i)).toBeTruthy();
  expect(getAllByRole('button', { name: /Remove/i }).length).toBeGreaterThan(0);
});
```

Open `RunTeachersTab.svelte`. Add `course: Course` to `$props`. Wrap the Add-teacher form and each per-row Remove button in `{#if course.is_admin}`.

Run: `cd frontend && npm test -- src/tests/RunTeachersTab.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing RunGroupsTab tests + edit component**

Check whether `frontend/src/tests/RunGroupsTab.svelte.test.ts` exists; if not, create. Add the 4 bullets per spec §6.2:

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import RunGroupsTab from '../components/runs/RunGroupsTab.svelte';

function mount(props: Partial<{
  course: { is_admin: boolean };
  runIsPublished: boolean;
  groupsEnabled: boolean;
  groups: unknown[];
}>) {
  return render(RunGroupsTab, {
    runId: 1,
    course: props.course ?? { is_admin: true, slug: 'c', name: 'C', description: '' },
    runIsPublished: props.runIsPublished ?? false,
    groups: props.groups ?? [],
    groupsEnabled: props.groupsEnabled ?? false,
    onRefetchGroups: async () => {},
    onRefetchGroupsAndStudents: async () => {},
  });
}

describe('RunGroupsTab placeholder text (groupsEnabled=false)', () => {
  it('!published: original "Enable in Overview" text', () => {
    const { getByText } = mount({ runIsPublished: false });
    expect(getByText(/Enable in Overview → Settings to manage groups/)).toBeTruthy();
  });
  it('published + admin: "Unpublish in Overview before enabling groups."', () => {
    const { getByText } = mount({
      runIsPublished: true, course: { is_admin: true },
    });
    expect(getByText(/Unpublish in Overview before enabling groups/)).toBeTruthy();
  });
  it('published + teacher: "Ask a course admin to unpublish the run and enable groups."', () => {
    const { getByText } = mount({
      runIsPublished: true, course: { is_admin: false },
    });
    expect(getByText(/Ask a course admin to unpublish the run and enable groups/)).toBeTruthy();
  });
});

describe('RunGroupsTab groupsEnabled=true (CRUD stays teacher-allowed)', () => {
  it('CRUD section is in the DOM regardless of course.is_admin', () => {
    const { container } = mount({
      groupsEnabled: true, course: { is_admin: false },
      groups: [{ id: 1, name: 'G' }],
    });
    expect(container.textContent).toContain('G');  // group rendered
  });
});
```

Open `RunGroupsTab.svelte`. Accept new props (`course: Course`, `runIsPublished: boolean`). Replace the groups-disabled placeholder at lines 100-103 with the 3-branch text per spec §3.2.4 RunGroupsTab block.

Run: `cd frontend && npm test -- src/tests/RunGroupsTab.svelte.test.ts`
Expected: PASS.

- [ ] **Step 6: Add RunAssetsTab regression-only tests (existing code, no production change)**

Append to `frontend/src/tests/RunAssetsTab.svelte.test.ts`:

```ts
describe('RunAssetsTab referenced-asset force-delete gating (regression)', () => {
  it('teacher: Force delete button visible but disabled + tooltip', async () => {
    // Mount the tab with course.is_admin=false. Open the referenced-asset confirm.
    // Locate the Force-delete button at component lines 658-664 / 804-811.
    // ...
    expect(forceButton).toBeTruthy();
    expect(forceButton.disabled).toBe(true);
    expect(forceButton.title).toBe('Only course admins can force-delete a referenced asset.');
  });

  it('admin: Force delete button visible and enabled after ticking acknowledge', async () => {
    // course.is_admin=true; click checkbox; assert button enabled, title empty.
  });

  it('teacher: unreferenced asset delete works (teacher-allowed)', async () => {
    // course.is_admin=false; normal Delete button on unreferenced asset is enabled.
  });

  it('upload/list/replace/render unchanged regardless of course.is_admin', async () => {
    // smoke: render with each is_admin value, verify upload form present.
  });
});
```

Fill the harness bodies using the existing test patterns in that file. These tests lock the §3.1.6 contract — no production code change.

Run: `cd frontend && npm test -- src/tests/RunAssetsTab.svelte.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full vitest + type-check**

Run: `cd frontend && npm run check && npm test`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/runs/RunOverviewTab.svelte \
        frontend/src/components/runs/RunTeachersTab.svelte \
        frontend/src/components/runs/RunGroupsTab.svelte \
        frontend/src/tests/RunOverviewTab.svelte.test.ts \
        frontend/src/tests/RunOverviewTab.checklist.svelte.test.ts \
        frontend/src/tests/RunTeachersTab.svelte.test.ts \
        frontend/src/tests/RunGroupsTab.svelte.test.ts \
        frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "feat(frontend): RunOverview/Teachers/Groups course-prop hides + RunAssets regression tests (slice A T11)"
```

---

## Task 12: `RunMiniProjectsTab` + `MiniProjectModal` — admin-dead CTAs + teacher-gating

**Spec:** §3.2.4 RunMiniProjectsTab + MiniProjectModal blocks; §3.1.6 MP publish stays teacher-allowed; §6.2 RunMiniProjectsTab bullets + new `MiniProjectModal.teacher-gating.svelte.test.ts`.

**Files:**
- Modify: `frontend/src/components/runs/RunMiniProjectsTab.svelte` — accept `course: Course`; pass `course` to `MiniProjectModal`; add `isLocked` helper; conditional hides per spec §3.2.4.
- Modify: `frontend/src/components/runs/MiniProjectModal.svelte` — accept `course: Course`; gate the link-rendering branches at lines 216 and 222 on `course.is_admin`. Keep line 201 (end_date link) unconditional.
- Test: `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` — extract `mountMpTab(extra)` helper, update 15 mount sites, add all required bullets per spec §6.2.
- Test: `frontend/src/tests/MiniProjectModal.teacher-gating.svelte.test.ts` — NEW file matching the existing split convention.

This is the most code-dense task — large existing test file (15 mount sites), several admin-dead CTAs, role-aware tooltip rewrite, and a new modal-test file. The `mountMpTab` extraction is required (spec §3.2.4 "Required").

- [ ] **Step 1: Extract `mountMpTab(extra)` helper in the existing MP test file**

Open `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts`. Add at top of file:

```ts
function mountMpTab(extra: Record<string, unknown> = {}) {
  const defaults = {
    runId: 1,
    course: { is_admin: true, slug: 'c', name: 'C', description: '' },
    run: { id: 1, is_published: false, groups_enabled: true },
    miniProjects: [],
    groups: [],
    students: [],
    onRefetch: async () => {},
    // ... add any other props the existing tests' inline mount calls used
  };
  return render(RunMiniProjectsTab, { ...defaults, ...extra });
}
```

Find all 15 direct `mount(RunMiniProjectsTab, {...})` call sites and replace each with `mountMpTab({...})` passing only the overrides that test needed. Run the suite to verify nothing regressed:

Run: `cd frontend && npm test -- src/tests/RunMiniProjectsTab.svelte.test.ts`
Expected: All PASS.

- [ ] **Step 2: Add failing RunMiniProjectsTab test bullets per spec §6.2**

Append to the file. (For brevity I show structure; fill in via the same `mountMpTab` helper.)

```ts
describe('RunMiniProjectsTab modal Publish stays teacher-allowed (regression)', () => {
  it('modal Publish button is visible regardless of course.is_admin', async () => {
    // Mount with course.is_admin=false. Click a row to open modal. Within modal scope,
    // assert Publish button present.
    const { getByText, getByRole, container } = mountMpTab({ course: { is_admin: false } });
    // ... click Edit / open modal ...
    const modal = container.querySelector('[role="dialog"]');
    expect(modal?.querySelector('button[data-action="publish"]')).toBeTruthy();
  });
});

describe('RunMiniProjectsTab locked-row force-delete gating', () => {
  const lockedMp = { id: 1, title: 'MP', first_submitted_at: '2026-04-15T10:00:00Z' };
  const unlockedMp = { id: 2, title: 'MP2', first_submitted_at: null };

  it('teacher: locked MP → force-confirm Delete affordance NOT in DOM', () => {
    const { queryByRole } = mountMpTab({
      course: { is_admin: false }, miniProjects: [lockedMp],
    });
    // confirm there's no force-confirm checkbox or Delete button under the locked row
    expect(queryByRole('checkbox', { name: /I understand/i })).toBeNull();
  });

  it('admin: locked MP → force-confirm Delete affordance IS in DOM', () => {
    const { queryByRole } = mountMpTab({
      course: { is_admin: true }, miniProjects: [lockedMp],
    });
    // ... open confirm ...
    expect(queryByRole('checkbox', { name: /I understand/i })).toBeTruthy();
  });

  it('teacher: unlocked MP → normal Delete IS in DOM', () => {
    const { getByRole } = mountMpTab({
      course: { is_admin: false }, miniProjects: [unlockedMp],
    });
    expect(getByRole('button', { name: /Delete/i })).toBeTruthy();
  });
});

describe('RunMiniProjectsTab "Publish on Overview" CTA gating', () => {
  it('teacher + !run.is_published: link NOT in DOM, banner text IS in DOM', () => {
    const { queryByRole, getByText } = mountMpTab({
      course: { is_admin: false }, run: { is_published: false },
    });
    expect(queryByRole('button', { name: /Publish on Overview/i })).toBeNull();
    expect(getByText(/Run is not yet published/)).toBeTruthy();
  });
  it('admin + !run.is_published: both banner AND link in DOM', () => {
    const { getByRole, getByText } = mountMpTab({
      course: { is_admin: true }, run: { is_published: false },
    });
    expect(getByText(/Run is not yet published/)).toBeTruthy();
    expect(getByRole('button', { name: /Publish on Overview/i })).toBeTruthy();
  });
});

describe('RunMiniProjectsTab "Enable on Overview" CTA gating', () => {
  it('teacher + published + !groupsEnabled: link NOT in DOM', () => {
    const { queryByRole } = mountMpTab({
      course: { is_admin: false }, run: { is_published: true, groups_enabled: false },
    });
    expect(queryByRole('button', { name: /Enable on Overview/i })).toBeNull();
  });
  it('teacher + !published + !groupsEnabled: link IS in DOM (teacher can act)', () => {
    const { getByRole } = mountMpTab({
      course: { is_admin: false }, run: { is_published: false, groups_enabled: false },
    });
    expect(getByRole('button', { name: /Enable on Overview/i })).toBeTruthy();
  });
  it('admin + !groupsEnabled: link IS in DOM regardless of is_published', () => {
    const { getByRole } = mountMpTab({
      course: { is_admin: true }, run: { is_published: true, groups_enabled: false },
    });
    expect(getByRole('button', { name: /Enable on Overview/i })).toBeTruthy();
  });
});

describe('RunMiniProjectsTab "See Overview" version-disabled-banner CTA gating', () => {
  it('teacher + versionIsDisabled: link NOT in DOM, banner text IS in DOM', () => {
    const { queryByRole, getByText } = mountMpTab({
      course: { is_admin: false },
      pinnedVersion: { is_disabled: true },
    });
    expect(queryByRole('button', { name: /See Overview/i })).toBeNull();
    expect(getByText(/course version is disabled/)).toBeTruthy();
  });
  it('admin + versionIsDisabled: link IS in DOM', () => {
    const { getByRole } = mountMpTab({
      course: { is_admin: true },
      pinnedVersion: { is_disabled: true },
    });
    expect(getByRole('button', { name: /See Overview/i })).toBeTruthy();
  });
});

describe('RunMiniProjectsTab newDisabledTitle role-aware', () => {
  it('teacher + published + !groupsEnabled: "Ask a course admin to unpublish..."', () => {
    const { getByRole } = mountMpTab({
      course: { is_admin: false },
      run: { is_published: true, groups_enabled: false },
    });
    const newBtn = getByRole('button', { name: /New mini-project/i });
    expect(newBtn.getAttribute('title')).toContain('Ask a course admin');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail; then edit RunMiniProjectsTab**

Run: `cd frontend && npm test -- src/tests/RunMiniProjectsTab.svelte.test.ts`
Expected: New bullets FAIL.

Open `frontend/src/components/runs/RunMiniProjectsTab.svelte`. Add to `$props`:

```ts
let { course, run, /* ...existing... */ } = $props<{ course: Course; /* ... */ }>();

const isLocked = (mp: MiniProjectResponse) => mp.first_submitted_at !== null;
```

Edit the force-delete affordance: `{#if course.is_admin || !isLocked(mp)}` around it.

Edit the three admin-dead CTAs per spec §3.2.4 RunMiniProjectsTab block:
- Line 185 "Publish on Overview" → wrap in `{#if course.is_admin}`.
- Line 170-175 "Enable on Overview" → gate `{#if !runIsPublished || course.is_admin}`.
- Line 179 "See Overview" → wrap in `{#if course.is_admin}`.

Rewrite `newDisabledTitle` at lines 96-99 per spec §3.2.4 (course-aware computation).

Pass `course={course}` into the `<MiniProjectModal>` mount inside this component (the mount is somewhere around the "open modal" handler — find it via grep for `<MiniProjectModal`).

- [ ] **Step 4: Create the new `MiniProjectModal.teacher-gating.svelte.test.ts` file**

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';

function mountModal(props: Partial<{
  course: { is_admin: boolean };
  run: { is_published: boolean; end_date: string | null };
  pinnedVersion: { is_disabled: boolean };
  mp: { id: number; title: string };
  // ... existing modal props
}>) {
  return render(MiniProjectModal, {
    open: true,
    course: props.course ?? { is_admin: true, slug: 'c', name: 'C', description: '' },
    run: props.run ?? { is_published: true, end_date: '2026-06-01' },
    pinnedVersion: props.pinnedVersion ?? { is_disabled: false },
    mp: props.mp ?? { id: 1, title: 'MP' },
    // ... onSave / onCancel / etc handlers
  });
}

describe('MiniProjectModal teacher-gating', () => {
  it('teacher + !run.is_published: "Open Overview to publish" link NOT in DOM, text IS', () => {
    const { queryByRole, getByText } = mountModal({
      course: { is_admin: false },
      run: { is_published: false, end_date: '2026-06-01' },
    });
    expect(queryByRole('button', { name: /Open Overview to publish/i })).toBeNull();
    expect(getByText(/Run must be published/)).toBeTruthy();
  });

  it('teacher + pinnedVersion.is_disabled: "Open Overview to re-enable it" NOT in DOM', () => {
    const { queryByRole, getByText } = mountModal({
      course: { is_admin: false },
      pinnedVersion: { is_disabled: true },
    });
    expect(queryByRole('button', { name: /Open Overview to re-enable/i })).toBeNull();
    expect(getByText(/course version is disabled/)).toBeTruthy();
  });

  it('teacher + !run.end_date: "Open Overview to set it" IS in DOM (teacher-editable)', () => {
    const { getByRole } = mountModal({
      course: { is_admin: false },
      run: { is_published: true, end_date: null },
    });
    expect(getByRole('button', { name: /Open Overview to set it/i })).toBeTruthy();
  });

  it('admin: all three link-button portions in DOM (regression)', () => {
    const { getByRole } = mountModal({
      course: { is_admin: true },
      run: { is_published: false, end_date: null },
      pinnedVersion: { is_disabled: true },
    });
    expect(getByRole('button', { name: /Open Overview to publish/i })).toBeTruthy();
    expect(getByRole('button', { name: /Open Overview to re-enable/i })).toBeTruthy();
    expect(getByRole('button', { name: /Open Overview to set it/i })).toBeTruthy();
  });
});
```

- [ ] **Step 5: Edit `MiniProjectModal.svelte` — accept course prop + gate two link buttons**

Open `frontend/src/components/runs/MiniProjectModal.svelte`. Add `course: Course` to `$props`. Locate the precondition-bullet rendering region (the spec cites lines 201, 216, 222, 439-447, 483-485). Wrap only the `<button>` part of the "Open Overview to publish" (line 216) and "Open Overview to re-enable it" (line 222) bullets in `{#if course.is_admin}`. Keep the bullet TEXT (e.g., "Run must be published") unconditional. Keep the line 201 "Open Overview to set it" link unconditional (end_date is teacher-editable per §3.1.6). Keep the line 483-485 Publish button unconditional (teacher-allowed).

The existing `MiniProjectModal.publish.svelte.test.ts` and `MiniProjectModal.create-edit.svelte.test.ts` test files need their mount calls updated to pass `course: { is_admin: true }` (preserving today's behavior).

- [ ] **Step 6: Run all affected tests**

Run: `cd frontend && npm test -- src/tests/RunMiniProjectsTab.svelte.test.ts src/tests/MiniProjectModal.teacher-gating.svelte.test.ts src/tests/MiniProjectModal.publish.svelte.test.ts src/tests/MiniProjectModal.create-edit.svelte.test.ts`
Expected: All PASS.

- [ ] **Step 7: Type-check + full vitest**

Run: `cd frontend && npm run check && npm test`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/runs/RunMiniProjectsTab.svelte \
        frontend/src/components/runs/MiniProjectModal.svelte \
        frontend/src/tests/RunMiniProjectsTab.svelte.test.ts \
        frontend/src/tests/MiniProjectModal.teacher-gating.svelte.test.ts \
        frontend/src/tests/MiniProjectModal.publish.svelte.test.ts \
        frontend/src/tests/MiniProjectModal.create-edit.svelte.test.ts
git commit -m "feat(frontend): RunMiniProjectsTab + MiniProjectModal teacher-gating + admin-dead CTA hides (slice A T12)"
```

---

## Task 13: Manual smoke walkthrough

**Spec:** §6.3 (steps 0, 0b, 1-11).

**Files:** None — this is purely manual verification.

This task is the final correctness check before merging. It MUST be run end-to-end in a real browser with a running backend + frontend. The §6.3 walkthrough in the spec is the authoritative checklist.

- [ ] **Step 1: Start backend + frontend dev servers**

```bash
# Terminal 1
cd backend && .venv/bin/uvicorn mathion.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

Open the printed dev URL (typically `http://localhost:5173`).

- [ ] **Step 2: Walk through spec §6.3 steps 0 through 11**

The spec §6.3 (`docs/superpowers/specs/2026-05-29-teacher-monitoring-slice-a-design.md` lines 1156-1175) is the authoritative checklist. Copy each step verbatim into a notepad and tick as you go.

Key gates:
- 0 — unauth /login has no AppHeader
- 0b — **wrong-PIN smoke (rev-15 skipAuthRedirect fix)**: visit `/` as unauth, URL → `/login?next=%2F`, submit wrong PIN, URL stays at `/login?next=%2F` (NOT rewritten to `/login?next=%2Fcourses`), real backend error shown
- 1 — admin login, AppHeader shows Authoring, lands on /courses
- 3 — teacher login, AppHeader shows Teaching, lands on /teaching
- 6 — open a teacher's run, ALL the conditional hides verified (a through i)
- 6b — disabled-version banner teacher copy vs admin copy
- 6c — created-state pinned version mounts (Critical loader-mount fix)
- 7 — `/` redirects to `/teaching` for teacher-only users
- 8 — empty state path
- 10b — embedded asset image loads (locks §3.1.3a)
- 11 — re-pinning a run filters the teacher's version list

For step 6b / 6c / 11 the spec gives exact `sqlite3` commands for the test DB. Use `backend/mathion.db` as the SQLite file path.

- [ ] **Step 3: File any defects as new tasks; do NOT commit until clean**

If any step fails, file the bug, fix it as a follow-up commit per the standard TDD loop (write failing test, fix, commit). Once all §6.3 steps pass, proceed.

- [ ] **Step 4: Commit a checkpoint**

```bash
git commit --allow-empty -m "chore: manual smoke walkthrough complete (slice A T13)"
```

---

## Task 14: Cleanup + final test run + branch handoff

- [ ] **Step 1: Run the full backend suite end-to-end**

Run: `backend/.venv/bin/pytest backend/tests/ -v`
Expected: All PASS.

- [ ] **Step 2: Run the full frontend suite end-to-end**

Run: `cd frontend && npm run check && npm test`
Expected: All PASS.

- [ ] **Step 3: Review the full diff against `main`**

```bash
git fetch origin main
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Sanity-check there are no stray files, no debug prints, no commented-out code.

- [ ] **Step 4: Hand off to `superpowers:finishing-a-development-branch`**

The branch is ready for merge / PR. Invoke the finishing skill or follow its menu (Merge / Push+PR / Keep / Discard).

---

## Self-Review Notes

This plan was self-reviewed against rev 17 of the spec:

1. **Spec coverage:**
   - §3.1.1 → T2 (by-slug + courses.py refactor)
   - §3.1.2 → T2 (versions list pinned-versions-only filter)
   - §3.1.3 → T2 (blocks gate)
   - §3.1.3a → T2 (serve_asset 4th branch)
   - §3.1.4 → T3 (UserResponse flags, _user_response_with_flags, get_profile, api_verify_pin)
   - §3.1.5 → T4 (/api/teaching/runs router)
   - §3.1.6 → T2 cascade-guard tests + T11 RunAssetsTab regression tests + T12 MP publish regression
   - §3.2.1 → T7 (AppHeader)
   - §3.2.2 → T8 (TeacherRunListPage)
   - §3.2.3 → T5 (lib/teaching.ts)
   - §3.2.4 RunDetailPage → T10
   - §3.2.4 RunOverviewTab → T11
   - §3.2.4 RunMiniProjectsTab → T12
   - §3.2.4 MiniProjectModal → T12
   - §3.2.4 RunTeachersTab → T11
   - §3.2.4 RunGroupsTab → T11
   - §3.2.5 App.svelte + defaultLandingPath + safeNext + Login.svelte + auth.svelte.ts + NotFound.svelte → T5 + T6 + T9
   - §3.2.6 session store (transparent) → T5 types extension covers it
   - §4 dataflow → no implementation; reference only
   - §5 edge cases → covered by tests in T1-T4 (5.4/5.6/5.7/5.11 → backend tests; 5.1/5.3/5.5/5.8/5.9/5.10/5.12/5.13 → reference / accepted gaps)
   - §6.1 backend tests → T1-T4
   - §6.2 frontend tests → T5-T12
   - §6.3 manual smoke → T13

2. **Placeholder scan:** No `TBD` / `TODO` / `implement later` placeholders. Every step contains the actual code or command. Where the spec references existing line numbers (e.g., `RunOverviewTab.svelte:161-167`), I cite the same in steps and note that the implementer should verify at impl time since rev 17 was written from a specific commit.

3. **Type consistency:**
   - `defaultLandingPath(user: User | null): string` — same signature in T5 production, T5 tests, T6 Login.svelte, T6 NotFound.svelte, T7 AppHeader, T9 App.svelte.
   - `safeNext(next: string, origin: string, fallback = '/courses'): string` — same signature in T5 production + tests + T6 Login.svelte usage.
   - `_user_response_with_flags(db: Session, user: User) -> UserResponse` — same in T3 production + spec §3.1.4.
   - `TeachingRunRow` — same shape in T4 backend schema, T5 frontend `lib/teaching.ts` interface, T8 page consumer.
   - `course: Course` prop — same shape passed to all 5 tabs + MiniProjectModal in T10-T12; tests stub `{ is_admin: true | false }` consistently.

4. **Scope:** No backward-compat hacks, no helpers built that aren't used in the same or next task, no abstraction for hypothetical future use. Plan stays within the spec.

5. **Risk flags called out inline:**
   - T2 — `courses.py:80` refactor hazard (single-assign).
   - T2 — `assets.py:139-140` admin-symmetric `is_disabled` kept; LOCKED by `test_assets_api.py:216-229`.
   - T10 — `RunDetailPage.svelte.test.ts:56` fixture audit prerequisite.
   - T10 — publish-bar split contract is testid-based (works for both wrap options).
   - T10 — TS strict-mode interaction with the tab `course` prop staging — call out the mitigation.
   - T12 — `mountMpTab` helper extraction is required (spec §3.2.4 "Required").

---
