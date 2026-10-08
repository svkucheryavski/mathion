# Slice 5d: a calm quiz editor (overview + small editing modals) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the quiz item's long accordion form with a calm overview of compact question cards. Answers are edited in place, and the heavy text edits happen in small modals on top. Every edit saves itself.

**Architecture:**
- **Body.** The quiz item modal gets a new body, `QuizBody`, which shows one `QuestionCard` per question.
- **Edit slot.** One `QuizEdits` object, owned by the body and exposed as `ItemBodyApi.edits`, holds the single open edit (D10) and counts requests in flight. Every inline field (`InlineEdit`) and every level-3 modal takes that slot.
- **Locks.** Answer writes take a per-question lock: the `busyQuestions` set. Question add, move and delete take a per-quiz lock.
- **Backend.** The only backend change locks the parent question row in `create_option` and `update_option`, then clears the other correct answers of a single-choice question in the same transaction (D12).

**Tech Stack:**
- **Svelte:** Svelte 5.55, runes only, no JS/CSS dependencies.
- **Tests:** Vitest + jsdom, with `mount` / `unmount` / `flushSync` from `svelte`.
- **Backend:** FastAPI + SQLAlchemy 2 on PostgreSQL 17, tested with pytest through `backend/.venv`.
- **Gate:** the zsh gate `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-10-08-visual-refresh-slice5d-quiz-editor-design.md` (rev 5, approved by the user on 2026-10-08, commit `2c3e93a`).
**Mockup (authority for the look):** `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/mockups/quiz-modal-5d.html`. Its "± 0.01" line is stale; the spec's §Number is the rule.

## Global Constraints

- **Branch:** `feat/visual-refresh-slice5-authoring`. LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`. Scratch files go in `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/probe/`, never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. No new npm or pip dependencies.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, NOT `@testing-library/svelte`.
- **Colours:**
  - No literal colours in component CSS; theme tokens only.
  - The correct-answer tint is `--status-accepted-bg` / `--status-accepted-fg`, because the theme has no `--success-soft`.
  - No emoji in source. Icons come from `IconButton` glyphs: `pencil trash plus up down chevron chevron-right close check back`.
- **Commands:**
  - Frontend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run`. Green means exit 0 AND no `Errors` / `Unhandled` line in the output.
  - Typecheck: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error` must show 0 errors. 13 warnings is the baseline.
  - Gate: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp zsh scripts/visual-refresh-gate.sh`. It must end `ALL PASS (N checks)`. Never run it in two lanes at once.
  - Backend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`. Never call a bare `pytest` or `python`.
- **Per task, in this order:**
  1. TDD.
  2. If the screen changed: agent-browser screenshots in an overlay with `--size-percent 60` and images as base64, then the user's OK on the look.
  3. Two review lanes, Opus and Fable, on the UNCOMMITTED diff. Fix every Critical and Important finding, then re-run both lanes after EVERY fix until both are clean. Minors go to `docs/backlog/slice5d-quiz-editor-debt.md`.
  4. Commit with exact paths and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  5. Ledger line in `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/progress.md`, update memory, then WAIT for the user's OK before the next task.
- **Dev servers for screenshots** (both already run in this session; never start a second copy):
  - Backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && MATHION_DEBUG=1 .venv/bin/uvicorn mathion.main:app --reload`. The PIN appears in `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/backend.log`.
  - Frontend: `npx vite --port 5174 --strictPort`.
  - Admin login: `dev@mathion.test`. agent-browser session `AGENT_BROWSER_SESSION=mathion-5b`. Use ABSOLUTE screenshot paths.
  - Never save into the user's own "Draft X" (v11) without asking; screenshots that need writes use a separate demo draft the user agrees to.
- **Permission rule (D13):** controls the version state forbids are not rendered. A momentary or local block (a write in flight, a first/last arrow, the only correct answer, the last correct mark, a saving field) is disabled, with its reason as the tooltip. The one exception is the header trash, which stays disabled with its reason (5b D9).
- **Texts, verbatim from the spec:**
  - Discard prompt: `Discard unsaved changes and continue?`
  - Wait tooltip: `Wait for the save to finish`
  - Published key confirm: `This quiz is published. Changing the answer key does not re-score students who already attempted — their recorded scores keep the old key. To re-grade everyone, create a new version instead. Continue?`
  - Explanation note: `Markdown. Images already in an explanation keep working; new ones cannot be added here.`
  - Remove confirm: `Remove the explanation for question N?`
  - Live region: `Question moved to position N of M`, `Answer moved to position N of M`, `Saved`
  - Trash tooltips: `Delete this item — wait for the save to finish` and `Delete this item — finish or discard the open edit first`. The second wins when both apply.

## Rulings made while planning

- **R1 — The item modal switches to the new body in T3, and the old quiz editor is removed in the same task.**
  - Removed: `QuizEditor`, `QuestionAccordion`, `OptionRow`, `lib/quizSave` and their tests and gate rows.
  - T3–T8 commits show a quiz editor that gains its edit features task by task. The branch is local and nothing ships between tasks.
  - *Cost if wrong:* a mid-slice checkout can't edit some quiz parts.
- **R2 — The header title's error renders as the first line of the modal body.**
  - The shared `Modal` header is one flex row, so an error "under the field" in the header would be clipped or would widen the row.
  - The input points at the error with `aria-describedby`. ✓ and ✕ sit after the `h2`.
  - *Cost if wrong:* move one element.
- **R3 — The optional `ItemBodyApi` member is `edits?: QuizEdits`** (the spec: "the plan names it").
- **R4 — New quiz components live in `src/components/editor/quiz/`.** The body is `QuizBody.svelte`, and the name `QuizEditor` is retired.
- **R5 — ✓ shows "busy" through its tooltip and name, "Saving…".** `IconButton` has no loading state, and adding one would change a shared component for one use.
- **R6 — Focus fallback is explicit.** `QuizBody.focusFallback(qid)` runs after a Retry, after a 403/409 reload, and after a level-3 close whose opener is gone. There is no DOM observer.
- **R7 — The question delete confirm keeps today's text:** `Delete question "<first 80 characters of the text>"? This cannot be undone.`
- **R8 — A failed Number/Text answer save re-fetches nothing.** Those answers are question fields, and the field keeps the typed value and the error. The spec's "re-fetch that question's answers" applies to choice answers.
- **R9 — Gate anchors use 5d-unique class names** (`.qcard`, `.ans-row`, …), so `own` / `uniq1` resolve each to one file. Each task adds its own rows and bumps `EXPECTED_CHECKS` by exactly the number of rows it added minus the rows it removed.

## Review Focus

These are the five failure modes most likely to bite an author. Each is pinned by a test in the owning task.

1. **A single-choice question always ends with exactly one correct answer.** This covers two clicks at once, a create racing a move, and old data that already has two correct answers. → T1 concurrency tests; T5 "single choice: one PATCH, then the others clear locally" and "old two-correct data: clicking a correct answer sends the PATCH".
2. **A saving field is never lost or doubled.** Double Enter sends one request. Esc while saving does nothing and the modal stays open. Other edit-opening controls are disabled. A failure keeps the typed text, and a failure after the modal closed is a toast. → T2 `InlineEdit` unit tests; T5 "a saving answer field blocks the other edit controls"; T7 "Back during a level-3 save does not prompt; a late failure toasts".
3. **Published answer-key changes ask first, after the D10 prompt, and Cancel sends nothing.** → T5 "published: the marker asks first; Cancel keeps the key"; T6 "the D10 prompt comes before the key confirm; Cancel on the confirm keeps the field".
4. **Focus never drops to `<body>`.** This covers a move to the first/last place, deleting the last answer, a level-3 opener that was replaced, and a Retry. → T5 "moving to the top keeps focus on the other arrow"; T7 "\"+ Add explanation\" opens it … focus goes to the new ✎"; T8 "delete confirms; focus goes to the next card, then the previous, then + Add question" and "a 409 on save … survives the permission flip" (focus falls back to ×).
5. **An open edit survives a 403/409 permission flip.** The typed text stays and the save is blocked. → T8 "a 409 on save keeps the field open with its text and reloads the tree; it survives the permission flip".

## File map

**Backend**
- Modify `backend/mathion/api/questions.py`:
  - `_lock_question()`;
  - `create_option` / `update_option` lock first and clear the other correct answers.
- Modify `backend/tests/test_questions_api.py` with the D12 behaviour tests and the rewritten `test_update_option_is_correct_published`.
- Create `backend/tests/test_concurrency_options.py` with two interleaved races.

**Frontend libraries**
- Create `frontend/src/lib/quizFormat.ts` with the chip labels, the Number formatting, hints, `cutName` and `sameNumber`. Test: `frontend/src/lib/quizFormat.test.ts`.
- Create `frontend/src/lib/newTabLinks.ts`, the attachment that sets `target="_blank"` on links.
- Create `frontend/src/lib/quizEdits.svelte.ts` with `QuizEdits`, `InlineEdit`, `DISCARD_PROMPT`, `WAIT_TITLE` and `KEY_CONFIRM`. Test: `frontend/src/tests/quizEdits.test.ts`.
- Modify `frontend/src/lib/itemBody.ts`: `ItemBodyApi.edits?: QuizEdits`.

**Frontend shared UI**
- Modify `frontend/src/components/ui/FocusTrap.svelte`: the optional `active` getter.
- Modify `frontend/src/components/ui/Modal.svelte`: pass `active={isTop}`.
- Modify `frontend/src/components/editor/MarkdownEditor.svelte`: the `noAssets` mode.
- Modify `frontend/src/components/editor/QuestionTypePicker.svelte`: the chip labels.
- Modify `frontend/src/components/editor/ItemEditorModal.svelte`:
  - the quiz uses `QuizBody`, with no footer and no Title row;
  - the inline header title;
  - the trash tooltips;
  - the ⌘S rule;
  - first focus.

**Frontend quiz components** (all in `frontend/src/components/editor/quiz/`)
- `QuizBody.svelte` — the list, "+ Add question", move/delete, the live region, `edits`.
- `QuestionCard.svelte` — one card: text, chip, hints, answers, explanation, level-3 openers.
- `ChoiceAnswers.svelte` — load / Retry, marker, text edit, add row, move, delete.
- `ChoiceRow.svelte` — one answer row.
- `KeyAnswer.svelte` — the Number/Text line and its inline editor.
- `InlineInput.svelte` — the markup of a text `InlineEdit`.
- `QuestionTextModal.svelte`, `ExplanationModal.svelte`, `NewQuestionModal.svelte` — the level-3 modals.

**Frontend deleted** (T3)
- `frontend/src/components/editor/QuizEditor.svelte`, `QuestionAccordion.svelte`, `OptionRow.svelte`.
- `frontend/src/lib/quizSave.ts`.
- `frontend/src/tests/QuizEditor.svelte.test.ts`, `QuestionAccordion.svelte.test.ts`, `OptionRow.svelte.test.ts`, `support/QuestionAccordionHarness.svelte`.

**Frontend tests**
- Create `frontend/src/tests/support/quizHarness.svelte.ts`: the real `ItemEditorModal` over a stubbed in-memory quiz server.
- Create one test file per task: `QuizOverview` (T3), `QuizHeader` (T4), `ChoiceAnswers` (T5), `KeyAnswer` (T6), `QuizModals` (T7), `QuizStructure` (T8), each a `.svelte.test.ts`.
- Modify `ItemEditorModal.svelte.test.ts`, `FocusTrap.svelte.test.ts`, `Modal.svelte.test.ts`, `MarkdownEditor.svelte.test.ts`, `QuestionTypePicker.svelte.test.ts`.

**Gate and backlog**
- Modify `frontend/scripts/visual-refresh-gate.sh`:
  - section (ae) shrinks to the type picker;
  - (af)/(ag) drop the removed files;
  - a new section (ai) holds 5d.
- Create `docs/backlog/slice5d-quiz-editor-debt.md`.

---

### Task 1: Backend — one correct answer on a single-choice question (D12)

**Files:**
- Modify: `backend/mathion/api/questions.py` (imports; `create_option` at :174; `update_option` at :214)
- Modify: `backend/tests/test_questions_api.py` (rewrite `test_update_option_is_correct_published` at :182; add tests at the end)
- Create: `backend/tests/test_concurrency_options.py`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `POST /api/questions/{id}/options` and `PATCH /api/options/{id}` keep their request and response shapes.
  - Marking an answer correct on a `single_choice` question (create or update) leaves it the only correct answer.
  - Both endpoints call `advisory.interleave_hook("option_after_question_lock")` right after locking the question row.

- [ ] **Step 1: Write the failing behaviour tests.** Append to `backend/tests/test_questions_api.py`, and replace the body of `test_update_option_is_correct_published`:

```python
def test_update_option_is_correct_published(admin_client):
    """is_correct can be changed in published state; on single choice the old
    correct answer is cleared in the same request (5d D12)."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opt1 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    opt2 = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False}).json()
    admin_client.post(f"/api/versions/{ids['version']['id']}/publish")

    response = admin_client.patch(f"/api/options/{opt2['id']}", json={"is_correct": True})
    assert response.status_code == 200
    assert response.json()["is_correct"] is True
    marks = {o["id"]: o["is_correct"] for o in admin_client.get(f"/api/questions/{q['id']}/options").json()}
    assert marks == {opt1["id"]: False, opt2["id"]: True}
```

```python
def _single_choice(admin_client, *marks):
    """A single-choice question with one option per mark, created in order."""
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opts = [
        admin_client.post(f"/api/questions/{q['id']}/options", json={"text": f"O{i}", "is_correct": m}).json()
        for i, m in enumerate(marks)
    ]
    return q, opts


def _marks(admin_client, qid):
    return [o["is_correct"] for o in admin_client.get(f"/api/questions/{qid}/options").json()]


def test_single_choice_mark_correct_clears_the_old_one(admin_client):
    q, (a, b, c) = _single_choice(admin_client, True, False, False)
    r = admin_client.patch(f"/api/options/{c['id']}", json={"is_correct": True})
    assert r.status_code == 200
    assert _marks(admin_client, q["id"]) == [False, False, True]


def test_single_choice_create_correct_clears_the_old_one(admin_client):
    q, _ = _single_choice(admin_client, True, False)
    r = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "New", "is_correct": True})
    assert r.status_code == 201
    assert _marks(admin_client, q["id"]) == [False, False, True]


def test_single_choice_repairs_two_correct_answers(admin_client, db):
    """Old data (the 5b two-step swap could leave it) has two correct answers;
    marking one of them correct leaves only that one."""
    q, (a, b) = _single_choice(admin_client, True, False)
    db.execute(update(AnswerOption).where(AnswerOption.id == b["id"]).values(is_correct=True))
    db.commit()
    assert _marks(admin_client, q["id"]) == [True, True]
    r = admin_client.patch(f"/api/options/{a['id']}", json={"is_correct": True})
    assert r.status_code == 200
    assert _marks(admin_client, q["id"]) == [True, False]


def test_multiple_choice_keeps_every_mark(admin_client):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "multiple_choice",
    }).json()
    a = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}).json()
    b = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False}).json()
    assert admin_client.patch(f"/api/options/{b['id']}", json={"is_correct": True}).status_code == 200
    assert _marks(admin_client, q["id"]) == [True, True]
    assert admin_client.patch(f"/api/options/{a['id']}", json={"is_correct": False}).status_code == 200
    assert admin_client.patch(f"/api/options/{b['id']}", json={"is_correct": False}).status_code == 422


def test_text_only_update_does_not_touch_the_marks(admin_client):
    q, (a, b) = _single_choice(admin_client, True, False)
    assert admin_client.patch(f"/api/options/{b['id']}", json={"text": "Renamed"}).status_code == 200
    assert _marks(admin_client, q["id"]) == [True, False]
```

Add to the imports at the top of the file, after the existing imports:

```python
from sqlalchemy import update

from mathion.models import AnswerOption
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_questions_api.py`

Expected: FAIL, in exactly these four tests:
- `test_update_option_is_correct_published` (marks `True, True`);
- `test_single_choice_mark_correct_clears_the_old_one`;
- `test_single_choice_create_correct_clears_the_old_one`;
- `test_single_choice_repairs_two_correct_answers` (the last assert).

Every other test passes.

- [ ] **Step 3: Write the failing concurrency tests.** Create `backend/tests/test_concurrency_options.py`:

```python
"""Slice 5d D12 — a single-choice question ends with exactly one correct answer
under concurrency. create_option and update_option lock the parent QUESTION row
first (questions._lock_question), then call
advisory.interleave_hook("option_after_question_lock"). Locking only the option
rows would not cover inserts: two creates on an empty question have no rows to
lock.

Off-HTTP, as the other concurrency suites: thread bodies call the router
functions directly with per-thread NullPool sessions; handlers RAISE
HTTPException."""
import threading
import time

from sqlalchemy import select, text

from mathion.api import advisory
from mathion.api.questions import create_option, update_option
from mathion.models import AnswerOption
from mathion.models_auth import User
from mathion.schemas import OptionCreate, OptionUpdate
from tests.test_questions_api import _make_quiz_via_api

HOOK = "option_after_question_lock"


def _pid(session):
    return session.execute(text("SELECT pg_backend_pid()")).scalar()


def _wait_blocked(probe, blocked_pid, by_pid, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        blocked = probe.execute(
            text("SELECT :b = ANY(pg_blocking_pids(:a))"), {"a": blocked_pid, "b": by_pid},
        ).scalar()
        probe.rollback()
        if blocked:
            return True
        time.sleep(0.05)
    return False


def _park_first(monkeypatch):
    """The first worker to reach the hook waits on `gate` (holding the question
    lock); every later arrival passes straight through."""
    gate, parked, mutex, taken = threading.Event(), threading.Event(), threading.Lock(), []
    real = advisory.interleave_hook

    def hook(label):
        if label == HOOK:
            with mutex:
                first = not taken
                taken.append(1)
            if first:
                parked.set()
                gate.wait(timeout=10)
        return real(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    return gate, parked


def _admin(session):
    return session.execute(select(User).where(User.email == "admin@example.com")).scalar_one()


def _run(fn, session, result, *args):
    try:
        fn(*args, db=session, user=_admin(session))
        result["ok"] = True
    except Exception as exc:  # noqa: BLE001 — the assertion reports it
        result["error"] = exc


def _question(admin_client, *marks):
    ids = _make_quiz_via_api(admin_client)
    q = admin_client.post(f"/api/items/{ids['item']['id']}/questions", json={
        "text_md": "Q?", "type": "single_choice",
    }).json()
    opts = [
        admin_client.post(f"/api/questions/{q['id']}/options", json={"text": f"O{i}", "is_correct": m}).json()
        for i, m in enumerate(marks)
    ]
    return q, opts


def _correct(session, qid):
    rows = session.execute(
        select(AnswerOption.text).where(AnswerOption.question_id == qid, AnswerOption.is_correct.is_(True))
    ).scalars().all()
    session.rollback()
    return sorted(rows)


def test_two_concurrent_moves_end_with_one_correct(concurrency, monkeypatch, admin_client):
    q, (_, b, c) = _question(admin_client, True, False, False)
    gate, parked = _park_first(monkeypatch)
    sa, sb, probe = concurrency.make_sessions(3)
    pa, pb = _pid(sa), _pid(sb)
    ra, rb = {}, {}

    concurrency.spawn(_run, update_option, sa, ra, b["id"], OptionUpdate(is_correct=True))
    assert parked.wait(timeout=10), "worker A never reached the hook after the question lock"
    concurrency.spawn(_run, update_option, sb, rb, c["id"], OptionUpdate(is_correct=True))
    assert _wait_blocked(probe, pb, pa), "worker B did not wait on A's question lock"
    gate.set()
    for t in list(concurrency.threads):
        t.join(timeout=15)

    assert ra.get("ok") and rb.get("ok"), (ra, rb)
    assert _correct(probe, q["id"]) == ["O2"]


def test_two_concurrent_correct_creates_end_with_one_correct(concurrency, monkeypatch, admin_client):
    q, _ = _question(admin_client)
    gate, parked = _park_first(monkeypatch)
    sa, sb, probe = concurrency.make_sessions(3)
    pa, pb = _pid(sa), _pid(sb)
    ra, rb = {}, {}

    concurrency.spawn(_run, create_option, sa, ra, q["id"], OptionCreate(text="A", is_correct=True))
    assert parked.wait(timeout=10), "worker A never reached the hook after the question lock"
    concurrency.spawn(_run, create_option, sb, rb, q["id"], OptionCreate(text="B", is_correct=True))
    assert _wait_blocked(probe, pb, pa), "worker B did not wait on A's question lock"
    gate.set()
    for t in list(concurrency.threads):
        t.join(timeout=15)

    assert ra.get("ok") and rb.get("ok"), (ra, rb)
    assert _correct(probe, q["id"]) == ["B"]
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_concurrency_options.py`

Expected: FAIL, both tests, on `worker A never reached the hook after the question lock`. Today neither endpoint calls the hook.

- [ ] **Step 5: Implement.** In `backend/mathion/api/questions.py`:

  1. Imports. Change the first two lines and add the advisory import:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from mathion.api import advisory
