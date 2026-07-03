# Submissions Review — Full Submission History Thread (Slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let teachers/admins see the full history of a group's submissions for a mini-project (every submission newest-first, each with its nested evaluation + PDF download) in the existing `DashboardSidePanel`, instead of only the latest submission.

**Architecture:** One new staff-only, group-scoped backend endpoint in `dashboard.py` returns `{submissions: [...]}` newest-first, reusing the existing `_serialize_submission`/`_serialize_evaluation` helpers (evaluation nested per submission). The frontend adds a `getSubmissionThread` wire + named types, a read-only `SubmissionThreadEntry.svelte` for historical entries, and extends `DashboardSidePanel` to render the newest entry panel-side (with the existing write/edit form, repointed to a `newest` value that becomes authoritative once the thread loads) and older entries via the sub-component.

**Tech Stack:** Backend — FastAPI + SQLAlchemy (Python, run via `backend/.venv`). Frontend — Svelte 5 runes + TypeScript + Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-submissions-review-design.md` (read it before starting; section refs below point to it).

## Global Constraints

- **Frontend:** Svelte 5 runes only; **no** new JS/CSS dependencies. Component tests use `mount`/`unmount`/`flushSync`/`tick` from `svelte`, NOT `@testing-library`.
- **Backend:** run pytest/python via `backend/.venv` (never bare). New endpoint returns a plain `dict` (no `response_model`), reuses `dashboard.py`'s `_serialize_submission` / `_serialize_evaluation` / `_serialize_user_ref`, auth via `require_run_admin_or_teacher`, probe-safe `detail="Resource not found"` on every 404.
- **No change** to the student submission flow, the existing evaluation write/PATCH endpoints, or the dashboard grid endpoint.
- **Endpoint path (exact):** `GET /api/runs/{run_id}/dashboard/mini-projects/{mp_id}/groups/{group_id}/submissions`.
- **Response shape:** `{"submissions": [ <submission fields flat> ..., "evaluation": <eval fields>|null ]}`, `submission_number` descending. Submission/evaluation fields byte-identical to the dashboard cell's `latest_submission`/`latest_evaluation`.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

## File Structure

**Backend**
- Modify: `backend/mathion/api/dashboard.py` — add `get_submission_thread` endpoint (all models/helpers already imported).
- Create: `backend/tests/test_dashboard_submission_thread.py` — endpoint tests.

**Frontend**
- Modify: `frontend/src/lib/dashboards.ts` — extract named types (`ThreadSubmissionBase`, `ThreadEvaluation`, `ThreadSubmission`, `SubmissionThreadResponse`), add `resultToStatus`, add `getSubmissionThread`.
- Create: `frontend/src/tests/dashboards.test.ts` — unit test for `resultToStatus`.
- Create: `frontend/src/components/runs/SubmissionThreadEntry.svelte` — read-only historical-entry component.
- Create: `frontend/src/tests/SubmissionThreadEntry.svelte.test.ts` — component test.
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte` — thread state/fetch/render + write rewiring + `runId` on `SubmissionTarget` + `.banner-error` style.
- Modify: `frontend/src/components/runs/RunSubmissionTab.svelte` — put `runId` into the submission `panelTarget`.
- Modify: `frontend/src/tests/DashboardSidePanel.svelte.test.ts` — retrofit submission tests + new thread tests.
- Modify: `frontend/src/tests/RunSubmissionTab.svelte.test.ts` — retrofit panel-opening tests (TS1/TS2/…) for the on-open thread GET.

---

## Task 1: Backend endpoint + tests

**Files:**
- Modify: `backend/mathion/api/dashboard.py` (add function after `get_mini_projects`, ~line 380)
- Test: `backend/tests/test_dashboard_submission_thread.py` (create)

**Interfaces:**
- Consumes: existing `_serialize_submission(sub, submitter_user_id, submitter_full_name)` (`dashboard.py:250`), `_serialize_evaluation(ev, evaluator_user_id, evaluator_full_name)` (`:264`), `get_or_404(db, model, id, detail=)` (`helpers.py:49`), `require_run_admin_or_teacher(db, user, run)` (`helpers.py:113`). `Run`, `MiniProject`, `Group`, `Submission`, `Evaluation`, `User` already imported in `dashboard.py`.
- Produces: `GET /api/runs/{run_id}/dashboard/mini-projects/{mp_id}/groups/{group_id}/submissions` → `{"submissions": [ {<submission>, "evaluation": <eval>|null}, ... ]}`, `submission_number` desc.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_dashboard_submission_thread.py`:

```python
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from mathion.auth import request_pin, verify_pin
from mathion.main import app
from mathion.models import (
    Block, Evaluation, Group, Item, MiniProject, RunStudent, RunTeacher, Sequence, Submission,
)
from mathion.models_auth import User

THREAD_URL = "/api/runs/{run}/dashboard/mini-projects/{mp}/groups/{group}/submissions"


def _publish_run(admin_client, course_id, groups_enabled=True):
    r = admin_client.post(f"/api/courses/{course_id}/runs", json={
        "title": "Run A", "start_date": "2026-01-01", "end_date": "2026-12-31",
        "groups_enabled": groups_enabled,
    }).json()
    admin_client.post(f"/api/runs/{r['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{r['id']}/publish")
    return r


def _make_run_with_mp(admin_client, db, slug="thr"):
    """Published run + one MP (block 1) + two groups + one student in group 1."""
    course = admin_client.post(
        "/api/courses", json={"slug": slug, "name": slug, "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    block = Block(version_id=version["id"], title="B1", slug="b1", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = _publish_run(admin_client, course["id"], groups_enabled=True)

    g1 = Group(run_id=run["id"], name="G1"); db.add(g1); db.flush()
    g2 = Group(run_id=run["id"], name="G2"); db.add(g2); db.flush()
    student = User(email=f"{slug}-s@example.com", full_name="Stu Dent"); db.add(student); db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=g1.id))
    soft = datetime.now(timezone.utc) + timedelta(days=7)
    hard = datetime.now(timezone.utc) + timedelta(days=14)
    resub = datetime.now(timezone.utc) + timedelta(days=21)
    mp = MiniProject(
        run_id=run["id"], block_id=block.id, assignment_md="x", assignment_html="x",
        soft_deadline=soft, hard_deadline=hard, resubmission_deadline=resub, is_published=True,
    )
    db.add(mp); db.commit()
    return {"run": run, "g1": g1, "g2": g2, "student": student, "mp": mp, "block": block}


def _add_submission(db, mp_id, group_id, student_id, number, *, is_resubmission=False):
    sub = Submission(
        mini_project_id=mp_id, group_id=group_id, submitted_by=student_id,
        submitted_at=datetime.now(timezone.utc), file_path="x",
        submission_number=number, file_size=100 * number,
        is_late=False, is_resubmission=is_resubmission,
    )
    db.add(sub); db.flush()
    return sub


def _add_evaluation(db, submission_id, evaluator_id, result, *, feedback_file="fb.pdf",
                    score=None, feedback_text=None):
    ev = Evaluation(
        submission_id=submission_id, evaluated_by=evaluator_id, result=result,
        feedback_file=feedback_file, score=score, feedback_text=feedback_text,
    )
    db.add(ev); db.flush()
    return ev


def test_thread_newest_first_with_nested_eval(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="nf")
    sub1 = _add_submission(db, ctx["mp"].id, ctx["g1"].id, ctx["student"].id, 1)
    _add_evaluation(db, sub1.id, ctx["student"].id, "rejected", score=40, feedback_text="No")
    _add_submission(db, ctx["mp"].id, ctx["g1"].id, ctx["student"].id, 2, is_resubmission=True)
    db.commit()

    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 200
    subs = r.json()["submissions"]
    assert [s["submission_number"] for s in subs] == [2, 1]  # newest first
    assert subs[0]["evaluation"] is None                     # newest: awaiting
    assert subs[0]["is_resubmission"] is True
    assert subs[0]["submitted_by"]["full_name"] == "Stu Dent"
    assert subs[1]["evaluation"]["result"] == "rejected"
    assert subs[1]["evaluation"]["score"] == 40
    assert subs[1]["evaluation"]["evaluated_by"]["full_name"] == "Stu Dent"
    assert subs[1]["evaluation"]["has_feedback_file"] is True


def test_thread_empty_group_returns_empty_list(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="mt")
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g2"].id))
    assert r.status_code == 200
    assert r.json() == {"submissions": []}


def test_thread_only_target_group(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="og")
    _add_submission(db, ctx["mp"].id, ctx["g1"].id, ctx["student"].id, 1)
    _add_submission(db, ctx["mp"].id, ctx["g2"].id, ctx["student"].id, 1)
    db.commit()
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    subs = r.json()["submissions"]
    assert len(subs) == 1  # g2's submission is excluded (group scoping)
    assert subs[0]["submission_number"] == 1


def test_thread_403_for_student(admin_client, db, student_client_for):
    ctx = _make_run_with_mp(admin_client, db, slug="st")
    c = student_client_for(ctx["student"].email)
    r = c.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 403


