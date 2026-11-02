import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import App from '../App.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';

// An unknown address renders NotFound through App. Only fetch is stubbed, and it
// never resolves, so a page behind a click stays in its loading state.
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
const STUDENT = {
  id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
  has_course_admin: false, has_run_teacher: false,
};

function go(path: string) {
  history.replaceState(null, '', path);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}

beforeEach(() => {
  __resetGuardsForTests();
  globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  target = document.createElement('div');
  document.body.appendChild(target);
  session.loading = false;
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  globalThis.fetch = originalFetch;
  session.user = null;
});

describe('App: an unknown address (Polish 2 D53)', () => {
  it('signed in: NotFound under the header', async () => {
    session.user = STUDENT;
    go('/no/such/page');
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('.app-header')).not.toBeNull();
    expect(target.querySelector('.error-state h1.title')!.textContent).toBe('Page not found');
    expect(location.pathname).toBe('/no/such/page');
  });

  it('signed out: NotFound with "Sign in", no header, no redirect', async () => {
    session.user = null;
    go('/no/such/page');
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('.app-header')).toBeNull();
    expect(target.querySelector('.error-state .action button')!.textContent!.trim()).toBe('Sign in');
    expect(location.pathname).toBe('/no/such/page');
  });

  it('an unmatched /superuser/... path: NotFound without the header, and the button still works', async () => {
    session.user = STUDENT;
    go('/superuser/abc/def');
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('.app-header')).toBeNull();
    const btn = target.querySelector<HTMLButtonElement>('.error-state .action button')!;
    expect(btn.textContent!.trim()).toBe('Back to courses');
    btn.click();
    await settle();
    expect(location.pathname).toBe('/courses');
  });
});
