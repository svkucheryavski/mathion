import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import * as qa from '../lib/quizAuthoring';
import type { AuthoringQuestion, AuthoringOption, OptionUpdateBody } from '../lib/quizAuthoring';
import type { QuizContributor } from '../lib/quizSave';
import { versionPermissions } from '../lib/versionPermissions';
import * as store from '../stores/currentEditorVersion.svelte';
// The Harness provides the private dirty registry and the QUIZ_SAVE_KEY hub
// (QuizEditor does this in production), exposes registry.isAnyDirty() at
// [data-testid="any-dirty"], and hands the save contributor to the test.
import Harness from './support/QuestionAccordionHarness.svelte';

const PERMS = versionPermissions({ state: 'created', is_disabled: false });
const stubAssetCtx = () => ({ kind: 'course', list: vi.fn().mockResolvedValue([]), upload: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined), imgSrc: () => '', renderPreview: vi.fn().mockResolvedValue({ html: '' }) }) as never;

const q = (over: Partial<AuthoringQuestion> = {}): AuthoringQuestion => ({
  id: 1, item_id: 4, text_md: 'Q', text_html: '<p>Q</p>', type: 'numeric_answer', order: 1,
  explanation_md: null, explanation_html: null, correct_numeric: 3, precision: 0, correct_text: null, ...over,
});
const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 1, text: 'A', is_correct: false, order: 1, ...over,
});
const choiceQ = (over: Partial<AuthoringQuestion> = {}) =>
  q({ type: 'single_choice', correct_numeric: null, precision: null, ...over });
const AB = () => [opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: false, order: 2 })];

let cleanup: (() => void) | null = null;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

function mountAccordion(question: AuthoringQuestion, over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  let contributor: QuizContributor | null = null;
  const props: Record<string, unknown> = $state({
    question, vid: 10, index: 1, count: 1, perms: PERMS, assetContext: stubAssetCtx(),
    expanded: true, locked: false, versionDisabled: false, frozen: false,
    onExpandToggle: () => {}, onDelete: () => {}, onMoveUp: () => {}, onMoveDown: () => {},
    onContributor: (c: QuizContributor) => { contributor = c; },
    ...over,
  });
  const cmp = mount(Harness, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, props, c: () => contributor! };
}
const loaded = async () => { await tick(); await tick(); flushSync(); };
const setVal = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};
const anyDirty = (t: HTMLElement) => t.querySelector('[data-testid="any-dirty"]')?.textContent;
const numInput = (t: HTMLElement) => t.querySelector('[data-testid="numeric-input"]') as HTMLInputElement;
const textArea = (t: HTMLElement) => t.querySelector('[data-field="text"] textarea') as HTMLTextAreaElement;
const optInputs = (t: HTMLElement) => [...t.querySelectorAll('[data-testid="option-text"]')] as HTMLInputElement[];
const radios = (t: HTMLElement) => [...t.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
const boxes = (t: HTMLElement) => [...t.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
const addOptionBtn = (t: HTMLElement) => t.querySelector('button[aria-label="Add option"]') as HTMLButtonElement;
const addBtn = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement;
const header = (t: HTMLElement) => t.querySelector('[data-testid="question-header"]') as HTMLElement;
const echoOption = () =>
  vi.spyOn(qa, 'updateOption').mockImplementation((id: number, body: OptionUpdateBody) =>
    Promise.resolve(opt({ id, text: body.text ?? (id === 1 ? 'A' : 'B'), is_correct: body.is_correct ?? id === 1, order: id })));

// ---- Question drafts and save() (Slice-5b T5a, §5.2-5.3) ----

it('a numeric draft is dirty; save() sends the canonical value and the echo makes it clean', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ correct_numeric: 0.05 }));
  const { target, c } = mountAccordion(q());
  setVal(numInput(target), '0.0500');
  expect(c().isDirty).toBe(true);
  expect(anyDirty(target)).toBe('dirty');
  expect(await c().save()).toBe('ok');
  flushSync();
  expect(update).toHaveBeenCalledWith(1, { correct_numeric: 0.05, precision: 0 });
  expect(numInput(target).value).toBe('0.05');            // D10 per-field write-back
  expect(c().isDirty).toBe(false);
  expect(anyDirty(target)).toBe('clean');
});

