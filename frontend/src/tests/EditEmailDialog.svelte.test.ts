import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EditEmailDialog from '../components/superuser/EditEmailDialog.svelte';
import { ApiError } from '../lib/api';
import type { PanelEmailSettings } from '../lib/superuser';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

const ON: PanelEmailSettings = {
  on: true, host: 'smtp.office365.com', port: 587, encryption: 'starttls', skip_cert_check: false,
  username: 'mathion@uni.dk', password_saved: true, password_unreadable: false,
  from_address: 'Mathion <noreply@uni.dk>', dev_mode: null, card_test: null, failing: null,
};
const OFF: PanelEmailSettings = {
  ...ON, on: false, host: '', port: 587, username: '', password_saved: false, from_address: '',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = {
    email: ON, onAuth: vi.fn(), onClose: vi.fn(), onDone: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
    test: vi.fn(() => Promise.resolve({ ok: true, message: 'Sent to su@uni.dk: check your inbox.' })),
    ...over,
  };
  cmp = mount(EditEmailDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const field = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const footButton = (text: string) => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === text);
const save = () => footButton('Save')!;
const sw = () => panel().querySelector<HTMLButtonElement>('button[role="switch"]')!;
const radio = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.closest('label')!.textContent!.trim() === label)!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
function pick(label: string) { radio(label).click(); flushSync(); }

it('is titled Edit email and shows the saved values; the password field is always empty (D7, D8)', async () => {
  render(); await settle();
  expect(document.getElementById(panel().getAttribute('aria-labelledby')!)?.textContent).toBe('Edit email');
  expect(sw().getAttribute('aria-checked')).toBe('true');
  expect(sw().labels?.[0]?.textContent?.trim()).toBe('Send email');
  expect(field('Mail server').value).toBe('smtp.office365.com');
  expect(field('Port').value).toBe('587');
  expect(radio('STARTTLS').checked).toBe(true);
  expect(field('Username').value).toBe('mathion@uni.dk');
  expect(field('Password').value).toBe('');
  expect(field('Password').type).toBe('password');
  expect(field('From address').value).toBe('Mathion <noreply@uni.dk>');
  expect(field("Don't check the server's certificate").checked).toBe(false);
  expect(document.activeElement).toBe(field('Mail server'));
});

