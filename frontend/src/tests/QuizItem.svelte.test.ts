import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Spy on `recordQuizAttempt` (a store WRITE we assert the argument of) but let
// it write through; keep the real reactive `currentCourse` + `__test__setSlots`
// so the attempts line reads a genuinely seeded snapshot.
vi.mock('../stores/currentCourse.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentCourse.svelte')>();
  return { ...real, recordQuizAttempt: vi.fn(real.recordQuizAttempt) };
});

import { __test__setSlots, clearCourse, currentCourse, recordQuizAttempt } from '../stores/currentCourse.svelte';
import { session } from '../stores/session.svelte';
import { getDraft, clearAllDrafts, hasUnsavedDrafts } from '../stores/quizDrafts.svelte';
import { api, ApiError } from '../lib/api';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import QuizItem from '../components/items/QuizItem.svelte';
import type {
  ItemStateEntry,
  Question,
  QuizItem as QuizItemType,
  QuizRevealResponse,
  QuizSubmitResponse,
} from '../lib/types';

const MAX = 3;

function question(id: number, order: number): Question {
  return {
    id,
    order,
    type: 'single_choice',
    text_md: '',
    text_html: `<p>Prompt ${id}</p>`,
    options: [
      { id: id * 10 + 1, text: 'First', text_html: 'First' },
      { id: id * 10 + 2, text: 'Second', text_html: 'Second' },
    ],
  };
}

function quiz(id: number, title: string, questionCount: number): QuizItemType {
  return {
    id,
    sequence_id: 100,
    title,
    slug: `quiz-${id}`,
    order: 1,
    type: 'quiz',
    questions: Array.from({ length: questionCount }, (_, k) => question(id * 100 + k + 1, k + 1)),
  };
}

/** One quiz carrying all four question types, in dispatch-chain order. */
function mixedQuiz(id: number): QuizItemType {
  return {
    id,
    sequence_id: 100,
    title: 'Mixed',
    slug: `quiz-${id}`,
    order: 1,
    type: 'quiz',
    questions: [
      { id: 201, order: 1, type: 'single_choice', text_md: '', text_html: '<p>Single</p>',
        options: [{ id: 2011, text: 'First', text_html: 'First' }, { id: 2012, text: 'Second', text_html: 'Second' }] },
      { id: 202, order: 2, type: 'multiple_choice', text_md: '', text_html: '<p>Multi</p>',
        options: [{ id: 2021, text: 'First', text_html: 'First' }, { id: 2022, text: 'Second', text_html: 'Second' }] },
      { id: 203, order: 3, type: 'numeric_answer', text_md: '', text_html: '<p>Numeric</p>' },
      { id: 204, order: 4, type: 'text_answer', text_md: '', text_html: '<p>Text</p>' },
    ],
  };
}

function entry(attemptCount: number): ItemStateEntry {
  return {
    is_covered: false,
    time_spent: 0,
    last_visited_at: null,
    attempt_count: attemptCount,
    max_attempts: MAX,
    last_score: null,
    last_answers: null,
  };
}

/** Seed the course snapshot with per-item attempt counts. */
function seed(attemptsByItemId: Record<number, number>, max = MAX): void {
  __test__setSlots({
    slug: 'algebra',
    versionId: 1,
    course: { id: 1, slug: 'algebra', name: 'Linear Algebra' },
    version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: max },
    blocks: [],
    state: {
      version_id: 1,
      items: Object.fromEntries(
        Object.entries(attemptsByItemId).map(([id, n]) => [id, entry(n)]),
      ),
    },
    miniProjectsByBlockId: {}, teachers: [],
  });
}

function submitResponse(over: Partial<QuizSubmitResponse> = {}): QuizSubmitResponse {
  return {
    item_id: 1,
    attempt_count: 1,
    max_attempts: MAX,
    score_correct: 1,
    score_total: 2,
    can_retry: true,
    ...over,
  };
}

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
let props: { item: QuizItemType };

function render(item: QuizItemType): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const reactiveProps = $state({ item });
  props = reactiveProps;
  component = mount(QuizItem, { target: host, props: reactiveProps });
  flushSync();
  return host;
}

/** Drain microtasks (awaited continuations) and re-flush the reactive graph. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

/** Pick the first option of every question so `allAnswered` turns true. */
function answerAll(): void {
  host.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input, i) => {
    if (i % 2 === 0) input.click();
  });
  flushSync();
}

/** Type a value into a numeric/text field the way the component listens for it. */
function typeInto(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitButton(): HTMLButtonElement {
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Submit'));
  if (!btn) throw new Error('submit button not rendered');
  return btn;
}

function buttonNamed(label: string): HTMLButtonElement {
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!btn) throw new Error(`button "${label}" not rendered`);
  return btn;
}

// Typed stand-ins for the two generic `api` methods QuizItem calls, so the
// recorded calls stay typed. They are installed over `api` per test.
const postSpy = vi.fn(
  (_path: string, _body?: unknown): Promise<QuizSubmitResponse> => Promise.resolve(submitResponse()),
);
const getSpy = vi.fn((_path: string): Promise<QuizRevealResponse> => new Promise(() => {}));

beforeEach(() => {
  postSpy.mockReset();
  postSpy.mockResolvedValue(submitResponse());
  getSpy.mockReset();
  // Never-resolving by default: the auto-reveal $effect fires GET /reveal when
  // attempt_count >= max, and the 0-remaining case must be observed in the
  // window BEFORE `revealed` flips `locked`.
  getSpy.mockImplementation(() => new Promise(() => {}));
  vi.spyOn(api, 'post').mockImplementation(postSpy as unknown as typeof api.post);
  vi.spyOn(api, 'get').mockImplementation(getSpy as unknown as typeof api.get);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
  __test__setSlots(null);
  vi.mocked(recordQuizAttempt).mockClear();
  clearAllDrafts();
  session.user = null;
  vi.restoreAllMocks();
});