def test_thread_403_for_unrelated_user(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="un")
    other = User(email="unrelated@example.com", full_name="Other"); db.add(other); db.commit()
    raw = request_pin(db, other.email)
    tok = verify_pin(db, other.email, raw, duration_days=7)
    c = TestClient(app)
    c.cookies.set("session_token", tok)
    c.headers.update({"X-Requested-With": "mathion"})
    r = c.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 403


def test_thread_200_for_teacher(admin_client, db, teacher_user, teacher_client):
    ctx = _make_run_with_mp(admin_client, db, slug="te")
    db.add(RunTeacher(run_id=ctx["run"]["id"], user_id=teacher_user.id)); db.commit()
    r = teacher_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 200


def test_thread_403_for_teacher_of_another_run(admin_client, db, teacher_user, teacher_client):
    # IDOR: a teacher assigned to a DIFFERENT run must not read this run's thread.
    ctx = _make_run_with_mp(admin_client, db, slug="tar1")
    other = _make_run_with_mp(admin_client, db, slug="tar2")
    db.add(RunTeacher(run_id=other["run"]["id"], user_id=teacher_user.id)); db.commit()  # NOT ctx["run"]
    r = teacher_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 403


def test_thread_404_mp_not_in_run(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="m1")
    other = _make_run_with_mp(admin_client, db, slug="m2")  # mp belongs to another run
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=other["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"


def test_thread_404_group_not_in_run(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="g1x")
    other = _make_run_with_mp(admin_client, db, slug="g2x")  # group belongs to another run
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=other["g1"].id))
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"


def test_thread_404_nonexistent_ids_are_probe_safe(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="ps")
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=999999, group=ctx["g1"].id))
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_dashboard_submission_thread.py -v`
Expected: FAIL — the route does not exist yet, so FastAPI returns `404 {"detail":"Not Found"}` for the path. Concretely: the 200-expecting tests fail on the status code; the 404-expecting probe-safe tests fail on the `detail` assertion (`"Not Found" != "Resource not found"`); the ordering/scoping tests fail with a `KeyError` on `r.json()["submissions"]`. Net: all fail before the endpoint is implemented.

- [ ] **Step 3: Implement the endpoint**

In `backend/mathion/api/dashboard.py`, add immediately after `get_mini_projects` (after its `return {...}`, ~line 380, before the `# ===` separator):

```python
@router.get("/api/runs/{run_id}/dashboard/mini-projects/{mp_id}/groups/{group_id}/submissions")
def get_submission_thread(
    run_id: int,
    mp_id: int,
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Full submission history (newest-first) for one group x mini-project.

    Staff-only review surface. All 404s use detail="Resource not found" to
    prevent enumeration (matches the item-drilldown convention). Reuses the
    grid serializers so the thread shape matches the dashboard cell exactly.
    """
    run = get_or_404(db, Run, run_id, detail="Resource not found")
    require_run_admin_or_teacher(db, user, run)

    mp = get_or_404(db, MiniProject, mp_id, detail="Resource not found")
    if mp.run_id != run_id:
        raise HTTPException(status_code=404, detail="Resource not found")
    group = get_or_404(db, Group, group_id, detail="Resource not found")
    if group.run_id != run_id:
        raise HTTPException(status_code=404, detail="Resource not found")

    # 1. All submissions for (mp, group), newest-first, + submitter name (OUTER).
    sub_rows = db.execute(
        select(Submission, User.id, User.full_name)
        .outerjoin(User, User.id == Submission.submitted_by)
        .where(
            Submission.mini_project_id == mp_id,
            Submission.group_id == group_id,
        )
        .order_by(Submission.submission_number.desc())
    ).all()

    # 2. Evaluations for those submissions, indexed by submission_id, + evaluator name (OUTER).
    submission_ids = [sub.id for sub, _, _ in sub_rows]
    eval_by_sub: dict[int, tuple] = {}
    if submission_ids:
        eval_rows = db.execute(
            select(Evaluation, User.id, User.full_name)
            .outerjoin(User, User.id == Evaluation.evaluated_by)
            .where(Evaluation.submission_id.in_(submission_ids))
        ).all()
        for ev, ev_by_id, ev_by_name in eval_rows:
            eval_by_sub[ev.submission_id] = (ev, ev_by_id, ev_by_name)

    # 3. Stitch: each submission with its nested evaluation (or None).
    submissions = []
    for sub, sub_by_id, sub_by_name in sub_rows:
        entry = _serialize_submission(sub, sub_by_id, sub_by_name)
        ev_tuple = eval_by_sub.get(sub.id)
        if ev_tuple is not None:
            ev, ev_by_id, ev_by_name = ev_tuple
            entry["evaluation"] = _serialize_evaluation(ev, ev_by_id, ev_by_name)
        else:
            entry["evaluation"] = None
        submissions.append(entry)

    return {"submissions": submissions}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_dashboard_submission_thread.py -v`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Run the dashboard suite to check for regressions**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_dashboard_mini_projects.py tests/test_dashboard_item_drilldown.py tests/test_dashboard_progress.py -q`
Expected: PASS (no regressions — the new route is additive).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/dashboard.py backend/tests/test_dashboard_submission_thread.py
git commit -m "feat(dashboard): add group submission-thread endpoint (Slice B)"
```

---

## Task 2: Frontend types + `resultToStatus` + wire function

**Files:**
- Modify: `frontend/src/lib/dashboards.ts` (types at `:76-99`, wires after `:162`)
- Test: `frontend/src/tests/dashboards.test.ts` (create)

**Interfaces:**
- Consumes: existing `MpGroupStatus` (`dashboards.ts:8`), `api.get` (`api.ts:68`).
- Produces:
  - `ThreadSubmissionBase` (the `latest_submission` shape), `ThreadEvaluation` (the `latest_evaluation` shape), `ThreadSubmission = ThreadSubmissionBase & { evaluation: ThreadEvaluation | null }`, `SubmissionThreadResponse = { submissions: ThreadSubmission[] }`.
  - `resultToStatus(result: string | null): MpGroupStatus`.
  - `getSubmissionThread(runId: number, mpId: number, groupId: number, opts?: { signal?: AbortSignal }): Promise<SubmissionThreadResponse>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/dashboards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resultToStatus } from '../lib/dashboards';

describe('resultToStatus (mirrors backend _derive_status)', () => {
  it('null → awaiting_eval', () => expect(resultToStatus(null)).toBe('awaiting_eval'));
  it('major_revision → needs_revision', () => expect(resultToStatus('major_revision')).toBe('needs_revision'));
  it('minor_revision → needs_revision', () => expect(resultToStatus('minor_revision')).toBe('needs_revision'));
  it('accepted → accepted', () => expect(resultToStatus('accepted')).toBe('accepted'));
  it('rejected → rejected', () => expect(resultToStatus('rejected')).toBe('rejected'));
  it('unknown → awaiting_eval (defensive)', () => expect(resultToStatus('weird')).toBe('awaiting_eval'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/dashboards.test.ts`
Expected: FAIL — `resultToStatus` is not exported (import error / undefined).

- [ ] **Step 3: Extract named types**

In `frontend/src/lib/dashboards.ts`, replace the `DashboardMpGroupEntry` interface (currently `:76-99`, with inline `latest_submission`/`latest_evaluation` object types) with named types + a reference:

```ts
export interface ThreadSubmissionBase {
  id: number;
  submission_number: number;
  submitted_at: string | null;
  submitted_by: { user_id: number; full_name: string | null } | null;
  is_late: boolean;
  is_resubmission: boolean;
  file_size: number;
}

export interface ThreadEvaluation {
  id: number;
  evaluated_at: string | null;
  evaluated_by: { user_id: number; full_name: string | null } | null;
  result: string;
  score: number | null;
  feedback_text: string | null;
  has_feedback_file: boolean;
}

export type ThreadSubmission = ThreadSubmissionBase & { evaluation: ThreadEvaluation | null };

export interface SubmissionThreadResponse {
  submissions: ThreadSubmission[];
}

export interface DashboardMpGroupEntry {
  group_id: number;
  group_name: string;
  group_is_disabled: boolean;
  status: MpGroupStatus;
  latest_submission: ThreadSubmissionBase | null;
  latest_evaluation: ThreadEvaluation | null;
}
```

- [ ] **Step 4: Add `resultToStatus`**

In `frontend/src/lib/dashboards.ts`, after the `STATUS_PRIORITY` block (`:38`), add:

```ts
// Maps an evaluation result to the grid status badge. Mirrors backend
// _derive_status (dashboard.py:229-241) for the case where a submission
// EXISTS (a thread entry always has a submission, so 'not_submitted' is
// unreachable here). Param is `string` because ThreadEvaluation.result is
// `string`; unknown values fall through to awaiting_eval (backend's defensive
// default).
export function resultToStatus(result: string | null): MpGroupStatus {
  if (result === null) return 'awaiting_eval';
  if (result === 'major_revision' || result === 'minor_revision') return 'needs_revision';
  if (result === 'accepted') return 'accepted';
  if (result === 'rejected') return 'rejected';
  return 'awaiting_eval';
}
```

