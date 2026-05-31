# Teacher dashboards — design (rev 12)

**Status:** rev 12, in review (incorporates findings from the 5-Opus R11 panel against rev 11 — 3 PASS / 2 REVISE, 5 cross-confirmed Important items folded in).

**Changes from rev 11:** see end of file (§16). Prior revs documented in §17–§26.

**Scope:** Add the two teacher dashboard surfaces (Progress + Submission) on `RunDetailPage` as the 7th and 8th tabs, consuming the existing Phase 7c backend endpoints. Add ONE new backend endpoint to power the per-item drilldown side panel for the Progress tab. Add CSV export for both views.

**Audience:** admins of the course AND teachers of the run. Same auth as the Phase 7c dashboard endpoints; no role-aware hides beyond what Slice A already shipped (the run-detail page itself is already gated).

**Out of scope:** submissions review/grading (slice B), evaluations writing (slice C), notifications / pending badges (slice E), mobile/responsive layout, per-student profile page, multi-column sort, deep-link sharing of filter state.

---

## 1. Goal

Teachers monitoring a run need to answer two questions quickly:

1. **Progress** — which students have covered which sequences? where do they stall? how are they doing on quizzes?
2. **Submission status** — which groups have submitted each mini-project? which need evaluation? which need follow-up?

Slice A unblocked the entry surface (`/teaching` + role-aware `RunDetailPage`). The Phase 7c backend already ships:

- `GET /api/runs/{rid}/dashboard/progress` — sequences × students grid with `{covered, total}` and `{correct, total}` per cell.
- `GET /api/runs/{rid}/dashboard/mini-projects` — mini-projects × groups grid with status enum + counts + latest submission/evaluation references.

This slice wires those into the UI on `RunDetailPage` and adds the third missing piece — per-item drilldown for a (student, sequence) cell — via one small new endpoint.

---

## 2. Non-goals

- **Evaluation actions.** Clicking a "needs_revision" cell on the Submission tab opens a read-only side panel. Writing an evaluation is slice B; the side panel does NOT include a "submit evaluation" action.
- **Edit/delete affordances on the dashboard.** Both tabs are read-only.
- **Aggregations across runs.** Each dashboard is scoped to one run.
- **Date-windowed historical views.** The dashboard reflects current state of `UserItemState`, `Submission`, and `Evaluation`. No "as of last week" filter.
- **Realtime updates.** Data is fetched on tab activation and after explicit user action (refresh button, filter change). No websockets/polling.
- **Pagination.** Backend returns full payloads; frontend renders in DOM. Spec'd run sizes (up to 200 students × 20 sequences ≈ 4000 cells; ~5 MPs × 30 groups = 150 cells) are well within DOM-render limits with virtual scrolling NOT needed.
- **Mobile layout.** Project-wide deferral. Tables assume ≥1024px viewport.

---

## 3. Architecture overview

```
backend/mathion/
  api/
    dashboard.py         MODIFIED. Adds GET /api/runs/{rid}/students/{uid}/sequences/{sid}/items.
                         The new endpoint joins the two existing /dashboard/* endpoints
                         (same router/tags) — it is the per-item drilldown for /dashboard/progress.
                         Reuses helpers.require_run_admin_or_teacher (verified at helpers.py:109).
                         ALSO modifies the existing /dashboard/mini-projects endpoint to include
                         `title` per MP in each row (5 LOC; see §5.2).
  schemas.py             MODIFIED. Adds SequenceItemStateResponse + SequenceItemState
                         (drilldown payload). The two existing dashboard endpoints
                         currently return raw `dict` (no `response_model`); this slice
                         does NOT introduce Pydantic models for them.
backend/scripts/
  seed_teaching_dashboards_smoke.py   NEW. Extends Slice A's seed_teaching_smoke.py
                                       fixture with the entities the §14 smoke walks through.
                                       See §14 for the concrete entity list.
backend/tests/
  test_dashboard_item_drilldown.py    NEW. 15 tests for the new endpoint.
  test_dashboard_mini_projects.py     MODIFIED. +1 test asserting `title` field exists.

frontend/src/
  lib/
    dashboards.ts        NEW. Wire module for the 3 dashboard endpoints (typed responses,
                         AbortSignal-aware) PLUS exported constants STATUS_LABEL,
                         STATUS_ICON, STATUS_PRIORITY (single source of truth, see §6.1).
    csvWrite.ts          NEW. CSV serializer helper. (csv.ts is the existing roster-IMPORT
                         parser; the serialization helper lives in a separate file by name
                         to avoid confusion. See §6.7 for the toCSV contract.) Also exports
                         `sanitizeTitle(title, fallback)` (used by both tabs for filename
                         construction — see §6.3).
  components/runs/
    RunProgressTab.svelte         NEW. Heatmap with Coverage/Quiz switcher.
    RunSubmissionTab.svelte       NEW. Status grid (groups × MPs).
    DashboardSidePanel.svelte     NEW. Slide-in drilldown panel (Progress + MP variants
                                   selected via discriminated `target` union).
  components/ui/
    StatusBadge.svelte            NEW. Small reusable badge for the 5 MP statuses.
                                   Inline icon + label, dark-on-light colors (see §6.4).
  pages/runs/
    RunDetailPage.svelte          MODIFIED. Register two new tabs + extend ActiveTab union.
  tests/
    RunProgressTab.svelte.test.ts        NEW.
    RunSubmissionTab.svelte.test.ts      NEW.
    DashboardSidePanel.svelte.test.ts    NEW.
    StatusBadge.svelte.test.ts           NEW.
    dashboards.test.ts                   NEW. Wire-module unit + contract tests.
    csvWrite.test.ts                     NEW.
```

`ErrorBanner`, `SortIndicator`-style helpers are inlined in each tab using the existing project pattern (cf. `RunMiniProjectsTab.svelte` for inline error banner; `RunAssetsTab.svelte:707-714` for inline `▲/▼` sort indicators on `<th>`). `LoadingPlaceholder` already exists at `frontend/src/components/ui/LoadingPlaceholder.svelte`; reused. `FocusTrap` already exists at `frontend/src/components/ui/FocusTrap.svelte`; reused.

**Global CSS variables** live in `frontend/src/styles/base.css` (NOT `app.css`, which only `@import`s reset.css + base.css). The existing token set is: `--bg`, `--text`, `--muted`, `--border`, `--primary`, `--danger`, `--success` (verify at impl time). The new variables introduced by this slice (the 10 `--status-*` pairs in §6.4 and any `--surface-muted` used by the heatmap) are added to that file. Where the spec body writes `var(--surface, #fff)` etc., the impl should substitute the existing token (`var(--bg)`) OR add the new token to base.css to match the convention.

No DB migrations. No master-spec changes (existing master-spec lines 484-486 already mention "completion overview, quiz summary, mini-project status"; the column-is-sequence refinement was made in Phase 7c spec).

---

## 4. Decisions fixed by master / Phase 7c / Slice A

| Decision | Source |
|---|---|
| Two backend endpoints already exist for the (Progress, MP) tabular data | Phase 7c |
| Tab placement: 7th and 8th tabs on `RunDetailPage`, in order `Progress, Submission` (after `Assets`) | Brainstorm Q6-a |
| Tab names: `Progress` and `Submission` | Brainstorm Q6 |
| Tab buttons follow the existing pattern: `<button role="tab" aria-selected={...}>` (NOT `data-tab` + `class:active`) | RunDetailPage.svelte:360-365 |
| Tab visibility: admin AND teacher (same auth as dashboards endpoints; same `RunDetailPage` rules as the other 6 tabs) | Slice A |
| Both new tabs take a `runId: number` prop only — no `course` prop. (Both tabs render identical affordances for admin and teacher; there is no role-aware UI inside them, so threading the `course` prop would be unused-prop noise.) | This spec; deviates from the other 6 tabs by omission, not by contradiction |
| `ActiveTab` union extended: `'overview' \| 'teachers' \| 'groups' \| 'roster' \| 'mini-projects' \| 'assets' \| 'progress' \| 'submission'` | This spec |
| Frontend stack: Svelte 5 runes, vitest, no new JS/CSS deps | Project convention |
| Tests use `mount/unmount/flushSync` from `svelte`, NOT `@testing-library/svelte`; per-component `mountX(extra)` helper pattern | Project convention; see `RunMiniProjectsTab.svelte.test.ts:44-68` |

---

## 5. Backend changes

### 5.1 New endpoint — per-(student, sequence) item state

**Why this endpoint exists.** Phase 7c deliberately aggregated by sequence — no per-item data ships in `/dashboard/progress`. The Q7-a drilldown choice (per-item breakdown in the side panel) needs item-level fields: `item.title`, `item.type`, `UserItemState.is_covered`, `UserItemState.last_score_correct/last_score_total`. A new endpoint avoids N+1 if we'd otherwise call existing `/api/items/{iid}/state` per item, AND keeps the existing dashboard endpoints small.

#### Contract

```
GET /api/runs/{run_id}/students/{user_id}/sequences/{sequence_id}/items
Auth: admin of the course OR teacher of the run (require_run_admin_or_teacher) OR superuser.

Response: 200 OK, application/json (shape below).

Errors:
  - 401 unauthenticated
  - 404 if the run does not exist (probe-safe)
  - 403 if the run exists but requester is not admin/teacher of it
  - 404 if the user does not exist OR exists but is not a RunStudent on this run
  - 404 if the sequence does not exist OR exists but does not belong to the run's pinned version
```

#### Order of checks (critical for probe-safety)

The FastAPI auth dependency (`get_current_user`) fires FIRST and raises 401 for unauthenticated requests before any handler code runs. After authentication:

1. `get_or_404(db, Run, run_id, detail="Resource not found")` → 404 `"Resource not found"` if missing. This fires BEFORE the authorization (role) check (uniform with rest of FastAPI codebase). NB: an authenticated user CAN distinguish "run nonexistent" (404) from "run exists but I don't have access" (403 from step 2) via status-code differential. This is the existing project-wide convention — accepted tradeoff, also documented in §11.
2. `require_run_admin_or_teacher(db, current_user, run)` → 403 if not authorized.
3. `_resolve_run_student_with_user(db, run, user_id)` → 404 `"Resource not found"` if the user isn't a RunStudent on this run (whether the user doesn't exist at all or exists in a different run — same response, no leak).
4. `_resolve_sequence_in_version(db, run.version_id, sequence_id)` → 404 `"Resource not found"` if the sequence doesn't belong to the pinned version.

**All 404 responses use the identical detail string `"Resource not found"` to prevent enumeration via diffing.**

> **Implementation note on `get_or_404` default detail.** The helper at `backend/mathion/api/helpers.py:45-50` defaults `detail` to `f"{model.__name__} not found"` (e.g., `"Run not found"`). To satisfy the identical-string requirement, every `get_or_404` call AND every `HTTPException(404, ...)` raised by `_resolve_run_student_with_user` / `_resolve_sequence_in_version` MUST pass `detail="Resource not found"` explicitly.
>
> **Known asymmetry — existing endpoint.** The sibling endpoints `/dashboard/progress` and `/dashboard/mini-projects` (`dashboard.py:176, 276`) currently use the default `"Run not found"` detail. They are NOT modified in this slice; teachers probing the new endpoint get uniform 404s, but probing those two endpoints still leaks via detail string diffs. Out-of-scope hardening tracked for a future security pass.

#### New helpers (added in this slice to `backend/mathion/api/dashboard.py` as module-local functions; not in `helpers.py` since they are dashboard-specific)

```python
def _resolve_sequence_in_version(
    db: Session, version_id: int, sequence_id: int
) -> tuple[Sequence, Block]:
    """Return (Sequence, Block) iff the sequence belongs to the given version, else 404.

    Returns BOTH so the endpoint can populate _SequenceMeta.{block_id, block_title}
    without a second query / lazy-load on Sequence.block. Keeps the endpoint at 4 queries.
    """
    row = db.execute(
        select(Sequence, Block)
        .join(Block, Sequence.block_id == Block.id)
        .where(
            Sequence.id == sequence_id,
            Block.version_id == version_id,
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    seq, block = row   # SQLAlchemy 2.x Row unpacks directly; avoid the now-deprecated .tuple()
    return seq, block


def _resolve_run_student_with_user(
    db: Session, run: Run, user_id: int
) -> tuple[RunStudent, User]:
    """Return (RunStudent, User) iff the user is a student of this run, else 404.

    Returns BOTH so the endpoint can populate _StudentMeta.{full_name, email}
    without a second query.
    """
    row = db.execute(
        select(RunStudent, User)
        .join(User, RunStudent.user_id == User.id)
        .where(
            RunStudent.run_id == run.id,
            RunStudent.user_id == user_id,
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    run_student, user = row
    return run_student, user
```

Endpoint usage:

```python
run_student, user = _resolve_run_student_with_user(db, run, user_id)
sequence, block = _resolve_sequence_in_version(db, run.version_id, sequence_id)
items = db.execute(stmt).all()  # the LEFT JOIN query above
return SequenceItemStateResponse(
    sequence=_SequenceMeta(
        sequence_id=sequence.id, sequence_title=sequence.title,
        block_id=block.id, block_title=block.title,
    ),
    student=_StudentMeta(
        user_id=user.id, full_name=user.full_name, email=user.email,
    ),
    items=[...],
)
```