it('an invalid numeric answer shows its inline error and fails validate()', () => {
  const update = vi.spyOn(qa, 'updateQuestion');
  const { target, c } = mountAccordion(q());
  setVal(numInput(target), '1.5e-20');
  expect(target.querySelector('[role="alert"]')).not.toBeNull();
  expect(c().validate()).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

it('a precision outside 0–10 fails validate() and marks the input invalid', () => {
  const { target, c } = mountAccordion(q());
  const prec = target.querySelector('[data-testid="precision-input"]') as HTMLInputElement;
  setVal(prec, '11');
  expect(c().validate()).toBe(false);
  expect(prec.getAttribute('aria-invalid')).toBe('true');
});

it('a text answer is sent trimmed and comes back clean; over 500 characters fails validate()', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(
    q({ type: 'text_answer', correct_text: 'paris', correct_numeric: null, precision: null }));
  const { target, c } = mountAccordion(q({ type: 'text_answer', correct_text: 'answer', correct_numeric: null, precision: null }));
  const txt = target.querySelector('[data-testid="text-answer-input"]') as HTMLInputElement;
  setVal(txt, '  paris  ');
  expect(await c().save()).toBe('ok');
  flushSync();
  expect(update).toHaveBeenCalledWith(1, { correct_text: 'paris' });
  expect(txt.value).toBe('paris');
  expect(c().isDirty).toBe(false);
  setVal(txt, 'x'.repeat(501));   // jsdom does not enforce maxlength on a programmatic value
  expect(c().validate()).toBe(false);
});

it('save() sends only the changed question fields, and the header snippet follows the echo', async () => {
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ text_md: 'New body', text_html: '<p>New body</p>' }));
  const { target, c } = mountAccordion(q());
  setVal(textArea(target), 'New body');
  await c().save();
  flushSync();
  expect(update).toHaveBeenCalledWith(1, { text_md: 'New body' });
  expect(header(target).textContent).toContain('New body');
});

it('discard() reverts every draft to the last-saved baseline', () => {
  const { target, c } = mountAccordion(q({ correct_numeric: 3 }));
  setVal(numInput(target), '9');
  setVal(textArea(target), 'Edited');
  c().discard();
  flushSync();
  expect(numInput(target).value).toBe('3');
  expect(textArea(target).value).toBe('Q');
  expect(c().isDirty).toBe(false);
});

it('there is no per-question Save or Discard: the modal footer sends the drafts (D2)', () => {
  const { target } = mountAccordion(q());
  const labels = [...target.querySelectorAll('button')].map((b) => b.textContent?.trim());
  expect(labels).not.toContain('Save');
  expect(labels).not.toContain('Discard');
});

it('an archived version: fields are read-only', () => {
  const { target } = mountAccordion(q(), { perms: versionPermissions({ state: 'archived', is_disabled: false }) });
  expect(numInput(target).readOnly).toBe(true);
});

it("a dirty question disables its own delete and reorder (two-way lock; T5b removes it)", () => {
  const { target } = mountAccordion(q());
  setVal(numInput(target), '7');
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
});

it('the accordion-wide `locked` prop disables structural controls even when clean', () => {
  const { target, props } = mountAccordion(q());
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(false);
  props.locked = true;
  flushSync();
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
});

it('drafts survive body collapse (they live on the always-mounted accordion)', () => {
  const { target, props, c } = mountAccordion(q());
  setVal(numInput(target), '7');
  props.expanded = false;
  flushSync();
  expect(numInput(target)).toBeNull();
  expect(anyDirty(target)).toBe('dirty');
  expect(c().isDirty).toBe(true);
  props.expanded = true;
  flushSync();
  expect(numInput(target).value).toBe('7');
});

it('a save() response that resolves after a route (vid) change is discarded (§4.1a)', async () => {
  let resolveSave!: (updated: AuthoringQuestion) => void;
  vi.spyOn(qa, 'updateQuestion').mockReturnValue(new Promise((r) => { resolveSave = r; }));
  const { target, props, c } = mountAccordion(q({ correct_numeric: 3 }));
  setVal(numInput(target), '0.05');
  const pending = c().save();
  props.vid = 11;                                   // the route moved to another version mid-save
  flushSync();
  resolveSave(q({ correct_numeric: 0.05 }));
  expect(await pending).toBe('failed');
  flushSync();
  expect(anyDirty(target)).toBe('dirty');           // baseline NOT advanced
  expect(numInput(target).value).toBe('0.05');
});