describe('QuizItem shell (T4)', () => {
  it('renders the item title as the article heading', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 2));

    expect(host.querySelector('article.quiz h2')?.textContent).toBe('Check yourself');
  });

  it('shares the quiz article with the empty-quiz branch', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 0));

    const article = host.querySelector('article.quiz');
    expect(article).not.toBeNull();
    expect(article!.querySelector('h2')?.textContent).toBe('Check yourself');
    expect(article!.querySelector('.empty-state .title')!.textContent).toBe('This quiz has no questions yet.');
    expect(host.querySelector('.q-block')).toBeNull();
  });

  it('wraps each question in a .q-block opened by a mono 1-based counter', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 3));

    const blocks = host.querySelectorAll('.q-block');
    expect(blocks.length).toBe(3);

    const counters = [...host.querySelectorAll('.q-counter')];
    expect(counters.map((c) => c.textContent?.trim())).toEqual([
      'Question 1 of 3',
      'Question 2 of 3',
      'Question 3 of 3',
    ]);
    counters.forEach((c) => expect(c.classList.contains('mono')).toBe(true));
    // The counter belongs to its own question block, not the article.
    blocks.forEach((b) => expect(b.querySelector('.q-counter')).not.toBeNull());
  });

  // D75: a full-width rule BETWEEN questions, as its own article child (the
  // q-blocks keep the 652px measure, the rule spans the sheet).
  it('puts one hr.q-sep between consecutive questions and none around them', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 3));

    const kids = [...host.querySelector('article.quiz')!.children].map((el) =>
      [el.tagName.toLowerCase(), ...[...el.classList].filter((c) => !c.startsWith('svelte-'))].join('.'));
    expect(kids).toEqual(['h2', 'div.q-block', 'hr.q-sep', 'div.q-block', 'hr.q-sep', 'div.q-block', 'div.submit-row']);
  });

  it('draws no separator for a one-question quiz', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 1));

    expect(host.querySelector('hr')).toBeNull();
  });

  it('explains why Submit is disabled (enumerated (C)15)', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 1));

    expect(submitButton().getAttribute('title')).toBe('Answer every question first');

    answerAll();
    expect(submitButton().hasAttribute('title')).toBe(false);
  });

  it('renders the submit row with the "Submit answer" label', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 1));

    const row = host.querySelector('.submit-row');
    expect(row).not.toBeNull();
    expect(row!.querySelector('button')?.textContent?.trim()).toBe('Submit answer');
  });
});

describe('QuizItem type dispatch (T4)', () => {
  // T4 rewrapped the {#each} body, so every arm of the preserved dispatch chain
  // needs a witness inside its own .q-block — a single_choice-only fixture lets
  // any other arm be deleted with the whole gate still green.
  it('renders each question type inside its own .q-block and posts a mixed map', async () => {
    seed({ 2: 0 });
    render(mixedQuiz(2));

    const blocks = [...host.querySelectorAll('.q-block')];
    expect(blocks.length).toBe(4);
    const radio = blocks[0].querySelector<HTMLInputElement>('input[type="radio"]');
    const checkbox = blocks[1].querySelector<HTMLInputElement>('input[type="checkbox"]');
    const numeric = blocks[2].querySelector<HTMLInputElement>('input[inputmode="decimal"]');
    const text = blocks[3].querySelector<HTMLInputElement>('input[type="text"]');
    expect(radio).not.toBeNull();
    expect(checkbox).not.toBeNull();
    expect(numeric).not.toBeNull();
    expect(text).not.toBeNull();
    expect(text!.hasAttribute('inputmode')).toBe(false); // not the numeric field

    expect(submitButton().disabled).toBe(true);
    radio!.click();
    checkbox!.click();
    // The string branch of `allAnswered` is reachable only through these two.
    typeInto(numeric!, '42');
    typeInto(text!, 'a vector');
    flushSync();

    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    await settle();

    const [, body] = postSpy.mock.calls[0] as unknown as [
      string,
      { answers: Record<string, number[] | string> },
    ];
    expect(body.answers).toEqual({ 201: [2011], 202: [2021], 203: '42', 204: 'a vector' });
  });
});

describe('QuizItem submit contract (D1, T4)', () => {
  it('keeps Submit disabled until every question is answered', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 2));

    expect(submitButton().disabled).toBe(true);

    // Answer only the first question — still incomplete.
    host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[0].click();
    flushSync();
    expect(submitButton().disabled).toBe(true);

    answerAll();
    expect(submitButton().disabled).toBe(false);
  });

  it('posts the whole answer map exactly once and ignores a click while in flight', async () => {
    seed({ 1: 0 });
    const item = quiz(1, 'Check yourself', 2);
    let resolveSubmit!: (r: QuizSubmitResponse) => void;
    postSpy.mockImplementation(() => new Promise<QuizSubmitResponse>((res) => { resolveSubmit = res; }));

    render(item);
    answerAll();
    submitButton().click();
    flushSync();

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0] as unknown as [
      string,
      { answers: Record<string, number[] | string> },
    ];
    expect(path).toBe('/api/items/1/submit');
    const expected: Record<string, number[]> = {};
    for (const q of item.questions) expected[String(q.id)] = [q.id * 10 + 1];
    expect(body.answers).toEqual(expected);

    // In flight: the button holds the spinner, is disabled, and says why.
    const btn = submitButton();
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('.spinner')).not.toBeNull();
    expect(btn.getAttribute('title')).toBe('Submitting…');

    // A disabled button's click() invokes no handler, so re-enable it: that is
    // what makes the second click actually re-enter submit() and prove ITS
    // `inflight !== null` early return — not merely the DOM-level guard above.
    btn.disabled = false;
    btn.click();
    flushSync();
    expect(postSpy).toHaveBeenCalledTimes(1);

    resolveSubmit(submitResponse());
    await settle();
  });
});

describe('QuizItem submit recovery (T4)', () => {
  // `finally { inflight = null }` is what lets the student submit again; drop it
  // and Submit stays disabled + spinning forever, with no other gate noticing.
  it('re-enables Submit after Try again', async () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 1));
    answerAll();
    submitButton().click();
    await settle();

    buttonNamed('Try again').click();
    flushSync();
    answerAll(); // tryAgain() clears the answers

    const btn = submitButton();
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector('.spinner')).toBeNull();

    btn.click();
    await settle();
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('re-enables Submit after a failed submit, keeping the answers', async () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 1));
    postSpy.mockRejectedValueOnce(new Error('network down'));
    answerAll();
    submitButton().click();
    await settle();

    // The catch ran, so there is no result card; the answers survive, so the
    // same submission can be retried without re-answering.
    expect(host.querySelector('.result')).toBeNull();
    const btn = submitButton();
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector('.spinner')).toBeNull();

    btn.click();
    await settle();
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.result')).not.toBeNull();
  });
});

