import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';
import { localTzLabel } from '../lib/datetime';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';

type ModalProps = ComponentProps<typeof MiniProjectModal>;

const course: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
// Stored orders 5 and 9: titles and options must show positions 1 and 2 (R21).
const blocks: BlockResponse[] = [
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 5, info: '', info_html: '' },
  { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 9, info: '', info_html: '' },
];

// A draft whose publish preconditions are all met (2027 deadlines, before runEndDate).
function mp(o: Partial<MiniProjectResponse> = {}): MiniProjectResponse {
  return {
    id: 99, run_id: 10, block_id: 2, title: 'Mini project for Block 2',
    assignment_md: 'orig text', assignment_html: '<p>orig text</p>',
    soft_deadline: '2027-06-01T10:00:00Z', hard_deadline: '2027-06-15T10:00:00Z',
    resubmission_deadline: '2027-06-20T10:00:00Z',
    is_published: false, first_submitted_at: null,
    created_at: '2027-05-01T00:00:00Z', updated_at: '2027-05-01T00:00:00Z',
    ...o,
  };
}

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
let cmp: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres([]));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
  clearToasts();
  __resetGuardsForTests();
});

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

function open(over: Record<string, unknown> = {}) {
  const props: Record<string, unknown> = {
    runId: 10, mode: 'edit', initial: mp(), availableBlocks: [], currentBlock: blocks[1], blocks,
    runIsPublished: true, versionIsDisabled: false, runEndDate: '2027-06-30', course,
    onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined), onNavigateToTab: vi.fn(),
    ...over,
  };
  const target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(MiniProjectModal, { target, props: props as ModalProps });
}
function reopen(over: Record<string, unknown> = {}) {
  if (cmp) unmount(cmp);
  cmp = null;
  document.body.innerHTML = '';
  open(over);
}
const createMode = { mode: 'create', initial: null, currentBlock: null, availableBlocks: blocks };

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const btn = (a: string) => panel().querySelector<HTMLButtonElement>(`button[data-action="${a}"]`);
const closeX = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const ta = () => panel().querySelector<HTMLTextAreaElement>('textarea')!;
const hardInput = () => panel().querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1];
const confirmCancel = () => panel().querySelector<HTMLButtonElement>('.modal-foot .inline-confirm button.cancel')!;
const footButtons = () =>
  [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].map((b) => b.textContent!.trim());
