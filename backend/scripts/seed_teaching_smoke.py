"""Seed data for the teacher-monitoring (slice A) T13 smoke walkthrough.

Idempotent: re-running deletes the teaching-smoke-101 course (which cascades
versions, blocks, runs, RunTeacher rows, etc.) and recreates it. Users are
looked up by email; if they don't exist, they're created. Users are NEVER
deleted (their sessions/login attempts would otherwise vanish).

Creates:
- admin@mathion.test (CourseAdmin on teaching-smoke-101)
- teacher@mathion.test (RunTeacher on both seeded runs; no CourseAdmin)
- Course "teaching-smoke-101" with 1 published version + 1 block
- Run "Spring 2026" — active (start 2026-03-01, end 2026-07-31, published, groups_enabled)
- Run "Fall 2026" — upcoming (start 2026-09-01, end 2026-12-15, published, groups_enabled)

Run from the backend dir:
    PYTHONPATH=. .venv/bin/python scripts/seed_teaching_smoke.py
"""

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from mathion.database import SessionLocal
from mathion.markdown import render_markdown
from mathion.models import Block, Course, CourseAdmin, CourseVersion, Run, RunTeacher
from mathion.models_auth import User

COURSE_SLUG = "teaching-smoke-101"
ADMIN_EMAIL = "admin@mathion.test"
TEACHER_EMAIL = "teacher@mathion.test"


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
        teacher = get_or_create_user(db, TEACHER_EMAIL, "Teacher User")

        existing = db.execute(select(Course).where(Course.slug == COURSE_SLUG)).scalar_one_or_none()
        if existing:
            # Run.version_id is RESTRICT, so delete runs by course's versions
            # before deleting the course (whose ORM cascade drops versions).
            version_ids = [v.id for v in existing.versions]
            if version_ids:
                old_runs = db.execute(
                    select(Run).where(Run.version_id.in_(version_ids))
                ).scalars().all()
                for r in old_runs:
                    db.delete(r)
                db.flush()
            db.delete(existing)
            db.flush()

        course = Course(
            slug=COURSE_SLUG,
            name="Teaching Smoke 101",
            description="Teacher-monitoring slice A smoke fixture.",
        )
        db.add(course)
        db.flush()

        db.add(CourseAdmin(course_id=course.id, user_id=admin.id))

        info_md = "Published version for teacher-monitoring smoke testing."
        version = CourseVersion(
            course_id=course.id,
            state="published",
            info_md=info_md,
            info_html=render_markdown(info_md),
            published_at=datetime.now(timezone.utc),
        )
        db.add(version)
        db.flush()

        block_md = "Smoke intro block."
        block = Block(
            version_id=version.id,
            title="Intro",
            slug="intro",
            order=1,
            info=block_md,
            info_html=render_markdown(block_md),
        )
        db.add(block)
        db.flush()

        # Run 1: Active (today ∈ [start, end]) — fills the default Active pill.
        run_active = Run(
            version_id=version.id,
            title="Spring 2026",
            start_date=date(2026, 3, 1),
            end_date=date(2026, 7, 31),
            groups_enabled=True,
            is_published=True,
            created_by=admin.id,
        )
        db.add(run_active)
        db.flush()

        # Run 2: Upcoming (today < start_date) — exercises pill switching.
        run_upcoming = Run(
            version_id=version.id,
            title="Fall 2026",
            start_date=date(2026, 9, 1),
            end_date=date(2026, 12, 15),
            groups_enabled=True,
            is_published=True,
            created_by=admin.id,
        )
        db.add(run_upcoming)
        db.flush()

        db.add(RunTeacher(run_id=run_active.id, user_id=teacher.id))
        db.add(RunTeacher(run_id=run_upcoming.id, user_id=teacher.id))

        db.commit()

        print(f"Seeded course '{COURSE_SLUG}' (version_id={version.id}, block_id={block.id}).")
        print(f"  Admin:   {admin.email} (id={admin.id})  → CourseAdmin on {COURSE_SLUG}")
        print(f"  Teacher: {teacher.email} (id={teacher.id})  → RunTeacher on both runs")
        print(f"  Runs:")
        print(f"    {run_active.id}: {run_active.title!r} (active: {run_active.start_date} → {run_active.end_date}, published)")
        print(f"    {run_upcoming.id}: {run_upcoming.title!r} (upcoming: {run_upcoming.start_date} → {run_upcoming.end_date}, published)")
        print()
        print("Log in via the /login PIN flow; PIN is printed to stdout under MATHION_DEBUG=1.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
