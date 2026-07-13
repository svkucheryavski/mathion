import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserDashboard from '../pages/superuser/SuperuserDashboard.svelte';
import * as router from '../lib/router.svelte';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function mockFetch(status: number, body: unknown) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(status, body));
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
const ZEROS = { total_users: 0, total_courses: 0, storage_bytes: 0, active_users_24h: 0, active_users_7d: 0 };

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  sessionStorage.clear();
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

it('fetches and renders five stat cards with formatted storage', async () => {
  vi.stubGlobal('fetch', mockFetch(200, {
    total_users: 3, total_courses: 2, storage_bytes: 1500, active_users_24h: 1, active_users_7d: 2,
  }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok' } });
  await settle();
  const text = target.textContent ?? '';
  expect(text).toContain('3');
  expect(text).toContain('2');
  expect(text).toContain('1.5 kB');   // formatFileSize(1500)
});

it('threads the token into the stats URL and skips the global auth redirect', async () => {
  const f = mockFetch(200, ZEROS);
  vi.stubGlobal('fetch', f);
  component = mount(SuperuserDashboard, { target, props: { token: 'abc' } });
  await settle();
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/abc/stats');
});

it('renders a panel-specific expired state on 404 (not generic NotFound)', async () => {
  vi.stubGlobal('fetch', mockFetch(404, { detail: 'Not Found' }));
  component = mount(SuperuserDashboard, { target, props: { token: 'bad' } });
  await settle();
  expect(target.textContent ?? '').toMatch(/not valid or has expired/i);
});

it('on 401 stashes the panel path in sessionStorage and navigates to /login', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  router.currentRoute.path = '/superuser/tok401';
  vi.stubGlobal('fetch', mockFetch(401, { detail: 'Not authenticated' }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok401' } });
  await settle();
  expect(sessionStorage.getItem('superuser_return_path')).toBe('/superuser/tok401');
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
  // token never placed in the navigation URL
  expect(String(navSpy.mock.calls[0][0])).toBe('/login');
});
