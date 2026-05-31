# Teacher Dashboards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two teacher dashboard surfaces (Progress + Submission) on `RunDetailPage` as the 7th and 8th tabs, consuming the existing Phase 7c backend endpoints. Add ONE new backend endpoint to power the per-item drilldown side panel. Add CSV export for both views. Read-only views — no DB writes, no schema migrations.

**Architecture:** ONE new backend endpoint (`GET /api/runs/{rid}/students/{uid}/sequences/{sid}/items`) for per-item drilldown, plus additive `title` field on the existing `/dashboard/mini-projects` rows. Six new Svelte components: a wire module (`lib/dashboards.ts`), a CSV helper (`lib/csvWrite.ts`), a status badge (`StatusBadge.svelte`), two tab components (`RunProgressTab.svelte`, `RunSubmissionTab.svelte`), and a shared side panel (`DashboardSidePanel.svelte`). A seed script (`seed_teaching_dashboards_smoke.py`) layers test data on top of Slice A's seed for manual smoke.

**Tech Stack:** FastAPI + SQLAlchemy 2.x backend (`backend/.venv`), Svelte 5 + Vitest frontend (`frontend/`), pytest for backend tests.

**Spec:** `docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md` (rev 12, R11 + R12 + codex panel converged, PASS verdict from all reviewers). Every task below cites the spec section it implements; consult the spec for the full rationale on any specific change.

**Working dir conventions:**
- Backend test invocation: `backend/.venv/bin/pytest backend/tests/<file>.py -v`
- Frontend test invocation: `cd frontend && npm test -- <pattern>` (which runs `TZ=Europe/Copenhagen vitest run <pattern>`)
- Frontend type-check: `cd frontend && npm run check`
- Seed script invocation: `backend/.venv/bin/python -m scripts.seed_teaching_dashboards_smoke` (from repo root, with `backend/.venv` activated or via the full path)

**Task ordering rationale:** Backend (T1) first so the wire surface is stable for the frontend. Foundations layer (T2 + T3) — wire module and CSV helper — before consumer components. T4 (StatusBadge) lives in the UI directory and is consumed by T6 (Submission tab); T5 (Progress tab) and T6 (Submission tab) are largely independent and could be parallelized, but T5 first is recommended because it exercises the larger response shape and forces any wire-module gaps to surface earlier. T7 (side panel + RunDetailPage wiring) closes the loop. T8 is seed-script + manual smoke + cleanup.

**Strict per-task review loop** (per user convention): after every task, dispatch reviewer + codex in parallel; fix all Critical/Important findings; re-review until clean before proceeding to the next task.

---

## Task 1: Backend — drilldown endpoint, helpers, schemas, and additive MP title field

**Spec:** §5.1 (new endpoint), §5.2 (additive `title` field), §6.1 (TypeScript interfaces — backend response shape source of truth), §13 backend tests block.

**Files:**
- Modify: `backend/mathion/api/mini_projects.py` — extract `mini_project_title(block)` helper from the inline expression at line 44.
- Modify: `backend/mathion/api/dashboard.py` — add `title` to the per-MP row assembly in `/dashboard/mini-projects`; add the new endpoint `GET /api/runs/{rid}/students/{uid}/sequences/{sid}/items` with its two module-local helpers `_resolve_student_user_in_run` and `_resolve_sequence_in_version`.
- Modify: `backend/mathion/schemas.py` — add `SequenceItemStateResponse`, `SequenceItemState`, `SequenceItemScore`, and the private `_SequenceMeta` / `_StudentMeta` Pydantic models.
- Create: `backend/tests/test_dashboard_item_drilldown.py` — 15 tests per §5.1 / §13.
- Modify: `backend/tests/test_dashboard_mini_projects.py` — add 1 test: `test_mini_projects_dashboard_includes_mp_title`.

**Why this is first:** The new endpoint's wire contract (URL, query params, response shape) is consumed by T2 (`lib/dashboards.ts`'s `getSequenceItemState`). The additive `title` field is consumed by both T2 (interface declaration) and T6 (Submission tab uses it for column headers). Shipping the backend first means the frontend can mock against a verified wire shape.

- [ ] **Step 1: Extract `mini_project_title(block)` helper in `mini_projects.py`**

Open `backend/mathion/api/mini_projects.py`. Find the inline title expression at line 44 (`f"Mini project for Block {block.order}"`). Replace with a helper call:

```python
def mini_project_title(block: "Block") -> str:
    """Centralized MP title format — `Mini project for Block <order>`.

    Used by:
      - The MP creation path (this module) — `block.order` driven title.
      - The dashboard endpoint (`dashboard.py`) — adds `title` to per-MP rows.
    """
    return f"Mini project for Block {block.order}"
```

Place the helper at module scope, just below the imports. Update the existing inline use at line 44 to call `mini_project_title(block)`.

- [ ] **Step 2: Add failing test for `title` field on `/dashboard/mini-projects`**

Open `backend/tests/test_dashboard_mini_projects.py`. Append (use the existing `_publish_run` helper pattern that other tests in the file use):

```python
def test_mini_projects_dashboard_includes_mp_title(client, db):
    """The dashboard response includes the per-MP title (rev-6 addition)."""
    run = _publish_run(db)
    # Existing fixture should create at least one MiniProject; if not, create one here.
    mp = MiniProject(
        run_id=run.id,
        block_id=run.version.blocks[0].id,
        assignment_md="Test",
        assignment_html="<p>Test</p>",
        is_published=True,
    )
    db.add(mp); db.commit()

    response = client.get(f"/api/runs/{run.id}/dashboard/mini-projects")
    assert response.status_code == 200
    body = response.json()
    assert "mini_projects" in body
    assert len(body["mini_projects"]) >= 1

    first_mp = body["mini_projects"][0]
    assert "title" in first_mp, "MP rows must include `title` per spec §5.2"
    block_order = db.get(Block, first_mp["block_id"]).order
    assert first_mp["title"] == f"Mini project for Block {block_order}"
```

Add imports for `MiniProject` and `Block` at the top of the test file if not already present.

- [ ] **Step 3: Run the failing test**

Run: `backend/.venv/bin/pytest backend/tests/test_dashboard_mini_projects.py::test_mini_projects_dashboard_includes_mp_title -v`
Expected: FAIL with `KeyError: 'title'` or `assert "title" in first_mp`.

- [ ] **Step 4: Add `title` to `/dashboard/mini-projects` per-MP row assembly**

Open `backend/mathion/api/dashboard.py`. Find the per-MP row assembly inside the `/dashboard/mini-projects` endpoint (the dict the endpoint builds per `MiniProject` row). Import `mini_project_title` from `mathion.api.mini_projects` at the top of the file. Add a `"title": mini_project_title(block)` key to the dict, where `block` is the already-fetched `Block` ORM row for that MP. The placement is alongside `"id"`, `"block_id"`, `"block_title"`, etc. — same dict literal, same indent.

- [ ] **Step 5: Run the test again and verify it passes**

Run: `backend/.venv/bin/pytest backend/tests/test_dashboard_mini_projects.py::test_mini_projects_dashboard_includes_mp_title -v`
Expected: PASS.

- [ ] **Step 6: Add Pydantic schemas in `schemas.py`**

**Schemas MUST match spec §5.1 lines 225-260 verbatim** — the spec's wire shape is canonical (drives both the FastAPI response_model AND the T2 TypeScript interfaces). Open `backend/mathion/schemas.py`. Add at the bottom of the file (or near the other dashboard schemas if they live in this file):

```python
class SequenceItemScore(BaseModel):
    """Quiz score on a single item — nested object on SequenceItemState."""
    correct: int
    total: int


class SequenceItemState(BaseModel):
    """Per-item state row in the drilldown response."""
    item_id: int
    item_order: int
    item_title: str
    item_type: Literal["static_page", "video", "quiz", "interactive_app"]  # match Item.type enum in models.py / existing schemas.py:97
    is_covered: bool
    last_score: SequenceItemScore | None  # null when not quiz, OR no UIS row, OR row has both score columns None
    last_visited_at: datetime | None       # top-level (UserItemState.last_visited_at, models_auth.py:83)


class _SequenceMeta(BaseModel):
    """Sequence + parent block metadata for the drilldown panel header."""
    sequence_id: int
    sequence_title: str
    block_id: int
    block_title: str


class _StudentMeta(BaseModel):
    """Student metadata for the drilldown panel header."""
    user_id: int
    full_name: str | None
    email: str


class SequenceItemStateResponse(BaseModel):
    """Top-level response for `GET /api/runs/{rid}/students/{uid}/sequences/{sid}/items`."""
    sequence: _SequenceMeta
    student: _StudentMeta
    items: list[SequenceItemState]
```

Add imports if missing: `from datetime import datetime`, `from typing import Literal`, `from pydantic import BaseModel`. Per spec §5.1 Cell conventions (line 307): `last_score` is `null` whenever ANY of (a) item is not quiz, (b) no `UserItemState` row exists, (c) row exists but BOTH `last_score_correct` AND `last_score_total` are `None`.

- [ ] **Step 7: Create `backend/tests/test_dashboard_item_drilldown.py` with fixtures**

```python
"""Tests for the per-item drilldown endpoint (slice 1 of teacher dashboards).

Endpoint: GET /api/runs/{rid}/students/{uid}/sequences/{sid}/items
Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §5.1
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from mathion.models import (
    Block, Course, CourseVersion, Item, Run, RunStudent, Sequence,
)
from mathion.models_auth import User, UserItemState


def _publish_minimal_run(db: Session) -> tuple[Run, Sequence, list[Item], User]:
    """Mirror of the helper in test_dashboard_progress.py — creates a published
    run with one block, one sequence with 3 items (2 quiz + 1 static_page),
    and one enrolled student."""
    course = Course(slug="drilldown-test", name="Drilldown", description="")
    db.add(course); db.commit(); db.refresh(course)

    version = CourseVersion(
        course_id=course.id, state="published", is_disabled=False,
        info_md="", info_html="",
    )
    db.add(version); db.commit(); db.refresh(version)

    block = Block(
        version_id=version.id, title="Block 1", slug="block-1", order=1,
        info_md="", info_html="",
    )
    db.add(block); db.commit(); db.refresh(block)

    seq = Sequence(
        block_id=block.id, title="Seq 1", slug="seq-1", order=1,
    )
    db.add(seq); db.commit(); db.refresh(seq)

    items = [
        Item(sequence_id=seq.id, title="Item 1", slug="item-1", order=1, type="static_page"),
        Item(sequence_id=seq.id, title="Item 2", slug="item-2", order=2, type="quiz"),
        Item(sequence_id=seq.id, title="Item 3", slug="item-3", order=3, type="quiz"),
    ]
    for it in items:
        db.add(it)
    db.commit()
    for it in items:
        db.refresh(it)

    run = Run(
        version_id=version.id, title="Spring 2026",
        start_date="2026-01-01", end_date="2026-12-31",
        groups_enabled=False, is_published=True,
    )
    db.add(run); db.commit(); db.refresh(run)

    student = User(email="s1@test", full_name="Student One")
    db.add(student); db.commit(); db.refresh(student)

    db.add(RunStudent(run_id=run.id, user_id=student.id))
    db.commit()

    return run, seq, items, student
```

