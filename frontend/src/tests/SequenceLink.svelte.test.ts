import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SequenceLink from '../components/course/SequenceLink.svelte';
import type { Item, SequenceContent, VersionState } from '../lib/types';

// Per the codebase memory rule: component tests use mount/unmount/flushSync
// from `svelte`, NOT @testing-library/svelte.
//
// The row (user, 2026-10-08): open-book mark, title, a progress bar with the
// share of items done, and a quiz chip with the score on the quizzes tried so
// far. It replaced the `S{order}` badge and the per-item mark chain, which
// stopped scaling once a sequence held 20 items.

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function item(id: number, type: Item['type'] = 'static_page'): Item {
  return { id, title: `Item ${id}`, slug: `i${id}`, order: id, type } as Item;
}

function sequence(over: Partial<SequenceContent> = {}): SequenceContent {
  return { id: 9, title: 'Determinants', slug: 'det', order: 3, items: [item(1), item(2), item(3)], ...over };
}

/** `state.items` is keyed by item id AS A STRING. Each entry is the literal
 *  shape `GET /api/versions/:id/state` sends (ItemStateResponse,
 *  backend/mathion/schemas.py): the latest quiz result is `last_score:
 *  {correct, total}`. An earlier fixture invented `score_correct` /
 *  `score_total` fields to match a wrong frontend type, and every test passed
 *  while the real app showed "Quiz –" for every student (review r1, Critical).
 *  `scores` maps an item id to its latest attempt's [correct, total]. */
function vstate(covered: number[], scores: Record<number, [number, number]> = {}): VersionState {
  const items: VersionState['items'] = {};
  for (const id of new Set([1, 2, 3, 4, 5, ...covered, ...Object.keys(scores).map(Number)])) {
    const sc = scores[id];
    items[String(id)] = {
      is_covered: covered.includes(id),
      time_spent: 0,
      last_visited_at: null,
      attempt_count: sc ? 1 : 0,
      max_attempts: 3,
      last_score: sc ? { correct: sc[0], total: sc[1] } : null,
      last_answers: null,
    };
  }
  return { version_id: 1, items };
}

type Props = { courseSlug: string; sequence: SequenceContent; state: VersionState };
let props: Props;

