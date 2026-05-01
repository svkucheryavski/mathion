# Phase 7c — Teacher Progress Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two run-scoped teacher dashboard endpoints (`/dashboard/progress` and `/dashboard/mini-projects`) plus the prerequisite quiz scoring redefinition (option-level partial credit with strict subtraction).

**Architecture:** New `mathion/api/dashboard.py` router with two GET endpoints; on-demand SQL aggregation, no caching, no pagination. `evaluate_question` in `mathion/quiz.py` changes return type from `bool` to `tuple[int, int]`. One-time data-only Alembic migration recomputes `UserItemState.last_score_correct/total` under the new rule. Backend ships JSON; frontend handles CSV later.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Alembic, pytest. SQLite in tests, design works on Postgres.

**Spec:** `docs/superpowers/specs/2026-05-01-phase7c-dashboards-design.md` (commit `bb9135f`).

---

## File Structure

**New:**
- `mathion/api/dashboard.py` — two endpoint handlers + helpers, ~250 lines
- `tests/test_dashboard_progress.py` — auth, shape, math, edge cases
- `tests/test_dashboard_mini_projects.py` — auth, shape, status enum, edge cases
- `tests/test_migration_phase7c.py` — fixture under old rule, run upgrade, verify recompute
- `alembic/versions/<ts>_phase7c_recompute_quiz_scores.py` — data-only migration

**Modified:**
- `mathion/quiz.py` — `evaluate_question` returns `tuple[int, int]`
- `mathion/api/quiz.py` — `submit_quiz` updated for new scorer signature
- `mathion/schemas.py` — add Pydantic response models for both endpoints
- `mathion/main.py` — register dashboard router, add `GZipMiddleware`
- `tests/test_quiz_service.py` — rewritten for tuple return
- `tests/test_quiz_api.py` — adjusted for new `last_score_*` semantics

---

## Task 1: Redefine `evaluate_question` to return `(int, int)`

**Files:**
- Modify: `mathion/quiz.py`
- Modify: `tests/test_quiz_service.py`

- [ ] **Step 1: Rewrite the unit tests for tuple return**

Replace the entire body of `tests/test_quiz_service.py` with:

```python
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
```

- [ ] **Step 2: Run the tests — they all fail with current bool-returning scorer**

Run: `cd backend && pytest tests/test_quiz_service.py -v`
Expected: FAIL — most tests fail because `True/False != (1, 1)/(0, 1)` and the new `all_option_ids` parameter is unknown.

- [ ] **Step 3: Rewrite `evaluate_question` to return `tuple[int, int]`**

Replace the contents of `mathion/quiz.py` with:

```python
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
```

- [ ] **Step 4: Run tests — all pass**

Run: `cd backend && pytest tests/test_quiz_service.py -v`
Expected: PASS — 13 tests pass.

- [ ] **Step 5: Commit**

```bash
cd backend && git add tests/test_quiz_service.py mathion/quiz.py
git commit -m "feat(phase7c): evaluate_question returns (correct_picks, total_correct) for option-level scoring"
```

---

## Task 2: Update `submit_quiz` caller for new scorer signature

**Files:**
- Modify: `mathion/api/quiz.py:94-150` (the `submit_quiz` body)
- Modify: `tests/test_quiz_api.py` (existing assertions on `score_correct/total`)

- [ ] **Step 1: Read the current `submit_quiz` code and the existing API tests**

Open `mathion/api/quiz.py` lines 94-150 and `tests/test_quiz_api.py` to identify all assertions touching `score_correct`, `score_total`, `last_score_correct`, `last_score_total`. Note that single-choice / numeric / text questions still produce 0|1 of 1, so existing assertions on those question types don't need to change in *value* — only in *interpretation* (now it's option-level, but for these types options-per-question is 1, so identical).

The test fixture in `_setup_quiz` (one single-choice + one numeric question) means the legacy test asserts values like `score_correct=2, score_total=2` for full credit. Under new semantics: still `(2, 2)` because single-choice contributes (0|1, 1) and numeric contributes (0|1, 1). So most existing tests need NO change — just verify.

- [ ] **Step 2: Add a new test that exercises the multi-choice partial-credit path**

Add to `tests/test_quiz_api.py` (after the existing tests):

```python
def test_submit_quiz_multi_choice_partial_credit(admin_client, db):
    """Multi-choice partial credit: 1 of 2 correct picks → score_correct=1, score_total=2."""
    from mathion.auth import request_pin, verify_pin
    from mathion.models_auth import StudentEnrollment, User

    course = admin_client.post("/api/courses", json={"slug": "mc", "name": "MC", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Q", "slug": "q", "type": "quiz",
    }).json()

    q = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "pick 2", "type": "multiple_choice",
    }).json()
    o1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "a", "is_correct": True}).json()
    o2 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "b", "is_correct": False}).json()
    o3 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "c", "is_correct": True}).json()
    o4 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "d", "is_correct": False}).json()

    admin_client.post(f"/api/versions/{version['id']}/publish")

    student = User(email="mc@example.com", full_name="MC Student")
    db.add(student)
    db.commit()
    db.add(StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True))
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    from fastapi.testclient import TestClient
    from mathion.main import app

    sc = TestClient(app)
    sc.cookies.set("session_token", token)
    sc.headers.update({"X-Requested-With": "mathion"})

    # Pick 1 of 2 correct + 0 wrong → 1/2 (option-level)
    r = sc.post(f"/api/items/{item['id']}/submit", json={"answers": {str(q["id"]): [o1["id"]]}})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["score_correct"] == 1
    assert body["score_total"] == 2


def test_submit_quiz_multi_choice_select_all_zero(admin_client, db):
    """Multi-choice select-all exploit: max(0, 2-2)=0/2."""
    from mathion.auth import request_pin, verify_pin
    from mathion.models_auth import StudentEnrollment, User

    course = admin_client.post("/api/courses", json={"slug": "ex", "name": "Ex", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Q", "slug": "q", "type": "quiz"}).json()

    q = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "pick 2", "type": "multiple_choice",
    }).json()
    o1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "a", "is_correct": True}).json()
    o2 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "b", "is_correct": False}).json()
    o3 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "c", "is_correct": True}).json()
    o4 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "d", "is_correct": False}).json()

    admin_client.post(f"/api/versions/{version['id']}/publish")

    student = User(email="ex@example.com", full_name="Ex Student")
    db.add(student)
    db.commit()
    db.add(StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True))
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    from fastapi.testclient import TestClient
    from mathion.main import app

    sc = TestClient(app)
    sc.cookies.set("session_token", token)
    sc.headers.update({"X-Requested-With": "mathion"})

    r = sc.post(f"/api/items/{item['id']}/submit",
                json={"answers": {str(q["id"]): [o1["id"], o2["id"], o3["id"], o4["id"]]}})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["score_correct"] == 0
    assert body["score_total"] == 2
```

- [ ] **Step 2b: Run the new tests — they fail (caller still uses old scorer)**

Run: `cd backend && pytest tests/test_quiz_api.py::test_submit_quiz_multi_choice_partial_credit tests/test_quiz_api.py::test_submit_quiz_multi_choice_select_all_zero -v`
Expected: FAIL — caller in `submit_quiz` still calls `evaluate_question` expecting bool.

- [ ] **Step 3: Update `submit_quiz` to use new scorer**

In `mathion/api/quiz.py`, replace the loop at approximately lines 94-117 (the `# Evaluate each question` block) with:

