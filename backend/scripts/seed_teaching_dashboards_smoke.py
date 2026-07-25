"""Combined seed for the teacher dashboards smoke walkthrough.

First invokes Slice A's `seed_teaching_smoke.seed()` (drops-and-recreates the
base course/version/Intro block/2 runs), then layers dashboard entities on top.
The combined script is the full rebuild entry point and is idempotent across
reruns.

Usage:
    backend/.venv/bin/python -m scripts.seed_teaching_dashboards_smoke
"""
import os

from sqlalchemy import delete, select
from sqlalchemy.exc import NoResultFound

from mathion.database import SessionLocal
from mathion.models import (
    AnswerOption, Block, Course, Evaluation, Group, Item, MiniProject,
    Question, Run, RunStudent, Sequence, Submission,
)
from mathion.models_auth import User, UserItemState
from mathion.api.submission_files import build_feedback_filename, build_submission_filename, submission_storage_dir
from mathion.markdown import render_markdown
from scripts.seed_teaching_smoke import get_or_create_user, seed as seed_slice_a


def _get_or_create_group(db, run_id: int, name: str, is_disabled: bool) -> "Group":
    group = db.execute(
        select(Group).where(Group.run_id == run_id, Group.name == name)
    ).scalar_one_or_none()
    if group is None:
        group = Group(run_id=run_id, name=name, is_disabled=is_disabled)
        db.add(group)
        db.flush()
    return group


def _get_or_create_run_student(db, run_id: int, user_id: int, group_id) -> "RunStudent":
    rs = db.execute(
        select(RunStudent).where(
            RunStudent.run_id == run_id, RunStudent.user_id == user_id
        )
    ).scalar_one_or_none()
    if rs is None:
        rs = RunStudent(run_id=run_id, user_id=user_id, group_id=group_id)
        db.add(rs)
        db.flush()
    return rs


def _get_or_create_block(db, version_id: int, title: str, slug: str, order: int) -> "Block":
    block = db.execute(
        select(Block).where(Block.version_id == version_id, Block.slug == slug)
    ).scalar_one_or_none()
    if block is None:
        info = f"{title} block."
        block = Block(
            version_id=version_id,
            title=title,
            slug=slug,
            order=order,
            info=info,
            info_html=render_markdown(info),
        )
        db.add(block)
        db.flush()
    return block


def _get_or_create_sequence(db, block_id: int, title: str, slug: str, order: int) -> "Sequence":
    seq = db.execute(
        select(Sequence).where(Sequence.block_id == block_id, Sequence.slug == slug)
    ).scalar_one_or_none()
    if seq is None:
        seq = Sequence(block_id=block_id, title=title, slug=slug, order=order)
        db.add(seq)
        db.flush()
    return seq


def _get_or_create_item(db, sequence_id: int, title: str, slug: str, order: int, item_type: str) -> "Item":
    item = db.execute(
        select(Item).where(Item.sequence_id == sequence_id, Item.slug == slug)
    ).scalar_one_or_none()
    if item is None:
        item = Item(sequence_id=sequence_id, title=title, slug=slug, order=order, type=item_type)
        db.add(item)
        db.flush()
    return item


def _seed_quiz_item(db, item: "Item", num_questions: int) -> None:
    """Seed num_questions single_choice Questions on item, each with 4 AnswerOptions."""
    for q_ord in range(1, num_questions + 1):
        question = db.execute(
            select(Question).where(Question.item_id == item.id, Question.order == q_ord)
        ).scalar_one_or_none()
        if question is None:
            text_md = f"Question {q_ord} for {item.title}"
            question = Question(
                item_id=item.id,
                text_md=text_md,
                text_html=render_markdown(text_md),
                type="single_choice",
                order=q_ord,
            )
            db.add(question)
            db.flush()

        # Seed AnswerOptions if not already present
        existing_ao_count = db.execute(
            select(AnswerOption).where(AnswerOption.question_id == question.id)
        ).scalars().all()
        if not existing_ao_count:
            option_labels = ["A", "B", "C", "D"]
            for ao_ord, label in enumerate(option_labels, start=1):
                ao = AnswerOption(
                    question_id=question.id,
                    text=f"Option {label}",
                    is_correct=(ao_ord == 1),  # first option is correct
                    order=ao_ord,
                )
                db.add(ao)
            db.flush()


