import { it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RosterImportModal from '../components/runs/RosterImportModal.svelte';
import { RUN_UNPUBLISHED_ERROR_CODE } from '../lib/runRoster';
import type { RunStudentResponse, GroupResponse } from '../lib/types';

const student = (over: Partial<RunStudentResponse>): RunStudentResponse => ({
  id: 1, run_id: 10, user_id: 1, user_email: 'a@x.com', user_full_name: null,
  group_id: null, created_at: '2026-01-01T00:00:00Z', ...over,
});
const group = (over: Partial<GroupResponse>): GroupResponse => ({
  id: 99, run_id: 10, name: 'Alpha', student_count: 1, is_disabled: false, ...over,
});

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

// 12-tick settle mirrors the pattern in RosterImportModal.submit.svelte.test.ts
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

it('submit-step 409 surfaces via submitError slot with role=alert', async () => {
  // Refetch succeeds; batch call rejects with 409 run_unpublished.
  const refetch = vi.fn().mockResolvedValue({
    students: [student({})],
    groups: [group({})],
  });
  fetchSpy.mockImplementation(() =>
    Promise.resolve({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          detail: 'Cannot add students to an unpublished run',
          error_code: RUN_UNPUBLISHED_ERROR_CODE,
        }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response)
  );

  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RosterImportModal, {
    target,
    props: {
      runId: 10,
      existingRoster: [],
      existingGroups: [],
      onRefetchBeforeSubmit: refetch,
      onClose: () => {},
    },
  });
  flushSync();

  // Paste a valid email to enable the Import button.
  const ta = target.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = 'a@example.com';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(210);
  flushSync();

  // Click Import.
  (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
  vi.useRealTimers();
  await settle();

  // The new submitError slot must render with role="alert".
  const errorEl = target.querySelector('p.error[role="alert"]');
  expect(errorEl).toBeTruthy();
  expect(errorEl!.textContent).toContain('Cannot add students');

  // The existing parsed-error slot (p.error without role=alert, rendered when
  // parsed.ok === false) must NOT be given role="alert" — regression guard.
  const allErrors = Array.from(target.querySelectorAll('p.error'));
  const alertErrors = allErrors.filter((el) => el.getAttribute('role') === 'alert');
  expect(alertErrors.length).toBe(1); // only the submitError element

  unmount(cmp);
});

it('submitError clears when textarea is edited after a 409', async () => {
  const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
  fetchSpy.mockImplementation(() =>
    Promise.resolve({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          detail: 'Cannot add students to an unpublished run',
          error_code: RUN_UNPUBLISHED_ERROR_CODE,
        }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response)
  );

  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RosterImportModal, {
    target,
    props: {
      runId: 10,
      existingRoster: [],
      existingGroups: [],
      onRefetchBeforeSubmit: refetch,
      onClose: () => {},
    },
  });
  flushSync();

  const ta = target.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = 'a@example.com';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(210);
  flushSync();

  (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
  vi.useRealTimers();
  await settle();

  // Error is visible after 409.
  expect(target.querySelector('p.error[role="alert"]')).toBeTruthy();

  // User edits the textarea — error must clear.
  vi.useFakeTimers();
  ta.value = 'b@example.com';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();

  expect(target.querySelector('p.error[role="alert"]')).toBeNull();

  unmount(cmp);
});
