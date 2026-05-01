"""Test the Phase 7c data migration recomputes scores under the new rule."""
import glob
import importlib.util
import os

import alembic.op as alembic_op

from mathion.models import (AnswerOption, Block, Course, CourseVersion, Item,
                             Question, Sequence)
from mathion.models_auth import User, UserItemState


def _load_migration():
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    matches = glob.glob(os.path.join(
        backend_dir, "alembic/versions/*phase7c_recompute_quiz_scores.py"))
    assert len(matches) == 1, f"expected 1 migration file, found {matches}"
    spec = importlib.util.spec_from_file_location("phase7c_mig", matches[0])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_upgrade(db, monkeypatch):
    """Run the migration's upgrade body against the test session's bind."""
    mod = _load_migration()
    # The migration uses bind.execute(...), which on SQLAlchemy 2.x requires a
    # Connection (Engine.execute was removed). The session's connection shares
    # the same transaction, so changes are visible to the session afterwards.
    monkeypatch.setattr(alembic_op, "get_bind", lambda: db.connection())
    mod.upgrade()


def test_migration_recomputes_multi_choice_partial_credit(db, monkeypatch):
    """A row stored under the OLD rule (1 of 2 correct picks → 0/1) is rewritten
    to the NEW option-level rule (1/2)."""
    course = Course(slug="m", name="M", description="")
    db.add(course); db.flush()
    v = CourseVersion(course_id=course.id, info_md="", info_html="",
                      state="draft")
    db.add(v); db.flush()
    block = Block(version_id=v.id, title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    item = Item(sequence_id=seq.id, title="Q", slug="q", order=1, type="quiz")
    db.add(item); db.flush()
    q = Question(item_id=item.id, text_md="?", text_html="<p>?</p>",
                 type="multiple_choice", order=1)
    db.add(q); db.flush()
    o1 = AnswerOption(question_id=q.id, text="a", is_correct=True, order=1)
    o2 = AnswerOption(question_id=q.id, text="b", is_correct=False, order=2)
    o3 = AnswerOption(question_id=q.id, text="c", is_correct=True, order=3)
    o4 = AnswerOption(question_id=q.id, text="d", is_correct=False, order=4)
    db.add_all([o1, o2, o3, o4]); db.flush()

    user = User(email="x@example.com", full_name="X")
    db.add(user); db.flush()

    state = UserItemState(
        user_id=user.id,
        item_id=item.id,
        is_covered=True,
        attempt_count=1,
        last_answers={str(q.id): [o1.id]},
        last_score_correct=0,  # old whole-question rule said "wrong"
        last_score_total=1,
    )
    db.add(state); db.commit()

    _run_upgrade(db, monkeypatch)

    db.expire_all()
    refreshed = db.get(UserItemState, state.id)
    # New rule: 1 of 2 correct picks, 0 wrong picks → (1, 2)
    assert refreshed.last_score_correct == 1
    assert refreshed.last_score_total == 2


def test_migration_skips_null_last_answers(db, monkeypatch):
    """Rows with last_answers IS NULL must not be modified."""
    course = Course(slug="n", name="N", description="")
    db.add(course); db.flush()
    v = CourseVersion(course_id=course.id, info_md="", info_html="",
                      state="draft")
    db.add(v); db.flush()
    block = Block(version_id=v.id, title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    item = Item(sequence_id=seq.id, title="X", slug="x", order=1, type="static_page",
                content_md="x", content_html="<p>x</p>")
    db.add(item); db.flush()

    user = User(email="y@example.com", full_name="Y")
    db.add(user); db.flush()

    state = UserItemState(
        user_id=user.id, item_id=item.id, is_covered=True,
        attempt_count=0, last_answers=None,
        last_score_correct=None, last_score_total=None,
    )
    db.add(state); db.commit()

    _run_upgrade(db, monkeypatch)

    db.expire_all()
    refreshed = db.get(UserItemState, state.id)
    assert refreshed.last_score_correct is None
    assert refreshed.last_score_total is None