```python
    # Evaluate each question — option-level scoring (Phase 7c)
    score_correct = 0
    score_total = 0
    for q in questions:
        student_answer = data.answers[str(q.id)]

        correct_ids: set[int] = set()
        all_ids: set[int] = set()
        if q.type in ("single_choice", "multiple_choice"):
            rows = db.execute(
                select(AnswerOption.id, AnswerOption.is_correct).where(
                    AnswerOption.question_id == q.id,
                )
            ).all()
            all_ids = {r.id for r in rows}
            correct_ids = {r.id for r in rows if r.is_correct}

        picks, total = evaluate_question(
            q_type=q.type,
            student_answer=student_answer,
            correct_option_ids=correct_ids,
            all_option_ids=all_ids,
            correct_numeric=q.correct_numeric,
            precision=q.precision,
            correct_text=q.correct_text,
        )
        score_correct += picks
        score_total += total
```

Also import the scorer at the top: it's already imported as `from mathion.quiz import evaluate_question`.

Then replace the atomic update at approximately lines 119-134:

```python
    # Atomic increment: only succeeds if attempt_count < max_attempts
    rows_updated = db.execute(
        update(UserItemState)
        .where(
            UserItemState.id == state.id,
            UserItemState.attempt_count < max_attempts,
        )
        .values(
            attempt_count=UserItemState.attempt_count + 1,
            last_answers=dict(data.answers),
            last_score_correct=score_correct,
            last_score_total=score_total,
            last_visited_at=datetime.now(timezone.utc),
            is_covered=True,
        )
    ).rowcount
```

And the response at approximately line 143-150:

```python
    return QuizSubmitResponse(
        item_id=item_id,
        attempt_count=state.attempt_count,
        max_attempts=max_attempts,
        score_correct=score_correct,
        score_total=score_total,
        can_retry=state.attempt_count < max_attempts,
    )
```

(Field names unchanged in the response model — only the *meaning* of the values changes to option-level.)

- [ ] **Step 4: Run quiz API tests — all pass (existing + new)**

Run: `cd backend && pytest tests/test_quiz_api.py -v`
Expected: PASS — both new partial-credit tests pass; existing tests still pass because their fixtures only exercise single-choice + numeric questions, which produce identical numbers under new and old semantics.

- [ ] **Step 5: Commit**

```bash
cd backend && git add mathion/api/quiz.py tests/test_quiz_api.py
git commit -m "feat(phase7c): submit_quiz uses option-level scoring (partial credit + strict subtraction)"
```

---

## Task 3: Alembic data migration to recompute existing rows

**Files:**
- Create: `alembic/versions/<timestamp>_phase7c_recompute_quiz_scores.py`
- Create: `tests/test_migration_phase7c.py`

- [ ] **Step 1: Generate the migration skeleton**

Run: `cd backend && alembic revision -m "phase7c recompute quiz scores"`
This creates a file like `alembic/versions/abc123def456_phase7c_recompute_quiz_scores.py`. Note the revision hash; it auto-fills `down_revision` to the current head (`9959211d94b5`).

- [ ] **Step 2: Replace the migration body with recompute logic**

Open the new file and replace its body with:

```python
"""phase7c recompute quiz scores

Revision ID: <auto-generated>
Revises: 9959211d94b5
Create Date: <auto-generated>

Recompute UserItemState.last_score_correct and last_score_total under the new
option-level scoring rule (Phase 7c). Pure data migration — no schema change.
"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "<auto-generated>"
down_revision: Union[str, Sequence[str], None] = "9959211d94b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.phase7c")


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
            answers = s.last_answers if isinstance(s.last_answers, dict) else None
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
        except Exception as e:
            logger.warning("Skipping state %d: %s", s.id, e)
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
            answers = s.last_answers if isinstance(s.last_answers, dict) else None
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
```

- [ ] **Step 3: Write the migration test**

Create `tests/test_migration_phase7c.py`:

```python
"""Test the Phase 7c data migration recomputes scores under the new rule."""
from decimal import Decimal

from mathion.models import (AnswerOption, Block, Course, CourseVersion, Item,
                             Question, Sequence)
from mathion.models_auth import User, UserItemState


def test_migration_recomputes_multi_choice_partial_credit(db):
    """Setup a state row under OLD scoring (whole-question 0/1) and verify upgrade
    rewrites it to NEW option-level scoring."""
    course = Course(slug="m", name="M", description="")
    db.add(course); db.flush()
    v = CourseVersion(course_id=course.id, version_number=1, info_md="", info_html="",
                      state="draft")
    db.add(v); db.flush()
    block = Block(version_id=v.id, title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    item = Item(sequence_id=seq.id, title="Q", slug="q", order=1, type="quiz")
    db.add(item); db.flush()
    q = Question(item_id=item.id, text_md="?", type="multiple_choice", order=1)
    db.add(q); db.flush()
    o1 = AnswerOption(question_id=q.id, text="a", is_correct=True, order=1)
    o2 = AnswerOption(question_id=q.id, text="b", is_correct=False, order=2)
    o3 = AnswerOption(question_id=q.id, text="c", is_correct=True, order=3)
    o4 = AnswerOption(question_id=q.id, text="d", is_correct=False, order=4)
    db.add_all([o1, o2, o3, o4]); db.flush()

    user = User(email="x@example.com", full_name="X")
    db.add(user); db.flush()

    # Old-rule row: student picked 1 of 2 correct → old said "wrong" (0/1)
    state = UserItemState(
        user_id=user.id,
        item_id=item.id,
        is_covered=True,
        attempt_count=1,
        last_answers={str(q.id): [o1.id]},
        last_score_correct=0,
        last_score_total=1,
    )
    db.add(state); db.commit()

    # Run the migration's upgrade body directly (test infrastructure doesn't run
    # alembic in test DBs since conftest creates schema via Base.metadata).
    from alembic.config import Config
    from alembic import command
    # The conftest test DB doesn't have alembic_version; instead we invoke the
    # upgrade function via op.get_bind(), which we simulate by importing and
    # calling the helper directly with our session's bind.
    import importlib.util, glob, os
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    matches = glob.glob(os.path.join(backend_dir, "alembic/versions/*phase7c_recompute_quiz_scores.py"))
    assert len(matches) == 1, f"expected 1 migration file, found {matches}"
    spec = importlib.util.spec_from_file_location("phase7c_mig", matches[0])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # Monkey-patch op.get_bind() to return our test session's bind
    import alembic.op as alembic_op
    orig = alembic_op.get_bind
    alembic_op.get_bind = lambda: db.get_bind()
    try:
        mod.upgrade()
    finally:
        alembic_op.get_bind = orig

    db.expire_all()
    refreshed = db.get(UserItemState, state.id)
    # New rule: 1 of 2 correct picks, 0 wrong picks → (1, 2)
    assert refreshed.last_score_correct == 1
    assert refreshed.last_score_total == 2


def test_migration_skips_null_last_answers(db):
    """Rows with last_answers IS NULL must not be modified."""
    course = Course(slug="n", name="N", description="")
    db.add(course); db.flush()
    v = CourseVersion(course_id=course.id, version_number=1, info_md="", info_html="",
                      state="draft")
    db.add(v); db.flush()
    block = Block(version_id=v.id, title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    item = Item(sequence_id=seq.id, title="X", slug="x", order=1, type="static_page",
                content_md="x", content_html="<p>x</p>")
    db.add(item); db.flush()

    user = User(email="y@example.com", full_name="Y")
    db.add(user); db.flush()

    state = UserItemState(
        user_id=user.id, item_id=item.id, is_covered=True,
        attempt_count=0, last_answers=None,
        last_score_correct=None, last_score_total=None,
    )
    db.add(state); db.commit()

    import importlib.util, glob, os
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    matches = glob.glob(os.path.join(backend_dir, "alembic/versions/*phase7c_recompute_quiz_scores.py"))
    spec = importlib.util.spec_from_file_location("phase7c_mig", matches[0])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    import alembic.op as alembic_op
    orig = alembic_op.get_bind
    alembic_op.get_bind = lambda: db.get_bind()
    try:
        mod.upgrade()
    finally:
        alembic_op.get_bind = orig

    db.expire_all()
    refreshed = db.get(UserItemState, state.id)
    assert refreshed.last_score_correct is None
    assert refreshed.last_score_total is None
```

