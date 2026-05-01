"""phase7c recompute quiz scores

Revision ID: 3e7ba736bcd2
Revises: 9959211d94b5
Create Date: 2026-05-01 19:35:42.240147

Recompute UserItemState.last_score_correct and last_score_total under the new
option-level scoring rule (Phase 7c). Pure data migration — no schema change.
"""
import json
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '3e7ba736bcd2'
down_revision: Union[str, Sequence[str], None] = '9959211d94b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.phase7c")


def _coerce_answers(raw):
    """Normalize last_answers from raw SQL: SQLAlchemy's JSON type may surface
    as dict (e.g. with the ORM) or as a JSON string (raw SQL on SQLite). Returns
    a dict if parseable, else None."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
        except (ValueError, TypeError):
            return None
        return v if isinstance(v, dict) else None
    return None


def _new_score(q_type, answer, correct_ids, all_ids, correct_numeric, precision, correct_text):
    """Inline copy of evaluate_question to avoid coupling the migration to live code.
    Returns (correct_picks, total_correct)."""
    from decimal import Decimal, InvalidOperation
    if q_type == "single_choice":
        if not isinstance(answer, list) or len(answer) != 1:
            return (0, 1)
        return (1 if set(answer) == correct_ids else 0, 1)
    if q_type == "multiple_choice":
        total = len(correct_ids)
        if total == 0:
            return (0, 0)
        if not isinstance(answer, list) or len(answer) != len(set(answer)):
            return (0, total)
        picks = set(answer)
        correct_picks = len(picks & correct_ids)
        incorrect_picks = len(picks & (all_ids - correct_ids))
        return (max(0, correct_picks - incorrect_picks), total)
    if q_type == "numeric_answer":
        if correct_numeric is None or precision is None:
            return (0, 1)
        try:
            v = Decimal(str(answer))
        except (InvalidOperation, ValueError):
            return (0, 1)
        tol = Decimal(5) * Decimal(10) ** (-(precision + 1))
        return (1 if abs(v - correct_numeric) <= tol else 0, 1)
    if q_type == "text_answer":
        if correct_text is None:
            return (0, 1)
        return (1 if str(answer).strip().lower() == correct_text.strip().lower() else 0, 1)
    return (0, 0)


def _old_score(q_type, answer, correct_ids, correct_numeric, precision, correct_text):
    """Old whole-question rule. Used by downgrade()."""
    from decimal import Decimal, InvalidOperation
    if q_type == "single_choice":
        if not isinstance(answer, list) or len(answer) != 1:
            return False
        return set(answer) == correct_ids
    if q_type == "multiple_choice":
        if not isinstance(answer, list) or len(answer) != len(set(answer)):
            return False
        return set(answer) == correct_ids
    if q_type == "numeric_answer":
        if correct_numeric is None or precision is None:
            return False
        try:
            v = Decimal(str(answer))
        except (InvalidOperation, ValueError):
            return False
        tol = Decimal(5) * Decimal(10) ** (-(precision + 1))
        return abs(v - correct_numeric) <= tol
    if q_type == "text_answer":
        if correct_text is None:
            return False
        return str(answer).strip().lower() == correct_text.strip().lower()
    return False


def upgrade() -> None:
    bind = op.get_bind()
    states = bind.execute(sa.text("""
        SELECT s.id, s.item_id, s.last_answers
        FROM user_item_states s
        JOIN items i ON i.id = s.item_id
        WHERE s.last_answers IS NOT NULL AND i.type = 'quiz'
    """)).fetchall()

    recomputed = 0
    skipped = 0
    for s in states:
        try:
            answers = _coerce_answers(s.last_answers)
            if answers is None:
                skipped += 1
                continue
            qrows = bind.execute(sa.text("""
                SELECT id, type, correct_numeric, precision, correct_text
                FROM questions WHERE item_id = :iid
            """), {"iid": s.item_id}).fetchall()
            qmap = {str(q.id): q for q in qrows}
            sc, st = 0, 0
            ok = True
            for qid_str, ans in answers.items():
                if qid_str not in qmap:
                    ok = False
                    break
                q = qmap[qid_str]
                opts = bind.execute(sa.text("""
                    SELECT id, is_correct FROM answer_options WHERE question_id = :qid
                """), {"qid": q.id}).fetchall()
                all_ids = {o.id for o in opts}
                correct_ids = {o.id for o in opts if o.is_correct}
                picks, total = _new_score(q.type, ans, correct_ids, all_ids,
                                          q.correct_numeric, q.precision, q.correct_text)
                sc += picks
                st += total
            if not ok:
                logger.warning("Skipping state %d: last_answers references unknown question", s.id)
                skipped += 1
                continue
            bind.execute(sa.text("""
                UPDATE user_item_states SET last_score_correct = :sc, last_score_total = :st
                WHERE id = :id
            """), {"sc": sc, "st": st, "id": s.id})
            recomputed += 1
        except Exception:
            logger.exception("Skipping state %d due to unexpected error", s.id)
            skipped += 1
    logger.info("Phase 7c migration: recomputed %d rows, skipped %d", recomputed, skipped)


def downgrade() -> None:
    bind = op.get_bind()
    states = bind.execute(sa.text("""
        SELECT s.id, s.item_id, s.last_answers
        FROM user_item_states s
        JOIN items i ON i.id = s.item_id
        WHERE s.last_answers IS NOT NULL AND i.type = 'quiz'
    """)).fetchall()

    for s in states:
        try:
            answers = _coerce_answers(s.last_answers)
            if answers is None:
                continue
            qrows = bind.execute(sa.text("""
                SELECT id, type, correct_numeric, precision, correct_text
                FROM questions WHERE item_id = :iid
            """), {"iid": s.item_id}).fetchall()
            qmap = {str(q.id): q for q in qrows}
            sc, st = 0, len(qrows)
            ok = True
            for qid_str, ans in answers.items():
                if qid_str not in qmap:
                    ok = False
                    break
                q = qmap[qid_str]
                correct_ids = set()
                if q.type in ("single_choice", "multiple_choice"):
                    correct_ids = {r.id for r in bind.execute(sa.text(
                        "SELECT id FROM answer_options WHERE question_id = :qid AND is_correct = 1"
                    ), {"qid": q.id}).fetchall()}
                if _old_score(q.type, ans, correct_ids, q.correct_numeric, q.precision, q.correct_text):
                    sc += 1
            if not ok:
                continue
            bind.execute(sa.text("""
                UPDATE user_item_states SET last_score_correct = :sc, last_score_total = :st
                WHERE id = :id
            """), {"sc": sc, "st": st, "id": s.id})
        except Exception as e:
            logger.warning("Skipping state %d in downgrade: %s", s.id, e)