def _get_or_create_user_item_state(
    db,
    user_id: int,
    item_id: int,
    is_covered: bool,
    last_score_correct,
    last_score_total,
) -> "UserItemState":
    uis = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user_id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()
    if uis is None:
        uis = UserItemState(
            user_id=user_id,
            item_id=item_id,
            is_covered=is_covered,
            last_score_correct=last_score_correct,
            last_score_total=last_score_total,
        )
        db.add(uis)
        db.flush()
    else:
        uis.is_covered = is_covered
        uis.last_score_correct = last_score_correct
        uis.last_score_total = last_score_total
        db.flush()
    return uis


def _get_or_create_mini_project(db, run_id: int, block: "Block") -> "MiniProject":
    mp = db.execute(
        select(MiniProject).where(
            MiniProject.run_id == run_id,
            MiniProject.block_id == block.id,
        )
    ).scalar_one_or_none()
    if mp is None:
        assignment_md = f"Assignment for {block.title}."
        mp = MiniProject(
            run_id=run_id,
            block_id=block.id,
            assignment_md=assignment_md,
            assignment_html=render_markdown(assignment_md),
            is_published=True,
        )
        db.add(mp)
        db.flush()
    return mp


def _get_or_create_submission(
    db,
    mini_project_id: int,
    group_id: int,
    submission_number: int,
    submitted_by: int,
    file_path: str,
    file_size: int,
    is_resubmission: bool = False,
    is_late: bool = False,
) -> "Submission":
    sub = db.execute(
        select(Submission).where(
            Submission.mini_project_id == mini_project_id,
            Submission.group_id == group_id,
            Submission.submission_number == submission_number,
        )
    ).scalar_one_or_none()
    if sub is None:
        sub = Submission(
            mini_project_id=mini_project_id,
            group_id=group_id,
            submission_number=submission_number,
            submitted_by=submitted_by,
            file_path=file_path,
            file_size=file_size,
            is_resubmission=is_resubmission,
            is_late=is_late,
        )
        db.add(sub)
        db.flush()
    return sub


def _get_or_create_evaluation(
    db,
    submission_id: int,
    evaluated_by: int,
    result: str,
    score,
    feedback_file,
) -> "Evaluation":
    ev = db.execute(
        select(Evaluation).where(Evaluation.submission_id == submission_id)
    ).scalar_one_or_none()
    if ev is None:
        ev = Evaluation(
            submission_id=submission_id,
            evaluated_by=evaluated_by,
            result=result,
            score=score,
            feedback_file=feedback_file,
        )
        db.add(ev)
        db.flush()
    return ev


