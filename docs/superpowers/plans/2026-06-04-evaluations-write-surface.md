# Evaluations Write Surface — Implementation Plan (rev 4.6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a teacher/admin evaluation-writing form inside the existing `DashboardSidePanel` so the Submission tab closes the evaluation loop (download submission PDF → annotate externally → upload feedback PDF + write short feedback → Save → group notified).

**Architecture:** Pure frontend slice on existing Phase 7b backend endpoints. New wire module `lib/evaluations.ts` (multipart POST mirror of `lib/runAssets.ts`, JSON PATCH via `api.patch`). Panel extends its `submission` branch with an interactive form gated on a per-run `canWrite` derivation threaded from `RunDetailPage` through `RunSubmissionTab` and `RunProgressTab`. `RunSubmissionTab` adopts a `selectedIds`-derived `panelTarget` so refetch flows through the open panel; `RunProgressTab`'s target architecture is unchanged.

**Tech Stack:** Svelte 5 (runes) + TypeScript + Vite + Vitest. Tests use `mount`/`unmount`/`flushSync` from `svelte` (NOT `@testing-library/svelte`). Reuse `ApiError` + `api.patch` from `lib/api.ts`; reuse `pushToast` from `stores/toasts.svelte`; reuse `emitUnauthorized` from `lib/events.ts`; reuse `DirtyGuard`, `InlineConfirm`, `FocusTrap`.

**Spec:** `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md` (rev 4.2). Read §3–§10 before starting T1.

---

## Rev 4.5 → Rev 4.6 patches (T4 implementer-discovered onsubmit literal text gap)

T4 implementer caught that Step 4.3's literal `onsubmit` handler text — `(e) => { e.preventDefault(); /* handleSave wired in T5 */ }` — omitted the mutation that flips `formSubmitAttempted = true`. The `formSubmitAttempted` state IS declared in Step 4.3 with the comment "Set true on first submit attempt; controls whether `errors.result` surfaces the 'Result is required.' inline error vs. just relying on native `disabled`." The derivation `errors.result` only fires when `formSubmitAttempted && formResult === ''`, so without the mutation, T20's `expect(host.textContent).toContain('Result is required.')` after `form.dispatchEvent(new Event('submit'))` would FAIL.

The implementer applied the minimal correct fix in commit `edbaf03`: added `formSubmitAttempted = true;` to BOTH `<form>` onsubmit handlers (Branch B editing AND Branch C new — both have identical form contents). The fix matches the variable's declared purpose. T20 + 22 other panel tests pass; full suite 847/847.

Plan rev 4.6 patches the literal text in Step 4.3 to match the shipped code (and avoid the next plan-reading implementer hitting the same gap). No spec change needed — spec §6 describes the behavior; this is a plan-literal-text fix only.

---

## Rev 4.4 → Rev 4.5 patches (T3 implementer-discovered FocusTrap defect)

T3 implementer discovered that the spec-mandated FocusTrap autofocusSelector at spec §9 line 254 — `'select[name="evaluation-result"], [data-side-panel-close]'` — does NOT behave as the spec describes ("falls back to Close button when no form is rendered"). Root cause: `FocusTrap.svelte:41` uses `containerEl.querySelector(autofocusSelector)`, which for comma-separated selectors returns the first match in DOM order — NOT priority order. Since the Close button is in the panel header (before the form in DOM), the comma selector always returns Close first, breaking T15's intent.

The implementer's pragmatic fix in commit `c0dc26e` dropped the fallback (`autofocusSelector='select[name="evaluation-result"]'`), which makes T15 pass but breaks spec §9 line 254 progress-branch focus behavior (no fallback to Close when no form exists).

Rev 4.5 adopts the correct architectural fix: extend `FocusTrap.svelte` to support a new opt-in `autofocusPriorityOrder?: boolean = false` prop. When true, the autofocusSelector is split by `,` and each sub-selector is tried in declaration order via querySelector — returning the FIRST matching element. When false (default), preserves existing single-querySelector behavior — backwards-compatible for `NewRunModal`, `RosterImportModal`, `MiniProjectModal` which use the default or single-selector forms.

