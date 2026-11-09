import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserSetup from '../pages/superuser/SuperuserSetup.svelte';
import { SetupStore } from '../lib/setupStore.svelte';
import type { PanelSetup } from '../lib/setup';
import type { PanelSettings } from '../lib/superuser';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import * as router from '../lib/router.svelte';

// Set up D3-D6: the page frame, its moves, All set and step 1 (Email).

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
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); flushSync(); }

type Answer = [number, unknown];
type Handler = (body: unknown) => Answer | Promise<Answer>;
let routes: Record<string, Handler>;
let calls: { key: string; body: unknown }[];
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let setup: SetupStore;
let registry: DirtyRegistry;
let onAuth: ReturnType<typeof vi.fn>;

beforeEach(() => {
  calls = [];
  routes = {
    'GET /settings': () => [200, settings()],
    'POST /setup/skip': (b) => [200, state({ step: (b as { step: number }).step + 1 }, [false, false, false, false], [true, false, false, false])],
    'POST /setup/go': (b) => [200, state({ step: (b as { step: number }).step })],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('/api/superuser/T', '')}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
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
  target.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(s: PanelSetup = state()) {
  setup.state = s;
  cmp = mount(SuperuserSetup, {
    target, props: { setup, token: 'T', onAuth }, context: new Map([[DIRTY_REGISTRY_KEY, registry]]),
  });
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
const writes = () => calls.filter((c) => c.key.startsWith('POST /setup') || c.key.startsWith('PATCH'));
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
  expect(title()).toBe('First course');
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
  expect(title()).toBe('First course');
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
  expect(title()).toBe('First course');
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
  expect(title()).toBe('First course');
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
