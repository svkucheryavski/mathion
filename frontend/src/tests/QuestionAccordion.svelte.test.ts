import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import * as qa from '../lib/quizAuthoring';
import type { AuthoringQuestion, AuthoringOption } from '../lib/quizAuthoring';
import { versionPermissions } from '../lib/versionPermissions';
import * as store from '../stores/currentEditorVersion.svelte';
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
    expanded: true, locked: false, confirmKeyChange: () => true,
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

it('a dirty form disables this question\'s delete/reorder (§7.2 text side)', async () => {
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

// ---- Option-loading tests (T5a) ----

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
  expect((rows[0].querySelector('[data-testid="option-text"]') as HTMLInputElement).value).toBe('First');
  expect((rows[1].querySelector('[data-testid="option-text"]') as HTMLInputElement).value).toBe('Second');
});

it('numeric/text questions never fetch options', async () => {
  const list = vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  mountAccordion(q());                                  // numeric (default factory)
  await tick(); await tick(); flushSync();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  mountAccordion(q({ type: 'text_answer', correct_numeric: null, precision: null, correct_text: 'paris' }));
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
  expect((target.querySelector('[data-testid="option-text"]') as HTMLInputElement).value).toBe('Recovered');
});

it('header shows the correct-count for choice questions', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, is_correct: true }), opt({ id: 2, is_correct: false }),
  ]);
  const { target } = mountAccordion(q({ type: 'single_choice', correct_numeric: null, precision: null }));
  await tick(); await tick(); flushSync();
  expect(target.querySelector('[data-testid="correct-count"]')?.textContent).toContain('1');
});

it('a late option-load response after unmount is discarded (§4.1a onDestroy token bump)', async () => {
  let resolveList!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions').mockReturnValue(new Promise((r) => { resolveList = r; }));
  mountAccordion(q({ type: 'single_choice', correct_numeric: null, precision: null }));
  await tick(); flushSync();
  cleanup?.(); cleanup = null;                          // unmount while the fetch is pending
  // The late response's `order` is read ONLY if the loader proceeds past the
  // discard guard (reaches the sort). With the onDestroy token bump,
  // `myToken !== optLoadToken` returns first, so `order` is never accessed.
  let orderReads = 0;
  const trap = () => ({ id: 9, question_id: 1, text: 'Late', is_correct: false,
    get order() { orderReads++; return 1; } } as unknown as AuthoringOption);
  resolveList([trap(), trap()]);                        // 2 elems → sort comparator reads `order`
  await tick(); await tick(); flushSync();
  expect(orderReads).toBe(0);                           // guard fired → stale response never sorted/applied
});

// ---- Option CRUD + locks + drafts tests (T5b) ----

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
  // §7.2 text-side lock: while optionsLocked, MarkdownEditor is in readOnly mode
  // → it renders a preview div, NOT a textarea (readOnly=true removes the textarea from the DOM)
  expect(target.querySelector('textarea')).toBeNull();
  resolveDel();
  await tick(); await tick(); flushSync();
});

it('resyncOptions discards a re-fetch that resolves after a vid change (§4.1a)', async () => {
  const initial = [opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 })];
  let resolveResync!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce(initial)                                  // mount load
    .mockReturnValueOnce(new Promise((r) => { resolveResync = r; })); // resync re-fetch
  vi.spyOn(qa, 'reorderOptions').mockRejectedValue(new Error('boom'));
  const { target, props } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  // trigger a reorder (move option 1 down) → reorderOptions rejects → resyncOptions pending
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();
  props.vid = 11;                                                   // route changed mid-resync
  await tick(); flushSync();
  let orderReads = 0;
  const trap = () => ({ id: 99, question_id: 1, text: 'STALE', is_correct: false, get order() { orderReads++; return 1; } } as unknown as AuthoringOption);
  resolveResync([trap(), trap()]);                                  // stale re-fetch for the OLD vid
  await tick(); await tick(); flushSync();
  expect(orderReads).toBe(0);                                       // guard fired → stale resync not applied
});