- [ ] **Step 4: Run the migration tests**

Run: `cd backend && pytest tests/test_migration_phase7c.py -v`
Expected: PASS — both tests pass.

- [ ] **Step 5: Run the migration on local dev DB (if exists)**

Run: `cd backend && alembic upgrade head`
Expected: clean upgrade, INFO log "Phase 7c migration: recomputed N rows, skipped M rows" (likely 0/0 if dev DB has no quiz attempts yet).

- [ ] **Step 6: Commit**

```bash
cd backend && git add alembic/versions/*phase7c_recompute_quiz_scores.py tests/test_migration_phase7c.py
git commit -m "feat(phase7c): data migration recomputes UserItemState quiz scores under option-level rule"
```

---

## Task 4: Dashboard router skeleton + auth gate + register in main

**Files:**
- Create: `mathion/api/dashboard.py`
- Modify: `mathion/main.py`
- Create: `tests/test_dashboard_progress.py` (auth tests only — content tests added later tasks)
- Create: `tests/test_dashboard_mini_projects.py` (auth tests only)

- [ ] **Step 1: Write the auth/404 tests for both endpoints**

Create `tests/test_dashboard_progress.py`:

```python
from fastapi.testclient import TestClient

from mathion.auth import request_pin, verify_pin
from mathion.models import Run, RunTeacher
from mathion.models_auth import User
from mathion.main import app


def _publish_run(admin_client, db, version_id):
    r = admin_client.post(f"/api/versions/{version_id}/runs", json={
        "name": "Run A", "groups_enabled": False,
    }).json()
    admin_client.post(f"/api/runs/{r['id']}/publish")
    return r


def test_progress_404_for_nonexistent_run(admin_client):
    r = admin_client.get("/api/runs/99999/dashboard/progress")
    assert r.status_code == 404


def test_progress_403_for_unrelated_user(client, db, seed_publishable_version, admin_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, version["id"])

    other = User(email="other@example.com", full_name="Other")
    db.add(other); db.commit()
    raw = request_pin(db, other.email)
    tok = verify_pin(db, other.email, raw, duration_days=7)
    c = TestClient(app)
    c.cookies.set("session_token", tok)
    c.headers.update({"X-Requested-With": "mathion"})

    r = c.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 403


def test_progress_200_for_admin(admin_client, seed_publishable_version, db):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, version["id"])
    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200


def test_progress_200_for_run_teacher(admin_client, seed_publishable_version, db, teacher_user, teacher_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, version["id"])
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    r = teacher_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
```

Create `tests/test_dashboard_mini_projects.py`:

```python
from fastapi.testclient import TestClient

from mathion.auth import request_pin, verify_pin
from mathion.models import RunTeacher
from mathion.models_auth import User
from mathion.main import app


def _publish_run(admin_client, db, version_id, groups_enabled=True):
    r = admin_client.post(f"/api/versions/{version_id}/runs", json={
        "name": "Run A", "groups_enabled": groups_enabled,
    }).json()
    admin_client.post(f"/api/runs/{r['id']}/publish")
    return r


def test_mp_dashboard_404_for_nonexistent_run(admin_client):
    r = admin_client.get("/api/runs/99999/dashboard/mini-projects")
    assert r.status_code == 404


def test_mp_dashboard_403_for_unrelated_user(client, db, seed_publishable_version, admin_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, version["id"])

    other = User(email="other2@example.com", full_name="Other")
    db.add(other); db.commit()
    raw = request_pin(db, other.email)
    tok = verify_pin(db, other.email, raw, duration_days=7)
    c = TestClient(app)
    c.cookies.set("session_token", tok)
    c.headers.update({"X-Requested-With": "mathion"})

    r = c.get(f"/api/runs/{run['id']}/dashboard/mini-projects")
    assert r.status_code == 403


def test_mp_dashboard_200_for_admin(admin_client, seed_publishable_version, db):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, version["id"])
    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects")
    assert r.status_code == 200


def test_mp_dashboard_200_for_run_teacher(admin_client, seed_publishable_version, db, teacher_user, teacher_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, version["id"])
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    r = teacher_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects")
    assert r.status_code == 200
```

