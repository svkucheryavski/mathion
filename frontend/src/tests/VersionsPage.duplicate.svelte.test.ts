import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// vi.mock is hoisted above imports, so its factory must NOT reference a
// top-level `const` (TDZ error under Vitest 2). Mock inline with vi.fn(),
// then grab typed handles via vi.mocked AFTER the imports — the repo idiom
// (see RunDetailPage.publish.svelte.test.ts).
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, post: vi.fn() } };
});
// Stub the loader so the page's onMount $effect doesn't hit the network; we
// seed versionsPageState directly.
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...real, pushToast: vi.fn() };
});

import { navigate } from '../lib/router.svelte';
import { api } from '../lib/api';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import { pushToast } from '../stores/toasts.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import type { Version } from '../lib/types';

// Typed handles to the already-hoisted mock fns (used in assertions + reset).
const navigateMock = vi.mocked(navigate);
const postMock = vi.mocked(api.post);
const pushToastMock = vi.mocked(pushToast);

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 1, state: 'published', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: '',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  navigateMock.mockReset();
  postMock.mockReset();
  pushToastMock.mockReset();
  versionsPageState.course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
  versionsPageState.versions = [];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function clickButtonByText(root: HTMLElement, text: string) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
  flushSync();
}
// Slice-5a: row actions are icon buttons named by aria-label ("Duplicate v7").
function clickByLabel(root: HTMLElement, label: string) {
  const btn = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!btn) throw new Error(`button [aria-label="${label}"] not found`);
  btn.click();
  flushSync();
}

describe('VersionsPage — Duplicate', () => {
  it('opens with a clamped prefill, POSTs the label, navigates on success', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    postMock.mockResolvedValue({ id: 42 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();

    // label renders in the row (spec frontend requirement)
    expect(target.querySelector('.vtitle')?.textContent).toBe('Fall');

    clickByLabel(target, 'Duplicate v7');
    await settle();
    const input = target.querySelector<HTMLInputElement>('input.dup-label');
    if (!input) throw new Error('duplicate label input missing');
    expect(input.value).toBe('Copy of Fall');       // prefill
    expect(document.activeElement).toBe(input);     // opening focuses the input
    expect(input.maxLength).toBe(200);

    input.value = 'My Copy';
    input.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create copy');
    await settle();

    expect(postMock).toHaveBeenCalledWith('/api/versions/7/duplicate', { label: 'My Copy' });
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/42');
  });

  it('on error shows a toast and does NOT navigate', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    postMock.mockRejectedValue(new Error('boom'));
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    clickButtonByText(target, 'Create copy');
    await settle();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('single-open: opening a second row does not keep the first open', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'A' }), mkVersion({ id: 8, label: 'B' })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    clickByLabel(target, 'Duplicate v8');
    const inputs = target.querySelectorAll('input.dup-label');
    expect(inputs.length).toBe(1);                    // only one row open
    expect((inputs[0] as HTMLInputElement).value).toBe('Copy of B');
  });

  it('the + Add version form sends the optional label', async () => {
    postMock.mockResolvedValue({ id: 99 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, '+ Add version');
    await settle();
    const labelInput = target.querySelector<HTMLInputElement>('input.new-label');
    if (!labelInput) throw new Error('new-version label input missing');
    labelInput.value = 'First';
    labelInput.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create');
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/courses/1/versions', expect.objectContaining({ label: 'First' }));
  });

  // The label is mandatory (user, 2026-10-08).
  it('Create copy is disabled while the new label is blank', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    const input = target.querySelector<HTMLInputElement>('input.dup-label')!;
    const copy = () => [...target.querySelectorAll<HTMLButtonElement>('form.dup button')].find((b) => b.textContent?.trim() === 'Create copy')!;
    expect(copy().disabled).toBe(false);
    expect(input.required).toBe(true);
    input.value = '  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(copy().disabled).toBe(true);
  });

  it('clamps prefill to 200 chars when label exceeds 200', async () => {
    const longLabel = 'x'.repeat(300);
    versionsPageState.versions = [mkVersion({ id: 7, label: longLabel })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    const input = target.querySelector<HTMLInputElement>('input.dup-label');
    if (!input) throw new Error('duplicate label input missing');
    expect(input.value.length).toBe(200);
    expect(input.value).toBe(('Copy of ' + longLabel).slice(0, 200));
  });

  it('hides duplicate form when the row becomes disabled', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, is_disabled: false })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    expect(target.querySelector('input.dup-label')).not.toBeNull(); // form open
    // Simulate the row becoming disabled (e.g., after transition('disable'))
    versionsPageState.versions = [mkVersion({ id: 7, is_disabled: true })];
    flushSync();
    await settle();
    // Form must be gone
    expect(target.querySelector('input.dup-label')).toBeNull();
    // Row rendered as disabled: the Enable slot replaces Disable, Duplicate keeps its slot disabled.
    expect(target.querySelector('button[aria-label="Enable v7"]')).not.toBeNull();
    expect(target.querySelector<HTMLButtonElement>('button[aria-label="Duplicate v7"]')!.disabled).toBe(true);
  });
});

