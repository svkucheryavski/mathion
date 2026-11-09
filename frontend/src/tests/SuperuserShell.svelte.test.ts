import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserShell from '../pages/superuser/SuperuserShell.svelte';
import App from '../App.svelte';
import * as router from '../lib/router.svelte';
import { session } from '../stores/session.svelte';
import * as dirtyMod from '../lib/dirtyRegistry.svelte';
import { SETUP_MARK, type PanelSetup } from '../lib/setup';

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
    if (s.includes('/api/superuser/') && s.endsWith('/setup')) {
      setupReads++;
      return setupAnswer ? setupAnswer() : jsonResponse(200, setupState);
    }
    if (s.includes('/api/superuser/') && s.includes('/users')) {
      return jsonResponse(200, { users: [], total: 0, counts: { all: 0, admins: 0, teachers: 0, students: 0, disabled: 0 } });
    }
    if (s.includes('/api/superuser/') && s.includes('/courses')) return jsonResponse(200, []);
    if (s.includes('/api/superuser/') && s.includes('/settings')) return jsonResponse(200, SETTINGS);
    if (s.includes('/api/superuser/') && s.includes('/branding')) return jsonResponse(200, BRANDING);
    if (s.includes('/api/superuser/')) {
      return jsonResponse(200, { total_users: 0, total_courses: 0, storage_bytes: 0, active_users_24h: 0, active_users_7d: 0 });
    }
    return jsonResponse(200, []);
  });
}
// Set up D13: the shell's one read. Over by default, as on an established site.
function setupOf(on: boolean): PanelSetup {
  return {
    wizard_on: on, step: 1,
    steps: [0, 1, 2, 3].map(() => ({ passed: false, done: false, reason: null })),
    course: null, course_without_admin: null, email_set_up: false, pin_minutes: 10, defaults_in_use: true,
  };
}
let setupState: PanelSetup = setupOf(false);
let setupAnswer: (() => Promise<Response> | Response) | null = null;
let setupReads = 0;
const BRANDING = {
  name: 'Mathion', logo: null, icon: null,
  colours: { vars: [], changes: {}, warnings: [] },
  public: { name: 'Mathion', logo: null, icon: null, theme: null },
};
const SETTINGS = {
  email: {
    on: false, host: '', port: 587, encryption: 'starttls', skip_cert_check: false, username: '',
    password_saved: false, password_unreadable: false, from_address: '', dev_mode: null, card_test: null, failing: null,
  },
  limits: { max_file_mb: 20, max_total_mb: 500 },
  sign_in: { pin_minutes: 10, pin_requests_per_hour: 3, pin_failures_per_hour: 5, longest_sign_in_days: 30 },
  site: { base_url: 'https://learn.uni.dk' },
};
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
function buttonByText(t: HTMLElement, text: string): HTMLButtonElement | null {
  return (Array.from(t.querySelectorAll('button')) as HTMLButtonElement[])
    .find((b) => (b.textContent ?? '').trim() === text) ?? null;
}