```

  2. After `_get_version_for_option`, add:

```python
def _lock_question(db: Session, question_id: int) -> Question:
    """5d D12: serialise every option create and every correctness change on one
    question. Taken BEFORE anything is written for the option: writing first
    would lock the answer row ahead of the question row, and two requests could
    deadlock. populate_existing refreshes a row this session already holds."""
    question = db.execute(
        select(Question)
        .where(Question.id == question_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    # Through the module attribute, so the concurrency tests' monkeypatch applies.
    advisory.interleave_hook("option_after_question_lock")
    return question


def _clear_other_correct(db: Session, question_id: int, keep_id: int) -> None:
    """A single-choice question has one correct answer: the one just marked."""
    db.execute(
        update(AnswerOption)
        .where(AnswerOption.question_id == question_id, AnswerOption.id != keep_id)
        .values(is_correct=False)
    )
```

  3. In `create_option`, replace everything from `current_max_order = …` to `return option` with:

```python
    question = _lock_question(db, question_id)
    current_max_order = db.scalar(select(func.max(AnswerOption.order)).where(AnswerOption.question_id == question_id)) or 0
    if current_max_order >= INT4_MAX:
        raise HTTPException(
            status_code=409,
            detail="Cannot add another option: the order sequence is exhausted.",
        )
    option = AnswerOption(
        question_id=question_id,
        text=data.text,
        is_correct=data.is_correct,
        order=current_max_order + 1,
    )
    db.add(option)
    db.flush()
    if option.is_correct and question.type == "single_choice":
        _clear_other_correct(db, question_id, option.id)
    db.commit()
    db.refresh(option)
    return option
```

  4. In `update_option`, replace everything from `for field, value in updates.items():` to `return option` with:

```python
    question = None
    if "is_correct" in updates:
        question = _lock_question(db, option.question_id)
        option = db.execute(
            select(AnswerOption)
            .where(AnswerOption.id == option_id)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if option is None:
            raise HTTPException(status_code=404, detail="Option not found")

    for field, value in updates.items():
        setattr(option, field, value)

    if question is not None:
        if option.is_correct:
            if question.type == "single_choice":
                db.flush()
                _clear_other_correct(db, question.id, option.id)
        else:
            # Cannot remove the last correct option (autoflush sends ours first).
            correct_count = db.scalar(
                select(func.count()).select_from(AnswerOption).where(
                    AnswerOption.question_id == option.question_id,
                    AnswerOption.is_correct.is_(True),
                )
            )
            if correct_count == 0:
                raise HTTPException(status_code=422, detail="At least one option must be correct")

    db.commit()
    db.refresh(option)
    return option
```

- [ ] **Step 6: Run the new tests and the whole backend suite**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_questions_api.py tests/test_concurrency_options.py`
Expected: all PASS.

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`
Expected: all PASS. Unchanged tests that matter here:
- `test_update_option_cannot_remove_last_correct` (422);
- `test_create_option_disabled_version_blocked` (403);
- `test_update_option_archived_blocked` (409);
- `test_quiz_api.py`, which uses multiple choice.

- [ ] **Step 7: Review lanes and commit.** There are no screenshots for this task (no screen change). Run both lanes on the uncommitted diff, fix, and repeat until clean. Then:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add backend/mathion/api/questions.py backend/tests/test_questions_api.py backend/tests/test_concurrency_options.py && git commit -m "feat(api): Slice 5d T1 — single-choice correct answer clears the others under a question lock (D12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Groundwork — formats, the edit slot, FocusTrap, the no-assets editor, the picker labels

**Files:**
- Create: `frontend/src/lib/quizFormat.ts`, `frontend/src/lib/quizFormat.test.ts`
- Create: `frontend/src/lib/newTabLinks.ts`
- Create: `frontend/src/lib/quizEdits.svelte.ts`, `frontend/src/tests/quizEdits.test.ts`
- Modify: `frontend/src/components/ui/FocusTrap.svelte`, `frontend/src/components/ui/Modal.svelte:133`
- Modify: `frontend/src/tests/FocusTrap.svelte.test.ts`, `frontend/src/tests/Modal.svelte.test.ts`
- Create: `frontend/src/tests/support/NestedModalHarness.svelte`
- Modify: `frontend/src/components/editor/MarkdownEditor.svelte`, `frontend/src/tests/MarkdownEditor.svelte.test.ts`
- Modify: `frontend/src/components/editor/QuestionTypePicker.svelte:6-11`, `frontend/src/tests/QuestionTypePicker.svelte.test.ts:29`

**Interfaces:**
- Consumes: `validateNumericAnswer`, `AuthoringOption` and `QuestionType` from `lib/quizAuthoring.ts`; `ApiError` from `lib/api.ts`; `pushToast` from `stores/toasts.svelte.ts`.
- Produces:
  - `TYPE_LABEL: Record<QuestionType, string>`
  - `formatNumber(n: number): string`
  - `decimalsText(d: number): string`
  - `toleranceText(d: number): string`
  - `cutName(text: string, max?: number): string`
  - `questionHints(type: QuestionType, options: AuthoringOption[] | null, precision: number | null): string[]`
  - `sameNumber(typed: string, stored: number | null): boolean`
  - `newTabLinks(html: string): (el: HTMLElement) => void`
  - `class QuizEdits`, with:
    - `active: EditHandle | null`
    - `inFlight: boolean`
    - `locked: boolean`
    - `dirty: boolean`
    - `message: string`, `say(text: string)` (the live region; a successful `InlineEdit` save says "Saved")
    - `request(id?: string): boolean`
    - `open(h)`, `release(h)`, `discardAll()`
    - `track<T>(p: Promise<T>): Promise<T>`
  - `type EditHandle = { readonly id: string; readonly dirty: boolean; readonly saving: boolean; close(refocus: boolean): void }`
  - `class InlineEdit<T>`, with:
    - `value: T`
    - `error: string | null`
    - `saving: boolean`
    - `handle: EditHandle`
    - `attach(): () => void`
    - `cancel()`
    - `commit(): Promise<void>`
    - `keydown(e: KeyboardEvent)`
  - `type InlineOptions<T>`
  - `DISCARD_PROMPT`, `WAIT_TITLE`, `KEY_CONFIRM` (strings).
  - `FocusTrap` prop `active?: () => boolean`.
  - `MarkdownEditor` prop `noAssets?: boolean`.

- [ ] **Step 1: Write the failing format tests.** Create `frontend/src/lib/quizFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TYPE_LABEL, formatNumber, decimalsText, toleranceText, cutName, questionHints, sameNumber,
} from './quizFormat';
import type { AuthoringOption } from './quizAuthoring';

const opt = (id: number, is_correct: boolean): AuthoringOption =>
  ({ id, question_id: 1, text: `A${id}`, is_correct, order: id });

describe('quizFormat', () => {
  it('chip labels (and the picker) use the four sans names', () => {
    expect(Object.values(TYPE_LABEL)).toEqual(['Single choice', 'Multiple choice', 'Number', 'Text']);
  });

  it('formatNumber never uses exponent notation', () => {
    expect(formatNumber(1e-7)).toBe('0.0000001');
    expect(formatNumber(5)).toBe('5');
    expect(formatNumber(1234567890.12345)).toBe('1234567890.12345');
    expect(formatNumber(-0.25)).toBe('-0.25');
  });

  it('decimals read "1 decimal" and "N decimals"', () => {
    expect(decimalsText(0)).toBe('0 decimals');
    expect(decimalsText(1)).toBe('1 decimal');
    expect(decimalsText(2)).toBe('2 decimals');
  });

  it('the tolerance prints with decimals + 1 places, never as 5e-7', () => {
    expect(toleranceText(0)).toBe('± 0.5');
    expect(toleranceText(2)).toBe('± 0.005');
    expect(toleranceText(6)).toBe('± 0.0000005');
    expect(toleranceText(10)).toBe('± 0.00000000005');
  });

  it('cutName keeps 40 characters and adds an ellipsis', () => {
    expect(cutName('x'.repeat(40))).toBe('x'.repeat(40));
    expect(cutName('y'.repeat(41))).toBe(`${'y'.repeat(40)}…`);
    expect(cutName('  padded  ')).toBe('padded');
  });

  it('hints wait for the answers to load', () => {
    expect(questionHints('single_choice', null, null)).toEqual([]);
  });

  it('hints for choice questions', () => {
    expect(questionHints('single_choice', [], null)).toEqual(['No answers yet']);
    expect(questionHints('single_choice', [opt(1, true)], null)).toEqual(['Add at least 2 answers']);
    expect(questionHints('multiple_choice', [opt(1, false), opt(2, false)], null)).toEqual(['No correct answer']);
    expect(questionHints('single_choice', [opt(1, true), opt(2, true)], null)).toEqual(['More than one correct']);
    expect(questionHints('multiple_choice', [opt(1, true), opt(2, true)], null)).toEqual([]);
  });

  it('hints for Number and Text', () => {
    expect(questionHints('numeric_answer', null, null)).toEqual(['Decimals not set']);
    expect(questionHints('numeric_answer', null, 2)).toEqual([]);
    expect(questionHints('text_answer', null, null)).toEqual([]);
  });

  it('sameNumber compares canonical forms', () => {
    expect(sameNumber('5.0', 5)).toBe(true);
    expect(sameNumber('5.1', 5)).toBe(false);
    expect(sameNumber('0.0000001', 1e-7)).toBe(true);
    expect(sameNumber('', null)).toBe(true);
    expect(sameNumber('4', null)).toBe(false);
    expect(sameNumber('abc', 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/lib/quizFormat.test.ts`
Expected: FAIL with `Failed to resolve import "./quizFormat"`.

- [ ] **Step 3: Implement.** Create `frontend/src/lib/quizFormat.ts`:

```ts
// Slice-5d display rules for the quiz overview (spec §A question card,
// §Answers): the type chips, the Number line and the light hints.
import { validateNumericAnswer, type AuthoringOption, type QuestionType } from './quizAuthoring';

export const TYPE_LABEL: Record<QuestionType, string> = {
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  numeric_answer: 'Number',
  text_answer: 'Text',
};

// The stored answer is a JSON float; this prints it as authors typed it and
// never in exponent notation (String(1e-7) would give "1e-7").
const NUMBER = new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 15 });
export function formatNumber(n: number): string {
  return NUMBER.format(n);
}

export function decimalsText(d: number): string {
  return d === 1 ? '1 decimal' : `${d} decimals`;
}

/** "± 0.005" for 2 decimals: half a unit in the last place. */
export function toleranceText(d: number): string {
  return `± ${(5 * 10 ** -(d + 1)).toFixed(d + 1)}`;
}

/** Answer text in the names of the marker, the arrows and delete. */
export function cutName(text: string, max = 40): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** D9: light hints, in display order. `options` is null until they load. */
export function questionHints(
  type: QuestionType, options: AuthoringOption[] | null, precision: number | null,
): string[] {
  if (type === 'numeric_answer') return precision == null ? ['Decimals not set'] : [];
  if (type === 'text_answer' || options === null) return [];
  if (options.length === 0) return ['No answers yet'];
  const hints: string[] = [];
  if (options.length === 1) hints.push('Add at least 2 answers');
  const correct = options.filter((o) => o.is_correct).length;
  if (correct === 0) hints.push('No correct answer');
  if (type === 'single_choice' && correct > 1) hints.push('More than one correct');
  return hints;
}

/** A Number edit is unchanged when its canonical form matches the stored one ("5.0" vs 5). */
export function sameNumber(typed: string, stored: number | null): boolean {
  if (stored == null) return typed.trim() === '';
  const t = validateNumericAnswer(typed);
  const s = validateNumericAnswer(formatNumber(stored));
  return t.ok && s.ok && t.canonical === s.canonical;
}
```

Create `frontend/src/lib/newTabLinks.ts`:

```ts
// Slice-5d: links in rendered question text and explanations open in a new tab,
// so a click never leaves the editor. The server's sanitiser already adds
// rel="noopener noreferrer" (backend markdown.py). Pass the HTML so the
// attachment runs again whenever it changes.
export function newTabLinks(_html: string) {
  return (el: HTMLElement): void => {
    for (const a of el.querySelectorAll('a[href]')) a.setAttribute('target', '_blank');
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/lib/quizFormat.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing edit-slot tests.** Create `frontend/src/tests/quizEdits.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  QuizEdits, InlineEdit, DISCARD_PROMPT, type EditHandle, type InlineOptions,
} from '../lib/quizEdits.svelte';
import { ApiError } from '../lib/api';
import { toasts, clearToasts } from '../stores/toasts.svelte';

afterEach(() => { vi.restoreAllMocks(); clearToasts(); });

function handle(over: { dirty?: boolean; saving?: boolean } = {}, id = 'a') {
  const close = vi.fn();
  const h: EditHandle = { id, dirty: over.dirty ?? false, saving: over.saving ?? false, close };
  return { h, close };
}

describe('QuizEdits (D10)', () => {
  it('lets any action through when nothing is open', () => {
    expect(new QuizEdits().request()).toBe(true);
  });

  it('lets the open edit act on itself', () => {
    const e = new QuizEdits();
    e.open(handle({ dirty: true }).h);
    expect(e.request('a')).toBe(true);
  });

  it('closes a clean edit silently, without moving focus', () => {
    const e = new QuizEdits();
    const { h, close } = handle();
    e.open(h);
    const ask = vi.spyOn(window, 'confirm');
    expect(e.request()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('asks before discarding a changed edit', () => {
    const e = new QuizEdits();
    const { h, close } = handle({ dirty: true });
    e.open(h);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(e.request()).toBe(false);
    expect(ask).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(close).not.toHaveBeenCalled();
    expect(e.active).toBe(h);
    ask.mockReturnValue(true);
    expect(e.request()).toBe(true);
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('never closes a saving edit, and a saving edit is not unsaved work', () => {
    const e = new QuizEdits();
    const { h, close } = handle({ dirty: true, saving: true });
    e.open(h);
    const ask = vi.spyOn(window, 'confirm');
    expect(e.request()).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(e.locked).toBe(true);
    expect(e.dirty).toBe(false);
    e.discardAll();
    expect(close).not.toHaveBeenCalled();
  });

  it('dirty is an open, changed, not-saving edit; discardAll closes it', () => {
    const e = new QuizEdits();
    expect(e.dirty).toBe(false);
    const { h, close } = handle({ dirty: true });
    e.open(h);
    expect(e.dirty).toBe(true);
    e.discardAll();
    expect(close).toHaveBeenCalledWith(false);
    expect(e.active).toBeNull();
  });

  it('release clears only its own handle', () => {
    const e = new QuizEdits();
    const a = handle().h;
    const b = handle({}, 'b').h;
    e.open(a);
    e.release(b);
    expect(e.active).toBe(a);
    e.release(a);
    expect(e.active).toBeNull();
  });

  it('say clears the message, then sets it', async () => {
    const e = new QuizEdits();
    e.say('Saved');
    expect(e.message).toBe('');
    await Promise.resolve();
    expect(e.message).toBe('Saved');
  });

  it('track counts requests in flight, success or failure', async () => {
    const e = new QuizEdits();
    let resolve!: () => void;
    const p = e.track(new Promise<void>((r) => { resolve = r; }));
    expect(e.inFlight).toBe(true);
    resolve();
    await p;
    expect(e.inFlight).toBe(false);
    await expect(e.track(Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(e.inFlight).toBe(false);
  });
});

describe('InlineEdit', () => {
  function make(over: Partial<InlineOptions<string>> = {}) {
    const edits = new QuizEdits();
    const close = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    const ed = new InlineEdit<string>({
      id: 'x', edits, initial: 'old',
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Required' : null),
      send, close, ...over,
    });
    const detach = ed.attach();
    return { edits, ed, close, send, detach };
  }

  it('takes the slot while attached', () => {
    const { edits, ed, detach } = make();
    expect(edits.active).toBe(ed.handle);
    detach();
    expect(edits.active).toBeNull();
  });

  it('an unchanged value closes without a request', async () => {
    const { ed, close, send } = make();
    ed.value = ' old ';
    await ed.commit();
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('unchanged (when given) decides the silent close, before the check', async () => {
    const { ed, close, send } = make({ initial: '', unchanged: (v) => v.trim() === '', check: () => 'Required' });
    await ed.commit();
    expect(close).toHaveBeenCalledWith(true);
    expect(ed.error).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('the check message shows and nothing is sent', async () => {
    const { ed, send } = make();
    ed.value = ' ';
    await ed.commit();
    expect(ed.error).toBe('Required');
    expect(send).not.toHaveBeenCalled();
  });

  it('a declined confirm keeps the field open and sends nothing', async () => {
    const { ed, send, close } = make({ confirmSend: () => false });
    ed.value = 'new';
    await ed.commit();
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('saves, then closes; while saving it is locked but not unsaved', async () => {
    const { ed, send, close, edits } = make();
    ed.value = 'new';
    const p = ed.commit();
    expect(ed.saving).toBe(true);
    expect(edits.locked).toBe(true);
    expect(edits.dirty).toBe(false);
    expect(edits.inFlight).toBe(true);
    await p;
    expect(send).toHaveBeenCalledWith('new');
    expect(close).toHaveBeenCalledWith(true);
    await Promise.resolve();
    expect(edits.message).toBe('Saved');
  });

  it('a second commit while saving sends nothing more (double Enter)', async () => {
    const { ed, send } = make();
    ed.value = 'new';
    const p = ed.commit();
    await ed.commit();
    await p;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a failure stays open with the server message and the typed text', async () => {
    const { ed, close } = make({ send: vi.fn().mockRejectedValue(new ApiError(422, 'Nope')) });
    ed.value = 'new';
    await ed.commit();
    expect(ed.saving).toBe(false);
    expect(ed.error).toBe('Nope');
    expect(ed.value).toBe('new');
    expect(close).not.toHaveBeenCalled();
    expect(ed.handle.dirty).toBe(true);
  });

  it('a failure after the field closed is a toast', async () => {
    let reject!: (e: unknown) => void;
    const { ed, detach } = make({ send: () => new Promise<void>((_, r) => { reject = r; }) });
    ed.value = 'new';
    const p = ed.commit();
    detach();
    reject(new ApiError(500, 'Boom'));
    await p;
    expect(toasts.list.map((t) => t.message)).toEqual(['Boom']);
  });

  it("after: 'reset' keeps the field open and empties it", async () => {
    const { ed, close } = make({ initial: '', after: 'reset' });
    ed.value = 'A';
    await ed.commit();
    expect(close).not.toHaveBeenCalled();
    expect(ed.value).toBe('');
    expect(ed.saving).toBe(false);
  });

  it('Escape cancels and is swallowed; Enter commits', async () => {
    const { ed, close, send } = make();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    ed.keydown(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledWith(true);
    ed.value = 'new';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    ed.keydown(enter);
    expect(enter.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith('new');
  });

  it('Escape while saving does nothing but is still swallowed', async () => {
    const { ed, close } = make();
    ed.value = 'new';
    const p = ed.commit();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    ed.keydown(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    await p;
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/quizEdits.test.ts`
Expected: FAIL with `Failed to resolve import "../lib/quizEdits.svelte"`.

- [ ] **Step 7: Implement.** Create `frontend/src/lib/quizEdits.svelte.ts`:

```ts
// Slice-5d: the quiz modal's one open edit (D10) and its in-flight counter.
// Every edit — an inline field, a level-3 modal, the header title — takes the
// slot while it is open, and any other action asks first. The quiz body owns
// one instance and exposes it as ItemBodyApi.edits.
import { ApiError } from './api';
import { pushToast } from '../stores/toasts.svelte';

export const DISCARD_PROMPT = 'Discard unsaved changes and continue?';
export const WAIT_TITLE = 'Wait for the save to finish';
export const KEY_CONFIRM =
  'This quiz is published. Changing the answer key does not re-score students who already ' +
  'attempted — their recorded scores keep the old key. To re-grade everyone, create a new ' +
  'version instead. Continue?';

export type EditHandle = {
  readonly id: string;
  readonly dirty: boolean;
  readonly saving: boolean;
  // Close without a request. `refocus` is false when another action takes over.
  close(refocus: boolean): void;
};

export class QuizEdits {
  active = $state<EditHandle | null>(null);
  /** The quiz's polite live-region text; QuizBody renders it. */
  message = $state('');
  #pending = $state(0);

  /** Any quiz request is in flight (structure writes and text saves alike). */
  get inFlight(): boolean { return this.#pending > 0; }
  /** A saving edit disables every edit-opening control. */
  get locked(): boolean { return this.active?.saving ?? false; }
  /** Unsaved work: an open edit with changes that is not saving. */
  get dirty(): boolean {
    const a = this.active;
    return a !== null && a.dirty && !a.saving;
  }

  /** D10: true when the caller may go ahead. `id` names the caller's own edit, if any. */
  request(id?: string): boolean {
    const a = this.active;
    if (a === null || a.id === id) return true;
    if (a.saving) return false;
    if (a.dirty && !window.confirm(DISCARD_PROMPT)) return false;
    this.#drop(a);
    return true;
  }

  open(h: EditHandle): void { this.active = h; }
  release(h: EditHandle): void { if (this.active === h) this.active = null; }

  /** The page's confirmed discard: close what is open, unless it is saving. */
  discardAll(): void {
    const a = this.active;
    if (a !== null && !a.saving) this.#drop(a);
  }

  /** Announce politely ("Saved", "Answer moved to position 2 of 3"). */
  say(text: string): void {
    // Cleared first, so the same text twice is announced twice.
    this.message = '';
    queueMicrotask(() => { this.message = text; });
  }

  /** Count a request toward `inFlight`. */
  async track<T>(p: Promise<T>): Promise<T> {
    this.#pending += 1;
    try { return await p; } finally { this.#pending -= 1; }
  }

  #drop(a: EditHandle): void {
    a.close(false);
    if (this.active === a) this.active = null;
  }
}

export type InlineOptions<T> = {
  id: string;
  edits: QuizEdits;
  initial: T;
  // True when `a` equals `b` (the initial value): the field holds no unsaved work.
  same: (a: T, b: T) => boolean;
  // True when sending `v` would change nothing on the server; Enter then closes
  // silently. Defaults to same(v, initial). Number compares canonical forms
  // against the STORED key, which may differ from the pre-filled fields.
  unchanged?: (v: T) => boolean;
  // An inline message, or null when the value may be sent.
  check: (v: T) => string | null;
  // A published answer key asks first; false keeps the field open, unsent.
  confirmSend?: () => boolean;
  // Throws on failure (an ApiError's message is shown).
  send: (v: T) => Promise<void>;
  // The owner unmounts the field. `refocus`: return focus to its opener.
  close: (refocus: boolean) => void;
  // 'reset' keeps the field open and empty after a success (+ Add answer).
  after?: 'close' | 'reset';
};

/** One inline edit (spec §Saving): Enter or ✓ saves, Esc or ✕ cancels. */
export class InlineEdit<T> {
  // A $state FIELD initialiser, then set in the constructor. A bare `value: T;`
  // declaration would compile to an own property that shadows Svelte's state
  // accessor, and `bind:value` would stop updating.
  value = $state<T>() as T;
  error = $state<string | null>(null);
  saving = $state(false);
  readonly handle: EditHandle;
  #o: InlineOptions<T>;
  #alive = true;

  constructor(o: InlineOptions<T>) {
    this.#o = o;
    this.value = o.initial;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.handle = {
      id: o.id,
      get dirty() { return !o.same(self.value, o.initial); },
      get saving() { return self.saving; },
      close: (refocus) => o.close(refocus),
    };
  }

  /** Call from the field's $effect: it takes the slot, and the cleanup releases it. */
  attach(): () => void {
    this.#alive = true;
    this.#o.edits.open(this.handle);
    return () => {
      this.#alive = false;
      this.#o.edits.release(this.handle);
    };
  }

  cancel(): void {
    if (!this.saving) this.#o.close(true);
  }

  async commit(): Promise<void> {
    if (this.saving) return;
    const o = this.#o;
    // Unchanged first: an untouched empty Text key closes rather than erroring.
    if (o.unchanged ? o.unchanged(this.value) : o.same(this.value, o.initial)) { o.close(true); return; }
    const msg = o.check(this.value);
    if (msg !== null) { this.error = msg; return; }
    if (o.confirmSend && !o.confirmSend()) return;
    this.error = null;
    this.saving = true;
    try {
      await o.edits.track(o.send(this.value));
    } catch (e) {
      const m = e instanceof ApiError ? e.displayMessage : 'Save failed';
      // A save always reports its failure: inline while the field is open,
      // otherwise as a toast (spec §While a request runs).
      if (!this.#alive) { pushToast(m, 'error'); return; }
      this.saving = false;
      this.error = m;
      return;
    }
    o.edits.say('Saved');
    if (!this.#alive) return;
    this.saving = false;
    if (o.after === 'reset') this.value = o.initial;
    else o.close(true);
  }

  /** Enter saves and Esc cancels; Esc never reaches the modal, even while saving. */
  keydown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void this.commit();
    }
  }
}
```

- [ ] **Step 8: Run it to see it pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/quizEdits.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 9: Write the failing FocusTrap / nested-modal tests.**

  1. Append to `frontend/src/tests/FocusTrap.svelte.test.ts`, inside `describe('FocusTrap', …)`:

```ts
  it('an inactive trap leaves Tab alone (5d: only the top modal traps)', () => {
    const snippet = (() => '') as unknown as Snippet;
    let active = true;
    component = mount(FocusTrap, { target, props: { children: snippet, active: () => active } });
    flushSync();
    const container = target.firstElementChild as HTMLElement;
    const a = document.createElement('button');
    const b = document.createElement('button');
    container.append(a, b);
    b.focus();
    const tab = () => {
      const e = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
      document.dispatchEvent(e);
      return e;
    };
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    b.focus();
    active = false;
    expect(tab().defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(b);
  });
```

  2. Create `frontend/src/tests/support/NestedModalHarness.svelte`:

```svelte
<script lang="ts">
  // Slice-5d: a level-3 modal mounted INSIDE a level-2 modal's DOM, as the
  // quiz cards mount theirs.
  import Modal from '../../components/ui/Modal.svelte';
  let { inner = true, onOuterClose = () => {}, onInnerClose = () => {} }:
    { inner?: boolean; onOuterClose?: () => void; onInnerClose?: () => void } = $props();
</script>

{#snippet outerHead()}<h2 id="outer-t">Outer</h2>{/snippet}
{#snippet innerHead()}<h2 id="inner-t">Inner</h2>{/snippet}
<Modal labelledby="outer-t" onRequestClose={onOuterClose} header={outerHead}>
  <button id="outer-a">Outer A</button>
  {#if inner}
    <Modal labelledby="inner-t" width={560} onRequestClose={onInnerClose} header={innerHead}>
      <button id="inner-a">Inner A</button>
      <button id="inner-b">Inner B</button>
    </Modal>
  {/if}
</Modal>
```

  3. Append to `frontend/src/tests/Modal.svelte.test.ts` (keep its existing imports; add `import NestedHarness from './support/NestedModalHarness.svelte';` at the top):

```ts
describe('Modal — nested level-3 inside level-2 (5d)', () => {
  it('Tab and Shift+Tab stay in the top modal; Esc closes only it', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    const cmp = mount(NestedHarness, { target: host, props: { onOuterClose, onInnerClose } });
    flushSync();
    await Promise.resolve();
    const innerPanel = document.querySelector<HTMLElement>('section[aria-labelledby="inner-t"]')!;
    const innerClose = innerPanel.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
    const innerB = document.getElementById('inner-b') as HTMLButtonElement;
    const key = (k: string, shift = false) => {
      const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, cancelable: true, bubbles: true });
      document.activeElement!.dispatchEvent(e);
      return e;
    };
    innerB.focus();
    key('Tab');
    expect(document.activeElement).toBe(innerClose);
    key('Tab', true);
    expect(document.activeElement).toBe(innerB);
    key('Escape');
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
    unmount(cmp);
    host.remove();
  });
});
```

- [ ] **Step 10: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/FocusTrap.svelte.test.ts src/tests/Modal.svelte.test.ts`

Expected:
- FAIL on `an inactive trap leaves Tab alone`, because the inactive Tab is still prevented.
- The nested test may already pass: Modal's focus-in containment rescues focus today. It stays as a regression pin. Ledger this.

- [ ] **Step 11: Implement.** In `frontend/src/components/ui/FocusTrap.svelte`:

  1. Replace the props block:

```ts
  let {
    autofocusSelector = 'input, select, textarea, button',
    autofocusPriorityOrder = false,
    active = undefined,
    children,
  }: {
    autofocusSelector?: string;
    autofocusPriorityOrder?: boolean;
    // Slice-5d: a stacked Modal passes "am I the top modal"; without it the
    // trap is always active, as before (the run modals and side panels).
    active?: () => boolean;
    children: Snippet;
  } = $props();
```

  2. Make the first lines of `onKeydown` read:

```ts
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    if (active && !active()) return;
```

  3. In `frontend/src/components/ui/Modal.svelte`, change the FocusTrap line to:

```svelte
  <FocusTrap {autofocusSelector} {autofocusPriorityOrder} active={isTop}>
```

- [ ] **Step 12: Run them to see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/FocusTrap.svelte.test.ts src/tests/Modal.svelte.test.ts`
Expected: PASS.

- [ ] **Step 13: Write the failing no-assets editor test.** Append inside the main `describe` of `frontend/src/tests/MarkdownEditor.svelte.test.ts`. Reuse the file's existing mount helper and asset-context stub; read the top of the file and use the same names it uses. If the helper is named differently, adapt the three marked lines only.

```ts
  it('noAssets (5d D11): no sidebar, no upload on drop, and a window file drop never navigates', async () => {
    const ctx = makeAssetContext();                                   // the file's existing stub factory
    const cmp = mount(MarkdownEditor, { target, props: { assetContext: ctx, value: 'x', noAssets: true } });
    flushSync();
    expect(target.querySelector('[data-testid="asset-sidebar"]')).toBeNull();
    expect(target.querySelector('textarea')).not.toBeNull();
    const file = new File(['a'], 'a.png', { type: 'image/png' });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    target.querySelector('textarea')!.dispatchEvent(drop);
    await Promise.resolve();
    expect(ctx.upload).not.toHaveBeenCalled();
    const winDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(winDrop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    window.dispatchEvent(winDrop);
    expect(winDrop.defaultPrevented).toBe(true);
    unmount(cmp);                                                      // or the file's cleanup helper
  });
```

- [ ] **Step 14: Run it to see it fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MarkdownEditor.svelte.test.ts`
Expected: FAIL on the new test. The sidebar is present, and the drop calls `upload`.

- [ ] **Step 15: Implement.** In `frontend/src/components/editor/MarkdownEditor.svelte`:

  1. Add to the props, after `frozen = false,`:

```ts
    noAssets = false,
```

     and to the props type, after `frozen?: boolean;`:

```ts
    // Slice-5d D11: the explanation editor. Edit/Preview stay; there is no
    // sidebar and no upload path. The window file-drop guard still runs.
    noAssets?: boolean;
```

  2. In `uploadOne`, change the first line to `if (frozen || noAssets) return null;`.
  3. In `handleTextareaDrop` and in `handleWrapperDrop`, change `if (disabled || frozen) return;` to `if (disabled || frozen || noAssets) return;`.
  4. Wrap the `<AssetSidebar … />` element in `{#if !noAssets} … {/if}`.

- [ ] **Step 16: Run it to see it pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/MarkdownEditor.svelte.test.ts`
Expected: PASS.

- [ ] **Step 17: Relabel the picker (test first).**

  1. In `frontend/src/tests/QuestionTypePicker.svelte.test.ts`:
     - Change the expected labels on line 29 to `['Single choice', 'Multiple choice', 'Number', 'Text']`.
     - Rename that test to `'renders 5a-style cards: the 5d chip names, the selected card marked, no glyphs'`.
  2. Run `TZ=Europe/Copenhagen npx vitest run src/tests/QuestionTypePicker.svelte.test.ts`. Expected: FAIL on the labels.
  3. Then, in `frontend/src/components/editor/QuestionTypePicker.svelte`:
     - add `import { TYPE_LABEL } from '../../lib/quizFormat';` after the `QuestionType` import;
     - replace the `TYPES` array with:

```ts
  // Slice-5d: the same four names as the card chips (lib/quizFormat TYPE_LABEL).
  const TYPES: { value: QuestionType; label: string }[] =
    (['single_choice', 'multiple_choice', 'numeric_answer', 'text_answer'] as const)
      .map((value) => ({ value, label: TYPE_LABEL[value] }));
```

  4. Also change the file's top comment from "with D15's lowercase type names" to "with the 5d chip names".
  5. Search the old quiz tests for the lowercase labels and update any hit to the new names; they are deleted in T3 anyway:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && grep -rn "'single choice'\|'numeric answer'\|'text answer'\|'multiple choice'" src/tests | grep -v QuestionTypePicker
```

- [ ] **Step 18: Full verification**

Run, from `/Users/svkucheryavski/Documents/Developing/mathion/frontend`:
1. `TZ=Europe/Copenhagen npx vitest run > /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/probe/t2-vitest.log 2>&1; echo exit=$?; grep -E "^ +×|Tests |Unhandled|^ *Errors " /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/probe/t2-vitest.log`
2. `npx svelte-check --threshold error`
3. The gate.

Expected:
- vitest: `exit=0`, with no `Errors` or `Unhandled` line.
- svelte-check: 0 errors.
- Gate: `ALL PASS (1382 checks)`, with no CSS changes yet. If the picker's labels feed a gate row, fix that row and bump nothing.

- [ ] **Step 19: Screenshot, review, commit.**
  - One screenshot: the old quiz modal's add-question form showing the new picker labels. Get the user's OK.
  - Run the review lanes until clean.
  - Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/quizFormat.ts frontend/src/lib/quizFormat.test.ts frontend/src/lib/newTabLinks.ts frontend/src/lib/quizEdits.svelte.ts frontend/src/tests/quizEdits.test.ts frontend/src/components/ui/FocusTrap.svelte frontend/src/components/ui/Modal.svelte frontend/src/tests/FocusTrap.svelte.test.ts frontend/src/tests/Modal.svelte.test.ts frontend/src/tests/support/NestedModalHarness.svelte frontend/src/components/editor/MarkdownEditor.svelte frontend/src/tests/MarkdownEditor.svelte.test.ts frontend/src/components/editor/QuestionTypePicker.svelte frontend/src/tests/QuestionTypePicker.svelte.test.ts && git commit -m "feat(editor): Slice 5d T2 — quiz formats, the one-edit slot, top-modal FocusTrap, no-assets editor, chip labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

  Add any old quiz test you touched in Step 17 to the `git add` list.


---

### Task 3: The read-only overview, the switch, and the old editor removed

**Files:**
- Create: `frontend/src/lib/quizContext.ts`
- Create: `frontend/src/components/editor/quiz/QuizBody.svelte`, `QuestionCard.svelte`, `ChoiceAnswers.svelte`, `ChoiceRow.svelte`, `KeyAnswer.svelte`
- Create: `frontend/src/tests/support/quizHarness.svelte.ts`, `frontend/src/tests/QuizOverview.svelte.test.ts`
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte` (import; quiz: no footer, no Title row; the `QuizBody` branch)
- Modify: `frontend/src/tests/ItemEditorModal.svelte.test.ts` (drop the old quiz tests)
- Modify: `frontend/src/lib/itemBody.ts`, `frontend/src/lib/quizAuthoring.ts` (comments that name the removed files)
- Delete: `frontend/src/components/editor/QuizEditor.svelte`, `QuestionAccordion.svelte`, `OptionRow.svelte`, `frontend/src/lib/quizSave.ts`, `frontend/src/tests/QuizEditor.svelte.test.ts`, `QuestionAccordion.svelte.test.ts`, `OptionRow.svelte.test.ts`, `frontend/src/tests/support/QuestionAccordionHarness.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((ae) shrinks, (af) drops the removed files, new (ai), `EXPECTED_CHECKS`)

**Interfaces:**
- Consumes (T2):
  - `QuizEdits`;
  - `TYPE_LABEL`, `questionHints`, `formatNumber`, `decimalsText`, `toleranceText`;
  - `newTabLinks`.
- Produces:
  - `QUIZ_CTX` and `type QuizCtx` (below). They are final here; T5–T8 only read them.
  - `QuizBody` props: `{ itemId, vid, version, perms, assetContext, stillOnVid, versionDisabled?, guardDirty? (bindable), busy? (bindable) }`.
  - `QuizBody` exports `edits: QuizEdits`, plus the four `ItemBodyApi` functions.
  - Card DOM contract, used by every later test and by the focus code:
    - `li.qcard[data-q-id]`, with `.qhead`, `.qtext` (or `pre.qsrc` when disabled), `.qchip`, `.qhint`, `.qanswers`, `.qexpl`;
    - answer rows `li.ans-row[data-a-id]`;
    - the Number/Text line `p.key-line`;
    - the live region `[data-testid="quiz-live"]`.
  - Harness (`tests/support/quizHarness.svelte.ts`):
    - `QuizServer`, `q()`, `opt()`, `renderQuiz()`, `cleanup()`, `settle()`;
    - `panel()`, `topPanel()`, `cards()`, `byName()`, `typeInto()`, `press()`, `live()`, `toastTexts()`.

- [ ] **Step 1: Save the gate baseline** (the per-section counts are compared in Step 13)

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && W=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus && TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh > $W/probe/t3-gate-before.log 2>&1; tail -1 $W/probe/t3-gate-before.log
```
Expected: `VISUAL-REFRESH GATE: ALL PASS (1382 checks)`.

- [ ] **Step 2: Write the test harness.** Create `frontend/src/tests/support/quizHarness.svelte.ts`:

```ts
// Slice-5d: the real ItemEditorModal (through ItemEditorModalHarness, which
// provides the page's DirtyRegistry) over an in-memory quiz server. Only fetch
// is stubbed. The server models the backend rules the editor relies on: D12's
// single-choice clear, the last-correct 422, server-side order.
import { mount, unmount, flushSync } from 'svelte';
import { vi } from 'vitest';
import Harness from './ItemEditorModalHarness.svelte';
import { versionPermissions } from '../../lib/versionPermissions';
import { clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
import { toasts, clearToasts } from '../../stores/toasts.svelte';
import type { AdminTreeItem, AdminTreeVersion } from '../../lib/types';
import type { AuthoringOption, AuthoringQuestion } from '../../lib/quizAuthoring';
import type { DirtyRegistry } from '../../lib/dirtyRegistry.svelte';

export function resp(body: unknown, status = 200): Response {
  return {
    ok: status < 400, status, statusText: 'x',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
export async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

export function q(over: Partial<AuthoringQuestion> & { id: number }): AuthoringQuestion {
  return {
    item_id: 7, text_md: `Q${over.id}`, text_html: `<p>Q${over.id}</p>`, type: 'single_choice', order: over.id,
    explanation_md: null, explanation_html: null, correct_numeric: null, precision: null, correct_text: null,
    ...over,
  };
}
export function opt(id: number, question_id: number, text: string, is_correct = false, order = id): AuthoringOption {
  return { id, question_id, text, is_correct, order };
}
export function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 3, label: '', created_at: '2026-01-01T00:00:00Z',
    published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function quizItem(over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id: 7, sequence_id: 3, title: 'Test me', slug: 'test-me', order: 1, type: 'quiz',
    content_md: null, content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  } as AdminTreeItem;
}

type Call = { method: string; path: string; body: unknown };
type Handler = (path: string, method: string) => Promise<Response> | undefined;
const html = (md: string | null) => (md == null ? null : `<p>${md}</p>`);

export class QuizServer {
  questions: AuthoringQuestion[];
  options: AuthoringOption[];
  calls: Call[] = [];
  #next = 1000;
  #holds: Handler[] = [];

  constructor(questions: AuthoringQuestion[] = [], options: AuthoringOption[] = []) {
    this.questions = structuredClone(questions);
    this.options = structuredClone(options);
  }

  /** Writes only (GETs are noise). */
  writes(): Call[] { return this.calls.filter((c) => c.method !== 'GET'); }

  /** The next matching request waits until release(), or answers fail(status, detail). */
  hold(method: string, re: RegExp) {
    let open!: (r: Response | null) => void;
    const gate = new Promise<Response | null>((r) => { open = r; });
    let used = false;
    this.#holds.push((path, m) => {
      if (used || m !== method || !re.test(path)) return undefined;
      used = true;
      return gate.then((r) => r ?? this.#route(path, m, this.#pendingBody.get(path)));
    });
    return {
      release: () => open(null),
      fail: (status: number, detail: string) => open(resp({ detail }, status)),
    };
  }
  /** The next matching request fails at once. */
  failNext(method: string, re: RegExp, status: number, detail: string) {
    this.hold(method, re).fail(status, detail);
  }

  #pendingBody = new Map<string, unknown>();

  handle(url: string, init?: RequestInit): Promise<Response> {
    const path = url.replace(/^.*?(\/api\/)/, '$1');
    const method = init?.method ?? 'GET';
    // JSON bodies are parsed; an upload's FormData is kept as is.
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    this.calls.push({ method, path, body });
    this.#pendingBody.set(path, body);
    for (const h of this.#holds) {
      const r = h(path, method);
      if (r) return r;
    }
    return Promise.resolve(this.#route(path, method, body));
  }

  #q(id: number) { return this.questions.find((x) => x.id === id); }
  #opts(qid: number) { return this.options.filter((o) => o.question_id === qid).sort((a, b) => a.order - b.order); }

  #route(path: string, method: string, body: any): Response {   // eslint-disable-line @typescript-eslint/no-explicit-any
    let m: RegExpExecArray | null;
    if (path.endsWith('/admin-tree')) {
      return resp({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] });
    }
    if (path.endsWith('/render')) return resp({ html: '<p>rendered</p>' });
    if (/\/assets/.test(path)) return resp([]);
    if (path === '/api/items/7' && method === 'PATCH') {
      return resp({ ...quizItem(), ...body, title: String(body.title).trim() });
    }
    if (path === '/api/items/7/questions' && method === 'GET') {
      return resp(structuredClone([...this.questions].sort((a, b) => a.order - b.order)));
    }
    if (path === '/api/items/7/questions' && method === 'POST') {
      const created = q({
        id: this.#next++, ...body, order: Math.max(0, ...this.questions.map((x) => x.order)) + 1,
        text_html: html(body.text_md)!, explanation_html: html(body.explanation_md ?? null),
      });
      this.questions.push(created);
      return resp(structuredClone(created), 201);
    }
    if (path === '/api/items/7/questions/reorder') {
      for (const e of body.order as { id: number; order: number }[]) this.#q(e.id)!.order = e.order;
      return resp({ status: 'ok' });
    }
    if ((m = /^\/api\/questions\/(\d+)$/.exec(path))) {
      const qq = this.#q(Number(m[1]));
      if (!qq) return resp({ detail: 'Question not found' }, 404);
      if (method === 'DELETE') {
        this.questions = this.questions.filter((x) => x !== qq);
        this.options = this.options.filter((o) => o.question_id !== qq.id);
        return resp(null, 204);
      }
      Object.assign(qq, body);
      if ('text_md' in body) qq.text_html = html(body.text_md)!;
      if ('explanation_md' in body) qq.explanation_html = html(body.explanation_md);
      return resp(structuredClone(qq));
    }
    if ((m = /^\/api\/questions\/(\d+)\/options$/.exec(path))) {
      const qid = Number(m[1]);
      if (method === 'GET') return resp(structuredClone(this.#opts(qid)));
      const created = opt(this.#next++, qid, body.text, body.is_correct,
        Math.max(0, ...this.#opts(qid).map((o) => o.order)) + 1);
      if (created.is_correct && this.#q(qid)!.type === 'single_choice') {
        for (const o of this.#opts(qid)) o.is_correct = false;
      }
      this.options.push(created);
      return resp(structuredClone(created), 201);
    }
    if ((m = /^\/api\/questions\/(\d+)\/options\/reorder$/.exec(path))) {
      for (const e of body.order as { id: number; order: number }[]) {
        this.options.find((o) => o.id === e.id)!.order = e.order;
      }
      return resp({ status: 'ok' });
    }
    if ((m = /^\/api\/options\/(\d+)$/.exec(path))) {
      const o = this.options.find((x) => x.id === Number(m![1]));
      if (!o) return resp({ detail: 'Option not found' }, 404);
      if (method === 'DELETE') { this.options = this.options.filter((x) => x !== o); return resp(null, 204); }
      const qq = this.#q(o.question_id)!;
      if (body.is_correct === false && this.#opts(qq.id).filter((x) => x.is_correct && x !== o).length === 0) {
        return resp({ detail: 'At least one option must be correct' }, 422);
      }
      Object.assign(o, body);
      if (body.is_correct === true && qq.type === 'single_choice') {
        for (const x of this.#opts(qq.id)) if (x !== o) x.is_correct = false;
      }
      return resp(structuredClone(o));
    }
    return resp({});
  }
}

let mounted: { cmp: ReturnType<typeof mount>; target: HTMLElement } | null = null;
const originalFetch = globalThis.fetch;

export async function renderQuiz(
  server: QuizServer,
  over: { version?: Partial<AdminTreeVersion>; item?: Partial<AdminTreeItem> } = {},
) {
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => server.handle(String(url), init)) as unknown as typeof fetch;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const version = mkVersion(over.version);
  let registry: DirtyRegistry | null = null;
  const onRequestClose = vi.fn();
  const onDeleteItem = vi.fn();
  const props = $state({
    modal: {
      vid: 1, version, perms: versionPermissions(version), blockTitle: 'Vectors', seqTitle: 'Linear combination',
      item: quizItem(over.item), itemIndex: 3, itemCount: 4,
      stillOnVid: () => true, onRequestClose, onDeleteItem, deleting: false,
    },
    onRegistry: (r: DirtyRegistry) => { registry = r; },
  });
  const cmp = mount(Harness, { target, props });
  mounted = { cmp, target };
  await settle();
  return {
    props, onRequestClose, onDeleteItem,
    registry: () => registry!,
    anyDirty: () => target.querySelector('[data-testid="any-dirty"]')!.textContent,
    // The page closes the modal: unmount it, but keep fetch and the toasts.
    closeModal() { if (mounted) { unmount(mounted.cmp); mounted.target.remove(); mounted = null; } },
  };
}

export function cleanup() {
  if (mounted) { unmount(mounted.cmp); mounted.target.remove(); mounted = null; }
  globalThis.fetch = originalFetch;
  clearEditorVersion();
  clearToasts();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
}

// ---- DOM helpers ----
/** The quiz modal (level 2): the first dialog in document order. */
export const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
/** The top dialog: a level-3 modal when one is open. */
export const topPanel = () => { const all = document.querySelectorAll<HTMLElement>('section.modal-panel'); return all[all.length - 1]!; };
export const cards = () => [...panel().querySelectorAll<HTMLElement>('li.qcard')];
export const rows = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>('li.ans-row')];
/** A button by accessible name: aria-label, else its whitespace-collapsed text. */
export function byName(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.getAttribute('aria-label') ?? b.textContent!.replace(/\s+/g, ' ').trim()) === name);
}
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
export function press(el: Element, key: string, opts: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(e);
  flushSync();
  return e;
}
export const live = () => panel().querySelector('[data-testid="quiz-live"]')!.textContent;
export const toastTexts = () => toasts.list.map((t) => t.message);
export const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
```

- [ ] **Step 3: Write the failing overview tests.** Create `frontend/src/tests/QuizOverview.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  QuizServer, q, opt, renderQuiz, cleanup, settle, panel, cards, rows, byName, live, text,
} from './support/quizHarness.svelte';

afterEach(cleanup);

describe('Quiz overview (5d T3)', () => {
  it('one card per question: ordinal, rendered text, chip; no footer and no Title row', async () => {
    const s = new QuizServer([
      q({ id: 1, text_html: '<p>What is <em>x</em>?</p>' }),
      q({ id: 2, type: 'numeric_answer', correct_numeric: 5, precision: 2 }),
    ]);
    await renderQuiz(s);
    const [c1, c2] = cards();
    expect(text(c1.querySelector('.qnum'))).toBe('1.');
    expect(c1.querySelector('.qnum')!.getAttribute('aria-hidden')).toBe('true');
    expect(c1.querySelector('.qtext em')!.textContent).toBe('x');
    expect(text(c1.querySelector('.qchip'))).toBe('Single choice');
    expect(text(c2.querySelector('.qchip'))).toBe('Number');
    expect(c1.getAttribute('aria-labelledby')).toBe(c1.querySelector('.qtext')!.id);
    expect(text(panel().querySelector('.quiz-count'))).toBe('2');
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    expect(panel().querySelector('input[aria-label="Title"]')).toBeNull();
  });

  it('the explanation panel shows only when explanation_md has text', async () => {
    const s = new QuizServer([
      q({ id: 1, explanation_md: 'Because', explanation_html: '<p>Because</p>' }),
      q({ id: 2, explanation_md: '   ', explanation_html: '' }),
    ]);
    await renderQuiz(s);
    const [c1, c2] = cards();
    expect(text(c1.querySelector('.qexpl'))).toContain('Because');
    expect(c2.querySelector('.qexpl')).toBeNull();
  });

  it('choice hints wait for the answers, then name the problem', async () => {
    const s = new QuizServer(
      [q({ id: 1 }), q({ id: 2 }), q({ id: 3, type: 'multiple_choice' }), q({ id: 4 }), q({ id: 5 })],
      [opt(21, 2, 'A', true), opt(31, 3, 'A'), opt(32, 3, 'B'),
        opt(41, 4, 'A', true), opt(42, 4, 'B', true), opt(51, 5, 'A', true), opt(52, 5, 'B')],
    );
    const hold = s.hold('GET', /\/questions\/1\/options$/);
    await renderQuiz(s);
    const hints = (i: number) => [...cards()[i].querySelectorAll('.qhint')].map((h) => h.textContent);
    expect(hints(0)).toEqual([]);
    hold.release();
    await settle();
    expect(hints(0)).toEqual(['No answers yet']);
    expect(hints(1)).toEqual(['Add at least 2 answers']);
    expect(hints(2)).toEqual(['No correct answer']);
    expect(hints(3)).toEqual(['More than one correct']);
    expect(hints(4)).toEqual([]);
  });

  it('Number: "Decimals not set" hint and every display form', async () => {
    const s = new QuizServer([
      q({ id: 1, type: 'numeric_answer', correct_numeric: 5, precision: 2 }),
      q({ id: 2, type: 'numeric_answer', correct_numeric: 3, precision: 0 }),
      q({ id: 3, type: 'numeric_answer', correct_numeric: 0.5, precision: 1 }),
      q({ id: 4, type: 'numeric_answer', correct_numeric: 1e-7, precision: 6 }),
      q({ id: 5, type: 'numeric_answer', correct_numeric: 5, precision: null }),
      q({ id: 6, type: 'numeric_answer', correct_numeric: null, precision: 2 }),
    ]);
    await renderQuiz(s);
    const line = (i: number) => text(cards()[i].querySelector('p.key-line'));
    expect(line(0)).toBe('Answer 5 · 2 decimals (± 0.005)');
    expect(line(1)).toBe('Answer 3 · 0 decimals (± 0.5)');
    expect(line(2)).toBe('Answer 0.5 · 1 decimal (± 0.05)');
    expect(line(3)).toBe('Answer 0.0000001 · 6 decimals (± 0.0000005)');
    expect(line(4)).toBe('Answer 5 · decimals not set');
    expect(line(5)).toBe('Answer not set');
    expect([...cards()[4].querySelectorAll('.qhint')].map((h) => h.textContent)).toEqual(['Decimals not set']);
  });

  it('Text: the answer, or "Answer not set"', async () => {
    const s = new QuizServer([
      q({ id: 1, type: 'text_answer', correct_text: 'unit vector' }),
      q({ id: 2, type: 'text_answer', correct_text: null }),
    ]);
    await renderQuiz(s);
    expect(text(cards()[0].querySelector('p.key-line'))).toBe('Answer unit vector');
    expect(text(cards()[1].querySelector('p.key-line'))).toBe('Answer not set');
  });

  it('answer rows: text, and a "correct" tag on the correct one', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'Eleven', true), opt(12, 1, 'Twelve')]);
    await renderQuiz(s);
    const [r1, r2] = rows(cards()[0]);
    expect(text(r1.querySelector('.ans-text'))).toBe('Eleven');
    expect(r1.classList.contains('ok')).toBe(true);
    expect(text(r1.querySelector('.ans-ok'))).toBe('correct');
    expect(r2.querySelector('.ans-ok')).toBeNull();
  });

  it('links in question text and explanations open in a new tab', async () => {
    const s = new QuizServer([q({
      id: 1, text_html: '<p><a href="https://a.test" rel="noopener noreferrer">a</a></p>',
      explanation_md: 'see', explanation_html: '<p><a href="https://b.test" rel="noopener noreferrer">b</a></p>',
    })]);
    await renderQuiz(s);
    const links = [...cards()[0].querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank']);
  });

  it('question list: a skeleton, then "Couldn\'t load the questions" + Retry, which loads', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('GET', /\/items\/7\/questions$/);
    await renderQuiz(s);
    expect(panel().querySelector('.skeleton')).not.toBeNull();
    expect(panel().querySelector('[data-testid="quiz-live"]')).not.toBeNull();
    hold.fail(500, 'Boom');
    await settle();
    expect(text(panel().querySelector('.quiz-error'))).toContain("Couldn't load the questions");
    expect(panel().querySelector('[data-testid="quiz-live"]')).not.toBeNull();
    byName(panel(), 'Retry')!.click();
    await settle();
    expect(cards().length).toBe(1);
  });

  it('a card\'s answers: "Loading answers…", then "Couldn\'t load answers" + Retry', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true)]);
    const hold = s.hold('GET', /\/questions\/1\/options$/);
    await renderQuiz(s);
    expect(text(cards()[0].querySelector('.ans-note'))).toBe('Loading answers…');
    hold.fail(500, 'Boom');
    await settle();
    expect(text(cards()[0].querySelector('.ans-note'))).toContain("Couldn't load answers");
    byName(cards()[0], 'Retry')!.click();
    await settle();
    expect(rows(cards()[0]).length).toBe(1);
  });

  it('an empty quiz says so', async () => {
    await renderQuiz(new QuizServer([]));
    expect(text(panel().querySelector('.quiz-empty'))).toBe('No questions yet.');
    expect(live()).toBe('');
  });

  it('disabled: plain Markdown source under the note, and no /render call', async () => {
    const s = new QuizServer([q({ id: 1, text_md: 'What is $x$?', explanation_md: '**why**', explanation_html: '<p><b>why</b></p>' })]);
    await renderQuiz(s, { version: { is_disabled: true } });
    expect(text(panel().querySelector('.ro-note'))).toBe(
      'Preview is unavailable while this version is disabled — enable it to preview or edit.');
    const c = cards()[0];
    expect(c.querySelector('.qtext')).toBeNull();
    expect([...c.querySelectorAll('pre.qsrc')].map((p) => p.textContent)).toEqual(['What is $x$?', '**why**']);
    expect(c.getAttribute('aria-labelledby')).toBe(c.querySelector('pre.qsrc')!.id);
    expect(s.calls.filter((x) => x.path.endsWith('/render')).length).toBe(0);
  });
});
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizOverview.svelte.test.ts`
Expected: FAIL. Every test fails, because the old `QuizEditor` renders no `li.qcard`.

- [ ] **Step 5: Create the context.** `frontend/src/lib/quizContext.ts`:

```ts
// Slice-5d: what the quiz body shares with its cards (setContext in QuizBody).
// The getters read the body's props, so they stay reactive.
import type { SvelteSet } from 'svelte/reactivity';
import type { QuizEdits } from './quizEdits.svelte';
import type { AuthoringQuestion } from './quizAuthoring';
import type { AssetContext } from './assetContext';

export const QUIZ_CTX = Symbol('quiz');

export type QuizCtx = {
  readonly edits: QuizEdits;
  readonly itemId: number;
  readonly assetContext: AssetContext;
  readonly canText: boolean;      // text fields and the answer key (created, published)
  readonly canStruct: boolean;    // add, move, delete (created)
  readonly published: boolean;    // answer-key changes confirm first
  readonly disabled: boolean;     // plain source, no rendered HTML (5b D6)
  readonly busyQuestions: SvelteSet<number>;  // the per-question lock
  readonly quizLock: boolean;     // the per-quiz lock (question add, move, delete)
  live(): boolean;                // still mounted and still on this version
  say(message: string): void;     // the polite live region
  // The message for a failed request; on 403/409 also reloads the tree (perms re-derive).
  failed(e: unknown): string;
  // Write echo fields back into the question list (only the fields a request carried).
  patch(qid: number, fields: Partial<AuthoringQuestion>): void;
  hasQuestion(qid: number): boolean;
  // Focus the card's ✎, else "+ Add question", else × (spec §Focus, Fallback).
  focusFallback(qid: number | null): void;
};
```

- [ ] **Step 6: Create the read-only components.**

`frontend/src/components/editor/quiz/QuizBody.svelte`:

```svelte
<script lang="ts">
  // The quiz body (Slice-5d): a calm overview of compact question cards. Every
  // edit saves itself (D3). One QuizEdits holds the single open edit (D10) and
  // counts requests in flight. ItemBodyApi for ItemEditorModal: save/validate
  // are no-ops (no footer), discard closes the open edit, and `edits` lets the
  // modal's inline title share the slot.
  import { onMount, onDestroy, setContext, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import { ApiError } from '../../../lib/api';
  import { QuizEdits } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { listQuestions, type AuthoringQuestion } from '../../../lib/quizAuthoring';
  import { loadAdminTree } from '../../../stores/currentEditorVersion.svelte';
  import type { SaveOutcome } from '../../../lib/itemBody';
  import type { AdminTreeVersion } from '../../../lib/types';
  import type { VersionPermissions } from '../../../lib/versionPermissions';
  import type { AssetContext } from '../../../lib/assetContext';

  let {
    itemId, vid, version, perms, assetContext, stillOnVid,
    versionDisabled = false,
    guardDirty = $bindable(false), busy = $bindable(false),
  }: {
    itemId: number; vid: number;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    stillOnVid: (savedVid: number) => boolean;
    versionDisabled?: boolean;
    guardDirty?: boolean; busy?: boolean;
  } = $props();

  export const edits = new QuizEdits();
  export async function save(_titleDraft: string | undefined): Promise<SaveOutcome> { return { outcome: 'ok' }; }
  export function validate(): boolean { return true; }
  export function discard(): void { edits.discardAll(); }
  export function discardAll(): void { edits.discardAll(); }

  $effect(() => { guardDirty = edits.dirty; });
  $effect(() => { busy = edits.inFlight; });

  const savedVid = untrack(() => vid);
  let alive = true;
  let loadToken = 0;
  onDestroy(() => { alive = false; loadToken++; });

  let questions = $state<AuthoringQuestion[]>([]);
  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let quizLock = $state(false);
  const busyQuestions = new SvelteSet<number>();
  let rootEl = $state<HTMLElement>();
  let retryWrap = $state<HTMLElement>();

  const sorted = (list: AuthoringQuestion[]) => [...list].sort((a, b) => a.order - b.order);

  async function load() {
    const my = ++loadToken;
    status = 'loading';
    try {
      const list = await listQuestions(itemId);
      if (my !== loadToken) return;
      questions = sorted(list);
      status = 'loaded';
    } catch {
      if (my !== loadToken) return;
      status = 'error';
    }
  }
  onMount(() => { void load(); });

  async function retry() {
    await load();
    await tick();
    if (!alive) return;
    if (status === 'error') retryWrap?.querySelector('button')?.focus();
    else void focusFallback(questions[0]?.id ?? null);
  }

  async function focusFallback(qid: number | null) {
    await tick();
    if (!alive || !rootEl) return;
    const card = qid == null ? null : rootEl.querySelector(`[data-q-id="${qid}"]`);
    const target =
      card?.querySelector<HTMLElement>('.qhead button[data-glyph="pencil"]:not([disabled])')
      ?? rootEl.querySelector<HTMLElement>('.q-add button:not([disabled])')
      ?? rootEl.closest('section.modal-panel')?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]');
    target?.focus();
  }

  setContext<QuizCtx>(QUIZ_CTX, {
    edits,
    get itemId() { return itemId; },
    get assetContext() { return assetContext; },
    get canText() { return perms.canEditTextFields; },
    get canStruct() { return perms.canEditStructure; },
    get published() { return version.state === 'published'; },
    get disabled() { return versionDisabled; },
    busyQuestions,
    get quizLock() { return quizLock; },
    live: () => alive && stillOnVid(savedVid),
    say: (message) => edits.say(message),
    failed(e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(savedVid)) {
        void loadAdminTree(savedVid, { force: true });
      }
      return e instanceof ApiError ? e.displayMessage : 'Save failed';
    },
    patch(qid, fields) {
      if (alive) questions = questions.map((x) => (x.id === qid ? { ...x, ...fields } : x));
    },
    hasQuestion: (qid) => questions.some((x) => x.id === qid),
    focusFallback: (qid) => { void focusFallback(qid); },
  });
</script>

<section class="quiz-body" aria-label="Questions" bind:this={rootEl}>
  <div class="quiz-head">
    <span class="quiz-label">Questions</span>
    {#if status === 'loaded'}<span class="mono quiz-count">{questions.length}</span>{/if}
  </div>

  {#if status === 'loading'}
    <Skeleton rows={3} label="Loading questions" />
  {:else if status === 'error'}
    <div class="quiz-error" bind:this={retryWrap}>
      <p>Couldn't load the questions</p>
      <Button variant="secondary" onclick={() => void retry()}>Retry</Button>
    </div>
  {:else if questions.length === 0}
    <p class="quiz-empty">No questions yet.</p>
  {:else}
    <ol class="quiz-list">
      {#each questions as q, i (q.id)}
        <QuestionCard {q} n={i + 1} />
      {/each}
    </ol>
  {/if}

  <p class="sr-only" aria-live="polite" data-testid="quiz-live">{edits.message}</p>
</section>

<style>
  .quiz-body { display: flex; flex-direction: column; gap: 12px; }
  .quiz-head { display: flex; align-items: center; gap: 10px; }
  .quiz-label { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .quiz-count { font-size: 11.5px; color: var(--muted); }
  .quiz-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .quiz-empty { margin: 0; font-size: 13px; color: var(--muted); }
  .quiz-error { display: flex; align-items: center; gap: 10px; }
  .quiz-error p { margin: 0; font-size: 13px; color: var(--muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
```

`frontend/src/components/editor/quiz/QuestionCard.svelte`:

```svelte
<script lang="ts">
  // One question in the overview (spec §A question card): the rendered text
  // (plain source when disabled), the type chip, D9 hints, the answers and the
  // explanation. Clicking the text never edits it.
  import { getContext } from 'svelte';
  import ChoiceAnswers from './ChoiceAnswers.svelte';
  import KeyAnswer from './KeyAnswer.svelte';
  import { newTabLinks } from '../../../lib/newTabLinks';
  import { TYPE_LABEL, questionHints } from '../../../lib/quizFormat';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import type { AuthoringOption, AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n }: { q: AuthoringQuestion; n: number } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const textId = `${uid}-text`;

  const choice = $derived(q.type === 'single_choice' || q.type === 'multiple_choice');
  let options = $state<AuthoringOption[] | null>(null);
  const hints = $derived(questionHints(q.type, choice ? options : null, q.precision));
  const hasExpl = $derived((q.explanation_md ?? '').trim() !== '');
</script>

<li class="qcard" data-q-id={q.id} aria-labelledby={textId}>
  <div class="qhead">
    <span class="qnum" aria-hidden="true">{n}.</span>
    {#if ctx.disabled}
      <pre class="qsrc" id={textId}>{q.text_md}</pre>
    {:else}
      <div class="qtext" id={textId} {@attach newTabLinks(q.text_html)}>{@html q.text_html}</div>
    {/if}
    <span class="qmeta">
      <span class="qchip">{TYPE_LABEL[q.type]}</span>
      {#each hints as h (h)}<span class="qhint">{h}</span>{/each}
    </span>
  </div>

  <div class="qanswers">
    {#if choice}
      <ChoiceAnswers {q} {n} bind:options />
    {:else}
      <KeyAnswer {q} {n} />
    {/if}
  </div>

  {#if hasExpl}
    <div class="qexpl">
      <span class="qexpl-label">Explanation</span>
      {#if ctx.disabled}
        <pre class="qsrc">{q.explanation_md}</pre>
      {:else}
        <div class="qexpl-body" {@attach newTabLinks(q.explanation_html ?? '')}>{@html q.explanation_html ?? ''}</div>
      {/if}
    </div>
  {/if}
</li>

<style>
  .qcard { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
  .qhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 10px 12px 6px; }
  .qnum { flex: 0 0 auto; min-width: 18px; color: var(--ordinal); font-weight: 600; font-size: 14.5px; }
  .qtext { flex: 1 1 260px; min-width: 0; font-size: 14.5px; color: var(--text); overflow-wrap: anywhere; }
  .qsrc { flex: 1 1 260px; min-width: 0; margin: 0; font: inherit; font-size: 13px; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .qmeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  .qchip { font-size: 11px; font-weight: 500; color: var(--muted); background: var(--surface-2); border-radius: 3px; padding: 2px 7px; white-space: nowrap; }
  .qhint { font-size: 11px; font-weight: 500; color: var(--status-needs-revision-fg); white-space: nowrap; }
  .qanswers { padding: 2px 12px 8px 38px; }
  .qexpl { margin: 0 12px 10px 38px; padding: 7px 10px; border-left: 3px solid var(--border-strong); background: var(--surface-2); font-size: 12.5px; color: var(--muted); }
  .qexpl-label { display: block; font-weight: 600; margin-bottom: 2px; }
  /* Rendered author content: images fit the card; headings keep their tags at body size. */
  .qtext :global(p), .qexpl-body :global(p) { margin: 0; }
  .qtext :global(p + p), .qexpl-body :global(p + p) { margin-top: 6px; }
  .qtext :global(img), .qexpl-body :global(img) { max-width: 100%; height: auto; }
  .qtext :global(:is(h1, h2, h3, h4, h5, h6)), .qexpl-body :global(:is(h1, h2, h3, h4, h5, h6)) { font-size: inherit; margin: 0; }
  @media (max-width: 560px) { .qmeta { flex-basis: 100%; margin-left: 26px; } }
</style>
```

`frontend/src/components/editor/quiz/ChoiceAnswers.svelte` (read-only for now; T5 replaces it whole):

```svelte
<script lang="ts">
  // A choice question's answers (spec §Answers). Each card loads its own.
  import { getContext, onDestroy, onMount } from 'svelte';
  import Button from '../../ui/Button.svelte';
  import ChoiceRow from './ChoiceRow.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { listOptions, type AuthoringOption, type AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n, options = $bindable(null) }: {
    q: AuthoringQuestion; n: number; options?: AuthoringOption[] | null;
  } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);

  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let alive = true;
  let token = 0;
  onDestroy(() => { alive = false; token++; });

  async function load() {
    const my = ++token;
    status = 'loading';
    try {
      const list = await listOptions(q.id);
      if (my !== token) return;
      options = [...list].sort((a, b) => a.order - b.order);
      status = 'loaded';
    } catch {
      if (my !== token) return;
      status = 'error';
    }
  }
  onMount(() => { void load(); });

  async function retry() {
    await load();
    if (alive && status === 'loaded') ctx.focusFallback(q.id);
  }
</script>

{#if status === 'loading'}
  <p class="ans-note">Loading answers…</p>
{:else if status === 'error'}
  <p class="ans-note">Couldn't load answers <Button variant="ghost" onclick={() => void retry()}>Retry</Button></p>
{:else if options}
  <ul class="ans-list" aria-label={`Answers to question ${n}`}>
    {#each options as o (o.id)}
      <ChoiceRow opt={o} multiple={q.type === 'multiple_choice'} />
    {/each}
  </ul>
{/if}

<style>
  .ans-note { margin: 0; font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .ans-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
</style>
```

`frontend/src/components/editor/quiz/ChoiceRow.svelte` (read-only for now; T5 replaces it whole):

```svelte
<script lang="ts">
  // One answer row (spec §Single and multiple choice): the correct marker, the
  // text, and the "correct" tag that conveys correctness in text.
  import type { AuthoringOption } from '../../../lib/quizAuthoring';
  let { opt, multiple }: { opt: AuthoringOption; multiple: boolean } = $props();
</script>

<li class="ans-row" class:ok={opt.is_correct} data-a-id={opt.id}>
  <span class="ans-mark" class:multi={multiple} class:on={opt.is_correct} aria-hidden="true"></span>
  <span class="ans-text">{opt.text}</span>
  {#if opt.is_correct}<span class="ans-ok">correct</span>{/if}
</li>

<style>
  .ans-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: var(--radius); font-size: 13.5px; color: var(--text-2); }
  .ans-row.ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ans-mark { flex: 0 0 auto; box-sizing: border-box; width: 15px; height: 15px; border: 1.5px solid var(--muted); border-radius: 50%; background: var(--surface); }
  .ans-mark.multi { border-radius: 3px; }
  .ans-mark.on { border-color: var(--status-accepted-fg); background: var(--status-accepted-fg); }
  .ans-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .ans-ok { flex: 0 0 auto; font-size: 11px; font-weight: 500; }
</style>
```

`frontend/src/components/editor/quiz/KeyAnswer.svelte` (read-only for now; T6 replaces it whole):

```svelte
<script lang="ts">
  // The Number / Text answer line (spec §Number, §Text).
  import { decimalsText, formatNumber, toleranceText } from '../../../lib/quizFormat';
  import type { AuthoringQuestion } from '../../../lib/quizAuthoring';
  let { q }: { q: AuthoringQuestion; n: number } = $props();

  const shown = $derived(
    q.type === 'numeric_answer'
      ? (q.correct_numeric == null ? null : formatNumber(q.correct_numeric))
      : q.correct_text,
  );
  const tail = $derived(
    q.type !== 'numeric_answer' ? ''
      : q.precision == null ? ' · decimals not set'
        : ` · ${decimalsText(q.precision)} (${toleranceText(q.precision)})`,
  );
</script>

<p class="key-line">
  {#if shown == null}Answer not set{:else}Answer <strong class="key-value">{shown}</strong>{tail}{/if}
</p>

<style>
  .key-line { margin: 0; font-size: 13.5px; color: var(--text-2); overflow-wrap: anywhere; }
  .key-value { font-weight: 600; color: var(--text); }
</style>
```

- [ ] **Step 7: Switch the item modal.** In `frontend/src/components/editor/ItemEditorModal.svelte`:

  1. Replace `import QuizEditor from './QuizEditor.svelte';` with `import QuizBody from './quiz/QuizBody.svelte';`.
  2. After `const canEditText = $derived(perms.canEditTextFields);` add:

```ts
  // Slice-5d: a quiz saves each edit itself — no footer, no body Title row.
  const isQuiz = $derived(item.type === 'quiz');
```

  3. Change `footer={canEditText ? foot : undefined}` to `footer={canEditText && !isQuiz ? foot : undefined}`.
  4. Wrap the whole `<div class="field-row"> … </div>` Title row in `{#if !isQuiz} … {/if}`.
  5. Replace the `<QuizEditor … />` element with:

```svelte
    <QuizBody
      bind:this={body}
      itemId={item.id}
      {vid}
      {version}
      {perms}
      {assetContext}
      {versionDisabled}
      {stillOnVid}
      bind:guardDirty={bodyGuardDirty}
      bind:busy={bodyBusy}
    />
```

  6. In `frontend/src/lib/itemBody.ts`, change the top comment's `(PageBody, VideoBody, AppBody, QuizEditor)` to `(PageBody, VideoBody, AppBody, quiz/QuizBody)`.
  7. In `frontend/src/lib/quizAuthoring.ts`, change the comment `Each QuestionAccordion fetches/owns its own options (Plan B)` to `Each quiz card's ChoiceAnswers fetches its own options (Slice 5d)`.

- [ ] **Step 8: Remove the old quiz editor** (the approved spec lists these as Removed):

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && git rm -q src/components/editor/QuizEditor.svelte src/components/editor/QuestionAccordion.svelte src/components/editor/OptionRow.svelte src/lib/quizSave.ts src/tests/QuizEditor.svelte.test.ts src/tests/QuestionAccordion.svelte.test.ts src/tests/OptionRow.svelte.test.ts src/tests/support/QuestionAccordionHarness.svelte && grep -rn "QuizEditor\|QuestionAccordion\|OptionRow\|quizSave" src
```
Expected: the grep prints only `src/tests/ItemEditorModal.svelte.test.ts` lines. Step 9 removes those.

- [ ] **Step 9: Drop the old quiz tests from `ItemEditorModal.svelte.test.ts`.** Delete:
  - the test `'disabled quiz: expanding a question makes zero /render calls'`, now covered by QuizOverview "disabled: …";
  - the whole `describe('ItemEditorModal — quiz body (T5a)', …)` block, from its `describe(` line to the end of the file.

  Their behaviours are re-pinned by the 5d test files (T3–T8). `textQ` stays, because `serve()` still uses it.

- [ ] **Step 10: Run the overview tests to see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizOverview.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts`
Expected: PASS. If the link test fails because the attachment ran before `{@html}` filled the element, change `newTabLinks` to defer its work by one microtask, and record a ledger ruling:

```ts
  return (el: HTMLElement): void => {
    queueMicrotask(() => { for (const a of el.querySelectorAll('a[href]')) a.setAttribute('target', '_blank'); });
  };
```

- [ ] **Step 11: Rewrite gate section (ae) and the 5b file lists.** In `frontend/scripts/visual-refresh-gate.sh`:

  1. Change the (ae) echo line to `echo "--- (ae) Slice-5b T6 — quiz look (3f): QuestionTypePicker (5d moved the rest to (ai)) ---"`.
  2. Delete the three blocks that start `own questions-head QuizEditor.svelte`, `own q-toggle QuestionAccordion.svelte` and `own correct-badge OptionRow.svelte`, each through its closing `fi`.
  3. Change the (ae) emoji line to `emoji_scan "quiz type picker" src/components/editor/QuestionTypePicker.svelte`.
  4. In `FILES_5B`, replace the two lines naming `QuizEditor.svelte` / `QuestionAccordion.svelte` / `OptionRow.svelte` / `QuestionTypePicker.svelte` with the single line `  src/components/editor/QuestionTypePicker.svelte`.
  5. In the (af) `emoji_scan "all Slice-5b source files"` line, delete ` src/lib/quizSave.ts`.

- [ ] **Step 12: Add gate section (ai).** Insert just before the final `# The summary line is the parent process's …` comment:

```zsh
echo
echo "--- (ai) Slice-5d — the quiz overview: body, cards, answers, key line ---"
own quiz-head QuizBody.svelte
uniq1 quiz-head
if [[ -n $REPLY ]]; then
  N=QuizBody; H=$REPLY
  d '\.quiz-body' '' 'display:flex' 'flex-direction:column' 'gap:12px'
  d '\.quiz-head' '' 'display:flex' 'align-items:center' 'gap:10px'
  d '\.quiz-label' '' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.quiz-list' '' 'list-style:none' 'margin:0' 'padding:0' 'display:flex' 'flex-direction:column' 'gap:10px'
  none "QuizBody no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep QuizBody $H
fi

own qcard QuestionCard.svelte
uniq1 qcard
if [[ -n $REPLY ]]; then
  N=QuestionCard; H=$REPLY
  d '\.qcard' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius-lg\)' 'background:var\(--surface\)'
  d '\.qhead' '' 'display:flex' 'flex-wrap:wrap' 'gap:8px' 'padding:10px 12px 6px'
  d '\.qnum' '' 'color:var\(--ordinal\)' 'font-weight:600' 'font-size:14\.5px'
  d '\.qtext' '' 'font-size:14\.5px' 'color:var\(--text\)'
  d '\.qchip' '' 'font-size:11px' 'font-weight:500' 'color:var\(--muted\)' 'background:var\(--surface-2\)' 'border-radius:3px' 'padding:2px 7px'
  d '\.qanswers' '' 'padding:2px 12px 8px 38px'
  d '\.qexpl' '' 'margin:0 12px 10px 38px' 'padding:7px 10px' 'border-left:3px solid var\(--border-strong\)' 'background:var\(--surface-2\)' 'font-size:12\.5px' 'color:var\(--muted\)'
  none "QuestionCard chip is sans, never mono" "\.qchip\.${H}\{[^}]*font-family"
  none "QuestionCard no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep QuestionCard $H
fi

own ans-row ChoiceRow.svelte
uniq1 ans-row
if [[ -n $REPLY ]]; then
  N=ChoiceRow; H=$REPLY
  d '\.ans-row' '' 'display:flex' 'align-items:center' 'gap:8px' 'padding:4px 8px' 'border-radius:var\(--radius\)' 'font-size:13\.5px' 'color:var\(--text-2\)'
  d '\.ans-row\.ok' '' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)'
  d '\.ans-mark' '' 'width:15px' 'height:15px' 'border:1\.5px solid var\(--muted\)' 'border-radius:50%'
  d '\.ans-ok' '' 'font-size:11px' 'font-weight:500'
  none "ChoiceRow no --success leftovers (the theme has none)" "\.${H}[^{]*\{[^}]*var\(--success"
  none "ChoiceRow no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep ChoiceRow $H
fi

own key-line KeyAnswer.svelte
uniq1 key-line
if [[ -n $REPLY ]]; then
  N=KeyAnswer; H=$REPLY
  d '\.key-line' '' 'margin:0' 'font-size:13\.5px' 'color:var\(--text-2\)' 'overflow-wrap:anywhere'
  sweep KeyAnswer $H
fi

FILES_5D=(src/components/editor/quiz/*.svelte)
emoji_scan "all Slice-5d quiz files" $FILES_5D src/lib/quizFormat.ts src/lib/quizEdits.svelte.ts \
  src/lib/quizContext.ts src/lib/newTabLinks.ts
colour_scan 5d-quiz $FILES_5D
```

- [ ] **Step 13: Run the gate and set the count**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && W=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus && TMPDIR=$W/tmp zsh scripts/visual-refresh-gate.sh > $W/probe/t3-gate-after.log 2>&1; grep -c '^FAIL' $W/probe/t3-gate-after.log; for f in t3-gate-before t3-gate-after; do echo "== $f"; awk '/^--- /{s=$2} /^(PASS|FAIL)/{c[s]++} END{for(k in c) print k, c[k]}' $W/probe/$f.log | sort; done
```
Expected:
- Exactly one FAIL, `ran N checks, expected 1382`.
- The two per-section listings differ only in `(ae)`, `(af)` (unchanged count, fewer files) and the new `(ai)`.

Set `EXPECTED_CHECKS=N`, re-run the gate, and expect `VISUAL-REFRESH GATE: ALL PASS (N checks)`. Record N in the ledger.

- [ ] **Step 14: Full verification.** vitest (whole suite, exit 0, no `Errors`/`Unhandled`), svelte-check (0 errors), and the gate, with the commands in Global Constraints.

- [ ] **Step 15: Screenshots, review, commit.**
  - Screenshots in an overlay:
    - a choice quiz;
    - a Number/Text quiz;
    - the empty state;
    - a disabled version showing the source.

    Use the demo-course draft; viewing only, nothing is saved. Get the user's OK.
  - Run the review lanes until clean.
  - Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/quizContext.ts frontend/src/components/editor/quiz frontend/src/tests/support/quizHarness.svelte.ts frontend/src/tests/QuizOverview.svelte.test.ts frontend/src/components/editor/ItemEditorModal.svelte frontend/src/tests/ItemEditorModal.svelte.test.ts frontend/src/lib/itemBody.ts frontend/src/lib/quizAuthoring.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(editor): Slice 5d T3 — the quiz overview of question cards replaces the accordion form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

  The Step 8 deletions are already staged by `git rm`. Also add `frontend/src/lib/newTabLinks.ts` if Step 10 changed it.

---

### Task 4: The header — inline title, trash tooltips, the ⌘S rule, first focus

**Files:**
- Modify: `frontend/src/lib/itemBody.ts` (`ItemBodyApi.edits?`)
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte`
- Create: `frontend/src/tests/QuizHeader.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (two rows in (ac))

**Interfaces:**
- Consumes:
  - T2: `QuizEdits.request/locked/dirty/inFlight/say`, `InlineEdit`, `WAIT_TITLE`;
  - T3: `QuizBody` `edits` export;
  - `renameItem(itemId, title)` from `lib/quizAuthoring.ts`.
- Produces:
  - `ItemBodyApi.edits?: QuizEdits` (R3).
  - The title ✎: `IconButton` id `${uid}-title-edit`, name "Edit title".
  - The item modal's ⌘S handler acts only for its own panel, and for a quiz only swallows the key. T7's level-3 modals rely on this.

- [ ] **Step 1: Write the failing tests.** Create `frontend/src/tests/QuizHeader.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, renderQuiz, cleanup, settle, panel, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';

afterEach(cleanup);

const h2 = () => panel().querySelector<HTMLElement>('h2.item-name')!;
const pencil = () => byName(panel(), 'Edit title')!;
const field = () => h2().querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
const trash = () => panel().querySelector<HTMLButtonElement>('button[aria-label="Delete item"]')!;
const closeX = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const itemPatches = (s: QuizServer) => s.writes().filter((c) => c.path === '/api/items/7');

async function openTitle() {
  pencil().click();
  await settle();
}

describe('Quiz header (5d T4)', () => {
  it('first focus is the title pencil when text is editable, else the close button', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]));
    await settle();
    expect(document.activeElement).toBe(pencil());
    cleanup();
    await renderQuiz(new QuizServer([q({ id: 1 })]), { version: { state: 'archived' } });
    await settle();
    expect(byName(panel(), 'Edit title')).toBeUndefined();
    expect(document.activeElement).toBe(closeX());
  });

  it('only the field goes inside the h2; check and cancel sit after it; the dialog keeps its name', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openTitle();
    expect(field()).not.toBeNull();
    expect(document.activeElement).toBe(field());
    expect(h2().querySelectorAll('button').length).toBe(0);
    expect(byName(panel(), 'Save title')).toBeDefined();
    expect(byName(panel(), 'Cancel')).toBeDefined();
    expect(panel().getAttribute('aria-labelledby')).toBe(h2().id);
  });

  it('Enter saves once with renameItem, shows the echo, returns focus and announces "Saved"', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openTitle();
    typeInto(field(), '  New name ');
    press(field(), 'Enter');
    press(field(), 'Enter');
    await settle();
    expect(itemPatches(s).map((c) => c.body)).toEqual([{ title: 'New name' }]);
    expect(text(h2())).toBe('New name');
    expect(document.activeElement).toBe(pencil());
    expect(live()).toBe('Saved');
  });

  it('an unchanged value closes silently; Esc cancels and the modal stays open', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const r = await renderQuiz(s);
    await openTitle();
    press(field(), 'Enter');
    await settle();
    expect(h2().querySelector('input')).toBeNull();
    await openTitle();
    typeInto(field(), 'Other');
    const esc = press(field(), 'Escape');
    await settle();
    expect(esc.defaultPrevented).toBe(true);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(text(h2())).toBe('Test me');
    expect(document.activeElement).toBe(pencil());
    expect(itemPatches(s)).toEqual([]);
  });

  it('an empty title shows "Title is required" as the body\'s first line; nothing is sent', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openTitle();
    typeInto(field(), '   ');
    press(field(), 'Enter');
    await settle();
    const err = panel().querySelector('.modal-body .field-err')!;
    expect(text(err)).toBe('Title is required');
    expect(field().getAttribute('aria-describedby')).toBe(err.id);
    expect(itemPatches(s)).toEqual([]);
  });

  it('a failed save keeps the field with the typed text and the error, and it is unsaved work again', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.failNext('PATCH', /\/api\/items\/7$/, 422, 'Too long');
    const r = await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'Bad');
    press(field(), 'Enter');
    await settle();
    expect(field().value).toBe('Bad');
    expect(text(panel().querySelector('.modal-body .field-err'))).toBe('Too long');
    expect(r.anyDirty()).toBe('true');
  });

  it('an open changed title is unsaved work: the trash names it; a page discard closes it', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]));
    await openTitle();
    typeInto(field(), 'Changed');
    expect(r.anyDirty()).toBe('true');
    expect(trash().disabled).toBe(true);
    expect(trash().title).toBe('Delete this item — finish or discard the open edit first');
    r.registry().discardAll();
    await settle();
    expect(h2().querySelector('input')).toBeNull();
    expect(r.anyDirty()).toBe('false');
  });

  it('while the title saves: readonly, "Saving…", cancel disabled, Esc swallowed, trash waits, nothing unsaved', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/items\/7$/);
    const r = await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'Slow');
    press(field(), 'Enter');
    await settle();
    expect(field().readOnly).toBe(true);
    expect(byName(panel(), 'Saving…')).toBeDefined();
    expect(byName(panel(), 'Cancel')!.disabled).toBe(true);
    const esc = press(field(), 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(field()).not.toBeNull();
    expect(trash().title).toBe('Delete this item — wait for the save to finish');
    expect(trash().disabled).toBe(true);
    expect(r.anyDirty()).toBe('false');
    hold.release();
    await settle();
    expect(trash().disabled).toBe(false);
  });

  it('closing during the save does not prompt, and a late failure toasts', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/items\/7$/);
    const r = await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'Late');
    press(field(), 'Enter');
    await settle();
    expect(r.anyDirty()).toBe('false');
    r.closeModal();
    hold.fail(500, 'Boom');
    await settle();
    expect(toastTexts()).toEqual(['Boom']);
  });

  it('⌘S in the quiz modal is swallowed and sends nothing', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    const e = press(pencil(), 's', { metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    await settle();
    expect(s.writes()).toEqual([]);
  });

  it('the trash waits for any request in flight (a lock-free save)', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/items\/7$/);
    await renderQuiz(s);
    await openTitle();
    typeInto(field(), 'X');
    byName(panel(), 'Save title')!.click();
    await settle();
    expect(trash().title).toBe('Delete this item — wait for the save to finish');
    hold.release();
    await settle();
    expect(trash().title).toBe('Delete this item');
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizHeader.svelte.test.ts`
Expected: FAIL. There is no "Edit title" button yet.

- [ ] **Step 3: Add the edit slot to the body contract.** In `frontend/src/lib/itemBody.ts`:

  1. Add `import type { QuizEdits } from './quizEdits.svelte';` after the toasts import.
  2. Add to `ItemBodyApi`, after `validate(): boolean;`:

```ts
  // Slice-5d (R3): the quiz body's one open-edit slot. The modal's inline title
  // takes it too. Page, Video and App leave it out.
  edits?: QuizEdits;
```

- [ ] **Step 4: Implement the header.** In `frontend/src/components/editor/ItemEditorModal.svelte`:

  1. Imports. Add:

```ts
  import { ApiError } from '../../lib/api';
  import { InlineEdit, WAIT_TITLE } from '../../lib/quizEdits.svelte';
  import { renameItem } from '../../lib/quizAuthoring';
```

  2. After `const titleErrId = …;` add `const titleEditId = `${uid}-title-edit`;`.
  3. After the `isQuiz` line, add the inline title:

```ts
  // ---- Slice-5d: the quiz's inline title (5c D8 rules). It takes the quiz
  //      body's one edit slot, so D10 and the page's DirtyGuard cover it. ----
  const quizEdits = $derived(isQuiz ? (body?.edits ?? null) : null);
  let shownTitle = $state(untrack(() => item.title));   // the last server echo
  let titleEdit = $state<InlineEdit<string> | null>(null);
  let titleEditBtn = $state<HTMLButtonElement>();
  // A tree reload (renamed elsewhere) shows through while no edit is open.
  $effect(() => {
    const t = item.title;
    untrack(() => { if (!titleEdit) shownTitle = t; });
  });

  function openTitle() {
    if (!quizEdits || titleEdit || deleting || quizEdits.locked) return;
    if (!quizEdits.request()) return;
    const savedVid = vid;
    titleEdit = new InlineEdit<string>({
      id: 'title',
      edits: quizEdits,
      initial: shownTitle,
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Title is required' : null),
      send: async (v) => {
        try {
          const echo = await renameItem(item.id, v.trim());
          if (alive) shownTitle = echo.title;
          if (stillOnVid(savedVid)) void loadAdminTree(savedVid, { force: true });
        } catch (e) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(savedVid)) {
            void loadAdminTree(savedVid, { force: true });
          }
          throw e;
        }
      },
      close: (refocus) => {
        titleEdit = null;
        if (!refocus) return;
        // Back to ✎ — or to × when a 403/409 reload removed it.
        void tick().then(() => {
          if (!alive) return;
          if (titleEditBtn?.isConnected) titleEditBtn.focus();
          else trashEl?.closest('section.modal-panel')
            ?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]')?.focus();
        });
      },
    });
  }
  // The field focuses itself and holds the slot while mounted.
  const attachTitle = (el: HTMLInputElement) => {
    el.focus();
    el.select();
    return untrack(() => titleEdit!.attach());
  };
