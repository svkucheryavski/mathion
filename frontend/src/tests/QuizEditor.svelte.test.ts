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

const q = (over: Partial<AuthoringQuestion> = {}): AuthoringQuestion => {
  const base: AuthoringQuestion = {
    id: 1, item_id: 4, text_md: 'Question one', text_html: '<p>Question one</p>',
    type: 'numeric_answer', order: 1, explanation_md: null, explanation_html: null,
    correct_numeric: 3, precision: 0, correct_text: null, ...over,
  };
  // The header snippet reads stripped text_html (spec §13). Keep text_html in sync
  // with text_md unless a test pins text_html explicitly, so header-text assertions
  // exercise the real (text_html) code path.
  return over.text_html !== undefined ? base : { ...base, text_html: `<p>${base.text_md}</p>` };
};

let cleanup: (() => void) | null = null;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

function mountEditor(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
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

it("disables a row's structural controls while an add is in flight (questionsLocked, §7.2)", async () => {
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

it('title edit flips quizDirty; Save calls renameItem, force-refreshes, and clears quizDirty', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const rename = vi.spyOn(qa, 'renameItem').mockResolvedValue({ id: 4, title: 'Renamed' });
  const refresh = vi.spyOn(store, 'loadAdminTree').mockResolvedValue('ok');
  const { target, props } = mountEditor();
  await tick(); await tick(); flushSync();
  setInput(target, 'quiz-title', 'Renamed');
  await tick(); flushSync();
  expect(props.quizDirty).toBe(true);
  clickByText(target, 'Save title');
  await tick(); await tick(); flushSync();
  expect(rename).toHaveBeenCalledWith(4, 'Renamed');
  expect(refresh).toHaveBeenCalledWith(10, { force: true });   // force-refresh after rename
  expect(props.quizDirty).toBe(false);                          // baseline advanced from res.title → tracker clean
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

// ---- §9 read-only notice test (T6) ----

it('a disabled version shows the whole-editor read-only notice', async () => {
  vi.spyOn(qa, 'listQuestions').mockResolvedValue([]);
  const DIS = { ...VERSION, is_disabled: true };
  const { target } = mountEditor({ version: DIS, perms: versionPermissions(DIS) });
  await tick(); await tick(); flushSync();
  expect(target.querySelector('[data-testid="quiz-readonly"]')).not.toBeNull();
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
  await tick(); await tick(); await tick(); flushSync();
  // each accordion loaded its own options independently (isolation, §6)
  expect(list).toHaveBeenCalledWith(1);
  expect(list).toHaveBeenCalledWith(2);
  expect(target.querySelectorAll('[data-testid="question-header"]')).toHaveLength(2);
  // expand the failing question → only its option area shows the load error
  ([...target.querySelectorAll('button.expand')] as HTMLButtonElement[])[0].click();
  await tick(); await tick(); flushSync();
  expect(target.querySelectorAll('[data-testid="option-load-error"]')).toHaveLength(1);
});
