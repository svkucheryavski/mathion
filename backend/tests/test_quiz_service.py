from decimal import Decimal

from mathion.quiz import evaluate_question


def test_single_choice_correct():
    result = evaluate_question(
        q_type="single_choice",
        student_answer=[3],
        correct_option_ids={3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is True


def test_single_choice_wrong():
    result = evaluate_question(
        q_type="single_choice",
        student_answer=[2],
        correct_option_ids={3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is False


def test_multiple_choice_correct():
    result = evaluate_question(
        q_type="multiple_choice",
        student_answer=[1, 3],
        correct_option_ids={1, 3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is True


def test_multiple_choice_partial():
    result = evaluate_question(
        q_type="multiple_choice",
        student_answer=[1],
        correct_option_ids={1, 3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is False


def test_multiple_choice_extra():
    result = evaluate_question(
        q_type="multiple_choice",
        student_answer=[1, 2, 3],
        correct_option_ids={1, 3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is False


def test_numeric_answer_correct():
    result = evaluate_question(
        q_type="numeric_answer",
        student_answer="2.0",
        correct_option_ids=set(),
        correct_numeric=Decimal("2.0"),
        precision=0,
        correct_text=None,
    )
    assert result is True


def test_numeric_answer_within_precision():
    result = evaluate_question(
        q_type="numeric_answer",
        student_answer="3.14",
        correct_option_ids=set(),
        correct_numeric=Decimal("3.14159"),
        precision=2,
        correct_text=None,
    )
    assert result is True


def test_numeric_answer_wrong():
    result = evaluate_question(
        q_type="numeric_answer",
        student_answer="5.0",
        correct_option_ids=set(),
        correct_numeric=Decimal("2.0"),
        precision=0,
        correct_text=None,
    )
    assert result is False


def test_numeric_answer_invalid_input():
    result = evaluate_question(
        q_type="numeric_answer",
        student_answer="not_a_number",
        correct_option_ids=set(),
        correct_numeric=Decimal("2.0"),
        precision=0,
        correct_text=None,
    )
    assert result is False


def test_text_answer_correct():
    result = evaluate_question(
        q_type="text_answer",
        student_answer="H2O",
        correct_option_ids=set(),
        correct_numeric=None,
        precision=None,
        correct_text="H2O",
    )
    assert result is True


def test_text_answer_case_insensitive():
    result = evaluate_question(
        q_type="text_answer",
        student_answer="  h2o  ",
        correct_option_ids=set(),
        correct_numeric=None,
        precision=None,
        correct_text="H2O",
    )
    assert result is True


def test_text_answer_wrong():
    result = evaluate_question(
        q_type="text_answer",
        student_answer="CO2",
        correct_option_ids=set(),
        correct_numeric=None,
        precision=None,
        correct_text="H2O",
    )
    assert result is False


def test_single_choice_multiple_ids_rejected():
    """Single choice with 2 option IDs should be False."""
    result = evaluate_question(
        q_type="single_choice",
        student_answer=[1, 2],
        correct_option_ids={1},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is False


def test_single_choice_empty_rejected():
    """Single choice with empty list should be False."""
    result = evaluate_question(
        q_type="single_choice",
        student_answer=[],
        correct_option_ids={1},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is False


def test_numeric_precision_zero_exact():
    """precision=0 means tolerance 0.5 — answer must be within ±0.5."""
    # 2.4 vs correct 2.0, diff 0.4 < 0.5 → correct
    result = evaluate_question(
        q_type="numeric_answer",
        student_answer="2.4",
        correct_option_ids=set(),
        correct_numeric=Decimal("2.0"),
        precision=0,
        correct_text=None,
    )
    assert result is True

    # 2.6 vs correct 2.0, diff 0.6 > 0.5 → wrong
    result2 = evaluate_question(
        q_type="numeric_answer",
        student_answer="2.6",
        correct_option_ids=set(),
        correct_numeric=Decimal("2.0"),
        precision=0,
        correct_text=None,
    )
    assert result2 is False


def test_multiple_choice_duplicate_ids_rejected():
    """Duplicate option IDs in multiple choice should be rejected."""
    result = evaluate_question(
        q_type="multiple_choice",
        student_answer=[1, 1, 3],
        correct_option_ids={1, 3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    )
    assert result is False
