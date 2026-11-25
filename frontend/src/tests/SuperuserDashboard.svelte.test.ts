import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import SuperuserDashboard from '../pages/superuser/SuperuserDashboard.svelte';
import * as router from '../lib/router.svelte';
import { SetupStore } from '../lib/setupStore.svelte';
import type { PanelSetup } from '../lib/setup';
import { settle } from './support/settle';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function mockFetch(status: number, body: unknown) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(status, body));
}
const ZEROS = { total_users: 0, total_courses: 0, storage_bytes: 0, active_users_24h: 0, active_users_7d: 0 };

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
let setup: SetupStore;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  sessionStorage.clear();
  setup = new SetupStore('tok', vi.fn());
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  setup.dispose();
  vi.restoreAllMocks();
});

it('fetches and renders five stat cards with formatted storage', async () => {
  vi.stubGlobal('fetch', mockFetch(200, {
    total_users: 3, total_courses: 2, storage_bytes: 1500, active_users_24h: 1, active_users_7d: 2,
  }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  const text = target.textContent ?? '';
  expect(text).toContain('3');
  expect(text).toContain('2');
  expect(text).toContain('1.5 kB');   // formatFileSize(1500)
});

// The user's call (2026-11-13): 3.5 GB no longer reads "3584.0 MB".
it('shows a storage of several GB in GB', async () => {
  vi.stubGlobal('fetch', mockFetch(200, {
    total_users: 3, total_courses: 2, storage_bytes: 3.5 * 1024 ** 3, active_users_24h: 1, active_users_7d: 2,
  }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  expect(target.textContent).toContain('3.5 GB');
});

// The user's call (2026-11-13): the cards group counts like the Users page.
it('groups big counts on the cards: "4,213"', async () => {
  vi.stubGlobal('fetch', mockFetch(200, {
    total_users: 4213, total_courses: 1050, storage_bytes: 0, active_users_24h: 1234, active_users_7d: 2345,
  }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  const value = (label: string) => [...target.querySelectorAll('.card')]
    .find((c) => c.querySelector('.label')?.textContent === label)?.querySelector('.value')?.textContent;
  expect(['Users', 'Courses', 'Active 24h', 'Active 7d'].map(value)).toEqual(['4,213', '1,050', '1,234', '2,345']);
});

it('threads the token into the stats URL and skips the global auth redirect', async () => {
  const f = mockFetch(200, ZEROS);
  vi.stubGlobal('fetch', f);
  component = mount(SuperuserDashboard, { target, props: { token: 'abc', onAuth: vi.fn(), setup } });
  await settle();
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/abc/stats');
});

it('hands a 404 to onAuth("expired") and shows nothing of its own', async () => {
  const onAuth = vi.fn();
  vi.stubGlobal('fetch', mockFetch(404, { detail: 'Not Found' }));
  component = mount(SuperuserDashboard, { target, props: { token: 'bad', onAuth, setup } });
  await settle();
  expect(onAuth).toHaveBeenCalledWith('expired');
  expect(target.querySelector('.panel-error')).toBeNull();
  expect(target.querySelector('.cards')).toBeNull();
});

it('hands a 401 to onAuth("signin") and does not navigate itself', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  const onAuth = vi.fn();
  vi.stubGlobal('fetch', mockFetch(401, { detail: 'Not authenticated' }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok401', onAuth, setup } });
  await settle();
  expect(onAuth).toHaveBeenCalledWith('signin');
  expect(navSpy).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('superuser_return_path')).toBeNull();
});

it("shows another error's message", async () => {
  vi.stubGlobal('fetch', mockFetch(500, { detail: 'Internal Server Error' }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  expect(target.querySelector('.panel-error')?.textContent).toBe('Internal Server Error');
});

// --- Set up D2, D12: the Finish setting up card's place ---

function setupState(done: boolean[]): PanelSetup {
  return {
    wizard_on: false, step: 1,
    steps: done.map((d) => ({ passed: true, done: d, reason: d ? null : 'Email is off.' })),
    course: null, course_without_admin: null, email_set_up: false, pin_minutes: 10, defaults_in_use: false,
  };
}

it('the Finish setting up card sits above the stat cards', async () => {
  vi.stubGlobal('fetch', mockFetch(200, ZEROS));
  setup.state = setupState([false, true, true, true]);
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  const card = target.querySelector('.fc-card')!;
  expect(card.textContent).toContain('Finish setting up');
  expect(card.compareDocumentPosition(target.querySelector('.cards')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('a failed first state read: the error state with Try again where the card goes; the stat cards still show', async () => {
  vi.stubGlobal('fetch', mockFetch(200, ZEROS));
  setup.failed = true;
  setup.error = 'Boom.';
  const read = vi.spyOn(setup, 'read').mockResolvedValue(null);
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  const err = target.querySelector('.error-state')!;
  expect(err.textContent).toContain('Could not load set up.');
  expect(err.textContent).toContain('Boom.');
  expect(target.querySelector('.fc-card')).toBeNull();
  expect(target.querySelectorAll('.cards .card')).toHaveLength(5);
  expect(err.compareDocumentPosition(target.querySelector('.cards')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  [...err.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
  expect(read).toHaveBeenCalledTimes(1);
});

it('Try again shows that it is reading and ignores presses until the read answers', async () => {
  let answer!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/setup')
    ? new Promise<Response>((r) => { answer = r; })
    : jsonResponse(200, ZEROS))));
  setup.failed = true;
  setup.error = 'Boom.';
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  const again = () => [...target.querySelectorAll('.error-state button')].find((b) => b.textContent?.trim() === 'Try again') as HTMLButtonElement;
  const read = vi.spyOn(setup, 'read');
  again().click();
  await settle();
  expect(again().getAttribute('aria-busy')).toBe('true');
  expect(again().getAttribute('aria-disabled')).toBe('true');
  again().click();
  expect(read).toHaveBeenCalledTimes(1);
  answer(jsonResponse(500, { detail: 'Boom.' }));
  await settle();
  expect(again().getAttribute('aria-busy')).toBeNull();
  expect(again().getAttribute('aria-disabled')).toBeNull();
  again().click();
  expect(read).toHaveBeenCalledTimes(2);
});

it('no card and no error while every step is done', async () => {
  vi.stubGlobal('fetch', mockFetch(200, ZEROS));
  setup.state = setupState([true, true, true, true]);
  component = mount(SuperuserDashboard, { target, props: { token: 'tok', onAuth: vi.fn(), setup } });
  await settle();
  expect(target.querySelector('.fc-card')).toBeNull();
  expect(target.querySelector('.error-state')).toBeNull();
});