// C7 point 1 and 3: F1 (the duplicate row and the create form) and F12 (a course switch).
describe('VersionsPage — focus after an action (F1, F12)', () => {
  const field = (sel: string) => target.querySelector<HTMLInputElement>(sel)!;
  const btn = (form: string, text: string) =>
    [...target.querySelectorAll<HTMLButtonElement>(`${form} button`)].find((b) => b.textContent?.trim() === text)!;
  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }
  function hold() {
    let release!: () => void;
    postMock.mockReturnValue(new Promise((_, rej) => { release = () => rej(new Error('boom')); }));
    return () => release();
  }

  it('F1: Duplicate Cancel returns focus to the row\'s Duplicate, else the h1', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    btn('form.dup', 'Cancel').focus();
    btn('form.dup', 'Cancel').click();
    await settle();
    expect(target.querySelector('form.dup')).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('button[aria-label="Duplicate v7"]'));

    clickByLabel(target, 'Duplicate v7');
    await settle();
    // Duplicate turns unavailable meanwhile: the chain goes on to the <h1>.
    const dup = target.querySelector<HTMLButtonElement>('button[aria-label="Duplicate v7"]')!;
    btn('form.dup', 'Cancel').focus();
    dup.disabled = true;
    btn('form.dup', 'Cancel').click();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('h1'));
    dup.disabled = false;
  });

  it('F1: Enter in the busy label input keeps focus (readonly, not disabled)', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    const release = hold();
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    const input = field('input.dup-label');
    expect(document.activeElement).toBe(input);
    target.querySelector<HTMLFormElement>('form.dup')!.requestSubmit();
    await settle();
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    release();
    await settle();
    expect(input.readOnly).toBe(false);
  });

  it('F1: Create copy and Create stay focusable while busy and show loading', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    let release = hold();
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    const copy = btn('form.dup', 'Create copy');
    copy.focus();
    copy.click();
    await settle();
    expect(copy.disabled).toBe(false);
    expect(copy.getAttribute('aria-busy')).toBe('true');
    expect(copy.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(copy);
    release();
    await settle();
    expect(document.activeElement).toBe(copy);   // a failure keeps focus where it was
    btn('form.dup', 'Cancel').click();
    await settle();

    release = hold();
    clickButtonByText(target, '+ Add version');
    await settle();
    type(field('input.new-label'), 'Spring');
    const create = btn('form.create', 'Create');
    create.focus();
    create.click();
    await settle();
    expect(create.disabled).toBe(false);
    expect(create.getAttribute('aria-busy')).toBe('true');
    expect(create.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(create);
    release();
    await settle();
    expect(document.activeElement).toBe(create);
  });

  it('F1: Enter twice in the create form sends one POST', async () => {
    const release = hold();
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, '+ Add version');
    await settle();
    type(field('input.new-label'), 'Spring');
    const form = target.querySelector<HTMLFormElement>('form.create')!;
    form.requestSubmit();
    await settle();
    form.requestSubmit();
    await settle();
    expect(postMock).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  it('F1: Enter twice in the duplicate form sends one POST', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    const release = hold();
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    const form = target.querySelector<HTMLFormElement>('form.dup')!;
    form.requestSubmit();
    await settle();
    form.requestSubmit();
    await settle();
    expect(postMock).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  function switchTo(props: { courseSlug: string }, slug: string, name: string, versions: Version[]) {
    props.courseSlug = slug;
    flushSync();
    // The loader is stubbed: land the new course as it would.
    versionsPageState.course = { id: 2, slug, name, description: '', is_admin: true };
    versionsPageState.versions = versions;
    flushSync();
  }

  it('F12: a course switch focuses the new h1 once loaded', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    const props = $state({ courseSlug: 'c' });
    component = mount(VersionsPage, { target, props });
    await settle();
    target.querySelector<HTMLAnchorElement>('#v-7-title')!.focus();
    props.courseSlug = 'd';
    flushSync();
    expect(target.querySelector('h1')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await settle();
    switchTo(props, 'd', 'D', [mkVersion({ id: 9, course_id: 2, label: 'Winter' })]);
    await settle();
    const h1 = target.querySelector('h1')!;
    expect(h1.textContent).toBe('D');
    expect(document.activeElement).toBe(h1);
  });

  it('F12: a course switch dismisses the create question, resets the form and closes it', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    const props = $state({ courseSlug: 'c' });
    component = mount(VersionsPage, { target, props });
    await settle();
    clickButtonByText(target, '+ Add version');
    await settle();
    type(field('input.new-label'), 'Draft');
    field('input.new-label').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('form.create .inline-confirm')).not.toBeNull();

    switchTo(props, 'd', 'D', []);
    await settle();
    expect(target.querySelector('form.create')).toBeNull();
    clickButtonByText(target, '+ Add version');
    await settle();
    expect(target.querySelector('form.create .inline-confirm')).toBeNull();
    expect(field('input.new-label').value).toBe('');
  });
});

