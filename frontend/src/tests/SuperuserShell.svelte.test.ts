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

it('renders nav + sign-out and mounts the dashboard', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  expect(target.textContent ?? '').toContain('Dashboard');
  expect(buttonByText(target, 'Sign out')).not.toBeNull();
});

it('sign-out logs out then navigates to /login (not the panel path)', async () => {
  const auth = await import('../lib/auth.svelte');
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  vi.stubGlobal('fetch', dispatchFetch());
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
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  vi.stubGlobal('fetch', dispatchFetch());
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  buttonByText(target, 'Sign out')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  expect(auth.logout).toHaveBeenCalled();
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
});

it('suppresses AppHeader on /superuser paths but shows it on /courses', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  vi.stubGlobal('fetch', dispatchFetch());
  session.user = {
    id: 1, email: 'z@x.com', full_name: 'ZED_HEADER_NAME', is_superuser: true,
    is_disabled: false, photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
  session.loading = false;

  // On a panel path, AppHeader (which renders the display name) is suppressed.
  router.currentRoute.path = '/superuser/tok';
  component = mount(App, { target });
  await settle();
  expect(target.textContent ?? '').not.toContain('ZED_HEADER_NAME');
  unmount(component); component = null;
  navSpy.mockClear();

  // On /courses, AppHeader renders the display name.
  router.currentRoute.path = '/courses';
  component = mount(App, { target });
  await settle();
  expect(target.textContent ?? '').toContain('ZED_HEADER_NAME');
});