// ---- Option loading ----

it('a choice question loads its own options on mount, sorted by order', async () => {
  const list = vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 2, order: 2, text: 'Second' }), opt({ id: 1, order: 1, text: 'First' }),
  ]);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  expect(list).toHaveBeenCalledWith(1);
  expect(optInputs(target).map((i) => i.value)).toEqual(['First', 'Second']);
});

it('numeric/text questions never fetch options', async () => {
  const list = vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  mountAccordion(q());
  await loaded();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  mountAccordion(q({ type: 'text_answer', correct_numeric: null, precision: null, correct_text: 'paris' }));
  await loaded();
  expect(list).not.toHaveBeenCalled();
});

it('an option-load failure shows an inline error and Retry; Retry re-fetches', async () => {
  vi.spyOn(qa, 'listOptions')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce([opt({ id: 5, text: 'Recovered' })]);
  const { target } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await loaded();
  expect(target.querySelector('[data-testid="option-load-error"]')).not.toBeNull();
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry')!.click();
  await loaded();
  expect(optInputs(target)[0].value).toBe('Recovered');
});

it('the header counts the draft-correct options', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await loaded();
  expect(target.querySelector('[data-testid="correct-count"]')?.textContent).toContain('1');
  boxes(target)[1].click();
  flushSync();
  expect(target.querySelector('[data-testid="correct-count"]')?.textContent).toContain('2');
});

it('a late option-load response after unmount is discarded (§4.1a onDestroy token bump)', async () => {
  let resolveList!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions').mockReturnValue(new Promise((r) => { resolveList = r; }));
  mountAccordion(choiceQ());
  await tick(); flushSync();
  cleanup?.(); cleanup = null;
  let orderReads = 0;
  const trap = () => ({ id: 9, question_id: 1, text: 'Late', is_correct: false,
    get order() { orderReads++; return 1; } } as unknown as AuthoringOption);
  resolveList([trap(), trap()]);
  await loaded();
  expect(orderReads).toBe(0);
});

// ---- Option structure (immediate) ----

it('inline add: trims, blocks whitespace-only, posts {text, is_correct}', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);   // empty → the first single-choice option is correct (§8.4)
  const create = vi.spyOn(qa, 'createOption').mockResolvedValue(opt({ id: 3, text: 'Madrid', is_correct: true, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  const input = target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement;
  setVal(input, '   ');
  expect(addBtn(target).disabled).toBe(true);
  setVal(input, '  Madrid  ');
  addBtn(target).click();
  await loaded();
  expect(create).toHaveBeenCalledWith(1, { text: 'Madrid', is_correct: true });
});

it('deleting the only correct option is blocked client-side (C2)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const del = vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const delBtn0 = target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement;
  expect(delBtn0.disabled).toBe(true);
  delBtn0.click();
  await loaded();
  expect(del).not.toHaveBeenCalled();
});

it('delete removes a non-last-correct option', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const del = vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  await loaded();
  expect(del).toHaveBeenCalledWith(2);
  expect(target.querySelectorAll('[data-testid="option-row"]')).toHaveLength(1);
});

it('an option-text draft is dirty; save() PATCHes {text} and the echo makes it clean', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const upd = vi.spyOn(qa, 'updateOption').mockResolvedValue(opt({ id: 1, text: 'Alpha', is_correct: true, order: 1 }));
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[0], 'Alpha ');
  expect(anyDirty(target)).toBe('dirty');
  expect(await c().save()).toBe('ok');
  flushSync();
  expect(upd).toHaveBeenCalledWith(1, { text: 'Alpha ' });
  expect(optInputs(target)[0].value).toBe('Alpha');   // the server's normalised echo is written back
  expect(anyDirty(target)).toBe('clean');
});

it('blurring an option input sends nothing (the blur commit is gone)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const upd = vi.spyOn(qa, 'updateOption');
  const { target } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[0], 'Alpha');
  optInputs(target)[0].dispatchEvent(new Event('blur'));
  await loaded();
  expect(upd).not.toHaveBeenCalled();
  expect(anyDirty(target)).toBe('dirty');
});