describe('QuizItem attempts line (T4)', () => {
  it('renders the remaining count with a mono numeral, pluralised', () => {
    seed({ 1: 1 });
    render(quiz(1, 'Check yourself', 1));

    const hint = host.querySelector('.submit-row .hint');
    expect(hint?.textContent?.trim()).toBe('2 attempts left');
    expect(hint?.querySelector('.mono')?.textContent).toBe('2');
  });

  it('uses the singular for one attempt', () => {
    seed({ 1: 2 });
    render(quiz(1, 'Check yourself', 1));

    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('1 attempt left');
  });

  it('renders 0 left while the auto-reveal is still in flight', () => {
    seed({ 1: MAX });
    render(quiz(1, 'Check yourself', 1));

    // attempt_count === max fires the auto-reveal GET, stubbed never-resolving,
    // so `revealed` is still null and `locked` still false at this point.
    expect(getSpy).toHaveBeenCalledWith('/api/items/1/reveal');
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('0 attempts left');
  });

  it('never renders a negative remaining', () => {
    // More attempts recorded than the version allows (e.g. max_quiz_attempts
    // lowered after attempts were spent). Without the pinned Math.max(0, …)
    // clamp this reads "-2 attempts left".
    seed({ 1: MAX + 2 });
    render(quiz(1, 'Check yourself', 1));

    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('0 attempts left');
  });

  it('is suppressed when the course snapshot is absent', () => {
    __test__setSlots(null);
    render(quiz(1, 'Check yourself', 1));

    expect(host.querySelector('.hint')).toBeNull();
  });

  it('is absent in the locked result state', async () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 1));
    answerAll();
    submitButton().click();
    await settle();

    expect(host.querySelector('.result')).not.toBeNull();
    expect(host.querySelector('.hint')).toBeNull();
  });
});

describe('QuizItem result card (T4)', () => {
  it('wraps the score ratio in a mono span', async () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 2));
    answerAll();
    submitButton().click();
    await settle();

    const score = host.querySelector('.result .mono');
    expect(score?.textContent?.trim()).toBe('1 / 2');
  });

  it('restores the student’s own numeric and text answers on auto-reveal', async () => {
    // Attempts already exhausted, so QuizItem auto-loads the reveal on mount and
    // `valueFor()` must pre-fill from `revealed.student_answer` — the only path
    // that repopulates a field the in-progress `answers` map knows nothing
    // about. Without it a returning student sees empty disabled fields beside
    // the correct answers, with no way to compare the two.
    seed({ 2: MAX });
    const item = mixedQuiz(2);
    const reveal: QuizRevealResponse = {
      item_id: 2,
      attempt_count: MAX,
      score_correct: 0,
      score_total: 4,
      questions: item.questions.map((q) => ({
        id: q.id,
        type: q.type,
        text_html: q.text_html,
        explanation_html: null,
        // non-nullable in the schema: [] is the no-choice-answer shape
        correct_option_ids: q.type === 'single_choice' ? [2011]
          : q.type === 'multiple_choice' ? [2021] : [],
        // 0, not 80: `correct_numeric ?? null` and `|| null` differ only on a
        // falsy-but-valid answer, and 0 is one a teacher really authors.
        correct_numeric: q.type === 'numeric_answer' ? 0 : null,
        correct_text: q.type === 'text_answer' ? 'Photosynthesis' : null,
        student_answer: q.id === 203 ? '42' : q.id === 204 ? 'a vector' : null,
      })),
    };
    getSpy.mockResolvedValue(reveal);

    render(item);
    await settle();

    const blocks = [...host.querySelectorAll('.q-block')];
    const numeric = blocks[2].querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    const text = blocks[3].querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(numeric.value).toBe('42');
    expect(text.value).toBe('a vector');
    // Inert, and shown next to the correct answer so the two can be compared.
    expect(numeric.disabled).toBe(true);
    expect(text.disabled).toBe(true);
    expect(blocks[2].querySelector('.correct-line')?.textContent).toBe('Correct answer: 0');
  });

  it('renders the explanation panel for a revealed question', async () => {
    seed({ 1: MAX });
    const item = quiz(1, 'Check yourself', 1);
    const reveal: QuizRevealResponse = {
      item_id: 1,
      attempt_count: MAX,
      score_correct: 0,
      score_total: 1,
      questions: [
        {
          id: item.questions[0].id,
          type: 'single_choice',
          text_html: '<p>Prompt</p>',
          explanation_html: `<p>Because the determinant is negative. <a href="https://example.org/d">More</a> <a href="${location.origin}/courses/x">Course</a></p>`,
          correct_option_ids: [item.questions[0].id * 10 + 1],
          correct_numeric: null,
          correct_text: null,
          student_answer: null,
        },
      ],
    };
    getSpy.mockResolvedValue(reveal);

    render(item);
    await settle();

    const exp = host.querySelector('.q-block .exp');
    expect(exp?.textContent).toContain('Because the determinant is negative.');
    expect(exp!.classList.contains('prose')).toBe(true);
    expect(exp!.classList.contains('compact')).toBe(true);
    expect(exp!.querySelector('a[href="https://example.org/d"]')!.getAttribute('target')).toBe('_blank');
    expect(exp!.querySelector(`a[href="${location.origin}/courses/x"]`)!.hasAttribute('target')).toBe(false);
  });
});

describe('QuizItem lastAttempt memo (enumerated (A)3, T4)', () => {
  it('keeps the attempts line accurate across Try again', async () => {
    seed({ 1: 0 });
    // Hold the store at 0 used (as when no course snapshot is loaded), so the
    // line can only come from the response memo.
    vi.mocked(recordQuizAttempt).mockImplementationOnce(() => {});
    render(quiz(1, 'Check yourself', 1));
    answerAll();
    submitButton().click();
    await settle();

    buttonNamed('Try again').click();
    flushSync();

    // The store still says 0 used; the response memo says 1, so 2 remain —
    // not the stale 3.
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('2 attempts left');
  });

  it('does not leak one item’s attempt count onto the next item', async () => {
    seed({ 1: 0, 2: 2 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    submitButton().click();
    await settle();

    buttonNamed('Try again').click();
    flushSync();
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('2 attempts left');

    props.item = quiz(2, 'Quiz B', 1);
    flushSync();

    // B's own store count (2 of 3 used) — NOT A's memoised 1.
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('1 attempt left');
  });

  it('keys the memo and the coverage write off the response, not the live prop', async () => {
    seed({ 1: 0, 2: 2 });
    let resolveSubmit!: (r: QuizSubmitResponse) => void;
    postSpy.mockImplementation(() => new Promise<QuizSubmitResponse>((res) => { resolveSubmit = res; }));

    render(quiz(1, 'Quiz A', 1));
    answerAll();
    submitButton().click();
    flushSync();

    // Navigate to item B while A's submit is still in flight.
    props.item = quiz(2, 'Quiz B', 1);
    flushSync();

    resolveSubmit(submitResponse({ item_id: 1, attempt_count: 1, can_retry: true }));
    await settle();

    // A's continuation records the attempt on A, not on the item now on screen.
    expect(recordQuizAttempt).toHaveBeenCalledWith(expect.objectContaining({ item_id: 1 }), { '101': [1011] });
    expect(recordQuizAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ item_id: 2 }), expect.anything());

    // Clear the result card so the attempts line renders again.
    buttonNamed('Try again').click();
    flushSync();

    // B's own store count (2 of 3 used) — A's memo is id-guarded away.
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('1 attempt left');
  });
});

