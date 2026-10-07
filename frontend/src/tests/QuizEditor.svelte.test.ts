import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import QuizEditor from '../components/editor/QuizEditor.svelte';
import * as qa from '../lib/quizAuthoring';
import * as itemBody from '../lib/itemBody';
import * as store from '../stores/currentEditorVersion.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { AuthoringQuestion } from '../lib/quizAuthoring';
import type { SaveOutcome } from '../lib/itemBody';
import { versionPermissions } from '../lib/versionPermissions';

const VERSION = { id: 10, course_id: 1, state: 'created', is_disabled: false, info_md: '',
  info_html: '', max_quiz_attempts: 3, label: '', created_at: '', published_at: null, archived_at: null,
  content_updated_at: '' } as const;
const PUB = { ...VERSION, state: 'published' as const };

const stubAssetCtx = () => ({
  kind: 'course', list: vi.fn().mockResolvedValue([]), upload: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined), imgSrc: () => '', renderPreview: vi.fn().mockResolvedValue({ html: '' }),
}) as never;

const q = (over: Partial<AuthoringQuestion> = {}): AuthoringQuestion => {
  const base: AuthoringQuestion = {
    id: 1, item_id: 4, text_md: 'Question one', text_html: '<p>Question one</p>',
    type: 'numeric_answer', order: 1, explanation_md: null, explanation_html: null,
    correct_numeric: 3, precision: 0, correct_text: null, ...over,
  };
  // The header snippet reads stripped text_html; keep it in sync with text_md
  // unless a test pins text_html explicitly.
  return over.text_html !== undefined ? base : { ...base, text_html: `<p>${base.text_md}</p>` };
};

type BodyApi = {
  save(t: string | undefined): Promise<SaveOutcome>;
  validate(): boolean; discard(): void; discardAll(): void;
};

let cleanup: (() => void) | null = null;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; clearToasts(); vi.restoreAllMocks(); });

function mountEditor(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
    itemId: 4, vid: 10, version: VERSION, perms: versionPermissions(VERSION), assetContext: stubAssetCtx(),
    stillOnVid: () => true, versionDisabled: false, frozen: false,
    saveDirty: false, guardDirty: false, busy: false, ...over,
  });
  const cmp = mount(QuizEditor, { target, props }) as unknown as BodyApi;
  cleanup = () => unmount(cmp as never);
  return { target, props, cmp };
}
const loaded = async () => { await tick(); await tick(); await tick(); flushSync(); };

// ---- helpers (robust to markup; the data-testids and aria are the contract) ----
function clickByText(target: HTMLElement, text: string) {
  ([...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement).click();
}
function openAddForm(target: HTMLElement) {
  (target.querySelector('button[aria-label="Add question"]') as HTMLButtonElement).click();
  flushSync();
}
function setInput(target: HTMLElement, testid: string, value: string) {
  const el = target.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement;
  el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
}
function setVal(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
}
function selectType(target: HTMLElement, type: string) {
  (target.querySelector(`input[name="question-type"][value="${type}"]`) as HTMLInputElement).click();
  flushSync();
}
const toggles = (t: HTMLElement) =>
  [...t.querySelectorAll('[data-testid="question-header"] button[aria-expanded]')] as HTMLButtonElement[];
async function expandQ(t: HTMLElement, qid: number) {
  const btn = t.querySelector(`[data-q-id="${qid}"] [data-testid="question-header"] button[aria-expanded]`) as HTMLButtonElement;
  if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
  await loaded();
}
const inQ = <T extends Element>(t: HTMLElement, qid: number, sel: string) => t.querySelector(`[data-q-id="${qid}"] ${sel}`) as T;
const toastTexts = () => toasts.list.map((x) => x.message);

it('loads questions on mount and lists them in order', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 2, order: 2, text_md: 'Second' }), q({ id: 1, order: 1, text_md: 'First' })]);
  const { target } = mountEditor();
  await loaded();
  const headers = [...target.querySelectorAll('[data-testid="question-header"]')];
  expect(headers).toHaveLength(2);
  expect(headers[0].textContent).toContain('First');
  expect(headers[1].textContent).toContain('Second');
});

it('shows the empty-state when there are no questions', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const { target } = mountEditor();
  await loaded();
  expect(target.textContent).toContain('No questions yet');
});

