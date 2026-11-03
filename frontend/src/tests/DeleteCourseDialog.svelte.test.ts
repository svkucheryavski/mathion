import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DeleteCourseDialog from '../components/superuser/DeleteCourseDialog.svelte';
import { ApiError } from '../lib/api';
import type { PanelCourse } from '../lib/superuser';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); document.documentElement.style.overflow = ''; vi.restoreAllMocks(); });

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const COURSE: PanelCourse = { id: 4, name: 'Chemometrics', slug: 'chem', admin: null, version_count: 2, run_count: 0, student_count: 0 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(progress: number, over: Record<string, any> = {}) {
  const f = vi.fn(async (..._a: Parameters<typeof fetch>) => jsonResponse(200, { progress_students: progress }));
  vi.stubGlobal('fetch', f);
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = { token: 'T', course: COURSE, onDelete: vi.fn(() => Promise.resolve()), onClose: vi.fn(), onAuth: vi.fn(), ...over };
  cmp = mount(DeleteCourseDialog, { target, props });
  flushSync();
  return { props, f };
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const input = () => panel().querySelector<HTMLInputElement>('input')!;
const del = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Delete course')!;
function type(v: string) { input().value = v; input().dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }

it('asks for the impact and names what goes', async () => {
  const { f } = render(14); await settle();
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/T/courses/4/delete-impact');
  const id = panel().getAttribute('aria-labelledby')!;
  expect(document.getElementById(id)?.textContent).toBe('Delete course');
  expect(panel().textContent).toContain("Delete Chemometrics? Its 2 versions and their files go too. This can't be undone.");
  expect(panel().textContent).toContain('Also deletes the progress of 14 students (pages visited, quiz answers).');
  expect(document.activeElement).toBe(input());
});

it('says nothing of progress when nobody has any; singular forms for one', async () => {
  render(0, { course: { ...COURSE, version_count: 1 } }); await settle();
  expect(panel().textContent).not.toContain('Also deletes the progress');
  expect(panel().textContent).toContain('Its 1 version and its files go too.');
  unmount(cmp!); cmp = null; target.remove();
  render(1); await settle();
  expect(panel().textContent).toContain('Also deletes the progress of 1 student (pages visited, quiz answers).');
});

it('Delete stays blocked until the trimmed typed name matches exactly, case included', async () => {
  const { props } = render(0); await settle();
  expect(del().getAttribute('aria-disabled')).toBe('true');
  type('chemometrics');
  expect(del().getAttribute('aria-disabled')).toBe('true');
  del().click(); await settle();
  expect(props.onDelete).not.toHaveBeenCalled();
  type('  Chemometrics ');
  expect(del().getAttribute('aria-disabled')).toBeNull();
  del().click(); await settle();
  expect(props.onDelete).toHaveBeenCalledTimes(1);
});

it("a refused delete shows the server's sentence and stays open", async () => {
  const { props } = render(0, { onDelete: vi.fn(() => Promise.reject(new ApiError(409, "This course has runs and can't be deleted"))) });
  await settle();
  type('Chemometrics');
  del().click(); await settle();
  expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe("This course has runs and can't be deleted");
  expect(props.onClose).not.toHaveBeenCalled();
  expect(input().value).toBe('Chemometrics');
});

it('an impact 404 goes to onAuth; Cancel closes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { detail: 'Not Found' })));
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = { token: 'T', course: COURSE, onDelete: vi.fn(), onClose: vi.fn(), onAuth: vi.fn() };
  cmp = mount(DeleteCourseDialog, { target, props });
  await settle();
  expect(props.onAuth).toHaveBeenCalledWith('expired');
  [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Cancel')!.click();
  expect(props.onClose).toHaveBeenCalled();
});