```

  4. Replace the ⌘S handler:

```ts
  // ⌘S / Ctrl+S inside this dialog only (D10). Default-prevented even when
  // blocked, so the browser's own Save dialog never opens over the editor.
  // Slice-5d: a level-3 modal on top handles its own ⌘S, and a quiz has no
  // Save, so there it is only swallowed.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('section.modal-panel')?.getAttribute('aria-labelledby') !== labelId) return;
    e.preventDefault();
    if (!isQuiz) void save();
  }
```

  5. Replace `trashTitle`:

```ts
  // Slice-5d: a quiz names which wait applies; the unsaved edit wins, because
  // it is the one the author has to act on.
  const trashTitle = $derived(
    structReason ?? (
      guardDirty
        ? (isQuiz ? 'Delete this item — finish or discard the open edit first'
                  : 'Delete this item — save or discard changes first')
        : isQuiz && bodyBusy ? 'Delete this item — wait for the save to finish' : 'Delete this item'
    ),
  );
```

  6. Replace the `<h2 …>{item.title}</h2>` line in the `head` snippet:

```svelte
  <h2 id={labelId} class="item-name" class:editing={!!titleEdit}>
    {#if titleEdit}
      <input
        class="plain-input title-input"
        type="text"
        aria-label="Title"
        maxlength="200"
        readonly={titleEdit.saving}
        aria-invalid={titleEdit.error ? 'true' : undefined}
        aria-describedby={titleEdit.error ? titleErrId : undefined}
        bind:value={titleEdit.value}
        onkeydown={(e) => titleEdit?.keydown(e)}
        oninput={() => { if (titleEdit) titleEdit.error = null; }}
        {@attach attachTitle}
      />
    {:else}{isQuiz ? shownTitle : item.title}{/if}
  </h2>
  {#if titleEdit}
    <IconButton glyph="check" size="sm" title={titleEdit.saving ? 'Saving…' : 'Save title'}
                onclick={() => void titleEdit?.commit()} />
    <IconButton glyph="close" size="sm" title="Cancel" disabled={titleEdit.saving}
                onclick={() => titleEdit?.cancel()} />
  {:else if isQuiz && canEditText}
    <IconButton glyph="pencil" size="sm" borderless id={titleEditId} bind:element={titleEditBtn}
                title={quizEdits?.locked ? WAIT_TITLE : 'Edit title'} aria-label="Edit title"
                disabled={!!quizEdits?.locked || deleting} onclick={openTitle} />
  {/if}
```

  7. In `<Modal …>` add the first-focus chain (R-first-focus): the title ✎, else the Title row input (Page/Video/App), else ×:

```svelte
  autofocusSelector={`#${titleEditId}, [data-autofocus], header.modal-head button[aria-label="Close"]`}
```

  8. Make the first child of `<Modal>` the title error (R2):

```svelte
  {#if titleEdit?.error}<p class="field-err" id={titleErrId} role="alert">{titleEdit.error}</p>{/if}
```

  9. CSS, after `.item-name { … }`:

```css
  /* Slice-5d: the open title field's focus ring must not be clipped. */
  .item-name.editing { overflow: visible; flex: 1 1 auto; }
  .title-input { min-width: 160px; font-size: 14px; font-weight: 600; }
```

- [ ] **Step 5: Run the header tests and the item modal suite**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizHeader.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts`
Expected: PASS. The Page, Video and App footer, Title row and ⌘S tests are unchanged and pass.

- [ ] **Step 6: Gate rows.** In section (ac), inside its `if [[ -n $REPLY ]]` block after the `.item-name` row, add:

```zsh
  d '\.item-name\.editing' '' 'overflow:visible'
  d '\.title-input' '' 'font-weight:600'
```

Run the gate. Expected: it fails only with `ran N checks, expected <T3 count>`, where N is the T3 count + 2. Set `EXPECTED_CHECKS` to N and re-run: `ALL PASS`.

- [ ] **Step 7: Full verification.** vitest, svelte-check and the gate, as in Global Constraints.

- [ ] **Step 8: Screenshots, review, commit.**
  - Screenshots:
    - the header with ✎;
    - the open title field, with its focus ring not clipped;
    - an error under the header;
    - a narrow window with the field.
  - Get the user's OK, then run the review lanes until clean.
  - Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/itemBody.ts frontend/src/components/editor/ItemEditorModal.svelte frontend/src/tests/QuizHeader.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(editor): Slice 5d T4 — quiz header: inline title in the edit slot, trash waits, ⌘S rule, first focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Choice answers — marker, inline text, add, move, delete, the per-question lock

**Files:**
- Create: `frontend/src/components/editor/quiz/InlineInput.svelte`
- Replace: `frontend/src/components/editor/quiz/ChoiceAnswers.svelte`, `frontend/src/components/editor/quiz/ChoiceRow.svelte` (whole files)
- Create: `frontend/src/tests/ChoiceAnswers.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((ai) rows)

**Interfaces:**
- Consumes:
  - T2: `InlineEdit`, `KEY_CONFIRM`, `WAIT_TITLE`, `cutName`, `DISCARD_PROMPT`;
  - T3: `QuizCtx` (`edits`, `busyQuestions`, `canText`, `canStruct`, `published`, `failed`, `hasQuestion`, `say`, `focusFallback`);
  - `listOptions`, `createOption`, `updateOption`, `deleteOption`, `reorderOptions`.
- Produces:
  - `InlineInput` props: `{ edit: InlineEdit<string>; label: string; saveTitle?: string; maxlength?: number; hint?: string }`. T6 reuses it.
  - `ChoiceAnswers` keeps the props `{ q, n, options (bindable) }`. T8 adds `autoAdd` / `onAutoAddDone`.
  - Answer row DOM:
    - `button.ans-mark[aria-pressed]` (or `span.ans-mark` when read-only);
    - `button.ans-edit`;
    - `.row-acts` holding the up/down/trash `IconButton`s;
    - `.ans-add` holding `button.ans-add-btn` or an `InlineInput`.

- [ ] **Step 1: Write the failing tests.** Create `frontend/src/tests/ChoiceAnswers.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, opt, renderQuiz, cleanup, settle, panel, cards, rows, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';
import { KEY_CONFIRM, DISCARD_PROMPT, WAIT_TITLE } from '../lib/quizEdits.svelte';

afterEach(cleanup);

const marker = (r: HTMLElement) => r.querySelector<HTMLButtonElement>('button.ans-mark')!;
const textBtn = (r: HTMLElement) => r.querySelector<HTMLButtonElement>('button.ans-edit')!;
const field = (root: ParentNode) => root.querySelector<HTMLInputElement>('input.inline-input')!;
const marks = () => rows(cards()[0]).map((r) => r.classList.contains('ok'));
const optWrites = (s: QuizServer) => s.writes().filter((c) => /\/options/.test(c.path));
const single = () => new QuizServer([q({ id: 1 })], [opt(11, 1, 'Eleven', true), opt(12, 1, 'Twelve'), opt(13, 1, 'Thirteen')]);

describe('Choice answers — the marker (5d T5)', () => {
  it('is a button: aria-pressed, name Mark "…" correct; arrow keys change nothing', async () => {
    const s = single();
    await renderQuiz(s);
    const [r1, r2] = rows(cards()[0]);
    expect(marker(r1).getAttribute('aria-pressed')).toBe('true');
    expect(marker(r2).getAttribute('aria-pressed')).toBe('false');
    expect(marker(r1).getAttribute('aria-label')).toBe('Mark "Eleven" correct');
    press(marker(r2), 'ArrowDown');
    press(marker(r2), 'ArrowUp');
    await settle();
    expect(optWrites(s)).toEqual([]);
  });

  it('single choice: one PATCH, then the others clear locally; focus stays on the marker', async () => {
    const s = single();
    await renderQuiz(s);
    const r2 = rows(cards()[0])[1];
    marker(r2).focus();
    marker(r2).click();
    await settle();
    expect(optWrites(s).map((c) => [c.method, c.path, c.body])).toEqual([['PATCH', '/api/options/12', { is_correct: true }]]);
    expect(marks()).toEqual([false, true, false]);
    expect(document.activeElement).toBe(marker(rows(cards()[0])[1]));
  });

  it('single choice: clicking the one correct answer does nothing', async () => {
    const s = single();
    await renderQuiz(s);
    marker(rows(cards()[0])[0]).click();
    await settle();
    expect(optWrites(s)).toEqual([]);
  });

  it('old two-correct data: clicking a correct answer sends the PATCH and leaves only it', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true), opt(12, 1, 'B', true)]);
    await renderQuiz(s);
    expect(text(cards()[0].querySelector('.qhint'))).toBe('More than one correct');
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ is_correct: true }]);
    expect(marks()).toEqual([false, true]);
    expect(cards()[0].querySelector('.qhint')).toBeNull();
  });

  it('multiple choice toggles; the last correct marker is disabled with its reason', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })], [opt(11, 1, 'A', true), opt(12, 1, 'B')]);
    await renderQuiz(s);
    const m1 = marker(rows(cards()[0])[0]);
    expect(m1.disabled).toBe(true);
    expect(m1.title).toBe('At least one answer must stay correct');
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(marks()).toEqual([true, true]);
    expect(marker(rows(cards()[0])[0]).disabled).toBe(false);
    marker(rows(cards()[0])[0]).click();
    await settle();
    expect(marks()).toEqual([false, true]);
  });

  it('a failed marker write toasts and re-fetches the answers', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/12$/, 500, 'Boom');
    await renderQuiz(s);
    const gets = () => s.calls.filter((c) => c.method === 'GET' && c.path === '/api/questions/1/options').length;
    const before = gets();
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(toastTexts()).toEqual(['Boom']);
    expect(gets()).toBe(before + 1);
    expect(marks()).toEqual([true, false, false]);
  });

  it('a 409 also reloads the version tree', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/12$/, 409, 'Version changed');
    await renderQuiz(s);
    const trees = () => s.calls.filter((c) => c.path.endsWith('/admin-tree')).length;
    const before = trees();
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(trees()).toBe(before + 1);
  });

  it('a held marker write locks this question\'s other controls but not itself; a second click sends nothing', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    await renderQuiz(s);
    const [r1, r2, r3] = rows(cards()[0]);
    marker(r2).click();
    await settle();
    expect(marker(r2).disabled).toBe(false);
    marker(r2).click();
    for (const b of [marker(r3), textBtn(r1), byName(r1, 'Move answer "Eleven" down')!, byName(r1, 'Delete answer "Eleven"')!]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(WAIT_TITLE);
    }
    hold.release();
    await settle();
    expect(optWrites(s).length).toBe(1);
    expect(marker(rows(cards()[0])[2]).disabled).toBe(false);
  });

  it('a stale echo after the modal closed writes nothing and throws nothing', async () => {
    const s = single();
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    const r = await renderQuiz(s);
    marker(rows(cards()[0])[1]).click();
    await settle();
    r.closeModal();
    hold.release();
    await settle();
    expect(toastTexts()).toEqual([]);
  });
});

