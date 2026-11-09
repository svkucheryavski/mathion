import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import FinishCard from '../components/superuser/FinishCard.svelte';
import { SetupStore } from '../lib/setupStore.svelte';
import type { PanelSetup } from '../lib/setup';
import * as router from '../lib/router.svelte';

// Set up D12: the Finish setting up card on the Dashboard.

function state(done: boolean[], over: Partial<PanelSetup> = {}): PanelSetup {
  const reasons = ['Not tested yet: send a test email.', 'The site is still called Mathion.', null, null];
  return {
    wizard_on: false, step: 1,
    steps: done.map((d, i) => ({ passed: true, done: d, reason: d ? null : reasons[i] })),
    course: null, course_without_admin: null, email_set_up: false, pin_minutes: 10, defaults_in_use: true,
    ...over,
  };
}
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let setup: SetupStore;
let onAuth: ReturnType<typeof vi.fn>;
let calls: string[];
let keepAnswer: [number, unknown];

beforeEach(() => {
  calls = [];
  keepAnswer = [200, state([false, true, false, true])];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/superuser/T/setup/keep-sign-in') return jsonResponse(...keepAnswer);
    return jsonResponse(500, { detail: `no route ${url}` });
  }));
  target = document.createElement('div');
  document.body.appendChild(target);
  onAuth = vi.fn();
  setup = new SetupStore('T', onAuth);
});
afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  setup.dispose();
  target.remove();
  vi.restoreAllMocks();
});

function render(s: PanelSetup) {
  setup.state = s;
  cmp = mount(FinishCard, { target, props: { setup, token: 'T', onAuth } });
  flushSync();
}
const lines = () => [...target.querySelectorAll<HTMLElement>('.fc-line')];
const keep = () => target.querySelector<HTMLButtonElement>('[data-action="keep"]');

it('"Finish setting up" and "<n> of 4 done"', () => {
  render(state([false, true, true, false]));
  expect(target.querySelector('.fc-title')?.textContent).toBe('Finish setting up');
  expect(target.querySelector('.fc-count')?.textContent).toBe('2 of 4 done');
  render2(state([false, false, false, true]));
  expect(target.querySelector('.fc-count')?.textContent).toBe('1 of 4 done');
});
function render2(s: PanelSetup) { setup.state = s; flushSync(); }

it('one line per step not done: the title, " — ", the reason, then the links', () => {
  render(state([false, false, false, false], { course_without_admin: 'Chemometrics' }));
  expect(lines().map((l) => l.querySelector('.fc-text')?.textContent)).toEqual([
    'Email — Not tested yet: send a test email.',
    'Site name and logo — The site is still called Mathion.',
    'First course and its admin — Chemometrics has no admin',
    "Sign-in rules and limits (Mathion's defaults are in use)",
  ]);
});

it('a line without a reason is the title alone', () => {
  render(state([true, true, false, false], { defaults_in_use: false }));
  expect(lines().map((l) => l.querySelector('.fc-text')?.textContent)).toEqual([
    'First course and its admin', 'Sign-in rules and limits',
  ]);
});

it("every Do it now link has the page's href and is followed in the same tab", () => {
  const nav = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
  render(state([false, false, false, false]));
  const links = lines().map((l) => l.querySelector<HTMLAnchorElement>('a')!);
  expect(links.map((a) => a.textContent)).toEqual(['Do it now', 'Do it now', 'Do it now', 'Do it now']);
  expect(links.map((a) => a.getAttribute('href'))).toEqual([
    '/superuser/T/settings', '/superuser/T/branding', '/superuser/T/courses', '/superuser/T/settings',
  ]);
  expect(links.every((a) => !a.hasAttribute('target'))).toBe(true);
  links[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  expect(nav).toHaveBeenCalledWith('/superuser/T/branding');
});

it('only the Sign-in line has Keep these values', () => {
  render(state([false, false, false, false]));
  expect(lines().map((l) => l.querySelector('[data-action="keep"]')?.textContent?.trim() ?? null)).toEqual([
    null, null, null, 'Keep these values',
  ]);
});

it('Keep these values sends the keep write, and its answer takes the line away', async () => {
  render(state([false, true, false, false]));
  keep()!.click();
  await settle();
  expect(calls).toEqual(['POST /api/superuser/T/setup/keep-sign-in']);
  expect(lines().map((l) => l.querySelector('.fc-text')?.textContent)).toEqual([
    'Email — Not tested yet: send a test email.', 'First course and its admin',
  ]);
  expect(target.querySelector('.fc-count')?.textContent).toBe('2 of 4 done');
});

it('a failed keep shows the sentence in the card and keeps the line', async () => {
  keepAnswer = [500, { detail: 'Boom.' }];
  render(state([true, true, true, false]));
  keep()!.click();
  await settle();
  expect(target.querySelector('[role="alert"]')?.textContent).toBe('Boom.');
  expect(lines()).toHaveLength(1);
  expect(onAuth).not.toHaveBeenCalled();
});

it("a keep's 404 goes to the shell", async () => {
  keepAnswer = [404, { detail: 'Not Found' }];
  render(state([true, true, true, false]));
  keep()!.click();
  await settle();
  expect(onAuth).toHaveBeenCalledWith('expired');
});

it('no card when every step is done, or before the state is known', () => {
  render(state([true, true, true, true]));
  expect(target.querySelector('.fc-card')).toBeNull();
  render2(null as unknown as PanelSetup);
  expect(target.querySelector('.fc-card')).toBeNull();
});
