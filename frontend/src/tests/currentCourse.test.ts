import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentCourse,
  clearCourse,
  markItemCovered,
  recordItemVisit,
  __test__setSlots,
} from '../stores/currentCourse.svelte';

describe('stores/currentCourse', () => {
  beforeEach(() => {
    clearCourse();
  });

  it('starts as null', () => {
    expect(currentCourse.value).toBeNull();
  });

  it('clearCourse resets to null', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
    });
    expect(currentCourse.value).not.toBeNull();
    clearCourse();
    expect(currentCourse.value).toBeNull();
  });

  it('markItemCovered mutates state.items[itemId].is_covered in place', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: {
        version_id: 1,
        items: {
          '42': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null },
        },
      },
    });
    markItemCovered(42);
    expect(currentCourse.value!.state.items['42'].is_covered).toBe(true);
  });

  it('recordItemVisit updates last_visited_at to now', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: {
        version_id: 1,
        items: {
          '42': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null },
        },
      },
    });
    recordItemVisit(42);
    expect(currentCourse.value!.state.items['42'].last_visited_at).not.toBeNull();
  });

  it('markItemCovered no-ops if itemId not in state.items', () => {
    __test__setSlots({
      slug: 's',
      versionId: 1,
      course: { id: 1, slug: 's', name: 'T' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [],
      state: { version_id: 1, items: {} },
    });
    expect(() => markItemCovered(999)).not.toThrow();
  });
});
