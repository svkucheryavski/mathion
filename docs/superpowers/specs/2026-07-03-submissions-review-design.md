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
of submissions, each with its evaluation nested — the same fields the panel already
renders for the latest submission (see §3 for the exact shape).

---

## 1. Context — what already exists

- **Submission tab** (`frontend/src/components/runs/RunSubmissionTab.svelte`): a status
  grid, rows = groups, columns = mini-projects, each cell a `StatusBadge`. Clicking
  *any* cell (regardless of status) calls `openPanel(mp, entry)`
  (`RunSubmissionTab.svelte:129-131`), which sets `selectedIds`; `panelTarget` is then
  `$derived.by` from `data` (`:38-43`) and rendered by `DashboardSidePanel`. Data from
  `getMiniProjectsDashboard(runId)` → `GET /api/runs/{id}/dashboard/mini-projects`.
  The panel's `onRefetch` prop is wired to `refresh()` (`:298`, `refresh` at `:73-85`),
  which re-fetches the whole grid and **reassigns `data`** — so every call to
  `onRefetch()` produces a *new* `panelTarget.entry` object identity (this matters for
  effect keying, §6.3 pt5).
- **Side panel** (`frontend/src/components/runs/DashboardSidePanel.svelte`): for a
  submission cell it shows the **latest** submission's metadata + a **download** link
  (`/api/submissions/{id}/file`), the evaluation view (read-only) and, for staff, the
  evaluation **write/edit** form (POST `/api/submissions/{sid}/evaluation`, PATCH
  `/api/evaluations/{eid}`), plus the auto-accepted-resubmission banner. It renders
  only `target.entry.latest_submission` / `target.entry.latest_evaluation` (plus a
  post-write local `stateLatestEvaluation`) — **no history**. Key facts the frontend
  design below depends on (verified):
  - `onRefetch` prop already exists (`:43,49`) and is **already invoked after a
    successful write** (`:210`) and on a 409 race (`:218`).
  - `not_submitted` (i.e. `latest_submission == null`) renders **only**
    `<p>Not submitted yet.</p>` (`:402-403`) — there is *no* submission block, no
    evaluation block, and **no write form** in that branch.
  - The create path posts to `target.entry.latest_submission!.id` (`:184`); the edit
    path patches `effectiveEvaluation.id` where
    `effectiveEvaluation = stateLatestEvaluation ?? target.entry.latest_evaluation`
    (`:78-81,191`). Both target ids come from the **cell entry**, not from a thread.
    `effectiveEvaluation` also drives the edit-prefill `$effect` (`:90-107`),
    `resultLocked` (`:84`), `existingHasFeedbackFile` (`:83`), and the create-vs-edit
    branch in `handleSave` (`:181`).
  - The read-only evaluation view is rendered from the **nested** dashboard shape in
    two places (auto-accept banner `:424-434`; "Branch B" `:436-449`), and there is a
    "Just now" / "You" bridge (`:441-442`) used *only* immediately after a local write,
    because the write endpoint's response is **flat** (`evaluations.ts:12-21`:
    `evaluated_by: number`, has `submission_id`, `result: EvaluationResult`) and cannot
    feed the nested `{user_id, full_name}` view.
- **Backend serializers** (`backend/mathion/api/dashboard.py`):
  `_serialize_submission(sub, submitter_user_id, submitter_full_name)` (`:250-261`),
  `_serialize_evaluation(ev, evaluator_user_id, evaluator_full_name)` (`:264-275`), and
  `_serialize_user_ref(...)` (`:244-247`) already produce exactly the nested shapes the
  panel consumes. The **grid** endpoints `get_progress` (`:178`) and `get_mini_projects`
  (`:278`) return **plain `dict`s** (no `response_model`) and use
  `require_run_admin_or_teacher(db, user, run)` for auth — this is the convention the
  new endpoint follows and whose serializers it reuses. `_derive_status(latest_sub,
  latest_eval)` (`:229-241`) maps `result → status` (see §6.2).
