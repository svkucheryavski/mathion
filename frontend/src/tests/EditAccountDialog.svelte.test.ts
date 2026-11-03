import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EditAccountDialog from '../components/superuser/EditAccountDialog.svelte';
import { ApiError } from '../lib/api';
import type { PanelUser } from '../lib/superuser';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

const ANNA: PanelUser = {
  id: 9, email: 'aho@uni.dk', full_name: 'Anna Holm', is_superuser: false, is_disabled: false,
  created_at: '2026-11-01T10:00:00Z', last_seen_at: null, admin_of: [], teacher_runs: 2, student_runs: 0, has_data: true,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = { user: ANNA, onSave: vi.fn(() => Promise.resolve()), onClose: vi.fn(), onAuth: vi.fn(), ...over };
  cmp = mount(EditAccountDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const field = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const save = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Save')!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const SIGN_IN = 'They will need to sign in again with the new address.';

it('is titled Edit account, with the name focused and both fields filled in (D24)', async () => {
  render(); await settle();
  expect(document.getElementById(panel().getAttribute('aria-labelledby')!)?.textContent).toBe('Edit account');
  expect(document.activeElement).toBe(field('Name'));
  expect(field('Name').value).toBe('Anna Holm');
  expect(field('Email').value).toBe('aho@uni.dk');
  expect(field('Email').type).toBe('email');
});

it('a nameless account starts with an empty name', async () => {
  render({ user: { ...ANNA, full_name: null } }); await settle();
  expect(field('Name').value).toBe('');
});

it('Save is blocked until something changes, and while the email is empty', async () => {
  const p = render(); await settle();
  expect(save().getAttribute('aria-disabled')).toBe('true');
  type(field('Name'), ' Anna Holm ');
  expect(save().getAttribute('aria-disabled')).toBe('true');
  type(field('Email'), 'x@uni.dk');
  expect(save().getAttribute('aria-disabled')).toBeNull();
  type(field('Email'), ' ');
  expect(save().getAttribute('aria-disabled')).toBe('true');
  save().click(); await settle();
  expect(p.onSave).not.toHaveBeenCalled();
});

it('Save sends only the changed fields, trimmed (D19)', async () => {
  const p = render(); await settle();
  type(field('Name'), ' Anna B. Holm ');
  save().click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith({ full_name: 'Anna B. Holm' });
});

it('clearing the name sends no name', async () => {
  const p = render(); await settle();
  type(field('Name'), '  ');
  save().click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith({ full_name: null });
});

it('a changed email says they will sign in again, and sends the email (D19)', async () => {
  const p = render(); await settle();
  expect(panel().textContent).not.toContain(SIGN_IN);
  type(field('Email'), ' anna@uni.dk ');
  expect(panel().textContent).toContain(SIGN_IN);
  save().click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith({ email: 'anna@uni.dk' });
});

it('an email that differs only in case is no change: no warning, nothing to save', async () => {
  render(); await settle();
  type(field('Email'), ANNA.email.toUpperCase());
  expect(panel().textContent).not.toContain(SIGN_IN);
  expect(save().getAttribute('aria-disabled')).toBe('true');
});

it("a 409 keeps the dialog open with the server's sentence and the input", async () => {
  const p = render({ onSave: vi.fn(() => Promise.reject(new ApiError(409, 'An account with this email already exists'))) }); await settle();
  type(field('Email'), 'ole@uni.dk');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe('An account with this email already exists');
  expect(field('Email').value).toBe('ole@uni.dk');
  expect(p.onClose).not.toHaveBeenCalled();
});

it("a superuser's email can't be changed here; the name can (D21)", async () => {
  const p = render({ user: { ...ANNA, is_superuser: true } }); await settle();
  expect(field('Email').readOnly).toBe(true);
  expect(panel().textContent).toContain("A superuser's email can't be changed here.");
  type(field('Name'), 'Sergey');
  save().click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith({ full_name: 'Sergey' });
});
