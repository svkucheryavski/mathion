"""Postgres schema gates (criteria 3, 4, 8).

- Criterion 3: the migrated schema has NO drift from the ORM metadata.
- Criterion 4: FK ondelete rules, named CHECK constraints, TIMESTAMPTZ semantics,
  the UTC session timezone, and JSON NULL handling are all asserted BEHAVIOURALLY
  (a name-presence check would pass even if a migration silently changed the rule).
- Criterion 8: the harness cleanup (`_truncate_all`) actually removes committed
  rows while preserving `alembic_version`.
"""
from datetime import date, datetime, timedelta, timezone

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from mathion.database import Base, engine


# --- Criterion 3: no schema drift --------------------------------------------

def test_no_schema_drift():
    # Same comparison options as alembic/env.py's online context, so this mirrors
    # `alembic check`. A non-empty diff means Task 4's migration is out of sync
    # with the ORM models.
    with engine.connect() as conn:
        ctx = MigrationContext.configure(
            conn, opts={"compare_type": True, "compare_server_default": True}
        )
        diffs = compare_metadata(ctx, Base.metadata)
    assert diffs == [], f"Unexpected schema drift: {diffs}"


# --- Criterion 4: FK ondelete rules match the live database -------------------

def _model_fk_ondelete():
    wanted = {}
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            key = (table.name, fk.parent.name, fk.column.table.name, fk.column.name)
            wanted[key] = (fk.ondelete or "NO ACTION").upper()
    return wanted


def test_every_fk_ondelete_matches_reflection():
    insp = inspect(engine)
    reflected = {}
    for table in Base.metadata.sorted_tables:
        for fk in insp.get_foreign_keys(table.name):
            ondelete = (fk.get("options", {}).get("ondelete") or "NO ACTION").upper()
            for local, remote in zip(fk["constrained_columns"], fk["referred_columns"]):
                reflected[(table.name, local, fk["referred_table"], remote)] = ondelete

    wanted = _model_fk_ondelete()
    assert wanted, "no foreign keys discovered — metadata not loaded?"
    for key, want in wanted.items():
        assert reflected.get(key) == want, (
            f"ondelete mismatch for {key}: model={want} db={reflected.get(key)}"
        )


# --- Criterion 4: named CHECK constraints verified BEHAVIOURALLY --------------

def _seed_parents(db):
    """Seed + commit a valid parent graph; return an ids dict.

    Creates course -> version -> two blocks -> run -> group -> user, plus a
    VALID mini_project (on `block`) and a VALID submission in it. `block_free`
    carries no mini_project, so the mini_project CHECK tests insert a violating
    row there and fail ONLY on the CHECK, never on uq_mini_project_run_block.
    """
    from mathion.models import (
        Block, Course, CourseVersion, Group, MiniProject, Run, Submission,
    )
    from mathion.models_auth import User

    course = Course(slug="ckc", name="CK", description="")
    db.add(course); db.flush()
    version = CourseVersion(course_id=course.id)
    db.add(version); db.flush()
    block = Block(version_id=version.id, title="B", slug="b", order=1)
    block_free = Block(version_id=version.id, title="B2", slug="b2", order=2)
    db.add_all([block, block_free]); db.flush()
    run = Run(version_id=version.id, title="R",
              start_date=date(2026, 1, 1), end_date=date(2026, 6, 1),
              is_published=True)
    db.add(run); db.flush()
    group = Group(run_id=run.id, name="G")
    user = User(email="ck@example.com", full_name="CK")
    db.add_all([group, user]); db.flush()
    mp = MiniProject(run_id=run.id, block_id=block.id,
                     assignment_md="a", assignment_html="<p>a</p>", is_published=True)
    db.add(mp); db.flush()
    sub = Submission(mini_project_id=mp.id, group_id=group.id, submission_number=1,
                     submitted_by=user.id, file_path="/x.pdf", file_size=1)
    db.add(sub); db.flush()
    db.commit()
    return {
        "version": version.id, "block_free": block_free.id, "run": run.id,
        "group": group.id, "user": user.id, "mp": mp.id, "sub": sub.id,
    }


def _expect_check_violation(db, sql, params, constraint):
    """A raw INSERT that violates a DB CHECK must raise IntegrityError naming it.

    Raw SQL bypasses the ORM entirely and hits the constraint directly; every
    non-target constraint (FKs, NOT NULLs, uniques) is satisfied by design. The
    constraint-name assertion is what makes the test non-vacuous: it proves the
    named CHECK fired, not some collateral constraint.
    """
    with pytest.raises(IntegrityError) as excinfo:
        db.execute(text(sql), params)
    db.rollback()
    assert constraint in str(excinfo.value.orig), (
        f"expected CHECK {constraint!r} to fire, got: {excinfo.value.orig}"
    )


def test_check_mini_project_soft_le_hard(db):
    ids = _seed_parents(db)
    _expect_check_violation(
        db,
        "INSERT INTO mini_projects "
        "(run_id, block_id, assignment_md, assignment_html, is_published, soft_deadline, hard_deadline) "
        "VALUES (:run, :block, 'a', '<p>a</p>', false, :soft, :hard)",
        {"run": ids["run"], "block": ids["block_free"],
         "soft": "2030-02-01T00:00:00+00", "hard": "2030-01-01T00:00:00+00"},
        "ck_mini_project_soft_le_hard",
    )


def test_check_mini_project_hard_le_resubmission(db):
    ids = _seed_parents(db)
    # soft_deadline left NULL so ck_mini_project_soft_le_hard cannot fire first.
    _expect_check_violation(
        db,
        "INSERT INTO mini_projects "
        "(run_id, block_id, assignment_md, assignment_html, is_published, hard_deadline, resubmission_deadline) "
        "VALUES (:run, :block, 'a', '<p>a</p>', false, :hard, :resub)",
        {"run": ids["run"], "block": ids["block_free"],
         "hard": "2030-02-01T00:00:00+00", "resub": "2030-01-01T00:00:00+00"},
        "ck_mini_project_hard_le_resubmission",
    )


