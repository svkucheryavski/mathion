# Quiz Authoring (Course Editor) — Implementation Plan A (T1–T4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold quiz authoring in the course editor — the typed API/validation lib, the item-create wiring, and the `QuizEditor` shell with question-list CRUD and the `QuestionAccordion` (header + per-type text forms). Option editing, correctness state machines, gating, the published-key confirm, a11y, and smoke are **Plan B**.

**Architecture:** Frontend-only, on existing backend question/option CRUD endpoints (no backend changes). `ItemEditPage` gets a dedicated `{#key item.id}<QuizEditor/>` branch (quiz is **not** added to `editable`). `QuizEditor` owns the question list + a fresh `createDirtyRegistry()`; each `QuestionAccordion` owns a local working copy of its question fields + its own dirty tracker. All async writes/loads are lifecycle-guarded.

**Tech Stack:** Svelte 5 runes (`$state`/`$derived`/`$effect`/`$bindable`), TypeScript, Vitest with `mount`/`unmount`/`flushSync` from `svelte` (NOT `@testing-library`). No new JS/CSS dependencies.

**Spec:** `docs/superpowers/specs/2026-06-21-quiz-authoring-design.md` (Approved rev 15). Section refs below (§N) point there.

## Global Constraints

- **Svelte 5 only**, no JS/CSS deps; modular, focused components.
- **Component tests** use `mount`/`unmount`/`flushSync` from `svelte`, mocking `api.*` / the `quizAuthoring` wrappers — NOT `@testing-library/svelte`.
- **Callback props** (e.g. `onDelete`, `onMoveUp`), not event dispatch.
- **Run the frontend toolchain from `frontend/`**: `cd frontend && npx vitest run <file>` for tests, `npx svelte-check` for types. (Backend `.venv` is irrelevant to this slice — no backend changes.)
- **Four question types:** `single_choice | multiple_choice | numeric_answer | text_answer`.
- **Version gating** (mirrored, server-enforced): `canEditStructure` ≈ created-only; `canEditTextFields` ≈ created||published; both already AND-in `!is_disabled` (`lib/versionPermissions.ts`). Disabled OR archived → whole editor read-only.
- **Lifecycle guard** (§4.1a): every loader uses a plain `loadToken` + `myToken === loadToken` check from `onMount`, **plus `onDestroy(() => loadToken++)`**. Every post-`await` local write / forced `loadAdminTree(vid,{force:true})` is gated by `alive && vid === savedVid`, where `vid` is the **live route prop** (not `version.id`, which lags).
- **No question rows in the admin tree** — it carries only `questions_count` (`content.py:164`); question/option detail comes from the dedicated endpoints.
- **Commit** after each task's tests pass (frequent commits). Branch: work on a feature branch off `main` (e.g. `feat/quiz-authoring`), not a worktree.

---

## File Structure

**New (this plan):**
- `frontend/src/lib/quizAuthoring.ts` — authoring types, typed `api.*` wrappers, the pure numeric-answer validator.
- `frontend/src/lib/quizAuthoring.test.ts` — wrapper + validator unit tests.
- `frontend/src/components/editor/QuizEditor.svelte` — root: question-list owner, dirty registry, title rename, question CRUD, lifecycle.
- `frontend/src/components/editor/QuestionAccordion.svelte` — one question: header (T3) + body forms (T4).
- `frontend/src/components/editor/QuestionTypePicker.svelte` — radio-card type chooser for the add-question form (§13 manifest; built in T3).
- `frontend/src/tests/QuizEditor.svelte.test.ts` — QuizEditor component tests.
- `frontend/src/tests/QuestionAccordion.svelte.test.ts` — QuestionAccordion component tests.
- `frontend/src/tests/QuestionTypePicker.svelte.test.ts` — leaf test for the picker.

**Modified (this plan):**
- `frontend/src/components/editor/ItemTypePicker.svelte` — add `quiz` to the union + a radio.
- `frontend/src/components/editor/SequenceAccordion.svelte` — extend `newType` union + create body for quiz.
- `frontend/src/pages/editor/ItemEditPage.svelte` — dedicated quiz branch, `quizDirty` state/bind, dirty-gate extensions, nav reset.

**Deferred to Plan B:** `OptionRow.svelte`, options CRUD, correctness state machines, `optionsLocked`/published-confirm, full a11y, smoke. (`QuestionTypePicker.svelte` is **not** deferred — §13 lists it as a Plan-A component and the add-question form is T3, so it is built in T3 Step 4.)

---

## Reference: backend contract (verified, do not re-discover)

Endpoints (all gated by `require_course_admin`; `is_disabled`→403 before state check):
- `GET  /api/items/{itemId}/questions` → `QuestionResponse[]` (flat, **no options embedded**).
- `POST /api/items/{itemId}/questions` (201) → `QuestionResponse`. Body `QuestionCreate`: `{ text_md (min 1), type, explanation_md?, correct_numeric?, precision?(ge 0), correct_text? }`. **Does NOT validate numeric/text correctness at create** — the UI requires them.
- `PATCH /api/questions/{qid}` → `QuestionResponse`. Body `QuestionUpdate` (all optional): `{ text_md?(min 1), explanation_md?, correct_numeric?, precision?, correct_text? }`. Regenerates `text_html`/`explanation_html`.
- `DELETE /api/questions/{qid}` (204).
- `POST /api/items/{itemId}/questions/reorder` — body `{ order: [{id, order}] }`, `order` ge 1, 1-indexed, full id-set; dup/incomplete → 400.
- Options (Plan B): `GET/POST /api/questions/{qid}/options`, `PATCH/DELETE /api/options/{oid}`, `POST /api/questions/{qid}/options/reorder`.
- `PATCH /api/items/{itemId}` → `ItemResponse`. Body `ItemUpdate` (quiz sends only `{ title }`).

`QuestionResponse.correct_numeric` serializes `Decimal`→`float` (JSON number; `schemas.py:300`). Status codes: create/delete/reorder outside `created`→409; disabled→403; numeric/text correctness validated only on update.

---

### Task 1: `lib/quizAuthoring.ts` — types, API wrappers, numeric validator

**Files:**
- Create: `frontend/src/lib/quizAuthoring.ts`
- Test: `frontend/src/lib/quizAuthoring.test.ts`

**Interfaces:**
- Consumes: `api` from `lib/api.ts` (`api.get/post/patch/delete`).
- Produces (later tasks rely on these exact names/types):
  - `type QuestionType = 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer'`
  - `interface AuthoringOption { id: number; question_id: number; text: string; is_correct: boolean; order: number }`
  - `interface AuthoringQuestion { id; item_id; text_md; text_html; type: QuestionType; order; explanation_md: string | null; explanation_html: string | null; correct_numeric: number | null; precision: number | null; correct_text: string | null }`
  - `interface QuestionCreateBody { text_md: string; type: QuestionType; explanation_md?: string | null; correct_numeric?: number | null; precision?: number | null; correct_text?: string | null }`
  - `interface QuestionUpdateBody { text_md?: string; explanation_md?: string | null; correct_numeric?: number | null; precision?: number | null; correct_text?: string | null }`
  - `interface OrderEntry { id: number; order: number }`
  - Wrappers: `listQuestions(itemId): Promise<AuthoringQuestion[]>`, `createQuestion(itemId, body): Promise<AuthoringQuestion>`, `updateQuestion(qid, body): Promise<AuthoringQuestion>`, `deleteQuestion(qid): Promise<void>`, `reorderQuestions(itemId, order): Promise<void>`, `listOptions(qid): Promise<AuthoringOption[]>`, `createOption(qid, body): Promise<AuthoringOption>`, `updateOption(oid, body): Promise<AuthoringOption>`, `deleteOption(oid): Promise<void>`, `reorderOptions(qid, order): Promise<void>`, `renameItem(itemId, title): Promise<{ id: number; title: string }>`.
  - `validateNumericAnswer(input: string): { ok: true; canonical: string } | { ok: false; reason: string }` — pure §8.3 validator.

- [ ] **Step 1: Write the failing test for the numeric validator (the pure, highest-risk unit)**

Create `frontend/src/lib/quizAuthoring.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateNumericAnswer } from './quizAuthoring';

describe('validateNumericAnswer (§8.3)', () => {
  it('accepts plain decimals and integers', () => {
    expect(validateNumericAnswer('3.14')).toEqual({ ok: true, canonical: '3.14' });
    expect(validateNumericAnswer('-42')).toEqual({ ok: true, canonical: '-42' });
    expect(validateNumericAnswer('0')).toEqual({ ok: true, canonical: '0' });
  });

  it('expands scientific notation and judges the EXPANDED scale', () => {
    expect(validateNumericAnswer('1e3')).toEqual({ ok: true, canonical: '1000' });
    // 1.5e-20 has 21 fractional digits → over the ≤10-dp bound
    expect(validateNumericAnswer('1.5e-20')).toMatchObject({ ok: false });
  });

  it('rejects empty / unparseable', () => {
    expect(validateNumericAnswer('')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('  ')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('abc')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('1.2.3')).toMatchObject({ ok: false });
  });

  it('rejects > 10 fractional digits and |value| >= 10^10 on the expanded value', () => {
    expect(validateNumericAnswer('1.23456789012')).toMatchObject({ ok: false }); // 11 dp
    expect(validateNumericAnswer('10000000000')).toMatchObject({ ok: false });   // = 10^10
    expect(validateNumericAnswer('9999999999')).toMatchObject({ ok: true });     // 10 int digits ok
  });

  it('rejects > 15 significant digits (float round-trip safety)', () => {
    // 10 int + 6 frac = 16 sig (magnitude 1.23e9 < 10^10, so the sig bound fires).
    expect(validateNumericAnswer('1234567890.123456')).toMatchObject({ ok: false });
    // 5 int + 10 frac = 15 sig, and BOTH within the Numeric(20,10) bounds
    // (<10^10 magnitude, ≤10 dp). A 15-DIGIT INTEGER like 123456789012345 is NOT
    // a valid "15 sig" case — it is rejected first by the <10^10 magnitude bound
    // (DB column Numeric(precision=20, scale=10) → 10 integer digits max).
    expect(validateNumericAnswer('12345.1234567891')).toEqual({ ok: true, canonical: '12345.1234567891' });
  });

  it('rejects a huge exponent WITHOUT building an expanded string (sanity cap)', () => {
    expect(validateNumericAnswer('1e-1000000000')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('1e40')).toMatchObject({ ok: false });
  });

  it('counts significant digits with fractional-only trailing zeros stripped', () => {
    // 0.0500 -> 5 sig (1), 1200 -> 4 sig (trailing integer zeros ARE significant)
    expect(validateNumericAnswer('0.0500')).toEqual({ ok: true, canonical: '0.05' });
    expect(validateNumericAnswer('1200')).toEqual({ ok: true, canonical: '1200' });
  });
});
```

