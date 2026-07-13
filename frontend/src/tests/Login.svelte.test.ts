import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Login from '../pages/Login.svelte';
import * as router from '../lib/router.svelte';

const FAKE_USER = {
  id: 1, email: 'a@b.com', full_name: 'A', is_superuser: false,
  is_disabled: false, photo_url: null, has_course_admin: false, has_run_teacher: false,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
function setValue(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function buttonByText(t: HTMLElement, text: string): HTMLButtonElement | null {
  return (Array.from(t.querySelectorAll('button')) as HTMLButtonElement[])
    .find((b) => (b.textContent ?? '').trim() === text) ?? null;
}
function submitForm(t: HTMLElement) {
  t.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  sessionStorage.clear();
  history.replaceState(null, '', '/login');
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

it('renders neither form until config resolves (render-gate) and fires no request-pin', async () => {
  const f = vi.fn((url: string) => {
    if (String(url).includes('/api/auth/config')) return new Promise(() => {}); // never resolves
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  expect(target.querySelector('form')).toBeNull();
  expect(f.mock.calls.some((c) => String(c[0]).includes('/request-pin'))).toBe(false);
});

it('send_pin_enabled=false: direct email+PIN entry submits to verify-pin, never request-pin', async () => {
  vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  const f = vi.fn((url: string) => {
    const s = String(url);
    if (s.includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: false }));
    if (s.includes('/verify-pin')) return Promise.resolve(jsonResponse(200, { user: FAKE_USER }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  setValue(target.querySelector('input[name="email"]')!, 'a@b.com');
  setValue(target.querySelector('input[name="pin"]')!, '123456');
  await settle();
  submitForm(target);
  await settle();
  const urls = f.mock.calls.map((c) => String(c[0]));
  expect(urls.some((u) => u.includes('/verify-pin'))).toBe(true);
  expect(urls.some((u) => u.includes('/request-pin'))).toBe(false);
});

it('send_pin_enabled=true: two-step flow shows delivery-neutral copy', async () => {
  const f = vi.fn((url: string) => {
    const s = String(url);
    if (s.includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: true }));
    if (s.includes('/request-pin')) return Promise.resolve(jsonResponse(200, { message: 'PIN sent' }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  setValue(target.querySelector('input[name="email"]')!, 'a@b.com');
  await settle();
  submitForm(target);
  await settle();
  const text = target.textContent ?? '';
  expect(text).not.toMatch(/sent to a@b\.com/i);
  expect(text).not.toMatch(/to your inbox/i);
  expect(text).toMatch(/a 6-digit PIN has been sent|check your email/i);
});

it('config-fetch failure resolves to two-step and enables submit', async () => {
  const f = vi.fn((url: string) => {
    if (String(url).includes('/api/auth/config')) return Promise.reject(new TypeError('network'));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  const emailInput = target.querySelector('input[name="email"]') as HTMLInputElement;
  expect(emailInput).not.toBeNull();
  setValue(emailInput, 'a@b.com');
  await settle();
  expect(buttonByText(target, 'Send PIN')?.disabled).toBe(false);
});

it('captures + clears superuser_return_path on mount and navigates there after verify', async () => {
  sessionStorage.setItem('superuser_return_path', '/superuser/tok');
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  const f = vi.fn((url: string) => {
    const s = String(url);
    if (s.includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: false }));
    if (s.includes('/verify-pin')) return Promise.resolve(jsonResponse(200, { user: FAKE_USER }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  expect(sessionStorage.getItem('superuser_return_path')).toBeNull(); // cleared on mount
  setValue(target.querySelector('input[name="email"]')!, 'a@b.com');
  setValue(target.querySelector('input[name="pin"]')!, '123456');
  await settle();
  submitForm(target);
  await settle();
  expect(navSpy).toHaveBeenCalledWith('/superuser/tok', { replace: true });
});

it('a stale return path from a prior mount does not survive to a later login', async () => {
  sessionStorage.setItem('superuser_return_path', '/superuser/stale');
  const f = vi.fn((url: string) => {
    if (String(url).includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: true }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  unmount(component); component = null;
  component = mount(Login, { target });
  await settle();
  expect(sessionStorage.getItem('superuser_return_path')).toBeNull();
});