function pills(): HTMLAnchorElement[] {
  return [...target.querySelectorAll<HTMLAnchorElement>('header.su-header nav a')];
}
function pillTexts(): string[] {
  return pills().map((a) => (a.textContent ?? '').trim());
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
  setupState = setupOf(false);
  setupAnswer = null;
  setupReads = 0;
  sessionStorage.clear();
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
  // The brand and the pills still show; the page itself does not.
  expect(pillTexts()).toEqual(['Dashboard', 'Users', 'Courses', 'Settings', 'Branding']);
  expect(target.querySelector('.dashboard')).toBeNull();
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

it('the bar is the main site look: logo + wordmark, the five pills, the name, a ghost Sign out', async () => {
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
  expect(header.querySelector('.brand .wordmark-header')?.textContent).toBe('Mathion');
  expect(pillTexts()).toEqual(['Dashboard', 'Users', 'Courses', 'Settings', 'Branding']);
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

it('the bar has no links outside the panel, so nothing leads away from it', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  signIn(); // so the name and Sign out render and are covered too
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  expect(target.querySelector('header.su-header .name')).not.toBeNull();
  const hrefs = [...target.querySelectorAll('header.su-header a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toHaveLength(5);
  for (const h of hrefs) expect(h === '/superuser/tok' || h!.startsWith('/superuser/tok/')).toBe(true);
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

it('the pills are same-tab links to the five pages; the current one is marked (D23, Branding D1)', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T/users';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  const nav = target.querySelector('header.su-header nav')!;
  expect(nav.getAttribute('aria-label')).toBe('Superuser panel');
  expect(pills().map((a) => a.getAttribute('href'))).toEqual(['/superuser/T', '/superuser/T/users', '/superuser/T/courses', '/superuser/T/settings', '/superuser/T/branding']);
  expect(pills().map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null, null, null]);
  for (const a of pills()) expect(a.hasAttribute('target')).toBe(false);
});

it('a plain click on a pill navigates in the app; a modifier click is left to the browser', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  const courses = pills()[2];
  const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  courses.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(true);
  expect(navSpy).toHaveBeenCalledWith('/superuser/T/courses');
  navSpy.mockClear();
  let prevented: boolean | null = null;
  // Runs after the app's delegated handler; it records, then blocks jsdom's own navigation.
  const probe = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
  window.addEventListener('click', probe);
  courses.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true }));
  window.removeEventListener('click', probe);
  expect(prevented).toBe(false);
  expect(navSpy).not.toHaveBeenCalled();
});

it('the heading and the page follow the route', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(target.querySelector('main.su-main h1')?.textContent).toBe('Dashboard');
  expect(target.querySelector('.dashboard')).not.toBeNull();
  router.currentRoute.path = '/superuser/T/users';
  await settle();
  expect(target.querySelector('main.su-main h1')?.textContent).toBe('Users');
  // The page itself mounted, not a placeholder.
  expect(target.querySelector('main.su-main .u-count')?.textContent).toBe('No accounts');
  expect(target.querySelector('.dashboard')).toBeNull();
  expect(pills()[1].getAttribute('aria-current')).toBe('page');
  router.currentRoute.path = '/superuser/T/courses';
  await settle();
  expect(target.querySelector('main.su-main h1')?.textContent).toBe('Courses');
  expect(target.querySelector('main.su-main')?.textContent).toContain('No courses yet.');
  expect(pills()[2].getAttribute('aria-current')).toBe('page');
  router.currentRoute.path = '/superuser/T/settings';
  await settle();
  expect(target.querySelector('main.su-main h1')?.textContent).toBe('Settings');
  // The Settings page itself mounted: its four cards.
  expect([...target.querySelectorAll('main.su-main section.s-card h2')].map((h) => h.textContent))
    .toEqual(['Email', 'File limits', 'Sign-in', 'Site']);
  expect(pills()[3].getAttribute('aria-current')).toBe('page');
  router.currentRoute.path = '/superuser/T/branding';
  await settle();
  expect(target.querySelector('main.su-main h1')?.textContent).toBe('Branding');
  // The Branding page itself mounted: its four cards (Branding D1).
  expect([...target.querySelectorAll('main.su-main section.b-card h2')].map((h) => h.textContent))
    .toEqual(['Site name', 'Logo', 'Tab icon', 'Colours']);
  expect(pills()[4].getAttribute('aria-current')).toBe('page');
});

it("a 404 from a page's load shows the expired-link text instead of the page", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { detail: 'Not Found' })));
  signIn();
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  const expired = target.querySelector('main.su-main .su-expired');
  expect(expired?.textContent ?? '').toMatch(/This panel link is not valid or has expired/);
  expect(expired?.textContent ?? '').toContain('activate');
  expect(target.querySelector('.dashboard')).toBeNull();
});