it('adds a numeric question with a VALIDATED answer, appends it, force-refreshes', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(q({ id: 5, type: 'numeric_answer', text_md: 'Added', order: 1 }));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'numeric_answer');
  setInput(target, 'new-question-text', 'Added');
  setInput(target, 'new-numeric', '5');
  setInput(target, 'new-precision', '0');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenCalledWith(4, { text_md: 'Added', type: 'numeric_answer', correct_numeric: 5, precision: 0 });
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.textContent).toContain('Added');
});

it('blocks Add for a numeric question with an invalid answer (§8.3)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion').mockResolvedValue(q());
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'numeric_answer');
  setInput(target, 'new-question-text', 'Bad');
  setInput(target, 'new-numeric', '1.5e-20');
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
  await loaded();
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'Cap?');
  setInput(target, 'new-text-answer', 'Paris');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenCalledWith(4, { text_md: 'Cap?', type: 'text_answer', correct_text: 'Paris' });
});

it('creates single_choice and multiple_choice with NO correctness fields', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  const create = vi.spyOn(qa, 'createQuestion')
    .mockResolvedValueOnce(q({ id: 7, type: 'single_choice', text_md: 'Pick one', correct_numeric: null, precision: null }))
    .mockResolvedValueOnce(q({ id: 8, type: 'multiple_choice', text_md: 'Pick many', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'single_choice');
  setInput(target, 'new-question-text', 'Pick one');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenLastCalledWith(4, { text_md: 'Pick one', type: 'single_choice' });
  openAddForm(target);
  selectType(target, 'multiple_choice');
  setInput(target, 'new-question-text', 'Pick many');
  clickByText(target, 'Add');
  await loaded();
  expect(create).toHaveBeenLastCalledWith(4, { text_md: 'Pick many', type: 'multiple_choice' });
});

it('reorder ↑ swaps order and POSTs the full id-set', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  const reorder = vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined);
  const { target } = mountEditor();
  await loaded();
  ([...target.querySelectorAll('button[aria-label="Move up"]')] as HTMLButtonElement[])[1].click();
  await loaded();
  expect(reorder).toHaveBeenCalledWith(4, [{ id: 2, order: 1 }, { id: 1, order: 2 }]);
});

it('deletes a question after confirm and force-refreshes', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' })]);
  const del = vi.spyOn(qa, 'deleteQuestion').mockResolvedValue();
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target } = mountEditor();
  await loaded();
  (target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).click();
  await loaded();
  expect(del).toHaveBeenCalledWith(1);
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
  expect(target.querySelector('[data-testid="question-header"]')).toBeNull();
});

it("disables a row's structural controls while an add is in flight; busy follows (§7.2, D10)", async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' })]);
  let resolveCreate!: (created: AuthoringQuestion) => void;
  vi.spyOn(qa, 'createQuestion').mockReturnValue(new Promise((r) => { resolveCreate = r; }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountEditor();
  await loaded();
  expect(props.busy).toBe(false);
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'Q');
  setInput(target, 'new-text-answer', 'a');
  clickByText(target, 'Add');
  flushSync();
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
  expect(props.busy).toBe(true);                    // the modal's Save is disabled meanwhile
  resolveCreate(q({ id: 2, type: 'text_answer', correct_numeric: null, precision: null, correct_text: 'a' }));
  await loaded();
  expect(props.busy).toBe(false);
});

it('busy follows an option mutation inside a question (D10)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    { id: 1, question_id: 1, text: 'A', is_correct: true, order: 1 },
    { id: 2, question_id: 1, text: 'B', is_correct: false, order: 2 },
  ]);
  let resolveDel!: () => void;
  vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise((r) => { resolveDel = r as () => void; }));
  const { target, props } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  await loaded();
  expect(props.busy).toBe(false);
  const rows = [...target.querySelectorAll('[data-testid="option-row"]')];
  (rows[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  flushSync();
  expect(props.busy).toBe(true);
  resolveDel();
  await loaded();
  expect(props.busy).toBe(false);
});

it('a question draft sets saveDirty and guardDirty; discard() clears them and restores the value', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  const { target, props, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  expect(props.saveDirty).toBe(true);
  expect(props.guardDirty).toBe(true);
  cmp.discard();
  flushSync();
  expect(props.saveDirty).toBe(false);
  expect(props.guardDirty).toBe(false);
  expect(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]').value).toBe('3');
});