- **Drilldown precedent (for the 404 convention only):**
  `GET /api/runs/{run_id}/students/{user_id}/sequences/{sequence_id}/items`
  (`dashboard.py:435-518`) is a per-tuple drilldown. Note it differs from the grid
  endpoints: it declares `response_model=SequenceItemStateResponse` (a Pydantic model),
  and it returns `detail="Resource not found"` uniformly for every 404 to prevent
  enumeration (`:453,461,466`). The new endpoint copies its **probe-safe 404 convention**
  but the grid endpoints' **plain-dict / serializer-reuse convention**.
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
- Extending `DashboardSidePanel` to render that thread newest-first: newest expanded
  with the existing write/edit form (panel-rendered); older entries collapsed and
  read-only (a new sub-component).
- A small preliminary type-extraction in `dashboards.ts` (named `ThreadSubmissionBase`
  / `ThreadEvaluation` / `ThreadSubmission` types reused by both the dashboard grid and
  the thread).
- Loading / error / abort handling for the thread fetch; refetch after an evaluation
  write; parent-grid refresh so the cell badge stays in sync.

**Out of scope (explicitly deferred)**
- In-app PDF preview (download links only, as today).
- Editing evaluations on anything but the newest submission.
- Bulk download of submissions.
- Fixing the PATCH feedback-file limitation (Phase 9).
- Pagination of the thread (unbounded array — see §4; acceptable, matches the rest of
  the non-paginated dashboard).
- Any change to the student-facing submission flow.

---

## 3. Data shape (the thread payload)

The endpoint returns a plain `dict` (matching the grid-endpoint convention — no
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

- Each array element is `_serialize_submission(...)` (submission fields at the **top
  level**) with an added `"evaluation"` key set to `_serialize_evaluation(...)` (or
  `null` if the submission has no evaluation). The submission fields (`id`,
  `submission_number`, `submitted_at`, `submitted_by`, `is_late`, `is_resubmission`,
  `file_size`) and the evaluation fields (`id`, `evaluated_at`, `evaluated_by`,
  `result`, `score`, `feedback_text`, `has_feedback_file`) are **byte-identical** to the
  dashboard cell's `latest_submission` + `latest_evaluation` (verified against
  `_serialize_submission` `dashboard.py:250-261` and `_serialize_evaluation` `:264-275`)
  — the only difference is that here the evaluation is nested *inside* the submission
  rather than a sibling.
- `submitted_by` / `evaluated_by` are `_serialize_user_ref(...)` (`{user_id, full_name}`
  or `null`).
- Ordering: `submission_number` **descending** (newest first). Empty group →
  `{"submissions": []}`.

---

## 4. Endpoint

`GET /api/runs/{run_id}/dashboard/mini-projects/{mp_id}/groups/{group_id}/submissions`

- **Location:** `backend/mathion/api/dashboard.py` (alongside the drilldown;
  run-scoped for consistency with the other dashboard endpoints and to reuse the
  in-module serializers without promoting them). No `response_model` (returns a plain
  `dict`, like `get_mini_projects`).
- **Auth:** `run = get_or_404(db, Run, run_id, detail="Resource not found")` then
  `require_run_admin_or_teacher(db, user, run)`. (`get_or_404` accepts the `detail=`
  kwarg — `helpers.py:49`.) Staff-only (this is a review surface; students use their own
  submission views). Non-staff → 403.
- **Validation (probe-safe 404s, matching the drilldown `:453,461,466`):**
  - `mp = get_or_404(db, MiniProject, mp_id, detail="Resource not found")`; if
    `mp.run_id != run_id` → `raise HTTPException(404, detail="Resource not found")`.
  - `group = get_or_404(db, Group, group_id, detail="Resource not found")`; if
    `group.run_id != run_id` → `raise HTTPException(404, detail="Resource not found")`.
