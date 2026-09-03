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

function entry(attemptCount: number): ItemStateEntry {
  return {
    is_covered: false,
    time_spent_seconds: 0,
    last_visited_at: null,
    last_answers: null,
    attempt_count: attemptCount,
    score_correct: null,
    score_total: null,
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

  it('renders the submit row with the "Submit answer" label', () => {
    seed({ 1: 0 });
    render(quiz(1, 'Check yourself', 1));

    const row = host.querySelector('.submit-row');
    expect(row).not.toBeNull();
    expect(row!.querySelector('button')?.textContent?.trim()).toBe('Submit answer');
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
    expect(Object.keys(body.answers).sort()).toEqual(
      item.questions.map((q) => String(q.id)).sort(),
    );

    // In flight: the button holds the spinner and refuses a second submit.
    const btn = submitButton();
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('.spinner')).not.toBeNull();
    btn.click();
    flushSync();
    expect(postSpy).toHaveBeenCalledTimes(1);

    resolveSubmit(submitResponse());
    await settle();
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
          explanation_html: '<p>Because the determinant is negative.</p>',
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
