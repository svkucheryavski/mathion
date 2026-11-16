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
  expect(document.getElementById(panel().querySelector('[role="radiogroup"]')!.getAttribute('aria-labelledby')!)?.textContent).toBe('Encryption');
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

const SAVED_PH = 'Saved: type a new one to replace it';
const NO_USER = "Without a username, the saved password isn't used.";

// Settings Task 5 backlog: the placeholder follows D8a, so it never promises
// a saved password the server would then ask for again.
it('the saved-password hint follows the re-type rule (D8a)', async () => {
  render(); await settle();
  type(field('Port'), '2525');
  pick('SSL/TLS');
  expect(field('Password').placeholder).toBe(SAVED_PH);
  type(field('Mail server'), 'smtp.uni.dk');
  expect(field('Password').placeholder).toBe('');
  type(field('Mail server'), ' smtp.office365.com ');
  expect(field('Password').placeholder).toBe(SAVED_PH);
  type(field('Username'), 'other@uni.dk');
  expect(field('Password').placeholder).toBe('');
  type(field('Username'), 'mathion@uni.dk');
  field("Don't check the server's certificate").click(); flushSync();
  expect(field('Password').placeholder).toBe('');
  field("Don't check the server's certificate").click(); flushSync();
  expect(field('Password').placeholder).toBe(SAVED_PH);
  expect(panel().textContent).not.toContain(NO_USER);
});

it('a saved certificate opt-out kept ticked keeps the saved password (D8a)', async () => {
  render({ email: { ...ON, skip_cert_check: true } }); await settle();
  expect(field("Don't check the server's certificate").checked).toBe(true);
  expect(field('Password').placeholder).toBe(SAVED_PH);
});

// Review t4-r1: the server drops these invisible characters at the ends too.
it('invisible characters a paste brings at the ends change nothing (the server drops them)', async () => {
  render(); await settle();
  type(field('Username'), 'mathion@uni.dk\u200B');
  type(field('Mail server'), '\u200Bsmtp.office365.com');
  expect(field('Password').placeholder).toBe(SAVED_PH);
  type(field('Username'), '\u200B\u2060');
  expect(panel().textContent).toContain(NO_USER);
});

it('a saved password with no saved username: no placeholder, the username note shows', async () => {
  render({ email: { ...ON, username: '' } }); await settle();
  expect(field('Password').placeholder).toBe('');
  expect(panel().textContent).toContain(NO_USER);
  type(field('Username'), '  ');
  expect(field('Password').placeholder).toBe('');
});

it('an edit that only adds invisible characters at the ends leaves Save blocked', async () => {
  render(); await settle();
  type(field('Mail server'), '\u200Bsmtp.office365.com\u2060');
  type(field('Username'), 'mathion@uni.dk\u001F');
  type(field('From address'), '\u2060Mathion <noreply@uni.dk>\u0085');
  expect(save().getAttribute('aria-disabled')).toBe('true');
});

it('a saved certificate opt-out unticked keeps the saved password (D8a: only a newly ticked box asks)', async () => {
  render({ email: { ...ON, skip_cert_check: true } }); await settle();
  field("Don't check the server's certificate").click(); flushSync();
  expect(field('Password').placeholder).toBe(SAVED_PH);
});

it('clearing the username says the saved password is not used, tied to the password field', async () => {
  render(); await settle();
  type(field('Username'), '  ');
  expect(field('Password').placeholder).toBe('');
  const note = [...panel().querySelectorAll<HTMLElement>('.ee-hint')].find((h) => h.textContent === NO_USER)!;
  expect(note).toBeDefined();
  expect(field('Password').getAttribute('aria-describedby')?.split(' ')).toContain(note.id);
  type(field('Username'), 'mathion@uni.dk');
  expect(panel().textContent).not.toContain(NO_USER);
  expect(field('Password').hasAttribute('aria-describedby')).toBe(false);
});

it('no username note without a saved password, or with the switch off', async () => {
  render({ email: { ...ON, password_saved: false } }); await settle();
  type(field('Username'), '');
  expect(panel().textContent).not.toContain(NO_USER);
  unmount(cmp!); cmp = null; target.remove();
  render(); await settle();
  type(field('Username'), '');
  sw().click(); flushSync();
  expect(panel().textContent).not.toContain(NO_USER);
});

