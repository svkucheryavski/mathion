import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import App from '../App.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';

// Branding D11: "Powered by Mathion" after the page, on every page but the
// item player, and not while the session loads.
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

async function open(path: string, user: typeof STUDENT | null) {
  session.user = user;
  go(path);
  component = mount(App, { target });
  await settle();
}

const footer = () => target.querySelector('footer.powered');

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
  session.loading = false;
});

describe('App: the "Powered by Mathion" footer (Branding D11)', () => {
  it('shows on the sign-in page', async () => {
    await open('/login', null);
    expect(footer()!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Powered by Mathion');
  });

  it('shows on a signed-in page, after the page', async () => {
    await open('/courses', STUDENT);
    const shell = target.querySelector('.shell')!;
    expect(shell.lastElementChild).toBe(footer());
    expect(footer()!.previousElementSibling!.classList.contains('app-page')).toBe(true);
  });

  it('shows on the not-found page', async () => {
    await open('/no/such/page', STUDENT);
    expect(target.querySelector('.error-state')).not.toBeNull();
    expect(footer()).not.toBeNull();
  });

  it('is left out on the item player', async () => {
    await open('/courses/calc/seq/5', STUDENT);
    expect(footer()).toBeNull();
  });

  it('is left out while the session loads', async () => {
    session.loading = true;
    await open('/courses', null);
    expect(target.querySelector('.loading')).not.toBeNull();
    expect(footer()).toBeNull();
  });

  it('the link opens mathion.org in a new tab, with noopener noreferrer', async () => {
    await open('/login', null);
    const a = footer()!.querySelector('a')!;
    expect(a.textContent).toBe('Mathion');
    expect(a.getAttribute('href')).toBe('https://mathion.org');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
