import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import * as qa from '../lib/quizAuthoring';
import type { AuthoringQuestion, AuthoringOption } from '../lib/quizAuthoring';
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
