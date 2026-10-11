import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import App from '../App.svelte';
import { session } from '../stores/session.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';

// Review Focus 2: an old bookmark while signed out. App sends the visitor to
// login with `next`; RunsRedirect must not move the login page; after login
// the old address lands on the new one. Only fetch is stubbed, and it never
// resolves, so the pages behind the redirect stay in their loading state.
vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
  getAuthConfig: vi.fn(async () => ({ send_pin_enabled: true })),
  bootstrapSession: vi.fn(async () => {}),
  requestPin: vi.fn(async () => {}),
  verifyPin: vi.fn(async () => ({})),
}));

const originalFetch = globalThis.fetch;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

beforeEach(() => {
  __resetGuardsForTests();
  globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  globalThis.fetch = originalFetch;
  session.user = null;
});

describe('App: an old run address while signed out', () => {
  it('goes through login with one ?next=, then lands on the new address', async () => {
    session.user = null;
    session.loading = false;
    history.replaceState(null, '', '/courses/s/runs/8?tab=groups#x');
    currentRoute.path = location.pathname;
    currentRoute.search = location.search;
    currentRoute.hash = location.hash;
    component = mount(App, { target });
    await settle();
    await settle();
    expect(location.pathname).toBe('/login');
    expect(new URLSearchParams(location.search).getAll('next')).toEqual(['/courses/s/runs/8?tab=groups#x']);

    // Login succeeds: the session gains a user and Login navigates to `next`.
    session.user = {
      id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
      has_course_admin: false, has_run_teacher: true,
    };
    await navigate('/courses/s/runs/8?tab=groups#x', { replace: true });
    await settle();
    await settle();
    expect(location.pathname + location.search + location.hash).toBe('/teaching/s/runs/8?tab=groups#x');
  });
});
