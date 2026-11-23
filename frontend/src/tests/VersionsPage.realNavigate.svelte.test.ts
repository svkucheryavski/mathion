import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Polish 3 C8: the REAL router — no navigate mock — so the create form's
// DirtyGuard runs on every navigation, a successful Create's included.
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../lib/olx/readExport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/olx/readExport')>();
  return { ...real, readExport: vi.fn() };
});
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, post: vi.fn(), delete: vi.fn() } };
});

import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { api } from '../lib/api';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { Version } from '../lib/types';
import { readExport } from '../lib/olx/readExport';

const postMock = vi.mocked(api.post);

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: '',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(async () => {
  postMock.mockReset();
  await navigate('/courses/c', { force: true });
  versionsPageState.course = { id: 1, slug: 'c', name: 'Applied Linear Algebra', description: '', is_admin: true };
  versionsPageState.versions = [mkVersion({ id: 7 })];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(async () => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
  __resetGuardsForTests();
  await navigate('/', { force: true });
});

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
async function openDirtyForm(label = 'Spring') {
  component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
  await settle();
  target.querySelector<HTMLButtonElement>('button.add-line')!.click();
  await settle();
  const input = target.querySelector<HTMLInputElement>('input.new-label')!;
  input.value = label;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const submit = () => target.querySelector<HTMLElement>('form.create .submit');
const formCancel = () => [...submit()!.querySelectorAll<HTMLButtonElement>(':scope > button')].find((b) => b.textContent?.trim() === 'Cancel');
const askCancel = () => submit()!.querySelector<HTMLButtonElement>('.inline-confirm button.cancel');

describe('VersionsPage — the create form guards navigation (Polish 3 C8)', () => {
  it('an in-app navigation with a dirty create form asks in the form; Cancel stays, Discard goes', async () => {
    await openDirtyForm();
    let nav = navigate('/courses');
    await settle();
    expect(submit()!.querySelector('.inline-confirm .warning')!.textContent!.trim()).toBe('Discard unsaved changes and continue?');
    expect(document.activeElement).toBe(submit()!.querySelector('button.cancel'));
    submit()!.querySelector<HTMLButtonElement>('button.cancel')!.click();
    expect(await nav).toBe(false);
    await settle();
    expect(currentRoute.path).toBe('/courses/c');
    expect(target.querySelector<HTMLInputElement>('input.new-label')!.value).toBe('Spring');
    expect(submit()!.querySelector('.inline-confirm')).toBeNull();
    expect(document.activeElement).toBe(formCancel());
    nav = navigate('/courses');
    await settle();
    submit()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    expect(await nav).toBe(true);
    expect(currentRoute.path).toBe('/courses');
  });

  it('a clean create form lets a navigation through without asking', async () => {
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    target.querySelector<HTMLButtonElement>('button.add-line')!.click();
    await settle();
    expect(await navigate('/courses')).toBe(true);
    expect(currentRoute.path).toBe('/courses');
  });

  it('a successful Create changes the route with no question open', async () => {
    postMock.mockResolvedValueOnce(mkVersion({ id: 9, label: 'Spring' }));
    await openDirtyForm();
    target.querySelector<HTMLFormElement>('form.create')!.requestSubmit();
    await settle();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(currentRoute.path).toBe('/courses/c/edit/v/9');
    expect(target.querySelector('.inline-confirm')).toBeNull();
  });

  // Review r1 m2: the guard's other paths (R53, R47).
  it("a navigation while the form's own question is open is refused, and focus goes to that question", async () => {
    await openDirtyForm();
    formCancel()!.click();
    await settle();
    expect(submit()!.querySelector('.inline-confirm .warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
    target.querySelector<HTMLInputElement>('input.new-label')!.focus();
    expect(await navigate('/courses')).toBe(false);
    await settle();
    expect(currentRoute.path).toBe('/courses/c');
    expect(document.activeElement).toBe(askCancel());
    expect(submit()!.querySelector('.inline-confirm .warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
  });

  it('Esc in a field while the navigation question is open keeps the question and focuses its Cancel', async () => {
    await openDirtyForm();
    const nav = navigate('/courses');
    await settle();
    const input = target.querySelector<HTMLInputElement>('input.new-label')!;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(submit()!.querySelector('.inline-confirm .warning')!.textContent!.trim()).toBe('Discard unsaved changes and continue?');
    expect(document.activeElement).toBe(askCancel());
    askCancel()!.click();
    expect(await nav).toBe(false);
  });

  it('a second navigation joins the open question (R47)', async () => {
    await openDirtyForm();
    const first = navigate('/courses');
    await settle();
    const second = navigate('/teaching');
    let settled = false;
    void second.then(() => { settled = true; });
    await settle();
    expect(settled).toBe(false);
    expect(submit()!.querySelectorAll('.inline-confirm')).toHaveLength(1);
    askCancel()!.click();
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(currentRoute.path).toBe('/courses/c');
  });

  it('unmounting with the navigation question open resolves the navigation false', async () => {
    await openDirtyForm();
    const nav = navigate('/courses');
    await settle();
    unmount(component!); component = null;
    expect(await nav).toBe(false);
  });

  // Review r1 (Fable m1): a row action's busy disables the form's Cancel; the
  // question's Cancel then lands on Label, not on <body>.
  it("the navigation question's Cancel goes to Label while a row action holds busy", async () => {
    postMock.mockReturnValueOnce(new Promise(() => {}));
    await openDirtyForm();
    target.querySelector<HTMLButtonElement>('button[aria-label="Disable v7"]')!.click();
    await settle();
    target.querySelector<HTMLButtonElement>('li.vrow > .ask-row .inline-confirm button.confirm')!.click();
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/versions/7/disable');
    const nav = navigate('/courses');
    await settle();
    expect(document.activeElement).toBe(askCancel());
    askCancel()!.click();
    expect(await nav).toBe(false);
    await settle();
    expect(formCancel()!.disabled).toBe(true);
    expect(document.activeElement).toBe(target.querySelector('input.new-label'));
  });

  // Review r1 I1: a failed reload puts the page ErrorState in place of the
  // frame; the form goes with it, so no navigation waits on a question no
  // one can see.
  it('a list error drops the dirty form, and a navigation goes without a question', async () => {
    await openDirtyForm();
    versionsPageState.error = { status: 500, message: 'Server error' };
    await settle();
    expect(target.querySelector('form.create')).toBeNull();
    expect(await navigate('/courses')).toBe(true);
    expect(currentRoute.path).toBe('/courses');
  });

  // Call 6 (VR-B): a list error that withdraws the open navigation question
  // lets that navigation go; the form it asked about is gone anyway.
  it('a list error under an open navigation question lets the navigation go', async () => {
    await openDirtyForm();
    const nav = navigate('/courses');
    await settle();
    versionsPageState.error = { status: 500, message: 'Server error' };
    await settle();
    expect(await nav).toBe(true);
    expect(currentRoute.path).toBe('/courses');
  });

  it('a list error under the form\'s own question does not navigate', async () => {
    await openDirtyForm();
    formCancel()!.click();
    await settle();
    versionsPageState.error = { status: 500, message: 'Server error' };
    await settle();
    expect(currentRoute.path).toBe('/courses/c');
    expect(await navigate('/courses')).toBe(true);
  });

  it('a failed list reload moves a free focus to Back to courses (VR-B)', async () => {
    await openDirtyForm();
    target.querySelector<HTMLInputElement>('input.new-label')!.focus();
    versionsPageState.error = { status: 500, message: 'Server error' };
    await settle();
    const back = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Back to courses')!;
    expect(document.activeElement).toBe(back);
  });

  it('a first load that fails does not move focus (VR-B)', async () => {
    versionsPageState.error = { status: 500, message: 'Server error' };
    const tmp = document.createElement('input'); document.body.appendChild(tmp); tmp.focus(); tmp.remove();
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('an offline Create says OFFLINE_MESSAGE (VR-B)', async () => {
    clearToasts();
    postMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await openDirtyForm();
    target.querySelector<HTMLFormElement>('form.create')!.requestSubmit();
    await settle();
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Could not reach server. Check your connection.', 'error']]);
  });

  it('a failed list reload does not take a focus that is elsewhere (VR-B)', async () => {
    await openDirtyForm();
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();
    versionsPageState.error = { status: 500, message: 'Server error' };
    await settle();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('an IME-commit Escape (keyCode 229) neither asks nor closes the form (VR-B)', async () => {
    await openDirtyForm();
    const input = target.querySelector<HTMLInputElement>('input.new-label')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, isComposing: false, bubbles: true, cancelable: true }));
    await settle();
    expect(submit()!.querySelector('.inline-confirm')).toBeNull();
    expect(target.querySelector<HTMLInputElement>('input.new-label')!.value).toBe('Spring');
  });

  // Ruling: no question while Create's POST runs — it would take the busy
  // Create's place, and the success would close the form under it.
  it('a navigation while Create runs goes without a question', async () => {
    let resolve!: (v: Version) => void;
    postMock.mockReturnValueOnce(new Promise<Version>((r) => { resolve = r; }));
    await openDirtyForm();
    target.querySelector<HTMLFormElement>('form.create')!.requestSubmit();
    await settle();
    expect(await navigate('/courses')).toBe(true);
    expect(target.querySelector('.inline-confirm')).toBeNull();
    resolve(mkVersion({ id: 9 }));
    await settle();
  });
});

describe('VersionsPage — the import modal guards navigation (OLX import)', () => {
  const CHECK = {
    summary: { blocks: 1, sequences: 1, items: 1, videos: 1, pages: 0, apps: 0, quizzes: 0, files: 0, bytes: 0 },
    report: [], blockers: [], uploads: [], linked: [], max_quiz_attempts: 3, label: 'Open edX (unfinished): C', blocking: false,
  };
  const foot = () => document.querySelector<HTMLElement>('section.modal-panel footer.modal-foot')!;
  const askBtn = (w: 'confirm' | 'cancel') => foot().querySelector<HTMLButtonElement>(`.inline-confirm button.${w}`)!;

  /** Open the modal, check an export and start an import whose draft creation never answers. */
  async function importing() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ max_file_mb: 20, max_total_mb: 200 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    vi.mocked(readExport).mockResolvedValue({ body: { files: { 'course.xml': '<course/>' }, static: [], apps: [] }, blobs: new Map(), report: [], jsonBytes: 10 });
    postMock.mockImplementation(((url: string) => (url.endsWith('/olx-import/check') ? Promise.resolve(CHECK) : new Promise(() => {}))) as typeof api.post);
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Import from Open edX')!.click();
    await settle();
    const input = document.querySelector<HTMLInputElement>('section.modal-panel input[data-role="export"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'c.tar.gz')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    document.querySelector<HTMLButtonElement>('section.modal-panel [data-action="check"]')!.click();
    await settle();
    document.querySelector<HTMLButtonElement>('section.modal-panel [data-action="import"]')!.click();
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/courses/1/versions', expect.anything());
  }
  afterEach(() => { vi.unstubAllGlobals(); postMock.mockReset(); });

  it('during an import, an in-app navigation asks in the modal; Leave navigates, Cancel stays', async () => {
    await importing();
    let nav = navigate('/courses');
    await settle();
    expect(foot().querySelector('.inline-confirm .warning')!.textContent!.trim()).toBe('An import is running. Leaving stops it and leaves an unfinished draft.');
    expect(document.activeElement).toBe(askBtn('cancel'));
    askBtn('cancel').click();
    expect(await nav).toBe(false);
    expect(currentRoute.path).toBe('/courses/c');
    nav = navigate('/courses');
    await settle();
    askBtn('confirm').click();
    expect(await nav).toBe(true);
    expect(currentRoute.path).toBe('/courses');
  });

  it('a second navigation while the question is open shows one question and refocuses Cancel; Cancel refuses both; Leave goes to the latest destination', async () => {
    await importing();
    let first = navigate('/courses');
    await settle();
    document.querySelector<HTMLElement>('section.modal-panel')!.focus();
    let second = navigate('/teaching');
    await settle();
    expect(foot().querySelectorAll('.inline-confirm')).toHaveLength(1);
    expect(document.activeElement).toBe(askBtn('cancel'));
    askBtn('cancel').click();
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(currentRoute.path).toBe('/courses/c');
    first = navigate('/courses');
    await settle();
    second = navigate('/teaching');
    await settle();
    askBtn('confirm').click();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(currentRoute.path).toBe('/teaching');
  });

  it('beforeunload is prevented while importing', async () => {
    const idle = new Event('beforeunload', { cancelable: true });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    unmount(component); component = null;
    versionsPageState.course = { id: 1, slug: 'c', name: 'Applied Linear Algebra', description: '', is_admin: true };
    versionsPageState.versions = [mkVersion({ id: 7 })];
    versionsPageState.loading = false;
    await importing();
    const busy = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
  });
});
