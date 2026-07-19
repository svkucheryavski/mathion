"""Seed a demo course for the dev user. Idempotent: re-running deletes the
demo course (slug='demo-course') and recreates it from scratch.

Run from the backend dir: `PYTHONPATH=. .venv/bin/python scripts/seed_demo.py`
"""

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from mathion.database import SessionLocal
from mathion.markdown import render_markdown
from mathion.models import (
    AnswerOption,
    Block,
    Course,
    CourseVersion,
    Item,
    Question,
    Sequence,
)
from mathion.models_auth import StudentEnrollment, User

DEMO_SLUG = "demo-course"
DEV_EMAIL = "dev@mathion.test"
VIDEO_A = "https://www.youtube.com/embed/dQw4w9WgXcQ"
VIDEO_B = "https://www.youtube.com/embed/9bZkp7q19f0"


def mk_page(db: DBSession, seq: Sequence, order: int, slug: str, title: str, body_md: str) -> Item:
    item = Item(
        sequence_id=seq.id, title=title, slug=slug, order=order, type="static_page",
        content_md=body_md, content_html=render_markdown(body_md),
    )
    db.add(item)
    return item


def mk_video(db: DBSession, seq: Sequence, order: int, slug: str, title: str, url: str) -> Item:
    item = Item(
        sequence_id=seq.id, title=title, slug=slug, order=order, type="video", video_url=url,
    )
    db.add(item)
    return item


def mk_quiz(db: DBSession, seq: Sequence, order: int, slug: str, title: str, questions: list[dict]) -> Item:
    item = Item(sequence_id=seq.id, title=title, slug=slug, order=order, type="quiz")
    db.add(item)
    db.flush()
    for q_order, q in enumerate(questions, start=1):
        text_md = q["text"]
        question = Question(
            item_id=item.id,
            text_md=text_md,
            text_html=render_markdown(text_md),
            type=q["type"],
            order=q_order,
            correct_numeric=q.get("correct_numeric"),
            precision=q.get("precision"),
            correct_text=q.get("correct_text"),
        )
        db.add(question)
        db.flush()
        for o_order, opt in enumerate(q.get("options", []), start=1):
            db.add(AnswerOption(
                question_id=question.id, text=opt["text"], is_correct=opt["correct"], order=o_order,
            ))
    return item


