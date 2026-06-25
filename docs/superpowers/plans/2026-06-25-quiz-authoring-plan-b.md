# Quiz Authoring in the Course Editor — Plan B (T5–T9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add answer-**option** authoring (load, create, edit-text, delete, reorder, mark-correct) for `single_choice`/`multiple_choice` questions to the course editor, plus version-gating, error handling, the published answer-key confirm, accessibility, and the manual smoke walkthrough — completing the quiz-authoring slice on the existing backend.

**Architecture:** Plan A (merged) built `lib/quizAuthoring.ts`, the `QuizEditor` (question list + title + dirty registry), and the `QuestionAccordion` shell (per-type text/numeric/text-answer forms + §4.1a lifecycle guard + §7.2 text-side lock). Plan B extends `QuestionAccordion` with **its own option loading + ownership** (each accordion fetches `listOptions` for choice types), a new **presentational `OptionRow`**, the two correctness state machines under an **accordion-wide `optionsLocked`**, then layers gating/errors, the §8.7 published-key confirm, and a11y. No backend changes.

**Tech Stack:** Svelte 5 (runes; `$state`/`$derived`/`$effect`/`$props`/`$bindable`), TypeScript, Vitest with `mount`/`unmount`/`flushSync`/`tick` from `svelte` (project convention — **not** `@testing-library`). No new JS/CSS dependencies. Spec: `docs/superpowers/specs/2026-06-21-quiz-authoring-design.md` (rev 15) — the contract; cited as §N below.

## Global Constraints

*Every task's requirements implicitly include this section. Values are copied verbatim from the spec.*

- **Frontend-only.** No backend/schema/endpoint changes. All paths already exist and are gated by `require_course_admin` (§3).
- **Svelte 5 only**; no new JS or CSS dependencies; modular components; styling is minimal/"design later". Callback props (`onMoveUp`, `onDelete`, …) and `$bindable()` values — **not** event dispatch (§4.1).
- **Component tests** use `mount`/`unmount`/`flushSync`/`tick` from `svelte`, mocking `api.*` via `vi.spyOn(qa, …)` / `vi.spyOn(store, 'loadAdminTree')` — the exact pattern in `frontend/src/tests/QuestionAccordion.svelte.test.ts` and `QuizEditor.svelte.test.ts`. Never `@testing-library`.
- **Option endpoint contract (§3.3/§3.4/§3.6):**
  - `OptionResponse = { id, question_id, text, is_correct, order }`.
  - `POST /api/questions/{qid}/options` `OptionCreate { text, is_correct }` → 201. `text` `min_length=1, max_length=500`; **the server does NOT strip** — the UI trims and rejects whitespace-only/`>500` client-side. `is_correct` is **required**. **409** if the question is non-choice.
  - `PATCH /api/options/{oid}` `OptionUpdate { text?, is_correct? }` → 200, returns the full row.
  - **Unsetting the last `is_correct=true` option → 422** (`questions.py:217–224`, type-agnostic).
  - `DELETE /api/options/{oid}` → 204 with **NO last-correct guard** — the UI blocks deleting the last correct option client-side (§8.6 C2).
  - `POST …/options/reorder` `{ order: [{id, order}] }`, `order` `ge=1`, 1-indexed, full id-set — duplicate/incomplete → **400**.
  - Wrappers (already in `lib/quizAuthoring.ts`): `listOptions(qid)`, `createOption(qid, {text, is_correct})`, `updateOption(oid, body)`, `deleteOption(oid)`, `reorderOptions(qid, order)`. Types: `AuthoringOption`, `OptionCreateBody`, `OptionUpdateBody`, `OrderEntry`, `QuestionType`.
- **Status→code map (§3.6):** disabled mutation → 403; create/delete/reorder outside `created` → 409; archived edit → 409; option-create on non-choice → 409; unset last correct → 422; reorder dup/incomplete → 400. The UI keys off **status code + `ApiError.displayMessage`**, never raw `detail` strings.
- **§4.1a lifecycle/stale guard:** each `QuestionAccordion` is keyed by `q.id`; its option loader uses a plain (non-`$state`) `loadToken` bumped **per load call AND in `onDestroy`**, a captured `myToken`, and a `myToken === loadToken` check before writing results. Every mutation handler pins `const savedVid = vid` **before** the `await` and gates post-`await` local writes + any forced `loadAdminTree(vid,{force:true})` on `alive && vid === savedVid`. The `finally` mutex/busy release is `alive`-only (gating it on `vid` would deadlock — established in Plan A).
- **§7.2 locks:**
  - **`optionsLocked` (accordion-wide)** — set while **any** option mutation (correctness toggle, create, delete, reorder, **or an option-text blur-commit**) is in flight; disables **all** of that question's option controls; cleared in `finally`. For the single_choice multi-call sequence the `finally` wraps the **whole** sequence.
  - **Text ↔ option two-way lock** — option/structure controls are also disabled while that question's **text form is dirty**; the question's text inputs (MarkdownEditors + Save) are disabled while `optionsLocked`.
  - **Apply-if-current backstop** — every option-mutation handler applies its response **only if the option still exists locally**.
  - `questionsLocked` (QuizEditor-wide, already built in Plan A) is separate and unchanged.
- **§8.4 single_choice correctness rule (one rule):** first option in an empty single_choice list → `createOption` with `is_correct=true`; subsequent → `false`. Clicking radio X: **no-op only if `correctCount === 1 && X.is_correct`**; otherwise `updateOption(X, {is_correct:true})` **awaited FIRST** (skip if already true), **then** `updateOption(Y, {is_correct:false})` for **every other** currently-correct Y — **never `Promise.all`** (awaiting set-true first means count never hits 0, so the 422 can't fire). `confirmKeyChange(qid)` is called **once, synchronously, before set-true**; on `false` the **whole** sequence is skipped.
- **§8.2 multiple_choice:** checkbox, ≥1 correct; toggle is optimistic under `optionsLocked`; unchecking the last correct → 422 → inline message + revert by re-fetching `listOptions` (§6 write-back).
- **§8.6 delete guard (C2):** `canDelete = options.length === 1 || !(option.is_correct && correctCount === 1)`. Independently, delete/add/reorder are disabled while `optionsLocked`.
- **§8.7 published-key confirm copy (verbatim):** *"This quiz is published. Changing the answer key does not re-score students who already attempted — their recorded scores keep the old key. To re-grade everyone, create a new version instead. Continue?"* Latch is **per question, per editor mount** (`Set<questionId>` reset by the `{#key item.id}` remount).
- **§8.3 numeric tolerance hint:** `± ${5 * Math.pow(10, -(precision + 1))}` — matches the backend (`backend/mathion/quiz.py:52`, precision 0 → ±0.5). **The spec's "±0.05" parenthetical (§3.7/§8.3) is a known doc typo** (logged for spec correction); the code matches the backend, not the parenthetical. *(Numeric/text validation itself was completed in Plan A — `validateNumericAnswer`; Plan B does not touch it.)*
- **§10a accessibility:** every input has a `<label>`; single_choice options are a **radiogroup** (`<fieldset>`+`<legend>`=the question text), multiple_choice are labeled checkboxes; correctness conveyed by control state **and** a visible "✓ correct" marker (never color alone); reorder ↑/↓ have `aria-label`s; order changes announce via `aria-live="polite"`; validation errors use `role="alert"`; focus moves with `tick()` after add/delete/expand/Save (matching Plan A).
- **Gating (§9):** `QuizEditor`/accordion derive flags **locally** from `perms.canEditStructure` (add/delete/reorder question+option — created-only) and `perms.canEditTextFields` (text + correctness — created||published), both already AND-in `!is_disabled`. Disabled OR archived → whole editor read-only. The UI never issues a call the backend would reject; backend rejections are still handled defensively (§10).

---

## Task ledger

Plan B = **T5a, T5b, T5c, T6, T7, T8, T9** (the spec's §14 T5 is split into T5a/b/c — the densest task — per the prior-slice convention; the seams are read/display, write-CRUD, and correctness).

- **T5a** — accordion option loading (§6/§4.1a) + presentational `OptionRow` (display) + correct-count.
- **T5b** — option CRUD: inline add (trim/whitespace/≤500 block), delete (C2 guard), reorder ↑/↓, text blur-commit; accordion-owned drafts/trackers (§7.1); `optionsLocked` + finally-release + apply-if-current; text↔option two-way lock.
- **T5c** — correctness state machines: single_choice (§8.4) + multiple_choice (§8.2).
- **T6** — version-gating (§9) + disabled/archived whole-editor read-only + error handling (§10, guarded `loadAdminTree` re-gate per origin).
- **T7** — published answer-key confirm (§8.7, `QuizEditor.confirmKeyChange` + accordion Save-key call site) + published type dead-end note (§8.8).
- **T8** — accessibility + focus management (§10a) + full test sweep.
- **T9** — manual smoke walkthrough (§15).

---

## Task T5a: Accordion option loading + presentational OptionRow (display) + correct-count

**Files:**
- Create: `frontend/src/components/editor/OptionRow.svelte`
- Modify: `frontend/src/components/editor/QuestionAccordion.svelte` (add option loading; replace the `{:else}<p>…next slice…</p>` placeholder at line ~167 with the option list + load states)
- Test: `frontend/src/tests/OptionRow.svelte.test.ts` (new)
- Test: `frontend/src/tests/QuestionAccordion.svelte.test.ts` (extend — option-loading cases)
- Test: `frontend/src/tests/QuizEditor.svelte.test.ts` (extend — one isolation case)

**Interfaces:**
- Consumes (from `lib/quizAuthoring.ts`, already present): `listOptions(qid: number): Promise<AuthoringOption[]>`; `AuthoringOption = { id, question_id, text, is_correct, order }`; `QuestionType`.
- Produces:
  - `OptionRow.svelte` props (T5a subset of §4.1, grown in T5b/T5c): `{ option: AuthoringOption; index: number; count: number; questionType: QuestionType }`. Display-only this task: option text + a visible "✓ correct" marker.
  - `QuestionAccordion` gains internal `options: AuthoringOption[]` ($state), `optStatus: 'idle'|'loading'|'loaded'|'error'`, `correctCount` ($derived), a tokenized `loadOptions()` run in `onMount` for choice types, and a header correct-count. (No new public props this task.)

- [ ] **Step 1: Write the failing test — `OptionRow` displays text + correct marker**

Create `frontend/src/tests/OptionRow.svelte.test.ts`:

```ts
import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import OptionRow from '../components/editor/OptionRow.svelte';
import type { AuthoringOption } from '../lib/quizAuthoring';

const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 7, text: 'Paris', is_correct: false, order: 1, ...over,
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountRow(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: Record<string, unknown> = $state({
    option: opt(), index: 1, count: 1, questionType: 'single_choice', ...over,
  });
  const cmp = mount(OptionRow, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}

it('renders the option text', () => {
  const { target } = mountRow({ option: opt({ text: 'Berlin' }) });
  flushSync();
  expect((target.querySelector('[data-testid="option-text"]') as HTMLInputElement).value).toBe('Berlin');
});

it('shows a visible "✓ correct" marker only for correct options', () => {
  const { target } = mountRow({ option: opt({ is_correct: true }) });
  flushSync();
  expect(target.querySelector('[data-testid="option-correct"]')).not.toBeNull();
  expect(target.querySelector('[data-testid="option-correct"]')?.textContent).toContain('✓');
});

it('omits the marker for incorrect options', () => {
  const { target } = mountRow({ option: opt({ is_correct: false }) });
  flushSync();
  expect(target.querySelector('[data-testid="option-correct"]')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/OptionRow.svelte.test.ts`
Expected: FAIL — `OptionRow.svelte` does not exist (resolve error).

- [ ] **Step 3: Create `OptionRow.svelte` (display-only)**

```svelte
<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option. Presentational — owns NO registered state (§4.1). T5a
     renders display only (text + ✓ marker); editable text, correctness control,
     and ↑/↓/🗑 are added in T5b/T5c. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';

  let { option, index, count, questionType }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
  } = $props();
  void count; void questionType;   // consumed by T5b/T5c controls
</script>

<div class="option" data-testid="option-row">
  <span class="opt-num">{index}.</span>
  <input class="opt-input" data-testid="option-text" value={option.text} readonly aria-label="Option text" />
  {#if option.is_correct}
    <span class="correct-marker" data-testid="option-correct">✓ correct</span>
  {/if}
</div>

<style>
  .option { display: flex; align-items: center; gap: var(--space-2); }
  .opt-num { color: var(--text-muted, #666); }
  .opt-input { flex: 1; }
  .correct-marker { font-size: 0.85em; color: var(--success, #2a7); }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/OptionRow.svelte.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/editor/OptionRow.svelte frontend/src/tests/OptionRow.svelte.test.ts
git commit -m "feat(editor): add presentational OptionRow (display) for quiz options"
```

- [ ] **Step 6: Write the failing tests — accordion loads its own options**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts` (the file's imports already include `* as qa`, `mount/unmount/flushSync/tick`, the `q()` factory, `mountAccordion`). Add an option factory near the top, then the cases:

```ts
import type { AuthoringOption } from '../lib/quizAuthoring';

const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 1, text: 'A', is_correct: false, order: 1, ...over,
});