it('a 401 keeps the panel path for after sign-in and goes to /login', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  sessionStorage.clear();
  router.currentRoute.path = '/superuser/T401';
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { detail: 'Not authenticated' })));
  component = mount(SuperuserShell, { target, props: { token: 'T401' } });
  await settle();
  expect(sessionStorage.getItem('superuser_return_path')).toBe('/superuser/T401');
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
  expect(String(navSpy.mock.calls[0][0])).toBe('/login');
});

// --- Set up D1, D2, D3, D13 ---

it("opens on Set up when on, from the panel's own address, and marks the tab", async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  setupState = setupOf(true);
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(navSpy).toHaveBeenCalledWith('/superuser/T/setup', { replace: true });
  expect(sessionStorage.getItem(SETUP_MARK)).toBe('T');
  expect(pillTexts()).toEqual(['Set up', 'Dashboard', 'Users', 'Courses', 'Settings', 'Branding']);
  expect(pills()[0].getAttribute('href')).toBe('/superuser/T/setup');
});

it('shows only its bar until the first read answers', async () => {
  let answer!: (r: Response) => void;
  setupAnswer = () => new Promise<Response>((r) => { answer = r; });
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(target.querySelector('header.su-header')).not.toBeNull();
  expect(target.querySelector('main.su-main')?.children.length).toBe(0);
  answer(jsonResponse(200, setupOf(false)));
  await settle();
  expect(target.querySelector('.dashboard')).not.toBeNull();
});

it('reload of Dashboard stays when marked', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  sessionStorage.setItem(SETUP_MARK, 'T');
  setupState = setupOf(true);
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(navSpy).not.toHaveBeenCalled();
  expect(target.querySelector('.dashboard')).not.toBeNull();
  expect(pillTexts()[0]).toBe('Set up');
});

it("a mark for another link's token counts as none", async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  sessionStorage.setItem(SETUP_MARK, 'OLD');
  setupState = setupOf(true);
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(navSpy).toHaveBeenCalledWith('/superuser/T/setup', { replace: true });
});

it('another page marks the tab but stays put', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  setupState = setupOf(true);
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T/users';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(navSpy).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(SETUP_MARK)).toBe('T');
});

it('pill first while on, gone after over once you leave Set up', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  setupState = setupOf(true);
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T/users';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(pillTexts()[0]).toBe('Set up');
  // Entered while the shell holds "on": the page opens; a later "over" keeps it (D1, D13).
  setupState = setupOf(false);
  router.currentRoute.path = '/superuser/T/setup';
  await settle();
  expect(target.querySelector('main.su-main h1')?.textContent).toBe('Set up your site');
  expect(pillTexts()[0]).toBe('Set up');
  expect(pills()[0].getAttribute('aria-current')).toBe('page');
  expect(navSpy).not.toHaveBeenCalled();
  router.currentRoute.path = '/superuser/T';
  await settle();
  expect(pillTexts()).toEqual(['Dashboard', 'Users', 'Courses', 'Settings', 'Branding']);
});

it("setup over on entry replaces the address with the panel's own", async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  sessionStorage.setItem(SETUP_MARK, 'T');
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T/setup';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(navSpy).toHaveBeenCalledWith('/superuser/T', { replace: true });
  expect(sessionStorage.getItem(SETUP_MARK)).toBe('T');   // only "on" writes it, only sign-out clears it
});

it('a failed first read: the Dashboard, no pill, no redirect; on Set up the error state', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  setupAnswer = () => jsonResponse(500, { detail: 'Boom.' });
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(navSpy).not.toHaveBeenCalled();
  expect(target.querySelector('.dashboard')).not.toBeNull();
  expect(pillTexts()[0]).toBe('Dashboard');
  expect(sessionStorage.getItem(SETUP_MARK)).toBeNull();
  router.currentRoute.path = '/superuser/T/setup';
  await settle();
  const err = target.querySelector('main.su-main .error-state');
  expect(err?.textContent ?? '').toContain('Could not load set up.');
  expect(err?.textContent ?? '').toContain('Boom.');
  // Try again reads once more; over then leaves for the Dashboard (D1).
  setupAnswer = null;
  buttonByText(target, 'Try again')!.click();
  await settle();
  expect(navSpy).toHaveBeenCalledWith('/superuser/T', { replace: true });
});

