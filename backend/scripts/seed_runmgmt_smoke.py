"""Seed data for the run-management T18 smoke plan.

Idempotent: re-running deletes the calc-101 course (which cascades versions,
blocks, sequences, items, CourseAdmin rows, runs, etc.) and recreates it.
Users are looked up by email; if they don't exist, they're created. Users
are NEVER deleted (their sessions/login attempts would otherwise vanish).

Run from the backend dir:
    PYTHONPATH=. .venv/bin/python scripts/seed_runmgmt_smoke.py
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from mathion.database import SessionLocal
from mathion.markdown import render_markdown
from mathion.models import Block, Course, CourseAdmin, CourseVersion, Item, Sequence
from mathion.models_auth import StudentEnrollment, User

COURSE_SLUG = "calc-101"
ADMIN_EMAIL = "admin@mathion.test"
NONADMIN_EMAIL = "nonadmin@mathion.test"


def get_or_create_user(db: DBSession, email: str, full_name: str) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user:
        return user
    user = User(email=email, full_name=full_name, is_superuser=False, is_disabled=False)
    db.add(user)
    db.flush()
    return user


def seed() -> None:
    db = SessionLocal()
    try:
        admin = get_or_create_user(db, ADMIN_EMAIL, "Admin User")
        nonadmin = get_or_create_user(db, NONADMIN_EMAIL, "Non-Admin User")

        existing = db.execute(select(Course).where(Course.slug == COURSE_SLUG)).scalar_one_or_none()
        if existing:
            db.delete(existing)
            db.flush()

        course = Course(slug=COURSE_SLUG, name="Calculus 101",
                        description="Run-management smoke fixture.")
        db.add(course)
        db.flush()

        db.add(CourseAdmin(course_id=course.id, user_id=admin.id))

        info_md = "Minimal published version for run-management T18 smoke testing."
        version = CourseVersion(
            course_id=course.id, state="published",
            info_md=info_md, info_html=render_markdown(info_md),
            published_at=datetime.now(timezone.utc),
        )
        db.add(version)
        db.flush()

        block = Block(version_id=version.id, title="Intro", slug="intro", order=1,
                      info="Smoke intro.", info_html=render_markdown("Smoke intro."))
        db.add(block)
        db.flush()

        seq = Sequence(block_id=block.id, title="Welcome", slug="welcome", order=1)
        db.add(seq)
        db.flush()

        page_md = "# Welcome\n\nSmoke-fixture page."
        db.add(Item(sequence_id=seq.id, title="Welcome", slug="welcome", order=1,
                    type="static_page", content_md=page_md, content_html=render_markdown(page_md)))

        # Enroll the non-admin user as a student so by-slug returns 200 with
        # is_admin:false (exercising the spec's non-admin-with-enrollment path,
        # not the not-enrolled 403 cascade).
        db.add(StudentEnrollment(user_id=nonadmin.id, version_id=version.id, is_active=True))

        db.commit()

        print(f"Seeded course '{COURSE_SLUG}' (version_id={version.id}).")
        print(f"  Admin:     {admin.email} (id={admin.id})  → CourseAdmin on {COURSE_SLUG}")
        print(f"  Non-admin: {nonadmin.email} (id={nonadmin.id})  → enrolled (student) in {COURSE_SLUG}")
        print()
        print("Log in via the /login PIN flow; PIN is printed to stdout under MATHION_DEBUG=1.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