// --- Polish 3: a remount sees the recorded attempt and the draft (C13, D83) ---
describe('QuizItem across a remount (C13, D83)', () => {
  const student = {
    id: 7, email: 's@x.test', full_name: null, is_superuser: false, is_disabled: false,
    photo_url: null, has_course_admin: false, has_run_teacher: false,
  };
  function remount(item: QuizItemType): void {
    if (component) { unmount(component); component = null; }
    if (host?.parentNode) host.parentNode.removeChild(host);
    render(item);
  }

  it('submit on the last attempt, then a remount: the reveal loads and no Submit shows', async () => {
    seed({ 1: 2 });
    postSpy.mockResolvedValue(submitResponse({ item_id: 1, attempt_count: 3, can_retry: false }));
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    submitButton().click();
    await settle();
    getSpy.mockReset();
    getSpy.mockResolvedValue({
      item_id: 1, attempt_count: 3, score_correct: 1, score_total: 1,
      questions: [{ id: 101, type: 'single_choice', text_html: '<p>Prompt 101</p>', explanation_html: null,
        correct_option_ids: [1011], correct_numeric: null, correct_text: null, student_answer: [1011] }],
    });
    remount(quiz(1, 'Quiz A', 1));
    await settle();
    expect(getSpy).toHaveBeenCalledWith('/api/items/1/reveal');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Submit'))).toBe(false);
    expect(host.querySelector('.result')?.textContent).toContain('Attempt 3 of 3');
  });

  function radios(): HTMLInputElement[] {
    return [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  }
  function hasSubmit(): boolean {
    return [...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Submit'));
  }
  /** Seed one item whose last attempt the store already holds (a reload, D89). */
  function seedResult(attempts: number, score: { correct: number; total: number } | null,
    answers: Record<string, number[] | string> | null): void {
    seed({ 1: attempts });
    const e = entry(attempts);
    e.last_score = score;
    e.last_answers = answers;
    __test__setSlots({
      slug: 'algebra', versionId: 1,
      course: { id: 1, slug: 'algebra', name: 'Linear Algebra' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: MAX },
      blocks: [], state: { version_id: 1, items: { '1': e } },
      miniProjectsByBlockId: {}, teachers: [],
    });
  }

  // D89 (Safari pass): coming back to a submitted quiz shows that result, not
  // an empty form; the student never asked for a new attempt.
  it('submit with attempts left, then a remount: the last result shows locked, with Try again', async () => {
    session.user = student;
    seed({ 1: 0 });
    postSpy.mockResolvedValue(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 1, score_total: 1, can_retry: true }));
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    submitButton().click();
    await settle();
    remount(quiz(1, 'Quiz A', 1));
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1011']);
    expect(radios().every((r) => r.disabled)).toBe(true);
    const result = host.querySelector('.result')?.textContent ?? '';
    expect(result).toContain('1 / 1');
    expect(result).toContain('Attempt 1 of 3');
    expect(buttonNamed('Try again')).toBeDefined();
    expect(hasSubmit()).toBe(false);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('a result stored before this page load shows when the quiz opens', () => {
    seedResult(2, { correct: 0, total: 1 }, { '101': [1012] });
    render(quiz(1, 'Quiz A', 1));
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1012']);
    expect(radios().every((r) => r.disabled)).toBe(true);
    expect(host.querySelector('.result')?.textContent).toContain('0 / 1');
    expect(host.querySelector('.result')?.textContent).toContain('Attempt 2 of 3');
    expect(hasSubmit()).toBe(false);
  });

  it('the stored result shows once the course snapshot arrives after the quiz mounts', () => {
    __test__setSlots(null);
    render(quiz(1, 'Quiz A', 1));
    expect(host.querySelector('.result')).toBeNull();
    seedResult(1, { correct: 1, total: 1 }, { '101': [1011] });
    flushSync();
    expect(host.querySelector('.result')?.textContent).toContain('Attempt 1 of 3');
    expect(radios().every((r) => r.disabled)).toBe(true);
  });

  it('Try again on a shown result opens an empty form with the right number left', () => {
    seedResult(1, { correct: 1, total: 1 }, { '101': [1011] });
    render(quiz(1, 'Quiz A', 1));
    buttonNamed('Try again').click();
    flushSync();
    expect(host.querySelector('.result')).toBeNull();
    expect(radios().some((r) => r.checked)).toBe(false);
    expect(radios().some((r) => r.disabled)).toBe(false);
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('2 attempts left');
  });

  it('a new attempt started after Try again wins over the stored result on a remount', () => {
    session.user = student;
    seedResult(1, { correct: 1, total: 1 }, { '101': [1011] });
    render(quiz(1, 'Quiz A', 1));
    buttonNamed('Try again').click();
    flushSync();
    radios()[1]!.click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    expect(host.querySelector('.result')).toBeNull();
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1012']);
    expect(submitButton().disabled).toBe(false);
  });

  it('an attempt without a stored score opens an empty form, as before', () => {
    seedResult(1, null, null);
    render(quiz(1, 'Quiz A', 1));
    expect(host.querySelector('.result')).toBeNull();
    expect(radios().some((r) => r.disabled)).toBe(false);
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('2 attempts left');
  });

  it('a never-visited quiz (no store entry) keeps its count across a remount', async () => {
    seed({});
    postSpy.mockResolvedValue(submitResponse({ item_id: 1, attempt_count: 1, can_retry: true }));
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    submitButton().click();
    await settle();
    remount(quiz(1, 'Quiz A', 1));
    expect(host.querySelector('.result')?.textContent).toContain('Attempt 1 of 3');
    buttonNamed('Try again').click();
    flushSync();
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('2 attempts left');
  });

  it('a quiz that mounts used up drops its leftover draft', () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    expect(getDraft(1)).toBeDefined();
    // Another tab used the last attempt; the store now says so.
    seed({ 1: MAX });
    remount(quiz(1, 'Quiz A', 1));
    expect(getDraft(1)).toBeUndefined();
    // While the reveal loads, the restored answers must not re-enable Submit.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Submit'))).toBe(false);
    expect(radios().every((r) => r.disabled)).toBe(true);
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some((r) => r.checked)).toBe(false);
  });

  it('a remount restores the unsubmitted answers', () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 2));
    answerAll();
    remount(quiz(1, 'Quiz A', 2));
    const checked = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((r) => r.checked);
    expect(checked).toHaveLength(2);
    expect(submitButton().disabled).toBe(false);
  });

  it('a successful submit clears the draft but keeps the shown answers', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    expect(getDraft(1)).toBeDefined();
    submitButton().click();
    await settle();
    expect(getDraft(1)).toBeUndefined();
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some((r) => r.checked)).toBe(true);
  });
});