- **Query strategy (N+1-free):**
  1. One query: all `Submission` rows for `(mini_project_id=mp_id, group_id=group_id)`,
     `outerjoin`ed to the submitter `User` (OUTER to match the grid's
     `dashboard.py:304` and degrade to `submitted_by: null` rather than drop a row if
     the invariant ever changes), ordered by `submission_number` desc.
  2. One query: all `Evaluation` rows whose `submission_id` is in that set,
     `outerjoin`ed to the evaluator `User`; index by `submission_id` in a dict.
     (`Evaluation.submission_id` is `unique`, so ≤1 evaluation per submission.)
  3. Stitch in Python: for each submission, attach `_serialize_evaluation(...)` (or
     `None`) under `"evaluation"`.
- **Returns:** `{"submissions": [...]}` as in §3.
- **Thread length:** unbounded (no pagination this slice). In practice bounded by the
  resubmission cycle (a new submission is blocked while the prior is unevaluated), and
  consistent with the rest of the non-paginated dashboard.

---

## 5. Why a new endpoint (not reuse `GET /api/mini-projects/{mp_id}/submissions`)

The existing list endpoint (a) returns **all groups'** submissions (over-fetch +
requires client-side filtering), (b) returns bare `SubmissionResponse` with **no
evaluation** (forcing N+1 `GET /api/submissions/{sid}/evaluation` calls), and (c)
exposes `submitted_by` as a **user_id int only** (no name). The new endpoint scopes to
the group, nests the evaluation, and includes names — in one call, in the shape the
panel already renders. It reuses `get_mini_projects`' plain-dict convention and its
three `_serialize_*` helpers verbatim, so the thread shape can never drift from the
grid cell shape.

**Data exposure (intentional).** The grid serializes names only for the *latest*
submission/evaluation; the thread additionally surfaces the submitter/evaluator
`full_name` of *historical* submissions/evaluations. This is intentional — the same
staff already see these names via the roster and per-submission views — and the thread
adds **no** emails or other new PII (`_serialize_user_ref` returns only
`{user_id, full_name}`; no `file_path`). Submitter email remains deferred (§11).

---

## 6. Frontend — extend `DashboardSidePanel`

### 6.1 Types + wire function (`frontend/src/lib/dashboards.ts`)

- **Preliminary extraction.** `latest_submission` and `latest_evaluation` are currently
  **anonymous inline object types** inside `DashboardMpGroupEntry` (`dashboards.ts:81-98`),
  not reusable. Extract two named exported types:
  - `ThreadSubmissionBase` — the `latest_submission` shape (`id`, `submission_number`,
    `submitted_at`, `submitted_by`, `is_late`, `is_resubmission`, `file_size`).
  - `ThreadEvaluation` — the `latest_evaluation` shape (`id`, `evaluated_at`,
    `evaluated_by`, `result`, `score`, `feedback_text`, `has_feedback_file`). Its
    `result` stays typed `string` (behaviour-preserving extraction; the backend enum is
    the runtime value but the existing type is `string`).

  Redefine `DashboardMpGroupEntry.latest_submission: ThreadSubmissionBase | null` and
  `latest_evaluation: ThreadEvaluation | null` (verify no other consumer breaks). Then:
  `ThreadSubmission = ThreadSubmissionBase & { evaluation: ThreadEvaluation | null }`
  (submission fields flat at top level, evaluation nested — matching §3). Note: reuse
  these **nested** `dashboards.ts` types, **not** `evaluations.ts` `Evaluation` (flat).
- **Wire function.** Add `getSubmissionThread(runId, mpId, groupId, opts?: {signal})`
  returning the **wrapper** `SubmissionThreadResponse = { submissions: ThreadSubmission[] }`
  (via `api.get`, matching `getMiniProjectsDashboard`'s return-the-wrapper convention at
  `dashboards.ts:157-162`). The panel reads `.submissions`.
