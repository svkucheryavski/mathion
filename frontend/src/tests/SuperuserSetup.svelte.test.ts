import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserSetup from '../pages/superuser/SuperuserSetup.svelte';
import { SetupStore } from '../lib/setupStore.svelte';
import type { PanelSetup } from '../lib/setup';
import type { AdminAssignResult, PanelBranding, PanelSettings } from '../lib/superuser';
import { session } from '../stores/session.svelte';
import { branding, setBranding, DEFAULT_BRANDING } from '../lib/branding.svelte';
import { crc32 } from '../lib/pngCheck';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { InPlaceAsk, NAV_ASK_KEY, type NavAskView } from '../lib/askInPlace.svelte';
import * as router from '../lib/router.svelte';

// Set up D3-D9: the page frame, its moves, All set, and the four steps: Email,
// Site name and logo, First course and its admin, Sign-in rules and limits.

const EMAIL_REASON = 'Not tested yet: send a test email.';
function state(over: Partial<PanelSetup> = {}, done: boolean[] = [false, false, false, false], passed?: boolean[]): PanelSetup {
  return {
    wizard_on: true, step: 1,
    steps: done.map((d, i) => ({
      passed: passed ? passed[i] : d, done: d,
      reason: d ? null : i === 0 ? EMAIL_REASON : i === 1 ? 'The site is still called Mathion.' : null,
    })),
    course: null, course_without_admin: null, email_set_up: true, pin_minutes: 10, defaults_in_use: true,
    ...over,
  };
}
function settings(email: Partial<PanelSettings['email']> = {}): PanelSettings {
  return {
    email: {
      on: true, host: 'smtp.uni.dk', port: 587, encryption: 'starttls', skip_cert_check: false,
      username: '', password_saved: false, password_unreadable: false, from_address: 'm@uni.dk',
      dev_mode: null, card_test: null, failing: null, ...email,
    },
    limits: { max_file_mb: 20, max_total_mb: 500 },
    sign_in: { pin_minutes: 10, pin_requests_per_hour: 5, pin_failures_per_hour: 10, longest_sign_in_days: 30 },
    site: { base_url: 'https://m.example' },
  };
}
function brandingOf(name = 'Mathion', logo = false): PanelBranding {
  return {
    name, logo: logo ? { width: 400, height: 80 } : null, icon: null,
    colours: { vars: [], changes: {}, warnings: [] },
    public: { name, logo: logo ? { version: 'a'.repeat(16), width: 400, height: 80 } : null, icon: null, theme: null },
  };
}
// A real PNG of the given size (the check reads only the header and the CRCs).
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(kind: string, data: number[]) {
  const k = [...kind].map((c) => c.charCodeAt(0));
  return [...u32(data.length), ...k, ...data, ...u32(crc32(new Uint8Array([...k, ...data])))];
}
function pngOf(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...chunk('IDAT', [0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1]),
    ...chunk('IEND', []),
  ]);
}
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); flushSync(); }
/** FileReader answers in a task, not a microtask. */
async function tick() { await new Promise((r) => setTimeout(r, 0)); await settle(); }

type Answer = [number, unknown];
type Handler = (body: unknown) => Answer | Promise<Answer>;
let routes: Record<string, Handler>;
let calls: { key: string; body: unknown }[];
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let setup: SetupStore;
let registry: DirtyRegistry;
let onAuth: ReturnType<typeof vi.fn>;
// img.decode() calls, in order, each answered by the test (jsdom has none).
let decodes: { resolve: () => void; reject: () => void }[];

