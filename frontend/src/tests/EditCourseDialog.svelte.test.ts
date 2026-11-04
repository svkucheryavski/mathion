import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EditCourseDialog from '../components/superuser/EditCourseDialog.svelte';
import { ApiError } from '../lib/api';
import type { PanelCourse } from '../lib/superuser';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'existing', full_name: 'A' }),
    { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  if (cmp) unmount(cmp); cmp = null; target?.remove();
  document.documentElement.style.overflow = '';
  vi.useRealTimers(); vi.restoreAllMocks();
});

const STAT: PanelCourse = {
  id: 1, name: 'Statistics 101', slug: 'stat', version_count: 2, run_count: 2, student_count: 37,
  admin: { id: 9, email: 'aho@uni.dk', full_name: 'Anna Holm', is_disabled: false },
};
const ONE: PanelCourse = { ...STAT, id: 3, name: 'Algebra', slug: 'alg', admin: null, run_count: 1, student_count: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = {
    token: 'T', course: STAT, onAuth: vi.fn(), onClose: vi.fn(), onDone: vi.fn(),
    saveFields: vi.fn(() => Promise.resolve()), saveAdmin: vi.fn(() => Promise.resolve()), ...over,
  };
  cmp = mount(EditCourseDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const field = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const save = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Save')!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const WARN = 'Links people saved or shared with the old address will stop working: 2 runs, 37 students.';

it('is titled Edit course, with the name focused and the three fields filled in (D24)', async () => {
  render(); await settle();
  expect(document.getElementById(panel().getAttribute('aria-labelledby')!)?.textContent).toBe('Edit course');
  expect(document.activeElement).toBe(field('Course name'));
  expect(field('Course name').value).toBe('Statistics 101');
  expect(field('Address').value).toBe('stat');
  expect(field("Admin's email").value).toBe('aho@uni.dk');
  expect(field("Admin's email").type).toBe('email');
});

it('a course without an admin starts with an empty email field', async () => {
  render({ course: { ...STAT, admin: null } }); await settle();
  expect(field("Admin's email").value).toBe('');
});

it('Save is blocked until something changes, and while the name or address is empty', async () => {
  const p = render(); await settle();
  expect(save().getAttribute('aria-disabled')).toBe('true');
  type(field('Course name'), 'Statistics 102');
  expect(save().getAttribute('aria-disabled')).toBeNull();
  type(field('Address'), '  ');
  expect(save().getAttribute('aria-disabled')).toBe('true');
  save().click(); await settle();
  expect(p.saveFields).not.toHaveBeenCalled();
  type(field('Address'), 'stat');
  type(field('Course name'), ' Statistics 101 ');
  expect(save().getAttribute('aria-disabled')).toBe('true');
});

it('the address warning shows only while the address differs, singular for one (D11)', async () => {
  render(); await settle();
  expect(panel().textContent).not.toContain('Links people saved');
  type(field('Address'), 'stat-2');
  expect(panel().textContent).toContain(WARN);
  type(field('Address'), 'stat');
  expect(panel().textContent).not.toContain('Links people saved');
  unmount(cmp!); cmp = null; target.remove();
  render({ course: ONE }); await settle();
  type(field('Address'), 'alg-2');
  expect(panel().textContent).toContain('Links people saved or shared with the old address will stop working: 1 run, 1 student.');
});

it('a course with no runs and no students warns without counts (D11 rev 10: not "0 runs, 0 students")', async () => {
  render({ course: { ...ONE, run_count: 0, student_count: 0 } }); await settle();
  type(field('Address'), 'alg-2');
  expect(panel().textContent).toContain('Links people saved or shared with the old address will stop working.');
  expect(panel().textContent).not.toContain('0 runs');
});

it('Save sends only the changed fields, trimmed, in one request, then is done', async () => {
  const p = render(); await settle();
  type(field('Course name'), ' Statistics 102 ');
  type(field('Address'), 'stat-2');
  save().click(); await settle();
  expect(p.saveFields).toHaveBeenCalledTimes(1);
  expect(p.saveFields).toHaveBeenCalledWith({ name: 'Statistics 102', slug: 'stat-2' });
  expect(p.saveAdmin).not.toHaveBeenCalled();
  expect(p.onDone).toHaveBeenCalledTimes(1);
});

it('a changed email alone sets the admin and touches nothing else (D9)', async () => {
  const p = render(); await settle();
  type(field("Admin's email"), ' new@x ');
  save().click(); await settle();
  expect(p.saveFields).not.toHaveBeenCalled();
  expect(p.saveAdmin).toHaveBeenCalledWith('new@x');
  expect(p.onDone).toHaveBeenCalledTimes(1);
});

it('clearing the email says the course will have no admin, and Save removes the admin (D9)', async () => {
  const p = render(); await settle();
  expect(panel().textContent).not.toContain('will have no admin');
  type(field("Admin's email"), '');
  expect(panel().textContent).toContain('Statistics 101 will have no admin.');
  save().click(); await settle();
  expect(p.saveAdmin).toHaveBeenCalledWith(null);
  expect(p.onDone).toHaveBeenCalledTimes(1);
});

it('an empty email on a course without an admin is no change', async () => {
  render({ course: { ...STAT, admin: null } }); await settle();
  type(field("Admin's email"), '  ');
  expect(save().getAttribute('aria-disabled')).toBe('true');
  expect(panel().textContent).not.toContain('will have no admin');
});

it('name and address are saved before the admin', async () => {
  const order: string[] = [];
  const p = render({
    saveFields: vi.fn(async () => { order.push('fields'); }),
    saveAdmin: vi.fn(async () => { order.push('admin'); }),
  }); await settle();
  type(field('Course name'), 'Statistics 102');
  type(field("Admin's email"), 'new@x');
  save().click(); await settle();
  expect(order).toEqual(['fields', 'admin']);
  expect(p.onDone).toHaveBeenCalledTimes(1);
});

it('when the admin step fails, the dialog stays with the sentence and Save retries only the admin', async () => {
  const saveAdmin = vi.fn()
    .mockRejectedValueOnce(new ApiError(409, 'This account was deleted'))
    .mockResolvedValueOnce(undefined);
  const p = render({ saveAdmin }); await settle();
  type(field('Address'), 'stat-2');
  type(field("Admin's email"), 'new@x');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe('This account was deleted');
  expect(p.onDone).not.toHaveBeenCalled();
  expect(field('Address').value).toBe('stat-2');
  expect(field("Admin's email").value).toBe('new@x');
  // The address is saved now: no warning, and the retry does not send it again.
  expect(panel().textContent).not.toContain('Links people saved');
  save().click(); await settle();
  expect(p.saveFields).toHaveBeenCalledTimes(1);
  expect(saveAdmin).toHaveBeenCalledTimes(2);
  expect(p.onDone).toHaveBeenCalledTimes(1);
});

it('when the first step fails, the admin is not sent', async () => {
  const p = render({ saveFields: vi.fn(() => Promise.reject(new ApiError(409, 'This address is already used by another course'))) });
  await settle();
  type(field('Address'), 'chem');
  type(field("Admin's email"), 'new@x');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe('This address is already used by another course');
  expect(p.saveAdmin).not.toHaveBeenCalled();
  expect(p.onDone).not.toHaveBeenCalled();
  expect(panel().textContent).toContain(WARN);
});

it('the guard 404 goes to the shell, with no sentence in the dialog', async () => {
  const p = render({ saveFields: vi.fn(() => Promise.reject(new ApiError(404, 'Not Found'))) }); await settle();
  type(field('Course name'), 'X');
  save().click(); await settle();
  expect(p.onAuth).toHaveBeenCalledWith('expired');
  expect(panel().querySelector('[role="alert"]')).toBeNull();
});

it('the email has the account hint after a pause', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'new', full_name: null }),
    { status: 200, headers: { 'content-type': 'application/json' } })));
  render(); await settle();
  type(field("Admin's email"), 'new@x');
  await vi.advanceTimersByTimeAsync(260); await settle();
  expect(panel().querySelector('.account-hint')?.textContent?.trim()).toBe('No account yet: one will be created.');
});

it('Cancel closes without saving', async () => {
  const p = render(); await settle();
  type(field('Course name'), 'X');
  [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Cancel')!.click();
  expect(p.onClose).toHaveBeenCalled();
  expect(p.saveFields).not.toHaveBeenCalled();
});