def seed() -> None:
    db = SessionLocal()
    try:
        user = db.execute(select(User).where(User.email == DEV_EMAIL)).scalar_one_or_none()
        if not user:
            # Self-contained: create the dev account so a fresh bootstrap can seed
            # without a manual prerequisite step.
            user = User(email=DEV_EMAIL, full_name="Dev")
            db.add(user)
            db.flush()

        existing = db.execute(select(Course).where(Course.slug == DEMO_SLUG)).scalar_one_or_none()
        if existing:
            db.delete(existing)
            db.flush()

        course = Course(
            slug=DEMO_SLUG, name="Demo Course",
            description="A small course covering page, video, and quiz items for smoke-testing.",
        )
        db.add(course)
        db.flush()

        info_md = "Welcome to the **demo course**. Use it to exercise the student UI."
        version = CourseVersion(
            course_id=course.id, state="published",
            info_md=info_md, info_html=render_markdown(info_md),
            published_at=datetime.now(timezone.utc),
        )
        db.add(version)
        db.flush()

        block1 = Block(
            version_id=version.id, title="Getting Started", slug="getting-started", order=1,
            info="Intro material.", info_html=render_markdown("Intro material."),
        )
        block2 = Block(
            version_id=version.id, title="Practice", slug="practice", order=2,
            info="Try a quiz.", info_html=render_markdown("Try a quiz."),
        )
        db.add_all([block1, block2])
        db.flush()

        seq_intro = Sequence(block_id=block1.id, title="Welcome", slug="welcome", order=1)
        seq_video = Sequence(block_id=block1.id, title="Watch & learn", slug="watch", order=2)
        seq_quiz = Sequence(block_id=block2.id, title="Check your understanding", slug="check", order=1)
        db.add_all([seq_intro, seq_video, seq_quiz])
        db.flush()

        # ---- Block 1 / Sequence 1: Welcome (page → video → quiz → video) ----
        mk_page(db, seq_intro, 1, "welcome", "Welcome page",
                "# Welcome\n\nThis is a **static page** item. Stay here for 30 seconds and it'll be marked covered.")
        mk_video(db, seq_intro, 2, "intro", "Intro video", VIDEO_A)
        mk_quiz(db, seq_intro, 3, "warmup", "Warm-up quiz", [
            {
                "text": "Pick the prime number.",
                "type": "single_choice",
                "options": [
                    {"text": "4", "correct": False},
                    {"text": "5", "correct": True},
                    {"text": "9", "correct": False},
                ],
            },
            {
                "text": "What is 3 + 4?",
                "type": "numeric_answer",
                "correct_numeric": Decimal("7"), "precision": 0,
            },
        ])
        mk_video(db, seq_intro, 4, "wrapup", "Wrap-up video", VIDEO_B)

        # ---- Block 1 / Sequence 2: Watch & learn (video → page → quiz → page) ----
        mk_video(db, seq_video, 1, "concept", "Concept video", VIDEO_A)
        mk_page(db, seq_video, 2, "notes", "Notes",
                "## Notes\n\nKey points from the video:\n\n- Point one\n- Point two\n- Point three")
        mk_quiz(db, seq_video, 3, "checkpoint", "Checkpoint", [
            {
                "text": "Which of these are even? *(select all that apply)*",
                "type": "multiple_choice",
                "options": [
                    {"text": "1", "correct": False},
                    {"text": "2", "correct": True},
                    {"text": "3", "correct": False},
                    {"text": "4", "correct": True},
                ],
            },
            {
                "text": "Spell the answer: *capital of Norway*",
                "type": "text_answer", "correct_text": "Oslo",
            },
        ])
        mk_page(db, seq_video, 4, "summary", "Summary",
                "## Summary\n\nGreat work! Continue to the next block when ready.")

        # ---- Block 2 / Sequence 1: Check your understanding (quiz → page → video → quiz) ----
        mk_quiz(db, seq_quiz, 1, "mixed", "Mixed quiz", [
            {
                "text": "Which of these is a prime number?",
                "type": "single_choice",
                "options": [
                    {"text": "4", "correct": False},
                    {"text": "6", "correct": False},
                    {"text": "7", "correct": True},
                    {"text": "9", "correct": False},
                ],
            },
            {
                "text": "Which of these are even? *(select all that apply)*",
                "type": "multiple_choice",
                "options": [
                    {"text": "2", "correct": True},
                    {"text": "3", "correct": False},
                    {"text": "6", "correct": True},
                    {"text": "9", "correct": False},
                ],
            },
            {
                "text": "What is 2 + 2?",
                "type": "numeric_answer", "correct_numeric": Decimal("4"), "precision": 0,
            },
            {
                "text": "Capital of France?",
                "type": "text_answer", "correct_text": "Paris",
            },
        ])
        mk_page(db, seq_quiz, 2, "solutions", "Solutions notes",
                "## Solutions\n\nReview the worked solutions before the next exercises.")
        mk_video(db, seq_quiz, 3, "bonus", "Bonus video", VIDEO_B)
        mk_quiz(db, seq_quiz, 4, "final", "Final check", [
            {
                "text": "What is 10 - 3?",
                "type": "numeric_answer", "correct_numeric": Decimal("7"), "precision": 0,
            },
            {
                "text": "Pick the largest.",
                "type": "single_choice",
                "options": [
                    {"text": "12", "correct": False},
                    {"text": "21", "correct": True},
                    {"text": "9", "correct": False},
                ],
            },
        ])

        db.add(StudentEnrollment(user_id=user.id, version_id=version.id, is_active=True))

        db.commit()
        print(f"Seeded course '{DEMO_SLUG}' (version_id={version.id}) and enrolled {DEV_EMAIL}.")
        # Quick summary
        seqs = {seq_intro.id: "Welcome", seq_video.id: "Watch & learn", seq_quiz.id: "Check your understanding"}
        for sid, name in seqs.items():
            items = db.execute(select(Item).where(Item.sequence_id == sid).order_by(Item.order)).scalars().all()
            print(f"  {name}: {', '.join(f'{i.order}.{i.type}' for i in items)}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