- [ ] **Step 2: Run it — expect failure (module/function missing)**

Run: `cd frontend && npx vitest run src/lib/quizAuthoring.test.ts`
Expected: FAIL — `validateNumericAnswer` is not exported / module not found.

- [ ] **Step 3: Implement `validateNumericAnswer` + the types/wrappers in `lib/quizAuthoring.ts`**

Create `frontend/src/lib/quizAuthoring.ts`:

```ts
import { api } from './api';

export type QuestionType =
  | 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer';

export interface AuthoringOption {
  id: number; question_id: number; text: string; is_correct: boolean; order: number;
}

// Mirrors the flat QuestionResponse — options are NOT embedded (§3.4). Each
// QuestionAccordion fetches/owns its own options (Plan B), not via this type.
export interface AuthoringQuestion {
  id: number; item_id: number; text_md: string; text_html: string;
  type: QuestionType; order: number;
  explanation_md: string | null; explanation_html: string | null;
  correct_numeric: number | null;   // JSON number on the wire (float-safe subset)
  precision: number | null; correct_text: string | null;
}

export interface QuestionCreateBody {
  text_md: string; type: QuestionType;
  explanation_md?: string | null;
  correct_numeric?: number | null; precision?: number | null; correct_text?: string | null;
}
export interface QuestionUpdateBody {
  text_md?: string; explanation_md?: string | null;
  correct_numeric?: number | null; precision?: number | null; correct_text?: string | null;
}
export interface OptionCreateBody { text: string; is_correct: boolean; }
export interface OptionUpdateBody { text?: string; is_correct?: boolean; }
export interface OrderEntry { id: number; order: number; }

// ---- API wrappers (thin; errors propagate as ApiError from lib/api) ----
export const listQuestions = (itemId: number) =>
  api.get<AuthoringQuestion[]>(`/api/items/${itemId}/questions`);
export const createQuestion = (itemId: number, body: QuestionCreateBody) =>
  api.post<AuthoringQuestion>(`/api/items/${itemId}/questions`, body);
export const updateQuestion = (qid: number, body: QuestionUpdateBody) =>
  api.patch<AuthoringQuestion>(`/api/questions/${qid}`, body);
export const deleteQuestion = (qid: number) =>
  api.delete(`/api/questions/${qid}`);
export const reorderQuestions = (itemId: number, order: OrderEntry[]) =>
  api.post<void>(`/api/items/${itemId}/questions/reorder`, { order });

export const listOptions = (qid: number) =>
  api.get<AuthoringOption[]>(`/api/questions/${qid}/options`);
export const createOption = (qid: number, body: OptionCreateBody) =>
  api.post<AuthoringOption>(`/api/questions/${qid}/options`, body);
export const updateOption = (oid: number, body: OptionUpdateBody) =>
  api.patch<AuthoringOption>(`/api/options/${oid}`, body);
export const deleteOption = (oid: number) =>
  api.delete(`/api/options/${oid}`);
export const reorderOptions = (qid: number, order: OrderEntry[]) =>
  api.post<void>(`/api/questions/${qid}/options/reorder`, { order });

export const renameItem = (itemId: number, title: string) =>
  api.patch<{ id: number; title: string }>(`/api/items/${itemId}`, { title });

// ---- Numeric-answer validation (§8.3) ----
// Validate the EXPANDED scale, computed arithmetically — never materialize a
// huge string for an extreme exponent. Returns a canonical plain-decimal string
// (≤ 20 digits) safe to send, or a rejection reason for inline display.
export type NumericValidation =
  | { ok: true; canonical: string }
  | { ok: false; reason: string };

const NUMERIC_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function validateNumericAnswer(input: string): NumericValidation {
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'Enter a number.' };
  // Up-front sanity cap before any expansion (DoS guard for 1e-1000000000).
  if (raw.length > 40) return { ok: false, reason: 'Number is too long.' };
  const m = NUMERIC_RE.exec(raw);
  if (!m) return { ok: false, reason: 'Not a valid number.' };
  const [, sign, intPartRaw, fracPartRaw = '', expRaw = ''] = m;
  const intPart = intPartRaw ?? '';
  if (intPart === '' && fracPartRaw === '') return { ok: false, reason: 'Not a valid number.' };
  const exp = expRaw === '' ? 0 : Number(expRaw);
  if (!Number.isFinite(exp) || Math.abs(exp) > 40) {
    return { ok: false, reason: 'Exponent is out of range.' };
  }

  // Combine digits and the decimal point position, then shift by exp — all on
  // digit strings, no Number() round-trip and no full expansion of huge exps.
  const digits = (intPart + fracPartRaw).replace(/^0+(?=\d)/, ''); // strip leading zeros (keep one)
  // pointPos = number of digits to the LEFT of the decimal point after shift.
  // initial left-count = intPart length (after the leading-zero strip we track
  // via the original lengths to keep the math simple):
  let leftCount = intPart.length + exp;          // integer-side digit count
  const allDigits = (intPart + fracPartRaw);     // significant + placeholder digits, pre-strip
  // Build a normalized digit string with an explicit decimal index.
  // Work from allDigits (no point), with the point initially after intPart.length,
  // then shifted right by `exp`.
  const pointIndex = intPart.length + exp;        // digits before the point
  // Split into integer / fractional digit strings (pad with zeros as needed).
  let intDigits: string, fracDigits: string;
  if (pointIndex <= 0) {
    intDigits = '0';
    fracDigits = '0'.repeat(-pointIndex) + allDigits;
  } else if (pointIndex >= allDigits.length) {
    intDigits = allDigits + '0'.repeat(pointIndex - allDigits.length);
    fracDigits = '';
  } else {
    intDigits = allDigits.slice(0, pointIndex);
    fracDigits = allDigits.slice(pointIndex);
  }
  intDigits = intDigits.replace(/^0+(?=\d)/, '');     // canonical integer part
  fracDigits = fracDigits.replace(/0+$/, '');         // strip fractional trailing zeros

  // Bounds on the expanded value (§8.3).
  if (fracDigits.length > 10) return { ok: false, reason: 'At most 10 decimal places.' };
  if (intDigits.replace(/^0$/, '').length > 10) {
    return { ok: false, reason: 'Magnitude must be below 10,000,000,000.' };
  }
  // Significant digits: drop leading zeros (whole value) + fractional trailing
  // zeros (already done). Trailing INTEGER zeros stay significant for Numeric.
  const sig = (intDigits + fracDigits).replace(/^0+/, '');
  const sigCount = sig === '' ? 1 : sig.length;
  if (sigCount > 15) return { ok: false, reason: 'At most 15 significant digits.' };

  const isZero = intDigits === '0' && fracDigits === '';
  const body = fracDigits === '' ? intDigits : `${intDigits}.${fracDigits}`;
  const canonical = isZero ? '0' : (sign === '-' ? `-${body}` : body);
  // Silence unused-var lints for the exploratory locals.
  void digits; void leftCount; void allDigits;
  return { ok: true, canonical };
}
```

> **Implementer note:** the `digits`/`leftCount`/`allDigits` exploratory locals are folded into `pointIndex` — feel free to delete them and the `void` line if your linter is satisfied; they are kept only to make the shift math auditable. Verify each test case by hand against the bounds before moving on.

- [ ] **Step 4: Run the validator tests — expect PASS**

Run: `cd frontend && npx vitest run src/lib/quizAuthoring.test.ts`
Expected: PASS (all `validateNumericAnswer` cases). Fix the arithmetic if any case fails — the tests are the spec of record for §8.3.

- [ ] **Step 5: Add wrapper tests (path + body shape, mocking `api`)**

Append to `frontend/src/lib/quizAuthoring.test.ts`:

```ts
import * as apiModule from './api';
import {
  listQuestions, createQuestion, updateQuestion, deleteQuestion,
  reorderQuestions, renameItem,
} from './quizAuthoring';

describe('quizAuthoring wrappers', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('listQuestions GETs the item questions path', async () => {
    const spy = vi.spyOn(apiModule.api, 'get').mockResolvedValue([]);
    await listQuestions(7);
    expect(spy).toHaveBeenCalledWith('/api/items/7/questions');
  });

  it('createQuestion POSTs the body to the item path', async () => {
    const spy = vi.spyOn(apiModule.api, 'post').mockResolvedValue({} as never);
    await createQuestion(7, { text_md: 'Q?', type: 'numeric_answer', correct_numeric: 3, precision: 0 });
    expect(spy).toHaveBeenCalledWith('/api/items/7/questions',
      { text_md: 'Q?', type: 'numeric_answer', correct_numeric: 3, precision: 0 });
  });

  it('updateQuestion PATCHes the question path', async () => {
    const spy = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
    await updateQuestion(9, { text_md: 'new' });
    expect(spy).toHaveBeenCalledWith('/api/questions/9', { text_md: 'new' });
  });

  it('deleteQuestion DELETEs the question path', async () => {
    const spy = vi.spyOn(apiModule.api, 'delete').mockResolvedValue();
    await deleteQuestion(9);
    expect(spy).toHaveBeenCalledWith('/api/questions/9');
  });

  it('reorderQuestions POSTs {order} to the reorder path', async () => {
    const spy = vi.spyOn(apiModule.api, 'post').mockResolvedValue(undefined as never);
    await reorderQuestions(7, [{ id: 2, order: 1 }, { id: 1, order: 2 }]);
    expect(spy).toHaveBeenCalledWith('/api/items/7/questions/reorder',
      { order: [{ id: 2, order: 1 }, { id: 1, order: 2 }] });
  });

  it('renameItem PATCHes the item title', async () => {
    const spy = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({ id: 7, title: 'T' } as never);
    await renameItem(7, 'T');
    expect(spy).toHaveBeenCalledWith('/api/items/7', { title: 'T' });
  });
});
```

