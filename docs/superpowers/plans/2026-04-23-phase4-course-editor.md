# Phase 4: Course Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add question/answer CRUD endpoints, reordering, markdown rendering, and enhanced publish validation to complete the course editor backend.

**Architecture:** Question and AnswerOption CRUD follow the same patterns as existing block/sequence/item endpoints (state-aware editing matrix, course admin authorization). Markdown rendering is a standalone utility called on content save. Reorder endpoints use batch-update-in-transaction. Publish validation ensures quiz completeness before allowing state transition.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.x, Pydantic v2, markdown-it-py, bleach, pytest

**Spec:** `docs/superpowers/specs/2026-04-19-mathion-platform-design.md`

**Existing code:** 183 passing tests. Question and AnswerOption models already exist in `models.py`. Model-level tests exist in `tests/test_questions.py`. No API endpoints for questions/options yet.

---

## File Structure

### New files
- `backend/mathion/api/questions.py` — Question + AnswerOption CRUD endpoints
- `backend/mathion/markdown.py` — Markdown-to-HTML rendering utility
- `backend/tests/test_questions_api.py` — API tests for question/option CRUD
- `backend/tests/test_reorder.py` — Reorder endpoint tests
- `backend/tests/test_markdown.py` — Markdown rendering tests

### Modified files
- `backend/mathion/schemas.py` — Add Question/Option/Reorder schemas
- `backend/mathion/main.py` — Register questions router
- `backend/mathion/api/blocks.py` — Add reorder endpoint for blocks and sequences
- `backend/mathion/api/items.py` — Add reorder endpoint for items, integrate markdown rendering
- `backend/mathion/api/versions.py` — Enhanced publish validation
- `backend/pyproject.toml` — Add markdown-it-py and bleach dependencies

---

### Task 1: Question CRUD Endpoints

**Files:**
- Modify: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/questions.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_questions_api.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_questions_api.py`:

```python
from mathion.models import Item


def _make_quiz_via_api(admin_client):
    """Create course → version → block → sequence → quiz item via API, return IDs."""
    course = admin_client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1", "slug": "s1",
    }).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Quiz", "slug": "quiz", "type": "quiz",
    }).json()
    return {"course": course, "version": version, "block": block, "seq": seq, "item": item}


def test_create_question(admin_client):
    ids = _make_quiz_via_api(admin_client)
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "What is 2+2?",
        "type": "single_choice",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["text_md"] == "What is 2+2?"
    assert data["type"] == "single_choice"
    assert data["order"] == 1


def test_create_question_not_quiz_item(admin_client):
    """Cannot add questions to non-quiz items."""
    course = admin_client.post("/api/courses", json={"slug": "c1", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Page", "slug": "page", "type": "static_page", "content_md": "# Hi",
    }).json()
    response = admin_client.post(f"/api/items/{item['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    })
    assert response.status_code == 409


def test_create_question_published_state_blocked(admin_client):
    ids = _make_quiz_via_api(admin_client)
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    })
    assert response.status_code == 409