it('an option-text draft survives collapsing the question (§7.1)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target, props } = mountAccordion(choiceQ());
  await loaded();
  setVal(optInputs(target)[0], 'Edited');
  props.expanded = false;
  flushSync();
  expect(target.querySelector('[data-testid="option-row"]')).toBeNull();
  expect(anyDirty(target)).toBe('dirty');
});

it('locked(): an option mutation or a question-editor upload in flight blocks Save (D10)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  let resolveDel!: () => void;
  vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise((r) => { resolveDel = r as () => void; }));
  const ctx = stubAssetCtx() as unknown as { upload: ReturnType<typeof vi.fn> };
  let rejectUp!: (e: unknown) => void;
  ctx.upload.mockImplementation(() => new Promise((_, rej) => { rejectUp = rej; }));
  const { target, c } = mountAccordion(choiceQ(), { assetContext: ctx });
  await loaded();
  expect(c().locked()).toBe(false);
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  flushSync();
  expect(c().locked()).toBe(true);
  resolveDel();
  await loaded();
  expect(c().locked()).toBe(false);
  // jsdom ships no DataTransfer/DragEvent: a plain drop event carrying files.
  const dropInto = (ta: HTMLTextAreaElement) => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
    ta.dispatchEvent(drop);
    flushSync();
  };
  const explanation = [...target.querySelectorAll('textarea')].find((t) => !t.closest('[data-field="text"]'))!;
  for (const ta of [textArea(target), explanation]) {
    dropInto(ta);
    expect(c().locked()).toBe(true);
    rejectUp({ name: 'AbortError' });
    await loaded();
    expect(c().locked()).toBe(false);
  }
});

it('option mutations are serialized; text stays editable while one is in flight', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  let resolveDel!: () => void;
  const del = vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise((r) => { resolveDel = r as () => void; }));
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();   // delete pending
  flushSync();
  // Drafts are local now (D3), so typing during an option mutation is harmless:
  expect(optInputs(target)[0].readOnly).toBe(false);
  expect(textArea(target).disabled).toBe(false);
  expect(textArea(target).readOnly).toBe(false);
  // The clicked button stays enabled (no blur); the handler guard blocks re-entry.
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  flushSync();
  expect(del).toHaveBeenCalledTimes(1);
  resolveDel();
  await loaded();
});

it('resyncOptions discards a re-fetch that resolves after a vid change (§4.1a)', async () => {
  let resolveResync!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce(AB())
    .mockReturnValueOnce(new Promise((r) => { resolveResync = r; }));
  vi.spyOn(qa, 'reorderOptions').mockRejectedValue(new Error('boom'));
  const { target, props } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await loaded();
  props.vid = 11;
  flushSync();
  let orderReads = 0;
  const trap = () => ({ id: 99, question_id: 1, text: 'STALE', is_correct: false, get order() { orderReads++; return 1; } } as unknown as AuthoringOption);
  resolveResync([trap(), trap()]);
  await loaded();
  expect(orderReads).toBe(0);
});

it('a dirty question disables add-option (two-way lock; T5b removes it)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  setVal(textArea(target), 'Edited question body');
  expect(addOptionBtn(target).disabled).toBe(true);
});

// ---- Correct marks are drafts (D25, §5.2) ----

it('single choice: picking a radio is a draft (no PATCH); save() sends true before false', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const upd = echoOption();
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[1].click();
  flushSync();
  expect(upd).not.toHaveBeenCalled();
  expect(c().isDirty).toBe(true);
  expect(c().keyChanged()).toBe(true);
  expect(radios(target).map((r) => r.checked)).toEqual([false, true]);
  expect(await c().save()).toBe('ok');
  expect(upd.mock.calls).toEqual([[2, { is_correct: true }], [1, { is_correct: false }]]);
  flushSync();
  expect(c().isDirty).toBe(false);
});

it('picking the already-correct radio leaves the question clean', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[0].click();
  flushSync();
  expect(c().isDirty).toBe(false);
});

