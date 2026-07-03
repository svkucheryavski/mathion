# Submissions Review — Full Submission History Thread (Slice B)

**Status:** Design approved 2026-07-03. Ready for implementation planning.

**Goal:** Let teachers/admins see the *full history* of a group's submissions for a
mini-project — every submission newest-first, each with its own evaluation and PDF
download — instead of only the latest submission. This is Slice B of the
teacher-monitoring A–E roadmap (`2026-05-29-teacher-monitoring-slice-a-design.md`
§"out of scope"); slices A/C/D/E are already merged.

**Architecture (one sentence):** Extend the existing `DashboardSidePanel` (opened from
a Submission-tab grid cell) to render the full submission *thread* for that
group×mini-project, fed by one new staff-only backend endpoint that returns an array
of the *same* nested `{submission, evaluation}` shape the panel already renders.

---

## 1. Context — what already exists

- **Submission tab** (`frontend/src/components/runs/RunSubmissionTab.svelte`): a status
  grid, rows = groups, columns = mini-projects, each cell a `StatusBadge`. Clicking a
  cell calls `openPanel(mp, entry)` and renders `DashboardSidePanel` with the cell's
  dashboard entry. Data from `getMiniProjectsDashboard(runId)` →
  `GET /api/runs/{id}/dashboard/mini-projects`.
- **Side panel** (`frontend/src/components/runs/DashboardSidePanel.svelte`): for a
  submission cell it shows the **latest** submission's metadata + a **download** link
  (`/api/submissions/{id}/file`), the evaluation view (read-only) and, for staff, the
  evaluation **write/edit** form (POST `/api/submissions/{sid}/evaluation`, PATCH
  `/api/evaluations/{eid}`), plus the auto-accepted-resubmission banner. It renders
  only `entry.latest_submission` / `entry.latest_evaluation` — no history.
- **Backend serializers** (`backend/mathion/api/dashboard.py`):
  `_serialize_submission(sub, submitter_user_id, submitter_full_name)`,
  `_serialize_evaluation(ev, evaluator_user_id, evaluator_full_name)`, and
  `_serialize_user_ref(...)` already produce exactly the nested shapes the panel
  consumes. The dashboard endpoints return plain `dict`s (no `response_model`) and use
  `require_run_admin_or_teacher(db, user, run)` for auth. A drilldown precedent already
  exists: `GET /api/runs/{rid}/dashboard/progress/{user_id}/{sequence_id}`.
- **Backend already returns all submissions** via `GET /api/mini-projects/{mp_id}/submissions`
  (staff: all; student: own group), but it returns bare `SubmissionResponse`s
  (no evaluation, `submitted_by` is a user_id int only) and is **not wired into the
  teacher UI**. We do NOT reuse it (see §5 rationale).

---

## 2. Scope

**In scope**
- One new staff-only backend endpoint returning the full submission thread for a
  single group×mini-project, each submission with its nested evaluation + submitter/
  evaluator names.
- Extending `DashboardSidePanel` to render that thread newest-first: latest expanded
  with the existing write/edit form; older entries collapsed and read-only.
- Loading / error / abort handling for the thread fetch; refetch after an evaluation
  write; parent-grid refresh so the cell badge stays in sync.

**Out of scope (explicitly deferred)**
- In-app PDF preview (download links only, as today).
- Editing evaluations on anything but the latest submission.
- Bulk download of submissions.
- Fixing the PATCH feedback-file limitation (Phase 9).
- Any change to the student-facing submission flow.

---

## 3. Data shape (the thread payload)

The endpoint returns a plain `dict` (matching the dashboard convention — no
`response_model`):

```json
{
  "submissions": [
    {
      "id": 42,
      "submission_number": 3,
      "submitted_at": "2026-07-01T10:00:00+00:00",
      "submitted_by": { "user_id": 7, "full_name": "Ada Lovelace" },
      "is_late": false,
      "is_resubmission": true,
      "file_size": 12345,
      "evaluation": {
        "id": 11,
        "evaluated_at": "2026-07-02T09:00:00+00:00",
        "evaluated_by": { "user_id": 3, "full_name": "Prof. Babbage" },
        "result": "accepted",
        "score": 95,
        "feedback_text": "Good work.",
        "has_feedback_file": true
      }
    }
    // ... older submissions, submission_number descending
  ]
}
```