- [ ] **Step 6: Run all of Task 1's tests — expect PASS, then type-check**

Run: `cd frontend && npx vitest run src/lib/quizAuthoring.test.ts && npx svelte-check --threshold error`
Expected: tests PASS; svelte-check reports no errors in `quizAuthoring.ts`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/quizAuthoring.ts frontend/src/lib/quizAuthoring.test.ts
git commit -m "feat(quiz-authoring): typed CRUD wrappers + numeric-answer validator (T1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Item wiring — type picker, quiz create, `ItemEditPage` branch + `QuizEditor` shell

**Files:**
- Modify: `frontend/src/components/editor/ItemTypePicker.svelte`
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte:190,261-263,274-277`
- Modify: `frontend/src/pages/editor/ItemEditPage.svelte` (script + the `{:else}` branch at `:324`, DirtyGuard `:355`, delete gate `:343-344`, `deleteItem` `:214`, `ensureLoaded` `:117-126`)
- Create: `frontend/src/components/editor/QuizEditor.svelte` (shell only)

**Interfaces:**
- Consumes: nothing new beyond Task 1 types.
- Produces: `QuizEditor` accepting props `{ itemId: number; vid: number; itemTitle: string; version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext; quizDirty?: boolean (bindable) }`. In this task it renders only a header + an empty-state line and keeps `quizDirty` at `false`. T3 fills it in.

- [ ] **Step 1: Add `quiz` to `ItemTypePicker` — write the failing test**

Create `frontend/src/tests/ItemTypePicker.svelte.test.ts`:

```ts
import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemTypePicker from '../components/editor/ItemTypePicker.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('offers a quiz radio and binds it', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'static_page' | 'video' | 'quiz' } = $state({ value: 'static_page' });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const quiz = target.querySelector('input[value="quiz"]') as HTMLInputElement;
  expect(quiz).not.toBeNull();
  quiz.click();
  flushSync();
  expect(props.value).toBe('quiz');
});
```

- [ ] **Step 2: Run it — expect failure (no quiz radio)**

Run: `cd frontend && npx vitest run src/tests/ItemTypePicker.svelte.test.ts`
Expected: FAIL — `input[value="quiz"]` is null.

- [ ] **Step 3: Widen the union and add the radio**

In `frontend/src/components/editor/ItemTypePicker.svelte`, change the type alias and the prop type, and add a third label:

```svelte
  type ItemType = 'static_page' | 'video' | 'quiz';
  let { value = $bindable() }: { value: ItemType } = $props();
```

After the `video` label, add:

```svelte
  <label class:selected={value === 'quiz'}>
    <input type="radio" name="item-type" value="quiz" bind:group={value} />
    <span class="glyph" aria-hidden="true">❓</span>
    <span>Quiz</span>
  </label>
```

- [ ] **Step 4: Run it — expect PASS**

Run: `cd frontend && npx vitest run src/tests/ItemTypePicker.svelte.test.ts`
Expected: PASS.

> **Testing convention for this task (read first).** `SequenceAccordion` and `ItemEditPage` are deliberately **not** mounted directly in this repo's tests — they are coupled to the `currentEditorVersion` store + router. The proven pattern (see `frontend/src/tests/ItemEditPage.refreshKey.harness.svelte` + `.refreshKey.svelte.test.ts`) is to unit-test small, mountable leaf components and the *wiring pattern* via a focused harness, and to cover the page-integration glue with `svelte-check` + the manual smoke (Step 9). So in T2 the **only** new unit test is `ItemTypePicker` (Steps 1–4, a true leaf). The `SequenceAccordion` quiz-create branch (Step 5) and the `ItemEditPage` quiz arm (Step 6) are 3-to-8-line parallel extensions of existing tested code, gated by the type-checker and the Task-2 smoke — do **not** fabricate a mount test for them. Their real behavior (`quizDirty` flips, load, CRUD) is unit-tested inside `QuizEditor` in T3, which *is* a mountable leaf.

- [ ] **Step 5: Extend the `SequenceAccordion` create form for quiz**

In `frontend/src/components/editor/SequenceAccordion.svelte`:

Widen `newType` (`:190`):
```svelte
  let newType = $state<'static_page' | 'video' | 'quiz'>('static_page');
```

In `submitCreate` (`:261-263`), the body assembly already sends `{ title, type: newType }` and only appends `content_md`/`video_url` for those types — so **quiz needs no extra body field**. Confirm the block reads:
```svelte
    const body: Record<string, unknown> = { title: newTitle, type: newType };
    if (newType === 'static_page') body.content_md = newContentMd;
    if (newType === 'video') body.video_url = newVideoUrl;
```

In the `known` fields for `mapCreateError` (`:274-277`), add a quiz branch so a quiz create error maps cleanly:
```svelte
      const known = newType === 'static_page'
        ? ['title', 'content_md', 'type']
        : newType === 'video'
          ? ['title', 'video_url', 'type']
          : ['title', 'type'];
