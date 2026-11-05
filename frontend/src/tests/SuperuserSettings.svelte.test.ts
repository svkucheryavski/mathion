import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserSettings from '../pages/superuser/SuperuserSettings.svelte';
import type { PanelSettings } from '../lib/superuser';

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Local wall-clock times, so the card reads the same in any test time zone.
const TESTED = new Date(2026, 10, 4, 14, 2).toISOString();
const SINCE = new Date(2026, 10, 5, 9, 30).toISOString();

function settings(): PanelSettings {
  return {
    email: {
      on: true, host: 'smtp.office365.com', port: 587, encryption: 'starttls', skip_cert_check: false,
      username: 'mathion@uni.dk', password_saved: true, password_unreadable: false,
      from_address: 'Mathion <noreply@uni.dk>', dev_mode: null,
      card_test: { at: TESTED, ok: true, message: 'Sent to su@uni.dk: check your inbox.' }, failing: null,
    },
    limits: { max_file_mb: 20, max_total_mb: 500 },
    sign_in: { pin_minutes: 10, pin_requests_per_hour: 3, pin_failures_per_hour: 5, longest_sign_in_days: 30 },
    site: { base_url: 'https://learn.uni.dk' },
  };
}

type Handler = (body: unknown) => [number, unknown];
let routes: Record<string, Handler>;
let calls: string[];
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let onAuth: ReturnType<typeof vi.fn>;