describe('Choice answers — inline text (5d T5)', () => {
  it('the text button names the full answer with a hidden "Edit answer" prefix', async () => {
    const long = 'x'.repeat(45);
    await renderQuiz(new QuizServer([q({ id: 1 })], [opt(11, 1, long, true)]));
    const r1 = rows(cards()[0])[0];
    expect(text(textBtn(r1))).toBe(`Edit answer ${long}`);
    expect(text(textBtn(r1).querySelector('.sr-only'))).toBe('Edit answer');
    expect(marker(r1).getAttribute('aria-label')).toBe(`Mark "${'x'.repeat(40)}…" correct`);
    expect(byName(r1, `Delete answer "${'x'.repeat(40)}…"`)).toBeDefined();
  });

  it('Enter saves only the text; focus returns to the text button; "Saved" is announced', async () => {
    const s = single();
    await renderQuiz(s);
    textBtn(rows(cards()[0])[1]).click();
    await settle();
    const f = field(rows(cards()[0])[1]);
    expect(f.value).toBe('Twelve');
    expect(document.activeElement).toBe(f);
    typeInto(f, ' Twelve! ');
    press(f, 'Enter');
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ text: 'Twelve!' }]);
    expect(text(rows(cards()[0])[1].querySelector('.ans-edit'))).toBe('Edit answer Twelve!');
    expect(marks()).toEqual([true, false, false]);
    expect(document.activeElement).toBe(textBtn(rows(cards()[0])[1]));
    expect(live()).toBe('Saved');
  });

  it('unchanged closes silently; Esc cancels inside the modal; empty shows an error', async () => {
    const s = single();
    const r = await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(field(cards()[0])).toBeNull();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'zzz');
    expect(press(field(cards()[0]), 'Escape').defaultPrevented).toBe(true);
    await settle();
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(field(cards()[0])).toBeNull();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), '  ');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Enter the answer text');
    expect(optWrites(s)).toEqual([]);
  });

  it('a failed save keeps the field with its text and error, and re-fetches the answers', async () => {
    const s = single();
    s.failNext('PATCH', /\/api\/options\/11$/, 422, 'Too long');
    await renderQuiz(s);
    const gets = () => s.calls.filter((c) => c.method === 'GET' && c.path === '/api/questions/1/options').length;
    const before = gets();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'New');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(field(cards()[0]).value).toBe('New');
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Too long');
    expect(gets()).toBe(before + 1);
    expect(toastTexts()).toEqual([]);
  });

  it('a saving answer field blocks the other edit controls; Esc does nothing; double Enter sends once', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2, explanation_md: 'e', explanation_html: '<p>e</p>' })],
      [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(21, 2, 'C', true)]);
    const hold = s.hold('PATCH', /\/api\/options\/11$/);
    const r = await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'A2');
    press(field(cards()[0]), 'Enter');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(field(cards()[0]).readOnly).toBe(true);
    expect(press(field(cards()[0]), 'Escape').defaultPrevented).toBe(true);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    const c2 = cards()[1];
    for (const b of [marker(rows(c2)[0]), textBtn(rows(c2)[0]), byName(c2, 'Add answer to question 2')!, byName(panel(), 'Edit title')!]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(WAIT_TITLE);
    }
    hold.release();
    await settle();
    expect(optWrites(s).length).toBe(1);
    expect(marker(rows(cards()[1])[0]).disabled).toBe(false);
  });

  it('D10: a changed field asks before another action; Cancel keeps it, OK discards and acts', async () => {
    const s = single();
    await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'changed');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(ask).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(field(cards()[0]).value).toBe('changed');
    expect(optWrites(s)).toEqual([]);
    ask.mockReturnValue(true);
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(field(cards()[0])).toBeNull();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ is_correct: true }]);
  });

  it('D10: an unchanged open field closes silently when another action starts', async () => {
    const s = single();
    await renderQuiz(s);
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    const ask = vi.spyOn(window, 'confirm');
    textBtn(rows(cards()[0])[1]).click();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(field(rows(cards()[0])[1]).value).toBe('Twelve');
    expect(rows(cards()[0])[0].querySelector('input')).toBeNull();
  });
});

