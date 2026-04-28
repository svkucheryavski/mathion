from datetime import date

import pytest
from fastapi import HTTPException

from mathion.api.helpers import require_run_admin_or_teacher
from mathion.models import Course, CourseAdmin, CourseVersion, Run, RunTeacher


def _make_run(db):
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
    require_run_admin_or_teacher(db, superuser, run)  # no exception


def test_course_admin_passes(db, test_user):
    course, run = _make_run(db)
    db.add(CourseAdmin(course_id=course.id, user_id=test_user.id))
    db.commit()
    require_run_admin_or_teacher(db, test_user, run)  # no exception


def test_run_teacher_passes(db, test_user):
    _, run = _make_run(db)
    db.add(RunTeacher(run_id=run.id, user_id=test_user.id))
    db.commit()
    require_run_admin_or_teacher(db, test_user, run)  # no exception


def test_unrelated_user_403(db, test_user):
    _, run = _make_run(db)
    with pytest.raises(HTTPException) as excinfo:
        require_run_admin_or_teacher(db, test_user, run)
    assert excinfo.value.status_code == 403
