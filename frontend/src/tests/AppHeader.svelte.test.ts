// AppHeader tests — slice A T7. Uses the project's established
// `mount/unmount/flushSync` pattern (see InlineConfirm.svelte.test.ts and
// RunAssetsTab.svelte.test.ts). We intentionally do NOT use
// @testing-library/svelte: it is not a project dependency and CLAUDE.md /
// MEMORY.md forbids adding new JS deps.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
}));

import AppHeader from '../components/chrome/AppHeader.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute } from '../lib/router.svelte';
import * as router from '../lib/router.svelte';
import { logout } from '../lib/auth.svelte';

const userBase = {
  id: 1,
  email: 'u@x',
  full_name: 'Sergey' as string | null,
  is_superuser: false,
  is_disabled: false,
  photo_url: null,
};

function setSession(extra: Partial<typeof userBase> & {
  has_course_admin: boolean;
  has_run_teacher: boolean;
}) {
  session.user = { ...userBase, ...extra };
  session.loading = false;
}

// Find a link/anchor by visible text under target. Returns null when absent.
function linkByText(target: HTMLElement, text: string): HTMLAnchorElement | null {
  const anchors = Array.from(target.querySelectorAll('a')) as HTMLAnchorElement[];
  return anchors.find((a) => (a.textContent ?? '').trim() === text) ?? null;
}

function nodeByText(target: HTMLElement, text: string): HTMLElement | null {
  const all = Array.from(target.querySelectorAll('*')) as HTMLElement[];
  return all.find((el) => {
    // pick the deepest node whose own direct text matches
    const direct = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent ?? '').trim())
      .join('');
    return direct === text;
  }) ?? null;
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  session.user = null;
  session.loading = false;
  currentRoute.path = '/courses';
  currentRoute.search = '';
  currentRoute.hash = '';
  vi.mocked(logout).mockClear();
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

describe('AppHeader', () => {
  it('renders both nav links when both flags are true', () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Authoring')).not.toBeNull();
    expect(linkByText(target, 'Teaching')).not.toBeNull();
  });

  it('renders only Authoring when only has_course_admin', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Authoring')).not.toBeNull();
    expect(linkByText(target, 'Teaching')).toBeNull();
  });

  it('renders only Teaching when only has_run_teacher', () => {
    setSession({ has_course_admin: false, has_run_teacher: true });
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Teaching')).not.toBeNull();
    expect(linkByText(target, 'Authoring')).toBeNull();
  });

  it('renders no nav links when both flags are false', () => {
    setSession({ has_course_admin: false, has_run_teacher: false });
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Authoring')).toBeNull();
    expect(linkByText(target, 'Teaching')).toBeNull();
  });

  it('marks Authoring active on deep /courses routes', () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    currentRoute.path = '/courses/foo/runs/bar';
    component = mount(AppHeader, { target });
    flushSync();
    const link = linkByText(target, 'Authoring');
    expect(link?.getAttribute('aria-current')).toBe('page');
  });

  it('marks Teaching active on deep /teaching routes (startsWith, not ===)', () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    currentRoute.path = '/teaching/runs/42';
    component = mount(AppHeader, { target });
    flushSync();
    const link = linkByText(target, 'Teaching');
    expect(link?.getAttribute('aria-current')).toBe('page');
  });

  it('updates aria-current reactively when currentRoute.path changes', () => {
    setSession({ has_course_admin: true, has_run_teacher: true });
    currentRoute.path = '/courses';
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Authoring')?.getAttribute('aria-current')).toBe('page');
    currentRoute.path = '/teaching';
    flushSync();
    expect(linkByText(target, 'Teaching')?.getAttribute('aria-current')).toBe('page');
    expect(linkByText(target, 'Authoring')?.getAttribute('aria-current')).toBeNull();
  });

  it('shows full_name when present', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    component = mount(AppHeader, { target });
    flushSync();
    expect(nodeByText(target, 'Sergey')).not.toBeNull();
  });

  it('falls back to email when full_name is null', () => {
    setSession({ full_name: null, has_course_admin: true, has_run_teacher: false });
    component = mount(AppHeader, { target });
    flushSync();
    expect(nodeByText(target, 'u@x')).not.toBeNull();
  });

  it('brand href is /courses for admin, /teaching for teacher-only, /courses for student/empty', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Mathion')?.getAttribute('href')).toBe('/courses');
    unmount(component);
    component = null;

    setSession({ has_course_admin: false, has_run_teacher: true });
    const target2 = document.createElement('div');
    document.body.appendChild(target2);
    const c2 = mount(AppHeader, { target: target2 });
    flushSync();
    expect(linkByText(target2, 'Mathion')?.getAttribute('href')).toBe('/teaching');
    unmount(c2);
    document.body.removeChild(target2);

    setSession({ has_course_admin: false, has_run_teacher: false });
    const target3 = document.createElement('div');
    document.body.appendChild(target3);
    const c3 = mount(AppHeader, { target: target3 });
    flushSync();
    expect(linkByText(target3, 'Mathion')?.getAttribute('href')).toBe('/courses');
    unmount(c3);
    document.body.removeChild(target3);
  });

  it('logout button awaits logout() BEFORE navigating to /login', async () => {
    // Lock the ordering: navigate must NOT be called until logout() resolves.
    // Without `await`, a `logout(); navigate('/login')` regression would
    // call navigate synchronously and this test would catch it.
    setSession({ has_course_admin: true, has_run_teacher: false });
    let resolveLogout: () => void = () => {};
    const logoutPromise = new Promise<void>((res) => { resolveLogout = res; });
    vi.mocked(logout).mockImplementationOnce(() => logoutPromise);
    const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
    component = mount(AppHeader, { target });
    flushSync();
    const buttons = Array.from(target.querySelectorAll('button')) as HTMLButtonElement[];
    const logoutBtn = buttons.find((b) => (b.textContent ?? '').trim() === 'Logout');
    expect(logoutBtn).toBeDefined();
    logoutBtn!.click();
    // Drain any synchronous microtasks; logout has NOT resolved yet, so
    // navigate must not have fired if the component is awaiting.
    for (let i = 0; i < 8; i++) await Promise.resolve();
    flushSync();
    expect(logout).toHaveBeenCalled();
    expect(navSpy).not.toHaveBeenCalled();
    // Now resolve logout and drain again; navigate should fire after the await.
    resolveLogout();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    flushSync();
    expect(navSpy).toHaveBeenCalledWith('/login');
  });
});