- Each array element is `_serialize_submission(...)` with an added `"evaluation"` key
  set to `_serialize_evaluation(...)` (or `null` if the submission has no evaluation).
- This is byte-identical in shape to the dashboard cell's `latest_submission` +
  `latest_evaluation` (just merged: evaluation nested inside the submission), so the
  panel can render each entry with shared markup.
- Ordering: `submission_number` **descending** (newest first). Empty group →
  `{"submissions": []}`.

---

## 4. Endpoint

`GET /api/runs/{run_id}/dashboard/mini-projects/{mp_id}/groups/{group_id}/submissions`

- **Location:** `backend/mathion/api/dashboard.py` (alongside the progress drilldown;
  run-scoped for consistency with the other dashboard endpoints and to reuse the
  in-module serializers without promoting them).
- **Auth:** `run = get_or_404(db, Run, run_id)` then
  `require_run_admin_or_teacher(db, user, run)`. Staff-only (this is a review surface;
  students use their own submission views). Non-staff → 403.
- **Validation:**
  - `mp = get_or_404(db, MiniProject, mp_id)`; if `mp.run_id != run_id` → 404
    (mini-project not in this run).
  - `group = get_or_404(db, Group, group_id)`; if `group.run_id != run_id` → 404
    (group not in this run).
- **Query strategy (N+1-free):**
  1. One query: all `Submission` rows for `(mini_project_id=mp_id, group_id=group_id)`
     joined to the submitter `User`, ordered by `submission_number` desc.
  2. One query: all `Evaluation` rows whose `submission_id` is in that set, joined to
     the evaluator `User`; index by `submission_id` in a dict.
  3. Stitch in Python: for each submission, attach `_serialize_evaluation(...)` (or
     `None`) under `"evaluation"`.
- **Returns:** `{"submissions": [...]}` as in §3.

---

## 5. Why a new endpoint (not reuse `GET /api/mini-projects/{mp_id}/submissions`)

The existing list endpoint (a) returns **all groups'** submissions (over-fetch +
requires client-side filtering), (b) returns bare `SubmissionResponse` with **no
evaluation** (forcing N+1 `GET /api/submissions/{sid}/evaluation` calls), and (c)
exposes `submitted_by` as a **user_id int only** (no name). The new endpoint scopes to
the group, nests the evaluation, and includes names — in one call, in the shape the
panel already renders. This mirrors the existing dashboard drilldown pattern.

---

## 6. Frontend — extend `DashboardSidePanel`

**Wire function.** Add `getSubmissionThread(runId, mpId, groupId)` (in
`frontend/src/lib/dashboards.ts`, next to the other dashboard wires) returning a typed
`SubmissionThreadEntry[]`. Add a `SubmissionThreadEntry` type = the existing
submission cell type + a nested `evaluation` field (reuse the already-declared
submission/evaluation types from `dashboards.ts`).

**Thread-entry sub-component.** Extract a small **presentational, read-only**
component (e.g. `SubmissionThreadEntry.svelte`) rendering one entry: submission
metadata (number, submitted_at, submitted_by name, is_late, is_resubmission,
file_size), the PDF **download** link, and the evaluation block (read-only view). It
takes an `expanded` flag. It contains **no write logic**. The evaluation write/edit
form stays entirely in `DashboardSidePanel` (logic unchanged) and the panel renders it
**directly beneath the newest thread entry only** — the sub-component is never
responsible for the form. Historical entries are just the read-only sub-component.

**Panel behaviour (submission cell only).**
1. On open, render the latest submission immediately from the cell `entry` already in
   hand (no flash), then fire `getSubmissionThread(...)` for `{mpId, groupId}`.
2. On resolve, render the thread newest-first. The newest entry reconciles with the
   already-shown latest (same submission id) and carries the write form; older entries
   are read-only and **collapsed** to a one-line summary
   (`Submission N · date · result badge`), expandable on click. Latest is expanded.