- **`resultToStatus` helper** (see §6.2) lives, exported, in `dashboards.ts` next to
  `STATUS_LABEL`/`STATUS_ICON`, so it is independently unit-testable.

**`runId` plumbing (required by the run-scoped fetch).** The endpoint is run-scoped, but
today `SubmissionTarget` carries only `{kind, mp, entry}` (`DashboardSidePanel.svelte:31-35`)
— no `runId` (unlike `ProgressTarget`, which has it) — and `RunSubmissionTab` passes the
panel only `target/onClose/isAdmin/isTeacher/onRefetch` (`:293-299`) despite holding
`runId` as its own prop (`:14`). This slice therefore adds `runId: number` to
`SubmissionTarget`, populates it in `openPanel`/`panelTarget`
(`RunSubmissionTab.svelte:129-131,38-43`), and updates the test `submissionTarget()`
fixture (and any inline `$state` targets) to include it. The panel derives `runId`
alongside `mpId`/`groupId` (§6.3 pt5).

### 6.2 Read-only thread-entry sub-component (historical entries only)

Extract a small **presentational, read-only** component named
`SubmissionThreadEntry.svelte` (component name deliberately differs from the
`ThreadSubmission` *type* to avoid an import name collision). It renders **historical**
entries only (`thread.slice(1)`) — the newest entry stays panel-rendered (§6.3), so the
sub-component only ever receives fully-nested thread data (never the flat post-write
shape), sidestepping any flat/nested bridge. Props (literal):
`{ submission: ThreadSubmission; expanded: boolean; onToggle: () => void }`.

- **Collapsed** (default): a one-line disclosure button (`aria-expanded`) summarizing
  `Submission {submission_number} · {submitted_at ? formatLocalWithTz(submitted_at) : '—'} · <StatusBadge>`,
  where the badge status comes from a small
  `resultToStatus(result: string | null): MpGroupStatus` helper that **mirrors the
  backend `_derive_status` (`dashboard.py:229-241`)**: `null → 'awaiting_eval'`,
  `'accepted' → 'accepted'`, `'rejected' → 'rejected'`,
  `'major_revision' | 'minor_revision' → 'needs_revision'`, and a defensive
  `else → 'awaiting_eval'` (param typed `string | null` because `ThreadEvaluation.result`
  is `string`).
- **Expanded:** submission metadata (number, submitted_at, submitted_by name, is_late,
  is_resubmission, file_size), the PDF **download** link (`/api/submissions/{id}/file`),
  the auto-accepted-resubmission banner when `is_resubmission`, and the read-only
  evaluation view. The evaluation view renders the feedback-file **download** link
  (`/api/evaluations/{eid}/feedback-file`) when `evaluation.has_feedback_file` (parity
  with the latest entry today). When `evaluation == null`, it renders "Awaiting
  evaluation" and no evaluation view.

Per-entry `expanded` state is owned by the panel and keyed by **submission id** so it
survives a thread refetch (a write must not collapse everything). The state must be
reactive under Svelte 5 runes — use a reassigned `$state` `Record<number, boolean>`
(or a `SvelteSet`), not a plain mutated `Set`. The historical region gets a short
heading (e.g. "Previous submissions") above the collapsed entries.

### 6.3 Panel behaviour (submission cell only)

1. **Gate.** Only submission targets with `latest_submission != null` fetch a thread.
   For `not_submitted` the panel keeps rendering only "Not submitted yet." (§8) — no
   fetch, no thread section, no write form.