- [ ] **Step 2: Run tests — they fail (router doesn't exist)**

Run: `cd backend && pytest tests/test_dashboard_progress.py tests/test_dashboard_mini_projects.py -v`
Expected: FAIL with 404s on every test (endpoints don't exist).

- [ ] **Step 3: Create the router skeleton**

Create `mathion/api/dashboard.py`:

```python
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_run_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Run
from mathion.models_auth import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])


@router.get("/api/runs/{run_id}/dashboard/progress")
def get_progress(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    # Stub — full body added in Tasks 5-7.
    return {
        "run": {
            "id": run.id,
            "name": run.name,
            "groups_enabled": run.groups_enabled,
            "version_is_disabled": run.version.is_disabled,
        },
        "sequences": [],
        "students": [],
    }


@router.get("/api/runs/{run_id}/dashboard/mini-projects")
def get_mini_projects(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    # Stub — full body added in Tasks 8-10.
    return {
        "run": {
            "id": run.id,
            "name": run.name,
            "groups_enabled": run.groups_enabled,
        },
        "mini_projects": [],
    }
```

- [ ] **Step 4: Register router in main.py**

Open `mathion/main.py` and add the import + include alongside other routers:

```python
from mathion.api.dashboard import router as dashboard_router
# ...
app.include_router(dashboard_router)
```

Insert after `app.include_router(evaluations_router)` to keep ordering consistent.

- [ ] **Step 5: Run auth tests — they all pass**

Run: `cd backend && pytest tests/test_dashboard_progress.py tests/test_dashboard_mini_projects.py -v`
Expected: PASS — 8 tests pass (4 per file).

- [ ] **Step 6: Commit**

```bash
cd backend && git add mathion/api/dashboard.py mathion/main.py tests/test_dashboard_progress.py tests/test_dashboard_mini_projects.py
git commit -m "feat(phase7c): dashboard router skeleton with auth gate"
```

---

## Task 5: `/dashboard/progress` — sequences metadata

**Files:**
- Modify: `mathion/api/dashboard.py`
- Modify: `tests/test_dashboard_progress.py`

- [ ] **Step 1: Add a test that asserts sequence shape and ordering**

Append to `tests/test_dashboard_progress.py`:

```python
def test_progress_sequences_shape_and_order(admin_client, seed_publishable_version, db):
    """Two blocks, each with two sequences, each with mixed items.
    Verify response.sequences is ordered by (block.order, sequence.order)
    with correct totals and quiz flag."""
    from mathion.models import Block, Sequence, Item

    course = admin_client.post("/api/courses", json={"slug": "p1", "name": "P1", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()

    # Block 1, two sequences. Sequence 1.1: 2 static + 1 quiz. Sequence 1.2: 1 static.
    b1 = Block(version_id=version["id"], title="B1", slug="b1", order=1)
    db.add(b1); db.flush()
    s11 = Sequence(block_id=b1.id, title="S11", slug="s11", order=1)
    s12 = Sequence(block_id=b1.id, title="S12", slug="s12", order=2)
    db.add_all([s11, s12]); db.flush()
    db.add(Item(sequence_id=s11.id, title="i1", slug="i1", order=1, type="static_page", content_md="x", content_html="x"))
    db.add(Item(sequence_id=s11.id, title="i2", slug="i2", order=2, type="static_page", content_md="x", content_html="x"))
    db.add(Item(sequence_id=s11.id, title="q1", slug="q1", order=3, type="quiz"))
    db.add(Item(sequence_id=s12.id, title="i3", slug="i3", order=1, type="static_page", content_md="x", content_html="x"))

    # Block 2, one sequence with 1 item.
    b2 = Block(version_id=version["id"], title="B2", slug="b2", order=2)
    db.add(b2); db.flush()
    s21 = Sequence(block_id=b2.id, title="S21", slug="s21", order=1)
    db.add(s21); db.flush()
    db.add(Item(sequence_id=s21.id, title="i4", slug="i4", order=1, type="static_page", content_md="x", content_html="x"))
    db.commit()

    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
    body = r.json()

    assert len(body["sequences"]) == 3
    seqs = body["sequences"]
    assert seqs[0]["block_order"] == 1 and seqs[0]["sequence_order"] == 1
    assert seqs[0]["total_items"] == 3 and seqs[0]["has_quiz_items"] is True
    assert seqs[1]["block_order"] == 1 and seqs[1]["sequence_order"] == 2
    assert seqs[1]["total_items"] == 1 and seqs[1]["has_quiz_items"] is False
    assert seqs[2]["block_order"] == 2 and seqs[2]["sequence_order"] == 1
    assert seqs[2]["total_items"] == 1 and seqs[2]["has_quiz_items"] is False
```

- [ ] **Step 2: Run test — fails (sequences is empty stub)**

Run: `cd backend && pytest tests/test_dashboard_progress.py::test_progress_sequences_shape_and_order -v`
Expected: FAIL — `assert len([]) == 3`.

- [ ] **Step 3: Implement sequences query in `get_progress`**

In `mathion/api/dashboard.py`, replace the `get_progress` body's stub with:

```python
@router.get("/api/runs/{run_id}/dashboard/progress")
def get_progress(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    sequences = _load_sequences(db, run.version_id)
    return {
        "run": {
            "id": run.id,
            "name": run.name,
            "groups_enabled": run.groups_enabled,
            "version_is_disabled": run.version.is_disabled,
        },
        "sequences": sequences,
        "students": [],
    }
```

Add helper at module top after the router definition:

```python
from sqlalchemy import select, func, case

from mathion.models import Block, Sequence, Item


def _load_sequences(db: Session, version_id: int) -> list[dict]:
    """Return ordered sequence metadata for a course version."""
    rows = db.execute(
        select(
            Block.id, Block.order, Block.title,
            Sequence.id, Sequence.order, Sequence.title,
            func.count(Item.id),
            func.coalesce(
                func.max(case((Item.type == "quiz", 1), else_=0)),
                0,
            ),
        )
        .select_from(Sequence)
        .join(Block, Block.id == Sequence.block_id)
        .outerjoin(Item, Item.sequence_id == Sequence.id)
        .where(Block.version_id == version_id)
        .group_by(Block.id, Block.order, Block.title,
                  Sequence.id, Sequence.order, Sequence.title)
        .order_by(Block.order, Sequence.order)
    ).all()

    return [
        {
            "block_id": b_id,
            "block_order": b_order,
            "block_title": b_title,
            "sequence_id": s_id,
            "sequence_order": s_order,
            "sequence_title": s_title,
            "total_items": int(total),
            "has_quiz_items": bool(has_quiz),
        }
        for (b_id, b_order, b_title, s_id, s_order, s_title, total, has_quiz) in rows
    ]
```

Also adjust the imports at the top of the file to include `select`, `func`, `case`, and the model classes (`Block`, `Sequence`, `Item`).

- [ ] **Step 4: Run test — passes**

Run: `cd backend && pytest tests/test_dashboard_progress.py::test_progress_sequences_shape_and_order -v`
Expected: PASS.

- [ ] **Step 5: Run all dashboard tests to confirm no regressions**

Run: `cd backend && pytest tests/test_dashboard_progress.py tests/test_dashboard_mini_projects.py -v`
Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
cd backend && git add mathion/api/dashboard.py tests/test_dashboard_progress.py
git commit -m "feat(phase7c): /dashboard/progress returns sequences metadata"
```

---

## Task 6: `/dashboard/progress` — student rows with coverage and quiz cells

**Files:**
- Modify: `mathion/api/dashboard.py`
- Modify: `tests/test_dashboard_progress.py`

- [ ] **Step 1: Write tests for coverage and quiz cell math**

Append to `tests/test_dashboard_progress.py`:

```python
def test_progress_coverage_cell_math(admin_client, db, seed_publishable_version):
    """One sequence with 3 static items. Student covered 2 of 3."""
    from mathion.models import Block, Sequence, Item, RunStudent
    from mathion.models_auth import User, UserItemState

    course = admin_client.post("/api/courses", json={"slug": "cov", "name": "Cov", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    items = [
        Item(sequence_id=seq.id, title=f"I{i}", slug=f"i{i}", order=i, type="static_page", content_md="x", content_html="x")
        for i in range(1, 4)
    ]
    db.add_all(items); db.flush()
    item_ids = [i.id for i in items]
    db.commit()

    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    student = User(email="cov@example.com", full_name="Cov S")
    db.add(student); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=None))
    db.add(UserItemState(user_id=student.id, item_id=item_ids[0], is_covered=True, time_spent=0))
    db.add(UserItemState(user_id=student.id, item_id=item_ids[1], is_covered=True, time_spent=0))
    db.add(UserItemState(user_id=student.id, item_id=item_ids[2], is_covered=False, time_spent=0))
    db.commit()

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
    body = r.json()
    assert len(body["students"]) == 1
    s = body["students"][0]
    assert s["email"] == "cov@example.com"
    assert s["coverage"] == [{"sequence_id": db.query(Sequence).first().id, "covered": 2, "total": 3}]
    assert s["quizzes"] == [{"sequence_id": db.query(Sequence).first().id, "correct": None, "total": None}]


def test_progress_quiz_cell_math(admin_client, db):
    """One sequence with 1 quiz item (multi-choice 2 of 4 correct).
    Student picks 1 of 2 correct → cell {correct: 1, total: 2}."""
    from mathion.models import Block, Sequence, Item, Question, AnswerOption, RunStudent
    from mathion.models_auth import User, UserItemState

    course = admin_client.post("/api/courses", json={"slug": "qz", "name": "Qz", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    qi = Item(sequence_id=seq.id, title="Q", slug="q", order=1, type="quiz")
    db.add(qi); db.flush()
    q = Question(item_id=qi.id, text_md="?", type="multiple_choice", order=1)
    db.add(q); db.flush()
    o1 = AnswerOption(question_id=q.id, text="a", is_correct=True, order=1)
    o2 = AnswerOption(question_id=q.id, text="b", is_correct=False, order=2)
    o3 = AnswerOption(question_id=q.id, text="c", is_correct=True, order=3)
    o4 = AnswerOption(question_id=q.id, text="d", is_correct=False, order=4)
    db.add_all([o1, o2, o3, o4]); db.flush()
    db.commit()

    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    student = User(email="qz@example.com", full_name="Qz S")
    db.add(student); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=None))
    # Simulate post-Phase-7c stored values (option-level): 1/2
    db.add(UserItemState(user_id=student.id, item_id=qi.id, is_covered=True,
                         attempt_count=1, last_answers={str(q.id): [o1.id]},
                         last_score_correct=1, last_score_total=2, time_spent=0))
    db.commit()

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    body = r.json()
    s = body["students"][0]
    assert s["coverage"][0] == {"sequence_id": seq.id, "covered": 1, "total": 1}
    assert s["quizzes"][0] == {"sequence_id": seq.id, "correct": 1, "total": 2}


def test_progress_quiz_cell_null_when_no_quiz_items(admin_client, db, seed_publishable_version):
    """Sequence with only static items: quiz cell is {correct: null, total: null}."""
    course, version = seed_publishable_version(slug="nq", name="NQ")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    from mathion.models import RunStudent
    from mathion.models_auth import User
    student = User(email="nq@example.com", full_name="NQ")
    db.add(student); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=None))
    db.commit()

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    body = r.json()
    s = body["students"][0]
    assert s["quizzes"][0]["correct"] is None
    assert s["quizzes"][0]["total"] is None