describe('Choice answers — add, move, delete (5d T5)', () => {
  it('+ Add answer: Enter creates and keeps the row open, empty and focused; Esc closes it', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    byName(cards()[0], 'Add answer to question 1')!.click();
    await settle();
    const f = () => cards()[0].querySelector<HTMLInputElement>('.ans-add input')!;
    typeInto(f(), 'First');
    press(f(), 'Enter');
    await settle();
    typeInto(f(), 'Second');
    press(f(), 'Enter');
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ text: 'First', is_correct: true }, { text: 'Second', is_correct: false }]);
    expect(rows(cards()[0]).map((r) => text(r.querySelector('.ans-edit')))).toEqual(['Edit answer First', 'Edit answer Second']);
    expect(f().value).toBe('');
    expect(document.activeElement).toBe(f());
    press(f(), 'Escape');
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Add answer to question 1'));
  });

  it('multiple choice: the first answer starts not correct', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })]);
    await renderQuiz(s);
    byName(cards()[0], 'Add answer to question 1')!.click();
    await settle();
    const f = cards()[0].querySelector<HTMLInputElement>('.ans-add input')!;
    typeInto(f, 'A');
    press(f, 'Enter');
    await settle();
    expect(optWrites(s).map((c) => c.body)).toEqual([{ text: 'A', is_correct: false }]);
  });

  it('row actions stay in the tab order, and Shift+Tab from the next marker reaches this row\'s delete', async () => {
    await renderQuiz(single());
    const [, r2, r3] = rows(cards()[0]);   // row 1 is the only correct answer: its delete is disabled
    expect(r2.querySelector('.row-acts')!.querySelectorAll('button').length).toBe(3);
    const focusables = [...panel().querySelectorAll<HTMLElement>('button:not([disabled]), input')];
    expect(focusables[focusables.indexOf(marker(r3)) - 1]).toBe(byName(r2, 'Delete answer "Twelve"'));
  });

  it('moving down: optimistic order, the announcement, one reorder, focus on the same arrow', async () => {
    const s = single();
    await renderQuiz(s);
    byName(rows(cards()[0])[0], 'Move answer "Eleven" down')!.click();
    await settle();
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['12', '11', '13']);
    expect(live()).toBe('Answer moved to position 2 of 3');
    expect(optWrites(s).map((c) => c.body)).toEqual([{ order: [{ id: 12, order: 1 }, { id: 11, order: 2 }, { id: 13, order: 3 }] }]);
    expect(document.activeElement).toBe(byName(rows(cards()[0])[1], 'Move answer "Eleven" down'));
  });

  it('moving to the top keeps focus on the other arrow', async () => {
    await renderQuiz(single());
    byName(rows(cards()[0])[1], 'Move answer "Twelve" up')!.click();
    await settle();
    const top = rows(cards()[0])[0];
    expect(byName(top, 'Move answer "Twelve" up')!.disabled).toBe(true);
    expect(document.activeElement).toBe(byName(top, 'Move answer "Twelve" down'));
  });

  it('a failed move toasts and restores the server order', async () => {
    const s = single();
    s.failNext('POST', /\/options\/reorder$/, 500, 'Nope');
    await renderQuiz(s);
    byName(rows(cards()[0])[0], 'Move answer "Eleven" down')!.click();
    await settle();
    expect(toastTexts()).toEqual(['Nope']);
    expect(rows(cards()[0]).map((r) => r.dataset.aId)).toEqual(['11', '12', '13']);
  });

  it('delete: no confirm; focus goes to the next answer, then the previous, then + Add answer', async () => {
    const s = new QuizServer([q({ id: 1, type: 'multiple_choice' })], [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(13, 1, 'C')]);
    await renderQuiz(s);
    const ask = vi.spyOn(window, 'confirm');
    byName(cards()[0], 'Delete answer "B"')!.click();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textBtn(rows(cards()[0])[1]));
    expect(text(document.activeElement)).toBe('Edit answer C');
    byName(cards()[0], 'Delete answer "C"')!.click();
    await settle();
    expect(text(document.activeElement)).toBe('Edit answer A');
    byName(cards()[0], 'Delete answer "A"')!.click();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Add answer to question 1'));
  });

  it('the only correct answer cannot be deleted, unless it is the only answer', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 }), q({ id: 2 })],
      [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(21, 2, 'Solo', true)]));
    const del = byName(cards()[0], 'Delete answer "A"')!;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe('Mark another answer correct first');
    expect(byName(cards()[1], 'Delete answer "Solo"')!.disabled).toBe(false);
  });
});

