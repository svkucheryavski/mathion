import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RosterImportModal from '../components/runs/RosterImportModal.svelte';
import type { RunStudentResponse, GroupResponse } from '../lib/types';
import { toasts, clearToasts } from '../stores/toasts.svelte';

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
  clearToasts();
  // Default clipboard mock — individual tests override as needed.
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

// 12-tick settle — the submit flow chains refetch → batch → state update, so
// the 2-tick pattern races on switching from fake to real timers.
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function mountModal(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // Stale props show the OLD group name; the refetch returns the FRESH name.
  // The submit-time refetch contract requires `buildBatchRow` to run against
  // the callback's data, NOT the props. Asserting `group: 'Alpha'` on the POST
  // body therefore proves the fresh data path was taken.
  const refetch = vi.fn().mockResolvedValue({
    students: [student({ group_id: 99 })],
    groups: [group({ name: 'Alpha' })],
  });
  const onClose = vi.fn();
  const cmp = mount(RosterImportModal, { target, props: {
    runId: 10,
    existingRoster: [student({ group_id: 99 })],
    existingGroups: [group({ name: 'OldName' })],
    onRefetchBeforeSubmit: refetch,
    onClose,
    ...extra,
  } });
  return { target, cmp, refetch, onClose };
}

async function importWith(target: HTMLElement, text: string) {
  const ta = target.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  vi.advanceTimersByTime(210);
  flushSync();
  (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
  vi.useRealTimers();
  await settle();
}
const toastTexts = () => toasts.list.map((t) => t.message);

describe('RosterImportModal submit', () => {
  it('calls onRefetchBeforeSubmit exactly once, then POSTs batch with F1=A wire shape', async () => {
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      expect(url).toContain('/api/runs/10/students/batch');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.rows).toEqual([{ email: 'a@x.com', group: 'Alpha' }]);
      expect(Object.prototype.hasOwnProperty.call(body.rows[0], 'group')).toBe(true);
      return jres({ results: [{ email: 'a@x.com', status: 'added' }] });
    });
    const { target, cmp, refetch } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('Import and Cancel ignore clicks while importing; the busy Import keeps focus (R20)', async () => {
    // The refetch never settles: the import stays in flight for the whole test.
    const refetch = vi.fn(() => new Promise(() => {}));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    const importBtn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    importBtn.focus();
    importBtn.click();
    flushSync();
    expect(importBtn.disabled).toBe(false);
    expect(importBtn.textContent?.trim()).toBe('Importing…');
    expect(document.activeElement).toBe(importBtn);
    expect(ta.readOnly).toBe(true);
    importBtn.click();
    (target.querySelector('button[data-action="cancel"]') as HTMLButtonElement).click();
    flushSync();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('renders result table with error tooltip on stage 2; Done calls onClose + refetch', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
    ] }));
    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com\nbad@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(target.textContent).toMatch(/1 added/);
    expect(target.textContent).toMatch(/1 failed/);
    const errorBadge = target.querySelector('[data-result="error"]') as HTMLElement;
    expect(errorBadge?.getAttribute('title')).toBe('Email invalid');
    (target.querySelector('button[data-action="done"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(2); // once for submit-time, once for Done
    unmount(cmp);
  });

  // --- Spec-mandated additions (§B row 1062) ---

  it('Copy failed rows writes tab-separated rows to navigator.clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
      { email: 'oops@x.com', status: 'error', detail: 'Capacity reached' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com\nbad@x.com\noops@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    (target.querySelector('button[data-action="copy-failed"]') as HTMLButtonElement).click();
    await settle();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('bad@x.com\tEmail invalid\noops@x.com\tCapacity reached');
    unmount(cmp);
  });

  it('Copy failed rows fallback: shows readonly textarea when clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com\nbad@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    (target.querySelector('button[data-action="copy-failed"]') as HTMLButtonElement).click();
    await settle();
    const fallback = target.querySelector('textarea.copy-fallback') as HTMLTextAreaElement;
    expect(fallback).toBeTruthy();
    expect(fallback.readOnly).toBe(true);
    expect(fallback.value).toBe('bad@x.com\tEmail invalid');
    unmount(cmp);
  });

  it('Escape in stage 1 closes (no refetch)', async () => {
    const refetch = vi.fn().mockResolvedValue({ students: [], groups: [] });
    const onClose = vi.fn();
    mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(onClose).toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('Escape in stage 2 triggers Done flow (refetch + onClose)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
    ] }));
    const refetch = vi.fn().mockResolvedValue({
      students: [student({ group_id: 99 })],
      groups: [group({ name: 'Alpha' })],
    });
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    // Stage 2 active.
    expect(target.querySelector('table.result')).toBeTruthy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalled();
    unmount(cmp);
  });

  it('Submit posts only the valid rows (skips invalid ones from the paste)', async () => {
    let capturedBody: { rows: unknown[] } | null = null;
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return jres({ results: [{ email: 'a@x.com', status: 'added' }] });
    });
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    // "bad" is invalid (no email format); "a@x.com" is valid.
    ta.value = 'a@x.com\nbad';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.rows.length).toBe(1);
    expect(capturedBody!.rows[0]).toMatchObject({ email: 'a@x.com' });
    unmount(cmp);
  });

  it('Stage 2 X button triggers Done flow (refetch + onClose)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
    ] }));
    const refetch = vi.fn().mockResolvedValue({
      students: [student({ group_id: 99 })],
      groups: [group({ name: 'Alpha' })],
    });
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(target.querySelector('table.result')).toBeTruthy();
    (target.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    await settle();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalled();
    unmount(cmp);
  });

  it('Stage 2 backdrop click leaves the modal open (D11)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
    ] }));
    const refetch = vi.fn().mockResolvedValue({
      students: [student({ group_id: 99 })],
      groups: [group({ name: 'Alpha' })],
    });
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    expect(target.querySelector('table.result')).toBeTruthy();
    const backdrop = target.querySelector('.modal-backdrop') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Close paths are inert while submitting (no onClose, no extra refetch)', async () => {
    let resolveRefetch: ((v: unknown) => void) | null = null;
    const refetch = vi.fn(() => new Promise((res) => { resolveRefetch = res; }));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    flushSync();
    // In-flight: backdrop, X, and Escape are all no-ops.
    (target.querySelector('.modal-backdrop') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (target.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(onClose).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1); // only the submit's call, no Done-flow extra
    resolveRefetch!({ students: [], groups: [] });
    unmount(cmp);
  });

  it('Non-ApiError rejection surfaces a generic banner (no silent swallow)', async () => {
    const refetch = vi.fn().mockRejectedValue(new TypeError('network down'));
    const { target, cmp, onClose } = mountModal({ onRefetchBeforeSubmit: refetch });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    vi.useRealTimers();
    await settle();
    // Generic error message should be visible; non-ApiError is re-thrown (not silent swallow).
    expect(target.querySelector('p.error')?.textContent).toMatch(/Import failed/);
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Concurrent textarea edit during in-flight submit does not mutate rows (snapshot guard)', async () => {
    let capturedBody: { rows: { email: string }[] } | null = null;
    let resolveRefetch: ((v: unknown) => void) | null = null;
    const refetch = vi.fn(() => new Promise((res) => { resolveRefetch = res; }));
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return jres({ results: [{ email: 'first@x.com', status: 'added' }] });
    });
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'first@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    // Click Import — refetch is in-flight (resolveRefetch not called yet).
    (target.querySelector('button[data-action="import"]') as HTMLButtonElement).click();
    flushSync();
    // User keeps typing while refetch is pending. Input handler schedules a new
    // debounce that WILL fire (onImport's clearTimeout already ran before).
    ta.value = 'second@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    // Now `parsed` reactive state has been mutated to "second@x.com". Without the
    // snapshot, onImport would build rows from the mutated state.
    resolveRefetch!({ students: [], groups: [] });
    vi.useRealTimers();
    await settle();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.rows).toEqual([{ email: 'first@x.com' }]);
    unmount(cmp);
  });
});