it('shows an error then re-loads on Retry (loadToken increments per load)', async () => {
  const list = vi.spyOn(qa, 'listQuestions')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce([q({ id: 3, text_md: 'Recovered' })]);
  const { target } = mountEditor();
  await loaded();
  expect(target.querySelector('[role="alert"]')?.textContent).toContain('Could not load questions');
  clickByText(target, 'Retry');
  await loaded();
  expect(target.textContent).toContain('Recovered');
  expect(list).toHaveBeenCalledTimes(2);
});

it('a disabled version shows the whole-editor read-only notice', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const DIS = { ...VERSION, is_disabled: true };
  const { target } = mountEditor({ version: DIS, perms: versionPermissions(DIS), versionDisabled: true });
  await loaded();
  expect(target.querySelector('[data-testid="quiz-readonly"]')).not.toBeNull();
});

// ---- D20: one published answer-key confirm per Save ----

it('D20: a published answer-key change confirms once per Save, before anything is sent; Cancel sends nothing', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1 }), q({ id: 2, order: 2, text_md: 'Two' })]);
  const update = vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number) => Promise.resolve(q({ id: qid, correct_numeric: 9 })));
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { target, cmp } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  await expandQ(target, 2);
  setVal(inQ<HTMLInputElement>(target, 2, '[data-testid="numeric-input"]'), '9');
  expect(await cmp.save(undefined)).toEqual({ outcome: 'failed' });
  expect(confirmSpy).toHaveBeenCalledOnce();
  expect(confirmSpy.mock.calls[0][0]).toMatch(/^This quiz is published\. Changing the answer key does not re-score/);
  expect(update).not.toHaveBeenCalled();
  confirmSpy.mockReturnValue(true);
  expect((await cmp.save(undefined)).outcome).toBe('ok');
  expect(confirmSpy).toHaveBeenCalledTimes(2);                   // once per Save, never per question
  expect(update).toHaveBeenCalledTimes(2);
});

it('D20: a published text-only change never confirms', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  const update = vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ id: 1, text_md: 'New body' }));
  const confirmSpy = vi.spyOn(window, 'confirm');
  const { target, cmp } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'New body');
  await cmp.save(undefined);
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith(1, { text_md: 'New body' });
});

it('D20: created versions never confirm', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  vi.spyOn(qa, 'updateQuestion').mockResolvedValue(q({ id: 1, correct_numeric: 9 }));
  const confirmSpy = vi.spyOn(window, 'confirm');
  const { target, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  await cmp.save(undefined);
  expect(confirmSpy).not.toHaveBeenCalled();
});

// ---- One Save across N PATCHes (D10, §5.3) ----

it('save(): the title first, then dirty questions in display order; clean questions send nothing', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' }), q({ id: 3, order: 3, text_md: 'C' }),
  ]);
  const log: string[] = [];
  vi.spyOn(itemBody, 'patchItem').mockImplementation((id: number, body: Record<string, unknown>) => {
    log.push(`item ${id}`);
    return Promise.resolve({ id, title: String(body.title), content_md: null, video_url: null, script_url: null });
  });
  vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number, body: { text_md?: string }) => {
    log.push(`question ${qid}`);
    return Promise.resolve(q({ id: qid, order: qid, text_md: body.text_md ?? '' }));
  });
  const { target, props, cmp } = mountEditor();
  await loaded();
  // Edit Q3 first, then Q1: the edit order must not matter, the display order does.
  await expandQ(target, 3);
  setVal(inQ<HTMLTextAreaElement>(target, 3, '[data-field="text"] textarea'), 'C2');
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  expect(await cmp.save('Quiz 2')).toEqual({ outcome: 'ok', savedTitle: 'Quiz 2' });
  expect(log).toEqual(['item 4', 'question 1', 'question 3']);
  flushSync();
  expect(props.saveDirty).toBe(false);
});

it('save(): a failing question stops the run — partial outcome, later questions stay dirty, the toast names it, it expands', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' }), q({ id: 3, order: 3, text_md: 'C' }),
  ]);
  vi.spyOn(itemBody, 'patchItem').mockResolvedValue({ id: 4, title: 'Quiz 2', content_md: null, video_url: null, script_url: null });
  const update = vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number, body: { text_md?: string }) =>
    qid === 2 ? Promise.reject(new ApiError(422, 'Too long')) : Promise.resolve(q({ id: qid, order: qid, text_md: body.text_md ?? '' })));
  const { target, props, cmp } = mountEditor();
  await loaded();
  for (const id of [1, 2, 3]) {
    await expandQ(target, id);
    setVal(inQ<HTMLTextAreaElement>(target, id, '[data-field="text"] textarea'), `edit ${id}`);
  }
  await expandQ(target, 1);                          // leave Q1 open: the failure must move it to Q2
  const res = await cmp.save('Quiz 2');
  expect(res).toEqual({ outcome: 'partial', savedTitle: 'Quiz 2' });
  expect(update.mock.calls.map((c) => c[0])).toEqual([1, 2]);     // Q3 never sent
  expect(toastTexts()).toContain('Question 2: Too long — Save again to send the rest.');
  await loaded();
  expect(props.saveDirty).toBe(true);
  expect(inQ<HTMLButtonElement>(target, 2, '[data-testid="question-header"] button[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
});