it('choice question loads its own options on mount, sorted by order', async () => {
  const list = vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 2, order: 2, text: 'Second' }), opt({ id: 1, order: 1, text: 'First' }),
  ]);
  const { target } = mountAccordion(q({ type: 'single_choice', correct_numeric: null, precision: null }));
  await tick(); await tick(); flushSync();
  expect(list).toHaveBeenCalledWith(1);
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('First');
  expect(rows[1].textContent).toContain('Second');
});

it('numeric/text questions never fetch options', async () => {
  const list = vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  mountAccordion(q());                                 // numeric (default factory)
  await tick(); await tick(); flushSync();
  expect(list).not.toHaveBeenCalled();
});

it('option-load failure → inline error + Retry; Retry re-fetches', async () => {
  vi.spyOn(qa, 'listOptions')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce([opt({ id: 5, text: 'Recovered' })]);
  const { target } = mountAccordion(q({ type: 'multiple_choice', correct_numeric: null, precision: null }));
  await tick(); await tick(); flushSync();
  expect(target.querySelector('[data-testid="option-load-error"]')).not.toBeNull();
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry')!.click();
  await tick(); await tick(); flushSync();
  expect(target.textContent).toContain('Recovered');
});

it('header shows the correct-count for choice questions', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, is_correct: true }), opt({ id: 2, is_correct: false }),
  ]);
  const { target } = mountAccordion(q({ type: 'single_choice', correct_numeric: null, precision: null }));
  await tick(); await tick(); flushSync();
  expect(target.querySelector('[data-testid="correct-count"]')?.textContent).toContain('1');
});