3. Loading spinner while the thread is in flight; on error, an inline message with a
   retry button (reuse existing panel error styling).
4. `AbortController` + a `stale` guard keyed on `{mpId, groupId}` so switching cells
   (or closing) never renders a stale thread — matches the abort/stale pattern used
   elsewhere in the codebase (e.g. the interactive-app player, `RunProgressTab`).
5. After a successful evaluation write/edit on the latest submission: refetch the
   thread (so the newest entry's evaluation updates) **and** invoke the existing
   parent-grid refresh callback (so the cell's `StatusBadge` updates). If Slice C
   already wired a post-write parent refresh, reuse it and add the thread refetch.

**Unchanged:** the panel header (MP title, block, group, status) still comes from the
cell entry; the evaluation write/edit logic, its validation, POST/PATCH calls, and the
auto-accepted-resubmission read-only banner are unchanged — they just now live inside
the newest thread entry.

---

## 7. Data flow

```
click submission cell
  → panel opens; latest renders instantly from cell entry
  → getSubmissionThread(runId, mpId, groupId)
      → { submissions: [newest, …, oldest] }
  → render thread: newest expanded (+ write form), older collapsed & read-only
  → teacher writes/edits evaluation on newest
      → POST/PATCH (as today)
      → refetch thread  +  parent grid refresh (cell badge updates)
```

---

## 8. Edge cases

- **`not_submitted` cell** (no submissions): thread returns `[]`; panel shows the
  existing "no submission yet" state (write form disabled). No thread section rendered.
- **Latest submission pending (no evaluation):** newest entry shows "awaiting
  evaluation" + the write form (as today). A historical submission with no evaluation
  (unusual) renders gracefully with `evaluation: null` and no write form.
- **Auto-accepted resubmission:** per-entry read-only banner (as today for the latest).
- **Cell switch mid-fetch:** stale thread discarded via abort/stale guard.
- **Concurrent change by another teacher:** surfaced on the next thread refetch /
  manual grid refresh; no live sync (consistent with the rest of the dashboard).
- **Group/MP not in run:** 404 from the endpoint; panel surfaces the existing
  `ApiError` inline error state.

---

## 9. Testing

**Backend** (`backend/tests/test_dashboard_*.py` or a new
`test_dashboard_submission_thread.py`):
- Returns all submissions for the group×MP, newest-first, each with nested
  `evaluation` (and `null` when unevaluated) and submitter/evaluator `full_name`.
- Empty group → `{"submissions": []}`.
- Auth: student → 403; teacher on the run → 200; admin → 200; unrelated user → 403.
- `mp_id` not in `run_id` → 404; `group_id` not in `run_id` → 404.
- Only the target group's submissions are returned (not other groups').
- No N+1: evaluations fetched in a single query (assert via query count or structure).

**Frontend** (`frontend/src/tests/DashboardSidePanel.*.test.ts`, mount/unmount/
flushSync pattern):
- Thread renders every submission newest-first; newest expanded with the write form;
  historical entries read-only and collapsed; expand-on-click reveals detail.
- Loading spinner while fetching; error → inline retry; retry re-fetches.
- Cell switch aborts the in-flight fetch and does not render the stale thread.
- Evaluation write on the newest refetches the thread and calls the parent refresh.
- `not_submitted` cell renders no thread section and keeps the disabled write state.

---

## 10. Global constraints

- **Frontend:** Svelte 5 runes only, no JS/CSS deps; component tests use
  `mount`/`unmount`/`flushSync`/`tick` from `svelte`, not `@testing-library`.
- **Backend:** reuse `dashboard.py`'s `_serialize_submission` / `_serialize_evaluation`
  / `_serialize_user_ref`; return a plain `dict` (no `response_model`), matching the
  dashboard convention; auth via `require_run_admin_or_teacher`.
- **No change** to the student submission flow, the existing evaluation write/PATCH
  endpoints, or the dashboard grid endpoint.

---

## 11. Future (not this slice)

In-app PDF preview; editable historical evaluations; bulk download; PATCH feedback-file
support (Phase 9); submitter email in the thread.
