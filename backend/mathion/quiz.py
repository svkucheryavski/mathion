from decimal import Decimal, InvalidOperation


def evaluate_question(
    q_type: str,
    student_answer: list[int] | str,
    correct_option_ids: set[int],
    correct_numeric: Decimal | None,
    precision: int | None,
    correct_text: str | None,
) -> bool:
    """Evaluate a single question answer. Returns True if correct."""
    if q_type in ("single_choice", "multiple_choice"):
        return set(student_answer) == correct_option_ids

    if q_type == "numeric_answer":
        if correct_numeric is None or precision is None:
            return False
        try:
            student_val = Decimal(str(student_answer))
        except (InvalidOperation, ValueError):
            return False
        tolerance = Decimal(10) ** (-precision)
        return abs(student_val - correct_numeric) <= tolerance

    if q_type == "text_answer":
        if correct_text is None:
            return False
        return str(student_answer).strip().lower() == correct_text.strip().lower()

    return False
