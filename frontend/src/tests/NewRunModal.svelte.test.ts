import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NewRunModal from '../components/runs/NewRunModal.svelte';
import type { Course, Version } from '../lib/types';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchSpy;
  document.body.innerHTML = '';
  location.hash = '#/courses/algebra/runs';
});

const course: Course = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true } as Course;
const versions: Version[] = [
  { id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false } as Version,
];

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function mountModal(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onClose = vi.fn();
  const cmp = mount(NewRunModal, { target, props: { course, versions, onClose, ...extra } });
  return { target, cmp, onClose };
}

describe('NewRunModal', () => {
  it('blocks submit on empty title and surfaces inline error', async () => {
    const { target, cmp } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = '   ';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(target.textContent).toContain('Title is required');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('blocks submit when end < start', async () => {
    const { target, cmp } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-15';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(target.textContent).toMatch(/end date must be on or after start date/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('submits payload WITHOUT version_id and navigates on success', async () => {
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      expect(url).toContain('/api/courses/1/runs');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', groups_enabled: false });
      expect('version_id' in body).toBe(false);
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 42 }),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as Response);
    });

    const { target, cmp, onClose } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-30';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onClose).toHaveBeenCalled();
    expect(location.pathname).toBe('/courses/algebra/runs/42');
    unmount(cmp);
  });

  it('surfaces API error as banner without closing', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'Title already exists in this course' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response));

    const { target, cmp, onClose } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-30';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(target.textContent).toContain('Title already exists');
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('versionLabel selects the NEWEST published, non-disabled version (not the oldest)', async () => {
    const oldVersion: Version = { id: 88, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false } as Version;
    const newVersion: Version = { id: 99, course_id: 1, created_at: '2026-02-01', published_at: '2026-02-02', is_disabled: false } as Version;
    // Backend returns versions DESC by created_at — simulate that ordering.
    const { target, cmp } = mountModal({ versions: [newVersion, oldVersion] });
    await settle();
    const versionRow = target.querySelector('.version-row');
    expect(versionRow?.textContent).toContain('v2 (2026-02-01)');
    expect(versionRow?.textContent).not.toContain('v1 (2026-01-01)');
    unmount(cmp);
  });
});