beforeEach(() => {
  calls = [];
  decodes = [];
  routes = {
    'GET /settings': () => [200, settings()],
    'GET /branding': () => [200, brandingOf()],
    'POST /setup/skip': (b) => [200, state({ step: (b as { step: number }).step + 1 }, [false, false, false, false], [true, false, false, false])],
    'POST /setup/go': (b) => [200, state({ step: (b as { step: number }).step })],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('/api/superuser/T', '')}`;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ key, body });
    const h = routes[key];
    if (!h) return jsonResponse(500, { detail: `no route ${key}` });
    const [status, answer] = await h(body);
    return jsonResponse(status, answer);
  }));
  (HTMLImageElement.prototype as { decode?: () => Promise<void> }).decode = function () {
    return new Promise<void>((resolve, reject) => decodes.push({ resolve, reject: () => reject(new Error('EncodingError')) }));
  };
  target = document.createElement('div');
  document.body.appendChild(target);
  onAuth = vi.fn();
  setup = new SetupStore('T', onAuth);
  registry = createDirtyRegistry();
});
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  setup.dispose();
  target.remove();
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  document.head.querySelectorAll('[data-branding]').forEach((e) => e.remove());
  setBranding(DEFAULT_BRANDING);
  session.user = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(s: PanelSetup = state(), navAsk?: NavAskView) {
  setup.state = s;
  const context = new Map<symbol, unknown>([[DIRTY_REGISTRY_KEY, registry]]);
  if (navAsk) context.set(NAV_ASK_KEY, navAsk);
  cmp = mount(SuperuserSetup, { target, props: { setup, token: 'T', onAuth }, context });
  await settle();
}
function deferred(): { promise: Promise<Answer>; resolve: (a: Answer) => void } {
  let resolve!: (a: Answer) => void;
  const promise = new Promise<Answer>((r) => { resolve = r; });
  return { promise, resolve };
}

const card = () => target.querySelector<HTMLElement>('.st-card');
const title = () => card()?.querySelector('h2')?.textContent;
const foot = (action: string) => target.querySelector<HTMLButtonElement>(`.st-foot [data-action="${action}"]`);
const items = () => [...target.querySelectorAll<HTMLButtonElement>('.sl-item')];
const err = () => card()?.querySelector('[role="alert"]')?.textContent ?? null;
const input = (label: string) => [...target.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const writes = () => calls.filter((c) => /^(POST \/setup|POST \/branding|POST \/courses|PATCH|PUT)/.test(c.key));
const blocked = () => foot('save')!.getAttribute('aria-disabled') === 'true';
const mark = (n: number) => items()[n - 1].querySelector('.sl-mark')!;
/** Choose a file in the step's logo picker, as the browser's picker would. */
async function choose(bytes: Uint8Array, name = 'school.png') {
  const el = card()!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(el, 'files', { value: [new File([new Uint8Array(bytes)], name, { type: 'image/png' })], configurable: true });
  el.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 3; i++) await tick();
}
/** The same, without waiting for the file to be read. */
function chooseNow(bytes: Uint8Array, name = 'school.png') {
  const el = card()!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(el, 'files', { value: [new File([new Uint8Array(bytes)], name, { type: 'image/png' })], configurable: true });
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}
const confirmDiscard = () => target.querySelector<HTMLButtonElement>('[data-action="confirm-discard"]');
const askCancel = () => target.querySelector<HTMLButtonElement>('.inline-confirm button.cancel');

// --- The frame ---

it('the heading, the four list labels, and the card at the stored step', async () => {
  await render();
  expect(target.querySelector('.panel-head h1')?.textContent).toBe('Set up your site');
  expect(items().map((b) => b.querySelector('.sl-label')?.textContent)).toEqual(['Email', 'Site name and logo', 'First course', 'Sign-in and limits']);
  expect(title()).toBe('Email');
  expect(items()[0].getAttribute('aria-current')).toBe('step');
});

it('the list marks: a tick when done, dashed when passed and not done, the number otherwise', async () => {
  await render(state({ step: 3 }, [true, false, false, false], [true, true, false, false]));
  const marks = items().map((b) => b.querySelector('.sl-mark')!);
  expect(marks.map((m) => [...m.classList].find((c) => c === 'done' || c === 'passed' || c === 'number'))).toEqual(['done', 'passed', 'number', 'number']);
  expect(marks[2].textContent).toBe('3');
  expect(items()[2].getAttribute('aria-current')).toBe('step');
  // The hidden text: passed but not done is "not done", whether skipped or saved (U2).
  expect(items().map((b) => b.querySelector('.sl-vh')?.textContent ?? null)).toEqual(['(done)', '(not done)', null, null]);
});

it('held card ignores a re-read that moves the step', async () => {
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  routes['GET /setup'] = () => [200, state({ step: 3 })];
  await setup.read();
  await settle();
  expect(title()).toBe('Email');
  expect(input('Mail server').value).toBe('smtp.other.dk');
  routes['GET /setup'] = () => [200, state({ wizard_on: false })];
  await setup.read();
  await settle();
  expect(title()).toBe('Email');
  expect(target.querySelector('.as-card')).toBeNull();
});

it('an unheld card follows a re-read', async () => {
  await render();
  routes['GET /setup'] = () => [200, state({ step: 3 })];
  await setup.read();
  await settle();
  expect(title()).toBe('First course and its admin');
});

it('own skip answer moves the card', async () => {
  await render();
  foot('skip')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/skip', body: { step: 1 } }]);
  expect(title()).toBe('Site name and logo');
});

it('failed skip keeps the step and shows the error, retry resends', async () => {
  routes['POST /setup/skip'] = () => [500, { detail: 'Boom.' }];
  await render();
  foot('skip')!.click();
  await settle();
  expect(title()).toBe('Email');
  expect(err()).toBe('Boom.');
  // The failed move holds the card: a re-read doesn't take it away (D3a).
  routes['GET /setup'] = () => [200, state({ step: 2 })];
  await setup.read();
  await settle();
  expect(title()).toBe('Email');
  routes['POST /setup/skip'] = () => [200, state({ step: 2 })];
  foot('skip')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /setup/skip', 'POST /setup/skip']);
  expect(title()).toBe('Site name and logo');
});

it('a list click goes to the step; Back goes to the one before', async () => {
  await render();
  items()[2].click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/go', body: { step: 3 } }]);
  expect(title()).toBe('First course and its admin');
  foot('back')!.click();
  await settle();
  expect(writes()[1]).toEqual({ key: 'POST /setup/go', body: { step: 2 } });
  expect(title()).toBe('Site name and logo');
});

it('Back/Skip/list on a dirty step asks first', async () => {
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('skip')!.click();
  await settle();
  expect(writes()).toEqual([]);
  expect(confirmDiscard()).not.toBeNull();
  askCancel()!.click();
  await settle();
  expect(confirmDiscard()).toBeNull();
  expect(input('Mail server').value).toBe('smtp.other.dk');
  expect(document.activeElement).toBe(foot('skip'));
  items()[2].click();
  await settle();
  expect(writes()).toEqual([]);
  confirmDiscard()!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/go', body: { step: 3 } }]);
  expect(title()).toBe('First course and its admin');
  expect(registry.isAnyDirty()).toBe(false);
});

it('a failed move after Discard keeps the step with its form reset', async () => {
  routes['POST /setup/skip'] = () => [500, { detail: 'Boom.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('skip')!.click();
  await settle();
  confirmDiscard()!.click();
  await settle();
  expect(title()).toBe('Email');
  expect(err()).toBe('Boom.');
  expect(input('Mail server').value).toBe('smtp.uni.dk');
  expect(document.activeElement).toBe(foot('skip'));   // back on the control that asked
});

it("with the page's question open, a finished save moves the card on with no skip sent", async () => {
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('skip')!.click();
  await settle();
  expect(confirmDiscard()).not.toBeNull();
  foot('save')!.click();                          // the step's own save moves the card on
  await settle();
  expect(title()).toBe('Site name and logo');
  expect(confirmDiscard()).toBeNull();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved']);
});

it("the page's question goes when a re-read moves the card (the step no longer held)", async () => {
  routes['GET /setup'] = () => [200, state({ step: 2 })];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('skip')!.click();
  await settle();
  expect(confirmDiscard()).not.toBeNull();
  type(input('Mail server'), 'smtp.uni.dk');      // back to the saved value: nothing holds the card
  await setup.read();
  await settle();
  expect(title()).toBe('Site name and logo');
  expect(confirmDiscard()).toBeNull();
  expect(writes()).toEqual([]);
});

it("the page's question is withdrawn when the page goes", async () => {
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('skip')!.click();
  await settle();
  const dismiss = vi.spyOn(InPlaceAsk.prototype, 'dismiss');
  const discardAll = vi.spyOn(registry, 'discardAll');
  unmount(cmp!);
  cmp = null;
  expect(dismiss).toHaveBeenCalledTimes(1);
  await settle();
  expect(writes()).toEqual([]);
  expect(discardAll).not.toHaveBeenCalled();       // answered "dismissed", not Discard
});

it("the page's question goes when the step's own save starts, so its Discard can't send a move mid-save", async () => {
  const d = deferred();
  routes['PATCH /settings/email'] = () => d.promise;
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state()];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('skip')!.click();
  await settle();
  expect(confirmDiscard()).not.toBeNull();
  foot('save')!.click();
  await settle();
  expect(confirmDiscard()).toBeNull();
  d.resolve([200, settings({ host: 'smtp.other.dk' })]);
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved']);
});

it("while the shell's question is open, a move asks nothing and brings that question back", async () => {
  const focusCancel = vi.fn();
  await render(state(), { open: true, focusCancel, claim: () => () => {} });
  foot('skip')!.click();
  await settle();
  expect(focusCancel).toHaveBeenCalledTimes(1);
  expect(writes()).toEqual([]);
  expect(title()).toBe('Email');
});

it('focus moves to the card heading when the page shows a step and on step change', async () => {
  await render();
  expect(document.activeElement).toBe(card()!.querySelector('h2'));
  foot('skip')!.click();
  await settle();
  expect(title()).toBe('Site name and logo');
  expect(document.activeElement).toBe(card()!.querySelector('h2'));
});

it('while a write runs, Back, the skip button and the list wait', async () => {
  const d = deferred();
  routes['POST /setup/skip'] = () => d.promise;
  await render(state({ step: 2 }));
  foot('skip')!.click();
  await settle();
  expect(foot('skip')!.getAttribute('aria-disabled')).toBe('true');
  expect(foot('back')!.getAttribute('aria-disabled')).toBe('true');
  expect(items().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
  foot('back')!.click();
  items()[3].click();
  foot('skip')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /setup/skip']);
  d.resolve([200, state({ step: 3 })]);
  await settle();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /setup/skip']);   // nothing was queued behind it
  expect(title()).toBe('First course and its admin');
  expect(foot('skip')!.getAttribute('aria-disabled')).toBeNull();
});

it('the skip button per step, and none on a done step, also after an edit (D4a)', async () => {
  await render();
  expect(foot('skip')!.textContent!.trim()).toBe('Skip for now');
  expect(foot('back')).toBeNull();
  for (const [n, label] of [[2, 'Keep the defaults'], [3, 'Skip for now'], [4, 'Keep these values']] as const) {
    items()[n - 1].click();
    await settle();
    expect(foot('skip')!.textContent!.trim()).toBe(label);
    expect(foot('back')).not.toBeNull();
  }
  unmount(cmp!);
  cmp = null;
  await render(state({}, [true, false, false, false]));
  expect(foot('skip')).toBeNull();
  type(input('Mail server'), 'smtp.other.dk');
  expect(foot('save')!.textContent!.trim()).toBe('Save and continue');
  expect(foot('skip')).toBeNull();
});

it('a failed first read shows the error state with Try again in place of the card', async () => {
  setup.failed = true;
  setup.error = 'Boom.';
  const read = vi.spyOn(setup, 'read').mockResolvedValue(null);
  cmp = mount(SuperuserSetup, {
    target, props: { setup, token: 'T', onAuth }, context: new Map([[DIRTY_REGISTRY_KEY, registry]]),
  });
  await settle();
  expect(target.querySelector('.error-state')?.textContent).toContain('Could not load set up.');
  expect(card()).toBeNull();
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
  expect(read).toHaveBeenCalledTimes(1);
});

it('Try again shows that it is reading and ignores presses until the read answers', async () => {
  let answer!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>((r) => { answer = r; })));
  setup.failed = true;
  setup.error = 'Boom.';
  cmp = mount(SuperuserSetup, {
    target, props: { setup, token: 'T', onAuth }, context: new Map([[DIRTY_REGISTRY_KEY, registry]]),
  });
  await settle();
  const again = () => [...target.querySelectorAll<HTMLButtonElement>('.error-state button')].find((b) => b.textContent?.trim() === 'Try again')!;
  const read = vi.spyOn(setup, 'read');
  again().click();
  await settle();
  expect(again().getAttribute('aria-busy')).toBe('true');
  expect(again().getAttribute('aria-disabled')).toBe('true');
  again().click();
  expect(read).toHaveBeenCalledTimes(1);
  answer(new Response(JSON.stringify({ detail: 'Boom.' }), { status: 500, headers: { 'content-type': 'application/json' } }));
  await settle();
  expect(again().getAttribute('aria-busy')).toBeNull();
  expect(again().getAttribute('aria-disabled')).toBeNull();
  again().click();
  expect(read).toHaveBeenCalledTimes(2);
});

// --- Task 7 test gaps (the minors round) ---

it('the keep-alive stops when the step closes', async () => {
  const stops: ReturnType<typeof vi.fn>[] = [];
  const real = setup.keepAlive.bind(setup);
  vi.spyOn(setup, 'keepAlive').mockImplementation((dirty) => {
    const stop = vi.fn(real(dirty));
    stops.push(stop);
    return stop;
  });
  await render();
  expect(stops).toHaveLength(1);
  foot('skip')!.click();
  await settle();
  expect(title()).toBe('Site name and logo');
  expect(stops[0]).toHaveBeenCalled();
});

it('a test answer about values edited since is dropped', async () => {
  const d = deferred();
  routes['POST /settings/email/test'] = () => d.promise;
  routes['GET /setup'] = () => [200, state()];
  await render();
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Send test email')!.click();
  await settle();
  type(input('Mail server'), 'smtp.other.dk');
  d.resolve([200, { ok: true, message: 'Sent.' }]);
  await settle();
  expect(target.querySelector('.se-result')).toBeNull();
});

it('Esc in a field does nothing: the values stay and nothing asks or sends', async () => {
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  input('Mail server').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle();
  expect(input('Mail server').value).toBe('smtp.other.dk');
  expect(confirmDiscard()).toBeNull();
  expect(writes()).toEqual([]);
});

it("Cancel puts focus back on the list item or Back that asked", async () => {
  await render(state({ step: 2 }));
  type(input('Site name'), 'Lund');
  items()[2].click();
  await settle();
  askCancel()!.click();
  await settle();
  expect(document.activeElement).toBe(items()[2]);
  foot('back')!.click();
  await settle();
  askCancel()!.click();
  await settle();
  expect(document.activeElement).toBe(foot('back'));
  expect(writes()).toEqual([]);
});

it('a submit while the values load (mode "none") sends nothing', async () => {
  const d = deferred();
  routes['GET /settings'] = () => d.promise;
  await render();
  expect(foot('save')).toBeNull();
  card()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(writes()).toEqual([]);
  d.resolve([200, settings()]);
  await settle();
});

it('the values load fresh each time the step opens', async () => {
  await render();
  foot('skip')!.click();
  await settle();
  foot('back')!.click();
  await settle();
  expect(title()).toBe('Email');
  expect(calls.filter((c) => c.key === 'GET /settings')).toHaveLength(2);
});

it("after a failed skip, a failed save's sentence replaces the skip's", async () => {
  routes['POST /setup/skip'] = () => [500, { detail: 'Skip failed.' }];
  routes['PATCH /settings/email'] = () => [500, { detail: 'Save failed.' }];
  await render();
  foot('skip')!.click();
  await settle();
  expect(err()).toBe('Skip failed.');
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Save failed.');
});

it('after a half-save, a failed second save keeps "step saved" due: back to the saved values, the next press sends only it', async () => {
  let patches = 0;
  routes['PATCH /settings/email'] = (b) => (++patches === 2
    ? [500, { detail: 'Save failed.' }]
    : [200, settings({ host: (b as { host: string }).host })]);
  let saves = 0;
  routes['POST /setup/saved'] = () => (++saves === 1 ? [500, { detail: 'Boom.' }] : [200, state({ step: 2 })]);
  routes['GET /setup'] = () => [200, state()];
  await render();
  type(input('Mail server'), 'smtp.a.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  type(input('Mail server'), 'smtp.b.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Save failed.');
  type(input('Mail server'), 'smtp.a.dk');          // back to what saved: only "step saved" is due
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual([
    'PATCH /settings/email', 'POST /setup/saved', 'PATCH /settings/email', 'POST /setup/saved',
  ]);
  expect(title()).toBe('Site name and logo');
});

it('a 401 on "step saved" goes to the shell, with no re-read', async () => {
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [401, { detail: 'Not signed in' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(onAuth).toHaveBeenCalled();
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(0);
});

it("a move's 404 goes to the shell and shows no sentence", async () => {
  routes['POST /setup/skip'] = () => [404, { detail: 'Not Found' }];
  await render();
  foot('skip')!.click();
  await settle();
  expect(onAuth).toHaveBeenCalledWith('expired');
  expect(err()).toBeNull();
  expect(title()).toBe('Email');
});

// --- All set (D5) ---

it('All set lists the steps left and its list cannot be clicked', async () => {
  routes['POST /setup/skip'] = () => [200, state({ wizard_on: false }, [false, true, false, true], [true, true, true, true])];
  await render(state({ step: 4 }, [false, true, false, false], [true, true, true, false]));
  foot('skip')!.click();
  await settle();
  const all = target.querySelector<HTMLElement>('.as-card')!;
  expect(card()).toBeNull();
  expect(all.querySelector('p')?.textContent).toBe("Set up is over. These steps are left, and the Dashboard lists them until they're done:");
  expect([...all.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Email', 'First course']);
  expect(document.activeElement).toBe(all.querySelector('h2'));
  expect(items().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
  items()[0].click();
  await settle();
  expect(writes()).toHaveLength(1);
  const nav = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  [...all.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Go to the Dashboard')!.click();
  expect(nav).toHaveBeenCalledWith('/superuser/T');
});

it('All set says "Your site is set up." when every step is done', async () => {
  routes['POST /setup/skip'] = () => [200, state({ wizard_on: false }, [true, true, true, true])];
  await render(state({ step: 4 }, [true, true, true, false]));
  foot('skip')!.click();
  await settle();
  const all = target.querySelector<HTMLElement>('.as-card')!;
  expect(all.querySelector('p')?.textContent).toBe('Your site is set up.');
  expect(all.querySelector('ul')).toBeNull();
});

// --- Step 1: Email (D6) ---

it("step 1's title, note and not-done reason", async () => {
  await render();
  expect(card()!.querySelector('.st-note')?.textContent).toBe('Sign-in links, PINs and notifications go out by email.');
  expect(target.querySelector('.se-reason')?.textContent).toBe(EMAIL_REASON);
});

it('not-done reason hidden while the form differs', async () => {
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  expect(target.querySelector('.se-reason')).toBeNull();
  type(input('Mail server'), 'smtp.uni.dk');
  expect(target.querySelector('.se-reason')?.textContent).toBe(EMAIL_REASON);
});

it('a step not done with nothing changed has Save and continue blocked; the skip button stays usable', async () => {
  await render();
  expect(foot('save')!.textContent!.trim()).toBe('Save and continue');
  expect(foot('save')!.getAttribute('aria-disabled')).toBe('true');
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([]);
  expect(foot('skip')!.getAttribute('aria-disabled')).toBeNull();
});

it('done step shows Continue when unchanged, and Continue sends step saved', async () => {
  routes['POST /setup/saved'] = () => [200, state({ step: 2 }, [true, false, false, false])];
  await render(state({}, [true, false, false, false]));
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/saved', body: { step: 1 } }]);
  expect(title()).toBe('Site name and logo');
});

it('save then step saved, in that order; Enter in a field submits', async () => {
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [200, state({ step: 2 }, [false, false, false, false], [true, false, false, false])];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  input('Mail server').form!.requestSubmit();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved']);
  expect(writes()[0].body).toMatchObject({ on: true, host: 'smtp.other.dk' });
  expect(title()).toBe('Site name and logo');
});

it('a step whose save succeeded but step-saved failed retries only step-saved', async () => {
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(title()).toBe('Email');
  expect(err()).toBe('Boom.');
  expect(input('Mail server').value).toBe('smtp.other.dk');
  expect(registry.isAnyDirty()).toBe(false);   // saved: the new starting point
  expect(foot('save')!.getAttribute('aria-disabled')).toBeNull();
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved', 'POST /setup/saved']);
  expect(title()).toBe('Site name and logo');
});

it("a failed email save shows the server's sentence and keeps the typed values", async () => {
  routes['PATCH /settings/email'] = () => [422, { detail: 'The port must be from 1 to 65535.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('The port must be from 1 to 65535.');
  expect(input('Mail server').value).toBe('smtp.other.dk');
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email']);
});

it('while the email save runs, the step waits (setup.saving)', async () => {
  const d = deferred();
  routes['PATCH /settings/email'] = () => d.promise;
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(setup.saving).toBe(true);
  expect(foot('skip')!.getAttribute('aria-disabled')).toBe('true');
  expect(items()[1].getAttribute('aria-disabled')).toBe('true');
  d.resolve([200, settings({ host: 'smtp.other.dk' })]);
  await settle();
  expect(setup.saving).toBe(false);
  expect(title()).toBe('Site name and logo');
});

it('a test answer triggers a store re-read, even after leaving step 1', async () => {
  const d = deferred();
  routes['POST /settings/email/test'] = () => d.promise;
  routes['GET /setup'] = () => [200, state({ step: 2 }, [true, false, false, false], [true, false, false, false])];
  await render();
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Send test email')!.click();
  await settle();
  foot('skip')!.click();
  await settle();
  expect(title()).toBe('Site name and logo');
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(0);
  d.resolve([200, { ok: true, message: 'Sent.' }]);
  await settle();
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(setup.state?.steps[0].done).toBe(true);
});

it("a test's answer shows in the step", async () => {
  routes['POST /settings/email/test'] = () => [200, { ok: false, message: 'Could not connect.' }];
  routes['GET /setup'] = () => [200, state()];
  await render();
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Send test email')!.click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('Could not connect.');
});

it('dev mode shows the outbox line and Continue', async () => {
  routes['GET /settings'] = () => [200, settings({ dev_mode: 'file' })];
  routes['POST /setup/saved'] = () => [200, state({ step: 2 }, [true, false, false, false])];
  await render(state({}, [true, false, false, false]));
  expect(card()!.textContent).toContain('Email goes to a developer outbox (set on the server).');
  expect(target.querySelector('input')).toBeNull();
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/saved', body: { step: 1 } }]);
});

it("the step's values load fresh; a failed load shows the error state with Try again", async () => {
  routes['GET /settings'] = () => [500, { detail: 'Boom.' }];
  await render();
  expect(card()!.querySelector('.error-state')?.textContent).toContain('Boom.');
  routes['GET /settings'] = () => [200, settings()];
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
  await settle();
  expect(input('Mail server').value).toBe('smtp.uni.dk');
});

it('an edit notes the time for the keep-alive, and unsaved changes keep the link alive', async () => {
  const note = vi.spyOn(setup, 'noteEdit');
  const keep = vi.spyOn(setup, 'keepAlive');
  await render();
  expect(keep).toHaveBeenCalledTimes(1);
  type(input('Mail server'), 'smtp.other.dk');
  expect(note).toHaveBeenCalled();
  const dirty = keep.mock.calls[0][0];
  expect(dirty()).toBe(true);
});

// --- Task 7 review r1 ---

it('after a half-save, an edit is saved again before step saved (r1 I1)', async () => {
  routes['PATCH /settings/email'] = (b) => [200, settings({ host: (b as { host: string }).host })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  type(input('Mail server'), 'smtp.fixed.dk');
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved', 'PATCH /settings/email', 'POST /setup/saved']);
  expect(writes()[2].body).toMatchObject({ host: 'smtp.fixed.dk' });
  expect(title()).toBe('Site name and logo');
});

it('flipping the Send email switch notes an edit (r1 M4)', async () => {
  routes['GET /settings'] = () => [200, settings({ on: false, host: '' })];
  const note = vi.spyOn(setup, 'noteEdit');
  await render();
  target.querySelector<HTMLButtonElement>('.ee-switch button')!.click();
  flushSync();
  expect(note).toHaveBeenCalled();
});

it('a re-read that lands while the step saves leaves the card (D3a, r1 M1)', async () => {
  const g = deferred();
  const saved = deferred();
  routes['GET /setup'] = () => g.promise;
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => saved.promise;
  await render();
  void setup.read();                    // a keep-alive tick already in flight
  await settle();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(registry.isAnyDirty()).toBe(false);   // the email saved; step saved runs
  g.resolve([200, state({ step: 3 })]);
  await settle();
  expect(title()).toBe('Email');
  saved.resolve([200, state({ step: 2 })]);
  await settle();
  expect(title()).toBe('Site name and logo');
});

it("a failed move's sentence replaces the step's older error (r1 M2)", async () => {
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['POST /setup/skip'] = () => [500, { detail: 'Skip failed.' }];
  routes['GET /setup'] = () => [200, state()];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  foot('skip')!.click();
  await settle();
  expect(err()).toBe('Skip failed.');
});

it('a half-save re-reads the state, so the reason and the marks follow the saved email (r1 M3)', async () => {
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state({ step: 2 }, [true, false, false, false])];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(title()).toBe('Email');                // the error holds the card
  expect(err()).toBe('Boom.');
  expect(items()[0].querySelector('.sl-mark')!.classList.contains('done')).toBe(true);
});

// --- Step 2: Site name and logo (D7) ---

it('Save and continue waits while a chosen logo is still being read (Task 8 M3)', async () => {
  routes['GET /branding'] = () => [200, brandingOf('Riverside')];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Lund');
  chooseNow(pngOf(400, 100));
  expect(blocked()).toBe(true);
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([]);
  for (let i = 0; i < 3; i++) await tick();
  expect(blocked()).toBe(true);                   // read; the decode is still to come
  decodes[0].resolve();
  await settle();
  expect(blocked()).toBe(false);
});

it("step 2's title, note and the not-done reason, hidden while the form differs", async () => {
  await render(state({ step: 2 }));
  expect(title()).toBe('Site name and logo');
  expect(card()!.querySelector('.st-note')?.textContent).toBe("Shown in every page's header and in emails.");
  expect(card()!.textContent).toContain('The site is still called Mathion.');
  expect(input('Site name').value).toBe('Mathion');
  expect(blocked()).toBe(true);
  type(input('Site name'), 'Riverside');
  expect(card()!.textContent).not.toContain('The site is still called Mathion.');
  expect(blocked()).toBe(false);
});

it('name then logo, each only when changed; Save and continue waits for the decode', async () => {
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /branding/logo'] = () => [200, brandingOf('Riverside', true)];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  await choose(pngOf(400, 80));
  expect(blocked()).toBe(true);
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([]);
  decodes[0].resolve();
  await settle();
  expect(blocked()).toBe(false);
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name', 'POST /branding/logo', 'POST /setup/saved']);
  expect(writes()[0].body).toEqual({ name: 'Riverside' });
  expect(((writes()[1].body as FormData).get('file') as File).name).toBe('school.png');
  expect(writes()[2].body).toEqual({ step: 2 });
  expect(title()).toBe('First course and its admin');
});

it('only the name when only the name changed, only the logo when only the logo changed', async () => {
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /branding/logo'] = () => [200, brandingOf('Mathion', true)];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name', 'POST /setup/saved']);
  unmount(cmp!);
  cmp = null;
  calls = [];
  await render(state({ step: 2 }));
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /branding/logo', 'POST /setup/saved']);
});

it('logo refused after the name saved: name stays, error shows, retry sends only the logo', async () => {
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /branding/logo'] = () => [422, { detail: 'This PNG is too small.' }];
  routes['GET /setup'] = () => [200, state({ step: 2 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name', 'POST /branding/logo']);
  expect(err()).toBe('This PNG is too small.');
  expect(title()).toBe('Site name and logo');
  expect(input('Site name').value).toBe('Riverside');
  // The half-save re-reads the state, so the list ticks the step (D5a).
  expect(mark(2).classList.contains('done')).toBe(true);
  routes['POST /branding/logo'] = () => [200, brandingOf('Riverside', true)];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name', 'POST /branding/logo', 'POST /branding/logo', 'POST /setup/saved']);
  expect(title()).toBe('First course and its admin');
});

it("a proxy 413 on the logo shows the upload limit's sentence", async () => {
  routes['POST /branding/logo'] = () => [413, {}];
  await render(state({ step: 2 }));
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('save')!.click();
  await settle();
  expect(err()).toBe("This file is over the server's upload limit.");
});

it('header shows the new name at once', async () => {
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  foot('save')!.click();
  await settle();
  expect(branding.name).toBe('Riverside');
  expect(document.title).toBe('Riverside');
});

it('skip keeps the defaults: the button reads Keep the defaults, sends only the skip, and the list ticks it', async () => {
  routes['POST /setup/skip'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  expect(foot('skip')!.textContent!.trim()).toBe('Keep the defaults');
  foot('skip')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/skip', body: { step: 2 } }]);
  expect(mark(2).classList.contains('done')).toBe(true);
  expect(title()).toBe('First course and its admin');
});

it('a done step 2 shows Continue, which sends only step saved', async () => {
  routes['GET /branding'] = () => [200, brandingOf('Riverside')];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }, [false, true, false, false]));
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  expect(foot('skip')).toBeNull();
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/saved', body: { step: 2 } }]);
});

// --- Step 4: Sign-in rules and limits (D9) ---

it("step 4's title and note, filled with the saved values; Save and continue usable with nothing changed", async () => {
  await render(state({ step: 4 }));
  expect(title()).toBe('Sign-in rules and limits');
  expect(card()!.querySelector('.st-note')?.textContent).toBe('How long a PIN lasts, how often people can ask for one, and how big files may be.');
  expect(input('A PIN lasts (minutes)').value).toBe('10');
  expect(input('Largest file (MB)').value).toBe('20');
  expect(foot('save')!.textContent!.trim()).toBe('Save and continue');
  expect(blocked()).toBe(false);
});

it('unchanged save sends keep-sign-in then step saved', async () => {
  routes['POST /setup/keep-sign-in'] = () => [200, state({ step: 4 }, [false, false, false, true])];
  routes['POST /setup/saved'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([
    { key: 'POST /setup/keep-sign-in', body: undefined },
    { key: 'POST /setup/saved', body: { step: 4 } },
  ]);
  expect(title()).toBe('Email');
});

it('keep-sign-in that ends the wizard holds the card until step saved answers (D3a)', async () => {
  const saved = deferred();
  const over = state({ wizard_on: false }, [true, true, true, true]);
  routes['POST /setup/keep-sign-in'] = () => [200, over];
  routes['POST /setup/saved'] = () => saved.promise;
  await render(state({ step: 4 }, [true, true, true, false]));
  foot('save')!.click();
  await settle();
  await settle();
  expect(title()).toBe('Sign-in rules and limits');
  expect(target.querySelector('.as-card')).toBeNull();
  saved.resolve([200, over]);
  await settle();
  expect(target.querySelector('.as-card')).not.toBeNull();
});

it('changed sign-in only sends only sign-in', async () => {
  routes['PATCH /settings/sign-in'] = () => [200, settings()];
  routes['POST /setup/saved'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  type(input('A PIN lasts (minutes)'), '15');
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/sign-in', 'POST /setup/saved']);
  expect(writes()[0].body).toEqual({ pin_minutes: 15, pin_requests_per_hour: 5, pin_failures_per_hour: 10, longest_sign_in_days: 30 });
});

it('limits refused after sign-in saved, when that completed the last step: error and typed limits stay, retry sends only limits, then All set', async () => {
  const over = state({ wizard_on: false }, [true, true, true, true]);
  routes['PATCH /settings/sign-in'] = () => [200, settings()];
  routes['PATCH /settings/limits'] = () => [422, { detail: 'The largest file is at most 1024 MB.' }];
  routes['GET /setup'] = () => [200, over];
  await render(state({ step: 4 }, [true, true, true, false]));
  type(input('A PIN lasts (minutes)'), '15');
  type(input('Largest file (MB)'), '5000');
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/sign-in', 'PATCH /settings/limits']);
  expect(err()).toBe('The largest file is at most 1024 MB.');
  expect(title()).toBe('Sign-in rules and limits');
  expect(input('Largest file (MB)').value).toBe('5000');
  expect(target.querySelector('.as-card')).toBeNull();
  type(input('Largest file (MB)'), '50');
  routes['PATCH /settings/limits'] = () => [200, settings()];
  routes['POST /setup/saved'] = () => [200, over];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/sign-in', 'PATCH /settings/limits', 'PATCH /settings/limits', 'POST /setup/saved']);
  expect(target.querySelector('.as-card')).not.toBeNull();
});

it('"1.5" shows Type a whole number. (limits: Type a whole number of MB.) and sends nothing', async () => {
  await render(state({ step: 4 }));
  type(input('A PIN lasts (minutes)'), '1.5');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Type a whole number.');
  type(input('A PIN lasts (minutes)'), '10');
  type(input('Largest file (MB)'), '1.5');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Type a whole number of MB.');
  expect(writes()).toEqual([]);
});

it('skip on step 4 reads Keep these values, sends the skip (never keep-sign-in), ticks it and moves the card on (D4a)', async () => {
  routes['POST /setup/skip'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  expect(foot('skip')!.textContent!.trim()).toBe('Keep these values');
  foot('skip')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/skip', body: { step: 4 } }]);
  expect(mark(4).classList.contains('done')).toBe(true);
  expect(title()).toBe('Email');
});

// --- Step 3: First course and its admin (D8) ---

const ADMIN = { id: 9, email: 'aho@uni.dk', full_name: 'Anna Holm', is_disabled: false };
const SIGN_IN = 'https://m.example/courses/stat/edit';
function created(over: Partial<AdminAssignResult> = {}): AdminAssignResult {
  return {
    course: { id: 1, name: 'Statistics 101', slug: 'statistics-101', admin: ADMIN, version_count: 1, run_count: 0, student_count: 0 },
    admin: ADMIN, admin_email: 'email_off', pin_minutes: 10, sign_in_url: SIGN_IN, ...over,
  };
}
const withCourse = (over: Partial<PanelSetup> = {}, done = [false, false, true, false]) =>
  state({ step: 3, course: { name: 'Statistics 101', sign_in_url: SIGN_IN, admin: ADMIN }, ...over }, done);
const OVER = state({ wizard_on: false }, [true, true, true, true]);
const strip = () => card()?.querySelector<HTMLElement>('.note-strip') ?? null;
function fillCourse(name = 'Statistics 101', email = 'aho@uni.dk') {
  type(input('Course name'), name);
  type(input("Admin's email"), email);
}
async function create(saved: Handler, answer: Answer = [200, created()]) {
  routes['POST /courses'] = () => answer;
  routes['POST /setup/saved'] = saved;
  fillCourse();
  foot('save')!.click();
  await settle();
}

it("step 3's title, note and fields; Save and continue waits for all three", async () => {
  await render(state({ step: 3 }));
  expect(title()).toBe('First course and its admin');
  expect(card()!.querySelector('.st-note')?.textContent).toBe('A course and the person who will build it.');
  expect(blocked()).toBe(true);
  type(input('Course name'), 'Statistics 101');
  expect(blocked()).toBe(true);
  type(input("Admin's email"), 'aho@uni.dk');
  expect(blocked()).toBe(false);
  expect(foot('skip')!.textContent!.trim()).toBe('Skip for now');
});

it('create sends the course, then step saved; the note shows the command as code and only Continue', async () => {
  await render(state({ step: 3 }));
  await create(() => [200, state({ step: 4 }, [false, false, true, false])]);
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved']);
  expect(writes()[0].body).toMatchObject({ name: 'Statistics 101', admin_email: 'aho@uni.dk' });
  expect(writes()[1].body).toEqual({ step: 3 });
  expect(strip()!.textContent).toContain("Statistics 101 is created; Anna Holm is its admin. Email isn't set up on this server");
  expect(strip()!.querySelector('code')?.textContent).toBe('mathion pin aho@uni.dk');
  expect(strip()!.querySelector('button')).toBeNull();
  expect(card()!.querySelector('input')).toBeNull();
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  expect(foot('back')).toBeNull();
  expect(foot('skip')).toBeNull();
  expect(mark(3).classList.contains('done')).toBe(true);
  expect(registry.isAnyDirty()).toBe(false);
});

it('the note survives its own step-saved answer (step 4, or over) and a re-read', async () => {
  await render(state({ step: 3 }));
  await create(() => [200, OVER]);
  expect(title()).toBe('First course and its admin');
  expect(target.querySelector('.as-card')).toBeNull();
  expect(strip()).not.toBeNull();
  routes['GET /setup'] = () => [200, OVER];
  await setup.read();
  await settle();
  expect(strip()).not.toBeNull();
});

it('when the admin is you the note says so, with no command', async () => {
  session.user = { id: 1, email: 'AHO@uni.dk', full_name: 'Anna Holm', is_superuser: true, is_disabled: false, photo_url: null, has_course_admin: false, has_run_teacher: false };
  await render(state({ step: 3 }));
  await create(() => [200, state({ step: 4 }, [false, false, true, false])]);
  expect(strip()!.textContent!.trim()).toBe("Statistics 101 is created; you are its admin. You'll find it on the Courses page of the main site.");
  expect(strip()!.querySelector('code')).toBeNull();
});

it('Continue waits while step-saved runs, then moves by the newest state (All set when over)', async () => {
  const d = deferred();
  await render(state({ step: 3 }));
  await create(() => d.promise);
  expect(strip()).not.toBeNull();
  expect(blocked()).toBe(true);
  expect(items().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved']);
  d.resolve([200, OVER]);
  await settle();
  expect(strip()).not.toBeNull();
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved']);
  expect(target.querySelector('.as-card')).not.toBeNull();
});

it('Continue after step-saved moves to the step the newest state names', async () => {
  await render(state({ step: 3 }));
  await create(() => [200, state({ step: 4 }, [false, false, true, false])]);
  foot('save')!.click();
  await settle();
  expect(title()).toBe('Sign-in rules and limits');
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved']);
});

it('list click after step-saved answered goes to the clicked step, or All set when the go answer says over', async () => {
  await render(state({ step: 3 }));
  await create(() => [200, state({ step: 4 }, [false, false, true, false])]);
  items()[0].click();
  await settle();
  expect(writes()[2]).toEqual({ key: 'POST /setup/go', body: { step: 1 } });
  expect(title()).toBe('Email');
  unmount(cmp!);
  cmp = null;
  await render(state({ step: 3 }));
  await create(() => [200, OVER]);
  routes['POST /setup/go'] = () => [200, OVER];
  items()[1].click();
  await settle();
  expect(target.querySelector('.as-card')).not.toBeNull();
});

it('step-saved failed: the note stays, its error shows, Continue retries only step-saved', async () => {
  routes['GET /setup'] = () => [200, state({ step: 3 }, [false, false, true, false])];
  await render(state({ step: 3 }));
  await create(() => [500, { detail: 'Boom.' }]);
  expect(strip()).not.toBeNull();
  expect(err()).toBe('Boom.');
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved', 'POST /setup/saved']);
  expect(title()).toBe('Sign-in rules and limits');
});

it('409 shows the sentence, re-reads, and the done view replaces the form when step 3 is now done', async () => {
  routes['GET /setup'] = () => [200, withCourse()];
  await render(state({ step: 3 }));
  await create(() => [200, state()], [409, { detail: 'The address statistics-101 is taken.' }]);
  await settle();
  expect(err()).toBe('The address statistics-101 is taken.');
  expect(card()!.textContent).toContain('A course exists: Statistics 101. Anna Holm is its admin.');
  expect(card()!.querySelector('input')).toBeNull();
  expect(registry.isAnyDirty()).toBe(false);
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  expect(writes().map((c) => c.key)).toEqual(['POST /courses']);
});

it('409 when step 3 is still not done keeps the form and the typed values', async () => {
  routes['GET /setup'] = () => [200, state({ step: 3 })];
  await render(state({ step: 3 }));
  await create(() => [200, state()], [409, { detail: 'The address statistics-101 is taken.' }]);
  await settle();
  expect(err()).toBe('The address statistics-101 is taken.');
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(input('Course name').value).toBe('Statistics 101');
});

it('done view repeats the sign-in sentence (email off, after a reload); Continue sends step saved', async () => {
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  await render(withCourse({ email_set_up: false }));
  expect(card()!.textContent).toContain(
    "A course exists: Statistics 101. Anna Holm is its admin. Email isn't set up on this server, so tell them yourself. "
    + `They sign in at ${SIGN_IN} with a PIN: run mathion pin aho@uni.dk on the server (the PIN lasts 10 minutes).`);
  expect(card()!.querySelector('code')?.textContent).toBe('mathion pin aho@uni.dk');
  expect(card()!.querySelector('input')).toBeNull();
  expect(foot('skip')).toBeNull();
  expect(foot('back')).not.toBeNull();
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'POST /setup/saved', body: { step: 3 } }]);
  expect(title()).toBe('Sign-in rules and limits');
});

it('no-admin course opens the form with its line', async () => {
  await render(state({ step: 3, course_without_admin: 'Chemometrics' }));
  expect(card()!.textContent).toContain('Chemometrics has no admin: give it one on the Courses page, or create another course here.');
  expect(input('Course name')).toBeDefined();
});

it('held form still creates what was typed (no 409)', async () => {
  await render(state({ step: 3 }));
  fillCourse();
  routes['GET /setup'] = () => [200, state({ step: 3, course: { name: 'Other', sign_in_url: SIGN_IN, admin: ADMIN } }, [false, false, true, false])];
  await setup.read();
  await settle();
  expect(input('Course name').value).toBe('Statistics 101');
  routes['POST /courses'] = () => [200, created()];
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  foot('save')!.click();
  await settle();
  expect(writes()[0]).toMatchObject({ key: 'POST /courses', body: { name: 'Statistics 101' } });
  expect(strip()).not.toBeNull();
});

// --- Task 9 review r1 ---

it('an empty form turns into the done view when a re-read finds step 3 done (r1 Opus I1)', async () => {
  await render(state({ step: 3 }));
  expect(input('Course name')).toBeDefined();
  routes['GET /setup'] = () => [200, withCourse()];
  await setup.read();
  await settle();
  expect(title()).toBe('First course and its admin');
  expect(card()!.textContent).toContain('A course exists: Statistics 101. Anna Holm is its admin.');
  expect(card()!.querySelector('input')).toBeNull();
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
});

it('the done view gives way to the form when the course is gone (r1 Opus I1, Fable M3)', async () => {
  await render(withCourse());
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  routes['GET /setup'] = () => [200, state({ step: 3 })];
  await setup.read();
  await settle();
  expect(card()!.querySelector('.sc-done')).toBeNull();
  expect(input('Course name')).toBeDefined();
});

it('a 409 whose re-read says the wizard is over shows All set, with no further write (r1 Fable I1)', async () => {
  routes['GET /setup'] = () => [200, withCourse({ wizard_on: false }, [true, true, true, true])];
  await render(state({ step: 3 }));
  await create(() => [200, OVER], [409, { detail: 'The address statistics-101 is taken.' }]);
  await settle();
  expect(target.querySelector('.as-card')).not.toBeNull();
  expect(writes().map((c) => c.key)).toEqual(['POST /courses']);
  expect(registry.isAnyDirty()).toBe(false);
});

// --- Task 9 review r2 ---

it('done view: a failed Continue keeps the done view and its error; Continue retries only step saved (r2 I1)', async () => {
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, withCourse()];
  await render(withCourse());
  foot('save')!.click();
  await settle();
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  expect(err()).toBe('Boom.');
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  expect(blocked()).toBe(false);
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /setup/saved', 'POST /setup/saved']);
  expect(title()).toBe('Sign-in rules and limits');
});

it('a 409 whose re-read says over while step 3 is not done keeps the typed values and the sentence (r2 Opus M2, D3a)', async () => {
  routes['GET /setup'] = () => [200, state({ wizard_on: false }, [true, true, false, true])];
  await render(state({ step: 3 }));
  await create(() => [200, OVER], [409, { detail: 'The address statistics-101 is taken.' }]);
  await settle();
  expect(target.querySelector('.as-card')).toBeNull();
  expect(err()).toBe('The address statistics-101 is taken.');
  expect(input('Course name').value).toBe('Statistics 101');
});

it('typed values after a 409 done view gave way are never swapped out by a later re-read (r2 M1, D3a)', async () => {
  routes['GET /setup'] = () => [200, withCourse()];
  await render(state({ step: 3 }));
  await create(() => [200, OVER], [409, { detail: 'The address statistics-101 is taken.' }]);
  await settle();
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  routes['GET /setup'] = () => [200, state({ step: 3 })];
  await setup.read();
  await settle();
  type(input('Course name'), 'Chemometrics');
  routes['GET /setup'] = () => [200, withCourse()];
  await setup.read();
  await settle();
  expect(input('Course name').value).toBe('Chemometrics');
});
