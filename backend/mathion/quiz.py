import logging
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)


def evaluate_question(
    q_type: str,
    student_answer: list[int] | str,
    correct_option_ids: set[int],
    all_option_ids: set[int],
    correct_numeric: Decimal | None,
    precision: int | None,
    correct_text: str | None,
) -> tuple[int, int]:
    """Evaluate a single question answer.

    Returns (correct_picks_after_subtraction, total_correct_options).
    The denominator is the maximum possible score for the question:
      - 1 for single_choice / numeric_answer / text_answer
      - count(correct options) for multiple_choice
    For multi-choice, picks_in_correct_set minus picks_in_incorrect_set,
    floored at zero (strict subtraction prevents the "select all" exploit).
    """
    if q_type == "single_choice":
        # 1 correct option by definition. Picking it = 1, anything else = 0.
        if not isinstance(student_answer, list) or len(student_answer) != 1:
            return (0, 1)
        return (1 if set(student_answer) == correct_option_ids else 0, 1)

    if q_type == "multiple_choice":
        total = len(correct_option_ids)
        if total == 0:
            logger.warning("Question has no correct options; contributes (0, 0)")
            return (0, 0)
        if not isinstance(student_answer, list):
            return (0, total)
        if len(student_answer) != len(set(student_answer)):
            return (0, total)  # duplicate picks: malformed input
        picks = set(student_answer)
        correct_picks = len(picks & correct_option_ids)
        incorrect_picks = len(picks & (all_option_ids - correct_option_ids))
        return (max(0, correct_picks - incorrect_picks), total)

    if q_type == "numeric_answer":
        if correct_numeric is None or precision is None:
            return (0, 1)
        try:
            student_val = Decimal(str(student_answer))
        except (InvalidOperation, ValueError):
            return (0, 1)
        tolerance = Decimal(5) * Decimal(10) ** (-(precision + 1))
        return (1 if abs(student_val - correct_numeric) <= tolerance else 0, 1)

    if q_type == "text_answer":
        if correct_text is None:
            return (0, 1)
        match = str(student_answer).strip().lower() == correct_text.strip().lower()
        return (1 if match else 0, 1)

    return (0, 0)