```

- [ ] **Step 2: Run tests — they fail (students stub still empty)**

Run: `cd backend && pytest tests/test_dashboard_progress.py -v -k "coverage_cell or quiz_cell"`
Expected: FAIL on the new three tests.

- [ ] **Step 3: Add helpers to `mathion/api/dashboard.py`**

After the `_load_sequences` helper, add:

```python
from mathion.models import Group, Question, AnswerOption, RunStudent


def _load_quiz_max_per_sequence(db: Session, version_id: int) -> dict[int, int]:
    """Map sequence_id → sum of per-quiz-item max-possible-score.

    Per-question max:
      - 1 for single_choice / numeric_answer / text_answer
      - count(correct AnswerOptions) for multiple_choice
    Sequences without quiz items are absent from the dict.
    """
    # Count of correct options per question (only meaningful for choice types).
    correct_count_subq = (
        select(
            Question.id.label("qid"),
            func.count(AnswerOption.id).label("correct_count"),
        )
        .join(AnswerOption, (AnswerOption.question_id == Question.id) & (AnswerOption.is_correct == True))
        .group_by(Question.id)
        .subquery()
    )

    rows = db.execute(
        select(
            Sequence.id,
            func.sum(
                case(
                    (Question.type == "multiple_choice",
                     func.coalesce(correct_count_subq.c.correct_count, 0)),
                    else_=1,
                )
            ),
        )
        .select_from(Sequence)
        .join(Block, Block.id == Sequence.block_id)
        .join(Item, Item.sequence_id == Sequence.id)
        .join(Question, Question.item_id == Item.id)
        .outerjoin(correct_count_subq, correct_count_subq.c.qid == Question.id)
        .where(Block.version_id == version_id, Item.type == "quiz")
        .group_by(Sequence.id)
    ).all()

    return {sid: int(total) for (sid, total) in rows if total is not None}


def _load_student_aggregates(db: Session, run_id: int, version_id: int) -> list[dict]:
    """Return one row per (RunStudent × Sequence) with covered count and quiz_correct sum."""
    from mathion.models_auth import UserItemState

    rows = db.execute(
        select(
            RunStudent.user_id,
            Sequence.id,
            func.count(Item.id),
            func.sum(case((UserItemState.is_covered == True, 1), else_=0)),
            func.sum(
                case(
                    (Item.type == "quiz", func.coalesce(UserItemState.last_score_correct, 0)),
                    else_=0,
                )
            ),
        )
        .select_from(RunStudent)
        .join(Block, Block.version_id == version_id)
        .join(Sequence, Sequence.block_id == Block.id)
        .outerjoin(Item, Item.sequence_id == Sequence.id)
        .outerjoin(
            UserItemState,
            (UserItemState.item_id == Item.id) & (UserItemState.user_id == RunStudent.user_id),
        )
        .where(RunStudent.run_id == run_id)
        .group_by(RunStudent.user_id, Sequence.id)
    ).all()

    return [
        {
            "user_id": uid,
            "sequence_id": sid,
            "total_items": int(total or 0),
            "covered": int(covered or 0),
            "quiz_correct": int(quiz_correct or 0),
        }
        for (uid, sid, total, covered, quiz_correct) in rows
    ]


def _load_run_students(db: Session, run_id: int) -> list[dict]:
    """Return ordered student row scaffolding (without cells)."""
    rows = db.execute(
        select(RunStudent, User, Group)
        .join(User, User.id == RunStudent.user_id)
        .outerjoin(Group, Group.id == RunStudent.group_id)
        .where(RunStudent.run_id == run_id)
        .order_by(RunStudent.created_at)
    ).all()

    return [
        {
            "user_id": rs.user_id,
            "email": u.email,
            "full_name": u.full_name,
            "user_is_disabled": u.is_disabled,
            "group_id": g.id if g else None,
            "group_name": g.name if g else None,
            "group_is_disabled": g.is_disabled if g else False,
        }
        for (rs, u, g) in rows
    ]
```

Then update `get_progress` to use them:

```python
@router.get("/api/runs/{run_id}/dashboard/progress")
def get_progress(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    sequences = _load_sequences(db, run.version_id)
    quiz_max_by_seq = _load_quiz_max_per_sequence(db, run.version_id)
    aggs = _load_student_aggregates(db, run.id, run.version_id)
    students_meta = _load_run_students(db, run.id)

    # Build (user_id, sequence_id) → agg map
    by_us = {(a["user_id"], a["sequence_id"]): a for a in aggs}
    has_quiz_by_seq = {s["sequence_id"]: s["has_quiz_items"] for s in sequences}

    students = []
    for sm in students_meta:
        coverage = []
        quizzes = []
        for s in sequences:
            seq_id = s["sequence_id"]
            agg = by_us.get((sm["user_id"], seq_id), {"covered": 0, "total_items": 0, "quiz_correct": 0})
            coverage.append({
                "sequence_id": seq_id,
                "covered": agg["covered"],
                "total": s["total_items"],
            })
            if has_quiz_by_seq.get(seq_id):
                quizzes.append({
                    "sequence_id": seq_id,
                    "correct": agg["quiz_correct"],
                    "total": quiz_max_by_seq.get(seq_id, 0),
                })
            else:
                quizzes.append({"sequence_id": seq_id, "correct": None, "total": None})
        students.append({**sm, "coverage": coverage, "quizzes": quizzes})

    return {
        "run": {
            "id": run.id,
            "name": run.name,
            "groups_enabled": run.groups_enabled,
            "version_is_disabled": run.version.is_disabled,
        },
        "sequences": sequences,
        "students": students,
    }
```

- [ ] **Step 4: Run all progress tests**

Run: `cd backend && pytest tests/test_dashboard_progress.py -v`
Expected: PASS — all tests including the three new ones.

- [ ] **Step 5: Commit**

```bash
cd backend && git add mathion/api/dashboard.py tests/test_dashboard_progress.py
git commit -m "feat(phase7c): /dashboard/progress returns student rows with coverage and quiz cells"
```

---

## Task 7: `/dashboard/progress` — edge case tests

**Files:**
- Modify: `tests/test_dashboard_progress.py`
- (Possibly) Modify: `mathion/api/dashboard.py` if any flag is missing

- [ ] **Step 1: Add the edge-case tests**

Append to `tests/test_dashboard_progress.py`:

```python
def test_progress_groups_disabled_run(admin_client, db, seed_publishable_version):
    """Run with groups_enabled=false: students have null group_id and group_name."""
    course, version = seed_publishable_version(slug="ng", name="NG")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    from mathion.models import RunStudent
    from mathion.models_auth import User
    s = User(email="ng@example.com", full_name="NG")
    db.add(s); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=s.id, group_id=None))
    db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress").json()
    assert body["students"][0]["group_id"] is None
    assert body["students"][0]["group_name"] is None
    assert body["students"][0]["group_is_disabled"] is False


