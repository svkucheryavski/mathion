import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RosterImportModal from '../components/runs/RosterImportModal.svelte';
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
  // NOTE: no vi.useFakeTimers() here — none of these 3 tests need to exercise
  // the 200ms paste-debounce path. The textarea input handler still schedules
  // a timer, but with real timers the test can simply not wait for it; we
  // drive submission directly. This avoids the fake/real timer juggling that
  // the sibling submit suite needs.
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

// 12-tick settle mirrors the sibling submit suite — submit chains refetch →
// batch → state update, so a 2-tick settle would race.
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function mountModal(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const refetch = vi.fn().mockResolvedValue({
    students: [student({})],
    groups: [group({})],
  });
  const onClose = vi.fn();
  const cmp = mount(RosterImportModal, { target, props: {
    runId: 10,
    existingRoster: [student({})],
    existingGroups: [group({})],
    onRefetchBeforeSubmit: refetch,
    onClose,
    ...extra,
  } });
  return { target, cmp, refetch, onClose };
}

// Drives paste → import for a single email, with the fetch mock providing the
// stage-2 result rows the test wants to inspect.
async function pasteAndImport(target: HTMLElement, email: string) {
  const ta = target.querySelector('textarea') as HTMLTextAreaElement;
  if (!ta) throw new Error('textarea not found');
  ta.value = email;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  // The 200ms debounce hasn't fired yet — drive it manually by calling parseCsv
  // is not exposed; instead just wait for the real timer.
  await new Promise((r) => setTimeout(r, 220));
  flushSync();
  const importBtn = target.querySelector('button[data-action="import"]') as HTMLButtonElement | null;
  if (!importBtn) throw new Error('import button not found');
  importBtn.click();
  await settle();
}

describe('RosterImportModal — student_already_active_in_course rendering', () => {
  it('Test 1: matching error_code surfaces detail inline (visible, not just title)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      {
        email: 'a@x.com',
        status: 'error',
        error_code: 'student_already_active_in_course',
        detail: "Already active in 'Spring 2025'",
      },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await pasteAndImport(target, 'a@x.com');

    // The inline-visible detail span — query that, NOT the parent <td>, because
    // the <td> also contains the badge text "error" (collision: "errorAlready
    // active in 'Spring 2025'").
    const detail = target.querySelector('.error-detail');
    if (!detail) throw new Error('.error-detail span not found');
    expect(detail.textContent?.trim()).toBe("Already active in 'Spring 2025'");

    // Badge is still rendered as the visual indicator alongside the inline detail.
    const badge = target.querySelector('span.badge.badge-error');
    if (!badge) throw new Error('badge.badge-error not found');

    unmount(cmp);
  });

  it('Test 2: other error_code preserves tooltip and does NOT render inline detail', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      {
        email: 'a@x.com',
        status: 'error',
        // Valid BulkRosterErrorCode union member (types.ts:334-338). Using an
        // unknown string like 'some_other_code' would fail svelte-check.
        error_code: 'capacity_reached',
        detail: 'something else',
      },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await pasteAndImport(target, 'a@x.com');

    // Badge present with the detail surfaced via title (tooltip-only path).
    const badge = target.querySelector('span.badge.badge-error[data-result="error"]');
    if (!badge) throw new Error('badge.badge-error not found');
    expect(badge.getAttribute('title')).toBe('something else');

    // Inline-visible detail span must NOT be rendered for non-matching codes.
    expect(target.querySelector('.error-detail')).toBeNull();

    unmount(cmp);
  });

  it('Test 3: copy-failed flow still includes detail for matching error_code (no regression)', async () => {
    // Force the clipboard path to reject so we can inspect the fallback textarea
    // (which mirrors `copyFallbackText` — the surface the plan asks us to check).
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    fetchSpy.mockImplementation(() => jres({ results: [
      {
        email: 'a@x.com',
        status: 'error',
        error_code: 'student_already_active_in_course',
        detail: "Already active in 'Spring 2025'",
      },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await pasteAndImport(target, 'a@x.com');

    const copyBtn = target.querySelector('button[data-action="copy-failed"]') as HTMLButtonElement | null;
    if (!copyBtn) throw new Error('copy-failed button not found');
    copyBtn.click();
    await settle();

    const fallback = target.querySelector('textarea.copy-fallback') as HTMLTextAreaElement | null;
    if (!fallback) throw new Error('copy-fallback textarea not found');
    // failedRowsAsText() format: `${email}\t${detail ?? ''}` per row.
    expect(fallback.value).toContain("Already active in 'Spring 2025'");
    expect(fallback.value).toContain('a@x.com');

    unmount(cmp);
  });
});
