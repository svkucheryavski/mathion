import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Keep the real defaultLandingPath; only navigate is observed.
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});

import NotFound from '../pages/NotFound.svelte';
import { session } from '../stores/session.svelte';
import { navigate } from '../lib/router.svelte';
import type { User } from '../lib/types';

function user(over: Partial<User> = {}): User {
  return {
    id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
    has_course_admin: false, has_run_teacher: false, ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  vi.mocked(navigate).mockClear();
  session.loading = false;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  session.user = null;
});

function render() {
  component = mount(NotFound, { target });
  flushSync();
  return target.querySelector<HTMLButtonElement>('.error-state .action button')!;
}

describe('NotFound (Polish 2 D53)', () => {
  it('is a page ErrorState: the h1, one line, an alert', () => {
    session.user = user();
    render();
    const card = target.querySelector('.page .error-state.page')!;
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.querySelector('h1.title')!.textContent).toBe('Page not found');
    expect(card.querySelector('.message')!.textContent).toBe('The address may be mistyped, or the page has moved.');
    expect(card.querySelectorAll('button').length).toBe(1);
  });

  it.each([
    ['a course admin', { has_course_admin: true, has_run_teacher: true }, 'Back to courses', '/courses'],
    ['a teacher only', { has_run_teacher: true }, 'Back to teaching', '/teaching'],
    ['a student', {}, 'Back to courses', '/courses'],
  ])('signed in as %s: the button names the start page', (_who, over, label, path) => {
    session.user = user(over);
    const btn = render();
    expect(btn.textContent!.trim()).toBe(label);
    expect(btn.classList.contains('secondary')).toBe(true);
    btn.click();
    expect(navigate).toHaveBeenCalledWith(path);
  });

  it('signed out: "Sign in" goes to /login (defaultLandingPath(null) would say /courses)', () => {
    session.user = null;
    const btn = render();
    expect(btn.textContent!.trim()).toBe('Sign in');
    btn.click();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