- [ ] **Step 5: Add the wire function**

In `frontend/src/lib/dashboards.ts`, after `getSequenceItemState` (`:164-174`), add:

```ts
export async function getSubmissionThread(
  runId: number,
  mpId: number,
  groupId: number,
  opts?: { signal?: AbortSignal },
): Promise<SubmissionThreadResponse> {
  return api.get<SubmissionThreadResponse>(
    `/api/runs/${runId}/dashboard/mini-projects/${mpId}/groups/${groupId}/submissions`,
    opts,
  );
}
```

- [ ] **Step 6: Run the test + typecheck**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/dashboards.test.ts && npx svelte-check --tsconfig ./tsconfig.json`
Expected: test PASS; svelte-check reports no new errors (the type extraction is behaviour-preserving — the only consumers of the inline types are `DashboardSidePanel` and the CSV export, both reading fields still present).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/dashboards.ts frontend/src/tests/dashboards.test.ts
git commit -m "feat(dashboards): thread types, resultToStatus, getSubmissionThread wire (Slice B)"
```

---

## Task 3: `SubmissionThreadEntry.svelte` read-only sub-component

**Files:**
- Create: `frontend/src/components/runs/SubmissionThreadEntry.svelte`
- Test: `frontend/src/tests/SubmissionThreadEntry.svelte.test.ts` (create)

**Interfaces:**
- Consumes: `ThreadSubmission`, `resultToStatus` (Task 2); `StatusBadge` (`../ui/StatusBadge.svelte`), `formatLocalWithTz` (`../../lib/datetime`), `formatFileSize` (`../../lib/format`).
- Produces: default-exported component with props `{ submission: ThreadSubmission; expanded: boolean; onToggle: () => void }`. Renders a collapsed disclosure summary (`aria-expanded`, `data-test="thread-entry-toggle"`) always; the submission block + auto-accept banner + read-only evaluation view only when `expanded`. No write logic.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/SubmissionThreadEntry.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SubmissionThreadEntry from '../components/runs/SubmissionThreadEntry.svelte';
import type { ThreadSubmission } from '../lib/dashboards';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

function makeSubmission(overrides: Partial<ThreadSubmission> = {}): ThreadSubmission {
  return {
    id: 42, submission_number: 3, submitted_at: '2026-06-01T10:00:00Z',
    submitted_by: { user_id: 5, full_name: 'Alice' },
    is_late: false, is_resubmission: false, file_size: 2048,
    evaluation: {
      id: 11, evaluated_at: '2026-06-02T09:00:00Z',
      evaluated_by: { user_id: 3, full_name: 'Prof' },
      result: 'accepted', score: 90, feedback_text: 'Good', has_feedback_file: true,
    },
    ...overrides,
  };
}