Plan changes:
1. Add `frontend/src/components/ui/FocusTrap.svelte` to T3 Files list and 2.D3/3.C9 commit step (as a T3 deliverable — declaration-only widening of FocusTrap's prop surface + new priority-order branch).
2. Update Step 3.C3 to use `autofocusPriorityOrder` flag: `<FocusTrap autofocusSelector='select[name="evaluation-result"], [data-side-panel-close]' autofocusPriorityOrder>`.
3. Add a new Step 3.C0 (BEFORE 3.C1) titled "Extend FocusTrap with priority-order autofocus" that modifies FocusTrap.svelte to accept the new prop and split the selector when the prop is true.

Implementer's commit `c0dc26e` will be partially reverted: the DashboardSidePanel autofocusSelector goes back to the spec-aligned form with the new flag. FocusTrap.svelte gains the priority-order branch. A new commit applies both.

---

## Rev 4.3 → Rev 4.4 patches (T2 implementer-discovered plan gaps)

T2 implementer caught two gaps during execution:

1. **`DashboardSidePanel.svelte` omitted from T2 Files list + commit step.** Plan Step 2.C-pre.1 modifies `DashboardSidePanel.svelte` (widens `$props()` with optional `isAdmin`/`isTeacher`/`onRefetch`), but the T2 Files block (line 539-543) and commit step 2.D3 (line 934-938) both omitted it. Result: the props-widening change is required for T2.C3's panel mount to typecheck under strict TS, but would sit uncommitted after T2. Rev 4.4 adds `DashboardSidePanel.svelte` to both. T3 still modifies the same file further (the canWrite/editing/etc. landing in T3.C1).
2. **TD1/TD1-neg mock pattern matches both list and dashboard mini-projects endpoints.** Plan Step 2.A1 mock clause `if (url.includes('/mini-projects')) return jres([])` returns `[]` for BOTH `/api/runs/{n}/mini-projects` (list, expects array) AND `/api/runs/{n}/dashboard/mini-projects` (expects `{ run, mini_projects }` shape per `lib/dashboards.ts:123-161`). When RunSubmissionTab fetches the dashboard endpoint and gets `[]`, Svelte reactivity throws post-unmount uncaught warnings (assertions still pass, but the console output is noisy). Rev 4.4 inserts an explicit `/dashboard/mini-projects` clause BEFORE the generic `/mini-projects` clause in both TD1 and TD1-neg mocks: `if (url.includes('/dashboard/mini-projects')) return jres({ run: { id: 10, title: 'R', groups_enabled: true }, mini_projects: [] });`. Order matters — must come before the generic clause.

---

## Rev 4.2 → Rev 4.3 patches (T1 code-quality reviewer findings)

After T1 commit `8d54e31` shipped the rev 4.2 code shape, the code-quality reviewer flagged that `lib/evaluations.ts` diverged from the canonical wire-module pattern in `lib/runAssets.ts` on three minor-but-real points. Plan reviewers had reviewed the plan in isolation, not against `runAssets.ts`, so they missed it. Rev 4.3 aligns Step 1.3 to the canonical pattern; tests at Step 1.1 are unchanged (all assertions still hold).

1. **AbortError guard — match canonical form.** Rev 4.2 used `if ((e as { name?: string })?.name === 'AbortError')`. Canonical at `frontend/src/lib/runAssets.ts:46` uses `if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError')` with a comment explaining the jsdom DOMException motivation. Both behave identically at runtime (optional chain short-circuits on null/undefined), but the canonical form is stronger and is what the codebase uses for every other wire module.
2. **Non-ok body fallback — match canonical form.** Rev 4.2 used `const body = await r.json().catch(() => ({})); throw new ApiError(r.status, body?.detail ?? 'Upload failed', body?.error_code);`. Canonical at `frontend/src/lib/runAssets.ts:54-55` is `const payload = await r.json().catch(() => ({ detail: 'Upload failed' })); throw new ApiError(r.status, payload.detail ?? 'Upload failed', payload.error_code);`. The canonical form bakes the fallback into `.catch()`, eliminating the redundant `?.` since `payload` is guaranteed non-null.
3. **Network-error string + missing WHY comments.** Rev 4.2 used `'Connection error'`. Canonical at `frontend/src/lib/runAssets.ts:47` uses `'Could not reach server. Check your connection.'` (better UX). Rev 4.2 also lacked the wire-layer summary comment block (cf. `runAssets.ts:23-27`) and the sync-warning comment on `MAX_FEEDBACK_FILE_SIZE_BYTES` (cf. `runAssets.ts:5-9`). Rev 4.3 adds both.

No test changes needed: WT3 still asserts AbortError re-throw (canonical guard re-throws the same instance); WT4a/WT4b still assert `detail: 'feedback_file required…'` and `detail: 'Upload failed'` respectively (canonical .catch fallback produces the same result); no test asserted the network-error string, so changing it is invisible to the suite. WC1 unchanged.

---

## Rev 4.1 → Rev 4.2 patches (codex r4.1 findings)

Codex r4.1 verdict: NEEDS-FIX with 2 NEW findings 5 internal reviewers missed:

1. **TT1 tests wrong component.** Plan rev 4.1 appended TT1 to `RunDetailPage.svelte.test.ts` mounting `RunDetailPage`, then queried `target.querySelector('.toaster')`. But `Toaster` is rendered by `App.svelte:72` (imported at `:6`), NOT by `RunDetailPage`. The test would FAIL because `.toaster` doesn't appear in the RunDetailPage mount. Fix: relocate TT1 to a new dedicated `frontend/src/tests/Toaster.svelte.test.ts` that mounts `Toaster.svelte` directly and asserts the root `<div class="toaster">` has `aria-live="polite"`. This is hermetic and component-focused.

2. **`formScore` type/binding gap.** Plan declared `formScore = $state<number | null>(null);` at T4.3. `<input type="number" bind:value={formScore}>` in Svelte 5 can return `null` when empty (intended), but the validation derivation explicitly guards `formScore !== null && formScore !== undefined && !Number.isNaN(formScore)` — including `undefined` in the guard implies the author expected `undefined` is reachable. Strict TS (`frontend/tsconfig.json:12`) may flag the type widening. Fix: declare as `number | null` AND add a normalizer in the `<input>` `oninput` (or onchange) that coerces `''` → `null` so the state stays consistently typed. Drop the `formScore !== undefined` clause from the validation derivation (unnecessary if type is enforced).

---

## Rev 4 → Rev 4.1 patches

Rev 4 review came back PASS from 2 reviewers (frontend-stack, integration) and NEEDS-FIX from 3 with these convergent items:

1. **`displayMessage` regression in 5d.3 + 5e.3** (backend-contract crit) — Step 5a.3 used `e.displayMessage` but Steps 5d.3 (409 branch) and 5e.3 (timeout AbortError branch) rewrote the catch and reverted to `e.detail as string`. Pydantic 422 array details would render as `'[object Object]'`. Fixed: both catches now use `e.displayMessage`.
2. **T28b/c/d focus assertion missing** (UX/a11y crit) — Tests only asserted `.inline-confirm` is truthy; the changelog promised `document.activeElement === confirmBtn`. Fixed: each test now resolves `.inline-confirm button` and asserts `expect(document.activeElement).toBe(confirmBtn)`. Test names extended to "+ focus on confirm button".
3. **T32 contradiction with constant-string impl** (UX/a11y crit + test-coverage crit) — Test asserted `live.textContent.toContain('900')`; new impl emits `'Approaching limit'` (no digit). Fixed: assertion changed to `expect(live.textContent).toBe('Approaching limit')`, plus typing past 900 to 950 re-asserts same constant (no re-announce), plus dropping below 900 to 800 asserts empty string.
4. **T8.14 expected-counts tally drift** (test-coverage minor) — Rev 4 said "49 panel + 1 Toaster"; actual is ~36 panel + 1 Toaster + 5 tab + 9 wire. Fixed: T8.14 now lists the 36 new IDs explicitly over the 14 baseline panel tests.

---

## Rev 3 → Rev 4 changes

Rev 3 was NEEDS-FIX from 4 of 5 internal plan reviewers and codex (independent second opinion). Rev 4 addresses 20 convergent fixes:

**Codex-found wire-test correctness (blocked T1):**
- **WT5 + T22 header assertions**: `api.patch` routes through `request()` which wraps headers via `new Headers(callerHeaders ?? {})` (verified at `frontend/src/lib/api.ts:34`). Plan now uses `new Headers(init.headers as HeadersInit).get('Content-Type')` to read header values.
- **WT7 `window.location` redefinition**: jsdom 25 makes `location` non-configurable. Plan now uses `window.history.pushState({}, '', '/runs/42?tab=submission#focus')` before invoking the wire.

**Cross-task sequencing (blocked T2 → T3):**
- **T2 step 2.C3 prop-threading order**: rev 3 passed `{isAdmin}/{isTeacher}/{onRefetch}` to `<DashboardSidePanel>` BEFORE T3 widened `$props()`. Strict TS would fail. Rev 4 inserts **Step 2.C-pre** that widens `DashboardSidePanel.svelte` `$props()` to accept the three optional props with no behavior change; T2.C3's mount site then compiles cleanly. T3 inherits the now-widened props (T3.C1 no longer redeclares them).

**Test assertion correctness:**
- **T21 stale `aria-busy=false` assertion**: after Save success the form is unmounted, the captured `saveBtn` is detached. Rev 4 drops the post-resolution `aria-busy=false` assertion (T30 covers the focus shift to [Edit]).
- **T31 409 race under-specified**: rev 3 mock only asserts the form is removed. Rev 4 adds **T31b** with a refetch mock that DOES populate `target.entry.latest_evaluation`, asserting the read-only block with the winning eval renders.

**Form-validation + error rendering:**
- **`errors.result = 'Result is required.'`** when `formResult === '' && formSubmitAttempted`. T20 asserts the verbatim string. New state `formSubmitAttempted = $state(false)` set true on first submit; cleared on Cancel/discard.
- **`ApiError.displayMessage`** (verified at `frontend/src/lib/api.ts:14-19`) returns `"Please correct the highlighted fields."` for array (Pydantic 422) details. Rev 4 catches use `e.displayMessage`, NOT `e.detail as string`.
- **Dirty detection via prefill snapshot**: rev 3's `isDirty = formResult !== '' || formScore !== null || …` treats a clean pre-filled edit as dirty. Rev 4 captures `prefillSnapshot = $state<{result, score, feedback_text} | null>(null)` when entering edit mode; `isDirty` compares against the snapshot when present, against empty when null.

**Type contract:**
- **`Evaluation.evaluated_by`** stays `number` (matches `backend/mathion/schemas.py:636-646`). Templates never read `evalu.evaluated_by`; the "Evaluated by" line branches on `target.entry.latest_evaluation` (dashboard shape) with "You" fallback. `effectiveEvaluation` is typed `Evaluation | DashboardMpGroupEntry['latest_evaluation']`; templates only read common fields (`id, result, score, feedback_text, has_feedback_file, evaluated_at`). svelte-check passes because no template accesses a non-common field on the union.

**a11y:**
- **Char-counter aria-live** emits the CONSTANT string `'Approaching limit'` (NOT the running count) when `counterApproaching`. After crossing 900, the live region's content doesn't change → SR doesn't re-announce. T32 tightened to assert the live string equals `'Approaching limit'` at 900 AND remains identical at 950.
- **InlineConfirm focus**: rev 4 wires a panel `$effect` focusing the first button in `.inline-confirm` when `confirmDiscard` flips true. T28b/c/d assert `document.activeElement` is that button.
- **Result-lock helper in `aria-describedby`**: lock helper gets `id="evaluation-result-lock"`; result `<select>` extends `aria-describedby` to include it when `resultLocked`.

**Cascade-rewrite clarity:**
- **T5.SETUP.2 `{@const evalu = ...}` scoping**: rev 3 said "replace `{@const evalu = target.entry.latest_evaluation}`" but the token appears TWICE in T3.C4's markup. Rev 4 explicitly labels: "(a) auto-accept inner branch — KEEP using `target.entry.latest_evaluation`" and "(b) non-resubmission else-if branch — REPLACE with `effectiveEvaluation`".

**Form-mount safety:**
- **InlineConfirm + DirtyGuard hoisted to panel-level** (siblings of the cascade, NOT inside `<form>`). Eliminates form-submit-from-Discard-button risk and lets the confirm render in any cascade branch.

**Spec §10 coverage gaps:**
- **T30c** Cancel-in-edit → focus moves to `[data-test="edit-evaluation"]`.
- **T26b** onRefetch called once on PATCH success.
- **T20 score edges** — assert `scoreInput.value = '-1'` → "Score must be a whole number…".
- **T17 non-null pre-fill** — assert `select.value='major_revision'`, `scoreInput.value='60'`, `textarea.value='Needs work'`.
- **TT1** Toaster container has `aria-live="polite"` regression test (appended to RunDetailPage tests).

**Hygiene:**
- **`vi.mocked(pushToast).mockClear()` in beforeEach** — added next to `restoreAllMocks`.

---

## Rev 2 → Rev 3 changes (preserved for traceability)

Rev 2 was NEEDS-FIX from all 5 plan reviewers. Rev 3 addresses every convergent critical:

**Codebase reality (was the biggest miss):**
- **`groups`, NOT `entries`** — `DashboardMpRow.groups` per `lib/dashboards.ts:120`. Fixed throughout T2, T3, helpers.
- **`User`** has `is_superuser`, `is_disabled` — NOT `is_active` (`types.ts:5-14`).
- **`panelTarget`** at `RunSubmissionTab.svelte:27` is `{ mp, entry } | null` (NO `kind` key — `kind: 'submission'` is added at the mount site via spread, `:281`). `panelOpen` is separate at `:26`.
- **`emitUnauthorized(path: string)`** has REQUIRED arg per `events.ts:20`.
- **`pushToast(message, kind = 'info')`** — kind defaults to `'info'`.
- **`ApiError(status, detail, errorCode?)`** — third arg is camelCase `errorCode` property (constructor reads `body.error_code` for the wire branch).
- **Existing test-file helpers** are used VERBATIM (no rename). Helpers actually present:
  - `DashboardSidePanel.svelte.test.ts`: `mockFetch(status, body)`, `mountPanel({ target, onClose? })`, `settle()`, `makeProgressTarget(overrides)`, `makeItemsResponse(items)`, `makeMp(overrides)`, `makeEntry(overrides)`.
  - `RunSubmissionTab.svelte.test.ts`: `mockFetch(status, body)`, `mountTab(runId=1)`, `settle()`, `submissionMock(overrides)`.
  - `RunDetailPage.svelte.test.ts`: `fetchSpy`, `jres(body, status=200)`, `courseFixture`, `runFixture(overrides)`, `versionFixture(overrides)`, `mockHappyPath()`, `mockCascade(opts)`, `settle()`.
- **`InlineConfirm` props** are `confirmLabel`, `confirmDataAction`, `warning`, `onConfirm`, `onCancel`. Root class is `inline-confirm`. No `data-test`, no `$$restProps`. Tests select by `.inline-confirm`.
- **`DirtyGuard`** uses `window.confirm` for navigation/unload (NOT InlineConfirm) — the in-panel confirm IS via InlineConfirm; both coexist.
- **`Toaster.svelte`** root element is `<div class="toaster">` — needs `aria-live="polite"` added.
- **`RunDetailPage.svelte`** already imports `pushToast` (`:9`); does NOT import `session` (must be added in T2). `teachers` declared at line 41. Tabs mounted at `:448` (Progress) and `:450` (Submission), currently with `runId` only. `course.is_admin` available.
- **`FocusTrap`** default `autofocusSelector = 'input, select, textarea, button'`.

**Placeholders eliminated:**
- All 8 deferred test bodies (T16, T17, T20, T21, T22, T23, T24, T25, T26, T27, T28, T29, T30, T31, T32, T33) are now INLINED with literal code.
- No `<!-- TBD -->`, no `(see spec §X)`, no `(from rev 1)` references.
- "INLINE the existing read-only Evaluation block markup" is replaced with the literal markup verbatim from `DashboardSidePanel.svelte:147-160`.

**TDD discipline:**
- Step 5e (timeout) does NOT silently swallow user-cancel — the catch branch wires only the timeout case in 5e; the user-cancel silent-return is added in 5g.3 so 5g's failing test actually fails first.
- Step 5.SETUP only declares state vars + the `handleSave` function as a stub; each sub-task's failing test drives a specific branch into the catch.

**Cross-task consistency:**
- `editing`: declared ONCE in T3 step 3.C1; not redeclared.
- `handleCancel`: minimal version in T5 SETUP (submit-time abort only); EXPLICITLY REPLACED with full dirty-guard version in T7 step 7.3 with REMOVE/ADD instructions.
- `existingHasFeedbackFile`: declared as `let ... = $state(false)` stub in T4 step 4.3; EXPLICIT REMOVE + REPLACE with `$derived` in T6 step 6.3.
- `resultLocked`: declared in T6 ONLY (no T5 stub needed; the T5 handleSave doesn't reference it).
- All step references corrected (no `Step 3.6` typo — uses `Step 3.C2`).
- `Step 3.C4` cascade does NOT leave `<!-- Form mounts here -->` stubs; the form-render conditional IS the source of truth — only one location renders the form per branch.

**Spec coverage:**
- **Char-counter aria-live** correctly split: visible `<span>` counter (no aria-live) shows count on every keystroke; hidden `<span class="sr-only" aria-live="polite">` ONLY emits content text when crossing 900.
- Score=0 explicit assertion added to T20.
- Tab test count: 5 new tab tests (TD1, TD1-neg, TS1, TS2, TS3).

**New tests** (for spec branches not in rev 1):
- T34 canWrite=false + eval (read-only, no Edit).
- T35 "Awaiting evaluation" placeholder.
- T36 user-cancel silent revert.
- T37 Cancel hidden in clean-create.
- T38 file picker hidden in edit mode.
- T39 "Replace not supported" placeholder.
- T40 visible "(required)" + aria-describedby.

---

## File Structure

**New files:**
- `frontend/src/lib/evaluations.ts` (~140 lines)
- `frontend/src/tests/evaluations.test.ts` (~250 lines, 9 tests)
- `frontend/src/tests/Toaster.svelte.test.ts` (~25 lines, 1 test — TT1; Toaster lives in `App.svelte:72` so test mounts the component directly rather than via RunDetailPage)

**Modified files:**
- `frontend/src/components/runs/DashboardSidePanel.svelte` (~+280 lines)
- `frontend/src/pages/runs/RunDetailPage.svelte` (~+8 lines, -2 lines)
- `frontend/src/components/runs/RunSubmissionTab.svelte` (~+25 lines, -3 lines)
- `frontend/src/components/runs/RunProgressTab.svelte` (~+5 lines)
- `frontend/src/components/chrome/Toaster.svelte` (one-line `aria-live="polite"`)
- `frontend/src/tests/DashboardSidePanel.svelte.test.ts` (~+1100 lines, +27 tests; 14 → 41)
- `frontend/src/tests/RunSubmissionTab.svelte.test.ts` (~+200 lines, +3 tests)
- `frontend/src/tests/RunDetailPage.svelte.test.ts` (~+90 lines, +2 tests)

**Branch:** `evaluations-write-surface` (already created from `main`).

---

## Test ID Master List

For traceability. Each ID appears exactly once below.

**Wire (T1) — 9 tests:** WT1 FormData fields, WT2 omits nulls, WT3 AbortSignal, WT4a JSON 4xx, WT4b non-JSON 5xx, WT5 PATCH body, WT6 PATCH 4xx, WT7 401+emitUnauthorized, WC1 size constant.

**Tab tests (T2) — 5 tests:**
- `RunDetailPage`: **TD1** isThisRunTeacher derivation true-case + **TD1-neg** false-case.
- `RunSubmissionTab`: **TS1** selectedIds-derived rebind on refresh, **TS2** row-gone auto-close, **TS3** runId change resets selectedIds.

**Component (T3–T7) — 34 tests (rev 4 adds T17 non-null pre-fill assertions, T20 score=-1 + "Result is required." verbatim, T26b PATCH refetch, T30c Cancel-in-edit focus, T31b 409+populated refetch, TT1 Toaster aria-live):**
T15 form mount + focus | T16 read-only + Edit | T17 Edit pre-fill (null + non-null) | T18 canWrite=false hides form | T19a auto-accept no-eval | T19b auto-accept with-eval | T20 validation blocks fetch (incl. score=0, score=-1, "Result is required." verbatim) | T21 POST happy + aria-busy DURING submit (no post-resolution assertion) | T22 PATCH happy + Headers.get + no file key | T23 toast message + kind | T24 error banner + preserve + role=alert (uses displayMessage) | T25 result-lock disabled options + verbatim text + aria-describedby | T26 onRefetch on POST | T26b onRefetch on PATCH | T27 file extension/empty/size/MIME | T28 + T28b/c/d/e dirty-guard (with confirm-button focus assertion) | T29 timeout banner | T30 + T30b + T30c focus | T31 409 race form removed | T31b 409 race refetch populates → read-only with winning eval | T32 char counter threshold a11y (constant string, no re-announce after 901) | T33 POST→PATCH handoff | T34 canWrite=false + eval | T35 "Awaiting evaluation" placeholder | T36 user-cancel silent revert | T37 Cancel hidden in clean-create | T38 file picker hidden in edit | T39 "Replace not supported" placeholder | T40 visible "(required)" + aria-describedby | TT1 Toaster container has aria-live="polite".

---

## Pre-flight

- [ ] **Step P1: Verify clean working tree on the correct branch**

```bash
git status
git rev-parse --abbrev-ref HEAD
```
Expected: `On branch evaluations-write-surface`, `nothing to commit`.

- [ ] **Step P2: Verify baseline tests green**

```bash
cd frontend && npm run test -- --run
```
Expected: all existing tests pass. Note baseline counts: `DashboardSidePanel.svelte.test.ts` = 14 tests.

- [ ] **Step P3: Verify reference signatures**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
grep -n "patch:" frontend/src/lib/api.ts
grep -n "export function pushToast" frontend/src/stores/toasts.svelte.ts
grep -n "export function emitUnauthorized" frontend/src/lib/events.ts
grep -n "isDirty:" frontend/src/components/editor/DirtyGuard.svelte
grep -n "autofocusSelector" frontend/src/components/ui/FocusTrap.svelte
grep -n "ApiError\|errorCode" frontend/src/lib/api.ts | head -5
grep -n "groups:" frontend/src/lib/dashboards.ts
grep -n "is_disabled\|is_superuser\|is_active" frontend/src/lib/types.ts | head -5
```
Expected:
- `api.patch<T>(path, body, opts?)` exists.
- `pushToast(message, kind?)` — kind default `'info'`.
- `emitUnauthorized(path: string)` — REQUIRED arg.
- `DirtyGuard` requires `isDirty: () => boolean`.
- `FocusTrap` accepts `autofocusSelector` prop.
- `ApiError` constructor: `(status, detail, errorCode?)`.
- `lib/dashboards.ts:120` declares `groups: DashboardMpGroupEntry[]`.
- `types.ts` has `is_superuser` + `is_disabled` (no `is_active`).

If any fails, stop and surface.

- [ ] **Step P4: Confirm InlineConfirm + helper signatures**

```bash
grep -n "confirmLabel\|confirmDataAction\|inline-confirm" frontend/src/components/ui/InlineConfirm.svelte
grep -n "function mountPanel\|function makeMp\|function makeEntry\|function mockFetch\|function settle\|function makeProgressTarget" frontend/src/tests/DashboardSidePanel.svelte.test.ts
grep -n "function mockFetch\|function mountTab\|function submissionMock\|function settle" frontend/src/tests/RunSubmissionTab.svelte.test.ts
grep -n "fetchSpy\|function jres\|courseFixture\|runFixture\|versionFixture\|function mockHappyPath\|function mockCascade\|function settle" frontend/src/tests/RunDetailPage.svelte.test.ts
```
Confirms helpers exist with the exact names used throughout this plan.

---

## Task 1: Wire module `lib/evaluations.ts` + 9 tests

**Goal:** Self-contained wire module with types, multipart POST, JSON PATCH, size constant. TDD: write 9-test file, run-fail, implement, run-pass.

**Files:**
- Create: `frontend/src/lib/evaluations.ts`
- Create: `frontend/src/tests/evaluations.test.ts`

- [ ] **Step 1.1: Write the failing wire test file (9 tests)**

Create `frontend/src/tests/evaluations.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '../lib/api';
import { createEvaluation, patchEvaluation, MAX_FEEDBACK_FILE_SIZE_BYTES } from '../lib/evaluations';
import * as events from '../lib/events';

function jsonResp(status: number, body: unknown, statusText = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nonJsonResp(status: number, statusText = ''): Response {
  return new Response('<html>Error</html>', {
    status,
    statusText,
    headers: { 'Content-Type': 'text/html' },
  });
}

describe('createEvaluation (multipart POST)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('WT1: builds FormData with all fields + credentials + X-Requested-With', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'fb.pdf', { type: 'application/pdf' });
    fetchMock.mockResolvedValue(jsonResp(201, {
      id: 1, submission_id: 7, result: 'major_revision', score: 80, feedback_text: 'Fix',
      has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1,
    }));
    await createEvaluation({
      submission_id: 7, result: 'major_revision', score: 80, feedback_text: 'Fix', feedback_file: pdf,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/submissions/7/evaluation');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('mathion');
    const fd = init.body as FormData;
    expect(fd.get('result')).toBe('major_revision');
    expect(fd.get('score')).toBe('80');
    expect(fd.get('feedback_text')).toBe('Fix');
    expect(fd.get('file')).toBe(pdf);
    expect([...fd.keys()].sort()).toEqual(['feedback_text', 'file', 'result', 'score']);
  });

  it('WT2: omits null/undefined fields', async () => {
    fetchMock.mockResolvedValue(jsonResp(201, {
      id: 1, submission_id: 7, result: 'accepted', score: null, feedback_text: null,
      has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1,
    }));
    await createEvaluation({ submission_id: 7, result: 'accepted' });
    const fd = fetchMock.mock.calls[0][1].body as FormData;
    expect([...fd.keys()]).toEqual(['result']);
    expect(fd.get('result')).toBe('accepted');
  });

  it('WT3: AbortSignal re-throws AbortError (NOT ApiError(0))', async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abortErr);
    controller.abort();
    await expect(
      createEvaluation({ submission_id: 7, result: 'accepted' }, { signal: controller.signal }),
    ).rejects.toBe(abortErr);
  });

  it('WT4a: throws ApiError(422) with JSON detail', async () => {
    fetchMock.mockResolvedValue(jsonResp(422, { detail: 'feedback_file required for non-accepted result' }));
    await expect(createEvaluation({ submission_id: 7, result: 'major_revision' })).rejects.toMatchObject({
      status: 422,
      detail: 'feedback_file required for non-accepted result',
    });
  });

  it('WT4b: throws ApiError(500) with "Upload failed" fallback on non-JSON body', async () => {
    fetchMock.mockResolvedValue(nonJsonResp(500, 'Internal Server Error'));
    await expect(createEvaluation({ submission_id: 7, result: 'accepted' })).rejects.toMatchObject({
      status: 500,
      detail: 'Upload failed',
    });
  });

  it('WT7: on 401 calls emitUnauthorized(return-path) + throws ApiError(401, "Not authenticated")', async () => {
    // jsdom 25 makes window.location non-configurable; use history.pushState to
    // change the URL so location.pathname/search/hash reflect the desired path.
    window.history.pushState({}, '', '/runs/42?tab=submission#focus');
    const spy = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResp(401, { detail: 'no session' }));
    await expect(createEvaluation({ submission_id: 7, result: 'accepted' })).rejects.toMatchObject({
      status: 401,
      detail: 'Not authenticated',
    });
    expect(spy).toHaveBeenCalledWith('/runs/42?tab=submission#focus');
  });
});