it('save(): a 422 on the title toasts it, sends nothing else and does not reload', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(itemBody, 'patchItem').mockRejectedValue(new ApiError(422, 'Title too long'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { cmp } = mountEditor();
  await loaded();
  expect(await cmp.save('x'.repeat(300))).toEqual({ outcome: 'failed' });
  expect(toastTexts()).toContain('Title too long');
  expect(refresh).not.toHaveBeenCalled();
});

it('save(): a 409 on the title reloads the tree (§10)', async () => {
  const { ApiError } = await import('../lib/api');
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(itemBody, 'patchItem').mockRejectedValue(new ApiError(409, 'Conflict'));
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { cmp } = mountEditor();
  await loaded();
  await cmp.save('New Title');
  expect(refresh).toHaveBeenCalledWith(10, { force: true });
});

it('validate() is dirty-scoped: a clean choice question with zero options never blocks', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  const { cmp } = mountEditor();
  await loaded();
  expect(cmp.validate()).toBe(true);
});

it('validate(): the first invalid question is expanded, its field focused, its header marked', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1 }), q({ id: 2, order: 2, text_md: 'Two' })]);
  const { target, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 2);
  setVal(inQ<HTMLInputElement>(target, 2, '[data-testid="numeric-input"]'), 'abc');
  toggles(target)[1].click();                       // collapse Q2 again
  await loaded();
  expect(cmp.validate()).toBe(false);
  await loaded();
  expect(inQ<HTMLButtonElement>(target, 2, '[data-testid="question-header"] button[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(inQ(target, 2, '[data-testid="numeric-input"]'));
  expect(inQ(target, 2, '[data-testid="needs-fixing"]')).not.toBeNull();
  expect(inQ(target, 1, '[data-testid="needs-fixing"]')).toBeNull();
});

it('frozen disables add-question and the question structure controls', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 }), q({ id: 2, order: 2 })]);
  const { target, props } = mountEditor();
  await loaded();
  props.frozen = true;
  flushSync();
  expect((target.querySelector('button[aria-label="Add question"]') as HTMLButtonElement).disabled).toBe(true);
  expect((target.querySelector('button[aria-label="Delete question"]') as HTMLButtonElement).disabled).toBe(true);
  expect((target.querySelectorAll('button[aria-label="Move down"]')[0] as HTMLButtonElement).disabled).toBe(true);
});

// ---- §10a a11y and focus ----

it('reordering a question announces via the aria-live region', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined as never);
  const { target } = mountEditor();
  await loaded();
  const live = target.querySelector('[data-testid="question-live"]') as HTMLElement;
  expect(live.getAttribute('aria-live')).toBe('polite');
  (target.querySelector('[data-testid="question-header"] button[aria-label="Move down"]') as HTMLButtonElement).click();
  await loaded();
  expect(live.textContent).toMatch(/position 2 of 2/i);
});

it('adding a question focuses the new question body (first field via the expand effect)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([]);
  vi.spyOn(qa, 'createQuestion').mockResolvedValue(
    q({ id: 42, type: 'single_choice', text_md: 'Pick one', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  selectType(target, 'single_choice');
  setInput(target, 'new-question-text', 'Pick one');
  clickByText(target, 'Add');
  await loaded();
  const active = document.activeElement as HTMLElement | null;
  expect(target.querySelector('[data-q-id="42"] .body')?.contains(active)).toBe(true);
  expect(active?.tagName).toBe('TEXTAREA');
});

it("one question's failed option fetch isolates to its accordion (§6)", async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, type: 'single_choice', text_md: 'Q1', correct_numeric: null, precision: null }),
    q({ id: 2, order: 2, type: 'single_choice', text_md: 'Q2', correct_numeric: null, precision: null }),
  ]);
  const list = vi.spyOn(qa, 'listOptions').mockImplementation((qid: number) =>
    qid === 1 ? Promise.reject(new Error('boom'))
      : Promise.resolve([{ id: 9, question_id: 2, text: 'ok-opt', is_correct: true, order: 1 }]));
  const { target } = mountEditor();
  await loaded();
  expect(list).toHaveBeenCalledWith(1);
  expect(list).toHaveBeenCalledWith(2);
  toggles(target)[0].click();
  await loaded();
  expect(target.querySelectorAll('[data-testid="option-load-error"]')).toHaveLength(1);
});