function mountEntry(submission: ThreadSubmission, expanded: boolean, onToggle = () => {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(SubmissionThreadEntry, { target: host, props: { submission, expanded, onToggle } });
  flushSync();
  return host;
}

describe('SubmissionThreadEntry', () => {
  it('collapsed: shows summary + badge, hides submission/evaluation detail', () => {
    mountEntry(makeSubmission(), false);
    const toggle = host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).toContain('Submission 3');
    expect(host.textContent).toContain('Accepted'); // StatusBadge label for accepted
    expect(host.querySelector('a.download-link')).toBeNull();
  });

  it('expanded: shows submission block, evaluation, both download links', () => {
    mountEntry(makeSubmission(), true);
    const toggle = host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('File size:');
    expect(host.textContent).toContain('Result: accepted');
    const links = Array.from(host.querySelectorAll('a.download-link')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/api/submissions/42/file');
    expect(links).toContain('/api/evaluations/11/feedback-file');
  });

  it('expanded + null evaluation: shows "Awaiting evaluation" and awaiting badge', () => {
    mountEntry(makeSubmission({ evaluation: null }), true);
    expect(host.textContent).toContain('Awaiting evaluation');
    const badge = host.querySelector('.status-badge') as HTMLElement;
    expect(badge.getAttribute('data-status')).toBe('awaiting_eval');
  });

  it('expanded + is_resubmission: shows auto-accept banner', () => {
    mountEntry(makeSubmission({ is_resubmission: true }), true);
    expect(host.textContent).toContain('Auto-accepted on resubmission');
  });

  it('clicking the summary calls onToggle', () => {
    let toggled = 0;
    mountEntry(makeSubmission(), false, () => { toggled += 1; });
    (host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement).click();
    flushSync();
    expect(toggled).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/SubmissionThreadEntry.svelte.test.ts`
Expected: FAIL — component file does not exist (import error).

- [ ] **Step 3: Create the component**

Create `frontend/src/components/runs/SubmissionThreadEntry.svelte`:

```svelte
<!-- frontend/src/components/runs/SubmissionThreadEntry.svelte -->
<!-- Read-only historical submission entry for the DashboardSidePanel thread.
     Newest entry is rendered by the panel itself; this renders thread[1..]. -->
<script lang="ts">
  import { type ThreadSubmission, resultToStatus } from '../../lib/dashboards';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { formatFileSize } from '../../lib/format';

  let { submission, expanded, onToggle }: {
    submission: ThreadSubmission;
    expanded: boolean;
    onToggle: () => void;
  } = $props();

  const evaluation = $derived(submission.evaluation);
  const summaryDate = $derived(
    submission.submitted_at ? formatLocalWithTz(submission.submitted_at) : '—',
  );
</script>

<div class="thread-entry" data-test="thread-entry" data-submission-id={submission.id}>
  <button
    type="button"
    class="thread-entry-summary"
    data-test="thread-entry-toggle"
    aria-expanded={expanded}
    onclick={onToggle}
  >
    <span>Submission {submission.submission_number}</span>
    <span aria-hidden="true">·</span>
    <span>{summaryDate}</span>
    <span aria-hidden="true">·</span>
    <StatusBadge status={resultToStatus(evaluation?.result ?? null)} />
  </button>

  {#if expanded}
    <section class="submission-block">
      <h4>Submission</h4>
      <p>Number: {submission.submission_number}</p>
      <p>Submitted at: {submission.submitted_at ? formatLocalWithTz(submission.submitted_at) : '—'}</p>
      <p>Submitted by: {submission.submitted_by?.full_name ?? submission.submitted_by?.user_id ?? '—'}</p>
      <p>Late: {submission.is_late ? 'Yes' : 'No'}</p>
      <p>Resubmission: {submission.is_resubmission ? 'Yes' : 'No'}</p>
      <p>File size: {formatFileSize(submission.file_size)}</p>
      <a class="download-link" href={`/api/submissions/${submission.id}/file`} download>Download submission</a>
    </section>

    {#if submission.is_resubmission}
      <div role="status" class="banner-info">
        Auto-accepted on resubmission. No manual evaluation needed.
      </div>
    {/if}

    {#if evaluation}
      <section class="evaluation-block">
        <h4>Evaluation</h4>
        <p>Evaluated at: {evaluation.evaluated_at ? formatLocalWithTz(evaluation.evaluated_at) : '—'}</p>
        <p>Evaluated by: {evaluation.evaluated_by?.full_name ?? evaluation.evaluated_by?.user_id ?? '—'}</p>
        <p>Result: {evaluation.result}</p>
        <p>Score: {evaluation.score ?? '—'}</p>
        <p>Feedback: {evaluation.feedback_text ?? '—'}</p>
        {#if evaluation.has_feedback_file}
          <a class="download-link" href={`/api/evaluations/${evaluation.id}/feedback-file`} download>Download feedback file</a>
        {/if}
      </section>
    {:else}
      <p>Awaiting evaluation</p>
    {/if}
  {/if}
</div>

<style>
  .thread-entry-summary {
    display: flex; align-items: center; gap: 0.5rem;
    width: 100%; text-align: left; background: none; border: none;
    padding: 0.5rem 0; cursor: pointer; font: inherit;
  }
  .banner-info {
    padding: 0.75rem 1rem; border-radius: 4px;
    background: #e0f2f8; color: #044d6c; border-left: 4px solid #0a7ea4;
    margin-bottom: 1rem;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/SubmissionThreadEntry.svelte.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/runs/SubmissionThreadEntry.svelte frontend/src/tests/SubmissionThreadEntry.svelte.test.ts
git commit -m "feat(runs): read-only SubmissionThreadEntry component (Slice B)"
```

---

## Task 4: Panel integration — thread fetch, render, write rewiring, `runId` plumbing, test retrofit

This is the integration task. It (a) plumbs `runId`, (b) adds thread state/fetch, (c) repoints the newest render to a `newest` value, (d) adds the historical region + loading/error/retry, (e) rewires the write flow, (f) adds the `.banner-error` style, then retrofits the two affected test files and adds new tests. Split into two commits (integration+retrofit green, then new tests).

**Files:**
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte`
- Modify: `frontend/src/components/runs/RunSubmissionTab.svelte` (`:38-43` panelTarget only — `openPanel` `:129-131` is unchanged)
- Modify: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`
- Modify: `frontend/src/tests/RunSubmissionTab.svelte.test.ts`

**Interfaces:**
- Consumes: `getSubmissionThread`, `ThreadSubmission` (Task 2); `SubmissionThreadEntry` (Task 3).
- Produces: `SubmissionTarget` gains `runId: number`. Panel behaviour: on open of a submitted cell it fetches the thread; newest entry rendered panel-side from `newest` (a `$derived` `ThreadSubmission | null`); create posts to `newest.id`; write success/409 refetch the thread + call `onRefetch()`.

### Part A — `runId` plumbing

- [ ] **Step 1: Add `runId` to `SubmissionTarget`**

In `frontend/src/components/runs/DashboardSidePanel.svelte`, edit the `SubmissionTarget` type (`:31-35`):

```ts
  type SubmissionTarget = {
    kind: 'submission';
    runId: number;
    mp: DashboardMpRow;
    entry: DashboardMpGroupEntry;
  };
```

- [ ] **Step 2: Populate `runId` in `RunSubmissionTab.panelTarget`**

In `frontend/src/components/runs/RunSubmissionTab.svelte`, edit `panelTarget` (`:38-43`) to include `runId` (already a component prop, `:14`):

```ts
  const panelTarget = $derived.by(() => {
    if (selectedIds == null || data == null) return null;
    const mp = data.mini_projects.find((m) => m.id === selectedIds!.mpId);
    const entry = mp?.groups.find((g) => g.group_id === selectedIds!.groupId);
    return mp && entry ? { kind: 'submission' as const, runId, mp, entry } : null;
  });
```

### Part B — Thread state, primitives, `newest`, fetch

- [ ] **Step 3: Add imports**

In `DashboardSidePanel.svelte`, extend the `dashboards` import (`:8-13`) and add the sub-component import (after `:17`):

```ts
  import {
    getSequenceItemState,
    getSubmissionThread,
    type SequenceItemStateResponse,
    type DashboardMpRow,
    type DashboardMpGroupEntry,
    type ThreadSubmission,
  } from '../../lib/dashboards';
```
```ts
  import SubmissionThreadEntry from './SubmissionThreadEntry.svelte';
```

- [ ] **Step 4: Add thread state + derived primitives + `newest` + expanded state**

In `DashboardSidePanel.svelte`, immediately after the `effectiveEvaluation` `$derived.by` block (currently `:78-81`), add:

```ts
  // --- Submission thread (Slice B) ---
  let threadState = $state<ThreadSubmission[] | null>(null);
  let threadLoading = $state(false);
  let threadError = $state(false);
  let threadCtl: AbortController | null = null;
  let expandedById = $state<Record<number, boolean>>({});

  // Gated primitive ids — the fetch effect reads ONLY primitive $derived (these three
  // plus the sub/eval-id primitives declared below), never `target` inline, so it fires
  // once per (cell + cell sub/eval-id state): the ids recompute to strict-equal values
  // across an onRefetch()-driven `target` object swap, so a no-op refresh propagates
  // nothing. null when not a submission target or nothing submitted yet.
  const submissionRunId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.runId : null,
  );
  const submissionMpId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.mp.id : null,
  );
  const submissionGroupId = $derived(
    target.kind === 'submission' && target.entry.latest_submission != null ? target.entry.group_id : null,
  );
  // Also key the fetch effect on the cell's latest submission/evaluation ids so an
  // EXTERNAL grid refresh (onRefetch reassigns `data` → a new cell entry with a
  // changed submission or evaluation) re-fetches the thread — spec §8: "surfaced on
  // the next thread refetch / manual grid refresh". Primitive values → no refire when
  // the ids are unchanged (a no-op grid refresh does not refetch). After a create
  // write the cell's evaluation id changes null→N via onRefetch, so the effect DOES
  // refire and fetches once more on top of Step 11's manual refetch; this is benign
  // (loadThread aborts the prior in-flight request, so the two serialize) and is the
  // same mechanism that surfaces a concurrent external evaluation.
  const submissionLatestSubId = $derived(
    target.kind === 'submission' ? (target.entry.latest_submission?.id ?? null) : null,
  );
  const submissionLatestEvalId = $derived(
    target.kind === 'submission' ? (target.entry.latest_evaluation?.id ?? null) : null,
  );

  // The authoritative newest entry. Once the thread resolves, thread[0] wins
  // (may differ from the cell entry if the group resubmitted). Before that (or
  // defensively if the thread resolves empty) fall back to the cell entry.
  const newest = $derived.by<ThreadSubmission | null>(() => {
    if (target.kind !== 'submission' || target.entry.latest_submission == null) return null;
    if (threadState != null && threadState.length > 0) return threadState[0];
    return { ...target.entry.latest_submission, evaluation: target.entry.latest_evaluation };
  });

  function loadThread(runId: number, mpId: number, groupId: number) {
    threadCtl?.abort();
    const ctl = new AbortController();
    threadCtl = ctl;
    threadLoading = true; threadError = false; threadState = null;
    getSubmissionThread(runId, mpId, groupId, { signal: ctl.signal })
      .then((res) => { if (ctl.signal.aborted) return; threadState = res.submissions; threadLoading = false; })
      .catch((err: unknown) => {
        if (ctl.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
        threadError = true; threadLoading = false;
      });
  }

  function retryThread() {
    if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
      loadThread(submissionRunId, submissionMpId, submissionGroupId);
    }
  }

  function toggleThreadEntry(id: number) {
    expandedById = { ...expandedById, [id]: !expandedById[id] };
  }
```

- [ ] **Step 5: Redefine `effectiveEvaluation` to read `newest`**

**DELETE** the original `effectiveEvaluation` `$derived.by` block at `:78-81` and re-declare it just after the `newest` declaration from Step 4. Do NOT leave the `:78-81` copy in place — two `const effectiveEvaluation` is a `TS2451 Cannot redeclare block-scoped variable` error. Change its body to read `newest?.evaluation` instead of `target.entry.latest_evaluation`. Final placement order: `newest` → `effectiveEvaluation` → `existingHasFeedbackFile`/`resultLocked` (`:83-84`) → the raceTransition `$effect` (`:86-88`). Final form:

```ts
  const effectiveEvaluation = $derived.by(() => {
    if (target.kind !== 'submission') return null;
    return stateLatestEvaluation ?? newest?.evaluation ?? null;
  });
```

(Reorder so the block sequence is: `newest` … then `effectiveEvaluation` … then `existingHasFeedbackFile` / `resultLocked` which depend on `effectiveEvaluation`.)

- [ ] **Step 6: Add the thread-fetch `$effect`**

In `DashboardSidePanel.svelte`, after the existing progress `$effect` (ends `:333`), add a sibling effect:

```ts
  // Thread fetch — keyed on the gated primitive ids only (see their comment).
  // Fires once per (cell + cell-submission/eval-id state): on a genuine cell switch
  // AND when an external grid refresh lands a new submission/evaluation for the same
  // cell. `loadThread` nulls `threadState` on every fire, so a cell switch shows the
  // new cell's own optimistic newest rather than the previous cell's thread[0].
  //
  // NOTE: it deliberately does NOT reset `expandedById`. That map is keyed by
  // globally-unique submission id, so a switched-away cell's keys are inert (no other
  // cell can carry the same submission id) — while NOT clearing it is exactly what
  // makes a write survive the post-write refire without collapsing expanded history
  // (spec §6.2). Clearing it here would collapse an expanded older entry every time a
  // create write's onRefetch changes the cell's evaluation id.
  $effect(() => {
    const runId = submissionRunId;
    const mpId = submissionMpId;
    const groupId = submissionGroupId;
    // Track the cell's submission/eval ids too, so an external grid refresh that
    // changes either re-fetches the thread (see their declaration comment). `void`
    // reads register the reactive dependency without using the values.
    void submissionLatestSubId;
    void submissionLatestEvalId;
    threadCtl?.abort();
    if (runId == null || mpId == null || groupId == null) {
      threadState = null; threadLoading = false; threadError = false;
      return;
    }
    loadThread(runId, mpId, groupId);
    return () => threadCtl?.abort();
  });
```

### Part C — Repoint the newest render + add the historical region

- [ ] **Step 7: Repoint the submission render from `target.entry.latest_submission` to `newest`**

In `DashboardSidePanel.svelte`, in the submission branch of the template, change the gate and the `{@const}` (currently `:402-405`):

Replace:
```svelte
      {#if target.entry.latest_submission == null}
        <p>Not submitted yet.</p>
      {:else}
        {@const sub = target.entry.latest_submission}
```
with:
```svelte
      {#if newest == null}
        <p>Not submitted yet.</p>
      {:else}
        {@const sub = newest}
```

The submission block (`:406-415`) already reads `sub.*` — now backed by `newest`. The `{#if sub.is_resubmission}` auto-accept branch (`:417`) now reads `newest.is_resubmission`.

- [ ] **Step 8: Repoint the auto-accept eval block to `newest.evaluation`**

In the auto-accept branch (`:421-435`), change the nested-eval source from `target.entry.latest_evaluation` to `newest.evaluation`:

```svelte
        {#if sub.is_resubmission}
          <div role="status" class="banner-info">
            Auto-accepted on resubmission. No manual evaluation needed.
          </div>
          {#if sub.evaluation}
            {@const evalu = sub.evaluation}
            <section class="evaluation-block">
              <h4>Evaluation</h4>
              <p>Evaluated at: {evalu.evaluated_at ? formatLocalWithTz(evalu.evaluated_at) : '—'}</p>
              <p>Evaluated by: {evalu.evaluated_by?.full_name ?? evalu.evaluated_by?.user_id ?? '—'}</p>
              <p>Result: {evalu.result}</p>
              <p>Score: {evalu.score ?? '—'}</p>
              <p>Feedback: {evalu.feedback_text ?? '—'}</p>
              {#if evalu.has_feedback_file}
                <a class="download-link" href={`/api/evaluations/${evalu.id}/feedback-file`} download>Download feedback file</a>
              {/if}
            </section>
          {/if}
```

- [ ] **Step 9: Move the Branch-B "Just now"/"You" bridge discriminator to `newest.evaluation`**

In the Branch-B eval block (`:439-449`), change the two discriminator reads from `target.entry.latest_evaluation` to `newest.evaluation` (so after a fresh POST — where `stateLatestEvaluation` is set but the thread hasn't refetched — the bridge shows "Just now"/"You", and after refetch shows the real values):

```svelte
        {:else if effectiveEvaluation}
          {@const evalu = effectiveEvaluation}
          <section class="evaluation-block">
            <h4>Evaluation</h4>
            <p>Evaluated at: {sub.evaluation ? (sub.evaluation.evaluated_at ? formatLocalWithTz(sub.evaluation.evaluated_at) : '—') : 'Just now'}</p>
            <p>Evaluated by: {sub.evaluation ? (sub.evaluation.evaluated_by?.full_name ?? sub.evaluation.evaluated_by?.user_id ?? '—') : 'You'}</p>
            <p>Result: {evalu.result}</p>
            <p>Score: {evalu.score ?? '—'}</p>
            <p>Feedback: {evalu.feedback_text ?? '—'}</p>
            {#if evalu.has_feedback_file}
              <a class="download-link" href={`/api/evaluations/${evalu.id}/feedback-file`} download>Download feedback file</a>
            {/if}
          </section>
```

(The `{#if canWrite && !editing}` [Edit] button and the two forms below stay exactly as-is.)

- [ ] **Step 10: Add the historical region**

In `DashboardSidePanel.svelte`, inside the `{:else}` (i.e. `newest != null`) branch, AFTER the whole submission/eval/form block closes (i.e. after the `{/if}` that closes the `{#if sub.is_resubmission}…{:else if…}{:else}<p>Awaiting evaluation</p>{/if}` chain at `:592`, and BEFORE the outer `{/if}` at `:593`), add:

```svelte
        {#if threadLoading}
          <p data-test="thread-loading">Loading previous submissions…</p>
        {:else if threadError}
          <p class="banner-error" role="alert" data-test="thread-error">
            Couldn't load submission history.
            <button type="button" data-test="thread-retry" onclick={retryThread}>Retry</button>
          </p>
        {:else if threadState && threadState.length > 1}
          <h4>Previous submissions</h4>
          <div data-test="thread-history">
            {#each threadState.slice(1) as histSub (histSub.id)}
              <SubmissionThreadEntry
                submission={histSub}
                expanded={!!expandedById[histSub.id]}
                onToggle={() => toggleThreadEntry(histSub.id)}
              />
            {/each}
          </div>
        {/if}
```

### Part D — Write rewiring

- [ ] **Step 11: Create posts to `newest.id`; refetch thread after success/409**

In `handleSave` (`:172-241`), make three changes:

(1) Change the create target (`:184`) from `target.entry.latest_submission!.id` to `newest!.id`:

```ts
      if (effectiveEvaluation == null) {
        if (target.kind !== 'submission' || newest == null) throw new Error('handleSave called with no submission');
        result = await createEvaluation({
          submission_id: newest.id,
          result: formResult as EvaluationResult,
          score: formScore,
          feedback_text: formFeedbackText || null,
          feedback_file: formFeedbackFile,
        }, { signal: submitController.signal });
      } else {
```

(2) After the success block sets `stateLatestEvaluation = result` and calls `onRefetch()` (`:197,210`), add a thread refetch right after `onRefetch();` (`:210`):

```ts
      pushToast('Evaluation saved; group notified', 'success');
      onRefetch();
      if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
        loadThread(submissionRunId, submissionMpId, submissionGroupId);
      }
      await tick();
```

(3) In the 409 branch (`:215-219`), add the same thread refetch after `onRefetch();`:

```ts
      if (e instanceof ApiError && e.status === 409) {
        raceTransition = true;
        editing = false;
        onRefetch();
        if (submissionRunId != null && submissionMpId != null && submissionGroupId != null) {
          loadThread(submissionRunId, submissionMpId, submissionGroupId);
        }
        return;
      }
```

- [ ] **Step 12: Clear `stateLatestEvaluation` when the refetch lands (guarded against mid-edit)**

Extend `loadThread`'s `.then` so that once the thread resolves and carries a real newest evaluation, the flat post-write bridge value is dropped — but never while the user is editing (clearing flips `effectiveEvaluation` identity and would re-fire the prefill `$effect`). Replace the `.then` in `loadThread` (Step 4) with:

```ts
      .then((res) => {
        if (ctl.signal.aborted) return;
        threadState = res.submissions;
        threadLoading = false;
        // Post-write bridge (stateLatestEvaluation) is now superseded by the
        // nested thread evaluation; drop it so the newest render matches every
        // other entry — but not mid-edit (would reset the in-progress form).
        if (!editing && res.submissions.length > 0 && res.submissions[0].evaluation != null) {
          stateLatestEvaluation = null;
        }
      })
```

### Part E — Style

- [ ] **Step 13: Add the `.banner-error` rule**

In `DashboardSidePanel.svelte`'s `<style>` block (`:609-648`), after the `.banner-info` rule (`:628`), add:

```css
  .banner-error {
    padding: 0.75rem 1rem;
    border-radius: 4px;
    background: #fdecea;
    color: #611a15;
    border-left: 4px solid #c53030;
    margin-bottom: 1rem;
  }
```

### Part F — Retrofit existing tests

- [ ] **Step 14: Add shared test helpers + `runId` to the fixture**

In `frontend/src/tests/DashboardSidePanel.svelte.test.ts`, after `mockFetch` (`:27`), add a URL/method-routing fetch helper and a cell-echoing thread builder. (Do NOT add an `import type { DashboardMpGroupEntry }` line — it is already imported at `:6`; a second import is a `TS2300 Duplicate identifier` under this tsconfig. `PanelTarget` is likewise already imported at `:5`.)

```ts
// Routes fetch by URL+method: thread GET → `thread`; evaluation POST/PATCH → `evalResponse`.
function routedFetch(opts: { thread?: unknown; evalResponse?: { status: number; body: unknown } } = {}) {
  const threadBody = opts.thread ?? { submissions: [] };
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    if (method === 'GET' && u.includes('/groups/') && u.endsWith('/submissions')) {
      return Promise.resolve(new Response(JSON.stringify(threadBody), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    const er = opts.evalResponse ?? { status: 201, body: {} };
    return Promise.resolve(new Response(JSON.stringify(er.body), {
      status: er.status, headers: { 'Content-Type': 'application/json' },
    }));
  });
}

// Serves thread GETs from `threads` in order (last entry sticks); eval POST/PATCH from `evalResponse`.
// Use when the thread body must DIFFER across fetches (mount vs post-write/409 refetch).
function sequencedThreadFetch(threads: unknown[], evalResponse?: { status: number; body: unknown }) {
  let i = 0;
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    if (method === 'GET' && u.includes('/groups/') && u.endsWith('/submissions')) {
      const t = threads[Math.min(i, threads.length - 1)] ?? { submissions: [] };
      i += 1;
      return Promise.resolve(new Response(JSON.stringify(t), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    const er = evalResponse ?? { status: 201, body: {} };
    return Promise.resolve(new Response(JSON.stringify(er.body), {
      status: er.status, headers: { 'Content-Type': 'application/json' },
    }));
  });
}

// Thread body whose single entry mirrors a submission target's cell entry.
function echoThread(target: { entry: DashboardMpGroupEntry }) {
  const s = target.entry.latest_submission!;
  return { submissions: [{ ...s, evaluation: target.entry.latest_evaluation }] };
}

// Eval-endpoint calls only (thread GETs are filtered out). The `u` slot is elided
// with a leading comma — `noUnusedParameters` is on, so a named-but-unused `u` fails.
function evalCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, i]) => {
    const method = ((i as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return method === 'POST' || method === 'PATCH';
  }) as [string, RequestInit][];
}
```

Then add `runId` to the `submissionTarget()` fixture return (`:151`):

```ts
  return { kind: 'submission' as const, runId: 1, mp: makeMp(), entry };
```

Add a DEFAULT empty-thread stub to `beforeEach` (`:61-64`) so EVERY submission test starts with a served thread GET. An empty thread makes `newest` fall back to the optimistic cell entry (Task 4 Step 5), so the panel renders exactly as it does today with no per-test wiring — this is what covers the display tests in Step 15. Change `beforeEach` to:

```ts
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(pushToast).mockClear();
  vi.stubGlobal('fetch', routedFetch()); // default: empty thread; tests needing a body/eval override this
});
```

(The vitest config sets `globals: false` with no `unstubGlobals`, so a `stubGlobal` persists across tests; re-setting it in `beforeEach` gives each test a clean empty-thread default that overrides any leftover from a prior test.)

Add `runId: 1` to every submission target built INLINE (not via `submissionTarget()`), so the derived `submissionRunId` is non-null and svelte-check passes. Grep `kind: 'submission'` — the inline literals are at `:226`, `:245`, `:259`, `:268`, and `:310` (the `:151` occurrence is the fixture, already handled above):

```ts
    mountPanel({ target: { kind: 'submission', runId: 1, mp: makeMp(), entry } });
```

- [ ] **Step 15: Verify the display tests stay green under the default stub (checkpoint — no edits)**

The submission display tests (mount a submission target, assert on rendered content, do NOT stub fetch) are ALL covered by the `beforeEach` default empty-thread stub from Step 14: an empty thread makes `newest` fall back to the optimistic cell entry, so mp title / group / submission number / evaluation details render identically to today, and the historical region (`threadState.slice(1)`) is empty. Even mid-load `newest` is the optimistic cell entry, so content shows before the (empty) thread resolves. These tests need NO per-test change beyond the inline-target `runId` already added in Step 14 (only the `:310` focus-trap test builds its target inline; the rest use `submissionTarget()`).

This step makes NO edits — it is a convergence checkpoint. After Steps 16 + 17, run the suite (Step 18). Any display test that still fails is one whose assertions depend on a NON-empty thread body (there should be none among the pre-existing tests, since they predate the thread and only ever showed the latest submission). If one is found, give it an explicit `vi.stubGlobal('fetch', routedFetch({ thread: echoThread(t) }))` after building its target `t`; otherwise leave every display test untouched.

- [ ] **Step 16: Retrofit the write tests' fetch stubs + assertions**

The panel now fires a thread GET on open, so every write test's `fetch` mock also receives that GET, and any raw fetch-count assertion (`toHaveBeenCalledTimes` / `not.toHaveBeenCalled` / `mock.calls[i]`) now includes it. Classify each write test and apply ONLY what its group needs — do NOT blanket-convert, because two groups have stubs that must stay intact:

**Group 1 — stubs a single eval `Response` AND inspects the eval call / asserts a fetch count.** Convert the stub to `routedFetch({ evalResponse })` (default empty thread → `newest` is the optimistic awaiting cell, so the form and create-target are unchanged) and rewrite the assertion via `evalCalls(...)` (filters the thread GET out). Members: **T20** (`:418`, bare `vi.fn()` — asserts `not.toHaveBeenCalled()` TWICE, at `:431` AND `:470`), **T25** (`:1036`, one `not.toHaveBeenCalled()` at `:1065`), **T22** (`:712`, `mockResolvedValue(200)` + `toHaveBeenCalledTimes(1)` + `mock.calls[0]` at `:745-746`).
```ts
// "not called" (T20, T25): bare vi.fn() would return undefined for the thread GET
// (crashing api.get) AND be counted — so route it and assert on the eval endpoint only.
    const fetchMock = routedFetch();
    vi.stubGlobal('fetch', fetchMock);
    // … attempt a blocked submit …
    expect(evalCalls(fetchMock)).toHaveLength(0);   // thread GET may fire; the eval endpoint must NOT
```
**T20 has TWO such assertions** (a blocked score submit at `:431` and a blocked feedback submit at `:470`) — rewrite BOTH to `expect(evalCalls(fetchMock)).toHaveLength(0)`; leaving either as `not.toHaveBeenCalled()` fails once the on-mount thread GET calls the mock.
```ts
// "called once + inspect" (T22):
    const fetchMock = routedFetch({ evalResponse: { status: 200, body: updatedEval } });
    vi.stubGlobal('fetch', fetchMock);
    // … submit …
    const calls = evalCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
```

**Group 1-special — T21** (`:588`) uses a DEFERRED mock (`vi.fn(() => new Promise(r => { resolveFetch = r; }))`) to freeze the POST mid-flight and assert `aria-busy`. KEEP that mock (converting it to `routedFetch` resolves the POST immediately and destroys the aria-busy assertion); the deferred mock also serves the on-mount thread GET harmlessly (it stays pending). Only rewrite the two call-inspection lines (`:621-622`), because `mock.calls[0]` is now the thread GET:
```ts
    expect(evalCalls(fetchMock)).toHaveLength(1);
    const [url, init] = evalCalls(fetchMock)[0];
```

**Group 2 — stubs a single eval `Response` but asserts NO fetch count** (it checks a toast / banner / `onRefetch` / focus / `onClose`). Convert the stub to `routedFetch({ evalResponse })` so the thread GET is served by a FRESH `Response`, and change NOTHING else. This conversion is mandatory (not cosmetic): `vi.fn().mockResolvedValue(new Response(...))` returns the SAME `Response` instance on every call, so the on-mount thread GET consumes its body via `res.json()`, and the later eval call's `res.json()` then throws "Body already read" → the write's success path fails and the toast/onRefetch/onClose assertion breaks. `routedFetch` builds a new `Response` per call, avoiding this. Members: **T23** (`:641`, asserts `pushToast`), **T24** (`:759`, `mockResolvedValue(400)`, asserts the `.form-error` banner), **T26** (`:691`, asserts `onRefetch` once), **T26b** (`:661`, `mockResolvedValue(200)`, asserts `onRefetch` once), **T30** (`:1126`, asserts `activeElement`), **T31** (`:787`, `mockResolvedValue(409)`, asserts `onRefetch`/raceTransition — use `evalResponse: { status: 409, body: { detail: 'Already evaluated' } }`), **T8FIX** (`:1275`, asserts `onClose`).
```ts
// e.g. T24:
    const fetchMock = routedFetch({ evalResponse: { status: 400, body: { detail: 'Bad request' } } });
    vi.stubGlobal('fetch', fetchMock);
    // … assertions unchanged …
```

**Group 3 — KEEP the mock, change NOTHING.** These use a deferred / abort-controlled mock (never resolves, or rejects only on `signal` abort) and inspect no fetch count. Their mock already serves the on-mount thread GET harmlessly (it stays pending / aborts with the panel), and converting them would break the exact timing they test. Members: **T29** (`:847`, timeout → "Upload timed out."), **T36** (`:925`, user-cancel), **T28e** (`:1220`, submit-abort). No edit at all beyond the fixture `runId`.

**Group 4 — no fetch stub, no fetch-count assertion.** Covered entirely by the `beforeEach` default (Step 14); no change beyond `runId`. Members: **T27** (`:475`, client-side file validation), **T32** (`:519`, char counter), **T28b/T28c/T28d** (`:1163`–`:1218`), **T30c** (`:1252`). (The score/feedback validation cases at `~:455`/`~:470` are NOT a separate `it` — they live inside T20, already handled in Group 1.)

**T33** (`:884` — create-then-edit): the POST returns a new evaluation (id 42), then [Edit] → PATCH `/api/evaluations/42`. Stub `routedFetch({ evalResponse: { status: 201, body: { id: 42, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 } } })`. The default thread stays empty, so the post-write clear (Step 12) does NOT fire (`res.submissions.length === 0`) and `effectiveEvaluation` remains the flat POST eval — the PATCH targets 42:
```ts
    const calls = evalCalls(fetchMock);
    const patch = calls.find(([, i]) => (i.method ?? '').toUpperCase() === 'PATCH')!;
    expect(patch[0]).toBe('/api/evaluations/42');
    expect(patch[1].method).toBe('PATCH');
```

**T31b** (`:808` — 409 race): the concurrent (winning) evaluation now arrives via the post-409 thread refetch (Step 11(3)), NOT via `onRefetch` mutating the cell. A STATIC winning thread would render the winning eval read-only at mount and suppress the create form (the test could never submit), so use `sequencedThreadFetch` — awaiting at mount (form shows), winning after the 409:
```ts
    const start = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const winning = { submissions: [{ ...start.entry.latest_submission!, evaluation: {
      id: 77, evaluated_at: '2026-06-05T12:00:00Z', evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'Winner', has_feedback_file: false } }] };
    vi.stubGlobal('fetch', sequencedThreadFetch(
      [echoThread(start), winning],
      { status: 409, body: { detail: 'Already evaluated' } },
    ));
    const { onRefetch } = mountPanel({ target: start, isAdmin: true });
    await settle();
    // fill result + submit → POST returns 409 → 409 branch calls onRefetch + refetches thread → winning eval
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle(); // POST → 409 branch → onRefetch + thread refetch → winning eval renders (two awaited hops)
    expect(host.textContent).toContain('88');          // winning score, from the post-409 thread refetch
    expect(host.textContent).toContain('Other Prof');  // winning evaluator
    expect(onRefetch).toHaveBeenCalledTimes(1);
```
Do NOT assert on `target.entry` mutation — the panel no longer reads the cell for the newest eval. Use `form.dispatchEvent(new Event('submit', …))` (the suite's convention, ~10 existing call sites), NOT `requestSubmit()`.

After applying the groups above, run `npx vitest run src/tests/DashboardSidePanel.svelte.test.ts` and give `routedFetch({...})` to any straggler that still errors on an unrouted fetch — but do not re-classify a Group 3 mock away from its intended timing behaviour.

- [ ] **Step 17: Retrofit `RunSubmissionTab.svelte.test.ts` — TS1 only**

`RunSubmissionTab` mounts the real panel. Opening a *submitted* cell now fires a thread GET. In the tab suite, `submissionMock()`'s default groups ALL have `latest_submission: null` (`:55-56, :64-65`), so every default-mock tab test opens a not-submitted cell → NO thread fetch → unchanged. Only **TS1** (`:681`) builds a custom `v1` whose opened cell (G1) has `latest_submission.id = 50` → the thread GET fires. TS2 (`:740`), TS3, and the rest open the default mock's first (not-submitted) cell → leave them unchanged. (The `latest_submission` at `:472` is a CSV-download test that never opens the panel — no change.)

TS1 asserts NO `'90'` before Refresh, then `'90'`/`'Good'` after Refresh. Post-Slice-B the panel's newest evaluation comes from the THREAD, so the thread body must CHANGE across the two fetches: empty-eval at open, then the eval-90 body after Refresh (the dashboard GET#2 updates the cell's `latest_evaluation.id`, which the Step 4/6 keying detects → the panel refetches the thread). Add a routed helper near the top of the file (after `mockFetch`, `:25`):

```ts
// Serves dashboard GETs and thread GETs from independent ordered lists (last entry sticks).
function routedTabFetch(dashboards: unknown[], threads: unknown[]) {
  let di = 0, ti = 0;
  return vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && u.includes('/groups/') && u.endsWith('/submissions')) {
      const t = threads[Math.min(ti, threads.length - 1)] ?? { submissions: [] };
      ti += 1;
      return Promise.resolve(new Response(JSON.stringify(t), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    const d = dashboards[Math.min(di, dashboards.length - 1)];
    di += 1;
    return Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
}
```

In TS1, replace the two-response `mockResolvedValueOnce` chain (`:718-721`) with:
```ts
    const g1v1 = v1.mini_projects[0].groups[0];
    const g1v2 = v2.mini_projects[0].groups[0];
    const openThread = { submissions: [{ ...g1v1.latest_submission, evaluation: null }] };
    const refreshedThread = { submissions: [{ ...g1v2.latest_submission, evaluation: g1v2.latest_evaluation }] };
    vi.stubGlobal('fetch', routedTabFetch([v1, v2], [openThread, refreshedThread]));
```
The existing assertions (`:728-736`) are unchanged, EXCEPT: add a second `await settle();` immediately after the existing `await settle();` that follows the Refresh click. This is required (not optional): post-Slice-B the `'90'` now arrives only after a two-hop chain — dashboard GET#2 resolves → `data` changes → panel `target` re-derives → the thread effect refires → thread GET#2 resolves → re-render — which a single `settle()` (3 ticks) does not reliably drain. Example around `:726-736`:
```ts
    refreshBtn.click();
    await settle();
    await settle(); // dashboard resolve → effect refire → thread GET#2 resolve → render
    panel = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel.textContent).toContain('90');
    expect(panel.textContent).toContain('Good');
```

- [ ] **Step 18: Run the affected suites — expect green after retrofit**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/DashboardSidePanel.svelte.test.ts src/tests/RunSubmissionTab.svelte.test.ts`
Expected: PASS (all existing tests green with the on-open thread fetch routed).

- [ ] **Step 19: Commit (integration + retrofit)**

```bash
git add frontend/src/components/runs/DashboardSidePanel.svelte frontend/src/components/runs/RunSubmissionTab.svelte frontend/src/tests/DashboardSidePanel.svelte.test.ts frontend/src/tests/RunSubmissionTab.svelte.test.ts
git commit -m "feat(panel): render submission thread + rewire write to newest (Slice B)"
```

### Part G — New behaviour tests

- [ ] **Step 20: Write the new thread tests**

Append to `frontend/src/tests/DashboardSidePanel.svelte.test.ts` (inside the `describe`):

```ts
  it('thread: renders historical entries collapsed under "Previous submissions"', async () => {
    const t = submissionTarget({ status: 'accepted', submissionId: 100 });
    const thread = {
      submissions: [
        { ...t.entry.latest_submission!, evaluation: t.entry.latest_evaluation },
        { id: 55, submission_number: 1, submitted_at: '2026-06-01T09:00:00Z',
          submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
          file_size: 500,
          evaluation: { id: 7, evaluated_at: '2026-06-01T12:00:00Z', evaluated_by: { user_id: 3, full_name: 'Prof' },
            result: 'rejected', score: 10, feedback_text: 'Redo', has_feedback_file: false } },
      ],
    };
    vi.stubGlobal('fetch', routedFetch({ thread }));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-history"]')).toBeTruthy();
    expect(host.textContent).toContain('Previous submissions');
    const toggles = host.querySelectorAll('[data-test="thread-entry-toggle"]');
    expect(toggles).toHaveLength(1); // only the ONE older entry (newest is panel-rendered)
    // collapsed: detail hidden until clicked
    expect(host.textContent).not.toContain('Redo');
    (toggles[0] as HTMLButtonElement).click();
    flushSync();
    expect(host.textContent).toContain('Redo');
  });

  it('thread: single-entry thread renders no historical region', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    vi.stubGlobal('fetch', routedFetch({ thread: echoThread(t) }));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-history"]')).toBeNull();
    expect(host.textContent).not.toContain('Previous submissions');
  });

  it('thread: error state shows retry; retry re-fetches', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let calls = 0;
    const failing = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url); const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'GET' && u.endsWith('/submissions')) {
        calls += 1;
        if (calls === 1) return Promise.reject(new TypeError('network down'));
        return Promise.resolve(new Response(JSON.stringify(echoThread(t)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', failing);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeTruthy();
    (host.querySelector('[data-test="thread-retry"]') as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeNull();
    expect(calls).toBe(2);
  });

  it('thread wins: create posts to thread[0].id, not the stale cell submission id', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    // Group resubmitted after the grid loaded: thread newest id 200 (no eval yet).
    const thread = { submissions: [
      // is_resubmission MUST be false: a true value renders the auto-accept banner
      // (DashboardSidePanel `{#if sub.is_resubmission}` at ~:417) instead of the write form,
      // so the create form would be absent and the submit dispatch would find nothing to submit.
      { id: 200, submission_number: 3, submitted_at: '2026-06-05T10:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
        file_size: 999, evaluation: null },
    ] };
    const fetchMock = routedFetch({ thread, evalResponse: { status: 201, body: { id: 9, submission_id: 200, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: 1 } } });
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    // fill + submit the create form (result = accepted needs no feedback file)
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const posted = evalCalls(fetchMock).find(([, i]) => (i.method ?? '').toUpperCase() === 'POST')!;
    expect(posted[0]).toBe('/api/submissions/200/evaluation'); // thread[0].id, not 100
  });

  it('write success refetches the thread and calls onRefetch', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const fetchMock = routedFetch({ thread: echoThread(t), evalResponse: { status: 201, body: { id: 9, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: 1 } } });
    vi.stubGlobal('fetch', fetchMock);
    const { onRefetch } = mountPanel({ target: t, isAdmin: true });
    await settle();
    const threadGetsBefore = fetchMock.mock.calls.filter(([u, i]) => ((i as RequestInit)?.method ?? 'GET') === 'GET' && String(u).endsWith('/submissions')).length;
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const threadGetsAfter = fetchMock.mock.calls.filter(([u, i]) => ((i as RequestInit)?.method ?? 'GET') === 'GET' && String(u).endsWith('/submissions')).length;
    expect(threadGetsAfter).toBe(threadGetsBefore + 1); // post-write refetch
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it('not_submitted: no thread fetch, no history, no write form', async () => {
    const entry = makeEntry({ status: 'not_submitted', latest_submission: null, latest_evaluation: null });
    const t = { kind: 'submission' as const, runId: 1, mp: makeMp(), entry };
    const fetchMock = routedFetch();
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.textContent).toContain('Not submitted yet.');
    expect(host.querySelector('[data-test="thread-history"]')).toBeNull();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    const threadGets = fetchMock.mock.calls.filter(([u, i]) => ((i as RequestInit)?.method ?? 'GET') === 'GET' && String(u).endsWith('/submissions'));
    expect(threadGets).toHaveLength(0);
  });

  it('thread: an expanded historical entry survives a write (real grid-reload onRefetch)', async () => {
    // This MUST drive a data-mutating onRefetch — the production regression only fires
    // when onRefetch changes the cell's evaluation id (null→N), which makes the thread
    // effect refire. A no-op onRefetch (mountPanel's default) never triggers the refire,
    // so it would pass even against the broken code. We mount via a $state box (same
    // pattern as the progress-race test at :176) and mutate the target in onRefetch,
    // mirroring RunSubmissionTab.refresh().
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const thread = { submissions: [
      { ...t.entry.latest_submission!, is_resubmission: false, evaluation: null }, // newest: write form
      { id: 55, submission_number: 1, submitted_at: '2026-06-01T09:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false,
        file_size: 500,
        evaluation: { id: 7, evaluated_at: '2026-06-01T12:00:00Z', evaluated_by: { user_id: 3, full_name: 'Prof' },
          result: 'rejected', score: 10, feedback_text: 'Redo', has_feedback_file: false } },
    ] };
    vi.stubGlobal('fetch', routedFetch({ thread, evalResponse: { status: 201, body: { id: 9, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: 1 } } }));
    const box = $state<{ target: PanelTarget; onClose: () => void; isAdmin: boolean; isTeacher: boolean; onRefetch: () => void }>({
      target: t,
      onClose: vi.fn(),
      isAdmin: true,
      isTeacher: false,
      onRefetch: () => {
        // grid reload lands the just-created evaluation on THIS cell → cell eval id null→9,
        // which makes submissionLatestEvalId change and the thread effect refire.
        box.target = { ...t, entry: { ...t.entry, status: 'accepted', latest_evaluation: {
          id: 9, evaluated_at: '2026-06-05T11:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' },
          result: 'accepted', score: null, feedback_text: null, has_feedback_file: false } } };
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, { target: host, props: box });
    flushSync();
    await settle();
    // expand the single historical entry
    (host.querySelector('[data-test="thread-entry-toggle"]') as HTMLButtonElement).click();
    flushSync();
    expect(host.textContent).toContain('Redo');
    // write an evaluation on the newest submission → onRefetch mutates the cell eval id → effect refires
    const sel = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    sel.value = 'accepted'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    (host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement)
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle(); // POST → onRefetch mutates target → effect refires → thread refetch (two awaited hops)
    // expandedById is keyed by submission id and is NEVER reset by the effect → entry 55 stays open
    expect(host.textContent).toContain('Redo');
  });

  it('thread: a cell switch aborts the in-flight thread fetch and does not render the stale thread', async () => {
    // Mirrors the progress-race test (:176) for the submission/thread variant.
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => {
      signals.push(opts.signal as AbortSignal);
      return new Promise<Response>(() => { /* never resolves */ });
    }));
    const a = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    const b: PanelTarget = { kind: 'submission', runId: 1, mp: makeMp(), entry: makeEntry({
      group_id: 8, group_name: 'G8', status: 'awaiting_eval', latest_evaluation: null,
      latest_submission: { id: 200, submission_number: 1, submitted_at: '2026-06-05T10:00:00Z',
        submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false, file_size: 999 },
    }) };
    const box = $state<{ target: PanelTarget; onClose: () => void; isAdmin: boolean; isTeacher: boolean; onRefetch: () => void }>({
      target: a, onClose: vi.fn(), isAdmin: true, isTeacher: false, onRefetch: vi.fn(),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, { target: host, props: box });
    flushSync();
    expect(signals.length).toBe(1);
    const first = signals[0]!;
    expect(first.aborted).toBe(false);
    box.target = b; // switch to a different group (cell switch)
    flushSync();
    await tick();
    expect(first.aborted).toBe(true);                 // in-flight fetch for cell A aborted
    expect(signals.length).toBeGreaterThanOrEqual(2); // a fresh fetch started for cell B
  });

  it('thread: shows the loading indicator (newest still rendered) while the thread is in flight', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never resolves */ })));
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-loading"]')).toBeTruthy();
    // the newest entry renders optimistically from the cell even while the thread is pending
    expect(host.textContent).toContain('Submission');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeTruthy();
  });

  it('thread: a 4xx (ApiError) also shows the retry error state', async () => {
    const t = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    let calls = 0;
    const stub = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url); const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'GET' && u.endsWith('/submissions')) {
        calls += 1;
        if (calls === 1) {
          // non-2xx → api.get throws ApiError (not a raw TypeError) → the catch-all must still show the error state
          return Promise.resolve(new Response(JSON.stringify({ detail: 'Resource not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.resolve(new Response(JSON.stringify(echoThread(t)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', stub);
    mountPanel({ target: t, isAdmin: true });
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeTruthy();
    (host.querySelector('[data-test="thread-retry"]') as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector('[data-test="thread-error"]')).toBeNull();
    expect(calls).toBe(2);
  });
```

- [ ] **Step 21: Run the new tests to verify they pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/DashboardSidePanel.svelte.test.ts`
Expected: PASS (existing + 10 new tests: render-collapsed, single-entry, error-retry [TypeError], thread-wins, write-refetch, not_submitted, expanded-survives-write, 4xx-ApiError-retry, cell-switch-abort, loading-indicator).

- [ ] **Step 22: Full frontend suite + typecheck (regression gate)**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json`
Expected: PASS; no new type errors.

- [ ] **Step 23: Commit (new tests)**

```bash
git add frontend/src/tests/DashboardSidePanel.svelte.test.ts
git commit -m "test(panel): thread render, thread-wins, write-refetch, not_submitted (Slice B)"
```

---

## Final verification

- [ ] Backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q` → all pass.
- [ ] Frontend: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json` → all pass, no new type errors.
- [ ] Manual smoke (optional): open a submitted cell with ≥2 submissions → newest shows with the write form; "Previous submissions" lists older entries collapsed; expanding one shows detail + downloads; writing an evaluation updates the badge and the newest entry.

---

## Self-Review (author check against the spec)

**Spec coverage:**
- §3/§4 endpoint + shape + probe-safe 404 + N+1-free → Task 1 (endpoint + 10 tests, incl. student/unrelated/teacher-on-run/teacher-of-another-run auth). ✓
- §5 reuse rationale (serializers, plain dict) → Task 1 implementation. ✓
- §6.1 named types + `resultToStatus` + wire → Task 2. ✓
- §6.2 read-only sub-component (collapsed summary, badge, expanded detail, feedback-file link, awaiting/null, auto-accept banner); per-entry `expanded` keyed by submission id and NEVER reset by the effect → survives writes → Task 3 + Task 4 Step 6 + the "expanded survives write (real onRefetch)" test. ✓
- §6.3 `newest` model, gated primitive effect keying (incl. cell sub/eval-id refinement), loading/error/retry scoped to history, thread reset on switch (via `loadThread`) → Task 4 Parts B/C. ✓
- §6.4 `effectiveEvaluation` redefine, create→`newest.id`, post-write + 409 refetch, guarded `stateLatestEvaluation` clear, bridge discriminator move → Task 4 Parts D. ✓
- §6.1 `runId` plumbing → Task 4 Part A. ✓
- §8 edge cases: not_submitted (no fetch/history/form), single-entry, thread-wins, auto-accept, catch-all error (TypeError + 4xx ApiError) → Task 4 tests + Task 3. ✓
- §9 backend + frontend tests: backend 10; frontend retrofit of both test files (default-stub + `evalCalls` + `runId`) + new tests for render-collapsed, single-entry, thread-wins, write-refetch, not_submitted, expanded-survives-write, error-retry (TypeError & 4xx), **cell-switch abort**, and **history loading indicator** → Tasks 1 & 4. ✓
- §10 constraints (runes, no deps, mount/unmount, plain dict, require_run_admin_or_teacher, probe-safe 404) → Global Constraints + tasks. ✓
- `.banner-error` added locally (panel had none) → Task 4 Step 13. ✓

**Placeholder scan:** No TBD/TODO. The test-retrofit steps (15/16/17) give complete helper code + a per-group classification (convert+`evalCalls` / convert-only / keep-mock / no-change) with each test named, plus complete before/after for each pattern.

**Line-number caveat for Task 4:** Step 4 inserts a ~70-line block after `DashboardSidePanel.svelte:81`, so the absolute line numbers cited in Steps 5–13 (`:184`, `:210`, `:215-219`, `:402-405`, `:421-435`, `:439-449`, `:592-593`, etc.) are **pre-edit** anchors — locate each edit by its quoted snippet / `{@const}` / function name, not by a raw line count after Step 4 runs. Likewise, Step 4 writes a simple `loadThread` `.then` that Step 12 then **replaces**; apply Step 12's version (do not stack both).

**Type consistency:** `ThreadSubmission`/`ThreadEvaluation`/`ThreadSubmissionBase`/`SubmissionThreadResponse` defined in Task 2 and consumed unchanged in Tasks 3-4. `getSubmissionThread(runId, mpId, groupId, {signal})` signature identical across Task 2 (def) and Task 4 (`loadThread` call). `resultToStatus(string | null)` consistent. `newest: ThreadSubmission | null` consistent across derive, template, and `handleSave`.