it('commitText is blocked while the question text form is dirty (§7.2 two-way lock, blur path)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const update = vi.spyOn(qa, 'updateOption');
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  // dirty the option-text draft while the question is still clean (input editable)
  const optInput = target.querySelector('[data-testid="option-text"]') as HTMLInputElement;
  setVal(optInput, 'A edited');
  await tick(); flushSync();
  // now dirty the QUESTION text form (programmatic input does NOT blur the option input)
  setVal(target.querySelector('textarea') as HTMLTextAreaElement, 'Edited body');
  await tick(); flushSync();
  expect(anyDirty(target)).toBe('dirty');
  // blur the option input → commitText must defer while the question is dirty
  optInput.dispatchEvent(new Event('blur', { bubbles: true }));
  await tick(); await tick(); flushSync();
  expect(update).not.toHaveBeenCalled();
});

it('a dirty question text form disables add-option (§7.2 two-way lock)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const create = vi.spyOn(qa, 'createOption');
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  // dirty the question's text form (edit text_md via the first MarkdownEditor textarea)
  setVal(target.querySelector('textarea') as HTMLTextAreaElement, 'Edited question body');
  await tick(); flushSync();
  expect(anyDirty(target)).toBe('dirty');
  expect(addOptionBtn(target).disabled).toBe(true);     // two-way lock: can't add while text dirty
  expect(create).not.toHaveBeenCalled();
});

// ---- Correctness state machines (T5c) ----

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
  box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true }));    // uncheck the only correct
  await tick(); await tick(); await tick(); await tick(); flushSync();
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
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce([
      opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
      opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
    ])                                                                   // initial load
    .mockResolvedValueOnce([
      opt({ id: 1, text: 'A', is_correct: false, order: 1 }),
      opt({ id: 2, text: 'B', is_correct: true, order: 2 }),
    ]);                                                                  // §6 resync after the throw
  const upd = vi.spyOn(qa, 'updateOption')
    .mockResolvedValueOnce(opt({ id: 2, is_correct: true, order: 2 }))   // set-true OK
    .mockRejectedValueOnce(new Error('boom'));                          // set-false throws
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  radios(target)[1].click();                                           // click B (false → real switch)
  await tick(); await tick(); await tick(); await tick(); flushSync();
  expect(upd).toHaveBeenCalledTimes(2);                                // entered the set-true → set-false sequence
  expect(target.querySelector('[data-testid="option-mut-error"]')).not.toBeNull();  // inline error surfaced
  expect(radios(target).some((r) => !r.disabled)).toBe(true);         // optionsLocked cleared in finally
});

// ---- §9 gating characterization tests (T6) ----

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

// ---- §10 re-gate tests (T6) ----

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

it('a 400 on an option mutation does NOT re-gate (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  vi.spyOn(qa, 'reorderOptions').mockRejectedValue(new ApiError(400, 'Bad request'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await tick(); await tick(); await tick(); flushSync();
  expect(refresh).not.toHaveBeenCalled();
});

// ---- §8.7 Save-key call site + §8.8 published note (T7) ----

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

// ---- §10a a11y structure + focus tests (T8) ----

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

it('delete-option focuses the surviving sibling at the same position (T8)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
    opt({ id: 3, text: 'C', is_correct: false, order: 3 }),
  ]);
  vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  // delete the MIDDLE option B (idx=1) → survivors [A,C], min(1,1)=1 → focus lands on C (id=3)
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  await tick(); await tick(); await tick(); flushSync();
  expect((document.activeElement as HTMLElement).getAttribute('data-option-id')).toBe('3');
});

it('successful Save returns focus to the header expand button (T8)', async () => {
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ text_md: 'New body', text_html: '<p>New body</p>' }));
  const { target } = mountAccordion(q());
  flushSync();
  // make a NON-key edit (text_md only → keyChanged=false → no confirmKeyChange)
  setVal(target.querySelector('textarea') as HTMLTextAreaElement, 'New body');
  await tick(); flushSync();
  saveBtn(target).click();
  await tick(); await tick(); flushSync();
  expect(document.activeElement).toBe(target.querySelector('button.expand'));
});