def test_list_questions(admin_client):
    ids = _make_quiz_via_api(admin_client)
    admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q1", "type": "single_choice"})
    admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q2", "type": "numeric_answer", "correct_numeric": 42, "precision": 0})
    response = admin_client.get(f"/api/items/{ids['item']['id']}/questions")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_update_question(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    response = admin_client.patch(f"/api/questions/{q['id']}", json={"text_md": "Updated?"})
    assert response.status_code == 200
    assert response.json()["text_md"] == "Updated?"


def test_update_question_published_state(admin_client):
    """In published state, can edit text_md and explanation_md but not type."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    }).json()
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")

    # Text edit should work
    response = admin_client.patch(f"/api/questions/{q['id']}", json={"text_md": "Updated?"})
    assert response.status_code == 200

    # Correct answer edit should work in published state
    response = admin_client.patch(f"/api/questions/{q['id']}", json={"correct_numeric": 99})
    assert response.status_code == 200


def test_delete_question(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    response = admin_client.delete(f"/api/questions/{q['id']}")
    assert response.status_code == 204


def test_delete_question_published_blocked(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    }).json()
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    response = admin_client.delete(f"/api/questions/{q['id']}")
    assert response.status_code == 409


def test_create_numeric_question_with_answer(admin_client):
    ids = _make_quiz_via_api(admin_client)
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "sqrt(4)?", "type": "numeric_answer", "correct_numeric": 2.0, "precision": 0,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["correct_numeric"] == 2.0
    assert data["precision"] == 0


def test_create_text_question_with_answer(admin_client):
    ids = _make_quiz_via_api(admin_client)
    response = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Chemical formula of water?", "type": "text_answer", "correct_text": "H2O",
    })
    assert response.status_code == 201
    assert response.json()["correct_text"] == "H2O"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/pytest tests/test_questions_api.py -v
```

Expected: FAIL — routes not found (404s)

- [ ] **Step 3: Add question schemas**

Add to `backend/mathion/schemas.py`:

```python
class QuestionCreate(BaseModel):
    text_md: str = Field(min_length=1)
    type: Literal["single_choice", "multiple_choice", "numeric_answer", "text_answer"]
    explanation_md: str | None = None
    correct_numeric: float | None = None
    precision: int | None = Field(default=None, ge=0)
    correct_text: str | None = None


class QuestionUpdate(BaseModel):
    text_md: str | None = Field(default=None, min_length=1)
    explanation_md: str | None = None
    correct_numeric: float | None = None
    precision: int | None = Field(default=None, ge=0)
    correct_text: str | None = None


class QuestionResponse(BaseModel):
    id: int
    item_id: int
    text_md: str
    text_html: str
    type: str
    order: int
    explanation_md: str | None
    explanation_html: str | None
    correct_numeric: float | None
    precision: int | None
    correct_text: str | None

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Implement question endpoints**

Create `backend/mathion/api/questions.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404, require_course_admin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import AnswerOption, Block, CourseVersion, Item, Question, Sequence
from mathion.models_auth import User
from mathion.schemas import QuestionCreate, QuestionResponse, QuestionUpdate

router = APIRouter(tags=["questions"])

_QUESTION_EDITABLE_PUBLISHED = {"text_md", "explanation_md", "correct_numeric", "precision", "correct_text"}


def _get_version_for_item(db: Session, item_id: int) -> tuple[Item, CourseVersion]:
    item = get_or_404(db, Item, item_id)
    seq = get_or_404(db, Sequence, item.sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    return item, version


def _get_version_for_question(db: Session, question_id: int) -> tuple[Question, CourseVersion]:
    question = get_or_404(db, Question, question_id)
    item = get_or_404(db, Item, question.item_id)
    seq = get_or_404(db, Sequence, item.sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    return question, version


@router.post("/api/items/{item_id}/questions", status_code=201, response_model=QuestionResponse)
def create_question(item_id: int, data: QuestionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item, version = _get_version_for_item(db, item_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add questions in 'created' state")
    if item.type != "quiz":
        raise HTTPException(status_code=409, detail="Can only add questions to quiz items")

    next_order = (db.scalar(select(func.max(Question.order)).where(Question.item_id == item_id)) or 0) + 1
    question = Question(
        item_id=item_id,
        text_md=data.text_md,
        text_html="",
        type=data.type,
        order=next_order,
        explanation_md=data.explanation_md,
        explanation_html="",
        correct_numeric=data.correct_numeric,
        precision=data.precision,
        correct_text=data.correct_text,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.get("/api/items/{item_id}/questions", response_model=list[QuestionResponse])
def list_questions(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item, version = _get_version_for_item(db, item_id)
    require_course_admin(db, user, version.course_id)
    questions = db.execute(
        select(Question).where(Question.item_id == item_id).order_by(Question.order)
    ).scalars().all()
    return questions


@router.patch("/api/questions/{question_id}", response_model=QuestionResponse)
def update_question(question_id: int, data: QuestionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit questions in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if version.state == "published":
        disallowed = set(updates.keys()) - _QUESTION_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(status_code=409, detail=f"Cannot edit {disallowed} in published state")

    for field, value in updates.items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/api/questions/{question_id}", status_code=204)
def delete_question(question_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete questions in 'created' state")
    db.delete(question)
    db.commit()
```

Register in `backend/mathion/main.py`:
```python
from mathion.api.questions import router as questions_router
app.include_router(questions_router)
```

- [ ] **Step 5: Run tests**

```bash
.venv/bin/pytest tests/ -v
```

Expected: all PASS (183 old + 10 new)

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add question CRUD endpoints with state validation"
```

---

### Task 2: AnswerOption CRUD Endpoints

**Files:**
- Modify: `backend/mathion/schemas.py`
- Modify: `backend/mathion/api/questions.py`
- Modify: `backend/tests/test_questions_api.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_questions_api.py`:

```python
def test_create_option(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    response = admin_client.post(f"/api/questions/{q['id']}/options", json={
        "text": "Answer A", "is_correct": False,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["text"] == "Answer A"
    assert data["is_correct"] is False
    assert data["order"] == 1


def test_create_option_non_choice_type_blocked(admin_client):
    """Cannot add options to numeric_answer or text_answer questions."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "numeric_answer", "correct_numeric": 42, "precision": 0,
    }).json()
    response = admin_client.post(f"/api/questions/{q['id']}/options", json={
        "text": "A", "is_correct": True,
    })
    assert response.status_code == 409


