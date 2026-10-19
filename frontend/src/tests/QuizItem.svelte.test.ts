import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Stub only `markItemCovered` (a store WRITE we assert the argument of); keep
// the real reactive `currentCourse` + `__test__setSlots` so the attempts line
// reads a genuinely seeded snapshot.
vi.mock('../stores/currentCourse.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentCourse.svelte')>();
  return { ...real, markItemCovered: vi.fn() };
});

import { __test__setSlots, markItemCovered } from '../stores/currentCourse.svelte';
import { api } from '../lib/api';
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
      { id: id * 10 + 1, text: 'First' },
      { id: id * 10 + 2, text: 'Second' },
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
        options: [{ id: 2011, text: 'First' }, { id: 2012, text: 'Second' }] },
      { id: 202, order: 2, type: 'multiple_choice', text_md: '', text_html: '<p>Multi</p>',
        options: [{ id: 2021, text: 'First' }, { id: 2022, text: 'Second' }] },
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
    miniProjectsByBlockId: {},
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
  vi.mocked(markItemCovered).mockClear();
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
    render(quiz(1, 'Check yourself', 1));
    answerAll();
    submitButton().click();
    await settle();

    buttonNamed('Try again').click();
    flushSync();

    // The store still says 0 used (submit never bumps it); the response memo
    // says 1, so 2 remain — not the stale 3.
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

    // A's continuation credits coverage to A, not to the item now on screen.
    expect(markItemCovered).toHaveBeenCalledWith(1);
    expect(markItemCovered).not.toHaveBeenCalledWith(2);

    // Clear the result card so the attempts line renders again.
    buttonNamed('Try again').click();
    flushSync();

    // B's own store count (2 of 3 used) — A's memo is id-guarded away.
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe('1 attempt left');
  });
});
