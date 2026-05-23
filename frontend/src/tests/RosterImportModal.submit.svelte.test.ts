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
  vi.useFakeTimers();
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
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

  it('disables Import + Cancel during in-flight submit', async () => {
    let resolveRefetch: ((v: unknown) => void) | null = null;
    const refetch = vi.fn(() => new Promise((res) => { resolveRefetch = res; }));
    const { target, cmp } = mountModal({ onRefetchBeforeSubmit: refetch });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a@x.com';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(210);
    flushSync();
    const importBtn = target.querySelector('button[data-action="import"]') as HTMLButtonElement;
    importBtn.click();
    flushSync();
    expect(importBtn.disabled).toBe(true);
    expect((target.querySelector('button[data-action="cancel"]') as HTMLButtonElement).disabled).toBe(true);
    resolveRefetch!({ students: [], groups: [] });
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
});
