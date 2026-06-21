import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CourseList from '../pages/CourseList.svelte';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve([]),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

let target: HTMLDivElement | null = null;
let cmp: unknown = null;
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  if (target) { target.remove(); target = null; }
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

describe('CourseList header (mp-followup #2)', () => {
  it('renders the h1 heading and no inline user/logout cluster (AppHeader covers it globally)', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    cmp = mount(CourseList, { target });
    await settle();

    const h1 = target.querySelector('h1');
    if (!h1) throw new Error('h1 not found');
    expect(h1.textContent).toBe('Your courses');

    expect(target.textContent ?? '').not.toContain('Sign out');
    expect(target.querySelector('.user')).toBeNull();
  });
});
