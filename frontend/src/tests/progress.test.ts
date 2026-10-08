import { describe, it, expect } from 'vitest';
import { progressOf, progressPhrase } from '../lib/progress';
import type { Item, VersionState } from '../lib/types';

// The one place progress and quiz score are computed (user, 2026-10-08): a
// sequence row, a block header and the course summary all call progressOf
// over their own items, so the three can never disagree on the rules.

function item(id: number, type: Item['type'] = 'static_page'): Item {
  return { id, title: `Item ${id}`, slug: `i${id}`, order: id, type } as Item;
}
/** Entries in the literal `/api/versions/:id/state` shape. */
function vstate(covered: number[], scores: Record<number, [number, number]> = {}): VersionState {
  const items: VersionState['items'] = {};
  for (const id of new Set([...covered, ...Object.keys(scores).map(Number)])) {
    const sc = scores[id];
    items[String(id)] = {
      is_covered: covered.includes(id), time_spent: 0, last_visited_at: null,
      attempt_count: sc ? 1 : 0, max_attempts: 3,
      last_score: sc ? { correct: sc[0], total: sc[1] } : null, last_answers: null,
    };
  }
  return { version_id: 1, items };
}

describe('progressOf', () => {
  it('counts covered items and rounds the share DOWN (100% only when all done)', () => {
    const items = [item(1), item(2), item(3)];
    expect(progressOf(items, vstate([1, 2]))).toMatchObject({ covered: 2, total: 3, pct: 66, done: false });
    expect(progressOf(items, vstate([1, 2, 3]))).toMatchObject({ pct: 100, barPct: 100, done: true });
  });

  it('gives the bar a 2% visible minimum once anything is done; the number stays honest', () => {
    const items = Array.from({ length: 220 }, (_, i) => item(i + 1));
    expect(progressOf(items, vstate([1]))).toMatchObject({ pct: 0, barPct: 2 });
    expect(progressOf(items, vstate([]))).toMatchObject({ pct: 0, barPct: 0 });
  });

  it('no items: 0%, not done', () => {
    expect(progressOf([], vstate([]))).toMatchObject({ covered: 0, total: 0, pct: 0, barPct: 0, done: false });
  });

  it('quiz score = points earned ÷ points possible over the quizzes TRIED, rounded', () => {
    // (3 + 1) / (4 + 2) = 66.67% → 67%; the untried quiz 4 is left out, not 0.
    const items = [item(1), item(2, 'quiz'), item(3, 'quiz'), item(4, 'quiz')];
    expect(progressOf(items, vstate([], { 2: [3, 4], 3: [1, 2] }))).toMatchObject({ hasQuiz: true, quizPct: 67 });
  });

  it('quizzes present but none tried (or only zero-point ones): quizPct null, hasQuiz true', () => {
    const items = [item(1), item(2, 'quiz')];
    expect(progressOf(items, vstate([]))).toMatchObject({ hasQuiz: true, quizPct: null });
    expect(progressOf(items, vstate([], { 2: [0, 0] }))).toMatchObject({ hasQuiz: true, quizPct: null });
  });

  it('no quizzes: hasQuiz false; a stray score on a non-quiz item is ignored', () => {
    expect(progressOf([item(1)], vstate([], { 1: [2, 2] }))).toMatchObject({ hasQuiz: false, quizPct: null });
  });
});

describe('progressPhrase', () => {
  const items = [item(1), item(2, 'quiz')];
  it('states progress in words, plus the quiz state', () => {
    expect(progressPhrase(progressOf([item(1), item(2)], vstate([1])))).toBe('1 of 2 items completed');
    expect(progressPhrase(progressOf(items, vstate([1])))).toBe('1 of 2 items completed, no quizzes tried yet');
    expect(progressPhrase(progressOf(items, vstate([1, 2], { 2: [3, 4] })))).toBe('2 of 2 items completed, quiz score 75%');
  });
  it('"item" for exactly one, "items" for zero and more', () => {
    expect(progressPhrase(progressOf([item(1)], vstate([1])))).toBe('1 of 1 item completed');
    expect(progressPhrase(progressOf([], vstate([])))).toBe('0 of 0 items completed');
  });
});