```

Ensure the create form's type chooser renders the quiz option: if it uses `<ItemTypePicker bind:value={newType} />`, it now shows Quiz automatically (Step 3). If it inlines radios, add a `quiz` radio there too.

- [ ] **Step 6: Add the `QuizEditor` shell**

Create `frontend/src/components/editor/QuizEditor.svelte`:

```svelte
<script lang="ts">
  import type { AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';

  let {
    itemId, vid, itemTitle, version, perms, assetContext, quizDirty = $bindable(false),
  }: {
    itemId: number; vid: number; itemTitle: string;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    quizDirty?: boolean;
  } = $props();

  // T3 fills in load + question list + dirty registry. Shell keeps quizDirty false.
  // `noUnusedLocals`/`noUnusedParameters` are on (tsconfig.json:13-14) — void the
  // props this shell does not yet read so svelte-check passes.
  void itemId; void vid; void version; void perms; void assetContext; void quizDirty;
</script>

<section class="quiz-editor" aria-label="Quiz editor">
  <h2 class="quiz-title">{itemTitle}</h2>
  <p class="empty"><em>Quiz authoring loads here.</em></p>
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: var(--space-3); }
  .quiz-title { margin: 0; }
  .empty { color: var(--text-muted, #666); }
</style>
```

> **Import note (verified):** `VersionPermissions` is exported **only** from `lib/versionPermissions.ts:3` — it is NOT in `lib/types.ts`. Import it as `import type { VersionPermissions } from '../../lib/versionPermissions'` in every component that needs it (`QuizEditor`, `QuestionAccordion`). `AssetContext` comes from `lib/assetContext`, `AdminTreeVersion` from `lib/types`.

- [ ] **Step 7: Add the quiz branch + `quizDirty` plumbing to `ItemEditPage`**

> No new unit test here — per the testing-convention note above, `ItemEditPage` is not mounted in tests; this template-wiring change is gated by `svelte-check` (Step 8) and the Task-2 smoke (Step 9). The `QuizEditor` behavior it mounts is unit-tested in T3.

In `frontend/src/pages/editor/ItemEditPage.svelte`:

Add imports + state (script top, near the other `$state`):
```svelte
  import QuizEditor from '../../components/editor/QuizEditor.svelte';
  // Page-owned dirty flag for the quiz editor (the page `tracker` stays null for
  // quizzes). Bound into QuizEditor; reset on item navigation (§7.1).
  let quizDirty = $state(false);
```

Replace the trailing `{:else}` placeholder branch (currently `:324-336`, the "Not editable in this slice" block with the quiz/interactive_app sub-cases) with a dedicated quiz arm BEFORE the final `{:else}`:
```svelte
    {:else if item.type === 'quiz'}
      {#key item.id}
        <QuizEditor
          itemId={item.id}
          {vid}
          itemTitle={item.title}
          version={v}
          {perms}
          assetContext={editAssetContext}
          bind:quizDirty
        />
      {/key}
    {:else}
      <section class="readonly">
        <p><em>Not editable in this slice.</em></p>
        {#if item.type === 'interactive_app'}
          <p>Interactive-app editing lands in slice 2.</p>
        {/if}
      </section>
    {/if}
```

Extend the DirtyGuard closure (`:355`):
```svelte
    <DirtyGuard isDirty={() => (tracker?.isDirty ?? false) || quizDirty} />
```

Extend the `deleteItem` guard (`:214`):
```svelte
    if ((tracker?.isDirty ?? false) || quizDirty || !item || !perms?.canEditStructure) return;
```

Extend the delete button `disabled` + `title` (`:343-344`):
```svelte
          disabled={(tracker?.isDirty ?? false) || quizDirty || busy}
          title={((tracker?.isDirty ?? false) || quizDirty) ? 'Save or discard changes first' : ''}
```

Reset `quizDirty` on item navigation in `ensureLoaded`'s rebuild block (inside the `if (fresh && (trackerIid !== iid || trackerVid !== vid)) { ... }` at `:117-126`, alongside the `tracker = ...` assignments):
```svelte
      quizDirty = false;
```

- [ ] **Step 8: Type-check the whole wiring + run the ItemTypePicker test — expect PASS**

Run: `cd frontend && npx vitest run src/tests/ItemTypePicker.svelte.test.ts && npx svelte-check --threshold error`
Expected: the ItemTypePicker test PASSES; `svelte-check` reports no errors — this is the correctness gate for the `SequenceAccordion` create change and the `ItemEditPage` quiz arm (the `bind:quizDirty` target type, the `QuizEditor` prop types, the new union member all check out).

- [ ] **Step 9: Manual smoke (item create → quiz opens shell)**

Run the dev server (`cd frontend && npm run dev`), open a `created` version, "＋ New item" → **Quiz** → confirm it navigates to the item and the `QuizEditor` shell ("Quiz authoring loads here.") renders with the quiz title. Then edit a non-quiz item, navigate to the quiz, and back — confirm no console errors. (Full behavior lands T3+.)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/editor/ItemTypePicker.svelte \
        frontend/src/components/editor/SequenceAccordion.svelte \
        frontend/src/components/editor/QuizEditor.svelte \
        frontend/src/pages/editor/ItemEditPage.svelte \
        frontend/src/tests/ItemTypePicker.svelte.test.ts
git commit -m "feat(quiz-authoring): item-create wiring + QuizEditor shell branch (T2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `QuizEditor` — load, lifecycle guard, title rename, question CRUD, dirty registry

**Files:**
- Modify: `frontend/src/components/editor/QuizEditor.svelte` (flesh out the shell)
- Create: `frontend/src/components/editor/QuestionAccordion.svelte` (header-only stub for this task)
- Test: `frontend/src/tests/QuizEditor.svelte.test.ts`

**Interfaces:**
- Consumes: `listQuestions/createQuestion/deleteQuestion/reorderQuestions/renameItem` + `validateNumericAnswer` + `AuthoringQuestion`/`QuestionType`/`QuestionCreateBody` from `lib/quizAuthoring`; `createDirtyRegistry`/`DIRTY_REGISTRY_KEY` from `lib/dirtyRegistry`; `makeDirtyTracker` from `lib/dirty`; `loadAdminTree` from the store; `QuestionTypePicker` (T3 Step 4).
- Produces: `QuizEditor` provides `createDirtyRegistry()` via `setContext(DIRTY_REGISTRY_KEY, …)` to descendants; renders one `QuestionAccordion` per question keyed by `q.id` with props `{ question: AuthoringQuestion; vid: number; index: number; count: number; perms; assetContext; expanded: boolean; locked: boolean }` and callbacks `{ onExpandToggle, onDelete, onMoveUp, onMoveDown }`. (Header-only stub here; body in T4.) The add-question form (collecting per-type correctness) and `questionsLocked` propagation as `locked` are part of this task.

- [ ] **Step 1: Write the failing test — QuizEditor loads and lists questions**

Create `frontend/src/tests/QuizEditor.svelte.test.ts`:

```ts
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import QuizEditor from '../components/editor/QuizEditor.svelte';
import * as qa from '../lib/quizAuthoring';
import type { AuthoringQuestion } from '../lib/quizAuthoring';
import { versionPermissions } from '../lib/versionPermissions';

const VERSION = { id: 10, course_id: 1, state: 'created', is_disabled: false, info_md: '',
  info_html: '', max_quiz_attempts: 3, created_at: '', published_at: null, archived_at: null,
  content_updated_at: '' } as const;

const stubAssetCtx = () => ({
  kind: 'course', list: vi.fn().mockResolvedValue([]), upload: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined), imgSrc: () => '', renderPreview: vi.fn().mockResolvedValue({ html: '' }),
}) as never;

const q = (over: Partial<AuthoringQuestion> = {}): AuthoringQuestion => ({
  id: 1, item_id: 4, text_md: 'Question one', text_html: '<p>Question one</p>',
  type: 'numeric_answer', order: 1, explanation_md: null, explanation_html: null,
  correct_numeric: 3, precision: 0, correct_text: null, ...over,
});

let cleanup: (() => void) | null = null;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

function mountEditor(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: Record<string, unknown> = $state({
    itemId: 4, vid: 10, itemTitle: 'My Quiz', version: VERSION,
    perms: versionPermissions(VERSION), assetContext: stubAssetCtx(), quizDirty: false, ...over,
  });
  const cmp = mount(QuizEditor, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}

it('loads questions on mount and lists them in order', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 2, order: 2, text_md: 'Second' }), q({ id: 1, order: 1, text_md: 'First' })]);
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  const headers = [...target.querySelectorAll('[data-testid="question-header"]')];
  expect(headers).toHaveLength(2);
  // sorted by order: First (1) before Second (2)
  expect(headers[0].textContent).toContain('First');
  expect(headers[1].textContent).toContain('Second');
});

it('shows the empty-state when there are no questions', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  expect(target.textContent).toContain('No questions yet');
});
```

- [ ] **Step 2: Run it — expect failure (shell has no load/list)**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts`
Expected: FAIL — no `[data-testid="question-header"]`, no "No questions yet".

- [ ] **Step 3: Create the header-only `QuestionAccordion` stub**

Create `frontend/src/components/editor/QuestionAccordion.svelte`:

```svelte
<script lang="ts">
  import type { AuthoringQuestion } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked,
    onExpandToggle, onDelete, onMoveUp, onMoveDown,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  // Strip tags for the header snippet (header renders from a local copy in T4;
  // for the stub we read the prop directly).
  const snippet = $derived(question.text_html.replace(/<[^>]*>/g, '').trim().slice(0, 80));
  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'Single choice', multiple_choice: 'Multiple choice',
    numeric_answer: 'Numeric', text_answer: 'Text',
  };
  // §7.2 shared lock: structural controls are disabled when there is no
  // structure perm OR an accordion-wide add/delete/reorder is in flight
  // (`locked`). T4 also ANDs in this question's own dirty-form state.
  const structureDisabled = $derived(!perms.canEditStructure || locked);
  void vid; void assetContext; // consumed in T4
</script>

<div class="question" class:expanded>
  <div class="header" data-testid="question-header">
    <button type="button" class="expand" aria-expanded={expanded} onclick={onExpandToggle}>
      {expanded ? '▾' : '▸'}
    </button>
    <span class="num">{index}.</span>
    <span class="badge">{typeLabel[question.type]}</span>
    <span class="snippet">{snippet || '(no text)'}</span>
    <span class="spacer"></span>
    <button type="button" aria-label="Move up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete question" disabled={structureDisabled} onclick={onDelete}>🗑</button>
  </div>
  <!-- Body: built in Task 4. -->
</div>

<style>
  .question { border: 1px solid var(--border); border-radius: var(--radius); }
  .header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); }
  .spacer { flex: 1; }
  .badge { font-size: 0.85em; color: var(--text-muted, #666); }
</style>
```

- [ ] **Step 4: Create `QuestionTypePicker.svelte` (§13 manifest component)**

The add-question form needs a type chooser; the §13 manifest (spec:368, 1085) lists `QuestionTypePicker.svelte` as a Plan-A component — a copy of `ItemTypePicker`'s radio-card pattern. Create `frontend/src/components/editor/QuestionTypePicker.svelte`:

```svelte
<script lang="ts">
  import type { QuestionType } from '../../lib/quizAuthoring';
  let { value = $bindable(), disabled = false }: { value: QuestionType; disabled?: boolean } = $props();
  const TYPES: { value: QuestionType; label: string; glyph: string }[] = [
    { value: 'single_choice', label: 'Single choice', glyph: '◉' },
    { value: 'multiple_choice', label: 'Multiple choice', glyph: '☑' },
    { value: 'numeric_answer', label: 'Numeric', glyph: '#' },
    { value: 'text_answer', label: 'Text', glyph: '✎' },
  ];
</script>

<fieldset class="picker" {disabled}>
  <legend>Question type</legend>
  {#each TYPES as t}
    <label class:selected={value === t.value}>
      <input type="radio" name="question-type" value={t.value} bind:group={value} {disabled} />
      <span class="glyph" aria-hidden="true">{t.glyph}</span>
      <span>{t.label}</span>
    </label>
  {/each}
</fieldset>

<style>
  .picker { display: flex; flex-wrap: wrap; gap: var(--space-2); border: none; padding: 0; margin: 0; }
  legend { padding: 0; font-weight: 600; }
  label { display: inline-flex; align-items: center; gap: 4px; padding: var(--space-1) var(--space-2);
          border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
  label.selected { border-color: var(--accent, #46c); background: var(--accent-bg, #eef); }
  input { margin: 0; }
  fieldset:disabled label { opacity: 0.5; cursor: not-allowed; }
</style>
```

A minimal leaf test (`frontend/src/tests/QuestionTypePicker.svelte.test.ts`), mirroring `ItemTypePicker`'s:

```ts
import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import QuestionTypePicker from '../components/editor/QuestionTypePicker.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('offers four type radios and binds the selection', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer' } =
    $state({ value: 'single_choice' });
  const cmp = mount(QuestionTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  expect(target.querySelectorAll('input[name="question-type"]')).toHaveLength(4);
  (target.querySelector('input[value="numeric_answer"]') as HTMLInputElement).click();
  flushSync();
  expect(props.value).toBe('numeric_answer');
});
```

- [ ] **Step 5: Flesh out `QuizEditor` — load (token-guarded), list, dirty registry, title rename, answer-collecting add form**

Replace `frontend/src/components/editor/QuizEditor.svelte` with:

```svelte
<script lang="ts">
  import { onMount, onDestroy, setContext } from 'svelte';
  import type { AdminTreeVersion } from '../../lib/types';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import QuestionAccordion from './QuestionAccordion.svelte';
  import QuestionTypePicker from './QuestionTypePicker.svelte';
  import {
    listQuestions, createQuestion, deleteQuestion, reorderQuestions, renameItem,
    validateNumericAnswer,
    type AuthoringQuestion, type QuestionType, type QuestionCreateBody,
  } from '../../lib/quizAuthoring';

  let {
    itemId, vid, itemTitle, version, perms, assetContext, quizDirty = $bindable(false),
  }: {
    itemId: number; vid: number; itemTitle: string;
    version: AdminTreeVersion; perms: VersionPermissions; assetContext: AssetContext;
    quizDirty?: boolean;
  } = $props();
  void version; // threaded for Plan B (max_quiz_attempts); unused in Plan A

  // ---- Dirty registry (own; ItemEditPage has no DIRTY_REGISTRY_KEY context) ----
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
  $effect(() => { quizDirty = registry.isAnyDirty(); });

  // ---- Lifecycle guard (§4.1a) ----
  let alive = true;
  let loadToken = 0;
  onDestroy(() => { alive = false; loadToken++; });

  // ---- Question list (authoritative; metadata + order) ----
  let questions = $state<AuthoringQuestion[]>([]);
  let loadStatus = $state<'loading' | 'loaded' | 'error'>('loading');
  let loadError = $state<string | null>(null);
  let expandedId = $state<number | null>(null);
  let questionsLocked = $state(false); // serialize add/delete/reorder (§7.2)

  async function load() {
    loadToken += 1;
    const myToken = loadToken;
    loadStatus = 'loading';
    loadError = null;
    try {
      const list = await listQuestions(itemId);
      if (myToken !== loadToken) return;
      questions = [...list].sort((a, b) => a.order - b.order);
      loadStatus = 'loaded';
    } catch (e) {
      if (myToken !== loadToken) return;
      loadError = e instanceof ApiError ? e.displayMessage : 'Could not load questions.';
      loadStatus = 'error';
    }
  }
  onMount(() => { void load(); });

  // ---- Quiz-title rename. `savedTitle` is the last-PERSISTED title — Discard
  //      reverts to it, NOT to the `itemTitle` prop (which only catches up after
  //      a successful forced reload; if that reload fails, the prop is stale). ----
  let savedTitle = $state(itemTitle);
  const titleTracker = makeDirtyTracker<{ title: string }>({ title: itemTitle });
  let titleBusy = $state(false);
  $effect(() => { registry.register(titleTracker); return () => registry.unregister(titleTracker); });

  async function saveTitle() {
    if (titleBusy || !titleTracker.isDirty || !perms.canEditTextFields) return;
    const savedVid = vid;
    const next = titleTracker.current.title;
    titleBusy = true;
    try {
      const res = await renameItem(itemId, next);     // server echoes the persisted title
      if (alive && vid === savedVid) {
        savedTitle = res.title;                        // advance baseline from the response
        titleTracker.reset({ title: res.title });      // reset BEFORE the reload await
        await loadAdminTree(savedVid, { force: true });
      }
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Rename failed', 'error');
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      if (alive) titleBusy = false;
    }
  }
  function discardTitle() { titleTracker.reset({ title: savedTitle }); }

  // ---- Add-question form: collects the per-type CORRECT ANSWER at creation,
  //      because the backend does NOT validate correctness on create
  //      (questions.py:116 validates only on update; §3.6/§8). Fabricated
  //      defaults are NOT acceptable — they ship a wrong-but-valid-looking key. ----
  let adding = $state(false);
  let newType = $state<QuestionType>('single_choice');
  let newText = $state('');
  let newNumeric = $state('');     // numeric_answer: raw string, validated via §8.3
  let newPrecision = $state(0);    // numeric_answer: integer 0–10
  let newAnswer = $state('');      // text_answer: 1–500 chars
  let addError = $state<string | null>(null);

  const newNumericCheck = $derived(
    newType === 'numeric_answer' ? validateNumericAnswer(newNumeric) : { ok: true as const, canonical: '' },
  );
  const newNumericError = $derived(newNumericCheck.ok ? null : newNumericCheck.reason);
  const newPrecisionValid = $derived(
    Number.isInteger(newPrecision) && newPrecision >= 0 && newPrecision <= 10,
  );
  const addValid = $derived(
    newText.trim() !== '' && (
      newType === 'numeric_answer' ? (newNumericCheck.ok && newPrecisionValid)
        : newType === 'text_answer' ? (newAnswer.trim().length >= 1 && newAnswer.length <= 500)
          : true   // choice types: options (hence correctness) are added in Plan B
    ),
  );

  function resetAddForm() {
    newText = ''; newNumeric = ''; newPrecision = 0; newAnswer = ''; addError = null;
  }

  function buildCreateBody(): QuestionCreateBody {
    const base = { text_md: newText.trim(), type: newType };
    if (newType === 'numeric_answer' && newNumericCheck.ok) {
      return { ...base, correct_numeric: Number(newNumericCheck.canonical), precision: newPrecision };
    }
    if (newType === 'text_answer') return { ...base, correct_text: newAnswer };
    return base;  // single_choice / multiple_choice — options added in Plan B
  }

  async function submitAdd() {
    if (questionsLocked || !perms.canEditStructure || !addValid) return;
    const savedVid = vid;                            // capture live vid BEFORE await
    const body = buildCreateBody();
    addError = null;
    questionsLocked = true;
    try {
      const created = await createQuestion(itemId, body);
      if (!(alive && vid === savedVid)) return;      // stale / navigated → discard
      questions = [...questions, created].sort((a, b) => a.order - b.order);
      adding = false; resetAddForm();
      expandedId = created.id;                        // open the new question for editing
      await loadAdminTree(savedVid, { force: true }); // refresh questions_count
    } catch (e) {
      if (alive && vid === savedVid) addError = e instanceof ApiError ? e.displayMessage : 'Add failed';
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  // ---- Delete question ----
  async function removeQuestion(qid: number) {
    if (questionsLocked || !perms.canEditStructure) return;
    if (!questions.some((x) => x.id === qid)) return;
    if (!confirm('Delete this question? Its options and text are lost.')) return;
    const savedVid = vid;                            // capture live vid BEFORE await
    questionsLocked = true;
    try {
      await deleteQuestion(qid);
      if (!(alive && vid === savedVid)) return;
      questions = questions.filter((x) => x.id !== qid);
      if (expandedId === qid) expandedId = null;
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
        await load();                                 // resync the list (token-guarded)
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  // ---- Reorder question (↑/↓): optimistic local swap, POST full id-set ----
  async function move(qid: number, dir: -1 | 1) {
    if (questionsLocked || !perms.canEditStructure) return;
    const idx = questions.findIndex((x) => x.id === qid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= questions.length) return;
    const savedVid = vid;                            // capture live vid BEFORE await
    const next = [...questions];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    questions = next.map((x, i) => ({ ...x, order: i + 1 }));
    const order = questions.map((x) => ({ id: x.id, order: x.order }));
    questionsLocked = true;
    try {
      await reorderQuestions(itemId, order);
      // success: optimistic state is authoritative; order is not shown in the
      // admin tree, so no forced reload is needed.
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
        await load();                                 // resync from server on error
      }
    } finally {
      if (alive) questionsLocked = false;
    }
  }

  function toggleExpand(qid: number) { expandedId = expandedId === qid ? null : qid; }
  const titleReadOnly = $derived(!perms.canEditTextFields);
  const structureOff = $derived(!perms.canEditStructure);
</script>

<section class="quiz-editor" aria-label="Quiz editor">
  <div class="title-row">
    <label>Quiz title
      <input data-testid="quiz-title" bind:value={titleTracker.current.title} readonly={titleReadOnly} required />
    </label>
    {#if !titleReadOnly}
      <Button onclick={saveTitle} disabled={!titleTracker.isDirty || titleBusy} loading={titleBusy}>Save title</Button>
      <Button variant="ghost" onclick={discardTitle} disabled={!titleTracker.isDirty || titleBusy}>Discard</Button>
    {/if}
  </div>

  {#if loadStatus === 'loading'}
    <p class="muted">Loading questions…</p>
  {:else if loadStatus === 'error'}
    <p class="err" role="alert">{loadError}</p>
    <Button variant="ghost" onclick={() => void load()}>Retry</Button>
  {:else}
    {#if questions.length === 0}
      <p class="muted">No questions yet.</p>
    {:else}
      <ol class="questions">
        {#each questions as q, i (q.id)}
          <li>
            <QuestionAccordion
              question={q}
              {vid}
              index={i + 1}
              count={questions.length}
              {perms}
              {assetContext}
              locked={questionsLocked}
              expanded={expandedId === q.id}
              onExpandToggle={() => toggleExpand(q.id)}
              onDelete={() => void removeQuestion(q.id)}
              onMoveUp={() => void move(q.id, -1)}
              onMoveDown={() => void move(q.id, 1)}
            />
          </li>
        {/each}
      </ol>
    {/if}

    {#if !structureOff}
      {#if adding}
        <div class="add-form">
          <QuestionTypePicker bind:value={newType} disabled={questionsLocked} />
          <label>Question text
            <input data-testid="new-question-text" bind:value={newText} required />
          </label>
          {#if newType === 'numeric_answer'}
            <label>Correct value
              <input data-testid="new-numeric" bind:value={newNumeric} aria-invalid={!newNumericCheck.ok} />
            </label>
            <label>Precision (0–10)
              <input data-testid="new-precision" type="number" min="0" max="10" bind:value={newPrecision} />
            </label>
            {#if newNumericError}<p class="err" role="alert">{newNumericError}</p>{/if}
            {#if !newPrecisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
          {:else if newType === 'text_answer'}
            <label>Correct answer
              <input data-testid="new-text-answer" bind:value={newAnswer} maxlength="500" />
            </label>
          {:else}
            <p class="muted">Add answer options after creating (next slice).</p>
          {/if}
          {#if addError}<p class="err" role="alert">{addError}</p>{/if}
          <Button onclick={() => void submitAdd()} disabled={questionsLocked || !addValid}>Add</Button>
          <Button variant="ghost" onclick={() => { adding = false; resetAddForm(); }}>Cancel</Button>
        </div>
      {:else}
        <Button onclick={() => { adding = true; }} disabled={questionsLocked}>＋ Add question</Button>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .quiz-editor { display: flex; flex-direction: column; gap: var(--space-3); }
  .title-row { display: flex; align-items: end; gap: var(--space-2); }
  .questions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .muted { color: var(--text-muted, #666); }
  .err { color: var(--danger, #c00); }
</style>
```

