# Quiz Authoring in the Course Editor — Design Spec

- **Date:** 2026-06-21
- **Status:** Approved (rev 15) — codex CLEAN / implementation-ready; user-approved 2026-06-22
- **Slice:** Phase 8 / Course-editor "slice 2" (quiz authoring)
- **Type:** Frontend-only (no backend changes)

### Revision history
- **rev 15** — codex review (rev-14 target). Fixes 1 Important + 1 Minor in §10. The rev-14
  two-category recovery split (question-structural / option-level) **omitted two more 403/409
  origins**: the per-question `updateQuestion` Save (`questions.py:90`) and the quiz-title
  `updateItem` (`items.py:101`), both in-component but neither needing a list/option reload —
  just the guarded `loadAdminTree` re-gate. §10 now enumerates **all four** origins (every
  one does the guarded re-gate; only the extra reload scope differs). (Minor) the 404
  parenthetical is corrected: an option PATCH/DELETE resolves the **option** first
  (`questions.py:35`), so a 404 can mean the option — not necessarily its question — was
  deleted out-of-band.
- **rev 14** — codex review (rev-13 target). Fixes 1 Important by **correcting** §10 (not
  by adding the suggested callback). §10 had conflated question-level and option-level
  403/409 recovery and prescribed a `QuizEditor.listQuestions` reload the accordion has no
  callback to trigger. But the option-error path doesn't need the question list reloaded —
  the question rows are valid, only gating changed, and the admin tree carries no question
  rows anyway (`content.py:164`). So §10 is now **split by origin**: question-level errors
  → QuizEditor re-runs its own `listQuestions` + guarded `loadAdminTree`; option-level
  errors → the accordion re-fetches its own options (§6 write-back) + calls the guarded
  `loadAdminTree(vid,{force})` itself (global store fn, accordion has live `vid`) to re-gate
  `perms` through the prop chain — no cross-component `onRecoverQuestions` callback. (Codex
  confirmed all five rev-13 fixes hold; the blur-before-click consuming a correctness click
  is conservative serialization, not a defect.)
- **rev 13** — codex review (rev-12 target). Fixes 3 Important + 2 Minor. (1) **The
  lifecycle guard needs the LIVE route `vid`, not the tree's `version.id`** — during
  navigation the tree (hence `version`) is stale (`ItemEditPage.svelte:21` derives the live
  `vid` from the route prop; `:35` `v = tree?.version` lags until the new tree loads), so a
  `version.id === savedVid` check would miss the nav and let an old force-reload through.
  `QuizEditor` and `QuestionAccordion` now take an explicit **live `vid` prop** (threaded
  from `ItemEditPage:21`) used for the guard. (2) **`optionsLocked` now also covers the
  option-text blur-commit** — `onCommitText` is another eager option PATCH that returns the
  full row (`questions.py:198`, `schemas.py:316`), so an out-of-order text/correctness pair
  could overwrite newer local state; text-commit now participates in the accordion-wide lock
  (incl. the blur-before-click path) plus an apply-response-only-if-current guard
  (§4.1/§7.2/§8.6). (3) **Question-list structural mutations get a QuizEditor-wide lock** —
  add/delete/reorder **question** had no mutual exclusion, so two rapid reorders could commit
  in reverse order with no resync (`questions.py:139`); mirror the existing shared-`busy`
  propagation (`SequenceAccordion.svelte:302`) with a `questionsLocked` + `finally` release
  (§4.1/§6/§7.2). (Minor) §8.2 adds the `< 2 options` author hint for multiple_choice too
  (publish rejects it for both, `versions.py:224`); §11's malformed-quiz list now includes
  missing numeric **precision** (`versions.py:250`).
- **rev 12** — codex review (rev-11 target; final-sweep round). Fixes 3 Important. (1)
  **Mutation continuations + forced reloads unguarded after unmount/nav**: the rev-11
  `onDestroy` token bump covered only the list *loaders*; question/option PATCH handlers
  write local `$state` post-`await`, and add/delete-question + title-rename + 403/409
  recovery fire `loadAdminTree(vid,{force:true})`, which **advances the store token
  unconditionally** (`currentEditorVersion.svelte.ts:44`) so a late force-reload of the old
  vid overwrites the new route's tree. Now every post-`await` local write and forced reload
  uses the existing `alive && vid === savedVid` guard (`BlockAccordion.svelte:85–103`),
  pinning `savedVid`/`savedIid` at call-start (§6/§8/§10). (2) **Publish-time quiz
  validation DOES exist** — the rev-1 "no completeness validation" gap was false. Publish
  hard-rejects (409) empty quizzes, choice questions with < 2 options or 0/≠1 correct, and
  numeric/text questions missing their answer/precision (`versions.py:206–260`, tested
  `test_versions.py:192`). §3.9 documents the contract; §11 corrected; §8.1 / the
  0-question warning reframed as **author hints that mirror the publish gate** (not
  "backend allows it"). (3) **Delete-correct race during an optimistic correctness switch**:
  `correctnessLocked` disabled only correctness controls while per-row `busy` disabled only
  that row, so the old correct option could be **deleted** mid-switch; if the delete commits
  and the correctness PATCH fails, the guard-less backend DELETE (`questions.py:231`) leaves
  a persistent 0-correct question. Replaced with an **accordion-wide option-mutation lock**
  (`optionsLocked`) that mutually excludes correctness vs add/delete/reorder for the whole
  question (§4.1/§7.2/§8.2/§8.4/§8.6).