2. **`newest` — single authoritative newest entry (a `$derived` `ThreadSubmission | null`).**
   Derived from a `thread` `$state` (the resolved `.submissions`, `null` until it
   resolves); used for the newest-entry render *and* the write-form target. "`newest =
   thread[0]`" below denotes this derivation recomputing, not an imperative assignment:
   - Before the thread resolves (and `latest_submission != null`): optimistically
     `newest = { ...target.entry.latest_submission, evaluation: target.entry.latest_evaluation }`
     — a `ThreadSubmission` (submission fields **spread** at top level, evaluation
     nested), so the latest renders instantly from the cell entry (no flash).
   - After the thread resolves: **the thread is authoritative** — `newest = thread[0]`.
     If a group resubmitted between the grid load and the thread fetch, `thread[0].id`
     may differ from `target.entry.latest_submission.id`; the thread wins (there is
     **no** "same id" invariant). A gated cell (`latest_submission != null`) is
     guaranteed ≥1 row by the backend, but defensively fall back to the optimistic value
     if `thread` ever resolves empty (so `newest` is never `undefined` for a gated cell).
   - The panel's newest read-only markup + write/edit form read from `newest` (e.g.
     `newest.id`, `newest.submission_number`, `newest.is_resubmission`) instead of
     `target.entry.latest_submission`. **Create** posts to `newest.id` (replacing
     today's `target.entry.latest_submission!.id`; keep a `newest != null` guard since
     `newest` is nullable — the existing `handleSave` `target.kind` guard `:182` does not
     narrow it). **Patch** targets `effectiveEvaluation.id` (see §6.4). Both replace the
     cell-entry-derived ids.
3. **Render.** Newest entry (index 0) is **panel-rendered** exactly as today
   (submission metadata + read-only evaluation view *or* the write/edit form, mutually
   exclusive via the existing `editing` / create / awaiting branches), just repointed to
   `newest`. Historical entries (`thread.slice(1)`) render via the read-only
   `SubmissionThreadEntry` sub-component, **collapsed**, expandable on click. If
   `thread.length === 1`, there is no historical region.
4. **Loading / error.** The newest entry renders instantly (no flash); a loading
   indicator is scoped to the **historical (older-entries) region only** while the
   thread is in flight. On thread error, an inline message **plus a retry button** that
   re-runs `getSubmissionThread`. The panel has **no** retry button and **no**
   `.banner-error` style rule today (the class is used at `:369` but unstyled in the
   panel; siblings like `RunSubmissionTab` define their own), so this slice **adds** a
   local `.banner-error` rule (matching the siblings) and the retry button. The error
   handler is a **catch-all** (like the progress branch `:325-331`), not `ApiError`-only,
   because `api.get` surfaces a raw network failure as a `TypeError`, not an `ApiError`
   (unlike `evaluations.ts`). Exact loading/error copy is left to the plan (progress
   uses `<p>Loading…</p>` and a fixed message as the model).
5. **Abort / stale + effect keying.** Derive `runId`, `mpId`, and `groupId` as
   **separate primitive `$derived` values**, **folding the fetch-gate (pt1) into them**
   so the effect never reads `target` for gating either — e.g.
   `const mpId = $derived(target.kind === 'submission' && target.entry.latest_submission != null ? target.mp.id : null)`
   (and likewise `runId`, `groupId`). Have the thread-fetch `$effect` read **only those
   primitives** — NOT `target` / `target.mp.id` / `target.entry.latest_submission`
   inline. Rationale: `panelTarget` is a `$derived.by` returning a fresh object each
   `refresh()` (`RunSubmissionTab.svelte:38-43`), so reading `target` inline (even just
   to gate) would retrigger the effect on every `onRefetch()`; reading only the
   primitives means the `$derived` ids recompute to strict-equal values (runes `$derived`
   uses strict equality by default), which don't propagate downstream, so the effect
   fires **once per cell**. When the ids change (cell switch), the effect
   **resets the `thread` `$state` to `null`** (mirroring the progress branch's
   `data = null` at `DashboardSidePanel.svelte:322`) so the new cell shows its own
   optimistic newest, not the prior cell's `thread[0]`. The post-write thread refetch is
   a **manual** call (§6.4), not effect-driven. An `AbortController` + `stale` guard
   aborts the in-flight fetch on cell switch / close (correctness is preserved by this
   guard even if the effect over-fires) — matches the abort/stale pattern used elsewhere
   (interactive-app player, `RunProgressTab`).

### 6.4 Write/edit flow (largely unchanged, precise deltas)

- The evaluation write/edit **logic, validation, POST/PATCH calls, and the flat→nested
  "Just now"/"You" bridge stay in `DashboardSidePanel`** (the newest entry is
  panel-rendered; the sub-component never owns the form). Deltas:
  - **Redefine** `effectiveEvaluation = stateLatestEvaluation ?? newest?.evaluation ?? null`
    (replacing `target.entry.latest_evaluation` at `:78-81`). This keeps a single
    evaluation source for **all** its dependents: the patch target (`effectiveEvaluation.id`),
    the edit-prefill `$effect` (`:90-107`), `resultLocked` (`:84`),
    `existingHasFeedbackFile` (`:83`), and the create-vs-edit branch (`:181`). Because
    `stateLatestEvaluation` (the flat post-write response) is the first operand, the
    create-then-immediately-edit path still works before any refetch (patching the newly
    created evaluation's id) — this is why patch must stay on `effectiveEvaluation.id`
    and **not** move to `newest.evaluation.id` (which is `null` in the fresh-create
    window).
  - **Create target** becomes `newest.id` (replacing `target.entry.latest_submission!.id`
    at `:184`).
  - The "Just now"/"You" bridge discriminator (`:441-442`) moves from
    `target.entry.latest_evaluation` to `newest?.evaluation` (show "Just now"/"You" when
    `stateLatestEvaluation` is set but `newest.evaluation` is null/stale).
- **After a successful write** (flat `Evaluation` response): keep setting
  `stateLatestEvaluation = result` so the newest entry renders immediately via the
  bridge, **then** manually re-run `getSubmissionThread` (a direct call, not the keyed
  effect — §6.3 pt5) **and** call `onRefetch()` (grid badge). In the refetch's `.then`,
  once it resolves, `newest = thread[0]` carries the real nested evaluation and
  `stateLatestEvaluation` is **cleared** (so the bridge stops applying and the newest
  render matches every other entry). Clearing `stateLatestEvaluation` flips
  `effectiveEvaluation` to `newest.evaluation` (same field values, new object identity),
  which would re-fire the edit-prefill `$effect` (`:90-107`); harmless when not editing,
  but the clear must be **guarded so it never resets an in-progress edit** — clear only
  when `!editing`, or defer the clear until edit mode exits. The same manual thread
  refetch also runs on the **409** path (which already calls `onRefetch()` at `:218`).
- **Restructure note (effort realism):** the current read-only evaluation markup appears
  in two places (`:424-434`, `:436-449`) and the write form is duplicated across the
  edit (`:453-521`) and create (`:525-589`) branches, interleaved with the "Just
  now"/"You" special-case. Repointing this markup to `newest` and extracting the
  historical read-only path into `SubmissionThreadEntry.svelte` is a **restructure of
  `:402-593`**, not a lift-and-shift.

**Unchanged:** the panel header (MP title, block, group, status) still comes from the
cell entry.

---

## 7. Data flow

```
click submission cell
  → panel opens; if latest_submission == null → "Not submitted yet." (no thread, no fetch)
  → else newest = optimistic({...latest_submission, evaluation: latest_evaluation});
    newest renders instantly from cell entry
  → getSubmissionThread(runId, mpId, groupId)   [effect keyed on mpId/groupId primitives]
      → { submissions: [newest, …, oldest] }
  → newest = thread[0] (authoritative); render newest panel-side (+ write form),
    thread.slice(1) via SubmissionThreadEntry (collapsed, read-only)
  → teacher writes/edits evaluation on newest
      → create → POST /api/submissions/{newest.id}/evaluation
        edit   → PATCH /api/evaluations/{effectiveEvaluation.id}
      → flat response → optimistic "Just now"/"You" render (stateLatestEvaluation)
      → manual getSubmissionThread refetch  +  onRefetch() grid refresh
      → on refetch: newest = thread[0] (real nested eval); clear stateLatestEvaluation;
        cell badge updates