def test_progress_disabled_group(admin_client, db, seed_publishable_version):
    """Disabled group: group_is_disabled=true, members still visible."""
    course, version = seed_publishable_version(slug="dg", name="DG")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": True,
    }).json()

    from mathion.models import Group, RunStudent
    from mathion.models_auth import User
    g = Group(run_id=run["id"], name="G1", is_disabled=True)
    db.add(g); db.flush()
    s = User(email="dg@example.com", full_name="DG")
    db.add(s); db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=s.id, group_id=g.id))
    db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress").json()
    assert body["students"][0]["group_is_disabled"] is True
    assert body["students"][0]["group_name"] == "G1"


def test_progress_disabled_user(admin_client, db, seed_publishable_version):
    course, version = seed_publishable_version(slug="du", name="DU")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    from mathion.models import RunStudent
    from mathion.models_auth import User
    s = User(email="du@example.com", full_name="DU", is_disabled=True)
    db.add(s); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=s.id, group_id=None))
    db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress").json()
    assert body["students"][0]["user_is_disabled"] is True


def test_progress_disabled_version(admin_client, db, seed_publishable_version):
    """Disabled version: endpoint still 200s, version_is_disabled flagged."""
    course, version = seed_publishable_version(slug="dv", name="DV")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()
    admin_client.post(f"/api/runs/{run['id']}/publish")
    admin_client.post(f"/api/versions/{version['id']}/disable")

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
    assert r.json()["run"]["version_is_disabled"] is True


def test_progress_run_with_zero_students(admin_client, db, seed_publishable_version):
    course, version = seed_publishable_version(slug="zs", name="ZS")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress").json()
    assert body["students"] == []
    # Sequences still populated (1 sequence from seed_publishable_version)
    assert len(body["sequences"]) == 1


def test_progress_empty_sequence(admin_client, db):
    """Sequence with zero items: total_items=0, has_quiz_items=False."""
    from mathion.models import Block, Sequence

    course = admin_client.post("/api/courses", json={"slug": "es", "name": "ES", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    db.add(Sequence(block_id=block.id, title="S", slug="s", order=1))  # no items
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress").json()
    assert body["sequences"][0]["total_items"] == 0
    assert body["sequences"][0]["has_quiz_items"] is False


def test_progress_unpublished_run(admin_client, db, seed_publishable_version):
    """Unpublished run still returns 200 (admin/teacher preview)."""
    course, version = seed_publishable_version(slug="up", name="UP")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()
    # Note: NOT calling /publish

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
```

- [ ] **Step 2: Run all tests — most pass; any failure reveals a missing flag**

Run: `cd backend && pytest tests/test_dashboard_progress.py -v`
Expected: PASS — all tests pass given the flags are already implemented in `_load_run_students` and `_load_sequences`. If any fail, fix in `dashboard.py` then re-run.

- [ ] **Step 3: Commit**

```bash
cd backend && git add tests/test_dashboard_progress.py mathion/api/dashboard.py
git commit -m "test(phase7c): /dashboard/progress edge cases (disabled group/user/version, empty sequence, zero students)"
```

---

## Task 8: `/dashboard/mini-projects` — skeleton with status enum

**Files:**
- Modify: `mathion/api/dashboard.py`
- Modify: `tests/test_dashboard_mini_projects.py`

- [ ] **Step 1: Write tests for the four primary statuses (`not_submitted`, `awaiting_eval`, `needs_revision`, `accepted`)**

Append to `tests/test_dashboard_mini_projects.py`:

```python
def _make_run_with_mp(admin_client, db, slug="mp"):
    """Create a published run with one MP (block 1) and one student in one group."""
    from mathion.models import Block, Sequence, Item, Group, RunStudent, MiniProject
    from mathion.models_auth import User
    from datetime import datetime, timezone, timedelta

    course = admin_client.post("/api/courses", json={"slug": slug, "name": slug, "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B1", slug="b1", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": True,
    }).json()
    admin_client.post(f"/api/runs/{run['id']}/publish")

    g = Group(run_id=run["id"], name="G1")
    db.add(g); db.flush()
    s = User(email=f"{slug}@example.com", full_name="S")
    db.add(s); db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=s.id, group_id=g.id))
    soft = datetime.now(timezone.utc) + timedelta(days=7)
    hard = datetime.now(timezone.utc) + timedelta(days=14)
    resub = datetime.now(timezone.utc) + timedelta(days=21)
    mp = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=soft, hard_deadline=hard, resubmission_deadline=resub,
        is_published=True,
    )
    db.add(mp); db.commit()
    return {"run": run, "group": g, "student": s, "mp": mp, "block": block}


def test_mp_dashboard_status_not_submitted(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="ns")

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    assert len(body["mini_projects"]) == 1
    mp = body["mini_projects"][0]
    assert mp["counts"]["total_groups"] == 1
    assert mp["counts"]["not_submitted"] == 1
    assert mp["groups"][0]["status"] == "not_submitted"
    assert mp["groups"][0]["latest_submission"] is None
    assert mp["groups"][0]["latest_evaluation"] is None


def test_mp_dashboard_status_awaiting_eval(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Submission
    ctx = _make_run_with_mp(admin_client, db, slug="ae")
    db.add(Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )); db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "awaiting_eval"
    assert g["latest_submission"]["submission_number"] == 1
    assert g["latest_evaluation"] is None


def test_mp_dashboard_status_needs_revision(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Submission, Evaluation
    ctx = _make_run_with_mp(admin_client, db, slug="nr")
    sub = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=ctx["student"].id,
                      result="minor_revision"))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "needs_revision"
    assert g["latest_evaluation"]["result"] == "minor_revision"


def test_mp_dashboard_status_accepted(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Submission, Evaluation
    ctx = _make_run_with_mp(admin_client, db, slug="ac")
    sub = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=ctx["student"].id,
                      result="accepted", score=90))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "accepted"
    assert g["latest_evaluation"]["score"] == 90


def test_mp_dashboard_status_rejected(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Submission, Evaluation
    ctx = _make_run_with_mp(admin_client, db, slug="rj")
    sub = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=ctx["student"].id,
                      result="rejected"))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "rejected"