def test_check_submission_number_positive(db):
    ids = _seed_parents(db)
    # submission_number 0 is distinct from the seeded row's 1, so the unique
    # (mini_project, group, number) is not what fires — the CHECK is.
    _expect_check_violation(
        db,
        "INSERT INTO submissions "
        "(mini_project_id, group_id, submission_number, submitted_by, file_path, file_size, is_late, is_resubmission) "
        "VALUES (:mp, :grp, 0, :user, '/x.pdf', 1, false, false)",
        {"mp": ids["mp"], "grp": ids["group"], "user": ids["user"]},
        "ck_submission_number_positive",
    )


def test_check_submission_file_size_positive(db):
    ids = _seed_parents(db)
    _expect_check_violation(
        db,
        "INSERT INTO submissions "
        "(mini_project_id, group_id, submission_number, submitted_by, file_path, file_size, is_late, is_resubmission) "
        "VALUES (:mp, :grp, 2, :user, '/x.pdf', 0, false, false)",
        {"mp": ids["mp"], "grp": ids["group"], "user": ids["user"]},
        "ck_submission_file_size_positive",
    )


def test_check_evaluation_result_enum(db):
    ids = _seed_parents(db)
    # feedback_file NOT NULL so ck_evaluation_feedback_file_required is satisfied;
    # score NULL so ck_evaluation_score_range is satisfied — only the enum fires.
    _expect_check_violation(
        db,
        "INSERT INTO evaluations (submission_id, evaluated_by, result, feedback_file) "
        "VALUES (:sub, :user, 'bogus', '/f.pdf')",
        {"sub": ids["sub"], "user": ids["user"]},
        "ck_evaluation_result_enum",
    )


def test_check_evaluation_score_range(db):
    ids = _seed_parents(db)
    # result 'accepted' is a valid enum AND satisfies feedback_file_required with a
    # NULL feedback_file — so score=999 is the only violation.
    _expect_check_violation(
        db,
        "INSERT INTO evaluations (submission_id, evaluated_by, result, score) "
        "VALUES (:sub, :user, 'accepted', 999)",
        {"sub": ids["sub"], "user": ids["user"]},
        "ck_evaluation_score_range",
    )


def test_check_evaluation_feedback_file_required(db):
    ids = _seed_parents(db)
    # result 'rejected' is a valid enum and score NULL is in range; only the
    # feedback_file-required rule fires (non-accepted + NULL feedback_file).
    _expect_check_violation(
        db,
        "INSERT INTO evaluations (submission_id, evaluated_by, result) "
        "VALUES (:sub, :user, 'rejected')",
        {"sub": ids["sub"], "user": ids["user"]},
        "ck_evaluation_feedback_file_required",
    )


# --- Criterion 4: TIMESTAMPTZ semantics + UTC session ------------------------

def test_timestamptz_semantic_roundtrip(db):
    from mathion.models_auth import User

    plus5 = timezone(timedelta(hours=5))
    u = User(email="tz@example.com", full_name="TZ",
             created_at=datetime(2030, 1, 1, 12, 0, tzinfo=plus5))
    db.add(u); db.commit()
    db.expire_all()  # force a fresh read, not the identity-map cache
    got = db.get(User, u.id).created_at
    assert got.tzinfo is not None
    assert got.astimezone(timezone.utc) == datetime(2030, 1, 1, 7, 0, tzinfo=timezone.utc)


def test_session_timezone_is_utc(db):
    assert db.execute(text("SHOW TimeZone")).scalar() == "UTC"


# --- Criterion 4: JSON NULL handling -----------------------------------------

def test_json_unset_is_sql_null(db):
    from mathion.models import Block, Course, CourseVersion, Item, Sequence
    from mathion.models_auth import User, UserItemState

    u = User(email="j@example.com", full_name="J"); db.add(u); db.flush()
    c = Course(slug="jc", name="JC", description=""); db.add(c); db.flush()
    v = CourseVersion(course_id=c.id); db.add(v); db.flush()
    b = Block(version_id=v.id, title="B", slug="b", order=1); db.add(b); db.flush()
    s = Sequence(block_id=b.id, title="S", slug="s", order=1); db.add(s); db.flush()
    it = Item(sequence_id=s.id, title="I", slug="i", order=1, type="static_page",
              content_md="x", content_html="<p>x</p>"); db.add(it); db.flush()
    st = UserItemState(user_id=u.id, item_id=it.id); db.add(st); db.commit()
    # last_answers left unset must be SQL NULL — assert via IS NULL, because JSON
    # 'null' would also deserialize to Python None and hide a wrong value.
    is_null = db.execute(
        text("SELECT last_answers IS NULL FROM user_item_states WHERE id = :i"),
        {"i": st.id},
    ).scalar()
    assert is_null is True


# --- Criterion 8: cleanup is proven, not vacuous -----------------------------

def test_cleanup_truncates_committed_rows(db):
    from tests.conftest import _truncate_all
    from mathion.models_auth import User

    db.add(User(email="sentinel@example.com", full_name="S")); db.commit()
    assert db.execute(text("SELECT count(*) FROM users")).scalar() == 1
    db.close()  # release the session's connection so TRUNCATE's lock can't wedge
    with engine.begin() as conn:
        _truncate_all(conn)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM users")).scalar() == 0
        # alembic_version is NOT a model table, so it survives truncation.
        assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar() == 1