// The user's call (2026-11-13): a typed password with no username is dropped
// by a save and by a test, so the form says so.
const TYPED_NO_USER = "Without a username, the password isn't used.";

it('a password typed with no username says it is not used, tied to the password field', async () => {
  render({ email: { ...ON, username: '', password_saved: false } }); await settle();
  expect(panel().textContent).not.toContain(TYPED_NO_USER);
  type(field('Password'), 'secret');
  const note = [...panel().querySelectorAll<HTMLElement>('.ee-hint')].find((h) => h.textContent === TYPED_NO_USER)!;
  expect(note).toBeDefined();
  expect(field('Password').getAttribute('aria-describedby')).toBe(note.id);
  type(field('Username'), 'mathion@uni.dk');
  expect(panel().textContent).not.toContain(TYPED_NO_USER);
  type(field('Username'), '');
  type(field('Password'), '');
  expect(panel().textContent).not.toContain(TYPED_NO_USER);
  expect(field('Password').hasAttribute('aria-describedby')).toBe(false);
});

// Review t4-r12: such a password would be thrown away, so it is no change.
it('a password typed with no username leaves Save off', async () => {
  render({ email: { ...ON, username: '', password_saved: false } }); await settle();
  type(field('Password'), 'secret');
  expect(save().getAttribute('aria-disabled')).toBe('true');
  type(field('Username'), 'mathion@uni.dk');
  expect(save().getAttribute('aria-disabled')).not.toBe('true');
});

it('a typed password replaces the saved-password note, and none shows with the switch off', async () => {
  render(); await settle();
  type(field('Username'), '');
  expect(panel().textContent).toContain(NO_USER);
  type(field('Password'), 'secret');
  expect(panel().textContent).toContain(TYPED_NO_USER);
  expect(panel().textContent).not.toContain(NO_USER);
  sw().click(); flushSync();
  expect(panel().textContent).not.toContain(TYPED_NO_USER);
});

it("a saved password that can't be read says so, with no placeholder (D8)", async () => {
  render({ email: { ...ON, password_unreadable: true } }); await settle();
  expect(panel().textContent).toContain("The saved password can't be read on this server: type it again.");
  expect(field('Password').placeholder).toBe('');
});

// Settings Whole-branch backlog: off needs no password (D7c).
it('the unreadable-password hint is tied to the password field', async () => {
  render({ email: { ...ON, password_unreadable: true } }); await settle();
  const hint = panel().querySelector<HTMLElement>('.ee-warn')!;
  expect(field('Password').getAttribute('aria-describedby')).toBe(hint.id);
});

it('the unreadable-password hint hides with email off', async () => {
  render({ email: { ...ON, password_unreadable: true } }); await settle();
  sw().click(); flushSync();
  expect(panel().textContent).not.toContain("can't be read on this server");
});

it('the unreadable-password hint gives way to the username note when the username is cleared', async () => {
  render({ email: { ...ON, password_unreadable: true } }); await settle();
  type(field('Username'), '');
  expect(panel().textContent).not.toContain("can't be read on this server");
  expect(panel().textContent).toContain(NO_USER);
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
  expect(result.parentElement!.getAttribute('role')).toBe('status');
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
  render({ test: vi.fn(() => Promise.reject(new ApiError(409, 'The last test is still finishing. Try again in a minute.'))) });
  await settle();
  footButton('Send test email')!.click(); await settle();
  const result = panel().querySelector<HTMLElement>('.ee-result')!;
  expect(result.textContent).toBe('The last test is still finishing. Try again in a minute.');
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
  fail(new ApiError(409, 'The last test is still finishing. Try again in a minute.')); await settle();
  expect(panel().querySelector('.ee-result')).toBeNull();
});

it('changing a field clears the last result', async () => {
  render(); await settle();
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('.ee-result')).not.toBeNull();
  type(field('Port'), '2525');
  expect(panel().querySelector('.ee-result')).toBeNull();
});

