# Evaluations Write Surface — Design

**Status:** draft rev 4.2
**Date:** 2026-06-04
**Branch:** `evaluations-write-surface`
**Predecessor:** teacher-dashboards (merged 2026-06-03, `742a124`)
**Rev 1 → Rev 2:** addressed convergent findings from 5 parallel reviewers — per-run teacher derivation, prop threading, types in `lib/evaluations.ts`, reuse `api.patch` + `ApiError`, mirror `runAssets.ts`, hardcoded size cap, result-lock UX via disabled `<option>`, dirty-guard, abort/timeout, refetch callback, expanded test plan, rewritten smoke step 10.
**Rev 2 → Rev 3:** second review round PASS from backend, frontend-stack, UX. REVISE from test-coverage + integration converged on: (a) explicit `401 → emitUnauthorized` branch missing from multipart POST; (b) `state.latestEvaluation ?? target.entry.latest_evaluation` fallback for post-CREATE PATCH not explicit; (c) wrong file path `components/runs/RunDetailPage` → `pages/runs/RunDetailPage`; (d) type name `RunTeacher` → `RunTeacherResponse`; (e) WT7 401 test, T29 timeout, T30 focus, T31 409-race tests; (f) FocusTrap autofocusSelector value + branch scope; (g) `.banner-info` CSS; (h) Cancel-vs-× during submit reconciled (both no-op during submit; only Cancel-button-during-submit acts as abort because it's the explicit affordance); (i) §3 wording fix; (j) result-lock condition simplified.
**Rev 3 → Rev 4:** independent codex second-opinion REVISE. Critical fixes: (k) `teachers` is nullable until load completes — derivation must use `(teachers ?? []).some(...)`; (l) DirtyGuard API is `isDirty: () => boolean` (callback), NOT `active`; (m) panel target rebind in `RunSubmissionTab` ONLY — derive `panelTarget` from `{ mpId, groupId }` against refreshed `data` so 409 refetch actually replaces the panel's view. `RunProgressTab` keeps its own target architecture (different shape, no write surface). Important: (n) `Evaluation.evaluated_by` shape mismatch with dashboard payload — normalize before rendering; (o) MIME validation relaxed — extension-only (browser `File.type` can be empty); (p) wire module DOESN'T mirror `runAssets.ts` "exactly" — align error strings; (q) §3 add 401 (no session) and CSRF 403 paths from `dependencies.py:14-19`; (r) Save button must use native `disabled` attribute (not just `aria-disabled`); (s) +T33 state.latestEvaluation handoff, T28 expanded to create-mode, T27 +MIME case. Minor: §2 stale test count fixed.
**Rev 4 → Rev 4.1:** codex rev-2 verification. 9/10 prior items closed; partial item 4 (POST-before-refetch read-only display under-specified) — fully specified now with "You" / "Just now" placeholders. New issues: (t) RunProgressTab rebind incorrectly scoped — removed; (u) §9 still had stale `aria-disabled` Save wording — aligned to native `disabled`; (v) line-count drift between §2 and §11 — fixed to ~+560 lines.
**Rev 4.1 → Rev 4.2 (this rev):** final polish pass from 3 fresh reviewers. (w) `catch (e: unknown)` + type-narrow per the rev-4 align intent; (x) new panel props (`isAdmin`/`isTeacher`/`onRefetch`) are OPTIONAL with defaults so existing 14 tests keep passing — same for `RunSubmissionTab`/`RunProgressTab`; (y) explicit RunSubmissionTab mount template snippet; (z) auto-accept branch CORRECTED — banner + read-only eval block (if present) + NO form / NO [Edit], so existing T6 fixture (auto-accepted resubmission with eval) still asserts correctly; (aa) citation fixes: `Toast.svelte:26-29`, `evaluations.py:85` (oversize), `RunProgressTab.svelte:26 + :379` shape; (bb) `§6.4` mis-reference resolved to "Submit flow step 2 setup + step 6 handling".

## 1. Scope

Close the teacher-evaluation loop on the Submission tab. The `DashboardSidePanel` (when `target.kind === 'submission'`) flips from read-only to interactive when the viewer can write — admins (CourseAdmin) or teachers assigned to THIS run (RunTeacher for this `runId`) — so the panel hosts BOTH the read-only submission details AND the evaluation form, stacked vertically.

**No backend changes.** Frontend consumes the existing Phase 7b endpoints:
- `POST /api/submissions/{sid}/evaluation` (multipart) — create
- `PATCH /api/evaluations/{eid}` (JSON) — edit
- `GET /api/submissions/{sid}/file` — already wired (download submission)
- `GET /api/evaluations/{eid}/feedback-file` — already wired (download feedback)

## 2. Files touched

**New:**
- `frontend/src/lib/evaluations.ts` (~140 lines) — wire module + types + size-cap constant + helper.
- `frontend/src/tests/evaluations.test.ts` (~190 lines, 8 tests).

**Modified:**
- `frontend/src/components/runs/DashboardSidePanel.svelte` (~+250 lines) — extend the existing `submission` branch with the form, dirty-guard, focus management, abort/timeout, etc.
- `frontend/src/tests/DashboardSidePanel.svelte.test.ts` (~+560 lines, +19 tests; current count 14 → 33).
- `frontend/src/pages/runs/RunDetailPage.svelte` — derive `isThisRunTeacher` from already-fetched `teachers: RunTeacherResponse[]` + `session.user`; thread `{ isAdmin, isTeacher }` props to both tab components.
- `frontend/src/components/runs/RunSubmissionTab.svelte` — accept the two new props, pass them down to `DashboardSidePanel`, expose a `refresh` callback to the panel.
- `frontend/src/components/runs/RunProgressTab.svelte` — accept the two new props, pass them down (the panel mount at line 378 is unchanged in behavior; props are forwarded for type-uniformity even though Progress doesn't render the eval form path itself — see §5).

**Backend:** no changes. The existing endpoints enforce permissions, the auto-accept invariant, the feedback-file-required rule, the file-size cap, and the notification side effect.

**Out-of-spec polish that touches one file (decide before plan T1):**
- `frontend/src/components/chrome/Toaster.svelte` — add `aria-live="polite"` to the container so SR users hear the success toast reliably. One-line addition. See §9.

## 3. Backend contract (reference — read but do NOT modify)

### POST `/api/submissions/{sid}/evaluation` (multipart)
- Required: `result` ∈ `rejected|major_revision|minor_revision|accepted`.
- Optional: `score` (int 0–100), `feedback_text` (str), `file` (PDF). `file` is REQUIRED when `result != 'accepted'`.
- **Frontend-only invariant:** `feedback_text` is required when `result != 'accepted'` (paired with the annotated PDF per design discussion 2026-06-04). Backend does NOT enforce this; gate client-side.

Status codes (verified against `backend/mathion/api/evaluations.py`):

| Code | Trigger | Implementer note |
| --- | --- | --- |
| 201 | success | response body is `EvaluationResponse` |
| 400 | file checks: oversize (`:85` check + `:85-89` raise), wrong/unrecognized extension (`:79`), allowed-but-not-PDF (`:81`), empty file (`:84`) | pre-flight all of these client-side. Note: "file missing" when `result != 'accepted'` is 422 (see below), NOT 400. |
| 401 | no session (shared dependency at `backend/mathion/dependencies.py:14-19`) | wire code handles: calls `emitUnauthorized()` and throws `ApiError(401, 'Not authenticated')`. Caller sees ApiError; the bounce-to-login happens out-of-band. |
| 403 | (a) `require_run_admin_or_teacher` rejects (`helpers.py:109-132`); (b) CSRF reject when `X-Requested-With` header is missing on non-GET (`dependencies.py:14-19`) | (a) message: "Run admin or teacher access required"; (b) wire code MUST include `X-Requested-With: 'mathion'` to avoid (b). |
| 404 | `sid` not found | unlikely path; surface generic |
| 409 | `sub.is_resubmission=True` (`:69-70`) OR submission already evaluated (UNIQUE collision, `:108-112`) | banner blocks the former; refetch+switch-to-read-only handles the latter (two-tabs race) |
| 422 | `result` not in enum, `score` out of range, `file` missing when `result != 'accepted'` (backend rule) | re-render inline errors |

Side effect: writes one `NotificationLogEntry { kind="evaluation_received" }` per group member (`:138-149`).

### PATCH `/api/evaluations/{eid}` (JSON, `EvaluationUpdate`)
- Mutable fields (`schemas.py:630-633`): `result`, `score`, `feedback_text`. **Not** `feedback_file`.
- 422 when transitioning to `result != 'accepted'` while existing eval has `feedback_file is None` (`evaluations.py:193`) — detail: "create a new evaluation instead". Frontend MUST gate this client-side.
- 403/404 paths as in POST.

## 4. Permission gate

Backend enforces admin-OR-run-teacher for both POST and PATCH (`require_run_admin_or_teacher`). The frontend mirrors this for UI affordances:

**Critical:** `User.has_run_teacher` is a **GLOBAL** flag (`backend/mathion/api/auth.py:26-28`: true if the user is a teacher on ANY run). `auth.py:19-22` warns: "Flags are UI hints for nav rendering only. ... Do NOT branch on these flags in any new endpoint." Therefore the panel MUST use a per-run signal.

**Derivation chain:**

1. `pages/runs/RunDetailPage.svelte` already calls `listRunTeachers(runId)` and stores `teachers: RunTeacherResponse[] | null` (null until the load resolves at `:302`). Add:
   ```ts
   import { session } from '../../stores/session.svelte';
   const isThisRunTeacher = $derived(
     session.user != null && (teachers ?? []).some(t => t.user_id === session.user!.id)
   );
   const isAdmin = $derived(course?.is_admin === true);
   ```
   While `teachers === null`, `isThisRunTeacher === false` — the panel renders read-only until the teacher list resolves. This is a safe transient state (the tab's loading gate at `:302` blocks tab content anyway). Admins still see the form immediately because `isAdmin` derives off `course`.
2. Pass `isAdmin` + `isTeacher={isThisRunTeacher}` to `<RunSubmissionTab>` AND `<RunProgressTab>`.
3. Each tab forwards both to `<DashboardSidePanel>` as props.
4. Inside the panel:
   ```ts
   // All three new props are OPTIONAL with sensible defaults so existing 14 tests
   // (which mount with only { target, onClose }) keep passing without modification.
   let {
     target,
     onClose,
     isAdmin = false,
     isTeacher = false,
     onRefetch = () => {},
   }: {
     target: PanelTarget;
     onClose: () => void;
     isAdmin?: boolean;
     isTeacher?: boolean;
     onRefetch?: () => void;
   } = $props();
   const canWrite = $derived(isAdmin || isTeacher);
   ```
   Same optional-with-default convention applies to `RunSubmissionTab` and `RunProgressTab` for the same reason (existing tests mount with `{ runId }` only).
5. If `canWrite === false`, the panel renders exactly as today (read-only).

**Defense-in-depth:** if a manipulated DOM lets a non-write user click Save, the backend returns 403; the form surfaces it in the error banner.

## 5. Side-panel layout (Submission kind, extended)

The current panel (`DashboardSidePanel.svelte:147`) hides the read-only Evaluation block when `target.entry.status === 'awaiting_eval'`. Rev 2's form logic supersedes that branch: when `canWrite` AND the cell is `awaiting_eval`, the panel shows the form INSTEAD of the read-only "no evaluation yet" placeholder.

Vertical stack (top to bottom):

```
Header
  MP title — group name — status badge

Submission block (read-only, unchanged from today)
  file_size, submitted_by, submission_number, is_late, is_resubmission
  [Download submission]

Branch on state (in order):

  IF latest_submission is null:
    "No submissions yet" placeholder (existing)
    → STOP

  IF latest_submission.is_resubmission === true:
    Banner (variant=info): "Auto-accepted on resubmission. No manual evaluation needed."
    IF latest_evaluation exists:
      Evaluation block (read-only — existing UI) so the user can SEE the auto-accept eval
    → STOP (no form, no [Edit] button regardless of canWrite)

  IF latest_evaluation exists:
    Evaluation block (read-only — existing UI: result badge, score, feedback_text,
      evaluated_at, evaluated_by, [Download feedback file] when has_feedback_file)
    IF canWrite:
      [Edit evaluation] button → expands form pre-filled (form replaces this block)

  ELSE IF canWrite:
    "New evaluation" section header
    Form (visible immediately; no extra click)

  ELSE:
    "Awaiting evaluation" placeholder text
```

**`feedback_file` filename is NOT in the payload** (`DashboardMpGroupEntry.latest_evaluation` exposes only `has_feedback_file: boolean`). The pre-filled form CANNOT show the existing filename. Use the placeholder string "Existing feedback file uploaded — replace not supported (Phase 9)" below the file input.

**Post-CREATE PATCH source-of-truth.** After a successful POST, the panel keeps a local `state.latestEvaluation: Evaluation | null` (the response body). All branches in the pseudocode above read `state.latestEvaluation ?? target.entry.latest_evaluation` for "evaluation exists" and "result/score/feedback_text" pre-fill; subsequent PATCH calls use `state.latestEvaluation!.id`. The parent's `onRefetch()` updates `target.entry` on its next mount cycle (see "Panel target rebind" below); until then `state.latestEvaluation` is the authoritative source.

**`evaluated_by` shape mismatch — render normalization.** The local `Evaluation.evaluated_by` is an int (matches backend `EvaluationResponse`). The dashboard payload's `latest_evaluation.evaluated_by` is an OBJECT (`{ user_id, full_name }` per `frontend/src/lib/dashboards.ts:90-98`) which the existing read-only block already renders via `.full_name` (`DashboardSidePanel.svelte:151-152`). After a POST, the panel has only the int — it cannot render `.full_name`.

Spec rule: the panel keeps TWO sources and uses them differently:
- **For "evaluation exists" branch + field pre-fill** (result, score, feedback_text, has_feedback_file): read `state.latestEvaluation ?? target.entry.latest_evaluation`. The union shape works because both expose those fields.
- **For the read-only display block** (evaluator name + evaluated_at): prefer `target.entry.latest_evaluation` when present (full object with `.full_name`). When only `state.latestEvaluation` is present (POST resolved, parent refetch in flight or stalled), render the placeholders **"You" + "Just now"** in place of `.full_name` and the formatted `evaluated_at`. When `refresh()` resolves, `target.entry.latest_evaluation` populates and the placeholders are replaced on next render.
- **Edge case for T33 (refetch never resolves)**: the read-only block stays on "You" + "Just now" indefinitely; clicking [Edit] still works because pre-fill reads from `state.latestEvaluation` and the next PATCH uses `state.latestEvaluation.id`. This is the precise behavior T33 asserts.

The panel-target-rebind change below ensures `target.entry` updates after `refresh()` in the normal (non-mocked) case.

**Panel target rebind (tab-level architectural change — RunSubmissionTab ONLY).** Today `RunSubmissionTab.svelte:114-116` stores `panelTarget = { mp, entry }` as a snapshot at open time and `refresh()` at `:58-70` only replaces `data`, not `panelTarget`. After `refresh()` the panel sees a stale `target.entry` — making the 409 race recovery (§6 step 5) impossible. Fix: replace `panelTarget` with `selectedIds: { mpId: number, groupId: number } | null` set at open time, and derive the target reactively:
```ts
const panelTarget = $derived.by(() => {
  if (selectedIds == null || data == null) return null;
  const mp = data.mini_projects.find(m => m.id === selectedIds.mpId);
  const entry = mp?.entries.find(e => e.group_id === selectedIds.groupId);
  return mp && entry ? { kind: 'submission', mp, entry } : null;
});
```
When `refresh()` resolves with new `data`, `panelTarget.entry.latest_evaluation` updates automatically. If the winning eval lands in `data`, the panel transitions to read-only via the §5 layout branch on the next render — no manual state poke needed.

**Do NOT apply this rebind to `RunProgressTab.svelte`.** Progress targets are `{ user_id, sequence_id }` stored at `RunProgressTab.svelte:26`, with `runId` injected at panel mount via object spread (`:379`). The panel's `ProgressTarget` shape is `{ runId, user_id, sequence_id }` per `DashboardSidePanel.svelte:19-24`. This is a different shape from submission's `{ kind, mp, entry }` and the progress panel has no eval-write surface (purely read-only). `RunProgressTab`'s target architecture is unchanged. The `isAdmin` + `isTeacher` props are still forwarded to the panel (for type-uniformity), but the `submission`-branch form they gate is only reachable when the panel renders via `RunSubmissionTab`.

`onClose` clears `selectedIds`. If `refresh()` resolves with the row gone (rare — admin deleted the MP), `panelTarget` becomes `null` and the panel auto-closes. Document this in the tab's tests.

**Mount template for `RunSubmissionTab`** (replaces the existing `RunSubmissionTab.svelte:279-283`):
```svelte
{#if panelTarget}
  <DashboardSidePanel
    target={panelTarget}
    onClose={closePanel}
    {isAdmin}
    {isTeacher}
    onRefetch={refresh}
  />
{/if}
```
Where `isAdmin` and `isTeacher` are received as props from `RunDetailPage` and `refresh` is the existing private function at `RunSubmissionTab.svelte:58-70`.

## 6. Form — result, score, feedback_text, feedback_file

### Fields (top to bottom)

| Field | HTML | Behavior |
| --- | --- | --- |
| Result | `<select>` with 4 `<option>` (rejected, major_revision, minor_revision, accepted) | Always enabled. When editing an existing eval with `has_feedback_file === false` (which by the DB CHECK constraint `ck_evaluation_feedback_file_required` at `models.py:330-333` implies `result === 'accepted'`), mark the three non-accepted options as `disabled` and render verbatim visible helper text under the field: `"Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead."` This implements the PATCH 422 invariant client-side. |
| Score | `<input type="number" min=0 max=100 step=1>` | Optional. Always visible. Nullish pre-fill → empty input (NOT the string "null"). Inline error below input for out-of-range / non-integer. |
| Feedback text | `<textarea maxlength=1000 aria-describedby="feedback-text-count feedback-text-error">` | Required (non-empty after trim) when `result != 'accepted'`; optional when accepted. Nullish pre-fill → empty. Plain textarea (no markdown). Live counter `{n}/1000` below the box with `aria-live="polite"`. Counter announces only on crossing 900/1000 (not every keystroke); visual marker is a non-color signal (bold + word "approaching") at 900+, not color alone. |
| Feedback file | `<input type="file" accept=".pdf,application/pdf">` | Required for non-accepted result on create. On edit: file picker is hidden and the placeholder text above is shown (PATCH cannot replace; backend would 422 silently). Helper text below picker on create: "PDF only, max 20 MB." Client-side checks: size ≤ `MAX_FEEDBACK_FILE_SIZE_BYTES`, extension `.pdf` (case-insensitive), size > 0. **MIME is best-effort only**: if `file.type` is non-empty AND not `'application/pdf'`, reject; if `file.type` is empty (which browsers do for `.pdf` in some environments), accept and rely on the extension + backend re-check at `evaluations.py:81`. |
| Save | `<button type="submit" disabled={!valid \|\| submitting} aria-busy={submitting}>` | Native `disabled` attribute (not just `aria-disabled`) so the button is unclickable AND screen-reader-announced as disabled. Inline spinner during submit. Even with `disabled`, the form submit handler MUST explicitly re-check `valid && !submitting` and return early before calling fetch — defense in depth against form-submission via Enter key on hidden inputs. |
| Cancel | `<button type="button">` | When editing: closes the edit form (with dirty-guard if changed), returns to read-only block. When creating + dirty: prompts InlineConfirm. When creating + clean: hidden (form is the panel's primary content). |

### Validation (client-side, mirror backend)

- Result required.
- Score: empty allowed (treated as null); if present, integer 0–100.
- Feedback text: required (non-empty after trim) when `result != 'accepted'`. Max 1000 chars (HTML enforces, JS asserts).
- Feedback file: on CREATE, required when `result != 'accepted'`. Pre-flight: PDF extension (case-insensitive `.pdf`) + size > 0 + size ≤ `MAX_FEEDBACK_FILE_SIZE_BYTES`. MIME is best-effort: reject only if `file.type` is non-empty AND not `'application/pdf'`.
- Result-lock invariant (EDIT only): if existing eval has `has_feedback_file === false`, only `accepted` is selectable.

When ANY check fails, the corresponding inline `<span role="alert">` renders below the field and `fetch` MUST NOT be called.

### Error wording (user-facing)

- "Result is required."
- "Score must be a whole number between 0 and 100."
- "Feedback is required when the result is not Accepted."
- "PDF file required for non-accepted results."
- "Only PDF files accepted."
- "File exceeds 20 MB limit."
- "File appears empty."

### Submit flow

1. Disable Save + show spinner. Set `aria-busy="true"` on Save. Cancel STAYS enabled (it aborts).
2. Construct `AbortController` with a 60 s timeout (`setTimeout(() => controller.abort('timeout'), 60_000)`). Pass `signal` to the wire call. Cancel button calls `controller.abort('user-cancel')`.
3. POST (create) or PATCH (edit):
   - POST: `FormData` via `createEvaluation` (see §7). Browser sets Content-Type.
   - PATCH: JSON via `patchEvaluation` (see §7). No file.
4. On 2xx:
   - `pushToast('Evaluation saved; group notified', 'success')`.
   - Call the parent's `refresh()` (passed as `onRefetch` prop) to re-fetch `getMiniProjectsDashboard(runId)` and update the grid + cell status.
   - Local `state.latestEvaluation = response`; panel switches to read-only mode for the new eval (no close).
   - Focus moves to the [Edit evaluation] button (`tabindex=-1` if not yet focusable).
5. On 4xx/5xx (non-abort):
   - Error banner above form `role="alert"` with `ApiError.displayMessage`. Save re-enabled. Form field values preserved verbatim.
   - On 409 (already-evaluated race): call `refresh()` AND transition the panel to read-only with the winning eval (avoid phantom create-form).
6. On abort:
   - `'user-cancel'`: silently revert UI to pre-submit state. Form values preserved.
   - `'timeout'`: error banner "Upload timed out. Try again." Save re-enabled.

### Unsaved-changes guard

Adopt the `MiniProjectModal` pattern (`MiniProjectModal.svelte:102-115`):
- `const isDirty = $derived(...)` — true iff any field differs from its pre-fill value.
- Backdrop click, Escape key, `× Close` button, Cancel button (in edit mode): if `isDirty && !submitting`, show `InlineConfirm` "Discard changes?"; on confirm-no the form stays; on confirm-yes the form closes (back to read-only block, or close panel for the create path).
- During submit: backdrop click, Escape key, `× Close` button are ALL no-ops (mirror `closeForCurrentStage` early-return at line 107). The Cancel button is the ONLY abort affordance during submit — it calls `controller.abort('user-cancel')` (see Submit flow step 2 setup + step 6 handling).
- In-app navigation: mount `<DirtyGuard isDirty={() => isDirty && !submitting} />` (existing component — the prop is a callback returning a boolean, matching the convention at `frontend/src/pages/editor/VersionEditPage.svelte:377` and `ItemEditPage.svelte:355`) for router/`beforeunload` coverage.

### Focus management

- Panel opens with the form mounted: focus first field (the result `<select>`), NOT the Close button. Set `<FocusTrap autofocusSelector='select[name="evaluation-result"], [data-side-panel-close]'>` — the comma-separated selector falls back to the Close button when the form is not rendered (canWrite=false, auto-accept banner, or progress kind). This selector lives on the single existing `<FocusTrap>` at `DashboardSidePanel.svelte:78` and therefore applies to BOTH the `submission` and `progress` branches; the fallback selector matches the existing Close button so the progress branch's focus behavior is unchanged.
- [Edit evaluation] click: focus result `<select>` after the form mounts (use `tick()` + `el.focus()`).
- After save → read-only transition: focus the [Edit evaluation] button (a real `<button>`, so just `.focus()`).
- After Cancel (in edit mode): focus [Edit evaluation].

## 7. `lib/evaluations.ts` (NEW)

Types are defined HERE (NOT in `lib/dashboards.ts`). Mirror backend `EvaluationResponse` from `backend/mathion/schemas.py`.

```ts
import { api, ApiError } from './api';
import { emitUnauthorized } from './events';

// MAX_FEEDBACK_FILE_SIZE_BYTES mirrors backend MATHION_MAX_FILE_SIZE (default 20 MB,
// backend/mathion/config.py:9). Backend value is env-overridable; a deploy bumping the
// backend constant must hand-update this. Accepted drift for slice; a /api/config/limits
// endpoint is the principled fix (Phase 9). Pattern matches lib/runAssets.ts:5-9.
export const MAX_FEEDBACK_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export type EvaluationResult = 'rejected' | 'major_revision' | 'minor_revision' | 'accepted';

export interface Evaluation {
  id: number;
  submission_id: number;
  result: EvaluationResult;
  score: number | null;
  feedback_text: string | null;
  has_feedback_file: boolean;
  evaluated_at: string;     // ISO
  evaluated_by: number;     // user id — backend returns int per EvaluationResponse
}

export interface EvaluationCreateInput {
  submission_id: number;
  result: EvaluationResult;
  score?: number | null;
  feedback_text?: string | null;
  feedback_file?: File | null;
}

export interface EvaluationUpdateInput {
  result?: EvaluationResult;
  score?: number | null;
  feedback_text?: string | null;
}

// Multipart POST. Mirrors lib/runAssets.ts:28-58 (the FormData + credentials +
// X-Requested-With + AbortError-passthrough + 401 emitUnauthorized pattern), with
// error strings aligned ("Connection error" / "Not authenticated" / "Upload failed")
// for consistency with the rest of the codebase.
export async function createEvaluation(
  input: EvaluationCreateInput,
  opts?: { signal?: AbortSignal },
): Promise<Evaluation> {
  const fd = new FormData();
  fd.append('result', input.result);
  if (input.score != null) fd.append('score', String(input.score));
  if (input.feedback_text != null) fd.append('feedback_text', input.feedback_text);
  if (input.feedback_file) fd.append('file', input.feedback_file);

  let r: Response;
  try {
    r = await fetch(`/api/submissions/${input.submission_id}/evaluation`, {
      method: 'POST',
      body: fd,
      credentials: 'include',
      headers: { 'X-Requested-With': 'mathion' },
      signal: opts?.signal,
    });
  } catch (e: unknown) {
    // jsdom DOMException doesn't extend Error reliably — duck-type the AbortError.
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new ApiError(0, 'Connection error');
  }
  if (r.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new ApiError(r.status, body?.detail ?? 'Upload failed', body?.error_code);
  }
  return r.json();
}

// JSON PATCH. Reuses api.patch for credentials, X-Requested-With, ApiError, 401 handling.
export async function patchEvaluation(
  eid: number,
  input: EvaluationUpdateInput,
  opts?: { signal?: AbortSignal },
): Promise<Evaluation> {
  return api.patch<Evaluation>(`/api/evaluations/${eid}`, input, { signal: opts?.signal });
}
```

The `Evaluation` type returned here is intentionally distinct from `dashboards.ts`'s anonymous `latest_evaluation` shape — they serve different purposes and don't need to share a definition. The local `state.latestEvaluation` after a successful save uses the rich `Evaluation` type; the dashboard payload's anonymous shape continues to drive the cell rendering until the refetch resolves.

## 8. Auto-accept invariant (read-only banner)

When `latest_submission.is_resubmission === true`, the panel shows:

```html
<div role="status" class="banner-info">
  Auto-accepted on resubmission. No manual evaluation needed.
</div>
```

**CSS:** `.banner-info` does NOT exist in `DashboardSidePanel.svelte` today (only `.banner-error` does). Add a new `.banner-info` rule in the panel's `<style>` block — same box/padding as `.banner-error` but using the info-teal color tokens from `Toast.svelte:26-29` (info variant). One-block addition.

No form, no [Edit] button, no Download-feedback-file link (auto-accepted evals have `feedback_file=null` by construction). The Submission block + Download-submission link remain visible. When `latest_evaluation` is present (the auto-accept wrote one), the read-only evaluation block is ALSO rendered below the banner so the viewer can see what was auto-accepted.

Backend already rejects manual eval on auto-accepts with 409; the banner is defense-in-depth UX. The form is NOT rendered (DOM-absent) — verify in tests T19a (no eval) and T19b (with eval).

## 9. Accessibility

- Form `<form aria-label="Write evaluation">`.
- Every field has `<label for=...>` (visible, never hidden); required-ness conveyed via `aria-required="true"` AND visible asterisk + the helper text "(required)".
- Validation errors via `aria-describedby` pointing at the inline error `<span role="alert">` AND the helper-text element.
- Save: native `disabled={!valid || submitting}` (SR-announced as disabled, unclickable); `aria-busy="true"` during submit.
- Result-lock visible helper text (NOT `title` attr — `title` is invisible on touch + inconsistently exposed to SR).
- File-input "Replace not supported" hint as visible helper text (NOT `title`).
- Char counter `aria-live="polite"`, announces only on threshold cross.
- **Toaster `aria-live` gap:** `Toaster.svelte` does NOT have `aria-live` on the container today. Each toast renders `role="status"` AFTER mount; SR may not announce. **Fix in scope:** add `aria-live="polite"` to the Toaster container. One-line change; verified in `Toaster.svelte`.

## 10. Tests

### `frontend/src/tests/evaluations.test.ts` (NEW, 8 tests)

- **WT1**: `createEvaluation` builds FormData with all fields. Asserts field NAMES (`result`, `score`, `feedback_text`, `file`) and values; asserts URL `POST /api/submissions/{sid}/evaluation`; asserts `credentials: 'include'` and `X-Requested-With: 'mathion'`.
- **WT2**: `createEvaluation` omits null/undefined fields (score=null + feedback_text=null + no file → FormData has only `result`).
- **WT3**: `createEvaluation` propagates `AbortSignal`. Asserts the rejection is the AbortError (re-thrown by the duck-typed `e?.name === 'AbortError'` branch), NOT an `ApiError(0, ...)` network fallback.
- **WT4a**: `createEvaluation` throws `ApiError` on 4xx with JSON detail (asserts `err instanceof ApiError`, `err.status === 422`, `err.detail === 'X'`).
- **WT4b**: `createEvaluation` throws `ApiError` on 5xx with non-JSON body (HTML error page). Mock `Response` body that fails to parse as JSON; asserts `err.status === 500` AND `err.detail === 'Upload failed'` (the fallback string, NOT statusText).
- **WT5**: `patchEvaluation` uses `api.patch` (Content-Type `application/json`, body is JSON, NO `file` key); URL `PATCH /api/evaluations/{eid}`.
- **WT6**: `patchEvaluation` propagates 4xx via the existing `ApiError` thrown by `api.patch`.
- **WT7**: `createEvaluation` on 401 calls `emitUnauthorized(<return-path>)` (return-path = `location.pathname + location.search + location.hash`) AND throws `ApiError(401, 'Not authenticated')`. Spy on `emitUnauthorized` from `./events` (NOT `stores/session.svelte`); mirror `runAssets.test.ts:90-101`.

### `frontend/src/tests/DashboardSidePanel.svelte.test.ts` (extend, +19 tests; new total 33)

Existing tests T1–T14 remain. New:

- **T15**: panel shows form when `canWrite && kind === 'submission' && no eval && !is_resubmission`. Assert the result `<select>` is the first focused element after mount (NOT the Close button).
- **T16**: panel shows read-only existing-eval block + [Edit evaluation] button when `canWrite && eval exists`.
- **T17**: clicking [Edit evaluation] expands form pre-filled with existing values. Includes pre-fill edge cases: `score=null` → empty number input (NOT "null"); `feedback_text=null` → empty textarea.
- **T18**: panel shows read-only (no form) when `canWrite === false`. Assert `host.querySelector('form[aria-label="Write evaluation"]') === null` (DOM-absent, not CSS-hidden).
- **T19**: panel shows auto-accept banner when `is_resubmission === true`. Form is DOM-absent (assert). Split into T19a (fixture: `latest_evaluation === null` → banner only, NO eval block) and T19b (fixture: `latest_evaluation` present → banner + read-only eval block + NO form / NO [Edit] regardless of canWrite). T19b's eval-block assertions mirror existing T6 (result badge, score, feedback_text). (Counted as 1 test ID in the +19 total since the existing T19 wording is being refined, not added; T19b adds ~30 lines.)
- **T20**: form validates result + feedback_text + feedback_file required for non-accepted. **Asserts `fetch` is NOT called** when validation fails. Asserts clearing an error re-enables Save. Covers score edge cases: -1, 101, 10.5, "abc", "" (allowed), AND `0` (falsy-but-valid edge case — must NOT be treated as empty).
- **T21**: Save POST happy path. Asserts FormData CONTENTS — `fd.get('result')`, `fd.get('score')`, `fd.get('feedback_text')`, `fd.get('file')` all present with expected types; asserts URL; asserts `X-Requested-With` and `credentials: 'include'`; asserts Save disabled + `aria-busy="true"` during submit.
- **T22**: Save PATCH happy path on edit. Asserts JSON Content-Type, body has `{result, score, feedback_text}` and NO `file` key; asserts URL `/api/evaluations/{eid}`.
- **T23**: Toast pushed via `pushToast` on success — asserts BOTH message string `"Evaluation saved; group notified"` AND kind `"success"`.
- **T24**: Error banner shown when backend returns 4xx; Save button re-enabled; **form field values preserved**; banner has `role="alert"`.
- **T25**: PATCH locked-to-accepted invariant (component-level). When editing an eval with `has_feedback_file === false`, the three non-accepted `<option>` are `disabled`; the verbatim helper text `"Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead."` is rendered below the select. Selecting a disabled option (via direct DOM mutation in test) and Saving does NOT call fetch.
- **T26**: Grid refresh callback invoked on 2xx save. Asserts the `onRefetch` prop is called exactly once after a successful POST and exactly once after a successful PATCH.
- **T27**: File client-side validation. Non-PDF extension → inline error + no fetch. Empty file → inline error. >20 MB file → inline error. MIME edge cases: `file.type === 'application/msword'` → inline error; `file.type === ''` AND extension is `.pdf` → ACCEPTED (browser quirk); `file.type === 'application/pdf'` → accepted.
- **T28**: Dirty-guard. Covers BOTH create-mode and edit-mode. In create-mode: typing into feedback_text then triggering Escape / backdrop click / `× Close` opens `InlineConfirm`; clean create (no typing) closes without prompt. In edit-mode: typing + Escape / backdrop / × / Cancel opens `InlineConfirm`; clean edit + Cancel closes without prompt. On confirm-no the form stays. Saving (Save button click) does NOT trigger the guard. During submit (`submitting=true`), Escape / backdrop / × are no-ops (no InlineConfirm appears) and the only abort is the Cancel button.
- **T29**: Submit timeout. Stub `fetch` to never resolve; set the timeout shorter than 60s for the test (panel reads from a constant — expose a test seam). On timeout: error banner renders "Upload timed out. Try again."; Save button re-enabled; form field values preserved.
- **T30**: Focus transitions. (a) On mount with form, the result `<select>` receives focus (not the Close button). (b) After successful Save, focus moves to the [Edit evaluation] button. (c) After Cancel-in-edit, focus moves to [Edit evaluation]. (d) On [Edit evaluation] click, focus moves to the result `<select>` after `tick()`.
- **T31**: 409 conflict race. POST returns 409 → form calls `onRefetch()` once AND transitions panel to read-only mode showing the winning eval (passed back via the refetched `target.entry.latest_evaluation`). Form is no longer in DOM.
- **T32**: Char-counter threshold a11y behavior. (a) Typing chars 1→899 does NOT mutate the counter's `aria-live` region content (no announce). (b) Crossing 900 chars renders the bold visible marker with the word "approaching"; the `aria-live` region content updates. (c) Crossing 1000 (the HTML maxlength prevents typing more) leaves the marker rendered with the final count. Asserts both the visible non-color signal AND the announcement gating.
- **T33**: Post-CREATE → edit PATCH handoff via `state.latestEvaluation`. Sequence: mount form (no eval) → fill + Save → POST resolves with `{ id: 42, ... }` → form switches to read-only. WITHOUT waiting for `onRefetch` to resolve (mock it to never resolve), click [Edit evaluation] → form pre-fills from `state.latestEvaluation` → change score → Save → PATCH is called with URL `/api/evaluations/42` (the new eval's id). Asserts the local-state handoff works before the parent's refetch round-trip completes.

### Test pattern

Use `mount`/`unmount`/`flushSync` from `svelte` (per `feedback_svelte_test_pattern`). Mock `fetch` with real `Response` objects so `r.json()` parses correctly. Mock `pushToast` by stubbing the `stores/toasts.svelte` module export.

## 11. Files touched (summary)

**New:**
- `frontend/src/lib/evaluations.ts` (~140 lines)
- `frontend/src/tests/evaluations.test.ts` (~190 lines, 8 tests)

**Modified:**
- `frontend/src/components/runs/DashboardSidePanel.svelte` (~+250 lines)
- `frontend/src/pages/runs/RunDetailPage.svelte` (~+10 lines — derive `isAdmin` + `isThisRunTeacher`, pass to tabs)
- `frontend/src/components/runs/RunSubmissionTab.svelte` (~+5 lines — accept + forward two props, expose `refresh` as `onRefetch` prop)
- `frontend/src/components/runs/RunProgressTab.svelte` (~+5 lines — accept + forward two props for type-uniformity)
- `frontend/src/components/chrome/Toaster.svelte` (one-line `aria-live="polite"`)
- `frontend/src/tests/DashboardSidePanel.svelte.test.ts` (~+560 lines, +19 tests)
- `frontend/src/tests/RunSubmissionTab.svelte.test.ts` (existing — extend with 1 test for the new `selectedIds`-derived `panelTarget` rebind: open panel, mock refresh, verify `panelTarget.entry` updates with new `data`)
- `frontend/src/tests/RunDetailPage.svelte.test.ts` (existing OR new — 1 test for the `isThisRunTeacher` derivation per §12 T2)

## 12. Plan task breakdown (preview)

- **T1**: `lib/evaluations.ts` wire module + types + size constant + tests (TDD; 8 wire tests including WT7 401).
- **T2**: Permission plumbing — `RunDetailPage` derives `isAdmin` + `isThisRunTeacher`; thread through `RunSubmissionTab` + `RunProgressTab` to `DashboardSidePanel` props. Apply the **panel target rebind in `RunSubmissionTab` ONLY** (NOT `RunProgressTab` — its target shape is different and it has no write surface): replace `panelTarget = { mp, entry }` snapshot with `selectedIds = { mpId, groupId }` + `$derived` lookup against current `data`. Add: (a) focused unit test in `RunDetailPage.svelte.test.ts` for the `isThisRunTeacher` derivation (truthy when `teachers` contains `session.user.id`, false when null/empty/missing). (b) Unit test in `RunSubmissionTab.svelte.test.ts` for the rebind: open panel with selectedIds → simulate `refresh()` returning new `data` with the entry's `latest_evaluation` updated → assert `panelTarget.entry.latest_evaluation` reflects the new value. No DashboardSidePanel UI change yet.
- **T3**: `DashboardSidePanel.svelte` — add the `submission`-branch form scaffold + canWrite derivation + auto-accept banner (+ `.banner-info` CSS). Tests T15, T18, T19.
- **T4**: Form fields + client-side validation (no submit yet). Tests T20, T27.
- **T5**: Save POST/PATCH flow + ApiError handling + abort/timeout + toast + grid refresh callback + 409 race + post-CREATE local `state.latestEvaluation` handoff to subsequent PATCH. Tests T21, T22, T23, T24, T26, T29, T31, T33.
- **T6**: Edit-existing-eval (pre-fill + result-lock invariant). Tests T16, T17, T25.
- **T7**: Dirty-guard + focus management + Toaster `aria-live` one-liner + char-counter threshold a11y. Tests T28, T30, T32; manual a11y pass.
- **T8**: Manual smoke walkthrough + final cleanup.

Plan to follow at `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`.

## 13. Manual smoke walkthrough (last plan task)

Seed: re-run `./run-dashboards-smoke.sh` (the existing teacher-dashboards smoke fixture has 12 submissions across 5 statuses including 1 auto-accept on MP5/B sub#2).

1. Login as `admin@mathion.test`. Navigate to Spring 2026 run → Submission tab.
2. Click MP2/A (`awaiting_eval`) → panel opens with form; focus on result `<select>`. Fill `result=accepted`, `score=85`, leave feedback blank, leave file blank → Save.
3. Toast appears: "Evaluation saved; group notified". Cell flips to accepted. Panel shows read-only eval block + [Edit evaluation]; focus moves to [Edit].
4. Click [Edit evaluation] → form pre-fills (score=85). Change score to 90 → Save → toast.
5. Click MP3/A (`needs_revision` — has feedback_file). Panel shows read-only eval + [Edit]. Click [Edit] → form pre-fills (result=major_revision, score, text, file placeholder "Existing feedback file uploaded — replace not supported"). All four non-result options enabled (because `has_feedback_file === true`).
6. Change result to `accepted` → Save → toast. (Backend allows because the existing file persists.)
7. Click MP2/C (`awaiting_eval`). Try Save with `result=major_revision`, NO text, NO file → two inline errors: "Feedback is required when the result is not Accepted." + "PDF file required for non-accepted results." Verify `fetch` was NOT called (network tab). Add a non-PDF (use an attempted `.txt`) → inline error "Only PDF files accepted." Add a 50 MB binary → inline error "File exceeds 20 MB limit." Add valid 1-page feedback text + a valid PDF → Save → toast.
8. Click MP5/B (`accepted` — auto-accept on sub#2). Panel shows auto-accept banner (info variant), NO form, NO [Edit] button. Verify the form is DOM-absent (inspect element).
9. Logout, login as `teacher@mathion.test`. Re-verify steps 2 and 4 work (run-teacher has the same write affordance as admin).
10. **Result-lock invariant smoke.** Find a fixture row where the eval was created `accepted` with NO feedback_file (use admin: open MP4/A awaiting_eval, Save `result=accepted` + no file → resulting eval has `has_feedback_file=false`). Now click [Edit] → verify the three non-accepted options are `disabled` in the `<select>` and the helper text "Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead." renders below.
11. **Dirty-guard smoke.** Open any awaiting_eval cell → type into feedback text → press Escape → verify InlineConfirm appears ("Discard changes?"). Click No → form stays. Repeat → click Yes → form closes.
12. **Toast SR smoke** (if you have VoiceOver enabled): trigger a Save → toast announcement is heard.

## 14. Open questions / out of scope

- **DELETE evaluation**: Phase 9.
- **Feedback file REPLACE**: blocked by Phase 9 TODO (`evaluations.py:92-94`). Spec UI shows the "Replace not supported" hint when editing an eval with feedback_file.
- **Notification UX** (read receipts, dismissal): separate notifications slice.
- **Cross-run evaluation queue**: skipped per design discussion 2026-06-04 (Submission tab's `awaiting_eval` sort is the queue).
- **MarkdownEditor for feedback_text**: deferred per design discussion 2026-06-04.
- **`/api/config/limits` endpoint**: principled fix for the hardcoded `MAX_FEEDBACK_FILE_SIZE_BYTES` — Phase 9.
- **Mobile / narrow viewport**: panel is `width: min(640px, 90vw)`. Spec assumes desktop primary. Mobile polish (full-width below 480 px breakpoint, keyboard-aware bottom padding) deferred to Phase 9 unless a teacher reports a need.
- **Add `is_teacher` to dashboard payload**: cleaner per-run signal than threading `teachers` list — Phase 9 if the prop-drilling proves painful.
- **Toaster container `aria-live`**: in scope for T7 as a one-liner (see §9). If pushback emerges from another slice's tests, can be split out.

---

End of spec rev 4.2.
