"""Tests for the teacher monitoring surface (Slice A).

Helper unit tests are called as plain Python functions (not via HTTP),
matching the precedent at `backend/tests/test_run_permissions.py` and
`backend/tests/test_slugify.py`.
"""
from datetime import date

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
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            groups_enabled=False, is_published=False)
    db.add(r); db.commit(); db.refresh(r); return r


def _link_teacher(db: Session, run_id: int, user_id: int) -> None:
    db.add(RunTeacher(run_id=run_id, user_id=user_id)); db.commit()


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