- [ ] **Step 6: Run the load/list/empty tests — expect PASS**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts`
Expected: PASS (load+sort, empty-state).

- [ ] **Step 7: Add tests for add / delete / reorder / lock / title / retry**

Append to `frontend/src/tests/QuizEditor.svelte.test.ts`. These use stable `data-testid` hooks (the add-form text input is NOT the first unnamed input — the quiz-title input renders earlier, so select by testid):

```ts
import * as store from '../stores/currentEditorVersion.svelte';

// ---- helpers (robust to markup; the data-testids are the contract) ----
function clickByText(target: HTMLElement, text: string) {
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement).click();
}
function openAddForm(target: HTMLElement) {
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.includes('Add question')) as HTMLButtonElement).click();
  flushSync();
}
function setInput(target: HTMLElement, testid: string, value: string) {
  const el = target.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement;
  el.value = value; el.dispatchEvent(new Event('input')); flushSync();
}
function selectType(target: HTMLElement, type: string) {
  (target.querySelector(`input[name="question-type"][value="${type}"]`) as HTMLInputElement).click();
  flushSync();
}

it('adds a numeric question with a VALIDATED answer, appends it, force-refreshes', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(q({ id: 5, type: 'numeric_answer', text_md: 'Added', order: 1 }));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  openAddForm(target);
  selectType(target, 'numeric_answer');
  setInput(target, 'new-question-text', 'Added');
  setInput(target, 'new-numeric', '5');
  setInput(target, 'new-precision', '0');
  clickByText(target, 'Add');
  await tick(); await tick(); flushSync();
  // Real values, NOT fabricated defaults:
  expect(create).toHaveBeenCalledWith(4, { text_md: 'Added', type: 'numeric_answer', correct_numeric: 5, precision: 0 });
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.textContent).toContain('Added');
});

it('blocks Add for a numeric question with an invalid answer (§8.3)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(q());
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  openAddForm(target);
  selectType(target, 'numeric_answer');
  setInput(target, 'new-question-text', 'Bad');
  setInput(target, 'new-numeric', '1.5e-20');   // 21 fractional digits → invalid
  const add = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  expect(create).not.toHaveBeenCalled();
});

it('creates a text_answer question with the collected correct_text (not fabricated)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(
    q({ id: 6, type: 'text_answer', text_md: 'Cap?', correct_text: 'Paris', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'Cap?');
  setInput(target, 'new-text-answer', 'Paris');
  clickByText(target, 'Add');
  await tick(); await tick(); flushSync();
  expect(create).toHaveBeenCalledWith(4, { text_md: 'Cap?', type: 'text_answer', correct_text: 'Paris' });
});

it('creates single_choice and multiple_choice with NO correctness fields (options are Plan B)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion')
    .mockResolvedValueOnce(q({ id: 7, type: 'single_choice', text_md: 'Pick one', correct_numeric: null, precision: null }))
    .mockResolvedValueOnce(q({ id: 8, type: 'multiple_choice', text_md: 'Pick many', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  openAddForm(target);
  selectType(target, 'single_choice');
  setInput(target, 'new-question-text', 'Pick one');
  clickByText(target, 'Add');
  await tick(); await tick(); flushSync();
  expect(create).toHaveBeenLastCalledWith(4, { text_md: 'Pick one', type: 'single_choice' });
  // multiple_choice takes the same create path (distinct id → no duplicate key)
  openAddForm(target);
  selectType(target, 'multiple_choice');
  setInput(target, 'new-question-text', 'Pick many');
  clickByText(target, 'Add');
  await tick(); await tick(); flushSync();
  expect(create).toHaveBeenLastCalledWith(4, { text_md: 'Pick many', type: 'multiple_choice' });
});

it('reorder ↑ swaps order and POSTs the full id-set', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  const reorder = vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined);
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  const upButtons = [...target.querySelectorAll('button[aria-label="Move up"]')] as HTMLButtonElement[];
  upButtons[1].click(); // move B (2nd row) up
  await tick(); flushSync();
  expect(reorder).toHaveBeenCalledWith(4, [{ id: 2, order: 1 }, { id: 1, order: 2 }]);
});

it('deletes a question after confirm and force-refreshes', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' })]);
  const del = vi.spyOn(qa, 'deleteQuestion').mockResolvedValue();
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  (target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();
  expect(del).toHaveBeenCalledWith(1);
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.querySelector('[data-testid="question-header"]')).toBeNull();
});

it('disables a row’s structural controls while an add is in flight (questionsLocked, §7.2)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' })]);
  let resolveCreate!: (created: AuthoringQuestion) => void;
  vi.spyOn(qa, 'createQuestion').mockReturnValue(new Promise((r) => { resolveCreate = r; }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'Q');
  setInput(target, 'new-text-answer', 'a');
  clickByText(target, 'Add');            // create pending → questionsLocked = true
  await tick(); flushSync();
  const del = target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement;
  expect(del.disabled).toBe(true);
  resolveCreate(q({ id: 2, type: 'text_answer' }));
  await tick(); await tick(); flushSync();
});

it('title edit flips quizDirty; Save calls renameItem then force-refresh', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const rename = vi.spyOn(qa, 'renameItem').mockResolvedValue({ id: 4, title: 'Renamed' });
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountEditor();
  await tick(); await tick(); flushSync();
  setInput(target, 'quiz-title', 'Renamed');
  await tick(); flushSync();
  expect(props.quizDirty).toBe(true);
  clickByText(target, 'Save title');
  await tick(); await tick(); flushSync();
  expect(rename).toHaveBeenCalledWith(4, 'Renamed');
});

it('shows an error then re-loads on Retry (loadToken increments per load)', async () => {
  const list = vi.spyOn(qa, 'listQuestions')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce([q({ id: 3, text_md: 'Recovered' })]);
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  expect(target.querySelector('[role="alert"]')?.textContent).toContain('Could not load questions');
  clickByText(target, 'Retry');
  await tick(); await tick(); flushSync();
  expect(target.textContent).toContain('Recovered');
  expect(list).toHaveBeenCalledTimes(2);
});
```

> **Implementer note:** the assertions (exact wrapper-call args, `quizDirty` flip, full reorder id-set, locked-button `disabled`, `createQuestion` receiving REAL not fabricated values) are the contract — keep them exact. The `onDestroy(() => loadToken++)` unmount guard is exercised by not throwing on unmount-during-load; that is covered by the no-console-errors check in the manual smoke (Task-4 Step 7), not a separate DOM-less assertion.

- [ ] **Step 8: Run all QuizEditor + picker tests + type-check — expect PASS**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts src/tests/QuestionTypePicker.svelte.test.ts && npx svelte-check --threshold error`
Expected: PASS; no type errors (`noUnusedLocals`/`noUnusedParameters` clean — no `nextOrder`, no unused imports).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/editor/QuizEditor.svelte \
        frontend/src/components/editor/QuestionAccordion.svelte \
        frontend/src/components/editor/QuestionTypePicker.svelte \
        frontend/src/tests/QuizEditor.svelte.test.ts \
        frontend/src/tests/QuestionTypePicker.svelte.test.ts
git commit -m "feat(quiz-authoring): QuizEditor load + question CRUD + title rename + dirty registry (T3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `QuestionAccordion` body — per-type forms, text Save/Discard, create-time validation, §7.2 lock

**Files:**
- Modify: `frontend/src/components/editor/QuestionAccordion.svelte` (add the body)
- Test: `frontend/src/tests/QuestionAccordion.svelte.test.ts`

**Interfaces:**
- Consumes: `updateQuestion` + `AuthoringQuestion` + `validateNumericAnswer` from `lib/quizAuthoring`; the registry + `RegisteredTracker`/`DirtyRegistry` types via `getContext(DIRTY_REGISTRY_KEY)`; `MarkdownEditor`. The accordion gains a `locked: boolean` prop from `QuizEditor` (the accordion-wide §7.2 lock).
- Produces: the accordion body renders when `expanded`; owns a `draft` (bound to inputs) + a `saved` baseline, both `$state` seeded ONCE from the prop. A single registered `RegisteredTracker` shim reports `dirty = draft ≠ saved` (lives on the always-mounted accordion, so it survives body collapse). Save PATCHes via `updateQuestion`, then **advances `saved`** from the response so the form goes clean; Discard reverts `draft` to `saved` (NOT to the original prop). Numeric bodies validate via `validateNumericAnswer` + precision 0–10; text bodies validate 1–500; choice bodies show a Plan-B placeholder. When `!perms.canEditTextFields` (disabled/archived) the fields are read-only and Save/Discard are hidden. Structural controls are disabled when no structure perm, OR this form is dirty (text-side lock), OR `locked` (accordion-wide).

- [ ] **Step 1: Write the failing test — body renders + text Save**

Create `frontend/src/tests/QuestionAccordion.svelte.test.ts`:

```ts
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import * as qa from '../lib/quizAuthoring';
import type { AuthoringQuestion } from '../lib/quizAuthoring';
import { versionPermissions } from '../lib/versionPermissions';
// The Harness injects a dirty registry via context (QuizEditor does this in
// prod) and exposes registry.isAnyDirty() at [data-testid="any-dirty"].
import Harness from './support/QuestionAccordionHarness.svelte';

const PERMS = versionPermissions({ state: 'created', is_disabled: false });
const stubAssetCtx = () => ({ kind: 'course', list: vi.fn().mockResolvedValue([]), upload: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined), imgSrc: () => '', renderPreview: vi.fn().mockResolvedValue({ html: '' }) }) as never;

const q = (over: Partial<AuthoringQuestion> = {}): AuthoringQuestion => ({
  id: 1, item_id: 4, text_md: 'Q', text_html: '<p>Q</p>', type: 'numeric_answer', order: 1,
  explanation_md: null, explanation_html: null, correct_numeric: 3, precision: 0, correct_text: null, ...over,
});

let cleanup: (() => void) | null = null;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

function mountAccordion(question: AuthoringQuestion, over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: Record<string, unknown> = $state({
    question, vid: 10, index: 1, count: 1, perms: PERMS, assetContext: stubAssetCtx(),
    expanded: true, locked: false,
    onExpandToggle: () => {}, onDelete: () => {}, onMoveUp: () => {}, onMoveDown: () => {}, ...over,
  });
  const cmp = mount(Harness, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}
const saveBtn = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
const discardBtn = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Discard') as HTMLButtonElement;
const setVal = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => { el.value = v; el.dispatchEvent(new Event('input')); };

it('numeric body: Save sends the canonical value, then the form is clean (no stale dirty)', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ correct_numeric: 0.05 }));
  const { target } = mountAccordion(q());
  flushSync();
  setVal(target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement, '0.0500');
  await tick(); flushSync();
  saveBtn(target).click();
  await tick(); flushSync();
  expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ correct_numeric: 0.05, precision: 0 }));
  // IMPORTANT-1 regression: a successful Save must NOT leave the form dirty.
  expect(saveBtn(target).disabled).toBe(true);
  expect(target.querySelector('[data-testid="any-dirty"]')?.textContent).toBe('clean');
});

it('numeric body: an invalid answer blocks Save and shows an inline error', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q());
  const { target } = mountAccordion(q());
  flushSync();
  setVal(target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement, '1.5e-20');
  await tick(); flushSync();
  expect(saveBtn(target).disabled).toBe(true);
  expect(target.querySelector('[role="alert"]')).not.toBeNull();
  expect(update).not.toHaveBeenCalled();
});

it('numeric body: a precision outside 0–10 blocks Save (IMPORTANT-2)', async () => {
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q());
  const { target } = mountAccordion(q());
  flushSync();
  setVal(target.querySelector('[data-testid="precision-input"]') as HTMLInputElement, '11');
  await tick(); flushSync();
  expect(saveBtn(target).disabled).toBe(true);
});

it('text body: Save sends correct_text; >500 chars blocks Save', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ type: 'text_answer', correct_text: 'paris', correct_numeric: null, precision: null }));
  const { target } = mountAccordion(q({ type: 'text_answer', correct_text: 'answer', correct_numeric: null, precision: null }));
  flushSync();
  const txt = target.querySelector('[data-testid="text-answer-input"]') as HTMLInputElement;
  setVal(txt, 'paris');
  await tick(); flushSync();
  saveBtn(target).click();
  await tick(); flushSync();
  expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ correct_text: 'paris' }));
  setVal(txt, 'x'.repeat(501));   // jsdom does not enforce maxlength on programmatic .value
  await tick(); flushSync();
  expect(saveBtn(target).disabled).toBe(true);
});

it('text_md edited via the Markdown editor is included in Save', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ text_md: 'New body', text_html: '<p>New body</p>' }));
  const { target } = mountAccordion(q());
  flushSync();
  // First textarea = the question-text MarkdownEditor (second = explanation).
  setVal(target.querySelector('textarea') as HTMLTextAreaElement, 'New body');
  await tick(); flushSync();
  saveBtn(target).click();
  await tick(); flushSync();
  expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ text_md: 'New body' }));
});

it('Discard reverts edits to the last-saved baseline', async () => {
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q());
  const { target } = mountAccordion(q({ correct_numeric: 3 }));
  flushSync();
  setVal(target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement, '9');
  await tick(); flushSync();
  discardBtn(target).click();
  await tick(); flushSync();
  expect((target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement).value).toBe('3');
  expect(saveBtn(target).disabled).toBe(true);
});

it('disabled/archived version → fields read-only and no Save button (IMPORTANT-3)', async () => {
  const LOCKED_PERMS = versionPermissions({ state: 'created', is_disabled: true });
  const { target } = mountAccordion(q(), { perms: LOCKED_PERMS });
  flushSync();
  expect((target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement).readOnly).toBe(true);
  expect([...target.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Save')).toBe(false);
});
```

Create the harness `frontend/src/tests/support/QuestionAccordionHarness.svelte`. It provides the registry context the accordion expects AND surfaces `registry.isAnyDirty()` so tests can assert the tracker survives body collapse:

```svelte
<script lang="ts">
  import { setContext } from 'svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import QuestionAccordion from '../../components/editor/QuestionAccordion.svelte';
  let props = $props();
  const registry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, registry);
</script>
<output data-testid="any-dirty">{registry.isAnyDirty() ? 'dirty' : 'clean'}</output>
<QuestionAccordion {...props} />
```

- [ ] **Step 2: Run it — expect failure (stub has no body)**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts`
Expected: FAIL — no `[data-testid="numeric-input"]` etc.

- [ ] **Step 3: Add the accordion body — draft/saved baseline, per-type forms, read-only gating, lock**

Replace `frontend/src/components/editor/QuestionAccordion.svelte` with (the T3 header + the new body). Note the header now ANDs `dirty` and `locked` into `structureDisabled` (T3's stub only had `locked`):

```svelte
<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import type { AuthoringQuestion } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';
  import { ApiError } from '../../lib/api';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { updateQuestion, validateNumericAnswer } from '../../lib/quizAuthoring';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Button from '../ui/Button.svelte';
  import { pushToast } from '../../stores/toasts.svelte';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked,
    onExpandToggle, onDelete, onMoveUp, onMoveDown,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  const registry = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);

  // ---- Lifecycle guard (§4.1a). A question Save does NOT reload the admin tree
  //      (§10: per-question Save → no extra reload), but per §4.1a EVERY post-await
  //      write is still gated by `alive && vid === savedVid` (vid = the live route
  //      prop). In practice the accordion remounts on a version change (item.id
  //      changes → `{#key item.id}` in ItemEditPage tears it down → alive=false),
  //      so `alive` alone usually suffices — the vid check makes the guard robust
  //      without depending on that item-id-uniqueness invariant. ----
  let alive = true;
  onDestroy(() => { alive = false; });

  // ---- Working copy (`draft`, bound to the inputs) + last-persisted baseline
  //      (`saved`). Both seeded ONCE from the prop; the prop is NEVER mutated.
  //      `saved` advances on a successful PATCH so the form goes clean and
  //      Discard reverts to it — NOT to the original prop. ----
  const seed = () => ({
    text_md: question.text_md,
    explanation_md: question.explanation_md ?? '',
    numericInput: question.correct_numeric == null ? '' : String(question.correct_numeric),
    precision: question.precision ?? 0,
    correct_text: question.correct_text ?? '',
  });
  let saved = $state(seed());
  let draft = $state(seed());
  let textHtml = $state(question.text_html);   // header snippet; advances on Save

  const editable = $derived(perms.canEditTextFields);

  // ---- Per-type answer validity ----
  const numericCheck = $derived(
    question.type === 'numeric_answer' ? validateNumericAnswer(draft.numericInput) : { ok: true as const, canonical: '' },
  );
  const numericError = $derived(numericCheck.ok ? null : numericCheck.reason);
  const precisionValid = $derived(
    Number.isInteger(draft.precision) && draft.precision >= 0 && draft.precision <= 10,
  );
  const textAnswerValid = $derived(draft.correct_text.trim().length >= 1 && draft.correct_text.length <= 500);
  const answerValid = $derived(
    question.type === 'numeric_answer' ? (numericCheck.ok && precisionValid)
      : question.type === 'text_answer' ? textAnswerValid : true,
  );

  // ---- Dirty = draft differs from the saved baseline (text + per-type answer).
  //      One registered tracker on the ALWAYS-MOUNTED accordion — it survives
  //      body collapse (the body's inputs/MarkdownEditors unmount; this does not). ----
  const dirty = $derived(
    draft.text_md !== saved.text_md ||
    draft.explanation_md !== saved.explanation_md ||
    (question.type === 'numeric_answer' && (draft.numericInput !== saved.numericInput || draft.precision !== saved.precision)) ||
    (question.type === 'text_answer' && draft.correct_text !== saved.correct_text),
  );
  const tracker: RegisteredTracker = { get isDirty() { return dirty; } };
  $effect(() => { registry.register(tracker); return () => registry.unregister(tracker); });

  let saveBusy = $state(false);
  const canSave = $derived(dirty && answerValid && !saveBusy && editable);

  async function save() {
    if (!canSave) return;
    const savedVid = vid;                            // capture live vid BEFORE await (§4.1a)
    const body: Record<string, unknown> = {};
    if (draft.text_md !== saved.text_md) body.text_md = draft.text_md;
    body.explanation_md = draft.explanation_md === '' ? null : draft.explanation_md;
    if (question.type === 'numeric_answer' && numericCheck.ok) {
      body.correct_numeric = Number(numericCheck.canonical);
      body.precision = draft.precision;
    }
    if (question.type === 'text_answer') body.correct_text = draft.correct_text;
    saveBusy = true;
    try {
      const updated = await updateQuestion(question.id, body);
      if (!(alive && vid === savedVid)) return;      // unmounted / route changed → discard write
      saved = {
        text_md: updated.text_md,
        explanation_md: updated.explanation_md ?? '',
        numericInput: updated.correct_numeric == null ? '' : String(updated.correct_numeric),
        precision: updated.precision ?? 0,
        correct_text: updated.correct_text ?? '',
      };
      draft = { ...saved };                           // advance baseline → form goes clean
      textHtml = updated.text_html;
    } catch (e) {
      if (alive && vid === savedVid) pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      if (alive) saveBusy = false;
    }
  }
  function discard() { draft = { ...saved }; }        // revert to the last-saved baseline

  // §7.2 + shared lock: structural controls are disabled when there is no
  // structure perm, OR this question's form is dirty (text-side lock), OR an
  // accordion-wide add/delete/reorder is in flight (`locked`).
  const structureDisabled = $derived(!perms.canEditStructure || dirty || locked);

  const snippet = $derived(textHtml.replace(/<[^>]*>/g, '').trim().slice(0, 80));
  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'Single choice', multiple_choice: 'Multiple choice',
    numeric_answer: 'Numeric', text_answer: 'Text',
  };
  const toleranceHint = $derived(`± ${5 * Math.pow(10, -(draft.precision + 1))}`);