it('pill click never redirects', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  let answer!: (r: Response) => void;
  setupAnswer = () => new Promise<Response>((r) => { answer = r; });
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  pills()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  expect(navSpy).toHaveBeenCalledWith('/superuser/T');
  navSpy.mockClear();
  answer(jsonResponse(200, setupOf(true)));
  await settle();
  expect(navSpy).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(SETUP_MARK)).toBe('T');
});

it('re-reads on page change', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(setupReads).toBe(1);
  router.currentRoute.path = '/superuser/T/users';
  await settle();
  expect(setupReads).toBe(2);
  router.currentRoute.path = '/superuser/T/courses';
  await settle();
  expect(setupReads).toBe(3);
});

it('expired view clears the mark', async () => {
  sessionStorage.setItem(SETUP_MARK, 'T');
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { detail: 'Not Found' })));
  router.currentRoute.path = '/superuser/T/setup';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  expect(target.querySelector('main.su-main h1')?.textContent).toBe('Set up');
  expect(target.querySelector('.su-expired')).not.toBeNull();
  expect(sessionStorage.getItem(SETUP_MARK)).toBeNull();
});

it('sign out asks when dirty, and clears the mark', async () => {
  const auth = await import('../lib/auth.svelte');
  (auth.logout as ReturnType<typeof vi.fn>).mockClear();
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  const real = dirtyMod.createDirtyRegistry;
  let registry!: dirtyMod.DirtyRegistry;
  vi.spyOn(dirtyMod, 'createDirtyRegistry').mockImplementation(() => (registry = real()));
  sessionStorage.setItem(SETUP_MARK, 'T');
  vi.stubGlobal('fetch', dispatchFetch());
  signIn();
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  const discard = vi.fn();
  registry.register({ isDirty: true, discard });
  buttonByText(target, 'Sign out')!.click();
  await settle();
  expect(target.querySelector('.inline-confirm')?.textContent ?? '').toContain('Discard unsaved changes and continue?');
  expect(auth.logout).not.toHaveBeenCalled();
  // Cancel stays.
  (target.querySelector('.inline-confirm button.cancel') as HTMLButtonElement).click();
  await settle();
  expect(target.querySelector('.inline-confirm')).toBeNull();
  expect(auth.logout).not.toHaveBeenCalled();
  // Discard signs out.
  buttonByText(target, 'Sign out')!.click();
  await settle();
  (target.querySelector('.inline-confirm button.confirm') as HTMLButtonElement).click();
  await settle();
  expect(discard).toHaveBeenCalled();
  expect(auth.logout).toHaveBeenCalled();
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
  expect(sessionStorage.getItem(SETUP_MARK)).toBeNull();
});

it('a pill click while dirty asks through the guard', async () => {
  const real = dirtyMod.createDirtyRegistry;
  let registry!: dirtyMod.DirtyRegistry;
  vi.spyOn(dirtyMod, 'createDirtyRegistry').mockImplementation(() => (registry = real()));
  vi.stubGlobal('fetch', dispatchFetch());
  router.__resetGuardsForTests();
  router.currentRoute.path = '/superuser/T';
  component = mount(SuperuserShell, { target, props: { token: 'T' } });
  await settle();
  registry.register({ isDirty: true });
  pills()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  await settle();
  expect(target.querySelector('.inline-confirm')?.textContent ?? '').toContain('Discard unsaved changes and continue?');
  expect(router.currentRoute.path).toBe('/superuser/T');
});
