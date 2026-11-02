import { it, expect, afterEach, vi } from 'vitest';
import { __test__setSlots, currentCourse, clearCourse, recordQuizAttempt } from '../stores/currentCourse.svelte';

function seed(): void {
  __test__setSlots({
    slug: 'algebra',
    versionId: 1,
    course: { id: 1, slug: 'algebra', name: 'Linear Algebra' },
    version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
    blocks: [],
    state: {
      version_id: 1,
      items: {
        '5': {
          is_covered: false, time_spent: 0, last_visited_at: null, attempt_count: 0,
          max_attempts: 3, last_score: null, last_answers: null,
        },
      },
    },
    miniProjectsByBlockId: {}, teachers: [],
  });
}

afterEach(() => clearCourse());

it('recordQuizAttempt sets attempt_count, max_attempts, last_score, last_answers and is_covered (C13, D89, P118)', () => {
  seed();
  recordQuizAttempt({
    item_id: 5, attempt_count: 2, max_attempts: 3, score_correct: 1, score_total: 2, can_retry: true,
  }, { '51': [511], '52': '4' });
  const e = currentCourse.value!.state.items['5']!;
  expect(e.attempt_count).toBe(2);
  expect(e.max_attempts).toBe(3);
  expect(e.last_score).toEqual({ correct: 1, total: 2 });
  expect(e.is_covered).toBe(true);
  expect(e.last_answers).toEqual({ '51': [511], '52': '4' });
});

// A page load straight onto a never-visited quiz (#item= in the address)
// records the visit before the course is loaded, so the store has no entry for
// it; the submit must create one, or a remount shows a stale count (Fable r3).
it('recordQuizAttempt creates the entry when the store does not hold the item', () => {
  seed();
  // The writes must go through the store's proxy, not the literal it wraps
  // (Svelte warns `assignment_value_stale` when they do not; Fable r4).
  const warn = vi.spyOn(console, 'warn');
  recordQuizAttempt({
    item_id: 9, attempt_count: 1, max_attempts: 3, score_correct: 0, score_total: 1, can_retry: true,
  }, { '91': [912] });
  const e = currentCourse.value!.state.items['9']!;
  expect(e.attempt_count).toBe(1);
  expect(e.max_attempts).toBe(3);
  expect(e.last_score).toEqual({ correct: 0, total: 1 });
  expect(e.is_covered).toBe(true);
  expect(e.last_answers).toEqual({ '91': [912] });
  expect(e.time_spent).toBe(0);
  expect(e.last_visited_at).not.toBeNull();
  expect(warn.mock.calls.flat().join(' ')).not.toContain('assignment_value_stale');
  warn.mockRestore();
});

it('recordQuizAttempt does nothing without a course snapshot', () => {
  recordQuizAttempt({
    item_id: 5, attempt_count: 1, max_attempts: 3, score_correct: 0, score_total: 1, can_retry: true,
  }, {});
  expect(currentCourse.value).toBeNull();
});
