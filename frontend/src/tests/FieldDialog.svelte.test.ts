import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import FieldDialog from '../components/superuser/FieldDialog.svelte';
import { ApiError } from '../lib/api';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); document.documentElement.style.overflow = ''; vi.restoreAllMocks(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = {
    title: 'Change address', label: 'Address', value: 'stat',
    onSave: vi.fn(() => Promise.resolve()), onClose: vi.fn(), onAuth: vi.fn(), ...over,
  };
  cmp = mount(FieldDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const input = () => panel().querySelector<HTMLInputElement>('input')!;
const save = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Save')!;
function type(v: string) { input().value = v; input().dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }

it('is a small dialog titled by its heading, with the field focused and labelled', async () => {
  render(); await settle();
  expect(panel().style.getPropertyValue('--modal-w')).toBe('440px');
  const id = panel().getAttribute('aria-labelledby')!;
  expect(document.getElementById(id)?.textContent).toBe('Change address');
  expect(document.activeElement).toBe(input());
  expect(input().value).toBe('stat');
  expect(input().labels?.[0]?.textContent?.trim()).toBe('Address');
});

it('takes an email type, a hint snippet, a warning and a save label', async () => {
  render({
    type: 'email', value: 'a@x', saveLabel: 'Change email',
    warning: 'They will need to sign in again with the new address.',
    hint: createRawSnippet(() => ({ render: () => '<span class="the-hint">New account</span>' })),
  });
  await settle();
  expect(input().type).toBe('email');
  expect(panel().querySelector('.the-hint')?.textContent).toBe('New account');
  expect(panel().textContent).toContain('They will need to sign in again with the new address.');
  expect([...panel().querySelectorAll('footer.modal-foot button')].map((b) => b.textContent!.trim())).toEqual(['Cancel', 'Change email']);
});

it('blocks Save while the value is unchanged or empty', async () => {
  const p = render(); await settle();
  expect(save().getAttribute('aria-disabled')).toBe('true');
  save().click(); await settle();
  type('   '); expect(save().getAttribute('aria-disabled')).toBe('true');
  type(' stat '); expect(save().getAttribute('aria-disabled')).toBe('true');
  save().click(); await settle();
  expect(p.onSave).not.toHaveBeenCalled();
  type('stats'); expect(save().getAttribute('aria-disabled')).toBeNull();
});

it('saves the trimmed value, busy while it runs; Enter in the field saves too', async () => {
  let release!: () => void;
  const p = render({ onSave: vi.fn(() => new Promise<void>((r) => { release = r; })) });
  await settle();
  type('  stats  ');
  save().click(); await settle();
  expect(p.onSave).toHaveBeenCalledWith('stats');
  expect(save().getAttribute('aria-busy')).toBe('true');
  save().click(); await settle();
  expect(p.onSave).toHaveBeenCalledTimes(1);
  release(); await settle();
  expect(save().getAttribute('aria-busy')).toBeNull();
  input().form!.requestSubmit(); await settle();
  expect(p.onSave).toHaveBeenCalledTimes(2);
});

it("a rejected save shows the server's sentence and keeps the typed value (D25)", async () => {
  const p = render({ onSave: vi.fn(() => Promise.reject(new ApiError(409, 'This address is already used by another course'))) });
  await settle();
  type('algebra');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe('This address is already used by another course');
  expect(input().value).toBe('algebra');
  expect(input().getAttribute('aria-invalid')).toBe('true');
  expect(p.onClose).not.toHaveBeenCalled();
  // Typing again clears the message.
  type('algebra-2');
  expect(panel().querySelector('[role="alert"]')).toBeNull();
});

it('a 422 shows its sentence; a guard 404 goes to onAuth and shows nothing here', async () => {
  const p = render({ onSave: vi.fn(() => Promise.reject(new ApiError(422, [{ loc: ['body', 'slug'], msg: 'Value error, Enter an address', type: 'value_error' }]))) });
  await settle();
  type('x'); save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Enter an address');
  (p.onSave as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.reject(new ApiError(404, 'Not Found')));
  type('y'); save().click(); await settle();
  expect(p.onAuth).toHaveBeenCalledWith('expired');
  expect(panel().querySelector('[role="alert"]')).toBeNull();
});

it('Esc, × and Cancel call onClose', async () => {
  const p = render(); await settle();
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle();
  expect(p.onClose).toHaveBeenCalledTimes(1);
  [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Cancel')!.click();
  expect(p.onClose).toHaveBeenCalledTimes(2);
  panel().querySelector<HTMLButtonElement>('button[data-glyph="close"]')!.click();
  expect(p.onClose).toHaveBeenCalledTimes(3);
});