const marker = () => panel().querySelector('footer.modal-foot .mpm-dirty')!.textContent;
const bodyInert = () => panel().querySelector('div.modal-body')!.hasAttribute('inert');
const toastTexts = () => toasts.list.map((t) => t.message);
const isPatch = (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === 'PATCH';
function type(text: string) {
  ta().value = text;
  ta().dispatchEvent(new Event('input', { bubbles: true }));
}
function esc(el: EventTarget) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}
function patchOk() {
  fetchSpy.mockImplementation((_u: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? jres(mp({ assignment_md: 'new text' })) : jres([]));
}
function patchFails(field: string | null, status = 422) {
  fetchSpy.mockImplementation((_u: string, init?: RequestInit) =>
    init?.method !== 'PATCH'
      ? jres([])
      : field
        ? jres({ detail: [{ loc: ['body', field], msg: 'is wrong', type: 'value_error' }] }, status)
        : jres({ detail: 'Mini-project locked by concurrent edit' }, status));
}

describe('MiniProjectModal — frame and title (R21, D14, P5)', () => {
  it('renders inside ui/Modal, labelled by its numbered title; a backdrop click leaves it open (D11)', async () => {
    const onClose = vi.fn();
    open({ onClose });
    await settle();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-labelledby')).toBe('mp-modal-title');
    const h2 = document.getElementById('mp-modal-title')!;
    expect(h2.textContent).toBe('Edit — Block 2 — Theory');
    expect(h2.getAttribute('title')).toBe('Edit — Block 2 — Theory');
    document.querySelector<HTMLElement>('.modal-backdrop')!.click();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('editing shows the Block row as text, with no picker (D14)', async () => {
    open();
    await settle();
    expect(panel().querySelector('select')).toBeNull();
    expect(panel().querySelector('.mpm-block')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Block Block 2 — Theory');
  });

  it('a block missing from blocks drops the prefix; no block at all reads "Edit mini-project" with a "—" row', async () => {
    open({ blocks: [] });
    await settle();
    expect(document.getElementById('mp-modal-title')!.textContent).toBe('Edit — Theory');
    reopen({ currentBlock: null });
    await settle();
    expect(document.getElementById('mp-modal-title')!.textContent).toBe('Edit mini-project');
    expect(panel().querySelector('.mpm-block')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Block —');
  });

  it('the create picker is labelled "Block" and numbers blocks by position', async () => {
    open(createMode);
    await settle();
    expect(document.getElementById('mp-modal-title')!.textContent).toBe('New mini-project');
    expect([...panel().querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Block 1 — Intro', 'Block 2 — Theory']);
    const select = panel().querySelector('select')!;
    expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Block');
  });

  it('deadline labels carry the zone without parentheses (R23); the assignment field is named', async () => {
    open();
    await settle();
    const zone = localTzLabel().slice(1, -1);
    expect(zone).not.toMatch(/[()]/);
    const labels = [...panel().querySelectorAll('.mpm-deadlines label')].map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual([`Soft deadline ${zone}`, `Hard deadline ${zone}`, `Resubmission ${zone}`]);
    expect(ta().getAttribute('aria-label')).toBe('Assignment');
  });
});

describe('MiniProjectModal — footer (D12, R20)', () => {
  it('creating shows Cancel · Create; editing shows Publish · Discard · Save; a published one Discard · Save', async () => {
    open(createMode);
    await settle();
    expect(footButtons()).toEqual(['Cancel', 'Create']);
    reopen();
    await settle();
    expect(footButtons()).toEqual(['Publish', 'Discard', 'Save']);
    reopen({ initial: mp({ is_published: true }) });
    await settle();
    expect(footButtons()).toEqual(['Discard', 'Save']);
  });

  it('"unsaved changes" shows only while the form differs from the saved values', async () => {
    open();
    await settle();
    expect(marker()).toBe('');
    type('changed');
    await settle();
    expect(marker()).toBe('unsaved changes');
    type('orig text');
    await settle();
    expect(marker()).toBe('');
  });

  it('the disabled titles of Save, Discard, Publish and Create', async () => {
    open();
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('No changes to save');
    expect(btn('discard')!.disabled).toBe(true);
    expect(btn('discard')!.title).toBe('No changes to discard');
    expect(btn('publish')!.disabled).toBe(false);
    type('changed');
    await settle();
    expect(btn('save')!.disabled).toBe(false);
    expect(btn('discard')!.disabled).toBe(false);
    expect(btn('publish')!.disabled).toBe(true);
    expect(btn('publish')!.title).toBe('Save your changes first');
    type('');
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('Assignment text is required');
    reopen(createMode);
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('Assignment text is required');
  });

  it('an upload in flight disables Save and Publish with "Wait for the upload to finish"', async () => {
    let resolveUpload!: (v: unknown) => void;
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/api/runs/10/assets') && init?.method === 'POST'
        ? new Promise((r) => { resolveUpload = r; })
        : jres([]));
    open();
    await settle();
    type('changed');
    await settle();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
    ta().dispatchEvent(drop);
    await settle();
    expect(btn('save')!.disabled).toBe(true);
    expect(btn('save')!.title).toBe('Wait for the upload to finish');
    expect(btn('publish')!.disabled).toBe(true);
    expect(btn('publish')!.title).toBe('Wait for the upload to finish');
    resolveUpload({ ok: true, status: 200, json: () => Promise.resolve({ id: 1, filename: 'x.png' }) });
    await settle();
  });
});

describe('MiniProjectModal — Save keeps the editor open (D19)', () => {
  it('Save sends the edit, refreshes, toasts "Saved", leaves the form clean, and focuses Publish', async () => {
    patchOk();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    open({ onSaved, onClose });
    await settle();
    type('new text');
    await settle();
    btn('save')!.focus();
    btn('save')!.click();
    await settle();
    const patch = fetchSpy.mock.calls.find(isPatch)!;
    expect(JSON.parse((patch[1] as RequestInit).body as string).assignment_md).toBe('new text');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(toastTexts()).toEqual(['Saved']);
    expect(marker()).toBe('');
    expect(ta().value).toBe('new text');
    expect(btn('save')!.title).toBe('No changes to save');
    expect(document.activeElement).toBe(btn('publish'));
  });

  it('a busy Save stays enabled as "Saving…" and keeps focus; a second click sends nothing (R20, Review Focus 1)', async () => {
    let resolvePatch!: (v: unknown) => void;
    fetchSpy.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? new Promise((r) => { resolvePatch = r; }) : jres([]));
    open();
    await settle();
    type('new text');
    await settle();
    const save = btn('save')!;
    save.focus();
    save.click();
    save.click();
    await settle();
    expect(fetchSpy.mock.calls.filter(isPatch)).toHaveLength(1);
    expect(save.disabled).toBe(false);
    expect(save.textContent!.trim()).toBe('Saving…');
    expect(document.activeElement).toBe(save);
    expect(closeX().disabled).toBe(true);
    expect(ta().readOnly).toBe(true);
    resolvePatch({
      ok: true, status: 200,
      json: () => Promise.resolve(mp({ assignment_md: 'new text' })),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    await settle();
    expect(fetchSpy.mock.calls.filter(isPatch)).toHaveLength(1);
    expect(ta().readOnly).toBe(false);
  });

  it('with Publish hidden, focus goes to the assignment field; in Preview, to the Edit tab (Review Focus 4)', async () => {
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? jres(mp({ is_published: true }))
        : String(url).includes('/render') ? jres({ html: '<p>x</p>' }) : jres([]));
    open({ initial: mp({ is_published: true }) });
    await settle();
    type('new text');
    await settle();
    btn('save')!.click();
    await settle();
    expect(document.activeElement).toBe(ta());
    type('newer text');
    await settle();
    btn('preview')!.click();
    await settle();
    expect(panel().querySelector('textarea')).toBeNull();
    btn('save')!.click();
    await settle();
    expect(document.activeElement).toBe(btn('edit'));
  });

  it('a refresh that fails after a save: clean form, the refresh toast, no save error (Review Focus 5)', async () => {
    patchOk();
    open({ onSaved: vi.fn().mockRejectedValue(new Error('network')) });
    await settle();
    type('new text');
    await settle();
    btn('save')!.click();
    await settle();
    expect(toastTexts()).toEqual(['Saved (refresh failed — reload to see latest)']);
    expect(toasts.list[0].kind).toBe('info');
    expect(marker()).toBe('');
    expect(panel().querySelector('.banner-error')).toBeNull();
  });

  it('Create calls onCreated, then awaits onSaved, then closes; a failed refresh still closes, with its toast', async () => {
    const created = mp({ id: 5, block_id: 1 });
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST' && String(url).includes('/api/runs/10/mini-projects') ? jres(created) : jres([]));
    const calls: string[] = [];
    let rejectSaved!: (e: unknown) => void;
    open({
      ...createMode,
      onCreated: (m: MiniProjectResponse) => { calls.push(`created ${m.id}`); },
      onSaved: () => {
        calls.push('saved');
        return new Promise<void>((_res, rej) => { rejectSaved = rej; });
      },
      onClose: () => { calls.push('close'); },
    });
    await settle();
    type('Task');
    await settle();
    btn('save')!.click();
    await settle();
    expect(calls).toEqual(['created 5', 'saved']);
    expect(btn('save')!.textContent!.trim()).toBe('Creating…');
    rejectSaved(new Error('network'));
    await settle();
    expect(calls).toEqual(['created 5', 'saved', 'close']);
    expect(toastTexts()).toEqual(['Created (refresh failed — reload to see latest)']);
  });
});

describe('MiniProjectModal — Discard and failed saves (D12, R20)', () => {
  it('Discard puts back the saved values, clears the errors, and focuses the assignment field', async () => {
    patchFails('assignment_md');
    open();
    await settle();
    const before = hardInput().value;
    hardInput().value = '2027-06-16T10:00';
    hardInput().dispatchEvent(new Event('input', { bubbles: true }));
    type('bad');
    await settle();
    btn('save')!.click();
    await settle();
    expect(panel().querySelector('#err-assignment_md')).not.toBeNull();
    expect(panel().querySelector('.banner-error')).not.toBeNull();
    btn('discard')!.click();
    await settle();
    expect(ta().value).toBe('orig text');
    expect(hardInput().value).toBe(before);
    expect(panel().querySelector('#err-assignment_md')).toBeNull();
    expect(panel().querySelector('.banner-error')).toBeNull();
    expect(marker()).toBe('');
    expect(document.activeElement).toBe(ta());
  });

  it('Discard in Preview focuses the editor\'s Edit tab (§Focus › After Discard)', async () => {
    fetchSpy.mockImplementation((url: string) =>
      String(url).includes('/render') ? jres({ html: '<p>x</p>' }) : jres([]));
    open();
    await settle();
    type('changed');
    await settle();
    btn('preview')!.click();
    await settle();
    expect(panel().querySelector('textarea')).toBeNull();
    btn('discard')!.click();
    await settle();
    expect(document.activeElement).toBe(btn('edit'));
  });

  it('a failed save focuses the first errored field, marked invalid and no longer frozen', async () => {
    patchFails('hard_deadline');
    open();
    await settle();
    type('new text');
    await settle();
    btn('save')!.focus();
    btn('save')!.click();
    await settle();
    expect(document.activeElement).toBe(hardInput());
    expect(hardInput().getAttribute('aria-invalid')).toBe('true');
    expect(hardInput().getAttribute('aria-describedby')).toBe('err-hard_deadline');
    expect(hardInput().readOnly).toBe(false);
  });

  it('a failed save with no field error keeps focus on Save', async () => {
    patchFails(null, 409);
    open();
    await settle();
    type('new text');
    await settle();
    btn('save')!.focus();
    btn('save')!.click();
    await settle();
    expect(panel().querySelector('.banner-error')!.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(btn('save'));
  });
});

describe('MiniProjectModal — the two confirms', () => {
  it('closing with edits asks in place; × and Esc keep the confirm; the body is inert; Cancel returns to ×', async () => {
    const onClose = vi.fn();
    open({ onClose });
    await settle();
    type('changed');
    await settle();
    esc(ta());
    await settle();
    expect(panel().textContent).toContain('Discard unsaved changes?');
    expect(document.activeElement).toBe(confirmCancel());
    expect(bodyInert()).toBe(true);
    expect(marker()).toBe('unsaved changes');
    // jsdom ignores inert, so the test can put focus back in the field.
    ta().focus();
    esc(ta());
    await settle();
    closeX().click();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(confirmCancel());
    confirmCancel().click();
    await settle();
    expect(panel().textContent).not.toContain('Discard unsaved changes?');
    expect(bodyInert()).toBe(false);
    expect(document.activeElement).toBe(closeX());
    closeX().click();
    await settle();
    btn('confirm-discard')!.click();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the publish confirm takes focus, makes the body inert, survives Esc, and Cancel returns focus to Publish', async () => {
    open();
    await settle();
    btn('publish')!.click();
    await settle();
    expect(panel().textContent).toContain('Once published, this cannot be undone.');
    expect(document.activeElement).toBe(confirmCancel());
    expect(bodyInert()).toBe(true);
    esc(window);
    await settle();
    expect(btn('confirm-publish')).not.toBeNull();
    confirmCancel().click();
    await settle();
    expect(document.activeElement).toBe(btn('publish'));
  });

  it('the publish confirm refuses while dirty; focus goes to × because Publish is now disabled (R22)', async () => {
    open();
    await settle();
    btn('publish')!.click();
    await settle();
    // Inert in a browser; jsdom lets the test force an edit in between.
    type('slipped in');
    await settle();
    btn('confirm-publish')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('/publish'))).toBe(false);
    expect(btn('confirm-publish')).toBeNull();
    expect(btn('publish')!.title).toBe('Save your changes first');
    expect(document.activeElement).toBe(closeX());
  });
});

describe('MiniProjectModal — leaving with edits (D16)', () => {
  it('a tab jump asks while dirty, and never while clean', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open();
    await settle();
    await navigate('/mp-frame-clean');
    expect(ask).not.toHaveBeenCalled();
    type('changed');
    await settle();
    await navigate('/mp-frame-dirty');
    expect(ask).toHaveBeenCalledWith('Discard unsaved changes and continue?');
    ask.mockRestore();
  });
});