- [ ] **Step 8: Write the 15 failing tests per §5.1**

Append to the test file. Each test exercises one row from §5.1's enumerated test list:

```python
# --- AUTH ---

class TestAuth:
    def test_anonymous_returns_401(self, client, db):
        run, seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        assert r.status_code == 401

    def test_admin_returns_200(self, client, db, admin_user, admin_login):
        run, seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        assert r.status_code == 200

    def test_teacher_on_this_run_returns_200(self, client, db, teacher_user, teacher_login):
        run, seq, _items, student = _publish_minimal_run(db)
        # link teacher_user as a RunTeacher on this run — use existing fixture pattern
        # ...
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        assert r.status_code == 200

    def test_teacher_on_other_run_returns_403(self, client, db, teacher_user_on_other_run):
        run, seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        assert r.status_code == 403

    def test_student_returns_403(self, client, db, student_user, student_login):
        run, seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        assert r.status_code == 403


# --- 404s (probe-safe) ---

class TestNotFound:
    def test_unknown_run_returns_404(self, client, db, admin_login):
        run, seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/999999/students/{student.id}/sequences/{seq.id}/items")
        assert r.status_code == 404

    def test_unknown_student_returns_404(self, client, db, admin_login):
        run, seq, _items, _student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/999999/sequences/{seq.id}/items")
        assert r.status_code == 404

    def test_student_not_enrolled_in_run_returns_404(self, client, db, admin_login):
        run, seq, _items, _student = _publish_minimal_run(db)
        other = User(email="other@test", full_name="Other")
        db.add(other); db.commit()
        # other is NOT enrolled in this run
        r = client.get(f"/api/runs/{run.id}/students/{other.id}/sequences/{seq.id}/items")
        assert r.status_code == 404

    def test_unknown_sequence_returns_404(self, client, db, admin_login):
        run, _seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/999999/items")
        assert r.status_code == 404

    def test_sequence_not_in_run_version_returns_404(self, client, db, admin_login):
        """A sequence from a DIFFERENT course version must NOT be drilled into via this run."""
        run, _seq, _items, student = _publish_minimal_run(db)
        # Create a second course/version/sequence
        other_course = Course(slug="other", name="Other", description="")
        db.add(other_course); db.commit(); db.refresh(other_course)
        other_version = CourseVersion(course_id=other_course.id, state="published", is_disabled=False, info_md="", info_html="")
        db.add(other_version); db.commit(); db.refresh(other_version)
        other_block = Block(version_id=other_version.id, title="B", slug="b", order=1, info_md="", info_html="")
        db.add(other_block); db.commit(); db.refresh(other_block)
        other_seq = Sequence(block_id=other_block.id, title="X", slug="x", order=1)
        db.add(other_seq); db.commit(); db.refresh(other_seq)

        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{other_seq.id}/items")
        assert r.status_code == 404


# --- RESPONSE SHAPE ---

class TestResponseShape:
    def test_response_includes_sequence_metadata(self, client, db, admin_login):
        run, seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        body = r.json()
        # _SequenceMeta per spec §5.1: sequence_id, sequence_title, block_id, block_title (NO sequence_order)
        assert body["sequence"]["sequence_id"] == seq.id
        assert body["sequence"]["sequence_title"] == "Seq 1"
        assert body["sequence"]["block_id"] is not None
        assert body["sequence"]["block_title"] == "Block 1"

    def test_response_includes_student_metadata(self, client, db, admin_login):
        run, seq, _items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        body = r.json()
        assert body["student"]["user_id"] == student.id
        assert body["student"]["full_name"] == "Student One"
        assert body["student"]["email"] == "s1@test"

    def test_items_returned_in_order(self, client, db, admin_login):
        run, seq, items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        body = r.json()
        orders = [it["item_order"] for it in body["items"]]
        assert orders == sorted(orders), "items must be returned in `order` ASC"
        assert orders == [1, 2, 3]

    def test_is_covered_defaults_false_with_no_uis_row(self, client, db, admin_login):
        run, seq, _items, student = _publish_minimal_run(db)
        # NO UserItemState rows for any item
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        body = r.json()
        for it in body["items"]:
            assert it["is_covered"] is False, "default when no UIS row"
            assert it["last_score"] is None
            assert it["last_visited_at"] is None

    def test_last_score_is_null_for_static_page_items(self, client, db, admin_login):
        """Spec §5.1 Cell conventions: last_score is null when item is not quiz."""
        run, seq, items, student = _publish_minimal_run(db)
        r = client.get(f"/api/runs/{run.id}/students/{student.id}/sequences/{seq.id}/items")
        body = r.json()
        # items[0] is the static_page item
        static_row = next(it for it in body["items"] if it["item_type"] == "static_page")
        assert static_row["last_score"] is None
```

Total: 15 tests across `TestAuth` (5), `TestNotFound` (5), `TestResponseShape` (5). Use the project's existing fixtures (`client`, `db`, `admin_user`, `admin_login`, `teacher_user`, `teacher_login`, `student_user`, `student_login`) — verify their exact names in `backend/tests/conftest.py` and adjust the test signatures if they differ.

- [ ] **Step 9: Run all 16 tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_dashboard_item_drilldown.py -v`
Expected: 15 FAIL (endpoint not implemented yet). The MP-title test from step 5 should still PASS.

- [ ] **Step 10: Implement the endpoint and its helpers in `dashboard.py`**

Add the two module-local helpers per spec §5.1:

```python
def _resolve_student_user_in_run(
    db: Session, run: Run, user_id: int
) -> tuple[RunStudent, User] | None:
    """Look up the RunStudent + User in one query. Returns None if either
    is missing OR if the user is not enrolled in this run (probe-safe 404)."""
    row = db.execute(
        select(RunStudent, User)
        .join(User, User.id == RunStudent.user_id)
        .where(RunStudent.run_id == run.id, RunStudent.user_id == user_id)
    ).one_or_none()
    if row is None:
        return None
    rs, user = row  # SQLAlchemy 2.x Row unpacks directly
    return rs, user


def _resolve_sequence_in_version(
    db: Session, version_id: int, sequence_id: int
) -> tuple[Sequence, Block] | None:
    """Look up the Sequence + parent Block, ensuring the sequence belongs to
    a block in the given course version. Returns None if not found (probe-safe 404)."""
    row = db.execute(
        select(Sequence, Block)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version_id, Sequence.id == sequence_id)
    ).one_or_none()
    if row is None:
        return None
    seq, block = row
    return seq, block
```

Then the endpoint:

```python
@router.get(
    "/api/runs/{rid}/students/{uid}/sequences/{sid}/items",
    response_model=SequenceItemStateResponse,
)
def get_sequence_item_state(
    rid: int,
    uid: int,
    sid: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_logged_in),
):
    # Auth + run lookup
    run = db.get(Run, rid)
    if run is None:
        raise HTTPException(404, detail="Resource not found")
    require_run_admin_or_teacher(db, current_user, run)

    # Resolve student (probe-safe 404 if not enrolled)
    student_pair = _resolve_student_user_in_run(db, run, uid)
    if student_pair is None:
        raise HTTPException(404, detail="Resource not found")
    _rs, student = student_pair

    # Resolve sequence (probe-safe 404 if sequence doesn't belong to this version)
    seq_pair = _resolve_sequence_in_version(db, run.version_id, sid)
    if seq_pair is None:
        raise HTTPException(404, detail="Resource not found")
    seq, block = seq_pair

    # Items + UIS LEFT JOIN — ordered by item.order ASC
    rows = db.execute(
        select(Item, UserItemState)
        .outerjoin(
            UserItemState,
            (UserItemState.item_id == Item.id) & (UserItemState.user_id == uid),
        )
        .where(Item.sequence_id == seq.id)
        .order_by(Item.order.asc())
    ).all()

    items: list[SequenceItemState] = []
    for row in rows:
        item, uis = row  # Row unpacks directly in SQLA 2.x
        is_covered = bool(uis and uis.is_covered)
        # Spec §5.1 Cell conventions: last_score is null when item is NOT quiz,
        # OR no UIS row exists, OR row exists but both score columns are None.
        last_score: SequenceItemScore | None = None
        if item.type == "quiz" and uis is not None:
            c, t = uis.last_score_correct, uis.last_score_total
            if c is not None and t is not None:
                last_score = SequenceItemScore(correct=c, total=t)
        # last_visited_at is top-level on SequenceItemState (not nested under last_score)
        items.append(SequenceItemState(
            item_id=item.id,
            item_order=item.order,
            item_title=item.title,
            item_type=item.type,
            is_covered=is_covered,
            last_score=last_score,
            last_visited_at=uis.last_visited_at if uis is not None else None,
        ))

    return SequenceItemStateResponse(
        sequence=_SequenceMeta(
            sequence_id=seq.id,
            sequence_title=seq.title,
            block_id=block.id,
            block_title=block.title,
        ),
        student=_StudentMeta(
            user_id=student.id,
            full_name=student.full_name,
            email=student.email,
        ),
        items=items,
    )
```

Add imports as needed: `SequenceItemStateResponse`, `SequenceItemState`, `SequenceItemScore`, `_SequenceMeta`, `_StudentMeta` from `mathion.schemas`; `RunStudent`, `Sequence`, `Block`, `Item`, `Run` from `mathion.models`; `User`, `UserItemState` from `mathion.models_auth`; `require_run_admin_or_teacher` from `mathion.api.helpers`.

- [ ] **Step 11: Run all 16 tests and verify pass**

Run: `backend/.venv/bin/pytest backend/tests/test_dashboard_item_drilldown.py backend/tests/test_dashboard_mini_projects.py::test_mini_projects_dashboard_includes_mp_title -v`
Expected: 16/16 PASS.

- [ ] **Step 12: Run the full dashboard test suite for regression check**

Run: `backend/.venv/bin/pytest backend/tests/test_dashboard_progress.py backend/tests/test_dashboard_mini_projects.py backend/tests/test_dashboard_item_drilldown.py -v`
Expected: All PASS — no existing dashboard test regressed.

- [ ] **Step 13: Commit**

```bash
git add backend/mathion/api/dashboard.py \
        backend/mathion/api/mini_projects.py \
        backend/mathion/schemas.py \
        backend/tests/test_dashboard_item_drilldown.py \
        backend/tests/test_dashboard_mini_projects.py