it('deleting the middle question focuses the surviving sibling\'s toggle', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([
    q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' }), q({ id: 3, order: 3, text_md: 'C' }),
  ]);
  vi.spyOn(qa, 'deleteQuestion').mockResolvedValue();
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target } = mountEditor();
  await loaded();
  ([...target.querySelectorAll('button[aria-label="Delete question"]')] as HTMLButtonElement[])[1].click();
  await loaded(); await loaded();
  const focused = document.activeElement as HTMLElement | null;
  expect(focused?.hasAttribute('aria-expanded')).toBe(true);
  expect(focused?.closest('[data-q-id]')?.getAttribute('data-q-id')).toBe('3');
});

// ---- Structure with live drafts (Slice-5b T5b, §5.4) ----

it('deleting a question confirms with its title, plus the unsaved suffix when it has drafts', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  const del = vi.spyOn(qa, 'deleteQuestion').mockResolvedValue();
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { target } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  inQ<HTMLButtonElement>(target, 1, 'button[aria-label="Delete question"]').click();
  inQ<HTMLButtonElement>(target, 2, 'button[aria-label="Delete question"]').click();
  expect(confirmSpy.mock.calls.map((c) => c[0])).toEqual([
    'Delete question "A"? This cannot be undone. Unsaved edits may be lost.',
    'Delete question "B"? This cannot be undone.',
  ]);
  expect(del).not.toHaveBeenCalled();
});

it('reordering keeps each draft on its question, and save() follows the new display order', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  vi.spyOn(qa, 'reorderQuestions').mockResolvedValue(undefined);
  const log: number[] = [];
  vi.spyOn(qa, 'updateQuestion').mockImplementation((qid: number, body: { text_md?: string }) => {
    log.push(qid);
    return Promise.resolve(q({ id: qid, text_md: body.text_md ?? '' }));
  });
  const { target, cmp } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  await expandQ(target, 2);
  setVal(inQ<HTMLTextAreaElement>(target, 2, '[data-field="text"] textarea'), 'B2');
  inQ<HTMLButtonElement>(target, 2, 'button[aria-label="Move up"]').click();
  await loaded();
  await expandQ(target, 1);
  expect(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea').value).toBe('A2');
  await cmp.save(undefined);
  expect(log).toEqual([2, 1]);
});

it('adding a question keeps the drafts of the others', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 })]);
  vi.spyOn(qa, 'createQuestion').mockResolvedValue(
    q({ id: 5, order: 2, type: 'text_answer', text_md: 'New', correct_text: 'a', correct_numeric: null, precision: null }));
  vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]'), '9');
  openAddForm(target);
  selectType(target, 'text_answer');
  setInput(target, 'new-question-text', 'New');
  setInput(target, 'new-text-answer', 'a');
  clickByText(target, 'Add');
  await loaded();
  expect(props.saveDirty).toBe(true);
  await expandQ(target, 1);
  expect(inQ<HTMLInputElement>(target, 1, '[data-testid="numeric-input"]').value).toBe('9');
});

it('a typed add-question form is guard-dirty, not save-dirty; discard() keeps it, discardAll() collapses it', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const { target, props, cmp } = mountEditor();
  await loaded();
  openAddForm(target);
  expect(props.guardDirty).toBe(false);                   // open but empty
  setInput(target, 'new-question-text', 'Half-typed');
  expect(props.guardDirty).toBe(true);
  expect(props.saveDirty).toBe(false);
  cmp.discard();                                          // the footer Discard: save drafts only
  flushSync();
  expect(target.querySelector('[data-testid="new-question-text"]')).not.toBeNull();
  cmp.discardAll();                                       // a confirmed close
  flushSync();
  expect(target.querySelector('[data-testid="new-question-text"]')).toBeNull();
  expect(props.guardDirty).toBe(false);
});