- **rev 11** — codex review (rev-10 target). Fixes 1 Important: the borrowed
  `AssetSidebar` token guard (`loadToken` bumped only at call-start) discards a *newer
  overlapping* load but **not** a response that resolves after unmount — nothing bumps the
  token on destroy, so `myToken === loadToken` stays true and a late response writes
  destroyed `$state` (the keyed `{#key}` destroys, not reuses, the instance, so an
  `itemId`-match check on a dead instance wouldn't catch it either). Both loaders now add
  **`onDestroy(() => loadToken++)`** to invalidate any in-flight `myToken` on unmount
  (§4.1/§4.1a/§12).
- **rev 10** — codex review (rev-9 target). Fixes 3 Important + 1 Minor. (1) **Stale
  `quizDirty` on navigation**: the page-owned `quizDirty` is `bind:`-written by the
  `{#key item.id}`-keyed `QuizEditor`, but destroying that child does not reset the parent
  boolean — so navigating from a dirty quiz to a static/video item left `quizDirty=true`,
  wrongly blocking DirtyGuard + delete. `ensureLoaded`'s per-item rebuild
  (`ItemEditPage.svelte:117–126`) now also resets `quizDirty = false`. (2) **Retry
  contradiction**: §4.1 said Retry is disabled while loading, yet §12 tested "Retry while
  the first fetch is in flight" — impossible (Retry only appears in the `error` state, when
  nothing is in flight). Reframed: the token guard discards a response that resolves after
  unmount or is superseded by a newer load; the test drives two overlapping **programmatic
  loader** calls, not the UI Retry. (3) **Unbounded expansion**: expanding `1e-1000000000`
  to a literal decimal before bounds-checking is a client-side DoS; §8.3 now computes
  integer/fractional/significant-digit counts **arithmetically** from the mantissa +
  exponent and rejects out-of-bounds input **before** materializing any expanded string
  (with an up-front length/exponent sanity cap). (Minor) Corrected the `AssetSidebar`
  citation: the quiz loaders borrow its `loadToken`/`myToken` stale-discard called from
  `onMount`, but need **no** `mountDone`+`$effect` reactive-reload machinery (qid/itemId are
  fixed for the component's lifetime via keying) — `mountDone` exists in `AssetSidebar` only
  to gate its reactive-reload `$effect`.
- **rev 9** — reviewer round on rev 8 (2 high-reasoning reviewers; codex pending). Fixes
  1 self-contradiction + 4 Important the rev-8 edits introduced or exposed. (C1) The §4
  responsibility table still said `QuizEditor` "loads questions+options" — corrected to
  "loads only the question list" (the rev-8 finding-2 straggler). (I1) The relocated
  per-accordion `listOptions` + Retry, and `QuizEditor`'s question-list load, now MUST use
  the existing token-guarded `onMount` pattern (`AssetSidebar.svelte:42,50–79`: plain
  `loadToken`, `myToken === loadToken` discard, `mountDone` gate) so a late/out-of-order
  response is dropped — §4.1a's stale-guard previously covered only QuizEditor. (I2) The
  new question-wide `correctnessLocked` flag (§8.2) is now bound by the **`finally`-clears**
  rule like `busy`, so a thrown correctness PATCH can't leave controls permanently
  disabled. (I3-numeric) §8.3 now **expands scientific notation to a plain decimal first**,
  then applies the ≤10-frac / <10^10 / ≤15-sig-digit bounds on the expanded value; the
  broken "re-stringify equals input" check (which rejected `1e3`) is removed. (I3-dirty)
  **Option-text drafts + their dirty trackers are hoisted into the always-mounted
  `QuestionAccordion`** (a `Map<optionId, …>`), not the `{#if expanded}` `OptionRow`, so an
  uncommitted draft survives collapse/nav and actually feeds `quizDirty` (the rev-8
  placement could not). Plus §7.1 documents the `quizDirty`-from-`$effect` reactivity
  contract, and minor relabels (§3.4 `QuestionReveal`, §12 "unique-correct no-op", §8.4
  confirm wraps the whole radio sequence).
- **rev 8** — codex review (rev-7 target). Fixes 4 Important. (1) Numeric authoring is
  constrained to a **float-safe subset** (≤ 15 significant digits) because the response
  serializes `Decimal`→`float` (`schemas.py:300`), so a 16–20-digit `Numeric(20,10)` value
  round-trips lossy (e.g. `9999999999.9999999999`→`1e10`, breaking the < 10^10 bound and
  changing correctness) — frontend-only, no backend change. (2) **Option loading moves
  into `QuestionAccordion`** (each accordion fetches its own options + owns
  `loading|loaded|error`); the rev-7 load-error state was unwireable because QuizEditor
  loaded options but passed only `question` — a failed fetch was indistinguishable from an
  empty list. `AuthoringQuestion` no longer carries `options`. (3) multiple_choice
  correctness toggles are now under a **question-wide** in-flight lock (not per-option), so
  one client can't fire two concurrent last-correct unchecks that the backend's
  lock-free check (`questions.py:213`) would both pass; the residual cross-client race is
  noted as a backend gap (§11). (4) **Option-text drafts are dirty-tracked**: each
  OptionRow's text edit registers a tracker into the registry so an uncommitted draft
  feeds `quizDirty` (DirtyGuard + item-delete see it) instead of being lost on nav before
  blur-commit. Plus the §14 split is now the **recommended** two-plan shape.
- **rev 7** — codex review (rev-6 target). Fixes gaps the rev-5 ownership redesign
  introduced: the §8.7 confirm latch is now wireable via a `confirmKeyChange` callback
  (the accordion only had `perms`, which can't distinguish created/published); the
  accordion's local copy now includes the **rendered** fields and is updated from each
  PATCH response (regenerated `text_html`), with `tracker.reset` post-save; a per-question
  **option-load-error** state (read-only + Retry, never represented as empty); client
  validation now bounds `correct_numeric` magnitude (`Numeric(20,10)`) and `correct_text`
  length (`String(500)`); a title rename now refreshes the tree so the page heading isn't
  stale.
- **rev 6** — rev-5 verification round (3 reviewers, all CLEAN/READY, incl. empirical
  svelte-check probes). Cosmetic polish only: standardized `{#key item.id}` phrasing;
  §4.1a reset list now reads as the full editor-state reset; `(awaited)` on the §8.4
  set-true step; delete-button disabled-reason reflects `quizDirty`.
- **rev 5** — codex review (rev-4 target). Fixes 5 Important: quiz-title rename had no UI
  path (now a QuizEditor title field); single_choice 2-correct repair deadlock (general
  radio rule unsets all other correct); whole-item delete didn't see `quizDirty`;
  unkeyed `QuizEditor` lacked item-identity/stale-response lifecycle (now `{#key itemId}`
  + load generation guard); child in-place mutation of the parent `question` prop
  violated Svelte 5 ownership (accordion now owns options + text in local `$state`). Plus
  2 Minor: the published-disallowed-field 409 is latent for question/option PATCH;
  "no re-score path" narrowed to runtime/API (a phase7c Alembic migration recomputes).
- **rev 4** — round-3 review (4 reviewers, all CLEAN/READY). Documentation-precision
  nits only: explicit `quizDirty` `$state` declaration; the `OptionRow.canDelete`
  formula; homed the 0-question warning in `QuizEditor`; `busy`-clears-in-`finally`
  guarantee; recorded the rejected "forbid published key edits entirely" alternative.
- **rev 3** — round-2 review (5 reviewers). Fixes: the `editable`-wiring contradiction
  (QuizEditor gets its own template branch, C1); client-side block on deleting the last
  correct option (C2); correct frontend type names (`AdminTreeVersion`,
  `VersionPermissions`); `QuestionAccordion` rolls its own header (drops the
  `AccordionHeader` reuse/`title`/raw-markdown-title problems); removed the dead
  `onStructuralChange`; unkeyed-render non-remount rule; dirty-registry lifecycle;
  options write-back on resync; §8.7 precision + confirm-scope; symmetric §7.2 lock;
  option whitespace/duplicate rules; `window.confirm()` instead of a FocusTrap modal;
  `versionPermissions` clarified (quiz flags derived locally); exact status/detail
  notes; focus-management transitions; task re-slice (T8 split).
- **rev 2** — round-1 review. (See git history.)
- **rev 1** — initial design (approved in brainstorm 2026-06-21).

## 1. Context & motivation

The Mathion course editor (`frontend/src/pages/editor/` + `frontend/src/components/editor/`)
authors only two of the four learning-item types:

- `ItemTypePicker.svelte` offers only `static_page` and `video`.
- `ItemEditPage.svelte` is `editable` only for `static_page` / `video`
  (`ItemEditPage.svelte:41`).
- For `quiz` / `interactive_app`, `ItemEditPage.svelte:324–337` renders a read-only
  placeholder: *"Quiz authoring UI lands in slice 2; questions are managed via the API for now."*

A teacher can build a course of pages and videos in the UI, but **quizzes still require
seed scripts or direct API calls** — even though the backend quiz engine (Phase 5), the
Phase 7c option-level scoring, and the *student-facing* quiz viewer already work
end-to-end. The backend authoring API is **complete and tested**
(`backend/mathion/api/questions.py`, `api/items.py`). This slice adds **no backend** —
it builds the editor UI on the existing endpoints. `interactive_app` authoring is a
separate future slice.

## 2. Goals / non-goals

### Goals
- Authors can create, edit (incl. **rename**), delete, reorder `quiz` items in the editor.
- Authors can create, edit, delete, reorder **questions** within a quiz.
- All **four** question types: `single_choice`, `multiple_choice`, `numeric_answer`,
  `text_answer`.
- For choice types: create/edit/delete/reorder **options** and mark correctness.
- Respect backend **state + disabled rules** (created = full; published = content-only;
  archived/disabled = read-only).
- Surface backend validation inline; protect published quizzes' recorded scores (§8.7).

### Non-goals (this slice)
- `interactive_app` authoring; question banks / reuse / templates / bulk import.
- Per-**option** feedback (no model field).
- In-place **question type change** (no `type` on `QuestionUpdate`); recovery is delete
  + recreate, **created-version only** (§8.8 covers the published dead-end).
- Author-side "preview as student" (use the existing student course view).
- Implementing the **publish action** or its validation UI — publish and its completeness
  409s already live in the existing version-publish flow (§3.9); this slice only mirrors
  those rules as inline author hints (§8.1).
- **Re-scoring** after answer-key edits (genuinely no backend support; §3.8 + §8.7 + §11).
- Drag-to-reorder (↑/↓ only).

## 3. Backend contract this slice builds on

All paths exist. Citations are to `backend/mathion/`. Routers mount with no prefix.
**Every endpoint here is gated by `require_course_admin`** — the editor already runs as
CourseAdmin/superuser, so no new auth work.

### 3.1 Item endpoints (`api/items.py`)
- `POST /api/sequences/{sequence_id}/items` — `ItemCreate { title, type, content_md?,
  video_url?, script_url? }` → `ItemResponse` (201). `ItemCreate` is `extra="forbid"`
  (`schemas.py:97`): for a quiz send **exactly** `{ title, type: "quiz" }`.
- `PATCH /api/items/{item_id}` — for a quiz, used only to rename (`title`).
- `DELETE /api/items/{item_id}` (204). `POST …/items/reorder` — `ReorderRequest`.

### 3.2 Question endpoints (`api/questions.py`)
- `POST /api/items/{item_id}/questions` — `QuestionCreate { text_md, type,
  explanation_md?, correct_numeric?, precision?, correct_text? }` → `QuestionResponse`
  (201). **Create does NOT validate numeric/text correctness** (only `update` does, §3.6).
- `GET /api/items/{item_id}/questions` → `list[QuestionResponse]` (200).
- `PATCH /api/questions/{question_id}` — `QuestionUpdate { text_md?, explanation_md?,
  correct_numeric?, precision?, correct_text? }` → `QuestionResponse` (200).
  **No `type` field — type is immutable after creation.**
- `DELETE /api/questions/{question_id}` (204). `POST …/questions/reorder`.

### 3.3 Option endpoints (`api/questions.py`)
- `POST /api/questions/{question_id}/options` — `OptionCreate { text, is_correct }` →
  `OptionResponse` (201). Choice-type questions only (**409** otherwise). `text`
  `min_length=1, max_length=500` (server does **not** strip); `is_correct` required.
- `GET /api/questions/{question_id}/options` → `list[OptionResponse]` (200).
- `PATCH /api/options/{option_id}` — `OptionUpdate { text?, is_correct? }` (200).
- `DELETE /api/options/{option_id}` (204). **No last-correct guard on delete** (§3.6).
- `POST …/options/reorder`.

### 3.4 Response / request shapes (`schemas.py`)
- `QuestionResponse` (flat; **options NOT embedded**): `{ id, item_id, text_md,
  text_html, type, order, explanation_md?, explanation_html?, correct_numeric?,
  precision?, correct_text? }`. **`correct_numeric` serializes to a JSON `number`
  (float)** — `serialize_decimal` returns `float(v)` (`schemas.py:300–303`); the post-submit
  reveal type `QuestionReveal` already models `number | null` (`lib/types.ts:167`) — the
  correctness-stripped student `Question` union has no such field. **Round-trip caveat:** the
  `Decimal`→`float` conversion is lossy beyond ~15 significant digits, so the full
  `Numeric(20,10)` range does **not** survive read-back (`9999999999.9999999999` reads back
  as `10000000000.0`). The authoring UI therefore constrains input to a float-safe subset
  (§8.3); the precise `Decimal` stays in the DB and is what scoring uses (`quiz.py`), so the
  loss only affects what the editor re-reads/re-saves — bounded away by §8.3.
- `OptionResponse`: `{ id, question_id, text, is_correct, order }`.
- `QuestionCreate.type`: the 4-type `Literal`; `text_md` min 1; `precision` `ge=0`.
  `correct_numeric` accepts a JSON number **or** numeric string on input (Pydantic →
  `Decimal`); DB column `Numeric(20,10)` (`models.py:135`).
- `ReorderRequest`: `{ order: Array<{ id, order }> }`, `order` `ge=1`, 1-indexed,
  `min_length=1`. Duplicate orders or an incomplete id-set → **400**.

### 3.5 Version gating (server-enforced; mirrored in UI)
Two **orthogonal** dimensions:

1. **`is_disabled`** — every mutating question/option/item endpoint checks
   `if version.is_disabled: raise 403` **before** the state check
   (`questions.py:49,94,131,143,168,202,235,247`; `items.py:42,106,219,231`).
2. **`state`** (among non-disabled):
   - **created**: full mutation.
   - **published**: **update only**, restricted to:
     `_QUESTION_EDITABLE_PUBLISHED = {text_md, explanation_md, correct_numeric,
     precision, correct_text}`; `_OPTION_EDITABLE_PUBLISHED = {text, is_correct}`;
     `_ITEM_EDITABLE_PUBLISHED = {title,…}` (quiz sends only `title`). No
     create/delete/reorder.
   - **archived**: read-only.

The frontend reuses `versionPermissions(version)` (`lib/versionPermissions.ts`) for the
**primitive** flags it does expose — `canEditStructure` (≈ created-only, used for
add/delete/reorder of questions/options) and `canEditTextFields` (≈ created||published,
used for content edits) — both of which already AND-in `!is_disabled`. There are **no**
question/option/correctness-level flags in the helper, so `QuizEditor` derives the
per-capability table (§9) **locally** from `version.state` + `version.is_disabled`,
using those two primitives. (`canEditTextFields` is literally `created || published`
where each already requires `!is_disabled` — `versionPermissions.ts:16–17,22`.) This
mirrors `ItemEditPage`'s disabled-version read-only branch (`:299–323`).

### 3.6 Invariants & status codes
- **Last correct option (update)**: setting the last `is_correct=true` option of **any**
  choice question to `false` → **422** (`questions.py:217–224`, type-agnostic).
- **Delete has no such guard**: `delete_option` (`questions.py:231–240`) will 204 even
  the only correct option, leaving a 0-correct question that scores everyone 0. The UI
  blocks this client-side (§8.6).
- **single_choice "exactly one correct"** is UI-enforced (radio) and not enforced at the
  mutation endpoints, but **publish does reject `correct_count != 1`** (§3.9).
- **numeric/text correctness** validated only on `update`, not `create`
  (`questions.py:117–120`); the UI requires them at create.
- **precision**: never server-validated, but scoring returns `(0,1)` when
  `precision is None` (`quiz.py:46–47`) → unanswerable. The UI **requires** precision
  (default `0`) and always sends it.
- **Status/detail map** (codes are stable; the UI keys off **status code + the
  `ApiError.displayMessage`**, not literal detail strings — several details are
  f-strings, e.g. the published-field 409 embeds a Python set repr, so the UI surfaces a
  written message, never the raw detail):
  | Condition | Status |
  |---|---|
  | Disabled version, any mutation | 403 |
  | create/delete/reorder outside `created` | 409 |
  | published edit of a disallowed field | 409 |
  | archived-version edit | 409 |
  | option create on a non-choice question | 409 |
  | unset last correct option | 422 |
  | reorder duplicate/incomplete id-set | 400 |

  *Latent row:* the "published edit of a disallowed field → 409" case is **not reachable**
  via the question/option PATCH endpoints — every declared `QuestionUpdate` / `OptionUpdate`
  field is already in its published allowlist, and unknown fields are ignored by Pydantic
  (→ 200 no-op), so the field-level 409 never fires there. (`ItemUpdate` is `extra="forbid"`,
  so an unknown item field 422s at validation.) The reachable published-version 409s are the
  **create/delete/reorder** ones; the UI handles the field 409 only defensively (§10).

### 3.7 Scoring (informational — `backend/mathion/quiz.py`)
- single: 1 pt exact. multiple: `max(0, correct−wrong)` of `count(correct)`.
- numeric: correct iff `|answer − correct| ≤ 5×10^−(precision+1)` (precision 0 → ±0.05;
  2 → ±0.005); needs precision non-None.
- text: case-insensitive, trimmed exact match.
- `max_quiz_attempts` is version-level (`CourseVersion`, 1–10, default 3), authored in
  `VersionMetaForm.svelte` — out of scope.

### 3.8 Recorded-score immutability (drives §8.7)
Scores are computed at submit and persisted to `UserItemState.last_score_correct/total`
(`api/quiz.py:133–134`) against the answer key as it then stood. There is **no
runtime/API re-score path** in the backend (verified by grep) — the only persisted-score
recompute lives in a one-time Alembic migration (`3e7ba736bcd2_phase7c_recompute_quiz_scores`),
which is not a live path. So editing a published quiz's answer key leaves prior attempts on
the old key and new attempts on the new key, silently; dashboards read these frozen
snapshots. §8.7 guards it.

### 3.9 Publish-time completeness validation (server-enforced — `api/versions.py`)
Publishing a version (`POST /api/versions/{id}/publish`, the **existing** version flow —
**not** an endpoint this slice builds) hard-rejects an incomplete quiz with **409**
(`versions.py:206–260`, tested `test_versions.py:192`):
- a quiz with **0 questions**;
- a `single_choice`/`multiple_choice` question with **< 2 options**, or **0 correct**;
- a `single_choice` question whose **correct count ≠ 1**;
- a `numeric_answer` missing **`correct_numeric`** or **`precision`**;
- a `text_answer` missing (blank) **`correct_text`**.

This matters for the slice in two ways: (1) it **corrects** the old "no publish validation"
gap (§11) — the author *cannot* publish a malformed quiz; (2) the editor's author warnings
(§8.1, the 0-question warning) are **early hints that mirror this gate**, not advice the
backend ignores. This slice does **not** implement publish or its error surface (that lives
in the existing version-publish flow, which already shows the 409 detail); it only keeps its
inline warnings aligned with these rules so an author fixes problems before reaching publish.

## 4. Architecture

Render `<QuizEditor>` from a **new dedicated branch** in `ItemEditPage.svelte` (§13 C1) —
**do not** add `quiz` to `editable`. New components follow editor conventions
(`makeDirtyTracker`, `createDirtyRegistry`, `DirtyGuard`, `MarkdownEditor`,
`SequenceAccordion`'s inline-create + reorder patterns).

| Component | Responsibility |
|---|---|
| `QuizEditor.svelte` | Root. Owns the authoritative question list; **loads only the question list** (each `QuestionAccordion` loads its own options, §6); a **quiz-title field** (renames the item) with its own dirty tracker; "＋ Add question" inline create; question add/delete/reorder (serialized via `questionsLocked`, §7.2); a local dirty registry + `quizDirty`; the §8.7 published-edit confirm latch; the non-blocking 0-question empty-quiz warning. |
| `QuestionAccordion.svelte` | One question. Renders its **own** collapsible header (number, type badge, text-snippet from stripped `text_html`, correct-count, ↑/↓, delete, expand toggle) + a body (per-type fields + option list). The per-question **text dirty tracker lives in the component instance** (always mounted as part of the list); only the body DOM (`MarkdownEditor`s) is lazy — `{#if expanded}` — so a collapsed question keeps its draft. |
| `OptionRow.svelte` | One option: inline-editable text, correctness control, ↑/↓, 🗑, visible "✓ correct" marker. Presentational — the text input binds an **accordion-owned** draft + its dirty tracker (§7.1); the row holds no registered state of its own (so a collapsed body can't drop a draft, §4.1). |
| `QuestionTypePicker.svelte` | Type chooser, only in the add-question form. A copy of the `ItemTypePicker` radio-card pattern. |
| `lib/quizAuthoring.ts` | Typed wrappers + authoring types. Matches `lib/evaluations.ts`/`runAssets.ts`/`studentMiniProjects.ts`. |

`QuestionAccordion` does **not** reuse `AccordionHeader` (which requires a `slug`,
renders its `title` verbatim — i.e. raw markdown for a question — and conveys its
disabled-reorder reason via a `title=` tooltip). It implements a small purpose-built
header in the same visual style. `AccordionHeader` is therefore **not** modified.

### 4.1 Component interfaces (props in / callbacks out)
The codebase uses **callback props** (not event dispatch): e.g. `onMoveUp`, `onDelete`,
`$bindable()` values.

```
QuizEditor
  props:  { itemId: number; vid: number; itemTitle: string; version: AdminTreeVersion;
            perms: VersionPermissions; assetContext: AssetContext;
            quizDirty?: boolean (bindable) }
  - itemTitle seeds the quiz-title field (rename via updateItem → PATCH /api/items/{itemId});
    its dirty tracker registers into the same registry and feeds quizDirty.
  - **`vid` = ItemEditPage's LIVE route-derived `vid`** (`ItemEditPage.svelte:21`,
    `Number(versionId)`), passed explicitly — **not** read off `version.id`. `version` is
    the tree's version object and the tree *lags* during navigation (`:33–35`), so a
    `version.id === savedVid` check would miss a nav; the lifecycle guard (§4.1a) must use
    this live `vid`. QuizEditor threads `vid` to each `QuestionAccordion`.
  - version = the tree's version object; perms = versionPermissions(version).
  - assetContext = ItemEditPage's memoized editAssetContext (§4.2), passed down, never
    re-derived here.
  - quizDirty (bindable) ← true whenever any question text tracker is dirty; ItemEditPage
    reads it in its DirtyGuard closure (§7.1).
  - owns the authoritative question list; provides a fresh createDirtyRegistry() via
    context to its accordions.

QuestionAccordion
  props:  { question: AuthoringQuestion; vid: number; index: number; count: number;
            perms: VersionPermissions; assetContext: AssetContext; expanded: boolean;
            confirmKeyChange: (questionId: number) => boolean }
  callbacks: { onExpandToggle(); onDelete(); onMoveUp(); onMoveDown() }
  - `vid` = the same live route `vid` (above), used by this accordion's §10 403/409
    forced-reload recovery guard (`alive && vid === savedVid`).
  - `confirmKeyChange` (from QuizEditor, §8.7) is called synchronously **before** any
    answer-key-affecting mutation — a choice-correctness toggle, or a Save whose body
    changes `correct_numeric`/`precision`/`correct_text`. It returns `false` to abort
    (the toggle/Save is not issued).
  - owns its text dirty tracker (registered into the parent registry on mount). Holds a
    **local working copy of the question's editable+rendered fields** (`text_md`,
    `explanation_md`, `text_html`, `explanation_html`, `correct_numeric`, `precision`,
    `correct_text`) in local `$state`, seeded from the `question` prop on mount. It mutates
    only that local copy + the server, **never the parent `question` prop** (avoids Svelte
    5's `ownership_invalid_mutation`). On every successful PATCH it **updates the local copy
    from the response** (the backend regenerates `text_html`/`explanation_html`,
    `questions.py:109,111`) so the header snippet + preview reflect saved state, and
    `reset()`s the text tracker baseline. The header (number, type badge, snippet,
    correct-count) renders from the local copy. (Seeded **once** on mount — do **not** add a
    `$effect` re-seeding from the `question` prop; that would re-introduce the stale-overwrite
    and ownership-mutation hazards rev 5 removed. The only resync is unmount-on-remove via
    the `q.id` key.)
  - **loads and owns its own options** (finding-2 fix): for choice types it calls
    `listOptions(qid)` from a **tokenized loader run in `onMount`** into local `$state`, with
    a **load status** (`loading | loaded | error`). Borrow only the stale-discard half of
    `AssetSidebar.svelte` — a plain (non-`$state`) `loadToken` bumped per call, a captured
    `myToken`, and a `myToken === loadToken` check before writing results
    (`AssetSidebar.svelte:50–65`) — **plus `onDestroy(() => loadToken++)`**, which
    `AssetSidebar` omits. The bare token bump-on-call only discards a response **superseded
    by a newer load**; it does **not** cover unmount (nothing bumps the token on destroy, so
    `myToken === loadToken` stays true and a late response would write destroyed `$state`).
    The `onDestroy` bump invalidates any in-flight `myToken`, so a response that resolves
    **after the accordion unmounts** (question delete / item-nav) is dropped too. Unlike
    `AssetSidebar` you need **no** `mountDone`-gated reactive-reload `$effect`
    (`AssetSidebar.svelte:69–79` uses `mountDone` solely to skip the pre-`onMount` tick of
    that reload effect): the accordion is keyed by `q.id`, so its `qid` is fixed for its
    whole lifetime — there is nothing to reactively reload, just the one `onMount` load.
    **Retry** is offered **only in the `error` state** (the load has already settled, so no
    fetch is in flight) and simply re-runs the loader (bumping the token). On error the
    options area shows the inline error + Retry and **all** its option controls are read-only
    until a successful load — never represented as an empty list (the parent never passes
    options, so failure can't be confused with "no options"; §6). numeric/text accordions
    skip the fetch.
  - **owns each option's text draft + dirty tracker** (finding-4 placement fix). Because
    the accordion instance is always mounted (only its `{#if expanded}` body / `OptionRow`s
    are lazy), keeping the per-option drafts here — a `Map<optionId, { draft, tracker }>`,
    reconciled with the loaded option ids and registered into the dirty registry on this
    instance — means an uncommitted option-text draft survives **collapse** and feeds
    `quizDirty`. Putting the tracker in the body-only `OptionRow` (rev 8) would unregister it
    on collapse, dropping the draft signal. The `OptionRow` only `bind:`s the draft (above).
  - the parent is not notified of content changes (it tracks only metadata + order +
    count). A parent-side question-list resync (reorder error) re-fetches `listQuestions`
    (whose fresh `text_html` the keyed-by-`q.id` child intentionally ignores — the reorder
    itself changed only `order`); per the existing editor convention a concurrent-admin
    content edit to the same
    question does not auto-resync into a mounted accordion (navigate away/back — matches
    `ItemEditPage.svelte:115–116`).

OptionRow  (presentational — owns NO registered state)
  props:  { option: AuthoringOption; draft: string (bindable); index: number;
            count: number; questionType: QuestionType; perms: VersionPermissions;
            busy: boolean; optionsLocked: boolean; canDelete: boolean }
  callbacks: { onToggleCorrect(next: boolean); onCommitText(); onDelete();
               onMoveUp(); onMoveDown() }
  - `optionsLocked` (**accordion-wide**, §7.2/§8.2/§8.4) disables **every** structural
    option control — correctness toggle, delete, ↑/↓ — while **any** of the question's
    option mutations (correctness PATCH, create, delete, reorder) is in flight. This
    mutual exclusion prevents both the concurrent last-correct race **and** the
    delete-the-old-correct-mid-switch race (§8.4): while a single_choice switch is setting
    the new correct option, the old one must not become deletable and get deleted before
    the switch commits — the guard-less backend DELETE (`questions.py:231`) would otherwise
    permit a persistent 0-correct question. `busy` (per-row) is kept only for the row's own
    spinner/affordance; gating uses `optionsLocked`.
  - **option-text is dirty-tracked, but the draft + tracker live in the accordion**
    (finding-4 fix; placement corrected from the rev-8 self-registering row). The row's
    text input `bind:`s the accordion-owned `draft`; the accordion holds the
    `makeDirtyTracker` (draft vs. committed `option.text`) **registered into the dirty
    registry on the always-mounted accordion instance** (§7.1) — so an uncommitted draft
    feeds `quizDirty` even while the question is **collapsed** (the `{#if expanded}` body /
    `OptionRow` is unmounted then) and during the type→blur→PATCH window; nav/item-delete
    is caught (DirtyGuard / §7.1), not silently lost. Blur → `onCommitText` → the accordion
    `updateOption`s; on success the committed value updates the local option + resets that
    option's tracker baseline; on failure the draft stays dirty with an inline error.

QuestionTypePicker
  props:  { value: QuestionType (bindable) }   // mirrors ItemTypePicker's $bindable() value
```

Data-ownership: **`QuizEditor` owns the question list** (metadata + order); question
add/delete/reorder are QuizEditor's, performed on its own array. **`QuestionAccordion`
loads and owns its question's options + the question-text draft + each option-text draft,
all in local `$state`** (own `listOptions` fetch + load status + eager option mutations,
local updates) and reports dirtiness up via the registry — it does not mutate the parent
prop. The `{#each questions as q (q.id)}` list is **keyed by `q.id`** so reordering the
array preserves each accordion instance (and its local options). `QuizEditor` itself is
wrapped in **`{#key item.id}`** by `ItemEditPage` (§4.1a) — stable across a same-item
`loadAdminTree` refresh, fully reset on item navigation.

### 4.1a Lifecycle & stale-response guard
`ItemEditPage` is **reused** across `/items/:itemId` routes — it is *not* remounted; it
re-derives via `$effect` and pins async work by id (`ensureLoaded`'s `trackerIid !== iid`
rebuild, `save`/`deleteItem`'s id-pinning at `ItemEditPage.svelte:117,131,216`). A
persistent `QuizEditor` would inherit that hazard (a slow load for quiz A overwriting
quiz B after navigation, or stale internal state), so it is wrapped in **`{#key item.id}`**:
an item navigation remounts it — resetting **all** editor `$state` (questions, expansion,
per-question errors, the dirty registry, the §8.7 confirm latch, the quiz-title tracker,
and the empty-quiz warning) — while a same-item `loadAdminTree` refresh (item.id
unchanged) does not remount it (props update in place, preserving the loaded list). As
defense for a load that resolves after unmount or is superseded by a newer load, **both**
async surfaces use the stale-discard half of the codebase's tokenized loader
(`AssetSidebar.svelte:50–65`): a plain (non-`$state`) `loadToken` bumped at call-start, a
captured `myToken`, and a `myToken === loadToken` check before writing results, run from
`onMount` — **plus `onDestroy(() => loadToken++)`** (which `AssetSidebar` lacks). The
call-start bump alone discards only a *newer overlapping* load; **unmount needs the
`onDestroy` bump** to invalidate any in-flight `myToken`, otherwise a late response would
write the destroyed instance's `$state`. (Because both components are keyed — `QuizEditor`
on `item.id`, each `QuestionAccordion` on `q.id` — item/question navigation *destroys* the
instance rather than reusing it, so a same-`itemId` match check on a dead instance would
not catch this; the `onDestroy` token bump is what actually drops the late write.) Neither
surface needs `AssetSidebar`'s `mountDone`-gated reactive-reload `$effect`
(`AssetSidebar.svelte:69–79`, where `mountDone` only skips the pre-`onMount` tick of that
reload effect): the keyed `itemId`/`qid` are fixed for the component's lifetime, so there is
nothing to reactively reload — just the one `onMount` load.

**Mutation continuations + forced reloads are guarded too** (not just the loaders). Every
mutation handler `await`s a network call and then (a) writes local `$state` and/or (b) calls
`loadAdminTree(vid, { force: true })` (after add/delete **question** for `questions_count`,
the quiz-title rename, and 403/409 recovery — §6/§8/§10). Both continuations need the
editor's existing lifecycle/identity guard, **not** the loader token: a forced reload
**advances the store token unconditionally** (`currentEditorVersion.svelte.ts:44`; the
`!opts.force` dedup at `:41` is bypassed), so an old force-reload of the *previous* vid that
fires *after* the user navigated would overwrite the new route's tree. Mirror
`BlockAccordion.svelte:85–103`: keep `let alive = true; onDestroy(() => alive = false)`, pin
`savedVid`/`savedIid` at call-start, and gate both the post-`await` local write **and** the
forced reload on `alive && vid === savedVid`. The `vid` here is the **live route `vid`
prop** (§4.1, from `ItemEditPage.svelte:21`) — **not** `version.id`: during navigation the
tree (hence `version`) lags (`:33–35`), so `version.id` would still equal `savedVid` and the
guard would miss the nav (exactly how `BlockAccordion` relies on its live route-`vid` prop,
`:96`). The `alive`/`onDestroy` flag covers the post-nav *destroy*, but there is a window
between the route changing and `{#key item.id}` tearing the instance down (item.id is
tree-derived, so it flips only after the new tree loads) in which a continuation can still
fire — the live-`vid` comparison is what catches a forced `loadAdminTree` in that window
before it advances the **global** store token.

### 4.2 AssetContext (resolved)
`ItemEditPage` builds `editAssetContext = $derived(courseAssetContext(vid))`
(`ItemEditPage.svelte:24`), memoized for stable identity (`:22–23`). `QuizEditor`
receives it as the `assetContext` prop and threads it to each `MarkdownEditor`
(`MarkdownEditor`'s `assetContext` is required, `MarkdownEditor.svelte:23`). It must
**not** call `courseAssetContext()` itself.

## 5. Data types (frontend)

`lib/quizAuthoring.ts` (authoring types — separate from the correctness-stripped student
`Question` union):

```ts
type QuestionType = 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer';

interface AuthoringOption { id: number; question_id: number; text: string;
  is_correct: boolean; order: number; }

// Mirrors the flat QuestionResponse — options are NOT embedded (§3.4); each
// QuestionAccordion fetches/owns its own options (§4.1, §6), not this prop.
interface AuthoringQuestion {
  id: number; item_id: number; text_md: string; text_html: string; type: QuestionType;
  order: number; explanation_md: string | null; explanation_html: string | null;
  correct_numeric: number | null;   // JSON number on the wire (float-safe subset, §8.3)
  precision: number | null; correct_text: string | null;
}
```

`correct_numeric` is a **number** on read. The numeric form parses its text input to a
number, validates (§8.3), and sends a number (or trimmed numeric string — Pydantic
coerces). Wrapper functions (so `quizAuthoring.test.ts` has a defined surface):
`listQuestions(itemId)`, `createQuestion(itemId, body)`, `updateQuestion(qid, body)`,
`deleteQuestion(qid)`, `reorderQuestions(itemId, order)`, `listOptions(qid)`,
`createOption(qid, body)`, `updateOption(oid, body)`, `deleteOption(oid)`,
`reorderOptions(qid, order)`, and `updateItem(itemId, { title })` (rename) — thin `api.*`
calls returning typed responses.

## 6. Data loading & state ownership

`loadAdminTree` (used by `ItemEditPage`) carries only `questions_count`. Loading is
**split by owner** (§4.1):
- **`QuizEditor`** loads only the **question list**: `listQuestions(itemId)` sorted by
  `order`. It does **not** fetch options (so it never has to pass an option-load status it
  can't represent).
- **Each `QuestionAccordion`**, on instance mount, loads **its own** options for choice
  types: `listOptions(qid)` sorted by `order`, owning a `loading | loaded | error` status.
  numeric/text accordions never fetch (no options). A `listOptions` **reject** puts that one
  accordion in **error** (distinct from a successfully-loaded empty list — the whole point
  of finding-2's move): its option controls are read-only with an inline error + **Retry**
  (re-issues `listOptions`) until it succeeds. This isolates a single fetch failure to its
  own question, and prevents unsafe option creation, wrong correct-counts, and an incomplete
  reorder id-set (`questions.py:252` requires the full server id-set). Because every
  accordion instance mounts (collapsed rows included, so the header correct-count is right),
  all options still load on editor open — the same N+1, now distributed and self-owned.

**State rule.** Authoritative state is split (§4.1): QuizEditor's **question list**
(metadata + order) and each mounted accordion's **local options `$state`** (+ its load
status). Each mutation updates its owner in place from the response:
- add question → QuizEditor appends the `createQuestion` response (flat `QuestionResponse`,
  no options); the new accordion mounts and loads its own (empty) options.
- delete question → QuizEditor removes it from the list.
- reorder question → QuizEditor applies locally, POST `…/reorder`; on error re-fetch
  `listQuestions` to resync.
- *(all three question-list mutations run under the QuizEditor-wide `questionsLocked`,
  §7.2 — serialized so two rapid reorders can't commit out of order against the unserialized
  endpoint `questions.py:139`.)*
- add option → the accordion appends the `createOption` response to its local options.
- delete option → the accordion removes it from its local options.
- reorder option → the accordion applies locally, POST `…/reorder`; on error re-fetch
  that question's options.
- toggle correctness / save text / edit option text → apply the PATCH response in place
  (question text → accordion's text tracker; options → accordion's local options).
- **error/resync write-back**: on any option error (422/409/network), the owning
  `QuestionAccordion` calls `listOptions(qid)` and replaces **its own local options
  `$state`** — no parent notification needed (the parent doesn't track option detail).

A scoped re-fetch happens **only** to recover from an error. The happy path never
re-runs the N+1. After add/delete **question**, QuizEditor also calls
`loadAdminTree(vid, { force: true })` so the item row's `questions_count` stays correct —
**under the §4.1a `alive && vid === savedVid` guard** (a forced reload advances the store
token unconditionally, so an unguarded late call would clobber a newer route's tree);
because QuizEditor is keyed on `itemId` (not the tree, §4.1a), the same-item refresh updates
props without remounting it.
(If a concurrent publish flipped `state`, the refreshed `perms` re-gate the UI; the
loaded question list is not auto-refetched — a subsequent mutation that 409s triggers a
resync per §10.)

## 7. Save model

- **Per-question text fields** — `text_md`, `explanation_md`, and (numeric/text)
  `correct_numeric`+`precision` / `correct_text` — a **dirty-tracked form** with explicit
  **Save / Discard** via `makeDirtyTracker`, like `VersionMetaForm.svelte`. Save →
  `updateQuestion`.
- **Options & structure** — add/delete/reorder question, add/delete/reorder option,
  toggle correctness, edit option text — **eager** (immediate call, like
  `SequenceAccordion`).

### 7.1 Dirty aggregation & DirtyGuard
`ItemEditPage` is a standalone route, so the `DIRTY_REGISTRY_KEY` context (set only in
`VersionEditPage`) is absent. Therefore:
- `QuizEditor` creates its **own** `createDirtyRegistry()` (`dirtyRegistry.svelte.ts`) and
  provides it via context.
- Each `QuestionAccordion` registers its text tracker in an `$effect` **on mount**
  (cleanup unregisters), **not** gated on `expanded` — a collapsed question with unsaved
  text must still count as dirty. The registered value satisfies `{ readonly isDirty }`
  (a `makeDirtyTracker` does).
- The **`QuestionAccordion`** (not the body-only `OptionRow`) owns each option's text
  draft + tracker — a `Map<optionId, { draft, tracker }>` reconciled with the loaded option
  ids via an `$effect` and registered into the registry on the always-mounted accordion
  instance (§4.1, finding-4 placement fix). Because it lives on the accordion, an
  uncommitted option-text draft stays dirty and feeds `quizDirty` even while the question is
  **collapsed** (the `OptionRow` is unmounted then) and through the type→blur→PATCH window —
  so a nav/item-delete can't drop it. `OptionRow` only `bind:`s the draft. (Option
  *correctness*/add/delete/reorder stay eager and are not dirty-tracked; they commit
  immediately, so there is no draft to lose.)
- `QuizEditor` writes the `$bindable quizDirty` from `registry.isAnyDirty()` via an
  `$effect`. This is load-bearing and relies on two reactivity facts: (a)
  `createDirtyRegistry` is backed by a `SvelteSet` (`dirtyRegistry.svelte.ts`), so
  register/unregister (membership) is reactive; (b) each registered value is a
  `makeDirtyTracker`, whose `isDirty` getter reads `$state`, so `isAnyDirty()`'s per-member
  reads make the `$effect` re-run when any tracker flips. Both the question-text trackers
  and the hoisted option-text trackers (§4.1) register into this one registry, so any of
  them dirtying propagates to `bind:quizDirty` and the page DirtyGuard. (`ItemEditPage`
  declares `let quizDirty = $state(false)` and `bind:`s it — §13.)
- The page `tracker` (`ItemEditPage.svelte:48–49`, `StaticForm | VideoForm | null`)
  **stays `null` for quizzes** (already so, `:123`); the static/video casts (`:69,:87,…`)
  are guarded by `item.type` checks and never reached for a quiz.
- `ItemEditPage.svelte:355` becomes `isDirty={() => (tracker?.isDirty ?? false) || quizDirty}`.
- The existing **item-level** gates that read `tracker?.isDirty` — `deleteItem`
  (`ItemEditPage.svelte:214`) and the "Delete this item" button's `disabled` — must also
  include `|| quizDirty`, so unsaved question/title edits block whole-item delete, matching
  the editor's existing dirty-blocks-delete convention (the page `tracker` is `null` for
  quizzes, so without this the quiz dirty state is invisible to the item-delete gate). The
  button's disabled-reason text (`:344`, today keyed on `tracker?.isDirty`) should also
  reflect `quizDirty` so the reason isn't blank when only a question/title edit is unsaved.
- **Reset `quizDirty` on item navigation.** `quizDirty` is **page-owned** and only written
  by the `{#key item.id}`-keyed `QuizEditor`; destroying that child (navigating to another
  item) does **not** reset the parent boolean, so a stale `quizDirty=true` from a
  just-dirtied quiz would keep DirtyGuard + item-delete blocked on the *next* (e.g.
  static/video) item. So `ensureLoaded`'s per-item rebuild block — the
  `trackerIid !== iid` branch at `ItemEditPage.svelte:117–126`, which already nulls
  `tracker` for non-editable types — must **also** `quizDirty = false`. For a quiz target
  the remounted `QuizEditor` immediately re-derives it from its (fresh, empty) registry; for
  a non-quiz target it stays `false`.

### 7.2 Partial-persistence rule (symmetric)
Two locks per question:
- **`optionsLocked` (accordion-wide)** — set whenever **any** of the question's option
  mutations (correctness toggle, create, delete, reorder, **or an option-text blur-commit**)
  is in flight, and it disables **all** of them for that question. This mutual exclusion
  closes the concurrent last-correct race (§8.2), the delete-old-correct-mid-switch race
  (§8.4), **and** the text-vs-correctness overwrite race: both PATCHes return the full
  option row (`questions.py:198`, `schemas.py:316`), so an out-of-order text/correctness
  pair could write stale `is_correct`/`text` back into local state. As a backstop, every
  option-mutation handler applies its response **only if still current** (the option still
  exists locally and no newer mutation for it has resolved). The blur-before-click path is
  covered: a text-commit fired on blur holds the lock, so the following correctness click is
  disabled until it settles.
- **Text ↔ option two-way lock** — the option/structure controls are also disabled while
  that question's **text form is dirty**, AND the text inputs are disabled while
  `optionsLocked` (an eager option mutation is in flight). This prevents a half-applied
  question (unsaved text + an eagerly-saved toggle).

Editing question A's *options* never blocks question B's options. (Deleting a question is
the exception — see §8.8.) Every eager mutation clears its lock — per-row `busy` **and** the
accordion-wide `optionsLocked` — in a `finally` (the editor convention, e.g.
`SequenceAccordion`/`ItemEditPage`), so an errored option mutation never leaves the text
inputs or the option controls permanently disabled. For the single_choice multi-call
sequence (§8.4) the `finally` wraps the **whole** sequence, not each call.

**`questionsLocked` (QuizEditor-wide)** — the question-*list* structural mutations
(add/delete/reorder **question**) are themselves eager and need their own mutual exclusion,
separate from the per-question `optionsLocked`. Two rapid reorder calls have no backend
serialization and the endpoint returns no authoritative ordering (`questions.py:139`), and
successful reorders are not resynced (§6), so overlapping calls could commit in reverse and
leave local state disagreeing with the server. So a single `questionsLocked` flag (set
while any add/delete/reorder-question call is in flight, cleared in `finally`) disables all
of QuizEditor's question-list structural controls — mirroring the existing shared-`busy`
propagation in `SequenceAccordion.svelte:302` (`busy || createBusy || parentBusy`). It does
**not** block per-question option/text edits (those have their own `optionsLocked`).

### 7.3 Rationale
The hybrid matches existing conventions and avoids multi-call option-diff orchestration.
The "one Save per question batching options" alternative was rejected for this slice.
(Approved by user 2026-06-21.)

## 8. Per-type editing UI + validation

**Quiz title.** At the top, `QuizEditor` shows a **quiz-title** input bound to the item's
`title`, editable when `canEditTextFields` (title is in `_ITEM_EDITABLE_PUBLISHED`, so
editable in created **and** published, read-only when archived/disabled), with its own
`makeDirtyTracker` + Save/Discard. Save → `updateItem(itemId, { title })`, **then
`loadAdminTree(vid, { force: true })`** (like `ItemEditPage.save`) so the page heading —
rendered from the tree's `item.title` (`ItemEditPage.svelte:265`) — and the tree refresh;
the title tracker then `reset()`s to the saved value. Both the post-`await` tracker
`reset` and the forced reload run under the §4.1a `alive && vid === savedVid` guard
(`savedVid`/`savedIid` pinned before the PATCH). (item.id is unchanged, so the
`{#key item.id}` does not remount.) Its tracker is registered in the dirty registry, so a
rename contributes to `quizDirty`. Renaming does not affect scoring, so it is **not**
§8.7-guarded. Title PATCH can 422 (empty/letterless title) or 409 (slug collision);
handled via the field's own Save error like the existing rename path (§10).

Each **expanded** question body shows a read-only type badge, a `MarkdownEditor` for
`text_md`, a `MarkdownEditor` for optional `explanation_md`, then per-type fields. Only
the expanded question mounts its editors (the dirty tracker persists in the instance,
§4).

### 8.1 single_choice — see §8.4 for the correctness state machine
- Radio correctness (UI enforces exactly one correct).
- Non-blocking inline warning if < 2 options — an **early hint mirroring the §3.9 publish
  gate** (a `created`-version edit isn't blocked, but publish 409s on < 2 options). The
  exactly-one-correct rule the UI enforces also matches the publish gate.

### 8.2 multiple_choice
- Non-blocking inline warning if < 2 options — the same early hint as §8.1, mirroring the
  §3.9 publish gate (`versions.py:224` rejects < 2 options for **both** choice types).
- Checkbox correctness; ≥ 1 correct. Toggling is optimistic and gated by the **accordion-wide
  `optionsLocked`** (§7.2): one in-flight option mutation disables **all** of that
  question's option controls. A **per-option** lock would let a single user uncheck two
  currently-correct options concurrently; the backend's last-correct check (mutate one
  option, then count correct, then commit — `questions.py:213`, no row/question lock) can
  let both requests pass and leave **0** correct. The accordion-wide lock serializes a
  single client's option mutations so the second sees the first's result. (The residual cross-client race — two admins / API callers — is a
  pre-existing backend concurrency gap, §11.) Unchecking the last correct option → 422 →
  inline message + revert by re-fetching the question's options (§6 write-back).

### 8.3 numeric_answer
- No options. `correct_numeric` (text input → number) + **required** `precision`
  (integer 0–10, default 0). Helper text shows the tolerance for the current precision
  (precision 0 → ±0.05) and is shown **before** the author edits (so the default-0
  consequence is visible). Accepted grammar: optional sign, decimal, scientific (`1e3`, `1.5e-20`).
- **Validate the EXPANDED scale, but compute it arithmetically — never materialize a huge
  string.** Scientific notation hides the true scale (`1.5e-20`'s literal shows 1 fractional
  digit but the value has 21; `1e3`'s literal shows none but the value has 4 integer
  digits), so the bounds must be checked against the expanded value. But expanding the
  literal first is a client-side DoS: the backend accepts unrestricted `Decimal` syntax
  (`schemas.py`), so `1e-1000000000` would allocate a billion-char string. Instead: (1) an
  up-front **sanity cap** — reject if the raw input length or `|exponent|` is implausibly
  large (e.g. exponent magnitude > 40, comfortably past the column's 10/10 range); then
  (2) from the parsed sign / mantissa digits / decimal-point position / exponent, compute
  the **integer-digit and fractional-digit counts arithmetically** (shift the point by the
  exponent with integer math, no string build) and reject **> 10 fractional digits** /
  **|value| ≥ 10^10** (> 10 integer digits) — both bounded by the DB `Numeric(20,10)` column
  (`models.py:135`; the request schema adds no bound, so the UI must) — and **> 15
  significant decimal digits** (next bullet). Only a value that passes all three is then
  materialized as a plain decimal string (now provably ≤ 20 digits) for the request.
- **Float-safe bound (resolves the read-back precision footgun).** Reject expanded values
  with **> 15 significant decimal digits**. The response serializes `Decimal`→`float`
  (`schemas.py:300`, §3.4), and `float`/JSON `number` (IEEE-754 `double`) only round-trips
  ≤ 15 significant digits losslessly; a 16–20-digit value the DB would accept reads back
  altered (`9999999999.9999999999`→`10000000000.0`, which also violates the < 10^10 bound
  and silently changes the key). Capping significant digits keeps DB → response → editor →
  re-save lossless. Purely a UI validation (no backend change, slice stays frontend-only)
  and far beyond any realistic quiz answer. **Significant digits** are counted on the
  expanded decimal after stripping the sign, the decimal point, and leading zeros plus
  fractional-only trailing zeros (`0.0500`→`5`; `1200`→`4` — trailing integer zeros are
  significant for the `Numeric` value). Do **not** gate on a `String(Number(input)) ===
  input` round-trip: it wrongly rejects valid scientific input (`String(Number('1e3'))` is
  `'1000'`) and wrongly accepts out-of-frac-bound values (`1.5e-20`) — exactly why every
  bound runs on the expanded form.

### 8.4 single_choice correctness state machine
- **First option** in an empty single_choice list → POST `is_correct=true`. Subsequent →
  `false`.
- **Clicking radio X** (one general rule):
  - **No-op** only if X is already the **unique** correct option
    (`correctCount === 1 && X.is_correct`).
  - Otherwise make X the sole correct: `updateOption(X, true)` **first** (awaited; skip if
    already true), **then** `updateOption(Y, false)` for **every other** currently-correct
    option Y. Awaiting the set-true before any set-false means the correct count never
    reaches 0, so the last-correct 422 cannot fire (do **not** fire these in a parallel
    `Promise.all`).
  - This single rule covers: the normal **switch** (1 correct → set new true, unset old);
    **repairing a transient 2-correct state** (X already true → just unset the other
    correct option — so a stuck 2-correct question is always fixable by clicking either
    radio, including in published versions where delete is unavailable); and the
    **0-correct** case (set X true, nothing to unset).
- **Confirm wraps the whole sequence** (§8.7): `confirmKeyChange(qid)` is called **once,
  synchronously, before `updateOption(X, true)`**; on `false` the **entire** radio sequence
  (set-true and every set-false) is skipped — no partial mutation. The per-question latch
  means the multi-call sequence prompts at most once.
- **In-flight lock**: the question's **`optionsLocked` (accordion-wide, §7.2)** is set
  **before** the sequence and **cleared in a `finally` after the whole sequence**, so during
  the switch the radio group **and** every option's delete/↑/↓ are disabled, then never left
  disabled if a call throws. Locking delete too is essential: optimistic correctness shows
  the new option as correct before its PATCH commits, which would otherwise make the *old*
  correct option look deletable — deleting it then while the set-true PATCH is still pending
  (or fails) would leave a persistent **0-correct** question, since the backend DELETE has no
  last-correct guard (`questions.py:231`).
- **Partial failure** (e.g. a set-false fails after set-true succeeded) → re-fetch the
  question's options to resync (may transiently show 2 correct) + inline error; `optionsLocked`
  still clears in the `finally`; the author retries — because the rule above no longer
  no-ops a non-unique correct radio, clicking either correct option re-runs the rule and
  unsets the extra.

### 8.5 text_answer
- No options. `correct_text` (non-empty after trim, **≤ 500 chars** per the DB
  `String(500)` column, `models.py:139` — the request schema adds no bound, so the UI
  must); helper notes case-insensitive, trimmed matching.

### 8.6 Options (choice types): create, delete, visibility
- `OptionRow`: text input bound to the accordion-owned draft (§4.1/§7.1), correctness
  control, ↑/↓, 🗑, and a **visible "✓ correct" marker** (not color-only) so an author can
  read the key at a glance. The header shows the correct-count. **Option text commits on
  blur**: blur → `onCommitText` → the accordion `updateOption`s **under `optionsLocked`**
  (§7.2 — a text-commit is an option mutation, so it mutually excludes correctness/structure
  and the response is applied only if still current), then resets that option's tracker on
  success. A **> 500-char** draft (DB `String(500)`) or a **whitespace-only** trim
  (`min_length=1`) **blocks the blur-commit** — counter turns red, no PATCH issued, the
  draft stays dirty until corrected.
- **"＋ Add option"** uses an inline create input (like `SequenceAccordion`'s item
  create): author types text → **trim → reject whitespace-only client-side** →
  `createOption(qid, {text, is_correct})`. This avoids the empty POST (`min_length=1`)
  and id reconciliation (POST returns the id). `is_correct` per §8.4. Duplicate option
  texts are allowed by the backend (scoring is by id); the UI does not block them.
- **Delete guard (resolves C2)**: deleting an option is **blocked client-side when it is
  the last remaining correct option** of its question (the backend's delete has no such
  guard, `questions.py:231`). The author must first mark a different option correct. If the
  option is the question's only option, deletion is allowed (leaving an incomplete question,
  consistent with the §8.1 / §11 non-blocking warnings). `OptionRow.canDelete` encodes this:
  `canDelete = count(options) === 1 || !(option.is_correct && correctCount === 1)` —
  deletable if it is the only option, OR it is not the last remaining correct one.
  **Independently, delete/add/reorder are disabled while `optionsLocked`** (§7.2/§8.4): the
  `canDelete` formula reads `is_correct`/`correctCount` from *local* state, which is
  optimistically ahead of the server during a correctness switch, so the accordion-wide lock
  — not `canDelete` alone — is what prevents deleting the soon-to-be-non-correct option
  before its set-true commits.

### 8.7 Published answer-key safety (resolves the silent-rescore footgun)
Edits to `is_correct` / `correct_numeric` / `correct_text` / **`precision`** (all
answer-key-affecting — precision changes the scoring tolerance) are allowed in a
**published** version but **do not re-score existing attempts** (§3.8). Guard: the
**first** answer-key-affecting mutation to a given question **in a published version,
per editor mount** fires a `window.confirm()` (the editor's existing destructive-action
convention — cf. `ItemEditPage.deleteItem`, `DirtyGuard`): *"This quiz is published.
Changing the answer key does not re-score students who already attempted — their recorded
scores keep the old key. To re-grade everyone, create a new version instead. Continue?"*
The latch is **per question, per mount**, checked before the first mutating call —
whether that's an eager choice-correctness toggle or a Save that touches a key field
(incl. precision). Text/explanation edits (non-scoring) are not guarded.

This is implemented as **`QuizEditor.confirmKeyChange(questionId): boolean`**, passed to
every `QuestionAccordion` (§4.1). It returns `true` immediately if the version is not
published, or if this question's latch already fired this mount; otherwise it fires the
`window.confirm()` and, on confirm, records the latch (a `Set<questionId>` reset by the
`{#key item.id}` remount) and returns `true` — on cancel it returns `false`. The accordion
calls it before issuing the toggle/Save and aborts on `false`. (The accordion needs this
callback rather than just `perms`: `canEditTextFields` is identical for created and
published, so the accordion alone cannot tell it is published.)

*Rejected alternative:* forbidding answer-key edits in published versions entirely. Not
chosen — the backend permits them (`_QUESTION_EDITABLE_PUBLISHED` includes the key
fields), and forbidding them in the UI would leave a teacher who finds a genuinely wrong
key (marked the wrong option correct) with no in-product fix and force a new version even
for a clear error. The confirm-with-guidance lets the author choose fix-in-place vs.
new-version, which suits a single-author tool.

### 8.8 Type immutability, delete-question, and the published dead-end
- Type is chosen only in the add-question form, read-only thereafter.
- **Delete question** is allowed regardless of dirty state (you're discarding it):
  `window.confirm()`, then unregister its tracker + remove from the list. In a `created`
  version this is also the only way to "retype" a question (delete + recreate; the
  confirm notes the question's options/text are lost).
- **Published dead-end**: in a published version a question can be neither retyped nor
  deleted (delete is created-only). A mistyped published question is surfaced as a
  read-only note ("type can't be changed; create a new version to replace it"). §11.

## 9. Version-gating capability table

`QuizEditor` derives flags **locally** from `version.state` + `version.is_disabled`
(reusing `versionPermissions`'s `canEditStructure` / `canEditTextFields` primitives,
§3.5). Disabled OR archived → whole editor read-only (mirrors `ItemEditPage:299–323`).

| Capability | created | published | archived / disabled |
|---|---|---|---|
| Add / delete / reorder question | ✅ | ❌ | ❌ |
| Add question (type picker) | ✅ | ❌ | ❌ |
| Edit question text / explanation | ✅ | ✅ | ❌ |
| Edit numeric/text correctness (§8.7 confirm in published) | ✅ | ✅ | ❌ |
| Add / delete / reorder option | ✅ | ❌ | ❌ |
| Edit option text | ✅ | ✅ | ❌ |
| Toggle option correctness (§8.7 confirm in published) | ✅ | ✅ | ❌ |

Disabled controls use a `disabled` attribute plus a short reason, following the existing
editor's affordances (§10a). The UI never issues a call the backend would reject; backend
rejections are still handled defensively (§10).

## 10. Error handling

- Mutating calls surface `ApiError.displayMessage` inline near the control (mirrors
  `SequenceAccordion`'s `mapCreateError`, `lib/formErrors.ts`; the single-field option
  PATCHes here avoid nested-`loc` ambiguity).
- **403** (disabled) / **409** (state/field/non-choice) → inline message at the offending
  control + a **guarded `loadAdminTree(vid,{force})` re-gate** (refreshes
  `version`/`state` → `perms` through the prop chain) for **every** origin, all **under the
  §4.1a `alive && vid === savedVid` guard**. What each origin reloads *in addition* depends
  on what its mutation could leave stale (no cross-component callback is needed for any):
  - **Question-list structural** (add/delete/reorder question — QuizEditor): also re-run
    QuizEditor's own `listQuestions` (the list/order may be stale).
  - **Per-question text/key Save** (`updateQuestion` — accordion, `questions.py:90`):
    nothing extra. The Save form keeps its dirty draft + inline error; the re-gate makes the
    field read-only if the version is now archived/disabled. The question still exists, so no
    list or option reload.
  - **Quiz-title rename** (`updateItem` — QuizEditor, `items.py:101`): nothing extra — the
    title field's own Save error (§8) + the re-gate; the heading/tree refresh a *successful*
    rename does is simply skipped.
  - **Option-level** (correctness/text/create/delete/reorder option — accordion): also
    re-fetch the accordion's **own** options (`listOptions`, the §6 write-back). The
    accordion calls `loadAdminTree(vid,{force})` itself (global store fn; it has the live
    `vid`).

  No origin calls `QuizEditor.listQuestions` from the accordion, so no `onRecoverQuestions`
  callback is required (the admin tree carries no question rows anyway — only
  `questions_count`, `content.py:164`). (Mirrors `ItemEditPage.deleteItem`'s catch,
  `:229–232`.) For the published-field 409 the UI shows a written message (never the raw
  set-repr detail). A bare **404** on an option mutation — the **option (or its question)**
  was deleted out-of-band (the option is resolved first, `questions.py:35`) — falls under
  the existing concurrent-admin convention: navigate away/back (§4.1, §11,
  `ItemEditPage.svelte:115`), not auto-recovered.
- **422** (last-correct) → inline on the option control; revert via §6 write-back.
- **400** (reorder dup/incomplete) → defensive only (the happy path sends a full
  sequential deduped `order`); inline message + resync.
- **Per-question `listOptions` failure** (initial load or a Retry) → that question enters
  the **option-load-error** state (§4.1/§6): its option area renders read-only with an
  inline error + Retry, never as an empty list; other questions are unaffected.
- Network/abort on a per-question Save → form stays dirty, error shown, retry possible.

### 10a. Accessibility
Following `evaluations-write-surface`'s accessibility section, scaled to this surface:
- Every input has a `<label>`; numeric/text correctness inputs use `aria-required` +
  `aria-describedby` → helper/tolerance text.
- single_choice options are a **radiogroup** (`<fieldset>`+`<legend>`=the question);
  multiple_choice options are labeled checkboxes. Correctness is conveyed by control
  state **and** the visible "✓ correct" marker (never color alone).
- Reorder ↑/↓ buttons have `aria-label`s; order changes announce via an
  `aria-live="polite"` region. Validation errors use `role="alert"`.
- **Focus management** (matching the prior slice's depth): after **add question** →
  focus the new question's first field; after **delete question/option** → focus the
  sibling row (prev if last); on **expand** → focus the body's first field; after a
  per-question **Save** → focus returns to the question header. Use `tick()` before
  moving focus (the prior slice's pattern).
- Note: this slice does **not** blanket-forbid `title` tooltips (the surrounding editor
  uses them for disabled-reorder hints, and teacher-monitoring §3.1.6 deliberately keeps
  them); it requires that *essential* validation/disable reasons are ALSO conveyed via
  visible text / `aria`, not via `title` alone.

## 11. Known gaps accepted (not blocking)

- **Completeness is enforced at publish, not continuously**: a `created` version can hold
  a transiently-malformed quiz (0 questions, < 2 options, 0/≠1 correct, a numeric question
  missing `correct_numeric` **or `precision`**, a text question missing `correct_text`)
  while the author is mid-edit. That is fine — **publish hard-rejects
  it with 409** (§3.9, `versions.py:206–260`); the editor's inline warnings (§8.1, the
  0-question warning) are early hints mirroring that gate. (Earlier revisions wrongly listed
  this as "no publish validation" — corrected in rev 12.)
- **No re-scoring** after published answer-key edits (§3.8); mitigated by §8.7, not
  eliminated.
- **Published type dead-end** (§8.8).
- **single_choice "exactly one correct"** is UI-only at the mutation endpoints; an
  out-of-band API caller could create a ≠1-correct question while editing — but **publish
  rejects it** (§3.9), so it can't reach students.
- **Concurrent correctness mutations across clients** can still race the backend's
  last-correct check (mutate → count → commit with no row/question lock,
  `questions.py:213`) and leave 0 correct. The UI serializes a single client's toggles
  per question (§8.2/§8.4), but two admins / API callers editing the same question at once
  are not protected — a pre-existing backend concurrency gap (a `SELECT … FOR UPDATE` /
  Phase-9 item), out of scope for this frontend-only slice.
- **No max question/option count** (backend imposes none); fine at expected sizes (the
  §6 N+1 assumes a handful).
- **↑/↓ reorder only** (no drag / move-to-top), matching the existing editor.

## 12. Testing

Component tests via `mount` / `unmount` / `flushSync` from `svelte` (project convention,
**not** `@testing-library`), mocking `api.*`. This slice establishes the first
component-CRUD test pattern in the editor (the harness is the same one the existing
loader/dirty tests use).

Worked examples (the two async/ordering cases most likely to be mis-built):
1. *single_choice switch order* — options A(correct), B; click B's radio; assert
   `updateOption` called `(B.id, {is_correct:true})` **before** `(A.id, {is_correct:false})`,
   exactly twice.
2. *multiple_choice last-correct revert* — one correct option C; uncheck C; mock
   `updateOption` → 422; assert `listOptions(qid)` is then called and C renders
   `is_correct=true` again (reverted to server value).

Coverage: load (questions via QuizEditor; **each accordion fetches its own options**;
numeric/text skip the fetch; one failed option fetch isolates to its accordion); question
CRUD (add each of 4 types asserting create-time required
numeric/text/precision; edit text + Save/Discard + dirty; delete via confirm; reorder
boundaries disabled); option CRUD (inline add with trim/whitespace-block; **edit text on
blur — draft is dirty-tracked, feeds `quizDirty` until commit, resets on success**;
delete; reorder); **delete-correct-option blocked** (C2); single_choice machine
(first-option-true; **unique-correct no-op**; switch order; `optionsLocked` set during the
switch **also disables delete** so the old correct option can't be deleted mid-switch
(rev-12 race); the lock **clears in `finally` on a thrown set-false** so the group
re-enables; partial-failure resync); multiple_choice (last-correct 422 revert;
**accordion-wide `optionsLocked` — a 2nd option mutation (toggle/delete/add/reorder/**text
blur-commit**) is blocked while the 1st is in flight; an out-of-order text-vs-correctness
pair does not overwrite newer local state (apply-if-current guard, §7.2)**); **question-list
`questionsLocked`** (a 2nd reorder/add/delete-question is blocked while the 1st is in
flight, so rapid reorders can't commit out of order); numeric/text
validation (required, parse, precision 0–10, **magnitude < 10^10 / ≤ 10 dp / ≤ 15
significant digits**, **scientific notation scored on the expanded scale —
`1.5e-20` rejected (21 dp), `1e3` accepted; a huge-exponent input (`1e-1000000000`) is
rejected by the arithmetic/sanity cap without building an expanded string**, **text ≤
500**); **option-load-error** (a rejected `listOptions` → that question's options are
read-only with Retry, not empty; from the error state Retry re-loads; **two overlapping
programmatic loader calls — the earlier resolving last — land only the newer result**, and
**a response resolving after the accordion is `unmount`ed writes nothing** (the §4.1a token
guard + `onDestroy(() => loadToken++)`; drives the loader directly since Retry is
unavailable mid-flight)); **PATCH-response resync** (after a text
Save the accordion's local `text_html` updates from the response and the tracker baseline
resets); §7.2 two-way lock; gating (published disables structure but allows content —
assert **no** create/delete/reorder calls; archived/disabled read-only); §8.7 confirm
(via `confirmKeyChange`: a published key edit prompts once per question/mount and aborts
on cancel; created versions and text edits don't prompt);
DirtyGuard `quizDirty` (incl. a dirty **collapsed** question's text tracker flips
`bind:quizDirty` true; an **uncommitted option-text draft** → `quizDirty` true → nav warns
+ item-delete blocked, and **stays dirty across collapsing the question** because the
tracker is accordion-owned not body-owned (§4.1/§7.1), then clears after blur-commit); **quiz-title rename**
(Save → `updateItem`; dirty feeds `quizDirty`); **single_choice 2-correct repair** (seed a question with 2 correct options →
click one radio → asserts the other is set false, leaving exactly one correct);
**item-identity reset** (the `{#key item.id}` remount clears questions/expansion/latch on
navigation, and a stale load for the prior itemId is discarded; **navigating from a dirty
quiz to a static/video item resets `quizDirty` to false** — no stale DirtyGuard/delete
block); **forced-reload guard** (a question add/delete or title rename whose
`loadAdminTree(savedVid,{force})` fires *after* the **live `vid` prop** changes to another
version is **skipped** by `alive && vid === savedVid` — proving the guard reads the live
route `vid`, not the lagging `version.id`, so it does not clobber the new route's tree —
§4.1a). No new backend tests.
Estimate ~48–64 frontend tests.

## 13. File manifest

### New
- `frontend/src/components/editor/QuizEditor.svelte`
- `frontend/src/components/editor/QuestionAccordion.svelte`
- `frontend/src/components/editor/OptionRow.svelte`
- `frontend/src/components/editor/QuestionTypePicker.svelte`
- `frontend/src/lib/quizAuthoring.ts`
- Test files per new component + `quizAuthoring`.

### Modified
- `frontend/src/pages/editor/ItemEditPage.svelte` — **do NOT add `quiz` to `editable`**
  (line 41). Instead change the trailing placeholder branch so quiz gets its own arm:
  the current final `{:else}` (around 324) becomes
  `{:else if item.type === 'quiz'}{#key item.id}<QuizEditor itemId={item.id} {vid}
  itemTitle={item.title} version={v} perms={perms} assetContext={editAssetContext}
  bind:quizDirty />{/key}{:else}…interactive_app placeholder…{/if}` — passing the **live
  route `vid`** (`:21`) as a prop for the §4.1a lifecycle guard (not `v.id`, which lags);
  **keyed on `item.id`** (§4.1a), so item navigation remounts it but a same-item
  `loadAdminTree` refresh does not. Declare `let quizDirty = $state(false)` at page scope as the
  `bind:quizDirty` target; extend the DirtyGuard closure at `:355` with `|| quizDirty`;
  and extend the `deleteItem` guard (`:214`) **and** the "Delete this item" button's
  `disabled` with `|| quizDirty` (§7.1). The page `tracker` stays `null` for quizzes. In
  `ensureLoaded`'s per-item rebuild (`:117–126`) **also `quizDirty = false`** so a stale
  dirty quiz can't block DirtyGuard/delete after navigating to a non-quiz item (§7.1).
- `frontend/src/components/editor/ItemTypePicker.svelte` — add a `quiz` radio option.
- `frontend/src/components/editor/SequenceAccordion.svelte` — extend the `newType` union
  (its declaration, the `newType`-conditioned `$effect`/dirty checks, and the
  known-fields list) + the create body to allow `quiz` (sends `{ title, type: "quiz" }`
  only). (Exact line numbers to be confirmed against current file during implementation;
  rev-2 citations had drifted.)

`AccordionHeader.svelte` and `ItemRow.svelte` are **not** modified (QuestionAccordion
rolls its own header; `ItemRow` already renders a quiz glyph).

## 14. Implementation plan shape (two sequential plans — recommended)

Large but cohesive. After the rev-6/7/8 additions the slice is **too big for one plan**;
`writing-plans` should author it as **two sequential plans**, each with its own
review/spec cadence: **Plan A = T1–T4** (lib + types, item wiring, QuizEditor load &
question CRUD & dirty registry, QuestionAccordion shell + per-type forms) and **Plan B =
T5–T9** (options CRUD + correctness state machines, gating/errors, published-key confirm,
a11y + tests, smoke). T5 (options) cleanly starts Plan B because it is the first task
depending on the QuestionAccordion built in T4. Task slicing:
- **T1** — `lib/quizAuthoring.ts` + types + tests.
- **T2** — item wiring: `ItemTypePicker` + `SequenceAccordion` quiz-create +
  `ItemEditPage` dedicated branch (C1) mounting an empty `QuizEditor` shell.
- **T3** — `QuizEditor` load (§6) + `{#key item.id}` lifecycle/stale-response guard
  (§4.1a) + quiz-title field (rename) + question list + add/delete/reorder question +
  dirty registry/`quizDirty` (§7.1) + `questions_count` refresh.
- **T4** — `QuestionAccordion` own header + per-type forms + text Save/Discard +
  create-time validation + §7.2 two-way lock.
- **T5** — accordion option loading (token-guarded `listOptions`/Retry §6/§4.1a) +
  accordion-owned option-text drafts & trackers (§7.1) + presentational `OptionRow` +
  options CRUD + single_choice (§8.4) & multiple_choice (§8.2) state machines
  (accordion-wide `optionsLocked`, `finally`-release §7.2) + delete-correct guard (C2) +
  answer-key visibility. **Starts Plan B** (densest task; first to depend on T4's
  accordion).
- **T6** — version-gating (§9) + disabled/archived read-only + error handling (§10).
- **T7** — published answer-key confirm (§8.7) + type dead-end note (§8.8).
- **T8** — Accessibility + focus management (§10a) + full test sweep.
- **T9** — manual smoke walkthrough (§15).

## 15. Manual smoke walkthrough (after implementation)

Run against a `created`, then `published`, then `disabled` version:
1. "＋ New item" → **Quiz** → opens an empty `QuizEditor`.
2. Add one question of **each** type; numeric set value + precision; text set the answer.
3. single_choice: add 3 options; confirm first is auto-correct; switch correct option;
   exactly one stays selected; try to delete the correct option → blocked with reason.
4. multiple_choice: 4 options, mark 2 correct; uncheck the last correct → inline error +
   revert.
5. Edit a question's text → Save; confirm option controls were locked until Save, and
   text inputs were locked during an option toggle.
6. Reorder questions and options with ↑/↓; reload → order persists.
7. Delete an option and a question (confirm dialog); item row `questions_count` updates.
8. Nav away with an unsaved question edit → DirtyGuard warns.
9. **Publish**; reopen: structure disabled, text/key edits allowed; first answer-key edit
   per question opens the §8.7 confirm; a text-only edit does not.
10. **Disable**: the whole quiz editor is read-only.
11. Keyboard/SR pass, itemized: (a) tab through and operate radios, checkboxes, reorder
    buttons; (b) verify the `aria-live` order-change announcement fires; (c) force a
    validation error and verify the `role="alert"`; (d) confirm the §8.7 `window.confirm`
    is reachable and operable; (e) verify focus lands correctly after add/delete/expand/Save.

## 16. Next step

After review converges + user approval → `superpowers:writing-plans` (strict per-task
review cadence).
