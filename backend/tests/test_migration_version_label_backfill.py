"""The version label became mandatory (user, 2026-10-08). The backfill migration
gives every existing version with an empty (or whitespace-only) label the label
"Version <id>"; a version that already has a label keeps it."""
from pathlib import Path

from alembic import command
from alembic.config import Config

from mathion.models import Course, CourseVersion

INITIAL = "67e8294b4267"


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


def test_backfill_names_unlabelled_versions(db):
    course = Course(slug="bf", name="BF", description="")
    db.add(course)
    db.commit()
    empty = CourseVersion(course_id=course.id, state="created", info_md="", info_html="", label="")
    blank = CourseVersion(course_id=course.id, state="published", info_md="", info_html="", label="   ")
    kept = CourseVersion(course_id=course.id, state="created", info_md="", info_html="", label="Spring 26")
    db.add_all([empty, blank, kept])
    db.commit()
    ids = (empty.id, blank.id, kept.id)
    db.close()

    # Step back to the revision before the backfill and run it again; its
    # downgrade is a no-op, so the schema is untouched either way.
    command.downgrade(_cfg(), INITIAL)
    command.upgrade(_cfg(), "head")

    labels = {v.id: v.label for v in db.query(CourseVersion).filter(CourseVersion.id.in_(ids))}
    assert labels == {ids[0]: f"Version {ids[0]}", ids[1]: f"Version {ids[1]}", ids[2]: "Spring 26"}
