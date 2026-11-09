import { it, expect } from 'vitest';
import { finishLines, type PanelSetup } from '../lib/setup';

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