function render(over: Partial<Props> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const reactive = $state<Props>({
    courseSlug: 'linear-algebra',
    sequence: sequence(),
    state: vstate([1, 2]),
    ...over,
  });
  props = reactive;
  component = mount(SequenceLink, { target: host, props: reactive });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

const row = (r: HTMLElement) => r.querySelector('a.row') as HTMLAnchorElement;
const fill = (r: HTMLElement) => r.querySelector('.progress .fill') as HTMLElement;
const pct = (r: HTMLElement) => (r.querySelector('.progress .pct') as HTMLElement).textContent;
const quiz = (r: HTMLElement) => r.querySelector('.quiz-chip') as HTMLElement;
const text = (r: HTMLElement) => row(r).textContent!.replace(/\s+/g, '');

describe('SequenceLink', () => {
  it('renders exactly glyph, title, progress, quiz — in that order, nothing else', () => {
    // The S-badge, the item chain and the "2/3" count are gone. An exact child
    // schema pins both the removal and the order (bar before the chip, both at
    // the right edge), and the normalised text pins that no glyph or label was
    // appended as a bare text node, which `.children` cannot see.
    const root = render();
    const kids = Array.from(row(root).children);
    expect(kids.map((e) => e.className.split(' ')[0])).toEqual(['seq-glyph', 'row-title', 'progress', 'quiz-chip']);
    expect(root.querySelector('.badge, .chain, .count')).toBeNull();
    expect(text(root)).toBe('Determinants66%');
  });

  it('marks the row with the open book, hidden from assistive tech, never filled', () => {
    // Completion is the bar's job; the mark stays a not-yet outline even for a
    // finished sequence, as the mini-project flag does.
    const root = render({ state: vstate([1, 2, 3]) });
    const glyph = root.querySelector('.seq-glyph') as HTMLElement;
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    const mark = glyph.querySelector('.item-mark') as HTMLElement;
    expect(mark.classList.contains('not-yet')).toBe(true);
    expect(Array.from(mark.querySelector('svg')!.children).map((c) => c.tagName)).toEqual(['path', 'line']);
  });

  it('fills the bar to the share of items done, rounded DOWN', () => {
    // 2 of 3 is 66.67%: rounding down shows 66%, so "100%" can never appear
    // before the last item is done (199 of 200 must not read as finished).
    const root = render();
    expect(fill(root).style.width).toBe('66%');
    expect(pct(root)).toBe('66%');
    expect(fill(root).classList.contains('done')).toBe(false);
    expect((root.querySelector('.progress') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('199 of 200 reads 99%, not 100%', () => {
    const items = Array.from({ length: 200 }, (_, i) => item(i + 1));
    const root = render({
      sequence: sequence({ items }),
      state: vstate(items.slice(0, 199).map((it) => it.id)),
    });
    expect(pct(root)).toBe('99%');
    expect(fill(root).classList.contains('done')).toBe(false);
  });

  it('a started sequence never draws an empty bar: 1 of 220 shows a 2% sliver (CourseCard rule)', () => {
    // The text stays honest (rounded down to 0%); only the fill gets the visible
    // minimum, exactly as CourseCard's bar does.
    const items = Array.from({ length: 220 }, (_, i) => item(i + 1));
    const root = render({ sequence: sequence({ items }), state: vstate([1]) });
    expect(fill(root).style.width).toBe('2%');
    expect(pct(root)).toBe('0%');
  });

  it('a finished sequence shows 100% and turns the bar green (.done)', () => {
    const root = render({ state: vstate([1, 2, 3]) });
    expect(fill(root).style.width).toBe('100%');
    expect(pct(root)).toBe('100%');
    expect(fill(root).classList.contains('done')).toBe(true);
  });

  it('an empty sequence reads 0% and is not "done"', () => {
    const root = render({ sequence: sequence({ items: [] }) });
    expect(pct(root)).toBe('0%');
    expect(fill(root).style.width).toBe('0%');
    expect(fill(root).classList.contains('done')).toBe(false);
  });

  it('counts an item with no state entry as not done', () => {
    const root = render({ state: { version_id: 1, items: {} } });
    expect(pct(root)).toBe('0%');
  });

  it('no quizzes in the sequence: the chip slot stays (alignment) but is empty', () => {
    const root = render();
    const q = quiz(root);
    expect(q).not.toBeNull();
    expect(q.getAttribute('aria-hidden')).toBe('true');
    expect(q.textContent!.trim()).toBe('');
    expect(q.querySelector('svg')).toBeNull();
    expect(q.classList.contains('empty')).toBe(true);
  });

  it('quizzes not tried yet: a quiet "Quiz –"', () => {
    const root = render({ sequence: sequence({ items: [item(1), item(2, 'quiz')] }), state: vstate([1]) });
    const q = quiz(root);
    expect(q.textContent!.trim()).toBe('Quiz –');
    expect(q.classList.contains('none')).toBe(true);
    expect(q.querySelector('svg')).toBeNull();
  });

  it('quiz score = points earned ÷ points possible over the quizzes TRIED, rounded', () => {
    // Quiz 2: 3 of 4; quiz 3: 1 of 2; quiz 4 untried (left out, not counted as
    // 0). (3 + 1) / (4 + 2) = 66.67% → 67%. A per-quiz average would say 63%;
    // counting the untried quiz as 0 would need its total, which students
    // don't get — either slip changes the number.
    const root = render({
      sequence: sequence({ items: [item(1), item(2, 'quiz'), item(3, 'quiz'), item(4, 'quiz')] }),
      state: vstate([1, 2, 3], { 2: [3, 4], 3: [1, 2] }),
    });
    const q = quiz(root);
    expect(q.textContent!.trim()).toBe('Quiz 67%');
    expect(q.classList.contains('none') || q.classList.contains('empty')).toBe(false);
    expect(Array.from(q.querySelector('svg')!.children).map((c) => c.tagName)).toEqual(['polyline']);
  });

  it('reads the state exactly as the API sends it (raw JSON, no fixture helper)', () => {
    // End-to-end shape pin: this is a verbatim `/api/versions/:id/state` body.
    const raw = JSON.parse(`{"version_id": 10, "items": {
      "2": {"is_covered": true, "time_spent": 124, "last_visited_at": "2026-10-08T09:49:12Z",
            "attempt_count": 1, "max_attempts": 3, "last_score": {"correct": 3, "total": 4},
            "last_answers": {"5": [11]}}
    }}`) as VersionState;
    const root = render({ sequence: sequence({ items: [item(1), item(2, 'quiz')] }), state: raw });
    expect(quiz(root).textContent!.trim()).toBe('Quiz 75%');
    expect(row(root).getAttribute('aria-label'))
      .toBe('Sequence: Determinants, 1 of 2 items completed, quiz score 75%');
  });

  it('ignores scores on non-quiz items and quizzes worth zero points', () => {
    // A zero-point quiz would divide by zero on its own; a stray score on a page
    // is not a quiz result. Only quiz 3 (2 of 2) counts → 100%.
    const root = render({
      sequence: sequence({ items: [item(1), item(2, 'quiz'), item(3, 'quiz')] }),
      state: vstate([1], { 1: [0, 5], 2: [0, 0], 3: [2, 2] }),
    });
    expect(quiz(root).textContent!.trim()).toBe('Quiz 100%');
  });

  it('only zero-point quizzes tried: still "Quiz –"', () => {
    const root = render({
      sequence: sequence({ items: [item(1, 'quiz')] }),
      state: vstate([], { 1: [0, 0] }),
    });
    expect(quiz(root).textContent!.trim()).toBe('Quiz –');
  });

  it('names the row for assistive tech: title, progress in words, and the quiz state', () => {
    // The bar and chip are aria-hidden, so the label is the ONLY reading of
    // both. The whole string is pinned so a silent drop of any part shows.
    expect(row(render()).getAttribute('aria-label')).toBe('Sequence: Determinants, 2 of 3 items completed');
  });

  it('the label adds "no quizzes tried yet" or the quiz score', () => {
    const root = render({ sequence: sequence({ items: [item(1), item(2, 'quiz')] }), state: vstate([1]) });
    expect(row(root).getAttribute('aria-label'))
      .toBe('Sequence: Determinants, 1 of 2 items completed, no quizzes tried yet');
    props.state = vstate([1, 2], { 2: [3, 4] });
    flushSync();
    expect(row(root).getAttribute('aria-label'))
      .toBe('Sequence: Determinants, 2 of 2 items completed, quiz score 75%');
  });

  it('says "item" for exactly one item, "items" for zero and for more', () => {
    // 1 of 2 separates `total === 1` from `covered === 1`; 0 of 0 separates
    // `=== 1` from `<= 1` (both escaped review once, T7).
    const root = render({ sequence: sequence({ items: [item(4)] }), state: vstate([4]) });
    expect(row(root).getAttribute('aria-label')).toBe('Sequence: Determinants, 1 of 1 item completed');
    props.sequence = sequence({ items: [item(1), item(4)] });
    flushSync();
    expect(row(root).getAttribute('aria-label')).toBe('Sequence: Determinants, 1 of 2 items completed');
    props.sequence = sequence({ items: [] });
    flushSync();
    expect(row(root).getAttribute('aria-label')).toBe('Sequence: Determinants, 0 of 0 items completed');
  });

  it('points at the sequence route', () => {
    expect(row(render()).getAttribute('href')).toBe('/courses/linear-algebra/seq/9');
  });

  it('recomputes title, href, bar and chip when its props change', () => {
    // Plain `const`s would read `$props()` once at mount and freeze — invisible
    // on screen until the parent swaps the sequence.
    const root = render();
    props.sequence = sequence({ id: 12, order: 4, title: 'Eigenvalues', items: [item(1), item(4, 'quiz')] });
    props.courseSlug = 'algebra-2';
    flushSync();
    expect((root.querySelector('.row-title') as HTMLElement).textContent).toBe('Eigenvalues');
    expect(row(root).getAttribute('href')).toBe('/courses/algebra-2/seq/12');
    expect(pct(root)).toBe('50%');
    expect(quiz(root).textContent!.trim()).toBe('Quiz –');
    props.state = vstate([1, 4], { 4: [1, 4] });
    flushSync();
    expect(pct(root)).toBe('100%');
    expect(quiz(root).textContent!.trim()).toBe('Quiz 25%');
  });
});