describe('patchEvaluation (JSON PATCH)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('WT5: sends JSON body, no file key, correct URL', async () => {
    fetchMock.mockResolvedValue(jsonResp(200, {
      id: 42, submission_id: 7, result: 'accepted', score: 95, feedback_text: 'Good',
      has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1,
    }));
    await patchEvaluation(42, { result: 'accepted', score: 95, feedback_text: 'Good' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/evaluations/42');
    expect(init.method).toBe('PATCH');
    // api.patch routes through lib/api.ts request() which wraps headers via
    // `new Headers(callerHeaders ?? {})` (frontend/src/lib/api.ts:34).
    // Headers instances are NOT plain objects — read with .get().
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Requested-With')).toBe('mathion');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ result: 'accepted', score: 95, feedback_text: 'Good' });
    expect('file' in body).toBe(false);
  });

  it('WT6: propagates ApiError on 4xx', async () => {
    fetchMock.mockResolvedValue(jsonResp(422, { detail: 'Cannot transition' }));
    await expect(patchEvaluation(42, { result: 'minor_revision' })).rejects.toMatchObject({
      status: 422,
      detail: 'Cannot transition',
    });
  });
});

describe('Constants', () => {
  it('WC1: MAX_FEEDBACK_FILE_SIZE_BYTES matches backend default (20 MB)', () => {
    expect(MAX_FEEDBACK_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024);
  });
});
```

- [ ] **Step 1.2: Run wire tests — verify FAIL**

```bash
cd frontend && npm run test -- --run src/tests/evaluations.test.ts
```
Expected: FAIL — `Cannot find module '../lib/evaluations' from src/tests/evaluations.test.ts`.

- [ ] **Step 1.3: Implement `lib/evaluations.ts`**

Create `frontend/src/lib/evaluations.ts`:

```typescript
import { api, ApiError } from './api';
import { emitUnauthorized } from './events';

// MUST stay in sync with backend Settings.max_file_size (config.py:9), default 20 MB.
// Backend value is env-overridable via MATHION_MAX_FILE_SIZE; a deploy bumping the
// backend constant must hand-update this. Accepted drift for the write-surface
// slice; a /api/config/limits endpoint is the principled fix (Phase 9).
export const MAX_FEEDBACK_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export type EvaluationResult = 'rejected' | 'major_revision' | 'minor_revision' | 'accepted';

export interface Evaluation {
  id: number;
  submission_id: number;
  result: EvaluationResult;
  score: number | null;
  feedback_text: string | null;
  has_feedback_file: boolean;
  evaluated_at: string;
  evaluated_by: number;
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

// Wire-layer mirror of lib/runAssets.ts:uploadRunAsset — credentials: 'include'
// (cross-port dev cookie), X-Requested-With CSRF header, network failure ->
// ApiError(0), 401 -> emitUnauthorized + ApiError(401), non-ok -> ApiError(status,
// detail, error_code). User-cancelled saves (AbortError) propagate as-is so
// callers can distinguish cancel from server-unreachable.
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
    // jsdom's DOMException doesn't extend Error, so duck-type on .name.
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') throw e;
    throw new ApiError(0, 'Could not reach server. Check your connection.');
  }
  if (r.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!r.ok) {
    const payload = await r.json().catch(() => ({ detail: 'Upload failed' }));
    throw new ApiError(r.status, payload.detail ?? 'Upload failed', payload.error_code);
  }
  return r.json();
}

export async function patchEvaluation(
  eid: number,
  input: EvaluationUpdateInput,
  opts?: { signal?: AbortSignal },
): Promise<Evaluation> {
  return api.patch<Evaluation>(`/api/evaluations/${eid}`, input, { signal: opts?.signal });
}
```

- [ ] **Step 1.4: Run wire tests — verify PASS (9/9)**

```bash
cd frontend && npm run test -- --run src/tests/evaluations.test.ts
```
Expected: 9/9 PASS.

- [ ] **Step 1.5: Run full suite — regression check**

```bash
cd frontend && npm run test -- --run
```
Expected: all tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add frontend/src/lib/evaluations.ts frontend/src/tests/evaluations.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add lib/evaluations.ts wire module + 9 tests

T1 of evaluations-write-surface. Multipart POST mirrors lib/runAssets.ts
(credentials, X-Requested-With, 401→emitUnauthorized with return-path,
AbortError pass-through, ApiError). JSON PATCH reuses api.patch.
MAX_FEEDBACK_FILE_SIZE_BYTES = 20 MB mirrors backend config default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Permission plumbing + RunSubmissionTab rebind + tab tests

**Goal:** Thread `isAdmin` + `isTeacher` from `RunDetailPage` → both tabs → panel. Replace `RunSubmissionTab`'s `panelOpen + panelTarget` snapshot with `selectedIds` + `$derived` lookup. Update `runId` `$effect` to reset `selectedIds`. Tests TD1, TD1-neg, TS1, TS2, TS3.

**Files:**
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte`
- Modify: `frontend/src/components/runs/RunSubmissionTab.svelte`
- Modify: `frontend/src/components/runs/RunProgressTab.svelte`
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte` (props widening only — declaration-only per Step 2.C-pre)
- Modify: `frontend/src/tests/RunDetailPage.svelte.test.ts` (+2 tests)
- Modify: `frontend/src/tests/RunSubmissionTab.svelte.test.ts` (+3 tests)

### Step 2.A: RunDetailPage isThisRunTeacher derivation

- [ ] **Step 2.A1: Write failing TD1 + TD1-neg**

Append to `frontend/src/tests/RunDetailPage.svelte.test.ts`:

```typescript
import { session } from '../stores/session.svelte';

describe('RunDetailPage — isThisRunTeacher derivation', () => {
  beforeEach(() => {
    session.user = null;
    session.loading = false;
  });

  it('TD1: derives canWrite=true on RunSubmissionTab when session.user.id is in teachers list', async () => {
    session.user = {
      id: 5, email: 'teach@x', full_name: 'T', is_superuser: false, is_disabled: false,
      photo_url: null, has_course_admin: false, has_run_teacher: true,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ ...courseFixture, is_admin: false });
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      // /dashboard/mini-projects MUST come before /mini-projects so the dashboard
      // endpoint returns a { run, mini_projects } shape (lib/dashboards.ts:123-161)
      // not the bare array expected by lib/miniProjects.ts:5 listMiniProjects.
      if (url.includes('/dashboard/mini-projects')) return jres({ run: { id: 10, title: 'R', groups_enabled: true }, mini_projects: [] });
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([{ id: 1, run_id: 10, user_id: 5, user_email: 'teach@x', user_full_name: 'T', created_at: '2026-01-01' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const submTab = Array.from(target.querySelectorAll('button[role="tab"]'))
      .find((b) => b.textContent?.trim() === 'Submission') as HTMLButtonElement;
    submTab.click();
    flushSync();
    await settle();
    const tabContainer = target.querySelector('[data-test="run-submission-tab"]') as HTMLElement;
    expect(tabContainer?.getAttribute('data-can-write')).toBe('true');
    unmount(cmp);
  });

  it('TD1-neg: canWrite=false when teachers list does not contain session.user.id (and is_admin=false)', async () => {
    session.user = {
      id: 5, email: 'student@x', full_name: 'S', is_superuser: false, is_disabled: false,
      photo_url: null, has_course_admin: false, has_run_teacher: false,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ ...courseFixture, is_admin: false });
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture());
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      // /dashboard/mini-projects MUST come before /mini-projects so the dashboard
      // endpoint returns a { run, mini_projects } shape (lib/dashboards.ts:123-161)
      // not the bare array expected by lib/miniProjects.ts:5 listMiniProjects.
      if (url.includes('/dashboard/mini-projects')) return jres({ run: { id: 10, title: 'R', groups_enabled: true }, mini_projects: [] });
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([{ id: 1, run_id: 10, user_id: 99, user_email: 'other@x', user_full_name: 'Other', created_at: '2026-01-01' }]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const submTab = Array.from(target.querySelectorAll('button[role="tab"]'))
      .find((b) => b.textContent?.trim() === 'Submission') as HTMLButtonElement;
    submTab.click();
    flushSync();
    await settle();
    const tabContainer = target.querySelector('[data-test="run-submission-tab"]') as HTMLElement;
    expect(tabContainer?.getAttribute('data-can-write')).toBe('false');
    unmount(cmp);
  });
});
```

The `data-test="run-submission-tab"` + `data-can-write` markers are added on `RunSubmissionTab.svelte`'s root in Step 2.B1.

- [ ] **Step 2.A2: Run tests — verify FAIL**

```bash
cd frontend && npm run test -- --run src/tests/RunDetailPage.svelte.test.ts
```
Expected: TD1 + TD1-neg FAIL — `expect(tabContainer?.getAttribute('data-can-write')).toBe('true')` fails because the attribute doesn't exist yet.

- [ ] **Step 2.A3: Add derivation + prop threading in `RunDetailPage.svelte`**

**Add import** AFTER the `import { pushToast } from '../../stores/toasts.svelte';` line (around line 9):
```typescript
import { session } from '../../stores/session.svelte';
```

**Add derivations** AFTER `let activeTab = $state<ActiveTab>('overview');` (around line 50):
```typescript
const isAdmin = $derived(course?.is_admin === true);
const isThisRunTeacher = $derived(
  session.user != null && (teachers ?? []).some((t) => t.user_id === session.user!.id),
);
```

**Replace** line 448 (`<RunProgressTab runId={run.id} />`):
```svelte
<RunProgressTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} />
```

**Replace** line 450 (`<RunSubmissionTab runId={run.id} />`):
```svelte
<RunSubmissionTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} />
```

### Step 2.B: Add optional props to both tabs

- [ ] **Step 2.B1: Add props + markers to `RunSubmissionTab.svelte`**

**Replace** the `$props()` block at line 13:
```typescript
let {
  runId,
  isAdmin = false,
  isTeacher = false,
}: {
  runId: number;
  isAdmin?: boolean;
  isTeacher?: boolean;
} = $props();

