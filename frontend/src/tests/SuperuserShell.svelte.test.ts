import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserShell from '../pages/superuser/SuperuserShell.svelte';
import App from '../App.svelte';
import * as router from '../lib/router.svelte';
import { session } from '../stores/session.svelte';

vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
  getAuthConfig: vi.fn(async () => ({ send_pin_enabled: true })),
  bootstrapSession: vi.fn(async () => {}),
  requestPin: vi.fn(async () => {}),
  verifyPin: vi.fn(async () => ({})),
}));

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function dispatchFetch() {
  return vi.fn(async (url: string) => {
    const s = String(url);
    if (s.includes('/api/superuser/')) {
      return jsonResponse(200, { total_users: 0, total_courses: 0, storage_bytes: 0, active_users_24h: 0, active_users_7d: 0 });
    }
    return jsonResponse(200, []);
  });
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
function buttonByText(t: HTMLElement, text: string): HTMLButtonElement | null {
  return (Array.from(t.querySelectorAll('button')) as HTMLButtonElement[])
    .find((b) => (b.textContent ?? '').trim() === text) ?? null;
}

function signIn() {
  session.user = {
    id: 1, email: 'su@x.com', full_name: null, is_superuser: true,
    is_disabled: false, photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  session.user = null;
  session.loading = false;
  router.currentRoute.path = '/';
  router.currentRoute.search = '';
  router.currentRoute.hash = '';
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

it('renders the bar with Sign out and mounts the dashboard in the main area', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  signIn();
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  // The dashboard itself mounted (its root and its cards), not just the shell's h1.
  expect(target.querySelector('main.su-main .dashboard .cards')).not.toBeNull();
  expect(buttonByText(target, 'Sign out')).not.toBeNull();
});

it('with no session (an expired link is checked before the session) the bar has no name and no Sign out', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { detail: 'Not Found' })));
  component = mount(SuperuserShell, { target, props: { token: 'expired' } });
  await settle();
  expect(target.textContent ?? '').toMatch(/not valid or has expired/i);
  expect(target.querySelector('header.su-header .name')).toBeNull();
  expect(buttonByText(target, 'Sign out')).toBeNull();
  // The brand and the label still show.
  expect(target.querySelector('header.su-header .su-label')?.textContent?.trim()).toBe('Superuser');
});

it('sign-out logs out then navigates to /login (not the panel path)', async () => {
  const auth = await import('../lib/auth.svelte');
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  vi.stubGlobal('fetch', dispatchFetch());
  signIn();
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  buttonByText(target, 'Sign out')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  expect(auth.logout).toHaveBeenCalled();
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
});

it('navigates to /login even when logout() rejects (token URL never lingers)', async () => {
  const auth = await import('../lib/auth.svelte');
  (auth.logout as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  vi.stubGlobal('fetch', dispatchFetch());
  signIn();
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  buttonByText(target, 'Sign out')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  expect(auth.logout).toHaveBeenCalled();
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
});

it('suppresses AppHeader on /superuser paths but shows it on /courses', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  vi.stubGlobal('fetch', dispatchFetch());
  session.user = {
    id: 1, email: 'z@x.com', full_name: 'ZED_HEADER_NAME', is_superuser: true,
    is_disabled: false, photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
  session.loading = false;

  // On a panel path, AppHeader is suppressed; the panel's own bar shows instead
  // (it renders the display name too, so look for the bars, not the name).
  router.currentRoute.path = '/superuser/tok';
  component = mount(App, { target });
  await settle();
  expect(target.querySelector('header.app-header')).toBeNull();
  expect(target.querySelectorAll('header.su-header')).toHaveLength(1);
  unmount(component); component = null;
  navSpy.mockClear();

  // On /courses, AppHeader renders with the display name.
  router.currentRoute.path = '/courses';
  component = mount(App, { target });
  await settle();
  expect(target.querySelector('header.app-header')?.textContent ?? '').toContain('ZED_HEADER_NAME');
  expect(target.querySelector('header.su-header')).toBeNull();
});

it('the bar is the main site look: logo + wordmark, a Superuser label, the name, a ghost Sign out', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  session.user = {
    id: 1, email: 'su@x.com', full_name: 'Sue Perr', is_superuser: true,
    is_disabled: false, photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  const header = target.querySelector('header.su-header')!;
  expect(header).not.toBeNull();
  expect(header.querySelector('.brand svg')).not.toBeNull();
  expect(header.querySelector('.brand .wordmark')?.textContent).toBe('Mathion');
  expect(header.querySelector('.su-label')?.textContent?.trim()).toBe('Superuser');
  expect(header.querySelector('.name')?.textContent).toBe('Sue Perr');
  const signOut = buttonByText(target, 'Sign out')!;
  expect(signOut.dataset.variant).toBe('ghost');
  expect(header.contains(signOut)).toBe(true);
});

it('the bar shows the email when the superuser has no full name', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  session.user = {
    id: 1, email: 'su@x.com', full_name: null, is_superuser: true,
    is_disabled: false, photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  expect(target.querySelector('header.su-header .name')?.textContent).toBe('su@x.com');
});

it('the bar has no links, so nothing leads away from the panel', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  signIn(); // so the name and Sign out render and are covered too
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  expect(target.querySelector('header.su-header .name')).not.toBeNull();
  expect(target.querySelectorAll('header.su-header a')).toHaveLength(0);
});

it('the page has a Dashboard heading above the cards, in the page column', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  const main = target.querySelector('main.su-main')!;
  expect(main.querySelector('h1')?.textContent).toBe('Dashboard');
  // The heading comes before the dashboard's cards.
  const h1 = main.querySelector('h1')!;
  const cards = main.querySelector('.cards')!;
  expect(h1.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