```

- [ ] **Step 2: Run tests — fail (mini_projects stub returns empty list)**

Run: `cd backend && pytest tests/test_dashboard_mini_projects.py -v -k "status_"`
Expected: FAIL on all five.

- [ ] **Step 3: Implement the mini-projects endpoint**

Add to `mathion/api/dashboard.py`:

```python
from mathion.models import MiniProject, Submission, Evaluation


def _derive_status(latest_sub, latest_eval) -> str:
    if latest_sub is None:
        return "not_submitted"
    if latest_eval is None:
        return "awaiting_eval"
    r = latest_eval.result
    if r in ("major_revision", "minor_revision"):
        return "needs_revision"
    if r == "accepted":
        return "accepted"
    if r == "rejected":
        return "rejected"
    return "awaiting_eval"  # defensive


def _serialize_user_ref(u: User | None) -> dict | None:
    if u is None:
        return None
    return {"user_id": u.id, "full_name": u.full_name}


def _serialize_submission(sub: Submission | None, by: User | None) -> dict | None:
    if sub is None:
        return None
    return {
        "id": sub.id,
        "submission_number": sub.submission_number,
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "submitted_by": _serialize_user_ref(by),
        "is_late": sub.is_late,
        "is_resubmission": sub.is_resubmission,
        "file_size": sub.file_size,
    }


def _serialize_evaluation(ev: Evaluation | None, by: User | None) -> dict | None:
    if ev is None:
        return None
    return {
        "id": ev.id,
        "evaluated_at": ev.evaluated_at.isoformat() if ev.evaluated_at else None,
        "evaluated_by": _serialize_user_ref(by),
        "result": ev.result,
        "score": ev.score,
        "feedback_text": ev.feedback_text,
        "has_feedback_file": ev.feedback_file is not None,
    }


@router.get("/api/runs/{run_id}/dashboard/mini-projects")
def get_mini_projects(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    # 1. MPs and groups for this run
    mps = db.execute(
        select(MiniProject, Block)
        .join(Block, Block.id == MiniProject.block_id)
        .where(MiniProject.run_id == run_id)
        .order_by(Block.order)
    ).all()

    groups = db.execute(
        select(Group).where(Group.run_id == run_id).order_by(Group.id)
    ).scalars().all()

    # 2. Latest submission + evaluation per (mp, group). One pass.
    sub_rows = db.execute(
        select(Submission, Evaluation, User.id, User.full_name)
        .outerjoin(Evaluation, Evaluation.submission_id == Submission.id)
        .outerjoin(User, User.id == Submission.submitted_by)
        .where(Submission.mini_project_id.in_([mp.id for mp, _ in mps]) if mps else False)
        .order_by(Submission.mini_project_id, Submission.group_id, Submission.submission_number.desc())
    ).all() if mps else []

    # Reduce to latest per (mp_id, group_id). Iteration is in DESC submission_number order
    # so the first-seen (mp, group) pair is the latest.
    latest_by_pair: dict[tuple[int, int], tuple] = {}
    for sub, ev, sub_by_id, sub_by_name in sub_rows:
        key = (sub.mini_project_id, sub.group_id)
        if key not in latest_by_pair:
            latest_by_pair[key] = (sub, ev, sub_by_id, sub_by_name)

    # Pre-load evaluator user names
    evaluator_ids = {ev.evaluated_by for (_, ev, _, _) in latest_by_pair.values() if ev is not None}
    evaluators = {u.id: u for u in db.execute(
        select(User).where(User.id.in_(evaluator_ids))
    ).scalars().all()} if evaluator_ids else {}

    # 3. Build response
    mp_entries = []
    for mp, block in mps:
        group_entries = []
        counts = {"total_groups": 0, "not_submitted": 0, "awaiting_eval": 0,
                  "needs_revision": 0, "accepted": 0, "rejected": 0}
        for g in groups:
            entry = latest_by_pair.get((mp.id, g.id))
            sub = ev = sub_by = None
            if entry is not None:
                sub, ev, sub_by_id, sub_by_name = entry
                sub_by = type("U", (), {"id": sub_by_id, "full_name": sub_by_name})() if sub_by_id else None
            status = _derive_status(sub, ev)
            evaluator = evaluators.get(ev.evaluated_by) if ev is not None else None
            group_entries.append({
                "group_id": g.id,
                "group_name": g.name,
                "group_is_disabled": g.is_disabled,
                "status": status,
                "latest_submission": _serialize_submission(sub, sub_by),
                "latest_evaluation": _serialize_evaluation(ev, evaluator),
            })
            counts["total_groups"] += 1
            counts[status] += 1

        mp_entries.append({
            "id": mp.id,
            "block_id": block.id,
            "block_order": block.order,
            "block_title": block.title,
            "is_published": mp.is_published,
            "first_submitted_at": mp.first_submitted_at.isoformat() if mp.first_submitted_at else None,
            "soft_deadline": mp.soft_deadline.isoformat() if mp.soft_deadline else None,
            "hard_deadline": mp.hard_deadline.isoformat() if mp.hard_deadline else None,
            "resubmission_deadline": mp.resubmission_deadline.isoformat() if mp.resubmission_deadline else None,
            "counts": counts,
            "groups": group_entries,
        })

    return {
        "run": {
            "id": run.id,
            "name": run.name,
            "groups_enabled": run.groups_enabled,
        },
        "mini_projects": mp_entries,
    }
```

(Replace the old stub `get_mini_projects` body with this. Keep imports clean.)

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_dashboard_mini_projects.py -v`
Expected: PASS — auth tests + 5 status tests = 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd backend && git add mathion/api/dashboard.py tests/test_dashboard_mini_projects.py
git commit -m "feat(phase7c): /dashboard/mini-projects with status enum (not_submitted/awaiting_eval/needs_revision/accepted/rejected)"
```

---

## Task 9: `/dashboard/mini-projects` — auto-accept and counts aggregation tests

**Files:**
- Modify: `tests/test_dashboard_mini_projects.py`

- [ ] **Step 1: Add tests for auto-accepted resubmission and counts aggregation**

Append:

```python
def test_mp_dashboard_auto_accepted_resubmission(admin_client, db):
    """Resubmission after minor_revision is auto-accepted: latest sub.is_resubmission=True,
    latest eval.result=accepted, evaluated_by = original revision-requester."""
    from datetime import datetime, timezone
    from mathion.models import Submission, Evaluation
    from mathion.models_auth import User
    ctx = _make_run_with_mp(admin_client, db, slug="aar")

    teacher = User(email="t@example.com", full_name="T")
    db.add(teacher); db.commit()

    sub1 = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub1); db.flush()
    db.add(Evaluation(submission_id=sub1.id, evaluated_by=teacher.id, result="minor_revision",
                      feedback_text="fix p3"))
    sub2 = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x2", submission_number=2, file_size=100, is_late=False, is_resubmission=True,
    )
    db.add(sub2); db.flush()
    db.add(Evaluation(submission_id=sub2.id, evaluated_by=teacher.id, result="accepted"))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "accepted"
    assert g["latest_submission"]["is_resubmission"] is True
    assert g["latest_submission"]["submission_number"] == 2
    assert g["latest_evaluation"]["result"] == "accepted"
    assert g["latest_evaluation"]["evaluated_by"]["user_id"] == teacher.id
    assert g["latest_evaluation"]["feedback_text"] is None


