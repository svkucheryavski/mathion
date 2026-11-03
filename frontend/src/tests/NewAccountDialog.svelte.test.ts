import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NewAccountDialog from '../components/superuser/NewAccountDialog.svelte';
import { ApiError } from '../lib/api';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = { onSave: vi.fn(() => Promise.resolve()), onClose: vi.fn(), onAuth: vi.fn(), ...over };
  cmp = mount(NewAccountDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const field = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const button = (label: string) => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label)!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }

it('is titled New account, with the email focused and an optional name (D17)', async () => {
  render(); await settle();
  expect(document.getElementById(panel().getAttribute('aria-labelledby')!)?.textContent).toBe('New account');
  expect(document.activeElement).toBe(field('Email'));
  expect(field('Email').type).toBe('email');
  expect(field('Name (optional)')).toBeTruthy();
});

it('Create is blocked until the email is filled; it sends the trimmed email and name', async () => {
  const p = render(); await settle();
  expect(button('Create').getAttribute('aria-disabled')).toBe('true');
  type(field('Email'), '  ');
  button('Create').click(); await settle();
  expect(p.onSave).not.toHaveBeenCalled();
  type(field('Email'), ' new@uni.dk ');
  type(field('Name (optional)'), ' Ole Dahl ');
  button('Create').click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith({ email: 'new@uni.dk', full_name: 'Ole Dahl' });
});

it('an empty name is sent as no name', async () => {
  const p = render(); await settle();
  type(field('Email'), 'new@uni.dk');
  type(field('Name (optional)'), '   ');
  button('Create').click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith({ email: 'new@uni.dk', full_name: null });
});

it("a 409 shows the server's sentence and keeps the fields", async () => {
  render({ onSave: vi.fn(() => Promise.reject(new ApiError(409, 'An account with this email already exists'))) }); await settle();
  type(field('Email'), 'aho@uni.dk');
  button('Create').click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe('An account with this email already exists');
  expect(field('Email').value).toBe('aho@uni.dk');
});