describe('Choice answers — version states (5d T5)', () => {
  it('published: the marker asks first; Cancel keeps the key; structure controls are absent; text saves', async () => {
    const s = single();
    await renderQuiz(s, { version: { state: 'published' } });
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(ask).toHaveBeenCalledWith(KEY_CONFIRM);
    expect(optWrites(s)).toEqual([]);
    expect(marks()).toEqual([true, false, false]);
    ask.mockReturnValue(true);
    marker(rows(cards()[0])[1]).click();
    await settle();
    expect(marks()).toEqual([false, true, false]);
    expect(cards()[0].querySelector('.row-acts')).toBeNull();
    expect(cards()[0].querySelector('.ans-add')).toBeNull();
    textBtn(rows(cards()[0])[0]).click();
    await settle();
    typeInto(field(cards()[0]), 'Renamed');
    press(field(cards()[0]), 'Enter');
    await settle();
    expect(optWrites(s).at(-1)!.body).toEqual({ text: 'Renamed' });
  });

  it('archived: a static marker (no button, no aria-pressed), plain text, "correct" in text', async () => {
    await renderQuiz(single(), { version: { state: 'archived' } });
    const r1 = rows(cards()[0])[0];
    expect(r1.querySelector('button')).toBeNull();
    expect(r1.querySelector('span.ans-mark')!.hasAttribute('aria-pressed')).toBe(false);
    expect(text(r1.querySelector('.ans-text'))).toBe('Eleven');
    expect(text(r1.querySelector('.ans-ok'))).toBe('correct');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ChoiceAnswers.svelte.test.ts`
Expected: FAIL. Most tests fail, because there are no `button.ans-mark`, `button.ans-edit` or `+ Add answer` yet. The archived test may already pass.

- [ ] **Step 3: Create `frontend/src/components/editor/quiz/InlineInput.svelte`:**

```svelte
<script lang="ts">
  // The markup of one inline text edit (spec §Saving): the field, the check
  // and cancel buttons, and the error or hint under it. The owner creates the
  // InlineEdit; this takes the edit slot while mounted and focuses the field.
  import { untrack } from 'svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import type { InlineEdit } from '../../../lib/quizEdits.svelte';

  let { edit, label, saveTitle = 'Save', maxlength = 500, hint = undefined }: {
    edit: InlineEdit<string>; label: string; saveTitle?: string; maxlength?: number; hint?: string;
  } = $props();
  const uid = $props.id();
  const msgId = `${uid}-msg`;
  const attach = (el: HTMLInputElement) => {
    el.focus();
    return untrack(() => edit.attach());
  };
</script>

<span class="inline-field">
  <span class="inline-row">
    <input
      class="inline-input"
      type="text"
      aria-label={label}
      {maxlength}
      readonly={edit.saving}
      aria-invalid={edit.error ? 'true' : undefined}
      aria-describedby={edit.error || hint ? msgId : undefined}
      bind:value={edit.value}
      onkeydown={(e) => edit.keydown(e)}
      oninput={() => { edit.error = null; }}
      {@attach attach}
    />
    <IconButton glyph="check" size="sm" title={edit.saving ? 'Saving…' : saveTitle} onclick={() => void edit.commit()} />
    <IconButton glyph="close" size="sm" title="Cancel" disabled={edit.saving} onclick={() => edit.cancel()} />
  </span>
  {#if edit.error}
    <span class="inline-err" id={msgId} role="alert">{edit.error}</span>
  {:else if hint}
    <span class="inline-hint" id={msgId}>{hint}</span>
  {/if}
</span>

<style>
  .inline-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
  .inline-row { display: flex; align-items: center; gap: 6px; }
  .inline-input {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .inline-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .inline-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .inline-err { font-size: 12px; color: var(--danger); }
  .inline-hint { font-size: 12px; color: var(--muted); }
</style>
```

- [ ] **Step 4: Replace `frontend/src/components/editor/quiz/ChoiceRow.svelte`:**

```svelte
<script lang="ts">
  // One answer row (spec §Single and multiple choice). Presentational: the
  // owner (ChoiceAnswers) decides every reason a control is disabled. A null
  // reason means enabled. The marker is a button with aria-pressed, and arrow
  // keys never change the key.
  import IconButton from '../../ui/IconButton.svelte';
  import InlineInput from './InlineInput.svelte';
  import { cutName } from '../../../lib/quizFormat';
  import type { InlineEdit } from '../../../lib/quizEdits.svelte';
  import type { AuthoringOption } from '../../../lib/quizAuthoring';

  let {
    opt, multiple, edit = null, canText, canStruct,
    markReason, textReason, upReason, downReason, deleteReason,
    onMark, onEdit, onMove, onDelete,
  }: {
    opt: AuthoringOption; multiple: boolean;
    edit?: InlineEdit<string> | null;
    canText: boolean; canStruct: boolean;
    markReason: string | null; textReason: string | null;
    upReason: string | null; downReason: string | null; deleteReason: string | null;
    onMark: () => void; onEdit: () => void; onMove: (dir: -1 | 1) => void; onDelete: () => void;
  } = $props();
  const name = $derived(cutName(opt.text));
</script>

<li class="ans-row" class:ok={opt.is_correct} data-a-id={opt.id}>
  {#if canText}
    <button
      type="button"
      class="ans-mark"
      class:multi={multiple}
      class:on={opt.is_correct}
      aria-pressed={opt.is_correct}
      aria-label={`Mark "${name}" correct`}
      title={markReason ?? (opt.is_correct ? 'Correct answer' : 'Mark correct')}
      disabled={markReason !== null}
      onclick={onMark}
    ></button>
  {:else}
    <span class="ans-mark" class:multi={multiple} class:on={opt.is_correct} aria-hidden="true"></span>
  {/if}

  {#if edit}
    <InlineInput {edit} label="Answer text" saveTitle="Save answer" />
  {:else if canText}
    <button type="button" class="ans-text ans-edit" title={textReason ?? 'Edit answer'}
            disabled={textReason !== null} onclick={onEdit}>
      <span class="sr-only">Edit answer</span> {opt.text}
    </button>
  {:else}
    <span class="ans-text">{opt.text}</span>
  {/if}

  {#if opt.is_correct && !edit}<span class="ans-ok">correct</span>{/if}

  {#if canStruct && !edit}
    <!-- D8: revealed by opacity only — always in the tab order and the a11y tree. -->
    <span class="row-acts">
      <IconButton glyph="up" size="sm" borderless title={upReason ?? 'Move up'}
                  aria-label={`Move answer "${name}" up`} disabled={upReason !== null} onclick={() => onMove(-1)} />
      <IconButton glyph="down" size="sm" borderless title={downReason ?? 'Move down'}
                  aria-label={`Move answer "${name}" down`} disabled={downReason !== null} onclick={() => onMove(1)} />
      <IconButton glyph="trash" size="sm" borderless danger title={deleteReason ?? 'Delete answer'}
                  aria-label={`Delete answer "${name}"`} disabled={deleteReason !== null} onclick={onDelete} />
    </span>
  {/if}
</li>

<style>
  .ans-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: var(--radius); font-size: 13.5px; color: var(--text-2); }
  .ans-row:not(.ok):hover { background: var(--focus-row); }
  .ans-row.ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .ans-mark {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 15px;
    height: 15px;
    margin: 0;
    padding: 0;
    border: 1.5px solid var(--muted);
    border-radius: 50%;
    background: var(--surface);
  }
  button.ans-mark { cursor: pointer; }
  button.ans-mark:disabled { cursor: default; }
  .ans-mark.multi { border-radius: 3px; }
  .ans-mark.on { border-color: var(--status-accepted-fg); background: var(--status-accepted-fg); }
  .ans-mark:focus-visible, .ans-edit:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .ans-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .ans-edit { border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: text; }
  .ans-edit:disabled { cursor: default; }
  .ans-ok { flex: 0 0 auto; font-size: 11px; font-weight: 500; }
  .row-acts { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; margin-left: auto; opacity: 0; }
  .ans-row:hover .row-acts { opacity: 1; }
  .ans-row:focus-within .row-acts { opacity: 1; }
  @media (hover: none) { .row-acts { opacity: 1; } }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
```

- [ ] **Step 5: Replace `frontend/src/components/editor/quiz/ChoiceAnswers.svelte`:**

```svelte
<script lang="ts">
  // A choice question's answers (spec §Answers): load / Retry, the marker, the
  // inline text edit, + Add answer, move and delete. Every write takes the
  // per-question lock (ctx.busyQuestions). The control that started a write
  // stays enabled with re-entry blocked here, so focus never drops.
  import { getContext, onDestroy, onMount, tick } from 'svelte';
  import Button from '../../ui/Button.svelte';
  import ChoiceRow from './ChoiceRow.svelte';
  import InlineInput from './InlineInput.svelte';
  import { ApiError } from '../../../lib/api';
  import { InlineEdit, KEY_CONFIRM, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { pushToast } from '../../../stores/toasts.svelte';
  import {
    listOptions, createOption, updateOption, deleteOption, reorderOptions,
    type AuthoringOption, type AuthoringQuestion,
  } from '../../../lib/quizAuthoring';

  let { q, n, options = $bindable(null) }: {
    q: AuthoringQuestion; n: number; options?: AuthoringOption[] | null;
  } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);

  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let op = $state<string | null>(null);         // this component's write in flight
  let editId = $state<number | null>(null);
  let textEdit = $state<InlineEdit<string> | null>(null);
  let addEdit = $state<InlineEdit<string> | null>(null);
  let listEl = $state<HTMLElement>();
  let addWrap = $state<HTMLElement>();
  let alive = true;
  let token = 0;
  onDestroy(() => { alive = false; token++; });

  const multiple = $derived(q.type === 'multiple_choice');
  const correctCount = $derived((options ?? []).filter((o) => o.is_correct).length);
  const held = $derived(ctx.busyQuestions.has(q.id));   // someone holds this question
  const sortByOrder = (list: AuthoringOption[]) => [...list].sort((a, b) => a.order - b.order);

  async function load() {
    const my = ++token;
    status = 'loading';
    try {
      const list = await listOptions(q.id);
      if (my !== token) return;
      options = sortByOrder(list);
      status = 'loaded';
    } catch {
      if (my !== token) return;
      status = 'error';
    }
  }
  onMount(() => { void load(); });

  async function retry() {
    await load();
    if (alive && status === 'loaded') ctx.focusFallback(q.id);
  }

  // After a failed write: the server's truth, without the loading state (an
  // open field stays mounted). Skipped when the question itself is gone.
  async function reload() {
    if (!alive || !ctx.hasQuestion(q.id)) return;
    const my = ++token;
    try {
      const list = await listOptions(q.id);
      if (my === token && alive) options = sortByOrder(list);
    } catch { /* keep what is shown; the failure was already reported */ }
  }

  // One answer write at a time per question. `key` names the starting control.
  async function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
    ctx.busyQuestions.add(q.id);
    op = key;
    try {
      return await ctx.edits.track(run());
    } catch (e) {
      ctx.failed(e);          // 403/409: the tree reloads, so permissions re-derive
      void reload();
      throw e;
    } finally {
      ctx.busyQuestions.delete(q.id);
      if (alive) op = null;
    }
  }
  // An action without a field reports its failure as a toast — always, even
  // after the modal closed (spec §Stale responses).
  async function act<T>(key: string, run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await locked(key, run);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
      return undefined;
    }
  }

  // ---- Disabling reasons (null = enabled). ----
  const busyFor = (key: string) => (held && op !== key ? WAIT_TITLE : null);
  const canDelete = (o: AuthoringOption) =>
    (options ?? []).length === 1 || !(o.is_correct && correctCount === 1);
  function markReason(o: AuthoringOption): string | null {
    if (ctx.edits.locked) return WAIT_TITLE;
    return busyFor(`mark:${o.id}`)
      ?? (multiple && o.is_correct && correctCount === 1 ? 'At least one answer must stay correct' : null);
  }
  const textReason = () => (ctx.edits.locked ? WAIT_TITLE : busyFor('-'));
  const upReason = (o: AuthoringOption, i: number) => busyFor(`move:${o.id}`) ?? (i === 0 ? 'Move up — already first' : null);
  const downReason = (o: AuthoringOption, i: number) =>
    busyFor(`move:${o.id}`) ?? (i === (options ?? []).length - 1 ? 'Move down — already last' : null);
  const deleteReason = (o: AuthoringOption) =>
    busyFor(`delete:${o.id}`) ?? (canDelete(o) ? null : 'Mark another answer correct first');
  const addReason = $derived(ctx.edits.locked ? WAIT_TITLE : busyFor('add'));

  // ---- Focus helpers ----
  const rowEl = (id: number) => listEl?.querySelector<HTMLElement>(`li.ans-row[data-a-id="${id}"]`) ?? null;
  const addBtn = () => addWrap?.querySelector<HTMLButtonElement>('button.ans-add-btn') ?? null;
  // Back to the opener, or the §Focus fallback when it is gone or disabled.
  async function focusText(id: number) {
    await tick();
    if (!alive) return;
    const el = rowEl(id)?.querySelector<HTMLButtonElement>('button.ans-edit');
    if (el && !el.disabled) el.focus();
    else ctx.focusFallback(q.id);
  }
  async function focusAdd() {
    await tick();
    if (!alive) return;
    const b = addBtn();
    if (b && !b.disabled) b.focus();
    else ctx.focusFallback(q.id);
  }

  // ---- The marker ----
  async function mark(o: AuthoringOption) {
    if (op !== null || markReason(o) !== null) return;
    const others = (options ?? []).some((x) => x.is_correct && x.id !== o.id);
    if (!multiple && o.is_correct && !others) return;     // already the one correct answer
    const next = multiple ? !o.is_correct : true;
    if (!ctx.edits.request()) return;                     // D10 first …
    if (ctx.published && !window.confirm(KEY_CONFIRM)) return;   // … then the key confirm
    const echo = await act(`mark:${o.id}`, () => updateOption(o.id, { is_correct: next }));
    if (!echo || !alive) return;
    // Only is_correct is written back; single choice clears the others (D12).
    options = (options ?? []).map((x) =>
      x.id === o.id ? { ...x, is_correct: echo.is_correct }
        : !multiple && echo.is_correct ? { ...x, is_correct: false } : x);
  }

  // ---- The inline text edit ----
  function openEdit(o: AuthoringOption) {
    if (editId === o.id || textReason() !== null) return;
    if (!ctx.edits.request()) return;
    editId = o.id;
    textEdit = new InlineEdit<string>({
      id: `answer-${o.id}`,
      edits: ctx.edits,
      initial: o.text,
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Enter the answer text' : null),
      send: async (v) => {
        const echo = await locked(`text:${o.id}`, () => updateOption(o.id, { text: v.trim() }));
        if (alive) options = (options ?? []).map((x) => (x.id === o.id ? { ...x, text: echo.text } : x));
      },
      close: (refocus) => {
        editId = null;
        textEdit = null;
        if (refocus) void focusText(o.id);
      },
    });
  }

  // ---- + Add answer: the row stays open for the next one ----
  function openAdd() {
    if (addEdit || addReason !== null) return;
    if (!ctx.edits.request()) return;
    addEdit = new InlineEdit<string>({
      id: `add-${q.id}`,
      edits: ctx.edits,
      initial: '',
      same: (a, b) => a.trim() === b.trim(),     // empty = unchanged: Enter closes the row
      check: () => null,
      send: async (v) => {
        const first = !multiple && (options ?? []).length === 0;   // D14
        const created = await locked('add', () => createOption(q.id, { text: v.trim(), is_correct: first }));
        if (!alive) return;
        options = [...(options ?? []), created];
        void tick().then(() => addWrap?.querySelector<HTMLInputElement>('input')?.focus());
      },
      after: 'reset',
      close: (refocus) => {
        addEdit = null;
        if (refocus) void focusAdd();
      },
    });
  }

  // ---- Move: optimistic; the moved row's arrows keep focus ----
  async function move(o: AuthoringOption, dir: -1 | 1) {
    if (op !== null || held) return;
    const cur = options ?? [];
    const i = cur.findIndex((x) => x.id === o.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    if (!ctx.edits.request()) return;
    const next = [...cur];
    [next[i], next[j]] = [next[j]!, next[i]!];
    options = next.map((x, k) => ({ ...x, order: k + 1 }));
    ctx.say(`Answer moved to position ${j + 1} of ${next.length}`);
    const order = options.map((x) => ({ id: x.id, order: x.order }));
    const done = act(`move:${o.id}`, () => reorderOptions(q.id, order));
    await tick();
    const row = rowEl(o.id);
    const same = row?.querySelector<HTMLButtonElement>(`button[data-glyph="${dir < 0 ? 'up' : 'down'}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`button[data-glyph="${dir < 0 ? 'down' : 'up'}"]`);
    (same && !same.disabled ? same : other)?.focus();
    row?.scrollIntoView?.({ block: 'nearest' });
    await done;
  }

  // ---- Delete: no confirmation (D14) ----
  async function remove(o: AuthoringOption) {
    if (op !== null || deleteReason(o) !== null) return;
    if (!ctx.edits.request()) return;
    const ids = (options ?? []).map((x) => x.id);
    const idx = ids.indexOf(o.id);
    const ok = await act(`delete:${o.id}`, async () => { await deleteOption(o.id); return true; });
    if (!ok || !alive) return;
    options = (options ?? []).filter((x) => x.id !== o.id);
    await tick();
    const nextId = ids[idx + 1] ?? ids[idx - 1];
    const target = nextId == null ? null : rowEl(nextId)?.querySelector<HTMLElement>('button.ans-edit');
    (target ?? addBtn())?.focus();
  }
</script>

{#if status === 'loading'}
  <p class="ans-note">Loading answers…</p>
{:else if status === 'error'}
  <p class="ans-note">Couldn't load answers <Button variant="ghost" onclick={() => void retry()}>Retry</Button></p>
{:else if options}
  <ul class="ans-list" aria-label={`Answers to question ${n}`} bind:this={listEl}>
    {#each options as o, i (o.id)}
      <ChoiceRow
        opt={o}
        {multiple}
        edit={editId === o.id ? textEdit : null}
        canText={ctx.canText}
        canStruct={ctx.canStruct}
        markReason={markReason(o)}
        textReason={textReason()}
        upReason={upReason(o, i)}
        downReason={downReason(o, i)}
        deleteReason={deleteReason(o)}
        onMark={() => void mark(o)}
        onEdit={() => openEdit(o)}
        onMove={(d) => void move(o, d)}
        onDelete={() => void remove(o)}
      />
    {/each}
  </ul>
  <!-- An open add row stays mounted even if a 403/409 reload removes the right to add. -->
  {#if ctx.canStruct || addEdit}
    <div class="ans-add" bind:this={addWrap}>
      {#if addEdit}
        <InlineInput edit={addEdit} label={`New answer for question ${n}`} saveTitle="Add answer" />
      {:else}
        <button type="button" class="ans-add-btn" aria-label={`Add answer to question ${n}`}
                title={addReason ?? 'Add answer'} disabled={addReason !== null} onclick={openAdd}>+ Add answer</button>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .ans-note { margin: 0; font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .ans-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .ans-add { margin-top: 4px; padding-left: 8px; display: flex; }
  .ans-add-btn { border: 0; padding: 2px 0; background: transparent; font: inherit; font-size: 12.5px; color: var(--primary); cursor: pointer; }
  .ans-add-btn:disabled { color: var(--faint); cursor: default; }
  .ans-add-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
</style>
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ChoiceAnswers.svelte.test.ts src/tests/QuizOverview.svelte.test.ts src/tests/QuizHeader.svelte.test.ts`
Expected: PASS. If any test asserts a behaviour the spec states differently, the spec wins: fix the test or the code, and record a ledger ruling.

- [ ] **Step 7: Gate rows.** In section (ai), after the `ChoiceRow` block's `sweep ChoiceRow $H` line (inside its `if`), add:

```zsh
  d '\.row-acts' '' 'opacity:0' 'margin-left:auto'
  check "ChoiceRow row actions show on hover (D8)" "\.ans-row\.${H}:hover \.row-acts\.${H}[^{]*\{opacity:1\}"
  check "ChoiceRow row actions show on keyboard focus (D8)" "\.ans-row\.${H}:focus-within \.row-acts\.${H}\{opacity:1\}"
  check "ChoiceRow row actions always shown without hover (D8)" "@media \(hover: ?none\)\{\.row-acts\.${H}\{opacity:1\}"
  d '\.ans-row:not\(\.ok\):hover' '' 'background:var\(--focus-row\)'
```

> Note: `d '\.ans-row:not\(\.ok\):hover'` expects the emitted form `.ans-row.svelte-H:not(.ok):hover{…}`. Svelte scopes `:not(.ok)` as `:not(.ok.svelte-H)` in some versions. If the row FAILs, grep the dist CSS for `ans-row`, use the emitted selector through `chk`, and record a ledger ruling.

After the `own key-line` block, add the InlineInput block:

```zsh
own inline-field InlineInput.svelte
uniq1 inline-field
if [[ -n $REPLY ]]; then
  N=InlineInput; H=$REPLY
  d '\.inline-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'font-size:var\(--control-font\)' 'caret-color:var\(--primary\)'
  chk "\.inline-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  chk "\.inline-input\[aria-invalid=\"?true\"?\]\.${H}" 'border:1\.5px solid var\(--danger\)'
  d '\.inline-err' '' 'font-size:12px' 'color:var\(--danger\)'
  none "InlineInput no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep InlineInput $H
fi
```

Run the gate (`cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && zsh scripts/visual-refresh-gate.sh > ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log 2>&1; tail -3 ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log`). Expected: it fails only with `ran N checks, expected <previous count>`, where N − previous equals the number of rows this step added. Set `EXPECTED_CHECKS=N`, re-run, and expect `ALL PASS (N checks)`. Record N in the ledger.

- [ ] **Step 8: Full verification.** vitest, svelte-check and the gate.

- [ ] **Step 9: Screenshots, review, commit.**
  - Screenshots:
    - a card with a correct answer;
    - hover revealing ↑ ↓ and delete;
    - an open answer field;
    - the add row;
    - a field with an error;
    - a published card with no structure controls.

    Use a demo draft the user agrees to write into.
  - Get the user's OK, then run the review lanes until clean.
  - Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/editor/quiz/InlineInput.svelte frontend/src/components/editor/quiz/ChoiceRow.svelte frontend/src/components/editor/quiz/ChoiceAnswers.svelte frontend/src/tests/ChoiceAnswers.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(editor): Slice 5d T5 — choice answers edited in place: marker, text, add, move, delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Number and Text answers — inline editing and the published confirm

**Files:**
- Replace: `frontend/src/components/editor/quiz/KeyAnswer.svelte` (whole file)
- Create: `frontend/src/tests/KeyAnswer.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((ai) rows)

**Interfaces:**
- Consumes:
  - T2: `InlineEdit` (with `unchanged`), `KEY_CONFIRM`, `WAIT_TITLE`, `sameNumber`, `formatNumber`, `decimalsText`, `toleranceText`;
  - T3: `QuizCtx.patch` / `failed` / `busyQuestions` / `published` / `canText`;
  - T5: `InlineInput`;
  - `updateQuestion`, `validateNumericAnswer`.
- Produces:
  - `KeyAnswer` keeps its props `{ q, n }`.
  - DOM:
    - `.key-row` holds `p.key-line` and the ✎ "Edit the answer to question N";
    - the Number editor is `.key-edit` with inputs labelled "Answer" and "Decimals".

- [ ] **Step 1: Write the failing tests.** Create `frontend/src/tests/KeyAnswer.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, renderQuiz, cleanup, settle, cards, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';
import { KEY_CONFIRM, DISCARD_PROMPT } from '../lib/quizEdits.svelte';

afterEach(cleanup);

const num = (over = {}) => q({ id: 1, type: 'numeric_answer', correct_numeric: 5, precision: 2, ...over });
const txt = (over = {}) => q({ id: 2, type: 'text_answer', correct_text: 'unit vector', ...over });
const pencil = (i = 0) => byName(cards()[i], `Edit the answer to question ${i + 1}`)!;
const input = (i: number, label: string) => cards()[i].querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const qWrites = (s: QuizServer) => s.writes().filter((c) => /^\/api\/questions\/\d+$/.test(c.path));
const line = (i = 0) => text(cards()[i].querySelector('p.key-line'));

describe('Number answer (5d T6)', () => {
  it('opens pre-filled; Enter saves value and decimals in one PATCH; focus returns; "Saved"', async () => {
    const s = new QuizServer([num()]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    expect(input(0, 'Answer').value).toBe('5');
    expect(input(0, 'Decimals').value).toBe('2');
    expect(document.activeElement).toBe(input(0, 'Answer'));
    typeInto(input(0, 'Answer'), '4.5');
    typeInto(input(0, 'Decimals'), '1');
    press(input(0, 'Decimals'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_numeric: 4.5, precision: 1 }]);
    expect(line()).toBe('Answer 4.5 · 1 decimal (± 0.05)');
    expect(document.activeElement).toBe(pencil());
    expect(live()).toBe('Saved');
  });

  it('old data opens with an empty value and 0 decimals', async () => {
    await renderQuiz(new QuizServer([num({ correct_numeric: null, precision: null })]));
    pencil().click();
    await settle();
    expect(input(0, 'Answer').value).toBe('');
    expect(input(0, 'Decimals').value).toBe('0');
  });

  it('"5.0" against a stored 5 with the same decimals closes silently', async () => {
    const s = new QuizServer([num()]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), '5.0');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s)).toEqual([]);
    expect(cards()[0].querySelector('.key-edit')).toBeNull();
  });

  it('an unset precision is a change: Enter on the pre-filled 0 sends it', async () => {
    const s = new QuizServer([num({ precision: null })]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_numeric: 5, precision: 0 }]);
  });

  it('invalid input shows its reason and sends nothing; Esc cancels inside the modal', async () => {
    const s = new QuizServer([num()]);
    const r = await renderQuiz(s);
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), 'abc');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(text(cards()[0].querySelector('.key-err'))).toBe('Not a valid number.');
    typeInto(input(0, 'Answer'), '4');
    typeInto(input(0, 'Decimals'), '11');
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(text(cards()[0].querySelector('.key-err'))).toBe('Decimals must be a whole number from 0 to 10.');
    expect(qWrites(s)).toEqual([]);
    expect(press(input(0, 'Answer'), 'Escape').defaultPrevented).toBe(true);
    await settle();
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(line()).toBe('Answer 5 · 2 decimals (± 0.005)');
  });

  it('a failed save keeps the editor with its values and the error; nothing is re-fetched; no toast', async () => {
    const s = new QuizServer([num()]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 422, 'Out of range');
    await renderQuiz(s);
    const gets = () => s.calls.filter((c) => c.method === 'GET').length;
    pencil().click();
    await settle();
    typeInto(input(0, 'Answer'), '7');
    const before = gets();
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(input(0, 'Answer').value).toBe('7');
    expect(text(cards()[0].querySelector('.key-err'))).toBe('Out of range');
    expect(gets()).toBe(before);
    expect(toastTexts()).toEqual([]);
  });
});

describe('Text answer (5d T6)', () => {
  it('opens with the stored answer and the hint; Enter saves only correct_text', async () => {
    const s = new QuizServer([num(), txt()]);
    await renderQuiz(s);
    pencil(1).click();
    await settle();
    expect(input(1, 'Answer').value).toBe('unit vector');
    expect(text(cards()[1].querySelector('.inline-hint'))).toBe('Case-insensitive, trimmed match.');
    typeInto(input(1, 'Answer'), ' basis ');
    press(input(1, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_text: 'basis' }]);
    expect(line(1)).toBe('Answer basis');
  });

  it('an empty unset answer closes silently', async () => {
    const s = new QuizServer([txt({ id: 1, correct_text: null })]);
    await renderQuiz(s);
    pencil().click();
    await settle();
    press(input(0, 'Answer'), 'Enter');
    await settle();
    expect(cards()[0].querySelector('input')).toBeNull();
    expect(qWrites(s)).toEqual([]);
  });
});

describe('Answer key in a published version (5d T6)', () => {
  it('the D10 prompt comes before the key confirm; Cancel on the confirm keeps the field', async () => {
    const s = new QuizServer([num(), txt()]);
    await renderQuiz(s, { version: { state: 'published' } });
    pencil(0).click();
    await settle();
    typeInto(input(0, 'Answer'), '9');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    pencil(1).click();
    await settle();
    typeInto(input(1, 'Answer'), 'changed');
    ask.mockReturnValue(false);
    press(input(1, 'Answer'), 'Enter');
    await settle();
    expect(ask.mock.calls.map((c) => c[0])).toEqual([DISCARD_PROMPT, KEY_CONFIRM]);
    expect(input(1, 'Answer').value).toBe('changed');
    expect(qWrites(s)).toEqual([]);
    ask.mockReturnValue(true);
    press(input(1, 'Answer'), 'Enter');
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ correct_text: 'changed' }]);
  });

  it('archived: no pencil', async () => {
    await renderQuiz(new QuizServer([num()]), { version: { state: 'archived' } });
    expect(byName(cards()[0], 'Edit the answer to question 1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/KeyAnswer.svelte.test.ts`
Expected: FAIL. There is no "Edit the answer to question 1" button yet; only the archived test passes.

- [ ] **Step 3: Replace `frontend/src/components/editor/quiz/KeyAnswer.svelte`:**

```svelte
<script lang="ts">
  // The Number / Text answer key (spec §Number, §Text): a display line, and an
  // inline editor behind ✎ "Edit the answer to question N". Number saves value
  // + decimals in one PATCH. A key save takes the per-question lock; a
  // published version confirms first (after the D10 prompt, which ran when the
  // editor opened). A failed save re-fetches nothing (R8): these answers are
  // question fields, and the editor keeps the typed values and the error.
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import InlineInput from './InlineInput.svelte';
  import { InlineEdit, KEY_CONFIRM, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { decimalsText, formatNumber, sameNumber, toleranceText } from '../../../lib/quizFormat';
  import {
    updateQuestion, validateNumericAnswer, type AuthoringQuestion, type QuestionUpdateBody,
  } from '../../../lib/quizAuthoring';

  let { q, n }: { q: AuthoringQuestion; n: number } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const errId = `${uid}-err`;
  let alive = true;
  onDestroy(() => { alive = false; });

  type NumDraft = { v: string; d: string };
  let numEdit = $state<InlineEdit<NumDraft> | null>(null);
  let textEdit = $state<InlineEdit<string> | null>(null);
  let pencil = $state<HTMLButtonElement>();

  const isNumber = $derived(q.type === 'numeric_answer');
  const shown = $derived(
    isNumber ? (q.correct_numeric == null ? null : formatNumber(q.correct_numeric)) : q.correct_text,
  );
  const tail = $derived(
    !isNumber ? ''
      : q.precision == null ? ' · decimals not set'
        : ` · ${decimalsText(q.precision)} (${toleranceText(q.precision)})`,
  );
  const editReason = $derived(ctx.edits.locked || ctx.busyQuestions.has(q.id) ? WAIT_TITLE : null);
  const confirmKey = () => !ctx.published || window.confirm(KEY_CONFIRM);
  const decimalsOk = (d: string) => /^\d{1,2}$/.test(d.trim()) && Number(d) <= 10;

  // Back to ✎, or the §Focus fallback when a 403/409 reload removed it.
  async function refocusPencil() {
    await tick();
    if (!alive) return;
    if (pencil?.isConnected && !pencil.disabled) pencil.focus();
    else ctx.focusFallback(q.id);
  }

  // One PATCH under the per-question lock; only the fields it carried are written back.
  async function sendKey(body: QuestionUpdateBody) {
    ctx.busyQuestions.add(q.id);
    try {
      const echo = await ctx.edits.track(updateQuestion(q.id, body));
      const fields: Record<string, unknown> = {};
      for (const k of Object.keys(body)) fields[k] = echo[k as keyof AuthoringQuestion];
      ctx.patch(q.id, fields as Partial<AuthoringQuestion>);
    } catch (e) {
      ctx.failed(e);   // 403/409: the tree reloads; the editor stays open with the error
      throw e;
    } finally {
      ctx.busyQuestions.delete(q.id);
    }
  }

  function openNumber() {
    if (numEdit || editReason !== null) return;
    if (!ctx.edits.request()) return;
    const stored = q.correct_numeric;
    const storedD = q.precision;
    numEdit = new InlineEdit<NumDraft>({
      id: `key-${q.id}`,
      edits: ctx.edits,
      initial: { v: stored == null ? '' : formatNumber(stored), d: String(storedD ?? 0) },
      same: (a, b) => a.v.trim() === b.v.trim() && a.d.trim() === b.d.trim(),
      // Unchanged against the STORED key: "5.0" equals 5; an unset precision is always a change.
      unchanged: (x) => sameNumber(x.v, stored) && storedD != null && decimalsOk(x.d) && Number(x.d) === storedD,
      check: (x) => {
        const c = validateNumericAnswer(x.v);
        if (!c.ok) return c.reason;
        return decimalsOk(x.d) ? null : 'Decimals must be a whole number from 0 to 10.';
      },
      confirmSend: confirmKey,
      send: (x) => {
        const c = validateNumericAnswer(x.v);
        return sendKey({ correct_numeric: c.ok ? Number(c.canonical) : null, precision: Number(x.d) });
      },
      close: (refocus) => { numEdit = null; if (refocus) void refocusPencil(); },
    });
  }

  function openText() {
    if (textEdit || editReason !== null) return;
    if (!ctx.edits.request()) return;
    textEdit = new InlineEdit<string>({
      id: `key-${q.id}`,
      edits: ctx.edits,
      initial: q.correct_text ?? '',
      same: (a, b) => a.trim() === b.trim(),
      check: (v) => (v.trim() === '' ? 'Enter the answer' : null),
      confirmSend: confirmKey,
      send: (v) => sendKey({ correct_text: v.trim() }),
      close: (refocus) => { textEdit = null; if (refocus) void refocusPencil(); },
    });
  }

  const attachNum = (el: HTMLElement) => {
    el.querySelector<HTMLInputElement>('input')?.focus();
    return untrack(() => numEdit!.attach());
  };
</script>

{#if numEdit}
  <div class="key-edit" role="group" aria-label={`Answer to question ${n}`} {@attach attachNum}>
    <div class="key-fields">
      <label class="key-field">
        <span class="key-label">Answer</span>
        <input class="key-input mono" type="text" aria-label="Answer" maxlength="40"
               readonly={numEdit.saving} aria-invalid={numEdit.error ? 'true' : undefined}
               aria-describedby={numEdit.error ? errId : undefined}
               bind:value={numEdit.value.v} onkeydown={(e) => numEdit?.keydown(e)}
               oninput={() => { if (numEdit) numEdit.error = null; }} />
      </label>
      <label class="key-field">
        <span class="key-label">Decimals</span>
        <input class="key-input key-dec mono" type="text" inputmode="numeric" aria-label="Decimals" maxlength="2"
               readonly={numEdit.saving} bind:value={numEdit.value.d} onkeydown={(e) => numEdit?.keydown(e)}
               oninput={() => { if (numEdit) numEdit.error = null; }} />
      </label>
      <IconButton glyph="check" size="sm" title={numEdit.saving ? 'Saving…' : 'Save answer'}
                  onclick={() => void numEdit?.commit()} />
      <IconButton glyph="close" size="sm" title="Cancel" disabled={numEdit.saving} onclick={() => numEdit?.cancel()} />
    </div>
    {#if numEdit.error}<span class="key-err" id={errId} role="alert">{numEdit.error}</span>{/if}
  </div>
{:else if textEdit}
  <InlineInput edit={textEdit} label="Answer" saveTitle="Save answer" hint="Case-insensitive, trimmed match." />
{:else}
  <div class="key-row">
    <p class="key-line">
      {#if shown == null}Answer not set{:else}Answer <strong class="key-value">{shown}</strong>{tail}{/if}
    </p>
    {#if ctx.canText}
      <IconButton glyph="pencil" size="sm" borderless bind:element={pencil}
                  title={editReason ?? 'Edit the answer'} aria-label={`Edit the answer to question ${n}`}
                  disabled={editReason !== null} onclick={isNumber ? openNumber : openText} />
    {/if}
  </div>
{/if}

<style>
  .key-row { display: flex; align-items: center; gap: 6px; }
  .key-line { margin: 0; font-size: 13.5px; color: var(--text-2); overflow-wrap: anywhere; }
  .key-value { font-weight: 600; color: var(--text); }
  .key-edit { display: flex; flex-direction: column; gap: 4px; }
  .key-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
  .key-field { display: flex; flex-direction: column; gap: 4px; }
  .key-label { font-size: 12px; color: var(--muted); }
  .key-input {
    box-sizing: border-box;
    width: 160px;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .key-dec { width: 64px; }
  .key-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .key-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .key-err { font-size: 12px; color: var(--danger); }
</style>
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/KeyAnswer.svelte.test.ts src/tests/QuizOverview.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate rows.** In (ai), inside the `KeyAnswer` block after `d '\.key-line' …`, add:

```zsh
  d '\.key-row' '' 'display:flex' 'align-items:center' 'gap:6px'
  d '\.key-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.key-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  d '\.key-err' '' 'font-size:12px' 'color:var\(--danger\)'
  none "KeyAnswer no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
```

Run the gate (`cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && zsh scripts/visual-refresh-gate.sh > ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log 2>&1; tail -3 ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log`). Expected: it fails only with `ran N checks, expected <previous count>`, where N − previous equals the number of rows this step added. Set `EXPECTED_CHECKS=N`, re-run, and expect `ALL PASS (N checks)`. Record N in the ledger.

- [ ] **Step 6: Full verification.** vitest, svelte-check and the gate.

- [ ] **Step 7: Screenshots, review, commit.**
  - Screenshots:
    - the Number line;
    - the open Number editor;
    - a Number error;
    - the Text editor with its hint;
    - the published key confirm (a native dialog: describe it, or screenshot the page state before and after).
  - Get the user's OK, then run the review lanes until clean.
  - Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/editor/quiz/KeyAnswer.svelte frontend/src/tests/KeyAnswer.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(editor): Slice 5d T6 — Number and Text answers edited in place, published key confirm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Level 3 — the question text and explanation modals

**Files:**
- Create: `frontend/src/components/editor/quiz/QuestionTextModal.svelte`, `ExplanationModal.svelte`
- Replace: `frontend/src/components/editor/quiz/QuestionCard.svelte` (whole file: adds ✎ "Edit question N", the explanation ✎ / "+ Add explanation", and the level-3 mounts)
- Create: `frontend/src/tests/QuizModals.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((ai) rows)

**Interfaces:**
- Consumes:
  - T2: `DISCARD_PROMPT`, `WAIT_TITLE`, `EditHandle`, and MarkdownEditor `noAssets`;
  - T3: `QuizCtx` (`edits`, `patch`, `failed`, `say`, `focusFallback`, `assetContext`, `canText`, `disabled`);
  - T4: the item modal ignores ⌘S from other panels;
  - `updateQuestion`.
- Produces:
  - `QuestionTextModal` / `ExplanationModal` props: `{ q: AuthoringQuestion; n: number; onClose: (refocus: boolean) => void }`.
  - `QuestionCard` keeps the props `{ q, n }`. T8 adds the structure props.
  - Card DOM:
    - ✎ `button[aria-label="Edit question N"]` inside `.qhead .qacts`;
    - `.qexpl` holds ✎ "Edit explanation for question N";
    - otherwise `button.qexpl-add` "Add explanation to question N".

- [ ] **Step 1: Write the failing tests.** Create `frontend/src/tests/QuizModals.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, renderQuiz, cleanup, settle, panel, topPanel, cards, byName, typeInto, press, live, toastTexts, text,
} from './support/quizHarness.svelte';
import { DISCARD_PROMPT } from '../lib/quizEdits.svelte';

afterEach(cleanup);

const area = () => topPanel().querySelector<HTMLTextAreaElement>('textarea')!;
const footBtn = (label: string) =>
  [...topPanel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => text(b) === label)!;
const qWrites = (s: QuizServer) => s.writes().filter((c) => /^\/api\/questions\/\d+$/.test(c.path));
const isL3Open = () => document.querySelectorAll('section.modal-panel').length === 2;

async function openText(i = 0) { byName(cards()[i], `Edit question ${i + 1}`)!.click(); await settle(); }

describe('Question text modal (5d T7)', () => {
  it('opens on top, inside the quiz modal\'s DOM, titled "Question N" with the type; the textarea has focus', async () => {
    await renderQuiz(new QuizServer([q({ id: 1, text_md: 'What is x?' })]));
    await openText();
    expect(isL3Open()).toBe(true);
    expect(panel().contains(topPanel())).toBe(true);
    expect(text(topPanel().querySelector('h2'))).toBe('Question 1');
    expect(text(topPanel().querySelector('.qt-sub'))).toBe('Single choice');
    expect(area().value).toBe('What is x?');
    expect(document.activeElement).toBe(area());
  });

  it('Save sends text_md, re-renders the card (links in a new tab), returns focus to ✎, announces "Saved"', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    typeInto(area(), 'See <a href="https://x.test">x</a>');
    footBtn('Save').click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ text_md: 'See <a href="https://x.test">x</a>' }]);
    expect(isL3Open()).toBe(false);
    expect(cards()[0].querySelector('.qtext a')!.getAttribute('target')).toBe('_blank');
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
    expect(live()).toBe('Saved');
  });

  it('closing without changes just closes; with changes it asks; Esc closes only the top modal', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]));
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openText();
    footBtn('Cancel').click();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(isL3Open()).toBe(false);
    await openText();
    typeInto(area(), 'changed');
    expect(r.anyDirty()).toBe('true');
    press(area(), 'Escape');
    await settle();
    expect(ask).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(isL3Open()).toBe(true);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    press(area(), 'Escape');
    await settle();
    expect(isL3Open()).toBe(false);
    expect(r.onRequestClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('empty text shows an error inside the modal and sends nothing', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    typeInto(area(), '   ');
    footBtn('Save').click();
    await settle();
    expect(text(topPanel().querySelector('.qt-err'))).toBe('Enter the question text');
    expect(qWrites(s)).toEqual([]);
  });

  it('while saving: read-only, Cancel and × disabled, Esc ignored, not unsaved work; a failure shows inside', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    const r = await renderQuiz(s);
    await openText();
    typeInto(area(), 'New');
    footBtn('Save').click();
    await settle();
    expect(area().readOnly).toBe(true);
    expect(footBtn('Cancel').disabled).toBe(true);
    expect(topPanel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.disabled).toBe(true);
    press(area(), 'Escape');
    await settle();
    expect(isL3Open()).toBe(true);
    expect(r.anyDirty()).toBe('false');
    hold.fail(422, 'Too long');
    await settle();
    expect(isL3Open()).toBe(true);
    expect(text(topPanel().querySelector('.qt-err'))).toBe('Too long');
    expect(area().value).toBe('New');
    expect(toastTexts()).toEqual([]);
  });

  it('Back during a level-3 save does not prompt; a late failure toasts', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    const r = await renderQuiz(s);
    await openText();
    typeInto(area(), 'New');
    footBtn('Save').click();
    await settle();
    expect(r.anyDirty()).toBe('false');
    r.closeModal();
    hold.fail(500, 'Boom');
    await settle();
    expect(toastTexts()).toEqual(['Boom']);
  });

  it('an upload in flight disables Save', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    s.hold('POST', /\/assets$/);
    await renderQuiz(s);
    await openText();
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['a'], 'a.png', { type: 'image/png' })], types: ['Files'] } });
    area().dispatchEvent(drop);
    await settle();
    expect(footBtn('Save').disabled).toBe(true);
  });

  it('Tab and Shift+Tab stay in the top modal; ⌘S saves the top modal only', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    await openText();
    const save = footBtn('Save');
    save.focus();
    press(save, 'Tab');
    expect(topPanel().contains(document.activeElement)).toBe(true);
    press(document.activeElement!, 'Tab', { shiftKey: true });
    expect(topPanel().contains(document.activeElement)).toBe(true);
    typeInto(area(), 'Via keyboard');
    const e = press(area(), 's', { metaKey: true });
    await settle();
    expect(e.defaultPrevented).toBe(true);
    expect(qWrites(s).map((c) => c.body)).toEqual([{ text_md: 'Via keyboard' }]);
    expect(s.writes().filter((c) => c.path === '/api/items/7')).toEqual([]);
  });

  it('an echo writes back only the fields its request carried', async () => {
    const s = new QuizServer([q({ id: 1, type: 'numeric_answer', correct_numeric: 5, precision: 2 })]);
    const hold = s.hold('PATCH', /\/api\/questions\/1$/);
    await renderQuiz(s);
    byName(cards()[0], 'Edit the answer to question 1')!.click();
    await settle();
    typeInto(cards()[0].querySelector<HTMLInputElement>('input[aria-label="Answer"]')!, '6');
    press(cards()[0].querySelector('input[aria-label="Answer"]')!, 'Enter');
    await settle();
    // Another tab changes the text meanwhile; this echo carries it.
    s.questions[0].text_md = 'Elsewhere';
    s.questions[0].text_html = '<p>Elsewhere</p>';
    hold.release();
    await settle();
    expect(text(cards()[0].querySelector('.qtext'))).toBe('Q1');
    expect(text(cards()[0].querySelector('p.key-line'))).toBe('Answer 6 · 2 decimals (± 0.005)');
  });
});

describe('Explanation modal (5d T7)', () => {
  it('"+ Add explanation" opens it with no asset sidebar and the note; Save adds; focus goes to the new ✎', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    await renderQuiz(s);
    byName(cards()[0], 'Add explanation to question 1')!.click();
    await settle();
    expect(text(topPanel().querySelector('h2'))).toBe('Explanation · question 1');
    expect(text(topPanel().querySelector('.ex-sub'))).toBe('Shown to students after they answer.');
    expect(text(topPanel().querySelector('.ex-note'))).toBe(
      'Markdown. Images already in an explanation keep working; new ones cannot be added here.');
    expect(topPanel().querySelector('[data-testid="asset-sidebar"]')).toBeNull();
    expect(byName(topPanel(), 'Remove explanation')).toBeUndefined();
    typeInto(area(), 'Because');
    footBtn('Save').click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ explanation_md: 'Because' }]);
    expect(text(cards()[0].querySelector('.qexpl-body'))).toBe('Because');
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit explanation for question 1'));
  });

  it('Remove confirms, sends null, and focus goes to "+ Add explanation"', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    expect(ask).toHaveBeenCalledWith('Remove the explanation for question 1?');
    expect(qWrites(s)).toEqual([]);
    ask.mockReturnValue(true);
    byName(topPanel(), 'Remove explanation')!.click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ explanation_md: null }]);
    expect(cards()[0].querySelector('.qexpl')).toBeNull();
    expect(document.activeElement).toBe(byName(cards()[0], 'Add explanation to question 1'));
  });

  it('saving an empty explanation also removes it', async () => {
    const s = new QuizServer([q({ id: 1, explanation_md: 'Old', explanation_html: '<p>Old</p>' })]);
    await renderQuiz(s);
    byName(cards()[0], 'Edit explanation for question 1')!.click();
    await settle();
    typeInto(area(), '  ');
    footBtn('Save').click();
    await settle();
    expect(qWrites(s).map((c) => c.body)).toEqual([{ explanation_md: null }]);
  });

  it('a page discard closes an open level-3 modal', async () => {
    const r = await renderQuiz(new QuizServer([q({ id: 1 })]));
    byName(cards()[0], 'Add explanation to question 1')!.click();
    await settle();
    typeInto(area(), 'typed');
    r.registry().discardAll();
    await settle();
    expect(isL3Open()).toBe(false);
  });

  it('published: text and explanation stay editable; archived: no pencils at all', async () => {
    await renderQuiz(new QuizServer([q({ id: 1 })]), { version: { state: 'published' } });
    expect(byName(cards()[0], 'Edit question 1')).toBeDefined();
    expect(byName(cards()[0], 'Add explanation to question 1')).toBeDefined();
    cleanup();
    await renderQuiz(new QuizServer([q({ id: 1, explanation_md: 'e', explanation_html: '<p>e</p>' })]), { version: { state: 'archived' } });
    expect(byName(cards()[0], 'Edit question 1')).toBeUndefined();
    expect(byName(cards()[0], 'Edit explanation for question 1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizModals.svelte.test.ts`
Expected: FAIL. There is no "Edit question 1" button yet. "an echo writes back only …" may already pass with T6; keep it as a pin.

- [ ] **Step 3: Create `frontend/src/components/editor/quiz/QuestionTextModal.svelte`:**

```svelte
<script lang="ts">
  // Level 3: the question text (spec §Level 3). A modal stacked on the quiz
  // modal. It holds the edit slot while open, so a page discard closes it and
  // its changes count as unsaved work. Save sends one PATCH and closes.
  import { getContext, untrack } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import Button from '../../ui/Button.svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import { DISCARD_PROMPT, type EditHandle } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { TYPE_LABEL } from '../../../lib/quizFormat';
  import { pushToast } from '../../../stores/toasts.svelte';
  import { updateQuestion, type AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n, onClose }: { q: AuthoringQuestion; n: number; onClose: (refocus: boolean) => void } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const labelId = `${uid}-title`;
  const errId = `${uid}-err`;
  const qid = untrack(() => q.id);
  const initial = untrack(() => q.text_md);

  let value = $state(initial);
  let saving = $state(false);
  let uploading = $state(false);
  let error = $state<string | null>(null);
  let alive = true;

  const handle: EditHandle = {
    id: `qtext-${qid}`,
    get dirty() { return value !== initial; },
    get saving() { return saving; },
    close: (refocus) => onClose(refocus),
  };
  $effect(() => {
    untrack(() => ctx.edits.open(handle));
    return () => { alive = false; ctx.edits.release(handle); };
  });

  function requestClose() {
    if (saving) return;
    if (handle.dirty && !window.confirm(DISCARD_PROMPT)) return;
    onClose(true);
  }

  async function save() {
    if (saving || uploading) return;
    if (value.trim() === '') { error = 'Enter the question text'; return; }
    if (value === initial) { onClose(true); return; }
    error = null;
    saving = true;
    try {
      const echo = await ctx.edits.track(updateQuestion(qid, { text_md: value }));
      ctx.patch(qid, { text_md: echo.text_md, text_html: echo.text_html });
      ctx.say('Saved');
      if (alive) onClose(true);
    } catch (e) {
      const m = ctx.failed(e);
      // A failed save always reports: inside the modal, or as a toast once it is gone.
      if (!alive) { pushToast(m, 'error'); return; }
      saving = false;
      error = m;
    }
  }

  // ⌘S means this modal's Save — only for events from this panel.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('section.modal-panel')?.getAttribute('aria-labelledby') !== labelId) return;
    e.preventDefault();
    void save();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet head()}
  <h2 id={labelId} class="qt-title">Question {n}</h2>
  <span class="qt-sub">{TYPE_LABEL[q.type]}</span>
{/snippet}

{#snippet foot()}
  <span class="qt-gap"></span>
  <Button variant="ghost" disabled={saving} onclick={requestClose}>Cancel</Button>
  <Button variant="primary" loading={saving} disabled={uploading}
          title={uploading ? 'Wait for the upload to finish' : undefined} onclick={() => void save()}>Save</Button>
{/snippet}

<Modal
  labelledby={labelId}
  width={760}
  onRequestClose={requestClose}
  closeDisabled={saving}
  autofocusSelector={'textarea, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <MarkdownEditor ariaLabel="Question text" assetContext={ctx.assetContext} bind:value bind:uploading
                  frozen={saving} ariaDescribedby={error ? errId : undefined} />
  {#if error}<p class="qt-err" id={errId} role="alert">{error}</p>{/if}
</Modal>

<style>
  .qt-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .qt-sub { font-size: 12px; color: var(--muted); }
  .qt-gap { flex: 1; }
  .qt-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
```

> If `frozen` does not make the textarea `readOnly`, check MarkdownEditor: it may use `readOnly` for that. Pass `readOnly={saving}` as well and record a ledger ruling. The test asserts `area().readOnly`.

- [ ] **Step 4: Create `frontend/src/components/editor/quiz/ExplanationModal.svelte`:**

```svelte
<script lang="ts">
  // Level 3: the explanation (spec §Level 3). Markdown with Edit/Preview in
  // the editor's no-assets mode (D11). Saving empty text — or "Remove
  // explanation" — sends explanation_md: null.
  import { getContext, untrack } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import Button from '../../ui/Button.svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import { DISCARD_PROMPT, type EditHandle } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { pushToast } from '../../../stores/toasts.svelte';
  import { updateQuestion, type AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n, onClose }: { q: AuthoringQuestion; n: number; onClose: (refocus: boolean) => void } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const labelId = `${uid}-title`;
  const errId = `${uid}-err`;
  const noteId = `${uid}-note`;
  const qid = untrack(() => q.id);
  const initial = untrack(() => q.explanation_md ?? '');
  const exists = initial.trim() !== '';

  let value = $state(initial);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let alive = true;

  const handle: EditHandle = {
    id: `qexpl-${qid}`,
    get dirty() { return value !== initial; },
    get saving() { return saving; },
    close: (refocus) => onClose(refocus),
  };
  $effect(() => {
    untrack(() => ctx.edits.open(handle));
    return () => { alive = false; ctx.edits.release(handle); };
  });

  function requestClose() {
    if (saving) return;
    if (handle.dirty && !window.confirm(DISCARD_PROMPT)) return;
    onClose(true);
  }

  async function send(md: string | null) {
    error = null;
    saving = true;
    try {
      const echo = await ctx.edits.track(updateQuestion(qid, { explanation_md: md }));
      ctx.patch(qid, { explanation_md: echo.explanation_md, explanation_html: echo.explanation_html });
      ctx.say('Saved');
      if (alive) onClose(true);
    } catch (e) {
      const m = ctx.failed(e);
      if (!alive) { pushToast(m, 'error'); return; }
      saving = false;
      error = m;
    }
  }

  function save() {
    if (saving) return;
    if (value === initial) { onClose(true); return; }
    void send(value.trim() === '' ? null : value);
  }

  function remove() {
    if (saving) return;
    if (!window.confirm(`Remove the explanation for question ${n}?`)) return;
    void send(null);
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('section.modal-panel')?.getAttribute('aria-labelledby') !== labelId) return;
    e.preventDefault();
    save();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet head()}
  <h2 id={labelId} class="ex-title">Explanation · question {n}</h2>
  <span class="ex-sub">Shown to students after they answer.</span>
{/snippet}

{#snippet foot()}
  {#if exists}
    <Button variant="danger" disabled={saving} onclick={remove}>Remove explanation</Button>
  {/if}
  <span class="ex-gap"></span>
  <Button variant="ghost" disabled={saving} onclick={requestClose}>Cancel</Button>
  <Button variant="primary" loading={saving} onclick={save}>Save</Button>
{/snippet}

<Modal
  labelledby={labelId}
  width={560}
  onRequestClose={requestClose}
  closeDisabled={saving}
  autofocusSelector={'textarea, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <MarkdownEditor ariaLabel="Explanation" assetContext={ctx.assetContext} bind:value noAssets
                  frozen={saving} ariaDescribedby={error ? `${errId} ${noteId}` : noteId} />
  <p class="ex-note" id={noteId}>Markdown. Images already in an explanation keep working; new ones cannot be added here.</p>
  {#if error}<p class="ex-err" id={errId} role="alert">{error}</p>{/if}
</Modal>

<style>
  .ex-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .ex-sub { font-size: 12px; color: var(--muted); }
  .ex-gap { flex: 1; }
  .ex-note { margin: 0; font-size: 12px; color: var(--muted); }
  .ex-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
```

- [ ] **Step 5: Replace `frontend/src/components/editor/quiz/QuestionCard.svelte`:**

```svelte
<script lang="ts">
  // One question in the overview (spec §A question card): the rendered text
  // (plain source when disabled), the type chip, D9 hints, the answers and the
  // explanation. Clicking the text never edits it; ✎ opens level 3. A level-3
  // close returns focus to its opener, or to its replacement (explanation ✎
  // ↔ "+ Add explanation"), else the §Focus fallback.
  import { getContext, onDestroy, tick } from 'svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import ChoiceAnswers from './ChoiceAnswers.svelte';
  import KeyAnswer from './KeyAnswer.svelte';
  import QuestionTextModal from './QuestionTextModal.svelte';
  import ExplanationModal from './ExplanationModal.svelte';
  import { newTabLinks } from '../../../lib/newTabLinks';
  import { TYPE_LABEL, questionHints } from '../../../lib/quizFormat';
  import { WAIT_TITLE } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import type { AuthoringOption, AuthoringQuestion } from '../../../lib/quizAuthoring';

  let { q, n }: { q: AuthoringQuestion; n: number } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const textId = `${uid}-text`;
  let alive = true;
  onDestroy(() => { alive = false; });

  const choice = $derived(q.type === 'single_choice' || q.type === 'multiple_choice');
  let options = $state<AuthoringOption[] | null>(null);
  const hints = $derived(questionHints(q.type, choice ? options : null, q.precision));
  const hasExpl = $derived((q.explanation_md ?? '').trim() !== '');

  // ---- Level 3 ----
  let l3 = $state<'text' | 'expl' | null>(null);
  let cardEl = $state<HTMLElement>();
  const openReason = $derived(ctx.edits.locked ? WAIT_TITLE : null);
  function open(kind: 'text' | 'expl') {
    if (l3 !== null || openReason !== null) return;
    if (!ctx.edits.request()) return;
    l3 = kind;
  }
  async function closeL3(kind: 'text' | 'expl', refocus: boolean) {
    l3 = null;
    if (!refocus) return;
    await tick();
    if (!alive || !cardEl) return;
    const target = cardEl.querySelector<HTMLButtonElement>(
      kind === 'text' ? '.qhead button[data-glyph="pencil"]'
        : '.qexpl button[data-glyph="pencil"], button.qexpl-add',
    );
    if (target && !target.disabled) target.focus();
    else ctx.focusFallback(q.id);
  }
</script>

<li class="qcard" data-q-id={q.id} aria-labelledby={textId} bind:this={cardEl}>
  <div class="qhead">
    <span class="qnum" aria-hidden="true">{n}.</span>
    {#if ctx.disabled}
      <pre class="qsrc" id={textId}>{q.text_md}</pre>
    {:else}
      <div class="qtext" id={textId} {@attach newTabLinks(q.text_html)}>{@html q.text_html}</div>
    {/if}
    <span class="qmeta">
      <span class="qchip">{TYPE_LABEL[q.type]}</span>
      {#each hints as h (h)}<span class="qhint">{h}</span>{/each}
      <span class="qacts">
        {#if ctx.canText}
          <IconButton glyph="pencil" size="sm" borderless title={openReason ?? 'Edit question'}
                      aria-label={`Edit question ${n}`} disabled={openReason !== null} onclick={() => open('text')} />
        {/if}
      </span>
    </span>
  </div>

  <div class="qanswers">
    {#if choice}
      <ChoiceAnswers {q} {n} bind:options />
    {:else}
      <KeyAnswer {q} {n} />
    {/if}
  </div>

  {#if hasExpl}
    <div class="qexpl">
      <span class="qexpl-head">
        <span class="qexpl-label">Explanation</span>
        {#if ctx.canText}
          <IconButton glyph="pencil" size="sm" borderless title={openReason ?? 'Edit explanation'}
                      aria-label={`Edit explanation for question ${n}`} disabled={openReason !== null}
                      onclick={() => open('expl')} />
        {/if}
      </span>
      {#if ctx.disabled}
        <pre class="qsrc">{q.explanation_md}</pre>
      {:else}
        <div class="qexpl-body" {@attach newTabLinks(q.explanation_html ?? '')}>{@html q.explanation_html ?? ''}</div>
      {/if}
    </div>
  {:else if ctx.canText}
    <button type="button" class="qexpl-add" aria-label={`Add explanation to question ${n}`}
            title={openReason ?? 'Add explanation'} disabled={openReason !== null} onclick={() => open('expl')}>+ Add explanation</button>
  {/if}

  <!-- Level 3 stays mounted whatever a 403/409 reload does to the permissions. -->
  {#if l3 === 'text'}<QuestionTextModal {q} {n} onClose={(r) => void closeL3('text', r)} />{/if}
  {#if l3 === 'expl'}<ExplanationModal {q} {n} onClose={(r) => void closeL3('expl', r)} />{/if}
</li>

<style>
  .qcard { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
  .qhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 10px 12px 6px; }
  .qnum { flex: 0 0 auto; min-width: 18px; color: var(--ordinal); font-weight: 600; font-size: 14.5px; }
  .qtext { flex: 1 1 260px; min-width: 0; font-size: 14.5px; color: var(--text); overflow-wrap: anywhere; }
  .qsrc { flex: 1 1 260px; min-width: 0; margin: 0; font: inherit; font-size: 13px; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .qmeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  .qchip { font-size: 11px; font-weight: 500; color: var(--muted); background: var(--surface-2); border-radius: 3px; padding: 2px 7px; white-space: nowrap; }
  .qhint { font-size: 11px; font-weight: 500; color: var(--status-needs-revision-fg); white-space: nowrap; }
  .qacts { display: flex; align-items: center; gap: 2px; }
  .qanswers { padding: 2px 12px 8px 38px; }
  .qexpl { margin: 0 12px 10px 38px; padding: 7px 10px; border-left: 3px solid var(--border-strong); background: var(--surface-2); font-size: 12.5px; color: var(--muted); }
  .qexpl-head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
  .qexpl-label { font-weight: 600; }
  .qexpl-add { margin: 0 12px 10px 38px; border: 0; padding: 0; background: transparent; font: inherit; font-size: 12.5px; color: var(--primary); cursor: pointer; }
  .qexpl-add:disabled { color: var(--faint); cursor: default; }
  .qexpl-add:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  /* Rendered author content: images fit the card; headings keep their tags at body size. */
  .qtext :global(p), .qexpl-body :global(p) { margin: 0; }
  .qtext :global(p + p), .qexpl-body :global(p + p) { margin-top: 6px; }
  .qtext :global(img), .qexpl-body :global(img) { max-width: 100%; height: auto; }
  .qtext :global(:is(h1, h2, h3, h4, h5, h6)), .qexpl-body :global(:is(h1, h2, h3, h4, h5, h6)) { font-size: inherit; margin: 0; }
  @media (max-width: 560px) { .qmeta { flex-basis: 100%; margin-left: 26px; } }
</style>
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizModals.svelte.test.ts src/tests/QuizOverview.svelte.test.ts src/tests/Modal.svelte.test.ts src/tests/FocusTrap.svelte.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate rows.** In (ai), inside the `QuestionCard` block add:

```zsh
  d '\.qexpl-add' '' 'color:var\(--primary\)' 'font-size:12\.5px'
```

Then add, after the `InlineInput` block:

```zsh
own qt-title QuestionTextModal.svelte
uniq1 qt-title
if [[ -n $REPLY ]]; then
  N=QuestionTextModal; H=$REPLY
  d '\.qt-title' '' 'margin:0' 'font-size:15px' 'font-weight:600' 'color:var\(--text\)'
  d '\.qt-err' '' 'font-size:12px' 'color:var\(--danger\)'
  sweep QuestionTextModal $H
fi
own ex-note ExplanationModal.svelte
uniq1 ex-note
if [[ -n $REPLY ]]; then
  N=ExplanationModal; H=$REPLY
  d '\.ex-title' '' 'margin:0' 'font-size:15px' 'font-weight:600' 'color:var\(--text\)'
  d '\.ex-note' '' 'font-size:12px' 'color:var\(--muted\)'
  d '\.ex-err' '' 'font-size:12px' 'color:var\(--danger\)'
  sweep ExplanationModal $H
fi
```

Run the gate (`cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && zsh scripts/visual-refresh-gate.sh > ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log 2>&1; tail -3 ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log`). Expected: it fails only with `ran N checks, expected <previous count>`, where N − previous equals the number of rows this step added. Set `EXPECTED_CHECKS=N`, re-run, and expect `ALL PASS (N checks)`. Record N in the ledger.

- [ ] **Step 8: Full verification.** vitest, svelte-check and the gate.

- [ ] **Step 9: Screenshots, review, commit.**
  - Screenshots:
    - the question text modal on top of the quiz modal;
    - the explanation modal (no sidebar, the note, Remove);
    - an error inside a modal;
    - the card after adding an explanation.

    Check that the stacked backdrop covers the whole window and is not clipped by the quiz modal's scroll area.
  - Get the user's OK, then run the review lanes until clean.
  - Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/editor/quiz/QuestionTextModal.svelte frontend/src/components/editor/quiz/ExplanationModal.svelte frontend/src/components/editor/quiz/QuestionCard.svelte frontend/src/tests/QuizModals.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(editor): Slice 5d T7 — level-3 modals for question text and explanation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Structure — new question, move and delete questions, 403/409, focus fallback

**Files:**
- Create: `frontend/src/components/editor/quiz/NewQuestionModal.svelte`
- Replace: `frontend/src/components/editor/quiz/QuizBody.svelte` (whole file)
- Modify: `frontend/src/components/editor/quiz/QuestionCard.svelte` (props; question ↑ ↓ delete)
- Modify: `frontend/src/components/editor/quiz/ChoiceAnswers.svelte` (`autoAdd`)
- Create: `frontend/src/tests/QuizStructure.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((ai) rows)

**Interfaces:**
- Consumes:
  - T2: `QuestionTypePicker` (relabelled), `DISCARD_PROMPT`, `WAIT_TITLE`;
  - T3 context;
  - T5: `ChoiceAnswers` `openAdd`;
  - T7: `QuestionCard`;
  - `createQuestion`, `deleteQuestion`, `reorderQuestions`, `listQuestions`.
- Produces:
  - `QuestionCard` props `{ q, n, count, moving, autoAdd, onAutoAddDone, onMove, onDelete }`.
  - `ChoiceAnswers` props add `autoAdd?: boolean; onAutoAddDone?: () => void`.
  - `NewQuestionModal` props `{ onCreate: (body: QuestionCreateBody) => Promise<void>; onClose: (refocus: boolean) => void }`; `onCreate` throws on failure, and on success the quiz body unmounts the modal itself.
  - "+ Add question" is a primary `Button` inside `span.q-add`, which T3's `focusFallback` already queries.

- [ ] **Step 1: Write the failing tests.** Create `frontend/src/tests/QuizStructure.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QuizServer, q, opt, renderQuiz, cleanup, settle, panel, topPanel, cards, rows, byName, typeInto, press, live,
  toastTexts, text, mkVersion,
} from './support/quizHarness.svelte';
import { DISCARD_PROMPT, WAIT_TITLE } from '../lib/quizEdits.svelte';
import { versionPermissions } from '../lib/versionPermissions';

afterEach(cleanup);

const addQ = () => byName(panel(), '+ Add question')!;
const area = () => topPanel().querySelector<HTMLTextAreaElement>('textarea')!;
const footBtn = (label: string) =>
  [...topPanel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => text(b) === label)!;
const posts = (s: QuizServer) => s.writes().filter((c) => c.method === 'POST' && c.path === '/api/items/7/questions');
const isL3Open = () => document.querySelectorAll('section.modal-panel').length === 2;
const radio = (label: string) =>
  [...topPanel().querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => text(r.closest('label')) === label)!;

describe('Adding a question (5d T8)', () => {
  it('"+ Add question" waits for the list; it is absent when the version forbids structure', async () => {
    const s = new QuizServer([q({ id: 1 })]);
    const hold = s.hold('GET', /\/items\/7\/questions$/);
    await renderQuiz(s);
    expect(addQ().disabled).toBe(true);
    hold.release();
    await settle();
    expect(addQ().disabled).toBe(false);
    cleanup();
    await renderQuiz(new QuizServer([q({ id: 1 })]), { version: { state: 'published' } });
    expect(byName(panel(), '+ Add question')).toBeUndefined();
  });

  it('opens New question directly with focus on the checked type; a type change alone is not a change', async () => {
    const s = new QuizServer([]);
    const r = await renderQuiz(s);
    addQ().click();
    await settle();
    expect(text(topPanel().querySelector('h2'))).toBe('New question');
    expect(document.activeElement).toBe(radio('Single choice'));
    radio('Number').click();
    await settle();
    expect(r.anyDirty()).toBe('false');
    expect(topPanel().querySelector('input[aria-label="Decimals"]')).not.toBeNull();
    const ask = vi.spyOn(window, 'confirm');
    footBtn('Cancel').click();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(isL3Open()).toBe(false);
    expect(posts(s)).toEqual([]);
    expect(document.activeElement).toBe(addQ());
  });

  it('typed text is unsaved work; Cancel asks first', async () => {
    const r = await renderQuiz(new QuizServer([]));
    addQ().click();
    await settle();
    typeInto(area(), 'Draft');
    expect(r.anyDirty()).toBe('true');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    footBtn('Cancel').click();
    await settle();
    expect(ask).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(isL3Open()).toBe(true);
  });

  it('choice: one create; the card is added at the end; its "+ Add answer" row opens with focus', async () => {
    const s = new QuizServer([q({ id: 1 })], [opt(11, 1, 'A', true), opt(12, 1, 'B')]);
    await renderQuiz(s);
    const trees = () => s.calls.filter((c) => c.path.endsWith('/admin-tree')).length;
    const before = trees();
    addQ().click();
    await settle();
    expect(footBtn('Add question').disabled).toBe(true);
    typeInto(area(), 'Pick one');
    footBtn('Add question').click();
    await settle();
    await settle();
    expect(posts(s).map((c) => c.body)).toEqual([{ text_md: 'Pick one', type: 'single_choice' }]);
    expect(isL3Open()).toBe(false);
    expect(cards().length).toBe(2);
    expect(trees()).toBe(before + 1);
    expect(document.activeElement).toBe(cards()[1].querySelector('.ans-add input'));
  });

  it('choice whose answers fail to load: focus goes to the new card\'s pencil', async () => {
    const s = new QuizServer([]);
    s.failNext('GET', /\/questions\/1000\/options$/, 500, 'Boom');
    await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'Pick one');
    footBtn('Add question').click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('Number: valid only with a number and decimals; one create with both; focus on the new card\'s pencil', async () => {
    const s = new QuizServer([]);
    await renderQuiz(s);
    addQ().click();
    await settle();
    radio('Number').click();
    await settle();
    typeInto(area(), 'How much?');
    expect(footBtn('Add question').disabled).toBe(true);
    typeInto(topPanel().querySelector<HTMLInputElement>('input[aria-label="Answer"]')!, '2.5');
    typeInto(topPanel().querySelector<HTMLInputElement>('input[aria-label="Decimals"]')!, '1');
    footBtn('Add question').click();
    await settle();
    expect(posts(s).map((c) => c.body)).toEqual([{ text_md: 'How much?', type: 'numeric_answer', correct_numeric: 2.5, precision: 1 }]);
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
  });

  it('Text: one create with the answer', async () => {
    const s = new QuizServer([]);
    await renderQuiz(s);
    addQ().click();
    await settle();
    radio('Text').click();
    await settle();
    typeInto(area(), 'Name it');
    typeInto(topPanel().querySelector<HTMLInputElement>('input[aria-label="Answer"]')!, ' vector ');
    footBtn('Add question').click();
    await settle();
    expect(posts(s).map((c) => c.body)).toEqual([{ text_md: 'Name it', type: 'text_answer', correct_text: 'vector' }]);
  });

  it('a failed create keeps the modal open with the error inside', async () => {
    const s = new QuizServer([]);
    s.failNext('POST', /\/items\/7\/questions$/, 409, 'Version is not editable');
    await renderQuiz(s);
    addQ().click();
    await settle();
    typeInto(area(), 'Q');
    footBtn('Add question').click();
    await settle();
    expect(isL3Open()).toBe(true);
    expect(text(topPanel().querySelector('.nq-err'))).toBe('Version is not editable');
  });
});

describe('Moving and deleting questions (5d T8)', () => {
  const two = () => new QuizServer([q({ id: 1 }), q({ id: 2 })], [opt(11, 1, 'A', true), opt(21, 2, 'B', true)]);

  it('move down: optimistic, announced, one reorder, focus on the other arrow at the end', async () => {
    const s = two();
    await renderQuiz(s);
    byName(cards()[0], 'Move question 1 down')!.click();
    await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['2', '1']);
    expect(live()).toBe('Question moved to position 2 of 2');
    expect(s.writes().map((c) => c.body)).toEqual([{ order: [{ id: 2, order: 1 }, { id: 1, order: 2 }] }]);
    expect(document.activeElement).toBe(byName(cards()[1], 'Move question 2 up'));
  });

  it('a failed move toasts and reloads the list', async () => {
    const s = two();
    s.failNext('POST', /\/questions\/reorder$/, 500, 'Nope');
    await renderQuiz(s);
    byName(cards()[0], 'Move question 1 down')!.click();
    await settle();
    expect(toastTexts()).toEqual(['Nope']);
    expect(cards().map((c) => c.dataset.qId)).toEqual(['1', '2']);
  });

  it('delete confirms; focus goes to the next card, then the previous, then + Add question', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 }), q({ id: 3 })]);
    await renderQuiz(s);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    expect(ask).toHaveBeenCalledWith('Delete question "Q2"? This cannot be undone.');
    expect(cards().length).toBe(3);
    ask.mockReturnValue(true);
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['1', '3']);
    expect(document.activeElement).toBe(byName(cards()[1], 'Edit question 2'));
    byName(cards()[1], 'Delete question 2')!.click();
    await settle();
    expect(document.activeElement).toBe(byName(cards()[0], 'Edit question 1'));
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    expect(document.activeElement).toBe(addQ());
  });

  it('the per-quiz lock: during a move, other structure controls wait; the moving card\'s arrows do not', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 }), q({ id: 3 })]);
    const hold = s.hold('POST', /\/questions\/reorder$/);
    await renderQuiz(s);
    byName(cards()[1], 'Move question 2 down')!.click();
    await settle();
    const moved = cards()[2];
    expect(byName(moved, 'Move question 3 up')!.disabled).toBe(false);
    const other = cards()[0];
    for (const b of [byName(other, 'Move question 1 down')!, byName(other, 'Delete question 1')!, addQ()]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe(WAIT_TITLE);
    }
    byName(moved, 'Move question 3 up')!.click();
    hold.release();
    await settle();
    expect(s.writes().length).toBe(1);
  });

  it('the per-question lock: an answer write disables that question\'s move and delete', async () => {
    const s = two();
    const hold = s.hold('PATCH', /\/api\/options\/11$/);
    await renderQuiz(s);
    rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!.click();
    await settle();
    typeInto(cards()[0].querySelector<HTMLInputElement>('input.inline-input')!, 'A2');
    press(cards()[0].querySelector('input.inline-input')!, 'Enter');
    await settle();
    expect(byName(cards()[0], 'Move question 1 down')!.disabled).toBe(true);
    expect(byName(cards()[0], 'Delete question 1')!.title).toBe(WAIT_TITLE);
    expect(byName(cards()[1], 'Move question 2 up')!.disabled).toBe(false);
    hold.release();
    await settle();
  });

  it('D10: deleting the question that holds a changed edit asks the discard prompt first', async () => {
    const s = two();
    await renderQuiz(s);
    rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!.click();
    await settle();
    typeInto(cards()[0].querySelector<HTMLInputElement>('input.inline-input')!, 'changed');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    byName(cards()[0], 'Delete question 1')!.click();
    await settle();
    expect(ask.mock.calls.map((c) => c[0])).toEqual([DISCARD_PROMPT]);
    expect(s.writes()).toEqual([]);
  });

  it('structure controls are absent when published, archived and disabled', async () => {
    for (const v of [{ state: 'published' as const }, { state: 'archived' as const }, { is_disabled: true }]) {
      await renderQuiz(two(), { version: v });
      expect(byName(cards()[0], 'Move question 1 down')).toBeUndefined();
      expect(byName(cards()[0], 'Delete question 1')).toBeUndefined();
      expect(byName(panel(), '+ Add question')).toBeUndefined();
      cleanup();
    }
  });
});

describe('Unsaved work across edit kinds (5d T8)', () => {
  it('each edit kind reports unsaved work only when changed; a page discard closes it', async () => {
    const s = new QuizServer(
      [q({ id: 1 }), q({ id: 2, type: 'numeric_answer', correct_numeric: 5, precision: 0 }),
       q({ id: 3, type: 'text_answer', correct_text: 'v' })],
      [opt(11, 1, 'A', true)],
    );
    const r = await renderQuiz(s);
    const field = () => panel().querySelector<HTMLInputElement>('input.inline-input, input[aria-label="Answer"]')!;
    const openers: [string, () => HTMLButtonElement][] = [
      ['answer text', () => rows(cards()[0])[0].querySelector<HTMLButtonElement>('button.ans-edit')!],
      ['add answer', () => cards()[0].querySelector<HTMLButtonElement>('button.ans-add-btn')!],
      ['Number', () => byName(cards()[1], 'Edit the answer to question 2')!],
      ['Text', () => byName(cards()[2], 'Edit the answer to question 3')!],
    ];
    for (const [kind, opener] of openers) {
      opener().click();
      await settle();
      expect([kind, r.anyDirty()]).toEqual([kind, 'false']);
      typeInto(field(), `${kind} changed`);
      expect([kind, r.anyDirty()]).toEqual([kind, 'true']);
      r.registry().discardAll();
      await settle();
      expect([kind, r.anyDirty(), panel().querySelector('input.inline-input, input[aria-label="Answer"]')])
        .toEqual([kind, 'false', null]);
    }
    addQ().click();
    await settle();
    typeInto(area(), 'Draft');
    expect(r.anyDirty()).toBe('true');
    r.registry().discardAll();
    await settle();
    expect(isL3Open()).toBe(false);
    expect(s.writes()).toEqual([]);
  });
});

describe('403/409 and the focus fallback (5d T8)', () => {
  it('a 409 on save keeps the field open with its text and reloads the tree; it survives the permission flip', async () => {
    const s = new QuizServer([q({ id: 1, type: 'text_answer', correct_text: 'old' })]);
    s.failNext('PATCH', /\/api\/questions\/1$/, 409, 'Version is not editable');
    const r = await renderQuiz(s);
    const trees = () => s.calls.filter((c) => c.path.endsWith('/admin-tree')).length;
    const before = trees();
    byName(cards()[0], 'Edit the answer to question 1')!.click();
    await settle();
    const f = () => cards()[0].querySelector<HTMLInputElement>('input[aria-label="Answer"]')!;
    typeInto(f(), 'new');
    press(f(), 'Enter');
    await settle();
    expect(trees()).toBe(before + 1);
    expect(f().value).toBe('new');
    expect(text(cards()[0].querySelector('.inline-err'))).toBe('Version is not editable');
    // The reloaded tree says archived: controls the state forbids disappear, the open field stays.
    const archived = mkVersion({ state: 'archived' });
    r.props.modal.version = archived;
    r.props.modal.perms = versionPermissions(archived);
    await settle();
    expect(byName(cards()[0], 'Edit question 1')).toBeUndefined();
    expect(f().value).toBe('new');
    press(f(), 'Escape');
    await settle();
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));
  });

  it('a failed write\'s re-fetch is skipped when its question is gone', async () => {
    const s = new QuizServer([q({ id: 1 }), q({ id: 2 })], [opt(11, 1, 'A', true), opt(12, 1, 'B'), opt(21, 2, 'C', true)]);
    const hold = s.hold('PATCH', /\/api\/options\/12$/);
    s.failNext('POST', /\/questions\/reorder$/, 500, 'Nope');
    await renderQuiz(s);
    rows(cards()[0])[1].querySelector<HTMLButtonElement>('button.ans-mark')!.click();
    await settle();
    // Question 1 is deleted elsewhere; a failed move re-syncs the list without it.
    s.questions = s.questions.filter((x) => x.id !== 1);
    byName(cards()[1], 'Move question 2 up')!.click();
    await settle();
    expect(cards().map((c) => c.dataset.qId)).toEqual(['2']);
    const gets = () => s.calls.filter((c) => c.method === 'GET' && c.path === '/api/questions/1/options').length;
    const before = gets();
    hold.fail(404, 'Option not found');
    await settle();
    expect(gets()).toBe(before);
    expect(toastTexts()).toEqual(['Nope', 'Option not found']);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizStructure.svelte.test.ts`
Expected: FAIL. There is no "+ Add question" and no question arrows yet. "a 409 on save keeps the field open …" may already pass on T6 + T3; keep it as the Review Focus 5 pin.

- [ ] **Step 3: Create `frontend/src/components/editor/quiz/NewQuestionModal.svelte`:**

```svelte
<script lang="ts">
  // Level 3: New question (spec §Adding a question). The type picker first —
  // a type change alone is not a change — then the question text with assets,
  // and the Number / Text answer. "Add question" sends ONE create with all
  // fields; on success the quiz body closes this modal and moves focus.
  import { getContext, untrack } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import Button from '../../ui/Button.svelte';
  import MarkdownEditor from '../MarkdownEditor.svelte';
  import QuestionTypePicker from '../QuestionTypePicker.svelte';
  import { ApiError } from '../../../lib/api';
  import { DISCARD_PROMPT, type EditHandle } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import { pushToast } from '../../../stores/toasts.svelte';
  import { validateNumericAnswer, type QuestionCreateBody, type QuestionType } from '../../../lib/quizAuthoring';

  let { onCreate, onClose }: {
    onCreate: (body: QuestionCreateBody) => Promise<void>;   // throws on failure
    onClose: (refocus: boolean) => void;
  } = $props();
  const ctx = getContext<QuizCtx>(QUIZ_CTX);
  const uid = $props.id();
  const labelId = `${uid}-title`;

  let type = $state<QuestionType>('single_choice');
  let text = $state('');
  let numeric = $state('');
  let decimals = $state('0');
  let answer = $state('');
  let saving = $state(false);
  let uploading = $state(false);
  let error = $state<string | null>(null);
  let alive = true;

  const numCheck = $derived(validateNumericAnswer(numeric));
  const numError = $derived(numeric.trim() !== '' && !numCheck.ok ? numCheck.reason : null);
  const decimalsOk = $derived(/^\d{1,2}$/.test(decimals.trim()) && Number(decimals) <= 10);
  const valid = $derived(
    text.trim() !== '' && (
      type === 'numeric_answer' ? numCheck.ok && decimalsOk
        : type === 'text_answer' ? answer.trim() !== '' : true),
  );

  const handle: EditHandle = {
    id: 'new-question',
    // Any field but the type, against its default.
    get dirty() { return text !== '' || numeric !== '' || decimals !== '0' || answer !== ''; },
    get saving() { return saving; },
    close: (refocus) => onClose(refocus),
  };
  $effect(() => {
    untrack(() => ctx.edits.open(handle));
    return () => { alive = false; ctx.edits.release(handle); };
  });

  function requestClose() {
    if (saving) return;
    if (handle.dirty && !window.confirm(DISCARD_PROMPT)) return;
    onClose(true);
  }

  function body(): QuestionCreateBody {
    const base = { text_md: text.trim(), type };
    if (type === 'numeric_answer' && numCheck.ok) {
      return { ...base, correct_numeric: Number(numCheck.canonical), precision: Number(decimals) };
    }
    if (type === 'text_answer') return { ...base, correct_text: answer.trim() };
    return base;   // choice: answers are added on the card
  }

  async function save() {
    if (saving || uploading || !valid) return;
    error = null;
    saving = true;
    try {
      await onCreate(body());
    } catch (e) {
      const m = e instanceof ApiError ? e.displayMessage : 'Add failed';
      if (!alive) { pushToast(m, 'error'); return; }
      saving = false;
      error = m;
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('section.modal-panel')?.getAttribute('aria-labelledby') !== labelId) return;
    e.preventDefault();
    void save();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet head()}
  <h2 id={labelId} class="nq-title">New question</h2>
{/snippet}

{#snippet foot()}
  <span class="nq-gap"></span>
  <Button variant="ghost" disabled={saving} onclick={requestClose}>Cancel</Button>
  <Button variant="primary" loading={saving} disabled={!valid || uploading} onclick={() => void save()}>Add question</Button>
{/snippet}

<Modal
  labelledby={labelId}
  width={760}
  onRequestClose={requestClose}
  closeDisabled={saving}
  autofocusSelector={'input[type="radio"]:checked, header.modal-head button[aria-label="Close"]'}
  header={head}
  footer={foot}
>
  <QuestionTypePicker bind:value={type} disabled={saving} />
  <MarkdownEditor ariaLabel="Question text" assetContext={ctx.assetContext} bind:value={text} bind:uploading frozen={saving} />
  {#if type === 'numeric_answer'}
    <div class="nq-row">
      <label class="nq-field">
        <span class="nq-label">Answer</span>
        <input class="nq-input mono" type="text" aria-label="Answer" maxlength="40" readonly={saving}
               aria-invalid={numError ? 'true' : undefined} bind:value={numeric} />
      </label>
      <label class="nq-field">
        <span class="nq-label">Decimals</span>
        <input class="nq-input nq-dec mono" type="text" inputmode="numeric" aria-label="Decimals" maxlength="2"
               readonly={saving} aria-invalid={decimalsOk ? undefined : 'true'} bind:value={decimals} />
      </label>
    </div>
    {#if numError}<p class="nq-err">{numError}</p>{/if}
    {#if !decimalsOk}<p class="nq-err">Decimals must be a whole number from 0 to 10.</p>{/if}
  {:else if type === 'text_answer'}
    <label class="nq-field">
      <span class="nq-label">Answer</span>
      <input class="nq-input" type="text" aria-label="Answer" maxlength="500" readonly={saving} bind:value={answer} />
    </label>
    <p class="nq-hint">Case-insensitive, trimmed match.</p>
  {/if}
  {#if error}<p class="nq-err" role="alert">{error}</p>{/if}
</Modal>

<style>
  .nq-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .nq-gap { flex: 1; }
  .nq-row { display: flex; flex-wrap: wrap; gap: 12px; }
  .nq-field { display: flex; flex-direction: column; gap: 4px; }
  .nq-label { font-size: 12.5px; color: var(--muted); }
  .nq-input {
    box-sizing: border-box;
    width: 220px;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .nq-dec { width: 64px; }
  .nq-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .nq-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .nq-err { margin: 0; font-size: 12px; color: var(--danger); }
  .nq-hint { margin: 0; font-size: 12px; color: var(--muted); }
</style>
```

- [ ] **Step 4: Replace `frontend/src/components/editor/quiz/QuizBody.svelte`:**

```svelte
<script lang="ts">
  // The quiz body (Slice-5d): a calm overview of compact question cards. Every
  // edit saves itself (D3). One QuizEdits holds the single open edit (D10) and
  // counts requests in flight. ItemBodyApi for ItemEditorModal: save/validate
  // are no-ops (no footer), discard closes the open edit, and `edits` lets the
  // modal's inline title share the slot. Question add / move / delete take the
  // per-quiz lock; a move or delete also holds that question's lock.
  import { onMount, onDestroy, setContext, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Button from '../../ui/Button.svelte';
  import Skeleton from '../../ui/Skeleton.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import NewQuestionModal from './NewQuestionModal.svelte';
  import { ApiError } from '../../../lib/api';
  import { QuizEdits, WAIT_TITLE } from '../../../lib/quizEdits.svelte';
  import { QUIZ_CTX, type QuizCtx } from '../../../lib/quizContext';
  import {
    listQuestions, createQuestion, deleteQuestion, reorderQuestions,
    type AuthoringQuestion, type QuestionCreateBody,
  } from '../../../lib/quizAuthoring';
  import { loadAdminTree } from '../../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../../stores/toasts.svelte';
  import type { SaveOutcome } from '../../../lib/itemBody';
  import type { AdminTreeVersion } from '../../../lib/types';
  import type { VersionPermissions } from '../../../lib/versionPermissions';
  import type { AssetContext } from '../../../lib/assetContext';

  let {
    itemId, vid, version, perms, assetContext, stillOnVid,
    versionDisabled = false,
    guardDirty = $bindable(false), busy = $bindable(false),
  }: {
    itemId: number; vid: number;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    stillOnVid: (savedVid: number) => boolean;
    versionDisabled?: boolean;
    guardDirty?: boolean; busy?: boolean;
  } = $props();

  export const edits = new QuizEdits();
  export async function save(_titleDraft: string | undefined): Promise<SaveOutcome> { return { outcome: 'ok' }; }
  export function validate(): boolean { return true; }
  export function discard(): void { edits.discardAll(); }
  export function discardAll(): void { edits.discardAll(); }

  $effect(() => { guardDirty = edits.dirty; });
  $effect(() => { busy = edits.inFlight; });

  const savedVid = untrack(() => vid);
  let alive = true;
  let loadToken = 0;
  onDestroy(() => { alive = false; loadToken++; });

  let questions = $state<AuthoringQuestion[]>([]);
  let status = $state<'loading' | 'loaded' | 'error'>('loading');
  let quizLock = $state(false);
  let movingId = $state<number | null>(null);
  let adding = $state(false);
  let autoAddId = $state<number | null>(null);
  const busyQuestions = new SvelteSet<number>();
  let rootEl = $state<HTMLElement>();
  let retryWrap = $state<HTMLElement>();

  const sorted = (list: AuthoringQuestion[]) => [...list].sort((a, b) => a.order - b.order);
  const isChoice = (x: AuthoringQuestion) => x.type === 'single_choice' || x.type === 'multiple_choice';

  async function load() {
    const my = ++loadToken;
    status = 'loading';
    try {
      const list = await listQuestions(itemId);
      if (my !== loadToken) return;
      questions = sorted(list);
      status = 'loaded';
    } catch {
      if (my !== loadToken) return;
      status = 'error';
    }
  }
  onMount(() => { void load(); });

  async function retry() {
    await load();
    await tick();
    if (!alive) return;
    if (status === 'error') retryWrap?.querySelector('button')?.focus();
    else void focusFallback(questions[0]?.id ?? null);
  }

  // After a failed structure write: the server's list, without the loading
  // state, so open cards and their edits stay mounted.
  async function resync() {
    const my = ++loadToken;
    try {
      const list = await listQuestions(itemId);
      if (my === loadToken && alive) questions = sorted(list);
    } catch {
      if (my === loadToken && alive) {
        pushToast("Couldn't reload the questions — reload the page to see the latest.", 'error');
      }
    }
  }

  function failed(e: unknown): string {
    if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(savedVid)) {
      void loadAdminTree(savedVid, { force: true });
    }
    return e instanceof ApiError ? e.displayMessage : 'Save failed';
  }

  async function focusFallback(qid: number | null) {
    await tick();
    if (!alive || !rootEl) return;
    const card = qid == null ? null : rootEl.querySelector(`[data-q-id="${qid}"]`);
    const target =
      card?.querySelector<HTMLElement>('.qhead button[data-glyph="pencil"]:not([disabled])')
      ?? rootEl.querySelector<HTMLElement>('.q-add button:not([disabled])')
      ?? rootEl.closest('section.modal-panel')?.querySelector<HTMLElement>('header.modal-head button[aria-label="Close"]');
    target?.focus();
  }

  // ---- Add ----
  const addReason = $derived(
    status !== 'loaded' ? 'Wait for the questions to load'
      : quizLock || edits.locked ? WAIT_TITLE : null,
  );
  function openAdd() {
    if (adding || addReason !== null) return;
    if (!edits.request()) return;
    adding = true;
  }
  async function closeAdd(refocus: boolean) {
    adding = false;
    if (!refocus) return;
    await tick();
    if (alive) void focusFallback(null);
  }
  async function create(body: QuestionCreateBody) {
    quizLock = true;
    try {
      const created = await edits.track(createQuestion(itemId, body));
      if (!alive) return;
      questions = sorted([...questions, created]);
      autoAddId = isChoice(created) ? created.id : null;
      adding = false;                          // close the modal before moving focus
      if (stillOnVid(savedVid)) void loadAdminTree(savedVid, { force: true });   // questions_count
      edits.say('Saved');
      await tick();
      if (!alive) return;
      const card = rootEl?.querySelector<HTMLElement>(`[data-q-id="${created.id}"]`);
      card?.scrollIntoView?.({ block: 'nearest' });
      // A choice card focuses its own "+ Add answer" row once its answers load.
      if (!isChoice(created)) void focusFallback(created.id);
    } catch (e) {
      failed(e);                 // 403/409: the tree reloads
      if (alive) void resync();  // spec: a failed structure write re-fetches the list
      throw e;                   // the modal shows the error inside
    } finally {
      quizLock = false;
    }
  }

  // ---- Move: optimistic; the moved card's arrows keep focus ----
  async function move(qid: number, dir: -1 | 1) {
    if (quizLock || busyQuestions.has(qid)) return;
    const i = questions.findIndex((x) => x.id === qid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= questions.length) return;
    if (!edits.request()) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j]!, next[i]!];
    questions = next.map((x, k) => ({ ...x, order: k + 1 }));
    edits.say(`Question moved to position ${j + 1} of ${next.length}`);
    const order = questions.map((x) => ({ id: x.id, order: x.order }));
    quizLock = true;
    busyQuestions.add(qid);
    movingId = qid;
    const done = edits.track(reorderQuestions(itemId, order));
    await tick();
    const card = rootEl?.querySelector<HTMLElement>(`[data-q-id="${qid}"]`);
    const same = card?.querySelector<HTMLButtonElement>(`.qhead button[data-glyph="${dir < 0 ? 'up' : 'down'}"]`);
    const other = card?.querySelector<HTMLButtonElement>(`.qhead button[data-glyph="${dir < 0 ? 'down' : 'up'}"]`);
    (same && !same.disabled ? same : other)?.focus();
    card?.scrollIntoView?.({ block: 'nearest' });
    try {
      await done;
    } catch (e) {
      pushToast(failed(e), 'error');
      if (alive) await resync();
    } finally {
      busyQuestions.delete(qid);
      if (alive) { quizLock = false; movingId = null; }
    }
  }

  // ---- Delete: confirms (D14) ----
  async function remove(qid: number) {
    if (quizLock || busyQuestions.has(qid)) return;
    const idx = questions.findIndex((x) => x.id === qid);
    if (idx < 0) return;
    if (!edits.request()) return;
    const title = questions[idx]!.text_html.replace(/<[^>]*>/g, '').trim().slice(0, 80) || `Question ${idx + 1}`;
    if (!window.confirm(`Delete question "${title}"? This cannot be undone.`)) return;
    const ids = questions.map((x) => x.id);
    quizLock = true;
    busyQuestions.add(qid);
    try {
      await edits.track(deleteQuestion(qid));
      if (!alive) return;
      questions = questions.filter((x) => x.id !== qid);
      if (stillOnVid(savedVid)) void loadAdminTree(savedVid, { force: true });
      void focusFallback(ids[idx + 1] ?? ids[idx - 1] ?? null);
    } catch (e) {
      pushToast(failed(e), 'error');
      if (alive) await resync();
    } finally {
      busyQuestions.delete(qid);
      if (alive) quizLock = false;
    }
  }

  setContext<QuizCtx>(QUIZ_CTX, {
    edits,
    get itemId() { return itemId; },
    get assetContext() { return assetContext; },
    get canText() { return perms.canEditTextFields; },
    get canStruct() { return perms.canEditStructure; },
    get published() { return version.state === 'published'; },
    get disabled() { return versionDisabled; },
    busyQuestions,
    get quizLock() { return quizLock; },
    live: () => alive && stillOnVid(savedVid),
    say: (message) => edits.say(message),
    failed,
    patch(qid, fields) {
      if (alive) questions = questions.map((x) => (x.id === qid ? { ...x, ...fields } : x));
    },
    hasQuestion: (qid) => questions.some((x) => x.id === qid),
    focusFallback: (qid) => { void focusFallback(qid); },
  });
</script>

<section class="quiz-body" aria-label="Questions" bind:this={rootEl}>
  <div class="quiz-head">
    <span class="quiz-label">Questions</span>
    {#if status === 'loaded'}<span class="mono quiz-count">{questions.length}</span>{/if}
    {#if perms.canEditStructure}
      <!-- 5c D9 exception: in the quiz overview, adding a question is the main action. -->
      <span class="q-add">
        <Button variant="primary" disabled={addReason !== null} title={addReason ?? undefined} onclick={openAdd}>+ Add question</Button>
      </span>
    {/if}
  </div>

  {#if status === 'loading'}
    <Skeleton rows={3} label="Loading questions" />
  {:else if status === 'error'}
    <div class="quiz-error" bind:this={retryWrap}>
      <p>Couldn't load the questions</p>
      <Button variant="secondary" onclick={() => void retry()}>Retry</Button>
    </div>
  {:else if questions.length === 0}
    <p class="quiz-empty">No questions yet.</p>
  {:else}
    <ol class="quiz-list">
      {#each questions as q, i (q.id)}
        <QuestionCard
          {q}
          n={i + 1}
          count={questions.length}
          moving={movingId === q.id}
          autoAdd={autoAddId === q.id}
          onAutoAddDone={() => { autoAddId = null; }}
          onMove={(d) => void move(q.id, d)}
          onDelete={() => void remove(q.id)}
        />
      {/each}
    </ol>
  {/if}

  <p class="sr-only" aria-live="polite" data-testid="quiz-live">{edits.message}</p>

  {#if adding}<NewQuestionModal onCreate={create} onClose={(r) => void closeAdd(r)} />{/if}
</section>

<style>
  .quiz-body { display: flex; flex-direction: column; gap: 12px; }
  .quiz-head { display: flex; align-items: center; gap: 10px; }
  .quiz-label { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .quiz-count { font-size: 11.5px; color: var(--muted); }
  .q-add { margin-left: auto; }
  .quiz-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .quiz-empty { margin: 0; font-size: 13px; color: var(--muted); }
  .quiz-error { display: flex; align-items: center; gap: 10px; }
  .quiz-error p { margin: 0; font-size: 13px; color: var(--muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
```

- [ ] **Step 5: Add the question controls to `QuestionCard.svelte`.**

  1. Replace the props line `let { q, n }: { q: AuthoringQuestion; n: number } = $props();` with:

```ts
  let {
    q, n, count, moving = false, autoAdd = false, onAutoAddDone = () => {}, onMove, onDelete,
  }: {
    q: AuthoringQuestion; n: number; count: number;
    // This card's own move is in flight: its arrows stay enabled (focus never drops).
    moving?: boolean;
    // A just-created choice question opens its "+ Add answer" row once loaded.
    autoAdd?: boolean; onAutoAddDone?: () => void;
    onMove: (dir: -1 | 1) => void; onDelete: () => void;
  } = $props();
```

  2. After `const openReason = …;` add:

```ts
  // Structure: the per-quiz lock, and this question's own lock (its answer writes).
  const structWait = $derived(ctx.quizLock || ctx.busyQuestions.has(q.id) ? WAIT_TITLE : null);
  const upReason = $derived((moving ? null : structWait) ?? (n === 1 ? 'Move up — already first' : null));
  const downReason = $derived((moving ? null : structWait) ?? (n === count ? 'Move down — already last' : null));
```

  3. Inside `<span class="qacts">`, after the `{#if ctx.canText} … {/if}` pencil, add:

```svelte
        {#if ctx.canStruct}
          <IconButton glyph="up" size="sm" borderless title={upReason ?? 'Move up'}
                      aria-label={`Move question ${n} up`} disabled={upReason !== null} onclick={() => onMove(-1)} />
          <IconButton glyph="down" size="sm" borderless title={downReason ?? 'Move down'}
                      aria-label={`Move question ${n} down`} disabled={downReason !== null} onclick={() => onMove(1)} />
          <IconButton glyph="trash" size="sm" borderless danger title={structWait ?? 'Delete question'}
                      aria-label={`Delete question ${n}`} disabled={structWait !== null} onclick={onDelete} />
        {/if}
```

  4. Change `<ChoiceAnswers {q} {n} bind:options />` to `<ChoiceAnswers {q} {n} bind:options {autoAdd} {onAutoAddDone} />`.

- [ ] **Step 6: Let a new choice card open its add row.** In `ChoiceAnswers.svelte`:

  1. Replace the props block with:

```ts
  let { q, n, options = $bindable(null), autoAdd = false, onAutoAddDone = () => {} }: {
    q: AuthoringQuestion; n: number; options?: AuthoringOption[] | null;
    // A just-created question: open "+ Add answer" once loaded (spec §Adding, step 5).
    autoAdd?: boolean; onAutoAddDone?: () => void;
  } = $props();
```

  2. In `load()`, after `status = 'loaded';` add:

```ts
      if (autoAdd) { onAutoAddDone(); openAdd(); }
```

  3. In `load()`'s `catch`, after `status = 'error';` add:

```ts
      if (autoAdd) { onAutoAddDone(); ctx.focusFallback(q.id); }
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/QuizStructure.svelte.test.ts src/tests/QuizOverview.svelte.test.ts src/tests/ChoiceAnswers.svelte.test.ts src/tests/QuizModals.svelte.test.ts src/tests/QuizHeader.svelte.test.ts src/tests/KeyAnswer.svelte.test.ts`
Expected: PASS.

- [ ] **Step 8: Gate rows.** In (ai), inside the `QuizBody` block add:

```zsh
  d '\.q-add' '' 'margin-left:auto'
```

After the `ExplanationModal` block add:

```zsh
own nq-title NewQuestionModal.svelte
uniq1 nq-title
if [[ -n $REPLY ]]; then
  N=NewQuestionModal; H=$REPLY
  d '\.nq-title' '' 'margin:0' 'font-size:15px' 'font-weight:600' 'color:var\(--text\)'
  d '\.nq-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.nq-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  d '\.nq-err' '' 'font-size:12px' 'color:var\(--danger\)'
  none "NewQuestionModal no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep NewQuestionModal $H
fi
```

Run the gate (`cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && zsh scripts/visual-refresh-gate.sh > ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log 2>&1; tail -3 ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log`). Expected: it fails only with `ran N checks, expected <previous count>`, where N − previous equals the number of rows this step added. Set `EXPECTED_CHECKS=N`, re-run, and expect `ALL PASS (N checks)`. Record N in the ledger.

- [ ] **Step 9: Full verification.** vitest, svelte-check and the gate.

- [ ] **Step 10: Screenshots, review, commit.**
  - Screenshots:
    - "+ Add question";
    - the New question modal for each type;
    - a new choice card with its add row open;
    - the card arrows and delete;
    - a narrow window (below 560px) where the actions wrap under the text.
  - Get the user's OK, then run the review lanes until clean.
  - Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/editor/quiz/NewQuestionModal.svelte frontend/src/components/editor/quiz/QuizBody.svelte frontend/src/components/editor/quiz/QuestionCard.svelte frontend/src/components/editor/quiz/ChoiceAnswers.svelte frontend/src/tests/QuizStructure.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(editor): Slice 5d T8 — new question modal, question move/delete, the per-quiz lock, focus fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Close-out — whole-quiz checks, the backlog, the ledger

**Files:**
- Modify: `frontend/scripts/visual-refresh-gate.sh` ((ai): the 5d source rules)
- Create: `docs/backlog/slice5d-quiz-editor-debt.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the final gate count, and the backlog file that collects the review minors from T1–T8.

- [ ] **Step 1: Source rules for the 5d files.** Append to (ai), after `colour_scan 5d-quiz $FILES_5D`:

```zsh
# D13: no "disabled with a reason" for version-forbidden structure — the quiz
# components never read structureReason (the header trash in ItemEditorModal is the exception).
if grep -l 'structureReason' $FILES_5D >/dev/null 2>&1; then
  echo "FAIL  5d quiz components hide what the version forbids (no structureReason) (D13)"; fail=1
else echo "PASS  5d quiz components hide what the version forbids (no structureReason) (D13)"; fi
# The old one-Save machinery is gone (spec §Removed).
if grep -rqE 'QUIZ_SAVE_KEY|QUIZ_GUARD_KEY|QuizSaveHub|quizSave' src; then
  echo "FAIL  the quiz one-Save machinery is gone"; fail=1
else echo "PASS  the quiz one-Save machinery is gone"; fi
# Every 5d discard prompt uses the DirtyGuard text through DISCARD_PROMPT, never a copy.
if grep -l "Discard unsaved changes and continue" $FILES_5D >/dev/null 2>&1; then
  echo "FAIL  5d components use DISCARD_PROMPT, not a copied prompt text"; fail=1
else echo "PASS  5d components use DISCARD_PROMPT, not a copied prompt text"; fi
```

Run the gate (`cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && zsh scripts/visual-refresh-gate.sh > ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log 2>&1; tail -3 ../.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp/gate.log`). Expected: it fails only with `ran N checks, expected <previous count>`, where N − previous equals 3. Set `EXPECTED_CHECKS=N`, re-run, and expect `ALL PASS (N checks)`. Record N in the ledger.

- [ ] **Step 2: The backlog.** Create `docs/backlog/slice5d-quiz-editor-debt.md`:

```markdown
# Slice 5d — quiz editor: deferred minors

Collected from the per-task review lanes (T1–T8). Each line: what, where, why it was deferred.

## Carried to the browser pass (spec §Carried to the browser pass)
- The 5d screens join the 5b/5c Safari pass with the user, together with the 5c
  phone-width item. Check: D8's always-shown answer controls on touch screens,
  and the stacked level-3 backdrop in Safari (the quiz modal's backdrop-filter
  makes it the containing block of the fixed level-3 backdrop).

## Minors
<!-- one bullet per deferred review minor, added task by task -->
```

Add each task's deferred minors as bullets when the task closes; T1–T8 already list them in the ledger.

- [ ] **Step 3: Full verification.**
  - Backend `pytest -q`;
  - frontend vitest (exit 0, no `Errors`/`Unhandled`);
  - svelte-check (0 errors, 13 warnings or fewer);
  - the gate, `ALL PASS`.

- [ ] **Step 4: Review and commit.** Run the review lanes on the diff, then:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/scripts/visual-refresh-gate.sh docs/backlog/slice5d-quiz-editor-debt.md && git commit -m "chore(gate): Slice 5d T9 — quiz source rules, 5d backlog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand off.**
  - Update the ledger and memory, saying 5d is complete.
  - Next comes the whole-branch review (`736bbd4..HEAD`) with fresh Opus and Fable reviewers, plus Codex if the user wants it, followed by the Safari pass with the user.
  - No push, no merge.
