import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab from '../components/runs/RunOverviewTab.svelte';
import type { RunResponse } from '../lib/types';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

const makeRun = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...over,
} as RunResponse);

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function mountOverview(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  let run = makeRun();
  const setRun = vi.fn((r: RunResponse) => (run = r));
  const cmp = mount(RunOverviewTab, {
    target,
    props: {
      run,
      setRun,
      teachers: [],
      groups: [],
      students: [],
      readiness: { checks: [], firstViolation: null },
      onNavigateTab: vi.fn(),
      onDeleteRun: vi.fn(),
      ...extra,
    },
  });
  return { target, cmp, setRun };
}

describe('RunOverviewTab inline edits', () => {
  it('PATCHes title on blur when changed', async () => {
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      expect(url).toContain('/api/runs/10');
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ title: 'Summer' });
      return jres(makeRun({ title: 'Summer' }));
    });
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('does NOT PATCH when blur fires with unchanged value', async () => {
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Enter blurs the field — exactly one PATCH (no double-fire from input event)', async () => {
    fetchSpy.mockImplementation(() => jres(makeRun({ title: 'Summer' })));
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.focus();
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('Escape reverts field to pristine without PATCH', async () => {
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(titleInput.value).toBe('Spring');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('successful PATCH preserves user edits to OTHER fields during the in-flight window', async () => {
    // Race: user blurs title (starts PATCH), then types in start_date BEFORE
    // the title PATCH resolves. The server response only knows the OLD
    // start_date; reset() would clobber the user's newer draft without
    // cross-field protection.
    let resolveTitle!: (r: Response) => void;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((r) => { resolveTitle = r; }));
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.focus();
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    await Promise.resolve();
    const startInput = target.querySelector('input[name="start_date"]') as HTMLInputElement;
    startInput.value = '2026-07-15';
    startInput.dispatchEvent(new Event('input', { bubbles: true }));
    resolveTitle({
      ok: true, status: 200,
      json: () => Promise.resolve(makeRun({ title: 'Summer' })),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response);
    await settle();
    expect(startInput.value).toBe('2026-07-15');
    unmount(cmp);
  });

  it('on PATCH error: reverts only if user has not since typed a new value', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'fail' }, 500));
    const { target, cmp } = mountOverview();
    await settle();
    const titleInput = target.querySelector('input[name="title"]') as HTMLInputElement;
    titleInput.value = 'Summer';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    // User types a new value before PATCH rejects
    titleInput.value = 'Autumn';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(titleInput.value).toBe('Autumn'); // not reverted
    unmount(cmp);
  });
});