// Task 4 review r1.
describe('VersionsPage — focus after an action, review r1', () => {
  const field = (sel: string) => target.querySelector<HTMLInputElement>(sel)!;
  const btn = (form: string, text: string) =>
    [...target.querySelectorAll<HTMLButtonElement>(`${form} button`)].find((b) => b.textContent?.trim() === text)!;
  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }
  // jsdom keeps focus on a control that turns disabled; a browser drops it.
  function dropFocus() {
    const stand = document.createElement('button');
    target.append(stand);
    stand.focus();
    stand.remove();
  }

  it('Create and Create copy show the spinner only for their own request; another action blocks them', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' }), mkVersion({ id: 8, label: 'Spring' })];
    let release!: () => void;
    postMock.mockReturnValue(new Promise<undefined>((r) => { release = () => r(undefined); }));
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    // A row action on v8 holds the page's busy flag.
    clickByLabel(target, 'Disable v8');
    await settle();
    target.querySelector<HTMLButtonElement>('li.vrow > .ask-row .inline-confirm button.confirm')!.click();
    await settle();
    const copy = btn('form.dup', 'Create copy');
    expect(copy.hasAttribute('aria-busy')).toBe(false);
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(copy.disabled).toBe(false);
    copy.click();
    await settle();
    expect(postMock).toHaveBeenCalledTimes(1);   // only the Disable
    release();
    await settle();
    expect(copy.hasAttribute('aria-disabled')).toBe(false);
  });

  it('the create form\'s Create shows the spinner only for its own request', async () => {
    versionsPageState.versions = [mkVersion({ id: 8, label: 'Spring' })];
    let release!: () => void;
    postMock.mockReturnValue(new Promise<undefined>((r) => { release = () => r(undefined); }));
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickButtonByText(target, '+ Add version');
    await settle();
    type(field('input.new-label'), 'Winter');
    clickByLabel(target, 'Disable v8');
    await settle();
    target.querySelector<HTMLButtonElement>('li.vrow > .ask-row .inline-confirm button.confirm')!.click();
    await settle();
    const create = btn('form.create', 'Create');
    expect(create.hasAttribute('aria-busy')).toBe(false);
    expect(create.getAttribute('aria-disabled')).toBe('true');
    expect(create.disabled).toBe(false);
    release();
    await settle();
  });

  it('a failed Create copy or Create repairs a focus the browser dropped during the request', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    let fail!: () => void;
    postMock.mockImplementation(() => new Promise((_, rej) => { fail = () => rej(new Error('boom')); }));
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    target.querySelector<HTMLFormElement>('form.dup')!.requestSubmit();
    await settle();
    dropFocus();
    fail();
    await settle();
    expect(document.activeElement).toBe(btn('form.dup', 'Create copy'));
    btn('form.dup', 'Cancel').click();
    await settle();

    clickButtonByText(target, '+ Add version');
    await settle();
    type(field('input.new-label'), 'Winter');
    target.querySelector<HTMLFormElement>('form.create')!.requestSubmit();
    await settle();
    dropFocus();
    fail();
    await settle();
    expect(document.activeElement).toBe(btn('form.create', 'Create'));
  });

  it('F12: a switch away and back does not re-open the duplicate row', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    const props = $state({ courseSlug: 'c' });
    component = mount(VersionsPage, { target, props });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    await settle();
    expect(target.querySelector('form.dup')).not.toBeNull();
    props.courseSlug = 'd';
    flushSync();
    versionsPageState.course = { id: 2, slug: 'd', name: 'D', description: '', is_admin: true };
    versionsPageState.versions = [];
    flushSync();
    await settle();
    props.courseSlug = 'c';
    flushSync();
    versionsPageState.course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    flushSync();
    await settle();
    expect(target.querySelector('form.dup')).toBeNull();
  });

  it('F12: the first entry does not focus the <h1>; a switch focuses it only once the new course has loaded', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    const props = $state({ courseSlug: 'c' });
    component = mount(VersionsPage, { target, props });
    await settle();
    expect(document.activeElement).toBe(document.body);
    props.courseSlug = 'd';
    versionsPageState.loading = true;
    flushSync();
    await settle();
    // Still loading: the new frame is not up.
    versionsPageState.course = { id: 2, slug: 'd', name: 'D', description: '', is_admin: true };
    versionsPageState.versions = [];
    flushSync();
    await settle();
    expect(target.querySelector('h1')!.textContent).toBe('D');
    expect(document.activeElement).toBe(document.body);
    versionsPageState.loading = false;
    flushSync();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('h1'));
  });
});