```

---

## 8. Edge cases

- **`not_submitted` cell** (`latest_submission == null`): panel renders **only**
  "Not submitted yet." — no submission block, no evaluation block, no write form, and
  no thread section (the thread fetch is not even issued). (Panel still *opens* — every
  cell's button calls `openPanel`.)
- **Newest submission pending (no evaluation):** newest entry shows "Awaiting
  evaluation" + the write form (panel-rendered, as today). A historical submission with
  no evaluation is unusual (a new submission is blocked while the prior is unevaluated)
  but renders gracefully in the sub-component: collapsed badge = `awaiting_eval`,
  expanded view shows "Awaiting evaluation", no write form (historical entries are
  read-only).
- **Single submission (`thread.length === 1`):** newest panel-rendered, no historical
  region.
- **Auto-accepted resubmission:** per-entry read-only banner — in panel markup for the
  newest, in the sub-component for historical entries.
- **Cell switch mid-fetch:** stale thread discarded via abort/stale guard.
- **Concurrent resubmission between grid load and thread fetch:** `thread[0].id` may
  differ from the cell entry's `latest_submission.id`; the thread wins and the write
  form targets `newest.id` = the true newest submission (§6.3 pt2).
- **Concurrent change by another teacher:** surfaced on the next thread refetch /
  manual grid refresh; no live sync (consistent with the rest of the dashboard).
- **Thread fetch fails (network or 4xx/5xx):** catch-all handler → inline error +
  retry; the newest entry (already rendered from the optimistic `newest`) stays visible.
- **Group/MP not in run, or nonexistent ids:** uniform 404 `"Resource not found"` from
  the endpoint; surfaced via the same inline error state.

---

## 9. Testing

**Backend** (`backend/tests/test_dashboard_*.py` or a new
`test_dashboard_submission_thread.py`; reuse the existing
`student_client_for` / `teacher_user` / `teacher_client` / `admin_client` fixtures and
the `RunTeacher`-row pattern from `test_dashboard_item_drilldown.py`):
- Returns all submissions for the group×MP, newest-first, each with nested
  `evaluation` (and `null` when unevaluated) and submitter/evaluator `full_name`.
- Empty group → `{"submissions": []}`.
- Auth: student → 403; teacher on the run → 200; admin → 200; unrelated user → 403.
- `mp_id` not in `run_id` → 404 `"Resource not found"`; `group_id` not in `run_id` →
  404 `"Resource not found"`; nonexistent ids → same.
- Only the target group's submissions are returned (not other groups').
- Correctness of the stitch: a submission with an evaluation and one without, in the
  same thread, are serialized correctly (evaluation nested vs `null`). (No query-count
  assertion — there is no statement-count harness in `backend/tests`; assert the
  stitched structure instead.)

**Frontend** (`frontend/src/tests/DashboardSidePanel.*.test.ts` **and**
`frontend/src/tests/RunSubmissionTab.svelte.test.ts`, mount/unmount/flushSync pattern):
- **Retrofit existing `DashboardSidePanel` submission tests.** Submission targets now
  issue a thread fetch on open, so the existing "submission variant: no fetch" tests must
  be updated with a **URL/method-routing `fetch` stub** (route `…/submissions` GET →
  thread body; the evaluation POST/PATCH → evaluation body). A single-body stub would
  misfeed the thread fetch an evaluation-shaped payload. **Additionally**, the write-flow
  tests that assert on call counts/order (`toHaveBeenCalledTimes(1)`,
  `not.toHaveBeenCalled()`, `mock.calls[i]`) must be rewritten to **filter
  `fetchMock.mock.calls` by URL** (assert the *evaluation* endpoint was/wasn't hit),
  because the thread GET now fires on mount and again after each write, changing every raw
  count/index. The `submissionTarget()` fixture (and any inline `$state` targets) must
  gain the new `runId` field (§6.1), and each retrofitted test's thread stub must **echo
  its cell entry** (a `thread[0]` whose submission + evaluation mirror the target's
  `latest_submission` / `latest_evaluation`) so existing content assertions still hold
  after "thread wins."
- **Retrofit `RunSubmissionTab.svelte.test.ts` panel-opening tests.** `RunSubmissionTab`
  mounts the **real** `DashboardSidePanel` (`RunSubmissionTab.svelte:292-300`), so any tab
  test that opens a *submitted* cell now triggers the on-open thread GET. Tests like TS1
  (`:682`) and TS2 (`:740`) stub `fetch` with a sequential `mockResolvedValueOnce` chain
  of dashboard responses (`:718-720`, `:743-745`); the thread GET would consume the *next*
  chained response (e.g. TS1's post-Refresh `v2`) and exhaust the chain. These must be
  converted to **URL/method-routed** stubs (dashboard GET → the intended dashboard body;
  thread GET → a thread body echoing the opened cell) so the dashboard responses aren't
  swallowed by the thread fetch. `not_submitted`-cell tab tests are unaffected (no thread
  fetch — §6.3 pt1).
- Thread renders every submission newest-first; newest panel-rendered with the write
  form; historical entries read-only and collapsed; expand-on-click reveals detail;
  per-entry `expanded` survives a write (keyed by submission id).
- **Single submission** (`thread.length === 1`): newest panel-rendered with the write
  form, and **no** historical region (no "Previous submissions" heading, no disclosure
  buttons).
- **Thread wins:** when the stubbed thread's newest entry has a **different** id than the
  cell entry's `latest_submission`, the write targets the thread's newest id
  (`newest.id`), not the cell entry's.
- Collapsed summary badge maps `result → status` correctly (incl. `null → awaiting_eval`).
- Loading indicator scoped to the historical region while fetching; thread error →
  inline error + retry button; retry re-fetches. (Cover both a 4xx `ApiError` and a
  raw network `TypeError` to exercise the catch-all.)
- Cell switch aborts the in-flight fetch and does not render the stale thread.
- Evaluation write on the newest: create targets `newest.id`; on success the optimistic
  "Just now"/"You" render is replaced by the nested thread evaluation after the manual
  refetch, and `onRefetch` is called. Create-then-immediately-edit (before refetch)
  patches the freshly created evaluation via `stateLatestEvaluation`.
- `not_submitted` cell renders only "Not submitted yet." — no thread section, no thread
  fetch, no write form.
- Per-entry auto-accepted-resubmission banner; newest awaiting-evaluation state; a
  historical `evaluation: null` entry renders gracefully.
- Add stable hooks (`data-test` / aria) for: the thread container, each collapsed
  summary disclosure button, the loading indicator, and the retry button.

---

## 10. Global constraints

- **Frontend:** Svelte 5 runes only, no JS/CSS deps; component tests use
  `mount`/`unmount`/`flushSync`/`tick` from `svelte`, not `@testing-library`.
- **Backend:** reuse `dashboard.py`'s `_serialize_submission` / `_serialize_evaluation`
  / `_serialize_user_ref`; return a plain `dict` (no `response_model`), matching the
  grid-endpoint convention (`get_mini_projects`); auth via
  `require_run_admin_or_teacher`; probe-safe `detail="Resource not found"` on 404s
  (matching the drilldown `dashboard.py:453,461,466`).
- **No change** to the student submission flow, the existing evaluation write/PATCH
  endpoints, or the dashboard grid endpoint.

---

## 11. Future (not this slice)

In-app PDF preview; editable historical evaluations; bulk download; thread pagination;
PATCH feedback-file support (Phase 9); submitter email in the thread.