git commit -m "feat(backend): add drilldown endpoint + mini-project title field (dashboards T1)"
```

---

## Task 2: Frontend foundations — `lib/dashboards.ts` (wire module)

**Spec:** §6.1 (TypeScript interfaces — source of truth), §6.2 (wire-module exports), §13 frontend `dashboards.test.ts` block.

**Files:**
- Create: `frontend/src/lib/dashboards.ts` — wire functions (`getProgressDashboard`, `getMiniProjectsDashboard`, `getSequenceItemState`), shared constants (`STATUS_LABEL`, `STATUS_ICON`, `STATUS_PRIORITY`), and the TypeScript interfaces from §6.1.
- Create: `frontend/src/tests/dashboards.test.ts` — URL/method/signal-threading tests + response-shape conformance tests.

- [ ] **Step 1: Create `lib/dashboards.ts` with interfaces and constants**

Use the §6.1 TypeScript interfaces verbatim. Top of file:

```ts
// frontend/src/lib/dashboards.ts
// Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §6.1, §6.2

import { api } from './api';  // existing project-wide fetch helper

// --- Status enum ---

export type MpGroupStatus =
  | 'not_submitted'
  | 'awaiting_eval'
  | 'needs_revision'
  | 'accepted'
  | 'rejected';

export const STATUS_LABEL: Record<MpGroupStatus, string> = {
  not_submitted: 'Not submitted',
  awaiting_eval: 'Awaiting evaluation',
  needs_revision: 'Needs revision',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const STATUS_ICON: Record<MpGroupStatus, string> = {
  not_submitted: '○',
  awaiting_eval: '…',
  needs_revision: '↻',
  accepted: '✓',
  rejected: '✗',
};

// Teacher-action-priority sort order (asc puts most-attention-needed first).
export const STATUS_PRIORITY: Record<MpGroupStatus, number> = {
  needs_revision: 0,
  rejected: 1,
  awaiting_eval: 2,
  not_submitted: 3,
  accepted: 4,
};
```

Continue with the §6.1 interface declarations. Copy them verbatim from spec §6.1 (the spec is the source of truth):

- `DashboardRun`
- `DashboardSequence`
- `DashboardStudent` (with `group_id: number | null`, `group_name: string | null`, `group_is_disabled: boolean`)
- `DashboardProgressResponse` (with `run`, `sequences[]`, `students[]`)
- `DashboardMpGroupEntry` (with `group_id`, `group_name`, `group_is_disabled`, `status: MpGroupStatus`)
- `DashboardMpRow` (with `id`, `block_id`, `block_title`, `title`, `groups[]`, `counts`)
- `DashboardMiniProjectsResponse`
- `SequenceItemStateResponse`, `SequenceItemState`, `SequenceItemScore`, and the private `_SequenceMeta` / `_StudentMeta` if exposed

- [ ] **Step 2: Add the three wire functions**

```ts
export function getProgressDashboard(
  runId: number,
  opts?: { signal?: AbortSignal },
): Promise<DashboardProgressResponse> {
  return api.get(`/api/runs/${runId}/dashboard/progress`, { signal: opts?.signal });
}

export function getMiniProjectsDashboard(
  runId: number,
  opts?: { signal?: AbortSignal },
): Promise<DashboardMiniProjectsResponse> {
  return api.get(`/api/runs/${runId}/dashboard/mini-projects`, { signal: opts?.signal });
}

export function getSequenceItemState(
  runId: number,
  userId: number,
  sequenceId: number,
  opts?: { signal?: AbortSignal },
): Promise<SequenceItemStateResponse> {
  return api.get(
    `/api/runs/${runId}/students/${userId}/sequences/${sequenceId}/items`,
    { signal: opts?.signal },
  );
}
```

Verify the `api.get` signature in `frontend/src/lib/api.ts` and adjust the `{ signal }` threading if the project's helper uses a different shape (e.g., `fetch`-style `{ init: { signal } }`).

- [ ] **Step 3: Create `frontend/src/tests/dashboards.test.ts` with mockFetch scaffolding**

Use the established project pattern from `frontend/src/tests/runGroups.test.ts:10-19`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  getProgressDashboard,
  getMiniProjectsDashboard,
  getSequenceItemState,
  STATUS_LABEL,
  STATUS_PRIORITY,
} from '../lib/dashboards';

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ));
}

beforeEach(() => {
  vi.restoreAllMocks();
});
```

- [ ] **Step 4: Add URL + signal-threading tests (one per endpoint)**

```ts
describe('wire URL + signal threading', () => {
  it('getProgressDashboard fetches the correct URL with signal', async () => {
    const f = mockFetch(200, { run: {}, sequences: [], students: [] });
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await getProgressDashboard(42, { signal: ctrl.signal });
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/42/dashboard/progress'),
      expect.objectContaining({ signal: ctrl.signal }),
    );
  });

  it('getMiniProjectsDashboard fetches the correct URL with signal', async () => {
    const f = mockFetch(200, { run: {}, mini_projects: [] });
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await getMiniProjectsDashboard(7, { signal: ctrl.signal });
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/7/dashboard/mini-projects'),
      expect.objectContaining({ signal: ctrl.signal }),
    );
  });

  it('getSequenceItemState fetches the correct URL with signal', async () => {
    const f = mockFetch(200, { sequence: {}, student: {}, items: [] });
    vi.stubGlobal('fetch', f);
    const ctrl = new AbortController();
    await getSequenceItemState(3, 14, 99, { signal: ctrl.signal });
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining('/api/runs/3/students/14/sequences/99/items'),
      expect.objectContaining({ signal: ctrl.signal }),
    );
  });
});
```

- [ ] **Step 5: Add response-shape conformance tests (one per endpoint)**

Per spec §13: mock the literal-shaped JSON body, then runtime-assert that the consumer extracts all expected keys with the expected types. This protects against backend renames that TypeScript's compile-time check can't catch.

```ts
describe('response-shape conformance', () => {
  it('getProgressDashboard extracts run/sequences/students keys', async () => {
    const mockBody = {
      run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: false },
      sequences: [{ sequence_id: 10, sequence_title: 'S', sequence_order: 1, block_id: 5, block_title: 'B' }],
      students: [{
        user_id: 100, full_name: 'A', email: 'a@x', user_is_disabled: false,
        group_id: 1, group_name: 'G1', group_is_disabled: false,
        coverage: [{ covered: 2, total: 4 }], quiz: [{ correct: 1, total: 2 }],
      }],
    };
    vi.stubGlobal('fetch', mockFetch(200, mockBody));
    const res = await getProgressDashboard(1);
    expect(res.run.groups_enabled).toBe(true);
    expect(res.sequences[0].sequence_id).toBe(10);
    expect(res.students[0].user_id).toBe(100);
    expect(res.students[0].coverage[0].covered).toBe(2);
  });

  it('getMiniProjectsDashboard extracts run/mini_projects keys including title', async () => {
    const mockBody = {
      run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: false },
      mini_projects: [{
        id: 1, block_id: 5, block_title: 'B', title: 'Mini project for Block 1',
        groups: [{ group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'not_submitted' }],
        counts: { groups: 1, awaiting_eval: 0, needs_revision: 0, rejected: 0 },
      }],
    };
    vi.stubGlobal('fetch', mockFetch(200, mockBody));
    const res = await getMiniProjectsDashboard(1);
    expect(res.mini_projects[0].title).toBe('Mini project for Block 1');
    expect(res.mini_projects[0].groups[0].status).toBe('not_submitted');
  });

  it('getSequenceItemState extracts sequence/student/items', async () => {
    const mockBody = {
      sequence: { sequence_id: 10, sequence_title: 'S', sequence_order: 1, block_id: 5, block_title: 'B' },
      student: { user_id: 100, full_name: 'A', email: 'a@x' },
      items: [
        { item_id: 1, item_order: 1, item_title: 'I1', item_type: 'static_page', is_covered: true, quiz: null },
        { item_id: 2, item_order: 2, item_title: 'I2', item_type: 'quiz', is_covered: true,
          quiz: { last_score_correct: 3, last_score_total: 5, last_visited_at: '2026-05-31T12:00:00Z' } },
      ],
    };
    vi.stubGlobal('fetch', mockFetch(200, mockBody));
    const res = await getSequenceItemState(1, 100, 10);
    expect(res.items[1].quiz?.last_score_correct).toBe(3);
    expect(res.items[0].quiz).toBeNull();
  });
});
```

- [ ] **Step 6: Add a small constants-export test**

```ts
describe('exported constants', () => {
  it('STATUS_LABEL covers all 5 status enum values', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(
      ['accepted', 'awaiting_eval', 'needs_revision', 'not_submitted', 'rejected'],
    );
  });

  it('STATUS_PRIORITY puts needs_revision first', () => {
    expect(STATUS_PRIORITY.needs_revision).toBeLessThan(STATUS_PRIORITY.accepted);
    expect(STATUS_PRIORITY.needs_revision).toBeLessThan(STATUS_PRIORITY.not_submitted);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `cd frontend && npm test -- src/tests/dashboards.test.ts`
Expected: All PASS (8 tests).

- [ ] **Step 8: Type-check**

Run: `cd frontend && npm run check`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/dashboards.ts frontend/src/tests/dashboards.test.ts
git commit -m "feat(frontend): add lib/dashboards.ts wire module + tests (dashboards T2)"
```

---

## Task 3: Frontend foundations — `lib/csvWrite.ts` (CSV export helper)

**Spec:** §6.7 (`toCSV`, `downloadCSV`, `sanitizeTitle` contracts + algorithm), §13 `csvWrite.test.ts` block.

**Files:**
- Create: `frontend/src/lib/csvWrite.ts`
- Create: `frontend/src/tests/csvWrite.test.ts`

- [ ] **Step 1: Create `lib/csvWrite.ts` with interface declarations and `sanitizeTitle`**

```ts
// frontend/src/lib/csvWrite.ts
// Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §6.7

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
}
// Booleans are serialized as the literal strings "true" / "false" before the
// formula-injection guard + RFC 4180 quoting pass. Used by Submission CSV
// columns like `is_late`, `is_resubmission`, `has_feedback_file`.

export interface CsvOptions {
  /** Prepend UTF-8 BOM for Excel compatibility. Default: true. */
  bom?: boolean;
  /** Line ending. Default: '\r\n' (RFC 4180). */
  newline?: '\n' | '\r\n';
}

export function sanitizeTitle(title: string, fallback: string): string {
  let s = title.replace(/[^A-Za-z0-9 \-_]/g, '_').replace(/\s+/g, '_').slice(0, 60);
  s = s.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
  return s || fallback;
}
```

- [ ] **Step 2: Add `toCSV` per the §6.7 algorithm**

```ts
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const RFC_TRIGGER = /[",\r\n]/;

function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  // Step 1: formula-injection guard — prepend apostrophe if value starts
  // with a trigger char.
  const guarded = FORMULA_TRIGGER.test(s) ? "'" + s : s;
  // Step 2: RFC 4180 quoting — quote if EITHER the apostrophe was prepended
  // (guarded values are ALWAYS quoted, matching the §13 test assertion) OR
  // the value contains comma / double-quote / CR / LF.
  const needsQuotes = guarded !== s || RFC_TRIGGER.test(guarded);
  if (!needsQuotes) return guarded;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

export function toCSV<Row>(
  rows: Row[],
  columns: CsvColumn<Row>[],
  opts: CsvOptions = {},
): string {
  const newline = opts.newline ?? '\r\n';
  const bom = opts.bom ?? true;
  const headerLine = columns.map((c) => escapeCell(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCell(c.value(row))).join(','),
  );
  const body = [headerLine, ...dataLines].join(newline);
  return bom ? '﻿' + body : body;
}
```

- [ ] **Step 3: Add `downloadCSV`**

```ts
export function downloadCSV(csvText: string, filename: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Create `frontend/src/tests/csvWrite.test.ts` — full §6.7 test list**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toCSV, downloadCSV, sanitizeTitle, type CsvColumn } from '../lib/csvWrite';

interface Row { name: string; n?: number; flag?: boolean }

const NAME_COL: CsvColumn<Row> = { header: 'name', value: (r) => r.name };
const N_COL: CsvColumn<Row> = { header: 'n', value: (r) => r.n };
const FLAG_COL: CsvColumn<Row> = { header: 'flag', value: (r) => r.flag };

describe('toCSV', () => {
  it('plain alphanumeric values → no quotes, no prefix', () => {
    const out = toCSV([{ name: 'alice' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\nalice');
  });

  it('embedded comma → quoted', () => {
    const out = toCSV([{ name: 'a,b' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\n"a,b"');
  });

  it('embedded double quote → quoted + doubled internal quotes', () => {
    const out = toCSV([{ name: 'a"b' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\n"a""b"');
  });

  it('embedded CR/LF → quoted', () => {
    const out = toCSV([{ name: 'a\nb' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\n"a\nb"');
  });

  it('leading = → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '=SUM(1)' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'=SUM(1)\"");
  });

  it('leading + → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '+1' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'+1\"");
  });

  it('leading - → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '-1' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'-1\"");
  });

  it('leading @ → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '@foo' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'@foo\"");
  });

  it('leading \\t → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '\tfoo' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'\tfoo\"");
  });

  it('leading \\r → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '\rfoo' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'\rfoo\"");
  });

  it('null/undefined → empty string', () => {
    const out = toCSV([{ name: 'x', n: undefined }], [NAME_COL, N_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name,n\nx,');
  });

  it('BOM prefix on by default', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { newline: '\n' });
    expect(out.charCodeAt(0)).toBe(0xFEFF);
  });

  it('BOM prefix off when bom: false', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out.charCodeAt(0)).not.toBe(0xFEFF);
  });

  it('newline default is \\r\\n', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { bom: false });
    expect(out).toBe('name\r\nx');
  });

  it('newline configurable via newline: \\n', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\nx');
  });

  it('Number serialization', () => {
    const out = toCSV([{ name: 'x', n: 42 }], [NAME_COL, N_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name,n\nx,42');
  });

  it('Boolean serialization → unquoted literal true / false (no trigger chars)', () => {
    const out = toCSV(
      [{ name: 'x', flag: true }, { name: 'y', flag: false }],
      [NAME_COL, FLAG_COL],
      { bom: false, newline: '\n' },
    );
    expect(out).toBe('name,flag\nx,true\ny,false');
  });

  it('Header row first', () => {
    const out = toCSV([{ name: 'b' }, { name: 'a' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out.split('\n')[0]).toBe('name');
  });
});

describe('downloadCSV', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Blob with text/csv;charset=utf-8 and triggers an <a download> click', () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    let capturedHref = '';
    let capturedDownload = '';
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag) as HTMLAnchorElement;
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: vi.fn() });
        Object.defineProperty(el, 'href', {
          set(v: string) { capturedHref = v; },
          get() { return capturedHref; },
        });
        Object.defineProperty(el, 'download', {
          set(v: string) { capturedDownload = v; },
          get() { return capturedDownload; },
        });
      }
      return el;
    });

    downloadCSV('a,b\n1,2', 'test.csv');

    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/csv;charset=utf-8' }),
    );
    expect(capturedDownload).toBe('test.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});

describe('sanitizeTitle', () => {
  it('keeps alphanumeric + space + dash + underscore', () => {
    expect(sanitizeTitle('Spring 2026', 'fallback')).toBe('Spring_2026');
  });

  it('replaces special chars with underscore', () => {
    expect(sanitizeTitle('a/b', 'fallback')).toBe('a_b');
  });

  it('all-stripped input falls back', () => {
    expect(sanitizeTitle('русский', 'run-7')).toBe('run-7');
    expect(sanitizeTitle('日本語', 'run-7')).toBe('run-7');
  });

  it('truncates to 60 chars and trims', () => {
    expect(sanitizeTitle('x'.repeat(120), 'fb').length).toBeLessThanOrEqual(60);
  });

  it('collapses underscore runs and trims edges', () => {
    expect(sanitizeTitle('___a___b___', 'fb')).toBe('a_b');
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd frontend && npm test -- src/tests/csvWrite.test.ts`
Expected: All PASS.

- [ ] **Step 6: Type-check**

Run: `cd frontend && npm run check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/csvWrite.ts frontend/src/tests/csvWrite.test.ts
git commit -m "feat(frontend): add lib/csvWrite.ts CSV export helper (dashboards T3)"
```

---

## Task 4: Frontend — `StatusBadge.svelte` + CSS variables

**Spec:** §6.6 (StatusBadge component), §6.4 status-color table (Tailwind 100/700-800 pairs, ≥4.5:1 contrast), §13 `StatusBadge.svelte.test.ts` block.

**Files:**
- Create: `frontend/src/components/ui/StatusBadge.svelte`
- Create: `frontend/src/tests/StatusBadge.svelte.test.ts`
- Modify: `frontend/src/styles/base.css` — add 10 new `--status-*-bg` / `--status-*-fg` CSS custom properties (verbatim from §6.4 enumeration) + `--surface-muted` token if not present.

- [ ] **Step 1: Add CSS variables to `styles/base.css`**

Open `frontend/src/styles/base.css`. In the `:root` block, add:

```css
:root {
  /* ... existing tokens ... */

  /* Surface fallback for heatmap cells with no ratio (Progress tab). */
  --surface-muted: #f3f4f6;

  /* Status colors — variable names mirror status enum (underscores → dashes).
     All pairs ≥ 4.5:1 contrast (verified per WCAG AA). */
  --status-not-submitted-bg: #f3f4f6;  --status-not-submitted-fg: #374151;
  --status-awaiting-eval-bg: #dbeafe;  --status-awaiting-eval-fg: #1e40af;
  --status-needs-revision-bg: #fef3c7; --status-needs-revision-fg: #92400e;
  --status-accepted-bg:      #d1fae5;  --status-accepted-fg:      #065f46;
  --status-rejected-bg:      #fee2e2;  --status-rejected-fg:      #991b1b;
}
```

If `--surface-muted` already exists, do not duplicate it.

- [ ] **Step 2: Create `StatusBadge.svelte`**

Per spec §6.6:

```svelte
<!-- frontend/src/components/ui/StatusBadge.svelte -->
<script lang="ts">
  import { STATUS_LABEL, STATUS_ICON, type MpGroupStatus } from '../../lib/dashboards';

  let { status }: { status: MpGroupStatus } = $props();

  // Map status enum to CSS variable name (underscores → dashes).
  const cssKey = $derived(status.replace(/_/g, '-'));
</script>

<span
  class="status-badge"
  style:--badge-bg={`var(--status-${cssKey}-bg)`}
  style:--badge-fg={`var(--status-${cssKey}-fg)`}
>
  <span class="status-icon" aria-hidden="true">{STATUS_ICON[status]}</span>
  <span class="status-label">{STATUS_LABEL[status]}</span>
</span>

<style>
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.2em 0.6em;
    border-radius: 999px;
    font-size: 0.85em;
    line-height: 1.2;
    background-color: var(--badge-bg);
    color: var(--badge-fg);
  }
  .status-icon {
    font-weight: 700;
  }
</style>
```

- [ ] **Step 3: Create `frontend/src/tests/StatusBadge.svelte.test.ts`**

Use the project's `mount`/`unmount`/`flushSync` pattern from `svelte` (NOT `@testing-library/svelte` per `feedback_svelte_test_pattern.md`):

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

import StatusBadge from '../components/ui/StatusBadge.svelte';
import { STATUS_LABEL, STATUS_ICON, type MpGroupStatus } from '../lib/dashboards';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function mountBadge(status: MpGroupStatus) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(StatusBadge, { target: host, props: { status } });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

const ALL_STATUSES: MpGroupStatus[] = [
  'not_submitted', 'awaiting_eval', 'needs_revision', 'accepted', 'rejected',
];

describe('StatusBadge', () => {
  for (const status of ALL_STATUSES) {
    it(`renders label "${STATUS_LABEL[status]}" + icon "${STATUS_ICON[status]}" for ${status}`, () => {
      mountBadge(status);
      const badge = host.querySelector('.status-badge') as HTMLElement;
      expect(badge.textContent?.trim()).toContain(STATUS_LABEL[status]);
      expect(badge.textContent?.trim()).toContain(STATUS_ICON[status]);
      const inlineStyle = badge.getAttribute('style') ?? '';
      const cssKey = status.replace(/_/g, '-');
      expect(inlineStyle).toContain(`--badge-bg: var(--status-${cssKey}-bg)`);
      expect(inlineStyle).toContain(`--badge-fg: var(--status-${cssKey}-fg)`);
    });
  }
});
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm test -- src/tests/StatusBadge.svelte.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Type-check**

Run: `cd frontend && npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/StatusBadge.svelte \
        frontend/src/tests/StatusBadge.svelte.test.ts \
        frontend/src/styles/base.css
git commit -m "feat(frontend): add StatusBadge component + status CSS variables (dashboards T4)"
```

---

## Task 5: Frontend — `RunProgressTab.svelte` + tests

**Spec:** §6.3 (full layout snippet, derived rows, effect/refresh contracts, CSV export format, helper-list at line ~892). §13 `RunProgressTab.svelte.test.ts` block (~22 tests).

**Files:**
- Create: `frontend/src/components/runs/RunProgressTab.svelte`
- Create: `frontend/src/tests/RunProgressTab.svelte.test.ts`

- [ ] **Step 1: Scaffold `RunProgressTab.svelte` per the §6.3 state + effects contract**

Open the spec at §6.3 and use it as the source of truth for the component body. The component must implement:

1. **Props** — `runId: number` per `$props()`.
2. **State** — `data: $state<DashboardProgressResponse | null>(null)`, `loading: $state(true)`, `error: $state<string | null>(null)`, `mode: $state<'coverage' | 'quiz'>('coverage')`, `sortKey` and `sortDir` (`SortKey = 'name' | 'group' | \`seq:${number}\``), `groupFilter: $state<number | 'all' | 'ungrouped'>('all')`, `nameQuery: $state('')`, `panelOpen: $state(false)`, `panelTarget: $state<{user_id: number; sequence_id: number} | null>(null)`, plus a module-scope `let abortCtl: AbortController | null = null` (NOT `$state`).
3. **runId-tracking `$effect`** — body shape per spec §6.3 lines ~654-676: snapshot `const ctl = new AbortController()`, assign to `abortCtl`, reset filter/panel state (`groupFilter = 'all'; nameQuery = ''; panelOpen = false; panelTarget = null;`), set `loading = true; error = null`, call `getProgressDashboard(runId, { signal: ctl.signal })`, in `.then` set `data` and `loading=false`, in `.catch` ignore `AbortError` else set `error`, and `return () => ctl.abort()` for cleanup. **Important**: leading `abortCtl?.abort()` BEFORE the `ctl` creation (covers refresh-then-runId-change leak path).
4. **Unmount-only `$effect`** — `$effect(() => () => abortCtl?.abort());` per spec §6.3 lines ~702-706 (rev 11 fix #2).
5. **`refresh()` function** — same shape as the `$effect` body but does NOT reset filter/panel state. Per spec lines ~679-694.
6. **`$derived` rows** — `visibleStudents`: filter by group/ungrouped/search, then sort via `compareStudents(a, b, sortKey, sortDir, mode)`. `compareStudents` handles `'name'` (localeCompare on `full_name ?? email`), `'group'` (localeCompare on `group_name ?? ''`), and `'seq:<id>'` (ratio-compare with null-sink — see spec §6.3 lines ~743-761).
7. **`$derived` helpers**:
   - `uniqueGroups` per spec §6.3 lines ~896-911 (Map-dedupe over `data?.students`, skip null `group_id`, sort by `group_id` asc, fields `{group_id, group_name: s.group_name ?? '', group_is_disabled: s.group_is_disabled ?? false}`).
   - `hasUngroupedStudents`: `$derived(data?.students.some(s => s.group_id == null) ?? false)`.
   - `blockGroupedSequences` — group sequences by `block_id` for the colgroup `<th>` rendering.
8. **Helpers** (local): `cellInlineStyle(s, i, mode)` (sets `--cell-bg` via `hsl(<hue> 70% 80%)` where `hue = 120 * ratio`), `cellAriaLabel(s, seq, i, mode)`, `cellText(s, i, mode)`, `toggleSort(key)`, `openPanel(user_id, sequence_id)`, `closePanel()`, `handleDownloadCSV()` (build rows from `visibleStudents`, call imported `downloadCSV(toCSV(rows, columns), filename)`).
9. **Imports**:
   - `dashboards.ts`: `getProgressDashboard`, `getSequenceItemState`, `STATUS_LABEL`, `STATUS_ICON`, `STATUS_PRIORITY` (the `STATUS_*` are unused on this tab but kept for symmetry — remove if linter complains).
   - `csvWrite.ts`: `toCSV`, `downloadCSV`, `sanitizeTitle`.
   - Local: `DashboardSidePanel` (will be created in T7 — for now, use a placeholder `<div class="panel-placeholder">{JSON.stringify(panelTarget)}</div>` that T7 replaces).

Use the spec §6.3 layout snippet (lines ~766-872) verbatim for the markup — outer shell with three independent `{#if}` blocks (loading / error / data), version-disabled warning banner, mode toggle fieldset, group-filter `<select>` with `{#if hasUngroupedStudents}<option value="ungrouped">(Ungrouped)</option>{/if}`, name-search input, Refresh + Download CSV buttons, the `<table class="progress-grid">` with block-row + seq-row headers + tbody rows + empty-state row.

- [ ] **Step 2: Add CSS for the heatmap grid**

Add a `<style>` block (or import a shared module CSS) implementing:
- `.cell { background-color: var(--cell-bg, var(--surface-muted, #f3f4f6)); color: var(--text, #1f2937); }`
- `.cell-btn` — unstyled button (no native chrome) so cells look like cells, not buttons.
- `.empty-cell { color: var(--text-muted, #6b7280); }`
- `.sticky-name`, `.sticky-group`, `.seq-header`, `.block-header` — sticky positioning per spec §6.3.
- `.disabled-row { opacity: 0.55; font-style: italic; }`
- `.badge-muted` — small muted "disabled" inline badge.
- `.banner-warning` — yellow disabled-version banner.
- `.banner-error` — red error banner.

The exact CSS isn't critical (visual polish lives in §6.3 line 884 contrast notes); the assertion targets are tested via classes, not pixel values.

- [ ] **Step 3: Create `frontend/src/tests/RunProgressTab.svelte.test.ts` — mount helper + 6 representative tests**

```ts
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

import RunProgressTab from '../components/runs/RunProgressTab.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ));
}

function mountTab(runId = 1, extraProps: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(RunProgressTab, { target: host, props: { runId, ...extraProps } });
  flushSync();
  return host;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

function progressMock(overrides: Record<string, unknown> = {}) {
  return {
    run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: false },
    sequences: [
      { sequence_id: 10, sequence_title: 'S1', sequence_order: 1, block_id: 5, block_title: 'B1' },
    ],
    students: [
      { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
        group_id: 1, group_name: 'G1', group_is_disabled: false,
        coverage: [{ covered: 2, total: 4 }], quiz: [{ correct: 1, total: 2 }] },
      { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
        group_id: null, group_name: null, group_is_disabled: false,
        coverage: [{ covered: 4, total: 4 }], quiz: [{ correct: 2, total: 2 }] },
    ],
    ...overrides,
  };
}

describe('RunProgressTab', () => {
  it('renders LoadingPlaceholder before fetch resolves', () => {
    let resolve!: (v: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    mountTab();
    expect(host.querySelector('.loading, [aria-busy="true"]')).toBeTruthy();
    resolve(new Response(JSON.stringify(progressMock()), { status: 200 }));
  });

  it('renders heatmap rows when data loads (coverage mode default)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await tick();
    await tick();
    flushSync();
    const cells = host.querySelectorAll('td.cell, td.cell .cell-btn');
    expect(cells.length).toBeGreaterThan(0);
    // Coverage mode: "2/4" should appear for Alice's cell
    expect(host.textContent).toContain('2/4');
  });

  it('renders error banner with Retry on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
    mountTab();
    await tick();
    await tick();
    flushSync();
    expect(host.querySelector('.banner-error, [role="alert"]')).toBeTruthy();
    expect(host.textContent?.toLowerCase()).toContain('retry');
  });

  it('filter by group dropdown narrows visible rows', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await tick(); await tick(); flushSync();
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    select.value = String(1);  // Group 1
    select.dispatchEvent(new Event('change'));
    flushSync();
    const rows = host.querySelectorAll('tbody tr:not(.empty-row)');
    // Only Alice is in group 1; Bob is ungrouped.
    expect(rows.length).toBe(1);
    expect(host.textContent).toContain('Alice');
    expect(host.textContent).not.toContain('Bob');
  });

  it('(Ungrouped) option is absent when no students have group_id null', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ covered: 1, total: 1 }], quiz: [{ correct: 0, total: 0 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await tick(); await tick(); flushSync();
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).not.toContain('ungrouped');
  });

  it('(Ungrouped) option is present when at least one student has group_id null', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));  // default mock has Bob ungrouped
    mountTab();
    await tick(); await tick(); flushSync();
    const select = host.querySelector('select[aria-label="Filter by group"]') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('ungrouped');
  });
});
```

- [ ] **Step 4: Add the remaining ~16 tests from §13 RunProgressTab list**

Per spec §13 lines ~1614-1648 (in rev 11 numbering — line numbers may have shifted in rev 12). Each test follows the same `mountTab` + mock + `tick/flushSync` + assert pattern. Tests to add:

- Empty-students state renders placeholder text.
- Empty-sequences state renders placeholder text.
- Quiz mode: cells render `{correct}/{total}` text; null quiz cells render `—`.
- Mode toggle: switching mode updates rendered cells.
- Search by name: input narrows rows on each keystroke (matches `full_name` AND `email`).
- Sort by name: click "Student" header → toggle direction; `aria-sort` updates.
- Sort by group: click "Group" header.
- Sort by sequence column: click → rows reorder; null cells sink to bottom regardless of direction.
- Sort persistence across mode toggle: sort key preserved; values update.
- Cell click: opens side panel with progress `target` shape (mock `getSequenceItemState`).
- Disabled user: row has "disabled" badge; text content correct.
- Disabled version: warning banner renders at top.
- Sticky first column CSS classes applied.
- Refresh button: click triggers refetch.
- Stale-while-revalidate: with prior `data` populated, click Refresh — table stays rendered (rows still visible) while loading placeholder appears; `data` is NOT reset to `null` during refresh.
- Retry-after-error: with error banner showing, click Retry — `error` clears, `loading` flips to `true`, and on mocked-success rerender the table populates from null→rows.
- CSV download: blob+filename via mocked `URL.createObjectURL`. Sanitized filename verified for run titles containing `/`, spaces, accents.
- AbortController: rapid `runId` change cancels the in-flight fetch (assert `signal.aborted` on the first fetch's options object).
- RunId-change resets local state: mount with `runId=A`; after data loads, set `groupFilter`, type into search, click a cell to open panel. Swap to `runId=B`. Assert: `groupFilter === 'all'`, `nameQuery === ''`, `panelOpen === false`, `panelTarget === null`.
- Unmount-after-`refresh()` aborts the refresh-created controller: mount; await initial load; click Refresh (do NOT await — keep the new fetch in-flight); capture the latest `abortCtl` via the mocked fetch's options-object capture; unmount; assert `signal.aborted === true`.

For each, write a tight test body using the established `mountTab` + `mockFetch` + `tick/flushSync` patterns. Reference `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts:44-68` and `frontend/src/tests/RunAssetsTab.svelte.test.ts:1099-1128` (for the capture-signal-via-mock-options pattern).

- [ ] **Step 5: Run all RunProgressTab tests**

Run: `cd frontend && npm test -- src/tests/RunProgressTab.svelte.test.ts`
Expected: All ~22 tests PASS.

- [ ] **Step 6: Type-check + full vitest sweep for regressions**

Run: `cd frontend && npm run check && npm test`
Expected: 0 TS errors; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/runs/RunProgressTab.svelte \
        frontend/src/tests/RunProgressTab.svelte.test.ts
git commit -m "feat(frontend): add RunProgressTab heatmap + tests (dashboards T5)"
```

---

## Task 6: Frontend — `RunSubmissionTab.svelte` + tests

**Spec:** §6.4 (full layout snippet, derived rows, effect/refresh contracts, CSV long format, helper-list at line ~1230). §13 `RunSubmissionTab.svelte.test.ts` block (~16 tests).

**Files:**
- Create: `frontend/src/components/runs/RunSubmissionTab.svelte`
- Create: `frontend/src/tests/RunSubmissionTab.svelte.test.ts`

- [ ] **Step 1: Scaffold `RunSubmissionTab.svelte` per the §6.4 state + effects contract**

The component is structurally parallel to `RunProgressTab` (T5) — share patterns, differ in details:

1. **Props** — `runId: number`.
2. **State** — `data: $state<DashboardMiniProjectsResponse | null>(null)`, `loading`, `error`, `sortKey: SortKey = 'group' | \`mp:${number}\``, `sortDir`, `groupFilter: number | 'all'`, `panelOpen`, `panelTarget: $state<{mp: DashboardMpRow; entry: DashboardMpGroupEntry} | null>(null)`. Module-scope `let abortCtl: AbortController | null = null`.
3. **runId-tracking `$effect`** — per spec §6.4 lines ~1043-1063: snapshot `ctl`, leading `abortCtl?.abort()`, reset block (omits `nameQuery` — Submission has no name search), call `getMiniProjectsDashboard`.
4. **Unmount-only `$effect`** — `$effect(() => () => abortCtl?.abort());` per spec §6.4 lines ~1067-1071 (rev 12 fix #3).
5. **`refresh()`** — same shape as T5's, calling `getMiniProjectsDashboard`.
6. **`$derived uniqueGroups`** per spec §6.4 lines ~1112-1126 (Map-dedupe over `data?.mini_projects[i].groups[]`, sort by `group_id` asc). **No `hasUngroupedStudents` analog** — groupless students don't surface as MP-status rows.
7. **`$derived visibleGroups`** — sort by `compareGroups(a, b)` per `sortKey`/`sortDir`. For `sortKey === \`mp:${id}\``, use `STATUS_PRIORITY` from `lib/dashboards.ts`.
8. **Helpers** (local): `compareGroups(a, b)`, `toggleSort(key)`, `openPanel(mp, entry)`, `closePanel()`, `handleDownloadCSV()`, `formatCountsLine(counts)` (small-text summary "8 groups · 1 awaiting · 1 revision · 0 rejected", joins non-zero counts with `·`).
9. **CSS**: status grid styling; `.status-cell-btn`, `.mp-counts-row`, `.mp-titles-row`, `.sticky-group`. Status badge import: `StatusBadge` from T4.
10. **CSV format** — long, one row per (group, MP). Columns per spec §6.4 lines ~1244-1247: `group_name, mp_title, mp_block_title, status, latest_submission_number, latest_submission_at, latest_submission_by, is_late, is_resubmission, file_size, latest_evaluation_at, latest_evaluation_by, evaluation_result, evaluation_score, has_feedback_file`. `is_late`, `is_resubmission`, `has_feedback_file` are booleans — `CsvColumn.value` returns `boolean` (the T3 widening covers this).

Layout: outer shell per spec §6.4 lines ~1105-1166 (three independent `{#if}` blocks; `{#if data.run.groups_enabled === false}` shows placeholder; otherwise renders the `<table class="submission-grid">` per lines ~1172-1222 with sticky first column + per-MP columns + counts row + status cells with `<StatusBadge>` inside `<button>`).

Use the placeholder side panel from T5 (`<div class="panel-placeholder">{JSON.stringify(panelTarget)}</div>`) until T7 replaces it.

- [ ] **Step 2: Create `frontend/src/tests/RunSubmissionTab.svelte.test.ts` — mount helper + 6 representative tests**

```ts
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

import RunSubmissionTab from '../components/runs/RunSubmissionTab.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ));
}

function mountTab(runId = 1) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(RunSubmissionTab, { target: host, props: { runId } });
  flushSync();
  return host;
}

beforeEach(() => { vi.restoreAllMocks(); });

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

function submissionMock(overrides: Record<string, unknown> = {}) {
  return {
    run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: false },
    mini_projects: [
      {
        id: 1, block_id: 5, block_title: 'B1', title: 'Mini project for Block 1',
        groups: [
          { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'not_submitted' },
          { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'accepted' },
        ],
        counts: { groups: 2, awaiting_eval: 0, needs_revision: 0, rejected: 0 },
      },
      {
        id: 2, block_id: 6, block_title: 'B2', title: 'Mini project for Block 2',
        groups: [
          { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'needs_revision' },
          { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'awaiting_eval' },
        ],
        counts: { groups: 2, awaiting_eval: 1, needs_revision: 1, rejected: 0 },
      },
    ],
    ...overrides,
  };
}

describe('RunSubmissionTab', () => {
  it('renders LoadingPlaceholder before fetch resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    mountTab();
    expect(host.querySelector('.loading, [aria-busy="true"]')).toBeTruthy();
  });

  it('renders status grid when data loads', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await tick(); await tick(); flushSync();
    const grid = host.querySelector('table.submission-grid');
    expect(grid).toBeTruthy();
    // Each MP becomes a column; G1 and G2 are rows
    expect(host.textContent).toContain('G1');
    expect(host.textContent).toContain('G2');
    expect(host.textContent).toContain('Mini project for Block 1');
  });

  it('shows placeholder when groups_enabled: false', async () => {
    const body = submissionMock({
      run: { id: 1, title: 'R', groups_enabled: false, version_is_disabled: false },
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await tick(); await tick(); flushSync();
    expect(host.querySelector('table.submission-grid')).toBeFalsy();
    expect(host.textContent?.toLowerCase()).toContain('groups disabled');
  });

  it('sort by MP column uses priority order (needs_revision first asc)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await tick(); await tick(); flushSync();
    // Click "Mini project for Block 2" column header to sort
    const headerBtn = Array.from(host.querySelectorAll('th button'))
      .find((b) => b.textContent?.includes('Block 2')) as HTMLButtonElement;
    headerBtn.click();
    flushSync();
    const rows = Array.from(host.querySelectorAll('tbody tr'));
    // G1 has needs_revision on MP2 → should be first
    expect(rows[0].textContent).toContain('G1');
  });

  it('group-filter dropdown derives options from data.mini_projects[i].groups[]', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await tick(); await tick(); flushSync();
    const select = host.querySelector('select') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('all');
    expect(opts).toContain('1');
    expect(opts).toContain('2');
    expect(opts).not.toContain('ungrouped');  // no analog for Submission tab
  });

  it('per-MP counts row renders formatCountsLine output', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await tick(); await tick(); flushSync();
    // MP2 has counts {groups: 2, awaiting_eval: 1, needs_revision: 1, rejected: 0}
    // Joined with · (skip zero) → "2 groups · 1 awaiting · 1 revision"
    expect(host.textContent).toMatch(/2 groups.*1 awaiting.*1 revision/);
  });
});
```

- [ ] **Step 3: Add the remaining ~11 tests from §13 RunSubmissionTab list**

Per spec §13 lines ~1640-1671 (rev 11 numbering). Tests to add:

- Error state renders error banner with retry.
- Status badge rendering: each of the 5 statuses with correct class + label + icon (via the StatusBadge component being mounted).
- Sort by group: click → toggle direction.
- Filter by group dropdown narrows rows.
- Cell click: side panel opens with submission `target` shape (no fetch; objects passed).
- Disabled group rendering.
- Refresh button: click triggers refetch (parallel to RunProgressTab refresh test).
- Stale-while-revalidate: prior `data` stays rendered during Refresh-triggered refetch; loading placeholder appears alongside the populated grid.
- Retry-after-error: error → Retry → error clears + loading flips on; on mocked-success rerender, grid populates.
- CSV download: long-format with all required columns; one row per (group, MP); RFC 4180 quoting for embedded commas.
- AbortController on refetch.
- RunId-change resets local state: mount with `runId=A`; after data loads, set `groupFilter` to a specific group_id and click a cell to open the side panel. Swap to `runId=B`. Assert: `groupFilter === 'all'`, `panelOpen === false`, `panelTarget === null`. (No `nameQuery` to reset on this tab.)
- Unmount-after-`refresh()` aborts the refresh-created controller: same shape as the RunProgressTab counterpart.

Use the established mount + mockFetch + tick/flushSync patterns.

- [ ] **Step 4: Run all RunSubmissionTab tests**

Run: `cd frontend && npm test -- src/tests/RunSubmissionTab.svelte.test.ts`
Expected: All ~16 tests PASS.

- [ ] **Step 5: Type-check + full vitest sweep**

Run: `cd frontend && npm run check && npm test`
Expected: 0 TS errors; all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/runs/RunSubmissionTab.svelte \
        frontend/src/tests/RunSubmissionTab.svelte.test.ts
git commit -m "feat(frontend): add RunSubmissionTab status grid + tests (dashboards T6)"
```

---

## Task 7: Frontend — `DashboardSidePanel.svelte` + `RunDetailPage` tab registration

**Spec:** §6.5 (side panel — discriminated union target, focus management, fetch + abort, download links), §6.8 (RunDetailPage tab registration). §13 `DashboardSidePanel.svelte.test.ts` block.

**Files:**
- Create: `frontend/src/components/runs/DashboardSidePanel.svelte`
- Create: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`
- Modify: `frontend/src/components/runs/RunProgressTab.svelte` — replace the panel placeholder from T5 with the real `<DashboardSidePanel>`.
- Modify: `frontend/src/components/runs/RunSubmissionTab.svelte` — replace the panel placeholder from T6.
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte` — extend `ActiveTab` union with `'progress' | 'submission'`; register two new tab buttons and tab-content branches.

- [ ] **Step 1: Create `DashboardSidePanel.svelte` per §6.5**

```svelte
<!-- frontend/src/components/runs/DashboardSidePanel.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getSequenceItemState,
    type SequenceItemStateResponse,
    type DashboardMpRow,
    type DashboardMpGroupEntry,
  } from '../../lib/dashboards';

  type ProgressTarget = {
    kind: 'progress';
    runId: number;
    user_id: number;
    sequence_id: number;
  };
  type SubmissionTarget = {
    kind: 'submission';
    mp: DashboardMpRow;
    entry: DashboardMpGroupEntry;
  };
  export type PanelTarget = ProgressTarget | SubmissionTarget;

  let { target, onClose }: { target: PanelTarget; onClose: () => void } = $props();

  // Capture the previously-focused element so we can restore on close.
  let previousFocus: HTMLElement | null = null;
  let panelEl: HTMLDivElement | undefined = $state();

  // Progress fetch state — only relevant when target.kind === 'progress'.
  let data = $state<SequenceItemStateResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let abortCtl: AbortController | null = null;

  $effect(() => {
    abortCtl?.abort();
    if (target.kind !== 'progress') {
      data = null; loading = false; error = null;
      return;
    }
    const ctl = new AbortController();
    abortCtl = ctl;
    loading = true; error = null; data = null;
    getSequenceItemState(target.runId, target.user_id, target.sequence_id, { signal: ctl.signal })
      .then((res) => { data = res; loading = false; })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (err.status === 404) {
          error = 'Item details unavailable. The dashboard may be out of date — Refresh.';
        } else {
          error = String(err?.message ?? err);
        }
        loading = false;
      });
    return () => ctl.abort();
  });

  // Unmount-only cleanup for any in-flight panel fetch (mirrors the tab pattern).
  $effect(() => () => abortCtl?.abort());

  onMount(() => {
    previousFocus = document.activeElement as HTMLElement | null;
    panelEl?.focus();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    // Simple focus trap — tab cycling can be added later; for v1 just keep
    // focus within the panel via tabindex/sentinels in the template.
  }

  function close() {
    onClose();
    previousFocus?.focus();
  }
</script>

<div class="panel-backdrop" onclick={close} role="presentation"></div>
<div
  class="dashboard-side-panel"
  role="dialog"
  aria-modal="true"
  aria-label={target.kind === 'progress' ? 'Item-level breakdown' : 'Submission details'}
  tabindex="-1"
  bind:this={panelEl}
  onkeydown={handleKeydown}
>
  <button class="panel-close" onclick={close} aria-label="Close panel">×</button>

  {#if target.kind === 'progress'}
    {#if loading}
      <p>Loading…</p>
    {:else if error}
      <p class="banner-error" role="alert">{error}</p>
    {:else if data}
      <header>
        <h3>{data.sequence.block_title} — {data.sequence.sequence_title}</h3>
        <p>{data.student.full_name ?? data.student.email}</p>
      </header>
      {#if data.items.length === 0}
        <p>No items in this sequence.</p>
      {:else}
        <ol class="item-list">
          {#each data.items as it (it.item_id)}
            <li>
              <span class="item-covered">{it.is_covered ? '✓' : '○'}</span>
              <span class="item-title">{it.item_title}</span>
              <span class="item-type">{it.item_type}</span>
              {#if it.quiz}
                <span class="item-score">{it.quiz.last_score_correct}/{it.quiz.last_score_total}</span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    {/if}
  {:else}
    <!-- submission variant: no fetch, use entry directly -->
    <header>
      <h3>{target.mp.title}</h3>
      <p>{target.entry.group_name}</p>
    </header>
    {#if target.entry.status === 'not_submitted'}
      <p>Not submitted yet.</p>
    {:else}
      <!-- Render submission + evaluation details from target.entry.
           The exact fields surfaced depend on what /dashboard/mini-projects
           includes per group entry (latest submission + evaluation summary).
           For unsubmitted/incomplete states the spec's intent is graceful
           degradation. Download links use the verified URL patterns:
             /api/submissions/{sid}/file
             /api/evaluations/{eid}/feedback-file -->
      <!-- ... see spec §6.5 layout for the full template ... -->
    {/if}
  {/if}
</div>

<style>
  .panel-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100;
  }
  .dashboard-side-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: min(480px, 90vw);
    background: var(--bg, #fff); padding: 1.5rem;
    overflow-y: auto; z-index: 101;
    box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  }
  .panel-close { float: right; font-size: 1.5em; background: none; border: none; cursor: pointer; }
</style>
```

The submission-variant template body (download links + submission/evaluation detail fields) should be expanded per spec §6.5 — include the `/api/submissions/{sid}/file` and `/api/evaluations/{eid}/feedback-file` `<a download>` links when the corresponding IDs are present in `target.entry`.

- [ ] **Step 2: Wire the real `<DashboardSidePanel>` into both tabs**

In `RunProgressTab.svelte`, replace the placeholder:

```svelte
{#if panelOpen && panelTarget}
  <DashboardSidePanel
    target={{ kind: 'progress', runId, ...panelTarget }}
    onClose={closePanel}
  />
{/if}
```

In `RunSubmissionTab.svelte`, replace the placeholder:

```svelte
{#if panelOpen && panelTarget}
  <DashboardSidePanel
    target={{ kind: 'submission', ...panelTarget }}
    onClose={closePanel}
  />
{/if}
```

Add the `import DashboardSidePanel from './DashboardSidePanel.svelte';` at the top of each file.

- [ ] **Step 3: Register the new tabs in `RunDetailPage.svelte`**

Open `frontend/src/pages/runs/RunDetailPage.svelte`. Locate the `ActiveTab` type union and extend it:

```ts
type ActiveTab = 'overview' | 'teachers' | 'groups' | 'students' | 'mini-projects' | 'assets' | 'progress' | 'submission';
```

Locate the tab-buttons row (where the existing 6 tabs are registered) and add two new buttons in the order: Progress (7th), Submission (8th). Locate the tab-content branch (the `{#if activeTab === '...'}` chain) and add two new branches that mount `RunProgressTab` and `RunSubmissionTab` respectively, passing `runId={run.id}` (and any other props per the existing tabs' pattern). Per Slice A, `course` is threaded into tabs for admin-gating — neither dashboard tab uses it (read-only views with same auth for admin + teacher), but pass it for consistency: `course={course}` if existing tabs receive it.

- [ ] **Step 4: Create `frontend/src/tests/DashboardSidePanel.svelte.test.ts`**

Per spec §13 lines ~1661-1674. Tests:

- Progress variant: renders items list (mock fetch).
- Progress variant: empty items list ("No items in this sequence.").
- Progress variant: fetch race — new target before previous fetch returns; assert old fetch aborted.
- Progress variant: 404 from drilldown shows "Item details unavailable. The dashboard may be out of date — Refresh."
- Submission variant: renders submission + evaluation details from passed-in `entry`.
- Submission variant: `not_submitted` status renders "Not submitted yet."
- Submission variant: download links use the verified URL patterns (`/api/submissions/{sid}/file`, `/api/evaluations/{eid}/feedback-file`).
- Escape closes panel.
- Backdrop click closes panel.
- Close button closes panel.
- Focus return on close (panel's `previousFocus`).

Use the same `mount`/`unmount`/`flushSync`/`tick` patterns from T4-T6. Example shape:

```ts
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';

import DashboardSidePanel from '../components/runs/DashboardSidePanel.svelte';

// ... mount helper ...

describe('DashboardSidePanel', () => {
  it('progress variant: renders items list from fetched data', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      sequence: { sequence_id: 10, sequence_title: 'S', sequence_order: 1, block_id: 5, block_title: 'B' },
      student: { user_id: 100, full_name: 'A', email: 'a@x' },
      items: [
        { item_id: 1, item_order: 1, item_title: 'Item 1', item_type: 'static_page', is_covered: true, quiz: null },
      ],
    }), { status: 200 }))));

    const onClose = vi.fn();
    mountPanel({ target: { kind: 'progress', runId: 1, user_id: 100, sequence_id: 10 }, onClose });
    await tick(); await tick(); flushSync();
    expect(host.textContent).toContain('Item 1');
  });

  it('Escape closes panel', async () => {
    // ... mount with mocked fetch ...
    const onClose = vi.fn();
    // ... after mount ...
    const panel = host.querySelector('.dashboard-side-panel') as HTMLDivElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(onClose).toHaveBeenCalled();
  });

  // ... remaining tests ...
});
```

- [ ] **Step 5: Run side-panel tests**

Run: `cd frontend && npm test -- src/tests/DashboardSidePanel.svelte.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run full vitest + check for regression**

Run: `cd frontend && npm run check && npm test`
Expected: 0 TS errors; all tests PASS (including RunProgressTab + RunSubmissionTab tests that now wire the real panel).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/runs/DashboardSidePanel.svelte \
        frontend/src/components/runs/RunProgressTab.svelte \
        frontend/src/components/runs/RunSubmissionTab.svelte \
        frontend/src/pages/runs/RunDetailPage.svelte \
        frontend/src/tests/DashboardSidePanel.svelte.test.ts
git commit -m "feat(frontend): add DashboardSidePanel + register Progress/Submission tabs (dashboards T7)"
```

---

## Task 8: Seed script + manual smoke walkthrough + cleanup

**Spec:** §14 (full seed-script + 19-step smoke walkthrough).

**Files:**
- Create: `backend/scripts/seed_teaching_dashboards_smoke.py`

- [ ] **Step 1: Create the seed script per §14**

Open the spec §14 and use it as the literal source for the script. The script structure:

```python
"""Layered seed for the teacher dashboards smoke walkthrough.

Depends on Slice A's seed (`backend/scripts/seed_teaching_smoke.py`) — runs ON TOP
of the entities it creates. Re-running this script is safe (idempotent — re-runs
Slice A first via subprocess or import-call, then overlays this script's entities).

Usage:
    backend/.venv/bin/python -m scripts.seed_teaching_dashboards_smoke
"""
import os

from sqlalchemy import select
from sqlalchemy.exc import NoResultFound

from mathion.database import SessionLocal
from mathion.models import (
    AnswerOption, Block, Course, Evaluation, Group, Item, MiniProject, Question,
    Run, RunStudent, Sequence, Submission,
)
from mathion.models_auth import User, UserItemState
from mathion.api.helpers import (
    submission_storage_dir, build_submission_filename, build_feedback_filename,
)
from mathion.api.mini_projects import mini_project_title  # extracted in T1
from scripts.seed_teaching_smoke import get_or_create_user, render_markdown


def seed() -> None:
    # Step 0: re-acquire Slice A's entities (must run Slice A's seed first)
    db = SessionLocal()
    try:
        try:
            course = db.execute(
                select(Course).where(Course.slug == "teaching-smoke-101")
            ).scalar_one()
        except NoResultFound:
            raise RuntimeError(
                "teaching-smoke-101 course not found — Slice A "
                "seed_teaching_smoke.seed() must run successfully before this script."
            )
        version = course.versions[0]
        intro_block = next(b for b in version.blocks if b.slug == "intro")
        spring = db.execute(
            select(Run).where(Run.version_id == version.id, Run.title == "Spring 2026")
        ).scalar_one()
        fall = db.execute(
            select(Run).where(Run.version_id == version.id, Run.title == "Fall 2026")
        ).scalar_one()

        # Step 1: 6 student users (Slice A only creates admin + teacher)
        student1 = get_or_create_user(db, "student1@mathion.test", "Student One")
        student2 = get_or_create_user(db, "student2@mathion.test", "Student Two")
        student3 = get_or_create_user(db, "student3@mathion.test", "Student Three")
        student4 = get_or_create_user(db, "student4@mathion.test", "Student Four")
        student5 = get_or_create_user(db, "student5@mathion.test", "Student Five")
        student6 = get_or_create_user(db, "student6@mathion.test", "Student Six")
        student6.is_disabled = True
        db.flush()

        # Step 2: 3 Groups on Spring (unique per run_id + name per models.py:229)
        # ... (Group A, B not-disabled; Group C disabled)

        # Step 3: 6 RunStudent rows on Spring (student1+2 in A, student3+4 in B,
        # student5 in C, student6 ungrouped)

        # Step 4: 5 additional Blocks on the version (direct ORM to bypass the
        # state-guard at blocks.py:46-47 — same pattern Slice A uses)

        # Step 5: 3 Sequences on the Intro block (Estimation, Practice, Wrap-up)

        # Step 6: Items + Question + AnswerOption for the quiz items (see spec
        # §14 "Question / AnswerOption seeding for quiz items" — 8/8/5/5 questions
        # per quiz item, 1 correct AO + 1-3 distractors each)

        # Step 7: UserItemState rows for per-student variety (see spec §14
        # "UserItemState rows seeded so the heatmap shows variety")

        # Step 8: 5 MiniProjects on Spring (one per non-Intro block; all is_published=True)

        # Step 9: Submissions + Evaluations per the (MP × group) matrix in
        # spec §14 (15 cells covering all 5 MpGroupStatus values)

        # Step 10: Placeholder PDF files on disk (per spec §14 file-on-disk snippet)
        for sub in db.execute(select(Submission)).scalars():
            group = db.get(Group, sub.group_id)
            abs_dir = submission_storage_dir(spring.id, group.id)
            os.makedirs(abs_dir, exist_ok=True)
            with open(os.path.join(abs_dir, sub.file_path), "wb") as f:
                f.write(b"%PDF-1.4\n")  # PDF magic header only — NOT a valid PDF;
                # sufficient for HTTP 200 + browser download trigger. The PDF viewer
                # may show a parse error if it auto-opens the file (the assertion
                # target for §14 step 13 is "download endpoint returned the file
                # successfully", not "the file renders as a valid PDF"). Implementer
                # can upgrade to a minimal-valid PDF if downstream UX needs it.
        # Same for ev.feedback_file (if not None)

        # Step 11: Patch Fall 2026 → groups_enabled=False (for §14 step 15)
        fall.groups_enabled = False
        db.flush()

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
    print("Teacher dashboards smoke seed complete.")
```

Expand each "Step N" comment block into the literal ORM code per the spec §14 enumerated tables (Groups, RunStudents, Blocks, Sequences, Items, Questions, AnswerOptions, UserItemStates, MiniProjects, Submissions, Evaluations). The spec gives every NOT NULL field's value, every UniqueConstraint scope, every CHECK constraint reminder.

- [ ] **Step 2: Run the seed script against a fresh DB**

```bash
# (Optional) reset the dev DB if you want a clean slate first
rm -f backend/mathion.db
backend/.venv/bin/alembic -c backend/alembic.ini upgrade head

# Run Slice A first (its seed drop-and-recreates the course)
backend/.venv/bin/python -m scripts.seed_teaching_smoke

# Now layer the dashboards seed on top
backend/.venv/bin/python -m scripts.seed_teaching_dashboards_smoke
```

Expected output: `"Teacher dashboards smoke seed complete."` with no exceptions. On rerun (without resetting), expected: same successful exit (the script is overwrite-safe).

- [ ] **Step 3: Start backend + frontend dev servers**

```bash
# Terminal 1
backend/.venv/bin/uvicorn mathion.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

Open the printed dev URL (typically `http://localhost:5173`).

- [ ] **Step 4: Walk through spec §14 steps 1-19**

The spec §14 (lines ~1818-1836 in rev 12 numbering) is the authoritative checklist. Copy each step verbatim into a notepad and tick as you go. Key gates:

- Step 1-2: Login as admin → navigate to Spring 2026 run → click Progress tab → heatmap renders with sequences as columns, students as rows; default mode is Coverage.
- Step 3: Toggle to Quiz mode → cells now show `{correct}/{total}`; quizless columns render `—` in gray.
- Step 4: Click a column header → rows reorder; `aria-sort` updates; click again flips direction.
- Step 5: Filter by group dropdown → rows filter; "(Ungrouped)" option appears only because student6 is ungrouped.
- Step 6: Type in search box → rows filter on both name AND email.
- Step 7: Empty-state placeholder appears when filter excludes all rows.
- Step 8: Click a cell → side panel opens with item-level breakdown; each row shows `is_covered` + quiz score where applicable; Escape closes; focus returns to the originating cell button.
- Step 9: Click Download CSV on Progress tab → file downloads; open the CSV: BOM (Excel opens UTF-8 correctly), one row per filtered student, header text matches §6.3 literally, a student with a comma in their name is quoted correctly.
- Step 10: Refresh button → table re-fetches.
- Step 11: Click Submission tab → status grid renders with groups as rows, MPs as columns; status badges colored correctly; per-MP counts row shows totals.
- Step 12: Click MP column header → sort by priority: `needs_revision` → `rejected` → `awaiting_eval` → `not_submitted` → `accepted`.
- Step 13: Click a status cell → side panel shows submission + evaluation details; click "Download submission" and "Download feedback file" links; both return HTTP 200 and trigger a browser download (filename matches the bare basename stored on the row). The placeholder bytes (`b"%PDF-1.4\n"`) are the PDF magic header only — NOT a valid PDF — so the browser's PDF viewer may show a parse error if it auto-opens; assertion target is "the download endpoint returned the file successfully", not "the file renders as a valid PDF".
- Step 14: Click Download CSV on Submission tab → file downloads; long format; one row per (group, MP).
- Step 15: Switch to a run with `groups_enabled: false` (the Fall 2026 run) → Submission tab shows the placeholder text.
- Step 16: Logout, login as the seeded teacher (`teacher@mathion.test`) → both tabs visible and functional (same auth as admin).
- Step 17: As admin, disable the course version via the Course Editor's existing UI → Progress tab shows the yellow warning banner.
- Step 18: Re-enable the version → banner disappears on Refresh.
- Step 19: Verify student6 (disabled) renders with muted italic styling + "disabled" badge; Group C (disabled) also renders with the badge in body row-headers; group-filter `<option>` uses `" (disabled)"` parenthetical (because `<option>` can't contain element children).

- [ ] **Step 5: File any defects as follow-up commits; do NOT proceed until clean**

If any step fails, file the bug, fix it as a follow-up commit per the standard TDD loop (write failing test, fix, commit). Once all §14 steps pass, proceed.

- [ ] **Step 6: Run the full backend test suite end-to-end**

Run: `backend/.venv/bin/pytest backend/tests/ -v`
Expected: All PASS.

- [ ] **Step 7: Run the full frontend test suite end-to-end**

Run: `cd frontend && npm run check && npm test`
Expected: 0 TS errors; all PASS.

- [ ] **Step 8: Review the full diff against `main`**

```bash
git fetch origin main
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Sanity-check there are no stray files, no debug prints, no commented-out code.

- [ ] **Step 9: Commit the seed script + a checkpoint marker**

```bash
git add backend/scripts/seed_teaching_dashboards_smoke.py
git commit -m "feat(seed): teacher dashboards smoke seed + manual walkthrough complete (dashboards T8)"
```

- [ ] **Step 10: Hand off to `superpowers:finishing-a-development-branch`**

The branch is ready for merge / PR. Invoke the finishing skill or follow its menu (Merge / Push+PR / Keep / Discard).

---

## Self-Review Notes

This plan was self-reviewed against rev 12 of the spec:

1. **Spec coverage:**
   - §3 architecture → reference only (no implementation; covered by component file layout in T2-T7)
   - §4 decisions → reference only
   - §5.1 new endpoint → T1 (endpoint + helpers + 15 tests)
   - §5.2 additive `title` field → T1 (mini_project_title helper extracted + 1 test)
   - §6.1 TypeScript interfaces → T2 (lib/dashboards.ts)
   - §6.2 wire functions → T2
   - §6.3 RunProgressTab → T5
   - §6.4 RunSubmissionTab → T6 (status grid, priority sort, CSV long format)
   - §6.5 DashboardSidePanel → T7 (discriminated union target, focus management, fetch + abort, download links)
   - §6.6 StatusBadge → T4
   - §6.7 lib/csvWrite.ts → T3
   - §6.8 RunDetailPage tab registration → T7
   - §7 edge cases → covered by tests in T1, T5, T6, T7
   - §8 migration / data → no DB changes, covered by §15 statement
   - §9 backward compat → covered (additive field on existing endpoint; new endpoint is brand new)
   - §10 performance → reference only (the 3-4 query budget on new endpoint is enforced by §5.1 SQL structure)
   - §11 accessibility → reference only (CSS contrast pairs in T4 CSS, sticky columns + aria-sort in T5/T6, focus management in T7)
   - §12 open questions → all resolved / explicitly deferred in rev 12 — none open
   - §13 tests → T1 (backend), T2-T7 (frontend)
   - §14 manual smoke → T8
   - §15 files touched → matches T1-T8 file lists

2. **Placeholder scan:** No `TBD` / `TODO` / `implement later` placeholders. Where the spec body contains a long layout snippet (e.g., §6.3 lines ~766-872) the plan instructs the implementer to use the spec snippet verbatim — this is intentional reduction-by-citation, not a placeholder, because the snippet is normative and reproducing it inline would be 100+ lines of pure duplication.

3. **Type consistency:**
   - `DashboardProgressResponse`, `DashboardMiniProjectsResponse`, `SequenceItemStateResponse` — same shape in T1 backend Pydantic schemas + T2 frontend TS interfaces + T5/T6/T7 consumer code.
   - `MpGroupStatus` enum — same 5 values in T1 (`SequenceItemState.item_type` is a different enum but uses same `Literal[...]` pattern), T2 (`STATUS_LABEL`/`STATUS_ICON`/`STATUS_PRIORITY` keys), T4 (`StatusBadge` prop), T6 (Submission tab status cells).
   - `CsvColumn<Row>` interface — same in T3 declaration + T5/T6 consumer code; includes `boolean` value type per rev 11 fix #3.
   - `PanelTarget` discriminated union — defined in T7 (DashboardSidePanel), consumed by T5 (`{ kind: 'progress', runId, ...panelTarget }`) and T6 (`{ kind: 'submission', ...panelTarget }`).
   - `handleDownloadCSV` (local helper name) — same name on both T5 and T6 (rev 10 rename — see spec §17 line ~1910).

4. **Scope:** No backward-compat hacks, no helpers built that aren't used in the same or next task, no abstraction for hypothetical future use. Plan stays within the spec.

5. **Risk flags called out inline:**
   - T1 — verify exact fixture names in `backend/tests/conftest.py` (the spec assumes `client`, `db`, `admin_login`, `teacher_login`, `student_login` per the project's existing pattern).
   - T2 — verify `api.get` signature in `frontend/src/lib/api.ts` and adjust `{ signal }` threading if the project's helper uses a different shape.
   - T4 — verify `--surface-muted` token is not already in `styles/base.css` before adding (avoid duplication).
   - T5/T6 — placeholder side panel in T5/T6 is intentional; T7 replaces it. Tests written in T5/T6 should NOT assert on the placeholder's contents — they should assert that `panelOpen === true` and `panelTarget` is correctly populated.
   - T7 — `RunDetailPage` tab-button row currently has 6 buttons; adding 2 more makes 8. Verify the layout (flexbox / grid wrap) handles the additional buttons gracefully on narrow viewports. If not, defer responsive polish per spec §2 (out of scope) but note the visual regression for follow-up.
   - T8 — Step 0's `try/except NoResultFound` only wraps the `course` lookup. The downstream `version` / `intro_block` / `spring` / `fall` lookups raise bare `IndexError` / `StopIteration` / `NoResultFound` if Slice A's `seed()` is ever modified backwards-incompatibly — see spec §14 "Why only `course` is wrapped" paragraph for the rationale.

---
