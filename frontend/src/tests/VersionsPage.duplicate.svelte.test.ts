import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// vi.mock is hoisted above imports, so its factory must NOT reference a
// top-level `const` (TDZ error under Vitest 2). Mock inline with vi.fn(),
// then grab typed handles via vi.mocked AFTER the imports — the repo idiom
// (see RunDetailPage.publish.svelte.test.ts).
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, post: vi.fn() } };
});
// Stub the loader so the page's onMount $effect doesn't hit the network; we
// seed versionsPageState directly.
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...real, pushToast: vi.fn() };
});

import { navigate } from '../lib/router.svelte';
import { api } from '../lib/api';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import { pushToast } from '../stores/toasts.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import type { Version } from '../lib/types';

// Typed handles to the already-hoisted mock fns (used in assertions + reset).
const navigateMock = vi.mocked(navigate);
const postMock = vi.mocked(api.post);
const pushToastMock = vi.mocked(pushToast);

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 1, state: 'published', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: '',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  navigateMock.mockReset();
  postMock.mockReset();
  pushToastMock.mockReset();
  versionsPageState.course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
  versionsPageState.versions = [];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function clickButtonByText(root: HTMLElement, text: string) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
  flushSync();
}

describe('VersionsPage — Duplicate', () => {
  it('opens with a clamped prefill, POSTs the label, navigates on success', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    postMock.mockResolvedValue({ id: 42 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();

    // label renders in the row (spec frontend requirement)
    expect(target.querySelector('.vlabel')?.textContent).toBe('Fall');

    clickButtonByText(target, 'Duplicate');
    const input = target.querySelector<HTMLInputElement>('input.dup-label');
    if (!input) throw new Error('duplicate label input missing');
    expect(input.value).toBe('Copy of Fall');       // prefill
    expect(input.maxLength).toBe(200);

    input.value = 'My Copy';
    input.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create copy');
    await settle();

    expect(postMock).toHaveBeenCalledWith('/api/versions/7/duplicate', { label: 'My Copy' });
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/42');
  });

  it('on error shows a toast and does NOT navigate', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    postMock.mockRejectedValue(new Error('boom'));
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, 'Duplicate');
    clickButtonByText(target, 'Create copy');
    await settle();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('single-open: opening a second row does not keep the first open', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'A' }), mkVersion({ id: 8, label: 'B' })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    const dupButtons = [...target.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Duplicate');
    dupButtons[0].click(); flushSync();
    dupButtons[1].click(); flushSync();
    const inputs = target.querySelectorAll('input.dup-label');
    expect(inputs.length).toBe(1);                    // only one row open
    expect((inputs[0] as HTMLInputElement).value).toBe('Copy of B');
  });

  it('the + New version form sends the optional label', async () => {
    postMock.mockResolvedValue({ id: 99 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, '+ New version');
    const labelInput = target.querySelector<HTMLInputElement>('input.new-label');
    if (!labelInput) throw new Error('new-version label input missing');
    labelInput.value = 'First';
    labelInput.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create');
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/courses/1/versions', expect.objectContaining({ label: 'First' }));
  });

  it('clamps prefill to 200 chars when label exceeds 200', async () => {
    const longLabel = 'x'.repeat(300);
    versionsPageState.versions = [mkVersion({ id: 7, label: longLabel })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, 'Duplicate');
    const input = target.querySelector<HTMLInputElement>('input.dup-label');
    if (!input) throw new Error('duplicate label input missing');
    expect(input.value.length).toBe(200);
    expect(input.value).toBe(('Copy of ' + longLabel).slice(0, 200));
  });

  it('hides duplicate form when the row becomes disabled', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, is_disabled: false })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, 'Duplicate');
    expect(target.querySelector('input.dup-label')).not.toBeNull(); // form open
    // Simulate the row becoming disabled (e.g., after transition('disable'))
    versionsPageState.versions = [mkVersion({ id: 7, is_disabled: true })];
    flushSync();
    await settle();
    // Form must be gone
    expect(target.querySelector('input.dup-label')).toBeNull();
    // Confirm row rendered as disabled (Enable button present, not Duplicate)
    const enableBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enable');
    expect(enableBtn).toBeDefined();
  });
});