describe('RosterImportModal — a failed import (R20)', () => {
  it('shows the error as an alert and leaves focus on Import', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Run is not published' }, 409));
    const { target, cmp } = mountModal();
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    const importBtn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    importBtn.focus();
    importBtn.click();
    vi.useRealTimers();
    await settle();
    expect(target.querySelector('p.error[role="alert"]')?.textContent).toContain('Run is not published');
    expect(importBtn.disabled).toBe(false);
    expect(document.activeElement).toBe(importBtn);
    unmount(cmp);
  });
});

describe('RosterImportModal — result stage (10g)', () => {
  it('focus moves to Done on the stage switch; Done is described by the summary; the marker moves', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added', group_id: 99 },
      { email: 'b@x.com', status: 'error', detail: 'Run is full', error_code: 'capacity_reached' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'a@x.com\nb@x.com');
    const done = target.querySelector('button[data-action="done"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(done);
    const summary = document.getElementById(done.getAttribute('aria-describedby')!);
    expect(summary?.textContent).toBe('1 added, 1 failed.');
    const steps = Array.from(target.querySelectorAll('header.modal-head ol > li'));
    expect(steps[0].hasAttribute('aria-current')).toBe(false);
    expect(steps[0].textContent).toContain('(done)');
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(target.querySelector('.modal-foot')?.textContent).toContain('Failed rows can be copied as text and fixed in your sheet.');
    unmount(cmp);
  });

  it('Detail: each failed row shows the server text, "Not added" without one, and maps "internal error" (R25)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'e1@x.com', status: 'error', error_code: 'capacity_reached', detail: 'Run is full' },
      { email: 'e2@x.com', status: 'error', error_code: 'not_in_run' },
      { email: 'e3@x.com', status: 'error', error_code: 'internal_error', detail: 'internal error' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'e1@x.com');
    const details = Array.from(target.querySelectorAll('table.result tbody tr .error-detail')).map((d) => d.textContent);
    expect(details).toEqual(['Run is full', 'Not added', 'Server error — try again']);
    expect(target.querySelector('table.result tbody tr .error-detail')?.getAttribute('title')).toBe('Run is full');
    unmount(cmp);
  });

  it('Detail: "re-bucketed from …" only for a student whose group changed (D15, P9, Review Focus 2)', async () => {
    const refetch = vi.fn().mockResolvedValue({
      students: [
        student({ id: 1, user_id: 1, user_email: 'x1@x.com', group_id: 1 }),
        student({ id: 2, user_id: 2, user_email: 'Ann@X.com', group_id: 1 }),
        student({ id: 3, user_id: 3, user_email: 'x3@x.com', group_id: null }),
      ],
      groups: [group({ id: 1, name: 'Alpha' }), group({ id: 2, name: 'Beta' })],
    });
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'x1@x.com', status: 'added', group_id: 1 },
      { email: 'ann@x.com', status: 'added', group_id: 2 },
      { email: 'x3@x.com', status: 'added', group_id: 2 },
      { email: 'new@x.com', status: 'added', group_id: 2 },
      { email: 'nogroup@x.com', status: 'added' },
    ] }));
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch });
    await settle();
    await importWith(target, 'x1@x.com');
    const cells = Array.from(target.querySelectorAll('table.result tbody tr')).map(
      (tr) => tr.querySelector('td:last-child')?.textContent?.trim(),
    );
    expect(cells).toEqual(['', 're-bucketed from Alpha', 're-bucketed from no group', '', '']);
    unmount(cmp);
  });

  it('Done runs once: a second Done or Esc while its refetch runs does nothing; then it closes', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [{ email: 'a@x.com', status: 'added' }] }));
    let resolveDone!: (v: unknown) => void;
    const refetch = vi.fn()
      .mockResolvedValueOnce({ students: [], groups: [] })
      .mockImplementationOnce(() => new Promise((r) => { resolveDone = r; }));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    await importWith(target, 'a@x.com');
    const done = target.querySelector('button[data-action="done"]') as HTMLButtonElement;
    done.click();
    done.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await settle();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    // F10: × stays enabled while Done's refetch runs; closeForCurrentStage ignores it.
    expect((target.querySelector('header.modal-head button[aria-label="Close"]') as HTMLButtonElement).disabled).toBe(false);
    resolveDone({ students: [], groups: [] });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  // F10: closing leaves closeDisabled, so a focused × keeps focus while Done's refetch runs.
  it('Done at the summary keeps × enabled (closing leaves closeDisabled)', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [{ email: 'a@x.com', status: 'added' }] }));
    let resolveDone!: (v: unknown) => void;
    const refetch = vi.fn()
      .mockResolvedValueOnce({ students: [], groups: [] })
      .mockImplementationOnce(() => new Promise((r) => { resolveDone = r; }));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    await importWith(target, 'a@x.com');
    const x = target.querySelector('header.modal-head button[aria-label="Close"]') as HTMLButtonElement;
    x.focus();
    x.click();
    await settle();
    expect(x.disabled).toBe(false);
    expect(document.activeElement).toBe(x);
    x.click();   // ignored while closing
    await settle();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    resolveDone({ students: [], groups: [] });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('a failed refetch on Done still closes, with a toast', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [{ email: 'a@x.com', status: 'added' }] }));
    const refetch = vi.fn()
      .mockResolvedValueOnce({ students: [], groups: [] })
      .mockRejectedValueOnce(new Error('network down'));
    const onClose = vi.fn();
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch, onClose });
    await settle();
    await importWith(target, 'a@x.com');
    (target.querySelector('button[data-action="done"]') as HTMLButtonElement).click();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastTexts()).toContain('Roster refresh failed — reload to see the latest.');
    unmount(cmp);
  });

  it('a successful copy toasts "Copied 1 row" in the singular', async () => {
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'a@x.com', status: 'added' },
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'a@x.com\nbad@x.com');
    (target.querySelector('button[data-action="copy-failed"]') as HTMLButtonElement).click();
    await settle();
    expect(toastTexts()).toContain('Copied 1 row');
    unmount(cmp);
  });

  it('the copy fallback takes focus and selects its text (P10: it is named)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
      configurable: true,
    });
    fetchSpy.mockImplementation(() => jres({ results: [
      { email: 'bad@x.com', status: 'error', detail: 'Email invalid' },
    ] }));
    const { target, cmp } = mountModal();
    await settle();
    await importWith(target, 'bad@x.com');
    (target.querySelector('button[data-action="copy-failed"]') as HTMLButtonElement).click();
    await settle();
    const fallback = target.querySelector('textarea.copy-fallback') as HTMLTextAreaElement;
    expect(fallback.getAttribute('aria-label')).toBe('Failed rows');
    expect(document.activeElement).toBe(fallback);
    expect(fallback.selectionStart).toBe(0);
    expect(fallback.selectionEnd).toBe(fallback.value.length);
    unmount(cmp);
  });
});