it('Encryption is three segments; picking one sets the usual port, which stays editable (D7)', async () => {
  render(); await settle();
  expect(panel().querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Encryption');
  expect([...panel().querySelectorAll('[role="radiogroup"] .segment')].map((s) => s.textContent!.trim()))
    .toEqual(['STARTTLS', 'SSL/TLS', 'None']);
  expect(panel().textContent).toContain('Picking one sets the usual port: 587, 465 or 25.');
  pick('SSL/TLS');
  expect(field('Port').value).toBe('465');
  pick('None');
  expect(field('Port').value).toBe('25');
  pick('STARTTLS');
  expect(field('Port').value).toBe('587');
  type(field('Port'), '2525');
  expect(field('Port').value).toBe('2525');
});

it('the username hint, and autocomplete off / new-password on the login fields (D7)', async () => {
  render(); await settle();
  expect(panel().textContent).toContain('Leave empty to send without logging in.');
  expect(field('Username').getAttribute('autocomplete')).toBe('off');
  expect(field('Password').getAttribute('autocomplete')).toBe('new-password');
});

it('the password placeholder shows only when a password is saved (D8)', async () => {
  render(); await settle();
  expect(field('Password').placeholder).toBe('Saved: type a new one to replace it');
  unmount(cmp!); cmp = null; target.remove();
  render({ email: { ...ON, password_saved: false } }); await settle();
  expect(field('Password').placeholder).toBe('');
});

it("a saved password that can't be read says so, with no placeholder (D8)", async () => {
  render({ email: { ...ON, password_unreadable: true } }); await settle();
  expect(panel().textContent).toContain("The saved password can't be read on this server: type it again.");
  expect(field('Password').placeholder).toBe('');
});

it('the switch off greys the fields and hides Send test email (D7c)', async () => {
  render(); await settle();
  expect(footButton('Send test email')).toBeDefined();
  sw().click(); flushSync();
  expect(sw().getAttribute('aria-checked')).toBe('false');
  for (const label of ['Mail server', 'Port', 'Username', 'Password', 'From address', "Don't check the server's certificate"]) {
    expect(field(label).disabled).toBe(true);
  }
  expect(radio('STARTTLS').disabled).toBe(true);
  expect(footButton('Send test email')).toBeUndefined();
});

it('Save is blocked until something changes', async () => {
  const p = render(); await settle();
  expect(save().getAttribute('aria-disabled')).toBe('true');
  save().click(); await settle();
  expect(p.save).not.toHaveBeenCalled();
  type(field('From address'), 'Maths <noreply@uni.dk>');
  expect(save().getAttribute('aria-disabled')).toBeNull();
  type(field('From address'), ' Mathion <noreply@uni.dk> ');
  expect(save().getAttribute('aria-disabled')).toBe('true');
  type(field('Password'), 'pw');
  expect(save().getAttribute('aria-disabled')).toBeNull();
});

it('an off save sends the switch alone (D7c)', async () => {
  const p = render(); await settle();
  sw().click(); flushSync();
  save().click(); await settle();
  expect(p.save).toHaveBeenCalledWith({ on: false });
  expect(p.onDone).toHaveBeenCalled();
});

it('an on save sends every field, trimmed, the port as a number, and password only when typed', async () => {
  const p = render(); await settle();
  type(field('Mail server'), ' smtp.uni.dk ');
  save().click(); await settle();
  expect(p.save).toHaveBeenLastCalledWith({
    on: true, host: 'smtp.uni.dk', port: 587, encryption: 'starttls', skip_cert_check: false,
    username: 'mathion@uni.dk', from_address: 'Mathion <noreply@uni.dk>',
  });
  unmount(cmp!); cmp = null; target.remove();
  const q = render(); await settle();
  pick('SSL/TLS');
  field("Don't check the server's certificate").click(); flushSync();
  type(field('Password'), 'S3cret pw');
  save().click(); await settle();
  expect(q.save).toHaveBeenLastCalledWith({
    on: true, host: 'smtp.office365.com', port: 465, encryption: 'ssl', skip_cert_check: true,
    username: 'mathion@uni.dk', password: 'S3cret pw', from_address: 'Mathion <noreply@uni.dk>',
  });
});

it('turning email on from off sends the fields', async () => {
  const p = render({ email: OFF }); await settle();
  expect(field('Mail server').disabled).toBe(true);
  sw().click(); flushSync();
  expect(field('Mail server').disabled).toBe(false);
  type(field('Mail server'), 'relay.uni.dk');
  pick('None');
  type(field('From address'), 'noreply@uni.dk');
  save().click(); await settle();
  expect(p.save).toHaveBeenCalledWith({
    on: true, host: 'relay.uni.dk', port: 25, encryption: 'none', skip_cert_check: false,
    username: '', from_address: 'noreply@uni.dk',
  });
});

it("a port that isn't a whole number is refused here with the server's sentence", async () => {
  const p = render(); await settle();
  type(field('Port'), '58x');
  save().click(); await settle();
  expect(p.save).not.toHaveBeenCalled();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('The port must be from 1 to 65535.');
});

it("the server's 422 sentence shows in the dialog and the dialog stays open (D5)", async () => {
  const p = render({ save: vi.fn(() => Promise.reject(new ApiError(422, 'A login needs encryption: pick STARTTLS or SSL/TLS.'))) });
  await settle();
  pick('None');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('A login needs encryption: pick STARTTLS or SSL/TLS.');
  expect(p.onDone).not.toHaveBeenCalled();
});

it('Send test email sends the form as it is now, and the result shows above the buttons (D9)', async () => {
  const p = render(); await settle();
  type(field('Mail server'), 'smtp.uni.dk');
  footButton('Send test email')!.click(); await settle();
  expect(p.test).toHaveBeenCalledWith({
    host: 'smtp.uni.dk', port: 587, encryption: 'starttls', skip_cert_check: false,
    username: 'mathion@uni.dk', from_address: 'Mathion <noreply@uni.dk>',
  });
  const result = panel().querySelector<HTMLElement>('.ee-result')!;
  expect(result.textContent).toBe('Sent to su@uni.dk: check your inbox.');
  expect(result.classList.contains('ok')).toBe(true);
  expect(result.getAttribute('role')).toBe('status');
  // Above the buttons: the last thing in the body, before the footer.
  expect(result.compareDocumentPosition(panel().querySelector('footer.modal-foot')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(p.save).not.toHaveBeenCalled();
});

it('a failed test shows its reason as an error', async () => {
  render({ test: vi.fn(() => Promise.resolve({ ok: false, message: 'The mail server refused the login.' })) });
  await settle();
  footButton('Send test email')!.click(); await settle();
  const result = panel().querySelector<HTMLElement>('.ee-result')!;
  expect(result.textContent).toBe('The mail server refused the login.');
  expect(result.classList.contains('err')).toBe(true);
});

it('while a test runs the button spins, and Save and Cancel stay usable (D9)', async () => {
  let finish: (r: { ok: boolean; message: string }) => void = () => {};
  const p = render({ test: vi.fn(() => new Promise((r) => { finish = r; })) });
  await settle();
  footButton('Send test email')!.click(); await settle();
  expect(footButton('Send test email')!.getAttribute('aria-busy')).toBe('true');
  // A second click waits for the first.
  footButton('Send test email')!.click(); await settle();
  expect(p.test).toHaveBeenCalledTimes(1);
  expect(footButton('Cancel')!.disabled).toBe(false);
  type(field('From address'), 'Maths <noreply@uni.dk>');
  save().click(); await settle();
  expect(p.save).toHaveBeenCalled();
  finish({ ok: true, message: 'Sent to su@uni.dk: check your inbox.' }); await settle();
});

it("a 409 answer to the test shows its sentence where the result shows (D9)", async () => {
  render({ test: vi.fn(() => Promise.reject(new ApiError(409, 'A test is already running.'))) });
  await settle();
  footButton('Send test email')!.click(); await settle();
  const result = panel().querySelector<HTMLElement>('.ee-result')!;
  expect(result.textContent).toBe('A test is already running.');
  expect(result.classList.contains('err')).toBe(true);
});

it('a 404 from the test goes to the shell', async () => {
  const p = render({ test: vi.fn(() => Promise.reject(new ApiError(404, 'Not Found'))) });
  await settle();
  footButton('Send test email')!.click(); await settle();
  expect(p.onAuth).toHaveBeenCalledWith('expired');
  expect(panel().querySelector('.ee-result')).toBeNull();
});

it('a test answer that arrives after a field changed is dropped: it was about other values', async () => {
  let finish: (r: { ok: boolean; message: string }) => void = () => {};
  render({ test: vi.fn(() => new Promise((r) => { finish = r; })) });
  await settle();
  footButton('Send test email')!.click(); await settle();
  pick('SSL/TLS');
  finish({ ok: false, message: 'The mail server didn\'t answer within 20 seconds.' }); await settle();
  expect(panel().querySelector('.ee-result')).toBeNull();
  expect(footButton('Send test email')!.getAttribute('aria-busy')).toBeNull();
});

it('a failed test answer that arrives after the switch went off is dropped too', async () => {
  let fail: (e: unknown) => void = () => {};
  render({ test: vi.fn(() => new Promise((_r, j) => { fail = j; })) });
  await settle();
  footButton('Send test email')!.click(); await settle();
  sw().click(); flushSync();
  sw().click(); flushSync();
  fail(new ApiError(409, 'A test is already running.')); await settle();
  expect(panel().querySelector('.ee-result')).toBeNull();
});

it('changing a field clears the last result', async () => {
  render(); await settle();
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('.ee-result')).not.toBeNull();
  type(field('Port'), '2525');
  expect(panel().querySelector('.ee-result')).toBeNull();
});

it('Cancel closes without saving', async () => {
  const p = render(); await settle();
  type(field('Mail server'), 'x');
  footButton('Cancel')!.click(); await settle();
  expect(p.onClose).toHaveBeenCalled();
  expect(p.save).not.toHaveBeenCalled();
});
