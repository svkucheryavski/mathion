import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NewRunModal from '../components/runs/NewRunModal.svelte';
import type { Course, Version } from '../lib/types';
import { currentRoute } from '../lib/router.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchSpy;
  document.body.innerHTML = '';
  history.replaceState(null, '', '/courses/algebra/runs');
  Object.assign(currentRoute, { path: '/courses/algebra/runs', search: '', hash: '' });
});

const course: Course = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true } as Course;
const versions: Version[] = [
  { id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false, label: '' } as Version,
];

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function mountModal(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onClose = vi.fn();
  const cmp = mount(NewRunModal, { target, props: { course, versions, onClose, ...extra } });
  return { target, cmp, onClose };
}

function fill(target: HTMLElement, name: string, value: string) {
  const el = target.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function fillValid(target: HTMLElement) {
  fill(target, 'title', 'Spring');
  fill(target, 'start_date', '2026-06-01');
  fill(target, 'end_date', '2026-06-30');
  flushSync();
}
const createBtn = (t: HTMLElement) => t.querySelector('button[data-action="create"]') as HTMLButtonElement;
const input = (t: HTMLElement, name: string) => t.querySelector(`input[name="${name}"]`) as HTMLInputElement;
function created(): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 201,
    json: () => Promise.resolve({ id: 42 }),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
const NO_VERSION = 'No published version — close this modal and publish one first.';

describe('NewRunModal', () => {
  it('blocks submit on empty title and surfaces inline error', async () => {
    const { target, cmp } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = '   ';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(target.textContent).toContain('Title is required');
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('blocks submit when end < start', async () => {
    const { target, cmp } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-15';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(target.textContent).toMatch(/end date must be on or after start date/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('submits payload WITHOUT version_id and navigates on success', async () => {
    fetchSpy.mockImplementation((url: string, init: RequestInit) => {
      expect(url).toContain('/api/courses/1/runs');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30', groups_enabled: false });
      expect('version_id' in body).toBe(false);
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 42 }),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as Response);
    });

    const { target, cmp, onClose } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-30';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onClose).toHaveBeenCalled();
    expect(location.pathname).toBe('/teaching/algebra/runs/42');
    unmount(cmp);
  });

  it('surfaces API error as banner without closing', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'Title already exists in this course' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response));

    const { target, cmp, onClose } = mountModal();
    await settle();
    (target.querySelector('input[name="title"]') as HTMLInputElement).value = 'Spring';
    target.querySelector('input[name="title"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="start_date"]') as HTMLInputElement).value = '2026-06-01';
    target.querySelector('input[name="start_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('input[name="end_date"]') as HTMLInputElement).value = '2026-06-30';
    target.querySelector('input[name="end_date"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(target.textContent).toContain('Title already exists');
    expect(onClose).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('the strip shows the NEWEST published, non-disabled version (not the oldest), as "v. {id}" (D18)', async () => {
    const oldVersion: Version = { id: 88, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false, label: '' } as Version;
    const newVersion: Version = { id: 99, course_id: 1, created_at: '2026-02-01', published_at: '2026-02-02', is_disabled: false, label: '' } as Version;
    // Backend returns versions DESC by created_at — simulate that ordering.
    const { target, cmp } = mountModal({ versions: [newVersion, oldVersion] });
    await settle();
    const versionRow = target.querySelector('.version-row');
    expect(versionRow?.textContent).toMatch(/will use v\. 99/);
    expect(versionRow?.textContent).not.toContain('v. 88');
    unmount(cmp);
  });
});

