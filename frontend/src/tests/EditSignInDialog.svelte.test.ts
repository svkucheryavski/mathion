import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EditSignInDialog from '../components/superuser/EditSignInDialog.svelte';
import { ApiError } from '../lib/api';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

const RULES = { pin_minutes: 10, pin_requests_per_hour: 3, pin_failures_per_hour: 5, longest_sign_in_days: 30 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = { signIn: RULES, onAuth: vi.fn(), onClose: vi.fn(), onDone: vi.fn(), save: vi.fn(() => Promise.resolve()), ...over };
  cmp = mount(EditSignInDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const field = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const save = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Save')!;
const radio = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.closest('label')!.textContent!.trim() === label)!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const MINUTES = 'A PIN lasts (minutes)';
const REQUESTS = 'PIN requests per hour';
const TRIES = 'Wrong PIN tries per hour';

it('is titled Edit sign-in and shows the saved rules (D12)', async () => {
  render(); await settle();
  expect(document.getElementById(panel().getAttribute('aria-labelledby')!)?.textContent).toBe('Edit sign-in');
  expect(field(MINUTES).value).toBe('10');
  expect(field(REQUESTS).value).toBe('3');
  expect(field(TRIES).value).toBe('5');
  expect(radio('30 days').checked).toBe(true);
});

it('Longest sign-in is three segments: 1, 7 or 30 days (D12)', async () => {
  render(); await settle();
  expect(panel().querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Longest sign-in');
  expect([...panel().querySelectorAll('[role="radiogroup"] .segment')].map((s) => s.textContent!.trim()))
    .toEqual(['1 day', '7 days', '30 days']);
});

it('Save is blocked until a change, and sends every rule as a number', async () => {
  const p = render(); await settle();
  expect(save().getAttribute('aria-disabled')).toBe('true');
  radio('7 days').click(); flushSync();
  expect(save().getAttribute('aria-disabled')).toBeNull();
  type(field(MINUTES), '15');
  save().click(); await settle();
  expect(p.save).toHaveBeenCalledWith({ pin_minutes: 15, pin_requests_per_hour: 3, pin_failures_per_hour: 5, longest_sign_in_days: 7 });
  expect(p.onDone).toHaveBeenCalled();
});

it('a value that is not a whole number is refused here and not sent', async () => {
  const p = render(); await settle();
  type(field(TRIES), 'five');
  save().click(); await settle();
  expect(p.save).not.toHaveBeenCalled();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Type a whole number.');
});

it("the server's sentence shows in the dialog (D5)", async () => {
  render({ save: vi.fn(() => Promise.reject(new ApiError(422, 'PIN requests per hour must be from 3 to 20.'))) });
  await settle();
  type(field(REQUESTS), '2');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('PIN requests per hour must be from 3 to 20.');
});