// Settings Task 5 backlog: a test started mid-save would be a needless
// 20-second server test.
it('Send test does nothing while Save runs', async () => {
  let finish: () => void = () => {};
  const p = render({ save: vi.fn(() => new Promise<void>((r) => { finish = r; })) });
  await settle();
  type(field('From address'), 'Maths <noreply@uni.dk>');
  save().click(); await settle();
  expect(footButton('Send test email')!.getAttribute('aria-disabled')).toBe('true');
  footButton('Send test email')!.click(); await settle();
  expect(p.test).not.toHaveBeenCalled();
  finish(); await settle();
});

// D9 (rev 9): the greyed look stays for email off while a save runs.
it('with email off, the fields stay greyed during Save', async () => {
  render({ save: vi.fn(() => new Promise<void>(() => {})) });
  await settle();
  sw().click(); flushSync();
  save().click(); await settle();
  for (const label of ['Mail server', 'Port', 'Username', 'Password', 'From address', "Don't check the server's certificate"]) {
    expect(field(label).disabled).toBe(true);
  }
  for (const r of [radio('STARTTLS'), radio('SSL/TLS')]) expect(r.disabled).toBe(true);
});

it('the encryption choice and the certificate box hold still during Save', async () => {
  let fail: (e: unknown) => void = () => {};
  render({ save: vi.fn(() => new Promise<void>((_, r) => { fail = r; })) });
  await settle();
  type(field('From address'), 'Maths <noreply@uni.dk>');
  save().click(); await settle();
  const box = field("Don't check the server's certificate");
  for (const el of [radio('STARTTLS'), radio('SSL/TLS'), box]) {
    expect(el.disabled).toBe(false);
    expect(el.getAttribute('aria-disabled')).toBe('true');
  }
  radio('SSL/TLS').click(); box.click(); await settle();
  expect(radio('STARTTLS').checked).toBe(true);
  expect(field('Port').value).toBe('587');
  expect(box.checked).toBe(false);
  fail(new ApiError(422, 'Nope.')); await settle();
  for (const el of [radio('SSL/TLS'), box]) expect(el.hasAttribute('aria-disabled')).toBe(false);
  box.click(); flushSync();
  expect(box.checked).toBe(true);
});

// Settings Task 5 backlog: a save error and a test result that say the same
// thing never show together; the newer one stays.
it('only the newer of a save error and a test result shows', async () => {
  render({
    save: vi.fn(() => Promise.reject(new ApiError(422, 'The mail server refused the login.'))),
    test: vi.fn(() => Promise.resolve({ ok: false, message: 'The mail server refused the login.' })),
  });
  await settle();
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('.ee-result')).not.toBeNull();
  type(field('From address'), 'Maths <noreply@uni.dk>');
  footButton('Send test email')!.click(); await settle();
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('The mail server refused the login.');
  expect(panel().querySelector('.ee-result')).toBeNull();
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('.ee-result')?.textContent).toBe('The mail server refused the login.');
  expect(panel().querySelector('[role="alert"]')).toBeNull();
});

// Review t4-r1: "newer" goes by when each started, so a test sent before a
// save that then fails can't wipe the save's error with an older answer.
it('a test started before a save that fails is dropped; the save error stays', async () => {
  let finish: (r: { ok: boolean; message: string }) => void = () => {};
  render({
    save: vi.fn(() => Promise.reject(new ApiError(503, 'Could not reach the server.'))),
    test: vi.fn(() => new Promise((r) => { finish = r; })),
  });
  await settle();
  type(field('From address'), 'Maths <noreply@uni.dk>');
  footButton('Send test email')!.click(); await settle();
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')).not.toBeNull();
  finish({ ok: true, message: 'Sent to su@uni.dk: check your inbox.' }); await settle();
  expect(panel().querySelector('.ee-result')).toBeNull();
  expect(panel().querySelector('[role="alert"]')).not.toBeNull();
});

it('the port sentence as a save error, then Send test: only the answer shows', async () => {
  render(); await settle();
  type(field('Port'), 'abc');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('The port must be from 1 to 65535.');
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('.ee-result')?.textContent).toBe('The port must be from 1 to 65535.');
  expect(panel().querySelector('[role="alert"]')).toBeNull();
});

