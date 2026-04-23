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
