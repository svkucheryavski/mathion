# Phase 5: Quiz System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build server-side quiz answer submission, evaluation, and reveal endpoints so students can take quizzes and see correct answers after max attempts.

**Architecture:** A quiz service module contains evaluation logic per question type. The submit endpoint accepts all answers for a quiz item, evaluates server-side, stores results in UserItemState (attempt_count, last_answers, last_score_correct/total). A separate reveal endpoint serves correct answers + explanations only after max attempts. The JSON column `last_answers` is always fully reassigned (never mutated in place) per Codex finding about SQLAlchemy JSON mutation awareness.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.x, Pydantic v2, pytest

**Spec:** `docs/superpowers/specs/2026-04-19-mathion-platform-design.md`

**Existing code:** 231 passing tests. UserItemState quiz fields exist. Content endpoint already hides correct answers. State endpoint returns attempt_count + last_score.

---

## File Structure

### New files
- `backend/mathion/quiz.py` — Quiz evaluation service (pure logic, no DB)
- `backend/mathion/api/quiz.py` — Submit + reveal endpoints
- `backend/tests/test_quiz_service.py` — Unit tests for evaluation logic
- `backend/tests/test_quiz_api.py` — API tests for submit/reveal

### Modified files
- `backend/mathion/schemas.py` — Add QuizSubmitRequest, QuizSubmitResponse, QuizRevealResponse schemas
- `backend/mathion/main.py` — Register quiz router

---

### Task 1: Quiz Evaluation Service

**Files:**
- Create: `backend/mathion/quiz.py`
- Create: `backend/tests/test_quiz_service.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_quiz_service.py`:

```python
from decimal import Decimal

from mathion.quiz import evaluate_question


def test_single_choice_correct():
    result = evaluate_question(
        q_type="single_choice",
        student_answer=[3],  # option ID
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
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/pytest tests/test_quiz_service.py -v
```

Expected: FAIL — `ImportError: cannot import name 'evaluate_question'`

- [ ] **Step 3: Implement evaluation logic**

Create `backend/mathion/quiz.py`:

```python
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
```

- [ ] **Step 4: Run tests**

```bash
.venv/bin/pytest tests/test_quiz_service.py -v
```

Expected: all 12 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/quiz.py backend/tests/test_quiz_service.py
git commit -m "feat: add quiz evaluation service with per-type scoring"
```

---

### Task 2: Quiz Submit Endpoint

**Files:**
- Modify: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/quiz.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_quiz_api.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_quiz_api.py`:

```python
from mathion.models_auth import StudentEnrollment, User


def _setup_quiz(admin_client, db):
    """Create a published course with a quiz: 1 single-choice + 1 numeric question."""
    from mathion.auth import request_pin, verify_pin

    course = admin_client.post("/api/courses", json={"slug": "quiz-course", "name": "Quiz", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Quiz", "slug": "quiz", "type": "quiz",
    }).json()

    # Single choice question with 2 options
    q1 = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "What is 2+2?", "type": "single_choice",
    }).json()
    opt_a = admin_client.post(f"/api/questions/{q1['id']}/options", json={"text": "3", "is_correct": False}).json()
    opt_b = admin_client.post(f"/api/questions/{q1['id']}/options", json={"text": "4", "is_correct": True}).json()

    # Numeric question
    q2 = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "sqrt(9)?", "type": "numeric_answer", "correct_numeric": 3.0, "precision": 0,
    }).json()

    admin_client.post(f"/api/versions/{version['id']}/publish")

    # Create student and enroll
    student = User(email="quizstudent@example.com", full_name="Quiz Student")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)
    db.refresh(student)

    return {
        "version": version, "item": item,
        "q1": q1, "opt_a": opt_a, "opt_b": opt_b,
        "q2": q2, "student": student, "token": token,
    }


def _make_student_client(db, token):
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    from mathion.main import app
    from mathion.database import get_db

    @contextmanager
    def _ctx():
        saved = dict(app.dependency_overrides)
        def override():
            try:
                yield db
            finally:
                pass
        app.dependency_overrides[get_db] = override
        sc = TestClient(app)
        sc.cookies.set("session_token", token)
        try:
            yield sc
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(saved)

    return _ctx()


def test_submit_quiz_all_correct(admin_client, db):
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_b"]["id"]],
                str(data["q2"]["id"]): "3.0",
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        result = response.json()
        assert result["score_correct"] == 2
        assert result["score_total"] == 2
        assert result["attempt_count"] == 1
        assert result["can_retry"] is True


def test_submit_quiz_partial_correct(admin_client, db):
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_a"]["id"]],  # wrong
                str(data["q2"]["id"]): "3.0",  # correct
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 200
        result = response.json()
        assert result["score_correct"] == 1
        assert result["score_total"] == 2


def test_submit_quiz_max_attempts_reached(admin_client, db):
    data = _setup_quiz(admin_client, db)
    answers = {
        str(data["q1"]["id"]): [data["opt_b"]["id"]],
        str(data["q2"]["id"]): "3.0",
    }
    with _make_student_client(db, data["token"]) as sc:
        # Submit 3 times (default max_quiz_attempts is 3)
        for i in range(3):
            response = sc.post(f"/api/items/{data['item']['id']}/submit",
                               json={"answers": answers},
                               headers={"X-Requested-With": "mathion"})
            assert response.status_code == 200

        # 4th attempt should be rejected
        response = sc.post(f"/api/items/{data['item']['id']}/submit",
                           json={"answers": answers},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 409
        assert "max attempts" in response.json()["detail"].lower()


def test_submit_quiz_not_enrolled(auth_client):
    response = auth_client.post("/api/items/999/submit", json={"answers": {}})
    assert response.status_code in (403, 404)


def test_submit_quiz_missing_question(admin_client, db):
    """Submitting without answering all questions should fail."""
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.post(f"/api/items/{data['item']['id']}/submit", json={
            "answers": {
                str(data["q1"]["id"]): [data["opt_b"]["id"]],
                # q2 missing
            }
        }, headers={"X-Requested-With": "mathion"})
        assert response.status_code == 422


def test_submit_non_quiz_item_rejected(admin_client, db):
    """Cannot submit answers to a non-quiz item."""
    from mathion.auth import request_pin, verify_pin
    course = admin_client.post("/api/courses", json={"slug": "c2", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page", "content_md": "# Hi",
    }).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    student = User(email="qs2@example.com", full_name="S")
    db.add(student)
    db.commit()
    enrollment = StudentEnrollment(user_id=student.id, version_id=version["id"], is_active=True)
    db.add(enrollment)
    db.commit()
    raw_pin = request_pin(db, student.email)
    token = verify_pin(db, student.email, raw_pin, duration_days=7)

    with _make_student_client(db, token) as sc:
        response = sc.post(f"/api/items/{item['id']}/submit", json={"answers": {}},
                           headers={"X-Requested-With": "mathion"})
        assert response.status_code == 409
```

- [ ] **Step 2: Add schemas**

Add to `backend/mathion/schemas.py`:

```python
class QuizSubmitRequest(BaseModel):
    answers: dict[str, list[int] | str]  # question_id -> [option_ids] or "value"


class QuizSubmitResponse(BaseModel):
    item_id: int
    attempt_count: int
    max_attempts: int
    score_correct: int
    score_total: int
    can_retry: bool
```

- [ ] **Step 3: Implement submit endpoint**

Create `backend/mathion/api/quiz.py`:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Block, CourseVersion, Item, Question, Sequence
from mathion.models_auth import StudentEnrollment, User, UserItemState
from mathion.quiz import evaluate_question
from mathion.schemas import QuizSubmitRequest, QuizSubmitResponse

router = APIRouter(tags=["quiz"])


def _check_quiz_access(db: Session, user: User, item_id: int) -> tuple[Item, CourseVersion]:
    """Verify user is enrolled and item is a published quiz."""
    item = get_or_404(db, Item, item_id)
    seq = get_or_404(db, Sequence, item.sequence_id, detail="Item not found")
    block = get_or_404(db, Block, seq.block_id, detail="Item not found")
    version = get_or_404(db, CourseVersion, block.version_id)

    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state not in ("published", "archived"):
        raise HTTPException(status_code=403, detail="Version not published")

    if not user.is_superuser:
        is_enrolled = db.execute(
            select(StudentEnrollment).where(
                StudentEnrollment.version_id == version.id,
                StudentEnrollment.user_id == user.id,
            )
        ).scalar_one_or_none()
        if not is_enrolled:
            raise HTTPException(status_code=403, detail="Not enrolled")

    return item, version