// VR-B (polish3 T1): a submit in flight. The draft goes when the request is
// sent and comes back if it fails; the questions are locked meanwhile.
describe('QuizItem submit in flight (VR backlog)', () => {
  const student = {
    id: 7, email: 's@x.test', full_name: null, is_superuser: false, is_disabled: false,
    photo_url: null, has_course_admin: false, has_run_teacher: false,
  };
  function remount(item: QuizItemType): void {
    if (component) { unmount(component); component = null; }
    if (host?.parentNode) host.parentNode.removeChild(host);
    render(item);
  }
  function radios(): HTMLInputElement[] {
    return [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  }
  function held(): { resolve: (r: QuizSubmitResponse) => void; reject: (e: unknown) => void } {
    let resolve!: (r: QuizSubmitResponse) => void;
    let reject!: (e: unknown) => void;
    postSpy.mockImplementationOnce(() => new Promise<QuizSubmitResponse>((res, rej) => { resolve = res; reject = rej; }));
    return { resolve: (r) => resolve(r), reject: (e) => reject(e) };
  }

  for (const [label, err] of [
    ['a network failure', new TypeError('Failed to fetch')],
    ['a 500', new ApiError(500, 'boom')],
    ['a 422', new ApiError(422, 'Bad answers')],
  ] as const) {
    it(`clears the draft when sent and restores it after ${label}`, async () => {
      session.user = student;
      seed({ 1: 0 });
      render(quiz(1, 'Quiz A', 1));
      answerAll();
      const h = held();
      submitButton().click();
      flushSync();
      expect(getDraft(1)).toBeUndefined();
      h.reject(err);
      await settle();
      expect(getDraft(1)).toEqual({ '101': [1011] });
      expect(hasUnsavedDrafts()).toBe(true);
      expect(radios().every((r) => !r.disabled)).toBe(true);
      expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1011']);
    });
  }

  // VR-B (user, r9): Submit is disabled in flight, so a keyboard user's
  // focus falls to <body>. Browsers drop it; jsdom keeps it on a disabled
  // button and will not blur it, so the test parks it on a removed element.
  // A failure gives it back to Submit, never stealing it from elsewhere.
  it('a failed send gives focus back to Submit when it fell to the page', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().focus();
    submitButton().click();
    flushSync();
    const parked = document.createElement('input');
    document.body.appendChild(parked);
    parked.focus();
    parked.remove();
    expect(document.activeElement).toBe(document.body);
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(document.activeElement).toBe(submitButton());
  });

  // The card's button is described by the score and the attempt lines.
  for (const [label, res, name] of [
    ['with attempts left', { item_id: 1, attempt_count: 1, can_retry: true }, 'Try again'],
    ['on the last attempt', { item_id: 1, attempt_count: 3, can_retry: false }, 'Show correct answers'],
  ] as const) {
    it(`${name} (${label}) is described by the score and the attempt`, async () => {
      session.user = student;
      seed({ 1: res.attempt_count - 1 });
      render(quiz(1, 'Quiz A', 1));
      answerAll();
      postSpy.mockResolvedValueOnce(submitResponse(res));
      submitButton().click();
      await settle();
      const ids = (buttonNamed(name).getAttribute('aria-describedby') ?? '').split(' ');
      expect(ids).toHaveLength(2);
      const texts = ids.map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim());
      expect(texts[0]).toMatch(/^Score: \d+ \/ \d+$/);
      expect(texts[1]).toBe(`Attempt ${res.attempt_count} of 3`);
    });
  }

  // VR-B (user, r10): on success the Submit row gives way to the result card;
  // focus that fell to the page goes to the card's button.
  for (const [label, res, name] of [
    ['with attempts left', { item_id: 1, attempt_count: 1, can_retry: true }, 'Try again'],
    ['on the last attempt', { item_id: 1, attempt_count: 3, can_retry: false }, 'Show correct answers'],
  ] as const) {
    it(`a successful send ${label} gives focus to the card's button when it fell to the page`, async () => {
      session.user = student;
      seed({ 1: res.attempt_count - 1 });
      render(quiz(1, 'Quiz A', 1));
      answerAll();
      const h = held();
      submitButton().focus();
      submitButton().click();
      flushSync();
      const parked = document.createElement('input');
      document.body.appendChild(parked);
      parked.focus();
      parked.remove();
      h.resolve(submitResponse(res));
      await settle();
      expect(document.activeElement).toBe(buttonNamed(name));
    });
  }

  it('a successful send leaves focus the student put elsewhere', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().focus();
    submitButton().click();
    flushSync();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    h.resolve(submitResponse({ item_id: 1, attempt_count: 1, can_retry: true }));
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('a failed send leaves focus the student put elsewhere', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().focus();
    submitButton().click();
    flushSync();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('locks the questions while the submit is in flight', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    expect(radios().every((r) => r.disabled)).toBe(true);
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(radios().every((r) => !r.disabled)).toBe(true);
  });

  it('a return mid-submit opens an empty form, and the late result does not lock over typed answers', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    expect(radios().some((r) => r.checked)).toBe(false);
    expect(radios().every((r) => !r.disabled)).toBe(true);
    radios()[1]!.click();
    flushSync();
    h.resolve(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 1, score_total: 1 }));
    await settle();
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1012']);
    expect(radios().every((r) => !r.disabled)).toBe(true);
    expect(getDraft(1)).toEqual({ '101': [1012] });
  });

  it('a late, lower attempt count does not hide the newer one', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const first = held();
    submitButton().click();
    flushSync();
    // Leave, come back, answer again and submit: attempt 2 lands first.
    remount(quiz(1, 'Quiz A', 1));
    radios()[1]!.click();
    flushSync();
    postSpy.mockResolvedValueOnce(submitResponse({ item_id: 1, attempt_count: 2, score_correct: 0, score_total: 1 }));
    submitButton().click();
    await settle();
    buttonNamed('Try again').click();
    flushSync();
    first.resolve(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 1, score_total: 1 }));
    await settle();
    expect(host.textContent).toMatch(/1\s*attempt\s*left/);
    remount(quiz(1, 'Quiz A', 1));
    expect(host.querySelector('.result')?.textContent).toContain('Attempt 2 of 3');
  });

  it('a 409 drops the draft and records the exhausted count', async () => {
    session.user = student;
    seed({ 1: 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    postSpy.mockRejectedValueOnce(new ApiError(409, 'Max attempts reached'));
    submitButton().click();
    await settle();
    expect(getDraft(1)).toBeUndefined();
    expect(hasUnsavedDrafts()).toBe(false);
    expect(getSpy).toHaveBeenCalledWith('/api/items/1/reveal');
    getSpy.mockClear();
    remount(quiz(1, 'Quiz A', 1));
    // The remounted quiz is the exhausted one: it loads the reveal again and
    // holds no answers.
    expect(getSpy).toHaveBeenCalledWith('/api/items/1/reveal');
    expect(radios().some((r) => r.checked)).toBe(false);
  });

  // Codex I1: a used-up quiz whose answers are not shown yet takes no new answers.
  it('after an attempts 409, a pending reveal keeps the questions locked and the reveal busy', async () => {
    session.user = student;
    seed({ 1: 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    postSpy.mockRejectedValueOnce(new ApiError(409, 'Max attempts reached'));
    submitButton().click();
    await settle();
    expect(radios().every((r) => r.disabled)).toBe(true);
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Submit'))).toBe(false);
    const show = buttonNamed('Show correct answers');
    expect(show.getAttribute('aria-busy')).toBe('true');
    expect(show.getAttribute('aria-disabled')).toBe('true');
    getSpy.mockClear();
    show.click();
    await settle();
    expect(getSpy).not.toHaveBeenCalled();
    expect(hasUnsavedDrafts()).toBe(false);
  });

  for (const [label, start] of [['after an attempts 409', 1], ['when the quiz opens used up', MAX]] as const) {
    it(`a failed reveal ${label} locks the questions and Show correct answers retries it`, async () => {
      session.user = student;
      seed({ 1: start });
      getSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      render(quiz(1, 'Quiz A', 1));
      if (start < MAX) {
        answerAll();
        postSpy.mockRejectedValueOnce(new ApiError(409, 'Max attempts reached'));
        submitButton().click();
      }
      await settle();
      await settle();
      expect(radios().every((r) => r.disabled)).toBe(true);
      radios()[0]!.click();
      flushSync();
      expect(hasUnsavedDrafts()).toBe(false);
      const show = buttonNamed('Show correct answers');
      expect(show.getAttribute('aria-busy')).toBeNull();
      expect(show.getAttribute('aria-disabled')).toBeNull();
      getSpy.mockResolvedValueOnce({
        item_id: 1, attempt_count: MAX, score_correct: 0, score_total: 1,
        questions: [{ id: 101, correct_option_ids: [1012], student_answer: [1011], explanation_html: '' }],
      } as unknown as QuizRevealResponse);
      show.click();
      await settle();
      expect(getSpy).toHaveBeenLastCalledWith('/api/items/1/reveal');
      expect(host.querySelector('.result')?.textContent).toContain(`Attempt ${MAX} of ${MAX}`);
    });
  }

  it('the result card\'s Show correct answers is busy while its reveal loads and sends it once', async () => {
    session.user = student;
    seed({ 1: MAX - 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    postSpy.mockResolvedValueOnce(submitResponse({ attempt_count: MAX, can_retry: false }));
    submitButton().click();
    await settle();
    const show = buttonNamed('Show correct answers');
    expect(host.querySelector('.result')?.contains(show)).toBe(true);
    getSpy.mockClear();
    show.click();
    flushSync();
    expect(show.getAttribute('aria-busy')).toBe('true');
    expect(show.getAttribute('aria-disabled')).toBe('true');
    show.click();
    await settle();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('after an attempts 409, focus that fell to the page goes to Show correct answers', async () => {
    session.user = student;
    seed({ 1: 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().focus();
    submitButton().click();
    flushSync();
    const parked = document.createElement('input');
    document.body.appendChild(parked);
    parked.focus();
    parked.remove();
    h.reject(new ApiError(409, 'Max attempts reached'));
    await settle();
    expect(document.activeElement).toBe(buttonNamed('Show correct answers'));
  });

  // Review r1: a submit refused because the session ended. The 401 handler
  // signs the student out before the catch runs; the draft must survive the
  // sign-in round trip (C14).
  it('a 401 keeps the draft for the sign-in round trip', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    clearToasts();
    // As main.ts's 401 handler does: no user, no course snapshot.
    postSpy.mockImplementationOnce(() => {
      session.user = null;
      clearCourse();
      return Promise.reject(new ApiError(401, 'Not authenticated'));
    });
    submitButton().click();
    await settle();
    expect(getDraft(1)).toEqual({ '101': [1011] });
    expect(hasUnsavedDrafts()).toBe(true);
    // VR-B (user, r10): the sign-in page explains itself; no error toast.
    expect(toasts.list).toEqual([]);
  });

  it('a 409 that is not about attempts keeps the draft and loads no reveal', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    postSpy.mockRejectedValueOnce(new ApiError(409, 'Quiz has no questions'));
    submitButton().click();
    await settle();
    expect(getDraft(1)).toEqual({ '101': [1011] });
    expect(hasUnsavedDrafts()).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  // Review r2: an older submit that fails while a newer one is in flight
  // holds stale answers; the newer send owns the draft now.
  it('an older submit that fails while a newer one is in flight leaves no stale draft', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const a = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    radios()[1]!.click();
    flushSync();
    const b = held();
    submitButton().click();
    flushSync();
    a.reject(new TypeError('Failed to fetch'));
    await settle();
    b.resolve(submitResponse({ item_id: 1, attempt_count: 2, score_correct: 0, score_total: 1 }));
    await settle();
    expect(getDraft(1)).toBeUndefined();
    expect(hasUnsavedDrafts()).toBe(false);
    remount(quiz(1, 'Quiz A', 1));
    expect(host.querySelector('.result')).not.toBeNull();
  });

  // Review r2: a draft goes back only to the student who typed it.
  it('a failure that lands after another student signed in gives them no draft', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    session.user = { ...student, id: 8, email: 'other@x.test' };
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(getDraft(1)).toBeUndefined();
  });

  // Review r2: an explicit sign-out drops the drafts (C14); a late failure
  // must not bring one back into a signed-out tab.
  it('a failure that lands after a sign-out leaves no draft', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    clearAllDrafts();
    session.user = null;
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(getDraft(1)).toBeUndefined();
    expect(hasUnsavedDrafts()).toBe(false);
  });

  // Review r3: the draft leaves the store at send; the page still warns
  // before closing until the answers are safe.
  it('the page warns before closing while a submit is in flight', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    expect(hasUnsavedDrafts()).toBe(true);
    h.resolve(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 1, score_total: 1 }));
    await settle();
    expect(hasUnsavedDrafts()).toBe(false);
  });

  // Review r3: a late answer writes the course state only for the student
  // who sent it.
  it('a late success after another student signed in leaves their attempts alone', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    clearAllDrafts();
    session.user = { ...student, id: 8, email: 'other@x.test' };
    h.resolve(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 1, score_total: 1 }));
    await settle();
    expect(currentCourse.value!.state.items['1'].attempt_count).toBe(0);
  });

  it('a late attempts 409 after another student signed in loads no reveal for them', async () => {
    session.user = student;
    seed({ 1: 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    clearAllDrafts();
    session.user = { ...student, id: 8, email: 'other@x.test' };
    h.reject(new ApiError(409, 'Max attempts reached'));
    await settle();
    expect(currentCourse.value!.state.items['1'].attempt_count).toBe(1);
    expect(getSpy).not.toHaveBeenCalled();
  });

  // Review r5: an older send learns the attempts are used up, then the newer
  // send fails. The quiz is exhausted, so its answers have nowhere to go.
  it('a failed newer send puts no draft back once the quiz is exhausted', async () => {
    session.user = student;
    seed({ 1: 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const a = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    radios()[1]!.click();
    flushSync();
    const b = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    a.reject(new ApiError(409, 'Max attempts reached'));
    await settle();
    b.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(getDraft(1)).toBeUndefined();
    expect(hasUnsavedDrafts()).toBe(false);
  });

  // Review r6: answers typed after a return have nowhere to go once the late
  // send uses the quiz up, so they leave no draft (and no unload warning).
  for (const [label, settleSend] of [
    ['an attempts 409', (h: ReturnType<typeof held>) => h.reject(new ApiError(409, 'Max attempts reached'))],
    ['a last-attempt success', (h: ReturnType<typeof held>) =>
      h.resolve(submitResponse({ item_id: 1, attempt_count: 3, can_retry: false }))],
  ] as const) {
    it(`a draft typed after a return goes when the late send ends in ${label}`, async () => {
      session.user = student;
      seed({ 1: 2 });
      render(quiz(1, 'Quiz A', 1));
      answerAll();
      const h = held();
      submitButton().click();
      flushSync();
      remount(quiz(1, 'Quiz A', 1));
      radios()[1]!.click();
      flushSync();
      expect(getDraft(1)).toEqual({ '101': [1012] });
      unmount(component!);
      component = null;
      settleSend(h);
      await settle();
      expect(getDraft(1)).toBeUndefined();
      expect(hasUnsavedDrafts()).toBe(false);
    });
  }

  // Review r8: the restored draft replaces the stored card of an earlier
  // attempt; without that the form stays locked over a hidden draft.
  it("a failure after a return opens the form over the earlier attempt's card", async () => {
    session.user = student;
    seed({ 1: 0 });
    postSpy.mockResolvedValueOnce(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 0, score_total: 1, can_retry: true }));
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    submitButton().click();
    await settle();
    buttonNamed('Try again').click();
    flushSync();
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    expect(host.querySelector('.result')).not.toBeNull();
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(host.querySelector('.result')).toBeNull();
    expect(radios().every((r) => !r.disabled)).toBe(true);
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1011']);
  });

  // Review r8: a late answer belongs to the course it was sent from; the
  // student may have opened another course meanwhile.
  // Review r9: the quiz is used up either way, so answers typed after a return
  // go even though another course is open (item ids are global).
  for (const [label, settleSend] of [
    ['last-attempt success', (h: ReturnType<typeof held>) =>
      h.resolve(submitResponse({ item_id: 1, attempt_count: 3, can_retry: false }))],
    ['attempts 409', (h: ReturnType<typeof held>) => h.reject(new ApiError(409, 'Max attempts reached'))],
  ] as const) {
    it(`a late ${label} writes nothing into another course opened meanwhile, and drops the draft`, async () => {
      session.user = student;
      seed({ 1: 2 });
      render(quiz(1, 'Quiz A', 1));
      answerAll();
      const h = held();
      submitButton().click();
      flushSync();
      remount(quiz(1, 'Quiz A', 1));
      radios()[1]!.click();
      flushSync();
      expect(getDraft(1)).toEqual({ '101': [1012] });
      unmount(component!);
      component = null;
      __test__setSlots({
        slug: 'geometry', versionId: 2,
        course: { id: 2, slug: 'geometry', name: 'Geometry' },
        version: { id: 2, state: 'published', info_html: '', max_quiz_attempts: MAX },
        blocks: [], state: { version_id: 2, items: {} },
        miniProjectsByBlockId: {}, teachers: [],
      });
      settleSend(h);
      await settle();
      expect(currentCourse.value!.state.items['1']).toBeUndefined();
      expect(getDraft(1)).toBeUndefined();
      expect(hasUnsavedDrafts()).toBe(false);
    });
  }

  // Review r9: a reload of the same course (CourseView loads it on every
  // visit) replaces the snapshot; the late answer still belongs there.
  it('a late success lands in a reloaded snapshot of the same course', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    seed({ 1: 0 });
    h.resolve(submitResponse({ item_id: 1, attempt_count: 1 }));
    await settle();
    expect(currentCourse.value!.state.items['1'].attempt_count).toBe(1);
  });

  // Review r9: a late failure of another student's send is not news for
  // whoever is signed in now.
  it('a late failure after another student signed in shows them no toast', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    clearToasts();
    clearAllDrafts();
    session.user = { ...student, id: 8, email: 'other@x.test' };
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(toasts.list).toEqual([]);
  });

  it('a failure that lands after a return keeps the answers typed since', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    radios()[1]!.click();
    flushSync();
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(getDraft(1)).toEqual({ '101': [1012] });
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1012']);
  });

  it('a failure that lands after a return shows the restored answers', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    expect(radios().some((r) => r.checked)).toBe(false);
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['1011']);
    expect(radios().every((r) => !r.disabled)).toBe(true);
    expect(submitButton().disabled).toBe(false);
  });

  it('after Try again the attempts line counts the higher of the memo and the store', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const first = held();
    submitButton().click();
    flushSync();
    remount(quiz(1, 'Quiz A', 1));
    radios()[1]!.click();
    flushSync();
    const second = held();
    submitButton().click();
    flushSync();
    // The server took the second submit first: the first answer carries 2.
    first.resolve(submitResponse({ item_id: 1, attempt_count: 2, score_correct: 1, score_total: 1 }));
    await settle();
    second.resolve(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 0, score_total: 1 }));
    await settle();
    buttonNamed('Try again').click();
    flushSync();
    expect(host.querySelector('.hint')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 attempt left');
  });

  it('clearing a typed answer after a late result keeps the form open', async () => {
    session.user = student;
    seed({ 1: 0 });
    const textQuiz: QuizItemType = {
      id: 1, sequence_id: 100, title: 'Text', slug: 'quiz-1', order: 1, type: 'quiz',
      questions: [{ id: 501, order: 1, type: 'text_answer', text_md: '', text_html: '<p>Name it</p>' }],
    };
    render(textQuiz);
    const field = () => host.querySelector<HTMLInputElement>('input[type="text"], textarea')!;
    typeInto(field(), 'Oslo');
    flushSync();
    const h = held();
    submitButton().click();
    flushSync();
    remount(textQuiz);
    typeInto(field(), 'Bergen');
    flushSync();
    h.resolve(submitResponse({ item_id: 1, attempt_count: 1, score_correct: 1, score_total: 1 }));
    await settle();
    typeInto(field(), '');
    flushSync();
    expect(field().disabled).toBe(false);
    expect(host.querySelector('.result')).toBeNull();
  });

  /** Focus falls to the page (jsdom keeps it on a removed or disabled control). */
  function dropFocus(): void {
    const parked = document.createElement('input');
    document.body.appendChild(parked);
    parked.focus();
    parked.remove();
  }
  function revealOf1(): QuizRevealResponse {
    return {
      item_id: 1, attempt_count: 3, score_correct: 1, score_total: 1,
      questions: [{ id: 101, type: 'single_choice', text_html: '<p>Prompt 101</p>', explanation_html: null,
        correct_option_ids: [1011], correct_numeric: null, correct_text: null, student_answer: [1011] }],
    };
  }

  // VR-B (r11 M1): the repair looks only inside the quiz that was sent.
  it('a success after a move to another quiz does not focus that quiz’s card', async () => {
    session.user = student;
    const b = entry(1);
    b.last_score = { correct: 0, total: 1 };
    b.last_answers = { '201': [2011] };
    __test__setSlots({
      slug: 'algebra', versionId: 1,
      course: { id: 1, slug: 'algebra', name: 'Linear Algebra' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: MAX },
      blocks: [], state: { version_id: 1, items: { '1': entry(0), '2': b } },
      miniProjectsByBlockId: {}, teachers: [],
    });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().focus();
    submitButton().click();
    flushSync();
    remount(quiz(2, 'Quiz B', 1));
    expect(buttonNamed('Try again')).toBeDefined();
    dropFocus();
    h.resolve(submitResponse({ item_id: 1, attempt_count: 1, can_retry: true }));
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  // VR-B (user, r11): Try again takes its own button away; focus that fell to
  // the page goes to the first answer, ready for the new attempt.
  it('Try again gives focus to the first answer when it fell to the page', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 2));
    answerAll();
    submitButton().click();
    await settle();
    buttonNamed('Try again').focus();
    buttonNamed('Try again').click();
    flushSync();
    dropFocus();
    await settle();
    expect(document.activeElement).toBe(radios()[0]);
  });

  it('Try again leaves focus the student put elsewhere', async () => {
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    submitButton().click();
    await settle();
    buttonNamed('Try again').click();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  // VR-B (user, r11): a reveal takes the button away; focus that fell to the
  // page goes to the result card (tabindex -1), which now heads the answers.
  it('Show correct answers gives focus to the result card when it fell to the page', async () => {
    session.user = student;
    seed({ 1: 2 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    postSpy.mockResolvedValueOnce(submitResponse({ item_id: 1, attempt_count: 3, can_retry: false }));
    submitButton().click();
    await settle();
    getSpy.mockResolvedValueOnce(revealOf1());
    buttonNamed('Show correct answers').focus();
    buttonNamed('Show correct answers').click();
    dropFocus();
    await settle();
    expect(document.activeElement).toBe(host.querySelector('.result'));
  });

  it('Show correct answers leaves focus the student put elsewhere', async () => {
    session.user = student;
    seed({ 1: 2 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    postSpy.mockResolvedValueOnce(submitResponse({ item_id: 1, attempt_count: 3, can_retry: false }));
    submitButton().click();
    await settle();
    getSpy.mockResolvedValueOnce(revealOf1());
    buttonNamed('Show correct answers').click();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    await settle();
    expect(host.querySelector('.result')?.textContent).not.toContain('Show correct answers');
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('an attempts 409 gives focus to the result card once the answers load', async () => {
    session.user = student;
    seed({ 1: 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    getSpy.mockResolvedValue(revealOf1());
    const h = held();
    submitButton().focus();
    submitButton().click();
    flushSync();
    dropFocus();
    h.reject(new ApiError(409, 'Max attempts reached'));
    await settle();
    await settle();
    expect(host.querySelector('.result')).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector('.result'));
  });

  it('an attempts 409 leaves focus the student put elsewhere', async () => {
    session.user = student;
    seed({ 1: 1 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    getSpy.mockResolvedValue(revealOf1());
    const h = held();
    submitButton().click();
    flushSync();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    h.reject(new ApiError(409, 'Max attempts reached'));
    await settle();
    await settle();
    expect(host.querySelector('.result')).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  // A 409 that recorded nothing (no course loaded) leaves no focus move behind
  // for a later reveal, which would be a page load.
  it('an attempts 409 with no course loaded does not focus a later reveal', async () => {
    session.user = student;
    __test__setSlots(null);
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().focus();
    submitButton().click();
    flushSync();
    dropFocus();
    h.reject(new ApiError(409, 'Max attempts reached'));
    await settle();
    getSpy.mockResolvedValue(revealOf1());
    seed({ 1: 3 });
    await settle();
    await settle();
    expect(host.querySelector('.result')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  // Opening a used-up quiz is a page load: focus stays where the page put it.
  it('opening a used-up quiz does not focus its result card', async () => {
    session.user = student;
    seed({ 1: 3 });
    getSpy.mockResolvedValue(revealOf1());
    dropFocus();
    render(quiz(1, 'Quiz A', 1));
    await settle();
    await settle();
    expect(host.querySelector('.result')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('an offline submit says OFFLINE_MESSAGE (whole-branch review)', async () => {
    clearToasts();
    session.user = student;
    seed({ 1: 0 });
    render(quiz(1, 'Quiz A', 1));
    answerAll();
    const h = held();
    submitButton().click();
    flushSync();
    h.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(toasts.list.map((t) => t.message)).toEqual(['Could not reach server. Check your connection.']);
  });
});