it('a test start clears the save error at once, before its answer', async () => {
  render({
    save: vi.fn(() => Promise.reject(new ApiError(422, 'The mail server refused the login.'))),
    test: vi.fn(() => new Promise(() => {})),
  });
  await settle();
  type(field('From address'), 'Maths <noreply@uni.dk>');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')).not.toBeNull();
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('[role="alert"]')).toBeNull();
});

it('the port sentence shows once: as the answer to a test, then as the save error', async () => {
  const p = render(); await settle();
  type(field('Port'), 'abc');
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('.ee-result')?.textContent).toBe('The port must be from 1 to 65535.');
  expect(panel().querySelector('[role="alert"]')).toBeNull();
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('The port must be from 1 to 65535.');
  expect(panel().querySelector('.ee-result')).toBeNull();
  expect(p.test).not.toHaveBeenCalled();
  expect(p.save).not.toHaveBeenCalled();
});

// Settings Task 5 backlog: on a short screen the answer could sit below the
// fold of the dialog's scrolling body.
it('the test answer scrolls into view', async () => {
  const spy = vi.fn();
  const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Element.prototype.scrollIntoView = spy;
  try {
    render(); await settle();
    footButton('Send test email')!.click(); await settle();
    const result = panel().querySelector('.ee-result')!;
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(spy.mock.contexts).toContain(result);
  } finally {
    if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

// The answer box stays in place when a new answer replaces the old one; it
// still scrolls into view again (round 5).
it('a new answer in the same box scrolls into view again', async () => {
  const spy = vi.fn();
  const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Element.prototype.scrollIntoView = spy;
  try {
    render(); await settle();
    type(field('Port'), 'abc');
    footButton('Send test email')!.click(); await settle();
    const result = panel().querySelector('.ee-result')!;
    footButton('Send test email')!.click(); await settle();
    expect(panel().querySelector('.ee-result')).toBe(result);
    expect(spy.mock.contexts.filter((c) => c === result)).toHaveLength(2);
  } finally {
    if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

// A refused save's error sits where the answer sits, at the end of the
// scrolling body: it scrolls into view too (round 5).
it("a refused save's error scrolls into view", async () => {
  const spy = vi.fn();
  const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Element.prototype.scrollIntoView = spy;
  try {
    render({ save: vi.fn(() => Promise.reject(new ApiError(422, 'The mail server refused the login.'))) });
    await settle();
    type(field('From address'), 'Maths <noreply@uni.dk>');
    save().click(); await settle();
    const err = panel().querySelector('[role="alert"]')!;
    expect(err.textContent).toBe('The mail server refused the login.');
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(spy.mock.contexts).toContain(err);
  } finally {
    if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

it('Cancel closes without saving', async () => {
  const p = render(); await settle();
  type(field('Mail server'), 'x');
  footButton('Cancel')!.click(); await settle();
  expect(p.onClose).toHaveBeenCalled();
  expect(p.save).not.toHaveBeenCalled();
});

it('opened with email off, focus starts on the switch (the fields are disabled)', async () => {
  render({ email: OFF }); await settle();
  expect(document.activeElement).toBe(sw());
});

it('the test result fills a status region that is there, empty, before it', async () => {
  render(); await settle();
  const live = panel().querySelector<HTMLElement>('.live-slot[role="status"]')!;
  expect(live.textContent).toBe('');
  expect(live.matches(':empty')).toBe(true);
  type(field('Mail server'), 'smtp.uni.dk');
  footButton('Send test email')!.click(); await settle();
  expect(panel().querySelector('.live-slot[role="status"]')).toBe(live);
  expect(live.querySelector('.ee-result')?.textContent).toBe('Sent to su@uni.dk: check your inbox.');
  expect(live.querySelector('.ee-result')!.hasAttribute('role')).toBe(false);
});

it('the Encryption radiogroup is named by its visible caption', async () => {
  render(); await settle();
  const group = panel().querySelector<HTMLElement>('[role="radiogroup"]')!;
  const id = group.getAttribute('aria-labelledby')!;
  expect(document.getElementById(id)?.textContent).toBe('Encryption');
  expect(group.hasAttribute('aria-label')).toBe(false);
});