const canWrite = $derived(isAdmin || isTeacher);
```

**Replace** the outer `<div class="tab-container">` at line 192:
```svelte
<div class="tab-container" data-test="run-submission-tab" data-can-write={canWrite ? 'true' : 'false'}>
```

- [ ] **Step 2.B2: Add props to `RunProgressTab.svelte`**

Find the `$props()` block in `RunProgressTab.svelte`. Replace with:
```typescript
let {
  runId,
  isAdmin = false,
  isTeacher = false,
}: {
  runId: number;
  isAdmin?: boolean;
  isTeacher?: boolean;
} = $props();
```

The panel mount in `RunProgressTab.svelte` will be updated in Step 3.C6 to thread `isAdmin`/`isTeacher` to the panel.

### Step 2.C-pre: Widen `DashboardSidePanel.$props()` ahead of mount-site changes

**Rationale:** Step 2.C3 (and Step 3.C6) mount `<DashboardSidePanel>` with `isAdmin`/`isTeacher`/`onRefetch` props. Strict TypeScript (`frontend/tsconfig.json:12`) will reject those props until the panel widens its `$props()`. Wider behavior (the new `canWrite` derivation, the form scaffold, the `editing` state) lands in T3 — this step is **declaration-only**: props are accepted but unused.

- [ ] **Step 2.C-pre.1: Extend `$props()` declaration in `DashboardSidePanel.svelte`**

**Replace** line 32 (`let { target, onClose }: { target: PanelTarget; onClose: () => void } = $props();`) with:
```typescript
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
```

No other code changes in this step. `canWrite` and `editing` declarations move to T3.C1 (which is now additive, not redeclaring `$props()`).

- [ ] **Step 2.C-pre.2: Run full suite — verify still green**

```bash
cd frontend && npm run test -- --run
```
Expected: 14 panel tests still pass; new optional props are unused.

### Step 2.C: RunSubmissionTab panel-target rebind

- [ ] **Step 2.C1: Write failing TS1 + TS2 + TS3**

Append inside the existing `describe('RunSubmissionTab', ...)` block in `frontend/src/tests/RunSubmissionTab.svelte.test.ts`:

```typescript
  // TS1 – panelTarget updates after refresh()
  it('TS1: selectedIds-derived panelTarget updates after refresh()', async () => {
    const v1 = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            {
              group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'awaiting_eval',
              latest_submission: { id: 50, submission_number: 1, submitted_at: '2026-06-01T10:00:00Z', submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false, file_size: 1024 },
              latest_evaluation: null,
            },
          ],
          counts: { total_groups: 1, not_submitted: 0, awaiting_eval: 1, needs_revision: 0, accepted: 0, rejected: 0 },
        },
      ],
    });
    const v2 = submissionMock({
      mini_projects: [
        {
          id: 1, block_id: 5, block_order: 1, block_title: 'B1', title: 'MP1',
          is_published: true, first_submitted_at: null, soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
          groups: [
            {
              group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'accepted',
              latest_submission: { id: 50, submission_number: 1, submitted_at: '2026-06-01T10:00:00Z', submitted_by: { user_id: 5, full_name: 'Alice' }, is_late: false, is_resubmission: false, file_size: 1024 },
              latest_evaluation: {
                id: 42, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' },
                result: 'accepted', score: 90, feedback_text: 'Good', has_feedback_file: true,
              },
            },
          ],
          counts: { total_groups: 1, not_submitted: 0, awaiting_eval: 0, needs_revision: 0, accepted: 1, rejected: 0 },
        },
      ],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(v1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(v2), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab(1);
    await settle();
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    let panel = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).not.toContain('90');
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    await settle();
    panel = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('90');
    expect(panel.textContent).toContain('Good');
  });

  // TS2 – row-gone after refresh auto-closes the panel
  it('TS2: row-gone after refresh auto-closes the panel', async () => {
    const v1 = submissionMock();
    const v2 = submissionMock({ mini_projects: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(v1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(v2), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mountTab(1);
    await settle();
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    const refreshBtn = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    refreshBtn.click();
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  // TS3 – runId change resets selectedIds
  it('TS3: runId change resets selectedIds (panel closes)', async () => {
    const fetchMock = mockFetch(200, submissionMock());
    vi.stubGlobal('fetch', fetchMock);
    const box = $state({ runId: 1 });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(RunSubmissionTab, { target: host, props: box });
    flushSync();
    await settle();
    const cellBtn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    cellBtn.click();
    flushSync();
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    vi.stubGlobal('fetch', mockFetch(200, submissionMock({ run: { id: 2, title: 'R2', groups_enabled: true } })));
    box.runId = 2;
    flushSync();
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
```

- [ ] **Step 2.C2: Run TS1/TS2/TS3 — verify FAIL**

```bash
cd frontend && npm run test -- --run src/tests/RunSubmissionTab.svelte.test.ts
```
Expected: TS1 FAIL — panel content stays stale (old snapshot). TS2 FAIL — panel remains open after row gone. TS3 may PASS under existing logic (current code resets `panelTarget = null` on runId change).

- [ ] **Step 2.C3: Implement `selectedIds`-derived rebind**

In `frontend/src/components/runs/RunSubmissionTab.svelte`:

**REMOVE** lines 26-27:
```typescript
let panelOpen = $state(false);
let panelTarget = $state<{ mp: DashboardMpRow; entry: DashboardMpGroupEntry } | null>(null);
```

**ADD** in their place:
```typescript
let selectedIds = $state<{ mpId: number; groupId: number } | null>(null);

const panelTarget = $derived.by(() => {
  if (selectedIds == null || data == null) return null;
  const mp = data.mini_projects.find((m) => m.id === selectedIds!.mpId);
  const entry = mp?.groups.find((g) => g.group_id === selectedIds!.groupId);
  return mp && entry ? { kind: 'submission' as const, mp, entry } : null;
});
```

**In the `runId` `$effect`** (lines 32-51), REPLACE the three lines:
```typescript
    groupFilter = 'all';
    panelOpen = false;
    panelTarget = null;
```
with:
```typescript
    groupFilter = 'all';
    selectedIds = null;
```

**Replace** `openPanel` (lines 114-117):
```typescript
  function openPanel(mp: DashboardMpRow, entry: DashboardMpGroupEntry): void {
    selectedIds = { mpId: mp.id, groupId: entry.group_id };
  }
```

**Replace** `closePanel` (lines 119-122):
```typescript
  function closePanel(): void {
    selectedIds = null;
  }
```

**Replace** the panel mount (lines 279-284):
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

`DashboardSidePanel` accepts `isAdmin`/`isTeacher`/`onRefetch` as of Step 2.C-pre (they're declared but unused). The TS tests assert on the dialog DOM only.

- [ ] **Step 2.C4: Run TS1/TS2/TS3 + full RunSubmissionTab suite — verify PASS**

```bash
cd frontend && npm run test -- --run src/tests/RunSubmissionTab.svelte.test.ts
```
Expected: all RunSubmissionTab tests pass.

### Step 2.D: Verify + commit

- [ ] **Step 2.D1: Re-run TD1 + TD1-neg — verify PASS**

```bash
cd frontend && npm run test -- --run src/tests/RunDetailPage.svelte.test.ts
```
Expected: TD1 + TD1-neg pass.

- [ ] **Step 2.D2: Run full suite — regression check**

```bash
cd frontend && npm run test -- --run
```
Expected: green.

- [ ] **Step 2.D3: Commit**

```bash
git add frontend/src/pages/runs/RunDetailPage.svelte \
        frontend/src/components/runs/RunSubmissionTab.svelte \
        frontend/src/components/runs/RunProgressTab.svelte \
        frontend/src/components/runs/DashboardSidePanel.svelte \
        frontend/src/tests/RunDetailPage.svelte.test.ts \
        frontend/src/tests/RunSubmissionTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): permission plumbing + RunSubmissionTab selectedIds rebind

T2 of evaluations-write-surface. RunDetailPage derives isAdmin +
isThisRunTeacher (per-run; NOT the global User.has_run_teacher flag).
Both tabs accept isAdmin/isTeacher props. DashboardSidePanel $props()
widened to accept isAdmin/isTeacher/onRefetch (declaration-only — full
write-surface behavior lands in T3). RunSubmissionTab replaces
panelOpen+panelTarget snapshot with selectedIds + $derived lookup so
refresh() flows through the open panel; runId-change $effect resets
selectedIds. Tests TD1/TD1-neg + TS1/TS2/TS3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Panel form scaffold + auto-accept banner + canWrite

**Goal:** Extend `mountPanel` helper. Extend `DashboardSidePanel.svelte` `$props()`. Restructure submission-branch layout. Add `data-side-panel-close`, `data-can-write`, FocusTrap autofocusSelector, `.banner-info` CSS. Tests T15, T18, T19a, T19b.

**Files:**
- Modify: `frontend/src/components/ui/FocusTrap.svelte` (Step 3.C0 — new opt-in `autofocusPriorityOrder` prop)
- Modify: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte`
- Modify: `frontend/src/components/runs/RunProgressTab.svelte`

### Step 3.A: Extend test helpers

- [ ] **Step 3.A1: Extend `mountPanel` + add `submissionTarget` helper**

In `frontend/src/tests/DashboardSidePanel.svelte.test.ts`:

**Replace** lines 22-33:
```typescript
interface MountPanelOpts {
  target: PanelTarget;
  onClose?: () => void;
  isAdmin?: boolean;
  isTeacher?: boolean;
  onRefetch?: () => void;
}

function mountPanel(opts: MountPanelOpts) {
  const onClose = opts.onClose ?? vi.fn();
  const onRefetch = opts.onRefetch ?? vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(DashboardSidePanel, {
    target: host,
    props: {
      target: opts.target,
      onClose,
      isAdmin: opts.isAdmin ?? false,
      isTeacher: opts.isTeacher ?? false,
      onRefetch,
    },
  });
  flushSync();
  return { host, onClose: onClose as ReturnType<typeof vi.fn>, onRefetch: onRefetch as ReturnType<typeof vi.fn> };
}
```

**Append below `makeEntry`** (after line 108) — `submissionTarget` higher-level helper:
```typescript
function submissionTarget(opts: {
  is_resubmission?: boolean;
  latest_evaluation?: DashboardMpGroupEntry['latest_evaluation'];
  status?: DashboardMpGroupEntry['status'];
  submissionId?: number;
} = {}) {
  const entry = makeEntry({
    status: opts.status ?? 'awaiting_eval',
    latest_submission: {
      id: opts.submissionId ?? 100,
      submission_number: opts.is_resubmission ? 2 : 1,
      submitted_at: '2026-06-04T10:00:00Z',
      submitted_by: { user_id: 5, full_name: 'Alice' },
      is_late: false,
      is_resubmission: opts.is_resubmission ?? false,
      file_size: 12345,
    },
    latest_evaluation: opts.latest_evaluation ?? null,
  });
  return { kind: 'submission' as const, mp: makeMp(), entry };
}
```

### Step 3.B: Write failing T15, T18, T19a, T19b

- [ ] **Step 3.B1: Append T15, T18, T19a, T19b** at end of the `describe` block:

```typescript
  // T15: form mount + focus on result <select>
  it('T15: shows form when canWrite + no eval + not auto-accept; focus on result <select>', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeTruthy();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(document.activeElement).toBe(select);
  });

  // T18: form DOM-absent when canWrite=false
  it('T18: form DOM-absent when canWrite=false', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
    });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T19a: auto-accept banner + no eval, no form, no eval block
  it('T19a: auto-accept banner when is_resubmission + no eval; no form, no eval block', async () => {
    mountPanel({
      target: submissionTarget({ is_resubmission: true, latest_evaluation: null }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('.banner-info')).toBeTruthy();
    expect(host.textContent).toContain('Auto-accepted on resubmission');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('section.evaluation-block')).toBeNull();
  });

  // T19b: auto-accept + eval present → banner + read-only eval block, no form, no [Edit]
  it('T19b: auto-accept + eval present → banner + read-only eval block, no form, no [Edit]', async () => {
    mountPanel({
      target: submissionTarget({
        is_resubmission: true,
        latest_evaluation: {
          id: 99, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: { user_id: 1, full_name: 'AutoAccept' },
          result: 'accepted', score: null, feedback_text: null, has_feedback_file: false,
        },
      }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('.banner-info')).toBeTruthy();
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
    expect(host.textContent).toContain('accepted');
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('[data-test="edit-evaluation"]')).toBeNull();
  });
```

- [ ] **Step 3.B2: Run tests — verify FAIL**

```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected: T15 FAIL (no form). T18 may pass trivially (form doesn't exist yet) — re-verified after T3.C. T19a/T19b FAIL (no banner).

### Step 3.C: Implement panel changes

- [ ] **Step 3.C0: Extend FocusTrap with priority-order autofocus**

In `frontend/src/components/ui/FocusTrap.svelte`:

**Replace** the `$props()` destructure block (lines 4-10):
```typescript
  let {
    autofocusSelector = 'input, select, textarea, button',
    autofocusPriorityOrder = false,
    children,
  }: {
    autofocusSelector?: string;
    autofocusPriorityOrder?: boolean;
    children: Snippet;
  } = $props();
```

**Replace** the autofocus block inside `$effect` (lines 40-43):
```typescript
    queueMicrotask(() => {
      if (!containerEl) return;
      if (autofocusPriorityOrder) {
        // Comma-separated selector: try each in declaration order, return the
        // FIRST match (NOT first-in-DOM-order). Lets callers express a true
        // fallback chain — e.g. `'select[name="x"], [data-close]'` focuses the
        // select when present, else the close button.
        const selectors = autofocusSelector.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        for (const sel of selectors) {
          const el = containerEl.querySelector<HTMLElement>(sel);
          if (el) {
            el.focus();
            return;
          }
        }
      } else {
        const first = containerEl.querySelector<HTMLElement>(autofocusSelector);
        first?.focus();
      }
    });
```

Rationale: existing call sites (`NewRunModal`, `RosterImportModal`, `MiniProjectModal`) use single-selector forms or the default. Without the opt-in flag they behave identically. Only the panel opts into priority-order.

- [ ] **Step 3.C1: Add `canWrite` derivation + `editing` state**

In `frontend/src/components/runs/DashboardSidePanel.svelte`, the `$props()` block was already widened in Step 2.C-pre to accept `isAdmin`/`isTeacher`/`onRefetch`. **Add** these two declarations IMMEDIATELY AFTER the closing `= $props();` line:

```typescript
  const canWrite = $derived(isAdmin || isTeacher);
  let editing = $state(false);
```

- [ ] **Step 3.C2: Add `data-can-write` marker + `data-side-panel-close` to Close button**

**Replace** the `<div class="dashboard-side-panel" ...>` opening tag (line 80):
```svelte
  <div
    class="dashboard-side-panel"
    role="dialog"
    aria-modal="true"
    aria-label={target.kind === 'progress' ? 'Item-level breakdown' : 'Submission details'}
    data-can-write={target.kind === 'submission' && canWrite ? 'true' : undefined}
  >
```

**Replace** the Close button (line 85):
```svelte
    <button class="panel-close" onclick={onClose} aria-label="Close panel" data-side-panel-close>
      <span aria-hidden="true">✕</span>
      Close
    </button>
```

- [ ] **Step 3.C3: Update `FocusTrap` autofocusSelector + opt into priority order**

**Replace** the `<FocusTrap>` tag (line 78):
```svelte
<FocusTrap autofocusSelector='select[name="evaluation-result"], [data-side-panel-close]' autofocusPriorityOrder>
```

The `autofocusPriorityOrder` flag (added in Step 3.C0) makes FocusTrap split the selector by `,` and return the first matching element in declaration order — so the result `<select>` wins when the form is mounted, with fallback to the Close button for the progress branch where no form exists.

- [ ] **Step 3.C4: Restructure the submission-branch cascade**

**Cascade shape (explicit structure — verify after writing the markup):**

```
{#if target.entry.latest_submission == null}
  "Not submitted yet."
{:else}
  Submission block (always renders when submission exists)
  {#if sub.is_resubmission}                           ← Branch A: auto-accept
    auto-accept banner
    optional auto-accept eval block — occurrence (a) of {@const evalu = target.entry.latest_evaluation}
  {:else if target.entry.latest_evaluation}           ← Branch B: existing eval (DO NOT skip)
    occurrence (b) of {@const evalu = target.entry.latest_evaluation} (REPLACED in T5.SETUP.2 with effectiveEvaluation)
    eval section + Edit + edit form
  {:else if canWrite}                                 ← Branch C: new-eval form
    new form
  {:else}                                             ← Branch D: read-only awaiting
    "Awaiting evaluation"
  {/if}
{/if}
```

**Critical: Branches B, C, D are `{:else if}` / `{:else}` of `{#if sub.is_resubmission}`** — NOT nested inside it. Branch A's inner `{/if}` for `{#if target.entry.latest_evaluation}` closes IMMEDIATELY before `{:else if target.entry.latest_evaluation}`. Verify by counting `{#if}` / `{/if}` pairs after writing the markup. The markup block below has the structure right; the `{@const evalu = ...}` annotations are labeled (a) and (b) in inline comments.

**Two `{@const evalu = target.entry.latest_evaluation}` occurrences:**
- **Occurrence (a)** — Branch A's inner auto-accept eval block. **NEVER replaced.** Auto-accept always uses dashboard shape.
- **Occurrence (b)** — Branch B's existing-eval block. **REPLACED in T5.SETUP.2** with `{@const evalu = effectiveEvaluation}` so post-CREATE `stateLatestEvaluation` surfaces in this branch.

**Replace lines 117-161** (everything inside the outer `{:else}` for the submission kind, from the `<!-- submission variant -->` comment through the final `{/if}` of the inner status conditional, but keeping the outer `</div>` and `</FocusTrap>` intact) with:

```svelte
{:else}
  <!-- submission variant: no fetch, render from passed-in target.entry -->
  <header>
    <h3>{target.mp.title}</h3>
    <p class="block-subtitle">{target.mp.block_title}</p>
    <p class="group-line">{target.entry.group_name}</p>
  </header>

  <StatusBadge status={target.entry.status} />

  {#if target.entry.latest_submission == null}
    <p>Not submitted yet.</p>
  {:else}
    {@const sub = target.entry.latest_submission}
    <section class="submission-block">
      <h4>Submission</h4>
      <p>Number: {sub.submission_number}</p>
      <p>Submitted at: {sub.submitted_at ? formatLocalWithTz(sub.submitted_at) : '—'}</p>
      <p>Submitted by: {sub.submitted_by?.full_name ?? sub.submitted_by?.user_id ?? '—'}</p>
      <p>Late: {sub.is_late ? 'Yes' : 'No'}</p>
      <p>Resubmission: {sub.is_resubmission ? 'Yes' : 'No'}</p>
      <p>File size: {formatFileSize(sub.file_size)}</p>
      <a class="download-link" href={`/api/submissions/${sub.id}/file`} download>Download submission</a>
    </section>

    {#if sub.is_resubmission}
      <div role="status" class="banner-info">
        Auto-accepted on resubmission. No manual evaluation needed.
      </div>
      {#if target.entry.latest_evaluation}
        {@const evalu = target.entry.latest_evaluation}
        <!-- Occurrence (a): auto-accept eval block. NEVER replaced — always reads dashboard shape. -->
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
    {:else if target.entry.latest_evaluation}
      {@const evalu = target.entry.latest_evaluation}
      <!-- Occurrence (b): Branch B. REPLACED in T5.SETUP.2 with {@const evalu = effectiveEvaluation}. -->
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
      {#if canWrite && !editing}
        <button type="button" data-test="edit-evaluation" onclick={() => (editing = true)}>Edit evaluation</button>
      {/if}
      {#if canWrite && editing}
        <h4>Edit evaluation</h4>
        <form aria-label="Write evaluation" onsubmit={(e) => e.preventDefault()}>
          <label for="evaluation-result">Result <span aria-hidden="true">*</span> <span id="evaluation-result-helper" class="helper-text">(required)</span></label>
          <select id="evaluation-result" name="evaluation-result" aria-required="true" aria-describedby="evaluation-result-helper">
            <option value="">Select…</option>
            <option value="rejected">Rejected</option>
            <option value="major_revision">Major revision</option>
            <option value="minor_revision">Minor revision</option>
            <option value="accepted">Accepted</option>
          </select>
        </form>
      {/if}
    {:else if canWrite}
      <h4>New evaluation</h4>
      <form aria-label="Write evaluation" onsubmit={(e) => e.preventDefault()}>
        <label for="evaluation-result">Result <span aria-hidden="true">*</span> <span id="evaluation-result-helper" class="helper-text">(required)</span></label>
        <select id="evaluation-result" name="evaluation-result" aria-required="true" aria-describedby="evaluation-result-helper">
          <option value="">Select…</option>
          <option value="rejected">Rejected</option>
          <option value="major_revision">Major revision</option>
          <option value="minor_revision">Minor revision</option>
          <option value="accepted">Accepted</option>
        </select>
      </form>
    {:else}
      <p>Awaiting evaluation</p>
    {/if}
  {/if}
{/if}
```

Notes:
- Submission `<section>` rendered unconditionally before cascade — preserves existing T6 / T8 / T9 panel tests.
- Form rendered ONLY in `editing` branch OR `canWrite + no eval` branch. T4 expands the form body. T3 minimal version has just result `<select>`.
- The form contents in BOTH branches are IDENTICAL (only the `<h4>` text differs). T4's expansion applies to both.

- [ ] **Step 3.C5: Add `.banner-info` + `.helper-text` CSS**

In the `<style>` block after `.panel-close { ... }` (around line 177):
```css
  .banner-info {
    padding: 0.75rem 1rem;
    border-radius: 4px;
    background: #e0f2f8;
    color: #044d6c;
    border-left: 4px solid #0a7ea4;
    margin-bottom: 1rem;
  }
  .helper-text {
    color: var(--text-muted, #666);
    font-size: 0.85em;
  }
```

- [ ] **Step 3.C6: Thread props in `RunProgressTab.svelte` panel mount**

Find `<DashboardSidePanel ...>` in `RunProgressTab.svelte`. Add `{isAdmin}` and `{isTeacher}` props plus a no-op `onRefetch`:
```svelte
<DashboardSidePanel
  target={panelTarget}
  onClose={closePanel}
  {isAdmin}
  {isTeacher}
  onRefetch={() => {}}
/>
```

- [ ] **Step 3.C7: Run T15/T18/T19a/T19b + verify 14 existing pass**

```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected: 18 panel tests pass.

Existing test analysis:
- #6 (`renders mp title, group, submission, and evaluation details`): `makeEntry()` defaults → `is_resubmission: true` + `latest_evaluation` present. New cascade: banner + Submission section + evaluation block (in the resubmission branch). All asserted text is present. PASS.
- #7 (`not_submitted`): `latest_submission: null` → "Not submitted yet." PASS.
- #8 (`awaiting_eval`): `makeEntry({ status: 'awaiting_eval', latest_evaluation: null })` keeps default `is_resubmission: true`. Cascade: Submission + banner + no eval block. Assertion: Submission h4 present, Evaluation h4 absent. PASS.
- #9 (`download links`): Submission link + feedback file link in resubmission branch (eval present). PASS.
- #10-14 unchanged.

- [ ] **Step 3.C8: Run full suite — regression check**

```bash
cd frontend && npm run test -- --run
```
Expected: green.

- [ ] **Step 3.C9: Commit**

```bash
git add frontend/src/components/ui/FocusTrap.svelte \
        frontend/src/components/runs/DashboardSidePanel.svelte \
        frontend/src/components/runs/RunProgressTab.svelte \
        frontend/src/tests/DashboardSidePanel.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): DashboardSidePanel form scaffold + auto-accept banner

T3 of evaluations-write-surface. Extended $props() with optional
isAdmin/isTeacher/onRefetch. canWrite derivation. Restructured
submission cascade: Submission block (preserved) → auto-accept banner
(+ optional eval block) or canWrite form scaffold or read-only-with-Edit
or "Awaiting evaluation". data-side-panel-close + data-can-write markers.
FocusTrap gains opt-in autofocusPriorityOrder flag so the comma-separated
selector falls back to the Close button when no form is rendered (spec §9
line 254). .banner-info + .helper-text CSS. Tests T15/T18/T19a/T19b.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Form fields + client-side validation + char counter

**Goal:** Complete the form fields (score, feedback_text + split counter, feedback_file with extension+MIME+empty+size). Tests T20, T27, T32, T35, T40.

**Files:**
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte`
- Modify: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`

- [ ] **Step 4.1: Write failing T20, T27, T32, T35, T40**

Append to test file:

```typescript
  // T20: validation blocks fetch (incl. score=0)
  it('T20: validation blocks fetch + score=0 valid; clearing error re-enables Save', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(fetchMock).not.toHaveBeenCalled();
    // After first submit attempt with blank result, the verbatim spec error appears.
    expect(host.textContent).toContain('Result is required.');
    select.value = 'major_revision';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Result is required.');
    expect(saveBtn.disabled).toBe(true);
    expect(host.textContent).toContain('Feedback is required when the result is not Accepted.');
    expect(host.textContent).toContain('PDF file required for non-accepted results.');
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '101';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '0';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '-1';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '10.5';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Score must be a whole number between 0 and 100.');
    scoreInput.value = '';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'Needs work';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(saveBtn.disabled).toBe(true);
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(saveBtn.disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // T27: file extension / empty / size / MIME
  it('T27: file extension/empty/size/MIME validation', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement;
    let f = new File(['x'], 'note.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Only PDF files accepted.');
    f = new File([], 'empty.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('File appears empty.');
    const big = new Uint8Array(21 * 1024 * 1024);
    f = new File([big], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('File exceeds 20 MB limit.');
    f = new File([new Uint8Array([0x50])], 'fake.pdf', { type: 'application/msword' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain('Only PDF files accepted.');
    f = new File([new Uint8Array([0x25, 0x50])], 'ok.pdf', { type: '' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Only PDF files accepted.');
    f = new File([new Uint8Array([0x25, 0x50])], 'ok2.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(host.textContent).not.toContain('Only PDF files accepted.');
  });

  // T32: char counter — aria-live region updates only ≥900
  it('T32: char counter aria-live updates only when crossing 900 chars', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    const live = host.querySelector('[data-test="feedback-counter-live"]') as HTMLElement;
    const visible = host.querySelector('[data-test="feedback-counter-visible"]') as HTMLElement;
    expect(live).toBeTruthy();
    expect(visible).toBeTruthy();
    textarea.value = 'abcde';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(visible.textContent).toContain('5');
    expect(live.textContent).toBe('');
    textarea.value = 'a'.repeat(899);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(visible.textContent).toContain('899');
    expect(live.textContent).toBe('');
    textarea.value = 'a'.repeat(900);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(visible.textContent).toContain('900');
    expect(visible.textContent).toContain('approaching');
    expect(host.querySelector('[data-test="feedback-counter-visible"] strong')).toBeTruthy();
    // aria-live emits the CONSTANT 'Approaching limit' (NOT the running count) so
    // SR announces ONCE on the empty→constant transition at 900.
    expect(live.textContent).toBe('Approaching limit');
    // Typing past 900 must NOT mutate the live content (no re-announce).
    textarea.value = 'a'.repeat(950);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(live.textContent).toBe('Approaching limit');
    // Dropping back below 900 clears the live region (no announcement on emptying).
    textarea.value = 'a'.repeat(800);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(live.textContent).toBe('');
  });

  // T35: "Awaiting evaluation" placeholder
  it('T35: "Awaiting evaluation" placeholder when canWrite=false + no resubmission + no eval', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'awaiting_eval',
        is_resubmission: false,
        latest_evaluation: null,
      }),
    });
    await settle();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('.banner-info')).toBeNull();
    expect(host.textContent).toContain('Awaiting evaluation');
  });

  // T40: visible "(required)" + aria-describedby
  it('T40: result <select> has visible "(required)" helper text + aria-describedby', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const helper = host.querySelector('#evaluation-result-helper') as HTMLElement;
    expect(helper).toBeTruthy();
    expect(helper.textContent).toContain('(required)');
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    const desc = select.getAttribute('aria-describedby') ?? '';
    expect(desc.split(/\s+/)).toContain('evaluation-result-helper');
  });
```

- [ ] **Step 4.2: Run — verify FAIL with expected messages**

```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected:
- T20 FAIL — `saveBtn` is null (no Save button yet).
- T27 FAIL — `fileInput` is null.
- T32 FAIL — `[data-test="feedback-counter-live"]` is null.
- T35 PASS (from T3 cascade).
- T40 PASS (from T3 form scaffold).

- [ ] **Step 4.3: Implement form fields + validation + counter**

In `DashboardSidePanel.svelte` `<script>`:

**Add imports** in the existing imports block:
```typescript
import { MAX_FEEDBACK_FILE_SIZE_BYTES, type EvaluationResult } from '../../lib/evaluations';
```

**Add state + derivations** AFTER `let editing = $state(false);` (added in T3 step 3.C1):
```typescript
  let formResult = $state<EvaluationResult | ''>('');
  let formScore = $state<number | null>(null);
  let formFeedbackText = $state('');
  let formFeedbackFile = $state<File | null>(null);
  let fileError = $state<string | null>(null);
  // Set true on first submit attempt; controls whether `errors.result` surfaces
  // the "Result is required." inline error vs. just relying on native `disabled`.
  let formSubmitAttempted = $state(false);

  // T4 stub — REPLACED in T6 step 6.3 with $derived(effectiveEvaluation?.has_feedback_file ?? false)
  let existingHasFeedbackFile = $state(false);

  const feedbackCharCount = $derived(formFeedbackText.length);
  const counterApproaching = $derived(feedbackCharCount >= 900);

  // aria-live region emits a CONSTANT string when over threshold so SRs announce
  // ONCE (on the empty→constant transition at 900), NOT on every keystroke after.
  // Going below 900 makes the live region empty again (no announcement on empty).
  const announcedCounter = $derived(counterApproaching ? 'Approaching limit' : '');

  const errors = $derived.by(() => {
    const e: { result?: string; score?: string; feedbackText?: string; feedbackFile?: string } = {};
    if (formResult === '' && formSubmitAttempted) {
      e.result = 'Result is required.';
    }
    if (formScore !== null && !Number.isNaN(formScore)) {
      if (!Number.isInteger(formScore) || formScore < 0 || formScore > 100) {
        e.score = 'Score must be a whole number between 0 and 100.';
      }
    }
    const requiresFeedback = formResult !== '' && formResult !== 'accepted';
    if (requiresFeedback) {
      if (formFeedbackText.trim() === '') {
        e.feedbackText = 'Feedback is required when the result is not Accepted.';
      }
      if (!formFeedbackFile && !existingHasFeedbackFile) {
        e.feedbackFile = 'PDF file required for non-accepted results.';
      }
    }
    if (fileError) e.feedbackFile = fileError;
    return e;
  });

  // `valid` deliberately ignores `errors.result` (which only surfaces post-attempt
  // for UX) — the native `disabled` covers it pre-attempt.
  const valid = $derived(formResult !== '' && !errors.score && !errors.feedbackText && !errors.feedbackFile);

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    fileError = null;
    if (!file) { formFeedbackFile = null; return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      fileError = 'Only PDF files accepted.';
      formFeedbackFile = null; return;
    }
    if (file.type !== '' && file.type !== 'application/pdf') {
      fileError = 'Only PDF files accepted.';
      formFeedbackFile = null; return;
    }
    if (file.size === 0) {
      fileError = 'File appears empty.';
      formFeedbackFile = null; return;
    }
    if (file.size > MAX_FEEDBACK_FILE_SIZE_BYTES) {
      fileError = 'File exceeds 20 MB limit.';
      formFeedbackFile = null; return;
    }
    formFeedbackFile = file;
  }
```

**Replace each `<form aria-label="Write evaluation" onsubmit={(e) => e.preventDefault()}>` block** (both occurrences in T3 step 3.C4) — KEEP the surrounding `<h4>` headers, REPLACE just the `<form>...</form>` block with:

```svelte
<form aria-label="Write evaluation" onsubmit={(e) => { e.preventDefault(); formSubmitAttempted = true; /* handleSave wired in T5 */ }}>
  <label for="evaluation-result">Result <span aria-hidden="true">*</span> <span id="evaluation-result-helper" class="helper-text">(required)</span></label>
  <select id="evaluation-result" name="evaluation-result"
          aria-required="true"
          aria-describedby={errors.result ? 'evaluation-result-helper evaluation-result-error' : 'evaluation-result-helper'}
          bind:value={formResult}>
    <option value="">Select…</option>
    <option value="rejected">Rejected</option>
    <option value="major_revision">Major revision</option>
    <option value="minor_revision">Minor revision</option>
    <option value="accepted">Accepted</option>
  </select>
  {#if errors.result}<span id="evaluation-result-error" role="alert">{errors.result}</span>{/if}

  <label for="evaluation-score">Score <span class="helper-text">(optional, 0–100)</span></label>
  <input id="evaluation-score" name="evaluation-score" type="number" min="0" max="100" step="1"
         value={formScore ?? ''}
         oninput={(e) => {
           const v = (e.currentTarget as HTMLInputElement).value;
           formScore = v === '' ? null : Number(v);
         }}
         aria-describedby={errors.score ? 'evaluation-score-error' : undefined} />
  {#if errors.score}<span id="evaluation-score-error" role="alert">{errors.score}</span>{/if}

  <label for="evaluation-feedback">
    Feedback text
    {#if formResult !== 'accepted' && formResult !== ''}
      <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
    {:else}
      <span class="helper-text">(optional)</span>
    {/if}
  </label>
  <textarea id="evaluation-feedback" name="evaluation-feedback" maxlength="1000"
            bind:value={formFeedbackText}
            aria-describedby={errors.feedbackText ? 'evaluation-feedback-count evaluation-feedback-error' : 'evaluation-feedback-count'}></textarea>
  <span id="evaluation-feedback-count" data-test="feedback-counter-visible">
    {feedbackCharCount} / 1000{#if counterApproaching}<strong> — approaching limit</strong>{/if}
  </span>
  <span class="sr-only" data-test="feedback-counter-live" aria-live="polite">{announcedCounter}</span>
  {#if errors.feedbackText}<span id="evaluation-feedback-error" role="alert">{errors.feedbackText}</span>{/if}

  <label for="evaluation-file">
    Feedback PDF
    {#if formResult !== 'accepted' && formResult !== ''}
      <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
    {/if}
  </label>
  <input id="evaluation-file" name="evaluation-file" type="file" accept=".pdf,application/pdf" onchange={handleFileChange} />
  <span class="helper-text">PDF only, max 20 MB.</span>
  {#if errors.feedbackFile}<span role="alert">{errors.feedbackFile}</span>{/if}

  <button type="submit" disabled={!valid}>Save</button>
  <!-- Cancel button is rendered in T5/T7 — not in T4 -->
</form>
```

**Add `.sr-only` CSS** in the `<style>` block:
```css
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0);
    white-space: nowrap; border: 0;
  }
```

- [ ] **Step 4.4: Run T20/T27/T32/T35/T40 — verify PASS**

```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected: 23 panel tests pass.

- [ ] **Step 4.5: Run full suite — regression check**

```bash
cd frontend && npm run test -- --run
```
Expected: green.

- [ ] **Step 4.6: Commit**

```bash
git add frontend/src/components/runs/DashboardSidePanel.svelte \
        frontend/src/tests/DashboardSidePanel.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): form fields + client-side validation + a11y char counter

T4 of evaluations-write-surface. Score 0-100 int (with 0 valid), feedback
textarea maxlength 1000 with separate visible counter + hidden aria-live
region announcing only at >=900, feedback_file extension+MIME (best-effort)
+empty+size pre-flight. Save uses native disabled. Visible "(required)"
helper text + aria-describedby threading. Tests T20/T27/T32/T35/T40.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Save flow — split into 7 sub-tasks (5a–5g)

**Goal:** Wire submit, abort, timeout, toast, refetch, 409 race, state.latestEvaluation handoff. Split into 7 TDD cycles.

**Files:**
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte`
- Modify: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`

### Step 5.SETUP: Mock pushToast + add state vars + minimal handlers

- [ ] **Step 5.SETUP.1: Add `vi.mock` near the TOP of the test file + extend beforeEach**

AFTER the existing imports block in `DashboardSidePanel.svelte.test.ts`:

```typescript
vi.mock('../stores/toasts.svelte', async () => {
  const actual = await vi.importActual<typeof import('../stores/toasts.svelte')>('../stores/toasts.svelte');
  return { ...actual, pushToast: vi.fn() };
});
import { pushToast } from '../stores/toasts.svelte';
```

**Extend the existing `beforeEach`** (it currently calls `vi.restoreAllMocks()`). Add the mockClear line next to it so pushToast call history doesn't bleed across tests:

```typescript
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(pushToast).mockClear();
});
```

- [ ] **Step 5.SETUP.2: Add state vars + imports + minimal handleSave/handleCancel + read-only block updates**

In `DashboardSidePanel.svelte` `<script>`:

**Add imports**:
```typescript
import { createEvaluation, patchEvaluation, type Evaluation } from '../../lib/evaluations';
import { ApiError } from '../../lib/api';
import { pushToast } from '../../stores/toasts.svelte';
import { tick } from 'svelte';
```

**Add state + derivations** AFTER the T4 state block:
```typescript
  const SUBMIT_TIMEOUT_MS = 60_000;

  let stateLatestEvaluation = $state<Evaluation | null>(null);
  let submitting = $state(false);
  let serverError = $state<string | null>(null);
  let submitController: AbortController | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let raceTransition = $state(false);

  // Captured when Edit is clicked (T6 wires the $effect). Used by T7's dirty-guard
  // to compare current form values against the pre-fill baseline so a clean
  // just-opened edit is NOT dirty. `null` means create-mode (no pre-fill).
  let prefillSnapshot = $state<{ result: EvaluationResult | ''; score: number | null; feedback_text: string } | null>(null);

  const effectiveEvaluation = $derived.by(() => {
    if (target.kind !== 'submission') return null;
    return stateLatestEvaluation ?? target.entry.latest_evaluation;
  });

  $effect(() => {
    if (effectiveEvaluation != null) raceTransition = false;
  });
```

**Add stub `handleSave`** (5a-5g progressively wire branches):
```typescript
  async function handleSave() {
    // 5a-5g progressively implement this; minimal stub returns early.
    return;
  }
```

**Add minimal `handleCancel`** (full version REPLACES this in T7):
```typescript
  // MINIMAL handleCancel — only handles submit-time abort. T7 step 7.3 REPLACES
  // this with the full dirty-guard version. DO NOT EXTEND THIS HERE.
  function handleCancel() {
    if (submitting) {
      submitController?.abort('user-cancel');
      return;
    }
    editing = false;
  }
```

**Wire onsubmit**: replace BOTH `onsubmit={(e) => { e.preventDefault(); /* handleSave wired in T5 */ }}` with:
```svelte
onsubmit={(e) => { e.preventDefault(); handleSave(); }}
```

**Add Save button update + Cancel button**: replace BOTH `<button type="submit" disabled={!valid}>Save</button>` with:
```svelte
<button type="submit" disabled={!valid || submitting} aria-busy={submitting}>Save</button>
{#if editing || submitting}
  <button type="button" data-test="cancel-button" onclick={handleCancel}>{submitting ? 'Cancel upload' : 'Cancel'}</button>
{/if}
```

**Add error banner** ABOVE each form:
```svelte
{#if serverError}<div role="alert" class="form-error">{serverError}</div>{/if}
```

**Update the cascade** — Branch B's `{:else if target.entry.latest_evaluation}` (NOT the inner `{#if target.entry.latest_evaluation}` of Branch A — see T3.C4 occurrence (a) vs (b) labels) → replace with `{:else if effectiveEvaluation}`. Branch C: gate the new-eval form on `raceTransition` → replace `{:else if canWrite}` with `{:else if canWrite && !raceTransition}`. Leave Branch A and Branch A's inner `{#if target.entry.latest_evaluation}` alone (auto-accept always reads dashboard shape).

**Update the read-only "Evaluated at" / "Evaluated by" lines** in the `{:else if effectiveEvaluation}` branch to use the "You" / "Just now" placeholders. Replace the two lines:
```svelte
<p>Evaluated at: {evalu.evaluated_at ? formatLocalWithTz(evalu.evaluated_at) : '—'}</p>
<p>Evaluated by: {evalu.evaluated_by?.full_name ?? evalu.evaluated_by?.user_id ?? '—'}</p>
```
with:
```svelte
<p>Evaluated at: {target.entry.latest_evaluation ? (target.entry.latest_evaluation.evaluated_at ? formatLocalWithTz(target.entry.latest_evaluation.evaluated_at) : '—') : 'Just now'}</p>
<p>Evaluated by: {target.entry.latest_evaluation ? (target.entry.latest_evaluation.evaluated_by?.full_name ?? target.entry.latest_evaluation.evaluated_by?.user_id ?? '—') : 'You'}</p>
```

Also update `evalu` to reference `effectiveEvaluation`. Replace **occurrence (b)** of `{@const evalu = target.entry.latest_evaluation}` (the one inside the `{:else if effectiveEvaluation}` branch — labeled `<!-- Occurrence (b) -->` in T3.C4 markup) with `{@const evalu = effectiveEvaluation}`. **DO NOT** replace occurrence (a) inside Branch A's auto-accept block.

The download-link inside that branch needs `effectiveEvaluation.id`:
```svelte
{#if evalu.has_feedback_file}
  <a class="download-link" href={`/api/evaluations/${evalu.id}/feedback-file`} download>Download feedback file</a>
{/if}
```

**Add `.form-error` CSS**:
```css
  .form-error {
    background: #fdecea;
    color: #611a15;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    border-left: 4px solid #c53030;
    margin-bottom: 1rem;
  }
```

Run the existing tests to confirm no regression:
```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected: 23 panel tests pass.

### Step 5a: POST happy path — T21, T23, T26

- [ ] **Step 5a.1: Write failing T21, T23, T26**

```typescript
  // T21: POST happy — FormData contents, URL, X-Requested-With, credentials; aria-busy on Save during submit
  it('T21: POST happy — FormData contents, URL, X-Requested-With, credentials; aria-busy during submit', async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50])], 'fb.pdf', { type: 'application/pdf' });
    const evalResp = { id: 7, submission_id: 100, result: 'accepted', score: 95, feedback_text: 'OK', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    let resolveFetch!: (v: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '95';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'OK';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [pdf], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.getAttribute('aria-busy')).toBe('true');
    expect(saveBtn.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/submissions/100/evaluation');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('mathion');
    const fd = init.body as FormData;
    expect(fd.get('result')).toBe('accepted');
    expect(fd.get('score')).toBe('95');
    expect(fd.get('feedback_text')).toBe('OK');
    expect(fd.get('file')).toBe(pdf);
    // After resolveFetch the Save success path unmounts the form (cascade
    // transitions to read-only + [Edit]). The captured `saveBtn` is now detached
    // so don't assert on its post-resolution state — T30 covers focus-to-Edit.
    resolveFetch(new Response(JSON.stringify(evalResp), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    await settle();
    expect(host.querySelector('button[data-test="edit-evaluation"]')).toBeTruthy();
  });

  // T23: toast pushed with success message + kind
  it('T23: pushToast called with success message + kind on POST success', async () => {
    const evalResp = { id: 8, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(evalResp), { status: 201, headers: { 'Content-Type': 'application/json' } })));
    vi.mocked(pushToast).mockClear();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(pushToast).toHaveBeenCalledWith('Evaluation saved; group notified', 'success');
  });

  // T26b: onRefetch invoked once on PATCH success (parallel to T26 for POST)
  it('T26b: onRefetch invoked exactly once on PATCH success', async () => {
    const initialEval = { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true };
    const updatedEval = { id: 42, submission_id: 100, result: 'accepted', score: 95, feedback_text: 'Good', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(updatedEval), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: initialEval,
        submissionId: 100,
      }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  // T26: onRefetch invoked once on POST success
  it('T26: onRefetch invoked exactly once on POST success', async () => {
    const evalResp = { id: 9, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(evalResp), { status: 201, headers: { 'Content-Type': 'application/json' } })));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 5a.2: Run — verify FAIL**

Expected: T21/T23/T26 FAIL — `handleSave` is a stub; `fetch` not called.

- [ ] **Step 5a.3: Implement POST branch of `handleSave`**

Replace the stub body of `handleSave` with:

```typescript
  async function handleSave() {
    formSubmitAttempted = true; // surfaces errors.result = 'Result is required.' if blank
    if (!valid || submitting) return;
    submitting = true;
    serverError = null;
    submitController = new AbortController();
    timeoutHandle = setTimeout(() => submitController?.abort('timeout'), SUBMIT_TIMEOUT_MS);
    try {
      let result: Evaluation;
      if (effectiveEvaluation == null) {
        if (target.kind !== 'submission') throw new Error('handleSave called on non-submission kind');
        result = await createEvaluation({
          submission_id: target.entry.latest_submission!.id,
          result: formResult as EvaluationResult,
          score: formScore,
          feedback_text: formFeedbackText || null,
          feedback_file: formFeedbackFile,
        }, { signal: submitController.signal });
      } else {
        result = await patchEvaluation(effectiveEvaluation.id, {
          result: formResult as EvaluationResult,
          score: formScore,
          feedback_text: formFeedbackText || null,
        }, { signal: submitController.signal });
      }
      stateLatestEvaluation = result;
      editing = false;
      pushToast('Evaluation saved; group notified', 'success');
      onRefetch();
      await tick();
      const editBtn = document.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement | null;
      editBtn?.focus();
    } catch (e: unknown) {
      // 5c (4xx), 5d (409), 5e (timeout), 5g (user-cancel) progressively expand.
      if (e instanceof ApiError) {
        // displayMessage normalizes Pydantic 422 array details to a string toast
        // ("Please correct the highlighted fields."). frontend/src/lib/api.ts:14-19.
        serverError = e.displayMessage;
      } else {
        serverError = 'Unexpected error';
      }
    } finally {
      submitting = false;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      submitController = null;
    }
  }
```

- [ ] **Step 5a.4: Run T21/T23/T26 — verify PASS**

### Step 5b: PATCH happy path — T22

- [ ] **Step 5b.1: Write failing T22**

```typescript
  // T22: PATCH happy — JSON body, no file key, URL
  it('T22: PATCH happy — JSON body, no file key, URL /api/evaluations/{eid}', async () => {
    const initialEval = { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true };
    const updatedEval = { id: 42, submission_id: 100, result: 'accepted', score: 90, feedback_text: 'OK now', has_feedback_file: true, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(updatedEval), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: initialEval,
        submissionId: 100,
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '90';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'OK now';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/evaluations/42');
    expect(init.method).toBe('PATCH');
    // api.patch routes through request() which wraps headers via new Headers(...).
    // Read with Headers.get(), not bracket access on a plain object.
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('Content-Type')).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ result: 'accepted', score: 90, feedback_text: 'OK now' });
    expect('file' in body).toBe(false);
  });
```

- [ ] **Step 5b.2: Run — verify**

The PATCH branch is already wired in 5a.3 (`if (effectiveEvaluation == null) POST else PATCH`). T22 should PASS — verify.

If T22 fails, the most common cause is: `effectiveEvaluation` lookup returns null because the cascade requires `editing = true` to render the form, but pre-fill `$effect` (T6) isn't wired yet — so the form state stays at defaults. The test sets values explicitly after Edit-click, which overrides defaults. The form's `valid` derivation becomes true. `handleSave` fires; `effectiveEvaluation` is non-null (from `target.entry.latest_evaluation`). PATCH happens. PASS.

- [ ] **Step 5b.3: Run — verify PASS**

### Step 5c: 4xx error banner + field preservation — T24

- [ ] **Step 5c.1: Write failing T24**

```typescript
  // T24: 4xx error → banner role=alert; form values preserved; Save re-enabled
  it('T24: 4xx error banner + form values preserved + Save re-enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Bad request' }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '75';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const banner = host.querySelector('[role="alert"].form-error') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Bad request');
    expect(select.value).toBe('accepted');
    expect(scoreInput.value).toBe('75');
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });
```

- [ ] **Step 5c.2: Run — verify**

Should PASS already from 5a.3's catch branch.

- [ ] **Step 5c.3: No code change needed.**

### Step 5d: 409 race → refetch + read-only — T31

- [ ] **Step 5d.1: Write failing T31**

```typescript
  // T31: 409 → onRefetch + form transitions to read-only (form gone)
  it('T31: 409 → onRefetch called + form removed from DOM', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Already evaluated' }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
    const onRefetch = vi.fn();
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T31b: 409 race where refetch populates the winning eval → read-only block renders
  it('T31b: 409 → onRefetch populates target.entry.latest_evaluation → read-only with winning eval', async () => {
    const winningEval = {
      id: 77, evaluated_at: '2026-06-04T11:50:00Z',
      evaluated_by: { user_id: 9, full_name: 'Other Prof' },
      result: 'accepted', score: 88, feedback_text: 'OK', has_feedback_file: false,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Already evaluated' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    ));
    const startTarget = submissionTarget({ status: 'awaiting_eval', submissionId: 100 });
    // Wrap target in $state so we can mutate it from inside onRefetch (simulating
    // RunSubmissionTab's selectedIds-derived rebind after a refresh).
    const wrappedTarget = $state({ ...startTarget, entry: { ...startTarget.entry } });
    const onRefetch = vi.fn(() => {
      wrappedTarget.entry = { ...wrappedTarget.entry, latest_evaluation: winningEval, status: 'accepted' };
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(DashboardSidePanel, {
      target: host,
      props: { target: wrappedTarget, onClose: vi.fn(), isAdmin: true, isTeacher: false, onRefetch },
    });
    flushSync();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
    expect(host.textContent).toContain('88');
    expect(host.textContent).toContain('Other Prof');
  });
```

- [ ] **Step 5d.2: Run — verify FAIL**

Expected: T31 FAIL — form still in DOM (only the error banner is set).

- [ ] **Step 5d.3: Add 409 branch in catch**

Update the `catch` branch in `handleSave`:
```typescript
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        raceTransition = true;
        editing = false;
        onRefetch();
        return;
      }
      if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        serverError = 'Unexpected error';
      }
    }
```

`raceTransition` was added in T5 SETUP step 5.SETUP.2 along with the `$effect` that clears it when `effectiveEvaluation` populates. The cascade's `{:else if canWrite && !raceTransition}` (also from T5 SETUP) suppresses the form.

- [ ] **Step 5d.4: Run — verify PASS**

### Step 5e: 60s timeout — T29

- [ ] **Step 5e.1: Write failing T29 with signal-aware fetch mock**

```typescript
  // T29: timeout → banner + Save re-enabled + values preserved
  it('T29: timeout → "Upload timed out. Try again." banner; Save re-enabled', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    flushSync();
    await tick(); await tick();
    flushSync();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.getAttribute('aria-busy')).toBe('true');
    await vi.advanceTimersByTimeAsync(60_001);
    flushSync();
    expect(host.textContent).toContain('Upload timed out. Try again.');
    expect(saveBtn.disabled).toBe(false);
    expect(saveBtn.getAttribute('aria-busy')).toBe('false');
    expect(select.value).toBe('accepted');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
```

- [ ] **Step 5e.2: Run — verify FAIL**

Expected: T29 FAIL — no timeout branch; AbortError lands in `e instanceof ApiError` → false → `serverError = 'Unexpected error'` (NOT "Upload timed out…").

- [ ] **Step 5e.3: Add timeout-only branch in catch (no user-cancel handling yet)**

Update the catch — insert the AbortError handler BEFORE the `if (e instanceof ApiError)`:
```typescript
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        raceTransition = true;
        editing = false;
        onRefetch();
        return;
      }
      if ((e as { name?: string })?.name === 'AbortError') {
        const reason = (submitController?.signal as AbortSignal & { reason?: unknown })?.reason;
        if (reason === 'timeout') {
          serverError = 'Upload timed out. Try again.';
          return;
        }
        // user-cancel falls through to generic error below (handled in 5g).
      }
      if (e instanceof ApiError) {
        serverError = e.displayMessage;
      } else {
        serverError = 'Unexpected error';
      }
    }
```

- [ ] **Step 5e.4: Run T29 — verify PASS**

### Step 5f: POST→PATCH handoff — T33

- [ ] **Step 5f.1: Write failing T33**

```typescript
  // T33: after POST, [Edit] uses stateLatestEvaluation.id for PATCH (refetch never resolves)
  it('T33: POST → state.latestEvaluation; [Edit] + Save → PATCH /api/evaluations/{newId}', async () => {
    const created = { id: 42, submission_id: 100, result: 'accepted', score: 80, feedback_text: '', has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    const patched = { id: 42, submission_id: 100, result: 'accepted', score: 95, feedback_text: '', has_feedback_file: false, evaluated_at: '2026-06-04T12:05:00Z', evaluated_by: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(patched), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onRefetch = vi.fn(() => new Promise<void>(() => {}));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100, latest_evaluation: null }),
      isAdmin: true,
      onRefetch,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput.value = '80';
    scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(editBtn).toBeTruthy();
    editBtn.click();
    await settle();
    const scoreInput2 = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    scoreInput2.value = '95';
    scoreInput2.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const form2 = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form2.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/evaluations/42');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
  });
```

- [ ] **Step 5f.2: Run — verify**

T33 may pass on its own (state vars persist through Edit toggle) OR fail if the cascade re-evaluates `target.entry.latest_evaluation` is null + `editing` is true but `effectiveEvaluation` should be `stateLatestEvaluation` (set after POST). The cascade gate `{:else if effectiveEvaluation}` should render the read-only block + `[Edit]` button. Clicking [Edit] sets editing=true; form renders; values are still the form-state from before (formResult='accepted', formScore=80). Score is overwritten to 95. Save → handleSave checks `effectiveEvaluation != null` → PATCH branch → `patchEvaluation(42, ...)`. 

If T33 fails, the most likely failure: the form's `valid` derivation re-evaluates to false on edit-click because of how `effectiveEvaluation` is reactive. Debug if needed.

- [ ] **Step 5f.3: Verify PASS**

### Step 5g: User-cancel silent revert — T36

- [ ] **Step 5g.1: Write failing T36**

```typescript
  // T36: user-cancel during submit → no banner, form values preserved, Save re-enabled
  it('T36: user-cancel during submit → no banner, form values preserved', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    flushSync();
    await tick(); await tick();
    flushSync();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    const cancelBtn = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(host.querySelector('[role="alert"].form-error')).toBeNull();
    const saveBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    expect(select.value).toBe('accepted');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
```

- [ ] **Step 5g.2: Run — verify FAIL**

Expected: T36 FAIL — `serverError = 'Unexpected error'` is set (user-cancel falls through the timeout branch).

- [ ] **Step 5g.3: Add silent-revert branch**

Update the AbortError branch (replace the `// user-cancel falls through…` comment line):
```typescript
      if ((e as { name?: string })?.name === 'AbortError') {
        const reason = (submitController?.signal as AbortSignal & { reason?: unknown })?.reason;
        if (reason === 'timeout') {
          serverError = 'Upload timed out. Try again.';
          return;
        }
        // user-cancel: silent revert
        return;
      }
```

- [ ] **Step 5g.4: Run — verify PASS**

### Step 5.WRAPUP

- [ ] **Step 5.WRAPUP.1: Run full panel suite**

```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected: 32 panel tests pass (23 prior + T21/T22/T23/T24/T26/T29/T31/T33/T36).

- [ ] **Step 5.WRAPUP.2: Run full suite**

```bash
cd frontend && npm run test -- --run
```
Expected: green.

- [ ] **Step 5.WRAPUP.3: Commit**

```bash
git add frontend/src/components/runs/DashboardSidePanel.svelte \
        frontend/src/tests/DashboardSidePanel.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): Save flow — POST/PATCH, abort, timeout, toast, refetch, 409 race

T5 of evaluations-write-surface. handleSave wires createEvaluation /
patchEvaluation via stateLatestEvaluation; 60s AbortController timeout
(banner); Cancel-as-abort with silent user-cancel vs timeout banner;
pushToast on success; onRefetch callback; 409 → raceTransition + onRefetch
+ transition to read-only (auto-cleared when refetch lands). "You" /
"Just now" placeholders when only stateLatestEvaluation present. Minimal
handleCancel (submit-time abort only); full dirty-guard in T7.
Tests T21–T33 + T36.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Edit existing eval — pre-fill + result-lock + file-hidden + T34/T38/T39

**Goal:** Pre-fill form via `$effect` on edit. Result-lock invariant. Hide file picker in edit + "Replace not supported" placeholder. Tests T16, T17, T25, T34, T38, T39.

**Files:**
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte`
- Modify: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`

- [ ] **Step 6.1: Write failing T16, T17, T25, T34, T38, T39**

```typescript
  // T16: read-only block + [Edit] when canWrite + eval present
  it('T16: read-only block + [Edit] when canWrite + eval present', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
    expect(host.querySelector('button[data-test="edit-evaluation"]')).toBeTruthy();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T17: Edit pre-fills with existing values (null and non-null variants)
  it('T17: [Edit] expands pre-filled form; null score → empty input, null text → empty textarea', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'rejected',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'rejected', score: null, feedback_text: null, has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    expect(select.value).toBe('rejected');
    const scoreInput = host.querySelector('input[name="evaluation-score"]') as HTMLInputElement;
    expect(scoreInput.value).toBe('');
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  // T17 non-null variant: pre-fill round-trips full values from existing eval
  it('T17 non-null: [Edit] pre-fills select/score/textarea with existing values', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect((host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement).value).toBe('major_revision');
    expect((host.querySelector('input[name="evaluation-score"]') as HTMLInputElement).value).toBe('60');
    expect((host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement).value).toBe('Needs work');
  });

  // T25: result-lock — disabled non-accepted options + verbatim text + Save guarded
  it('T25: result-lock — non-accepted options disabled + verbatim helper text + fetch not called', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mountPanel({
      target: submissionTarget({
        status: 'accepted',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'accepted', score: 85, feedback_text: null, has_feedback_file: false },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const opts = host.querySelectorAll('select[name="evaluation-result"] option');
    const optMap = new Map<string, HTMLOptionElement>();
    opts.forEach((o) => optMap.set((o as HTMLOptionElement).value, o as HTMLOptionElement));
    expect(optMap.get('rejected')?.disabled).toBe(true);
    expect(optMap.get('major_revision')?.disabled).toBe(true);
    expect(optMap.get('minor_revision')?.disabled).toBe(true);
    expect(optMap.get('accepted')?.disabled).toBe(false);
    expect(host.textContent).toContain('Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead.');
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'rejected';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // T34: canWrite=false + eval → read-only, no [Edit]
  it('T34: canWrite=false + eval → read-only block, no [Edit]', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'accepted',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'accepted', score: 95, feedback_text: 'Good', has_feedback_file: true },
      }),
    });
    await settle();
    expect(host.querySelector('section.evaluation-block')).toBeTruthy();
    expect(host.querySelector('button[data-test="edit-evaluation"]')).toBeNull();
    expect(host.querySelector('form[aria-label="Write evaluation"]')).toBeNull();
  });

  // T38: file picker hidden in edit
  it('T38: file picker hidden in edit', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });

  // T39: "Replace not supported (Phase 9)" placeholder in edit
  it('T39: "Existing feedback file uploaded — replace not supported (Phase 9)" placeholder in edit', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    expect(host.textContent).toContain('Existing feedback file uploaded — replace not supported (Phase 9)');
  });
```

- [ ] **Step 6.2: Run — verify FAIL**

Expected: T16/T34 PASS already. T17 FAIL — no pre-fill. T25 FAIL — options not disabled. T38 FAIL — file input still rendered. T39 FAIL — placeholder text absent.

- [ ] **Step 6.3: Implement pre-fill + result-lock + file-hidden**

In `DashboardSidePanel.svelte` `<script>`:

**REMOVE** the T4 stub line `let existingHasFeedbackFile = $state(false);`.

**ADD** in its place:
```typescript
  const existingHasFeedbackFile = $derived(effectiveEvaluation?.has_feedback_file ?? false);
  const resultLocked = $derived(editing && effectiveEvaluation != null && !effectiveEvaluation.has_feedback_file);

  $effect(() => {
    if (editing && effectiveEvaluation) {
      formResult = effectiveEvaluation.result as EvaluationResult;
      formScore = effectiveEvaluation.score;
      formFeedbackText = effectiveEvaluation.feedback_text ?? '';
      formFeedbackFile = null;
      fileError = null;
      // Capture baseline for T7 dirty-detection. Without this, isDirty would
      // treat the just-pre-filled form as immediately dirty.
      prefillSnapshot = {
        result: effectiveEvaluation.result as EvaluationResult,
        score: effectiveEvaluation.score,
        feedback_text: effectiveEvaluation.feedback_text ?? '',
      };
      tick().then(() => {
        const sel = document.querySelector('select[name="evaluation-result"]') as HTMLSelectElement | null;
        sel?.focus();
      });
    }
  });
```

**Update the result `<select>`** in BOTH form occurrences — replace the `<option>` rows with:
```svelte
<option value="">Select…</option>
<option value="rejected" disabled={resultLocked}>Rejected</option>
<option value="major_revision" disabled={resultLocked}>Major revision</option>
<option value="minor_revision" disabled={resultLocked}>Minor revision</option>
<option value="accepted">Accepted</option>
```

**Add result-lock helper text** in BOTH form occurrences. AFTER the `{#if errors.result}...{/if}` line:
```svelte
{#if resultLocked}
  <span id="evaluation-result-lock" class="helper-text">Cannot change to a non-accepted result without a feedback file. Create a new evaluation instead.</span>
{/if}
```

**Extend the result `<select>`'s `aria-describedby`** so SR users hear the lock explanation. Replace the existing `aria-describedby={errors.result ? ... : 'evaluation-result-helper'}` with:
```svelte
aria-describedby={[
  'evaluation-result-helper',
  errors.result ? 'evaluation-result-error' : null,
  resultLocked ? 'evaluation-result-lock' : null,
].filter(Boolean).join(' ')}
```

**Update the file input section** in BOTH form occurrences. Replace the block:
```svelte
<label for="evaluation-file">
  Feedback PDF
  {#if formResult !== 'accepted' && formResult !== ''}
    <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
  {/if}
</label>
<input id="evaluation-file" name="evaluation-file" type="file" accept=".pdf,application/pdf" onchange={handleFileChange} />
<span class="helper-text">PDF only, max 20 MB.</span>
{#if errors.feedbackFile}<span role="alert">{errors.feedbackFile}</span>{/if}
```

with:
```svelte
{#if !editing}
  <label for="evaluation-file">
    Feedback PDF
    {#if formResult !== 'accepted' && formResult !== ''}
      <span aria-hidden="true">*</span> <span class="helper-text">(required)</span>
    {/if}
  </label>
  <input id="evaluation-file" name="evaluation-file" type="file" accept=".pdf,application/pdf" onchange={handleFileChange} />
  <span class="helper-text">PDF only, max 20 MB.</span>
  {#if errors.feedbackFile}<span role="alert">{errors.feedbackFile}</span>{/if}
{:else if effectiveEvaluation?.has_feedback_file}
  <p class="helper-text">Existing feedback file uploaded — replace not supported (Phase 9)</p>
{/if}
```

- [ ] **Step 6.4: Run T16/T17/T25/T34/T38/T39 — verify PASS**

```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected: all pass.

- [ ] **Step 6.5: Run full suite**

```bash
cd frontend && npm run test -- --run
```

- [ ] **Step 6.6: Commit**

```bash
git add frontend/src/components/runs/DashboardSidePanel.svelte \
        frontend/src/tests/DashboardSidePanel.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): edit existing eval + result-lock + file hidden in edit

T6 of evaluations-write-surface. [Edit] toggles pre-fill via $effect
(null score → empty input; null text → empty textarea). resultLocked
disables non-accepted <option> + verbatim helper text. File input hidden
in edit + "Replace not supported (Phase 9)" placeholder when file present.
existingHasFeedbackFile + resultLocked promoted from T4 stub to derived
from effectiveEvaluation. Tests T16/T17/T25/T34/T38/T39.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Dirty-guard + focus + Toaster aria-live + T28/T30/T37

**Goal:** REPLACE minimal `handleCancel` with full dirty-guard. Mount `InlineConfirm` + `DirtyGuard`. Wire Escape/backdrop/× to `tryClose`. Focus transitions. `Toaster` `aria-live="polite"`. Tests T28 (+ b/c/d/e), T30 (+ b), T37.

**Files:**
- Modify: `frontend/src/components/runs/DashboardSidePanel.svelte`
- Modify: `frontend/src/components/chrome/Toaster.svelte`
- Modify: `frontend/src/tests/DashboardSidePanel.svelte.test.ts`

- [ ] **Step 7.1: Write failing T28 (+ b/c/d/e), T30 (+ b), T37**

```typescript
  // T37: Cancel button DOM-absent in clean create
  it('T37: Cancel button is DOM-absent in clean create (no edit + no submit)', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    expect(host.querySelector('button[data-test="cancel-button"]')).toBeNull();
  });

  // T28: clean create + Escape → close without prompt
  it('T28: clean create + Escape → onClose (no InlineConfirm)', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.inline-confirm')).toBeNull();
  });

  // T28b: dirty create + Escape → InlineConfirm + focus on confirm button
  it('T28b: dirty create + Escape → InlineConfirm; focus on confirm button', async () => {
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'unsaved';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    const confirmBtn = host.querySelector('.inline-confirm button') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(document.activeElement).toBe(confirmBtn);
    expect(onClose).not.toHaveBeenCalled();
  });

  // T28c: dirty + backdrop click → InlineConfirm + focus on confirm button
  it('T28c: dirty + backdrop click → InlineConfirm; focus on confirm button', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'unsaved';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const backdrop = host.querySelector('.panel-backdrop') as HTMLElement;
    backdrop.click();
    await settle();
    const confirmBtn = host.querySelector('.inline-confirm button') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(document.activeElement).toBe(confirmBtn);
  });

  // T28d: dirty + × Close button → InlineConfirm + focus on confirm button
  it('T28d: dirty + × Close → InlineConfirm; focus on confirm button', async () => {
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const textarea = host.querySelector('textarea[name="evaluation-feedback"]') as HTMLTextAreaElement;
    textarea.value = 'unsaved';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const closeBtn = host.querySelector('[data-side-panel-close]') as HTMLButtonElement;
    closeBtn.click();
    await settle();
    const confirmBtn = host.querySelector('.inline-confirm button') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(document.activeElement).toBe(confirmBtn);
  });

  // T28e: during submit, Escape is a no-op
  it('T28e: during submit, Escape → no InlineConfirm, no onClose', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onClose } = mountPanel({
      target: submissionTarget({ status: 'awaiting_eval' }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(host.querySelector('.inline-confirm')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    const cancelBtn = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();
    await settle();
  });

  // T30: focus moves to [Edit] after successful Save
  it('T30: focus moves to [Edit] after successful Save', async () => {
    const evalResp = { id: 8, submission_id: 100, result: 'accepted', score: null, feedback_text: null, has_feedback_file: false, evaluated_at: '2026-06-04T12:00:00Z', evaluated_by: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(evalResp), { status: 201, headers: { 'Content-Type': 'application/json' } })));
    mountPanel({
      target: submissionTarget({ status: 'awaiting_eval', submissionId: 100 }),
      isAdmin: true,
    });
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    select.value = 'accepted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const form = host.querySelector('form[aria-label="Write evaluation"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(editBtn);
  });

  // T30c: focus moves to [Edit] after Cancel-in-edit (clean, no prompt)
  it('T30c: Cancel in clean edit-mode → focus moves to [Edit]', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const cancelBtn = host.querySelector('button[data-test="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();
    await settle();
    expect(host.querySelector('.inline-confirm')).toBeNull();
    const editBtnAfter = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(editBtnAfter);
  });

  // T30b: focus moves to result <select> after [Edit] click
  it('T30b: focus moves to result <select> after [Edit] click', async () => {
    mountPanel({
      target: submissionTarget({
        status: 'needs_revision',
        is_resubmission: false,
        latest_evaluation: { id: 42, evaluated_at: '2026-06-01T10:00:00Z', evaluated_by: { user_id: 1, full_name: 'Prof' }, result: 'major_revision', score: 60, feedback_text: 'Needs work', has_feedback_file: true },
      }),
      isAdmin: true,
    });
    await settle();
    const editBtn = host.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement;
    editBtn.click();
    await settle();
    const select = host.querySelector('select[name="evaluation-result"]') as HTMLSelectElement;
    expect(document.activeElement).toBe(select);
  });
```

- [ ] **Step 7.2: Run — verify FAIL**

Expected: T37 PASS. T28 PASS (clean create currently uses `onClose` directly). T28b/c/d FAIL (no InlineConfirm). T28e FAIL (Escape currently calls onClose during submit). T30 FAIL (no focus shift). T30b PASS (T6 already wires it).

- [ ] **Step 7.3: REPLACE handleCancel with full dirty-guard + add tryClose + InlineConfirm + DirtyGuard**

In `DashboardSidePanel.svelte` `<script>`:

**Add imports**:
```typescript
import InlineConfirm from '../ui/InlineConfirm.svelte';
import DirtyGuard from '../editor/DirtyGuard.svelte';
```

**Add state + derivation** AFTER the T5 state block:
```typescript
  const isDirty = $derived.by(() => {
    if (prefillSnapshot) {
      return (
        formResult !== prefillSnapshot.result ||
        formScore !== prefillSnapshot.score ||
        formFeedbackText !== prefillSnapshot.feedback_text ||
        formFeedbackFile !== null
      );
    }
    return (
      formResult !== '' ||
      formScore !== null ||
      formFeedbackText !== '' ||
      formFeedbackFile !== null
    );
  });

  let confirmDiscard = $state(false);

  // Focus the InlineConfirm's first button as soon as it appears so SR users
  // hear the prompt and keyboard users can act on it.
  $effect(() => {
    if (confirmDiscard) {
      tick().then(() => {
        const btn = document.querySelector('.inline-confirm button') as HTMLButtonElement | null;
        btn?.focus();
      });
    }
  });
```

**REPLACE** the minimal `handleCancel` from Step 5.SETUP.2 with:
```typescript
  function handleCancel() {
    if (submitting) {
      submitController?.abort('user-cancel');
      return;
    }
    if (isDirty) {
      confirmDiscard = true;
      return;
    }
    editing = false;
    tick().then(() => {
      const editBtn = document.querySelector('button[data-test="edit-evaluation"]') as HTMLButtonElement | null;
      editBtn?.focus();
    });
  }

  function tryClose() {
    if (submitting) return;
    if (isDirty) {
      confirmDiscard = true;
      return;
    }
    onClose();
  }

  function discardAndClose() {
    confirmDiscard = false;
    if (editing) {
      editing = false;
      formResult = '';
      formScore = null;
      formFeedbackText = '';
      formFeedbackFile = null;
      fileError = null;
      prefillSnapshot = null;
      formSubmitAttempted = false;
    } else {
      onClose();
    }
  }
```

**Replace** `handleKeydown` (originally lines 67-72, modified in T3):
```typescript
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      tryClose();
    }
  }
```

**Replace** the panel-backdrop and Close button to use `tryClose`:
- Backdrop: `<div class="panel-backdrop" onclick={tryClose} role="presentation"></div>`
- Close button: `<button class="panel-close" onclick={tryClose} aria-label="Close panel" data-side-panel-close>`

**Hoist `<InlineConfirm>` + `<DirtyGuard>` to panel-level** (NOT inside the form). Add as siblings of the cascade — placed inside the outer panel `<div>` but OUTSIDE every form / cascade branch — so they render in any cascade branch (create, edit, read-only) AND so clicking Discard inside InlineConfirm does not bubble to the form's submit handler. Place after the closing `{/if}` of the outermost cascade and before `</div>` of `.dashboard-side-panel`:

```svelte
{#if confirmDiscard}
  <div class="discard-confirm">
    <InlineConfirm
      confirmLabel="Discard"
      warning="Discard unsaved changes?"
      onConfirm={discardAndClose}
      onCancel={() => (confirmDiscard = false)}
    />
  </div>
{/if}
<DirtyGuard isDirty={() => isDirty && !submitting} />
```

**REMOVE** the prior in-form `{#if confirmDiscard}...{/if}` + `<DirtyGuard ...>` from BOTH `<form>` blocks (they were temporarily required in earlier revisions but rev 4 hoists). The form-internal Cancel button still calls `handleCancel`, which sets `confirmDiscard = true` if dirty — InlineConfirm at panel level then renders and gets focus via the `$effect` above.

- [ ] **Step 7.4: Add `aria-live="polite"` to `Toaster.svelte` + TT1 regression test**

In `frontend/src/components/chrome/Toaster.svelte`, replace:
```svelte
<div class="toaster">
```
with:
```svelte
<div class="toaster" aria-live="polite">
```

Create `frontend/src/tests/Toaster.svelte.test.ts` (NEW FILE — Toaster is mounted at `App.svelte:72`, NOT inside RunDetailPage, so the test mounts the component directly):

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Toaster from '../components/chrome/Toaster.svelte';

let host: HTMLDivElement;
let cmp: ReturnType<typeof mount>;

afterEach(() => {
  if (cmp) unmount(cmp);
  host?.remove();
});

describe('Toaster aria-live', () => {
  it('TT1: Toaster container renders with aria-live="polite"', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    cmp = mount(Toaster, { target: host });
    flushSync();
    const toaster = host.querySelector('.toaster') as HTMLElement;
    expect(toaster).toBeTruthy();
    expect(toaster.getAttribute('aria-live')).toBe('polite');
  });
});
```

- [ ] **Step 7.5: Run T28/T30/T37 — verify PASS**

```bash
cd frontend && npm run test -- --run src/tests/DashboardSidePanel.svelte.test.ts
```
Expected: all pass.

- [ ] **Step 7.6: Run full suite**

```bash
cd frontend && npm run test -- --run
```

- [ ] **Step 7.7: Commit**

```bash
git add frontend/src/components/runs/DashboardSidePanel.svelte \
        frontend/src/components/chrome/Toaster.svelte \
        frontend/src/tests/DashboardSidePanel.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): dirty-guard + focus management + Toaster aria-live

T7 of evaluations-write-surface. REPLACED minimal handleCancel with full
dirty-guard version. InlineConfirm on Escape/backdrop/× when dirty;
no-op during submit. DirtyGuard for nav/beforeunload. Focus transitions
on save/cancel/edit. Cancel hidden in clean-create. Toaster container
gets aria-live="polite". Tests T28 + T28b/c/d/e + T30 + T30b + T37.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Manual smoke walkthrough + final cleanup

**Goal:** Run the spec §13 walkthrough end-to-end. Cleanup with explicit grep commands.

**Files:** none (verification + cleanup).

- [ ] **Step 8.1: Reset DB + seed + start dev servers**

```bash
bash run-dashboards-smoke.sh
```

- [ ] **Step 8.2: Login as `admin@mathion.test` → Spring 2026 run → Submission tab.**

- [ ] **Step 8.3: Smoke step 1 — Click MP2/A (awaiting_eval).** Verify form visible, focus on result select.

- [ ] **Step 8.4: Smoke step 2 — Save accepted/85/no-file.** Verify toast + read-only + [Edit] focus.

- [ ] **Step 8.5: Smoke step 3 — Edit, change score to 90, Save.** Verify toast.

- [ ] **Step 8.6: Smoke step 4 — MP3/A read-only + Edit + 4 options enabled + "Replace not supported" placeholder.**

- [ ] **Step 8.7: Smoke step 5 — Change result to accepted in MP3/A edit, Save, toast.**

- [ ] **Step 8.8: Smoke step 6 — MP2/C validation cascade.**

  Empty fields + result=major_revision → inline errors, fetch NOT sent.
  `.txt` file → "Only PDF files accepted."
  50MB file (`head -c 52428800 /dev/zero > /tmp/big.pdf`) → "File exceeds 20 MB limit."
  Valid PDF + text → Save → toast.

- [ ] **Step 8.9: Smoke step 7 — MP5/B auto-accept.** Verify banner + eval block + no form + no [Edit].

- [ ] **Step 8.10: Smoke step 8 — Logout, login as teacher, repeat 8.3 and 8.5.**

- [ ] **Step 8.11: Smoke step 9 — Result-lock.** Create accepted+no-file eval; Edit; verify non-accepted options disabled + verbatim helper text.

- [ ] **Step 8.12: Smoke step 10 — Dirty-guard Escape.**

- [ ] **Step 8.13: Smoke step 11 — Toast SR (VoiceOver if available).**

- [ ] **Step 8.14: Cleanup grep**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
grep -rnE "console\.(log|error|warn)|TODO|FIXME|XXX" \
  frontend/src/components/runs/DashboardSidePanel.svelte \
  frontend/src/lib/evaluations.ts \
  frontend/src/pages/runs/RunDetailPage.svelte \
  frontend/src/components/runs/RunSubmissionTab.svelte \
  frontend/src/components/runs/RunProgressTab.svelte \
  frontend/src/components/chrome/Toaster.svelte
```
Expected: empty (or only intentional). Remove any debug output.

```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

```bash
cd frontend && npm run test -- --run
```
Expected: green; 9 wire + ~36 panel (14 baseline + ~22 new IDs in `DashboardSidePanel.svelte.test.ts`) + 5 tab + 1 Toaster (TT1 in the new dedicated `Toaster.svelte.test.ts`) = ~51 total. New IDs added by this plan: T15, T16, T17, T17-non-null, T18, T19a, T19b, T20, T21, T22, T23, T24, T25, T26, T26b, T27, T28, T28b, T28c, T28d, T28e, T29, T30, T30b, T30c, T31, T31b, T32, T33, T34, T35, T36, T37, T38, T39, T40 = 36 new IDs over the 14 baseline.

- [ ] **Step 8.15: Commit cleanup (if needed)**

```bash
git status
git diff
git add -A
git commit -m "$(cat <<'EOF'
chore(frontend): T8 cleanup — smoke verified, no debug remnants

T8 of evaluations-write-surface. All 12 §13 spec walkthrough steps passed.
Removed any console.log/TODO/dead code; TS check clean; tests green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" || echo "Nothing to commit"
```

---

## Wrap-up

Use `superpowers:finishing-a-development-branch` to merge to main locally (recommended) or open PR.

---

## Self-review

**1. Spec coverage:**
- §3 status codes: WT4a (422), WT4b (5xx fallback), WT7 (401), T24 (4xx via 400), T31 (409). 403/404 surface via the same shape as T24.
- §4 derivation: TD1 + TD1-neg (with `teachers ?? []` + `session.user != null` guard).
- §5 layout state machine: T15 (canWrite + no eval), T16 (canWrite + eval), T17 (Edit pre-fill), T18 (no canWrite + no eval), T19a (auto-accept no-eval), T19b (auto-accept + eval), T34 (no canWrite + eval), T35 ("Awaiting evaluation").
- §5 panel-target rebind: TS1, TS2, TS3.
- §5 evaluated_by normalization: 5.SETUP markup uses `target.entry.latest_evaluation` with `"You"` / `"Just now"` fallbacks; T33 covers the post-CREATE path.
- §6 form fields + validation: T20 (incl. score=0), T27, T32, T40.
- §6 Save flow steps 1-6: T21, T22, T23, T24, T26, T29, T31, T33, T36.
- §6 unsaved-changes guard: T28 + T28b/c/d/e.
- §6 focus management: T15 (mount), T30 (save), T30b (edit).
- §7 wire module: T1 (9 tests).
- §8 auto-accept banner: T19a + T19b + §13 smoke 8.9.
- §9 a11y: focus + .banner-info role=status + T32 + T40 + Toaster aria-live.
- §10: every spec-listed ID has a literal test body in the plan.
- §11: 9 files touched match.
- §13: 12 smoke steps map to 8.2–8.13.

**2. Placeholder scan:** No `TBD`/`TODO`/"see spec"/`(from rev 1)` in code blocks. Test bodies inline.

**3. Type / naming consistency:**
- `EvaluationResult`, `Evaluation` defined T1, used T4–T6.
- `effectiveEvaluation` defined T5 SETUP, used T5/T6.
- `stateLatestEvaluation` consistent.
- `existingHasFeedbackFile`: T4 stub `$state(false)` → T6 REPLACE with `$derived(...)`.
- `resultLocked`: T6 ONLY.
- `editing`: T3 step 3.C1 ONLY.
- `handleCancel`: T5 SETUP minimal → T7 step 7.3 REPLACE.
- `raceTransition`: T5 SETUP declared, 5d.3 set, 5.SETUP `$effect` clears.
- `tick`: imported T5 SETUP in panel; in test file at top.

**4. Test count:**
- Wire: 9.
- Panel: 14 existing + 27 new (T15–T40) + 4 T28 sub-tests + 1 T30b = 46 total. (Plan note: 41 is a conservative lower bound; actual depends on how T28 sub-tests are counted in tooling.)
- Tab: 5 (TD1, TD1-neg, TS1, TS2, TS3).

---

## Execution Handoff

Plan rev 3 complete and saved to `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`.

**1. Subagent-Driven (recommended)** — Controller dispatches fresh subagent per task, strict per-task review loop, fast iteration.

**2. Inline Execution** — Sequential execution in this session via `superpowers:executing-plans`.

**Which approach?**
