import { it, expect } from 'vitest';
import { cardAfterOwn, cardAfterRead, finishLines, skipLabel, stepMark, STEP_LABELS, type Card, type PanelSetup } from '../lib/setup';

// Set up D12: the Finish setting up card's lines.

function state(over: Partial<PanelSetup> = {}, done: boolean[] = [false, false, false, false]): PanelSetup {
  const reasons = ['Not tested yet: send a test email.', 'The site is still called Mathion.', null, null];
  return {
    wizard_on: true, step: 1,
    steps: done.map((d, i) => ({ passed: d, done: d, reason: d ? null : reasons[i] })),
    course: null, course_without_admin: null, email_set_up: false, pin_minutes: 10, defaults_in_use: true,
    ...over,
  };
}

it('a fresh state: four lines in step order, with the reasons', () => {
  expect(finishLines(state())).toEqual([
    { step: 1, title: 'Email', reason: 'Not tested yet: send a test email.', page: 'settings', keep: false },
    { step: 2, title: 'Site name and logo', reason: 'The site is still called Mathion.', page: 'branding', keep: false },
    { step: 3, title: 'First course and its admin', reason: null, page: 'courses', keep: false },
    { step: 4, title: 'Sign-in rules and limits', reason: "(Mathion's defaults are in use)", page: 'settings', keep: true },
  ]);
});

it('every step skipped: only the Email and First course lines (D4a)', () => {
  const s = state({ wizard_on: false }, [false, true, false, true]);
  s.steps.forEach((st) => { st.passed = true; });
  expect(finishLines(s).map((l) => l.title)).toEqual(['Email', 'First course and its admin']);
});

it('done steps are left out', () => {
  expect(finishLines(state({}, [true, false, true, false])).map((l) => l.step)).toEqual([2, 4]);
});

it("step 3 names the course with no admin; step 4's reason only while the defaults are in use", () => {
  const lines = finishLines(state({ course_without_admin: 'Chemometrics', defaults_in_use: false }));
  expect(lines[2].reason).toBe('Chemometrics has no admin');
  expect(lines[3].reason).toBeNull();
  expect(lines[3].keep).toBe(true);
});

it('an all-done state has no lines', () => {
  expect(finishLines(state({}, [true, true, true, true]))).toEqual([]);
});

// --- D3, D3a, D4a, D5: the Set up page's card rules ---

it('cardAfterRead: a held card stays; All set stays; otherwise the newest state decides', () => {
  const on3 = state({ wizard_on: true, step: 3 });
  const over = state({ wizard_on: false, step: 1 });
  const table: [Card, PanelSetup, boolean, Card][] = [
    [1, on3, true, 1],
    [1, over, true, 1],
    ['allset', on3, true, 'allset'],
    ['allset', over, true, 'allset'],
    [1, on3, false, 3],
    [1, over, false, 'allset'],
    ['allset', on3, false, 'allset'],
    ['allset', over, false, 'allset'],
    [3, on3, false, 3],
  ];
  for (const [shown, s, held, want] of table) expect(cardAfterRead(shown, s, held)).toBe(want);
});

it("cardAfterOwn: this tab's own write always applies", () => {
  expect(cardAfterOwn(state({ wizard_on: true, step: 2 }))).toBe(2);
  expect(cardAfterOwn(state({ wizard_on: false, step: 1 }))).toBe('allset');
});

it('the list labels (mockup) and the skip button per step (D4a)', () => {
  expect(STEP_LABELS).toEqual(['Email', 'Site name and logo', 'First course', 'Sign-in and limits']);
  expect([1, 2, 3, 4].map((n) => skipLabel(n as 1 | 2 | 3 | 4))).toEqual([
    'Skip for now', 'Keep the defaults', 'Skip for now', 'Keep these values',
  ]);
});

it('the list marks: a tick when done, dashed when passed but not done, the number otherwise', () => {
  expect(stepMark({ passed: true, done: true, reason: null })).toBe('done');
  expect(stepMark({ passed: false, done: true, reason: null })).toBe('done');
  expect(stepMark({ passed: true, done: false, reason: 'Email is off.' })).toBe('passed');
  expect(stepMark({ passed: false, done: false, reason: null })).toBe('number');
});