beforeEach(() => {
  calls = [];
  routes = { 'GET /settings': () => [200, settings()] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('/api/superuser/T', '')}`;
    calls.push(key);
    const h = routes[key];
    if (!h) return jsonResponse(500, { detail: `no route ${key}` });
    const [status, body] = h(init?.body ? JSON.parse(String(init.body)) : undefined);
    return jsonResponse(status, body);
  }));
});
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

async function render(over?: (s: PanelSettings) => void) {
  if (over) routes['GET /settings'] = () => { const s = settings(); over(s); return [200, s]; };
  target = document.createElement('div');
  document.body.appendChild(target);
  onAuth = vi.fn();
  cmp = mount(SuperuserSettings, { target, props: { token: 'T', onAuth } });
  await settle();
}
const cards = () => [...target.querySelectorAll<HTMLElement>('section.s-card')];
const card = (title: string) => cards().find((c) => c.querySelector('h2')?.textContent === title)!;
const rows = (c: HTMLElement) => Object.fromEntries([...c.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling as HTMLElement]));
const pencil = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-action="edit"]');
const panel = () => document.querySelector<HTMLElement>('section.modal-panel');
const footButton = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label)!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const panelInput = (label: string) => [...panel()!.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;

it('shows a skeleton while loading, then the Settings heading and four cards in order (D4)', async () => {
  let release: () => void = () => {};
  routes['GET /settings'] = () => [200, settings()];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((...a: Parameters<typeof fetch>) => new Promise<Response>((r) => { release = () => r(real(...a)); })));
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(SuperuserSettings, { target, props: { token: 'T', onAuth: vi.fn() } });
  await settle();
  expect(target.querySelector('.panel-head h1')?.textContent).toBe('Settings');
  expect(target.querySelector('.skeleton')).not.toBeNull();
  expect(cards()).toHaveLength(0);
  release(); await settle(); await settle();
  expect(target.querySelector('.skeleton')).toBeNull();
  expect(cards().map((c) => c.querySelector('h2')?.textContent)).toEqual(['Email', 'File limits', 'Sign-in', 'Site']);
});

it('the Email card, on: the badge, the server, the login, the From and the last test (D6)', async () => {
  await render();
  const c = card('Email');
  expect(c.querySelector('.s-badge')?.textContent).toBe('On');
  expect(c.querySelector('.s-badge')?.classList.contains('on')).toBe(true);
  const r = rows(c);
  expect(Object.keys(r)).toEqual(['Mail server', 'Login', 'From', 'Last test']);
  expect(r['Mail server'].textContent).toBe('smtp.office365.com:587, STARTTLS');
  expect(r['Mail server'].querySelector('.mono')?.textContent).toBe('smtp.office365.com:587');
  expect(r['Login'].textContent).toBe('mathion@uni.dk, password saved');
  expect(r['From'].textContent).toBe('Mathion <noreply@uni.dk>');
  expect(r['Last test'].textContent).toBe('Sent, 4 Nov 2026 at 14:02');
  expect(r['Last test'].classList.contains('ok')).toBe(true);
  expect(pencil(c)?.getAttribute('aria-label')).toBe('Edit email');
});

it('the Mail server row names the encryption and an unchecked certificate (D6, D7a)', async () => {
  await render((s) => { s.email.encryption = 'ssl'; s.email.port = 465; s.email.skip_cert_check = true; });
  expect(rows(card('Email'))['Mail server'].textContent).toBe('smtp.office365.com:465, SSL/TLS, certificate not checked');
  unmount(cmp!); cmp = null; target.remove();
  await render((s) => { s.email.encryption = 'none'; s.email.port = 25; s.email.username = ''; s.email.password_saved = false; });
  expect(rows(card('Email'))['Mail server'].textContent).toBe('smtp.office365.com:25, no encryption');
});

it('the Login row: No login, and a password that can\'t be read (D6, D8)', async () => {
  await render((s) => { s.email.username = ''; s.email.password_saved = false; });
  expect(rows(card('Email'))['Login'].textContent).toBe('No login');
  unmount(cmp!); cmp = null; target.remove();
  await render((s) => { s.email.password_unreadable = true; });
  expect(rows(card('Email'))['Login'].textContent).toBe("mathion@uni.dk, password can't be read");
});

it('a failed last test is red with its reason; none tested has no Last test row (D6)', async () => {
  await render((s) => { s.email.card_test = { at: TESTED, ok: false, message: 'The mail server refused the login.' }; });
  const last = rows(card('Email'))['Last test'];
  expect(last.textContent).toBe('Failed, 4 Nov 2026 at 14:02: The mail server refused the login.');
  expect(last.classList.contains('err')).toBe(true);
  unmount(cmp!); cmp = null; target.remove();
  await render((s) => { s.email.card_test = null; });
  expect(Object.keys(rows(card('Email')))).toEqual(['Mail server', 'Login', 'From']);
});

it('a stuck queue shows a red line under the rows (D9d)', async () => {
  await render((s) => { s.email.failing = { since: SINCE, message: 'The mail server refused noreply@uni.dk as the sender.' }; });
  const line = card('Email').querySelector<HTMLElement>('.s-failing')!;
  expect(line.textContent).toBe('Sending is failing since 5 Nov 2026 at 09:30: The mail server refused noreply@uni.dk as the sender.');
  expect(line.classList.contains('err')).toBe(true);
});

it('the Email card, off: the Off badge and the sentence, with the command as code (D6)', async () => {
  await render((s) => { s.email.on = false; });
  const c = card('Email');
  expect(c.querySelector('.s-badge')?.textContent).toBe('Off');
  expect(c.querySelector('.s-badge')?.classList.contains('off')).toBe(true);
  expect(c.querySelector('dl')).toBeNull();
  // The second sentence starts on its own line (user, Task 5 shots).
  const foot = c.querySelector<HTMLElement>('.s-foot')!;
  const br = foot.querySelector('br')!;
  expect(br).not.toBeNull();
  expect(br.previousSibling?.textContent).toBe("Email is off: sign-in PINs and notifications aren't sent.");
  expect(foot.textContent).toBe(
    "Email is off: sign-in PINs and notifications aren't sent.People can sign in only with a PIN you make on the server (mathion pin <email>).");
  expect(c.querySelector('.s-foot code')?.textContent).toBe('mathion pin <email>');
  expect(pencil(c)).not.toBeNull();
});

it('a developer mode shows its sentence, with no badge and no pencil (D2c)', async () => {
  await render((s) => { s.email.dev_mode = 'file'; });
  const c = card('Email');
  expect(c.querySelector('.s-foot')?.textContent).toBe('Email goes to a developer outbox (set on the server).');
  expect(c.querySelector('.s-badge')).toBeNull();
  expect(pencil(c)).toBeNull();
  expect(c.querySelector('dl')).toBeNull();
});

it('the File limits and Sign-in cards list their values (D11, D12)', async () => {
  await render((s) => { s.sign_in.longest_sign_in_days = 1; s.sign_in.pin_minutes = 1; });
  const limits = rows(card('File limits'));
  expect(Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v.textContent])))
    .toEqual({ 'Largest file': '20 MB', 'Files per course version or run': '500 MB in total' });
  const signIn = rows(card('Sign-in'));
  expect(Object.fromEntries(Object.entries(signIn).map(([k, v]) => [k, v.textContent]))).toEqual({
    'A PIN lasts': '1 minute', 'PIN requests': '3 per hour', 'Wrong PIN tries': '5 per hour', 'Longest sign-in': '1 day',
  });
  expect(pencil(card('File limits'))?.getAttribute('aria-label')).toBe('Edit file limits');
  expect(pencil(card('Sign-in'))?.getAttribute('aria-label')).toBe('Edit sign-in');
});

it('the Site card shows the address and why it is set on the server, with no pencil (D3)', async () => {
  await render();
  const c = card('Site');
  expect(rows(c)['Address'].textContent).toBe('https://learn.uni.dk');
  expect(rows(c)['Address'].classList.contains('mono')).toBe(true);
  expect(c.querySelector('.s-foot')?.textContent).toBe('Set on the server, because every link Mathion sends is built from it.');
  expect(pencil(c)).toBeNull();
});

it('a 404 hands the expired link to the shell', async () => {
  routes['GET /settings'] = () => [404, { detail: 'Not Found' }];
  await render();
  expect(onAuth).toHaveBeenCalledWith('expired');
});

it("a failed load shows the panel's error state with the server's sentence", async () => {
  routes['GET /settings'] = () => [409, { detail: 'Something is off.' }];
  await render();
  expect(target.querySelector('.error-state')?.textContent).toContain('Something is off.');
  expect(cards()).toHaveLength(0);
});

it('a pencil opens its dialog; a save shows the saved values on the card and closes it (D5)', async () => {
  await render();
  routes['PATCH /settings/limits'] = (body) => {
    const s = settings(); Object.assign(s.limits, body as object); return [200, s];
  };
  pencil(card('File limits'))!.click(); await settle();
  expect(panel()).not.toBeNull();
  type(panelInput('Largest file (MB)'), '50');
  footButton('Save').click(); await settle();
  expect(calls).toContain('PATCH /settings/limits');
  expect(panel()).toBeNull();
  expect(rows(card('File limits'))['Largest file'].textContent).toBe('50 MB');
});

it('the email dialog saves through the page; closing it reloads, so a test of the saved values reaches the card (D9a)', async () => {
  await render();
  routes['POST /settings/email/test'] = () => [200, { ok: true, message: 'Sent to su@uni.dk: check your inbox.' }];
  pencil(card('Email'))!.click(); await settle();
  footButton('Send test email').click(); await settle();
  expect(calls).toContain('POST /settings/email/test');
  const before = calls.filter((c) => c === 'GET /settings').length;
  footButton('Cancel').click(); await settle();
  expect(panel()).toBeNull();
  expect(calls.filter((c) => c === 'GET /settings').length).toBe(before + 1);
});

it('the sign-in dialog saves through the page', async () => {
  await render();
  routes['PATCH /settings/sign-in'] = (body) => {
    const s = settings(); Object.assign(s.sign_in, body as object); return [200, s];
  };
  pencil(card('Sign-in'))!.click(); await settle();
  type(panelInput('A PIN lasts (minutes)'), '15');
  footButton('Save').click(); await settle();
  expect(panel()).toBeNull();
  expect(rows(card('Sign-in'))['A PIN lasts'].textContent).toBe('15 minutes');
});