def test_list_options(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": False})
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": True})
    response = admin_client.get(f"/api/questions/{q['id']}/options")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_update_option(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": False}).json()
    response = admin_client.patch(f"/api/options/{opt['id']}", json={"text": "Updated A"})
    assert response.status_code == 200
    assert response.json()["text"] == "Updated A"


def test_update_option_is_correct_published(admin_client):
    """is_correct can be changed in published state."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")

    response = admin_client.patch(f"/api/options/{opt1['id']}", json={"is_correct": False})
    assert response.status_code == 200
    assert response.json()["is_correct"] is False


def test_delete_option(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    response = admin_client.delete(f"/api/options/{opt['id']}")
    assert response.status_code == 204


def test_delete_option_published_blocked(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")
    response = admin_client.delete(f"/api/options/{opt['id']}")
    assert response.status_code == 409
```

- [ ] **Step 2: Add option schemas**

Add to `backend/mathion/schemas.py`:

```python
class OptionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    is_correct: bool


class OptionUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    is_correct: bool | None = None


class OptionResponse(BaseModel):
    id: int
    question_id: int
    text: str
    is_correct: bool
    order: int

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: Implement option endpoints**

Add to `backend/mathion/api/questions.py`:

```python
from mathion.schemas import OptionCreate, OptionResponse, OptionUpdate

_OPTION_EDITABLE_PUBLISHED = {"text", "is_correct"}


def _get_version_for_option(db: Session, option_id: int) -> tuple[AnswerOption, CourseVersion]:
    option = get_or_404(db, AnswerOption, option_id)
    question = get_or_404(db, Question, option.question_id)
    item = get_or_404(db, Item, question.item_id)
    seq = get_or_404(db, Sequence, item.sequence_id)
    block = get_or_404(db, Block, seq.block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    return option, version


@router.post("/api/questions/{question_id}/options", status_code=201, response_model=OptionResponse)
def create_option(question_id: int, data: OptionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add options in 'created' state")
    if question.type not in ("single_choice", "multiple_choice"):
        raise HTTPException(status_code=409, detail="Options are only for choice-type questions")

    next_order = (db.scalar(select(func.max(AnswerOption.order)).where(AnswerOption.question_id == question_id)) or 0) + 1
    option = AnswerOption(
        question_id=question_id,
        text=data.text,
        is_correct=data.is_correct,
        order=next_order,
    )
    db.add(option)
    db.commit()
    db.refresh(option)
    return option


@router.get("/api/questions/{question_id}/options", response_model=list[OptionResponse])
def list_options(question_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    options = db.execute(
        select(AnswerOption).where(AnswerOption.question_id == question_id).order_by(AnswerOption.order)
    ).scalars().all()
    return options


@router.patch("/api/options/{option_id}", response_model=OptionResponse)
def update_option(option_id: int, data: OptionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    option, version = _get_version_for_option(db, option_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit options in archived versions")

    updates = data.model_dump(exclude_unset=True)
    if version.state == "published":
        disallowed = set(updates.keys()) - _OPTION_EDITABLE_PUBLISHED
        if disallowed:
            raise HTTPException(status_code=409, detail=f"Cannot edit {disallowed} in published state")

    for field, value in updates.items():
        setattr(option, field, value)
    db.commit()
    db.refresh(option)
    return option


@router.delete("/api/options/{option_id}", status_code=204)
def delete_option(option_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    option, version = _get_version_for_option(db, option_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete options in 'created' state")
    db.delete(option)
    db.commit()
```

- [ ] **Step 4: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add answer option CRUD endpoints with state validation"
```

---

### Task 3: Markdown Rendering

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `backend/mathion/markdown.py`
- Modify: `backend/mathion/api/items.py`
- Modify: `backend/mathion/api/questions.py`
- Create: `backend/tests/test_markdown.py`

- [ ] **Step 1: Add dependencies**

Add to `backend/pyproject.toml` under `[project.dependencies]`:
```
"markdown-it-py>=3.0",
"bleach>=6.0",
```

Install:
```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/pip install -e .
```

- [ ] **Step 2: Write failing tests**

Create `backend/tests/test_markdown.py`:

```python
from mathion.markdown import render_markdown


def test_render_basic_markdown():
    result = render_markdown("**bold** and *italic*")
    assert "<strong>bold</strong>" in result
    assert "<em>italic</em>" in result


def test_render_heading():
    result = render_markdown("# Title")
    assert "<h1>" in result


def test_render_sanitize_script():
    result = render_markdown('<script>alert("xss")</script>')
    assert "<script>" not in result


def test_render_preserves_latex_delimiters():
    result = render_markdown("Inline $x^2$ and block $$E=mc^2$$")
    assert "$x^2$" in result or "x^2" in result


def test_render_empty_string():
    result = render_markdown("")
    assert result == ""


def test_render_none():
    result = render_markdown(None)
    assert result == ""
```

- [ ] **Step 3: Implement markdown rendering**

Create `backend/mathion/markdown.py`:

```python
import bleach
from markdown_it import MarkdownIt

_md = MarkdownIt("commonmark", {"html": False})

_ALLOWED_TAGS = [
    "p", "br", "strong", "em", "b", "i", "u", "s",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "a", "img",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr", "sup", "sub",
]

_ALLOWED_ATTRS = {
    "a": ["href", "title"],
    "img": ["src", "alt", "title"],
}


def render_markdown(text: str | None) -> str:
    """Convert Markdown to sanitized HTML.

    LaTeX delimiters ($...$ and $$...$$) are preserved as-is
    for client-side rendering with KaTeX.
    """
    if not text:
        return ""
    html = _md.render(text)
    return bleach.clean(html, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, strip=True)
```

- [ ] **Step 4: Integrate into item and question saves**

Modify `backend/mathion/api/items.py` — in `create_item` and `update_item`, render content_md to content_html:

In `create_item`, change line `content_html=""` to:
```python
from mathion.markdown import render_markdown
content_html=render_markdown(data.content_md),
```

In `update_item`, after the setattr loop, add:
```python
if "content_md" in updates:
    item.content_html = render_markdown(item.content_md)
```

Modify `backend/mathion/api/questions.py` — in `create_question` and `update_question`:

In `create_question`:
```python
from mathion.markdown import render_markdown
text_html=render_markdown(data.text_md),
explanation_html=render_markdown(data.explanation_md),
```

In `update_question`, after the setattr loop:
```python
if "text_md" in updates:
    question.text_html = render_markdown(question.text_md)
if "explanation_md" in updates:
    question.explanation_html = render_markdown(question.explanation_md)
```

- [ ] **Step 5: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add markdown rendering with sanitization"
```

---

### Task 4: Reorder Endpoints

**Files:**
- Modify: `backend/mathion/schemas.py`
- Modify: `backend/mathion/api/blocks.py`
- Modify: `backend/mathion/api/items.py`
- Modify: `backend/mathion/api/questions.py`
- Create: `backend/tests/test_reorder.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_reorder.py`:

```python
def _setup_course(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "c1", "name": "C", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    return course, version


def test_reorder_blocks(admin_client):
    course, version = _setup_course(admin_client)
    b1 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    b2 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B2", "slug": "b2", "info": ""}).json()
    response = admin_client.post(f"/api/versions/{version['id']}/blocks/reorder", json={
        "order": [{"id": b2["id"], "order": 1}, {"id": b1["id"], "order": 2}],
    })
    assert response.status_code == 200
    blocks = admin_client.get(f"/api/versions/{version['id']}/blocks").json()
    assert blocks[0]["id"] == b2["id"]
    assert blocks[1]["id"] == b1["id"]


def test_reorder_blocks_published_blocked(admin_client):
    course, version = _setup_course(admin_client)
    b1 = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B1", "slug": "b1", "info": ""}).json()
    s1 = admin_client.post(f"/api/blocks/{b1['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    response = admin_client.post(f"/api/versions/{version['id']}/blocks/reorder", json={
        "order": [{"id": b1["id"], "order": 1}],
    })
    assert response.status_code == 409


def test_reorder_sequences(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    s1 = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S1", "slug": "s1"}).json()
    s2 = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S2", "slug": "s2"}).json()
    response = admin_client.post(f"/api/blocks/{b['id']}/sequences/reorder", json={
        "order": [{"id": s2["id"], "order": 1}, {"id": s1["id"], "order": 2}],
    })
    assert response.status_code == 200


def test_reorder_items(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    i1 = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "I1", "slug": "i1", "type": "quiz"}).json()
    i2 = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "I2", "slug": "i2", "type": "quiz"}).json()
    response = admin_client.post(f"/api/sequences/{s['id']}/items/reorder", json={
        "order": [{"id": i2["id"], "order": 1}, {"id": i1["id"], "order": 2}],
    })
    assert response.status_code == 200


def test_reorder_questions(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    q1 = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q1", "type": "single_choice"}).json()
    q2 = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q2", "type": "single_choice"}).json()
    response = admin_client.post(f"/api/items/{item['id']}/questions/reorder", json={
        "order": [{"id": q2["id"], "order": 1}, {"id": q1["id"], "order": 2}],
    })
    assert response.status_code == 200


def test_reorder_options(admin_client):
    course, version = _setup_course(admin_client)
    b = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    s = admin_client.post(f"/api/blocks/{b['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{s['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    q = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    o1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    o2 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False}).json()
    response = admin_client.post(f"/api/questions/{q['id']}/options/reorder", json={
        "order": [{"id": o2["id"], "order": 1}, {"id": o1["id"], "order": 2}],
    })
    assert response.status_code == 200
```

- [ ] **Step 2: Add reorder schema**

Add to `backend/mathion/schemas.py`:

```python
class ReorderItem(BaseModel):
    id: int
    order: int = Field(ge=1)


class ReorderRequest(BaseModel):
    order: list[ReorderItem] = Field(min_length=1)
```

- [ ] **Step 3: Implement reorder endpoints**

Add reorder endpoint to `backend/mathion/api/blocks.py`:

```python
from mathion.schemas import ReorderRequest

@router.post("/api/versions/{version_id}/blocks/reorder")
def reorder_blocks(version_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = get_or_404(db, CourseVersion, version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder in 'created' state")
    for entry in data.order:
        block = db.get(Block, entry.id)
        if not block or block.version_id != version_id:
            raise HTTPException(status_code=400, detail=f"Block {entry.id} not found in this version")
        block.order = entry.order
    db.commit()
    return {"status": "ok"}


@router.post("/api/blocks/{block_id}/sequences/reorder")
def reorder_sequences(block_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    block = get_or_404(db, Block, block_id)
    version = get_or_404(db, CourseVersion, block.version_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder in 'created' state")
    for entry in data.order:
        seq = db.get(Sequence, entry.id)
        if not seq or seq.block_id != block_id:
            raise HTTPException(status_code=400, detail=f"Sequence {entry.id} not found in this block")
        seq.order = entry.order
    db.commit()
    return {"status": "ok"}
```

Add reorder endpoint to `backend/mathion/api/items.py`:

```python
from mathion.schemas import ReorderRequest

@router.post("/api/sequences/{sequence_id}/items/reorder")
def reorder_items(sequence_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    version = _get_version_for_sequence(db, sequence_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder in 'created' state")
    for entry in data.order:
        item = db.get(Item, entry.id)
        if not item or item.sequence_id != sequence_id:
            raise HTTPException(status_code=400, detail=f"Item {entry.id} not found in this sequence")
        item.order = entry.order
    db.commit()
    return {"status": "ok"}
```

Add reorder endpoints to `backend/mathion/api/questions.py`:

```python
from mathion.schemas import ReorderRequest

@router.post("/api/items/{item_id}/questions/reorder")
def reorder_questions(item_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item, version = _get_version_for_item(db, item_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state == "archived":
        raise HTTPException(status_code=409, detail="Cannot reorder in archived state")
    for entry in data.order:
        q = db.get(Question, entry.id)
        if not q or q.item_id != item_id:
            raise HTTPException(status_code=400, detail=f"Question {entry.id} not found in this item")
        q.order = entry.order
    db.commit()
    return {"status": "ok"}


@router.post("/api/questions/{question_id}/options/reorder")
def reorder_options(question_id: int, data: ReorderRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question, version = _get_version_for_question(db, question_id)
    require_course_admin(db, user, version.course_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only reorder options in 'created' state")
    for entry in data.order:
        opt = db.get(AnswerOption, entry.id)
        if not opt or opt.question_id != question_id:
            raise HTTPException(status_code=400, detail=f"Option {entry.id} not found in this question")
        opt.order = entry.order
    db.commit()
    return {"status": "ok"}
```

- [ ] **Step 4: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add reorder endpoints for blocks, sequences, items, questions, options"
```

---

### Task 5: Enhanced Publish Validation

**Files:**
- Modify: `backend/mathion/api/versions.py`
- Modify: `backend/tests/test_versions.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_versions.py`:

```python
def test_publish_quiz_without_questions_fails(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q1", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409
    assert "question" in response.json()["detail"].lower()


def test_publish_choice_question_without_options_fails(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q2", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "single_choice"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409
    assert "option" in response.json()["detail"].lower()


def test_publish_numeric_question_without_answer_fails(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q3", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "numeric_answer"})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 409
    assert "correct_numeric" in response.json()["detail"].lower()


def test_publish_complete_quiz_succeeds(admin_client):
    course = admin_client.post("/api/courses", json={"slug": "q4", "name": "Q", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "slug": "b", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S", "slug": "s"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "slug": "quiz", "type": "quiz"}).json()
    q = admin_client.post(f"/api/items/{item['id']}/questions", json={"text_md": "Q?", "type": "single_choice"}).json()
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True})
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False})
    response = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 200
```

- [ ] **Step 2: Implement enhanced publish validation**

Modify `backend/mathion/api/versions.py` — in `publish_version`, after the existing block-has-sequences check, add:

```python
from mathion.models import Item, Question, AnswerOption

# Validate quiz completeness
items = db.execute(
    select(Item)
    .join(Sequence, Sequence.id == Item.sequence_id)
    .join(Block, Block.id == Sequence.block_id)
    .where(Block.version_id == version_id, Item.type == "quiz")
).scalars().all()

for item in items:
    questions = db.execute(
        select(Question).where(Question.item_id == item.id)
    ).scalars().all()
    if not questions:
        raise HTTPException(
            status_code=409,
            detail=f"Quiz '{item.title}' has no questions. Every quiz must have at least one question to publish.",
        )
    for q in questions:
        if q.type in ("single_choice", "multiple_choice"):
            options = db.execute(
                select(AnswerOption).where(AnswerOption.question_id == q.id)
            ).scalars().all()
            if len(options) < 2:
                raise HTTPException(
                    status_code=409,
                    detail=f"Question '{q.text_md[:50]}' needs at least 2 options to publish.",
                )
            correct_count = sum(1 for o in options if o.is_correct)
            if correct_count == 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"Question '{q.text_md[:50]}' needs at least one correct option to publish.",
                )
        elif q.type == "numeric_answer":
            if q.correct_numeric is None:
                raise HTTPException(
                    status_code=409,
                    detail=f"Question '{q.text_md[:50]}' is missing correct_numeric to publish.",
                )
        elif q.type == "text_answer":
            if not q.correct_text:
                raise HTTPException(
                    status_code=409,
                    detail=f"Question '{q.text_md[:50]}' is missing correct_text to publish.",
                )
```

- [ ] **Step 3: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add quiz completeness validation on publish"
```

---

## Summary

After completing all 5 tasks, Phase 4 delivers:

- **Question CRUD:** POST/GET/PATCH/DELETE with state-aware editing matrix
- **AnswerOption CRUD:** POST/GET/PATCH/DELETE for choice-type questions
- **Markdown rendering:** Auto-converts content_md to sanitized HTML on save
- **Reorder endpoints:** Batch reorder for blocks, sequences, items, questions, options
- **Enhanced publish validation:** Quiz items must have questions, questions must have correct answers

**Not included (deferred):**
- Asset management and validation (Phase 6)
- Server-side LaTeX/KaTeX rendering (client-side for now)
- Optimistic locking via updated_at (can be added later)
- Question type change prevention (immutable by design — no endpoint changes type)
