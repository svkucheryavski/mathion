import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EditLimitsDialog from '../components/superuser/EditLimitsDialog.svelte';
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
  const props = {
    limits: { max_file_mb: 20, max_total_mb: 500 }, onAuth: vi.fn(), onClose: vi.fn(), onDone: vi.fn(),
    save: vi.fn(() => Promise.resolve()), ...over,
  };
  cmp = mount(EditLimitsDialog, { target, props });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const field = (label: string) => [...panel().querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent?.trim() === label)!;
const save = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Save')!;
function type(el: HTMLInputElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const LARGEST = 'Largest file (MB)';
const TOTAL = 'Files per course version or run, in total (MB)';
const PROXY = "Uploads also pass the server's proxy. With mathion tls, an up-to-date mathion allows 50 MB; another proxy must allow at least this.";

it('is titled Edit file limits and shows the saved limits in whole MB (D11)', async () => {
  render(); await settle();
  expect(document.getElementById(panel().getAttribute('aria-labelledby')!)?.textContent).toBe('Edit file limits');
  expect(field(LARGEST).value).toBe('20');
  expect(field(TOTAL).value).toBe('500');
  expect(field(LARGEST).getAttribute('inputmode')).toBe('numeric');
  expect(document.activeElement).toBe(field(LARGEST));
});

it("the proxy sentence sits under Largest file, verbatim, with the commands as code (D11c)", async () => {
  render(); await settle();
  const note = panel().querySelector<HTMLElement>('.el-proxy')!;
  expect(note.textContent).toBe(PROXY);
  expect([...note.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['mathion tls', 'mathion']);
  expect(field(LARGEST).compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(note.compareDocumentPosition(field(TOTAL)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('Save is blocked until a value changes, and sends both as whole numbers', async () => {
  const p = render(); await settle();
  expect(save().getAttribute('aria-disabled')).toBe('true');
  type(field(LARGEST), ' 50 ');
  expect(save().getAttribute('aria-disabled')).toBeNull();
  save().click(); await settle();
  expect(p.save).toHaveBeenCalledWith({ max_file_mb: 50, max_total_mb: 500 });
  expect(p.onDone).toHaveBeenCalled();
});

it('a value that is not a whole number of MB is refused here and not sent', async () => {
  const p = render(); await settle();
  type(field(TOTAL), '2.5');
  save().click(); await settle();
  expect(p.save).not.toHaveBeenCalled();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Type a whole number of MB.');
});

it("the server's sentence shows in the dialog (D5)", async () => {
  const p = render({ save: vi.fn(() => Promise.reject(new ApiError(422, "The total can't be smaller than the largest file."))) });
  await settle();
  type(field(TOTAL), '10');
  save().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent).toBe("The total can't be smaller than the largest file.");
  expect(p.onDone).not.toHaveBeenCalled();
});
