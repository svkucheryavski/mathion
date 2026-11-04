import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NewCourseDialog from '../components/superuser/NewCourseDialog.svelte';
import { ApiError } from '../lib/api';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.useRealTimers(); vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = { token: 'T', onSave: vi.fn(() => Promise.resolve()), onClose: vi.fn(), onAuth: vi.fn(), ...over };
  cmp = mount(NewCourseDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const field = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const create = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Create')!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }

it('is titled New course, with the name focused and three labelled fields', async () => {
  vi.stubGlobal('fetch', vi.fn());
  render(); await settle();
  const id = panel().getAttribute('aria-labelledby')!;
  expect(document.getElementById(id)?.textContent).toBe('New course');
  expect(document.activeElement).toBe(field('Course name'));
  expect(field('Address')).toBeTruthy();
  expect(field("Admin's email").type).toBe('email');
});

it('the address follows the name until the address is edited, then stays (D13)', async () => {
  vi.stubGlobal('fetch', vi.fn());
  render(); await settle();
  type(field('Course name'), 'Kemometri på dansk');
  expect(field('Address').value).toBe('kemometri-paa-dansk');
  type(field('Course name'), 'Ωμέγα');
  expect(field('Address').value).toBe('');
  type(field('Address'), 'omega');
  type(field('Course name'), 'Omega course');
  expect(field('Address').value).toBe('omega');
});

it('Create is blocked until name, address and email are filled', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { status: 'existing', full_name: 'A' })));
  const p = render(); await settle();
  expect(create().getAttribute('aria-disabled')).toBe('true');
  type(field('Course name'), 'Statistics 101');
  expect(create().getAttribute('aria-disabled')).toBe('true');
  type(field("Admin's email"), '  ');
  create().click(); await settle();
  expect(p.onSave).not.toHaveBeenCalled();
  type(field("Admin's email"), ' AHO@uni.dk ');
  expect(create().getAttribute('aria-disabled')).toBeNull();
  create().click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith({ name: 'Statistics 101', slug: 'statistics-101', admin_email: 'AHO@uni.dk' });
});

it("a rejected save shows the server's sentence and keeps every field", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { status: 'existing', full_name: 'A' })));
  const p = render({ onSave: vi.fn(() => Promise.reject(new ApiError(409, 'This address is already used by another course'))) });
  await settle();
  type(field('Course name'), 'Statistics 101');
  type(field("Admin's email"), 'a@x');
  create().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe('This address is already used by another course');
  expect([field('Course name').value, field('Address').value, field("Admin's email").value]).toEqual(['Statistics 101', 'statistics-101', 'a@x']);
  expect(p.onClose).not.toHaveBeenCalled();
});

it('the email hint says an account will be created, or that it is disabled, after a 250 ms pause; newest reply wins', async () => {
  vi.useFakeTimers();
  const answers: Record<string, unknown> = {
    'new@x': { status: 'new', full_name: null },
    'off@x': { status: 'disabled', full_name: 'Off' },
    'on@x': { status: 'existing', full_name: 'On' },
  };
  const f = vi.fn(async (_url: string, init?: RequestInit) => jsonResponse(200, answers[JSON.parse(String(init!.body)).email]));
  vi.stubGlobal('fetch', f);
  render(); await settle();
  const hint = () => panel().querySelector('.account-hint')?.textContent?.trim() ?? '';
  type(field("Admin's email"), 'new@x');
  await vi.advanceTimersByTimeAsync(200); await settle();
  expect(f).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60); await settle();
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/T/accounts/lookup');
  expect(hint()).toBe('No account yet: one will be created.');
  type(field("Admin's email"), 'off@x');
  expect(hint()).toBe('');
  await vi.advanceTimersByTimeAsync(260); await settle();
  expect(hint()).toBe("This account is disabled: they can't sign in until you enable it.");
  type(field("Admin's email"), 'on@x');
  await vi.advanceTimersByTimeAsync(260); await settle();
  expect(hint()).toBe('');
  // No lookup for a value that can't be an email.
  type(field("Admin's email"), 'anna');
  await vi.advanceTimersByTimeAsync(260); await settle();
  expect(f).toHaveBeenCalledTimes(3);
});

it('a stale lookup reply never overwrites a newer one', async () => {
  vi.useFakeTimers();
  let releaseFirst!: (r: Response) => void;
  const f = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((r) => { releaseFirst = r; }))
    .mockImplementationOnce(async () => jsonResponse(200, { status: 'disabled', full_name: null }));
  vi.stubGlobal('fetch', f);
  render(); await settle();
  type(field("Admin's email"), 'new@x');
  await vi.advanceTimersByTimeAsync(260); await settle();
  type(field("Admin's email"), 'off@x');
  await vi.advanceTimersByTimeAsync(260); await settle();
  releaseFirst(jsonResponse(200, { status: 'new', full_name: null }));
  await settle();
  expect(panel().querySelector('.account-hint')?.textContent?.trim()).toBe("This account is disabled: they can't sign in until you enable it.");
});

it('a lookup 404 goes to onAuth', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { detail: 'Not Found' })));
  const p = render(); await settle();
  type(field("Admin's email"), 'a@x');
  await vi.advanceTimersByTimeAsync(260); await settle();
  expect(p.onAuth).toHaveBeenCalledWith('expired');
});