</script>

<div class="question" class:expanded>
  <div class="header" data-testid="question-header">
    <button type="button" class="expand" aria-expanded={expanded} onclick={onExpandToggle}>{expanded ? '▾' : '▸'}</button>
    <span class="num">{index}.</span>
    <span class="badge">{typeLabel[question.type]}</span>
    <span class="snippet">{snippet || '(no text)'}</span>
    <span class="spacer"></span>
    <button type="button" aria-label="Move up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete question" disabled={structureDisabled} onclick={onDelete}>🗑</button>
  </div>

  {#if expanded}
    <div class="body">
      <span class="readonly-type">Type: {typeLabel[question.type]} (fixed)</span>
      <label>Question text
        <MarkdownEditor {assetContext} readOnly={!editable} bind:value={draft.text_md} />
      </label>
      <label>Explanation (optional)
        <MarkdownEditor {assetContext} readOnly={!editable} bind:value={draft.explanation_md} />
      </label>

      {#if question.type === 'numeric_answer'}
        <label>Correct value
          <input data-testid="numeric-input" bind:value={draft.numericInput}
                 readonly={!editable} aria-required="true" aria-invalid={!numericCheck.ok} />
        </label>
        <label>Precision (0–10)
          <input data-testid="precision-input" type="number" min="0" max="10"
                 readonly={!editable} bind:value={draft.precision} />
        </label>
        <small class="hint">Accepted within {toleranceHint}</small>
        {#if numericError}<p class="err" role="alert">{numericError}</p>{/if}
        {#if !precisionValid}<p class="err" role="alert">Precision must be an integer 0–10.</p>{/if}
      {:else if question.type === 'text_answer'}
        <label>Correct answer
          <input data-testid="text-answer-input" bind:value={draft.correct_text}
                 readonly={!editable} maxlength="500" aria-required="true" aria-invalid={!textAnswerValid} />
        </label>
        <small class="hint">Case-insensitive, trimmed match. {draft.correct_text.length}/500</small>
        {#if !textAnswerValid}<p class="err" role="alert">Enter 1–500 characters.</p>{/if}
      {:else}
        <p class="muted">Options are edited in the next slice (Plan B).</p>
      {/if}

      {#if editable}
        <div class="row">
          <Button onclick={() => void save()} disabled={!canSave} loading={saveBusy}>Save</Button>
          <Button variant="ghost" onclick={discard} disabled={!dirty || saveBusy}>Discard</Button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .question { border: 1px solid var(--border); border-radius: var(--radius); }
  .header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); }
  .body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2); border-top: 1px solid var(--border); }
  .spacer { flex: 1; }
  .badge, .muted { font-size: 0.85em; color: var(--text-muted, #666); }
  .err { color: var(--danger, #c00); }
</style>
```

- [ ] **Step 4: Run the body tests — expect PASS**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts`
Expected: PASS (numeric Save canonical value, invalid blocks Save, text Save).

- [ ] **Step 5: Add tests for the §7.2 dirty/locked structural lock + collapse-survival**

Append to `frontend/src/tests/QuestionAccordion.svelte.test.ts`:

```ts
it('a dirty form disables this question’s delete/reorder (§7.2 text side)', async () => {
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q());
  const { target } = mountAccordion(q());
  flushSync();
  setVal(target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement, '7');
  await tick(); flushSync();
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
});

it('the accordion-wide `locked` prop disables structural controls even when clean (IMPORTANT-4)', async () => {
  const { target, props } = mountAccordion(q());   // not dirty
  flushSync();
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(false);
  props.locked = true;
  await tick(); flushSync();
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
});

it('the dirty tracker survives body collapse (lives on the always-mounted accordion)', async () => {
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q());
  const { target, props } = mountAccordion(q());
  flushSync();
  setVal(target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement, '7');
  await tick(); flushSync();
  expect(target.querySelector('[data-testid="any-dirty"]')?.textContent).toBe('dirty');
  props.expanded = false;                           // collapse → body inputs unmount
  await tick(); flushSync();
  expect(target.querySelector('[data-testid="numeric-input"]')).toBeNull();   // body is gone
  expect(target.querySelector('[data-testid="any-dirty"]')?.textContent).toBe('dirty'); // tracker survives
});

it('discards a Save response that resolves after a route (vid) change (§4.1a)', async () => {
  let resolveSave!: (updated: AuthoringQuestion) => void;
  vi.spyOn(qa, 'updateQuestion').mockReturnValue(new Promise((r) => { resolveSave = r; }));
  const { target, props } = mountAccordion(q({ correct_numeric: 3 }));
  flushSync();
  setVal(target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement, '0.05');
  await tick(); flushSync();
  saveBtn(target).click();                          // updateQuestion now pending
  await tick(); flushSync();
  props.vid = 11;                                   // route swapped to another version mid-save
  await tick(); flushSync();
  resolveSave(q({ correct_numeric: 0.05 }));        // stale response for the OLD vid
  await tick(); flushSync();
  // Guard (alive && vid === savedVid) fired → baseline NOT advanced:
  expect(target.querySelector('[data-testid="any-dirty"]')?.textContent).toBe('dirty');
  expect((target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement).value).toBe('0.05');
});
```

- [ ] **Step 6: Run all QuestionAccordion tests + full suite + type-check**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts && npx vitest run && npx svelte-check --threshold error`
Expected: the new tests PASS, the full frontend suite stays green, no type errors.

- [ ] **Step 7: Manual smoke (numeric + text authoring end-to-end on a created version)**

Dev server: open a `created` version, add a **numeric** question → set value `0.05` + precision `0` → Save → confirm it persists on reload; add a **text** question → set answer → Save. Confirm a dirty text form disables that question's delete/reorder, and that navigating away with an unsaved question triggers the DirtyGuard prompt.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/editor/QuestionAccordion.svelte \
        frontend/src/tests/QuestionAccordion.svelte.test.ts \
        frontend/src/tests/support/QuestionAccordionHarness.svelte
git commit -m "feat(quiz-authoring): QuestionAccordion body — per-type forms, text Save, §7.2 lock (T4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Plan A — Self-review notes (coverage vs. spec)

- **§5 types / wrappers** → T1 (incl. the float-safe numeric validator §8.3; the `<10^10` magnitude bound matches the DB `Numeric(20,10)` column).
- **§4 / §13 ItemEditPage dedicated branch (C1), no `quiz` in `editable`** → T2 (the `{:else if item.type === 'quiz'}{#key item.id}` arm, `quizDirty` state/bind, delete-gate + DirtyGuard extensions, and the `quizDirty = false` reset in `ensureLoaded` on item navigation).
- **ItemTypePicker + SequenceAccordion quiz-create + `QuestionTypePicker` (§13)** → T2 (picker radio + create wiring), T3 (`QuestionTypePicker` component, used by the add form).
- **§6 load (token-guarded, onMount, onDestroy bump) + §4.1a lifecycle guard (`savedVid = vid` captured BEFORE every await, `alive && vid===savedVid` on every post-await write/forced reload)** → T3 (add/delete/reorder/title) and T4 (question Save also gates its post-PATCH write on `alive && vid===savedVid`, even though it does no tree reload per §10 — uniform §4.1a compliance, robust to the `{#key item.id}` remount assumption).
- **§7.1 dirty registry / `quizDirty` / title rename (reset baseline BEFORE the forced reload)** → T3.
- **Question add/delete/reorder + `questionsLocked` serialization, passed to each `QuestionAccordion` as `locked` (§7.2 shared-lock UI)** → T3.
- **Create-time correctness collected + validated in the add form (numeric value+precision via §8.3, text 1–500) — NOT fabricated, because the backend validates correctness only on update (questions.py:116)** → T3.
- **§4.1 QuestionAccordion: draft/saved baseline (Save advances `saved`, Discard reverts to it), per-type Save/Discard, precision 0–10, read-only when `!canEditTextFields`, §7.2 dirty-side + `locked` lock, collapse-surviving tracker** → T4.

**Deferred to Plan B (explicitly NOT in this plan):** option loading (per-accordion token-guarded `listOptions` + Retry), option CRUD, `OptionRow`, single/multiple-choice correctness state machines, `optionsLocked` (option side of §7.2), delete-correct guard (C2), `optionsLocked`-vs-correctness race, §8.7 published answer-key confirm (`confirmKeyChange`), §9 **full** gating table (Plan A enforces only the read-only-when-not-editable basics on the fields it creates), §10 four-origin error taxonomy, §10a accessibility (focus management, aria-live), §15 smoke.

> **Known seam to carry into Plan B:** the choice-type bodies in T4 show a placeholder ("Options edited in the next slice"). Plan B replaces it with the option list + `OptionRow` + the correctness machines, and adds the per-accordion option load. The single registered `RegisteredTracker` shim pattern (`get isDirty() { return dirty }`) established in T3/T4 is what Plan B's option-text drafts register into the same `DIRTY_REGISTRY_KEY` registry.
