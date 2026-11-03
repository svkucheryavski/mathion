"""D6 and D22 (superuser Users and Courses): one admin per course is enforced in
the database, keeping each course's earliest admin row; users get a
`last_seen_at`, backfilled from their latest session or, when it was used,
their newest sign-in PIN."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from mathion.auth import destroy_session, request_pin, verify_pin
from mathion.database import engine
from mathion.models import Course, CourseAdmin
from mathion.models_auth import User

BEFORE = "c7e2a4f9d1b3"


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


def _rerun_migration(seed_sql: list[tuple[str, dict]]) -> None:
    """Step back to the revision before this one, write rows in the old shape,
    then upgrade to head again."""
    command.downgrade(_cfg(), BEFORE)
    with engine.begin() as conn:
        for sql, params in seed_sql:
            conn.execute(text(sql), params)
    command.upgrade(_cfg(), "head")


def test_keeps_lowest_id_admin_per_course(db):
    db.close()
    _rerun_migration([
        ("INSERT INTO users (id, email, is_superuser, is_disabled) VALUES "
         "(1, 'a@x', false, false), (2, 'b@x', false, false), (3, 'c@x', false, false)", {}),
        ("INSERT INTO courses (id, slug, name, description) VALUES (1, 'one', 'One', ''), (2, 'two', 'Two', '')", {}),
        ("INSERT INTO course_admins (id, course_id, user_id) VALUES (10, 1, 2), (11, 1, 1), (12, 1, 3), (20, 2, 3)", {}),
    ])
    rows = sorted((a.id, a.course_id, a.user_id) for a in db.query(CourseAdmin))
    assert rows == [(10, 1, 2), (20, 2, 3)]


def test_backfills_last_seen_from_latest_session_or_used_pin(db):
    # Sessions go at logout, so a used sign-in PIN (never pruned) also counts
    # (user, Task 1): the later of the two wins. Only the NEWEST PIN counts:
    # request_pin marks every older unused PIN used, so an older "used" PIN
    # proves nothing (r: superseded, never signed in; s: signed in at t3).
    db.close()
    t1 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    t2, t3 = t1 + timedelta(days=3), t1 + timedelta(days=5)
    _rerun_migration([
        ("INSERT INTO users (id, email, is_superuser, is_disabled) VALUES "
         "(1, 'u@x', false, false), (2, 'v@x', false, false), (3, 'w@x', false, false), "
         "(4, 'p@x', false, false), (5, 'q@x', false, false), "
         "(6, 'r@x', false, false), (7, 's@x', false, false)", {}),
        ("INSERT INTO sessions (user_id, token_hash, expires_at, last_active_at) VALUES "
         "(1, 'h1', :exp, :t1), (1, 'h2', :exp, :t2), (4, 'h4', :exp, :t2)",
         {"exp": t3 + timedelta(days=30), "t1": t1, "t2": t2}),
        ("INSERT INTO login_pins (user_id, pin_hash, expires_at, is_used, created_at) VALUES "
         "(1, 'p', :exp, true, :t1), (3, 'p', :exp, true, :t3), (4, 'p', :exp, true, :t3), "
         "(5, 'p', :exp, false, :t3), (6, 'p', :exp, true, :t1), (6, 'p', :exp, false, :t3), "
         "(7, 'p', :exp, true, :t1), (7, 'p', :exp, true, :t3)",
         {"exp": t3 + timedelta(minutes=10), "t1": t1, "t3": t3}),
    ])
    seen = {u.email: u.last_seen_at for u in db.query(User)}
    assert seen == {"u@x": t2, "v@x": None, "w@x": t3, "p@x": t3, "q@x": None,
                    "r@x": None, "s@x": t3}


def test_backfill_from_real_sign_in_calls(db):
    # Two PIN requests and no sign-in leave a "used" PIN behind; that is not a
    # sign-in. A real sign-in followed by logout (session gone) still counts.
    never, came = User(email="never@x"), User(email="came@x")
    db.add_all([never, came])
    db.commit()
    request_pin(db, "never@x")
    request_pin(db, "never@x")
    destroy_session(db, verify_pin(db, "came@x", request_pin(db, "came@x"), duration_days=7))
    db.close()

    _rerun_migration([])
    seen = {u.email: u.last_seen_at for u in db.query(User)}
    assert seen["never@x"] is None
    assert seen["came@x"] is not None


def test_second_admin_row_violates_unique(db):
    course = Course(slug="c", name="C", description="")
    a, b = User(email="a@x"), User(email="b@x")
    db.add_all([course, a, b])
    db.commit()
    db.add(CourseAdmin(course_id=course.id, user_id=a.id))
    db.commit()
    db.add(CourseAdmin(course_id=course.id, user_id=b.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