it('a late option-load response after unmount writes nothing (§4.1a onDestroy token bump)', async () => {
  let resolveList!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions').mockReturnValue(new Promise((r) => { resolveList = r; }));
  const { target } = mountAccordion(q({ type: 'single_choice', correct_numeric: null, precision: null }));
  await tick(); flushSync();
  cleanup?.(); cleanup = null;                         // unmount while the fetch is pending
  resolveList([opt({ id: 9, text: 'Late' })]);         // resolves after destroy → discarded
  await tick(); flushSync();
  expect(target.querySelector('[data-testid="option-row"]')).toBeNull();
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "option"`
Expected: FAIL — the accordion does not fetch options yet (no `option-row`/`correct-count`/`option-load-error` nodes).

- [ ] **Step 8: Implement option loading in `QuestionAccordion.svelte`**

8a. Extend the imports. Change the `svelte` import to add `onMount`, import `listOptions` + `AuthoringOption`, and `OptionRow`:

```svelte
  import { getContext, onMount, onDestroy } from 'svelte';
  import type { AuthoringQuestion, AuthoringOption } from '../../lib/quizAuthoring';
  // …existing imports unchanged…
  import { updateQuestion, validateNumericAnswer, listOptions } from '../../lib/quizAuthoring';
  import OptionRow from './OptionRow.svelte';
```

8b. Extend the lifecycle guard to also invalidate the option loader on destroy. Replace `onDestroy(() => { alive = false; });` with:

```svelte
  let alive = true;
  let optLoadToken = 0;                                 // plain; bumped per load + on destroy (§4.1a)
  onDestroy(() => { alive = false; optLoadToken++; });
```

8c. Add option state + loader (place after the `dirty`/`tracker` block, before `save()`):

```svelte
  // ---- Options (choice types only). Each accordion loads & owns its own
  //      options (§4.1/§6) so a failed fetch is isolated to this question and
  //      is never confused with an empty list. Type is fixed for the
  //      instance's lifetime (keyed by q.id), so isChoice is a plain const. ----
  const isChoice = question.type === 'single_choice' || question.type === 'multiple_choice';
  let options = $state<AuthoringOption[]>([]);
  let optStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>(isChoice ? 'loading' : 'idle');
  let optError = $state<string | null>(null);
  const correctCount = $derived(options.filter((o) => o.is_correct).length);

  async function loadOptions() {
    optLoadToken += 1;
    const myToken = optLoadToken;
    optStatus = 'loading';
    optError = null;
    try {
      const list = await listOptions(question.id);
      if (myToken !== optLoadToken) return;            // superseded / unmounted → discard
      options = [...list].sort((a, b) => a.order - b.order);
      optStatus = 'loaded';
    } catch (e) {
      if (myToken !== optLoadToken) return;
      optError = e instanceof ApiError ? e.displayMessage : 'Could not load options.';
      optStatus = 'error';
    }
  }
  onMount(() => { if (isChoice) void loadOptions(); });
```

8d. Add the correct-count to the header (after the `<span class="badge">…</span>`):

```svelte
    {#if isChoice}<span class="badge" data-testid="correct-count">{correctCount} correct</span>{/if}
```

8e. Replace the body's choice-type placeholder. The current final `{:else}<p class="muted">Options are edited in the next slice (Plan B).</p>` becomes:

```svelte
      {:else}
        <!-- choice types (single_choice / multiple_choice): options list (§6) -->
        {#if optStatus === 'loading'}
          <p class="muted">Loading options…</p>
        {:else if optStatus === 'error'}
          <p class="err" role="alert" data-testid="option-load-error">{optError}</p>
          <Button variant="ghost" onclick={() => void loadOptions()}>Retry</Button>
        {:else}
          {#if options.length === 0}
            <p class="muted">No options yet.</p>
          {:else}
            <ol class="options">
              {#each options as o, i (o.id)}
                <li>
                  <OptionRow option={o} index={i + 1} count={options.length} questionType={question.type} />
                </li>
              {/each}
            </ol>
          {/if}
        {/if}
      {/if}
```

8f. Add list styling to the component `<style>`:

```svelte
  .options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
```

- [ ] **Step 9: Run the accordion tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts`
Expected: PASS (the new option cases + all pre-existing accordion tests).

- [ ] **Step 10: Write the failing test — one failed option fetch isolates to its accordion (QuizEditor level)**

Add to `frontend/src/tests/QuizEditor.svelte.test.ts` (it already imports `* as qa`, `* as store`, `q()`, `mountEditor`):

```ts
it('one question\'s failed option fetch isolates to its accordion (§6)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, type: 'single_choice', text_md: 'Q1', correct_numeric: null, precision: null }),
    q({ id: 2, order: 2, type: 'single_choice', text_md: 'Q2', correct_numeric: null, precision: null }),
  ]);
  vi.spyOn(qa, 'listOptions').mockImplementation((qid: number) =>
    qid === 1 ? Promise.reject(new Error('boom'))
      : Promise.resolve([{ id: 9, question_id: 2, text: 'ok-opt', is_correct: true, order: 1 }]));
  const { target } = mountEditor();
  await tick(); await tick(); await tick(); flushSync();
  // exactly one accordion shows the option-load error; the other shows its option
  expect(target.querySelectorAll('[data-testid="option-load-error"]')).toHaveLength(1);
  expect(target.textContent).toContain('ok-opt');
});
```

- [ ] **Step 11: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts -t "isolates"`
Expected: PASS (no production change needed — the accordion already owns its load; this asserts the isolation property end-to-end).

- [ ] **Step 12: Run the full frontend suite + type-check**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error`
Expected: all tests PASS; svelte-check 0 errors.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/components/editor/QuestionAccordion.svelte frontend/src/tests/QuestionAccordion.svelte.test.ts frontend/src/tests/QuizEditor.svelte.test.ts
git commit -m "feat(editor): QuestionAccordion loads & renders its own options (§4.1a/§6)"
```

---

## Task T5b: Option CRUD — add/delete/reorder/text-commit, drafts & trackers, optionsLocked

**Files:**
- Modify: `frontend/src/components/editor/OptionRow.svelte` (read-only text input → editable `bind:draft`; add ↑/↓/🗑 controls + their callbacks)
- Modify: `frontend/src/components/editor/QuestionAccordion.svelte` (accordion-owned option-text drafts/trackers §7.1; `optionsLocked` + finally-release; `setOptions`/`applyOption`/`resyncOptions`; inline add-option; delete with C2 guard; reorder; blur-commit; text↔option two-way lock; mutation-error inline)
- Test: `frontend/src/tests/OptionRow.svelte.test.ts` (rewrite harness for the grown props; add control cases)
- Test: `frontend/src/tests/QuestionAccordion.svelte.test.ts` (add CRUD cases)

**Interfaces:**
- Consumes (already present): `createOption`, `updateOption`, `deleteOption`, `reorderOptions`, `listOptions`, `makeDirtyTracker`/`DirtyTracker` (`lib/dirty.svelte`), the registry (`getContext(DIRTY_REGISTRY_KEY)`).
- Produces (final §4.1 OptionRow shape, minus the correctness control which T5c adds):
  - `OptionRow` props: `{ option, index, count, questionType, perms: VersionPermissions, draft: string (bindable), optionsLocked: boolean, canDelete: boolean }`; callbacks `{ onCommitText(); onDelete(); onMoveUp(); onMoveDown() }`.
  - `QuestionAccordion` internals: `optionsLocked` ($state), `optionTrackers: Map<number, DirtyTracker<{text:string}>>` (registered into the dirty registry; survives collapse — §7.1), helpers `setOptions`/`reconcileTrackers`/`applyOption`/`resyncOptions`/`canDeleteOption`, handlers `addOption`/`removeOption`/`moveOption`/`commitText`, and the effective UI lock `optionsDisabled = optionsLocked || dirty`. T5c adds `onToggleCorrect`.

- [ ] **Step 1: Write the failing tests — OptionRow controls (grown props)**

Replace `frontend/src/tests/OptionRow.svelte.test.ts` entirely (the harness now passes the grown prop set, and the text node is an editable input bound to `draft`):

```ts
import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import OptionRow from '../components/editor/OptionRow.svelte';
import type { AuthoringOption } from '../lib/quizAuthoring';
import { versionPermissions } from '../lib/versionPermissions';

const PERMS = versionPermissions({ state: 'created', is_disabled: false });
const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 7, text: 'Paris', is_correct: false, order: 1, ...over,
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountRow(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: Record<string, unknown> = $state({
    option: opt(), index: 1, count: 3, questionType: 'single_choice', perms: PERMS,
    draft: opt().text, optionsLocked: false, canDelete: true,
    onCommitText: vi.fn(), onDelete: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), ...over,
  });
  const cmp = mount(OptionRow, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}
const textInput = (t: HTMLElement) => t.querySelector('[data-testid="option-text"]') as HTMLInputElement;
const btn = (t: HTMLElement, label: string) => t.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

it('renders the bound draft text', () => {
  const { target } = mountRow({ draft: 'Berlin' });
  flushSync();
  expect(textInput(target).value).toBe('Berlin');
});

it('shows the ✓ correct marker only for correct options', () => {
  const { target } = mountRow({ option: opt({ is_correct: true }) });
  flushSync();
  expect(target.querySelector('[data-testid="option-correct"]')).not.toBeNull();
});

it('blur on the text input fires onCommitText', () => {
  const onCommitText = vi.fn();
  const { target } = mountRow({ onCommitText });
  flushSync();
  textInput(target).dispatchEvent(new Event('blur'));
  expect(onCommitText).toHaveBeenCalledOnce();
});

it('↑/↓/🗑 fire their callbacks', () => {
  const onMoveUp = vi.fn(), onMoveDown = vi.fn(), onDelete = vi.fn();
  const { target } = mountRow({ index: 2, count: 3, onMoveUp, onMoveDown, onDelete });
  flushSync();
  btn(target, 'Move option up').click();
  btn(target, 'Move option down').click();
  btn(target, 'Delete option').click();
  expect(onMoveUp).toHaveBeenCalledOnce();
  expect(onMoveDown).toHaveBeenCalledOnce();
  expect(onDelete).toHaveBeenCalledOnce();
});

it('optionsLocked disables every option control + makes the text read-only', () => {
  const { target } = mountRow({ index: 2, count: 3, optionsLocked: true });
  flushSync();
  expect(textInput(target).readOnly).toBe(true);
  expect(btn(target, 'Move option up').disabled).toBe(true);
  expect(btn(target, 'Delete option').disabled).toBe(true);
});

it('canDelete=false disables only delete (C2)', () => {
  const { target } = mountRow({ canDelete: false });
  flushSync();
  expect(btn(target, 'Delete option').disabled).toBe(true);
});

it('reorder boundaries disable ↑ at top and ↓ at bottom', () => {
  const top = mountRow({ index: 1, count: 3 });
  flushSync();
  expect(btn(top.target, 'Move option up').disabled).toBe(true);
  expect(btn(top.target, 'Move option down').disabled).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/OptionRow.svelte.test.ts`
Expected: FAIL — OptionRow lacks the editable input/buttons/props.

- [ ] **Step 3: Grow `OptionRow.svelte` to the editable + structural-control shape**

Replace the whole file:

```svelte
<!-- frontend/src/components/editor/OptionRow.svelte
     One answer option. Presentational — owns NO registered state (§4.1). The
     text input binds an accordion-owned draft (§7.1); the row only emits
     callbacks. The correctness control is added in T5c. -->
<script lang="ts">
  import type { AuthoringOption, QuestionType } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';

  let {
    option, index, count, questionType, perms, draft = $bindable(''),
    optionsLocked, canDelete, onCommitText, onDelete, onMoveUp, onMoveDown,
  }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
    perms: VersionPermissions; draft: string; optionsLocked: boolean; canDelete: boolean;
    onCommitText: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();
  void questionType;   // drives the correctness control added in T5c

  const textReadOnly = $derived(!perms.canEditTextFields || optionsLocked);
  const structureDisabled = $derived(optionsLocked || !perms.canEditStructure);
  // Over-length / whitespace-only counter feedback (the commit itself is blocked
  // in the accordion; here we only flag it visibly). DB String(500), min_length=1.
  const lenInvalid = $derived(draft.trim().length < 1 || draft.length > 500);
</script>

<div class="option" data-testid="option-row">
  <span class="opt-num">{index}.</span>
  <input class="opt-input" data-testid="option-text" bind:value={draft}
         readonly={textReadOnly} onblur={() => onCommitText()}
         aria-label="Option text" aria-invalid={lenInvalid} maxlength="500" />
  {#if lenInvalid}<span class="len-warn" data-testid="option-len-warn">1–500 chars</span>{/if}
  {#if option.is_correct}
    <span class="correct-marker" data-testid="option-correct">✓ correct</span>
  {/if}
  {#if perms.canEditStructure}
    <button type="button" aria-label="Move option up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move option down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete option" disabled={structureDisabled || !canDelete} onclick={onDelete}>🗑</button>
  {/if}
</div>

<style>
  .option { display: flex; align-items: center; gap: var(--space-2); }
  .opt-num { color: var(--text-muted, #666); }
  .opt-input { flex: 1; }
  .correct-marker { font-size: 0.85em; color: var(--success, #2a7); }
  .len-warn { font-size: 0.8em; color: var(--danger, #c00); }
</style>
```

- [ ] **Step 4: Run OptionRow tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/OptionRow.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/editor/OptionRow.svelte frontend/src/tests/OptionRow.svelte.test.ts
git commit -m "feat(editor): OptionRow editable text + reorder/delete controls"
```

- [ ] **Step 6: Write the failing tests — accordion option CRUD + locks + drafts**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts` (the `opt()` factory was added in T5a). Helper for the choice question + a deferred promise:

```ts
const choiceQ = (over: Partial<AuthoringQuestion> = {}) =>
  q({ type: 'single_choice', correct_numeric: null, precision: null, ...over });
const addOptionBtn = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === '＋ Add option') as HTMLButtonElement;
const anyDirty = (t: HTMLElement) => t.querySelector('[data-testid="any-dirty"]')?.textContent;

it('inline add: trims, blocks whitespace-only, posts {text, is_correct}', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);   // empty → first option is_correct=true (§8.4)
  const create = vi.spyOn(qa, 'createOption').mockResolvedValue(opt({ id: 3, text: 'Madrid', is_correct: true, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  addOptionBtn(target).click();
  await tick(); flushSync();
  const input = target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement;
  setVal(input, '   ');                                 // whitespace-only → Add disabled
  await tick(); flushSync();
  expect(([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement).disabled).toBe(true);
  setVal(input, '  Madrid  ');
  await tick(); flushSync();
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();
  expect(create).toHaveBeenCalledWith(1, { text: 'Madrid', is_correct: true });   // trimmed; first → correct
});

it('delete-correct-option is blocked client-side (C2)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const del = vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  // row 0 is the only correct option → its delete is disabled
  const delBtn0 = rows[0].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement;
  expect(delBtn0.disabled).toBe(true);
  delBtn0.click();
  await tick(); flushSync();
  expect(del).not.toHaveBeenCalled();
});

it('delete removes a non-last-correct option', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const del = vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();
  expect(del).toHaveBeenCalledWith(2);
  expect(target.querySelectorAll('[data-testid="option-row"]')).toHaveLength(1);
});

it('option-text blur-commit: draft is dirty → feeds quizDirty → resets on success', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const upd = vi.spyOn(qa, 'updateOption').mockResolvedValue(opt({ id: 1, text: 'Alpha', is_correct: true, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  const input = target.querySelector('[data-testid="option-text"]') as HTMLInputElement;
  setVal(input, 'Alpha');
  await tick(); flushSync();
  expect(anyDirty(target)).toBe('dirty');              // uncommitted draft feeds quizDirty (§7.1)
  input.dispatchEvent(new Event('blur'));
  await tick(); await tick(); flushSync();
  expect(upd).toHaveBeenCalledWith(1, { text: 'Alpha' });
  expect(anyDirty(target)).toBe('clean');              // baseline reset on success
});

it('an uncommitted option-text draft stays dirty across collapsing the question (§7.1)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target, props } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  setVal(target.querySelector('[data-testid="option-text"]') as HTMLInputElement, 'Edited');
  await tick(); flushSync();
  expect(anyDirty(target)).toBe('dirty');
  props.expanded = false;                              // collapse → OptionRow unmounts
  await tick(); flushSync();
  expect(target.querySelector('[data-testid="option-row"]')).toBeNull();
  expect(anyDirty(target)).toBe('dirty');              // tracker lives on the accordion → survives
});

it('optionsLocked serializes: a 2nd option mutation is blocked while the 1st is in flight', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  let resolveDel!: () => void;
  vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise((r) => { resolveDel = r as () => void; }));
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();  // delete pending
  await tick(); flushSync();
  // every option control is now disabled (optionsLocked)
  expect((rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).disabled).toBe(true);
  expect((rows[0].querySelector('[data-testid="option-text"]') as HTMLInputElement).readOnly).toBe(true);
  resolveDel();
  await tick(); await tick(); flushSync();
});
```

- [ ] **Step 7: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "option"`
Expected: FAIL — no add form / draft trackers / locks yet.

- [ ] **Step 8: Implement the option-CRUD machinery in `QuestionAccordion.svelte`**

8a. Imports — add the option wrappers + `makeDirtyTracker`/`DirtyTracker`:

```svelte
  import { makeDirtyTracker, type DirtyTracker } from '../../lib/dirty.svelte';
  import {
    updateQuestion, validateNumericAnswer,
    listOptions, createOption, updateOption, deleteOption, reorderOptions,
  } from '../../lib/quizAuthoring';
```

8b. Option-mutation state + the drafts/trackers map. Add after the T5a option state:

```svelte
  let optionsLocked = $state(false);                   // accordion-wide option lock (§7.2)
  let optMutError = $state<string | null>(null);       // inline option-mutation error
  // Per-option text drafts + dirty trackers live on the always-mounted accordion
  // (§7.1) so an uncommitted draft survives collapse and feeds quizDirty. Plain
  // Map (membership need not be reactive — OptionRow binds the tracker's $state).
  const optionTrackers = new Map<number, DirtyTracker<{ text: string }>>();

  function reconcileTrackers() {
    const ids = new Set(options.map((o) => o.id));
    for (const o of options) {
      if (!optionTrackers.has(o.id)) {
        const t = makeDirtyTracker<{ text: string }>({ text: o.text });
        optionTrackers.set(o.id, t);
        registry.register(t);                          // feeds quizDirty
      }
    }
    for (const [id, t] of [...optionTrackers]) {
      if (!ids.has(id)) { registry.unregister(t); optionTrackers.delete(id); }
    }
  }
  // Single assignment point: reconcile trackers synchronously whenever options change.
  function setOptions(next: AuthoringOption[]) { options = next; reconcileTrackers(); }

  function applyOption(updated: AuthoringOption) {     // apply-if-current (§7.2 backstop)
    const i = options.findIndex((o) => o.id === updated.id);
    if (i < 0) return;                                 // option gone → ignore stale response
    const next = [...options];
    next[i] = updated;
    setOptions(next);
  }
  async function resyncOptions(savedVid: number) {     // §6 write-back on error
    try {
      const list = await listOptions(question.id);
      if (!(alive && vid === savedVid)) return;        // §4.1a: discard a re-fetch superseded by a vid change
      setOptions([...list].sort((a, b) => a.order - b.order));
    } catch { /* keep the prior inline error; the loaded list stays as-is */ }
  }
  const canDeleteOption = (o: AuthoringOption) =>
    options.length === 1 || !(o.is_correct && correctCount === 1);   // C2 (§8.6)
  const optionsDisabled = $derived(optionsLocked || dirty);          // effective UI lock (text↔option)
```

8c. Change the T5a loader success line to go through `setOptions` so trackers reconcile:

```svelte
      const list = await listOptions(question.id);
      if (myToken !== optLoadToken) return;
      setOptions([...list].sort((a, b) => a.order - b.order));
      optStatus = 'loaded';
```

8d. Extend `onDestroy` to unregister all option trackers:

```svelte
  onDestroy(() => {
    alive = false; optLoadToken++;
    for (const t of optionTrackers.values()) registry.unregister(t);
  });
```

8e. The CRUD handlers + the inline-add state (place near the other option helpers):

```svelte
  // ---- Inline add-option (like SequenceAccordion's inline create) ----
  let addingOption = $state(false);
  let newOptionText = $state('');
  const newOptionValid = $derived(newOptionText.trim().length >= 1 && newOptionText.length <= 500);

  async function addOption() {
    if (optionsDisabled || !perms.canEditStructure || !newOptionValid) return;   // §7.2 two-way lock: also blocked while text dirty
    const savedVid = vid;
    const text = newOptionText.trim();
    // §8.4: the first option of an empty single_choice list is auto-correct; all
    // other new options (incl. every multiple_choice option) default to false.
    const is_correct = question.type === 'single_choice' && options.length === 0;
    optMutError = null;
    optionsLocked = true;
    try {
      const created = await createOption(question.id, { text, is_correct });
      if (!(alive && vid === savedVid)) return;
      setOptions([...options, created].sort((a, b) => a.order - b.order));
      addingOption = false; newOptionText = '';
    } catch (e) {
      if (alive && vid === savedVid) optMutError = e instanceof ApiError ? e.displayMessage : 'Add option failed';
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function removeOption(oid: number) {
    if (optionsLocked || !perms.canEditStructure) return;
    const target = options.find((o) => o.id === oid);
    if (!target || !canDeleteOption(target)) return;
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      await deleteOption(oid);
      if (!(alive && vid === savedVid)) return;
      setOptions(options.filter((o) => o.id !== oid));
    } catch (e) {
      if (alive && vid === savedVid) optMutError = e instanceof ApiError ? e.displayMessage : 'Delete option failed';
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function moveOption(oid: number, dir: -1 | 1) {
    if (optionsLocked || !perms.canEditStructure) return;
    const idx = options.findIndex((o) => o.id === oid);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= options.length) return;
    const savedVid = vid;
    const next = [...options];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOptions(next.map((o, i) => ({ ...o, order: i + 1 })));
    const order = options.map((o) => ({ id: o.id, order: o.order }));
    optMutError = null;
    optionsLocked = true;
    try {
      await reorderOptions(question.id, order);        // success: optimistic state is authoritative
    } catch (e) {
      if (alive && vid === savedVid) {
        optMutError = e instanceof ApiError ? e.displayMessage : 'Reorder failed';
        await resyncOptions(savedVid);
      }
    } finally {
      if (alive) optionsLocked = false;
    }
  }

  async function commitText(oid: number) {
    if (optionsLocked) return;
    const tracker = optionTrackers.get(oid);
    const target = options.find((o) => o.id === oid);
    if (!tracker || !target || !tracker.isDirty) return;
    const text = tracker.current.text;
    if (text.trim().length < 1 || text.length > 500) return;   // blocked: counter already red
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      const updated = await updateOption(oid, { text });
      if (!(alive && vid === savedVid)) return;
      applyOption(updated);
      optionTrackers.get(oid)?.reset({ text: updated.text });  // baseline → clean
    } catch (e) {
      if (alive && vid === savedVid) optMutError = e instanceof ApiError ? e.displayMessage : 'Save option text failed';
      // draft stays dirty for retry
    } finally {
      if (alive) optionsLocked = false;
    }
  }
```

8f. Wire the text↔option two-way lock on the **question** text fields. The question's MarkdownEditors + per-type inputs + Save must be disabled while `optionsLocked`. Update `editable`'s use sites and `canSave`:

```svelte
  const editable = $derived(perms.canEditTextFields);
  const textLocked = $derived(optionsLocked);          // text inputs frozen during an option mutation (§7.2)
  // …
  const canSave = $derived(dirty && answerValid && !saveBusy && editable && !optionsLocked);
```

In the body template, add `|| textLocked` to each text field's read-only:
- both `<MarkdownEditor … readOnly={!editable || textLocked} … />`
- `numeric-input` / `precision-input` / `text-answer-input`: `readonly={!editable || textLocked}`

8g. Render the option list through the grown `OptionRow` + the inline add form. Replace the T5a `{:else}…options…{/if}` "loaded" branch body with:

```svelte
        {:else}
          {#if options.length === 0}
            <p class="muted">No options yet.</p>
          {:else}
            <ol class="options">
              {#each options as o, i (o.id)}
                {@const t = optionTrackers.get(o.id)}
                {#if t}
                  <li>
                    <OptionRow
                      option={o} index={i + 1} count={options.length} questionType={question.type}
                      {perms} optionsLocked={optionsDisabled} canDelete={canDeleteOption(o)}
                      bind:draft={t.current.text}
                      onCommitText={() => void commitText(o.id)}
                      onDelete={() => void removeOption(o.id)}
                      onMoveUp={() => void moveOption(o.id, -1)}
                      onMoveDown={() => void moveOption(o.id, 1)}
                    />
                  </li>
                {/if}
              {/each}
            </ol>
          {/if}
          {#if optMutError}<p class="err" role="alert" data-testid="option-mut-error">{optMutError}</p>{/if}
          {#if perms.canEditStructure}
            {#if addingOption}
              <div class="add-option">
                <label>New option
                  <input data-testid="new-option-text" bind:value={newOptionText} maxlength="500" readonly={optionsDisabled} />
                </label>
                <Button onclick={() => void addOption()} disabled={optionsDisabled || !newOptionValid}>Add</Button>
                <Button variant="ghost" onclick={() => { addingOption = false; newOptionText = ''; }}>Cancel</Button>
              </div>
            {:else}
              <Button onclick={() => { addingOption = true; }} disabled={optionsDisabled}>＋ Add option</Button>
            {/if}
          {/if}
        {/if}
```

8h. Add `.add-option` styling:

```svelte
  .add-option { display: flex; align-items: end; gap: var(--space-2); }
```

- [ ] **Step 9: Run the accordion tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts`
Expected: PASS (CRUD + lock + draft cases, plus all prior cases).

- [ ] **Step 10: Full suite + type-check**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error`
Expected: all PASS; 0 svelte-check errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/editor/QuestionAccordion.svelte frontend/src/tests/QuestionAccordion.svelte.test.ts
git commit -m "feat(editor): option CRUD + drafts/trackers + optionsLocked (§6/§7.1/§7.2/§8.6)"
```

---

## Task T5c: Correctness state machines — single_choice (§8.4) + multiple_choice (§8.2)

**Files:**
- Modify: `frontend/src/components/editor/OptionRow.svelte` (add the correctness control — radio for single, checkbox for multiple — + `onToggleCorrect`)
- Modify: `frontend/src/components/editor/QuestionAccordion.svelte` (add `confirmKeyChange` prop + the `toggleCorrect` handler; pass `onToggleCorrect` to OptionRow)
- Modify: `frontend/src/components/editor/QuizEditor.svelte` (pass a **placeholder** `confirmKeyChange={() => true}` to each accordion — T7 replaces it with the real latch)
- Test: `frontend/src/tests/OptionRow.svelte.test.ts` (correctness-control rendering + callback)
- Test: `frontend/src/tests/QuestionAccordion.svelte.test.ts` (the two worked examples + no-op + 2-correct repair + lock-disables-delete-mid-switch + finally-clears-on-throw)

**Interfaces:**
- Consumes: `updateOption`, `listOptions`, `confirmKeyChange` (new accordion prop, `(questionId: number) => boolean` — wired to a real latch in T7).
- Produces:
  - `OptionRow` gains `onToggleCorrect: (next: boolean) => void`; renders `<input type="radio">` (single_choice, `onclick` → `onToggleCorrect(true)`) or `<input type="checkbox">` (multiple_choice, `onchange` → `onToggleCorrect(checked)`), `checked={option.is_correct}`, disabled while `optionsLocked || !perms.canEditTextFields`.
  - `QuestionAccordion` gains the `confirmKeyChange` prop + `toggleCorrect(oid, next)` implementing §8.4/§8.2 under `optionsLocked` (whole single_choice sequence in one `finally`).

- [ ] **Step 1: Write the failing tests — OptionRow correctness control**

Add to `frontend/src/tests/OptionRow.svelte.test.ts` (extend `mountRow`'s default props with `onToggleCorrect: vi.fn()`):

```ts
// In mountRow's $state default props, add:  onToggleCorrect: vi.fn(),

it('single_choice renders a radio reflecting is_correct; click fires onToggleCorrect(true)', () => {
  const onToggleCorrect = vi.fn();
  const { target } = mountRow({ questionType: 'single_choice', option: opt({ is_correct: true }), onToggleCorrect });
  flushSync();
  const radio = target.querySelector('input[type="radio"]') as HTMLInputElement;
  expect(radio.checked).toBe(true);
  radio.click();
  expect(onToggleCorrect).toHaveBeenCalledWith(true);
});

it('multiple_choice renders a checkbox; toggling fires onToggleCorrect(checked)', () => {
  const onToggleCorrect = vi.fn();
  const { target } = mountRow({ questionType: 'multiple_choice', option: opt({ is_correct: true }), onToggleCorrect });
  flushSync();
  const box = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(box.checked).toBe(true);
  box.checked = false;
  box.dispatchEvent(new Event('change'));
  expect(onToggleCorrect).toHaveBeenCalledWith(false);
});

it('the correctness control is disabled while optionsLocked', () => {
  const { target } = mountRow({ questionType: 'single_choice', optionsLocked: true });
  flushSync();
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/OptionRow.svelte.test.ts`
Expected: FAIL — no radio/checkbox yet.

- [ ] **Step 3: Add the correctness control to `OptionRow.svelte`**

3a. Add `onToggleCorrect` to the props (and drop the `void questionType` line — it is now used):

```svelte
  let {
    option, index, count, questionType, perms, draft = $bindable(''),
    optionsLocked, canDelete, onToggleCorrect, onCommitText, onDelete, onMoveUp, onMoveDown,
  }: {
    option: AuthoringOption; index: number; count: number; questionType: QuestionType;
    perms: VersionPermissions; draft: string; optionsLocked: boolean; canDelete: boolean;
    onToggleCorrect: (next: boolean) => void;
    onCommitText: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  const textReadOnly = $derived(!perms.canEditTextFields || optionsLocked);
  const structureDisabled = $derived(optionsLocked || !perms.canEditStructure);
  const correctnessDisabled = $derived(optionsLocked || !perms.canEditTextFields);
  const lenInvalid = $derived(draft.trim().length < 1 || draft.length > 500);
```

3b. Render the control as the first child of `.option` (before the number). `onclick` for the radio (so clicking the already-checked-in-DOM member of a transient 2-correct state still fires the §8.4 repair); `onchange` for the checkbox:

```svelte
<div class="option" data-testid="option-row">
  {#if questionType === 'single_choice'}
    <input type="radio" name={`correct-${option.question_id}`} checked={option.is_correct}
           disabled={correctnessDisabled} onclick={() => onToggleCorrect(true)} aria-label="Mark correct" />
  {:else if questionType === 'multiple_choice'}
    <input type="checkbox" checked={option.is_correct}
           disabled={correctnessDisabled} onchange={(e) => onToggleCorrect(e.currentTarget.checked)} aria-label="Mark correct" />
  {/if}
  <span class="opt-num">{index}.</span>
  <!-- …existing input + marker + ↑/↓/🗑 unchanged… -->
```

- [ ] **Step 4: Run OptionRow tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/OptionRow.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests — accordion correctness machines**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts`. First extend `mountAccordion`'s default props with `confirmKeyChange: () => true` (so all existing mounts satisfy the new required prop). Then:

```ts
const radios = (t: HTMLElement) => [...t.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
const boxes = (t: HTMLElement) => [...t.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];

it('single_choice switch sets the new option true BEFORE unsetting the old (worked example 1)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const upd = vi.spyOn(qa, 'updateOption')
    .mockResolvedValueOnce(opt({ id: 2, text: 'B', is_correct: true, order: 2 }))
    .mockResolvedValueOnce(opt({ id: 1, text: 'A', is_correct: false, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  radios(target)[1].click();                            // click B
  await tick(); await tick(); await tick(); flushSync();
  expect(upd).toHaveBeenCalledTimes(2);
  expect(upd.mock.calls[0]).toEqual([2, { is_correct: true }]);    // set-true FIRST
  expect(upd.mock.calls[1]).toEqual([1, { is_correct: false }]);   // then unset old
});

it('clicking the unique-correct radio is a no-op (no PATCH)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const upd = vi.spyOn(qa, 'updateOption').mockResolvedValue(opt());
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  radios(target)[0].click();                            // click the already-unique-correct A
  await tick(); await tick(); flushSync();
  expect(upd).not.toHaveBeenCalled();
});

it('single_choice 2-correct repair: clicking one radio unsets the other (leaves exactly one)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: true, order: 2 }),       // transient 2-correct
  ]);
  const upd = vi.spyOn(qa, 'updateOption').mockResolvedValue(opt({ id: 2, text: 'B', is_correct: false, order: 2 }));
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  radios(target)[0].click();                            // click A (already true) → just unset B
  await tick(); await tick(); flushSync();
  expect(upd).toHaveBeenCalledTimes(1);
  expect(upd).toHaveBeenCalledWith(2, { is_correct: false });
});

it('multiple_choice unchecking the last correct → 422 → revert via listOptions (worked example 2)', async () => {
  const { ApiError } = await import('../lib/api');
  const server = [opt({ id: 1, text: 'C', is_correct: true, order: 1 })];
  const relist = vi.spyOn(qa, 'listOptions').mockResolvedValue(server);  // initial load + re-fetch return C still correct
  vi.spyOn(qa, 'updateOption').mockRejectedValue(new ApiError(422, 'At least one option must be correct'));
  const { target } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await tick(); await tick(); flushSync();
  const box = boxes(target)[0];
  box.checked = false; box.dispatchEvent(new Event('change'));    // uncheck the only correct
  await tick(); await tick(); await tick(); flushSync();
  expect(relist).toHaveBeenCalledTimes(2);                        // initial load + §6 write-back re-fetch
  expect(boxes(target)[0].checked).toBe(true);                   // reverted to server value
});

it('during a single_choice switch optionsLocked also disables delete (rev-12 race)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  let resolveSet!: (o: AuthoringOption) => void;
  vi.spyOn(qa, 'updateOption').mockReturnValue(new Promise((r) => { resolveSet = r; }));
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  radios(target)[1].click();                            // switch in flight (set-true pending)
  await tick(); flushSync();
  const delOld = [...target.querySelectorAll('[data-testid="option-row"]')][0].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement;
  expect(delOld.disabled).toBe(true);                   // old correct can't be deleted mid-switch
  resolveSet(opt({ id: 2, is_correct: true, order: 2 }));
  await tick(); await tick(); flushSync();
});

it('a thrown set-false clears optionsLocked in finally (group re-enables)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  vi.spyOn(qa, 'updateOption')
    .mockResolvedValueOnce(opt({ id: 2, is_correct: true, order: 2 }))     // set-true OK
    .mockRejectedValueOnce(new Error('boom'));                            // set-false throws
  // resync after error:
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: false, order: 1 }), opt({ id: 2, text: 'B', is_correct: true, order: 2 }),
  ]);
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  radios(target)[1].click();
  await tick(); await tick(); await tick(); flushSync();
  // optionsLocked cleared → a radio is enabled again
  expect(radios(target).some((r) => !r.disabled)).toBe(true);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "single_choice\|multiple_choice\|repair\|no-op"`
Expected: FAIL — no `confirmKeyChange` prop / `toggleCorrect` yet.

- [ ] **Step 7: Add `confirmKeyChange` + `toggleCorrect` to `QuestionAccordion.svelte`**

7a. Add `confirmKeyChange` to the props block:

```svelte
  let {
    question, vid, index, count, perms, assetContext, expanded, locked, confirmKeyChange,
    onExpandToggle, onDelete, onMoveUp, onMoveDown,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    confirmKeyChange: (questionId: number) => boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();
```

7b. Add the handler (near the other option handlers):

```svelte
  async function toggleCorrect(oid: number, next: boolean) {
    if (optionsLocked) return;
    const target = options.find((o) => o.id === oid);
    if (!target) return;
    // §8.4 no-op: clicking the radio of the already-unique-correct single_choice option.
    if (question.type === 'single_choice' && correctCount === 1 && target.is_correct) return;
    if (!confirmKeyChange(question.id)) return;          // §8.7 — once, before any set-true
    const savedVid = vid;
    optMutError = null;
    optionsLocked = true;
    try {
      if (question.type === 'single_choice') {
        // Capture the others-to-unset BEFORE mutating (set-true doesn't change them).
        const othersToUnset = options.filter((o) => o.is_correct && o.id !== oid).map((o) => o.id);
        if (!target.is_correct) {
          const u = await updateOption(oid, { is_correct: true });    // set-true FIRST (awaited)
          if (!(alive && vid === savedVid)) return;
          applyOption(u);
        }
        for (const yid of othersToUnset) {                            // then unset each other
          const u = await updateOption(yid, { is_correct: false });
          if (!(alive && vid === savedVid)) return;
          applyOption(u);
        }
      } else {                                                        // multiple_choice: optimistic single toggle
        const u = await updateOption(oid, { is_correct: next });
        if (!(alive && vid === savedVid)) return;
        applyOption(u);
      }
    } catch (e) {
      if (alive && vid === savedVid) {
        optMutError = e instanceof ApiError ? e.displayMessage : 'Correctness update failed';
        await resyncOptions(savedVid);                                // 422 last-correct / partial fail → §6 revert
      }
    } finally {
      if (alive) optionsLocked = false;                              // whole sequence in ONE finally (§7.2)
    }
  }
```

7c. Pass `onToggleCorrect` to `OptionRow` in the template (add to the existing `<OptionRow … />`):

```svelte
                      onToggleCorrect={(next) => void toggleCorrect(o.id, next)}
```

- [ ] **Step 8: Pass the placeholder `confirmKeyChange` from `QuizEditor.svelte`**

In `QuizEditor.svelte`, add the prop to the `<QuestionAccordion … />` instance (T7 replaces the arrow with the real latch method):

```svelte
              confirmKeyChange={() => true}
```

- [ ] **Step 9: Run the accordion + editor tests**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts src/tests/QuizEditor.svelte.test.ts`
Expected: PASS (correctness machines + all prior cases; QuizEditor still green with the placeholder prop).

- [ ] **Step 10: Full suite + type-check**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error`
Expected: all PASS; 0 svelte-check errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/editor/OptionRow.svelte frontend/src/components/editor/QuestionAccordion.svelte frontend/src/components/editor/QuizEditor.svelte frontend/src/tests/OptionRow.svelte.test.ts frontend/src/tests/QuestionAccordion.svelte.test.ts
git commit -m "feat(editor): single_choice & multiple_choice correctness state machines (§8.2/§8.4)"
```

---

## Task T6: Version-gating (§9) + disabled/archived read-only + error handling (§10)

Most per-control gating is already wired through `perms.canEditStructure` / `canEditTextFields` (T5b/T5c). This task **verifies** the §9 table with characterization tests, adds the whole-editor **read-only notice** for archived/disabled versions (mirrors `ItemEditPage:299–323`), and adds the §10 **guarded `loadAdminTree(vid,{force})` re-gate** on 403/409 mutation errors (refreshing `perms` after a concurrent publish/disable) — distinct from the 422/400 inline-revert paths, which do **not** re-gate.

**Files:**
- Modify: `frontend/src/components/editor/QuizEditor.svelte` (read-only notice; question-mutation 403/409 re-gate)
- Modify: `frontend/src/components/editor/QuestionAccordion.svelte` (option-mutation + text-Save 403/409 re-gate via an `afterOptionError` helper; import `loadAdminTree`)
- Test: `frontend/src/tests/QuestionAccordion.svelte.test.ts` (gating table + re-gate cases)
- Test: `frontend/src/tests/QuizEditor.svelte.test.ts` (read-only notice)

**Interfaces:**
- Consumes: `loadAdminTree` (`stores/currentEditorVersion.svelte`), `ApiError.status` (403/409/422/400).
- Produces: `QuestionAccordion.afterOptionError(e, savedVid, fallback)` — sets the inline option error, re-fetches options (§6 write-back), and on 403/409 calls the guarded `loadAdminTree`. `QuizEditor` gains a `readOnlyAll` derived + a question-mutation re-gate.

- [ ] **Step 1: Write the failing/characterization tests — §9 gating + read-only notice**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts` (add `import * as store from '../stores/currentEditorVersion.svelte';` at the top):

```ts
it('published: structure controls hidden, correctness + option text editable, no structural calls', async () => {
  const PUB = versionPermissions({ state: 'published', is_disabled: false });
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const create = vi.spyOn(qa, 'createOption');
  const del = vi.spyOn(qa, 'deleteOption');
  const reorder = vi.spyOn(qa, 'reorderOptions');
  const { target } = mountAccordion(choiceQ(), { perms: PUB });
  await tick(); await tick(); flushSync();
  expect([...target.querySelectorAll('button')].some((b) => b.textContent?.includes('Add option'))).toBe(false);
  expect(target.querySelector('button[aria-label="Delete option"]')).toBeNull();
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(false);     // correctness allowed
  expect((target.querySelector('[data-testid="option-text"]') as HTMLInputElement).readOnly).toBe(false); // text editable
  expect(create).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled(); expect(reorder).not.toHaveBeenCalled();
});

it('archived/disabled: option area is fully read-only', async () => {
  const OFF = versionPermissions({ state: 'created', is_disabled: true });
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target } = mountAccordion(choiceQ(), { perms: OFF });
  await tick(); await tick(); flushSync();
  expect((target.querySelector('[data-testid="option-text"]') as HTMLInputElement).readOnly).toBe(true);
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(true);
  expect(target.querySelector('button[aria-label="Delete option"]')).toBeNull();
});
```

Add to `frontend/src/tests/QuizEditor.svelte.test.ts`:

```ts
it('a disabled version shows the whole-editor read-only notice', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const DIS = { ...VERSION, is_disabled: true };
  const { target } = mountEditor({ version: DIS, perms: versionPermissions(DIS) });
  await tick(); await tick(); flushSync();
  expect(target.querySelector('[data-testid="quiz-readonly"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run the gating tests**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "published\|archived"`
Expected: the two accordion gating tests **PASS** already (the §9 wiring from T5b/T5c is correct). The QuizEditor `quiz-readonly` test FAILS (notice not yet rendered).

*If a gating test fails:* the §9 wiring has a real gap — fix the control's `perms`-derived disabled/`{#if}` before continuing (do not weaken the test).

- [ ] **Step 3: Add the read-only notice to `QuizEditor.svelte`**

3a. Add the derived flag (near `titleReadOnly`/`structureOff`):

```svelte
  const readOnlyAll = $derived(!perms.canEditTextFields && !perms.canEditStructure);  // archived/disabled (§9)
```

3b. Render the notice just inside `<section …>` (before the title row):

```svelte
  {#if readOnlyAll}<p class="muted" data-testid="quiz-readonly">This version is read-only — editing is disabled.</p>{/if}
```

- [ ] **Step 4: Run the read-only test**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts -t "read-only"`
Expected: PASS.

- [ ] **Step 5: Write the failing tests — §10 guarded re-gate (403/409 only)**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts`:

```ts
it('a 409 on an option mutation re-gates via loadAdminTree({force}) + shows an inline error (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: false, order: 1 })]);
  vi.spyOn(qa, 'createOption').mockRejectedValue(new ApiError(409, "Can only add options in 'created' state"));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  addOptionBtn(target).click(); await tick(); flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'X');
  await tick(); flushSync();
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement).click();
  await tick(); await tick(); await tick(); flushSync();
  expect(refresh).toHaveBeenCalledWith(10, { force: true });     // mountAccordion vid = 10
  expect(target.querySelector('[data-testid="option-mut-error"]')).not.toBeNull();
});

it('a 422 last-correct does NOT re-gate (state unchanged, §10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  vi.spyOn(qa, 'updateOption').mockRejectedValue(new ApiError(422, 'At least one option must be correct'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await tick(); await tick(); flushSync();
  const box = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
  box.checked = false; box.dispatchEvent(new Event('change'));
  await tick(); await tick(); await tick(); flushSync();
  expect(refresh).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "re-gate"`
Expected: FAIL — the 409 case does not call `loadAdminTree` yet.

- [ ] **Step 7: Implement the guarded re-gate in `QuestionAccordion.svelte`**

7a. Import the store fn:

```svelte
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
```

7b. Add the helper (near the option helpers) and route every option-mutation catch through it:

```svelte
  async function afterOptionError(e: unknown, savedVid: number, fallback: string) {
    if (!(alive && vid === savedVid)) return;
    optMutError = e instanceof ApiError ? e.displayMessage : fallback;
    await resyncOptions(savedVid);                               // §6 write-back (option-level)
    if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
      await loadAdminTree(vid, { force: true });                // §10 re-gate (refresh perms); 422/400 do NOT
    }
  }
```

Replace the `catch` bodies of `addOption` / `removeOption` / `moveOption` / `commitText` / `toggleCorrect` with the helper (keeping each handler's `finally`):

```svelte
    } catch (e) {
      await afterOptionError(e, savedVid, 'Add option failed');
    } finally {
      if (alive) optionsLocked = false;
    }
```

(Use the matching fallback string per handler: `'Delete option failed'`, `'Reorder failed'`, `'Save option text failed'`, `'Correctness update failed'`. `moveOption` and `toggleCorrect` previously called `resyncOptions()` inline — that work now lives in `afterOptionError`, so drop the inline `resyncOptions()` from their catch bodies.)

7c. Add the §10 re-gate to the question **text Save** catch (`save()` — `updateQuestion` origin, "nothing extra" beyond the re-gate; the dirty draft stays):

```svelte
    } catch (e) {
      if (alive && vid === savedVid) {
        pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
        if (e instanceof ApiError && (e.status === 403 || e.status === 409)) await loadAdminTree(vid, { force: true });
      }
    } finally {
      if (alive) saveBusy = false;
    }
```

- [ ] **Step 8: Add the question-list 403/409 re-gate in `QuizEditor.svelte`**

Each of `submitAdd` / `removeQuestion` / `move` re-runs `listQuestions` (via `load()`) on error and, for 403/409, also force-refreshes the tree. `removeQuestion`/`move` already call `load()`; add the re-gate. `submitAdd` adds both:

```svelte
  // submitAdd catch:
    } catch (e) {
      if (alive && vid === savedVid) {
        addError = e instanceof ApiError ? e.displayMessage : 'Add failed';
        if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
          await load();                                  // resync question list/order
          await loadAdminTree(savedVid, { force: true }); // §10 re-gate
        }
      }
    } finally { if (alive) questionsLocked = false; }

  // removeQuestion catch & move catch — after the existing pushToast + `await load();`, add:
        if (e instanceof ApiError && (e.status === 403 || e.status === 409)) await loadAdminTree(savedVid, { force: true });
```

- [ ] **Step 9: Run the accordion + editor suites**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts src/tests/QuizEditor.svelte.test.ts`
Expected: PASS (re-gate cases + gating + all prior; the worked-example-2 / thrown-set-false tests still pass — `afterOptionError` performs the same resync they relied on).

- [ ] **Step 10: Full suite + type-check**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error`
Expected: all PASS; 0 svelte-check errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/editor/QuizEditor.svelte frontend/src/components/editor/QuestionAccordion.svelte frontend/src/tests/QuestionAccordion.svelte.test.ts frontend/src/tests/QuizEditor.svelte.test.ts
git commit -m "feat(editor): §9 gating verification + read-only notice + §10 guarded re-gate"
```

---

## Task T7: Published answer-key confirm (§8.7) + type dead-end note (§8.8)

T5c already calls `confirmKeyChange(question.id)` before a correctness toggle (QuizEditor passed a `() => true` placeholder). This task implements the **real** latch in `QuizEditor`, adds the call site to the question **text Save** (key fields only), and surfaces the published **type dead-end** note.

**Files:**
- Modify: `frontend/src/components/editor/QuizEditor.svelte` (the `confirmKeyChange(questionId)` latch; remove the `void version;` line — `version.state` is now used; pass the real method to each accordion)
- Modify: `frontend/src/components/editor/QuestionAccordion.svelte` (Save-key call site; §8.8 published note via `isPublished` derived)
- Test: `frontend/src/tests/QuizEditor.svelte.test.ts` (latch behaviour)
- Test: `frontend/src/tests/QuestionAccordion.svelte.test.ts` (Save-key call site; §8.8 note)

**Interfaces:**
- Consumes: `version.state` (`AdminTreeVersion`), `window.confirm`, the accordion's existing `confirmKeyChange` prop (T5c).
- Produces: `QuizEditor.confirmKeyChange(questionId: number): boolean` — `true` if not published or already-latched; else prompts and records the latch (`Set<number>`, fresh each `{#key item.id}` mount). The accordion's `save()` gains a key-change gate; `isPublished = canEditTextFields && !canEditStructure` drives the §8.8 note.

- [ ] **Step 1: Write the failing tests — the latch (QuizEditor)**

Add to `frontend/src/tests/QuizEditor.svelte.test.ts`. Helper to seed a published single_choice question + options and expand it:

```ts
const twoOptions = () => [
  { id: 1, question_id: 1, text: 'A', is_correct: true, order: 1 },
  { id: 2, question_id: 1, text: 'B', is_correct: false, order: 2 },
];
const expandFirst = async (target: HTMLElement) => {
  (target.querySelector('button.expand') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();
};

it('§8.7: a published correctness toggle prompts once; cancel aborts the mutation', async () => {
  const PUB = { ...VERSION, state: 'published' as const };
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue(twoOptions());
  const upd = vi.spyOn(qa, 'updateOption').mockResolvedValue({ id: 2, question_id: 1, text: 'B', is_correct: true, order: 2 });
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);   // cancel
  const { target } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await tick(); await tick(); await tick(); flushSync();
  await expandFirst(target);
  ([...target.querySelectorAll('input[type="radio"]')] as HTMLInputElement[])[1].click();
  await tick(); await tick(); flushSync();
  expect(confirmSpy).toHaveBeenCalledOnce();
  expect(upd).not.toHaveBeenCalled();                  // cancelled → no key change
});

it('§8.7: the latch prompts at most once per question per mount', async () => {
  const PUB = { ...VERSION, state: 'published' as const };
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue(twoOptions());
  vi.spyOn(qa, 'updateOption').mockImplementation((oid: number, body: { is_correct?: boolean }) =>
    Promise.resolve({ id: oid, question_id: 1, text: 'x', is_correct: !!body.is_correct, order: oid }));
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await tick(); await tick(); await tick(); flushSync();
  await expandFirst(target);
  const radios = () => [...target.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  radios()[1].click(); await tick(); await tick(); await tick(); flushSync();   // prompt #1 → switch to B
  radios()[0].click(); await tick(); await tick(); await tick(); flushSync();   // latched → no prompt
  expect(confirmSpy).toHaveBeenCalledOnce();
});

it('§8.7: created versions never prompt', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue(twoOptions());
  vi.spyOn(qa, 'updateOption').mockResolvedValue({ id: 2, question_id: 1, text: 'B', is_correct: true, order: 2 });
  const confirmSpy = vi.spyOn(window, 'confirm');
  const { target } = mountEditor();                    // created (default)
  await tick(); await tick(); await tick(); flushSync();
  await expandFirst(target);
  ([...target.querySelectorAll('input[type="radio"]')] as HTMLInputElement[])[1].click();
  await tick(); await tick(); flushSync();
  expect(confirmSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts -t "§8.7"`
Expected: FAIL — QuizEditor still passes the `() => true` placeholder, so the published cancel case still mutates / never prompts.

- [ ] **Step 3: Implement `confirmKeyChange` in `QuizEditor.svelte`**

3a. Remove the `void version;` line (line ~27) — `version.state` is now read.

3b. Add the latch (near the other top-level state):

```svelte
  // ---- §8.7 published answer-key confirm latch. Per question, per mount: the
  //      Set is recreated on every mount, and {#key item.id} remounts QuizEditor
  //      on item navigation, so the latch resets exactly when the spec requires. ----
  const keyConfirmed = new Set<number>();
  function confirmKeyChange(questionId: number): boolean {
    if (version.state !== 'published') return true;       // only published is guarded
    if (keyConfirmed.has(questionId)) return true;        // already confirmed this mount
    const ok = confirm(
      'This quiz is published. Changing the answer key does not re-score students who already ' +
      'attempted — their recorded scores keep the old key. To re-grade everyone, create a new ' +
      'version instead. Continue?',
    );
    if (ok) keyConfirmed.add(questionId);
    return ok;
  }
```

3c. Pass the real method to each accordion — replace `confirmKeyChange={() => true}` with:

```svelte
              {confirmKeyChange}
```

- [ ] **Step 4: Run the latch tests**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts -t "§8.7"`
Expected: PASS.

- [ ] **Step 5: Write the failing tests — Save-key call site + §8.8 note (accordion)**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts`:

```ts
it('§8.7: a numeric key Save calls confirmKeyChange and aborts on cancel', async () => {
  const upd = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q());
  const confirmKeyChange = vi.fn().mockReturnValue(false);
  const { target } = mountAccordion(q(), { confirmKeyChange });
  flushSync();
  setVal(target.querySelector('[data-testid="numeric-input"]') as HTMLInputElement, '9');
  await tick(); flushSync();
  saveBtn(target).click();
  await tick(); flushSync();
  expect(confirmKeyChange).toHaveBeenCalledWith(1);
  expect(upd).not.toHaveBeenCalled();
});

it('§8.7: a text-only Save does NOT call confirmKeyChange', async () => {
  const upd = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ text_md: 'New body', text_html: '<p>New body</p>' }));
  const confirmKeyChange = vi.fn().mockReturnValue(true);
  const { target } = mountAccordion(q(), { confirmKeyChange });
  flushSync();
  setVal(target.querySelector('textarea') as HTMLTextAreaElement, 'New body');   // text_md only; numeric unchanged
  await tick(); flushSync();
  saveBtn(target).click();
  await tick(); flushSync();
  expect(confirmKeyChange).not.toHaveBeenCalled();
  expect(upd).toHaveBeenCalled();
});

it('§8.8: a published question shows the type dead-end note; created does not', async () => {
  const PUB = versionPermissions({ state: 'published', is_disabled: false });
  const pub = mountAccordion(q(), { perms: PUB });
  flushSync();
  expect(pub.target.querySelector('[data-testid="published-type-note"]')).not.toBeNull();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const cre = mountAccordion(q());                      // created
  flushSync();
  expect(cre.target.querySelector('[data-testid="published-type-note"]')).toBeNull();
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "§8.7\|§8.8"`
Expected: FAIL — `save()` has no key gate; no published note.

- [ ] **Step 7: Implement the Save-key gate + §8.8 note in `QuestionAccordion.svelte`**

7a. Add the key-change gate at the top of `save()` (after `if (!canSave) return;`):

```svelte
    const keyChanged =
      (question.type === 'numeric_answer' && (draft.numericInput !== saved.numericInput || draft.precision !== saved.precision)) ||
      (question.type === 'text_answer' && draft.correct_text !== saved.correct_text);
    if (keyChanged && !confirmKeyChange(question.id)) return;   // §8.7 — abort on cancel
```

7b. Add the published derivation (near `editable`):

```svelte
  const isPublished = $derived(perms.canEditTextFields && !perms.canEditStructure);  // §8.8 (published only)
```

7c. Render the §8.8 note in the body, just under the read-only type badge (`<span class="readonly-type">…</span>`):

```svelte
      {#if isPublished}
        <p class="muted" data-testid="published-type-note">Type can't be changed. To replace this question, create a new version.</p>
      {/if}
```

- [ ] **Step 8: Run the accordion tests**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "§8.7\|§8.8"`
Expected: PASS.

- [ ] **Step 9: Full suite + type-check**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error`
Expected: all PASS; 0 svelte-check errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/editor/QuizEditor.svelte frontend/src/components/editor/QuestionAccordion.svelte frontend/src/tests/QuizEditor.svelte.test.ts frontend/src/tests/QuestionAccordion.svelte.test.ts
git commit -m "feat(editor): §8.7 published answer-key confirm latch + §8.8 type dead-end note"
```

---

## Task T8: Accessibility (§10a) + focus management + full test sweep

**Files:**
- Modify: `frontend/src/components/editor/QuestionAccordion.svelte` (choice option group as `<fieldset>`+`<legend>`; `aria-live` option-order announcement; focus after expand / add-option / delete-option / Save)
- Modify: `frontend/src/components/editor/OptionRow.svelte` (correctness control accessible name = option position; `data-option-id` hook for focus; `role="alert"` on the length warning)
- Modify: `frontend/src/components/editor/QuizEditor.svelte` (`aria-live` question-order announcement; focus the new question after add)
- Test: `frontend/src/tests/QuestionAccordion.svelte.test.ts`, `frontend/src/tests/OptionRow.svelte.test.ts`, `frontend/src/tests/QuizEditor.svelte.test.ts` (a11y structure + focus)

**Interfaces:**
- Consumes: `tick` (already imported in the accordion via `svelte`? it imports `getContext, onMount, onDestroy` — add `tick`), `bind:this` element refs.
- Produces: no new public props. A visually-hidden `aria-live="polite"` region per editor surface; focus transitions matching Plan A's depth.

- [ ] **Step 1: Write the failing tests — a11y structure**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts`:

```ts
it('single_choice options form a labelled radiogroup (fieldset + legend)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  const fs = target.querySelector('fieldset[data-testid="option-group"]');
  expect(fs).not.toBeNull();
  expect(fs?.querySelector('legend')).not.toBeNull();
  expect(fs?.querySelectorAll('input[type="radio"]')).toHaveLength(2);
});

it('reordering an option announces via the aria-live region', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  vi.spyOn(qa, 'reorderOptions').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  const live = target.querySelector('[data-testid="option-live"]') as HTMLElement;
  expect(live.getAttribute('aria-live')).toBe('polite');
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();
  expect(live.textContent).toMatch(/position 2 of 2/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "radiogroup\|aria-live"`
Expected: FAIL — option list is a plain `<ol>`, no live region.

- [ ] **Step 3: Implement the choice option group + aria-live in `QuestionAccordion.svelte`**

3a. Add `tick` to the `svelte` import and add the announce state + a body ref:

```svelte
  import { getContext, onMount, onDestroy, tick } from 'svelte';
  // …
  let optionAnnounce = $state('');
  let bodyEl: HTMLElement | undefined = $state();
```

3b. Wrap the choice option list in a `<fieldset>` and add the live region. Replace the loaded-state `<ol class="options">…</ol>` wrapper with:

```svelte
            <fieldset class="option-group" data-testid="option-group">
              <legend>{snippet || 'Answer options'}{question.type === 'single_choice' ? ' — select the correct option' : ' — select all correct options'}</legend>
              <ol class="options">
                {#each options as o, i (o.id)}
                  {@const t = optionTrackers.get(o.id)}
                  {#if t}
                    <li>
                      <OptionRow
                        option={o} index={i + 1} count={options.length} questionType={question.type}
                        {perms} optionsLocked={optionsDisabled} canDelete={canDeleteOption(o)}
                        bind:draft={t.current.text}
                        onToggleCorrect={(next) => void toggleCorrect(o.id, next)}
                        onCommitText={() => void commitText(o.id)}
                        onDelete={() => void removeOption(o.id)}
                        onMoveUp={() => void moveOption(o.id, -1)}
                        onMoveDown={() => void moveOption(o.id, 1)}
                      />
                    </li>
                  {/if}
                {/each}
              </ol>
            </fieldset>
```

3c. Add the live region inside the body (e.g. right after the `<fieldset>`/`No options` block):

```svelte
          <p class="sr-only" aria-live="polite" data-testid="option-live">{optionAnnounce}</p>
```

3d. Announce on a successful reorder — in `moveOption`, after the optimistic `setOptions(...)` (before the `try`), set the message from the new index:

```svelte
    const newIndex = options.findIndex((o) => o.id === oid) + 1;
    optionAnnounce = `Option moved to position ${newIndex} of ${options.length}`;
```

3e. Add `bind:this={bodyEl}` to the body container `<div class="body">`, and the `.sr-only` + `.option-group` styles:

```svelte
  .option-group { border: none; margin: 0; padding: 0; }
  .option-group legend { font-size: 0.85em; color: var(--text-muted, #666); padding: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
```

- [ ] **Step 4: Run the a11y-structure tests**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "radiogroup\|aria-live"`
Expected: PASS.

- [ ] **Step 5: Write the failing tests — focus management**

Add to `frontend/src/tests/QuestionAccordion.svelte.test.ts`:

```ts
it('expanding a question moves focus into the body', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, is_correct: true, order: 1 })]);
  const { target, props } = mountAccordion(choiceQ(), { expanded: false });
  await tick(); await tick(); flushSync();
  props.expanded = true;                               // simulate expand
  await tick(); await tick(); flushSync();
  expect(target.querySelector('.body')?.contains(document.activeElement)).toBe(true);
});

it('adding an option focuses the new option input', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  vi.spyOn(qa, 'createOption').mockResolvedValue(opt({ id: 3, text: 'Madrid', is_correct: true, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  addOptionBtn(target).click(); await tick(); flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'Madrid');
  await tick(); flushSync();
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement).click();
  await tick(); await tick(); await tick(); flushSync();
  const last = [...target.querySelectorAll('[data-testid="option-text"]')].at(-1) as HTMLInputElement;
  expect(document.activeElement).toBe(last);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "focus"`
Expected: FAIL — no focus moves yet.

- [ ] **Step 7: Implement focus management (§10a) in `QuestionAccordion.svelte`**

7a. Focus the body's first focusable when expanded. Add an `$effect` keyed on `expanded`:

```svelte
  // Focus the body's first field on expand (§10a). tick() lets the body render first.
  $effect(() => {
    if (expanded) {
      void tick().then(() => {
        if (alive) (bodyEl?.querySelector('input:not([readonly]), textarea:not([readonly]), button:not([disabled])') as HTMLElement | null)?.focus();
      });
    }
  });
```

7b. After a successful add-option, focus the new row's input. In `addOption`'s success branch, after `setOptions([...])`, capture the new id and focus post-`tick`:

```svelte
      const created = await createOption(question.id, { text, is_correct });
      if (!(alive && vid === savedVid)) return;
      setOptions([...options, created].sort((a, b) => a.order - b.order));
      addingOption = false; newOptionText = '';
      await tick();
      if (alive) (bodyEl?.querySelector(`[data-option-id="${created.id}"]`) as HTMLElement | null)?.focus();
```

7c. After deleting an option, focus the sibling (prev if it was last). In `removeOption`'s success branch:

```svelte
      const idx = options.findIndex((o) => o.id === oid);
      const survivors = options.filter((o) => o.id !== oid);
      setOptions(survivors);
      const focusId = survivors[Math.min(idx, survivors.length - 1)]?.id;
      await tick();
      if (alive && focusId != null) (bodyEl?.querySelector(`[data-option-id="${focusId}"]`) as HTMLElement | null)?.focus();
```

7d. After a successful question Save, return focus to the header expand button. Add a header ref `let expandBtn: HTMLButtonElement | undefined = $state();` with `bind:this={expandBtn}` on the header `<button class="expand" …>`, then in `save()`'s success branch (after advancing `saved`/`draft`):

```svelte
      await tick();
      if (alive) expandBtn?.focus();
```

7e. `OptionRow.svelte` — add the focus hook + correctness accessible name + alert role:

```svelte
  <input class="opt-input" data-testid="option-text" data-option-id={option.id} bind:value={draft}
         readonly={textReadOnly} onblur={() => onCommitText()}
         aria-label={`Option ${index} text`} aria-invalid={lenInvalid} maxlength="500" />
  {#if lenInvalid}<span class="len-warn" role="alert" data-testid="option-len-warn">1–500 chars</span>{/if}
```

and the correctness control `aria-label={`Mark option ${index} correct`}` (radio and checkbox).

- [ ] **Step 8: Run the focus tests**

Run: `cd frontend && npx vitest run src/tests/QuestionAccordion.svelte.test.ts -t "focus"`
Expected: PASS.

- [ ] **Step 9: Write + implement QuizEditor a11y (question-order live region + add-question focus)**

9a. Test — add to `frontend/src/tests/QuizEditor.svelte.test.ts`:

```ts
it('reordering a question announces via the aria-live region', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' }),
  ]);
  vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await tick(); await tick(); flushSync();
  const live = target.querySelector('[data-testid="question-live"]') as HTMLElement;
  expect(live.getAttribute('aria-live')).toBe('polite');
  const firstHeader = target.querySelector('[data-testid="question-header"]') as HTMLElement;
  (firstHeader.querySelector('button[aria-label="Move down"]') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();
  expect(live.textContent).toMatch(/position 2 of 2/i);
});
```

9b. Implement in `QuizEditor.svelte`: add `let questionAnnounce = $state('');`, render `<p class="sr-only" aria-live="polite" data-testid="question-live">{questionAnnounce}</p>` inside the `<section>`, set it in `move()` after the optimistic reorder (`const newIndex = questions.findIndex((x) => x.id === qid) + 1; questionAnnounce = `Question moved to position ${newIndex} of ${questions.length}`;`), and add the `.sr-only` style. After a successful add-question (`submitAdd`), focus the new question's header: capture the created accordion and, post-`tick`, focus its expand button (query `[data-testid="question-header"]` for the row whose accordion matches `expandedId === created.id` — simplest: after `await tick()`, focus the last-rendered expanded question header's first focusable). Implementation:

```svelte
      expandedId = created.id;
      await loadAdminTree(savedVid, { force: true });
      await tick();
      if (alive) (document.querySelector(`[data-q-id="${created.id}"] .expand`) as HTMLElement | null)?.focus();
```

…and pass a `data-q-id={q.id}` attribute on each `<li>` wrapping the accordion (so the focus query can find the new row).

- [ ] **Step 10: Run the QuizEditor a11y tests**

Run: `cd frontend && npx vitest run src/tests/QuizEditor.svelte.test.ts -t "aria-live"`
Expected: PASS.

- [ ] **Step 11: Full test sweep — frontend + backend smoke + type-check**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error`
Expected: ALL frontend tests PASS; 0 svelte-check errors.

Run: `cd backend && .venv/bin/pytest -q`
Expected: PASS (no backend change — confirms nothing regressed; the slice is frontend-only).

- [ ] **Step 12: Commit**

```bash
git add frontend/src/components/editor/QuestionAccordion.svelte frontend/src/components/editor/OptionRow.svelte frontend/src/components/editor/QuizEditor.svelte frontend/src/tests/QuestionAccordion.svelte.test.ts frontend/src/tests/OptionRow.svelte.test.ts frontend/src/tests/QuizEditor.svelte.test.ts
git commit -m "feat(editor): quiz-option a11y (radiogroup, aria-live order, focus management) §10a"
```

---

## Task T9: Manual smoke walkthrough (§15)

**This is a human-run task** — a browser walkthrough, not automated code. An implementer subagent cannot click through the editor, so the controller hands this checklist to the user; mark it complete only after the user confirms the walkthrough passed. No production commit (optionally commit a filled-in copy of this checklist if the user wants a record).

**Setup:**
- Backend running with seed data (a course with a `created`, a `published`, and a `disabled` version), e.g. `cd backend && .venv/bin/uvicorn mathion.main:app --reload`.
- Frontend dev server: `cd frontend && npm run dev`; open the course editor as a CourseAdmin/superuser.
- Have one course version in each state to exercise the three gating rows of §9.

**Run against a `created`, then `published`, then `disabled` version (§15):**

- [ ] **1.** "＋ New item" → **Quiz** → opens an empty `QuizEditor` (title field + "No questions yet." + "＋ Add question").
- [ ] **2.** Add one question of **each** type. Numeric: set value + precision (tolerance hint visible before editing). Text: set the answer. Confirm create-time validation blocks an empty/invalid numeric or text answer.
- [ ] **3.** single_choice: add 3 options; confirm the **first** is auto-correct (✓ marker); switch the correct option via the radio — exactly **one** stays selected and the header correct-count stays `1`; try to delete the **correct** option → its 🗑 is disabled (C2).
- [ ] **4.** multiple_choice: add 4 options, mark **2** correct (checkboxes); uncheck the **last** correct → inline error + the checkbox **reverts** to checked (422 → §6 write-back).
- [ ] **5.** Edit a question's text → Save; confirm the option controls were **locked** until Save finished, and the text inputs were **locked during** an option toggle (§7.2 two-way lock).
- [ ] **6.** Reorder questions and options with ↑/↓ (listen for the `aria-live` announcement); reload the page → order persists.
- [ ] **7.** Delete an option and a question (confirm dialogs); the course-tree item row's `questions_count` updates.
- [ ] **8.** Navigate away with an unsaved question/option-text edit → DirtyGuard warns; confirm an **uncommitted option-text draft** alone triggers the warning.
- [ ] **9.** **Publish** the version; reopen: add/delete/reorder (question + option) are disabled; text + correctness edits allowed; the **first** answer-key edit per question opens the §8.7 `window.confirm`; a **text-only** edit does **not**; the §8.8 "type can't be changed" note shows.
- [ ] **10.** **Disable** the version: the whole quiz editor is read-only (the §9 read-only notice shows; every control disabled).
- [ ] **11.** Keyboard / screen-reader pass, itemized: (a) tab through and operate radios, checkboxes, reorder buttons; (b) verify the `aria-live` order-change announcement fires; (c) force a validation error and verify the `role="alert"`; (d) confirm the §8.7 `window.confirm` is reachable and operable; (e) verify focus lands correctly after add/delete/expand/Save.

- [ ] **12.** Record the outcome in the ledger (`.superpowers/sdd/progress.md`): `T9: smoke PASS` (or file any defects as follow-up tasks before marking Plan B done).

---

## Plan self-review (writing-plans)

Checked the plan against the spec with fresh eyes:

**1. Spec coverage (§N → task):**
- §3.3/§3.4/§3.6 option contract → Global Constraints + T5a–T5c (load/create/update/delete/reorder, 422/409/400, no-delete-guard). ✓
- §4.1 OptionRow/QuestionAccordion interfaces → built incrementally T5a (display) → T5b (text + structure) → T5c (correctness); final shape matches §4.1. ✓
- §4.1a lifecycle/stale guard (token + onDestroy bump; `alive && vid===savedVid`) → T5a loader + every mutation handler (T5b/T5c/T6). ✓
- §6 split loading + write-back → T5a (accordion loads own options) + `resyncOptions` (T5b). ✓
- §7.1 accordion-owned drafts/trackers feeding `quizDirty` → T5b (`optionTrackers` registered) + tests. ✓
- §7.2 `optionsLocked` (whole single_choice sequence in one `finally`), text↔option two-way lock, apply-if-current → T5b/T5c. ✓
- §8.1/§8.2 multiple_choice (≥1 correct, optimistic, last-correct 422 revert) → T5c. ✓ §8.3 numeric (Plan A; tolerance-hint typo noted) → Global Constraints. ✓
- §8.4 single_choice machine (set-true-first awaited, no-op, 2-correct repair, confirm-once) → T5c. ✓
- §8.5 text (Plan A). §8.6 add/delete/visibility + C2 → T5b. ✓
- §8.7 confirm latch → T7 (QuizEditor method + accordion Save-key gate). ✓ §8.8 dead-end note → T7. ✓
- §9 gating table → T6 (verified; read-only notice). ✓ §10 errors (guarded re-gate per origin, 422/400 inline) → T6. ✓ §10a a11y/focus → T8. ✓
- §12 worked examples (switch-order; last-correct revert) → T5c tests, verbatim assertions. ✓ §13 manifest (OptionRow new; QuestionAccordion/QuizEditor modified) → matches. ✓ §15 smoke → T9. ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every step carries the actual code or the exact assertion. The one intentional placeholder (`confirmKeyChange={() => true}` in T5c) is explicitly replaced in T7. ✓

**3. Type consistency:** `AuthoringOption`/`QuestionType`/`OptionCreateBody` used as defined in `lib/quizAuthoring.ts`; `confirmKeyChange: (questionId: number) => boolean` identical in QuizEditor (producer) and QuestionAccordion (consumer); `setOptions`/`applyOption`/`afterOptionError`/`canDeleteOption` names stable across T5b→T6; `optionsLocked` (real flag) vs `optionsDisabled` (= `optionsLocked || dirty`, passed to OptionRow as its `optionsLocked` prop) distinction is consistent. ✓

**Notes for the executor / final review:**
- OptionRow is built **incrementally** across T5a→T5b→T5c (display → editable+structure → correctness). Each task replaces the whole file or shows the full changed blocks; transcribe the latest.
- The §8.3 tolerance-hint "±0.05" doc-typo (spec §3.7/§8.3) is **not** a code bug — the hint matches `backend/mathion/quiz.py:52`. Logged for spec correction; do not "fix" the hint to match the parenthetical.
- T6/T7 modify Plan-A-merged components (`QuizEditor`, `QuestionAccordion`); re-run the full suite after each (the steps do).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-quiz-authoring-plan-b.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh implementer subagent per task (T5a → T9), the strict two-stage review after each (task-reviewer + codex high-effort in parallel, fix all Critical/Important, re-review until clean, your explicit OK before marking complete), then a whole-branch final review. Matches how Plan A was executed.

**2. Inline Execution** — execute the tasks in this session via executing-plans, batch with checkpoints.

Which approach? (And per your usual cadence, you may want to run codex convergence rounds on this plan **before** execution — say the word and I'll prepare the copy-paste codex script.)
