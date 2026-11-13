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
import { uploadLimit, resetUploadLimit } from '../lib/uploadLimit.svelte';

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
// Installed by the tests that choose a file (choose, chooseNow).
let decodes: { resolve: () => void; reject: () => void }[];
let decodeStubbed = false;
function stubDecode() {
  if (decodeStubbed) return;
  decodeStubbed = true;
  (HTMLImageElement.prototype as { decode?: () => Promise<void> }).decode = function () {
    return new Promise<void>((resolve, reject) => decodes.push({ resolve, reject: () => reject(new Error('EncodingError')) }));
  };
}

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
  resetUploadLimit();   // step 4's limits save sets the tab's upload limit
  target.remove();
  if (decodeStubbed) delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  decodeStubbed = false;
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
/** Wait, a task at a time, until `done()` holds (at most 20 tasks). */
async function until(done: () => boolean) {
  for (let i = 0; i < 20 && !done(); i++) await tick();
}
/** Choose a file in the step's logo picker, as the browser's picker would, and
 *  wait until it is read: its decode starts, or its refusal shows. */
async function choose(bytes: Uint8Array, name = 'school.png') {
  const before = decodes.length;
  chooseNow(bytes, name);
  const was = err();
  await until(() => decodes.length > before || (err() !== null && err() !== was));
}
/** The same, without waiting for the file to be read. */
function chooseNow(bytes: Uint8Array, name = 'school.png') {
  stubDecode();
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

// --- The page and its moves: more pins ---

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

// Review t4-r13: with no username the server ignores a typed password, so
// in Set up too it is no change (the note says it isn't used).
it('a password typed with no username: a done step keeps Continue, and leaving does not ask', async () => {
  await render(state({}, [true, false, false, false]));
  type(input('Password'), 'secret');
  expect(target.textContent).toContain("Without a username, the password isn't used.");
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  expect(registry.isAnyDirty()).toBe(false);
});

it('a password typed with no username keeps Save and continue blocked on a step not done', async () => {
  await render();
  type(input('Password'), 'secret');
  expect(blocked()).toBe(true);
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([]);
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
  // The answer lands after the step is gone: it must not read the step's
  // derived state then (Svelte's derived_inert warning, round 6).
  const warn = vi.spyOn(console, 'warn');
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
  expect(warn.mock.calls.flat().join(' ')).not.toContain('derived_inert');
  warn.mockRestore();
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

it('a half-save re-reads the state, so the marks follow the saved email (r1 M3)', async () => {
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

// --- Step 1: the save, the reason and Try again ---

const emailSwitch = () => target.querySelector<HTMLButtonElement>('.ee-switch button')!;

// D6 (rev 19, user's): with email off a save writes only the switch, so
// edits in the greyed fields are no change: the retry sends "step 1 saved"
// alone and the step moves on without them.
it('after a half-save, edits only in greyed fields retry "step 1 saved" alone (D6)', async () => {
  routes['PATCH /settings/email'] = (b) => [200, settings((b as { on: boolean }).on ? {} : { on: false })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state()];
  await render();
  emailSwitch().click();                         // Send email off
  flushSync();
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');                   // saved off; "step 1 saved" is due
  expect(blocked()).toBe(false);
  emailSwitch().click();                         // on again, a new server, off again
  flushSync();
  type(input('Mail server'), 'smtp.other.dk');
  emailSwitch().click();
  flushSync();
  expect(registry.isAnyDirty()).toBe(true);
  expect(blocked()).toBe(false);
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved', 'POST /setup/saved']);
  expect(title()).toBe('Site name and logo');
  expect(registry.isAnyDirty()).toBe(false);     // the greyed edits left with the step
});

it('after a half-save, greyed edits still count as unsaved for the leave questions (D6)', async () => {
  routes['PATCH /settings/email'] = (b) => [200, settings((b as { on: boolean }).on ? {} : { on: false })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state()];
  await render();
  emailSwitch().click();
  flushSync();
  foot('save')!.click();
  await settle();
  emailSwitch().click();
  flushSync();
  type(input('Mail server'), 'smtp.other.dk');
  emailSwitch().click();
  flushSync();
  foot('skip')!.click();
  await settle();
  expect(confirmDiscard()).not.toBeNull();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved']);   // no skip yet
  expect(title()).toBe('Email');
});

// D6: the switch is something a save writes, so after a half-save changing
// only the switch saves the email again before "step 1 saved".
it('after a half-save, turning email off saves the switch again first (D6)', async () => {
  routes['PATCH /settings/email'] = (b) => [200, settings((b as { on: boolean }).on ? { host: 'smtp.other.dk' } : { on: false, host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state()];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');                   // saved on; "step 1 saved" is due
  emailSwitch().click();                         // Send email off: a save writes it
  flushSync();
  expect(blocked()).toBe(false);
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved', 'PATCH /settings/email', 'POST /setup/saved']);
  expect(writes()[2].body).toEqual({ on: false });
  expect(title()).toBe('Site name and logo');
});

it('after a half-save, turning email on saves the email again first (D6)', async () => {
  routes['PATCH /settings/email'] = (b) => [200, settings((b as { on: boolean }).on ? {} : { on: false })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state()];
  await render();
  emailSwitch().click();                         // Send email off
  flushSync();
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');                   // saved off; "step 1 saved" is due
  emailSwitch().click();                         // on again: a save writes it
  flushSync();
  expect(blocked()).toBe(false);
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PATCH /settings/email', 'POST /setup/saved', 'PATCH /settings/email', 'POST /setup/saved']);
  expect(writes()[2].body).toMatchObject({ on: true });
  expect(title()).toBe('Site name and logo');
});

it('with no save due, edits only in greyed fields still block Save and continue (D6)', async () => {
  routes['GET /settings'] = () => [200, settings({ on: false })];
  await render();
  expect(blocked()).toBe(true);                  // saved off, nothing changed
  expect(target.querySelector('.se-reason')?.textContent).toBe(EMAIL_REASON);
  emailSwitch().click();                         // on, a new server, off again
  flushSync();
  type(input('Mail server'), 'smtp.other.dk');
  emailSwitch().click();
  flushSync();
  expect(registry.isAnyDirty()).toBe(true);
  expect(blocked()).toBe(true);                  // nothing a save would write
  expect(target.querySelector('.se-reason')).toBeNull();   // the edits still hide the reason
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([]);
});

it("a passed test's answer stays after the save, also when step saved then fails (D6)", async () => {
  routes['POST /settings/email/test'] = () => [200, { ok: true, message: 'Sent.' }];
  routes['GET /setup'] = () => [200, state()];
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Send test email')!.click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('Sent.');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  expect(target.querySelector('.se-result')?.textContent).toBe('Sent.');
});

const testButton = () => [...card()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Send test email')!;

// Settings Task 5 backlog, Set up's copy of the Email form.
it('Send test does nothing while the step-1 save runs', async () => {
  const d = deferred();
  routes['PATCH /settings/email'] = () => d.promise;
  routes['POST /setup/saved'] = () => [200, state({ step: 2 })];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(testButton().getAttribute('aria-disabled')).toBe('true');
  // The fields hold still with their look (D9): the choices are not disabled.
  const choices = [...card()!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(choices.length).toBeGreaterThan(0);
  expect(choices.every((r) => r.getAttribute('aria-disabled') === 'true' && !r.disabled)).toBe(true);
  testButton().click();
  await settle();
  expect(calls.filter((c) => c.key === 'POST /settings/email/test')).toHaveLength(0);
  d.resolve([200, settings({ host: 'smtp.other.dk' })]);
  await settle();
});

it('a refused step-1 email save replaces the test answer; a new test clears the save error', async () => {
  routes['POST /settings/email/test'] = () => [200, { ok: false, message: 'Could not connect.' }];
  routes['GET /setup'] = () => [200, state()];
  routes['PATCH /settings/email'] = () => [422, { detail: 'Could not connect.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  testButton().click();
  await settle();
  expect(target.querySelector('.se-result')).not.toBeNull();
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Could not connect.');
  expect(target.querySelector('.se-result')).toBeNull();
  testButton().click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('Could not connect.');
  expect(err()).toBeNull();
});

it('a test keeps a "step 1 saved" error: it holds the card (D13)', async () => {
  routes['POST /settings/email/test'] = () => [200, { ok: true, message: 'Sent.' }];
  routes['GET /setup'] = () => [200, state()];
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  testButton().click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('Sent.');
  expect(err()).toBe('Boom.');
  expect(title()).toBe('Email');
});

it('a test that fails keeps a "step 1 saved" error too (D13)', async () => {
  routes['POST /settings/email/test'] = () => [409, { detail: 'The last test is still finishing. Try again in a minute.' }];
  routes['GET /setup'] = () => [200, state()];
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  testButton().click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('The last test is still finishing. Try again in a minute.');
  expect(err()).toBe('Boom.');
});

// Review t4-r2: "newer" goes by start in Set up too.
it('a step-1 test sent before an email save that fails is dropped; the save error stays', async () => {
  const d = deferred();
  routes['POST /settings/email/test'] = () => d.promise;
  routes['GET /setup'] = () => [200, state()];
  routes['PATCH /settings/email'] = () => [422, { detail: 'Could not connect.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  testButton().click();
  await settle();
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Could not connect.');
  d.resolve([200, { ok: true, message: 'Sent.' }]);
  await settle();
  expect(target.querySelector('.se-result')).toBeNull();
  expect(err()).toBe('Could not connect.');
});

it('step 1: the port sentence as a test answer, then as the save error: it shows once', async () => {
  await render();
  type(input('Port'), 'abc');
  testButton().click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('The port must be from 1 to 65535.');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('The port must be from 1 to 65535.');
  expect(target.querySelector('.se-result')).toBeNull();
  expect(writes()).toEqual([]);
});

it('step 1: the port sentence as a save error, then Send test: only the answer shows', async () => {
  await render();
  type(input('Port'), 'abc');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('The port must be from 1 to 65535.');
  testButton().click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('The port must be from 1 to 65535.');
  expect(err()).toBeNull();
  expect(writes()).toEqual([]);
});

it('a step-1 test start clears an email-save error at once', async () => {
  const d = deferred();
  routes['POST /settings/email/test'] = () => d.promise;
  routes['GET /setup'] = () => [200, state()];
  routes['PATCH /settings/email'] = () => [422, { detail: 'Could not connect.' }];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Could not connect.');
  testButton().click();
  await settle();
  expect(err()).toBeNull();
  d.resolve([200, { ok: true, message: 'Sent.' }]);
  await settle();
});

it("step 1's test answer scrolls into view", async () => {
  const spy = vi.fn();
  const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Element.prototype.scrollIntoView = spy;
  try {
    routes['POST /settings/email/test'] = () => [200, { ok: true, message: 'Sent.' }];
    routes['GET /setup'] = () => [200, state()];
    await render();
    testButton().click();
    await settle();
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(spy.mock.contexts).toContain(target.querySelector('.se-result'));
  } finally {
    if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

it("step 1's new answer in the same box scrolls into view again", async () => {
  const spy = vi.fn();
  const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Element.prototype.scrollIntoView = spy;
  try {
    await render();
    type(input('Port'), 'abc');
    testButton().click();
    await settle();
    const result = target.querySelector('.se-result')!;
    testButton().click();
    await settle();
    expect(target.querySelector('.se-result')).toBe(result);
    expect(spy.mock.contexts.filter((c) => c === result)).toHaveLength(2);
  } finally {
    if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

it('the not-done reason stays hidden while "step 1 saved" is due (D6)', async () => {
  const saved = deferred();
  routes['PATCH /settings/email'] = () => [200, settings({ host: 'smtp.other.dk' })];
  routes['POST /setup/saved'] = () => saved.promise;
  routes['GET /setup'] = () => [200, state()];
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(registry.isAnyDirty()).toBe(false);     // the email saved; "step 1 saved" runs
  expect(target.querySelector('.se-reason')).toBeNull();
  saved.resolve([500, { detail: 'Boom.' }]);
  await settle();
  expect(err()).toBe('Boom.');
  expect(target.querySelector('.se-reason')).toBeNull();
});

// --- Step 2: Site name and logo (D7) ---

it('Save and continue waits while a chosen logo is still being read (D7)', async () => {
  routes['GET /branding'] = () => [200, brandingOf('Riverside')];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Lund');
  chooseNow(pngOf(400, 100));
  expect(blocked()).toBe(true);
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([]);
  await until(() => decodes.length > 0);
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

// --- Step 2: Remove, the reason and the retries ---

const removeLogo = () => card()!.querySelector<HTMLButtonElement>('[data-action="remove"]');
const fileLine = () => card()!.querySelector('.im-file')?.textContent ?? null;

it('Remove drops a chosen logo and keeps the saved one; it shows only while a new logo is chosen (U4)', async () => {
  routes['GET /branding'] = () => [200, brandingOf('Riverside', true)];
  await render(state({ step: 2 }, [false, true, false, false]));
  expect(removeLogo()).toBeNull();
  const savedSrc = card()!.querySelector('.im-box img')!.getAttribute('src');
  await choose(pngOf(400, 80), 'new.png');
  decodes[0].resolve();
  await settle();
  expect(fileLine()).toContain('new.png');
  expect(removeLogo()!.textContent!.trim()).toBe('Remove');
  expect(removeLogo()!.getAttribute('aria-label')).toBe('Remove new.png');
  expect(card()!.querySelector('.im-box img')!.getAttribute('src')).not.toBe(savedSrc);
  expect(foot('save')!.textContent!.trim()).toBe('Save and continue');
  removeLogo()!.click();
  flushSync();
  expect(fileLine()).toBeNull();
  expect(removeLogo()).toBeNull();
  expect(card()!.querySelector('.im-box img')!.getAttribute('src')).toBe(savedSrc);
  expect(registry.isAnyDirty()).toBe(false);
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  expect(document.activeElement?.textContent?.trim()).toBe('Choose a PNG…');
  expect(writes()).toEqual([]);
});

it('while a second file is read, Remove waits: it never names the first file nor drops both, and its focus goes to Choose', async () => {
  await render(state({ step: 2 }));
  await choose(pngOf(400, 80), 'first.png');
  decodes[0].resolve();
  await settle();
  expect(removeLogo()!.getAttribute('aria-label')).toBe('Remove first.png');
  removeLogo()!.focus();                             // Safari: a mouse click on Choose leaves focus here
  chooseNow(pngOf(400, 80), 'second.png');           // the read answers in a task
  expect(removeLogo()).toBeNull();
  expect(document.activeElement?.textContent?.trim()).toBe('Choose a PNG…');
  await until(() => decodes.length > 1);
  expect(removeLogo()!.getAttribute('aria-label')).toBe('Remove second.png');
});

it('after a refused logo, Remove clears its sentence and Save and continue sends only "step 2 saved"; a new choice first waits for its decode (U4)', async () => {
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /branding/logo'] = () => [413, {}];
  routes['GET /setup'] = () => [200, state({ step: 2 }, [false, true, false, false])];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('save')!.click();
  await settle();
  expect(err()).toBe("This file is over the server's upload limit.");
  expect(foot('skip')).toBeNull();               // the re-read ticked step 2
  removeLogo()!.click();
  flushSync();
  expect(err()).toBeNull();
  expect(blocked()).toBe(false);
  const before = decodes.length;
  chooseNow(pngOf(400, 80), 'other.png');        // a new choice after the half-save waits for its decode
  await until(() => decodes.length > before);
  expect(blocked()).toBe(true);
  removeLogo()!.click();
  flushSync();
  expect(blocked()).toBe(false);
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name', 'POST /branding/logo', 'POST /setup/saved']);
  expect(title()).toBe('First course and its admin');
});

it("Remove waits while the step's saves run", async () => {
  const logoAnswer = deferred();
  routes['POST /branding/logo'] = () => logoAnswer.promise;
  await render(state({ step: 2 }));
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('save')!.click();
  await settle();
  expect(removeLogo()!.disabled).toBe(true);
  logoAnswer.resolve([500, { detail: 'Boom.' }]);
  await settle();
  expect(removeLogo()!.disabled).toBe(false);
});

it('"The site is still called Mathion." stays hidden after a rename while "step 2 saved" is due (D7)', async () => {
  const saved = deferred();
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /setup/saved'] = () => saved.promise;
  routes['GET /setup'] = () => [200, state({ step: 2 })];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  foot('save')!.click();
  await settle();
  expect(registry.isAnyDirty()).toBe(false);     // the name saved; "step 2 saved" runs
  expect(card()!.textContent).not.toContain('The site is still called Mathion.');
  saved.resolve([500, { detail: 'Boom.' }]);
  await settle();
  expect(err()).toBe('Boom.');
  expect(card()!.textContent).not.toContain('The site is still called Mathion.');
});

it('a newer "step 2 saved" failure replaces an older logo sentence; the retry sends only it (D7)', async () => {
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  let saves = 0;
  routes['POST /setup/saved'] = () => [500, { detail: ++saves === 1 ? 'Boom.' : 'Again.' }];
  routes['GET /setup'] = () => [200, state({ step: 2 })];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  await choose(new Uint8Array([1, 2, 3]), 'notes.txt');
  expect(err()).toBe('The logo must be a PNG file.');
  expect(registry.isAnyDirty()).toBe(false);     // a refusal drops the choice
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Again.');
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name', 'POST /setup/saved', 'POST /setup/saved']);
});

it("a failed step 2 saved holds the card by its error alone, against a re-read that moves it (D3a)", async () => {
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  foot('save')!.click();
  await settle();
  await settle();
  expect(registry.isAnyDirty()).toBe(false);
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(title()).toBe('Site name and logo');
  expect(err()).toBe('Boom.');
});

it('a failed name save re-reads nothing; the retry sends the name, then the logo', async () => {
  routes['PUT /branding/name'] = () => [500, { detail: 'Name failed.' }];
  routes['POST /branding/logo'] = () => [200, brandingOf('Riverside', true)];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Name failed.');
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name']);
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(0);
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['PUT /branding/name', 'PUT /branding/name', 'POST /branding/logo', 'POST /setup/saved']);
  expect(title()).toBe('First course and its admin');
});

it('a done step 2 with a changed name shows Save and continue, which saves the name first', async () => {
  routes['GET /branding'] = () => [200, brandingOf('Riverside')];
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }, [false, true, false, false]));
  type(input('Site name'), 'Lund');
  expect(foot('save')!.textContent!.trim()).toBe('Save and continue');
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([{ key: 'PUT /branding/name', body: { name: 'Lund' } }, { key: 'POST /setup/saved', body: { step: 2 } }]);
});

it("a logo the browser can't decode shows its sentence, and the choice goes", async () => {
  await render(state({ step: 2 }));
  await choose(pngOf(400, 80));
  decodes[0].reject();
  await settle();
  expect(err()).toBe("This PNG can't be shown by a browser.");
  expect(fileLine()).toBeNull();
  expect(blocked()).toBe(true);
});

it("a failed move's sentence replaces the logo's", async () => {
  routes['POST /setup/skip'] = () => [500, { detail: 'Skip failed.' }];
  await render(state({ step: 2 }));
  await choose(new Uint8Array([1, 2, 3]), 'notes.txt');
  expect(err()).toBe('The logo must be a PNG file.');
  foot('skip')!.click();
  await settle();
  expect(err()).toBe('Skip failed.');
});

it('Discard resets a chosen logo with the name', async () => {
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed.' }];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('back')!.click();
  await settle();
  confirmDiscard()!.click();
  await settle();
  expect(err()).toBe('Go failed.');
  expect(input('Site name').value).toBe('Mathion');
  expect(fileLine()).toBeNull();
  expect(registry.isAnyDirty()).toBe(false);
});

it('the Choose click notes an edit for the keep-alive', async () => {
  await render(state({ step: 2 }));
  const note = vi.spyOn(setup, 'noteEdit');
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Choose a PNG…')!.click();
  expect(note).toHaveBeenCalled();
});

it("step 2's values load fresh; a failed load shows the error state with Try again", async () => {
  routes['GET /branding'] = () => [500, { detail: 'Boom.' }];
  await render(state({ step: 2 }));
  expect(card()!.querySelector('.error-state')?.textContent).toContain('Boom.');
  routes['GET /branding'] = () => [200, brandingOf('Riverside')];
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
  await settle();
  expect(input('Site name').value).toBe('Riverside');
  foot('skip')!.click();                         // away and back: read again
  await settle();
  foot('back')!.click();
  await settle();
  expect(title()).toBe('Site name and logo');
  expect(calls.filter((c) => c.key === 'GET /branding')).toHaveLength(3);
});

it('a 401 or 404 on a step 2 save goes to the shell, with no sentence and no re-read', async () => {
  routes['PUT /branding/name'] = () => [401, { detail: 'Not signed in' }];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  foot('save')!.click();
  await settle();
  expect(onAuth).toHaveBeenCalledWith('signin');
  routes['PUT /branding/name'] = (b) => [200, brandingOf((b as { name: string }).name)];
  routes['POST /branding/logo'] = () => [404, { detail: 'Not Found' }];
  await choose(pngOf(400, 80));
  decodes[0].resolve();
  await settle();
  foot('save')!.click();
  await settle();
  expect(onAuth).toHaveBeenCalledWith('expired');
  expect(err()).toBeNull();
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(0);
});

it("while step 2's saves run, the skip button, Back and the list wait (setup.saving)", async () => {
  const nameAnswer = deferred();
  routes['PUT /branding/name'] = () => nameAnswer.promise;
  routes['POST /setup/saved'] = () => [200, state({ step: 3 }, [false, true, false, false])];
  await render(state({ step: 2 }));
  type(input('Site name'), 'Riverside');
  foot('save')!.click();
  await settle();
  expect(setup.saving).toBe(true);
  expect(foot('skip')!.getAttribute('aria-disabled')).toBe('true');
  expect(foot('back')!.getAttribute('aria-disabled')).toBe('true');
  expect(items()[0].getAttribute('aria-disabled')).toBe('true');
  nameAnswer.resolve([200, brandingOf('Riverside')]);
  await settle();
  expect(setup.saving).toBe(false);
  expect(title()).toBe('First course and its admin');
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

// Settings Task 6 backlog: the upload screens in this tab use the new limit
// at once, without a reload.
it("a step-4 limits save updates this tab's upload limit", async () => {
  uploadLimit.mb = 20;                          // afterEach resets it
  routes['PATCH /settings/limits'] = () => [200, { ...settings(), limits: { max_file_mb: 75, max_total_mb: 500 } }];
  routes['POST /setup/saved'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  type(input('Largest file (MB)'), '75');
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toContain('PATCH /settings/limits');
  expect(uploadLimit.mb).toBe(75);
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

// --- Step 4: one error line, the holds and the moves ---

const radio = (value: string) => card()!.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;

it('a half-save in step 4 re-reads the state: the list ticks the step, the typed limits and the error hold the card', async () => {
  routes['PATCH /settings/sign-in'] = () => [200, settings()];
  routes['PATCH /settings/limits'] = () => [422, { detail: 'The largest file is at most 1024 MB.' }];
  routes['GET /setup'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  type(input('A PIN lasts (minutes)'), '15');
  type(input('Largest file (MB)'), '5000');
  foot('save')!.click();
  await settle();
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(mark(4).classList.contains('done')).toBe(true);
  expect(title()).toBe('Sign-in rules and limits');
  expect(err()).toBe('The largest file is at most 1024 MB.');
});

it('a failed step 4 saved holds the card by its error alone, against a re-read that says over (D3a)', async () => {
  routes['POST /setup/keep-sign-in'] = () => [200, state({ step: 4 }, [true, true, true, true])];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state({ step: 1, wizard_on: false }, [true, true, true, true])];
  await render(state({ step: 4 }, [true, true, true, false]));
  foot('save')!.click();
  await settle();
  await settle();
  expect(registry.isAnyDirty()).toBe(false);
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(title()).toBe('Sign-in rules and limits');
  expect(target.querySelector('.as-card')).toBeNull();
  expect(err()).toBe('Boom.');
});

it('"step 4 saved" failing: the retry sends only it, never a second keep-sign-in', async () => {
  routes['POST /setup/keep-sign-in'] = () => [200, state({ step: 4 }, [false, false, false, true])];
  let saves = 0;
  routes['POST /setup/saved'] = () => (++saves === 1 ? [500, { detail: 'Boom.' }] : [200, state({ step: 1 }, [false, false, false, true])]);
  routes['GET /setup'] = () => [200, state({ step: 4 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  expect(title()).toBe('Sign-in rules and limits');
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /setup/keep-sign-in', 'POST /setup/saved', 'POST /setup/saved']);
  expect(title()).toBe('Email');
});

it('a failed keep-sign-in shows its sentence, re-reads nothing, and the retry sends it again', async () => {
  routes['POST /setup/keep-sign-in'] = () => [500, { detail: 'Keep failed.' }];
  routes['POST /setup/saved'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Keep failed.');
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(0);
  routes['POST /setup/keep-sign-in'] = () => [200, state({ step: 4 }, [false, false, false, true])];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /setup/keep-sign-in', 'POST /setup/keep-sign-in', 'POST /setup/saved']);
});

it('a valid sign-in change with invalid limits sends nothing', async () => {
  await render(state({ step: 4 }));
  type(input('A PIN lasts (minutes)'), '15');
  type(input('Largest file (MB)'), '1.5');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Type a whole number of MB.');
  expect(writes()).toEqual([]);
});

it('a limits-only change sends only the limits, then step saved', async () => {
  routes['PATCH /settings/limits'] = () => [200, settings()];
  routes['POST /setup/saved'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  type(input('Largest file (MB)'), '50');
  foot('save')!.click();
  await settle();
  expect(writes()).toEqual([
    { key: 'PATCH /settings/limits', body: { max_file_mb: 50, max_total_mb: 500 } },
    { key: 'POST /setup/saved', body: { step: 4 } },
  ]);
});

it('a Longest sign-in change notes an edit and goes in the sign-in body', async () => {
  routes['PATCH /settings/sign-in'] = () => [200, settings()];
  routes['POST /setup/saved'] = () => [200, state({ step: 1 }, [false, false, false, true])];
  await render(state({ step: 4 }));
  const note = vi.spyOn(setup, 'noteEdit');
  radio('7').click();
  flushSync();
  expect(note).toHaveBeenCalled();
  expect(registry.isAnyDirty()).toBe(true);
  foot('save')!.click();
  await settle();
  expect(writes()[0]).toEqual({ key: 'PATCH /settings/sign-in', body: { pin_minutes: 10, pin_requests_per_hour: 5, pin_failures_per_hour: 10, longest_sign_in_days: 7 } });
});

// A limits error always comes with typed limits, so a move asks first and its
// Discard rebuilds the forms; the error a move can meet is "step 4 saved"'s.
it("a failed move's sentence replaces a failed step saved's", async () => {
  routes['POST /setup/keep-sign-in'] = () => [200, state({ step: 4 }, [false, false, false, true])];
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state({ step: 4 }, [false, false, false, true])];
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed.' }];
  await render(state({ step: 4 }));
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  foot('back')!.click();
  await settle();
  expect(err()).toBe('Go failed.');
});

it('Discard resets both step 4 forms', async () => {
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed.' }];
  await render(state({ step: 4 }));
  type(input('A PIN lasts (minutes)'), '15');
  type(input('Largest file (MB)'), '50');
  foot('back')!.click();
  await settle();
  confirmDiscard()!.click();
  await settle();
  expect(err()).toBe('Go failed.');
  expect(input('A PIN lasts (minutes)').value).toBe('10');
  expect(input('Largest file (MB)').value).toBe('20');
  expect(registry.isAnyDirty()).toBe(false);
});

it("step 4's values load fresh; a failed load shows the error state with Try again", async () => {
  routes['GET /settings'] = () => [500, { detail: 'Boom.' }];
  await render(state({ step: 4 }));
  expect(card()!.querySelector('.error-state')?.textContent).toContain('Boom.');
  routes['GET /settings'] = () => [200, settings()];
  [...card()!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
  await settle();
  expect(input('A PIN lasts (minutes)').value).toBe('10');
  foot('back')!.click();                         // away and back: read again
  await settle();
  items()[3].click();
  await settle();
  expect(title()).toBe('Sign-in rules and limits');
  expect(calls.filter((c) => c.key === 'GET /settings')).toHaveLength(3);
});

it('a 404 on a step 4 save goes to the shell, with no sentence and no re-read', async () => {
  routes['PATCH /settings/sign-in'] = () => [404, { detail: 'Not Found' }];
  await render(state({ step: 4 }));
  type(input('A PIN lasts (minutes)'), '15');
  foot('save')!.click();
  await settle();
  expect(onAuth).toHaveBeenCalledWith('expired');
  expect(err()).toBeNull();
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(0);
  expect(setup.saving).toBe(false);
});

it("while step 4's sequence runs, the skip button, Back and the list wait (setup.saving)", async () => {
  const signInAnswer = deferred();
  const saved = deferred();
  routes['PATCH /settings/sign-in'] = () => signInAnswer.promise;
  routes['POST /setup/saved'] = () => saved.promise;
  await render(state({ step: 4 }));
  type(input('A PIN lasts (minutes)'), '15');
  foot('save')!.click();
  await settle();
  const waiting = () => setup.saving
    && foot('skip')!.getAttribute('aria-disabled') === 'true'
    && foot('back')!.getAttribute('aria-disabled') === 'true'
    && items()[0].getAttribute('aria-disabled') === 'true';
  expect(waiting()).toBe(true);                  // no wizard write yet: only setup.saving
  signInAnswer.resolve([200, settings()]);
  await settle();
  expect(waiting()).toBe(true);                  // "step 4 saved" runs
  saved.resolve([200, state({ step: 1 }, [false, false, false, true])]);
  await settle();
  expect(setup.saving).toBe(false);
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

// --- Step 3: focus, Continue, the done view and the holds ---

/** Enter in a field, with focus in it, as the browser would. */
function enterIn(el: HTMLInputElement) {
  el.focus();
  el.form!.requestSubmit();
}

it('Enter in a field: when the note replaces the fields, focus goes to Continue (D8)', async () => {
  routes['POST /courses'] = () => [200, created()];
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  await render(state({ step: 3 }));
  fillCourse();
  enterIn(input("Admin's email"));
  await settle();
  await settle();
  expect(strip()).not.toBeNull();
  expect(document.activeElement).toBe(foot('save'));
});

it("Enter in a field: when a 409's done view replaces the fields, focus goes to Continue (D8)", async () => {
  routes['POST /courses'] = () => [409, { detail: 'The address statistics-101 is taken.' }];
  routes['GET /setup'] = () => [200, withCourse()];
  await render(state({ step: 3 }));
  fillCourse();
  enterIn(input("Admin's email"));
  await settle();
  await settle();
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  expect(document.activeElement).toBe(foot('save'));
});

it('a step 3 that turned done: emptying the fields shows the done view, focus to Continue, the address follows the name again (D8)', async () => {
  await render(state({ step: 3 }));
  type(input('Course name'), 'Statistics 101');
  type(input('Address'), 'stat');                 // the address no longer follows the name
  routes['GET /setup'] = () => [200, withCourse()];
  await setup.read();                              // another tab made the course; typed values hold the form
  await settle();
  expect(input('Course name').value).toBe('Statistics 101');
  input('Course name').focus();
  type(input('Address'), '');
  type(input('Course name'), '');
  await settle();
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  expect(registry.isAnyDirty()).toBe(false);
  expect(document.activeElement).toBe(foot('save'));
  routes['GET /setup'] = () => [200, state({ step: 3 })];
  await setup.read();                              // the course went again
  await settle();
  type(input('Course name'), 'Algebra');
  expect(input('Address').value).toBe('algebra');
});

it('a failed Continue on the done view, then the course goes: the form comes back empty, with no old sentence (D8)', async () => {
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, withCourse()];
  await render(withCourse());
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  routes['GET /setup'] = () => [200, state({ step: 3 })];
  await setup.read();
  await settle();
  expect(input('Course name').value).toBe('');
  expect(err()).toBeNull();
});

it('Continue on the note sends "step 3 saved" again when the newest state names step 3 (D8)', async () => {
  let saves = 0;
  await render(state({ step: 3 }));
  await create(() => (++saves, [200, state({ step: 4 }, [false, false, true, false])]));
  routes['GET /setup'] = () => [200, state({ step: 3 }, [false, false, true, false])];
  await setup.read();                              // another tab went back to step 3
  await settle();
  expect(strip()).not.toBeNull();
  foot('save')!.click();
  await settle();
  expect(saves).toBe(2);
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved', 'POST /setup/saved']);
  expect(title()).toBe('Sign-in rules and limits');
});

it("a failed Continue on the done view holds the card by its error alone, against a re-read that moves it (D3a)", async () => {
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, withCourse({ step: 4 })];
  await render(withCourse());
  foot('save')!.click();
  await settle();
  await settle();
  expect(registry.isAnyDirty()).toBe(false);
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(setup.state!.step).toBe(4);               // the re-read applied; the card held anyway
  expect(title()).toBe('First course and its admin');
  expect(err()).toBe('Boom.');
});

it('while the course is created, the skip button, Back and the list wait, and a re-read holds the card (setup.saving)', async () => {
  const d = deferred();
  routes['POST /courses'] = () => d.promise;
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  await render(state({ step: 3 }));
  fillCourse();
  foot('save')!.click();
  await settle();
  expect(setup.saving).toBe(true);
  expect(foot('skip')!.getAttribute('aria-disabled')).toBe('true');
  expect(foot('back')!.getAttribute('aria-disabled')).toBe('true');
  expect(items()[0].getAttribute('aria-disabled')).toBe('true');
  routes['GET /setup'] = () => [200, state({ step: 4 })];
  await setup.read();                              // a re-read during the create: the card holds (D3a)
  await settle();
  expect(title()).toBe('First course and its admin');
  d.resolve([200, created()]);
  await settle();
  expect(setup.saving).toBe(false);
  expect(strip()).not.toBeNull();
});

it("a 409 whose re-read fails keeps the form, the typed values and the 409's sentence", async () => {
  routes['GET /setup'] = () => [500, { detail: 'Read failed.' }];
  await render(state({ step: 3 }));
  await create(() => [200, state()], [409, { detail: 'The address statistics-101 is taken.' }]);
  await settle();
  expect(err()).toBe('The address statistics-101 is taken.');
  expect(input('Course name').value).toBe('Statistics 101');
});

it("a 409 whose re-read lands stale (a newer read applied first) keeps the form and the typed values", async () => {
  const first = deferred();
  let reads = 0;
  routes['GET /setup'] = () => (++reads === 1 ? first.promise : [200, state({ step: 3 })]);
  await render(state({ step: 3 }));
  await create(() => [200, state()], [409, { detail: 'The address statistics-101 is taken.' }]);
  await setup.read();                              // a keep-alive read, sent later, answers first
  await settle();
  first.resolve([200, withCourse()]);              // the 409's read: older, so dropped
  await settle();
  expect(err()).toBe('The address statistics-101 is taken.');
  expect(input('Course name').value).toBe('Statistics 101');
  expect(card()!.querySelector('.sc-done')).toBeNull();
});

it('a 401 or 404 on the create goes to the shell, with no sentence and no re-read', async () => {
  await render(state({ step: 3 }));
  await create(() => [200, state()], [401, { detail: 'Not signed in' }]);
  expect(onAuth).toHaveBeenCalledWith('signin');
  routes['POST /courses'] = () => [404, { detail: 'Not Found' }];
  foot('save')!.click();
  await settle();
  expect(onAuth).toHaveBeenCalledWith('expired');
  expect(err()).toBeNull();
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(0);
  expect(setup.saving).toBe(false);
});

it('a failed "step 3 saved" re-reads the state, so the list ticks step 3; a list click then goes', async () => {
  routes['GET /setup'] = () => [200, state({ step: 3 }, [false, false, true, false])];
  await render(state({ step: 3 }));
  await create(() => [500, { detail: 'Boom.' }]);
  expect(calls.filter((c) => c.key === 'GET /setup')).toHaveLength(1);
  expect(mark(3).classList.contains('done')).toBe(true);
  routes['POST /setup/go'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  items()[3].click();
  await settle();
  expect(writes()[2]).toEqual({ key: 'POST /setup/go', body: { step: 4 } });
  expect(title()).toBe('Sign-in rules and limits');
});

it('Discard on step 3 empties the fields, and the address follows the name again', async () => {
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed.' }];
  await render(state({ step: 3 }));
  type(input('Course name'), 'Statistics 101');
  type(input('Address'), 'stat');
  foot('back')!.click();
  await settle();
  confirmDiscard()!.click();
  await settle();
  expect(err()).toBe('Go failed.');
  expect(input('Course name').value).toBe('');
  expect(registry.isAnyDirty()).toBe(false);
  type(input('Course name'), 'Algebra');
  expect(input('Address').value).toBe('algebra');
});

it('Discard on a done step with typed values brings the done view back, focus on the control that asked', async () => {
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed.' }];
  await render(state({ step: 3 }));
  type(input('Course name'), 'Statistics 101');
  routes['GET /setup'] = () => [200, withCourse()];
  await setup.read();
  await settle();
  foot('back')!.focus();
  foot('back')!.click();
  await settle();
  confirmDiscard()!.click();
  await settle();
  await settle();
  expect(err()).toBe('Go failed.');
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  expect(document.activeElement).toBe(foot('back'));   // the failed move's control, not Continue
});

it('a step 3 field edit notes the time for the keep-alive', async () => {
  await render(state({ step: 3 }));
  const note = vi.spyOn(setup, 'noteEdit');
  type(input('Course name'), 'S');
  expect(note).toHaveBeenCalled();
});

it('the no-admin line is not on a done step', async () => {
  await render(withCourse({ course_without_admin: 'Chemometrics' }));
  expect(card()!.textContent).not.toContain('has no admin');
});

it('a failed Back or list click on the done view keeps it, with the move sentence', async () => {
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed.' }];
  await render(withCourse());
  foot('back')!.click();
  await settle();
  expect(err()).toBe('Go failed.');
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed again.' }];
  items()[0].click();
  await settle();
  expect(err()).toBe('Go failed again.');
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
});

it("Continue on a 409's done view sends step saved and moves on", async () => {
  routes['GET /setup'] = () => [200, withCourse()];
  await render(state({ step: 3 }));
  await create(() => [200, state({ step: 4 }, [false, false, true, false])], [409, { detail: 'The address statistics-101 is taken.' }]);
  await settle();
  expect(card()!.querySelector('.sc-done')).not.toBeNull();
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved']);
  expect(title()).toBe('Sign-in rules and limits');
});

it('the done view when the admin is you, and when the admin is disabled', async () => {
  session.user = { id: 1, email: 'aho@uni.dk', full_name: 'Anna Holm', is_superuser: true, is_disabled: false, photo_url: null, has_course_admin: false, has_run_teacher: false };
  await render(withCourse({ email_set_up: false }));
  expect(card()!.querySelector('.sc-done')!.textContent).toBe('A course exists: Statistics 101. You are its admin.');
  expect(card()!.querySelector('code')).toBeNull();
  unmount(cmp!);
  cmp = null;
  session.user = null;
  await render(withCourse({ course: { name: 'Statistics 101', sign_in_url: SIGN_IN, admin: { ...ADMIN, is_disabled: true } } }));
  expect(card()!.querySelector('.sc-done')!.textContent).toBe(
    'A course exists: Statistics 101. Anna Holm is its admin. This account is disabled. Enable it on the Users page so they can sign in.');
});

it('Discard on a step that is not done, a failed move, then Enter: the note still sends focus to Continue', async () => {
  routes['POST /setup/go'] = () => [500, { detail: 'Go failed.' }];
  routes['POST /courses'] = () => [200, created()];
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  await render(state({ step: 3 }));
  type(input('Course name'), 'Statistics 101');
  foot('back')!.click();
  await settle();
  confirmDiscard()!.click();
  await settle();
  await settle();
  expect(err()).toBe('Go failed.');
  fillCourse();
  enterIn(input("Admin's email"));
  await settle();
  await settle();
  expect(strip()).not.toBeNull();
  expect(document.activeElement).toBe(foot('save'));
});

it("the note's failed Continue keeps its sentence when its re-read finds the course gone", async () => {
  let reads = 0;
  routes['GET /setup'] = () => (++reads === 1 ? [200, withCourse()] : [200, state({ step: 3 })]);
  await render(state({ step: 3 }));
  await create(() => [500, { detail: 'Boom.' }]);
  await settle();
  expect(strip()).not.toBeNull();
  expect(err()).toBe('Boom.');
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom again.' }];
  foot('save')!.click();
  await settle();
  await settle();
  expect(reads).toBe(2);
  expect(strip()).not.toBeNull();
  expect(err()).toBe('Boom again.');
});

it('a failed "step 3 saved" under the note: Continue retries it even when the newest state names another step', async () => {
  routes['GET /setup'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  await render(state({ step: 3 }));
  await create(() => [500, { detail: 'Boom.' }]);
  await settle();
  expect(setup.state!.step).toBe(4);               // the failure's re-read
  expect(strip()).not.toBeNull();
  routes['POST /setup/saved'] = () => [200, state({ step: 4 }, [false, false, true, false])];
  foot('save')!.click();
  await settle();
  expect(writes().map((c) => c.key)).toEqual(['POST /courses', 'POST /setup/saved', 'POST /setup/saved']);
  expect(title()).toBe('Sign-in rules and limits');
});

// D13: a test never clears a "step 1 saved" error, also one raised while the
// test runs, after a re-read made the step done (round 7).
it('a "step 1 saved" error raised during a test stays after its answer', async () => {
  let reads = 0;
  const firstRead = deferred();
  const second = deferred();
  let tests = 0;
  routes['POST /settings/email/test'] = () => (++tests === 1 ? [200, { ok: true, message: 'Sent.' }] : second.promise);
  routes['GET /setup'] = () => (++reads === 1 ? firstRead.promise : [200, state({}, [true, false, false, false], [true, false, false, false])]);
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  await render();
  testButton().click();
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('Sent.');
  testButton().click();
  await settle();
  firstRead.resolve([200, state({}, [true, false, false, false], [true, false, false, false])]);
  await settle();
  expect(foot('save')!.textContent!.trim()).toBe('Continue');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');
  second.resolve([200, { ok: true, message: 'Sent again.' }]);
  await settle();
  expect(target.querySelector('.se-result')?.textContent).toBe('Sent again.');
  expect(err()).toBe('Boom.');
});

// D13: an email save's error with the same words as an earlier "step 1 saved"
// error is still a save error: a new test clears it (round 7).
it('a test clears an email save error worded like an earlier "step 1 saved" one', async () => {
  let patches = 0;
  routes['PATCH /settings/email'] = () => (++patches === 1 ? [200, settings({ host: 'smtp.other.dk' })] : [500, { detail: 'Boom.' }]);
  routes['POST /setup/saved'] = () => [500, { detail: 'Boom.' }];
  routes['GET /setup'] = () => [200, state()];
  routes['POST /settings/email/test'] = () => new Promise(() => {});
  await render();
  type(input('Mail server'), 'smtp.other.dk');
  foot('save')!.click();
  await settle();
  expect(err()).toBe('Boom.');                   // "step 1 saved" refused
  type(input('Mail server'), 'smtp.third.dk');
  foot('save')!.click();
  await settle();
  expect(patches).toBe(2);
  expect(err()).toBe('Boom.');                   // now the email save's error
  testButton().click();
  await settle();
  expect(err()).toBeNull();
});
