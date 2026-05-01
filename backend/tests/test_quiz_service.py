from decimal import Decimal

from mathion.quiz import evaluate_question


def test_single_choice_correct():
    assert evaluate_question(
        q_type="single_choice",
        student_answer=[3],
        correct_option_ids={3},
        all_option_ids={1, 2, 3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (1, 1)


def test_single_choice_wrong():
    assert evaluate_question(
        q_type="single_choice",
        student_answer=[2],
        correct_option_ids={3},
        all_option_ids={1, 2, 3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (0, 1)


def test_single_choice_no_answer():
    assert evaluate_question(
        q_type="single_choice",
        student_answer=[],
        correct_option_ids={3},
        all_option_ids={1, 2, 3},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (0, 1)


def test_multiple_choice_exact_match():
    assert evaluate_question(
        q_type="multiple_choice",
        student_answer=[1, 3],
        correct_option_ids={1, 3},
        all_option_ids={1, 2, 3, 4},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (2, 2)


def test_multiple_choice_one_of_two_correct():
    assert evaluate_question(
        q_type="multiple_choice",
        student_answer=[1],
        correct_option_ids={1, 3},
        all_option_ids={1, 2, 3, 4},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (1, 2)


def test_multiple_choice_one_right_one_wrong():
    assert evaluate_question(
        q_type="multiple_choice",
        student_answer=[1, 2],
        correct_option_ids={1, 3},
        all_option_ids={1, 2, 3, 4},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (0, 2)


def test_multiple_choice_select_all_exploit_blocked():
    assert evaluate_question(
        q_type="multiple_choice",
        student_answer=[1, 2, 3, 4],
        correct_option_ids={1, 3},
        all_option_ids={1, 2, 3, 4},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (0, 2)


def test_multiple_choice_no_answer():
    assert evaluate_question(
        q_type="multiple_choice",
        student_answer=[],
        correct_option_ids={1, 3},
        all_option_ids={1, 2, 3, 4},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (0, 2)


def test_numeric_within_tolerance():
    assert evaluate_question(
        q_type="numeric_answer",
        student_answer="3.14",
        correct_option_ids=set(),
        all_option_ids=set(),
        correct_numeric=Decimal("3.14"),
        precision=2,
        correct_text=None,
    ) == (1, 1)


def test_numeric_outside_tolerance():
    assert evaluate_question(
        q_type="numeric_answer",
        student_answer="3.20",
        correct_option_ids=set(),
        all_option_ids=set(),
        correct_numeric=Decimal("3.14"),
        precision=2,
        correct_text=None,
    ) == (0, 1)


def test_text_match_case_insensitive():
    assert evaluate_question(
        q_type="text_answer",
        student_answer="Hello",
        correct_option_ids=set(),
        all_option_ids=set(),
        correct_numeric=None,
        precision=None,
        correct_text="hello",
    ) == (1, 1)


def test_text_mismatch():
    assert evaluate_question(
        q_type="text_answer",
        student_answer="world",
        correct_option_ids=set(),
        all_option_ids=set(),
        correct_numeric=None,
        precision=None,
        correct_text="hello",
    ) == (0, 1)


def test_question_with_zero_correct_options():
    # Defensive: malformed multi-choice with no correct options. Contributes nothing.
    assert evaluate_question(
        q_type="multiple_choice",
        student_answer=[1],
        correct_option_ids=set(),
        all_option_ids={1, 2},
        correct_numeric=None,
        precision=None,
        correct_text=None,
    ) == (0, 0)