@router.post("/api/items/{item_id}/submit", response_model=QuizSubmitResponse)
def submit_quiz(item_id: int, data: QuizSubmitRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item, version = _check_quiz_access(db, user, item_id)

    if item.type != "quiz":
        raise HTTPException(status_code=409, detail="Can only submit answers to quiz items")

    # Load questions for this item
    questions = db.execute(
        select(Question).where(Question.item_id == item_id)
    ).scalars().all()

    if not questions:
        raise HTTPException(status_code=409, detail="Quiz has no questions")

    # Validate all questions are answered
    q_ids = {str(q.id) for q in questions}
    submitted_ids = set(data.answers.keys())
    if submitted_ids != q_ids:
        missing = q_ids - submitted_ids
        raise HTTPException(status_code=422, detail=f"Missing answers for questions: {missing}")

    # Get or create user state
    state = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()

    if not state:
        state = UserItemState(user_id=user.id, item_id=item_id, is_covered=False, time_spent=0)
        db.add(state)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            state = db.execute(
                select(UserItemState).where(
                    UserItemState.user_id == user.id,
                    UserItemState.item_id == item_id,
                )
            ).scalar_one()

    # Check max attempts
    max_attempts = version.max_quiz_attempts
    if state.attempt_count >= max_attempts:
        raise HTTPException(status_code=409, detail="Max attempts reached")

    # Evaluate each question
    score_correct = 0
    for q in questions:
        student_answer = data.answers[str(q.id)]

        # Get correct option IDs for choice questions
        correct_ids = set()
        if q.type in ("single_choice", "multiple_choice"):
            correct_ids = set(db.scalars(
                select(AnswerOption.id).where(
                    AnswerOption.question_id == q.id,
                    AnswerOption.is_correct == True,
                )
            ).all())

        if evaluate_question(
            q_type=q.type,
            student_answer=student_answer,
            correct_option_ids=correct_ids,
            correct_numeric=q.correct_numeric,
            precision=q.precision,
            correct_text=q.correct_text,
        ):
            score_correct += 1

    # Update state — always reassign last_answers (never mutate in place)
    state.attempt_count += 1
    state.last_answers = dict(data.answers)  # full reassignment for SQLAlchemy JSON
    state.last_score_correct = score_correct
    state.last_score_total = len(questions)
    state.last_visited_at = datetime.now(timezone.utc)
    state.is_covered = True

    db.commit()
    db.refresh(state)

    return QuizSubmitResponse(
        item_id=item_id,
        attempt_count=state.attempt_count,
        max_attempts=max_attempts,
        score_correct=score_correct,
        score_total=len(questions),
        can_retry=state.attempt_count < max_attempts,
    )
```

Register in `backend/mathion/main.py`:
```python
from mathion.api.quiz import router as quiz_router
app.include_router(quiz_router)
```

- [ ] **Step 4: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add quiz submission endpoint with server-side evaluation"
```

---

### Task 3: Quiz Reveal Endpoint

**Files:**
- Modify: `backend/mathion/schemas.py`
- Modify: `backend/mathion/api/quiz.py`
- Modify: `backend/tests/test_quiz_api.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_quiz_api.py`:

```python
def test_reveal_after_max_attempts(admin_client, db):
    data = _setup_quiz(admin_client, db)
    answers = {
        str(data["q1"]["id"]): [data["opt_b"]["id"]],
        str(data["q2"]["id"]): "3.0",
    }
    with _make_student_client(db, data["token"]) as sc:
        for _ in range(3):
            sc.post(f"/api/items/{data['item']['id']}/submit",
                    json={"answers": answers},
                    headers={"X-Requested-With": "mathion"})

        response = sc.get(f"/api/items/{data['item']['id']}/reveal")
        assert response.status_code == 200
        reveal = response.json()
        assert len(reveal["questions"]) == 2

        # Single choice question should show correct option
        q1_reveal = [q for q in reveal["questions"] if q["id"] == data["q1"]["id"]][0]
        assert data["opt_b"]["id"] in q1_reveal["correct_option_ids"]

        # Numeric question should show correct value
        q2_reveal = [q for q in reveal["questions"] if q["id"] == data["q2"]["id"]][0]
        assert q2_reveal["correct_numeric"] == 3.0


def test_reveal_before_max_attempts_blocked(admin_client, db):
    data = _setup_quiz(admin_client, db)
    answers = {
        str(data["q1"]["id"]): [data["opt_b"]["id"]],
        str(data["q2"]["id"]): "3.0",
    }
    with _make_student_client(db, data["token"]) as sc:
        # Only 1 attempt (max is 3)
        sc.post(f"/api/items/{data['item']['id']}/submit",
                json={"answers": answers},
                headers={"X-Requested-With": "mathion"})

        response = sc.get(f"/api/items/{data['item']['id']}/reveal")
        assert response.status_code == 403


def test_reveal_without_any_attempt_blocked(admin_client, db):
    data = _setup_quiz(admin_client, db)
    with _make_student_client(db, data["token"]) as sc:
        response = sc.get(f"/api/items/{data['item']['id']}/reveal")
        assert response.status_code == 403
```

- [ ] **Step 2: Add reveal schema**

Add to `backend/mathion/schemas.py`:

```python
class QuestionReveal(BaseModel):
    id: int
    type: str
    text_html: str
    explanation_html: str | None
    correct_option_ids: list[int]  # empty for non-choice types
    correct_numeric: float | None
    correct_text: str | None
    student_answer: list[int] | str | None


class QuizRevealResponse(BaseModel):
    item_id: int
    attempt_count: int
    score_correct: int
    score_total: int
    questions: list[QuestionReveal]
```

- [ ] **Step 3: Implement reveal endpoint**

Add to `backend/mathion/api/quiz.py`:

```python
from mathion.schemas import QuestionReveal, QuizRevealResponse, QuizSubmitRequest, QuizSubmitResponse


@router.get("/api/items/{item_id}/reveal", response_model=QuizRevealResponse)
def reveal_quiz(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item, version = _check_quiz_access(db, user, item_id)

    if item.type != "quiz":
        raise HTTPException(status_code=409, detail="Not a quiz item")

    # Get user state
    state = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()

    if not state or state.attempt_count < version.max_quiz_attempts:
        raise HTTPException(status_code=403, detail="Answers revealed only after all attempts are used")

    # Load questions with options
    questions = db.execute(
        select(Question).where(Question.item_id == item_id).order_by(Question.order)
    ).scalars().all()

    last_answers = state.last_answers or {}

    reveals = []
    for q in questions:
        correct_ids = []
        if q.type in ("single_choice", "multiple_choice"):
            correct_ids = list(db.scalars(
                select(AnswerOption.id).where(
                    AnswerOption.question_id == q.id,
                    AnswerOption.is_correct == True,
                )
            ).all())

        reveals.append(QuestionReveal(
            id=q.id,
            type=q.type,
            text_html=q.text_html,
            explanation_html=q.explanation_html,
            correct_option_ids=correct_ids,
            correct_numeric=float(q.correct_numeric) if q.correct_numeric is not None else None,
            correct_text=q.correct_text,
            student_answer=last_answers.get(str(q.id)),
        ))

    return QuizRevealResponse(
        item_id=item_id,
        attempt_count=state.attempt_count,
        score_correct=state.last_score_correct or 0,
        score_total=state.last_score_total or 0,
        questions=reveals,
    )
```

- [ ] **Step 4: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add quiz reveal endpoint for correct answers after max attempts"
```

---

## Summary

After completing all 3 tasks, Phase 5 delivers:

- **Evaluation service:** Pure-logic `evaluate_question()` supporting 4 question types
- **Submit endpoint:** `POST /api/items/{id}/submit` — accepts answers, evaluates server-side, stores in UserItemState
- **Reveal endpoint:** `GET /api/items/{id}/reveal` — serves correct answers + explanations only after max attempts

**Security properties:**
- Correct answers never exposed until max attempts reached
- Content endpoint already hides is_correct/correct_numeric/correct_text/explanation
- Submit requires enrollment check
- Max attempts enforced server-side

**Not included (deferred):**
- Quiz submission rate limiting (can be added later)
- Per-question feedback during attempts (only total score shown)
- Quiz retake/reset by admin