it('single choice two-correct repair: picking one drafts the other false; save() sends only that', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }), opt({ id: 2, text: 'B', is_correct: true, order: 2 }),
  ]);
  const upd = echoOption();
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  // A browser unchecks the earlier radio when the later checked one is
  // connected (HTML radio-group rule), so only B shows checked; jsdom leaves
  // both checked and a click on A would fire no change. Mirror the browser.
  radios(target)[0].checked = false;
  radios(target)[0].click();
  flushSync();
  await c().save();
  expect(upd.mock.calls).toEqual([[2, { is_correct: false }]]);
});

it('multiple choice: unchecking the last correct fails validate() with the Options error; nothing is sent', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'C', is_correct: true, order: 1 })]);
  const upd = vi.spyOn(qa, 'updateOption');
  const { target, c } = mountAccordion(choiceQ({ type: 'multiple_choice' }));
  await loaded();
  boxes(target)[0].click();
  flushSync();
  expect(boxes(target)[0].checked).toBe(false);
  expect(c().validate()).toBe(false);
  flushSync();
  expect(target.querySelector('[data-testid="mark-error"]')!.textContent).toBe('Mark at least one correct option');
  expect(upd).not.toHaveBeenCalled();
});

it('a split single-choice save (true sent, false failed) keeps it dirty with the "Saved partly" note and one correct row', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'updateOption')
    .mockResolvedValueOnce(opt({ id: 2, text: 'B', is_correct: true, order: 2 }))
    .mockRejectedValueOnce(new ApiError(500, 'Server down'));
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[1].click();
  flushSync();
  expect(await c().save()).toBe('partial');                  // B:true landed (D10: the modal reloads)
  flushSync();
  expect(c().lastError).toBe('Server down');
  expect(target.querySelector('[data-testid="save-error"]')!.textContent).toBe('Server down');
  expect(target.querySelector('[data-testid="save-note"]')!.textContent)
    .toBe('Saved partly — save again to finish the answer key.');
  expect(c().isDirty).toBe(true);
  expect(target.querySelectorAll('[data-testid="option-correct"]')).toHaveLength(1);   // D25
  expect(radios(target)[1].checked).toBe(true);
});

it('a failed question PATCH stops before the options and keeps everything dirty', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'updateQuestion').mockRejectedValue(new ApiError(422, 'Nope'));
  const upd = vi.spyOn(qa, 'updateOption');
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  setVal(textArea(target), 'Edited');
  radios(target)[1].click();
  flushSync();
  expect(await c().save()).toBe('failed');
  expect(upd).not.toHaveBeenCalled();
  expect(c().lastError).toBe('Nope');
  expect(c().isDirty).toBe(true);
  expect(refresh).not.toHaveBeenCalled();                   // a 422 does not re-gate
});

it('a 409 on save() re-gates via loadAdminTree({force})', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'updateQuestion').mockRejectedValue(new ApiError(409, 'Conflict'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, c } = mountAccordion(q());
  setVal(numInput(target), '9');
  expect(await c().save()).toBe('failed');
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
});

it('a 409 on an option mutation re-gates via loadAdminTree({force}) and shows an inline error (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: false, order: 1 })]);
  vi.spyOn(qa, 'createOption').mockRejectedValue(new ApiError(409, "Can only add options in 'created' state"));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'X');
  addBtn(target).click();
  await loaded(); await loaded();
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.querySelector('[data-testid="option-mut-error"]')).not.toBeNull();
});

it('a 400 on an option mutation does NOT re-gate (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'reorderOptions').mockRejectedValue(new ApiError(400, 'Bad request'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await loaded(); await loaded();
  expect(refresh).not.toHaveBeenCalled();
});

it('keyChanged(): an answer change counts, a text-only change does not (D20)', () => {
  const { target, c } = mountAccordion(q());
  setVal(textArea(target), 'New body');
  expect(c().isDirty).toBe(true);
  expect(c().keyChanged()).toBe(false);
  setVal(numInput(target), '9');
  expect(c().keyChanged()).toBe(true);
});

it('§8.8: a published question shows the type dead-end note; created does not', () => {
  const pub = mountAccordion(q(), { perms: versionPermissions({ state: 'published', is_disabled: false }) });
  expect(pub.target.querySelector('[data-testid="published-type-note"]')).not.toBeNull();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const cre = mountAccordion(q());
  expect(cre.target.querySelector('[data-testid="published-type-note"]')).toBeNull();
});