it('a 409 whose resync resolves after a vid change does NOT re-gate (§4.1a second guard)', async () => {
  const { ApiError } = await import('../lib/api');
  let resolveResync!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce([opt({ id: 1, text: 'A', is_correct: false, order: 1 })])     // initial load
    .mockReturnValueOnce(new Promise((r) => { resolveResync = r; }));                      // resync re-fetch (deferred)
  vi.spyOn(qa, 'createOption').mockRejectedValue(new ApiError(409, "Can only add in 'created' state"));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  addOptionBtn(target).click(); await tick(); flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'X');
  await tick(); flushSync();
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement).click();
  await tick(); await tick(); flushSync();          // createOption rejects → afterOptionError → resync pending
  props.vid = 11;                                    // navigate away mid-resync
  await tick(); flushSync();
  resolveResync([opt({ id: 1, text: 'A', is_correct: false, order: 1 })]);  // resync resolves now (vid already changed)
  await tick(); await tick(); flushSync();
  expect(refresh).not.toHaveBeenCalled();            // second guard short-circuits the re-gate
});

// ---- I1: correctnessEpoch re-syncs inputs on cancel/error (fix-wave) ----

it('I1: single_choice cancel re-syncs radio to state (epoch re-mounts inputs)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const upd = vi.spyOn(qa, 'updateOption');
  // confirmKeyChange returns false → cancel path (simulates published cancel)
  const cancelKeyChange = vi.fn().mockReturnValue(false);
  const PUB = versionPermissions({ state: 'published', is_disabled: false });
  const { target } = mountAccordion(choiceQ(), { perms: PUB, confirmKeyChange: cancelKeyChange });
  await tick(); await tick(); flushSync();
  // Click B's radio → confirmKeyChange fires → returns false (cancel)
  radios(target)[1].click();
  await tick(); flushSync();
  expect(cancelKeyChange).toHaveBeenCalled();
  expect(upd).not.toHaveBeenCalled();
  // After cancel + epoch bump: A must be checked, B must not
  await tick(); flushSync();
  const rs = radios(target);
  expect(rs[0].checked).toBe(true);   // A stays correct (epoch re-synced)
  expect(rs[1].checked).toBe(false);  // B stays incorrect
});

it('I1: multiple_choice cancel re-syncs checkbox to state (epoch re-mounts inputs)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'C', is_correct: true, order: 1 }),
  ]);
  const upd = vi.spyOn(qa, 'updateOption');
  // confirmKeyChange returns false → cancel path
  const cancelKeyChange = vi.fn().mockReturnValue(false);
  const PUB = versionPermissions({ state: 'published', is_disabled: false });
  const { target } = mountAccordion(choiceQ({ type: 'multiple_choice' }), { perms: PUB, confirmKeyChange: cancelKeyChange });
  await tick(); await tick(); flushSync();
  // Click the checkbox (currently checked=true) → cancel
  const box = boxes(target)[0];
  box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true }));
  await tick(); flushSync();
  expect(upd).not.toHaveBeenCalled();
  // After cancel + epoch bump: checkbox must still be checked (epoch re-synced)
  await tick(); flushSync();
  expect(boxes(target)[0].checked).toBe(true);
});

// ---- I3: delete question focuses sibling — moved to QuizEditor.svelte.test.ts ----

// ---- M1: < 2 options hint (fix-wave) ----

it('M1: choice question with 1 option shows few-options-warn; with 2 options it does not', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
  ]);
  const { target } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  expect(target.querySelector('[data-testid="few-options-warn"]')).not.toBeNull();
  // Clean up and mount with 2 options
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
  ]);
  const { target: t2 } = mountAccordion(choiceQ());
  await tick(); await tick(); flushSync();
  expect(t2.querySelector('[data-testid="few-options-warn"]')).toBeNull();
});