it('an option structure op in flight makes busy true', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, type: 'single_choice', correct_numeric: null, precision: null })]);
  vi.spyOn(qa, 'listOptions').mockResolvedValue([
    { id: 1, question_id: 1, text: 'A', is_correct: true, order: 1 },
    { id: 2, question_id: 1, text: 'B', is_correct: false, order: 2 },
  ]);
  vi.spyOn(qa, 'deleteOption').mockReturnValue(new Promise(() => {}));
  const { target, props } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  (target.querySelectorAll('[data-testid="option-row"]')[1].querySelector('button[aria-label="Delete option"]') as HTMLButtonElement).click();
  flushSync();
  expect(props.busy).toBe(true);
});

// ---- 3f look (Slice-5b T6, §5.5, D15) ----

it('the Questions heading row shows the mono count; its + toggle opens and closes the add form', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 }), q({ id: 2, order: 2 })]);
  const { target } = mountEditor();
  await loaded();
  const head = target.querySelector('.questions-head') as HTMLElement;
  expect(head.querySelector('.questions-label')!.textContent).toBe('Questions');
  expect(head.querySelector('.q-count')!.textContent).toBe('2');
  const toggle = head.querySelector('button[aria-label="Add question"]') as HTMLButtonElement;
  expect(toggle.dataset.glyph).toBe('plus');
  toggle.click();
  await loaded();
  expect(toggle.dataset.glyph).toBe('close');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect((document.activeElement as HTMLInputElement).name).toBe('question-type');
  setInput(target, 'new-question-text', 'Half');
  toggle.click();
  flushSync();
  expect(target.querySelector('[data-testid="new-question-text"]')).toBeNull();
  toggle.click();
  await loaded();
  expect((target.querySelector('[data-testid="new-question-text"]') as HTMLInputElement).value).toBe('');
});

it('a published version titles every disabled question control with the structure reason (D15)', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1 }), q({ id: 2, order: 2 })]);
  const { target } = mountEditor({ version: PUB, perms: versionPermissions(PUB) });
  await loaded();
  expect(target.querySelector('button[aria-label="Add question"]')).toBeNull();
  const ctl = [...target.querySelectorAll(
    'button[aria-label="Move up"], button[aria-label="Move down"], button[aria-label="Delete question"]')] as HTMLButtonElement[];
  expect(ctl).toHaveLength(6);
  for (const b of ctl) {
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('Only a created version can change its structure');
  }
});

it('the add form offers the lowercase type cards', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const { target } = mountEditor();
  await loaded();
  openAddForm(target);
  expect([...target.querySelectorAll('.qtype-picker label')].map((l) => l.textContent!.trim()))
    .toEqual(['single choice', 'multiple choice', 'numeric answer', 'text answer']);
});

// ---- A failed structure op keeps the list mounted (§5.4: drafts survive) ----

it('a failed reorder resyncs without unmounting: other drafts survive and stay save-dirty', async () => {
  const list = vi.spyOn(qa, 'listQuestions').mockResolvedValue([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })]);
  vi.spyOn(qa, 'reorderQuestions').mockRejectedValue(new Error('network down'));
  const { target, props } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  inQ<HTMLButtonElement>(target, 2, 'button[aria-label="Move up"]').click();
  await loaded();
  await loaded();
  expect(list).toHaveBeenCalledTimes(2);                      // the resync ran
  expect(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea').value).toBe('A2');
  expect(props.saveDirty).toBe(true);
  expect(toasts.list.map((t) => t.message)).toContain('Reorder failed');
});

it('a failed resync keeps the current list and drafts, and says so', async () => {
  vi.spyOn(qa, 'listQuestions')
    .mockResolvedValueOnce([q({ id: 1, order: 1, text_md: 'A' }), q({ id: 2, order: 2, text_md: 'B' })])
    .mockRejectedValueOnce(new Error('still down'));
  vi.spyOn(qa, 'deleteQuestion').mockRejectedValue(new Error('network down'));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { target, props } = mountEditor();
  await loaded();
  await expandQ(target, 1);
  setVal(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea'), 'A2');
  inQ<HTMLButtonElement>(target, 2, 'button[aria-label="Delete question"]').click();
  await loaded();
  await loaded();
  expect(target.querySelectorAll('[data-q-id]')).toHaveLength(2);
  expect(inQ<HTMLTextAreaElement>(target, 1, '[data-field="text"] textarea').value).toBe('A2');
  expect(props.saveDirty).toBe(true);
  expect(toasts.list.map((t) => t.message)).toContain("Couldn't reload the questions — reload the page to see the latest.");
});