it('published: structure hidden, marks and option text editable, no structural calls', async () => {
  const PUB = versionPermissions({ state: 'published', is_disabled: false });
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const create = vi.spyOn(qa, 'createOption');
  const { target } = mountAccordion(choiceQ(), { perms: PUB });
  await loaded();
  expect(addOptionBtn(target)).toBeNull();
  expect(target.querySelector('button[aria-label="Delete option"]')).toBeNull();
  expect(radios(target)[0].disabled).toBe(false);
  expect(optInputs(target)[0].readOnly).toBe(false);
  expect(create).not.toHaveBeenCalled();
});

it('archived: the option area is fully read-only', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const { target } = mountAccordion(choiceQ(), { perms: versionPermissions({ state: 'archived', is_disabled: false }) });
  await loaded();
  expect(optInputs(target)[0].readOnly).toBe(true);
  expect(radios(target)[0].disabled).toBe(true);
  expect(target.querySelector('button[aria-label="Delete option"]')).toBeNull();
});

// ---- a11y and focus ----

it('single_choice options form a labelled radiogroup (fieldset + legend)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const fs = target.querySelector('fieldset[data-testid="option-group"]');
  expect(fs?.querySelector('legend')).not.toBeNull();
  expect(fs?.querySelectorAll('input[type="radio"]')).toHaveLength(2);
});

it('reordering an option announces via the aria-live region', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  vi.spyOn(qa, 'reorderOptions').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const live = target.querySelector('[data-testid="option-live"]') as HTMLElement;
  expect(live.getAttribute('aria-live')).toBe('polite');
  (target.querySelectorAll('[data-testid="option-row"]')[0].querySelector('button[aria-label="Move option down"]') as HTMLButtonElement).click();
  await loaded();
  expect(live.textContent).toMatch(/position 2 of 2/i);
});

it('expanding a question moves focus into the body', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, is_correct: true, order: 1 })]);
  const { target, props } = mountAccordion(choiceQ(), { expanded: false });
  await loaded();
  props.expanded = true;
  await loaded();
  expect(target.querySelector('.body')?.contains(document.activeElement)).toBe(true);
});

it('adding an option focuses the new option input', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  vi.spyOn(qa, 'createOption').mockResolvedValue(opt({ id: 3, text: 'Madrid', is_correct: true, order: 1 }));
  const { target } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'Madrid');
  addBtn(target).click();
  await loaded(); await loaded();
  expect(document.activeElement).toBe(optInputs(target).at(-1));
});

it('delete-option focuses the surviving sibling at the same position', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    opt({ id: 1, text: 'A', is_correct: true, order: 1 }),
    opt({ id: 2, text: 'B', is_correct: false, order: 2 }),
    opt({ id: 3, text: 'C', is_correct: false, order: 3 }),
  ]);
  vi.spyOn(qa, 'deleteOption').mockResolvedValue(undefined as never);
  const { target } = mountAccordion(choiceQ());
  await loaded();
  (target.querySelectorAll('[data-testid="option-row"]')[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  await loaded(); await loaded();
  expect((document.activeElement as HTMLElement).getAttribute('data-option-id')).toBe('3');
});

it('save() leaves focus where it was (D10: the caret is never moved by a Save)', async () => {
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ text_md: 'New body', text_html: '<p>New body</p>' }));
  const { target, c } = mountAccordion(q());
  textArea(target).focus();
  setVal(textArea(target), 'New body');
  await c().save();
  await loaded();
  expect(document.activeElement).toBe(textArea(target));
});

it('a 409 whose resync resolves after a vid change does NOT re-gate (§4.1a second guard)', async () => {
  const { ApiError } = await import('../lib/api');
  let resolveResync!: (v: AuthoringOption[]) => void;
  vi.spyOn(qa, 'listOptions')
    .mockResolvedValueOnce([opt({ id: 1, text: 'A', is_correct: false, order: 1 })])
    .mockReturnValueOnce(new Promise((r) => { resolveResync = r; }));
  vi.spyOn(qa, 'createOption').mockRejectedValue(new ApiError(409, "Can only add in 'created' state"));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountAccordion(choiceQ());
  await loaded();
  addOptionBtn(target).click();
  flushSync();
  setVal(target.querySelector('[data-testid="new-option-text"]') as HTMLInputElement, 'X');
  addBtn(target).click();
  await loaded();
  props.vid = 11;
  flushSync();
  resolveResync([opt({ id: 1, text: 'A', is_correct: false, order: 1 })]);
  await loaded();
  expect(refresh).not.toHaveBeenCalled();
});