def seed() -> None:
    # Pre-cleanup: Slice A's seed deletes runs via ORM cascade through
    # Run.groups (cascade="all, delete-orphan"), but Submission.group_id is
    # DB-level ondelete="RESTRICT" (models.py:306). On rerun the dashboards
    # seed's Submissions would block Slice A's Group deletion. Wipe the
    # dashboards-owned MiniProjects first — DB-level CASCADE clears
    # Submissions + Evaluations — so Slice A's cascade can proceed cleanly.
    cleanup_db = SessionLocal()
    try:
        existing = cleanup_db.execute(
            select(Course).where(Course.slug == "teaching-smoke-101")
        ).scalar_one_or_none()
        if existing is not None:
            run_ids = [
                r.id
                for v in existing.versions
                for r in cleanup_db.execute(
                    select(Run).where(Run.version_id == v.id)
                ).scalars()
            ]
            if run_ids:
                cleanup_db.execute(
                    delete(MiniProject).where(MiniProject.run_id.in_(run_ids))
                )
                cleanup_db.commit()
    finally:
        cleanup_db.close()

    # Slice A's seed opens its own SessionLocal, commits, and closes
    # (drops-and-recreates teaching-smoke-101 every run); the dashboards
    # seed then re-acquires Slice A's entities below in a fresh session.
    seed_slice_a()

    db = SessionLocal()
    try:
        # ------------------------------------------------------------------ #
        # Step 0: re-acquire Slice A's entities (in a fresh session)
        # ------------------------------------------------------------------ #
        try:
            course = db.execute(
                select(Course).where(Course.slug == "teaching-smoke-101")
            ).scalar_one()
        except NoResultFound:
            raise RuntimeError(
                "teaching-smoke-101 course not found after Slice A "
                "seed_teaching_smoke.seed() ran — Slice A's seed may have "
                "failed silently or its contract has drifted."
            )
        version = course.versions[0]
        intro_block = next(b for b in version.blocks if b.slug == "intro")
        spring = db.execute(
            select(Run).where(Run.version_id == version.id, Run.title == "Spring 2026")
        ).scalar_one()
        fall = db.execute(
            select(Run).where(Run.version_id == version.id, Run.title == "Fall 2026")
        ).scalar_one()

        # Also fetch admin for use as evaluator
        admin = db.execute(
            select(User).where(User.email == "admin@mathion.test")
        ).scalar_one()

        # ------------------------------------------------------------------ #
        # Step 1: 6 student users (5 enabled + student6 disabled)
        # ------------------------------------------------------------------ #
        student1 = get_or_create_user(db, "student1@mathion.test", "Student One")
        student2 = get_or_create_user(db, "student2@mathion.test", "Student Two")
        student3 = get_or_create_user(db, "student3@mathion.test", "Student Three")
        student4 = get_or_create_user(db, "student4@mathion.test", "Student Four")
        student5 = get_or_create_user(db, "student5@mathion.test", "Student Five")
        student6 = get_or_create_user(db, "student6@mathion.test", "Student Six")
        student6.is_disabled = True
        db.flush()

        # ------------------------------------------------------------------ #
        # Step 2: 3 Groups on Spring (A, B not disabled; C disabled)
        # ------------------------------------------------------------------ #
        group_a = _get_or_create_group(db, spring.id, "Group A", is_disabled=False)
        group_b = _get_or_create_group(db, spring.id, "Group B", is_disabled=False)
        group_c = _get_or_create_group(db, spring.id, "Group C", is_disabled=True)

        # ------------------------------------------------------------------ #
        # Step 3: 6 RunStudent rows on Spring
        # ------------------------------------------------------------------ #
        _get_or_create_run_student(db, spring.id, student1.id, group_a.id)
        _get_or_create_run_student(db, spring.id, student2.id, group_a.id)
        _get_or_create_run_student(db, spring.id, student3.id, group_b.id)
        _get_or_create_run_student(db, spring.id, student4.id, group_b.id)
        _get_or_create_run_student(db, spring.id, student5.id, group_c.id)
        _get_or_create_run_student(db, spring.id, student6.id, None)  # ungrouped

        # ------------------------------------------------------------------ #
        # Step 4: 5 additional Blocks on the version (direct ORM)
        # ------------------------------------------------------------------ #
        block_lr = _get_or_create_block(db, version.id, "Linear regression", "linear-regression", 2)
        block_mv = _get_or_create_block(db, version.id, "Multivariate", "multivariate", 3)
        block_dg = _get_or_create_block(db, version.id, "Diagnostics", "diagnostics", 4)
        block_ts = _get_or_create_block(db, version.id, "Time series", "time-series", 5)
        block_cp = _get_or_create_block(db, version.id, "Capstone", "capstone", 6)

        # ------------------------------------------------------------------ #
        # Step 5: 3 Sequences on Intro block
        # ------------------------------------------------------------------ #
        seq_est = _get_or_create_sequence(db, intro_block.id, "Estimation", "estimation", 1)
        seq_prac = _get_or_create_sequence(db, intro_block.id, "Practice", "practice", 2)
        seq_wrap = _get_or_create_sequence(db, intro_block.id, "Wrap-up", "wrap-up", 3)

        # ------------------------------------------------------------------ #
        # Step 6: Items + Questions + AnswerOptions
        # ------------------------------------------------------------------ #
        # Sequence 1 "Estimation": 4 items (2 static_page + 2 quiz with 8 Qs each)
        est1 = _get_or_create_item(db, seq_est.id, "Estimation Part 1", "est-1", 1, "static_page")
        est2 = _get_or_create_item(db, seq_est.id, "Estimation Quiz 1", "est-2", 2, "quiz")
        est3 = _get_or_create_item(db, seq_est.id, "Estimation Part 2", "est-3", 3, "static_page")
        est4 = _get_or_create_item(db, seq_est.id, "Estimation Quiz 2", "est-4", 4, "quiz")
        _seed_quiz_item(db, est2, 8)
        _seed_quiz_item(db, est4, 8)

        # Sequence 2 "Practice": 3 items (1 video + 2 quiz with 5 Qs each)
        prac1 = _get_or_create_item(db, seq_prac.id, "Practice Video", "prac-1", 1, "video")
        prac2 = _get_or_create_item(db, seq_prac.id, "Practice Quiz 1", "prac-2", 2, "quiz")
        prac3 = _get_or_create_item(db, seq_prac.id, "Practice Quiz 2", "prac-3", 3, "quiz")
        _seed_quiz_item(db, prac2, 5)
        _seed_quiz_item(db, prac3, 5)

        # Sequence 3 "Wrap-up": 2 items (2 static_page, no quiz)
        wrap1 = _get_or_create_item(db, seq_wrap.id, "Wrap-up Reading", "wrap-1", 1, "static_page")
        wrap2 = _get_or_create_item(db, seq_wrap.id, "Wrap-up Summary", "wrap-2", 2, "static_page")

        # Collect all items for UserItemState seeding
        all_items = [est1, est2, est3, est4, prac1, prac2, prac3, wrap1, wrap2]

        # Map item -> quiz score total (None = not a quiz)
        quiz_totals = {
            est1.id: None,
            est2.id: 8,
            est3.id: None,
            est4.id: 8,
            prac1.id: None,
            prac2.id: 5,
            prac3.id: 5,
            wrap1.id: None,
            wrap2.id: None,
        }

        # ------------------------------------------------------------------ #
        # Step 7: UserItemState rows with 6-student variety
        # ------------------------------------------------------------------ #

        # student1: fully covered + perfect quizzes
        for it in all_items:
            qt = quiz_totals[it.id]
            _get_or_create_user_item_state(
                db, student1.id, it.id,
                is_covered=True,
                last_score_correct=qt,
                last_score_total=qt,
            )

        # student2: partial coverage (~half items), low quiz scores
        # Cover: est1, est2, est3 (skip est4); prac1 (skip prac2, prac3); wrap1 (skip wrap2)
        covered_student2 = {est1.id, est2.id, est3.id, prac1.id, wrap1.id}
        for it in all_items:
            if it.id in covered_student2:
                qt = quiz_totals[it.id]
                if qt is not None:
                    correct = qt // 2  # ~half score
                    total = qt
                else:
                    correct = None
                    total = None
                _get_or_create_user_item_state(
                    db, student2.id, it.id,
                    is_covered=True,
                    last_score_correct=correct,
                    last_score_total=total,
                )

        # student3: NO UserItemState rows at all (exercises §5.1 default)
        # (nothing to insert)

        # student4: covered but no quiz attempts (is_covered=True, scores=None)
        for it in all_items:
            _get_or_create_user_item_state(
                db, student4.id, it.id,
                is_covered=True,
                last_score_correct=None,
                last_score_total=None,
            )

        # student5: mixed — full coverage on Estimation, no coverage on Practice/Wrap-up
        # (exercises mix between student1 and student2)
        covered_student5 = {est1.id, est2.id, est3.id, est4.id}
        for it in all_items:
            if it.id in covered_student5:
                qt = quiz_totals[it.id]
                if qt is not None:
                    # Partial score on Estimation quizzes
                    correct = qt * 3 // 4
                    total = qt
                else:
                    correct = None
                    total = None
                _get_or_create_user_item_state(
                    db, student5.id, it.id,
                    is_covered=True,
                    last_score_correct=correct,
                    last_score_total=total,
                )

        # student6: fully covered + perfect quizzes (disabled user, historical rows remain)
        for it in all_items:
            qt = quiz_totals[it.id]
            _get_or_create_user_item_state(
                db, student6.id, it.id,
                is_covered=True,
                last_score_correct=qt,
                last_score_total=qt,
            )

        # ------------------------------------------------------------------ #
        # Step 8: 5 MiniProjects on Spring (one per non-Intro block)
        # ------------------------------------------------------------------ #
        mp1 = _get_or_create_mini_project(db, spring.id, block_lr)
        mp2 = _get_or_create_mini_project(db, spring.id, block_mv)
        mp3 = _get_or_create_mini_project(db, spring.id, block_dg)
        mp4 = _get_or_create_mini_project(db, spring.id, block_ts)
        mp5 = _get_or_create_mini_project(db, spring.id, block_cp)

        # ------------------------------------------------------------------ #
        # Step 9: Submissions + Evaluations per the (MP × group) matrix
        # ------------------------------------------------------------------ #
        # MP1: all groups not_submitted → no submissions
        # (nothing to insert)

        # MP2/A: 1 Submission, no Evaluation → awaiting_eval
        _get_or_create_submission(
            db,
            mini_project_id=mp2.id,
            group_id=group_a.id,
            submission_number=1,
            submitted_by=student1.id,
            file_path=build_submission_filename(block_mv.order, group_a.name, 1),
            file_size=1024,
        )

        # MP2/B: a rejected-then-resubmitted thread — #1 evaluated "rejected"
        # (with a feedback file), then #2 a FRESH initial submission. Per the
        # submit gate (submissions.py: latest_result == "rejected" ->
        # is_resubmission=False), a submission after a rejection is treated as
        # a fresh initial submission, NOT an auto-accepted resubmission, so it
        # stays manually evaluable. #2 is left un-evaluated → the panel shows
        # the write form on the newest entry while #1 remains an expandable
        # read-only history entry (exercises expand-survives-write).
        sub_mp2_b1 = _get_or_create_submission(
            db,
            mini_project_id=mp2.id,
            group_id=group_b.id,
            submission_number=1,
            submitted_by=student3.id,
            file_path=build_submission_filename(block_mv.order, group_b.name, 1),
            file_size=1024,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp2_b1.id,
            evaluated_by=admin.id,
            result="rejected",
            score=None,
            feedback_file=build_feedback_filename(block_mv.order, group_b.name, 1),
        )
        _get_or_create_submission(
            db,
            mini_project_id=mp2.id,
            group_id=group_b.id,
            submission_number=2,
            submitted_by=student3.id,
            file_path=build_submission_filename(block_mv.order, group_b.name, 2),
            file_size=1024,
            is_resubmission=False,  # fresh initial submission after a rejection
        )

        # MP2/C: 1 Submission, no Evaluation → awaiting_eval
        _get_or_create_submission(
            db,
            mini_project_id=mp2.id,
            group_id=group_c.id,
            submission_number=1,
            submitted_by=student5.id,
            file_path=build_submission_filename(block_mv.order, group_c.name, 1),
            file_size=1024,
        )

        # MP3/A: 1 Submission + 1 Evaluation result="major_revision" → needs_revision
        sub_mp3_a = _get_or_create_submission(
            db,
            mini_project_id=mp3.id,
            group_id=group_a.id,
            submission_number=1,
            submitted_by=student1.id,
            file_path=build_submission_filename(block_dg.order, group_a.name, 1),
            file_size=1024,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp3_a.id,
            evaluated_by=admin.id,
            result="major_revision",
            score=None,
            feedback_file=build_feedback_filename(block_dg.order, group_a.name, 1),
        )

        # MP3/B: 1 Submission + 1 Evaluation result="accepted", score=95 → accepted
        sub_mp3_b = _get_or_create_submission(
            db,
            mini_project_id=mp3.id,
            group_id=group_b.id,
            submission_number=1,
            submitted_by=student3.id,
            file_path=build_submission_filename(block_dg.order, group_b.name, 1),
            file_size=1024,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp3_b.id,
            evaluated_by=admin.id,
            result="accepted",
            score=95,
            feedback_file=None,
        )

        # MP3/C: 1 Submission, no Evaluation → awaiting_eval
        _get_or_create_submission(
            db,
            mini_project_id=mp3.id,
            group_id=group_c.id,
            submission_number=1,
            submitted_by=student5.id,
            file_path=build_submission_filename(block_dg.order, group_c.name, 1),
            file_size=1024,
        )

        # MP4/A: 1 Submission + 1 Evaluation result="accepted", score=88 → accepted
        sub_mp4_a = _get_or_create_submission(
            db,
            mini_project_id=mp4.id,
            group_id=group_a.id,
            submission_number=1,
            submitted_by=student1.id,
            file_path=build_submission_filename(block_ts.order, group_a.name, 1),
            file_size=1024,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp4_a.id,
            evaluated_by=admin.id,
            result="accepted",
            score=88,
            feedback_file=None,
        )

        # MP4/B: 1 Submission + 1 Evaluation result="rejected", score=40 → rejected
        sub_mp4_b = _get_or_create_submission(
            db,
            mini_project_id=mp4.id,
            group_id=group_b.id,
            submission_number=1,
            submitted_by=student3.id,
            file_path=build_submission_filename(block_ts.order, group_b.name, 1),
            file_size=1024,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp4_b.id,
            evaluated_by=admin.id,
            result="rejected",
            score=40,
            feedback_file=build_feedback_filename(block_ts.order, group_b.name, 1),
        )

        # MP4/C: 1 Submission + 1 Evaluation result="accepted" → accepted
        sub_mp4_c = _get_or_create_submission(
            db,
            mini_project_id=mp4.id,
            group_id=group_c.id,
            submission_number=1,
            submitted_by=student5.id,
            file_path=build_submission_filename(block_ts.order, group_c.name, 1),
            file_size=1024,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp4_c.id,
            evaluated_by=admin.id,
            result="accepted",
            score=None,
            feedback_file=None,
        )

        # MP5/A: 1 Submission, no Evaluation → awaiting_eval
        _get_or_create_submission(
            db,
            mini_project_id=mp5.id,
            group_id=group_a.id,
            submission_number=1,
            submitted_by=student1.id,
            file_path=build_submission_filename(block_cp.order, group_a.name, 1),
            file_size=1024,
        )

        # MP5/B: a realistic 2-submission resubmission thread — #1 evaluated
        # "major_revision" (needs revision, with a feedback file), then #2 the
        # resubmission evaluated "accepted". This mirrors the real submit API:
        # a resubmission (is_resubmission=True) is only allowed AFTER a
        # needs-revision evaluation (submissions.py), never over a still-pending
        # submission.
        sub_mp5_b1 = _get_or_create_submission(
            db,
            mini_project_id=mp5.id,
            group_id=group_b.id,
            submission_number=1,
            submitted_by=student3.id,
            file_path=build_submission_filename(block_cp.order, group_b.name, 1),
            file_size=1024,
            is_resubmission=False,
            is_late=False,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp5_b1.id,
            evaluated_by=admin.id,
            result="major_revision",
            score=None,
            feedback_file=build_feedback_filename(block_cp.order, group_b.name, 1),
        )
        sub_mp5_b2 = _get_or_create_submission(
            db,
            mini_project_id=mp5.id,
            group_id=group_b.id,
            submission_number=2,
            submitted_by=student3.id,
            file_path=build_submission_filename(block_cp.order, group_b.name, 2),
            file_size=1024,
            is_resubmission=True,
            is_late=True,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp5_b2.id,
            evaluated_by=admin.id,
            result="accepted",
            score=None,
            feedback_file=None,
        )

        # MP5/C: 1 Submission + 1 Evaluation result="minor_revision" → needs_revision
        sub_mp5_c = _get_or_create_submission(
            db,
            mini_project_id=mp5.id,
            group_id=group_c.id,
            submission_number=1,
            submitted_by=student5.id,
            file_path=build_submission_filename(block_cp.order, group_c.name, 1),
            file_size=1024,
        )
        _get_or_create_evaluation(
            db,
            submission_id=sub_mp5_c.id,
            evaluated_by=admin.id,
            result="minor_revision",
            score=None,
            feedback_file=build_feedback_filename(block_cp.order, group_c.name, 1),
        )

        # ------------------------------------------------------------------ #
        # Step 10: Placeholder PDF files on disk
        # ------------------------------------------------------------------ #
        # All submissions and non-null evaluation feedback files share the same
        # per-(run, group) directory (submission_storage_dir).
        # Collect all submissions in this seeded run.
        all_submissions = db.execute(
            select(Submission).where(
                Submission.mini_project_id.in_(
                    [mp1.id, mp2.id, mp3.id, mp4.id, mp5.id]
                )
            )
        ).scalars().all()

        for sub in all_submissions:
            abs_dir = submission_storage_dir(spring.id, sub.group_id)
            os.makedirs(abs_dir, exist_ok=True)
            with open(os.path.join(abs_dir, sub.file_path), "wb") as f:
                f.write(b"%PDF-1.4\n")

        # Also write feedback files for non-null evaluation feedback_file
        all_evaluations = db.execute(
            select(Evaluation).where(
                Evaluation.submission_id.in_([s.id for s in all_submissions])
            )
        ).scalars().all()

        for ev in all_evaluations:
            if ev.feedback_file is not None:
                sub = db.get(Submission, ev.submission_id)
                abs_dir = submission_storage_dir(spring.id, sub.group_id)
                os.makedirs(abs_dir, exist_ok=True)
                with open(os.path.join(abs_dir, ev.feedback_file), "wb") as f:
                    f.write(b"%PDF-1.4\n")

        # ------------------------------------------------------------------ #
        # Step 11: Patch Fall 2026 → groups_enabled=False
        # ------------------------------------------------------------------ #
        fall.groups_enabled = False
        db.flush()

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
    print("Teacher dashboards smoke seed complete.")