describe('NewRunModal — on ui/Modal (10k)', () => {
  it('renders inside ui/Modal named "New run"; Title has focus; the backdrop does not close; Cancel, × and Esc do (D11)', async () => {
    const { target, cmp, onClose } = mountModal();
    await settle();
    const dialog = target.querySelector('section.modal-panel[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('New run');
    expect(document.activeElement).toBe(input(target, 'title'));
    target.querySelector<HTMLElement>('.modal-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    target.querySelector<HTMLButtonElement>('button[data-action="cancel"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    target.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount(cmp);
  });

  it('each visible label names its own field; ids never collide with the heading', async () => {
    const { target, cmp } = mountModal();
    await settle();
    for (const [text, name] of [['Title', 'title'], ['Start date', 'start_date'], ['End date', 'end_date']]) {
      const label = Array.from(target.querySelectorAll('label')).find((l) => l.textContent === text)!;
      expect(document.getElementById(label.htmlFor)).toBe(input(target, name));
    }
    const ids = Array.from(target.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    unmount(cmp);
  });

  it('ties each error to its field and focuses the first invalid field (R18)', async () => {
    const { target, cmp } = mountModal();
    await settle();
    fill(target, 'title', 'Spring');
    createBtn(target).click();
    await settle();
    const start = input(target, 'start_date');
    const end = input(target, 'end_date');
    expect(input(target, 'title').hasAttribute('aria-invalid')).toBe(false);
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(start.getAttribute('aria-describedby')!)?.textContent).toBe('Start date is required');
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(end.getAttribute('aria-describedby')!)?.textContent).toBe('End date is required');
    expect(document.activeElement).toBe(start);
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it("clears a field's error when that field is edited", async () => {
    const { target, cmp } = mountModal();
    await settle();
    createBtn(target).click();
    await settle();
    expect(target.textContent).toContain('Title is required');
    fill(target, 'title', 'S');
    flushSync();
    expect(target.textContent).not.toContain('Title is required');
    expect(input(target, 'title').hasAttribute('aria-invalid')).toBe(false);
    expect(target.textContent).toContain('Start date is required');
    unmount(cmp);
  });

  it('the footer Create run sits outside the form and submits it through `form` (R17)', async () => {
    fetchSpy.mockImplementation(created);
    const { target, cmp } = mountModal();
    await settle();
    fillValid(target);
    const btn = createBtn(target);
    const form = target.querySelector('form')!;
    expect(btn.type).toBe('submit');
    expect(btn.getAttribute('form')).toBe(form.id);
    expect(form.contains(btn)).toBe(false);
    btn.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('the Switch sets groups_enabled, never submits, and is named by its label and help', async () => {
    let body: Record<string, unknown> = {};
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return created();
    });
    const { target, cmp } = mountModal();
    await settle();
    fillValid(target);
    const sw = target.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    expect(target.querySelector(`label[for="${sw.id}"]`)?.textContent).toBe('Groups enabled');
    expect(document.getElementById(sw.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Organise students into groups. Locked once the run is published — and mini-projects need it.',
    );
    sw.click();
    flushSync();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(fetchSpy).not.toHaveBeenCalled();
    createBtn(target).click();
    await settle();
    expect(body.groups_enabled).toBe(true);
    unmount(cmp);
  });

  it('the strip reads "will use {label} · v. {id}", with the dot outside the mono id (D18)', async () => {
    const labelled = { ...versions[0], id: 12, label: 'Spring 2026' } as Version;
    const { target, cmp } = mountModal({ versions: [labelled] });
    await settle();
    const row = target.querySelector('.version-row')!;
    expect(row.textContent).toMatch(/will use Spring 2026 · v\. 12/);
    expect(row.querySelector('.mono')?.textContent).toBe('v. 12');
    expect(row.querySelector('.nr-strip-val')?.classList.contains('wrap')).toBe(false);   // the pinned label keeps its ellipsis
    unmount(cmp);
  });

  it('with no published version the strip says so and Create run is disabled with that title', async () => {
    const draft = { ...versions[0], published_at: null } as Version;
    const { target, cmp } = mountModal({ versions: [draft] });
    await settle();
    expect(target.querySelector('.version-row')?.textContent).toContain(NO_VERSION);
    // The reason wraps (Polish 3): only this branch carries .wrap.
    expect(target.querySelector('.version-row .nr-strip-val')?.classList.contains('wrap')).toBe(true);
    expect(createBtn(target).disabled).toBe(true);
    expect(createBtn(target).title).toBe(NO_VERSION);
    unmount(cmp);
  });

  it('while creating, Esc, × and Cancel do nothing and the fields are readonly; success closes and navigates once (R19, R20)', async () => {
    let resolve!: (r: Response) => void;
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    const { target, cmp, onClose } = mountModal();
    await settle();
    fillValid(target);
    createBtn(target).click();
    await settle();
    const btn = createBtn(target);
    expect(btn.textContent?.trim()).toBe('Creating…');
    expect(btn.disabled).toBe(false);
    expect(input(target, 'title').readOnly).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    target.querySelector<HTMLButtonElement>('button[data-action="cancel"]')!.click();
    target.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(onClose).not.toHaveBeenCalled();
    const push = vi.spyOn(history, 'pushState');
    resolve(await created());
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/teaching/algebra/runs/42');
    push.mockRestore();
    unmount(cmp);
  });

  it('a second submit while creating — Enter in a field or the busy button — sends one request (R20, Review Focus 1)', async () => {
    let resolve!: (r: Response) => void;
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    const { target, cmp, onClose } = mountModal();
    await settle();
    fillValid(target);
    createBtn(target).click();
    await settle();
    target.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    createBtn(target).click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const push = vi.spyOn(history, 'pushState');
    resolve(await created());
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    push.mockRestore();
    unmount(cmp);
  });

  it('a server error is an alert banner at the top of the body; focus stays on Create run', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'Title already exists in this course' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response));
    const { target, cmp } = mountModal();
    await settle();
    fillValid(target);
    createBtn(target).focus();
    createBtn(target).click();
    await settle();
    const first = target.querySelector('.modal-body')!.firstElementChild!;
    expect(first.getAttribute('role')).toBe('alert');
    expect(first.textContent).toContain('Title already exists');
    expect(document.activeElement).toBe(createBtn(target));
    expect(input(target, 'title').readOnly).toBe(false);
    unmount(cmp);
  });
});