it('frozen: inputs readonly with focus kept, marks and structure disabled; a click on a mark changes nothing', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target, props, c } = mountAccordion(choiceQ());
  await loaded();
  textArea(target).focus();
  props.frozen = true;
  flushSync();
  expect(textArea(target).readOnly).toBe(true);
  expect(document.activeElement).toBe(textArea(target));
  expect(optInputs(target)[0].readOnly).toBe(true);
  expect(radios(target).every((r) => r.disabled)).toBe(true);
  radios(target)[1].click();                      // a disabled input ignores click()
  flushSync();
  expect(c().isDirty).toBe(false);
  expect(radios(target)[0].checked).toBe(true);
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
  expect(addOptionBtn(target).disabled).toBe(true);
});

it('drafting a mark does not re-create the inputs (no blink)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  const [beforeA, beforeB] = radios(target);
  radios(target)[1].click();
  flushSync();
  expect(radios(target)[0]).toBe(beforeA);
  expect(radios(target)[1]).toBe(beforeB);
});

it('the correct-row look follows the draft mark (D25)', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const { target } = mountAccordion(choiceQ());
  await loaded();
  radios(target)[1].click();
  flushSync();
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  expect(rows.map((r) => r.classList.contains('correct'))).toEqual([false, true]);
  expect(rows[1].querySelector('[data-testid="option-correct"]')).not.toBeNull();
});

it('a choice question with 1 option shows few-options-warn; with 2 options it does not', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([opt({ id: 1, text: 'A', is_correct: true, order: 1 })]);
  const one = mountAccordion(choiceQ());
  await loaded();
  expect(one.target.querySelector('[data-testid="few-options-warn"]')).not.toBeNull();
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  vi.spyOn(qa, 'listOptions').mockResolvedValue(AB());
  const two = mountAccordion(choiceQ());
  await loaded();
  expect(two.target.querySelector('[data-testid="few-options-warn"]')).toBeNull();
});

// ---- validate() / focusFirstInvalid() (D10) ----

it('validate() is dirty-scoped: a clean choice question with no options passes', async () => {
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  const { target, c } = mountAccordion(choiceQ());
  await loaded();
  expect(c().validate()).toBe(true);
  flushSync();
  expect(target.querySelector('[data-testid="needs-fixing"]')).toBeNull();
});

it('an invalid dirty question shows "needs fixing" with aria-invalid on its header; it clears once fixed', () => {
  const { target, c } = mountAccordion(q({ type: 'text_answer', correct_text: 'a', correct_numeric: null, precision: null }));
  const txt = target.querySelector('[data-testid="text-answer-input"]') as HTMLInputElement;
  setVal(txt, '');
  expect(c().validate()).toBe(false);
  flushSync();
  expect(header(target).getAttribute('aria-invalid')).toBe('true');
  expect(header(target).querySelector('[data-testid="needs-fixing"]')!.textContent).toBe('needs fixing');
  setVal(txt, 'b');
  expect(header(target).querySelector('[data-testid="needs-fixing"]')).toBeNull();
  expect(header(target).hasAttribute('aria-invalid')).toBe(false);
});

it('an emptied question text fails with "Question text is required"; focusFirstInvalid() focuses that editor', () => {
  const { target, c } = mountAccordion(q());
  setVal(textArea(target), '   ');
  expect(c().validate()).toBe(false);
  flushSync();
  expect(target.querySelector('[data-testid="text-error"]')!.textContent).toBe('Question text is required');
  c().focusFirstInvalid();
  expect(document.activeElement).toBe(textArea(target));
});

it('focusFirstInvalid() on a collapsed question focuses the invalid field once it expands', async () => {
  const { target, props, c } = mountAccordion(q());
  setVal(numInput(target), 'abc');
  props.expanded = false;
  flushSync();
  expect(c().validate()).toBe(false);
  c().focusFirstInvalid();
  props.expanded = true;
  await loaded();
  expect(document.activeElement).toBe(numInput(target));
});