def test_mp_dashboard_counts_aggregation(admin_client, db):
    """3 groups, mix of statuses: counts should sum correctly."""
    from datetime import datetime, timezone
    from mathion.models import (Block, Sequence, Item, Group, RunStudent,
                                  MiniProject, Submission, Evaluation)
    from mathion.models_auth import User

    course = admin_client.post("/api/courses", json={"slug": "ct", "name": "CT", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": True,
    }).json()
    admin_client.post(f"/api/runs/{run['id']}/publish")

    groups = []
    for i in range(3):
        g = Group(run_id=run["id"], name=f"G{i}")
        db.add(g); db.flush()
        s = User(email=f"ct{i}@example.com", full_name=f"S{i}")
        db.add(s); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=s.id, group_id=g.id))
        groups.append((g, s))
    from datetime import timedelta
    mp = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=datetime.now(timezone.utc) + timedelta(days=7),
        hard_deadline=datetime.now(timezone.utc) + timedelta(days=14),
        resubmission_deadline=datetime.now(timezone.utc) + timedelta(days=21),
        is_published=True,
    )
    db.add(mp); db.commit()

    # Group 0: not_submitted (no submission)
    # Group 1: awaiting_eval (submitted, no eval)
    g1, s1 = groups[1]
    db.add(Submission(
        mini_project_id=mp.id, group_id=g1.id, submitted_by=s1.id,
        submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    ))
    # Group 2: accepted
    g2, s2 = groups[2]
    sub = Submission(
        mini_project_id=mp.id, group_id=g2.id, submitted_by=s2.id,
        submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=s2.id, result="accepted"))
    db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    counts = body["mini_projects"][0]["counts"]
    assert counts["total_groups"] == 3
    assert counts["not_submitted"] == 1
    assert counts["awaiting_eval"] == 1
    assert counts["accepted"] == 1
    assert counts["needs_revision"] == 0
    assert counts["rejected"] == 0


def test_mp_dashboard_groups_disabled_run_returns_empty(admin_client, db, seed_publishable_version):
    """groups_enabled=false → no MPs (per Phase 7b extension)."""
    course, version = seed_publishable_version(slug="ge", name="GE")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": False,
    }).json()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    assert body["mini_projects"] == []


def test_mp_dashboard_unpublished_mp_included(admin_client, db):
    """Unpublished MPs appear with is_published=false."""
    from datetime import datetime, timezone, timedelta
    from mathion.models import (Block, Sequence, Item, Group, RunStudent,
                                  MiniProject)
    from mathion.models_auth import User
    course = admin_client.post("/api/courses", json={"slug": "up2", "name": "UP", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": True,
    }).json()
    admin_client.post(f"/api/runs/{run['id']}/publish")
    g = Group(run_id=run["id"], name="G1")
    db.add(g); db.commit()
    mp = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=datetime.now(timezone.utc) + timedelta(days=7),
        hard_deadline=datetime.now(timezone.utc) + timedelta(days=14),
        resubmission_deadline=datetime.now(timezone.utc) + timedelta(days=21),
        is_published=False,
    )
    db.add(mp); db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    assert body["mini_projects"][0]["is_published"] is False


def test_mp_dashboard_disabled_group_visible(admin_client, db):
    """Disabled groups appear with group_is_disabled=true."""
    from datetime import datetime, timezone, timedelta
    from mathion.models import (Block, Sequence, Item, Group, MiniProject)

    course = admin_client.post("/api/courses", json={"slug": "dgmp", "name": "D", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = admin_client.post(f"/api/versions/{version['id']}/runs", json={
        "name": "R", "groups_enabled": True,
    }).json()
    admin_client.post(f"/api/runs/{run['id']}/publish")
    g = Group(run_id=run["id"], name="G1", is_disabled=True)
    db.add(g); db.commit()
    db.add(MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=datetime.now(timezone.utc) + timedelta(days=7),
        hard_deadline=datetime.now(timezone.utc) + timedelta(days=14),
        resubmission_deadline=datetime.now(timezone.utc) + timedelta(days=21),
        is_published=True,
    )); db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    g_entry = body["mini_projects"][0]["groups"][0]
    assert g_entry["group_is_disabled"] is True
```

- [ ] **Step 2: Run all tests**

Run: `cd backend && pytest tests/test_dashboard_mini_projects.py -v`
Expected: PASS — all tests including the new five.

- [ ] **Step 3: Commit**

```bash
cd backend && git add tests/test_dashboard_mini_projects.py
git commit -m "test(phase7c): /dashboard/mini-projects edge cases (auto-accept, counts, disabled group, unpublished MP)"
```

---

## Task 10: Add GZipMiddleware

**Files:**
- Modify: `mathion/main.py`

- [ ] **Step 1: Add GZipMiddleware**

Open `mathion/main.py` and add after `app = FastAPI(...)`:

```python
from fastapi.middleware.gzip import GZipMiddleware

app.add_middleware(GZipMiddleware, minimum_size=1024)
```

- [ ] **Step 2: Verify it doesn't break anything — run the full test suite**

Run: `cd backend && pytest -x --tb=short`
Expected: PASS — all ~490 tests pass (444 baseline + ~46 new).

- [ ] **Step 3: Commit**

```bash
cd backend && git add mathion/main.py
git commit -m "feat(phase7c): GZipMiddleware on responses ≥ 1KB"
```

---

## Task 11: Final regression and merge readiness check

**Files:** none — verification only.

- [ ] **Step 1: Run full test suite, capture count**

Run: `cd backend && pytest --tb=short`
Expected: PASS — total tests ≥ 490 (was 444 baseline). No errors, no warnings beyond the known ones.

- [ ] **Step 2: Run alembic upgrade on a fresh dev DB to confirm migration chain works**

Run: `cd backend && rm -f /tmp/p7c-check.db && DATABASE_URL=sqlite:////tmp/p7c-check.db alembic upgrade head && rm /tmp/p7c-check.db`
Expected: clean upgrade through every revision including the new Phase 7c one. INFO log "Phase 7c migration: recomputed 0 rows, skipped 0 rows" on a fresh DB.

- [ ] **Step 3: Review `git log --oneline` for the phase**

Confirm the commit history reads cleanly:

```
feat(phase7c): GZipMiddleware on responses ≥ 1KB
test(phase7c): /dashboard/mini-projects edge cases (auto-accept, counts, disabled group, unpublished MP)
feat(phase7c): /dashboard/mini-projects with status enum (...)
test(phase7c): /dashboard/progress edge cases (...)
feat(phase7c): /dashboard/progress returns student rows with coverage and quiz cells
feat(phase7c): /dashboard/progress returns sequences metadata
feat(phase7c): dashboard router skeleton with auth gate
feat(phase7c): data migration recomputes UserItemState quiz scores under option-level rule
feat(phase7c): submit_quiz uses option-level scoring (partial credit + strict subtraction)
feat(phase7c): evaluate_question returns (correct_picks, total_correct) for option-level scoring
```

- [ ] **Step 4: Phase 7c done — summarize for user**

Phase 7c is complete: 11 commits, ~50 new tests, zero schema changes. Two new endpoints (`/dashboard/progress`, `/dashboard/mini-projects`) and one Phase 5 redefinition (`evaluate_question` now returns `tuple[int, int]` for option-level partial credit). Phase 7d (bulk roster ops) remains for whenever next.