Four endpoint-specific queries, excluding the shared authorization helper: (1) `get_or_404(Run)`, (2) `_resolve_student_user_in_run` (RunStudent JOIN User), (3) `_resolve_sequence_in_version` (Sequence JOIN Block), (4) items LEFT JOIN UIS — matching §10 Performance. The project-wide `require_run_admin_or_teacher` helper (`helpers.py:109-132`, NOT a FastAPI dependency — it's an imperative call inside the handler body) adds 3 more queries on the non-superuser path (CourseVersion lookup at line 118 + CourseAdmin SELECT at lines 119-124 + RunTeacher SELECT at lines 125-130); that overhead is shared across every endpoint using the helper. **Non-superuser total: normally 7 SQL statements; superuser short-circuits to 4** (helper returns early at lines 115-116).

#### Pydantic schemas (added to `backend/mathion/schemas.py`)

```python
from pydantic import BaseModel


class SequenceItemScore(BaseModel):
    correct: int
    total: int


class SequenceItemState(BaseModel):
    item_id: int
    item_order: int
    item_title: str
    item_type: Literal["static_page", "video", "quiz", "interactive_app"]
    is_covered: bool
    last_score: SequenceItemScore | None
    last_visited_at: datetime | None


class _SequenceMeta(BaseModel):
    sequence_id: int
    sequence_title: str
    block_id: int
    block_title: str


class _StudentMeta(BaseModel):
    user_id: int
    full_name: str | None
    email: str


class SequenceItemStateResponse(BaseModel):
    sequence: _SequenceMeta
    student: _StudentMeta
    items: list[SequenceItemState]
```

The endpoint declares `response_model=SequenceItemStateResponse` on its FastAPI decorator (unlike the existing two dashboard endpoints which return raw dicts).

#### Response shape

```json
{
  "sequence": {
    "sequence_id": 12,
    "sequence_title": "Estimation",
    "block_id": 4,
    "block_title": "Linear regression"
  },
  "student": {
    "user_id": 88,
    "full_name": "Alice Smith",
    "email": "alice@example.com"
  },
  "items": [
    {
      "item_id": 421,
      "item_order": 1,
      "item_title": "What is regression?",
      "item_type": "static_page",
      "is_covered": true,
      "last_score": null,
      "last_visited_at": "2026-04-10T09:14:00Z"
    },
    {
      "item_id": 422,
      "item_order": 2,
      "item_title": "Estimation quiz",
      "item_type": "quiz",
      "is_covered": true,
      "last_score": { "correct": 6, "total": 8 },
      "last_visited_at": "2026-04-10T09:32:00Z"
    }
  ]
}
```

Note: `student.full_name` is `str | None` (mirrors `User.full_name`, which is nullable per `models_auth.py:14`).

#### Cell conventions

- `last_score`: nested `{ correct: int, total: int } | null`. Matches the shape used by the existing `ItemStateResponse` at `schemas.py:221-228`. `null` whenever ANY of the following hold: (a) the item is not of type `quiz`; (b) no `UserItemState` row exists for this (user, item); (c) a row exists but BOTH `last_score_correct` and `last_score_total` are `None` (student visited but never attempted — both columns are nullable per `models_auth.py:UserItemState`).
- `is_covered`: `bool(UserItemState.is_covered)` if a row exists for `(user_id, item_id)`, else `false`. Matches the Phase 7c convention at `dashboard.py:114` (no row = not covered).
- `last_visited_at`: `UserItemState.last_visited_at.isoformat() if row else null`. Field is named `last_visited_at` to match the existing column (`UserItemState.last_visited_at`, models_auth.py:83) and the existing `ItemStateResponse` API contract.
- `item_type`: literal from `Item.type` Literal at `schemas.py:97` — the exhaustive set is `'static_page' | 'video' | 'quiz' | 'interactive_app'`. The TS interface uses `string` (forward-compatible) but backend Pydantic uses the precise Literal (above).

#### Computation strategy (no N+1, illustrative — actual impl uses SQLAlchemy ORM)

Four endpoint-specific queries, excluding the shared authorization helper (the `require_run_admin_or_teacher` call inside the handler adds 3 more on the non-superuser path — CourseVersion lookup + CourseAdmin SELECT + RunTeacher SELECT — so the non-superuser total is normally 7 SQL statements; superuser short-circuits to 4):

1. Resolve the run (1 SQL — `get_or_404(Run)`). The separate authorization helper call follows immediately after and is not counted in this 4-query budget.
2. Resolve sequence + its block in one join (1 SQL), guarding `block.version_id == run.version_id`.
3. Resolve user existence + RunStudent membership (1 SQL — join `users` and `run_students`).
4. Resolve items in the sequence LEFT JOIN their `UserItemState` for this user (1 SQL).

SQLAlchemy ORM sketch (NOT raw SQL — `Item.order` is a Python attribute; SQLAlchemy quotes the underlying column correctly):

```python
stmt = (
    select(
        Item.id, Item.order, Item.title, Item.type,
        UserItemState.is_covered,
        UserItemState.last_score_correct,
        UserItemState.last_score_total,
        UserItemState.last_visited_at,
    )
    .select_from(Item)
    .outerjoin(
        UserItemState,
        (UserItemState.user_id == user_id) & (UserItemState.item_id == Item.id),
    )
    .where(Item.sequence_id == sequence_id)
    .order_by(Item.order)
)
rows = db.execute(stmt).all()
```

The Python loop assembles `last_score = {"correct": c, "total": t}` only when `item_type == "quiz"` AND a row exists AND `c is not None AND t is not None`; else `None`. No per-item additional DB call.

#### Edge cases

| Scenario | Behavior |
|---|---|
| Student exists in run but has touched zero items in this sequence | `items[]` populated from `Item` table; each item has `is_covered: false`, `last_score: null`. |
| Sequence has zero items | `items: []`. |
| Sequence belongs to a different version than the run's pinned version | 404 (`block.version_id != run.version_id`). Same `"Resource not found"` detail. |
| Quiz item with no `UserItemState` row | `last_score: null` (distinct from `{correct: 0, total: 8}`, which means "attempted, all wrong" per Phase 7c semantics; see §6.3 quiz-mode note). |
| Disabled user | 200 OK — admin/teacher can still view. |
| Disabled course version | 200 OK — admin/teacher reads historical state (helper does NOT gate on version disable; consistent with Phase 7b cleanup and the existing `/dashboard/progress` semantics). |
| Run unpublished | 200 OK — admin/teacher preview. |
| `user_id` is a real user but enrolled in a different run | 404 (RunStudent check fails). |
| `user_id` doesn't exist at all | 404 (RunStudent check fails — joins on user_id). |
| `sequence_id` doesn't exist at all | 404. |
| Student of THIS run requesting their own drilldown (curiosity) | 403 (the requester isn't an admin/teacher; helper rejects). Confirms the endpoint is admin/teacher-only. |
| Superuser (not admin/teacher of the course) | 200 OK (helper short-circuits on `is_superuser`). |

#### Tests (lives in new `backend/tests/test_dashboard_item_drilldown.py`)

1. Admin returns 200 with full payload.
2. Run teacher returns 200 with same payload.
3. Superuser returns 200 (verifies helper short-circuit).
4. Non-member (no CourseAdmin, no RunTeacher, no enrollment, not superuser) returns 403.
5. Teacher of a DIFFERENT run (course-distinct) returns 403.
6. Student of THIS run (no admin/teacher role) returns 403 even for their own data.
7. Student-not-in-this-run (different run / not enrolled / nonexistent user_id) returns 404 with identical `"Resource not found"` detail.
8. Sequence-not-in-pinned-version returns 404 with identical detail.
9. Nonexistent `sequence_id` returns 404.
10. Empty sequence (zero items) returns `items: []`.
11. Zero touched items returns full item list with `is_covered: false` defaults and `last_score: null`.
12. Quiz item with attempt returns `last_score: {correct, total}` populated; non-quiz items return `last_score: null`.
13. Disabled user returns 200.
14. Disabled version returns 200.
15. Unpublished run returns 200 for admin/teacher.

### 5.2 Existing dashboard endpoints — additive change

The existing `/api/runs/{rid}/dashboard/mini-projects` endpoint (`dashboard.py:270`) is modified to include a `title` field on each MP row.

**Source of `title`.** Mini-project titles are NOT stored on the `MiniProject` ORM model (verify `backend/mathion/models.py:260-289` — no `title` column). The string is service-derived at `backend/mathion/api/mini_projects.py:44` as:

```python
f"Mini project for Block {block.order}"
```

The dashboard endpoint loop at `dashboard.py:319-320` already unpacks `(mp, block)` tuples, so the change is:

1. Extract a shared helper in `mini_projects.py` (rename the existing inline expression):
   ```python
   def mini_project_title(block: Block) -> str:
       return f"Mini project for Block {block.order}"
   ```
2. Use it in both places — `_serialize_mini_project` and the dashboard MP row assembly:
   ```python
   "title": mini_project_title(block),
   ```

This avoids duplicating the format string. Total: ~6 LOC across `mini_projects.py` (extract helper + use it) and `dashboard.py` (import + use it). No schema breaking change (additive — existing clients ignore unknown keys). One new test in `backend/tests/test_dashboard_mini_projects.py` asserts the `title` field is present and matches the expected format.

The `MiniProjectResponse.title` Pydantic field at `schemas.py:594` (`title: str = ""`) has its value populated by `_serialize_mini_project` — it is not a backing-storage field. The spec previously misrepresented this; the helper-based approach (above) is the implementable path.

`/api/runs/{rid}/dashboard/progress` is unchanged.

---

## 6. Frontend changes

### 6.1 `lib/dashboards.ts` (NEW wire module)

All fetch helpers accept an optional `AbortSignal` so the components can cancel in-flight requests on tab switch / rapid clicks. (The base `api.ts` `request()` helper accepts `signal` via `RequestInit` already; threading is additive.)

```ts
// frontend/src/lib/dashboards.ts
import { api } from './api';

// ---- Progress dashboard ----

export interface DashboardSequence {
  block_id: number;
  block_order: number;
  block_title: string;
  sequence_id: number;
  sequence_order: number;
  sequence_title: string;
  total_items: number;
  has_quiz_items: boolean;
}

export interface DashboardCoverageCell { sequence_id: number; covered: number; total: number; }
export interface DashboardQuizCell { sequence_id: number; correct: number | null; total: number | null; }

export interface DashboardStudent {
  user_id: number;
  email: string;
  full_name: string | null;
  user_is_disabled: boolean;
  group_id: number | null;
  group_name: string | null;
  group_is_disabled: boolean;
  coverage: DashboardCoverageCell[];   // positionally aligned with `sequences[]` by index
  quizzes: DashboardQuizCell[];        // positionally aligned with `sequences[]` by index
}

export interface DashboardProgressResponse {
  run: { id: number; title: string; groups_enabled: boolean; version_is_disabled: boolean };
  sequences: DashboardSequence[];
  students: DashboardStudent[];
}

// ---- Mini-projects dashboard ----

export type MpGroupStatus = 'not_submitted' | 'awaiting_eval' | 'needs_revision' | 'accepted' | 'rejected';

export interface DashboardMpGroupEntry {
  group_id: number;
  group_name: string;
  group_is_disabled: boolean;
  status: MpGroupStatus;
  latest_submission: {
    id: number;
    submission_number: number;
    submitted_at: string | null;
    submitted_by: { user_id: number; full_name: string | null } | null;
    is_late: boolean;
    is_resubmission: boolean;
    file_size: number;
  } | null;
  latest_evaluation: {
    id: number;
    evaluated_at: string | null;
    evaluated_by: { user_id: number; full_name: string | null } | null;
    result: string;
    score: number | null;
    feedback_text: string | null;
    has_feedback_file: boolean;
  } | null;
}

export interface DashboardMpRow {
  id: number;
  title: string;            // NEW per §5.2 — populated from MiniProjectResponse.title
  block_id: number;
  block_order: number;
  block_title: string;
  is_published: boolean;
  first_submitted_at: string | null;
  soft_deadline: string | null;
  hard_deadline: string | null;
  resubmission_deadline: string | null;
  counts: {
    total_groups: number;
    not_submitted: number;
    awaiting_eval: number;
    needs_revision: number;
    accepted: number;
    rejected: number;
  };
  groups: DashboardMpGroupEntry[];
}

export interface DashboardMiniProjectsResponse {
  run: { id: number; title: string; groups_enabled: boolean };
  mini_projects: DashboardMpRow[];
}

// ---- Item drilldown ----

export interface SequenceItemScore { correct: number; total: number; }

export interface SequenceItemState {
  item_id: number;
  item_order: number;
  item_title: string;
  item_type: string;
  is_covered: boolean;
  last_score: SequenceItemScore | null;
  last_visited_at: string | null;
}

export interface SequenceItemStateResponse {
  sequence: { sequence_id: number; sequence_title: string; block_id: number; block_title: string };
  student: { user_id: number; full_name: string | null; email: string };
  items: SequenceItemState[];
}

// ---- Functions ----

export async function getProgressDashboard(
  runId: number,
  opts?: { signal?: AbortSignal },
): Promise<DashboardProgressResponse> {
  return api.get<DashboardProgressResponse>(`/api/runs/${runId}/dashboard/progress`, opts);
}

export async function getMiniProjectsDashboard(
  runId: number,
  opts?: { signal?: AbortSignal },
): Promise<DashboardMiniProjectsResponse> {
  return api.get<DashboardMiniProjectsResponse>(`/api/runs/${runId}/dashboard/mini-projects`, opts);
}

export async function getSequenceItemState(
  runId: number,
  userId: number,
  sequenceId: number,
  opts?: { signal?: AbortSignal },
): Promise<SequenceItemStateResponse> {
  return api.get<SequenceItemStateResponse>(
    `/api/runs/${runId}/students/${userId}/sequences/${sequenceId}/items`,
    opts,
  );
}

// ---- Status presentation constants (single source of truth) ----

export const STATUS_LABEL: Record<MpGroupStatus, string> = {
  not_submitted:  'Not submitted',
  awaiting_eval:  'Awaiting evaluation',
  needs_revision: 'Needs revision',
  accepted:       'Accepted',
  rejected:       'Rejected',
};

export const STATUS_ICON: Record<MpGroupStatus, string> = {
  not_submitted:  '○',
  awaiting_eval:  '…',
  needs_revision: '↻',
  accepted:       '✓',
  rejected:       '✗',
};

// Sort priority: lower = higher attention; teachers see most-urgent-first by default.
export const STATUS_PRIORITY: Record<MpGroupStatus, number> = {
  needs_revision: 0,
  rejected:       1,
  awaiting_eval:  2,
  not_submitted:  3,
  accepted:       4,
};
```

`StatusBadge.svelte` and `RunSubmissionTab.svelte` BOTH import these constants — no duplicated label/icon/priority literals anywhere else.

### 6.2 `RunDetailPage.svelte` — register 2 new tabs

Extend the `ActiveTab` union type:

```ts
type ActiveTab =
  | 'overview' | 'teachers' | 'groups' | 'roster' | 'mini-projects' | 'assets'
  | 'progress' | 'submission';
```

After the existing `assets` tab in the tab strip (matches the existing button pattern):

```svelte
<button role="tab" aria-selected={activeTab === 'progress'}
        onclick={() => (activeTab = 'progress')}>Progress</button>
<button role="tab" aria-selected={activeTab === 'submission'}
        onclick={() => (activeTab = 'submission')}>Submission</button>
```

Inside the tab-content block:

```svelte
{:else if activeTab === 'progress'}
  <RunProgressTab runId={run.id} />
{:else if activeTab === 'submission'}
  <RunSubmissionTab runId={run.id} />
```

(`course` is intentionally NOT passed; see §4 fixed-decisions row.) `onNavigateToTab` callers in existing tabs do not need updating — neither new tab is a navigation destination from existing tabs.

### 6.3 `RunProgressTab.svelte` — Progress heatmap

#### Props

```ts
let { runId }: { runId: number } = $props();
```

#### State

```ts
let data = $state<DashboardProgressResponse | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);

type Mode = 'coverage' | 'quiz';
let mode = $state<Mode>('coverage');

type SortKey = 'name' | 'group' | `seq:${number}`;
type SortDir = 'asc' | 'desc';
let sortKey = $state<SortKey>('name');           // default: student name asc
let sortDir = $state<SortDir>('asc');

let groupFilter = $state<number | 'all' | 'ungrouped'>('all');
let nameQuery = $state('');

let panelOpen = $state(false);
let panelTarget = $state<{ user_id: number; sequence_id: number } | null>(null);

let abortCtl: AbortController | null = null;     // for in-flight fetch cancellation
```

#### Data flow

`$effect`-driven fetch on mount AND on `runId` change. The cleanup snapshots the controller into a local `const` so a later reassignment via the manual Refresh doesn't cause the wrong controller to be aborted on next effect re-run:

```ts
$effect(() => {
  abortCtl?.abort();
  const ctl = new AbortController();    // local snapshot
  abortCtl = ctl;
  // Reset filter-and-panel state on runId change so a stale selection from the previous run
  // doesn't silently empty the new run's table (e.g., groupFilter=5 carrying into a run that
  // doesn't have group_id=5 → 0 rows match → user thinks the dashboard is broken).
  groupFilter = 'all';
  nameQuery = '';
  panelOpen = false;
  panelTarget = null;
  loading = true;
  error = null;
  getProgressDashboard(runId, { signal: ctl.signal })
    .then((res) => { data = res; loading = false; })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      error = String(err?.message ?? err);
      loading = false;
    });
  return () => ctl.abort();             // closes over THIS controller, not the latest one
});
```

The manual **Refresh** function (used by both the controls "Refresh" button and the error-banner "Retry" button) follows the same pattern:

```ts
function refresh() {
  abortCtl?.abort();
  abortCtl = new AbortController();
  loading = true;
  error = null;
  getProgressDashboard(runId, { signal: abortCtl.signal })
    .then((res) => { data = res; loading = false; })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      error = String(err?.message ?? err);
      loading = false;
    });
}
```

Notes:
- `data` is NOT reset to `null` during refresh — intentional stale-while-revalidate (the table remains visible behind the loading placeholder).
- A click during an in-flight initial load aborts the in-flight request before issuing the fresh one. (Without this, the old response could win and overwrite the new one.) Decided IN this spec: the refresh button is in v1 (see §12).
- **Unmount cleanup.** The `$effect` cleanup snapshots its own controller (correctly aborts when `runId` changes), but `refresh()` reassigns the module-level `abortCtl` to a new controller — so on COMPONENT UNMOUNT (tab switch, navigation away from `RunDetailPage`), the latest refresh-created controller would NOT be aborted by the effect cleanup alone. Add a terminating `$effect(() => () => abortCtl?.abort())` (no reactive deps, runs once on mount and its cleanup runs on unmount) to ensure any pending refresh request is aborted on teardown:

  ```ts
  $effect(() => {
    return () => abortCtl?.abort();  // unmount-only cleanup; complements the runId-tracking $effect above.
  });
  ```

- `RunSubmissionTab.svelte` (§6.4) declares an analogous `refresh()` function with the same shape (`getMiniProjectsDashboard` instead of `getProgressDashboard`) and the identical snapshot-in-cleanup `$effect` + unmount-cleanup `$effect`.

Filter+sort happens client-side in `$derived` over `data.students`. Mode switch and column sort do NOT re-fetch.

#### Derived rows

```ts
const visibleStudents = $derived.by(() => {
  if (!data) return [];
  let students = data.students;

  // Filter: group
  if (groupFilter === 'ungrouped') {
    students = students.filter((s) => s.group_id === null);
  } else if (typeof groupFilter === 'number') {
    students = students.filter((s) => s.group_id === groupFilter);
  }
  // Filter: search by name
  if (nameQuery.trim()) {
    const q = nameQuery.trim().toLowerCase();
    students = students.filter((s) =>
      (s.full_name ?? '').toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    );
  }

  // Sort (always with a stable name-tiebreak)
  students = [...students].sort((a, b) => compareStudents(a, b, sortKey, sortDir, mode));
  return students;
});
```

`compareStudents`:

- `'name'`: localeCompare on `full_name ?? email`.
- `'group'`: localeCompare on `group_name ?? ''` (so nulls sort to the front in asc).
- `'seq:<id>'`: ratio-compare on the corresponding coverage or quiz cell. **Missing-ratio sink**: cells whose ratio is missing (null) OR not-a-number (NaN from division by zero, e.g., zero-item sequence) are pushed to the BOTTOM regardless of sort direction. Implementation:
  ```ts
  function computeRatio(cell: { covered?: number; total?: number; correct?: number | null }, mode: Mode): number | null {
    if (mode === 'coverage') {
      if (!cell.total || cell.total === 0) return null;  // null or 0/0 → sink
      return cell.covered! / cell.total;
    }
    // quiz mode
    if (cell.total == null || cell.total === 0) return null;
    return (cell.correct ?? 0) / cell.total;
  }

  const aRatio = computeRatio(...);
  const bRatio = computeRatio(...);
  if (aRatio === null && bRatio === null) return tiebreakByName(a, b);
  if (aRatio === null) return 1;     // a sinks
  if (bRatio === null) return -1;    // b sinks
  return sortDir === 'asc' ? (aRatio - bRatio) : (bRatio - aRatio);
  ```
- Final tiebreak: `full_name` localeCompare (stable explicit fallback; does not rely on `Array.prototype.sort` engine stability).

#### Layout (Svelte template — sketch only, not literal code)

```
<div class="tab-container">
  {#if loading}<LoadingPlaceholder />{/if}
  {#if error}
    <div class="banner banner-error" role="alert">
      {error} <button onclick={refresh}>Retry</button>
    </div>
  {/if}

  {#if data}
    {#if data.run.version_is_disabled}
      <div class="banner banner-warning" role="status">
        This run's course version is disabled. Coverage data reflects last-known state.
      </div>
    {/if}

    <div class="controls">
      <fieldset class="mode-switch" role="group" aria-label="Heatmap mode">
        <button type="button"
                aria-pressed={mode === 'coverage'}
                onclick={() => mode = 'coverage'}>Coverage</button>
        <button type="button"
                aria-pressed={mode === 'quiz'}
                onclick={() => mode = 'quiz'}>Quiz</button>
      </fieldset>

      <select bind:value={groupFilter} aria-label="Filter by group">
        <option value="all">All groups</option>
        {#if hasUngroupedStudents}
          <option value="ungrouped">(Ungrouped)</option>
        {/if}
        {#each uniqueGroups as g (g.group_id)}
          <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
        {/each}
      </select>

      <input type="search" bind:value={nameQuery} placeholder="Search student" aria-label="Search student" />

      <button class="refresh-button" onclick={refresh} aria-label="Refresh">Refresh</button>
      <button class="csv-button" onclick={handleDownloadCSV} data-action="download-csv">Download CSV</button>
    </div>

    <div class="table-scroll">
      <table class="progress-grid">
        <thead>
          <tr class="block-row">
            <th class="sticky-name" scope="col" rowspan="2">
              <button onclick={() => toggleSort('name')}>Student {#if sortKey === 'name'}{sortDir === 'asc' ? '▲' : '▼'}{/if}</button>
            </th>
            <th class="sticky-group" scope="col" rowspan="2">
              <button onclick={() => toggleSort('group')}>Group {#if sortKey === 'group'}{sortDir === 'asc' ? '▲' : '▼'}{/if}</button>
            </th>
            {#each blockGroupedSequences as bg (bg.block_id)}
              <th class="block-header" scope="colgroup" colspan={bg.sequences.length}>{bg.block_title}</th>
            {/each}
          </tr>
          <tr class="seq-row">
            {#each data.sequences as seq (seq.sequence_id)}
              <th class="seq-header"
                  scope="col"
                  aria-sort={sortKey === `seq:${seq.sequence_id}` ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button onclick={() => toggleSort(`seq:${seq.sequence_id}`)}>
                  {seq.sequence_title}
                  {#if sortKey === `seq:${seq.sequence_id}`}{sortDir === 'asc' ? '▲' : '▼'}{/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each visibleStudents as s (s.user_id)}
            <tr class:disabled-row={s.user_is_disabled || s.group_is_disabled}>
              <th scope="row" class="sticky-name">
                {s.full_name ?? s.email}
                {#if s.user_is_disabled}<span class="badge-muted">disabled</span>{/if}
              </th>
              <td class="sticky-group">
                {s.group_name ?? '—'}
                {#if s.group_is_disabled}<span class="badge-muted">disabled</span>{/if}
              </td>
              {#each data.sequences as seq, i (seq.sequence_id)}
                <td class="cell" style={cellInlineStyle(s, i, mode)}>
                  <button class="cell-btn"
                          onclick={() => openPanel(s.user_id, seq.sequence_id)}
                          aria-label={cellAriaLabel(s, seq, i, mode)}>
                    {cellText(s, i, mode)}
                  </button>
                </td>
              {/each}
            </tr>
          {/each}
          {#if visibleStudents.length === 0}
            <tr><td colspan={data.sequences.length + 2} class="empty">
              {data.students.length === 0
                ? 'No students enrolled in this run.'
                : 'No matches for current filters.'}
            </td></tr>
          {/if}
        </tbody>
      </table>
    </div>

    {#if panelOpen && panelTarget}
      <DashboardSidePanel target={{ kind: 'progress', runId, ...panelTarget }} onClose={closePanel} />
    {/if}
  {/if}
</div>
```

#### Coverage/Quiz mode semantics

| Mode | Cell text | Background | Empty value semantics |
|---|---|---|---|
| `coverage` | `"{covered}/{total}"` (or `"—"` if `total === 0`) | `covered / total` ratio mapped through a red→yellow→green gradient | Same |
| `quiz` | `"{correct}/{total}"` (or `"—"` if `total === null`) | `correct / total` ratio same gradient | Same |

Gradient is set per-cell via inline custom property: `style="--cell-bg: hsl(<hue> 70% 80%)"` where `hue = 120 * ratio` (0 = red, 60 = yellow, 120 = green). The `.cell` CSS rule reads `background-color: var(--cell-bg, var(--surface-muted, #f3f4f6));`. Empty cells (no ratio) omit the inline var and fall back to `var(--surface-muted)` (add this token to `styles/base.css` if not present).

**Cell text color**: fixed dark for contrast against the pale 80%-lightness background: `color: var(--text, #1f2937);` (reuses existing `--text` token from `styles/base.css`). Verified contrast: `#1f2937` text on `hsl(0 70% 80%)` (≈ #e89898, red extreme) ≈ 7:1; on `hsl(120 70% 80%)` (≈ #a5e6a5, green) ≈ 9.5:1. White text would fail on the lighter parts of the gradient.

**`aria-label` for cells**: `"<student name>, <sequence title>: <coverage_or_quiz_text>"`. No `, open details` suffix — the wrapping `<button>` role makes "open details" implicit and would repeat 4400 times in a large grid for SR users. Empty cells use the button label `"<student name>, <sequence title>: no data"` so SR users hear something meaningful when traversing empty columns.

**Helper-function visibility** on `RunProgressTab.svelte`:

- **Imported** from `lib/dashboards.ts`: `getProgressDashboard`, `getSequenceItemState`, `STATUS_LABEL`, `STATUS_ICON`, `STATUS_PRIORITY` (the `STATUS_*` consts are unused on this tab but kept for symmetry with §6.4 import patterns; remove if linter complains).
- **Imported** from `lib/csvWrite.ts`: `toCSV`, `downloadCSV`, `sanitizeTitle`.
- **Local** to `RunProgressTab.svelte` (declared at component scope): `cellInlineStyle`, `cellAriaLabel`, `cellText`, `toggleSort`, `compareStudents`, `refresh()`, `openPanel`, `closePanel`, `handleDownloadCSV()` (renamed from `downloadCSV` to avoid shadowing the §6.7 import — builds the rows from the current filtered view, then calls the imported `downloadCSV(toCSV(rows, columns), filename)`), `uniqueGroups` (`$derived` — see snippet below), `hasUngroupedStudents` (`$derived` — `data?.students.some(s => s.group_id == null) ?? false`; gates the "(Ungrouped)" option in the group-filter dropdown per §6.3 Filters prose), `blockGroupedSequences` (`$derived`). The component should be self-contained — no external module exports.

**`uniqueGroups` derivation** (parallel to §6.4's pattern; consumer at line ~780 uses `{group_id, group_name, group_is_disabled}` field names):

```ts
const uniqueGroups = $derived.by(() => {
  const map = new Map<number, { group_id: number; group_name: string; group_is_disabled: boolean }>();
  for (const s of data?.students ?? []) {
    if (s.group_id == null) continue;  // "(Ungrouped)" option is hardcoded above; this loop dedupes the named groups.
    if (!map.has(s.group_id)) {
      map.set(s.group_id, {
        group_id: s.group_id,
        group_name: s.group_name ?? '',
        group_is_disabled: s.group_is_disabled ?? false,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.group_id - b.group_id);
});
```

The §6.4 derivation uses the same shape; the only difference is the source (`data.mini_projects[i].groups[]` vs. `data.students[]`).

#### Sort behavior on mode switch

When the user toggles `Coverage ↔ Quiz` and `sortKey` is `seq:<id>`, the SORT KEY is preserved but the VALUE it compares changes. Rows re-order accordingly. `sortDir` is preserved. (Cells with null ratios remain at the bottom regardless of direction — see the null-sink rule above.)

#### Sort behavior — column header clicks

- Click a column header → if it's already `sortKey`, toggle `sortDir`; else set `sortKey` to that column and `sortDir` to `'asc'`.
- `▲` / `▼` indicator appears next to the active sort column. `<th aria-sort>` is set to `'ascending' | 'descending' | 'none'` accordingly.
- **Default sort** on tab open: `sortKey: 'name'`, `sortDir: 'asc'`. The backend ships students ordered by `RunStudent.created_at`; the frontend re-sorts to name-alpha as the more teacher-friendly default. (This divergence is intentional; no user-facing toggle to use backend order.)

#### Frozen first column(s)

The first TWO columns (Student name, Group) are sticky. The name column is fixed-width to avoid layout shift between header and body rows. CSS references existing global tokens from `frontend/src/styles/base.css` (use `--bg` for surface; add `--surface-muted` if not yet present):

```css
.progress-grid { border-collapse: separate; border-spacing: 0; }
.sticky-name {
  position: sticky;
  left: 0;            /* LTR-only; RTL deferred per §2 */
  width: 14rem;       /* fixed; truncate with text-overflow if needed */
  background: var(--bg, #fff);
  z-index: 2;
}
.sticky-group {
  position: sticky;
  left: 14rem;        /* equals .sticky-name width */
  width: 10rem;
  background: var(--bg, #fff);
  z-index: 2;
}
.block-header, .seq-header {
  position: sticky;
  top: 0;
  background: var(--bg, #fff);
  z-index: 1;
}
.block-row .sticky-name, .block-row .sticky-group { top: 0; z-index: 3; }

/* Disabled rows: muted styling. */
.disabled-row { opacity: 0.55; font-style: italic; }

/* Muted "disabled" badge — used inline next to student/group names in body cells (both tabs). */
.badge-muted {
  display: inline-block;
  margin-left: 0.4em;
  padding: 0.05em 0.4em;
  font-size: 0.75em;
  font-style: normal;
  font-weight: 500;
  line-height: 1.3;
  color: var(--muted, #6b7280);
  background: var(--surface-muted, #f3f4f6);
  border-radius: 0.25em;
  vertical-align: middle;
}

/* Button reset for in-cell and in-header buttons (matches RunAssetsTab.svelte:972-979 .sort-btn). */
.cell-btn, .progress-grid th button {
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  padding: 0;
  cursor: pointer;
  text-align: inherit;
  width: 100%;
  height: 100%;
}
```

Hard-coded widths avoid the need for JS measurement; long names wrap or truncate via `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on the cell content.

#### Filters

- **Group dropdown** — populated from unique non-null group_ids in `data.students`. Options: "All groups" (default), "(Ungrouped)" (only when at least one student has `group_id: null`), and one per distinct group. Disabled groups render with `" (disabled)"` appended as `<option>` text (parenthetical-only — `<option>` cannot contain element children; see §11).
- **Search by name** — case-insensitive substring on `full_name ?? ''` and `email`.

Filters are AND-combined.

#### CSV export

Button at top right. On click, generate a CSV with these columns and trigger download. The header uses LITERAL text — no placeholders:

```
student_email, student_name, group_name,
"<Block A> — <Seq 1>: coverage_covered", "<Block A> — <Seq 1>: coverage_total",
"<Block A> — <Seq 1>: quiz_correct",    "<Block A> — <Seq 1>: quiz_total",
... (repeat per sequence in order)
```

One row per student (after filters apply — the export reflects what the user sees, not the entire dataset). For each sequence: 4 columns. CSV header text uses the same labels.

CSV is built via `lib/csvWrite.ts` `toCSV(...)` (see §6.7 for the contract — RFC 4180 quoting, UTF-8 BOM, CRLF, formula-injection guard).

**Filename**: `progress-{sanitizedTitle}-{YYYY-MM-DD}.csv`. `sanitizedTitle` is built via `sanitizeTitle(run.title, \`run-${run.id}\`)` — the `sanitizeTitle` helper is exported from `lib/csvWrite.ts` (see §6.7). A run title that's entirely outside the allowed character set (e.g., pure Cyrillic / CJK) sanitizes to empty → falls back to `run-{id}` so the filename is never just `progress--2026-05-31.csv` or all-underscores.

### 6.4 `RunSubmissionTab.svelte` — MP submission grid

#### Props

```ts
let { runId }: { runId: number } = $props();
```

#### State

```ts
let data = $state<DashboardMiniProjectsResponse | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);

type SortKey = 'group' | `mp:${number}`;
type SortDir = 'asc' | 'desc';
let sortKey = $state<SortKey>('group');
let sortDir = $state<SortDir>('asc');

let groupFilter = $state<number | 'all'>('all');

let panelOpen = $state(false);
// Discriminated subscription: when opening, parent passes both IDs AND objects.
let panelTarget = $state<{ mp: DashboardMpRow; entry: DashboardMpGroupEntry } | null>(null);

let abortCtl: AbortController | null = null;
```

Data fetch follows the same AbortController pattern as Progress, including the **stale-while-revalidate** semantics (§6.3 line ~691): when Refresh is clicked with prior `data` present, `data` is NOT reset to `null` — the table stays rendered while the loading placeholder appears, then re-renders with the new payload. The Submission tab's `$effect` body is structurally the same as §6.3's at lines ~655-679 — abort + new controller + state resets + fetch — with two adaptations: the endpoint becomes `getMiniProjectsDashboard`, and the reset block omits the `nameQuery` line because the Submission tab has no name-search input:

```ts
$effect(() => {
  abortCtl?.abort();
  const ctl = new AbortController();
  abortCtl = ctl;
  // Reset on runId change — same rationale as §6.3 (a stale groupFilter from the
  // previous run can silently empty the new run's grid).
  groupFilter = 'all';
  panelOpen = false;
  panelTarget = null;
  loading = true;
  error = null;
  getMiniProjectsDashboard(runId, { signal: ctl.signal })
    .then((res) => { data = res; loading = false; })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      error = String(err?.message ?? err);
      loading = false;
    });
  return () => ctl.abort();
});
```

Add the same unmount-only `$effect` here (parallel to §6.3 lines ~702-706 — same body, same rationale: terminates the latest `refresh()`-created `abortCtl` on component teardown so a tab-switch / navigation-away does not leave a pending mini-projects-dashboard request running against an unmounted component):

```ts
$effect(() => {
  return () => abortCtl?.abort();  // unmount-only cleanup; complements the runId-tracking $effect above.
});
```

`refresh()` is declared with the same body shape as §6.3 lines ~675-688, swapping `getProgressDashboard` for `getMiniProjectsDashboard`; `refresh()` does NOT reset filter state (only the `$effect` on `runId` change does). The `sortKey`/`sortDir` (and §6.3's `mode`) are deliberately NOT reset on `runId` change — they represent cross-run user preferences. If a stale `sortKey === 'mp:<id>'` references an MP that doesn't exist in the new run, the comparator returns `null` for all rows (null-sink rule), effectively no-op until the user re-clicks a column.

#### Status enum sort order

When sorting by an MP column, statuses are ranked by **teacher action priority** using `STATUS_PRIORITY` imported from `lib/dashboards.ts` (see §6.1). `asc` direction puts `needs_revision` at the top (most attention needed); `desc` puts `accepted` at the top.

Rationale: a teacher scanning a column wants to see "what needs my attention" first. Alphabetical sort would be useless; semantic priority matches the use case.

#### Status colors (DARK text on LIGHT background — all pairs ≥ 4.5:1 contrast)

| Status | Background | Text color | Icon | Label |
|---|---|---|---|---|
| `not_submitted` | `#f3f4f6` (gray-100) | `#374151` (gray-700) | `○` | "Not submitted" |
| `awaiting_eval` | `#dbeafe` (blue-100) | `#1e40af` (blue-800) | `…` | "Awaiting evaluation" |
| `needs_revision` | `#fef3c7` (amber-100) | `#92400e` (amber-800) | `↻` | "Needs revision" |
| `accepted` | `#d1fae5` (green-100) | `#065f46` (green-800) | `✓` | "Accepted" |
| `rejected` | `#fee2e2` (red-100) | `#991b1b` (red-800) | `✗` | "Rejected" |

(Tailwind 100/700-800 palettes are known-good for AA contrast on white-page backgrounds.)

Encoded as CSS custom properties on `:root` in `frontend/src/styles/base.css` (the file holding the existing global tokens like `--bg`, `--text`, `--primary`, etc.). **Variable names mirror the status enum verbatim** (dashes replacing underscores) so `StatusBadge.svelte` can map mechanically:

```css
:root {
  --status-not-submitted-bg: #f3f4f6;  --status-not-submitted-fg: #374151;
  --status-awaiting-eval-bg: #dbeafe;  --status-awaiting-eval-fg: #1e40af;
  --status-needs-revision-bg: #fef3c7; --status-needs-revision-fg: #92400e;
  --status-accepted-bg:      #d1fae5;  --status-accepted-fg:      #065f46;
  --status-rejected-bg:      #fee2e2;  --status-rejected-fg:      #991b1b;
}
```

`StatusBadge.svelte` uses the convention `status.replace(/_/g, '-')` to build the variable name, so the mapping is mechanical (no per-status code branch needed). See §6.6.

Cell content: a `<StatusBadge>` component (see §6.6) renders icon + label. Color + icon + text together address color-blind users.

#### Layout

The Submission tab uses the same outer shell as Progress (§6.3) — error banner, controls row (Refresh + Download CSV + group-filter dropdown when applicable), table, then side panel. Only the table markup differs. The pattern mirrors §6.3: three independent `{#if}` blocks (banner / loading / data) so a Refresh failure surfaces the error banner above the stale table (NOT swallowed). Group-filter options derive from a `$derived uniqueGroups` over `data.mini_projects[i].groups[]` — there is no top-level `data.groups` field on the response (parallel to §6.3's `uniqueGroups` from `data.students`):

```svelte
<script lang="ts">
  // ... earlier state from §6.4 reactive block ...

  // Derived list of unique groups across all MPs, ordered by group_id ascending.
  // Each entry has the same shape as `mini_projects[i].groups[j]`'s group fields,
  // collapsed to a Map-and-back to dedupe.
  const uniqueGroups = $derived.by(() => {
    const map = new Map<number, { group_id: number; group_name: string; group_is_disabled: boolean }>();
    for (const mp of data?.mini_projects ?? []) {
      for (const g of mp.groups) {
        if (!map.has(g.group_id)) {
          map.set(g.group_id, {
            group_id: g.group_id,
            group_name: g.group_name,
            group_is_disabled: g.group_is_disabled,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.group_id - b.group_id);
  });
</script>

{#if error}
  <div class="banner banner-error" role="alert">
    {error} <button onclick={refresh}>Retry</button>
  </div>
{/if}

{#if loading}
  <LoadingPlaceholder />
{/if}

{#if data}
  {#if data.run.groups_enabled === false}
    <p class="empty-state">This run has groups disabled. Mini-project status by group is not applicable.</p>
  {:else}
    <div class="controls">
      <label>
        Group:
        <select bind:value={groupFilter}>
          <option value="all">All groups</option>
          {#each uniqueGroups as g (g.group_id)}
            <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
          {/each}
        </select>
      </label>
      <button class="refresh-button" onclick={refresh} aria-label="Refresh">Refresh</button>
      <button class="csv-button" onclick={handleDownloadCSV}>Download CSV</button>
    </div>

    <table class="submission-grid">
      <!-- thead / tbody below -->
    </table>

    {#if panelOpen && panelTarget}
      <DashboardSidePanel target={{ kind: 'submission', ...panelTarget }} onClose={closePanel} />
    {/if}
  {/if}
{/if}
```

Error and loading patterns mirror §6.3 (three independent `{#if}` blocks): a Refresh that fails after data is loaded surfaces the error banner ABOVE the stale table — the user sees both the prior data AND the error, not just one or the other. Stale-while-revalidate: when `data` is populated and Refresh is clicked, the table stays rendered while the new fetch is in-flight; `data` is never reset to `null`.

The `{#if panelOpen ...}` side-panel block lives inside the `{:else}` branch — it is unreachable when `groups_enabled === false` because no cells exist to click. Table markup:

```svelte
<thead>
  <tr class="mp-counts-row">
    <th class="sticky-group" scope="col"></th>
    {#each data.mini_projects as mp (mp.id)}
      <th class="mp-counts" scope="col">
        <small>{formatCountsLine(mp.counts)}</small>
      </th>
    {/each}
  </tr>
  <tr class="mp-titles-row">
    <th class="sticky-group" scope="col">
      <button onclick={() => toggleSort('group')}>Group {#if sortKey === 'group'}{sortDir === 'asc' ? '▲' : '▼'}{/if}</button>
    </th>
    {#each data.mini_projects as mp (mp.id)}
      <th class="mp-title-header"
          scope="col"
          aria-sort={sortKey === `mp:${mp.id}` ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button onclick={() => toggleSort(`mp:${mp.id}`)}>
          {mp.title}{#if sortKey === `mp:${mp.id}`} {sortDir === 'asc' ? '▲' : '▼'}{/if}
        </button>
        <small class="block-subtitle">{mp.block_title}</small>
      </th>
    {/each}
  </tr>
</thead>
<tbody>
  {#each visibleGroups as g (g.group_id)}
    <tr class:disabled-row={g.group_is_disabled}>
      <th scope="row" class="sticky-group">
        {g.group_name}
        {#if g.group_is_disabled}<span class="badge-muted">disabled</span>{/if}
      </th>
      {#each data.mini_projects as mp (mp.id)}
        {@const cell = mp.groups.find((x) => x.group_id === g.group_id)}
        <td class="status-cell">
          {#if cell}
            <button class="status-cell-btn"
                    onclick={() => openPanel(mp, cell)}
                    aria-label={`${g.group_name}, ${mp.title}: ${STATUS_LABEL[cell.status]}`}>
              <StatusBadge status={cell.status} />
            </button>
          {:else}
            <span aria-label="No data" class="empty-cell">—</span>
          {/if}
        </td>
      {/each}
    </tr>
  {/each}
</tbody>
```

(The `DashboardSidePanel` render block is in the outer shell above — see the first layout snippet in this section.) `visibleGroups` is derived from the union of all `mini_projects[i].groups[].group_id`, sorted/filtered. The `groups_enabled === false` branch is handled in the outer shell.

Helper-function visibility on the Submission tab (mirrors §6.3 line ~871):

- **Imported** from `lib/dashboards.ts`: `STATUS_LABEL`, `STATUS_ICON`, `STATUS_PRIORITY`, `getMiniProjectsDashboard`.
- **Imported** from `lib/csvWrite.ts` (per §6.7 exports): `toCSV`, `downloadCSV`, `sanitizeTitle`.
- **Local** to `RunSubmissionTab.svelte` (declared at component scope): `refresh()` (body shape per §6.3 lines ~675-688, swapping `getProgressDashboard` for `getMiniProjectsDashboard`), `handleDownloadCSV()` (builds the long-format rows from the current filtered view, then calls the imported `downloadCSV(toCSV(rows, columns), filename)` from §6.7; renamed from `downloadCSV` to avoid shadowing the import), `openPanel(mp, entry)` (sets `panelOpen = true; panelTarget = { mp, entry }`), `closePanel()` (sets `panelOpen = false; panelTarget = null`), `compareGroups(a, b)` (sort comparator), `toggleSort(key)`, `uniqueGroups` (`$derived` — see snippet above), `formatCountsLine(counts)` (small-text summary "8 groups · 1 awaiting · 1 revision · 0 rejected", joins non-zero counts with `·`). Same self-contained component convention as Progress tab.

The MP column header shows the MP `title` (from §5.2) as primary label and `block_title` as small subtitle for context.

#### Filters

- **Group dropdown** — single group at a time, or "All groups" (no "Ungrouped" option here, since groupless students wouldn't be in any MP row).

(No search-by-name on the Submission tab — rows are groups, not students.)

#### CSV export — long format

One row per (group, MP) cell:

```
group_name, mp_title, mp_block_title, status,
latest_submission_number, latest_submission_at, latest_submission_by, is_late, is_resubmission, file_size,
latest_evaluation_at, latest_evaluation_by, evaluation_result, evaluation_score, has_feedback_file
```

Built via `lib/csvWrite.ts` `toCSV(...)`.

**Filename**: `submissions-{sanitizedTitle}-{YYYY-MM-DD}.csv` (same `sanitizeTitle` helper as §6.3; fallback `run-{id}` for all-stripped titles).

Empty cells (e.g., `latest_submission_at` when `status === 'not_submitted'`) export as empty strings. The `evaluation_result` column exports the raw enum value (`accepted`, `rejected`, `major_revision`, `minor_revision`, ...) — not the human label — for downstream analytics.

### 6.5 `DashboardSidePanel.svelte`

```ts
type ProgressPanelTarget = {
  kind: 'progress';
  runId: number;
  user_id: number;
  sequence_id: number;
};

type SubmissionPanelTarget = {
  kind: 'submission';
  mp: DashboardMpRow;
  entry: DashboardMpGroupEntry;
};

type PanelTarget = ProgressPanelTarget | SubmissionPanelTarget;

let { target, onClose }: { target: PanelTarget; onClose: () => void } = $props();
```

This resolves the rev 1 contradiction: Progress targets carry IDs (panel fetches); Submission targets carry whole objects (no fetch — data is already in the parent).

#### Behavior

- Slides in from the right via CSS transition.
- Backdrop is semi-transparent; clicking the backdrop closes.
- Escape key closes. Implemented via `<svelte:window onkeydown>` on the panel (matches `RosterImportModal.svelte:111-116` pattern); `FocusTrap` only manages Tab/Shift+Tab — Escape is wired separately by this component.
- Focus-trapped via `<FocusTrap>` (existing component at `frontend/src/components/ui/FocusTrap.svelte`).
- Header has "✕ Close" button.
- **Focus return on close**: `FocusTrap.svelte` snapshots `document.activeElement` at mount time and restores it in its `$effect` cleanup (verify at `frontend/src/components/ui/FocusTrap.svelte:46-48`). If the triggering row has been filtered out while the panel was open (rare — filter is a separate user action), the snapshot node is no longer in the DOM; browser focus falls back to `<body>`. Acceptable for v1.
- Pattern: slide-in side drawer (NOT centered modal). Deliberate divergence from existing modal pattern — drilldown is a peek-and-back-to-list, not a focused-edit task. Width: `min(640px, 90vw)`. Document this once in `DashboardSidePanel.svelte` JSDoc.

#### Content — `kind === 'progress'`

On open (or when `target.user_id` / `target.sequence_id` changes — the `$effect` tracks the individual ID properties, not the `target` object reference, in case the parent reassigns to a new object with the same IDs), fetches `getSequenceItemState(runId, user_id, sequence_id)` with a fresh `AbortController`. Previous in-flight fetch is aborted to avoid race. The `$effect` cleanup runs BEFORE the new effect body (Svelte 5 semantics), so abort + new-fetch in one cycle is correct. Renders:

```
{student.full_name ?? student.email}
{block_title} — {sequence_title}

[Items list]
| # | Item title         | Type   | Covered | Quiz score |
|---|--------------------|--------|---------|------------|
| 1 | What is regression?| page   | ✓       | —          |
| 2 | Estimation quiz    | quiz   | ✓       | 6/8        |
| 3 | Practice problem   | quiz   | ✗       | —          |
```

Empty items list: "No items in this sequence." Fetch error (incl. 404): "Item details unavailable. The dashboard may be out of date — Refresh."

#### Content — `kind === 'submission'`

No fetch — `target.mp` and `target.entry` are already populated by the parent. Renders:

```
{mp.title}
{mp.block_title}
{group_name}

[StatusBadge: <status>]

Submission
  Number:        {submission_number}
  Submitted at:  {formatLocalWithTz(submitted_at)}
  Submitted by:  {submitted_by?.full_name ?? submitted_by?.user_id ?? "—"}
  Late:          {is_late ? "Yes" : "No"}
  Resubmission:  {is_resubmission ? "Yes" : "No"}
  File size:     {formatFileSize(file_size)}
  [Download submission]   → /api/submissions/{submission.id}/file

Evaluation
  Evaluated at:  {formatLocalWithTz(evaluated_at)}
  Evaluated by:  {evaluated_by?.full_name ?? evaluated_by?.user_id ?? "—"}
  Result:        {result}
  Score:         {score ?? "—"}
  Feedback:      {feedback_text or "—"}
  {#if has_feedback_file}[Download feedback file]   → /api/evaluations/{evaluation.id}/feedback-file{/if}

[If status === 'not_submitted']: "Not submitted yet." (replaces the Submission/Evaluation blocks entirely)
[If status === 'awaiting_eval']: render the Submission block only; omit the Evaluation block (the status badge already conveys "Awaiting evaluation", no redundant text).
```

Download URLs verified at:
- Submission file: `backend/mathion/api/submissions.py:286` — `/api/submissions/{sid}/file`.
- Feedback file: `backend/mathion/api/evaluations.py:205` — `/api/evaluations/{eid}/feedback-file`.

Reuse `formatLocalWithTz` from `lib/datetime.ts`. Reuse `formatFileSize` from `lib/format.ts` (existing project helper — the spec previously misnamed it `humanFileSize`; the actual name is `formatFileSize`).

### 6.6 `StatusBadge.svelte` (NEW small reusable component)

Imports `STATUS_LABEL` and `STATUS_ICON` from `lib/dashboards.ts` (single source of truth — see §6.1). No locally-declared label/icon constants.

Props:
```ts
import { STATUS_LABEL, STATUS_ICON, type MpGroupStatus } from '../../lib/dashboards';
let { status }: { status: MpGroupStatus } = $props();
const cssKey = status.replace(/_/g, '-');
```

Renders:
```svelte
<span class="status-badge" data-status={status} style="--badge-bg: var(--status-{cssKey}-bg); --badge-fg: var(--status-{cssKey}-fg);">
  <span class="icon" aria-hidden="true">{STATUS_ICON[status]}</span>
  <span class="label">{STATUS_LABEL[status]}</span>
</span>
```

Styling:
```css
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 2px;
  background-color: var(--badge-bg);
  color: var(--badge-fg);
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
}
.status-badge .icon { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols', sans-serif; }
```

The `--badge-bg` / `--badge-fg` indirection lets the badge's own styles reference one variable name per side, while the actual mapping `status → --status-{kebab}-bg/fg` lives in `:root` (§6.4). The mapping is mechanical (`status.replace(/_/g, '-')`).

**Icon glyph fallback.** `↻` (U+21BB) is missing from some default font stacks. The CSS above pins a symbols-aware font family for the icon span; if an impl-time smoke check reveals tofu boxes, replace the unicode glyphs with inline SVG sized `1em`. (Plan task can defer this decision to first manual eyeball.)

Tests (`tests/StatusBadge.svelte.test.ts`): one test per status that asserts (a) rendered icon and label content, (b) `data-status` attribute, (c) the inline `style` attribute contains the expected `--badge-bg`/`--badge-fg` references.

### 6.7 `lib/csvWrite.ts` (NEW CSV serializer module)

```ts
// frontend/src/lib/csvWrite.ts

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
}
// Booleans are serialized as the literal strings "true" / "false" before the
// formula-injection guard + RFC 4180 quoting pass. Used by Submission CSV columns
// like `is_late`, `is_resubmission`, `has_feedback_file`.

export interface CsvOptions {
  /** Prepend UTF-8 BOM for Excel compatibility. Default: true. */
  bom?: boolean;
  /** Line ending. Default: '\r\n' (RFC 4180). */
  newline?: '\n' | '\r\n';
}

/**
 * Serialize rows to RFC 4180 CSV with OWASP formula-injection protection.
 *
 * Two-step transformation per value:
 *   1. **Formula-injection guard (FIRST)**: if the stringified value starts with
 *      any of `=`, `+`, `-`, `@`, `\t`, `\r`, prepend a single apostrophe `'`.
 *      Excel/LibreOffice treat the apostrophe as a literal-text prefix and do
 *      NOT execute the value as a formula. RFC-4180 quoting alone is NOT
 *      sufficient — Excel ignores quotes when evaluating cell contents.
 *   2. **RFC 4180 quoting (SECOND)**: enclose in double quotes if EITHER
 *      (a) step 1 prepended an apostrophe (i.e., the original value triggered
 *      the formula-injection guard) — guarded values are ALWAYS quoted so the
 *      test list assertion "leading `=`/`+`/`-`/`@`/`\t`/`\r` → apostrophe-prefixed
 *      AND quoted" holds uniformly, OR
 *      (b) the value contains any of comma, double quote, CR, LF.
 *      Internal double quotes are doubled. Otherwise emit unquoted.
 *
 * - null/undefined → empty string (unquoted, no apostrophe).
 * - All non-null/undefined values are stringified first (via `String(value)`),
 *   then the formula-injection guard rule applies UNIFORMLY to the stringified
 *   form. This means negative numbers (e.g., `-3`) start with `-` and DO get
 *   the apostrophe prefix → emitted as `'-3` (Excel displays `-3`; pandas / csv
 *   module readers see the literal apostrophe and may need `.lstrip("'")` to
 *   recover the original value). Acceptable tradeoff vs. losing formula-injection
 *   protection.
 * - First line is the header row.
 * - UTF-8 BOM (﻿) prepended by default for Excel compatibility on Windows.
 * - Line ending defaults to `\r\n` (RFC 4180).
 *
 * Downstream-tool note: Excel hides the apostrophe in cells; pandas / Python's
 * csv module surface it. Consumers parsing the CSV programmatically should
 * strip a single leading apostrophe to round-trip the original value.
 */
export function toCSV<Row>(rows: Row[], columns: CsvColumn<Row>[], opts?: CsvOptions): string {
  // implementation: escape per the rules above, join with newline
}

/**
 * Trigger a browser download for the given CSV text.
 *
 * Creates a Blob with type 'text/csv;charset=utf-8' and an <a download> click.
 */
export function downloadCSV(csvText: string, filename: string): void {
  // implementation: Blob + URL.createObjectURL + temp <a download> click
}

/**
 * Sanitize a free-form title into a filesystem-safe filename fragment.
 *
 * - Strips characters outside [A-Z a-z 0-9 space - _] (so Cyrillic / CJK content disappears).
 * - Collapses whitespace runs to single underscore.
 * - Truncates to 60 chars.
 * - Collapses underscore runs and trims leading/trailing underscores.
 * - Returns `fallback` if the result is empty (e.g., pure non-ASCII input).
 *
 * Used by both Progress and Submission CSV-export filename construction.
 */
export function sanitizeTitle(title: string, fallback: string): string {
  let s = title.replace(/[^A-Za-z0-9 \-_]/g, '_').replace(/\s+/g, '_').slice(0, 60);
  s = s.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
  return s || fallback;
}
```

Tests (`tests/csvWrite.test.ts`):
- Plain alphanumeric values → no quotes, no prefix.
- Embedded comma → quoted.
- Embedded quote → quoted + doubled internal quotes.
- Embedded CR/LF → quoted.
- Leading `=`, `+`, `-`, `@`, `\t`, `\r` → APOSTROPHE-prefixed AND quoted (formula-injection guard test asserts the literal `'=...` output, not just the quoting).
- null/undefined → empty.
- BOM prefix on by default; off when `bom: false`.
- Newline default is `\r\n`; configurable via `newline: '\n'`.
- Number serialization.
- Boolean serialization → unquoted literal `true` / `false` (neither contains a formula-injection trigger char nor an RFC 4180 trigger char, so no apostrophe-prefix and no quotes). Protects rev 11 fix #3 (the `CsvColumn.value` type-widening to include `boolean`).
- Header row first.
- Test note: `URL.createObjectURL` and anchor-click are mocked via `vi.stubGlobal` in the `downloadCSV` test; assertions verify the anchor's `download` attribute matches the passed filename and the Blob's type is `'text/csv;charset=utf-8'`. jsdom no-ops the actual download — that's expected.

`csv.ts` is unchanged — it remains the roster-import parser (`parseCsv`, `CsvRow`, `CsvParseResult`).

---

## 7. Edge cases

| Scenario | Behavior |
|---|---|
| Run with zero students | Progress tab: table with sequences headers, empty tbody with placeholder "No students enrolled in this run." Submission tab: placeholder "No groups in this run." |
| Run with no mini-projects | Submission tab: placeholder "No mini-projects in this run." Progress tab: unaffected. |
| Run with `groups_enabled: false` | Progress tab: students appear with `group_name: "—"`; group column still shown; "(Ungrouped)" filter option becomes the default-applicable one. Submission tab: placeholder "This run has groups disabled. Mini-project status by group is not applicable." |
| Run with zero sequences (empty pinned version) | Progress tab: empty headers + empty tbody, placeholder "This course version has no sequences yet." |
| Disabled group | Body cells (both tabs): group name rendered with a `<span class="badge-muted">disabled</span>` badge; rows still visible. Group filter dropdown lists the group with a `" (disabled)"` parenthetical inside the `<option>` (browser limitation — `<option>` cannot contain element children). See §11. |
| Disabled user | Progress tab body row: student name rendered with the `<span class="badge-muted">disabled</span>` badge; row gets `.disabled-row` (muted italic); coverage/quiz cells still rendered. |
| Disabled course version | Progress tab: yellow banner at top. Submission tab: no banner (groups/MPs aren't versioned). |
| Sequence with zero items | Progress cell renders `"—"` in gray. Side panel for that cell shows "No items in this sequence." |
| Sequence with no quiz items in Quiz mode | All cells in that column render `"—"` in gray. Sorting by that column treats all values as null and sinks them to the bottom (per §6.3 null-sink rule). Banner above table when sorted by such a column: "This column has no quiz items; rows are ordered alphabetically." |
| Quiz item with no attempt (per-item drilldown) | Quiz cell renders `"—"`. (Distinct from the aggregated dashboard cell which may sum to `"0/8"` if there are 1+ quiz items in the sequence — see §6.3 Coverage/Quiz mode semantics and Phase 7c convention.) |
| Filter excludes all rows | Empty-tbody placeholder: "No matches for current filters." |
| Mode toggle with active sort by a no-quiz sequence | Coverage→Quiz: rows by that column move to "ties" since all values become null; secondary tiebreak by name applies. |
| Panel target user deleted between dashboard fetch and drilldown click | Drilldown fetch returns 404 → panel shows "Item details unavailable. The dashboard may be out of date — Refresh." |
| Version re-pinned between dashboard fetch and drilldown click | Same as above — drilldown 404, same message. |
| Teacher loses RunTeacher role mid-session | Next fetch returns 403 → error banner "You no longer have access to this run." User can navigate away via the rest of the page. |
| Side panel race: user clicks cell A then cell B before A returns | Panel uses fresh AbortController per open; A's fetch is aborted. Panel content displays B's data. |
| 5xx on dashboard load | Tab content shows error banner with Retry button (Retry re-runs the fetch). |
| Rate limit on dashboard load | Same as 5xx — error banner. |
| Concurrent fetch (user clicks tab repeatedly) | AbortController in the `$effect`: cancel in-flight request on each re-run. |
| Browser back/forward changes activeTab in URL | Out of scope — Slice A doesn't deep-link tab state; this slice doesn't either. |

---

## 8. Migration / data

No DB schema changes. No Alembic migration.

---

## 9. Backward compatibility

- Existing `/dashboard/progress` and `/dashboard/mini-projects` endpoints — `/dashboard/mini-projects` is additively extended to include `title` per MP (§5.2). Existing clients ignore unknown keys.
- New endpoint `/api/runs/{rid}/students/{uid}/sequences/{sid}/items` is additive.
- Frontend: `RunDetailPage.svelte` adds 2 new tabs. Existing tabs unchanged. Older bookmarked URLs to `/courses/{slug}/runs/{rid}` still open the page; the default `activeTab` selection (Overview) is preserved. `ActiveTab` union widening is additive.

---

## 10. Performance

### Backend

- Existing endpoints already verified non-N+1 in Phase 7c.
- New `/sequences/{sid}/items` endpoint: 4 sequential ORM queries (run-load, sequence+block, student membership, items+LEFT JOIN UIS). Item count per sequence is small (typically 3-8); response payload ≤2 KB.
- Sync FastAPI + sync SQLAlchemy → no async parallelization; the 4 queries fire sequentially. Total < 50ms on Postgres for typical row counts.
- `/dashboard/mini-projects` additive `title` field is a Python-side dict assignment, no extra query.

### Frontend

- Progress dashboard payload for largest expected run (200 students × 20 sequences) ≈ 50 KB gzipped.
- DOM size: 200 rows × 22 cells = 4400 `<td>` (each containing a `<button>`). Modern browsers render this comfortably in <100ms.
- Sort/filter on `visibleStudents` recomputes on `$derived` change. Worst case `O(N log N)` over 200 rows ≈ negligible.
- Side panel drilldown fetch is on-demand only.

### CSV generation

- Computed client-side in `csvWrite.ts`. For 200 students × 20 sequences × 4 columns ≈ 16,000 cells. Generation <100ms in browser. Download is local Blob URL with explicit BOM for Excel compatibility.

---

## 11. Accessibility

- Tab buttons follow the existing `RunDetailPage` pattern (`role="tab"` + `aria-selected`).
- Mode switcher uses `role="group"` + `<button aria-pressed>` (not `radiogroup`/`radio`) — avoids the complexity of arrow-key navigation and matches the project's existing pattern of "toggleable buttons" elsewhere.
- Column headers are `<button>` inside `<th>` so they're focusable AND keyboard-activatable (`Enter`/`Space`); the `<th>` carries `scope="col"` (or `scope="colgroup"` for the block-spanning row) and `aria-sort` is mapped to `'ascending' | 'descending' | 'none'`.
- Body row-headers (the sticky student-name cell) use `<th scope="row">` for screen-reader row/column intersection.
- Heatmap cells: `<button>` INSIDE `<td>`. The button has `aria-label="<student name>, <sequence title>: <coverage_or_quiz_text>"` (no ", open details" suffix — the `<button>` role makes the action implicit; 4400 cells × repeated suffix is verbose for SR users; see §6.3 for the empty-cell variant). The wrapping `<td>` keeps its implicit `cell` semantics.
- Status badges: text label included alongside the icon. Color is supplementary, not the sole signal. All 5 background/text pairs ≥ 4.5:1 contrast (verified hex values in §6.4 table).
- Empty cells (`—`): `<span aria-label="No data">—</span>` (announced as "No data", not as "em dash").
- Disabled user/group: visual cue (`<span class="badge-muted">disabled</span>` badge next to the name in every body cell context, both tabs) + `aria-label` includes "disabled" suffix. The ONLY place we use a `' (disabled)'` parenthetical text fallback is inside the group-filter `<option>` element, because `<option>` cannot contain element children — `<option>` text-only is a browser limitation, not a style choice.
- Side panel: focus moves to the panel on open (managed by `FocusTrap`); Escape closes via `<svelte:window onkeydown>`; focus returns to the triggering cell button on close (via `FocusTrap.previousFocus`).
- Empty-state messages are perceivable (visible text, not display:none).
- CSV download button has accessible label.
- **Security note (probe-leak):** the new endpoint's 404(run) → 403(auth-fail) → 404(student/sequence) ordering means an authenticated user can observe run-ID existence via 404 vs 403 differential. This is the existing project convention (also true for `/dashboard/progress` and `/dashboard/mini-projects`); accepted tradeoff. The new endpoint additionally uses a uniform `"Resource not found"` detail string to prevent further enumeration via detail-string diffing — the existing two endpoints still leak via `"Run not found"`. Tracked for a future security pass.

---

## 12. Open questions / explicit deferrals

- **Multi-column sort** — out of scope v1. If teachers ask, add as a future enhancement.
- **Sort state in URL** — would let teachers share filtered views; deferred.
- **Per-cell long-press / right-click context menu** — deferred.
- **Histogram / summary statistics row** — deferred to a future "Stats" sub-section if requested.
- **Date-windowed views** ("how were they doing last week?") — deferred.
- **Color scheme customization** — fixed for v1 (status palette + heatmap gradient are baked).
- **Server-side CSV streaming** — deferred; v1 generates client-side.
- **"Open in new tab" affordance on side panel** — could let teachers compare two cells side-by-side. Deferred.
- **Auto-refresh** — deferred. Static fetch on tab open / manual Refresh button.
- **Status enum sort priority** — fixed for v1 as `needs_revision > rejected > awaiting_eval > not_submitted > accepted` (most attention first). Future iteration could let teachers reorder.

**Resolved in rev 2 (no longer open):**
- ~~Refresh button — yes, v1 (manual button next to Download CSV).~~
- ~~MP title field — present via §5.2 additive change to `/dashboard/mini-projects`.~~
- ~~Submission download URL — pinned in §6.5.~~
- ~~`csv.ts` extension — replaced by new `lib/csvWrite.ts` module (§6.7).~~

---

## 13. Tests

### Backend tests

#### New file `backend/tests/test_dashboard_item_drilldown.py`

15 tests per §5.1. Use the existing `_publish_run` helper pattern from `test_dashboard_progress.py:9-19` for fixtures.

#### Extension to `backend/tests/test_dashboard_mini_projects.py`

1 new test: `test_mini_projects_dashboard_includes_mp_title` — asserts the response includes `title` per MP row.

### Frontend tests

#### `frontend/src/tests/dashboards.test.ts`

- `getProgressDashboard` URL + method + signal-threading (one test).
- `getMiniProjectsDashboard` URL + method + signal-threading.
- `getSequenceItemState` URL + method + signal-threading.
- **Response-shape conformance tests** (fetch is mocked at the GLOBAL `fetch` layer via `vi.stubGlobal('fetch', mockFetch(status, body))` — the established project pattern, see `frontend/src/tests/runGroups.test.ts:10-19`. NOT at any "api" layer abstraction; the project has no api-layer mocking helper). Three tests, one per endpoint: mock the literal-shaped JSON response per the §6.1 interface and runtime-assert that the consumer extracts all expected keys with the expected types. TS compile-time checks don't catch backend renames; these mock-vs-consumer conformance tests do (within the assumption that the mock matches the backend — caveat: real cross-system contract tests would require running the backend in an integration suite, out of scope for v1).

#### `frontend/src/tests/RunProgressTab.svelte.test.ts`

Use a `mountProgressTab(extra)` helper (per the `mountMpTab` pattern in `RunMiniProjectsTab.svelte.test.ts:44-68`).

- Loading state renders LoadingPlaceholder.
- Error state renders error banner with retry.
- Empty-students state renders placeholder text.
- Empty-sequences state renders placeholder text.
- Coverage mode: cells render `{covered}/{total}` text; inline `--cell-bg` style set per ratio.
- Quiz mode: cells render `{correct}/{total}` text; null quiz cells render `—`.
- Mode toggle: switching mode updates rendered cells.
- Filter by group: dropdown change filters visible rows.
- Filter by "ungrouped": only `group_id: null` students visible.
- Search by name: input narrows rows on each keystroke (matches `full_name` AND `email`).
- Sort by name: click "Student" header → toggle direction; aria-sort attribute updates.
- Sort by group: click "Group" header.
- Sort by sequence column: click → rows reorder; null cells sink to bottom regardless of direction.
- Sort persistence across mode toggle: sort key preserved; values update.
- Cell click: opens side panel with progress `target` shape (mock `getSequenceItemState`).
- Disabled user: row has "disabled" badge; text content correct.
- Disabled version: warning banner renders at top.
- Sticky first column CSS classes applied.
- Refresh button: click triggers refetch.
- Stale-while-revalidate: with prior `data` populated, click Refresh — table stays rendered (rows still visible) while loading placeholder appears; `data` is NOT reset to `null` during refresh. Documented intent (§6.3 line 691).
- Retry-after-error: with error banner showing, click Retry — `error` clears, `loading` flips to `true`, and on mocked-success rerender the table populates from null→rows.
- CSV download: blob+filename via mocked `URL.createObjectURL`. Sanitized filename verified for run titles containing `/`, spaces, accents (note: `sanitizeTitle` strips accents to `_` rather than preserving them; the assertion target is the stripped form).
- AbortController: rapid `runId` change cancels the in-flight fetch (assert `signal.aborted` on the first fetch's options object).
- RunId-change resets local state (regression-protects the rev 9 fix): mount with `runId=A`; after data loads, set `groupFilter` to a specific group_id, type into the search box (`nameQuery='foo'`), click a cell to open the side panel (`panelOpen=true`, `panelTarget` populated). Then swap the prop to `runId=B`. Assert: `groupFilter === 'all'`, `nameQuery === ''`, `panelOpen === false`, `panelTarget === null`. (Confirms the `$effect` reset block runs on `runId` change.)
- Unmount-after-`refresh()` aborts the refresh-created controller (regression-protects rev 11 fix #2): mount; await initial load; click Refresh but do NOT await — keep the new fetch in-flight; capture a reference to the now-current `abortCtl` via the mocked fetch's options-object capture; unmount the component; assert the captured `signal.aborted === true`. Without the unmount-only `$effect` at §6.3 lines ~702-706, the refresh-created controller would leak past unmount.
- `hasUngroupedStudents` gating (regression-protects rev 11 minor fix #5): two cases — (a) mock the dashboard response with all students having non-null `group_id` and assert the `<option value="ungrouped">` element is absent from the group-filter `<select>`; (b) mock the response with at least one student having `group_id: null` and assert the option is present.

#### `frontend/src/tests/RunSubmissionTab.svelte.test.ts`

Use a `mountSubmissionTab(extra)` helper.

- Loading / error states.
- Empty-MP placeholder.
- `groups_enabled: false` placeholder.
- Status badge rendering: each of the 5 statuses with correct class + label + icon (via the StatusBadge component being mounted).
- Sort by group: click → toggle direction.
- Sort by MP column: priority order applies (`needs_revision` first asc, `accepted` first desc).
- Filter by group dropdown.
- Per-MP counts row renders the right numbers.
- Cell click: side panel opens with submission `target` shape (no fetch; objects passed).
- Disabled group rendering.
- Refresh button: click triggers refetch (parallel to RunProgressTab line ~1526).
- Group-filter dropdown derives options from `data.mini_projects[i].groups[]` (no top-level `data.groups` field — assert the `<option>` list contains every distinct group_id exactly once, sorted ascending).
- Stale-while-revalidate: prior `data` stays rendered during Refresh-triggered refetch; loading placeholder appears alongside the populated grid.
- Retry-after-error: error → Retry → error clears + loading flips on; on mocked-success rerender, grid populates.
- CSV download: long-format with all required columns; one row per (group, MP); RFC 4180 quoting for embedded commas.
- AbortController on refetch.
- RunId-change resets local state (regression-protects the rev 9 fix): mount with `runId=A`; after data loads, set `groupFilter` to a specific group_id and click a cell to open the side panel (`panelOpen=true`, `panelTarget` populated). Then swap the prop to `runId=B`. Assert: `groupFilter === 'all'`, `panelOpen === false`, `panelTarget === null`. (No `nameQuery` to reset on this tab.)
- Unmount-after-`refresh()` aborts the refresh-created controller (regression-protects the §6.4 unmount-only `$effect` snippet rev 12 inlined parallel to §6.3 lines ~702-706): mount; await initial load; click Refresh but do NOT await — keep the new fetch in-flight; capture a reference to the now-current `abortCtl` via the mocked fetch's options-object capture; unmount the component; assert the captured `signal.aborted === true`. Same test shape as the RunProgressTab counterpart above.

#### `frontend/src/tests/DashboardSidePanel.svelte.test.ts`

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
- Focus trap behavior (Tab/Shift+Tab cycle).
- Focus return on close (panel's `previousFocus`).

#### `frontend/src/tests/StatusBadge.svelte.test.ts`

- One test per status: assert resolved class name, icon, and label.

#### `frontend/src/tests/csvWrite.test.ts`

Per §6.7 test list above.

---

## 14. Manual smoke walkthrough (the plan's final task)

Roles needed: an admin (`admin@mathion.test`) AND a teacher (`teacher@mathion.test`) on a run with seeded students, groups, sequences, mini-projects, submissions, and evaluations.

The new `backend/scripts/seed_teaching_dashboards_smoke.py` (listed in §3 and §15) first calls into Slice A's `seed_teaching_smoke.seed()` to (re)create the base course, version, single initial block, and 2 runs (Spring 2026 active, Fall 2026 upcoming), then adds the entities below on the freshly-built state. (Note: Slice A's seed at `backend/scripts/seed_teaching_smoke.py:50-63` always drops-and-recreates `teaching-smoke-101`, so the combined script is effectively a full rebuild — that's expected behavior, idempotent across the combined seed.)

#### Required fixture content (added on top of Slice A's base state)

Seed dependency order: **(0) re-acquire Slice A entities → (1) User rows → (2) Group rows → (3) RunStudent rows → (4) Block/Sequence/Item/Question/AnswerOption rows → (5) MiniProject rows → (6) UserItemState rows → (7) Submission rows → (8) Evaluation rows → (9) write placeholder files to disk → (10) patch Fall 2026 `groups_enabled=False`**. Each step's rows depend on the previous step's IDs.

- **Step 0 — re-acquire Slice A's entities.** Slice A's `seed()` opens its own `SessionLocal`, commits, and closes (`seed_teaching_smoke.py:127, 138`) — it returns `None`. The dashboards seed must open a fresh session and look up the course, version, Intro block, and both runs by slug/title. Wrap the lookup in a clear error message so that if Slice A's `seed()` failed silently, the implementer sees "Slice A seed didn't produce the expected entities" rather than a bare `NoResultFound`:

  ```python
  from sqlalchemy import select
  from sqlalchemy.exc import NoResultFound
  from mathion.database import SessionLocal
  from mathion.models import Block, Course, Run

  db = SessionLocal()
  try:
      course = db.execute(select(Course).where(Course.slug == "teaching-smoke-101")).scalar_one()
  except NoResultFound:
      raise RuntimeError(
          "teaching-smoke-101 course not found — Slice A seed_teaching_smoke.seed() "
          "must run successfully before this script."
      )
  version = course.versions[0]
  intro_block = next(b for b in version.blocks if b.slug == "intro")
  spring = db.execute(select(Run).where(Run.version_id == version.id, Run.title == "Spring 2026")).scalar_one()
  fall = db.execute(select(Run).where(Run.version_id == version.id, Run.title == "Fall 2026")).scalar_one()
  ```

  The `version_id` filter is required because `Run.title` is NOT globally unique (only `Run` has no title-uniqueness constraint per `models.py:196`); scoping by `version_id` avoids any cross-course title collision on shared dev DBs.

  **Why only `course` is wrapped:** Slice A's `seed()` (`backend/scripts/seed_teaching_smoke.py:50-138`) commits atomically — if `course` exists, then `version`, `intro_block`, `spring` and `fall` (the four bindings immediately below the `try/except`) all exist by construction. Bare `IndexError` / `StopIteration` / `NoResultFound` on those four downstream bindings therefore signal that Slice A's seed was modified in a backwards-incompatible way (a different failure mode than "Slice A wasn't run") — re-running Slice A's seed will not fix them; the implementer must reconcile this dashboards seed with the Slice A change. Wrapping only the entry-point lookup keeps the actionable error message focused on the common case (Slice A not run / failed mid-way) without padding the script with cascaded error wrappers.

- **6 student `User` rows** (Slice A only creates `admin@mathion.test` and `teacher@mathion.test` — no student users exist after Slice A). Use Slice A's `get_or_create_user(db, email, full_name)` helper (`seed_teaching_smoke.py:34-41`) to (re)create. **Caveat:** the helper hard-codes `is_disabled=False` and does NOT accept an override; for `student6` the seed must mutate after the helper returns:

  ```python
  student6 = get_or_create_user(db, "student6@mathion.test", "Student Six")
  student6.is_disabled = True
  db.flush()
  ```

  This works on both fresh-create and rerun (the helper returns the existing row unchanged on rerun; the mutation re-enforces `is_disabled=True` idempotently). Without this step, smoke step 19 (disabled-student row styling) silently fails.

  | email | full_name | is_disabled |
  |---|---|---|
  | `student1@mathion.test` | Student One | False |
  | `student2@mathion.test` | Student Two | False |
  | `student3@mathion.test` | Student Three | False |
  | `student4@mathion.test` | Student Four | False |
  | `student5@mathion.test` | Student Five | False |
  | `student6@mathion.test` | Student Six | True |

- **3 `Group` rows** on the Spring 2026 run (Slice A creates the runs with `groups_enabled=True`; no Group rows exist after Slice A). `Group` requires NOT NULL `run_id`, `name` (unique per `run_id` per `models.py:229`), `is_disabled` (default False):

  | name | is_disabled |
  |---|---|
  | `Group A` | False |
  | `Group B` | False |
  | `Group C` | True |

- **6 `RunStudent` rows** on Spring 2026 (unique per `(run_id, user_id)` per `models.py:245`; `group_id` is nullable):

  | user | group_id |
  |---|---|
  | student1 | Group A.id |
  | student2 | Group A.id |
  | student3 | Group B.id |
  | student4 | Group B.id |
  | student5 | Group C.id |
  | student6 | NULL (ungrouped — exercises §6.3 "(Ungrouped)" filter option) |

  Note: `RunStudent` has no `is_disabled` column — disabled-student presentation is driven by `User.is_disabled=True` on student6.
- **5 additional blocks** in the course version (Slice A creates 1 block "Intro" with `slug="intro"`, `order=1`; the dashboards seed appends 5 more for a total of 6 blocks). Required because `MiniProject` has `UniqueConstraint("run_id", "block_id")` — only one MP per (run, block). Slug values must be set explicitly (NOT NULL with `UniqueConstraint("version_id", "slug")` per `models.py:60`). The seed inserts blocks via direct ORM (bypassing `blocks.py:46-47` which forbids `POST /api/versions/{vid}/blocks` when `version.state != "created"`) — same pattern Slice A's seed uses. The sequence-create endpoint at `blocks.py:237-238` (POST `/api/blocks/{bid}/sequences`) and the items-create endpoint at `items.py:44-45` share the identical state-guard, so direct ORM inserts also apply to seeded Sequences/Items below.

  | title | slug | order |
  |---|---|---|
  | Linear regression | `linear-regression` | 2 |
  | Multivariate | `multivariate` | 3 |
  | Diagnostics | `diagnostics` | 4 |
  | Time series | `time-series` | 5 |
  | Capstone | `capstone` | 6 |

- **3 sequences** in the existing "Intro" block (each requires NOT NULL `title`, `slug` unique per `block_id` per `models.py:79`, `order`):
  - Sequence 1 "Estimation" (`slug="estimation"`, `order=1`): 4 items (2 static_page + 2 quiz, each quiz seeded with 8 Questions à 1 point — see Question/AnswerOption section below).
  - Sequence 2 "Practice" (`slug="practice"`, `order=2`): 3 items (1 video + 2 quiz, each quiz seeded with 5 Questions à 1 point).
  - Sequence 3 "Wrap-up" (`slug="wrap-up"`, `order=3`): 2 items (2 static_page, no quiz items).

  Each Item requires NOT NULL `title`, `slug` (unique per `sequence_id` per `models.py:96`), `order`, `type`. Suggested per-sequence item slug pattern: `est-1..est-4`, `prac-1..prac-3`, `wrap-1..wrap-2` (or any value satisfying the uniqueness constraint). Item `order` runs `1..N` within its sequence.

- **Question / AnswerOption seeding for quiz items.** The Phase 7c `/dashboard/progress` endpoint computes `quiz_total` per sequence from the `Question` + `AnswerOption` tables (via `_load_quiz_max_per_sequence` at `backend/mathion/api/dashboard.py:66-104`), NOT from `UserItemState.last_score_total`. Without seeded Questions+AnswerOptions, every quiz cell renders as `—` and the smoke walkthrough step 3 (Quiz mode shows ratios) fails. Seed structure:
  - For each `quiz` Item: N `single_choice` Questions, each with 1 `is_correct=True` AnswerOption + 1-3 distractors. N = 8 for sequence 1's quiz items, N = 5 for sequence 2's quiz items.
  - Each `Question` requires NOT NULL `text_md`, `text_html`, `type='single_choice'`, `order` (1..N within its Item). Each `AnswerOption` requires NOT NULL `text`, `is_correct`, `order` (1..M within its Question). There is no `points` column — "à 1 point" is mechanically enforced by `_load_quiz_max_per_sequence` at `dashboard.py:88-92`, which returns `1` for every non-`multiple_choice` Question type.
  - This yields max-possible quiz_total per sequence: Estimation = 16 (2 quizzes × 8); Practice = 10 (2 quizzes × 5); Wrap-up = 0 (no quizzes).
- **UserItemState** rows seeded so the heatmap shows variety:
  - student1 = fully covered + perfect quizzes (`is_covered=True`, `last_score_correct = last_score_total` per quiz item).
  - student2 = partial coverage, low scores (covered ~half items; quiz items have `last_score_correct ≈ last_score_total/2`).
  - student3 = zero items touched (NO UserItemState rows at all — exercises §5.1 default `is_covered=false`).
  - student4 = covered with no quiz attempts: UserItemState rows exist with `is_covered=True` but `last_score_correct=None AND last_score_total=None` (exercises the null-score guard from §5.1).
  - student5 = mixed.
  - student6 = fully covered (disabled, but historical UserItemState rows still in place).
- **5 mini-projects** on the **Spring 2026 run** (`MiniProject.run_id = spring.id`), one per non-Intro block ("Linear regression" → MP1, ..., "Capstone" → MP5), each `is_published=True` (defaults to False otherwise; the dashboard endpoint doesn't filter on this but UI reads more naturally with explicit publish). MPs attach to a Run, not a CourseVersion — Blocks are shared between Spring and Fall on the same version, but the dashboards seed only puts MPs on Spring (Fall has `groups_enabled=False` after the patch step and never exercises the Submission tab). `MiniProject` requires NOT NULL `assignment_md: str` and `assignment_html: str` with no defaults (per `models.py:278-279`). Use a placeholder like `assignment_md=f"Assignment for {block.title}."` and `assignment_html=render_markdown(assignment_md)` (the same `render_markdown` helper Slice A uses at `seed_teaching_smoke.py:25` for course/block `info_html`). Each MP is rendered across all 3 groups. The (MP × group) grid is 15 cells covering all 5 `MpGroupStatus` values. Status is DERIVED from `Submission` + `Evaluation` state — there is no `status` column to set directly. Per-cell seed data:

  | MP / Block | Group A | Group B | Group C |
  |---|---|---|---|
  | MP1 / "Linear regression" | no Submission → `not_submitted` | no Submission → `not_submitted` | no Submission → `not_submitted` |
  | MP2 / "Multivariate" | 1 Submission, no Evaluation → `awaiting_eval` | no Submission → `not_submitted` | 1 Submission, no Evaluation → `awaiting_eval` |
  | MP3 / "Diagnostics" | 1 Submission + 1 Evaluation `result="major_revision"`, feedback file present → `needs_revision` | 1 Submission + 1 Evaluation `result="accepted"` score=95 (no feedback_file required) → `accepted` | 1 Submission, no Evaluation → `awaiting_eval` |
  | MP4 / "Time series" | 1 Submission + 1 Evaluation `result="accepted"` score=88 → `accepted` | 1 Submission + 1 Evaluation `result="rejected"` score=40, feedback file present → `rejected` | 1 Submission + 1 Evaluation `result="accepted"` → `accepted` |
  | MP5 / "Capstone" | 1 Submission, no Evaluation → `awaiting_eval` | 2 Submissions: #1 (`submission_number=1, is_resubmission=False`) + #2 (`submission_number=2, is_resubmission=True, is_late=True`) + 1 Evaluation on #2 with `result="accepted"` → `accepted` | 1 Submission + 1 Evaluation `result="minor_revision"`, feedback file present → `needs_revision` |

  **DB constraint reminders for the seed implementer:**
  - **`Evaluation.feedback_file`** is REQUIRED whenever `result != 'accepted'` per `ck_evaluation_feedback_file_required` at `models.py:330-333`. The table above lists "feedback file present" on every non-accepted row (MP3-A, MP4-B, MP5-C). For `accepted` rows the field can be NULL.
  - **`Evaluation.result`** is constrained to `rejected | major_revision | minor_revision | accepted` at `models.py:322-324`. The dashboard's derived `MpGroupStatus="needs_revision"` collapses BOTH `"major_revision"` AND `"minor_revision"` (the seed uses both flavors).
  - **`Submission` required non-null fields**: `file_path: str` (store a BARE FILENAME only — `submissions.py:141` writes the result of `build_submission_filename(block_order, group_name, submission_number)` from `helpers.py:365`, and `submissions.py:303` does `os.path.basename(sub.file_path)` on download. Use `build_submission_filename(block.order, group.name, sub_num)` for each row), `file_size: int > 0` (use `1024`), `submitted_by: int` (FK to User — use one of the student User IDs from the group, e.g., `student1.id` for Group A submissions), `submission_number: int >= 1` (per-`(mini_project_id, group_id)` unique).
  - **`Evaluation` required non-null fields**: `evaluated_by: int` (FK to User — use admin or teacher), `result`, plus `feedback_file: str` (BARE FILENAME, parallel to Submission — use `build_feedback_filename(block.order, group.name, sub.submission_number)` from `helpers.py:376`) on every non-accepted row.
- **Files-on-disk for download links to work.** `backend/mathion/api/submissions.py:286-310` and `backend/mathion/api/evaluations.py:205-232` both check `os.path.isfile(abs_path)` and return 404 "File missing" if absent. The seed MUST write placeholder bytes at every Submission `file_path` AND every Evaluation `feedback_file`, in the directory returned by **`submission_storage_dir(run.id, group.id)`** from `helpers.py:382`. There is only ONE storage-dir helper — feedback files share the same per-(run, group) directory as submission files (verified at `evaluations.py:223`: `abs_dir = submission_storage_dir(run.id, sub.group_id)`). For each row:

  ```python
  from mathion.api.helpers import submission_storage_dir
  abs_dir = submission_storage_dir(run.id, group.id)
  os.makedirs(abs_dir, exist_ok=True)
  with open(os.path.join(abs_dir, sub.file_path), "wb") as f:
      f.write(b"%PDF-1.4\n")  # PDF magic header only — NOT a valid PDF; sufficient for HTTP 200 + browser download trigger. The PDF viewer may show a parse error if it auto-opens the file (the assertion target for §14 step 13 is "download endpoint returned the file successfully", not "the file renders as a valid PDF"). Implementer can upgrade to a minimal-valid PDF if downstream UX needs it.
  # Same for ev.feedback_file (if not None).
  ```

  Without this, §14 step 13 returns 404 on the Download buttons even though the DB rows look correct. The seed is overwrite-safe on rerun (writing the same bytes to the same path).
- **Fall 2026 run** (`groups_enabled=True` per Slice A seed) is patched to `groups_enabled=False` in the dashboards seed to support §14 step 15.

The combined script is idempotent across reruns: Slice A's seed always drops-and-recreates the course (cascading runs/versions/blocks/MPs/submissions/evaluations); the dashboards seed then layers its additional entities on top. The seed should also `os.makedirs` and re-write placeholder files on rerun (overwrite-safe).

1. Login as admin, navigate to a teaching-smoke run. Click Progress tab.
2. Verify: heatmap renders with sequences as columns, students as rows, block titles spanning. Default mode is Coverage. Cells colored by ratio.
3. Toggle to Quiz mode. Verify cells now show `{correct}/{total}` and quizless columns render `—` in gray.
4. Click a column header — verify rows reorder; `aria-sort` updates. Click again — direction flips. Toggle back to Coverage mode — sort persists with new values.
5. Filter by group dropdown — verify rows filter; "(Ungrouped)" option appears only if any student has `group_id: null`.
6. Type in search box — verify rows filter on both name AND email.
7. Verify the empty-state placeholder appears when filter excludes all rows.
8. Click a cell — side panel opens with item-level breakdown. Verify each row shows `is_covered` indicator and quiz score where applicable. Escape closes panel. Focus returns to the originating cell button.
9. Click Download CSV on Progress tab — file downloads. Open the CSV: verify BOM (Excel opens UTF-8 correctly), one row per filtered student, header text matches §6.3 literally, and a student with a comma in their name is quoted correctly.
10. Click Refresh button — table re-fetches.
11. Click Submission tab. Verify status grid renders with groups as rows, MPs as columns. Status badges colored correctly (dark text on light backgrounds; readable). Per-MP counts row shows totals.
12. Click MP column header — verify sort by priority: needs_revision → rejected → awaiting_eval → not_submitted → accepted.
13. Click a status cell — side panel shows submission + evaluation details. Click "Download submission" and "Download feedback file" links. Verify both return HTTP 200 and trigger a browser download (filename matches the bare basename stored on the row). The placeholder bytes (`b"%PDF-1.4\n"`) are the PDF magic header only — NOT a valid PDF — so the browser's PDF viewer may show a parse error if it auto-opens the file; the assertion target for smoke step 13 is "the download endpoint returned the file successfully", not "the file renders as a valid PDF". Implementer can upgrade the placeholder to a minimal-valid PDF if downstream UX needs it.
14. Click Download CSV on Submission tab — file downloads. Verify long format; one row per (group, MP).
15. Switch to a run with `groups_enabled: false` — Submission tab shows the placeholder text.
16. Logout, login as the seeded teacher — both tabs visible and functional (same auth as admin).
17. As admin: disable the course version via the Course Editor's existing UI (NOT via SQL) → verify Progress tab shows the yellow warning banner.
18. Re-enable the version → verify banner disappears on Refresh.
19. Verify a disabled student's row renders with muted italic styling (per §6.3 `.disabled-row { opacity: 0.55; font-style: italic; }`) and a "disabled" badge next to the student name (per §6.3 layout `<span class="badge-muted">disabled</span>`). On the Submission tab, disabled groups also render with the "disabled" badge in body row-headers (per §6.4 layout). Only the group-filter `<option>` elements use a `" (disabled)"` parenthetical (because `<option>` cannot contain element children).

---

## 15. Files touched (summary)

**Backend:**
- `backend/mathion/api/dashboard.py` — new endpoint `/api/runs/{rid}/students/{uid}/sequences/{sid}/items`; new module-local helpers `_resolve_run_student_with_user`, `_resolve_sequence_in_version`; additive `title` field in `/dashboard/mini-projects` row assembly.
- `backend/mathion/api/mini_projects.py` — extract `mini_project_title(block)` helper from the existing inline expression at line 44.
- `backend/mathion/schemas.py` — new `SequenceItemStateResponse`, `SequenceItemState`, `SequenceItemScore`, plus the private `_SequenceMeta` and `_StudentMeta` models (or inline as nested classes — implementor's choice).
- `backend/mathion/api/helpers.py` — verified, no changes (`require_run_admin_or_teacher` already exists at line 109).
- `backend/scripts/seed_teaching_dashboards_smoke.py` — NEW seed script (see §14 for content).
- `backend/tests/test_dashboard_item_drilldown.py` — NEW, 15 tests.
- `backend/tests/test_dashboard_mini_projects.py` — +1 test for `title` field.

**Frontend (NEW files):**
- `frontend/src/lib/dashboards.ts`
- `frontend/src/lib/csvWrite.ts`
- `frontend/src/components/runs/RunProgressTab.svelte`
- `frontend/src/components/runs/RunSubmissionTab.svelte`
- `frontend/src/components/runs/DashboardSidePanel.svelte`
- `frontend/src/components/ui/StatusBadge.svelte`
- `frontend/src/tests/dashboards.test.ts`
- `frontend/src/tests/csvWrite.test.ts`
- `frontend/src/tests/RunProgressTab.svelte.test.ts`
- `frontend/src/tests/RunSubmissionTab.svelte.test.ts`
- `frontend/src/tests/DashboardSidePanel.svelte.test.ts`
- `frontend/src/tests/StatusBadge.svelte.test.ts`

**Frontend (MODIFIED files):**
- `frontend/src/pages/runs/RunDetailPage.svelte` — extend `ActiveTab` union; register 2 new tab buttons and tab-content branches.
- `frontend/src/styles/base.css` — add 10 new `--status-*-bg` / `--status-*-fg` CSS custom properties (verbatim status-enum names with underscores → dashes); add `--surface-muted` token if not yet present.

**Plan-sized estimate: 8 tasks** (committed):

1. Backend: drilldown endpoint + helpers + schemas + 15 tests; extract `mini_project_title(block)` helper; additive `title` in `/dashboard/mini-projects` + 1 test.
2. Frontend foundations: `lib/dashboards.ts` (wire functions + STATUS_LABEL/STATUS_ICON/STATUS_PRIORITY) + `dashboards.test.ts` (response-shape conformance tests).
3. Frontend foundations: `lib/csvWrite.ts` (toCSV with OWASP formula-injection guard + RFC 4180 quoting + BOM + CRLF; downloadCSV) + `csvWrite.test.ts`.
4. Frontend: `StatusBadge.svelte` + tests + 10 new CSS variables in `styles/base.css`.
5. Frontend: `RunProgressTab.svelte` + tests (heatmap, sort, filter, CSV, side-panel open).
6. Frontend: `RunSubmissionTab.svelte` + tests (status grid, priority sort, CSV, side-panel open).
7. Frontend: `DashboardSidePanel.svelte` + tests; `RunDetailPage` tab registration + `ActiveTab` widening.
8. `seed_teaching_dashboards_smoke.py` + manual smoke walkthrough + cleanup.

---

## 16. Changes from rev 11

This rev incorporates findings from the 5-Opus panel round 11 against rev 11. R11 returned **0 Critical / 5 Important / ~6 Minor** (3 reviewers PASSed, 2 REVISEd; #1 architecture, #3 backend, #5 adversarial all PASSed). Cross-confirmation matrix from the panel showed 4 of the 5 Important items raised by ≥2 reviewers. All 5 Important + 1 Minor folded in. No architectural change; all edits are spec-text polish (test-list additions, two wording tweaks, one inlined snippet, one documentation sentence).

**Important fixes (rev 11 → rev 12):**

1. **§14 line ~1809 inline comment ↔ line ~1830 step 13 wording contradiction** (R11 #2 Important, R11 #3 Minor). Rev 11 fixed step 13 to acknowledge the placeholder bytes may parse-error in the PDF viewer, but the seed-script inline comment at line ~1809 still read `# minimal PDF magic — browser handles gracefully; 1-byte b"\x00" served as application/pdf triggers viewer error.` Rev 12 rewrites that comment to consistently frame the placeholder as "PDF magic header only — NOT a valid PDF; sufficient for HTTP 200 + browser download trigger; the PDF viewer may show a parse error if it auto-opens", with explicit pointer back to step 13's assertion-target rationale.
2. **§14 Step 0 atomic-contract documentation** (R11 #2 Important — split opinion with R11 #3/#5 Minor as "implementor-obvious / deferred per §19 (rev 8→9) line ~1965"). Rev 11 wrapped only the `course` lookup in `try/except NoResultFound`; the downstream `version` / `intro_block` / `spring` / `fall` lookups still raise bare `IndexError` / `StopIteration` / `NoResultFound`. R11 #2 wanted either (a) wrap each, OR (b) document the atomic-Slice-A-seed contract. Rev 12 picks (b) — adds an explicit "Why only `course` is wrapped" paragraph after the snippet documenting: Slice A commits atomically, so a bare exception on the four downstream bindings (`version` / `intro_block` / `spring` / `fall`, immediately below the `try/except` at §14 Step 0) means Slice A was modified backwards-incompatibly (a different failure mode than "Slice A wasn't run") and re-running Slice A won't fix it. This converts the implicit assumption into a documented contract without expanding the try/except surface.
3. **§6.4 lacks explicit unmount-only `$effect` snippet in body** (R11 #4 Important; R11 #2 Minor (B); R11 #5 Minor #1 — 3× consensus). §6.3 had both the explicit `$effect(() => () => abortCtl?.abort())` code block (lines ~702-706) AND a prose cross-reference at line 708, but §6.4's reactive block ended at the runId-tracking `$effect` (line ~1063) with no inline unmount-`$effect`. An implementer reading §6.4 in isolation could omit the unmount cleanup and reintroduce the bug. Rev 12 inlines the same 3-line `$effect` snippet immediately after §6.4's runId-tracking `$effect` (the snippet body is identical to §6.3 with the same comment about complementing the runId-tracking `$effect`), with a one-paragraph framing that explains its purpose in §6.4-specific terms (terminates the `getMiniProjectsDashboard` refresh on tab-switch / navigation-away). Now both tabs are self-contained when read in isolation.
4. **§13 csvWrite missing boolean-serialization test** (R11 #4 Important; R11 #2 Minor (D); R11 #5 Minor #4 — 3× consensus). Rev 11 extended `CsvColumn.value: (row: Row) => string | number | boolean | null | undefined` and documented the `"true"`/`"false"` literal-string serialization in the interface-level comment (§6.7 lines ~1396-1398), but the `tests/csvWrite.test.ts` list (§6.7 lines ~1471-1482) had a `"Number serialization"` entry with no parallel `"Boolean serialization"` entry. Rev 12 adds an explicit boolean-serialization test entry to the §6.7 list: `value: () => true` / `value: () => false` → unquoted literal `true` / `false` output (neither contains a formula-injection trigger nor an RFC 4180 trigger, so the apostrophe-prefix and quotes both pass). Closes the gap where rev 11's type-widening was implicitly relying on `String(true)` / `String(false)` behavior without dedicated coverage.
5. **§13 both-tabs missing unmount-after-`refresh()` regression test** (R11 #4 Important; R11 #5 Minor #2 — 2× consensus). The §13 RunProgressTab test list had an AbortController test for "rapid `runId` change cancels the in-flight fetch" (line ~1636), but no test asserting that the rev 11 fix #2 (unmount-only `$effect`) actually aborts the latest `refresh()`-created controller on COMPONENT UNMOUNT. The §13 RunSubmissionTab list had only "AbortController on refetch" with no unmount-specific assertion. Rev 12 adds parallel unmount-after-`refresh()` test entries to BOTH tab test lists: mount → await initial load → click Refresh (do NOT await; capture the new `abortCtl` via the mocked fetch's options-object) → unmount → assert `signal.aborted === true`. Protects the rev 11 fix #2 and the rev 12 §6.4 inlined-snippet (fix #3 above) from silent regression.

**Minor (folded in):**

- **§13 RunProgressTab missing `hasUngroupedStudents` gating test** (R11 #4 Minor; R11 #5 Minor #3). The existing tab test at line ~1622 ("Filter by 'ungrouped': only `group_id: null` students visible") covers filter behavior when the option is selected, but no test asserts the option's conditional rendering. Rev 12 adds a two-case gating test: data with no `group_id: null` students → `<option value="ungrouped">` absent; data with ≥1 ungrouped student → present. Cheap test, closes the gap where rev 11's `{#if hasUngroupedStudents}` gate was untested.

**R11 items NOT folded in (deferred):**

- **Stale renumbered cross-references at §17/§18/§19 line numbers** (R11 #1 Minor 1-3). After the §16-§24 → §17-§25 renumbering in rev 11, three prior-changelog entries reference section numbers that have shifted (e.g., §17 R9 NOT-folded-in says `§16-§18` where it means `§17-§19`; §18 says `§17 R7-Minor` where it means `§19 R7-Minor`; §19 says `§20 (rev 3→4)` where it means `§23 (rev 3→4)`). Per the explicit deferral at §17 line ~1926 ("Cross-reference line-number drift in §16-§18 changelog entries — all `~`-approximate; sections still resolve correctly; not worth maintaining to exact precision across edits"), these remain unfixed. They will continue to drift each rev; the reader can navigate by section header text.
- **Style inconsistency `==` vs `===` for null checks** (R11 #4 Minor; R11 #5 Minor #5). §6.3 line 721 uses `s.group_id === null` (strict); §6.3 lines 892 / 900 use `s.group_id == null` (loose). Both work given the `number | null` schema. Not a defect; harmonization deferred.
- **§6.7 TypeScript sample-body for `toCSV`** (R11 #4 Minor 2; R11 #5 Minor — not raised by panel as Important). The docstring + algorithm description is precise; a 6-line TS sample would remove implementer interpretation, but the implementer-derivable path is the established convention.
- **§6.4 `(Ungrouped)` analog gate** (R11 #2 Minor (C)). Not needed — §6.4 derives uniqueGroups from `data.mini_projects[i].groups[]`, where groupless students don't surface as rows. Confirmed.

---

## 17. Changes from rev 10

This rev incorporates findings from the codex independent review against rev 10, after the 5-Opus R9 panel had converged. Codex returned **0 Critical / 4 Important / 5 Minor**; importantly, codex confirmed **no rev-3-class schema/seed bugs remain** (the seed walkthrough now satisfies every NOT NULL / CHECK / UniqueConstraint cited). All 4 Important + 3 actionable Minor folded in.

**Important fixes (rev 10 → rev 11):**

1. **§14 step 13 wording reflects the `b"%PDF-1.4\n"` placeholder is corrupt, not a valid PDF.** Codex flagged that 9 bytes pass `os.path.isfile()` but won't render in a PDF viewer. Rev 11 changes step 13 to assert "HTTP 200 + browser triggers download" only; explicitly notes the assertion target is "download endpoint returned the file successfully", NOT "the file renders as a valid PDF". Implementer can upgrade to a minimal-valid PDF if downstream UX needs it.
2. **`refresh()`-created `abortCtl` not aborted on component unmount.** The `$effect` cleanup only snapshots the controller IT created (correctly aborts on `runId` change), but `refresh()` reassigns `abortCtl` to a new controller — so on COMPONENT UNMOUNT, the latest refresh-created request kept running. Rev 11 adds an unmount-only `$effect(() => () => abortCtl?.abort())` in §6.3 (with same pattern noted for §6.4) to ensure pending refresh requests cancel cleanly when the user navigates away.
3. **`CsvColumn.value` type excluded `boolean` but Submission CSV uses booleans.** §6.4 CSV columns include `is_late`, `is_resubmission`, `has_feedback_file` (all `boolean`). Rev 11 extends `CsvColumn.value: (row: Row) => string | number | boolean | null | undefined` and notes booleans serialize as the literal strings `"true"`/`"false"` before the guard + RFC 4180 pass.
4. **CSV formula-guard test list contradicted the algorithm.** Algorithm said "quote only when post-guard contains comma/quote/CR/LF" but test list said "leading `=`/`+`/`-`/`@`/`\t`/`\r` → apostrophe-prefixed AND quoted". Rev 11 changes the algorithm to ALWAYS quote formula-guarded values (step 2 quotes if either the apostrophe prefix was added OR the value contains RFC 4180 trigger chars). This makes guarded values uniformly quoted, matching the test list assertion.

**Minor (folded in):**

- **(Ungrouped) option rendered unconditionally** (§6.3 line ~786) but Filters prose says "only when at least one student has `group_id: null`". Rev 11 adds `hasUngroupedStudents` `$derived` (`data?.students.some(s => s.group_id == null) ?? false`) and gates the option with `{#if hasUngroupedStudents}`. Helper-list updated.
- **§14 Step 0 raw `NoResultFound` error.** Wrapped the `select(Course)...scalar_one()` lookup in `try/except NoResultFound` that re-raises as `RuntimeError("teaching-smoke-101 course not found — Slice A seed_teaching_smoke.seed() must run successfully before this script.")` so an implementer running the script with a missing/failed Slice A seed sees an actionable error.

**Codex items NOT folded in:**

- **§5.1 Pydantic snippet "duplicates `items: list[SequenceItemState]` (`257-260`)"** — actual spec has a single field declaration at line 260; no duplicate. Misread by codex; skipped.
- **`MP title` currently absent from dashboard endpoint response** — already documented as §5.2 deliverable (extract `mini_project_title(block)` helper and add to the response). Not a spec defect; an implementation task.
- **Current dashboard response matches §6.1 for existing fields** — codex confirmed `run`, nullable group fields, `group_is_disabled` all match between spec and `dashboard.py`. No action needed.

---

## 18. Changes from rev 9

This rev incorporates findings from the 5-Opus panel round 9 against rev 9. R9 returned **0 Critical / 3 Important / ~25 Minor** (3 reviewers PASSed, 2 REVISEd). All 3 Important folded in.

**Important fixes (rev 9 → rev 10):**

1. **§6.4 helper-list internal contradiction over local CSV handler name** (R9 #4). Rev 9 prose simultaneously named the local helper `downloadSubmissionCSV()` AND said the template's `onclick={downloadCSV}` is "a local wrapper bound to this name to keep the markup consistent with §6.3; rename the local symbol if it clashes" — an implementer could not tell whether the local should be `downloadSubmissionCSV` (no clash, snippet doesn't match) or `downloadCSV` (clashes with import, rename needed). Rev 10 picks ONE name for both tabs: **the local handler is `handleDownloadCSV()`** (no shadowing of the §6.7 `downloadCSV` import). §6.3 helper-list, §6.3 template (`<button onclick={handleDownloadCSV}>`), §6.4 helper-list, and §6.4 template are all updated to use this name consistently.
2. **§13 missing regression test for the rev 9 `runId`-change reset behavior** (R9 #2, R9 #4 — 2× consensus). Rev 9 added an `$effect` reset block to fix the "stale `groupFilter` silently empties new run's grid" UX bug, but neither tab's §13 test list asserted the reset actually fires. Rev 10 adds explicit reset tests to both lists: RunProgressTab asserts `groupFilter`, `nameQuery`, `panelOpen`, `panelTarget` all reset on `runId` prop swap; RunSubmissionTab asserts `groupFilter`, `panelOpen`, `panelTarget` (no `nameQuery` on this tab).
3. **§6.4 reset block was prose-only** (R9 #2, R9 #3, R9 #5 Minor). The §6.3 reset is shown as a literal `$effect` body code block (lines ~656-680), but §6.4 had only a one-sentence prose description. Rev 10 inlines the §6.4 `$effect` body as a code snippet — same structure as §6.3, with `getMiniProjectsDashboard` substituted and the `nameQuery = ''` line omitted (Submission tab has no name-search input). Also adds an explicit sentence noting that `sortKey`/`sortDir` (and §6.3's `mode`) are deliberately NOT reset — they're cross-run user preferences, and a stale `sortKey` referencing a non-existent column falls back to no-effective-sort via the null-sink rule.

**Minor (folded in):**

- §6.3 helper-list now also enumerates the `lib/csvWrite.ts` imports (`toCSV`, `downloadCSV`, `sanitizeTitle`) explicitly, matching §6.4's structure (R9 #4 Minor).
- §6.3 `STATUS_*` constants noted as kept for symmetry with §6.4 (the `STATUS_*` consts are actually unused on the Progress tab; if a linter complains, the implementer can drop them).
- Explicit "`sortKey`/`sortDir` and `mode` NOT reset" rationale added to §6.4 prose, addressing R9 #5 Minor #2/#3 and R9 #2 Minor.

**R9 items NOT folded in (deferred or out of scope):**

- §13 dashboards.test.ts MP `title` conformance test (R9 #2/#3/#4 Minor — recurring from earlier revs) — implicit per "extracts all expected keys with the expected types" wording.
- §6.3 `s.group_name ?? ''` empty-string fallback for missing names (R9 #2 Minor #6, R9 #4 Minor, R9 #5 Minor #1) — server-side data integrity should prevent this; document an explicit "named groups always have non-null name" contract in a future rev.
- Cross-reference line-number drift in §16-§18 changelog entries (R9 #2 Minor, R9 #4 Minor) — all `~`-approximate; sections still resolve correctly; not worth maintaining to exact precision across edits.
- `mode`/`sortKey`/`sortDir` reset across runs (R9 #2 Minor, R9 #5 Minor #2/#3) — rev 10 documents the deliberate non-reset choice; an alternative reset behavior is deferrable to a future UX pass.
- Focus-return on side-panel-close-via-`runId`-reset (R9 #4 Minor) — focus may target stale DOM node after panel unmounts mid-run-switch; edge case; navigation typically originates outside the dashboard so focus is already elsewhere.

---

## 19. Changes from rev 8

This rev incorporates findings from the 5-Opus panel round 8 against rev 8. R8 returned **1 Critical / 3 Important / ~20 Minor** (deduped across 5 reviewers; 3 reviewers PASSed, 2 REVISEd). All 4 are folded in.

**Critical fix (rev 8 → rev 9):**

1. **§6.3 `uniqueGroups` consumer used `g.id` / `g.name` / `g.is_disabled` field names** (R8 #5) — same bug class rev 8 just fixed in §6.4. The source `DashboardStudent` (per §6.1) carries `group_id` / `group_name` / `group_is_disabled`; the §6.3 layout at line ~781 used the wrong names and the `uniqueGroups` derivation body was never written down. Without a fix the dropdown would silently render blank `<option>`s (undefined values → empty option text in HTML, no runtime error). Rev 9 adds the explicit `uniqueGroups` derivation body in §6.3 (parallel structure to §6.4's snippet at line ~1045: `Map<number, {...}>` with the same `{group_id, group_name, group_is_disabled}` shape) and renames the consumer to `g.group_id` / `g.group_name` / `g.group_is_disabled`. Both tabs now produce structurally identical dropdowns. R8 #5 caught this only because rev 8's "parallel to §6.3" framing in §16 invited the side-by-side comparison.

**Important fixes (rev 8 → rev 9):**

1. **§6.4 helper-visibility list cited `triggerDownload` — a phantom import** (R8 #2). §6.7 exports only `toCSV`, `downloadCSV`, `sanitizeTitle`; `triggerDownload` doesn't exist. An implementer writing `import { toCSV, triggerDownload, sanitizeTitle } from '../../lib/csvWrite';` would TS-error. Rev 9 corrects the import list and adds a one-line note about resolving the name clash between the imported `downloadCSV` and the local Download-button handler (either rename the local symbol, e.g., `handleDownloadCSV`, or alias the import).
2. **§6.4 loading guard `{#if loading && !data}` contradicted §13 stale-while-revalidate test** (R8 #2, R8 #5 — 2× consensus). The §13 test at line ~1581 says "loading placeholder appears alongside the populated grid" during Refresh-while-stale; §6.4 line ~1068 hid the placeholder when `data` was present. §6.3 line ~753 uses unguarded `{#if loading}`. Rev 9 changes §6.4 to match `{#if loading}` (unguarded) so both tabs render `LoadingPlaceholder` during Refresh-while-stale — consistent with §13 test intent and §6.3 pattern.
3. **`groupFilter` not reset on `runId` change** (R8 #5). Switching from Run A (groups {1, 2, 5}) with `groupFilter=5` to Run B (groups {3, 4}) leaves `groupFilter=5` selected; the `<select>` renders as blank-selected, the filter predicate excludes all rows, and the user sees an empty table with no diagnostic. Rev 9 adds explicit `groupFilter = 'all'; nameQuery = ''; panelOpen = false; panelTarget = null` resets inside the `runId`-change `$effect` body in §6.3, with parallel prose in §6.4 noting that the same reset block applies. `refresh()` does NOT reset filter state (only `runId` change does) — explicit so a Refresh click doesn't silently clear teacher's current filter selection.

**Minor (folded in):**

- §6.3 `uniqueGroups` derivation explicitly skips ungrouped students (`if (s.group_id == null) continue`) since the "(Ungrouped)" option is hard-coded above the `{#each}` loop.
- Panel-open state IS now reset on `runId` change (was previously deferred per §17 R7-Minor) — pulled in alongside the `groupFilter` reset since both share the same root cause and the same fix location.

**R8 items NOT folded in (deferred):**

- §14 Step 0 `course.versions[0]` undocumented robustness (R8 #2 Minor, R8 #3 Minor #1) — implementor-obvious; Slice A always creates exactly one published version.
- §14 no explicit `db.commit() + db.close()` reminder at end of seed (R8 #2 Minor, R8 #3 Minor #2) — implementor-obvious from Slice A pattern.
- MP `title` runtime label "Mini project for Block N" vs §14 fixture wording "Linear regression" / etc. (R8 #3 Minor #3) — API-side derivation; not a seed-correctness bug; the implementer can run `seed → load tab → see displayed labels`.
- §13 missing explicit "Refresh-after-failure: banner appears above stale table" test (R8 #4 Minor #8) — implicit coverage via stale-while-revalidate + retry-after-error tests.
- §6.4 `mp.groups ?? []` defensive null-check (R8 #5 Minor #1) — contract violation if `groups` is missing; implementor-obvious.
- §6.4 helper-list missing `visibleGroups` and `uniqueGroups` in §13/§6.4 enumeration parity with §6.3 (R8 #4 Minor #7) — consistency-only; implementer derives them regardless from the template usage.
- Side-panel state stuck when `groups_enabled` flips false mid-session (R8 #4 Minor #6, R8 #5 Minor) — edge case; same family as panel/groupFilter v1 deferral (now partly addressed by the runId-change reset, but mid-session groups_enabled flip is a separate path).
- §6.4 Download CSV button always renders when MP list is empty (R8 #5 Minor) — emits a header-only CSV; cosmetic.

---

## 20. Changes from rev 7

This rev incorporates findings from the 5-Opus panel round 7 against rev 7. R7 returned **1 Critical / 8 Important / ~25 Minor**. All 9 are folded in.

**Critical fix (rev 7 → rev 8):**

1. **§6.4 outer-shell group-filter iterated nonexistent `data.groups`** (R7 #2, #4, #5 — 3× consensus). The Phase 7c response shape is `{ run, mini_projects }` (per §6.1 line ~505 and `backend/mathion/api/dashboard.py:363-370`); groups live nested under `mini_projects[i].groups[]`. The rev 7 outer shell at line ~1054 wrote `{#each data.groups as g}` which would TS-error and runtime-throw. Rev 8 replaces this with a `$derived uniqueGroups` over `data.mini_projects[i].groups[]` (deduped by `group_id`, sorted ascending) — mirroring §6.3's pattern for the Progress group-filter dropdown. The §6.4 prose at line ~1128 already declared this derivation intent; the snippet now matches.

**Important fixes (rev 7 → rev 8):**

1. **§14 missing `is_disabled=True` mutation for student6** (R7 #3, #5; R7 #1 Minor). Slice A's `get_or_create_user(db, email, full_name)` (`seed_teaching_smoke.py:34-41`) hard-codes `is_disabled=False` and does NOT accept an override. An implementer following the rev 7 spec literally would leave student6's `is_disabled=False` in the DB, and smoke step 19 (disabled-row styling) would silently fail. §14 now includes an explicit post-helper mutation snippet (`student6.is_disabled = True; db.flush()`) that's idempotent on rerun.
2. **§14 missing Slice A entity re-acquisition pattern** (R7 #3, #5 — 2× consensus). Slice A's `seed()` opens its own `SessionLocal`, commits, and closes — it returns `None`. The dashboards seed needs to look up the course, version, Intro block, and both runs by slug/title before doing anything else. §14 now declares **Step 0** in the dependency-order preamble and provides a concrete code snippet using `select(Course).where(Course.slug == "teaching-smoke-101")` and `select(Run).where(Run.version_id == version.id, Run.title == "Spring 2026")` — `Run.title` is not globally unique, so the `version_id` scope is required.
3. **MP→Spring 2026 `run_id` binding not pinned** (R7 #5). MPs attach to a Run (`MiniProject.run_id`), not a CourseVersion. Blocks are shared between Spring and Fall on the same version, but the dashboards seed only puts MPs on Spring. §14 MP step now explicitly says "on the **Spring 2026 run** (`MiniProject.run_id = spring.id`)".
4. **§6.4 error-banner gating diverged from §6.3** (R7 #5, R7 #1 Minor). Rev 7's chained `{#if error && !data} {:else if loading && !data} {:else if data}` swallowed Refresh-failure errors when stale data was present. §6.3 uses three independent `{#if}` blocks so a failed Refresh surfaces the banner ABOVE the stale table. Rev 8 rewrites §6.4 to match §6.3's three-block structure (banner / loading / data) — same stale-while-revalidate semantics, but failures are visible.
5. **§6.4 helper-function visibility list missing** (R7 #2). Rev 7's §6.4 mentioned only `STATUS_LABEL` (imported) and `formatCountsLine` (local). Rev 8 expands to enumerate every helper used by the outer shell and table: imports (`STATUS_LABEL`, `STATUS_ICON`, `STATUS_PRIORITY`, `getMiniProjectsDashboard`, `toCSV`/`triggerDownload`/`sanitizeTitle`) and locals (`refresh`, `downloadCSV`, `openPanel`, `closePanel`, `compareGroups`, `toggleSort`, `formatCountsLine`). Parallels §6.3 line ~871.
6. **§16 changelog typo "rev 6" should be "rev 7"** (R7 #2). The rev 7 changelog's first bullet said "H1 + Status line bumped to 'rev 6'" — describing the rev 6→7 fix with the wrong target version. Rev 8 corrects the bullet header to "rev 7".
7. **§13 RunSubmissionTab missing explicit "Refresh button: click triggers refetch"** (R7 #2, R7 #4). The list relied on Stale-while-revalidate (line ~1579) to implicitly exercise Refresh. Rev 8 adds the explicit test parallel to RunProgressTab line ~1526. Also adds a "Group-filter dropdown derives from `mini_projects[i].groups[]`" test (asserts no `data.groups` reference) as regression protection for Critical #1.
8. **Side-panel block scope in `groups_enabled=false` branch** (R7 #4). Rev 7 had the `{#if panelOpen && panelTarget}` block at the same nesting level as the inner if/else, so the side panel was renderable even when `groups_enabled === false` (unreachable in practice — no cells to click — but structurally fragile). Rev 8 moves the side-panel block INSIDE the `{:else}` branch so it's structurally scoped to the only state where cells exist.

**Minor (folded in):**

- §14 step 9 / 10 numbering vs the preamble's 10-step order (R7 #1 Minor #4) — preamble now has 11 steps (step 0 + steps 1-10), and the body order matches.
- `render_markdown` import line corrected from `seed_teaching_smoke.py:24` to `:25` (R7 #1 Minor #6) — verified.
- §14 `Run.title` non-uniqueness note added to Step 0 (R7 #5 — implied by adversarial probe).

**R7 items NOT folded in (deferred or out of scope):**

- §16 line-number drift in self-references (R7 #1 Minors #2, #3; R7 #2 Minor) — line numbers in changelog citations use `~` and shift with every edit; not worth maintaining to exact precision when the section refs remain valid.
- §13 dashboards.test.ts conformance test for new `title` field on MP rows (R7 #2 Minor) — implicit per "extracts all expected keys with the expected types" wording; an explicit assertion is implementor-discretion.
- `MiniProject.first_submitted_at` left NULL by the seed (R7 #5 Minor) — endpoint and frontend handle null gracefully; smoke fixture deliberately doesn't run the first-submit code path.
- `HTTPException` import missing from `dashboard.py` (R7 #5 Minor) — already noted in §20 (rev 3→4) Minor as implementor-discoverable.
- Panel-open state not reset on `runId` change (R7 #5 Minor) — edge case; v1-acceptable.
- §14 implicit FKs (Group.run_id, RunStudent.run_id/user_id/group_id, etc.) (R7 #5 Minor) — implementor-obvious from the row descriptions.
- Slice A's `get_or_create_user` doesn't refresh full_name on existing rows (R7 #3 Minor) — first-run-correct; idempotency concern only if a prior partial run created student rows with different data.

---

## 21. Changes from rev 6

This rev incorporates findings from the 5-Opus panel round 6 against rev 6. R6 returned **0 Critical / 7 Important / ~25 Minor** (deduped across 4 returning reviewers + 1 stalled-with-partial-output). All 7 Important findings are folded in.

**Important fixes (rev 6 → rev 7):**

1. **H1 + Status line bumped to "rev 7"** (R6 #1, #2). Rev 6's edit pass missed updating the document title and Status from "rev 5", causing every reader to mistake the rev they were reviewing. Rev 7 reads "(rev 7)" and "rev 7, in review (incorporates findings from 5-Opus round 6 against rev 6)".
2. **Top-of-file forward pointer updated** (R6 #1). Line 5 said "Changes from rev 4: see end of file (§16)" — stale on both axes since §16 has been the rev-most-recent changelog for two rounds. Now reads "Changes from rev 6: see end of file (§16). Prior revs documented in §17–§21."
3. **`sequences.py:44` doesn't exist** (R6 #1, #2, #3 — 3× consensus). The sequence-create endpoint actually lives in `blocks.py:230-238` (POST `/api/blocks/{bid}/sequences`); the state-guard is at `blocks.py:237-238`. The items-create state-guard at `items.py:44-45` was correct. §14 line ~1550 + §21 (rev 5→6 changelog) Minor #2 entry both fixed to cite `blocks.py:237-238`.
4. **§14 missing explicit User-row and Group-row creation steps** (R6 #2). Slice A's `seed_teaching_smoke.py:34-41` creates only `admin@` and `teacher@` — no student `User` rows and no `Group` rows exist after Slice A. The dashboards seed must create 6 `User` rows (one with `is_disabled=True`), then 3 `Group` rows (one with `is_disabled=True`), then 6 `RunStudent` rows in dependency order. §14 now includes the explicit "Seed dependency order" preamble and three concrete tables enumerating: User rows (with `is_disabled` per-row); Group rows (with `is_disabled` per-row, name unique per `run_id`); RunStudent rows (with `group_id` per-row, ungrouped row for student6 to exercise the "(Ungrouped)" filter option).
5. **`MiniProject.assignment_md` and `assignment_html` are NOT NULL with no defaults** (R6 #5 partial, R6 #2 Minor). Per `models.py:278-279`, both fields require concrete text. §14 MP seed step now instructs the implementer to set `assignment_md=f"Assignment for {block.title}."` and `assignment_html=render_markdown(assignment_md)` using the same `render_markdown` helper Slice A uses at `seed_teaching_smoke.py:24`.
6. **§6.4 layout missing the outer shell** (error banner, Refresh, Download CSV) (R6 #2). Rev 6's §6.4 only showed the `<thead>`/`<tbody>` block — but §13 stale-while-revalidate / retry-after-error tests AND §14 step 14 ("Click Download CSV on Submission tab") assume those controls exist. §6.4 now includes an explicit outer-shell snippet mirroring §6.3 (banner-error with Retry, controls row with Refresh + Download CSV + group-filter dropdown, the existing table snippet, then the `DashboardSidePanel` block).
7. **§6.4 missing stale-while-revalidate prose** (R6 #2). §6.3 line ~691 documented stale-while-revalidate intent for Progress; §6.4 only said "Data fetch follows the same AbortController pattern as Progress" — silent on the data-retention semantics. §6.4 now restates: "stale-while-revalidate semantics (§6.3 line ~691): when Refresh is clicked with prior `data` present, `data` is NOT reset to `null`". This aligns with the §13 RunSubmissionTab test list (lines ~1510-1511).

**Minor (folded in):**

- §16 expanded to acknowledge the R6 panel result composition (4 returning + 1 stalled-with-partial); the stalled R6 #5's `MiniProject.assignment_md/html` finding was caught and folded into Important #5.
- §14 disabled-student note added: `RunStudent` has no `is_disabled` column — disabled presentation is driven by `User.is_disabled=True` on student6.
- §14 `Group` UniqueConstraint pinned at `models.py:229` (unique per `run_id`).
- §14 `RunStudent` UniqueConstraint pinned at `models.py:245` (unique per `(run_id, user_id)`).

**R6 items NOT folded in (deferred or out of scope):**

- §14 `file_size=1024` vs `len(b"%PDF-1.4\n")=9` mismatch (R6 #3 Minor). Download endpoint doesn't verify length; cosmetic; left as-is to preserve the existing "1024" claim.
- `b"%PDF-1.4\n"` is not a fully-valid PDF (missing trailer/xref) (R6 #3 Minor). Browsers handle gracefully via `application/pdf` MIME; the §14 wording already acknowledges this as an improvement over `b"\x00"`. If smoke step 13 still triggers viewer errors in practice, the implementer can extend to a minimal full PDF — implementor's discretion.
- Private-name `_SequenceMeta` / `_StudentMeta` Pydantic models surface in OpenAPI under the prefixed name (R6 #3 Minor). §15 already calls out "or inline as nested classes — implementor's choice".
- `aria-label="Refresh"` button redundancy (R6 #4 Minor, R5 #4 Minor). Cosmetic accessibility nit; left for implementor's a11y-review pass.
- §12 has no genuinely-open "CONFIRM at plan-time" markers (R6 #2 Minor) — informational; no spec change needed.

---

## 22. Changes from rev 5

This rev incorporates findings from the 5-Opus panel round 5 against rev 5. R5 returned **0 Critical / 6 Important / ~30 Minor**. All 6 Important findings + several recurring Minor items are folded in.

**Important fixes (rev 5 → rev 6):**

1. **Wrong storage-dir helper name in §14** (R5 #1, #2, #3, #5 — 4× consensus). Rev 5 said "configured `submission_storage_dir` / `evaluation_storage_dir`" — there is no `evaluation_storage_dir`. Both submission files and feedback files share **one** helper: `submission_storage_dir(run_id, group_id)` at `backend/mathion/api/helpers.py:382` (verified at `evaluations.py:223` and `submissions.py:302`). §14 now pins this helper explicitly, with an illustrative code snippet showing how to write both submission and feedback bytes into the same per-(run, group) directory. §22 "files-on-disk" rev 4→5 entry left intact.
2. **`Submission.file_path` placeholder format wrong** (R5 #5). Rev 5 used `"seed/sub-mp{N}-{group}.pdf"` with a `seed/` directory prefix. Production code writes a BARE FILENAME (`submissions.py:141`: `file_path=filename` where `filename = build_submission_filename(...)`); the download endpoint applies `os.path.basename(...)` on read. §14 now instructs the seed to use `build_submission_filename(block.order, group.name, sub_num)` for Submission and `build_feedback_filename(...)` for Evaluation `feedback_file` — both from `helpers.py:365/376`.
3. **§14 omitted Block/Sequence/Item `slug` columns** (R5 #5). All three are NOT NULL with `UniqueConstraint` against their parent (`models.py:60, 79, 96`). The dashboards seed would have hit IntegrityError on the first block insert. §14 now lists explicit slugs for 5 new blocks, 3 sequences, and per-sequence item slug pattern (`est-1..est-4`, `prac-1..prac-3`, `wrap-1..wrap-2`).
4. **§14 omitted `Question.order` and `AnswerOption.order` NOT NULL columns** (R5 #5). `models.py:130/154` — both are NOT NULL `int`. §14 now enumerates: Question requires `text_md`, `text_html`, `type='single_choice'`, `order` (1..N within Item); AnswerOption requires `text`, `is_correct`, `order` (1..M within Question). Also clarifies "à 1 point" is enforced by `_load_quiz_max_per_sequence` at `dashboard.py:88-92` (no `points` column exists).
5. **§7 stale `(disabled)` parenthetical wording** (R5 #1, #2). Lines 1339-1340 still described the pre-unification parenthetical for both disabled-group and disabled-user rows. Now rewritten to specify body cells use `<span class="badge-muted">disabled</span>` and `(disabled)` only inside `<option>` (matching §6.3, §6.4, §11, §14 step 19).
6. **§5.1 "Conceptually three queries" vs 4 enumerated** (R5 #1). Rev 5 fixed the post-list summary line (§10 "Four sequential queries") but left the header above the numbered list saying "three". Now reads "Four sequential queries".

**Minor (folded in):**

- **`.badge-muted` CSS rule defined** (R5 #5). Previously referenced in §6.3/§6.4/§11/§14 but never specified. Added inline padding, font-size, color tokens consistent with `var(--muted)` / `var(--surface-muted)`.
- **State-guard bypass clarified** (R5 #2). Rev 5 mentioned the seed bypasses `blocks.py:46-47`; §14 now adds that the sequence-create endpoint at `blocks.py:237-238` and the items-create endpoint at `items.py:44-45` share the same guard, so direct-ORM inserts apply to Sequences and Items too.
- **1-byte placeholder upgraded to `b"%PDF-1.4\n"`** (R5 #5). Rev 5 said "minimal 1-byte file like `b"\x00"`" — when served as `application/pdf` (per `submissions.py:310`, `evaluations.py:231`), a 1-byte null payload triggers a browser PDF-viewer error dialog. PDF magic header avoids the user-visible error during smoke step 13.
- **§13 stale-while-revalidate test added** (R5 #4, #5 — 2× consensus). Asserts `data` stays in DOM during Refresh-triggered refetch; prevents a future refactor from regressing to `data = null` on refresh.
- **§13 retry-after-error test added** (R5 #4). Makes the state-transition contract explicit for both tabs.
- **`sanitizeTitle` test assertion target clarified** (R5 #4). Accented chars become `_`, not preserved — test comment updated.

**R5 items NOT folded in (left for implementor):**

- Item `slug`/`title`/`type` NOT NULL "implementor-obvious" minor (R5 #2 Minor #2) — folded in: §14 now enumerates Item NOT NULL fields.
- `refresh()` cleanup-pattern asymmetry between `$effect` (snapshot) and `refresh()` (mutable reassign) is correct in both places (R5 #1 Minor #3, R5 #4 Minor verified). Asymmetry is intentional (the `$effect` re-fires automatically, `refresh()` is one-shot); the rationale comment is left to the implementer.
- `aria-label="Refresh"` on the Refresh button is redundant with visible text (R5 #4 Minor #13). Cosmetic only; left for the implementor's accessibility-review pass.
- Block.order non-uniqueness note (R5 #1 Minor #2, R5 #5 Minor #9) — informational; no spec change needed.
- §10 query-count undercount of `require_run_admin_or_teacher`'s internal queries (R5 #3 Minor #5) — consistent across §10 endpoints; minor and uniform.

---

## 23. Changes from rev 4

This rev incorporates findings from the 5-Opus panel round 4 against rev 4.

**Critical fixes (rev 4 → rev 5):**
1. **§14 block count math error.** Rev 4 said "4 additional blocks" but listed 5 names; with Slice A's "Intro" the total is 6 (so 5 new, not 4). Fixed to "5 additional blocks" + explicit `order` values (Intro=1, ...Capstone=6).
2. **`Evaluation.feedback_file` CHECK constraint violation.** Per `models.py:330-333`, `result != 'accepted' OR feedback_file IS NOT NULL`. The §14 table now lists `feedback_file="seed/eval-..."` on EVERY non-accepted Evaluation (MP3-A, MP4-B, MP5-C).
3. **Smoke step 13 needs files-on-disk.** `submissions.py:286-310` and `evaluations.py:205-232` check `os.path.isfile(abs_path)` → 404 "File missing" if absent. §14 now requires the seed to write placeholder bytes (e.g., 1-byte file) at every Submission `file_path` and every Evaluation `feedback_file` under the configured storage dirs, with `os.makedirs(..., exist_ok=True)` for rerun safety. Otherwise §14 step 13 fails on Download buttons.

**Important fixes (rev 4 → rev 5):**
- **Stale `_resolve_run_student` references scrubbed.** Lines 147, 152 renamed to `_resolve_run_student_with_user`. Dead helper definition (lines 159-169) DELETED. Line 1557 (§15 files-touched) renamed. The `_resolve_run_student` name no longer appears anywhere in the spec.
- **`Row.tuple()` deprecated in SQLAlchemy 2.0.19+** (emits `DeprecationWarning` which could fail tests under `-W error`). Both `_resolve_sequence_in_version` and `_resolve_run_student_with_user` rewritten to use direct row unpack: `seq, block = row; return seq, block`. Matches existing project pattern.
- **§5.1 query count claim**: "Three queries total" → "Four sequential queries total" (the numbered list immediately following enumerates 4 queries; matches §10 Performance).
- **`refresh()` function body now explicit** in §6.3 (and same shape applies to `RunSubmissionTab.svelte`). Previously only described in prose.
- **`$effect` cleanup snapshots `abortCtl`** via `const ctl = new AbortController(); ...; return () => ctl.abort();`. Previously closed over the outer `let abortCtl`, which races with a concurrent manual `refresh()` reassignment.
- **Disabled-suffix divergence between tabs unified.** Body rendering on BOTH tabs uses `<span class="badge-muted">disabled</span>`. The `' (disabled)'` parenthetical is now ONLY in `<option>` elements (browser limitation: options cannot contain element children). §11 documents the rationale; §14 step 19 wording updated.
- **§14 Question/AnswerOption seed structure specified.** Phase 7c's `_load_quiz_max_per_sequence` (dashboard.py:66-104) computes `quiz_total` from Question + AnswerOption tables, NOT from `UserItemState.last_score_total`. §14 now enumerates: 8 single_choice Questions per quiz item in sequence 1; 5 Questions per quiz item in sequence 2; 0 in sequence 3. Without these, dashboard quiz cells render `—`.
- **§14 Submission + Evaluation required-field list.** Spec now enumerates: `Submission.file_path`, `Submission.file_size > 0`, `Submission.submitted_by` (a real User ID, typically a student in the group), `Submission.submission_number` (≥1); `Evaluation.evaluated_by` (admin or teacher User ID). `MiniProject.is_published=True` for all seeded MPs.
- **MP5 group B `is_resubmission=True` requires 2 submission rows.** §14 now seeds Submission #1 (submission_number=1, is_resubmission=False) AND Submission #2 (submission_number=2, is_resubmission=True, is_late=True) with the Evaluation on #2. Otherwise a lone `is_resubmission=True` row is semantically inconsistent.
- **`sanitizeTitle` is now properly exported from `lib/csvWrite.ts`** in §6.7 (with `export` keyword and full JSDoc). §6.3 cross-references the import location instead of inline-declaring it.
- **§14 mentions seed bypasses `blocks.py:46-47` API state-guard** (adding blocks to a published version via direct ORM — mirrors Slice A's pattern). One-line note added.

**Minor (carried over from R4):**
- Block `order` values pinned in §14 (Intro=1, Linear regression=2, ..., Capstone=6).
- The §6.7 `sanitizeTitle` location move resolves R3 #2's "where does it live" note.
- `Submission.file_path` placeholder string format documented (`"seed/sub-mp{N}-{group}.pdf"`).
- Storage dir handling (`os.makedirs(exist_ok=True)`) documented for idempotent reruns.

---

## 24. Changes from rev 3

This rev incorporates findings from the codex independent review (round 3) after the 5-Opus panel converged at rev 3.

**Critical fixes (rev 3 → rev 4):**
1. **§14 fixture violated `MiniProject` schema.** `MiniProject` has `UniqueConstraint("run_id", "block_id")` — only one MP per (run, block). Rev 3 specified "5 mini-projects in the same block" which is impossible. §14 rewritten to seed 4 additional blocks (Slice A creates 1, dashboards seed appends 4 more for 6 total), one MP per block. The (MP × group) table now explicitly shows 15 cells across the 5 statuses.
2. **`Evaluation.result="needs_revision"` is not a valid enum.** The DB enum at `models.py:322-324` is `rejected | major_revision | minor_revision | accepted`. The dashboard's derived `MpGroupStatus = "needs_revision"` projects from either `"major_revision"` OR `"minor_revision"`. §14 seed updated: MP3 group A uses `result="major_revision"`; MP5 group C uses `result="minor_revision"` (both flavors exercised).

**Important fixes (rev 3 → rev 4):**
- §14 idempotency claim rewritten. Slice A's seed always drops-and-recreates `teaching-smoke-101` (per `seed_teaching_smoke.py:50-63`); the dashboards seed calls Slice A's `seed()` first and then layers its entities on top. Combined script is idempotent across reruns; the "additive" claim is now framed as "additive on top of Slice A's fresh state".
- `_resolve_sequence_in_version` now returns `(Sequence, Block)` tuple to avoid an extra lazy-load query for `block_title` — keeps §10 4-query claim accurate.
- NEW helper `_resolve_run_student_with_user` returns `(RunStudent, User)` so the endpoint can populate `_StudentMeta.{full_name, email}` without an extra `db.get(User, ...)` query. Replaces rev 3's `_resolve_run_student`.
- Refresh button (both tabs) wires the same `abortCtl?.abort()` + new `AbortController` pattern. Otherwise a Refresh click during in-flight initial load lets stale data win.
- §5.1 probe-safety wording corrected: previous rev 3 text claimed "any authenticated user probing nonexistent run IDs sees the same 404 they'd see for an existing-but-unauthorized run" — wrong. An authenticated user CAN distinguish 404 (nonexistent) from 403 (unauthorized); §11 already documents this honestly. §5.1 now matches §11.
- §11 dropped the stale ", open details" suffix from heatmap aria-label (already removed from §6.3).
- §6.7 CSV serializer doc fixed for negative-number self-contradiction. Rule restated as "all values stringified first; formula-injection guard applies uniformly to the stringified form" — so negative numbers DO get the apostrophe (downstream-tool note added).
- §14 step 19 styling wording aligned with §6.3 (muted italic + badge, NOT strikethrough + parens-suffix).
- `sanitizeTitle(title, fallback)` declared as an export from `lib/csvWrite.ts` so both tabs can reuse it (Important note from R3 #2).

**Minor (carried over from R3):**
- (Implementor obvious) `HTTPException` import needs to be added to `dashboard.py`. Not adding boilerplate text to the spec — discoverable on first compile/test run.
- §15 task ordering chain T2/T3 → T4 → T5/T6 → T7 → T8 is implicit; the plan-writing step uses `blockedBy` declarations.

---

## 25. Changes from rev 2

This rev incorporates findings from the 5-reviewer Opus panel round 2.

**Critical fixes (rev 2 → rev 3):**
1. `mp.title` AttributeError — `MiniProject` ORM model has no `title` column. §5.2 rewritten: extract `mini_project_title(block)` helper from `mini_projects.py:44` and call it in both `_serialize_mini_project` and the dashboard MP row assembly.
2. `get_or_404` default detail string is `"{model.__name__} not found"`, not `"Resource not found"`. §5.1 now explicitly requires every `get_or_404` and `HTTPException(404)` to pass `detail="Resource not found"`. Documented known asymmetry: existing sibling endpoints still leak via `"Run not found"` — tracked for future security pass.

**Important fixes (rev 2 → rev 3):**
- Defined `_resolve_run_student` and `_resolve_sequence_in_version` helpers with full signatures and body (module-local in `dashboard.py`).
- Defined explicit Pydantic class bodies for `SequenceItemScore`, `SequenceItemState`, `_SequenceMeta`, `_StudentMeta`, `SequenceItemStateResponse`. New endpoint declares `response_model=SequenceItemStateResponse`.
- `Item.type` Literal pinned to exact 4 values from `schemas.py:97`: `'static_page' | 'video' | 'quiz' | 'interactive_app'` (was incorrectly `'iframe'`).
- Quiz `last_score` guard tightened: emits the score object only when `item_type == 'quiz' AND row exists AND last_score_correct is not None AND last_score_total is not None`. Prevents `{correct: null, total: null}` from breaking the TS contract.
- CSS variable home pinned to `frontend/src/styles/base.css` (not `app.css`). Existing tokens (`--bg`, `--text`, `--muted`, etc.) reused; new tokens (`--surface-muted`, the 10 `--status-*` pairs) added there.
- `.disabled-row` CSS rule defined (`opacity: 0.55; font-style: italic`).
- `<button>` inside `<td>` / `<th>` CSS reset specified, matching the existing `.sort-btn` pattern at `RunAssetsTab.svelte:972-979`.
- Mode-switcher: dropped redundant `class:active`; kept `aria-pressed` (matches existing toggle pattern).
- Helper visibility: `STATUS_LABEL`, `STATUS_ICON`, `STATUS_PRIORITY` exported from `lib/dashboards.ts`; consumed by `StatusBadge.svelte` and `RunSubmissionTab.svelte`. Other component helpers (`compareStudents`, `cellInlineStyle`, etc.) declared component-local.
- Status CSS variable names mirror the enum verbatim (with `_` → `-`): `--status-not-submitted-*`, `--status-awaiting-eval-*`, `--status-needs-revision-*`, `--status-accepted-*`, `--status-rejected-*`. `StatusBadge` maps via `status.replace(/_/g, '-')` — mechanical, no per-status code branch.
- **CSV formula-injection guard rewritten** to OWASP-recognized prefix protection: prepend `'` BEFORE the dangerous first char (`=`, `+`, `-`, `@`, `\t`, `\r`), THEN RFC-4180 quote. Quoting alone is insufficient (Excel ignores quotes when evaluating).
- StatusBadge icon font-family pinned for symbol glyphs (`↻` U+21BB needs symbols-aware fallback).
- §6.4 layout: added the missing `<DashboardSidePanel>` render block on the Submission tab.
- §14 fixture: enumerated concrete entity counts and state seeding for `seed_teaching_dashboards_smoke.py`. Script is now an explicit T8 deliverable, not "TBD in plan T13".
- §13 fetch mocking corrected: project pattern is `vi.stubGlobal('fetch', mockFetch(status, body))` (per `runGroups.test.ts:10-19`). "Contract tests" renamed to "response-shape conformance tests" with caveat about cross-system limits.
- `compareStudents` ratio-computation pseudocode now treats `total === 0` as `null` → sinks to bottom (handles zero-item / zero-question edge cases).
- CSV filename sanitization: added `run-{id}` fallback for all-stripped titles (Cyrillic/CJK).
- `aria-label` on heatmap cell buttons: dropped redundant `", open details"` suffix; empty cells get `": no data"`.
- Empty-cell `<span>` redundant `aria-hidden="false"` dropped.
- `FocusTrap` mechanism re-described accurately (snapshots `document.activeElement`, restores in `$effect` cleanup).
- Sticky-column LTR-only assumption documented inline.
- Side-panel content: when `status === 'awaiting_eval'`, omit the (empty) Evaluation block to avoid redundant "Awaiting evaluation" text below the badge.
- Side-panel `$effect` tracks `target.user_id` / `target.sequence_id` (not the `target` object reference) so reassigning to a new object with same IDs doesn't trigger a spurious refetch.
- §11 added explicit security note about the project-wide 404/403 probe-leak convention.
- Plan estimate committed at 8 tasks (was "~6-8"); added the seed script as part of T8 (was implicit).

---

## 26. Changes from rev 1

This rev incorporates findings from the 5-reviewer Opus panel round 1.

**Critical fixes:**
1. `UserItemState.updated_at` → `UserItemState.last_visited_at` (column doesn't exist; renamed both backend SQL and frontend interface to `last_visited_at`).
2. CSV serialization — explicit new module `lib/csvWrite.ts` (NOT extending `csv.ts` which is parse-only); full RFC 4180 contract with formula-injection guard, BOM, CRLF (§6.7).
3. SQL snippet rewritten as SQLAlchemy ORM (not raw SQL; `Item.order` is reserved word in raw SQL).
4. Auth order pinned: 404(run) → 403(auth) → 404(student) → 404(sequence); all 404s use identical `"Resource not found"` detail string.
5. `DashboardSidePanel` `target` prop reconciled as discriminated union: Progress carries IDs, Submission carries whole objects.
6. Removed false claim about existing `DashboardProgressResponse`/`DashboardMiniProjectsResponse` Pydantic schemas; clarified endpoints return raw dicts and only the new drilldown adds a schema.
7. Endpoint placement → `backend/mathion/api/dashboard.py` (not `runs.py`); tests → new `test_dashboard_item_drilldown.py` (not `test_runs.py`).
8. Status badge colors switched to DARK text on LIGHT backgrounds with verified ≥ 4.5:1 contrast pairs (Tailwind 100-bg / 700-fg).
9. Heatmap cells: `<button>` inside `<td>` (not `role="button"` on `<td>`).
10. `ActiveTab` union extended explicitly.

**Important fixes:**
- `MiniProjectResponse.title` exists — added to dashboard payload via §5.2 additive change (5 LOC).
- Submission/feedback download URLs pinned (`/api/submissions/{sid}/file`, `/api/evaluations/{eid}/feedback-file`).
- TS interfaces fixed nullability: `full_name`, `submitted_by/at`, `evaluated_by/at`.
- `last_score` shape changed to nested `{correct, total} | null` (matches existing `ItemStateResponse`).
- 4 additional backend tests (superuser, different-run teacher, student-of-self, additional probe-protection cases).
- Quiz semantics clarified: drilldown null for unattempted; aggregated dashboard sums to 0 — note in §6.3 + §7.
- AbortController moved into §6.3/§6.4/§6.5 implementation, not just §7 edge cases.
- CSV format pinned: BOM + RFC 4180 + formula-injection guard + CRLF + sanitized filename rule (`/[^A-Za-z0-9 \-_]/g → '_'`, max 60 chars).
- Refresh button decided YES; in §6.3/§6.4 layouts and §14 smoke.
- Sticky widths hard-coded (14rem + 10rem); no JS measurement.
- New components defined: `StatusBadge.svelte` + `csvWrite.ts` (with tests).
- `role="tab"` + `aria-selected` for tab buttons (matches existing).
- `course` prop DROPPED from both new tabs (admitted-unused).
- aria-sort on `<th>` mapped to `ascending/descending/none`; `scope="col"`/`scope="colgroup"`/`scope="row"`.
- Mode switcher: downgraded to `role="group"` + `aria-pressed` buttons (no `radiogroup` arrow-key requirement).
- Empty `—` cells have `aria-label="No data"`.
- CSV column header literal text (no `"..."` placeholders).
- `mp_title` CSV column → uses `mp.title` from §5.2.
- Added edge cases: zero-sequence, ungrouped+filter, teacher-role-loss, version-re-pin race, sort-null collapse.
- §14 step 14 rewritten to use admin UI (not SQL); added CSV-on-Submission, Refresh button, disabled-row, empty-filter steps.
- Added `dashboards.test.ts` contract tests for runtime JSON shape (TS-only doesn't catch backend rename).
- Default-sort note cleaned up (removed mid-write "NO" thought).
- Side panel slide-in pattern justified ("peek, not edit task") and panel width specified.
- Renamed misnamed `humanFileSize` → existing `formatFileSize` from `lib/format.ts`.
